// PRIMERO: carga el .env antes de que se inicialice cualquier otro módulo.
// No reordenar ni mover debajo de los demás imports (ver bootstrap-env.ts).
import "./config/bootstrap-env";

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parseAppEnv } from "./config/env";
import { sendHtml } from "./http/html-response";
import { sendJson } from "./http/json-response";
import { toErrorPayload } from "./http/route-error";
import { parseRequestUrl } from "./http/request-url";
import { readBinaryBody } from "./http/read-binary-body";
import { serveStaticFile, serveSpaHtml, serveWebModernAsset, serveWebModernSpa } from "./http/static-files";
import { buildHealthcheckPayload, buildReadinessResult } from "./health/health-route";
import { buildHomePage } from "./platform/home/home-page";
import { handlePublicBootstrapRequest } from "./tenant/bootstrap/public-bootstrap-route";
import { generateInsightsForTenant } from "./tenant/ai-insights/insight-generator";
import { handlePlatformRoutes } from "./platform/platform-router";
import { handleTenantRoutes } from "./tenant/tenant-router";
import { handlePmsRoutes } from "./tenant/pms/pms-router";
import { handleFilesRoutes } from "./tenant/files/files-router";
import { resetPrismaClient } from "./platform/data/prisma-client";
import { evictExpiredSessions } from "./tenant/auth/session-store";
import { enforceLiveTenantSession } from "./tenant/auth/live-session-guard";
import { evictExpiredUploadClaims } from "./tenant/files/file-access-service";
import { claimWeeklyReportRun } from "./tenant/reports/weekly-report-claim";
import { evictExpiredRateLimitBuckets } from "./http/rate-limiter";
import { evictExpiredLockouts } from "./http/login-lockout";
import { attachUsageTracking } from "./http/usage-tracking-middleware";
import { purgeOldUsageEvents } from "./tenant/usage/usage-service";

const env = parseAppEnv(process.env as Record<string, string | undefined>);
const port = Number(process.env.PORT || 3105);

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  attachUsageTracking(request, response);

  const method = String(request.method || "GET").toUpperCase();

  // Host malformado (`Host: a b`, `[oops`, vacío…): antes esto lanzaba
  // ERR_INVALID_URL fuera de todo try/catch y el unhandled rejection bajaba
  // el proceso. Ahora es un 400 como cualquier otro request inválido.
  const url = parseRequestUrl(request);
  if (!url) {
    sendJson(response, 400, {
      error: { code: "INVALID_REQUEST_URL", message: "Malformed request URL or Host header." },
    });
    return;
  }

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

  // Disponibilidad para operar, separada del liveness (BUG-004): 503 si la
  // conexión a la base está marcada como caída. /health sigue diciendo 200.
  if (method === "GET" && url.pathname === "/readyz") {
    const readiness = buildReadinessResult();
    sendJson(response, readiness.statusCode, readiness.payload);
    return;
  }

  if (method === "GET" && url.pathname === "/public/bootstrap") {
    const result = await handlePublicBootstrapRequest(request, env);
    sendJson(response, result.statusCode, result.payload);
    return;
  }

  // ── Static asset serving ────────────────────────────────────────────────────
  if (method === "GET" && url.pathname.startsWith("/bundle.js")) {
    const served = await serveStaticFile(response, url.pathname.slice(1));
    if (served) return;
  }

  if (method === "GET" && (url.pathname === "/ui" || url.pathname.startsWith("/ui/"))) {
    await serveSpaHtml(response);
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

  // ── B-01: navegaciones del navegador a /platform/* → la app, no la API ──────
  // La consola de plataforma tiene rutas SPA (/platform/tenants, /platform/users,
  // /platform/usage, /platform/prompts, /platform/user-activity,
  // /platform/copilot-questions) con el mismo nombre que endpoints de la API.
  // Sin esta regla el router de plataforma contesta primero y un F5 o una URL
  // pegada devuelve JSON (401/404) en vez de la pantalla. El proxy de Vite ya
  // hacia esto en desarrollo (bypass apiOnly); produccion no lo tenia.
  //
  // El discriminador es la cabecera Accept: una navegacion del navegador manda
  // text/html, un fetch nunca. Verificado que ningun /platform/* se abre como
  // link o descarga directa (usage.xlsx baja por fetch + blob).
  if (
    method === "GET" &&
    url.pathname.startsWith("/platform") &&
    (request.headers.accept ?? "").includes("text/html")
  ) {
    await serveWebModernSpa(response);
    return;
  }

  // ── Sub-router dispatch ─────────────────────────────────────────────────────
  try {
    // Antes de tocar cualquier ruta: si el request trae una sesion de tenant,
    // revalidarla contra la base (baja, suspension, cambio de rol o de buques).
    // Va DENTRO del try para que el 401 salga como respuesta normal.
    await enforceLiveTenantSession(request);

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
  if (method === "GET" && url.pathname.startsWith("/static/")) {
    const served = await serveWebModernAsset(response, url.pathname.slice(1));
    if (served) return;
  }

  // Serve other Vite static files (favicon, manifest, etc.)
  if (method === "GET" && (url.pathname === "/favicon.ico" || url.pathname === "/manifest.json")) {
    const served = await serveWebModernAsset(response, url.pathname.slice(1));
    if (served) return;
  }

  // Catch-all: any GET not matched above → try static asset first, then SPA shell.
  if (method === "GET") {
    const served = await serveWebModernAsset(response, url.pathname.slice(1));
    if (!served) await serveWebModernSpa(response);
    return;
  }

  sendJson(response, 404, {
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `No route matches ${method} ${url.pathname}`,
    },
  });
}

