// Management of Change (MOC) — workflow formal de cambios significativos.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GitBranch, Plus, Loader2, X, CheckCircle2, XCircle, Clock as ClockIcon, Sparkles, Download } from "lucide-react";
import { downloadAuthedFile } from "../lib/authed-media";
import { useFetch } from "../lib/hooks";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { MocRegiSections, initRegiForm, serializeRegi, computeRequiresFull, type RegiForm } from "../components/moc/MocRegiSections";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { useDeepLink } from "../lib/deep-link";
import { CopyLinkButton } from "../components/CopyLinkButton";
import { VesselLabel } from "../components/EntityLabels";
import { fmtDate } from "../lib/utils";
import { useT } from "../lib/i18n";

const CATEGORY_LABEL: Record<string, string> = {
  EQUIPMENT_CHANGE: "Cambio de equipo",
  PROCEDURE_CHANGE: "Cambio de procedimiento",
  ORGANIZATIONAL: "Organizacional",
  TEMPORARY: "Cambio temporal",
  SOFTWARE_FIRMWARE: "Software / Firmware",
  OTHER: "Otro",
};

const RISK_LABEL: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Crítico" };
const RISK_COLOR: Record<string, string> = {
  LOW:      "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
  MEDIUM:   "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  HIGH:     "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
  CRITICAL: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
};

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Solicitado",
  UNDER_ANALYSIS: "En análisis",
  APPROVED: "Aprobado",
  IN_PROGRESS: "Implementando",
  IMPLEMENTED: "Implementado",
  REVIEWED: "Revisado",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
};

const STATUS_COLOR: Record<string, string> = {
  REQUESTED:      "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
  UNDER_ANALYSIS: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  APPROVED:       "bg-success-sea/10 text-success-sea border-success-sea/30",
  IN_PROGRESS:    "bg-accent/15 text-accent border-accent/40",
  IMPLEMENTED:    "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
  REVIEWED:       "bg-success-sea/15 text-success-sea border-success-sea/40",
  REJECTED:       "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
  CANCELLED:      "bg-fg/5 text-text-industrial/50 border-fg/10",
};

const IMPACT_AREAS = ["Safety", "Environment", "Operational", "Crew training", "Regulatory", "Cost"];

/**
 * Templates por categoría — prefilla impactAreas, nivel de riesgo sugerido y
 * placeholders que guían al user sobre qué escribir. Sin estos templates el
 * form en blanco intimida y la calidad de la información cae.
 */
interface CategoryTemplate {
  defaultRiskLevel: string;
  defaultImpactAreas: string[];
  reasonPlaceholder: string;
  proposedPlaceholder: string;
  riskAssessmentPlaceholder: string;
  mitigationPlaceholder: string;
}

