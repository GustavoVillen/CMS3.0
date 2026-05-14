// SIRE 2.0 Ch. 4 — Near Miss / Hazard Observation reporting.

import React, { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Plus, Loader2, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { VesselLabel } from "../components/EntityLabels";
import { fmtDate } from "../lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  NEAR_MISS: "Near miss",
  HAZARD_OBSERVATION: "Observación de riesgo",
  UNSAFE_ACT: "Acción insegura",
  UNSAFE_CONDITION: "Condición insegura",
};

const SEVERITY_LABEL: Record<string, string> = {
  LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica",
};

const SEVERITY_COLOR: Record<string, string> = {
  LOW:      "bg-blue-500/10 text-blue-400 border-blue-500/30",
  MEDIUM:   "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  HIGH:     "bg-orange-500/10 text-orange-400 border-orange-500/30",
  CRITICAL: "bg-red-500/10 text-red-400 border-red-500/30",
};

const STATUS_LABEL: Record<string, string> = {
  REPORTED: "Reportado",
  UNDER_REVIEW: "En revisión",
  ACTIONED: "Accionado",
  CLOSED: "Cerrado",
};

const STATUS_COLOR: Record<string, string> = {
  REPORTED:     "bg-blue-500/10 text-blue-400 border-blue-500/30",
  UNDER_REVIEW: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  ACTIONED:     "bg-accent/10 text-accent border-accent/30",
  CLOSED:       "bg-success-sea/10 text-success-sea border-success-sea/30",
};

interface NearMiss {
  id: string;
  nearMissCode: string;
  vesselCode: string;
  category: string;
  severity: string;
  status: string;
  occurredAt: string;
  location: string | null;
  description: string;
  immediateAction: string | null;
  rootCause: string | null;
  preventiveActions: string | null;
  lessonsLearned: string | null;
  reportedByName: string | null;
}

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1.5";

