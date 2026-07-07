import React, { useCallback, useEffect, useRef, useState } from "react";
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

interface Asset { id: string; assetCode: string; name: string | null }

interface Props {
  plans: MaintenancePlan[];
  isAdmin: boolean;
  vesselNameMap: Map<string, string>;
  renderStatus: (row: MaintenancePlan) => React.ReactNode;
  renderActions: (row: MaintenancePlan) => React.ReactNode;
  onOpenDetail: (row: MaintenancePlan) => void;
  emptyText: string;
}

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
  plans, isAdmin, vesselNameMap, renderStatus, renderActions, onOpenDetail, emptyText,
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

  const th = "px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-industrial/50 whitespace-nowrap";

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-industrial/50 px-1">
        {isAdmin ? t("mp.grid.editHint") : t("mp.grid.readonlyHint")}
      </p>
      <div className="overflow-x-auto rounded-xl border border-fg/10">
        <table className="w-full border-collapse text-fg">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-fg/10">
              <th className={th} style={{ width: 34 }} />
              <th className={th}>{t("mp.grid.sfi")}</th>
              <th className={th}>{t("mp.grid.taskCode")}</th>
              <th className={th} style={{ minWidth: 180 }}>{t("mp.grid.equipo")}</th>
              <th className={th} style={{ minWidth: 220 }}>{t("mp.grid.title")}</th>
              <th className={th}>{t("mp.grid.freqType")}</th>
              <th className={th}>{t("mp.grid.freqValue")}</th>
              <th className={th}>{t("mp.grid.estimatedHours")}</th>
              <th className={th}>{t("mp.col.lastExecution")}</th>
              <th className={th}>{t("mp.col.nextDue")}</th>
              <th className={th}>{t("mp.col.status")}</th>
              <th className={th}>{t("mp.col.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-fg/5">
            {rows.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-10 text-center text-xs text-text-industrial/40">{emptyText}</td></tr>
            )}
            {rows.map(row => {
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
