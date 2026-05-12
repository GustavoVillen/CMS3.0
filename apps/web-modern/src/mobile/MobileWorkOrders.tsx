import React, { useState, useCallback } from "react";
import { ChevronLeft, Loader2, Camera, X, Plus, Type, Mic, Video as VideoIcon, Trash2, Pencil, Check } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useEscapeGuard } from "../lib/escape-guard";
import { ProgressNoteSheet } from "./ProgressNoteSheet";

interface WO {
  id: string;
  workOrderCode: string;
  title: string | null;
  description: string | null;
  status: string;
  criticality: string;
  dueDate: string | null;
  assetName: string | null;
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

const RISK_COLOR: Record<string, string> = {
  LOW:      "text-success-sea",
  MEDIUM:   "text-yellow-400",
  HIGH:     "text-orange-400",
  CRITICAL: "text-red-400",
};

const CONSEQUENCE_LABEL: Record<string, string> = {
  SAFETY:          "Seguridad",
  ENVIRONMENTAL:   "Ambiental",
  OPERATIONAL:     "Operacional",
  NON_OPERATIONAL: "No operacional",
};

type InfoTab = "tarea" | "criteria" | "loto" | "riesgo" | "rcm";

const STATUS_LABEL: Record<string, string> = {
  PLANNED:     "Planificada",
  IN_PROGRESS: "En ejecución",
  ON_HOLD:     "Retenida",
  DONE:        "Completada",
  CLOSED:      "Cerrada",
  CANCELLED:   "Cancelada",
};

const STATUS_COLOR: Record<string, string> = {
  PLANNED:     "bg-blue-500/10 text-blue-400 border-blue-500/20",
  IN_PROGRESS: "bg-accent/10 text-accent border-accent/20",
  ON_HOLD:     "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  DONE:        "bg-success-sea/10 text-success-sea border-success-sea/20",
  CLOSED:      "bg-white/5 text-text-industrial/40 border-white/10",
};

const CRIT_COLOR: Record<string, string> = {
  A: "text-red-400",
  B: "text-orange-400",
  C: "text-yellow-400",
  D: "text-text-industrial/50",
};

type View = "list" | "detail" | "close";

// Acordeón con 5 chips de info del plan/OT.
// Solo se puede tener un panel abierto a la vez. Si el campo correspondiente
// está vacío, el chip queda deshabilitado y atenuado.
const InfoAccordion: React.FC<{
  wo: WO;
  active: InfoTab | null;
  onToggle: (tab: InfoTab | null) => void;
}> = ({ wo, active, onToggle }) => {
  const tabs: Array<{ id: InfoTab; label: string; hasContent: boolean }> = [
    { id: "tarea",    label: "Tarea",     hasContent: !!wo.description },
    { id: "criteria", label: "Criterios", hasContent: !!wo.acceptanceCriteria },
    { id: "loto",     label: "LOTO",      hasContent: !!wo.loto },
    { id: "riesgo",   label: "Riesgo",    hasContent: !!wo.riskLevel || !!wo.riskAnalysisResult },
    { id: "rcm",      label: "RCM",       hasContent: !!wo.consequenceCategory || !!wo.consequenceRationale },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1.5">
        {tabs.map(({ id, label, hasContent }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onToggle(isActive ? null : id)}
              disabled={!hasContent}
              className={`py-2 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-colors ${
                !hasContent
                  ? "bg-white/5 border-white/5 text-text-industrial/20 cursor-not-allowed"
                  : isActive
                  ? "bg-accent/15 text-accent border-accent/40"
                  : "bg-white/5 text-text-industrial/60 border-white/10 hover:bg-white/10 active:bg-white/15"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {active === "tarea" && wo.description && (
        <InfoPanel label="Tarea a ejecutar">
          <p className="text-xs text-white/85 whitespace-pre-line leading-relaxed">{wo.description}</p>
        </InfoPanel>
      )}

      {active === "criteria" && wo.acceptanceCriteria && (
        <InfoPanel label="Criterios de aceptación">
          <p className="text-xs text-white/85 whitespace-pre-line leading-relaxed">{wo.acceptanceCriteria}</p>
        </InfoPanel>
      )}

      {active === "loto" && wo.loto && (
        <InfoPanel label="LOTO (Lockout / Tagout)">
          <p className="text-xs text-white/85 whitespace-pre-line leading-relaxed">{wo.loto}</p>
        </InfoPanel>
      )}

      {active === "riesgo" && (wo.riskLevel || wo.riskAnalysisResult) && (
        <InfoPanel label="Nivel de riesgo">
          {wo.riskLevel && (
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-text-industrial/40">Nivel</span>
              <span className={`text-sm font-bold ${RISK_COLOR[wo.riskLevel] ?? "text-white"}`}>
                {RISK_LABEL[wo.riskLevel] ?? wo.riskLevel}
              </span>
            </div>
          )}
          {wo.riskAnalysisResult && (
            <p className="text-xs text-white/85 whitespace-pre-line leading-relaxed">{wo.riskAnalysisResult}</p>
          )}
        </InfoPanel>
      )}

      {active === "rcm" && (wo.consequenceCategory || wo.consequenceRationale) && (
        <InfoPanel label="RCM — Consecuencia">
          {wo.consequenceCategory && (
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-text-industrial/40">Categoría</span>
              <span className="text-sm font-bold text-accent">
                {CONSEQUENCE_LABEL[wo.consequenceCategory] ?? wo.consequenceCategory}
              </span>
            </div>
          )}
          {wo.consequenceRationale && (
            <p className="text-xs text-white/85 whitespace-pre-line leading-relaxed">{wo.consequenceRationale}</p>
          )}
        </InfoPanel>
      )}
    </div>
  );
};

const InfoPanel: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="bg-white/5 border border-accent/20 rounded-xl p-3 space-y-1.5">
    <p className="text-[10px] uppercase tracking-wider text-accent/70 font-bold">{label}</p>
    {children}
  </div>
);

// Lista de avances de la OT: cada entrada muestra timestamp + media + texto.
// canAdd: solo OTs abiertas pueden recibir nuevas notas.
interface ProgressNote {
  id: string;
  kind: "TEXT" | "PHOTO" | "VIDEO" | "AUDIO";
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-bold hover:brightness-110"
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
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
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
        <img src={note.fileUrl} alt="Foto" className="w-full rounded-lg object-cover max-h-72" />
      )}
      {note.kind === "VIDEO" && note.fileUrl && (
        <video src={note.fileUrl} controls className="w-full rounded-lg max-h-72" />
      )}
      {note.kind === "AUDIO" && note.fileUrl && (
        <audio src={note.fileUrl} controls className="w-full" />
      )}
      {note.text && (
        <p className="text-xs text-white/85 whitespace-pre-line leading-relaxed">{note.text}</p>
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
      : abs <= 50 ? "text-yellow-400"
      : "text-red-400";
    const sign = diff > 0 ? "+" : "";
    deviation = { pct, color, label: `${sign}${pct.toFixed(0)}%` };
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Horas de la tarea</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] text-text-industrial/40">Estimadas</p>
          <p className="text-base font-bold text-white tabular-nums">{estimated != null ? `${estimated} h` : "—"}</p>
        </div>
        <div>
          <div className="flex items-center justify-between gap-1">
            <p className="text-[10px] text-text-industrial/40">{isClosed ? "Reales" : "Reales"}</p>
            {isEditable && !editing && (
              <button
                type="button"
                onClick={startEdit}
                className="p-0.5 text-text-industrial/40 hover:text-accent transition-colors"
                aria-label="Editar horas reales"
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
          </div>
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.25"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="h"
                className="flex-1 min-w-0 bg-white/5 border border-accent/40 rounded-md px-2 py-1 text-sm text-white focus:outline-none"
                disabled={saving}
              />
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving}
                className="p-1 rounded-md bg-accent text-white disabled:opacity-50"
                aria-label="Guardar"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="p-1 rounded-md bg-white/10 text-text-industrial/60"
                aria-label="Cancelar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <p className="text-base font-bold text-white tabular-nums">{actual != null ? `${actual} h` : "—"}</p>
          )}
        </div>
      </div>
      {deviation && !editing && (
        <div className="flex items-center justify-between pt-1 border-t border-white/10">
          <span className="text-[10px] text-text-industrial/50 uppercase tracking-wider">Desvío</span>
          <span className={`text-sm font-bold tabular-nums ${deviation.color}`}>{deviation.label}</span>
        </div>
      )}
    </div>
  );
};

export const MobileWorkOrders: React.FC = () => {
  const { data, loading, reload } = useFetch<{ items: WO[] }>("/app/pms/work-orders");
  const [view, setView]           = useState<View>("list");
  const [selected, setSelected]   = useState<WO | null>(null);
  const [infoTab, setInfoTab]     = useState<InfoTab | null>(null);
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

  const openWOs = (data?.items ?? []).filter(
    w => w.status === "PLANNED" || w.status === "IN_PROGRESS" || w.status === "ON_HOLD",
  );

  const selectWO  = (wo: WO) => { setSelected(wo); setView("detail"); setInfoTab(null); setErr(null); };
  const back      = ()       => { setView("list"); setSelected(null); setInfoTab(null); setErr(null); };
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
      setErr(e instanceof ApiError ? e.message : "Error al iniciar OT");
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
      setErr(e instanceof ApiError ? e.message : "Error al cerrar OT");
    } finally {
      setSaving(false);
    }
  }, [selected, woResult, observations, executionDate, executedByName, actualHours, runningHours, photoFile, reload]);

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
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-white/10">
          <button type="button" onClick={() => setView("detail")} className="p-2 -ml-2 text-text-industrial/40 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-white truncate">Cerrar {selected.workOrderCode}</span>
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
                        : "bg-orange-500/15 text-orange-400 border-orange-500/30"
                      : "bg-white/5 text-text-industrial/50 border-white/10"
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
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Fecha</p>
              <input
                type="date"
                value={executionDate}
                onChange={e => setExecutionDate(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent/50"
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
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
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
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
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
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
            />
          </div>

          {/* Foto opcional: usa la cámara trasera del celular */}
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Foto (opcional)</p>
            {photoPreview ? (
              <div className="relative">
                <img src={photoPreview} alt="Vista previa" className="w-full rounded-xl border border-white/10 object-cover max-h-72" />
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white"
                  aria-label="Quitar foto"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/15 bg-white/5 text-text-industrial/60 cursor-pointer hover:bg-white/10 active:bg-white/15 transition-colors">
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

          {err && <p className="text-xs text-red-400">{err}</p>}
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-accent text-white text-sm font-bold disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Confirmar cierre"}
          </button>
        </div>
      </div>
    );
  }

  // ── Detail ──────────────────────────────────────────────────────────────────
  if (view === "detail" && selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-white/10">
          <button type="button" onClick={back} className="p-2 -ml-2 text-text-industrial/40 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-white truncate flex-1">{selected.workOrderCode}</span>
          <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold shrink-0 ${STATUS_COLOR[selected.status] ?? "bg-white/5 text-white/40 border-white/10"}`}>
            {STATUS_LABEL[selected.status] ?? selected.status}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <p className="text-base font-bold text-white">{selected.title ?? "(Sin título)"}</p>
            {selected.assetName && <p className="text-xs text-text-industrial/50 mt-0.5">{selected.assetName}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Criticidad</p>
              <p className={`text-lg font-bold ${CRIT_COLOR[selected.criticality] ?? "text-white"}`}>{selected.criticality}</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Vencimiento</p>
              <p className={`text-sm font-bold ${isOverdue(selected) ? "text-red-400" : "text-white"}`}>
                {selected.dueDate ? selected.dueDate.slice(0, 10) : "—"}
              </p>
            </div>
          </div>

          {/* Acordeón de info: 5 chips expandibles con los campos del plan */}
          <InfoAccordion wo={selected} active={infoTab} onToggle={setInfoTab} />

          {/* Observaciones consolidadas por AI (se actualizan tras cada avance) */}
          {selected.observations && (
            <div className="bg-accent/5 border border-accent/30 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] uppercase tracking-wider text-accent/80 font-bold">Observaciones</p>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent/70 border border-accent/30">
                  generado por IA
                </span>
              </div>
              <p className="text-xs text-white/85 whitespace-pre-line leading-relaxed">{selected.observations}</p>
            </div>
          )}

          {/* Registro de avances de trabajo */}
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
              canAdd={selected.status !== "CLOSED" && selected.status !== "CANCELLED"}
              canDelete={selected.status !== "CLOSED" && selected.status !== "CANCELLED"}
            />
          )}

          {/* Bloque de horas — siempre visible (permite cargarlas desde el detalle) */}
          <HoursPanel
            workOrderId={selected.id}
            estimated={selected.estimatedHours}
            actual={selected.actualHours}
            isClosed={selected.status === "CLOSED"}
            isEditable={selected.status !== "CLOSED" && selected.status !== "CANCELLED"}
            onUpdated={(newActual) => setSelected({ ...selected, actualHours: newActual })}
          />

          {/* Datos de ejecución cuando ya está cerrada */}
          {selected.status === "CLOSED" && (selected.executedByName || selected.completedDate || selected.runningHoursAtExecution != null) && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Ejecución</p>
              {selected.executedByName && (
                <div className="flex justify-between text-xs">
                  <span className="text-text-industrial/50">Ejecutado por</span>
                  <span className="text-white">{selected.executedByName}</span>
                </div>
              )}
              {selected.completedDate && (
                <div className="flex justify-between text-xs">
                  <span className="text-text-industrial/50">Fecha</span>
                  <span className="text-white">{selected.completedDate.slice(0, 10)}</span>
                </div>
              )}
              {selected.runningHoursAtExecution != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-text-industrial/50">Horas motor</span>
                  <span className="text-white tabular-nums">{selected.runningHoursAtExecution} h</span>
                </div>
              )}
            </div>
          )}

          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="space-y-2 pt-2">
            {(selected.status === "PLANNED" || selected.status === "IN_PROGRESS" || selected.status === "ON_HOLD") && (
              <button
                type="button"
                onClick={openClose}
                className="w-full py-3 rounded-xl bg-success-sea text-white text-sm font-bold"
              >
                Cerrar OT
              </button>
            )}
          </div>
        </div>

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
      <div className="shrink-0 px-4 py-3 border-b border-white/10">
        <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">
          {openWOs.length} orden{openWOs.length !== 1 ? "es" : ""} activa{openWOs.length !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : openWOs.length === 0 ? (
          <div className="text-center py-10 text-text-industrial/30 text-sm">Sin órdenes activas</div>
        ) : (
          openWOs.map(wo => (
            <button
              key={wo.id}
              type="button"
              onClick={() => selectWO(wo)}
              className="w-full text-left px-4 py-3.5 hover:bg-white/5 active:bg-white/10 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 text-xs font-bold w-4 text-center shrink-0 ${CRIT_COLOR[wo.criticality] ?? "text-white"}`}>
                  {wo.criticality}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono text-text-industrial/40">{wo.workOrderCode}</span>
                    <span className={`text-[9px] px-1.5 py-px rounded-full border font-bold ${STATUS_COLOR[wo.status] ?? ""}`}>
                      {STATUS_LABEL[wo.status] ?? wo.status}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white truncate">{wo.title ?? "(Sin título)"}</p>
                  {wo.assetName && (
                    <p className="text-xs text-text-industrial/40 truncate mt-0.5">{wo.assetName}</p>
                  )}
                </div>
                {wo.dueDate && (
                  <div className={`text-[10px] font-mono shrink-0 mt-0.5 ${isOverdue(wo) ? "text-red-400 font-bold" : "text-text-industrial/30"}`}>
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
