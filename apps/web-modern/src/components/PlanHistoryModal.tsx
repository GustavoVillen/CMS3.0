import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Gauge, History, List, Loader2, Ship, Table2, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { fmtDate } from "../lib/utils";
import { ModalCloseButton } from "./ModalCloseButton";
import { VesselLabel } from "./EntityLabels";
import type { MaintenancePlan } from "../pages/MaintenancePlans";

// Planilla estilo Excel con el historial de ejecuciones de un plan (una fila por
// OT ligada al plan). Solo lectura para todos; edición inline (fecha, ejecutado
// por, horas, resultado/observaciones) solo si `isAdmin`, vía el endpoint
// acotado PATCH /app/pms/maintenance-plans/:id/executions/:woId. Cada celda
// guarda al salir del campo (blur) enviando solo lo cambiado.

interface Execution {
  id: string;
  workOrderCode: string;
  status: string;
  type: string;
  openDate: string;
  completedDate: string | null;
  executedByName: string | null;
  runningHoursAtExecution: number | null;
  woResult: string | null;
  observations: string | null;
}

interface Props {
  plan: MaintenancePlan;
  isAdmin: boolean;
  onClose: () => void;
  /** Llamar tras una edición para que el padre recargue el plan (lastExecution puede cambiar). */
  onEdited?: () => void;
}

const cellCls =
  "w-full bg-transparent text-[11px] text-fg px-1.5 py-1 rounded border border-transparent " +
  "hover:border-fg/15 focus:border-accent/60 focus:bg-fg/5 focus:outline-none transition-colors";
const ro = "text-[11px] text-fg/90 px-1.5 py-1 block truncate";
const roMono = ro + " font-mono";

const TextCell: React.FC<{ value: string | null; onCommit: (v: string) => void; resetKey: number }> = ({ value, onCommit, resetKey }) => {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value, resetKey]);
  const commit = () => { const nv = draft.trim(); if (nv !== (value ?? "")) onCommit(nv); };
  return (
    <input
      className={cellCls}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setDraft(value ?? ""); e.currentTarget.blur(); }
      }}
    />
  );
};

const NumberCell: React.FC<{ value: number | null; onCommit: (v: number | null) => void; resetKey: number }> = ({ value, onCommit, resetKey }) => {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value, resetKey]);
  const commit = () => {
    const trimmed = draft.trim();
    const nv = trimmed === "" ? null : Number(trimmed);
    if (nv != null && Number.isNaN(nv)) { setDraft(value == null ? "" : String(value)); return; }
    if (nv !== (value ?? null)) onCommit(nv);
  };
  return (
    <input
      type="number"
      className={cellCls + " font-mono"}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setDraft(value == null ? "" : String(value)); e.currentTarget.blur(); }
      }}
    />
  );
};

const DateCell: React.FC<{ value: string | null; onCommit: (v: string | null) => void; resetKey: number }> = ({ value, onCommit, resetKey }) => {
  const cur = value ? value.slice(0, 10) : "";
  const [draft, setDraft] = useState(cur);
  useEffect(() => setDraft(cur), [cur, resetKey]);
  return (
    <input
      type="date"
      className={cellCls + " font-mono"}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== cur) onCommit(draft || null); }}
    />
  );
};

/** Estado de la OT en castellano (antes se mostraba el valor crudo: CLOSED). */
const HISTORY_STATUS_KEYS: Record<string, string> = {
  CLOSED: "wo.status.closed", OPEN: "wo.status.open", PLANNED: "wo.status.planned",
  IN_PROGRESS: "wo.status.inProgress", ON_HOLD: "wo.status.onHold", CANCELLED: "mp.history.st.cancelled",
};

type SortKey = "code" | "date" | "executedBy" | "hours" | "status";

