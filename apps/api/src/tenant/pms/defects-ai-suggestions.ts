// IA contextual para defectos.
// Patrón estándar (mismo wrapper que work-orders-ai-suggestions y
// drills-ai-suggestions): timeout, recordAiUsage, model haiku.

import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

const MODEL = "claude-haiku-4-5-20251001";

const SEVERITY_LABEL: Record<string, string> = {
  CRITICAL: "Critica - riesgo inmediato a seguridad/medio ambiente",
  MAJOR:    "Mayor - afecta operacion pero no es inmediato",
  MINOR:    "Menor - cosmetico o desgaste normal",
};

const OP_STATE_LABEL: Record<string, string> = {
  OPERATIONAL:          "Operacional (equipo funcionando normalmente)",
  OPERATIONAL_LIMITED:  "Operativo con limitacion (degradado)",
  NON_OPERATIONAL:      "No operativo (fuera de servicio)",
};

const PROMPT_IMMEDIATE_ACTION = `Sos experto en mantenimiento naval / superintendente de flota. Te van a pasar un defecto recien reportado y tenés que sugerir la ACCION INMEDIATA — la medida de contencion que la tripulacion debe tomar AHORA para mitigar el riesgo mientras se planifica la reparacion definitiva.

Distingui claramente entre:
- ACCION INMEDIATA (lo que pedi vos): medidas de contencion temporales que se toman antes de la OT formal. Ejemplos: aislar el sistema, instalar bypass, derate de potencia, prohibir operacion del equipo, izar bandera de aviso, retirar del servicio, sustituir por equipo de respaldo, recolectar derrame.
- ACCION CORRECTIVA (NO es lo que pedis vos): el plan de reparacion definitivo.

REGLAS DE FORMATO:
- Texto plano, sin Markdown, sin code fence, sin introduccion.
- Entre 3 y 6 bullets cortos, cada uno empezando con "- " y un VERBO IMPERATIVO ACCIONABLE en infinitivo o imperativo ("Aislar...", "Instalar...", "Retirar del servicio...").
- Maximo 15 palabras por bullet. Especifico, no generico ("verificar correcto funcionamiento" no sirve).
- Si la severidad es CRITICAL, el primer bullet debe ser de seguridad (LOTO, evacuar, contener).
- Si el estado es NON_OPERATIONAL, no incluyas bullets que asuman que el equipo sigue corriendo.

NO incluyas:
- Disclaimers tipo "Aqui tenes...".
- La accion correctiva final (eso es otro campo).
- RCA, causa raiz, ni preventivas.

Respondé ÚNICAMENTE con los bullets.`;

export interface ImmediateActionInput {
  description: string;
  severity?: string | null;
  operationalState?: string | null;
  assetLabel?: string | null;
  vesselCode?: string | null;
}

async function callClaude(
  session: TenantAccessSession,
  feature: string,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no esta configurada.");

  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const aiStarted = Date.now();

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
    log.info(`[${feature}] Claude responded in ${Date.now() - aiStarted}ms (in=${response.usage.input_tokens} out=${response.usage.output_tokens})`);
  } catch (err) {
    log.error(`[${feature}] Anthropic call failed after ${Date.now() - aiStarted}ms:`, err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo obtener sugerencia de la IA.");
  }

  (async () => {
    const prisma = getPrismaClient();
    if (!prisma) return;
    const tenant = await (prisma as unknown as { tenant: { findUnique(a: unknown): Promise<{ id: string } | null> } }).tenant.findUnique({
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
      feature,
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - aiStarted,
    });
  })().catch(() => { /* swallow */ });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();
}

// ─── Análisis de fotos con Claude Vision ────────────────────────────────────

