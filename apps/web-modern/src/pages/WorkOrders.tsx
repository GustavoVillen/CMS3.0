import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useSearchParams, useNavigate } from "react-router-dom";
import { AlertTriangle, Camera, CheckCheck, ChevronDown, ExternalLink, FileSpreadsheet, FileText, LayoutGrid, List, Loader2, Maximize2, Mic, Minimize2, Plus, ShieldAlert, Sparkles, Trash2, Type, Video as VideoIcon, Wrench, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, type Column } from "../components/DataTable";
import { VesselLabel } from "../components/EntityLabels";
import { fmtDate, parseLocalDate } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExcelPanel } from "../components/ExcelPanel";
import { CreateWorkOrderModal } from "../components/CreateWorkOrderModal";
import { useT, type TranslationKey } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { printWorkOrder, printOpenWorkOrdersReport, printServiceRequest } from "../lib/print-work-order";
import { useVesselContext } from "../lib/vessel-context";
import { useCopilotEmitter, useCopilotApplyFields } from "../lib/copilot-context";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { PermitModal, type PermitModalPrefill } from "./Permits";
import { suggestPermitTypesFromText, PERMIT_TYPE_LABEL, type PermitType } from "../lib/permit-classifier";
import { ProgressNoteSheet } from "../mobile/ProgressNoteSheet";
import { AuthedImage, AuthedVideo, AuthedAudio } from "../lib/authed-media";

// Mini reference data for showing linked permits inside WO modal
const PTW_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador", REQUESTED: "Solicitado", APPROVED: "Aprobado",
  REJECTED: "Rechazado", ACTIVE: "Activo", CLOSED: "Cerrado", CANCELLED: "Cancelado",
};
const PTW_STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-fg/5 text-text-industrial/60 border-fg/10",
  REQUESTED: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
  APPROVED: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  REJECTED: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  ACTIVE: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  CLOSED: "bg-success-sea/10 text-success-sea border-success-sea/20",
  CANCELLED: "bg-fg/5 text-text-industrial/50 border-fg/10",
};

interface LinkedPermit {
  id: string;
  permitCode: string;
  type: PermitType;
  status: string;
  description: string;
  vesselCode: string;
  location: string;
  plannedStart: string;
  plannedEnd: string;
  validFrom: string | null;
  validTo: string | null;
  hazardsIdentified: string | null;
  controlMeasures: string | null;
  ppeRequired: string | null;
  details: Record<string, unknown>;
  requestedAt: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  closeNotes: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  tenantId: string;
  gasTests: Array<{ id: string; testedAt: string; testedByName: string; location: string | null; o2Pct: number | null; lelPct: number | null; h2sPpm: number | null; coPpm: number | null; verdict: "PASS" | "FAIL"; notes: string | null }>;
  participants: Array<{ id: string; crewId: string | null; name: string; role: "PERFORMER" | "FIRE_WATCH" | "STAND_BY" | "ATTENDANT" | "SUPERVISOR" }>;
}

type PermitModalState =
  | { kind: "create"; prefill: PermitModalPrefill }
  | { kind: "edit"; permit: LinkedPermit }
  | null;

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkOrder {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  maintenancePlanId: string | null;
  workOrderCode: string;
  type: string;
  status: string;
  priority: string;
  criticality: string;
  openDate: string;
  startDate: string | null;
  dueDate: string | null;
  completedDate: string | null;
  holdReason: string | null;
  cancelReason: string | null;
  closeNotes: string | null;
  independentVerifier: string | null;
  testResult: string | null;
  title: string | null;
  description: string | null;
  assignedToUserId: string | null;
  assignedToUserName: string | null;
  assetName: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  // Plan fields
  acceptanceCriteria: string | null;
  loto: string | null;
  riskLevel: string | null;
  riskAnalysisResult: string | null;
  checklistDocUrl: string | null;
  consequenceCategory: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale: string | null;
  // Result fields
  woResult: string | null;
  executedByName: string | null;
  observations: string | null;
  supportingDocUrl: string | null;
  createdAt: string;
  // Tramitación (cadena de aprobación del tablero)
  aprobadoByName: string | null;
  aprobadoAt: string | null;
  autorizadoByName: string | null;
  autorizadoAt: string | null;
  rechazadoByName: string | null;
  rechazadoAt: string | null;
  rechazoReason: string | null;
  // Mercurio form fields
  department: "CUBIERTA" | "MAQUINAS" | "BARCAZA" | "SERVICIOS" | null;
  location: string | null;
  communicationMethod: string[];
  distribution: string[];
}


interface ListResponse { items: WorkOrder[]; total: number; }
type ActionType = "hold" | "close" | "cancel" | "reopen";
interface ActionTarget { workOrder: WorkOrder; type: ActionType; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.includes("T") ? value.slice(0, 10) : value;
}
function normalizeOptionalText(value: string): string | null {
  const text = value.trim();
  return text || null;
}
function canEditStatus(status: string): boolean {
  return status === "PLANNED" || status === "IN_PROGRESS" || status === "ON_HOLD";
}

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider";
const sectionLabelCls = "block font-semibold uppercase tracking-wider px-2 py-1 rounded-sm";
const sectionLabelStyle: React.CSSProperties = { backgroundColor: "#0f172a", color: "white", fontSize: "1.2rem" };

// ── CategoryBadge ─────────────────────────────────────────────────────────────

function CategoryBadge({ type }: { type: string }) {
  const t = useT();
  if (type === "INSPECTION")
    return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20">{t("wo.type.inspection")}</span>;
  if (type === "CORRECTIVE")
    return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20">{t("wo.type.corrective")}</span>;
  return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">{t("wo.type.preventive")}</span>;
}

// ── WoStatusBadge ─────────────────────────────────────────────────────────────

function WoStatusBadge({ status, dueDate, deferralStatus }: { status: string; dueDate: string | null; deferralStatus?: string | null }) {
  const t = useT();
  const isClosed = status === "CLOSED" || status === "CANCELLED";
  const isOpen   = !isClosed;
  const isOverdue = isOpen && !!dueDate && parseLocalDate(dueDate) < new Date();
  if (isClosed)          return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-fg/5 text-text-industrial/50 border-fg/10">{t("wo.status.closed")}</span>;
  if (status === "ON_HOLD") {
    if (deferralStatus === "REJECTED") return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">{t("wo.status.postponedRejected")}</span>;
    return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20">{t("wo.status.postponed")}</span>;
  }
  if (isOverdue)         return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">{t("wo.status.overdue")}</span>;
  if (status === "IN_PROGRESS") return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">En Progreso</span>;
  if (status === "PLANNED")     return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">Planificada</span>;
  return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">{t("wo.status.open")}</span>;
}

// ── HoldModal ─────────────────────────────────────────────────────────────────

const HoldModal: React.FC<{ workOrder: WorkOrder; onClose: () => void; onSuccess: () => void }> = ({ workOrder, onClose, onSuccess }) => {
  const t = useT();
  const [holdReason,            setHoldReason]            = useState("");
  const [targetDate,            setTargetDate]            = useState("");
  const [compensatoryMeasures,  setCompensatoryMeasures]  = useState("");
  const [loadingAI,             setLoadingAI]             = useState(false);
  const [saving,                setSaving]                = useState(false);
  const [submitting,            setSubmitting]            = useState(false);
  const [err,                   setErr]                   = useState<string | null>(null);

  const doHold = useCallback(async (): Promise<string | null> => {
    if (!holdReason.trim()) { setErr(t("wo.holdReason")); return null; }
    const res = await api.post<{ deferralId?: string | null }>(`/app/pms/work-orders/${workOrder.id}/hold`, {
      holdReason: holdReason.trim(),
      targetDate: targetDate || null,
      compensatoryMeasures: compensatoryMeasures.trim() || null,
    });
    return res.deferralId ?? null;
  }, [holdReason, targetDate, compensatoryMeasures, workOrder.id, t]);

  const onSave = useCallback(async () => {
    setSaving(true); setErr(null);
    try { await doHold(); onSuccess(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setSaving(false); }
  }, [doHold, onSuccess, t]);

  const onSubmitForReview = useCallback(async () => {
    setSubmitting(true); setErr(null);
    try {
      const deferralId = await doHold();
      if (deferralId) {
        await api.post(`/app/pms/deferrals/${deferralId}/review`, {});
      }
      onSuccess();
    }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setSubmitting(false); }
  }, [doHold, onSuccess, t]);

  const suggestCompensatory = useCallback(async () => {
    setLoadingAI(true);
    try {
      const res = await api.post<{ text: string }>("/app/pms/deferrals/suggest-compensatory-measures", {
        vesselCode:        workOrder.vesselCode,
        assetLabel:        workOrder.assetName ?? workOrder.assetId,
        sourceTypeLabel:   "Orden de Trabajo",
        sourceDisplayName: [workOrder.workOrderCode, workOrder.title].filter(Boolean).join(" — "),
        targetDate:        targetDate || null,
        justification:     holdReason.trim() || null,
      });
      setCompensatoryMeasures(res.text);
    } catch { /* noop */ }
    finally { setLoadingAI(false); }
  }, [workOrder, targetDate, holdReason]);

  const isBusy = saving || submitting;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="text-sm font-bold text-fg">{t("wo.hold")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className={labelCls}>{t("wo.holdReason")}</label>
            <textarea rows={3} value={holdReason} onChange={e => setHoldReason(e.target.value)} className={`${inputCls} mt-1`} />
          </div>
          <div>
            <label className={labelCls}>{t("wo.holdTargetDate")}</label>
            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className={`${inputCls} mt-1`} />
          </div>
          <div>
            <button
              type="button"
              onClick={() => { void suggestCompensatory(); }}
              disabled={loadingAI}
              className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent/80 hover:text-accent disabled:opacity-50 transition-colors mb-1"
            >
              {loadingAI ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Medidas compensatorias
              <span className="text-[10px] normal-case font-normal text-text-industrial/40 ml-1">{loadingAI ? "Generando con IA…" : "click para sugerir con IA"}</span>
            </button>
            <textarea
              rows={5}
              value={compensatoryMeasures}
              onChange={e => setCompensatoryMeasures(e.target.value)}
              disabled={loadingAI}
              placeholder="Medidas para mitigar el riesgo mientras dure el diferimiento…"
              className={`${inputCls} disabled:opacity-50`}
            />
          </div>
          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} disabled={isBusy} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg disabled:opacity-50">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={isBusy}
            className="px-4 py-2 rounded-xl bg-fg/5 border border-fg/10 text-fg font-bold text-xs hover:bg-fg/10 disabled:opacity-50 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Posponer
          </button>
          <button onClick={() => { void onSubmitForReview(); }} disabled={isBusy}
            className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
            Enviar a Revisión
          </button>
        </div>
      </div>
    </div>
  );
};

// ── CancelModal ───────────────────────────────────────────────────────────────

