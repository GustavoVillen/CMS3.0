import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { useT } from "../lib/i18n";

export interface AssetOption { id: string; assetCode: string; name: string | null; }

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";

/**
 * Buscador de activo con typeahead: escribir filtra por código o nombre.
 * Compartido entre el modal de Plan de Mantenimiento y el de Nueva OT.
 */
export function AssetSearchDropdown({ assets, value, onChange, disabled, placeholder }: {
  assets: AssetOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = assets.find(a => a.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return assets;
    return assets.filter(a =>
      a.assetCode.toLowerCase().includes(q) || (a.name ?? "").toLowerCase().includes(q)
    );
  }, [assets, query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={`${inputCls} flex items-center gap-2 text-left cursor-pointer ${disabled ? "opacity-40 cursor-not-allowed" : "hover:border-accent/40"}`}
      >
        {selected ? (
          <>
            {selected.name
              ? <span className="flex-1 truncate text-yellow-700 dark:text-yellow-400 text-sm font-semibold">{selected.name}</span>
              : <span className="flex-1 truncate font-mono text-accent text-sm">{selected.assetCode}</span>}
            {selected.name && <span className="text-fg/40 text-xs font-mono truncate max-w-[160px]">{selected.assetCode}</span>}
            <X className="w-3.5 h-3.5 text-fg/30 hover:text-fg shrink-0" onClick={handleClear} />
          </>
        ) : (
          <>
            <span className="flex-1 text-fg/30 text-sm">{placeholder ?? t("mp.selectAsset")}</span>
            <ChevronDown className="w-3.5 h-3.5 text-fg/30 shrink-0" />
          </>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-surface dark:bg-[#111827] border border-fg/10 rounded-xl shadow-xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-fg/10">
            <Search className="w-3.5 h-3.5 text-fg/30 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") { setOpen(false); setQuery(""); }
                if (e.key === "Enter" && filtered.length === 1) handleSelect(filtered[0]);
              }}
              placeholder={t("mp.searchByCodeOrName")}
              className="flex-1 bg-transparent text-sm text-fg placeholder-fg/20 outline-none"
            />
          </div>
          {/* Options */}
          <div className="max-h-52 overflow-y-auto">
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
                  ? <span className="text-yellow-700 dark:text-yellow-400 text-xs font-semibold truncate flex-1">{a.name}</span>
                  : <span className="font-mono text-accent text-xs shrink-0">{a.assetCode}</span>}
                {a.name && <span className="font-mono text-fg/40 text-xs shrink-0">{a.assetCode}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
