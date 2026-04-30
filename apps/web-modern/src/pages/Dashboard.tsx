import React from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { Ship, Sparkles, AlertCircle, Loader2, AlertTriangle, FileCheck, Clock, Package, Droplets } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useNavigate } from "react-router-dom";
import { useT, useLocale, translate } from "../lib/i18n";
import { parseLocalDate } from "../lib/utils";
import { useCopilotEmitter } from "../lib/copilot-context";
import { useVesselContext } from "../lib/vessel-context";

// ---------------------------------------------------------------------------
// Types (minimal — only fields we render)
// ---------------------------------------------------------------------------

interface Vessel { code: string; name: string; status: string; }
interface WorkOrder { id: string; status: string; criticality?: string; dueDate?: string; }
interface MaintenancePlan { id: string; executionStatus: string; nextDueDate: string | null; nextDueHours: number | null; lastExecutionDate: string | null; lastExecutionHours: number | null; }
interface Defect { id: string; status: string; severity: string; }
interface Certificate { id: string; status: string; expiryDate?: string; }
interface Deferral   { id: string; status: string; }
interface CritSpare  { id: string; available: number; reorderPoint: number | null; }
interface SpareRequest { id: string; status: string; items: { id: string; status: string; quantity: number; quantityFulfilled: number }[]; }
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
  const criticalSpares    = useFetch<ListResponse<CritSpare>>("/app/pms/spares?criticality=A");
  const spareRequests     = useFetch<ListResponse<SpareRequest>>("/app/pms/spare-requests");
  const navigate     = useNavigate();
  const t            = useT();
  const locale       = useLocale();
  const [showInsights, setShowInsights] = React.useState(false);
  const { selectedVessel, isVesselScoped } = useVesselContext();

  // useFetch injects vesselCode automatically from VesselContext
  const fuelData = useFetch<{ items: { date: string; liters: number }[] }>("/app/dashboard/fuel-consumption?days=30");

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
      const overdue = !!w.dueDate && parseLocalDate(w.dueDate) < now;
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

  // Donut chart: maintenance plans by execution status — same logic as computeStatus() in MaintenancePlans.tsx
  const mpStatusCounts = React.useMemo(() => {
    const items = maintenancePlans.data?.items ?? [];
    const map: Record<string, number> = { NEVER_EXECUTED: 0, OVERDUE: 0, DUE: 0, IN_WINDOW: 0, UPCOMING: 0, FUTURE: 0 };
    const now = Date.now();
    for (const p of items) {
      if (p.executionStatus === "IN_WINDOW") { map.IN_WINDOW++; continue; }
      if (p.lastExecutionDate == null && p.lastExecutionHours == null) { map.NEVER_EXECUTED++; continue; }
      if (p.nextDueHours != null) {
        const hours = (p as any).assetCurrentHours ?? 0;
        const diff = p.nextDueHours - hours;
        if (diff <= 0)   { map.OVERDUE++;  continue; }
        if (diff <= 50)  { map.DUE++;      continue; }
        if (diff <= 250) { map.UPCOMING++; continue; }
        map.FUTURE++; continue;
      }
      if (p.nextDueDate) {
        const days = (parseLocalDate(p.nextDueDate).getTime() - now) / 86_400_000;
        if (days < 0)   { map.OVERDUE++;  continue; }
        if (days <= 7)  { map.DUE++;      continue; }
        if (days <= 30) { map.UPCOMING++; continue; }
      }
      map.FUTURE++;
    }
    return [
      { key: "NEVER_EXECUTED", name: "Sin ejecutar", value: map.NEVER_EXECUTED, fill: "#64748b" },
      { key: "OVERDUE",        name: "Vencidas",      value: map.OVERDUE,        fill: "#EF4444" },
      { key: "DUE",            name: "Por Vencer",    value: map.DUE,            fill: "#F97316" },
      { key: "IN_WINDOW",      name: "En Proceso",    value: map.IN_WINDOW,      fill: "#EAB308" },
      { key: "UPCOMING",       name: "Próximas",      value: map.UPCOMING,       fill: "#F97316" },
      { key: "FUTURE",         name: "Al Día",        value: map.FUTURE,         fill: "#06D6A0" },
    ].filter(s => s.value > 0);
  }, [maintenancePlans.data]);

  const spareReqCounts = React.useMemo(() => {
    const allItems = (spareRequests.data?.items ?? []).flatMap(r => r.items);
    const map: Record<string, number> = { PENDING: 0, FULFILLED: 0, CANCELLED: 0 };
    for (const i of allItems) {
      if (i.status === "FULFILLED") map.FULFILLED++;
      else if (i.status === "CANCELLED") map.CANCELLED++;
      else map.PENDING++;
    }
    return [
      { key: "PENDING",   name: "Pendientes",  value: map.PENDING,   fill: "#EAB308" },
      { key: "FULFILLED", name: "Recibidos",   value: map.FULFILLED, fill: "#06D6A0" },
      { key: "CANCELLED", name: "Cancelados",  value: map.CANCELLED, fill: "#475569" },
    ].filter(s => s.value > 0);
  }, [spareRequests.data]);

  const critSparesCounts = React.useMemo(() => {
    const items = criticalSpares.data?.items ?? [];
    let sinStock = 0, bajoReorden = 0, ok = 0;
    for (const s of items) {
      if (s.available <= 0) { sinStock++; continue; }
      if (s.reorderPoint !== null && s.reorderPoint > 0 && s.available < s.reorderPoint) { bajoReorden++; continue; }
      ok++;
    }
    return [
      { key: "sin_stock",    name: "Sin Stock",     value: sinStock,    fill: "#EF4444" },
      { key: "bajo_reorden", name: "Bajo Reorden",  value: bajoReorden, fill: "#F97316" },
      { key: "ok",           name: "OK",            value: ok,          fill: "#06D6A0" },
    ].filter(s => s.value > 0);
  }, [criticalSpares.data]);

  const insightCount = insights.data?.total ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Ship}          label={t("dashboard.vessels")}      value={vesselCount}    loading={vessels.loading}      onClick={() => navigate("/vessels")} />
        <StatCard icon={AlertTriangle} label={t("dashboard.defects")}      value={defectsOpen}    loading={defects.loading}      color="text-accent" onClick={() => navigate("/defects")} />
        <StatCard icon={FileCheck}     label={t("dashboard.certificates")} value={certsExpiring}  loading={certificates.loading} color={certsExpiring > 0 ? "text-red-400" : "text-white"} onClick={() => navigate("/certificates")} />
        <AiInsightBadge count={insightCount} loading={insights.loading} onClick={() => setShowInsights(true)} />
      </div>

      {/* AI Insights modal */}
      {showInsights && (
        <InsightsModal
          insights={insights.data?.items ?? []}
          loading={insights.loading}
          onClose={() => setShowInsights(false)}
          onNavigate={() => { setShowInsights(false); navigate("/ai-insights"); }}
          t={t}
        />
      )}

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

        {/* Critical Spares stock status chart */}
        <div className="bento-card flex flex-col h-[260px]">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-sm font-bold text-white">Repuestos Críticos</h2>
              <p className="text-[10px] text-text-industrial/40">Estado de stock (criticidad A)</p>
            </div>
            {criticalSpares.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          {criticalSpares.error ? <ErrorMsg msg={criticalSpares.error} /> : critSparesCounts.length === 0 && !criticalSpares.loading ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 opacity-40">
              <Package className="w-6 h-6 text-text-industrial/40" />
              <p className="text-xs text-text-industrial/40">Sin repuestos críticos registrados</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <div className="w-[160px] h-[160px] shrink-0 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={critSparesCounts} cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {critSparesCounts.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "#1C2541", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px" }} itemStyle={{ color: "#E0E1DD" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-white">{criticalSpares.data?.total ?? 0}</span>
                  <span className="text-[11px] text-text-industrial/40 uppercase tracking-wider">Total</span>
                </div>
              </div>
              <div className="w-[130px] space-y-2">
                {critSparesCounts.map(s => (
                  <button key={s.key} type="button" onClick={() => navigate(`/spares?criticality=A&stockStatus=${s.key}`)}
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

        {/* Spare Requests status chart */}
        <div className="bento-card flex flex-col h-[260px]">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-sm font-bold text-white">Solicitudes de Repuestos</h2>
              <p className="text-[10px] text-text-industrial/40">Ítems por estado de recepción</p>
            </div>
            {spareRequests.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          {spareRequests.error ? <ErrorMsg msg={spareRequests.error} /> : spareReqCounts.length === 0 && !spareRequests.loading ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 opacity-40">
              <Package className="w-6 h-6 text-text-industrial/40" />
              <p className="text-xs text-text-industrial/40">Sin solicitudes registradas</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <div className="w-[160px] h-[160px] shrink-0 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={spareReqCounts} cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {spareReqCounts.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "#1C2541", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px" }} itemStyle={{ color: "#E0E1DD" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-white">{spareReqCounts.reduce((a, s) => a + s.value, 0)}</span>
                  <span className="text-[11px] text-text-industrial/40 uppercase tracking-wider">Ítems</span>
                </div>
              </div>
              <div className="w-[130px] space-y-2">
                {spareReqCounts.map(s => (
                  <button key={s.key} type="button" onClick={() => navigate(`/spare-requests?status=${s.key}`)}
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

        {/* Droplets consumption trend */}
        <div className="lg:col-span-3">
          <FuelConsumptionWidget
            data={fuelData.data?.items ?? []}
            loading={fuelData.loading}
            error={fuelData.error}
            vesselName={isVesselScoped ? (selectedVessel?.name ?? "") : "Todos los buques"}
          />
        </div>
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
  <div className="bento-card cursor-pointer transition-transform hover:scale-[1.02]" onClick={onClick}>
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

const AiInsightBadge = ({ count, loading, onClick }: { count: number; loading: boolean; onClick: () => void }) => (
  <div className="bento-card cursor-pointer transition-transform hover:scale-[1.02] group relative overflow-hidden" onClick={onClick}>
    <div className="absolute inset-0 bg-linear-to-br from-accent/5 to-transparent pointer-events-none" />
    <div className="flex items-start justify-between mb-4">
      <div className="p-2 rounded-lg bg-accent/10 border border-accent/20">
        <Sparkles className="w-4 h-4 text-accent" />
      </div>
      {loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
    </div>
    <p className="text-xs text-text-industrial/40 font-medium mb-1">AI Insights</p>
    <div className="flex items-end justify-between">
      <p className="text-2xl font-bold tracking-tight text-accent">{loading ? "—" : count}</p>
      {!loading && count > 0 && (
        <span className="text-[9px] text-accent/60 font-bold uppercase tracking-widest group-hover:text-accent transition-colors pb-1">Ver →</span>
      )}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Droplets consumption helpers
// ---------------------------------------------------------------------------

interface ChartPoint {
  date: string;
  label: string;
  realValue: number | null;
  interpolatedValue: number | null;
}

function buildDropletsChartData(raw: { date: string; liters: number }[]): ChartPoint[] {
  const DAYS = 30;
  const today = new Date();
  const realMap = new Map(raw.map(r => [r.date, r.liters]));

  const points: ChartPoint[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("es", { day: "numeric", month: "short" });
    points.push({ date, label, realValue: realMap.get(date) ?? null, interpolatedValue: null });
  }

  // Linear interpolation between real points — only for interior gaps
  let i = 0;
  while (i < points.length) {
    if (points[i]!.realValue !== null) { i++; continue; }
    const gapStart = i;
    while (i < points.length && points[i]!.realValue === null) i++;
    const gapEnd = i;
    const leftIdx = gapStart - 1;
    const rightIdx = gapEnd;
    if (leftIdx >= 0 && rightIdx < points.length) {
      const leftVal = points[leftIdx]!.realValue!;
      const rightVal = points[rightIdx]!.realValue!;
      // Include boundary real points in the interpolated series for seamless join
      points[leftIdx]!.interpolatedValue = leftVal;
      for (let j = gapStart; j < gapEnd; j++) {
        const t = (j - leftIdx) / (rightIdx - leftIdx);
        points[j]!.interpolatedValue = Math.round(leftVal + t * (rightVal - leftVal));
      }
      points[rightIdx]!.interpolatedValue = rightVal;
    }
  }

  return points;
}

const FuelConsumptionWidget = ({
  data, loading, error, vesselName,
}: {
  data: { date: string; liters: number }[];
  loading: boolean;
  error: string | null;
  vesselName: string;
}) => {
  const chartData = React.useMemo(() => buildDropletsChartData(data), [data]);
  const hasData = data.length > 0;

  return (
    <div className="bento-card flex flex-col h-[220px]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Droplets className="w-3.5 h-3.5 text-accent" />
            Consumo de Combustible
          </h2>
          <p className="text-[10px] text-text-industrial/40">Últimos 30 días · {vesselName}</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          {!loading && hasData && (
            <div className="flex items-center gap-3 text-[10px] text-text-industrial/50">
              <span className="flex items-center gap-1">
                <span className="inline-block w-5 h-0.5 bg-[#4FC3F7] rounded" />
                Real
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-5 h-0.5 bg-[#94A3B8] rounded" style={{ borderTop: "2px dashed #94A3B8", height: 0 }} />
                Estimado
              </span>
            </div>
          )}
        </div>
      </div>

      {error ? (
        <ErrorMsg msg={error} />
      ) : !loading && !hasData ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 opacity-40">
          <Droplets className="w-6 h-6 text-text-industrial/40" />
          <p className="text-xs text-text-industrial/40">Sin reportes de combustible en los últimos 30 días</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "rgba(224,225,221,0.35)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fill: "rgba(224,225,221,0.35)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={v => `${(v as number).toLocaleString("es")}L`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "#1C2541", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px" }}
                itemStyle={{ color: "#E0E1DD" }}
                labelStyle={{ color: "rgba(224,225,221,0.5)", fontSize: 11 }}
                formatter={(value: number, name: string) => [
                  `${value.toLocaleString("es")} L`,
                  name === "realValue" ? "Real" : "Estimado",
                ]}
              />
              {/* Solid line for real data */}
              <Line
                dataKey="realValue"
                stroke="#4FC3F7"
                strokeWidth={2}
                dot={{ r: 3, fill: "#4FC3F7", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#4FC3F7" }}
                connectNulls={false}
                isAnimationActive={false}
              />
              {/* Dashed line for interpolated gaps */}
              <Line
                dataKey="interpolatedValue"
                stroke="#94A3B8"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
                activeDot={{ r: 4, fill: "#94A3B8" }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

const InsightsModal = ({ insights, loading, onClose, onNavigate, t }: {
  insights: AiInsight[];
  loading: boolean;
  onClose: () => void;
  onNavigate: () => void;
  t: (k: string) => string;
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
    <div
      className="relative z-10 w-full max-w-lg bg-primary-bg border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]"
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 text-accent">
          <Sparkles className="w-4 h-4" />
          <h2 className="text-sm font-bold">AI Insights</h2>
          <span className="ml-1 text-[10px] px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 font-bold text-accent">{insights.length}</span>
        </div>
        <button onClick={onClose} className="text-text-industrial/40 hover:text-white text-lg leading-none transition-colors">✕</button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-accent animate-spin" />
          </div>
        ) : insights.length === 0 ? (
          <p className="text-xs text-text-industrial/30 text-center py-8">{t("dashboard.noInsights")}</p>
        ) : (
          insights.map(ins => <InsightItem key={ins.id} insight={ins} />)
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-white/10 shrink-0">
        <button onClick={onNavigate}
          className="w-full py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 transition-all">
          {t("dashboard.viewAllInsights")}
        </button>
      </div>
    </div>
  </div>
);
