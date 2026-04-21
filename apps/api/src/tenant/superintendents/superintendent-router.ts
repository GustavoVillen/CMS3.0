import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import {
  assignSuperintendent,
  bulkAssignSuperintendent,
  deactivateSuperintendentAssignment,
  demoteSuperintendent,
  listFleetSuperintendents,
  listPromotableCandidates,
  listSuperintendentAssignments,
  promoteMemberToSuperintendent,
} from "./vessel-superintendent-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

export async function handleSuperintendentRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  if (!url.pathname.startsWith("/app/superintendents")) return false;

  const session = requireTenantAccessSession(request, requireTenantSlug(request, env));

  // GET /app/superintendents — list Fleet Superintendents with their vessel assignments
  if (method === "GET" && url.pathname === "/app/superintendents") {
    sendJson(response, 200, await listFleetSuperintendents(session));
    return true;
  }

  // GET /app/superintendents/assignments — list raw assignments (filterable)
  if (method === "GET" && url.pathname === "/app/superintendents/assignments") {
    const userId = url.searchParams.get("userId");
    const vesselCode = url.searchParams.get("vesselCode");
    const activeParam = url.searchParams.get("isActive");
    const isActive = activeParam === null ? null : activeParam === "true";
    const items = await listSuperintendentAssignments(session, { userId, vesselCode, isActive });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  // POST /app/superintendents/assignments — assign one vessel to one superintendent
  if (method === "POST" && url.pathname === "/app/superintendents/assignments") {
    const body = await readJsonBody(request) as Parameters<typeof assignSuperintendent>[1];
    sendJson(response, 201, await assignSuperintendent(session, body));
    return true;
  }

  // POST /app/superintendents/assignments/bulk — bulk assign multiple vessels to one superintendent
  if (method === "POST" && url.pathname === "/app/superintendents/assignments/bulk") {
    const body = await readJsonBody(request) as Parameters<typeof bulkAssignSuperintendent>[1];
    sendJson(response, 200, await bulkAssignSuperintendent(session, body));
    return true;
  }

  // DELETE /app/superintendents/assignments/:id — deactivate one assignment
  if (method === "DELETE" && /^\/app\/superintendents\/assignments\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/").pop()!;
    sendJson(response, 200, await deactivateSuperintendentAssignment(session, id));
    return true;
  }

  // GET /app/superintendents/candidates — list promotable members (non-superintendent)
  if (method === "GET" && url.pathname === "/app/superintendents/candidates") {
    sendJson(response, 200, await listPromotableCandidates(session));
    return true;
  }

  // POST /app/superintendents/promote — promote member to FLEET_SUPERINTENDENT
  if (method === "POST" && url.pathname === "/app/superintendents/promote") {
    const { userId } = await readJsonBody(request) as { userId: string };
    sendJson(response, 200, await promoteMemberToSuperintendent(session, userId));
    return true;
  }

  // POST /app/superintendents/demote — remove FLEET_SUPERINTENDENT role
  if (method === "POST" && url.pathname === "/app/superintendents/demote") {
    const { userId, newRole } = await readJsonBody(request) as { userId: string; newRole: string };
    sendJson(response, 200, await demoteSuperintendent(session, userId, newRole));
    return true;
  }

  return false;
}
