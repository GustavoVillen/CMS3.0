// IA para reescribir texto técnico-operativo (deficiencias, observaciones)
// con redacción profesional. Mantiene los hechos, mejora la forma.

import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction } from "../ai/ai-locale";

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `Sos experto en redacción técnica para mantenimiento naval/marítimo.

Te paso un texto que un técnico escribió describiendo deficiencias o problemas encontrados durante una inspección/reparación. Tu tarea es REESCRIBIRLO con redacción profesional, manteniendo TODOS los hechos pero mejorando la forma.

Reglas:
- Conservar TODOS los datos, equipos, síntomas y observaciones del original. NO inventar nada que no esté.
- Corregir ortografía, gramática y puntuación.
- Usar terminología técnica naval correcta cuando aplique (ej. "extractor" → "extractor / ventilador", "no encendia" → "no respondía a la activación").
- Estilo conciso, claro, en tercera persona o impersonal (no "yo vi", sino "se observó").
- Estructurar en oraciones cortas, separadas por punto. Si hay múltiples síntomas, listarlos con viñetas usando "-".
- Si el texto sugiere causa probable o riesgo, mencionarlo de forma neutra (ej. "olor eléctrico quemado sugiere posible cortocircuito o sobrecalentamiento del motor").
- Si el texto está MUY VACÍO o ambiguo (1-2 palabras), devolver lo mismo y agregar un comentario "[texto insuficiente para análisis]".

Respondé EXCLUSIVAMENTE con un JSON válido (sin markdown, sin texto extra):
{"rewritten": "texto reescrito profesionalmente"}`;

interface RewriteInput {
  text: string;
  assetName?: string | null;
}

export interface RewriteResult {
  rewritten: string;
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function rewriteDeficiencies(
  session: TenantAccessSession,
  input: RewriteInput,
): Promise<RewriteResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

  const text = (input.text ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", "El texto a reescribir está vacío.");
  if (text.length > 4000) {
    throw new RouteError(400, "TEXT_TOO_LONG", "El texto excede 4000 caracteres.");
  }

  const payload = {
    activo: input.assetName ?? null,
    texto_original: text,
  };

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
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
    });
  } catch (err) {
    log.error("[rewriteDeficiencies] Anthropic call failed:", err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo obtener reescritura de la IA.");
  }

  // Telemetría no bloqueante (tenant cacheado).
  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId: tenant.id,
      tenantSlug: session.tenantSlug,
      userId: session.user.id,
      userEmail: session.user.email,
      vesselCode: null,
      feature: "wo_rewrite_deficiencies",
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - aiStarted,
    });
  })().catch(() => { /* swallow */ });

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch {
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió una respuesta inválida.");
  }

  const rewritten = String(parsed?.rewritten ?? "").trim();
  if (!rewritten) {
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA no devolvió texto reescrito.");
  }

  return { rewritten };
}
