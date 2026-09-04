// Código ISM Cap. 10 — borrador de análisis de auditoría asistido por IA.
//
// Mismo contrato que suggestTmsaAssessment (tool-use forzado, una sola llamada,
// sin loop agéntico), pero con el marco correcto: acá el interlocutor no es un
// inspector de vetting comercial sino un auditor del Sistema de Gestión de la
// Seguridad (interno, de la Administración de bandera o de la Organización
// Reconocida), y lo que se redacta es el respaldo de una cláusula del Código,
// no una autoevaluación TMSA.
//
// La IA NO declara conformidad: explica el dato objetivo y propone la acción.

import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { getVesselAiContext } from "../ai/vessel-ai-context";
import { getIsmChapter10Evidence, getIsmMetricDetail } from "./ism-service";
import { requireAuditPanelAccess } from "../tmsa/tmsa-service";

const MODEL = AI_MODEL.fast;

/** Enunciado del Código por cláusula: se le pasa a la IA como marco. */
const CLAUSE_TEXT: Record<string, string> = {
  "10.1": "La Compañía debe establecer procedimientos para asegurar que el buque se mantiene de conformidad con las reglas y reglamentos pertinentes y con cualquier requisito adicional que establezca la Compañía.",
  "10.2.1": "Las inspecciones se realizan a intervalos apropiados.",
  "10.2.2": "Toda no conformidad se notifica, indicando su posible causa, si se conoce.",
  "10.2.3": "Se adoptan las medidas correctivas apropiadas.",
  "10.2.4": "Se conserva registro de estas actividades.",
  "10.3": "La Compañía identifica el equipo y los sistemas técnicos cuyo fallo repentino pueda ocasionar situaciones peligrosas, y prevé medidas para promover su fiabilidad, incluida la prueba periódica de equipos de reserva o no usados de forma continua.",
  "10.4": "Las inspecciones de 10.2 y las medidas de 10.3 se integran en las operaciones ordinarias de mantenimiento del buque.",
};

const ASSESSMENT_TOOL: Anthropic.Tool = {
  name: "ism_assessment",
  description: "Registra el borrador de análisis de evidencia para esta cláusula del Capítulo 10 del Código ISM.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      narrative: { type: "string", description: "Qué muestra la evidencia respecto de la cláusula, basado sólo en los datos provistos." },
      recommendedAction: { type: "string", description: "Acción concreta para cerrar la brecha frente a la cláusula. Cadena vacía si el estado es OK/INFO." },
    },
    required: ["narrative", "recommendedAction"],
  },
};

const ASSESSMENT_PROMPT = `Sos un asistente de auditoría del Sistema de Gestión de la Seguridad (SGS) de una naviera, especializado en el Capítulo 10 del Código ISM (Mantenimiento del buque y el equipo). Te paso el enunciado de una cláusula y datos OBJETIVOS ya calculados por el PMS sobre un buque puntual. Redactás un BORRADOR de análisis para que el responsable del SGS lo revise antes de una auditoría interna o de bandera.

Reglas:
- Registrá el resultado ÚNICAMENTE mediante la herramienta "ism_assessment".
- NO declares conformidad ni no conformidad formal con el Código: eso lo determina el auditor. Explicá qué respalda y qué no respalda la evidencia disponible.
- narrative: relacioná el dato con lo que pide LA CLÁUSULA citada, basándote SOLO en los datos provistos (métricas + muestra de registros concretos). No inventes causas ni procedimientos que no se desprendan de esos datos.
- recommendedAction: si el estado es GAP o ATTENTION, una acción concreta y verificable para cerrar la brecha (ej. "asignar plan de mantenimiento a los 4 equipos críticos listados", no "mejorar el mantenimiento"). Si es OK o INFO, cadena vacía.
- Si la brecha es de datos y no de operación (algo que el buque hace pero no registra en el sistema), decilo explícitamente: para un auditor, lo que no está registrado no ocurrió.
- Español técnico-naval, conciso: narrative 2-4 oraciones, recommendedAction 1-3 oraciones (o vacío).`;

