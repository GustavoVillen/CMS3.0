import React, { useState, useMemo } from "react";
import { ChevronLeft, Search, Loader2 } from "lucide-react";
import { useFetch } from "../lib/hooks";

interface Spare {
  id: string;
  sku: string;
  name: string;
  currentStock: number;
  minStock: number;
  reorderPoint: number;
  unit: string;
  location: string | null;
  department: string | null;
  criticality: string | null;
}

type View = "list" | "detail";

function stockStatus(s: Spare): "critical" | "warning" | "ok" {
  if (s.currentStock < s.minStock)      return "critical";
  if (s.currentStock <= s.reorderPoint) return "warning";
  return "ok";
}

function StockBadge({ spare }: { spare: Spare }) {
  const st = stockStatus(spare);
  if (st === "critical") return <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 shrink-0">BAJO MÍN</span>;
  if (st === "warning")  return <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 shrink-0">REORDEN</span>;
  return <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-success-sea/10 text-success-sea border border-success-sea/20 shrink-0">OK</span>;
}

export const MobileSpares: React.FC = () => {
  const { data, loading } = useFetch<{ items: Spare[] }>("/app/pms/spares");
  const [query, setQuery]         = useState("");
  const [view, setView]           = useState<View>("list");
  const [selected, setSelected]   = useState<Spare | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return data?.items ?? [];
    return (data?.items ?? []).filter(s =>
      (s.name ?? "").toLowerCase().includes(q) ||
      (s.sku  ?? "").toLowerCase().includes(q),
    );
  }, [data, query]);

  // ── Detail ──────────────────────────────────────────────────────────────────
  if (view === "detail" && selected) {
    const st  = stockStatus(selected);
    const max = Math.max(selected.reorderPoint, selected.minStock, 1);
    const pct = Math.min(100, Math.round((selected.currentStock / max) * 100));
    const barColor =
      st === "critical" ? "bg-red-500" :
      st === "warning"  ? "bg-yellow-500" : "bg-success-sea";

    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-white/10">
          <button
            type="button"
            onClick={() => { setView("list"); setSelected(null); }}
            className="p-2 -ml-2 text-text-industrial/40 hover:text-white"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-white truncate flex-1">{selected.name}</span>
          <StockBadge spare={selected} />
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {([
              ["Actual",  selected.currentStock],
              ["Mínimo",  selected.minStock],
              ["Reorden", selected.reorderPoint],
            ] as [string, number][]).map(([label, val]) => (
              <div key={label} className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">{label}</p>
                <p className="text-2xl font-bold text-white tabular-nums">{val}</p>
                <p className="text-[10px] text-text-industrial/30">{selected.unit}</p>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[10px] text-text-industrial/30 text-right">
              {pct}% respecto al punto de reorden
            </p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">SKU</p>
            <p className="text-sm font-mono text-white">{selected.sku}</p>
          </div>
          {selected.location && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Ubicación</p>
              <p className="text-sm font-bold text-white">{selected.location}</p>
            </div>
          )}
          {selected.department && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Departamento</p>
              <p className="text-sm text-white">{selected.department}</p>
            </div>
          )}
          {selected.criticality && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Criticidad</p>
              <p className="text-sm text-white">{selected.criticality}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 p-3 border-b border-white/10">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
          <Search className="w-4 h-4 text-text-industrial/30 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por nombre o SKU..."
            className="flex-1 bg-transparent text-sm text-white placeholder-text-industrial/30 focus:outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-text-industrial/30 text-sm">
            {query ? "Sin resultados" : "Sin repuestos"}
          </div>
        ) : (
          filtered.map(s => {
            const st = stockStatus(s);
            const numColor =
              st === "critical" ? "text-red-400" :
              st === "warning"  ? "text-yellow-400" : "text-white";
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { setSelected(s); setView("detail"); }}
                className="w-full text-left px-4 py-3 hover:bg-white/5 active:bg-white/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{s.name}</p>
                    <p className="text-xs text-text-industrial/40 mt-0.5 font-mono">{s.sku}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <span className={`text-sm font-bold tabular-nums ${numColor}`}>{s.currentStock}</span>
                    <StockBadge spare={s} />
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
