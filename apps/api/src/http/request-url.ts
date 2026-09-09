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
