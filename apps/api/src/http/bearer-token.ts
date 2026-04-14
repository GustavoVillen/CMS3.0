import type { IncomingMessage } from "node:http";

export function getBearerToken(request: IncomingMessage): string | null {
  const authorization = String(request.headers.authorization || "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;

  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}
