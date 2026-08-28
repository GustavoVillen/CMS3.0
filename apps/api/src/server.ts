// PRIMERO: carga el .env antes de que se inicialice cualquier otro módulo.
// No reordenar ni mover debajo de los demás imports (ver bootstrap-env.ts).
import "./config/bootstrap-env";

import { createServer } from "node:http";
import { parseAppEnv } from "./config/env";
import { sendHtml } from "./http/html-response";
import { sendJson } from "./http/json-response";
import { toErrorPayload } from "./http/route-error";
import { getRequestUrl } from "./http/request-url";
import { readBinaryBody } from "./http/read-binary-body";
import { serveStaticFile, serveSpaHtml, serveWebModernAsset, serveWebModernSpa } from "./http/static-files";
import { buildHealthcheckPayload } from "./health/health-route";
import { buildHomePage } from "./platform/home/home-page";
import { handlePublicBootstrapRequest } from "./tenant/bootstrap/public-bootstrap-route";
import { generateInsightsForTenant } from "./tenant/ai-insights/insight-generator";
import { handlePlatformRoutes } from "./platform/platform-router";
import { handleTenantRoutes } from "./tenant/tenant-router";
import { handlePmsRoutes } from "./tenant/pms/pms-router";
import { handleFilesRoutes } from "./tenant/files/files-router";
import { resetPrismaClient } from "./platform/data/prisma-client";
import { evictExpiredSessions } from "./tenant/auth/session-store";
import { evictExpiredRateLimitBuckets } from "./http/rate-limiter";
import { evictExpiredLockouts } from "./http/login-lockout";
import { attachUsageTracking } from "./http/usage-tracking-middleware";
import { purgeOldUsageEvents } from "./tenant/usage/usage-service";

const env = parseAppEnv(process.env as Record<string, string | undefined>);
const port = Number(process.env.PORT || 3105);

const server = createServer(async (request, response) => {
  attachUsageTracking(request, response);

  const method = String(request.method || "GET").toUpperCase();
  const url = getRequestUrl(request);

  // ── Unauthenticated / infrastructure routes ─────────────────────────────────
  // Dev-only landing: expone mapa de endpoints, hints de credenciales demo y
  // un Local Dev Console. NUNCA debe servirse en producción — cae al SPA.
  // Fail-closed: solo mostrar en development explícito (no en "unknown").
  if (method === "GET" && url.pathname === "/" && env.nodeEnv === "development") {
    sendHtml(response, 200, buildHomePage(env));
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, buildHealthcheckPayload());
    return;
  }

  if (method === "GET" && url.pathname === "/public/bootstrap") {
    const result = await handlePublicBootstrapRequest(request, env);
    sendJson(response, result.statusCode, result.payload);
    return;
  }

  // ── Static asset serving ────────────────────────────────────────────────────
  if (method === "GET" && url.pathname.startsWith("/bundle.js")) {
    const served = serveStaticFile(response, url.pathname.slice(1));
    if (served) return;
  }

  if (method === "GET" && (url.pathname === "/ui" || url.pathname.startsWith("/ui/"))) {
    serveSpaHtml(response);
    return;
  }

  // ── Uploaded files DEPRECATED — auditoría 2026-05-16 ────────────────────────
  // Antes /uploads/* servía archivos sin auth: cualquiera con el filename
  // UUID podía descargar. Migrado a /app/files/* con requireTenantAccessSession.
  // Respondemos 410 Gone con una pista al cliente para que migre.
  if (method === "GET" && url.pathname.startsWith("/uploads/")) {
    sendJson(response, 410, {
      error: {
        code: "UPLOADS_GONE",
        message: "Esta ruta fue deprecada por seguridad. Usá /app/files/... con Bearer token.",
        replacement: "/app/files/" + url.pathname.slice("/uploads/".length),
      },
    });
    return;
  }

  // ── CSP report receiver (browsers POST violations here while in report-only) ─
  if (method === "POST" && url.pathname === "/internal/csp-report") {
    try {
      // Cap chico: un CSP report legítimo es un JSON pequeño y este endpoint
      // no está autenticado. readBinaryBody aborta si excede el tope; el catch
      // externo lo traga y devolvemos 204 igual.
      const raw = (await readBinaryBody(request, 256 * 1024)).toString("utf8");
      const { log } = await import("./common/logger");
      log.warn("[csp-violation]", raw.slice(0, 2000));
    } catch { /* swallow — receiver must never fail */ }
    response.statusCode = 204;
    response.end();
    return;
  }

  // ── Sub-router dispatch ─────────────────────────────────────────────────────
  try {
    if (await handleFilesRoutes(method, url, request, response, env)) return;
    if (await handlePlatformRoutes(method, url, request, response, env)) return;
    if (await handlePmsRoutes(method, url, request, response, env)) return;
    if (await handleTenantRoutes(method, url, request, response, env)) return;
  } catch (error) {
    // If a Prisma connection error slips through, mark DB unreachable so
    // subsequent requests fall back to dev data instead of hanging.
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ECONNREFUSED") || msg.includes("P1001") || msg.includes("Can't reach database")) {
      resetPrismaClient();
    }
    const handled = toErrorPayload(error);
    sendJson(response, handled.statusCode, handled.payload);
    return;
  }

  // ── web-modern SPA (React/Vite production build) ───────────────────────────
  // Serve hashed assets (JS/CSS/fonts) with immutable cache.
  if (method === "GET" && url.pathname.startsWith("/assets/")) {
    const served = serveWebModernAsset(response, url.pathname.slice(1));
    if (served) return;
  }

  // Serve other Vite static files (favicon, manifest, etc.)
  if (method === "GET" && (url.pathname === "/favicon.ico" || url.pathname === "/manifest.json")) {
    const served = serveWebModernAsset(response, url.pathname.slice(1));
    if (served) return;
  }

  // Catch-all: any GET not matched above → try static asset first, then SPA shell.
  if (method === "GET") {
    const served = serveWebModernAsset(response, url.pathname.slice(1));
    if (!served) serveWebModernSpa(response);
    return;
  }

  sendJson(response, 404, {
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `No route matches ${method} ${url.pathname}`,
    },
  });
});

