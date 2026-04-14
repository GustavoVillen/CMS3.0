import type { IncomingMessage } from "node:http";

export function getRequestUrl(request: IncomingMessage): URL {
  const host = String(request.headers.host || "localhost");
  const path = String(request.url || "/");
  return new URL(path, `http://${host}`);
}
