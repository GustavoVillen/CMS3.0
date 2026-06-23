// Matriz de análisis de riesgo reutilizable (probabilidad × consecuencia).
// Usada por el Plan de Mantenimiento y por los Diferimientos para garantizar
// paridad visual. Presentacional: el estado lo maneja el padre.

import { Fragment } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useT } from "../lib/i18n";
import { RichTextArea } from "./RichTextArea";
import {
  RISK_PROBS, RISK_CONS, RISK_GRID, RISK_CELL_BG, deriveRiskLevelFromMatrix,
  type RiskProbability, type RiskConsequence, type RiskLevel,
} from "../lib/risk";

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";

interface RiskMatrixProps {
  probability: RiskProbability;
  consequence: RiskConsequence;
  level: RiskLevel;
  result: string;
  readOnly: boolean;
  /** AI en curso (sugerencia de riesgo). */
  loading: boolean;
  /** Se dispara al elegir/limpiar una celda; entrega los 3 valores derivados. */
  onSelect: (probability: RiskProbability, consequence: RiskConsequence, level: RiskLevel) => void;
  onResultChange: (value: string) => void;
  /** Click en el título "Nivel de riesgo" → sugerir con IA. */
  onSuggest: () => void;
  /** Tooltip del título (override opcional). */
  aiTooltip?: string;
}

export function RiskMatrix({
  probability, consequence, level, result, readOnly, loading,
  onSelect, onResultChange, onSuggest, aiTooltip,
}: RiskMatrixProps) {
  const t = useT();
  return (
    <>
      {/* Nivel de riesgo (título clickeable → IA) + matriz */}
      <div className="space-y-1.5">
        <label
          onClick={readOnly ? undefined : onSuggest}
          title={readOnly ? undefined : (aiTooltip ?? t("mp.modal.aiRiskTooltip"))}
          className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            readOnly
              ? "text-text-industrial/60 cursor-default"
              : `text-accent hover:text-fg cursor-pointer ${loading ? "opacity-60 animate-pulse" : ""}`
          }`}
        >
          {!readOnly && (loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />)}
          {t("mp.riskLevel")}
          <span className="text-[10px] normal-case font-normal text-text-industrial/50 ml-1">{t("mp.risk.matrixHint")}</span>
        </label>
        <div className="rounded-lg border border-fg/10 overflow-hidden text-[10px]">
          <div className="grid" style={{ gridTemplateColumns: "118px repeat(4, 1fr)" }}>
            <div className="bg-[#0f2744] text-white/90 font-bold uppercase tracking-wide flex items-center justify-center text-center px-1 py-1.5 leading-tight">
              {t("mp.risk.consequence")}
            </div>
            {RISK_PROBS.map(pb => (
              <div key={pb} className="bg-[#1e3a5f] text-white font-bold flex items-center justify-center text-center px-1 py-1.5 leading-tight border-l border-white/20">
                {t(`mp.risk.prob.${pb}` as Parameters<typeof t>[0])}
              </div>
            ))}
            {RISK_CONS.map(cs => (
              <Fragment key={cs}>
                <div className="bg-fg/5 text-fg font-bold flex items-center justify-center text-center px-1 py-2 leading-tight border-t border-fg/10">
                  {t(`mp.risk.cons.${cs}` as Parameters<typeof t>[0])}
                </div>
                {RISK_PROBS.map(pb => {
                  const lvl = RISK_GRID[cs][pb];
                  const selected = probability === pb && consequence === cs;
                  return (
                    <button
                      key={pb} type="button" disabled={readOnly || loading}
                      onClick={() => {
                        if (selected) onSelect("", "", "");
                        else onSelect(pb, cs, deriveRiskLevelFromMatrix(pb, cs));
                      }}
                      aria-pressed={selected}
                      className={`${RISK_CELL_BG[lvl]} text-white font-bold flex items-center justify-center px-1 py-2 border-t border-l border-white/30 transition-all disabled:opacity-60 hover:brightness-110 ${selected ? "ring-2 ring-inset ring-fg shadow-inner" : "opacity-85"}`}>
                      {t(`mp.risk.level.${lvl}` as Parameters<typeof t>[0])}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
        {level && (
          <div className="text-[11px] text-text-industrial/70">
            {t("mp.riskLevel")}:{" "}
            <span className="font-bold" style={{ color: level === "HIGH" || level === "CRITICAL" ? "#dc2626" : level === "MEDIUM" ? "#d97706" : "#16a34a" }}>
              {t(`mp.risk.level.${level === "LOW" ? "B" : level === "MEDIUM" ? "M" : "H"}` as Parameters<typeof t>[0])}
            </span>
          </div>
        )}
      </div>

      {/* Resultado del análisis de riesgos */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("mp.riskAnalysisResult")}</label>
        <RichTextArea value={result} onChange={onResultChange} rows={2} className={inputCls} disabled={loading} />
      </div>
    </>
  );
}
