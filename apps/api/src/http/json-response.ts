import { gzip } from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";
import { applySecurityHeaders } from "./security-headers";

// Umbral de compresión: por debajo de esto el CPU del gzip no compensa.
const GZIP_MIN_BYTES = 1400;

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  // Pasar el request habilita compresión gzip si el cliente la acepta y el
  // payload es grande (listas). Respuestas SSE NO usan sendJson, así que el
  // streaming del copiloto no se ve afectado.
  req?: IncomingMessage,
): void {
  applySecurityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  const body = JSON.stringify(payload);
  const acceptsGzip = !!req && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));

  if (acceptsGzip && Buffer.byteLength(body) > GZIP_MIN_BYTES) {
    response.setHeader("Vary", "Accept-Encoding");
    gzip(body, (err, gz) => {
      if (err) { response.end(body); return; }
      response.setHeader("Content-Encoding", "gzip");
      response.end(gz);
    });
    return;
  }

  response.end(body);
}
