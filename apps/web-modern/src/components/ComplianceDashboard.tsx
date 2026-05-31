// ComplianceDashboard — panel para fleet manager.
//
// Una sección: Compliance Score por vessel (0-100) con desglose de
// componentes. Antes había también una sección "Alertas inteligentes" que
// fue removida porque duplicaba info que ya está en los tiles de "Mi día".
//
// Visible solo para roles managers (TENANT_ADMIN / FLEET_SUPERINTENDENT /
// MAINTENANCE_MANAGER). Se renderiza arriba del Dashboard.

import React, { useEffect, useState } from "react";
import { TrendingUp, Loader2, Download, ChevronDown, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { useT, type TranslationKey } from "../lib/i18n";
import { downloadAuthedFile } from "../lib/authed-media";

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
  /** false = barcaza / unidad no tripulada → drills y STCW no aplican. */
  crewedOperation: boolean;
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

const LABEL_COLOR: Record<ComplianceScore["label"], string> = {
  EXCELLENT: "text-success-sea",
  GOOD:      "text-accent",
  FAIR:      "text-yellow-400",
  POOR:      "text-red-400",
};

const LABEL_KEY: Record<ComplianceScore["label"], TranslationKey> = {
  EXCELLENT: "compliance.label.EXCELLENT",
  GOOD:      "compliance.label.GOOD",
  FAIR:      "compliance.label.FAIR",
  POOR:      "compliance.label.POOR",
};

export const ComplianceDashboard: React.FC = () => {
  const navigate = useNavigate();
  const t = useT();
  const { user } = useAuth();
  const { selectedVesselCode } = useVesselContext();
  const role = user?.role ?? "";
  const isManager = role === "TENANT_ADMIN" || role === "FLEET_SUPERINTENDENT" || role === "MAINTENANCE_MANAGER";

  const [scores, setScores] = useState<ComplianceScore[] | null>(null);
  const [loading, setLoading] = useState(true);
  // En ADMIN la sección viene colapsada y se despliega al clic en el título;
  // los demás managers la siguen viendo expandida por defecto.
  const isAdmin = role === "TENANT_ADMIN";
  const [collapsed, setCollapsed] = useState(isAdmin);

  useEffect(() => {
    if (!isManager) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const qs = selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : "";
    api.get<{ items: ComplianceScore[] }>(`/app/compliance/scores${qs}`)
      .catch(() => ({ items: [] }))
      .then(s => {
        if (cancelled) return;
        setScores(s.items);
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

      {/* Alertas inteligentes — removidas porque duplicaban info que ya está
          en los tiles de "Mi día" (Certs por vencer, Defectos abiertos, etc.).
          El fetch a /app/compliance/alerts se mantiene por si en el futuro se
          reutiliza desde otro componente. */}

      {/* Compliance Scores */}
      {!loading && scores && scores.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCollapsed(v => !v)}
              className="flex items-center gap-2 group"
              aria-expanded={!collapsed}
            >
              <TrendingUp className="w-4 h-4 text-accent" />
              <h2 className="text-xs font-bold uppercase tracking-widest text-white group-hover:text-accent transition-colors">
                {t("compliance.scoreTitle")}
              </h2>
              {collapsed
                ? <ChevronRight className="w-4 h-4 text-text-industrial/60 group-hover:text-accent transition-colors" />
                : <ChevronDown className="w-4 h-4 text-text-industrial/60 group-hover:text-accent transition-colors" />}
            </button>
            <button
              type="button"
              onClick={() => {
                const qs = selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : "";
                const dateStr = new Date().toISOString().slice(0, 10);
                const filename = selectedVesselCode
                  ? `compliance-${selectedVesselCode}-${dateStr}.pdf`
                  : `compliance-flota-${dateStr}.pdf`;
                void downloadAuthedFile(`/app/compliance/scores/pdf${qs}`, filename);
              }}
              className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-text-industrial hover:border-accent/30 hover:text-accent transition-all"
              title={t("compliance.pdfTitle")}
            >
              <Download className="w-3 h-3" />
              PDF
            </button>
          </div>
          {!collapsed && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {scores.map(s => <ScoreCard key={s.vesselCode} score={s} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

const ScoreCard: React.FC<{ score: ComplianceScore }> = ({ score }) => {
  const [open, setOpen] = useState(false);
  const t = useT();
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
          <p className={`text-[9px] uppercase tracking-wider font-bold ${LABEL_COLOR[score.label]}`}>{t(LABEL_KEY[score.label])}</p>
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
          <ComponentRow label={t("compliance.row.woCompliance")} value={score.components.woComplianceRate}  hint={t("compliance.hint.onTime").replace("{a}", String(score.totals.woCompletedOnTime)).replace("{b}", String(score.totals.woClosedTotal))} />
          {/* Drills y STCW solo aplican a buques tripulados (barcazas se omiten). */}
          {score.crewedOperation && (
            <ComponentRow label={t("compliance.row.drills")} value={score.components.drillCompliance}   hint={`${score.totals.drillsDone90d}/${score.totals.drillsExpected90d}`} />
          )}
          <ComponentRow label={t("compliance.row.certs")} value={score.components.certVigent}        hint={`${score.totals.certsActive}/${score.totals.certsTotal}`} />
          <ComponentRow label={t("compliance.row.findings")} value={score.components.noFindingsPenalty} hint={score.totals.findingsOpen > 0 ? t("compliance.hint.openCount").replace("{n}", String(score.totals.findingsOpen)) : t("compliance.hint.noFindings")} invert />
          <ComponentRow label={t("compliance.row.defects")} value={score.components.noCriticalDefects} hint={score.totals.criticalDefectsOpen > 0 ? t("compliance.hint.openCount").replace("{n}", String(score.totals.criticalDefectsOpen)) : t("compliance.hint.noCritical")} invert />
          {score.crewedOperation && (
            <ComponentRow label={t("compliance.row.stcw")} value={score.components.noRestHoursViolations} hint={score.totals.restHoursViolations30d > 0 ? t("compliance.hint.violations").replace("{n}", String(score.totals.restHoursViolations30d)) : t("compliance.hint.noViolations")} invert />
          )}
          {!score.crewedOperation && (
            <p className="text-[9px] text-text-industrial/40 italic pt-1">
              {t("compliance.notCrewed")}
            </p>
          )}
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
