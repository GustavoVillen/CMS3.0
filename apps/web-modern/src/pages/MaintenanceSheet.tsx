// PLANILLA DE A BORDO — la planilla de papel del armador, en pantalla.
//
// Es la misma planilla que exporta a Excel el botón de Plan de Mantenimiento
// (mismo agrupado por sistema, mismo número de ítem, mismo semáforo): la arma el
// modelo compartido `lib/maintenance-sheet-model.ts`. Existe porque los Jefes de
// Máquinas trabajan sobre esa planilla, no sobre una lista de fichas, y acá
// pueden además:
//
//   · marcar varias tareas y abrir UNA sola OT con todas adentro — el backend
//     crea una SS por taller (no una por tarea) cuando alguna es tercerizada;
//   · corregir "Última verificación" y "Próximo recorrido" en la misma celda,
//     si el usuario tiene permiso.
//
// Todo lo que decide (qué OT, qué SS, quién puede qué) lo resuelve el backend en
// `POST /app/pms/maintenance-plans/:id/open-work-order` y el PATCH del plan.
// Acá no hay reglas de negocio propias, y no debería agregarse ninguna.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Loader2, Search, Wrench, X } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { AlertDialog } from "../components/AlertDialog";
import { DateCell, NumberCell } from "../components/InlineCells";
import { CreateWorkOrderModal, buildWoPrefillFromPlan, type WoPrefill } from "../components/CreateWorkOrderModal";
import { api, ApiError } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { useAuth, useCan } from "../lib/auth";
import { useT, type TranslationKey } from "../lib/i18n";
import { useVesselContext } from "../lib/vessel-context";
import {
  type AssetInfo, type SheetPlan, type SheetGroup,
  ICON_PROVIDER,
  NO_GROUP, buildSheetGroups, isHours, isMonths,
  providerIdsOf, providerNamesOf, severityOf, severityOfRow, fmtDate,
} from "../lib/maintenance-sheet-model";

/** Lo que agrega la lista de planes por encima de lo que usa la planilla. */
type SheetRow = SheetPlan & {
  status?: string | null;
  /** Código de la OT abierta que ya cubre esta tarea (PLANNED / IN_PROGRESS). */
  activeWorkOrderCode?: string | null;
  vesselCode?: string;
};

const NUM_LOCALE = "es-AR";
const fmtHours = (n: number) => n.toLocaleString(NUM_LOCALE);

/** Celda de última verificación / próximo recorrido en modo lectura. */
function milestoneText(p: SheetRow, which: "last" | "next"): string {
  if (isHours(p.triggerType)) {
    const h = which === "last" ? p.lastExecutionHours : p.nextDueHours;
    return h == null ? "N/A" : fmtHours(h);
  }
  return fmtDate(which === "last" ? p.lastExecutionDate : p.nextDueDate) ?? "N/A";
}

