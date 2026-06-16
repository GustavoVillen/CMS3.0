// STCW Manila / MLC 2006 — Hours of Rest tracking.
// Vista mensual por vessel con todos los crew ONBOARD; click en una celda
// abre la grilla de 24 horas para editar el día.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Loader2, X, ChevronLeft, ChevronRight, AlertTriangle, Check } from "lucide-react";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { useT } from "../lib/i18n";

interface CrewMember {
  id: string;
  firstName: string;
  lastName: string;
  rank: string;
  status: string;
}

interface RestHoursRow {
  id: string;
  crewId: string;
  recordDate: string;            // ISO
  hoursData: boolean[];          // 24
  totalRestHours: number | null;
  hasViolation: boolean;
  violationsJson: Array<{ kind: string; details: string }> | null;
  notes: string | null;
}

interface MonthlyData {
  year: number;
  month: number;
  crew: CrewMember[];
  rows: RestHoursRow[];
}

// Simulacro (drill) traído para detectar el cruce con horas de descanso.
interface DrillForConflict {
  id: string;
  drillCode: string;
  status: string;
  scheduledDate: string;
  completedDate: string | null;
  scheduledTime: string | null;
  completedTime: string | null;
  participantCrewIds: string[];
  requirement?: { title: string | null } | null;
}