const CancelModal: React.FC<{ workOrder: WorkOrder; onClose: () => void; onSuccess: () => void }> = ({ workOrder, onClose, onSuccess }) => {
  const t = useT();
  const [cancelReason, setCancelReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (!cancelReason.trim()) { setErr(t("wo.cancelReason")); return; }
    setSaving(true); setErr(null);
    try { await api.post(`/app/pms/work-orders/${workOrder.id}/cancel`, { cancelReason: cancelReason.trim() }); onSuccess(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setSaving(false); }
  }, [cancelReason, onSuccess, t, workOrder.id]);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="text-sm font-bold text-fg">{t("wo.cancel")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
        </div>
        <div className="p-6 space-y-3">
          <label className={labelCls}>{t("wo.cancelReason")}</label>
          <textarea rows={4} value={cancelReason} onChange={e => setCancelReason(e.target.value)} className={inputCls} />
          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── ReopenModal ───────────────────────────────────────────────────────────────
// Vetting / record lockdown: re-abrir una OT CLOSED o CANCELLED.
// Solo TENANT_ADMIN, requiere justificación (≥5 chars). Queda auditado.

const ReopenModal: React.FC<{ workOrder: WorkOrder; onClose: () => void; onSuccess: () => void }> = ({ workOrder, onClose, onSuccess }) => {
  const t = useT();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (reason.trim().length < 5) {
      setErr(t("wo.reopenReasonRequired"));
      return;
    }
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/pms/work-orders/${workOrder.id}/reopen`, { reason: reason.trim() });
      onSuccess();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [reason, onSuccess, t, workOrder.id]);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="text-sm font-bold text-fg">{t("wo.reopen")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-[11px] text-text-industrial/70 leading-snug">
            {t("wo.reopenWarning")}
          </p>
          <label className={labelCls}>{t("wo.reopenReason")}</label>
          <textarea rows={4} value={reason} onChange={e => setReason(e.target.value)} className={inputCls} placeholder={t("wo.reopenReasonPlaceholder")} />
          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-700 dark:text-orange-300 font-bold text-xs hover:bg-orange-500/30 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("wo.reopen")}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── AddWorkLogModal (unused — kept for future reference) ─────────────────────

// ── CritBadge ─────────────────────────────────────────────────────────────────

function CritBadge({ crit }: { crit: string }) {
  const cls =
    crit === "A" ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
    : crit === "B" ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20"
    : "bg-fg/5 text-fg/40 border-fg/10";
  return (
    <span className={`inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold border shrink-0 ${cls}`}>
      {crit || "?"}
    </span>
  );
}

// ── PhaseHeader — cabecera numerada por fase del flujo de OT ─────────────────

const PhaseHeader: React.FC<{
  n: number;
  label: string;
  dotCls: string;
  borderCls: string;
  action?: React.ReactNode;
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  hint?: string;
}> = ({ n, label, dotCls, borderCls, action, collapsible, expanded, onToggle, hint }) => (
  <div className={`flex items-center gap-2.5 border-t-2 ${borderCls} pt-3`}>
    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${dotCls}`}>
      {n}
    </span>
    {collapsible ? (
      <button type="button" onClick={onToggle} className="flex items-center gap-1.5 flex-1 text-left group">
        <span className="text-[11px] font-bold uppercase tracking-widest text-fg/70 group-hover:text-fg transition-colors">
          {label}
        </span>
        {hint && !expanded && (
          <span className="text-[10px] normal-case font-normal text-text-industrial/40 ml-1">{hint}</span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-text-industrial/40 ml-1 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
      </button>
    ) : (
      <span className="text-[11px] font-bold uppercase tracking-widest text-fg/70 flex-1">{label}</span>
    )}
    {action}
  </div>
);

// ── Progress Notes (avances de trabajo) ──────────────────────────────────────

interface ProgressNote {
  id: string;
  kind: "TEXT" | "PHOTO" | "VIDEO" | "AUDIO";
  text: string | null;
  fileUrl: string | null;
  createdAt: string;
}

const KIND_ICON: Record<string, React.FC<{ className?: string }>> = {
  TEXT: Type, PHOTO: Camera, VIDEO: VideoIcon, AUDIO: Mic,
};
const KIND_LABEL: Record<string, string> = {
  TEXT: "Texto", PHOTO: "Foto", VIDEO: "Video", AUDIO: "Audio",
};

const ProgressNoteCard: React.FC<{
  note: ProgressNote;
  onDelete?: () => void;
}> = ({ note, onDelete }) => {
  const Icon = KIND_ICON[note.kind] ?? Type;
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
  return (
    <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2 text-[10px] text-text-industrial/50">
        <Icon className="w-3 h-3" />
        <span className="font-bold uppercase tracking-wider">{KIND_LABEL[note.kind] ?? note.kind}</span>
        <span className="ml-auto">{fmtTime(note.createdAt)}</span>
        {onDelete && (
          <button type="button" onClick={onDelete}
            className="p-1 -mr-1 text-text-industrial/40 hover:text-red-700 dark:text-red-400 transition-colors"
            title="Borrar avance">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {note.kind === "PHOTO" && note.fileUrl && (
        <AuthedImage src={note.fileUrl} alt="Foto" className="w-full rounded-lg object-cover max-h-60" />
      )}
      {note.kind === "VIDEO" && note.fileUrl && (
        <AuthedVideo src={note.fileUrl} controls className="w-full rounded-lg max-h-60" />
      )}
      {note.kind === "AUDIO" && note.fileUrl && (
        <AuthedAudio src={note.fileUrl} controls className="w-full" />
      )}
      {note.text && (
        <p className="text-xs text-fg/85 whitespace-pre-line leading-relaxed">{note.text}</p>
      )}
    </div>
  );
};

const ProgressNotesPanel: React.FC<{
  workOrderId: string;
  canAdd: boolean;
  canDelete: boolean;
  onAdd: () => void;
  reloadKey: number;
}> = ({ workOrderId, canAdd, canDelete, onAdd, reloadKey }) => {
  const t = useT();
  const { data, loading, reload } = useFetch<{ items: ProgressNote[] }>(
    `/app/pms/work-orders/${workOrderId}/progress-notes`,
    [workOrderId, reloadKey],
  );
  const notes = data?.items ?? [];
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [lightbox, setLightbox] = useState<ProgressNote | null>(null);

  // En modo mosaico solo se muestra contenido visual (foto/video).
  // El TEXT/AUDIO se ven mejor en la lista.
  const visualNotes = notes.filter(n => (n.kind === "PHOTO" || n.kind === "VIDEO") && n.fileUrl);

  const handleDelete = useCallback(async (noteId: string) => {
    if (!window.confirm(t("confirm.deleteProgress"))) return;
    try {
      await api.delete(`/app/pms/work-orders/${workOrderId}/progress-notes/${noteId}`);
      await reload();
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : t("error.deleteProgress"));
    }
  }, [workOrderId, reload]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/40">
          Avances {notes.length > 0 && `(${notes.length})`}
        </p>
        <div className="flex items-center gap-2">
          {visualNotes.length > 0 && (
            <div className="flex items-center gap-0.5 border border-fg/10 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                title="Vista lista"
                className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-fg/10 text-fg" : "text-text-industrial/40 hover:text-fg"}`}
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                title={`Vista mosaico (${visualNotes.length} fotos/videos)`}
                className={`p-1.5 rounded-md transition-colors ${viewMode === "grid" ? "bg-fg/10 text-fg" : "text-text-industrial/40 hover:text-fg"}`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {canAdd && (
            <button type="button" onClick={onAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-xs font-bold hover:brightness-110">
              <Plus className="w-3.5 h-3.5" />
              Registrar avance
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-[11px] text-text-industrial/40 italic text-center py-2">Aún sin avances registrados.</p>
      ) : viewMode === "grid" && visualNotes.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {visualNotes.map(n => (
            <button
              key={n.id}
              type="button"
              onClick={() => setLightbox(n)}
              className="relative aspect-square bg-fg/5 border border-fg/10 rounded-lg overflow-hidden group hover:border-accent/40 transition-colors"
              title={n.text ?? undefined}
            >
              {n.kind === "PHOTO" ? (
                <AuthedImage src={n.fileUrl!} alt="" className="w-full h-full object-cover" />
              ) : (
                <>
                  <AuthedVideo src={n.fileUrl!} className="w-full h-full object-cover" muted />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
                    <VideoIcon className="w-6 h-6 text-fg drop-shadow" />
                  </div>
                </>
              )}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1 text-[9px] text-fg/80 opacity-0 group-hover:opacity-100 transition-opacity">
                {new Date(n.createdAt).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map(n => (
            <ProgressNoteCard
              key={n.id}
              note={n}
              onDelete={canDelete ? () => { void handleDelete(n.id); } : undefined}
            />
          ))}
        </div>
      )}

      {/* Lightbox para ampliar la foto/video al hacer click en el mosaico */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm" onClick={() => setLightbox(null)}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
            className="absolute top-4 right-4 p-2 rounded-full bg-fg/10 hover:bg-fg/20 text-fg transition-colors"
            title="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="max-w-5xl max-h-full flex flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
            {lightbox.kind === "PHOTO" ? (
              <AuthedImage src={lightbox.fileUrl!} alt="" className="max-h-[85vh] rounded-lg object-contain" />
            ) : (
              <AuthedVideo src={lightbox.fileUrl!} controls autoPlay className="max-h-[85vh] rounded-lg" />
            )}
            {lightbox.text && (
              <p className="text-sm text-fg/90 max-w-2xl text-center whitespace-pre-line">{lightbox.text}</p>
            )}
            <p className="text-[10px] text-fg/40">
              {new Date(lightbox.createdAt).toLocaleString("es-AR")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

// ── WorkOrderModal ────────────────────────────────────────────────────────────

interface WorkOrderModalProps {
  workOrder: WorkOrder;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
  onOpenAction: (wo: WorkOrder, type: ActionType) => void;
}

const WorkOrderModal: React.FC<WorkOrderModalProps> = ({ workOrder, canManage, onClose, onSaved, onOpenAction }) => {
  const t = useT();
  const navigate = useNavigate();
  const { tenant, user } = useAuth();
  const isMercurio = tenant?.workOrderPdfTemplate === "MERCURIO";
  const isEditable = canEditStatus(workOrder.status);
  const isAdmin = user?.role === "TENANT_ADMIN";

  // Tramitación: los avances (5) y el resultado (6) recién se habilitan cuando la
  // OT está AUTORIZADA. En Solicitada / Aprobada quedan deshabilitados.
  const isAuthorized = !!workOrder.autorizadoAt;
  const isResultEditable = isEditable && isAuthorized;
  // Sub-estado de la cadena de aprobación (independiente del status operativo).
  const tramitaPhase: "SOLICITADA" | "APROBADA" | "AUTORIZADA" =
    workOrder.autorizadoAt ? "AUTORIZADA" : workOrder.aprobadoAt ? "APROBADA" : "SOLICITADA";
  const isRejected = !!workOrder.rechazadoAt && !workOrder.aprobadoAt;
  // step de tramitación pendiente (abre ApprovalModal). null = cerrado.
  const [tramita, setTramita] = useState<"APRUEBA" | "AUTORIZA" | "RECHAZA" | null>(null);

  // Linked deferrals (current + history). Cargamos todas las APLs vinculadas a esta OT.
  interface DeferralLite { id: string; deferralCode: string; status: string; requestedAt: string; targetDate: string | null; justification: string | null }
  const [deferralStatus, setDeferralStatus] = useState<string | null>(null);
  const [deferralTargetDate, setDeferralTargetDate] = useState<string | null>(null);
  const [deferralHistory, setDeferralHistory] = useState<DeferralLite[]>([]);
  const [deferralReloadKey, setDeferralReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api.get<{ items: DeferralLite[] }>(`/app/pms/deferrals?sourceId=${encodeURIComponent(workOrder.id)}`)
      .then(r => {
        if (cancelled) return;
        const items = (r.items ?? []).slice().sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
        // Activo: el más reciente no-terminal; si no hay, el más reciente terminal
        const TERMINAL = new Set(["REJECTED", "EXPIRED", "CLOSED"]);
        const active = items.find(d => !TERMINAL.has(d.status)) ?? items[0] ?? null;
        setDeferralStatus(active?.status ?? null);
        setDeferralTargetDate(active?.targetDate ?? null);
        // Historial: el resto (excluye el activo)
        setDeferralHistory(active ? items.filter(d => d.id !== active.id) : []);
      })
      .catch(() => { if (!cancelled) { setDeferralStatus(null); setDeferralTargetDate(null); setDeferralHistory([]); } });
    return () => { cancelled = true; };
  }, [workOrder.id, workOrder.status, deferralReloadKey]);

  // ── Mercurio form fields ──
  const [department, setDepartment]         = useState<string>(workOrder.department ?? "");
  const [location, setLocation]             = useState(workOrder.location ?? "");
  const [commMethod, setCommMethod]         = useState<string[]>(workOrder.communicationMethod ?? []);
  const [distribution, setDistribution]     = useState<string[]>(workOrder.distribution ?? []);

  function toggleArr(arr: string[], set: (v: string[]) => void, val: string) {
    set(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);
  }

  // ── Plan fields ──
  const [title, setTitle]                   = useState(workOrder.title ?? "");
  const [description, setDescription]       = useState(workOrder.description ?? "");
  const [assignedTo, setAssignedTo]         = useState(workOrder.assignedToUserName ?? workOrder.assignedToUserId ?? "");
  const [dueDate, setDueDate]               = useState(toDateInputValue(workOrder.dueDate));
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(workOrder.acceptanceCriteria ?? "");
  const [loto, setLoto]                     = useState(workOrder.loto ?? "");
  const [riskLevel, setRiskLevel]           = useState(workOrder.riskLevel ?? "");
  const [riskAnalysisResult, setRiskAnalysisResult] = useState(workOrder.riskAnalysisResult ?? "");
  const [consequenceCategory, setConsequenceCategory]   = useState<string>(workOrder.consequenceCategory ?? "");
  const [consequenceRationale, setConsequenceRationale] = useState<string>(workOrder.consequenceRationale ?? "");
  const [checklistDocFile, setChecklistDocFile] = useState<File | null>(null);
  const [checklistDocUrl] = useState(workOrder.checklistDocUrl ?? "");

  // ── Result fields ──
  const [woResult, setWoResult]             = useState(workOrder.woResult ?? "");
  const [executedByName, setExecutedByName] = useState(workOrder.executedByName ?? "");
  const [executionDate, setExecutionDate]   = useState(toDateInputValue(workOrder.completedDate));
  const [actualHours, setActualHours] = useState(
    workOrder.actualHours != null ? String(workOrder.actualHours) : ""
  );
  const [runningHoursAtExecution, setRunningHoursAtExecution] = useState(
    (workOrder as any).runningHoursAtExecution != null ? String((workOrder as any).runningHoursAtExecution) : ""
  );
  const [observations, setObservations]     = useState(workOrder.observations ?? workOrder.closeNotes ?? "");
  const [deficienciasText, setDeficienciasText] = useState("");
  const [supportingDocFile, setSupportingDocFile] = useState<File | null>(null);
  const [supportingDocUrl] = useState(workOrder.supportingDocUrl ?? "");

  // ── Spare usages ──
  interface SpareUsage { spareId: string; spareName: string; unit: string; qty: number; criticality: string; available: number; }
  const initialSpareUsages: SpareUsage[] = ((workOrder as any).spareUsages ?? []).map((u: any) => ({
    spareId: u.spareId,
    spareName: `${u.sku ?? ""}${u.sku && u.name ? " — " : ""}${u.name ?? u.spareId}`,
    unit: u.unit ?? "",
    qty: Number(u.qty) || 0,
    criticality: u.criticality ?? "C",
    available: 0, // populated below from sparesData when it loads
  }));
  const [spareUsages,    setSpareUsages]    = useState<SpareUsage[]>(initialSpareUsages);
  const [addingUsage,    setAddingUsage]    = useState(false);
  const [usageSpareId,   setUsageSpareId]   = useState("");
  const [usageQty,       setUsageQty]       = useState("1");
  const [usageSearch,    setUsageSearch]    = useState("");
  const [usageDropdown,  setUsageDropdown]  = useState(false);
  const [closingWarning, setClosingWarning] = useState<string | null>(null);

  const { data: sparesData } = useFetch<{ items: Array<{ id: string; sku: string; name: string; unit: string; criticality: string; onHand: number; available: number }> }>(
    workOrder.vesselCode ? `/app/pms/spares?vesselCode=${workOrder.vesselCode}&status=ACTIVE` : null,
  );
  const woSpares = sparesData?.items ?? [];

  // Hydrate `available` on existing spareUsages once the spares catalog loads
  useEffect(() => {
    if (woSpares.length === 0) return;
    setSpareUsages(prev => prev.map(u => {
      const s = woSpares.find(x => x.id === u.spareId);
      return s ? { ...u, available: s.available, unit: u.unit || s.unit } : u;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sparesData]);

  const addUsage = () => {
    const spare = woSpares.find(s => s.id === usageSpareId);
    if (!spare) return;
    const qty = parseFloat(usageQty);
    if (!qty || qty <= 0) return;
    setSpareUsages(prev => [...prev, {
      spareId: spare.id,
      spareName: `${spare.sku} — ${spare.name}`,
      unit: spare.unit,
      qty,
      criticality: spare.criticality,
      available: spare.available,
    }]);
    setUsageSpareId(""); setUsageQty("1"); setUsageSearch(""); setAddingUsage(false);
  };

  const removeUsage = (idx: number) => setSpareUsages(prev => prev.filter((_, i) => i !== idx));

  // ── Defect registration prompt ──
  type DefectPrompt = "idle" | "ask" | "creating" | "created" | "declined";
  const [defectPrompt, setDefectPrompt] = useState<DefectPrompt>("idle");
  const [createdDefectCode, setCreatedDefectCode] = useState<string | null>(null);

  const handleWoResultChange = (val: string) => {
    const next = woResult === val ? "" : val;
    setWoResult(next);
    if (next === "WITH_DEFICIENCIES") setDefectPrompt("ask");
    else { setDefectPrompt("idle"); setCreatedDefectCode(null); }
  };

  const openDefectRecord = useCallback(async () => {
    setDefectPrompt("creating");
    try {
      const body = {
        vesselCode: workOrder.vesselCode,
        assetId: workOrder.assetId,
        workOrderId: workOrder.id,
        classification: "WORK_ORDER_FINDING",
        severity: "MEDIUM",
        description: deficienciasText.trim() || observations.trim() || `Deficiencias encontradas en OT ${workOrder.workOrderCode}`,
      };
      const res = await api.post<{ id: string; defectCode: string }>("/app/pms/defects", body);
      setCreatedDefectCode(res.defectCode ?? null);
      setDefectPrompt("created");
      navigate(`/defects?defectId=${res.id}`);
    } catch { setDefectPrompt("ask"); }
  }, [deficienciasText, observations, workOrder, navigate]);

  const [saving,          setSaving]         = useState(false);
  const [resuming,        setResuming]       = useState(false);
  const [closing,         setClosing]        = useState(false);
  const [err,             setErr]            = useState<string | null>(null);
  const [expanded,        setExpanded]       = useState(true);
  const [loadingCriteria, setLoadingCriteria] = useState(false);
  const [loadingLoto,     setLoadingLoto]    = useState(false);
  const [loadingRisk,     setLoadingRisk]    = useState(false);
  const [loadingConsequence, setLoadingConsequence] = useState(false);
  const [loadingRewrite,   setLoadingRewrite]    = useState(false);
  const [showProgressSheet, setShowProgressSheet] = useState(false);
  const [notesReloadKey,    setNotesReloadKey]    = useState(0);
  // Plan section: collapsed by default when WO comes from a maintenance plan
  const [planExpanded, setPlanExpanded] = useState(!workOrder.maintenancePlanId);
  const fromPlan = !!workOrder.maintenancePlanId;

  // Recarga spareUsages desde la API tras el pipeline asincrónico de detección de repuestos.
  // Se llama con un delay después de guardar un avance para dar tiempo al pipeline de IA.
  const reloadSpareUsages = useCallback(() => {
    const delay = 5000;
    setTimeout(async () => {
      try {
        const fresh = await api.get<{ spareUsages?: any[] }>(`/app/pms/work-orders/${workOrder.id}`);
        const freshUsages = fresh.spareUsages ?? [];
        if (freshUsages.length > 0) {
          const catalog = sparesData?.items ?? [];
          setSpareUsages(freshUsages.map((u: any) => {
            const found = catalog.find((s: any) => s.id === u.spareId);
            return {
              spareId: u.spareId,
              spareName: u.sku && u.name ? `${u.sku} — ${u.name}` : u.name ?? u.spareId,
              unit: u.unit ?? found?.unit ?? "",
              qty: Number(u.qty) || 0,
              criticality: u.criticality ?? found?.criticality ?? "C",
              available: found?.available ?? 0,
            };
          }));
        }
      } catch { /* noop */ }
    }, delay);
  }, [workOrder.id, sparesData]);

  useCopilotEmitter({
    module: "WORK_ORDERS",
    screen: "WO_EDIT",
    entityId: workOrder.id,
    entityCode: workOrder.workOrderCode,
    vesselCode: workOrder.vesselCode,
    workflowStage: workOrder.status,
    canEdit: isEditable,
    fieldValues: {
      title:              title              || null,
      description:        description        || null,
      acceptanceCriteria: acceptanceCriteria || null,
      loto:               loto               || null,
      riskLevel:          riskLevel          || null,
      riskAnalysisResult: riskAnalysisResult || null,
    },
  });

  useCopilotApplyFields(isEditable ? (fields) => {
    if (fields.title              !== undefined) setTitle(fields.title);
    if (fields.description        !== undefined) setDescription(fields.description);
    if (fields.acceptanceCriteria !== undefined) setAcceptanceCriteria(fields.acceptanceCriteria);
    if (fields.loto               !== undefined) setLoto(fields.loto);
    if (fields.riskAnalysisResult !== undefined) setRiskAnalysisResult(fields.riskAnalysisResult);
    if (fields.riskLevel          !== undefined && ["LOW","MEDIUM","HIGH","CRITICAL"].includes(fields.riskLevel))
      setRiskLevel(fields.riskLevel);
  } : null);

  const handleAcceptanceCriteriaClick = useCallback(async () => {
    if (!isEditable || loadingCriteria) return;
    setLoadingCriteria(true);
    setAcceptanceCriteria("Analizando...");
    try {
      const res = await api.post<{ text: string }>("/app/pms/work-orders/suggest-acceptance-criteria", {
        assetLabel: workOrder.assetName ?? null,
        taskDesc: description || title || null,
      });
      setAcceptanceCriteria(res.text || "");
    } catch { setAcceptanceCriteria(""); }
    finally { setLoadingCriteria(false); }
  }, [isEditable, loadingCriteria, workOrder.assetName, description, title]);

  const handleLotoClick = useCallback(async () => {
    if (!isEditable || loadingLoto) return;
    setLoadingLoto(true);
    setLoto("Analizando...");
    try {
      const res = await api.post<{ text: string }>("/app/pms/work-orders/suggest-loto", {
        assetLabel: workOrder.assetName ?? null,
        taskDesc: description || title || null,
        acceptanceCriteria: acceptanceCriteria || null,
      });
      setLoto(res.text || "");
    } catch { setLoto(""); }
    finally { setLoadingLoto(false); }
  }, [isEditable, loadingLoto, workOrder.assetName, description, title, acceptanceCriteria]);

  const handleRiskClick = useCallback(async () => {
    if (!isEditable || loadingRisk) return;
    setLoadingRisk(true);
    try {
      const res = await api.post<{ level: string; analysis: string }>("/app/pms/work-orders/suggest-risk", {
        assetLabel: workOrder.assetName ?? null,
        taskDesc: description || title || null,
        acceptanceCriteria: acceptanceCriteria || null,
        loto: loto || null,
      });
      if (res.level && ["LOW","MEDIUM","HIGH","CRITICAL"].includes(res.level)) setRiskLevel(res.level);
      if (res.analysis) setRiskAnalysisResult(res.analysis);
    } catch { /* noop */ }
    finally { setLoadingRisk(false); }
  }, [isEditable, loadingRisk, workOrder.assetName, description, title, acceptanceCriteria, loto]);

  const handleConsequenceClick = useCallback(async () => {
    if (!isEditable || loadingConsequence) return;
    setLoadingConsequence(true);
    try {
      const res = await api.post<{ category: string; rationale: string }>(
        "/app/pms/work-orders/suggest-consequence",
        {
          assetName: workOrder.assetName ?? workOrder.assetId ?? "",
          assetSfiCode: null,
          planTitle: title || null,
          planDescription: description || null,
        },
      );
      if (res.category && ["SAFETY","ENVIRONMENTAL","OPERATIONAL","NON_OPERATIONAL"].includes(res.category)) {
        setConsequenceCategory(res.category);
      }
      if (res.rationale) setConsequenceRationale(res.rationale);
    } catch { /* noop */ }
    finally { setLoadingConsequence(false); }
  }, [isEditable, loadingConsequence, workOrder.assetName, workOrder.assetId, title, description]);

  const handleRewriteDeficiencies = useCallback(async () => {
    if (!isEditable || loadingRewrite) return;
    if (!deficienciasText.trim()) return;
    setLoadingRewrite(true);
    try {
      const res = await api.post<{ rewritten: string }>(
        "/app/pms/work-orders/rewrite-deficiencies",
        {
          text: deficienciasText,
          assetName: workOrder.assetName ?? null,
        },
      );
      if (res.rewritten) setDeficienciasText(res.rewritten);
    } catch { /* noop */ }
    finally { setLoadingRewrite(false); }
  }, [isEditable, loadingRewrite, deficienciasText, workOrder.assetName]);

  const uploadIfNeeded = useCallback(async (file: File | null, currentUrl: string) => {
    if (!file) return currentUrl || null;
    const res = await api.upload<{ url: string }>(`/app/attachments/upload?entityType=WorkOrder&entityId=${workOrder.id}`, file);
    return res.url ?? null;
  }, [workOrder.id]);

  // ── Linked Permits to Work (PTW) ──
  // Trae permisos vinculados a esta OT vía workOrderId. Más una heurística
  // que sugiere tipos de PTW por keywords en título/descripción.
  const { data: linkedPermitsData, reload: reloadPermits } = useFetch<{ items: LinkedPermit[] }>(
    `/app/permits?workOrderId=${workOrder.id}`,
    [workOrder.id],
  );
  const linkedPermits = linkedPermitsData?.items ?? [];
  const advisoryMatches = useMemo(
    () => suggestPermitTypesFromText(`${title} ${description}`),
    [title, description],
  );
  const [permitModalState, setPermitModalState] = useState<PermitModalState>(null);
  const makePermitPrefill = useCallback((forcedType?: PermitType): PermitModalPrefill => ({
    vesselCode: workOrder.vesselCode,
    type: forcedType ?? advisoryMatches[0]?.type ?? "HOT_WORK",
    workOrderId: workOrder.id,
    location: workOrder.location ?? "",
    description: title || description || workOrder.title || workOrder.description || "",
  }), [workOrder, title, description, advisoryMatches]);

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const handleGeneratePdf = useCallback(async () => {
    setGeneratingPdf(true);
    try {
      // Persist current edits (only when the WO is editable) before downloading the PDF
      if (isEditable) {
        try {
          await api.patch(`/app/pms/work-orders/${workOrder.id}`, {
            title: normalizeOptionalText(title),
            description: normalizeOptionalText(description),
            assignedToUserId: normalizeOptionalText(assignedTo),
            dueDate: dueDate || null,
            acceptanceCriteria: normalizeOptionalText(acceptanceCriteria),
            loto,
            riskLevel: normalizeOptionalText(riskLevel),
            riskAnalysisResult: normalizeOptionalText(riskAnalysisResult),
            consequenceCategory: consequenceCategory || null,
            consequenceRationale: normalizeOptionalText(consequenceRationale),
          });
        } catch { /* non-blocking — still try to print */ }
      }
      await printWorkOrder(workOrder);
    } finally {
      setGeneratingPdf(false);
    }
  }, [isEditable, workOrder, title, description, assignedTo, dueDate, acceptanceCriteria, loto, riskLevel, riskAnalysisResult, consequenceCategory, consequenceRationale]);

  const [generatingSr, setGeneratingSr] = useState(false);
  const handleGenerateServiceRequest = useCallback(async () => {
    setGeneratingSr(true);
    try {
      if (isEditable) {
        try {
          await api.patch(`/app/pms/work-orders/${workOrder.id}`, {
            title: normalizeOptionalText(title),
            description: normalizeOptionalText(description),
            assignedToUserId: normalizeOptionalText(assignedTo),
          });
        } catch { /* non-blocking — still try to print */ }
      }
      await printServiceRequest(workOrder);
    } finally {
      setGeneratingSr(false);
    }
  }, [isEditable, workOrder, title, description, assignedTo]);

  const onSave = useCallback(async () => {
    setSaving(true); setErr(null);
    try {
      const [chkUrl, supUrl] = await Promise.all([
        uploadIfNeeded(checklistDocFile, checklistDocUrl),
        uploadIfNeeded(supportingDocFile, supportingDocUrl),
      ]);
      await api.patch(`/app/pms/work-orders/${workOrder.id}`, {
        title: normalizeOptionalText(title),
        description: normalizeOptionalText(description),
        assignedToUserId: normalizeOptionalText(assignedTo),
        dueDate: dueDate || null,
        acceptanceCriteria: normalizeOptionalText(acceptanceCriteria),
        loto,
        riskLevel: normalizeOptionalText(riskLevel),
        riskAnalysisResult: normalizeOptionalText(riskAnalysisResult),
        consequenceCategory: consequenceCategory || null,
        consequenceRationale: normalizeOptionalText(consequenceRationale),
        department: (department as any) || null,
        location: normalizeOptionalText(location),
        communicationMethod: commMethod,
        distribution,
        checklistDocUrl: chkUrl,
        woResult: normalizeOptionalText(woResult),
        executedByName: normalizeOptionalText(executedByName),
        completedDate: executionDate || null,
        runningHoursAtExecution: runningHoursAtExecution ? Number(runningHoursAtExecution) : null,
        actualHours: actualHours ? Number(actualHours) : null,
        observations: normalizeOptionalText(observations),
        supportingDocUrl: supUrl,
        spareUsages: spareUsages.map(u => ({ spareId: u.spareId, qty: u.qty, unit: u.unit })),
      });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setSaving(false); }
  }, [title, description, assignedTo, dueDate, acceptanceCriteria, loto, riskLevel, riskAnalysisResult,
      consequenceCategory, consequenceRationale,
      department, location, commMethod, distribution,
      checklistDocFile, checklistDocUrl, supportingDocFile, supportingDocUrl,
      woResult, executedByName, executionDate, runningHoursAtExecution, actualHours, observations,
      spareUsages, uploadIfNeeded, onSaved, t, workOrder.id]);

  // ESC guard
  const isDirty = useDirtyTracker({
    title, description, assignedTo, dueDate, acceptanceCriteria, loto, riskLevel, riskAnalysisResult,
    consequenceCategory, consequenceRationale,
    department, location, commMethod, distribution,
    checklistDocFileName: checklistDocFile?.name ?? "",
    woResult, executedByName, executionDate, runningHoursAtExecution, actualHours, observations,
    supportingDocFileName: supportingDocFile?.name ?? "",
  });
  const woClosedReadOnly = workOrder.status === "CLOSED" || workOrder.status === "CANCELLED";
  useEscapeGuard({
    enabled: !woClosedReadOnly,
    isDirty,
    onSave,
    onClose,
  });

  const handleResume = useCallback(async () => {
    setResuming(true); setErr(null);
    try {
      await api.post(`/app/pms/work-orders/${workOrder.id}/resume`, {});
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("common.unknownError"));
    } finally { setResuming(false); }
  }, [workOrder.id, onSaved, t]);

  // Re-solicitar diferimiento: reanuda la OT (la APL rechazada queda como histórico)
  // y abre el modal de Diferir para crear una nueva APL.
  const handleResubmitDeferral = useCallback(async () => {
    setResuming(true); setErr(null);
    try {
      await api.post(`/app/pms/work-orders/${workOrder.id}/resume`, {});
      onOpenAction({ ...workOrder, status: "IN_PROGRESS", holdReason: null }, "hold");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("common.unknownError"));
    } finally { setResuming(false); }
  }, [workOrder, onOpenAction, t]);

  const onClose_WO = useCallback(async () => {
    if (!woResult) { setErr(t("wo.modal.resultRequired")); return; }
    setClosing(true); setErr(null);
    try {
      const supUrl = await uploadIfNeeded(supportingDocFile, supportingDocUrl);
      const res = await api.post<{ id: string; failedMovements?: string[] }>(`/app/pms/work-orders/${workOrder.id}/close`, {
        woResult,
        executedByName: normalizeOptionalText(executedByName),
        completedDate: executionDate || null,
        observations: normalizeOptionalText(observations),
        supportingDocUrl: supUrl,
        runningHoursAtExecution: runningHoursAtExecution ? Number(runningHoursAtExecution) : null,
        actualHours: actualHours ? Number(actualHours) : null,
        spareUsages: spareUsages.map(u => ({ spareId: u.spareId, qty: u.qty, unit: u.unit })),
      });
      if (res.failedMovements && res.failedMovements.length > 0) {
        setClosingWarning(t("wo.modal.closeStockWarning").replace("{count}", String(res.failedMovements.length)));
      } else {
        onSaved();
      }
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setClosing(false); }
  }, [woResult, executedByName, executionDate, observations, supportingDocFile, supportingDocUrl,
      runningHoursAtExecution, actualHours, spareUsages, uploadIfNeeded, onSaved, t, workOrder.id]);

  const isClosed = workOrder.status === "CLOSED" || workOrder.status === "CANCELLED";
  const canPostpone = workOrder.status === "PLANNED" || workOrder.status === "IN_PROGRESS";
  const canCancel   = !isClosed;
  const canClose    = !isClosed && !!woResult.trim();

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl flex flex-col transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-3xl max-h-[90%]"}`} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <div className="flex items-center gap-3">
            <Wrench className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("wo.entityLabel")}</p>
              <h2 className="text-sm font-bold text-fg font-mono">{workOrder.workOrderCode}</h2>
            </div>
            <WoStatusBadge status={workOrder.status} dueDate={workOrder.dueDate} deferralStatus={deferralStatus} />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-text-industrial/30 hover:text-fg hover:bg-fg/5 transition-colors" title={expanded ? t("common.minimize") : t("common.maximize")}>
              {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">

          {/* ── 0. TRAMITACIÓN (Solicita → Aprueba → Autoriza) ── */}
          {isEditable && (
            <div className={`rounded-2xl border p-4 space-y-3 ${isRejected ? "border-red-500/40 bg-red-500/[0.06]" : "border-fg/10 bg-fg/[0.03]"}`}>
              <div className="flex items-center gap-2">
                <CheckCheck className={`w-4 h-4 ${isRejected ? "text-red-600 dark:text-red-400" : "text-accent"}`} />
                <span className="text-[11px] font-bold uppercase tracking-widest text-fg/70">Tramitación</span>
              </div>

              {isRejected && (
                <p className="text-xs text-red-700 dark:text-red-300 leading-snug">
                  <span className="font-bold">Rechazada</span>
                  {workOrder.rechazadoByName ? ` por ${workOrder.rechazadoByName}` : ""}
                  {workOrder.rechazadoAt ? ` · ${fmtDate(workOrder.rechazadoAt)}` : ""}
                  {workOrder.rechazoReason ? <span className="block text-text-industrial/70 mt-0.5">Motivo: {workOrder.rechazoReason}</span> : null}
                </p>
              )}

              {tramitaPhase === "AUTORIZADA" ? (
                <div className="text-xs text-emerald-700 dark:text-emerald-300 space-y-0.5">
                  {workOrder.aprobadoByName && <p><span className="font-bold">Aprobó:</span> {workOrder.aprobadoByName}{workOrder.aprobadoAt ? ` · ${fmtDate(workOrder.aprobadoAt)}` : ""}</p>}
                  <p><span className="font-bold">Autorizó:</span> {workOrder.autorizadoByName}{workOrder.autorizadoAt ? ` · ${fmtDate(workOrder.autorizadoAt)}` : ""}</p>
                  <p className="text-text-industrial/60 normal-case">OT autorizada — avances y resultado habilitados.</p>
                </div>
              ) : (
                <>
                  {tramitaPhase === "APROBADA" && (
                    <p className="text-[11px] text-text-industrial/60">
                      <span className="font-bold text-violet-700 dark:text-violet-400">Aprobó:</span> {workOrder.aprobadoByName}{workOrder.aprobadoAt ? ` · ${fmtDate(workOrder.aprobadoAt)}` : ""}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTramita(tramitaPhase === "SOLICITADA" ? "APRUEBA" : "AUTORIZA")}
                      className="flex-1 py-2 rounded-xl border text-xs font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
                    >
                      {tramitaPhase === "SOLICITADA" ? "APROBADA" : "AUTORIZADA"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTramita("RECHAZA")}
                      className="flex-1 py-2 rounded-xl border text-xs font-bold bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30 hover:bg-red-500/20 transition-colors"
                    >
                      {tramitaPhase === "SOLICITADA" ? "NO APROBADA" : "NO AUTORIZADA"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── 1. INFORMACIÓN ── */}
          <section>
            <PhaseHeader n={1} label={t("wo.modal.section.info")} dotCls="bg-fg/10 text-fg/60" borderCls="border-fg/10" />
            <div className="mt-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                [t("wo.modal.vessel"),     workOrder.vesselCode,            "font-mono text-accent"],
                [t("wo.modal.equipment"),  workOrder.assetName ?? workOrder.assetId, "text-fg"],
                [t("wo.modal.type"),       null, null, <CategoryBadge key="cat" type={workOrder.type} />],
                [t("wo.col.status"),       null, null, <WoStatusBadge key="st" status={workOrder.status} dueDate={workOrder.dueDate} deferralStatus={deferralStatus} />],
                [t("wo.modal.priority"),   workOrder.priority,              "text-fg"],
                [t("wo.modal.criticality"),workOrder.criticality,           "text-fg"],
                [t("wo.modal.openDate"),   fmtDate(workOrder.openDate),     "text-fg"],
                [t("wo.modal.dueDate"),    fmtDate(workOrder.dueDate),      workOrder.dueDate && !isClosed && parseLocalDate(workOrder.dueDate) < new Date() ? "text-red-700 dark:text-red-400 font-semibold" : "text-fg"],
              ] as [string, string | null, string | null, React.ReactNode?][]).map(([label, value, cls, node], i) => (
                <div key={i} className="bg-fg/5 border border-fg/10 rounded-xl p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{label}</p>
                  {node ?? <p className={`text-xs mt-0.5 ${cls ?? ""}`}>{value || "—"}</p>}
                </div>
              ))}
            </div>
            {workOrder.holdReason && (() => {
              const inProcess = deferralStatus === "REQUESTED" || deferralStatus === "UNDER_REVIEW";
              const approved  = deferralStatus === "APPROVED" || deferralStatus === "ACTIVE";
              const closed    = deferralStatus === "CLOSED" || deferralStatus === "EXPIRED";
              const rejected  = deferralStatus === "REJECTED";
              const badge = inProcess
                ? { label: deferralStatus === "UNDER_REVIEW" ? t("wo.deferral.underReview") : t("wo.deferral.requested"), cls: "bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30" }
                : approved
                ? { label: deferralStatus === "ACTIVE" ? t("wo.deferral.approvedActive") : t("wo.deferral.approved"), cls: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" }
                : rejected
                ? { label: t("wo.deferral.rejected"), cls: "bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/30" }
                : closed
                ? { label: deferralStatus === "EXPIRED" ? t("wo.deferral.expired") : t("wo.deferral.closed"), cls: "bg-fg/10 text-text-industrial/60 border-fg/10" }
                : null;
              const originalDue = workOrder.dueDate;
              const postponedTo = deferralTargetDate;
              const postponedDays = originalDue && postponedTo
                ? Math.round((new Date(postponedTo).getTime() - new Date(originalDue).getTime()) / 86_400_000)
                : null;
              const boxCls = rejected
                ? "mt-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2"
                : "mt-2 rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-3 py-2";
              const labelCls = rejected ? "text-[10px] uppercase tracking-wider text-red-700 dark:text-red-400" : "text-[10px] uppercase tracking-wider text-yellow-700 dark:text-yellow-400";
              const textCls  = rejected ? "text-xs text-red-700 dark:text-red-300" : "text-xs text-yellow-700 dark:text-yellow-300";
              const metaCls  = rejected ? "mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-red-700 dark:text-red-400/70" : "mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-yellow-700 dark:text-yellow-400/70";
              const strongCls = rejected ? "font-semibold text-red-700 dark:text-red-300" : "font-semibold text-yellow-700 dark:text-yellow-300";
              return (
                <div className={boxCls}>
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className={labelCls}>{t("wo.holdReasonLabel")}</p>
                    {badge && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                  <p className={textCls}>{workOrder.holdReason}</p>
                  <div className={metaCls}>
                    {originalDue && (
                      <span>{t("wo.originalDue")}: <span className={strongCls}>{fmtDate(originalDue)}</span></span>
                    )}
                    {postponedTo && (
                      <span>{t("wo.targetDate")}: <span className={strongCls}>{fmtDate(postponedTo)}</span></span>
                    )}
                    {postponedDays !== null && (
                      <span>{t("wo.postponedBy")}: <span className={strongCls}>{postponedDays > 0 ? `+${postponedDays} ${t("wo.days")}` : `${postponedDays} ${t("wo.days")}`}</span></span>
                    )}
                  </div>
                  {rejected && workOrder.status === "ON_HOLD" && (
                    <div className="mt-2 pt-2 border-t border-red-500/20 flex items-center justify-between gap-2">
                      <p className="text-[10px] text-red-700 dark:text-red-300/80">El diferimiento fue rechazado. Reanude la OT o solicite uno nuevo.</p>
                      <button
                        type="button"
                        onClick={() => { void handleResubmitDeferral(); }}
                        disabled={resuming}
                        className="px-2.5 py-1 rounded-lg bg-red-500/20 border border-red-500/30 text-red-800 dark:text-red-200 font-bold text-[10px] hover:bg-red-500/30 disabled:opacity-50 transition-all flex items-center gap-1 whitespace-nowrap"
                      >
                        {resuming ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        Re-solicitar diferimiento
                      </button>
                    </div>
                  )}
                  {deferralHistory.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-fg/10">
                      <p className="text-[9px] uppercase tracking-wider text-text-industrial/40 mb-1">Historial de diferimientos</p>
                      <div className="space-y-0.5">
                        {deferralHistory.map(d => (
                          <button
                            type="button"
                            key={d.id}
                            onClick={() => navigate(`/deferrals?autoCode=${d.deferralCode}`)}
                            className="w-full flex items-center justify-between gap-2 text-[10px] px-1.5 py-1 rounded hover:bg-fg/5 transition-colors text-left"
                          >
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="font-mono text-yellow-700 dark:text-yellow-300/80 truncate">{d.deferralCode}</span>
                              <DeferralStatusBadge status={d.status} />
                            </span>
                            <span className="text-text-industrial/40 whitespace-nowrap">{fmtDate(d.requestedAt)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            {workOrder.cancelReason && (
              <div className="mt-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-red-700 dark:text-red-400 mb-0.5">{t("wo.cancelReasonLabel")}</p>
                <p className="text-xs text-red-700 dark:text-red-300">{workOrder.cancelReason}</p>
              </div>
            )}
            </div>{/* end mt-3 */}
          </section>

          {/* ── 2. PLAN ── */}
          <section className="space-y-4">
            <PhaseHeader
              n={2}
              label={t("wo.modal.section.plan")}
              dotCls="bg-accent/20 text-accent"
              borderCls="border-accent/30"
              collapsible={fromPlan}
              expanded={planExpanded}
              onToggle={() => setPlanExpanded(v => !v)}
              hint={fromPlan ? t("wo.modal.planFromPlanHint") : undefined}
            />

            {/* ── Departamento + Ubicación (solo Mercurio) ── */}
            {isMercurio && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={labelCls}>{t("wo.modal.department")}</label>
                  <div className="flex flex-wrap gap-2">
                    {(["CUBIERTA", "MAQUINAS", "BARCAZA", "SERVICIOS"] as const).map(d => (
                      <button key={d} type="button" disabled={!isEditable}
                        onClick={() => setDepartment(department === d ? "" : d)}
                        className={`px-2 py-1 rounded text-xs font-bold border transition-colors ${
                          department === d
                            ? "bg-accent text-accent-fg border-accent"
                            : "bg-fg/5 text-text-industrial/60 border-fg/10 hover:border-accent/40"
                        }`}
                      >{d}</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>{t("wo.modal.location")}</label>
                  <input value={location} onChange={e => setLocation(e.target.value)} disabled={!isEditable}
                    className={inputCls} placeholder={t("wo.modal.locationPlaceholder")} />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className={labelCls}>{t("wo.modal.titleField")}</label>
              <input value={title} onChange={e => setTitle(e.target.value)} disabled={!isEditable} className={inputCls} placeholder={t("wo.modal.titlePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <label className={sectionLabelCls} style={sectionLabelStyle}>{t("wo.modal.task")}</label>
              <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} disabled={!isEditable} className={`${inputCls} resize-y`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("wo.modal.assignee")}</label>
                <input value={assignedTo} onChange={e => setAssignedTo(e.target.value)} disabled={!isEditable} className={inputCls} placeholder={t("wo.modal.assigneePlaceholder")} />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>{t("wo.modal.dueDate")}</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={!isEditable} className={inputCls} />
              </div>
            </div>
            {/* ── Campos colapsables (criterios/LOTO/riesgo/consecuencia): siempre visibles en OTs standalone;
                   ocultos por defecto cuando viene de un plan de mantenimiento ── */}
            {(planExpanded || !fromPlan) && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    onClick={isEditable ? handleAcceptanceCriteriaClick : undefined}
                    title={isEditable ? t("wo.ai.criteriaTooltip") : undefined}
                    className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${isEditable ? `hover:text-fg cursor-pointer ${loadingCriteria ? "opacity-60 animate-pulse" : ""}` : ""}`}
                  >
                    {loadingCriteria ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {t("wo.modal.acceptanceCriteria")}{loadingCriteria && <span className="ml-1 text-[9px] normal-case font-normal">{t("common.analyzing")}</span>}
                  </label>
                  <textarea rows={2} value={acceptanceCriteria} onChange={e => setAcceptanceCriteria(e.target.value)} disabled={!isEditable || loadingCriteria} className={`${inputCls} resize-y`} placeholder={t("wo.modal.acceptancePlaceholder")} />
                </div>
                <div className="space-y-1.5">
                  <label
                    onClick={isEditable ? handleLotoClick : undefined}
                    title={isEditable ? t("wo.ai.lotoTooltip") : undefined}
                    className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${isEditable ? `hover:text-fg cursor-pointer ${loadingLoto ? "opacity-60 animate-pulse" : ""}` : ""}`}
                  >
                    {loadingLoto ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {t("wo.modal.loto")}{loadingLoto && <span className="ml-1 text-[9px] normal-case font-normal">{t("common.analyzing")}</span>}
                  </label>
                  <textarea rows={2} value={loto} onChange={e => setLoto(e.target.value)} disabled={!isEditable || loadingLoto} className={`${inputCls} resize-y`} placeholder={t("wo.modal.lotoPlaceholder")} />
                </div>
                <div className="space-y-1.5">
                  <label
                    onClick={isEditable ? handleRiskClick : undefined}
                    title={isEditable ? t("wo.ai.riskTooltip") : undefined}
                    className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${isEditable ? `hover:text-fg cursor-pointer ${loadingRisk ? "opacity-60 animate-pulse" : ""}` : ""}`}
                  >
                    {loadingRisk ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {t("wo.modal.riskLevel")}
                    <span className="text-[10px] normal-case font-normal text-text-industrial/50 ml-1">{t("wo.modal.riskLevelHint")}</span>
                    {loadingRisk && <span className="ml-1 text-[9px] normal-case font-normal">{t("common.analyzing")}</span>}
                  </label>
                  <div className="flex gap-1.5">
                    {([
                      ["LOW",      "L", "bg-success-sea text-[#0B132B] border-success-sea",       "text-success-sea border-success-sea/40"],
                      ["MEDIUM",   "M", "bg-yellow-400 text-[#0B132B] border-yellow-400",         "text-yellow-700 dark:text-yellow-400 border-yellow-400/40"],
                      ["HIGH",     "H", "bg-red-500 text-fg border-red-500",                    "text-red-700 dark:text-red-400 border-red-400/40"],
                      ["CRITICAL", "C", "bg-red-700 text-fg border-red-700",                    "text-red-600 border-red-600/40"],
                    ] as [string, string, string, string][]).map(([val, label, activeCls, inactiveLabelCls]) => (
                      <button key={val} type="button" disabled={!isEditable || loadingRisk}
                        onClick={() => setRiskLevel(riskLevel === val ? "" : val)}
                        className={`w-9 h-9 rounded-lg border font-bold text-sm transition-all disabled:opacity-50 ${riskLevel === val ? activeCls : `bg-fg/5 ${inactiveLabelCls} hover:bg-fg/10`}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>{t("wo.modal.riskAnalysisResult")}</label>
                  <textarea rows={2} value={riskAnalysisResult} onChange={e => setRiskAnalysisResult(e.target.value)} disabled={!isEditable || loadingRisk} className={`${inputCls} resize-y`} placeholder={t("wo.modal.riskPlaceholder")} />
                </div>
                <div className="space-y-1.5">
                  <label
                    onClick={isEditable ? handleConsequenceClick : undefined}
                    title={isEditable ? t("wo.modal.consequenceTooltip") : undefined}
                    className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${isEditable ? `hover:text-fg cursor-pointer ${loadingConsequence ? "opacity-60 animate-pulse" : ""}` : ""}`}
                  >
                    {loadingConsequence ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {t("wo.modal.consequenceTitle")}
                    <span className="text-[10px] normal-case font-normal text-text-industrial/50 ml-1">{t("wo.modal.consequenceHint")}</span>
                    {loadingConsequence && <span className="ml-1 text-[9px] normal-case font-normal">{t("common.analyzing")}</span>}
                  </label>
                  <select
                    value={consequenceCategory}
                    onChange={e => setConsequenceCategory(e.target.value)}
                    disabled={!isEditable || loadingConsequence}
                    className={inputCls}
                  >
                    <option value="">{t("wo.modal.consequenceUnclassified")}</option>
                    <option value="SAFETY">{t("wo.modal.consequence.safety")}</option>
                    <option value="ENVIRONMENTAL">{t("wo.modal.consequence.environmental")}</option>
                    <option value="OPERATIONAL">{t("wo.modal.consequence.operational")}</option>
                    <option value="NON_OPERATIONAL">{t("wo.modal.consequence.nonOperational")}</option>
                  </select>
                  <textarea
                    rows={2}
                    value={consequenceRationale}
                    onChange={e => setConsequenceRationale(e.target.value)}
                    disabled={!isEditable || loadingConsequence}
                    className={`${inputCls} resize-y`}
                    placeholder={t("wo.modal.consequencePlaceholder")}
                  />
                </div>
              </div>
            )}
          </section>

          {/* ── 3. DOCUMENTO CHECKLIST ── */}
          <section className="space-y-3">
            <PhaseHeader n={3} label={t("wo.modal.checklistDoc")} dotCls="bg-teal-500/15 text-teal-700 dark:text-teal-400" borderCls="border-teal-500/25" />
            <div className="space-y-1.5 mt-3">
              {checklistDocUrl && !checklistDocFile && (
                <a href={checklistDocUrl} target="_blank" rel="noreferrer" className="block text-xs text-accent underline mb-1 truncate">{checklistDocUrl}</a>
              )}
              <input type="file" disabled={!isEditable} onChange={e => setChecklistDocFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-text-industrial/60 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-accent/10 file:text-accent hover:file:bg-accent/20 disabled:opacity-50 cursor-pointer" />
            </div>
          </section>

          {/* ── 4. PERMISOS DE TRABAJO ── */}
          <section className="space-y-3">
            <PhaseHeader
              n={4}
              label="Permisos de trabajo"
              dotCls="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
              borderCls="border-yellow-500/25"
              action={isEditable ? (
                <button
                  type="button"
                  onClick={() => setPermitModalState({ kind: "create", prefill: makePermitPrefill() })}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold uppercase tracking-wider hover:bg-accent/20"
                >
                  <Plus className="w-3 h-3" /> Nuevo permiso
                </button>
              ) : undefined}
            />

            {/* Advisory banner: keywords matchearon pero no hay PTW vinculado */}
            {advisoryMatches.length > 0 && linkedPermits.length === 0 && isEditable && (
              <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-yellow-700 dark:text-yellow-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-yellow-800 dark:text-yellow-200 font-semibold mb-1">Esta OT podría requerir permiso de trabajo</p>
                  <p className="text-[11px] text-yellow-800 dark:text-yellow-200/80 leading-snug mb-2">
                    Por el contenido del trabajo, sugerimos: <span className="font-bold">{advisoryMatches.map(m => PERMIT_TYPE_LABEL[m.type]).join(", ")}</span>.
                    <span className="block text-[10px] text-yellow-800 dark:text-yellow-200/60 mt-0.5">
                      Coincidencias detectadas: {advisoryMatches.flatMap(m => m.matchedKeywords).slice(0, 6).join(", ")}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {advisoryMatches.map(m => (
                      <button
                        key={m.type}
                        type="button"
                        onClick={() => setPermitModalState({ kind: "create", prefill: makePermitPrefill(m.type) })}
                        className="px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/30 text-yellow-700 dark:text-yellow-300 text-[10px] font-bold hover:bg-yellow-500/20"
                      >
                        Crear {PERMIT_TYPE_LABEL[m.type]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Lista de PTWs vinculados */}
            {linkedPermits.length === 0 ? (
              advisoryMatches.length === 0 && (
                <p className="text-xs text-text-industrial/40 italic">Sin permisos vinculados.</p>
              )
            ) : (
              <div className="space-y-1.5">
                {linkedPermits.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPermitModalState({ kind: "edit", permit: p })}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-fg/5 border border-fg/10 hover:border-accent/30 text-left transition-colors"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 text-accent/70 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-[10px] font-mono text-text-industrial/50">{p.permitCode}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${PTW_STATUS_COLOR[p.status]}`}>
                          {PTW_STATUS_LABEL[p.status]}
                        </span>
                        <span className="text-[10px] text-text-industrial/70">{PERMIT_TYPE_LABEL[p.type as PermitType] ?? p.type}</span>
                      </div>
                      <p className="text-xs text-fg/80 truncate">{p.description}</p>
                    </div>
                    <ExternalLink className="w-3 h-3 text-text-industrial/40 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ── Tramitación gate: 5 (Avances) y 6 (Resultado) solo con OT AUTORIZADA ── */}
          <fieldset disabled={!isResultEditable} className={`space-y-6 border-0 p-0 m-0 min-w-0 ${!isAuthorized ? "opacity-70" : ""}`}>
          {!isAuthorized && (
            <p className="text-[11px] text-text-industrial/50 italic">
              Los avances y el resultado se habilitan cuando la OT esté autorizada.
            </p>
          )}

          {/* ── 5. AVANCES ── */}
          {(workOrder.status === "PLANNED" || workOrder.status === "IN_PROGRESS" || workOrder.status === "ON_HOLD" || workOrder.status === "CLOSED") && (
            <section className="space-y-3">
              <PhaseHeader n={5} label="Avances" dotCls="bg-violet-500/15 text-violet-700 dark:text-violet-400" borderCls="border-violet-500/25" />
              <ProgressNotesPanel
                workOrderId={workOrder.id}
                canAdd={isResultEditable}
                canDelete={isEditable || isAdmin}
                onAdd={() => setShowProgressSheet(true)}
                reloadKey={notesReloadKey}
              />
            </section>
          )}

          {/* ── 6. RESULTADO ── */}
          <section className="space-y-4">
            <PhaseHeader n={6} label={t("wo.modal.resultSection")} dotCls="bg-blue-500/20 text-blue-700 dark:text-blue-400" borderCls="border-blue-500/30" />
            <div className="space-y-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">

            <div className="space-y-1.5">
              <label className={labelCls}>{t("wo.modal.result")} *</label>
              <div className="flex gap-2">
                {[["SATISFACTORY", t("wo.modal.result.satisfactory"), "bg-success-sea/10 text-success-sea border-success-sea/30"],
                  ["WITH_DEFICIENCIES", t("wo.modal.result.withDeficiencies"), "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30"]].map(([val, label, cls]) => (
                  <button key={val} type="button" disabled={!isEditable}
                    onClick={() => handleWoResultChange(val)}
                    className={`flex-1 py-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-50 ${woResult === val ? cls : "bg-fg/5 text-text-industrial/50 border-fg/10 hover:border-fg/30"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Deficiencias encontradas ── */}
            {woResult === "WITH_DEFICIENCIES" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className={labelCls}>{t("wo.modal.deficiencies")}</label>
                  <button
                    type="button"
                    onClick={() => { void handleRewriteDeficiencies(); }}
                    disabled={!isEditable || loadingRewrite || !deficienciasText.trim()}
                    title={!deficienciasText.trim() ? t("wo.modal.rewriteEmptyError") : t("wo.modal.rewriteTooltip")}
                    className="flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {loadingRewrite
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Sparkles className="w-3 h-3" />}
                    {t("wo.modal.rewriteAI")}
                  </button>
                </div>
                <textarea rows={3} value={deficienciasText} onChange={e => setDeficienciasText(e.target.value)} disabled={!isEditable || loadingRewrite} className={`${inputCls} resize-none border-orange-500/30 focus:border-orange-400/60`} placeholder={t("wo.modal.deficienciesPlaceholder")} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("wo.modal.executedBy")}</label>
                <input value={executedByName} onChange={e => setExecutedByName(e.target.value)} disabled={!isEditable} className={inputCls} placeholder={t("wo.modal.executedByPlaceholder")} />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>{t("wo.modal.executionDate")}</label>
                <input type="date" value={executionDate} onChange={e => setExecutionDate(e.target.value)} disabled={!isEditable} className={inputCls} />
              </div>
            </div>
            <div className={workOrder.maintenancePlanId ? "grid grid-cols-2 gap-3" : ""}>
              {workOrder.maintenancePlanId && (
                <div className="space-y-1.5">
                  <label className={labelCls}>{t("wo.modal.runningHours")}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={runningHoursAtExecution}
                    onChange={e => setRunningHoursAtExecution(e.target.value)}
                    disabled={!isEditable}
                    className={inputCls}
                    placeholder={t("wo.modal.runningHoursPlaceholder")}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <label className={labelCls}>
                  {t("wo.modal.actualHours")}
                  {workOrder.estimatedHours != null && (
                    <span className="text-[10px] normal-case font-normal text-text-industrial/50 ml-1">
                      {t("wo.modal.actualHoursEstHint").replace("{h}", String(workOrder.estimatedHours))}
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={actualHours}
                  onChange={e => setActualHours(e.target.value)}
                  disabled={!isEditable}
                  className={inputCls}
                  placeholder={t("wo.modal.actualHoursPlaceholder")}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>{t("wo.modal.observations")}</label>
              <textarea rows={3} value={observations} onChange={e => setObservations(e.target.value)} disabled={!isEditable} className={`${inputCls} resize-none`} placeholder={t("wo.modal.observationsPlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>{t("wo.modal.supportingDoc")}</label>
              {supportingDocUrl && !supportingDocFile && (
                <a href={supportingDocUrl} target="_blank" rel="noreferrer" className="block text-xs text-accent underline mb-1 truncate">{supportingDocUrl}</a>
              )}
              <input type="file" disabled={!isEditable} onChange={e => setSupportingDocFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-text-industrial/60 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-accent/10 file:text-accent hover:file:bg-accent/20 disabled:opacity-50 cursor-pointer" />
            </div>

            {/* ── Repuestos utilizados ── */}
            <div className="border border-fg/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-fg/50 uppercase tracking-wider">{t("wo.spares.section")}</p>
                {isEditable && (
                  <button type="button" onClick={() => setAddingUsage(v => !v)}
                    className="text-[10px] text-accent/70 hover:text-accent underline">
                    {addingUsage ? t("common.cancel") : t("wo.spares.add")}
                  </button>
                )}
              </div>

              {spareUsages.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-fg/30 border-b border-fg/10">
                      <th className="text-left py-1">{t("wo.spares.colSpare")}</th>
                      <th className="text-right py-1">{t("wo.spares.colQty")}</th>
                      <th className="text-left py-1 pl-2">{t("wo.spares.colUnit")}</th>
                      {isEditable && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {spareUsages.map((u, i) => (
                      <tr key={i} className="border-b border-fg/5 last:border-0">
                        <td className="py-1.5">
                          <div className="flex items-center gap-1.5">
                            <CritBadge crit={u.criticality} />
                            <span className={u.qty > u.available ? "text-orange-700 dark:text-orange-300" : "text-fg"}>{u.spareName}</span>
                          </div>
                        </td>
                        <td className="py-1.5 text-right text-fg/70">{u.qty}</td>
                        <td className="py-1.5 pl-2 text-fg/40">{u.unit}</td>
                        {isEditable && (
                          <td className="py-1.5 text-right">
                            <button onClick={() => removeUsage(i)} className="text-fg/20 hover:text-red-700 dark:text-red-400 transition-colors">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {spareUsages.some(u => u.qty > u.available) && (
                <p className="text-[10px] text-orange-700 dark:text-orange-400">
                  {t("wo.spares.exceedsStock")}
                </p>
              )}

              {addingUsage && (
                <div className="space-y-1.5 pt-1 border-t border-fg/10">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2 relative">
                      <input
                        type="text"
                        value={usageSearch}
                        onChange={e => { setUsageSearch(e.target.value); setUsageSpareId(""); setUsageDropdown(true); }}
                        onFocus={() => setUsageDropdown(true)}
                        onBlur={() => setTimeout(() => setUsageDropdown(false), 150)}
                        placeholder={t("wo.spares.searchPlaceholder")}
                        className={inputCls}
                      />
                      {usageDropdown && (
                        <div className="absolute z-20 w-full mt-1 bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-xl shadow-xl max-h-52 overflow-y-auto">
                          {(() => {
                            const q = usageSearch.toLowerCase();
                            const filtered = q
                              ? woSpares.filter(s => s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
                              : woSpares.slice(0, 30);
                            if (filtered.length === 0) return <p className="px-3 py-2 text-xs text-fg/30">{t("common.noResults")}</p>;
                            return filtered.map(s => (
                              <button key={s.id} type="button"
                                onMouseDown={() => { setUsageSpareId(s.id); setUsageSearch(`${s.sku} — ${s.name}`); setUsageDropdown(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-fg/5">
                                <CritBadge crit={s.criticality} />
                                <span className="flex-1 text-left text-fg">{s.sku} — {s.name}</span>
                                {s.available <= 0
                                  ? <span className="text-red-700 dark:text-red-400 text-[10px] font-semibold shrink-0">{t("wo.spares.outOfStock")}</span>
                                  : <span className="text-fg/30 text-[10px] shrink-0">{t("wo.spares.available")}: {s.available} {s.unit}</span>
                                }
                              </button>
                            ));
                          })()}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <input type="number" min="0.01" step="0.01" value={usageQty} onChange={e => setUsageQty(e.target.value)}
                        placeholder={t("wo.spares.qtyPlaceholder")} className={inputCls} />
                      <button onClick={addUsage} disabled={!usageSpareId}
                        className="px-3 py-2 rounded-xl bg-accent/20 text-accent text-xs font-bold hover:bg-accent/30 disabled:opacity-40 shrink-0">
                        +
                      </button>
                    </div>
                  </div>
                  {usageSpareId && (() => {
                    const spare = woSpares.find(s => s.id === usageSpareId);
                    const qty = parseFloat(usageQty);
                    if (spare && qty > spare.available) {
                      return <p className="text-[10px] text-orange-700 dark:text-orange-400">{t("wo.spares.insufficientStock").replace("{avail}", String(spare.available)).replace("{unit}", spare.unit).replace("{req}", String(qty))}</p>;
                    }
                    return null;
                  })()}
                </div>
              )}

              {spareUsages.length === 0 && !addingUsage && (
                <p className="text-xs text-fg/20">{t("wo.spares.empty")}</p>
              )}
            </div>

            {/* ── Prompt abrir DEF ── */}
            {woResult === "WITH_DEFICIENCIES" && defectPrompt !== "idle" && (
              <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-4 py-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-orange-700 dark:text-orange-400 shrink-0" />
                  <p className="text-xs font-semibold text-orange-700 dark:text-orange-300">{t("wo.defectPrompt.question")}</p>
                </div>
                {defectPrompt === "ask" && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { void openDefectRecord(); }}
                      className="flex-1 py-1.5 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-700 dark:text-orange-300 font-bold text-xs hover:bg-orange-500/30 transition-all">
                      {t("wo.defectPrompt.openRecord")}
                    </button>
                    <button type="button" onClick={() => setDefectPrompt("declined")}
                      className="flex-1 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-text-industrial/50 font-bold text-xs hover:border-fg/20 transition-all">
                      {t("wo.defectPrompt.skipRecord")}
                    </button>
                  </div>
                )}
                {defectPrompt === "creating" && (
                  <div className="flex items-center gap-2 text-xs text-text-industrial/50">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> {t("wo.defectPrompt.creating")}
                  </div>
                )}
                {defectPrompt === "created" && (
                  <div className="flex items-center gap-2 text-xs text-success-sea font-semibold">
                    <CheckCheck className="w-3.5 h-3.5 shrink-0" />
                    {t("wo.defectPrompt.created")}: <span className="font-mono">{createdDefectCode}</span>
                  </div>
                )}
                {defectPrompt === "declined" && (
                  <p className="text-xs text-text-industrial/40">{t("wo.defectPrompt.declined")}</p>
                )}
              </div>
            )}
            </div>{/* end bg-blue box */}
          </section>
          </fieldset>

          {/* ── Medio de comunicación + Distribución (solo Mercurio) ── */}
          {isMercurio && (
            <>
              <section className="space-y-3 border-t border-fg/10 pt-4">
                <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold">{t("wo.modal.commMethodSection")}</p>
                <div className="flex gap-3 flex-wrap">
                  {(["IMPRESO", "EMAIL", "WHAPP", "OTRO"] as const).map(opt => (
                    <button key={opt} type="button" disabled={!isEditable}
                      onClick={() => toggleArr(commMethod, setCommMethod, opt)}
                      className={`px-3 py-1 rounded text-xs font-bold border transition-colors ${
                        commMethod.includes(opt)
                          ? "bg-accent text-accent-fg border-accent"
                          : "bg-fg/5 text-text-industrial/60 border-fg/10 hover:border-accent/40"
                      }`}
                    >{opt}</button>
                  ))}
                </div>
              </section>

              <section className="space-y-3 border-t border-fg/10 pt-4">
                <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold">{t("wo.modal.distribution")}</p>
                <div className="flex gap-2 flex-wrap">
                  {(["GGE","PDT","JTE","JOP","JRH","JVE","JCO","JSE","JUR","ADM","CAP","JMA"] as const).map(code => (
                    <button key={code} type="button" disabled={!isEditable}
                      onClick={() => toggleArr(distribution, setDistribution, code)}
                      className={`w-12 py-1 rounded text-xs font-bold border transition-colors ${
                        distribution.includes(code)
                          ? "bg-accent text-accent-fg border-accent"
                          : "bg-fg/5 text-text-industrial/60 border-fg/10 hover:border-accent/40"
                      }`}
                    >{code}</button>
                  ))}
                </div>
              </section>
            </>
          )}

          {closingWarning && (
            <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-4 py-3 space-y-2">
              <p className="text-xs text-orange-700 dark:text-orange-300">{closingWarning}</p>
              <button onClick={onSaved} className="px-4 py-1.5 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-700 dark:text-orange-300 font-bold text-xs hover:bg-orange-500/30 transition-all">
                {t("common.acceptAndClose")}
              </button>
            </div>
          )}
          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-t border-fg/10 shrink-0">
          <div className="flex gap-2">
            <button onClick={() => { void handleGeneratePdf(); }} disabled={generatingPdf}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 disabled:opacity-50 transition-all">
              {generatingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} {t("wo.modal.generatePdf")}
            </button>
            {isMercurio && (
              <button onClick={() => { void handleGenerateServiceRequest(); }} disabled={generatingSr}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 disabled:opacity-50 transition-all">
                {generatingSr ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} {t("wo.modal.generateServiceRequest")}
              </button>
            )}
            {workOrder.status === "ON_HOLD" && (
              <button onClick={() => { void handleResume(); }} disabled={resuming}
                className="px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-bold text-xs hover:bg-emerald-500/20 disabled:opacity-50 transition-all flex items-center gap-1.5">
                {resuming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                {t("wo.resume")}
              </button>
            )}
            <button onClick={() => { void onClose_WO(); }} disabled={!canClose || closing}
              title={!woResult.trim() ? t("wo.modal.closeBeforeError") : undefined}
              className="px-4 py-2 rounded-xl bg-success-sea/10 border border-success-sea/20 text-success-sea font-bold text-xs hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed">
              {closing ? <Loader2 className="w-4 h-4 animate-spin" /> : t("wo.modal.closeWO")}
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => canPostpone && onOpenAction(workOrder, "hold")} disabled={!canPostpone}
              className="px-4 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 dark:text-yellow-400 font-bold text-xs hover:bg-yellow-500/20 disabled:opacity-30 disabled:cursor-not-allowed">
              {t("wo.modal.postpone")}
            </button>
            <button onClick={() => canCancel && onOpenAction(workOrder, "cancel")} disabled={!canCancel}
              className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 font-bold text-xs hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-not-allowed">
              {t("wo.modal.cancelWO")}
            </button>
            {isClosed && isAdmin && (
              <button onClick={() => onOpenAction(workOrder, "reopen")}
                className="px-4 py-2 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-700 dark:text-orange-300 font-bold text-xs hover:bg-orange-500/20">
                {t("wo.reopen")}
              </button>
            )}
            {isEditable && canManage && (
              <button onClick={() => { void onSave(); }} disabled={saving}
                className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Modal registrar avance */}
    {showProgressSheet && (
      <ProgressNoteSheet
        workOrderId={workOrder.id}
        onClose={() => setShowProgressSheet(false)}
        onSaved={() => { setNotesReloadKey(k => k + 1); reloadSpareUsages(); }}
      />
    )}

    {/* PTW modal anidado — abre encima de la OT por z-index propio */}
    {permitModalState?.kind === "create" && (
      <PermitModal
        permit={null}
        prefill={permitModalState.prefill}
        onClose={() => setPermitModalState(null)}
        onSaved={() => { setPermitModalState(null); void reloadPermits(); }}
      />
    )}
    {permitModalState?.kind === "edit" && (
      <PermitModal
        permit={permitModalState.permit as unknown as Parameters<typeof PermitModal>[0]["permit"]}
        onClose={() => setPermitModalState(null)}
        onSaved={() => { setPermitModalState(null); void reloadPermits(); }}
      />
    )}

    {/* Tramitación: aprobar / autorizar / rechazar desde el modal de la OT */}
    {tramita && (
      <ApprovalModal
        workOrder={workOrder}
        step={tramita}
        onClose={() => setTramita(null)}
        onSuccess={() => { setTramita(null); onSaved(); }}
      />
    )}
    </>
  );
};

// ── KanbanBoard ───────────────────────────────────────────────────────────────

const PRIORITY_LEFT_CLS: Record<string, string> = {
  CRITICAL: "border-l-2 border-l-red-500",
  HIGH:     "border-l-2 border-l-orange-500",
  MEDIUM:   "border-l-2 border-l-yellow-400",
  LOW:      "border-l-2 border-l-blue-400/60",
};

// ── Tramitación: etapa derivada de la cadena de aprobación + estado diferido ──
type WoStage = "SOLICITADA" | "APROBADA" | "AUTORIZADA" | "DIFERIDA" | "HIDDEN";
function woStage(wo: WorkOrder): WoStage {
  if (wo.status === "CLOSED" || wo.status === "CANCELLED") return "HIDDEN"; // no van al tablero
  if (wo.status === "ON_HOLD") return "DIFERIDA";
  if (wo.autorizadoAt) return "AUTORIZADA";
  if (wo.aprobadoAt) return "APROBADA";
  return "SOLICITADA";
}

const KANBAN_COLS: Array<{ colId: WoStage; labelKey: TranslationKey; headerCls: string; borderCls: string; droppable: boolean }> = [
  { colId: "SOLICITADA", labelKey: "wo.kanban.solicitada", headerCls: "text-blue-700 dark:text-blue-400",       borderCls: "border-t-2 border-blue-500/40",   droppable: true  },
  { colId: "APROBADA",   labelKey: "wo.kanban.aprobada",   headerCls: "text-violet-700 dark:text-violet-400",   borderCls: "border-t-2 border-violet-500/40", droppable: true  },
  { colId: "AUTORIZADA", labelKey: "wo.kanban.autorizada", headerCls: "text-emerald-700 dark:text-emerald-400", borderCls: "border-t-2 border-emerald-500/40", droppable: true  },
  { colId: "DIFERIDA",   labelKey: "wo.kanban.onHold",     headerCls: "text-yellow-700 dark:text-yellow-400",   borderCls: "border-t-2 border-yellow-500/40", droppable: true  },
];

function DeferralStatusBadge({ status }: { status: string }) {
  const t = useT();
  const map: Record<string, { label: string; cls: string }> = {
    REQUESTED:    { label: t("wo.deferral.requested"),     cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30" },
    UNDER_REVIEW: { label: t("wo.deferral.underReview"),   cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30" },
    APPROVED:     { label: t("wo.deferral.approved"),      cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
    ACTIVE:       { label: t("wo.deferral.approvedActive"), cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
    REJECTED:     { label: t("wo.deferral.rejected"),      cls: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30" },
    EXPIRED:      { label: t("wo.deferral.expired"),       cls: "bg-fg/5 text-text-industrial/60 border-fg/10" },
    CLOSED:       { label: t("wo.deferral.closed"),        cls: "bg-fg/5 text-text-industrial/60 border-fg/10" },
  };
  const meta = map[status] ?? { label: status, cls: "bg-fg/5 text-text-industrial/60 border-fg/10" };
  return (
    <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function KanbanCardContent({ wo, deferralMap }: {
  wo: WorkOrder;
  deferralMap: Map<string, { id: string; deferralCode: string; status: string }>;
}) {
  const now = new Date();
  const isOverdue = !!wo.dueDate && wo.status !== "CLOSED" && wo.status !== "CANCELLED" && parseLocalDate(wo.dueDate) < now;
  const deferral  = deferralMap.get(wo.id);
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-mono font-bold text-fg text-[10px]">{wo.workOrderCode}</span>
          <span className="ml-1.5"><VesselLabel code={wo.vesselCode} className="text-[10px]" showCode /></span>
        </div>
        <CategoryBadge type={wo.type} />
      </div>
      <div>
        <p className="text-xs text-fg font-medium line-clamp-1">{wo.assetName ?? "—"}</p>
        {wo.title && <p className="text-[10px] text-text-industrial/50 line-clamp-1 mt-0.5">{wo.title}</p>}
      </div>
      <div className="flex items-center justify-between gap-2">
        {wo.dueDate ? (
          <span className={`text-[10px] font-medium ${isOverdue ? "text-red-700 dark:text-red-400" : "text-text-industrial/50"}`}>
            {isOverdue ? "⚠ " : ""}{fmtDate(wo.dueDate)}
          </span>
        ) : <span />}
        {wo.assignedToUserName && (
          <span className="text-[10px] text-text-industrial/40 truncate max-w-[90px]">{wo.assignedToUserName}</span>
        )}
      </div>
      {deferral && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full border bg-fg/5 text-yellow-700 dark:text-yellow-300 border-yellow-500/30 font-mono">
            {deferral.deferralCode}
          </span>
          <DeferralStatusBadge status={deferral.status} />
        </div>
      )}
      {(wo.aprobadoByName || wo.autorizadoByName) && (
        <div className="pt-1 border-t border-fg/10 space-y-0.5">
          {wo.aprobadoByName && (
            <p className="text-[9px] text-text-industrial/50">
              <span className="font-bold text-violet-700 dark:text-violet-400">Aprobó:</span> {wo.aprobadoByName}{wo.aprobadoAt ? ` · ${fmtDate(wo.aprobadoAt)}` : ""}
            </p>
          )}
          {wo.autorizadoByName && (
            <p className="text-[9px] text-text-industrial/50">
              <span className="font-bold text-emerald-700 dark:text-emerald-400">Autorizó:</span> {wo.autorizadoByName}{wo.autorizadoAt ? ` · ${fmtDate(wo.autorizadoAt)}` : ""}
            </p>
          )}
        </div>
      )}
      {wo.rechazadoAt && !wo.aprobadoByName && (
        <div className="pt-1 border-t border-red-500/20 space-y-0.5">
          <p className="text-[9px] text-red-700 dark:text-red-400">
            <span className="font-bold">Rechazó:</span> {wo.rechazadoByName ?? "—"}{wo.rechazadoAt ? ` · ${fmtDate(wo.rechazadoAt)}` : ""}
          </p>
          {wo.rechazoReason && (
            <p className="text-[9px] text-text-industrial/50 line-clamp-2">{wo.rechazoReason}</p>
          )}
        </div>
      )}
    </>
  );
}

function KanbanCard({ wo, deferralMap, isLoading, draggingId, onOpen, onDragStart }: {
  wo: WorkOrder;
  deferralMap: Map<string, { id: string; deferralCode: string; status: string }>;
  isLoading: boolean;
  draggingId: string | null;
  onOpen: (wo: WorkOrder) => void;
  onDragStart: (wo: WorkOrder) => void;
}) {
  const isDraggable = woStage(wo) !== "HIDDEN";
  const isDragging  = draggingId === wo.id;
  const prioLeft    = PRIORITY_LEFT_CLS[wo.priority] ?? "border-l-2 border-l-fg/10";
  const deferral    = deferralMap.get(wo.id);
  // Rojo si: APL de diferimiento rechazada, o la OT fue rechazada en tramitación.
  const rejected    = deferral?.status === "REJECTED" || (!!wo.rechazadoAt && !wo.aprobadoAt);
  const borderCls   = rejected
    ? "border-red-500/40 bg-red-500/[0.04] ring-1 ring-red-500/20"
    : "border-fg/10";

  return (
    <div
      draggable={isDraggable && !isLoading}
      onDragStart={e => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", JSON.stringify({ id: wo.id, stage: woStage(wo) }));
        onDragStart(wo);
      }}
      onDragEnd={() => onDragStart(null as unknown as WorkOrder)}
      onClick={() => !isDragging && !isLoading && onOpen(wo)}
      className={`w-full bg-fg/[0.03] border rounded-xl p-3 space-y-2 select-none
        ${borderCls}
        ${prioLeft}
        ${isDragging ? "opacity-30" : "hover:bg-fg/[0.07]"}
        ${isDraggable ? "cursor-grab" : "cursor-pointer"}
        ${isLoading ? "opacity-60 pointer-events-none" : ""}
        transition-colors`}
    >
      <KanbanCardContent wo={wo} deferralMap={deferralMap} />
    </div>
  );
}

function KanbanBoard({ items, deferralMap, loadingId, loading, onOpen, onReload }: {
  items: WorkOrder[];
  deferralMap: Map<string, { id: string; deferralCode: string; status: string }>;
  loadingId: string | null;
  loading: boolean;
  onOpen: (wo: WorkOrder) => void;
  onReload: () => void;
}) {
  const t = useT();
  const [draggingWo, setDraggingWo]   = useState<WorkOrder | null>(null);
  const [overCol, setOverCol]         = useState<string | null>(null);
  const [pendingHold, setPendingHold] = useState<WorkOrder | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ wo: WorkOrder; step: "APRUEBA" | "AUTORIZA" } | null>(null);
  // ref para evitar stale closure en handleDrop (React 18 batching)
  const draggingWoRef = React.useRef<WorkOrder | null>(null);

  const handleDrop = useCallback((e: React.DragEvent, targetCol: WoStage) => {
    setOverCol(null);
    setDraggingWo(null);
    draggingWoRef.current = null;

    let payload: { id: string; stage: WoStage } | null = null;
    try { payload = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { /* noop */ }
    if (!payload?.id || !payload?.stage) return;

    const { id, stage } = payload;
    if (stage === targetCol) return;
    const wo = items.find(w => w.id === id);
    if (!wo) return;

    // Aprobar (Solicitada → Aprobada): pide nombre.
    if (stage === "SOLICITADA" && targetCol === "APROBADA") { setPendingApproval({ wo, step: "APRUEBA" }); return; }
    // Autorizar (Aprobada → Autorizada): pide nombre. No se puede saltar desde Solicitada.
    if (stage === "APROBADA" && targetCol === "AUTORIZADA") { setPendingApproval({ wo, step: "AUTORIZA" }); return; }
    // Diferir (cualquier etapa activa → Diferida): flujo de diferimiento existente.
    if (targetCol === "DIFERIDA" && stage !== "DIFERIDA") { setPendingHold(wo); return; }
    // Reanudar (Diferida → etapa activa): vuelve a su etapa de aprobación.
    if (stage === "DIFERIDA" && targetCol !== "DIFERIDA") {
      (async () => {
        try { await api.post(`/app/pms/work-orders/${id}/resume`, {}); onReload(); }
        catch (err) { console.error("[kanban] resume failed", err); }
      })();
      return;
    }
    // Cualquier otro movimiento (ej. salto Solicitada→Autorizada, o retroceso) se ignora.
  }, [items, onReload]);

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;

  return (
    <>
      <div className="flex gap-3 pb-4">
        {KANBAN_COLS.map(col => {
          const colItems = items.filter(w => woStage(w) === col.colId);
          const isOver   = overCol === col.colId && col.droppable;
          return (
            <div
              key={col.colId}
              onDragOver={e => { if (col.droppable) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverCol(col.colId); } }}
              onDragLeave={() => setOverCol(null)}
              onDrop={e => { e.preventDefault(); void handleDrop(e, col.colId); }}
              className={`flex-1 min-w-0 flex flex-col ${col.borderCls} pt-3 rounded-b-xl transition-colors duration-100 ${isOver ? "bg-fg/[0.05] ring-1 ring-accent/30" : ""}`}
            >
              <div className="flex items-center gap-2 px-1 mb-3">
                <span className={`text-[11px] font-bold uppercase tracking-widest ${col.headerCls}`}>{t(col.labelKey)}</span>
                <span className="ml-auto text-[10px] font-bold text-text-industrial/40 bg-fg/5 rounded-full px-1.5 py-0.5">{colItems.length}</span>
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
                {colItems.length === 0 && <p className="text-[10px] text-text-industrial/25 text-center py-6">—</p>}
                {colItems.map(wo => (
                  <KanbanCard
                    key={wo.id}
                    wo={wo}
                    deferralMap={deferralMap}
                    isLoading={loadingId === wo.id}
                    draggingId={draggingWo?.id ?? null}
                    onOpen={onOpen}
                    onDragStart={w => { draggingWoRef.current = w; setDraggingWo(w); }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {pendingHold && (
        <HoldModal
          workOrder={pendingHold}
          onClose={() => setPendingHold(null)}
          onSuccess={() => { setPendingHold(null); onReload(); }}
        />
      )}
      {pendingApproval && (
        <ApprovalModal
          workOrder={pendingApproval.wo}
          step={pendingApproval.step}
          onClose={() => setPendingApproval(null)}
          onSuccess={() => { setPendingApproval(null); onReload(); }}
        />
      )}
    </>
  );
}

// ── ApprovalModal: captura el nombre del firmante al aprobar/autorizar ────────
function ApprovalModal({ workOrder, step, onClose, onSuccess }: {
  workOrder: WorkOrder;
  step: "APRUEBA" | "AUTORIZA" | "RECHAZA";
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { user } = useAuth();
  const isReject = step === "RECHAZA";
  const [name, setName] = useState(user?.name ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = step === "APRUEBA" ? "Aprobar OT" : step === "AUTORIZA" ? "Autorizar OT" : "Rechazar OT";
  const verb  = step === "APRUEBA" ? "aprueba" : step === "AUTORIZA" ? "autoriza" : "rechaza";

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Ingresá el nombre."); return; }
    const trimmedReason = reason.trim();
    if (isReject && !trimmedReason) { setError("Ingresá el motivo del rechazo."); return; }
    setSaving(true); setError(null);
    try {
      await api.post(`/app/pms/work-orders/${workOrder.id}/approval`, {
        step, name: trimmed, reason: isReject ? trimmedReason : undefined,
      });
      onSuccess();
    } catch {
      setSaving(false);
      setError("No se pudo registrar. Intentá de nuevo.");
    }
  }

  const confirmCls = isReject
    ? "bg-red-600 text-white hover:brightness-110"
    : "bg-accent text-accent-fg hover:brightness-110";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-bold text-fg">{title}</h2>
          <p className="text-xs text-text-industrial/60 mt-0.5">
            {workOrder.workOrderCode} · {workOrder.assetName ?? workOrder.title ?? ""}
          </p>
          {isReject && (
            <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">La OT vuelve a Solicitada y queda marcada como rechazada.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-text-industrial/60">Nombre de quien {verb}</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !isReject) void submit(); }}
            className="w-full px-3 py-2 rounded-lg bg-fg/5 border border-fg/10 text-fg text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
            placeholder="Nombre y apellido"
          />
        </div>
        {isReject && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-industrial/60">Motivo del rechazo</label>
            <textarea
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-fg/5 border border-fg/10 text-fg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-red-500/40"
              placeholder="Por qué no se aprueba/autoriza…"
            />
          </div>
        )}
        {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm text-text-industrial/70 hover:bg-fg/5 disabled:opacity-50">Cancelar</button>
          <button onClick={() => void submit()} disabled={saving} className={`px-4 py-1.5 rounded-lg text-sm font-bold disabled:opacity-50 flex items-center gap-1.5 ${confirmCls}`}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {title}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export const WorkOrdersPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { selectedVesselCode } = useVesselContext();
  const canManage = user?.role === "TENANT_ADMIN" || user?.role === "MAINTENANCE_MANAGER";

  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing]         = useState<WorkOrder | null>(null);
  const [showCreate, setShowCreate]   = useState(false);
  const [viewMode, setViewMode]       = useState<"list" | "kanban">("kanban");

  useCopilotEmitter(!editing && !showCreate ? { module: "WORK_ORDERS", screen: "WO_LIST" } : null);
  const [showExcel, setShowExcel]     = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [tableActionError, setTableActionError] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);

  const statusFilter   = (searchParams.get("status")    ?? "").trim();
  const typeFilter     = (searchParams.get("type")      ?? "").trim();
  const priorityFilter = (searchParams.get("priority")  ?? "").trim();
  const vesselFilter   = (searchParams.get("vesselCode") ?? "").trim();
  const viewFilter     = (searchParams.get("view")      ?? "").trim(); // open | overdue | closed
  const autoCode       = (searchParams.get("autoCode")  ?? "").trim();

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter)   params.set("status",    statusFilter);
    if (typeFilter)     params.set("type",      typeFilter);
    if (priorityFilter) params.set("priority",  priorityFilter);
    if (vesselFilter)   params.set("vesselCode", vesselFilter);
    const q = params.toString();
    return `/app/pms/work-orders${q ? `?${q}` : ""}`;
  }, [priorityFilter, statusFilter, typeFilter, vesselFilter]);

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);

  // Map of workOrderId → {id, deferralCode, status} for ON_HOLD WOs
  const [deferralMap, setDeferralMap] = useState<Map<string, { id: string; deferralCode: string; status: string }>>(new Map());
  useEffect(() => {
    const onHoldIds = (data?.items ?? []).filter(w => w.status === "ON_HOLD").map(w => w.id);
    if (onHoldIds.length === 0) { setDeferralMap(new Map()); return; }
    let cancelled = false;
    api.get<{ items: { id: string; deferralCode: string; sourceId: string; status: string }[] }>("/app/pms/deferrals")
      .then(r => {
        if (cancelled) return;
        const map = new Map<string, { id: string; deferralCode: string; status: string }>();
        for (const d of r.items ?? []) {
          if (onHoldIds.includes(d.sourceId)) map.set(d.sourceId, { id: d.id, deferralCode: d.deferralCode, status: d.status });
        }
        setDeferralMap(map);
      })
      .catch(() => { if (!cancelled) setDeferralMap(new Map()); });
    return () => { cancelled = true; };
  }, [data]);

  const visibleItems = useMemo(() => {
    const items = data?.items ?? null;
    if (!items || !viewFilter) return items;
    const now = new Date();
    const CLOSED = new Set(["CLOSED", "CANCELLED"]);
    if (viewFilter === "closed")    return items.filter(w => CLOSED.has(w.status));
    if (viewFilter === "postponed") return items.filter(w => w.status === "ON_HOLD");
    if (viewFilter === "postponedRejected") {
      return items.filter(w => w.status === "ON_HOLD" && deferralMap.get(w.id)?.status === "REJECTED");
    }
    if (viewFilter === "postponedPending") {
      return items.filter(w => {
        if (w.status !== "ON_HOLD") return false;
        const s = deferralMap.get(w.id)?.status;
        return s === "REQUESTED" || s === "UNDER_REVIEW";
      });
    }
    if (viewFilter === "overdue")   return items.filter(w => !CLOSED.has(w.status) && w.status !== "ON_HOLD" && !!w.dueDate && parseLocalDate(w.dueDate) < now);
    if (viewFilter === "open")      return items.filter(w => !CLOSED.has(w.status) && w.status !== "ON_HOLD" && !(!!w.dueDate && parseLocalDate(w.dueDate) < now));
    return items;
  }, [data, viewFilter, deferralMap]);

  // Auto-open WO when arriving from a plan badge click
  useEffect(() => {
    if (!autoCode || !data?.items?.length) return;
    const match = data.items.find(w => w.workOrderCode === autoCode);
    if (!match) return;
    setDetailLoadingId(match.id);
    api.get<WorkOrder>(`/app/pms/work-orders/${match.id}`)
      .then(detailed => setEditing(detailed))
      .catch(() => setEditing(match))
      .finally(() => setDetailLoadingId(null));
    const params = new URLSearchParams(searchParams);
    params.delete("autoCode");
    setSearchParams(params, { replace: true });
  }, [autoCode, data, searchParams, setSearchParams]);

  const openDetail = useCallback(async (row: WorkOrder) => {
    setDetailLoadingId(row.id);
    setTableActionError(null);
    try {
      const detailed = await api.get<WorkOrder>(`/app/pms/work-orders/${row.id}`);
      setEditing(detailed);
    } catch { setEditing(row); }
    finally { setDetailLoadingId(null); }
  }, []);

  const openActionModal = useCallback((wo: WorkOrder, type: ActionType) => {
    setActionTarget({ workOrder: wo, type });
  }, []);

  const onActionSuccess = useCallback(() => {
    setActionTarget(null);
    setEditing(null);
    void reload();
  }, [reload]);

  const columns: Column<WorkOrder>[] = useMemo(() => [
    {
      key: "workOrderCode", header: t("wo.col.codeVessel"),
      sortValue: r => `${r.vesselCode} ${r.workOrderCode}`,
      render: r => (
        <div>
          <div className="font-mono font-bold text-fg text-xs">{r.workOrderCode}</div>
          <div className="mt-0.5"><VesselLabel code={r.vesselCode} className="text-[10px]" showCode /></div>
        </div>
      ),
    },
    {
      key: "title", header: t("wo.col.equipmentTask"),
      sortValue: r => r.assetName ?? r.title ?? "",
      render: r => (
        <div>
          <div className="text-xs text-fg font-medium">{r.assetName ?? "—"}</div>
          <div className="text-[10px] text-text-industrial/50 line-clamp-1 mt-0.5">{r.title?.trim() || "—"}</div>
        </div>
      ),
    },
    { key: "type",   header: t("wo.col.category"),   render: r => <CategoryBadge type={r.type} /> },
    { key: "assignedToUserId", header: t("wo.col.assignee"), sortValue: r => r.assignedToUserName ?? r.assignedToUserId ?? "", render: r => <span className="text-xs text-text-industrial/70">{r.assignedToUserName ?? r.assignedToUserId ?? "—"}</span> },
    { key: "openDate", header: t("wo.col.openDate"),    render: r => <span className="text-xs text-text-industrial/60 whitespace-nowrap">{fmtDate(r.openDate)}</span> },
    {
      key: "dueDate", header: t("wo.col.dueDate"),
      render: r => {
        if (!r.dueDate) return <span className="text-xs text-text-industrial/30">—</span>;
        const overdue = r.status !== "CLOSED" && r.status !== "CANCELLED" && parseLocalDate(r.dueDate) < new Date();
        return <span className={`text-xs whitespace-nowrap font-medium ${overdue ? "text-red-700 dark:text-red-400" : "text-text-industrial/60"}`}>{fmtDate(r.dueDate)}</span>;
      },
    },
    {
      key: "status", header: t("wo.col.status"),
      render: r => {
        const deferral = r.status === "ON_HOLD" ? deferralMap.get(r.id) : undefined;
        return (
          <div className="flex flex-col items-start gap-1">
            <WoStatusBadge status={r.status} dueDate={r.dueDate} deferralStatus={deferral?.status} />
            {deferral && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); navigate(`/deferrals?autoCode=${deferral.deferralCode}`); }}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-fg/5 text-yellow-700 dark:text-yellow-300 border-yellow-500/30 font-mono whitespace-nowrap hover:bg-yellow-500/10 cursor-pointer transition-colors"
              >
                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                {deferral.deferralCode}
              </button>
            )}
          </div>
        );
      },
    },
  ], [deferralMap, navigate, t]);

  return (
    <div className="space-y-5">
      <PageHeader icon={Wrench} title={t("page.workOrders")} total={data?.total} onReload={reload}>
        {canManage && (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 transition-all">
            <Plus className="w-3.5 h-3.5" /> {t("wo.new")}
          </button>
        )}
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
        <button
          onClick={async () => { setGeneratingReport(true); try { await printOpenWorkOrdersReport(selectedVesselCode); } finally { setGeneratingReport(false); } }}
          disabled={generatingReport}
          title={selectedVesselCode ? t("wo.page.printOpenForVessel").replace("{vessel}", selectedVesselCode) : t("wo.page.printOpenAll")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 disabled:opacity-50 transition-all"
        >
          {generatingReport ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-accent" />} {t("wo.page.openReport")}{selectedVesselCode ? ` (${selectedVesselCode})` : ""}
        </button>
        <div className="flex items-center gap-0.5 border border-fg/10 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            title="Vista lista"
            className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-fg/10 text-fg" : "text-text-industrial/40 hover:text-fg"}`}
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("kanban")}
            title="Vista Kanban"
            className={`p-1.5 rounded-md transition-colors ${viewMode === "kanban" ? "bg-fg/10 text-fg" : "text-text-industrial/40 hover:text-fg"}`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>
      </PageHeader>

      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />{t("common.loadingDetail")}</div>}
      {tableActionError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{tableActionError}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        {([
          { key: "",                  labelKey: "wo.filter.all" },
          { key: "open",              labelKey: "wo.filter.open" },
          { key: "overdue",           labelKey: "wo.filter.overdue" },
          { key: "postponed",         labelKey: "wo.filter.postponed" },
          { key: "postponedPending",  labelKey: "wo.filter.postponedPending" },
          { key: "postponedRejected", labelKey: "wo.filter.postponedRejected" },
          { key: "closed",            labelKey: "wo.filter.closed" },
        ] as const).map(opt => {
          const active = viewFilter === opt.key;
          return (
            <button
              key={opt.key || "all"}
              type="button"
              onClick={() => {
                const params = new URLSearchParams(searchParams);
                if (opt.key) params.set("view", opt.key); else params.delete("view");
                setSearchParams(params, { replace: true });
              }}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-colors ${
                active
                  ? "bg-accent/20 text-accent border-accent/40"
                  : "bg-fg/5 text-text-industrial/60 border-fg/10 hover:border-fg/20 hover:text-text-industrial"
              }`}
            >
              {t(opt.labelKey)}
            </button>
          );
        })}
      </div>

      {viewMode === "list" ? (
        <DataTable columns={columns} data={visibleItems} loading={loading} error={error} keyFn={r => r.id} emptyText={t("empty.workOrders")} onRowClick={row => { void openDetail(row); }} />
      ) : (
        <KanbanBoard items={visibleItems ?? []} deferralMap={deferralMap} loadingId={detailLoadingId} loading={loading} onOpen={wo => { void openDetail(wo); }} onReload={reload} />
      )}

      {showCreate && (
        <CreateWorkOrderModal
          initialVesselCode={selectedVesselCode ?? undefined}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); void reload(); }}
        />
      )}
      {editing && (
        <WorkOrderModal
          workOrder={editing}
          canManage={canManage}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
          onOpenAction={openActionModal}
        />
      )}
      {actionTarget?.type === "hold"   && <HoldModal   workOrder={actionTarget.workOrder} onClose={() => setActionTarget(null)} onSuccess={onActionSuccess} />}
      {actionTarget?.type === "cancel" && <CancelModal workOrder={actionTarget.workOrder} onClose={() => setActionTarget(null)} onSuccess={onActionSuccess} />}
      {actionTarget?.type === "reopen" && <ReopenModal workOrder={actionTarget.workOrder} onClose={() => setActionTarget(null)} onSuccess={onActionSuccess} />}
      {showExcel && <ExcelPanel module="work_orders" onClose={() => setShowExcel(false)} />}
    </div>
  );
};
