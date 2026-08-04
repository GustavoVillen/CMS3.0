// ÍTEMS DEL PDM que ejecuta una OT.
//
// Una parada de astillero cubre varios planes en una sola orden ("ITEM DEL PDM:
// 1.7 / 1.8 / 1.9 …"), incluso de equipos distintos. Al cerrar la OT se dan por
// ejecutados TODOS: cada uno recalcula su próximo vencimiento con su frecuencia.
//
// El plan PRINCIPAL (el que originó la OT) no se puede quitar: es el que le dio
// equipo y datos a la orden.

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Loader2, Plus, Search, X } from "lucide-react";
import { api, ApiError } from "../../lib/api";

export interface WoPlanRow {
  id: string;
  taskCode: string;
  title: string;
  assetId: string;
  assetName: string | null;
  isPrimary: boolean;
}

interface PlanOption { id: string; taskCode: string; title: string; assetName?: string | null; status?: string }

export function WoPlansPanel({ workOrderId, vesselCode, plans, canEdit, onChanged }: {
  workOrderId: string;
  vesselCode: string;
  plans: WoPlanRow[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<WoPlanRow[]>(plans);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Se toma la lista de la OT al abrirla. Después manda lo que devuelve cada
  // alta/baja: re-sincronizar con la prop pisaría el cambio recién hecho con la
  // versión anterior de la OT (el refresco del listado es asincrónico).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(plans); }, [workOrderId]);

  // Catálogo de planes del buque: se carga recién al abrir el buscador.
  const [options, setOptions] = useState<PlanOption[] | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!adding || options || loadingOptions) return;
    setLoadingOptions(true);
    api.get<{ items: PlanOption[] }>(`/app/pms/maintenance-plans?vesselCode=${encodeURIComponent(vesselCode)}&status=ACTIVE&limit=2000`)
      .then(r => setOptions(r.items ?? []))
      .catch(() => setOptions([]))
      .finally(() => setLoadingOptions(false));
  }, [adding, options, loadingOptions, vesselCode]);

  useEffect(() => {
    if (!adding) return;
    setTimeout(() => inputRef.current?.focus(), 0);
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setAdding(false); setQuery(""); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [adding]);

  const included = useMemo(() => new Set(rows.map(r => r.id)), [rows]);
  const filtered = useMemo(() => {
    const list = (options ?? []).filter(o => !included.has(o.id));
    const q = query.trim().toLowerCase();
    if (!q) return list.slice(0, 50);
    return list.filter(o =>
      o.taskCode.toLowerCase().includes(q) ||
      o.title.toLowerCase().includes(q) ||
      (o.assetName ?? "").toLowerCase().includes(q)
    ).slice(0, 50);
  }, [options, included, query]);

  const add = async (planId: string) => {
    setBusyId(planId); setErr(null);
    try {
      const r = await api.post<{ items: WoPlanRow[] }>(`/app/pms/work-orders/${workOrderId}/plans`, { planId });
      setRows(r.items ?? []);
      setAdding(false); setQuery("");
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo agregar el ítem del PDM.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (planId: string) => {
    setBusyId(planId); setErr(null);
    try {
      const r = await api.delete<{ items: WoPlanRow[] }>(`/app/pms/work-orders/${workOrderId}/plans/${planId}`);
      setRows(r.items ?? []);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo quitar el ítem del PDM.");
    } finally {
      setBusyId(null);
    }
  };

  // OT sin ningún plan (correctiva pura) y sin poder editar: no hay nada que mostrar.
  if (rows.length === 0 && !canEdit) return null;

  return (
    <div className="rounded-xl border border-fg/10 bg-fg/[0.03] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <ClipboardList className="w-3.5 h-3.5 text-accent" />
        <span className="text-[10px] uppercase tracking-widest text-text-industrial/60 font-bold">
          Ítems del PDM{rows.length > 1 ? ` (${rows.length})` : ""}
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={() => setAdding(v => !v)}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-accent hover:underline"
          >
            <Plus className="w-3 h-3" /> Agregar
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-text-industrial/40 italic">
          Esta orden no ejecuta ningún ítem del plan de mantenimiento.
        </p>
      ) : (
        <div className="space-y-1">
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-2 text-[11px]">
              <span className="font-mono font-bold text-accent shrink-0">{r.taskCode}</span>
              <span className="text-fg truncate">{r.title}</span>
              {r.assetName && <span className="text-text-industrial/50 truncate hidden sm:inline">· {r.assetName}</span>}
              {r.isPrimary && (
                <span className="shrink-0 px-1.5 py-0.5 rounded border border-accent/30 bg-accent/10 text-accent text-[9px] font-bold uppercase">
                  Principal
                </span>
              )}
              {canEdit && !r.isPrimary && (
                <button
                  type="button"
                  onClick={() => { void remove(r.id); }}
                  disabled={busyId === r.id}
                  title="Quitar este ítem de la orden"
                  className="ml-auto shrink-0 text-text-industrial/40 hover:text-red-600 disabled:opacity-40"
                >
                  {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div ref={boxRef} className="relative">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-fg/10 bg-surface dark:bg-[#111827]">
            <Search className="w-3.5 h-3.5 text-fg/30 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") { setAdding(false); setQuery(""); } }}
              placeholder="Buscar por código, tarea o equipo…"
              className="flex-1 bg-transparent text-xs text-fg placeholder-fg/25 outline-none"
            />
          </div>
          <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-fg/10 bg-surface dark:bg-[#111827]">
            {loadingOptions ? (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-text-industrial/50">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> Cargando planes…
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-fg/30 text-center">Sin resultados</div>
            ) : filtered.map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => { void add(o.id); }}
                disabled={busyId === o.id}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-fg/5 transition-colors disabled:opacity-50"
              >
                <span className="font-mono text-accent text-[11px] font-bold shrink-0">{o.taskCode}</span>
                <span className="text-[11px] text-fg truncate flex-1">{o.title}</span>
                {o.assetName && <span className="text-[10px] text-text-industrial/40 truncate max-w-[35%]">{o.assetName}</span>}
                {busyId === o.id && <Loader2 className="w-3 h-3 animate-spin text-accent shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {err && <p className="text-[11px] text-red-700 dark:text-red-400">{err}</p>}

      {rows.length > 1 && (
        <p className="text-[10px] text-text-industrial/45">
          Al cerrar esta orden se dan por ejecutados los {rows.length} ítems.
        </p>
      )}
    </div>
  );
}
