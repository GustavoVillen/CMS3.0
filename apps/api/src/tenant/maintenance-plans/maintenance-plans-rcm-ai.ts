import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `Sos experto en RCM (Reliability-Centered Maintenance) aplicado a buques.

RCM clasifica cada plan de mantenimiento por la CONSECUENCIA que mitiga si NO se ejecuta. Hay 4 categorías:

- SAFETY: la falla pone en riesgo a personas (lesión, fatalidad). Ej: bomba CI standby no probada → no arranca en incendio.
- ENVIRONMENTAL: la falla causa daño ambiental (vertido oleoso, emisión, contaminación). Ej: separador OWS no calibrado → descarga sobre 15ppm.
- OPERATIONAL: la falla detiene o degrada operación (paro, retraso, pérdida de carga). Ej: motor principal sin cambio de filtros → derate.
- NON_OPERATIONAL: la falla solo genera costo de reparación, sin impacto en seguridad/ambiente/operación. Ej: pintura de bandejas, cambio de ojos de buey rotos.

La consecuencia debe ser la PEOR plausible si el plan no se hace. Si un mismo plan previene falla con consecuencias múltiples, elegí la más severa: SAFETY > ENVIRONMENTAL > OPERATIONAL > NON_OPERATIONAL.

Te paso el activo + descripción del plan. Respondé EXCLUSIVAMENTE con un JSON válido (sin markdown, sin texto extra):
{"category": "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL", "rationale": "1-2 oraciones técnicas"}`;

interface SuggestInput {
  assetName: string;
  assetSfiCode?: string | null;
  planTitle?: string | null;
  planDescription?: string | null;
}

export interface RcmConsequenceResult {
  category: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL";
  rationale: string;
}

const VALID_CATEGORIES = new Set(["SAFETY", "ENVIRONMENTAL", "OPERATIONAL", "NON_OPERATIONAL"]);

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function suggestPlanConsequence(
  session: TenantAccessSession,
  input: SuggestInput,
): Promise<RcmConsequenceResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

  const assetName = (input.assetName ?? "").trim();
  if (!assetName) throw new RouteError(400, "VALIDATION_ERROR", "El nombre del activo es requerido.");

  const payload = {
    activo: assetName,
    sfi: input.assetSfiCode ?? null,
    plan: input.planTitle ?? null,
    descripcion: input.planDescription ?? null,
  };

  const client = new Anthropic({ apiKey });
  const aiStarted = Date.now();

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
    });
  } catch (err) {
    log.error("[suggestPlanConsequence] Anthropic call failed:", err);
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
      vesselCode: null,
      feature: "plan_rcm_consequence_suggestion",
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

  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió una respuesta inválida.");
  }

  const category = String(parsed?.category ?? "").toUpperCase();
  if (!VALID_CATEGORIES.has(category)) {
    throw new RouteError(502, "AI_PARSE_ERROR", `Categoría inválida: ${category}`);
  }
  const rationale = String(parsed?.rationale ?? "").trim();
  if (!rationale) {
    throw new RouteError(502, "AI_PARSE_ERROR", "Falta el fundamento.");
  }

  return { category: category as RcmConsequenceResult["category"], rationale };
}
