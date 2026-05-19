import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";

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

REGLAS DE CONCISIÓN (aplican a todas las secciones del narrative):
- Cada bullet es UNA LÍNEA, máximo 15 palabras.
- Máximo 5 bullets por sección — solo los MÁS importantes/críticos.
- Específico y accionable: no "tener cuidado" sino "verificar temperatura ≤ 40°C con IR antes de tocar".
- Si una sección no aplica, escribí "- No aplica" — pero mantené las 4 secciones siempre.

ESTRUCTURA DEL RESPONSE (JSON):

· "level": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"

· "narrative": texto plano con las 4 secciones, USANDO \\n PARA SEPARAR LÍNEAS (escape JSON estándar):

  "narrative": "Peligros identificados:\\n- [bullet 1]\\n- [bullet 2]\\n\\nConsecuencias:\\n- [bullet 1]\\n\\nMedidas de control:\\n- [bullet 1]\\n\\nEPP requerido:\\n- [bullet 1]"

  IMPORTANTE: Solo texto con \\n, NUNCA tabla Markdown adentro del narrative.

· "jsaMatrix": array de objetos con la matriz paso a paso JSA. ES OBLIGATORIO si level es HIGH o CRITICAL. ES OMITIDO (o array vacío) si level es LOW o MEDIUM.

  Cada objeto: {"step": "...", "hazard": "...", "control": "...", "ppe": "..."}

  Reglas de la matriz:
  - Entre 4 y 8 elementos en el array (pasos REALES de la tarea, no genéricos).
  - Cada string corto — máximo 60 caracteres, sin saltos de línea (\\n NO permitido en strings de la matriz).
  - Si en un paso hay varios peligros, separalos con "; " dentro del mismo string.
  - Pasos típicos: aislar, esperar/enfriar, abrir/desmontar, inspeccionar, intervenir, ensamblar, probar, cerrar permiso.
  - "control" debe ser ACCIONABLE y MEDIBLE.

EJEMPLO COMPLETO de respuesta para nivel HIGH:
{"level":"HIGH","narrative":"Peligros identificados:\\n- Espacio confinado\\n- Vapores oleosos\\n\\nConsecuencias:\\n- Asfixia\\n\\nMedidas de control:\\n- Gas test antes de entrar\\n- Standby afuera\\n\\nEPP requerido:\\n- Respirador con suministro de aire","jsaMatrix":[{"step":"Drenar tanque","hazard":"Salpicadura aceite","control":"Conexión cerrada al colector","ppe":"Guantes nitrilo, gafas"},{"step":"Gas test del espacio","hazard":"Atmósfera deficiente O2","control":"Medir O2 >19.5%, LEL <10%","ppe":"Detector multigas"},{"step":"Entrar con standby","hazard":"Asfixia / pérdida conciencia","control":"Arnés + standby afuera con radio","ppe":"Arnés 5 puntos, casco"},{"step":"Inspección visual interna","hazard":"Tropezar / caer","control":"Iluminación 12V, sin obstáculos","ppe":"Botas antideslizantes"}]}

EJEMPLO de respuesta para nivel LOW (sin jsaMatrix):
{"level":"LOW","narrative":"Peligros identificados:\\n- No aplica\\n\\nConsecuencias:\\n- No aplica\\n\\nMedidas de control:\\n- Verificar correcto montaje\\n\\nEPP requerido:\\n- Guantes mecánicos básicos"}

Respondé ÚNICAMENTE con el JSON válido, sin texto adicional fuera del JSON, sin code fence.`;

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

  // Timeout explícito 30s — sin esto el SDK puede colgar 10 min (default 600s).
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

// Construye una tabla Markdown con los headers fijos a partir del array
// jsaMatrix devuelto por la IA. Sanitiza cada celda: trim, sin pipes, sin
// saltos de línea (los reemplaza por "; ").
function formatJsaMatrix(rows: Array<{ step?: unknown; hazard?: unknown; control?: unknown; ppe?: unknown }>): string {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const clean = (v: unknown) => String(v ?? "").trim()
    .replace(/\r?\n/g, "; ")
    .replace(/\|/g, "/");
  const lines: string[] = [
    "JSA — Matriz paso a paso:",
    "",
    "| # | Paso | Peligro | Control / Mitigación | EPP |",
    "|---|------|---------|---------------------|-----|",
  ];
  rows.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${clean(r.step)} | ${clean(r.hazard)} | ${clean(r.control)} | ${clean(r.ppe)} |`);
  });
  return lines.join("\n");
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
    1500,
  );

  log.info(`[suggestRisk] raw response (${raw.length} chars): ${raw.slice(0, 200)}...`);

  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (err) {
    // Fallback: si el JSON está roto (típicamente porque max_tokens cortó al
    // medio), tratamos de extraer level + narrative con regex y seguir.
    log.warn("[suggestRisk] JSON parse failed, intentando fallback regex. Raw:", raw.slice(0, 500));
    const levelMatch = raw.match(/"level"\s*:\s*"(LOW|MEDIUM|HIGH|CRITICAL)"/);
    const narrativeMatch = raw.match(/"(?:narrative|analysis)"\s*:\s*"([\s\S]*?)(?:"(?:\s*,|\s*}))/);
    if (levelMatch) {
      const level = levelMatch[1] as RiskResult["level"];
      const narrative = (narrativeMatch?.[1] ?? "").replace(/\\n/g, "\n").replace(/\\"/g, '"').trim() ||
        "Análisis truncado por la IA. Completá manualmente o re-intentá.";
      log.info(`[suggestRisk] fallback usado — level=${level}, narrative=${narrative.length} chars`);
      return { level, analysis: narrative };
    }
    log.error("[suggestRisk] Fallback regex también falló:", err);
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió una respuesta inválida.");
  }

  const level = String(parsed?.level ?? "").toUpperCase();
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(level)) {
    throw new RouteError(502, "AI_PARSE_ERROR", `Nivel de riesgo inválido: ${level}`);
  }

  // Compat: si Claude devolvió el campo legacy "analysis" (todo en uno) lo
  // usamos. Si devolvió el nuevo formato "narrative" + "jsaMatrix", armamos
  // la tabla Markdown nosotros (más robusto, evita errores de escape).
  let narrative = String(parsed?.narrative ?? "").trim();
  if (!narrative) narrative = String(parsed?.analysis ?? "").trim();
  if (!narrative) {
    throw new RouteError(502, "AI_PARSE_ERROR", "Falta el análisis.");
  }

  let analysis = narrative;
  if (Array.isArray(parsed?.jsaMatrix) && parsed.jsaMatrix.length > 0) {
    const table = formatJsaMatrix(parsed.jsaMatrix);
    if (table) analysis = `${narrative}\n\n${table}`;
  }

  return { level: level as RiskResult["level"], analysis };
}
