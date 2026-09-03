import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { cleanAiText } from "../ai/ai-text";
import { getVesselAiContext } from "../ai/vessel-ai-context";
import { SCOPE_RULES, CREW_LEVEL_RULES, TASK_TYPE_RULES } from "../ai/task-scope-guidance";

const MODEL = AI_MODEL.fast;

const PROMPT_ACCEPTANCE = `Sos experto en mantenimiento de máquinas navales. Generá el siguiente contenido para esta tarea:

1. Criterios de aceptación verificables: cómo se sabe que el trabajo quedó bien hecho.

2. Una sección con las herramientas e instrumentos necesarios (los de a bordo).

${SCOPE_RULES}

${CREW_LEVEL_RULES}

${TASK_TYPE_RULES}

REGLAS DE CONCISIÓN (importante):
- Sé breve: máximo 6 criterios, un bullet corto por criterio.
- Poné valor o tolerancia SOLO cuando sea un dato conocido del equipo (placa, manual, indicador propio) y medible a bordo. Si no, el criterio es un estado observable claro: "sin fugas después de 10 minutos en marcha", "sin ruidos ni vibraciones anormales", "válvula abre y cierra en todo su recorrido".
- Nada de bullets vagos tipo "verificar correcto funcionamiento": tiene que decir QUÉ se mira y CUÁL es la condición aceptable.
- Sin redundancia, sin obviedades, sin explicaciones largas.
- Herramientas: solo las que la tarea realmente necesita, disponibles a bordo; máximo 5. No listes genéricos (trapos, guantes, llaves comunes).

Usá exactamente este formato (sin introducción ni explicación adicional): primero los
criterios de aceptación, un bullet por línea; después una línea en blanco; después el
encabezado "HERRAMIENTAS E INSTRUMENTOS NECESARIOS:" y debajo la lista, un bullet por línea.
Escribí el contenido real: no repitas estas indicaciones ni las encierres entre corchetes.`;

const PROMPT_LOTO = `Sos experto en mantenimiento de máquinas navales. Definí los procedimientos LOTO (Lockout/Tagout) específicos para esta tarea: qué energías deben bloquearse, en qué orden, y qué verificaciones de seguridad se requieren antes de iniciar y al finalizar el trabajo. No incluyas listado de EPP ni equipos de protección personal.

TENÉ EN CUENTA EL TIPO DE TAREA (si se indica):
- INSPECCIÓN: verificación/medición sin desarmar ni intervenir el equipo. El LOTO suele ser más acotado: aislar solo las energías necesarias para acercarse con seguridad. Si la inspección exige el equipo en marcha (p. ej. control de nivel a temperatura de operación), indicalo en lugar de bloquear todo.
- MANTENIMIENTO: intervención física (desarme, cambio de componentes, ajuste). El LOTO debe ser completo: bloqueo y verificación de energía cero de TODAS las fuentes (eléctrica, mecánica, hidráulica, neumática, térmica, presión y fluidos residuales) antes de intervenir.

${SCOPE_RULES}

NIVEL — escribí para una tripulación, no para un taller (regla dura):
- Lo ejecuta la tripulación del buque con lo que hay a bordo: candado y tarjeta, breaker o llave de corte, válvulas de bloqueo, purgas y drenajes del propio sistema, y verificación con el instrumento simple que corresponda (multímetro, manómetro del equipo).
- Bloqueá solo las energías que esta tarea realmente pone en juego. Aislar de más una tarea simple hace que nadie siga el procedimiento.
- Nada de dispositivos, permisos ni procedimientos que el buque no tiene.

REGLAS DE CONCISIÓN (importante):
- Sé breve: solo las energías a bloquear y las verificaciones críticas. Máximo 6 puntos, un paso corto por línea.
- Directo y accionable. Sin justificaciones, sin teoría, sin redundancia.

Responde ÚNICAMENTE con el procedimiento LOTO, en texto plano, sin introducción ni explicación adicional.`;

