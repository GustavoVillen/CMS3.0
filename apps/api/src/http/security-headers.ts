import type { ServerResponse } from "node:http";
import { isDevelopmentMode } from "../common/runtime-mode";

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
 *   (Google Fonts, OpenStreetMap tiles + iframe).
 *   New violations are still POSTed to /internal/csp-report and logged
 *   as "[csp-violation]" so we can spot regressions.
 *
 * Sobre unpkg: Leaflet se empaqueta desde npm (`import L from "leaflet"`), no
 * se baja de la CDN. La única referencia que quedaba era el ícono de marcador
 * en VesselMap, ya reemplazado por el asset del bundle. Verificado sobre el
 * build de producción: no hay ninguna referencia a unpkg en dist/.
 */

function buildCsp(): string {
  // 'unsafe-eval' sólo en desarrollo: el dev server de Vite lo necesita para
  // HMR. El bundle de producción no — verificado sobre dist/: cero `eval(` y
  // cero `new Function`. Dejarlo habilitado en producción sólo servía para que
  // un XSS tuviera más herramientas a mano.
  const scriptSrc = isDevelopmentMode()
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  return [
    "default-src 'self'",
    // 'unsafe-inline' sigue siendo necesario por el script anti-parpadeo de
    // index.html, que fija el tema antes del primer pintado. Para sacarlo hay
    // que pasarlo a hash sha256 en esta cabecera, y entonces cualquier edición
    // de ese script rompe la app hasta actualizar el hash.
    scriptSrc,
    // Tailwind + Google Fonts stylesheet + Leaflet CSS (empaquetada)
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // data: for tenant logos, blob: for previews, OSM tiles
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
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
}

// Se arma una sola vez, pero en la primera respuesta y no al importar el
// módulo: así no depende del orden de carga respecto de bootstrap-env.
let cspValue: string | null = null;

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
  if (cspValue === null) cspValue = buildCsp();
  response.setHeader("Content-Security-Policy", cspValue);
}
