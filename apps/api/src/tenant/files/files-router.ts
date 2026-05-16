// Rutas autenticadas para servir uploads. Antes vivían en /uploads/* sin
// auth (cualquiera con el filename UUID podía descargar). Ahora pasan por
// requireTenantAccessSession y validamos que el tenantSlug del path coincida
// con la sesión — así un user de tenant A no puede leer files de tenant B
// aunque conozca el filename completo.
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
import { serveAttachment } from "../attachments/attachment-uploads-service";
import { sendJson } from "../../http/json-response";

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
    return serveCertificateUpload(response, tenantSlug, filename!) || notFound(response);
  }

  // /app/files/checklists/{tenantSlug}/{filename}
  const checklistMatch = url.pathname.match(/^\/app\/files\/checklists\/([^/]+)\/([^/]+)$/);
  if (checklistMatch) {
    const [, pathSlug, filename] = checklistMatch;
    if (pathSlug !== tenantSlug) return tenantMismatch(response);
    return serveChecklistUpload(response, tenantSlug, filename!) || notFound(response);
  }

  // /app/files/fluid-reports/{tenantSlug}/{filename}
  const fluidMatch = url.pathname.match(/^\/app\/files\/fluid-reports\/([^/]+)\/([^/]+)$/);
  if (fluidMatch) {
    const [, pathSlug, filename] = fluidMatch;
    if (pathSlug !== tenantSlug) return tenantMismatch(response);
    return serveFluidReportUpload(response, tenantSlug, filename!) || notFound(response);
  }

  // /app/files/attachments/{tenantSlug}/{entityType}/{filename}
  const attMatch = url.pathname.match(/^\/app\/files\/attachments\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (attMatch) {
    const [, pathSlug, entityType, filename] = attMatch;
    if (pathSlug !== tenantSlug) return tenantMismatch(response);
    return serveAttachment(response, tenantSlug, entityType!, filename!) || notFound(response);
  }

  return false;
}
