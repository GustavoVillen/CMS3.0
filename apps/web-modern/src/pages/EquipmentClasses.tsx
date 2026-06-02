import React, { useEffect, useState } from "react";
import { Loader2, Plus, X, Trash2 } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";

interface EquipmentClass {
  id: string;
  code: string;
  name: string;
  description: string | null;
  defaultSfiCode: string | null;
  defaultCriticality: string | null;
  isGlobal: boolean;
  status: string;
}

interface TaskTemplate {
  id: string;
  taskMasterId: string;
  isDefault: boolean;
  sortOrder: number;
  taskMaster?: {
    code: string;
    title: string;
    taskType: string;
    triggerType: string;
    frequencyDays: number | null;
    frequencyHours: number | null;
  };
}

interface TaskMaster {
  id: string;
  code: string;
  title: string;
  taskType: string;
  triggerType: string;
}

interface ListResponse { items: EquipmentClass[]; total: number; }

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const selectCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50";
const labelCls = "text-xs font-semibold text-text-industrial/60 uppercase tracking-wider";

// ─── Drawer ───────────────────────────────────────────────────────────────────

interface DrawerProps {
  initial: EquipmentClass | null;
  onClose: () => void;
  onSaved: () => void;
}

const ClassDrawer: React.FC<DrawerProps> = ({ initial, onClose, onSaved }) => {
  const isEdit = Boolean(initial);
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [defaultSfiCode, setDefaultSfiCode] = useState(initial?.defaultSfiCode ?? "");
  const [defaultCriticality, setDefaultCriticality] = useState(initial?.defaultCriticality ?? "B");
  const [status, setStatus] = useState(initial?.status ?? "ACTIVE");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Task templates (only in edit mode)
  const { data: tmplData, reload: reloadTmpls } = useFetch<{ items: TaskTemplate[] }>(
    isEdit ? `/app/pms/equipment-classes/${initial!.id}/task-templates` : null,
    [initial?.id],
  );
  const { data: allTasksData } = useFetch<{ items: TaskMaster[] }>(
    "/app/pms/task-masters?status=ACTIVE",
    [],
  );

  const [addingTask, setAddingTask] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);

  useEffect(() => {
    setCode(initial?.code ?? "");
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setDefaultSfiCode(initial?.defaultSfiCode ?? "");
    setDefaultCriticality(initial?.defaultCriticality ?? "B");
    setStatus(initial?.status ?? "ACTIVE");
    setErr(null);
  }, [initial]);

  const save = async () => {
    if (!code.trim()) { setErr("El código es requerido."); return; }
    if (!name.trim()) { setErr("El nombre es requerido."); return; }
    setSaving(true); setErr(null);
    try {
      const payload = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || null,
        defaultSfiCode: defaultSfiCode.trim() || null,
        defaultCriticality: defaultCriticality || null,
        status,
      };
      if (isEdit) {
        await api.patch(`/app/pms/equipment-classes/${initial!.id}`, payload);
      } else {
        await api.post("/app/pms/equipment-classes", payload);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  const addTemplate = async () => {
    if (!selectedTaskId) return;
    setAddErr(null);
    try {
      await api.post(`/app/pms/equipment-classes/${initial!.id}/task-templates`, { taskMasterId: selectedTaskId });
      setSelectedTaskId("");
      setAddingTask(false);
      await reloadTmpls();
    } catch (e) {
      setAddErr(e instanceof ApiError ? e.message : "Error al agregar.");
    }
  };

  const removeTemplate = async (taskMasterId: string) => {
    try {
      await api.delete(`/app/pms/equipment-classes/${initial!.id}/task-templates/${taskMasterId}`);
      await reloadTmpls();
    } catch { /* silent */ }
  };

  const existingIds = new Set((tmplData?.items ?? []).map(t => t.taskMasterId));
  const availableTasks = (allTasksData?.items ?? []).filter(t => !existingIds.has(t.id));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full sm:max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 sm:rounded-2xl shadow-2xl flex flex-col max-h-[95vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <div>
            <h2 className="text-base font-bold text-fg">{isEdit ? "Editar Clase" : "Nueva Clase de Equipo"}</h2>
            {isEdit && <p className="text-[10px] text-text-industrial/40">{initial!.code}</p>}
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg transition-colors" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>Código *</label>
              <input value={code} onChange={e => setCode(e.target.value)} disabled={isEdit} placeholder="PUMP" className={inputCls} />
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
            <label className={labelCls}>Nombre *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Bomba centrífuga" className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Descripción</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>Código SFI por defecto</label>
              <input value={defaultSfiCode} onChange={e => setDefaultSfiCode(e.target.value)} placeholder="500" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Criticidad por defecto</label>
              <select value={defaultCriticality} onChange={e => setDefaultCriticality(e.target.value)} className={selectCls}>
                <option value="A">A — Crítico</option>
                <option value="B">B — Importante</option>
                <option value="C">C — Menor</option>
              </select>
            </div>
          </div>

          {/* Task templates — only in edit mode */}
          {isEdit && (
            <div className="space-y-3 pt-2 border-t border-fg/10">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Tareas asociadas</p>
                {!addingTask && availableTasks.length > 0 && (
                  <button onClick={() => setAddingTask(true)} className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Agregar tarea
                  </button>
                )}
              </div>

              {addingTask && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <select value={selectedTaskId} onChange={e => setSelectedTaskId(e.target.value)} className={selectCls}>
                      <option value="">— Seleccionar tarea —</option>
                      {availableTasks.map(t => (
                        <option key={t.id} value={t.id}>{t.code} — {t.title}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={() => { void addTemplate(); }} disabled={!selectedTaskId} className="px-3 py-2 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-40">
                    Agregar
                  </button>
                  <button onClick={() => { setAddingTask(false); setSelectedTaskId(""); }} className="px-3 py-2 rounded-lg text-xs text-text-industrial/60 hover:text-fg">
                    Cancelar
                  </button>
                </div>
              )}
              {addErr && <p className="text-xs text-red-700 dark:text-red-400">{addErr}</p>}

              {(tmplData?.items ?? []).length === 0 && !addingTask && (
                <p className="text-xs text-text-industrial/30 py-2">Sin tareas asociadas.</p>
              )}
              {(tmplData?.items ?? []).map(tmpl => (
                <div key={tmpl.id} className="flex items-center justify-between bg-fg/3 border border-fg/8 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-fg">{tmpl.taskMaster?.code} — {tmpl.taskMaster?.title}</p>
                    <p className="text-[10px] text-text-industrial/40 mt-0.5">
                      {tmpl.taskMaster?.taskType} · {tmpl.taskMaster?.triggerType}
                      {tmpl.taskMaster?.frequencyDays ? ` · cada ${tmpl.taskMaster.frequencyDays}d` : ""}
                      {tmpl.taskMaster?.frequencyHours ? ` · cada ${tmpl.taskMaster.frequencyHours}h` : ""}
                    </p>
                  </div>
                  <button onClick={() => { void removeTemplate(tmpl.taskMasterId); }} className="text-text-industrial/30 hover:text-red-400 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

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

export const EquipmentClassesPage: React.FC = () => {
  const t = useT();
  const { data, loading, error, reload } = useFetch<ListResponse>("/app/pms/equipment-classes", []);
  const [editing, setEditing] = useState<EquipmentClass | null | "new">(null);

  const COLUMNS: Column<EquipmentClass>[] = [
    { key: "code",               header: t("col.code"),        render: r => <span className="font-mono font-bold text-fg text-xs">{r.code}</span> },
    { key: "name",               header: t("col.name"),        render: r => <span className="font-medium text-fg">{r.name}</span> },
    { key: "defaultSfiCode",     header: "SFI",                render: r => <span className="font-mono text-xs text-text-industrial/60">{r.defaultSfiCode ?? "—"}</span> },
    { key: "defaultCriticality", header: t("col.criticality"), render: r => r.defaultCriticality ? <span className={`font-bold text-xs ${r.defaultCriticality === "A" ? "text-red-700 dark:text-red-400" : r.defaultCriticality === "B" ? "text-yellow-700 dark:text-yellow-400" : "text-text-industrial/60"}`}>{r.defaultCriticality}</span> : <span className="text-text-industrial/30">—</span> },
    { key: "status",             header: t("col.status"),      render: r => <StatusBadge status={r.status} /> },
    { key: "isGlobal",           header: "Alcance",            render: r => <span className="text-xs text-text-industrial/50">{r.isGlobal ? "Global" : "Tenant"}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader icon={undefined} title={t("page.equipmentClasses")} total={data?.total} onReload={reload}>
        <button onClick={() => setEditing("new")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs text-accent hover:bg-accent/20 transition-all">
          <Plus className="w-3.5 h-3.5" /> Nueva clase
        </button>
      </PageHeader>
      <DataTable
        columns={COLUMNS}
        data={data?.items ?? null}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText="No hay clases de equipos."
        onRowClick={row => setEditing(row)}
      />
      {editing && (
        <ClassDrawer
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
};
