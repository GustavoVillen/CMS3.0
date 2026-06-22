import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import {
  createTeamInvitation,
  createDirectMember,
  deleteMember,
  listPendingInvitations,
  listTeamMembers,
  setMemberPassword,
  syncMemberVessels,
  updateMemberEmail,
  updateMemberRole,
  updateMemberProfile,
} from "./team-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

export async function handleTeamRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  if (!url.pathname.startsWith("/app/team")) return false;

  const session = requireTenantAccessSession(request, requireTenantSlug(request, env));

  // GET /app/team/members
  if (method === "GET" && url.pathname === "/app/team/members") {
    sendJson(response, 200, await listTeamMembers(session));
    return true;
  }

  // GET /app/team/invitations
  if (method === "GET" && url.pathname === "/app/team/invitations") {
    sendJson(response, 200, await listPendingInvitations(session));
    return true;
  }

  // POST /app/team/invitations
  if (method === "POST" && url.pathname === "/app/team/invitations") {
    const body = await readJsonBody(request) as { email: string; role: string };
    sendJson(response, 201, await createTeamInvitation(session, body as any));
    return true;
  }

  // POST /app/team/members  (direct create, no invitation)
  if (method === "POST" && url.pathname === "/app/team/members") {
    const body = await readJsonBody(request) as { firstName: string; lastName?: string; email?: string; role: string };
    sendJson(response, 201, await createDirectMember(session, body as any));
    return true;
  }

  // PUT /app/team/members/:userId/vessels
  if (method === "PUT" && /^\/app\/team\/members\/[^/]+\/vessels$/.test(url.pathname)) {
    const userId = url.pathname.split("/")[4];
    const { vesselCodes } = await readJsonBody(request) as { vesselCodes: string[] };
    sendJson(response, 200, await syncMemberVessels(session, userId, vesselCodes));
    return true;
  }

  // PUT /app/team/members/:userId/password
  if (method === "PUT" && /^\/app\/team\/members\/[^/]+\/password$/.test(url.pathname)) {
    const userId = url.pathname.split("/")[4];
    const { password } = await readJsonBody(request) as { password: string };
    sendJson(response, 200, await setMemberPassword(session, userId, password));
    return true;
  }

  // PUT /app/team/members/:userId/profile  (nombre para formularios + firma)
  if (method === "PUT" && /^\/app\/team\/members\/[^/]+\/profile$/.test(url.pathname)) {
    const userId = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as { formName?: string | null; signatureUrl?: string | null };
    sendJson(response, 200, await updateMemberProfile(session, userId, body));
    return true;
  }

  // PATCH /app/team/members/:userId/email
  if (method === "PATCH" && /^\/app\/team\/members\/[^/]+\/email$/.test(url.pathname)) {
    const userId = url.pathname.split("/")[4];
    const { email } = await readJsonBody(request) as { email: string };
    sendJson(response, 200, await updateMemberEmail(session, userId, email));
    return true;
  }

  // PATCH /app/team/members/:userId/role
  if (method === "PATCH" && /^\/app\/team\/members\/[^/]+\/role$/.test(url.pathname)) {
    const userId = url.pathname.split("/")[4];
    const { role } = await readJsonBody(request) as { role: string };
    sendJson(response, 200, await updateMemberRole(session, userId, role));
    return true;
  }

  // DELETE /app/team/members/:userId
  if (method === "DELETE" && /^\/app\/team\/members\/[^/]+$/.test(url.pathname)) {
    const userId = url.pathname.split("/").pop()!;
    sendJson(response, 200, await deleteMember(session, userId));
    return true;
  }

  return false;
}
