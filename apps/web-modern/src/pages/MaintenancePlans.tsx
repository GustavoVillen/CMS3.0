import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  AudioLines,
  ArrowRight,
  BadgeCheck,
  Ban,
  CalendarCheck,
  CalendarClock,
  CalendarRange,
  CalendarX,
  Check,
  CheckCircle2,
  CircleDot,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Droplets,
  ExternalLink,
  FileCheck,
  FileDown,
  FileSpreadsheet,
  FileText,
  Filter,
  FlaskConical,
  GitBranch,
  Handshake,
  Hourglass,
  Info,
  ListChecks,
  ListTree,
  Loader2,
  Maximize2,
  Minimize2,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Search,
  SearchCheck,
  Ship,
  ShieldAlert,
  ShieldCheck,
  Package,
  Sparkles,
  Table2,
  Thermometer,
  Trash2,
  Upload,
  Users,
  Wrench,
  X,
  Zap,
  AlarmClock,
  CalendarDays,
  CalendarPlus,
  Layers,
  MoreHorizontal,
  PlayCircle,
  PowerOff,
  Truck,
} from "lucide-react";
import { MocModal, type MocPrefill } from "./Moc";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { downloadAuthedFile } from "../lib/authed-media";
import { useAuth, useCan } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { exportMaintenanceSheet } from "../lib/export-maintenance-sheet";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { compareSfiGroup, dominantSfiGroup, FILTER_ALL_VALUE, fmtDate, fromFilterSelectValue, parseLocalDate, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { VesselLabel } from "../components/EntityLabels";
import { ExcelPanel } from "../components/ExcelPanel";
import { MaintenancePlansGrid } from "../components/MaintenancePlansGrid";
import { PersonSelect } from "../components/PersonSelect";
import { MaintenancePlansMatrix } from "../components/MaintenancePlansMatrix";
import { PlannedItemsEditor, type WoPlannedItem, type WoSpareOption } from "../components/work-orders/PlannedItemsEditor";
import { useT, useWoTerms } from "../lib/i18n";
import { RECORD_IDENTITY, recordHeaderClass } from "../lib/record-identity";
import { useDeepLink } from "../lib/deep-link";
import { CopyLinkButton } from "../components/CopyLinkButton";
import { useCopilotEmitter, useCopilotApplyFields, useCopilotScreenContext } from "../lib/copilot-context";
import { CreateWorkOrderModal, buildWoPrefillFromPlan } from "../components/CreateWorkOrderModal";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { AlertDialog } from "../components/AlertDialog";
import { CertificateRenewalDialog, type RenewableCertificate } from "../components/CertificateRenewalDialog";
import { PlanHistoryModal } from "../components/PlanHistoryModal";
import { AssetSearchDropdown } from "../components/AssetSearchDropdown";
import { RichTextArea } from "../components/RichTextArea";
import { RiskMatrix } from "../components/RiskMatrix";
import {
  RISK_PROBS, RISK_CONS, RISK_GRID,
  deriveRiskLevelFromMatrix, toUiRiskLevel, toUiRiskProbability, toUiRiskConsequence,
  type RiskLevel, type RiskProbability, type RiskConsequence,
} from "../lib/risk";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { useTmsaFilter, applyTmsaFilter, TmsaFilterBanner } from "../lib/tmsa-filter";
import { AutoTextArea } from "../components/AutoTextArea";
import { CRITERIA_SOURCES, type CriteriaSource } from "../lib/criteria-source";
import { GuideSection, GuideField, GuideNeedTag, GuidePill, RequiredMark } from "../components/GuideKit";
import { textMatches } from "../lib/text-search";
import { suggestPermitTypesFromText, type PermitType } from "../lib/permit-classifier";

const PLAN_PERMIT_TYPES: PermitType[] = [
  "HOT_WORK", "ENCLOSED_SPACE_ENTRY", "WORKING_ALOFT", "ELECTRICAL_ISOLATION", "COLD_WORK", "UNDERWATER_WORK",
];

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
  /** Fecha estimada de vencimiento de una tarea por horas (según el uso del equipo). Sólo en la lista. */
  projectedDueDate?: string | null;
  /** La lista no trae el texto del criterio: sólo si existe. */
  hasAcceptanceCriteria?: boolean;
  taskCode: string;
  title: string;
  description: string | null;
  taskType: "MAINTENANCE" | "INSPECTION";
  /** ISM 10.1 — de qué regla nace la tarea. Ver CRITERIA_SOURCES. */
  criteriaSource?: CriteriaSource | null;
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
  requiredPermitTypes?: string[] | null;
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

// ── Lista del plan (preview V27) ─────────────────────────────────────────────

/** Por evento o condición no hay vencimiento que calcular: no es un faltante. */
function isEventDriven(plan: MaintenancePlan): boolean {
  const tt = (plan.triggerType || "").toUpperCase();
  return tt === "EVENT" || tt === "CONDITION";
}

/** Sin fecha ni horas de vencimiento: la tarea nunca va a avisar. */
function hasNoDue(plan: MaintenancePlan): boolean {
  return plan.nextDueDate == null && plan.nextDueHours == null && !isEventDriven(plan);
}

type PlanBucket = "over" | "now" | "soon" | "ok" | "nodue" | "oos";

/** En qué montón cae la tarea. Sale de displayStatus: cuenta lo mismo que el Dashboard. */
function planBucket(plan: MaintenancePlan, assetOutOfService: boolean): PlanBucket {
  const st = displayStatus(plan, assetOutOfService);
  if (st === "OUT_OF_SERVICE") return "oos";
  if (st === "OVERDUE") return "over";
  if (st === "DUE" || st === "IN_WINDOW") return "now";
  if (hasNoDue(plan)) return "nodue";
  if (st === "UPCOMING") return "soon";
  return "ok";
}

/** "vencida hace 3 días", "pasada por 180 h", "faltan 400 h · ~50 días". */
function dueRelative(plan: MaintenancePlan, t: ReturnType<typeof useT>): string | null {
  if (plan.nextDueHours != null) {
    const diff = Math.round(plan.nextDueHours - (plan.assetCurrentHours ?? 0));
    if (diff <= 0) return t("mp.v27.hoursOver").replace("{n}", Math.abs(diff).toLocaleString());
    let txt = t("mp.v27.hoursLeft").replace("{n}", diff.toLocaleString());
    if (plan.projectedDueDate) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days = Math.round((parseLocalDate(plan.projectedDueDate).getTime() - today.getTime()) / 86_400_000);
      if (days >= 0) txt += ` · ${t("mp.v27.approxDays").replace("{n}", String(days))}`;
    }
    return txt;
  }
  if (plan.nextDueDate) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((parseLocalDate(plan.nextDueDate).getTime() - today.getTime()) / 86_400_000);
    if (days < 0) return t("mp.v27.daysOver").replace("{n}", String(-days));
    if (days === 0) return t("mp.v27.today");
    return t("mp.v27.daysLeft").replace("{n}", String(days));
  }
  return null;
}

// Vencimientos/ejecuciones por FECHA y por HORAS de equipo no son comparables
// entre sí (un timestamp contra "860 hs"). Al ordenar, van primero los de
// calendario en orden cronológico y después los de horas con su propio criterio,
// en vez de intercalarlos. HOURS_BUCKET es mayor que cualquier fecha en ms.
const HOURS_BUCKET = 1e15;

function nextDueSort(plan: MaintenancePlan): number {
  if (plan.nextDueDate) return parseLocalDate(plan.nextDueDate).getTime();
  // Por horas: lo que ordena es cuánto FALTA, no el contador absoluto.
  if (plan.nextDueHours != null) return HOURS_BUCKET + (plan.nextDueHours - (plan.assetCurrentHours ?? 0));
  return Number.POSITIVE_INFINITY;
}

// Orden de ÚLTIMA VERIFICACIÓN: fechas por tiempo, horas en su propio bucket.
// Lo nunca ejecutado va al final.
function lastExecutionSort(plan: MaintenancePlan): number {
  if (plan.lastExecutionDate) return parseLocalDate(plan.lastExecutionDate).getTime();
  if (plan.lastExecutionHours != null) return HOURS_BUCKET + plan.lastExecutionHours;
  return Number.POSITIVE_INFINITY;
}

function frequencySort(plan: MaintenancePlan): number {
  if (plan.frequencyMonths != null) return plan.frequencyMonths;
  if (plan.frequencyHours != null) return HOURS_BUCKET + plan.frequencyHours;
  return Number.POSITIVE_INFINITY;
}

// Orden de la columna SITUACIÓN: por URGENCIA, no alfabético. Ordenar
// "DUE, FUTURE, IN_WINDOW…" por texto no le sirve a nadie; lo que se busca al
// clickear esa columna es ver primero lo vencido.
const STATUS_URGENCY: Record<string, number> = {
  OVERDUE: 0,
  DUE: 1,
  NEVER_EXECUTED: 2,
  IN_WINDOW: 3,
  UPCOMING: 4,
  FUTURE: 5,
  // Va último: sobre una máquina parada no hay nada que ejecutar, así que no
  // compite por atención con lo que sí está vencido y en uso.
  OUT_OF_SERVICE: 6,
};

/**
 * Situación que se MUESTRA en la lista.
 *
 * Un plan sobre un equipo fuera de servicio sigue venciendo, pero mostrarlo como
 * "VENCIDA" lo hace leer como un incumplimiento cuando en realidad la máquina
 * está parada. `computeStatus` NO se toca: tiene que seguir coincidiendo con
 * deriveDashboardStatus del backend para que el donut del Dashboard y esta lista
 * cuenten lo mismo. La distinción es sólo de presentación y de orden.
 */
function displayStatus(plan: MaintenancePlan, assetOutOfService: boolean): string {
  return assetOutOfService ? "OUT_OF_SERVICE" : computeStatus(plan);
}

