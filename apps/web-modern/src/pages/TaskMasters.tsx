import React, { useEffect, useState } from "react";
import { ClipboardList, Loader2, Plus } from "lucide-react";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { useFetch } from "../lib/hooks";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";
import { AutoTextArea } from "../components/AutoTextArea";

interface TaskMaster {
  id: string;
  code: string;
  title: string;
  taskType: string;
  triggerType: string;
  triggerResultMode: string;
  frequencyDays: number | null;
  frequencyHours: number | null;
  estimatedHours: number | null;
  procedure: string | null;
  procedureReference: string | null;
  acceptanceCriteria: string | null;
  evidenceRequired: boolean;
  isGlobal: boolean;
  status: string;
}

interface ListResponse { items: TaskMaster[]; total: number; }

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const selectCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50";
const labelCls = "text-xs font-semibold text-text-industrial/60 uppercase tracking-wider";

const TASK_TYPES    = ["MAINTENANCE", "INSPECTION"];
const TRIGGER_TYPES = ["HOURS", "MONTHS", "CONDITION", "EVENT", "CALENDAR", "RUNNING_HOURS"];
const RESULT_MODES  = ["DUE_ONLY", "AUTO_WO", "APPROVAL_WO"];

const TRIGGER_LABELS: Record<string, string> = {
  HOURS: "Por horas",
  MONTHS: "Por meses",
  CONDITION: "Por condición",
  EVENT: "Por evento",
  CALENDAR: "Calendario",
  RUNNING_HOURS: "Horas de marcha",
};

const RESULT_LABELS: Record<string, string> = {
  DUE_ONLY:    "Solo vencimiento",
  AUTO_WO:     "Orden automática",
  APPROVAL_WO: "Orden con aprobación",
};

// ─── Drawer ───────────────────────────────────────────────────────────────────

interface DrawerProps {
  initial: TaskMaster | null;
  onClose: () => void;
  onSaved: () => void;
}

