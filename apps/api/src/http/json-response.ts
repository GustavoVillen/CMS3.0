import type { ServerResponse } from "node:http";
import { applySecurityHeaders } from "./security-headers";

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  applySecurityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}
