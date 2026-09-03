import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarRange, CheckCircle2, ChevronDown, ChevronRight, Clock, FileSpreadsheet, Loader2, Minus, Plus, type LucideIcon } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { useVesselContext } from "../lib/vessel-context";
import { useT } from "../lib/i18n";
import { sfiGroupDigit } from "../lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MaintenancePlan {
  id: string;
  vesselCode: string;
  taskCode: string;
  title: string;
  taskType: "MAINTENANCE" | "INSPECTION";
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
  status: string;
  executionStatus: string;
  lastExecutionDate: string | null;
  nextDueDate: string | null;
  /**
   * Solo para planes por horas sin nextDueDate: fecha estimada a partir del
   * promedio de horas/día del asset (ver loadAvgHoursPerDayMap en el backend).
   * Es una proyección, no un vencimiento real — el marcador se dibuja con
   * menor opacidad y borde punteado para distinguirla.
   */
  projectedDueDate: string | null;
  /**
   * Ventana de ejecución anticipada (lo que el Gantt dibuja como barra).
   * MANUAL → windowLeadDays fijos; AUTO → el sistema toma ~10% del ciclo.
   * windowOpenDate, si está cargada, manda sobre todo lo demás.
   */
  windowMode: "AUTO" | "MANUAL" | null;
  windowLeadDays: number | null;
  windowOpenDate: string | null;
  sfiGroupNumber: number | null;
  assetName: string | null;
}

interface ListResponse {
  items: MaintenancePlan[];
  total: number;
}

// ─── Status palette (misma semántica que el resto del PMS) ──────────────────────

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "#22c55e",
  IN_WINDOW: "#3b82f6",
  UPCOMING:  "#eab308",
  DUE:       "#f97316",
  OVERDUE:   "#ef4444",
  FUTURE:    "#64748b",
};

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Completado",
  IN_WINDOW: "En Ventana",
  UPCOMING:  "Próximo",
  DUE:       "Vencido pronto",
  OVERDUE:   "Vencido",
  FUTURE:    "Futuro",
};