export function MaintenanceSheetPage() {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const { selectedVesselCode, selectedVessel } = useVesselContext();

  // Corregir la última verificación es gestión del plan. Fijar el PRÓXIMO
  // vencimiento a mano pisa el cálculo automático y el backend lo reserva al rol
  // literal TENANT_ADMIN: la celda se muestra editable sólo a quien va a poder
  // guardarla, para no ofrecer un campo que después rebota con un error.
  const { user } = useAuth();
  const canEdit = can("plan.manage");
  const canEditNextDue = user?.role === "TENANT_ADMIN";

  const plansPath = selectedVesselCode ? "/app/pms/maintenance-plans?limit=2000" : null;
  const assetsPath = selectedVesselCode ? "/app/pms/assets?limit=500" : null;
  const { data, loading, error, reload } = useFetch<{ items: SheetRow[] }>(plansPath, [plansPath]);
  const { data: assetsData } = useFetch<{ items: AssetInfo[] }>(assetsPath, [assetsPath]);

  // Copia local: las celdas editables actualizan la fila sin recargar la lista.
  const [rows, setRows] = useState<SheetRow[]>([]);
  useEffect(() => {
    setRows((data?.items ?? []).filter(p => p.status !== "INACTIVE"));
  }, [data]);

  const assetById = useMemo(
    () => new Map((assetsData?.items ?? []).map(a => [a.id, a])),
    [assetsData],
  );

  // La planilla completa. Se arma con TODAS las tareas para que el número de
  // ítem no cambie al filtrar: es el mismo número que el papel.
  const sheet = useMemo(() => buildSheetGroups(rows, assetById), [rows, assetById]);

  // ── Filtros de pantalla (el papel no los tiene, la pantalla sí los necesita) ─
  const [query, setQuery] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);
  const visible: SheetGroup[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && !onlyDue) return sheet;
    return sheet
      .map(g => ({
        ...g,
        blocks: g.blocks
          .map(b => ({
            ...b,
            plans: b.plans.filter(p => {
              if (onlyDue && severityOf(p) === "none") return false;
              if (!q) return true;
              return `${b.name} ${p.title} ${p.taskCode}`.toLowerCase().includes(q);
            }),
          }))
          .filter(b => b.plans.length > 0),
      }))
      .filter(g => g.blocks.length > 0);
  }, [sheet, query, onlyDue]);

  const totalTasks = useMemo(
    () => visible.reduce((n, g) => n + g.blocks.reduce((m, b) => m + b.plans.length, 0), 0),
    [visible],
  );

  // ── Selección para armar UNA OT ────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const toggle = useCallback((id: string) => {
    setSelectedIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));
  }, []);

  // En ORDEN DE PLANILLA, no en orden de clic: el primero de la planilla es el
  // ítem principal de la OT (da equipo y título), y así el resultado no depende
  // de en qué orden fue tildando el usuario.
  const selectedPlans = useMemo(() => {
    const out: SheetRow[] = [];
    for (const g of sheet) for (const b of g.blocks) for (const p of b.plans) {
      if (selectedSet.has(p.id)) out.push(p as SheetRow);
    }
    return out;
  }, [sheet, selectedSet]);

  // Cuántas SS va a abrir la OT: UNA POR TALLER, mismo criterio que el backend.
  const providersOfSelection = useMemo(() => {
    const map = new Map<string, string>();   // providerId → nombre
    for (const p of selectedPlans) {
      const names = providerNamesOf(p);
      providerIdsOf(p).forEach((id, i) => map.set(id, names[i] ?? names[0] ?? ""));
    }
    return map;
  }, [selectedPlans]);

  const selectionHasOos = useMemo(() => {
    const oosBlocks = new Set<string>();
    for (const g of sheet) for (const b of g.blocks) if (b.outOfService) oosBlocks.add(b.key);
    for (const g of sheet) for (const b of g.blocks) {
      if (!oosBlocks.has(b.key)) continue;
      if (b.plans.some(p => selectedSet.has(p.id))) return true;
    }
    return false;
  }, [sheet, selectedSet]);

  // ── Crear la OT (+ SS) con lo marcado ──────────────────────────────────────
  const [prefill, setPrefill] = useState<WoPrefill | null>(null);
  const [creating, setCreating] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const createWorkOrder = useCallback(async () => {
    if (selectedPlans.length === 0 || creating) return;
    setCreating(true);
    try {
      // El modal necesita el plan COMPLETO (criterios, LOTO, riesgo): la lista
      // los omite para aligerar el payload.
      const primary = await api.get<Parameters<typeof buildWoPrefillFromPlan>[0]>(
        `/app/pms/maintenance-plans/${selectedPlans[0]!.id}`,
      );
      setPrefill(buildWoPrefillFromPlan(
        primary,
        t("mp.modal.maintenancePlanLabel"),
        selectedPlans.slice(1).map(p => ({
          id: p.id, taskCode: p.taskCode, title: p.title, assetName: p.assetName ?? null,
        })),
      ));
    } catch (err) {
      setAlert(err instanceof ApiError ? err.message : t("msheet.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [selectedPlans, creating, t]);

  // ── Edición de las dos fechas ──────────────────────────────────────────────
  const [savingId, setSavingId] = useState<string | null>(null);
  const [resetTick, setResetTick] = useState(0);
  const patchPlan = useCallback(async (row: SheetRow, patch: Record<string, unknown>) => {
    setSavingId(row.id);
    try {
      const updated = await api.patch<Partial<SheetRow>>(`/app/pms/maintenance-plans/${row.id}`, patch);
      // El backend puede recalcular el próximo vencimiento a partir de la última
      // verificación: se toma lo que devolvió, no lo que se mandó.
      setRows(rs => rs.map(r => (r.id === row.id ? { ...r, ...updated } : r)));
    } catch (err) {
      setAlert(err instanceof ApiError ? err.message : t("mp.grid.saveError"));
      setResetTick(x => x + 1);   // las celdas vuelven al valor guardado
    } finally {
      setSavingId(s => (s === row.id ? null : s));
    }
  }, [t]);

  /** El plan de mantenimiento del equipo: la lista ya filtrada por ese equipo. */
  const openAssetPlans = useCallback((p: SheetRow) => {
    const vessel = p.vesselCode ?? selectedVesselCode ?? "";
    const asset = p.assetId ?? "";
    if (!vessel || !asset) return;
    navigate(`/maintenance-plans?vesselCode=${encodeURIComponent(vessel)}&assetId=${encodeURIComponent(asset)}`);
  }, [navigate, selectedVesselCode]);

  const groupTitle = useCallback((g: number): string => {
    if (g === NO_GROUP) return t("msheet.noGroup");
    return `G${g}: ${t(`sfi.g.${g}` as TranslationKey)}`;
  }, [t]);

  /** "Realizar cada": el número de horas, o el lapso en palabras. */
  const everyText = useCallback((p: SheetRow): string => {
    const tt = p.triggerType;
    if (isHours(tt)) return p.frequencyHours == null ? "—" : fmtHours(p.frequencyHours);
    const n = p.frequencyMonths;
    if (n == null) return "—";
    const unit = (one: TranslationKey, many: TranslationKey) => `${n} ${t(n === 1 ? one : many)}`;
    if (isMonths(tt)) return unit("msheet.every.month", "msheet.every.months");
    if (tt === "DAY") return unit("msheet.every.day", "msheet.every.days");
    if (tt === "WEEK") return unit("msheet.every.week", "msheet.every.weeks");
    if (tt === "CONDITION") return t("msheet.every.condition");
    if (tt === "EVENT") return t("msheet.every.event");
    return "—";
  }, [t]);

  // ─── Render ────────────────────────────────────────────────────────────────

  // Encabezado gris de la planilla de papel. Color sólido a propósito: es sticky,
  // y con un fondo translúcido las filas rojas se transparentan por debajo.
  const th = "px-2 py-1.5 text-[10px] font-bold text-[#1F3864] border border-border bg-[#D9E2E3] text-center";
  // Filas finas: entran muchas más tareas de un vistazo, que es para lo que se
  // usa la planilla. Las celdas editables también se achican (`[&_input]`), si no
  // el alto de la fila lo termina fijando el input y no el texto.
  const td = "px-2 py-0.5 text-[11px] leading-tight border border-border align-middle [&_input]:py-0";

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ClipboardList}
        title={selectedVessel?.name ? `${t("msheet.title")} — ${selectedVessel.name}` : t("msheet.title")}
        total={totalTasks}
        onReload={reload}
      >
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg/30" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t("common.search")}
            className="pl-8 pr-2 py-1.5 w-48 rounded-lg bg-fg/5 border border-fg/10 text-xs text-fg focus:border-accent/40 focus:outline-none"
          />
        </div>
        <button
          onClick={() => setOnlyDue(v => !v)}
          aria-pressed={onlyDue}
          className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
            onlyDue
              ? "bg-accent/20 border-accent/40 text-accent"
              : "bg-fg/5 border-fg/10 text-text-industrial hover:border-accent/30"
          }`}
        >
          {t("msheet.onlyDue")}
        </button>
        <button
          onClick={() => { void createWorkOrder(); }}
          disabled={selectedPlans.length === 0 || creating}
          title={selectedPlans.length === 0 ? t("msheet.createHintEmpty") : t("msheet.createHint")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent/40 bg-accent/15 text-accent text-xs font-bold hover:bg-accent/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
          {t("msheet.create")}
        </button>
      </PageHeader>

      {/* Barra de selección: qué se marcó y qué va a pasar al crear. */}
      {selectedPlans.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-xl bg-accent/5 border border-accent/20">
          <span className="text-xs font-bold text-accent">
            {selectedPlans.length === 1
              ? t("msheet.selectedOne")
              : t("msheet.selectedMany").replace("{n}", String(selectedPlans.length))}
          </span>
          <span className="text-[11px] text-text-industrial/70 font-mono">
            {selectedPlans.map(p => p.taskCode).join(" / ")}
          </span>
          <span className="text-[11px] font-bold text-fg/80">
            {providersOfSelection.size === 0
              ? t("msheet.willCreateWoOnly")
              : t("msheet.willCreateWoAndSr")
                  .replace("{n}", String(providersOfSelection.size))
                  .replace("{names}", [...providersOfSelection.values()].filter(Boolean).join(", "))}
          </span>
          {selectionHasOos && (
            <span className="text-[11px] font-bold text-red-600 dark:text-red-400">
              {t("msheet.selectionHasOos")}
            </span>
          )}
          <button
            onClick={() => setSelectedIds([])}
            className="ml-auto flex items-center gap-1 text-[11px] text-text-industrial/60 hover:text-fg"
          >
            <X className="w-3 h-3" /> {t("msheet.clearSelection")}
          </button>
        </div>
      )}

      {!selectedVesselCode ? (
        <div className="p-8 text-center text-sm text-text-industrial/60 rounded-xl border border-border bg-surface">
          {t("msheet.noVessel")}
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : error ? (
        <div className="p-8 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : visible.length === 0 ? (
        <div className="p-8 text-center text-sm text-text-industrial/60 rounded-xl border border-border bg-surface">
          {t("msheet.empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                {/* Ancha a propósito: cuando la tarea ya tiene una OT abierta,
                    acá va el número de orden entero, no una casilla. */}
                <th className={th + " w-28"}></th>
                <th className={th + " w-10"}>{t("msheet.col.item")}</th>
                <th className={th + " w-52"}>{t("msheet.col.description")}</th>
                <th className={th}>{t("msheet.col.task")}</th>
                <th className={th + " w-24"}>{t("msheet.col.every")}</th>
                <th className={th + " w-32"}>{t("msheet.col.lastCheck")}</th>
                <th className={th + " w-32"}>{t("msheet.col.nextDue")}</th>
                <th className={th + " w-40"}>{t("msheet.col.provider")}</th>
                <th className={th + " w-24"}>{t("msheet.col.outOfService")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(g => (
                <React.Fragment key={g.group}>
                  <tr>
                    <td colSpan={9} className="px-3 py-1 text-[11px] font-bold text-white bg-[#1F3864] border border-border">
                      {groupTitle(g.group)}
                    </td>
                  </tr>
                  {g.blocks.map(b => b.plans.map((plan, i) => {
                    const p = plan as SheetRow;
                    const sev = severityOfRow(p, b.outOfService);
                    // Semáforo de la planilla de papel: rojo vencida, amarillo por
                    // vencer, rosa el equipo fuera de servicio (no es un atraso: no
                    // hay nada que ejecutar hasta que la máquina vuelva).
                    // En las filas de color, las celdas editables tienen que tomar el
                    // color de la fila: con su color normal, la fecha sobre rojo no se lee.
                    const rowCls =
                      sev === "outOfService" ? "bg-[#FFE0E0] text-[#C00000] [&_input]:text-inherit"
                      : sev === "overdue" ? "bg-red-600 text-white [&_input]:text-inherit"
                      : sev === "soon" ? "bg-yellow-300 text-yellow-950 [&_input]:text-inherit"
                      : "text-fg/90 hover:bg-fg/5";
                    const hasWo = !!p.activeWorkOrderCode;
                    const selectable = p.status === "ACTIVE" && !hasWo;
                    const hb = isHours(p.triggerType);
                    const providers = providerNamesOf(p);
                    const isProvider = p.department === "PROVEEDOR";

                    return (
                      <tr key={p.id} className={rowCls}>
                        <td className={td + " text-center"}>
                          {hasWo ? (
                            <button
                              onClick={() => navigate(`/work-orders/${encodeURIComponent(p.activeWorkOrderCode!)}`)}
                              title={t("msheet.alreadyHasWo").replace("{code}", p.activeWorkOrderCode!)}
                              className="text-[10px] font-mono font-bold underline underline-offset-2 whitespace-nowrap"
                            >
                              {p.activeWorkOrderCode}
                            </button>
                          ) : (
                            <input
                              type="checkbox"
                              checked={selectedSet.has(p.id)}
                              disabled={!selectable}
                              onChange={() => toggle(p.id)}
                              title={t("msheet.markForWo")}
                              className="w-3.5 h-3.5 accent-accent cursor-pointer disabled:opacity-30"
                            />
                          )}
                        </td>

                        {/* Ítem, descripción del equipo y fuera de servicio: una
                            sola celda por bloque, como en la planilla de papel. */}
                        {i === 0 && (
                          <td rowSpan={b.plans.length} className={td + " text-center font-bold text-fg bg-surface"}>
                            {b.itemNumber}
                          </td>
                        )}
                        {/* El equipo lleva a SU plan de mantenimiento: la lista ya
                            filtrada por ese equipo, que es donde se lo administra. */}
                        {i === 0 && (
                          <td rowSpan={b.plans.length} className={td + " text-center font-bold bg-[#F8CBAD] text-[#1F3864] p-0"}>
                            <button
                              type="button"
                              onClick={() => openAssetPlans(b.plans[0]!)}
                              title={t("msheet.openAssetPlans")}
                              className="w-full h-full px-2 py-1 text-center hover:underline underline-offset-2 cursor-pointer"
                            >
                              <div>{b.name}</div>
                              {b.subtitle && <div className="text-[10px] font-normal opacity-80">{b.subtitle}</div>}
                            </button>
                          </td>
                        )}

                        {/* La tarea lleva a la ficha de ESE plan (mismo deep-link
                            que usa el Gantt). */}
                        <td className={td + " p-0"}>
                          <button
                            type="button"
                            onClick={() => navigate(`/maintenance-plans?openId=${encodeURIComponent(p.id)}`)}
                            title={`${p.taskCode} · ${t("msheet.openPlan")}`}
                            className="w-full px-2 py-0.5 text-left hover:underline underline-offset-2 cursor-pointer"
                          >
                            {p.title}
                          </button>
                        </td>
                        <td className={td + " text-center font-mono"}>{everyText(p)}</td>

                        <td className={td + " text-center font-mono"}>
                          {canEdit ? (
                            hb
                              ? <NumberCell value={p.lastExecutionHours ?? null} resetKey={resetTick}
                                  onCommit={v => void patchPlan(p, { lastExecutionHours: v })} />
                              : <DateCell value={p.lastExecutionDate} resetKey={resetTick}
                                  onCommit={v => void patchPlan(p, { lastExecutionDate: v })} />
                          ) : milestoneText(p, "last")}
                        </td>
                        <td className={td + " text-center font-mono"}>
                          {canEditNextDue ? (
                            hb
                              ? <NumberCell value={p.nextDueHours ?? null} resetKey={resetTick}
                                  onCommit={v => void patchPlan(p, { nextDueHours: v })} />
                              : <DateCell value={p.nextDueDate} resetKey={resetTick}
                                  onCommit={v => void patchPlan(p, { nextDueDate: v })} />
                          ) : milestoneText(p, "next")}
                          {savingId === p.id && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}
                        </td>

                        <td className={td}>
                          {isProvider && (
                            <span className="text-[10px]">
                              {ICON_PROVIDER} {providers.join(", ")}
                            </span>
                          )}
                        </td>

                        {i === 0 && (
                          <td
                            rowSpan={b.plans.length}
                            className={td + " text-center text-[9px] font-bold " +
                              (b.outOfService ? "bg-[#FFE0E0] text-[#C00000]" : "bg-surface")}
                          >
                            {b.outOfService ? t("msheet.outOfService") : ""}
                          </td>
                        )}
                      </tr>
                    );
                  }))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Referencia de los íconos y los colores, igual que al pie del Excel. */}
      {visible.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-text-industrial/60 px-1">
          <span>{ICON_PROVIDER} {t("msheet.legend.provider")}</span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-red-600 border border-border" /> {t("msheet.legend.overdue")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-yellow-300 border border-border" /> {t("msheet.legend.soon")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-[#FFE0E0] border border-border" /> {t("msheet.legend.outOfService")}
          </span>
        </div>
      )}

      {prefill && (
        <CreateWorkOrderModal
          prefill={prefill}
          onClose={() => setPrefill(null)}
          onSaved={(_woId, workOrderCode) => {
            setPrefill(null);
            setSelectedIds([]);
            void reload();
            if (workOrderCode) navigate(`/work-orders/${encodeURIComponent(workOrderCode)}`);
          }}
        />
      )}

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </div>
  );
}
