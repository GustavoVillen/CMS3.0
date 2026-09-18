// Rutas autenticadas para servir uploads. Antes vivían en /uploads/* sin
// auth (cualquiera con el filename UUID podía descargar). Ahora pasan por
// requireTenantAccessSession y validamos que el tenantSlug del path coincida
// con la sesión — así un user de tenant A no puede leer files de tenant B
// aunque conozca el filename completo.
//
// AUDITORÍA 2026-09-09: el tenant NO alcanzaba. Dentro de la misma empresa,
// cualquiera con la URL se bajaba documentos de buques que no tiene asignados.
// Cada ruta pasa ahora por `assertFileAccess` (file-access-service.ts), que busca
// el registro dueño del archivo y le aplica el alcance por buque.
//
// Las URLs en DB siguen con prefijo `/uploads/...`. El backend traduce a
// `/app/files/...` en serializeFileUrl() al devolver al cliente — sin
// migración de datos.
//
// Nota: estos handlers requieren Bearer token, así que `<img src>` directo
// no funciona (browser no manda Authorization). El frontend debe hacer
// fetch + URL.createObjectURL (ver lib/authed-media.tsx).

import type { IncomingMessage, ServerResponse } from "node:http";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { RouteError } from "../../http/route-error";
import type { AppEnv } from "../../config/env";
import { serveCertificateUpload } from "../certificates/cert-uploads-service";
import { serveChecklistUpload } from "../pms/checklist-uploads-service";
import { serveFluidReportUpload } from "../fluid-analyses/fluid-uploads-service";
import { serveWorkOrderScanUpload } from "../work-orders/work-order-scan-uploads-service";
import { serveGoodsReceiptUpload } from "../spares/goods-receipt-uploads-service";
import { serveAttachment } from "../attachments/attachment-uploads-service";
import { sendJson } from "../../http/json-response";
import { assertFileAccess } from "./file-access-service";
import { readFromDrive } from "../settings/archived-files-service";
import { applySecurityHeaders } from "../../http/security-headers";

/**
 * Traduce un path con prefijo legacy `/uploads/...` al equivalente
 * autenticado `/app/files/...`. Si el path no empieza con `/uploads/`,
 * lo devuelve tal cual.
 */
export function serializeFileUrl(dbUrl: string | null): string | null {
  if (!dbUrl) return null;
  if (!dbUrl.startsWith("/uploads/")) return dbUrl;
  return "/app/files/" + dbUrl.slice("/uploads/".length);
}

function notFound(response: ServerResponse): boolean {
  sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Archivo no encontrado." } });
  return true;
}

/**
 * El original ya no está en el disco: pasados 2 años se borra y queda sólo la
 * copia del Drive de la empresa (archived-files-service.ts). Se baja al vuelo y
 * se sirve igual, así el usuario no se entera ni necesita permisos de Google.
 * Los permisos ya los chequeó `assertFileAccess` antes de llegar acá.
 */
async function serveOrFetchFromDrive(
  served: boolean,
  response: ServerResponse,
  tenantSlug: string,
  pathname: string,
): Promise<boolean> {
  if (served) return true;
  const localUrl = "/uploads/" + pathname.slice("/app/files/".length);
  const file = await readFromDrive(tenantSlug, localUrl);
  if (!file) return notFound(response);
  applySecurityHeaders(response);
  response.writeHead(200, {
    "Content-Type": file.mimeType,
    "Content-Length": file.content.length,
    "Cache-Control": "private, max-age=300",
  });
  response.end(file.content);
  return true;
}

function tenantMismatch(response: ServerResponse): boolean {
  sendJson(response, 403, { error: { code: "TENANT_SCOPE_MISMATCH", message: "Archivo no pertenece a tu tenant." } });
  return true;
}

/**
 * Maneja GET /app/files/{kind}/{tenantSlug}/{...}. Devuelve true si la
 * ruta fue manejada, false si no matchea ninguna.
 */
