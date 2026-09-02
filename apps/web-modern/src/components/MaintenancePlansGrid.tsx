import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, ScrollText } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { fmtDate } from "../lib/utils";
import { FormModal } from "./FormModal";
import { AlertDialog } from "./AlertDialog";
import { CRITERIA_SOURCES, type CriteriaSource } from "../lib/criteria-source";
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
  "bundle", "open", "sfi", "taskCode", "equipo", "title", "criteriaSource", "freqType", "freqValue",
  "estimatedHours", "lastExecution", "nextDue", "status", "actions",
] as const;
type ColId = (typeof COL_IDS)[number];
const DEFAULT_WIDTHS: Record<ColId, number> = {
  bundle: 34, open: 34, sfi: 64, taskCode: 132, equipo: 200, title: 260, criteriaSource: 150, freqType: 112,
  freqValue: 80, estimatedHours: 80, lastExecution: 140, nextDue: 150, status: 124, actions: 150,
};
const MIN_WIDTHS: Record<ColId, number> = {
  bundle: 34, open: 34, sfi: 44, taskCode: 90, equipo: 110, title: 120, criteriaSource: 100, freqType: 90,
  freqValue: 56, estimatedHours: 56, lastExecution: 96, nextDue: 96, status: 96, actions: 110,
};
// Se versiona la clave con cada cambio de layout: los anchos guardados son de la
// grilla anterior y reusarlos la deja desalineada. v2 agregó "Origen"; v3, la
// casilla para juntar ítems en una sola OT.
const COL_WIDTHS_LS_KEY = "mp.grid.colWidths.v3";

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
  // ── Juntar ítems del PDM en UNA sola OT ────────────────────────────────────
  // Mismo mecanismo que la vista lista; el estado vive en el padre para que la
  // selección sobreviva al cambio de vista. Sin `onToggleBundle` la columna no
  // se dibuja: la planilla sigue sirviendo igual sin esto.
  bundleIds?: string[];
  /** Buque del primer ítem marcado: una OT no mezcla buques. */
  bundleVessel?: string | null;
  onToggleBundle?: (row: MaintenancePlan) => void;
}

type SortKey =
  | "sfi" | "taskCode" | "equipo" | "title" | "criteriaSource" | "freqType" | "freqValue"
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

// ─── Asignación masiva del origen del criterio (ISM 10.1) ───────────────────
//
// Un buque tiene cientos de planes históricos sin origen declarado. Abrirlos de
// a uno para elegir un valor de una lista de cinco no es un trabajo que alguien
// termine, así que se asigna sobre las filas que la planilla YA está mostrando
// (con sus filtros de buque / grupo SFI / búsqueda puestos): el usuario filtra
// lo que comparte un mismo origen y lo aplica de una vez.
//
// Por defecto sólo completa las vacías. Pisar clasificaciones ya hechas es una
// decisión aparte, que hay que elegir a mano.

const BulkCriteriaSourceDialog: React.FC<{
  rows: MaintenancePlan[];
  onClose: () => void;
  onDone: (updated: number, value: CriteriaSource, onlyEmpty: boolean) => void;
}> = ({ rows, onClose, onDone }) => {
  const t = useT();
  const [value, setValue] = useState<CriteriaSource | "">("");
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const emptyCount = rows.filter(r => !r.criteriaSource).length;

  const apply = async () => {
    if (!value) { setAlert(t("mp.bulkCs.needSource")); return; }
    const target = onlyEmpty ? rows.filter(r => !r.criteriaSource) : rows;
    if (target.length === 0) { setAlert(t("mp.bulkCs.nothingToDo")); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<{ updated: number }>("/app/pms/maintenance-plans/bulk-criteria-source", {
        ids: target.map(r => r.id),
        criteriaSource: value,
        onlyEmpty,
      });
      onDone(res.updated ?? 0, value, onlyEmpty);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("mp.grid.saveError"));
      setSaving(false);
    }
  };

  return (
    <>
      <FormModal
        title={t("mp.bulkCs.title")}
        onClose={onClose}
        error={error}
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs font-medium text-fg/70 hover:bg-fg/10 transition-all"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={saving}
              className="px-3 py-2 rounded-xl bg-accent/15 border border-accent/50 text-xs font-bold text-accent hover:bg-accent/25 transition-all disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t("mp.bulkCs.apply")}
            </button>
          </>
        }
      >
        <p className="text-[11px] text-text-industrial/60">
          {t("mp.bulkCs.intro").replace("{total}", String(rows.length))}
        </p>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-text-industrial/50">
            {t("mp.criteriaSource")}
          </label>
          <select
            value={value}
            onChange={e => setValue(e.target.value as CriteriaSource | "")}
            className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
          >
            <option value="">—</option>
            {CRITERIA_SOURCES.map(cs => <option key={cs} value={cs}>{t(`mp.cs.${cs}` as any)}</option>)}
          </select>
        </div>

        <div className="space-y-1.5">
          {([true, false] as const).map(only => (
            <label key={String(only)} className="flex items-start gap-2 text-[11px] text-fg/80 cursor-pointer">
              <input
                type="radio"
                name="bulkCsScope"
                checked={onlyEmpty === only}
                onChange={() => setOnlyEmpty(only)}
                className="mt-0.5 accent-[var(--accent,#2563eb)]"
              />
              <span>
                {only
                  ? t("mp.bulkCs.scopeEmpty").replace("{n}", String(emptyCount))
                  : t("mp.bulkCs.scopeAll").replace("{n}", String(rows.length))}
              </span>
            </label>
          ))}
        </div>
      </FormModal>
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </>
  );
};

