/**
 * HTTP usage tracking — measures request/response bytes per authenticated request.
 * Used to estimate satellite link cost per user.
 *
 * Approach:
 *   - Wraps `response.write` and `response.end` to count bytes flushed.
 *   - Reads `Content-Length` header for request body size (covers ~100% of
 *     real client traffic — browsers always set it; chunked uploads are rare).
 *   - On `response.finish`, resolves the session from the Authorization header
 *     and records a UsageEvent. Public/unauth requests are skipped.
 *
 * Non-blocking: failures never break the response.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getTenantAccessSession } from "../tenant/auth/session-store";
import { getPrismaClient } from "../platform/data/prisma-client";
import { recordHttpUsage } from "../tenant/usage/usage-service";
import { getClientIp } from "./client-ip";

function parseAuthBearer(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return m ? m[1].trim() : null;
}

function readContentLength(headerValue: string | string[] | undefined): number {
  if (!headerValue) return 0;
  const v = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function extractVesselCode(req: IncomingMessage, urlPathname: string, urlSearch: URLSearchParams): string | null {
  // 1. Query string ?vesselCode=
  const qs = urlSearch.get("vesselCode");
  if (qs) return qs.toUpperCase();
  // 2. Header X-Vessel-Code (used by some endpoints)
  const hdr = req.headers["x-vessel-code"];
  if (hdr) {
    const v = Array.isArray(hdr) ? hdr[0] : hdr;
    if (v) return String(v).toUpperCase();
  }
  // 3. Path segment /vessels/:code/...
  const m = /^\/app\/vessels\/([^/?]+)/.exec(urlPathname);
  if (m && m[1]) return m[1].toUpperCase();
  return null;
}

/**
 * Attaches the byte-counting wrappers + finish-time hook.
 * Call once at the start of every request, before any handler logic.
 */
export function attachUsageTracking(request: IncomingMessage, response: ServerResponse): void {
  const startedAt = Date.now();
  const bytesIn = readContentLength(request.headers["content-length"]);
  let bytesOut = 0;

  const origWrite = response.write.bind(response);
  const origEnd = response.end.bind(response);

  response.write = function patchedWrite(chunk?: any, ...rest: any[]): boolean {
    if (chunk) {
      bytesOut += chunkLen(chunk, rest[0]);
    }
    return origWrite(chunk, ...rest);
  } as typeof response.write;

  response.end = function patchedEnd(chunk?: any, ...rest: any[]): ServerResponse {
    if (chunk) {
      bytesOut += chunkLen(chunk, rest[0]);
    }
    return origEnd(chunk, ...rest);
  } as typeof response.end;

  response.on("finish", () => {
    try {
      const token = parseAuthBearer(request.headers.authorization as string | undefined);
      if (!token) return; // unauthenticated request — skip
      const session = getTenantAccessSession(token);
      if (!session) return; // not a tenant session (could be platform — skip for now)

      // Resolve tenantId asynchronously without blocking
      const url = parseUrlSafe(request.url, request.headers.host);
      const route = url?.pathname ?? request.url ?? "";
      const search = url?.searchParams ?? new URLSearchParams();
      const vesselCode = extractVesselCode(request, route, search);

      void (async () => {
        const prisma = getPrismaClient();
        if (!prisma) return;
        const tenant = await (prisma as any).tenant.findUnique({
          where: { slug: session.tenantSlug },
          select: { id: true },
        });
        if (!tenant) return;

        recordHttpUsage({
          tenantId:    tenant.id,
          tenantSlug:  session.tenantSlug,
          userId:      session.user.id,
          userEmail:   session.user.email,
          vesselCode,
          route,
          method:      String(request.method ?? "GET").toUpperCase(),
          statusCode:  response.statusCode,
          bytesIn,
          bytesOut,
          latencyMs:   Date.now() - startedAt,
          ipAddress:   getClientIp(request),
        });
      })().catch(() => { /* swallow */ });
    } catch {
      /* never break the response */
    }
  });
}

function chunkLen(chunk: unknown, encoding?: unknown): number {
  if (Buffer.isBuffer(chunk)) return chunk.length;
  if (typeof chunk === "string") return Buffer.byteLength(chunk, (encoding as BufferEncoding) ?? "utf8");
  return 0;
}

function parseUrlSafe(rawUrl: string | undefined, host: string | string[] | undefined): URL | null {
  if (!rawUrl) return null;
  try {
    const hostStr = Array.isArray(host) ? host[0] : (host ?? "localhost");
    return new URL(rawUrl, `http://${hostStr}`);
  } catch {
    return null;
  }
}
