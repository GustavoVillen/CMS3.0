// CVIQ self-assessment SIRE 2.0.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Plus, Loader2, X, CheckCircle2, XCircle, MinusCircle, AlertTriangle } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { VesselLabel } from "../components/EntityLabels";
import { fmtDate } from "../lib/utils";

const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "En curso", COMPLETED: "Completado",
};
const STATUS_COLOR: Record<string, string> = {
  IN_PROGRESS: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  COMPLETED:   "bg-success-sea/10 text-success-sea border-success-sea/30",
};

const RESPONSE_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  CONFORMING: "Conforme",
  NOT_CONFORMING: "No conforme",
  PARTIALLY_CONFORMING: "Parcial",
  NOT_APPLICABLE: "N/A",
};

interface Question {
  id: string;
  questionCode: string;
  chapter: number;
  chapterTitle: string;
  section: string | null;
  questionText: string;
  expectedEvidence: string | null;
}

interface ResponseRow {
  id: string;
  questionId: string;
  status: string;
  notes: string | null;
  evidenceLink: string | null;
}

interface Assessment {
  id: string;
  assessmentCode: string;
  vesselCode: string;
  title: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  assessorName: string | null;
  totalQuestions: number;
  conformingCount: number;
  notConformingCount: number;
  partialCount: number;
  naCount: number;
  responses?: ResponseRow[];
  questions?: Question[];
}

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1.5";

// ─── Assessment modal ───────────────────────────────────────────────────────

