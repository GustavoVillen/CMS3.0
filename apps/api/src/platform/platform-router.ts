import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../config/env";
import { sendJson } from "../http/json-response";
import { readJsonBody } from "../http/read-json-body";
import { enforceRateLimit } from "../http/rate-limiter";
import { requirePlatformAccessSession, requirePlatformSuperadmin } from "./auth/platform-route-auth";
import { loginPlatformUser, refreshPlatformSession } from "./auth/platform-auth-service";
import { registerPlatformAccessSession } from "../tenant/auth/session-store";
import { listPlatformAuditEvents } from "./audit/platform-audit-service";
import {
  createPlatformTenant, getPlatformTenant, listPlatformTenants, updatePlatformTenant,
} from "./tenants/platform-tenants-service";
import {
  createPlatformTenantDomain, listPlatformTenantDomains, updatePlatformTenantDomain,
} from "./tenants/platform-tenant-domains-service";
import {
  createPlatformTenantInvitation, listPlatformTenantInvitations,
} from "./tenants/platform-tenant-invitations-service";
import {
  createPlatformTenantUser, getPlatformTenantUser, listPlatformTenantUsers, updatePlatformTenantUser,
} from "./tenants/platform-tenant-users-service";
import {
  createPlatformPrompt, getPlatformPrompt, listPlatformPrompts,
  publishPlatformPrompt, rollbackPlatformPrompt, updatePlatformPrompt,
} from "./prompts/platform-prompts-service";
import {
  createPlatformUser, getPlatformUser, listPlatformUsers, updatePlatformUser,
} from "./users/platform-users-service";

