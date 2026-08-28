import React, { useState, useCallback } from "react";
import { ChevronLeft, ChevronDown, Loader2, Camera, X, Plus, Type, Mic, Video as VideoIcon, Trash2, Pencil, Check, FileText, Upload } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { useWoTerms } from "../lib/i18n";
import { api, ApiError } from "../lib/api";
import { useEscapeGuard } from "../lib/escape-guard";
import { ProgressNoteSheet } from "./ProgressNoteSheet";
import { AuthedImage, AuthedVideo, AuthedAudio, AuthedDocLink } from "../lib/authed-media";

interface WO {
  id: string;
  workOrderCode: string;
  title: string | null;
  description: string | null;
  status: string;
  type: string;
  priority: string;
  criticality: string;
  openDate: string;
  dueDate: string | null;
  // Tramitación (cadena de aprobación): EN PREPARACIÓN = sin enviar a aprobar;
  // PENDIENTE DE APROBACIÓN = enviada, sin aprobar; PENDIENTE DE AUTORIZACIÓN =
  // aprobada, sin autorizar.
  enviadoAprobacionAt: string | null;
  aprobadoByName: string | null;
  aprobadoAt: string | null;
  autorizadoByName: string | null;
  autorizadoAt: string | null;
  checklistDocUrl: string | null;
  assetName: string | null;
  assignedToUserName: string | null;
  assignedToUserId: string | null;
  department: string | null;
  providerName: string | null;
  location: string | null;
  vesselCode: string;
  estimatedHours: number | null;
  actualHours: number | null;
  runningHoursAtExecution: number | null;
  maintenancePlanId: string | null;
  executedByName: string | null;
  completedDate: string | null;
  observations: string | null;
  // Plan fields
  acceptanceCriteria: string | null;
  loto: string | null;
  riskLevel: string | null;
  riskAnalysisResult: string | null;
  consequenceCategory: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale: string | null;
}

const RISK_LABEL: Record<string, string> = {
  LOW:      "Bajo",
  MEDIUM:   "Medio",
  HIGH:     "Alto",
  CRITICAL: "Crítico",
};

const CONSEQUENCE_LABEL: Record<string, string> = {
  SAFETY:          "Seguridad",
  ENVIRONMENTAL:   "Ambiental",
  OPERATIONAL:     "Operacional",
  NON_OPERATIONAL: "No operacional",
};

const TYPE_LABEL: Record<string, string> = {
  PREVENTIVE: "Mant. Preventivo",
  CORRECTIVE: "Mant. Correctivo / Reparación",
  INSPECTION: "Inspección",
};

const DEPT_LABEL: Record<string, string> = {
  CUBIERTA: "Cubierta",
  MAQUINAS: "Máquinas",
  BARCAZA: "Barcaza",
  PROVEEDOR: "Proveedor",
  OTROS: "Otros",
};

// Etiqueta del área; cuando es PROVEEDOR agrega el nombre del proveedor.
function areaLabel(wo: { department: string | null; providerName: string | null }): string | null {
  if (!wo.department) return null;
  const base = DEPT_LABEL[wo.department] ?? wo.department;
  return wo.department === "PROVEEDOR" && wo.providerName ? `${base} — ${wo.providerName}` : base;
}

// Nivel de riesgo (selector editable en la sección 2 de la tramitación).
const RISK_OPTS: Array<[string, string]> = [
  ["LOW", "Bajo"], ["MEDIUM", "Medio"], ["HIGH", "Alto"], ["CRITICAL", "Crítico"],
];
// RCM / consecuencia (select editable).
const CONSEQUENCE_OPTS: Array<[string, string]> = [
  ["SAFETY", "Seguridad"], ["ENVIRONMENTAL", "Ambiental"],
  ["OPERATIONAL", "Operacional"], ["NON_OPERATIONAL", "No operacional"],
];

// Campo de solo-lectura para la vista de aprobación de SS. Si no hay valor, no renderiza.
const ReadField: React.FC<{ label: string; value?: string | null; full?: boolean }> = ({ label, value, full }) =>
  value ? (
    <div className={`bg-fg/5 border border-fg/10 rounded-xl p-2.5 ${full ? "col-span-2" : ""}`}>
      <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{label}</p>
      <p className="text-xs text-fg mt-0.5 whitespace-pre-line break-words">{value}</p>
    </div>
  ) : null;

// Encabezado de sección numerada (1 = Información, 2 = Plan), espejo del modal desktop.
const SectionNum: React.FC<{ n: number; label: string }> = ({ n, label }) => (
  <div className="flex items-center gap-2">
    <span className="w-5 h-5 rounded-full bg-accent/15 text-accent text-[11px] font-bold flex items-center justify-center shrink-0">{n}</span>
    <span className="text-[11px] font-bold uppercase tracking-widest text-fg/70">{label}</span>
  </div>
);

const STATUS_LABEL: Record<string, string> = {
  PLANNED:     "Planificada",
  IN_PROGRESS: "En ejecución",
  ON_HOLD:     "Retenida",
  DONE:        "Completada",
  CLOSED:      "Cerrada",
  CANCELLED:   "Cancelada",
};

const STATUS_COLOR: Record<string, string> = {
  PLANNED:     "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  IN_PROGRESS: "bg-accent/10 text-accent border-accent/20",
  ON_HOLD:     "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
  DONE:        "bg-success-sea/10 text-success-sea border-success-sea/20",
  CLOSED:      "bg-fg/5 text-text-industrial/40 border-fg/10",
};

const CRIT_COLOR: Record<string, string> = {
  A: "text-red-700 dark:text-red-400",
  B: "text-orange-700 dark:text-orange-400",
  C: "text-yellow-700 dark:text-yellow-400",
  D: "text-text-industrial/50",
};

type View = "list" | "detail" | "close";

/** Filtro de la lista de OTs. "open"=activas; "overdue"=vencidas;
 *  "solicitadas"=SS pendientes de aprobar; "aprobadas"=SS pendientes de autorizar. */
export type WoFilter = "open" | "overdue" | "solicitadas" | "aprobadas";

