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
//   · ver "Última verificación" y "Próximo recorrido" de cada tarea; corregirlas
//     a mano en la celda es sólo del administrador (ver canEditMilestones).
//
// Todo lo que decide (qué OT, qué SS, quién puede qué) lo resuelve el backend en
// `POST /app/pms/maintenance-plans/:id/open-work-order` y el PATCH del plan.
// Acá no hay reglas de negocio propias, y no debería agregarse ninguna.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, FileSpreadsheet, Loader2, Search, Wrench, X } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { AlertDialog } from "../components/AlertDialog";
import { DateCell, NumberCell } from "../components/InlineCells";
import { CreateWorkOrderModal, buildWoPrefillFromPlan, type WoPrefill } from "../components/CreateWorkOrderModal";
import { api, ApiError } from "../lib/api";
import { exportMaintenanceSheet } from "../lib/export-maintenance-sheet";
import { useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { useT, type TranslationKey } from "../lib/i18n";
import { useVesselContext } from "../lib/vessel-context";
import { useCopilotEmitter, useCopilotDataRefresh } from "../lib/copilot-context";
import {
  type AssetInfo, type SheetPlan, type SheetGroup,
  ICON_PROVIDER,
  NO_GROUP, buildSheetGroups, isHours, isMonths,
  providerIdsOf, providerNamesOf, severityOf, severityOfRow, fmtDate,
} from "../lib/maintenance-sheet-model";
import { textMatches } from "../lib/text-search";

/** Lo que agrega la lista de planes por encima de lo que usa la planilla. */
type SheetRow = SheetPlan & {
  status?: string | null;
  /** Código de la OT abierta que ya cubre esta tarea (PLANNED / IN_PROGRESS). */
  activeWorkOrderCode?: string | null;
  vesselCode?: string;
};

// El encabezado de columnas va en SU PROPIA tabla, fuera del área que scrollea, y
// sólo el cuerpo tiene scroll. Así la barra empieza debajo del encabezado en vez de
// correr por al lado. El precio es tener que alinear dos tablas: se hace con
// `table-fixed` y este mismo colgroup en las dos, más el ancho de la barra sumado
// como padding a la del encabezado (se mide en vivo: cambia según el sistema).
const COL_WIDTHS = [112, 40, 208, null, 96, 128, 128, 160, 96] as const;

const SheetCols: React.FC = () => (
  <colgroup>
    {COL_WIDTHS.map((w, i) => <col key={i} style={w == null ? undefined : { width: w }} />)}
  </colgroup>
);

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
  const navigate = useNavigate();
  const { selectedVesselCode, selectedVessel } = useVesselContext();

  // Las dos fechas de la planilla —última verificación y próximo recorrido— son
  // el corazón del vencimiento del plan: tocarlas a mano pisa el cálculo
  // automático (frecuencia + última ejecución). Por eso quedan en el rol literal
  // TENANT_ADMIN (decisión del usuario, sep 2026), no en el permiso plan.manage,
  // que otros roles tienen por defecto. Registrar que la tarea se hizo NO pasa
  // por acá: eso lo mueve solo el cierre de la OT. El backend valida lo mismo,
  // así que la celda se muestra editable sólo a quien va a poder guardarla.
  const { user, tenant } = useAuth();
  const canEditMilestones = user?.role === "TENANT_ADMIN";

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
              // Un equipo fuera de servicio no entra en "lo que hay que hacer":
              // sus tareas vencen igual, pero no se pueden ejecutar hasta que la
              // máquina vuelva. Mismo criterio con el que van en rosa y con el que
              // el Dashboard las cuenta aparte.
              if (onlyDue && (b.outOfService || severityOf(p) === "none")) return false;
              if (!q) return true;
              return textMatches(`${b.name} ${p.title} ${p.taskCode}`, q);
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

  // El copiloto escribe desde el chat: si esta pantalla está abierta mostrando
  // lo que acaba de cambiar, se recarga sola.
  useCopilotDataRefresh(reload);

  // ── Lo que el copiloto ve de esta pantalla ─────────────────────────────────
  // Sin esto la planilla era una pantalla ciega: el copiloto no sabía qué buque
  // tenía abierto el usuario ni qué filas estaba mirando, y llegó a contestar
  // "no encontré ese registro" sobre una tarea que el Jefe de Máquinas tenía
  // delante de los ojos. Sólo contexto: la planilla no le deja escribir nada.
  useCopilotEmitter(selectedVesselCode ? {
    module: "MAINTENANCE_PLANS",
    screen: "MAINTENANCE_SHEET",
    vesselCode: selectedVesselCode,
    canEdit: canEditMilestones,
    fieldValues: {
      vesselName:        selectedVessel?.name ?? null,
      search:            query.trim() || null,
      onlyDue:           onlyDue ? "true" : "false",
      visibleTasks:      String(totalTasks),
      // Lo tildado es lo que el usuario quiere hacer ahora: con esto el copiloto
      // puede hablar de "estas tareas" sin pedirle que las vuelva a nombrar.
      selectedTaskCodes: selectedPlans.length > 0
        ? selectedPlans.slice(0, 20).map(pl => pl.taskCode).join(", ")
        : null,
    },
  } : null);

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

  // Bajar la MISMA planilla en Excel, para imprimirla y llevarla a la máquina.
  // Es el mismo botón (y la misma función) que Plan de Mantenimiento: la
  // exportación trae su propia lista completa del buque, sin los filtros de
  // pantalla — lo que se imprime es la planilla entera, como el papel.
  const [exportingSheet, setExportingSheet] = useState(false);
  const exportSheet = useCallback(async () => {
    if (exportingSheet || !selectedVesselCode) return;
    setExportingSheet(true);
    try {
      await exportMaintenanceSheet({
        vesselCode: selectedVesselCode,
        vesselName: selectedVessel?.name ?? selectedVesselCode,
        // La planilla va a papel: siempre el logo para fondo blanco.
        logoUrl: tenant?.logoUrl || tenant?.logoUrlLight || null,
      });
    } catch (err) {
      setAlert(err instanceof Error ? err.message : t("mp.page.exportSheetFailed"));
    } finally {
      setExportingSheet(false);
    }
  }, [exportingSheet, selectedVesselCode, selectedVessel, tenant, t]);

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

  // Ancho de la barra de scroll del cuerpo: se le suma como padding a la tabla del
  // encabezado para que las columnas de las dos queden alineadas. Depende del
  // sistema (0 en macOS con barras superpuestas, ~15px en Windows) y cambia si la
  // lista deja de necesitar scroll, así que se mide en vivo.
  const bodyBoxRef = useRef<HTMLDivElement | null>(null);
  const [scrollbarW, setScrollbarW] = useState(0);
  useEffect(() => {
    const el = bodyBoxRef.current;
    if (!el) return;
    const measure = () => setScrollbarW(el.offsetWidth - el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Encabezado gris de la planilla de papel. Color sólido a propósito: es sticky,
  // y con un fondo translúcido las filas rojas se transparentan por debajo.
  const th = "px-2 py-1.5 text-[10px] font-bold text-[#1F3864] border border-border bg-[#D9E2E3] text-center";
  // Filas finas: entran muchas más tareas de un vistazo, que es para lo que se
  // usa la planilla. Las celdas editables también se achican (`[&_input]`), si no
  // el alto de la fila lo termina fijando el input y no el texto.
  const td = "px-2 py-0.5 text-[11px] leading-tight border border-border align-middle [&_input]:py-0";

  return (
    <div className="space-y-4">
      <div className="pb-1">
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
          onClick={() => { void exportSheet(); }}
          disabled={exportingSheet || !selectedVesselCode}
          title={selectedVesselCode
            ? t("mp.page.exportSheetHint").replace("{vessel}", selectedVessel?.name ?? selectedVesselCode)
            : t("mp.page.exportSheetNoVessel")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {exportingSheet
            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
            : <FileSpreadsheet className="w-3.5 h-3.5 text-accent" />}
          {exportingSheet ? t("mp.page.exportSheetBusy") : t("mp.page.exportSheet")}
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
      </div>

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
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          {/* Encabezado: tabla aparte, fuera del scroll. El padding derecho reserva
              el ancho de la barra del cuerpo para que las columnas coincidan. */}
          <div style={{ paddingRight: scrollbarW }}>
            <table className="w-full table-fixed border-collapse">
              <SheetCols />
              <thead>
                <tr>
                  {/* Ancha a propósito: cuando la tarea ya tiene una OT abierta,
                      acá va el número de orden entero, no una casilla. */}
                  <th className={th}></th>
                  <th className={th}>{t("msheet.col.item")}</th>
                  <th className={th}>{t("msheet.col.description")}</th>
                  <th className={th}>{t("msheet.col.task")}</th>
                  <th className={th}>{t("msheet.col.every")}</th>
                  <th className={th}>{t("msheet.col.lastCheck")}</th>
                  <th className={th}>{t("msheet.col.nextDue")}</th>
                  <th className={th}>{t("msheet.col.provider")}</th>
                  <th className={th}>{t("msheet.col.outOfService")}</th>
                </tr>
              </thead>
            </table>
          </div>
          <div ref={bodyBoxRef} className="overflow-auto max-h-[calc(100vh-16rem)]">
          <table className="w-full table-fixed border-collapse">
            <SheetCols />
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
                    // Línea azul de cierre del bloque: separa un equipo del
                    // siguiente. Va en la última fila del equipo y, además, en las
                    // celdas combinadas (ítem / descripción / fuera de servicio),
                    // que viven en la PRIMERA fila pero llegan hasta el final del
                    // bloque — sin esto el separador quedaba cortado a la izquierda.
                    const sep = " border-b-2 border-b-[#1F3864]";
                    const tdLast = td + (i === b.plans.length - 1 ? sep : "");

                    return (
                      <tr key={p.id} className={rowCls}>
                        <td className={tdLast + " text-center"}>
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
                          <td rowSpan={b.plans.length} className={td + sep + " text-center font-bold text-fg bg-surface"}>
                            {b.itemNumber}
                          </td>
                        )}
                        {/* El equipo lleva a SU plan de mantenimiento: la lista ya
                            filtrada por ese equipo, que es donde se lo administra. */}
                        {i === 0 && (
                          <td rowSpan={b.plans.length} className={td + sep + " text-center font-bold bg-[#F8CBAD] text-[#1F3864] p-0"}>
                            <button
                              type="button"
                              onClick={() => openAssetPlans(b.plans[0]!)}
                              title={t("msheet.openAssetPlans")}
                              className="w-full h-full px-2 py-1 text-center hover:underline underline-offset-2 cursor-pointer"
                            >
                              <div>{b.name}</div>
                              {b.subtitle && <div className="text-[10px] font-normal opacity-80">{b.subtitle}</div>}
                              {/* Horómetro: el mismo número que "Horas de Equipos".
                                  Va acá porque las tareas por horas se leen contra
                                  él ("Realizar cada 500 h" no dice nada sin saber en
                                  cuántas está la máquina).
                                  Se muestra si hay lectura, y también —como "Sin
                                  lecturas"— cuando el equipo TIENE tareas por horas
                                  pero nadie cargó el horómetro: ese es justamente el
                                  motivo de que esas tareas no venzan nunca, y hay que
                                  verlo. Los equipos sin horómetro ni tareas por horas
                                  no muestran nada, para no ensuciar la planilla. */}
                              {(() => {
                                const conHoras = b.currentHours != null;
                                if (!conHoras && !b.plans.some(p => isHours(p.triggerType))) return null;
                                return (
                                  <div className="text-[10px] font-normal opacity-80 mt-0.5">
                                    {conHoras
                                      ? `${fmtHours(b.currentHours!)} h${b.currentHoursDate ? ` · ${fmtDate(b.currentHoursDate)}` : ""}`
                                      : t("assetHours.never")}
                                  </div>
                                );
                              })()}
                            </button>
                          </td>
                        )}

                        {/* La tarea lleva a la ficha de ESE plan (mismo deep-link
                            que usa el Gantt). */}
                        <td className={tdLast + " p-0"}>
                          <button
                            type="button"
                            onClick={() => navigate(`/maintenance-plans?openId=${encodeURIComponent(p.id)}`)}
                            title={`${p.taskCode} · ${t("msheet.openPlan")}`}
                            className="w-full px-2 py-0.5 text-left hover:underline underline-offset-2 cursor-pointer"
                          >
                            {p.title}
                          </button>
                        </td>
                        <td className={tdLast + " text-center font-mono"}>{everyText(p)}</td>

                        <td className={tdLast + " text-center font-mono"}>
                          {canEditMilestones ? (
                            hb
                              ? <NumberCell value={p.lastExecutionHours ?? null} resetKey={resetTick}
                                  onCommit={v => void patchPlan(p, { lastExecutionHours: v })} />
                              : <DateCell value={p.lastExecutionDate} resetKey={resetTick}
                                  onCommit={v => void patchPlan(p, { lastExecutionDate: v })} />
                          ) : milestoneText(p, "last")}
                        </td>
                        <td className={tdLast + " text-center font-mono"}>
                          {canEditMilestones ? (
                            hb
                              ? <NumberCell value={p.nextDueHours ?? null} resetKey={resetTick}
                                  onCommit={v => void patchPlan(p, { nextDueHours: v })} />
                              : <DateCell value={p.nextDueDate} resetKey={resetTick}
                                  onCommit={v => void patchPlan(p, { nextDueDate: v })} />
                          ) : milestoneText(p, "next")}
                          {savingId === p.id && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}
                        </td>

                        <td className={tdLast}>
                          {isProvider && (
                            <span className="text-[10px]">
                              {ICON_PROVIDER} {providers.join(", ")}
                            </span>
                          )}
                        </td>

                        {i === 0 && (
                          <td
                            rowSpan={b.plans.length}
                            className={td + sep + " text-center text-[9px] font-bold " +
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
