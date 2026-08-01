// Editor de REPUESTOS / MATERIALES previstos — dos recuadros lado a lado.
// Compartido por el modal de OT (WoRegiSections) y el modal de Plan de
// Mantenimiento: el plan los define y la OT los hereda, con la misma UX.
//
//   · REPUESTOS  → desplegable del catálogo /Spares + semáforo de stock.
//   · MATERIALES → texto libre (grasa, trapos, sellador…), sin stock.
//
// Es una lista de PLANIFICACIÓN: no descuenta stock (eso pasa al cerrar la OT).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Plus, Search, Trash2, X } from "lucide-react";

export interface WoPlannedItem {
  id?: string;
  kind: "SPARE" | "MATERIAL";
  /** Enlaza al catálogo /Spares (solo REPUESTOS). Habilita mostrar stock. */
  spareId?: string | null;
  description: string;
  quantity: number;
  unit: string;
}

/** Repuesto del catálogo con stock, para el desplegable + semáforo. */
export interface WoSpareOption {
  id: string; sku: string; name: string; unit: string;
  onHand: number; minStock: number; reorderPoint: number;
}

const cellCls = "bg-fg/5 border border-fg/10 rounded-lg px-2.5 py-1.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1";

/** Color del stock según el criterio de Repuestos & Stock. */
function stockCls(s: WoSpareOption): string {
  const critical = s.onHand < s.minStock;
  const warning = !critical && s.onHand <= s.reorderPoint;
  return critical ? "text-red-700 dark:text-red-400" : warning ? "text-yellow-700 dark:text-yellow-400" : "text-emerald-700 dark:text-emerald-400";
}

/**
 * Buscador de repuesto con typeahead (mismo patrón que AssetSearchDropdown):
 * escribir filtra por SKU o nombre, y cada opción muestra su stock con semáforo.
 */
function SpareSearchDropdown({ spares, value, onChange, disabled, fallbackLabel }: {
  spares: WoSpareOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** Texto a mostrar si el value no está en el catálogo (repuesto borrado). */
  fallbackLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = spares.find(s => s.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return spares;
    return spares.filter(s => s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [spares, query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (s: WoSpareOption) => { onChange(s.id); setOpen(false); setQuery(""); };

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (disabled) return; setOpen(true); setQuery(""); setTimeout(() => inputRef.current?.focus(), 0); }}
        className={`${cellCls} w-full flex items-center gap-2 text-left ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:border-accent/40"}`}
      >
        {selected ? (
          <span className="flex-1 truncate"><span className="font-mono text-accent">{selected.sku}</span> — {selected.name}</span>
        ) : value && fallbackLabel ? (
          <span className="flex-1 truncate">{fallbackLabel}</span>
        ) : (
          <span className="flex-1 text-fg/30">Seleccionar repuesto…</span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-fg/30 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-surface dark:bg-[#111827] border border-fg/10 rounded-xl shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-fg/10">
            <Search className="w-3.5 h-3.5 text-fg/30 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") { setOpen(false); setQuery(""); }
                if (e.key === "Enter" && filtered.length === 1) handleSelect(filtered[0]!);
              }}
              placeholder="Buscar por código o nombre…"
              className="flex-1 bg-transparent text-sm text-fg placeholder-fg/20 outline-none"
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-fg/30 text-center">Sin resultados</div>
            ) : filtered.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelect(s)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-fg/5 transition-colors ${s.id === value ? "bg-accent/10" : ""}`}
              >
                <span className="font-mono text-accent text-xs shrink-0">{s.sku}</span>
                <span className="text-xs text-fg truncate flex-1">{s.name}</span>
                <span className={`text-[11px] font-bold shrink-0 ${stockCls(s)}`}>{s.onHand} {s.unit}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PlannedItemsEditor({ items, onChange, spares = [], disabled }: {
  items: WoPlannedItem[];
  onChange: (items: WoPlannedItem[]) => void;
  /** Catálogo de repuestos del buque con stock. Vacío = sin desplegable útil. */
  spares?: WoSpareOption[];
  disabled?: boolean;
}) {
  const addItem = (kind: "SPARE" | "MATERIAL") =>
    onChange([...items, { kind, spareId: null, description: "", quantity: 1, unit: "ud" }]);
  const patchItem = (idx: number, patch: Partial<WoPlannedItem>) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  const spareById = new Map(spares.map(s => [s.id, s]));

  // Semáforo del stock en la fila (el detalle también va en cada opción del buscador).
  const stockBadge = (it: WoPlannedItem) => {
    if (!it.spareId) return null;
    const s = spareById.get(it.spareId);
    if (!s) return <span className="shrink-0 w-20 text-right text-[10px] text-text-industrial/40">sin catálogo</span>;
    const critical = s.onHand < s.minStock;
    return (
      <span className={`shrink-0 w-20 text-right text-[11px] font-bold ${stockCls(s)}`} title={critical ? "Bajo el stock mínimo" : s.onHand <= s.reorderPoint ? "Bajo el punto de reorden" : "Stock disponible"}>
        {critical && <AlertTriangle className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
        {s.onHand} {s.unit}
      </span>
    );
  };

  const itemsTable = (kind: "SPARE" | "MATERIAL", title: string) => {
    const rows = items.map((it, i) => ({ it, i })).filter(r => r.it.kind === kind);
    const isSpare = kind === "SPARE";
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className={labelCls + " mb-0"}>{title}</p>
          {!disabled && (
            <button
              type="button"
              onClick={() => addItem(kind)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold uppercase tracking-wider hover:bg-accent/20"
            >
              <Plus className="w-3 h-3" /> Agregar
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-[11px] text-text-industrial/40 italic">Sin {title.toLowerCase()}.</p>
        ) : (
          <div className="space-y-1.5">
            {rows.map(({ it, i }) => (
              <div key={it.id ?? i} className="flex gap-1.5 items-center">
                {isSpare ? (
                  <>
                    <SpareSearchDropdown
                      spares={spares}
                      value={it.spareId ?? ""}
                      disabled={disabled}
                      fallbackLabel={it.description}
                      onChange={id => {
                        const s = spareById.get(id);
                        if (s) patchItem(i, { spareId: s.id, description: `${s.sku} — ${s.name}`, unit: s.unit });
                        else patchItem(i, { spareId: null });
                      }}
                    />
                    {stockBadge(it)}
                  </>
                ) : (
                  <input
                    className={cellCls + " flex-1 min-w-0"}
                    placeholder="Ej. Grasa marina EP2"
                    value={it.description}
                    disabled={disabled}
                    onChange={e => patchItem(i, { description: e.target.value })}
                  />
                )}
                <input
                  type="number" min={0} step="any"
                  className={cellCls + " w-16 shrink-0 text-center"}
                  value={it.quantity}
                  disabled={disabled}
                  onChange={e => patchItem(i, { quantity: Number(e.target.value) })}
                />
                <input
                  className={cellCls + " w-14 shrink-0 text-center"}
                  placeholder="ud"
                  value={it.unit}
                  disabled={disabled}
                  onChange={e => patchItem(i, { unit: e.target.value })}
                />
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="shrink-0 p-1.5 rounded-lg text-text-industrial/40 hover:text-red-500 hover:bg-red-500/10"
                    aria-label="Quitar ítem"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      {itemsTable("SPARE", "Repuestos")}
      {itemsTable("MATERIAL", "Materiales")}
    </div>
  );
}
