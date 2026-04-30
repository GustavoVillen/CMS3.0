import React, { useState, useCallback, useMemo } from "react";
import { ChevronLeft, CheckCircle, Loader2 } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useVesselContext } from "../lib/vessel-context";

interface DailyReport {
  id: string;
  vesselCode: string;
  reportDate: string;
  status: string;
  fuelConsumedLiters?: number | null;
  engineHoursMain?: number | null;
  generatorHours?: number | null;
  oilConsumedLiters?: number | null;
  notes?: string | null;
  operationalStatus?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT:     "Borrador",
  SUBMITTED: "Enviado",
  VERIFIED:  "Verificado",
};

const OP_STATUS_LABEL: Record<string, string> = {
  UNDERWAY:  "En navegación",
  AT_PORT:   "En puerto",
  ANCHORED:  "Fondeado",
  DRIFTING:  "A la deriva",
  REPAIR:    "En reparación",
};

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "text-xs font-bold uppercase tracking-wider text-text-industrial/40";

type View = "list" | "create" | "detail";

export const MobileDailyReport: React.FC = () => {
  const { data, loading, reload } = useFetch<{ items: DailyReport[] }>("/app/daily-reports");
  const { selectedVesselCode }    = useVesselContext();

  const todayStr   = new Date().toISOString().slice(0, 10);
  const reports    = data?.items ?? [];
  const todayRpt   = useMemo(() => reports.find(r => r.reportDate.slice(0, 10) === todayStr), [reports, todayStr]);
  const recent     = useMemo(() => reports.slice(0, 15), [reports]);

  const [view, setView]     = useState<View>("list");
  const [selected, setSel]  = useState<DailyReport | null>(null);
  const [fuel, setFuel]     = useState("");
  const [engineH, setEngH]  = useState("");
  const [genH, setGenH]     = useState("");
  const [oil, setOil]       = useState("");
  const [opStatus, setOp]   = useState("UNDERWAY");
  const [notes, setNotes]   = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const openCreate = () => {
    setFuel(""); setEngH(""); setGenH(""); setOil(""); setNotes(""); setOp("UNDERWAY"); setErr(null);
    setView("create");
  };

  const handleCreate = useCallback(async () => {
    if (!selectedVesselCode) { setErr("Seleccioná un buque primero."); return; }
    setSaving(true); setErr(null);
    try {
      await api.post("/app/daily-reports", {
        vesselCode:         selectedVesselCode,
        reportDate:         todayStr,
        operationalStatus:  opStatus,
        fuelConsumedLiters: fuel    ? parseFloat(fuel)    : null,
        engineHoursMain:    engineH ? parseFloat(engineH) : null,
        generatorHours:     genH    ? parseFloat(genH)    : null,
        oilConsumedLiters:  oil     ? parseFloat(oil)     : null,
        notes: notes.trim() || null,
      });
      await reload();
      setView("list");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al guardar reporte");
    } finally {
      setSaving(false);
    }
  }, [selectedVesselCode, todayStr, opStatus, fuel, engineH, genH, oil, notes, reload]);

  // ── Create ───────────────────────────────────────────────────────────────────
  if (view === "create") {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-white/10">
          <button type="button" onClick={() => setView("list")} className="p-2 -ml-2 text-text-industrial/40 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-white">Reporte diario — {todayStr}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-1.5">
            <p className={labelCls}>Estado operacional</p>
            <select value={opStatus} onChange={e => setOp(e.target.value)} className={inputCls + " appearance-none"}>
              {Object.entries(OP_STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className={labelCls}>Combustible (L)</p>
              <input type="number" inputMode="decimal" value={fuel} onChange={e => setFuel(e.target.value)} className={inputCls} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <p className={labelCls}>Aceite (L)</p>
              <input type="number" inputMode="decimal" value={oil} onChange={e => setOil(e.target.value)} className={inputCls} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <p className={labelCls}>Motor (h)</p>
              <input type="number" inputMode="decimal" value={engineH} onChange={e => setEngH(e.target.value)} className={inputCls} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <p className={labelCls}>Generador (h)</p>
              <input type="number" inputMode="decimal" value={genH} onChange={e => setGenH(e.target.value)} className={inputCls} placeholder="0" />
            </div>
          </div>
          <div className="space-y-1.5">
            <p className={labelCls}>Notas</p>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Novedades del día..."
              className={inputCls + " resize-none"}
            />
          </div>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-accent text-white text-sm font-bold disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Guardar reporte"}
          </button>
        </div>
      </div>
    );
  }

  // ── Detail ───────────────────────────────────────────────────────────────────
  if (view === "detail" && selected) {
    const metrics: [string, number | null | undefined, string][] = [
      ["Combustible", selected.fuelConsumedLiters, "L"],
      ["Aceite",      selected.oilConsumedLiters,  "L"],
      ["Motor",       selected.engineHoursMain,     "h"],
      ["Generador",   selected.generatorHours,      "h"],
    ];
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-white/10">
          <button type="button" onClick={() => { setView("list"); setSel(null); }} className="p-2 -ml-2 text-text-industrial/40 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-white flex-1">{selected.reportDate.slice(0, 10)}</span>
          <span className="text-xs text-text-industrial/40">{STATUS_LABEL[selected.status] ?? selected.status}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {metrics.map(([label, val, unit]) => (
              <div key={label} className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">{label}</p>
                <p className="text-xl font-bold text-white tabular-nums">
                  {val != null ? `${val}` : "—"}
                  {val != null && <span className="text-xs font-normal text-text-industrial/40 ml-1">{unit}</span>}
                </p>
              </div>
            ))}
          </div>
          {selected.operationalStatus && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Estado</p>
              <p className="text-sm font-bold text-white">{OP_STATUS_LABEL[selected.operationalStatus] ?? selected.operationalStatus}</p>
            </div>
          )}
          {selected.notes && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">Notas</p>
              <p className="text-sm text-white/80 leading-relaxed">{selected.notes}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List ─────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Today's report banner */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        {todayRpt ? (
          <div className="rounded-xl border border-success-sea/30 bg-success-sea/5 p-3 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-success-sea shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-success-sea">Reporte de hoy registrado</p>
              <p className="text-[11px] text-text-industrial/40">{STATUS_LABEL[todayRpt.status] ?? todayRpt.status}</p>
            </div>
            <button
              type="button"
              onClick={() => { setSel(todayRpt); setView("detail"); }}
              className="text-xs text-accent font-bold shrink-0"
            >
              Ver
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openCreate}
            className="w-full py-3 rounded-xl bg-accent text-white text-sm font-bold"
          >
            + Registrar reporte de hoy
          </button>
        )}
      </div>

      <div className="shrink-0 px-4 py-2 border-b border-white/10">
        <p className="text-[10px] font-bold uppercase tracking-wider text-text-industrial/30">Reportes recientes</p>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : recent.length === 0 ? (
          <div className="text-center py-10 text-text-industrial/30 text-sm">Sin reportes</div>
        ) : (
          recent.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => { setSel(r); setView("detail"); }}
              className="w-full text-left px-4 py-3 hover:bg-white/5 active:bg-white/10 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{r.reportDate.slice(0, 10)}</p>
                  <p className="text-xs text-text-industrial/40 mt-0.5">
                    {r.operationalStatus ? (OP_STATUS_LABEL[r.operationalStatus] ?? r.operationalStatus) : "—"}
                  </p>
                </div>
                <div className="text-right">
                  {r.fuelConsumedLiters != null && (
                    <p className="text-xs text-text-industrial/50">{r.fuelConsumedLiters} L</p>
                  )}
                  <p className={`text-[10px] font-bold mt-0.5 ${r.status === "VERIFIED" ? "text-success-sea" : "text-text-industrial/30"}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
