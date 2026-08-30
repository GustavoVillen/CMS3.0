import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { cleanAiText } from "../ai/ai-text";
import { getVesselAiContext } from "../ai/vessel-ai-context";

const MODEL = AI_MODEL.fast;

const PROMPT_ACCEPTANCE = `Sos experto en mantenimiento de máquinas navales. Definí criterios de aceptación verificables, específicos y técnicos para esta tarea.

REGLAS DE CONCISIÓN:
- Máximo 5 criterios (los MÁS importantes, no listado exhaustivo).
- Cada criterio en una sola línea como bullet "- ".
- Cada criterio debe ser MEDIBLE: incluir valor numérico, rango, tolerancia, o estado verificable. Ej: "- Presión de descarga 4-6 bar" / "- Sin fugas visibles tras 10 min de operación" / "- Torque de bridas 80 Nm ±5%".
- Si no podés definir un valor medible, omitilo (no incluyas bullets vagos como "verificar correcto funcionamiento").

Responde ÚNICAMENTE con los bullets, en texto plano, sin introducción, sin numeración, sin explicación adicional.`;

const PROMPT_TITLE = `Sos experto en mantenimiento de máquinas navales. A partir del equipo y, si está, la tarea ya cargada, escribí un título corto y específico para esta orden de trabajo.

REGLAS:
- Una sola línea, sin punto final.
- Máximo 10 palabras.
- Específico: nombrá el componente/sistema y la acción principal (ej. "Cambio de aceite motor auxiliar babor", "Inspección visual de línea de eje estribor").
- No repitas "Orden de trabajo" ni el nombre completo del equipo si ya queda claro por el contexto.
- Sin mayúsculas sostenidas salvo siglas.

Responde ÚNICAMENTE con el título, en texto plano, sin comillas, sin punto final, sin explicación adicional.`;

const PROMPT_TASK = `Sos experto en mantenimiento de máquinas navales. A partir del equipo y del título de la orden de trabajo, escribí las tareas concretas que hay que ejecutar.

REGLAS:
- Incluí TODAS las tareas que el trabajo requiera, sin límite de cantidad. No recortes por brevedad: si el mantenimiento son veinte pasos, van los veinte.
- Ordenalas en la secuencia real de ejecución (preparación → intervención → pruebas → cierre).
- Cada tarea en una sola línea como bullet "- ", empezando con un verbo en infinitivo. Ej: "- Drenar el aceite usado del cárter".
- Específicas del equipo indicado: nombrá componentes, valores o consumibles cuando corresponda. Nada de generalidades como "revisar el equipo".
- No incluyas criterios de aceptación, LOTO, EPP ni análisis de riesgo: eso se completa en sus propios campos.
- Si el título es demasiado vago para deducir las tareas, sugerí las del mantenimiento típico de ese equipo.

SI VIENE "Tareas ya cargadas":
- Son las que el usuario ya escribió. Devolvé la lista COMPLETA y definitiva: las de él MÁS las que falten, integradas en una sola redacción ordenada.
- Conservá el contenido técnico de las suyas (valores, marcas, cantidades, referencias). Podés mejorar la redacción o ubicarlas en el orden correcto, pero NO las elimines ni les cambies el sentido.
- Fusioná duplicados: si una suya y una tuya son la misma tarea, dejá una sola.

Responde ÚNICAMENTE con los bullets, en texto plano, sin introducción, sin numeración, sin explicación adicional.`;

const PROMPT_LOTO = `Sos experto en mantenimiento de máquinas navales. Definí el procedimiento de seguridad para esta tarea.

ESTRUCTURA FIJA — usá EXACTAMENTE estas 3 secciones con sus encabezados:

LOTO:
- un bullet por punto de aislación, máximo 5

INSTRUMENTOS NECESARIOS:
- un bullet por instrumento o herramienta, máximo 5

EQUIPOS DE PROTECCIÓN PERSONAL NECESARIOS:
- un bullet por EPP, máximo 5

Escribí el contenido real en cada bullet: no repitas estas indicaciones ni encierres el
texto entre corchetes.

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

const PROMPT_ASSET = `Sos experto en mantenimiento de máquinas navales. Te doy la descripción de una deficiencia/tarea (típicamente un hallazgo de auditoría o inspección externa) y una lista de equipos del buque, cada uno con su id, código y nombre.

Tu tarea: elegir el ÚNICO equipo de la lista que MEJOR corresponde a esa deficiencia, para abrir una orden de trabajo correctiva.

