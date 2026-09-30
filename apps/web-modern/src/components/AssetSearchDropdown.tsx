import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X } from "lucide-react";
import { useT } from "../lib/i18n";
import { textMatches } from "../lib/text-search";

export interface AssetOption { id: string; assetCode: string; name: string | null; }

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
// Misma altura y letra que los <select> de las tablas de revisión.
const compactCls = "w-full bg-fg/5 border rounded-lg px-2 py-1 text-[11px] text-fg focus:outline-none focus:border-accent/50";

/**
 * Buscador de activo con typeahead: escribir filtra por código o nombre.
 * Compartido entre el modal de Plan de Mantenimiento y el de Nueva OT.
 *
 * `compact`: versión chica para una celda de tabla. `floating`: la lista se
 * dibuja en un portal con posición fija, para las tablas con scroll propio que
 * recortan un menú absoluto (mismo arreglo que PersonSelect).
 */
export function AssetSearchDropdown({ assets, value, onChange, disabled, placeholder, compact, floating, invalid }: {
  assets: AssetOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  compact?: boolean;
  floating?: boolean;
  /** Borde naranja: falta elegirlo. */
  invalid?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = assets.find(a => a.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return assets;
    return assets.filter(a =>
      textMatches(a.assetCode, q) || textMatches(a.name ?? "", q)
    );
  }, [assets, query]);

  const place = useCallback(() => {
    const b = containerRef.current?.getBoundingClientRect();
    if (!b) return;
    const below = window.innerHeight - b.bottom - 8;
    const above = b.top - 8;
    const openAbove = below < 240 && above > below;
    setRect({
      left: b.left,
      // La celda es angosta: la lista se abre más ancha para leer los nombres enteros.
      width: Math.max(b.width, 320),
      top: openAbove ? b.top - 4 : b.bottom + 4,
      maxHeight: Math.max(180, Math.min(360, openAbove ? above : below)),
      above: openAbove,
    });
  }, []);

  useLayoutEffect(() => { if (open && floating) place(); }, [open, floating, place]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", handler);
    if (!open || !floating) return () => document.removeEventListener("mousedown", handler);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, floating, place]);

  const handleOpen = () => {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelect = (a: AssetOption) => {
    onChange(a.id);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setOpen(false);
    setQuery("");
  };

  const triggerCls = compact
    ? `${compactCls} ${invalid ? "border-amber-500/60" : "border-fg/10"}`
    : inputCls;
  const textSize = compact ? "text-[11px]" : "text-sm";

  const panel = (
    <>
      {/* Search input */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-fg/10">
        <Search className="w-3.5 h-3.5 text-fg/30 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            // Que el Escape cierre la lista y no la ventana que la contiene.
            if (e.key === "Escape") { e.stopPropagation(); setOpen(false); setQuery(""); }
            if (e.key === "Enter" && filtered.length === 1) handleSelect(filtered[0]);
          }}
          placeholder={t("mp.searchByCodeOrName")}
          className="flex-1 bg-transparent text-sm text-fg placeholder-fg/20 outline-none"
        />
      </div>
      {/* Options */}
      <div className={floating ? "overflow-y-auto" : "max-h-52 overflow-y-auto"} style={floating && rect ? { maxHeight: rect.maxHeight - 44 } : undefined}>
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-xs text-fg/30 text-center">{t("common.noResults")}</div>
        ) : filtered.map(a => (
          <button
            key={a.id}
            type="button"
            onClick={() => handleSelect(a)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-fg/5 transition-colors ${a.id === value ? "bg-accent/10" : ""}`}
          >
            {a.name
              ? <span className={`text-yellow-700 dark:text-yellow-400 text-xs font-semibold flex-1 ${floating ? "" : "truncate"}`}>{a.name}</span>
              : <span className="font-mono text-accent text-xs shrink-0">{a.assetCode}</span>}
            {a.name && <span className="font-mono text-fg/40 text-xs shrink-0">{a.assetCode}</span>}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        title={selected ? [selected.name, selected.assetCode].filter(Boolean).join(" · ") : undefined}
        className={`${triggerCls} flex items-center gap-2 text-left cursor-pointer ${disabled ? "opacity-40 cursor-not-allowed" : "hover:border-accent/40"}`}
      >
        {selected ? (
          <>
            {selected.name
              // En la tabla el nombre entra entero (en dos renglones si hace falta), sin puntitos.
              ? <span className={`flex-1 text-yellow-700 dark:text-yellow-400 ${textSize} font-semibold ${compact ? "leading-snug" : "truncate"}`}>{selected.name}</span>
              : <span className={`flex-1 truncate font-mono text-accent ${textSize}`}>{selected.assetCode}</span>}
            {selected.name && !compact && <span className="text-fg/40 text-xs font-mono truncate max-w-[160px]">{selected.assetCode}</span>}
            <X className="w-3.5 h-3.5 text-fg/30 hover:text-fg shrink-0" onClick={handleClear} />
          </>
        ) : (
          <>
            <span className={`flex-1 text-fg/30 ${textSize}`}>{placeholder ?? t("mp.selectAsset")}</span>
            <ChevronDown className="w-3.5 h-3.5 text-fg/30 shrink-0" />
          </>
        )}
      </button>

      {/* Dropdown */}
      {open && !floating && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-surface dark:bg-[#111827] border border-fg/10 rounded-xl shadow-xl overflow-hidden">
          {panel}
        </div>
      )}
      {open && floating && rect && createPortal(
        <div
          ref={listRef}
          style={{
            position: "fixed",
            left: rect.left,
            width: rect.width,
            maxHeight: rect.maxHeight,
            ...(rect.above ? { bottom: window.innerHeight - rect.top } : { top: rect.top }),
          }}
          className="z-[200] flex flex-col bg-surface dark:bg-[#111827] border border-fg/10 rounded-xl shadow-2xl overflow-hidden"
        >
          {panel}
        </div>,
        document.body,
      )}
    </div>
  );
}
