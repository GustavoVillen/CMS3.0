import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Filter, X } from "lucide-react";
import { useT } from "../lib/i18n";
import { AlertDialog } from "./AlertDialog";

// Filtro por columna estilo Excel: embudo en el encabezado, panel con los
// valores que la columna tiene HOY (cada uno con cuántas filas), buscador y
// orden. Lo comparten la planilla del plan (MaintenancePlansGrid) y la tabla
// general (DataTable), así que una sola implementación cubre todas las pantallas.
//
// Reglas que valen para todas:
// - Las opciones de una columna salen de lo que queda visible con los filtros de
//   las OTRAS columnas puestos, para poder encadenar filtros como en Excel.
// - Tildado todo = sin filtro: la columna no queda marcada por nada.
// - Lo filtrado vive en memoria y se pierde al salir de la pantalla: una planilla
//   filtrada que se recuerda sola esconde registros sin que nadie lo note.

export interface ColumnFilterSpec<T> {
  key: string;
  label: string;
  /** Texto por el que se filtra. Tiene que ser lo que se ve en la celda. */
  value: (row: T) => string;
}

export interface SortControl {
  key: string | null;
  dir: "asc" | "desc";
  onSort: (key: string, dir: "asc" | "desc") => void;
}

interface PanelPos { left: number; top: number; maxHeight: number; above: boolean }

