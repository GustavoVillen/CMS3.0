import React, { useState, useMemo, useCallback } from "react";
import { CalendarCheck, Plus, X, Loader2, AlertTriangle, Settings, ChevronDown, ChevronRight, Sparkles, FileText, Trash2 } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { VesselLabel } from "../components/EntityLabels";
import { useCopilotEmitter } from "../lib/copilot-context";
import { printDrill } from "../lib/print-drill";

interface DrillRequirement {
  id: string;
  title: string;
  solasRegulation: string | null;
  frequencyDays: number;
  intervalLabel: string | null;
  performedBy: string[];
  applicableVesselCodes: string[];
  notes: string | null;
  enabled: boolean;
  sortOrder: number;
}

interface Drill {
  id: string;
  tenantId: string;
  vesselCode: string;
  drillCode: string;
  requirementId: string;
  requirement?: { id: string; title: string; solasRegulation: string | null } | null;
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

interface DrillPrefill { vesselCode?: string; requirementId?: string; scheduledDate?: string }

const DrillModal: React.FC<{
  drill: Drill | null;
  prefill?: DrillPrefill;
  requirements: DrillRequirement[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ drill, prefill, requirements, onClose, onSaved }) => {
  const { vessels } = useVesselContext();
  const { user } = useAuth();
  const isAdmin = user?.role === "TENANT_ADMIN";
  const isNew = !drill;
  const isLocked = drill?.status === "COMPLETED" || drill?.status === "CANCELLED";

  const [vesselCode, setVesselCode] = useState(drill?.vesselCode ?? prefill?.vesselCode ?? vessels[0]?.code ?? "");
  const initialReqId =
    drill?.requirementId ??
    prefill?.requirementId ??
    requirements.find(r => r.enabled)?.id ??
    "";
  const [requirementId, setRequirementId] = useState(initialReqId);
  const [scheduledDate, setScheduled] = useState((drill?.scheduledDate ?? "").slice(0, 10) || prefill?.scheduledDate || new Date().toISOString().slice(0, 10));
  const [scenario, setScenario] = useState(drill?.scenario ?? "");
  const [observations, setObservations] = useState(drill?.observations ?? "");
  const [lessonsLearned, setLessons] = useState(drill?.lessonsLearned ?? "");
  const [participants, setParticipants] = useState<string[]>(drill?.participantCrewIds ?? []);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadingScenario, setLoadingScenario] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Requirements aplicables al vessel seleccionado (vacío = aplica a todos)
  const availableRequirements = useMemo(() => requirements.filter(r => {
    if (!r.enabled) return false;
    if (!r.applicableVesselCodes || r.applicableVesselCodes.length === 0) return true;
    return vesselCode ? r.applicableVesselCodes.includes(vesselCode) : true;
  }), [requirements, vesselCode]);

  const currentReq = requirements.find(r => r.id === requirementId) ?? null;
  const reqTitle = currentReq?.title ?? drill?.requirement?.title ?? "—";

