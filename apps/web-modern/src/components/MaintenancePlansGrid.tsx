import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { fmtDate } from "../lib/utils";
import type { MaintenancePlan } from "../pages/MaintenancePlans";

// Planilla compacta estilo Excel para Plan de Mantenimiento.
// - Solo lectura para todos; edición inline solo si `isAdmin`.
// - Cada celda guarda al salir del campo (blur) o al cambiar (selects), vía el
//   PATCH existente `/app/pms/maintenance-plans/:id`, enviando solo lo cambiado.
// - `renderStatus` / `renderActions` se reciben del padre para reutilizar
//   StatusBadgeInline y los botones Ejecutar/Reportar sin duplicar lógica.

const TRIGGER_TYPES = ["MONTHS", "HOURS", "CALENDAR", "RUNNING_HOURS", "CONDITION", "EVENT", "DAY", "WEEK"] as const;
const SFI_GROUPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const isHoursTT = (tt: string) => tt === "HOURS" || tt === "RUNNING_HOURS";

// Columnas en orden de render. Anchos ajustables (drag en el borde del encabezado),
// persistidos en localStorage.
const COL_IDS = [
  "open", "sfi", "taskCode", "equipo", "title", "freqType", "freqValue",
  "estimatedHours", "lastExecution", "nextDue", "status", "actions",
] as const;
type ColId = (typeof COL_IDS)[number];
const DEFAULT_WIDTHS: Record<ColId, number> = {
  open: 34, sfi: 64, taskCode: 132, equipo: 200, title: 260, freqType: 112,
  freqValue: 80, estimatedHours: 80, lastExecution: 140, nextDue: 150, status: 124, actions: 150,
};
const MIN_WIDTHS: Record<ColId, number> = {
  open: 34, sfi: 44, taskCode: 90, equipo: 110, title: 120, freqType: 90,
  freqValue: 56, estimatedHours: 56, lastExecution: 96, nextDue: 96, status: 96, actions: 110,
};
const COL_WIDTHS_LS_KEY = "mp.grid.colWidths";

interface Asset { id: string; assetCode: string; name: string | null }

interface Props {
  plans: MaintenancePlan[];
  isAdmin: boolean;
  vesselNameMap: Map<string, string>;
  renderStatus: (row: MaintenancePlan) => React.ReactNode;
  renderActions: (row: MaintenancePlan) => React.ReactNode;
  statusValue: (row: MaintenancePlan) => string;
  onOpenDetail: (row: MaintenancePlan) => void;
  emptyText: string;
}

type SortKey =
  | "sfi" | "taskCode" | "equipo" | "title" | "freqType" | "freqValue"
  | "estimatedHours" | "lastExecution" | "nextDue" | "status";

function mergeDefined<T extends object>(base: T, patch: Partial<T>): T {
  const out = { ...base };
  (Object.keys(patch) as (keyof T)[]).forEach(k => {
    if (patch[k] !== undefined) out[k] = patch[k] as T[keyof T];
  });
  return out;
}

const cellCls =
  "w-full bg-transparent text-[11px] text-fg px-1.5 py-1 rounded border border-transparent " +
  "hover:border-fg/15 focus:border-accent/60 focus:bg-fg/5 focus:outline-none transition-colors";

// ─── Editable cells ─────────────────────────────────────────────────────────

const TextCell: React.FC<{
  value: string | null;
  onCommit: (v: string) => void;
  resetKey: number;
  mono?: boolean;
  upper?: boolean;
  required?: boolean;
}> = ({ value, onCommit, resetKey, mono, upper, required }) => {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value, resetKey]);
  const commit = () => {
    const nv = draft.trim();
    if (required && nv === "") { setDraft(value ?? ""); return; }
    if (nv !== (value ?? "")) onCommit(upper ? nv.toUpperCase() : nv);
  };
  return (
    <input
      className={cellCls + (mono ? " font-mono" : "")}
      value={draft}
      onChange={e => setDraft(upper ? e.target.value.toUpperCase() : e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setDraft(value ?? ""); e.currentTarget.blur(); }
      }}
    />
  );
};

