import { useState, useEffect, useCallback, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { api, ApiError } from "./api";

export function useFetch<T>(path: string, deps: unknown[] = []) {
  const [data, setData]     = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<T>(path);
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error de carga");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
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
