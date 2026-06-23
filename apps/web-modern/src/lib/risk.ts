// Matriz de análisis de riesgo (probabilidad × consecuencia) compartida entre
// el Plan de Mantenimiento y los Diferimientos. Mismas reglas que el backend
// (deriveRiskLevelFromMatrix) y el PDF (renderRiskMatrix). Único origen de
// verdad para que ambos módulos rendericen la misma matriz.

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const RISK_PROBS  = ["LIKELY", "PROBABLE", "UNLIKELY", "RARE"] as const;
export const RISK_CONS   = ["FATALITY", "MAJOR", "MINOR", "NEGLIGIBLE"] as const;

export type RiskLevel       = (typeof RISK_LEVELS)[number] | "";
export type RiskProbability = (typeof RISK_PROBS)[number] | "";
export type RiskConsequence = (typeof RISK_CONS)[number] | "";

// Filas = consecuencia, columnas = probabilidad. H=Alto, M=Medio, B=Bajo.
export const RISK_GRID: Record<string, Record<string, "H" | "M" | "B">> = {
  FATALITY:   { LIKELY: "H", PROBABLE: "H", UNLIKELY: "H", RARE: "M" },
  MAJOR:      { LIKELY: "H", PROBABLE: "H", UNLIKELY: "M", RARE: "M" },
  MINOR:      { LIKELY: "H", PROBABLE: "M", UNLIKELY: "M", RARE: "B" },
  NEGLIGIBLE: { LIKELY: "M", PROBABLE: "M", UNLIKELY: "B", RARE: "B" },
};
export const RISK_CELL_BG: Record<"H" | "M" | "B", string> = {
  H: "bg-red-600", M: "bg-yellow-400", B: "bg-green-600",
};

export function deriveRiskLevelFromMatrix(prob: RiskProbability, cons: RiskConsequence): RiskLevel {
  if (!prob || !cons) return "";
  const lvl = RISK_GRID[cons]?.[prob];
  return lvl === "H" ? "HIGH" : lvl === "M" ? "MEDIUM" : lvl === "B" ? "LOW" : "";
}
export function toUiRiskLevel(value: string | null | undefined): RiskLevel {
  const n = String(value ?? "").toUpperCase() as RiskLevel;
  return (RISK_LEVELS as readonly string[]).includes(n) ? n : "";
}
export function toUiRiskProbability(v: string | null | undefined): RiskProbability {
  const n = String(v ?? "").toUpperCase() as RiskProbability;
  return (RISK_PROBS as readonly string[]).includes(n) ? n : "";
}
export function toUiRiskConsequence(v: string | null | undefined): RiskConsequence {
  const n = String(v ?? "").toUpperCase() as RiskConsequence;
  return (RISK_CONS as readonly string[]).includes(n) ? n : "";
}
