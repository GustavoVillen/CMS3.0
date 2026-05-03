import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

const MODEL = "claude-haiku-4-5-20251001";

const PROMPT_ACCEPTANCE = `Sos experto en mantenimiento de máquinas navales. Definí criterios de aceptación verificables, específicos y técnicos para esta tarea. Los criterios deben indicar cuándo el trabajo está correctamente completado, con rangos y tolerancias aplicables.

Responde ÚNICAMENTE con los criterios, en texto plano, sin introducción ni explicación adicional.`;

const PROMPT_LOTO = `Sos experto en mantenimiento de máquinas navales. Definí los procedimientos LOTO (Lockout/Tagout) específicos para esta tarea: qué energías deben bloquearse, en qué orden, y qué verificaciones de seguridad se requieren antes de iniciar y al finalizar el trabajo.

Responde ÚNICAMENTE con el procedimiento LOTO, en texto plano, sin introducción ni explicación adicional.`;

const PROMPT_RISK = `Sos experto en HSE / Job Safety Analysis (JSA) para mantenimiento de máquinas navales.

CONTEXTO IMPORTANTE — qué te están pidiendo:
Este análisis evalúa el riesgo PARA EL OPERARIO al EJECUTAR la tarea. Es decir: la pregunta es "¿qué peligros corre quien hace el trabajo MIENTRAS lo hace?".

NO confundir con RCM (otra herramienta del sistema). RCM pregunta lo opuesto: "¿qué pasa si la tarea NO se hace?". RCM mira la consecuencia de la falla en el equipo. Vos NO tenés que pensar en eso.

Vos pensás en: espacio confinado, energías peligrosas, hot work, caídas, atrapamiento, exposición química, ruido, atmósferas explosivas, partes móviles, cargas suspendidas, presión residual, temperatura, electricidad. Cosas que pueden lastimar AL TRIPULANTE durante la ejecución.

Niveles de riesgo (operacional):
- LOW: tarea rutinaria sin energías peligrosas, espacio normal, EPP básico.
- MEDIUM: requiere LOTO simple, EPP específico, una persona alcanza.
- HIGH: requiere permisos especiales (espacio confinado, hot work), standby, atmósfera medida.
- CRITICAL: combina varios riesgos altos o trabajo en altura/sobre el agua/buceo.

Respondé ÚNICAMENTE con este JSON (sin texto adicional):
{"level":"LOW|MEDIUM|HIGH|CRITICAL","analysis":"peligros identificados durante la ejecución, consecuencias para el operario, medidas de control y EPP recomendado"}`;

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

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
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

export async function suggestAcceptanceCriteria(
  session: TenantAccessSession,
  input: BaseInput,
): Promise<{ text: string }> {
  const text = await callClaude(
    session,
    "wo_acceptance_criteria_suggestion",
    PROMPT_ACCEPTANCE,
    buildContext(input),
    1024,
  );
  return { text };
}

export async function suggestLoto(
  session: TenantAccessSession,
  input: LotoInput,
): Promise<{ text: string }> {
  const text = await callClaude(
    session,
    "wo_loto_suggestion",
    PROMPT_LOTO,
    buildContext(input, { "Criterios de aceptación": input.acceptanceCriteria }),
    1024,
  );
  return { text };
}

export async function suggestRisk(
  session: TenantAccessSession,
  input: RiskInput,
): Promise<RiskResult> {
  const raw = await callClaude(
    session,
    "wo_risk_suggestion",
    PROMPT_RISK,
    buildContext(input, {
      "Criterios de aceptación": input.acceptanceCriteria,
      "LOTO": input.loto,
    }),
    1024,
  );

  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió una respuesta inválida.");
  }

  const level = String(parsed?.level ?? "").toUpperCase();
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(level)) {
    throw new RouteError(502, "AI_PARSE_ERROR", `Nivel de riesgo inválido: ${level}`);
  }
  const analysis = String(parsed?.analysis ?? "").trim();
  if (!analysis) {
    throw new RouteError(502, "AI_PARSE_ERROR", "Falta el análisis.");
  }

  return { level: level as RiskResult["level"], analysis };
}
