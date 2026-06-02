import React, { useMemo, useState } from "react";
import { Gantt, ViewMode, type Task } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { AlertTriangle, CalendarRange, CheckCircle2, ChevronDown, ChevronRight, Clock, Filter, Loader2, type LucideIcon } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";

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
  sfiGroupNumber: number | null;
  sfiSubgroupCode: string | null;
}

interface ListResponse {
  items: MaintenancePlan[];
  total: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string; bar: string; progress: string }> = {
  COMPLETED:  { bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-400", bar: "#22c55e",  progress: "#16a34a" },
  IN_WINDOW:  { bg: "bg-blue-500/10",    text: "text-blue-700 dark:text-blue-400",    bar: "#3b82f6",  progress: "#2563eb" },
  UPCOMING:   { bg: "bg-yellow-500/10",  text: "text-yellow-700 dark:text-yellow-400",  bar: "#eab308",  progress: "#ca8a04" },
  DUE:        { bg: "bg-orange-500/10",  text: "text-orange-700 dark:text-orange-400",  bar: "#f97316",  progress: "#ea580c" },
  OVERDUE:    { bg: "bg-red-500/10",     text: "text-red-700 dark:text-red-400",     bar: "#ef4444",  progress: "#dc2626" },
  FUTURE:     { bg: "bg-slate-500/10",   text: "text-slate-400",   bar: "#64748b",  progress: "#475569" },
};

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Completado",
  IN_WINDOW: "En Ventana",
  UPCOMING:  "Próximo",
  DUE:       "Vencido pronto",
  OVERDUE:   "Vencido",
  FUTURE:    "Futuro",
};