// Lista de avances de la OT: cada entrada muestra timestamp + media + texto.
// canAdd: solo OTs abiertas pueden recibir nuevas notas.
interface ProgressNote {
  id: string;
  kind: "TEXT" | "PHOTO" | "VIDEO" | "AUDIO" | "DOCUMENT";
  text: string | null;
  fileUrl: string | null;
  mimeType: string | null;
  processedText: string | null;
  processed: boolean;
  createdAt: string;
}

const ProgressNotesPanel: React.FC<{
  workOrderId: string;
  onAdd: () => void;
  onDeleted: () => void;
  reloadKey: number;
  canDelete: boolean;
  canAdd: boolean;
}> = ({ workOrderId, onAdd, onDeleted, reloadKey, canAdd, canDelete }) => {
  const { data, loading, reload } = useFetch<{ items: ProgressNote[] }>(
    `/app/pms/work-orders/${workOrderId}/progress-notes`,
    [workOrderId, reloadKey],
  );
  const notes = data?.items ?? [];

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const handleDelete = useCallback(async (noteId: string) => {
    if (!window.confirm("¿Borrar este avance? Las observaciones se regenerarán sin él.")) return;
    try {
      await api.delete(`/app/pms/work-orders/${workOrderId}/progress-notes/${noteId}`);
      await reload();
      onDeleted();
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : "Error al borrar el avance");
    }
  }, [workOrderId, reload, onDeleted]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/40">
          Avances {notes.length > 0 && `(${notes.length})`}
        </p>
        {canAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-xs font-bold hover:brightness-110"
          >
            <Plus className="w-3.5 h-3.5" />
            Registrar avance
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-[11px] text-text-industrial/40 italic text-center py-2">Aún sin avances registrados.</p>
      ) : (
        <div className="space-y-2">
          {notes.map(n => (
            <NoteCard
              key={n.id}
              note={n}
              fmtTime={fmtTime}
              onDelete={canDelete ? () => handleDelete(n.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const KIND_ICON: Record<string, React.FC<{ className?: string }>> = {
  TEXT:  Type,
  PHOTO: Camera,
  VIDEO: VideoIcon,
  AUDIO: Mic,
};

const KIND_LABEL: Record<string, string> = {
  TEXT:  "Texto",
  PHOTO: "Foto",
  VIDEO: "Video",
  AUDIO: "Audio",
};

const NoteCard: React.FC<{
  note: ProgressNote;
  fmtTime: (iso: string) => string;
  onDelete?: () => void;
}> = ({ note, fmtTime, onDelete }) => {
  const Icon = KIND_ICON[note.kind] ?? Type;
  return (
    <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2 text-[10px] text-text-industrial/50">
        <Icon className="w-3 h-3" />
        <span className="font-bold uppercase tracking-wider">{KIND_LABEL[note.kind] ?? note.kind}</span>
        <span className="ml-auto">{fmtTime(note.createdAt)}</span>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="p-1 -mr-1 text-text-industrial/40 hover:text-red-400 transition-colors"
            aria-label="Borrar avance"
            title="Borrar avance"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {note.kind === "PHOTO" && note.fileUrl && (
        <AuthedImage src={note.fileUrl} alt="Foto" className="w-full rounded-lg object-cover max-h-72" />
      )}
      {note.kind === "VIDEO" && note.fileUrl && (
        <AuthedVideo src={note.fileUrl} controls className="w-full rounded-lg max-h-72" />
      )}
      {note.kind === "AUDIO" && note.fileUrl && (
        <AuthedAudio src={note.fileUrl} controls className="w-full" />
      )}
      {note.kind === "DOCUMENT" && note.fileUrl && (
        <AuthedDocLink src={note.fileUrl} />
      )}
      {note.text && (
        <p className="text-xs text-fg/85 whitespace-pre-line leading-relaxed">{note.text}</p>
      )}
    </div>
  );
};

// Panel de horas: muestra estimado vs real con código de color de desvío.
// Verde si abs(desvío) <= 20% del estimado, ámbar si entre 20-50%, rojo > 50%.
// Las horas reales son editables inline: tap en el lápiz → input → PATCH.
const HoursPanel: React.FC<{
  workOrderId: string;
  estimated: number | null;
  actual: number | null;
  isClosed: boolean;
  isEditable: boolean;
  onUpdated: (newActual: number | null) => void;
}> = ({ workOrderId, estimated, actual, isClosed, isEditable, onUpdated }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState("");
  const [saving, setSaving]   = useState(false);

  const startEdit = () => {
    setDraft(actual != null ? String(actual) : "");
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft("");
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const newVal = draft ? Number(draft) : null;
      await api.patch(`/app/pms/work-orders/${workOrderId}`, { actualHours: newVal });
      onUpdated(newVal);
      setEditing(false);
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : "Error al actualizar horas");
    } finally {
      setSaving(false);
    }
  };

  const hasBoth = estimated != null && actual != null;
  let deviation: { pct: number; color: string; label: string } | null = null;
  if (hasBoth && estimated > 0) {
    const diff = (actual as number) - (estimated as number);
    const pct = (diff / (estimated as number)) * 100;
    const abs = Math.abs(pct);
    const color =
      abs <= 20 ? "text-success-sea"
      : abs <= 50 ? "text-yellow-700 dark:text-yellow-400"
      : "text-red-700 dark:text-red-400";
    const sign = diff > 0 ? "+" : "";
    deviation = { pct, color, label: `${sign}${pct.toFixed(0)}%` };
  }

  // Sumador rápido para celular: el operario suma cuartos/medias/horas sin tipear.
  const bump = (delta: number) => {
    const current = Number(draft || "0");
    const next = Math.max(0, current + delta);
    // Evitar floats feos tipo 1.7500000001
    setDraft(String(Math.round(next * 100) / 100));
  };

  return (
    <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 space-y-3">
      <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Horas de la tarea</p>

      {editing ? (
        // ── Modo edición: ocupa todo el ancho con stepper grande ─────────────
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wider text-accent font-bold">Horas reales</p>
            {estimated != null && (
              <p className="text-[10px] text-text-industrial/40 tabular-nums">est. {estimated} h</p>
            )}
          </div>

          {/* Input grande, centrado, teclado numérico decimal */}
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.25"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="0"
            className="w-full bg-fg/5 border-2 border-accent/40 rounded-xl px-4 py-3 text-3xl font-bold text-fg text-center tabular-nums focus:outline-none focus:border-accent"
            disabled={saving}
          />

          {/* Sumador rápido — 5 chips de paso fijo */}
          <div className="grid grid-cols-5 gap-1.5">
            {[-1, -0.5, 0.5, 1, 2].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => bump(d)}
                disabled={saving}
                className={`py-2.5 rounded-lg text-sm font-bold tabular-nums active:scale-95 transition-all ${
                  d < 0
                    ? "bg-fg/5 border border-fg/10 text-text-industrial hover:bg-fg/10"
                    : "bg-accent/15 border border-accent/30 text-accent hover:bg-accent/20"
                }`}
              >
                {d > 0 ? "+" : ""}{d}h
              </button>
            ))}
          </div>

          {/* Guardar / Cancelar — full width, grandes para dedo */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="py-3 rounded-xl bg-fg/5 border border-fg/10 text-sm font-bold text-text-industrial disabled:opacity-50 active:scale-95 transition-all flex items-center justify-center gap-1.5"
            >
              <X className="w-4 h-4" /> Cancelar
            </button>
            <button
              type="button"
              onClick={saveEdit}
              disabled={saving}
              className="py-3 rounded-xl bg-accent text-accent-fg text-sm font-bold disabled:opacity-50 active:scale-95 transition-all flex items-center justify-center gap-1.5"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Guardar</>}
            </button>
          </div>
        </div>
      ) : (
        // ── Modo lectura: grid 2 cols, Reales tap-to-edit en mobile ──────────
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-text-industrial/40">Estimadas</p>
              <p className="text-xl font-bold text-fg tabular-nums mt-0.5">{estimated != null ? `${estimated} h` : "—"}</p>
            </div>
            <button
              type="button"
              onClick={isEditable ? startEdit : undefined}
              disabled={!isEditable}
              className={`text-left rounded-lg p-2 -m-2 transition-colors ${
                isEditable ? "hover:bg-fg/5 active:bg-fg/10 cursor-pointer" : "cursor-default"
              }`}
              aria-label={isEditable ? "Editar horas reales" : undefined}
            >
              <div className="flex items-center justify-between gap-1">
                <p className="text-[10px] text-text-industrial/40">Reales</p>
                {isEditable && <Pencil className="w-3.5 h-3.5 text-accent/60" />}
              </div>
              <p className={`text-xl font-bold tabular-nums mt-0.5 ${actual != null ? "text-fg" : "text-text-industrial/40"}`}>
                {actual != null ? `${actual} h` : "Tocá para cargar"}
              </p>
            </button>
          </div>
          {deviation && (
            <div className="flex items-center justify-between pt-2 border-t border-fg/10">
              <span className="text-[10px] text-text-industrial/50 uppercase tracking-wider">Desvío</span>
              <span className={`text-sm font-bold tabular-nums ${deviation.color}`}>{deviation.label}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};

interface MobileWorkOrdersProps {
  /** Filtro inicial al montar — el dashboard navega aquí con foco (activas vs vencidas). */
  initialFilter?: WoFilter;
}

export const MobileWorkOrders: React.FC<MobileWorkOrdersProps> = ({ initialFilter }) => {
  const { data, loading, reload } = useFetch<{ items: WO[] }>("/app/pms/work-orders");
  const { user } = useAuth();
  const woTerms = useWoTerms();
  // Solo superintendente/admin aprueban SS → ven el filtro "Para aprobar".
  const canApproveSS = user?.role === "FLEET_SUPERINTENDENT" || user?.role === "TENANT_ADMIN";
  const [filter, setFilter]       = useState<WoFilter>(initialFilter ?? "open");
  // Si el dashboard navega con un foco distinto, sincronizamos el filtro local.
  React.useEffect(() => {
    if (initialFilter && initialFilter !== filter) setFilter(initialFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilter]);
  const [view, setView]           = useState<View>("list");
  const [selected, setSelected]   = useState<WO | null>(null);
  const [showProgressSheet, setShowProgressSheet] = useState(false);
  const [notesReloadKey, setNotesReloadKey] = useState(0);
  const [woResult, setWoResult]   = useState<"SATISFACTORY" | "WITH_DEFICIENCIES">("SATISFACTORY");
  const [observations, setObs]    = useState("");
  const [actualHours, setActualHours] = useState("");
  const [runningHours, setRunningHours] = useState("");
  const [executedByName, setExecutedByName] = useState("");
  const [executionDate, setExecutionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [photoFile, setPhotoFile]   = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState<string | null>(null);
  // Tramitación de SS (aprobar / autorizar / rechazar) desde el detalle móvil.
  const [approvalStep, setApprovalStep] = useState<"APRUEBA" | "AUTORIZA" | "RECHAZA" | null>(null);
  const [approverName, setApproverName] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [approving, setApproving]       = useState(false);
  const [approvalErr, setApprovalErr]   = useState<string | null>(null);
  // Sección 2 (Plan): campos editables, ocultos detrás de un botón.
  const [planOpen, setPlanOpen]         = useState(false);
  const [edCriteria, setEdCriteria]     = useState("");
  const [edLoto, setEdLoto]             = useState("");
  const [edRisk, setEdRisk]             = useState("");
  const [edRiskResult, setEdRiskResult] = useState("");
  const [edConseq, setEdConseq]         = useState("");
  const [edConseqRat, setEdConseqRat]   = useState("");
  const [uploadingChecklist, setUploadingChecklist] = useState(false);

  // Al abrir el detalle, trae el DETALLE completo (la lista no incluye description
  // ni los textos del plan) y precarga los campos editables del Plan.
  React.useEffect(() => {
    if (!selected) return;
    setPlanOpen(false);
    // Hidrata con lo del item de lista mientras llega el detalle.
    setEdCriteria(selected.acceptanceCriteria ?? "");
    setEdLoto(selected.loto ?? "");
    setEdRisk(selected.riskLevel ?? "");
    setEdRiskResult(selected.riskAnalysisResult ?? "");
    setEdConseq(selected.consequenceCategory ?? "");
    setEdConseqRat(selected.consequenceRationale ?? "");
    let cancelled = false;
    (async () => {
      try {
        const full = await api.get<WO>(`/app/pms/work-orders/${selected.id}`);
        if (cancelled) return;
        setEdCriteria(full.acceptanceCriteria ?? "");
        setEdLoto(full.loto ?? "");
        setEdRisk(full.riskLevel ?? "");
        setEdRiskResult(full.riskAnalysisResult ?? "");
        setEdConseq(full.consequenceCategory ?? "");
        setEdConseqRat(full.consequenceRationale ?? "");
        // El detalle no resuelve assignedToUserName → conservar el de la lista.
        setSelected(s => (s && s.id === full.id ? { ...full, assignedToUserName: s.assignedToUserName ?? full.assignedToUserName ?? null } : s));
      } catch { /* usa los valores del item de lista */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const onPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setPhotoFile(f);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(f ? URL.createObjectURL(f) : null);
  };

  const clearPhoto = () => {
    setPhotoFile(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
  };

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isOverdue = (wo: WO) => !!wo.dueDate && new Date(wo.dueDate) < today;
  // Pendiente de aprobación = OT activa YA ENVIADA a aprobar, sin firmar. Las
  // que todavía están en preparación no cuentan: nadie tiene que firmarlas.
  const isSolicitada = (wo: WO) => (wo.status === "PLANNED" || wo.status === "IN_PROGRESS") && !!wo.enviadoAprobacionAt && !wo.aprobadoAt && !wo.autorizadoAt;
  // SS APROBADA = OT activa aprobada pero aún sin autorizar (pendiente de autorización).
  const isAprobada = (wo: WO) => (wo.status === "PLANNED" || wo.status === "IN_PROGRESS") && !!wo.aprobadoAt && !wo.autorizadoAt;

  const openWOs = (data?.items ?? []).filter(
    w => w.status === "PLANNED" || w.status === "IN_PROGRESS" || w.status === "ON_HOLD",
  );
  const overdueWOs = openWOs.filter(isOverdue);
  const solicitadasWOs = (data?.items ?? []).filter(isSolicitada);
  const aprobadasWOs   = (data?.items ?? []).filter(isAprobada);
  const visibleWOs =
    filter === "overdue"     ? overdueWOs :
    filter === "solicitadas" ? solicitadasWOs :
    filter === "aprobadas"   ? aprobadasWOs :
    openWOs;

  const selectWO  = (wo: WO) => { setSelected(wo); setView("detail"); setErr(null); };
  const back      = ()       => { setView("list"); setSelected(null); setErr(null); };
  const openClose = ()       => {
    setView("close");
    setWoResult("SATISFACTORY");
    setObs("");
    setActualHours("");
    setRunningHours("");
    setExecutedByName("");
    setExecutionDate(new Date().toISOString().slice(0, 10));
    clearPhoto();
    setErr(null);
  };

  const handleStart = useCallback(async () => {
    if (!selected) return;
    setSaving(true); setErr(null);
    try {
      await api.patch(`/app/pms/work-orders/${selected.id}`, { status: "IN_PROGRESS" });
      await reload();
      setSelected({ ...selected, status: "IN_PROGRESS" });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : `Error al iniciar ${woTerms.abbr}`);
    } finally {
      setSaving(false);
    }
  }, [selected, reload]);

  const handleClose = useCallback(async () => {
    if (!selected) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/pms/work-orders/${selected.id}/close`, {
        woResult,
        observations: observations.trim() || null,
        completedDate: executionDate || new Date().toISOString().slice(0, 10),
        executedByName: executedByName.trim() || null,
        actualHours: actualHours ? Number(actualHours) : null,
        runningHoursAtExecution: runningHours ? Number(runningHours) : null,
      });
      // Subir foto si fue capturada (no bloquea el cierre si la subida falla)
      if (photoFile) {
        try {
          await api.upload(`/app/attachments/upload?entityType=WorkOrder&entityId=${selected.id}`, photoFile);
        } catch { /* non-blocking */ }
      }
      clearPhoto();
      await reload();
      back();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : `Error al cerrar ${woTerms.abbr}`);
    } finally {
      setSaving(false);
    }
  }, [selected, woResult, observations, executionDate, executedByName, actualHours, runningHours, photoFile, reload]);

  const onChecklistSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !selected) return;
    setUploadingChecklist(true); setErr(null);
    try {
      const { url } = await api.upload<{ url: string }>(`/app/attachments/upload?entityType=WorkOrder&entityId=${selected.id}`, f);
      await api.patch(`/app/pms/work-orders/${selected.id}`, { checklistDocUrl: url });
      setSelected(s => (s ? { ...s, checklistDocUrl: url } : s));
      await reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "No se pudo subir el archivo.");
    } finally {
      setUploadingChecklist(false);
    }
  };

  const openApproval = (step: "APRUEBA" | "AUTORIZA" | "RECHAZA") => {
    setApproverName(user?.name ?? "");
    setRejectReason("");
    setApprovalErr(null);
    setApprovalStep(step);
  };

  const submitApproval = useCallback(async () => {
    if (!selected || !approvalStep) return;
    const name = approverName.trim();
    if (!name) { setApprovalErr("Ingresá el nombre."); return; }
    const reason = rejectReason.trim();
    if (approvalStep === "RECHAZA" && !reason) { setApprovalErr("Ingresá el motivo del rechazo."); return; }
    setApproving(true); setApprovalErr(null);
    try {
      // Persistir ediciones del Plan (criterios/LOTO/riesgo/RCM) solo si cambiaron.
      const planPayload = {
        acceptanceCriteria:   edCriteria.trim() || null,
        loto:                 edLoto.trim() || null,
        riskLevel:            edRisk || null,
        riskAnalysisResult:   edRiskResult.trim() || null,
        consequenceCategory:  (edConseq || null) as WO["consequenceCategory"],
        consequenceRationale: edConseqRat.trim() || null,
      };
      const planDirty =
        (planPayload.acceptanceCriteria   ?? "") !== (selected.acceptanceCriteria   ?? "") ||
        (planPayload.loto                 ?? "") !== (selected.loto                 ?? "") ||
        (planPayload.riskLevel            ?? "") !== (selected.riskLevel            ?? "") ||
        (planPayload.riskAnalysisResult   ?? "") !== (selected.riskAnalysisResult   ?? "") ||
        (planPayload.consequenceCategory  ?? "") !== (selected.consequenceCategory  ?? "") ||
        (planPayload.consequenceRationale ?? "") !== (selected.consequenceRationale ?? "");
      if (planDirty) {
        await api.patch(`/app/pms/work-orders/${selected.id}`, planPayload);
      }
      await api.post(`/app/pms/work-orders/${selected.id}/approval`, {
        step: approvalStep, name, reason: approvalStep === "RECHAZA" ? reason : undefined,
      });
      setApprovalStep(null);
      await reload();
      back();
    } catch (e) {
      setApprovalErr(e instanceof ApiError ? e.message : "No se pudo registrar. Intentá de nuevo.");
      setApproving(false);
    }
  }, [selected, approvalStep, approverName, rejectReason, edCriteria, edLoto, edRisk, edRiskResult, edConseq, edConseqRat, reload]);

  // ─── ESC guard: cierre con confirmación según vista ─────────────────────────
  const closeFormDirty =
    view === "close" && (
      woResult !== "SATISFACTORY" ||
      observations.trim() !== "" ||
      actualHours.trim() !== "" ||
      runningHours.trim() !== "" ||
      executedByName.trim() !== ""
    );

  useEscapeGuard({
    enabled: view === "close",
    isDirty: closeFormDirty,
    onSave: handleClose,
    onClose: () => setView("detail"),
  });

  useEscapeGuard({
    enabled: view === "detail",
    isDirty: false,
    onClose: back,
  });

  // ── Close form ──────────────────────────────────────────────────────────────
  if (view === "close" && selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-fg/10">
          <button type="button" onClick={() => setView("detail")} className="p-2 -ml-2 text-text-industrial/40 hover:text-fg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-fg truncate">Cerrar {selected.workOrderCode}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Resultado *</p>
            <div className="grid grid-cols-2 gap-2">
              {(["SATISFACTORY", "WITH_DEFICIENCIES"] as const).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setWoResult(r)}
                  className={`py-3 rounded-xl border text-xs font-bold transition-all ${
                    woResult === r
                      ? r === "SATISFACTORY"
                        ? "bg-success-sea/15 text-success-sea border-success-sea/30"
                        : "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30"
                      : "bg-fg/5 text-text-industrial/50 border-fg/10"
                  }`}
                >
                  {r === "SATISFACTORY" ? "Satisfactorio" : "Con deficiencias"}
                </button>
              ))}
            </div>
          </div>

          {/* Ejecutado por + Fecha */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Ejecutado por</p>
              <input
                value={executedByName}
                onChange={e => setExecutedByName(e.target.value)}
                placeholder="Nombre"
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Fecha</p>
              <input
                type="date"
                value={executionDate}
                onChange={e => setExecutionDate(e.target.value)}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg focus:outline-none focus:border-accent/50"
              />
            </div>
          </div>

          {/* Horas reales + Horas motor */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">
                Horas reales
                {selected.estimatedHours != null && (
                  <span className="ml-1 text-[9px] normal-case font-normal text-text-industrial/40">
                    (est: {selected.estimatedHours}h)
                  </span>
                )}
              </p>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.25"
                value={actualHours}
                onChange={e => setActualHours(e.target.value)}
                placeholder={selected.estimatedHours != null ? String(selected.estimatedHours) : "ej. 2.5"}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            {selected.maintenancePlanId && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Horas motor</p>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  value={runningHours}
                  onChange={e => setRunningHours(e.target.value)}
                  placeholder="ej. 3500"
                  className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Observaciones</p>
            <textarea
              value={observations}
              onChange={e => setObs(e.target.value)}
              rows={4}
              placeholder="Notas de cierre..."
              className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
            />
          </div>

          {/* Foto opcional: usa la cámara trasera del celular */}
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Foto (opcional)</p>
            {photoPreview ? (
              <div className="relative">
                <img src={photoPreview} alt="Vista previa" className="w-full rounded-xl border border-fg/10 object-cover max-h-72" />
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-fg"
                  aria-label="Quitar foto"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-fg/15 bg-fg/5 text-text-industrial/60 cursor-pointer hover:bg-fg/10 active:bg-fg/15 transition-colors">
                <Camera className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Tomar foto</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={onPhotoSelect}
                />
              </label>
            )}
          </div>

          {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-accent text-accent-fg text-sm font-bold disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Confirmar cierre"}
          </button>
        </div>
      </div>
    );
  }

  // ── Detail: TRAMITACIÓN de SS ────────────────────────────────────────────────
  // Para aprobadores (super/admin) con una SS pendiente: muestra secciones 1
  // (Información) y 2 (Plan) en lectura + los botones del paso que corresponde:
  //  · SOLICITADA → [APROBAR] / [NO APROBAR]   (APRUEBA / RECHAZA)
  //  · APROBADA   → [AUTORIZAR] / [NO AUTORIZAR] (AUTORIZA / RECHAZA)
  if (view === "detail" && selected && canApproveSS && (isSolicitada(selected) || isAprobada(selected))) {
    const isAuth = isAprobada(selected);
    const positiveStep: "APRUEBA" | "AUTORIZA" = isAuth ? "AUTORIZA" : "APRUEBA";
    const positiveLabel = isAuth ? "AUTORIZAR" : "APROBAR";
    const negativeLabel = isAuth ? "NO AUTORIZAR" : "NO APROBAR";
    const phaseLabel    = isAuth ? "Aprobada" : "Solicitada";
    const phaseBadgeCls = isAuth
      ? "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20"
      : "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
    const sheetTitle   = approvalStep === "AUTORIZA" ? "Autorizar SS" : approvalStep === "APRUEBA" ? "Aprobar SS" : "Rechazar SS";
    const sheetVerb    = approvalStep === "AUTORIZA" ? "autoriza"     : approvalStep === "APRUEBA" ? "aprueba"    : "rechaza";
    const sheetConfirm = approvalStep === "AUTORIZA" ? "Autorizar"    : approvalStep === "APRUEBA" ? "Aprobar"    : "Rechazar";
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-fg/10">
          <button type="button" onClick={back} className="p-2 -ml-2 text-text-industrial/40 hover:text-fg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-fg truncate flex-1">{selected.workOrderCode}</span>
          <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold shrink-0 ${phaseBadgeCls}`}>
            {phaseLabel}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div>
            <p className="text-base font-bold text-fg">{selected.title ?? "(Sin título)"}</p>
            {selected.assetName && <p className="text-xs text-text-industrial/50 mt-0.5">{selected.assetName}</p>}
            {isAuth && selected.aprobadoByName && (
              <p className="text-[11px] text-violet-700 dark:text-violet-400 mt-1">
                Aprobó: {selected.aprobadoByName}{selected.aprobadoAt ? ` · ${selected.aprobadoAt.slice(0, 10)}` : ""}
              </p>
            )}
          </div>

          {/* ── 1. Información (lectura) ── */}
          <section className="space-y-2">
            <SectionNum n={1} label="Información" />
            <div className="grid grid-cols-2 gap-2">
              <ReadField label="Buque"       value={selected.vesselCode} />
              <ReadField label="Equipo"      value={selected.assetName} />
              <ReadField label="Tipo"        value={TYPE_LABEL[selected.type] ?? selected.type} />
              <ReadField label="Responsable" value={selected.assignedToUserName ?? selected.assignedToUserId} />
              <ReadField label="Área"        value={areaLabel(selected)} />
              <ReadField label="Tarea"       value={selected.description} full />
            </div>
          </section>

          {/* ── 2. Plan (editable, detrás de un botón) ── */}
          <section className="space-y-2">
            <SectionNum n={2} label="Plan" />
            <button
              type="button"
              onClick={() => setPlanOpen(v => !v)}
              className="w-full flex items-center justify-between gap-2 bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5"
            >
              <span className="text-xs font-bold text-fg">Análisis técnico</span>
              <span className="text-[10px] text-text-industrial/50 flex items-center gap-1">
                Criterios · LOTO · Riesgo · RCM
                <ChevronDown className={`w-4 h-4 transition-transform ${planOpen ? "rotate-180" : ""}`} />
              </span>
            </button>

            {planOpen && (
              <div className="space-y-3 pt-1">
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-text-industrial/40">Criterios de aceptación</label>
                  <textarea rows={2} value={edCriteria} onChange={e => setEdCriteria(e.target.value)}
                    className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-y" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-text-industrial/40">LOTO</label>
                  <textarea rows={2} value={edLoto} onChange={e => setEdLoto(e.target.value)}
                    className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-y" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-text-industrial/40">Nivel de riesgo</label>
                  <div className="flex gap-1.5">
                    {RISK_OPTS.map(([val, label]) => (
                      <button key={val} type="button" onClick={() => setEdRisk(edRisk === val ? "" : val)}
                        className={`flex-1 py-2 rounded-lg border text-[11px] font-bold transition-colors ${
                          edRisk === val ? "bg-accent text-accent-fg border-accent" : "bg-fg/5 text-text-industrial/60 border-fg/10"
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-text-industrial/40">Resultado análisis de riesgo</label>
                  <textarea rows={2} value={edRiskResult} onChange={e => setEdRiskResult(e.target.value)}
                    className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-y" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-text-industrial/40">RCM</label>
                  <select value={edConseq} onChange={e => setEdConseq(e.target.value)}
                    className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg focus:outline-none focus:border-accent/50">
                    <option value="">Sin clasificar</option>
                    {CONSEQUENCE_OPTS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                  </select>
                  <textarea rows={2} value={edConseqRat} onChange={e => setEdConseqRat(e.target.value)} placeholder="Justificación"
                    className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-y" />
                </div>
                <p className="text-[10px] text-text-industrial/40">Los cambios se guardan al aprobar / autorizar.</p>
              </div>
            )}
          </section>
        </div>

        {/* Botones de tramitación */}
        <div className="shrink-0 p-3 border-t border-fg/10 grid grid-cols-2 gap-2 bg-surface dark:bg-[#0D1B2A]">
          <button type="button" onClick={() => openApproval(positiveStep)}
            className="py-3 rounded-xl bg-success-sea text-white text-sm font-bold">
            {positiveLabel}
          </button>
          <button type="button" onClick={() => openApproval("RECHAZA")}
            className="py-3 rounded-xl bg-red-600 text-white text-sm font-bold">
            {negativeLabel}
          </button>
        </div>

        {/* Sheet: captura nombre (y motivo si rechaza) */}
        {approvalStep && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60" onClick={() => !approving && setApprovalStep(null)}>
            <div className="w-full bg-surface dark:bg-[#0D1B2A] border-t border-fg/10 rounded-t-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <div>
                <h2 className="text-base font-bold text-fg">{sheetTitle}</h2>
                <p className="text-xs text-text-industrial/60 mt-0.5">{selected.workOrderCode} · {selected.assetName ?? selected.title ?? ""}</p>
                {approvalStep === "RECHAZA" && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">La SS queda marcada como rechazada y vuelve a Solicitada.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-text-industrial/60">
                  Nombre de quien {sheetVerb}
                </label>
                <input
                  value={approverName}
                  onChange={e => setApproverName(e.target.value)}
                  placeholder="Nombre y apellido"
                  className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
                />
              </div>
              {approvalStep === "RECHAZA" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-text-industrial/60">Motivo del rechazo</label>
                  <textarea
                    rows={3}
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="Por qué no se aprueba/autoriza…"
                    className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
                  />
                </div>
              )}
              {approvalErr && <p className="text-[11px] text-red-600 dark:text-red-400">{approvalErr}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => setApprovalStep(null)} disabled={approving}
                  className="flex-1 py-2.5 rounded-xl border border-fg/10 text-sm text-text-industrial/70 disabled:opacity-50">
                  Cancelar
                </button>
                <button type="button" onClick={() => void submitApproval()} disabled={approving}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-1.5 ${approvalStep === "RECHAZA" ? "bg-red-600" : "bg-success-sea"}`}>
                  {approving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {sheetConfirm}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Detail ──────────────────────────────────────────────────────────────────
  if (view === "detail" && selected) {
    const canEdit = selected.status !== "CLOSED" && selected.status !== "CANCELLED";
    const canClose = selected.status === "PLANNED" || selected.status === "IN_PROGRESS" || selected.status === "ON_HOLD";
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-fg/10">
          <button type="button" onClick={back} className="p-2 -ml-2 text-text-industrial/40 hover:text-fg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-fg truncate flex-1">{selected.workOrderCode}</span>
          <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold shrink-0 ${STATUS_COLOR[selected.status] ?? "bg-fg/5 text-fg/40 border-fg/10"}`}>
            {STATUS_LABEL[selected.status] ?? selected.status}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Título */}
          <div>
            <p className="text-base font-bold text-fg">{selected.title ?? "(Sin título)"}</p>
            {selected.assetName && <p className="text-xs text-text-industrial/50 mt-0.5">{selected.assetName}</p>}
          </div>

          {/* #1 Tramitación (lectura) */}
          <section className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-industrial/50">Tramitación</p>
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 space-y-1">
              {selected.aprobadoByName && (
                <p className="text-xs text-fg"><span className="font-bold text-violet-700 dark:text-violet-400">Aprobó:</span> {selected.aprobadoByName}{selected.aprobadoAt ? ` · ${selected.aprobadoAt.slice(0, 10)}` : ""}</p>
              )}
              {selected.autorizadoByName && (
                <p className="text-xs text-fg"><span className="font-bold text-emerald-700 dark:text-emerald-400">Autorizó:</span> {selected.autorizadoByName}{selected.autorizadoAt ? ` · ${selected.autorizadoAt.slice(0, 10)}` : ""}</p>
              )}
              {!selected.aprobadoByName && !selected.autorizadoByName && (
                <p className="text-xs text-text-industrial/40">Sin registros de tramitación.</p>
              )}
            </div>
          </section>

          {/* #2 Información (lectura) */}
          <section className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-industrial/50">Información</p>
            <div className="grid grid-cols-2 gap-2">
              <ReadField label="Embarcación"     value={selected.vesselCode} />
              <ReadField label="Equipo"          value={selected.assetName} />
              <ReadField label="Criticidad"      value={selected.criticality} />
              <ReadField label="Vencimiento"     value={selected.dueDate?.slice(0, 10)} />
              <ReadField label="Responsable"     value={selected.assignedToUserName ?? selected.assignedToUserId} />
              <ReadField label="Área"            value={areaLabel(selected)} />
              <ReadField label={`Título de la ${woTerms.abbr}`} value={selected.title} full />
              <ReadField label="Tarea"           value={selected.description} full />
            </div>
          </section>

          {/* #3 Análisis (lectura, detrás de un botón) */}
          <section className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-industrial/50">Análisis</p>
            <button
              type="button"
              onClick={() => setPlanOpen(v => !v)}
              className="w-full flex items-center justify-between gap-2 bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5"
            >
              <span className="text-xs font-bold text-fg">Ver análisis técnico</span>
              <span className="text-[10px] text-text-industrial/50 flex items-center gap-1">
                Criterios · LOTO · Riesgo · RCM
                <ChevronDown className={`w-4 h-4 transition-transform ${planOpen ? "rotate-180" : ""}`} />
              </span>
            </button>
            {planOpen && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <ReadField label="Criterio de aceptación" value={selected.acceptanceCriteria} full />
                <ReadField label="LOTO" value={selected.loto} full />
                <ReadField label="Nivel de riesgo" value={selected.riskLevel ? (RISK_LABEL[selected.riskLevel] ?? selected.riskLevel) : null} />
                <ReadField label="Resultado análisis de riesgo" value={selected.riskAnalysisResult} full />
                <ReadField label="RCM" value={selected.consequenceCategory ? (CONSEQUENCE_LABEL[selected.consequenceCategory] ?? selected.consequenceCategory) : null} />
                <ReadField label="Justificación RCM" value={selected.consequenceRationale} full />
                {!selected.acceptanceCriteria && !selected.loto && !selected.riskLevel && !selected.riskAnalysisResult && !selected.consequenceCategory && (
                  <p className="col-span-2 text-xs text-text-industrial/40">Sin análisis cargado.</p>
                )}
              </div>
            )}
          </section>

          {/* Documento checklist */}
          <section className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-industrial/50">Documento checklist</p>
            {selected.checklistDocUrl ? (
              <a href={selected.checklistDocUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-xs font-medium text-accent">
                <FileText className="w-4 h-4 shrink-0" /> Ver documento
              </a>
            ) : (
              <p className="text-xs text-text-industrial/40">Sin documento.</p>
            )}
            {canEdit && (
              <label className="flex items-center justify-center gap-2 bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-xs font-bold text-text-industrial/70 active:bg-fg/10">
                {uploadingChecklist ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {selected.checklistDocUrl ? "Reemplazar archivo" : "Subir archivo"}
                <input type="file" className="hidden" disabled={uploadingChecklist} onChange={onChecklistSelect} />
              </label>
            )}
          </section>

          {/* Observaciones consolidadas por AI (se actualizan tras cada avance) */}
          {selected.observations && (
            <div className="bg-accent/5 border border-accent/30 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] uppercase tracking-wider text-accent/80 font-bold">Observaciones</p>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent/70 border border-accent/30">
                  generado por IA
                </span>
              </div>
              <p className="text-xs text-fg/85 whitespace-pre-line leading-relaxed">{selected.observations}</p>
            </div>
          )}

          {/* Avances */}
          {(selected.status === "PLANNED" || selected.status === "IN_PROGRESS" || selected.status === "ON_HOLD" || selected.status === "CLOSED") && (
            <ProgressNotesPanel
              workOrderId={selected.id}
              onAdd={() => setShowProgressSheet(true)}
              onDeleted={async () => {
                // Tras borrar, refetch del WO para reflejar observations regeneradas
                const refetchWO = async () => {
                  try {
                    const fresh = await api.get<WO>(`/app/pms/work-orders/${selected.id}`);
                    setSelected(fresh);
                  } catch { /* non-blocking */ }
                };
                setTimeout(refetchWO, 2000);
                setTimeout(refetchWO, 6000);
              }}
              reloadKey={notesReloadKey}
              canAdd={canEdit}
              canDelete={canEdit}
            />
          )}

          {/* Resultado de la OT */}
          <section className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-industrial/50">Resultado de la {woTerms.abbr}</p>
            <HoursPanel
              workOrderId={selected.id}
              estimated={selected.estimatedHours}
              actual={selected.actualHours}
              isClosed={selected.status === "CLOSED"}
              isEditable={canEdit}
              onUpdated={(newActual) => setSelected({ ...selected, actualHours: newActual })}
            />
            {selected.status === "CLOSED" && (selected.executedByName || selected.completedDate || selected.runningHoursAtExecution != null) && (
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Ejecución</p>
                {selected.executedByName && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-industrial/50">Ejecutado por</span>
                    <span className="text-fg">{selected.executedByName}</span>
                  </div>
                )}
                {selected.completedDate && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-industrial/50">Fecha</span>
                    <span className="text-fg">{selected.completedDate.slice(0, 10)}</span>
                  </div>
                )}
                {selected.runningHoursAtExecution != null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-industrial/50">Horas motor</span>
                    <span className="text-fg tabular-nums">{selected.runningHoursAtExecution} h</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
        </div>

        {/* Footer */}
        {canClose && (
          <div className="shrink-0 p-3 border-t border-fg/10 bg-surface dark:bg-[#0D1B2A]">
            <button
              type="button"
              onClick={openClose}
              className="w-full py-3 rounded-xl bg-success-sea text-white text-sm font-bold"
            >
              Cerrar {woTerms.abbr}
            </button>
          </div>
        )}

        {/* Bottom sheet de registrar avance */}
        {showProgressSheet && (
          <ProgressNoteSheet
            workOrderId={selected.id}
            onClose={() => setShowProgressSheet(false)}
            onSaved={async () => {
              setNotesReloadKey(k => k + 1);
              // El pipeline AI corre en background y puede tardar unos segundos.
              // Refetcheo la OT a los 3s para ver observations actualizadas;
              // y de nuevo a los 8s por si la primera vez todavía no procesó.
              const refetchWO = async () => {
                try {
                  const fresh = await api.get<WO>(`/app/pms/work-orders/${selected.id}`);
                  setSelected(fresh);
                } catch { /* non-blocking */ }
              };
              setTimeout(refetchWO, 3000);
              setTimeout(refetchWO, 8000);
            }}
          />
        )}
      </div>
    );
  }

  // ── List ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Filter chips */}
      <div className="shrink-0 px-3 py-2.5 border-b border-fg/10 flex gap-1.5 overflow-x-auto">
        {([
          ["open",    "Activas",  openWOs.length,    "text-text-industrial/60"],
          ["overdue", "Vencidas", overdueWOs.length, "text-red-700 dark:text-red-400"],
          ...(canApproveSS
            ? [
                ["solicitadas", "Para aprobar",   solicitadasWOs.length, "text-blue-700 dark:text-blue-400"],
                ["aprobadas",   "Para autorizar", aprobadasWOs.length,   "text-violet-700 dark:text-violet-400"],
              ] as [WoFilter, string, number, string][]
            : []),
        ] as [WoFilter, string, number, string][]).map(([f, label, count, color]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors flex items-center gap-1.5 ${
              filter === f
                ? "bg-accent/15 text-accent border-accent/40"
                : "bg-fg/5 text-text-industrial/60 border-fg/10"
            }`}
          >
            {label}
            <span className={`text-[10px] tabular-nums ${filter === f ? "text-accent" : color}`}>({count})</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-fg/5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : visibleWOs.length === 0 ? (
          <div className="text-center py-10 text-text-industrial/30 text-sm">
            {filter === "overdue" ? `Sin ${woTerms.abbr} vencidas` : filter === "solicitadas" ? "Sin SS para aprobar" : filter === "aprobadas" ? "Sin SS para autorizar" : "Sin órdenes activas"}
          </div>
        ) : (
          visibleWOs.map(wo => (
            <button
              key={wo.id}
              type="button"
              onClick={() => selectWO(wo)}
              className="w-full text-left px-4 py-3.5 hover:bg-fg/5 active:bg-fg/10 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 text-xs font-bold w-4 text-center shrink-0 ${CRIT_COLOR[wo.criticality] ?? "text-fg"}`}>
                  {wo.criticality}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono text-text-industrial/40">{wo.workOrderCode}</span>
                    <span className={`text-[9px] px-1.5 py-px rounded-full border font-bold ${STATUS_COLOR[wo.status] ?? ""}`}>
                      {STATUS_LABEL[wo.status] ?? wo.status}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-fg truncate">{wo.title ?? "(Sin título)"}</p>
                  {wo.assetName && (
                    <p className="text-xs text-text-industrial/40 truncate mt-0.5">{wo.assetName}</p>
                  )}
                </div>
                {wo.dueDate && (
                  <div className={`text-[10px] font-mono shrink-0 mt-0.5 ${isOverdue(wo) ? "text-red-700 dark:text-red-400 font-bold" : "text-text-industrial/30"}`}>
                    {wo.dueDate.slice(5, 10)}
                  </div>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
