import type { IncomingMessage } from "node:http";
import { RouteError } from "../../http/route-error";
import { getBearerToken } from "../../http/bearer-token";
import { getTenantAccessSession } from "./session-store";

export function requireTenantAccessSession(request: IncomingMessage, tenantSlug: string) {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    throw new RouteError(401, "AUTH_MISSING_BEARER_TOKEN", "Bearer token is required.");
  }

  const session = getTenantAccessSession(accessToken);
  if (!session) {
    throw new RouteError(401, "AUTH_INVALID_ACCESS_TOKEN", "Access token is invalid.");
  }

  if (session.tenantSlug !== tenantSlug) {
    throw new RouteError(403, "TENANT_SCOPE_MISMATCH", "Access token does not belong to the resolved tenant.");
  }

  return session;
}
