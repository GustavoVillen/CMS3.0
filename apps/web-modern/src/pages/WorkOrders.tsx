import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { AlertTriangle, Camera, CheckCheck, ChevronDown, ExternalLink, FileSpreadsheet, FileText, LayoutGrid, List, Loader2, Maximize2, Mic, Minimize2, Pencil, Plus, Search, ShieldAlert, Sparkles, Trash2, Type, Video as VideoIcon, Wrench, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, type Column } from "../components/DataTable";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { AlertDialog } from "../components/AlertDialog";
import { AssigneeSelect } from "../components/AssigneeSelect";
import { FormModal } from "../components/FormModal";
import { VesselLabel } from "../components/EntityLabels";
import { fmtDate, parseLocalDate } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExcelPanel } from "../components/ExcelPanel";
import { CreateWorkOrderModal, type WoPrefill } from "../components/CreateWorkOrderModal";
import { NewWorkOrderWizard } from "../components/NewWorkOrderWizard";
import { CopyLinkButton } from "../components/CopyLinkButton";
// WoRegiSections/WoRegiClosure ya no se montan acá: sus recuadros son parte de
// la hoja del formulario (WoPaperForm). Se siguen usando sus tipos.
import { type WoRegiForm, type WoPlannedItem } from "../components/work-orders/WoRegiSections";
import { PlannedItemsEditor } from "../components/work-orders/PlannedItemsEditor";
import { WoPlansPanel, type WoPlanRow } from "../components/work-orders/WoPlansPanel";
import { WoScheduleEditor } from "../components/work-orders/WoScheduleEditor";
import { WoPaperForm, WO_FORM_FALLBACK, type WoFormDoc } from "../components/work-orders/WoPaperForm";
import { paperFieldCls } from "../components/paper/PaperKit";
import { WoCloseAuditModal } from "../components/work-orders/WoCloseAuditModal";
import { useTheme } from "../lib/theme";
import { useDeepLink } from "../lib/deep-link";
import { CertificateRenewalDialog, type RenewableCertificate } from "../components/CertificateRenewalDialog";
import { useT, useWoTerms, type TranslationKey } from "../lib/i18n";
import { useAuth, useCan } from "../lib/auth";
import { printWorkOrder, printOpenWorkOrdersReport, printServiceRequest } from "../lib/print-work-order";
import { useVesselContext } from "../lib/vessel-context";
import { useCopilotEmitter, useCopilotApplyFields } from "../lib/copilot-context";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { PermitModal, type PermitModalPrefill } from "./Permits";
import { suggestPermitTypesFromText, PERMIT_TYPE_LABEL, type PermitType } from "../lib/permit-classifier";
import { ProgressNoteSheet } from "../mobile/ProgressNoteSheet";
import { AuthedImage, AuthedVideo, AuthedAudio, AuthedDocLink } from "../lib/authed-media";
import { useTmsaFilter, applyTmsaFilter, TmsaFilterBanner } from "../lib/tmsa-filter";
import { AutoTextArea } from "../components/AutoTextArea";

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

// ── Solicitudes de Servicio (SS) vinculadas ──
// Una SS es el pedido de un servicio externo (un taller) que cuelga de una OT
// abierta. No es un sinónimo de OT: es una entidad aparte con su propio flujo.
// Sólo se puede abrir mientras la OT esté viva (no cerrada/cancelada). Una OT
// DIFERIDA sí admite SS: muchas veces se difiere porque el trabajo depende de un
// taller externo, y esa gestión tiene que poder arrancar igual.
const WO_OPEN_STATUSES_FOR_SS = ["PLANNED", "IN_PROGRESS", "ON_HOLD", "DEFERRED"];

const SS_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador", SOLICITADA: "Solicitada", APROBADA: "Aprobada",
  AUTORIZADA: "Autorizada", IN_PROGRESS: "En ejecución", COMPLETED: "Completada",
  REJECTED: "Rechazada", CANCELLED: "Cancelada",
};
// Punto de color de cada SS dentro de la tarjeta del kanban de OT. Mismos
// colores que las columnas del tablero de SS, para no tener dos códigos.
const SS_DOT_CLS: Record<string, string> = {
  DRAFT: "bg-fg/30", SOLICITADA: "bg-yellow-500", APROBADA: "bg-blue-500",
  AUTORIZADA: "bg-violet-500", IN_PROGRESS: "bg-amber-500", COMPLETED: "bg-emerald-500",
  REJECTED: "bg-red-500", CANCELLED: "bg-fg/20",
};

/**
 * Autorizar es atribución de TIERRA, tanto en la OT como en la SS. Debe
 * coincidir con canAuthorizeWorkOrders / canAuthorize del backend: si se
 * aflojara acá, el arrastre OT→SS se volvería una puerta trasera al gasto.
 */
const CAN_AUTHORIZE_ROLES = ["TENANT_ADMIN", "FLEET_SUPERINTENDENT"];
const SS_STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-fg/5 text-text-industrial/60 border-fg/10",
  SOLICITADA: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
  APROBADA: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  AUTORIZADA: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  IN_PROGRESS: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  COMPLETED: "bg-success-sea/10 text-success-sea border-success-sea/20",
  REJECTED: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  CANCELLED: "bg-fg/5 text-text-industrial/50 border-fg/10",
};

interface LinkedServiceRequest {
  id: string;
  serviceRequestCode: string;
  status: string;
  title: string | null;
  description: string | null;
  openDate: string;
  // Taller al que se le pidió el trabajo (catálogo o escrito a mano).
  providerName: string | null;
  providerId: string | null;
}