const SFI_GROUP_NAMES: Record<number, string> = {
  1:  "Estructura del buque",
  2:  "Protección del buque",
  3:  "Equipos portátiles",
  4:  "Sistema de propulsión",
  5:  "Sistema de cubierta",
  6:  "Motor y maquinaria aux.",
  7:  "Sistemas de control",
  8:  "Instalaciones",
  9:  "Sistemas eléctricos",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSfiGroupName(groupNumber: number | null): string {
  if (groupNumber == null) return "Sin clasificación SFI";
  return SFI_GROUP_NAMES[Math.floor(groupNumber / 100)] ?? `Grupo SFI ${groupNumber}`;
}

/** Returns a safe date: if the input is invalid or null, falls back to today ± offset months */
function safeDate(dateStr: string | null, offsetMonths = 0): Date {
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  return d;
}

/** Ensures start < end with at least 1-day span */
function normalizeDates(start: Date, end: Date): [Date, Date] {
  if (end <= start) {
    const newEnd = new Date(start);
    newEnd.setDate(newEnd.getDate() + 7);
    return [start, newEnd];
  }
  return [start, end];
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function GanttLegend() {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {Object.entries(STATUS_LABELS).map(([key, label]) => (
        <div key={key} className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ backgroundColor: STATUS_COLORS[key]?.bar ?? "#64748b" }}
          />
          <span className="text-[11px] text-text-industrial/60">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Status filter chip ───────────────────────────────────────────────────────

function StatusChip({
  statusKey,
  active,
  count,
  onClick,
}: {
  statusKey: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const colors = STATUS_COLORS[statusKey] ?? STATUS_COLORS.FUTURE;
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all
        ${active
          ? `${colors.bg} ${colors.text} border-current/30`
          : "bg-fg/5 text-text-industrial/40 border-fg/10 hover:bg-fg/10"
        }
      `}
    >
      {STATUS_LABELS[statusKey] ?? statusKey}
      <span className={`text-[10px] opacity-70`}>{count}</span>
    </button>
  );
}

// ─── Date formatter ───────────────────────────────────────────────────────────

function fmtDMY(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

// ─── Custom task list header ───────────────────────────────────────────────────

const DATE_COL_W = 74; // px — ancho de cada columna de fecha
const NAME_COL_W = 220; // px — ancho de columna de nombre (listCellWidth)

const CustomTaskListHeader: React.FC<{
  headerHeight: number;
  rowWidth: string;
  fontFamily: string;
  fontSize: string;
}> = ({ headerHeight }) => (
  <div
    className="flex items-center border-b border-fg/10 bg-surface dark:bg-[#0a0f1e]"
    style={{ height: headerHeight }}
  >
    <div
      className="flex items-center px-3 text-[10px] font-semibold uppercase tracking-wider text-text-industrial/40 border-r border-fg/10 shrink-0"
      style={{ width: NAME_COL_W, minWidth: NAME_COL_W }}
    >
      Tarea
    </div>
    <div
      className="flex items-center px-2 text-[10px] font-semibold uppercase tracking-wider text-text-industrial/40 border-r border-fg/10 shrink-0"
      style={{ width: DATE_COL_W, minWidth: DATE_COL_W }}
    >
      Desde
    </div>
    <div
      className="flex items-center px-2 text-[10px] font-semibold uppercase tracking-wider text-text-industrial/40 shrink-0"
      style={{ width: DATE_COL_W, minWidth: DATE_COL_W }}
    >
      Hasta
    </div>
  </div>
);

// ─── Custom task list table ────────────────────────────────────────────────────

const CustomTaskListTable: React.FC<{
  rowHeight: number;
  rowWidth: string;
  fontFamily: string;
  fontSize: string;
  locale: string;
  tasks: Task[];
  selectedTaskId: string;
  setSelectedTask: (taskId: string) => void;
  onExpanderClick: (task: Task) => void;
}> = ({ rowHeight, tasks, selectedTaskId, setSelectedTask, onExpanderClick }) => (
  <div className="bg-surface dark:bg-[#0a0f1e]">
    {tasks.map((task) => {
      const isProject  = task.type === "project";
      const isSelected = task.id === selectedTaskId;
      const depth      = task.project ? (task.project.startsWith("sfi-") ? 2 : 1) : 0;

      return (
        <div
          key={task.id}
          className={`flex items-center border-b border-fg/[0.04] cursor-pointer transition-colors
            ${isSelected ? "bg-accent/10" : isProject ? "bg-fg/[0.02] hover:bg-fg/[0.04]" : "hover:bg-fg/[0.03]"}`}
          style={{ height: rowHeight }}
          onClick={() => setSelectedTask(task.id)}
        >
          {/* Name cell */}
          <div
            className="flex items-center gap-1 px-2 border-r border-fg/10 overflow-hidden shrink-0"
            style={{ width: NAME_COL_W, minWidth: NAME_COL_W, paddingLeft: 8 + depth * 12 }}
          >
            {isProject && (
              <button
                className="text-text-industrial/40 hover:text-fg transition-colors shrink-0"
                onClick={(e) => { e.stopPropagation(); onExpanderClick(task); }}
              >
                {task.hideChildren
                  ? <ChevronRight className="w-3 h-3" />
                  : <ChevronDown className="w-3 h-3" />
                }
              </button>
            )}
            <span
              className={`truncate leading-tight ${
                isProject
                  ? "text-[10px] font-semibold text-fg/70"
                  : "text-[10px] text-text-industrial/60"
              }`}
              title={task.name}
            >
              {task.name}
            </span>
          </div>

          {/* From cell */}
          <div
            className="px-2 border-r border-fg/10 text-[10px] tabular-nums text-text-industrial/50 shrink-0"
            style={{ width: DATE_COL_W, minWidth: DATE_COL_W }}
          >
            {isProject ? "" : fmtDMY(task.start)}
          </div>

          {/* To cell */}
          <div
            className="px-2 text-[10px] tabular-nums text-text-industrial/50 shrink-0"
            style={{ width: DATE_COL_W, minWidth: DATE_COL_W }}
          >
            {isProject ? "" : fmtDMY(task.end)}
          </div>
        </div>
      );
    })}
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

export function MaintenanceGanttPage() {
  const { data, loading, error } = useFetch<ListResponse>("/app/pms/maintenance-plans?limit=500");

  const plans = data?.items ?? [];

  // ── Filters ──
  const vessels = useMemo(
    () => Array.from(new Set(plans.map((p) => p.vesselCode))).sort(),
    [plans],
  );

  const [selectedVessel, setSelectedVessel] = useState<string>("ALL");
  const [selectedYear,   setSelectedYear]   = useState<number>(new Date().getFullYear());
  const [selectedType,   setSelectedType]   = useState<string>("ALL");
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(
    new Set(["OVERDUE", "DUE", "IN_WINDOW", "UPCOMING", "FUTURE", "COMPLETED"]),
  );
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Month);

  function toggleStatus(s: string) {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  // ── Filtered plans ──
  const filtered = useMemo(() => {
    return plans.filter((p) => {
      if (selectedVessel !== "ALL" && p.vesselCode !== selectedVessel) return false;
      if (selectedType !== "ALL" && p.taskType !== selectedType) return false;
      if (!activeStatuses.has(p.executionStatus)) return false;
      // Year filter: include plans whose range overlaps the selected year
      const start = safeDate(p.lastExecutionDate, -1);
      const end   = safeDate(p.nextDueDate, 1);
      const yearStart = new Date(selectedYear, 0, 1);
      const yearEnd   = new Date(selectedYear, 11, 31);
      if (end < yearStart || start > yearEnd) return false;
      return true;
    });
  }, [plans, selectedVessel, selectedYear, selectedType, activeStatuses]);

  // ── Status counts (of raw filtered by vessel/year/type only) ──
  const statusCounts = useMemo(() => {
    const base = plans.filter((p) => {
      if (selectedVessel !== "ALL" && p.vesselCode !== selectedVessel) return false;
      if (selectedType !== "ALL" && p.taskType !== selectedType) return false;
      return true;
    });
    const counts: Record<string, number> = {};
    base.forEach((p) => {
      counts[p.executionStatus] = (counts[p.executionStatus] ?? 0) + 1;
    });
    return counts;
  }, [plans, selectedVessel, selectedType]);

  // ── Build Gantt tasks ──
  const ganttTasks = useMemo((): Task[] => {
    if (filtered.length === 0) return [];

    // Group by vessel → SFI group
    type Groups = Record<string, Record<string, MaintenancePlan[]>>;
    const groups: Groups = {};

    for (const plan of filtered) {
      const vessel = plan.vesselCode;
      const sfi    = getSfiGroupName(plan.sfiGroupNumber);
      if (!groups[vessel])       groups[vessel]       = {};
      if (!groups[vessel][sfi])  groups[vessel][sfi]  = [];
      groups[vessel][sfi].push(plan);
    }

    const tasks: Task[] = [];

    for (const [vessel, sfiGroups] of Object.entries(groups)) {
      // Project row = vessel
      tasks.push({
        id:           `vessel-${vessel}`,
        name:         vessel,
        start:        new Date(selectedYear, 0, 1),
        end:          new Date(selectedYear, 11, 31),
        progress:     0,
        type:         "project",
        hideChildren: false,
        displayOrder: tasks.length + 1,
        styles: {
          backgroundColor:         "#1e293b",
          backgroundSelectedColor: "#334155",
          progressColor:           "#334155",
          progressSelectedColor:   "#475569",
        },
      });

      for (const [sfiName, sfiPlans] of Object.entries(sfiGroups)) {
        // Project row = SFI group (nested)
        tasks.push({
          id:           `sfi-${vessel}-${sfiName}`,
          name:         sfiName,
          start:        new Date(selectedYear, 0, 1),
          end:          new Date(selectedYear, 11, 31),
          progress:     0,
          type:         "project",
          project:      `vessel-${vessel}`,
          hideChildren: false,
          displayOrder: tasks.length + 1,
          styles: {
            backgroundColor:         "#0f172a",
            backgroundSelectedColor: "#1e293b",
            progressColor:           "#1e293b",
            progressSelectedColor:   "#334155",
          },
        });

        for (const plan of sfiPlans) {
          const rawStart = safeDate(plan.lastExecutionDate, -1);
          const rawEnd   = safeDate(plan.nextDueDate, 1);
          const [start, end] = normalizeDates(rawStart, rawEnd);
          const colors = STATUS_COLORS[plan.executionStatus] ?? STATUS_COLORS.FUTURE;

          tasks.push({
            id:           plan.id,
            name:         `${plan.taskCode} · ${plan.title}`,
            start,
            end,
            progress:     plan.executionStatus === "COMPLETED" ? 100 : 0,
            type:         "task",
            project:      `sfi-${vessel}-${sfiName}`,
            displayOrder: tasks.length + 1,
            styles: {
              backgroundColor:         colors.bar + "cc",
              backgroundSelectedColor: colors.bar,
              progressColor:           colors.progress,
              progressSelectedColor:   colors.progress,
            },
          });
        }
      }
    }

    return tasks;
  }, [filtered, selectedYear]);

  // ── Years available ──
  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 1, current, current + 1, current + 2];
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 h-full">
      <PageHeader
        title="Gantt de Mantenimiento"
        total={filtered.length}
        icon={CalendarRange as LucideIcon}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Vessel filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-text-industrial/40" />
          <select
            value={selectedVessel}
            onChange={(e) => setSelectedVessel(e.target.value)}
            className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial/80 focus:outline-none focus:border-accent/40"
          >
            <option value="ALL">Todos los buques</option>
            {vessels.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        {/* Year filter */}
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial/80 focus:outline-none focus:border-accent/40"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        {/* Task type filter */}
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial/80 focus:outline-none focus:border-accent/40"
        >
          <option value="ALL">Mant. + Inspecciones</option>
          <option value="MAINTENANCE">Solo Mantenimiento</option>
          <option value="INSPECTION">Solo Inspecciones</option>
        </select>

        {/* View mode */}
        <div className="flex items-center gap-1 bg-fg/5 border border-fg/10 rounded-lg p-0.5">
          {(
            [
              { mode: ViewMode.Week,  label: "Semana" },
              { mode: ViewMode.Month, label: "Mes" },
              { mode: ViewMode.Year,  label: "Año" },
            ] as const
          ).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                viewMode === mode
                  ? "bg-accent/20 text-accent border border-accent/30"
                  : "text-text-industrial/50 hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Status chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {Object.keys(STATUS_LABELS).map((s) => (
            <StatusChip
              key={s}
              statusKey={s}
              active={activeStatuses.has(s)}
              count={statusCounts[s] ?? 0}
              onClick={() => toggleStatus(s)}
            />
          ))}
        </div>
      </div>

      {/* Legend */}
      <GanttLegend />

      {/* Content */}
      <div className="flex-1 min-h-0 rounded-xl border border-fg/10 overflow-hidden bg-surface dark:bg-[#0a0f1e]">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-3 text-text-industrial/40">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Cargando planes de mantenimiento…</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full gap-3 text-red-700 dark:text-red-400">
            <AlertTriangle className="w-5 h-5" />
            <span className="text-sm">{error}</span>
          </div>
        ) : ganttTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-industrial/20">
            <CalendarRange className="w-12 h-12" />
            <p className="text-sm">No hay planes para los filtros seleccionados.</p>
          </div>
        ) : (
          <div className="gantt-wrapper h-full overflow-auto">
            <Gantt
              tasks={ganttTasks}
              viewMode={viewMode}
              locale="es"
              listCellWidth={`${NAME_COL_W + DATE_COL_W * 2}px`}
              columnWidth={viewMode === ViewMode.Week ? 40 : viewMode === ViewMode.Month ? 65 : 200}
              barCornerRadius={4}
              headerHeight={48}
              rowHeight={34}
              barFill={60}
              fontSize="11px"
              todayColor="rgba(99,102,241,0.15)"
              projectBackgroundColor="#1e293b"
              projectProgressColor="#334155"
              projectBackgroundSelectedColor="#334155"
              projectProgressSelectedColor="#475569"
              TaskListHeader={CustomTaskListHeader}
              TaskListTable={CustomTaskListTable}
            />
          </div>
        )}
      </div>

      {/* Summary bar */}
      {!loading && !error && plans.length > 0 && (
        <div className="flex items-center gap-6 px-4 py-2.5 rounded-xl bg-fg/3 border border-fg/8 text-[11px] text-text-industrial/50 flex-wrap">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
            <span>{plans.filter(p => p.executionStatus === "COMPLETED").length} completados</span>
          </div>
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-700 dark:text-red-400" />
            <span>{plans.filter(p => p.executionStatus === "OVERDUE").length} vencidos</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-orange-700 dark:text-orange-400" />
            <span>{plans.filter(p => p.executionStatus === "DUE").length} por vencer</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-full bg-blue-400/60 inline-block" />
            <span>{plans.filter(p => p.executionStatus === "IN_WINDOW").length} en ventana</span>
          </div>
          <span className="ml-auto">Total: {plans.length} planes</span>
        </div>
      )}

      {/* Custom CSS overrides for gantt-task-react dark theme */}
      <style>{`
        .gantt-wrapper ._3_ygE,
        .gantt-wrapper ._2dZTy,
        .gantt-wrapper ._34SS0 {
          background: transparent !important;
        }
        .gantt-wrapper ._9w8d5 {
          fill: #1e293b !important;
          stroke: rgba(255,255,255,0.06) !important;
        }
        .gantt-wrapper ._3zRJQ {
          stroke: rgba(255,255,255,0.06) !important;
        }
        .gantt-wrapper text {
          fill: rgba(148,163,184,0.8) !important;
          font-family: ui-monospace, monospace !important;
        }
        .gantt-wrapper ._WuQ0f {
          fill: rgba(255,255,255,0.03) !important;
          stroke: rgba(255,255,255,0.06) !important;
        }
        .gantt-wrapper ._3rUKi {
          fill: rgba(99,102,241,0.12) !important;
          stroke: none !important;
        }
        .gantt-wrapper ._2k9Ys rect {
          fill: rgba(255,255,255,0.02) !important;
          stroke: rgba(255,255,255,0.06) !important;
        }
      `}</style>
    </div>
  );
}