const AssessmentModal: React.FC<{ assessmentId: string | null; onClose: () => void; onSaved: () => void }> = ({ assessmentId, onClose, onSaved }) => {
  const { vessels } = useVesselContext();
  const isNew = !assessmentId;
  const [asm, setAsm] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [chapterFilter, setChapterFilter] = useState<number | null>(null);

  // Para creación
  const [vesselCode, setVesselCode]   = useState(vessels[0]?.code ?? "");
  const [title, setTitle]             = useState("Self-assessment SIRE 2.0 — " + new Date().toISOString().slice(0, 10));
  const [assessorName, setAssessor]   = useState("");

  const reload = useCallback(async () => {
    if (!assessmentId) return;
    setLoading(true);
    try {
      const r = await api.get<Assessment>(`/app/cviq/assessments/${assessmentId}`);
      setAsm(r);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setLoading(false); }
  }, [assessmentId]);

  useEffect(() => { void reload(); }, [reload]);

  const handleCreate = async () => {
    if (!vesselCode || !title.trim()) { setErr("Vessel y título requeridos."); return; }
    setSaving(true); setErr(null);
    try {
      await api.post("/app/cviq/assessments", { vesselCode, title: title.trim(), assessorName: assessorName.trim() || null });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setSaving(false); }
  };

  const setResponse = async (questionId: string, status: string, notes?: string) => {
    if (!asm) return;
    try {
      await api.post(`/app/cviq/assessments/${asm.id}/responses`, { questionId, status, notes: notes ?? null });
      await reload();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
  };

  const complete = async () => {
    if (!asm) return;
    if (!window.confirm("¿Completar este assessment? Después no se podrá editar.")) return;
    try {
      await api.post(`/app/cviq/assessments/${asm.id}/complete`, {});
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
  };

  // Agrupar preguntas por capítulo
  const responsesByQ = useMemo(() => {
    const m = new Map<string, ResponseRow>();
    for (const r of asm?.responses ?? []) m.set(r.questionId, r);
    return m;
  }, [asm]);

  const chapters = useMemo(() => {
    if (!asm?.questions) return [];
    const map = new Map<number, { title: string; questions: Question[] }>();
    for (const q of asm.questions) {
      const entry = map.get(q.chapter) ?? { title: q.chapterTitle, questions: [] };
      entry.questions.push(q);
      map.set(q.chapter, entry);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [asm]);

  const filteredChapters = chapterFilter === null ? chapters : chapters.filter(([ch]) => ch === chapterFilter);

  const totals = useMemo(() => {
    if (!asm?.responses) return { conf: 0, nc: 0, partial: 0, na: 0, pending: 0 };
    return {
      conf:    asm.responses.filter(r => r.status === "CONFORMING").length,
      nc:      asm.responses.filter(r => r.status === "NOT_CONFORMING").length,
      partial: asm.responses.filter(r => r.status === "PARTIALLY_CONFORMING").length,
      na:      asm.responses.filter(r => r.status === "NOT_APPLICABLE").length,
      pending: asm.responses.filter(r => r.status === "PENDING").length,
    };
  }, [asm]);

  const conformityPct = asm && asm.responses?.length
    ? Math.round((totals.conf + totals.na) / asm.responses.length * 100)
    : 0;

  const isLocked = asm?.status === "COMPLETED";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-5xl max-h-[92vh] bg-[#0D1B2A] border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">CVIQ SIRE 2.0</p>
              <h2 className="text-sm font-bold text-white">{isNew ? "Nuevo assessment" : asm?.assessmentCode}</h2>
            </div>
            {asm && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${STATUS_COLOR[asm.status]}`}>
                {STATUS_LABEL[asm.status]}
              </span>
            )}
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          {isNew ? (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Vessel *</label>
                <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={inputCls}>
                  {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Assessor</label>
                <input value={assessorName} onChange={e => setAssessor(e.target.value)} className={inputCls} placeholder="Nombre del evaluador" />
              </div>
              <div className="col-span-2"><label className={labelCls}>Título *</label>
                <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
              </div>
            </div>
          ) : loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
          ) : asm ? (
            <>
              {/* Header con totales */}
              <div className="grid grid-cols-5 gap-2">
                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-text-industrial/40 mb-1">Conformidad</p>
                  <p className="text-2xl font-bold text-success-sea">{conformityPct}%</p>
                </div>
                <div className="bg-success-sea/10 border border-success-sea/30 rounded-xl p-3 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-success-sea mb-1">Conforme</p>
                  <p className="text-xl font-bold text-success-sea">{totals.conf}</p>
                </div>
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-red-400 mb-1">No conforme</p>
                  <p className="text-xl font-bold text-red-400">{totals.nc}</p>
                </div>
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-yellow-400 mb-1">Parcial</p>
                  <p className="text-xl font-bold text-yellow-400">{totals.partial}</p>
                </div>
                <div className="bg-white/[0.04] border border-white/10 rounded-xl p-3 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-text-industrial/50 mb-1">Pendiente</p>
                  <p className="text-xl font-bold text-text-industrial/70">{totals.pending}</p>
                </div>
              </div>

              {/* Filtro por capítulo */}
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => setChapterFilter(null)} className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${chapterFilter === null ? "bg-accent/20 text-accent border-accent/40" : "bg-white/5 text-text-industrial/60 border-white/10"}`}>Todos</button>
                {chapters.map(([ch, { title: t }]) => (
                  <button key={ch} onClick={() => setChapterFilter(ch)} className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${chapterFilter === ch ? "bg-accent/20 text-accent border-accent/40" : "bg-white/5 text-text-industrial/60 border-white/10"}`}>
                    {ch}. {t}
                  </button>
                ))}
              </div>

              {/* Questions */}
              <div className="space-y-3">
                {filteredChapters.map(([ch, { title: t, questions }]) => (
                  <div key={ch} className="space-y-1.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-text-industrial/70 border-b border-white/10 pb-1">
                      {ch}. {t}
                    </h3>
                    {questions.map(q => (
                      <CviqRow
                        key={q.id}
                        question={q}
                        response={responsesByQ.get(q.id) ?? null}
                        disabled={isLocked}
                        onSet={(status, notes) => { void setResponse(q.id, status, notes); }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white">Cerrar</button>
          {isNew ? (
            <button onClick={() => { void handleCreate(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Crear"}
            </button>
          ) : asm?.status === "IN_PROGRESS" && (
            <button onClick={() => { void complete(); }} className="px-4 py-2 rounded-xl bg-success-sea text-primary-bg font-bold text-xs">
              Marcar completado
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const CviqRow: React.FC<{ question: Question; response: ResponseRow | null; disabled: boolean; onSet: (status: string, notes?: string) => void }> = ({ question, response, disabled, onSet }) => {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(response?.notes ?? "");
  const status = response?.status ?? "PENDING";

  const statusBtn = (s: string, Icon: React.FC<{ className?: string }>, color: string, title: string) => (
    <button
      type="button" disabled={disabled}
      onClick={() => onSet(s, response?.notes ?? undefined)}
      title={title}
      className={`p-1.5 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${status === s ? color : "bg-white/5 text-text-industrial/40 border-white/10 hover:text-white"}`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className={`bg-white/[0.03] border rounded-lg p-2.5 ${status === "NOT_CONFORMING" ? "border-red-500/30 bg-red-500/[0.04]" : status === "PARTIALLY_CONFORMING" ? "border-yellow-500/30" : "border-white/10"}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <span className="text-[10px] font-mono text-accent">{question.questionCode}</span>
            {question.section && <span className="text-[9px] text-text-industrial/40">{question.section}</span>}
          </div>
          <p className="text-xs text-white">{question.questionText}</p>
          {question.expectedEvidence && (
            <p className="text-[10px] text-text-industrial/50 mt-0.5 italic">📋 {question.expectedEvidence}</p>
          )}
          {response?.notes && !editingNotes && (
            <p className="text-[10px] text-text-industrial/70 mt-1 bg-white/[0.03] rounded px-2 py-1">📝 {response.notes}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {statusBtn("CONFORMING", CheckCircle2, "bg-success-sea/15 text-success-sea border-success-sea/40", "Conforme")}
          {statusBtn("PARTIALLY_CONFORMING", AlertTriangle, "bg-yellow-500/15 text-yellow-300 border-yellow-500/40", "Parcial")}
          {statusBtn("NOT_CONFORMING", XCircle, "bg-red-500/15 text-red-400 border-red-500/40", "No conforme")}
          {statusBtn("NOT_APPLICABLE", MinusCircle, "bg-white/10 text-text-industrial/60 border-white/20", "N/A")}
        </div>
      </div>
      {!disabled && (
        <button type="button" onClick={() => setEditingNotes(v => !v)} className="text-[10px] text-accent hover:underline mt-1">
          {editingNotes ? "Cerrar" : response?.notes ? "Editar nota" : "+ Nota / evidencia"}
        </button>
      )}
      {editingNotes && (
        <div className="mt-1 flex gap-2">
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notas, link a evidencia…" className={inputCls + " text-xs"} />
          <button onClick={() => { onSet(status, notes); setEditingNotes(false); }} className="px-2 py-1 rounded bg-accent text-primary-bg text-[10px] font-bold">Guardar</button>
        </div>
      )}
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

export const CviqPage: React.FC = () => {
  const { data, loading, reload } = useFetch<{ items: Assessment[] }>("/app/cviq/assessments");
  const [showCreate, setShowCreate] = useState(false);
  const [openId, setOpenId]         = useState<string | null>(null);

  const items = data?.items ?? [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={ShieldCheck} title="CVIQ Self-Assessment SIRE 2.0" total={items.length} onReload={reload}>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110">
          <Plus className="w-3.5 h-3.5" /> Nuevo assessment
        </button>
      </PageHeader>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">Sin assessments. Creá el primero para evaluar el estado de conformidad.</div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">
          {items.map(a => {
            const pct = a.totalQuestions ? Math.round((a.conformingCount + a.naCount) / a.totalQuestions * 100) : 0;
            return (
              <button key={a.id} onClick={() => setOpenId(a.id)} className="w-full text-left p-4 hover:bg-white/5 transition-colors flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-[10px] font-mono text-text-industrial/40">{a.assessmentCode}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${STATUS_COLOR[a.status]}`}>
                      {STATUS_LABEL[a.status]}
                    </span>
                    <VesselLabel code={a.vesselCode} className="text-[10px]" showCode />
                  </div>
                  <p className="text-sm font-bold text-white">{a.title}</p>
                  <p className="text-[10px] text-text-industrial/50">{a.assessorName ?? "—"} · {a.totalQuestions} preguntas</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl font-bold text-success-sea">{pct}%</p>
                  <p className="text-[10px] text-text-industrial/40">{fmtDate(a.startedAt)}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {(showCreate || openId) && (
        <AssessmentModal
          assessmentId={openId}
          onClose={() => { setShowCreate(false); setOpenId(null); }}
          onSaved={() => { setShowCreate(false); setOpenId(null); void reload(); }}
        />
      )}
    </div>
  );
};
