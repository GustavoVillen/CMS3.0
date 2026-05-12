import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

const MODEL = "claude-haiku-4-5-20251001";

const PROMPT_ACCEPTANCE = `Sos experto en mantenimiento de máquinas navales. Definí criterios de aceptación verificables, específicos y técnicos para esta tarea.

REGLAS DE CONCISIÓN:
- Máximo 5 criterios (los MÁS importantes, no listado exhaustivo).
- Cada criterio en una sola línea como bullet "- ".
- Cada criterio debe ser MEDIBLE: incluir valor numérico, rango, tolerancia, o estado verificable. Ej: "- Presión de descarga 4-6 bar" / "- Sin fugas visibles tras 10 min de operación" / "- Torque de bridas 80 Nm ±5%".
- Si no podés definir un valor medible, omitilo (no incluyas bullets vagos como "verificar correcto funcionamiento").

Responde ÚNICAMENTE con los bullets, en texto plano, sin introducción, sin numeración, sin explicación adicional.`;

const PROMPT_LOTO = `Sos experto en mantenimiento de máquinas navales. Definí el procedimiento de seguridad para esta tarea.

ESTRUCTURA FIJA — usá EXACTAMENTE estas 3 secciones con sus encabezados:

LOTO:
- [punto de aislación 1 — máximo 5 puntos]

INSTRUMENTOS NECESARIOS:
- [instrumento/herramienta 1 — máximo 5 ítems]

EQUIPOS DE PROTECCIÓN PERSONAL NECESARIOS:
- [EPP 1 — máximo 5 ítems]

REGLAS DE CONCISIÓN:
- Solo los ítems CRÍTICOS, no listado exhaustivo.
- Bullets cortos: máximo 15 palabras cada uno.
- Específicos: en LOTO indicá qué bloquear y cómo (ej. "Desconectar breaker X, candado + tarjeta, verificar tensión cero con multímetro"). En instrumentos indicá tipo y rango (ej. "Multímetro 600V CAT III"). En EPP indicá tipo y nivel (ej. "Guantes anticorte nivel 4").
- Si una sección no aplica (ej. tarea sin energía a aislar), escribí "- No aplica" — pero MANTENÉ las 3 secciones siempre.

Responde ÚNICAMENTE con las 3 secciones en texto plano, sin introducción, sin explicación.`;

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

REGLAS DE CONCISIÓN (aplican a todas las secciones):
- Cada bullet es UNA LÍNEA, máximo 15 palabras.
- Máximo 5 bullets por sección — solo los MÁS importantes/críticos.
- Específico y accionable: no "tener cuidado" sino "verificar temperatura ≤ 40°C con IR antes de tocar".
- Si una sección no aplica, escribí "- No aplica" — pero mantené las 4 secciones siempre.

ESTRUCTURA del campo "analysis" SEGÚN NIVEL:

· Si el nivel es LOW o MEDIUM → "analysis" es texto narrativo con estas 4 secciones (sin tabla):

  Peligros identificados:
  - [hasta 5 bullets]

  Consecuencias:
  - [hasta 5 bullets]

  Medidas de control:
  - [hasta 5 bullets]

  EPP requerido:
  - [hasta 5 bullets]

· Si el nivel es HIGH o CRITICAL → "analysis" es lo mismo de arriba (4 secciones concisas) PERO ADEMÁS al final agregás una matriz JSA paso a paso en formato tabla Markdown:

JSA — Matriz paso a paso:

| # | Paso | Peligro | Control / Mitigación | EPP |
|---|------|---------|---------------------|-----|
| 1 | [paso 1] | [peligro principal] | [control específico] | [EPP requerido] |
| 2 | ... | ... | ... | ... |

Reglas de la tabla:
- Entre 4 y 8 filas (pasos REALES de la tarea, no genéricos).
- Cada celda corta — máximo 60 caracteres, sin saltos de línea.
- Si en un paso hay varios peligros, separalos con "; ".
- Pasos típicos: aislar, esperar/enfriar, abrir/desmontar, inspeccionar, intervenir, ensamblar, probar, cerrar permiso.
- "Control" debe ser ACCIONABLE y MEDIBLE.

Respondé ÚNICAMENTE con este JSON válido (sin texto adicional fuera del JSON, sin code fence):
{"level":"LOW|MEDIUM|HIGH|CRITICAL","analysis":"texto del análisis siguiendo la estructura"}`;

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
