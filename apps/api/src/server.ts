import { createServer } from "node:http";
import { loadDotEnvFile } from "./config/load-dotenv";
import { parseAppEnv } from "./config/env";
import { sendHtml } from "./http/html-response";
import { sendJson } from "./http/json-response";
import { toErrorPayload } from "./http/route-error";
import { getRequestUrl } from "./http/request-url";
import { serveStaticFile, serveSpaHtml, serveWebModernAsset, serveWebModernSpa } from "./http/static-files";
import { serveCertificateUpload } from "./tenant/certificates/cert-uploads-service";
import { serveChecklistUpload } from "./tenant/pms/checklist-uploads-service";
import { serveFluidReportUpload } from "./tenant/fluid-analyses/fluid-uploads-service";
import { buildHealthcheckPayload } from "./health/health-route";
import { buildHomePage } from "./platform/home/home-page";
import { handlePublicBootstrapRequest } from "./tenant/bootstrap/public-bootstrap-route";
import { generateInsightsForTenant } from "./tenant/ai-insights/insight-generator";
import { handlePlatformRoutes } from "./platform/platform-router";
import { handleTenantRoutes } from "./tenant/tenant-router";
import { handlePmsRoutes } from "./tenant/pms/pms-router";
import { resetPrismaClient } from "./platform/data/prisma-client";
import { evictExpiredSessions } from "./tenant/auth/session-store";
import { evictExpiredRateLimitBuckets } from "./http/rate-limiter";

loadDotEnvFile();

const env = parseAppEnv(process.env as Record<string, string | undefined>);
const port = Number(process.env.PORT || 3105);

const server = createServer(async (request, response) => {
  const method = String(request.method || "GET").toUpperCase();
  const url = getRequestUrl(request);

  // ── Unauthenticated / infrastructure routes ─────────────────────────────────
  // Dev-only landing: expone mapa de endpoints, hints de credenciales demo y
  // un Local Dev Console. NUNCA debe servirse en producción — cae al SPA.
  if (method === "GET" && url.pathname === "/" && env.nodeEnv !== "production") {
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

  // ── Uploaded certificate source files ───────────────────────────────────────
  // Pattern: /uploads/certificates/{tenantSlug}/{filename}
  const uploadMatch = url.pathname.match(/^\/uploads\/certificates\/([^/]+)\/([^/]+)$/);
  if (method === "GET" && uploadMatch) {
    const [, tenantSlug, filename] = uploadMatch;
    const served = serveCertificateUpload(response, tenantSlug, filename);
    if (served) return;
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Archivo no encontrado." } });
    return;
  }

  const checklistUploadMatch = url.pathname.match(/^\/uploads\/checklists\/([^/]+)\/([^/]+)$/);
  if (method === "GET" && checklistUploadMatch) {
    const [, tenantSlug, filename] = checklistUploadMatch;
    const served = serveChecklistUpload(response, tenantSlug, filename);
    if (served) return;
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Archivo no encontrado." } });
    return;
  }

  const fluidReportMatch = url.pathname.match(/^\/uploads\/fluid-reports\/([^/]+)\/([^/]+)$/);
  if (method === "GET" && fluidReportMatch) {
    const [, tenantSlug, filename] = fluidReportMatch;
    const served = serveFluidReportUpload(response, tenantSlug, filename);
    if (served) return;
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Archivo no encontrado." } });
    return;
  }

  // ── CSP report receiver (browsers POST violations here while in report-only) ─
  if (method === "POST" && url.pathname === "/internal/csp-report") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const { log } = await import("./common/logger");
      log.warn("[csp-violation]", raw.slice(0, 2000));
    } catch { /* swallow — receiver must never fail */ }
    response.statusCode = 204;
    response.end();
    return;
  }

  // ── Sub-router dispatch ─────────────────────────────────────────────────────
  try {
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

// ── Background insight scheduler — every 6 hours for all active tenants ───────

async function runInsightScheduler(): Promise<void> {
  const { getPrismaClient } = await import("./platform/data/prisma-client");
  const prisma = getPrismaClient();
  if (!prisma) return;
  try {
    const tenants = await prisma.tenant.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, slug: true },
    });
    for (const t of tenants) {
      await generateInsightsForTenant(t.id).catch(() => {});
    }
  } catch {
    // non-fatal
  }
}

// First run 30 s after startup, then every 6 h
setTimeout(() => { runInsightScheduler().catch(() => {}); }, 30_000);
setInterval(() => { runInsightScheduler().catch(() => {}); }, 6 * 60 * 60 * 1_000);

// restart: 1776615000000