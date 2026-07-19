// Rutas de Solicitudes de Servicio (SS) — pedidos de servicio externo.
//
// NOTA: acá NO hay `POST /app/pms/service-requests`. Una SS sólo se abre desde
// una OT abierta, y ese endpoint vive en maintenance-router (dueño de
// /app/pms/work-orders/*): `POST /app/pms/work-orders/:id/service-requests`.
// La regla es estructural: no existe forma de crear una SS suelta.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { enforceRateLimit } from "../../http/rate-limiter";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import { buildServiceRequestPdf, buildServiceRequestDoc } from "./service-request-pdf";
import { serveDoc } from "./doc-export";
import {
  addHojaRutaEntry,
  approveServiceRequest,
  authorizeServiceRequest,
  cancelServiceRequest,
  completeServiceRequest,
  deleteHojaRutaEntry,
  deleteServiceRequest,
  getServiceRequest,
  listHojaRuta,
  listServiceRequests,
  rejectServiceRequest,
  startServiceRequest,
  submitServiceRequest,
  unsubmitServiceRequest,
  updateServiceRequest,
} from "../service-requests/service-requests-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

export async function handleServiceRequestsRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  if (!url.pathname.startsWith("/app/pms/service-requests")) return false;

  const tenantSlug = requireTenantSlug(request, env);
  const session = requireTenantAccessSession(request, tenantSlug);

  if (method === "GET" && url.pathname === "/app/pms/service-requests") {
    const items = await listServiceRequests(session, {
      status:      url.searchParams.get("status"),
      priority:    url.searchParams.get("priority"),
      vesselCode:  url.searchParams.get("vesselCode"),
      workOrderId: url.searchParams.get("workOrderId"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  // ── Documento controlado (REGI-LOG-01.3 "Solicitud de servicios") ──────────
  if (method === "GET" && /^\/app\/pms\/service-requests\/[^/]+\/pdf$/.test(url.pathname)) {
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const id = url.pathname.split("/")[4]!;
    const sr = await getServiceRequest(session, id);
    const buffer = await buildServiceRequestPdf(session, id);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${(sr as any).serviceRequestCode}.pdf"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }

  if (method === "GET" && /^\/app\/pms\/service-requests\/[^/]+\/doc$/.test(url.pathname)) {
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const id = url.pathname.split("/")[4]!;
    const sr = await getServiceRequest(session, id);
    serveDoc(response, await buildServiceRequestDoc(session, id), String((sr as any).serviceRequestCode));
    return true;
  }

  if (/^\/app\/pms\/service-requests\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET")    { sendJson(response, 200, await getServiceRequest(session, id)); return true; }
    if (method === "PATCH")  {
      const body = await readJsonBody(request) as Parameters<typeof updateServiceRequest>[2];
      sendJson(response, 200, await updateServiceRequest(session, id, body));
      return true;
    }
    if (method === "DELETE") { await deleteServiceRequest(session, id); sendJson(response, 200, { ok: true }); return true; }
  }

  // ── HOJA DE RUTA DEL PEDIDO: novedades asentadas a mano ────────────────────
  // Los hitos del sistema no se cargan: el PDF los deriva de las fechas de la SS.
  if (/^\/app\/pms\/service-requests\/[^/]+\/hoja-ruta$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET")  { sendJson(response, 200, { items: await listHojaRuta(session, id) }); return true; }
    if (method === "POST") {
      const body = await readJsonBody(request) as Parameters<typeof addHojaRutaEntry>[2];
      sendJson(response, 201, await addHojaRutaEntry(session, id, body ?? {}));
      return true;
    }
  }

  // Borrar una novedad = corregir un error de carga. Sólo TENANT_ADMIN, auditado.
  if (method === "DELETE" && /^\/app\/pms\/service-requests\/[^/]+\/hoja-ruta\/[^/]+$/.test(url.pathname)) {
    const [, , , , id, , logId] = url.pathname.split("/");
    sendJson(response, 200, await deleteHojaRutaEntry(session, id!, logId!));
    return true;
  }

  // { name?, actionDate? } — quién solicita y cuándo. La fecha sólo la honra un
  // TENANT_ADMIN (ver submitServiceRequest).
  if (method === "POST" && /^\/app\/pms\/service-requests\/[^/]+\/submit$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof submitServiceRequest>[2];
    sendJson(response, 200, await submitServiceRequest(session, id, body ?? {}));
    return true;
  }

  // Volver a borrador para corregir. Sólo desde SOLICITADA: después hay firmas.
  if (method === "POST" && /^\/app\/pms\/service-requests\/[^/]+\/unsubmit$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    sendJson(response, 200, await unsubmitServiceRequest(session, id));
    return true;
  }

  // { name, onBehalfUserId?, actionDate? } — los dos últimos sólo los honra un
  // TENANT_ADMIN (ver resolveSigner), igual que la tramitación de la OT.
  if (method === "POST" && /^\/app\/pms\/service-requests\/[^/]+\/approve$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof approveServiceRequest>[2];
    sendJson(response, 200, await approveServiceRequest(session, id, body ?? {}));
    return true;
  }

  // Gate del gasto: sólo Superintendente técnico / DPA (403 para el resto).
  if (method === "POST" && /^\/app\/pms\/service-requests\/[^/]+\/authorize$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof authorizeServiceRequest>[2];
    sendJson(response, 200, await authorizeServiceRequest(session, id, body ?? {}));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/service-requests\/[^/]+\/start$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    sendJson(response, 200, await startServiceRequest(session, id));
    return true;
  }

  // Completar = ENTREGA / RECEPCION: exige quién recibe y si hay conformidad.
  if (method === "POST" && /^\/app\/pms\/service-requests\/[^/]+\/complete$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof completeServiceRequest>[2];
    sendJson(response, 200, await completeServiceRequest(session, id, body ?? {}));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/service-requests\/[^/]+\/reject$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as { reason?: string } | null;
    sendJson(response, 200, await rejectServiceRequest(session, id, String(body?.reason ?? "")));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/service-requests\/[^/]+\/cancel$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as { reason?: string | null } | null;
    sendJson(response, 200, await cancelServiceRequest(session, id, body?.reason ?? null));
    return true;
  }

  return false;
}
