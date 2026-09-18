import type { IncomingMessage } from "node:http";

/**
 * Host de reserva cuando el header `Host` no forma una autoridad válida.
 * Sólo se usa para poder parsear el path: ninguna ruta decide nada en base
 * al host (el tenant sale del header `x-tenant-slug` / bootstrap).
 */
const FALLBACK_HOST = "localhost";

/**
 * Parsea la URL del request SIN lanzar nunca.
 *
 * `new URL(path, "http://" + host)` tira `ERR_INVALID_URL` con cualquier
 * `Host` malformado — `a b`, `[oops`, `foo:bar:baz`, vacío… El header lo
 * controla el cliente y el parser HTTP de Node lo deja pasar, así que la
 * excepción se disparaba dentro del callback async de `createServer` y
 * terminaba en un unhandled rejection (auditoría 2026-09-09). Devolver
 * `null` deja que el llamador conteste 400 en vez de tumbar el proceso.
 */
export function parseRequestUrl(request: IncomingMessage): URL | null {
  const host = String(request.headers.host || FALLBACK_HOST);
  const path = String(request.url || "/");
  try {
    return new URL(path, `http://${host}`);
  } catch {
    return null;
  }
}

/**
 * Origen público del sitio tal como lo ve el navegador (`https://empresa.cms3…`).
 *
 * Se arma con el `Host` del request porque cada empresa es un subdominio y
 * nginx lo preserva. `APP_PUBLIC_BASE_URL` lo pisa para desarrollo local, donde
 * el navegador habla con Vite (5174) y el proxy reescribe el host a 3106.
 * Lo usa el ida y vuelta con Google del archivo de PDFs, que necesita una
 * dirección de retorno exacta.
 */
export function getPublicOrigin(request: IncomingMessage): string {
  const host = String(request.headers.host || FALLBACK_HOST);
  const isLocal = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  // El override sólo vale en local: en el servidor cada empresa es un subdominio
  // distinto y una dirección fija le erraría a todas menos a una.
  const configured = String(process.env.APP_PUBLIC_BASE_URL ?? "").trim();
  if (isLocal && configured) return configured.replace(/\/+$/, "");
  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto = typeof forwardedProto === "string" && forwardedProto
    ? forwardedProto.split(",")[0].trim()
    : isLocal ? "http" : "https";
  return `${proto}://${host}`;
}

/**
 * Igual que `parseRequestUrl` pero siempre devuelve una URL: si el `Host`
 * es inválido cae a `localhost`. Para llamadores que ya corren dentro de un
 * handler y sólo necesitan el pathname / query.
 */
export function getRequestUrl(request: IncomingMessage): URL {
  const parsed = parseRequestUrl(request);
  if (parsed) return parsed;
  const path = String(request.url || "/");
  try {
    return new URL(path, `http://${FALLBACK_HOST}`);
  } catch {
    // El path tampoco parsea (caso patológico): devolvemos la raíz.
    return new URL("/", `http://${FALLBACK_HOST}`);
  }
}