const TaskDrawer: React.FC<DrawerProps> = ({ initial, onClose, onSaved }) => {
  const isEdit = Boolean(initial);
  const [code, setCode]                     = useState(initial?.code ?? "");
  const [title, setTitle]                   = useState(initial?.title ?? "");
  const [taskType, setTaskType]             = useState(initial?.taskType ?? "MAINTENANCE");
  const [triggerType, setTriggerType]       = useState(initial?.triggerType ?? "MONTHS");
  const [resultMode, setResultMode]         = useState(initial?.triggerResultMode ?? "DUE_ONLY");
  const [frequencyDays, setFrequencyDays]   = useState(String(initial?.frequencyDays ?? ""));
  const [frequencyHours, setFrequencyHours] = useState(String(initial?.frequencyHours ?? ""));
  const [estimatedHours, setEstimatedHours] = useState(String(initial?.estimatedHours ?? ""));
  const [procedure, setProcedure]           = useState(initial?.procedure ?? "");
  const [procedureRef, setProcedureRef]     = useState(initial?.procedureReference ?? "");
  const [acceptance, setAcceptance]         = useState(initial?.acceptanceCriteria ?? "");
  const [evidence, setEvidence]             = useState(initial?.evidenceRequired ?? false);
  const [status, setStatus]                 = useState(initial?.status ?? "ACTIVE");
  const [saving, setSaving]                 = useState(false);
  const [err, setErr]                       = useState<string | null>(null);

  useEffect(() => {
    setCode(initial?.code ?? "");
    setTitle(initial?.title ?? "");
    setTaskType(initial?.taskType ?? "MAINTENANCE");
    setTriggerType(initial?.triggerType ?? "MONTHS");
    setResultMode(initial?.triggerResultMode ?? "DUE_ONLY");
    setFrequencyDays(String(initial?.frequencyDays ?? ""));
    setFrequencyHours(String(initial?.frequencyHours ?? ""));
    setEstimatedHours(String(initial?.estimatedHours ?? ""));
    setProcedure(initial?.procedure ?? "");
    setProcedureRef(initial?.procedureReference ?? "");
    setAcceptance(initial?.acceptanceCriteria ?? "");
    setEvidence(initial?.evidenceRequired ?? false);
    setStatus(initial?.status ?? "ACTIVE");
    setErr(null);
  }, [initial]);

  const save = async () => {
    if (!code.trim()) { setErr("El código es requerido."); return; }
    if (!title.trim()) { setErr("El título es requerido."); return; }
    setSaving(true); setErr(null);
    try {
      const payload = {
        code: code.trim().toUpperCase(),
        title: title.trim(),
        taskType,
        triggerType,
        triggerResultMode: resultMode,
        frequencyDays:   frequencyDays   ? Number(frequencyDays)   : null,
        frequencyHours:  frequencyHours  ? Number(frequencyHours)  : null,
        estimatedHours:  estimatedHours  ? Number(estimatedHours)  : null,
        procedure:       procedure.trim() || null,
        procedureReference: procedureRef.trim() || null,
        acceptanceCriteria: acceptance.trim() || null,
        evidenceRequired: evidence,
        status,
      };
      if (isEdit) {
        await api.patch(`/app/pms/task-masters/${initial!.id}`, payload);
      } else {
        await api.post("/app/pms/task-masters", payload);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  const usesDays  = ["MONTHS", "CALENDAR"].includes(triggerType);
  const usesHours = ["HOURS", "RUNNING_HOURS"].includes(triggerType);

  // ESC: cerrar / preguntar guardar si hay cambios
  const isDirty = useDirtyTracker({ code, title, taskType, triggerType, resultMode, frequencyDays, frequencyHours, estimatedHours, procedure, procedureRef, acceptance, evidence, status });
  const requestClose = useEscapeGuard({ isDirty, onSave: save, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full sm:max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 sm:rounded-2xl shadow-2xl flex flex-col max-h-[95vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <div>
            <h2 className="text-base font-bold text-fg">{isEdit ? "Editar Tarea Maestra" : "Nueva Tarea Maestra"}</h2>
            {isEdit && <p className="text-[10px] text-text-industrial/40">{initial!.code}</p>}
          </div>
          <ModalCloseButton onClose={requestClose} />
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>Código *</label>
              <input value={code} onChange={e => setCode(e.target.value)} disabled={isEdit} placeholder="MP-001" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Estado</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className={selectCls}>
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>Título *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Cambio de aceite lubricante" className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>Tipo de tarea</label>
              <select value={taskType} onChange={e => setTaskType(e.target.value)} className={selectCls}>
                {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Resultado</label>
              <select value={resultMode} onChange={e => setResultMode(e.target.value)} className={selectCls}>
                {RESULT_MODES.map(m => <option key={m} value={m}>{RESULT_LABELS[m]}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>Tipo de disparo</label>
              <select value={triggerType} onChange={e => setTriggerType(e.target.value)} className={selectCls}>
                {TRIGGER_TYPES.map(t => <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>{usesHours ? "Frecuencia (horas)" : "Frecuencia (días)"}</label>
              <input
                type="number" min="1"
                value={usesHours ? frequencyHours : frequencyDays}
                onChange={e => usesHours ? setFrequencyHours(e.target.value) : setFrequencyDays(e.target.value)}
                disabled={triggerType === "CONDITION" || triggerType === "EVENT"}
                placeholder="0"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Horas estimadas</label>
              <input type="number" min="0" step="0.5" value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)} placeholder="0" className={inputCls} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>Procedimiento</label>
            <AutoTextArea value={procedure} onChange={e => setProcedure(e.target.value)} rows={3} placeholder="Pasos del procedimiento..." className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>Referencia de procedimiento</label>
              <input value={procedureRef} onChange={e => setProcedureRef(e.target.value)} placeholder="Doc. MAN-001 §4.2" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Criterios de aceptación</label>
              <input value={acceptance} onChange={e => setAcceptance(e.target.value)} placeholder="Presión ≥ 3.5 bar" className={inputCls} />
            </div>
          </div>

          <label className="flex items-center gap-3 bg-fg/3 border border-fg/8 rounded-xl px-4 py-3 cursor-pointer hover:bg-fg/5 transition-colors">
            <input type="checkbox" checked={evidence} onChange={e => setEvidence(e.target.checked)} className="w-4 h-4 rounded accent-accent" />
            <span className="text-sm text-fg font-medium">Requiere evidencia</span>
            <span className="text-xs text-text-industrial/50 ml-auto">Foto / documento adjunto obligatorio al cerrar</span>
          </label>

          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">Cancelar</button>
          <button onClick={() => { void save(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const TaskMastersPage: React.FC = () => {
  const t = useT();
  const [typeFilter, setTypeFilter] = useState("");
  const path = `/app/pms/task-masters${typeFilter ? `?taskType=${typeFilter}` : ""}`;
  const { data, loading, error, reload } = useFetch<ListResponse>(path, [typeFilter]);
  const [editing, setEditing] = useState<TaskMaster | null | "new">(null);

  const COLUMNS: Column<TaskMaster>[] = [
    {
      key: "code",
      header: t("col.code"),
      render: r => <span className="font-mono font-bold text-fg text-xs">{r.code}</span>,
    },
    {
      key: "title",
      header: t("col.title"),
      render: r => <span className="font-medium text-fg">{r.title}</span>,
    },
    {
      key: "taskType",
      header: "Tipo",
      render: r => <span className="text-xs text-text-industrial/70">{r.taskType}</span>,
    },
    {
      key: "triggerType",
      header: "Disparo",
      render: r => <span className="text-xs text-text-industrial/60">{TRIGGER_LABELS[r.triggerType] ?? r.triggerType}</span>,
    },
    {
      key: "frequencyDays",
      header: "Frecuencia",
      render: r => {
        if (r.frequencyHours) return <span className="font-mono text-xs">{r.frequencyHours}h</span>;
        if (r.frequencyDays)  return <span className="font-mono text-xs">{r.frequencyDays}d</span>;
        return <span className="text-text-industrial/30 text-xs">—</span>;
      },
    },
    {
      key: "evidenceRequired",
      header: "Evidencia",
      render: r => r.evidenceRequired
        ? <span className="text-xs text-yellow-700 dark:text-yellow-400 font-semibold">Sí</span>
        : <span className="text-text-industrial/30 text-xs">No</span>,
    },
    {
      key: "status",
      header: t("col.status"),
      render: r => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader icon={ClipboardList} title={t("page.taskMasters")} total={data?.total} onReload={reload}>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value="">Todos los tipos</option>
          <option value="MAINTENANCE">Mantenimiento</option>
          <option value="INSPECTION">Inspección</option>
        </select>
        <button onClick={() => setEditing("new")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs text-accent hover:bg-accent/20 transition-all">
          <Plus className="w-3.5 h-3.5" /> Nueva tarea
        </button>
      </PageHeader>
      <DataTable
        columns={COLUMNS}
        data={data?.items ?? null}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText="No hay tareas maestras."
        onRowClick={row => setEditing(row)}
      />
      {editing && (
        <TaskDrawer
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
};