// Bloque horario ocupado por un simulacro para un crew+día concreto.
interface DrillBlock { hour: number; code: string; title: string }

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50";

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function ymdLocal(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── Day editor (24h grid) ───────────────────────────────────────────────────

interface DayEditorProps {
  crew: CrewMember;
  date: string;                  // YYYY-MM-DD
  vesselCode: string;
  initialHours: boolean[];
  initialNotes: string;
  drillBlocks: DrillBlock[];
  onClose: () => void;
  onSaved: () => void;
}

const DayEditor: React.FC<DayEditorProps> = ({ crew, date, vesselCode, initialHours, initialNotes, drillBlocks, onClose, onSaved }) => {
  const t = useT();
  const [hours, setHours] = useState<boolean[]>(() => initialHours.slice());
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paintMode, setPaintMode] = useState<"rest" | "work" | null>(null);

  const totalRest = useMemo(() => hours.filter(Boolean).length, [hours]);

  // Simulacros por hora (un tripulante presente en un simulacro no puede estar
  // descansando en ese bloque). Si una hora marcada como descanso coincide con
  // un simulacro del tripulante, es un conflicto que bloquea el guardado.
  const drillByHour = useMemo(() => {
    const m = new Map<number, DrillBlock[]>();
    for (const b of drillBlocks) {
      const arr = m.get(b.hour) ?? [];
      arr.push(b);
      m.set(b.hour, arr);
    }
    return m;
  }, [drillBlocks]);

  const conflicts = useMemo(
    () => drillBlocks.filter(b => hours[b.hour]),
    [drillBlocks, hours],
  );

  const toggleHour = (h: number) => {
    setHours(prev => {
      const next = prev.slice();
      next[h] = !next[h];
      return next;
    });
  };

  const onMouseDown = (h: number) => {
    setPaintMode(hours[h] ? "work" : "rest");
    toggleHour(h);
  };
  const onMouseEnter = (h: number) => {
    if (!paintMode) return;
    setHours(prev => {
      const next = prev.slice();
      next[h] = paintMode === "rest";
      return next;
    });
  };

  useEffect(() => {
    const up = () => setPaintMode(null);
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, []);

  const fillAll = (rest: boolean) => setHours(new Array(24).fill(rest));

  const onSave = useCallback(async () => {
    if (conflicts.length > 0) { setErr(t("rh.drillConflictBlock")); return; }
    setSaving(true); setErr(null);
    try {
      await api.post("/app/rest-hours", {
        vesselCode, crewId: crew.id, recordDate: date,
        hoursData: hours,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setSaving(false); }
  }, [vesselCode, crew.id, date, hours, notes, conflicts, onSaved, t]);

  // ESC: cerrar / preguntar guardar si hay cambios
  const isDirty = useDirtyTracker({ hours, notes });
  useEscapeGuard({ isDirty, onSave, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("rh.editorHeader")} · {date}</p>
            <h2 className="text-sm font-bold text-fg">{crew.firstName} {crew.lastName} — {crew.rank}</h2>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-[11px] text-text-industrial/60">
            {(() => {
              const parts = t("rh.editorHelp").split(/\{rest\}|\{work\}/);
              return (
                <>
                  {parts[0]}
                  <span className="text-success-sea font-bold">{t("rh.rest")}</span>
                  {parts[1]}
                  <span className="text-red-700 dark:text-red-400 font-bold">{t("rh.work")}</span>
                  {parts[2]}
                </>
              );
            })()}
          </p>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/40">
                {t("rh.totalRest")}: <span className={totalRest >= 10 ? "text-success-sea" : "text-red-700 dark:text-red-400"}>{totalRest}h</span> / 24h
              </span>
              <div className="flex gap-1">
                <button onClick={() => fillAll(true)} className="px-2 py-0.5 rounded text-[10px] bg-success-sea/10 border border-success-sea/30 text-success-sea hover:bg-success-sea/20">{t("rh.allRest")}</button>
                <button onClick={() => fillAll(false)} className="px-2 py-0.5 rounded text-[10px] bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 hover:bg-red-500/20">{t("rh.allWork")}</button>
              </div>
            </div>
            <div className="grid grid-cols-12 gap-0.5 select-none">
              {hours.map((isRest, h) => {
                const drillsHere = drillByHour.get(h);
                const isDrillHour = !!drillsHere;
                const isConflict = isDrillHour && isRest;
                const stateCls = isConflict
                  ? "bg-amber-500/40 text-amber-900 dark:text-amber-200 border-amber-500/70 ring-2 ring-amber-500/60"
                  : isRest
                    ? "bg-success-sea/30 text-success-sea border-success-sea/40 hover:bg-success-sea/40"
                    : "bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/30 hover:bg-red-500/30";
                const baseTitle = t("rh.cellTitle")
                  .replace("{from}", `${String(h).padStart(2, "0")}:00`)
                  .replace("{to}", `${String((h + 1) % 24).padStart(2, "0")}:00`)
                  .replace("{state}", isRest ? t("rh.rest") : t("rh.work"));
                const drillTitle = isDrillHour
                  ? "\n" + drillsHere!.map(d => `⚠ ${d.code} — ${d.title}`).join("\n")
                  : "";
                return (
                  <button
                    key={h}
                    onMouseDown={() => onMouseDown(h)}
                    onMouseEnter={() => onMouseEnter(h)}
                    className={`relative aspect-square text-[9px] font-mono rounded border transition-colors ${stateCls} ${isDrillHour && !isConflict ? "ring-1 ring-accent/40" : ""}`}
                    title={baseTitle + drillTitle}
                  >
                    {String(h).padStart(2, "0")}
                    {isDrillHour && <span className="absolute top-0 right-0.5 text-[7px] leading-none">{isConflict ? "⚠" : "•"}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1.5">{t("rh.notes")}</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} placeholder={t("rh.notesPh")} />
          </div>

          {conflicts.length > 0 && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/40 px-3 py-2 space-y-1">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> {t("rh.drillConflictTitle")}
              </p>
              {conflicts.map((c, i) => (
                <p key={i} className="text-[11px] text-amber-800 dark:text-amber-200">
                  {t("rh.drillConflictItem")
                    .replace("{hour}", `${String(c.hour).padStart(2, "0")}:00`)
                    .replace("{code}", c.code)
                    .replace("{title}", c.title)}
                </p>
              ))}
            </div>
          )}

          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}

          <div className="rounded-lg bg-fg/[0.04] border border-fg/10 p-2 text-[10px] text-text-industrial/70 space-y-0.5">
            <p className="font-bold uppercase tracking-wider text-text-industrial/50">{t("rh.rules")}</p>
            <p>{t("rh.rule10h")}</p>
            <p>{t("rh.rule77h")}</p>
            <p>{t("rh.rule2periods")}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving || conflicts.length > 0} title={conflicts.length > 0 ? t("rh.drillConflictBlock") : undefined} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main page ───────────────────────────────────────────────────────────────

export const RestHoursPage: React.FC = () => {
  const t = useT();
  const { vessels, selectedVesselCode } = useVesselContext();
  const [vesselCode, setVesselCode] = useState(selectedVesselCode ?? vessels[0]?.code ?? "");
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [data, setData] = useState<MonthlyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ crew: CrewMember; date: string; hours: boolean[]; notes: string; drillBlocks: DrillBlock[] } | null>(null);

  // Simulacros del buque (para cruzar con horas de descanso). Liviano: se filtra
  // por buque y se mapea en cliente por crew+día.
  const { data: drillsData } = useFetch<{ items: DrillForConflict[] }>(
    vesselCode ? `/app/drills?vesselCode=${encodeURIComponent(vesselCode)}` : null,
    [vesselCode],
  );

  // crewId|YYYY-MM-DD → bloques horarios ocupados por simulacros del tripulante.
  const drillBlockMap = useMemo(() => {
    const map = new Map<string, DrillBlock[]>();
    for (const d of drillsData?.items ?? []) {
      if (d.status === "CANCELLED") continue;
      // Si el simulacro se realizó, usar día+hora reales; si no, los programados.
      const realized = d.status === "COMPLETED";
      const timeStr = (realized && d.completedTime) ? d.completedTime : d.scheduledTime;
      if (!timeStr) continue;
      const hour = parseInt(timeStr.slice(0, 2), 10);
      if (Number.isNaN(hour)) continue;
      const effectiveDate = ((realized && d.completedDate) ? d.completedDate : d.scheduledDate).slice(0, 10);
      const title = d.requirement?.title ?? d.drillCode;
      const ids = Array.isArray(d.participantCrewIds) ? d.participantCrewIds : [];
      for (const crewId of ids) {
        const key = `${crewId}|${effectiveDate}`;
        const arr = map.get(key) ?? [];
        arr.push({ hour, code: d.drillCode, title });
        map.set(key, arr);
      }
    }
    return map;
  }, [drillsData]);

  const reload = useCallback(async () => {
    if (!vesselCode) { setData(null); return; }
    setLoading(true);
    try {
      const r = await api.get<MonthlyData>(`/app/rest-hours/monthly?vesselCode=${encodeURIComponent(vesselCode)}&year=${year}&month=${month}`);
      setData(r);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [vesselCode, year, month]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (selectedVesselCode && selectedVesselCode !== vesselCode) setVesselCode(selectedVesselCode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVesselCode]);

  const days = daysInMonth(year, month);
  const dayCols = useMemo(() => Array.from({ length: days }, (_, i) => i + 1), [days]);

  // Mapa por crewId × día → row
  const byCrewDay = useMemo(() => {
    const map = new Map<string, RestHoursRow>();
    for (const r of data?.rows ?? []) {
      const day = new Date(r.recordDate).getUTCDate();
      map.set(`${r.crewId}|${day}`, r);
    }
    return map;
  }, [data]);

  const totalViolations = (data?.rows ?? []).filter(r => r.hasViolation).length;

  function prevMonth() { if (month === 1) { setMonth(12); setYear(y => y - 1); } else { setMonth(m => m - 1); } }
  function nextMonth() { if (month === 12) { setMonth(1); setYear(y => y + 1); } else { setMonth(m => m + 1); } }

  function openDay(crew: CrewMember, day: number) {
    const key = `${crew.id}|${day}`;
    const existing = byCrewDay.get(key);
    const dateStr = ymdLocal(year, month, day);
    setEditing({
      crew,
      date: dateStr,
      hours: existing?.hoursData?.slice() ?? new Array(24).fill(false),
      notes: existing?.notes ?? "",
      drillBlocks: drillBlockMap.get(`${crew.id}|${dateStr}`) ?? [],
    });
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={Clock} title={t("rh.pageTitle")} total={data?.rows.length ?? 0} onReload={reload}>
        <ExportExcelButton module="crew_rest_hours" />
        {totalViolations > 0 && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 text-xs font-bold">
            <AlertTriangle className="w-3.5 h-3.5" /> {t("rh.violations").replace("{n}", String(totalViolations))}
          </span>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg">
          <option value="">{t("rh.vesselPlaceholder")}</option>
          {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
        </select>
        <div className="flex items-center gap-1 border border-fg/10 rounded-lg p-0.5">
          <button onClick={prevMonth} className="p-1 rounded-md text-text-industrial/60 hover:text-fg"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-3 text-xs font-bold text-fg min-w-[100px] text-center">{String(month).padStart(2, "0")}/{year}</span>
          <button onClick={nextMonth} className="p-1 rounded-md text-text-industrial/60 hover:text-fg"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {!vesselCode ? (
        <div className="text-center py-10 text-text-industrial/40 text-sm">{t("rh.selectVesselHint")}</div>
      ) : loading && !data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : !data || data.crew.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/40 text-sm">{t("rh.noCrewOnboard").replace("{vessel}", vesselCode)}</div>
      ) : (
        <div className="overflow-x-auto bg-fg/[0.03] border border-fg/10 rounded-xl">
          <table className="text-[10px] min-w-full">
            <thead>
              <tr className="border-b border-fg/10">
                <th className="sticky left-0 z-10 bg-surface dark:bg-[#0D1B2A] text-left px-3 py-2 font-bold uppercase tracking-widest text-text-industrial/60 min-w-[180px]">{t("rh.colCrew")}</th>
                {dayCols.map(d => (
                  <th key={d} className="px-1 py-2 text-center font-mono text-text-industrial/50 min-w-[28px]">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.crew.map(c => (
                <tr key={c.id} className="border-b border-fg/5 last:border-b-0">
                  <td className="sticky left-0 z-10 bg-surface dark:bg-[#0D1B2A] px-3 py-2">
                    <div className="text-xs font-bold text-fg truncate">{c.firstName} {c.lastName}</div>
                    <div className="text-[9px] text-text-industrial/40 uppercase tracking-wider">{c.rank}</div>
                  </td>
                  {dayCols.map(d => {
                    const row = byCrewDay.get(`${c.id}|${d}`);
                    const violation = row?.hasViolation;
                    const total = row?.totalRestHours ?? null;
                    const cls = !row
                      ? "bg-fg/[0.02] text-text-industrial/30 border-fg/5 hover:bg-fg/10"
                      : violation
                      ? "bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40 hover:bg-red-500/30"
                      : total !== null && total >= 10
                      ? "bg-success-sea/15 text-success-sea border-success-sea/30 hover:bg-success-sea/25"
                      : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30 hover:bg-yellow-500/25";
                    const title = !row
                      ? t("rh.noRecord")
                      : violation
                      ? `${total}h ${t("rh.rest")} · ${row.violationsJson?.map(v => v.details).join("; ") ?? t("rh.legendViolation")}`
                      : `${total}h ${t("rh.rest")}`;
                    return (
                      <td key={d} className="px-0.5 py-0.5">
                        <button
                          onClick={() => openDay(c, d)}
                          title={title}
                          className={`w-full h-7 rounded border text-[9px] font-mono font-bold transition-colors flex items-center justify-center ${cls}`}
                        >
                          {row ? (violation ? <AlertTriangle className="w-2.5 h-2.5" /> : total !== null && total >= 10 ? <Check className="w-2.5 h-2.5" /> : total) : "·"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3 px-3 py-2 border-t border-fg/10 text-[10px] text-text-industrial/50">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-success-sea/30" /> {t("rh.legendOk")}</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-yellow-500/30" /> {t("rh.legendWarn")}</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500/30" /> {t("rh.legendViolation")}</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-fg/10" /> {t("rh.legendNone")}</span>
          </div>
        </div>
      )}

      {editing && (
        <DayEditor
          crew={editing.crew}
          date={editing.date}
          vesselCode={vesselCode}
          initialHours={editing.hours}
          initialNotes={editing.notes}
          drillBlocks={editing.drillBlocks}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
};
