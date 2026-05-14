/**
 * Helpers de presentación: siempre mostrar el NOMBRE legible del buque /
 * activo, no el código técnico.
 *
 * Ver memory/feedback_ui_names_over_codes.md (regla global del proyecto).
 *
 * - <VesselLabel code={vesselCode} /> → "DON CHICUETO" usando lookup en
 *   useVesselContext(); si no hay nombre, fallback al código.
 *
 * - <AssetLabel id={assetId} fallbackName={name?} /> → "Bomba PB-01"
 *   si la entidad parent ya trajo `assetName` se prefiere ese (sin lookup).
 *   Si no, intenta lookup contra el endpoint /app/pms/assets (cacheado).
 *
 * - useAssetsCache() / getAssetName(id) → primitivos para tablas que ya
 *   tienen su propio render y quieren resolver el name sin montar el helper.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useVesselContext } from "../lib/vessel-context";
import { api } from "../lib/api";

// ─── Vessel ──────────────────────────────────────────────────────────────────

interface VesselLabelProps {
  code: string | null | undefined;
  /** Si se pasa, se prefiere por sobre el lookup. */
  name?: string | null;
  /** Tamaño del texto principal. Default "text-xs". */
  className?: string;
  /** Mostrar el código como badge mono secundario al lado. Default false. */
  showCode?: boolean;
}

export const VesselLabel: React.FC<VesselLabelProps> = ({ code, name, className, showCode = false }) => {
  const { vessels } = useVesselContext();
  const resolved = name ?? (code ? vessels.find(v => v.code === code)?.name : null) ?? null;

  if (!code && !resolved) return <span className="text-text-industrial/30 text-xs">—</span>;

  if (!resolved) {
    return <span className={`font-mono text-accent ${className ?? "text-xs"}`} title={code ?? undefined}>{code}</span>;
  }

  return (
    <span className={`${className ?? "text-xs"} text-white inline-flex items-center gap-1.5`} title={code ?? undefined}>
      <span className="font-medium">{resolved}</span>
      {showCode && code && (
        <span className="font-mono text-[9px] text-accent/70">{code}</span>
      )}
    </span>
  );
};

// ─── Asset ───────────────────────────────────────────────────────────────────

interface AssetCacheEntry { id: string; name: string | null; sfiCode?: string | null }

let __assetsCachePromise: Promise<Map<string, AssetCacheEntry>> | null = null;
let __assetsCache: Map<string, AssetCacheEntry> = new Map();

async function loadAssetsCache(): Promise<Map<string, AssetCacheEntry>> {
  if (__assetsCachePromise) return __assetsCachePromise;
  __assetsCachePromise = api.get<{ items: AssetCacheEntry[] }>("/app/pms/assets")
    .then(r => {
      const m = new Map<string, AssetCacheEntry>();
      for (const a of r.items ?? []) m.set(a.id, a);
      __assetsCache = m;
      return m;
    })
    .catch(() => {
      __assetsCachePromise = null;
      return new Map<string, AssetCacheEntry>();
    });
  return __assetsCachePromise;
}

/**
 * Hook que asegura que el cache esté cargado. Útil para tablas que llaman
 * `getAssetName(id)` en cada render — el primer mount dispara la carga.
 */
export function useAssetsCache(): { ready: boolean; cache: Map<string, AssetCacheEntry> } {
  const [ready, setReady] = useState(__assetsCache.size > 0);
  useEffect(() => {
    if (__assetsCache.size > 0) { setReady(true); return; }
    let cancelled = false;
    void loadAssetsCache().then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);
  return { ready, cache: __assetsCache };
}

export function getAssetName(id: string | null | undefined): string | null {
  if (!id) return null;
  return __assetsCache.get(id)?.name ?? null;
}

interface AssetLabelProps {
  id: string | null | undefined;
  /** Si la entidad parent ya trajo assetName, evita el lookup. */
  fallbackName?: string | null;
  className?: string;
}

/** Versión simple usable en cualquier render. Si el name no se resolvió devuelve "—" (no muestra el id). */
export const AssetLabel: React.FC<AssetLabelProps> = ({ id, fallbackName, className }) => {
  useAssetsCache();
  const name = fallbackName ?? (id ? getAssetName(id) : null);
  if (!name) return <span className="text-text-industrial/30 text-xs">—</span>;
  return <span className={className ?? "text-xs text-white"} title={id ?? undefined}>{name}</span>;
};