const PROMPT_PHOTO_ANALYSIS = `Sos un superintendente experto en mantenimiento de máquinas navales analizando una foto de un defecto recién reportado a bordo. Tu trabajo es describir tecnicamente lo que VES en la imagen, en lenguaje profesional, para enriquecer el reporte del defecto.

REGLAS:
- Texto plano, sin Markdown, sin code fence, sin introduccion.
- Una redaccion corta y tecnica: 2 a 4 oraciones, maximo 80 palabras.
- Describi: que componente se ve, que tipo de dano/falla se identifica (corrosion, fractura, fuga, deformacion, fisura, sobrecalentamiento, contaminacion, desgaste), su localizacion en el componente y su severidad aparente.
- Si la foto muestra valores numericos (manometro, termometro, voltimetro, escala), citalos.
- Si no podes identificar el equipo con certeza, decilo en una linea ("Equipo no identificable con claridad en la foto") y describi solo el dano visible.
- Si la imagen no muestra un defecto claro (foto borrosa, generica, sin sintoma visible), respondé "La imagen no permite identificar un defecto concreto."

NO incluyas:
- Recomendaciones de reparacion (eso es otro campo).
- Causa raiz.
- Disclaimers ni introducciones tipo "En la foto se observa...".
- Negociacion ni preguntas al usuario.

Respondé ÚNICAMENTE con la descripcion tecnica.`;

export interface PhotoAnalysisInput {
  imageBase64: string;            // "data:image/jpeg;base64,..." o raw base64
  mimeType?: string;              // requerido si imageBase64 no incluye data URL
  existingDescription?: string;   // contexto: lo que el usuario ya tipeó
  assetLabel?: string | null;     // contexto: nombre del equipo
}

const VISION_MIME_OK = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function parseDataUrl(input: string, fallbackMime: string | undefined): { mediaType: string; data: string } {
  const m = /^data:([^;]+);base64,(.+)$/.exec(input);
  if (m) {
    return { mediaType: m[1], data: m[2] };
  }
  // Raw base64 sin prefijo
  return { mediaType: fallbackMime ?? "image/jpeg", data: input };
}

export async function analyzeDefectPhoto(
  session: TenantAccessSession,
  input: PhotoAnalysisInput,
): Promise<{ text: string }> {
  const { mediaType, data } = parseDataUrl(input.imageBase64 ?? "", input.mimeType);
  if (!data) throw new RouteError(400, "VALIDATION_ERROR", "Falta la imagen para analizar.");
  if (!VISION_MIME_OK.has(mediaType)) {
    throw new RouteError(400, "VALIDATION_ERROR", `Tipo de imagen no soportado: ${mediaType}`);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no esta configurada.");

  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const feature = "defect_photo_analysis";

  const contextLines = [
    input.assetLabel ? `Equipo afectado: ${input.assetLabel}` : null,
    input.existingDescription?.trim() ? `Descripcion previa que escribió el usuario: ${input.existingDescription.trim()}` : null,
    "Analizá la imagen adjunta siguiendo las reglas del system prompt.",
  ].filter(Boolean).join("\n");

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: PROMPT_PHOTO_ANALYSIS,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data } },
          { type: "text",  text: contextLines },
        ],
      }],
    });
    log.info(`[${feature}] Claude responded in ${Date.now() - aiStarted}ms (in=${response.usage.input_tokens} out=${response.usage.output_tokens})`);
  } catch (err) {
    log.error(`[${feature}] Anthropic call failed after ${Date.now() - aiStarted}ms:`, err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo analizar la imagen con la IA.");
  }

  // Telemetría no bloqueante
  (async () => {
    const prisma = getPrismaClient();
    if (!prisma) return;
    const tenant = await (prisma as unknown as { tenant: { findUnique(a: unknown): Promise<{ id: string } | null> } }).tenant.findUnique({
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
      feature,
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

export async function suggestImmediateAction(
  session: TenantAccessSession,
  input: ImmediateActionInput,
): Promise<{ text: string }> {
  const desc = String(input.description ?? "").trim();
  if (!desc) throw new RouteError(400, "VALIDATION_ERROR", "Falta la descripcion del defecto para sugerir una accion inmediata.");

  const severityKey = String(input.severity ?? "").toUpperCase();
  const opStateKey  = String(input.operationalState ?? "").toUpperCase();

  const lines = [
    `Descripcion del defecto: ${desc}`,
    `Severidad: ${SEVERITY_LABEL[severityKey] ?? severityKey ?? "no especificada"}`,
    `Estado operacional: ${OP_STATE_LABEL[opStateKey] ?? opStateKey ?? "no especificado"}`,
    input.assetLabel ? `Equipo afectado: ${input.assetLabel}` : null,
    input.vesselCode ? `Buque: ${input.vesselCode}` : null,
  ].filter(Boolean).join("\n");

  const text = await callClaude(
    session,
    "defect_immediate_action_suggestion",
    PROMPT_IMMEDIATE_ACTION,
    lines,
    500,
  );
  return { text };
}
