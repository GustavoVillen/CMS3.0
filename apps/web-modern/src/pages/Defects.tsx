import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Download, Loader2, Plus, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, PriorityBadge, StatusBadge, type Column } from "../components/DataTable";
import { fmtDate, FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";
import { useCopilotEmitter, useCopilotApplyFields, useCopilotScreenContext } from "../lib/copilot-context";
import { CreateWorkOrderModal } from "../components/CreateWorkOrderModal";

interface Defect {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  workOrderId: string | null;
  defectCode: string;
  status: string;
  severity: string;
  operationalState: string;
  classification: string;
  reportedAt: string;
  description: string;
  immediateAction: string | null;
  correctiveAction: string | null;
  rcaAnalysis: string | null;
  capaDescription: string | null;
  repairType: string | null;
  createdAt: string;
}

interface ListResponse {
  items: Defect[];
  total: number;
}

const OP_STATE_STYLES: Record<string, string> = {
  NORMAL: "bg-success-sea/10 text-success-sea border-success-sea/20",
  DEGRADED: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  RESTRICTED: "bg-accent/10 text-accent border-accent/20",
  NO_GO: "bg-red-500/10 text-red-400 border-red-500/20",
};

function OperationalStateBadge({ value }: { value: string }) {
  const cls = OP_STATE_STYLES[value] ?? "bg-white/5 text-text-industrial/40 border-white/10";
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${cls}`}>
      {value}
    </span>
  );
}

function normalizeOptionalText(value: string): string | null {
  const text = value.trim();
  return text || null;
}

function extractCloseNotes(correctiveAction: string | null): string | null {
  if (!correctiveAction || !correctiveAction.includes("[CLOSE]")) return null;
  const parts = correctiveAction.split("[CLOSE]");
  const last = parts[parts.length - 1]?.trim() ?? "";
  return last || correctiveAction.trim();
}

interface CloseDefectModalProps {
  defectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const CloseDefectModal: React.FC<CloseDefectModalProps> = ({ defectId, onClose, onSuccess }) => {
  const t = useT();
  const [closeNotes, setCloseNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/defects/${defectId}/close`, {
        closeNotes: closeNotes.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [closeNotes, defectId, onSuccess, t]);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">{t("def.close")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("def.closeNotes")}</label>
            <textarea
              rows={4}
              value={closeNotes}
              onChange={e => setCloseNotes(e.target.value)}
              placeholder="Notas de cierre (opcional)"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60"
            />
          </div>
          {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

async function downloadDefectPdf(defect: Defect) {
  const token = localStorage.getItem("gpms_token") ?? "";
  const slug  = localStorage.getItem("gpms_tenant_slug") ?? "";
  const res = await fetch(`/app/pms/defects/${defect.id}/pdf`, {
    headers: { Authorization: `Bearer ${token}`, "X-Tenant-Slug": slug },
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${defect.defectCode}-${defect.vesselCode}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}


// ─── CreateDefectModal ────────────────────────────────────────────────────────

interface CreateDefectModalProps {
  onClose: () => void;
  onCreated: (defect: Defect) => void;
}

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const OP_STATES  = ["NORMAL", "DEGRADED", "RESTRICTED", "NO_GO"];

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/10 transition-all disabled:opacity-50";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1.5";

const CreateDefectModal: React.FC<CreateDefectModalProps> = ({ onClose, onCreated }) => {
  const [vesselCode, setVesselCode]           = useState("");
  const [classification, setClassification]   = useState("");
  const [description, setDescription]         = useState("");
  const [severity, setSeverity]               = useState("MEDIUM");
  const [operationalState, setOperationalState] = useState("NORMAL");
  const [immediateAction, setImmediateAction] = useState("");
  const [saving, setSaving]                   = useState(false);
  const [err, setErr]                         = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vesselCode.trim())    { setErr("El código de buque es requerido."); return; }
    if (!classification.trim()) { setErr("La clasificación es requerida."); return; }
    if (!description.trim())   { setErr("La descripción es requerida."); return; }
    setSaving(true); setErr(null);
    try {
      const defect = await api.post<Defect>("/app/pms/defects", {
        vesselCode: vesselCode.trim().toUpperCase(),
        classification: classification.trim(),
        description: description.trim(),
        severity,
        operationalState,
        immediateAction: immediateAction.trim() || null,
      });
      onCreated(defect);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Error al crear el defecto.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">Nuevo Defecto</h2>
          <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={e => { void handleSubmit(e); }} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Buque *</label>
              <input value={vesselCode} onChange={e => setVesselCode(e.target.value.toUpperCase())} className={inputCls} placeholder="ej. LATERE" />
            </div>
            <div>
              <label className={labelCls}>Severidad</label>
              <select value={severity} onChange={e => setSeverity(e.target.value)} className={inputCls + " appearance-none"}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Estado operacional</label>
              <select value={operationalState} onChange={e => setOperationalState(e.target.value)} className={inputCls + " appearance-none"}>
                {OP_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Clasificación *</label>
              <input value={classification} onChange={e => setClassification(e.target.value)} className={inputCls} placeholder="ej. Mecánico" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Descripción *</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} className={inputCls + " resize-y"} placeholder="Describí el defecto encontrado…" />
          </div>
          <div>
            <label className={labelCls}>Acción inmediata</label>
            <textarea value={immediateAction} onChange={e => setImmediateAction(e.target.value)} rows={2} className={inputCls + " resize-y"} placeholder="Medidas tomadas de inmediato…" />
          </div>
          {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Crear defecto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── DefectModal ──────────────────────────────────────────────────────────────

interface DefectModalProps {
  defect: Defect;
  onClose: () => void;
  onSaved: () => void;
}

const fldCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60 transition-all";
const fldLabel = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider";

const DefectModal: React.FC<DefectModalProps> = ({ defect, onClose, onSaved }) => {
  const t = useT();
  const [description, setDescription]         = useState(defect.description ?? "");
  const [classification, setClassification]   = useState(defect.classification ?? "");
  const [severity, setSeverity]               = useState(defect.severity ?? "MEDIUM");
  const [operationalState, setOperationalState] = useState(defect.operationalState ?? "NORMAL");
  const [status, setStatus]                   = useState(defect.status ?? "OPEN");
  const [immediateAction, setImmediateAction] = useState(defect.immediateAction ?? "");
  const [correctiveAction, setCorrectiveAction] = useState(defect.correctiveAction ?? "");
  const [rcaAnalysis, setRcaAnalysis]         = useState(defect.rcaAnalysis ?? "");
  const [capaDescription, setCapaDescription] = useState(defect.capaDescription ?? "");
  const [repairType, setRepairType]           = useState<"TEMPORARIA" | "PERMANENTE" | null>(
    defect.repairType === "TEMPORARIA" || defect.repairType === "PERMANENTE" ? defect.repairType : null,
  );

  const [saving, setSaving]           = useState(false);
  const [closing, setClosing]         = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Post-save flow state
  const [postSaveStep, setPostSaveStep] = useState<null | "ask-permanent-wo">(null);
  const [showCreateWo, setShowCreateWo] = useState(false);

  useEffect(() => {
    setDescription(defect.description ?? "");
    setClassification(defect.classification ?? "");
    setSeverity(defect.severity ?? "MEDIUM");
    setOperationalState(defect.operationalState ?? "NORMAL");
    setStatus(defect.status ?? "OPEN");
    setImmediateAction(defect.immediateAction ?? "");
    setCorrectiveAction(defect.correctiveAction ?? "");
    setRcaAnalysis(defect.rcaAnalysis ?? "");
    setCapaDescription(defect.capaDescription ?? "");
    setRepairType(defect.repairType === "TEMPORARIA" || defect.repairType === "PERMANENTE" ? defect.repairType : null);
    setActionError(null);
    setPostSaveStep(null);
    setShowCreateWo(false);
  }, [defect]);

  const isClosed = defect.status === "CLOSED";
  const closeNotes = extractCloseNotes(defect.correctiveAction);
  const { setRequestMessage } = useCopilotScreenContext();

  useCopilotEmitter({
    module: "DEFECTS",
    screen: "DEFECT_EDIT",
    entityId: defect.id,
    entityCode: defect.defectCode,
    vesselCode: defect.vesselCode,
    workflowStage: defect.status,
    canEdit: !isClosed,
    fieldValues: {
      description:      description      || null,
      classification:   classification   || null,
      severity:         severity         || null,
      operationalState: operationalState || null,
      immediateAction:  immediateAction  || null,
      correctiveAction: correctiveAction || null,
      rcaAnalysis:      rcaAnalysis      || null,
      capaDescription:  capaDescription  || null,
    },
    relatedEntities: { workOrderId: defect.workOrderId },
  });

  useCopilotApplyFields(!isClosed ? (fields) => {
    if (fields.description      !== undefined) setDescription(fields.description);
    if (fields.classification   !== undefined) setClassification(fields.classification);
    if (fields.immediateAction  !== undefined) setImmediateAction(fields.immediateAction);
    if (fields.correctiveAction !== undefined) setCorrectiveAction(fields.correctiveAction);
    if (fields.rcaAnalysis      !== undefined) setRcaAnalysis(fields.rcaAnalysis);
    if (fields.capaDescription  !== undefined) setCapaDescription(fields.capaDescription);
  } : null);

  const patchDefect = useCallback(async () => {
    if (!description.trim()) { setActionError("La descripción breve es requerida."); return false; }
    if (!classification.trim()) { setActionError(t("def.classification")); return false; }
    setSaving(true); setActionError(null);
    try {
      await api.patch(`/app/pms/defects/${defect.id}`, {
        description: description.trim(),
        severity,
        operationalState,
        classification: classification.trim(),
        immediateAction: normalizeOptionalText(immediateAction),
        correctiveAction: normalizeOptionalText(correctiveAction),
        rcaAnalysis: normalizeOptionalText(rcaAnalysis),
        capaDescription: normalizeOptionalText(capaDescription),
        repairType: repairType ?? null,
        status,
      });
      return true;
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [capaDescription, classification, correctiveAction, defect.id, description, immediateAction, operationalState, rcaAnalysis, repairType, severity, status, t]);

  const closeDefectAndWo = useCallback(async () => {
    setClosing(true);
    try {
      // Backend requires RESOLVED before CLOSED
      if (defect.status !== "RESOLVED") {
        await api.patch(`/app/pms/defects/${defect.id}`, { status: "RESOLVED" });
      }
      if (defect.workOrderId) {
        await api.post(`/app/pms/work-orders/${defect.workOrderId}/close`, {
          woResult: "SATISFACTORY",
          observations: `Reparación permanente registrada en defecto ${defect.defectCode}`,
        }).catch(() => {}); // WO might already be closed — ignore
      }
      await api.post(`/app/pms/defects/${defect.id}/close`, {
        closeNotes: `Reparación permanente completada.${capaDescription ? ` CAPA: ${capaDescription}` : ""}`,
      });
      onSaved();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Error al cerrar el registro.");
    } finally {
      setClosing(false);
    }
  }, [capaDescription, defect.defectCode, defect.id, defect.workOrderId, onSaved]);

  const handleSave = useCallback(async () => {
    if (!await patchDefect()) return;
    if (repairType === "PERMANENTE") {
      await closeDefectAndWo();
    } else if (repairType === "TEMPORARIA") {
      setPostSaveStep("ask-permanent-wo");
    } else {
      onSaved();
    }
  }, [closeDefectAndWo, onSaved, patchDefect, repairType]);

  // "ask-permanent-wo" screen
  if (postSaveStep === "ask-permanent-wo") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="text-base font-bold text-white">Reparación temporaria registrada</h2>
            <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
          </div>
          <div className="p-6 space-y-3">
            <p className="text-sm text-white/80">La corrección fue temporaria. ¿Deseas ejecutar una nueva Orden de Trabajo para la reparación permanente?</p>
            <p className="text-xs text-text-industrial/40">Si creás la OT, se cerrará la OT original y se cerrará este registro de defecto.</p>
            {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
            <button onClick={onSaved} className="px-4 py-2 rounded-xl text-xs text-text-industrial/60 hover:text-white transition-colors">
              No, mantener abierto
            </button>
            <button
              onClick={() => { setPostSaveStep(null); setShowCreateWo(true); }}
              className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 transition-all"
            >
              Sí, crear OT permanente
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (showCreateWo) {
    return (
      <CreateWorkOrderModal
        prefill={{
          source: "defect",
          sourceId: defect.id,
          sourceCode: defect.defectCode,
          sourceLabel: "Defecto",
          vesselCode: defect.vesselCode,
          assetId: defect.assetId,
          type: "CORRECTIVE",
          priority: defect.severity,
          description: defect.description,
        }}
        onClose={() => { setShowCreateWo(false); onClose(); }}
        onSaved={async (woId) => {
          // Link new WO to the defect, then close defect + original WO
          await api.patch(`/app/pms/defects/${defect.id}`, { workOrderId: woId });
          setShowCreateWo(false);
          await closeDefectAndWo();
        }}
      />
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <div>
              <h2 className="text-base font-bold text-white">{t("page.defects")}</h2>
              <p className="text-[11px] text-text-industrial/50 font-mono">{defect.defectCode} · {defect.vesselCode}</p>
            </div>
            <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
          </div>

          <div className="p-6 space-y-4 max-h-[72vh] overflow-y-auto">
            {/* Meta info */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: t("def.reportedAt"), value: fmtDate(defect.reportedAt) },
                { label: t("col.status"),     value: defect.status },
                { label: t("col.severity"),   value: defect.severity },
                { label: t("def.operationalState"), value: defect.operationalState },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                  <p className="text-[9px] uppercase tracking-wider text-text-industrial/40 mb-0.5">{label}</p>
                  <p className="text-xs font-bold text-white truncate">{value}</p>
                </div>
              ))}
            </div>

            {isClosed && closeNotes && (
              <div className="rounded-xl border border-success-sea/20 bg-success-sea/10 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-success-sea mb-1">{t("def.closeNotes")}</p>
                <p className="text-sm text-success-sea">{closeNotes}</p>
              </div>
            )}

            {/* Descripción breve */}
            <div className="space-y-1.5">
              <label className={fldLabel}>Descripción breve</label>
              <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} disabled={isClosed} className={fldCls + " resize-y"} placeholder="Descripción concisa del defecto…" />
            </div>

            {/* Clasificación + selects */}
            <div className="space-y-1.5">
              <label className={fldLabel}>{t("def.classification")}</label>
              <input value={classification} onChange={e => setClassification(e.target.value)} disabled={isClosed} className={fldCls} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className={fldLabel}>{t("col.severity")}</label>
                <select value={severity} onChange={e => setSeverity(e.target.value)} disabled={isClosed} className={fldCls}>
                  {["LOW","MEDIUM","HIGH","CRITICAL"].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className={fldLabel}>{t("def.operationalState")}</label>
                <select value={operationalState} onChange={e => setOperationalState(e.target.value)} disabled={isClosed} className={fldCls}>
                  {["NORMAL","DEGRADED","RESTRICTED","NO_GO"].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className={fldLabel}>{t("col.status")}</label>
                <select value={status} onChange={e => setStatus(e.target.value)} disabled={isClosed} className={fldCls}>
                  {["OPEN","UNDER_REVIEW","IN_PROGRESS","DEFERRED","RESOLVED"].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
            </div>

            {/* Acción inmediata */}
            <div className="space-y-1.5">
              <label className={fldLabel}>{t("def.immediateAction")}</label>
              <textarea rows={2} value={immediateAction} onChange={e => setImmediateAction(e.target.value)} disabled={isClosed} className={fldCls + " resize-y"} placeholder="Medidas tomadas de inmediato…" />
            </div>

            {/* Análisis RCA */}
            <div className="space-y-1.5">
              <label className={fldLabel}>Análisis RCA</label>
              <textarea rows={3} value={rcaAnalysis} onChange={e => setRcaAnalysis(e.target.value)} disabled={isClosed} className={fldCls + " resize-y"} placeholder="Causa raíz identificada, metodología aplicada (5 Por qués, Fishbone, etc.)…" />
            </div>

            {/* CAPA */}
            <div className="space-y-1.5">
              <label className={fldLabel}>CAPA</label>
              <textarea rows={3} value={capaDescription} onChange={e => setCapaDescription(e.target.value)} disabled={isClosed} className={fldCls + " resize-y"} placeholder="Acción correctiva y preventiva (CAPA) — medidas para evitar recurrencia…" />
            </div>

            {/* Tipo de reparación — último campo */}
            {!isClosed && (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <p className="text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">¿La acción fue una corrección temporaria o permanente?</p>
                <div className="flex gap-2">
                  {(["TEMPORARIA", "PERMANENTE"] as const).map(rt => (
                    <button
                      key={rt}
                      type="button"
                      onClick={() => setRepairType(prev => prev === rt ? null : rt)}
                      className={`flex-1 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                        repairType === rt
                          ? rt === "PERMANENTE"
                            ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-400"
                            : "bg-yellow-500/15 border-yellow-500/50 text-yellow-400"
                          : "bg-white/5 border-white/10 text-text-industrial/50 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      {rt === "TEMPORARIA" ? "⚠ Temporaria" : "✓ Permanente"}
                    </button>
                  ))}
                </div>
                {repairType === "PERMANENTE" && (
                  <p className="text-[11px] text-emerald-400/70">Al guardar se cerrará la OT asociada y este registro de defecto.</p>
                )}
                {repairType === "TEMPORARIA" && (
                  <p className="text-[11px] text-yellow-400/70">Al guardar se preguntará si deseas crear una OT para la reparación permanente.</p>
                )}
              </div>
            )}

            {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
          </div>

          <div className="flex justify-between gap-2 px-6 py-4 border-t border-white/10">
            <div className="flex items-center gap-2">
              <button onClick={() => { void downloadDefectPdf(defect); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
              {!isClosed && (
                <button onClick={() => setShowCreateWo(true)} disabled={!!defect.workOrderId}
                  title={defect.workOrderId ? "Ya tiene una OT asociada" : undefined}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                  Crear OT Correctiva
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
              {!isClosed && (
                <button onClick={() => { void handleSave(); }} disabled={saving || closing}
                  className={`px-4 py-2 rounded-xl font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all ${
                    repairType === "PERMANENTE"
                      ? "bg-emerald-500/80 text-white"
                      : "bg-accent text-primary-bg"
                  }`}>
                  {(saving || closing) ? <Loader2 className="w-4 h-4 animate-spin" />
                    : repairType === "PERMANENTE" ? "Guardar y cerrar"
                    : t("common.save")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

    </>
  );
};

export const DefectsPage: React.FC = () => {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<Defect | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useCopilotEmitter(!editing ? { module: "DEFECTS", screen: "DEFECT_LIST" } : null);

  const statusFilter = (searchParams.get("status") ?? "").trim();
  const severityFilter = (searchParams.get("severity") ?? "").trim();
  const vesselFilter = (searchParams.get("vesselCode") ?? "").trim();
  const autoDefectId = searchParams.get("defectId");

  useEffect(() => {
    if (!autoDefectId) return;
    const params = new URLSearchParams(searchParams);
    params.delete("defectId");
    setSearchParams(params, { replace: true });
    api.get<Defect>(`/app/pms/defects/${autoDefectId}`)
      .then(d => setEditing(d))
      .catch(() => {});
  }, [autoDefectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [vesselInput, setVesselInput] = useState(vesselFilter);

  useEffect(() => {
    setVesselInput(vesselFilter);
  }, [vesselFilter]);

  const updateFilters = useCallback((next: { status?: string; severity?: string; vesselCode?: string }) => {
    const params = new URLSearchParams(searchParams);
    const nextStatus = next.status !== undefined ? next.status : statusFilter;
    const nextSeverity = next.severity !== undefined ? next.severity : severityFilter;
    const nextVessel = next.vesselCode !== undefined ? next.vesselCode : vesselFilter;
    if (nextStatus) params.set("status", nextStatus); else params.delete("status");
    if (nextSeverity) params.set("severity", nextSeverity); else params.delete("severity");
    if (nextVessel) params.set("vesselCode", nextVessel); else params.delete("vesselCode");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams, severityFilter, statusFilter, vesselFilter]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (severityFilter) params.set("severity", severityFilter);
    if (vesselFilter) params.set("vesselCode", vesselFilter);
    const query = params.toString();
    return `/app/pms/defects${query ? `?${query}` : ""}`;
  }, [severityFilter, statusFilter, vesselFilter]);

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);

  const openDetail = useCallback(async (row: Defect) => {
    setDetailLoadingId(row.id);
    setDetailError(null);
    try {
      const detailed = await api.get<Defect>(`/app/pms/defects/${row.id}`);
      setEditing(detailed);
    } catch (err) {
      setEditing(row);
      setDetailError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle del defecto.");
    } finally {
      setDetailLoadingId(null);
    }
  }, []);

  const columns: Column<Defect>[] = useMemo(() => [
    {
      key: "defectCode",
      header: t("col.code"),
      render: row => <span className="font-mono font-bold text-white text-xs">{row.defectCode}</span>,
    },
    {
      key: "classification",
      header: t("def.classification"),
      render: row => <span className="font-medium text-white line-clamp-1">{row.classification}</span>,
    },
    {
      key: "vesselCode",
      header: t("col.vessel"),
      render: row => <span className="font-mono text-accent text-xs">{row.vesselCode}</span>,
    },
    {
      key: "severity",
      header: t("col.severity"),
      render: row => <PriorityBadge priority={row.severity} />,
    },
    {
      key: "operationalState",
      header: t("def.operationalState"),
      render: row => <OperationalStateBadge value={row.operationalState} />,
    },
    {
      key: "status",
      header: t("col.status"),
      render: row => <StatusBadge status={row.status} />,
    },
    {
      key: "reportedAt",
      header: t("def.reportedAt"),
      render: row => fmtDate(row.reportedAt),
    },
  ], [t]);

  return (
    <div className="space-y-5">
      <PageHeader icon={AlertTriangle} title={t("page.defects")} total={data?.total} onReload={reload}>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent text-xs font-bold hover:bg-accent/20 transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> Nuevo Defecto
        </button>
        <select value={toFilterSelectValue(statusFilter)} onChange={e => updateFilters({ status: fromFilterSelectValue(e.target.value) })} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="OPEN">{t("status.open")}</option>
          <option value="UNDER_REVIEW">UNDER_REVIEW</option>
          <option value="IN_PROGRESS">{t("status.inProgress")}</option>
          <option value="DEFERRED">DEFERRED</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="CLOSED">{t("status.closed")}</option>
        </select>

        <select value={toFilterSelectValue(severityFilter)} onChange={e => updateFilters({ severity: fromFilterSelectValue(e.target.value) })} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>

        <div className="flex items-center gap-2">
          <input value={vesselInput} onChange={e => setVesselInput(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === "Enter") updateFilters({ vesselCode: vesselInput.trim() }); }} placeholder={t("common.filterByVessel")} className="w-44 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          <button onClick={() => updateFilters({ vesselCode: vesselInput.trim() })} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">{t("common.apply")}</button>
          {(statusFilter || severityFilter || vesselFilter) && (
            <button onClick={() => updateFilters({ status: "", severity: "", vesselCode: "" })} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial/80 hover:text-white hover:border-red-400/40 transition-all">{t("common.clear")}</button>
          )}
        </div>
      </PageHeader>

      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />Cargando detalle del defecto...</div>}
      {detailError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{detailError}</p>}

      <DataTable columns={columns} data={data?.items ?? null} loading={loading} error={error} keyFn={row => row.id} emptyText={t("empty.defects")} onRowClick={row => { void openDetail(row); }} />

      {creating && (
        <CreateDefectModal
          onClose={() => setCreating(false)}
          onCreated={defect => { setCreating(false); void reload(); setEditing(defect); }}
        />
      )}
      {editing && (
        <DefectModal
          defect={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
};
