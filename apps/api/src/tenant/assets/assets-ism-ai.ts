import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `Sos experto en ISM Code (International Safety Management) aplicado a buques.

ISM 10.3 exige identificar "equipos cuya falla súbita puede provocar situaciones peligrosas". Estos son los equipos SAFETY-CRITICAL — separados de la criticidad operacional.

Casos típicos de equipo safety-critical en buques:
- Sistemas de gobierno y propulsión emergencia
- Sistemas contraincendio (bombas CI principales y de emergencia, detección, supresión)
- Sistemas de salvamento (botes salvavidas, balsas, MOB, lanzamientos)
- Sistema de achique de emergencia / bombas de sentina
- Generadores y switchboards de emergencia
- Sistemas de detección de gases tóxicos / explosivos
- Sistemas de comunicación GMDSS (radio salvamento)
- Iluminación de emergencia
- Equipos de cierre estanco automático
- Sistemas de alarma general

Casos típicos NO safety-critical (operacional pero no riesgo a vidas):
- Compresores principales de servicio
- Equipos de cocina, lavandería, AC confort
- Bombas de carga (excepto si afectan estabilidad)
- Equipos de comunicación NO-GMDSS

Pista: el SFI 700 (Sistemas auxiliares para máquinas) y 800 (sistemas eléctricos) tienen ambos casos. SFI 770 (contraincendio) y 850 (emergencia) son típicamente ISM-críticos.

Respondé EXCLUSIVAMENTE con un JSON válido (sin markdown, sin texto extra):
{"isSafetyCritical": true | false, "rationale": "1-2 oraciones técnicas explicando por qué"}`;

interface SuggestInput {
  name: string;
  vesselCode?: string | null;
  sfiCode?: string | null;
  manufacturer?: string | null;
  model?: string | null;
}

export interface IsmSuggestResult {
  isSafetyCritical: boolean;
  rationale: string;
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function suggestAssetIsmFlag(
  session: TenantAccessSession,
  input: SuggestInput,
): Promise<IsmSuggestResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

  const name = (input.name ?? "").trim();
  if (!name) throw new RouteError(400, "VALIDATION_ERROR", "El nombre del equipo es requerido.");

  const payload = {
    name,
    vesselCode: input.vesselCode ?? null,
    sfiCode: input.sfiCode ?? null,
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
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
    log.error("[suggestAssetIsmFlag] Anthropic call failed:", err);
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
      feature: "asset_ism_suggestion",
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

  const isSafetyCritical = Boolean(parsed?.isSafetyCritical);
  const rationale = String(parsed?.rationale ?? "").trim();
  if (!rationale) {
    throw new RouteError(502, "AI_PARSE_ERROR", "Falta el fundamento.");
  }

  return { isSafetyCritical, rationale };
}
