import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

const MODEL = "claude-haiku-4-5-20251001";

const PROMPT_ACCEPTANCE = `Sos experto en mantenimiento de máquinas navales. Generá el siguiente contenido para esta tarea:

1. Criterios de aceptación verificables, específicos y técnicos (cuándo el trabajo está correctamente completado, con rangos y tolerancias aplicables).

2. Una sección con las herramientas, equipos de medición e instrumentos requeridos.

Usá exactamente este formato (sin introducción ni explicación adicional):
[criterios de aceptación]

HERRAMIENTAS E INSTRUMENTOS NECESARIOS:
[lista de herramientas e instrumentos]`;

const PROMPT_LOTO = `Sos experto en mantenimiento de máquinas navales. Definí los procedimientos LOTO (Lockout/Tagout) específicos para esta tarea: qué energías deben bloquearse, en qué orden, y qué verificaciones de seguridad se requieren antes de iniciar y al finalizar el trabajo. No incluyas listado de EPP ni equipos de protección personal.

Responde ÚNICAMENTE con el procedimiento LOTO, en texto plano, sin introducción ni explicación adicional.`;

const PROMPT_RISK = `Sos experto en gestión de riesgos en mantenimiento de máquinas navales. Analizá esta tarea y respondé ÚNICAMENTE con este formato exacto (sin JSON, sin markdown, sin introducción):

NIVEL: LOW|MEDIUM|HIGH|CRITICAL

[peligros identificados, consecuencias posibles y medidas de control]

EQUIPOS DE PPE:
- [equipo de protección 1]
- [equipo de protección 2]`;

interface BaseInput {
  assetLabel?: string | null;
  taskDesc?: string | null;
}

interface LotoInput extends BaseInput {
  acceptanceCriteria?: string | null;
}

interface RiskInput extends BaseInput {
  acceptanceCriteria?: string | null;
  loto?: string | null;
}

export interface RiskResult {
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  analysis: string;
}

function buildContext(input: BaseInput, extras: Record<string, string | null | undefined> = {}): string {
  const lines = [
    `Activo: ${(input.assetLabel ?? "").trim() || "equipo desconocido"}`,
    `Tarea: ${(input.taskDesc ?? "").trim() || "tarea no especificada"}`,
  ];
  for (const [k, v] of Object.entries(extras)) {
    if (v && v.trim()) lines.push(`${k}: ${v.trim()}`);
  }
  return lines.join("\n");
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

  const client = new Anthropic({ apiKey });
  const aiStarted = Date.now();

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
  } catch (err) {
    log.error(`[${feature}] Anthropic call failed:`, err);
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

export async function suggestPlanAcceptanceCriteria(
  session: TenantAccessSession,
  input: BaseInput,
): Promise<{ text: string }> {
  const text = await callClaude(
    session,
    "plan_acceptance_criteria_suggestion",
    PROMPT_ACCEPTANCE,
    buildContext(input),
    1024,
  );
  return { text };
}

export async function suggestPlanLoto(
  session: TenantAccessSession,
  input: LotoInput,
): Promise<{ text: string }> {
  const text = await callClaude(
    session,
    "plan_loto_suggestion",
    PROMPT_LOTO,
    buildContext(input, { "Criterios de aceptación": input.acceptanceCriteria }),
    1024,
  );
  return { text };
}

export async function suggestPlanRisk(
  session: TenantAccessSession,
  input: RiskInput,
): Promise<RiskResult> {
  const raw = await callClaude(
    session,
    "plan_risk_suggestion",
    PROMPT_RISK,
    buildContext(input, {
      "Criterios de aceptación": input.acceptanceCriteria,
      "LOTO": input.loto,
    }),
    1024,
  );

  const levelMatch = raw.match(/^NIVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL)/im);
  const level = (levelMatch?.[1] ?? "").toUpperCase() as RiskResult["level"];
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(level)) {
    throw new RouteError(502, "AI_PARSE_ERROR", `Nivel de riesgo inválido o ausente.`);
  }
  const analysis = raw.replace(/^NIVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL)\s*/im, "").trim();
  if (!analysis) {
    throw new RouteError(502, "AI_PARSE_ERROR", "Falta el análisis.");
  }

  return { level, analysis };
}
