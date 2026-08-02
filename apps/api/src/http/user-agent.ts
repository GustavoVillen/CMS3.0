import type { IncomingMessage } from "node:http";

/**
 * Helpers de User-Agent para la consola de accesos del SUPERADMIN.
 *
 * `readUserAgent` extrae el header crudo (acotado, porque es texto que manda el
 * cliente y va a parar a la base). `describeUserAgent` lo resume a algo legible
 * — "Chrome / Windows" — para no mostrar el chorizo completo en la tabla.
 *
 * El parser es deliberadamente mínimo: cubre lo que realmente usa la tripulación
 * y la oficina. No pretende ser exhaustivo ni justifica sumar una dependencia.
 */

const MAX_UA_LENGTH = 512;

export function readUserAgent(request: IncomingMessage): string | null {
  const raw = request.headers["user-agent"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const ua = String(value ?? "").trim();
  if (!ua) return null;
  return ua.length > MAX_UA_LENGTH ? ua.slice(0, MAX_UA_LENGTH) : ua;
}

function detectBrowser(ua: string): string | null {
  // El orden importa: Edge y Opera también dicen "Chrome" en su User-Agent.
  if (/\bEdgA?\//i.test(ua)) return "Edge";
  if (/\bOPR\/|\bOpera\//i.test(ua)) return "Opera";
  if (/\bSamsungBrowser\//i.test(ua)) return "Samsung Internet";
  if (/\bFirefox\/|\bFxiOS\//i.test(ua)) return "Firefox";
  if (/\bChrome\/|\bCriOS\//i.test(ua)) return "Chrome";
  if (/\bSafari\//i.test(ua)) return "Safari";
  return null;
}

function detectPlatform(ua: string): string | null {
  if (/\biPhone\b/i.test(ua)) return "iPhone";
  if (/\biPad\b/i.test(ua)) return "iPad";
  if (/\bAndroid\b/i.test(ua)) return "Android";
  if (/\bWindows NT\b/i.test(ua)) return "Windows";
  if (/\bMac OS X\b|\bMacintosh\b/i.test(ua)) return "macOS";
  if (/\bLinux\b/i.test(ua)) return "Linux";
  return null;
}

/** Devuelve "Chrome / Windows", "Safari / iPhone", o null si no se reconoce. */
export function describeUserAgent(raw: string | null | undefined): string | null {
  const ua = String(raw ?? "").trim();
  if (!ua) return null;
  const browser = detectBrowser(ua);
  const platform = detectPlatform(ua);
  if (browser && platform) return `${browser} / ${platform}`;
  return browser ?? platform ?? null;
}

/** True cuando el acceso vino de un celular o tablet. */
export function isMobileUserAgent(raw: string | null | undefined): boolean {
  return /\bMobi|\biPhone\b|\biPad\b|\bAndroid\b/i.test(String(raw ?? ""));
}
