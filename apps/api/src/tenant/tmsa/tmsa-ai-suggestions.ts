// TMSA Elemento 4 — borrador de autoevaluación asistido por IA.
//
// El panel TMSA es "solo lectura, evidencia objetiva" — no calcula un nivel
// TMSA oficial (eso lo autoevalúa la compañía). Esta función NO cambia esa
// regla: genera un BORRADOR de explicación/recomendación en base a los datos
// ya calculados por tmsa-service.ts, para que el responsable de compliance lo
// revise y ajuste antes de usarlo en la autoevaluación real. Mismo patrón que
// suggestMocDraft (moc-ai-suggestions.ts) y suggestDefectRca
// (defects-ai-suggestions.ts): tool-use forzado, una sola llamada, sin loop
// agéntico.

import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { getTmsaMaintenanceEvidence, getTmsaMetricDetail } from "./tmsa-service";

const MODEL = "claude-haiku-4-5-20251001";

const ASSESSMENT_TOOL: Anthropic.Tool = {
  name: "tmsa_assessment",
  description: "Registra el borrador de análisis de autoevaluación para este sub-requisito TMSA.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      narrative: { type: "string", description: "Explicación breve de qué muestra el dato y por qué, basada solo en los datos provistos." },
      recommendedAction: { type: "string", description: "Acción concreta recomendada para cerrar la brecha. Cadena vacía si el estado es OK/INFO y no aplica." },
    },
    required: ["narrative", "recommendedAction"],
  },
};

const ASSESSMENT_PROMPT = `Sos un asistente de compliance/vetting TMSA (Elemento 4 — Reliability & Maintenance) de un PMS marítimo. Te paso datos OBJETIVOS ya calculados por el sistema (no una opinión) sobre un sub-requisito TMSA de un buque puntual. Tu trabajo es redactar un BORRADOR de análisis para que el responsable de compliance de la compañía lo revise antes de usarlo en su autoevaluación TMSA — vos NO determinás el nivel de cumplimiento oficial, solo explicás el dato.

Reglas:
- Registrá el resultado ÚNICAMENTE mediante la herramienta "tmsa_assessment".
- narrative: explicá qué significa el número/estado y por qué salió así, basándote SOLO en los datos provistos (métricas del grupo + muestra de elementos concretos que lo componen). No inventes causas que no se desprendan de esos datos.
- recommendedAction: si el estado es GAP o ATTENTION, una acción concreta y accionable para cerrarlo (ej. "asignar plan de mantenimiento a los activos listados", no "mejorar el mantenimiento"). Si el estado es OK o INFO y no hay nada que corregir, dejar cadena vacía.
- Español técnico-naval, conciso: narrative 2-4 oraciones, recommendedAction 1-3 oraciones (o vacío).`;

export interface TmsaAssessmentInput {
  vesselCode: string;
  groupKey: string;
  metricKey: string;
}

export interface TmsaAssessment {
  narrative: string;
  recommendedAction: string;
}

export async function suggestTmsaAssessment(
  session: TenantAccessSession,
  input: TmsaAssessmentInput,
): Promise<TmsaAssessment> {
  const vesselCode = String(input.vesselCode ?? "").trim();
  const groupKey = String(input.groupKey ?? "").trim();
  const metricKey = String(input.metricKey ?? "").trim();
  if (!vesselCode || !groupKey || !metricKey) throw new RouteError(400, "VALIDATION_ERROR", "Faltan parámetros.");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no esta configurada.");
  await assertAiBudgetAvailableBySlug(session.tenantSlug);

  const [evidence, detail] = await Promise.all([
    getTmsaMaintenanceEvidence(session, vesselCode),
    getTmsaMetricDetail(session, vesselCode, metricKey),
  ]);
  const vessel = evidence.items.find(v => v.vesselCode === vesselCode);
  const group = vessel?.groups.find(g => g.key === groupKey);
  if (!vessel || !group) throw new RouteError(404, "NOT_FOUND", "No se encontró el grupo TMSA solicitado.");
  const metric = group.metrics.find(m => m.key === metricKey);

  const fmtMetric = (m: { value: number; kind: string }) => m.kind === "pct" ? `${Math.round(m.value * 100)}%` : String(m.value);
  const metricsLines = group.metrics.map(m => `- ${m.key}: ${fmtMetric(m)}`).join("\n");
  const sample = detail.items.slice(0, 15);
  const sampleLines = sample.length > 0
    ? sample.map(it => `- ${it.code} — ${it.label}${it.sublabel ? ` (${it.sublabel})` : ""}`).join("\n")
    : "(sin elementos)";

  const userContent = [
    `Buque: ${vessel.vesselName} (${vessel.vesselCode})`,
    `Sub-requisito TMSA ${group.element} — grupo "${group.key}" — estado actual: ${group.status}`,
    `Métricas del grupo:\n${metricsLines}`,
    `Métrica puntual consultada: ${metricKey}${metric ? ` = ${fmtMetric(metric)}` : ""}`,
    `Muestra de elementos que componen esta métrica (${detail.items.length} en total, mostrando hasta 15):\n${sampleLines}`,
  ].join("\n\n");

  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);
  const feature = "tmsa_assessment_suggestion";

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
      tool_choice: { type: "tool", name: "tmsa_assessment" },
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
  const out = toolBlock.input as Partial<TmsaAssessment>;
  return {
    narrative: String(out.narrative ?? "").trim(),
    recommendedAction: String(out.recommendedAction ?? "").trim(),
  };
}
