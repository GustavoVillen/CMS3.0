import React from "react";
import { Loader2, Wrench, AlertTriangle, ClipboardList, Package, FileCheck, CalendarClock, CheckCircle, XCircle } from "lucide-react";
import { useFetch } from "../lib/hooks";

interface WO { status: string; dueDate: string | null; }
interface Defect { status: string; }
interface Spare { currentStock: number; minStock: number; reorderPoint: number; }
interface Certificate { status: string; expiryDate: string | null; }
interface Insight { id: string; title: string; summary: string; priority: string; }
interface MpSummaryCounts { NEVER_EXECUTED: number; OVERDUE: number; DUE: number; IN_WINDOW: number; UPCOMING: number; FUTURE: number; }
interface DailyReport { reportDate: string; createdAt: string; status: string; }

const PRIORITY_BG: Record<string, string> = {
  CRITICAL: "border-red-500/40 bg-red-500/5",
  HIGH:     "border-orange-500/40 bg-orange-500/5",
  MEDIUM:   "border-yellow-500/40 bg-yellow-500/5",
};

interface KpiProps {
  label: string;
  value: number;
  icon: React.FC<{ className?: string }>;
  warn?: boolean;
  onClick?: () => void;
}

function KpiCard({ label, value, icon: Icon, warn, onClick }: KpiProps) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`bg-white/5 border ${warn ? "border-amber-500/40" : "border-white/10"} rounded-xl p-3 text-left w-full ${onClick ? "hover:bg-white/10 active:bg-white/15 transition-colors" : ""}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3 h-3 ${warn ? "text-amber-400" : "text-text-industrial/40"}`} />
        <div className="text-[9px] font-bold uppercase tracking-wider text-text-industrial/50 leading-tight">{label}</div>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${warn ? "text-amber-400" : "text-white"}`}>{value}</div>
    </Wrapper>
  );
}

export type DashboardTab = "panel" | "planes" | "ots" | "defectos" | "diario" | "repuestos" | "copiloto";
export type DashboardPlansFilter = "due" | "upcoming" | "all";

interface NavigateOpts {
  /** Filtro inicial al ir al tab Planes (due | upcoming | all). */
  plansFilter?: DashboardPlansFilter;
}

interface Props {
  onNavigate?: (tab: DashboardTab, opts?: NavigateOpts) => void;
}

export const MobileDashboard: React.FC<Props> = ({ onNavigate }) => {
  const { data: woData,    loading: woLoading    } = useFetch<{ items: WO[]            }>("/app/pms/work-orders");
  const { data: defData,   loading: defLoading   } = useFetch<{ items: Defect[]        }>("/app/pms/defects");
  const { data: spData                            } = useFetch<{ items: Spare[]         }>("/app/pms/spares");
  const { data: aiData                            } = useFetch<{ items: Insight[]      }>("/app/ai-insights?status=OPEN");
  const { data: certData                          } = useFetch<{ items: Certificate[] }>("/app/certificates");
  const { data: mpSummary                         } = useFetch<{ counts: MpSummaryCounts }>("/app/dashboard/mp-summary");
  const { data: drData                            } = useFetch<{ items: DailyReport[] }>("/app/daily-reports");

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = new Date().toISOString().slice(0, 10);

  const openWOs    = (woData?.items  ?? []).filter(w => w.status === "PLANNED" || w.status === "IN_PROGRESS");
  const overdueWOs = openWOs.filter(w => w.dueDate && new Date(w.dueDate) < today);
  const openDefs   = (defData?.items ?? []).filter(d => d.status !== "RESOLVED" && d.status !== "CLOSED");
  const lowSpares  = (spData?.items  ?? []).filter(s => s.currentStock <= s.reorderPoint);

  // Certificados: vencidos + próximos a vencer
  const certWarn   = (certData?.items ?? []).filter(c => c.status === "EXPIRED" || c.status === "EXPIRING_SOON");

  // Planes: vencidos + por vencer (OVERDUE + DUE)
  const mpCounts   = mpSummary?.counts ?? { NEVER_EXECUTED: 0, OVERDUE: 0, DUE: 0, IN_WINDOW: 0, UPCOMING: 0, FUTURE: 0 };
  const planAlert  = mpCounts.OVERDUE + mpCounts.DUE;

  const insights   = (aiData?.items ?? []).slice(0, 5);
  const loading    = woLoading || defLoading;

  // Reporte diario de hoy
  const todayReport = (drData?.items ?? []).find(r => String(r.reportDate).slice(0, 10) === todayStr);

  return (
    <div className="p-4 space-y-4 pb-6">
      {/* KPIs — 6 cards en grid 2x3 */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <KpiCard label="OTs abiertas"   icon={Wrench}        value={openWOs.length}   onClick={() => onNavigate?.("ots")} />
          <KpiCard label="OTs vencidas"   icon={Wrench}        value={overdueWOs.length} warn={overdueWOs.length > 0} onClick={() => onNavigate?.("ots")} />
          <KpiCard label="Planes vencidos" icon={CalendarClock} value={planAlert}        warn={planAlert > 0}        onClick={() => onNavigate?.("planes", { plansFilter: "due" })} />
          <KpiCard label="Defectos"       icon={AlertTriangle} value={openDefs.length}  warn={openDefs.length > 0}  onClick={() => onNavigate?.("defectos")} />
          <KpiCard label="Bajo reorden"   icon={Package}       value={lowSpares.length} warn={lowSpares.length > 0} onClick={() => onNavigate?.("repuestos")} />
          <KpiCard label="Certif. atención" icon={FileCheck}   value={certWarn.length}  warn={certWarn.length > 0} />
        </div>
      )}

      {/* Reporte diario de hoy — status banner */}
      <button
        type="button"
        onClick={() => onNavigate?.("diario")}
        className={`w-full rounded-xl border p-3 flex items-center gap-3 text-left ${
          todayReport
            ? "border-success-sea/30 bg-success-sea/5"
            : "border-orange-500/30 bg-orange-500/5"
        }`}
      >
        {todayReport ? (
          <>
            <CheckCircle className="w-5 h-5 text-success-sea shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-success-sea">Reporte diario de hoy: {todayReport.status === "SUBMITTED" ? "Enviado" : "En borrador"}</p>
              <p className="text-[10px] text-text-industrial/40">{todayStr}</p>
            </div>
          </>
        ) : (
          <>
            <XCircle className="w-5 h-5 text-orange-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-orange-300">Falta reporte diario de hoy</p>
              <p className="text-[10px] text-text-industrial/50">Tocá para registrarlo</p>
            </div>
          </>
        )}
      </button>

      {/* Plan de mantenimiento — detalle por estado si hay foco */}
      {mpSummary && (mpCounts.OVERDUE + mpCounts.DUE + mpCounts.IN_WINDOW + mpCounts.UPCOMING > 0) && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/50">Plan de mantenimiento</p>
            <button
              type="button"
              onClick={() => onNavigate?.("planes")}
              className="text-[10px] text-accent font-bold uppercase tracking-wider"
            >
              Ver todos
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <PlanStat label="Vencidos"   value={mpCounts.OVERDUE}    color="text-red-400"    onClick={() => onNavigate?.("planes", { plansFilter: "due" })} />
            <PlanStat label="Próximos"   value={mpCounts.DUE}         color="text-orange-400" onClick={() => onNavigate?.("planes", { plansFilter: "due" })} />
            <PlanStat label="OT abierta" value={mpCounts.IN_WINDOW}   color="text-yellow-400" onClick={() => onNavigate?.("planes", { plansFilter: "all" })} />
            <PlanStat label="Por vencer" value={mpCounts.UPCOMING}    color="text-blue-400"   onClick={() => onNavigate?.("planes", { plansFilter: "upcoming" })} />
          </div>
        </div>
      )}

      {/* Alertas IA */}
      {insights.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/50">Alertas IA</p>
          {insights.map(ins => (
            <div
              key={ins.id}
              className={`rounded-xl border p-3 ${PRIORITY_BG[ins.priority] ?? "border-white/10 bg-white/5"}`}
            >
              <p className="text-xs font-bold text-white leading-snug">{ins.title}</p>
              <p className="text-xs text-text-industrial/50 mt-0.5 line-clamp-2">{ins.summary}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const PlanStat: React.FC<{
  label: string;
  value: number;
  color: string;
  onClick?: () => void;
}> = ({ label, value, color, onClick }) => {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`w-full text-center ${onClick ? "rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors py-1" : ""}`}
    >
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[9px] text-text-industrial/50 uppercase tracking-wider mt-0.5 leading-tight">{label}</p>
    </Wrapper>
  );
};