const MONTHS_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDMY(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${date.getFullYear()}`;
}

function fmtDMY2(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${String(date.getFullYear()).slice(2)}`;
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function monthStart(d: Date, addMonths = 0): Date {
  return new Date(d.getFullYear(), d.getMonth() + addMonths, 1);
}

function monthDiff(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

const DAY_MS = 86_400_000;
const DAYS_PER_MONTH = 30.44;

/**
 * Apertura de la ventana de ejecución del plan (el "desde" de la barra).
 * Es lo único que el Gantt debe dibujar como barra: el período en el que la
 * tarea se puede ejecutar, NO el ciclo completo entre una ejecución y la otra.
 * Ej: una renovación de clase cada 60 meses con 365 días de ventana se dibuja
 * como un año, no como cinco.
 *
 * Prioridad (misma semántica que el modal del plan y que execution-windows):
 *   1. windowOpenDate cargada a mano → manda.
 *   2. MANUAL con windowLeadDays → vencimiento − esos días.
 *   3. AUTO → ~10% del ciclo (frequencyMonths, o el largo real última→próxima).
 * Se recorta contra la última ejecución: la ventana nunca puede abrir antes de
 * que la tarea se haya hecho por última vez.
 */
function windowOpenOf(p: MaintenancePlan, nextD: Date | null, lastD: Date | null): Date | null {
  if (!nextD) return null;

  const explicit = parseDate(p.windowOpenDate);
  if (explicit) return explicit;

  let leadDays: number | null = null;
  if (p.windowMode === "MANUAL" && p.windowLeadDays && p.windowLeadDays > 0) {
    leadDays = p.windowLeadDays;
  } else if (p.frequencyMonths && p.frequencyMonths > 0) {
    leadDays = p.frequencyMonths * DAYS_PER_MONTH * 0.1;
  } else if (lastD) {
    // Planes por horas: no hay frecuencia en meses, pero el largo del ciclo
    // se puede leer del propio tramo última ejecución → próximo vencimiento.
    leadDays = ((nextD.getTime() - lastD.getTime()) / DAY_MS) * 0.1;
  }
  if (leadDays == null || !(leadDays > 0)) return null;

  const open = new Date(nextD.getTime() - leadDays * DAY_MS);
  if (lastD && open < lastD) return lastD;
  return open;
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function GanttLegend() {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {Object.entries(STATUS_LABELS).map(([key, label]) => (
        <div key={key} className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: STATUS_COLORS[key] ?? "#64748b" }} />
          <span className="text-[11px] text-text-industrial/60">{label}</span>
        </div>
      ))}
      {/* La barra no es el ciclo completo del plan: es el tramo en el que la
          tarea se puede ejecutar (ventana anticipada del plan). */}
      <span className="w-px h-3 bg-fg/15" />
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-6 h-2 rounded-[2px] border" style={{ background: "color-mix(in srgb, #3b82f6 26%, transparent)", borderColor: "color-mix(in srgb, #3b82f6 55%, transparent)" }} />
        <span className="text-[11px] text-text-industrial/60">Ventana de ejecución (hasta el vencimiento)</span>
      </div>
    </div>
  );
}

// ─── Status filter chip ───────────────────────────────────────────────────────

function StatusChip({ statusKey, active, count, onClick }: { statusKey: string; active: boolean; count: number; onClick: () => void }) {
  const color = STATUS_COLORS[statusKey] ?? STATUS_COLORS.FUTURE;
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
        active ? "text-fg border-current/30" : "bg-fg/5 text-text-industrial/40 border-fg/10 hover:bg-fg/10"
      }`}
      style={active ? { backgroundColor: color + "1f", color, borderColor: color + "55" } : undefined}
    >
      {STATUS_LABELS[statusKey] ?? statusKey}
      <span className="text-[10px] opacity-70 tabular-nums">{count}</span>
    </button>
  );
}

// ─── Zoom ───────────────────────────────────────────────────────────────────

// Los tres botones son atajos a un ancho de mes concreto. El zoom real es
// continuo (los botones − / + lo mueven de a poco), así que `px` es un preset,
// no el único valor posible.
const ZOOMS = [
  { key: "week",  label: "Semana", px: 118 },
  { key: "month", label: "Mes",    px: 64 },
  { key: "year",  label: "Año",    px: 22 },
] as const;

/** Límites del zoom continuo, en píxeles de ancho por mes. */
const PX_MIN = 6;    // ~17 años en una pantalla de 1200px
const PX_MAX = 300;  // un mes ocupa casi un cuarto de pantalla
/** Cuánto cambia el ancho por cada toque de los botones − / +. */
const ZOOM_STEP = 1.15;

/** Columna izquierda (equipo / plan). Ajustable arrastrando su borde derecho;
 *  el ancho elegido queda guardado en este navegador. */
const LEFT_W_DEFAULT = 300;  // px
const LEFT_W_MIN = 160;      // px — abajo de esto no entra ni el titulo
const LEFT_W_MAX = 720;      // px — arriba de esto no queda diagrama para ver
const LEFT_W_KEY = "gantt.leftColumnWidth";
const ROW_H = 36;     // px — alto de fila

function clampLeftW(w: number): number {
  return Math.min(LEFT_W_MAX, Math.max(LEFT_W_MIN, Math.round(w)));
}

/** Grupo SFI de un equipo dentro del Gantt. El grupo lo declara cada PLAN, no
 *  el equipo, y un mismo equipo puede tener tareas cargadas en más de un grupo:
 *  se toma el que más se repite (y ante empate, el menor) para que el equipo no
 *  se parta en dos lugares del diagrama. Sin grupo en ningún plan → null. */
function assetSfiGroup(plans: MaintenancePlan[]): number | null {
  const counts = new Map<number, number>();
  for (const p of plans) {
    const d = sfiGroupDigit(p.sfiGroupNumber);
    if (d === null) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [d, n] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (n > bestCount) { best = d; bestCount = n; }
  }
  return best;
}

// ─── Filtro de vista ──────────────────────────────────────────────────────────

type ViewFilter = "ALL" | "MAINTENANCE" | "INSPECTION" | "CLASS";

/** Inspecciones de Clase: grupo SFI G0, sea el plan de mantenimiento o de inspección. */
function matchesView(p: MaintenancePlan, view: ViewFilter): boolean {
  if (view === "ALL") return true;
  if (view === "CLASS") return sfiGroupDigit(p.sfiGroupNumber) === 0;
  return p.taskType === view;
}

// ─── Timeline row model ───────────────────────────────────────────────────────

type Row =
  | { kind: "vessel"; key: string; label: string }
  | { kind: "group"; key: string; label: string; count: number }
  | { kind: "asset"; key: string; label: string; count: number }
  | { kind: "plan"; key: string; plan: MaintenancePlan };

// ─── Main component ───────────────────────────────────────────────────────────

export function MaintenanceGanttPage() {
  const navigate = useNavigate();
  const t = useT();
  const { data, loading, error } = useFetch<ListResponse>("/app/pms/maintenance-plans?limit=500");
  const plans = data?.items ?? [];

  // Qué se ve en el diagrama. "CLASS" no es un taskType: son las Inspecciones de
  // Clase, que se reconocen por el grupo SFI G0 del plan (mismo criterio que el
  // Dashboard), sean periódicas o por evento.
  const [selectedView,   setSelectedView]   = useState<ViewFilter>("ALL");
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(new Set(Object.keys(STATUS_LABELS)));
  // Ancho de cada mes en píxeles. Es el zoom: lo mueven los tres presets y,
  // de forma continua, los botones − / + de la toolbar.
  const [pxPerMonth, setPxPerMonth] = useState<number>(64);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Ancho de la columna de la izquierda. Se arrastra desde su borde derecho y
  // queda guardado por navegador: los titulos de los planes no miden lo mismo
  // en todas las flotas, y cada uno decide cuanto quiere leer del titulo.
  const [leftW, setLeftW] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(LEFT_W_KEY));
      if (Number.isFinite(saved) && saved > 0) return clampLeftW(saved);
    } catch { /* navegador sin storage: queda el ancho por defecto */ }
    return LEFT_W_DEFAULT;
  });
  const [resizing, setResizing] = useState(false);

  // Arrastre del borde. Los listeners van en la VENTANA, no en la manija: la
  // manija se mueve con el puntero y siempre queda algo atrás, así que si los
  // eventos dependieran de estar encima de ella el arrastre se cortaba solo a
  // mitad de camino (pasó al probarlo). Se guarda recién al soltar.
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftW;
    setResizing(true);
    let finalW = startW;
    const onMove = (ev: PointerEvent) => {
      finalW = clampLeftW(startW + (ev.clientX - startX));
      setLeftW(finalW);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setResizing(false);
      try { localStorage.setItem(LEFT_W_KEY, String(finalW)); } catch { /* sin storage */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  // Doble clic en el borde: vuelve al ancho original.
  function resetLeftW() {
    setLeftW(LEFT_W_DEFAULT);
    try { localStorage.setItem(LEFT_W_KEY, String(LEFT_W_DEFAULT)); } catch { /* sin storage */ }
  }

  // La exportación de la Planilla de Mantenimiento se mudó a la pantalla de
  // Plan de Mantenimiento (sep 2026, pedido del usuario). Acá ya no está.

  function toggleStatus(s: string) {
    setActiveStatuses((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  function toggleCollapse(k: string) {
    setCollapsed((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  // ── Filtrado (tipo / estado). El buque lo scopea el selector global del header;
  //    no hay filtro por año: se ve toda la línea de tiempo con scroll. ──
  const filtered = useMemo(() => plans.filter((p) => {
    if (!matchesView(p, selectedView)) return false;
    if (!activeStatuses.has(p.executionStatus)) return false;
    return true;
  }), [plans, selectedView, activeStatuses]);

  const statusCounts = useMemo(() => {
    const base = plans.filter((p) => matchesView(p, selectedView));
    const counts: Record<string, number> = {};
    base.forEach((p) => { counts[p.executionStatus] = (counts[p.executionStatus] ?? 0) + 1; });
    return counts;
  }, [plans, selectedView]);

  // ── Rango temporal (min/max de últimas ejec. y próximos venc., con padding) ──
  const range = useMemo(() => {
    let minT = Infinity, maxT = -Infinity;
    for (const p of filtered) {
      for (const ds of [p.lastExecutionDate, p.nextDueDate]) {
        const d = parseDate(ds);
        if (d) { minT = Math.min(minT, d.getTime()); maxT = Math.max(maxT, d.getTime()); }
      }
    }
    const now = new Date();
    let lo: Date, hi: Date;
    if (!isFinite(minT)) { lo = new Date(now.getFullYear() - 1, 0, 1); hi = new Date(now.getFullYear() + 1, 11, 1); }
    else { lo = monthStart(new Date(minT), -1); hi = monthStart(new Date(maxT), 2); }
    // Asegurar que "hoy" entre en el rango.
    if (now < lo) lo = monthStart(now, -1);
    if (now > hi) hi = monthStart(now, 2);
    const months = Math.max(monthDiff(lo, hi), 12);
    return { lo, months };
  }, [filtered]);

  const timelineW = range.months * pxPerMonth;

  // Posición de una fecha en el eje, medida en meses (con decimales). No depende
  // del zoom: por eso sirve para reubicar el scroll cuando el ancho cambia.
  function monthsOf(d: Date): number {
    const m = monthDiff(range.lo, d);
    const frac = (d.getDate() - 1) / daysInMonth(d);
    return m + frac;
  }
  function xOf(d: Date): number {
    return monthsOf(d) * pxPerMonth;
  }
  const xToday = xOf(new Date());

  // ── Filas: buque → grupo SFI → equipo → planes (con colapso) ──
  // El grupo ordena el diagrama: los equipos de un mismo sistema (propulsión,
  // eléctrico, LCI…) quedan juntos en vez de repartidos por orden alfabético.
  const rows = useMemo<Row[]>(() => {
    const byVessel = new Map<string, Map<string, MaintenancePlan[]>>();
    for (const p of filtered) {
      const asset = p.assetName ?? "Sin equipo asignado";
      if (!byVessel.has(p.vesselCode)) byVessel.set(p.vesselCode, new Map());
      const am = byVessel.get(p.vesselCode)!;
      if (!am.has(asset)) am.set(asset, []);
      am.get(asset)!.push(p);
    }
    const out: Row[] = [];
    for (const [vessel, assets] of [...byVessel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const vKey = `v:${vessel}`;
      out.push({ kind: "vessel", key: vKey, label: vessel });
      if (collapsed.has(vKey)) continue;

      // Equipos repartidos por grupo SFI; los que no declaran grupo van al final.
      const byGroup = new Map<number | null, Array<[string, MaintenancePlan[]]>>();
      for (const entry of [...assets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const g = assetSfiGroup(entry[1]);
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push(entry);
      }
      const groupOrder = [...byGroup.keys()].sort((a, b) => {
        if (a === null) return 1;
        if (b === null) return -1;
        return a - b;
      });

      for (const g of groupOrder) {
        const entries = byGroup.get(g)!;
        const gKey = `g:${vessel}:${g ?? "none"}`;
        const label = g === null
          ? t("gantt.noSfiGroup")
          : `G${g} · ${t(`sfi.g.${g}` as Parameters<typeof t>[0])}`;
        out.push({ kind: "group", key: gKey, label, count: entries.reduce((n, [, ps]) => n + ps.length, 0) });
        if (collapsed.has(gKey)) continue;
        for (const [asset, aplans] of entries) {
          const aKey = `e:${vessel}:${asset}`;
          out.push({ kind: "asset", key: aKey, label: asset, count: aplans.length });
          if (collapsed.has(aKey)) continue;
          for (const plan of aplans) out.push({ kind: "plan", key: plan.id, plan });
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, collapsed]);

  // ── Eje de meses (con bandas de año) ──
  const axisMonths = useMemo(() => Array.from({ length: range.months }, (_, i) => monthStart(range.lo, i)), [range]);
  const axisYears = useMemo(() => {
    const acc: { year: number; span: number }[] = [];
    for (const m of axisMonths) {
      const last = acc[acc.length - 1];
      if (last && last.year === m.getFullYear()) last.span++;
      else acc.push({ year: m.getFullYear(), span: 1 });
    }
    return acc;
  }, [axisMonths]);

  const scrollRef = useRef<HTMLDivElement>(null);

  /** scrollLeft que deja una posición del eje (en meses) en el medio del diagrama. */
  function scrollLeftToCenter(el: HTMLDivElement, months: number, px: number): number {
    return Math.max(0, months * px - (el.clientWidth - leftW) / 2);
  }

  // ── Scroll: centrar HOY al abrir (y cuando cambia el rango del eje) ──
  // El zoom NO está en las dependencias a propósito: al ensanchar/angostar ya
  // se reacomoda el scroll ahí mismo, y un scrollTo suave encima le peleaba en
  // cada toque.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: scrollLeftToCenter(el, monthsOf(new Date()), pxPerMonth), behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.lo.getTime(), range.months]);

  // ── Zoom con los botones − / + ──
  // "+" ensancha los meses; "−" los angosta (entran más en la misma pantalla).
  // El ancla es siempre HOY: con cualquier ancho, la fecha de hoy queda en el
  // medio del diagrama.
  function zoomBy(dir: 1 | -1) {
    const prev = pxPerMonth;
    const next = Math.min(PX_MAX, Math.max(PX_MIN, dir > 0 ? prev * ZOOM_STEP : prev / ZOOM_STEP));
    if (next === prev) return;
    setPxPerMonth(next);
    const monthsToday = monthsOf(new Date());
    // Recién cuando React repintó el ancho nuevo se puede reubicar el scroll.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollLeft = scrollLeftToCenter(el, monthsToday, next);
    });
  }

  /** Atajo a un ancho concreto, recentrando hoy igual que los botones − / +. */
  function setZoomPreset(px: number) {
    if (px === pxPerMonth) return;
    setPxPerMonth(px);
    const monthsToday = monthsOf(new Date());
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollLeft = scrollLeftToCenter(el, monthsToday, px);
    });
  }

  const showMonthLabels = pxPerMonth >= 40;

  return (
    <div className="flex flex-col gap-5 h-full">
      <PageHeader title="Gantt de Mantenimiento" total={filtered.length} icon={CalendarRange as LucideIcon} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedView}
          onChange={(e) => setSelectedView(e.target.value as ViewFilter)}
          title={t("gantt.view.hint")}
          className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial/80 focus:outline-none focus:border-accent/40"
        >
          <option value="ALL">{t("gantt.view.all")}</option>
          <option value="MAINTENANCE">{t("gantt.view.maintenance")}</option>
          <option value="INSPECTION">{t("gantt.view.inspection")}</option>
          <option value="CLASS">{t("gantt.view.class")}</option>
        </select>

        <div
          className="flex items-center gap-1 bg-fg/5 border border-fg/10 rounded-lg p-0.5"
          title={t("gantt.zoomHint")}
        >
          <button
            type="button"
            onClick={() => zoomBy(-1)}
            disabled={pxPerMonth <= PX_MIN}
            title={t("gantt.zoomOut")}
            aria-label={t("gantt.zoomOut")}
            className="px-2 py-1 rounded-md text-text-industrial/60 hover:text-fg hover:bg-fg/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          {ZOOMS.map(({ key, label, px }) => (
            <button key={key} onClick={() => setZoomPreset(px)} className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${pxPerMonth === px ? "bg-accent/20 text-accent border border-accent/30" : "text-text-industrial/50 hover:text-fg"}`}>
              {label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => zoomBy(1)}
            disabled={pxPerMonth >= PX_MAX}
            title={t("gantt.zoomIn")}
            aria-label={t("gantt.zoomIn")}
            className="px-2 py-1 rounded-md text-text-industrial/60 hover:text-fg hover:bg-fg/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 flex-wrap">
          {Object.keys(STATUS_LABELS).map((s) => (
            <StatusChip key={s} statusKey={s} active={activeStatuses.has(s)} count={statusCounts[s] ?? 0} onClick={() => toggleStatus(s)} />
          ))}
        </div>
      </div>

      <GanttLegend />

      {/* Timeline */}
      <div className="relative flex-1 min-h-0 rounded-xl border border-fg/10 overflow-hidden bg-surface dark:bg-[#0a0f1e]">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-3 text-text-industrial/40"><Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Cargando planes de mantenimiento…</span></div>
        ) : error ? (
          <div className="flex items-center justify-center h-full gap-3 text-red-700 dark:text-red-400"><AlertTriangle className="w-5 h-5" /><span className="text-sm">{error}</span></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-industrial/20"><CalendarRange className="w-12 h-12" /><p className="text-sm">No hay planes para los filtros seleccionados.</p></div>
        ) : (
          <>
          {/* Manija para ensanchar/angostar la columna de la izquierda. Va acá y
              no adentro del scroll porque la columna es sticky en left:0: su
              borde derecho cae siempre en x = leftW, se haya scrolleado o no. */}
          <div
            onPointerDown={startResize}
            onDoubleClick={resetLeftW}
            title={t("gantt.resizeHint")}
            role="separator"
            aria-orientation="vertical"
            className={`absolute inset-y-0 z-40 cursor-col-resize group/resize ${resizing ? "" : "hover:bg-accent/10"}`}
            style={{ left: leftW - 3, width: 7 }}
          >
            <span className={`absolute inset-y-0 left-[3px] w-px transition-colors ${resizing ? "bg-accent" : "bg-transparent group-hover/resize:bg-accent/60"}`} />
          </div>
          <div ref={scrollRef} className={`h-full overflow-auto ${resizing ? "select-none" : ""}`}>
            <div style={{ width: leftW + timelineW, minWidth: "100%" }}>
              {/* Header (sticky top) */}
              <div className="sticky top-0 z-30 flex bg-surface dark:bg-[#0a0f1e] border-b border-fg/10">
                <div className="sticky left-0 z-10 flex items-center px-3 text-[10px] font-semibold uppercase tracking-wider text-text-industrial/40 bg-surface dark:bg-[#0a0f1e] border-r border-fg/10 shrink-0" style={{ width: leftW, minWidth: leftW }}>
                  Equipo / Plan
                </div>
                <div className="relative shrink-0" style={{ width: timelineW, height: 44 }}>
                  {/* Año */}
                  <div className="flex h-[22px]">
                    {axisYears.map((y, i) => (
                      <div key={i} className="flex items-center justify-center text-[11px] font-bold text-fg/70 border-r border-fg/10 tabular-nums" style={{ width: y.span * pxPerMonth }}>
                        {y.span * pxPerMonth >= 30 ? y.year : ""}
                      </div>
                    ))}
                  </div>
                  {/* Mes */}
                  <div className="flex h-[22px]">
                    {axisMonths.map((m, i) => (
                      <div key={i} className={`flex items-center justify-center text-[9px] font-semibold uppercase tracking-wide text-text-industrial/40 border-r ${m.getMonth() === 0 ? "border-fg/20" : "border-fg/[0.06]"}`} style={{ width: pxPerMonth }}>
                        {showMonthLabels ? MONTHS_ABBR[m.getMonth()] : ""}
                      </div>
                    ))}
                  </div>
                  {/* HOY */}
                  {xToday >= 0 && xToday <= timelineW && (
                    <span className="absolute top-0.5 -translate-x-1/2 z-10 text-[8px] font-extrabold tracking-wide text-white bg-accent px-1.5 py-0.5 rounded" style={{ left: xToday }}>HOY</span>
                  )}
                </div>
              </div>

              {/* Rows */}
              {rows.map((row) => {
                if (row.kind === "vessel" || row.kind === "group" || row.kind === "asset") {
                  const isVessel = row.kind === "vessel";
                  const isGroup = row.kind === "group";
                  const isCollapsed = collapsed.has(row.key);
                  // Tres niveles: buque, grupo SFI y equipo. Cada uno con su
                  // sangría y su gris, para leer la jerarquía de un vistazo.
                  const bg = isVessel ? "bg-fg/[0.05] hover:bg-fg/[0.08]"
                    : isGroup ? "bg-fg/[0.035] hover:bg-fg/[0.06]"
                    : "bg-fg/[0.02] hover:bg-fg/[0.05]";
                  const pad = isVessel ? 12 : isGroup ? 22 : 34;
                  const labelCls = isVessel ? "text-[11px] font-bold text-fg/80"
                    : isGroup ? "text-[11px] font-bold uppercase tracking-wide text-text-industrial/60"
                    : "text-[11px] font-semibold text-fg/70";
                  return (
                    <div key={row.key} className="flex border-b border-fg/[0.06]" style={{ height: ROW_H }}>
                      <button
                        onClick={() => toggleCollapse(row.key)}
                        className={`sticky left-0 z-10 flex items-center gap-1.5 px-3 border-r border-fg/10 shrink-0 text-left transition-colors ${bg}`}
                        style={{ width: leftW, minWidth: leftW, paddingLeft: pad }}
                      >
                        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />}
                        <span className={`truncate ${labelCls}`}>{row.label}</span>
                        {!isVessel && <span className="ml-auto text-[10px] font-bold text-text-industrial/40 bg-fg/8 rounded-full px-1.5 tabular-nums shrink-0">{row.count}</span>}
                      </button>
                      <div className="relative shrink-0 track-bg" style={{ width: timelineW, "--px": `${pxPerMonth}px` } as React.CSSProperties}>
                        <span className="absolute top-0 bottom-0 border-l border-dashed border-accent/50" style={{ left: xToday }} />
                      </div>
                    </div>
                  );
                }

                const p = row.plan;
                const lastD = parseDate(p.lastExecutionDate);
                const isProjected = !p.nextDueDate && !!p.projectedDueDate;
                const nextD = parseDate(p.nextDueDate) ?? parseDate(p.projectedDueDate);
                const nextColor = STATUS_COLORS[p.executionStatus] ?? STATUS_COLORS.FUTURE;
                const xLast = lastD ? xOf(lastD) : null;
                const xNext = nextD ? xOf(nextD) : null;
                // Barra = ventana de ejecución (cuándo se puede hacer la tarea),
                // no el ciclo entero entre ejecuciones.
                const winD = windowOpenOf(p, nextD, lastD);
                const xWin = winD ? xOf(winD) : null;
                return (
                  <div
                    key={row.key}
                    onClick={() => navigate(`/maintenance-plans?openId=${p.id}`)}
                    title="Abrir el plan de mantenimiento"
                    className="flex border-b border-fg/[0.04] hover:bg-fg/[0.02] group cursor-pointer"
                    style={{ height: ROW_H }}
                  >
                    <div className="sticky left-0 z-10 flex flex-col justify-center px-3 border-r border-fg/10 shrink-0 bg-surface dark:bg-[#0a0f1e] group-hover:bg-fg/[0.02]" style={{ width: leftW, minWidth: leftW, paddingLeft: 46 }}>
                      {/* Primero LA TAREA y después el código: en el Gantt se busca por lo que
                          hay que hacer, no por el código. Con el ancho justo el que se corta es
                          el código, no el título (el tooltip muestra los dos completos). */}
                      <span className="text-[11px] leading-tight truncate text-fg/80" title={`${p.title} · ${p.taskCode}`}>
                        <span className="font-semibold">{p.title}</span>
                        <span className="font-mono text-text-industrial/50"> · {p.taskCode}</span>
                      </span>
                      {/* Antes esta línea era "última → próxima", que se leía como si
                          la barra fuera todo el ciclo. Ahora dice explícitamente cuál
                          es la última ejecución y cuál la ventana. */}
                      <span className="text-[9px] tabular-nums text-text-industrial/40 leading-tight truncate">
                        <span className="opacity-70">Últ.</span> {lastD ? fmtDMY2(lastD) : "—"}
                        <span className="opacity-40"> · </span>
                        {xWin != null && nextD
                          ? <><span className="opacity-70">Vent.</span> {fmtDMY2(winD!)} <span className="opacity-50">→</span> {fmtDMY2(nextD)}</>
                          : <><span className="opacity-70">Venc.</span> {nextD ? `${isProjected ? "~" : ""}${fmtDMY2(nextD)}` : "—"}</>}
                      </span>
                    </div>
                    <div className="relative shrink-0 track-bg" style={{ width: timelineW, "--px": `${pxPerMonth}px` } as React.CSSProperties}>
                      {/* today line */}
                      <span className="absolute top-0 bottom-0 border-l border-dashed border-accent/40" style={{ left: xToday }} />
                      {/* ventana de ejecución: desde que la tarea se puede hacer hasta el vencimiento */}
                      {xWin != null && xNext != null && xNext > xWin && (
                        <span
                          className="absolute top-1/2 -translate-y-1/2 rounded-[3px] z-[1]"
                          style={{
                            left: xWin,
                            width: Math.max(xNext - xWin, 3),
                            height: 10,
                            background: `color-mix(in srgb, ${nextColor} 26%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${nextColor} 55%, transparent)`,
                          }}
                          title={`Ventana de ejecución · ${fmtDMY(winD!)} → ${fmtDMY(nextD!)}`}
                        />
                      )}
                      {/* marca última ejecución (completado) */}
                      {xLast != null && (
                        <span
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 grid place-items-center rounded-md shadow-sm z-[2] transition-transform hover:scale-110"
                          style={{ left: xLast, width: 15, height: 15, background: STATUS_COLORS.COMPLETED, border: "1px solid rgba(0,0,0,.18)" }}
                          title={`Última ejecución · ${fmtDMY(lastD!)}`}
                        >
                          <svg viewBox="0 0 10 10" className="w-2 h-2"><path d="M1 5l2.5 2.5L9 2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </span>
                      )}
                      {/* marca próximo vencimiento (por estado) — punteada/semitransparente si es una fecha proyectada (plan por horas sin nextDueDate real) */}
                      {xNext != null && (
                        <span
                          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-md shadow-sm z-[3] transition-transform hover:scale-110 ${p.executionStatus === "OVERDUE" && !isProjected ? "gantt-pulse" : ""}`}
                          style={{
                            left: xNext, width: 15, height: 15,
                            background: isProjected ? "transparent" : nextColor,
                            border: isProjected ? `2px dashed ${nextColor}` : "1px solid rgba(0,0,0,.18)",
                            opacity: isProjected ? 0.75 : 1,
                            ["--pc" as string]: nextColor,
                          }}
                          title={`${isProjected ? "Próximo vencimiento estimado (por horas)" : "Próximo vencimiento"} · ${fmtDMY(nextD!)} · ${STATUS_LABELS[p.executionStatus] ?? p.executionStatus}`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          </>
        )}
      </div>

      {/* Summary */}
      {!loading && !error && plans.length > 0 && (
        <div className="flex items-center gap-6 px-4 py-2.5 rounded-xl bg-fg/3 border border-fg/8 text-[11px] text-text-industrial/50 flex-wrap">
          <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" /><span>{plans.filter(p => p.executionStatus === "COMPLETED").length} completados</span></div>
          <div className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-red-700 dark:text-red-400" /><span>{plans.filter(p => p.executionStatus === "OVERDUE").length} vencidos</span></div>
          <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-orange-700 dark:text-orange-400" /><span>{plans.filter(p => p.executionStatus === "DUE").length} por vencer</span></div>
          <div className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-blue-400/60 inline-block" /><span>{plans.filter(p => p.executionStatus === "IN_WINDOW").length} en ventana</span></div>
          <span className="ml-auto">Total: {plans.length} planes</span>
        </div>
      )}

      <style>{`
        .track-bg{ background-image: repeating-linear-gradient(to right, var(--grid,rgba(120,130,150,.10)) 0 1px, transparent 1px var(--px)); }
        .gantt-pulse{ animation: gpulse 2.2s ease-in-out infinite; }
        @keyframes gpulse{ 0%,100%{ box-shadow:0 0 0 0 color-mix(in srgb, var(--pc) 55%, transparent);} 50%{ box-shadow:0 0 0 5px color-mix(in srgb, var(--pc) 0%, transparent);} }
        @media (prefers-reduced-motion: reduce){ .gantt-pulse{ animation:none; } }
      `}</style>
    </div>
  );
}
