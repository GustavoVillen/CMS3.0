import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";

const MODEL = "claude-haiku-4-5-20251001";

// Prompt experto: combina marco regulatorio marítimo (ISM 10.3, TMSA 7, SIRE)
// con metodologías formales de análisis de riesgo (Bow Tie, HAZID, FMEA).
// El output va al campo riskAssessmentNotes del MOC, así que tiene que ser
// directamente utilizable — sin preámbulos ni preguntas.
// Separador único que usamos para partir la respuesta en dos bloques
// (análisis de riesgo y medidas de mitigación). Modelo lo emite literal.
const SECTION_SEPARATOR = "---MITIGATION---";

const PROMPT_RISK_ASSESSMENT = `Sos experto senior en sistemas de gestión de seguridad (SMS) marítimos y análisis de riesgos formales. Tu experiencia cubre ISM Code, TMSA 3 (element 7 — Management of Change), SIRE 2.0, e ISO 31000. Trabajaste con metodologías Bow Tie, HAZID, HAZOP y FMEA.

Te van a pasar un cambio (MOC) que el armador quiere aplicar a un buque. Tenés que producir DOS BLOQUES separados: (A) un ANÁLISIS DE RIESGO profesional del cambio, y (B) MEDIDAS DE MITIGACIÓN concretas y accionables. Texto plano en español técnico-naval.

═══════════════════════════════════════
BLOQUE A — ANÁLISIS DE RIESGO
═══════════════════════════════════════

6 secciones obligatorias en este orden, cada una empieza con un encabezado en negrita seguido de DOS PUNTOS y un salto de línea. Después listar los sub-items numerados, UNO POR LÍNEA, comenzando cada línea con el número y un punto. NUNCA poner varios items en una sola línea con "(1)... (2)... (3)...".

**Peligros identificados**:
1. <peligro concreto 1>
2. <peligro concreto 2>
3. <peligro concreto 3>

**Escenarios negativos**:
1. <escenario realista 1>
2. <escenario realista 2>
3. <escenario realista 3>

**Controles existentes afectados**:
1. <barrera o control 1 que se debilita>
2. <barrera o control 2 que se debilita>

**Factores agravantes**:
1. <condición operativa 1>
2. <condición operativa 2>

**Áreas de incertidumbre**:
1. <qué falta saber 1>
2. <qué falta saber 2>

**Recomendación de nivel de riesgo**: <una sola oración con el nivel sugerido (LOW/MEDIUM/HIGH/CRITICAL) y por qué>.

═══════════════════════════════════════
SEPARADOR OBLIGATORIO
═══════════════════════════════════════

Después del Bloque A insertás UNA línea EN BLANCO, luego el literal "${SECTION_SEPARATOR}" SOLO en su propia línea, luego otra línea EN BLANCO, y arrancás el Bloque B.

═══════════════════════════════════════
BLOQUE B — MEDIDAS DE MITIGACIÓN
═══════════════════════════════════════

3 secciones obligatorias en este orden:

**Medidas de mitigación**:
1. <medida concreta y accionable 1 — qué se hace + sobre qué barrera>
2. <medida concreta y accionable 2>
3. <medida concreta y accionable 3>
4. <medida concreta y accionable 4 (opcional)>
5. <medida concreta y accionable 5 (opcional)>

**Verificación de eficacia**:
1. <cómo se verifica que la mitigación funciona en la práctica — ej. drill, inspección, KPI a registrar>
2. <segunda verificación si aplica>

**Plan de reversión / roll-back**:
1. <cómo se revierte el cambio si la mitigación falla o el riesgo residual sigue siendo inaceptable>

═══════════════════════════════════════
REGLAS DE FORMATO (críticas)
═══════════════════════════════════════
- Cada encabezado de sección DEBE empezar con dos asteriscos y terminar con dos asteriscos (**) seguido de ":".
- Cada sub-item numerado va en su PROPIA LÍNEA, comenzando con "1. ", "2. ", "3. " desde el margen izquierdo.
- NUNCA usar "(1)... (2)... (3)..." inline en una sola línea.
- Separar cada sección con UNA línea en blanco.
- Si una sección tiene un solo item, va igual numerado como "1.".
- El separador "${SECTION_SEPARATOR}" aparece UNA SOLA VEZ y va EN SU PROPIA LÍNEA.

═══════════════════════════════════════
REGLAS DE CONTENIDO
═══════════════════════════════════════
- NO hagas preguntas al usuario — con la info disponible alcanza para un análisis preliminar serio.
- NO repitas literalmente el "cambio propuesto"; analizalo.
- Las medidas de mitigación deben ser ACCIONABLES y específicas al cambio propuesto. NADA de genéricos tipo "capacitar al personal" sin especificar sobre qué.
- Profesional, conciso. No texto poético ni verboso.
- NO inventes datos del buque que no estén en el contexto.
- Si el cambio es trivial o rutinario, decilo explícitamente en la primera sección del Bloque A — pero igual generá el Bloque B con medidas mínimas razonables.

Respondé ÚNICAMENTE con los dos bloques separados por el literal, sin introducción ni cierre.`;

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
  /** Texto que el user ya tenía escrito en "Notas análisis de riesgo" (si lo hay) — para refinarlo en vez de pisarlo. */
  currentNotes?: string | null;
  /** Texto que el user ya tenía escrito en "Medidas de mitigación" (si lo hay) — para refinarlo en vez de pisarlo. */
  mitigationActions?: string | null;
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
  if (input.currentNotes && input.currentNotes.trim()) {
    lines.push(
      "",
      "El usuario ya escribió las siguientes notas de análisis (refinalas e integralas, no las pises completamente):",
      input.currentNotes,
    );
  }
  if (input.mitigationActions && input.mitigationActions.trim()) {
    lines.push(
      "",
      "El usuario ya escribió las siguientes medidas de mitigación (refinalas e integralas, no las pises completamente):",
      input.mitigationActions,
    );
  }
  return lines.join("\n");
}

