// ComplianceDashboard — panel para fleet manager.
//
// Dos secciones:
//   1. Compliance Score por vessel (0-100) con desglose de componentes.
//   2. Smart Alerts priorizadas (CRITICAL → WARNING → INFO).
//
// Visible solo para roles managers (TENANT_ADMIN / FLEET_SUPERINTENDENT /
// MAINTENANCE_MANAGER). Se renderiza arriba del Dashboard.

import React, { useEffect, useState } from "react";
import { TrendingUp, AlertTriangle, AlertOctagon, Info, ChevronRight, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";

interface ComplianceComponents {
  woComplianceRate: number;
  drillCompliance: number;
  certVigent: number;
  noFindingsPenalty: number;
  noCriticalDefects: number;
  noRestHoursViolations: number;
}

interface ComplianceScore {
  vesselCode: string;
  vesselName: string;
  score: number;
  label: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  components: ComplianceComponents;
  totals: {
    woCompletedOnTime: number;
    woClosedTotal: number;
    drillsDone90d: number;
    drillsExpected90d: number;
    certsActive: number;
    certsTotal: number;
    findingsOpen: number;
    criticalDefectsOpen: number;
    restHoursViolations30d: number;
  };
}

interface SmartAlert {
  id: string;
  vesselCode: string | null;
  vesselName: string | null;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  summary: string;
  link: string | null;
}

const LABEL_COLOR: Record<ComplianceScore["label"], string> = {
  EXCELLENT: "text-success-sea",
  GOOD:      "text-accent",
  FAIR:      "text-yellow-400",
  POOR:      "text-red-400",
};

const LABEL_TEXT: Record<ComplianceScore["label"], string> = {
  EXCELLENT: "Excelente",
  GOOD:      "Bueno",
  FAIR:      "Regular",
  POOR:      "Pobre",
};

const SEVERITY_ICON: Record<SmartAlert["severity"], React.FC<{ className?: string }>> = {
  CRITICAL: AlertOctagon,
  WARNING:  AlertTriangle,
  INFO:     Info,
};

const SEVERITY_COLOR: Record<SmartAlert["severity"], string> = {
  CRITICAL: "border-red-500/40 bg-red-500/[0.06] text-red-300",
  WARNING:  "border-yellow-500/40 bg-yellow-500/[0.06] text-yellow-300",
  INFO:     "border-accent/30 bg-accent/[0.05] text-accent",
};

export const ComplianceDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedVesselCode } = useVesselContext();
  const role = user?.role ?? "";
  const isManager = role === "TENANT_ADMIN" || role === "FLEET_SUPERINTENDENT" || role === "MAINTENANCE_MANAGER";

  const [scores, setScores] = useState<ComplianceScore[] | null>(null);
  const [alerts, setAlerts] = useState<SmartAlert[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isManager) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const qs = selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : "";
    Promise.all([
      api.get<{ items: ComplianceScore[] }>(`/app/compliance/scores${qs}`).catch(() => ({ items: [] })),
      api.get<{ items: SmartAlert[] }>(`/app/compliance/alerts${qs}`).catch(() => ({ items: [] })),
    ]).then(([s, a]) => {
      if (cancelled) return;
      setScores(s.items);
      setAlerts(a.items);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [isManager, selectedVesselCode]);

  if (!isManager) return null;

  return (
    <section className="space-y-4">
      {loading && (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      )}

      {/* Smart Alerts */}
      {!loading && alerts && alerts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-red-400" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-white">
              Alertas inteligentes <span className="text-text-industrial/40 font-normal normal-case ml-1">({alerts.length})</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {alerts.slice(0, 6).map(a => {
              const Icon = SEVERITY_ICON[a.severity];
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => a.link && navigate(a.link)}
                  className={`text-left p-3 rounded-xl border ${SEVERITY_COLOR[a.severity]} hover:brightness-125 transition-all flex items-start gap-2.5`}
                >
                  <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white line-clamp-1">{a.title}</p>
                    <p className="text-[10px] text-text-industrial/70 line-clamp-2 mt-0.5">{a.summary}</p>
                  </div>
                  {a.link && <ChevronRight className="w-3.5 h-3.5 shrink-0 mt-1 opacity-50" />}
                </button>
              );
            })}
          </div>
          {alerts.length > 6 && (
            <p className="text-[10px] text-text-industrial/40 italic">+{alerts.length - 6} alertas adicionales</p>
          )}
        </div>
      )}

      {/* Compliance Scores */}
      {!loading && scores && scores.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accent" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-white">
              Compliance score por buque
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {scores.map(s => <ScoreCard key={s.vesselCode} score={s} />)}
          </div>
        </div>
      )}
    </section>
  );
};

