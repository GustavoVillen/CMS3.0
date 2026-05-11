import React, { useState, useMemo, useCallback } from "react";
import { ChevronLeft, Loader2, Zap, AlertTriangle, Clock } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";

interface Plan {
  id: string;
  taskCode: string;
  title: string;
  description: string | null;
  vesselCode: string;
  assetId: string;
  assetName: string | null;
  triggerType: string;
  frequencyMonths: number | null;
  frequencyHours: number | null;
  estimatedHours: number | null;
  status: string;
  executionStatus: string;
  nextDueDate: string | null;
  nextDueHours: number | null;
  lastExecutionDate: string | null;
  assetCurrentHours: number | null;
  activeWorkOrderCode: string | null;
  taskType: "MAINTENANCE" | "INSPECTION";
}

type Filter = "due" | "upcoming" | "all";
type View = "list" | "detail";

const STATUS_COLOR: Record<string, string> = {
  OVERDUE:   "bg-red-500/15 text-red-400 border-red-500/30",
  DUE:       "bg-orange-500/15 text-orange-400 border-orange-500/30",
  IN_WINDOW: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  UPCOMING:  "bg-blue-500/15 text-blue-400 border-blue-500/30",
  FUTURE:    "bg-white/5 text-text-industrial/40 border-white/10",
  COMPLETED: "bg-success-sea/10 text-success-sea border-success-sea/30",
};

const STATUS_LABEL: Record<string, string> = {
  OVERDUE:   "Vencido",
  DUE:       "Próximo",
  IN_WINDOW: "OT abierta",
  UPCOMING:  "Por vencer",
  FUTURE:    "Futuro",
  COMPLETED: "Completado",
};

function formatDue(plan: Plan): string {
  if (plan.nextDueHours != null) return `${plan.nextDueHours.toLocaleString()} h`;
  if (plan.nextDueDate) return plan.nextDueDate.slice(0, 10);
  return "—";
}

export const MobilePlans: React.FC = () => {
  const { data, loading, reload } = useFetch<{ items: Plan[] }>("/app/pms/maintenance-plans?status=ACTIVE");
  const [filter, setFilter]       = useState<Filter>("due");
  const [view, setView]           = useState<View>("list");
  const [selected, setSelected]   = useState<Plan | null>(null);
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    if (filter === "all") return items;
    if (filter === "due") {
      return items.filter(p => p.executionStatus === "OVERDUE" || p.executionStatus === "DUE");
    }
    return items.filter(p => p.executionStatus === "UPCOMING");
  }, [data, filter]);

  const counts = useMemo(() => {
    const items = data?.items ?? [];
    return {
      due:      items.filter(p => p.executionStatus === "OVERDUE" || p.executionStatus === "DUE").length,
      upcoming: items.filter(p => p.executionStatus === "UPCOMING").length,
      all:      items.length,
    };
  }, [data]);

  const handleExecute = useCallback(async () => {
    if (!selected) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/pms/maintenance-plans/${selected.id}/open-work-order`, {});
      await reload();
      setView("list");
      setSelected(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al abrir OT");
    } finally {
      setSaving(false);
    }
  }, [selected, reload]);

  // ── Detail ────────────────────────────────────────────────────────────────
  if (view === "detail" && selected) {
    const hasActiveWO = selected.executionStatus === "IN_WINDOW" && !!selected.activeWorkOrderCode;
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-white/10">
          <button type="button" onClick={() => { setView("list"); setSelected(null); setErr(null); }} className="p-2 -ml-2 text-text-industrial/40 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-white truncate flex-1">{selected.taskCode}</span>
          <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold shrink-0 ${STATUS_COLOR[selected.executionStatus] ?? "bg-white/5 text-white/40 border-white/10"}`}>
            {STATUS_LABEL[selected.executionStatus] ?? selected.executionStatus}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <p className="text-base font-bold text-white">{selected.title}</p>
            {selected.assetName && <p className="text-xs text-text-industrial/50 mt-0.5">{selected.assetName}</p>}
            <p className="text-[11px] font-mono text-text-industrial/40 mt-0.5">{selected.vesselCode}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Vence</p>
              <p className="text-sm font-bold text-white">{formatDue(selected)}</p>
            </div>
            {selected.estimatedHours != null && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Horas est.</p>
                <p className="text-sm font-bold text-white">{selected.estimatedHours} h</p>
              </div>
            )}
          </div>

          {selected.description && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">Descripción</p>
              <p className="text-xs text-text-industrial/80 whitespace-pre-line leading-relaxed">{selected.description}</p>
            </div>
          )}

          {err && <p className="text-xs text-red-400">{err}</p>}

          <div className="space-y-2 pt-2">
            {hasActiveWO ? (
              <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-200 leading-snug">
                  Ya hay una OT abierta para este plan: <span className="font-mono font-bold">{selected.activeWorkOrderCode}</span>.
                  Cerrala primero desde la solapa de OTs.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleExecute}
                disabled={saving}
                className="w-full py-3 rounded-xl bg-accent text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Abrir OT
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── List ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Filter chips */}
      <div className="shrink-0 px-3 py-2.5 border-b border-white/10 flex gap-1.5 overflow-x-auto">
        {([
          ["due",      "Próximos",  counts.due,      "text-orange-400"],
          ["upcoming", "Por vencer", counts.upcoming, "text-blue-400"],
          ["all",      "Todos",      counts.all,      "text-text-industrial/60"],
        ] as [Filter, string, number, string][]).map(([f, label, count, color]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors flex items-center gap-1.5 ${
              filter === f
                ? "bg-accent/15 text-accent border-accent/40"
                : "bg-white/5 text-text-industrial/60 border-white/10"
            }`}
          >
            {label}
            <span className={`text-[10px] tabular-nums ${filter === f ? "text-accent" : color}`}>({count})</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-text-industrial/30 text-sm flex flex-col items-center gap-2">
            <Clock className="w-6 h-6 text-text-industrial/20" />
            <span>Sin planes en esta categoría</span>
          </div>
        ) : (
          filtered.map(plan => (
            <button
              key={plan.id}
              type="button"
              onClick={() => { setSelected(plan); setView("detail"); setErr(null); }}
              className="w-full text-left px-4 py-3.5 hover:bg-white/5 active:bg-white/10 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-[10px] font-mono text-text-industrial/40">{plan.taskCode}</span>
                    <span className={`text-[9px] px-1.5 py-px rounded-full border font-bold ${STATUS_COLOR[plan.executionStatus] ?? ""}`}>
                      {STATUS_LABEL[plan.executionStatus] ?? plan.executionStatus}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white truncate">{plan.title}</p>
                  {plan.assetName && (
                    <p className="text-xs text-text-industrial/40 truncate mt-0.5">{plan.assetName}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-mono text-text-industrial/40">{formatDue(plan)}</p>
                  {plan.estimatedHours != null && (
                    <p className="text-[10px] font-mono text-accent/60 mt-0.5">{plan.estimatedHours} h</p>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
