import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardList,
  Clock,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  FileText,
  Filter,
  GitBranch,
  ListTree,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  Sparkles,
  Table2,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { MocModal, type MocPrefill } from "./Moc";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { downloadAuthedFile } from "../lib/authed-media";
import { useAuth, useCan } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fmtDate, fromFilterSelectValue, parseLocalDate, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { VesselLabel } from "../components/EntityLabels";
import { ExcelPanel } from "../components/ExcelPanel";
import { MaintenancePlansGrid } from "../components/MaintenancePlansGrid";
import { MaintenancePlansMatrix } from "../components/MaintenancePlansMatrix";
import { PlannedItemsEditor, type WoPlannedItem, type WoSpareOption } from "../components/work-orders/PlannedItemsEditor";
import { useT, useWoTerms } from "../lib/i18n";
import { useDeepLink } from "../lib/deep-link";
import { CopyLinkButton } from "../components/CopyLinkButton";
import { useCopilotEmitter, useCopilotApplyFields, useCopilotScreenContext } from "../lib/copilot-context";
import { CreateWorkOrderModal } from "../components/CreateWorkOrderModal";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { AlertDialog } from "../components/AlertDialog";
import { CertificateRenewalDialog, type RenewableCertificate } from "../components/CertificateRenewalDialog";
import { PlanHistoryModal } from "../components/PlanHistoryModal";
import { AssetSearchDropdown } from "../components/AssetSearchDropdown";
import { SpareUsageEditor, type SpareLine } from "../components/SpareUsageEditor";
import { RichTextArea } from "../components/RichTextArea";
import { RiskMatrix } from "../components/RiskMatrix";
import {
  RISK_PROBS, RISK_CONS, RISK_GRID,
  deriveRiskLevelFromMatrix, toUiRiskLevel, toUiRiskProbability, toUiRiskConsequence,
  type RiskLevel, type RiskProbability, type RiskConsequence,
} from "../lib/risk";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MaintenancePlan {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  assetName?: string | null;
  activeWorkOrderCode?: string | null;
  deferredWorkOrderCode?: string | null;
  assetCurrentHours?: number | null;
  taskCode: string;
  title: string;
  description: string | null;
  taskType: "MAINTENANCE" | "INSPECTION";
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
  estimatedHours: number | null;
  status: string;
  executionStatus: string;
  lastExecutionDate: string | null;
  lastExecutionHours: number | null;
  nextDueDate: string | null;
  nextDueHours: number | null;
  taskMasterId: string | null;
  triggerResultMode: string;
  checklistTemplate: string | null;
  createdAt: string;
  criticality?: string | null;
  responsible?: string | null;
  department?: "CUBIERTA" | "MAQUINAS" | "BARCAZA" | "PROVEEDOR" | "OTROS" | null;
  providerId?: string | null;
  providerName?: string | null;
  /** Varios proveedores + aclaración (área = PROVEEDOR). Resuelto por el backend con nombre. */
  providerRequests?: { providerId: string; purpose?: string | null; providerName?: string | null }[] | null;
  /** Repuestos/materiales previstos. Se heredan a la OT al abrirla. */
  spares?: { kind: "SPARE" | "MATERIAL"; spareId?: string | null; description: string; quantity?: number | null; unit?: string | null }[] | null;
  acceptanceCriteria?: string | null;
  loto?: string | null;
  sfiGroupNumber?: number | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  riskProbability?: "LIKELY" | "PROBABLE" | "UNLIKELY" | "RARE" | null;
  riskConsequence?: "FATALITY" | "MAJOR" | "MINOR" | "NEGLIGIBLE" | null;
  riskAnalysisResult?: string | null;
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
  samplingKind?: string | null;
  samplingFluidType?: string | null;
  windowMode?: string | null;
  windowLeadDays?: number | null;
}

interface ListResponse {
  items: MaintenancePlan[];
  total: number;
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function computeStatus(plan: MaintenancePlan): string {
  if (plan.executionStatus === "IN_WINDOW") return "IN_WINDOW";
  // Vencido tiene prioridad sobre "nunca ejecutado": NEVER_EXECUTED queda solo
  // para planes que aún no vencieron y nunca corrieron. (Igual que el dashboard.)
  const neverExecuted = plan.lastExecutionDate == null && plan.lastExecutionHours == null;
  if (plan.nextDueHours != null) {
    const hours = plan.assetCurrentHours ?? 0;
    const diff = plan.nextDueHours - hours;
    if (diff <= 0)   return "OVERDUE";
    if (neverExecuted) return "NEVER_EXECUTED";
    if (diff <= 50)  return "DUE";
    if (diff <= 250) return "UPCOMING";
    return "FUTURE";
  }
  if (plan.nextDueDate) {
    // Diferencia en DÍAS CALENDARIO (sin hora) para que la ventana sea
    // determinística: "faltan N días" no debe depender de la hora del día
    // (antes, a ~7.1 días por la tarde, una tarea a 7 días no entraba).
    const due = parseLocalDate(plan.nextDueDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const daysLeft = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    // Ventanas FIJAS, idénticas a deriveDashboardStatus del backend (mp-summary)
    // para que el donut del Dashboard y esta lista cuenten exactamente lo mismo:
    //  - vencido (< 0 días)            → OVERDUE  ("Vencidas")
    //  - nunca ejecutado (no vencido)  → NEVER_EXECUTED ("Sin ejecutar")
    //  - próximos 7 días               → DUE
    //  - próximos 8–30 días            → UPCOMING ("Próximas")
    //  - más de 30 días                → FUTURE   ("Al Día")
    if (daysLeft < 0)   return "OVERDUE";
    if (neverExecuted)  return "NEVER_EXECUTED";
    if (daysLeft <= 7)  return "DUE";
    if (daysLeft <= 30) return "UPCOMING";
    return "FUTURE";
  }
  if (neverExecuted) return "NEVER_EXECUTED";
  return plan.executionStatus ?? "FUTURE";
}

function StatusBadgeInline({ plan, onOpenWo }: { plan: MaintenancePlan; onOpenWo?: (code: string) => void }) {
  const t = useT();
  const es = computeStatus(plan);

  const pill = (() => {
    if (es === "OVERDUE")
      return (
        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20 whitespace-nowrap">
          <AlertTriangle className="w-2.5 h-2.5" /> {t("mp.statusBadge.overdue")}
        </span>
      );
    if (es === "DUE")
      return (
        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20 whitespace-nowrap">
          <AlertTriangle className="w-2.5 h-2.5" /> {t("mp.statusBadge.due")}
        </span>
      );
    if (es === "IN_WINDOW")
      return (
        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 whitespace-nowrap">
          <Clock className="w-2.5 h-2.5" /> {t("mp.statusBadge.inWindow")}
        </span>
      );
    if (es === "NEVER_EXECUTED")
      return (
        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-slate-500/10 text-slate-400 border-slate-500/20 whitespace-nowrap">
          <Clock className="w-2.5 h-2.5" /> {t("mp.statusBadge.neverExecuted")}
        </span>
      );
    if (es === "UPCOMING")
      return (
        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20 whitespace-nowrap">
          <Clock className="w-2.5 h-2.5" /> {t("mp.statusBadge.upcoming")}
        </span>
      );
    // COMPLETED y FUTURE comparten estilo "válido"
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 whitespace-nowrap">
        <CheckCircle2 className="w-2.5 h-2.5" /> {t("mp.statusBadge.valid")}
      </span>
    );
  })();

  // Código de OT bajo el badge: OT activa (acento) o, si la OT fue diferida
  // (ON_HOLD), su código en amarillo con una "D" de DIFERIDA al lado.
  const woCode = plan.activeWorkOrderCode ?? plan.deferredWorkOrderCode ?? null;
  const isDeferred = !plan.activeWorkOrderCode && !!plan.deferredWorkOrderCode;
  const woRow = woCode && (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onOpenWo ? (e) => { e.stopPropagation(); onOpenWo(woCode); } : undefined}
        disabled={!onOpenWo}
        className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold font-mono whitespace-nowrap disabled:opacity-40 disabled:cursor-default enabled:cursor-pointer transition-colors ${
          isDeferred
            ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30 enabled:hover:bg-yellow-500/20"
            : "bg-fg/5 text-accent border-accent/30 enabled:hover:bg-accent/10"
        }`}
      >
        <ExternalLink className="w-2.5 h-2.5 shrink-0" />
        {woCode}
      </button>
      {isDeferred && (
        <span
          title={t("wo.status.postponed")}
          className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border font-bold bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30"
        >
          D
        </span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col items-start gap-1">
      {pill}
      {woRow}
    </div>
  );
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

const EDITABLE_STATUSES = ["ACTIVE", "INACTIVE", "DRAFT"] as const;

// SFI tab filter — G0-G9 filter by first digit of sfiGroupNumber (e.g. G6 = 600-699)
type SfiTab = "ALL" | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | "NONE";
const SFI_TABS: { key: SfiTab; label: string }[] = [
  { key: "ALL",  label: "TODOS" },
  { key: 0,      label: "G0" },
  { key: 1,      label: "G1" },
  { key: 2,      label: "G2" },
  { key: 3,      label: "G3" },
  { key: 4,      label: "G4" },
  { key: 5,      label: "G5" },
  { key: 6,      label: "G6" },
  { key: 7,      label: "G7" },
  { key: 8,      label: "G8" },
  { key: 9,      label: "G9" },
];

function sfiTabOf(sfiGroupNumber: number | null | undefined): SfiTab {
  if (sfiGroupNumber == null) return "NONE";
  const digit = sfiGroupNumber < 10 ? sfiGroupNumber : Math.floor(sfiGroupNumber / 100);
  return digit >= 0 && digit <= 9 ? digit as SfiTab : "NONE";
}
// Matriz de riesgo: constantes/tipos/helpers → ../lib/risk ; UI → ../components/RiskMatrix

function formatFrequency(plan: MaintenancePlan): string {
  const tt = plan.triggerType.toUpperCase();
  if (tt === "CALENDAR" || tt === "MONTHS") return plan.frequencyMonths != null ? `${plan.frequencyMonths} mo` : "—";
  if (tt === "HOURS" || tt === "RUNNING_HOURS") return plan.frequencyHours != null ? `${plan.frequencyHours} h` : "—";
  if (tt === "DAY") return plan.frequencyMonths != null ? `${plan.frequencyMonths} d` : "—";
  if (tt === "WEEK") return plan.frequencyMonths != null ? `${plan.frequencyMonths} sem` : "—";
  return "—";
}

function normalizeOptionalText(value: string): string | null {
  const t = value.trim();
  return t || null;
}

// Rango de frecuencia para ordenar "de menor a mayor" (intervalo más corto
// primero). Convierte todo a un escalar comparable: calendario en días
// (semanal < mensual < anual…), horas después de todo lo calendario, y sin
// frecuencia (CONDITION/EVENT) al final. Mismo criterio que la Matriz.
function freqRank(p: MaintenancePlan): number {
  const tt = (p.triggerType || "").toUpperCase();
  if ((tt === "HOURS" || tt === "RUNNING_HOURS") && p.frequencyHours != null && p.frequencyHours > 0) {
    return 10_000_000 + p.frequencyHours;
  }
  if (tt === "DAY" && p.frequencyMonths != null && p.frequencyMonths > 0) return p.frequencyMonths;
  if (tt === "WEEK" && p.frequencyMonths != null && p.frequencyMonths > 0) return p.frequencyMonths * 7;
  if ((tt === "MONTHS" || tt === "CALENDAR") && p.frequencyMonths != null && p.frequencyMonths > 0) {
    return Math.round(p.frequencyMonths * 30.44);
  }
  return 99_999_999;
}

const TRIGGER_TYPES = ["MONTHS", "HOURS", "CALENDAR", "RUNNING_HOURS", "CONDITION", "EVENT", "DAY", "WEEK"] as const;
type TriggerType = (typeof TRIGGER_TYPES)[number];
// CHECKLIST se quitó de la lista a pedido del cliente: no lo usaba ningún plan
// (0 de 1101 en producción). El valor sigue existiendo en el enum del schema
// para no romper datos históricos si alguno apareciera; simplemente ya no se
// puede elegir al crear o editar.
const TRIGGER_RESULT_MODES = ["DUE_ONLY", "AUTO_WO", "EXPRESS"] as const;
// SFI: solo se usa el GRUPO (0-9). Los nombres salen de i18n `sfi.g.<n>`.
const SFI_GROUP_NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Fecha ISO del backend → valor YYYY-MM-DD para un <input type="date">. */
function toDateInput(v: string | null | undefined): string { return v ? v.slice(0, 10) : ""; }

function needsHours(tt: string) { return tt === "HOURS" || tt === "RUNNING_HOURS"; }
function needsMonths(tt: string) { return tt === "MONTHS" || tt === "CALENDAR"; }
function needsDays(tt: string) { return tt === "DAY"; }
function needsWeeks(tt: string) { return tt === "WEEK"; }
function needsDateFreq(tt: string) { return needsMonths(tt) || needsDays(tt) || needsWeeks(tt); }

/**
 * Preview del PRÓXIMO VENCIMIENTO a partir de la última ejecución + la frecuencia.
 * Espeja recalculateNextDue del backend (fuente autoritativa al guardar); acá es
 * solo para que el admin vea el resultado en vivo mientras edita.
 */
function previewNextDue(
  tt: string, lastDate: string, lastHours: string, freqMonths: string, freqHours: string,
): { text: string } | null {
  const fm = Number(freqMonths) || 0;
  const fh = Number(freqHours) || 0;
  if (needsHours(tt)) {
    const lh = Number(lastHours);
    if (Number.isFinite(lh) && lastHours.trim() !== "" && fh > 0) return { text: `${(lh + fh).toLocaleString()}h` };
    return null;
  }
  if (!lastDate) return null;
  const d = new Date(lastDate + "T00:00:00");
  if (Number.isNaN(d.getTime()) || fm <= 0) return null;
  const nd = new Date(d);
  if (needsMonths(tt)) nd.setMonth(nd.getMonth() + fm);
  else if (needsDays(tt)) nd.setDate(nd.getDate() + fm);
  else if (needsWeeks(tt)) nd.setDate(nd.getDate() + fm * 7);
  else return null;
  return { text: fmtDate(nd.toISOString().slice(0, 10)) ?? "—" };
}

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const selectCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50";
const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider";
// Recuadro que agrupa visualmente una sección del formulario del plan.
const sectionCardCls = "rounded-2xl border border-fg/10 bg-fg/[0.02] p-4 space-y-4";
const sectionTitleCls = "text-[11px] font-bold uppercase tracking-widest text-accent/80";
const sectionLabelCls = "block font-semibold uppercase tracking-wider px-2 py-1 rounded-sm";
const sectionLabelStyle: React.CSSProperties = { backgroundColor: "#0f172a", color: "white", fontSize: "1.2rem" };
const aiLabelStyle: React.CSSProperties = { backgroundColor: "#0c1f3f", color: "white", fontSize: "1.2rem", borderLeft: "3px solid #3b82f6" };

// ─── Asset live-search dropdown ────────────────────────────────────────────────

// AssetSearchDropdown se movió a components/AssetSearchDropdown.tsx (compartido con el modal de Nueva OT).

// ─── ExecutionModal ───────────────────────────────────────────────────────────

interface ExecutionModalProps {
  plan: MaintenancePlan;
  userName: string;
  userId: string | null;
  isAdmin: boolean;
  onClose: () => void;
  /** Recibe la fecha de ejecución: sirve para prellenar la renovación del certificado. */
  onSuccess: (completedAt?: string) => void;
}

interface TeamMember { userId: string; firstName: string | null; lastName: string | null; formName: string | null; hasSignature: boolean }
const teamMemberName = (u: TeamMember) => (u.formName || [u.firstName, u.lastName].filter(Boolean).join(" ") || "").trim();

const ExecutionModal: React.FC<ExecutionModalProps> = ({ plan, userName, userId, isAdmin, onClose, onSuccess }) => {
  const navigate = useNavigate();
  const t = useT();
  const [executedByName, setExecutedByName] = useState(userName);
  const [executedByUserId, setExecutedByUserId] = useState<string>(userId ?? "");
  // Solo el admin puede reportar en nombre de otro usuario → carga la lista del equipo.
  const [teamUsers, setTeamUsers] = useState<TeamMember[]>([]);
  React.useEffect(() => {
    if (!isAdmin) return;
    api.get<TeamMember[]>("/app/team/members")
      .then(rows => setTeamUsers(Array.isArray(rows) ? rows : []))
      .catch(() => setTeamUsers([]));
  }, [isAdmin]);
  const [result, setResult] = useState<"SATISFACTORIO" | "CON_DEFICIENCIAS">("SATISFACTORIO");
  const [notes, setNotes] = useState("");
  const [deficienciesNotes, setDeficienciesNotes] = useState("");
  const [completedAt, setCompletedAt] = useState(new Date().toISOString().slice(0, 10));
  const [runningHours, setRunningHours] = useState("");
  const isExpress = plan.triggerResultMode === "EXPRESS";
  const [spareUsages, setSpareUsages] = useState<SpareLine[]>([]);
  // Prellenar los repuestos con los de la última ejecución de este plan (así no
  // hay que reelegir el mismo aceite cada vez). Solo para planes EXPRESS.
  useEffect(() => {
    if (!isExpress) return;
    let cancelled = false;
    api.get<{ lines: Array<{ spareId: string; qty: number; unit: string }> }>(
      `/app/pms/maintenance-plans/${plan.id}/last-spare-usage`,
    ).then(res => {
      if (cancelled || !res?.lines?.length) return;
      setSpareUsages(res.lines.map(l => ({
        spareId: l.spareId,
        spareName: "",
        unit: l.unit,
        qty: l.qty,
        criticality: "C",
        available: 0,
      })));
    }).catch(() => { /* sin previa → lista vacía */ });
    return () => { cancelled = true; };
  }, [isExpress, plan.id]);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openingDefect, setOpeningDefect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI suggestion — auto-triggered while typing deficiencies
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Post-save WO print confirmation screen
  const [showPrintConfirm, setShowPrintConfirm] = useState(false);

  const isHoursBased = needsHours(plan.triggerType);

  // Debounced AI analysis when deficiencies notes changes
  React.useEffect(() => {
    if (result !== "CON_DEFICIENCIAS" || !deficienciesNotes.trim()) {
      setAiSuggestion(null);
      setAiLoading(false);
      return;
    }
    setAiLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.post<{ suggestion: string }>("/app/copiloto/analyze-deficiency", {
          planTitle: plan.title,
          vesselCode: plan.vesselCode,
          deficienciesNotes: deficienciesNotes.trim(),
        });
        setAiSuggestion(res.suggestion ?? null);
      } catch {
        setAiSuggestion(null);
      } finally {
        setAiLoading(false);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [deficienciesNotes, result, plan.title, plan.vesselCode]);

  const doSave = async (): Promise<boolean> => {
    if (!executedByName.trim()) { setError(t("mp.exec.executorRequired")); return false; }
    if (result === "CON_DEFICIENCIAS" && !deficienciesNotes.trim()) {
      setError(t("mp.exec.deficienciesRequired"));
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      if (docFile) {
        setUploading(true);
        await api.upload(`/app/pms/maintenance-plans/${plan.id}/upload-checklist`, docFile);
        setUploading(false);
      }
      await api.post(`/app/pms/maintenance-plans/${plan.id}/report-execution`, {
        executedByName: executedByName.trim(),
        executedByUserId: executedByUserId || null,
        result,
        notes: normalizeOptionalText(notes),
        deficienciesNotes: result === "CON_DEFICIENCIAS" ? normalizeOptionalText(deficienciesNotes) : null,
        completedAt,
        runningHoursAtExecution: isHoursBased && runningHours ? Number(runningHours) : null,
        spareUsages: isExpress ? spareUsages.map(u => ({ spareId: u.spareId, qty: u.qty, unit: u.unit })) : undefined,
      });
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("mp.exec.saveError"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (await doSave()) onSuccess(completedAt);
  };

  // ESC guard
  const isDirty = useDirtyTracker({
    executedByName, result, notes, deficienciesNotes, completedAt, runningHours,
    docFileName: docFile?.name ?? "",
    spareCount: spareUsages.length,
  });
  const requestClose = useEscapeGuard({
    enabled: !showPrintConfirm,
    isDirty,
    onSave: handleSave,
    onClose,
  });

  const handleSaveAndPdf = async () => {
    if (!await doSave()) return;
    const token = localStorage.getItem("gpms_token");
    const slug  = localStorage.getItem("gpms_tenant_slug");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (slug)  headers["X-Tenant-Slug"] = slug;
    try {
      const res = await fetch(`/app/pms/maintenance-plans/${plan.id}/pdf`, { headers });
      console.log("[PDF] response status:", res.status);
      if (res.ok) {
        const blob = await res.blob();
        console.log("[PDF] blob size:", blob.size);
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        // Nombre: INSP/MANT - fecha(yyyy.mm.dd) - codigo item - referencia corta (titulo + activo).
        const prefix = plan.taskType === "INSPECTION" ? "INSP" : "MANT";
        const ymd = (completedAt || new Date().toISOString().slice(0, 10)).replace(/-/g, ".");
        const assetShort = (plan.assetName ?? "").split(",")[0]?.trim() ?? "";
        const ref = [plan.title, assetShort].filter(Boolean).join(" ").trim();
        const rawName = `${prefix}-${ymd}-${plan.taskCode ?? plan.id}${ref ? `-${ref}` : ""}`;
        const safeName = rawName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
        a.download = `${safeName}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (err) {
      console.error("[PDF] fetch error:", err);
      alert(t("mp.exec.pdfFailed"));
    }
    onSuccess(completedAt);
  };