/** ESTADO DE OT en el recuadro del papel (texto del documento, en español). */
const WO_STATUS_PAPER_LABEL: Record<string, string> = {
  PLANNED: "Planificada", IN_PROGRESS: "En progreso", ON_HOLD: "Diferida",
  CLOSED: "Cerrada", CANCELLED: "Cancelada",
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
  // OT de la que cuelga el permiso (acá siempre esta OT) — la resuelve el backend.
  workOrderId: string | null;
  workOrderCode: string | null;
  workOrderTitle: string | null;
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
  /** GENERADO POR del formulario: quien creó la OT. */
  createdByName?: string | null;
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
  // Formulario controlado REGI-MAN-02.3 (nullable: las OT anteriores no lo tienen)
  voyageNumber?: string | null;
  operatingCondition?: string | null;
  requestedByArea?: string | null;
  assignedToArea?: string | null;
  systemArea?: string | null;
  maintenanceKind?: string | null;
  taskCompleted?: boolean | null;
  pendingDetail?: string | null;
  // Result fields
  woResult: string | null;
  executedByName: string | null;
  observations: string | null;
  supportingDocUrl: string | null;
  createdAt: string;
  // Tramitación (cadena de aprobación del tablero)
  enviadoAprobacionByName: string | null;
  enviadoAprobacionAt: string | null;
  aprobadoByName: string | null;
  aprobadoAt: string | null;
  autorizadoByName: string | null;
  autorizadoAt: string | null;
  rechazadoByName: string | null;
  rechazadoAt: string | null;
  rechazoReason: string | null;
  // Área / responsable + Mercurio form fields
  department: "CUBIERTA" | "MAQUINAS" | "BARCAZA" | "PROVEEDOR" | "OTROS" | null;
  providerId: string | null;
  providerName: string | null;
  location: string | null;
  communicationMethod: string[];
  distribution: string[];
  // Ítems del PDM que ejecuta la OT. Uno solo en el caso normal; varios cuando
  // una misma orden cubre una parada de astillero. Solo viene en el DETALLE.
  plans?: WoPlanRow[];
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

/**
 * Alto de un textarea según su contenido. Una OT que cubre varios ítems del PDM
 * trae un bloque por ítem en tarea / criterios / LOTO / riesgo / RCM: con el
 * alto fijo de antes se veía sólo el primero y parecía que faltaba el resto.
 */
function autoRows(text: string, min: number, max = 12): number {
  return Math.min(max, Math.max(min, text.split("\n").length));
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

function WoStatusBadge({ status, dueDate, deferralStatus, toNextDrydock }: { status: string; dueDate: string | null; deferralStatus?: string | null; toNextDrydock?: boolean }) {
  const t = useT();
  const isClosed = status === "CLOSED" || status === "CANCELLED";
  const isOpen   = !isClosed;
  const isOverdue = isOpen && !!dueDate && parseLocalDate(dueDate) < new Date();
  if (isClosed)          return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-fg/5 text-text-industrial/50 border-fg/10">{t("wo.status.closed")}</span>;
  if (status === "ON_HOLD") {
    if (deferralStatus === "REJECTED") return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">{t("wo.status.postponedRejected")}</span>;
    // Diferida a varada no es lo mismo que diferida un par de semanas: el
    // trabajo salió del alcance de a bordo.
    if (toNextDrydock) return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20">{t("wo.status.postponedDrydock")}</span>;
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
  const woTerms = useWoTerms();
  const [holdReason,            setHoldReason]            = useState("");
  const [targetDate,            setTargetDate]            = useState("");
  const [compensatoryMeasures,  setCompensatoryMeasures]  = useState("");
  const [toNextDrydock,         setToNextDrydock]         = useState(false);
  const [openSpecs,             setOpenSpecs]             = useState<{ specCode: string }[] | null>(null);
  const [loadingAI,             setLoadingAI]             = useState(false);
  const [saving,                setSaving]                = useState(false);
  const [submitting,            setSubmitting]            = useState(false);
  const [err,                   setErr]                   = useState<string | null>(null);

  // Especificaciones de varada editables del buque: sirven para decirle al
  // usuario, antes de tildar, dónde va a aterrizar el trabajo.
  useEffect(() => {
    let cancelled = false;
    api.get<{ items: { specCode: string; status: string }[] }>(`/app/pms/drydock-specs?vesselCode=${encodeURIComponent(workOrder.vesselCode)}`)
      .then(res => {
        if (cancelled) return;
        setOpenSpecs((res.items ?? []).filter(s => s.status !== "APPROVED" && s.status !== "CANCELLED"));
      })
      .catch(() => { if (!cancelled) setOpenSpecs([]); });
    return () => { cancelled = true; };
  }, [workOrder.vesselCode]);

  const doHold = useCallback(async (): Promise<string | null> => {
    if (!holdReason.trim()) { setErr(t("wo.holdReason")); return null; }
    const res = await api.post<{ deferralId?: string | null }>(`/app/pms/work-orders/${workOrder.id}/hold`, {
      holdReason: holdReason.trim(),
      targetDate: targetDate || null,
      compensatoryMeasures: compensatoryMeasures.trim() || null,
      toNextDrydock,
    });
    return res.deferralId ?? null;
  }, [holdReason, targetDate, compensatoryMeasures, toNextDrydock, workOrder.id, t]);

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
        sourceTypeLabel:   woTerms.full,
        sourceDisplayName: [workOrder.workOrderCode, workOrder.title].filter(Boolean).join(" — "),
        sourceTask:        (workOrder as any).description ?? null,
        requestedAt:       new Date().toISOString(),
        targetDate:        targetDate || null,
        justification:     holdReason.trim() || null,
      });
      setCompensatoryMeasures(res.text);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo generar la sugerencia con IA.");
    }
    finally { setLoadingAI(false); }
  }, [workOrder, targetDate, holdReason, woTerms]);

  const isBusy = saving || submitting;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="text-sm font-bold text-fg">{t("wo.hold")}</h2>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className={labelCls}>{t("wo.holdReason")}</label>
            <AutoTextArea rows={3} value={holdReason} onChange={e => setHoldReason(e.target.value)} className={`${inputCls} mt-1`} />
          </div>
          <div>
            <label className={labelCls}>{t("wo.holdTargetDate")}</label>
            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className={`${inputCls} mt-1`} />
          </div>
          <div className="rounded-xl border border-fg/10 bg-fg/5 px-3 py-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={toNextDrydock}
                onChange={e => setToNextDrydock(e.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span className="min-w-0">
                <span className="block text-xs font-bold text-fg">{t("wo.holdToDrydock")}</span>
                <span className="block text-[10px] text-text-industrial/50 mt-0.5">{t("wo.holdToDrydockHint")}</span>
              </span>
            </label>
            {toNextDrydock && openSpecs && (
              <p className="text-[10px] text-text-industrial/60 mt-2 pl-6">
                {openSpecs.length === 1
                  ? <>{t("wo.holdToDrydockSpec")} <span className="font-mono font-bold text-fg">{openSpecs[0]!.specCode}</span>.</>
                  : openSpecs.length === 0
                    ? t("wo.holdToDrydockNoSpec")
                    : t("wo.holdToDrydockMulti")}
              </p>
            )}
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
            <AutoTextArea
              rows={5}
              value={compensatoryMeasures}
              onChange={e => setCompensatoryMeasures(e.target.value)}
              disabled={loadingAI}
              placeholder="Medidas para mitigar el riesgo mientras dure el diferimiento…"
              className={`${inputCls} disabled:opacity-50`}
            />
          </div>
          {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
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
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="p-6 space-y-3">
          <label className={labelCls}>{t("wo.cancelReason")}</label>
          <AutoTextArea rows={4} value={cancelReason} onChange={e => setCancelReason(e.target.value)} className={inputCls} />
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
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="p-6 space-y-3">
          <p className="text-[11px] text-text-industrial/70 leading-snug">
            {t("wo.reopenWarning")}
          </p>
          <label className={labelCls}>{t("wo.reopenReason")}</label>
          <AutoTextArea rows={4} value={reason} onChange={e => setReason(e.target.value)} className={inputCls} placeholder={t("wo.reopenReasonPlaceholder")} />
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
  kind: "TEXT" | "PHOTO" | "VIDEO" | "AUDIO" | "DOCUMENT";
  text: string | null;
  fileUrl: string | null;
  createdAt: string;
}

const KIND_ICON: Record<string, React.FC<{ className?: string }>> = {
  TEXT: Type, PHOTO: Camera, VIDEO: VideoIcon, AUDIO: Mic, DOCUMENT: FileText,
};
const KIND_LABEL: Record<string, string> = {
  TEXT: "Texto", PHOTO: "Foto", VIDEO: "Video", AUDIO: "Audio", DOCUMENT: "Documento",
};

/**
 * Un avance como FILA de grilla, igual que Programación de trabajo: fecha, tipo,
 * detalle y acciones. Antes cada avance era una tarjeta con la foto o el video a
 * ancho completo: diez avances ocupaban pantallas enteras y no se podía leer la
 * secuencia del trabajo de un vistazo. La foto/video queda como miniatura y se
 * amplía al hacer click (el mismo visor del mosaico).
 */
/** Mismo recuadro que las celdas de Programación de trabajo (WoScheduleEditor). */
const noteCellCls = "w-full bg-transparent border border-fg/10 rounded-md px-1.5 py-0.5 text-[11px] leading-tight text-fg";

const ProgressNoteRow: React.FC<{
  note: ProgressNote;
  onDelete?: () => void;
  onSave?: (text: string) => Promise<void>;
  onOpenMedia?: () => void;
}> = ({ note, onDelete, onSave, onOpenMedia }) => {
  const Icon = KIND_ICON[note.kind] ?? Type;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text ?? "");
  const [saving, setSaving] = useState(false);
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
  const doSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try { await onSave(draft); setEditing(false); }
    catch { /* el caller muestra el error */ }
    finally { setSaving(false); }
  };
  const esVisual = (note.kind === "PHOTO" || note.kind === "VIDEO") && !!note.fileUrl;

  return (
    <tr className="align-top">
      <td className="px-1">
        <div className={`${noteCellCls} text-text-industrial/70 whitespace-nowrap`}>{fmtTime(note.createdAt)}</div>
      </td>
      <td className="px-1">
        <div className={`${noteCellCls} flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-industrial/60`}>
          <Icon className="w-3 h-3 shrink-0" />{KIND_LABEL[note.kind] ?? note.kind}
        </div>
      </td>
      <td className="px-1">
        <div className={`${noteCellCls} flex items-start gap-2 min-w-0`}>
          {esVisual && (
            <button type="button" onClick={onOpenMedia} title="Ampliar"
              className="relative shrink-0 w-8 h-8 rounded-md overflow-hidden border border-fg/10 bg-fg/5 hover:border-accent/40 transition-colors">
              {note.kind === "PHOTO"
                ? <AuthedImage src={note.fileUrl!} alt="" className="w-full h-full object-cover" />
                : <>
                    <AuthedVideo src={note.fileUrl!} className="w-full h-full object-cover" muted />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <VideoIcon className="w-4 h-4 text-white drop-shadow" />
                    </span>
                  </>}
            </button>
          )}
          {note.kind === "AUDIO" && note.fileUrl && (
            <AuthedAudio src={note.fileUrl} controls className="h-7 max-w-[220px]" />
          )}
          {note.kind === "DOCUMENT" && note.fileUrl && <AuthedDocLink src={note.fileUrl} />}

          {editing ? (
            <div className="flex-1 min-w-0 space-y-1.5">
              <AutoTextArea
                rows={autoRows(draft, 3, 10)}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                disabled={saving}
                // Sin borde propio: ya está dentro del recuadro de la celda.
                className="w-full bg-fg/5 border-0 rounded-md px-1.5 py-1 text-[11px] text-fg leading-relaxed focus:outline-none disabled:opacity-60"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(false)} disabled={saving}
                  className="px-2 py-1 rounded-lg text-[10px] text-text-industrial/70 hover:bg-fg/5 disabled:opacity-50">
                  Cancelar
                </button>
                <button type="button" onClick={() => { void doSave(); }} disabled={saving}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-accent text-accent-fg hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />} Guardar
                </button>
              </div>
            </div>
          ) : (
            note.text && (
              <p className="flex-1 min-w-0 text-[11px] text-fg/85 whitespace-pre-line leading-tight">{note.text}</p>
            )
          )}
        </div>
      </td>
      <td className="px-1 whitespace-nowrap text-right">
        {onSave && !editing && (
          <button type="button" onClick={() => { setDraft(note.text ?? ""); setEditing(true); }}
            className="p-0.5 text-text-industrial/40 hover:text-accent transition-colors" title="Editar avance">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={onDelete}
            className="p-0.5 text-text-industrial/40 hover:text-red-700 dark:hover:text-red-400 transition-colors" title="Borrar avance">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
};

const ProgressNotesPanel: React.FC<{
  workOrderId: string;
  canAdd: boolean;
  canDelete: boolean;
  canEdit: boolean;
  onAdd: () => void;
  reloadKey: number;
  onChanged?: () => void;
}> = ({ workOrderId, canAdd, canDelete, canEdit, onAdd, reloadKey, onChanged }) => {
  const t = useT();
  const { data, loading, reload } = useFetch<{ items: ProgressNote[] }>(
    `/app/pms/work-orders/${workOrderId}/progress-notes`,
    [workOrderId, reloadKey],
  );
  const notes = data?.items ?? [];

  // El padre bumpea `reloadKey` tras agregar/editar/borrar un avance. El refetch
  // por deps respeta el cache SWR (30s) y devolvería la lista vieja; por eso acá
  // forzamos una recarga fresca (reload = load(true), ignora el cache).
  const reloadKeyRef = React.useRef(reloadKey);
  useEffect(() => {
    if (reloadKeyRef.current === reloadKey) return;
    reloadKeyRef.current = reloadKey;
    void reload();
  }, [reloadKey, reload]);
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
      onChanged?.();
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : t("error.deleteProgress"));
    }
  }, [workOrderId, reload, onChanged]);

  const handleSave = useCallback(async (noteId: string, text: string) => {
    try {
      await api.patch(`/app/pms/work-orders/${workOrderId}/progress-notes/${noteId}`, { text });
      await reload();
      onChanged?.();
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : "No se pudo guardar el avance.");
      throw e;
    }
  }, [workOrderId, reload, onChanged]);

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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-separate border-spacing-y-0.5">
            <thead>
              <tr className="text-[9px] uppercase tracking-widest text-text-industrial/50">
                <th className="text-left font-semibold px-1 w-[104px]">Fecha</th>
                <th className="text-left font-semibold px-1 w-[70px]">Tipo</th>
                <th className="text-left font-semibold px-1">Detalle</th>
                <th className="w-[56px]" />
              </tr>
            </thead>
            <tbody>
              {notes.map(n => (
                <ProgressNoteRow
                  key={n.id}
                  note={n}
                  onDelete={canDelete ? () => { void handleDelete(n.id); } : undefined}
                  onSave={canEdit ? (text) => handleSave(n.id, text) : undefined}
                  onOpenMedia={() => setLightbox(n)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Lightbox para ampliar la foto/video al hacer click en el mosaico */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm" onClick={() => setLightbox(null)}>
          <ModalCloseButton onClose={() => setLightbox(null)} className="absolute top-4 right-4 z-10" />
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

/**
 * Nueva SS desde la OT. Lo único que hay que escribir es qué servicio se le pide
 * al taller: el resto lo hereda el backend de la OT (buque, equipo, causas…).
 */
const NewServiceRequestModal: React.FC<{
  defaultValue: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (servicio: string) => Promise<void>;
}> = ({ defaultValue, busy, onClose, onConfirm }) => {
  const [servicio, setServicio] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);

  const confirmar = async () => {
    if (!servicio.trim()) { setError("Escribí qué servicio se solicita."); return; }
    setError(null);
    try { await onConfirm(servicio.trim()); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear la solicitud de servicio."); }
  };

  return (
    <FormModal
      title="Nueva solicitud de servicio"
      subtitle="Se hereda el resto de los datos de esta orden de trabajo"
      onClose={onClose}
      error={error}
      footer={
        <>
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-[11px] text-text-industrial/60">
            Cancelar
          </button>
          <button type="button" onClick={() => { void confirmar(); }} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-[11px] font-bold disabled:opacity-50">
            {busy ? "Creando…" : "Crear SS"}
          </button>
        </>
      }
    >
      <div>
        <label className={labelCls}>¿Qué servicio se solicita al taller externo?</label>
        <AutoTextArea className={inputCls + " min-h-[72px] resize-y"} value={servicio} autoFocus
          onChange={e => setServicio(e.target.value)}
          placeholder="Ej. Reparación del servo timón de babor" />
      </div>
    </FormModal>
  );
};

// ── WorkOrderModal ────────────────────────────────────────────────────────────

interface WorkOrderModalProps {
  workOrder: WorkOrder;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
  onOpenAction: (wo: WorkOrder, type: ActionType) => void;
  onReload: () => void;
  /**
   * La OT cerró y con ella quedó ejecutado su plan de mantenimiento. Lo maneja
   * la PÁGINA (no el modal) porque al cerrar la OT este modal se desmonta: si el
   * plan renueva un certificado, el ofrecimiento tiene que sobrevivir a eso.
   */
  onPlanExecuted?: (maintenancePlanId: string, completedAt: string | null) => void;
}

const WorkOrderModal: React.FC<WorkOrderModalProps> = ({ workOrder, canManage, onClose, onSaved, onOpenAction, onReload, onPlanExecuted }) => {
  const t = useT();
  const woTerms = useWoTerms();
  const navigate = useNavigate();
  const { tenant, user } = useAuth();
  // Tenants con el formulario controlado de Mercurio. "MERCURIO_OT" es el
  // formulario vigente (REGI-MAN-02.3) y "MERCURIO" el anterior, que se
  // conserva para poder volver atrás: los dos usan estos campos.
  const isMercurio = !!tenant?.workOrderPdfTemplate?.startsWith("MERCURIO");
  const isEditable = canEditStatus(workOrder.status);
  const isAdmin = user?.role === "TENANT_ADMIN";

  // ── Hoja del formulario controlado (REGI-MAN-02.3) ──
  // Las secciones y los rótulos salen del tenant, igual que el PDF: pantalla y
  // papel no pueden divergir. Sólo se pide con el formulario de Mercurio activo.
  const { data: woFormDoc } = useFetch<WoFormDoc>(
    isMercurio ? "/app/pms/work-orders/form" : null, [isMercurio]);
  const paperDoc = woFormDoc ?? WO_FORM_FALLBACK;
  const { vessels: contextVesselsForPaper } = useVesselContext();
  const paperVesselName =
    contextVesselsForPaper.find(v => v.code === workOrder.vesselCode)?.name ?? workOrder.vesselCode;
  const { theme: paperTheme } = useTheme();
  // El logo del papel es oscuro: en modo oscuro gana el logo claro del tenant.
  const paperLogo = paperTheme === "dark"
    ? (tenant?.logoUrlLight || paperDoc.logoUrl || tenant?.logoUrl || null)
    : (paperDoc.logoUrl || tenant?.logoUrl || tenant?.logoUrlLight || null);

  // Tramitación: los avances (5) y el resultado (6) se habilitan desde que la OT
  // está APROBADA. La aprobación es la que da luz verde a ejecutar y registrar el
  // trabajo; la autorización de tierra sigue siendo el paso siguiente, pero ya no
  // frena la carga de avances/resultado. En SOLICITADA quedan deshabilitados.
  const isAuthorized = !!workOrder.autorizadoAt;
  const isApproved = !!workOrder.aprobadoAt || isAuthorized;
  const isResultEditable = isEditable && isApproved;
  // Sub-estado de la cadena de aprobación (independiente del status operativo).
  // Misma derivación que woStage(); acá no hacen falta DIFERIDA/HIDDEN porque
  // el modal ya tiene la OT abierta.
  const tramitaPhase: "EN_PREPARACION" | "SOLICITADA" | "APROBADA" | "AUTORIZADA" =
    workOrder.autorizadoAt ? "AUTORIZADA"
    : workOrder.aprobadoAt ? "APROBADA"
    : workOrder.enviadoAprobacionAt ? "SOLICITADA"
    : "EN_PREPARACION";
  const isRejected = !!workOrder.rechazadoAt && !workOrder.aprobadoAt;
  // Autorizar (OT y SS) es sólo de tierra. Debe coincidir con
  // canAuthorizeWorkOrders del backend.
  const canAuthorizeWo = CAN_AUTHORIZE_ROLES.includes(user?.role ?? "");
  // step de tramitación pendiente (abre ApprovalModal). null = cerrado.
  const [tramita, setTramita] = useState<"ENVIA" | "APRUEBA" | "AUTORIZA" | "RECHAZA" | null>(null);

  // Linked deferrals (current + history). Cargamos todas las APLs vinculadas a esta OT.
  interface DeferralLite { id: string; deferralCode: string; status: string; requestedAt: string; targetDate: string | null; justification: string | null; toNextDrydock?: boolean }
  const [deferralStatus, setDeferralStatus] = useState<string | null>(null);
  const [deferralToDrydock, setDeferralToDrydock] = useState(false);
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
        setDeferralToDrydock(active?.toNextDrydock === true);
        setDeferralTargetDate(active?.targetDate ?? null);
        // Historial: el resto (excluye el activo)
        setDeferralHistory(active ? items.filter(d => d.id !== active.id) : []);
      })
      .catch(() => { if (!cancelled) { setDeferralStatus(null); setDeferralToDrydock(false); setDeferralTargetDate(null); setDeferralHistory([]); } });
    return () => { cancelled = true; };
  }, [workOrder.id, workOrder.status, deferralReloadKey]);

  // ── Área / responsable + Mercurio form fields ──
  const [department, setDepartment]         = useState<string>(workOrder.department ?? "");
  const [providerId, setProviderId]         = useState<string>(workOrder.providerId ?? "");
  const [location, setLocation]             = useState(workOrder.location ?? "");
  const [commMethod, setCommMethod]         = useState<string[]>(workOrder.communicationMethod ?? []);
  const [distribution, setDistribution]     = useState<string[]>(workOrder.distribution ?? []);

  // Prioridad de la OT. En el formulario REGI-MAN-02.3 se elige por plazo
  // (Inmediato / 24hs / Semana / Mes) — es el mismo dato con otro nombre.
  const [priority, setPriority] = useState<string>(workOrder.priority ?? "MEDIUM");

  // ── Formulario controlado REGI-MAN-02.3 ──
  // Nullable en la base: las OT anteriores al formulario abren con los recuadros
  // vacíos y siguen siendo válidas.
  const [regiForm, setRegiForm] = useState<WoRegiForm>({
    voyageNumber:    workOrder.voyageNumber ?? "",
    operatingCondition: workOrder.operatingCondition ?? "",
    requestedByArea: workOrder.requestedByArea ?? "",
    assignedToArea:  workOrder.assignedToArea ?? "",
    systemArea:      workOrder.systemArea ?? "",
    maintenanceKind: workOrder.maintenanceKind ?? "",
    pendingDetail:   workOrder.pendingDetail ?? "",
    taskCompleted:   workOrder.taskCompleted === true ? "YES" : workOrder.taskCompleted === false ? "NO" : "",
  });
  const [plannedItems, setPlannedItems] = useState<WoPlannedItem[]>([]);
  const { data: plannedItemsData, reload: reloadPlannedItems } = useFetch<{ items: WoPlannedItem[] }>(
    isMercurio ? `/app/pms/work-orders/${workOrder.id}/items` : null,
    [workOrder.id],
  );
  useEffect(() => {
    if (!plannedItemsData?.items) return;
    // La recarga trae la verdad del servidor, pero NO debe pisar las filas que el
    // usuario está cargando: "+ Agregar" crea una fila vacía que todavía no se
    // guardó (sin descripción no se persiste), y sin esto la recarga posterior al
    // auto-guardado la hacía desaparecer al segundo de aparecer.
    setPlannedItems(prev => {
      const enCurso = prev.filter(i => !i.id && !i.description.trim());
      return [...plannedItemsData.items, ...enCurso];
    });
  }, [plannedItemsData]);

  // Estado del auto-guardado del bloque REGI-MAN-02.3 (ver saveRegiBlock).
  const [regiSaving, setRegiSaving] = useState(false);
  const [regiSaved, setRegiSaved] = useState(false);
  const [regiErr, setRegiErr] = useState<string | null>(null);
  /** Se marca en los onChange del bloque: distingue edición del usuario de carga inicial. */
  const regiTouched = useRef(false);
  const regiSavedSnapshotRef = useRef<string | null>(null);
  const touchRegi = useCallback(() => { regiTouched.current = true; }, []);

  // Talleres del buque. Se piden cuando el trabajo se le da a un tercero:
  // "Asignado a: Tercerizado" en el formulario REGI-MAN-02.3, o el área
  // PROVEEDOR en los tenants que siguen con el formulario anterior.
  const [providers, setProviders] = useState<Array<{ id: string; name: string; providerCode: string }>>([]);
  // Empresa tercerizada fuera del catálogo (alternativa a providerId).
  const [providerOther, setProviderOther] = useState((workOrder as any).providerOther ?? "");
  const needsProvider = department === "PROVEEDOR" || regiForm.assignedToArea === "TERCERIZADO";
  useEffect(() => {
    if (!needsProvider || providers.length > 0) return;
    let cancelled = false;
    api.get<{ items: Array<{ id: string; name: string; providerCode: string }> }>(`/app/providers?status=ACTIVE`)
      .then(r => { if (!cancelled) setProviders(r.items ?? []); })
      .catch(() => { if (!cancelled) setProviders([]); });
    return () => { cancelled = true; };
  }, [needsProvider, providers.length]);


  // ── Plan fields ──
  const [title, setTitle]                   = useState(workOrder.title ?? "");
  const [description, setDescription]       = useState(workOrder.description ?? "");
  // Guarda el ID del usuario (el desplegable resuelve el nombre). En OT viejas
  // este campo trae el nombre tipeado a mano y se conserva tal cual.
  const [assignedTo, setAssignedTo]         = useState(workOrder.assignedToUserId ?? "");
  const [dueDate, setDueDate]               = useState(toDateInputValue(workOrder.dueDate));
  const [openDate, setOpenDate]             = useState(toDateInputValue(workOrder.openDate));
  const [type, setType]                     = useState(workOrder.type);
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
  // RESPONSABLE del cierre: arranca con el TECNICO de la hoja. Es el mismo dato
  // en el 99% de los casos y hacía escribir a mano un nombre que el sistema ya
  // tenía. Se resuelve el id contra el directorio (lo mismo que lee
  // AssigneeSelect); si el técnico no está en la lista, vale el nombre que traiga
  // la OT. Sólo se completa mientras el campo está vacío: un nombre escrito a
  // mano nunca se pisa.
  const { data: directoryData } = useFetch<Array<{ userId: string; name: string }>>("/app/team/directory");
  const tecnicoName = useMemo(() => {
    const people = Array.isArray(directoryData) ? directoryData : [];
    const known = people.find(p => p.userId === assignedTo);
    if (known) return known.name;
    // Directorio todavía cargando: no arriesgar a poner un id como nombre.
    if (people.length === 0) return workOrder.assignedToUserName ?? "";
    // Valor que no está en el directorio: es un nombre viejo tipeado a mano.
    return workOrder.assignedToUserName ?? assignedTo;
  }, [directoryData, assignedTo, workOrder.assignedToUserName]);
  useEffect(() => {
    if (!executedByName.trim() && tecnicoName) setExecutedByName(tecnicoName);
  }, [tecnicoName, executedByName]);
  const [executionDate, setExecutionDate]   = useState(toDateInputValue(workOrder.completedDate));
  // FECHA INICIO del recuadro de Programación de trabajo. El sistema la carga
  // sola al pasar la OT a ejecución, pero también se escribe a mano: las OT
  // históricas o las que se cerraron sin pasar por "iniciar" la traían vacía.
  const [startDate, setStartDate]           = useState(toDateInputValue(workOrder.startDate));
  const [actualHours, setActualHours] = useState(
    workOrder.actualHours != null ? String(workOrder.actualHours) : ""
  );
  const [runningHoursAtExecution, setRunningHoursAtExecution] = useState(
    (workOrder as any).runningHoursAtExecution != null ? String((workOrder as any).runningHoursAtExecution) : ""
  );
  const [observations, setObservations]     = useState(workOrder.observations ?? workOrder.closeNotes ?? "");
  // Último valor de Observaciones traído del servidor. Sirve para refrescar el
  // campo tras un avance (la IA lo reconsolida) SIN pisar ediciones manuales del
  // usuario: solo se actualiza si el campo sigue igual a este baseline.
  const lastServerObsRef = React.useRef(workOrder.observations ?? workOrder.closeNotes ?? "");
  // OJO: "Deficiencias encontradas" NO es una columna de la OT — no existe en el
  // modelo. Es un campo de trabajo cuyo destino es la descripción del registro
  // de defecto. Por eso arranca vacío y, si se sale del modal, el texto queda
  // sólo en el defecto (ver el efecto de más abajo, que lo vuelve a traer).
  const [deficienciasText, setDeficienciasText] = useState("");
  const [supportingDocFile, setSupportingDocFile] = useState<File | null>(null);
  const [supportingDocUrl] = useState(workOrder.supportingDocUrl ?? "");
  // Solo OT correctivas ("Reparación"): detalle del defecto que motivó la reparación.
  // Si se completa, al cerrar la OT se abre el alta de defecto pre-cargada.
  const isCorrective = type === "CORRECTIVE";
  const [defectDetail, setDefectDetail] = useState("");

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
  // Auditoría de IA previa al cierre. Guarda las opciones del diálogo de cierre
  // (quién cierra, con qué fecha) mientras la auditoría corre: la OT se cierra
  // recién cuando el usuario decide desde el informe.
  const [closeAuditOpts, setCloseAuditOpts] = useState<{ completedDate?: string; closedByUserId?: string } | null>(null);
  // "Guardar" no cierra la ventana: feedback + reset del dirty-tracker.
  const [justSaved, setJustSaved] = useState(false);
  const [saveResetKey, setSaveResetKey] = useState(0);

  // Cierre por ADMIN: pregunta quién cierra (firma CIERRA) y con qué fecha.
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeOnBehalfUserId, setCloseOnBehalfUserId] = useState(user?.id ?? "");
  const [closeDate, setCloseDate] = useState("");
  const [closeTeamUsers, setCloseTeamUsers] = useState<{ userId: string; firstName: string | null; lastName: string | null; formName: string | null; hasSignature: boolean }[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    api.get<typeof closeTeamUsers>("/app/team/members")
      .then(rows => setCloseTeamUsers(Array.isArray(rows) ? rows : []))
      .catch(() => setCloseTeamUsers([]));
  }, [isAdmin]);
  const closeMemberName = (u: { firstName: string | null; lastName: string | null; formName: string | null }) =>
    (u.formName || [u.firstName, u.lastName].filter(Boolean).join(" ") || "").trim();

  const { data: sparesData } = useFetch<{ items: Array<{ id: string; sku: string; name: string; unit: string; criticality: string; onHand: number; available: number; minStock: number; reorderPoint: number }> }>(
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

  const updateUsageQty = (idx: number, raw: string) => {
    const qty = raw === "" ? 0 : parseFloat(raw);
    setSpareUsages(prev => prev.map((u, i) => (i === idx ? { ...u, qty: Number.isFinite(qty) ? qty : 0 } : u)));
  };

  // ── Defect registration prompt ──
  type DefectPrompt = "idle" | "ask" | "creating" | "created" | "declined";
  const [defectPrompt, setDefectPrompt] = useState<DefectPrompt>("idle");
  const [createdDefectCode, setCreatedDefectCode] = useState<string | null>(null);
  // Se guarda también el id para poder ofrecer el link al defecto recién creado
  // sin sacar al usuario de la OT.
  const [createdDefectId, setCreatedDefectId] = useState<string | null>(null);

  // Defectos ya vinculados a esta OT, leídos de la base. Es lo que hace que el
  // código siga visible: el estado de arriba se pierde cada vez que la ventana
  // se rearma (por ejemplo al volver del defecto), y antes el recuadro aparecía
  // vacío como si nunca se hubiera creado nada. También muestra los defectos
  // abiertos en sesiones anteriores.
  const { data: linkedDefectsData, reload: reloadLinkedDefects } =
    useFetch<{ items: Array<{ id: string; defectCode: string; description: string }> }>(
      `/app/pms/defects?workOrderId=${encodeURIComponent(workOrder.id)}`,
      [workOrder.id],
    );
  const linkedDefects = linkedDefectsData?.items ?? [];

  // Repone "Deficiencias encontradas" desde el defecto ya registrado.
  //
  // El texto no se guarda en la OT (no hay columna): al crear el defecto pasa a
  // ser SU descripción. Sin esto, al volver del defecto —o al reabrir la OT— el
  // campo aparecía vacío y parecía que se había borrado lo escrito.
  //
  // Sólo se repone si el campo está vacío: si el usuario ya está escribiendo,
  // no se le pisa lo suyo.
  const firstLinkedDefectDescription = linkedDefects[0]?.description ?? "";
  useEffect(() => {
    if (!firstLinkedDefectDescription) return;
    setDeficienciasText(prev => (prev.trim() ? prev : firstLinkedDefectDescription));
  }, [firstLinkedDefectDescription]);

  const handleWoResultChange = (val: string) => {
    const next = woResult === val ? "" : val;
    setWoResult(next);
    if (next === "WITH_DEFICIENCIES") setDefectPrompt("ask");
    else { setDefectPrompt("idle"); setCreatedDefectCode(null); }
  };

  /**
   * Crea el registro de defecto SIN salir de la OT.
   *
   * Antes navegaba a /defects apenas se creaba, y eso echaba al usuario del
   * formulario de cierre que estaba completando — con lo escrito a medias.
   * Ahora el defecto se crea en segundo plano y el aviso ofrece el link para
   * ir cuando quiera. Lo usa tanto el prompt del cierre como el diálogo
   * posterior (donde además hay que poder seguir con la OT correctiva).
   */
  const createDefectInline = useCallback(async () => {
    setDefectPrompt("creating");
    try {
      const res = await api.post<{ id: string; defectCode: string }>("/app/pms/defects", {
        vesselCode: workOrder.vesselCode,
        assetId: workOrder.assetId,
        workOrderId: workOrder.id,
        classification: "WORK_ORDER_FINDING",
        severity: "MEDIUM",
        description: deficienciasText.trim() || observations.trim() || `Deficiencias encontradas en ${woTerms.abbr} ${workOrder.workOrderCode}`,
      });
      setCreatedDefectCode(res.defectCode ?? null);
      setCreatedDefectId(res.id ?? null);
      setDefectPrompt("created");
      reloadLinkedDefects(); // el recuadro lee de la base, no del estado local
    } catch { setDefectPrompt("ask"); }
  }, [deficienciasText, observations, workOrder, woTerms, reloadLinkedDefects]);

  const [saving,          setSaving]         = useState(false);
  const [resuming,        setResuming]       = useState(false);
  const [closing,         setClosing]        = useState(false);
  const [err,             setErr]            = useState<string | null>(null);
  const [expanded,        setExpanded]       = useState(true);
  const [loadingTitle, setLoadingTitle] = useState(false);
  const [loadingTask, setLoadingTask] = useState(false);
  const [loadingCriteria, setLoadingCriteria] = useState(false);
  const [loadingLoto,     setLoadingLoto]    = useState(false);
  const [loadingRisk,     setLoadingRisk]    = useState(false);
  const [loadingConsequence, setLoadingConsequence] = useState(false);
  const [loadingRewrite,   setLoadingRewrite]    = useState(false);
  const [showProgressSheet, setShowProgressSheet] = useState(false);
  const [notesReloadKey,    setNotesReloadKey]    = useState(0);

  // Tras guardar/editar/borrar un avance, reconsulta la OT (con delay para dar
  // tiempo al pipeline asincrónico de IA que reconsolida Observaciones y detecta
  // repuestos) y refresca la ventana: spareUsages + Observaciones.
  const refreshAfterAvance = useCallback(() => {
    const delay = 5000;
    setTimeout(async () => {
      try {
        const fresh = await api.get<{ spareUsages?: any[]; observations?: string | null; closeNotes?: string | null }>(
          `/app/pms/work-orders/${workOrder.id}`,
        );
        // ── Repuestos detectados por IA ──
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
        // ── Observaciones reconsolidadas (sin pisar ediciones manuales) ──
        const serverObs = fresh.observations ?? fresh.closeNotes ?? "";
        const baseline = lastServerObsRef.current;
        lastServerObsRef.current = serverObs;
        setObservations(prev => (prev === baseline ? serverObs : prev));
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

  // Clic en el rótulo TAREA: la IA arma la lista de tareas desde el equipo y el
  // título. Si el campo ya tiene texto se lo manda y devuelve la lista completa
  // con lo escrito integrado (por eso reemplaza en vez de agregar).
  const handleTitleClick = useCallback(async () => {
    if (!isEditable || loadingTitle) return;
    setLoadingTitle(true);
    try {
      const res = await api.post<{ text: string }>("/app/pms/work-orders/suggest-title", {
        assetLabel: workOrder.assetName ?? null,
        taskDesc: description.trim() || title.trim() || null,
      });
      const sugerido = (res.text ?? "").trim();
      if (sugerido) setTitle(sugerido);
    } catch { /* el campo queda como estaba */ }
    finally { setLoadingTitle(false); }
  }, [isEditable, loadingTitle, workOrder.assetName, description, title]);

  const handleTaskClick = useCallback(async () => {
    if (!isEditable || loadingTask) return;
    const base = (title || "").trim();
    if (!base) return;
    setLoadingTask(true);
    try {
      const res = await api.post<{ text: string }>("/app/pms/work-orders/suggest-task", {
        assetLabel: workOrder.assetName ?? null,
        taskDesc: base,
        existingTasks: description.trim() || null,
      });
      const sugerido = (res.text ?? "").trim();
      if (sugerido) setDescription(sugerido);
    } catch { /* el campo queda como estaba */ }
    finally { setLoadingTask(false); }
  }, [isEditable, loadingTask, workOrder.assetName, title, description]);

  // Inspección vs mantenimiento: la IA calibra con esto el alcance de criterios,
  // LOTO, riesgo y RCM (una inspección general no se analiza como un desarme).
  const aiTaskType: "INSPECTION" | "MAINTENANCE" = type === "INSPECTION" ? "INSPECTION" : "MAINTENANCE";

  const handleAcceptanceCriteriaClick = useCallback(async () => {
    if (!isEditable || loadingCriteria) return;
    setLoadingCriteria(true);
    setAcceptanceCriteria("Analizando...");
    try {
      const res = await api.post<{ text: string }>("/app/pms/work-orders/suggest-acceptance-criteria", {
        assetLabel: workOrder.assetName ?? null,
        taskDesc: description || title || null,
        taskType: aiTaskType,
        vesselCode: workOrder.vesselCode,
      });
      setAcceptanceCriteria(res.text || "");
    } catch { setAcceptanceCriteria(""); }
    finally { setLoadingCriteria(false); }
  }, [isEditable, loadingCriteria, workOrder.assetName, workOrder.vesselCode, aiTaskType, description, title]);

  const handleLotoClick = useCallback(async () => {
    if (!isEditable || loadingLoto) return;
    setLoadingLoto(true);
    setLoto("Analizando...");
    try {
      const res = await api.post<{ text: string }>("/app/pms/work-orders/suggest-loto", {
        assetLabel: workOrder.assetName ?? null,
        taskDesc: description || title || null,
        taskType: aiTaskType,
        vesselCode: workOrder.vesselCode,
        acceptanceCriteria: acceptanceCriteria || null,
      });
      setLoto(res.text || "");
    } catch { setLoto(""); }
    finally { setLoadingLoto(false); }
  }, [isEditable, loadingLoto, workOrder.assetName, workOrder.vesselCode, aiTaskType, description, title, acceptanceCriteria]);

  const handleRiskClick = useCallback(async () => {
    if (!isEditable || loadingRisk) return;
    setLoadingRisk(true);
    try {
      const res = await api.post<{ level: string; analysis: string }>("/app/pms/work-orders/suggest-risk", {
        assetLabel: workOrder.assetName ?? null,
        taskDesc: description || title || null,
        taskType: aiTaskType,
        vesselCode: workOrder.vesselCode,
        acceptanceCriteria: acceptanceCriteria || null,
        loto: loto || null,
      });
      if (res.level && ["LOW","MEDIUM","HIGH","CRITICAL"].includes(res.level)) setRiskLevel(res.level);
      if (res.analysis) setRiskAnalysisResult(res.analysis);
    } catch { /* noop */ }
    finally { setLoadingRisk(false); }
  }, [isEditable, loadingRisk, workOrder.assetName, workOrder.vesselCode, aiTaskType, description, title, acceptanceCriteria, loto]);

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
          taskType: aiTaskType,
          vesselCode: workOrder.vesselCode,
        },
      );
      if (res.category && ["SAFETY","ENVIRONMENTAL","OPERATIONAL","NON_OPERATIONAL"].includes(res.category)) {
        setConsequenceCategory(res.category);
      }
      if (res.rationale) setConsequenceRationale(res.rationale);
    } catch { /* noop */ }
    finally { setLoadingConsequence(false); }
  }, [isEditable, loadingConsequence, workOrder.assetName, workOrder.assetId, workOrder.vesselCode, aiTaskType, title, description]);

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
    workOrderCode: workOrder.workOrderCode,
    workOrderTitle: workOrder.title ?? undefined,
    lockWorkOrder: true,
    location: workOrder.location ?? "",
    description: title || description || workOrder.title || workOrder.description || "",
  }), [workOrder, title, description, advisoryMatches]);

  // ── Solicitudes de Servicio (SS) de esta OT ──
  // Una SS es el pedido de un servicio externo (un taller) y sólo puede abrirse
  // desde una OT abierta — de ahí que el botón dependa del estado de la OT.
  const { data: linkedSrData, reload: reloadServiceRequests } = useFetch<{ items: LinkedServiceRequest[] }>(
    `/app/pms/work-orders/${workOrder.id}/service-requests`,
    [workOrder.id],
  );
  const linkedServiceRequests = linkedSrData?.items ?? [];

  // PROVEEDOR del recuadro ASIGNADO A: se lee de las Solicitudes de Servicio de
  // la OT, que es donde realmente se elige el taller. Antes la hoja tenía su
  // propio selector y podía decir una cosa distinta de la SS; y con más de un
  // taller sólo mostraba uno. Acá se listan todos, sin repetir.
  const ssProviderNames = useMemo(
    () => [...new Set(linkedServiceRequests.map(sr => sr.providerName).filter(Boolean) as string[])],
    [linkedServiceRequests],
  );
  // Muestra de análisis generada por esta OT. Si existe, la OT es de muestreo y
  // el código FA se muestra junto a sus SS: es el número que después se busca en
  // "Muestreos y Análisis". La SS no tiene vínculo propio con la muestra — el
  // puente es la OT, que es de donde sale la muestra al autorizarse.
  const { data: linkedSampleData } = useFetch<{ items: Array<{ id: string; sampleCode: string }> }>(
    `/app/fluid-analyses?workOrderId=${encodeURIComponent(workOrder.id)}`,
    [workOrder.id],
  );
  const linkedSample = linkedSampleData?.items?.[0] ?? null;
  // Alcanza con que la OT esté abierta: la SS se carga junto con la OT y la
  // tramitación de la OT la arrastra (OT aprobada → SS aprobada; OT autorizada →
  // SS autorizada). Ya no se exige que la OT esté autorizada de antemano.
  const canOpenServiceRequest = WO_OPEN_STATUSES_FOR_SS.includes(workOrder.status);
  const [creatingSr, setCreatingSr] = useState(false);
  const [newSrOpen, setNewSrOpen] = useState(false);
  // Lo único que no se puede heredar: qué servicio se le pide al tercero. El
  // resto (buque, equipo, departamento, causas, taller) lo completa el backend
  // desde la OT — ver createServiceRequestForWorkOrder.
  const handleCreateServiceRequest = useCallback(async (servicio: string) => {
    setCreatingSr(true);
    try {
      await api.post(`/app/pms/work-orders/${workOrder.id}/service-requests`, {
        title: servicio,
        description: servicio,
        priority: workOrder.priority,
      });
      reloadServiceRequests();
      setNewSrOpen(false);
    } finally {
      setCreatingSr(false);
    }
  }, [workOrder, reloadServiceRequests]);

  // Cuando el plan trae más de un taller (ej. Clase + Espesores), la OT abre
  // una SS por taller y el campo único "Asignado a: Tercerizado" del papel no
  // alcanza para mostrarlos a todos. En ese caso WoRegiSections lista una fila
  // por SS con su propio selector; esto la guarda directo en la SS.
  const handleChangeServiceRequestProvider = useCallback(async (serviceRequestId: string, newProviderId: string) => {
    await api.patch(`/app/pms/service-requests/${serviceRequestId}`, { providerId: newProviderId || null });
    reloadServiceRequests();
  }, [reloadServiceRequests]);

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

  // La exportación a Word se quitó de la OT: el documento válido es el PDF del
  // formulario controlado. El endpoint /doc sigue existiendo en el backend.

  // Cambio de TIPO (Preventivo/Correctivo/Inspección): auto-guardado inmediato
  // por endpoint dedicado (permiso amplio, cualquier usuario no-auditor), sin
  // pasar por el "Guardar" gateado por gestión. Revierte si el server rechaza.
  const [savingType, setSavingType] = useState(false);
  const saveType = useCallback(async (next: string) => {
    const prev = type;
    if (next === prev) return;
    setType(next);
    setSavingType(true);
    try {
      await api.patch(`/app/pms/work-orders/${workOrder.id}/type`, { type: next });
    } catch {
      setType(prev);
    } finally {
      setSavingType(false);
    }
  }, [type, workOrder.id]);

  // ── IA sugiere abrir un Defecto al escribir en la OT (título/tarea/avance) ──
  // On-blur (título/tarea) y al guardar un avance: la IA lee el texto y, si
  // detecta una deficiencia, ofrece crear un stub en Defectos sin interrumpir.
  const canWriteDefects = !!user && ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "TECHNICIAN_OPERATOR", "INSPECTOR_COMPLIANCE"].includes(user.role);
  const [defAi, setDefAi] = useState<{ reason: string; severity: string; sourceText: string } | null>(null);
  const [defAiCreating, setDefAiCreating] = useState(false);
  const [defAiCreatedCode, setDefAiCreatedCode] = useState<string | null>(null);
  const defAiSeen = useRef<Set<string>>(new Set()); // dedupe: textos ya analizados/descartados/creados

  const analyzeForDeficiency = useCallback(async (text: string, source: string) => {
    const clean = (text ?? "").trim();
    if (!canWriteDefects || clean.length < 12 || defAiSeen.current.has(clean)) return;
    defAiSeen.current.add(clean);
    try {
      const res = await api.post<{ warrants: boolean; reason: string; severity: string }>(
        "/app/pms/defects/detect-deficiency",
        { text: clean, assetLabel: workOrder.assetName, source },
      );
      if (res.warrants) {
        setDefAiCreatedCode(null);
        setDefAi({ reason: res.reason, severity: res.severity || "MEDIUM", sourceText: clean });
      }
    } catch { /* falla suave: no sugerir */ }
  }, [canWriteDefects, workOrder.assetName]);

  const createDeficiencyStub = useCallback(async () => {
    if (!defAi) return;
    setDefAiCreating(true);
    try {
      const res = await api.post<{ id: string; defectCode: string }>("/app/pms/defects", {
        vesselCode: workOrder.vesselCode,
        assetId: workOrder.assetId,
        workOrderId: workOrder.id,
        classification: "WORK_ORDER_FINDING",
        severity: defAi.severity,
        description: defAi.sourceText,
      });
      setDefAiCreatedCode(res.defectCode);
      setDefAi(null);
    } catch { /* dejar el banner para reintentar */ } finally {
      setDefAiCreating(false);
    }
  }, [defAi, workOrder.vesselCode, workOrder.assetId, workOrder.id]);

  const dismissDefAi = useCallback(() => { setDefAi(null); setDefAiCreatedCode(null); }, []);

  // PATCH con todos los campos editables. Reusado por "Guardar" y por "Cerrar OT".
  const patchWorkOrder = useCallback(async (chkUrl: string | null, supUrl: string | null) => {
    await api.patch(`/app/pms/work-orders/${workOrder.id}`, {
      title: normalizeOptionalText(title),
      description: normalizeOptionalText(description),
      assignedToUserId: normalizeOptionalText(assignedTo),
      dueDate: dueDate || null,
      openDate: openDate || undefined,
      startDate: startDate || null,
      type,
      priority: priority as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      acceptanceCriteria: normalizeOptionalText(acceptanceCriteria),
      loto,
      riskLevel: normalizeOptionalText(riskLevel),
      riskAnalysisResult: normalizeOptionalText(riskAnalysisResult),
      consequenceCategory: consequenceCategory || null,
      consequenceRationale: normalizeOptionalText(consequenceRationale),
      department: (department as any) || null,
      // El taller se guarda si el trabajo se terceriza — sea por el formulario
      // nuevo ("Asignado a: Tercerizado") o por el área PROVEEDOR del anterior.
      providerId: needsProvider ? (providerId || null) : null,
      providerOther: needsProvider ? normalizeOptionalText(providerOther) : null,
      location: normalizeOptionalText(location),
      communicationMethod: commMethod,
      distribution,
      // Formulario REGI-MAN-02.3. Sólo se manda en los tenants que lo usan;
      // en el resto los campos no existen en el modal y quedarían en null.
      ...(isMercurio ? {
        voyageNumber: normalizeOptionalText(regiForm.voyageNumber),
        operatingCondition: regiForm.operatingCondition || null,
        requestedByArea: regiForm.requestedByArea || null,
        assignedToArea: regiForm.assignedToArea || null,
        systemArea: regiForm.systemArea || null,
        maintenanceKind: regiForm.maintenanceKind || null,
        pendingDetail: normalizeOptionalText(regiForm.pendingDetail),
        taskCompleted: regiForm.taskCompleted === "YES" ? true : regiForm.taskCompleted === "NO" ? false : null,
      } : {}),
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

    // Repuestos/materiales del formulario: se sincronizan aparte (tabla hija).
    // Los que ya existen se dejan como están; se crean los nuevos y se borran
    // los que el usuario quitó.
    if (isMercurio) {
      const base = `/app/pms/work-orders/${workOrder.id}/items`;
      const kept = new Set(plannedItems.map(i => i.id).filter(Boolean) as string[]);
      const original = plannedItemsData?.items ?? [];
      await Promise.all([
        ...original.filter(o => o.id && !kept.has(o.id)).map(o => api.delete(`${base}/${o.id}`)),
        ...plannedItems.filter(i => !i.id && i.description.trim()).map(i =>
          api.post(base, { kind: i.kind, spareId: i.spareId ?? null, description: i.description, quantity: i.quantity, unit: i.unit })),
        ...plannedItems.filter(i => i.id && i.description.trim()).map(i =>
          api.patch(`${base}/${i.id}`, { kind: i.kind, spareId: i.spareId ?? null, description: i.description, quantity: i.quantity, unit: i.unit })),
      ]);
    }
  }, [title, description, assignedTo, dueDate, openDate, startDate, type, priority, acceptanceCriteria, loto, riskLevel, riskAnalysisResult,
      consequenceCategory, consequenceRationale, department, providerId, location, commMethod, distribution,
      woResult, executedByName, executionDate, runningHoursAtExecution, actualHours, observations, spareUsages,
      isMercurio, needsProvider, regiForm, plannedItems, plannedItemsData, workOrder.id]);

  // ── Auto-guardado del formulario REGI-MAN-02.3 ────────────────────────────
  // El bloque son casi todos tildes: obligar a acordarse del botón "Guardar" es
  // una invitación a perder el dato. Peor: el dirty-tracker de abajo NO mira
  // estos campos, así que al salir se perdían EN SILENCIO, sin siquiera avisar.
  //
  // El patch es acotado a los campos del bloque a propósito: tildar "Preventivo"
  // no debe arrastrar al servidor un título a medio tipear del resto del modal.
  const saveRegiBlock = useCallback(async () => {
    setRegiSaving(true); setRegiErr(null);
    try {
      await api.patch(`/app/pms/work-orders/${workOrder.id}`, {
        priority: priority as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
        location: normalizeOptionalText(location),
        providerId: needsProvider ? (providerId || null) : null,
        providerOther: needsProvider ? normalizeOptionalText(providerOther) : null,
        voyageNumber: normalizeOptionalText(regiForm.voyageNumber),
        operatingCondition: regiForm.operatingCondition || null,
        requestedByArea: regiForm.requestedByArea || null,
        assignedToArea: regiForm.assignedToArea || null,
        systemArea: regiForm.systemArea || null,
        maintenanceKind: regiForm.maintenanceKind || null,
        pendingDetail: normalizeOptionalText(regiForm.pendingDetail),
        taskCompleted: regiForm.taskCompleted === "YES" ? true : regiForm.taskCompleted === "NO" ? false : null,
      });
      // Repuestos/materiales viven en una tabla hija: crear los nuevos, borrar
      // los quitados, actualizar los que quedaron.
      const base = `/app/pms/work-orders/${workOrder.id}/items`;
      const kept = new Set(plannedItems.map(i => i.id).filter(Boolean) as string[]);
      const original = plannedItemsData?.items ?? [];
      await Promise.all([
        ...original.filter(o => o.id && !kept.has(o.id)).map(o => api.delete(`${base}/${o.id}`)),
        ...plannedItems.filter(i => !i.id && i.description.trim()).map(i =>
          api.post(base, { kind: i.kind, spareId: i.spareId ?? null, description: i.description, quantity: i.quantity, unit: i.unit })),
        ...plannedItems.filter(i => i.id && i.description.trim()).map(i =>
          api.patch(`${base}/${i.id}`, { kind: i.kind, spareId: i.spareId ?? null, description: i.description, quantity: i.quantity, unit: i.unit })),
      ]);
      // Recuperar los ids de los ítems recién creados: sin esto, el próximo
      // auto-guardado los volvería a crear (duplicados).
      reloadPlannedItems();
      setRegiSaved(true);
      window.setTimeout(() => setRegiSaved(false), 2000);
      onReload();
    } catch (e) {
      setRegiErr(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setRegiSaving(false);
    }
  }, [workOrder.id, priority, location, providerId, providerOther, needsProvider, regiForm, plannedItems,
      plannedItemsData, reloadPlannedItems, onReload, t]);

  // Huella de lo que edita el bloque. Los ids de los ítems quedan FUERA: al
  // recargarlos tras guardar, la huella no cambia y el efecto no se redispara.
  const regiSnapshot = JSON.stringify({
    regiForm, priority, location, providerId, providerOther,
    // Sólo los ítems que REALMENTE se persisten: una fila recién agregada, sin
    // descripción, no se guarda — y por lo tanto tampoco debe disparar un
    // guardado (que además recargaría la lista y le borraría la fila al usuario).
    items: plannedItems
      .filter(i => i.description.trim())
      .map(i => ({ kind: i.kind, description: i.description, quantity: i.quantity, unit: i.unit })),
  });

  useEffect(() => {
    // Sólo tras una edición real del usuario: si no, el efecto dispararía un
    // guardado apenas terminan de cargar los ítems del servidor.
    if (!regiTouched.current) return;
    if (!isMercurio || !isEditable) return;
    if (regiSavedSnapshotRef.current === regiSnapshot) return; // ya guardado
    const id = window.setTimeout(() => {
      regiSavedSnapshotRef.current = regiSnapshot;
      void saveRegiBlock();
    }, 700); // deja terminar de tipear antes de mandar
    return () => window.clearTimeout(id);
  }, [regiSnapshot, isMercurio, isEditable, saveRegiBlock]);

  /** Devuelve si el guardado salió bien: la tramitación no debe avanzar si falló. */
  const onSave = useCallback(async (): Promise<boolean> => {
    setSaving(true); setErr(null);
    try {
      const [chkUrl, supUrl] = await Promise.all([
        uploadIfNeeded(checklistDocFile, checklistDocUrl),
        uploadIfNeeded(supportingDocFile, supportingDocUrl),
      ]);
      await patchWorkOrder(chkUrl, supUrl);
      // No cerramos la ventana: confirmamos, reseteamos el dirty-tracker y
      // recargamos el listado de fondo.
      setSaveResetKey(k => k + 1);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
      onReload();
      return true;
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); return false; }
    finally { setSaving(false); }
  }, [uploadIfNeeded, checklistDocFile, checklistDocUrl, supportingDocFile, supportingDocUrl, patchWorkOrder, onReload, t]);

  // ESC guard
  const isDirty = useDirtyTracker({
    title, description, assignedTo, dueDate, openDate, startDate, type, acceptanceCriteria, loto, riskLevel, riskAnalysisResult,
    consequenceCategory, consequenceRationale,
    department, providerId, location, commMethod, distribution,
    checklistDocFileName: checklistDocFile?.name ?? "",
    woResult, executedByName, executionDate, runningHoursAtExecution, actualHours, observations,
    supportingDocFileName: supportingDocFile?.name ?? "",
  }, saveResetKey);

  /**
   * Abre un paso de tramitación GUARDANDO ANTES lo que esté pendiente.
   *
   * Dos motivos: la firma tiene que quedar sobre el documento que la persona
   * está viendo, y el paso recarga la OT desde el servidor — sin guardar, lo
   * recién tipeado se perdía en silencio. Si el guardado falla no se abre el
   * paso: no se firma sobre datos que nunca llegaron a la base.
   */
  const openTramita = async (step: "ENVIA" | "APRUEBA" | "AUTORIZA" | "RECHAZA") => {
    if (isDirty && !(await onSave())) return;
    setTramita(step);
  };

  /**
   * Sale de la OT hacia otra pantalla (defecto, SS, muestra) GUARDANDO ANTES.
   *
   * Irse del modal descarta lo que esté a medio tipear, y el guard de Escape no
   * cubre estos links: sólo se dispara al cerrar. Si el guardado falla no se
   * navega — perder el trabajo por irse a mirar otra cosa es inaceptable.
   */
  const saveThenNavigate = async (to: string) => {
    if (isDirty && !(await onSave())) return;
    navigate(to);
  };

  const woClosedReadOnly = workOrder.status === "CLOSED" || workOrder.status === "CANCELLED";
  const requestClose = useEscapeGuard({
    enabled: !woClosedReadOnly,
    isDirty,
    // onSave ahora devuelve si guardó bien (lo usa la tramitación); el guard
    // sólo necesita esperar a que termine.
    onSave: async () => { await onSave(); },
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

  // Cierre finalizado: cierra el modal y, si es OT correctiva con detalle de
  // defecto, abre el alta de defecto pre-cargada. Se usa tanto en el cierre
  // directo como tras aceptar el aviso de stock, para que el defecto se abra
  // igual aunque haya repuestos que superen el stock.
  const finishClose = useCallback(async () => {
    // La OT ya se cerró: generamos el PDF (no bloqueante si falla).
    try { await printWorkOrder(workOrder); } catch { /* non-blocking */ }
    // Antes, un cierre "con deficiencias" abría un diálogo ofreciendo registrar
    // el defecto y/o abrir la OT correctiva. Se quitó por pedido del cliente:
    // el defecto ya se registra desde el propio formulario de cierre (recuadro
    // naranja), así que el diálogo repetía un paso ya hecho.
    setClosingWarning(null);
    onSaved();
    if (isCorrective && defectDetail.trim().length > 0) {
      navigate("/defects", { state: { createDefectFromWo: {
        workOrderId: workOrder.id,
        vesselCode: workOrder.vesselCode,
        assetId: workOrder.assetId,
        assetName: workOrder.assetName ?? null,
        detail: defectDetail.trim(),
        taskContext: [workOrder.title, workOrder.description].filter(Boolean).join(" — ") || null,
      } } });
    }
  }, [onSaved, woResult, isCorrective, defectDetail, navigate, workOrder]);

  // opts (solo admin): completedDate = fecha de cierre elegida; closedByUserId = quién cierra (firma CIERRA).
  // observationsOverride: el informe de la auditoría de cierre, ya concatenado.
  // Va por parámetro y no por estado porque el cierre se dispara en el mismo
  // click que lo agrega, y el estado todavía no se actualizó.
  const onClose_WO = useCallback(async (opts?: { completedDate?: string; closedByUserId?: string; observationsOverride?: string }) => {
    if (!woResult) { setErr(t("wo.modal.resultRequired")); return; }
    setClosing(true); setErr(null);
    try {
      const [chkUrl, supUrl] = await Promise.all([
        uploadIfNeeded(checklistDocFile, checklistDocUrl),
        uploadIfNeeded(supportingDocFile, supportingDocUrl),
      ]);
      // 1. Guardar TODOS los edits (igual que "Guardar").
      await patchWorkOrder(chkUrl, supUrl);
      // 2. Cerrar la OT.
      const res = await api.post<{ id: string; failedMovements?: string[] }>(`/app/pms/work-orders/${workOrder.id}/close`, {
        woResult,
        executedByName: normalizeOptionalText(executedByName),
        completedDate: opts?.completedDate || executionDate || null,
        observations: normalizeOptionalText(opts?.observationsOverride ?? observations),
        supportingDocUrl: supUrl,
        runningHoursAtExecution: runningHoursAtExecution ? Number(runningHoursAtExecution) : null,
        actualHours: actualHours ? Number(actualHours) : null,
        spareUsages: spareUsages.map(u => ({ spareId: u.spareId, qty: u.qty, unit: u.unit })),
        closedByUserId: opts?.closedByUserId || undefined,
      });
      // 3. Generar PDF y finalizar (finishClose imprime el PDF). Si hubo repuestos
      // sin stock, se muestra el aviso y el PDF se genera al "Aceptar y cerrar".
      if (res.failedMovements && res.failedMovements.length > 0) {
        setClosingWarning(t("wo.modal.closeStockWarning").replace("{count}", String(res.failedMovements.length)));
      } else {
        await finishClose();
      }
      // Cerrar la OT deja ejecutado el plan: si ese plan renueva un certificado,
      // la página ofrece cargarlo (acá no: este modal está por desmontarse).
      if (workOrder.maintenancePlanId) {
        onPlanExecuted?.(workOrder.maintenancePlanId, opts?.completedDate || executionDate || null);
      }
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setClosing(false); }
  }, [woResult, checklistDocFile, checklistDocUrl, supportingDocFile, supportingDocUrl, patchWorkOrder,
      executedByName, executionDate, observations,
      runningHoursAtExecution, actualHours, spareUsages, uploadIfNeeded, finishClose, t, workOrder.id,
      workOrder.maintenancePlanId, onPlanExecuted]);

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
          <div className="flex items-center gap-3 min-w-0">
            <Wrench className="w-4 h-4 text-accent shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("wo.entityLabel")}</p>
              {/* El equipo va SIEMPRE junto al código: sin él hay que bajar hasta
                  el cuerpo del formulario para saber de qué máquina se trata.
                  Se muestra el NOMBRE, nunca el id interno: si el nombre no está
                  resuelto, se omite (un cuid no le dice nada a nadie). */}
              <div className="flex items-baseline gap-1.5 min-w-0">
                <h2 className="text-sm font-bold text-fg font-mono shrink-0">{workOrder.workOrderCode}</h2>
                {workOrder.assetName && (
                  <span className="text-sm text-text-industrial/70 truncate" title={workOrder.assetName}>
                    · {workOrder.assetName}
                  </span>
                )}
              </div>
            </div>
            <WoStatusBadge status={workOrder.status} dueDate={workOrder.dueDate} deferralStatus={deferralStatus} toNextDrydock={deferralToDrydock} />
            {/* VENCIMIENTO, a la derecha del badge de estado. Es su único lugar:
                se sacó de la grilla de recuadros de INFORMACIÓN, que además está
                oculta entera en los tenants con formulario controlado — ahí el
                vencimiento no se veía en ningún lado, sólo como "Vencida" en el
                badge de al lado, sin la fecha y sin poder corregirla.
                No va adentro del formulario porque REGI-MAN-02.3 es documento
                controlado: no se le agregan recuadros que el papel no tiene. */}
            {(
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] uppercase tracking-wider text-text-industrial/40 whitespace-nowrap">
                  {t("wo.modal.dueDate")}
                </span>
                {(tramitaPhase === "SOLICITADA" || isAdmin) && isEditable ? (
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    title={tramitaPhase === "AUTORIZADA" ? t("wo.modal.dueDateAuthorizedHint") : undefined}
                    className="bg-transparent text-xs text-fg border border-fg/15 rounded-md px-1.5 py-0.5 focus:outline-none focus:border-accent/50"
                  />
                ) : (
                  <span className={`text-xs font-mono ${
                    workOrder.dueDate && !isClosed && parseLocalDate(workOrder.dueDate) < new Date()
                      ? "text-red-700 dark:text-red-400 font-semibold"
                      : "text-fg"
                  }`}>
                    {fmtDate(workOrder.dueDate) || "—"}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <CopyLinkButton />
            <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-text-industrial/30 hover:text-fg hover:bg-fg/5 transition-colors" title={expanded ? t("common.minimize") : t("common.maximize")}>
              {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <ModalCloseButton onClose={requestClose} />
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">

          {/* ── IA: posible deficiencia detectada en el texto de la OT ── */}
          {(defAi || defAiCreatedCode) && (
            <div className="rounded-xl border border-orange-500/25 bg-orange-500/5 p-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
              {defAiCreatedCode ? (
                <div className="flex-1 flex items-center justify-between gap-2">
                  <p className="text-xs text-orange-700 dark:text-orange-300">{t("wo.defAi.created").replace("{code}", defAiCreatedCode)}</p>
                  <button type="button" onClick={dismissDefAi} className="text-fg/30 hover:text-fg shrink-0"><X className="w-3.5 h-3.5" /></button>
                </div>
              ) : defAi ? (
                <div className="flex-1 space-y-2">
                  <p className="text-xs font-bold text-orange-700 dark:text-orange-300">{t("wo.defAi.title")}</p>
                  <p className="text-xs text-fg/70">{defAi.reason}</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => { void createDeficiencyStub(); }} disabled={defAiCreating}
                      className="px-2.5 py-1 rounded-lg bg-orange-500/20 text-orange-700 dark:text-orange-300 text-[11px] font-bold hover:bg-orange-500/30 disabled:opacity-50 transition-all">
                      {defAiCreating ? t("wo.defAi.creating") : t("wo.defAi.openDefect")}
                    </button>
                    <button type="button" onClick={dismissDefAi} className="px-2.5 py-1 rounded-lg text-[11px] text-fg/50 hover:text-fg transition-colors">
                      {t("wo.defAi.dismiss")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* ── 0. TRAMITACIÓN (En preparación → Envía → Aprueba → Autoriza) ── */}
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

              {tramitaPhase === "AUTORIZADA" && workOrder.type === "INSPECTION"
                && workOrder.autorizadoByName === "Sistema" ? (
                /* Inspección propia: no pasa por aprobación ni autorización,
                   nace autorizada. Mostrar "Aprobó: Sistema" confundiría — se
                   explica la regla. Las SS de esta OT sí se aprueban y autorizan.
                   La firma "Sistema" es la marca de que se autorizó sola
                   (INSPECTION_AUTO_SIGNER en wo-inspection-flow.ts): una
                   inspección SUBCONTRATADA tramita como cualquier otra OT y
                   lleva firmas humanas, así que cae en la rama de abajo y se
                   muestra quién aprobó y quién autorizó. */
                <div className="text-xs text-emerald-700 dark:text-emerald-300 space-y-0.5">
                  <p className="normal-case">{t("wo.tramita.inspectionAutoAuthorized")}</p>
                  <p className="text-text-industrial/60 normal-case">{t("wo.tramita.inspectionSsNote")}</p>
                </div>
              ) : tramitaPhase === "AUTORIZADA" ? (
                <div className="text-xs text-emerald-700 dark:text-emerald-300 space-y-0.5">
                  {workOrder.aprobadoByName && <p><span className="font-bold">Aprobó:</span> {workOrder.aprobadoByName}{workOrder.aprobadoAt ? ` · ${fmtDate(workOrder.aprobadoAt)}` : ""}</p>}
                  <p><span className="font-bold">Autorizó:</span> {workOrder.autorizadoByName}{workOrder.autorizadoAt ? ` · ${fmtDate(workOrder.autorizadoAt)}` : ""}</p>
                  <p className="text-text-industrial/60 normal-case">{woTerms.abbr} autorizada — avances y resultado habilitados.</p>
                </div>
              ) : tramitaPhase === "EN_PREPARACION" ? (
                /* Todavía la está completando quien la abrió: un solo botón,
                   para mandarla a firmar. "No aprobar" no tiene sentido acá —
                   nadie la recibió todavía. */
                <>
                  <p className="text-[11px] text-text-industrial/60 normal-case">
                    {t("wo.tramita.enPreparacionHint")}
                  </p>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => openTramita("ENVIA")}
                    className="w-full py-2 rounded-xl border text-xs font-bold bg-accent/10 text-accent border-accent/30 hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {t("wo.tramita.send")}
                  </button>
                </>
              ) : (
                <>
                  {tramitaPhase === "APROBADA" && (
                    <>
                      <p className="text-[11px] text-text-industrial/60">
                        <span className="font-bold text-violet-700 dark:text-violet-400">Aprobó:</span> {workOrder.aprobadoByName}{workOrder.aprobadoAt ? ` · ${fmtDate(workOrder.aprobadoAt)}` : ""}
                      </p>
                      <p className="text-[11px] text-text-industrial/60 normal-case">{woTerms.abbr} aprobada — avances y resultado habilitados.</p>
                    </>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving || (tramitaPhase === "APROBADA" && !canAuthorizeWo)}
                      title={tramitaPhase === "APROBADA" && !canAuthorizeWo
                        ? "Autorizar es atribución de tierra: Superintendente técnico o DPA / Director de Operaciones."
                        : undefined}
                      onClick={() => openTramita(tramitaPhase === "SOLICITADA" ? "APRUEBA" : "AUTORIZA")}
                      className="flex-1 py-2 rounded-xl border text-xs font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {tramitaPhase === "SOLICITADA" ? "APROBAR" : "AUTORIZAR"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openTramita("RECHAZA")}
                      className="flex-1 py-2 rounded-xl border text-xs font-bold bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30 hover:bg-red-500/20 transition-colors"
                    >
                      {tramitaPhase === "SOLICITADA" ? "NO APROBAR" : "NO AUTORIZAR"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── 2. PLAN ── */}
          <section className="space-y-4">
            <PhaseHeader
              n={isMercurio ? 1 : 2}
              label={t("wo.modal.section.plan")}
              dotCls="bg-accent/20 text-accent"
              borderCls="border-accent/30"
            />

            {/* ── Ítems del PDM que ejecuta esta OT (uno o varios) ── */}
            <WoPlansPanel
              workOrderId={workOrder.id}
              vesselCode={workOrder.vesselCode}
              plans={workOrder.plans ?? []}
              canEdit={isEditable}
              // onReload (no onSaved): agregar o quitar un ítem refresca el
              // listado de fondo, pero NO cierra la ventana de la OT.
              onChanged={onReload}
            />

            {/* ── Área / responsable ── */}
            {/* En los tenants con el formulario REGI-MAN-02.3 esto vive arriba,
                en el bloque del formulario: el área son los recuadros del papel
                (Solicitado por / Asignado a / Sistema) y la ubicación va en su
                cabecera. Repetirlos acá confundía. El taller se elige junto a
                "Asignado a: Tercerizado". */}
            {!isMercurio && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={labelCls}>{t("wo.modal.department")}</label>
                  <div className="flex flex-wrap gap-2">
                    {(["CUBIERTA", "MAQUINAS", "BARCAZA", "PROVEEDOR", "OTROS"] as const).map(d => (
                      <button key={d} type="button" disabled={!isEditable}
                        onClick={() => { const next = department === d ? "" : d; setDepartment(next); if (next !== "PROVEEDOR") setProviderId(""); }}
                        className={`px-2 py-1 rounded text-xs font-bold border transition-colors ${
                          department === d
                            ? "bg-accent text-accent-fg border-accent"
                            : "bg-fg/5 text-text-industrial/60 border-fg/10 hover:border-accent/40"
                        }`}
                      >{t(`wo.dept.${d}`)}</button>
                    ))}
                  </div>
                  {department === "PROVEEDOR" && (
                    <select value={providerId} onChange={e => setProviderId(e.target.value)} disabled={!isEditable}
                      className={`${inputCls} mt-1`}>
                      <option value="">{t("wo.modal.providerSelect")}</option>
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name}{p.providerCode ? ` (${p.providerCode})` : ""}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}

            {/* Con el formulario controlado esto vive en la hoja de arriba. */}
            {!isMercurio && (
              <>
            <div className="space-y-1.5">
              <label
                onClick={isEditable ? handleTitleClick : undefined}
                title={isEditable ? t("wo.ai.titleTooltip") : undefined}
                className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${isEditable ? `hover:text-fg cursor-pointer ${loadingTitle ? "opacity-60 animate-pulse" : ""}` : ""}`}
              >
                {loadingTitle ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {t("wo.modal.titleField")}{loadingTitle && <span className="ml-1 text-[9px] normal-case font-normal">{t("common.analyzing")}</span>}
              </label>
              {/* Textarea, no input: cuando la OT cubre varios ítems del PDM el
                  título es una línea "CÓDIGO · tarea" por ítem. Con un solo ítem
                  se ve igual que antes (una fila). */}
              <AutoTextArea
                rows={Math.min(6, Math.max(1, title.split("\n").length))}
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={() => { void analyzeForDeficiency(title, "title"); }}
                disabled={!isEditable || loadingTitle}
                className={`${inputCls} resize-y`}
                placeholder={t("wo.modal.titlePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <label
                onClick={handleTaskClick}
                title={!isEditable ? undefined : !title.trim() ? t("wo.ai.completeTitleFirst") : t("wo.ai.taskTooltip")}
                className={`${sectionLabelCls} flex items-center gap-2 ${isEditable && title.trim() ? `cursor-pointer ${loadingTask ? "opacity-70 animate-pulse" : ""}` : ""}`}
                style={sectionLabelStyle}
              >
                {isEditable && (loadingTask ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />)}
                {t("wo.modal.task")}
                {loadingTask && <span className="text-[10px] normal-case font-normal">{t("common.analyzing")}</span>}
              </label>
              <AutoTextArea rows={autoRows(description, 3)} value={description} onChange={e => setDescription(e.target.value)} onBlur={() => { void analyzeForDeficiency(description, "task"); }} disabled={!isEditable || loadingTask} className={`${inputCls} resize-y`} />
            </div>
              </>
            )}

            {/* Criterios/LOTO/riesgo/consecuencia heredados del plan: siempre
                visibles y editables, vengan o no de un plan (antes quedaban
                colapsados por defecto en las OT que sí venían de un plan). */}
            <div className="space-y-4">
                {/* Con el formulario controlado esto vive en la hoja de arriba. */}
                {!isMercurio && (
                  <>
                <div className="space-y-1.5">
                  <label
                    onClick={isEditable ? handleAcceptanceCriteriaClick : undefined}
                    title={isEditable ? t("wo.ai.criteriaTooltip") : undefined}
                    className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${isEditable ? `hover:text-fg cursor-pointer ${loadingCriteria ? "opacity-60 animate-pulse" : ""}` : ""}`}
                  >
                    {loadingCriteria ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {t("wo.modal.acceptanceCriteria")}{loadingCriteria && <span className="ml-1 text-[9px] normal-case font-normal">{t("common.analyzing")}</span>}
                  </label>
                  <AutoTextArea rows={autoRows(acceptanceCriteria, 2)} value={acceptanceCriteria} onChange={e => setAcceptanceCriteria(e.target.value)} disabled={!isEditable || loadingCriteria} className={`${inputCls} resize-y`} placeholder={t("wo.modal.acceptancePlaceholder")} />
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
                  <AutoTextArea rows={autoRows(loto, 2)} value={loto} onChange={e => setLoto(e.target.value)} disabled={!isEditable || loadingLoto} className={`${inputCls} resize-y`} placeholder={t("wo.modal.lotoPlaceholder")} />
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
                  <AutoTextArea rows={autoRows(riskAnalysisResult, 2)} value={riskAnalysisResult} onChange={e => setRiskAnalysisResult(e.target.value)} disabled={!isEditable || loadingRisk} className={`${inputCls} resize-y`} placeholder={t("wo.modal.riskPlaceholder")} />
                </div>
                  </>
                )}

                {/* La consecuencia de la falla (RCM) se sacó de esta pantalla
                    (ago 2026, decisión de producto): el campo sigue en la base y
                    en el registro, pero no se completa desde la OT. Mismo criterio
                    que los módulos RCM / CAPA, que están construidos y ocultos.
                    No volver a montarlo sin pedido explícito. */}
              </div>
          </section>

          {/* ── 3. DOCUMENTO CHECKLIST ── */}
          <section className="space-y-3">
            <PhaseHeader n={isMercurio ? 2 : 3} label={t("wo.modal.checklistDoc")} dotCls="bg-teal-500/15 text-teal-700 dark:text-teal-400" borderCls="border-teal-500/25" />
            <div className="space-y-1.5 mt-3">
              {checklistDocUrl && !checklistDocFile && (
                <a href={checklistDocUrl} target="_blank" rel="noreferrer" className="block text-xs text-accent underline mb-1 truncate">{checklistDocUrl}</a>
              )}
              <input type="file" disabled={!isEditable} onChange={e => setChecklistDocFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-text-industrial/60 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-accent/10 file:text-accent hover:file:bg-accent/20 disabled:opacity-50 cursor-pointer" />
            </div>
          </section>

          {/* ── SOLICITUDES DE SERVICIO (SS) ── */}
          {/* Una SS es el pedido de un servicio externo (un taller). No se abre
              desde una OT cerrada o cancelada, por eso el botón depende del
              estado de la OT. Una OT diferida sí admite SS. */}
          <section className="space-y-3">
            <PhaseHeader
              n={isMercurio ? 3 : 5}
              label="Solicitudes de Servicio"
              dotCls="bg-cyan-500/15 text-cyan-700 dark:text-cyan-400"
              borderCls="border-cyan-500/25"
              action={canOpenServiceRequest ? (
                <button
                  type="button"
                  onClick={() => setNewSrOpen(true)}
                  disabled={creatingSr}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold uppercase tracking-wider hover:bg-accent/20 disabled:opacity-50"
                >
                  {creatingSr ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Nueva SS
                </button>
              ) : undefined}
            />

            {newSrOpen && (
              <NewServiceRequestModal
                busy={creatingSr}
                defaultValue={title || workOrder.title || ""}
                onClose={() => setNewSrOpen(false)}
                onConfirm={handleCreateServiceRequest}
              />
            )}

            {/* Recuadro propio (mismo trato que "Tarea concluida"): contratar un
                taller externo es una decisión de peso y no debe leerse como una
                nota al pie entre secciones. */}
            <div className="space-y-2 bg-cyan-500/5 border border-cyan-500/20 rounded-2xl p-4">

            {/* El porqué se muestra SIEMPRE que no se pueda abrir una SS, haya o
                no SS previas: sin esto, la ausencia del botón no se explica sola.
                Ya no se exige que la OT esté autorizada (la SS se carga junto
                con la OT y la tramitación la arrastra); el único motivo que
                queda es que la OT no esté abierta. */}
            {!canOpenServiceRequest && (
              <p className="text-[11px] text-text-industrial/50 italic">
                Una solicitud de servicio no puede abrirse desde una {woTerms.abbr} cerrada o cancelada.
              </p>
            )}

            {linkedServiceRequests.length === 0 && canOpenServiceRequest && (
              <p className="text-[11px] text-text-industrial/50 italic">
                Sin solicitudes de servicio. Creá una si este trabajo necesita un taller externo.
              </p>
            )}

            {linkedServiceRequests.length > 0 && (
              <div className="space-y-2">
                {linkedServiceRequests.map(sr => (
                  // Fila clickeable en vez de <Link>: hay que guardar la OT antes
                  // de salir, y un link navega sin darnos la oportunidad. Es un
                  // <div> y no un <button> porque adentro va otro botón (el
                  // código FA), y un botón dentro de otro es HTML inválido.
                  <div
                    key={sr.id}
                    onClick={() => { void saveThenNavigate(`/service-requests?openId=${sr.id}`); }}
                    title="Guarda la OT y abre esta solicitud de servicio"
                    className="cursor-pointer flex items-center gap-3 rounded-xl border border-fg/10 bg-fg/5 px-3 py-2 hover:border-accent/30 transition-all"
                  >
                    <span className="font-mono text-[11px] font-bold text-accent shrink-0">{sr.serviceRequestCode}</span>
                    {/* La DESCRIPCIÓN manda: `title` se copia de la OT al crear la
                        SS y queda congelado, así que muestra el texto viejo si
                        después se edita la SS o se renombra la OT. */}
                    <span className="flex-1 min-w-0 truncate text-xs text-text-industrial">{sr.description || sr.title || "—"}</span>
                    {/* A quién se le pidió: el nombre del taller, no un id. */}
                    {sr.providerName && (
                      <span className="shrink-0 max-w-[30%] truncate text-[11px] font-semibold text-fg" title={sr.providerName}>
                        {sr.providerName}
                      </span>
                    )}
                    {/* Código de la muestra, cuando esta OT generó una. Abre la
                        muestra; al cerrarla se vuelve a esta OT. Va dentro de la
                        fila clickeable, así que frena la navegación del padre. */}
                    {linkedSample && (
                      <button
                        type="button"
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          void saveThenNavigate(`/fluid-analyses?openId=${encodeURIComponent(linkedSample.id)}`);
                        }}
                        className="shrink-0 font-mono text-[10px] font-bold text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-2 py-0.5 hover:bg-cyan-500/20 transition-colors"
                        title="Guarda la OT y abre la muestra de análisis generada por ella"
                      >
                        {linkedSample.sampleCode}
                      </button>
                    )}
                    <span className={`shrink-0 px-2 py-0.5 rounded-lg border text-[10px] font-bold ${SS_STATUS_COLOR[sr.status] ?? SS_STATUS_COLOR.DRAFT}`}>
                      {SS_STATUS_LABEL[sr.status] ?? sr.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
            </div>
          </section>

          {/* ── LA HOJA: la OT tal como se imprime (REGI-MAN-02.3) ──
              Completar la OT es completar el formulario. Lo que la pantalla
              tiene y el papel no (asistentes de IA, adjuntos, avances, planes,
              permisos, diferimientos) queda debajo, en su propia zona. */}
          {isMercurio && (
            <WoPaperForm
              meta={paperDoc.meta}
              config={paperDoc.config}
              logoUrl={paperLogo}
              tenantName={tenant?.name ?? ""}
              editable={isEditable}
              resultEditable={isResultEditable}
              autosave={{ saving: regiSaving, saved: regiSaved, error: regiErr }}
              header={{
                vesselName: paperVesselName,
                workOrderCode: workOrder.workOrderCode,
                assetLabel: workOrder.assetName ?? workOrder.assetId ?? "",
                serviceRequestCodes: linkedServiceRequests.map(sr => sr.serviceRequestCode),
                openDate: fmtDate(workOrder.openDate),
                planItemCode: (workOrder.plans ?? []).map(pl => pl.taskCode).join(", "),
                statusLabel: WO_STATUS_PAPER_LABEL[workOrder.status] ?? workOrder.status,
                createdByName: workOrder.createdByName ?? "",
              }}
              values={{
                voyageNumber: regiForm.voyageNumber,
                operatingCondition: regiForm.operatingCondition,
                location,
                requestedByArea: regiForm.requestedByArea,
                assignedToArea: regiForm.assignedToArea,
                priority,
                maintenanceKind: regiForm.maintenanceKind,
                type,
                systemArea: regiForm.systemArea,
                description,
                title,
                acceptanceCriteria,
                taskCompleted: regiForm.taskCompleted,
                woResult,
                pendingDetail: regiForm.pendingDetail,
                riskLevel,
                riskAnalysisResult,
                loto,
              }}
              // Los recuadros del papel escriben sobre los mismos campos de
              // siempre: el bloque del formulario (regiForm, con su
              // auto-guardado) y los campos sueltos de la OT.
              onChange={patch => {
                touchRegi();
                const regi: Partial<WoRegiForm> = {};
                if (patch.voyageNumber !== undefined)    regi.voyageNumber = patch.voyageNumber;
                if (patch.operatingCondition !== undefined) regi.operatingCondition = patch.operatingCondition;
                if (patch.requestedByArea !== undefined) regi.requestedByArea = patch.requestedByArea;
                if (patch.assignedToArea !== undefined)  regi.assignedToArea = patch.assignedToArea;
                if (patch.systemArea !== undefined)      regi.systemArea = patch.systemArea;
                if (patch.maintenanceKind !== undefined) regi.maintenanceKind = patch.maintenanceKind;
                if (patch.pendingDetail !== undefined)   regi.pendingDetail = patch.pendingDetail;
                if (patch.taskCompleted !== undefined)   regi.taskCompleted = patch.taskCompleted;
                if (Object.keys(regi).length > 0) setRegiForm(prev => ({ ...prev, ...regi }));
                if (patch.location !== undefined)           setLocation(patch.location);
                if (patch.priority !== undefined)           setPriority(patch.priority);
                if (patch.type !== undefined)               setType(patch.type);
                if (patch.description !== undefined)        setDescription(patch.description);
                if (patch.title !== undefined)              setTitle(patch.title);
                if (patch.acceptanceCriteria !== undefined) setAcceptanceCriteria(patch.acceptanceCriteria);
                // Elegir "con deficiencias" dispara la propuesta de abrir un
                // defecto: por eso pasa por su handler y no por setWoResult.
                if (patch.woResult !== undefined)           handleWoResultChange(patch.woResult);
                if (patch.riskLevel !== undefined)          setRiskLevel(patch.riskLevel);
                if (patch.riskAnalysisResult !== undefined) setRiskAnalysisResult(patch.riskAnalysisResult);
                if (patch.loto !== undefined)               setLoto(patch.loto);
              }}
              /* FECHA del encabezado: la de apertura de la OT. Es el mismo dato
                 y el mismo estado que el campo de la sección de datos. */
              fecha={
                <input
                  type="date"
                  className={paperFieldCls}
                  value={openDate}
                  disabled={!((tramitaPhase === "SOLICITADA" || isAdmin) && isEditable)}
                  onChange={e => setOpenDate(e.target.value)}
                />
              }
              tecnico={
                <AssigneeSelect
                  value={assignedTo}
                  onChange={setAssignedTo}
                  disabled={!isEditable}
                  className="w-full bg-transparent text-[13px] text-fg outline-none"
                />
              }
              /* Sin selector propio: el taller se elige en la Solicitud de
                 Servicio y la hoja lo refleja. Si hay varias SS con talleres
                 distintos, van todos. */
              proveedor={needsProvider ? (
                ssProviderNames.length > 0 ? (
                  <span className="text-[13px] text-fg">{ssProviderNames.join(" · ")}</span>
                ) : (
                  <span className="text-[11px] italic text-text-industrial/40">
                    Se toma de las Solicitudes de Servicio de esta {woTerms.abbr}.
                  </span>
                )
              ) : undefined}
              /* Los permisos se crean, se sugieren y se abren desde acá mismo:
                 el recuadro del papel ES la sección de permisos (igual que
                 REPUESTOS con PlannedItemsEditor). Sólo se pueden cargar con la
                 OT aprobada, como antes. */
              permits={
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-text-industrial/50">
                      Permisos vinculados
                    </p>
                    {isApproved && isEditable && (
                      <button
                        type="button"
                        onClick={() => setPermitModalState({ kind: "create", prefill: makePermitPrefill() })}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold uppercase tracking-wider hover:bg-accent/20"
                      >
                        <Plus className="w-3 h-3" /> Nuevo permiso
                      </button>
                    )}
                  </div>

                  {/* Sugerencia por el contenido del trabajo (mismas keywords). */}
                  {isApproved && isEditable && advisoryMatches.length > 0 && linkedPermits.length === 0 && (
                    <div className="border border-yellow-500/30 bg-yellow-500/5 p-2 space-y-1.5">
                      <p className="flex items-start gap-1.5 text-[11px] font-semibold text-yellow-800 dark:text-yellow-200">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
                        <span>
                          Esta {woTerms.abbr} podría requerir permiso de trabajo:{" "}
                          {advisoryMatches.map(m => PERMIT_TYPE_LABEL[m.type]).join(", ")}.
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {advisoryMatches.map(m => (
                          <button
                            key={m.type}
                            type="button"
                            onClick={() => setPermitModalState({ kind: "create", prefill: makePermitPrefill(m.type) })}
                            className="px-2 py-0.5 border border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 text-[10px] font-bold hover:bg-yellow-500/20"
                          >
                            Crear {PERMIT_TYPE_LABEL[m.type]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {linkedPermits.length === 0 ? (
                    <p className="text-[11px] italic text-text-industrial/40">
                      {isApproved ? "Sin permisos vinculados." : "Se cargan con la OT ya aprobada."}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {linkedPermits.map(pm => (
                        <button
                          key={pm.id}
                          type="button"
                          onClick={() => setPermitModalState({ kind: "edit", permit: pm })}
                          className="w-full flex items-center gap-2 px-2 py-1 border border-fg/25 hover:border-accent/40 text-left transition-colors"
                        >
                          <ShieldAlert className="w-3.5 h-3.5 text-accent/70 shrink-0" />
                          <span className="shrink-0 font-mono text-[10px] text-text-industrial/60">{pm.permitCode}</span>
                          <span className={`shrink-0 px-1.5 py-0.5 rounded-full border text-[9px] font-bold ${PTW_STATUS_COLOR[pm.status]}`}>
                            {PTW_STATUS_LABEL[pm.status]}
                          </span>
                          <span className="shrink-0 text-[10px] text-text-industrial/70">
                            {PERMIT_TYPE_LABEL[pm.type as PermitType] ?? pm.type}
                          </span>
                          <span className="flex-1 min-w-0 truncate text-[11px] text-fg/80">{pm.description}</span>
                          <ExternalLink className="w-3 h-3 text-text-industrial/40 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              }
              /* REPUESTOS y MATERIALES: en la hoja sólo va el aviso. El ancho del
                 papel corta el código del repuesto y no deja ni leer ni cargar el
                 listado, así que la carga real vive en la sección 3, debajo de la
                 hoja y a todo el ancho del modal. */
              spares={
                <p className="text-[11px] italic text-text-industrial/50">
                  Los repuestos se registran más abajo, en la sección 3 “Repuestos y materiales”.
                </p>
              }
              materials={
                <p className="text-[11px] italic text-text-industrial/50">
                  Los materiales se registran más abajo, en la sección 3 “Repuestos y materiales”.
                </p>
              }
              schedule={
                <div className="space-y-2 p-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wide text-text-industrial/50 mb-0.5">
                        {t("wo.modal.startDate")}
                      </label>
                      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                        disabled={!isEditable} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wide text-text-industrial/50 mb-0.5">
                        {t("wo.modal.endDate")}
                      </label>
                      <input type="date" value={executionDate} onChange={e => setExecutionDate(e.target.value)}
                        disabled={!isEditable} className={inputCls} />
                    </div>
                  </div>
                  <WoScheduleEditor
                    workOrderId={workOrder.id}
                    canEdit={isResultEditable}
                    defaultPlace={location || null}
                    defaultCompany={workOrder.providerName ?? providerOther ?? null}
                  />
                </div>
              }
              riskMatrix={
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-wide text-text-industrial/50">Nivel</span>
                  <div className="flex gap-1.5">
                    {([
                      ["LOW",      "L", "bg-success-sea text-[#0B132B] border-success-sea",       "text-success-sea border-success-sea/40"],
                      ["MEDIUM",   "M", "bg-yellow-400 text-[#0B132B] border-yellow-400",         "text-yellow-700 dark:text-yellow-400 border-yellow-400/40"],
                      ["HIGH",     "H", "bg-red-500 text-fg border-red-500",                      "text-red-700 dark:text-red-400 border-red-400/40"],
                      ["CRITICAL", "C", "bg-red-700 text-fg border-red-700",                      "text-red-600 border-red-600/40"],
                    ] as [string, string, string, string][]).map(([val, lab, activeCls, inactiveLabelCls]) => (
                      <button key={val} type="button" disabled={!isEditable || loadingRisk}
                        onClick={() => setRiskLevel(riskLevel === val ? "" : val)}
                        className={`w-8 h-8 rounded border font-bold text-xs transition-all disabled:opacity-50 ${riskLevel === val ? activeCls : `bg-fg/5 ${inactiveLabelCls} hover:bg-fg/10`}`}>
                        {lab}
                      </button>
                    ))}
                  </div>
                  {/* Sugerir el nivel y el análisis con IA — la única herramienta
                      de la app dentro de este recuadro. */}
                  {isEditable && (
                    <button type="button" onClick={() => { void handleRiskClick(); }} disabled={loadingRisk}
                      title={t("wo.ai.riskTooltip")}
                      className="ml-auto flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-accent hover:text-fg disabled:opacity-40">
                      {loadingRisk ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      Sugerir
                    </button>
                  )}
                </div>
              }
              signatures={{
                solicitante: { name: workOrder.enviadoAprobacionByName ?? workOrder.createdByName ?? null },
                asignado: { name: workOrder.assignedToUserName ?? null },
              }}
            />
          )}

          {/* ── 1. INFORMACIÓN ──
              Con el formulario controlado la sección entera se saca (pedido del
              usuario, 2026-08-29): estado, criticidad y fecha de apertura ya son
              recuadros de la hoja. Sólo queda, si corresponde, el aviso de
              diferimiento, que no tiene lugar en el papel. */}
          <section>
            {!isMercurio && (
              <PhaseHeader n={1} label={t("wo.modal.section.info")} dotCls="bg-fg/10 text-fg/60" borderCls="border-fg/10" />
            )}
            <div className="mt-3">
            {!isMercurio && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                [t("wo.modal.vessel"),     workOrder.vesselCode,            "font-mono text-accent"],
                [t("wo.modal.equipment"),  workOrder.assetName ?? workOrder.assetId, "text-fg"],
                [t("wo.modal.type"),       null, null,
                  isEditable
                    ? <select key="ty" value={type} onChange={e => { void saveType(e.target.value); }} disabled={savingType}
                        className="mt-0.5 w-full bg-transparent text-xs text-fg border border-fg/10 rounded-md px-1.5 py-1 focus:outline-none focus:border-accent/50 disabled:opacity-60">
                        <option value="PREVENTIVE">{t("wo.type.preventive")}</option>
                        <option value="CORRECTIVE">{t("wo.type.corrective")}</option>
                        <option value="INSPECTION">{t("wo.type.inspection")}</option>
                      </select>
                    : <CategoryBadge key="cat" type={type} />],
                [t("wo.col.status"),       null, null, <WoStatusBadge key="st" status={workOrder.status} dueDate={workOrder.dueDate} deferralStatus={deferralStatus} toNextDrydock={deferralToDrydock} />],
                // Lee del estado (no de workOrder) para reflejar en el acto el
                // cambio hecho en el recuadro PRIORIDAD del formulario.
                [t("wo.modal.priority"),   priority,                        "text-fg"],
                [t("wo.modal.criticality"),workOrder.criticality,           "text-fg"],
                [t("wo.modal.openDate"),   fmtDate(workOrder.openDate),     "text-fg",
                  (tramitaPhase === "SOLICITADA" || isAdmin) && isEditable
                    ? <input key="od" type="date" value={openDate} onChange={e => setOpenDate(e.target.value)}
                        className="mt-0.5 w-full bg-transparent text-xs text-fg border border-fg/10 rounded-md px-1.5 py-1 focus:outline-none focus:border-accent/50" />
                    : undefined],
                // El VENCIMIENTO ya no está acá: vive al lado del badge de estado,
                // en el encabezado, que es donde se lo busca y donde se ve
                // siempre (esta grilla está oculta con formulario controlado).
              ] as [string, string | null, string | null, React.ReactNode?][]).map(([label, value, cls, node], i) => (
                <div key={i} className="bg-fg/5 border border-fg/10 rounded-xl p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{label}</p>
                  {node ?? <p className={`text-xs mt-0.5 ${cls ?? ""}`}>{value || "—"}</p>}
                </div>
              ))}
            </div>
            )}
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
                      <p className="text-[10px] text-red-700 dark:text-red-300/80">El diferimiento fue rechazado. Reanude la {woTerms.abbr} o solicite uno nuevo.</p>
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
            {/* Con el formulario controlado el responsable es el recuadro
                TECNICO de la hoja. */}
            {!isMercurio && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="space-y-1.5">
                  <label className={labelCls}>{t("wo.modal.assignee")}</label>
                  <AssigneeSelect value={assignedTo} onChange={setAssignedTo} disabled={!isEditable} className={inputCls} />
                </div>
              </div>
            )}
            </div>{/* end mt-3 */}
          </section>

          {/* ── 4. PERMISOS DE TRABAJO — oculta (no sólo deshabilitada) hasta
              que la OT esté aprobada, igual que 6-10.
              Con el formulario controlado esto vive en el recuadro
              AUTORIZACION DE TRABAJO de la hoja, así que acá no se repite. */}
          {!isMercurio && isApproved && (
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
                  <p className="text-xs text-yellow-800 dark:text-yellow-200 font-semibold mb-1">Esta {woTerms.abbr} podría requerir permiso de trabajo</p>
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
          )}

          {/* ── 3. REPUESTOS Y MATERIALES ──
              Sale de la hoja (donde el recuadro quedaba ilegible) y se carga
              acá, a todo el ancho. Mismos permisos de siempre: se editan con la
              OT abierta, sin esperar la aprobación. */}
          {isMercurio && (
          <section className="space-y-3">
            <PhaseHeader n={3} label="Repuestos y materiales" dotCls="bg-amber-500/15 text-amber-700 dark:text-amber-400" borderCls="border-amber-500/25" />
            <div className="bg-fg/[0.03] border border-fg/10 rounded-2xl p-4">
              <PlannedItemsEditor
                items={plannedItems}
                onChange={v => { touchRegi(); setPlannedItems(v); }}
                spares={woSpares}
                disabled={!isEditable}
              />
            </div>
          </section>
          )}

          {/* ── Secciones 6-10 (Avances/Programación/Repuestos/Tarea concluida/
              Resultado): ocultas del todo hasta que la OT esté aprobada, no
              sólo deshabilitadas. */}
          {isApproved && (
          <div className="space-y-6">

          {/* ── AVANCES ──
              Registro del trabajo mientras se ejecuta: texto, fotos, videos,
              audio y documentos. Estuvo oculta entre el 2026-08-29 y el
              2026-09-02 por pedido del usuario ("quizás luego la recuperemos");
              se recuperó tal cual estaba. */}
          {(workOrder.status === "PLANNED" || workOrder.status === "IN_PROGRESS" || workOrder.status === "ON_HOLD" || workOrder.status === "CLOSED") && (
            <section className="space-y-3">
              <PhaseHeader n={isMercurio ? 4 : 6} label="Avances" dotCls="bg-violet-500/15 text-violet-700 dark:text-violet-400" borderCls="border-violet-500/25" />
              <ProgressNotesPanel
                workOrderId={workOrder.id}
                canAdd={isResultEditable}
                canDelete={isEditable || isAdmin}
                canEdit={isResultEditable}
                onAdd={() => setShowProgressSheet(true)}
                reloadKey={notesReloadKey}
                onChanged={refreshAfterAvance}
              />
            </section>
          )}

          {/* Programación de trabajo, repuestos/materiales y tarea concluida son
              recuadros de la hoja de arriba (ver WoPaperForm). */}

          {/* ── RESULTADO (10 con el formulario de Mercurio, que suma
                 "Programación de trabajo", "Repuestos y materiales" y
                 "Tarea concluida") ── */}
          <section className="space-y-4">
            <PhaseHeader n={isMercurio ? 5 : 7} label={t("wo.modal.resultSection")} dotCls="bg-blue-500/20 text-blue-700 dark:text-blue-400" borderCls="border-blue-500/30" />
            <div className="space-y-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">

            {/* Con el formulario controlado, RESULTADO se marca en la hoja. */}
            {!isMercurio && (
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
            )}

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
                <AutoTextArea rows={3} value={deficienciasText} onChange={e => setDeficienciasText(e.target.value)} disabled={!isEditable || loadingRewrite} className={`${inputCls} resize-none border-orange-500/30 focus:border-orange-400/60`} placeholder={t("wo.modal.deficienciesPlaceholder")} />
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
              <AutoTextArea rows={3} value={observations} onChange={e => setObservations(e.target.value)} disabled={!isEditable} className={`${inputCls} resize-none`} placeholder={t("wo.modal.observationsPlaceholder")} />
            </div>
            {isCorrective && !isClosed && (
              <div className="space-y-1.5">
                <label className={labelCls}>{t("wo.modal.defectDetail")}</label>
                <AutoTextArea rows={2} value={defectDetail} onChange={e => setDefectDetail(e.target.value)} disabled={!isEditable}
                  className={`${inputCls} resize-none`} placeholder={t("wo.modal.defectDetailPlaceholder")} />
                <p className="text-[10px] text-text-industrial/40">{t("wo.modal.defectDetailHint")}</p>
              </div>
            )}
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
                        <td className="py-1.5 text-right">
                          {isEditable ? (
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={u.qty}
                              onChange={e => updateUsageQty(i, e.target.value)}
                              className={`w-24 bg-fg/5 border rounded-lg px-2 py-1.5 text-sm font-semibold text-right focus:outline-none focus:border-accent/50 ${u.qty > u.available ? "border-orange-500/40 text-orange-700 dark:text-orange-300" : "border-fg/15 text-fg"}`}
                            />
                          ) : (
                            <span className="text-fg/70">{u.qty}</span>
                          )}
                        </td>
                        <td className="py-1.5 pl-2 text-fg/40 align-middle">{u.unit}</td>
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

            {/* ── Prompt abrir DEF ──
                Se muestra también cuando la OT YA tiene defectos vinculados
                aunque el prompt esté "idle": es el caso de volver del defecto o
                reabrir la OT más tarde. */}
            {woResult === "WITH_DEFICIENCIES" && (defectPrompt !== "idle" || linkedDefects.length > 0) && (
              <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-4 py-3 space-y-2.5">
                {/* La pregunta sólo tiene sentido mientras no haya ninguno. */}
                {linkedDefects.length === 0 && (
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-orange-700 dark:text-orange-400 shrink-0" />
                    <p className="text-xs font-semibold text-orange-700 dark:text-orange-300">{t("wo.defectPrompt.question")}</p>
                  </div>
                )}
                {defectPrompt === "ask" && linkedDefects.length === 0 && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { void createDefectInline(); }}
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
                {/* Los códigos salen de la BASE (linkedDefects), no del estado de
                    la ventana: al volver del defecto el modal se rearma de cero y
                    antes el recuadro aparecía vacío, como si nunca se hubiera
                    creado nada. Así siguen visibles siempre, incluso días después. */}
                {linkedDefects.length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-success-sea font-semibold flex-wrap">
                    <CheckCheck className="w-3.5 h-3.5 shrink-0" />
                    {t("wo.defectPrompt.created")}:
                    {linkedDefects.map(d => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => { void saveThenNavigate(`/defects?defectId=${d.id}`); }}
                        className="inline-flex items-center gap-1 font-mono text-accent hover:underline"
                        title="Guarda la OT y abre este registro de defecto"
                      >
                        {d.defectCode}
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    ))}
                  </div>
                )}
                {defectPrompt === "declined" && linkedDefects.length === 0 && (
                  <p className="text-xs text-text-industrial/40">{t("wo.defectPrompt.declined")}</p>
                )}
              </div>
            )}
            </div>{/* end bg-blue box */}
          </section>
          </div>
          )}

          {closingWarning && (
            <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-4 py-3 space-y-2">
              <p className="text-xs text-orange-700 dark:text-orange-300">{closingWarning}</p>
              <button onClick={() => { void finishClose(); }} className="px-4 py-1.5 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-700 dark:text-orange-300 font-bold text-xs hover:bg-orange-500/30 transition-all">
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
            {workOrder.status === "ON_HOLD" && (
              <button onClick={() => { void handleResume(); }} disabled={resuming}
                className="px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-bold text-xs hover:bg-emerald-500/20 disabled:opacity-50 transition-all flex items-center gap-1.5">
                {resuming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                {t("wo.resume")}
              </button>
            )}
            <button
              onClick={() => {
                setCloseOnBehalfUserId(user?.id ?? "");
                setCloseDate(executionDate || new Date().toISOString().slice(0, 10));
                setShowCloseDialog(true);
              }}
              disabled={!canClose || closing}
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
                className={`px-4 py-2 rounded-xl font-bold text-xs disabled:opacity-50 flex items-center gap-1.5 ${justSaved ? "bg-green-600 text-white" : "bg-accent text-accent-fg hover:brightness-110"}`}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : justSaved ? <><CheckCheck className="w-4 h-4" />{t("mp.modal.saved")}</> : t("common.save")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Diálogo de cierre (ADMIN): quién cierra (firma CIERRA) + fecha de cierre */}
    {showCloseDialog && (
      <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-sm bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
          <div>
            <h2 className="text-base font-bold text-fg">Cerrar {woTerms.abbr}</h2>
            <p className="text-xs text-text-industrial/60 mt-0.5">{workOrder.workOrderCode}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-industrial/60">Quién cierra</label>
            {isAdmin ? (
              <select
                value={closeOnBehalfUserId}
                onChange={e => setCloseOnBehalfUserId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-fg/5 border border-fg/10 text-fg text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
              >
                {closeTeamUsers.length === 0 && <option value={user?.id ?? ""}>{user?.name ?? "—"}</option>}
                {closeTeamUsers.map(u => (
                  <option key={u.userId} value={u.userId}>
                    {(closeMemberName(u) || u.userId)}{!u.hasSignature ? "  ·  (sin firma)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                autoFocus
                value={executedByName}
                onChange={e => setExecutedByName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { setShowCloseDialog(false); setCloseAuditOpts({ completedDate: closeDate || undefined, closedByUserId: closeOnBehalfUserId || undefined }); } }}
                className="w-full px-3 py-2 rounded-lg bg-fg/5 border border-fg/10 text-fg text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
                placeholder="Nombre y apellido"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-industrial/60">Fecha de cierre</label>
            <input
              type="date"
              value={closeDate}
              onChange={e => setCloseDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-fg/5 border border-fg/10 text-fg text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCloseDialog(false)} disabled={closing} className="px-3 py-1.5 rounded-lg text-sm text-text-industrial/70 hover:bg-fg/5 disabled:opacity-50">Cancelar</button>
            <button
              onClick={() => { setShowCloseDialog(false); setCloseAuditOpts({ completedDate: closeDate || undefined, closedByUserId: closeOnBehalfUserId || undefined }); }}
              disabled={closing}
              className="px-4 py-1.5 rounded-lg text-sm font-bold bg-success-sea text-white hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
              {closing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Cerrar {woTerms.abbr}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Auditoría de IA antes de cerrar. Se abre después del diálogo de cierre
        (ya sabemos quién cierra y con qué fecha) y antes del cierre real: su
        informe puede terminar pegado en Observaciones, que viaja en el cierre.
        No frena nada: desde acá se cierra con el informe, sin él, o se vuelve
        a la OT a corregir. */}
    {closeAuditOpts && (
      <WoCloseAuditModal
        workOrderId={workOrder.id}
        workOrderCode={workOrder.workOrderCode}
        draft={{
          woResult,
          executedByName,
          completedDate: closeAuditOpts.completedDate || executionDate || null,
          runningHoursAtExecution: runningHoursAtExecution ? Number(runningHoursAtExecution) : null,
          actualHours: actualHours ? Number(actualHours) : null,
          observations,
          deficiencias: deficienciasText,
          pendingDetail: regiForm.pendingDetail,
          taskCompleted: regiForm.taskCompleted,
          spareUsages: spareUsages.map(u => ({ name: u.spareName ?? null, qty: u.qty, unit: u.unit })),
        }}
        onCancel={() => setCloseAuditOpts(null)}
        onConfirmClose={append => {
          const opts = closeAuditOpts;
          setCloseAuditOpts(null);
          const merged = append?.trim()
            ? [observations.trim(), append.trim()].filter(Boolean).join("\n\n")
            : undefined;
          if (merged) setObservations(merged);
          void onClose_WO({ ...opts, observationsOverride: merged });
        }}
      />
    )}

    {/* Modal registrar avance */}
    {showProgressSheet && (
      <ProgressNoteSheet
        workOrderId={workOrder.id}
        onClose={() => setShowProgressSheet(false)}
        onSaved={(noteText) => { setNotesReloadKey(k => k + 1); refreshAfterAvance(); if (noteText) void analyzeForDeficiency(noteText, "avance"); }}
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
// Los identificadores internos se conservan (SOLICITADA/APROBADA/AUTORIZADA)
// aunque las etiquetas visibles ahora digan "Pendiente de aprobación" /
// "Pendiente de autorización" / "Autorizada y en proceso": renombrarlos
// obligaría a tocar el arrastre, los filtros, el móvil y los badges sin ganar
// nada. El texto sale de i18n (wo.kanban.*).
type WoStage = "EN_PREPARACION" | "SOLICITADA" | "APROBADA" | "AUTORIZADA" | "DIFERIDA" | "HIDDEN";
function woStage(wo: WorkOrder): WoStage {
  if (wo.status === "CLOSED" || wo.status === "CANCELLED") return "HIDDEN"; // no van al tablero
  if (wo.status === "ON_HOLD") return "DIFERIDA";
  if (wo.autorizadoAt) return "AUTORIZADA";
  if (wo.aprobadoAt) return "APROBADA";
  // Sin enviar a aprobar todavía: la está completando quien la abrió.
  if (!wo.enviadoAprobacionAt) return "EN_PREPARACION";
  return "SOLICITADA";
}

const KANBAN_COLS: Array<{ colId: WoStage; labelKey: TranslationKey; headerCls: string; borderCls: string; droppable: boolean }> = [
  { colId: "EN_PREPARACION", labelKey: "wo.kanban.enPreparacion", headerCls: "text-text-industrial/60",              borderCls: "border-t-2 border-fg/20",         droppable: true  },
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

// Etapa de tramitación (Solicitada / Aprobada / Autorizada / Diferida) para el listado.
// Reutiliza woStage(); las OT cerradas/canceladas (HIDDEN) no muestran etapa.
function WoStageBadge({ wo }: { wo: WorkOrder }) {
  const t = useT();
  const stage = woStage(wo);
  if (stage === "HIDDEN") return <span className="text-xs text-text-industrial/30">—</span>;
  const map: Record<Exclude<WoStage, "HIDDEN">, { label: string; cls: string }> = {
    EN_PREPARACION: { label: t("wo.kanban.enPreparacion"), cls: "bg-fg/5 text-text-industrial/60 border-fg/15" },
    SOLICITADA: { label: t("wo.kanban.solicitada"), cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30" },
    APROBADA:   { label: t("wo.kanban.aprobada"),   cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30" },
    AUTORIZADA: { label: t("wo.kanban.autorizada"), cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
    DIFERIDA:   { label: t("wo.kanban.onHold"),     cls: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30" },
  };
  const meta = map[stage];
  return <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold whitespace-nowrap ${meta.cls}`}>{meta.label}</span>;
}

/** SS mostrada dentro de la tarjeta de la OT (sólo lo que entra en una línea). */
interface SrLite { id: string; serviceRequestCode: string; status: string; workOrderId: string }

/**
 * Las SS de la OT, en la tarjeta del kanban. Una línea por SS: código + punto de
 * color. El punto es el que dice de un vistazo si ya está autorizada (violeta en
 * adelante) o si todavía está esperando firma.
 */
function SrChips({ items }: { items: SrLite[] }) {
  if (items.length === 0) return null;
  return (
    <div className="pt-1.5 mt-0.5 border-t border-fg/10 space-y-1">
      {items.map(sr => (
        <div key={sr.id} className="flex items-center gap-1.5" title={`${sr.serviceRequestCode} · ${SS_STATUS_LABEL[sr.status] ?? sr.status}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SS_DOT_CLS[sr.status] ?? "bg-fg/20"}`} />
          <span className="font-mono text-[9px] text-text-industrial/60 truncate">{sr.serviceRequestCode}</span>
        </div>
      ))}
    </div>
  );
}

function KanbanCardContent({ wo, deferralMap, srs }: {
  wo: WorkOrder;
  deferralMap: Map<string, { id: string; deferralCode: string; status: string; toNextDrydock?: boolean }>;
  srs: SrLite[];
}) {
  const now = new Date();
  const isOverdue = !!wo.dueDate && wo.status !== "CLOSED" && wo.status !== "CANCELLED" && parseLocalDate(wo.dueDate) < now;
  const deferral  = deferralMap.get(wo.id);
  // Tarjeta compacta: lo que interesa acá es el N° de OT y el Título. El equipo
  // se muestra en el header del grupo; quién aprobó/autorizó no va en esta vista.
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono font-bold text-fg text-[10px]">{wo.workOrderCode}</span>
        <CategoryBadge type={wo.type} />
      </div>
      {wo.title && <p className="text-xs text-fg font-medium line-clamp-2">{wo.title}</p>}
      {(wo.dueDate || deferral) && (
        <div className="flex items-center justify-between gap-2">
          {wo.dueDate ? (
            <span className={`text-[10px] font-medium ${isOverdue ? "text-red-700 dark:text-red-400" : "text-text-industrial/50"}`}>
              {isOverdue ? "⚠ " : ""}{fmtDate(wo.dueDate)}
            </span>
          ) : <span />}
          {deferral && <DeferralStatusBadge status={deferral.status} />}
        </div>
      )}
      <SrChips items={srs} />
    </>
  );
}

function KanbanCard({ wo, deferralMap, srs, isLoading, draggingId, onOpen, onDragStart }: {
  wo: WorkOrder;
  deferralMap: Map<string, { id: string; deferralCode: string; status: string; toNextDrydock?: boolean }>;
  srs: SrLite[];
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
      <KanbanCardContent wo={wo} deferralMap={deferralMap} srs={srs} />
    </div>
  );
}

// Agrupa las OT de una columna por equipo (asset). Clave por assetId (único por
// buque) para no fusionar equipos homónimos de distintos buques; label = nombre.
function groupWosByAsset(items: WorkOrder[]): { key: string; label: string; items: WorkOrder[] }[] {
  const map = new Map<string, { label: string; items: WorkOrder[] }>();
  for (const w of items) {
    const key = w.assetId ?? w.assetName ?? "—";
    const label = w.assetName ?? w.assetId ?? "—";
    const g = map.get(key);
    if (g) g.items.push(w); else map.set(key, { label, items: [w] });
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, label: g.label, items: g.items }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function KanbanBoard({ items, deferralMap, srMap, loadingId, loading, onOpen, onReload }: {
  items: WorkOrder[];
  deferralMap: Map<string, { id: string; deferralCode: string; status: string; toNextDrydock?: boolean }>;
  srMap: Map<string, SrLite[]>;
  loadingId: string | null;
  loading: boolean;
  onOpen: (wo: WorkOrder) => void;
  onReload: () => void;
}) {
  const t = useT();
  const [draggingWo, setDraggingWo]   = useState<WorkOrder | null>(null);
  const [overCol, setOverCol]         = useState<string | null>(null);
  const [pendingHold, setPendingHold] = useState<WorkOrder | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ wo: WorkOrder; step: "ENVIA" | "APRUEBA" | "AUTORIZA" } | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const { user } = useAuth();
  const canAuthorize = CAN_AUTHORIZE_ROLES.includes(user?.role ?? "");
  // Grupos por equipo expandidos (clave `${colId}::${assetKey}`). Default: cerrados.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((k: string) => {
    setExpandedGroups(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }, []);
  // ref para evitar stale closure en handleDrop (React 18 batching)
  const draggingWoRef = React.useRef<WorkOrder | null>(null);

  const handleDrop = useCallback((e: React.DragEvent, targetCol: WoStage) => {
    setOverCol(null);
    setDraggingWo(null);
    setDropError(null);
    draggingWoRef.current = null;

    let payload: { id: string; stage: WoStage } | null = null;
    try { payload = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { /* noop */ }
    if (!payload?.id || !payload?.stage) return;

    const { id, stage } = payload;
    if (stage === targetCol) return;
    const wo = items.find(w => w.id === id);
    if (!wo) return;

    // Enviar a aprobar (En preparación → Pendiente de aprobación): pide nombre.
    if (stage === "EN_PREPARACION" && targetCol === "SOLICITADA") { setPendingApproval({ wo, step: "ENVIA" }); return; }
    // Aprobar (Pendiente de aprobación → Pendiente de autorización): pide nombre.
    if (stage === "SOLICITADA" && targetCol === "APROBADA") { setPendingApproval({ wo, step: "APRUEBA" }); return; }
    // Autorizar (Aprobada → Autorizada): pide nombre. No se puede saltar desde
    // Solicitada. Es de tierra: se avisa acá en vez de dejar que el backend
    // devuelva un 403 sin explicación.
    if (stage === "APROBADA" && targetCol === "AUTORIZADA") {
      if (!canAuthorize) { setDropError("Autorizar es atribución de tierra: Superintendente técnico o DPA / Director de Operaciones."); return; }
      setPendingApproval({ wo, step: "AUTORIZA" });
      return;
    }
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
  }, [items, onReload, canAuthorize]);

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;

  return (
    <>
      {dropError && (
        <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
          {dropError}
        </p>
      )}
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
                {groupWosByAsset(colItems).map(group => {
                  const gkey = `${col.colId}::${group.key}`;
                  const collapsed = !expandedGroups.has(gkey);
                  return (
                    <div key={gkey} className="rounded-lg border border-fg/10 bg-fg/[0.02]">
                      <button
                        type="button"
                        onClick={() => toggleGroup(gkey)}
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left rounded-lg hover:bg-fg/[0.05] transition-colors"
                        title={group.label}
                      >
                        <ChevronDown className={`w-3.5 h-3.5 text-text-industrial/40 shrink-0 transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`} />
                        <Wrench className="w-3 h-3 text-accent/70 shrink-0" />
                        <span className="text-[11px] font-bold text-fg truncate flex-1">{group.label}</span>
                        <span className="text-[10px] font-bold text-text-industrial/50 bg-fg/10 rounded-full px-1.5 py-0.5 shrink-0">{group.items.length}</span>
                      </button>
                      {!collapsed && (
                        <div className="flex flex-col gap-2 p-2 pt-0">
                          {group.items.map(wo => (
                            <KanbanCard
                              key={wo.id}
                              wo={wo}
                              deferralMap={deferralMap}
                              srs={srMap.get(wo.id) ?? []}
                              isLoading={loadingId === wo.id}
                              draggingId={draggingWo?.id ?? null}
                              onOpen={onOpen}
                              onDragStart={w => { draggingWoRef.current = w; setDraggingWo(w); }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
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

// ── ApprovalModal: captura el nombre del firmante al enviar/aprobar/autorizar ─
function ApprovalModal({ workOrder, step, onClose, onSuccess }: {
  workOrder: WorkOrder;
  step: "ENVIA" | "APRUEBA" | "AUTORIZA" | "RECHAZA";
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { user } = useAuth();
  const t = useT();
  const woTerms = useWoTerms();
  const isReject = step === "RECHAZA";
  const [name, setName] = useState(user?.name ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Códigos de Análisis de Fluidos que se auto-generaron al autorizar (si la
  // OT cubre un ítem del plan de toma de muestra). Se avisa antes de cerrar
  // esta ventana: si no, el registro nuevo queda invisible hasta que alguien
  // entre a Análisis de Fluidos a buscarlo por su cuenta.
  const [createdSampleCodes, setCreatedSampleCodes] = useState<string[] | null>(null);

  // Solo TENANT_ADMIN puede aprobar/autorizar en nombre de otro usuario (no en RECHAZA):
  // se elige de una lista y la firma del PDF se toma de ESE usuario.
  const isAdmin = user?.role === "TENANT_ADMIN";
  const adminPicker = isAdmin && !isReject;
  const [onBehalfUserId, setOnBehalfUserId] = useState(user?.id ?? "");
  const [teamUsers, setTeamUsers] = useState<{ userId: string; firstName: string | null; lastName: string | null; formName: string | null; hasSignature: boolean; role: string; assignedVesselCodes: string[] }[]>([]);
  const memberName = (u: { firstName: string | null; lastName: string | null; formName: string | null }) =>
    (u.formName || [u.firstName, u.lastName].filter(Boolean).join(" ") || "").trim();
  // Quién puede firmar depende del PASO: enviar a aprobar lo hace cualquiera
  // embarcado (no es firma de autoridad, salvo el auditor de sólo lectura);
  // aprobar admite al JEFE DE MÁQUINAS (es a bordo); autorizar es sólo tierra
  // (admin / superintendente). Mismo criterio que la SS. El backend valida
  // igual; esto es para no ofrecer un 403.
  const eligibleApprovers = teamUsers.filter(u => {
    if (u.role === "TENANT_ADMIN") return true;
    const enElBuque = (u.assignedVesselCodes ?? []).includes(workOrder.vesselCode);
    if (step === "ENVIA") return enElBuque && u.role !== "AUDITOR_READONLY";
    if (u.role === "FLEET_SUPERINTENDENT") return enElBuque;
    if (u.role === "MAINTENANCE_MANAGER") return step === "APRUEBA" && enElBuque;
    return false;
  });
  // Admin: fecha de la acción (aprobación/autorización). Default hoy.
  const today = new Date().toISOString().slice(0, 10);
  const [actionDate, setActionDate] = useState(today);

  useEffect(() => {
    if (!adminPicker) return;
    api.get<typeof teamUsers>("/app/team/members")
      .then(rows => setTeamUsers(Array.isArray(rows) ? rows : []))
      .catch(() => setTeamUsers([]));
  }, [adminPicker]);
  const title = step === "ENVIA" ? `Enviar ${woTerms.abbr} a aprobar`
    : step === "APRUEBA" ? `Aprobar ${woTerms.abbr}`
    : step === "AUTORIZA" ? `Autorizar ${woTerms.abbr}`
    : `Rechazar ${woTerms.abbr}`;
  const verb  = step === "ENVIA" ? "envía" : step === "APRUEBA" ? "aprueba" : step === "AUTORIZA" ? "autoriza" : "rechaza";

  // ESC cierra esta ventana (captura + stopImmediatePropagation para no disparar
  // el guard global que cerraría el modal de la OT por detrás).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); onClose(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Ingresá el nombre."); return; }
    const trimmedReason = reason.trim();
    if (isReject && !trimmedReason) { setError("Ingresá el motivo del rechazo."); return; }
    setSaving(true); setError(null);
    try {
      const res = await api.post<{ createdFluidSamples?: { sampleCode: string }[] }>(
        `/app/pms/work-orders/${workOrder.id}/approval`,
        {
          step, name: trimmed, reason: isReject ? trimmedReason : undefined,
          onBehalfUserId: adminPicker && onBehalfUserId ? onBehalfUserId : undefined,
          actionDate: adminPicker && actionDate ? actionDate : undefined,
        },
      );
      const codes = (res.createdFluidSamples ?? []).map(s => s.sampleCode);
      if (codes.length > 0) {
        // Avisa antes de cerrar: onSuccess() se dispara recién cuando el
        // usuario reconoce el aviso (ver AlertDialog más abajo).
        setSaving(false);
        setCreatedSampleCodes(codes);
        return;
      }
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-bold text-fg">{title}</h2>
          <p className="text-xs text-text-industrial/60 mt-0.5">
            {workOrder.workOrderCode} · {workOrder.assetName ?? workOrder.title ?? ""}
          </p>
          {isReject && (
            <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">La {woTerms.abbr} vuelve a Solicitada y queda marcada como rechazada.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-text-industrial/60">Nombre de quien {verb}</label>
          {adminPicker ? (
            <select
              autoFocus
              value={onBehalfUserId}
              onChange={e => {
                const uid = e.target.value;
                setOnBehalfUserId(uid);
                const u = teamUsers.find(x => x.userId === uid);
                setName(u ? (memberName(u) || user?.name || "") : (user?.name ?? ""));
              }}
              className="w-full px-3 py-2 rounded-lg bg-fg/5 border border-fg/10 text-fg text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
            >
              {eligibleApprovers.length === 0 && <option value={user?.id ?? ""}>{user?.name ?? "—"}</option>}
              {eligibleApprovers.map(u => (
                <option key={u.userId} value={u.userId}>
                  {(memberName(u) || u.userId)}{!u.hasSignature ? "  ·  (sin firma)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !isReject) void submit(); }}
              className="w-full px-3 py-2 rounded-lg bg-fg/5 border border-fg/10 text-fg text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
              placeholder="Nombre y apellido"
            />
          )}
        </div>
        {adminPicker && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-industrial/60">
              {step === "APRUEBA" ? "Fecha de aprobación" : "Fecha de autorización"}
            </label>
            <input
              type="date"
              value={actionDate}
              onChange={e => setActionDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-fg/5 border border-fg/10 text-fg text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>
        )}
        {isReject && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-industrial/60">Motivo del rechazo</label>
            <AutoTextArea
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

      {createdSampleCodes && (
        <AlertDialog
          title={t("wo.ai.fluidSampleCreatedTitle")}
          message={
            (createdSampleCodes.length === 1 ? t("wo.ai.fluidSampleCreatedOne") : t("wo.ai.fluidSampleCreatedMany"))
              .replace("{code}", createdSampleCodes.join(", "))
              .replace("{section}", t("page.fluidAnalyses"))
          }
          onClose={() => { setCreatedSampleCodes(null); onSuccess(); }}
        />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export const WorkOrdersPage: React.FC = () => {
  const t = useT();
  const woTerms = useWoTerms();
  const { user } = useAuth();
  const can = useCan();
  const navigate = useNavigate();
  const { selectedVesselCode } = useVesselContext();
  // Editar/guardar una OT. Espeja canManageWorkOrders del backend: quién la
  // tiene se configura en Equipo → Permisos por rol.
  const canManage = can("wo.manage");

  // ABRIR una OT es más amplio que editarla: la puede abrir cualquiera menos el
  // usuario de solo lectura. Es un punto de entrada operativo — quien detecta
  // algo a bordo tiene que poder abrir la OT ahí mismo. Espeja
  // canCreateWorkOrders del backend, que ya lo permitía; el botón estaba
  // colgado de canManage y escondía la creación a media flota.
  const canCreate = !!user && user.role !== "AUDITOR_READONLY";

  const [searchParams, setSearchParams] = useSearchParams();
  const { code: linkCode, open: openLink, close: closeLink } = useDeepLink("/work-orders");

  // Al cerrar una OT que viene de un plan, si ese plan renueva un certificado se
  // ofrece cargar la vigencia nueva. Vive en la página porque el modal de la OT
  // ya se desmontó. Nunca se actualiza solo: lo confirma el usuario con el
  // documento del proveedor a la vista.
  const [certToRenew, setCertToRenew] = useState<{ cert: RenewableCertificate; planId: string; completedAt: string | null } | null>(null);
  const offerCertificateRenewal = useCallback(async (planId: string, completedAt: string | null) => {
    try {
      const r = await api.get<{ items: RenewableCertificate[] }>(`/app/certificates?maintenancePlanId=${encodeURIComponent(planId)}`);
      const cert = r.items?.[0];
      if (cert) setCertToRenew({ cert, planId, completedAt });
    } catch { /* sin certificado vinculado: no molestamos */ }
  }, []);
  const [editing, setEditing]         = useState<WorkOrder | null>(null);
  const [createPrefill, setCreatePrefill] = useState<WoPrefill | null>(null);
  // "+ Nueva OT" pasa por el asistente categoría → equipo → ítem del plan.
  // `createPrefill` (deep-link desde un defecto, etc.) sigue abriendo el
  // formulario directo — ya trae su propio origen resuelto.
  const [showNewWoWizard, setShowNewWoWizard] = useState(false);
  const [viewMode, setViewMode]       = useState<"list" | "kanban">("kanban");
  const [search, setSearch]           = useState("");

  useCopilotEmitter(!editing && !showNewWoWizard && !createPrefill ? { module: "WORK_ORDERS", screen: "WO_LIST" } : null);
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
  // Filtro que llega desde una métrica del panel TMSA (lib/tmsa-filter.tsx).
  const tmsaFilter = useTmsaFilter();

  // Map of workOrderId → {id, deferralCode, status} for ON_HOLD WOs
  const [deferralMap, setDeferralMap] = useState<Map<string, { id: string; deferralCode: string; status: string; toNextDrydock?: boolean }>>(new Map());
  useEffect(() => {
    const onHoldIds = (data?.items ?? []).filter(w => w.status === "ON_HOLD").map(w => w.id);
    if (onHoldIds.length === 0) { setDeferralMap(new Map()); return; }
    let cancelled = false;
    api.get<{ items: { id: string; deferralCode: string; sourceId: string; status: string; toNextDrydock?: boolean }[] }>("/app/pms/deferrals")
      .then(r => {
        if (cancelled) return;
        const map = new Map<string, { id: string; deferralCode: string; status: string; toNextDrydock?: boolean }>();
        for (const d of r.items ?? []) {
          if (onHoldIds.includes(d.sourceId)) map.set(d.sourceId, { id: d.id, deferralCode: d.deferralCode, status: d.status, toNextDrydock: d.toNextDrydock === true });
        }
        setDeferralMap(map);
      })
      .catch(() => { if (!cancelled) setDeferralMap(new Map()); });
    return () => { cancelled = true; };
  }, [data]);

  // Map of workOrderId → SS colgadas de esa OT, para mostrarlas dentro de la
  // tarjeta del kanban. Una sola llamada al listado (chico, sin paginar) y
  // agrupado en cliente — mismo criterio que el mapa de diferimientos de arriba.
  const [srMap, setSrMap] = useState<Map<string, SrLite[]>>(new Map());
  useEffect(() => {
    let cancelled = false;
    api.get<{ items: SrLite[] }>("/app/pms/service-requests")
      .then(r => {
        if (cancelled) return;
        const map = new Map<string, SrLite[]>();
        for (const sr of r.items ?? []) {
          if (!sr.workOrderId) continue;
          const list = map.get(sr.workOrderId);
          if (list) list.push(sr); else map.set(sr.workOrderId, [sr]);
        }
        for (const list of map.values()) list.sort((a, b) => a.serviceRequestCode.localeCompare(b.serviceRequestCode));
        setSrMap(map);
      })
      .catch(() => { if (!cancelled) setSrMap(new Map()); });
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
    // Pendientes de tramitación: mismas etapas que las columnas del tablero, así
    // el filtro coincide 1:1 con lo que el usuario ve en Kanban.
    if (viewFilter === "toApprove")   return items.filter(w => woStage(w) === "SOLICITADA");
    if (viewFilter === "toAuthorize") return items.filter(w => woStage(w) === "APROBADA");
    if (viewFilter === "overdue")   return items.filter(w => !CLOSED.has(w.status) && w.status !== "ON_HOLD" && !!w.dueDate && parseLocalDate(w.dueDate) < now);
    if (viewFilter === "open")      return items.filter(w => !CLOSED.has(w.status) && w.status !== "ON_HOLD" && !(!!w.dueDate && parseLocalDate(w.dueDate) < now));
    return items;
  }, [data, viewFilter, deferralMap]);

  // Buscador global: cuando hay texto, busca sobre TODAS las SS del buque
  // (cualquier estado, incluidas las cerradas) ignorando el filtro de vista.
  // Sin texto, respeta el comportamiento actual (visibleItems / viewFilter).
  const displayItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibleItems;
    const base = data?.items ?? null;
    if (!base) return base;
    return base.filter(w =>
      (w.workOrderCode ?? "").toLowerCase().includes(q) ||
      (w.title ?? "").toLowerCase().includes(q) ||
      (w.assetName ?? "").toLowerCase().includes(q) ||
      (w.assignedToUserName ?? "").toLowerCase().includes(q) ||
      (w.vesselCode ?? "").toLowerCase().includes(q),
    );
  }, [search, visibleItems, data]);

  // Al llegar desde el panel TMSA, sólo las OT que contó esa tarjeta. Se aplica
  // al final para que conviva con la vista (vencidas, a aprobar…) y el buscador.
  const tmsaDisplayItems = useMemo(
    () => applyTmsaFilter(displayItems, tmsaFilter, r => r.id),
    [displayItems, tmsaFilter],
  );

  // Guard contra clicks rápidos entre dos OT: si mientras cargaba el detalle de
  // A se pidió B, la respuesta de A llega tarde y se descarta (mismo patrón
  // openTokenRef que MaintenancePlans).
  const openTokenRef = useRef(0);
  const openDetail = useCallback(async (row: WorkOrder) => {
    const token = ++openTokenRef.current;
    setDetailLoadingId(row.id);
    setTableActionError(null);
    try {
      const detailed = await api.get<WorkOrder>(`/app/pms/work-orders/${row.id}`);
      if (openTokenRef.current !== token) return;
      setEditing(detailed);
    } catch {
      if (openTokenRef.current === token) setEditing(row);
    }
    finally { if (openTokenRef.current === token) setDetailLoadingId(null); }
  }, []);

  // Compatibilidad: `?autoCode=` (badges de plan) → redirige a la ruta deep-link.
  // `replace`: el `?autoCode=` es un puente, no un destino. Si quedara en el
  // historial, cerrar la OT volvería a él y la OT se reabriría sola.
  useEffect(() => {
    if (autoCode) openLink(autoCode, { replace: true });
  }, [autoCode, openLink]);

  // Deep-link: la URL `/work-orders/:code` es la fuente de verdad del detalle.
  useEffect(() => {
    if (!linkCode) { setEditing(null); return; }
    if (editing?.workOrderCode === linkCode) return;
    const match = data?.items?.find(w => w.workOrderCode === linkCode);
    if (match) void openDetail(match);
  }, [linkCode, data, editing, openDetail]);

  const openActionModal = useCallback((wo: WorkOrder, type: ActionType) => {
    setActionTarget({ workOrder: wo, type });
  }, []);

  const onActionSuccess = useCallback(() => {
    setActionTarget(null);
    closeLink();
    void reload();
  }, [reload, closeLink]);

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
      key: "stage", header: t("wo.col.stage"),
      sortValue: r => woStage(r),
      render: r => <WoStageBadge wo={r} />,
    },
    {
      key: "status", header: t("wo.col.status"),
      render: r => {
        const deferral = r.status === "ON_HOLD" ? deferralMap.get(r.id) : undefined;
        return (
          <div className="flex flex-col items-start gap-1">
            <WoStatusBadge status={r.status} dueDate={r.dueDate} deferralStatus={deferral?.status} toNextDrydock={deferral?.toNextDrydock} />
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
        {canCreate && (
          <button onClick={() => setShowNewWoWizard(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 transition-all">
            <Plus className="w-3.5 h-3.5" /> {t("wo.new")}
          </button>
        )}
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
        <button
          onClick={async () => { setGeneratingReport(true); try { await printOpenWorkOrdersReport(selectedVesselCode, `${woTerms.abbr}s-Abiertas`); } finally { setGeneratingReport(false); } }}
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
            onClick={() => {
              setViewMode("kanban");
              // El tablero muestra todas las etapas como columnas: si quedaba un
              // chip activo de la lista, se limpia — si no, el tablero saldría
              // recortado sin ningún filtro visible que lo explique.
              if (viewFilter) {
                const params = new URLSearchParams(searchParams);
                params.delete("view");
                setSearchParams(params, { replace: true });
              }
            }}
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
        {/* Los chips son de la vista lista: en el tablero las etapas YA son las
            columnas, así que ahí sobran (y un filtro activo pero invisible
            recortaría el tablero sin decir por qué — ver el toggle a Kanban,
            que limpia el filtro al cambiar de vista). */}
        {viewMode === "list" && ([
          { key: "",                  labelKey: "wo.filter.all" },
          { key: "toApprove",         labelKey: "wo.filter.toApprove" },
          { key: "toAuthorize",       labelKey: "wo.filter.toAuthorize" },
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
        {/* Buscador global de SS — busca en cualquier estado, incluidas cerradas. */}
        <div className="flex items-center gap-1.5 bg-fg/5 border border-fg/10 rounded-lg px-2.5 py-1.5 ml-auto">
          <Search className="w-3 h-3 text-text-industrial/40 shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("wo.page.searchPlaceholder")}
            className="w-64 bg-transparent text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-text-industrial/40 hover:text-fg transition-colors">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <TmsaFilterBanner filter={tmsaFilter} shown={tmsaDisplayItems?.length ?? 0} total={data?.items?.length ?? 0} />

      {viewMode === "list" ? (
        <DataTable columns={columns} data={tmsaDisplayItems} loading={loading} error={error} keyFn={r => r.id} emptyText={t("empty.workOrders")} onRowClick={row => openLink(row.workOrderCode)} />
      ) : (
        <KanbanBoard items={tmsaDisplayItems ?? []} deferralMap={deferralMap} srMap={srMap} loadingId={detailLoadingId} loading={loading} onOpen={wo => openLink(wo.workOrderCode)} onReload={reload} />
      )}

      {showNewWoWizard && (
        <NewWorkOrderWizard
          onClose={() => setShowNewWoWizard(false)}
          onSaved={(_woId, workOrderCode) => {
            setShowNewWoWizard(false);
            void reload();
            if (workOrderCode) openLink(workOrderCode);
          }}
        />
      )}

      {createPrefill && (
        <CreateWorkOrderModal
          prefill={createPrefill}
          initialVesselCode={selectedVesselCode ?? undefined}
          onClose={() => setCreatePrefill(null)}
          // La OT recién creada se abre para completarla (nace "En preparación").
          onSaved={(_woId, workOrderCode) => {
            setCreatePrefill(null);
            void reload();
            if (workOrderCode) openLink(workOrderCode);
          }}
        />
      )}
      {editing && (
        <WorkOrderModal
          workOrder={editing}
          canManage={canManage}
          onClose={() => closeLink()}
          onSaved={() => { closeLink(); void reload(); }}
          onReload={() => { void reload(); }}
          onOpenAction={openActionModal}
          onPlanExecuted={(planId, completedAt) => { void offerCertificateRenewal(planId, completedAt); }}
        />
      )}

      {certToRenew && (
        <CertificateRenewalDialog
          cert={certToRenew.cert}
          defaultIssueDate={certToRenew.completedAt}
          maintenancePlanId={certToRenew.planId}
          onClose={() => setCertToRenew(null)}
          onRenewed={() => setCertToRenew(null)}
        />
      )}
      {actionTarget?.type === "hold"   && <HoldModal   workOrder={actionTarget.workOrder} onClose={() => setActionTarget(null)} onSuccess={onActionSuccess} />}
      {actionTarget?.type === "cancel" && <CancelModal workOrder={actionTarget.workOrder} onClose={() => setActionTarget(null)} onSuccess={onActionSuccess} />}
      {actionTarget?.type === "reopen" && <ReopenModal workOrder={actionTarget.workOrder} onClose={() => setActionTarget(null)} onSuccess={onActionSuccess} />}
      {showExcel && <ExcelPanel module="work_orders" onClose={() => setShowExcel(false)} />}
    </div>
  );
};