export function useColumnFilters<T>(
  rows: T[],
  specs: ColumnFilterSpec<T>[],
  sortControl?: SortControl,
) {
  const t = useT();
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});

  // Lo filtrado se guarda por el texto que se ve: al cambiar de idioma ya no
  // coincidiría con nada y la tabla quedaría vacía.
  useEffect(() => {
    setFilters(f => (Object.keys(f).length ? {} : f));
  }, [t]);

  const specByKey = useMemo(() => {
    const m = new Map<string, ColumnFilterSpec<T>>();
    specs.forEach(s => m.set(s.key, s));
    return m;
  }, [specs]);

  // Una columna que ya no existe (cambió el juego de columnas) dejaría la tabla
  // filtrada por algo que no se puede ver ni quitar.
  useEffect(() => {
    setFilters(f => {
      const stale = Object.keys(f).filter(k => !specByKey.has(k));
      if (stale.length === 0) return f;
      const next = { ...f };
      stale.forEach(k => delete next[k]);
      return next;
    });
  }, [specByKey]);

  const rowsMatching = useCallback((except: string | null) => {
    const active = Object.entries(filters).filter(([k]) => k !== except && specByKey.has(k));
    if (active.length === 0) return rows;
    return rows.filter(r => active.every(([k, set]) => set.has(specByKey.get(k)!.value(r))));
  }, [rows, filters, specByKey]);

  const filteredRows = useMemo(() => rowsMatching(null), [rowsMatching]);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [alert, setAlert] = useState<string | null>(null);
  const anchors = useRef<Record<string, HTMLElement | null>>({});
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<PanelPos | null>(null);

  const valuesOf = useCallback((key: string) => {
    const spec = specByKey.get(key);
    if (!spec) return [] as [string, number][];
    const map = new Map<string, number>();
    rowsMatching(key).forEach(r => {
      const v = spec.value(r);
      map.set(v, (map.get(v) ?? 0) + 1);
    });
    return [...map.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: "base" }));
  }, [specByKey, rowsMatching]);

  const options = useMemo(() => (openKey ? valuesOf(openKey) : []), [openKey, valuesOf]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter(([v]) => v.toLowerCase().includes(q)) : options;
  }, [options, search]);

  const place = useCallback(() => {
    const b = (openKey ? anchors.current[openKey] : null)?.getBoundingClientRect();
    if (!b) return;
    const below = window.innerHeight - b.bottom - 8;
    const above = b.top - 8;
    const openAbove = below < 260 && above > below;
    setPos({
      left: Math.max(8, Math.min(b.left, window.innerWidth - 276)),
      top: openAbove ? b.top - 4 : b.bottom + 4,
      maxHeight: Math.max(200, Math.min(380, openAbove ? above : below)),
      above: openAbove,
    });
  }, [openKey]);

  useLayoutEffect(() => { if (openKey) place(); }, [openKey, place]);

  useEffect(() => {
    if (!openKey) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchors.current[openKey]?.contains(target)) return;
      setOpenKey(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenKey(null); };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [openKey, place]);

  const toggle = useCallback((key: string) => {
    setOpenKey(cur => {
      if (cur === key) return null;
      setDraft(new Set(filters[key] ?? valuesOf(key).map(([v]) => v)));
      setSearch("");
      return key;
    });
  }, [filters, valuesOf]);

  const clear = useCallback((key: string) => {
    setFilters(f => { const next = { ...f }; delete next[key]; return next; });
    setOpenKey(null);
  }, []);
  const clearAll = useCallback(() => { setFilters({}); setOpenKey(null); }, []);

  const apply = () => {
    if (!openKey) return;
    if (draft.size === 0) { setAlert(t("table.filter.needOne")); return; }
    const key = openKey;
    const total = options.length;
    setFilters(f => {
      const next = { ...f };
      if (draft.size >= total) delete next[key]; else next[key] = new Set(draft);
      return next;
    });
    setOpenKey(null);
  };

  const activeKeys = useMemo(
    () => specs.map(s => s.key).filter(k => !!filters[k]),
    [specs, filters],
  );

  /** Embudo para el encabezado de la columna. */
  const funnel = (key: string) => (
    <ColumnFunnel
      key={`funnel-${key}`}
      anchorRef={el => { anchors.current[key] = el; }}
      active={!!filters[key]}
      open={openKey === key}
      onClick={() => toggle(key)}
    />
  );

  const panel = openKey && pos ? createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        left: pos.left,
        width: 268,
        ...(pos.above ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
      }}
      className="z-[200] rounded-xl border border-fg/10 bg-surface dark:bg-[#0D1B2A] shadow-2xl overflow-hidden flex flex-col"
    >
      <div className="px-3 py-2 border-b border-fg/10 text-[10px] font-bold uppercase tracking-wider text-text-industrial/50 truncate">
        {specByKey.get(openKey)?.label}
      </div>

      {sortControl && (
        <div className="p-1 border-b border-fg/10 flex flex-col">
          {(["asc", "desc"] as const).map(dir => {
            const on = sortControl.key === openKey && sortControl.dir === dir;
            return (
              <button
                key={dir}
                type="button"
                onClick={() => sortControl.onSort(openKey, dir)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs transition-colors ${
                  on ? "text-accent font-bold bg-accent/10" : "text-fg/80 hover:bg-fg/5"
                }`}
              >
                {dir === "asc" ? "↑" : "↓"} {t(dir === "asc" ? "table.filter.sortAsc" : "table.filter.sortDesc")}
              </button>
            );
          })}
        </div>
      )}

      <div className="p-2 border-b border-fg/10">
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t("table.filter.search")}
          className="w-full bg-fg/5 border border-fg/10 rounded-lg px-2 py-1.5 text-xs text-fg focus:outline-none focus:border-accent/50"
        />
      </div>

      <div className="overflow-y-auto p-1 [scrollbar-gutter:stable]" style={{ maxHeight: pos.maxHeight - (sortControl ? 190 : 130) }}>
        {shown.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-text-industrial/50">{t("table.filter.noMatch")}</p>
        ) : (
          <>
            <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-bold text-fg cursor-pointer hover:bg-fg/5 border-b border-fg/10">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 accent-accent shrink-0"
                checked={shown.every(([v]) => draft.has(v))}
                onChange={e => {
                  const on = e.target.checked;
                  setDraft(d => {
                    const next = new Set(d);
                    shown.forEach(([v]) => (on ? next.add(v) : next.delete(v)));
                    return next;
                  });
                }}
              />
              <span className="flex-1 truncate">{t("table.filter.selectAll")}</span>
              <span className="text-[10px] text-text-industrial/50 tabular-nums">{shown.length}</span>
            </label>
            {shown.map(([value, count]) => (
              <label
                key={value || "__blank__"}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-fg/90 cursor-pointer hover:bg-fg/5"
              >
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 accent-accent shrink-0"
                  checked={draft.has(value)}
                  onChange={e => {
                    const on = e.target.checked;
                    setDraft(d => {
                      const next = new Set(d);
                      if (on) next.add(value); else next.delete(value);
                      return next;
                    });
                  }}
                />
                <span className="flex-1 truncate" title={value || t("table.filter.blank")}>
                  {value || t("table.filter.blank")}
                </span>
                <span className="text-[10px] text-text-industrial/50 tabular-nums">{count}</span>
              </label>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 p-2 border-t border-fg/10">
        {filters[openKey] && (
          <button
            type="button"
            onClick={() => clear(openKey)}
            className="mr-auto text-[11px] text-text-industrial/60 underline underline-offset-2 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            {t("table.filter.clear")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpenKey(null)}
          className={`${filters[openKey] ? "" : "ml-auto "}px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-[11px] font-medium text-fg/70 hover:bg-fg/10 transition-all`}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={apply}
          className="px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/50 text-[11px] font-bold text-accent hover:bg-accent/25 transition-all"
        >
          {t("common.accept")}
        </button>
      </div>
    </div>,
    document.body,
  ) : null;

  /** Qué columnas están filtradas + cuántas filas quedaron. */
  const bar = activeKeys.length > 0 ? (
    <div className="flex items-center gap-2 flex-wrap px-1">
      {activeKeys.map(key => {
        const sel = [...(filters[key] ?? [])];
        const text = sel.length <= 2
          ? sel.map(v => v || t("table.filter.blank")).join(", ")
          : t("table.filter.values").replace("{n}", String(sel.length));
        return (
          <span
            key={key}
            className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full bg-accent/10 border border-accent/40 text-[11px] font-medium text-accent max-w-[280px]"
          >
            <span className="truncate">
              <b className="font-bold">{specByKey.get(key)?.label}:</b> {text}
            </span>
            <button
              type="button"
              onClick={() => clear(key)}
              title={t("table.filter.clear")}
              className="shrink-0 p-0.5 rounded-full hover:bg-accent/20 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        onClick={clearAll}
        className="text-[11px] text-text-industrial/60 underline underline-offset-2 hover:text-red-600 dark:hover:text-red-400 transition-colors"
      >
        {t("table.filter.clearAll")}
      </button>
      <span className="ml-auto text-[11px] text-text-industrial/60">
        {t("table.filter.showing")
          .replace("{n}", String(filteredRows.length))
          .replace("{total}", String(rows.length))}
      </span>
    </div>
  ) : null;

  const alertNode = alert ? <AlertDialog message={alert} onClose={() => setAlert(null)} /> : null;

  return {
    rows: filteredRows,
    anyActive: activeKeys.length > 0,
    clearAll,
    funnel,
    /** Panel + cartel de validación: van una sola vez, al final del render. */
    overlay: <>{panel}{alertNode}</>,
    bar,
  };
}

const ColumnFunnel: React.FC<{
  anchorRef: (el: HTMLButtonElement | null) => void;
  active: boolean;
  open: boolean;
  onClick: () => void;
}> = ({ anchorRef, active, open, onClick }) => {
  const t = useT();
  return (
    <button
      type="button"
      ref={anchorRef}
      onClick={e => { e.stopPropagation(); onClick(); }}
      title={t("table.filter.tooltip")}
      aria-label={t("table.filter.tooltip")}
      aria-expanded={open}
      className={`shrink-0 p-0.5 rounded transition-colors ${
        active || open
          ? "text-accent bg-accent/15"
          : "text-text-industrial/40 opacity-60 hover:opacity-100 hover:text-accent hover:bg-accent/10"
      }`}
    >
      <Filter className={`w-3 h-3 ${active ? "fill-current" : ""}`} />
    </button>
  );
};

/** Estado vacío cuando lo que vació la tabla fue el filtro de columna. */
export const ColumnFilterEmpty: React.FC<{ onClear: () => void }> = ({ onClear }) => {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3">
      <span>{t("table.filter.emptyFiltered")}</span>
      <button
        type="button"
        onClick={onClear}
        className="px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/40 text-[11px] font-bold text-accent hover:bg-accent/25 transition-all"
      >
        {t("table.filter.clearAll")}
      </button>
    </div>
  );
};