REGLAS:
- Razoná por el tipo de equipo, sistema y función implícita en la deficiencia (ej. "manómetro de la tubería de carga" → equipo del sistema de carga / línea de carga; "fuga en bomba de sentina" → bomba de sentina).
- Respondé SOLO con JSON válido: {"assetId":"<id exacto del equipo elegido>"}.
- El id debe ser EXACTAMENTE uno de los ids de la lista. NUNCA inventes un id.
- Si ningún equipo corresponde con razonabilidad, respondé {"assetId":null}.
- Sin texto fuera del JSON, sin code fence, sin explicación.`;

const PROMPT_PLAN_LINK = `Sos experto en mantenimiento planificado de máquinas navales. Te doy el título/descripción de una orden de trabajo (OT) recién creada y la lista de ítems del plan de mantenimiento periódico (PDM) del MISMO equipo, cada uno con su id, código de tarea, título, tipo de disparador y próximo vencimiento.

Tu tarea: decidir si esta OT corresponde a (acredita) uno o más de esos ítems del plan — es decir, si el trabajo que describe la OT es efectivamente la ejecución de esa tarea periódica.

REGLAS:
- Comparás por el CONTENIDO técnico de la tarea (qué se hace, sobre qué componente), no por coincidencia literal de palabras.
- Una OT puede corresponder a varios ítems del plan a la vez (ej. una intervención mayor que cubre varias tareas periódicas del mismo equipo).
- Asigná "high" solo si estás razonablemente segura de que la OT ES esa tarea periódica. "medium" si es probable pero no coincide del todo. "low" si es una posibilidad débil, sólo temática.
- Es preferible devolver la lista vacía antes que forzar una coincidencia dudosa: NUNCA inventes ni fuerces un id sólo para completar.
- El id debe ser EXACTAMENTE uno de los ids de la lista recibida. NUNCA inventes un id.
- Respondé SOLO con JSON válido: {"matches":[{"id":"<id exacto>","confidence":"high"|"medium"|"low"}, ...]}. Si no corresponde a ninguno, {"matches":[]}.
- Sin texto fuera del JSON, sin code fence, sin explicación.`;

interface AssetCandidate {
  id: string;
  code?: string | null;
  name?: string | null;
}

interface AssetSuggestionInput {
  taskDesc?: string | null;
  assets?: AssetCandidate[];
}

export interface PlanCandidate {
  id: string;
  taskCode?: string | null;
  title?: string | null;
  triggerType?: string | null;
  nextDueDate?: string | null;
  nextDueHours?: number | null;
  executionStatus?: string | null;
}

interface SuggestPlanLinkInput {
  assetLabel?: string | null;
  title?: string | null;
  taskDesc?: string | null;
  plans?: PlanCandidate[];
}

export interface PlanLinkSuggestion {
  id: string;
  confidence: "high" | "medium" | "low";
}

export interface SuggestPlanLinkResult {
  matches: PlanLinkSuggestion[];
}

interface BaseInput {
  assetLabel?: string | null;
  taskDesc?: string | null;
  /** Buque de la OT, para resolver qué clase de embarcación es. */
  vesselCode?: string | null;
}

interface TaskInput extends BaseInput {
  /** Lo que el usuario ya escribió en Tarea: la IA sólo agrega lo que falta. */
  existingTasks?: string | null;
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

function buildContext(
  input: BaseInput,
  extras: Record<string, string | null | undefined> = {},
  vesselFacts?: string | null,
): string {
  const lines = [
    `Activo: ${(input.assetLabel ?? "").trim() || "equipo desconocido"}`,
    `Tarea: ${(input.taskDesc ?? "").trim() || "tarea no especificada"}`,
  ];
  if (vesselFacts) lines.push(`Sobre el buque: ${vesselFacts}`);
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
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");

  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  // Timeout explícito 30s — sin esto el SDK puede colgar 10 min (default 600s).
  // Los max_tokens acotados (1024-1500) hacen que Haiku responda en ~10-15s.
  const client = createAiClient({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${userContent}` }],
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

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();
  return cleanAiText(raw);
}

export async function suggestTitle(
  session: TenantAccessSession,
  input: BaseInput,
): Promise<{ text: string }> {
  const text = await callClaude(
    session,
    "wo_title_suggestion",
    PROMPT_TITLE,
    buildContext(input, {}, await getVesselAiContext(session.tenantSlug, input.vesselCode)),
    256,
  );
  return { text };
}

export async function suggestTaskSteps(
  session: TenantAccessSession,
  input: TaskInput,
): Promise<{ text: string }> {
  const text = await callClaude(
    session,
    "wo_task_steps_suggestion",
    PROMPT_TASK,
    buildContext(input, { "Tareas ya cargadas": input.existingTasks }, await getVesselAiContext(session.tenantSlug, input.vesselCode)),
    // Sin tope de tareas: un mantenimiento mayor puede ser una lista larga y
    // cortarla a la mitad es peor que no sugerirla.
    4096,
  );
  return { text };
}

