// Textos legibles de un resultado de análisis, compartidos por el PDF del
// informe y por la descripción del defecto que genera un resultado crítico
// (y que hereda la OT correctiva). Una sola definición para que el informe y la
// OT digan lo mismo.

// Claves que arma vibration-report-ai-extractor.ts → nombre legible.
const PARAM_LABELS: Record<string, string> = {
  anchor_velocity: "Velocidad en anclajes",
  input_shaft_radial_velocity: "Eje de entrada · velocidad radial",
  input_shaft_axial_velocity: "Eje de entrada · velocidad axial",
  acceleration: "Aceleración",
  stern_tube_velocity: "Velocidad en bocina",
  displacement_horizontal: "Desplazamiento horizontal (PP)",
  displacement_vertical: "Desplazamiento vertical (PP)",
};

export function paramLabel(key: string): string {
  if (PARAM_LABELS[key]) return PARAM_LABELS[key];
  const t = key.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const VERDICT_ES: Record<string, string> = {
  NORMAL: "Normal", CAUTION: "Precaución", CRITICAL: "Crítico", ACTION_REQUIRED: "Acción requerida",
};

const KIND_ES: Record<string, string> = {
  FLUID: "fluido", VIBRATION: "vibraciones", THERMAL: "termografía", ULTRASOUND: "ultrasonido", OTHER: "laboratorio",
};

/** Resumen de vibraciones = "hallazgo. Recomendación: a · b. Prioridad: X" (vibrationSummary en fluid-batch-service). */
export function splitVibrationSummary(summary: string | null | undefined) {
  let rest = (summary ?? "").trim();
  let priority: string | null = null;
  let recommendation: string[] = [];
  const pIdx = rest.lastIndexOf("Prioridad:");
  if (pIdx >= 0) {
    priority = rest.slice(pIdx + "Prioridad:".length).trim().replace(/\.$/, "") || null;
    rest = rest.slice(0, pIdx).trim().replace(/\.+$/, "");
  }
  const rIdx = rest.lastIndexOf("Recomendación:");
  if (rIdx >= 0) {
    recommendation = rest.slice(rIdx + "Recomendación:".length).split(" · ").map(s => s.trim().replace(/\.+$/, "")).filter(Boolean);
    rest = rest.slice(0, rIdx).trim();
  }
  const finding = rest.replace(/\.{2,}/g, ".").replace(/\.$/, "").trim() || null;
  return { finding, recommendation, priority };
}

function paramText(raw: unknown): string {
  const obj = raw && typeof raw === "object" ? raw as { value?: unknown; unit?: unknown } : null;
  const value = obj && "value" in obj ? obj.value : raw;
  const unit = obj && obj.unit ? ` ${String(obj.unit)}` : "";
  const text = typeof value === "number" ? value.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : String(value ?? "—");
  return `${text}${unit}`;
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Descripción del defecto de un resultado crítico (preview V46). La OT
 * correctiva que se abre desde el defecto la hereda tal cual.
 */
export function buildResultDefectDescription(input: {
  kind: string;
  sampleCode: string;
  labReference: string | null;
  labName: string | null;
  sampledAtText: string | null;
  verdict: string;
  summary: string | null;
  parameters: Record<string, unknown> | null;
}): string {
  const source = [input.labReference ? `Informe ${input.labReference}` : null, input.labName, input.sampledAtText].filter(Boolean).join(" · ");
  const lines: string[] = [
    `Resultado del análisis de ${KIND_ES[input.kind] ?? KIND_ES.OTHER} ${input.sampleCode}${source ? ` (${source})` : ""}`,
    `Veredicto: ${VERDICT_ES[input.verdict] ?? input.verdict}`,
  ];
  const params = input.parameters ? Object.entries(input.parameters) : [];
  if (params.length > 0) {
    lines.push("", "Mediciones:");
    for (const [key, raw] of params) {
      lines.push(`• ${input.kind === "FLUID" ? key : paramLabel(key)}: ${paramText(raw)}`);
    }
  }
  if (input.kind === "VIBRATION") {
    const parts = splitVibrationSummary(input.summary);
    if (parts.finding) lines.push("", `Hallazgo: ${parts.finding}.`);
    if (parts.recommendation.length > 0) {
      lines.push("Recomendación:", ...parts.recommendation.map(r => `• ${capitalize(r)}`));
    }
    if (parts.priority) lines.push(`Prioridad del analista: ${parts.priority}`);
  } else if (input.summary) {
    lines.push("", `Resumen del laboratorio: ${input.summary}`);
  }
  return lines.join("\n");
}