// ─── Main grid ──────────────────────────────────────────────────────────────

export const MaintenancePlansGrid: React.FC<Props> = ({
  plans, isAdmin, vesselNameMap, renderStatus, renderActions, statusValue, onOpenDetail, emptyText,
  bundleIds, bundleVessel, onToggleBundle,
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
  const [bulkCsOpen, setBulkCsOpen] = useState(false);
  const [bulkCsDone, setBulkCsDone] = useState<string | null>(null);

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
      case "criteriaSource": return row.criteriaSource ?? null;
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
        {id !== "open" && id !== "bundle" && (
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

  // La asignación masiva trabaja sobre lo que la planilla está mostrando, no
  // sobre toda la base: lo que se ve es lo que se cambia.
  const applyBulkCriteria = useCallback((updated: number, value: CriteriaSource, onlyEmpty: boolean) => {
    const ids = new Set((onlyEmpty ? rows.filter(r => !r.criteriaSource) : rows).map(r => r.id));
    setRows(rs => rs.map(r => (ids.has(r.id) ? { ...r, criteriaSource: value } : r)));
    setBulkCsOpen(false);
    setBulkCsDone(t("mp.bulkCs.done").replace("{n}", String(updated)));
  }, [rows, t]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <p className="text-[11px] text-text-industrial/50">
          {isAdmin ? t("mp.grid.editHint") : t("mp.grid.readonlyHint")}
        </p>
        {isAdmin && rows.length > 0 && (
          <button
            type="button"
            onClick={() => setBulkCsOpen(true)}
            title={t("mp.criteriaSource.hint")}
            className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-fg/5 border border-fg/10 text-[11px] font-medium text-fg/70 hover:border-accent/40 hover:bg-accent/10 hover:text-accent transition-all"
          >
            <ScrollText className="w-3.5 h-3.5" />
            {t("mp.bulkCs.button")}
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-fg/10">
        <table className="border-collapse text-fg table-fixed" style={{ width: tableWidth }}>
          <colgroup>
            {COL_IDS.map(id => <col key={id} style={{ width: widthOf(id) }} />)}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-fg/10">
              {onToggleBundle && renderHeader("bundle", "OT")}
              {renderHeader("open", "")}
              {renderHeader("sfi", t("mp.grid.sfi"), "sfi")}
              {renderHeader("taskCode", t("mp.grid.taskCode"), "taskCode")}
              {renderHeader("equipo", t("mp.grid.equipo"), "equipo")}
              {renderHeader("title", t("mp.grid.title"), "title")}
              {renderHeader("criteriaSource", t("mp.grid.criteriaSource"), "criteriaSource")}
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
              <tr><td colSpan={COL_IDS.length} className="px-4 py-10 text-center text-xs text-text-industrial/40">{emptyText}</td></tr>
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
                  {/* Marcar para juntarlo con otros ítems en UNA sola OT. */}
                  {onToggleBundle && (() => {
                    const checked = (bundleIds ?? []).includes(row.id);
                    const blocked = !!bundleVessel && bundleVessel !== row.vesselCode && !checked;
                    return (
                      <td className="px-1 py-1 align-middle">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={blocked}
                          onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); onToggleBundle(row); }}
                          title={blocked ? t("mp.bundle.otherVessel") : t("mp.bundle.mark")}
                          className="w-3.5 h-3.5 accent-accent cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        />
                      </td>
                    );
                  })()}

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

                  {/* Origen del criterio (ISM 10.1) — vacío se resalta: es el
                      pendiente que el panel del Capítulo 10 cuenta como faltante. */}
                  <td className="px-1 py-1">
                    {isAdmin ? (
                      <select
                        className={cellCls + (row.criteriaSource ? "" : " text-amber-600 dark:text-amber-400")}
                        value={row.criteriaSource ?? ""}
                        onChange={e => patchRow(row, { criteriaSource: (e.target.value || null) as CriteriaSource | null })}
                      >
                        <option value="">{t("mp.cs.none")}</option>
                        {CRITERIA_SOURCES.map(cs => <option key={cs} value={cs}>{t(`mp.cs.${cs}` as any)}</option>)}
                      </select>
                    ) : (
                      <span className={ro + (row.criteriaSource ? "" : " text-amber-600 dark:text-amber-400")}>
                        {row.criteriaSource ? t(`mp.cs.${row.criteriaSource}` as any) : t("mp.cs.none")}
                      </span>
                    )}
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

      {bulkCsOpen && (
        <BulkCriteriaSourceDialog
          rows={rows}
          onClose={() => setBulkCsOpen(false)}
          onDone={applyBulkCriteria}
        />
      )}
      {bulkCsDone && <AlertDialog message={bulkCsDone} onClose={() => setBulkCsDone(null)} />}
    </div>
  );
};
