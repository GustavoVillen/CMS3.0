// Cache en memoria para useFetch (stale-while-revalidate). Módulo sin React ni
// otras deps de la lib → evita ciclos de import (auth/hooks/vessel-context).
//
// Multitenant: la key se prefija con el tenant slug → NUNCA mezcla datos entre
// tenants. Se limpia en logout (clearFetchCache) para no exponer datos de un
// usuario al siguiente.

export type FetchCacheEntry = { data: unknown; ts: number };

export const fetchCache = new Map<string, FetchCacheEntry>();
export const inFlight = new Map<string, Promise<unknown>>();
export const FETCH_STALE_MS = 30_000;

export function fetchCacheKey(path: string): string {
  let slug = "";
  try { slug = localStorage.getItem("gpms_tenant_slug") ?? ""; } catch { /* noop */ }
  return `${slug}::${path}`;
}

/** Limpia el cache de useFetch. Llamar en logout para no filtrar datos entre sesiones. */
export function clearFetchCache(): void {
  fetchCache.clear();
  inFlight.clear();
}
