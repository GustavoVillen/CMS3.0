// Management of Change (MOC) — workflow formal de cambios significativos.

import React, { useCallback, useEffect, useState } from "react";
import { GitBranch, Plus, Loader2, X, CheckCircle2, XCircle, Clock as ClockIcon } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { VesselLabel } from "../components/EntityLabels";
import { fmtDate } from "../lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  EQUIPMENT_CHANGE: "Cambio de equipo",
  PROCEDURE_CHANGE: "Cambio de procedimiento",
  ORGANIZATIONAL: "Organizacional",
  TEMPORARY: "Cambio temporal",
  SOFTWARE_FIRMWARE: "Software / Firmware",
  OTHER: "Otro",
};

const RISK_LABEL: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Crítico" };
const RISK_COLOR: Record<string, string> = {
  LOW:      "bg-blue-500/10 text-blue-400 border-blue-500/30",
  MEDIUM:   "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  HIGH:     "bg-orange-500/10 text-orange-400 border-orange-500/30",
  CRITICAL: "bg-red-500/10 text-red-400 border-red-500/30",
};

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Solicitado",
  UNDER_ANALYSIS: "En análisis",
  APPROVED: "Aprobado",
  IN_PROGRESS: "Implementando",
  IMPLEMENTED: "Implementado",
  REVIEWED: "Revisado",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
};

const STATUS_COLOR: Record<string, string> = {
  REQUESTED:      "bg-blue-500/10 text-blue-400 border-blue-500/30",
  UNDER_ANALYSIS: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  APPROVED:       "bg-success-sea/10 text-success-sea border-success-sea/30",
  IN_PROGRESS:    "bg-accent/15 text-accent border-accent/40",
  IMPLEMENTED:    "bg-purple-500/15 text-purple-300 border-purple-500/30",
  REVIEWED:       "bg-success-sea/15 text-success-sea border-success-sea/40",
  REJECTED:       "bg-red-500/10 text-red-400 border-red-500/30",
  CANCELLED:      "bg-white/5 text-text-industrial/50 border-white/10",
};

const IMPACT_AREAS = ["Safety", "Environment", "Operational", "Crew training", "Regulatory", "Cost"];

interface Moc {
  id: string;
  mocCode: string;
  vesselCode: string;
  category: string;
  status: string;
  title: string;
  reasonForChange: string;
  proposedChange: string;
  riskLevel: string;
  impactAreasJson: string[];
  riskAssessmentNotes: string | null;
  mitigationActions: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  rejectedReason: string | null;
  plannedDate: string | null;
  implementedAt: string | null;
  implementedByName: string | null;
  implementationNotes: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  reviewOutcome: string | null;
  createdAt: string;
}

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1.5";

// ─── Modal ───────────────────────────────────────────────────────────────────

