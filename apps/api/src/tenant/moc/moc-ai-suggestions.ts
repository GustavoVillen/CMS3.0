import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

const MODEL = "claude-haiku-4-5-20251001";

// Prompt experto: combina marco regulatorio marítimo (ISM 10.3, TMSA 7, SIRE)
// con metodologías formales de análisis de riesgo (Bow Tie, HAZID, FMEA).
// El output va al campo riskAssessmentNotes del MOC, así que tiene que ser
// directamente utilizable — sin preámbulos ni preguntas.
const PROMPT_RISK_ASSESSMENT = `Sos experto senior en sistemas de gestión de seguridad (SMS) marítimos y análisis de riesgos formales. Tu experiencia cubre ISM Code, TMSA 3 (element 7 — Management of Change), SIRE 2.0, e ISO 31000. Trabajaste con metodologías Bow Tie, HAZID, HAZOP y FMEA.

Te van a pasar un cambio (MOC) que el armador quiere aplicar a un buque. Tenés que producir un ANÁLISIS DE RIESGO PROFESIONAL del cambio propuesto, en español técnico-naval, en texto plano formateado en bullets.

ESTRUCTURA del output (4-7 bullets totales, sin headings ni Markdown — usar guiones):

- **Peligros identificados**: cuáles son los peligros / amenazas concretas que introduce o agrava este cambio (ser específico: fallas materiales, errores humanos, escenarios operativos, exposición regulatoria).
- **Escenarios negativos**: qué puede salir mal en la práctica si el cambio se aplica sin controles. Citar 2-3 escenarios realistas.
- **Controles existentes que se ven afectados**: qué barreras del SMS pueden debilitarse o perderse con este cambio (alarmas, redundancias, procedimientos, capacitación de tripulación, requisitos de clase, etc.).
- **Factores agravantes**: condiciones operativas que aumentan el riesgo (clima, tipo de carga, zonas SECA, presencia de tripulación reducida, edad del equipo, etc.).
- **Áreas de incertidumbre**: qué no sabemos todavía y qué información adicional convendría obtener antes de aprobar.
- **Recomendación de nivel de riesgo**: justificar por qué LOW / MEDIUM / HIGH / CRITICAL es apropiado, en 1 oración.

REGLAS:
- NO hagas preguntas al usuario — con la info disponible alcanza para un análisis preliminar serio.
- NO repitas literalmente el "cambio propuesto"; analizalo.
- Texto en español técnico-naval. Profesional, conciso, accionable.
- NO incluyas recomendaciones de mitigación (eso va en otro campo del form).
- NO inventes datos del buque que no estén en el contexto.
- Si el cambio es trivial o rutinario, decilo explícitamente.

Respondé ÚNICAMENTE con los bullets del análisis, sin introducción ni cierre.`;

const CATEGORY_LABEL: Record<string, string> = {
  EQUIPMENT_CHANGE:   "Cambio de equipo (físico)",
  PROCEDURE_CHANGE:   "Cambio de procedimiento operativo",
  ORGANIZATIONAL:     "Cambio organizacional",
  TEMPORARY:          "Cambio temporal / bypass / operación degradada",
  SOFTWARE_FIRMWARE:  "Cambio de software o firmware",
  OTHER:              "Otro",
};

const RISK_LABEL: Record<string, string> = {
  LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Crítico",
};

export interface RiskAssessmentInput {
  vesselCode?: string | null;
  category?: string | null;
  title?: string | null;
  reasonForChange?: string | null;
  proposedChange?: string | null;
  riskLevel?: string | null;
  impactAreas?: string[] | null;
  mitigationActions?: string | null;
  /** Texto que el user ya tenía escrito (si lo hay) — para refinarlo en vez de pisarlo. */
  currentNotes?: string | null;
}

function buildContext(input: RiskAssessmentInput): string {
  const lines = [
    "MOC (Management of Change) propuesto. Contexto completo:",
    `- Buque: ${input.vesselCode ?? "no especificado"}`,
    `- Categoría: ${input.category ? (CATEGORY_LABEL[input.category] ?? input.category) : "no especificada"}`,
    `- Título: ${input.title ?? "—"}`,
    `- Razón del cambio: ${input.reasonForChange ?? "no especificada"}`,
    `- Cambio propuesto: ${input.proposedChange ?? "no especificado"}`,
    `- Nivel de riesgo declarado actualmente: ${input.riskLevel ? (RISK_LABEL[input.riskLevel] ?? input.riskLevel) : "no especificado"}`,
  ];
  if (input.impactAreas && input.impactAreas.length > 0) {
    lines.push(`- Áreas de impacto marcadas por el usuario: ${input.impactAreas.join(", ")}`);
  }
  if (input.mitigationActions) {
    lines.push(`- Medidas de mitigación ya planteadas: ${input.mitigationActions}`);
  }
  if (input.currentNotes && input.currentNotes.trim()) {
    lines.push(
      "",
      "El usuario ya escribió las siguientes notas de análisis (refinalas, no las pises completamente):",
      input.currentNotes,
    );
  }
  return lines.join("\n");
}

export async function suggestRiskAssessment(
  session: TenantAccessSession,
  input: RiskAssessmentInput,
): Promise<{ text: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

  // Validación mínima — necesitamos al menos categoría y cambio propuesto
  // para que el análisis tenga sentido.
  if (!input.category || !input.proposedChange?.trim()) {
    throw new RouteError(400, "VALIDATION_ERROR", "Completá al menos la categoría y el cambio propuesto antes de pedir el análisis a la IA.");
  }

  const client = new Anthropic({ apiKey });
  const aiStarted = Date.now();

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: PROMPT_RISK_ASSESSMENT,
      messages: [{ role: "user", content: buildContext(input) }],
    });
  } catch (err) {
    log.error("[suggestRiskAssessment] Anthropic call failed:", err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo obtener sugerencia de la IA.");
  }

  // Telemetría no bloqueante
  (async () => {
    const prisma = getPrismaClient();
    if (!prisma) return;
    const tenant = await (prisma as unknown as { tenant: { findUnique(a: unknown): Promise<{ id: string } | null> } }).tenant.findUnique({
      where: { slug: session.tenantSlug },
      select: { id: true },
    });
    if (!tenant) return;
    recordAiUsage({
      tenantId: tenant.id,
      tenantSlug: session.tenantSlug,
      userId: session.user.id,
      userEmail: session.user.email,
      vesselCode: input.vesselCode ?? null,
      feature: "moc_risk_assessment_suggestion",
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - aiStarted,
    });
  })().catch(() => { /* swallow */ });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  return { text };
}