export async function handleFilesRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  if (method !== "GET") return false;
  if (!url.pathname.startsWith("/app/files/")) return false;

  // Auth: necesitamos Bearer token válido + slug de la sesión.
  const headerSlug = resolveTenantSlugFromRequest(request, env);
  if (!headerSlug) throw new RouteError(400, "TENANT_SLUG_REQUIRED", "Tenant slug missing.");
  const session = requireTenantAccessSession(request, headerSlug);
  const tenantSlug = session.tenantSlug;

  // /app/files/certificates/{tenantSlug}/{filename}
  const certMatch = url.pathname.match(/^\/app\/files\/certificates\/([^/]+)\/([^/]+)$/);
  if (certMatch) {
    const [, pathSlug, filename] = certMatch;
    if (pathSlug !== tenantSlug) return tenantMismatch(response);
    await assertFileAccess(session, "certificates", url.pathname);
    return serveOrFetchFromDrive(serveCertificateUpload(response, tenantSlug, filename!), response, tenantSlug, url.pathname);
  }

  // /app/files/checklists/{tenantSlug}/{filename}
  const checklistMatch = url.pathname.match(/^\/app\/files\/checklists\/([^/]+)\/([^/]+)$/);
  if (checklistMatch) {
    const [, pathSlug, filename] = checklistMatch;
    if (pathSlug !== tenantSlug) return tenantMismatch(response);
    await assertFileAccess(session, "checklists", url.pathname);
    return serveOrFetchFromDrive(serveChecklistUpload(response, tenantSlug, filename!), response, tenantSlug, url.pathname);
  }

  // /app/files/fluid-reports/{tenantSlug}/{filename}
  const fluidMatch = url.pathname.match(/^\/app\/files\/fluid-reports\/([^/]+)\/([^/]+)$/);
  if (fluidMatch) {
    const [, pathSlug, filename] = fluidMatch;
    if (pathSlug !== tenantSlug) return tenantMismatch(response);
    await assertFileAccess(session, "fluid-reports", url.pathname);
    return serveOrFetchFromDrive(serveFluidReportUpload(response, tenantSlug, filename!), response, tenantSlug, url.pathname);
  }

  // /app/files/wo-scans/{tenantSlug}/{filename}
  const woScanMatch = url.pathname.match(/^\/app\/files\/wo-scans\/([^/]+)\/([^/]+)$/);
  if (woScanMatch) {
    const [, pathSlug, filename] = woScanMatch;
    if (pathSlug !== tenantSlug) return tenantMismatch(response);
    await assertFileAccess(session, "wo-scans", url.pathname);
    return serveOrFetchFromDrive(serveWorkOrderScanUpload(response, tenantSlug, filename!), response, tenantSlug, url.pathname);
  }

  // /app/files/goods-receipts/{tenantSlug}/{filename}
  const receiptMatch = url.pathname.match(/^\/app\/files\/goods-receipts\/([^/]+)\/([^/]+)$/);
  if (receiptMatch) {
    const [, pathSlug, filename] = receiptMatch;
    if (pathSlug !== tenantSlug) return tenantMismatch(response);
    await assertFileAccess(session, "goods-receipts", url.pathname);
    return serveOrFetchFromDrive(serveGoodsReceiptUpload(response, tenantSlug, filename!), response, tenantSlug, url.pathname);
  }

  // /app/files/attachments/{tenantSlug}/{entityType}/{filename}
  const attMatch = url.pathname.match(/^\/app\/files\/attachments\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (attMatch) {
    const [, pathSlug, entityType, filename] = attMatch;
    if (pathSlug !== tenantSlug) return tenantMismatch(response);
    await assertFileAccess(session, "attachments", url.pathname);
    return serveOrFetchFromDrive(serveAttachment(response, tenantSlug, entityType!, filename!), response, tenantSlug, url.pathname);
  }

  return false;
}
