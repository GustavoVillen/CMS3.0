import React, { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Activity, AlertTriangle, FileCode, Loader2 } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { downloadAuthedFile } from "../lib/authed-media";
import { useT } from "../lib/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkloadWeek {
  weekStart: string;
  taskCount: number;
  dateBased: number;
  hoursBased: number;
  laborHours: number;
}

interface WorkloadProjection {
  weeks: WorkloadWeek[];
  totalPlans: number;
  projectedPlans: number;
  unscheduledHoursPlans: number;
  unscheduledDatePlans: number;
  plansWithoutEstimate: number;
  overduePlans: number;
  overdueHours: number;
}

type Mode = "count" | "hours";

const WEEK_OPTIONS: { value: number; labelKey: "mwl.months6" | "mwl.months12" | "mwl.months18" | "mwl.months24" }[] = [
  { value: 26,  labelKey: "mwl.months6" },
  { value: 52,  labelKey: "mwl.months12" },
  { value: 78,  labelKey: "mwl.months18" },
  { value: 104, labelKey: "mwl.months24" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatWeekLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function formatWeekTooltip(iso: string, t: (k: "mwl.weekOf") => string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return t("mwl.weekOf").replace("{date}", `${day}/${month}/${year}`);
}

// Lunes (exclusivo) de la semana siguiente — fin del rango [weekStart, weekEnd).
function weekEndExclusive(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00Z");
  if (isNaN(d.getTime())) return weekStart;
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

// Abre la lista de planes filtrada a las tareas que vencen esa semana (pestaña nueva).
function openWeekInPlans(weekStart: string): void {
  const params = new URLSearchParams({ dueFrom: weekStart, dueTo: weekEndExclusive(weekStart) });
  window.open(`/maintenance-plans?${params.toString()}`, "_blank");
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export const MaintenanceWorkloadPage: React.FC = () => {
  const t = useT();
  const [weeks, setWeeks] = useState<number>(52);
  const [mode, setMode] = useState<Mode>("count");

  const { data, loading, error, reload } = useFetch<WorkloadProjection>(
    `/app/dashboard/maintenance-workload?weeks=${weeks}`,
    [weeks],
  );

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.weeks.map(w => ({
      weekStart: w.weekStart,
      label: formatWeekLabel(w.weekStart),
      // count mode
      total: w.taskCount,
      dateBased: w.dateBased,
      hoursBased: w.hoursBased,
      // hours mode
      laborHours: Math.round(w.laborHours * 10) / 10,
    }));
  }, [data]);

  const stats = useMemo(() => {
    if (!data) return { avg: 0, max: 0, maxWeek: null as string | null };
    const values = mode === "count"
      ? data.weeks.map(w => w.taskCount)
      : data.weeks.map(w => w.laborHours);
    const total = values.reduce((a, b) => a + b, 0);
    const avg = values.length > 0 ? total / values.length : 0;
    let max = 0;
    let maxWeek: string | null = null;
    for (const w of data.weeks) {
      const v = mode === "count" ? w.taskCount : w.laborHours;
      if (v > max) {
        max = v;
        maxWeek = w.weekStart;
      }
    }
    return { avg, max, maxWeek };
  }, [data, mode]);

  const isHours = mode === "hours";
  const perWeekHint = t(isHours ? "mwl.manHoursPerWeek" : "mwl.tasksPerWeek");

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Activity}
        title={t("mwl.title")}
        total={data?.totalPlans}
        onReload={reload}
      >
        <button
          onClick={() => {
            const today = new Date().toISOString().slice(0, 10);
            void downloadAuthedFile(
              `/app/dashboard/maintenance-workload/html?weeks=${weeks}`,
              `workload_${today}.html`,
            );
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all"
          title={t("mwl.htmlSnapshotTitle")}
        >
          <FileCode className="w-3.5 h-3.5 text-accent" /> HTML
        </button>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-industrial/60">{t("mwl.window")}</label>
          <select
            value={weeks}
            onChange={e => setWeeks(parseInt(e.target.value, 10))}
            className="bg-primary-bg/60 border border-fg/10 rounded-lg px-2 py-1 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {WEEK_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
            ))}
          </select>
        </div>
      </PageHeader>

      {/* Toggle modo */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-industrial/60">{t("mwl.metric")}</span>
        <div className="inline-flex rounded-lg border border-fg/10 bg-primary-bg/60 p-0.5">
          <button
            onClick={() => setMode("count")}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              mode === "count"
                ? "bg-accent text-accent-fg font-bold"
                : "text-text-industrial/70 hover:text-fg"
            }`}
          >
            {t("mwl.byCount")}
          </button>
          <button
            onClick={() => setMode("hours")}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              mode === "hours"
                ? "bg-accent text-accent-fg font-bold"
                : "text-text-industrial/70 hover:text-fg"
            }`}
          >
            {t("mwl.byManHours")}
          </button>
        </div>
      </div>

      {/* Resumen ejecutivo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={t("mwl.activePlans")} value={data?.totalPlans ?? 0} />
        <StatCard label={t("mwl.projected")} value={data?.projectedPlans ?? 0} />
        <StatCard
          label={t("mwl.weeklyAvg")}
          value={Math.round(stats.avg * 10) / 10}
          hint={perWeekHint}
        />
        <StatCard
          label={t("mwl.peak")}
          value={Math.round(stats.max * 10) / 10}
          hint={stats.maxWeek ? formatWeekTooltip(stats.maxWeek, t) : undefined}
        />
      </div>

      {/* Backlog: planes vencidos — excluidos de la proyección semanal */}
      {data && data.overduePlans > 0 && (
        <div className="bento-card p-3! flex items-start gap-3 border-red-500/30 bg-red-500/5">
          <AlertTriangle className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="text-xs text-text-industrial/70">
            <span className="font-bold text-red-700 dark:text-red-300">{data.overduePlans}</span>{" "}
            {t(data.overduePlans === 1 ? "mwl.overdueBanner.one" : "mwl.overdueBanner.many")}
            {data.overdueHours > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-red-700 dark:text-red-300">{Math.round(data.overdueHours)}</span>{" "}
                {t("mwl.overdueHoursSuffix")}
              </>
            )}
          </div>
        </div>
      )}

      {/* Aviso de planes sin estimación (solo en modo horas) */}
      {isHours && data && data.plansWithoutEstimate > 0 && (
        <div className="bento-card p-3! flex items-start gap-3 border-orange-500/30 bg-orange-500/5">
          <AlertTriangle className="w-4 h-4 text-orange-700 dark:text-orange-400 shrink-0 mt-0.5" />
          <div className="text-xs text-text-industrial/70">
            <span className="font-bold text-orange-700 dark:text-orange-300">{data.plansWithoutEstimate}</span>{" "}
            {t(data.plansWithoutEstimate === 1 ? "mwl.warnNoEstimate.one" : "mwl.warnNoEstimate.many")}
          </div>
        </div>
      )}

      {/* Aviso de planes sin proyectar */}
      {data && (data.unscheduledHoursPlans > 0 || data.unscheduledDatePlans > 0) && (
        <div className="bento-card p-3! flex items-start gap-3 border-yellow-500/30 bg-yellow-500/5">
          <AlertTriangle className="w-4 h-4 text-yellow-700 dark:text-yellow-400 shrink-0 mt-0.5" />
          <div className="text-xs text-text-industrial/70 space-y-1">
            {data.unscheduledHoursPlans > 0 && (
              <p>
                <span className="font-bold text-yellow-700 dark:text-yellow-300">{data.unscheduledHoursPlans}</span>{" "}
                {t(data.unscheduledHoursPlans === 1 ? "mwl.warnNoHoursSched.one" : "mwl.warnNoHoursSched.many")}
              </p>
            )}
            {data.unscheduledDatePlans > 0 && (
              <p>
                <span className="font-bold text-yellow-700 dark:text-yellow-300">{data.unscheduledDatePlans}</span>{" "}
                {t(data.unscheduledDatePlans === 1 ? "mwl.warnNoDateSched.one" : "mwl.warnNoDateSched.many")}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Gráfico */}
      <div className="bento-card p-4!">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-sm font-bold text-fg">
              {t(isHours ? "mwl.chartTitleHours" : "mwl.chartTitleCount")
                .replace("{months}", String(Math.round(weeks / 4.33)))}
            </h2>
            <p className="text-[11px] text-text-industrial/40">
              {t(isHours ? "mwl.chartHelpHours" : "mwl.chartHelpCount")}
            </p>
            <p className="text-[11px] text-accent/70">{t("mwl.clickWeekHint")}</p>
          </div>
          {loading && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
        </div>

        {error ? (
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400 text-xs py-8 justify-center">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 12, right: 16, left: 0, bottom: 8 }}
                style={{ cursor: "pointer" }}
                onClick={(state: { activeTooltipIndex?: number | string | null }) => {
                  // recharts v3: el handler recibe MouseHandlerDataParam (sin activePayload);
                  // usamos activeTooltipIndex para mapear a la semana en chartData.
                  const raw = state?.activeTooltipIndex;
                  const idx = typeof raw === "number" ? raw : Number(raw);
                  if (Number.isInteger(idx) && idx >= 0) {
                    const ws = chartData[idx]?.weekStart;
                    if (ws) openWeekInPlans(ws);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "rgba(224,225,221,0.5)", fontSize: 10 }}
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fill: "rgba(224,225,221,0.5)", fontSize: 10 }}
                  allowDecimals={isHours}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1C2541",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "12px",
                    fontSize: "12px",
                  }}
                  itemStyle={{ color: "#E0E1DD" }}
                  labelFormatter={(_label, payload) => {
                    const ws = payload?.[0]?.payload?.weekStart;
                    return ws ? formatWeekTooltip(ws, t) : "";
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#E0E1DD" }} />
                {stats.avg > 0 && (
                  <ReferenceLine
                    y={stats.avg}
                    stroke="rgba(255,255,255,0.25)"
                    strokeDasharray="4 4"
                    label={{
                      value: t("mwl.avgPrefix").replace("{value}", stats.avg.toFixed(1)),
                      position: "right",
                      fill: "rgba(224,225,221,0.5)",
                      fontSize: 10,
                    }}
                  />
                )}
                {isHours ? (
                  <Line
                    type="monotone"
                    dataKey="laborHours"
                    name={t("mwl.lineHoursName")}
                    stroke="#22d3ee"
                    strokeWidth={2}
                    dot={{ r: 2, fill: "#22d3ee" }}
                    activeDot={{ r: 5 }}
                  />
                ) : (
                  <>
                    <Line
                      type="monotone"
                      dataKey="total"
                      name={t("mwl.lineTotal")}
                      stroke="#22d3ee"
                      strokeWidth={2}
                      dot={{ r: 2, fill: "#22d3ee" }}
                      activeDot={{ r: 5 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="dateBased"
                      name={t("mwl.lineByDate")}
                      stroke="#a78bfa"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="hoursBased"
                      name={t("mwl.lineByHours")}
                      stroke="#f97316"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      dot={false}
                    />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── StatCard ─────────────────────────────────────────────────────────────────

const StatCard: React.FC<{ label: string; value: number; hint?: string }> = ({ label, value, hint }) => (
  <div className="bento-card p-3!">
    <p className="text-[10px] text-text-industrial/50 uppercase tracking-widest">{label}</p>
    <p className="text-2xl font-bold text-fg mt-1">{value}</p>
    {hint && <p className="text-[10px] text-text-industrial/40 mt-0.5">{hint}</p>}
  </div>
);