export const PlanHistoryModal: React.FC<Props> = ({ plan, isAdmin, onClose, onEdited }) => {
  const t = useT();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errById, setErrById] = useState<Record<string, string>>({});
  const [errTick, setErrTick] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey | null>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api.get<{ items: Execution[] }>(`/app/pms/maintenance-plans/${plan.id}/executions`)
      .then(res => { if (!cancelled) setRows(res.items ?? []); })
      .catch(() => { if (!cancelled) setLoadError(t("mp.history.loadError")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // `t` se omite a propósito: useT() devuelve una función nueva en cada render,
    // incluirla re-dispararía el fetch en loop (titileo). Solo depende del plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  const patchExec = useCallback(async (row: Execution, patch: Partial<Execution>) => {
    setSavingId(row.id);
    setErrById(e => { const next = { ...e }; delete next[row.id]; return next; });
    try {
      const res = await api.patch<{ items: Execution[] }>(`/app/pms/maintenance-plans/${plan.id}/executions/${row.id}`, patch);
      setRows(res.items ?? []);
      onEdited?.();
    } catch (err) {
      setErrById(e => ({ ...e, [row.id]: err instanceof ApiError ? err.message : t("mp.grid.saveError") }));
      setErrTick(x => x + 1); // fuerza a las celdas a revertir su draft
    } finally {
      setSavingId(s => (s === row.id ? null : s));
    }
  }, [plan.id, t, onEdited]);

  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); }
    else setSortDir(d => (d === "asc" ? "desc" : "asc"));
  };

  const sortVal = (row: Execution, key: SortKey): string | number | null => {
    switch (key) {
      case "code": return row.workOrderCode ?? null;
      case "date": return row.completedDate ?? row.openDate ?? null;
      case "executedBy": return (row.executedByName ?? "").toLowerCase();
      case "hours": return row.runningHoursAtExecution ?? null;
      case "status": return row.status ?? null;
      default: return null;
    }
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortVal(a, sortKey);
      const bv = sortVal(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [rows, sortKey, sortDir]);

  /** Línea de tiempo: siempre de la más reciente a la más vieja. */
  const sortedByDateDesc = useMemo(
    () => [...rows].sort((a, b) => String(b.completedDate ?? b.openDate ?? "").localeCompare(String(a.completedDate ?? a.openDate ?? ""))),
    [rows],
  );

  const th = "px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-industrial/50 whitespace-nowrap";
  const renderHeader = (label: string, key?: SortKey) => {
    const active = key != null && sortKey === key;
    return (
      <th className={th}>
        {key ? (
          <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-fg transition-colors select-none">
            <span className="truncate">{label}</span>
            <span className={active ? "text-accent" : "opacity-40"}>{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
          </button>
        ) : (
          <span className="truncate block">{label}</span>
        )}
      </th>
    );
  };

  // ── Resumen y línea de tiempo (preview V16) ──
  const byHours = plan.triggerType === "HOURS" || plan.triggerType === "RUNNING_HOURS";
  const showHours = byHours || rows.some(r => r.runningHoursAtExecution != null);
  const summary = useMemo(() => {
    const dates = rows
      .map(r => r.completedDate ?? null)
      .filter((d): d is string => !!d)
      .map(d => new Date(d.slice(0, 10) + "T00:00:00").getTime())
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b);
    const last = rows.map(r => r.completedDate).filter((d): d is string => !!d).sort().pop() ?? null;
    let avg: string | null = null;
    if (dates.length >= 2) {
      const days = (dates[dates.length - 1]! - dates[0]!) / 86_400_000 / (dates.length - 1);
      avg = days >= 365
        ? t("mp.history.avgYears").replace("{n}", (Math.round(days / 36.5) / 10).toLocaleString())
        : days >= 60
          ? t("mp.history.avgMonths").replace("{n}", String(Math.round(days / 30.4)))
          : t("mp.history.avgDays").replace("{n}", String(Math.round(days)));
    }
    return {
      count: rows.length,
      last,
      withDef: rows.filter(r => r.woResult === "WITH_DEFICIENCIES").length,
      avg,
    };
  }, [rows, t]);
  const [view, setView] = useState<"timeline" | "table">("timeline");
  const statusLabel = (s: string) => {
    const key = HISTORY_STATUS_KEYS[s];
    return key ? t(key as Parameters<typeof t>[0]) : s;
  };
  const goToWo = (code: string) => navigate(`/work-orders?autoCode=${encodeURIComponent(code)}`);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-3.5 border-b border-fg/10 shrink-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-700 dark:text-blue-400"><History className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-black text-fg leading-tight">{t("mp.history.title")}</h2>
            <p className="text-xs text-text-industrial/60 truncate">{[plan.title, plan.assetName].filter(Boolean).join(" · ")}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 font-mono text-[11px] font-bold text-fg">{plan.taskCode}</span>
              {/* Nombre del buque, no el código. */}
              <span className="inline-flex items-center gap-1 rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/70">
                <Ship className="w-3 h-3" /><VesselLabel code={plan.vesselCode} className="text-[11px]" />
              </span>
            </div>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-text-industrial/50">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : loadError ? (
            <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{loadError}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-xl border border-fg/10 px-3 py-2"><p className="text-xl font-black text-fg">{summary.count}</p><p className="text-[11px] font-semibold text-text-industrial/60">{t("mp.history.kpiCount")}</p></div>
                <div className="rounded-xl border border-fg/10 px-3 py-2"><p className="text-xl font-black text-fg">{fmtDate(summary.last) ?? "—"}</p><p className="text-[11px] font-semibold text-text-industrial/60">{t("mp.history.kpiLast")}</p></div>
                <div className="rounded-xl border border-fg/10 px-3 py-2"><p className={`text-xl font-black ${summary.withDef ? "text-amber-700 dark:text-amber-400" : "text-fg"}`}>{summary.withDef}</p><p className="text-[11px] font-semibold text-text-industrial/60">{t("mp.history.kpiDef")}</p></div>
                <div className="rounded-xl border border-fg/10 px-3 py-2"><p className="text-xl font-black text-fg">{summary.avg ?? "—"}</p><p className="text-[11px] font-semibold text-text-industrial/60">{t("mp.history.kpiAvg")}</p></div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-xl border border-fg/10 bg-fg/5 p-0.5">
                  {([["timeline", t("mp.history.viewTimeline"), List], ["table", isAdmin ? t("mp.history.viewTableEdit") : t("mp.history.viewTable"), Table2]] as const).map(([k, label, Icon]) => (
                    <button key={k} type="button" onClick={() => setView(k)}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${view === k ? "bg-surface text-fg shadow-sm" : "text-text-industrial/55 hover:text-fg"}`}>
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-text-industrial/50">
                  {!isAdmin ? t("mp.history.readonlyHint") : view === "table" ? t("mp.history.editHint") : t("mp.history.editGoTable")}
                </p>
              </div>

              {view === "timeline" ? (
                sortedByDateDesc.length === 0 ? (
                  <p className="px-4 py-10 text-center text-xs text-text-industrial/40">{t("mp.history.empty")}</p>
                ) : (
                  <ol className="relative space-y-2 pl-6 before:absolute before:left-[9px] before:top-3 before:bottom-3 before:w-0.5 before:bg-fg/10">
                    {sortedByDateDesc.map(row => {
                      const def = row.woResult === "WITH_DEFICIENCIES";
                      const ok = row.woResult === "SATISFACTORY";
                      return (
                        <li key={row.id} className="relative">
                          <span className={`absolute -left-6 top-3.5 w-3.5 h-3.5 rounded-full border-[3px] border-surface ring-1 ring-fg/20 ${def ? "bg-amber-500" : ok ? "bg-emerald-500" : "bg-slate-400"}`} />
                          <div className="rounded-xl border border-fg/10 px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-extrabold text-fg">{fmtDate(row.completedDate) ?? fmtDate(row.openDate) ?? "—"}</span>
                              {(def || ok) && (
                                <span className={`rounded-full px-2 py-px text-[10.5px] font-extrabold ${def ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`}>
                                  {def ? t("mp.history.resDef") : t("mp.history.resOk")}
                                </span>
                              )}
                              <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-px text-[10.5px] font-bold text-text-industrial/70">{statusLabel(row.status)}</span>
                              <button type="button" onClick={() => goToWo(row.workOrderCode)}
                                className="ml-auto rounded-md border border-accent/25 bg-accent/5 px-1.5 font-mono text-[11px] font-bold text-accent hover:bg-accent/15">
                                {row.workOrderCode}
                              </button>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-3 text-xs text-text-industrial/60">
                              <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{row.executedByName ?? "—"}</span>
                              {showHours && row.runningHoursAtExecution != null && (
                                <span className="inline-flex items-center gap-1"><Gauge className="w-3 h-3" />{row.runningHoursAtExecution.toLocaleString()} h</span>
                              )}
                            </div>
                            {row.observations && <p className="mt-1 text-[12.5px] text-fg/85 whitespace-pre-wrap">{row.observations}</p>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )
              ) : (
                <div className="overflow-x-auto rounded-xl border border-fg/10">
                  <table className="w-full border-collapse text-fg">
                    <thead className="sticky top-0 z-10 bg-surface">
                      <tr className="border-b border-fg/10">
                        {renderHeader(t("mp.history.col.code"), "code")}
                        {renderHeader(t("mp.history.col.date"), "date")}
                        {renderHeader(t("mp.history.col.executedBy"), "executedBy")}
                        {showHours && renderHeader(t("mp.history.col.hours"), "hours")}
                        {renderHeader(t("mp.history.col.result"))}
                        {renderHeader(t("mp.history.col.status"), "status")}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-fg/5">
                      {sortedRows.length === 0 && (
                        <tr><td colSpan={showHours ? 6 : 5} className="px-4 py-10 text-center text-xs text-text-industrial/40">{t("mp.history.empty")}</td></tr>
                      )}
                      {sortedRows.map(row => {
                        const err = errById[row.id];
                        const borderCls = savingId === row.id ? "border-l-accent" : err ? "border-l-red-500" : "border-l-transparent";
                        return (
                          <tr key={row.id} title={err ?? undefined} className={`border-l-2 ${borderCls} hover:bg-fg/[0.03] align-top`}>
                            {/* OT code */}
                            <td className="px-2 py-1 align-middle w-40">
                              <span className="flex items-center gap-1.5">
                                {savingId === row.id && <Loader2 className="w-3 h-3 animate-spin text-accent" />}
                                <button type="button" onClick={() => goToWo(row.workOrderCode)} className={`${roMono} text-accent hover:underline`}>{row.workOrderCode}</button>
                              </span>
                              {err && <span className="block text-[10px] text-red-600 dark:text-red-400 px-1.5 leading-tight">{err}</span>}
                            </td>

                            {/* Fecha */}
                            <td className="px-1 py-1 w-36">
                              {isAdmin
                                ? <DateCell value={row.completedDate} resetKey={errTick} onCommit={v => patchExec(row, { completedDate: v })} />
                                : <span className={roMono}>{fmtDate(row.completedDate) ?? "—"}</span>}
                            </td>

                            {/* Ejecutado por */}
                            <td className="px-1 py-1">
                              {isAdmin
                                ? <TextCell value={row.executedByName} resetKey={errTick} onCommit={v => patchExec(row, { executedByName: v })} />
                                : <span className={ro}>{row.executedByName ?? "—"}</span>}
                            </td>

                            {/* Horas */}
                            {showHours && (
                              <td className="px-1 py-1 w-24">
                                {isAdmin
                                  ? <NumberCell value={row.runningHoursAtExecution} resetKey={errTick} onCommit={v => patchExec(row, { runningHoursAtExecution: v })} />
                                  : <span className={roMono}>{row.runningHoursAtExecution != null ? row.runningHoursAtExecution.toLocaleString() : "—"}</span>}
                              </td>
                            )}

                            {/* Resultado / Observaciones */}
                            <td className="px-1 py-1">
                              {isAdmin
                                ? <TextCell value={row.observations} resetKey={errTick} onCommit={v => patchExec(row, { observations: v })} />
                                : <span className={ro} title={row.observations ?? undefined}>{row.observations ?? "—"}</span>}
                            </td>

                            {/* Estado (read-only) */}
                            <td className="px-2 py-1 align-middle w-28">
                              <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-fg/5 border border-fg/10 text-text-industrial">{statusLabel(row.status)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-fg/10 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 transition-all">
            {t("mp.modal.close")}
          </button>
        </div>
      </div>
    </div>
  );
};
