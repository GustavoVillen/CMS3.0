// Vetting · BIQ5 — borrador de análisis asistido por IA.
//
// Mismo contrato que suggestIsmAssessment (tool-use forzado, una sola llamada,
// sin loop agéntico), con el marco del vetting: el interlocutor es el
// responsable técnico que prepara el buque para la inspección de un fletador o
// de una petrolera con el cuestionario BIQ5 de OCIMF.
//
// La IA NO predice el resultado de la inspección: explica qué muestra el dato
// del sistema frente al capítulo y propone la acción para cerrarlo.

import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { getVesselAiContext } from "../ai/vessel-ai-context";
import { GROUP_TITLE as TMSA_GROUP_TITLE, METRIC_LABEL as TMSA_METRIC_LABEL } from "../tmsa/tmsa-pdf-service";
import { requireAuditPanelAccess } from "../tmsa/tmsa-service";
import { getVettingBiqEvidence, getVettingMetricDetail } from "./vetting-service";
import { CHAPTER_TEXT, OWN_GROUP_TITLE, ownMetricLabel } from "./vetting-labels";

const MODEL = AI_MODEL.fast;

const ASSESSMENT_TOOL: Anthropic.Tool = {
  name: "vetting_assessment",
  description: "Registra el borrador de análisis de evidencia para este bloque del cuestionario BIQ5.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      narrative: { type: "string", description: "Qué muestra la evidencia frente a lo que mira el inspector en este capítulo, basado sólo en los datos provistos." },
      recommendedAction: { type: "string", description: "Acción concreta para cerrar la brecha antes de la inspección. Cadena vacía si el estado es OK/INFO." },
    },
    required: ["narrative", "recommendedAction"],
  },
};

const ASSESSMENT_PROMPT = `Sos un asistente técnico que prepara barcazas tanque y remolcadores fluviales para inspecciones de vetting con el cuestionario BIQ5 de OCIMF (barcazas y remolcadores, Sudamérica y Centroamérica). Te paso qué mira el inspector en un capítulo y datos OBJETIVOS ya calculados por el sistema de mantenimiento sobre un buque o una flota. Redactás un BORRADOR de análisis para que el responsable técnico de la compañía lo revise antes de la inspección.

Reglas:
- Registrá el resultado ÚNICAMENTE mediante la herramienta "vetting_assessment".
- NO anticipes el resultado de la inspección ni digas que el buque "aprueba" o "no aprueba": eso lo decide el inspector. Explicá qué respalda y qué no respalda la evidencia del sistema.
- narrative: relacioná el dato con lo que mira el inspector en ESTE capítulo, basándote SOLO en las métricas y la muestra de registros. No inventes causas ni procedimientos que no se desprendan de esos datos.
- recommendedAction: si el estado es GAP o ATTENTION, una acción concreta y verificable antes de la inspección (ej. "cargar la tarea anual de servicio de las 3 balsas listadas, con área Proveedor", no "mejorar el mantenimiento"). Si es OK o INFO, cadena vacía.
- Si la falta es de datos y no del buque (algo que se hace a bordo pero no se registra en el sistema), decilo explícitamente: el inspector pide el registro, no la palabra.
- Tené en cuenta qué clase de buque es: una barcaza tanque sin dotación no tiene tripulación, propulsión ni simulacros propios.
- Español técnico-naval, conciso: narrative 2-4 oraciones, recommendedAction 1-3 oraciones (o vacío).`;

export interface VettingAssessmentInput {
  vesselCode: string;
  groupKey: string;
  /** Opcional. Con metricKey el análisis se enfoca en esa métrica. */
  metricKey?: string;
}

export interface VettingAssessment {
  narrative: string;
  recommendedAction: string;
}

