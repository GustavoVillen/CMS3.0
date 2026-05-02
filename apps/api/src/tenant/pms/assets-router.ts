import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import { enforceRateLimit } from "../../http/rate-limiter";
import {
  createTenantAsset,
  deleteTenantAsset,
  getTenantAsset,
  listTenantAssets,
  updateTenantAsset,
} from "../assets/assets-service";
import { suggestAssetCriticality } from "../assets/assets-criticality-ai";
import { suggestAssetIsmFlag } from "../assets/assets-ism-ai";
import {
  createStandbyTest,
  listPendingStandbyTests,
  listStandbyTestsForAsset,
} from "../standby-tests/standby-tests-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

function enforceAuditorListOnly(method: string, path: string, role: string): void {
  if (role !== "AUDITOR_READONLY") return;
  const canListOnly = method === "GET" && (path === "/app/pms/assets" || /^\/app\/pms\/assets\/[^/]+$/.test(path));
  if (!canListOnly) {
    throw new RouteError(403, "FORBIDDEN", "AUDITOR_READONLY solo puede listar.");
  }
}

export async function handleAssetRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  // standby-tests no empieza con /app/pms/assets — handled separately
  if (url.pathname.startsWith("/app/pms/standby-tests")) {
    const tenantSlug = requireTenantSlug(request, env);
    const session = requireTenantAccessSession(request, tenantSlug);

    if (method === "GET" && url.pathname === "/app/pms/standby-tests/pending") {
      const items = await listPendingStandbyTests(session, url.searchParams.get("vesselCode"));
      sendJson(response, 200, { items, total: items.length });
      return true;
    }
    if (method === "POST" && url.pathname === "/app/pms/standby-tests") {
      enforceRateLimit(request, `standby-test:${session.user.id}`, { maxRequests: 60, windowMs: 60_000 });
      const body = await readJsonBody(request) as Parameters<typeof createStandbyTest>[1];
      sendJson(response, 201, await createStandbyTest(session, body));
      return true;
    }
    const m = url.pathname.match(/^\/app\/pms\/standby-tests\/asset\/([^/]+)$/);
    if (method === "GET" && m) {
      const items = await listStandbyTestsForAsset(session, m[1]!);
      sendJson(response, 200, { items, total: items.length });
      return true;
    }
    return false;
  }

  if (!url.pathname.startsWith("/app/pms/assets")) return false;

  const tenantSlug = requireTenantSlug(request, env);
  const session = requireTenantAccessSession(request, tenantSlug);
  enforceAuditorListOnly(method, url.pathname, session.user.role);

  if (method === "GET" && url.pathname === "/app/pms/assets") {
    const trackParam = url.searchParams.get("trackDailyReport");
    const safetyParam = url.searchParams.get("isSafetyCritical");
    const items = await listTenantAssets(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status: url.searchParams.get("status"),
      criticality: url.searchParams.get("criticality"),
      trackDailyReport: trackParam === "true" ? true : trackParam === "false" ? false : null,
      isSafetyCritical: safetyParam === "true" ? true : safetyParam === "false" ? false : null,
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/assets") {
    const body = await readJsonBody(request) as Parameters<typeof createTenantAsset>[1];
    sendJson(response, 201, await createTenantAsset(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/assets/suggest-criticality") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody(request) as Parameters<typeof suggestAssetCriticality>[1];
    sendJson(response, 200, await suggestAssetCriticality(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/assets/suggest-ism") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody(request) as Parameters<typeof suggestAssetIsmFlag>[1];
    sendJson(response, 200, await suggestAssetIsmFlag(session, body));
    return true;
  }

  if (/^\/app\/pms\/assets\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      sendJson(response, 200, await getTenantAsset(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateTenantAsset>[2];
      sendJson(response, 200, await updateTenantAsset(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      await deleteTenantAsset(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  return false;
}