const MocModal: React.FC<{ moc: Moc | null; onClose: () => void; onSaved: () => void }> = ({ moc, onClose, onSaved }) => {
  const { vessels } = useVesselContext();
  const { user } = useAuth();
  const isNew = !moc;
  const canApprove = user?.role === "TENANT_ADMIN" || user?.role === "FLEET_SUPERINTENDENT";
  const isAdmin = user?.role === "TENANT_ADMIN";

  const [vesselCode, setVesselCode] = useState(moc?.vesselCode ?? vessels[0]?.code ?? "");
  const [category, setCategory]   = useState(moc?.category ?? "EQUIPMENT_CHANGE");
  const [title, setTitle]         = useState(moc?.title ?? "");
  const [reasonForChange, setReason]   = useState(moc?.reasonForChange ?? "");
  const [proposedChange, setProposed]  = useState(moc?.proposedChange ?? "");
  const [riskLevel, setRiskLevel] = useState(moc?.riskLevel ?? "MEDIUM");
  const [impactAreas, setImpactAreas] = useState<string[]>(moc?.impactAreasJson ?? []);
  const [riskAssessmentNotes, setRAN]  = useState(moc?.riskAssessmentNotes ?? "");
  const [mitigationActions, setMA]    = useState(moc?.mitigationActions ?? "");
  const [plannedDate, setPlanned] = useState(moc?.plannedDate?.slice(0, 10) ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleImpact = (area: string) => {
    setImpactAreas(prev => prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]);
  };

  const isLocked = moc?.status ? ["REVIEWED", "CANCELLED", "REJECTED"].includes(moc.status) : false;

  const onSave = async () => {
    if (!vesselCode || !category || !title.trim() || !reasonForChange.trim() || !proposedChange.trim()) {
      setErr("Completá vessel, tipo, título, razón y cambio propuesto."); return;
    }
    setSaving(true); setErr(null);
    try {
      const payload = {
        vesselCode, category, title, reasonForChange, proposedChange, riskLevel,
        impactAreas,
        riskAssessmentNotes: riskAssessmentNotes.trim() || null,
        mitigationActions: mitigationActions.trim() || null,
        plannedDate: plannedDate || null,
      };
      if (isNew) await api.post("/app/mocs", payload);
      else await api.patch(`/app/mocs/${moc!.id}`, payload);
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setSaving(false); }
  };

  const transition = async (nextStatus: string, extra: Record<string, unknown> = {}) => {
    if (!moc) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/mocs/${moc.id}/transition`, { status: nextStatus, ...extra });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setSaving(false); }
  };

  const askAndTransition = (nextStatus: string, field: string, label: string) => {
    const value = window.prompt(label);
    if (value === null) return;
    void transition(nextStatus, { [field]: value });
  };

  const onDelete = async () => {
    if (!moc || !isAdmin) return;
    if (!window.confirm(`¿Eliminar ${moc.mocCode}?`)) return;
    try { await api.delete(`/app/mocs/${moc.id}`); onSaved(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] bg-[#0D1B2A] border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <GitBranch className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">MOC</p>
              <h2 className="text-sm font-bold text-white">{isNew ? "Nuevo MOC" : moc!.mocCode}</h2>
            </div>
            {moc && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${STATUS_COLOR[moc.status]}`}>
                {STATUS_LABEL[moc.status]}
              </span>
            )}
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Vessel *</label>
              <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={!isNew || isLocked} className={inputCls}>
                {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Categoría *</label>
              <select value={category} onChange={e => setCategory(e.target.value)} disabled={isLocked} className={inputCls}>
                {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="col-span-2"><label className={labelCls}>Título *</label>
              <input value={title} onChange={e => setTitle(e.target.value)} disabled={isLocked} className={inputCls} />
            </div>
            <div className="col-span-2"><label className={labelCls}>Razón del cambio *</label>
              <textarea rows={2} value={reasonForChange} onChange={e => setReason(e.target.value)} disabled={isLocked} className={inputCls + " resize-y"} />
            </div>
            <div className="col-span-2"><label className={labelCls}>Cambio propuesto *</label>
              <textarea rows={2} value={proposedChange} onChange={e => setProposed(e.target.value)} disabled={isLocked} className={inputCls + " resize-y"} />
            </div>
            <div><label className={labelCls}>Riesgo</label>
              <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)} disabled={isLocked} className={inputCls}>
                {Object.entries(RISK_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Fecha planeada</label>
              <input type="date" value={plannedDate} onChange={e => setPlanned(e.target.value)} disabled={isLocked} className={inputCls} />
            </div>
            <div className="col-span-2"><label className={labelCls}>Áreas de impacto</label>
              <div className="flex flex-wrap gap-1.5">
                {IMPACT_AREAS.map(a => (
                  <button key={a} type="button" disabled={isLocked} onClick={() => toggleImpact(a)}
                    className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${
                      impactAreas.includes(a) ? "bg-accent/20 text-accent border-accent/40" : "bg-white/5 text-text-industrial/60 border-white/10"
                    }`}>{a}</button>
                ))}
              </div>
            </div>
            <div className="col-span-2"><label className={labelCls}>Notas análisis de riesgo</label>
              <textarea rows={2} value={riskAssessmentNotes} onChange={e => setRAN(e.target.value)} disabled={isLocked} className={inputCls + " resize-y"} />
            </div>
            <div className="col-span-2"><label className={labelCls}>Medidas de mitigación</label>
              <textarea rows={2} value={mitigationActions} onChange={e => setMA(e.target.value)} disabled={isLocked} className={inputCls + " resize-y"} />
            </div>
          </div>

          {moc && (
            <div className="rounded-lg bg-white/[0.04] border border-white/10 p-3 space-y-1.5 text-[11px]">
              <p className="font-bold uppercase tracking-wider text-text-industrial/50">Trazabilidad</p>
              {moc.approvedAt && <p className="text-text-industrial/70">Aprobado por {moc.approvedByName ?? "—"} el {fmtDate(moc.approvedAt)}</p>}
              {moc.rejectedReason && <p className="text-red-300">Rechazado: {moc.rejectedReason}</p>}
              {moc.implementedAt && <p className="text-text-industrial/70">Implementado el {fmtDate(moc.implementedAt)}{moc.implementedByName ? ` por ${moc.implementedByName}` : ""}.{moc.implementationNotes ? ` ${moc.implementationNotes}` : ""}</p>}
              {moc.reviewedAt && <p className="text-success-sea">Revisado el {fmtDate(moc.reviewedAt)}: {moc.reviewOutcome ?? "—"}.{moc.reviewNotes ? ` ${moc.reviewNotes}` : ""}</p>}
            </div>
          )}

          {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t border-white/10 shrink-0 flex-wrap">
          <div className="flex flex-wrap gap-2">
            {/* Transiciones según estado */}
            {moc?.status === "REQUESTED" && (
              <button onClick={() => { void transition("UNDER_ANALYSIS"); }} disabled={saving} className="px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 text-xs disabled:opacity-50">Iniciar análisis</button>
            )}
            {moc?.status === "UNDER_ANALYSIS" && canApprove && (
              <>
                <button onClick={() => askAndTransition("APPROVED", "approvedByName", "Nombre del aprobador:")} disabled={saving} className="px-3 py-2 rounded-xl bg-success-sea/10 border border-success-sea/30 text-success-sea text-xs flex items-center gap-1 disabled:opacity-50"><CheckCircle2 className="w-3.5 h-3.5" /> Aprobar</button>
                <button onClick={() => askAndTransition("REJECTED", "rejectedReason", "Motivo del rechazo:")} disabled={saving} className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-1 disabled:opacity-50"><XCircle className="w-3.5 h-3.5" /> Rechazar</button>
              </>
            )}
            {moc?.status === "APPROVED" && (
              <button onClick={() => { void transition("IN_PROGRESS"); }} disabled={saving} className="px-3 py-2 rounded-xl bg-accent/10 border border-accent/30 text-accent text-xs disabled:opacity-50">Iniciar implementación</button>
            )}
            {moc?.status === "IN_PROGRESS" && (
              <button onClick={() => askAndTransition("IMPLEMENTED", "implementationNotes", "Notas de implementación:")} disabled={saving} className="px-3 py-2 rounded-xl bg-purple-500/15 border border-purple-500/40 text-purple-300 text-xs disabled:opacity-50">Marcar implementado</button>
            )}
            {moc?.status === "IMPLEMENTED" && (
              <button onClick={() => askAndTransition("REVIEWED", "reviewOutcome", "Resultado revisión (SATISFACTORY / WITH_OBSERVATIONS):")} disabled={saving} className="px-3 py-2 rounded-xl bg-success-sea/15 border border-success-sea/40 text-success-sea text-xs flex items-center gap-1 disabled:opacity-50"><ClockIcon className="w-3.5 h-3.5" /> Revisar y cerrar</button>
            )}
            {moc && !["REVIEWED", "CANCELLED", "REJECTED"].includes(moc.status) && (
              <button onClick={() => { void transition("CANCELLED"); }} disabled={saving} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-text-industrial/60 text-xs hover:text-red-400 disabled:opacity-50">Cancelar MOC</button>
            )}
            {!isNew && isAdmin && (
              <button onClick={() => { void onDelete(); }} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-text-industrial/60 text-xs hover:text-red-400">Eliminar</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white">Cerrar</button>
            {!isLocked && (
              <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

export const MocPage: React.FC = () => {
  const [filterStatus, setFilterStatus] = useState<"all" | "open">("open");
  const { data, loading, reload } = useFetch<{ items: Moc[] }>("/app/mocs");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Moc | null>(null);

  const items = (data?.items ?? []).filter(m => filterStatus === "open" ? !["REVIEWED", "CANCELLED", "REJECTED"].includes(m.status) : true);

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={GitBranch} title="Management of Change (MOC)" total={items.length} onReload={reload}>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110">
          <Plus className="w-3.5 h-3.5" /> Nuevo MOC
        </button>
      </PageHeader>

      <div className="flex gap-2">
        {([["open", "Abiertos"], ["all", "Todos"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilterStatus(v)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${
              filterStatus === v ? "bg-accent/15 text-accent border-accent/40" : "bg-white/5 text-text-industrial/60 border-white/10"
            }`}>{l}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">Sin MOCs.</div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">
          {items.map(m => (
            <button key={m.id} onClick={() => setEditing(m)} className="w-full text-left p-4 hover:bg-white/5 transition-colors flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[10px] font-mono text-text-industrial/40">{m.mocCode}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${STATUS_COLOR[m.status]}`}>
                    {STATUS_LABEL[m.status]}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${RISK_COLOR[m.riskLevel]}`}>
                    Riesgo {RISK_LABEL[m.riskLevel]}
                  </span>
                  <VesselLabel code={m.vesselCode} className="text-[10px]" showCode />
                </div>
                <p className="text-sm font-bold text-white line-clamp-1">{m.title}</p>
                <p className="text-[10px] text-text-industrial/50 line-clamp-1">{CATEGORY_LABEL[m.category] ?? m.category} · {m.reasonForChange}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-white font-mono">{fmtDate(m.createdAt)}</p>
                {m.plannedDate && <p className="text-[10px] text-text-industrial/40">Planeado: {fmtDate(m.plannedDate)}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {(showCreate || editing) && (
        <MocModal
          moc={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
};
