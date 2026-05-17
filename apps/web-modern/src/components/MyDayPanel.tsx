// "Mi día" — panel personal de tareas para tripulación / capitán.
// Aparece arriba del Dashboard de flota. Muestra solo lo relevante para el
// rol y el vessel del usuario.
//
// - TECHNICIAN_OPERATOR / INSPECTOR_COMPLIANCE / PROCUREMENT_STORE:
//   "Mis tareas hoy" — OTs asignadas, drills próximos, near miss recientes,
//   certs venciendo del crew del vessel.
// - MAINTENANCE_MANAGER / FLEET_SUPERINTENDENT con vessel seleccionado:
//   vista del vessel — OTs críticas, certs, restHours violaciones, findings.
// - TENANT_ADMIN / FLEET_SUPERINTENDENT sin vessel:
//   no se muestra (la vista de flota del Dashboard ya cubre).

import React, { useMemo } from "react";
import { Wrench, CalendarCheck, AlertOctagon, FileCheck, AlertTriangle, ChevronRight, Clock, FileText, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { fmtDate, parseLocalDate } from "../lib/utils";

interface WorkOrder { id: string; workOrderCode: string; status: string; criticality?: string; dueDate?: string; assignedToUserId?: string | null; assignedToUserName?: string | null; vesselCode: string; title?: string | null; assetName?: string | null }
interface Drill { id: string; drillCode: string; vesselCode: string; type: string; status: string; scheduledDate: string }
interface NearMiss { id: string; nearMissCode: string; vesselCode: string; category: string; severity: string; status: string; occurredAt: string; description: string }
interface Certificate { id: string; certificateCode: string; vesselCode: string; name: string; status: string; expiryDate: string | null }
interface RestHoursRow { id: string; crewId: string; vesselCode: string; hasViolation: boolean; recordDate: string }
interface ExternalAuditFinding { id: string; status: string }
interface ExternalAudit { id: string; vesselCode: string; findingsOpen?: number }
interface DailyReportRow { id: string; reportDate: string; createdAt?: string }
interface DefectRow { id: string; status: string }
interface AiInsightRow { id: string; status: string }

const DRILL_TYPE_LABEL: Record<string, string> = {
  FIRE: "Incendio", ABANDON_SHIP: "Abandono", ENCLOSED_SPACE: "Esp. confinado",
  MAN_OVERBOARD: "Hombre al agua", POLLUTION: "Contaminación", OIL_SPILL: "Derrame",
  SECURITY: "Seguridad (ISPS)", MEDICAL: "Médico", STEERING_GEAR: "Gobierno emerg.",
  BLACKOUT: "Blackout", OTHER: "Otro",
};

const CATEGORY_LABEL: Record<string, string> = {
  NEAR_MISS: "Near miss", HAZARD_OBSERVATION: "Riesgo", UNSAFE_ACT: "Acción insegura", UNSAFE_CONDITION: "Condición insegura",
};

const SEVERITY_COLOR: Record<string, string> = {
  LOW: "text-blue-400", MEDIUM: "text-yellow-400", HIGH: "text-orange-400", CRITICAL: "text-red-400",
};

interface MyDayPanelProps {
  /** Abre el modal de AI Insights del Dashboard (vive en Dashboard para
   * mantener el state ahí). Si no se pasa, el tile navega a /ai-insights. */
  onShowInsights?: () => void;
}

export const MyDayPanel: React.FC<MyDayPanelProps> = ({ onShowInsights }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedVesselCode, selectedVessel } = useVesselContext();

  const role = user?.role ?? "";
  const isOperational = role === "TECHNICIAN_OPERATOR" || role === "INSPECTOR_COMPLIANCE" || role === "PROCUREMENT_STORE";
  const isManager = role === "MAINTENANCE_MANAGER" || role === "FLEET_SUPERINTENDENT" || role === "TENANT_ADMIN";

  // El panel se muestra para todos los operativos siempre, y para managers solo
  // cuando tienen un vessel seleccionado (su contexto es "este buque").
  const showPanel = isOperational || (isManager && !!selectedVesselCode);
  if (!showPanel) return null;

  const vesselQS = selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : "";

  return (
    <section className="bg-gradient-to-br from-accent/[0.08] via-white/[0.02] to-transparent border border-accent/20 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-accent font-bold">Mi día</p>
          <h2 className="text-base font-bold text-white">
            {isOperational ? "Mis tareas" : "Vista del buque"}
            {selectedVessel?.name && <span className="text-text-industrial/60 font-normal ml-2 text-sm">— {selectedVessel.name}</span>}
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-3">
        {isOperational ? (
          <>
            <MyWorkOrdersTile />
            <UpcomingDrillsTile vesselQS={vesselQS} />
            <RecentNearMissTile vesselQS={vesselQS} />
            <ExpiringCertsTile vesselQS={vesselQS} />
          </>
        ) : (
          <>
            <CriticalWoTile vesselQS={vesselQS} />
            <ExpiringCertsTile vesselQS={vesselQS} />
            <RestHoursViolationsTile vesselQS={vesselQS} />
            <OpenFindingsTile vesselCode={selectedVesselCode} />
          </>
        )}
        {/* Tiles compartidos por todos los roles — antes eran cards
         * sueltas debajo del MyDayPanel; consolidados acá. */}
        <DailyReportTile vesselQS={vesselQS} />
        <OpenDefectsTile vesselQS={vesselQS} />
        <AiInsightsTile vesselQS={vesselQS} onShow={onShowInsights} />
      </div>
    </section>
  );
};

