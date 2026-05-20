// Pre-Arrival / Pre-Departure / etc. checklists firmadas (SIRE 2.0 Ch. 4).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ListChecks, Plus, Loader2, X, CheckCircle2, XCircle, MinusCircle, Settings } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { VesselLabel } from "../components/EntityLabels";
import { fmtDate } from "../lib/utils";
import { useMocTrigger, MocTriggerHost, type MocTriggerEvent } from "../lib/use-moc-trigger";
import { useT } from "../lib/i18n";

const TYPE_LABEL: Record<string, string> = {
  PRE_ARRIVAL: "Pre-Arrival",
  PRE_DEPARTURE: "Pre-Departure",
  PRE_BUNKERING: "Pre-Bunkering",
  PRE_CARGO_TRANSFER: "Pre-Cargo Transfer",
  ENCLOSED_SPACE_ENTRY: "Enclosed Space Entry",
  HOT_WORK: "Hot Work",
  PILOT_BOARDING: "Pilot Boarding",
  ANCHOR: "Fondeo",
  MOORING: "Amarre",
  OTHER: "Otro",
};

const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "En curso", COMPLETED: "Completado", CANCELLED: "Cancelado",
};
const STATUS_COLOR: Record<string, string> = {
  IN_PROGRESS: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  COMPLETED:   "bg-success-sea/10 text-success-sea border-success-sea/30",
  CANCELLED:   "bg-white/5 text-text-industrial/50 border-white/10",
};

const RESPONSE_LABEL: Record<string, string> = {
  PENDING: "Pendiente", CONFORMING: "Conforme", NOT_CONFORMING: "No conforme", NOT_APPLICABLE: "N/A",
};

interface Template {
  id: string;
  tenantId: string | null;
  type: string;
  name: string;
  description: string | null;
  itemsJson: Array<{ code: string; text: string; isMandatory?: boolean; category?: string }>;
  isActive: boolean;
  // Aprobación formal del procedimiento. Si se edita una plantilla aprobada,
  // el sistema sugiere abrir un MOC PROCEDURE_CHANGE.
  approvedAt: string | null;
  approvedByUserId: string | null;
}

interface Response {
  id: string;
  itemCode: string;
  itemText: string;
  status: string;
  notes: string | null;
  reportedByName: string | null;
}

interface Execution {
  id: string;
  executionCode: string;
  vesselCode: string;
  templateId: string;
  templateName?: string | null;
  type: string;
  status: string;
  eventDateTime: string;
  port: string | null;
  voyageRef: string | null;
  performedByName: string | null;
  signedByName: string | null;
  signedAt: string | null;
  notes: string | null;
  totalItems: number;
  conformingItems: number;
  notConformingItems: number;
  responses?: Response[];
  template?: Template;
}

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1.5";

// ─── Execution modal (con responses inline) ──────────────────────────────────