const PROMPT_RISK = `Sos experto en HSE / Job Safety Analysis (JSA) para mantenimiento de máquinas navales.

CONTEXTO IMPORTANTE — qué te están pidiendo:
Este análisis evalúa el riesgo PARA EL OPERARIO al EJECUTAR la tarea. Es decir: la pregunta es "¿qué peligros corre quien hace el trabajo MIENTRAS lo hace?".

NO confundir con RCM (otra herramienta del sistema). RCM pregunta lo opuesto: "¿qué pasa si la tarea NO se hace?". RCM mira la consecuencia de la falla en el equipo. Vos NO tenés que pensar en eso.

Vos pensás en: espacio confinado, energías peligrosas, hot work, caídas, atrapamiento, exposición química, ruido, atmósferas explosivas, partes móviles, cargas suspendidas, presión residual, temperatura, electricidad. Cosas que pueden lastimar AL TRIPULANTE durante la ejecución.

TENÉ EN CUENTA EL TIPO DE TAREA (si se indica):
- INSPECCIÓN: verificación/medición sin intervenir el equipo; menor exposición (a veces con el equipo en marcha → cuidado con partes móviles y superficies calientes, pero sin desarme). Tiende a riesgo más bajo.
- MANTENIMIENTO: intervención física (desarme, cambio de partes, ajuste); mayor exposición a energías liberadas, atrapamiento, presión/fluidos residuales y manipulación de cargas. Tiende a riesgo más alto.
Ajustá NIVEL, PROBABILIDAD y CONSECUENCIA de forma coherente con el tipo de tarea, sin sobredimensionar una inspección ni subestimar un mantenimiento.

${SCOPE_RULES}

NIVEL — escribí para una tripulación, no para un taller (regla dura):
- Analizá los peligros de ESTA tarea tal como la hace la tripulación a bordo. No inventes peligros de un trabajo mayor que nadie va a hacer.
- Los controles tienen que ser ejecutables a bordo con los medios del buque (bloqueo y tarjeta, ventilación, standby, detector de gases, arnés, andamio o guindola). Si un control exige medios que el buque no tiene, decilo en una línea en lugar de darlo por hecho.
- Simplificar el control no es bajar la guardia: si la tarea es realmente peligrosa (espacio confinado, hot work, altura), el nivel y el control van igual.

REGLAS DE CONCISIÓN (importante):
- Solo los 3-5 peligros principales. Un bullet corto por peligro: "peligro → control clave". Sin párrafos largos ni redundancia.
- EPP: solo el específico de esta tarea (máximo 5); no listes el genérico de rutina.

Niveles de riesgo (operacional):
- LOW: tarea rutinaria sin energías peligrosas, espacio normal, EPP básico.
- MEDIUM: requiere LOTO simple, EPP específico, una persona alcanza.
- HIGH: requiere permisos especiales (espacio confinado, hot work), standby, atmósfera medida.
- CRITICAL: combina varios riesgos altos o trabajo en altura/sobre el agua/buceo.

Además, clasificá los DOS ejes de la matriz de riesgo (la lesión al operario durante la ejecución):

PROBABILIDAD — qué tan probable es que ocurra una lesión al ejecutar la tarea:
- LIKELY: muy probable
- PROBABLE: probable
- UNLIKELY: improbable
- RARE: altamente improbable

CONSECUENCIA — severidad de la lesión más grave razonablemente plausible al operario:
- FATALITY: fatalidad
- MAJOR: lesiones importantes (incapacitantes / hospitalización)
- MINOR: lesiones leves (primeros auxilios)
- NEGLIGIBLE: lesiones insignificantes

Respondé ÚNICAMENTE con este formato exacto (sin JSON, sin markdown, sin introducción):

NIVEL: LOW|MEDIUM|HIGH|CRITICAL
PROBABILIDAD: LIKELY|PROBABLE|UNLIKELY|RARE
CONSECUENCIA: FATALITY|MAJOR|MINOR|NEGLIGIBLE

Después de esas tres líneas, de 3 a 5 bullets cortos con el formato
"- peligro principal → control clave"; después el encabezado "EQUIPOS DE PPE:" y debajo el
EPP específico, un bullet por línea. Escribí el contenido real: no repitas estas
indicaciones ni encierres el texto entre corchetes.`;

interface BaseInput {
  assetLabel?: string | null;
  taskDesc?: string | null;
  taskType?: "INSPECTION" | "MAINTENANCE" | null;
  /** Buque del plan. Con esto el servicio resuelve solo qué clase de embarcación
   *  es: el JSA de una barcaza sin gente a bordo no es el de un remolcador. */
  vesselCode?: string | null;
}

function taskTypeLabel(taskType?: "INSPECTION" | "MAINTENANCE" | null): string | null {
  if (taskType === "INSPECTION") return "Inspección (verificación/medición; normalmente sin desarmar ni intervenir el equipo)";
  if (taskType === "MAINTENANCE") return "Mantenimiento (intervención física: desarme, cambio de componentes, ajuste)";
  return null;
}

interface LotoInput extends BaseInput {
  acceptanceCriteria?: string | null;
}

interface RiskInput extends BaseInput {
  acceptanceCriteria?: string | null;
  loto?: string | null;
}

export interface RiskResult {
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  probability: "LIKELY" | "PROBABLE" | "UNLIKELY" | "RARE" | null;
  consequence: "FATALITY" | "MAJOR" | "MINOR" | "NEGLIGIBLE" | null;
  analysis: string;
}