export interface IsmAssessmentInput {
  vesselCode: string;
  groupKey: string;
  /** Opcional. Con metricKey el análisis se enfoca en esa métrica. */
  metricKey?: string;
}

export interface IsmAssessment {
  narrative: string;
  recommendedAction: string;
}

export async function suggestIsmAssessment(
  session: TenantAccessSession,
  input: IsmAssessmentInput,
): Promise<IsmAssessment> {
  requireAuditPanelAccess(session);
  const vesselCode = String(input.vesselCode ?? "").trim();
  const groupKey = String(input.groupKey ?? "").trim();
  const metricKey = String(input.metricKey ?? "").trim();
  // vesselCode vacío es válido: es el análisis del bloque consolidado de flota
  // (ese item viaja con vesselCode "").
  if (!groupKey) throw new RouteError(400, "VALIDATION_ERROR", "Faltan parámetros.");

  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", `${aiApiKeyName()} no esta configurada.`);
  await assertAiBudgetAvailableBySlug(session.tenantSlug);

  const evidence = await getIsmChapter10Evidence(session, vesselCode || null);
  const vessel = evidence.items.find(v => v.vesselCode === vesselCode);
  const group = vessel?.groups.find(g => g.key === groupKey);
  if (!vessel || !group) throw new RouteError(404, "NOT_FOUND", "No se encontró el grupo ISM solicitado.");
  const metric = metricKey ? group.metrics.find(m => m.key === metricKey) : undefined;

  const fmtMetric = (m: { value: number; kind: string }) => m.kind === "pct" ? `${Math.round(m.value * 100)}%` : String(m.value);
  const metricsLines = group.metrics.map(m => `- ${m.key}: ${fmtMetric(m)}`).join("\n");

  const SAMPLE_METRICS = 3;
  const SAMPLE_ITEMS = metricKey ? 15 : 8;
  const detailKeys = metricKey
    ? [metricKey]
    : group.metrics.filter(m => m.kind === "count" && m.value > 0).slice(0, SAMPLE_METRICS).map(m => m.key);
  const details = await Promise.all(detailKeys.map(async key => ({
    key,
    detail: await getIsmMetricDetail(session, vesselCode, key),
  })));
  const sampleBlocks = details.map(({ key, detail }) => {
    const sample = detail.items.slice(0, SAMPLE_ITEMS);
    const lines = sample.length > 0
      ? sample.map(it => `- ${it.code} — ${it.label}${it.sublabel ? ` (${it.sublabel})` : ""}`).join("\n")
      : "(sin elementos)";
    return `Muestra de elementos de la métrica "${key}" (${detail.items.length} en total, mostrando hasta ${SAMPLE_ITEMS}):\n${lines}`;
  });

  const vesselContext = await getVesselAiContext(session.tenantSlug, vesselCode);
  const userContent = [
    `Buque: ${vessel.vesselName} (${vessel.vesselCode})`,
    ...(vesselContext ? [`Sobre el buque: ${vesselContext}`] : []),
    `Cláusula ISM ${group.clause}: ${CLAUSE_TEXT[group.clause] ?? "(sin texto)"}`,
    `Bloque de evidencia "${group.key}" — estado actual: ${group.status}`,
    `Métricas del bloque:\n${metricsLines}`,
    metricKey
      ? `Métrica puntual consultada: ${metricKey}${metric ? ` = ${fmtMetric(metric)}` : ""}`
      : `Alcance del análisis: el bloque completo (todas sus métricas), no una métrica puntual.`,
    ...(sampleBlocks.length > 0 ? sampleBlocks : ["(sin elementos concretos para muestrear)"]),
  ].join("\n\n");

  const client = createAiClient({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);
  const feature = "ism_assessment_suggestion";

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
      tool_choice: { type: "tool", name: "ism_assessment" },
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
  const out = toolBlock.input as Partial<IsmAssessment>;
  return {
    narrative: String(out.narrative ?? "").trim(),
    recommendedAction: String(out.recommendedAction ?? "").trim(),
  };
}