// ─── Tiles (operacional) ─────────────────────────────────────────────────────

const TileShell: React.FC<{ icon: React.FC<{ className?: string }>; label: string; count: number | string; loading?: boolean; emptyText?: string; accent?: string; onClick: () => void; children?: React.ReactNode }> = ({ icon: Icon, label, count, loading, emptyText, accent, onClick, children }) => (
  <button onClick={onClick} className="text-left bg-white/[0.04] border border-white/10 rounded-xl p-3 hover:border-accent/40 hover:bg-white/[0.07] transition-all group">
    <div className="flex items-start justify-between gap-2 mb-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className={`w-4 h-4 ${accent ?? "text-accent"} shrink-0`} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-industrial/60 truncate">{label}</span>
      </div>
      <span className={`text-lg font-bold ${accent ?? "text-white"} shrink-0`}>{loading ? "·" : count}</span>
    </div>
    {children ?? (typeof count === "number" && count === 0 && emptyText
      ? <p className="text-[10px] text-text-industrial/40 italic">{emptyText}</p>
      : null)}
    <ChevronRight className="w-3.5 h-3.5 text-text-industrial/30 group-hover:text-accent ml-auto mt-1 transition-colors" />
  </button>
);

const MyWorkOrdersTile: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, loading } = useFetch<{ items: WorkOrder[] }>("/app/pms/work-orders");
  // Filtramos client-side por assignedToUserId/Name == user actual.
  const mine = useMemo(() => {
    if (!user) return [];
    const myId = user.id;
    const myEmail = user.email;
    return (data?.items ?? []).filter(w => {
      const open = w.status === "PLANNED" || w.status === "IN_PROGRESS";
      if (!open) return false;
      const a = w.assignedToUserId ?? "";
      const n = w.assignedToUserName ?? "";
      return a === myId || a === myEmail || (n && (n === myEmail || (user.firstName && n.toLowerCase().includes(user.firstName.toLowerCase()))));
    });
  }, [data, user]);

  return (
    <TileShell icon={Wrench} label="Mis OTs abiertas" count={mine.length} loading={loading} onClick={() => navigate("/work-orders")}>
      {mine.length > 0 && (
        <ul className="space-y-0.5 mt-1">
          {mine.slice(0, 3).map(w => (
            <li key={w.id} className="text-[10px] text-text-industrial/70 truncate">
              <span className="font-mono text-accent/80">{w.workOrderCode}</span> · {w.assetName ?? w.title ?? "—"}
              {w.dueDate && <span className="text-text-industrial/40 ml-1">({fmtDate(w.dueDate)})</span>}
            </li>
          ))}
          {mine.length > 3 && <li className="text-[10px] text-text-industrial/40 italic">+{mine.length - 3} más…</li>}
        </ul>
      )}
      {mine.length === 0 && !loading && <p className="text-[10px] text-text-industrial/40 italic">Sin OTs asignadas.</p>}
    </TileShell>
  );
};

const UpcomingDrillsTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const { data, loading } = useFetch<{ items: Drill[] }>(`/app/drills${vesselQS}`);
  const now = new Date();
  const upcoming = useMemo(() => {
    const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return (data?.items ?? [])
      .filter(d => d.status === "SCHEDULED")
      .filter(d => {
        const sd = parseLocalDate(d.scheduledDate);
        return sd >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && sd <= horizon;
      })
      .sort((a, b) => parseLocalDate(a.scheduledDate).getTime() - parseLocalDate(b.scheduledDate).getTime());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <TileShell icon={CalendarCheck} label="Drills próximos (30d)" count={upcoming.length} loading={loading} onClick={() => navigate("/drills")}>
      {upcoming.length > 0 && (
        <ul className="space-y-0.5 mt-1">
          {upcoming.slice(0, 3).map(d => (
            <li key={d.id} className="text-[10px] text-text-industrial/70 truncate">
              <span className="text-accent/80">{DRILL_TYPE_LABEL[d.type] ?? d.type}</span> · {fmtDate(d.scheduledDate)}
            </li>
          ))}
        </ul>
      )}
      {upcoming.length === 0 && !loading && <p className="text-[10px] text-text-industrial/40 italic">Sin drills programados.</p>}
    </TileShell>
  );
};

const RecentNearMissTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const { data, loading } = useFetch<{ items: NearMiss[] }>(`/app/near-miss${vesselQS}`);
  const recent = useMemo(() => {
    const horizon = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    return (data?.items ?? [])
      .filter(n => new Date(n.occurredAt) >= horizon)
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }, [data]);

  return (
    <TileShell icon={AlertOctagon} label="Near miss (14d)" count={recent.length} loading={loading} accent="text-yellow-400" onClick={() => navigate("/near-miss")}>
      {recent.length > 0 && (
        <ul className="space-y-0.5 mt-1">
          {recent.slice(0, 3).map(n => (
            <li key={n.id} className="text-[10px] text-text-industrial/70 truncate">
              <span className={SEVERITY_COLOR[n.severity] ?? "text-text-industrial/70"}>●</span>{" "}
              {CATEGORY_LABEL[n.category]} — {n.description}
            </li>
          ))}
        </ul>
      )}
      {recent.length === 0 && !loading && <p className="text-[10px] text-text-industrial/40 italic">Sin reportes recientes.</p>}
    </TileShell>
  );
};

// ─── Tiles compartidos / vista vessel ────────────────────────────────────────

const ExpiringCertsTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const { data, loading } = useFetch<{ items: Certificate[] }>(`/app/certificates${vesselQS}`);
  const items = data?.items ?? [];
  const expired = items.filter(c => c.status === "EXPIRED").length;
  const soon    = items.filter(c => c.status === "EXPIRING_SOON").length;
  const count = expired + soon;

  return (
    <TileShell icon={FileCheck} label="Certs por vencer (60d)" count={count} loading={loading} accent={expired > 0 ? "text-red-400" : "text-orange-400"} onClick={() => navigate("/certificates")}>
      {count > 0 && (
        <p className="text-[10px] text-text-industrial/70">
          {expired > 0 && <span className="text-red-400 font-bold">{expired} vencidos</span>}
          {expired > 0 && soon > 0 && <span className="text-text-industrial/40"> · </span>}
          {soon > 0 && <span className="text-orange-400">{soon} próximos</span>}
        </p>
      )}
      {count === 0 && !loading && <p className="text-[10px] text-text-industrial/40 italic">Todos vigentes.</p>}
    </TileShell>
  );
};

const CriticalWoTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const { data, loading } = useFetch<{ items: WorkOrder[] }>(`/app/pms/work-orders${vesselQS}`);
  const today = new Date();
  const critical = useMemo(() => {
    return (data?.items ?? []).filter(w => {
      const open = w.status === "PLANNED" || w.status === "IN_PROGRESS";
      if (!open) return false;
      const overdue = w.dueDate && parseLocalDate(w.dueDate) < today;
      return overdue || w.criticality === "A";
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <TileShell icon={Wrench} label="OTs críticas/vencidas" count={critical.length} loading={loading} accent={critical.length > 0 ? "text-red-400" : "text-white"} onClick={() => navigate("/work-orders?view=overdue")}>
      {critical.length > 0 && (
        <ul className="space-y-0.5 mt-1">
          {critical.slice(0, 3).map(w => (
            <li key={w.id} className="text-[10px] text-text-industrial/70 truncate">
              <span className="font-mono text-red-400/80">{w.workOrderCode}</span> — {w.assetName ?? w.title ?? "—"}
            </li>
          ))}
          {critical.length > 3 && <li className="text-[10px] text-text-industrial/40 italic">+{critical.length - 3} más…</li>}
        </ul>
      )}
      {critical.length === 0 && !loading && <p className="text-[10px] text-text-industrial/40 italic">Todo al día.</p>}
    </TileShell>
  );
};

const RestHoursViolationsTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  // Trae solo los días con violación
  const path = vesselQS
    ? `/app/rest-hours${vesselQS}&onlyViolations=true`
    : `/app/rest-hours?onlyViolations=true`;
  const { data, loading } = useFetch<{ items: RestHoursRow[] }>(path);
  const count = data?.items?.length ?? 0;

  return (
    <TileShell icon={Clock} label="Violaciones horas descanso" count={count} loading={loading} accent={count > 0 ? "text-red-400" : "text-success-sea"} onClick={() => navigate("/rest-hours")}>
      {count === 0 && !loading && <p className="text-[10px] text-text-industrial/40 italic">Sin violaciones STCW.</p>}
      {count > 0 && <p className="text-[10px] text-red-300">Revisar planilla mensual.</p>}
    </TileShell>
  );
};

const OpenFindingsTile: React.FC<{ vesselCode: string | null }> = ({ vesselCode }) => {
  const navigate = useNavigate();
  const qs = vesselCode ? `?vesselCode=${encodeURIComponent(vesselCode)}` : "";
  const { data, loading } = useFetch<{ items: ExternalAudit[] }>(`/app/external-audits${qs}`);
  const openCount = (data?.items ?? []).reduce((s, a) => s + (a.findingsOpen ?? 0), 0);

  return (
    <TileShell icon={AlertTriangle} label="Findings PSC abiertos" count={openCount} loading={loading} accent={openCount > 0 ? "text-yellow-400" : "text-success-sea"} onClick={() => navigate("/external-audits?filter=open")}>
      {openCount === 0 && !loading && <p className="text-[10px] text-text-industrial/40 italic">Sin findings abiertos.</p>}
    </TileShell>
  );
};

// ─── Tiles unificados (antes vivían como cards sueltas en Dashboard) ──────

const DailyReportTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const { data, loading } = useFetch<{ items: DailyReportRow[] }>(`/app/daily-reports${vesselQS}`);
  const items = data?.items ?? [];
  const todayStr = new Date().toISOString().slice(0, 10);
  const hasToday = items.some(r => String(r.reportDate).slice(0, 10) === todayStr);

  return (
    <TileShell
      icon={FileText}
      label="Reporte diario"
      count={hasToday ? "✓" : "—"}
      loading={loading}
      accent={hasToday ? "text-success-sea" : "text-red-400"}
      onClick={() => navigate("/daily-reports")}
    >
      {!loading && (
        <p className={`text-[10px] ${hasToday ? "text-text-industrial/60" : "text-red-400 font-bold"}`}>
          {hasToday ? "Cargado hoy" : "Sin reporte hoy"}
        </p>
      )}
    </TileShell>
  );
};

const OpenDefectsTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const { data, loading } = useFetch<{ items: DefectRow[] }>(`/app/pms/defects${vesselQS}`);
  const open = (data?.items ?? []).filter(d => d.status === "OPEN" || d.status === "IN_PROGRESS").length;

  return (
    <TileShell
      icon={AlertTriangle}
      label="Defectos abiertos"
      count={open}
      loading={loading}
      accent={open > 0 ? "text-orange-400" : "text-success-sea"}
      onClick={() => navigate("/defects")}
    >
      {!loading && open === 0 && <p className="text-[10px] text-text-industrial/40 italic">Sin defectos abiertos.</p>}
    </TileShell>
  );
};

const AiInsightsTile: React.FC<{ vesselQS: string; onShow?: () => void }> = ({ vesselQS, onShow }) => {
  const navigate = useNavigate();
  const { data, loading } = useFetch<{ items?: AiInsightRow[]; total?: number }>(`/app/ai-insights${vesselQS}`);
  const total = data?.total ?? data?.items?.length ?? 0;

  return (
    <TileShell
      icon={Sparkles}
      label="AI Insights"
      count={total}
      loading={loading}
      accent={total > 0 ? "text-accent" : "text-text-industrial/60"}
      onClick={() => (onShow ? onShow() : navigate("/ai-insights"))}
    >
      {!loading && total === 0 && <p className="text-[10px] text-text-industrial/40 italic">Sin insights nuevos.</p>}
      {!loading && total > 0  && <p className="text-[10px] text-accent">Tocá para revisar.</p>}
    </TileShell>
  );
};