const CATEGORY_TEMPLATES: Record<string, CategoryTemplate> = {
  EQUIPMENT_CHANGE: {
    defaultRiskLevel: "MEDIUM",
    defaultImpactAreas: ["Safety", "Operational"],
    reasonPlaceholder: "Ej: el equipo X actual no cumple con la nueva regulación / el fabricante discontinuó el repuesto / se aumenta capacidad por demanda operativa…",
    proposedPlaceholder: "Ej: reemplazo del equipo marca A modelo X por marca B modelo Y, instalación de nuevos accesorios, recableado…",
    riskAssessmentPlaceholder: "Ej: compatibilidad con sistemas adyacentes, certificación clase requerida, capacitación de tripulación necesaria…",
    mitigationPlaceholder: "Ej: prueba de aceptación a bordo, supervisión de surveyor de clase, entrenamiento previo a la operación…",
  },
  PROCEDURE_CHANGE: {
    defaultRiskLevel: "MEDIUM",
    defaultImpactAreas: ["Safety", "Operational", "Crew training"],
    reasonPlaceholder: "Ej: el procedimiento actual no contempla X situación / observación de auditoría / nueva guía del armador…",
    proposedPlaceholder: "Ej: nueva secuencia paso a paso, cambio en frecuencia, modificación del checklist…",
    riskAssessmentPlaceholder: "Ej: ¿qué pasa si el procedimiento se aplica mal? ¿qué riesgos nuevos introduce?",
    mitigationPlaceholder: "Ej: capacitación previa, drill de prueba, supervisión inicial por master, revisión a los 30 días…",
  },
  ORGANIZATIONAL: {
    defaultRiskLevel: "MEDIUM",
    defaultImpactAreas: ["Safety", "Regulatory"],
    reasonPlaceholder: "Ej: cambio permanente de Master / Chief Engineer / DPA / superintendente…",
    proposedPlaceholder: "Ej: nuevo titular del rol, fecha efectiva, redistribución de responsabilidades ISM…",
    riskAssessmentPlaceholder: "Ej: experiencia del entrante, conocimiento del buque/flota, handover requerido…",
    mitigationPlaceholder: "Ej: handover formal documentado, período de superposición, training específico de ISM…",
  },
  TEMPORARY: {
    defaultRiskLevel: "HIGH",
    defaultImpactAreas: ["Safety", "Operational"],
    reasonPlaceholder: "Ej: bypass temporal de la alarma X mientras se calibra / operación con redundancia reducida hasta próximo puerto…",
    proposedPlaceholder: "Ej: anular sensor X y operar manualmente por 14 días / utilizar bomba B mientras se repara A…",
    riskAssessmentPlaceholder: "Ej: ¿qué protección se pierde mientras dura el bypass? ¿qué escenarios deja de cubrir?",
    mitigationPlaceholder: "Ej: rondas adicionales cada 2h, alarma alternativa, restricción operativa, fecha máxima de cierre del bypass…",
  },
  SOFTWARE_FIRMWARE: {
    defaultRiskLevel: "MEDIUM",
    defaultImpactAreas: ["Safety", "Operational"],
    reasonPlaceholder: "Ej: actualización de firmware del ECDIS / BMS / sistema de gobierno…",
    proposedPlaceholder: "Ej: versión actual → versión nueva, motivos del fabricante, cambios en la interfaz…",
    riskAssessmentPlaceholder: "Ej: compatibilidad con periféricos, posibilidad de rollback, riesgo de operación con sistema offline durante la actualización…",
    mitigationPlaceholder: "Ej: backup pre-actualización, ventana en puerto, soporte del fabricante en línea, plan de rollback…",
  },
  OTHER: {
    defaultRiskLevel: "MEDIUM",
    defaultImpactAreas: ["Operational"],
    reasonPlaceholder: "Ej: cambio de marca de aceite / proveedor de servicio / ruta operativa…",
    proposedPlaceholder: "Describí el cambio puntualmente",
    riskAssessmentPlaceholder: "¿Qué áreas se ven afectadas?",
    mitigationPlaceholder: "Acciones concretas para mitigar los riesgos identificados",
  },
};

/**
 * Prefill opcional para abrir el modal con campos pre-cargados desde otros
 * módulos (Deferral → MOC TEMPORARY, Defect crítico → MOC TEMPORARY, etc.).
 */
export interface MocPrefill {
  category?: string;
  title?: string;
  reasonForChange?: string;
  proposedChange?: string;
  riskLevel?: string;
  impactAreas?: string[];
  mitigationActions?: string;
  vesselCode?: string;
  relatedAssetId?: string;
  relatedWorkOrderId?: string;
  /** Etiqueta breve que aparece arriba del form, ej. "Desde Postergación APL-…". */
  sourceLabel?: string;
}

interface Moc {
  id: string;
  mocCode: string;
  vesselCode: string;
  category: string;
  status: string;
  title: string;
  reasonForChange: string;
  proposedChange: string;
  riskLevel: string;
  impactAreasJson: string[];
  riskAssessmentNotes: string | null;
  mitigationActions: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  rejectedReason: string | null;
  plannedDate: string | null;
  implementedAt: string | null;
  implementedByName: string | null;
  implementationNotes: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  reviewOutcome: string | null;
  createdAt: string;
}

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1.5";


// ─── Modal ───────────────────────────────────────────────────────────────────

