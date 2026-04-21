import React from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from "recharts";
import { Ship, Sparkles, AlertCircle, Loader2, AlertTriangle, FileCheck, Clock } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useNavigate } from "react-router-dom";
import { useT, useLocale, translate } from "../lib/i18n";
import { useCopilotEmitter } from "../lib/copilot-context";

// ---------------------------------------------------------------------------
// Types (minimal — only fields we render)
// ---------------------------------------------------------------------------

interface Vessel { code: string; name: string; status: string; }
interface WorkOrder { id: string; status: string; criticality?: string; dueDate?: string; }
interface MaintenancePlan { id: string; executionStatus: string; nextDueDate: string | null; nextDueHours: number | null; }
interface Defect { id: string; status: string; severity: string; }
interface Certificate { id: string; status: string; expiryDate?: string; }
interface Deferral   { id: string; status: string; }
interface AiInsight {
  id: string;
  insightType: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  summary: string;
  targetType: string;
}

interface ListResponse<T> { items: T[]; total: number; }

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const Dashboard: React.FC = () => {
  const vessels           = useFetch<ListResponse<Vessel>>("/app/vessels");
  const workOrders        = useFetch<ListResponse<WorkOrder>>("/app/work-orders");
  const maintenancePlans  = useFetch<ListResponse<MaintenancePlan>>("/app/pms/maintenance-plans");
  const defects           = useFetch<ListResponse<Defect>>("/app/defects");
  const certificates      = useFetch<ListResponse<Certificate>>("/app/certificates");
  const deferrals         = useFetch<ListResponse<Deferral>>("/app/pms/deferrals");
  const insights          = useFetch<ListResponse<AiInsight>>("/app/ai-insights?status=OPEN");
  const navigate     = useNavigate();
  const t            = useT();
  const locale       = useLocale();

  useCopilotEmitter({ module: "DASHBOARD", screen: "DASHBOARD" });

  // KPIs derived from fetched data
  const vesselCount   = vessels.data?.total ?? 0;
const defectsOpen   = defects.data?.items.filter(d => d.status === "OPEN" || d.status === "IN_PROGRESS").length ?? 0;
  const certsExpiring = certificates.data?.items.filter(c => c.status === "EXPIRING_SOON" || c.status === "EXPIRED").length ?? 0;

  // Donut chart: Abiertas / Vencidas / Cerradas
  const statusCounts = React.useMemo(() => {
    const items = workOrders.data?.items ?? [];
    const now = new Date();
    const CLOSED_STATUSES = new Set(["CLOSED", "CANCELLED"]);
    let abiertas = 0, vencidas = 0, postergadas = 0;
    for (const w of items) {
      if (CLOSED_STATUSES.has(w.status)) continue;
      if (w.status === "ON_HOLD") { postergadas++; continue; }
      const overdue = !!w.dueDate && new Date(w.dueDate) < now;
      if (overdue) vencidas++; else abiertas++;
    }
    return [
      { key: "open",       name: "Abiertas",    value: abiertas,    fill: "#06D6A0" },
      { key: "overdue",    name: "Vencidas",     value: vencidas,    fill: "#EF4444" },
      { key: "postponed",  name: "Postergadas",  value: postergadas, fill: "#EAB308" },
    ].filter(s => s.value > 0);
  }, [workOrders.data]);

  // Donut chart: deferrals by status (excluding CLOSED)
  const deferralCounts = React.useMemo(() => {
    const items = (deferrals.data?.items ?? []).filter(d => d.status !== "CLOSED");
    const map: Record<string, number> = { REQUESTED: 0, UNDER_REVIEW: 0, APPROVED: 0, ACTIVE: 0, REJECTED: 0 };
    for (const d of items) if (d.status in map) map[d.status]++;
    return [
      { key: "REQUESTED",    name: "Solicitados",  value: map.REQUESTED,    fill: "#60A5FA" },
      { key: "UNDER_REVIEW", name: "En Revisión",  value: map.UNDER_REVIEW, fill: "#EAB308" },
      { key: "APPROVED",     name: "Aprobados",    value: map.APPROVED,     fill: "#06D6A0" },
      { key: "ACTIVE",       name: "Activos",      value: map.ACTIVE,       fill: "#A78BFA" },
      { key: "REJECTED",     name: "Rechazados",   value: map.REJECTED,     fill: "#EF4444" },
    ].filter(s => s.value > 0);
  }, [deferrals.data]);

  // Donut chart: maintenance plans by execution status (client-side derivation)
  const mpStatusCounts = React.useMemo(() => {
    const items = maintenancePlans.data?.items ?? [];
    const map: Record<string, number> = { OVERDUE: 0, DUE: 0, IN_WINDOW: 0, UPCOMING: 0, FUTURE: 0 };
    const now = Date.now();
    for (const p of items) {
      if (p.executionStatus === "IN_WINDOW") { map.IN_WINDOW++; continue; }
      if (p.nextDueDate) {
        const days = (new Date(p.nextDueDate).getTime() - now) / 86_400_000;
        if (days < 0)       { map.OVERDUE++;  continue; }
        if (days <= 7)      { map.DUE++;      continue; }
        if (days <= 30)     { map.UPCOMING++; continue; }
      }
      map.FUTURE++;
    }
    return [
      { key: "OVERDUE",   name: "Vencidas",    value: map.OVERDUE,   fill: "#EF4444" },
      { key: "DUE",       name: "Por Vencer",  value: map.DUE,       fill: "#F97316" },
      { key: "IN_WINDOW", name: "En Proceso",  value: map.IN_WINDOW, fill: "#06D6A0" },
      { key: "UPCOMING",  name: "Próximas",    value: map.UPCOMING,  fill: "#EAB308" },
      { key: "FUTURE",    name: "Al Día",      value: map.FUTURE,    fill: "rgba(255,255,255,0.2)" },
    ].filter(s => s.value > 0);
  }, [maintenancePlans.data]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Ship}          label={t("dashboard.vessels")}      value={vesselCount}    loading={vessels.loading}      onClick={() => navigate("/vessels")} />
        <StatCard icon={AlertTriangle} label={t("dashboard.defects")}      value={defectsOpen}    loading={defects.loading}      color="text-accent" onClick={() => navigate("/defects")} />
        <StatCard icon={FileCheck}     label={t("dashboard.certificates")} value={certsExpiring}  loading={certificates.loading} color={certsExpiring > 0 ? "text-red-400" : "text-white"} onClick={() => navigate("/certificates")} />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* WO chart */}
        <div className="bento-card flex flex-col h-[260px]">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-sm font-bold text-white">{t("dashboard.woTitle")}</h2>
              <p className="text-[10px] text-text-industrial/40">{t("dashboard.woSubtitle")}</p>
            </div>
            {workOrders.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          {workOrders.error ? <ErrorMsg msg={workOrders.error} /> : (
            <div className="flex items-center gap-2 flex-1">
              <div className="w-[160px] h-[160px] shrink-0 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusCounts} cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {statusCounts.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "#1C2541", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px" }} itemStyle={{ color: "#E0E1DD" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-white">{workOrders.data?.items.length ?? 0}</span>
                  <span className="text-[11px] text-text-industrial/40 uppercase tracking-wider">Total</span>
                </div>
              </div>
              <div className="w-[130px] space-y-2">
                {statusCounts.map(s => (
                  <button key={s.name} type="button" onClick={() => navigate(`/work-orders?view=${s.key}`)}
                    className="w-full flex items-center gap-1.5 text-left rounded px-1 py-0.5 hover:bg-white/5 transition-colors group">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.fill }} />
                    <span className="text-[13px] text-text-industrial/60 group-hover:text-white transition-colors truncate flex-1">{s.name}</span>
                    <span className="text-[13px] font-bold text-white">{s.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Maintenance Plans status chart */}
        <div className="bento-card flex flex-col h-[260px]">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-sm font-bold text-white">Planes de Mantenimiento</h2>
              <p className="text-[10px] text-text-industrial/40">Estado de ejecución</p>
            </div>
            {maintenancePlans.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          {maintenancePlans.error ? <ErrorMsg msg={maintenancePlans.error} /> : (
            <div className="flex items-center gap-2 flex-1">
              <div className="w-[160px] h-[160px] shrink-0 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mpStatusCounts} cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {mpStatusCounts.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "#1C2541", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px" }} itemStyle={{ color: "#E0E1DD" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-white">{maintenancePlans.data?.items.length ?? 0}</span>
                  <span className="text-[11px] text-text-industrial/40 uppercase tracking-wider">Total</span>
                </div>
              </div>
              <div className="w-[130px] space-y-2">
                {mpStatusCounts.map(s => (
                  <button key={s.key} type="button" onClick={() => navigate(`/maintenance-plans?executionStatus=${s.key}`)}
                    className="w-full flex items-center gap-1.5 text-left rounded px-1 py-0.5 hover:bg-white/5 transition-colors group">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.fill }} />
                    <span className="text-[13px] text-text-industrial/60 group-hover:text-white transition-colors truncate flex-1">{s.name}</span>
                    <span className="text-[13px] font-bold text-white">{s.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Deferrals status chart */}
        <div className="bento-card flex flex-col h-[260px]">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-sm font-bold text-white">Aplazamientos</h2>
              <p className="text-[10px] text-text-industrial/40">Estado activo</p>
            </div>
            {deferrals.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          {deferrals.error ? <ErrorMsg msg={deferrals.error} /> : deferralCounts.length === 0 && !deferrals.loading ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 opacity-40">
              <Clock className="w-6 h-6 text-text-industrial/40" />
              <p className="text-xs text-text-industrial/40">Sin aplazamientos activos</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <div className="w-[160px] h-[160px] shrink-0 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={deferralCounts} cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {deferralCounts.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "#1C2541", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px" }} itemStyle={{ color: "#E0E1DD" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-white">{deferralCounts.reduce((a, s) => a + s.value, 0)}</span>
                  <span className="text-[11px] text-text-industrial/40 uppercase tracking-wider">Total</span>
                </div>
              </div>
              <div className="w-[130px] space-y-2">
                {deferralCounts.map(s => (
                  <button key={s.key} type="button" onClick={() => navigate(`/deferrals?status=${s.key}`)}
                    className="w-full flex items-center gap-1.5 text-left rounded px-1 py-0.5 hover:bg-white/5 transition-colors group">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.fill }} />
                    <span className="text-[13px] text-text-industrial/60 group-hover:text-white transition-colors truncate flex-1">{s.name}</span>
                    <span className="text-[13px] font-bold text-white">{s.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* AI Insights panel */}
        <div className="bento-card flex flex-col glass-glow">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-accent">
              <Sparkles className="w-4 h-4" />
              <h2 className="text-sm font-bold">AI Insights</h2>
            </div>
            {insights.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          {insights.error ? (
            <ErrorMsg msg={insights.error} />
          ) : insights.data?.total === 0 ? (
            <p className="text-xs text-text-industrial/30 text-center mt-8">{t("dashboard.noInsights")}</p>
          ) : (
            <div className="space-y-2 flex-1 overflow-y-auto">
              {(insights.data?.items ?? []).slice(0, 5).map(ins => (
                <InsightItem key={ins.id} insight={ins} />
              ))}
            </div>
          )}
          <button onClick={() => navigate("/ai-insights")}
            className="mt-3 w-full py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 transition-all">
            {t("dashboard.viewAllInsights")}
          </button>
        </div>

        {/* Inactive vessels — compact alert strip */}
        {(() => {
          const inactive = (vessels.data?.items ?? []).filter(v => v.status !== "ACTIVE");
          if (vessels.loading || inactive.length === 0) return null;
          return (
            <div className="lg:col-span-3 flex items-center gap-3 px-4 py-3 rounded-xl bg-white/3 border border-white/8">
              <Ship className="w-4 h-4 text-text-industrial/40 shrink-0" />
              <span className="text-xs text-text-industrial/50">{t("dashboard.inactiveVessels")}</span>
              <div className="flex flex-wrap gap-2 flex-1">
                {inactive.map(v => (
                  <span key={v.code} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-text-industrial/50 font-medium cursor-pointer hover:border-accent/30 transition-all" onClick={() => navigate("/vessels")}>
                    {v.code} · {v.status}
                  </span>
                ))}
              </div>
              <button onClick={() => navigate("/vessels")} className="text-[10px] text-accent hover:underline shrink-0">{t("dashboard.viewAll")}</button>
            </div>
          );
        })()}
      </div>

    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatCard = ({ icon: Icon, label, value, loading, color = "text-white", onClick }: {
  icon: React.FC<{ className?: string }>;
  label: string;
  value: number;
  loading: boolean;
  color?: string;
  onClick?: () => void;
}) => (
  <div className="bento-card cursor-pointer" onClick={onClick}>
    <div className="flex items-start justify-between mb-4">
      <div className="p-2 rounded-lg bg-white/5 border border-white/10">
        <Icon className="w-4 h-4 text-accent" />
      </div>
      {loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
    </div>
    <p className="text-xs text-text-industrial/40 font-medium mb-1">{label}</p>
    <p className={`text-2xl font-bold tracking-tight ${color}`}>
      {loading ? "—" : value}
    </p>
  </div>
);

const PRIORITY_STYLES: Record<string, string> = {
  CRITICAL: "bg-red-500/10 text-red-400 border-red-500/20",
  HIGH:     "bg-accent/10 text-accent border-accent/20",
  MEDIUM:   "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  LOW:      "bg-white/5 text-text-industrial/40 border-white/10",
};

const InsightItem = ({ insight }: { insight: AiInsight }) => (
  <div className="p-3 rounded-xl border border-white/5 bg-white/2 hover:bg-white/4 transition-all cursor-pointer group">
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-[9px] font-bold tracking-widest text-text-industrial/30 uppercase">{insight.targetType}</span>
      <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${PRIORITY_STYLES[insight.priority]}`}>
        {insight.priority}
      </span>
    </div>
    <h3 className="text-xs font-bold text-white group-hover:text-accent transition-colors line-clamp-1">{insight.title}</h3>
    <p className="text-[10px] text-text-industrial/50 mt-0.5 line-clamp-2">{insight.summary}</p>
  </div>
);

const ErrorMsg = ({ msg }: { msg: string }) => (
  <div className="flex items-center gap-2 text-red-400 text-xs p-3 bg-red-500/10 rounded-lg">
    <AlertCircle className="w-4 h-4 shrink-0" />
    {msg}
  </div>
);

// Suppress unused warnings
