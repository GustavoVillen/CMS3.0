import type { IncomingMessage } from "node:http";
import { RouteError } from "../../http/route-error";
import { getBearerToken } from "../../http/bearer-token";
import { getPlatformAccessSession } from "../../tenant/auth/session-store";

export function requirePlatformAccessSession(request: IncomingMessage) {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    throw new RouteError(401, "AUTH_MISSING_BEARER_TOKEN", "Bearer token is required.");
  }

  const session = getPlatformAccessSession(accessToken);
  if (!session) {
    throw new RouteError(401, "AUTH_INVALID_ACCESS_TOKEN", "Access token is invalid.");
  }

  return session;
}

export function requirePlatformSuperadmin(session: { user: { role: string } }) {
  if (session.user.role !== "SUPERADMIN") {
    throw new RouteError(403, "AUTH_FORBIDDEN", "Superadmin role is required.");
  }

  return session;
}