export async function suggestAcceptanceCriteria(
  session: TenantAccessSession,
  input: BaseInput,
): Promise<{ text: string }> {
  const text = await callClaude(
    session,
    "wo_acceptance_criteria_suggestion",
    PROMPT_ACCEPTANCE,
    buildContext(input, {}, await getVesselAiContext(session.tenantSlug, input.vesselCode)),
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
    buildContext(input, { "Criterios de aceptación": input.acceptanceCriteria }, await getVesselAiContext(session.tenantSlug, input.vesselCode)),
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
    }, await getVesselAiContext(session.tenantSlug, input.vesselCode)),
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

// Sugiere el activo que mejor corresponde a una deficiencia/tarea, eligiendo entre
// la lista de equipos del buque que envía el frontend. Devuelve un id validado contra
// esa lista (nunca uno inventado por la IA), o null si ninguno encaja.
export async function suggestAsset(
  session: TenantAccessSession,
  input: AssetSuggestionInput,
): Promise<{ assetId: string | null }> {
  const assets = Array.isArray(input.assets) ? input.assets.filter(a => a && a.id) : [];
  const taskDesc = (input.taskDesc ?? "").trim();
  if (!taskDesc || assets.length === 0) return { assetId: null };

  const list = assets
    .map(a => `- id=${a.id} | ${(a.code ?? "").trim()} — ${(a.name ?? "").trim()}`)
    .join("\n");
  const userContent = `Deficiencia/tarea: ${taskDesc}\n\nEquipos disponibles:\n${list}`;

  const raw = await callClaude(session, "wo_asset_suggestion", PROMPT_ASSET, userContent, 200);

  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    const m = raw.match(/"assetId"\s*:\s*"([^"]+)"/);
    parsed = m ? { assetId: m[1] } : { assetId: null };
  }

  const id = parsed?.assetId == null ? null : String(parsed.assetId).trim();
  // Validación anti-alucinación: solo aceptamos un id que estaba en la lista.
  const valid = id && assets.some(a => a.id === id) ? id : null;
  return { assetId: valid };
}

// Sugiere a qué ítem(s) del plan de mantenimiento (mismo equipo) podría corresponder
// una OT recién creada, para ofrecerle al usuario vincularla y así acreditar el plan
// al cerrarla. Nunca decide sola: sólo sugiere, y sólo con ids validados contra la
// lista de candidatos recibida (nunca uno inventado por la IA).
export async function suggestPlanLinks(
  session: TenantAccessSession,
  input: SuggestPlanLinkInput,
): Promise<SuggestPlanLinkResult> {
  const plans = Array.isArray(input.plans) ? input.plans.filter(p => p && p.id) : [];
  const taskDesc = (input.title ?? "").trim() || (input.taskDesc ?? "").trim();
  if (!taskDesc || plans.length === 0) return { matches: [] };

  const list = plans
    .map(p => `- id=${p.id} | ${(p.taskCode ?? "").trim()} — ${(p.title ?? "").trim()} | disparador: ${(p.triggerType ?? "").trim() || "?"} | próximo vencimiento: ${p.nextDueDate ?? p.nextDueHours ?? "sin definir"}`)
    .join("\n");
  const userContent = `Equipo: ${(input.assetLabel ?? "").trim() || "equipo desconocido"}\nOT — título/descripción: ${(input.title ?? "").trim()}\n${(input.taskDesc ?? "").trim() ? `OT — tarea: ${input.taskDesc!.trim()}\n` : ""}\nÍtems del plan de mantenimiento de ese equipo:\n${list}`;

  const raw = await callClaude(session, "wo_plan_link_suggestion", PROMPT_PLAN_LINK, userContent, 500);

  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    return { matches: [] };
  }

  const rawMatches = Array.isArray(parsed?.matches) ? parsed.matches : [];
  const validConfidence = new Set(["high", "medium", "low"]);
  const matches: PlanLinkSuggestion[] = [];
  for (const m of rawMatches) {
    const id = m?.id == null ? null : String(m.id).trim();
    const confidence = validConfidence.has(m?.confidence) ? m.confidence : null;
    // Validación anti-alucinación: solo aceptamos ids que estaban en la lista recibida.
    if (id && confidence && plans.some(p => p.id === id)) {
      matches.push({ id, confidence });
    }
  }
  return { matches };
}
