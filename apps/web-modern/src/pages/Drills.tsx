import React, { useState, useMemo, useCallback } from "react";
import { CalendarCheck, Plus, X, Loader2, AlertTriangle } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";

interface Drill {
  id: string;
  tenantId: string;
  vesselCode: string;
  drillCode: string;
  type: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  scheduledDate: string;
  completedDate: string | null;
  scenario: string | null;
  observations: string | null;
  lessonsLearned: string | null;
  participantCrewIds: string[];
  pdfUrl: string | null;
}

interface CrewItem {
  id: string;
  vesselCode: string;
  firstName: string;
  lastName: string;
  rank: string;
  status: string;
}

const DRILL_TYPE_LABEL: Record<string, string> = {
  FIRE: "Incendio",
  ABANDON_SHIP: "Abandono de buque",
  ENCLOSED_SPACE: "Espacios confinados",
  MAN_OVERBOARD: "Hombre al agua",
  POLLUTION: "Contaminación",
  SECURITY: "Seguridad (ISPS)",
  MEDICAL: "Médico",
  STEERING_GEAR: "Gobierno de emergencia",
  BLACKOUT: "Blackout",
  OIL_SPILL: "Derrame de combustible",
  OTHER: "Otro",
};

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Programado",
  COMPLETED: "Realizado",
  CANCELLED: "Cancelado",
};

const STATUS_COLOR: Record<string, string> = {
  SCHEDULED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  COMPLETED: "bg-success-sea/10 text-success-sea border-success-sea/20",
  CANCELLED: "bg-white/5 text-text-industrial/50 border-white/10",
};

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider mb-1";

// ─── Drill Modal ─────────────────────────────────────────────────────────────

