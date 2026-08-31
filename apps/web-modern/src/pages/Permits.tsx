import React, { useState, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ShieldAlert, Plus, X, Loader2, AlertTriangle, FileText, Flame, Wind, ArrowUp, Zap, CheckCircle, XCircle, Sparkles,
  Snowflake, Waves, FileDown, Paperclip, Download, Trash2,
} from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { useAuth, useCan } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { AlertDialog } from "../components/AlertDialog";
import { AuthedDocLink, downloadAuthedFile } from "../lib/authed-media";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { VesselLabel } from "../components/EntityLabels";
import { useMocTrigger, MocTriggerHost, type MocTriggerEvent } from "../lib/use-moc-trigger";
import { useT, type TranslationKey } from "../lib/i18n";
import { useTmsaFilter, applyTmsaFilter, TmsaFilterBanner } from "../lib/tmsa-filter";
import { AutoTextArea } from "../components/AutoTextArea";
import { suggestPermitTypesFromText } from "../lib/permit-classifier";

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

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider mb-1";

// ─── Origen del permiso (paso previo a crear) ────────────────────────────────

/**
 * Un permiso puede nacer de dos maneras: colgado de una OT abierta (el caso
 * normal: el trabajo ya está planificado) o suelto, para un trabajo ocasional
 * que no tiene OT. Esta ventana obliga a elegir antes de abrir el formulario,
 * que es lo que hace trazable el vínculo OT ⇄ permiso.
 */
