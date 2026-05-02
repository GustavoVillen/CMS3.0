import type { IncomingMessage } from "node:http";
import { RouteError } from "./route-error";

/**
 * In-memory sliding-window rate limiter, scoped per (bucket, client IP).
 *
 * For low-volume, single-instance deployments. If the app is ever clustered
 * or moved to a multi-instance setup, replace with Redis or DB-backed counts.
 */

const buckets = new Map<string, number[]>();

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

// Aceptamos IPv4 y IPv6 (incluido formato compacto/zone-id básico). Cualquier
// header con valor que no matchea esto se ignora — defensa contra clientes
// que mandan "X-Forwarded-For: 999.999.999.999" para diluir el rate limit
// con buckets-fantasma.
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

/**
 * Extract the client IP. Trusts X-Forwarded-For / X-Real-IP solo si el valor
 * parsea como IP válida. Si el app está expuesto sin nginx adelante, cualquier
 * cliente puede setear estos headers — al menos validamos formato para que el
 * key del bucket no sea controlable arbitrariamente.
 */
function getClientIp(request: IncomingMessage): string {
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
  return request.socket?.remoteAddress ?? "unknown";
}

/**
 * Records the current request and throws RouteError(429) if the IP has
 * exceeded `maxRequests` within the rolling `windowMs` window for the
 * given bucket name (e.g. "auth:platform-login", "auth:tenant-login").
 */
export function enforceRateLimit(
  request: IncomingMessage,
  bucket: string,
  config: RateLimitConfig,
): void {
  const ip = getClientIp(request);
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const cutoff = now - config.windowMs;

  const timestamps = buckets.get(key) ?? [];
  const recent = timestamps.filter((t) => t > cutoff);

  if (recent.length >= config.maxRequests) {
    const retryAfter = Math.ceil(config.windowMs / 1000);
    throw new RouteError(
      429,
      "RATE_LIMIT_EXCEEDED",
      `Too many requests. Try again in ${retryAfter}s.`,
    );
  }

  recent.push(now);
  buckets.set(key, recent);
}

/** Periodic cleanup — drop entries with no recent activity. */
export function evictExpiredRateLimitBuckets(): void {
  const cutoff = Date.now() - 60 * 60 * 1000; // keep at most 1h of history
  for (const [key, timestamps] of buckets) {
    const recent = timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) buckets.delete(key);
    else buckets.set(key, recent);
  }
}