const ScoreCard: React.FC<{ score: ComplianceScore }> = ({ score }) => {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen(v => !v)}
      className="text-left bg-white/[0.04] border border-white/10 rounded-xl p-3 hover:border-accent/40 hover:bg-white/[0.07] transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-text-industrial/50 truncate">{score.vesselCode}</p>
          <p className="text-xs font-bold text-white truncate">{score.vesselName}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-2xl font-bold leading-none ${LABEL_COLOR[score.label]}`}>{score.score}</p>
          <p className={`text-[9px] uppercase tracking-wider font-bold ${LABEL_COLOR[score.label]}`}>{LABEL_TEXT[score.label]}</p>
        </div>
      </div>

      {/* Mini bar */}
      <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full ${
            score.label === "EXCELLENT" ? "bg-success-sea" :
            score.label === "GOOD"      ? "bg-accent" :
            score.label === "FAIR"      ? "bg-yellow-400" :
            "bg-red-400"
          }`}
          style={{ width: `${score.score}%` }}
        />
      </div>

      {open && (
        <div className="mt-2.5 space-y-1 pt-2 border-t border-white/5">
          <ComponentRow label="OT compliance"    value={score.components.woComplianceRate}  hint={`${score.totals.woCompletedOnTime}/${score.totals.woClosedTotal} en plazo`} />
          <ComponentRow label="Drills (90d)"     value={score.components.drillCompliance}   hint={`${score.totals.drillsDone90d}/${score.totals.drillsExpected90d}`} />
          <ComponentRow label="Certs vigentes"   value={score.components.certVigent}        hint={`${score.totals.certsActive}/${score.totals.certsTotal}`} />
          <ComponentRow label="Findings PSC"     value={score.components.noFindingsPenalty} hint={score.totals.findingsOpen > 0 ? `${score.totals.findingsOpen} abiertos` : "Sin findings"} invert />
          <ComponentRow label="Def. críticos"    value={score.components.noCriticalDefects} hint={score.totals.criticalDefectsOpen > 0 ? `${score.totals.criticalDefectsOpen} abiertos` : "Sin críticos"} invert />
          <ComponentRow label="STCW (30d)"       value={score.components.noRestHoursViolations} hint={score.totals.restHoursViolations30d > 0 ? `${score.totals.restHoursViolations30d} violaciones` : "Sin violaciones"} invert />
        </div>
      )}
    </button>
  );
};

const ComponentRow: React.FC<{ label: string; value: number; hint: string; invert?: boolean }> = ({ label, value, hint, invert }) => {
  // value 0..1 — verde si bueno, rojo si malo
  // invert: si es una penalización (1 = ok, 0 = malo), el color se basa igual
  // en value, así que no necesita cambio acá. invert prop documenta intención.
  void invert;
  const pct = Math.round(value * 100);
  const colorCls =
    value >= 0.85 ? "text-success-sea" :
    value >= 0.6  ? "text-accent" :
    value >= 0.4  ? "text-yellow-400" :
    "text-red-400";
  return (
    <div className="flex items-center justify-between gap-2 text-[10px]">
      <span className="text-text-industrial/70 truncate">{label}</span>
      <span className="text-text-industrial/40 truncate ml-auto">{hint}</span>
      <span className={`font-bold ${colorCls} w-9 text-right shrink-0`}>{pct}%</span>
    </div>
  );
};