export const MocModal: React.FC<{ moc: Moc | null; prefill?: MocPrefill; onClose: () => void; onSaved: () => void }> = ({ moc, prefill, onClose, onSaved }) => {
  const t = useT();
  const { vessels } = useVesselContext();
  const { user } = useAuth();
  const isNew = !moc;
  const canApprove = user?.role === "TENANT_ADMIN" || user?.role === "FLEET_SUPERINTENDENT";
  const isAdmin = user?.role === "TENANT_ADMIN";

  // Inicialización: si hay moc → editar; si hay prefill → prefill; si no → defaults.
  const initial = (() => {
    if (moc) {
      return {
        vesselCode: moc.vesselCode,
        category: moc.category,
        title: moc.title,
        reasonForChange: moc.reasonForChange,
        proposedChange: moc.proposedChange,
        riskLevel: moc.riskLevel,
        impactAreas: moc.impactAreasJson ?? [],
        riskAssessmentNotes: moc.riskAssessmentNotes ?? "",
        mitigationActions: moc.mitigationActions ?? "",
        plannedDate: moc.plannedDate?.slice(0, 10) ?? "",
      };
    }
    const cat = prefill?.category ?? "EQUIPMENT_CHANGE";
    const tpl = CATEGORY_TEMPLATES[cat];
    return {
      vesselCode: prefill?.vesselCode ?? vessels[0]?.code ?? "",
      category: cat,
      title: prefill?.title ?? "",
      reasonForChange: prefill?.reasonForChange ?? "",
      proposedChange: prefill?.proposedChange ?? "",
      riskLevel: prefill?.riskLevel ?? tpl?.defaultRiskLevel ?? "MEDIUM",
      impactAreas: prefill?.impactAreas ?? tpl?.defaultImpactAreas ?? [],
      riskAssessmentNotes: "",
      mitigationActions: prefill?.mitigationActions ?? "",
      plannedDate: "",
    };
  })();

  const [vesselCode, setVesselCode] = useState(initial.vesselCode);
  const [category, setCategory]   = useState(initial.category);
  const [title, setTitle]         = useState(initial.title);
  const [reasonForChange, setReason]   = useState(initial.reasonForChange);
  const [proposedChange, setProposed]  = useState(initial.proposedChange);
  const [riskLevel, setRiskLevel] = useState(initial.riskLevel);
  const [impactAreas, setImpactAreas] = useState<string[]>(initial.impactAreas);
  const [riskAssessmentNotes, setRAN]  = useState(initial.riskAssessmentNotes);
  const [mitigationActions, setMA]    = useState(initial.mitigationActions);
  const [plannedDate, setPlanned] = useState(initial.plannedDate);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aiLoadingRisk, setAiLoadingRisk] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Estado "REGI-GES-06.1" (campos del formulario controlado más allá de los base).
  const [regi, setRegi] = useState<RegiForm>(() => initRegiForm(moc as unknown as Record<string, unknown> | null));
  const updateRegi = (patch: Partial<RegiForm>) => setRegi(prev => ({ ...prev, ...patch }));
  const requiresFull = computeRequiresFull(regi, riskLevel);
  const units = vessels.map(v => ({ code: v.code, name: v.name }));
  const regiInitialStr = useMemo(
    () => JSON.stringify(serializeRegi(initRegiForm(moc as unknown as Record<string, unknown> | null))),
    [moc],
  );
  const regiStr = JSON.stringify(serializeRegi(regi));
  const regiDirty = regiStr !== regiInitialStr;

  // Detección de cambios sin guardar (dirty check). Comparamos los campos
  // editables contra los valores del moc original. Sirve para que el botón
  // PDF guarde silenciosamente antes de descargar.
  const isDirty = !!moc && (
    moc.title !== title ||
    moc.reasonForChange !== reasonForChange ||
    moc.proposedChange !== proposedChange ||
    moc.riskLevel !== riskLevel ||
    (moc.riskAssessmentNotes ?? "") !== riskAssessmentNotes ||
    (moc.mitigationActions ?? "") !== mitigationActions ||
    moc.category !== category ||
    (moc.plannedDate?.slice(0, 10) ?? "") !== plannedDate ||
    JSON.stringify(moc.impactAreasJson ?? []) !== JSON.stringify(impactAreas) ||
    regiDirty
  );

  const handleDownloadPdf = async () => {
    if (!moc || generatingPdf) return;
    setGeneratingPdf(true);
    setErr(null);
    try {
      // Si hay cambios sin guardar, los guardamos primero para que el PDF
      // refleje el estado actual del form (no la versión vieja de DB).
      if (isDirty && !isLocked) {
        const payload = {
          vesselCode, category, title, reasonForChange, proposedChange, riskLevel,
          impactAreas,
          riskAssessmentNotes: riskAssessmentNotes.trim() || null,
          mitigationActions: mitigationActions.trim() || null,
          plannedDate: plannedDate || null,
          relatedAssetId: prefill?.relatedAssetId ?? null,
          relatedWorkOrderId: prefill?.relatedWorkOrderId ?? null,
          ...serializeRegi(regi),
        };
        await api.patch(`/app/mocs/${moc.id}`, payload);
      }
      await downloadAuthedFile(`/app/mocs/${moc.id}/pdf`, `${moc.mocCode}-${moc.vesselCode}.pdf`);
      if (isDirty) onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al generar PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  // Una sola llamada genera AMBOS campos: análisis de riesgo + medidas de
  // mitigación. La IA responde con dos bloques separados por un marcador, y
  // el backend los separa antes de devolverlos. Si el user ya tenía algo
  // escrito en cualquiera de los dos campos, se pasa como contexto para que
  // la IA lo integre en vez de pisarlo.
  const suggestRiskAssessmentAI = async () => {
    if (aiLoadingRisk || isLocked) return;
    setAiLoadingRisk(true);
    setErr(null);
    try {
      const res = await api.post<{ riskAssessment: string; mitigation: string }>(
        "/app/mocs/suggest-risk-assessment",
        {
          vesselCode, category, title, reasonForChange, proposedChange, riskLevel,
          impactAreas,
          currentNotes: riskAssessmentNotes,
          mitigationActions,
        },
      );
      if (res.riskAssessment?.trim()) setRAN(res.riskAssessment.trim());
      if (res.mitigation?.trim())     setMA(res.mitigation.trim());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo generar el análisis con IA.");
    } finally {
      setAiLoadingRisk(false);
    }
  };

  // Al cambiar categoría en un MOC nuevo, aplicar el template (impactAreas
  // y riskLevel) si el user no los tocó (heurística: aún coinciden con el
  // template previo). En MOC editado no pisamos nada.
  const onCategoryChange = (newCat: string) => {
    setCategory(newCat);
    if (!isNew) return;
    const tpl = CATEGORY_TEMPLATES[newCat];
    if (!tpl) return;
    setImpactAreas(tpl.defaultImpactAreas);
    setRiskLevel(tpl.defaultRiskLevel);
  };

  const template = CATEGORY_TEMPLATES[category];

  const toggleImpact = (area: string) => {
    setImpactAreas(prev => prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]);
  };

  const isLocked = moc?.status ? ["REVIEWED", "CANCELLED", "REJECTED"].includes(moc.status) : false;

  const onSave = async () => {
    if (!vesselCode || !category || !title.trim() || !reasonForChange.trim() || !proposedChange.trim()) {
      setErr("Completá vessel, tipo, título, razón y cambio propuesto."); return;
    }
    setSaving(true); setErr(null);
    try {
      const payload = {
        vesselCode, category, title, reasonForChange, proposedChange, riskLevel,
        impactAreas,
        riskAssessmentNotes: riskAssessmentNotes.trim() || null,
        mitigationActions: mitigationActions.trim() || null,
        plannedDate: plannedDate || null,
        // Vínculos opcionales que vienen del prefill (Defect, OT, etc.).
        relatedAssetId: prefill?.relatedAssetId ?? null,
        relatedWorkOrderId: prefill?.relatedWorkOrderId ?? null,
        // Campos del formulario controlado REGI-GES-06.1.
        ...serializeRegi(regi),
      };
      if (isNew) await api.post("/app/mocs", payload);
      else await api.patch(`/app/mocs/${moc!.id}`, payload);
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setSaving(false); }
  };

  const transition = async (nextStatus: string, extra: Record<string, unknown> = {}) => {
    if (!moc) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/mocs/${moc.id}/transition`, { status: nextStatus, ...extra });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setSaving(false); }
  };

  const askAndTransition = (nextStatus: string, field: string, label: string) => {
    const value = window.prompt(label);
    if (value === null) return;
    void transition(nextStatus, { [field]: value });
  };

  const onDelete = async () => {
    if (!moc || !isAdmin) return;
    if (!window.confirm(t("confirm.deleteNamed").replace("{code}", moc.mocCode))) return;
    try { await api.delete(`/app/mocs/${moc.id}`); onSaved(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
  };

  // ESC: cerrar / preguntar guardar si hay cambios
  const escDirty = useDirtyTracker({ vesselCode, category, title, reasonForChange, proposedChange, riskLevel, riskAssessmentNotes, mitigationActions, plannedDate, impactAreas, regi: regiStr });
  useEscapeGuard({ isDirty: !isLocked && escDirty, onSave: isLocked ? undefined : onSave, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <div className="flex items-center gap-3">
            <GitBranch className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">MOC</p>
              <h2 className="text-sm font-bold text-fg">{isNew ? "Nuevo MOC" : moc!.mocCode}</h2>
            </div>
            {moc && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${STATUS_COLOR[moc.status]}`}>
                {STATUS_LABEL[moc.status]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {!isNew && <CopyLinkButton />}
            <ModalCloseButton onClose={onClose} />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-3">
          {prefill?.sourceLabel && (
            <div className="rounded-xl bg-accent/[0.06] border border-accent/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-accent font-bold">{t("moc.origin")}</p>
              <p className="text-xs text-text-industrial mt-0.5">{prefill.sourceLabel}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>{t("form.vessel")}</label>
              <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={!isNew || isLocked} className={inputCls}>
                {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>{t("moc.categoryReq")}</label>
              <select value={category} onChange={e => onCategoryChange(e.target.value)} disabled={isLocked} className={inputCls}>
                {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="col-span-2"><label className={labelCls}>{t("moc.titleReq")}</label>
              <input value={title} onChange={e => setTitle(e.target.value)} disabled={isLocked} placeholder={t("moc.titlePh")} className={inputCls} />
            </div>
            <div className="col-span-2"><label className={labelCls}>{t("moc.reasonReq")}</label>
              <textarea rows={2} value={reasonForChange} onChange={e => setReason(e.target.value)} disabled={isLocked} placeholder={template?.reasonPlaceholder} className={inputCls + " resize-y"} />
            </div>
            <div className="col-span-2"><label className={labelCls}>{t("moc.proposedReq")}</label>
              <textarea rows={2} value={proposedChange} onChange={e => setProposed(e.target.value)} disabled={isLocked} placeholder={template?.proposedPlaceholder} className={inputCls + " resize-y"} />
            </div>
            <div><label className={labelCls}>{t("moc.risk")}</label>
              <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)} disabled={isLocked} className={inputCls}>
                {Object.entries(RISK_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>{t("moc.plannedDate")}</label>
              <input type="date" value={plannedDate} onChange={e => setPlanned(e.target.value)} disabled={isLocked} className={inputCls} />
            </div>
            <div className="col-span-2"><label className={labelCls}>{t("moc.impactAreas")}</label>
              <div className="flex flex-wrap gap-1.5">
                {IMPACT_AREAS.map(a => (
                  <button key={a} type="button" disabled={isLocked} onClick={() => toggleImpact(a)}
                    className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${
                      impactAreas.includes(a) ? "bg-accent/20 text-accent border-accent/40" : "bg-fg/5 text-text-industrial/60 border-fg/10"
                    }`}>{a}</button>
                ))}
              </div>
            </div>
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelCls + " mb-0"}>{t("moc.riskAnalysisNotes")}</label>
                <button
                  type="button"
                  onClick={() => { void suggestRiskAssessmentAI(); }}
                  disabled={isLocked || aiLoadingRisk || !category || !proposedChange.trim()}
                  title={!proposedChange.trim()
                    ? "Completá primero el cambio propuesto"
                    : "Generar análisis de riesgo con IA experta en SMS"}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 border border-accent/30 text-[10px] font-bold uppercase tracking-wider text-accent hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {aiLoadingRisk
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Sparkles className="w-3 h-3" />}
                  {aiLoadingRisk ? "Generando…" : "Asistir con IA"}
                </button>
              </div>
              <textarea rows={6} value={riskAssessmentNotes} onChange={e => setRAN(e.target.value)} disabled={isLocked} placeholder={template?.riskAssessmentPlaceholder} className={inputCls + " resize-y font-mono text-[12px]"} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>{t("moc.mitigationMeasures")}</label>
              <textarea rows={6} value={mitigationActions} onChange={e => setMA(e.target.value)} disabled={isLocked} placeholder={template?.mitigationPlaceholder} className={inputCls + " resize-y font-mono text-[12px]"} />
            </div>
          </div>

          {/* Secciones del formulario controlado REGI-GES-06.1 (revelado progresivo). */}
          <MocRegiSections form={regi} onChange={updateRegi} disabled={isLocked} requiresFull={requiresFull} units={units} />

          {moc && (
            <div className="rounded-lg bg-fg/[0.04] border border-fg/10 p-3 space-y-1.5 text-[11px]">
              <p className="font-bold uppercase tracking-wider text-text-industrial/50">{t("moc.traceability")}</p>
              {moc.approvedAt && <p className="text-text-industrial/70">Aprobado por {moc.approvedByName ?? "—"} el {fmtDate(moc.approvedAt)}</p>}
              {moc.rejectedReason && <p className="text-red-700 dark:text-red-300">Rechazado: {moc.rejectedReason}</p>}
              {moc.implementedAt && <p className="text-text-industrial/70">Implementado el {fmtDate(moc.implementedAt)}{moc.implementedByName ? ` por ${moc.implementedByName}` : ""}.{moc.implementationNotes ? ` ${moc.implementationNotes}` : ""}</p>}
              {moc.reviewedAt && <p className="text-success-sea">Revisado el {fmtDate(moc.reviewedAt)}: {moc.reviewOutcome ?? "—"}.{moc.reviewNotes ? ` ${moc.reviewNotes}` : ""}</p>}
            </div>
          )}

          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t border-fg/10 shrink-0 flex-wrap">
          <div className="flex flex-wrap gap-2">
            {/* Transiciones según estado */}
            {moc?.status === "REQUESTED" && (
              <button onClick={() => { void transition("UNDER_ANALYSIS"); }} disabled={saving} className="px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-700 dark:text-yellow-300 text-xs disabled:opacity-50">{t("moc.startAnalysis")}</button>
            )}
            {moc?.status === "UNDER_ANALYSIS" && canApprove && (
              <>
                <button onClick={() => askAndTransition("APPROVED", "approvedByName", "Nombre del aprobador:")} disabled={saving} className="px-3 py-2 rounded-xl bg-success-sea/10 border border-success-sea/30 text-success-sea text-xs flex items-center gap-1 disabled:opacity-50"><CheckCircle2 className="w-3.5 h-3.5" /> Aprobar</button>
                <button onClick={() => askAndTransition("REJECTED", "rejectedReason", "Motivo del rechazo:")} disabled={saving} className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-xs flex items-center gap-1 disabled:opacity-50"><XCircle className="w-3.5 h-3.5" /> Rechazar</button>
              </>
            )}
            {moc?.status === "APPROVED" && (
              <button onClick={() => { void transition("IN_PROGRESS"); }} disabled={saving} className="px-3 py-2 rounded-xl bg-accent/10 border border-accent/30 text-accent text-xs disabled:opacity-50">{t("moc.startImplementation")}</button>
            )}
            {moc?.status === "IN_PROGRESS" && (
              <button onClick={() => askAndTransition("IMPLEMENTED", "implementationNotes", t("moc.implementationNotes"))} disabled={saving} className="px-3 py-2 rounded-xl bg-purple-500/15 border border-purple-500/40 text-purple-700 dark:text-purple-300 text-xs disabled:opacity-50">{t("moc.markImplemented")}</button>
            )}
            {moc?.status === "IMPLEMENTED" && (
              <button onClick={() => askAndTransition("REVIEWED", "reviewOutcome", "Resultado revisión (SATISFACTORY / WITH_OBSERVATIONS):")} disabled={saving} className="px-3 py-2 rounded-xl bg-success-sea/15 border border-success-sea/40 text-success-sea text-xs flex items-center gap-1 disabled:opacity-50"><ClockIcon className="w-3.5 h-3.5" /> Revisar y cerrar</button>
            )}
            {moc && !["REVIEWED", "CANCELLED", "REJECTED"].includes(moc.status) && (
              <button onClick={() => { void transition("CANCELLED"); }} disabled={saving} className="px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-text-industrial/60 text-xs hover:text-red-400 disabled:opacity-50">{t("moc.cancelMoc")}</button>
            )}
            {!isNew && isAdmin && (
              <button onClick={() => { void onDelete(); }} className="px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-text-industrial/60 text-xs hover:text-red-400">{t("common.delete")}</button>
            )}
          </div>
          <div className="flex gap-2">
            {!isNew && moc && (
              <button
                type="button"
                onClick={() => { void handleDownloadPdf(); }}
                disabled={generatingPdf || saving}
                title={isDirty ? "Guarda los cambios y descarga el PDF" : "Descargar PDF del MOC"}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 disabled:opacity-50 transition-all"
              >
                {generatingPdf
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Download className="w-3.5 h-3.5" />}
                PDF
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.close")}</button>
            {!isLocked && (
              <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── MocFilterGate ───────────────────────────────────────────────────────────
// Pregunta-filtro educativa al abrir "Nuevo MOC" desde la página. Sirve para
// que el user decida si su cambio realmente necesita MOC antes de empezar a
// completar el form. Se evita en flujos con prefill (Deferral/Defect), donde
// el sistema YA decidió que el cambio amerita MOC.

const MocFilterGate: React.FC<{ onProceed: () => void; onCancel: () => void }> = ({ onProceed, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
    <div className="w-full max-w-xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-bold text-fg">¿Tu cambio necesita MOC?</h2>
      </div>
      <p className="text-sm text-text-industrial leading-relaxed">
        Iniciá un MOC formal solo si, después del cambio,
        <span className="text-fg font-bold"> el barco va a operar o mantenerse de manera diferente a lo que dice el manual / SMS / plan aprobado.</span>
      </p>
      <div className="rounded-xl bg-fg/5 border border-fg/10 p-3 text-[11px] text-text-industrial leading-relaxed space-y-1">
        <p className="text-success-sea font-bold">SÍ necesita MOC:</p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>Reemplazo por equipo de <strong>distinta marca/modelo/capacidad</strong></li>
          <li>Bypass temporal de un safety device</li>
          <li>Operación con redundancia degradada hasta próximo puerto</li>
          <li>Cambio permanente de Master / Chief Engineer / DPA</li>
          <li>Actualización de firmware de sistemas críticos</li>
          <li>Cambio de marca de aceite / combustible</li>
        </ul>
        <p className="text-text-industrial/50 font-bold pt-2">NO necesita MOC:</p>
        <ul className="list-disc pl-4 space-y-0.5 text-text-industrial/60">
          <li>Reemplazo por el <strong>mismo modelo</strong> idéntico</li>
          <li>Relevo rotativo de tripulación previsto</li>
          <li>Mantenimiento preventivo dentro del plan</li>
          <li>Reparación que devuelve al estado original</li>
        </ul>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">
          No, es operación rutinaria
        </button>
        <button onClick={onProceed} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Sí, abrir MOC
        </button>
      </div>
    </div>
  </div>
);

// ─── Page ────────────────────────────────────────────────────────────────────

export const MocPage: React.FC = () => {
  const [filterStatus, setFilterStatus] = useState<"all" | "open">("open");
  const { data, loading, reload } = useFetch<{ items: Moc[] }>("/app/mocs");
  const [showFilterGate, setShowFilterGate] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Moc | null>(null);
  const { code: linkCode, open: openLink, close: closeLink } = useDeepLink("/moc");
  // Deep-link desde la alerta "sin procesar" del Dashboard: ?status=REQUESTED
  // filtra exactamente a ese estado (tiene prioridad sobre el toggle open/all).
  const [searchParams] = useSearchParams();
  const statusParam = (searchParams.get("status") ?? "").trim();

  const items = (data?.items ?? []).filter(m =>
    statusParam ? m.status === statusParam
    : filterStatus === "open" ? !["REVIEWED", "CANCELLED", "REJECTED"].includes(m.status)
    : true,
  );

  // Deep-link: la URL `/moc/:code` es la fuente de verdad del detalle.
  useEffect(() => {
    if (!linkCode) { if (editing) setEditing(null); return; }
    if (editing?.mocCode === linkCode) return;
    const match = data?.items?.find(m => m.mocCode === linkCode);
    if (match) setEditing(match);
  }, [linkCode, data, editing]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={GitBranch} title="Management of Change (MOC)" total={items.length} onReload={reload}>
        <ExportExcelButton module="moc" />
        <button onClick={() => setShowFilterGate(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110">
          <Plus className="w-3.5 h-3.5" /> Nuevo MOC
        </button>
      </PageHeader>

      <div className="flex gap-2">
        {([["open", "Abiertos"], ["all", "Todos"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilterStatus(v)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${
              filterStatus === v ? "bg-accent/15 text-accent border-accent/40" : "bg-fg/5 text-text-industrial/60 border-fg/10"
            }`}>{l}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">Sin MOCs.</div>
      ) : (
        <div className="bg-fg/5 border border-fg/10 rounded-xl divide-y divide-fg/5">
          {items.map(m => (
            <button key={m.id} onClick={() => openLink(m.mocCode)} className="w-full text-left p-4 hover:bg-fg/5 transition-colors flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[10px] font-mono text-text-industrial/40">{m.mocCode}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${STATUS_COLOR[m.status]}`}>
                    {STATUS_LABEL[m.status]}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${RISK_COLOR[m.riskLevel]}`}>
                    Riesgo {RISK_LABEL[m.riskLevel]}
                  </span>
                  <VesselLabel code={m.vesselCode} className="text-[10px]" showCode />
                </div>
                <p className="text-sm font-bold text-fg line-clamp-1">{m.title}</p>
                <p className="text-[10px] text-text-industrial/50 line-clamp-1">{CATEGORY_LABEL[m.category] ?? m.category} · {m.reasonForChange}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-fg font-mono">{fmtDate(m.createdAt)}</p>
                {m.plannedDate && <p className="text-[10px] text-text-industrial/40">Planeado: {fmtDate(m.plannedDate)}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {showFilterGate && (
        <MocFilterGate
          onCancel={() => setShowFilterGate(false)}
          onProceed={() => { setShowFilterGate(false); setShowCreate(true); }}
        />
      )}

      {(showCreate || editing) && (
        <MocModal
          moc={editing}
          onClose={() => { setShowCreate(false); closeLink(); }}
          onSaved={() => { setShowCreate(false); closeLink(); void reload(); }}
        />
      )}
    </div>
  );
};

// ─── Exportar el modal para que otros módulos (Deferral, Defect, MOC trigger
// dialogs) puedan abrirlo desde sus propias pantallas con prefill. La idea:
// el sistema sugiere "este caso amerita MOC" y abre el modal ya armado.
// MocModal y MocPrefill se exportan inline arriba en sus declaraciones.
// ────────────────────────────────────────────────────────────────────────────
