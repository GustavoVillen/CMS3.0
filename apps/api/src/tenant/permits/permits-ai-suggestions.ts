import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { buildPermitTypeRegulationContext } from "../../common/regulations/maritime";

const MODEL = "claude-haiku-4-5-20251001";

const PROMPT_HAZARDS = `Sos experto en HSE marítimo. Identificá los peligros específicos para el trabajo descrito EN ESTE PERMISO.

CONTEXTO REGULATORIO DEL PERMISO:
{TYPE_CONTEXT}

REGLAS DE CONCISIÓN:
- Máximo 6 bullets — solo los peligros REALES y aplicables al trabajo descrito.
- Cada bullet en una línea como "- ".
- Específico y accionable: NO "puede haber riesgo" sino, por ejemplo, "atmósfera potencialmente deficiente en O₂ por descomposición de residuos en el void".
- Mencioná peligros concretos del tipo + peligros DEL LUGAR (sala de máquinas caliente, tanque con residuos, etc.).
- Si citás un umbral cuantitativo, usá los del CONTEXTO REGULATORIO de arriba y ponelo entre paréntesis (ej. "atmósfera inflamable LEL ≥1%, ISGOTT 6 Cap. 11").
- NO INVENTES un número que no esté en el contexto.

Responde ÚNICAMENTE con los bullets en texto plano, sin introducción, sin numeración.`;

const PROMPT_CONTROLS = `Sos experto en HSE marítimo. Definí las medidas de control para mitigar los peligros del trabajo descrito EN ESTE PERMISO.

CONTEXTO REGULATORIO DEL PERMISO:
{TYPE_CONTEXT}

REGLAS DE CONCISIÓN:
- Máximo 6 bullets — las medidas MÁS importantes / críticas.
- Cada bullet en una línea como "- ".
- Cada medida ACCIONABLE: QUÉ hacer y CÓMO verificar. Ej: "- Aislar línea de combustible: cerrar válvula V-12, candado + tarjeta, verificar presión 0 con manómetro".
- Pensá en: aislamientos físicos (LOTO), aislamientos atmosféricos (ventilación, gas test), barreras, procedimientos (briefing, comms, standby), inspección previa.

SOURCING DE NÚMEROS:
- Cualquier umbral cuantitativo (concentración, tiempo, distancia) DEBE coincidir con los del CONTEXTO REGULATORIO. Citá la fuente entre paréntesis.
- NO confundas umbrales: ENTRADA a espacio confinado es LEL <1% (ISGOTT 6 Cap. 11). NO escribas LEL >10% — ese es el threshold de alarma sonora del detector personal, NO el de autorización de entrada.
- Si no hay umbral aplicable en el contexto, describí la medida cualitativamente — no inventes un número.

Responde ÚNICAMENTE con los bullets en texto plano, sin introducción, sin numeración.`;

const PROMPT_PPE = `Sos experto en HSE marítimo. Definí el EPP específico para el trabajo descrito EN ESTE PERMISO.

CONTEXTO REGULATORIO DEL PERMISO:
{TYPE_CONTEXT}

REGLAS DE CONCISIÓN:
- Máximo 6 bullets — solo el EPP REALMENTE necesario, no listado genérico.
- Cada bullet en una línea como "- ".
- Específico: indicá tipo/nivel:
  - "Guantes anticorte nivel 4" en vez de "guantes".
  - "Máscara con suministro de aire externo (línea de aire comprimido certificada)" en vez de "protección respiratoria".
  - "Arnés cuerpo completo 5 puntos con anclaje doble certificado" en vez de "arnés".
- Listá EPP que matchee los peligros y controles. Evitá duplicar EPP genérico (uniforme, casco básico) salvo que el caso lo amerite.
- Si una norma/estándar del CONTEXTO obliga un tipo específico de EPP, citala entre paréntesis.

Responde ÚNICAMENTE con los bullets en texto plano, sin introducción, sin numeración.`;

export interface PermitAiInput {
  type: string;
  location?: string | null;
  description?: string | null;
  hazardsIdentified?: string | null;   // input para controls / PPE
  controlMeasures?: string | null;     // input para PPE
}

function buildContext(input: PermitAiInput, extras: Record<string, string | null | undefined> = {}): string {
  const lines = [
    `Tipo de permiso: ${input.type}`,
    `Ubicación a bordo: ${(input.location ?? "").trim() || "no especificada"}`,
    `Descripción del trabajo: ${(input.description ?? "").trim() || "no especificada"}`,
  ];
  for (const [k, v] of Object.entries(extras)) {
    if (v && v.trim()) lines.push(`${k}: ${v.trim()}`);
  }
  return lines.join("\n");
}

function resolvePrompt(template: string, type: string): string {
  // El bloque de contexto trae thresholds + lista de regulaciones aplicables
  // + la regla "no inventes números, citá la fuente". Es el corazón de la
  // protección anti-alucinación numérica.
  const ctx = buildPermitTypeRegulationContext(type);
  return template.replace("{TYPE_CONTEXT}", ctx);
}

async function callClaude(
  session: TenantAccessSession,
  feature: string,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    });
    log.info(`[${feature}] Claude responded in ${Date.now() - aiStarted}ms (in=${response.usage.input_tokens} out=${response.usage.output_tokens})`);
  } catch (err) {
    log.error(`[${feature}] Anthropic call failed after ${Date.now() - aiStarted}ms:`, err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo obtener sugerencia de la IA.");
  }

  // Telemetría no bloqueante
  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    try {
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
    } catch { /* swallow */ }
  })().catch(() => { /* swallow */ });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();
}

export async function suggestPermitHazards(session: TenantAccessSession, input: PermitAiInput): Promise<{ text: string }> {
  const text = await callClaude(
    session,
    "ptw_hazards_suggestion",
    resolvePrompt(PROMPT_HAZARDS, input.type),
    buildContext(input),
    1024,
  );
  return { text };
}

export async function suggestPermitControls(session: TenantAccessSession, input: PermitAiInput): Promise<{ text: string }> {
  const text = await callClaude(
    session,
    "ptw_controls_suggestion",
    resolvePrompt(PROMPT_CONTROLS, input.type),
    buildContext(input, { "Peligros identificados": input.hazardsIdentified }),
    1024,
  );
  return { text };
}

export async function suggestPermitPpe(session: TenantAccessSession, input: PermitAiInput): Promise<{ text: string }> {
  const text = await callClaude(
    session,
    "ptw_ppe_suggestion",
    resolvePrompt(PROMPT_PPE, input.type),
    buildContext(input, {
      "Peligros identificados": input.hazardsIdentified,
      "Medidas de control": input.controlMeasures,
    }),
    1024,
  );
  return { text };
}
