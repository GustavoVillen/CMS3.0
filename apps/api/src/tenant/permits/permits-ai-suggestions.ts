import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

const MODEL = "claude-haiku-4-5-20251001";

const PERMIT_TYPE_CONTEXT: Record<string, string> = {
  HOT_WORK: "TRABAJO EN CALIENTE (soldadura, oxicorte, esmerilado). Riesgos típicos: fuego/explosión, escorias, vapores tóxicos, atmósferas inflamables, quemaduras, deslumbramiento.",
  ENCLOSED_SPACE_ENTRY: "ENTRADA A ESPACIO CONFINADO (tanques, sentinas, pañoles cerrados, voids). Riesgos típicos: atmósfera deficiente en O2, gases tóxicos (H2S, CO), atmósferas inflamables (LEL), atrapamiento, hipertermia, comms perdidas.",
  WORKING_ALOFT: "TRABAJO EN ALTURA (mástiles, antenas, exterior de casco, escaleras de gato). Riesgos típicos: caída de altura, caída de herramientas/personas al agua, exposición climática, viento, contacto con energizados.",
  ELECTRICAL_ISOLATION: "AISLAMIENTO ELÉCTRICO / LOTO. Riesgos típicos: electrocución, arco eléctrico, energización accidental, energía residual (capacitores, UPS), efectos en sistemas críticos al desenergizar.",
};

const PROMPT_HAZARDS = `Sos experto en HSE marítimo. Identificá los peligros específicos para el trabajo descrito EN ESTE PERMISO.

CONTEXTO DEL PERMISO según tipo (úsalo como base obligatoria, no te limites solo a éstos):
{TYPE_CONTEXT}

REGLAS DE CONCISIÓN:
- Máximo 6 bullets — solo los peligros REALES y aplicables al trabajo descrito.
- Cada bullet en una línea como "- ".
- Específico y accionable: NO "puede haber riesgo" sino "concentración H2S esperable >50 ppm por restos de combustible".
- Mencioná peligros concretos del tipo (atmósfera deficiente, fuego, caída, electrocución) + peligros DEL LUGAR (sala de máquinas caliente, tanque con residuos, etc.).

Responde ÚNICAMENTE con los bullets en texto plano, sin introducción, sin numeración.`;

const PROMPT_CONTROLS = `Sos experto en HSE marítimo. Definí las medidas de control para mitigar los peligros del trabajo descrito EN ESTE PERMISO.

CONTEXTO DEL PERMISO según tipo:
{TYPE_CONTEXT}

REGLAS DE CONCISIÓN:
- Máximo 6 bullets — las medidas MÁS importantes / críticas.
- Cada bullet en una línea como "- ".
- Cada medida debe ser ACCIONABLE: indicá QUÉ hacer y CÓMO verificar. Ej: "- Aislar línea de combustible: cerrar válvula V-12, candado + tarjeta, verificar presión 0 con manómetro" en vez de "asegurar líneas".
- Pensá en: aislamientos físicos (LOTO), aislamientos atmosféricos (ventilación, gas test), barreras (mantas ignífugas, rebordes), procedimientos (briefing, comms, standby), inspección previa (gas test, lecturas).

Responde ÚNICAMENTE con los bullets en texto plano, sin introducción, sin numeración.`;

const PROMPT_PPE = `Sos experto en HSE marítimo. Definí el EPP (Equipo de Protección Personal) específico para el trabajo descrito EN ESTE PERMISO.

CONTEXTO DEL PERMISO según tipo:
{TYPE_CONTEXT}

REGLAS DE CONCISIÓN:
- Máximo 6 bullets — solo el EPP REALMENTE necesario, no listado genérico exhaustivo.
- Cada bullet en una línea como "- ".
- Específico: indicá tipo/nivel, no genérico. Ej:
  - "Guantes anticorte nivel 4" en vez de "guantes".
  - "Máscara con suministro de aire externo" en vez de "protección respiratoria".
  - "Arnés cuerpo completo 5 puntos con anclaje doble" en vez de "arnés".
  - "Gafas anti-impacto + careta para chispas" en vez de "protección ocular".
- Listá EPP que matchee los peligros concretos del trabajo y las medidas de control sugeridas, evitando duplicar EPP genérico ya implícito (uniforme, calzado de seguridad básico) salvo que el caso lo amerite.

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
  const ctx = PERMIT_TYPE_CONTEXT[type] ?? "Tipo desconocido. Aplicá criterio general de seguridad marítima.";
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

  // Telemetría no bloqueante
  (async () => {
    const prisma = getPrismaClient();
    if (!prisma) return;
    const tenant = await (prisma as any).tenant.findUnique({
      where: { slug: session.tenantSlug },
      select: { id: true },
    });
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
