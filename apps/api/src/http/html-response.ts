import type { ServerResponse } from "node:http";
import { applySecurityHeaders } from "./security-headers";

export function sendHtml(response: ServerResponse, statusCode: number, html: string): void {
  applySecurityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html);
}
