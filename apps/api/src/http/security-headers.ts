import type { ServerResponse } from "node:http";

/**
 * Centralized security headers applied to every response.
 *
 * - HSTS: forces HTTPS for 1 year + subdomains. Safe to enable because the
 *   app runs behind Nginx that already terminates TLS for shipcms.cloud.
 * - X-Content-Type-Options: blocks MIME-type sniffing.
 * - X-Frame-Options: prevents clickjacking via iframe embedding.
 * - Referrer-Policy: avoids leaking full URLs to external sites.
 * - Permissions-Policy: denies access to sensitive browser APIs by default.
 * - CSP: enforced. Allows the third-party origins the SPA actually uses
 *   (Google Fonts, Leaflet from unpkg, OpenStreetMap tiles + iframe).
 *   New violations are still POSTed to /internal/csp-report and logged
 *   as "[csp-violation]" so we can spot regressions.
 */

const CSP_VALUE = [
  "default-src 'self'",
  // Vite bundle inlines code and uses eval; Leaflet is loaded from unpkg
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com",
  // Tailwind + Google Fonts stylesheet + Leaflet CSS
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
  // data: for tenant logos, blob: for previews, OSM tiles, Leaflet marker assets
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com",
  // Google Fonts ttf/woff
  "font-src 'self' data: https://fonts.gstatic.com",
  // /app/* and /platform/* on same origin only
  "connect-src 'self'",
  // SpeechSynthesis blobs
  "media-src 'self' blob:",
  // OpenStreetMap embed iframe
  "frame-src https://www.openstreetmap.org",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "report-uri /internal/csp-report",
].join("; ");

const PERMISSIONS_POLICY_VALUE = [
  "camera=()",
  "microphone=(self)",      // mobile copilot uses SpeechRecognition
  "geolocation=(self)",     // daily reports use navigator.geolocation for "Obtener GPS"
  "payment=()",
  "usb=()",
  "interest-cohort=()",
].join(", ");

export function applySecurityHeaders(response: ServerResponse): void {
  if (response.headersSent) return;

  // HSTS — only meaningful when served via HTTPS. Nginx in front does the TLS termination.
  response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", PERMISSIONS_POLICY_VALUE);

  // CSP enforced. Violations also POST to /internal/csp-report so we can
  // spot regressions in pm2 logs ([csp-violation]).
  response.setHeader("Content-Security-Policy", CSP_VALUE);
}
