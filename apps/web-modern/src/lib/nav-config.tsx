import { useState, useEffect } from "react";
import { api } from "./api";

// Configuración del menú lateral (tenant-wide). El backend guarda los paths
// OCULTOS; el sidebar y la página de Configuración los consumen desde acá.
//
// Patrón anti-parpadeo: se cachea el último valor conocido en localStorage
// (por tenant) y se lee sync en el primer render; luego se refresca por red.
// Un evento global permite que el sidebar reaccione al instante cuando el admin
// guarda desde Configuración (mismo patrón que "ai-usage:changed").

const CHANGED_EVENT = "nav-config:changed";

function cacheKey(): string {
  const slug = localStorage.getItem("gpms_tenant_slug") ?? "";
  return `gpms_nav_hidden_${slug}`;
}

function readCache(): string[] {
  try {
    const raw = localStorage.getItem(cacheKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function writeCache(paths: string[]) {
  try { localStorage.setItem(cacheKey(), JSON.stringify(paths)); } catch { /* ignore */ }
}

/** Trae la config actual del backend (paths ocultos). Fail-safe: [] si falla. */
export async function fetchHiddenNavPaths(): Promise<string[]> {
  try {
    const res = await api.get<{ hiddenNavPaths: string[] }>("/app/tenant/nav-config");
    const paths = Array.isArray(res.hiddenNavPaths) ? res.hiddenNavPaths : [];
    writeCache(paths);
    return paths;
  } catch {
    return readCache();
  }
}

/** Guarda la config (solo TENANT_ADMIN en el backend) y avisa al sidebar. */
export async function saveHiddenNavPaths(paths: string[]): Promise<string[]> {
  const res = await api.patch<{ hiddenNavPaths: string[] }>("/app/tenant/nav-config", {
    hiddenNavPaths: paths,
  });
  const saved = Array.isArray(res.hiddenNavPaths) ? res.hiddenNavPaths : [];
  writeCache(saved);
  window.dispatchEvent(new Event(CHANGED_EVENT));
  return saved;
}

/** Hook para el sidebar: paths ocultos, refrescados por red y por evento. */
export function useHiddenNavPaths(): string[] {
  const [hidden, setHidden] = useState<string[]>(readCache);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetchHiddenNavPaths().then((paths) => { if (!cancelled) setHidden(paths); });
    };
    refresh();
    window.addEventListener(CHANGED_EVENT, refresh);
    return () => { cancelled = true; window.removeEventListener(CHANGED_EVENT, refresh); };
  }, []);

  return hidden;
}
