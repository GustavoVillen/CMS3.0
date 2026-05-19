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
import { useT, type TranslationKey } from "../lib/i18n";
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

const DRILL_TYPE_KEY: Record<string, TranslationKey> = {
  FIRE: "drill.type.FIRE", ABANDON_SHIP: "drill.type.ABANDON_SHIP", ENCLOSED_SPACE: "drill.type.ENCLOSED_SPACE",
  MAN_OVERBOARD: "drill.type.MAN_OVERBOARD", POLLUTION: "drill.type.POLLUTION", OIL_SPILL: "drill.type.OIL_SPILL",
  SECURITY: "drill.type.SECURITY", MEDICAL: "drill.type.MEDICAL", STEERING_GEAR: "drill.type.STEERING_GEAR",
  BLACKOUT: "drill.type.BLACKOUT", OTHER: "drill.type.OTHER",
};

const NEAR_MISS_CAT_KEY: Record<string, TranslationKey> = {
  NEAR_MISS: "nearMiss.cat.NEAR_MISS", HAZARD_OBSERVATION: "nearMiss.cat.HAZARD_OBSERVATION",
  UNSAFE_ACT: "nearMiss.cat.UNSAFE_ACT", UNSAFE_CONDITION: "nearMiss.cat.UNSAFE_CONDITION",
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
  const t = useT();
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
          <p className="text-[10px] uppercase tracking-widest text-accent font-bold">{t("myday.label")}</p>
          <h2 className="text-base font-bold text-white">
            {isOperational ? t("myday.myTasks") : t("myday.vesselView")}
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
  const t = useT();
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

  // "Si no hay tareas pendientes, no colocarlas aquí" — oculta el tile cuando
  // termina de cargar y no hay nada. Mientras carga sí lo muestra (placeholder).
  if (!loading && mine.length === 0) return null;

  return (
    <TileShell icon={Wrench} label={t("myday.myOpenWo")} count={mine.length} loading={loading} onClick={() => navigate("/work-orders")}>
      {mine.length > 0 && (
        <ul className="space-y-0.5 mt-1">
          {mine.slice(0, 3).map(w => (
            <li key={w.id} className="text-[10px] text-text-industrial/70 truncate">
              <span className="font-mono text-accent/80">{w.workOrderCode}</span> · {w.assetName ?? w.title ?? "—"}
              {w.dueDate && <span className="text-text-industrial/40 ml-1">({fmtDate(w.dueDate)})</span>}
            </li>
          ))}
          {mine.length > 3 && <li className="text-[10px] text-text-industrial/40 italic">{t("myday.moreItems").replace("{n}", String(mine.length - 3))}</li>}
        </ul>
      )}
    </TileShell>
  );
};

const UpcomingDrillsTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const t = useT();
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

  if (!loading && upcoming.length === 0) return null;

  return (
    <TileShell icon={CalendarCheck} label={t("myday.upcomingDrills")} count={upcoming.length} loading={loading} onClick={() => navigate("/drills")}>
      {upcoming.length > 0 && (
        <ul className="space-y-0.5 mt-1">
          {upcoming.slice(0, 3).map(d => (
            <li key={d.id} className="text-[10px] text-text-industrial/70 truncate">
              <span className="text-accent/80">{DRILL_TYPE_KEY[d.type] ? t(DRILL_TYPE_KEY[d.type]) : d.type}</span> · {fmtDate(d.scheduledDate)}
            </li>
          ))}
        </ul>
      )}
    </TileShell>
  );
};

const RecentNearMissTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const t = useT();
  const { data, loading } = useFetch<{ items: NearMiss[] }>(`/app/near-miss${vesselQS}`);
  const recent = useMemo(() => {
    const horizon = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    return (data?.items ?? [])
      .filter(n => new Date(n.occurredAt) >= horizon)
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }, [data]);

  if (!loading && recent.length === 0) return null;

  return (
    <TileShell icon={AlertOctagon} label={t("myday.recentNearMiss")} count={recent.length} loading={loading} accent="text-yellow-400" onClick={() => navigate("/near-miss")}>
      {recent.length > 0 && (
        <ul className="space-y-0.5 mt-1">
          {recent.slice(0, 3).map(n => (
            <li key={n.id} className="text-[10px] text-text-industrial/70 truncate">
              <span className={SEVERITY_COLOR[n.severity] ?? "text-text-industrial/70"}>●</span>{" "}
              {NEAR_MISS_CAT_KEY[n.category] ? t(NEAR_MISS_CAT_KEY[n.category]) : n.category} — {n.description}
            </li>
          ))}
        </ul>
      )}
    </TileShell>
  );
};

// ─── Tiles compartidos / vista vessel ────────────────────────────────────────

const ExpiringCertsTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const t = useT();
  const { data, loading } = useFetch<{ items: Certificate[] }>(`/app/certificates${vesselQS}`);
  const items = data?.items ?? [];
  const expired = items.filter(c => c.status === "EXPIRED").length;
  const soon    = items.filter(c => c.status === "EXPIRING_SOON").length;
  const count = expired + soon;

  if (!loading && count === 0) return null;

  return (
    <TileShell icon={FileCheck} label={t("myday.expiringCerts")} count={count} loading={loading} accent={expired > 0 ? "text-red-400" : "text-orange-400"} onClick={() => navigate("/certificates")}>
      {count > 0 && (
        <p className="text-[10px] text-text-industrial/70">
          {expired > 0 && <span className="text-red-400 font-bold">{t("myday.expiredCount").replace("{n}", String(expired))}</span>}
          {expired > 0 && soon > 0 && <span className="text-text-industrial/40"> · </span>}
          {soon > 0 && <span className="text-orange-400">{t("myday.expiringSoonCount").replace("{n}", String(soon))}</span>}
        </p>
      )}
    </TileShell>
  );
};

const CriticalWoTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const t = useT();
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

  if (!loading && critical.length === 0) return null;

  return (
    <TileShell icon={Wrench} label={t("myday.criticalWo")} count={critical.length} loading={loading} accent="text-red-400" onClick={() => navigate("/work-orders?view=overdue")}>
      {critical.length > 0 && (
        <ul className="space-y-0.5 mt-1">
          {critical.slice(0, 3).map(w => (
            <li key={w.id} className="text-[10px] text-text-industrial/70 truncate">
              <span className="font-mono text-red-400/80">{w.workOrderCode}</span> — {w.assetName ?? w.title ?? "—"}
            </li>
          ))}
          {critical.length > 3 && <li className="text-[10px] text-text-industrial/40 italic">{t("myday.moreItems").replace("{n}", String(critical.length - 3))}</li>}
        </ul>
      )}
    </TileShell>
  );
};

const RestHoursViolationsTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const t = useT();
  // Trae solo los días con violación
  const path = vesselQS
    ? `/app/rest-hours${vesselQS}&onlyViolations=true`
    : `/app/rest-hours?onlyViolations=true`;
  const { data, loading } = useFetch<{ items: RestHoursRow[] }>(path);
  const count = data?.items?.length ?? 0;

  if (!loading && count === 0) return null;

  return (
    <TileShell icon={Clock} label={t("myday.restHoursViolations")} count={count} loading={loading} accent="text-red-400" onClick={() => navigate("/rest-hours")}>
      {count > 0 && <p className="text-[10px] text-red-300">{t("myday.restHoursReview")}</p>}
    </TileShell>
  );
};

const OpenFindingsTile: React.FC<{ vesselCode: string | null }> = ({ vesselCode }) => {
  const navigate = useNavigate();
  const t = useT();
  const qs = vesselCode ? `?vesselCode=${encodeURIComponent(vesselCode)}` : "";
  const { data, loading } = useFetch<{ items: ExternalAudit[] }>(`/app/external-audits${qs}`);
  const openCount = (data?.items ?? []).reduce((s, a) => s + (a.findingsOpen ?? 0), 0);

  if (!loading && openCount === 0) return null;

  return (
    <TileShell icon={AlertTriangle} label={t("myday.openFindings")} count={openCount} loading={loading} accent="text-yellow-400" onClick={() => navigate("/external-audits?filter=open")}>
    </TileShell>
  );
};

// ─── Tiles unificados (antes vivían como cards sueltas en Dashboard) ──────

const DailyReportTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const t = useT();
  const { data, loading } = useFetch<{ items: DailyReportRow[] }>(`/app/daily-reports${vesselQS}`);
  const items = data?.items ?? [];
  const todayStr = new Date().toISOString().slice(0, 10);
  const hasToday = items.some(r => String(r.reportDate).slice(0, 10) === todayStr);

  // Caso inverso al resto: "tareas pendientes" = falta cargar reporte hoy.
  // Cuando YA está cargado, no es pendiente → ocultar el tile.
  if (!loading && hasToday) return null;

  return (
    <TileShell
      icon={FileText}
      label={t("myday.dailyReport")}
      count="—"
      loading={loading}
      accent="text-red-400"
      onClick={() => navigate("/daily-reports")}
    >
      {!loading && <p className="text-[10px] text-red-400 font-bold">{t("dashboard.noReportToday")}</p>}
    </TileShell>
  );
};

const OpenDefectsTile: React.FC<{ vesselQS: string }> = ({ vesselQS }) => {
  const navigate = useNavigate();
  const t = useT();
  const { data, loading } = useFetch<{ items: DefectRow[] }>(`/app/pms/defects${vesselQS}`);
  const open = (data?.items ?? []).filter(d => d.status === "OPEN" || d.status === "IN_PROGRESS").length;

  if (!loading && open === 0) return null;

  return (
    <TileShell
      icon={AlertTriangle}
      label={t("myday.openDefects")}
      count={open}
      loading={loading}
      accent="text-orange-400"
      onClick={() => navigate("/defects")}
    >
    </TileShell>
  );
};

const AiInsightsTile: React.FC<{ vesselQS: string; onShow?: () => void }> = ({ vesselQS, onShow }) => {
  const navigate = useNavigate();
  const t = useT();
  const { data, loading } = useFetch<{ items?: AiInsightRow[]; total?: number }>(`/app/ai-insights${vesselQS}`);
  const total = data?.total ?? data?.items?.length ?? 0;

  if (!loading && total === 0) return null;

  return (
    <TileShell
      icon={Sparkles}
      label={t("myday.aiInsights")}
      count={total}
      loading={loading}
      accent="text-accent"
      onClick={() => (onShow ? onShow() : navigate("/ai-insights"))}
    >
      {!loading && total > 0 && <p className="text-[10px] text-accent">{t("myday.aiInsightsTap")}</p>}
    </TileShell>
  );
};