/**
 * Red de contención de último recurso.
 *
 * El callback de `createServer` es async: cualquier excepción que escape de
 * `handleRequest` (rutas públicas previas al try/catch interno, un throw en
 * el propio dispatch, un bug nuevo) se convertía en unhandled rejection y
 * Node baja el proceso. Acá se traduce a una respuesta HTTP controlada.
 */
const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const handled = toErrorPayload(error);
    try {
      if (response.headersSent) {
        response.end();
        return;
      }
      sendJson(response, handled.statusCode, handled.payload);
    } catch {
      try { response.destroy(); } catch { /* socket ya cerrado */ }
    }
  });
});

// Requests que ni siquiera llegan a ser un mensaje HTTP válido (parse error,
// header gigante): Node los emite acá. Sin handler, el default cierra el
// socket, pero un throw dentro de este path sí voltea el proceso.
server.on("clientError", (_err, socket) => {
  try {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    else socket.destroy();
  } catch { /* nada que hacer */ }
});

// Última barrera para promesas huérfanas: sin este handler Node convierte el
// rejection en uncaughtException y baja el proceso. Un PMS caído deja a la
// flota sin OT ni permisos de trabajo. `uncaughtException` SÍ queda con el
// comportamiento por defecto (crash + restart de pm2): ahí el estado del
// proceso ya no es confiable.
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[unhandled-rejection] ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}\n`);
});

server.listen(port, () => {
  process.stdout.write(`API server listening on http://localhost:${port}\n`);
});

// Sweep expired access tokens from the in-memory Map every 5 minutes.
// Lazy eviction in get*() handles tokens that are queried; this catches the rest.
setInterval(evictExpiredSessions, 5 * 60 * 1000).unref();

// Sweep de los "claims" de archivos recien subidos (file-access-service).
setInterval(() => evictExpiredUploadClaims(), 60 * 60 * 1000).unref();

// Sweep stale rate-limit buckets every 10 minutes.
setInterval(evictExpiredRateLimitBuckets, 10 * 60 * 1000).unref();

// Sweep expired login-lockout entries every 10 minutes.
setInterval(evictExpiredLockouts, 10 * 60 * 1000).unref();

