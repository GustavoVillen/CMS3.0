import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Wrench, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT } from "../lib/i18n";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WoPrefill {
  source: "plan" | "defect";
  sourceId: string;
  sourceCode: string;
  sourceLabel: string;
  vesselCode: string;
  assetId: string;
  assetName?: string | null;
  type: string;
  priority?: string;
  criticality?: string;
  title?: string | null;
  description?: string | null;
  dueDate?: string | null;
  responsible?: string | null;
  acceptanceCriteria?: string | null;
  riskLevel?: string | null;
  riskAnalysisResult?: string | null;
  checklistDocUrl?: string | null;
  loto?: string | null;
}

interface Asset { id: string; assetCode: string; name: string; }
interface Vessel { code: string; name: string; }

interface CreateWorkOrderModalProps {
  prefill?: WoPrefill;
  onClose: () => void;
  onSaved: (woId: string) => void | Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider";
const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
// [value, label, activeCls, inactiveLabelCls]
const RISK_LEVEL_OPTS: [string, string, string, string][] = [
  ["LOW",      "L", "bg-success-sea text-primary-bg border-success-sea",       "text-success-sea border-success-sea/40"],
  ["MEDIUM",   "M", "bg-yellow-400 text-primary-bg border-yellow-400",         "text-yellow-400 border-yellow-400/40"],
  ["HIGH",     "H", "bg-red-500 text-white border-red-500",                    "text-red-400 border-red-400/40"],
  ["CRITICAL", "C", "bg-red-700 text-white border-red-700",                    "text-red-600 border-red-600/40"],
];

function TypeBadge({ type }: { type: string }) {
  if (type === "INSPECTION") return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-teal-500/10 text-teal-400 border-teal-500/20">Inspección</span>;
  if (type === "CORRECTIVE")  return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-400 border-orange-500/20">Reparación</span>;
  return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-blue-500/10 text-blue-400 border-blue-500/20">Mantenimiento</span>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const CreateWorkOrderModal: React.FC<CreateWorkOrderModalProps> = ({ prefill, onClose, onSaved }) => {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);

  // ── INFO fields (standalone mode only) ────────────────────────────────────
  const [vesselCode, setVesselCode]   = useState(prefill?.vesselCode ?? "");
  const [vessels, setVessels]         = useState<Vessel[]>([]);
  const [assetId, setAssetId]         = useState(prefill?.assetId ?? "");
  const [assets, setAssets]           = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [resolvedAssetName, setResolvedAssetName] = useState(prefill?.assetName ?? null);
  const [type, setType]               = useState(prefill?.type ?? "PREVENTIVE");
  const [priority, setPriority]       = useState(prefill?.priority ?? "MEDIUM");
  const [criticality, setCriticality] = useState(prefill?.criticality ?? "B");
  const [openDate, setOpenDate]       = useState(today);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // ── PLAN fields ───────────────────────────────────────────────────────────
  const [title, setTitle]                       = useState(prefill?.title ?? "");
  const [description, setDescription]           = useState(prefill?.description ?? "");
  const [assignedTo, setAssignedTo]             = useState(prefill?.responsible ?? "");
  const [dueDate, setDueDate]                   = useState(prefill?.dueDate ? prefill.dueDate.slice(0, 10) : "");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(prefill?.acceptanceCriteria ?? "");
  const [loto, setLoto]                         = useState(prefill?.loto ?? "");
  const [riskLevel, setRiskLevel]               = useState(prefill?.riskLevel ?? "");
  const [riskAnalysisResult, setRiskAnalysisResult] = useState(prefill?.riskAnalysisResult ?? "");
  const [checklistDocFile, setChecklistDocFile] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  // Vessel list for standalone mode
  useEffect(() => {
    if (prefill) return;
    api.get<{ items: Vessel[] }>("/app/vessels?limit=200")
      .then(res => setVessels(res.items ?? []))
      .catch(() => setVessels([]));
  }, [prefill]);

  // Asset lookup for standalone mode
  useEffect(() => {
    if (prefill) return;
    setAssets([]);
    setAssetId("");
    clearTimeout(debounceRef.current);
    const code = vesselCode.trim().toUpperCase();
    if (!code) return;
    debounceRef.current = setTimeout(async () => {
      setLoadingAssets(true);
      try {
        const res = await api.get<{ items: Asset[] }>(`/app/pms/assets?vesselCode=${encodeURIComponent(code)}&limit=200`);
        setAssets(res.items ?? []);
      } catch { setAssets([]); }
      finally { setLoadingAssets(false); }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [vesselCode, prefill]);

  // Resolve asset name from API when prefill has assetId but no assetName
  useEffect(() => {
    if (!prefill || prefill.assetName || !prefill.assetId || !prefill.vesselCode) return;
    api.get<{ items: Asset[] }>(`/app/pms/assets?vesselCode=${encodeURIComponent(prefill.vesselCode)}&limit=200`)
      .then(res => {
        const found = res.items?.find(a => a.id === prefill.assetId);
        if (found) setResolvedAssetName(found.name);
      })
      .catch(() => {});
  }, [prefill]);

  const onSave = useCallback(async () => {
    setErr(null);
    if (!prefill) {
      if (!vesselCode.trim()) { setErr("Embarcación es requerida."); return; }
      if (!assetId)           { setErr("Equipo es requerido."); return; }
    }
    setSaving(true);
    try {
      let woId: string;

      if (prefill?.source === "plan") {
        const created = await api.post<{ id: string }>(`/app/pms/maintenance-plans/${prefill.sourceId}/open-work-order`, {
          title:              title.trim()              || undefined,
          description:        description.trim()        || undefined,
          assignedToUserId:   assignedTo.trim()         || undefined,
          dueDate:            dueDate                   || null,
          acceptanceCriteria: acceptanceCriteria.trim() || null,
          loto,
          riskLevel:          riskLevel                 || null,
          riskAnalysisResult: riskAnalysisResult.trim() || null,
        });
        woId = created.id;
      } else {
        const created = await api.post<{ id: string }>("/app/pms/work-orders", {
          vesselCode:         (prefill?.vesselCode ?? vesselCode).trim().toUpperCase(),
          assetId:            prefill?.assetId ?? assetId,
          type:               prefill?.type    ?? type,
          priority:           prefill?.priority ?? priority,
          criticality:        prefill?.criticality ?? criticality,
          openDate,
          dueDate:            dueDate || null,
          title:              title.trim()              || null,
          description:        description.trim()        || null,
          assignedToUserId:   assignedTo.trim()         || null,
          acceptanceCriteria: acceptanceCriteria.trim() || null,
          loto,
          riskLevel:          riskLevel                 || null,
          riskAnalysisResult: riskAnalysisResult.trim() || null,
        });
        woId = created.id;
      }

      // Upload checklist doc after WO is created (needs id)
      if (checklistDocFile && woId) {
        try {
          const res = await api.upload<{ url: string }>(`/app/attachments/upload?entityType=WorkOrder&entityId=${woId}`, checklistDocFile);
          if (res.url) {
            await api.patch(`/app/pms/work-orders/${woId}`, { checklistDocUrl: res.url });
          }
        } catch { /* non-blocking */ }
      }

      await onSaved(woId);
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setSaving(false); }
  }, [prefill, vesselCode, assetId, type, priority, criticality, openDate, dueDate,
      title, description, assignedTo, acceptanceCriteria, loto, riskLevel, riskAnalysisResult,
      checklistDocFile, onSaved, t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <Wrench className="w-4 h-4 text-accent" />
            <div>
              <h2 className="text-sm font-bold text-white">Nueva Orden de Trabajo</h2>
              {prefill && (
                <p className="text-[10px] text-text-industrial/50 mt-0.5">
                  Desde {prefill.sourceLabel}: <span className="font-mono text-accent">{prefill.sourceCode}</span>
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">

          {/* ── INFORMACIÓN ── */}
          <section>
            <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold mb-3">Información</p>

            {prefill ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {([
                  ["Embarcación", prefill.vesselCode,                "font-mono text-accent"],
                  ["Equipo",      resolvedAssetName ?? prefill.assetId, "text-white"],
                  ["Tipo",        null, null, <TypeBadge key="t" type={prefill.type} />],
                  ["Prioridad",   prefill.priority   ?? "MEDIUM",    "text-white"],
                  ["Criticidad",  prefill.criticality ?? "B",        "text-white"],
                  prefill.dueDate
                    ? ["Próx. vencimiento", prefill.dueDate.slice(0, 10), "text-white"]
                    : null,
                ].filter(Boolean) as [string, string | null, string | null, React.ReactNode?][]).map(([label, value, cls, node], i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{label}</p>
                    {node ?? <p className={`text-xs mt-0.5 ${cls ?? ""}`}>{value || "—"}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className={labelCls}>Embarcación *</label>
                    <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={inputCls}>
                      <option value="">— Seleccionar embarcación —</option>
                      {vessels.map(v => (
                        <option key={v.code} value={v.code}>{v.code} — {v.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>Equipo *</label>
                    {loadingAssets
                      ? <div className="flex items-center gap-2 py-2.5"><Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /><span className="text-xs text-text-industrial/50">Cargando...</span></div>
                      : assets.length > 0
                        ? <select value={assetId} onChange={e => setAssetId(e.target.value)} className={inputCls}>
                            <option value="">— Seleccionar equipo —</option>
                            {assets.map(a => <option key={a.id} value={a.id}>{a.assetCode} — {a.name}</option>)}
                          </select>
                        : <input value={assetId} onChange={e => setAssetId(e.target.value)}
                            placeholder={vesselCode ? "Sin equipos — ingresá ID" : "Ingresá la embarcación primero"}
                            className={inputCls} />
                    }
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className={labelCls}>Tipo</label>
                    <select value={type} onChange={e => setType(e.target.value)} className={inputCls}>
                      <option value="PREVENTIVE">Mantenimiento</option>
                      <option value="CORRECTIVE">Reparación</option>
                      <option value="INSPECTION">Inspección</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>Prioridad</label>
                    <select value={priority} onChange={e => setPriority(e.target.value)} className={inputCls}>
                      <option value="LOW">Baja</option>
                      <option value="MEDIUM">Media</option>
                      <option value="HIGH">Alta</option>
                      <option value="CRITICAL">Crítica</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>Criticidad</label>
                    <select value={criticality} onChange={e => setCriticality(e.target.value)} className={inputCls}>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className={labelCls}>F. Apertura</label>
                    <input type="date" value={openDate} onChange={e => setOpenDate(e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>F. Vencimiento</label>
                    <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ── PLAN ── */}
          <section className="space-y-4">
            <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold border-t border-white/10 pt-4">Plan</p>

            <div className="space-y-1.5">
              <label className={labelCls}>Título de la OT</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="Descripción breve de la tarea" />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Tarea</label>
              <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} className={`${inputCls} resize-y`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>Responsable</label>
                <input value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className={inputCls} placeholder="Nombre del responsable" />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>F. Vencimiento</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Criterios de aceptación</label>
              <textarea rows={2} value={acceptanceCriteria} onChange={e => setAcceptanceCriteria(e.target.value)}
                className={`${inputCls} resize-y`} placeholder="Condiciones que deben cumplirse para dar la tarea por completada" />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>LOTO</label>
              <textarea rows={2} value={loto} onChange={e => setLoto(e.target.value)}
                className={`${inputCls} resize-y`} placeholder="Procedimiento de bloqueo y etiquetado" />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Nivel de Riesgo</label>
              <div className="flex gap-1.5">
                {RISK_LEVEL_OPTS.map(([val, label, activeCls, inactiveLabelCls]) => (
                  <button key={val} type="button"
                    onClick={() => setRiskLevel(riskLevel === val ? "" : val)}
                    className={`w-9 h-9 rounded-lg border font-bold text-sm transition-all ${riskLevel === val ? activeCls : `bg-white/5 ${inactiveLabelCls} hover:bg-white/10`}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Resultado Análisis de Riesgo</label>
              <textarea rows={2} value={riskAnalysisResult} onChange={e => setRiskAnalysisResult(e.target.value)}
                className={`${inputCls} resize-y`} placeholder="Ej: Aceptable con controles" />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Documento Checklist</label>
              {prefill?.checklistDocUrl ? (
                <a href={prefill.checklistDocUrl} target="_blank" rel="noreferrer"
                  className="block text-xs text-accent underline truncate">{prefill.checklistDocUrl}</a>
              ) : !prefill ? (
                <input type="file" onChange={e => setChecklistDocFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-text-industrial/60 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-accent/10 file:text-accent hover:file:bg-accent/20 cursor-pointer" />
              ) : (
                <p className="text-xs text-text-industrial/40 italic">Sin documento asociado</p>
              )}
            </div>
          </section>

          {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving}
            className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Crear OT"}
          </button>
        </div>
      </div>
    </div>
  );
};
