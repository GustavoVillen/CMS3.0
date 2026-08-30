import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { getVesselAiContext } from "../ai/vessel-ai-context";

import { EVAL_QUESTIONS, EVALUATOR_AREAS, CHANGE_TYPES } from "./moc-form-catalog";

/** Contexto del buque como lista (vacia si no se sabe cual es), para spreadear
 *  dentro de los arrays de lineas que arman el prompt. */
async function sobreElBuque(
  session: { tenantSlug: string },
  vesselCode: string | null | undefined,
): Promise<string[]> {
  const ctx = await getVesselAiContext(session.tenantSlug, vesselCode);
  return ctx ? [`- Sobre el buque: ${ctx}`] : [];
}


const MODEL = AI_MODEL.fast;

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

function buildContext(input: RiskAssessmentInput, sobreElBuqueLinea: string[] = []): string {
  const lines = [
    "MOC (Management of Change) propuesto. Contexto completo:",
    `- Buque: ${input.vesselCode ?? "no especificado"}`,
    ...sobreElBuqueLinea,
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
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");

  // Validación mínima — necesitamos al menos categoría y cambio propuesto
  // para que el análisis tenga sentido.
  if (!input.category || !input.proposedChange?.trim()) {
    throw new RouteError(400, "VALIDATION_ERROR", "Completá al menos la categoría y el cambio propuesto antes de pedir el análisis a la IA.");
  }

  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const client = createAiClient({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);
  const sobreElBuqueLinea = await sobreElBuque(session, input.vesselCode);

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
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${buildContext(input, sobreElBuqueLinea)}` }],
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

// ─── Borrador completo del formulario REGI-GES-06.1 (Fase 3) ───────────────────
// A partir de la descripción del cambio, el copiloto pre-completa la dimensión,
// las 24 respuestas de evaluación previa (con impacto), el plan de acción, la
// clasificación de riesgo y los pareceres técnicos. Devuelve un BORRADOR
// estructurado (tool-use forzado) que el Gestor del Cambio revisa y aprueba —
// la IA nunca decide criticidad ni aprueba sola.

export interface MocDraftInput {
  vesselName?: string | null;
  /** Para resolver el tipo de buque (remolcador / barcaza no tripulada). */
  vesselCode?: string | null;
  changeTypesHint?: string[] | null;
  title?: string | null;
  currentSituation?: string | null;
  reasonForChange?: string | null;
  proposedChange?: string | null;
  expectedResult?: string | null;
}

const EVALUATOR_KEYS = EVALUATOR_AREAS.map(a => a.key);
const CHANGE_TYPE_KEYS = CHANGE_TYPES.map(c => c.key);

const DRAFT_TOOL: Anthropic.Tool = {
  name: "moc_draft",
  description: "Registra el borrador completo del formulario de gestión de cambios REGI-GES-06.1.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      changeTypes: { type: "array", items: { type: "string", enum: CHANGE_TYPE_KEYS }, description: "Tipo(s) de cambio aplicables." },
      duration: { type: "string", enum: ["PERMANENT", "TEMPORARY"], description: "Duración del cambio." },
      currentSituation: { type: "string", description: "Situación actual redactada/refinada." },
      expectedResult: { type: "string", description: "Resultado esperado redactado/refinado." },
      suggestedRiskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Nivel de riesgo sugerido." },
      evaluatorAreas: { type: "array", items: { type: "string", enum: EVALUATOR_KEYS }, description: "Áreas que deberían evaluar el cambio." },
      evaluationAnswers: {
        type: "array",
        description: "Respuesta a CADA una de las 24 preguntas de evaluación previa.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            n: { type: "integer", description: "Número de pregunta (1-24)." },
            answer: { type: "string", enum: ["YES", "NO", "UNKNOWN"], description: "Respuesta a la pregunta." },
            canImpact: { type: "boolean", description: "true si el cambio PUEDE impactar según esta pregunta." },
          },
          required: ["n", "answer", "canImpact"],
        },
      },
      actionPlan: {
        type: "array",
        description: "Acciones recomendadas para implementar/mitigar el cambio.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            impact: { type: "string", description: "Impacto en el proceso/tarea." },
            action: { type: "string", description: "Acción concreta a realizar." },
            responsible: { type: "string", description: "Rol/área responsable sugerido." },
            observations: { type: "string", description: "Observaciones (opcional)." },
          },
          required: ["impact", "action"],
        },
      },
      technicalReviews: {
        type: "array",
        description: "Borradores de parecer técnico (SSMA y Apoyo).",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            team: { type: "string", enum: ["SSMA", "SUPPORT"] },
            viable: { type: "string", enum: ["YES", "NO"] },
            justification: { type: "string", description: "Parecer técnico y recomendaciones." },
          },
          required: ["team", "viable", "justification"],
        },
      },
      recommendationsBeforeChange: { type: "string", description: "Recomendaciones antes de aplicar el cambio." },
    },
    required: ["changeTypes", "suggestedRiskLevel", "evaluationAnswers"],
  },
};

const DRAFT_PROMPT = `Sos experto senior en sistemas de gestión de seguridad (SMS) marítimos y en Gestión de Cambios (Management of Change — ISM 10.3, TMSA elemento 7). Te van a describir un cambio (MOC) propuesto para un buque/unidad. Tenés que PRE-COMPLETAR el formulario controlado REGI-GES-06.1 como un BORRADOR para que el Gestor del Cambio lo revise y ajuste.

Reglas:
- Registrá el resultado ÚNICAMENTE mediante la herramienta "moc_draft".
- Respondé las 24 preguntas de evaluación previa (una por número). Para cada una: answer = YES/NO/UNKNOWN, y canImpact = true si el cambio PUEDE impactar en SSMA según esa pregunta.
- Sé CONSERVADOR pero honesto: marcá canImpact=true (o answer=UNKNOWN) solo cuando el cambio propuesto realmente lo implique. Si el cambio es menor y una pregunta no aplica, answer=NO y canImpact=false.
- El nivel de riesgo y las viabilidades son SUGERENCIAS; nunca son una aprobación.
- El plan de acción y los pareceres deben ser accionables y específicos al cambio, no genéricos. Si el cambio es menor, el plan puede ser breve o vacío.
- Texto en español técnico-naval, conciso.

Las 24 preguntas de evaluación previa (por número):
${EVAL_QUESTIONS.map(q => `${q.n}. ${q.text}`).join("\n")}`;

export async function suggestMocDraft(session: TenantAccessSession, input: MocDraftInput) {
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");
  if (!input.proposedChange?.trim() && !input.reasonForChange?.trim()) {
    throw new RouteError(400, "VALIDATION_ERROR", "Describí al menos el motivo o el cambio propuesto antes de pedir el borrador a la IA.");
  }

  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const client = createAiClient({ apiKey, timeout: 45_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);

  const context = [
    "Cambio (MOC) propuesto:",
    `- Unidad/buque: ${input.vesselName ?? "no especificado"}`,
    ...(await sobreElBuque(session, input.vesselCode)),
    `- Título: ${input.title ?? "—"}`,
    `- Tipo(s) sugeridos por el usuario: ${input.changeTypesHint?.length ? input.changeTypesHint.join(", ") : "—"}`,
    `- Situación actual: ${input.currentSituation ?? "—"}`,
    `- Motivo del cambio: ${input.reasonForChange ?? "—"}`,
    `- Cambio propuesto: ${input.proposedChange ?? "—"}`,
    `- Resultado esperado: ${input.expectedResult ?? "—"}`,
  ].join("\n");

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: DRAFT_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools: [DRAFT_TOOL],
      tool_choice: { type: "tool", name: "moc_draft" },
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${context}` }],
    });
  } catch (err) {
    log.error("[suggestMocDraft] Anthropic call failed:", err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo generar el borrador con IA.");
  }

  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId: tenant.id, tenantSlug: session.tenantSlug,
      userId: session.user.id, userEmail: session.user.email,
      vesselCode: null, feature: "moc_draft_suggestion", model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - aiStarted,
    });
  })().catch(() => { /* swallow */ });

  const toolBlock = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolBlock) throw new RouteError(502, "AI_CALL_FAILED", "La IA no devolvió un borrador estructurado.");
  return toolBlock.input as Record<string, unknown>;
}
