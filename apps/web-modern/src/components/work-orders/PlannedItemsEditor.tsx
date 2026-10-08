// Editor de REPUESTOS / MATERIALES previstos — dos recuadros, uno debajo del
// otro y a todo el ancho, para que el nombre del repuesto se lea entero.
// Compartido por el modal de OT (WoRegiSections) y el modal de Plan de
// Mantenimiento: el plan los define y la OT los hereda, con la misma UX.
//
//   · REPUESTOS  → desplegable del catálogo /Spares + semáforo de stock.
//   · MATERIALES → texto libre (grasa, trapos, sellador…), sin stock.
//
// Lo que no está en el catálogo se resuelve sin salir de la pantalla: quien
// puede dar de alta repuestos lo crea desde el buscador (`onCreateSpare`); el
// resto lo pasa a Materiales (`materialFallback`).
//
// Es una lista de PLANIFICACIÓN: no descuenta stock (eso pasa al cerrar la OT).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { textMatches } from "../../lib/text-search";
import { useT } from "../../lib/i18n";

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

/** Qué ofrecer debajo del buscador cuando lo escrito no está en el catálogo. */
export interface SpareNotFoundAction {
  /** Texto del botón; recibe lo escrito. */
  label: (typed: string) => string;
  run: (typed: string) => void;
  /** Alta en curso: el botón queda deshabilitado. */
  busy?: boolean;
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
 * El nombre se muestra entero (baja de renglón si no entra), nunca cortado.
 */
export function SpareSearchDropdown({ spares, value, onChange, disabled, fallbackLabel, notFoundAction, isNew }: {
  spares: WoSpareOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** Texto a mostrar si el value no está en el catálogo (repuesto borrado). */
  fallbackLabel?: string;
  /** Salida para lo que no está en el catálogo: crearlo o pasarlo a Materiales. */
  notFoundAction?: SpareNotFoundAction;
  /** Repuesto recién creado desde esta pantalla: lleva la marca "nuevo". */
  isNew?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // La lista se despliega hacia abajo salvo que no entre: adentro de un modal
  // con scroll (ej. el consumo de repuestos del Dashboard) quedaba recortada y
  // no se veían las opciones.
  const [dropUp, setDropUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Alto que ocupa el panel: buscador + hasta 13rem de opciones. */
  const PANEL_PX = 250;
  const abrir = () => {
    const r = containerRef.current?.getBoundingClientRect();
    if (r) {
      const abajo = window.innerHeight - r.bottom;
      setDropUp(abajo < PANEL_PX && r.top > abajo);
    }
    setOpen(true);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const selected = spares.find(s => s.id === value) ?? null;
  const typed = query.trim();

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return spares;
    return spares.filter(s => textMatches(s.sku, q) || textMatches(s.name, q));
  }, [spares, query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (s: WoSpareOption) => { onChange(s.id); setOpen(false); setQuery(""); };
  const runNotFound = () => {
    if (!notFoundAction || typed.length < 2 || notFoundAction.busy) return;
    notFoundAction.run(typed);
    setOpen(false); setQuery("");
  };

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (disabled) return; abrir(); }}
        className={`${cellCls} w-full flex items-center gap-2 text-left ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:border-accent/40"}`}
      >
        {selected ? (
          <span className="flex-1 break-words">
            <span className="font-mono text-accent">{selected.sku}</span> — {selected.name}
            {isNew && (
              <span className="ml-1.5 px-1.5 py-px rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[9px] font-bold uppercase align-middle">
                {t("wo.items.newTag")}
              </span>
            )}
          </span>
        ) : value && fallbackLabel ? (
          <span className="flex-1 break-words">{fallbackLabel}</span>
        ) : (
          <span className="flex-1 text-fg/30">Seleccionar repuesto…</span>
        )}
        {notFoundAction?.busy
          ? <Loader2 className="w-3.5 h-3.5 text-fg/30 shrink-0 animate-spin" />
          : <ChevronDown className="w-3.5 h-3.5 text-fg/30 shrink-0" />}
      </button>

      {open && (
        <div className={`absolute z-50 left-0 right-0 bg-surface dark:bg-[#111827] border border-fg/10 rounded-xl shadow-xl overflow-hidden ${dropUp ? "bottom-full mb-1" : "top-full mt-1"}`}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-fg/10">
            <Search className="w-3.5 h-3.5 text-fg/30 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") { setOpen(false); setQuery(""); }
                if (e.key === "Enter" && filtered.length === 1) handleSelect(filtered[0]!);
                // Enter sin nada en el catálogo = la salida para "no está".
                if (e.key === "Enter" && filtered.length === 0) { e.preventDefault(); runNotFound(); }
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
                <span className="text-xs text-fg break-words flex-1">{s.name}</span>
                <span className={`text-[11px] font-bold shrink-0 ${stockCls(s)}`}>{s.onHand} {s.unit}</span>
              </button>
            ))}
          </div>
          {/* Fuera de la lista con scroll: siempre a la vista. */}
          {notFoundAction && typed.length >= 2 && (
            <button
              type="button"
              onClick={runNotFound}
              disabled={notFoundAction.busy}
              className="w-full flex items-center gap-1.5 px-3 py-2 border-t border-dashed border-blue-500/30 bg-blue-500/5 text-left text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span className="break-words">{notFoundAction.label(typed)}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PlannedItemsEditor({ items, onChange, spares = [], disabled, onCreateSpare, materialFallback }: {
  items: WoPlannedItem[];
  onChange: (items: WoPlannedItem[]) => void;
  /** Catálogo de repuestos del buque con stock. Vacío = sin desplegable útil. */
  spares?: WoSpareOption[];
  disabled?: boolean;
  /**
   * Alta en el catálogo del buque de lo que no está, sin salir de la pantalla
   * (quien tiene permiso de alta de repuestos). Devuelve la ficha creada, o
   * null si falló (el llamador avisa el error).
   */
  onCreateSpare?: (name: string) => Promise<WoSpareOption | null>;
  /** Sin permiso de alta: lo que no está en el catálogo se pasa a Materiales. */
  materialFallback?: boolean;
}) {
  const t = useT();
  // Fichas creadas desde acá: se suman al catálogo hasta que el llamador lo
  // recargue, y llevan la marca "nuevo".
  const [created, setCreated] = useState<WoSpareOption[]>([]);
  const [creatingIdx, setCreatingIdx] = useState<number | null>(null);
  // El alta es asíncrona: al volver, se parte de la lista vigente, no de la
  // que había al tocar el botón (si no, se pierde lo editado mientras tanto).
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const allSpares = useMemo(
    () => [...spares, ...created.filter(c => !spares.some(s => s.id === c.id))],
    [spares, created],
  );
  const createdIds = useMemo(() => new Set(created.map(c => c.id)), [created]);

  const addItem = (kind: "SPARE" | "MATERIAL") =>
    onChange([...items, { kind, spareId: null, description: "", quantity: 1, unit: "ud" }]);
  const patchItem = (idx: number, patch: Partial<WoPlannedItem>) =>
    onChange(itemsRef.current.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  const spareById = new Map(allSpares.map(s => [s.id, s]));

  const notFoundFor = (idx: number): SpareNotFoundAction | undefined => {
    if (onCreateSpare) {
      return {
        label: typed => t("wo.items.createSpare").replace("{name}", typed),
        busy: creatingIdx === idx,
        run: typed => {
          setCreatingIdx(idx);
          void onCreateSpare(typed).then(s => {
            if (!s) return;
            setCreated(prev => [...prev, s]);
            patchItem(idx, { spareId: s.id, description: `${s.sku} — ${s.name}`, unit: s.unit });
          }).finally(() => setCreatingIdx(null));
        },
      };
    }
    if (materialFallback) {
      return {
        label: () => t("wo.items.toMaterial"),
        run: typed => patchItem(idx, { kind: "MATERIAL", spareId: null, description: typed }),
      };
    }
    return undefined;
  };

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
                      spares={allSpares}
                      value={it.spareId ?? ""}
                      disabled={disabled}
                      fallbackLabel={it.description}
                      notFoundAction={notFoundFor(i)}
                      isNew={!!it.spareId && createdIds.has(it.spareId)}
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
    <div className="space-y-4">
      {itemsTable("SPARE", "Repuestos")}
      <div className="border-t border-fg/10 pt-3">
        {itemsTable("MATERIAL", "Materiales")}
      </div>
    </div>
  );
}