function buildContext(
  input: BaseInput,
  extras: Record<string, string | null | undefined> = {},
  vesselFacts?: string | null,
): string {
  const lines = [
    `Activo: ${(input.assetLabel ?? "").trim() || "equipo desconocido"}`,
    `Tarea: ${(input.taskDesc ?? "").trim() || "tarea no especificada"}`,
  ];
  if (vesselFacts) lines.push(`Sobre el buque: ${vesselFacts}`);
  const tt = taskTypeLabel(input.taskType);
  if (tt) lines.push(`Tipo de tarea: ${tt}`);
  for (const [k, v] of Object.entries(extras)) {
    if (v && v.trim()) lines.push(`${k}: ${v.trim()}`);
  }
  return lines.join("\n");
}

async function callClaude(
  session: TenantAccessSession,
  feature: string,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
): Promise<string> {
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");

  // Timeout 60s. LOTO y criterios de aceptación son listas largas: el techo de
  // 1024 tokens cortaba el contenido a media frase (stop_reason=max_tokens). Al
  // subir los topes (3000) las generaciones largas necesitan más margen; Haiku
  // 4.5 es rápido, pero el tail con cache_creation del prompt puede acercarse a
  // los 45s previos, así que se amplía a 60s.
  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const client = createAiClient({ apiKey, timeout: 60_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${userContent}` }],
    });
  } catch (err) {
    log.error(`[${feature}] Anthropic call failed:`, err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo obtener sugerencia de la IA.");
  }

  // Telemetría no bloqueante
  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId: tenant.id,
      tenantSlug: session.tenantSlug,
      userId: session.user.id,
      userEmail: session.user.email,
      vesselCode: null,
      feature,
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - aiStarted,
    });
  })().catch(() => { /* swallow */ });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();
  return cleanAiText(raw);
}

export async function suggestPlanAcceptanceCriteria(
  session: TenantAccessSession,
  input: BaseInput,
): Promise<{ text: string }> {
  const text = await callClaude(
    session,
    "plan_acceptance_criteria_suggestion",
    PROMPT_ACCEPTANCE,
    buildContext(input, {}, await getVesselAiContext(session.tenantSlug, input.vesselCode)),
    3000,
  );
  return { text };
}

export async function suggestPlanLoto(
  session: TenantAccessSession,
  input: LotoInput,
): Promise<{ text: string }> {
  const text = await callClaude(
    session,
    "plan_loto_suggestion",
    PROMPT_LOTO,
    buildContext(input, { "Criterios de aceptación": input.acceptanceCriteria }, await getVesselAiContext(session.tenantSlug, input.vesselCode)),
    3000,
  );
  return { text };
}

export async function suggestPlanRisk(
  session: TenantAccessSession,
  input: RiskInput,
): Promise<RiskResult> {
  const raw = await callClaude(
    session,
    "plan_risk_suggestion",
    PROMPT_RISK,
    buildContext(input, {
      "Criterios de aceptación": input.acceptanceCriteria,
      "LOTO": input.loto,
    }, await getVesselAiContext(session.tenantSlug, input.vesselCode)),
    1500,
  );

  const levelMatch = raw.match(/^NIVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL)/im);
  const level = (levelMatch?.[1] ?? "").toUpperCase() as RiskResult["level"];
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(level)) {
    throw new RouteError(502, "AI_PARSE_ERROR", `Nivel de riesgo inválido o ausente.`);
  }

  // Ejes de la matriz: opcionales (si la IA los omite, se devuelven null y el
  // frontend cae al `level`). No bloquean la respuesta.
  const probMatch = raw.match(/^PROBABILIDAD:\s*(LIKELY|PROBABLE|UNLIKELY|RARE)/im);
  const consMatch = raw.match(/^CONSECUENCIA:\s*(FATALITY|MAJOR|MINOR|NEGLIGIBLE)/im);
  const probability = (probMatch?.[1]?.toUpperCase() ?? null) as RiskResult["probability"];
  const consequence = (consMatch?.[1]?.toUpperCase() ?? null) as RiskResult["consequence"];

  // El análisis es el texto sin las tres líneas de cabecera (en cualquier orden).
  const analysis = raw
    .replace(/^NIVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL).*$/im, "")
    .replace(/^PROBABILIDAD:\s*(LIKELY|PROBABLE|UNLIKELY|RARE).*$/im, "")
    .replace(/^CONSECUENCIA:\s*(FATALITY|MAJOR|MINOR|NEGLIGIBLE).*$/im, "")
    .trim();
  if (!analysis) {
    throw new RouteError(502, "AI_PARSE_ERROR", "Falta el análisis.");
  }

  return { level, probability, consequence, analysis };
}
