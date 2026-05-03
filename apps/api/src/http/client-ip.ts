import type { IncomingMessage } from "node:http";

/**
 * Helper compartido para extraer la IP del cliente desde un request HTTP.
 * Reglas (idénticas a las del rate-limiter):
 *  - Trusts X-Forwarded-For / X-Real-IP solo si el valor parsea como IP válida.
 *  - Si el app está expuesto sin nginx adelante, cualquier cliente puede setear
 *    estos headers — validamos formato para que no se pueda spoofear cualquier
 *    string.
 *  - Fallback al socket address.
 */

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+(%[0-9a-zA-Z]+)?$/;

function isValidIp(s: string): boolean {
  if (!s) return false;
  if (IPV4_RE.test(s)) {
    return s.split(".").every((o) => {
      const n = Number(o);
      return n >= 0 && n <= 255;
    });
  }
  return IPV6_RE.test(s) && s.length <= 45;
}

export function getClientIp(request: IncomingMessage): string | null {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0].trim();
    if (isValidIp(first)) return first;
  }
  const realIp = request.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0) {
    const v = realIp.trim();
    if (isValidIp(v)) return v;
  }
  const sock = request.socket?.remoteAddress;
  return sock && sock.length > 0 ? sock : null;
}