  const handleGeneratePdf = useCallback(async () => {
    if (!drill || generatingPdf) return;
    setGeneratingPdf(true);
    setErr(null);
    try {
      if (!isLocked) {
        try {
          await api.patch(`/app/drills/${drill.id}`, {
            requirementId, scheduledDate,
            scenario: scenario.trim() || null,
            observations: observations.trim() || null,
            lessonsLearned: lessonsLearned.trim() || null,
            participantCrewIds: participants,
          });
        } catch { /* non-blocking */ }
      }
      await printDrill({ id: drill.id, drillCode: drill.drillCode });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo generar el PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  }, [drill, generatingPdf, isLocked, requirementId, scheduledDate, scenario, observations, lessonsLearned, participants]);

  useCopilotEmitter({
    module: "DRILLS",
    screen: isNew ? "DRILL_CREATE" : "DRILL_EDIT",
    entityId: drill?.id,
    entityCode: drill?.drillCode,
    vesselCode,
    workflowStage: drill?.status ?? "NEW",
    canEdit: !isLocked,
    fieldValues: {
      requirementId: requirementId || null,
      requirementTitle: reqTitle,
      solasRegulation: currentReq?.solasRegulation ?? null,
      scheduledDate: scheduledDate || null,
      completedDate: drill?.completedDate ?? null,
      scenario: scenario.trim() || null,
      observations: observations.trim() || null,
      lessonsLearned: lessonsLearned.trim() || null,
      participantCount: String(participants.length),
    },
  });

  const handleScenarioClick = useCallback(async () => {
    if (isLocked || loadingScenario) return;
    if (!requirementId || !vesselCode) { setErr("Seleccioná vessel y tipo de simulacro antes de pedir el escenario."); return; }
    setLoadingScenario(true);
    setScenario("Analizando...");
    setErr(null);
    try {
      const vesselName = vessels.find(v => v.code === vesselCode)?.name ?? null;
      const res = await api.post<{ text: string }>("/app/drills/suggest-scenario", {
        requirementId, vesselCode, vesselName,
      });
      setScenario(res.text || "");
    } catch (e) {
      setScenario("");
      setErr(e instanceof ApiError ? e.message : "No se pudo generar el escenario.");
    } finally { setLoadingScenario(false); }
  }, [isLocked, loadingScenario, requirementId, vesselCode, vessels]);

  const { data: crewData } = useFetch<{ items: CrewItem[] }>(`/app/crew?status=ONBOARD${vesselCode ? `&vesselCode=${vesselCode}` : ""}`, [vesselCode]);
  const availableCrew = crewData?.items ?? [];

  const toggleParticipant = (id: string) => {
    setParticipants(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  };

  const onSave = useCallback(async () => {
    if (!vesselCode || !requirementId || !scheduledDate) {
      setErr("Completá vessel, tipo y fecha."); return;
    }
    setSaving(true); setErr(null);
    try {
      const payload = {
        vesselCode, requirementId, scheduledDate,
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
  }, [isNew, drill, vesselCode, requirementId, scheduledDate, scenario, observations, lessonsLearned, participants, onSaved]);

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

          {availableRequirements.length === 0 && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-200">No hay tipos de simulacro configurados para este vessel. Pedile a un administrador que configure el catálogo.</p>
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
              <label className={labelCls}>Tipo de simulacro</label>
              <select value={requirementId} onChange={e => setRequirementId(e.target.value)} disabled={isLocked} className={inputCls}>
                {!requirementId && <option value="">— Seleccionar —</option>}
                {availableRequirements.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                {currentReq && !availableRequirements.find(r => r.id === currentReq.id) && (
                  <option value={currentReq.id}>{currentReq.title}</option>
                )}
              </select>
              {currentReq?.solasRegulation && (
                <p className="mt-1 text-[10px] text-text-industrial/40">Ref: {currentReq.solasRegulation}</p>
              )}
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
            <div className="col-span-2 space-y-1">
              <label
                onClick={!isLocked ? handleScenarioClick : undefined}
                title={!isLocked ? "Generar escenario con IA según la norma del requisito" : undefined}
                className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${!isLocked ? `hover:text-white cursor-pointer ${loadingScenario ? "opacity-60 animate-pulse" : ""}` : ""}`}
              >
                {loadingScenario ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Escenario
                {loadingScenario && <span className="ml-1 text-[9px] normal-case font-normal">analizando…</span>}
              </label>
              <textarea rows={4} value={scenario} onChange={e => setScenario(e.target.value)} disabled={isLocked || loadingScenario} className={`${inputCls} resize-y`} placeholder="Click en 'Escenario' para que la IA proponga uno, o escribilo manualmente." />
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
            {!isNew && (
              <button onClick={() => { void handleGeneratePdf(); }} disabled={generatingPdf}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 disabled:opacity-50">
                {generatingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-accent" />}
                Guardar PDF
              </button>
            )}
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

// ─── Matriz de cumplimiento ──────────────────────────────────────────────────

type MatrixStatus = "NEVER" | "OVERDUE" | "DUE_SOON" | "OK";

interface MatrixCell {
  vesselCode: string;
  requirementId: string;
  requirementTitle: string;
  solasRegulation: string | null;
  intervalLabel: string | null;
  frequencyDays: number;
  lastCompletedDate: string | null;
  lastDrillId: string | null;
  nextDueDate: string | null;
  daysUntilDue: number | null;
  status: MatrixStatus;
}

const STATUS_CELL_CLS: Record<MatrixStatus, string> = {
  OVERDUE: "bg-red-500/15 text-red-300 border-red-500/30 hover:bg-red-500/25",
  DUE_SOON: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30 hover:bg-yellow-500/25",
  NEVER: "bg-white/5 text-text-industrial/60 border-white/10 hover:bg-white/10",
  OK: "bg-success-sea/10 text-success-sea/80 border-success-sea/20 hover:bg-success-sea/15",
};

const STATUS_CELL_LABEL: Record<MatrixStatus, string> = {
  OVERDUE: "Vencido",
  DUE_SOON: "Próximo",
  NEVER: "Sin registro",
  OK: "Al día",
};

const DrillsMatrix: React.FC<{ cells: MatrixCell[]; loading: boolean; onPlan: (vesselCode: string, requirementId: string) => void; onReload: () => void }> = ({ cells, loading, onPlan, onReload }) => {
  const [expanded, setExpanded] = useState(true);

  // Agrupar: requirements × vessels (ordenados por título)
  const { requirements, vessels, byKey } = useMemo(() => {
    const reqMap = new Map<string, { id: string; title: string; intervalLabel: string | null; frequencyDays: number }>();
    const vesselSet = new Set<string>();
    const m = new Map<string, MatrixCell>();
    for (const c of cells) {
      if (!reqMap.has(c.requirementId)) {
        reqMap.set(c.requirementId, {
          id: c.requirementId,
          title: c.requirementTitle,
          intervalLabel: c.intervalLabel,
          frequencyDays: c.frequencyDays,
        });
      }
      vesselSet.add(c.vesselCode);
      m.set(`${c.vesselCode}|${c.requirementId}`, c);
    }
    return {
      requirements: Array.from(reqMap.values()).sort((a, b) => a.title.localeCompare(b.title)),
      vessels: Array.from(vesselSet).sort(),
      byKey: m,
    };
  }, [cells]);

  const overdueCount = cells.filter(c => c.status === "OVERDUE").length;
  const dueSoonCount = cells.filter(c => c.status === "DUE_SOON").length;

  return (
    <section className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
      <button onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/[0.04] transition-colors text-left">
        {expanded ? <ChevronDown className="w-4 h-4 text-accent" /> : <ChevronRight className="w-4 h-4 text-accent" />}
        <span className="text-xs font-bold uppercase tracking-wider text-white">Matriz de cumplimiento</span>
        <span className="text-[10px] text-text-industrial/40">— SOLAS / ISPS / MARPOL</span>
        <div className="ml-auto flex items-center gap-2">
          {overdueCount > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-500/15 text-red-300 border-red-500/30">{overdueCount} vencidos</span>
          )}
          {dueSoonCount > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-yellow-500/15 text-yellow-300 border-yellow-500/30">{dueSoonCount} próximos</span>
          )}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-white/10 overflow-x-auto">
          {loading && cells.length === 0 ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
          ) : requirements.length === 0 || vessels.length === 0 ? (
            <div className="text-center py-8 text-text-industrial/40 text-xs">Sin vessels o tipos configurados.</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-3 py-2 font-bold text-text-industrial/60 uppercase tracking-wider sticky left-0 bg-[#0D1B2A] z-10">Tipo / Frecuencia</th>
                  {vessels.map(v => (
                    <th key={v} className="text-center px-3 py-2 font-mono font-bold text-accent">{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requirements.map(r => (
                  <tr key={r.id} className="border-b border-white/5 last:border-b-0">
                    <td className="px-3 py-2 sticky left-0 bg-[#0D1B2A] z-10">
                      <div className="font-bold text-white">{r.title}</div>
                      <div className="text-[9px] text-text-industrial/40">{r.intervalLabel ?? `cada ${r.frequencyDays} días`}</div>
                    </td>
                    {vessels.map(v => {
                      const c = byKey.get(`${v}|${r.id}`);
                      if (!c) return <td key={v} className="px-2 py-2 text-center text-text-industrial/20">—</td>;
                      const cellCls = STATUS_CELL_CLS[c.status];
                      const main =
                        c.status === "NEVER" ? "Nunca" :
                        c.status === "OVERDUE" ? `Vencido hace ${Math.abs(c.daysUntilDue!)} d` :
                        c.status === "DUE_SOON" ? `En ${c.daysUntilDue} d` :
                        `En ${c.daysUntilDue} d`;
                      return (
                        <td key={v} className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => onPlan(v, r.id)}
                            title={`${STATUS_CELL_LABEL[c.status]}${c.lastCompletedDate ? ` — último: ${fmtDate(c.lastCompletedDate)}` : ""}${c.nextDueDate ? ` — próximo: ${fmtDate(c.nextDueDate)}` : ""}`}
                            className={`w-full px-2 py-1 rounded-md border font-bold text-[10px] transition-colors ${cellCls}`}
                          >
                            {main}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-white/5 text-[10px] text-text-industrial/40">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/40" />Vencido</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-500/40" />Próximo (≤14d)</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-success-sea/40" />Al día</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-white/20" />Sin registro</span>
            </div>
            <button onClick={onReload} className="hover:text-white">Refrescar</button>
          </div>
        </div>
      )}
    </section>
  );
};

// ─── Modal Catálogo de tipos de simulacro (requirements) ─────────────────────

interface RequirementDraft {
  id: string;
  isNew?: boolean;
  title: string;
  solasRegulation: string;
  frequencyDays: number;
  intervalLabel: string;
  applicableVesselCodes: string[];
  notes: string;
  enabled: boolean;
  sortOrder: number;
}

function toDraft(r: DrillRequirement): RequirementDraft {
  return {
    id: r.id,
    title: r.title,
    solasRegulation: r.solasRegulation ?? "",
    frequencyDays: r.frequencyDays,
    intervalLabel: r.intervalLabel ?? "",
    applicableVesselCodes: r.applicableVesselCodes ?? [],
    notes: r.notes ?? "",
    enabled: r.enabled,
    sortOrder: r.sortOrder,
  };
}

const DrillRequirementsModal: React.FC<{ onClose: () => void; onSaved: () => void }> = ({ onClose, onSaved }) => {
  const { vessels } = useVesselContext();
  const { data, loading, reload } = useFetch<{ items: DrillRequirement[] }>("/app/drills/requirements", []);
  const [editing, setEditing] = useState<RequirementDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const items = data?.items ?? [];

  const startNew = () => setEditing({
    id: "",
    isNew: true,
    title: "",
    solasRegulation: "",
    frequencyDays: 30,
    intervalLabel: "",
    applicableVesselCodes: [],
    notes: "",
    enabled: true,
    sortOrder: items.length,
  });

  const onSaveRow = async () => {
    if (!editing) return;
    const title = editing.title.trim();
    if (!title) { setErr("El nombre del tipo es obligatorio."); return; }
    if (editing.frequencyDays < 1) { setErr("Frecuencia mínima: 1 día."); return; }
    setSaving(true); setErr(null);
    try {
      const payload = {
        title,
        solasRegulation: editing.solasRegulation.trim() || null,
        frequencyDays: editing.frequencyDays,
        intervalLabel: editing.intervalLabel.trim() || null,
        applicableVesselCodes: editing.applicableVesselCodes,
        notes: editing.notes.trim() || null,
        enabled: editing.enabled,
        sortOrder: editing.sortOrder,
      };
      if (editing.isNew) await api.post("/app/drills/requirements", payload);
      else await api.patch(`/app/drills/requirements/${editing.id}`, payload);
      setEditing(null);
      await reload();
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al guardar.");
    } finally { setSaving(false); }
  };

  const onDelete = async (id: string) => {
    if (!confirm("¿Eliminar este tipo de simulacro? Los simulacros ya creados con este tipo no se borran.")) return;
    setSaving(true); setErr(null);
    try {
      await api.delete(`/app/drills/requirements/${id}`);
      await reload();
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al eliminar.");
    } finally { setSaving(false); }
  };

  const toggleVesselApplicable = (code: string) => {
    if (!editing) return;
    setEditing(d => d ? {
      ...d,
      applicableVesselCodes: d.applicableVesselCodes.includes(code)
        ? d.applicableVesselCodes.filter(c => c !== code)
        : [...d.applicableVesselCodes, code],
    } : d);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#0D1B2A] border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <Settings className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Configuración</p>
              <h2 className="text-sm font-bold text-white">Catálogo de simulacros</h2>
            </div>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          <p className="text-xs text-text-industrial/60">
            Definí los tipos de simulacro que tu compañía debe realizar y a qué buques aplican.
            Si dejás "Aplica a" en blanco, el tipo aplica a TODOS los buques.
          </p>

          {!editing && (
            <>
              <div className="flex justify-end">
                <button onClick={startNew} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110">
                  <Plus className="w-3.5 h-3.5" /> Nuevo tipo
                </button>
              </div>

              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
              ) : items.length === 0 ? (
                <div className="text-center py-8 text-text-industrial/40 text-sm">
                  Sin tipos configurados. Creá el primero para arrancar.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-text-industrial/50">
                      <th className="text-left py-2 px-2 font-bold uppercase tracking-wider">Tipo</th>
                      <th className="text-left py-2 px-2 font-bold uppercase tracking-wider">Norma</th>
                      <th className="text-center py-2 px-2 font-bold uppercase tracking-wider">Cada</th>
                      <th className="text-left py-2 px-2 font-bold uppercase tracking-wider">Aplica a</th>
                      <th className="text-center py-2 px-2 font-bold uppercase tracking-wider">Activo</th>
                      <th className="py-2 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(r => (
                      <tr key={r.id} onClick={() => setEditing(toDraft(r))} className="border-b border-white/5 hover:bg-white/[0.04] cursor-pointer">
                        <td className="py-2 px-2 text-white font-medium">{r.title}</td>
                        <td className="py-2 px-2 text-text-industrial/60">{r.solasRegulation ?? "—"}</td>
                        <td className="py-2 px-2 text-center text-text-industrial/80">{r.intervalLabel ?? `${r.frequencyDays}d`}</td>
                        <td className="py-2 px-2 text-text-industrial/60">
                          {r.applicableVesselCodes && r.applicableVesselCodes.length > 0
                            ? r.applicableVesselCodes.join(", ")
                            : <span className="italic">Todos</span>}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {r.enabled
                            ? <span className="text-success-sea">●</span>
                            : <span className="text-text-industrial/30">●</span>}
                        </td>
                        <td className="py-2 px-2 text-right" onClick={e => e.stopPropagation()}>
                          <button onClick={() => { void onDelete(r.id); }} disabled={saving}
                            className="p-1.5 rounded-md text-text-industrial/40 hover:text-red-400 hover:bg-red-500/10"
                            title="Eliminar">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>Nombre del tipo</label>
                  <input value={editing.title} onChange={e => setEditing(d => d ? { ...d, title: e.target.value } : d)} className={inputCls} placeholder="Ej: Incendio en sala de máquinas" />
                </div>
                <div>
                  <label className={labelCls}>Referencia normativa</label>
                  <input value={editing.solasRegulation} onChange={e => setEditing(d => d ? { ...d, solasRegulation: e.target.value } : d)} className={inputCls} placeholder="Ej: SOLAS III/19.3.2" />
                </div>
                <div>
                  <label className={labelCls}>Frecuencia (días)</label>
                  <input type="number" min={1} max={3650} value={editing.frequencyDays}
                    onChange={e => setEditing(d => d ? { ...d, frequencyDays: Math.max(1, parseInt(e.target.value, 10) || 0) } : d)}
                    className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Etiqueta de intervalo (opcional)</label>
                  <input value={editing.intervalLabel} onChange={e => setEditing(d => d ? { ...d, intervalLabel: e.target.value } : d)} className={inputCls} placeholder="Ej: Mensual, Trimestral, Anual" />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Aplica a (vacío = todos los buques)</label>
                  <div className="max-h-40 overflow-y-auto bg-white/5 border border-white/10 rounded-xl p-2 space-y-1">
                    {vessels.length === 0 ? (
                      <p className="text-xs text-text-industrial/40 p-2">Sin buques en el tenant.</p>
                    ) : vessels.map(v => (
                      <label key={v.code} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 cursor-pointer">
                        <input type="checkbox"
                          checked={editing.applicableVesselCodes.includes(v.code)}
                          onChange={() => toggleVesselApplicable(v.code)}
                          className="rounded" />
                        <span className="text-xs text-white font-mono">{v.code}</span>
                        <span className="text-[10px] text-text-industrial/40">{v.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Notas</label>
                  <textarea rows={2} value={editing.notes}
                    onChange={e => setEditing(d => d ? { ...d, notes: e.target.value } : d)}
                    className={inputCls} />
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <input id="req-enabled" type="checkbox" checked={editing.enabled}
                    onChange={e => setEditing(d => d ? { ...d, enabled: e.target.checked } : d)}
                    className="rounded" />
                  <label htmlFor="req-enabled" className="text-xs text-white">Activo</label>
                </div>
              </div>
              {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => { setEditing(null); setErr(null); }} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white">Cancelar</button>
                <button onClick={() => { void onSaveRow(); }} disabled={saving}
                  className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
                </button>
              </div>
            </div>
          )}

          {!editing && err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white">Cerrar</button>
        </div>
      </div>
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

export const DrillsPage: React.FC = () => {
  const { user } = useAuth();
  const canConfigure = user?.role === "TENANT_ADMIN" || user?.role === "MAINTENANCE_MANAGER" || user?.role === "FLEET_SUPERINTENDENT";

  const [filter, setFilter] = useState<"upcoming" | "completed" | "all">("upcoming");

  const { data: requirementsData, reload: reloadRequirements } = useFetch<{ items: DrillRequirement[] }>("/app/drills/requirements", []);
  const requirements = requirementsData?.items ?? [];

  const { data: matrixData, loading: matrixLoading, reload: reloadMatrix } = useFetch<{ cells: MatrixCell[] }>("/app/drills/matrix", []);
  const matrixCells = matrixData?.cells ?? [];
  const overdueCount = matrixCells.filter(c => c.status === "OVERDUE").length;
  const dueSoonCount = matrixCells.filter(c => c.status === "DUE_SOON").length;
  const neverCount = matrixCells.filter(c => c.status === "NEVER").length;

  const overdueSummary = matrixCells
    .filter(c => c.status === "OVERDUE")
    .sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0))
    .slice(0, 5)
    .map(c => `${c.vesselCode}/${c.requirementTitle}: vencido hace ${Math.abs(c.daysUntilDue ?? 0)}d`)
    .join("; ");

  const path = useMemo(() => {
    if (filter === "upcoming") return "/app/drills?status=SCHEDULED";
    if (filter === "completed") return "/app/drills?status=COMPLETED";
    return "/app/drills";
  }, [filter]);

  const { data, loading, reload } = useFetch<{ items: Drill[]; total: number }>(path, [path]);
  const [showCreate, setShowCreate] = useState(false);
  const [prefill, setPrefill] = useState<DrillPrefill | undefined>(undefined);
  const [editing, setEditing] = useState<Drill | null>(null);
  const [showRequirements, setShowRequirements] = useState(false);

  useCopilotEmitter(!showCreate && !editing && !showRequirements ? {
    module: "DRILLS",
    screen: "DRILL_LIST",
    fieldValues: {
      filter,
      totalScheduled: String(data?.items?.filter(d => d.status === "SCHEDULED").length ?? 0),
      totalCompleted: String(data?.items?.filter(d => d.status === "COMPLETED").length ?? 0),
      matrixOverdue: String(overdueCount),
      matrixDueSoon: String(dueSoonCount),
      matrixNever: String(neverCount),
      overdueSummary: overdueSummary || null,
    },
  } : null);

  const handlePlanFromMatrix = useCallback((vesselCode: string, requirementId: string) => {
    setPrefill({ vesselCode, requirementId, scheduledDate: new Date().toISOString().slice(0, 10) });
    setShowCreate(true);
  }, []);

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={CalendarCheck} title="Simulacros" total={data?.total} onReload={reload}>
        <ExportExcelButton module="drills" />
        {canConfigure && (
          <button onClick={() => setShowRequirements(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
            <Settings className="w-3.5 h-3.5 text-accent" /> Catálogo
          </button>
        )}
        <button onClick={() => { setPrefill(undefined); setShowCreate(true); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110">
          <Plus className="w-3.5 h-3.5" /> Nuevo simulacro
        </button>
      </PageHeader>

      <DrillsMatrix cells={matrixCells} loading={matrixLoading} onPlan={handlePlanFromMatrix} onReload={reloadMatrix} />

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
                  <VesselLabel code={d.vesselCode} className="text-[10px]" showCode />
                </div>
                <p className="text-sm font-bold text-white">{d.requirement?.title ?? "—"}</p>
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
          prefill={prefill}
          requirements={requirements}
          onClose={() => { setShowCreate(false); setEditing(null); setPrefill(undefined); }}
          onSaved={() => {
            setShowCreate(false); setEditing(null); setPrefill(undefined);
            void reloadMatrix();
            void reload();
          }}
        />
      )}

      {showRequirements && (
        <DrillRequirementsModal
          onClose={() => setShowRequirements(false)}
          onSaved={() => { void reloadRequirements(); void reloadMatrix(); }}
        />
      )}
    </div>
  );
};