const DrillModal: React.FC<{ drill: Drill | null; onClose: () => void; onSaved: () => void }> = ({ drill, onClose, onSaved }) => {
  const { vessels } = useVesselContext();
  const { user } = useAuth();
  const isAdmin = user?.role === "TENANT_ADMIN";
  const isNew = !drill;
  const isLocked = drill?.status === "COMPLETED" || drill?.status === "CANCELLED";

  const [vesselCode, setVesselCode]     = useState(drill?.vesselCode ?? vessels[0]?.code ?? "");
  const [type, setType]                 = useState(drill?.type ?? "FIRE");
  const [scheduledDate, setScheduled]   = useState((drill?.scheduledDate ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [scenario, setScenario]         = useState(drill?.scenario ?? "");
  const [observations, setObservations] = useState(drill?.observations ?? "");
  const [lessonsLearned, setLessons]    = useState(drill?.lessonsLearned ?? "");
  const [participants, setParticipants] = useState<string[]>(drill?.participantCrewIds ?? []);

  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  // Crew list para selección de participantes
  const { data: crewData } = useFetch<{ items: CrewItem[] }>(`/app/crew?status=ONBOARD${vesselCode ? `&vesselCode=${vesselCode}` : ""}`, [vesselCode]);
  const availableCrew = crewData?.items ?? [];

  const toggleParticipant = (id: string) => {
    setParticipants(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  };

  const onSave = useCallback(async () => {
    if (!vesselCode || !type || !scheduledDate) {
      setErr("Completá vessel, tipo y fecha."); return;
    }
    setSaving(true); setErr(null);
    try {
      const payload = {
        vesselCode, type, scheduledDate,
        scenario: scenario.trim() || null,
        observations: observations.trim() || null,
        lessonsLearned: lessonsLearned.trim() || null,
        participantCrewIds: participants,
      };
      if (isNew) await api.post("/app/drills", payload);
      else await api.patch(`/app/drills/${drill!.id}`, payload);
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error al guardar."); }
    finally { setSaving(false); }
  }, [isNew, drill, vesselCode, type, scheduledDate, scenario, observations, lessonsLearned, participants, onSaved]);

  const onComplete = useCallback(async () => {
    if (!drill) return;
    if (!confirm("¿Marcar este simulacro como realizado?")) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/drills/${drill.id}/complete`, {
        completedDate: new Date().toISOString().slice(0, 10),
        observations: observations.trim() || null,
        lessonsLearned: lessonsLearned.trim() || null,
        participantCrewIds: participants,
      });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error al completar."); }
    finally { setSaving(false); }
  }, [drill, observations, lessonsLearned, participants, onSaved]);

  const onReopen = useCallback(async () => {
    if (!drill) return;
    const reason = prompt("Motivo de re-apertura (mín. 5 caracteres):");
    if (!reason || reason.trim().length < 5) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/drills/${drill.id}/reopen`, { reason: reason.trim() });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error al re-abrir."); }
    finally { setSaving(false); }
  }, [drill, onSaved]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] bg-[#0D1B2A] border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <CalendarCheck className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Simulacro</p>
              <h2 className="text-sm font-bold text-white">{isNew ? "Nuevo simulacro" : drill!.drillCode}</h2>
            </div>
            {drill && <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold ${STATUS_COLOR[drill.status]}`}>{STATUS_LABEL[drill.status]}</span>}
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          {isLocked && (
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
              <p className="text-xs text-orange-200">Este simulacro está {STATUS_LABEL[drill!.status]}. Para editarlo, un administrador debe re-abrirlo con justificación.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Vessel</label>
              <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={!isNew || isLocked} className={inputCls}>
                {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Tipo</label>
              <select value={type} onChange={e => setType(e.target.value)} disabled={isLocked} className={inputCls}>
                {Object.entries(DRILL_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Fecha programada</label>
              <input type="date" value={scheduledDate} onChange={e => setScheduled(e.target.value)} disabled={isLocked} className={inputCls} />
            </div>
            {drill?.completedDate && (
              <div>
                <label className={labelCls}>Realizado</label>
                <input type="date" value={drill.completedDate.slice(0, 10)} disabled className={inputCls} />
              </div>
            )}
            <div className="col-span-2">
              <label className={labelCls}>Escenario</label>
              <textarea rows={2} value={scenario} onChange={e => setScenario(e.target.value)} disabled={isLocked} className={inputCls} placeholder="Descripción del escenario del simulacro" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Observaciones</label>
              <textarea rows={3} value={observations} onChange={e => setObservations(e.target.value)} disabled={isLocked} className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Lecciones aprendidas</label>
              <textarea rows={3} value={lessonsLearned} onChange={e => setLessons(e.target.value)} disabled={isLocked} className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Participantes ({participants.length})</label>
              <div className="max-h-40 overflow-y-auto bg-white/5 border border-white/10 rounded-xl p-2 space-y-1">
                {availableCrew.length === 0 ? (
                  <p className="text-xs text-text-industrial/40 p-2">Sin tripulantes a bordo en este vessel</p>
                ) : availableCrew.map(c => (
                  <label key={c.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 cursor-pointer">
                    <input type="checkbox"
                      checked={participants.includes(c.id)}
                      onChange={() => toggleParticipant(c.id)}
                      disabled={isLocked}
                      className="rounded" />
                    <span className="text-xs text-white">{c.firstName} {c.lastName}</span>
                    <span className="text-[10px] text-text-industrial/40">{c.rank}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t border-white/10 shrink-0">
          <div className="flex gap-2">
            {!isNew && drill?.status === "SCHEDULED" && (
              <button onClick={() => { void onComplete(); }} disabled={saving}
                className="px-3 py-2 rounded-xl bg-success-sea/10 border border-success-sea/20 text-success-sea font-bold text-xs hover:bg-success-sea/20 disabled:opacity-50">
                Marcar realizado
              </button>
            )}
            {!isNew && isLocked && isAdmin && (
              <button onClick={() => { void onReopen(); }} disabled={saving}
                className="px-3 py-2 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-300 font-bold text-xs hover:bg-orange-500/20 disabled:opacity-50">
                Re-abrir
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white">Cerrar</button>
            {!isLocked && (
              <button onClick={() => { void onSave(); }} disabled={saving}
                className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50">
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

export const DrillsPage: React.FC = () => {
  const [filter, setFilter] = useState<"upcoming" | "completed" | "all">("upcoming");

  const path = useMemo(() => {
    if (filter === "upcoming") return "/app/drills?status=SCHEDULED";
    if (filter === "completed") return "/app/drills?status=COMPLETED";
    return "/app/drills";
  }, [filter]);

  const { data, loading, reload } = useFetch<{ items: Drill[]; total: number }>(path, [path]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Drill | null>(null);

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={CalendarCheck} title="Simulacros" total={data?.total} onReload={reload}>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110">
          <Plus className="w-3.5 h-3.5" /> Nuevo simulacro
        </button>
      </PageHeader>

      <div className="flex gap-2">
        {([["upcoming", "Programados"], ["completed", "Realizados"], ["all", "Todos"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
              filter === v ? "bg-accent/15 text-accent border-accent/40" : "bg-white/5 text-text-industrial/60 border-white/10"
            }`}
          >{l}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : !data?.items?.length ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">Sin simulacros</div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">
          {data.items.map(d => (
            <button key={d.id} onClick={() => setEditing(d)}
              className="w-full text-left p-4 hover:bg-white/5 active:bg-white/10 transition-colors flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[10px] font-mono text-text-industrial/40">{d.drillCode}</span>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold ${STATUS_COLOR[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                  <span className="text-[10px] text-accent font-mono">{d.vesselCode}</span>
                </div>
                <p className="text-sm font-bold text-white">{DRILL_TYPE_LABEL[d.type] ?? d.type}</p>
                {d.scenario && <p className="text-xs text-text-industrial/50 truncate">{d.scenario}</p>}
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] text-text-industrial/40">{d.status === "COMPLETED" ? "Realizado" : "Programado"}</p>
                <p className="text-xs text-white font-mono">{fmtDate(d.status === "COMPLETED" ? d.completedDate : d.scheduledDate)}</p>
                <p className="text-[10px] text-text-industrial/40">{(d.participantCrewIds ?? []).length} participantes</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {(showCreate || editing) && (
        <DrillModal
          drill={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
};