  const handleOpenDef = async () => {
    if (!await doSave()) return;
    // If there's an active WO, ask about printing first
    if (plan.activeWorkOrderCode) {
      setShowPrintConfirm(true);
    } else {
      await createDefectAndNavigate();
    }
  };

  const createDefectAndNavigate = async () => {
    setOpeningDefect(true);
    try {
      const defect = await api.post<{ id: string; defectCode: string }>("/app/pms/defects", {
        vesselCode: plan.vesselCode,
        assetId: plan.assetId,
        classification: t("mp.exec.defectClassification"),
        description: deficienciesNotes.trim() || `${t("mp.exec.defectFromPlan")} ${plan.taskCode}`,
        severity: "LOW",
        operationalState: "NORMAL",
      });
      onSuccess(completedAt);
      navigate(`/defects?defectId=${defect.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("mp.exec.defectFailed"));
      setShowPrintConfirm(false);
    } finally {
      setOpeningDefect(false);
    }
  };

  // Print WO confirmation screen
  if (showPrintConfirm) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
            <h2 className="text-base font-bold text-fg">{t("mp.exec.savedTitle")}</h2>
            <ModalCloseButton onClose={requestClose} />
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-fg/80">{t("mp.exec.printWoQuestion")}</p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10">
              <span className="text-xs text-text-industrial/60 font-mono">{t("wo.entityLabelShort")}: {plan.activeWorkOrderCode}</span>
            </div>
            {error && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
            <button
              onClick={() => void createDefectAndNavigate()}
              disabled={openingDefect}
              className="px-4 py-2 rounded-xl text-xs text-text-industrial/60 hover:text-fg transition-colors disabled:opacity-50"
            >
              {t("mp.exec.continueWithoutPrint")}
            </button>
            <button
              onClick={() => {
                window.open(`/work-orders?autoCode=${plan.activeWorkOrderCode}`, "_blank");
                void createDefectAndNavigate();
              }}
              disabled={openingDefect}
              className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              {openingDefect ? <Loader2 className="w-4 h-4 animate-spin" /> : t("mp.exec.printAndContinue")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <div>
            <h2 className="text-base font-bold text-fg">{t("mp.exec.reportTitle")}</h2>
            <p className="text-[11px] text-text-industrial/50 flex items-center gap-1"><span className="font-mono">{plan.taskCode}</span> · <VesselLabel code={plan.vesselCode} className="text-[11px]" showCode /></p>
          </div>
          <ModalCloseButton onClose={requestClose} />
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Result selector */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.exec.resultLabel")}</label>
            <div className="flex gap-2">
              {(["SATISFACTORIO", "CON_DEFICIENCIAS"] as const).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResult(r)}
                  className={`flex-1 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                    result === r
                      ? r === "SATISFACTORIO"
                        ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
                        : "bg-yellow-500/15 border-yellow-500/50 text-yellow-700 dark:text-yellow-400"
                      : "bg-fg/5 border-fg/10 text-text-industrial/50 hover:border-fg/20 hover:text-fg"
                  }`}
                >
                  {r === "SATISFACTORIO" ? t("mp.exec.satisfactory") : t("mp.exec.withDeficiencies")}
                </button>
              ))}
            </div>
          </div>

          {/* Executed by — el admin puede elegir el usuario ejecutor; el resto reporta a su nombre */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.exec.executedBy")}</label>
            {isAdmin && teamUsers.length > 0 ? (
              <select
                value={executedByUserId}
                onChange={e => {
                  const uid = e.target.value;
                  setExecutedByUserId(uid);
                  const m = teamUsers.find(u => u.userId === uid);
                  if (m) setExecutedByName(teamMemberName(m) || executedByName);
                }}
                className={inputCls}
              >
                {!teamUsers.some(u => u.userId === (userId ?? "")) && (
                  <option value={userId ?? ""}>{userName}</option>
                )}
                {teamUsers.map(u => (
                  <option key={u.userId} value={u.userId}>
                    {teamMemberName(u) || u.userId}{!u.hasSignature ? "  ·  (sin firma)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={executedByName}
                onChange={e => setExecutedByName(e.target.value)}
                className={inputCls}
                placeholder={t("mp.exec.executedByPlaceholder")}
              />
            )}
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.exec.executionDate")}</label>
            <input
              type="date"
              value={completedAt}
              onChange={e => setCompletedAt(e.target.value)}
              className={inputCls}
            />
          </div>

          {/* Running hours */}
          {isHoursBased && (
            <div className="space-y-1.5">
              <label className={labelCls}>{t("mp.exec.runningHoursLabel")}</label>
              <input
                type="number"
                min="0"
                value={runningHours}
                onChange={e => setRunningHours(e.target.value)}
                className={inputCls}
                placeholder={t("wo.modal.runningHoursPlaceholder")}
              />
            </div>
          )}

          {/* Repuestos utilizados (solo Mantenimiento Express) */}
          {isExpress && (
            <SpareUsageEditor vesselCode={plan.vesselCode} value={spareUsages} onChange={setSpareUsages} />
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("wo.modal.observations")}</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className={inputCls}
              placeholder={t("mp.exec.notesPlaceholder")}
            />
          </div>

          {/* Deficiencies */}
          {result === "CON_DEFICIENCIAS" && (
            <div className="space-y-1.5">
              <label className={labelCls + " text-yellow-700 dark:text-yellow-400"}>{t("mp.exec.deficienciesLabel")}</label>
              <textarea
                value={deficienciesNotes}
                onChange={e => setDeficienciesNotes(e.target.value)}
                rows={4}
                className={`${inputCls} border-yellow-500/30 focus:border-yellow-400/50`}
                placeholder={t("mp.exec.deficienciesPlaceholder")}
              />
            </div>
          )}

          {/* Document upload */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.exec.checklistLabel")}</label>
            {docFile ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20">
                <span className="text-xs text-accent flex-1 truncate">{docFile.name}</span>
                <button type="button" onClick={() => setDocFile(null)} className="text-text-industrial/40 hover:text-fg transition-colors"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-fg/20 cursor-pointer hover:border-accent/40 transition-colors">
                <span className="text-xs text-text-industrial/50">{t("mp.exec.selectFile")}</span>
                <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                  onChange={e => setDocFile(e.target.files?.[0] ?? null)} />
              </label>
            )}
          </div>

          {/* ── DEF question — último campo ───────────────────────────────── */}
          {result === "CON_DEFICIENCIAS" && (
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 space-y-3">
              <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-300 uppercase tracking-wider">{t("mp.exec.defLogQuestion")}</p>

              {/* AI analysis */}
              {aiLoading && (
                <div className="flex items-center gap-2 text-xs text-text-industrial/50">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  {t("mp.exec.copilotAnalyzing")}
                </div>
              )}
              {aiSuggestion && !aiLoading && (
                <div className="rounded-lg border border-accent/20 bg-accent/5 p-3">
                  <p className="text-[10px] font-bold text-accent uppercase tracking-wider mb-1.5">{t("mp.exec.copilotSuggestion")}</p>
                  <p className="text-xs text-fg/80 whitespace-pre-wrap">{aiSuggestion}</p>
                </div>
              )}

              <button
                type="button"
                onClick={() => void handleOpenDef()}
                disabled={saving || openingDefect || uploading}
                className="w-full py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-400 font-bold text-xs hover:bg-red-500/25 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {(saving || openingDefect) ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {t("mp.exec.openDefRecord")}
              </button>
            </div>
          )}

          {error && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
          <button
            onClick={() => { void handleSaveAndPdf(); }}
            disabled={saving || uploading}
            className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
          >
            {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("mp.exec.uploading")}</>
              : saving ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><FileDown className="w-3.5 h-3.5" /> {t("mp.exec.saveAndPdf")}</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── PostponeModal ────────────────────────────────────────────────────────────

interface PostponeModalProps {
  plan: MaintenancePlan;
  onClose: () => void;
  onSuccess: () => void;
}

const PostponeModal: React.FC<PostponeModalProps> = ({ plan, onClose, onSuccess }) => {
  const t = useT();
  const [newDueDate, setNewDueDate] = useState("");
  const [newDueHours, setNewDueHours] = useState("");
  const [justification, setJustification] = useState("");
  const [compensatoryMeasures, setCompensatoryMeasures] = useState("");
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  const isHoursBased = needsHours(plan.triggerType);

  const emitContext = useCopilotEmitter({
    module: "MAINTENANCE_PLANS",
    screen: "MP_POSTPONE",
    entityId: plan.id,
    entityCode: plan.taskCode,
    vesselCode: plan.vesselCode,
    workflowStage: "POSTPONEMENT",
    canEdit: true,
    fieldValues: {
      justification: justification || null,
      compensatoryMeasures: compensatoryMeasures || null,
      authorizedBy: authorizedBy || null,
    },
  });
  void emitContext;

  const fetchAiSuggestion = async () => {
    if (!justification.trim()) return;
    setAiLoading(true);
    setAiSuggestion(null);
    try {
      const res = await api.post<{ suggestion: string }>("/app/copiloto/analyze-postponement", {
        planTitle: plan.title,
        vesselCode: plan.vesselCode,
        triggerType: plan.triggerType,
        justification: justification.trim(),
        newDueDate: newDueDate || null,
        newDueHours: newDueHours || null,
      });
      setAiSuggestion(res.suggestion ?? null);
    } catch {
      setAiSuggestion(t("mp.postpone.copilotFail"));
    } finally {
      setAiLoading(false);
    }
  };

  const save = async (waitAuthorization: boolean) => {
    if (!justification.trim()) { setError(t("mp.postpone.justificationRequired")); return; }
    if (!waitAuthorization && !authorizedBy.trim()) {
      setError(t("mp.postpone.authorizerRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/app/pms/maintenance-plans/${plan.id}/postpone`, {
        newDueDate: newDueDate || null,
        newDueHours: isHoursBased && newDueHours ? Number(newDueHours) : null,
        justification: justification.trim(),
        compensatoryMeasures: normalizeOptionalText(compensatoryMeasures),
        authorizedBy: waitAuthorization ? null : authorizedBy.trim() || null,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  // ESC guard
  const isDirty = useDirtyTracker({
    newDueDate, newDueHours, justification, compensatoryMeasures, authorizedBy,
  });
  const requestClose = useEscapeGuard({
    isDirty,
    onSave: () => save(false),
    onClose,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <div>
            <h2 className="text-base font-bold text-fg">{t("mp.postpone.title")}</h2>
            <p className="text-[11px] text-text-industrial/50 flex items-center gap-1"><span className="font-mono">{plan.taskCode}</span> · <VesselLabel code={plan.vesselCode} className="text-[11px]" showCode /></p>
          </div>
          <ModalCloseButton onClose={requestClose} />
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Inherited plan context */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase text-text-industrial/40 tracking-wider">{t("mp.postpone.taskLabel")}</p>
              <p className="text-sm font-medium text-fg line-clamp-2">{plan.title}</p>
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase text-text-industrial/40 tracking-wider">{t("mp.postpone.currentDue")}</p>
              <p className="text-sm font-mono text-accent">
                {isHoursBased
                  ? (plan.nextDueHours != null ? `${plan.nextDueHours.toLocaleString()}h` : "—")
                  : (fmtDate(plan.nextDueDate) ?? "—")}
              </p>
            </div>
          </div>

          {/* New due */}
          {isHoursBased ? (
            <div className="space-y-1.5">
              <label className={labelCls}>{t("mp.postpone.newDueHours")}</label>
              <input
                type="number"
                min="0"
                value={newDueHours}
                onChange={e => setNewDueHours(e.target.value)}
                className={inputCls}
                placeholder={t("mp.postpone.newDueHoursPlaceholder")}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className={labelCls}>{t("mp.postpone.newDueDate")}</label>
              <input
                type="date"
                value={newDueDate}
                onChange={e => setNewDueDate(e.target.value)}
                className={inputCls}
              />
            </div>
          )}

          {/* Justification */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.postpone.justification")}</label>
            <textarea
              value={justification}
              onChange={e => setJustification(e.target.value)}
              rows={3}
              className={inputCls}
              placeholder={t("mp.postpone.justificationPlaceholder")}
            />
          </div>

          {/* Compensatory measures */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.postpone.compensatoryMeasures")}</label>
            <textarea
              value={compensatoryMeasures}
              onChange={e => setCompensatoryMeasures(e.target.value)}
              rows={2}
              className={inputCls}
              placeholder={t("mp.postpone.compensatoryPlaceholder")}
            />
          </div>

          {/* AI Suggestion button */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => { void fetchAiSuggestion(); }}
              disabled={aiLoading || !justification.trim()}
              className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-xs font-semibold disabled:opacity-40 hover:bg-accent/15 transition-all"
            >
              {aiLoading ? <><Loader2 className="w-3 h-3 animate-spin inline mr-1" />{t("common.analyzing")}</> : t("mp.postpone.copilotSuggest")}
            </button>
          </div>

          {aiSuggestion && (
            <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
              <p className="text-[10px] font-bold text-accent uppercase tracking-wider mb-2">{t("mp.exec.copilotSuggestion")}</p>
              <p className="text-sm text-fg/80 whitespace-pre-wrap">{aiSuggestion}</p>
            </div>
          )}

          {/* Authorized by */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.postpone.authorizedBy")} <span className="text-text-industrial/30">{t("mp.postpone.authorizedByHint")}</span></label>
            <input
              value={authorizedBy}
              onChange={e => setAuthorizedBy(e.target.value)}
              className={inputCls}
              placeholder={t("mp.postpone.authorizedByPlaceholder")}
            />
          </div>

          {error && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
          <div className="flex gap-2">
            <button
              onClick={() => { void save(true); }}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial/70 hover:text-fg disabled:opacity-50 transition-all"
            >
              {t("mp.postpone.waitAuthorization")}
            </button>
            <button
              onClick={() => { void save(false); }}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Plan detail modal ────────────────────────────────────────────────────────

export interface MaintenancePlanModalProps {
  plan: MaintenancePlan | null;
  userId: string | null;
  userName: string;
  isAdmin: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSaved: (savedId?: string) => Promise<void>;
  setRequestMessage?: (msg: string | null) => void;
  /** Pre-fill + lock vessel/asset when creating a plan from a fixed asset context (e.g. Asset modal). */
  defaultVesselCode?: string;
  defaultAssetId?: string;
  defaultSfiGroupNumber?: number | null;
  lockAsset?: boolean;
  /** Overlay z-index class; raise it when nesting this modal over another (default z-50). */
  overlayZClass?: string;
  /**
   * El modal está montado sobre su propia ruta `/maintenance-plans/:code`, o sea
   * que ESA ruta ya es su marca en el historial. Sólo lo pasa la página de
   * planes al editar. Donde se usa sin ruta (ficha de Equipos, alta) queda en
   * false y el guard sí registra su marca, para que el botón atrás lo cierre.
   */
  deepLinked?: boolean;
}

export const MaintenancePlanModal: React.FC<MaintenancePlanModalProps> = ({ plan, userId, userName, isAdmin, canDelete, onClose, onSaved, setRequestMessage: setReqMsg, defaultVesselCode, defaultAssetId, defaultSfiGroupNumber, lockAsset, overlayZClass, deepLinked }) => {
  const t = useT();
  const woTerms = useWoTerms();
  const navigate = useNavigate();
  const isNew = plan === null;
  const readOnly = !isNew && !isAdmin;

  // OJO: estos tres arrancan CON el valor del plan, no vacíos. El efecto de más
  // abajo igual los vuelve a setear desde `plan`, pero corre después del primer
  // render — y useDirtyTracker saca su foto EN el primer render. Si acá quedaba
  // "" y el efecto lo llenaba, el plan nacía "sucio" y cerrarlo preguntaba por
  // cambios que nadie hizo. Los valores tienen que coincidir con lo que escribe
  // ese efecto (plan.X ?? ""), no con los defaults, que son sólo para el alta.
  const [vesselCode, setVesselCode] = useState(plan?.vesselCode ?? defaultVesselCode ?? "");
  const [taskCode, setTaskCode] = useState(plan?.taskCode ?? "");
  const [taskCodeAuto, setTaskCodeAuto] = useState(true);
  const [loadingCode, setLoadingCode] = useState(false);
  const [assetId, setAssetId] = useState(plan ? (plan.assetId ?? "") : (defaultAssetId ?? ""));
  const [assets, setAssets] = useState<{ id: string; assetCode: string; name: string | null }[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [vessels, setVessels] = useState<{ code: string; name: string }[]>([]);
  const [loadingVessels, setLoadingVessels] = useState(false);
  const vesselDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [taskType, setTaskType] = useState<"MAINTENANCE" | "INSPECTION">(plan?.taskType ?? "MAINTENANCE");
  const [title, setTitle] = useState(plan?.title ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [responsible, setResponsible] = useState(plan?.responsible ?? "");
  const [department, setDepartment] = useState<string>(plan?.department ?? "");
  // Lista de proveedores + aclaración (área = PROVEEDOR). Arranca con el valor del
  // plan (lista nueva, o el providerId legacy como fila de 1). Vacío = sin filas.
  // OJO: como el resto de los campos del modal, se inicializa con el valor del plan
  // para que la "foto" de useDirtyTracker no lo marque como cambio falso.
  const [providerRequests, setProviderRequests] = useState<{ providerId: string; purpose: string }[]>(() => {
    if (plan?.providerRequests && plan.providerRequests.length > 0) {
      return plan.providerRequests.map(r => ({ providerId: r.providerId, purpose: r.purpose ?? "" }));
    }
    if (plan?.providerId) return [{ providerId: plan.providerId, purpose: "" }];
    return [];
  });
  const [providers, setProviders] = useState<Array<{ id: string; name: string; providerCode: string }>>([]);
  // Repuestos/materiales previstos (se heredan a la OT). Mismo shape que la OT.
  const [plannedSpares, setPlannedSpares] = useState<WoPlannedItem[]>(() =>
    (plan?.spares ?? []).map(s => ({
      kind: s.kind, spareId: s.spareId ?? null, description: s.description,
      quantity: s.quantity ?? 1, unit: s.unit ?? "ud",
    })),
  );
  // Catálogo de repuestos del buque con stock (para el desplegable + semáforo).
  const [spareCatalog, setSpareCatalog] = useState<WoSpareOption[]>([]);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(plan?.acceptanceCriteria ?? "");
  const [loto, setLoto] = useState(plan?.loto ?? "");
  // Mismo cuidado que arriba: si hay plan manda el plan, aunque venga en nulo.
  // Los `default*` son SÓLO para el alta. Si acá se colaba el default del
  // equipo (al abrir el plan desde la ficha de un equipo) en un plan sin grupo
  // SFI, el efecto lo devolvía a null y el plan nacía "sucio".
  const [sfiGroupNumber, setSfiGroupNumber] = useState<number | null>(
    plan ? (plan.sfiGroupNumber ?? null) : (defaultSfiGroupNumber ?? null),
  );
  const [riskLevel, setRiskLevel] = useState<RiskLevel>(toUiRiskLevel(plan?.riskLevel));
  const [riskProbability, setRiskProbability] = useState<RiskProbability>(toUiRiskProbability(plan?.riskProbability));
  const [riskConsequence, setRiskConsequence] = useState<RiskConsequence>(toUiRiskConsequence(plan?.riskConsequence));
  const [riskAnalysisResult, setRiskAnalysisResult] = useState(plan?.riskAnalysisResult ?? "");
  const [consequenceCategory, setConsequenceCategory] = useState<"" | "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL">(
    (plan?.consequenceCategory as any) ?? "",
  );
  const [consequenceRationale, setConsequenceRationale] = useState(plan?.consequenceRationale ?? "");
  const [loadingConsequence, setLoadingConsequence] = useState(false);
  const [status, setStatus] = useState(plan?.status ?? "ACTIVE");
  const [triggerType, setTriggerType] = useState<TriggerType>((plan?.triggerType as TriggerType) ?? "MONTHS");
  const [frequencyMonths, setFrequencyMonths] = useState(String(plan?.frequencyMonths ?? ""));
  const [frequencyHours, setFrequencyHours] = useState(String(plan?.frequencyHours ?? ""));
  const [estimatedHours, setEstimatedHours] = useState(String(plan?.estimatedHours ?? ""));
  // Última ejecución editable por admin (el próximo vencimiento se recalcula).
  const [lastExecDate, setLastExecDate] = useState(toDateInput(plan?.lastExecutionDate ?? null));
  const [lastExecHours, setLastExecHours] = useState(String(plan?.lastExecutionHours ?? ""));
  const [triggerResultMode, setTriggerResultMode] = useState(plan?.triggerResultMode ?? "DUE_ONLY");
  const [windowMode, setWindowMode] = useState(plan?.windowMode ?? "AUTO");
  const [windowLeadDays, setWindowLeadDays] = useState(String(plan?.windowLeadDays ?? ""));
  const [checklistTemplate, setChecklistTemplate] = useState(plan?.checklistTemplate ?? "");
  // samplingKind = "" (no sampling) | "FLUID" | "VIBRATION" | "THERMAL" | "ULTRASOUND" | "OTHER"
  // Para retrocompatibilidad: si el plan tenía samplingFluidType pero no samplingKind, asumimos FLUID.
  const [samplingKind, setSamplingKind] = useState<string>(
    plan?.samplingKind ?? (plan?.samplingFluidType ? "FLUID" : "")
  );
  const [samplingFluidType, setSamplingFluidType] = useState<string>(plan?.samplingFluidType ?? "");
  const [checklistUploading, setChecklistUploading] = useState(false);
  const [checklistUploadError, setChecklistUploadError] = useState<string | null>(null);
  const [loadingCriteria, setLoadingCriteria] = useState(false);
  const [loadingLoto, setLoadingLoto] = useState(false);
  const [loadingRisk, setLoadingRisk] = useState(false);

  const [saving,      setSaving]      = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Feedback de "Guardado" + reset del dirty-tracker: al guardar, el modal NO se
  // cierra (queda abierto para seguir editando), así que mostramos confirmación
  // y reseteamos el baseline de cambios.
  const [justSaved,   setJustSaved]   = useState(false);
  const [saveResetKey, setSaveResetKey] = useState(0);
  // La ventana se abre al instante con los datos de la lista y luego se
  // "hidrata" con el detalle completo (6 campos que la lista no trae). Cuando
  // eso pasa, hay que RE-CAPTURAR el baseline de cambios: si no, esos campos
  // pasando de vacío a su valor real dispararían un falso "cambios sin guardar".
  const [planSyncKey, setPlanSyncKey] = useState(0);
  const planSyncedRef = useRef(false);
  /** Último plan volcado al formulario: distingue hidratación de cambio de plan. */
  const lastSyncedPlanIdRef = useRef<string | null>(null);
  /** Espejo de planDirty legible dentro del efecto de sync (que no lo tiene en deps). */
  const planDirtyRef = useRef(false);
  const [showExecution, setShowExecution] = useState(false);
  const [expanded,    setExpanded]    = useState(true);
  const [showPostpone, setShowPostpone] = useState(false);
  // Borrar un plan pide DOS confirmaciones: 0 = cerrado, 1 = "¿estás seguro?",
  // 2 = el aviso de que es un plan registrado, no una OT. Recién ahí se borra.
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleting,    setDeleting]    = useState(false);
  const [confirmDuplicateWO, setConfirmDuplicateWO] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showMoc, setShowMoc] = useState(false);
  // Popup interceptor: aparece al tocar Guardar cuando hay cambio de
  // periodicidad. El user elige Cancelar / Guardar sin MOC / Abrir MOC.
  const [showMocPrompt, setShowMocPrompt] = useState(false);

  // Detección de cambio en frecuencia / trigger — sugiere MOC PROCEDURE_CHANGE.
  // Modificar la frecuencia o el tipo de disparador de un plan aprobado
  // cambia el SMS / cronograma de mantenimiento; ISM 10.3 / TMSA piden
  // que ese cambio quede formalmente justificado y aprobado.
  const planChangedFrequency = !isNew && plan !== null && (
    triggerType !== (plan.triggerType as TriggerType) ||
    (frequencyMonths || "") !== String(plan.frequencyMonths ?? "") ||
    (frequencyHours  || "") !== String(plan.frequencyHours  ?? "")
  );

  useEffect(() => {
    if (!isNew) return;
    setLoadingVessels(true);
    api.get<{ items: { code: string; name: string }[] }>("/app/vessels")
      .then(res => setVessels(res.items ?? []))
      .catch(() => setVessels([]))
      .finally(() => setLoadingVessels(false));
  }, [isNew]);

  const fetchSuggestedCode = useRef(async (vc: string, sfi: number | null) => {
    if (!vc) { setTaskCode(""); return; }
    setLoadingCode(true);
    try {
      const params = new URLSearchParams({ vesselCode: vc });
      if (sfi !== null) params.set("sfiGroupNumber", String(sfi));
      const res = await api.get<{ code: string }>(`/app/pms/maintenance-plans/suggest-code?${params}`);
      setTaskCode(res.code);
    } catch { /* silent */ }
    finally { setLoadingCode(false); }
  });

  useEffect(() => {
    if (!isNew || !taskCodeAuto) return;
    void fetchSuggestedCode.current(vesselCode, sfiGroupNumber);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, vesselCode, sfiGroupNumber, taskCodeAuto]);

  useEffect(() => {
    const vc = isNew ? vesselCode : plan?.vesselCode;
    if (!vc) return;
    if (isNew && !lockAsset) { setAssetId(""); setAssets([]); }
    if (vesselDebounce.current) clearTimeout(vesselDebounce.current);
    vesselDebounce.current = setTimeout(async () => {
      setLoadingAssets(true);
      try {
        const res = await api.get<{ items: { id: string; assetCode: string; name: string | null }[] }>(
          `/app/pms/assets?vesselCode=${encodeURIComponent(vc)}&limit=200`
        );
        setAssets(res.items ?? []);
      } catch { setAssets([]); }
      finally { setLoadingAssets(false); }
    }, 400);
  }, [vesselCode, isNew, plan?.vesselCode]);

  // Proveedores del tenant, para cuando el área es PROVEEDOR.
  useEffect(() => {
    if (department !== "PROVEEDOR" || providers.length > 0) return;
    let cancelled = false;
    api.get<{ items: Array<{ id: string; name: string; providerCode: string }> }>(`/app/providers?status=ACTIVE`)
      .then(r => { if (!cancelled) setProviders(r.items ?? []); })
      .catch(() => { if (!cancelled) setProviders([]); });
    return () => { cancelled = true; };
  }, [department, providers.length]);

  // Certificado que renueva este mantenimiento (servicios tercerizados que
  // terminan en un documento del proveedor, ej. el SERVICE del AIS). El vínculo
  // se define desde /certificates; acá sólo se muestra y se ofrece renovarlo al
  // reportar la ejecución.
  const [linkedCert, setLinkedCert] = useState<RenewableCertificate | null>(null);
  const [renewAfterExec, setRenewAfterExec] = useState<string | null>(null);
  useEffect(() => {
    if (!plan?.id) { setLinkedCert(null); return; }
    let cancelled = false;
    api.get<{ items: RenewableCertificate[] }>(`/app/certificates?maintenancePlanId=${encodeURIComponent(plan.id)}`)
      .then(r => { if (!cancelled) setLinkedCert(r.items?.[0] ?? null); })
      .catch(() => { if (!cancelled) setLinkedCert(null); });
    return () => { cancelled = true; };
  }, [plan?.id]);

  // Catálogo de repuestos del buque (con stock) para la sección de repuestos previstos.
  useEffect(() => {
    const vc = (vesselCode || plan?.vesselCode || "").trim();
    if (!vc) { setSpareCatalog([]); return; }
    let cancelled = false;
    api.get<{ items: WoSpareOption[] }>(`/app/pms/spares?vesselCode=${encodeURIComponent(vc)}&status=ACTIVE`)
      .then(r => { if (!cancelled) setSpareCatalog(r.items ?? []); })
      .catch(() => { if (!cancelled) setSpareCatalog([]); });
    return () => { cancelled = true; };
  }, [vesselCode, plan?.vesselCode]);

  useEffect(() => {
    if (!plan) return;
    // La ventana abre con los datos de la lista y ~medio segundo después llega el
    // detalle completo del mismo plan ("hidratación"). Si el usuario ya empezó a
    // escribir en ese lapso, reescribir los campos le borraría lo tipeado sin
    // aviso: en ese caso salteamos la reescritura. Sólo aplica a la hidratación
    // (mismo plan); si cambia de plan, se reescribe siempre.
    const hydratingSamePlan = lastSyncedPlanIdRef.current === plan.id;
    lastSyncedPlanIdRef.current = plan.id;
    if (hydratingSamePlan && planDirtyRef.current) return;
    setAssetId(plan.assetId ?? "");
    setTaskCode(plan.taskCode ?? "");
    setTaskType(plan.taskType ?? "MAINTENANCE");
    setTitle(plan.title);
    setDescription(plan.description ?? "");
    setResponsible(plan.responsible ?? "");
    setDepartment(plan.department ?? "");
    setProviderRequests(
      plan.providerRequests && plan.providerRequests.length > 0
        ? plan.providerRequests.map(r => ({ providerId: r.providerId, purpose: r.purpose ?? "" }))
        : plan.providerId
          ? [{ providerId: plan.providerId, purpose: "" }]
          : [],
    );
    setPlannedSpares((plan.spares ?? []).map(s => ({
      kind: s.kind, spareId: s.spareId ?? null, description: s.description,
      quantity: s.quantity ?? 1, unit: s.unit ?? "ud",
    })));
    setAcceptanceCriteria(plan.acceptanceCriteria ?? "");
    setLoto(plan.loto ?? "");
    setSfiGroupNumber(plan.sfiGroupNumber ?? null);
    setRiskLevel(toUiRiskLevel(plan.riskLevel));
    setRiskProbability(toUiRiskProbability(plan.riskProbability));
    setRiskConsequence(toUiRiskConsequence(plan.riskConsequence));
    setRiskAnalysisResult(plan.riskAnalysisResult ?? "");
    setConsequenceCategory((plan.consequenceCategory as any) ?? "");
    setConsequenceRationale(plan.consequenceRationale ?? "");
    setStatus(plan.status);
    setTriggerType((plan.triggerType as TriggerType) ?? "MONTHS");
    setFrequencyMonths(String(plan.frequencyMonths ?? ""));
    setFrequencyHours(String(plan.frequencyHours ?? ""));
    setEstimatedHours(String(plan.estimatedHours ?? ""));
    setLastExecDate(toDateInput(plan.lastExecutionDate ?? null));
    setLastExecHours(String(plan.lastExecutionHours ?? ""));
    setTriggerResultMode(plan.triggerResultMode ?? "DUE_ONLY");
    setWindowMode(plan.windowMode ?? "AUTO");
    setWindowLeadDays(String(plan.windowLeadDays ?? ""));
    setChecklistTemplate(plan.checklistTemplate ?? "");
    setSamplingKind(plan.samplingKind ?? (plan.samplingFluidType ? "FLUID" : ""));
    setSamplingFluidType(plan.samplingFluidType ?? "");
    setChecklistUploading(false);
    setChecklistUploadError(null);
    setActionError(null);
    setShowExecution(false);
    setShowPostpone(false);
    // Primer sync = montaje (baseline ya capturado con los datos de la lista).
    // Los sucesivos = hidratación del detalle o cambio de plan: re-capturar el
    // baseline para que los campos recién llegados no cuenten como "cambios".
    if (planSyncedRef.current) setPlanSyncKey(k => k + 1);
    else planSyncedRef.current = true;
  }, [plan]);

  useCopilotEmitter({
    module: "MAINTENANCE_PLANS",
    screen: "MP_EDIT",
    entityId:      plan?.id       ?? null,
    entityCode:    plan?.taskCode ?? "NUEVO",
    vesselCode:    plan?.vesselCode ?? null,
    workflowStage: plan?.executionStatus ?? "NEW",
    canEdit: true,
    fieldValues: {
      title:              title              || null,
      description:        description        || null,
      responsible:        responsible        || null,
      acceptanceCriteria: acceptanceCriteria || null,
      loto:               loto               || null,
      riskLevel:          riskLevel          || null,
      riskAnalysisResult: riskAnalysisResult || null,
      triggerType:        triggerType        || null,
      frequencyMonths:    frequencyMonths    || null,
      frequencyHours:     frequencyHours     || null,
    },
  });

  useCopilotApplyFields((fields) => {
    if (fields.title              !== undefined) setTitle(fields.title);
    if (fields.description        !== undefined) setDescription(fields.description);
    if (fields.responsible        !== undefined) setResponsible(fields.responsible);
    if (fields.acceptanceCriteria !== undefined) setAcceptanceCriteria(fields.acceptanceCriteria);
    if (fields.loto               !== undefined) setLoto(fields.loto);
    if (fields.riskAnalysisResult !== undefined) setRiskAnalysisResult(fields.riskAnalysisResult);
    if (fields.riskLevel          !== undefined) setRiskLevel(toUiRiskLevel(fields.riskLevel));
    if (fields.triggerType        !== undefined && TRIGGER_TYPES.includes(fields.triggerType as TriggerType))
      setTriggerType(fields.triggerType as TriggerType);
    if (fields.frequencyMonths    !== undefined) setFrequencyMonths(fields.frequencyMonths);
    if (fields.frequencyHours     !== undefined) setFrequencyHours(fields.frequencyHours);
  });

  // Asset label resolver: works for both new and existing plans.
  // For new plans: looks up name in the assets list using current assetId.
  // For existing plans: prefers plan.assetName, falls back to assetId.
  const resolveAssetLabel = useCallback((): string | null => {
    if (plan?.assetName) return plan.assetName;
    if (assetId) {
      const found = assets.find(a => a.id === assetId);
      if (found) return found.name ?? found.assetCode ?? null;
      return assetId;
    }
    return plan?.assetId ?? null;
  }, [plan, assetId, assets]);

  const handleAcceptanceCriteriaClick = useCallback(async () => {
    if (readOnly || loadingCriteria) return;
    const prev = acceptanceCriteria;
    setLoadingCriteria(true);
    setAcceptanceCriteria(t("mp.modal.analyzing"));
    try {
      const res = await api.post<{ text: string }>("/app/pms/maintenance-plans/suggest-acceptance-criteria", {
        assetLabel: resolveAssetLabel(),
        taskDesc: description || title || null,
      });
      setAcceptanceCriteria(res.text || prev);
    } catch {
      setAcceptanceCriteria(prev);
    } finally {
      setLoadingCriteria(false);
    }
  }, [readOnly, acceptanceCriteria, description, title, loadingCriteria, resolveAssetLabel, t]);

  const handleLotoClick = useCallback(async () => {
    if (readOnly || loadingLoto) return;
    const prev = loto;
    setLoadingLoto(true);
    setLoto(t("mp.modal.analyzing"));
    try {
      const res = await api.post<{ text: string }>("/app/pms/maintenance-plans/suggest-loto", {
        assetLabel: resolveAssetLabel(),
        taskDesc: description || title || null,
        taskType,
        acceptanceCriteria: acceptanceCriteria || null,
      });
      setLoto(res.text || prev);
    } catch {
      setLoto(prev);
    } finally {
      setLoadingLoto(false);
    }
  }, [readOnly, loto, description, title, taskType, acceptanceCriteria, loadingLoto, resolveAssetLabel, t]);

  const handleRiskClick = useCallback(async () => {
    if (readOnly || loadingRisk) return;
    setLoadingRisk(true);
    try {
      const res = await api.post<{ level: string; probability: string | null; consequence: string | null; analysis: string }>("/app/pms/maintenance-plans/suggest-risk", {
        assetLabel: resolveAssetLabel(),
        taskDesc: description || title || null,
        taskType,
        acceptanceCriteria: acceptanceCriteria || null,
        loto: loto || null,
      });
      // Si la IA devolvió los dos ejes de la matriz, los cargamos y derivamos el
      // nivel desde la celda (misma fuente de verdad que el click manual). Si no,
      // caemos al nivel suelto que devuelve la IA.
      const aiProb = toUiRiskProbability(res.probability);
      const aiCons = toUiRiskConsequence(res.consequence);
      if (aiProb && aiCons) {
        setRiskProbability(aiProb);
        setRiskConsequence(aiCons);
        setRiskLevel(deriveRiskLevelFromMatrix(aiProb, aiCons));
      } else if (res.level && ["LOW","MEDIUM","HIGH","CRITICAL"].includes(res.level)) {
        setRiskLevel(res.level as RiskLevel);
      }
      if (res.analysis) setRiskAnalysisResult(res.analysis);
    } catch { /* noop */ }
    finally {
      setLoadingRisk(false);
    }
  }, [readOnly, description, title, taskType, acceptanceCriteria, loto, loadingRisk, resolveAssetLabel]);

  const handleConsequenceClick = useCallback(async () => {
    if (readOnly || loadingConsequence) return;
    setLoadingConsequence(true);
    try {
      const res = await api.post<{ category: string; rationale: string }>(
        "/app/pms/maintenance-plans/suggest-consequence",
        {
          assetName: resolveAssetLabel() ?? "",
          assetSfiCode: sfiGroupNumber != null ? `${sfiGroupNumber}00` : null,
          planTitle: title || null,
          planDescription: description || null,
          taskType,
        },
      );
      if (res.category && ["SAFETY","ENVIRONMENTAL","OPERATIONAL","NON_OPERATIONAL"].includes(res.category)) {
        setConsequenceCategory(res.category as any);
      }
      if (res.rationale) setConsequenceRationale(res.rationale);
    } catch { /* noop */ }
    finally {
      setLoadingConsequence(false);
    }
  }, [readOnly, plan, title, description, taskType, loadingConsequence, resolveAssetLabel, sfiGroupNumber]);

  const onSave = async () => {
    setSaving(true);
    setActionError(null);
    try {
      const freqMonths = needsDateFreq(triggerType) && frequencyMonths ? Number(frequencyMonths) : null;
      const freqHours  = needsHours(triggerType)   && frequencyHours  ? Number(frequencyHours)  : null;

      // Proveedores: solo cuando el área es PROVEEDOR. Se descartan filas sin
      // proveedor; providerId queda sincronizado (único → id, varios → null).
      // La aclaración es obligatoria: no se puede dejar un proveedor sin explicar
      // para qué se lo contrata (sería la descripción de una SS vacía).
      if (department === "PROVEEDOR" && providerRequests.some(r => r.providerId && !r.purpose.trim())) {
        setActionError(t("mp.providerRequests.purposeRequired"));
        setSaving(false);
        return;
      }
      const cleanProviderRequests = department === "PROVEEDOR"
        ? providerRequests.filter(r => r.providerId).map(r => ({ providerId: r.providerId, purpose: r.purpose.trim() || null }))
        : [];
      const providerFields = {
        providerRequests: cleanProviderRequests,
        providerId: cleanProviderRequests.length === 1 ? cleanProviderRequests[0]!.providerId : null,
      };
      // Repuestos/materiales previstos: se descartan las filas vacías (repuesto
      // sin elegir / material sin descripción). El backend normaliza igual.
      const cleanSpares = plannedSpares
        .filter(s => s.kind === "SPARE" ? !!s.spareId : !!s.description.trim())
        .map(s => ({
          kind: s.kind,
          spareId: s.kind === "SPARE" ? (s.spareId ?? null) : null,
          description: s.description.trim(),
          quantity: Number.isFinite(s.quantity) && s.quantity > 0 ? s.quantity : 1,
          unit: s.unit.trim() || "ud",
        }));

      let savedId: string;
      if (isNew) {
        const created = await api.post<{ id: string }>("/app/pms/maintenance-plans", {
          vesselCode: vesselCode.trim().toUpperCase(),
          assetId,
          taskCode: taskCode.trim() || undefined,
          taskType,
          title: title.trim(),
          description: normalizeOptionalText(description),
          responsible: normalizeOptionalText(responsible),
          department: (department as any) || null,
          ...providerFields,
          acceptanceCriteria: normalizeOptionalText(acceptanceCriteria),
          loto: normalizeOptionalText(loto),
          sfiGroupNumber,
          riskLevel: toUiRiskLevel(riskLevel),
          riskProbability: riskProbability || null,
          riskConsequence: riskConsequence || null,
          riskAnalysisResult: normalizeOptionalText(riskAnalysisResult),
          consequenceCategory: consequenceCategory || null,
          consequenceRationale: normalizeOptionalText(consequenceRationale),
          status,
          triggerType,
          frequencyMonths: freqMonths,
          frequencyHours: freqHours,
          estimatedHours: estimatedHours ? Number(estimatedHours) : null,
          triggerResultMode,
          windowMode,
          windowLeadDays: windowLeadDays ? Number(windowLeadDays) : null,
          checklistTemplate: normalizeOptionalText(checklistTemplate),
          samplingKind:      samplingKind || null,
          // fluidType solo se manda cuando el kind es FLUID; en otros casos null.
          samplingFluidType: samplingKind === "FLUID" ? (samplingFluidType || null) : null,
          spares: cleanSpares,
        });
        savedId = created.id;
      } else {
        await api.patch(`/app/pms/maintenance-plans/${plan.id}`, {
          ...(assetId ? { assetId } : {}),
          ...(isAdmin && taskCode.trim() && taskCode.trim() !== plan.taskCode ? { taskCode: taskCode.trim().toUpperCase() } : {}),
          taskType,
          title: title.trim(),
          description: normalizeOptionalText(description),
          responsible: normalizeOptionalText(responsible),
          department: (department as any) || null,
          ...providerFields,
          acceptanceCriteria: normalizeOptionalText(acceptanceCriteria),
          loto: normalizeOptionalText(loto),
          sfiGroupNumber,
          riskLevel: toUiRiskLevel(riskLevel),
          riskProbability: riskProbability || null,
          riskConsequence: riskConsequence || null,
          riskAnalysisResult: normalizeOptionalText(riskAnalysisResult),
          consequenceCategory: consequenceCategory || null,
          consequenceRationale: normalizeOptionalText(consequenceRationale),
          status,
          triggerType,
          frequencyMonths: freqMonths,
          frequencyHours: freqHours,
          estimatedHours: estimatedHours ? Number(estimatedHours) : null,
          triggerResultMode,
          windowMode,
          windowLeadDays: windowLeadDays ? Number(windowLeadDays) : null,
          checklistTemplate: normalizeOptionalText(checklistTemplate),
          samplingKind:      samplingKind || null,
          // fluidType solo se manda cuando el kind es FLUID; en otros casos null.
          samplingFluidType: samplingKind === "FLUID" ? (samplingFluidType || null) : null,
          // Última ejecución editable (admin). El backend recalcula el próximo
          // vencimiento desde la frecuencia. Solo lo manda el admin.
          ...(isAdmin ? {
            lastExecutionDate: needsHours(triggerType) ? undefined : (lastExecDate || null),
            lastExecutionHours: needsHours(triggerType) ? (lastExecHours ? Number(lastExecHours) : null) : undefined,
          } : {}),
          spares: cleanSpares,
        });
        savedId = plan.id;
      }
      await onSaved(savedId);
      // No cerramos el modal: queda abierto para seguir editando. Confirmamos
      // el guardado y reseteamos el baseline del dirty-tracker.
      setSaveResetKey(k => k + 1);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const canExecute = !isNew && plan.status !== "INACTIVE" && plan.status !== "DRAFT";
  const canPostpone = !isNew && plan.status !== "INACTIVE" && plan.status !== "DRAFT";
  const needsWO = !isNew && (plan.triggerResultMode === "AUTO_WO" || plan.triggerResultMode === "APPROVAL_WO");
  // "Solo Alerta": en vez de sólo registrar el resultado, se abre una OT que
  // nace AUTORIZADA. Es trabajo que se resuelve en el momento y la tramitación
  // formal sólo agregaría demora.
  const isExpressMode = !isNew && plan.triggerResultMode === "DUE_ONLY";
  const [openingExpress, setOpeningExpress] = useState(false);

  const openExpressWorkOrder = async () => {
    setOpeningExpress(true);
    setActionError(null);
    try {
      const wo = await api.post<{ workOrderCode: string }>(
        `/app/pms/maintenance-plans/${plan.id}/open-work-order`,
        { express: true, signerName: userName || null },
      );
      onSaved();
      // Se va derecho a la OT recién creada: el usuario la abrió para trabajar
      // en ella, no para quedarse en el plan.
      navigate(`/work-orders?autoCode=${encodeURIComponent(wo.workOrderCode)}`);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "No se pudo abrir la OT express.");
      setOpeningExpress(false);
    }
  };

  // ESC guard
  const planDirty = useDirtyTracker({
    vesselCode, taskCode, assetId, taskType, title, description, responsible, department, providerRequests,
    acceptanceCriteria, loto, sfiGroupNumber,
    riskLevel, riskProbability, riskConsequence, riskAnalysisResult, status, triggerType,
    frequencyMonths, frequencyHours, triggerResultMode,
    windowMode, windowLeadDays,
    checklistTemplate, samplingFluidType,
    lastExecDate, lastExecHours, plannedSpares,
  }, `${saveResetKey}:${planSyncKey}`);
  planDirtyRef.current = planDirty;
  const requestClose = useEscapeGuard({
    enabled: !readOnly && !showExecution && !showPostpone && deleteStep === 0 && !confirmDuplicateWO,
    isDirty: planDirty,
    onSave,
    onClose,
    // Con ruta propia, ESA ruta es la marca de historial: registrar otra dejaba
    // dos marcas iguales y el cierre caía en la copia. Sin ruta (alta, o el modal
    // abierto desde Equipos) sí se registra, para que el botón atrás lo cierre.
    skipHistory: !!deepLinked,
  });

  async function downloadPdf() {
    if (!plan || isNew) return;
    const token = localStorage.getItem("gpms_token");
    const slug  = localStorage.getItem("gpms_tenant_slug");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (slug)  headers["X-Tenant-Slug"] = slug;
    const res = await fetch(`/app/pms/maintenance-plans/${plan.id}/pdf`, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      alert(`Error ${res.status}: ${text.slice(0, 300) || t("error.pdfFailed")}`);
      return;
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${plan.taskCode ?? plan.id}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function downloadPdfLegacy() {
    if (!plan || isNew) return;
    const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString("es-AR") : "—";
    const v = (x: unknown) => String(x ?? "").trim() || "—";
    const triggerLbl = (t: string) => ({ CALENDAR: "Meses (calendario)", MONTHS: "Meses (calendario)", HOURS: "Horas de operación", RUNNING_HOURS: "Horas de operación" }[t.toUpperCase()] ?? t);
    const resultLbl = (r: string) => ({ DUE_ONLY: "Solo vencimiento", AUTO_WO: `${woTerms.abbr} automática`, APPROVAL_WO: `${woTerms.abbr} con aprobación`, CHECKLIST: "Completar Checklist", EXPRESS: "Mantenimiento Express" }[r] ?? r);
    const statusLbl = (s: string) => ({ ACTIVE: "Activo", INACTIVE: "Inactivo", OVERDUE: "Vencido", DUE_SOON: "Por vencer" }[s] ?? s);
    const taskTypeLbl = (t: string) => ({ MAINTENANCE: "Mantenimiento", INSPECTION: "Inspección" }[t] ?? t);
    const riskLbl = (r: string) => ({ LOW: "BAJO", MEDIUM: "MEDIO", HIGH: "ALTO", CRITICAL: "CRÍTICO" }[r] ?? r.toUpperCase());
    const riskColor = (r: string) => ({ LOW: "#16a34a", MEDIUM: "#d97706", HIGH: "#ea580c", CRITICAL: "#dc2626" }[r] ?? "#0f172a");

    // Matriz de riesgo (probabilidad × consecuencia) como HTML, resaltando la
    // celda del plan. Misma grilla/colores que el PDF del servidor y la UI.
    const probLbl: Record<string, string> = { LIKELY: "Muy probable", PROBABLE: "Probable", UNLIKELY: "Improbable", RARE: "Altamente improbable" };
    const consLbl: Record<string, string> = { FATALITY: "Fatalidad", MAJOR: "Lesiones importantes", MINOR: "Lesiones leves", NEGLIGIBLE: "Lesiones insignificantes" };
    const cellColor: Record<"H" | "M" | "B", string> = { H: "#dc2626", M: "#f59e0b", B: "#16a34a" };
    const cellText: Record<"H" | "M" | "B", string> = { H: "Alto", M: "Medio", B: "Bajo" };
    function riskMatrixHtml(): string {
      if (!riskProbability || !riskConsequence) return "";
      const headCells = RISK_PROBS.map(pb =>
        `<th style="background:#1e3a5f;color:#fff;font-size:7pt;padding:5px 3px;border:1px solid #fff;text-align:center">${probLbl[pb]}</th>`
      ).join("");
      const rows = RISK_CONS.map(cs => {
        const cells = RISK_PROBS.map(pb => {
          const lvl = RISK_GRID[cs][pb];
          const sel = pb === riskProbability && cs === riskConsequence;
          const border = sel ? "3px solid #0f172a" : "1px solid #fff";
          return `<td style="background:${cellColor[lvl]};color:#fff;font-weight:bold;font-size:9pt;text-align:center;padding:8px 3px;border:${border}">${cellText[lvl]}</td>`;
        }).join("");
        return `<tr><td style="background:#e2e8f0;font-weight:bold;font-size:7pt;text-align:center;padding:6px 3px;border:1px solid #fff">${consLbl[cs]}</td>${cells}</tr>`;
      }).join("");
      return `
        <div style="font-size:7pt;font-weight:bold;color:#64748b;text-transform:uppercase;text-align:center;margin:2px 0">Probabilidad</div>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed">
          <tr><th style="background:#0f2744;color:#fff;font-size:7pt;padding:5px 3px;border:1px solid #fff;width:22%">Consecuencia</th>${headCells}</tr>
          ${rows}
        </table>`;
    }

    function bold(text: string): string {
      return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    }

    function renderText(raw: string | null | undefined): string {
      if (!raw?.trim()) return "—";
      const lines = raw.replace(/ð/g, "").split("\n");
      const out: string[] = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        if (line.includes("|")) {
          // Collect contiguous pipe lines as a table block
          const block: string[] = [];
          while (i < lines.length && lines[i].includes("|")) {
            block.push(lines[i]);
            i++;
          }
          // Filter out separator rows (|---|)
          const rows = block
            .filter(l => !/^\s*\|[\s|:-]+\|\s*$/.test(l))
            .map(l => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(c => bold(c.trim())));
          if (rows.length === 0) continue;
          let table = '<table class="md-table">';
          rows.forEach((cells, ri) => {
            const tag = ri === 0 ? "th" : "td";
            table += `<tr>${cells.map(c => `<${tag}>${c || "&nbsp;"}</${tag}>`).join("")}</tr>`;
          });
          table += "</table>";
          out.push(table);
        } else {
          const txt = line.trim();
          out.push(txt ? `<p>${bold(txt)}</p>` : "<br/>");
          i++;
        }
      }
      return out.join("");
    }

    const gen = new Date().toLocaleString("es-AR");
    const assetDisplay = v(plan.assetName ?? assets.find(a => a.id === plan.assetId)?.name ?? plan.assetId);

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>${v(plan.taskCode)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  @page{size:A4;margin:1cm}
  @page{@bottom-right{content:"Página " counter(page);font-size:7.5pt;color:#94a3b8;font-family:Arial,sans-serif}}
  html,body{width:100%;font-family:Arial,sans-serif;font-size:10pt;color:#1a1a2e}
  /* ── Outer table: thead/tfoot repeat on every printed page ── */
  table.page-wrap{width:100%;border-collapse:collapse}
  table.page-wrap>thead>tr>td{padding-bottom:4px;border-bottom:1.5px solid #0f2744}
  table.page-wrap>tfoot>tr>td{padding-top:4px;border-top:1px solid #cbd5e1}
  .ph{display:flex;justify-content:space-between;align-items:center;font-size:8pt}
  .ph-l{font-weight:bold;color:#0f2744;letter-spacing:0.4px}
  .ph-r{color:#64748b}
  .pf{font-size:7.5pt;color:#94a3b8}
  /* ── Content ── */
  .content{padding:8px 0}
  h1{font-size:18pt;color:#0f2744;margin-bottom:2px}
  .sub{font-size:9pt;color:#64748b;margin-bottom:10px}
  hr{border:none;border-top:2px solid #0f2744;margin:8px 0 12px}
  .section-title{background:#0f2744;color:#fff;font-size:8pt;font-weight:bold;
    letter-spacing:1px;padding:4px 10px;margin:10px 0 0;text-transform:uppercase;
    break-after:avoid}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #cbd5e1;border-top:none}
  .cell{padding:6px 10px;border-right:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1;background:#f8fafc}
  .cell:last-child{border-right:none}
  .cell-label{font-size:7pt;font-weight:bold;color:#64748b;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:3px}
  .cell-full .cell-label{font-size:11.2pt;color:#ffffff;background-color:#0f172a;display:block;padding:4px 10px;margin:0 -10px 8px;letter-spacing:0.5px}
  .cell-value{font-size:10pt;font-weight:bold;color:#0f172a}
  .cell-full{grid-column:1/-1;border-right:none;padding-top:14px}
  .red{color:#b91c1c}.blue{color:#1d4ed8}
  .sig-row{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #cbd5e1;border-top:none;margin-top:20px;break-inside:avoid}
  .sig-cell{padding:8px 10px 28px;border-right:1px solid #cbd5e1;background:#f8fafc}
  .sig-cell:last-child{border-right:none}
  .sig-line{border-top:1px solid #aaa;margin-top:20px}
  .md-table{width:100%;border-collapse:collapse;font-size:9pt;margin:4px 0}
  .md-table th{background:#e2e8f0;font-weight:bold;text-align:left;padding:4px 8px;border:1px solid #cbd5e1}
  .md-table td{padding:4px 8px;border:1px solid #cbd5e1;vertical-align:top}
  .md-table tr:nth-child(even) td{background:#f8fafc}
  p{margin:2px 0;font-size:9.5pt}
</style></head><body>
<table class="page-wrap">
  <thead><tr><td>
    <div class="ph">
      <span class="ph-l" style="display:flex;align-items:center;gap:7px"><img src="/logo.png" style="width:16px;height:16px;object-fit:contain" />PLAN DE MANTENIMIENTO — CMS3.0</span>
      <span class="ph-r">${v(plan.taskCode)} · ${v(plan.vesselCode)}</span>
    </div>
  </td></tr></thead>
  <tfoot><tr><td>
    <div class="pf">
      <span style="display:flex;align-items:center;gap:6px"><img src="/logo.png" style="width:14px;height:14px;object-fit:contain" />Generado: ${gen}</span>
      <span>${v(plan.taskCode)} · ${v(plan.vesselCode)}</span>
    </div>
  </td></tr></tfoot>
  <tbody><tr><td>
    <div class="content">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="display:flex;align-items:center;gap:14px">
          <img src="/logo.png" style="width:60px;height:60px;object-fit:contain;flex-shrink:0" />
          <div>
            <h1>${t("mp.pdf.title")}</h1>
            <div class="sub">Copilot Management System</div>
          </div>
        </div>
        <div style="text-align:right;font-size:9pt;color:#64748b">
          <div style="font-size:7pt">${t("mp.pdf.code")}</div>
          <div style="font-size:13pt;font-weight:bold;color:#0f2744">${v(plan.taskCode)}</div>
          <div style="font-size:7pt;margin-top:4px">${t("mp.pdf.generated")} ${gen}</div>
        </div>
      </div>
      <hr/>

      <div class="section-title">${t("mp.pdf.identification")}</div>
      <div class="grid">
        <div class="cell"><div class="cell-label">${t("mp.pdf.vessel")}</div><div class="cell-value blue">${v(plan.vesselCode)}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.pdf.asset")}</div><div class="cell-value">${assetDisplay}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.pdf.status")}</div><div class="cell-value">${statusLbl(plan.status ?? "")}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.pdf.taskCode")}</div><div class="cell-value">${v(plan.taskCode)}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.pdf.sfiGroup")}</div><div class="cell-value">${plan.sfiGroupNumber != null ? `${plan.sfiGroupNumber} - ${t(`sfi.g.${plan.sfiGroupNumber}` as Parameters<typeof t>[0])}` : "—"}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.pdf.taskType")}</div><div class="cell-value">${taskTypeLbl(plan.taskType)}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.pdf.responsible")}</div><div class="cell-value">${v(responsible)}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.department")}</div><div class="cell-value">${v(
          department
            ? (department === "PROVEEDOR"
                ? `${t(`wo.dept.PROVEEDOR` as Parameters<typeof t>[0])} — ${providerRequests.map(r => providers.find(p => p.id === r.providerId)?.name ?? plan.providerRequests?.find(pr => pr.providerId === r.providerId)?.providerName ?? "").filter(Boolean).join(", ") || plan.providerName || ""}`.trim().replace(/—\s*$/, "").trim()
                : t(`wo.dept.${department}` as Parameters<typeof t>[0]))
            : "",
        )}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.pdf.criticality")}</div><div class="cell-value">${v(plan.criticality)}</div></div>
      </div>

      <div class="section-title">${t("mp.pdf.planFreq")}</div>
      <div class="grid">
        <div class="cell"><div class="cell-label">${t("mp.pdf.triggerType")}</div><div class="cell-value">${triggerLbl(plan.triggerType)}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.pdf.freqMonths")}</div><div class="cell-value">${plan.frequencyMonths != null ? `${plan.frequencyMonths} ${t("mp.pdf.months")}` : "—"}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.pdf.freqHours")}</div><div class="cell-value">${plan.frequencyHours != null ? `${plan.frequencyHours} h` : "—"}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.pdf.lastExec")}</div><div class="cell-value">${fmtDate(plan.lastExecutionDate)}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.pdf.nextDue")}</div><div class="cell-value red">${fmtDate(plan.nextDueDate)}</div></div>
        <div class="cell"><div class="cell-label">${t("mp.pdf.resultMode")}</div><div class="cell-value">${resultLbl(plan.triggerResultMode ?? "")}</div></div>
      </div>

      <div class="section-title">${t("mp.pdf.tasksToDo")}</div>
      <div class="grid">
        <div class="cell cell-full"><div class="cell-label">${t("mp.pdf.title2")}</div><div class="cell-value">${v(title)}</div></div>
        <div class="cell cell-full"><div class="cell-label">${t("mp.pdf.tasksDesc")}</div><div class="cell-value" style="font-weight:normal">${renderText(description)}</div></div>
        ${acceptanceCriteria ? `<div class="cell cell-full"><div class="cell-label">${t("mp.pdf.acceptCriteria")}</div><div class="cell-value" style="font-weight:normal">${renderText(acceptanceCriteria)}</div></div>` : ""}
        ${loto ? `<div class="cell cell-full"><div class="cell-label">${t("mp.pdf.evidenceLoto")}</div><div class="cell-value" style="font-weight:normal">${renderText(loto)}</div></div>` : ""}
        ${riskProbability && riskConsequence
          ? `<div class="cell cell-full"><div class="cell-label">${t("mp.pdf.riskAnalysis")}</div>${riskMatrixHtml()}</div>`
          : riskLevel ? `<div class="cell cell-full"><div class="cell-label">${t("mp.pdf.riskLevel")}</div><div class="cell-value" style="font-size:13pt;color:${riskColor(riskLevel)}">${riskLbl(riskLevel)}</div></div>` : ""}
        ${riskAnalysisResult ? `<div class="cell cell-full"><div class="cell-label">${t("mp.pdf.riskAnalysis")}</div><div class="cell-value" style="font-weight:normal">${renderText(riskAnalysisResult)}</div></div>` : ""}
      </div>

      <div class="sig-row">
        <div class="sig-cell"><div class="cell-label">${t("mp.pdf.respExec")}</div><div class="sig-line"></div></div>
        <div class="sig-cell"><div class="cell-label">${t("mp.pdf.supervisor")}</div><div class="sig-line"></div></div>
        <div class="sig-cell"><div class="cell-label">${t("mp.pdf.verifiedBy")}</div><div class="sig-line"></div></div>
      </div>
    </div>
  </td></tr></tbody>
</table>
</body></html>`;

    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) { alert(t("error.popupBlocked")); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }

  return (
    <>
      <div className={`fixed inset-0 ${overlayZClass ?? "z-50"} flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm`}>
        <div className={`w-full bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl flex flex-col transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-2xl max-h-[90vh]"}`} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
            <div>
              <h2 className="text-base font-bold text-fg">
                {isNew ? t("mp.newPlan") : t("page.maintenancePlans")}
              </h2>
              {/* Ir a la OT NO cierra antes el plan: cerrar ahora significa
                  "volver atrás", y hacerlo justo antes de navegar dejaba dos
                  navegaciones peleando. Basta con navegar — el cambio de ruta
                  desmonta este modal, y al cerrar la OT se vuelve acá. */}
              {!isNew && <StatusBadgeInline plan={plan} onOpenWo={(code) => navigate(`/work-orders?autoCode=${code}`)} />}
              {/* Este servicio termina en un certificado del proveedor. Sólo
                  informativo: el vínculo se administra desde /certificates. */}
              {!isNew && linkedCert && (
                <button
                  type="button"
                  onClick={() => navigate("/certificates")}
                  title="Al reportar la ejecución se ofrece renovar este certificado"
                  className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-[10px] font-bold text-accent hover:bg-accent/20 transition-colors"
                >
                  <FileText className="w-3 h-3" /> Renueva {linkedCert.certificateCode}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {!isNew && <CopyLinkButton />}
              <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-text-industrial/30 hover:text-fg hover:bg-fg/5 transition-colors" title={expanded ? t("common.minimize") : t("common.maximize")}>
                {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <ModalCloseButton onClose={requestClose} />
            </div>
          </div>

          {readOnly && (
            <div className="mx-6 mt-3 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-700 dark:text-yellow-400">
              {t("mp.modal.readOnly")}
            </div>
          )}
          <fieldset disabled={readOnly} className="p-6 space-y-4 flex-1 min-h-0 overflow-y-auto disabled:opacity-70">

            {/* Read-only identifiers (edit mode) */}
            {!isNew && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">{t("mp.taskCode")}</p>
                    {isAdmin
                      ? <input
                          value={taskCode}
                          onChange={e => setTaskCode(e.target.value.toUpperCase())}
                          className="w-full bg-transparent border-b border-fg/20 focus:border-accent/60 outline-none text-sm font-mono font-bold text-fg py-0.5 transition-colors"
                        />
                      : <p className="text-sm font-mono font-bold text-fg">{plan.taskCode}</p>
                    }
                  </div>
                  <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.vessel")}</p>
                    <p className="text-sm"><VesselLabel code={plan.vesselCode} className="text-sm" showCode /></p>
                  </div>
                </div>
                {/* Last / Next execution info. El ADMIN puede editar la última
                    ejecución; el próximo vencimiento se calcula solo desde la
                    frecuencia (preview en vivo; el backend lo confirma al guardar). */}
                {(() => {
                  const preview = previewNextDue(triggerType, lastExecDate, lastExecHours, frequencyMonths, frequencyHours);
                  return (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("mp.modal.lastExecution")}</p>
                    {isAdmin ? (
                      needsHours(triggerType) ? (
                        <input
                          type="number" value={lastExecHours}
                          onChange={e => setLastExecHours(e.target.value)}
                          placeholder="Horas"
                          className="w-full bg-transparent border-b border-fg/20 focus:border-accent/60 outline-none text-sm font-mono text-fg py-0.5 transition-colors"
                        />
                      ) : (
                        <input
                          type="date" value={lastExecDate}
                          onChange={e => setLastExecDate(e.target.value)}
                          className="w-full bg-transparent border-b border-fg/20 focus:border-accent/60 outline-none text-sm font-mono text-fg py-0.5 transition-colors"
                        />
                      )
                    ) : (
                      <p className="text-sm text-fg font-mono">
                        {needsHours(plan.triggerType)
                          ? (plan.lastExecutionHours != null ? `${plan.lastExecutionHours.toLocaleString()}h` : "—")
                          : (fmtDate(plan.lastExecutionDate) ?? "—")}
                      </p>
                    )}
                  </div>
                  <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("mp.modal.nextDueDate")}</p>
                    <p className="text-sm font-mono text-accent">
                      {isAdmin
                        ? (preview?.text ?? (needsHours(plan.triggerType)
                            ? (plan.nextDueHours != null ? `${plan.nextDueHours.toLocaleString()}h` : "—")
                            : (fmtDate(plan.nextDueDate) ?? "—")))
                        : (needsHours(plan.triggerType)
                            ? (plan.nextDueHours != null ? `${plan.nextDueHours.toLocaleString()}h` : "—")
                            : (fmtDate(plan.nextDueDate) ?? "—"))}
                    </p>
                    {isAdmin && preview && (
                      <p className="text-[9px] text-text-industrial/40 mt-0.5">{t("mp.modal.nextDueAuto")}</p>
                    )}
                  </div>
                </div>
                  );
                })()}
                <div className="space-y-1.5">
                  {assetId
                    ? <button
                        type="button"
                        onClick={() => { onClose(); navigate(`/assets?open=${encodeURIComponent(assetId)}`); }}
                        className={`${labelCls} hover:text-accent transition-colors cursor-pointer`}
                        title={t("mp.modal.openAsset")}
                      >{t("mp.asset")}</button>
                    : <label className={labelCls}>{t("mp.asset")}</label>}
                  {loadingAssets
                    ? <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("mp.modal.loadingAssets")}</div>
                    : <AssetSearchDropdown assets={assets} value={assetId} onChange={setAssetId} />
                  }
                </div>
              </>
            )}

            {/* Create-only identifiers */}
            {isNew && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className={labelCls}>{t("mp.vesselCode")}</label>
                    {loadingVessels
                      ? <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}</div>
                      : <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={lockAsset} className={`${selectCls} disabled:opacity-60`}>
                          <option value="">{t("mp.modal.selectVessel")}</option>
                          {vessels.map(v => <option key={v.code} value={v.code}>{v.code}{v.name ? ` — ${v.name}` : ""}</option>)}
                        </select>
                    }
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className={labelCls}>{t("mp.taskCode")}</label>
                      {taskCodeAuto && taskCode && <span className="text-[9px] text-accent/60 font-mono uppercase tracking-wider">{t("mp.modal.codeAuto")}</span>}
                    </div>
                    <div className="relative">
                      <input
                        value={loadingCode ? "" : taskCode}
                        onChange={e => { setTaskCode(e.target.value.toUpperCase()); setTaskCodeAuto(false); }}
                        placeholder={loadingCode ? t("mp.modal.codeGenerating") : t("mp.modal.codePlaceholder")}
                        className={`${inputCls} pr-8 ${taskCodeAuto && taskCode ? "text-accent/80 font-mono" : ""}`}
                      />
                      {loadingCode && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-accent/50 animate-spin" />}
                      {!loadingCode && !taskCodeAuto && vesselCode && (
                        <button type="button" onClick={() => setTaskCodeAuto(true)} title={t("mp.modal.regenerateCode")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-industrial/30 hover:text-accent transition-colors">↺</button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>{t("mp.asset")}</label>
                  {loadingAssets
                    ? <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("mp.modal.loadingAssets")}</div>
                    : <AssetSearchDropdown
                        assets={assets}
                        value={assetId}
                        onChange={setAssetId}
                        disabled={lockAsset || !vesselCode || assets.length === 0}
                        placeholder={!vesselCode ? t("mp.modal.selectVesselFirst") : assets.length === 0 ? t("mp.modal.noAssetsForVessel") : t("mp.selectAsset")}
                      />
                  }
                </div>
              </>
            )}

            {/* Task type */}
            <div className="space-y-1.5">
              <label className={labelCls}>{t("mp.taskType")}</label>
              <div className="flex gap-2">
                {(["MAINTENANCE", "INSPECTION"] as const).map(tt => (
                  <button key={tt} type="button" onClick={() => setTaskType(tt)}
                    className={`flex-1 py-2 rounded-xl border text-xs font-bold transition-all ${
                      taskType === tt
                        ? "bg-accent/15 border-accent/50 text-accent"
                        : "bg-fg/5 border-fg/10 text-text-industrial/50 hover:border-fg/20 hover:text-fg"
                    }`}>
                    {t(`mp.taskType.${tt}` as any)}
                  </button>
                ))}
              </div>
            </div>

            {/* SFI */}
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.sfiGroup")}</label>
                <select value={sfiGroupNumber === null ? "" : String(sfiGroupNumber)}
                  onChange={e => setSfiGroupNumber(e.target.value ? Number(e.target.value) : null)}
                  className={selectCls}>
                  <option value="">{t("mp.selectSfiGroup")}</option>
                  {SFI_GROUP_NUMBERS.map(g => <option key={g} value={g}>{g} - {t(`sfi.g.${g}` as Parameters<typeof t>[0])}</option>)}
                </select>
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className={labelCls}>{t("col.title")}</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
            </div>

            {/* ── Recuadro: TAREAS A REALIZAR ── (tarea + programación) */}
            <div className={sectionCardCls}>
              <p className={sectionTitleCls}>{t("mp.modal.tasksToPerform")}</p>

              {/* Description (el título del recuadro ya oficia de rótulo) */}
              <div className="space-y-1.5">
              <RichTextArea value={description} onChange={setDescription} rows={3} className={inputCls} />
            </div>

            {/* Trigger + Frequency + Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.triggerType")}</label>
                <select value={triggerType} onChange={e => setTriggerType(e.target.value as TriggerType)} className={selectCls}>
                  {TRIGGER_TYPES.map(tt => <option key={tt} value={tt}>{t(`mp.tt.${tt}` as any)}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>
                  {needsHours(triggerType) ? t("mp.frequencyHours") : needsDays(triggerType) ? t("mp.frequencyDays") : needsWeeks(triggerType) ? t("mp.frequencyWeeks") : t("mp.frequencyMonths")}
                </label>
                {needsHours(triggerType)
                  ? <input type="number" min="1" value={frequencyHours} onChange={e => setFrequencyHours(e.target.value)} className={inputCls} />
                  : <input type="number" min="1" value={frequencyMonths} onChange={e => setFrequencyMonths(e.target.value)} className={inputCls} disabled={triggerType === "CONDITION" || triggerType === "EVENT"} />
                }
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.triggerResultMode")}</label>
                <select value={triggerResultMode} onChange={e => setTriggerResultMode(e.target.value)} className={selectCls}>
                  {TRIGGER_RESULT_MODES.map(m => <option key={m} value={m}>{t(`mp.trm.${m}` as any)}</option>)}
                </select>
              </div>
            </div>

            {/* Horas estimadas para ejecutar la tarea */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.estimatedHours")}</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={estimatedHours}
                  onChange={e => setEstimatedHours(e.target.value)}
                  placeholder="—"
                  className={inputCls}
                  disabled={readOnly}
                />
              </div>
            </div>

            {/* Ventana de ejecución anticipada */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.modal.windowMode")}</label>
                <select value={windowMode} onChange={e => { setWindowMode(e.target.value); if (e.target.value === "AUTO") setWindowLeadDays(""); }} className={selectCls} disabled={readOnly}>
                  <option value="AUTO">{t("mp.modal.windowAuto")}</option>
                  <option value="MANUAL">{t("mp.modal.windowManual")}</option>
                </select>
              </div>
              {/* En AUTO los días los calcula el sistema: el campo no se muestra
                  (antes quedaba visible pero deshabilitado, ocupando lugar y
                  haciendo dudar si había que completarlo). La explicación de
                  cómo se calcula queda junto al selector de modo. */}
              {windowMode === "AUTO" ? (
                <p className="text-[10px] text-text-industrial/40 self-end pb-2">{t("mp.modal.leadDaysHint")}</p>
              ) : (
                <div className="space-y-1.5">
                  <label className={labelCls}>{t("mp.modal.leadDays")}</label>
                  <input
                    type="number" min="0" value={windowLeadDays}
                    onChange={e => setWindowLeadDays(e.target.value)}
                    placeholder={t("mp.modal.leadDaysManualPlaceholder")}
                    disabled={readOnly}
                    className={inputCls}
                  />
                </div>
              )}
            </div>
            </div>{/* ── fin recuadro TAREAS A REALIZAR ── */}

            {/* ── Recuadro: PLAN DE MUESTREO ── */}
            <div className={sectionCardCls}>
              <p className={sectionTitleCls}>
                {t("mp.modal.samplingLabel")} <span className="text-text-industrial/40 normal-case font-normal">{t("mp.modal.optional")}</span>
              </p>
            {/* Plan de muestreo — kind primero; si es FLUID, segundo select con el sub-tipo. */}
            <div className="space-y-1.5">
              <select
                value={samplingKind}
                onChange={e => {
                  const v = e.target.value;
                  setSamplingKind(v);
                  // Al salir de FLUID, limpiar el sub-tipo (no aplica).
                  if (v !== "FLUID") setSamplingFluidType("");
                }}
                className={selectCls}
                disabled={readOnly}
              >
                <option value="">{t("mp.modal.notSamplingPlan")}</option>
                <option value="FLUID">{t("sampling.kind.fluid")}</option>
                <option value="VIBRATION">{t("sampling.kind.vibration")}</option>
                <option value="THERMAL">{t("sampling.kind.thermal")}</option>
                <option value="ULTRASOUND">{t("sampling.kind.ultrasound")}</option>
                <option value="OTHER">{t("sampling.kind.other")}</option>
              </select>
              {samplingKind === "FLUID" && (
                <select value={samplingFluidType} onChange={e => setSamplingFluidType(e.target.value)} className={selectCls} disabled={readOnly}>
                  <option value="">{t("mp.modal.selectFluidType")}</option>
                  <option value="ENGINE_OIL">{t("fluid.plan.engineOil")}</option>
                  <option value="HYDRAULIC_OIL">{t("fluid.plan.hydraulic")}</option>
                  <option value="GEARBOX_OIL">{t("fluid.plan.gearbox")}</option>
                  <option value="TRANSMISSION_OIL">{t("fluid.plan.transmission")}</option>
                  <option value="FUEL_DIESEL">{t("fluid.plan.diesel")}</option>
                  <option value="FUEL_GASOIL">{t("fluid.plan.gasoil")}</option>
                  <option value="COOLING_WATER">{t("fluid.plan.coolingWater")}</option>
                  <option value="BOILER_WATER">{t("fluid.plan.boilerWater")}</option>
                  <option value="POTABLE_WATER">{t("fluid.plan.potableWater")}</option>
                  <option value="REFRIGERANT">{t("fluid.plan.refrigerant")}</option>
                  <option value="OTHER">{t("fluid.plan.other")}</option>
                </select>
              )}
              {samplingKind && (
                <p className="text-[10px] text-accent/70">{t("mp.modal.samplingHint")}</p>
              )}
            </div>
            </div>{/* ── fin recuadro PLAN DE MUESTREO ── */}

            {/* ── Recuadro: ÁREA / RESPONSABLE ── */}
            <div className={sectionCardCls}>
              <p className={sectionTitleCls}>{t("mp.department")}</p>
            {/* Área / responsable */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-2">
                {(["CUBIERTA", "MAQUINAS", "BARCAZA", "PROVEEDOR", "OTROS"] as const).map(d => (
                  <button key={d} type="button"
                    onClick={() => { const next = department === d ? "" : d; setDepartment(next); if (next !== "PROVEEDOR") setProviderRequests([]); }}
                    className={`px-2 py-1 rounded text-xs font-bold border transition-colors ${
                      department === d
                        ? "bg-accent text-accent-fg border-accent"
                        : "bg-fg/5 text-text-industrial/60 border-fg/10 hover:border-accent/40"
                    }`}
                  >{t(`wo.dept.${d}`)}</button>
                ))}
              </div>
              {/* Varios proveedores + aclaración. Al abrir la OT se crea una SS por
                  fila. La aclaración es obligatoria (se valida al guardar). Un mismo
                  proveedor puede repetirse (dos trabajos distintos = dos SS). */}
              {department === "PROVEEDOR" && (
                <div className="space-y-2 mt-1">
                  {providerRequests.map((row, i) => (
                    <div key={i} className="flex items-start gap-2">
                      {/* Grilla proveedor + aclaración: cada uno ocupa media fila y
                          nunca desborda el modal (min-w-0). En pantalla angosta se
                          apilan. La X queda aparte, sin robar ancho. */}
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
                        <select
                          value={row.providerId}
                          onChange={e => setProviderRequests(prev => prev.map((r, j) => j === i ? { ...r, providerId: e.target.value } : r))}
                          className={selectCls}
                        >
                          <option value="">{t("wo.modal.providerSelect")}</option>
                          {providers.map(p => (
                            <option key={p.id} value={p.id}>{p.name}{p.providerCode ? ` (${p.providerCode})` : ""}</option>
                          ))}
                        </select>
                        <input
                          value={row.purpose}
                          onChange={e => setProviderRequests(prev => prev.map((r, j) => j === i ? { ...r, purpose: e.target.value } : r))}
                          placeholder={t("mp.providerRequests.purposePlaceholder")}
                          className={inputCls}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setProviderRequests(prev => prev.filter((_, j) => j !== i))}
                        title={t("mp.providerRequests.remove")}
                        className="shrink-0 mt-1 w-7 h-7 flex items-center justify-center rounded-lg text-text-industrial/40 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setProviderRequests(prev => [...prev, { providerId: "", purpose: "" }])}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-fg/5 border border-fg/10 text-xs font-bold text-text-industrial/70 hover:border-accent/40 hover:text-fg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> {t("mp.providerRequests.add")}
                  </button>
                </div>
              )}
            </div>
            </div>{/* ── fin recuadro ÁREA / RESPONSABLE ── */}

            {/* ── Recuadro: REPUESTOS / MATERIALES PREVISTOS ──
                Los repuestos salen del catálogo /Spares (con stock); los materiales
                van a mano. Al abrir la OT se heredan. Es planificación: NO descuenta stock. */}
            <div className={sectionCardCls}>
              <div className="space-y-0.5">
                <p className={sectionTitleCls}>{t("mp.spares.title")}</p>
                <p className="text-[11px] text-text-industrial/50">{t("mp.spares.hint")}</p>
              </div>
              <PlannedItemsEditor
                items={plannedSpares}
                onChange={setPlannedSpares}
                spares={spareCatalog}
                disabled={readOnly}
              />
            </div>

            {/* Responsible + Status */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.responsible")}</label>
                <input value={responsible} onChange={e => setResponsible(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>{t("col.status")}</label>
                <select value={status} onChange={e => setStatus(e.target.value)} className={selectCls}>
                  {EDITABLE_STATUSES.map(item => <option key={item} value={item}>{t(`mp.status.${item}` as any)}</option>)}
                </select>
              </div>
            </div>

            {/* Acceptance criteria */}
            <div className="space-y-1.5">
              <label
                onClick={readOnly ? undefined : handleAcceptanceCriteriaClick}
                title={readOnly ? undefined : t("mp.modal.aiCriteriaTooltip")}
                className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  readOnly
                    ? "text-text-industrial/60 cursor-default"
                    : `text-accent hover:text-fg cursor-pointer ${loadingCriteria ? "opacity-60 animate-pulse" : ""}`
                }`}
              >
                {!readOnly && (loadingCriteria ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />)}
                {t("mp.acceptanceCriteria")}
              </label>
              <RichTextArea value={acceptanceCriteria} onChange={setAcceptanceCriteria} rows={2} className={inputCls} disabled={loadingCriteria} />
            </div>

            {/* LOTO */}
            <div className="space-y-1.5">
              <label
                onClick={readOnly ? undefined : handleLotoClick}
                title={readOnly ? undefined : t("wo.ai.lotoTooltip")}
                className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  readOnly
                    ? "text-text-industrial/60 cursor-default"
                    : `text-accent hover:text-fg cursor-pointer ${loadingLoto ? "opacity-60 animate-pulse" : ""}`
                }`}
              >
                {!readOnly && (loadingLoto ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />)}
                {t("mp.loto")}
              </label>
              <RichTextArea value={loto} onChange={setLoto} rows={2} className={inputCls} disabled={loadingLoto} />
            </div>

            {/* Nivel de riesgo + matriz + resultado (componente compartido con Diferimientos) */}
            <RiskMatrix
              probability={riskProbability}
              consequence={riskConsequence}
              level={riskLevel}
              result={riskAnalysisResult}
              readOnly={readOnly}
              loading={loadingRisk}
              onSelect={(p, c, lvl) => { setRiskProbability(p); setRiskConsequence(c); setRiskLevel(lvl); }}
              onResultChange={setRiskAnalysisResult}
              onSuggest={handleRiskClick}
            />

            {/* RCM consequence — "si esta tarea no se hace, ¿qué pasa?" */}
            <div className="space-y-1.5">
              <label
                onClick={readOnly ? undefined : handleConsequenceClick}
                title={readOnly ? undefined : t("wo.modal.consequenceTooltip")}
                className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  readOnly
                    ? "text-text-industrial/60 cursor-default"
                    : `text-accent hover:text-fg cursor-pointer ${loadingConsequence ? "opacity-60 animate-pulse" : ""}`
                }`}
              >
                {!readOnly && (loadingConsequence ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />)}
                {t("wo.modal.consequenceTitle")}
                <span className="text-[10px] normal-case font-normal text-text-industrial/50 ml-1">{t("wo.modal.consequenceHint")}</span>
              </label>
              <select
                value={consequenceCategory}
                onChange={e => setConsequenceCategory(e.target.value as any)}
                disabled={readOnly || loadingConsequence}
                className={inputCls}
              >
                <option value="">{t("wo.modal.consequenceUnclassified")}</option>
                <option value="SAFETY">{t("wo.modal.consequence.safety")}</option>
                <option value="ENVIRONMENTAL">{t("wo.modal.consequence.environmental")}</option>
                <option value="OPERATIONAL">{t("wo.modal.consequence.operational")}</option>
                <option value="NON_OPERATIONAL">{t("wo.modal.consequence.nonOperational")}</option>
              </select>
              <RichTextArea
                value={consequenceRationale}
                onChange={setConsequenceRationale}
                rows={2}
                className={inputCls}
                disabled={readOnly || loadingConsequence}
              />
            </div>

            {/* Checklist upload — CHECKLIST mode only */}
            {triggerResultMode === "CHECKLIST" && (
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.checklistTemplate")}</label>
                <div className="rounded-xl border border-fg/10 bg-fg/5 p-4 space-y-3">
                  {checklistTemplate && (checklistTemplate.startsWith("/uploads/") || checklistTemplate.startsWith("/app/files/")) ? (
                    <div className="flex items-center justify-between gap-3">
                      <button type="button"
                        onClick={() => { void downloadAuthedFile(checklistTemplate); }}
                        className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 hover:text-green-300 truncate"
                        title="Descargar plantilla">
                        <ClipboardList className="w-4 h-4 shrink-0" />
                        <span className="truncate">{checklistTemplate.split("/").pop()}</span>
                      </button>
                      <button type="button" onClick={() => setChecklistTemplate("")} className="text-text-industrial/40 hover:text-red-400 transition-colors shrink-0"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <p className="text-xs text-text-industrial/40">{t("mp.checklistNoFile")}</p>
                  )}
                  {isNew ? (
                    <p className="text-[10px] text-yellow-700 dark:text-yellow-400/70">{t("mp.modal.checklistSaveFirst")}</p>
                  ) : (
                    <label className={`flex items-center gap-2 cursor-pointer w-fit px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                      checklistUploading ? "border-fg/10 text-text-industrial/40 cursor-not-allowed" : "border-green-500/30 text-green-700 dark:text-green-400 hover:bg-green-500/10"
                    }`}>
                      {checklistUploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("mp.checklistUploading")}</> : <><FileSpreadsheet className="w-3.5 h-3.5" /> {t("mp.checklistUpload")}</>}
                      <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt" className="sr-only"
                        disabled={checklistUploading || isNew}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !plan) return;
                          e.target.value = "";
                          setChecklistUploading(true);
                          setChecklistUploadError(null);
                          try {
                            const res = await api.upload(`/app/pms/maintenance-plans/${plan.id}/upload-checklist`, file);
                            setChecklistTemplate((res as { url: string }).url);
                          } catch (err) {
                            setChecklistUploadError(err instanceof ApiError ? err.message : t("common.saveError"));
                          } finally {
                            setChecklistUploading(false);
                          }
                        }}
                      />
                    </label>
                  )}
                  {checklistUploadError && <p className="text-xs text-red-700 dark:text-red-400">{checklistUploadError}</p>}
                </div>
              </div>
            )}

            {/* Los avisos de este formulario van en una ventanita con OK
                (ver AlertDialog al final del modal): al pie del formulario
                quedaban fuera de la vista y parecía que el botón no hacía nada. */}
          </fieldset>

          {/* Footer — always shows Reportar Ejecución + Postergar for active plans */}
          <div className="flex justify-between gap-2 px-6 py-4 border-t border-fg/10 bg-surface dark:bg-[#0D1B2A] shrink-0">
            <div className="flex gap-2">
              {/* Delete button — only ADMIN or FLEET_SUPERINTENDENT, existing plans only */}
              {!isNew && canDelete && (
                <button
                  onClick={() => setDeleteStep(1)}
                  className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 font-bold text-xs hover:bg-red-500/20 transition-all flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> {t("mp.modal.delete")}
                </button>
              )}
              {canExecute && needsWO && !(plan.activeWorkOrderCode && plan.executionStatus === "IN_WINDOW") && (
                <button
                  onClick={() => plan.activeWorkOrderCode ? setConfirmDuplicateWO(true) : setShowExecution(true)}
                  className="px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent font-bold text-xs hover:bg-accent/15 transition-all"
                >
                  <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> {t("mp.modal.openWO")}</span>
                </button>
              )}
              {/* Solo Alerta → OT Express (nace autorizada). El resto de los
                  modos sin OT formal sigue con "Reportar Resultado". */}
              {canExecute && isExpressMode && (
                <button
                  onClick={() => { void openExpressWorkOrder(); }}
                  disabled={openingExpress}
                  title="Abre una OT ya autorizada, sin pasar por aprobación ni autorización"
                  className="px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent font-bold text-xs hover:bg-accent/15 disabled:opacity-50 transition-all"
                >
                  <span className="flex items-center gap-1.5">
                    {openingExpress ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    {t("mp.modal.openExpressWO").replace("{abbr}", woTerms.abbr)}
                  </span>
                </button>
              )}
              {canExecute && !needsWO && !isExpressMode && (
                <button
                  onClick={() => setShowExecution(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-bold text-xs hover:bg-emerald-500/15 transition-all"
                >
                  {t("mp.modal.reportResult")}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {!isNew && (
                <button
                  onClick={() => setShowHistory(true)}
                  className="px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:text-fg hover:border-fg/20 transition-all flex items-center gap-1.5"
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  {t("mp.modal.history")}
                </button>
              )}
              {!isNew && (
                <button
                  onClick={downloadPdf}
                  className="px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:text-fg hover:border-fg/20 transition-all flex items-center gap-1.5"
                  title={t("mp.modal.pdfTooltip")}
                >
                  <FileText className="w-3.5 h-3.5" />
                  PDF
                </button>
              )}
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">
                {readOnly ? t("mp.modal.close") : t("common.cancel")}
              </button>
              {!readOnly && (
                <button
                  onClick={() => {
                    // Interceptor: si cambió la periodicidad, mostramos el popup
                    // de MOC antes de guardar. El user decide guardar igual o
                    // abrir MOC primero.
                    if (planChangedFrequency) setShowMocPrompt(true);
                    else void onSave();
                  }}
                  disabled={saving}
                  className={`px-4 py-2 rounded-xl font-bold text-xs disabled:opacity-50 transition-all flex items-center gap-1.5 ${justSaved ? "bg-green-600 text-white" : "bg-accent text-accent-fg hover:brightness-110"}`}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : justSaved ? <><CheckCircle2 className="w-4 h-4" />{t("mp.modal.saved")}</> : t("common.save")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmDuplicateWO && plan.activeWorkOrderCode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-yellow-500/30 rounded-2xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-yellow-700 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-fg">{t("mp.modal.duplicateWoTitle")}</p>
                <p className="text-xs text-text-industrial/70 mt-1">
                  {t("mp.modal.duplicateWoText")}{" "}
                  <span className="font-mono font-bold text-yellow-700 dark:text-yellow-400">#{plan.activeWorkOrderCode}</span>.
                  <br />{t("mp.modal.duplicateWoConfirm")}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmDuplicateWO(false)}
                className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => { setConfirmDuplicateWO(false); setShowExecution(true); }}
                className="px-4 py-2 rounded-xl bg-yellow-500/15 border border-yellow-500/30 text-yellow-700 dark:text-yellow-400 font-bold text-xs hover:bg-yellow-500/25 transition-all"
              >
                {t("mp.modal.openWoAnyway")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!isNew && showExecution && needsWO && (
        <CreateWorkOrderModal
          prefill={{
            source: "plan",
            sourceId: plan.id,
            sourceCode: plan.taskCode,
            sourceLabel: t("mp.modal.maintenancePlanLabel"),
            vesselCode: plan.vesselCode,
            assetId: plan.assetId,
            assetName: plan.assetName,
            type: plan.taskType === "INSPECTION" ? "INSPECTION" : "PREVENTIVE",
            title: plan.title,
            description: description || plan.description,
            dueDate: plan.nextDueDate,
            acceptanceCriteria: acceptanceCriteria || plan.acceptanceCriteria,
            responsible: responsible || plan.responsible,
            loto: loto || plan.loto,
            riskLevel: riskLevel || plan.riskLevel,
            riskAnalysisResult: riskAnalysisResult || plan.riskAnalysisResult,
            consequenceCategory: (consequenceCategory as ("SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | "")) || plan.consequenceCategory || null,
            consequenceRationale: consequenceRationale || plan.consequenceRationale,
            estimatedHours: estimatedHours ? Number(estimatedHours) : plan.estimatedHours,
            checklistDocUrl: plan.checklistTemplate,
            samplingFluidType: samplingFluidType || plan.samplingFluidType,
          }}
          onClose={() => setShowExecution(false)}
          onSaved={_woId => { setShowExecution(false); void onSaved(); onClose(); }}
        />
      )}
      {!isNew && showExecution && !needsWO && (
        <ExecutionModal
          plan={plan}
          userName={userName}
          userId={userId}
          isAdmin={isAdmin}
          onClose={() => setShowExecution(false)}
          // Si este mantenimiento renueva un certificado, se ofrece cargarlo con
          // la fecha del trabajo. Nunca se toca solo: lo confirma el usuario con
          // el documento del proveedor a la vista.
          onSuccess={(completedAt) => {
            setShowExecution(false);
            void onSaved();
            if (linkedCert) setRenewAfterExec(completedAt ?? new Date().toISOString().slice(0, 10));
          }}
        />
      )}

      {renewAfterExec && linkedCert && (
        <CertificateRenewalDialog
          cert={linkedCert}
          defaultIssueDate={renewAfterExec}
          maintenancePlanId={plan?.id ?? null}
          onClose={() => setRenewAfterExec(null)}
          onRenewed={() => { setRenewAfterExec(null); void onSaved(); }}
        />
      )}
      {!isNew && showPostpone && (
        <PostponeModal
          plan={plan}
          onClose={() => setShowPostpone(false)}
          onSuccess={() => { setShowPostpone(false); void onSaved(); }}
        />
      )}
      {!isNew && showHistory && plan !== null && (
        <PlanHistoryModal
          plan={plan}
          isAdmin={isAdmin}
          onClose={() => setShowHistory(false)}
          onEdited={() => { void onSaved(plan.id); }}
        />
      )}

      {/* Popup interceptor pre-save cuando se detecta cambio de frecuencia.
        * Aparece cuando el user toca "Guardar". Tres opciones:
        *   1. Cancelar — vuelve al form, no guarda nada
        *   2. Guardar sin MOC — procede al save normal (registra la decisión)
        *   3. Abrir MOC primero — abre el MocModal con prefill, el user
        *      después puede volver a guardar el plan */}
      {showMocPrompt && !isNew && plan !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-xl bg-surface dark:bg-[#0D1B2A] border border-yellow-500/40 rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-yellow-700 dark:text-yellow-300" />
              <h2 className="text-sm font-bold text-fg">¿Gestionar MOC para este cambio?</h2>
            </div>
            <p className="text-sm text-text-industrial leading-relaxed">
              Estás modificando la <strong className="text-fg">periodicidad</strong> del plan
              <strong className="text-fg"> {plan.taskCode}</strong>. Cambiar el cronograma de un
              plan aprobado afecta el SMS del buque.
            </p>
            <p className="text-xs text-text-industrial/70 leading-relaxed">
              <strong>ISM 10.3 / TMSA element 7</strong> piden que este cambio se gestione mediante
              un <strong>MOC (PROCEDURE_CHANGE)</strong> formal — con análisis de riesgo, aprobación
              de Gerencia Técnica y revisión post-implementación.
            </p>
            <div className="rounded-lg bg-yellow-500/[0.08] border border-yellow-500/30 px-3 py-2 text-[11px] text-yellow-200/90 leading-relaxed">
              <strong>Recomendado</strong>: abrir el MOC primero, esperar la aprobación,
              y después guardar el cambio al plan. Así la trazabilidad queda limpia para auditoría.
            </div>
            <div className="flex justify-end gap-2 pt-1 flex-wrap">
              <button
                onClick={() => setShowMocPrompt(false)}
                className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setShowMocPrompt(false);
                  void onSave();
                }}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-fg/5 border border-fg/10 text-text-industrial text-xs hover:bg-fg/10 disabled:opacity-50"
                title="Guarda el cambio sin abrir MOC. Asumí la responsabilidad del cambio sin trazabilidad formal."
              >
                Guardar sin MOC
              </button>
              <button
                onClick={() => {
                  setShowMocPrompt(false);
                  setShowMoc(true);
                }}
                className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 flex items-center gap-1.5"
              >
                <GitBranch className="w-3.5 h-3.5" /> Abrir MOC primero
              </button>
            </div>
          </div>
        </div>
      )}

      {showMoc && !isNew && plan !== null && (() => {
        // Resumimos qué cambió para que la IA / el user vean el delta.
        const oldFreq = plan.frequencyMonths != null
          ? `${plan.frequencyMonths} meses`
          : (plan.frequencyHours != null ? `${plan.frequencyHours} h` : "—");
        const newFreq = frequencyMonths
          ? `${frequencyMonths} meses`
          : (frequencyHours ? `${frequencyHours} h` : "—");
        const oldTrigger = plan.triggerType ?? "—";
        const newTrigger = triggerType ?? "—";
        const triggerChanged = oldTrigger !== newTrigger;
        const freqChanged = oldFreq !== newFreq;
        const prefill: MocPrefill = {
          category: "PROCEDURE_CHANGE",
          vesselCode: plan.vesselCode,
          title: `Cambio de periodicidad en plan ${plan.taskCode} — ${plan.title}`,
          reasonForChange: "Modificación del cronograma de mantenimiento aprobado. Justificar el motivo del cambio (recomendación del fabricante, observación de auditoría, ajuste por experiencia operativa, etc.).",
          proposedChange: [
            triggerChanged ? `Tipo de disparador: ${oldTrigger} → ${newTrigger}` : null,
            freqChanged    ? `Frecuencia: ${oldFreq} → ${newFreq}`              : null,
            `Plan afectado: ${plan.taskCode} (${plan.title})`,
            plan.assetName ? `Activo: ${plan.assetName}` : null,
          ].filter(Boolean).join("\n"),
          mitigationActions: "Comunicar el cambio a la tripulación. Programar primera ejecución con la nueva frecuencia. Revisar a los 6 meses si la nueva periodicidad es adecuada.",
          sourceLabel: `Desde Plan de mantenimiento ${plan.taskCode}. El MOC formaliza el cambio de cronograma para auditoría ISM 10.3 / TMSA. Recordá guardar el plan después de aprobar el MOC.`,
        };
        return (
          <MocModal
            moc={null}
            prefill={prefill}
            onClose={() => setShowMoc(false)}
            onSaved={() => { setShowMoc(false); }}
          />
        );
      })()}

      {deleteStep > 0 && !isNew && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-surface dark:bg-[#0D1B2A] border border-red-500/30 rounded-2xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0">
                {deleteStep === 1
                  ? <Trash2 className="w-4 h-4 text-red-700 dark:text-red-400" />
                  : <AlertTriangle className="w-4 h-4 text-red-700 dark:text-red-400" />}
              </div>
              <div>
                <p className="text-sm font-bold text-fg">
                  {deleteStep === 1
                    ? t("mp.modal.deleteTitle")
                    : t("mp.modal.deleteTitle2").replace("{wo}", woTerms.abbr)}
                </p>
                <p className="text-xs text-text-industrial/70 mt-1">
                  {deleteStep === 1 ? (
                    <>
                      {t("mp.modal.deleteText1")}{" "}
                      <span className="font-mono font-bold text-fg">{plan.taskCode}</span> {t("mp.modal.deleteText2")}
                    </>
                  ) : (
                    t("mp.modal.deleteText3")
                  )}
                </p>
              </div>
            </div>
            {actionError && <p className="text-xs text-red-700 dark:text-red-400">{actionError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => { setDeleteStep(0); setActionError(null); }}
                className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors"
              >
                {t("common.cancel")}
              </button>
              {deleteStep === 1 ? (
                <button
                  onClick={() => setDeleteStep(2)}
                  className="px-4 py-2 rounded-xl bg-red-600 text-fg font-bold text-xs hover:brightness-110 transition-all"
                >
                  {t("mp.modal.deleteStep1Confirm")}
                </button>
              ) : (
                <button
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    setActionError(null);
                    try {
                      await api.delete(`/app/pms/maintenance-plans/${plan.id}`);
                      setDeleteStep(0);
                      await onSaved();
                      onClose();
                    } catch (err) {
                      setActionError(err instanceof Error ? err.message : t("mp.modal.deleteError"));
                      setDeleting(false);
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-red-600 text-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  {t("mp.modal.deleteConfirm")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Avisos del formulario (validaciones, errores al guardar o al abrir la
          OT) en una ventanita con OK. Durante el borrado NO: ese diálogo ya
          muestra su propio mensaje adentro y se duplicaría. */}
      {actionError && deleteStep === 0 && (
        <AlertDialog message={actionError} onClose={() => setActionError(null)} />
      )}
    </>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const MaintenancePlansPage: React.FC<{ lockedResultMode?: string }> = ({ lockedResultMode }) => {
  const t = useT();
  const { user } = useAuth();
  const can = useCan();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const statusFilter        = (searchParams.get("status")          ?? "").trim();
  const vesselFilter        = (searchParams.get("vesselCode")      ?? "").trim();
  const executionFilter     = (searchParams.get("executionStatus") ?? "").trim();
  // Filtro por semana (desde el gráfico de carga): weekStart = lunes UTC de la semana clickeada;
  // weeks = misma ventana del gráfico. Trae del backend los IDs de planes con ocurrencia en esa
  // semana (incluye recurrencias y planes por horas) para que coincida 1:1 con la curva.
  const weekStartFilter     = (searchParams.get("weekStart")       ?? "").trim();
  const weeksParamFilter    = (searchParams.get("weeks")           ?? "52").trim();
  // Toggle "VENCIDOS / PRÓX. 7 DÍAS". Vive en la URL — igual que el resto de los
  // filtros de esta pantalla — para poder mandar el link ya filtrado:
  //   /maintenance-plans?overdue=1   (alias: ?venc=1)
  // Combina con los demás params: ?vesselCode=M02&overdue=1 filtra ambas cosas.
  // La búsqueda de la clave es INSENSIBLE A MAYÚSCULAS a propósito: estos links
  // se escriben a mano y se mandan por chat, y `?Venc=1` tiene que funcionar
  // igual que `?venc=1` (URLSearchParams.get sí distingue mayúsculas).
  const OVERDUE_KEYS = ["overdue", "venc"];
  const overdueKeysPresent = [...searchParams.keys()].filter(k => OVERDUE_KEYS.includes(k.toLowerCase()));
  const overdueParam = (overdueKeysPresent.length ? (searchParams.get(overdueKeysPresent[0]!) ?? "") : "").trim().toLowerCase();
  const overdueOnly  = overdueParam === "1" || overdueParam === "true" || overdueParam === "si";

  const [sfiTab,        setSfiTab]        = useState<SfiTab>("ALL");
  const [dueXlsxBusy,   setDueXlsxBusy]   = useState(false);
  const [searchText, setSearchText] = useState("");
  const [editing,       setEditing]       = useState<MaintenancePlan | null>(null);
  const [showModal,     setShowModal]     = useState(false);
  // `close` no se usa: el cierre del plan es determinista (ver onClose del modal).
  const { code: linkCode, open: openLink } = useDeepLink("/maintenance-plans");
  // "Número de turno" de apertura. La ventana se abre al instante con la fila y
  // el detalle completo llega por un fetch de fondo; si para cuando ese fetch
  // vuelve el turno ya cambió (cerraste, o abriste otro plan), su resultado se
  // descarta. Sin esto, un detalle que vuelve tarde reabría/pisaba la ventana.
  const openTokenRef = useRef(0);

  useCopilotEmitter(!editing && !showModal ? { module: "MAINTENANCE_PLANS", screen: "MP_LIST" } : null);
  const { setRequestMessage: setRequestMessageFromContext } = useCopilotScreenContext();
  const [showExcel,     setShowExcel]     = useState(false);
  const [gridView,      setGridView]      = useState(false);
  const [showMatrix,    setShowMatrix]    = useState(false);
  // Agrupar la lista por equipo (default ON) + estado de grupos colapsados.
  const [groupByEquipment, setGroupByEquipment] = useState(true);
  const [collapsedGroups,  setCollapsedGroups]  = useState<Set<string>>(new Set());
  const [executing,     setExecuting]     = useState<MaintenancePlan | null>(null);
  const [reporting,     setReporting]     = useState<MaintenancePlan | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [pageError,     setPageError]     = useState<string | null>(null);

  const updateFilters = (next: { status?: string; vesselCode?: string; executionStatus?: string }) => {
    const params = new URLSearchParams(searchParams);
    const ns = next.status          !== undefined ? next.status          : statusFilter;
    const nv = next.vesselCode      !== undefined ? next.vesselCode      : vesselFilter;
    const ne = next.executionStatus !== undefined ? next.executionStatus : executionFilter;
    if (ns) params.set("status", ns); else params.delete("status");
    if (nv) params.set("vesselCode", nv); else params.delete("vesselCode");
    if (ne) params.set("executionStatus", ne); else params.delete("executionStatus");
    setSearchParams(params, { replace: true });
  };

  const setOverdueOnly = (on: boolean) => {
    const params = new URLSearchParams(searchParams);
    // Al apagar hay que borrar CUALQUIER variante que haya venido en el link
    // (?venc, ?Venc, ?OVERDUE…), si no el filtro se vuelve a encender solo.
    for (const k of overdueKeysPresent) params.delete(k);
    if (on) params.set("overdue", "1");
    setSearchParams(params, { replace: true });
  };

  const clearWeekFilter = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("weekStart");
    params.delete("weeks");
    setSearchParams(params, { replace: true });
  };

  // IDs de planes con ocurrencia en la semana seleccionada (proyección del backend).
  const [weekPlanIds, setWeekPlanIds] = useState<Set<string> | null>(null);
  const [weekPlanIdsLoading, setWeekPlanIdsLoading] = useState(false);
  useEffect(() => {
    if (!weekStartFilter) { setWeekPlanIds(null); return; }
    let cancelled = false;
    setWeekPlanIdsLoading(true);
    api.get<{ weekPlanIds?: string[] }>(
      `/app/dashboard/maintenance-workload?weeks=${encodeURIComponent(weeksParamFilter)}&detailWeek=${encodeURIComponent(weekStartFilter)}`,
    )
      .then(res => { if (!cancelled) setWeekPlanIds(new Set(res.weekPlanIds ?? [])); })
      .catch(() => { if (!cancelled) setWeekPlanIds(new Set()); })
      .finally(() => { if (!cancelled) setWeekPlanIdsLoading(false); });
    return () => { cancelled = true; };
  }, [weekStartFilter, weeksParamFilter]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (vesselFilter) params.set("vesselCode", vesselFilter);
    const query = params.toString();
    return `/app/pms/maintenance-plans${query ? `?${query}` : ""}`;
  }, [statusFilter, vesselFilter]);

  const { data: rawData, loading, error, reload } = useFetch<ListResponse>(path, [path]);

  // Equipos fuera de servicio, para marcarlos en la lista: un plan sobre una
  // máquina parada se lee distinto (no es lo mismo "vencida" en un equipo en
  // uso que en uno fuera de servicio). Se piden SÓLO los OUT_OF_SERVICE — son
  // pocos — en vez de traer el catálogo entero de activos.
  const { data: oosAssetsData } = useFetch<{ items: Array<{ id: string }> }>(
    "/app/pms/assets?status=OUT_OF_SERVICE",
    [],
  );
  const oosAssetIds = useMemo(
    () => new Set((oosAssetsData?.items ?? []).map(a => a.id)),
    [oosAssetsData],
  );
  // Vista "Mantenimiento Express": acota TODO (tabla + contadores) a los planes
  // del modo bloqueado. Si no hay lockedResultMode, es la lista normal completa.
  const baseItems = useMemo(() => {
    const all = rawData?.items ?? [];
    return lockedResultMode ? all.filter(p => p.triggerResultMode === lockedResultMode) : all;
  }, [rawData, lockedResultMode]);
  // Reuse VesselContext (already loaded for the header selector) to avoid a duplicate /app/vessels fetch.
  const { vessels, selectedVesselCode } = useVesselContext();
  const vesselNameMap = useMemo(() => new Map(vessels.map(v => [v.code, v.name])), [vessels]);

  // ── Client-side filters: SFI tab + overdue toggle + SFI text ──────────────
  const data = useMemo(() => {
    if (!rawData) return null;
    let items = baseItems;

    if (sfiTab !== "ALL") {
      items = items.filter(p => sfiTabOf(p.sfiGroupNumber) === sfiTab);
    }
    if (executionFilter) {
      items = items.filter(p => computeStatus(p) === executionFilter);
    } else if (overdueOnly) {
      items = items.filter(p => { const s = computeStatus(p); return s === "OVERDUE" || s === "DUE" || s === "IN_WINDOW"; });
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      items = items.filter(p =>
        (p.vesselCode ?? "").toLowerCase().includes(q) ||
        (p.taskCode ?? "").toLowerCase().includes(q) ||
        (p.title ?? "").toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.responsible ?? "").toLowerCase().includes(q) ||
        String(p.sfiGroupNumber ?? "").includes(q) ||
        (p.assetName ?? "").toLowerCase().includes(q)
      );
    }
    // Filtro por semana: planes con ocurrencia proyectada esa semana (IDs del backend).
    // Mientras carga (weekPlanIds == null), no mostramos nada para evitar un flash de todos.
    if (weekStartFilter) {
      items = weekPlanIds ? items.filter(p => weekPlanIds.has(p.id)) : [];
    }
    return { items, total: items.length };
  }, [rawData, baseItems, sfiTab, overdueOnly, searchText, weekStartFilter, weekPlanIds]);

  // ── Counts per SFI tab (from raw data, before SFI filter) ─────────────────
  const sfiTabCounts = useMemo(() => {
    if (!rawData) return {} as Record<string, number>;
    const counts: Record<string, number> = { ALL: baseItems.length };
    for (const p of baseItems) {
      const k = String(sfiTabOf(p.sfiGroupNumber));
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [rawData, baseItems]);

  // ── Count of overdue/due/in_window for the toggle badge ───────────────────
  const urgentCount = useMemo(() => {
    if (!rawData) return 0;
    return baseItems.filter(p => {
      const s = computeStatus(p);
      return s === "OVERDUE" || s === "DUE" || s === "IN_WINDOW";
    }).length;
  }, [rawData, baseItems]);

  // `prefetched` = el registro que ya vino en la lista. La lista trae casi todo
  // el plan (repuestos, proveedores, riesgo, etc.), así que abrimos la ventana
  // AL INSTANTE con esos datos y sólo completamos en segundo plano los 6 campos
  // que la lista no incluye (criterios, checklist, LOTO, riesgo-texto…). Sin
  // esto, abrir esperaba ~0,5s de red (el ida y vuelta del detalle) con la
  // ventana en blanco. El modal re-captura su baseline de cambios al hidratar.
  const openEdit = async (row: Pick<MaintenancePlan, "id">, prefetched?: MaintenancePlan) => {
    const myToken = ++openTokenRef.current; // este es el turno vigente
    if (prefetched) { setEditing(prefetched); setShowModal(true); }
    else setLoadingDetailId(row.id);
    setPageError(null);
    try {
      const detail = await api.get<MaintenancePlan>(`/app/pms/maintenance-plans/${row.id}`);
      // Si mientras cargaba el detalle se cerró o se abrió otro plan, este
      // resultado ya no corresponde: descartarlo (no reabrir ni pisar).
      if (openTokenRef.current !== myToken) return;
      setEditing(detail);
      setShowModal(true);
    } catch (err) {
      // Con datos precargados la ventana ya está abierta y usable: el detalle es
      // sólo un complemento, así que un fallo de red no la cierra ni molesta.
      if (!prefetched && openTokenRef.current === myToken) {
        setPageError(err instanceof ApiError ? err.message : t("mp.page.detailLoadError"));
      }
    } finally {
      if (openTokenRef.current === myToken) setLoadingDetailId(null);
    }
  };

  /**
   * Abrir un plan desde una fila de cualquier vista de lista.
   *
   * Clickear una fila SÓLO cambiaba la URL, confiando en que el resolver
   * reaccionara. Si la URL ya apuntaba a ese plan (estado inconsistente: ficha
   * cerrada pero código todavía en la URL), navegar no cambia nada, el resolver
   * no corre y el click no hacía NADA — el "hago click y no abre". Y como
   * clickear OTRO plan sí cambia la URL, ése abría: de ahí que pareciera
   * aleatorio.
   *
   * Ahora, si la URL ya apunta a este plan, lo abrimos directo sin depender de
   * la navegación. Es también la red de seguridad para cualquier futura
   * desincronización entre la URL y la ficha.
   */
  const openFromRow = (row: MaintenancePlan) => {
    if (linkCode === row.taskCode) { void openEdit(row, row); return; }
    openLink(row.taskCode, { replace: window.location.pathname.startsWith("/maintenance-plans/") });
  };

  // Compat: `?openId=` (por id, ej. desde Bitácora) → resuelve el taskCode y
  // redirige a la ruta deep-link `/maintenance-plans/:code`.
  useEffect(() => {
    const openId = searchParams.get("openId");
    if (!openId) return;
    const params = new URLSearchParams(searchParams);
    params.delete("openId");
    setSearchParams(params, { replace: true });
    api.get<MaintenancePlan>(`/app/pms/maintenance-plans/${openId}`)
      // `replace`: el ?openId= es un puente, no un destino. Si quedara en el
      // historial, cerrar el plan volvería a él y el plan se reabriría solo.
      .then(d => openLink(d.taskCode, { replace: true }))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link: la URL `/maintenance-plans/:code` es la fuente de verdad del detalle.
  useEffect(() => {
    // Sin :code en la URL = cerrado. Bumpeamos el turno para invalidar cualquier
    // detalle en vuelo (que si no reabriría la ventana al volver tarde).
    if (!linkCode) { if (editing) { openTokenRef.current++; setShowModal(false); setEditing(null); } return; }
    // Auto-curación: si el plan de la URL ya está cargado pero la ventana quedó
    // oculta (estado "abierto pero invisible" por alguna carrera), volvemos a
    // mostrarla en vez de salir en silencio — ese silencio era el "hago click y
    // no abre". No agregamos showModal a las dependencias a propósito: este
    // efecto no corre al cerrar (cerrar no toca linkCode/rawData/editing), así
    // que esto no pelea con el cierre.
    if (editing?.taskCode === linkCode) { if (!showModal) setShowModal(true); return; }
    const inList = rawData?.items?.find(p => p.taskCode === linkCode);
    if (inList) { void openEdit(inList, inList); return; } // abre al instante con la fila ya cargada
    // Fuera de los filtros actuales → buscar sin filtro por código.
    setLoadingDetailId("deeplink");
    api.get<{ items: MaintenancePlan[] }>(`/app/pms/maintenance-plans`)
      .then(r => {
        const m = r.items.find(p => p.taskCode === linkCode);
        if (m) return openEdit(m, m); // la fila de la búsqueda ya trae casi todo → abrir ya
      })
      .catch(() => {})
      .finally(() => setLoadingDetailId(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkCode, rawData, editing]);

  const userName = user?.name ?? user?.email ?? "";
  const isAdmin = can("plan.manage");
  const woTerms = useWoTerms(); // abreviatura de OT del tenant, para el botón Express

  // Reutilizables por la tabla normal y la planilla Excel (evita duplicar lógica).
  const statusValue = useCallback((row: MaintenancePlan) => computeStatus(row), []);
  const renderStatus = useCallback((row: MaintenancePlan) => (
    <StatusBadgeInline plan={row} onOpenWo={(code) => navigate(`/work-orders?autoCode=${code}`)} />
  ), [navigate]);

  /**
   * UNA SOLA OT PARA VARIOS ÍTEMS DEL PDM. Una parada de astillero cubre varios
   * planes a la vez ("ITEM DEL PDM: 1.7 / 1.8 / 1.9 …"). Se marcan acá y se abre
   * una única orden: el PRIMERO marcado es el plan principal (da equipo y datos
   * heredados) y el resto se suman. Todos avanzan al cerrar la OT.
   *
   * Se guarda como lista (no Set) porque el orden importa: define cuál es el
   * principal y en qué orden salen los ítems en el papel.
   */
  const [bundleIds, setBundleIds] = useState<string[]>([]);
  const bundlePlans = useMemo(
    () => bundleIds.map(id => (data?.items ?? []).find(p => p.id === id)).filter((p): p is MaintenancePlan => !!p),
    [bundleIds, data],
  );
  // Una OT es de UN buque: una vez marcado el primero, el resto queda acotado.
  const bundleVessel = bundlePlans[0]?.vesselCode ?? null;
  const toggleBundle = useCallback((row: MaintenancePlan) => {
    setBundleIds(prev => prev.includes(row.id) ? prev.filter(id => id !== row.id) : [...prev, row.id]);
  }, []);

  const [expressRowId, setExpressRowId] = useState<string | null>(null);
  const openExpressFromRow = useCallback(async (row: MaintenancePlan) => {
    setExpressRowId(row.id);
    setPageError(null);
    try {
      const wo = await api.post<{ workOrderCode: string }>(
        `/app/pms/maintenance-plans/${row.id}/open-work-order`,
        { express: true, signerName: userName || null },
      );
      reload();
      navigate(`/work-orders?autoCode=${encodeURIComponent(wo.workOrderCode)}`);
    } catch (e) {
      setPageError(e instanceof ApiError ? e.message : "No se pudo abrir la OT express.");
    } finally {
      setExpressRowId(null);
    }
  }, [userName, reload, navigate]);

  const renderActions = useCallback((row: MaintenancePlan) => {
    if (row.status === "INACTIVE" || row.status === "DRAFT") return null;
    const needsWO = row.triggerResultMode === "AUTO_WO" || row.triggerResultMode === "APPROVAL_WO";
    const hasActiveWo = !!row.activeWorkOrderCode && row.executionStatus === "IN_WINDOW";
    // "Solo Alerta" → OT Express en vez de Reportar, igual que en el detalle.
    if (row.triggerResultMode === "DUE_ONLY") {
      const busy = expressRowId === row.id;
      return (
        <button
          onClick={e => { e.stopPropagation(); void openExpressFromRow(row); }}
          disabled={busy}
          title="Abre una OT ya autorizada, sin aprobación ni autorización"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-accent/30 bg-accent/10 text-accent text-[11px] font-bold hover:bg-accent/20 hover:border-accent/50 disabled:opacity-50 transition-all whitespace-nowrap"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          {t("mp.col.executeExpressWO").replace("{abbr}", woTerms.abbr)}
        </button>
      );
    }
    return needsWO ? (
      !hasActiveWo ? (
        <button
          onClick={async e => {
            e.stopPropagation();
            try {
              const full = await api.get<MaintenancePlan>(`/app/pms/maintenance-plans/${row.id}`);
              setExecuting(full);
            } catch {
              setExecuting(row);
            }
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-accent/30 bg-accent/10 text-accent text-[11px] font-bold hover:bg-accent/20 hover:border-accent/50 transition-all whitespace-nowrap"
        >
          <Zap className="w-3 h-3" /> {t("mp.col.executeWO")}
        </button>
      ) : null
    ) : (
      <button
        onClick={e => { e.stopPropagation(); setReporting(row); }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all whitespace-nowrap"
      >
        <CheckCircle2 className="w-3 h-3" /> {t("mp.col.report")}
      </button>
    );
  }, [t, woTerms, expressRowId, openExpressFromRow]);

  const columns: Column<MaintenancePlan>[] = useMemo(() => [
    // ── Col 0: marcar para juntar en UNA sola OT (parada de astillero) ──────
    {
      key: "bundle",
      header: "OT",
      width: "34px",
      render: row => {
        const checked = bundleIds.includes(row.id);
        // Distinto buque que el primero marcado: no se puede juntar en la misma OT.
        const blocked = !!bundleVessel && bundleVessel !== row.vesselCode && !checked;
        return (
          <input
            type="checkbox"
            checked={checked}
            disabled={blocked}
            onClick={e => e.stopPropagation()}
            onChange={e => { e.stopPropagation(); toggleBundle(row); }}
            title={blocked
              ? "Es de otro buque: una orden de trabajo no puede mezclar buques."
              : "Marcar para incluirlo en una sola OT junto con otros ítems"}
            className="w-3.5 h-3.5 accent-accent cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          />
        );
      },
    },
    // ── Col 1: EMBARCACIÓN / TASKID / SFI ──────────────────────────────────
    {
      key: "vesselCode",
      header: t("mp.col.vesselTaskSfi"),
      width: "180px",
      sortValue: row => `${row.vesselCode} ${row.taskCode}`,
      render: row => (
        <div className="flex flex-col gap-0.5 min-w-[130px]">
          <span className="text-[11px] font-bold text-accent leading-tight">{vesselNameMap.get(row.vesselCode) ?? row.vesselCode}</span>
          <span className="text-[11px] font-bold text-fg font-mono leading-tight">{row.taskCode}</span>
          {row.sfiGroupNumber != null && (
            <span className="text-[10px] text-text-industrial/50 font-mono leading-tight">
              SFI: G{row.sfiGroupNumber}
              {row.riskLevel === "HIGH" || row.riskLevel === "CRITICAL" ? (
                <span className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-red-500/20 text-red-700 dark:text-red-400 text-[8px] font-bold border border-red-500/30">!</span>
              ) : null}
            </span>
          )}
        </div>
      ),
    },
    // ── Col 2: EQUIPO / TAREA ───────────────────────────────────────────────
    {
      key: "title",
      header: t("mp.col.equipmentTask"),
      className: "w-96",
      sortValue: row => (row as MaintenancePlan & { assetName?: string | null }).assetName ?? row.title,
      render: row => {
        // Agrupado por equipo: el equipo ya es el título del grupo, así que en
        // la celda va SOLO la tarea, en negrita. En la lista plana no hay título
        // de grupo, así que ahí se mantiene equipo (negrita) + tarea debajo.
        const assetName = (row as MaintenancePlan & { assetName?: string | null }).assetName ?? row.assetId;
        const oosBadge = oosAssetIds.has(row.assetId) && (
          // Equipo fuera de servicio: el plan sigue existiendo y venciendo, pero
          // la máquina está parada. Sin este aviso, una tarea "vencida" sobre un
          // equipo fuera de uso se lee como un incumplimiento.
          <span
            className="shrink-0 px-1.5 py-0.5 rounded-md border border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300 text-[9px] font-bold uppercase tracking-wider whitespace-nowrap"
            title="El equipo está fuera de servicio"
          >
            {t("mp.assetOutOfService")}
          </span>
        );
        if (groupByEquipment) {
          return (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="text-[12px] font-bold text-fg leading-tight line-clamp-2">{row.title}</span>
              {oosBadge}
            </span>
          );
        }
        // Lista plana: la TAREA manda (negrita arriba) y el equipo va debajo,
        // como referencia. Es lo que se lee primero: qué hay que hacer.
        return (
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="text-[12px] font-bold text-fg leading-tight line-clamp-2">{row.title}</span>
              {oosBadge}
            </span>
            <span className="text-[11px] text-text-industrial/60 leading-tight line-clamp-1">{assetName}</span>
          </div>
        );
      },
    },
    // ── Col 4: FRECUENCIA ───────────────────────────────────────────────────
    {
      key: "frequency",
      header: t("mp.col.frequency"),
      width: "150px",
      sortValue: row => row.frequencyMonths ?? row.frequencyHours ?? 0,
      render: row => (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-text-industrial/80 whitespace-nowrap">{formatFrequency(row)}</span>
          {row.estimatedHours != null && (
            <span className="font-mono text-[10px] text-accent/70 whitespace-nowrap">
              {t("mp.col.estimatedShort")}: {row.estimatedHours} hs
            </span>
          )}
          {needsHours(row.triggerType) && (
            <span className="font-mono text-[10px] text-text-industrial/45 whitespace-nowrap">
              {t("mp.col.accumulated")}: {row.assetCurrentHours != null ? `${row.assetCurrentHours.toLocaleString()} hs` : "—"}
            </span>
          )}
        </div>
      ),
    },
    // ── Col 5: ÚLTIMA EJECUCIÓN ─────────────────────────────────────────────
    {
      key: "lastExecutionDate",
      header: t("mp.col.lastExecution"),
      width: "130px",
      sortValue: row => row.lastExecutionDate ?? row.lastExecutionHours ?? null,
      render: row => {
        if (needsHours(row.triggerType)) {
          return row.lastExecutionHours != null
            ? <span className="font-mono text-xs text-fg whitespace-nowrap">{row.lastExecutionHours.toLocaleString()} hs</span>
            : <span className="text-text-industrial/30 text-xs">0 hs</span>;
        }
        return row.lastExecutionDate
          ? <span className="font-mono text-xs text-fg whitespace-nowrap">{fmtDate(row.lastExecutionDate)}</span>
          : <span className="text-text-industrial/30 text-xs">—</span>;
      },
    },
    // ── Col 6: PRÓXIMO VENCIMIENTO ──────────────────────────────────────────
    {
      key: "nextDueDate",
      header: t("mp.col.nextDue"),
      width: "140px",
      sortValue: row => row.nextDueDate ?? row.nextDueHours ?? null,
      render: row => {
        const isOverdue = row.executionStatus === "OVERDUE";
        if (needsHours(row.triggerType)) {
          return row.nextDueHours != null
            ? <span className={`font-mono text-xs whitespace-nowrap ${isOverdue ? "text-red-700 dark:text-red-400 font-bold" : "text-fg"}`}>{row.nextDueHours.toLocaleString()} hs</span>
            : <span className="text-text-industrial/30 text-xs">—</span>;
        }
        return row.nextDueDate
          ? <span className={`font-mono text-xs whitespace-nowrap ${isOverdue ? "text-red-700 dark:text-red-400 font-bold" : "text-fg"}`}>{fmtDate(row.nextDueDate)}</span>
          : <span className="text-text-industrial/30 text-xs">—</span>;
      },
    },
    // ── Col 7: STATUS ───────────────────────────────────────────────────────
    {
      key: "situacion",
      header: t("mp.col.status"),
      width: "120px",
      sortValue: row => computeStatus(row),
      render: row => renderStatus(row),
    },
    // ── Col 8: ACCIONES ─────────────────────────────────────────────────────
    {
      key: "taskCode" as keyof MaintenancePlan,
      header: t("mp.col.actions"),
      width: "150px",
      sortable: false,
      render: row => renderActions(row),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, vesselNameMap, renderStatus, renderActions, groupByEquipment, oosAssetIds, bundleIds, bundleVessel, toggleBundle]);

  // ── Agrupación por equipo (lista default) ─────────────────────────────────
  const allGroupKeys = useMemo(
    () => [...new Set((data?.items ?? []).map(p => p.assetId))],
    [data],
  );
  const allCollapsed = allGroupKeys.length > 0 && allGroupKeys.every(k => collapsedGroups.has(k));
  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const toggleAllGroups = useCallback(() => {
    setCollapsedGroups(allCollapsed ? new Set<string>() : new Set(allGroupKeys));
  }, [allCollapsed, allGroupKeys]);
  const planGroupBy = useMemo(
    () => groupByEquipment
      ? {
          keyFn: (r: MaintenancePlan) => r.assetId,
          labelFn: (r: MaintenancePlan) => r.assetName ?? r.assetId,
          sortRows: (a: MaintenancePlan, b: MaintenancePlan) => freqRank(a) - freqRank(b),
        }
      : undefined,
    [groupByEquipment],
  );

  return (
    <div className="space-y-4">
      <PageHeader icon={lockedResultMode === "EXPRESS" ? Zap : ClipboardList} title={lockedResultMode === "EXPRESS" ? t("nav.expressMaintenance") : t("page.maintenancePlans")} total={data?.total} onReload={reload}>
        {/* Nueva tarea */}
        <button
          onClick={() => { setEditing(null); setShowModal(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> {t("mp.page.newTask")}
        </button>
        {/* Excel (import/export) */}
        <button
          onClick={() => setShowExcel(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
        {/* Toggle vista Excel (planilla compacta editable) ↔ tarjetas — solo icono */}
        <button
          onClick={() => { const nv = !gridView; setGridView(nv); if (nv) setShowMatrix(false); }}
          title={t("mp.page.gridView")}
          aria-label={t("mp.page.gridView")}
          aria-pressed={gridView}
          className={`flex items-center justify-center p-1.5 rounded-lg border transition-all ${
            gridView
              ? "bg-accent/20 border-accent/40 text-accent"
              : "bg-fg/5 border-fg/10 text-text-industrial/60 hover:border-accent/30"
          }`}
        >
          <Table2 className="w-4 h-4" />
        </button>
        {/* Matriz de vencimientos por equipo (periodicidad × equipo) — vista del área central */}
        <button
          onClick={() => { const nv = !showMatrix; setShowMatrix(nv); if (nv) setGridView(false); }}
          title={t("mp.matrix.title")}
          aria-pressed={showMatrix}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
            showMatrix
              ? "bg-accent/20 border-accent/40 text-accent"
              : "bg-fg/5 border-fg/10 text-text-industrial hover:border-accent/30"
          }`}
        >
          <CalendarRange className="w-3.5 h-3.5" /> {t("mp.page.matrixView")}
        </button>
        {/* Agrupar por equipo + expandir/colapsar todo (solo en la lista default) */}
        {!showMatrix && !gridView && (
          <>
            <button
              onClick={() => setGroupByEquipment(v => !v)}
              title={t("mp.page.groupByEquipment")}
              aria-pressed={groupByEquipment}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                groupByEquipment
                  ? "bg-accent/20 border-accent/40 text-accent"
                  : "bg-fg/5 border-fg/10 text-text-industrial hover:border-accent/30"
              }`}
            >
              <ListTree className="w-3.5 h-3.5" /> {t("mp.page.groupByEquipment")}
            </button>
            {groupByEquipment && (
              <button
                onClick={toggleAllGroups}
                title={allCollapsed ? t("mp.page.expandAll") : t("mp.page.collapseAll")}
                aria-label={allCollapsed ? t("mp.page.expandAll") : t("mp.page.collapseAll")}
                className="flex items-center justify-center p-1.5 rounded-lg border bg-fg/5 border-fg/10 text-text-industrial/60 hover:border-accent/30 transition-all"
              >
                {allCollapsed ? <ChevronsUpDown className="w-4 h-4" /> : <ChevronsDownUp className="w-4 h-4" />}
              </button>
            )}
          </>
        )}
        {/* Excel de planes próximos a vencer (vencidos / por vencer / en ventana) */}
        <button
          onClick={async () => {
            if (dueXlsxBusy) return;
            setDueXlsxBusy(true);
            try {
              // Respeta el buque seleccionado globalmente (VesselContext), igual que
              // ExcelPanel — el vesselCode de la URL (deep-link) tiene prioridad si vino.
              const effectiveVessel = vesselFilter || selectedVesselCode || "";
              const qs = effectiveVessel ? `?vesselCode=${encodeURIComponent(effectiveVessel)}` : "";
              const today = new Date().toISOString().slice(0, 10);
              await downloadAuthedFile(
                `/app/pms/maintenance-plans/due-soon.xlsx${qs}`,
                `Planes-Proximos-Vencer-${effectiveVessel || "flota"}-${today}.xlsx`,
              );
            } catch (err) {
              setPageError(err instanceof Error ? err.message : "No se pudo exportar el Excel.");
            } finally {
              setDueXlsxBusy(false);
            }
          }}
          disabled={dueXlsxBusy}
          title={t("mp.page.dueSoonExcel")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300 text-xs font-bold hover:bg-orange-500/20 hover:border-orange-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {dueXlsxBusy
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <FileSpreadsheet className="w-3.5 h-3.5" />}
          {t("mp.page.dueSoonExcel")}
        </button>
        {/* Toggle VENCIDOS / PRÓX. */}
        <button
          onClick={() => setOverdueOnly(!overdueOnly)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
            overdueOnly
              ? "bg-orange-500/20 border-orange-500/40 text-orange-700 dark:text-orange-300"
              : "bg-fg/5 border-fg/10 text-text-industrial/60 hover:border-orange-400/30"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          {t("mp.page.overdueToggle")}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
            overdueOnly ? "bg-orange-500/30 text-orange-200" : "bg-fg/10 text-text-industrial/50"
          }`}>{urgentCount}</span>
        </button>
        {/* Buscador global */}
        <div className="flex items-center gap-1.5 bg-fg/5 border border-fg/10 rounded-lg px-2.5 py-1.5">
          <Search className="w-3 h-3 text-text-industrial/40 shrink-0" />
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder={t("mp.page.searchPlaceholder")}
            className="w-56 bg-transparent text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none"
          />
          {searchText && (
            <button onClick={() => setSearchText("")} className="text-text-industrial/40 hover:text-fg transition-colors">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {/* Filtro por buque: usa el selector global del header (VesselContext).
            Filtro por estado: removido — ACTIVE es el caso 99% del tiempo. */}
        {(overdueOnly || searchText) && (
          <button
            onClick={() => {
              setOverdueOnly(false);
              setSfiTab("ALL");
              setSearchText("");
            }}
            className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial/80 hover:text-fg hover:border-red-400/40 transition-all"
          >
            {t("common.clear")}
          </button>
        )}
      </PageHeader>

      {/* ── Tabs SFI ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 flex-wrap">
        {SFI_TABS.map(tab => {
          const count = tab.key === "ALL" ? (sfiTabCounts["ALL"] ?? rawData?.total ?? 0) : (sfiTabCounts[String(tab.key)] ?? 0);
          const isActive = sfiTab === tab.key;
          return (
            <button
              key={String(tab.key)}
              onClick={() => setSfiTab(tab.key)}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                isActive
                  ? "bg-accent text-accent-fg border-accent"
                  : "bg-fg/5 text-text-industrial/60 border-fg/10 hover:bg-fg/10 hover:text-fg"
              }`}
            >
              {/* El chip lleva el nombre completo del grupo: "G7" solo no dice
                  nada si no te sabés la numeración SFI de memoria. */}
              {tab.key === "ALL"
                ? t("mp.sfiTab.all")
                : <>{tab.label} <span className="font-semibold">{t(`sfi.g.${tab.key}` as Parameters<typeof t>[0])}</span></>}
              {count > 0 && (
                <span className={`ml-1 text-[10px] ${isActive ? "opacity-70" : "text-text-industrial/40"}`}>
                  ({count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Filtro por semana (desde el gráfico de carga) ─────────────────────── */}
      {weekStartFilter && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 border border-accent/30 w-fit">
          <Filter className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="text-xs font-semibold text-fg">
            {t("mp.page.weekFilter").replace("{date}", fmtDate(weekStartFilter) ?? weekStartFilter)}
          </span>
          {weekPlanIdsLoading
            ? <Loader2 className="w-3 h-3 animate-spin text-accent" />
            : <span className="text-[10px] text-text-industrial/50">({data?.total ?? 0})</span>}
          <button
            onClick={clearWeekFilter}
            title={t("mp.page.weekFilterClear")}
            className="text-text-industrial/50 hover:text-fg transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Barra de "juntar en una sola OT": aparece al marcar ítems del PDM. */}
      {bundlePlans.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap rounded-xl border border-accent/30 bg-accent/[0.07] px-3 py-2">
          <span className="text-xs font-bold text-fg">
            {bundlePlans.length} {bundlePlans.length === 1 ? "ítem marcado" : "ítems marcados"}
            {bundleVessel ? <span className="text-text-industrial/60 font-normal"> · {vesselNameMap.get(bundleVessel) ?? bundleVessel}</span> : null}
          </span>
          <span className="text-[11px] text-text-industrial/60 font-mono truncate max-w-[40%]">
            {bundlePlans.map(p => p.taskCode).join(" / ")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setBundleIds([]); }}
              className="px-3 py-1.5 rounded-lg text-xs text-text-industrial hover:text-fg"
            >
              Limpiar
            </button>
            <button
              type="button"
              onClick={() => { if (bundlePlans[0]) setExecuting(bundlePlans[0]); }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition-colors"
            >
              Generar una sola {woTerms.abbr}
            </button>
          </div>
        </div>
      )}

      {pageError && (
        <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{pageError}</p>
      )}
      {loadingDetailId && (
        <div className="flex items-center gap-2 text-xs text-text-industrial/60">
          <Loader2 className="w-4 h-4 animate-spin text-accent" /> {t("mp.page.loadingDetail")}
        </div>
      )}

      {showMatrix ? (
        loading && !data ? (
          <div className="flex items-center gap-2 text-xs text-text-industrial/60 px-1 py-6">
            <Loader2 className="w-4 h-4 animate-spin text-accent" /> {t("common.loading")}
          </div>
        ) : error ? (
          <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{String(error)}</p>
        ) : (
          <MaintenancePlansMatrix
            plans={data?.items ?? []}
            vesselNameMap={vesselNameMap}
            getStatus={computeStatus}
            onOpenPlan={code => { const r = rawData?.items?.find(p => p.taskCode === code); if (r) openFromRow(r); else openLink(code, { replace: window.location.pathname.startsWith("/maintenance-plans/") }); }}
          />
        )
      ) : gridView ? (
        loading && !data ? (
          <div className="flex items-center gap-2 text-xs text-text-industrial/60 px-1 py-6">
            <Loader2 className="w-4 h-4 animate-spin text-accent" /> {t("common.loading")}
          </div>
        ) : error ? (
          <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{String(error)}</p>
        ) : (
          <MaintenancePlansGrid
            plans={data?.items ?? []}
            isAdmin={isAdmin}
            vesselNameMap={vesselNameMap}
            renderStatus={renderStatus}
            renderActions={renderActions}
            statusValue={statusValue}
            onOpenDetail={openFromRow}
            emptyText={t("empty.maintenancePlans")}
          />
        )
      ) : (
        <DataTable
          columns={columns}
          data={data?.items ?? null}
          loading={loading}
          error={error}
          keyFn={row => row.id}
          emptyText={t("empty.maintenancePlans")}
          // Si ya hay un plan activo en la URL (su ventana aún no se dibujó por el
          // gap de render), reemplazamos en vez de apilar: clickear otro plan
          // dejaba /A y /B en el historial y cerrar el 2º reabría el 1º.
          onRowClick={openFromRow}
          layoutFixed
          groupBy={planGroupBy}
          collapsedGroups={collapsedGroups}
          onToggleGroup={toggleGroup}
        />
      )}

      {showExcel && <ExcelPanel module="maintenance_plans" onClose={() => { setShowExcel(false); void reload(); }} />}

      {executing && (
        <CreateWorkOrderModal
          prefill={{
            source: "plan",
            sourceId: executing.id,
            sourceCode: executing.taskCode,
            sourceLabel: t("mp.modal.maintenancePlanLabel"),
            vesselCode: executing.vesselCode,
            assetId: executing.assetId,
            assetName: executing.assetName,
            type: executing.taskType === "INSPECTION" ? "INSPECTION" : "PREVENTIVE",
            title: executing.title,
            description: executing.description,
            dueDate: executing.nextDueDate,
            acceptanceCriteria: executing.acceptanceCriteria,
            responsible: executing.responsible,
            loto: executing.loto,
            riskLevel: executing.riskLevel,
            riskAnalysisResult: executing.riskAnalysisResult,
            consequenceCategory: executing.consequenceCategory,
            consequenceRationale: executing.consequenceRationale,
            estimatedHours: executing.estimatedHours,
            checklistDocUrl: executing.checklistTemplate,
            samplingFluidType: executing.samplingFluidType,
            // Los otros ítems marcados van a la MISMA OT. Solo cuando el plan que
            // se está abriendo es el primero de la selección: abrir otro plan
            // suelto no debe arrastrar la selección.
            additionalPlans: bundlePlans[0]?.id === executing.id
              ? bundlePlans.slice(1).map(p => ({
                  id: p.id, taskCode: p.taskCode, title: p.title,
                  assetName: (p as MaintenancePlan & { assetName?: string | null }).assetName ?? null,
                }))
              : undefined,
          }}
          onClose={() => setExecuting(null)}
          onSaved={_woId => { setExecuting(null); setBundleIds([]); void reload(); }}
        />
      )}

      {reporting && (
        <ExecutionModal
          plan={reporting}
          userName={userName}
          userId={user?.id ?? null}
          isAdmin={can("plan.manage")}
          onClose={() => setReporting(null)}
          onSuccess={() => { setReporting(null); void reload(); }}
        />
      )}

      {showModal && (
        <MaintenancePlanModal
          plan={editing}
          userId={user?.id ?? null}
          userName={userName}
          isAdmin={can("plan.manage")}
          canDelete={user?.role === "TENANT_ADMIN" || user?.role === "FLEET_SUPERINTENDENT"}
          setRequestMessage={setRequestMessageFromContext}
          deepLinked={!!linkCode}
          // NO hacer setEditing(null) acá: al quedar `editing` en null con el :code
          // todavía en la URL, el resolver re-abría el plan con un fetch asíncrono.
          // Lo nulifica el propio resolver cuando la URL se queda sin code.
          //
          // Cierre DETERMINISTA: vamos explícitamente a la lista en vez de hacer
          // "volver atrás". El back era el corazón de los tres síntomas: si el
          // historial tenía otra entrada del MISMO plan (la dejaba guardar, o las
          // marcas de los modales anidados), retroceder caía en la copia y el plan
          // se reabría (cerrar dos veces) o quedaba "abierto pero invisible" —
          // estado del que salía reabriéndose al cerrar OTRO plan.
          // `replace` para no dejar la ficha en el historial: el botón Atrás del
          // navegador sigue llevando a la pantalla de origen (Gantt, Bitácora…).
          onClose={() => {
            openTokenRef.current++;
            setShowModal(false);
            if (linkCode) navigate(`/maintenance-plans${window.location.search}`, { replace: true });
          }}
          onSaved={async (savedId) => {
            void reload();
            if (savedId) {
              try {
                const detail = await api.get<MaintenancePlan>(`/app/pms/maintenance-plans/${savedId}`);
                setEditing(detail);
                openLink(detail.taskCode);  // refleja el plan (recién creado o editado) en la URL
              } catch { /* silent, plan stays open */ }
            }
          }}
        />
      )}
    </div>
  );
};
