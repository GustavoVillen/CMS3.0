import React from "react";
import { Loader2, Wrench, AlertTriangle, ClipboardList, Package, FileCheck, CalendarClock, CheckCircle, XCircle, Users, CalendarCheck } from "lucide-react";
import { useFetch } from "../lib/hooks";

interface WO { status: string; dueDate: string | null; }
interface Defect { status: string; }
interface Spare { currentStock: number; minStock: number; reorderPoint: number; }
interface Certificate { status: string; expiryDate: string | null; }
interface MpSummaryCounts { NEVER_EXECUTED: number; OVERDUE: number; DUE: number; IN_WINDOW: number; UPCOMING: number; FUTURE: number; }
interface DailyReport { reportDate: string; createdAt: string; status: string; }
interface CrewSummary { onboard: number; certsExpired: number; certsExpiringSoon: number; drillsScheduled: number; drillsCompletedYear: number; }

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
      className={`bg-fg/5 border ${warn ? "border-amber-500/40" : "border-fg/10"} rounded-xl p-3 text-left w-full ${onClick ? "hover:bg-fg/10 active:bg-fg/15 transition-colors" : ""}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3 h-3 ${warn ? "text-amber-400" : "text-text-industrial/40"}`} />
        <div className="text-[9px] font-bold uppercase tracking-wider text-text-industrial/50 leading-tight">{label}</div>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${warn ? "text-amber-400" : "text-fg"}`}>{value}</div>
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
  const { data: certData                          } = useFetch<{ items: Certificate[] }>("/app/certificates");
  const { data: mpSummary                         } = useFetch<{ counts: MpSummaryCounts }>("/app/dashboard/mp-summary");
  const { data: drData                            } = useFetch<{ items: DailyReport[] }>("/app/daily-reports");
  const { data: crewData                          } = useFetch<CrewSummary>("/app/dashboard/crew-summary");

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

      {/* Tripulación & Simulacros — mini chip strip */}
      {crewData && (crewData.onboard > 0 || crewData.certsExpired > 0 || crewData.certsExpiringSoon > 0 || crewData.drillsScheduled > 0) && (
        <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Users className="w-3 h-3 text-text-industrial/40" />
              <span className="text-[9px] uppercase tracking-wider text-text-industrial/50 font-bold">A bordo</span>
            </div>
            <p className="text-lg font-bold text-fg tabular-nums">{crewData.onboard}</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <AlertTriangle className={`w-3 h-3 ${crewData.certsExpired + crewData.certsExpiringSoon > 0 ? "text-orange-400" : "text-text-industrial/40"}`} />
              <span className="text-[9px] uppercase tracking-wider text-text-industrial/50 font-bold">Cert. atención</span>
            </div>
            <p className={`text-lg font-bold tabular-nums ${crewData.certsExpired + crewData.certsExpiringSoon > 0 ? "text-orange-400" : "text-fg"}`}>
              {crewData.certsExpired + crewData.certsExpiringSoon}
            </p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <CalendarCheck className="w-3 h-3 text-text-industrial/40" />
              <span className="text-[9px] uppercase tracking-wider text-text-industrial/50 font-bold">Simulacros mes</span>
            </div>
            <p className="text-lg font-bold text-fg tabular-nums">{crewData.drillsScheduled}</p>
          </div>
        </div>
      )}

      {/* Plan de mantenimiento — detalle por estado si hay foco */}
      {mpSummary && (mpCounts.OVERDUE + mpCounts.DUE + mpCounts.IN_WINDOW + mpCounts.UPCOMING > 0) && (
        <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 space-y-2">
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
      className={`w-full text-center ${onClick ? "rounded-lg hover:bg-fg/5 active:bg-fg/10 transition-colors py-1" : ""}`}
    >
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[9px] text-text-industrial/50 uppercase tracking-wider mt-0.5 leading-tight">{label}</p>
    </Wrapper>
  );
};