function StatusBadgeInline(
  { plan, onOpenWo, assetOutOfService = false, hideWhenValid = false }:
  { plan: MaintenancePlan; onOpenWo?: (code: string) => void; assetOutOfService?: boolean; hideWhenValid?: boolean },
) {
  const t = useT();
  const es = displayStatus(plan, assetOutOfService);

  const pill = (() => {
    // En la lista, lo que está al día no lleva cartel: si una fila no dice nada,
    // es porque no necesita nada. Marcar 111 tareas como "válidas" gasta la
    // atención que tienen que llevarse las 7 vencidas. En la ficha del plan sí
    // se muestra, porque ahí el estado es la información principal.
    if (hideWhenValid && (es === "FUTURE" || es === "COMPLETED")) return null;
    if (es === "OUT_OF_SERVICE")
      return (
        <span
          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30 whitespace-nowrap"
          title={t("mp.statusBadge.outOfServiceHint")}
        >
          <Ban className="w-2.5 h-2.5" /> {t("mp.statusBadge.outOfService")}
        </span>
      );
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

/**
 * ¿El plan encarga el trabajo a un taller externo?
 *
 * Mismo criterio que el backend: los proveedores del plan sólo cuentan cuando el
 * área es PROVEEDOR (ver openFormalWorkOrder). Con taller hay una SS de por
 * medio — o sea gasto —, y entonces la OT NO se abre autorizada: tramita como
 * cualquier otra. El botón tiene que decir eso, no prometer un atajo que el
 * backend ya no aplica.
 */
function planHasProvider(plan: MaintenancePlan): boolean {
  if (plan.department !== "PROVEEDOR") return false;
  return (plan.providerRequests?.length ?? 0) > 0 || !!plan.providerId;
}

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
const TRIGGER_RESULT_MODES = ["DUE_ONLY", "AUTO_WO"] as const;
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
// Rótulo de campo de la ventana por secciones (V15): en minúscula, más legible.
const fLabelCls = "flex items-center text-xs font-semibold text-text-industrial/70";
const PLAN_SECTIONS = ["what", "when", "who", "safety", "docs"] as const;
/** Qué analiza un plan de muestreo (V17b): sólo el tipo, sin detalle de fluido. */
const SAMPLING_KINDS: { kind: "FLUID" | "VIBRATION" | "THERMAL" | "ULTRASOUND" | "OTHER"; icon: typeof Wrench }[] = [
  { kind: "FLUID", icon: Droplets },
  { kind: "VIBRATION", icon: Activity },
  { kind: "THERMAL", icon: Thermometer },
  { kind: "ULTRASOUND", icon: AudioLines },
  { kind: "OTHER", icon: FlaskConical },
];
type PlanSectionKey = (typeof PLAN_SECTIONS)[number];
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

interface TeamMember { userId: string; firstName: string | null; lastName: string | null; formName: string | null; hasSignature: boolean; role?: string; jobTitle?: string | null }
const teamMemberName = (u: TeamMember) => (u.formName || [u.firstName, u.lastName].filter(Boolean).join(" ") || "").trim();

/** Encabezado común de las ventanas del plan (V16): ícono, título, plan, equipo y buque. */
const PlanSubHeader: React.FC<{ plan: MaintenancePlan; icon: typeof Wrench; tone: string; title: string; onClose: () => void }> = ({ plan, icon: Icon, tone, title, onClose }) => (
  <div className="flex items-start gap-3 px-5 py-3.5 border-b border-fg/10 shrink-0">
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tone}`}><Icon className="w-5 h-5" /></div>
    <div className="min-w-0 flex-1">
      <h2 className="text-base font-black text-fg leading-tight">{title}</h2>
      <p className="text-xs text-text-industrial/60 truncate">{[plan.title, plan.assetName].filter(Boolean).join(" · ")}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 font-mono text-[11px] font-bold text-fg">{plan.taskCode}</span>
        {/* Nombre del buque, no el código. */}
        <span className="inline-flex items-center gap-1 rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/70">
          <Ship className="w-3 h-3" /><VesselLabel code={plan.vesselCode} className="text-[11px]" />
        </span>
      </div>
    </div>
    <ModalCloseButton onClose={onClose} />
  </div>
);

/** "YYYY-MM-DD" de hoy menos `back` días, en hora local. */
function localIsoDay(back = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openingDefect, setOpeningDefect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Con deficiencias: abrir el defecto al guardar (antes era un botón aparte que también guardaba).
  const [openDefect, setOpenDefect] = useState(true);

  // AI suggestion — auto-triggered while typing deficiencies
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Post-save WO print confirmation screen
  const [showPrintConfirm, setShowPrintConfirm] = useState(false);

  const isHoursBased = needsHours(plan.triggerType);
  const withDeficiencies = result === "CON_DEFICIENCIAS";

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
      });
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("mp.exec.saveError"));
      return false;
    } finally {
      setUploading(false);
      setSaving(false);
    }
  };

  const downloadReportPdf = async () => {
    const token = localStorage.getItem("gpms_token");
    const slug  = localStorage.getItem("gpms_tenant_slug");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (slug)  headers["X-Tenant-Slug"] = slug;
    try {
      const res = await fetch(`/app/pms/maintenance-plans/${plan.id}/pdf`, { headers });
      if (res.ok) {
        const blob = await res.blob();
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
  };

  /**
   * Guardar (con o sin PDF). Con deficiencias y la casilla tildada, sigue al
   * alta del defecto — mismo camino que el viejo botón "Abrir registro DEF":
   * si la tarea tiene OT abierta, primero pregunta si imprimirla.
   */
  const finish = async (withPdf: boolean) => {
    if (!await doSave()) return;
    if (withPdf) await downloadReportPdf();
    if (withDeficiencies && openDefect) {
      if (plan.activeWorkOrderCode) setShowPrintConfirm(true);
      else await createDefectAndNavigate();
      return;
    }
    onSuccess(completedAt);
  };

  // ESC guard
  const isDirty = useDirtyTracker({
    executedByName, result, notes, deficienciesNotes, completedAt, runningHours,
    docFileName: docFile?.name ?? "",
  });
  const requestClose = useEscapeGuard({
    enabled: !showPrintConfirm,
    isDirty,
    onSave: () => finish(false),
    onClose,
  });

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

  const errorDialog = error && <AlertDialog message={error} onClose={() => setError(null)} />;

  // Print WO confirmation screen
  if (showPrintConfirm) {
    return (
      <>
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
        {errorDialog}
      </>
    );
  }

  // Qué pasa al guardar: nueva fecha (misma cuenta que el backend, sólo de muestra).
  const nextPreview = previewNextDue(plan.triggerType, completedAt, runningHours, String(plan.frequencyMonths ?? ""), String(plan.frequencyHours ?? ""));
  const quickDays: { back: number; label: string }[] = [{ back: 0, label: t("mp.exec.today") }, { back: 1, label: t("mp.exec.yesterday") }];
  const busy = saving || uploading || openingDefect;
  const fl = "flex items-center gap-1.5 text-xs font-semibold text-text-industrial/70 mb-1.5";

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <PlanSubHeader plan={plan} icon={ClipboardCheck} tone="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" title={t("mp.exec.reportTitle")} onClose={requestClose} />

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
            {/* ¿Cómo salió? */}
            <div>
              <p className={fl}>{t("mp.exec.howItWent")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(["SATISFACTORIO", "CON_DEFICIENCIAS"] as const).map(r => {
                  const on = result === r;
                  const ok = r === "SATISFACTORIO";
                  return (
                    <button key={r} type="button" onClick={() => setResult(r)}
                      className={`flex items-start gap-2.5 rounded-2xl border-2 p-3 text-left transition-all ${
                        on
                          ? ok ? "border-emerald-500 bg-emerald-500/10" : "border-amber-500 bg-amber-500/10"
                          : "border-fg/10 bg-surface hover:border-fg/25"
                      }`}>
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${on ? (ok ? "bg-emerald-500 text-white" : "bg-amber-500 text-white") : "bg-fg/5 text-text-industrial/40"}`}>
                        {ok ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                      </span>
                      <span>
                        <span className="block text-sm font-extrabold text-fg">{ok ? t("mp.exec.okTitle") : t("mp.exec.defTitle")}</span>
                        <span className="block text-[11.5px] text-text-industrial/60">{ok ? t("mp.exec.okHint") : t("mp.exec.defHint")}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={`grid grid-cols-1 gap-3 ${isHoursBased ? "sm:grid-cols-[1.3fr_1fr_1fr]" : "sm:grid-cols-2"}`}>
              {/* Executed by — el admin puede elegir el usuario ejecutor; el resto reporta a su nombre */}
              <GuideField id="mp-exec-by" missing={!executedByName.trim()}>
                <label className={fl}>{t("mp.exec.executedBy")}<RequiredMark />{!executedByName.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                {isAdmin && teamUsers.length > 0 ? (
                  <PersonSelect
                    value={executedByUserId}
                    onChange={uid => {
                      setExecutedByUserId(uid);
                      const m = teamUsers.find(u => u.userId === uid);
                      if (m) setExecutedByName(teamMemberName(m) || executedByName);
                    }}
                    className={inputCls}
                    options={[
                      ...(!teamUsers.some(u => u.userId === (userId ?? "")) ? [{ value: userId ?? "", name: userName }] : []),
                      ...teamUsers.map(u => ({
                        value: u.userId, name: teamMemberName(u) || u.userId, role: u.role, jobTitle: u.jobTitle,
                        note: u.hasSignature ? null : t("person.noSignature"),
                      })),
                    ]}
                  />
                ) : (
                  <input
                    value={executedByName}
                    onChange={e => setExecutedByName(e.target.value)}
                    className={inputCls}
                    placeholder={t("mp.exec.executedByPlaceholder")}
                  />
                )}
              </GuideField>

              <div>
                <label className={fl}>{t("mp.exec.executionDate")}</label>
                <input type="date" value={completedAt} onChange={e => setCompletedAt(e.target.value)} className={inputCls} />
                <div className="mt-1.5 flex gap-1.5">
                  {quickDays.map(q => {
                    const day = localIsoDay(q.back);
                    return (
                      <button key={q.back} type="button" onClick={() => setCompletedAt(day)}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition-colors ${completedAt === day ? "border-accent bg-accent text-accent-fg" : "border-fg/10 text-text-industrial/60 hover:text-fg"}`}>
                        {q.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {isHoursBased && (
                <div>
                  <label className={fl}>{t("mp.exec.runningHoursLabel")}</label>
                  <input type="number" min="0" value={runningHours} onChange={e => setRunningHours(e.target.value)}
                    className={inputCls} placeholder={t("wo.modal.runningHoursPlaceholder")} />
                  {plan.assetCurrentHours != null && (
                    <p className="mt-1 text-[11px] text-text-industrial/50">{t("mp.exec.lastReading").replace("{h}", plan.assetCurrentHours.toLocaleString())}</p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className={fl}>{t("wo.modal.observations")} <span className="font-normal text-text-industrial/40">· {t("mp.modal.optional")}</span></label>
              <AutoTextArea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputCls} placeholder={t("mp.exec.notesPlaceholder")} />
            </div>

            {/* Con deficiencias: qué se encontró, lo que sugiere el copiloto y el defecto. */}
            {withDeficiencies && (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-3 space-y-3">
                <GuideField id="mp-exec-def" missing={!deficienciesNotes.trim()}>
                  <label className={fl}>
                    {t("mp.exec.defWhat")}<RequiredMark />
                    {!deficienciesNotes.trim() && <GuideNeedTag label={t("mp.exec.required")} />}
                  </label>
                  <AutoTextArea value={deficienciesNotes} onChange={e => setDeficienciesNotes(e.target.value)} rows={3}
                    className={inputCls} placeholder={t("mp.exec.deficienciesPlaceholder")} />
                </GuideField>

                {aiLoading && (
                  <div className="flex items-center gap-2 text-xs text-text-industrial/50">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                    {t("mp.exec.copilotAnalyzing")}
                  </div>
                )}
                {aiSuggestion && !aiLoading && (
                  <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.06] p-3">
                    <p className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 mb-1"><Sparkles className="w-3 h-3" />{t("mp.exec.copilotSuggestion")}</p>
                    <p className="text-xs text-fg/80 whitespace-pre-wrap">{aiSuggestion}</p>
                  </div>
                )}

                <label className="flex items-start gap-2.5 rounded-xl border-[1.5px] border-red-500/35 bg-surface p-3 cursor-pointer">
                  <input type="checkbox" checked={openDefect} onChange={e => setOpenDefect(e.target.checked)} className="mt-0.5 w-4 h-4 accent-red-600" />
                  <span>
                    <span className="block text-[13px] font-extrabold text-red-700 dark:text-red-400">{t("mp.exec.openDefectOnSave")}</span>
                    <span className="block text-[11.5px] text-text-industrial/60">{t("mp.exec.openDefectOnSaveHint")}</span>
                  </span>
                </label>
              </div>
            )}

            {/* Document upload */}
            <div>
              <label className={fl}>{t("mp.exec.checklistLabel")} <span className="font-normal text-text-industrial/40">· {t("mp.modal.optional")}</span></label>
              {docFile ? (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-accent/10 border border-accent/25">
                  <FileCheck className="w-4 h-4 text-accent shrink-0" />
                  <span className="text-xs font-bold text-accent flex-1 truncate">{docFile.name}</span>
                  <button type="button" onClick={() => setDocFile(null)} className="text-text-industrial/40 hover:text-fg transition-colors"><X className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl border-[1.5px] border-dashed border-fg/20 cursor-pointer hover:border-accent/40 transition-colors">
                  <Upload className="w-4 h-4 text-text-industrial/50" />
                  <span className="text-xs text-text-industrial/60">{t("mp.exec.selectFile")}</span>
                  <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                    onChange={e => setDocFile(e.target.files?.[0] ?? null)} />
                </label>
              )}
            </div>

            {/* Qué va a pasar al guardar */}
            <div className="flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/[0.06] px-3 py-2.5 text-[12.5px] text-sky-900 dark:text-sky-200">
              <Info className="w-4 h-4 shrink-0 mt-px" />
              <div>
                <p className="font-bold">{t("mp.exec.onSave")}</p>
                <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                  <li>
                    {t("mp.exec.onSaveExecuted").replace("{date}", fmtDate(completedAt) ?? completedAt)}
                    {nextPreview && ` ${t("mp.exec.onSaveNext").replace("{next}", nextPreview.text)}`}
                  </li>
                  {withDeficiencies && openDefect && <li>{t("mp.exec.onSaveDefect")}</li>}
                </ul>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-fg/10 shrink-0">
            <button onClick={onClose} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
            <span className="flex-1" />
            <button
              onClick={() => { void finish(false); }}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs font-bold text-fg hover:border-fg/25 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              {saving && !uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {t("common.save")}
            </button>
            <button
              onClick={() => { void finish(true); }}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("mp.exec.uploading")}</>
                : <><FileDown className="w-3.5 h-3.5" /> {t("mp.exec.saveAndDownloadPdf")}</>}
            </button>
          </div>
        </div>
      </div>
      {errorDialog}
    </>
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
  // Autorización: elegida a la vista (antes eran dos botones del pie).
  const [authMode, setAuthMode] = useState<"wait" | "now">("wait");
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
    onSave: () => save(authMode === "wait"),
    onClose,
  });

  // Cuánto se corre el vencimiento.
  const delta = (() => {
    if (isHoursBased) {
      if (plan.nextDueHours == null || !newDueHours) return null;
      const d = Number(newDueHours) - plan.nextDueHours;
      return Number.isFinite(d) && d !== 0 ? `${d > 0 ? "+" : ""}${d.toLocaleString()} h` : null;
    }
    if (!plan.nextDueDate || !newDueDate) return null;
    const d = Math.round((parseLocalDate(newDueDate).getTime() - parseLocalDate(plan.nextDueDate).getTime()) / 86_400_000);
    return d !== 0 ? t("mp.postpone.deltaDays").replace("{n}", `${d > 0 ? "+" : ""}${d}`) : null;
  })();
  const fl = "flex items-center gap-1.5 text-xs font-semibold text-text-industrial/70 mb-1.5";

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <PlanSubHeader plan={plan} icon={CalendarClock} tone="bg-amber-500/10 text-amber-700 dark:text-amber-400" title={t("mp.postpone.title")} onClose={requestClose} />

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
            {/* Vencimiento actual → nuevo */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2.5">
              <div className="rounded-xl border border-fg/10 p-3">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-text-industrial/45">{t("mp.postpone.currentDue")}</p>
                <p className="mt-1 text-base font-extrabold font-mono text-red-700 dark:text-red-400">
                  {isHoursBased
                    ? (plan.nextDueHours != null ? `${plan.nextDueHours.toLocaleString()} h` : "—")
                    : (fmtDate(plan.nextDueDate) ?? "—")}
                </p>
              </div>
              <ArrowRight className="hidden sm:block w-5 h-5 text-text-industrial/40 justify-self-center" />
              <div className="rounded-xl border border-accent/35 p-3">
                <p className="flex items-center text-[10.5px] font-bold uppercase tracking-wider text-text-industrial/45">
                  {isHoursBased ? t("mp.postpone.newDueHours") : t("mp.postpone.newDueDate")}
                  {delta && <span className="ml-1.5 rounded-full bg-amber-500/20 px-2 text-[11px] font-extrabold normal-case tracking-normal text-amber-800 dark:text-amber-300">{delta}</span>}
                </p>
                {isHoursBased
                  ? <input type="number" min="0" value={newDueHours} onChange={e => setNewDueHours(e.target.value)} className={`${inputCls} mt-1`} placeholder={t("mp.postpone.newDueHoursPlaceholder")} />
                  : <input type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)} className={`${inputCls} mt-1`} />}
              </div>
            </div>

            <GuideField id="mp-postpone-why" missing={!justification.trim()}>
              <label className={fl}>
                {t("mp.postpone.why")}<RequiredMark />
                {!justification.trim() && <GuideNeedTag label={t("mp.exec.required")} />}
              </label>
              <AutoTextArea value={justification} onChange={e => setJustification(e.target.value)} rows={3} className={inputCls} placeholder={t("mp.postpone.justificationPlaceholder")} />
            </GuideField>

            <div>
              <label className={fl}>{t("mp.postpone.meanwhile")} <span className="font-normal text-text-industrial/40">· {t("mp.postpone.compensatoryMeasures")}</span></label>
              <AutoTextArea value={compensatoryMeasures} onChange={e => setCompensatoryMeasures(e.target.value)} rows={2} className={inputCls} placeholder={t("mp.postpone.compensatoryPlaceholder")} />
            </div>

            <div>
              <button
                type="button"
                onClick={() => { void fetchAiSuggestion(); }}
                disabled={aiLoading || !justification.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-violet-500/35 bg-violet-500/[0.07] text-violet-700 dark:text-violet-300 text-xs font-bold disabled:opacity-40 hover:bg-violet-500/15 transition-all"
              >
                {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {aiLoading ? t("common.analyzing") : t("mp.postpone.copilotReview")}
              </button>
              {aiSuggestion && (
                <div className="mt-2 rounded-xl border border-violet-500/30 bg-violet-500/[0.06] p-3">
                  <p className="text-[10.5px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 mb-1">{t("mp.exec.copilotSuggestion")}</p>
                  <p className="text-sm text-fg/80 whitespace-pre-wrap">{aiSuggestion}</p>
                </div>
              )}
            </div>

            {/* Autorización */}
            <div>
              <p className={fl}>{t("mp.postpone.authorization")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(["wait", "now"] as const).map(m => (
                  <button key={m} type="button" onClick={() => setAuthMode(m)}
                    className={`rounded-xl border-2 p-3 text-left transition-colors ${authMode === m ? "border-accent bg-accent/[0.06]" : "border-fg/10 hover:border-fg/25"}`}>
                    <span className="flex items-center gap-1.5 text-[13px] font-extrabold text-fg">
                      {m === "wait" ? <Hourglass className="w-3.5 h-3.5" /> : <BadgeCheck className="w-3.5 h-3.5" />}
                      {m === "wait" ? t("mp.postpone.authWait") : t("mp.postpone.authNow")}
                    </span>
                    <span className="block text-[11.5px] text-text-industrial/60 mt-0.5">{m === "wait" ? t("mp.postpone.authWaitHint") : t("mp.postpone.authNowHint")}</span>
                  </button>
                ))}
              </div>
              {authMode === "now" && (
                <input value={authorizedBy} onChange={e => setAuthorizedBy(e.target.value)} className={`${inputCls} mt-2`} placeholder={t("mp.postpone.authorizedByPlaceholder")} />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-fg/10 shrink-0">
            <button onClick={onClose} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
            <span className="flex-1" />
            <button
              onClick={() => { void save(authMode === "wait"); }}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-3.5 h-3.5" />} {t("mp.postpone.save")}
            </button>
          </div>
        </div>
      </div>
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </>
  );
};

// ─── Plan detail modal ────────────────────────────────────────────────────────

export interface MaintenancePlanModalProps {
  plan: MaintenancePlan | null;
  userId: string | null;
  userName: string;
  isAdmin: boolean;
  /** Fijar el próximo vencimiento a mano: reservado al rol TENANT_ADMIN literal
   *  (no alcanza con el permiso plan.manage que habilita `isAdmin`). */
  canEditMilestones: boolean;
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

export const MaintenancePlanModal: React.FC<MaintenancePlanModalProps> = ({ plan, userId, userName, isAdmin, canEditMilestones, onClose, onSaved, setRequestMessage: setReqMsg, defaultVesselCode, defaultAssetId, defaultSfiGroupNumber, lockAsset, overlayZClass, deepLinked }) => {
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
  const [criteriaSource, setCriteriaSource] = useState<CriteriaSource | "">(plan?.criteriaSource ?? "");
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
  // ¿Requiere reemplazo de repuestos? (preview V42) — derivado de la lista, sin
  // campo propio. En No la lista se conserva en pantalla (por si se vuelve a Sí)
  // pero se guarda vacía.
  const [requiresSpares, setRequiresSpares] = useState<boolean>((plan?.spares?.length ?? 0) > 0);
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
  // Próximo vencimiento fijado a mano (solo TENANT_ADMIN). Si no se toca, no se
  // manda al guardar y el backend sigue calculándolo solo desde la frecuencia.
  const [nextDueDateOverride, setNextDueDateOverride] = useState(toDateInput(plan?.nextDueDate ?? null));
  const [nextDueHoursOverride, setNextDueHoursOverride] = useState(String(plan?.nextDueHours ?? ""));
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
  // Permisos de trabajo que exige la tarea (preview V41). El Sí sin tipos no se guarda.
  const [requiresPermit, setRequiresPermit] = useState<boolean>((plan?.requiredPermitTypes?.length ?? 0) > 0);
  const [requiredPermitTypes, setRequiredPermitTypes] = useState<string[]>(plan?.requiredPermitTypes ?? []);
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

  // Buque del render anterior: sirve para distinguir "el usuario cambió de buque"
  // del primer render.
  const prevVesselRef = useRef<string | null>(null);
  useEffect(() => {
    const vc = isNew ? vesselCode : plan?.vesselCode;
    if (!vc) return;
    // Cambiar de buque invalida el activo elegido (es de otro buque). Pero NO en
    // el primer render: ahí el activo puede venir precargado por el contexto
    // (alta desde la ficha del equipo, o desde la lista filtrada por equipo), y
    // limpiarlo dejaba el campo vacío justo cuando ya se sabía cuál era.
    const vesselChanged = prevVesselRef.current !== null && prevVesselRef.current !== vc;
    prevVesselRef.current = vc;
    if (isNew && !lockAsset && vesselChanged) { setAssetId(""); setAssets([]); }
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

  // Elegir el laboratorio desde el bloque de muestreo (V17b): mini formulario.
  const [labFormOpen, setLabFormOpen] = useState(false);
  const [labPickId, setLabPickId] = useState("");
  const [labPickPurpose, setLabPickPurpose] = useState("");

  // Proveedores del tenant, para cuando el área es PROVEEDOR (o se elige el laboratorio).
  useEffect(() => {
    if ((department !== "PROVEEDOR" && !labFormOpen) || providers.length > 0) return;
    let cancelled = false;
    api.get<{ items: Array<{ id: string; name: string; providerCode: string }> }>(`/app/providers?status=ACTIVE`)
      .then(r => { if (!cancelled) setProviders(r.items ?? []); })
      .catch(() => { if (!cancelled) setProviders([]); });
    return () => { cancelled = true; };
  }, [department, providers.length, labFormOpen]);

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
    setCriteriaSource(plan.criteriaSource ?? "");
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
    setRequiresSpares((plan.spares?.length ?? 0) > 0);
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
    setNextDueDateOverride(toDateInput(plan.nextDueDate ?? null));
    setNextDueHoursOverride(String(plan.nextDueHours ?? ""));
    setTriggerResultMode(plan.triggerResultMode ?? "DUE_ONLY");
    setWindowMode(plan.windowMode ?? "AUTO");
    setWindowLeadDays(String(plan.windowLeadDays ?? ""));
    setChecklistTemplate(plan.checklistTemplate ?? "");
    setSamplingKind(plan.samplingKind ?? (plan.samplingFluidType ? "FLUID" : ""));
    setSamplingFluidType(plan.samplingFluidType ?? "");
    setRequiresPermit((plan.requiredPermitTypes?.length ?? 0) > 0);
    setRequiredPermitTypes(plan.requiredPermitTypes ?? []);
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
        taskType,
        vesselCode: vesselCode || null,
      });
      setAcceptanceCriteria(res.text || prev);
    } catch {
      setAcceptanceCriteria(prev);
    } finally {
      setLoadingCriteria(false);
    }
  }, [readOnly, acceptanceCriteria, description, title, taskType, loadingCriteria, resolveAssetLabel, t]);

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
        vesselCode: vesselCode || null,
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
        vesselCode: vesselCode || null,
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
          vesselCode: vesselCode || null,
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
      if (requiresSpares && !plannedSpares.some(s => s.kind === "SPARE" ? !!s.spareId : !!s.description.trim())) {
        setActionError(t("mp.spares.itemsRequired"));
        setSaving(false);
        return;
      }
      if (requiresPermit && requiredPermitTypes.length === 0) {
        setActionError(t("mp.ptw.typesRequired"));
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
          criteriaSource: criteriaSource || null,
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
          requiredPermitTypes: requiresPermit ? requiredPermitTypes : [],
          spares: requiresSpares ? cleanSpares : [],
        });
        savedId = created.id;
      } else {
        // Se mandan solo si cambiaron respecto del plan original — mandarlos
        // siempre (como antes) hacía que el backend recalculara el próximo
        // vencimiento en CUALQUIER guardado (aunque no se tocaran las fechas),
        // pisando en silencio un vencimiento fijado a mano en un guardado previo.
        const lastExecDateChanged = canEditMilestones && !needsHours(triggerType) && lastExecDate !== toDateInput(plan.lastExecutionDate ?? null);
        const lastExecHoursChanged = canEditMilestones && needsHours(triggerType) && lastExecHours !== String(plan.lastExecutionHours ?? "");
        const nextDueDateChanged = canEditMilestones && !needsHours(triggerType) && nextDueDateOverride !== toDateInput(plan.nextDueDate ?? null);
        const nextDueHoursChanged = canEditMilestones && needsHours(triggerType) && nextDueHoursOverride !== String(plan.nextDueHours ?? "");
        await api.patch(`/app/pms/maintenance-plans/${plan.id}`, {
          ...(assetId ? { assetId } : {}),
          ...(isAdmin && taskCode.trim() && taskCode.trim() !== plan.taskCode ? { taskCode: taskCode.trim().toUpperCase() } : {}),
          taskType,
          criteriaSource: criteriaSource || null,
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
          requiredPermitTypes: requiresPermit ? requiredPermitTypes : [],
          // Última ejecución editable (admin): el backend recalcula el próximo
          // vencimiento desde la frecuencia. Próximo vencimiento fijado a mano
          // (solo TENANT_ADMIN): manda sobre ese cálculo automático.
          ...(lastExecDateChanged ? { lastExecutionDate: lastExecDate || null } : {}),
          ...(lastExecHoursChanged ? { lastExecutionHours: lastExecHours ? Number(lastExecHours) : null } : {}),
          ...(nextDueDateChanged ? { nextDueDate: nextDueDateOverride || null } : {}),
          ...(nextDueHoursChanged ? { nextDueHours: nextDueHoursOverride ? Number(nextDueHoursOverride) : null } : {}),
          spares: requiresSpares ? cleanSpares : [],
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
  // Con taller externo cargado en el formulario, el atajo express no corre: la
  // OT lleva SS y por lo tanto se aprueba y se autoriza (ver openFormalWorkOrder).
  const expressGoesToProvider = department === "PROVEEDOR" && providerRequests.length > 0;
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
    vesselCode, taskCode, assetId, taskType, criteriaSource, title, description, responsible, department, providerRequests,
    acceptanceCriteria, loto, sfiGroupNumber,
    riskLevel, riskProbability, riskConsequence, riskAnalysisResult, status, triggerType,
    frequencyMonths, frequencyHours, triggerResultMode,
    windowMode, windowLeadDays,
    checklistTemplate, samplingKind, samplingFluidType, requiresPermit, requiredPermitTypes,
    lastExecDate, lastExecHours, nextDueDateOverride, nextDueHoursOverride, plannedSpares, requiresSpares,
  }, `${saveResetKey}:${planSyncKey}`);
  planDirtyRef.current = planDirty;
  const requestClose = useEscapeGuard({
    enabled: !readOnly && !showExecution && !showPostpone && !confirmDuplicateWO,
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
    const resultLbl = (r: string) => ({ DUE_ONLY: "Solo vencimiento", AUTO_WO: `${woTerms.abbr} automática`, APPROVAL_WO: `${woTerms.abbr} con aprobación`, CHECKLIST: "Completar Checklist" }[r] ?? r);
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
  /* Última fila incompleta: la celda final se estira hasta el borde en vez de
     dejar un hueco sin fondo (pasa cuando la sección no tiene múltiplo de 3). */
  .cell:last-child:not(.cell-full){grid-column-end:-1}
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
        <div class="cell"><div class="cell-label">${t("mp.criteriaSource")}</div><div class="cell-value">${
          plan.criteriaSource ? t(`mp.cs.${plan.criteriaSource}` as Parameters<typeof t>[0]) : "—"
        }</div></div>
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

  // El nombre del activo se repite arriba, grande: al abrir un plan lo primero
  // que hay que ver es sobre que equipo es. Sigue al selector del formulario y
  // nunca cae al id (un uuid en el header no le dice nada a nadie).
  const headerAssetName = useMemo(() => {
    const found = assetId ? assets.find(a => a.id === assetId) : null;
    if (found) return found.name ?? found.assetCode;
    if (assetId && plan?.assetId === assetId) return plan.assetName ?? null;
    return null;
  }, [assetId, assets, plan]);

  // GRUPO SFI comparte fila con ACTIVO (misma fila, 2da columna) tanto en alta
  // como en edicion: el campo es identico, solo cambia el bloque que lo aloja.
  const sfiGroupField = (
    <div className="space-y-1.5">
      <label className={fLabelCls}>{t("mp.sfiGroup")}</label>
      <select value={sfiGroupNumber === null ? "" : String(sfiGroupNumber)}
        onChange={e => setSfiGroupNumber(e.target.value ? Number(e.target.value) : null)}
        className={selectCls}>
        <option value="">{t("mp.selectSfiGroup")}</option>
        {SFI_GROUP_NUMBERS.map(g => <option key={g} value={g}>{g} - {t(`sfi.g.${g}` as Parameters<typeof t>[0])}</option>)}
      </select>
    </div>
  );

  // Laboratorio del plan de muestreo = los proveedores cargados del plan. Mismo
  // criterio que el backend: sólo cuentan con área PROVEEDOR (openFormalWorkOrder).
  const labRows = department === "PROVEEDOR"
    ? providerRequests.filter(r => r.providerId).map(r => ({
        providerId: r.providerId,
        purpose: r.purpose,
        name: providers.find(p => p.id === r.providerId)?.name
          ?? plan?.providerRequests?.find(pr => pr.providerId === r.providerId)?.providerName
          ?? (plan?.providerId === r.providerId ? plan?.providerName : null)
          ?? "—",
      }))
    : [];

  // ── Vista por secciones (preview V15) ─────────────────────────────────────
  // Datos recomendados que faltan: se marcan en naranja y se cuentan en el
  // índice y en el botón Guardar. No bloquean el guardado.
  const missing = {
    criteria: !readOnly && !acceptanceCriteria.trim(),
    responsible: !readOnly && !responsible.trim(),
    loto: !readOnly && !loto.trim(),
    risk: !readOnly && !riskLevel,
    // Plan de muestreo sin laboratorio: al abrir la OT no se genera la SS.
    lab: !readOnly && !!samplingKind && labRows.length === 0,
    // Obligatorios (preview V24): sin ellos el guardado falla.
    vessel: !readOnly && isNew && !vesselCode,
    asset: !readOnly && !assetId,
    title: !readOnly && !title.trim(),
    purpose: !readOnly && department === "PROVEEDOR" && providerRequests.some(r => r.providerId && !r.purpose.trim()),
  };
  const sectionMissing: Record<PlanSectionKey, number> = {
    what: Number(missing.criteria) + Number(missing.lab) + Number(missing.vessel) + Number(missing.asset) + Number(missing.title),
    when: 0,
    who: Number(missing.responsible) + Number(missing.purpose),
    safety: Number(missing.loto) + Number(missing.risk),
    docs: 0,
  };
  const totalMissing = sectionMissing.what + sectionMissing.who + sectionMissing.safety;
  const [openSecs, setOpenSecs] = useState<Record<PlanSectionKey, boolean>>({ what: true, when: true, who: true, safety: true, docs: true });
  const [activeSec, setActiveSec] = useState<PlanSectionKey>("what");
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const goToSection = (k: PlanSectionKey) => {
    setOpenSecs(s => ({ ...s, [k]: true }));
    setActiveSec(k);
    // Después de abrirla (si estaba plegada), así la posición ya es la final.
    window.setTimeout(() => {
      const box = bodyScrollRef.current;
      const el = document.getElementById(`mp-sec-${k}`);
      if (box && el) box.scrollTo({ top: el.offsetTop - 8, behavior: "smooth" });
    }, 0);
  };
  const onBodyScroll = () => {
    const box = bodyScrollRef.current;
    if (!box) return;
    let cur: PlanSectionKey = "what";
    for (const k of PLAN_SECTIONS) {
      const el = document.getElementById(`mp-sec-${k}`);
      if (el && el.offsetTop - 40 <= box.scrollTop) cur = k;
    }
    if (cur !== activeSec) setActiveSec(cur);
  };
  const sectionMeta: Record<PlanSectionKey, { title: string; sub: string; icon: typeof Wrench }> = {
    what:   { title: t("mp.sec.what"),   sub: t("mp.sec.whatSub"),   icon: ListChecks },
    when:   { title: t("mp.sec.when"),   sub: t("mp.sec.whenSub"),   icon: CalendarRange },
    who:    { title: t("mp.sec.who"),    sub: t("mp.sec.whoSub"),    icon: Users },
    safety: { title: t("mp.sec.safety"), sub: t("mp.sec.safetySub"), icon: ShieldAlert },
    docs:   { title: t("mp.sec.docs"),   sub: t("mp.sec.docsSub"),   icon: Paperclip },
  };
  const sectionPill = (k: PlanSectionKey) => (k === "what" || k === "who" || k === "safety") && !readOnly
    ? <GuidePill missing={sectionMissing[k]} completeLabel={t("mp.guide.complete")} missingOne={t("mp.guide.missingOne")} missingMany={t("mp.guide.missingMany")} />
    : undefined;
  const aiPill = (onClick: () => void, loading: boolean, tooltip: string) => readOnly ? null : (
    <button type="button" onClick={onClick} disabled={loading} title={tooltip}
      className="ml-auto inline-flex items-center gap-1 rounded-full border border-violet-500/35 bg-violet-500/[0.07] px-2 py-0.5 text-[10.5px] font-extrabold text-violet-700 dark:text-violet-300 hover:bg-violet-500/15 disabled:opacity-60">
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} {t("mp.guide.suggestAi")}
    </button>
  );

  // ── Permisos de trabajo (preview V41) ──
  // Va primero en "Seguridad". Al AUTORIZAR la OT se crean en borrador y la OT
  // no se cierra hasta que estén cerrados (work-orders-service).
  const togglePermitType = (type: PermitType) =>
    setRequiredPermitTypes(prev => prev.includes(type) ? prev.filter(x => x !== type) : [...prev, type]);
  const turnOnPermits = () => {
    setRequiresPermit(true);
    // Sugerencia por el texto de la tarea, sólo si todavía no hay nada tildado.
    if (requiredPermitTypes.length === 0) {
      setRequiredPermitTypes(suggestPermitTypesFromText(`${title} ${description}`).map(m => m.type));
    }
  };
  const permitBlock = !requiresPermit ? (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed border-fg/15 px-3.5 py-3">
      <span className="w-9 h-9 rounded-xl bg-fg/5 text-text-industrial/40 flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold text-fg">{t("mp.ptw.question")}</span>
        <span className="block text-[11.5px] text-text-industrial/60">{t("mp.ptw.questionHint")}</span>
      </span>
      <div className="flex rounded-xl border border-fg/10 bg-fg/5 p-0.5 ml-auto">
        <span className="rounded-lg bg-surface px-3.5 py-1.5 text-xs font-extrabold text-fg shadow-sm">{t("mp.samp.no")}</span>
        <button type="button" onClick={turnOnPermits} className="rounded-lg px-3.5 py-1.5 text-xs font-extrabold text-text-industrial/60 hover:text-fg">{t("mp.samp.yes")}</button>
      </div>
    </div>
  ) : (
    <div className="rounded-2xl border-2 border-orange-500/35 bg-gradient-to-b from-orange-500/[0.06] to-transparent px-3.5 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-orange-500/15 text-orange-700 dark:text-orange-300 flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold text-fg">{t("mp.ptw.title")}</span>
          <span className="block text-[11.5px] text-text-industrial/60">{t("mp.ptw.titleHint")}</span>
        </span>
        <div className="flex rounded-xl border border-fg/10 bg-fg/5 p-0.5 ml-auto">
          <button type="button" onClick={() => { setRequiresPermit(false); setRequiredPermitTypes([]); }} className="rounded-lg px-3.5 py-1.5 text-xs font-extrabold text-text-industrial/60 hover:text-fg">{t("mp.samp.no")}</button>
          <span className="rounded-lg bg-orange-600 px-3.5 py-1.5 text-xs font-extrabold text-white">{t("mp.samp.yes")}</span>
        </div>
      </div>
      <div>
        <p className={`${fLabelCls} mb-1.5`}>{t("mp.ptw.which")}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PLAN_PERMIT_TYPES.map(type => {
            const on = requiredPermitTypes.includes(type);
            return (
              <button key={type} type="button" onClick={() => togglePermitType(type)}
                className={`flex flex-col items-start gap-0.5 rounded-xl border-[1.5px] px-2.5 py-2 text-left transition-colors ${
                  on ? "border-orange-600 bg-orange-500/10" : "border-fg/10 bg-surface hover:border-fg/25"
                }`}>
                <span className={`flex items-center gap-1.5 text-[12.5px] font-extrabold ${on ? "text-orange-700 dark:text-orange-300" : "text-fg"}`}>
                  <span className={`w-3.5 h-3.5 rounded border-[1.5px] flex items-center justify-center ${on ? "bg-orange-600 border-orange-600 text-white" : "border-fg/25"}`}>
                    {on && <Check className="w-2.5 h-2.5" />}
                  </span>
                  {t(`mp.ptw.type.${type}` as Parameters<typeof t>[0])}
                </span>
                <span className="text-[10.5px] text-text-industrial/50">{t(`mp.ptw.typeHint.${type}` as Parameters<typeof t>[0])}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ── Plan de muestreo (preview V17b) ──
  // Va en "Qué se hace": define la tarea. Sólo se elige QUÉ se analiza; el tipo
  // de fluido que ya tengan cargado los planes se conserva (no se muestra).
  // La muestra se crea al AUTORIZAR la OT (setWorkOrderApproval en el backend).
  const addLab = () => {
    if (!labPickId) return;
    setDepartment("PROVEEDOR");
    setProviderRequests(prev => [...prev.filter(r => r.providerId), { providerId: labPickId, purpose: labPickPurpose.trim() }]);
    setLabFormOpen(false);
    setLabPickId("");
  };
  const samplingBlock = !samplingKind ? (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed border-fg/15 px-3.5 py-3">
      <span className="w-9 h-9 rounded-xl bg-fg/5 text-text-industrial/40 flex items-center justify-center shrink-0"><FlaskConical className="w-5 h-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold text-fg">{t("mp.samp.question")}</span>
        <span className="block text-[11.5px] text-text-industrial/60">{t("mp.samp.questionHint")}</span>
      </span>
      <div className="flex rounded-xl border border-fg/10 bg-fg/5 p-0.5 ml-auto">
        <span className="rounded-lg bg-surface px-3.5 py-1.5 text-xs font-extrabold text-fg shadow-sm">{t("mp.samp.no")}</span>
        <button type="button" onClick={() => setSamplingKind("FLUID")} className="rounded-lg px-3.5 py-1.5 text-xs font-extrabold text-text-industrial/60 hover:text-fg">{t("mp.samp.yes")}</button>
      </div>
    </div>
  ) : (
    <div className="rounded-2xl border-2 border-violet-500/30 bg-gradient-to-b from-violet-500/[0.06] to-transparent px-3.5 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-violet-500/15 text-violet-700 dark:text-violet-300 flex items-center justify-center shrink-0"><FlaskConical className="w-5 h-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold text-fg">{t("mp.samp.title")}</span>
          <span className="block text-[11.5px] text-text-industrial/60">{t("mp.samp.titleHint")}</span>
        </span>
        <div className="flex rounded-xl border border-fg/10 bg-fg/5 p-0.5 ml-auto">
          <button type="button" onClick={() => { setSamplingKind(""); setSamplingFluidType(""); }} className="rounded-lg px-3.5 py-1.5 text-xs font-extrabold text-text-industrial/60 hover:text-fg">{t("mp.samp.no")}</button>
          <span className="rounded-lg bg-violet-700 px-3.5 py-1.5 text-xs font-extrabold text-white">{t("mp.samp.yes")}</span>
        </div>
      </div>

      <div>
        <p className={`${fLabelCls} mb-1.5`}>{t("mp.samp.what")}</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {SAMPLING_KINDS.map(({ kind, icon: Icon }) => {
            const on = samplingKind === kind;
            return (
              <button key={kind} type="button"
                onClick={() => { setSamplingKind(kind); if (kind !== "FLUID") setSamplingFluidType(""); }}
                className={`flex flex-col items-start gap-0.5 rounded-xl border-[1.5px] px-2.5 py-2 text-left transition-colors ${
                  on ? "border-violet-600 bg-violet-500/10" : "border-fg/10 bg-surface hover:border-fg/25"
                }`}>
                <span className={`flex items-center gap-1.5 text-[12.5px] font-extrabold ${on ? "text-violet-700 dark:text-violet-300" : "text-fg"}`}>
                  <Icon className="w-3.5 h-3.5" /> {t(`mp.samp.kind.${kind}` as Parameters<typeof t>[0])}
                </span>
                <span className="text-[10.5px] text-text-industrial/50">{t(`mp.samp.kindHint.${kind}` as Parameters<typeof t>[0])}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className={`${fLabelCls} mb-1.5`}>
          {t("mp.samp.lab")}
          {missing.lab && <GuideNeedTag label={t("mp.guide.missing")} />}
        </p>
        {labRows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-emerald-500/35 bg-surface px-3 py-2">
            <BadgeCheck className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="min-w-0 flex-1">
              {labRows.map(r => (
                <span key={r.providerId} className="block text-[13px] font-extrabold text-fg">
                  {r.name}{r.purpose ? <span className="font-normal text-text-industrial/60"> · {r.purpose}</span> : null}
                </span>
              ))}
              <span className="block text-[11.5px] text-text-industrial/60">{t("mp.samp.labOkHint")}</span>
            </span>
            <button type="button" onClick={() => goToSection("who")}
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-fg/10 px-2.5 py-1 text-xs font-bold text-fg hover:border-fg/25">
              <Pencil className="w-3 h-3" /> {t("mp.samp.labChange")}
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-400/60 bg-amber-500/[0.08] px-3 py-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-extrabold text-amber-800 dark:text-amber-300">{t("mp.samp.labMissingTitle")}</span>
                <span className="block text-[11.5px] text-text-industrial/60">{t("mp.samp.labMissingHint")}</span>
              </span>
              {!labFormOpen && !readOnly && (
                <button type="button"
                  onClick={() => { setLabFormOpen(true); setLabPickPurpose(t(`mp.samp.purpose.${samplingKind}` as Parameters<typeof t>[0])); }}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg bg-violet-700 px-2.5 py-1.5 text-xs font-bold text-white hover:brightness-110">
                  <Plus className="w-3.5 h-3.5" /> {t("mp.samp.labPick")}
                </button>
              )}
            </div>
            {labFormOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                <select value={labPickId} onChange={e => setLabPickId(e.target.value)} className={selectCls}>
                  <option value="">{t("mp.samp.labSelect")}</option>
                  {providers.map(p => <option key={p.id} value={p.id}>{p.name}{p.providerCode ? ` (${p.providerCode})` : ""}</option>)}
                </select>
                <input value={labPickPurpose} onChange={e => setLabPickPurpose(e.target.value)} placeholder={t("mp.providerRequests.purposePlaceholder")} className={inputCls} />
                <button type="button" onClick={addLab} disabled={!labPickId}
                  className="inline-flex items-center justify-center gap-1 rounded-xl bg-violet-700 px-3 py-2 text-xs font-bold text-white hover:brightness-110 disabled:opacity-40">
                  <Check className="w-3.5 h-3.5" /> {t("mp.samp.labAdd")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Qué pasa con la muestra: flujo en un renglón (preview V28). El detalle
          de cada paso va en el aviso al pasar el mouse o tocar. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1 font-semibold text-text-industrial/70 mr-1"><GitBranch className="w-3.5 h-3.5" />{t("mp.samp.flow")}</span>
        {([1, 2, 3] as const).map(n => {
          const noLab = n === 2 && labRows.length === 0;
          const desc = noLab ? t("mp.samp.step2dNoLab") : t(`mp.samp.step${n}d` as Parameters<typeof t>[0]);
          return (
            <Fragment key={n}>
              {n > 1 && <ArrowRight className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 shrink-0" />}
              <span title={desc} aria-label={`${t(`mp.samp.step${n}` as Parameters<typeof t>[0])}: ${desc}`}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border py-0.5 pl-1 pr-2.5 font-bold cursor-help ${noLab ? "border-amber-400/70 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "border-violet-500/30 bg-violet-500/[0.06] text-fg"}`}>
                <span className={`w-[18px] h-[18px] rounded-full text-[10.5px] font-extrabold text-white flex items-center justify-center ${noLab ? "bg-amber-600" : "bg-violet-600"}`}>{n}</span>
                {t(`mp.samp.step${n}` as Parameters<typeof t>[0])}
                {n === 2 && <span className="font-semibold opacity-60">· {noLab ? t("mp.samp.step2shortNoLab") : t("mp.samp.step2short")}</span>}
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );

  /** "cada 72 meses", "cada 500 horas"… o el tipo, si no tiene frecuencia. */
  const freqPhrase = (tt: string, fm: string, fh: string): string | null => {
    const unit = needsHours(tt) ? "hours" : needsDays(tt) ? "days" : needsWeeks(tt) ? "weeks" : needsMonths(tt) ? "months" : null;
    if (!unit) return null;
    const n = unit === "hours" ? fh : fm;
    if (!n) return null;
    return t("mp.facts.every").replace("{n}", Number(n).toLocaleString()).replace("{unit}", t(`mp.unit.${unit}` as Parameters<typeof t>[0]));
  };

  // Franja de vencimiento: lo primero que hay que saber de un plan guardado.
  const dueInfo = useMemo(() => {
    if (!plan) return null;
    const es = computeStatus(plan);
    const tone: "bad" | "warn" | "ok" | "idle" =
      es === "OVERDUE" ? "bad" : (es === "DUE" || es === "UPCOMING" || es === "IN_WINDOW") ? "warn" : es === "NEVER_EXECUTED" ? "idle" : "ok";
    const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x * 100)));
    let headline = t("mp.due.none");
    let dueText: string | null = null;
    let pct: number | null = null;
    if (plan.nextDueHours != null) {
      dueText = `${plan.nextDueHours.toLocaleString()} h`;
      const cur = plan.assetCurrentHours;
      if (cur == null) {
        headline = t("mp.due.atHours").replace("{h}", plan.nextDueHours.toLocaleString());
      } else {
        const diff = plan.nextDueHours - cur;
        headline = diff <= 0
          ? t("mp.due.overdueHours").replace("{n}", Math.abs(diff).toLocaleString())
          : t("mp.due.inHours").replace("{n}", diff.toLocaleString());
        const last = plan.lastExecutionHours;
        if (last != null && plan.nextDueHours > last) pct = clamp((cur - last) / (plan.nextDueHours - last));
      }
    } else if (plan.nextDueDate) {
      const due = parseLocalDate(plan.nextDueDate);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
      dueText = fmtDate(plan.nextDueDate) ?? null;
      headline = days < 0
        ? t("mp.due.overdueDays").replace("{n}", String(-days))
        : days === 0 ? t("mp.due.today") : t("mp.due.inDays").replace("{n}", String(days));
      if (plan.lastExecutionDate) {
        const last = parseLocalDate(plan.lastExecutionDate).getTime();
        if (due.getTime() > last) pct = clamp((today.getTime() - last) / (due.getTime() - last));
      }
    }
    return { tone, headline, dueText, pct };
  }, [plan, t]);
  const DUE_TONE = {
    bad:  { box: "bg-red-500/10 text-red-700 dark:text-red-400",         text: "text-red-700 dark:text-red-400",         bar: "bg-red-500",     icon: CalendarX },
    warn: { box: "bg-amber-500/10 text-amber-700 dark:text-amber-400",   text: "text-amber-700 dark:text-amber-400",     bar: "bg-amber-500",   icon: CalendarClock },
    ok:   { box: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", text: "text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-500", icon: CalendarCheck },
    idle: { box: "bg-slate-500/10 text-slate-600 dark:text-slate-300",   text: "text-slate-700 dark:text-slate-300",     bar: "bg-slate-400",   icon: Clock },
  } as const;
  const leadPhrase = windowMode === "MANUAL" && windowLeadDays
    ? t("mp.due.leadDays").replace("{n}", windowLeadDays)
    : t("mp.due.leadAuto");
  const sfiLabel = sfiGroupNumber != null ? `${sfiGroupNumber} – ${t(`sfi.g.${sfiGroupNumber}` as Parameters<typeof t>[0])}` : null;
  const freqNow = freqPhrase(triggerType, frequencyMonths, frequencyHours);

  return (
    <>
      <div className={`fixed inset-0 ${overlayZClass ?? "z-50"} flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm`}>
        {/* overflow-hidden: la franja de identidad es un borde superior y sin esto
            asomaba fuera de las esquinas redondeadas. El cuerpo scrollea aparte. */}
        <div className={`w-full bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-3xl h-[90vh]"}`} onClick={e => e.stopPropagation()}>
          {/* Encabezado: de qué plan se trata (título grande), sobre qué equipo y
              los datos que lo identifican. La franja de color y el nombre de la
              entidad lo distinguen de la OT y la SS (lib/record-identity.tsx). */}
          <div className={`flex items-start gap-2 px-4 sm:px-6 py-3 border-b border-fg/10 shrink-0 ${recordHeaderClass("plan")}`}>
            <button
              type="button"
              onClick={requestClose}
              title={t("common.back")}
              aria-label={t("common.back")}
              className="p-2 -ml-1 rounded-xl text-fg/40 hover:text-fg hover:bg-fg/5 transition-all shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${RECORD_IDENTITY.plan.text}`}>
                <ClipboardList className="w-3.5 h-3.5 shrink-0" />
                {isNew ? t("mp.newPlan") : t("mp.entityLabel")}
              </h2>
              {(title.trim() || headerAssetName) && (
                <p className="max-w-full text-lg sm:text-xl font-black text-fg leading-tight truncate" title={title.trim() || headerAssetName || undefined}>
                  {title.trim() || headerAssetName}
                </p>
              )}
              {(headerAssetName || sfiLabel) && title.trim() && (
                <p className="text-xs text-text-industrial/60 truncate">{[headerAssetName, sfiLabel].filter(Boolean).join(" · ")}</p>
              )}
              {!isNew && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 font-mono text-[11px] font-bold text-fg">{plan.taskCode}</span>
                  {/* Nombre del buque, no el código. */}
                  <span className="inline-flex items-center gap-1 rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/70">
                    <Ship className="w-3 h-3" /><VesselLabel code={plan.vesselCode} className="text-[11px]" />
                  </span>
                  {/* Ir a la OT NO cierra antes el plan: cerrar ahora significa
                      "volver atrás", y hacerlo justo antes de navegar dejaba dos
                      navegaciones peleando. Basta con navegar — el cambio de ruta
                      desmonta este modal, y al cerrar la OT se vuelve acá. */}
                  <StatusBadgeInline plan={plan} onOpenWo={(code) => navigate(`/work-orders?autoCode=${code}`)} />
                  <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/70">
                    {t(`mp.taskTypeFull.${taskType}` as Parameters<typeof t>[0])}
                  </span>
                  {/* Este servicio termina en un certificado del proveedor. Sólo
                      informativo: el vínculo se administra desde /certificates. */}
                  {/* Plan de muestreo: se ve de lejos qué se analiza y a qué laboratorio va. */}
                  {samplingKind && (
                    <>
                      <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:text-violet-300">
                        <FlaskConical className="w-3 h-3" /> {t("mp.samp.chip").replace("{kind}", t(`mp.samp.kind.${samplingKind}` as Parameters<typeof t>[0]))}
                      </span>
                      {labRows.length > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:text-violet-300">
                          <Handshake className="w-3 h-3" /> {labRows.map(r => r.name).join(", ")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                          <AlertTriangle className="w-3 h-3" /> {t("mp.samp.chipNoLab")}
                        </span>
                      )}
                    </>
                  )}
                  {linkedCert && (
                    <button
                      type="button"
                      onClick={() => navigate("/certificates")}
                      title={t("mp.cert.renewsHint")}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-[11px] font-bold text-accent hover:bg-accent/20 transition-colors"
                    >
                      <FileText className="w-3 h-3" /> {t("mp.cert.renews").replace("{code}", linkedCert.certificateCode)}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {!isNew && <CopyLinkButton />}
              <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-text-industrial/30 hover:text-fg hover:bg-fg/5 transition-colors" title={expanded ? t("common.minimize") : t("common.maximize")}>
                {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <ModalCloseButton onClose={requestClose} />
            </div>
          </div>

          {/* Franja de vencimiento + la acción que corresponde (abrir la OT,
              ir a la que ya está abierta o reportar el resultado). */}
          {!isNew && dueInfo && (() => {
            const tone = DUE_TONE[dueInfo.tone];
            const ToneIcon = tone.icon;
            const lastText = needsHours(plan.triggerType)
              ? (plan.lastExecutionHours != null ? `${plan.lastExecutionHours.toLocaleString()} h` : t("mp.facts.never"))
              : (fmtDate(plan.lastExecutionDate) ?? t("mp.facts.never"));
            const planFreq = freqPhrase(plan.triggerType, String(plan.frequencyMonths ?? ""), String(plan.frequencyHours ?? ""))
              ?? t(`mp.tt.${plan.triggerType}` as Parameters<typeof t>[0]);
            return (
              <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr_auto] items-center gap-3 px-4 sm:px-6 py-2.5 border-b border-fg/10 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tone.box}`}><ToneIcon className="w-6 h-6" /></div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[15px] font-extrabold ${tone.text}`}>{dueInfo.headline}</p>
                    <p className="text-[11.5px] text-text-industrial/60 truncate">
                      {[dueInfo.dueText, plan.activeWorkOrderCode ? t("mp.due.woOpen").replace("{code}", plan.activeWorkOrderCode) : leadPhrase].filter(Boolean).join(" · ")}
                    </p>
                    {dueInfo.pct != null && (
                      <div className="mt-1 h-1.5 rounded-full bg-fg/10 overflow-hidden"><div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${dueInfo.pct}%` }} /></div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-text-industrial/60">
                  <span>{t("mp.modal.lastExecution")}<b className="block text-[13px] text-fg">{lastText}</b></span>
                  <span>{t("mp.facts.freq")}<b className="block text-[13px] text-fg">{planFreq}</b></span>
                  {plan.estimatedHours != null && <span>{t("mp.estimatedHours")}<b className="block text-[13px] text-fg">{plan.estimatedHours} h</b></span>}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {plan.activeWorkOrderCode && (
                    <button type="button" onClick={() => navigate(`/work-orders?autoCode=${plan.activeWorkOrderCode}`)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:brightness-110 transition-all flex items-center gap-1.5 whitespace-nowrap">
                      <ExternalLink className="w-3.5 h-3.5" /> {t("mp.goToWo").replace("{code}", plan.activeWorkOrderCode)}
                    </button>
                  )}
                  {canExecute && needsWO && !(plan.activeWorkOrderCode && plan.executionStatus === "IN_WINDOW") && (
                    <button
                      onClick={() => plan.activeWorkOrderCode ? setConfirmDuplicateWO(true) : setShowExecution(true)}
                      className={`px-4 py-2 rounded-xl font-bold text-xs transition-all whitespace-nowrap ${plan.activeWorkOrderCode
                        ? "bg-accent/10 border border-accent/20 text-accent hover:bg-accent/15"
                        : "bg-accent text-accent-fg hover:brightness-110"}`}
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
                      title={expressGoesToProvider ? t("mp.express.providerHint") : t("mp.express.hint")}
                      className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all whitespace-nowrap"
                    >
                      <span className="flex items-center gap-1.5">
                        {openingExpress ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                        {expressGoesToProvider
                          ? t("mp.col.executeWO")
                          : t("mp.modal.openExpressWO").replace("{abbr}", woTerms.abbr)}
                      </span>
                    </button>
                  )}
                  {canExecute && !needsWO && !isExpressMode && (
                    <button
                      onClick={() => setShowExecution(true)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:brightness-110 transition-all whitespace-nowrap"
                    >
                      {t("mp.modal.reportResult")}
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Cuerpo: índice de secciones + formulario. En pantalla chica el índice
              va arriba y se desliza de costado. */}
          <div className={`flex-1 min-h-0 grid grid-rows-[auto_1fr] ${expanded ? "md:grid-rows-1 md:grid-cols-[13rem_1fr]" : ""}`}>
            <nav className={`flex gap-1 overflow-x-auto border-b border-fg/10 px-3 py-2 bg-fg/[0.02] ${expanded ? "md:flex-col md:overflow-y-auto md:overflow-x-visible md:border-b-0 md:border-r md:py-3" : ""}`}>
              {PLAN_SECTIONS.map(k => {
                const m = sectionMeta[k];
                const Icon = m.icon;
                const on = activeSec === k;
                return (
                  <button key={k} type="button" onClick={() => goToSection(k)}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
                      on ? "bg-teal-500/10 text-teal-700 dark:text-teal-300" : "text-text-industrial/60 hover:bg-fg/5 hover:text-fg"
                    }`}>
                    <Icon className="w-4 h-4 shrink-0" />
                    {m.title}
                    {sectionMissing[k] > 0 && (
                      <span className="ml-auto rounded-full bg-amber-500/20 px-1.5 text-[10px] font-extrabold text-amber-800 dark:text-amber-300">{sectionMissing[k]}</span>
                    )}
                  </button>
                );
              })}
              {expanded && !readOnly && (
                <p className="hidden md:block px-2.5 pt-3 text-[10.5px] leading-snug text-text-industrial/40">{t("mp.nav.note")}</p>
              )}
            </nav>

            <div ref={bodyScrollRef} onScroll={onBodyScroll} className="relative min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
              {readOnly && (
                <div className="px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-700 dark:text-yellow-400">
                  {t("mp.modal.readOnly")}
                </div>
              )}

              {/* ── 1 · Qué se hace ── */}
              <div id="mp-sec-what">
                <GuideSection n={1} title={sectionMeta.what.title} subtitle={sectionMeta.what.sub} pill={sectionPill("what")}
                  open={openSecs.what} onToggle={() => setOpenSecs(s => ({ ...s, what: !s.what }))}>
                  <fieldset disabled={readOnly} className="min-w-0 space-y-3.5 disabled:opacity-70">
                    {/* Identificación: en el alta se elige todo; en un plan guardado el
                        buque ya está en el encabezado. */}
                    {isNew ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <GuideField id="mp-f-vessel" missing={missing.vessel}>
                          <label className={fLabelCls}>{t("mp.vesselCode")}<RequiredMark />{missing.vessel && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                          {loadingVessels
                            ? <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}</div>
                            : <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={lockAsset} className={`${selectCls} disabled:opacity-60`}>
                                <option value="">{t("mp.modal.selectVessel")}</option>
                                {vessels.map(v => <option key={v.code} value={v.code}>{v.name || v.code}</option>)}
                              </select>
                          }
                        </GuideField>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className={fLabelCls}>{t("mp.taskCode")}</label>
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
                        <GuideField id="mp-f-asset-new" missing={missing.asset}>
                          <label className={fLabelCls}>{t("mp.asset")}<RequiredMark />{missing.asset && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
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
                        </GuideField>
                        {sfiGroupField}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr_1fr] gap-3">
                        <div className="space-y-1.5">
                          <label className={fLabelCls}>{t("mp.taskCode")}</label>
                          {isAdmin
                            ? <input value={taskCode} onChange={e => setTaskCode(e.target.value.toUpperCase())} className={`${inputCls} font-mono font-bold`} />
                            : <p className="py-2 text-sm font-mono font-bold text-fg">{plan.taskCode}</p>}
                        </div>
                        <GuideField id="mp-f-asset" missing={missing.asset}>
                          {assetId
                            ? <button
                                type="button"
                                // A la ficha del equipo, directo. NO se cierra el plan
                                // antes: cerrar es "volver atrás" y dejaba dos
                                // navegaciones peleando — basta con navegar, el cambio
                                // de ruta desmonta este modal. La ruta es /equipment:
                                // /assets es sólo un alias viejo.
                                onClick={() => navigate(`/equipment?open=${encodeURIComponent(assetId)}`)}
                                className={`${fLabelCls} hover:text-accent transition-colors cursor-pointer`}
                                title={t("mp.modal.openAsset")}
                              >{t("mp.asset")}<RequiredMark /> ↗</button>
                            : <label className={fLabelCls}>{t("mp.asset")}<RequiredMark />{missing.asset && <GuideNeedTag label={t("mp.guide.missing")} />}</label>}
                          {loadingAssets
                            ? <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("mp.modal.loadingAssets")}</div>
                            : <AssetSearchDropdown assets={assets} value={assetId} onChange={setAssetId} />
                          }
                        </GuideField>
                        {sfiGroupField}
                      </div>
                    )}

                    {/* Tipo de tarea + origen del criterio (ISM 10.1) */}
                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-3">
                      <div className="space-y-1.5">
                        <label className={fLabelCls}>{t("mp.taskType")}</label>
                        <div className="flex gap-2">
                          {(["MAINTENANCE", "INSPECTION"] as const).map(tt => (
                            <button key={tt} type="button" onClick={() => setTaskType(tt)}
                              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-xs font-bold transition-all ${
                                taskType === tt
                                  ? "bg-teal-500/10 border-teal-600/50 text-teal-700 dark:text-teal-300"
                                  : "bg-fg/5 border-fg/10 text-text-industrial/50 hover:border-fg/20 hover:text-fg"
                              }`}>
                              {tt === "MAINTENANCE" ? <Wrench className="w-3.5 h-3.5" /> : <SearchCheck className="w-3.5 h-3.5" />}
                              {t(`mp.taskTypeFull.${tt}` as Parameters<typeof t>[0])}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* De qué regla nace la tarea. Es lo que el Código ISM 10.1 le pide
                          mostrar a la Compañía: requisito → tarea de mantenimiento. */}
                      <div className="space-y-1.5">
                        <label className={fLabelCls} title={t("mp.criteriaSource.hint")}>
                          {t("mp.criteriaSource")} <span className="font-normal text-text-industrial/40">· {t("mp.f.criteriaSourceHint")}</span>
                        </label>
                        <select value={criteriaSource} onChange={e => setCriteriaSource(e.target.value as CriteriaSource | "")} className={selectCls} disabled={readOnly}>
                          <option value="">{t("mp.cs.none")}</option>
                          {CRITERIA_SOURCES.map(cs => <option key={cs} value={cs}>{t(`mp.cs.${cs}` as any)}</option>)}
                        </select>
                      </div>
                    </div>

                    {samplingBlock}

                    <GuideField id="mp-f-title" missing={missing.title}>
                      <label className={fLabelCls}>{t("col.title")}<RequiredMark />{missing.title && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                      <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
                    </GuideField>

                    <div className="space-y-1.5">
                      <label className={fLabelCls}>{t("mp.f.tasks")}</label>
                      <RichTextArea value={description} onChange={setDescription} rows={3} className={inputCls} />
                    </div>

                    <GuideField id="mp-f-criteria" missing={missing.criteria}>
                      <div className="flex items-center gap-1">
                        <label className={fLabelCls}>{t("mp.acceptanceCriteria")}</label>
                        {missing.criteria && <GuideNeedTag label={t("mp.guide.missing")} />}
                        {aiPill(() => { void handleAcceptanceCriteriaClick(); }, loadingCriteria, t("mp.modal.aiCriteriaTooltip"))}
                      </div>
                      <RichTextArea value={acceptanceCriteria} onChange={setAcceptanceCriteria} rows={2} className={inputCls} disabled={loadingCriteria} />
                    </GuideField>
                  </fieldset>
                </GuideSection>
              </div>

              {/* ── 2 · Cuándo ── */}
              <div id="mp-sec-when">
                <GuideSection n={2} title={sectionMeta.when.title} subtitle={sectionMeta.when.sub}
                  open={openSecs.when} onToggle={() => setOpenSecs(s => ({ ...s, when: !s.when }))}>
                  <fieldset disabled={readOnly} className="min-w-0 space-y-3.5 disabled:opacity-70">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <label className={fLabelCls}>{t("mp.f.scheduleBy")}</label>
                        <select value={triggerType} onChange={e => setTriggerType(e.target.value as TriggerType)} className={selectCls}>
                          {TRIGGER_TYPES.map(tt => <option key={tt} value={tt}>{t(`mp.tt.${tt}` as any)}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className={fLabelCls}>
                          {needsHours(triggerType) ? t("mp.f.everyHours") : needsDays(triggerType) ? t("mp.f.everyDays") : needsWeeks(triggerType) ? t("mp.f.everyWeeks") : t("mp.f.everyMonths")}
                        </label>
                        {needsHours(triggerType)
                          ? <input type="number" min="1" value={frequencyHours} onChange={e => setFrequencyHours(e.target.value)} className={inputCls} />
                          : <input type="number" min="1" value={frequencyMonths} onChange={e => setFrequencyMonths(e.target.value)} className={inputCls} disabled={triggerType === "CONDITION" || triggerType === "EVENT"} />
                        }
                      </div>
                      <div className="space-y-1.5">
                        <label className={fLabelCls}>{t("mp.f.onExecute")}</label>
                        <select value={triggerResultMode} onChange={e => setTriggerResultMode(e.target.value)} className={selectCls}>
                          {TRIGGER_RESULT_MODES.map(m => <option key={m} value={m}>{t(`mp.trm.${m}` as any)}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Aviso de MOC apenas cambia la frecuencia: antes aparecía recién
                        al tocar Guardar. El popup de Guardar sigue igual. */}
                    {planChangedFrequency && !readOnly && (
                      <div className="flex items-start gap-2 rounded-xl border border-orange-500/35 bg-orange-500/[0.07] px-3 py-2 text-xs text-orange-800 dark:text-orange-200">
                        <GitBranch className="w-4 h-4 shrink-0 mt-px" />
                        <p><b>{t("mp.moc.inlineTitle")}</b> {t("mp.moc.inlineBody")}</p>
                      </div>
                    )}

                    {/* Última ejecución y próximo vencimiento. Quien puede corregir los
                        hitos los edita; el resto los ve. El próximo vencimiento se
                        calcula solo desde la frecuencia (el backend lo confirma). */}
                    {!isNew && (() => {
                      const preview = previewNextDue(triggerType, lastExecDate, lastExecHours, frequencyMonths, frequencyHours);
                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="space-y-1.5">
                            <label className={fLabelCls}>{t("mp.modal.lastExecution")}</label>
                            {canEditMilestones ? (
                              needsHours(triggerType)
                                ? <input type="number" value={lastExecHours} onChange={e => setLastExecHours(e.target.value)} placeholder="Horas" className={`${inputCls} font-mono`} />
                                : <input type="date" value={lastExecDate} onChange={e => setLastExecDate(e.target.value)} className={`${inputCls} font-mono`} />
                            ) : (
                              <p className="py-2 text-sm text-fg font-mono">
                                {needsHours(plan.triggerType)
                                  ? (plan.lastExecutionHours != null ? `${plan.lastExecutionHours.toLocaleString()}h` : "—")
                                  : (fmtDate(plan.lastExecutionDate) ?? "—")}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <label className={fLabelCls}>{t("mp.modal.nextDueDate")}</label>
                            {canEditMilestones ? (
                              needsHours(triggerType)
                                ? <input type="number" value={nextDueHoursOverride} onChange={e => setNextDueHoursOverride(e.target.value)} placeholder="Horas" className={`${inputCls} font-mono text-accent`} />
                                : <input type="date" value={nextDueDateOverride} onChange={e => setNextDueDateOverride(e.target.value)} className={`${inputCls} font-mono text-accent`} />
                            ) : (
                              <p className="py-2 text-sm font-mono text-accent">
                                {isAdmin
                                  ? (preview?.text ?? (needsHours(plan.triggerType)
                                      ? (plan.nextDueHours != null ? `${plan.nextDueHours.toLocaleString()}h` : "—")
                                      : (fmtDate(plan.nextDueDate) ?? "—")))
                                  : (needsHours(plan.triggerType)
                                      ? (plan.nextDueHours != null ? `${plan.nextDueHours.toLocaleString()}h` : "—")
                                      : (fmtDate(plan.nextDueDate) ?? "—"))}
                              </p>
                            )}
                            {canEditMilestones
                              ? <p className="text-[10px] text-text-industrial/45">{t("mp.modal.nextDueManualHint")}</p>
                              : isAdmin && preview && <p className="text-[10px] text-text-industrial/45">{t("mp.modal.nextDueAuto")}</p>}
                          </div>
                          <div className="space-y-1.5">
                            <label className={fLabelCls}>{t("mp.f.estHours")}</label>
                            <input type="number" min="0" step="0.5" value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)} placeholder="—" className={inputCls} disabled={readOnly} />
                          </div>
                        </div>
                      );
                    })()}
                    {isNew && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <label className={fLabelCls}>{t("mp.f.estHours")}</label>
                          <input type="number" min="0" step="0.5" value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)} placeholder="—" className={inputCls} />
                        </div>
                      </div>
                    )}

                    {/* Aviso anticipado (ventana de ejecución) */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <label className={fLabelCls}>{t("mp.f.windowMode")}</label>
                        <select value={windowMode} onChange={e => { setWindowMode(e.target.value); if (e.target.value === "AUTO") setWindowLeadDays(""); }} className={selectCls} disabled={readOnly}>
                          <option value="AUTO">{t("mp.f.windowAuto")}</option>
                          <option value="MANUAL">{t("mp.f.windowManual")}</option>
                        </select>
                      </div>
                      {/* En AUTO los días los calcula el sistema: el campo no se muestra. */}
                      {windowMode !== "AUTO" && (
                        <div className="space-y-1.5">
                          <label className={fLabelCls}>{t("mp.f.leadDays")}</label>
                          <input type="number" min="0" value={windowLeadDays} onChange={e => setWindowLeadDays(e.target.value)}
                            placeholder={t("mp.modal.leadDaysManualPlaceholder")} disabled={readOnly} className={inputCls} />
                        </div>
                      )}
                    </div>

                    {/* La programación dicha en una frase, para no tener que interpretarla. */}
                    <div className="flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/[0.06] px-3 py-2 text-[12.5px] text-sky-900 dark:text-sky-200">
                      <Info className="w-4 h-4 shrink-0 mt-px" />
                      <p>
                        {freqNow ? t("mp.sentence.every").replace("{freq}", freqNow) : t("mp.sentence.noFreq")}{" "}
                        {windowMode === "MANUAL" && windowLeadDays
                          ? t("mp.sentence.window").replace("{n}", windowLeadDays)
                          : t("mp.sentence.windowAuto")}
                      </p>
                    </div>
                  </fieldset>
                </GuideSection>
              </div>

              {/* ── 3 · Quién y con qué ── */}
              <div id="mp-sec-who">
                <GuideSection n={3} title={sectionMeta.who.title} subtitle={sectionMeta.who.sub} pill={sectionPill("who")}
                  open={openSecs.who} onToggle={() => setOpenSecs(s => ({ ...s, who: !s.who }))}>
                  <fieldset disabled={readOnly} className="min-w-0 space-y-3.5 disabled:opacity-70">
                    <div className="space-y-1.5">
                      <label className={fLabelCls}>{t("mp.f.area")}</label>
                      <div className="flex flex-wrap gap-2">
                        {(["CUBIERTA", "MAQUINAS", "BARCAZA", "PROVEEDOR", "OTROS"] as const).map(d => (
                          <button key={d} type="button"
                            onClick={() => { const next = department === d ? "" : d; setDepartment(next); if (next !== "PROVEEDOR") setProviderRequests([]); }}
                            className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
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
                        <div className="space-y-2 pt-1">
                          <p className="text-[11px] text-text-industrial/50">{t("mp.f.providersHint")}</p>
                          {providerRequests.map((row, i) => (
                            <div key={i} className={`flex items-start gap-2 ${row.providerId && !row.purpose.trim() && !readOnly ? "rounded-xl border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-500/10 px-2 py-1.5" : ""}`}>
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
                                <div className="space-y-1">
                                  <input
                                    value={row.purpose}
                                    onChange={e => setProviderRequests(prev => prev.map((r, j) => j === i ? { ...r, purpose: e.target.value } : r))}
                                    placeholder={t("mp.providerRequests.purposePlaceholder")}
                                    className={inputCls}
                                  />
                                  {row.providerId && !row.purpose.trim() && !readOnly && <GuideNeedTag label={t("mp.guide.missing")} />}
                                </div>
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
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-dashed border-fg/25 text-xs font-bold text-text-industrial/70 hover:border-accent/40 hover:text-fg transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" /> {t("mp.providerRequests.add")}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 items-start">
                      <GuideField id="mp-f-responsible" missing={missing.responsible}>
                        <label className={fLabelCls}>{t("mp.responsible")}{missing.responsible && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                        <input value={responsible} onChange={e => setResponsible(e.target.value)} placeholder={t("mp.f.responsiblePh")} className={inputCls} />
                      </GuideField>
                      <div className="space-y-1.5">
                        <label className={fLabelCls}>{t("mp.f.planStatus")}</label>
                        <select value={status} onChange={e => setStatus(e.target.value)} className={selectCls}>
                          {EDITABLE_STATUSES.map(item => <option key={item} value={item}>{t(`mp.status.${item}` as any)}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Repuestos / materiales previstos (preview V42): salen del catálogo
                        /Spares (con stock) o van a mano. Al abrir la OT se heredan. NO descuenta stock. */}
                    {!requiresSpares ? (
                      <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed border-fg/15 px-3.5 py-3">
                        <span className="w-9 h-9 rounded-xl bg-fg/5 text-text-industrial/40 flex items-center justify-center shrink-0"><Package className="w-5 h-5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-extrabold text-fg">{t("mp.spares.question")}</span>
                          <span className="block text-[11.5px] text-text-industrial/60">{t("mp.spares.questionHint")}</span>
                        </span>
                        <div className="flex rounded-xl border border-fg/10 bg-fg/5 p-0.5 ml-auto">
                          <span className="rounded-lg bg-surface px-3.5 py-1.5 text-xs font-extrabold text-fg shadow-sm">{t("mp.samp.no")}</span>
                          <button type="button" onClick={() => setRequiresSpares(true)} className="rounded-lg px-3.5 py-1.5 text-xs font-extrabold text-text-industrial/60 hover:text-fg">{t("mp.samp.yes")}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border-2 border-cyan-600/30 bg-gradient-to-b from-cyan-500/[0.06] to-transparent px-3.5 py-3 space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="w-9 h-9 rounded-xl bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 flex items-center justify-center shrink-0"><Package className="w-5 h-5" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-extrabold text-fg">{t("mp.spares.requires")}</span>
                            <span className="block text-[11.5px] text-text-industrial/60">{t("mp.spares.hint")}</span>
                          </span>
                          <div className="flex rounded-xl border border-fg/10 bg-fg/5 p-0.5 ml-auto">
                            <button type="button" onClick={() => setRequiresSpares(false)} className="rounded-lg px-3.5 py-1.5 text-xs font-extrabold text-text-industrial/60 hover:text-fg">{t("mp.samp.no")}</button>
                            <span className="rounded-lg bg-cyan-700 px-3.5 py-1.5 text-xs font-extrabold text-white">{t("mp.samp.yes")}</span>
                          </div>
                        </div>
                        <PlannedItemsEditor items={plannedSpares} onChange={setPlannedSpares} spares={spareCatalog} disabled={readOnly} />
                      </div>
                    )}
                  </fieldset>
                </GuideSection>
              </div>

              {/* ── 4 · Seguridad ── */}
              <div id="mp-sec-safety">
                <GuideSection n={4} title={sectionMeta.safety.title} subtitle={sectionMeta.safety.sub} pill={sectionPill("safety")}
                  open={openSecs.safety} onToggle={() => setOpenSecs(s => ({ ...s, safety: !s.safety }))}>
                  <fieldset disabled={readOnly} className="min-w-0 space-y-3.5 disabled:opacity-70">
                    {permitBlock}
                    <GuideField id="mp-f-loto" missing={missing.loto}>
                      <div className="flex items-center gap-1">
                        <label className={fLabelCls}>{t("mp.f.lotoTitle")}</label>
                        {missing.loto && <GuideNeedTag label={t("mp.guide.missing")} />}
                        {aiPill(() => { void handleLotoClick(); }, loadingLoto, t("wo.ai.lotoTooltip"))}
                      </div>
                      <RichTextArea value={loto} onChange={setLoto} rows={2} className={inputCls} disabled={loadingLoto} />
                    </GuideField>

                    {/* Nivel de riesgo + matriz + resultado (componente compartido con
                        Diferimientos: su título sigue siendo el que pide la sugerencia). */}
                    <GuideField id="mp-f-risk" missing={missing.risk}>
                      {missing.risk && <GuideNeedTag label={t("mp.guide.missing")} />}
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
                    </GuideField>

                    {/* RCM consequence — "si esta tarea no se hace, ¿qué pasa?" */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1">
                        <label className={fLabelCls}>
                          {t("wo.modal.consequenceTitle")}
                          <span className="ml-1 font-normal text-text-industrial/45">{t("wo.modal.consequenceHint")}</span>
                        </label>
                        {aiPill(() => { void handleConsequenceClick(); }, loadingConsequence, t("wo.modal.consequenceTooltip"))}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-[14rem_1fr] gap-2">
                        <select
                          value={consequenceCategory}
                          onChange={e => setConsequenceCategory(e.target.value as any)}
                          disabled={readOnly || loadingConsequence}
                          className={selectCls}
                        >
                          <option value="">{t("wo.modal.consequenceUnclassified")}</option>
                          <option value="SAFETY">{t("wo.modal.consequence.safety")}</option>
                          <option value="ENVIRONMENTAL">{t("wo.modal.consequence.environmental")}</option>
                          <option value="OPERATIONAL">{t("wo.modal.consequence.operational")}</option>
                          <option value="NON_OPERATIONAL">{t("wo.modal.consequence.nonOperational")}</option>
                        </select>
                        <RichTextArea value={consequenceRationale} onChange={setConsequenceRationale} rows={2} className={inputCls} disabled={readOnly || loadingConsequence} />
                      </div>
                    </div>
                  </fieldset>
                </GuideSection>
              </div>

              {/* ── 5 · Documentos ── (el plan de muestreo subió a "Qué se hace", V17b) */}
              <div id="mp-sec-docs">
                <GuideSection n={5} title={sectionMeta.docs.title} subtitle={sectionMeta.docs.sub}
                  open={openSecs.docs} onToggle={() => setOpenSecs(s => ({ ...s, docs: !s.docs }))}>
                  <fieldset disabled={readOnly} className="min-w-0 space-y-3.5 disabled:opacity-70">
                    {/* LISTA DE CHEQUEO del ítem del PDM (Word / PDF / Excel). Siempre
                        visible: es la planilla que se usa al ejecutar, y en una
                        inspección es lo que se completa. */}
                    <div className="space-y-1.5">
                      <label className={fLabelCls}>{t("mp.checklistTemplate")}</label>
                      {taskType === "INSPECTION" && (
                        <p className="text-[11px] text-text-industrial/50">{t("mp.checklistInspectionHint")}</p>
                      )}
                      <div className="rounded-xl border border-fg/10 bg-fg/5 p-3 space-y-3">
                        {checklistTemplate && (checklistTemplate.startsWith("/uploads/") || checklistTemplate.startsWith("/app/files/")) ? (
                          <div className="flex items-center justify-between gap-3">
                            <button type="button"
                              onClick={() => { void downloadAuthedFile(checklistTemplate); }}
                              className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 hover:text-green-300 truncate"
                              title={t("mp.f.downloadTemplate")}>
                              <FileSpreadsheet className="w-4 h-4 shrink-0" />
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

                  </fieldset>
                </GuideSection>
              </div>

              {/* Los avisos de este formulario van en una ventanita con OK
                  (ver AlertDialog al final del modal): al pie del formulario
                  quedaban fuera de la vista y parecía que el botón no hacía nada. */}
            </div>
          </div>

          {/* Pie: historial y PDF a la izquierda; guardar a la derecha, con lo que falta. */}
          <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-t border-fg/10 bg-surface dark:bg-[#0D1B2A] shrink-0">
            {/* Borrar el plan NO vive acá: está en la última columna de la
                planilla de planes, igual que en Equipos. */}
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
            <span className="flex-1" />
            {!readOnly && planDirty && !justSaved && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-amber-700 dark:text-amber-400">
                <CircleDot className="w-3 h-3" /> {t("mp.guide.dirty")}
              </span>
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
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : justSaved ? <><CheckCircle2 className="w-4 h-4" />{t("mp.modal.saved")}</> : (
                  <>
                    <Save className="w-3.5 h-3.5" />{t("common.save")}
                    {totalMissing > 0 && <span className="text-[10px] font-semibold opacity-85">{t("mp.guide.saveMissing").replace("{n}", String(totalMissing))}</span>}
                  </>
                )}
              </button>
            )}
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
          // Con overrides de lo que el admin ya haya tipeado en este modal sin
          // guardar todavía — buildWoPrefillFromPlan hereda del plan, pero acá
          // lo que hay en pantalla manda por sobre lo guardado.
          prefill={buildWoPrefillFromPlan(
            {
              ...plan,
              description: description || plan.description,
              acceptanceCriteria: acceptanceCriteria || plan.acceptanceCriteria,
              responsible: responsible || plan.responsible,
              loto: loto || plan.loto,
              riskLevel: riskLevel || plan.riskLevel,
              riskAnalysisResult: riskAnalysisResult || plan.riskAnalysisResult,
              consequenceCategory: (consequenceCategory as ("SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | "")) || plan.consequenceCategory || null,
              consequenceRationale: consequenceRationale || plan.consequenceRationale,
              estimatedHours: estimatedHours ? Number(estimatedHours) : plan.estimatedHours,
              samplingFluidType: samplingFluidType || plan.samplingFluidType,
            },
            t("mp.modal.maintenancePlanLabel"),
          )}
          onClose={() => setShowExecution(false)}
          // Igual que desde la lista de planes: la OT recién creada se abre
          // para completarla y enviarla a aprobar.
          onSaved={(_woId, workOrderCode) => {
            setShowExecution(false);
            void onSaved();
            if (workOrderCode) {
              // Nos vamos a la OT. No se llama a onClose(): ese cierre también
              // navega (vuelve al plan/lista) y pelearía con este navigate —
              // irse de la pantalla ya desmonta el modal.
              navigate(`/work-orders/${encodeURIComponent(workOrderCode)}`);
              return;
            }
            onClose();
          }}
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
          <div className="w-full max-w-xl bg-surface dark:bg-[#0D1B2A] border border-orange-500/40 rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-orange-700 dark:text-orange-300" />
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
            {/* El texto tenía un solo tono (yellow-200), pensado para el fondo
                oscuro: sobre el claro quedaba casi invisible. Ahora el color se
                declara para los dos temas. */}
            <div className="rounded-lg bg-orange-500/[0.08] border border-orange-500/30 px-3 py-2 text-[11px] text-orange-800 dark:text-orange-200/90 leading-relaxed">
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

      {/* Avisos del formulario (validaciones, errores al guardar o al abrir la
          OT) en una ventanita con OK. */}
      {actionError && (
        <AlertDialog message={actionError} onClose={() => setActionError(null)} />
      )}
    </>
  );
};

// ─── Borrar plan (desde la planilla) ──────────────────────────────────────────

/**
 * Borrar un plan pide DOS confirmaciones: 1 = "¿estás seguro?", 2 = el aviso de
 * que es un plan registrado, no una OT suelta. Vive en la lista (última columna),
 * no en la ficha del plan.
 */
const DeletePlanDialog: React.FC<{
  plan: MaintenancePlan;
  onClose: () => void;
  onDeleted: () => void;
}> = ({ plan, onClose, onDeleted }) => {
  const t = useT();
  const woTerms = useWoTerms();
  const [step, setStep] = useState<1 | 2>(1);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-surface dark:bg-[#0D1B2A] border border-red-500/30 rounded-2xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0">
            {step === 1
              ? <Trash2 className="w-4 h-4 text-red-700 dark:text-red-400" />
              : <AlertTriangle className="w-4 h-4 text-red-700 dark:text-red-400" />}
          </div>
          <div>
            <p className="text-sm font-bold text-fg">
              {step === 1
                ? t("mp.modal.deleteTitle")
                : t("mp.modal.deleteTitle2").replace("{wo}", woTerms.abbr)}
            </p>
            <p className="text-xs text-text-industrial/70 mt-1">
              {step === 1 ? (
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
        {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors"
          >
            {t("common.cancel")}
          </button>
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 rounded-xl bg-red-600 text-fg font-bold text-xs hover:brightness-110 transition-all"
            >
              {t("mp.modal.deleteStep1Confirm")}
            </button>
          ) : (
            <button
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                setErr(null);
                try {
                  await api.delete(`/app/pms/maintenance-plans/${plan.id}`);
                  onDeleted();
                } catch (e) {
                  setErr(e instanceof ApiError ? e.message : t("mp.modal.deleteError"));
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
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const MaintenancePlansPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const can = useCan();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const statusFilter        = (searchParams.get("status")          ?? "").trim();
  const vesselFilter        = (searchParams.get("vesselCode")      ?? "").trim();
  const executionFilter     = (searchParams.get("executionStatus") ?? "").trim();
  // Deep-link a los ítems de UN equipo puntual (ej. desde el acceso del Dashboard).
  const assetFilter         = (searchParams.get("assetId")         ?? "").trim();
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

  // Deep-link al grupo SFI (ej. desde el acceso del Dashboard): ?sfiTab=6.
  const sfiTabParam = (searchParams.get("sfiTab") ?? "").trim();
  const sfiTabParamNum = sfiTabParam === "" ? NaN : Number(sfiTabParam);
  const initialSfiTab: SfiTab = Number.isInteger(sfiTabParamNum) && sfiTabParamNum >= 0 && sfiTabParamNum <= 9
    ? (sfiTabParamNum as SfiTab)
    : "ALL";
  const [sfiTab,        setSfiTab]        = useState<SfiTab>(initialSfiTab);
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
  // Si el link ya trae un orden por columna (?sort=), arranca desagrupado: si
  // no, se abre el link ordenado y la lista se ve agrupada, sin el orden.
  const [groupByEquipment, setGroupByEquipment] = useState(() => !searchParams.get("sort"));
  const [collapsedGroups,  setCollapsedGroups]  = useState<Set<string>>(new Set());
  const [executing,     setExecuting]     = useState<MaintenancePlan | null>(null);
  const [reporting,     setReporting]     = useState<MaintenancePlan | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [pageError,     setPageError]     = useState<string | null>(null);

  // ── Lista (preview V27) ──
  // Abre en "Para hacer". Si se llega con un filtro en el link (Dashboard, TMSA,
  // semana, equipo…) se respeta ese filtro y se muestran todas.
  const arrivedFiltered = !!(executionFilter || overdueOnly || weekStartFilter || assetFilter || sfiTabParam || searchParams.get("tmsa"));
  const [stageSel, setStageSel] = useState<"todo" | "soon" | "ok" | "all">(() => (arrivedFiltered ? "all" : "todo"));
  const [cardSel, setCardSel] = useState<"" | PlanBucket>("");
  const [qualitySel, setQualitySel] = useState<"" | "nodue" | "criteria" | "responsible" | "risk">("");
  const [typeSel, setTypeSel] = useState<"" | "MAINTENANCE" | "INSPECTION">("");
  const [whoSel, setWhoSel] = useState<"" | "onboard" | "provider">("");
  const [qualityOpen, setQualityOpen] = useState(() => { try { return localStorage.getItem("mp.quality") !== "0"; } catch { return true; } });
  const toggleQuality = () => setQualityOpen(v => { try { localStorage.setItem("mp.quality", v ? "0" : "1"); } catch { /* sin almacenamiento */ } return !v; });
  const [moreOpen, setMoreOpen] = useState(false);

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
    if (assetFilter) params.set("assetId", assetFilter);
    const query = params.toString();
    return `/app/pms/maintenance-plans${query ? `?${query}` : ""}`;
  }, [statusFilter, vesselFilter, assetFilter]);

  const { data: rawData, loading, error, reload } = useFetch<ListResponse>(path, [path]);
  // Filtro que llega desde una métrica del panel TMSA (lib/tmsa-filter.tsx).
  const tmsaFilter = useTmsaFilter();

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
  const baseItems = useMemo(() => rawData?.items ?? [], [rawData]);
  // Con un solo buque en la lista, repetir su nombre en las 193 filas no informa
  // nada: ya está elegido en el selector de arriba. La columna se saca sola y el
  // código de tarea y el SFI se mudan debajo del nombre de la tarea. Sale de los
  // datos y no del filtro, así vale igual si la lista quedó con un solo buque
  // por cualquier otro camino.
  const singleVessel = useMemo(() => {
    const codes = new Set(baseItems.map(p => p.vesselCode));
    return codes.size === 1;
  }, [baseItems]);
  // Reuse VesselContext (already loaded for the header selector) to avoid a duplicate /app/vessels fetch.
  const { vessels, selectedVesselCode, selectedVessel } = useVesselContext();
  const vesselNameMap = useMemo(() => new Map(vessels.map(v => [v.code, v.name])), [vessels]);

  // ── Planilla de Mantenimiento (.xlsx) ──
  // La arma el cliente con los planes COMPLETOS del buque (la exportación pide
  // su propia lista, no la que está filtrada en pantalla).
  const { tenant } = useAuth();
  const [exportingSheet, setExportingSheet] = useState(false);
  const exportSheet = useCallback(async () => {
    if (exportingSheet || !selectedVesselCode) return;
    setExportingSheet(true);
    try {
      await exportMaintenanceSheet({
        vesselCode: selectedVesselCode,
        vesselName: selectedVessel?.name ?? selectedVesselCode,
        // La planilla va a papel: siempre el logo para fondo blanco.
        logoUrl: tenant?.logoUrl || tenant?.logoUrlLight || null,
      });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("mp.page.exportSheetFailed"));
    } finally {
      setExportingSheet(false);
    }
  }, [exportingSheet, selectedVesselCode, selectedVessel, tenant, t]);

  // ── Client-side filters: SFI tab + overdue toggle + SFI text ──────────────
  const data = useMemo(() => {
    if (!rawData) return null;
    let items = baseItems;

    // Al llegar desde el panel TMSA, sólo los planes que contó esa tarjeta.
    items = applyTmsaFilter(items, tmsaFilter, p => p.id) ?? items;

    if (sfiTab !== "ALL") {
      items = items.filter(p => sfiTabOf(p.sfiGroupNumber) === sfiTab);
    }
    if (executionFilter) {
      // El donut del Panel puede mandar VARIAS situaciones en una (ej.
      // "DUE,UPCOMING", que ahí van en un solo gajo). Y se compara contra la
      // situación MOSTRADA, para que al clickear "Fuera de servicio" salgan
      // justo las filas que la lista rotula así.
      const wanted = new Set(executionFilter.split(",").map(s => s.trim()).filter(Boolean));
      items = items.filter(p => wanted.has(displayStatus(p, oosAssetIds.has(p.assetId))));
    } else if (overdueOnly) {
      items = items.filter(p => { const s = computeStatus(p); return s === "OVERDUE" || s === "DUE" || s === "IN_WINDOW"; });
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      items = items.filter(p =>
        textMatches(p.vesselCode ?? "", q) ||
        textMatches(p.taskCode ?? "", q) ||
        textMatches(p.title ?? "", q) ||
        textMatches(p.description ?? "", q) ||
        textMatches(p.responsible ?? "", q) ||
        String(p.sfiGroupNumber ?? "").includes(q) ||
        textMatches(p.assetName ?? "", q)
      );
    }
    // Filtro por semana: planes con ocurrencia proyectada esa semana (IDs del backend).
    // Mientras carga (weekPlanIds == null), no mostramos nada para evitar un flash de todos.
    if (weekStartFilter) {
      items = weekPlanIds ? items.filter(p => weekPlanIds.has(p.id)) : [];
    }
    if (typeSel) items = items.filter(p => p.taskType === typeSel);
    if (whoSel) items = items.filter(p => (whoSel === "provider") === planHasProvider(p));
    return { items, total: items.length };
  }, [rawData, baseItems, sfiTab, overdueOnly, searchText, weekStartFilter, weekPlanIds, executionFilter, tmsaFilter, oosAssetIds, typeSel, whoSel]);

  // Etapa, tarjeta y "Calidad del plan" se aplican sobre la base ya filtrada; los
  // contadores salen de la base, así cada tarjeta dice cuántas hay de verdad.
  const bucketOf = useCallback((p: MaintenancePlan) => planBucket(p, oosAssetIds.has(p.assetId)), [oosAssetIds]);
  const qualityMatch = useCallback((p: MaintenancePlan, k: string) => {
    if (p.status === "INACTIVE") return false;
    switch (k) {
      case "nodue":       return hasNoDue(p);
      case "criteria":    return p.hasAcceptanceCriteria === false;
      case "responsible": return !(p.responsible ?? "").trim();
      case "risk":        return !p.riskLevel;
      default:            return true;
    }
  }, []);
  const shownItems = useMemo(() => {
    const items = data?.items ?? [];
    if (qualitySel) return items.filter(p => qualityMatch(p, qualitySel));
    if (cardSel) return items.filter(p => bucketOf(p) === cardSel);
    switch (stageSel) {
      case "todo": return items.filter(p => { const b = bucketOf(p); return b === "over" || b === "now"; });
      case "soon": return items.filter(p => bucketOf(p) === "soon");
      case "ok":   return items.filter(p => { const b = bucketOf(p); return b === "ok" || b === "oos"; });
      default:     return items;
    }
  }, [data, qualitySel, cardSel, stageSel, bucketOf, qualityMatch]);
  const bucketCounts = useMemo(() => {
    const c: Record<PlanBucket, number> = { over: 0, now: 0, soon: 0, ok: 0, nodue: 0, oos: 0 };
    for (const p of data?.items ?? []) c[bucketOf(p)] += 1;
    return c;
  }, [data, bucketOf]);
  const qualityCounts = useMemo(() => {
    const items = (data?.items ?? []).filter(p => p.status !== "INACTIVE");
    return {
      nodue: items.filter(p => qualityMatch(p, "nodue")).length,
      criteria: items.filter(p => qualityMatch(p, "criteria")).length,
      responsible: items.filter(p => qualityMatch(p, "responsible")).length,
      risk: items.filter(p => qualityMatch(p, "risk")).length,
    };
  }, [data, qualityMatch]);

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

  // Borrar el plan se hace desde la última columna de la planilla (igual que en
  // Equipos), no desde la ficha.
  const canDeletePlan = user?.role === "TENANT_ADMIN" || user?.role === "FLEET_SUPERINTENDENT";
  const [deleteTarget, setDeleteTarget] = useState<MaintenancePlan | null>(null);

  // Reutilizables por la tabla normal y la planilla Excel (evita duplicar lógica).
  const statusValue = useCallback(
    (row: MaintenancePlan) => displayStatus(row, oosAssetIds.has(row.assetId)),
    [oosAssetIds],
  );
  const renderStatus = useCallback((row: MaintenancePlan) => (
    <div className="flex flex-col items-start gap-1">
      {hasNoDue(row) && !oosAssetIds.has(row.assetId) && (
        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/35 whitespace-nowrap" title={t("mp.v27.noDueHint")}>
          <CalendarX className="w-2.5 h-2.5" /> {t("mp.v27.noDue")}
        </span>
      )}
      <StatusBadgeInline
        plan={row}
        assetOutOfService={oosAssetIds.has(row.assetId)}
        hideWhenValid
        onOpenWo={(code) => navigate(`/work-orders?autoCode=${code}`)}
      />
    </div>
  ), [navigate, oosAssetIds, t]);

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

  /**
   * Abre el formulario de OT para un ítem del PDM.
   *
   * Pide SIEMPRE el detalle: el listado omite los campos de texto pesados
   * (criterios de aceptación, LOTO, análisis de riesgo, justificación de la
   * consecuencia y la plantilla de checklist) para aligerar el payload, y esos
   * son justamente los que la OT hereda del plan. Con el plan de la lista la
   * orden nacía sin ellos — el trabajo se hacía sin criterio escrito, que es lo
   * que mira una auditoría. Si el detalle falla se abre igual con lo que hay:
   * perder campos es peor que no poder abrir la orden, pero no al revés.
   */
  const [openingWoId, setOpeningWoId] = useState<string | null>(null);
  const openWoForPlan = useCallback(async (row: MaintenancePlan) => {
    setOpeningWoId(row.id);
    try {
      const full = await api.get<MaintenancePlan>(`/app/pms/maintenance-plans/${row.id}`);
      setExecuting(full);
    } catch {
      setExecuting(row);
    } finally {
      setOpeningWoId(null);
    }
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

  const openFromRowRef = useRef<(row: MaintenancePlan) => void>(() => {});
  openFromRowRef.current = openFromRow;
  const renderActions = useCallback((row: MaintenancePlan) => {
    if (row.status === "INACTIVE" || row.status === "DRAFT") return null;
    // Sin vencimiento: lo primero es darle de dónde contar, en la ventana de la tarea.
    if (hasNoDue(row) && !row.activeWorkOrderCode) {
      return (
        <button
          onClick={e => { e.stopPropagation(); openFromRowRef.current(row); }}
          title={t("mp.v27.setStartHint")}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-all whitespace-nowrap border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20"
        >
          <CalendarPlus className="w-3 h-3" /> {t("mp.v27.setStart")}
        </button>
      );
    }
    // Ya hay una OT en curso: el enlace va en Situación; no se ofrece abrir otra.
    if (row.activeWorkOrderCode) return null;
    const needsWO = row.triggerResultMode === "AUTO_WO" || row.triggerResultMode === "APPROVAL_WO";
    const hasActiveWo = !!row.activeWorkOrderCode && row.executionStatus === "IN_WINDOW";
    // El botón sigue estando en todas las filas —siempre se puede adelantar una
    // tarea—, pero sólo se pinta con el color de acción donde efectivamente hay
    // algo que hacer. Con 193 botones idénticos, ninguno destaca; apagando los
    // que están al día, los que quedan encendidos señalan solos.
    const st = displayStatus(row, oosAssetIds.has(row.assetId));
    const quiet = st === "FUTURE" || st === "UPCOMING" || st === "OUT_OF_SERVICE";
    const btn = quiet
      ? "border-border bg-transparent text-text-industrial/60 hover:text-fg hover:border-fg/30"
      : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent/50";
    const btnOk = quiet
      ? "border-border bg-transparent text-text-industrial/60 hover:text-fg hover:border-fg/30"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50";
    // "Solo Alerta" → OT Express en vez de Reportar, igual que en el detalle.
    if (row.triggerResultMode === "DUE_ONLY") {
      const busy = expressRowId === row.id;
      // Con taller externo el atajo no corre: la orden tramita igual que el resto.
      const tercerizado = planHasProvider(row);
      return (
        <button
          onClick={e => { e.stopPropagation(); void openExpressFromRow(row); }}
          disabled={busy}
          title={tercerizado ? t("mp.express.providerHint") : t("mp.express.hint")}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold disabled:opacity-50 transition-all whitespace-nowrap ${btn}`}
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          {tercerizado
            ? t("mp.col.executeWO")
            : t("mp.col.executeExpressWO").replace("{abbr}", woTerms.abbr)}
        </button>
      );
    }
    return needsWO ? (
      !hasActiveWo ? (
        <button
          onClick={e => { e.stopPropagation(); void openWoForPlan(row); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-all whitespace-nowrap ${btn}`}
        >
          <Zap className="w-3 h-3" /> {t("mp.col.executeWO")}
        </button>
      ) : null
    ) : (
      <button
        onClick={e => { e.stopPropagation(); setReporting(row); }}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-all whitespace-nowrap ${btnOk}`}
      >
        <CheckCircle2 className="w-3 h-3" /> {t("mp.col.report")}
      </button>
    );
  }, [t, woTerms, expressRowId, openExpressFromRow, openWoForPlan, oosAssetIds]);


  const columns: Column<MaintenancePlan>[] = useMemo(() => [
    // ── Col 0: marcar para juntar en UNA sola OT (parada de astillero) ──────
    {
      key: "bundle",
      header: "OT",
      width: "34px",
      sortable: false,
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
            title={blocked ? t("mp.bundle.otherVessel") : t("mp.bundle.mark")}
            className="w-3.5 h-3.5 accent-accent cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          />
        );
      },
    },
    // ── Col 1: EMBARCACIÓN — sólo si hay más de un buque en la lista ───────
    ...(!singleVessel ? [{
      key: "vesselCode",
      header: t("mp.col.vessel"),
      width: "110px",
      sortValue: row => `${row.vesselCode} ${row.taskCode}`,
      render: row => (
        <span className="text-[11px] font-bold text-accent leading-tight whitespace-nowrap">
          {vesselNameMap.get(row.vesselCode) ?? row.vesselCode}
        </span>
      ),
    }] : []),
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
        const isInspection = row.taskType === "INSPECTION";
        const TaskTypeIcon = isInspection ? ShieldCheck : Wrench;
        const taskTypeIcon = (
          <span title={t(`mp.taskType.${isInspection ? "INSPECTION" : "MAINTENANCE"}` as any)} className="shrink-0 inline-flex">
            <TaskTypeIcon className="w-3.5 h-3.5 text-accent/70" />
          </span>
        );
        // Plan de muestreo con laboratorio contratado: la muestra no la analiza
        // el buque, la manda a un tercero. Saberlo desde la lista evita abrir la
        // tarea para descubrir que hay que coordinar con el proveedor.
        // (samplingFluidType sin samplingKind = planes viejos, mismo criterio
        // de retrocompatibilidad que el formulario.)
        const isSampling = !!(row.samplingKind || row.samplingFluidType);
        const labNames = (row.providerRequests ?? [])
          .map(r => r.providerName)
          .filter((n): n is string => !!n && n.trim().length > 0);
        if (labNames.length === 0 && row.providerName) labNames.push(row.providerName);
        const labIcon = isSampling && labNames.length > 0 && (
          <span
            title={`${t("mp.samplingLab")}: ${labNames.join(", ")}`}
            className="shrink-0 inline-flex"
          >
            <FlaskConical className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          </span>
        );
        // Identificación de la tarea (código + grupo SFI + aviso de riesgo alto).
        // Vive acá desde que se sacó la columna de embarcación: es un dato de
        // referencia, no de lectura, así que va en gris chico debajo del título
        // y no compitiendo con él en su propia columna.
        const idLine = (
          <span className="flex items-center gap-1.5 text-[10px] font-mono text-text-industrial/45 leading-tight whitespace-nowrap">
            <span>{row.taskCode}</span>
            {row.sfiGroupNumber != null && <span>· G{row.sfiGroupNumber}</span>}
            {planHasProvider(row) && !(row.samplingKind || row.samplingFluidType) && (row.providerName || row.providerRequests?.[0]?.providerName) && (
              <span className="inline-flex items-center gap-0.5 font-sans font-semibold text-violet-700 dark:text-violet-300">
                · <Truck className="w-2.5 h-2.5" /> {row.providerName || row.providerRequests?.[0]?.providerName}
              </span>
            )}
            {(row.riskLevel === "HIGH" || row.riskLevel === "CRITICAL") && (
              <span
                title={t("mp.col.highRisk")}
                className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-red-500/20 text-red-700 dark:text-red-400 text-[8px] font-bold border border-red-500/30"
              >!</span>
            )}
          </span>
        );
        const titleLine = (
          <span className="flex items-center gap-1.5 min-w-0">
            {taskTypeIcon}
            {labIcon}
            <span className="text-[12px] font-bold text-fg leading-tight line-clamp-2">{row.title}</span>
            {oosBadge}
          </span>
        );
        if (groupByEquipment) {
          return <div className="flex flex-col gap-0.5">{titleLine}{idLine}</div>;
        }
        // Lista plana: la TAREA manda (negrita arriba) y el equipo va debajo,
        // como referencia. Es lo que se lee primero: qué hay que hacer.
        return (
          <div className="flex flex-col gap-0.5">
            {titleLine}
            <span className="text-[11px] text-text-industrial/60 leading-tight line-clamp-1">{assetName}</span>
            {idLine}
          </div>
        );
      },
    },
    // ── Col 4: FRECUENCIA ───────────────────────────────────────────────────
    {
      key: "frequency",
      header: t("mp.col.frequency"),
      width: "150px",
      sortValue: row => frequencySort(row),
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
    // ── Col 5: ÚLTIMA VERIFICACIÓN ─────────────────────────────────
    // Cuándo se hizo por última vez. Iba en chico debajo de VENCE; ahora es
    // columna propia a su izquierda, para poder leerla y ordenarla sola.
    {
      key: "lastExecutionDate",
      header: t("mp.col.lastVerification"),
      width: "140px",
      sortValue: row => lastExecutionSort(row),
      render: row => {
        const last = needsHours(row.triggerType)
          ? (row.lastExecutionHours != null ? `${row.lastExecutionHours.toLocaleString()} hs` : null)
          : (row.lastExecutionDate ? fmtDate(row.lastExecutionDate) : null);
        return (
          <span className="font-mono text-xs tabular-nums whitespace-nowrap text-text-industrial/70">
            {last ?? <span className="text-text-industrial/30">—</span>}
          </span>
        );
      },
    },
    // ── Col 6: VENCE ─────────────────────────────────────────────────────────
    // Arriba va el vencimiento, lo único sobre lo que se decide algo. El color
    // aparece sólo cuando hay un problema; si está al día, va en negro.
    {
      key: "nextDueDate",
      header: t("mp.col.due"),
      width: "150px",
      sortValue: row => nextDueSort(row),
      render: row => {
        const st = displayStatus(row, oosAssetIds.has(row.assetId));
        const tone =
          st === "OVERDUE" ? "text-red-700 dark:text-red-400"
          : st === "DUE" ? "text-orange-700 dark:text-orange-400"
          : st === "OUT_OF_SERVICE" ? "text-text-industrial/50"
          : "text-fg";
        const next = needsHours(row.triggerType)
          ? (row.nextDueHours != null ? `${row.nextDueHours.toLocaleString()} hs` : null)
          : (row.nextDueDate ? fmtDate(row.nextDueDate) : null);
        const rel = dueRelative(row, t);
        return (
          <div className="flex flex-col">
            <span className={`font-mono text-xs font-bold tabular-nums whitespace-nowrap ${tone}`}>
              {next ?? <span className="text-text-industrial/30 font-normal">—</span>}
            </span>
            {rel && <span className={`text-[10.5px] font-semibold whitespace-nowrap ${st === "OVERDUE" || st === "DUE" ? tone : "text-text-industrial/55"}`}>{rel}</span>}
          </div>
        );
      },
    },
    // ── Col 7: STATUS ───────────────────────────────────────────────────────
    {
      key: "situacion",
      header: t("mp.col.status"),
      width: "120px",
      sortValue: row => STATUS_URGENCY[displayStatus(row, oosAssetIds.has(row.assetId))] ?? 99,
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
    // ── Col 9: BORRAR (extremo derecho, igual que la planilla de Equipos) ───
    ...(canDeletePlan ? [{
      key: "delete",
      header: "",
      width: "44px",
      sortable: false,
      render: (row: MaintenancePlan) => (
        <button
          onClick={e => { e.stopPropagation(); setDeleteTarget(row); }}
          className="p-1.5 rounded-lg text-text-industrial/30 hover:text-red-400 hover:bg-red-500/10 transition-all"
          title={t("mp.modal.delete")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ),
    }] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, vesselNameMap, renderStatus, renderActions, groupByEquipment, oosAssetIds, bundleIds, bundleVessel, toggleBundle, canDeletePlan]);

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
  // Grupo SFI de cada equipo (el que más declaran sus tareas). Se calcula acá
  // porque el grupo lo trae el PLAN, no el equipo, y la tabla ordena los grupos
  // sólo con su clave (= assetId).
  const assetSfiGroups = useMemo(() => {
    const nums = new Map<string, Array<number | null | undefined>>();
    for (const p of data?.items ?? []) {
      const arr = nums.get(p.assetId);
      if (arr) arr.push(p.sfiGroupNumber); else nums.set(p.assetId, [p.sfiGroupNumber]);
    }
    const out = new Map<string, number | null>();
    for (const [assetId, list] of nums) out.set(assetId, dominantSfiGroup(list));
    return out;
  }, [data]);

  const planGroupBy = useMemo(
    () => groupByEquipment
      ? {
          keyFn: (r: MaintenancePlan) => r.assetId,
          labelFn: (r: MaintenancePlan) => r.assetName ?? r.assetId,
          sortRows: (a: MaintenancePlan, b: MaintenancePlan) => freqRank(a) - freqRank(b),
          // Los equipos van por grupo SFI (G0, G1, G2… y al final los que no
          // tienen grupo) y, dentro de cada grupo, alfabéticos: así los equipos
          // de un mismo sistema quedan juntos en vez de repartidos por nombre.
          sortGroups: (a: { key: string; label: string }, b: { key: string; label: string }) => {
            const cmp = compareSfiGroup(assetSfiGroups.get(a.key) ?? null, assetSfiGroups.get(b.key) ?? null);
            if (cmp !== 0) return cmp;
            return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
          },
          // El nombre del equipo arranca en el borde izquierdo de la tabla, con
          // su barra vertical en la misma columna que los casilleros de las
          // tareas: así se lee de corrido quién encabeza a quién.
          headerStyle: "quiet" as const,
        }
      : undefined,
    [groupByEquipment, assetSfiGroups],
  );

  // ── Alta de tarea con el contexto del filtro ya puesto ────────────────────
  // Si la pantalla está filtrada por buque / equipo / grupo SFI, esos campos ya
  // están decididos: repetirlos a mano en el formulario es trabajo al pedo y la
  // fuente de que la tarea nazca colgada del equipo equivocado. El código lo
  // sigue proponiendo el backend (`suggest-code`), que ya numera sin repetir.
  const newPlanDefaults = useMemo(() => {
    const vessel = vesselFilter || selectedVesselCode || undefined;
    const asset = assetFilter || undefined;
    // El grupo sale de la pestaña SFI si hay una elegida; si no, del grupo que
    // comparten las tareas del equipo filtrado (un equipo suele vivir en uno).
    let group: number | null | undefined;
    if (typeof sfiTab === "number") {
      group = sfiTab;
    } else if (asset) {
      const groups = new Set(
        (data?.items ?? []).filter(p => p.assetId === asset && p.sfiGroupNumber != null)
          .map(p => p.sfiGroupNumber as number),
      );
      if (groups.size === 1) group = [...groups][0];
    }
    return { vessel, asset, group };
  }, [vesselFilter, selectedVesselCode, assetFilter, sfiTab, data]);

  const summaryCards: { key: PlanBucket; label: string; hint: string; icon: typeof Wrench; cls: string; num: string }[] = [
    { key: "over", label: t("mp.v27.sum.over"), hint: t("mp.v27.sum.overHint"), icon: AlarmClock, cls: "border-l-red-600", num: "text-red-700 dark:text-red-400" },
    { key: "now", label: t("mp.v27.sum.now"), hint: t("mp.v27.sum.nowHint"), icon: PlayCircle, cls: "border-l-orange-500", num: "text-orange-700 dark:text-orange-400" },
    { key: "soon", label: t("mp.v27.sum.soon"), hint: t("mp.v27.sum.soonHint"), icon: CalendarClock, cls: "border-l-blue-600", num: "text-blue-700 dark:text-blue-400" },
    { key: "nodue", label: t("mp.v27.sum.nodue"), hint: t("mp.v27.sum.nodueHint"), icon: CalendarX, cls: "border-l-amber-500", num: "text-amber-700 dark:text-amber-400" },
    { key: "oos", label: t("mp.v27.sum.oos"), hint: t("mp.v27.sum.oosHint"), icon: PowerOff, cls: "border-l-slate-400", num: "text-text-industrial/70" },
  ];
  const qualityItems: { key: "nodue" | "criteria" | "responsible" | "risk"; tone: string; label: string; hint: string }[] = [
    { key: "nodue", tone: "text-red-700 dark:text-red-400", label: t("mp.v27.q.nodue"), hint: t("mp.v27.q.nodueHint") },
    { key: "criteria", tone: "text-amber-700 dark:text-amber-400", label: t("mp.v27.q.criteria"), hint: t("mp.v27.q.criteriaHint") },
    { key: "responsible", tone: "text-amber-700 dark:text-amber-400", label: t("mp.v27.q.responsible"), hint: t("mp.v27.q.responsibleHint") },
    { key: "risk", tone: "text-amber-700 dark:text-amber-400", label: t("mp.v27.q.risk"), hint: t("mp.v27.q.riskHint") },
  ];
  const qualityTopics = qualityItems.filter(q => qualityCounts[q.key] > 0).length;
  const stageCount = (k: typeof stageSel) => {
    const items = data?.items ?? [];
    if (k === "todo") return bucketCounts.over + bucketCounts.now;
    if (k === "soon") return bucketCounts.soon;
    if (k === "ok") return bucketCounts.ok + bucketCounts.oos;
    return items.length;
  };
  const selCls = (on: boolean) => `rounded-lg border px-2 py-1.5 text-xs focus:outline-none focus:border-accent/50 ${on ? "border-accent bg-accent/5 font-bold text-accent" : "border-fg/10 bg-fg/5 text-fg"}`;
  const anyListFilter = !!(searchText || typeSel || whoSel || sfiTab !== "ALL" || overdueOnly || cardSel || qualitySel);
  const clearListFilters = () => { setOverdueOnly(false); setSfiTab("ALL"); setSearchText(""); setTypeSel(""); setWhoSel(""); setCardSel(""); setQualitySel(""); };

  return (
    <div className="space-y-4">
      <PageHeader kind="plan" icon={ClipboardList} title={t("page.maintenancePlans")} total={shownItems.length} onReload={reload}>
        {/* Vista: Lista o Calendario (el Gantt de carga). Planilla y Matriz siguen
            ocultas por pedido del usuario (sep 2026); su código queda montado. */}
        <div className="inline-flex overflow-hidden rounded-lg border border-fg/10">
          <button type="button" className="inline-flex items-center gap-1.5 bg-fg px-3 py-1.5 text-xs font-bold text-surface">
            <ListTree className="w-3.5 h-3.5" /> {t("mp.v27.viewList")}
          </button>
          <button type="button" onClick={() => navigate("/maintenance-gantt")} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-text-industrial/70 hover:text-fg">
            <CalendarDays className="w-3.5 h-3.5" /> {t("mp.v27.viewCalendar")}
          </button>
        </div>
        {/* Más: Excel y planilla del buque */}
        <div className="relative">
          <button type="button" onClick={() => setMoreOpen(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
            {exportingSheet ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : <MoreHorizontal className="w-3.5 h-3.5" />} {t("mp.v27.more")}
          </button>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
              <div className="absolute right-0 z-40 mt-1 w-64 overflow-hidden rounded-xl border border-fg/10 bg-surface shadow-xl">
                <button type="button" onClick={() => { setMoreOpen(false); setShowExcel(true); }} className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-fg/5">
                  <FileSpreadsheet className="w-4 h-4 text-accent shrink-0" /><span><b className="block text-fg">Excel</b><span className="text-text-industrial/55">{t("mp.v27.moreExcel")}</span></span>
                </button>
                {/* Planilla de Mantenimiento (.xlsx) del buque elegido en el header:
                    la planilla ES el plan en papel, se busca donde está el plan. */}
                <button type="button" disabled={exportingSheet || !selectedVesselCode} onClick={() => { setMoreOpen(false); void exportSheet(); }}
                  title={selectedVesselCode ? t("mp.page.exportSheetHint").replace("{vessel}", selectedVessel?.name ?? selectedVesselCode) : t("mp.page.exportSheetNoVessel")}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-fg/5 disabled:opacity-45 disabled:cursor-not-allowed">
                  <FileDown className="w-4 h-4 text-accent shrink-0" /><span><b className="block text-fg">{t("mp.page.exportSheet")}</b><span className="text-text-industrial/55">{selectedVesselCode ? (selectedVessel?.name ?? selectedVesselCode) : t("mp.page.exportSheetNoVessel")}</span></span>
                </button>
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => { setEditing(null); setShowModal(true); }}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> {t("mp.page.newTask")}
        </button>
        {/* ── Vista Planilla y Vista Matriz — OCULTAS por pedido del usuario (sep 2026).
            Para recuperarlas: volver a ofrecer setGridView / setShowMatrix. */}
      </PageHeader>

      {/* Resumen: lo que necesita atención. Tocar una tarjeta filtra. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
        {summaryCards.map(c => {
          const on = cardSel === c.key && !qualitySel;
          return (
            <button key={c.key} type="button" onClick={() => { setQualitySel(""); setCardSel(on ? "" : c.key); }}
              className={`flex flex-col items-start gap-0.5 rounded-2xl border-[1.5px] border-l-4 bg-surface px-3 py-2.5 text-left transition-all ${c.cls} ${on ? "border-accent ring-2 ring-accent/20" : "border-fg/10 hover:border-fg/25"}`}>
              <span className={`text-2xl font-extrabold leading-tight ${c.num}`}>{loading && !data ? "…" : bucketCounts[c.key]}</span>
              <span className="flex items-center gap-1 text-xs font-semibold text-text-industrial/70"><c.icon className="w-3.5 h-3.5" />{c.label}</span>
              <span className="text-[10px] text-text-industrial/40">{c.hint}</span>
            </button>
          );
        })}
      </div>

      {/* Calidad del plan: lo que falta para que avise y se pueda auditar. */}
      {qualityTopics > 0 && (
        <div className="rounded-2xl border border-fg/10 bg-surface px-4 py-2.5">
          <button type="button" onClick={toggleQuality} className="flex w-full items-center gap-2 text-left">
            <ClipboardCheck className="w-4 h-4 text-fg" />
            <span className="text-sm font-extrabold text-fg">{t("mp.v27.qualityTitle")}</span>
            <span className="hidden sm:inline text-[11.5px] text-text-industrial/55">· {t("mp.v27.qualitySub")}</span>
            <span className="ml-auto rounded-full border border-amber-400/60 bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-extrabold text-amber-800 dark:text-amber-300">
              {t("mp.v27.qualityTopics").replace("{n}", String(qualityTopics))}
            </span>
          </button>
          {qualityOpen && (
            <div className="mt-2.5 grid grid-cols-2 lg:grid-cols-4 gap-2">
              {qualityItems.map(q => {
                const on = qualitySel === q.key;
                return (
                  <button key={q.key} type="button" disabled={qualityCounts[q.key] === 0} onClick={() => { setCardSel(""); setQualitySel(on ? "" : q.key); }}
                    className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-all disabled:opacity-45 ${on ? "border-accent ring-2 ring-accent/20" : "border-fg/10 hover:border-fg/25"}`}>
                    <span className={`text-lg font-black ${qualityCounts[q.key] ? q.tone : "text-emerald-700 dark:text-emerald-400"}`}>{qualityCounts[q.key]}</span>
                    <span className="text-xs font-bold text-fg">{q.label}</span>
                    <span className="text-[10.5px] text-text-industrial/50">{q.hint}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="rounded-2xl border border-fg/10 bg-surface p-3 space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          {([["todo", t("mp.v27.stageTodo")], ["soon", t("mp.v27.stageSoon")], ["ok", t("mp.v27.stageOk")], ["all", t("mp.v27.stageAll")]] as const).map(([k, label]) => {
            const on = stageSel === k && !cardSel && !qualitySel;
            return (
              <button key={k} type="button" onClick={() => { setCardSel(""); setQualitySel(""); setStageSel(k); }}
                className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-xs font-bold transition-colors ${on ? "border-accent bg-accent text-accent-fg" : "border-fg/10 bg-surface text-text-industrial/60 hover:text-fg"}`}>
                {label}
                <span className={`rounded-full px-1.5 text-[10px] ${on ? "bg-white/25" : "bg-fg/10"}`}>{stageCount(k)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Sistema (grupo SFI). Se oculta si se llegó ya filtrado desde el Dashboard. */}
          {!sfiTabParam && !assetFilter && (
            <select value={String(sfiTab)} onChange={e => setSfiTab((e.target.value === "ALL" || e.target.value === "NONE" ? e.target.value : Number(e.target.value)) as SfiTab)}
              className={`${selCls(sfiTab !== "ALL")} max-w-[15rem]`}>
              <option value="ALL">{t("mp.v27.sfiAll")}</option>
              {SFI_TABS.filter(tab => tab.key !== "ALL" && (sfiTabCounts[String(tab.key)] ?? 0) > 0).map(tab => (
                <option key={String(tab.key)} value={String(tab.key)}>{tab.key} · {t(`sfi.g.${tab.key}` as Parameters<typeof t>[0])} ({sfiTabCounts[String(tab.key)]})</option>
              ))}
            </select>
          )}
          <select value={typeSel} onChange={e => setTypeSel(e.target.value as typeof typeSel)} className={selCls(!!typeSel)}>
            <option value="">{t("mp.v27.typeAll")}</option>
            <option value="MAINTENANCE">{t("mp.taskType.MAINTENANCE" as Parameters<typeof t>[0])}</option>
            <option value="INSPECTION">{t("mp.taskType.INSPECTION" as Parameters<typeof t>[0])}</option>
          </select>
          <select value={whoSel} onChange={e => setWhoSel(e.target.value as typeof whoSel)} className={selCls(!!whoSel)}>
            <option value="">{t("mp.v27.whoAll")}</option>
            <option value="onboard">{t("mp.v27.whoOnboard")}</option>
            <option value="provider">{t("mp.v27.whoProvider")}</option>
          </select>
          <button type="button" onClick={() => setGroupByEquipment(v => !v)} aria-pressed={groupByEquipment}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-all ${groupByEquipment ? "border-accent/40 bg-accent/10 text-accent" : "border-fg/10 bg-fg/5 text-text-industrial hover:border-accent/30"}`}>
            <ListTree className="w-3.5 h-3.5" /> {t("mp.page.groupByEquipment")}
          </button>
          {groupByEquipment && (
            <button type="button" onClick={toggleAllGroups} title={allCollapsed ? t("mp.page.expandAll") : t("mp.page.collapseAll")}
              className="flex items-center justify-center p-1.5 rounded-lg border bg-fg/5 border-fg/10 text-text-industrial/60 hover:border-accent/30 transition-all">
              {allCollapsed ? <ChevronsUpDown className="w-4 h-4" /> : <ChevronsDownUp className="w-4 h-4" />}
            </button>
          )}
          {anyListFilter && (
            <button type="button" onClick={clearListFilters} className="rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-xs text-text-industrial/80 hover:text-fg">{t("common.clear")}</button>
          )}
          <div className="flex items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 w-full sm:w-auto sm:ml-auto">
            <Search className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />
            <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder={t("mp.page.searchPlaceholder")}
              className="w-full sm:w-64 bg-transparent text-xs text-fg placeholder-text-industrial/30 focus:outline-none" />
            {searchText && <button type="button" onClick={() => setSearchText("")} className="text-text-industrial/40 hover:text-fg"><X className="w-3 h-3" /></button>}
          </div>
        </div>
      </div>

      {/* Guía para las tareas sin vencimiento */}
      {qualitySel === "nodue" && (
        <div className="flex items-start gap-3 rounded-2xl border-[1.5px] border-amber-400/60 bg-amber-500/[0.07] px-3.5 py-3">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 bg-amber-600"><CalendarX className="w-4.5 h-4.5" /></span>
          <div>
            <p className="text-sm font-black text-fg">{t("mp.v27.nodueGuideTitle").replace("{n}", String(qualityCounts.nodue))}</p>
            <p className="text-[12.5px] text-text-industrial/70">{t("mp.v27.nodueGuideDesc")}</p>
          </div>
        </div>
      )}

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
          <button onClick={clearWeekFilter} title={t("mp.page.weekFilterClear")} className="text-text-industrial/50 hover:text-fg transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {pageError && <AlertDialog message={pageError} onClose={() => setPageError(null)} />}
      {loadingDetailId && (
        <div className="flex items-center gap-2 text-xs text-text-industrial/60">
          <Loader2 className="w-4 h-4 animate-spin text-accent" /> {t("mp.page.loadingDetail")}
        </div>
      )}

      <TmsaFilterBanner filter={tmsaFilter} shown={shownItems.length} total={rawData?.items?.length ?? 0} />

      {showMatrix ? (
        loading && !data ? (
          <div className="flex items-center gap-2 text-xs text-text-industrial/60 px-1 py-6">
            <Loader2 className="w-4 h-4 animate-spin text-accent" /> {t("common.loading")}
          </div>
        ) : error ? (
          <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{String(error)}</p>
        ) : (
          <MaintenancePlansMatrix
            plans={shownItems}
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
            plans={shownItems}
            isAdmin={isAdmin}
            canEditMilestones={user?.role === "TENANT_ADMIN"}
            vesselNameMap={vesselNameMap}
            renderStatus={renderStatus}
            renderActions={renderActions}
            statusValue={statusValue}
            onOpenDetail={openFromRow}
            emptyText={t("empty.maintenancePlans")}
            bundleIds={bundleIds}
            bundleVessel={bundleVessel}
            onToggleBundle={toggleBundle}
          />
        )
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              columns={columns}
              data={data ? shownItems : null}
              loading={loading}
              error={error}
              keyFn={row => row.id}
              emptyText={stageSel === "todo" && !cardSel && !qualitySel ? t("mp.v27.emptyTodo") : t("empty.maintenancePlans")}
              // Si ya hay un plan activo en la URL (su ventana aún no se dibujó por el
              // gap de render), reemplazamos en vez de apilar: clickear otro plan
              // dejaba /A y /B en el historial y cerrar el 2º reabría el 1º.
              onRowClick={openFromRow}
              rowClassName={row => { const b = bucketOf(row); return b === "over" ? "bg-red-500/[0.05] shadow-[inset_4px_0_0_rgb(220,38,38)]" : b === "now" ? "shadow-[inset_4px_0_0_rgb(234,88,12)]" : ""; }}
              layoutFixed
              groupBy={planGroupBy}
              collapsedGroups={collapsedGroups}
              onToggleGroup={toggleGroup}
              // Agrupación y orden por columna se pisan: si el usuario ordena por
              // una columna estando agrupado por equipo, gana el orden y la lista
              // pasa a verse de corrido.
              onSortUngroup={() => setGroupByEquipment(false)}
            />
          </div>
          {/* Celular: tarjetas con la acción a mano. */}
          <div className="md:hidden flex flex-col gap-2">
            {loading && !data && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>}
            {data && shownItems.length === 0 && <p className="py-8 text-center text-sm text-text-industrial/40">{stageSel === "todo" && !cardSel && !qualitySel ? t("mp.v27.emptyTodo") : t("empty.maintenancePlans")}</p>}
            {shownItems.slice(0, 150).map(p => {
              const b = bucketOf(p);
              const rel = dueRelative(p, t);
              return (
                <div key={p.id} onClick={() => openFromRow(p)}
                  className={`rounded-xl border border-fg/10 border-l-4 bg-surface px-3 py-2.5 space-y-1.5 cursor-pointer ${b === "over" ? "border-l-red-600 bg-red-500/[0.05]" : b === "now" ? "border-l-orange-500" : b === "nodue" ? "border-l-amber-500" : "border-l-fg/10"}`}>
                  <p className="text-[11px] text-text-industrial/55 truncate">{p.assetName ?? ""}</p>
                  <b className="block text-[13px] text-fg leading-tight">{p.title}</b>
                  <div className="flex flex-wrap items-center gap-2">
                    {renderStatus(p)}
                    {rel && <span className={`text-[11px] font-bold ${b === "over" ? "text-red-700 dark:text-red-400" : b === "now" ? "text-orange-700 dark:text-orange-400" : "text-text-industrial/60"}`}>{rel}</span>}
                  </div>
                  <div onClick={e => e.stopPropagation()}>{renderActions(p)}</div>
                </div>
              );
            })}
            {shownItems.length > 150 && <p className="text-center text-[11px] text-text-industrial/45">{t("mp.v27.mobileMore").replace("{n}", String(shownItems.length - 150))}</p>}
          </div>
        </>
      )}

      {/* Juntar varias tareas en UNA sola OT (parada o astillero): barra fija abajo. */}
      {bundlePlans.length > 0 && (
        <div className="sticky bottom-3 z-20 mx-auto flex max-w-3xl flex-wrap items-center gap-2.5 rounded-2xl bg-[#1A1D24] px-3.5 py-2.5 text-white shadow-2xl">
          <Layers className="w-4 h-4 shrink-0" />
          <b className="text-sm">{t("mp.v27.bundleN").replace("{n}", String(bundlePlans.length))}</b>
          <span className="min-w-0 flex-1 truncate text-xs text-white/70">
            {bundleVessel ? `${vesselNameMap.get(bundleVessel) ?? bundleVessel} · ` : ""}{t("mp.v27.bundleHint")} · <span className="font-mono">{bundlePlans.map(p => p.taskCode).join(" / ")}</span>
          </span>
          <button type="button" onClick={() => setBundleIds([])} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25">{t("mp.v27.bundleClear")}</button>
          <button type="button" disabled={!bundlePlans[0] || openingWoId !== null} onClick={() => { if (bundlePlans[0]) void openWoForPlan(bundlePlans[0]); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold hover:brightness-110 disabled:opacity-50">
            {openingWoId !== null ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            {t("mp.v27.bundleOpen").replace("{n}", String(bundlePlans.length)).replace("{abbr}", woTerms.abbr)}
          </button>
        </div>
      )}

      {deleteTarget && (
        <DeletePlanDialog
          plan={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); void reload(); }}
        />
      )}

      {showExcel && <ExcelPanel module="maintenance_plans" onClose={() => { setShowExcel(false); void reload(); }} />}

      {executing && (
        <CreateWorkOrderModal
          prefill={buildWoPrefillFromPlan(
            executing,
            t("mp.modal.maintenancePlanLabel"),
            // Los otros ítems marcados van a la MISMA OT. Solo cuando el plan que
            // se está abriendo es el primero de la selección: abrir otro plan
            // suelto no debe arrastrar la selección.
            bundlePlans[0]?.id === executing.id
              ? bundlePlans.slice(1).map(p => ({
                  id: p.id, taskCode: p.taskCode, title: p.title,
                  assetName: (p as MaintenancePlan & { assetName?: string | null }).assetName ?? null,
                }))
              : undefined,
          )}
          onClose={() => setExecuting(null)}
          // Recién creada, la OT se abre para completarla: nace "En preparación"
          // y hay que terminarla y enviarla a aprobar, así que dejarla en la
          // lista obligaba a ir a buscarla.
          onSaved={(_woId, workOrderCode) => {
            setExecuting(null);
            setBundleIds([]);
            void reload();
            if (workOrderCode) navigate(`/work-orders/${encodeURIComponent(workOrderCode)}`);
          }}
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
          canEditMilestones={user?.role === "TENANT_ADMIN"}
          setRequestMessage={setRequestMessageFromContext}
          deepLinked={!!linkCode}
          // Sólo en el alta: al editar, los valores salen del plan.
          defaultVesselCode={editing ? undefined : newPlanDefaults.vessel}
          defaultAssetId={editing ? undefined : newPlanDefaults.asset}
          defaultSfiGroupNumber={editing ? undefined : newPlanDefaults.group}
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