const PermitOriginChooser: React.FC<{
  onFromWorkOrder: () => void;
  onStandalone: () => void;
  onClose: () => void;
}> = ({ onFromWorkOrder, onStandalone, onClose }) => {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("pm.newPermit")}</p>
              <h2 className="text-sm font-bold text-fg">{t("pm.origin.title")}</h2>
            </div>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="p-6 space-y-3">
          <p className="text-xs text-text-industrial/60">{t("pm.origin.subtitle")}</p>
          <button
            onClick={onFromWorkOrder}
            className="w-full text-left px-4 py-3.5 rounded-xl border border-accent/40 bg-accent/5 hover:bg-accent/10 transition-colors flex items-start gap-3"
          >
            <FileText className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <span>
              <span className="block text-sm font-bold text-fg">{t("pm.origin.fromWo")}</span>
              <span className="block text-[11px] text-text-industrial/60 mt-0.5">{t("pm.origin.fromWoHint")}</span>
            </span>
          </button>
          <button
            onClick={onStandalone}
            className="w-full text-left px-4 py-3.5 rounded-xl border border-fg/10 bg-fg/5 hover:bg-fg/10 transition-colors flex items-start gap-3"
          >
            <ShieldAlert className="w-4 h-4 text-text-industrial/50 shrink-0 mt-0.5" />
            <span>
              <span className="block text-sm font-bold text-fg">{t("pm.origin.standalone")}</span>
              <span className="block text-[11px] text-text-industrial/60 mt-0.5">{t("pm.origin.standaloneHint")}</span>
            </span>
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
  onPick: (wo: PickableWorkOrder) => void;
  onClose: () => void;
}> = ({ initialVesselCode, lockVessel = false, onPick, onClose }) => {
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
      `${w.workOrderCode} ${w.title ?? ""} ${w.assetName ?? ""} ${w.location ?? ""}`.toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[92vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <div className="flex items-center gap-3">
            <FileText className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("pm.newPermit")}</p>
              <h2 className="text-sm font-bold text-fg">{t("pm.woPicker.title")}</h2>
            </div>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="px-6 py-3 border-b border-fg/10 shrink-0 space-y-2">
          <div className="flex gap-2">
            <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={lockVessel}
              className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg disabled:opacity-60">
              {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
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
              {items.map(w => (
                <button key={w.id} onClick={() => onPick(w)}
                  className="w-full text-left px-6 py-3 hover:bg-fg/5 active:bg-fg/10 transition-colors flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-[10px] font-mono font-bold text-fg">{w.workOrderCode}</span>
                      <span className="text-[9px] px-2 py-0.5 rounded-full border border-fg/10 bg-fg/5 text-text-industrial/60 font-bold">
                        {WO_STATUS_TKEY[w.status] ? t(WO_STATUS_TKEY[w.status]) : w.status}
                      </span>
                      <VesselLabel code={w.vesselCode} className="text-[10px]" showCode />
                    </div>
                    <p className="text-xs text-fg truncate">{w.assetName ?? "—"}</p>
                    <p className="text-[11px] text-text-industrial/50 truncate">{w.title?.trim() || "—"}</p>
                  </div>
                  {w.dueDate && (
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-text-industrial/40">{t("wo.col.dueDate")}</p>
                      <p className="text-[11px] font-mono text-fg">{new Date(w.dueDate).toLocaleDateString("es-AR")}</p>
                    </div>
                  )}
                </button>
              ))}
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
}

export const PermitModal: React.FC<PermitModalProps> = ({ permit, prefill, onClose, onSaved, onMocTrigger }) => {
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

  const [tab, setTab] = useState<"details" | "participants" | "gas" | "attachments">("details");

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
      setErr("Completá al menos ubicación o descripción antes de pedir sugerencia.");
      return;
    }
    setLoadingHazards(true);
    const prev = hazards;
    setHazards("Analizando...");
    try {
      const res = await api.post<{ text: string }>("/app/permits/suggest-hazards", aiBaseInput());
      setHazards(res.text || prev);
    } catch (e) {
      setHazards(prev);
      setErr(e instanceof ApiError ? e.message : "Error al sugerir peligros.");
    } finally {
      setLoadingHazards(false);
    }
  }, [isEditable, loadingHazards, description, location, hazards, aiBaseInput]);

  const onSuggestControls = useCallback(async () => {
    if (!isEditable || loadingControls) return;
    if (!description.trim() && !location.trim()) {
      setErr("Completá al menos ubicación o descripción antes de pedir sugerencia.");
      return;
    }
    setLoadingControls(true);
    const prev = controls;
    setControls("Analizando...");
    try {
      const res = await api.post<{ text: string }>("/app/permits/suggest-controls", {
        ...aiBaseInput(),
        hazardsIdentified: hazards.trim() || null,
      });
      setControls(res.text || prev);
    } catch (e) {
      setControls(prev);
      setErr(e instanceof ApiError ? e.message : "Error al sugerir controles.");
    } finally {
      setLoadingControls(false);
    }
  }, [isEditable, loadingControls, description, location, hazards, controls, aiBaseInput]);

  const onSuggestPpe = useCallback(async () => {
    if (!isEditable || loadingPpe) return;
    if (!description.trim() && !location.trim()) {
      setErr("Completá al menos ubicación o descripción antes de pedir sugerencia.");
      return;
    }
    setLoadingPpe(true);
    const prev = ppe;
    setPpe("Analizando...");
    try {
      const res = await api.post<{ text: string }>("/app/permits/suggest-ppe", {
        ...aiBaseInput(),
        hazardsIdentified: hazards.trim() || null,
        controlMeasures: controls.trim() || null,
      });
      setPpe(res.text || prev);
    } catch (e) {
      setPpe(prev);
      setErr(e instanceof ApiError ? e.message : "Error al sugerir EPP.");
    } finally {
      setLoadingPpe(false);
    }
  }, [isEditable, loadingPpe, description, location, hazards, controls, ppe, aiBaseInput]);

  const onSave = useCallback(async () => {
    if (!vesselCode || !location.trim() || !description.trim() || !plannedStart || !plannedEnd) {
      setErr("Completá vessel, ubicación, descripción y fechas planeadas."); return;
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
      if (isNew) await api.post("/app/permits", payload);
      else await api.patch(`/app/permits/${permit!.id}`, payload);

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
      setErr(e instanceof ApiError ? e.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }, [isNew, permit, prefill, vesselCode, type, location, description, plannedStart, plannedEnd, hazards, controls, ppe, alarmOverride, canLinkWorkOrder, workOrder, vessels, onSaved, onMocTrigger]);

  const callAction = useCallback(async (action: string, body?: unknown) => {
    if (!permit) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/permits/${permit.id}/${action}`, body ?? {});
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : `Error al ${action}.`);
    } finally {
      setSaving(false);
    }
  }, [permit, onSaved]);

  const onRequest = () => callAction("request");
  const onApprove = () => callAction("approve", {});
  const onReject = () => {
    const reason = prompt("Motivo de rechazo:");
    if (!reason || !reason.trim()) return;
    void callAction("reject", { reason: reason.trim() });
  };
  const onActivate = () => callAction("activate");
  const onClose_ = () => {
    const notes = prompt("Notas de cierre (opcional):");
    void callAction("close", { closeNotes: notes?.trim() || null });
  };
  const onCancel = () => {
    const reason = prompt("Motivo de cancelación:");
    if (!reason || !reason.trim()) return;
    void callAction("cancel", { reason: reason.trim() });
  };
  const onReopen = () => {
    const reason = prompt("Motivo de re-apertura (mín. 5 caracteres):");
    if (!reason || reason.trim().length < 5) return;
    void callAction("reopen", { reason: reason.trim() });
  };
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
  const requestClose = useEscapeGuard({ isDirty: isEditable && isDirty, onSave: isEditable ? onSave : undefined, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[92vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("pm.title")}</p>
              <h2 className="text-sm font-bold text-fg">{isNew ? t("pm.newPermit") : `${permit!.permitCode} — ${t(TYPE_TKEY[permit!.type])}`}</h2>
            </div>
            {permit && <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold ${STATUS_COLOR[permit.status]}`}>{t(STATUS_TKEY[permit.status])}</span>}
          </div>
          <ModalCloseButton onClose={requestClose} />
        </div>

        {!isNew && (
          <div className="flex border-b border-fg/10 px-6 shrink-0">
            <button onClick={() => setTab("details")} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${tab === "details" ? "border-accent text-accent" : "border-transparent text-text-industrial/40 hover:text-fg"}`}>{t("pm.tabDetails")}</button>
            <button onClick={() => setTab("participants")} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${tab === "participants" ? "border-accent text-accent" : "border-transparent text-text-industrial/40 hover:text-fg"}`}>{t("pm.tabParticipants")} ({permit!.participants.length})</button>
            {permit!.type === "ENCLOSED_SPACE_ENTRY" && (
              <button onClick={() => setTab("gas")} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${tab === "gas" ? "border-accent text-accent" : "border-transparent text-text-industrial/40 hover:text-fg"}`}>{t("pm.tabGasTests")} ({permit!.gasTests.length})</button>
            )}
            <button onClick={() => setTab("attachments")} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${tab === "attachments" ? "border-accent text-accent" : "border-transparent text-text-industrial/40 hover:text-fg"}`}>{t("pm.tabAttachments")} ({attachments.length})</button>
          </div>
        )}

        <div className="overflow-y-auto flex-1 p-6">
          {(isNew || tab === "details") && (
            <div className="space-y-4">
              {isTerminal && (
                <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-orange-700 dark:text-orange-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-orange-800 dark:text-orange-200">{t("pm.lockedHint").replace("{status}", t(STATUS_TKEY[permit!.status]))}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {/* OT asociada: de qué trabajo planificado cuelga este permiso. */}
                <div className="col-span-2">
                  <label className={labelCls}>{t("pm.linkedWo")}</label>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10">
                    {workOrder ? (
                      <>
                        <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
                        <span className="text-xs font-mono font-bold text-fg shrink-0">{workOrder.code ?? "—"}</span>
                        <span className="text-xs text-text-industrial/60 truncate flex-1">{workOrder.title?.trim() || ""}</span>
                      </>
                    ) : (
                      <span className="text-xs text-text-industrial/50 flex-1">{t("pm.noLinkedWo")}</span>
                    )}
                    {canEditWorkOrder && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button type="button" onClick={() => setPickingWorkOrder(true)}
                          className="text-[10px] font-bold uppercase tracking-wider text-accent hover:brightness-110">
                          {workOrder ? t("pm.changeWo") : t("pm.linkWo")}
                        </button>
                        {workOrder && (
                          <button type="button" onClick={() => setWorkOrder(null)}
                            className="text-[10px] font-bold uppercase tracking-wider text-text-industrial/50 hover:text-fg">
                            {t("pm.unlinkWo")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {!canLinkWorkOrder && workOrder && (
                    <p className="text-[10px] text-text-industrial/40 mt-1">{t("pm.woLockedHint")}</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>{t("pm.vessel")}</label>
                  <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={!isNew || !isEditable || !!workOrder} className={inputCls}>
                    {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t("pm.type")}</label>
                  <select value={type} onChange={e => setType(e.target.value as PermitType)} disabled={!isNew || !isEditable} className={inputCls}>
                    {(Object.keys(TYPE_TKEY) as PermitType[]).map(tp => <option key={tp} value={tp}>{t(TYPE_TKEY[tp])}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>{t("common.location")}</label>
                  <input value={location} onChange={e => setLocation(e.target.value)} disabled={!isEditable} className={inputCls} placeholder={t("pm.locationPh")} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>{t("pm.workDesc")}</label>
                  <AutoTextArea rows={2} value={description} onChange={e => setDescription(e.target.value)} disabled={!isEditable} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("pm.plannedStart")}</label>
                  <input type="datetime-local" value={plannedStart} onChange={e => setPlannedStart(e.target.value)} disabled={!isEditable} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("pm.plannedEnd")}</label>
                  <input type="datetime-local" value={plannedEnd} onChange={e => setPlannedEnd(e.target.value)} disabled={!isEditable} className={inputCls} />
                </div>
                {permit && (permit.validFrom || permit.validTo) && (
                  <div className="col-span-2 grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{t("pm.validFrom")}</label>
                      <input value={fmtDateTime(permit.validFrom)} disabled className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{t("pm.validUntil")}</label>
                      <input value={fmtDateTime(permit.validTo)} disabled className={inputCls} />
                    </div>
                  </div>
                )}
                <div className="col-span-2 space-y-1.5">
                  <label
                    onClick={isEditable ? onSuggestHazards : undefined}
                    title={isEditable ? "Sugerir peligros con IA" : undefined}
                    className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${isEditable ? `hover:text-fg cursor-pointer ${loadingHazards ? "opacity-60 animate-pulse" : ""}` : ""}`}
                  >
                    {loadingHazards ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Peligros identificados
                    {loadingHazards && <span className="ml-1 text-[9px] normal-case font-normal">analizando…</span>}
                  </label>
                  <AutoTextArea rows={3} value={hazards} onChange={e => setHazards(e.target.value)} disabled={!isEditable || loadingHazards} className={inputCls} placeholder={t("pm.hazardsPh")} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label
                    onClick={isEditable ? onSuggestControls : undefined}
                    title={isEditable ? "Sugerir medidas de control con IA" : undefined}
                    className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${isEditable ? `hover:text-fg cursor-pointer ${loadingControls ? "opacity-60 animate-pulse" : ""}` : ""}`}
                  >
                    {loadingControls ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Medidas de control
                    {loadingControls && <span className="ml-1 text-[9px] normal-case font-normal">analizando…</span>}
                  </label>
                  <AutoTextArea rows={3} value={controls} onChange={e => setControls(e.target.value)} disabled={!isEditable || loadingControls} className={inputCls} placeholder={t("pm.controlsPh")} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label
                    onClick={isEditable ? onSuggestPpe : undefined}
                    title={isEditable ? "Sugerir EPP con IA" : undefined}
                    className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${isEditable ? `hover:text-fg cursor-pointer ${loadingPpe ? "opacity-60 animate-pulse" : ""}` : ""}`}
                  >
                    {loadingPpe ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    EPP requerido
                    {loadingPpe && <span className="ml-1 text-[9px] normal-case font-normal">analizando…</span>}
                  </label>
                  <AutoTextArea rows={2} value={ppe} onChange={e => setPpe(e.target.value)} disabled={!isEditable || loadingPpe} className={inputCls} placeholder={t("pm.ppePh")} />
                </div>

                {/* Override / bypass de alarma crítica — al guardar el sistema sugiere abrir MOC TEMPORARY. */}
                <label className="col-span-2 flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-orange-500/5 border border-orange-500/20 cursor-pointer hover:bg-orange-500/10 transition-colors">
                  <input
                    type="checkbox"
                    checked={alarmOverride}
                    onChange={e => setAlarmOverride(e.target.checked)}
                    disabled={!isEditable}
                    className="mt-0.5 accent-orange-400"
                  />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-orange-800 dark:text-orange-200">{t("pm.overrideBypass")}</p>
                    <p className="text-[10px] text-orange-800/80 dark:text-orange-200/70 mt-0.5">
                      Marcalo si este permiso requiere anular o by-passear una alarma de safety
                      (fire detection, gas, ESD, etc.). El sistema sugerirá registrar un MOC temporal.
                    </p>
                  </div>
                </label>

                <div className="col-span-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <Sparkles className="w-3 h-3 text-blue-700 dark:text-blue-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-blue-900/80 dark:text-blue-200/80 leading-snug">
                    Las sugerencias de Peligros / Controles / EPP son orientativas (asistente IA). Cada aseveración cuantitativa debería estar respaldada por la regulación aplicable. Para entrada a espacio confinado, los umbrales son ISGOTT 6 Cap. 11 (O₂ 19.5–23%, LEL &lt;1%, H₂S &lt;10 ppm, CO &lt;50 ppm); el sistema los valida server-side al hacer el gas test.
                  </p>
                </div>
                {permit?.rejectionReason && (
                  <div className="col-span-2 bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-red-700 dark:text-red-400 font-bold mb-1">{t("pm.rejectReason")}</p>
                    <p className="text-xs text-red-800 dark:text-red-200">{permit.rejectionReason}</p>
                  </div>
                )}
                {permit?.cancelReason && (
                  <div className="col-span-2 bg-fg/5 border border-fg/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/50 font-bold mb-1">{t("pm.cancelReason")}</p>
                    <p className="text-xs text-text-industrial/70">{permit.cancelReason}</p>
                  </div>
                )}
                {permit?.closeNotes && (
                  <div className="col-span-2 bg-success-sea/5 border border-success-sea/20 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-success-sea font-bold mb-1">{t("pm.closeNotes")}</p>
                    <p className="text-xs text-text-industrial/80">{permit.closeNotes}</p>
                  </div>
                )}
              </div>
              {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
            </div>
          )}

          {!isNew && tab === "participants" && permit && (
            <ParticipantsTab permit={permit} canEdit={!isTerminal} onChanged={onSaved} />
          )}

          {!isNew && tab === "gas" && permit && permit.type === "ENCLOSED_SPACE_ENTRY" && (
            <GasTestsTab permit={permit} canEdit={!isTerminal} onChanged={onSaved} />
          )}

          {!isNew && tab === "attachments" && permit && (
            <AttachmentsTab
              permitId={permit.id}
              items={attachments}
              canEdit={canManagePermits}
              onChanged={reloadAttachments}
            />
          )}
        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t border-fg/10 shrink-0 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            {!isNew && (
              <>
                <button onClick={() => { void onDownload("pdf"); }} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 disabled:opacity-50">
                  <FileText className="w-3.5 h-3.5" /> PDF
                </button>
                {/* El mismo formulario, editable: se completa en Word y se imprime. */}
                <button onClick={() => { void onDownload("doc"); }} disabled={saving} title={t("pm.wordHint")} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 disabled:opacity-50">
                  <FileDown className="w-3.5 h-3.5" /> Word
                </button>
              </>
            )}
            {!isNew && permit?.status === "DRAFT" && (
              <button onClick={() => { void onRequest(); }} disabled={saving} className="px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-700 dark:text-yellow-300 font-bold text-xs hover:bg-yellow-500/20 disabled:opacity-50">{t("common.requestApproval")}</button>
            )}
            {!isNew && permit?.status === "REQUESTED" && canApprove && (
              <>
                <button onClick={() => { void onApprove(); }} disabled={saving} className="px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 font-bold text-xs hover:bg-blue-500/20 disabled:opacity-50">{t("common.approve")}</button>
                <button onClick={() => { void onReject(); }} disabled={saving} className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 font-bold text-xs hover:bg-red-500/20 disabled:opacity-50">{t("common.reject")}</button>
              </>
            )}
            {!isNew && permit?.status === "APPROVED" && (
              <button onClick={() => { void onActivate(); }} disabled={saving} className="px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-300 font-bold text-xs hover:bg-green-500/20 disabled:opacity-50">{t("common.activate")}</button>
            )}
            {!isNew && permit?.status === "ACTIVE" && (
              <button onClick={() => { void onClose_(); }} disabled={saving} className="px-3 py-2 rounded-xl bg-success-sea/10 border border-success-sea/30 text-success-sea font-bold text-xs hover:bg-success-sea/20 disabled:opacity-50">{t("common.close")}</button>
            )}
            {!isNew && permit && !isTerminal && (
              <button onClick={() => { void onCancel(); }} disabled={saving} className="px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-text-industrial/60 font-bold text-xs hover:bg-fg/10 disabled:opacity-50">{t("common.cancel")}</button>
            )}
            {!isNew && isTerminal && isAdmin && (
              <button onClick={() => { void onReopen(); }} disabled={saving} className="px-3 py-2 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-700 dark:text-orange-300 font-bold text-xs hover:bg-orange-500/20 disabled:opacity-50">{t("common.reopen")}</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.close")}</button>
            {(isNew || tab === "details") && isEditable && (
              <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
              </button>
            )}
          </div>
        </div>
      </div>

      {pickingWorkOrder && (
        <WorkOrderPicker
          initialVesselCode={vesselCode || null}
          lockVessel={!isNew}
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Tripulante a bordo</label>
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
            <div>
              <label className={labelCls}>Medido por</label>
              <input value={testedByName} onChange={e => setTestedByName(e.target.value)} className={inputCls} />
            </div>
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
  | { step: "form"; prefill?: PermitModalPrefill };

/**
 * Alta de un permiso en tres pasos: origen (OT abierta / ocasional) → elegir la
 * OT → formulario. Se monta desde esta pantalla y desde el acceso grande del
 * Dashboard, para que el flujo sea el mismo desde los dos lados.
 */
export const NewPermitFlow: React.FC<{ onClose: () => void; onSaved?: () => void }> = ({ onClose, onSaved }) => {
  const [flow, setFlow] = useState<CreateFlow>({ step: "origin" });
  const mocTrigger = useMocTrigger();

  return (
    <>
      {flow.step === "origin" && (
        <PermitOriginChooser
          onFromWorkOrder={() => setFlow({ step: "workOrder" })}
          onStandalone={() => setFlow({ step: "form" })}
          onClose={onClose}
        />
      )}

      {flow.step === "workOrder" && (
        <WorkOrderPicker
          onClose={() => setFlow({ step: "origin" })}
          onPick={wo => setFlow({
            step: "form",
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

      {flow.step === "form" && (
        <PermitModal
          permit={null}
          prefill={flow.prefill}
          onClose={onClose}
          onSaved={() => { onSaved?.(); onClose(); }}
          onMocTrigger={mocTrigger.ask}
        />
      )}

      <MocTriggerHost controller={mocTrigger} />
    </>
  );
};

export const PermitsPage: React.FC = () => {
  const t = useT();
  // Estado inicial del filtro tomado de la URL (?status=DRAFT) — permite el
  // deep-link desde la alerta "sin procesar" del Dashboard.
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<"" | PermitStatus>(
    () => (searchParams.get("status") as PermitStatus | null) ?? "",
  );
  const [typeFilter, setTypeFilter]     = useState<"" | PermitType>("");

  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set("status", statusFilter);
    if (typeFilter) p.set("type", typeFilter);
    return `/app/permits${p.toString() ? `?${p.toString()}` : ""}`;
  }, [statusFilter, typeFilter]);

  const { data, loading, reload } = useFetch<{ items: Permit[]; total: number }>(path, [path]);
  // Filtro que llega desde una métrica del panel TMSA (lib/tmsa-filter.tsx).
  const tmsaFilter = useTmsaFilter();
  const tmsaItems = useMemo(() => applyTmsaFilter(data?.items ?? null, tmsaFilter, p => p.id), [data, tmsaFilter]);
  const [creating, setCreating]     = useState(false);
  const [editing, setEditing]       = useState<Permit | null>(null);
  const mocTrigger = useMocTrigger();

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={ShieldAlert} title="Permisos de Trabajo" total={data?.total} onReload={reload}>
        <ExportExcelButton module="permits" />
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110">
          <Plus className="w-3.5 h-3.5" /> Nuevo permiso
        </button>
      </PageHeader>

      <div className="flex gap-2 flex-wrap">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as "" | PermitStatus)}
          className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg">
          <option value="">— Estado: todos —</option>
          {(Object.keys(STATUS_TKEY) as PermitStatus[]).map(s => <option key={s} value={s}>{t(STATUS_TKEY[s])}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as "" | PermitType)}
          className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg">
          <option value="">— Tipo: todos —</option>
          {(Object.keys(TYPE_TKEY) as PermitType[]).map(tp => <option key={tp} value={tp}>{t(TYPE_TKEY[tp])}</option>)}
        </select>
      </div>

      <TmsaFilterBanner filter={tmsaFilter} shown={tmsaItems?.length ?? 0} total={data?.items?.length ?? 0} />

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : !tmsaItems?.length ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">Sin permisos</div>
      ) : (
        <div className="bg-fg/5 border border-fg/10 rounded-xl divide-y divide-fg/5">
          {tmsaItems.map(p => {
            const Icon = TYPE_ICON[p.type];
            return (
              <button key={p.id} onClick={() => setEditing(p)}
                className="w-full text-left p-4 hover:bg-fg/5 active:bg-fg/10 transition-colors flex items-center gap-3">
                <Icon className="w-4 h-4 text-text-industrial/50 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-[10px] font-mono text-text-industrial/40">{p.permitCode}</span>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold ${STATUS_COLOR[p.status]}`}>{t(STATUS_TKEY[p.status])}</span>
                    <VesselLabel code={p.vesselCode} className="text-[10px]" showCode />
                    <span className="text-[10px] text-text-industrial/50">{t(TYPE_TKEY[p.type])}</span>
                    {p.workOrderCode && (
                      <span title={p.workOrderTitle ?? undefined}
                        className="text-[9px] px-1.5 py-0.5 rounded border font-bold bg-accent/10 border-accent/20 text-accent">
                        {p.workOrderCode}
                      </span>
                    )}
                    {p.type === "ENCLOSED_SPACE_ENTRY" && p.gasTests.length > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded border font-bold bg-fg/5 border-fg/10 text-text-industrial/60">
                        {p.gasTests.length} gas test{p.gasTests.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-fg truncate">{p.description}</p>
                  <p className="text-xs text-text-industrial/50 truncate">{p.location}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-text-industrial/40">{p.status === "ACTIVE" ? "Vence" : "Planeado"}</p>
                  <p className="text-xs text-fg font-mono">{fmtDateTime(p.status === "ACTIVE" ? p.validTo : p.plannedStart)}</p>
                  <p className="text-[10px] text-text-industrial/40">{p.participants.length} participantes</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {creating && <NewPermitFlow onClose={() => setCreating(false)} onSaved={() => { void reload(); }} />}

      {editing && (
        <PermitModal
          permit={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
          onMocTrigger={mocTrigger.ask}
        />
      )}

      <MocTriggerHost controller={mocTrigger} />
    </div>
  );
};