// ── Trabajos automaticos de fondo ───────────────────────────────
//
// La instancia de practica (demo) corre EXACTAMENTE el mismo codigo que
// produccion, pero no debe generar insights con IA cada 6 h ni disparar el
// parte semanal por su cuenta: nadie lee esos resultados y el gasto de IA es
// real. `DISABLE_BACKGROUND_JOBS=1` en su .env los apaga. Sin la variable
// (produccion) el comportamiento es identico al de antes de este cambio.
// El copiloto a pedido y las purgas de memoria NO dependen de esta bandera.
const BACKGROUND_JOBS_DISABLED = String(process.env.DISABLE_BACKGROUND_JOBS || "").trim() === "1";
if (BACKGROUND_JOBS_DISABLED) {
  process.stdout.write("[background-jobs] insights y parte semanal APAGADOS (DISABLE_BACKGROUND_JOBS=1)\n");
}

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
if (!BACKGROUND_JOBS_DISABLED) {
  setTimeout(() => { runInsightScheduler().catch(() => {}); }, 30_000);
  setInterval(() => { runInsightScheduler().catch(() => {}); }, 6 * 60 * 60 * 1_000);
}

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
//
// AUDITORÍA 2026-09-09 — esa fila se escribía DESPUÉS de mandar el correo, así
// que sólo servía contra el tick siguiente del mismo proceso: dos instancias
// (o un reinicio en el medio) leían las dos "todavía no está" y el parte salía
// dos veces. Ahora la fila se CREA ANTES de mandar nada y el índice único es
// el que reparte: quien pierde la carrera choca con P2002 y no manda.
//
// Estados de la fila mientras dura el envío (sin tocar el schema): se reserva
// con status FAILED + error PENDING_SEND ("reclamado, todavía sin salir") y al
// terminar se pisa con el resultado real. Si el proceso se cae en el medio, la
// fila queda reclamada y una corrida posterior la reintenta UNA vez.
// El HTML del parte se archiva apenas se arma, ANTES de intentar el correo,
// así que la copia de la semana no se pierde aunque el SMTP falle.
//
// LÍMITE CONOCIDO: si el proceso muere DURANTE el diálogo con el servidor de
// correo, nadie puede saber si el mensaje llegó a salir. El reintento único
// puede, en ese caso, mandarlo dos veces; sin reintento, podría no mandarse
// nunca. Se eligió reintentar una sola vez y dejar la traza en la fila
// (error PENDING_SEND_RETRY) en lugar de reintentar sin límite.

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
        const recipients = t.settings?.weeklyReportRecipients ?? [];

        // Reserva persistente ANTES de armar y mandar nada. El indice unico
        // (tenantId, reportKind, periodKey) es el que decide: si otra instancia
        // ya reservo, el create tira P2002 y aca no se manda.
        // Cast: el helper declara un contrato mínimo (WeeklyReportRunStore) para
        // poder probarlo con un doble; el cliente Prisma real lo cumple pero sus
        // firmas genéricas no encajan estructuralmente.
        const claim = await claimWeeklyReportRun(
          prisma as unknown as Parameters<typeof claimWeeklyReportRun>[0],
          t.id, slot.kind, periodKey, recipients, now,
        );
        if (!claim) continue;

        const report = await buildWeeklyFleetReport(t.slug, slot.kind, now, null);

        // El archivo de la semana se guarda ANTES de intentar el correo: la
        // copia congelada es lo que despues se consulta en "semanas
        // anteriores", y no depende de que el SMTP haya andado.
        await prisma.scheduledReportRun.update({
          where: { id: claim.id },
          data: { html: report.html },
        });

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

        // Cierre de la reserva con el resultado real.
        await prisma.scheduledReportRun.update({
          where: { id: claim.id },
          data: { status: status as any, error: error ? error.slice(0, 500) : null },
        });
        process.stdout.write(`[weekly-report] tenant=${t.slug} ${slot.kind} ${periodKey} ${status}${claim.retry ? " (reintento)" : ""}\n`);
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

if (!BACKGROUND_JOBS_DISABLED) {
  setTimeout(() => { runWeeklyReportScheduler().catch(() => {}); }, 90_000);
  setInterval(() => { runWeeklyReportScheduler().catch(() => {}); }, 15 * 60 * 1_000).unref();
}

// restart: 1776615000000