export async function suggestVettingAssessment(
  session: TenantAccessSession,
  input: VettingAssessmentInput,
): Promise<VettingAssessment> {
  requireAuditPanelAccess(session);
  const vesselCode = String(input.vesselCode ?? "").trim();
  const groupKey = String(input.groupKey ?? "").trim();
  const metricKey = String(input.metricKey ?? "").trim();
  // vesselCode vacío es válido: es el bloque consolidado de flota.
  if (!groupKey) throw new RouteError(400, "VALIDATION_ERROR", "Faltan parámetros.");

  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", `${aiApiKeyName()} no esta configurada.`);
  await assertAiBudgetAvailableBySlug(session.tenantSlug);

  const evidence = await getVettingBiqEvidence(session, vesselCode || null);
  const vessel = evidence.items.find(v => v.vesselCode === vesselCode);
  const group = vessel?.groups.find(g => g.key === groupKey);
  if (!vessel || !group) throw new RouteError(404, "NOT_FOUND", "No se encontró el bloque de vetting solicitado.");
  const metric = metricKey ? group.metrics.find(m => m.key === metricKey) : undefined;

  const label = (key: string) => ownMetricLabel(key) ?? TMSA_METRIC_LABEL[key] ?? key;
  const fmtMetric = (m: { value: number; kind: string }) => m.kind === "pct" ? `${Math.round(m.value * 100)}%` : String(m.value);
  const metricsLines = group.metrics.map(m => `- ${label(m.key)}: ${fmtMetric(m)}`).join("\n");

  const SAMPLE_METRICS = 3;
  const SAMPLE_ITEMS = metricKey ? 15 : 8;
  const detailKeys = metricKey
    ? [metricKey]
    : group.metrics.filter(m => m.kind === "count" && m.value > 0).slice(0, SAMPLE_METRICS).map(m => m.key);
  const details = await Promise.all(detailKeys.map(async key => ({
    key,
    detail: await getVettingMetricDetail(session, vesselCode, key),
  })));
  const sampleBlocks = details.map(({ key, detail }) => {
    const sample = detail.items.slice(0, SAMPLE_ITEMS);
    const lines = sample.length > 0
      ? sample.map(it => `- ${it.code} — ${it.label}${it.sublabel ? ` (${it.sublabel})` : ""}`).join("\n")
      : "(sin elementos)";
    return `Muestra de "${label(key)}" (${detail.items.length} en total, mostrando hasta ${SAMPLE_ITEMS}):\n${lines}`;
  });

  // Contexto del buque (remolcador tripulado / barcaza sin gente): lo resuelve
  // el servicio, nunca el caller. En el bloque de flota se describe la mezcla.
  const vesselContext = vesselCode
    ? await getVesselAiContext(session.tenantSlug, vesselCode)
    : `Flota de ${vessel.vesselCount} buques: ${vessel.crewedCount} con dotación (remolcadores) y ${vessel.uncrewedCount} sin dotación (barcazas).`;
  const chapter = CHAPTER_TEXT[group.chapter];
  const userContent = [
    `Buque: ${vessel.vesselName}`,
    ...(vesselContext ? [`Sobre el buque: ${vesselContext}`] : []),
    `Capítulo ${group.chapter} del BIQ5 (${chapter.title}), preguntas ${group.questions}. Qué mira el inspector: ${chapter.what}`,
    `Bloque de evidencia "${OWN_GROUP_TITLE[group.key] ?? TMSA_GROUP_TITLE[group.key] ?? group.key}" — estado actual: ${group.status}`,
    `Métricas del bloque:\n${metricsLines}`,
    metricKey
      ? `Métrica puntual consultada: ${label(metricKey)}${metric ? ` = ${fmtMetric(metric)}` : ""}`
      : `Alcance del análisis: el bloque completo (todas sus métricas), no una métrica puntual.`,
    ...(sampleBlocks.length > 0 ? sampleBlocks : ["(sin elementos concretos para muestrear)"]),
  ].join("\n\n");

  const client = createAiClient({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);
  const feature = "vetting_assessment_suggestion";

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: ASSESSMENT_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools: [ASSESSMENT_TOOL],
      tool_choice: { type: "tool", name: "vetting_assessment" },
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${userContent}` }],
    });
    log.info(`[${feature}] Claude responded in ${Date.now() - aiStarted}ms (in=${response.usage.input_tokens} out=${response.usage.output_tokens})`);
  } catch (err) {
    log.error(`[${feature}] Anthropic call failed after ${Date.now() - aiStarted}ms:`, err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo generar el análisis con IA.");
  }

  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId: tenant.id,
      tenantSlug: session.tenantSlug,
      userId: session.user.id,
      userEmail: session.user.email,
      vesselCode,
      feature,
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - aiStarted,
    });
  })().catch(() => { /* swallow */ });

  const toolBlock = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolBlock) throw new RouteError(502, "AI_CALL_FAILED", "La IA no devolvió un análisis estructurado.");
  const out = toolBlock.input as Partial<VettingAssessment>;
  return {
    narrative: String(out.narrative ?? "").trim(),
    recommendedAction: String(out.recommendedAction ?? "").trim(),
  };
}
