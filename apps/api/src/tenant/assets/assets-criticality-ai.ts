import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

const SYSTEM_PROMPT = `Sos un experto en mantenimiento y clasificación de equipos en buques.
Te paso los datos de un equipo (asset) y tu tarea es asignarle un nivel de criticidad y justificarlo.

Niveles de criticidad:
- A — Crítico: la falla compromete seguridad, vida humana, navegación, propulsión principal o cumplimiento regulatorio. Requiere redundancia o atención inmediata.
- B — Importante: la falla afecta operación pero hay alternativas o tiempo para reaccionar. Mantenimiento preventivo riguroso.
- C — Estándar: la falla tiene impacto operativo bajo. Mantenimiento básico/correctivo.

Respondé EXCLUSIVAMENTE con un JSON válido (sin markdown, sin texto extra) con esta forma exacta:
{"criticality": "A" | "B" | "C", "rationale": "texto de 1-3 oraciones explicando por qué"}

El "rationale" debe ser técnico, claro y específico al equipo (no genérico). Mencioná el grupo SFI si es relevante.`;

interface SuggestInput {
  name: string;
  vesselCode?: string | null;
  sfiCode?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
}

export interface SuggestResult {
  criticality: "A" | "B" | "C";
  rationale: string;
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function suggestAssetCriticality(
  session: TenantAccessSession,
  input: SuggestInput,
): Promise<SuggestResult> {
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
    serialNumber: input.serialNumber ?? null,
  };

  const client = new Anthropic({ apiKey });
  const model = "claude-haiku-4-5-20251001";
  const aiStarted = Date.now();

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
    });
  } catch (err) {
    log.error("[suggestAssetCriticality] Anthropic call failed:", err);
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
      feature: "asset_criticality_suggestion",
      model,
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

  const crit = String(parsed?.criticality ?? "").toUpperCase();
  if (crit !== "A" && crit !== "B" && crit !== "C") {
    throw new RouteError(502, "AI_PARSE_ERROR", `Criticidad inválida: ${crit}`);
  }
  const rationale = String(parsed?.rationale ?? "").trim();
  if (!rationale) {
    throw new RouteError(502, "AI_PARSE_ERROR", "Falta el fundamento.");
  }

  return { criticality: crit as "A" | "B" | "C", rationale };
}
