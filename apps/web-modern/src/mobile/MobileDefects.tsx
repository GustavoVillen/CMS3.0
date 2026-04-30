import React, { useState, useCallback, useMemo } from "react";
import { ChevronLeft, Plus, Loader2 } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useVesselContext } from "../lib/vessel-context";
import { useEscapeGuard } from "../lib/escape-guard";

interface Defect {
  id: string;
  defectCode: string;
  status: string;
  severity: string;
  operationalState: string;
  classification: string;
  description: string;
  reportedAt: string;
}

interface Asset { id: string; name: string; code: string; }

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "bg-red-500/10 text-red-400 border-red-500/20",
  HIGH:     "bg-orange-500/10 text-orange-400 border-orange-500/20",
  MEDIUM:   "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  LOW:      "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "text-xs font-bold uppercase tracking-wider text-text-industrial/40";

type View = "list" | "create" | "detail";

export const MobileDefects: React.FC = () => {
  const { data, loading, reload } = useFetch<{ items: Defect[] }>("/app/pms/defects");
  const { data: assetData }       = useFetch<{ items: Asset[] }>("/app/assets");
  const { selectedVesselCode }    = useVesselContext();

  const [view, setView]                       = useState<View>("list");
  const [selected, setSelected]               = useState<Defect | null>(null);
  const [assetId, setAssetId]                 = useState("");
  const [classification, setClassification]   = useState("Mecánico");
  const [description, setDescription]         = useState("");
  const [severity, setSeverity]               = useState("MEDIUM");
  const [operationalState, setOperationalState] = useState("NORMAL");
  const [saving, setSaving]                   = useState(false);
  const [err, setErr]                         = useState<string | null>(null);

  const openDefects = useMemo(
    () => (data?.items ?? []).filter(d => d.status !== "RESOLVED" && d.status !== "CLOSED"),
    [data],
  );

  const openCreate = () => {
    setAssetId(""); setClassification("Mecánico"); setDescription("");
    setSeverity("MEDIUM"); setOperationalState("NORMAL"); setErr(null);
    setView("create");
  };

  const handleCreate = useCallback(async () => {
    if (!selectedVesselCode) { setErr("Seleccioná un buque primero."); return; }
    if (!assetId)            { setErr("Seleccioná un equipo.");         return; }
    if (!description.trim()) { setErr("La descripción es requerida.");  return; }
    setSaving(true); setErr(null);
    try {
      await api.post("/app/pms/defects", {
        vesselCode:     selectedVesselCode,
        assetId,
        classification: classification.trim(),
        description:    description.trim(),
        severity,
        operationalState,
      });
      await reload();
      setView("list");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al crear defecto");
    } finally {
      setSaving(false);
    }
  }, [selectedVesselCode, assetId, classification, description, severity, operationalState, reload]);

  // ─── ESC guard ──────────────────────────────────────────────────────────────
  const createDirty =
    view === "create" &&
    (assetId !== "" ||
      description.trim() !== "" ||
      severity !== "MEDIUM" ||
      operationalState !== "NORMAL" ||
      classification !== "Mecánico");

  useEscapeGuard({
    enabled: view === "create",
    isDirty: createDirty,
    onSave: handleCreate,
    onClose: () => setView("list"),
  });

  useEscapeGuard({
    enabled: view === "detail",
    isDirty: false,
    onClose: () => { setView("list"); setSelected(null); },
  });

  // ── Create form ─────────────────────────────────────────────────────────────
  if (view === "create") {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-white/10">
          <button type="button" onClick={() => setView("list")} className="p-2 -ml-2 text-text-industrial/40 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-white">Nuevo Defecto</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-1.5">
            <p className={labelCls}>Equipo *</p>
            <select value={assetId} onChange={e => setAssetId(e.target.value)} className={inputCls + " appearance-none"}>
              <option value="">— Seleccionar —</option>
              {(assetData?.items ?? []).map(a => (
                <option key={a.id} value={a.id}>{a.name ?? a.code}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className={labelCls}>Severidad</p>
              <select value={severity} onChange={e => setSeverity(e.target.value)} className={inputCls + " appearance-none"}>
                <option value="CRITICAL">Crítico</option>
                <option value="HIGH">Alto</option>
                <option value="MEDIUM">Medio</option>
                <option value="LOW">Bajo</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <p className={labelCls}>Estado operac.</p>
              <select value={operationalState} onChange={e => setOperationalState(e.target.value)} className={inputCls + " appearance-none"}>
                <option value="NORMAL">Normal</option>
                <option value="DEGRADED">Degradado</option>
                <option value="RESTRICTED">Restringido</option>
                <option value="NO_GO">No operativo</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className={labelCls}>Clasificación</p>
            <input
              value={classification}
              onChange={e => setClassification(e.target.value)}
              className={inputCls}
              placeholder="ej. Mecánico, Eléctrico..."
            />
          </div>
          <div className="space-y-1.5">
            <p className={labelCls}>Descripción *</p>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={5}
              placeholder="Describe el defecto observado..."
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
            {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Registrar defecto"}
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
          <button
            type="button"
            onClick={() => { setView("list"); setSelected(null); }}
            className="p-2 -ml-2 text-text-industrial/40 hover:text-white"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-white truncate flex-1">{selected.defectCode}</span>
          <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold shrink-0 ${SEV_COLOR[selected.severity] ?? "bg-white/5 text-white border-white/10"}`}>
            {selected.severity}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Estado operac.</p>
              <p className="text-sm font-bold text-white">{selected.operationalState}</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Clasificación</p>
              <p className="text-sm font-bold text-white">{selected.classification}</p>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">Descripción</p>
            <p className="text-sm text-white/80 leading-relaxed">{selected.description}</p>
          </div>
          <p className="text-[10px] text-text-industrial/30">
            Reportado: {new Date(selected.reportedAt).toLocaleDateString("es-AR")}
          </p>
        </div>
      </div>
    );
  }

  // ── List ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full relative">
      <div className="shrink-0 px-4 py-3 border-b border-white/10">
        <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">
          {openDefects.length} defecto{openDefects.length !== 1 ? "s" : ""} activo{openDefects.length !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : openDefects.length === 0 ? (
          <div className="text-center py-10 text-text-industrial/30 text-sm">Sin defectos activos</div>
        ) : (
          openDefects.map(d => (
            <button
              key={d.id}
              type="button"
              onClick={() => { setSelected(d); setView("detail"); }}
              className="w-full text-left px-4 py-3.5 hover:bg-white/5 active:bg-white/10 transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${SEV_COLOR[d.severity] ?? "bg-white/5 text-white border-white/10"}`}>
                  {d.severity[0]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-mono text-text-industrial/40 mb-0.5">{d.defectCode}</p>
                  <p className="text-sm text-white line-clamp-2">{d.description}</p>
                  <p className="text-xs text-text-industrial/30 mt-0.5">{d.classification} · {d.operationalState}</p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
      <button
        type="button"
        onClick={openCreate}
        className="absolute bottom-5 right-5 w-14 h-14 rounded-full bg-accent text-white flex items-center justify-center shadow-xl shadow-accent/20"
        aria-label="Nuevo defecto"
      >
        <Plus className="w-6 h-6" />
      </button>
    </div>
  );
};