export async function handlePlatformRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  _env: AppEnv,
): Promise<boolean> {

  // ── Auth ───────────────────────────────────────────────────────────────────
  if (method === "POST" && url.pathname === "/platform/auth/login") {
    enforceRateLimit(request, "auth:platform-login", { maxRequests: 10, windowMs: 60_000 });
    const payload = await readJsonBody<{ email: string; password: string }>(request);
    const result = await loginPlatformUser(payload);
    registerPlatformAccessSession({
      kind: "platform",
      accessToken: result.session.accessToken,
      refreshToken: result.session.refreshToken,
      accessTokenExpiresAt: result.session.accessTokenExpiresAt,
      user: result.user,
    });
    sendJson(response, 200, result);
    return true;
  }

  if (method === "POST" && url.pathname === "/platform/auth/refresh") {
    enforceRateLimit(request, "auth:platform-refresh", { maxRequests: 30, windowMs: 60_000 });
    const payload = await readJsonBody<{ refreshToken: string }>(request);
    const result = await refreshPlatformSession(payload);
    sendJson(response, 200, result);
    return true;
  }

  // ── Tenants ────────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/platform/tenants") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const records = await listPlatformTenants({
      status: url.searchParams.get("status"),
      slug:   url.searchParams.get("slug"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/platform/tenants") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const payload = await readJsonBody<any>(request);
    const record = await createPlatformTenant(payload);
    sendJson(response, 201, record);
    return true;
  }

  const tenantMatch = url.pathname.match(/^\/platform\/tenants\/([a-z0-9-]+)$/);
  if (tenantMatch && method === "GET") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    sendJson(response, 200, await getPlatformTenant(tenantMatch[1]));
    return true;
  }
  if (tenantMatch && method === "PATCH") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const payload = await readJsonBody<any>(request);
    sendJson(response, 200, await updatePlatformTenant(tenantMatch[1], payload));
    return true;
  }

  const tenantDomainsMatch = url.pathname.match(/^\/platform\/tenants\/([a-z0-9-]+)\/domains$/);
  if (tenantDomainsMatch && method === "GET") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const records = await listPlatformTenantDomains(tenantDomainsMatch[1]);
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }
  if (tenantDomainsMatch && method === "POST") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const payload = await readJsonBody<any>(request);
    sendJson(response, 201, await createPlatformTenantDomain(tenantDomainsMatch[1], payload));
    return true;
  }

  const tenantDomainMatch = url.pathname.match(/^\/platform\/tenants\/([a-z0-9-]+)\/domains\/([a-zA-Z0-9_-]+)$/);
  if (tenantDomainMatch && method === "PATCH") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const payload = await readJsonBody<any>(request);
    sendJson(response, 200, await updatePlatformTenantDomain(tenantDomainMatch[1], tenantDomainMatch[2], payload));
    return true;
  }

  const tenantInvitesMatch = url.pathname.match(/^\/platform\/tenants\/([a-z0-9-]+)\/invitations$/);
  if (tenantInvitesMatch && method === "GET") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const records = await listPlatformTenantInvitations(tenantInvitesMatch[1], {
      status: url.searchParams.get("status"),
      email:  url.searchParams.get("email"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }
  if (tenantInvitesMatch && method === "POST") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const payload = await readJsonBody<any>(request);
    sendJson(response, 201, await createPlatformTenantInvitation(tenantInvitesMatch[1], payload));
    return true;
  }

  const tenantUsersMatch = url.pathname.match(/^\/platform\/tenants\/([a-z0-9-]+)\/users$/);
  if (tenantUsersMatch && method === "GET") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const records = await listPlatformTenantUsers(tenantUsersMatch[1], {
      userStatus:       url.searchParams.get("userStatus"),
      membershipStatus: url.searchParams.get("membershipStatus"),
      role:             url.searchParams.get("role"),
      email:            url.searchParams.get("email"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }
  if (tenantUsersMatch && method === "POST") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const payload = await readJsonBody<any>(request);
    sendJson(response, 201, await createPlatformTenantUser(tenantUsersMatch[1], payload));
    return true;
  }

  const tenantUserMatch = url.pathname.match(/^\/platform\/tenants\/([a-z0-9-]+)\/users\/([a-zA-Z0-9_-]+)$/);
  if (tenantUserMatch && method === "GET") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    sendJson(response, 200, await getPlatformTenantUser(tenantUserMatch[1], tenantUserMatch[2]));
    return true;
  }
  if (tenantUserMatch && method === "PATCH") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const payload = await readJsonBody<any>(request);
    sendJson(response, 200, await updatePlatformTenantUser(tenantUserMatch[1], tenantUserMatch[2], payload, session.user.id));
    return true;
  }

  // ── Platform Users ─────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/platform/users") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const records = await listPlatformUsers({
      status: url.searchParams.get("status"),
      role:   url.searchParams.get("role"),
      email:  url.searchParams.get("email"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/platform/users") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const payload = await readJsonBody<any>(request);
    sendJson(response, 201, await createPlatformUser(payload));
    return true;
  }

  const platformUserMatch = url.pathname.match(/^\/platform\/users\/([a-zA-Z0-9_-]+)$/);
  if (platformUserMatch && method === "GET") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    sendJson(response, 200, await getPlatformUser(platformUserMatch[1]));
    return true;
  }
  if (platformUserMatch && method === "PATCH") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const payload = await readJsonBody<any>(request);
    sendJson(response, 200, await updatePlatformUser(platformUserMatch[1], payload));
    return true;
  }

  // ── Audit ──────────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/platform/audit-events") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const records = await listPlatformAuditEvents({
      tenantSlug: url.searchParams.get("tenantSlug"),
      actorType:  url.searchParams.get("actorType"),
      action:     url.searchParams.get("action"),
      entityType: url.searchParams.get("entityType"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Prompts ────────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/platform/prompts") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const records = await listPlatformPrompts({
      capability: url.searchParams.get("capability"),
      locale:     url.searchParams.get("locale"),
      status:     url.searchParams.get("status"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/platform/prompts") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const payload = await readJsonBody<any>(request);
    sendJson(response, 201, await createPlatformPrompt(payload));
    return true;
  }

  const promptMatch = url.pathname.match(/^\/platform\/prompts\/([a-zA-Z0-9_-]+)$/);
  if (promptMatch && method === "GET") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    sendJson(response, 200, await getPlatformPrompt(promptMatch[1]));
    return true;
  }
  if (promptMatch && method === "PATCH") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    const payload = await readJsonBody<any>(request);
    sendJson(response, 200, await updatePlatformPrompt(promptMatch[1], payload));
    return true;
  }

  const promptPublishMatch = url.pathname.match(/^\/platform\/prompts\/([a-zA-Z0-9_-]+)\/publish$/);
  if (promptPublishMatch && method === "POST") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    sendJson(response, 200, await publishPlatformPrompt(promptPublishMatch[1]));
    return true;
  }

  const promptRollbackMatch = url.pathname.match(/^\/platform\/prompts\/([a-zA-Z0-9_-]+)\/rollback$/);
  if (promptRollbackMatch && method === "POST") {
    const session = requirePlatformAccessSession(request);
    requirePlatformSuperadmin(session);
    sendJson(response, 200, await rollbackPlatformPrompt(promptRollbackMatch[1]));
    return true;
  }

  return false;
}
