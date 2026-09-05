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
import { buildAssetPdf } from "./asset-pdf-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

function enforceAuditorListOnly(method: string, path: string, role: string): void {
  if (role !== "AUDITOR_READONLY") return;
  // El historial en PDF es lectura pura (es justamente lo que un auditor viene
  // a pedir), así que entra en lo que el rol de sólo lectura puede bajar.
  const canListOnly = method === "GET" && (path === "/app/pms/assets" || /^\/app\/pms\/assets\/[^/]+$/.test(path) || /^\/app\/pms\/assets\/[^/]+\/pdf$/.test(path) || /^\/app\/pms\/assets\/[^/]+\/maintenance-history\/pdf$/.test(path));
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

  // Historial de mantenimientos e inspecciones del equipo (el mismo que muestra
  // la ventana del Dashboard), completo y paginado.
  if (method === "GET" && /^\/app\/pms\/assets\/[^/]+\/maintenance-history\/pdf$/.test(url.pathname)) {
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const id = url.pathname.split("/")[4]!;
    const { buildAssetMaintenanceHistoryPdf } = await import("./asset-maintenance-pdf-service");
    const asset = await getTenantAsset(session, id);
    const buffer = await buildAssetMaintenanceHistoryPdf(session, id);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `historial-mantenimiento-${asset.assetCode}-${dateStr}.pdf`;
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }

  if (method === "GET" && /^\/app\/pms\/assets\/[^/]+\/pdf$/.test(url.pathname)) {
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const id = url.pathname.split("/")[4]!;
    const asset = await getTenantAsset(session, id);
    const buffer = await buildAssetPdf(session, id);
    const filename = `${asset.assetCode}-${asset.vesselCode}.pdf`;
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
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