const ExecutionModal: React.FC<{ executionId: string | null; onCreate?: { templateId: string; vesselCode: string }; onClose: () => void; onSaved: () => void }> = ({ executionId, onCreate, onClose, onSaved }) => {
  const t = useT();
  const { vessels } = useVesselContext();
  const { user } = useAuth();
  const isAdmin = user?.role === "TENANT_ADMIN";
  const [exec, setExec] = useState<Execution | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Para creación
  const { data: templatesData } = useFetch<{ items: Template[] }>("/app/checklist-templates");
  const [templateId, setTemplateId]   = useState(onCreate?.templateId ?? "");
  const [vesselCode, setVesselCode]   = useState(onCreate?.vesselCode ?? vessels[0]?.code ?? "");
  const [eventDateTime, setEventDT]   = useState(new Date().toISOString().slice(0, 16));
  const [port, setPort]               = useState("");
  const [voyageRef, setVoyageRef]     = useState("");
  const [performedBy, setPerformedBy] = useState("");

  // Para edición
  const [signedByName, setSignedBy]   = useState("");
  const [notes, setNotes]             = useState("");

  const reload = useCallback(async () => {
    if (!executionId) return;
    setLoading(true);
    try {
      const r = await api.get<Execution>(`/app/checklist-executions/${executionId}`);
      setExec(r);
      setSignedBy(r.signedByName ?? "");
      setNotes(r.notes ?? "");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error"); }
    finally { setLoading(false); }
  }, [executionId]);

  useEffect(() => { void reload(); }, [reload]);

  const handleCreate = async () => {
    if (!templateId || !vesselCode) { setErr("Vessel y template requeridos."); return; }
    setSaving(true); setErr(null);
    try {
      await api.post("/app/checklist-executions", {
        vesselCode, templateId,
        eventDateTime: new Date(eventDateTime).toISOString(),
        port: port.trim() || null,
        voyageRef: voyageRef.trim() || null,
        performedByName: performedBy.trim() || null,
      });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error al crear."); }
    finally { setSaving(false); }
  };

  const setResponse = async (itemCode: string, status: string, notesValue?: string) => {
    if (!exec) return;
    try {
      await api.post(`/app/checklist-executions/${exec.id}/responses`, {
        itemCode, status, notes: notesValue ?? null,
      });
      await reload();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
  };

  const complete = async () => {
    if (!exec) return;
    const pendingMandatory = (exec.responses ?? []).filter(r => {
      const item = exec.template?.itemsJson.find(i => i.code === r.itemCode);
      return item?.isMandatory && r.status === "PENDING";
    });
    if (pendingMandatory.length > 0) {
      setErr(`Faltan ${pendingMandatory.length} ítem(s) obligatorio(s) por responder.`);
      return;
    }
    setSaving(true); setErr(null);
    try {
      await api.patch(`/app/checklist-executions/${exec.id}`, {
        status: "COMPLETED",
        signedByName: signedByName.trim() || null,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setSaving(false); }
  };

  const cancel = async () => {
    if (!exec) return;
    if (!window.confirm(t("confirm.cancelChecklist"))) return;
    try {
      await api.patch(`/app/checklist-executions/${exec.id}`, { status: "CANCELLED" });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
  };

  const onDelete = async () => {
    if (!exec || !isAdmin) return;
    if (!window.confirm(t("confirm.deleteNamed").replace("{code}", exec.executionCode))) return;
    try { await api.delete(`/app/checklist-executions/${exec.id}`); onSaved(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
  };

  const saveMeta = async () => {
    if (!exec) return;
    setSaving(true); setErr(null);
    try {
      await api.patch(`/app/checklist-executions/${exec.id}`, {
        notes: notes.trim() || null,
        signedByName: signedByName.trim() || null,
      });
      await reload();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setSaving(false); }
  };

  const isCreating = !executionId;
  const isLocked = exec?.status !== "IN_PROGRESS";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#0D1B2A] border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <ListChecks className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Checklist</p>
              <h2 className="text-sm font-bold text-white">{isCreating ? "Nuevo checklist" : exec?.executionCode}</h2>
            </div>
            {exec && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${STATUS_COLOR[exec.status]}`}>
                {STATUS_LABEL[exec.status]}
              </span>
            )}
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
          ) : isCreating ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Vessel *</label>
                  <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={inputCls}>
                    {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
                  </select>
                </div>
                <div><label className={labelCls}>Template *</label>
                  <select value={templateId} onChange={e => setTemplateId(e.target.value)} className={inputCls}>
                    <option value="">— Seleccionar —</option>
                    {(templatesData?.items ?? []).map(t => <option key={t.id} value={t.id}>{TYPE_LABEL[t.type]} — {t.name}</option>)}
                  </select>
                </div>
                <div><label className={labelCls}>Fecha/hora *</label>
                  <input type="datetime-local" value={eventDateTime} onChange={e => setEventDT(e.target.value)} className={inputCls} />
                </div>
                <div><label className={labelCls}>Puerto</label>
                  <input value={port} onChange={e => setPort(e.target.value)} className={inputCls} />
                </div>
                <div><label className={labelCls}>Voyage ref</label>
                  <input value={voyageRef} onChange={e => setVoyageRef(e.target.value)} className={inputCls} />
                </div>
                <div><label className={labelCls}>Realizado por</label>
                  <input value={performedBy} onChange={e => setPerformedBy(e.target.value)} className={inputCls} />
                </div>
              </div>
            </div>
          ) : exec ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                  <p className="text-[9px] uppercase tracking-wider text-text-industrial/40">Tipo</p>
                  <p className="text-xs font-bold text-white">{TYPE_LABEL[exec.type] ?? exec.type}</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                  <p className="text-[9px] uppercase tracking-wider text-text-industrial/40">Fecha</p>
                  <p className="text-xs font-bold text-white">{new Date(exec.eventDateTime).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                  <p className="text-[9px] uppercase tracking-wider text-text-industrial/40">Puerto</p>
                  <p className="text-xs font-bold text-white">{exec.port ?? "—"}</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                  <p className="text-[9px] uppercase tracking-wider text-text-industrial/40">Vessel</p>
                  <VesselLabel code={exec.vesselCode} className="text-xs" showCode />
                </div>
              </div>

              {/* Lista de items */}
              <div className="space-y-1.5">
                <p className={labelCls}>Ítems ({exec.responses?.length ?? 0})</p>
                <div className="space-y-1">
                  {(exec.responses ?? []).map(r => {
                    const item = exec.template?.itemsJson.find(i => i.code === r.itemCode);
                    return (
                      <ResponseRow
                        key={r.id}
                        response={r}
                        isMandatory={!!item?.isMandatory}
                        category={item?.category}
                        disabled={isLocked}
                        onSet={(status, notes) => { void setResponse(r.itemCode, status, notes); }}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Firmado por</label>
                  <input value={signedByName} onChange={e => setSignedBy(e.target.value)} disabled={isLocked} className={inputCls} placeholder="Capitán / responsable" />
                </div>
                <div><label className={labelCls}>Firmado el</label>
                  <input value={exec.signedAt ? new Date(exec.signedAt).toLocaleString("es-AR") : ""} disabled className={inputCls} />
                </div>
                <div className="col-span-2"><label className={labelCls}>Notas</label>
                  <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} disabled={isLocked} className={inputCls + " resize-y"} />
                </div>
              </div>
            </div>
          ) : null}

          {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t border-white/10 shrink-0">
          <div className="flex gap-2">
            {!isCreating && exec?.status === "IN_PROGRESS" && (
              <button onClick={() => { void cancel(); }} className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs hover:bg-red-500/20">Cancelar checklist</button>
            )}
            {!isCreating && isAdmin && (
              <button onClick={() => { void onDelete(); }} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-text-industrial/60 text-xs hover:text-red-400">Eliminar</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white">Cerrar</button>
            {isCreating ? (
              <button onClick={() => { void handleCreate(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Crear"}
              </button>
            ) : exec?.status === "IN_PROGRESS" && (
              <>
                <button onClick={() => { void saveMeta(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white disabled:opacity-50">
                  Guardar
                </button>
                <button onClick={() => { void complete(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-success-sea text-primary-bg font-bold text-xs disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Completar y firmar"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ResponseRow: React.FC<{ response: Response; isMandatory: boolean; category?: string; disabled: boolean; onSet: (status: string, notes?: string) => void }> = ({ response, isMandatory, category, disabled, onSet }) => {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(response.notes ?? "");

  const statusBtn = (status: string, Icon: React.FC<{ className?: string }>, color: string, title: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSet(status, response.notes ?? undefined)}
      title={title}
      className={`p-1.5 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${response.status === status ? color : "bg-white/5 text-text-industrial/40 border-white/10 hover:text-white"}`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className={`bg-white/[0.03] border rounded-lg p-2 ${response.status === "NOT_CONFORMING" ? "border-red-500/30 bg-red-500/[0.04]" : "border-white/10"}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <span className="text-[10px] font-mono text-accent">{response.itemCode}</span>
            {isMandatory && <span className="text-[9px] font-bold text-red-400 uppercase">*</span>}
            {category && <span className="text-[9px] text-text-industrial/40 uppercase">{category}</span>}
          </div>
          <p className="text-xs text-white">{response.itemText}</p>
          {response.notes && !editingNotes && (
            <p className="text-[10px] text-text-industrial/60 mt-0.5">📝 {response.notes}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {statusBtn("CONFORMING", CheckCircle2, "bg-success-sea/15 text-success-sea border-success-sea/40", "Conforme")}
          {statusBtn("NOT_CONFORMING", XCircle, "bg-red-500/15 text-red-400 border-red-500/40", "No conforme")}
          {statusBtn("NOT_APPLICABLE", MinusCircle, "bg-white/10 text-text-industrial/60 border-white/20", "N/A")}
        </div>
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={() => setEditingNotes(v => !v)}
          className="text-[10px] text-accent hover:underline mt-1"
        >
          {editingNotes ? "Cerrar nota" : response.notes ? "Editar nota" : "+ Agregar nota"}
        </button>
      )}
      {editingNotes && (
        <div className="mt-1 flex gap-2">
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Observación, evidencia…"
            className={inputCls + " text-xs"}
          />
          <button
            onClick={() => { onSet(response.status, notes); setEditingNotes(false); }}
            className="px-2 py-1 rounded bg-accent text-primary-bg text-[10px] font-bold"
          >Guardar</button>
        </div>
      )}
    </div>
  );
};

// ─── Templates modal ─────────────────────────────────────────────────────────

const TemplatesModal: React.FC<{ onClose: () => void; onMocTrigger?: (e: MocTriggerEvent) => void }> = ({ onClose, onMocTrigger }) => {
  const { data, loading, reload } = useFetch<{ items: Template[] }>("/app/checklist-templates");
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] bg-[#0D1B2A] border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-bold text-white">Templates de checklists</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowNew(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-primary-bg text-xs font-bold"><Plus className="w-3.5 h-3.5" /> Nuevo</button>
            <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-6">
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-accent mx-auto" />
            : (data?.items ?? []).length === 0 ? <p className="text-xs text-text-industrial/40 text-center py-6">Sin templates. Creá el primero.</p>
            : (
              <div className="space-y-2">
                {data!.items.map(t => (
                  <button key={t.id} onClick={() => setEditing(t)} className="w-full text-left bg-white/5 border border-white/10 rounded-xl px-4 py-2 hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-accent">{TYPE_LABEL[t.type]}</span>
                      <span className="text-xs font-bold text-white">{t.name}</span>
                      {t.approvedAt && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full border font-bold bg-success-sea/10 text-success-sea border-success-sea/30 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Aprobada
                        </span>
                      )}
                      <span className="text-[10px] text-text-industrial/40 ml-auto">{(t.itemsJson ?? []).length} ítems</span>
                      {t.tenantId === null && <span className="text-[9px] text-text-industrial/40 uppercase">global</span>}
                    </div>
                    {t.description && <p className="text-[10px] text-text-industrial/50 mt-0.5">{t.description}</p>}
                  </button>
                ))}
              </div>
            )
          }
        </div>
        {(showNew || editing) && (
          <TemplateEditor
            template={editing}
            onClose={() => { setShowNew(false); setEditing(null); }}
            onSaved={() => { setShowNew(false); setEditing(null); void reload(); }}
            onMocTrigger={onMocTrigger}
          />
        )}
      </div>
    </div>
  );
};

const TemplateEditor: React.FC<{ template: Template | null; onClose: () => void; onSaved: () => void; onMocTrigger?: (e: MocTriggerEvent) => void }> = ({ template, onClose, onSaved, onMocTrigger }) => {
  const isNew = !template;
  const [type, setType]         = useState(template?.type ?? "PRE_ARRIVAL");
  const [name, setName]         = useState(template?.name ?? "");
  const [description, setDesc]  = useState(template?.description ?? "");
  const [items, setItems]       = useState(template?.itemsJson ?? [{ code: "1", text: "", isMandatory: true }]);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const isApproved = !!template?.approvedAt;

  const addItem = () => setItems(prev => [...prev, { code: String(prev.length + 1), text: "", isMandatory: false }]);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const updateItem = (i: number, patch: Partial<typeof items[number]>) => {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  };

  // Hay cambios sobre la plantilla original (solo aplica en edición).
  const hasMeaningfulChanges = !isNew && template && (
    template.name !== name ||
    (template.description ?? "") !== description ||
    template.type !== type ||
    JSON.stringify(template.itemsJson ?? []) !== JSON.stringify(items)
  );

  const onSave = async () => {
    setSaving(true); setErr(null);
    try {
      const filtered = items.filter(i => i.code && i.text.trim());
      if (filtered.length === 0) { setErr("Agregá al menos 1 ítem con código y texto."); setSaving(false); return; }
      const payload = { type, name, description: description || null, items: filtered };
      if (isNew) await api.post("/app/checklist-templates", payload);
      else await api.patch(`/app/checklist-templates/${template!.id}`, payload);

      // Detector MOC PROCEDURE_CHANGE: si una plantilla aprobada se edita en
      // su contenido sustantivo (nombre, descripción, tipo o ítems), el cambio
      // debe pasar por Management of Change. El permitir un MOC posterior a
      // un save es no bloqueante (el cambio ya quedó persistido).
      if (onMocTrigger && isApproved && hasMeaningfulChanges) {
        onMocTrigger({
          reason: "procedureChange",
          prefill: {
            category: "PROCEDURE_CHANGE",
            title: `Modificación de plantilla aprobada: ${name}`,
            reasonForChange: `Se modificó la plantilla de checklist "${name}" (tipo ${TYPE_LABEL[type] ?? type}), aprobada el ${fmtDate(template!.approvedAt)}.`,
            proposedChange: `Cambios aplicados al procedimiento. Total de ítems: ${filtered.length}.`,
            sourceLabel: `Desde Checklists · Plantilla ${name}`,
          },
        });
      }

      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setSaving(false); }
  };

  // Aprobar / revocar aprobación. Es una mutación rápida sobre la plantilla
  // existente — no aplica en creación (hay que guardarla primero).
  const onToggleApproval = async () => {
    if (isNew || !template) return;
    setApproving(true); setErr(null);
    try {
      await api.patch(`/app/checklist-templates/${template.id}`, { approved: !isApproved });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error al cambiar estado de aprobación."); }
    finally { setApproving(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] bg-[#0D1B2A] border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-sm font-bold text-white">{isNew ? "Nuevo template" : "Editar template"}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-6 space-y-3">
          {!isNew && (
            <div className={`rounded-xl border px-3 py-2 flex items-center gap-3 ${isApproved ? "bg-success-sea/5 border-success-sea/30" : "bg-yellow-500/5 border-yellow-500/20"}`}>
              {isApproved
                ? <CheckCircle2 className="w-4 h-4 text-success-sea shrink-0" />
                : <MinusCircle className="w-4 h-4 text-yellow-400 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-bold ${isApproved ? "text-success-sea" : "text-yellow-300"}`}>
                  {isApproved ? "Procedimiento aprobado" : "Pendiente de aprobación"}
                </p>
                <p className="text-[10px] text-text-industrial/60 truncate">
                  {isApproved
                    ? `Aprobado el ${fmtDate(template!.approvedAt)}. Editar esta plantilla disparará un MOC PROCEDURE_CHANGE.`
                    : "Los cambios no requieren MOC mientras la plantilla no esté aprobada formalmente."}
                </p>
              </div>
              <button
                onClick={() => { void onToggleApproval(); }}
                disabled={approving}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border disabled:opacity-50 ${
                  isApproved
                    ? "bg-white/5 border-white/10 text-text-industrial/70 hover:bg-white/10"
                    : "bg-success-sea/10 border-success-sea/30 text-success-sea hover:bg-success-sea/20"
                }`}
              >
                {approving ? <Loader2 className="w-3 h-3 animate-spin" /> : (isApproved ? "Revocar aprobación" : "Aprobar")}
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Tipo</label>
              <select value={type} onChange={e => setType(e.target.value)} className={inputCls}>
                {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Nombre *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Pre-Arrival General" className={inputCls} />
            </div>
            <div className="col-span-2"><label className={labelCls}>Descripción</label>
              <textarea rows={2} value={description} onChange={e => setDesc(e.target.value)} className={inputCls + " resize-y"} />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className={labelCls + " mb-0"}>Ítems ({items.length})</p>
              <button onClick={addItem} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[10px] font-bold uppercase tracking-wider hover:bg-accent/20"><Plus className="w-3 h-3" /> Agregar</button>
            </div>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-1.5 items-start bg-white/[0.03] border border-white/10 rounded-lg p-2">
                <input value={it.code} onChange={e => updateItem(i, { code: e.target.value })} placeholder="Código" className={inputCls + " col-span-2 text-xs"} />
                <input value={it.text} onChange={e => updateItem(i, { text: e.target.value })} placeholder="Texto del ítem" className={inputCls + " col-span-6 text-xs"} />
                <input value={it.category ?? ""} onChange={e => updateItem(i, { category: e.target.value })} placeholder="Categoría" className={inputCls + " col-span-2 text-xs"} />
                <label className="col-span-1 flex items-center gap-1 text-[10px] text-white"><input type="checkbox" checked={!!it.isMandatory} onChange={e => updateItem(i, { isMandatory: e.target.checked })} /> Obl.</label>
                <button onClick={() => removeItem(i)} className="col-span-1 p-1 text-text-industrial/40 hover:text-red-400"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial">Cancelar</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

export const ChecklistsPage: React.FC = () => {
  const [filterStatus, setFilterStatus] = useState<"all" | "open">("open");
  const { data, loading, reload } = useFetch<{ items: Execution[] }>("/app/checklist-executions");
  const [showCreate, setShowCreate] = useState(false);
  const [openId, setOpenId]         = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const mocTrigger = useMocTrigger();

  const items = useMemo(() => {
    const all = data?.items ?? [];
    return filterStatus === "open" ? all.filter(e => e.status === "IN_PROGRESS") : all;
  }, [data, filterStatus]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={ListChecks} title="Checklists" total={items.length} onReload={reload}>
        <button onClick={() => setShowTemplates(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30">
          <Settings className="w-3.5 h-3.5 text-accent" /> Templates
        </button>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110">
          <Plus className="w-3.5 h-3.5" /> Nuevo checklist
        </button>
      </PageHeader>

      <div className="flex gap-2">
        {([["open", "En curso"], ["all", "Todos"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilterStatus(v)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${
              filterStatus === v ? "bg-accent/15 text-accent border-accent/40" : "bg-white/5 text-text-industrial/60 border-white/10"
            }`}>{l}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">Sin checklists. Creá uno desde un template.</div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">
          {items.map(e => (
            <button key={e.id} onClick={() => setOpenId(e.id)} className="w-full text-left p-4 hover:bg-white/5 transition-colors flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[10px] font-mono text-text-industrial/40">{e.executionCode}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full border font-bold bg-white/5 text-white border-white/10">
                    {TYPE_LABEL[e.type] ?? e.type}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${STATUS_COLOR[e.status]}`}>
                    {STATUS_LABEL[e.status]}
                  </span>
                  <VesselLabel code={e.vesselCode} className="text-[10px]" showCode />
                </div>
                <p className="text-sm font-bold text-white">{e.templateName ?? "—"}{e.port ? ` · ${e.port}` : ""}</p>
                <p className="text-[10px] text-text-industrial/40">{e.performedByName ?? "—"}{e.notConformingItems > 0 ? ` · ${e.notConformingItems} no conformes` : ""}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-white font-mono">{fmtDate(e.eventDateTime)}</p>
                <p className="text-[10px] text-text-industrial/40">{e.conformingItems}/{e.totalItems} OK</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {(showCreate || openId) && (
        <ExecutionModal
          executionId={openId}
          onClose={() => { setShowCreate(false); setOpenId(null); }}
          onSaved={() => { setShowCreate(false); setOpenId(null); void reload(); }}
        />
      )}
      {showTemplates && <TemplatesModal onClose={() => setShowTemplates(false)} onMocTrigger={mocTrigger.ask} />}

      <MocTriggerHost controller={mocTrigger} />
    </div>
  );
};
