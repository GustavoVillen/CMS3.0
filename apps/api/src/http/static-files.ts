/**
 * Minimal static file handler for the web-legacy SPA.
 * Serves files from apps/web-legacy/public/ at the given path.
 * Returns false if the file cannot be read (caller should 404 or fall through).
 */

import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import type { ServerResponse } from "node:http";
import { applySecurityHeaders } from "./security-headers";

// Resolve public dir relative to this file: apps/api/src/http → apps/web-legacy/public
const WEB_LEGACY_PUBLIC = join(__dirname, "../../../web-legacy/public");

// web-modern Vite build output
const WEB_MODERN_DIST = join(__dirname, "../../../web-modern/dist");

function mimeFor(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".js":   "application/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".png":  "image/png",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon",
    ".json": "application/json",
    ".map":  "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * Try to serve a file from apps/web-legacy/public/<relativePath>.
 * Returns true if served, false if the file does not exist.
 */
export function serveStaticFile(response: ServerResponse, relativePath: string): boolean {
  try {
    const filePath = join(WEB_LEGACY_PUBLIC, relativePath);
    const content  = readFileSync(filePath);
    const mime     = mimeFor(relativePath);
    applySecurityHeaders(response);
    response.writeHead(200, {
      "Content-Type":  mime,
      "Cache-Control": "no-cache",
    });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serve a static asset from the web-modern Vite dist folder.
 * Returns true if served, false if not found (caller falls through to SPA html).
 */
export function serveWebModernAsset(response: ServerResponse, relativePath: string): boolean {
  try {
    const filePath = join(WEB_MODERN_DIST, relativePath);
    const content  = readFileSync(filePath);
    const mime     = mimeFor(relativePath);
    const isImmutable = relativePath.startsWith("assets/");
    response.writeHead(200, {
      "Content-Type":  mime,
      "Cache-Control": isImmutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serve the web-modern SPA index.html (React app entry point).
 * Used as catch-all for any browser navigation not handled by the API.
 */
export function serveWebModernSpa(response: ServerResponse): void {
  try {
    const html = readFileSync(join(WEB_MODERN_DIST, "index.html"));
    applySecurityHeaders(response);
    response.writeHead(200, {
      "Content-Type":  "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    response.end(html);
  } catch {
    response.writeHead(503, { "Content-Type": "text/plain" });
    response.end("Frontend not built. Run: pnpm build:web\n");
  }
}

/**
 * Serve the SPA index.html (for browser navigation to /ui/*).
 * Falls back to a plain-text error if the file is not found (bundle not built yet).
 */
export function serveSpaHtml(response: ServerResponse): void {
  try {
    const html = readFileSync(join(WEB_LEGACY_PUBLIC, "index.html"));
    applySecurityHeaders(response);
    response.writeHead(200, {
      "Content-Type":  "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    response.end(html);
  } catch {
    response.writeHead(503, { "Content-Type": "text/plain" });
    response.end(
      "Frontend not built.\nRun: pnpm --filter @cms3/web-legacy build\n" +
      "Then restart the API server."
    );
  }
}