const NearMissModal: React.FC<{ record: NearMiss | null; onClose: () => void; onSaved: () => void }> = ({ record, onClose, onSaved }) => {
  const { vessels } = useVesselContext();
  const isNew = !record;

  const [vesselCode, setVesselCode] = useState(record?.vesselCode ?? vessels[0]?.code ?? "");
  const [category, setCategory]     = useState(record?.category ?? "NEAR_MISS");
  const [severity, setSeverity]     = useState(record?.severity ?? "MEDIUM");
  const [status, setStatus]         = useState(record?.status ?? "REPORTED");
  const [occurredAt, setOccurred]   = useState((record?.occurredAt ?? new Date().toISOString()).slice(0, 16));
  const [location, setLocation]     = useState(record?.location ?? "");
  const [description, setDescription] = useState(record?.description ?? "");
  const [immediateAction, setIA]    = useState(record?.immediateAction ?? "");
  const [rootCause, setRoot]        = useState(record?.rootCause ?? "");
  const [preventiveActions, setPA]  = useState(record?.preventiveActions ?? "");
  const [lessonsLearned, setLL]     = useState(record?.lessonsLearned ?? "");
  const [reportedByName, setRBN]    = useState(record?.reportedByName ?? "");
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (!vesselCode || !category || !description.trim()) {
      setErr("Vessel, categoría y descripción son requeridos."); return;
    }
    setSaving(true); setErr(null);
    try {
      const payload = {
        vesselCode, category, severity, status,
        occurredAt: new Date(occurredAt).toISOString(),
        location: location.trim() || null,
        description: description.trim(),
        immediateAction: immediateAction.trim() || null,
        rootCause: rootCause.trim() || null,
        preventiveActions: preventiveActions.trim() || null,
        lessonsLearned: lessonsLearned.trim() || null,
        reportedByName: reportedByName.trim() || null,
      };
      if (isNew) await api.post("/app/near-miss", payload);
      else await api.patch(`/app/near-miss/${record!.id}`, payload);
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error al guardar."); }
    finally { setSaving(false); }
  }, [isNew, record, vesselCode, category, severity, status, occurredAt, location, description, immediateAction, rootCause, preventiveActions, lessonsLearned, reportedByName, onSaved]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] bg-[#0D1B2A] border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Near Miss / Riesgo</p>
              <h2 className="text-sm font-bold text-white">{isNew ? "Nuevo reporte" : record!.nearMissCode}</h2>
            </div>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Vessel *</label>
              <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={!isNew} className={inputCls}>
                {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Categoría *</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className={inputCls}>
                {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Severidad</label>
              <select value={severity} onChange={e => setSeverity(e.target.value)} className={inputCls}>
                {Object.entries(SEVERITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Estado</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
                {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Fecha/hora *</label>
              <input type="datetime-local" value={occurredAt} onChange={e => setOccurred(e.target.value)} className={inputCls} />
            </div>
            <div><label className={labelCls}>Lugar</label>
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Sala de máquinas, cubierta…" className={inputCls} />
            </div>
            <div className="col-span-2"><label className={labelCls}>Reportado por</label>
              <input value={reportedByName} onChange={e => setRBN(e.target.value)} placeholder="Nombre o cargo" className={inputCls} />
            </div>
            <div className="col-span-2"><label className={labelCls}>Descripción *</label>
              <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Qué pasó y qué pudo haber pasado…" className={inputCls + " resize-y"} />
            </div>
            <div className="col-span-2"><label className={labelCls}>Acción inmediata</label>
              <textarea rows={2} value={immediateAction} onChange={e => setIA(e.target.value)} className={inputCls + " resize-y"} />
            </div>
            <div className="col-span-2"><label className={labelCls}>Causa raíz</label>
              <textarea rows={2} value={rootCause} onChange={e => setRoot(e.target.value)} className={inputCls + " resize-y"} />
            </div>
            <div className="col-span-2"><label className={labelCls}>Acciones preventivas</label>
              <textarea rows={2} value={preventiveActions} onChange={e => setPA(e.target.value)} className={inputCls + " resize-y"} />
            </div>
            <div className="col-span-2"><label className={labelCls}>Lecciones aprendidas</label>
              <textarea rows={2} value={lessonsLearned} onChange={e => setLL(e.target.value)} className={inputCls + " resize-y"} />
            </div>
          </div>
          {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white">Cerrar</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const NearMissPage: React.FC = () => {
  const [filterStatus, setFilterStatus] = useState<"all" | "open">("open");
  const { data, loading, reload } = useFetch<{ items: NearMiss[] }>("/app/near-miss");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<NearMiss | null>(null);

  const items = useMemo(() => {
    const all = data?.items ?? [];
    if (filterStatus === "open") return all.filter(n => n.status !== "CLOSED");
    return all;
  }, [data, filterStatus]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={AlertTriangle} title="Near Miss / Observaciones de Riesgo" total={items.length} onReload={reload}>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110">
          <Plus className="w-3.5 h-3.5" /> Nuevo reporte
        </button>
      </PageHeader>

      <div className="flex gap-2">
        {([["open", "Abiertos"], ["all", "Todos"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilterStatus(v)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
              filterStatus === v ? "bg-accent/15 text-accent border-accent/40" : "bg-white/5 text-text-industrial/60 border-white/10"
            }`}
          >{l}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">Sin reportes.</div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">
          {items.map(n => (
            <button key={n.id} onClick={() => setEditing(n)} className="w-full text-left p-4 hover:bg-white/5 transition-colors flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[10px] font-mono text-text-industrial/40">{n.nearMissCode}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full border font-bold bg-white/5 text-white border-white/10">
                    {CATEGORY_LABEL[n.category] ?? n.category}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${SEVERITY_COLOR[n.severity]}`}>
                    {SEVERITY_LABEL[n.severity]}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${STATUS_COLOR[n.status]}`}>
                    {STATUS_LABEL[n.status]}
                  </span>
                  <VesselLabel code={n.vesselCode} className="text-[10px]" showCode />
                </div>
                <p className="text-sm text-white line-clamp-2">{n.description}</p>
                {n.location && <p className="text-[10px] text-text-industrial/50 mt-0.5">📍 {n.location}</p>}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-white font-mono">{fmtDate(n.occurredAt)}</p>
                {n.reportedByName && <p className="text-[10px] text-text-industrial/40">{n.reportedByName}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {(showCreate || editing) && (
        <NearMissModal
          record={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
};
