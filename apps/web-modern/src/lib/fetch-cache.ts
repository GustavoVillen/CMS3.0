// Cache en memoria para useFetch (stale-while-revalidate). Módulo sin React ni
// otras deps de la lib → evita ciclos de import (auth/hooks/vessel-context).
//
// Multitenant: la key se prefija con el usuario y el tenant slug → NUNCA mezcla
// datos entre empresas ni entre personas. Se limpia en logout.
//
// Auditoría 2026-09-09:
//
//   BUG-005 — al cerrar sesión se vaciaban los mapas, pero las requests que
//   quedaban en vuelo seguían vivas y su `.then` volvía a escribir el cache
//   DESPUÉS de la limpieza. Si entraba otra persona de la misma empresa, esos
//   datos ya estaban ahí y la key no distinguía usuarios. Ahora cada sesión
//   tiene una "generación": una respuesta de una generación anterior se
//   descarta en vez de guardarse (`cacheSet`).
//
//   MEM-001 — los 30 segundos definen si un dato está fresco, no cuándo se
//   borra: cada URL distinta (filtros, ids, buques) dejaba su entrada para
//   siempre. Ahora hay tope de entradas y se expulsa la más vieja en uso.

export type FetchCacheEntry = { data: unknown; ts: number };

export const fetchCache = new Map<string, FetchCacheEntry>();
export const inFlight = new Map<string, Promise<unknown>>();
export const FETCH_STALE_MS = 30_000;

/** Tope de entradas vivas. Se expulsa la usada hace más tiempo (LRU). */
export const FETCH_CACHE_MAX_ENTRIES = 200;

/** Una entrada más vieja que esto no se sirve ni ocupa lugar. */
export const FETCH_CACHE_TTL_MS = 10 * 60_000;

/**
 * Generación de la sesión. Sube en cada login/logout: todo lo que quedó en
 * vuelo con la generación anterior ya no puede escribir en el cache.
 */
let sessionGeneration = 0;
export function getSessionGeneration(): number { return sessionGeneration; }

// La identidad se saca de localStorage y se memoiza contra el string crudo:
// al refrescarse el token, `gpms_auth` cambia pero el id de usuario no, así que
// la key se mantiene estable y no se tira el cache en cada renovación.
let lastAuthRaw: string | null = null;
let lastIdentity = "anon";

function currentIdentity(): string {
  let raw: string | null = null;
  try { raw = localStorage.getItem("gpms_auth"); } catch { return "anon"; }
  if (raw === lastAuthRaw) return lastIdentity;

  lastAuthRaw = raw;
  lastIdentity = "anon";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { user?: { id?: string } };
      if (parsed?.user?.id) lastIdentity = String(parsed.user.id);
    } catch { /* json roto: queda "anon" */ }
  }
  return lastIdentity;
}

export function fetchCacheKey(path: string): string {
  let slug = "";
  try { slug = localStorage.getItem("gpms_tenant_slug") ?? ""; } catch { /* noop */ }
  return `${currentIdentity()}::${slug}::${path}`;
}

/**
 * Lee una entrada vigente. Devuelve `undefined` si venció el TTL duro.
 * Un acierto mueve la entrada al final: la expulsión saca lo menos usado.
 */
export function cacheGet(key: string): FetchCacheEntry | undefined {
  const entry = fetchCache.get(key);
  if (!entry) return undefined;

  if (Date.now() - entry.ts > FETCH_CACHE_TTL_MS) {
    fetchCache.delete(key);
    return undefined;
  }

  fetchCache.delete(key);
  fetchCache.set(key, entry);
  return entry;
}

/**
 * Guarda una respuesta, salvo que venga de una sesión anterior.
 *
 * @param generation  La que estaba vigente cuando se disparó la request.
 * @returns true si se guardó.
 */
export function cacheSet(key: string, data: unknown, generation: number): boolean {
  if (generation !== sessionGeneration) return false;

  fetchCache.delete(key);
  fetchCache.set(key, { data, ts: Date.now() });

  // Map itera en orden de inserción: el primero es el usado hace más tiempo.
  while (fetchCache.size > FETCH_CACHE_MAX_ENTRIES) {
    const oldest = fetchCache.keys().next();
    if (oldest.done) break;
    fetchCache.delete(oldest.value);
  }
  return true;
}

/**
 * Limpia el cache de useFetch. Llamar en logout y al entrar otra persona.
 *
 * Sube la generación: las respuestas que ya estaban pedidas llegan tarde y se
 * descartan en vez de repoblar el cache que se acaba de vaciar.
 */
export function clearFetchCache(): void {
  sessionGeneration += 1;
  lastAuthRaw = null;
  lastIdentity = "anon";
  fetchCache.clear();
  inFlight.clear();
}
