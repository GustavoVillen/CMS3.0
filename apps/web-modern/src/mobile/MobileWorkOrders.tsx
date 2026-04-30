import React, { useState, useCallback } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";

interface WO {
  id: string;
  workOrderCode: string;
  title: string | null;
  status: string;
  criticality: string;
  dueDate: string | null;
  assetName: string | null;
  vesselCode: string;
}

const STATUS_LABEL: Record<string, string> = {
  PLANNED:     "Planificada",
  IN_PROGRESS: "En ejecución",
  ON_HOLD:     "Retenida",
  DONE:        "Completada",
  CLOSED:      "Cerrada",
  CANCELLED:   "Cancelada",
};

const STATUS_COLOR: Record<string, string> = {
  PLANNED:     "bg-blue-500/10 text-blue-400 border-blue-500/20",
  IN_PROGRESS: "bg-accent/10 text-accent border-accent/20",
  ON_HOLD:     "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  DONE:        "bg-success-sea/10 text-success-sea border-success-sea/20",
  CLOSED:      "bg-white/5 text-text-industrial/40 border-white/10",
};

const CRIT_COLOR: Record<string, string> = {
  A: "text-red-400",
  B: "text-orange-400",
  C: "text-yellow-400",
  D: "text-text-industrial/50",
};

type View = "list" | "detail" | "close";

export const MobileWorkOrders: React.FC = () => {
  const { data, loading, reload } = useFetch<{ items: WO[] }>("/app/pms/work-orders");
  const [view, setView]           = useState<View>("list");
  const [selected, setSelected]   = useState<WO | null>(null);
  const [woResult, setWoResult]   = useState<"SATISFACTORY" | "WITH_DEFICIENCIES">("SATISFACTORY");
  const [observations, setObs]    = useState("");
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isOverdue = (wo: WO) => !!wo.dueDate && new Date(wo.dueDate) < today;

  const openWOs = (data?.items ?? []).filter(
    w => w.status === "PLANNED" || w.status === "IN_PROGRESS" || w.status === "ON_HOLD",
  );

  const selectWO  = (wo: WO) => { setSelected(wo); setView("detail"); setErr(null); };
  const back      = ()       => { setView("list"); setSelected(null); setErr(null); };
  const openClose = ()       => { setView("close"); setWoResult("SATISFACTORY"); setObs(""); setErr(null); };

  const handleStart = useCallback(async () => {
    if (!selected) return;
    setSaving(true); setErr(null);
    try {
      await api.patch(`/app/pms/work-orders/${selected.id}`, { status: "IN_PROGRESS" });
      await reload();
      setSelected({ ...selected, status: "IN_PROGRESS" });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al iniciar OT");
    } finally {
      setSaving(false);
    }
  }, [selected, reload]);

  const handleClose = useCallback(async () => {
    if (!selected) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/pms/work-orders/${selected.id}/close`, {
        woResult,
        observations: observations.trim() || null,
        completedDate: new Date().toISOString().slice(0, 10),
      });
      await reload();
      back();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al cerrar OT");
    } finally {
      setSaving(false);
    }
  }, [selected, woResult, observations, reload]);

  // ── Close form ──────────────────────────────────────────────────────────────
  if (view === "close" && selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-white/10">
          <button type="button" onClick={() => setView("detail")} className="p-2 -ml-2 text-text-industrial/40 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-white truncate">Cerrar {selected.workOrderCode}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Resultado *</p>
            <div className="grid grid-cols-2 gap-2">
              {(["SATISFACTORY", "WITH_DEFICIENCIES"] as const).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setWoResult(r)}
                  className={`py-3 rounded-xl border text-xs font-bold transition-all ${
                    woResult === r
                      ? r === "SATISFACTORY"
                        ? "bg-success-sea/15 text-success-sea border-success-sea/30"
                        : "bg-orange-500/15 text-orange-400 border-orange-500/30"
                      : "bg-white/5 text-text-industrial/50 border-white/10"
                  }`}
                >
                  {r === "SATISFACTORY" ? "Satisfactorio" : "Con deficiencias"}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Observaciones</p>
            <textarea
              value={observations}
              onChange={e => setObs(e.target.value)}
              rows={4}
              placeholder="Notas de cierre..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
            />
          </div>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-accent text-white text-sm font-bold disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Confirmar cierre"}
          </button>
        </div>
      </div>
    );
  }

  // ── Detail ──────────────────────────────────────────────────────────────────
  if (view === "detail" && selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-white/10">
          <button type="button" onClick={back} className="p-2 -ml-2 text-text-industrial/40 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-white truncate flex-1">{selected.workOrderCode}</span>
          <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold shrink-0 ${STATUS_COLOR[selected.status] ?? "bg-white/5 text-white/40 border-white/10"}`}>
            {STATUS_LABEL[selected.status] ?? selected.status}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <p className="text-base font-bold text-white">{selected.title ?? "(Sin título)"}</p>
            {selected.assetName && <p className="text-xs text-text-industrial/50 mt-0.5">{selected.assetName}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Criticidad</p>
              <p className={`text-lg font-bold ${CRIT_COLOR[selected.criticality] ?? "text-white"}`}>{selected.criticality}</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Vencimiento</p>
              <p className={`text-sm font-bold ${isOverdue(selected) ? "text-red-400" : "text-white"}`}>
                {selected.dueDate ? selected.dueDate.slice(0, 10) : "—"}
              </p>
            </div>
          </div>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="space-y-2 pt-2">
            {selected.status === "PLANNED" && (
              <button
                type="button"
                onClick={handleStart}
                disabled={saving}
                className="w-full py-3 rounded-xl bg-accent text-white text-sm font-bold disabled:opacity-40"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Iniciar ejecución"}
              </button>
            )}
            {selected.status === "IN_PROGRESS" && (
              <button
                type="button"
                onClick={openClose}
                className="w-full py-3 rounded-xl bg-success-sea text-white text-sm font-bold"
              >
                Cerrar OT
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── List ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 py-3 border-b border-white/10">
        <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">
          {openWOs.length} orden{openWOs.length !== 1 ? "es" : ""} activa{openWOs.length !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : openWOs.length === 0 ? (
          <div className="text-center py-10 text-text-industrial/30 text-sm">Sin órdenes activas</div>
        ) : (
          openWOs.map(wo => (
            <button
              key={wo.id}
              type="button"
              onClick={() => selectWO(wo)}
              className="w-full text-left px-4 py-3.5 hover:bg-white/5 active:bg-white/10 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 text-xs font-bold w-4 text-center shrink-0 ${CRIT_COLOR[wo.criticality] ?? "text-white"}`}>
                  {wo.criticality}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono text-text-industrial/40">{wo.workOrderCode}</span>
                    <span className={`text-[9px] px-1.5 py-px rounded-full border font-bold ${STATUS_COLOR[wo.status] ?? ""}`}>
                      {STATUS_LABEL[wo.status] ?? wo.status}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white truncate">{wo.title ?? "(Sin título)"}</p>
                  {wo.assetName && (
                    <p className="text-xs text-text-industrial/40 truncate mt-0.5">{wo.assetName}</p>
                  )}
                </div>
                {wo.dueDate && (
                  <div className={`text-[10px] font-mono shrink-0 mt-0.5 ${isOverdue(wo) ? "text-red-400 font-bold" : "text-text-industrial/30"}`}>
                    {wo.dueDate.slice(5, 10)}
                  </div>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
