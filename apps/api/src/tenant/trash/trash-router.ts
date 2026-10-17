import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import { listTrash, parseRestoreRefs, restoreTrash } from "./trash-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

/** GET /app/trash — lo borrado · POST /app/trash/restore — volverlo a su lugar. */
export async function handleTrashRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  if (method === "GET" && url.pathname === "/app/trash") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const daysRaw = url.searchParams.get("days");
    const items = await listTrash(session, {
      days: daysRaw == null ? null : Number(daysRaw),
      kind: url.searchParams.get("kind"),
      vesselCode: url.searchParams.get("vesselCode"),
      q: url.searchParams.get("q"),
    });
    sendJson(response, 200, items, request);
    return true;
  }

  if (method === "POST" && url.pathname === "/app/trash/restore") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody<{ items?: unknown }>(request);
    sendJson(response, 200, await restoreTrash(session, parseRestoreRefs(body?.items)));
    return true;
  }

  return false;
}
