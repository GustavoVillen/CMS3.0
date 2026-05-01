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
 * - CSP-Report-Only: monitors what would block under enforcement, without
 *   actually blocking. Run in report-only for ~1 week, review pm2 logs for
 *   "[csp-violation]", then promote to enforcing Content-Security-Policy.
 */

const CSP_REPORT_ONLY_VALUE = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Vite bundle uses inline; tighten later
  "style-src 'self' 'unsafe-inline'",                // Tailwind injects inline styles
  "img-src 'self' data: blob:",                      // data: for tenant logos, blob: for previews
  "font-src 'self' data:",
  "connect-src 'self'",                              // /app/* and /platform/* on same origin
  "media-src 'self' blob:",                          // SpeechSynthesis blobs
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

  // CSP in report-only mode. Move to "Content-Security-Policy" header
  // (without -Report-Only) once 1 week of logs shows no legitimate violations.
  response.setHeader("Content-Security-Policy-Report-Only", CSP_REPORT_ONLY_VALUE);
}