export async function suggestRiskAssessment(
  session: TenantAccessSession,
  input: RiskAssessmentInput,
): Promise<{ riskAssessment: string; mitigation: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

  // Validación mínima — necesitamos al menos categoría y cambio propuesto
  // para que el análisis tenga sentido.
  if (!input.category || !input.proposedChange?.trim()) {
    throw new RouteError(400, "VALIDATION_ERROR", "Completá al menos la categoría y el cambio propuesto antes de pedir el análisis a la IA.");
  }

  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      // 2 bloques (risk + mitigation). 1500 alcanza para la salida real
      // observada (~900-1100 tokens); Anthropic reserva tiempo proporcional al cap.
      max_tokens: 1500,
      // System prompt en forma de array con cache_control ephemeral. El prompt
      // pesa ~2.3 KB y es idéntico entre invocaciones: cacheándolo bajamos
      // ~80% el input charge y mejoramos latencia warm.
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: PROMPT_RISK_ASSESSMENT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${buildContext(input)}` }],
    });
  } catch (err) {
    log.error("[suggestRiskAssessment] Anthropic call failed:", err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo obtener sugerencia de la IA.");
  }

  // Telemetría no bloqueante
  (async () => {
    // Cache de tenant: antes hacíamos un findUnique extra por cada AI call
    // (~17 ocurrencias). El cache TTL 5min mata esa saturación del pool.
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
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

  // Partimos por el separador. Si el modelo no lo emitió (caso raro), todo
  // se considera análisis de riesgo y dejamos mitigation vacío — la UI
  // mostrará lo que haya y el usuario puede regenerar.
  const sepIdx = text.indexOf(SECTION_SEPARATOR);
  const riskAssessment = (sepIdx >= 0 ? text.slice(0, sepIdx) : text).trim();
  const mitigation     = (sepIdx >= 0 ? text.slice(sepIdx + SECTION_SEPARATOR.length) : "").trim();

  return { riskAssessment, mitigation };
}
