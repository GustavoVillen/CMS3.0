/**
 * Servido de archivos estáticos: la SPA de web-modern y la vieja web-legacy.
 *
 * IO-001 (auditoría 2026-09-09). Antes cada archivo se leía con `readFileSync`
 * DENTRO del handler HTTP. Node atiende todo con un solo hilo: mientras dura
 * esa lectura el proceso no contesta ninguna otra request —ni las de la API—,
 * y además cargaba el archivo entero en memoria antes de mandar el primer byte.
 * Se nota en el arranque en frío, con el disco lento o con archivos grandes.
 *
 * Ahora: `stat` asíncrono para saber si existe (el contrato de "devolvé false y
 * que el llamador siga" se mantiene) y `createReadStream` + `pipeline` para
 * mandarlo por partes, sin materializarlo. MIME, cabeceras de caché y el
 * fallback a la SPA quedan igual; se agrega Content-Length, que ya se sabe.
 *
 * En producción esto lo debería servir la infraestructura (CDN/nginx) y no la
 * API. Cambiar eso es una decisión de despliegue y no se tocó.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join, extname, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";
import { applySecurityHeaders } from "./security-headers";

// Resolve public dir relative to this file: apps/api/src/http → apps/web-legacy/public
const WEB_LEGACY_PUBLIC = resolve(join(__dirname, "../../../web-legacy/public"));

// web-modern Vite build output
const WEB_MODERN_DIST = resolve(join(__dirname, "../../../web-modern/dist"));

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
 * Resuelve `<raíz>/<relativa>` y comprueba que el resultado siga DENTRO de la
 * raíz. Devuelve null si se escapa.
 *
 * El parser de URL de Node ya normaliza los `..` del pathname, así que hoy no
 * había por dónde salirse. Igual se comprueba acá: es la única defensa que no
 * depende de cómo llame el llamador, y esta función pasó a resolver rutas.
 */
function safeJoin(root: string, relativePath: string): string | null {
  // Un path absoluto ("/etc/passwd", "C:\\...") haría que join lo ignore la raíz.
  const rel = String(relativePath ?? "").replace(/^[/\\]+/, "");
  if (!rel) return null;
  if (rel.includes("\0")) return null;

  const full = resolve(join(root, rel));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

/** Manda un archivo por partes. Asume que ya se comprobó que existe. */
async function streamFile(
  response: ServerResponse,
  filePath: string,
  headers: Record<string, string | number>,
): Promise<void> {
  const stream = createReadStream(filePath);
  response.writeHead(200, headers);
  try {
    await pipeline(stream, response);
  } catch {
    // Se cortó a mitad de camino (el cliente se fue, o falló el disco). Las
    // cabeceras ya salieron: lo único que queda es cerrar la conexión.
    if (!response.writableEnded) response.destroy();
  }
}

/** Tamaño del archivo, o null si no existe o no es un archivo. */
async function fileSize(filePath: string): Promise<number | null> {
  try {
    const info = await stat(filePath);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

/**
 * Try to serve a file from apps/web-legacy/public/<relativePath>.
 * Returns true if served, false if the file does not exist.
 */
export async function serveStaticFile(response: ServerResponse, relativePath: string): Promise<boolean> {
  const filePath = safeJoin(WEB_LEGACY_PUBLIC, relativePath);
  if (!filePath) return false;

  const size = await fileSize(filePath);
  if (size === null) return false;

  applySecurityHeaders(response);
  await streamFile(response, filePath, {
    "Content-Type":   mimeFor(relativePath),
    "Content-Length": size,
    "Cache-Control":  "no-cache",
  });
  return true;
}

/**
 * Serve a static asset from the web-modern Vite dist folder.
 * Returns true if served, false if not found (caller falls through to SPA html).
 */
export async function serveWebModernAsset(response: ServerResponse, relativePath: string): Promise<boolean> {
  const filePath = safeJoin(WEB_MODERN_DIST, relativePath);
  if (!filePath) return false;

  const size = await fileSize(filePath);
  if (size === null) return false;

  const isImmutable = relativePath.startsWith("static/");
  await streamFile(response, filePath, {
    "Content-Type":   mimeFor(relativePath),
    "Content-Length": size,
    "Cache-Control":  isImmutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  return true;
}

/**
 * Serve the web-modern SPA index.html (React app entry point).
 * Used as catch-all for any browser navigation not handled by the API.
 */
export async function serveWebModernSpa(response: ServerResponse): Promise<void> {
  const filePath = join(WEB_MODERN_DIST, "index.html");
  const size = await fileSize(filePath);
  if (size === null) {
    response.writeHead(503, { "Content-Type": "text/plain" });
    response.end("Frontend not built. Run: pnpm build:web\n");
    return;
  }

  applySecurityHeaders(response);
  await streamFile(response, filePath, {
    "Content-Type":   "text/html; charset=utf-8",
    "Content-Length": size,
    "Cache-Control":  "no-cache",
  });
}

/**
 * Serve the SPA index.html (for browser navigation to /ui/*).
 * Falls back to a plain-text error if the file is not found (bundle not built yet).
 */
export async function serveSpaHtml(response: ServerResponse): Promise<void> {
  const filePath = join(WEB_LEGACY_PUBLIC, "index.html");
  const size = await fileSize(filePath);
  if (size === null) {
    response.writeHead(503, { "Content-Type": "text/plain" });
    response.end(
      "Frontend not built.\nRun: pnpm --filter @cms3/web-legacy build\n" +
      "Then restart the API server."
    );
    return;
  }

  applySecurityHeaders(response);
  await streamFile(response, filePath, {
    "Content-Type":   "text/html; charset=utf-8",
    "Content-Length": size,
    "Cache-Control":  "no-cache",
  });
}

/** Exportado sólo para pruebas: la contención dentro del directorio público. */
export const __test = { safeJoin, WEB_MODERN_DIST, WEB_LEGACY_PUBLIC };
