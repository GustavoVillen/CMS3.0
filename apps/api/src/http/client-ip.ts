import type { IncomingMessage } from "node:http";

/**
 * Helper compartido para extraer la IP del cliente desde un request HTTP.
 *
 * Los headers X-Forwarded-For / X-Real-IP los puede setear CUALQUIER cliente:
 * validar su formato como IP no evita el spoofing (un atacante manda una IP
 * válida distinta en cada request y evade el rate-limit por IP, incluido el de
 * login). Por eso solo se confía en ellos cuando estamos detrás de un proxy de
 * confianza que los reescribe — señalado con TRUST_PROXY_HEADERS=1.
 *
 *  - TRUST_PROXY_HEADERS=1 (prod detrás de nginx): usa el primer XFF / X-Real-IP
 *    válido; si no hay, cae al socket.
 *  - Sin el flag (default seguro): ignora esos headers y usa siempre el socket
 *    address. Fail-safe: si el flag falta en prod, el rate-limit agrupa el
 *    tráfico bajo la IP del proxy (más restrictivo), nunca menos.
 */

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+(%[0-9a-zA-Z]+)?$/;

function trustsProxyHeaders(): boolean {
  const v = process.env.TRUST_PROXY_HEADERS;
  return v === "1" || v === "true";
}

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
  if (trustsProxyHeaders()) {
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
  }
  const sock = request.socket?.remoteAddress;
  return sock && sock.length > 0 ? sock : null;
}
