import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";

const MODEL = "claude-haiku-4-5-20251001";

const PROMPT_COMPENSATORY = `Sos experto en gestión de mantenimiento naval. Proponé directamente medidas compensatorias concretas, verificables y específicas al activo y al tipo de tarea aplazada, para mitigar el riesgo operacional mientras dure el aplazamiento. Las medidas deben ser prácticas, ejecutables por la tripulación, y enfocadas en monitoreo, controles operativos y planes de contingencia.

NO hagas preguntas: con la información provista alcanza para proponer medidas razonables. Respondé ÚNICAMENTE con las medidas compensatorias en formato de lista numerada, en texto plano, sin introducción ni explicación adicional.`;

interface CompensatoryInput {
  deferralCode?: string | null;
  vesselCode?: string | null;
  assetLabel?: string | null;
  sourceTypeLabel?: string | null;
  sourceDisplayName?: string | null;
  targetDate?: string | null;
  justification?: string | null;
}

function buildContext(input: CompensatoryInput): string {
  const lines = ["Aplazamiento de mantenimiento (CONTEXTO COMPLETO — no preguntes información que ya está abajo):"];
  if (input.deferralCode) lines.push(`- Código del aplazamiento: ${input.deferralCode}`);
  if (input.vesselCode) lines.push(`- Buque: ${input.vesselCode}`);
  if (input.assetLabel) lines.push(`- Activo afectado: ${input.assetLabel}`);
  if (input.sourceTypeLabel) lines.push(`- Tipo de origen: ${input.sourceTypeLabel}`);
  if (input.sourceDisplayName) lines.push(`- Origen específico: ${input.sourceDisplayName}`);
  lines.push(`- Fecha objetivo del aplazamiento: ${input.targetDate ?? "no especificada"}`);
  lines.push(`- Justificación del solicitante: ${input.justification ?? "No especificada"}`);
  return lines.join("\n");
}

export async function suggestCompensatoryMeasures(
  session: TenantAccessSession,
  input: CompensatoryInput,
): Promise<{ text: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: PROMPT_COMPENSATORY, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${buildContext(input)}` }],
    });
  } catch (err) {
    log.error("[suggestCompensatoryMeasures] Anthropic call failed:", err);
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
      vesselCode: input.vesselCode ?? null,
      feature: "deferral_compensatory_measures_suggestion",
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

// ── Análisis de riesgo del DIFERIMIENTO ──────────────────────────────────────
// A diferencia del riesgo de ejecución (HSE/JSA) del Plan, acá se evalúa el
// riesgo de SEGUIR OPERANDO con la condición diferida hasta la fecha objetivo.
const PROMPT_DEFERRAL_RISK = `Sos experto en gestión de riesgo operacional naval (SOLAS/ISM). Vas a evaluar el riesgo de POSTERGAR (diferir) la tarea/condición indicada, es decir el riesgo de SEGUIR OPERANDO el buque con esa condición sin resolver hasta la fecha objetivo. NO evalúes el riesgo de ejecutar la tarea: evaluá la consecuencia y probabilidad de que la condición diferida derive en una falla/incidente mientras el aplazamiento esté activo, considerando el activo afectado, el tipo de tarea y el horizonte temporal.

Usá una matriz de probabilidad × consecuencia:
- PROBABILIDAD: LIKELY (muy probable) | PROBABLE | UNLIKELY (improbable) | RARE (altamente improbable)
- CONSECUENCIA: FATALITY (fatalidad) | MAJOR (lesiones importantes / daño grave) | MINOR (lesiones leves / daño menor) | NEGLIGIBLE (insignificante)

Respondé EXACTAMENTE en este formato (las tres primeras líneas obligatorias, en mayúsculas y en inglés los enums), seguidas del análisis en texto plano (3 a 5 bullets cortos, foco en el riesgo de operar diferido y disparadores a vigilar):
NIVEL: LOW|MEDIUM|HIGH|CRITICAL
PROBABILIDAD: LIKELY|PROBABLE|UNLIKELY|RARE
CONSECUENCIA: FATALITY|MAJOR|MINOR|NEGLIGIBLE

- [riesgo/consecuencia principal de seguir operando → disparador a vigilar]
- [...]

NO hagas preguntas: con la información provista alcanza para una evaluación razonable.`;

export interface DeferralRiskResult {
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  probability: "LIKELY" | "PROBABLE" | "UNLIKELY" | "RARE" | null;
  consequence: "FATALITY" | "MAJOR" | "MINOR" | "NEGLIGIBLE" | null;
  analysis: string;
}

export async function suggestDeferralRisk(
  session: TenantAccessSession,
  input: CompensatoryInput,
): Promise<DeferralRiskResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: PROMPT_DEFERRAL_RISK, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${buildContext(input)}` }],
    });
  } catch (err) {
    log.error("[suggestDeferralRisk] Anthropic call failed:", err);
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
      vesselCode: input.vesselCode ?? null,
      feature: "deferral_risk_analysis_suggestion",
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

  const levelMatch = raw.match(/^NIVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL)/im);
  const level = (levelMatch?.[1] ?? "").toUpperCase() as DeferralRiskResult["level"];
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(level)) {
    throw new RouteError(502, "AI_PARSE_ERROR", "Nivel de riesgo inválido o ausente.");
  }
  const probMatch = raw.match(/^PROBABILIDAD:\s*(LIKELY|PROBABLE|UNLIKELY|RARE)/im);
  const consMatch = raw.match(/^CONSECUENCIA:\s*(FATALITY|MAJOR|MINOR|NEGLIGIBLE)/im);
  const probability = (probMatch?.[1]?.toUpperCase() ?? null) as DeferralRiskResult["probability"];
  const consequence = (consMatch?.[1]?.toUpperCase() ?? null) as DeferralRiskResult["consequence"];
  const analysis = raw
    .replace(/^NIVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL).*$/im, "")
    .replace(/^PROBABILIDAD:\s*(LIKELY|PROBABLE|UNLIKELY|RARE).*$/im, "")
    .replace(/^CONSECUENCIA:\s*(FATALITY|MAJOR|MINOR|NEGLIGIBLE).*$/im, "")
    .trim();

  return { level, probability, consequence, analysis };
}
