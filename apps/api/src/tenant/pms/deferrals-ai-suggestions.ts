import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

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

  const client = new Anthropic({ apiKey });
  const aiStarted = Date.now();

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: PROMPT_COMPENSATORY,
      messages: [{ role: "user", content: buildContext(input) }],
    });
  } catch (err) {
    log.error("[suggestCompensatoryMeasures] Anthropic call failed:", err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo obtener sugerencia de la IA.");
  }

  // Telemetría no bloqueante
  (async () => {
    const prisma = getPrismaClient();
    if (!prisma) return;
    const tenant = await (prisma as any).tenant.findUnique({
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