const NumberCell: React.FC<{
  value: number | null;
  onCommit: (v: number | null) => void;
  resetKey: number;
}> = ({ value, onCommit, resetKey }) => {
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

const DateCell: React.FC<{
  value: string | null;
  onCommit: (v: string | null) => void;
  resetKey: number;
}> = ({ value, onCommit, resetKey }) => {
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

// ─── Read-only display helpers ──────────────────────────────────────────────

const ro = "text-[11px] text-fg/90 px-1.5 py-1 block truncate";
const roMono = ro + " font-mono";

// ─── Main grid ──────────────────────────────────────────────────────────────

export const MaintenancePlansGrid: React.FC<Props> = ({
  plans, isAdmin, vesselNameMap, renderStatus, renderActions, statusValue, onOpenDetail, emptyText,
}) => {
  const t = useT();
  const [rows, setRows] = useState<MaintenancePlan[]>(plans);
  useEffect(() => setRows(plans), [plans]);

  const [assetsByVessel, setAssetsByVessel] = useState<Record<string, Asset[]>>({});
  const requestedVessels = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isAdmin) return;
    Array.from(new Set(plans.map(p => p.vesselCode))).forEach(vc => {
      if (requestedVessels.current.has(vc)) return;
      requestedVessels.current.add(vc);
      api.get<{ items: Asset[] }>(`/app/pms/assets?vesselCode=${encodeURIComponent(vc)}&limit=500`)
        .then(res => setAssetsByVessel(m => ({ ...m, [vc]: res.items ?? [] })))
        .catch(() => setAssetsByVessel(m => ({ ...m, [vc]: [] })));
    });
  }, [plans, isAdmin]);

  const [savingId, setSavingId] = useState<string | null>(null);
  const [errById, setErrById] = useState<Record<string, string>>({});
  const [errTick, setErrTick] = useState(0);

  const patchRow = useCallback(async (
    row: MaintenancePlan,
    patch: Partial<MaintenancePlan>,
    optimistic?: Partial<MaintenancePlan>,
  ) => {
    setSavingId(row.id);
    setErrById(e => { const next = { ...e }; delete next[row.id]; return next; });
    try {
      const updated = await api.patch<Partial<MaintenancePlan>>(`/app/pms/maintenance-plans/${row.id}`, patch);
      setRows(rs => rs.map(r => (r.id === row.id ? mergeDefined({ ...r, ...(optimistic ?? {}) }, updated) : r)));
    } catch (err) {
      setErrById(e => ({ ...e, [row.id]: err instanceof ApiError ? err.message : t("mp.grid.saveError") }));
      setErrTick(x => x + 1); // fuerza a las celdas a revertir su draft al valor guardado
    } finally {
      setSavingId(s => (s === row.id ? null : s));
    }
  }, [t]);

  // ── Orden por columna (clic en encabezado) ────────────────────────────────
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); }
    else setSortDir(d => (d === "asc" ? "desc" : "asc"));
  };

  const sortVal = useCallback((row: MaintenancePlan, key: SortKey): string | number | null => {
    const hb = isHoursTT(row.triggerType);
    switch (key) {
      case "sfi": return row.sfiGroupNumber ?? null;
      case "taskCode": return row.taskCode ?? null;
      case "equipo": return (row.assetName ?? row.assetId ?? "").toLowerCase();
      case "title": return (row.title ?? "").toLowerCase();
      case "freqType": return row.triggerType ?? null;
      case "freqValue": return (hb ? row.frequencyHours : row.frequencyMonths) ?? null;
      case "estimatedHours": return row.estimatedHours ?? null;
      case "lastExecution": return hb ? (row.lastExecutionHours ?? null) : (row.lastExecutionDate ?? null);
      case "nextDue": return hb ? (row.nextDueHours ?? null) : (row.nextDueDate ?? null);
      case "status": return statusValue(row);
      default: return null;
    }
  }, [statusValue]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortVal(a, sortKey);
      const bv = sortVal(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;   // vacíos al final, sin importar la dirección
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [rows, sortKey, sortDir, sortVal]);

  // ── Ancho de columnas ajustable (drag) + persistencia ─────────────────────
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    let saved: Record<string, number> = {};
    try { saved = JSON.parse(localStorage.getItem(COL_WIDTHS_LS_KEY) || "{}"); } catch { /* ignore */ }
    return { ...DEFAULT_WIDTHS, ...saved };
  });
  const resizing = useRef<{ id: ColId; startX: number; startW: number } | null>(null);
  const startResize = (id: ColId) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { id, startX: e.clientX, startW: colWidths[id] ?? DEFAULT_WIDTHS[id] };
    const onMove = (ev: MouseEvent) => {
      const r = resizing.current;
      if (!r) return;
      const w = Math.max(MIN_WIDTHS[r.id], r.startW + (ev.clientX - r.startX));
      setColWidths(prev => ({ ...prev, [r.id]: w }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      resizing.current = null;
      document.body.style.cursor = "";
      setColWidths(prev => { try { localStorage.setItem(COL_WIDTHS_LS_KEY, JSON.stringify(prev)); } catch { /* ignore */ } return prev; });
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const widthOf = (id: ColId) => colWidths[id] ?? DEFAULT_WIDTHS[id];
  const tableWidth = COL_IDS.reduce((s, id) => s + widthOf(id), 0);

  const th = "px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-industrial/50 whitespace-nowrap";
  const renderHeader = (id: ColId, label: string, key?: SortKey) => {
    const active = key != null && sortKey === key;
    return (
      <th className={`${th} relative`}>
        {key ? (
          <button
            type="button"
            onClick={() => toggleSort(key)}
            className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-fg transition-colors select-none max-w-full overflow-hidden"
          >
            <span className="truncate">{label}</span>
            <span className={active ? "text-accent" : "opacity-40"}>{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
          </button>
        ) : (
          <span className="truncate block">{label}</span>
        )}
        {id !== "open" && (
          <div
            onMouseDown={startResize(id)}
            onClick={e => e.stopPropagation()}
            title={t("mp.grid.resizeHint")}
            className="absolute top-0 right-0 h-full w-2 cursor-col-resize select-none hover:bg-accent/40 active:bg-accent/60"
          />
        )}
      </th>
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-industrial/50 px-1">
        {isAdmin ? t("mp.grid.editHint") : t("mp.grid.readonlyHint")}
      </p>
      <div className="overflow-x-auto rounded-xl border border-fg/10">
        <table className="border-collapse text-fg table-fixed" style={{ width: tableWidth }}>
          <colgroup>
            {COL_IDS.map(id => <col key={id} style={{ width: widthOf(id) }} />)}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-fg/10">
              {renderHeader("open", "")}
              {renderHeader("sfi", t("mp.grid.sfi"), "sfi")}
              {renderHeader("taskCode", t("mp.grid.taskCode"), "taskCode")}
              {renderHeader("equipo", t("mp.grid.equipo"), "equipo")}
              {renderHeader("title", t("mp.grid.title"), "title")}
              {renderHeader("freqType", t("mp.grid.freqType"), "freqType")}
              {renderHeader("freqValue", t("mp.grid.freqValue"), "freqValue")}
              {renderHeader("estimatedHours", t("mp.grid.estimatedHours"), "estimatedHours")}
              {renderHeader("lastExecution", t("mp.col.lastExecution"), "lastExecution")}
              {renderHeader("nextDue", t("mp.col.nextDue"), "nextDue")}
              {renderHeader("status", t("mp.col.status"), "status")}
              {renderHeader("actions", t("mp.col.actions"))}
            </tr>
          </thead>
          <tbody className="divide-y divide-fg/5">
            {sortedRows.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-10 text-center text-xs text-text-industrial/40">{emptyText}</td></tr>
            )}
            {sortedRows.map(row => {
              const assets = assetsByVessel[row.vesselCode] ?? [];
              const hoursBased = isHoursTT(row.triggerType);
              const err = errById[row.id];
              const borderCls = savingId === row.id
                ? "border-l-accent"
                : err ? "border-l-red-500" : "border-l-transparent";
              return (
                <tr
                  key={row.id}
                  title={err ?? undefined}
                  className={`border-l-2 ${borderCls} hover:bg-fg/[0.03] align-top`}
                >
                  {/* open detail */}
                  <td className="px-1 py-1 align-middle">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(row)}
                      title={t("mp.col.actions")}
                      className="p-1 rounded text-text-industrial/40 hover:text-accent hover:bg-accent/10 transition-colors"
                    >
                      {savingId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                    </button>
                  </td>

                  {/* SFI */}
                  <td className="px-1 py-1 w-16">
                    {isAdmin ? (
                      <select
                        className={cellCls + " font-mono"}
                        value={row.sfiGroupNumber ?? ""}
                        onChange={e => patchRow(row, { sfiGroupNumber: e.target.value === "" ? null : Number(e.target.value) })}
                      >
                        <option value="">—</option>
                        {SFI_GROUPS.map(g => <option key={g} value={g}>G{g}</option>)}
                      </select>
                    ) : (
                      <span className={roMono}>{row.sfiGroupNumber != null ? `G${row.sfiGroupNumber}` : "—"}</span>
                    )}
                  </td>

                  {/* Task code + vessel */}
                  <td className="px-1 py-1 w-40">
                    {isAdmin
                      ? <TextCell value={row.taskCode} resetKey={errTick} mono upper required onCommit={v => patchRow(row, { taskCode: v })} />
                      : <span className={roMono}>{row.taskCode}</span>}
                    <span className="block text-[10px] text-accent/80 px-1.5 leading-tight truncate">
                      {vesselNameMap.get(row.vesselCode) ?? row.vesselCode}
                    </span>
                    {err && <span className="block text-[10px] text-red-600 dark:text-red-400 px-1.5 leading-tight">{err}</span>}
                  </td>

                  {/* Equipo (asset dropdown) */}
                  <td className="px-1 py-1">
                    {isAdmin ? (
                      <select
                        className={cellCls}
                        value={row.assetId}
                        disabled={assets.length === 0}
                        onChange={e => {
                          const a = assets.find(x => x.id === e.target.value);
                          patchRow(row, { assetId: e.target.value }, { assetName: a?.name ?? a?.assetCode ?? null });
                        }}
                      >
                        {!assets.some(a => a.id === row.assetId) && (
                          <option value={row.assetId}>{row.assetName ?? row.assetId}</option>
                        )}
                        {assets.map(a => <option key={a.id} value={a.id}>{a.name ?? a.assetCode}</option>)}
                      </select>
                    ) : (
                      <span className={ro}>{row.assetName ?? row.assetId}</span>
                    )}
                  </td>

                  {/* Título */}
                  <td className="px-1 py-1">
                    {isAdmin
                      ? <TextCell value={row.title} resetKey={errTick} required onCommit={v => patchRow(row, { title: v })} />
                      : <span className={ro} title={row.title}>{row.title}</span>}
                  </td>

                  {/* Frecuencia (tipo) */}
                  <td className="px-1 py-1 w-32">
                    {isAdmin ? (
                      <select
                        className={cellCls + " font-mono"}
                        value={row.triggerType}
                        onChange={e => patchRow(row, { triggerType: e.target.value })}
                      >
                        {TRIGGER_TYPES.map(tt => <option key={tt} value={tt}>{tt}</option>)}
                      </select>
                    ) : (
                      <span className={roMono}>{row.triggerType}</span>
                    )}
                  </td>

                  {/* Frecuencia (valor) */}
                  <td className="px-1 py-1 w-20">
                    {isAdmin ? (
                      hoursBased
                        ? <NumberCell value={row.frequencyHours} resetKey={errTick} onCommit={v => patchRow(row, { frequencyHours: v })} />
                        : <NumberCell value={row.frequencyMonths} resetKey={errTick} onCommit={v => patchRow(row, { frequencyMonths: v })} />
                    ) : (
                      <span className={roMono}>{(hoursBased ? row.frequencyHours : row.frequencyMonths) ?? "—"}</span>
                    )}
                  </td>

                  {/* Horas estimadas */}
                  <td className="px-1 py-1 w-20">
                    {isAdmin
                      ? <NumberCell value={row.estimatedHours} resetKey={errTick} onCommit={v => patchRow(row, { estimatedHours: v })} />
                      : <span className={roMono}>{row.estimatedHours ?? "—"}</span>}
                  </td>

                  {/* Última ejecución */}
                  <td className="px-1 py-1 w-32">
                    {isAdmin ? (
                      hoursBased
                        ? <NumberCell value={row.lastExecutionHours} resetKey={errTick} onCommit={v => patchRow(row, { lastExecutionHours: v })} />
                        : <DateCell value={row.lastExecutionDate} resetKey={errTick} onCommit={v => patchRow(row, { lastExecutionDate: v })} />
                    ) : (
                      <span className={roMono}>
                        {hoursBased
                          ? (row.lastExecutionHours != null ? `${row.lastExecutionHours.toLocaleString()} hs` : "—")
                          : (fmtDate(row.lastExecutionDate) ?? "—")}
                      </span>
                    )}
                  </td>

                  {/* Próximo vencimiento */}
                  <td className="px-1 py-1 w-32">
                    {isAdmin ? (
                      hoursBased
                        ? <NumberCell value={row.nextDueHours} resetKey={errTick} onCommit={v => patchRow(row, { nextDueHours: v })} />
                        : <DateCell value={row.nextDueDate} resetKey={errTick} onCommit={v => patchRow(row, { nextDueDate: v })} />
                    ) : (
                      <span className={roMono}>
                        {hoursBased
                          ? (row.nextDueHours != null ? `${row.nextDueHours.toLocaleString()} hs` : "—")
                          : (fmtDate(row.nextDueDate) ?? "—")}
                      </span>
                    )}
                  </td>

                  {/* Status (read-only) */}
                  <td className="px-2 py-1 align-middle w-28">{renderStatus(row)}</td>

                  {/* Acciones */}
                  <td className="px-2 py-1 align-middle">{renderActions(row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
