import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { getProfile, updateProfile, changePassword } from "./profile-service";

export async function handleProfileRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) return false;
  const session = requireTenantAccessSession(request, slug);

  if (method === "GET" && url.pathname === "/app/profile") {
    sendJson(response, 200, await getProfile(session));
    return true;
  }

  if (method === "PATCH" && url.pathname === "/app/profile") {
    const body = await readJsonBody<{ firstName?: string; lastName?: string; preferredLocale?: string }>(request);
    sendJson(response, 200, await updateProfile(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/profile/change-password") {
    const body = await readJsonBody<{ currentPassword: string; newPassword: string }>(request);
    await changePassword(session, body);
    sendJson(response, 200, { ok: true });
    return true;
  }

  return false;
}
