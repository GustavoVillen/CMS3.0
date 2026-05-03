import type { IncomingMessage } from "node:http";
import { RouteError } from "./route-error";
import { getClientIp as getClientIpRaw } from "./client-ip";

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

function getClientIp(request: IncomingMessage): string {
  return getClientIpRaw(request) ?? "unknown";
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
