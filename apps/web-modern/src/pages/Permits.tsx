import React, { useState, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ShieldAlert, Plus, X, Loader2, AlertTriangle, FileText, Flame, Wind, ArrowUp, Zap, CheckCircle, XCircle, Sparkles,
  Snowflake, Waves, FileDown, Paperclip, Download, Trash2,
  ArrowLeft, ChevronRight, Info, Save, Send, Ship, Wrench, Users, PenLine, Hourglass, Play, HardHat, RotateCcw, Search,
} from "lucide-react";
import { WizardStepper } from "../components/NewWorkOrderWizard";
import { GuideSection, GuideField, GuideNeedTag, GuidePill } from "../components/GuideKit";
import { useFetch } from "../lib/hooks";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { useAuth, useCan } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { AlertDialog } from "../components/AlertDialog";
import { AuthedDocLink, downloadAuthedFile } from "../lib/authed-media";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { VesselLabel } from "../components/EntityLabels";
import { useMocTrigger, MocTriggerHost, type MocTriggerEvent } from "../lib/use-moc-trigger";
import { useT, type TranslationKey } from "../lib/i18n";
import { useTmsaFilter, applyTmsaFilter, TmsaFilterBanner } from "../lib/tmsa-filter";
import { AutoTextArea } from "../components/AutoTextArea";
import { suggestPermitTypesFromText } from "../lib/permit-classifier";
import { textMatches } from "../lib/text-search";

// ─── Types ───────────────────────────────────────────────────────────────────

type PermitType =
  | "HOT_WORK" | "ENCLOSED_SPACE_ENTRY" | "WORKING_ALOFT" | "ELECTRICAL_ISOLATION"
  | "COLD_WORK" | "UNDERWATER_WORK";
type PermitStatus = "DRAFT" | "REQUESTED" | "APPROVED" | "REJECTED" | "ACTIVE" | "CLOSED" | "CANCELLED";
type ParticipantRole = "PERFORMER" | "FIRE_WATCH" | "STAND_BY" | "ATTENDANT" | "SUPERVISOR";
type GasVerdict = "PASS" | "FAIL";

interface GasTest {
  id: string;
  testedAt: string;
  testedByName: string;
  location: string | null;
  o2Pct: number | null;
  lelPct: number | null;
  h2sPpm: number | null;
  coPpm: number | null;
  verdict: GasVerdict;
  notes: string | null;
}
interface Participant {
  id: string;
  crewId: string | null;
  name: string;
  role: ParticipantRole;
}
interface Permit {
  id: string;
  tenantId: string;
  vesselCode: string;
  permitCode: string;
  type: PermitType;
  status: PermitStatus;
  location: string;
  description: string;
  plannedStart: string;
  plannedEnd: string;
  validFrom: string | null;
  validTo: string | null;
  hazardsIdentified: string | null;
  controlMeasures: string | null;
  ppeRequired: string | null;
  details: Record<string, unknown>;
  // OT de la que cuelga el permiso. null = permiso ocasional (sin OT).
  // El código y el título los resuelve el backend: `workOrderId` es un campo
  // suelto, no una relación del schema.
  workOrderId: string | null;
  workOrderCode: string | null;
  workOrderTitle: string | null;
  // Override/bypass de alarma crítica — al guardar dispara MOC TEMPORARY
  alarmOverride: boolean;
  requestedAt: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  closeNotes: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  gasTests: GasTest[];
  participants: Participant[];
}

/** Respaldo del permiso: el scan del permiso firmado en papel, o un anexo. */
interface PermitAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  uploadedAt: string;
  uploadedByName: string | null;
}

interface CrewItem {
  id: string;
  vesselCode: string;
  firstName: string;
  lastName: string;
  rank: string;
  status: string;
}

// ─── Labels ──────────────────────────────────────────────────────────────────

const TYPE_TKEY: Record<PermitType, TranslationKey> = {
  HOT_WORK: "pm.type.hotWork",
  ENCLOSED_SPACE_ENTRY: "pm.type.enclosedSpace",
  WORKING_ALOFT: "pm.type.workingAloft",
  ELECTRICAL_ISOLATION: "pm.type.electricalIso",
  COLD_WORK: "pm.type.coldWork",
  UNDERWATER_WORK: "pm.type.underwater",
};

const TYPE_ICON: Record<PermitType, React.FC<{ className?: string }>> = {
  HOT_WORK: Flame,
  ENCLOSED_SPACE_ENTRY: Wind,
  WORKING_ALOFT: ArrowUp,
  ELECTRICAL_ISOLATION: Zap,
  COLD_WORK: Snowflake,
  UNDERWATER_WORK: Waves,
};

const STATUS_TKEY: Record<PermitStatus, TranslationKey> = {
  DRAFT: "pm.status.draft",
  REQUESTED: "pm.status.requested",
  APPROVED: "pm.status.approved",
  REJECTED: "pm.status.rejected",
  ACTIVE: "pm.status.active",
  CLOSED: "pm.status.closed",
  CANCELLED: "pm.status.cancelled",
};

const STATUS_COLOR: Record<PermitStatus, string> = {
  DRAFT: "bg-fg/5 text-text-industrial/60 border-fg/10",
  REQUESTED: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
  APPROVED: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  REJECTED: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  ACTIVE: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  CLOSED: "bg-success-sea/10 text-success-sea border-success-sea/20",
  CANCELLED: "bg-fg/5 text-text-industrial/50 border-fg/10",
};

const ROLE_LABEL: Record<ParticipantRole, string> = {
  PERFORMER: "Ejecutante",
  FIRE_WATCH: "Vigía de fuego",
  STAND_BY: "Stand-by",
  ATTENDANT: "Atendente",
  SUPERVISOR: "Supervisor",
};

function fmtDateTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function toLocalDateTimeInput(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  // Format YYYY-MM-DDTHH:MM for datetime-local
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Duración legible ("25 min", "3 h", "2 d") para vencimientos. */
function fmtSpan(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider mb-1";

// ─── Origen del permiso (paso previo a crear) ────────────────────────────────

/**
 * Un permiso puede nacer de dos maneras: colgado de una OT abierta (el caso
 * normal: el trabajo ya está planificado) o suelto, para un trabajo ocasional
 * que no tiene OT. Esta ventana obliga a elegir antes de abrir el formulario,
 * que es lo que hace trazable el vínculo OT ⇄ permiso.
 */
/** Encabezado común de los pasos del alta (V19): ícono naranja, título y pasos. */
const PermitWizardHeader: React.FC<{ title: string; stepper?: React.ReactNode; onClose: () => void }> = ({ title, stepper, onClose }) => {
  const t = useT();
  return (
    <div className="px-5 sm:px-6 py-3.5 border-b border-fg/10 shrink-0">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-700 dark:text-orange-400 flex items-center justify-center shrink-0"><ShieldAlert className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-orange-700 dark:text-orange-400">{t("pm.wiz.kicker")}</p>
          <h2 className="text-base font-black text-fg leading-tight">{title}</h2>
        </div>
        <ModalCloseButton onClose={onClose} />
      </div>
      {stepper}
    </div>
  );
};

const PermitOriginChooser: React.FC<{
  onFromWorkOrder: () => void;
  onStandalone: () => void;
  onClose: () => void;
}> = ({ onFromWorkOrder, onStandalone, onClose }) => {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl flex flex-col border-t-4 border-t-orange-600 overflow-hidden">
        <PermitWizardHeader title={t("pm.newPermit")} onClose={onClose}
          stepper={<WizardStepper labels={[t("pm.wiz.stepOrigin"), t("pm.wiz.stepWo"), t("pm.wiz.stepType"), t("pm.wiz.stepForm")]} current={0} />} />
        <div className="p-5 sm:p-6 space-y-4">
          <div>
            <p className="text-[15px] font-extrabold text-fg">{t("pm.wiz.originQ")}</p>
            <p className="text-xs text-text-industrial/60 mt-0.5">{t("pm.wiz.originHint")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={onFromWorkOrder}
              className="text-left p-4 rounded-2xl border-2 border-accent/45 bg-accent/[0.04] hover:bg-accent/10 transition-colors flex items-start gap-3"
            >
              <span className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0"><Wrench className="w-5 h-5" /></span>
              <span>
                <span className="flex flex-wrap items-center gap-1.5 text-sm font-extrabold text-fg">
                  {t("pm.origin.fromWo")}
                  <span className="rounded-full bg-accent px-2 py-px text-[10px] font-extrabold text-accent-fg">{t("pm.wiz.usual")}</span>
                </span>
                <span className="block text-xs text-text-industrial/60 mt-0.5">{t("pm.origin.fromWoHint")}</span>
              </span>
            </button>
            <button
              onClick={onStandalone}
              className="text-left p-4 rounded-2xl border-2 border-fg/10 bg-surface hover:border-fg/25 transition-colors flex items-start gap-3"
            >
              <span className="w-10 h-10 rounded-xl bg-fg/5 text-text-industrial/60 flex items-center justify-center shrink-0"><ShieldAlert className="w-5 h-5" /></span>
              <span>
                <span className="block text-sm font-extrabold text-fg">{t("pm.origin.standalone")}</span>
                <span className="block text-xs text-text-industrial/60 mt-0.5">{t("pm.origin.standaloneHint")}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Tipo de permiso (paso del alta, V19) ────────────────────────────────────

const TYPE_HINT_TKEY: Record<PermitType, TranslationKey> = {
  HOT_WORK: "pm.wiz.hint.HOT_WORK",
  ENCLOSED_SPACE_ENTRY: "pm.wiz.hint.ENCLOSED_SPACE_ENTRY",
  WORKING_ALOFT: "pm.wiz.hint.WORKING_ALOFT",
  ELECTRICAL_ISOLATION: "pm.wiz.hint.ELECTRICAL_ISOLATION",
  COLD_WORK: "pm.wiz.hint.COLD_WORK",
  UNDERWATER_WORK: "pm.wiz.hint.UNDERWATER_WORK",
};
const TYPE_TONE: Record<PermitType, string> = {
  HOT_WORK: "bg-red-500/10 text-red-700 dark:text-red-400",
  ENCLOSED_SPACE_ENTRY: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  WORKING_ALOFT: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ELECTRICAL_ISOLATION: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  COLD_WORK: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  UNDERWATER_WORK: "bg-teal-500/10 text-teal-700 dark:text-teal-400",
};

/** Las 6 tarjetas de tipo de permiso. `suggested` = lo que sugiere el texto de la OT. */
const PermitTypeCards: React.FC<{ value: PermitType | null; suggested?: PermitType | null; compact?: boolean; onPick: (t: PermitType) => void }> = ({ value, suggested, compact, onPick }) => {
  const t = useT();
  return (
    <div className={`grid gap-2.5 ${compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3"}`}>
      {(Object.keys(TYPE_TKEY) as PermitType[]).map(tp => {
        const Icon = TYPE_ICON[tp];
        const on = value === tp;
        return (
          <button key={tp} type="button" onClick={() => onPick(tp)}
            className={`relative flex flex-col items-start gap-1 rounded-2xl border-2 text-left transition-colors ${compact ? "p-2.5" : "p-3"} ${on ? "border-orange-600 bg-orange-500/[0.06]" : "border-fg/10 bg-surface hover:border-fg/25"}`}>
            {tp === suggested && (
              <span className="absolute right-2 top-2 inline-flex items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 py-px text-[9.5px] font-extrabold text-violet-700 dark:text-violet-300">
                <Sparkles className="w-2.5 h-2.5" /> {t("pm.wiz.suggested")}
              </span>
            )}
            <span className={`rounded-xl flex items-center justify-center ${compact ? "w-8 h-8" : "w-9 h-9"} ${TYPE_TONE[tp]}`}><Icon className="w-4 h-4" /></span>
            <span className="text-[13px] font-extrabold text-fg">{t(TYPE_TKEY[tp])}</span>
            {!compact && <span className="text-[11px] text-text-industrial/60">{t(TYPE_HINT_TKEY[tp])}</span>}
          </button>
        );
      })}
    </div>
  );
};

const PermitTypeChooser: React.FC<{
  stepLabels: string[];
  current: number;
  suggested?: PermitType | null;
  workOrderCode?: string | null;
  onPick: (t: PermitType) => void;
  onBack: () => void;
  onClose: () => void;
}> = ({ stepLabels, current, suggested, workOrderCode, onPick, onBack, onClose }) => {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[92vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl flex flex-col border-t-4 border-t-orange-600 overflow-hidden">
        <PermitWizardHeader title={t("pm.newPermit")} onClose={onClose} stepper={<WizardStepper labels={stepLabels} current={current} />} />
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
          {workOrderCode && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/5 px-2.5 py-0.5 font-mono text-[11px] font-bold text-accent">
              <Wrench className="w-3 h-3" /> {workOrderCode}
            </span>
          )}
          <div>
            <p className="text-[15px] font-extrabold text-fg">{t("pm.wiz.typeQ")}</p>
            <p className="text-xs text-text-industrial/60 mt-0.5">{suggested ? t("pm.wiz.typeHintSuggested") : t("pm.wiz.typeHint")}</p>
          </div>
          <PermitTypeCards value={null} suggested={suggested} onPick={onPick} />
        </div>
        <div className="flex items-center px-5 sm:px-6 py-3 border-t border-fg/10 shrink-0">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-text-industrial/70 hover:text-fg">
            <ArrowLeft className="w-3.5 h-3.5" /> {t("common.back")}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Selector de OT abierta ──────────────────────────────────────────────────

/** OTs elegibles: las que siguen abiertas (ni cerradas, ni canceladas, ni diferidas). */
const PICKABLE_WO_STATUSES = ["PLANNED", "IN_PROGRESS", "ON_HOLD"] as const;
const WO_STATUS_TKEY: Record<string, TranslationKey> = {
  PLANNED: "wo.status.planned",
  IN_PROGRESS: "wo.status.inProgress",
  ON_HOLD: "wo.status.onHold",
};

export interface PickableWorkOrder {
  id: string;
  workOrderCode: string;
  vesselCode: string;
  status: string;
  title: string | null;
  location: string | null;
  assetName: string | null;
  dueDate: string | null;
}

const WorkOrderPicker: React.FC<{
  initialVesselCode?: string | null;
  /** En edición el buque del permiso no se toca: sólo se listan sus OTs. */
  lockVessel?: boolean;
  /** Pasos del alta (V19). Sin esto es el selector suelto (cambiar la OT de un permiso). */
  stepper?: React.ReactNode;
  onPick: (wo: PickableWorkOrder) => void;
  onClose: () => void;
}> = ({ initialVesselCode, lockVessel = false, stepper, onPick, onClose }) => {
  const t = useT();
  const { vessels, selectedVesselCode } = useVesselContext();
  const [vesselCode, setVesselCode] = useState(
    initialVesselCode ?? selectedVesselCode ?? vessels[0]?.code ?? "",
  );
  const [search, setSearch] = useState("");

  // Se pide siempre por buque: el listado de OTs no pagina y traer la flota
  // entera para elegir una sola OT es traer miles de filas al navegador.
  const { data, loading } = useFetch<{ items: PickableWorkOrder[] }>(
    vesselCode ? `/app/pms/work-orders?vesselCode=${encodeURIComponent(vesselCode)}` : null,
    [vesselCode],
  );

  const items = useMemo(() => {
    const open = (data?.items ?? []).filter(w => (PICKABLE_WO_STATUSES as readonly string[]).includes(w.status));
    const q = search.trim().toLowerCase();
    if (!q) return open;
    return open.filter(w =>
      textMatches(`${w.workOrderCode} ${w.title ?? ""} ${w.assetName ?? ""} ${w.location ?? ""}`, q),
    );
  }, [data, search]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full max-w-2xl max-h-[92vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl flex flex-col overflow-hidden ${stepper ? "border-t-4 border-t-orange-600" : ""}`}>
        <PermitWizardHeader title={stepper ? t("pm.newPermit") : t("pm.woPicker.title")} stepper={stepper} onClose={onClose} />

        <div className="px-6 py-3 border-b border-fg/10 shrink-0 space-y-2">
          {stepper && <p className="text-[15px] font-extrabold text-fg">{t("pm.wiz.woQ")}</p>}
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={lockVessel}
              className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg disabled:opacity-60">
              {vessels.map(v => <option key={v.code} value={v.code}>{v.name || v.code}</option>)}
            </select>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("pm.woPicker.searchPh")}
              className="flex-1 bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50" />
          </div>
          <p className="text-[10px] text-text-industrial/40">{t("pm.woPicker.hint")}</p>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
          ) : !items.length ? (
            <div className="text-center py-10 text-text-industrial/30 text-sm">{t("pm.woPicker.empty")}</div>
          ) : (
            <div className="divide-y divide-fg/5">
              {items.map(w => {
                // Tipo de permiso que sugiere el texto de la OT (orientativo).
                const sug = stepper ? suggestPermitTypesFromText(`${w.title ?? ""} ${w.assetName ?? ""}`)[0]?.type as PermitType | undefined : undefined;
                const SugIcon = sug ? TYPE_ICON[sug] : null;
                return (
                  <button key={w.id} onClick={() => onPick(w)}
                    className="w-full text-left px-6 py-3 hover:bg-fg/5 active:bg-fg/10 transition-colors flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-[11px] font-mono font-bold text-fg">{w.workOrderCode}</span>
                        <span className="text-[9.5px] px-2 py-0.5 rounded-full border border-fg/10 bg-fg/5 text-text-industrial/60 font-bold">
                          {WO_STATUS_TKEY[w.status] ? t(WO_STATUS_TKEY[w.status]) : w.status}
                        </span>
                      </div>
                      <p className="text-[13px] font-bold text-fg truncate">{w.assetName ?? "—"}</p>
                      <p className="text-xs text-text-industrial/60 truncate">{w.title?.trim() || "—"}</p>
                    </div>
                    {sug && SugIcon && (
                      <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/[0.07] px-2 py-0.5 text-[11px] font-bold text-orange-700 dark:text-orange-400 shrink-0" title={t("pm.wiz.suggested")}>
                        <SugIcon className="w-3 h-3" /> {t(TYPE_TKEY[sug])}
                      </span>
                    )}
                    {w.dueDate && (
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-text-industrial/40">{t("wo.col.dueDate")}</p>
                        <p className="text-[11px] font-mono text-fg">{new Date(w.dueDate).toLocaleDateString("es-AR")}</p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Permit Modal ────────────────────────────────────────────────────────────

export interface PermitModalPrefill {
  vesselCode?: string;
  type?: PermitType;
  workOrderId?: string;
  /** Código de la OT, sólo para mostrarlo en la ficha (el vínculo es por id). */
  workOrderCode?: string;
  workOrderTitle?: string;
  /** Abierto desde la hoja de una OT: el permiso queda atado a esa OT. */
  lockWorkOrder?: boolean;
  location?: string;
  description?: string;
}

interface PermitModalProps {
  permit: Permit | null;
  prefill?: PermitModalPrefill;
  onClose: () => void;
  onSaved: () => void;
  onMocTrigger?: (e: MocTriggerEvent) => void;
  /** Alta desde el asistente (V19): pasos arriba y "Atrás" al tipo de permiso. */
  wizard?: { labels: string[]; current: number; onBack: () => void };
  /** Permiso existente (V22): abre directo una ventanita de acción (p. ej. cerrar). */
  initialDialog?: "close" | null;
  /** Refresca el permiso sin cerrar la ventana (equipo de trabajo, gas, cambios de etapa). */
  onReload?: () => void;
}

export const PermitModal: React.FC<PermitModalProps> = ({ permit, prefill, onClose, onSaved, onMocTrigger, wizard, initialDialog, onReload }) => {
  const t = useT();
  const { vessels } = useVesselContext();
  const { user } = useAuth();
  const can = useCan();
  const isAdmin = user?.role === "TENANT_ADMIN";
  // "Autorizar permisos de trabajo" — se configura en Equipo → Permisos por rol.
  const canApprove = can("permit.authorize");
  const isNew = !permit;

  const isTerminal = permit && ["CLOSED", "CANCELLED", "REJECTED"].includes(permit.status);
  const isEditable = !permit || permit.status === "DRAFT" || permit.status === "REQUESTED";

  // Form state — pre-cargado desde `permit` (edición) o `prefill` (creación desde WO)
  const [vesselCode, setVesselCode]   = useState(permit?.vesselCode ?? prefill?.vesselCode ?? vessels[0]?.code ?? "");
  const [type, setType]               = useState<PermitType>(permit?.type ?? prefill?.type ?? "HOT_WORK");
  const [location, setLocation]       = useState(permit?.location ?? prefill?.location ?? "");
  const [description, setDescription] = useState(permit?.description ?? prefill?.description ?? "");
  const [plannedStart, setPlannedStart] = useState(toLocalDateTimeInput(permit?.plannedStart ?? null));
  const [plannedEnd, setPlannedEnd]     = useState(toLocalDateTimeInput(permit?.plannedEnd ?? null));
  const [hazards, setHazards]         = useState(permit?.hazardsIdentified ?? "");
  const [controls, setControls]       = useState(permit?.controlMeasures ?? "");
  const [ppe, setPpe]                 = useState(permit?.ppeRequired ?? "");
  const [alarmOverride, setAlarmOverride] = useState(permit?.alarmOverride ?? false);

  // OT de la que cuelga el permiso. Se elige en la ventana previa a crear (o
  // viene de la hoja de la OT). Después sólo se puede cambiar en borrador: una
  // vez solicitado, el permiso ya se leyó como parte de esa OT.
  const [workOrder, setWorkOrder] = useState<{ id: string; code: string | null; title: string | null } | null>(
    permit?.workOrderId
      ? { id: permit.workOrderId, code: permit.workOrderCode, title: permit.workOrderTitle }
      : prefill?.workOrderId
        ? { id: prefill.workOrderId, code: prefill.workOrderCode ?? null, title: prefill.workOrderTitle ?? null }
        : null,
  );
  const [pickingWorkOrder, setPickingWorkOrder] = useState(false);
  // El vínculo se guarda mientras el permiso sea nuevo o borrador...
  const canLinkWorkOrder = isEditable && (isNew || permit!.status === "DRAFT");
  // ...pero no se ofrece cambiarlo cuando el permiso se abrió desde la OT.
  const canEditWorkOrder = canLinkWorkOrder && !prefill?.lockWorkOrder;

  // Respaldos: el scan del permiso firmado vuelve después de aprobar/cerrar, así
  // que la lista se carga siempre que el permiso exista, sin importar el estado.
  const { data: attachmentsData, reload: reloadAttachments } = useFetch<{ items: PermitAttachment[] }>(
    permit ? `/app/permits/${permit.id}/attachments` : null,
    [permit?.id],
  );
  const attachments = attachmentsData?.items ?? [];
  const canManagePermits = can("permit.manage");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // AI suggestions — loading flags
  const [loadingHazards, setLoadingHazards]   = useState(false);
  const [loadingControls, setLoadingControls] = useState(false);
  const [loadingPpe, setLoadingPpe]           = useState(false);

  const aiBaseInput = useCallback(() => ({
    type,
    // El buque define el escenario: los peligros y el EPP de una barcaza sin
    // gente a bordo no son los de un remolcador tripulado.
    vesselCode: vesselCode || null,
    location: location.trim() || null,
    description: description.trim() || null,
  }), [type, vesselCode, location, description]);

  const onSuggestHazards = useCallback(async () => {
    if (!isEditable || loadingHazards) return;
    if (!description.trim() && !location.trim()) {
      setErr(t("pm.wiz.aiNeedsContext"));
      return;
    }
    setLoadingHazards(true);
    const prev = hazards;
    setHazards(t("mp.modal.analyzing"));
    try {
      const res = await api.post<{ text: string }>("/app/permits/suggest-hazards", aiBaseInput());
      setHazards(res.text || prev);
    } catch (e) {
      setHazards(prev);
      setErr(e instanceof ApiError ? e.message : t("pm.wiz.aiError"));
    } finally {
      setLoadingHazards(false);
    }
  }, [isEditable, loadingHazards, description, location, hazards, aiBaseInput, t]);

  const onSuggestControls = useCallback(async () => {
    if (!isEditable || loadingControls) return;
    if (!description.trim() && !location.trim()) {
      setErr(t("pm.wiz.aiNeedsContext"));
      return;
    }
    setLoadingControls(true);
    const prev = controls;
    setControls(t("mp.modal.analyzing"));
    try {
      const res = await api.post<{ text: string }>("/app/permits/suggest-controls", {
        ...aiBaseInput(),
        hazardsIdentified: hazards.trim() || null,
      });
      setControls(res.text || prev);
    } catch (e) {
      setControls(prev);
      setErr(e instanceof ApiError ? e.message : t("pm.wiz.aiError"));
    } finally {
      setLoadingControls(false);
    }
  }, [isEditable, loadingControls, description, location, hazards, controls, aiBaseInput, t]);

  const onSuggestPpe = useCallback(async () => {
    if (!isEditable || loadingPpe) return;
    if (!description.trim() && !location.trim()) {
      setErr(t("pm.wiz.aiNeedsContext"));
      return;
    }
    setLoadingPpe(true);
    const prev = ppe;
    setPpe(t("mp.modal.analyzing"));
    try {
      const res = await api.post<{ text: string }>("/app/permits/suggest-ppe", {
        ...aiBaseInput(),
        hazardsIdentified: hazards.trim() || null,
        controlMeasures: controls.trim() || null,
      });
      setPpe(res.text || prev);
    } catch (e) {
      setPpe(prev);
      setErr(e instanceof ApiError ? e.message : t("pm.wiz.aiError"));
    } finally {
      setLoadingPpe(false);
    }
  }, [isEditable, loadingPpe, description, location, hazards, controls, ppe, aiBaseInput, t]);

  /** Guardar. `requestAfter` (alta, V19): además pide la aprobación del permiso recién creado. */
  const onSave = useCallback(async (requestAfter = false) => {
    if (!vesselCode || !location.trim() || !description.trim() || !plannedStart || !plannedEnd) {
      setErr(t("pm.wiz.required")); return;
    }
    // Para pedir la aprobación, el análisis de riesgo tiene que estar completo.
    if (requestAfter && (!hazards.trim() || !controls.trim() || !ppe.trim())) {
      setErr(t("pm.wiz.requestNeeds")); return;
    }
    setSaving(true); setErr(null);
    try {
      const payload: Record<string, unknown> = {
        vesselCode, type,
        location: location.trim(),
        description: description.trim(),
        plannedStart: new Date(plannedStart).toISOString(),
        plannedEnd: new Date(plannedEnd).toISOString(),
        hazardsIdentified: hazards.trim() || null,
        controlMeasures: controls.trim() || null,
        ppeRequired: ppe.trim() || null,
        alarmOverride: alarmOverride,
      };
      // El vínculo con la OT viaja mientras sea editable (permiso nuevo o en
      // borrador). El backend valida que la OT sea del mismo tenant y buque, y
      // rechaza el cambio si el permiso ya salió de borrador.
      if (canLinkWorkOrder) payload.workOrderId = workOrder?.id ?? null;
      if (isNew) {
        const created = await api.post<{ id: string }>("/app/permits", payload);
        if (requestAfter && created?.id) await api.post(`/app/permits/${created.id}/request`, {});
      } else {
        await api.patch(`/app/permits/${permit!.id}`, payload);
        if (requestAfter && permit!.status === "DRAFT") await api.post(`/app/permits/${permit!.id}/request`, {});
      }

      // Detector MOC TEMPORARY: el bypass/override de una alarma crítica
      // reduce la línea de defensa SOLAS y debe registrarse como Management
      // of Change. Disparamos si está activo y, en edición, solo si pasó de
      // false a true (cambio que introduce el riesgo).
      if (onMocTrigger && alarmOverride) {
        const wasAlreadyOverridden = !isNew && permit?.alarmOverride === true;
        if (!wasAlreadyOverridden) {
          const vessel = vessels.find(v => v.code === vesselCode);
          onMocTrigger({
            reason: "alarmOverride",
            prefill: {
              category: "TEMPORARY",
              vesselCode,
              title: `Override de alarma — ${t(TYPE_TKEY[type])} en ${vessel?.name ?? vesselCode}`,
              reasonForChange: `Permiso de trabajo con bypass/override de alarma crítica. Ubicación: ${location.trim()}.`,
              proposedChange: `${description.trim()}. Vigencia planeada: ${plannedStart} → ${plannedEnd}.`,
              sourceLabel: `Desde Permisos de Trabajo · ${t(TYPE_TKEY[type])}`,
            },
          });
        }
      }

      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [isNew, permit, vesselCode, type, location, description, plannedStart, plannedEnd, hazards, controls, ppe, alarmOverride, canLinkWorkOrder, workOrder, vessels, onSaved, onMocTrigger, t]);

  const callAction = useCallback(async (action: string, body?: unknown) => {
    if (!permit) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/permits/${permit.id}/${action}`, body ?? {});
      (onReload ?? onSaved)();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [permit, onSaved, onReload, t]);

  /**
   * Descarga el permiso como PDF (para imprimir y firmar) o como Word (para
   * completarlo antes). El nombre del archivo lo decide el servidor: con
   * documento controlado lleva adelante el código del formulario.
   */
  const onDownload = useCallback(async (kind: "pdf" | "doc") => {
    if (!permit) return;
    // Bajamos el archivo vía fetch + blob — window.open no carga el header
    // X-Tenant-Slug que el SPA usa para resolver tenant, y devolvería
    // TENANT_UNRESOLVED en una tab nueva.
    setSaving(true); setErr(null);
    try {
      const headers: Record<string, string> = {};
      const token = localStorage.getItem("gpms_token");
      const slug  = localStorage.getItem("gpms_tenant_slug");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (slug)  headers["X-Tenant-Slug"] = slug;

      const res = await fetch(`/app/permits/${permit.id}/${kind}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(disposition)?.[1];
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = named || `${permit.permitCode}.${kind === "pdf" ? "pdf" : "doc"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      const what = kind === "pdf" ? "el PDF" : "el documento Word";
      setErr(e instanceof Error ? `No se pudo generar ${what} (${e.message}).` : `No se pudo generar ${what}.`);
    } finally {
      setSaving(false);
    }
  }, [permit]);

  // ESC: cerrar / preguntar guardar si hay cambios
  const isDirty = useDirtyTracker({ vesselCode, type, location, description, plannedStart, plannedEnd, hazards, controls, ppe, alarmOverride, workOrderId: workOrder?.id ?? null });
  const requestClose = useEscapeGuard({ isDirty: isEditable && isDirty, onSave: isEditable ? () => onSave(false) : undefined, onClose });

  // ── Alta del permiso por bloques (preview V19) ──────────────────────────────
  const [showTypeCards, setShowTypeCards] = useState(false);
  const missingNew = {
    location: !location.trim(),
    description: !description.trim(),
    start: !plannedStart,
    end: !plannedEnd,
    hazards: !hazards.trim(),
    controls: !controls.trim(),
    ppe: !ppe.trim(),
  };
  const miss1 = Number(missingNew.location) + Number(missingNew.description) + Number(missingNew.start) + Number(missingNew.end);
  const miss2 = Number(missingNew.hazards) + Number(missingNew.controls) + Number(missingNew.ppe);
  /** Horario rápido: hoy o mañana a las 08:00; fin = inicio + N horas o a las 17:00. */
  const setStartAt = (daysAhead: number) => {
    const d = new Date(); d.setDate(d.getDate() + daysAhead); d.setHours(8, 0, 0, 0);
    setPlannedStart(toLocalDateTimeInput(d.toISOString()));
  };
  const setEndAt = (hours: number | "17") => {
    const base = plannedStart ? new Date(plannedStart) : new Date();
    const d = new Date(base);
    if (hours === "17") d.setHours(17, 0, 0, 0); else d.setHours(d.getHours() + hours);
    setPlannedEnd(toLocalDateTimeInput(d.toISOString()));
  };
  const quickBtn = "rounded-full border border-fg/10 px-2.5 py-0.5 text-[11px] font-bold text-text-industrial/60 hover:text-fg hover:border-fg/25";
  const fl = "flex items-center gap-1.5 text-xs font-semibold text-text-industrial/70 mb-1.5";
  const aiPill = (onClick: () => void, loading: boolean) => (
    <button type="button" onClick={onClick} disabled={loading}
      className="ml-auto inline-flex items-center gap-1 rounded-full border border-violet-500/35 bg-violet-500/[0.07] px-2 py-0.5 text-[10.5px] font-extrabold text-violet-700 dark:text-violet-300 hover:bg-violet-500/15 disabled:opacity-60">
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} {t("mp.guide.suggestAi")}
    </button>
  );
  const TypeIcon = TYPE_ICON[type];
  const suggestedType = prefill?.workOrderId
    ? (suggestPermitTypesFromText(`${prefill.workOrderTitle ?? ""} ${prefill.description ?? ""}`)[0]?.type as PermitType | undefined) ?? null
    : null;

  const newForm = (
    <div className="space-y-3.5">
      {/* Contexto: buque, OT y tipo, con "cambiar" a mano. */}
      <div className="flex flex-wrap items-center gap-2">
        {workOrder && (
          <span className="inline-flex items-center gap-1 rounded-full border border-fg/10 bg-fg/5 px-2.5 py-0.5 text-[11.5px] font-bold text-text-industrial/70">
            <Ship className="w-3 h-3" /><VesselLabel code={vesselCode} className="text-[11.5px]" />
          </span>
        )}
        {workOrder ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/5 px-2.5 py-0.5 font-mono text-[11.5px] font-bold text-accent">
            <Wrench className="w-3 h-3" /> {workOrder.code ?? "—"}
            {canEditWorkOrder && (
              <button type="button" onClick={() => setPickingWorkOrder(true)} className="font-sans text-[11px] font-extrabold underline">{t("pm.wiz.change")}</button>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-fg/10 bg-fg/5 px-2.5 py-0.5 text-[11.5px] font-bold text-text-industrial/60">
            {t("pm.wiz.noWo")}
            {canEditWorkOrder && (
              <button type="button" onClick={() => setPickingWorkOrder(true)} className="text-[11px] font-extrabold text-accent underline">{t("pm.linkWo")}</button>
            )}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/30 bg-orange-500/[0.07] px-2.5 py-0.5 text-[11.5px] font-bold text-orange-700 dark:text-orange-400">
          <TypeIcon className="w-3 h-3" /> {t(TYPE_TKEY[type])}
          <button type="button" onClick={() => setShowTypeCards(v => !v)} className="text-[11px] font-extrabold underline">{t("pm.wiz.change")}</button>
        </span>
      </div>
      {showTypeCards && (
        <PermitTypeCards compact value={type} suggested={suggestedType} onPick={tp => { setType(tp); setShowTypeCards(false); }} />
      )}

      {/* 1 · Qué, dónde y cuándo */}
      <GuideSection n={1} title={t("pm.wiz.sec1")} subtitle={t("pm.wiz.sec1Sub")} open onToggle={() => { /* siempre abierto */ }}
        pill={<GuidePill missing={miss1} completeLabel={t("mp.guide.complete")} missingOne={t("mp.guide.missingOne")} missingMany={t("mp.guide.missingMany")} />}>
        {!workOrder && (
          <div>
            <label className={fl}>{t("pm.vessel")}</label>
            <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={inputCls}>
              {vessels.map(v => <option key={v.code} value={v.code}>{v.name || v.code}</option>)}
            </select>
          </div>
        )}
        <GuideField id="pm-f-location" missing={missingNew.location}>
          <label className={fl}>{t("common.location")}{missingNew.location && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
          <input value={location} onChange={e => setLocation(e.target.value)} className={inputCls} placeholder={t("pm.locationPh")} />
        </GuideField>
        <GuideField id="pm-f-description" missing={missingNew.description}>
          <label className={fl}>{t("pm.wiz.workWhat")}{missingNew.description && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
          <AutoTextArea rows={2} value={description} onChange={e => setDescription(e.target.value)} className={inputCls} />
        </GuideField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <GuideField id="pm-f-start" missing={missingNew.start}>
            <label className={fl}>{t("pm.wiz.starts")}{missingNew.start && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
            <input type="datetime-local" value={plannedStart} onChange={e => setPlannedStart(e.target.value)} className={inputCls} />
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={quickBtn} onClick={() => setStartAt(0)}>{t("pm.wiz.today8")}</button>
              <button type="button" className={quickBtn} onClick={() => setStartAt(1)}>{t("pm.wiz.tomorrow8")}</button>
            </div>
          </GuideField>
          <GuideField id="pm-f-end" missing={missingNew.end}>
            <label className={fl}>{t("pm.wiz.ends")}{missingNew.end && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
            <input type="datetime-local" value={plannedEnd} onChange={e => setPlannedEnd(e.target.value)} className={inputCls} />
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={quickBtn} onClick={() => setEndAt(4)}>+4 h</button>
              <button type="button" className={quickBtn} onClick={() => setEndAt(8)}>+8 h</button>
              <button type="button" className={quickBtn} onClick={() => setEndAt("17")}>{t("pm.wiz.until17")}</button>
            </div>
          </GuideField>
        </div>
      </GuideSection>

      {/* 2 · Riesgos y protección */}
      <GuideSection n={2} title={t("pm.wiz.sec2")} subtitle={t("pm.wiz.sec2Sub")} open onToggle={() => { /* siempre abierto */ }}
        pill={<GuidePill missing={miss2} completeLabel={t("mp.guide.complete")} missingOne={t("mp.guide.missingOne")} missingMany={t("mp.guide.missingMany")} />}>
        <GuideField id="pm-f-hazards" missing={missingNew.hazards}>
          <div className="flex items-center gap-1">
            <label className={`${fl} mb-0`}>{t("pm.wiz.hazards")}{missingNew.hazards && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
            {aiPill(() => { void onSuggestHazards(); }, loadingHazards)}
          </div>
          <AutoTextArea rows={3} value={hazards} onChange={e => setHazards(e.target.value)} disabled={loadingHazards} className={inputCls} placeholder={t("pm.hazardsPh")} />
        </GuideField>
        <GuideField id="pm-f-controls" missing={missingNew.controls}>
          <div className="flex items-center gap-1">
            <label className={`${fl} mb-0`}>{t("pm.wiz.controls")}{missingNew.controls && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
            {aiPill(() => { void onSuggestControls(); }, loadingControls)}
          </div>
          <AutoTextArea rows={3} value={controls} onChange={e => setControls(e.target.value)} disabled={loadingControls} className={inputCls} placeholder={t("pm.controlsPh")} />
        </GuideField>
        <GuideField id="pm-f-ppe" missing={missingNew.ppe}>
          <div className="flex items-center gap-1">
            <label className={`${fl} mb-0`}>{t("pm.wiz.ppe")}{missingNew.ppe && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
            {aiPill(() => { void onSuggestPpe(); }, loadingPpe)}
          </div>
          <AutoTextArea rows={2} value={ppe} onChange={e => setPpe(e.target.value)} disabled={loadingPpe} className={inputCls} placeholder={t("pm.ppePh")} />
        </GuideField>
        <p className="flex items-start gap-1.5 text-[11px] text-text-industrial/50">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{t("pm.wiz.aiNote")}{type === "ENCLOSED_SPACE_ENTRY" ? ` ${t("pm.wiz.aiNoteEnclosed")}` : ""}</span>
        </p>
        {/* Override / bypass de alarma crítica — al guardar el sistema sugiere abrir MOC TEMPORARY. */}
        <label className="flex items-start gap-2.5 rounded-xl border-[1.5px] border-orange-500/30 bg-orange-500/[0.05] px-3 py-2.5 cursor-pointer hover:bg-orange-500/10 transition-colors">
          <input type="checkbox" checked={alarmOverride} onChange={e => setAlarmOverride(e.target.checked)} className="mt-0.5 w-4 h-4 accent-orange-600" />
          <span>
            <span className="block text-[13px] font-extrabold text-orange-800 dark:text-orange-200">{t("pm.wiz.overrideTitle")}</span>
            <span className="block text-[11.5px] text-text-industrial/60">{t("pm.wiz.overrideHint")}</span>
          </span>
        </label>
      </GuideSection>

      {/* Qué sigue */}
      <div className="rounded-xl border border-accent/20 bg-accent/[0.06] px-3 py-2.5 text-[12.5px] text-sky-900 dark:text-sky-200">
        <p><b>{t("pm.wiz.nextTitle")}</b> {type === "ENCLOSED_SPACE_ENTRY" ? t("pm.wiz.nextEnclosed") : t("pm.wiz.next")}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {(["pm.status.draft", "common.requestApproval", "pm.status.approved", "pm.status.active", "pm.status.closed"] as TranslationKey[]).map((k, i) => (
            <React.Fragment key={k}>
              {i > 0 && <ChevronRight className="w-3 h-3 opacity-60" />}
              <span className={`rounded-full border px-2 py-px text-[11px] font-extrabold ${i === 0 ? "border-orange-600 bg-orange-600 text-white" : "border-accent/25 bg-surface text-fg"}`}>{t(k)}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );

  const newFooter = (
    <div className="flex flex-wrap items-center gap-2 px-5 sm:px-6 py-3 border-t border-fg/10 shrink-0">
      {wizard && !isDirty && (
        <button type="button" onClick={wizard.onBack} className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-text-industrial/70 hover:text-fg">
          <ArrowLeft className="w-3.5 h-3.5" /> {t("common.back")}
        </button>
      )}
      <span className="flex-1" />
      <button type="button" onClick={requestClose} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.cancel")}</button>
      <button type="button" onClick={() => { void onSave(false); }} disabled={saving}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs font-bold text-fg hover:border-fg/25 disabled:opacity-50">
        <Save className="w-3.5 h-3.5" /> {t("pm.wiz.saveDraft")}
      </button>
      <button type="button" onClick={() => { void onSave(true); }} disabled={saving}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-orange-600 text-white text-xs font-bold hover:brightness-110 disabled:opacity-50">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {t("pm.wiz.saveRequest")}
        {miss1 + miss2 > 0 && <span className="text-[10px] font-semibold opacity-85">{t("mp.guide.saveMissing").replace("{n}", String(miss1 + miss2))}</span>}
      </button>
    </div>
  );

  // ── Permiso existente (preview V22) ─────────────────────────────────────────
  // Ventanitas propias para rechazar / cerrar / cancelar / re-abrir (antes: prompt del navegador).
  const [actionDlg, setActionDlg] = useState<null | "reject" | "close" | "cancel" | "reopen">(initialDialog ?? null);
  const [dlgText, setDlgText] = useState("");
  const [approveFrom, setApproveFrom] = useState(toLocalDateTimeInput(permit?.validFrom ?? permit?.plannedStart ?? null));
  const [approveTo, setApproveTo] = useState(toLocalDateTimeInput(permit?.validTo ?? permit?.plannedEnd ?? null));

  const latestGas = permit?.gasTests?.[0] ?? null;
  // Mismo criterio que el backend al activar: la última medición, apta y de hace ≤ 30 min.
  const gasOk = !!latestGas && latestGas.verdict === "PASS" && Date.now() - new Date(latestGas.testedAt).getTime() <= 30 * 60_000;
  const isEnclosed = permit?.type === "ENCLOSED_SPACE_ENTRY";
  const validToMs = permit?.validTo ? new Date(permit.validTo).getTime() : null;
  const activeLate = permit?.status === "ACTIVE" && validToMs != null && validToMs < Date.now();

  const runDialog = useCallback(async () => {
    const text = dlgText.trim();
    if (actionDlg === "reject" || actionDlg === "cancel") {
      if (!text) { setErr(t("pm.edit.reasonRequired")); return; }
      await callAction(actionDlg, { reason: text });
    } else if (actionDlg === "reopen") {
      if (text.length < 5) { setErr(t("pm.edit.reopenMin")); return; }
      await callAction("reopen", { reason: text });
    } else if (actionDlg === "close") {
      await callAction("close", { closeNotes: text || null });
    }
    setActionDlg(null);
    setDlgText("");
  }, [actionDlg, dlgText, callAction, t]);

  const approveNow = useCallback(() => {
    void callAction("approve", {
      validFrom: approveFrom ? new Date(approveFrom).toISOString() : null,
      validTo: approveTo ? new Date(approveTo).toISOString() : null,
    });
  }, [approveFrom, approveTo, callAction]);

  if (!isNew && permit) {
    const PIcon = TYPE_ICON[permit.type];
    const order: PermitStatus[] = ["DRAFT", "REQUESTED", "APPROVED", "ACTIVE", "CLOSED"];
    const stepIdx = permit.status === "REJECTED" || permit.status === "CANCELLED" ? -1 : order.indexOf(permit.status);
    const stepDates: Partial<Record<PermitStatus, string | null>> = {
      REQUESTED: permit.requestedAt, APPROVED: permit.approvedAt, ACTIVE: permit.activatedAt, CLOSED: permit.closedAt,
    };
    const riskMissing = !hazards.trim() || !controls.trim() || !ppe.trim();
    const missingCount = [!hazards.trim(), !controls.trim(), !ppe.trim()].filter(Boolean).length;
    const btn = "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed";
    const check = (ok: boolean, label: string, Icon: typeof Flame = CheckCircle) => (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${ok ? "border-emerald-500/35 bg-surface text-emerald-700 dark:text-emerald-400" : "border-amber-400/70 bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>
        {ok ? <CheckCircle className="w-3 h-3" /> : <Icon className="w-3 h-3" />} {label}
      </span>
    );
    const aiPillE = (onClick: () => void, loading: boolean) => !isEditable ? null : (
      <button type="button" onClick={onClick} disabled={loading}
        className="ml-auto inline-flex items-center gap-1 rounded-full border border-violet-500/35 bg-violet-500/[0.07] px-2 py-0.5 text-[10.5px] font-extrabold text-violet-700 dark:text-violet-300 hover:bg-violet-500/15 disabled:opacity-60">
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} {t("mp.guide.suggestAi")}
      </button>
    );

    // Recuadro "qué hacer ahora" según la etapa del permiso.
    const next = (() => {
      const card = (tone: string, iconBox: string, Icon: typeof Flame, title: string, desc: string, extra: React.ReactNode, actions: React.ReactNode) => (
        <div className={`rounded-2xl border-[1.5px] px-3.5 py-3 space-y-2.5 ${tone}`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 ${iconBox}`}><Icon className="w-5 h-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-black text-fg">{title}</p>
              <p className="text-[12.5px] text-text-industrial/70">{desc}</p>
            </div>
            <div className="flex flex-wrap gap-2 ml-auto">{actions}</div>
          </div>
          {extra}
        </div>
      );
      switch (permit.status) {
        case "DRAFT":
          return card("border-orange-400/60 bg-orange-500/[0.07]", "bg-orange-600", Send, t("pm.edit.draftTitle"), t("pm.edit.draftDesc"),
            <div className="flex flex-wrap gap-1.5">
              {check(!!location.trim() && !!description.trim() && !!plannedStart && !!plannedEnd, t("pm.edit.chkWork"))}
              {check(!!hazards.trim(), t("pm.wiz.hazards"))}
              {check(!!controls.trim(), t("pm.wiz.controls"))}
              {check(!!ppe.trim(), t("pm.edit.chkPpe"))}
            </div>,
            <button type="button" disabled={saving} onClick={() => { void onSave(true); }} className={`${btn} bg-orange-600 text-white hover:brightness-110`}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {t("common.requestApproval")}
              {riskMissing && <span className="text-[10px] font-semibold opacity-85">{t("mp.guide.saveMissing").replace("{n}", String(missingCount))}</span>}
            </button>);
        case "REQUESTED":
          return canApprove
            ? card("border-yellow-400/70 bg-yellow-500/[0.08]", "bg-yellow-600", PenLine, t("pm.edit.reqTitle"), t("pm.edit.reqDesc"),
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl">
                  <div><label className={fl}>{t("pm.validFrom")}</label><input type="datetime-local" value={approveFrom} onChange={e => setApproveFrom(e.target.value)} className={inputCls} /></div>
                  <div><label className={fl}>{t("pm.validUntil")}</label><input type="datetime-local" value={approveTo} onChange={e => setApproveTo(e.target.value)} className={inputCls} /></div>
                </div>,
                <>
                  <button type="button" disabled={saving} onClick={approveNow} className={`${btn} bg-emerald-600 text-white hover:brightness-110`}><CheckCircle className="w-3.5 h-3.5" /> {t("common.approve")}</button>
                  <button type="button" disabled={saving} onClick={() => { setDlgText(""); setActionDlg("reject"); }} className={`${btn} border border-red-500/35 bg-surface text-red-700 dark:text-red-400 hover:bg-red-500/10`}><XCircle className="w-3.5 h-3.5" /> {t("common.reject")}</button>
                </>)
            : card("border-yellow-400/70 bg-yellow-500/[0.08]", "bg-yellow-600", Hourglass, t("pm.edit.reqWaitTitle"), t("pm.edit.reqWaitDesc"), null, null);
        case "APPROVED": {
          const blocked = isEnclosed && !gasOk;
          return card("border-blue-400/60 bg-blue-500/[0.07]", "bg-blue-600", Play, t("pm.edit.apprTitle"), t("pm.edit.apprDesc"),
            <div className="flex flex-wrap gap-1.5">
              {check(true, t("pm.edit.chkPeople").replace("{n}", String(permit.participants.length)), Users)}
              {permit.validFrom && permit.validTo && check(true, `${t("pm.edit.valid")} ${fmtDateTime(permit.validFrom)} → ${fmtDateTime(permit.validTo)}`)}
              {isEnclosed && check(gasOk, gasOk ? t("pm.edit.gasOk") : t("pm.edit.gasMissing"), Wind)}
            </div>,
            <button type="button" disabled={saving || blocked} onClick={() => { void callAction("activate"); }}
              title={blocked ? t("pm.edit.gasMissing") : undefined} className={`${btn} bg-accent text-accent-fg hover:brightness-110`}>
              <Play className="w-3.5 h-3.5" /> {t("common.activate")}
            </button>);
        }
        case "ACTIVE":
          return activeLate
            ? card("border-red-400/60 bg-red-500/[0.07]", "bg-red-600", AlertTriangle,
                t("pm.edit.lateTitle").replace("{span}", fmtSpan(Date.now() - (validToMs ?? Date.now()))), t("pm.edit.lateDesc"), null,
                <button type="button" disabled={saving} onClick={() => { setDlgText(""); setActionDlg("close"); }} className={`${btn} bg-emerald-600 text-white hover:brightness-110`}><CheckCircle className="w-3.5 h-3.5" /> {t("pm.edit.closePermit")}</button>)
            : card("border-emerald-500/40 bg-emerald-500/[0.07]", "bg-emerald-600", HardHat,
                validToMs != null ? t("pm.edit.liveTitle").replace("{span}", fmtSpan(validToMs - Date.now())) : t("pm.edit.liveTitleNoEnd"), t("pm.edit.liveDesc"), null,
                <button type="button" disabled={saving} onClick={() => { setDlgText(""); setActionDlg("close"); }} className={`${btn} bg-emerald-600 text-white hover:brightness-110`}><CheckCircle className="w-3.5 h-3.5" /> {t("pm.edit.closePermit")}</button>);
        default: {
          const reason = permit.status === "REJECTED" ? permit.rejectionReason : permit.status === "CANCELLED" ? permit.cancelReason : permit.closeNotes;
          const tone = permit.status === "CLOSED" ? ["border-emerald-500/40 bg-emerald-500/[0.07]", "bg-emerald-600"] : ["border-red-400/50 bg-red-500/[0.06]", "bg-red-600"];
          return card(tone[0], tone[1], permit.status === "CLOSED" ? CheckCircle : XCircle,
            t(STATUS_TKEY[permit.status]), reason ? reason : t("pm.lockedHint").replace("{status}", t(STATUS_TKEY[permit.status])), null,
            isAdmin && (
              <button type="button" disabled={saving} onClick={() => { setDlgText(""); setActionDlg("reopen"); }} className={`${btn} border border-orange-500/40 bg-surface text-orange-700 dark:text-orange-300 hover:bg-orange-500/10`}>
                <RotateCcw className="w-3.5 h-3.5" /> {t("common.reopen")}
              </button>
            ));
        }
      }
    })();

    const dlgMeta = actionDlg && {
      reject: { title: t("pm.edit.dlgReject"), label: t("pm.edit.dlgRejectQ"), ph: t("pm.edit.dlgRejectPh"), cta: t("common.reject"), cls: "bg-red-600 text-white" },
      cancel: { title: t("pm.edit.dlgCancel"), label: t("pm.edit.dlgCancelQ"), ph: t("pm.edit.dlgCancelPh"), cta: t("pm.edit.dlgCancelCta"), cls: "bg-red-600 text-white" },
      reopen: { title: t("pm.edit.dlgReopen"), label: t("pm.edit.dlgReopenQ"), ph: t("pm.edit.dlgReopenPh"), cta: t("common.reopen"), cls: "bg-orange-600 text-white" },
      close: { title: t("pm.edit.dlgClose"), label: t("pm.edit.dlgCloseQ"), ph: t("pm.edit.dlgClosePh"), cta: t("pm.edit.closePermit"), cls: "bg-emerald-600 text-white" },
    }[actionDlg];

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-6xl max-h-[92vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 border-t-4 border-t-orange-600 rounded-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
          {/* Encabezado */}
          <div className="flex items-start gap-3 px-4 sm:px-6 py-3 border-b border-fg/10 shrink-0">
            <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${TYPE_TONE[permit.type]}`}><PIcon className="w-6 h-6" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-orange-700 dark:text-orange-400">{t("pm.wiz.kicker")} · {t(TYPE_TKEY[permit.type])}</p>
              <h2 className="text-lg font-black text-fg leading-tight truncate">{description.trim() || permit.description}</h2>
              <p className="text-xs text-text-industrial/60 truncate">{location.trim() || permit.location}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 font-mono text-[11px] font-bold text-fg">{permit.permitCode}</span>
                {/* Nombre del buque, no el código. */}
                <span className="inline-flex items-center gap-1 rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/70"><Ship className="w-3 h-3" /><VesselLabel code={permit.vesselCode} className="text-[11px]" /></span>
                {workOrder ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 font-mono text-[11px] font-bold text-accent" title={workOrder.title ?? undefined}>
                    <Wrench className="w-3 h-3" /> {workOrder.code ?? "—"}
                    {canEditWorkOrder && <button type="button" onClick={() => setPickingWorkOrder(true)} className="font-sans text-[11px] font-extrabold underline">{t("pm.wiz.change")}</button>}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/60">
                    {t("pm.wiz.noWo")}
                    {canEditWorkOrder && <button type="button" onClick={() => setPickingWorkOrder(true)} className="text-[11px] font-extrabold text-accent underline">{t("pm.linkWo")}</button>}
                  </span>
                )}
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${STATUS_COLOR[permit.status]}`}>{t(STATUS_TKEY[permit.status])}</span>
              </div>
            </div>
            <ModalCloseButton onClose={requestClose} />
          </div>

          {/* Recorrido con fechas */}
          <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-2.5 border-b border-fg/10 bg-fg/[0.02] shrink-0">
            {order.map((s, i) => {
              const done = stepIdx >= 0 && i < stepIdx;
              const cur = i === stepIdx;
              const date = stepDates[s];
              return (
                <React.Fragment key={s}>
                  {i > 0 && <span className="w-5 h-px bg-fg/15" />}
                  <span className={`flex items-center gap-1.5 text-xs font-bold ${done ? "text-emerald-700 dark:text-emerald-400" : cur ? "text-fg" : "text-text-industrial/40"}`}>
                    <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] ${done ? "bg-emerald-500 border-emerald-500 text-white" : cur ? "bg-orange-600 border-orange-600 text-white" : "border-fg/25"}`}>
                      {done ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
                    </span>
                    <span>
                      {t(STATUS_TKEY[s])}
                      {date && (done || cur) && <span className="block text-[10px] font-semibold text-text-industrial/45">{fmtDateTime(date)}</span>}
                    </span>
                  </span>
                </React.Fragment>
              );
            })}
            {stepIdx < 0 && (
              <span className="ml-auto rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-extrabold text-red-700 dark:text-red-400">{t(STATUS_TKEY[permit.status])}</span>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-4 sm:px-6 pt-4">{next}</div>
            <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-4 px-4 sm:px-6 py-4">
              {/* Izquierda: el trabajo y sus riesgos */}
              <div className="space-y-3 min-w-0">
                <GuideSection n={1} title={t("pm.wiz.sec1")} subtitle={isEditable ? t("pm.edit.sec1Editable") : t("pm.edit.sec1Locked")} open onToggle={() => { /* siempre abierto */ }}
                  pill={!isEditable ? <span className="rounded-full bg-fg/10 px-2 py-0.5 text-[10px] font-bold text-text-industrial/60">{t("pm.edit.locked")}</span>
                    : <GuidePill missing={[!location.trim(), !description.trim(), !plannedStart, !plannedEnd].filter(Boolean).length} completeLabel={t("mp.guide.complete")} missingOne={t("mp.guide.missingOne")} missingMany={t("mp.guide.missingMany")} />}>
                  {/* Obligatorios: se resaltan mientras falten y el permiso sea editable (preview V24). */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <GuideField id="pm-e-location" missing={isEditable && !location.trim()}>
                      <label className={fl}>{t("common.location")}{isEditable && !location.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                      <input value={location} onChange={e => setLocation(e.target.value)} disabled={!isEditable} className={inputCls} placeholder={t("pm.locationPh")} />
                    </GuideField>
                    <div><label className={fl}>{t("pm.type")}</label><input value={t(TYPE_TKEY[permit.type])} disabled className={inputCls} /></div>
                  </div>
                  <GuideField id="pm-e-description" missing={isEditable && !description.trim()}>
                    <label className={fl}>{t("pm.wiz.workWhat")}{isEditable && !description.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                    <AutoTextArea rows={2} value={description} onChange={e => setDescription(e.target.value)} disabled={!isEditable} className={inputCls} />
                  </GuideField>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <GuideField id="pm-e-start" missing={isEditable && !plannedStart}>
                      <label className={fl}>{t("pm.wiz.starts")}{isEditable && !plannedStart && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                      <input type="datetime-local" value={plannedStart} onChange={e => setPlannedStart(e.target.value)} disabled={!isEditable} className={inputCls} />
                    </GuideField>
                    <GuideField id="pm-e-end" missing={isEditable && !plannedEnd}>
                      <label className={fl}>{t("pm.wiz.ends")}{isEditable && !plannedEnd && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                      <input type="datetime-local" value={plannedEnd} onChange={e => setPlannedEnd(e.target.value)} disabled={!isEditable} className={inputCls} />
                    </GuideField>
                  </div>
                </GuideSection>

                <GuideSection n={2} title={t("pm.wiz.sec2")} subtitle={t("pm.wiz.sec2Sub")} open onToggle={() => { /* siempre abierto */ }}
                  pill={isEditable ? <GuidePill missing={missingCount} completeLabel={t("mp.guide.complete")} missingOne={t("mp.guide.missingOne")} missingMany={t("mp.guide.missingMany")} /> : undefined}>
                  <GuideField id="pm-e-hazards" missing={isEditable && !hazards.trim()}>
                    <div className="flex items-center gap-1"><label className={`${fl} mb-0`}>{t("pm.wiz.hazards")}{isEditable && !hazards.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>{aiPillE(() => { void onSuggestHazards(); }, loadingHazards)}</div>
                    <AutoTextArea rows={3} value={hazards} onChange={e => setHazards(e.target.value)} disabled={!isEditable || loadingHazards} className={inputCls} placeholder={t("pm.hazardsPh")} />
                  </GuideField>
                  <GuideField id="pm-e-controls" missing={isEditable && !controls.trim()}>
                    <div className="flex items-center gap-1"><label className={`${fl} mb-0`}>{t("pm.wiz.controls")}{isEditable && !controls.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>{aiPillE(() => { void onSuggestControls(); }, loadingControls)}</div>
                    <AutoTextArea rows={3} value={controls} onChange={e => setControls(e.target.value)} disabled={!isEditable || loadingControls} className={inputCls} placeholder={t("pm.controlsPh")} />
                  </GuideField>
                  <GuideField id="pm-e-ppe" missing={isEditable && !ppe.trim()}>
                    <div className="flex items-center gap-1"><label className={`${fl} mb-0`}>{t("pm.wiz.ppe")}{isEditable && !ppe.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>{aiPillE(() => { void onSuggestPpe(); }, loadingPpe)}</div>
                    <AutoTextArea rows={2} value={ppe} onChange={e => setPpe(e.target.value)} disabled={!isEditable || loadingPpe} className={inputCls} placeholder={t("pm.ppePh")} />
                  </GuideField>
                  <label className={`flex items-start gap-2.5 rounded-xl border-[1.5px] border-orange-500/30 bg-orange-500/[0.05] px-3 py-2.5 ${isEditable ? "cursor-pointer hover:bg-orange-500/10" : "opacity-70"}`}>
                    <input type="checkbox" checked={alarmOverride} onChange={e => setAlarmOverride(e.target.checked)} disabled={!isEditable} className="mt-0.5 w-4 h-4 accent-orange-600" />
                    <span>
                      <span className="block text-[13px] font-extrabold text-orange-800 dark:text-orange-200">{t("pm.wiz.overrideTitle")}</span>
                      <span className="block text-[11.5px] text-text-industrial/60">{t("pm.wiz.overrideHint")}</span>
                    </span>
                  </label>
                </GuideSection>
              </div>

              {/* Derecha: equipo de trabajo, gas y permiso firmado */}
              <div className="space-y-3 min-w-0">
                <div className="rounded-2xl border border-fg/10 overflow-hidden">
                  <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg"><Users className="w-4 h-4" /> {t("pm.edit.team")} <span className="ml-auto text-[11px] font-semibold text-text-industrial/50">{permit.participants.length}</span></h3>
                  <div className="p-3"><ParticipantsTab permit={permit} canEdit={!isTerminal} onChanged={onReload ?? onSaved} /></div>
                </div>
                {isEnclosed && (
                  <div className="rounded-2xl border border-fg/10 overflow-hidden">
                    <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg">
                      <Wind className="w-4 h-4" /> {t("pm.edit.gas")}
                      {latestGas && <span className={`ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${latestGas.verdict === "PASS" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-red-500/15 text-red-700 dark:text-red-400"}`}>{latestGas.verdict === "PASS" ? t("pm.edit.gasPass") : t("pm.edit.gasFail")}</span>}
                    </h3>
                    <div className="p-3"><GasTestsTab permit={permit} canEdit={!isTerminal} onChanged={onReload ?? onSaved} /></div>
                  </div>
                )}
                <div className="rounded-2xl border border-fg/10 overflow-hidden">
                  <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg"><Paperclip className="w-4 h-4" /> {t("pm.edit.signed")}</h3>
                  <div className="p-3 space-y-2.5">
                    <AttachmentsTab permitId={permit.id} items={attachments} canEdit={canManagePermits} onChanged={reloadAttachments} />
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => { void onDownload("pdf"); }} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs font-bold text-fg hover:border-accent/30 disabled:opacity-50">
                        <FileText className="w-3.5 h-3.5" /> {t("pm.edit.pdfPrint")}
                      </button>
                      {/* El mismo formulario, editable: se completa en Word y se imprime. */}
                      <button onClick={() => { void onDownload("doc"); }} disabled={saving} title={t("pm.wordHint")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs font-bold text-fg hover:border-accent/30 disabled:opacity-50">
                        <FileDown className="w-3.5 h-3.5" /> Word
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-t border-fg/10 shrink-0">
            {!isTerminal && (
              <button type="button" onClick={() => { setDlgText(""); setActionDlg("cancel"); }} disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/30 text-xs font-bold text-red-700 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                <XCircle className="w-3.5 h-3.5" /> {t("pm.edit.dlgCancelCta")}
              </button>
            )}
            <span className="flex-1" />
            {isEditable && isDirty && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-amber-700 dark:text-amber-400"><AlertTriangle className="w-3 h-3" /> {t("mp.guide.dirty")}</span>
            )}
            <button onClick={requestClose} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.close")}</button>
            {isEditable && (
              <button onClick={() => { void onSave(false); }} disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {t("common.save")}
                {!saving && [!location.trim(), !description.trim(), !plannedStart, !plannedEnd].some(Boolean) && (
                  <span className="text-[10px] font-semibold opacity-85">{t("mp.guide.saveMissing").replace("{n}", String([!location.trim(), !description.trim(), !plannedStart, !plannedEnd].filter(Boolean).length))}</span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Rechazar / cerrar / cancelar / re-abrir */}
        {actionDlg && dlgMeta && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => e.stopPropagation()}>
            <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-fg/10">
                <h2 className="text-base font-black text-fg">{dlgMeta.title}</h2>
                <ModalCloseButton onClose={() => setActionDlg(null)} className="ml-auto" />
              </div>
              <div className="px-5 py-4 space-y-2">
                <label className={fl}>{dlgMeta.label}</label>
                <AutoTextArea rows={3} value={dlgText} onChange={e => setDlgText(e.target.value)} placeholder={dlgMeta.ph} className={inputCls} autoFocus />
              </div>
              <div className="flex items-center gap-2 px-5 py-3 border-t border-fg/10">
                <span className="flex-1" />
                <button type="button" onClick={() => setActionDlg(null)} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.back")}</button>
                <button type="button" onClick={() => { void runDialog(); }} disabled={saving} className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold hover:brightness-110 disabled:opacity-50 ${dlgMeta.cls}`}>
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {dlgMeta.cta}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Avisos y errores en ventanita. */}
        {err && <AlertDialog message={err} onClose={() => setErr(null)} />}

        {pickingWorkOrder && (
          <WorkOrderPicker
            initialVesselCode={vesselCode || null}
            lockVessel
            onClose={() => setPickingWorkOrder(false)}
            onPick={wo => {
              setWorkOrder({ id: wo.id, code: wo.workOrderCode, title: wo.title });
              // El permiso vive en el buque de su OT: el backend rechaza el cruce.
              setVesselCode(wo.vesselCode);
              setPickingWorkOrder(false);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[92vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 border-t-4 border-t-orange-600 rounded-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <PermitWizardHeader title={t("pm.newPermit")} onClose={requestClose}
          stepper={wizard ? <WizardStepper labels={wizard.labels} current={wizard.current} /> : undefined} />
        <div className="overflow-y-auto flex-1 p-5 sm:p-6">{newForm}</div>
        {newFooter}
      </div>

      {/* Avisos y errores en ventanita (antes: recuadro rojo al pie del formulario). */}
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}

      {pickingWorkOrder && (
        <WorkOrderPicker
          initialVesselCode={vesselCode || null}
          lockVessel={false}
          onClose={() => setPickingWorkOrder(false)}
          onPick={wo => {
            setWorkOrder({ id: wo.id, code: wo.workOrderCode, title: wo.title });
            // El permiso vive en el buque de su OT: el backend rechaza el cruce.
            setVesselCode(wo.vesselCode);
            setPickingWorkOrder(false);
          }}
        />
      )}
    </div>
  );
};

// ─── Participants Tab ────────────────────────────────────────────────────────

const ParticipantsTab: React.FC<{ permit: Permit; canEdit: boolean; onChanged: () => void }> = ({ permit, canEdit, onChanged }) => {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [crewId, setCrewId] = useState<string>("");
  const [name, setName]     = useState("");
  const [role, setRole]     = useState<ParticipantRole>("PERFORMER");
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const { data: crewData } = useFetch<{ items: CrewItem[] }>(`/app/crew?status=ONBOARD&vesselCode=${permit.vesselCode}`, [permit.vesselCode]);
  const crewOptions = crewData?.items ?? [];

  const onAdd = useCallback(async () => {
    if (!crewId && !name.trim()) { setErr("Elegí un tripulante o ingresá un nombre."); return; }
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/permits/${permit.id}/participants`, {
        crewId: crewId || null,
        name: crewId ? null : name.trim(),
        role,
      });
      setCrewId(""); setName(""); setRole("PERFORMER"); setAdding(false);
      onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error al agregar."); }
    finally { setSaving(false); }
  }, [permit.id, crewId, name, role, onChanged]);

  const onDelete = useCallback(async (id: string) => {
    if (!confirm(t("confirm.deleteParticipant"))) return;
    try { await api.delete(`/app/permits/${permit.id}/participants/${id}`); onChanged(); }
    catch (e) { alert(e instanceof ApiError ? e.message : t("error.delete")); }
  }, [permit.id, onChanged]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {!adding && canEdit && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent text-xs font-bold hover:bg-accent/20">
            <Plus className="w-3.5 h-3.5" /> Agregar
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-fg/5 border border-fg/10 rounded-xl p-4 space-y-3">
          <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 ${!crewId && !name.trim() ? "rounded-xl border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-500/10 px-3 py-2.5" : ""}`}>
            <div>
              <label className={labelCls}>Tripulante a bordo{!crewId && !name.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
              <select value={crewId} onChange={e => { setCrewId(e.target.value); if (e.target.value) setName(""); }} className={inputCls}>
                <option value="">— Otro / contratista —</option>
                {crewOptions.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName} ({c.rank})</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Nombre (si no es crew)</label>
              <input value={name} onChange={e => setName(e.target.value)} disabled={!!crewId} className={inputCls} placeholder="Contratista / externo" />
            </div>
            <div>
              <label className={labelCls}>Rol</label>
              <select value={role} onChange={e => setRole(e.target.value as ParticipantRole)} className={inputCls}>
                {(Object.keys(ROLE_LABEL) as ParticipantRole[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
          </div>
          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAdding(false); setErr(null); }} className="px-3 py-1.5 rounded-lg text-xs text-text-industrial hover:text-fg">Cancelar</button>
            <button onClick={() => { void onAdd(); }} disabled={saving} className="px-4 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Agregar"}
            </button>
          </div>
        </div>
      )}

      {permit.participants.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">Sin participantes registrados</div>
      ) : (
        <div className="divide-y divide-fg/5">
          {permit.participants.map(p => (
            <div key={p.id} className="py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-fg">{p.name}</p>
                <p className="text-[10px] text-text-industrial/40">{ROLE_LABEL[p.role]}</p>
              </div>
              {canEdit && <button onClick={() => { void onDelete(p.id); }} className="text-[10px] text-red-700 dark:text-red-400 hover:underline">Quitar</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Attachments Tab (respaldos) ─────────────────────────────────────────────
//
// El permiso se imprime, se firma en papel a bordo y se escanea: ese scan es la
// evidencia que pide una auditoría. Se puede adjuntar en cualquier estado del
// permiso —incluso cerrado—, porque el papel firmado vuelve después.

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const AttachmentsTab: React.FC<{
  permitId: string;
  items: PermitAttachment[];
  canEdit: boolean;
  onChanged: () => void;
}> = ({ permitId, items, canEdit, onChanged }) => {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [alertMsg, setAlertMsg]   = useState<string | null>(null);

  const onPickFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Limpiamos el input para poder re-elegir el mismo archivo si hizo falta.
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      await api.upload(`/app/permits/${permitId}/attachments`, file);
      onChanged();
    } catch (err) {
      setAlertMsg(err instanceof ApiError ? err.message : t("pm.attachUploadError"));
    } finally {
      setUploading(false);
    }
  }, [permitId, onChanged, t]);

  const onDelete = useCallback(async (att: PermitAttachment) => {
    if (!confirm(t("pm.attachDeleteConfirm"))) return;
    try {
      await api.delete(`/app/permits/${permitId}/attachments/${att.id}`);
      onChanged();
    } catch (err) {
      setAlertMsg(err instanceof ApiError ? err.message : t("error.delete"));
    }
  }, [permitId, onChanged, t]);

  return (
    <div className="space-y-3">
      {alertMsg && <AlertDialog message={alertMsg} onClose={() => setAlertMsg(null)} />}

      <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 text-[11px] text-text-industrial/70 leading-snug">
        {t("pm.attachHint")}
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
            className="hidden"
            onChange={e => { void onPickFile(e); }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent text-xs font-bold hover:bg-accent/20 disabled:opacity-50"
          >
            {uploading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("pm.attachUploading")}</>
              : <><Plus className="w-3.5 h-3.5" /> {t("pm.attachScan")}</>}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">{t("pm.noAttachments")}</div>
      ) : (
        <div className="divide-y divide-fg/5">
          {items.map(att => (
            <div key={att.id} className="py-2.5 flex items-center gap-3">
              <Paperclip className="w-3.5 h-3.5 text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-fg truncate">{att.filename}</p>
                <p className="text-[10px] text-text-industrial/40">
                  {fmtSize(att.sizeBytes)} · {t("pm.attachUploadedBy")} {att.uploadedByName ?? "—"} · {fmtDateTime(att.uploadedAt)}
                </p>
              </div>
              {/* Los uploads se sirven por /app/files/* con Bearer token: un <a href>
                  plano no manda el header y devuelve 410. */}
              <AuthedDocLink
                src={att.url}
                label={t("common.view")}
                className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-[11px] text-text-industrial hover:border-accent/30"
              />
              <button
                onClick={() => { void downloadAuthedFile(att.url, att.filename); }}
                title={t("common.download")}
                className="shrink-0 p-1.5 rounded-lg text-text-industrial/50 hover:text-accent hover:bg-fg/5"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              {canEdit && (
                <button
                  onClick={() => { void onDelete(att); }}
                  title={t("common.remove")}
                  className="shrink-0 p-1.5 rounded-lg text-red-700/70 dark:text-red-400/70 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Gas Tests Tab ───────────────────────────────────────────────────────────

const GasTestsTab: React.FC<{ permit: Permit; canEdit: boolean; onChanged: () => void }> = ({ permit, canEdit, onChanged }) => {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [testedByName, setTestedByName] = useState("");
  const [location, setLocation]         = useState("");
  const [o2, setO2]                     = useState("");
  const [lel, setLel]                   = useState("");
  const [h2s, setH2s]                   = useState("");
  const [co, setCo]                     = useState("");
  const [notes, setNotes]               = useState("");
  const [saving, setSaving]             = useState(false);
  const [err, setErr]                   = useState<string | null>(null);

  const reset = () => {
    setTestedByName(""); setLocation(""); setO2(""); setLel(""); setH2s(""); setCo(""); setNotes("");
    setAdding(false); setErr(null);
  };

  const onAdd = useCallback(async () => {
    if (!testedByName.trim()) { setErr("Nombre de quien midió es obligatorio."); return; }
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/permits/${permit.id}/gas-tests`, {
        testedAt: new Date().toISOString(),
        testedByName: testedByName.trim(),
        location: location.trim() || null,
        o2Pct: o2 ? Number(o2) : null,
        lelPct: lel ? Number(lel) : null,
        h2sPpm: h2s ? Number(h2s) : null,
        coPpm: co ? Number(co) : null,
        notes: notes.trim() || null,
      });
      reset();
      onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error al registrar gas test."); }
    finally { setSaving(false); }
  }, [permit.id, testedByName, location, o2, lel, h2s, co, notes, onChanged]);

  const onDelete = useCallback(async (id: string) => {
    if (!confirm(t("confirm.deleteGasTest"))) return;
    try { await api.delete(`/app/permits/${permit.id}/gas-tests/${id}`); onChanged(); }
    catch (e) { alert(e instanceof ApiError ? e.message : t("error.delete")); }
  }, [permit.id, onChanged]);

  return (
    <div className="space-y-3">
      <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 text-[11px] text-text-industrial/70 leading-snug">
        <p className="font-bold text-text-industrial mb-1">Umbrales IMO A.1050(27):</p>
        <p>O₂ entre 19.5% – 23% · LEL &lt; 1% · H₂S &lt; 10 ppm · CO &lt; 50 ppm. El verdict se computa server-side.</p>
      </div>

      <div className="flex justify-end">
        {!adding && canEdit && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent text-xs font-bold hover:bg-accent/20">
            <Plus className="w-3.5 h-3.5" /> Registrar test
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-fg/5 border border-fg/10 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <GuideField id="pm-gas-by" missing={!testedByName.trim()}>
              <label className={labelCls}>Medido por{!testedByName.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
              <input value={testedByName} onChange={e => setTestedByName(e.target.value)} className={inputCls} />
            </GuideField>
            <div>
              <label className={labelCls}>Ubicación de la medición</label>
              <input value={location} onChange={e => setLocation(e.target.value)} className={inputCls} placeholder="ej. boca de hombre, fondo del tanque" />
            </div>
            <div>
              <label className={labelCls}>O₂ (%)</label>
              <input type="number" step="0.1" value={o2} onChange={e => setO2(e.target.value)} className={inputCls} placeholder="19.5 - 23" />
            </div>
            <div>
              <label className={labelCls}>LEL (%)</label>
              <input type="number" step="0.1" value={lel} onChange={e => setLel(e.target.value)} className={inputCls} placeholder="&lt; 1" />
            </div>
            <div>
              <label className={labelCls}>H₂S (ppm)</label>
              <input type="number" step="1" value={h2s} onChange={e => setH2s(e.target.value)} className={inputCls} placeholder="&lt; 10" />
            </div>
            <div>
              <label className={labelCls}>CO (ppm)</label>
              <input type="number" step="1" value={co} onChange={e => setCo(e.target.value)} className={inputCls} placeholder="&lt; 50" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Notas</label>
              <AutoTextArea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} />
            </div>
          </div>
          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={reset} className="px-3 py-1.5 rounded-lg text-xs text-text-industrial hover:text-fg">Cancelar</button>
            <button onClick={() => { void onAdd(); }} disabled={saving} className="px-4 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Registrar"}
            </button>
          </div>
        </div>
      )}

      {permit.gasTests.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">Sin gas tests registrados</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-industrial/50 border-b border-fg/10">
                <th className="text-left p-2">Fecha/Hora</th>
                <th className="text-left p-2">Por</th>
                <th className="text-right p-2">O₂%</th>
                <th className="text-right p-2">LEL%</th>
                <th className="text-right p-2">H₂S</th>
                <th className="text-right p-2">CO</th>
                <th className="text-center p-2">Verdict</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-fg/5">
              {permit.gasTests.map(g => (
                <tr key={g.id}>
                  <td className="p-2 text-fg/80 font-mono">{fmtDateTime(g.testedAt)}</td>
                  <td className="p-2 text-fg/80">{g.testedByName}</td>
                  <td className="p-2 text-right tabular-nums">{g.o2Pct != null ? g.o2Pct.toFixed(1) : "—"}</td>
                  <td className="p-2 text-right tabular-nums">{g.lelPct != null ? g.lelPct.toFixed(2) : "—"}</td>
                  <td className="p-2 text-right tabular-nums">{g.h2sPpm != null ? g.h2sPpm.toFixed(0) : "—"}</td>
                  <td className="p-2 text-right tabular-nums">{g.coPpm != null ? g.coPpm.toFixed(0) : "—"}</td>
                  <td className="p-2 text-center">
                    {g.verdict === "PASS"
                      ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-success-sea"><CheckCircle className="w-3 h-3" /> PASS</span>
                      : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 dark:text-red-400"><XCircle className="w-3 h-3" /> FAIL</span>}
                  </td>
                  {canEdit && <td className="p-2 text-right"><button onClick={() => { void onDelete(g.id); }} className="text-[10px] text-red-700 dark:text-red-400 hover:underline">Borrar</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

/** Pasos del alta de un permiso. */
type CreateFlow =
  | { step: "origin" }
  | { step: "workOrder" }
  | { step: "type"; prefill: PermitModalPrefill }
  | { step: "form"; prefill?: PermitModalPrefill };

/**
 * Alta de un permiso en tres pasos: origen (OT abierta / ocasional) → elegir la
 * OT → formulario. Se monta desde esta pantalla y desde el acceso grande del
 * Dashboard, para que el flujo sea el mismo desde los dos lados.
 */
export const NewPermitFlow: React.FC<{ onClose: () => void; onSaved?: () => void }> = ({ onClose, onSaved }) => {
  const t = useT();
  const [flow, setFlow] = useState<CreateFlow>({ step: "origin" });
  const mocTrigger = useMocTrigger();
  const woLabels = [t("pm.wiz.stepOrigin"), t("pm.wiz.stepWo"), t("pm.wiz.stepType"), t("pm.wiz.stepForm")];
  const freeLabels = [t("pm.wiz.stepOrigin"), t("pm.wiz.stepType"), t("pm.wiz.stepForm")];

  return (
    <>
      {flow.step === "origin" && (
        <PermitOriginChooser
          onFromWorkOrder={() => setFlow({ step: "workOrder" })}
          onStandalone={() => setFlow({ step: "type", prefill: {} })}
          onClose={onClose}
        />
      )}

      {flow.step === "workOrder" && (
        <WorkOrderPicker
          stepper={<WizardStepper labels={woLabels} current={1} />}
          onClose={() => setFlow({ step: "origin" })}
          onPick={wo => setFlow({
            step: "type",
            prefill: {
              vesselCode: wo.vesselCode,
              workOrderId: wo.id,
              workOrderCode: wo.workOrderCode,
              workOrderTitle: wo.title ?? undefined,
              location: wo.location ?? "",
              description: wo.title ?? "",
              // Sugerencia advisory del tipo de permiso según el texto de la OT
              // (mismo clasificador que usa la hoja de la OT).
              type: suggestPermitTypesFromText(`${wo.title ?? ""} ${wo.assetName ?? ""}`)[0]?.type,
            },
          })}
        />
      )}

      {flow.step === "type" && (
        <PermitTypeChooser
          stepLabels={flow.prefill.workOrderId ? woLabels : freeLabels}
          current={flow.prefill.workOrderId ? 2 : 1}
          suggested={flow.prefill.type ?? null}
          workOrderCode={flow.prefill.workOrderCode ?? null}
          onPick={tp => setFlow({ step: "form", prefill: { ...flow.prefill, type: tp } })}
          onBack={() => setFlow(flow.prefill.workOrderId ? { step: "workOrder" } : { step: "origin" })}
          onClose={onClose}
        />
      )}

      {flow.step === "form" && (
        <PermitModal
          permit={null}
          prefill={flow.prefill}
          onClose={onClose}
          onSaved={() => { onSaved?.(); onClose(); }}
          onMocTrigger={mocTrigger.ask}
          wizard={{
            labels: flow.prefill?.workOrderId ? woLabels : freeLabels,
            current: flow.prefill?.workOrderId ? 3 : 2,
            onBack: () => setFlow({ step: "type", prefill: flow.prefill ?? {} }),
          }}
        />
      )}

      <MocTriggerHost controller={mocTrigger} />
    </>
  );
};

export const PermitsPage: React.FC = () => {
  const t = useT();
  // ?status=DRAFT llega desde la alerta "sin procesar" del Dashboard: arranca ese filtro.
  const [searchParams] = useSearchParams();
  const initialStatus = (searchParams.get("status") as PermitStatus | null) ?? null;

  // ── Listado (preview V22) ──────────────────────────────────────────────────
  // Se trae todo y se filtra en cliente: las tarjetas y los contadores necesitan el total.
  const { data, loading, error, reload } = useFetch<{ items: Permit[]; total: number }>("/app/permits", []);
  // Filtro que llega desde una métrica del panel TMSA (lib/tmsa-filter.tsx).
  const tmsaFilter = useTmsaFilter();
  const allItems = useMemo(() => applyTmsaFilter(data?.items ?? null, tmsaFilter, p => p.id) ?? [], [data, tmsaFilter]);
  const { vessels: contextVessels } = useVesselContext();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Permit | null>(null);
  const [editingDialog, setEditingDialog] = useState<"close" | null>(null);
  const mocTrigger = useMocTrigger();

  type Stage = "open" | PermitStatus | "all";
  const [cardSel, setCardSel] = useState<"" | "active" | "requested" | "approved" | "late">("");
  const [stageSel, setStageSel] = useState<Stage>(initialStatus ?? "open");
  const [typeSel, setTypeSel] = useState<"" | PermitType>("");
  const [vesselSel, setVesselSel] = useState("");
  const [search, setSearch] = useState("");

  const now = Date.now();
  const isLate = (p: Permit) => p.status === "ACTIVE" && !!p.validTo && new Date(p.validTo).getTime() < now;
  const needsGas = (p: Permit) => p.type === "ENCLOSED_SPACE_ENTRY" && p.status === "APPROVED" &&
    !(p.gasTests[0]?.verdict === "PASS" && now - new Date(p.gasTests[0].testedAt).getTime() <= 30 * 60_000);
  const matchCard = (p: Permit, key: typeof cardSel) => {
    switch (key) {
      case "active":    return p.status === "ACTIVE";
      case "requested": return p.status === "REQUESTED";
      case "approved":  return p.status === "APPROVED";
      case "late":      return isLate(p);
      default:          return true;
    }
  };
  const beforeStage = useMemo(() => {
    let items = allItems;
    if (cardSel) items = items.filter(p => matchCard(p, cardSel));
    if (typeSel) items = items.filter(p => p.type === typeSel);
    if (vesselSel) items = items.filter(p => p.vesselCode === vesselSel);
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter(p => textMatches(p.permitCode, q) || textMatches(p.description ?? "", q) ||
        textMatches(p.location ?? "", q) || textMatches(p.workOrderCode ?? "", q));
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems, cardSel, typeSel, vesselSel, search]);
  const OPEN_STATUSES: PermitStatus[] = ["DRAFT", "REQUESTED", "APPROVED", "ACTIVE"];
  const stageFilter = (items: Permit[], key: Stage) =>
    key === "all" ? items : key === "open" ? items.filter(p => OPEN_STATUSES.includes(p.status)) : items.filter(p => p.status === key);
  const shown = stageFilter(beforeStage, stageSel);
  const count = (key: Exclude<typeof cardSel, "">) => allItems.filter(p => matchCard(p, key)).length;
  const vesselOptions = useMemo(() => [...new Set(allItems.map(p => p.vesselCode))], [allItems]);
  const vesselName = (code: string) => contextVessels.find(v => v.code === code)?.name || code;

  const whenCell = (p: Permit) => {
    if (p.status === "ACTIVE" && p.validTo) {
      const ms = new Date(p.validTo).getTime() - now;
      return ms < 0
        ? <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] font-extrabold text-red-700 dark:text-red-400"><AlertTriangle className="w-3 h-3" />{t("pm.list.lateBy").replace("{span}", fmtSpan(ms))}</span>
        : <span className="whitespace-nowrap text-[11.5px] font-bold text-emerald-700 dark:text-emerald-400">{t("pm.list.endsIn").replace("{span}", fmtSpan(ms))}</span>;
    }
    if (p.status === "CLOSED") return <span className="whitespace-nowrap text-[11.5px] text-text-industrial/50">{t("pm.status.closed")} {fmtDateTime(p.closedAt)}</span>;
    return <span className="whitespace-nowrap text-[11.5px] text-text-industrial/60">{fmtDateTime(p.plannedStart)} → {fmtDateTime(p.plannedEnd)}</span>;
  };
  const peopleCell = (p: Permit) => (
    <div className="flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-1 text-[11.5px] text-text-industrial/60 whitespace-nowrap"><Users className="w-3 h-3" />{p.participants.length}</span>
      {needsGas(p) && <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-extrabold text-amber-800 dark:text-amber-300"><Wind className="w-3 h-3" />{t("pm.list.needGas")}</span>}
    </div>
  );
  const stageChip = (p: Permit) => <span className={`inline-block whitespace-nowrap rounded-lg border px-2 py-0.5 text-[10.5px] font-extrabold ${STATUS_COLOR[p.status]}`}>{t(STATUS_TKEY[p.status])}</span>;
  const rowAction = (p: Permit) => {
    const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors";
    const open = (dlg: "close" | null) => (e: React.MouseEvent) => { e.stopPropagation(); setEditingDialog(dlg); setEditing(p); };
    switch (p.status) {
      case "DRAFT":     return <button type="button" onClick={open(null)} className={`${base} border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300 hover:bg-orange-500/20`}><Send className="w-3 h-3" /> {t("pm.list.actRequest")}</button>;
      case "REQUESTED": return <button type="button" onClick={open(null)} className={`${base} border-yellow-500/40 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300 hover:bg-yellow-500/20`}><PenLine className="w-3 h-3" /> {t("pm.list.actReview")}</button>;
      case "APPROVED":  return <button type="button" onClick={open(null)} className={`${base} border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20`}>{needsGas(p) ? <Wind className="w-3 h-3" /> : <Play className="w-3 h-3" />} {needsGas(p) ? t("pm.list.actGas") : t("common.activate")}</button>;
      case "ACTIVE":    return <button type="button" onClick={open("close")} className={`${base} border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20`}><CheckCircle className="w-3 h-3" /> {t("pm.edit.closePermit")}</button>;
      default:          return null;
    }
  };

  const columns: Column<Permit>[] = [
    {
      key: "permitCode", header: t("pm.list.col.permit"), sortValue: r => r.permitCode,
      render: p => (
        <div>
          <div className="font-mono font-bold text-fg text-xs whitespace-nowrap">{p.permitCode}</div>
          {/* Nombre del buque, no el código. */}
          <div className="text-[10.5px] text-text-industrial/50">{vesselName(p.vesselCode)}</div>
        </div>
      ),
    },
    {
      key: "type", header: t("pm.type"), sortValue: r => t(TYPE_TKEY[r.type]),
      render: p => { const Icon = TYPE_ICON[p.type]; return <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-fg whitespace-nowrap"><span className={`w-6 h-6 rounded-lg flex items-center justify-center ${TYPE_TONE[p.type]}`}><Icon className="w-3.5 h-3.5" /></span>{t(TYPE_TKEY[p.type])}</span>; },
    },
    {
      key: "description", header: t("pm.list.col.work"),
      render: p => (
        <div className="min-w-0">
          <div className="text-xs font-bold text-fg line-clamp-2">{p.description}</div>
          <div className="text-[11px] text-text-industrial/55 truncate">{p.location}</div>
        </div>
      ),
    },
    {
      key: "workOrderCode", header: t("pm.list.col.wo"),
      render: p => p.workOrderCode
        ? <span className="font-mono text-[11px] font-bold text-accent" title={p.workOrderTitle ?? undefined}>{p.workOrderCode}</span>
        : <span className="text-[11px] text-text-industrial/45">{t("pm.list.oneOff")}</span>,
    },
    { key: "validTo", header: t("pm.list.col.when"), sortValue: r => r.validTo ?? r.plannedStart, render: whenCell },
    { key: "participants", header: t("pm.list.col.people"), render: peopleCell },
    { key: "status", header: t("pm.list.col.stage"), render: stageChip },
    { key: "action", header: "", render: rowAction },
  ];

  const summaryCards: { key: Exclude<typeof cardSel, "">; label: string; hint: string; icon: typeof Flame; cls: string; num: string }[] = [
    { key: "active", label: t("pm.sum.active"), hint: t("pm.sum.activeHint"), icon: HardHat, cls: "border-l-emerald-600", num: "text-emerald-700 dark:text-emerald-400" },
    { key: "requested", label: t("pm.sum.requested"), hint: t("pm.sum.requestedHint"), icon: Hourglass, cls: "border-l-yellow-500", num: "text-yellow-700 dark:text-yellow-400" },
    { key: "approved", label: t("pm.sum.approved"), hint: t("pm.sum.approvedHint"), icon: Play, cls: "border-l-blue-600", num: "text-blue-700 dark:text-blue-400" },
    { key: "late", label: t("pm.sum.late"), hint: t("pm.sum.lateHint"), icon: AlertTriangle, cls: "border-l-red-600", num: "text-red-700 dark:text-red-400" },
  ];
  const stages: [Stage, string][] = [
    ["open", t("pm.list.stageOpen")],
    ...(["DRAFT", "REQUESTED", "APPROVED", "ACTIVE", "CLOSED"] as PermitStatus[]).map(s => [s, t(STATUS_TKEY[s])] as [Stage, string]),
    ["all", t("common.all")],
  ];
  const selCls = (on: boolean) => `rounded-lg border px-2 py-1.5 text-xs focus:outline-none focus:border-accent/50 ${on ? "border-accent bg-accent/5 font-bold text-accent" : "border-fg/10 bg-fg/5 text-fg"}`;

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={ShieldAlert} title={t("pm.list.title")} total={shown.length} onReload={reload}>
        <ExportExcelButton module="permits" />
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-orange-600 text-white font-bold text-xs hover:brightness-110">
          <Plus className="w-3.5 h-3.5" /> {t("pm.list.new")}
        </button>
      </PageHeader>

      {/* Resumen: lo que necesita atención. Tocar una tarjeta filtra. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {summaryCards.map(c => {
          const on = cardSel === c.key;
          return (
            <button key={c.key} type="button" onClick={() => { setCardSel(on ? "" : c.key); if (!on) setStageSel("all"); }}
              className={`flex flex-col items-start gap-0.5 rounded-2xl border-[1.5px] border-l-4 bg-surface px-3 py-2.5 text-left transition-all ${c.cls} ${on ? "border-accent ring-2 ring-accent/20" : "border-fg/10 hover:border-fg/25"}`}>
              <span className={`text-2xl font-extrabold leading-tight ${c.num}`}>{count(c.key)}</span>
              <span className="flex items-center gap-1 text-xs font-semibold text-text-industrial/70"><c.icon className="w-3.5 h-3.5" />{c.label}</span>
              <span className="text-[10px] text-text-industrial/40">{c.hint}</span>
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="rounded-2xl border border-fg/10 bg-surface p-3 space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          {stages.map(([k, label]) => {
            const on = stageSel === k;
            return (
              <button key={k} type="button" onClick={() => setStageSel(k)}
                className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-xs font-bold transition-colors ${on ? "border-accent bg-accent text-accent-fg" : "border-fg/10 bg-surface text-text-industrial/60 hover:text-fg"}`}>
                {label}
                <span className={`rounded-full px-1.5 text-[10px] ${on ? "bg-white/25" : "bg-fg/10"}`}>{stageFilter(beforeStage, k).length}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={typeSel} onChange={e => setTypeSel(e.target.value as "" | PermitType)} className={selCls(!!typeSel)}>
            <option value="">{t("pm.list.typeAll")}</option>
            {(Object.keys(TYPE_TKEY) as PermitType[]).map(tp => <option key={tp} value={tp}>{t(TYPE_TKEY[tp])}</option>)}
          </select>
          {vesselOptions.length > 1 && (
            <select value={vesselSel} onChange={e => setVesselSel(e.target.value)} className={selCls(!!vesselSel)}>
              <option value="">{t("pm.list.vesselAll")}</option>
              {vesselOptions.map(v => <option key={v} value={v}>{vesselName(v)}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 w-full sm:w-auto sm:ml-auto">
            <Search className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("pm.list.search")}
              className="w-full sm:w-60 bg-transparent text-xs text-fg placeholder-text-industrial/30 focus:outline-none" />
            {search && <button type="button" onClick={() => setSearch("")} className="text-text-industrial/40 hover:text-fg"><X className="w-3 h-3" /></button>}
          </div>
        </div>
      </div>

      <TmsaFilterBanner filter={tmsaFilter} shown={shown.length} total={data?.items?.length ?? 0} />

      {/* Escritorio: tabla · Celular: tarjetas */}
      <div className="hidden md:block">
        <DataTable columns={columns} data={shown} loading={loading} error={error} keyFn={p => p.id} emptyText={t("pm.list.empty")}
          onRowClick={p => { setEditingDialog(null); setEditing(p); }}
          rowClassName={p => (isLate(p) ? "bg-red-500/[0.06] shadow-[inset_4px_0_0_rgb(220,38,38)]" : "")} />
      </div>
      <div className="md:hidden flex flex-col gap-2">
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>}
        {!loading && shown.length === 0 && <p className="py-8 text-center text-sm text-text-industrial/40">{t("pm.list.empty")}</p>}
        {shown.map(p => {
          const Icon = TYPE_ICON[p.type];
          return (
            <div key={p.id} onClick={() => { setEditingDialog(null); setEditing(p); }}
              className={`rounded-xl border border-fg/10 border-l-4 px-3 py-2.5 space-y-1.5 cursor-pointer ${isLate(p) ? "border-l-red-600 bg-red-500/[0.06]" : "border-l-fg/10 bg-surface"}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs font-bold text-fg">{p.permitCode}</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-text-industrial/70"><Icon className="w-3 h-3" />{t(TYPE_TKEY[p.type])}</span>
                {stageChip(p)}
              </div>
              <p className="text-[13px] font-bold text-fg line-clamp-2">{p.description}</p>
              <p className="text-xs text-text-industrial/60 truncate">{p.location} · {vesselName(p.vesselCode)}</p>
              <div className="flex flex-wrap items-center gap-2">{whenCell(p)}{needsGas(p) && peopleCell(p)}</div>
              {rowAction(p)}
            </div>
          );
        })}
      </div>

      {creating && <NewPermitFlow onClose={() => setCreating(false)} onSaved={() => { void reload(); }} />}

      {editing && (
        <PermitModal
          key={editing.id}
          permit={editing}
          initialDialog={editingDialog}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
          // Equipo de trabajo, gas y cambios de etapa: se refresca el permiso sin cerrar la ventana.
          onReload={() => {
            void reload();
            api.get<Permit>(`/app/permits/${editing.id}`).then(p => setEditing(p)).catch(() => { /* queda el anterior */ });
          }}
          onMocTrigger={mocTrigger.ask}
        />
      )}

      <MocTriggerHost controller={mocTrigger} />
    </div>
  );
};
