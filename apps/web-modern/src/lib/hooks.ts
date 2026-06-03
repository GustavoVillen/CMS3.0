import { useState, useEffect, useCallback, useRef, useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { api, ApiError } from "./api";
import { useVesselContext } from "./vessel-context";
import { fetchCache, inFlight, FETCH_STALE_MS, fetchCacheKey } from "./fetch-cache";

// Paths where vessel-code injection must be skipped (the vessel list itself,
// auth endpoints, and any tenant-level resources that are not vessel-scoped).
const VESSEL_SCOPE_SKIP = [
  "/app/vessels",
  "/app/me",
  "/app/auth/",
  "/app/providers",
  "/app/ai-documents",
  "/app/team",
  "/app/audit",
  "/app/excel/",
  "/app/attachments",
  "/app/copiloto",
  "/app/profile",
  "/app/ai-insights",
];

function injectVesselCode(path: string, vesselCode: string): string {
  if (VESSEL_SCOPE_SKIP.some(prefix => path.startsWith(prefix))) return path;
  const qIdx = path.indexOf("?");
  const base = qIdx === -1 ? path : path.slice(0, qIdx);
  const params = new URLSearchParams(qIdx === -1 ? "" : path.slice(qIdx + 1));
  params.set("vesselCode", vesselCode);
  return `${base}?${params.toString()}`;
}

// useFetch — wrapper de api.get con scoping automático por vessel + cache SWR.
// El cache (stale-while-revalidate) vive en ./fetch-cache: al revisitar una
// pantalla muestra el dato cacheado al instante y revalida en background si está
// vencido. `reload()` siempre trae fresco (post-mutación correcto).
//
// path puede ser null/empty para "no fetchear" — varios callers usan eso para
// hooks condicionales (ej. `initial?.id ? "/x" : null`). En ese caso el hook
// no dispara request, devuelve data=null y loading=false.
export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const { selectedVesselCode } = useVesselContext();

  const effectivePath = useMemo(() => {
    if (!path) return null;
    return selectedVesselCode ? injectVesselCode(path, selectedVesselCode) : path;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, selectedVesselCode]);

  const [data, setData]       = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!!effectivePath);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (!effectivePath) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const key = fetchCacheKey(effectivePath);
    const cached = fetchCache.get(key);
    const showFromCache = !!cached && !force;

    if (showFromCache) {
      setData(cached!.data as T);
      setError(null);
      setLoading(false);
      // Fresco → no revalidamos. Vencido → seguimos y revalidamos en background.
      if (Date.now() - cached!.ts < FETCH_STALE_MS) return;
    } else {
      setLoading(true);
      setError(null);
    }

    // Dedupe de requests idénticas en vuelo (salvo force, que siempre re-pide).
    let promise = force ? undefined : inFlight.get(key);
    if (!promise) {
      const p: Promise<unknown> = api.get<T>(effectivePath)
        .then((res) => { fetchCache.set(key, { data: res, ts: Date.now() }); return res as unknown; })
        .finally(() => { if (inFlight.get(key) === p) inFlight.delete(key); });
      promise = p;
      inFlight.set(key, p);
    }

    try {
      const res = await promise as T;
      setData(res);
      setError(null);
    } catch (err) {
      // Si ya mostramos cache, no pisamos con error (revalidación silenciosa).
      if (!showFromCache) setError(err instanceof ApiError ? err.message : "Error de carga");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePath, ...deps]);

  useEffect(() => { load(false); }, [load]);

  const reload = useCallback(() => load(true), [load]);

  return { data, loading, error, reload };
}

// ---------------------------------------------------------------------------
// useResizable — drag-to-resize panel with localStorage persistence
// ---------------------------------------------------------------------------

/**
 * Enables a panel to be resized by dragging an edge handle.
 *
 * @param lsKey  localStorage key to persist the width across sessions.
 * @param def    Default width in pixels.
 * @param min    Minimum allowed width in pixels.
 * @param max    Maximum allowed width in pixels.
 *
 * Usage:
 *   const { width, startResize } = useResizable("gpms_sidebar_width", 240, 160, 360);
 *   <aside style={{ width }}>
 *     <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize"
 *          onMouseDown={(e) => startResize(e, "right")} />
 *   </aside>
 */
export function useResizable(
  lsKey: string,
  def: number,
  min: number,
  max: number,
) {
  const [width, setWidth] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(lsKey));
      return Number.isFinite(n) && n >= min && n <= max ? n : def;
    } catch {
      return def;
    }
  });

  // Always-current ref so drag callbacks never capture stale width.
  const widthRef = useRef(width);
  widthRef.current = width;

  // Persist on change (lightweight: fires only when width actually changes).
  useEffect(() => {
    try { localStorage.setItem(lsKey, String(width)); } catch { /* noop */ }
  }, [lsKey, width]);

  /**
   * Attach to a handle element's onMouseDown.
   * direction "right"  → drag right = wider  (left-side panels, e.g. sidebar).
   * direction "left"   → drag left  = wider  (right-side panels, e.g. copilot).
   */
  const startResize = useCallback(
    (e: ReactMouseEvent, direction: "right" | "left" = "right") => {
      e.preventDefault();
      const startX    = e.clientX;
      const startW    = widthRef.current;

      // Lock cursor during drag so fast mouse moves don't flicker back.
      document.body.style.cursor     = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const delta = direction === "right" ? ev.clientX - startX : startX - ev.clientX;
        setWidth(Math.min(max, Math.max(min, startW + delta)));
      };

      const onUp = () => {
        document.body.style.cursor     = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [min, max],
  );

  return { width, startResize };
}
