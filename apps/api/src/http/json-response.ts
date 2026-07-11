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
  // Fallback a response.req (Node siempre lo expone en respuestas del server) para
  // que la compresión aplique a TODAS las respuestas grandes, no sólo a los pocos
  // call-sites que pasan `req` explícito. SSE no usa sendJson → no se ve afectado.
  const httpReq = req ?? response.req;
  const acceptsGzip = !!httpReq && /\bgzip\b/.test(String(httpReq.headers["accept-encoding"] ?? ""));

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
