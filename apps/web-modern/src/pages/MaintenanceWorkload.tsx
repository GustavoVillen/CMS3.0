import React, { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Activity, AlertTriangle, Loader2 } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkloadWeek {
  weekStart: string;
  taskCount: number;
  dateBased: number;
  hoursBased: number;
}

interface WorkloadProjection {
  weeks: WorkloadWeek[];
  totalPlans: number;
  projectedPlans: number;
  unscheduledHoursPlans: number;
  unscheduledDatePlans: number;
}

const WEEK_OPTIONS: { value: number; label: string }[] = [
  { value: 26, label: "6 meses" },
  { value: 52, label: "12 meses" },
  { value: 78, label: "18 meses" },
  { value: 104, label: "24 meses" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatWeekLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function formatWeekTooltip(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `Semana del ${day}/${month}/${year}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export const MaintenanceWorkloadPage: React.FC = () => {
  const [weeks, setWeeks] = useState<number>(52);

  const { data, loading, error, reload } = useFetch<WorkloadProjection>(
    `/app/dashboard/maintenance-workload?weeks=${weeks}`,
    [weeks],
  );

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.weeks.map(w => ({
      weekStart: w.weekStart,
      label: formatWeekLabel(w.weekStart),
      total: w.taskCount,
      dateBased: w.dateBased,
      hoursBased: w.hoursBased,
    }));
  }, [data]);

  const stats = useMemo(() => {
    if (!data) return { avg: 0, max: 0, maxWeek: null as string | null };
    const counts = data.weeks.map(w => w.taskCount);
    const total = counts.reduce((a, b) => a + b, 0);
    const avg = counts.length > 0 ? total / counts.length : 0;
    let max = 0;
    let maxWeek: string | null = null;
    for (const w of data.weeks) {
      if (w.taskCount > max) {
        max = w.taskCount;
        maxWeek = w.weekStart;
      }
    }
    return { avg, max, maxWeek };
  }, [data]);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Activity}
        title="Carga de Mantenimiento"
        total={data?.totalPlans}
        onReload={reload}
      >
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-industrial/60">Ventana</label>
          <select
            value={weeks}
            onChange={e => setWeeks(parseInt(e.target.value, 10))}
            className="bg-primary-bg/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {WEEK_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </PageHeader>

      {/* Resumen ejecutivo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Planes activos" value={data?.totalPlans ?? 0} />
        <StatCard label="Proyectados" value={data?.projectedPlans ?? 0} />
        <StatCard
          label="Promedio semanal"
          value={Math.round(stats.avg * 10) / 10}
          hint="tareas/semana"
        />
        <StatCard
          label="Pico"
          value={stats.max}
          hint={stats.maxWeek ? formatWeekTooltip(stats.maxWeek) : undefined}
        />
      </div>

      {/* Aviso de planes sin proyectar */}
      {data && (data.unscheduledHoursPlans > 0 || data.unscheduledDatePlans > 0) && (
        <div className="bento-card p-3! flex items-start gap-3 border-yellow-500/30 bg-yellow-500/5">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
          <div className="text-xs text-text-industrial/70 space-y-1">
            {data.unscheduledHoursPlans > 0 && (
              <p>
                <span className="font-bold text-yellow-300">{data.unscheduledHoursPlans}</span>{" "}
                plan{data.unscheduledHoursPlans !== 1 ? "es" : ""} por horas sin proyectar
                — falta historial de horas de motor o frecuencia inválida.
              </p>
            )}
            {data.unscheduledDatePlans > 0 && (
              <p>
                <span className="font-bold text-yellow-300">{data.unscheduledDatePlans}</span>{" "}
                plan{data.unscheduledDatePlans !== 1 ? "es" : ""} por fecha sin proyectar
                — falta próxima ejecución o frecuencia.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Gráfico */}
      <div className="bento-card p-4!">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-sm font-bold text-white">Tareas por semana — próximos {weeks > 52 ? `${Math.round(weeks/4.33)} meses` : weeks === 52 ? "12 meses" : `${Math.round(weeks/4.33)} meses`}</h2>
            <p className="text-[11px] text-text-industrial/40">
              Suma de ocurrencias proyectadas. Planes por horas estimados según historial reciente del motor.
            </p>
          </div>
          {loading && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
        </div>

        {error ? (
          <div className="flex items-center gap-2 text-red-400 text-xs py-8 justify-center">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "rgba(224,225,221,0.5)", fontSize: 10 }}
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fill: "rgba(224,225,221,0.5)", fontSize: 10 }}
                  allowDecimals={false}
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
                    return ws ? formatWeekTooltip(ws) : "";
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#E0E1DD" }} />
                {stats.avg > 0 && (
                  <ReferenceLine
                    y={stats.avg}
                    stroke="rgba(255,255,255,0.25)"
                    strokeDasharray="4 4"
                    label={{
                      value: `prom. ${stats.avg.toFixed(1)}`,
                      position: "right",
                      fill: "rgba(224,225,221,0.5)",
                      fontSize: 10,
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Total tareas"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={{ r: 2, fill: "#22d3ee" }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="dateBased"
                  name="Por fecha"
                  stroke="#a78bfa"
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="hoursBased"
                  name="Por horas"
                  stroke="#f97316"
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <p className="text-[11px] text-text-industrial/40">
        Etapa actual: cantidad de tareas por semana. Próxima etapa: estimar la
        carga real en horas-hombre a medida que cada tarea tenga su tiempo
        estimado de ejecución.
      </p>
    </div>
  );
};

// ─── StatCard ─────────────────────────────────────────────────────────────────

const StatCard: React.FC<{ label: string; value: number; hint?: string }> = ({ label, value, hint }) => (
  <div className="bento-card p-3!">
    <p className="text-[10px] text-text-industrial/50 uppercase tracking-widest">{label}</p>
    <p className="text-2xl font-bold text-white mt-1">{value}</p>
    {hint && <p className="text-[10px] text-text-industrial/40 mt-0.5">{hint}</p>}
  </div>
);