server.listen(port, () => {
  process.stdout.write(`API server listening on http://localhost:${port}\n`);
});

// Sweep expired access tokens from the in-memory Map every 5 minutes.
// Lazy eviction in get*() handles tokens that are queried; this catches the rest.
setInterval(evictExpiredSessions, 5 * 60 * 1000).unref();

// Sweep stale rate-limit buckets every 10 minutes.
setInterval(evictExpiredRateLimitBuckets, 10 * 60 * 1000).unref();

// Sweep expired login-lockout entries every 10 minutes.
setInterval(evictExpiredLockouts, 10 * 60 * 1000).unref();

// ── Background insight scheduler — every 6 hours for all active tenants ───────
//
// Anti-overlap: si una corrida tarda más que el intervalo (improbable hoy con
// pocos tenants, real al crecer), evitamos que arranque otra en paralelo.
// Dos corridas simultáneas pueden hacer doble audit logs y, sin protección
// en el upsert, race entre inserts del mismo insight.

let insightSchedulerRunning = false;

async function runInsightScheduler(): Promise<void> {
  if (insightSchedulerRunning) {
    process.stdout.write("[insight-scheduler] skipped — previous run still in progress\n");
    return;
  }
  insightSchedulerRunning = true;
  const started = Date.now();
  try {
    const { getPrismaClient } = await import("./platform/data/prisma-client");
    const prisma = getPrismaClient();
    if (!prisma) return;
    const tenants = await prisma.tenant.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, slug: true },
    });
    for (const t of tenants) {
      await generateInsightsForTenant(t.id).catch((err) => {
        process.stderr.write(`[insight-scheduler] tenant=${t.slug} failed: ${err instanceof Error ? err.message : String(err)}\n`);
      });
    }
    process.stdout.write(`[insight-scheduler] completed ${tenants.length} tenants in ${Date.now() - started}ms\n`);
  } catch (err) {
    process.stderr.write(`[insight-scheduler] aborted: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    insightSchedulerRunning = false;
  }
}

// First run 30 s after startup, then every 6 h
setTimeout(() => { runInsightScheduler().catch(() => {}); }, 30_000);
setInterval(() => { runInsightScheduler().catch(() => {}); }, 6 * 60 * 60 * 1_000);

// ── Retención de UsageEvent — purga diaria ──────────────────────────────────
// La tabla crece 1 fila por cada request HTTP autenticado. purgeOldUsageEvents()
// (borra lo anterior a 6 meses) ya existía pero no estaba cableada a ningún cron.
// Primera corrida 60 s post-arranque (para no competir con el boot), luego cada 24 h.
async function runUsagePurge(): Promise<void> {
  try {
    const removed = await purgeOldUsageEvents();
    if (removed > 0) process.stdout.write(`[usage-purge] removed ${removed} events older than 6 months\n`);
  } catch (err) {
    process.stderr.write(`[usage-purge] aborted: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
setTimeout(() => { runUsagePurge().catch(() => {}); }, 60_000);
setInterval(() => { runUsagePurge().catch(() => {}); }, 24 * 60 * 60 * 1_000).unref();

// ── Parte semanal de flota por correo ───────────────────────────────────────
//
// Lunes 07:00 (apertura) y viernes 17:00 (cierre), EN LA HORA DE CADA EMPRESA.
// A diferencia de los otros jobs, este tiene que pegarle a una hora concreta:
// por eso el tick es cada 15 minutos y no cada 6 horas, y por eso la hora se
// calcula con la zona horaria del tenant (07:00 UTC serían las 03:00 en
// Paraguay).
//
// La condición NO es "son exactamente las 7", sino "es lunes, ya pasaron las 7
// y todavía no se mandó el parte de esta semana". La diferencia importa: si el
// servidor estuvo caído el lunes a la mañana, el correo sale igual cuando
// vuelve, en vez de perderse hasta la semana siguiente. Lo que impide el doble
// envío es la fila en ScheduledReportRun con su índice único, que sobrevive a
// reinicios — un contador en memoria no serviría.

const WEEKLY_REPORT_SLOTS = [
  { weekday: 1, hour: 7,  kind: "WEEKLY_OPENING" as const },
  { weekday: 5, hour: 17, kind: "WEEKLY_CLOSING" as const },
];

let weeklyReportRunning = false;

async function runWeeklyReportScheduler(): Promise<void> {
  if (weeklyReportRunning) return;
  weeklyReportRunning = true;
  try {
    const { getPrismaClient } = await import("./platform/data/prisma-client");
    const prisma = getPrismaClient();
    if (!prisma) return;

    const tenants = await prisma.tenant.findMany({
      where: { status: "ACTIVE", settings: { weeklyReportEnabled: true } },
      select: { id: true, slug: true, settings: { select: { timezone: true, weeklyReportRecipients: true } } },
    });
    if (tenants.length === 0) return;

    const { localNow, isoWeekKey, buildWeeklyFleetReport } = await import("./tenant/reports/weekly-fleet-report-service");
    const { isMailConfigured, sendMail } = await import("./common/mailer");
    const now = new Date();

    for (const t of tenants) {
      try {
        const local = localNow(now, t.settings?.timezone || "UTC");
        const slot = WEEKLY_REPORT_SLOTS.find(s => s.weekday === local.weekday && local.hour >= s.hour);
        if (!slot) continue;

        const periodKey = isoWeekKey(local);
        const already = await prisma.scheduledReportRun.findUnique({
          where: { tenantId_reportKind_periodKey: { tenantId: t.id, reportKind: slot.kind, periodKey } },
          select: { id: true },
        });
        if (already) continue;

        const recipients = t.settings?.weeklyReportRecipients ?? [];

        // El parte se arma y se ARCHIVA siempre, aunque no haya correo que
        // mandar: es la copia congelada que despues se consulta en "semanas
        // anteriores". Regenerarla mas tarde daria los numeros de hoy, no los
        // de aquella semana. El envio es el paso siguiente, y puede no ocurrir.
        const report = await buildWeeklyFleetReport(t.slug, slot.kind, now, null);

        let status = "SENT";
        let error: string | undefined;
        if (!isMailConfigured()) {
          status = "SKIPPED_NOT_CONFIGURED";
        } else if (recipients.length === 0) {
          status = "SKIPPED_NO_RECIPIENTS";
        } else {
          const result = await sendMail({
            to: recipients,
            subject: report.subject,
            text: report.text,
            html: report.html,
          });
          status = result.sent ? "SENT" : "FAILED";
          if (!result.sent) error = result.error || result.reason;
        }

        // La fila se escribe SIEMPRE, salga o no el correo: sin ella el job
        // reintentaria en cada tick durante todo el dia.
        await prisma.scheduledReportRun.create({
          data: {
            tenantId: t.id, reportKind: slot.kind, periodKey,
            status: status as any, recipients,
            error: error ? error.slice(0, 500) : null,
            html: report.html,
          },
        }).catch(() => { /* choque con otro proceso: ya quedó asentado */ });
        process.stdout.write(`[weekly-report] tenant=${t.slug} ${slot.kind} ${periodKey} ${status}\n`);
      } catch (err) {
        process.stderr.write(`[weekly-report] tenant=${t.slug} failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`[weekly-report] aborted: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    weeklyReportRunning = false;
  }
}

setTimeout(() => { runWeeklyReportScheduler().catch(() => {}); }, 90_000);
setInterval(() => { runWeeklyReportScheduler().catch(() => {}); }, 15 * 60 * 1_000).unref();

// restart: 1776615000000