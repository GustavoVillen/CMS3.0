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

// ─── Sugerencia de clasificacion + severidad + flag near-miss ───────────────

const PROMPT_CLASSIFICATION = `Sos superintendente experto en mantenimiento naval. Te pasan una descripcion de un defecto recien reportado por un tripulante y tenes que clasificarlo para que el sistema le ponga los metadatos correctos.

Devolveme UN UNICO JSON valido sin texto adicional, sin code fence, con esta estructura EXACTA:

{
  "classification": "Mecanico|Electrico|Estructural|Hidraulico|Neumatico|Electronico|Pintura|Comunicaciones|Navegacion|Otro",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "shouldBeNearMiss": true|false,
  "nearMissReason": "<si shouldBeNearMiss=true, una frase explicando por que es un evento sin daño material y no un defecto; si false, null>",
  "confidence": "HIGH|MEDIUM|LOW"
}

Reglas para "classification":
- Elegi UNA de la lista. No inventes valores.
- Mecanico: motores, bombas, valvulas, ejes, rodamientos, transmision.
- Electrico: motores electricos, generadores, alta tension, baterias, cableado.
- Estructural: casco, cubierta, mamparos, soldaduras, corrosion estructural.
- Hidraulico: sistemas hidraulicos, cilindros, mangueras, presion.
- Neumatico: aire comprimido, mangueras de aire, valvulas neumaticas.
- Electronico: PLCs, automatizacion, control, sensores, ECDIS, radar.
- Pintura: pintura corroida, oxido superficial, recubrimientos.
- Comunicaciones: VHF, GMDSS, telefonia interna, antenas.
- Navegacion: instrumentos de navegacion (giroscopo, GPS, compass).
- Otro: cuando no encaje claramente.

Reglas para "severity":
- CRITICAL: riesgo inmediato a la vida humana, al medio ambiente, o al buque. Equipo critico fuera de servicio. Ej: bomba contra incendio rota, steering gear fallado, fuga de combustible.
- HIGH: equipo importante con falla pero hay redundancia. Riesgo operacional alto. Ej: una bomba de dos paralelas fallada.
- MEDIUM: deterioro funcional sin riesgo inmediato. Ej: filtro tapado, sensor inestable.
- LOW: cosmetico, desgaste menor. Ej: pintura, oxido superficial, soporte aflojado.

Reglas para "shouldBeNearMiss":
- TRUE si la descripcion sugiere un EVENTO o CONDICION DE RIESGO que NO causo dano material todavia. Ej: "casi me tropiezo con un cable suelto", "olor a gas pero sin fuga visible", "alguien casi cae por escalera mojada", "se desprendio un cable pero no impacto a nadie".
- FALSE si describe un PROBLEMA MATERIAL existente (algo roto, deteriorado, degradado, fugando). Ej: "bomba con vibracion", "pintura oxidada", "valvula no cierra".
- En la duda → FALSE (el flujo de defectos es el caso comun).

Reglas para "confidence":
- HIGH: la descripcion es clara y especifica.
- MEDIUM: la descripcion es generica pero suficiente.
- LOW: la descripcion es muy corta o ambigua.

Responde SOLO con el JSON, sin texto adicional, sin "Aqui tenes", sin code fence.`;

export interface ClassificationInput {
  description: string;
  assetLabel?: string | null;
  operationalState?: string | null;
}

export interface ClassificationSuggestion {
  classification: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  shouldBeNearMiss: boolean;
  nearMissReason: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

function stripCodeFence(t: string): string {
  return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function suggestDefectClassification(
  session: TenantAccessSession,
  input: ClassificationInput,
): Promise<ClassificationSuggestion> {
  const desc = String(input.description ?? "").trim();
  if (!desc) throw new RouteError(400, "VALIDATION_ERROR", "Falta la descripcion del defecto.");
  if (desc.length < 10) throw new RouteError(400, "VALIDATION_ERROR", "La descripcion es muy corta para sugerir clasificacion (minimo 10 caracteres).");

  const opLabel = input.operationalState ? OP_STATE_LABEL[input.operationalState.toUpperCase()] ?? input.operationalState : "no especificado";
  const userContent = [
    `Descripcion del defecto: ${desc}`,
    input.assetLabel ? `Equipo afectado: ${input.assetLabel}` : "Equipo no especificado",
    `Estado operacional reportado: ${opLabel}`,
  ].join("\n");

  const raw = await callClaude(
    session,
    "defect_classification_suggestion",
    PROMPT_CLASSIFICATION,
    userContent,
    400,
  );

  let parsed: Partial<ClassificationSuggestion> & { nearMissReason?: string | null };
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (err) {
    log.warn("[suggestDefectClassification] JSON parse failed, raw:", raw.slice(0, 200));
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvio un formato invalido.");
  }

  // Validar enums (la IA a veces alucina)
  const sev = String(parsed.severity ?? "").toUpperCase();
  if (!["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(sev)) {
    throw new RouteError(502, "AI_PARSE_ERROR", `Severity invalido: ${sev}`);
  }
  const conf = String(parsed.confidence ?? "").toUpperCase();
  if (!["HIGH", "MEDIUM", "LOW"].includes(conf)) {
    throw new RouteError(502, "AI_PARSE_ERROR", `Confidence invalido: ${conf}`);
  }

  return {
    classification: String(parsed.classification ?? "Otro").trim() || "Otro",
    severity: sev as ClassificationSuggestion["severity"],
    shouldBeNearMiss: !!parsed.shouldBeNearMiss,
    nearMissReason: parsed.shouldBeNearMiss ? (parsed.nearMissReason ?? null) : null,
    confidence: conf as ClassificationSuggestion["confidence"],
  };
}

// ─── Deteccion de defectos similares (anti-duplicados) ──────────────────────

export interface SimilarDefectsInput {
  description: string;
  assetId?: string | null;
  vesselCode?: string | null;
}

export interface SimilarDefect {
  id: string;
  defectCode: string;
  description: string;
  status: string;
  severity: string;
  reportedAt: string;
  similarity: number; // 0..1
}

/**
 * Busca defectos abiertos del mismo asset/vessel con similitud textual con
 * la descripcion provista. Algoritmo: Jaccard de bigramas + normalizacion +
 * stopwords ES. No usa IA — es deterministico y rapido. Si el caller
 * quiere similitud semantica mas profunda, se puede agregar un endpoint
 * con embeddings, pero para detectar duplicados literales (lo comun)
 * Jaccard es suficiente.
 */
export async function findSimilarDefects(
  session: TenantAccessSession,
  input: SimilarDefectsInput,
): Promise<{ items: SimilarDefect[] }> {
  const description = String(input.description ?? "").trim();
  if (description.length < 10) return { items: [] };

  const prisma = getPrismaClient();
  if (!prisma) return { items: [] };
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return { items: [] };

  const where: Record<string, unknown> = {
    tenantId: tenant.id,
    deletedAt: null,
    status: { notIn: ["RESOLVED", "CLOSED"] },
  };
  if (input.assetId) where.assetId = input.assetId;
  if (input.vesselCode) where.vesselCode = input.vesselCode;

  const candidates = await (prisma as unknown as {
    defect: { findMany(a: unknown): Promise<Array<{ id: string; defectCode: string; description: string; status: string; severity: string; reportedAt: Date }>> };
  }).defect.findMany({
    where,
    select: { id: true, defectCode: true, description: true, status: true, severity: true, reportedAt: true } as never,
    orderBy: { reportedAt: "desc" },
    take: 50,
  });

  // Calcular similitud Jaccard de bigramas
  const queryTokens = bigrams(normaliseText(description));
  const scored = candidates
    .map(c => ({
      id: c.id,
      defectCode: c.defectCode,
      description: c.description,
      status: c.status,
      severity: c.severity,
      reportedAt: c.reportedAt.toISOString(),
      similarity: jaccard(queryTokens, bigrams(normaliseText(c.description))),
    }))
    .filter(c => c.similarity >= 0.25)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  return { items: scored };
}

// Regex de diacritics combining: usamos RegExp constructor con escape
// Unicode explicito para evitar caracteres literales que dependan del
// encoding del archivo.
const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "") // quita acentos
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al",
  "en", "y", "o", "pero", "que", "se", "lo", "le", "con", "por", "para",
  "es", "son", "este", "esta", "ese", "esa", "su", "sus", "mi", "tu",
  "fue", "ha", "han", "muy", "mas", "menos", "como",
]);

function bigrams(text: string): Set<string> {
  const tokens = text.split(" ").filter(t => t.length >= 2 && !STOPWORDS.has(t));
  const set = new Set<string>();
  // Bigramas de palabras (mejor para textos en español que de caracteres)
  for (let i = 0; i < tokens.length - 1; i++) {
    set.add(`${tokens[i]}_${tokens[i + 1]}`);
  }
  // Tambien agregamos unigramas para cuando hay pocos tokens
  for (const t of tokens) set.add(t);
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return intersection / union;
}

// ─── Reporte verbal — parse audio transcription + extract structured fields ─

const PROMPT_VOICE_REPORT = `Sos un asistente de mantenimiento naval. Un tripulante reporta verbalmente un defecto o una situacion de near miss. Te paso la TRANSCRIPCION del audio (que puede tener errores) y necesito que extraigas campos estructurados.

CLASIFICACION DEL TIPO:
- "defect" = problema material existente (algo roto, deteriorado, fugando, fallando, vibrando, ruido anormal). Hay daño material concreto.
- "near_miss" = evento o condicion de riesgo SIN dano material (casi paso algo, vi algo inseguro, alguien casi se accidento). Sin equipo roto.
- "unknown" = no pudiste decidir.

CAMPOS PARA "defect":
- assetId: SOLO un id de la lista que te paso. null si no podes elegir con confianza media o alta.
- description: reformulada en lenguaje TECNICO Y PROFESIONAL de superintendencia naval, manteniendo el contenido pero limpiando muletillas. 1-3 oraciones.
- classification: "Mecanico" | "Electrico" | "Estructural" | "Hidraulico" | "Neumatico" | "Electronico" | "Pintura" | "Comunicaciones" | "Navegacion" | "Otro"
- severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" (mismo criterio que en suggest-classification)
- operationalState: "OPERATIONAL" | "OPERATIONAL_LIMITED" | "NON_OPERATIONAL"
- immediateAction: bullets cortos con verbo accionable si el reporte menciona alguna accion tomada. null si no menciona.

CAMPOS PARA "near_miss":
- category: "NEAR_MISS" | "HAZARD_OBSERVATION" | "UNSAFE_ACT" | "UNSAFE_CONDITION"
- severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
- location: lugar mencionado o null. Ej: "Cubierta principal", "Sala de maquinas", "Tanque de lastre 2P".
- description: reformulada en lenguaje tecnico/profesional, manteniendo el contenido.
- immediateAction: como en defect.
- assetId: si el reporte menciona un equipo, puede ser opcional.

DEDUCCION DEL ASSET:
- Recibis una lista de assets del vessel ({id, name, sfiCode, criticality}).
- Tratar de elegir el mas probable basado en menciones del reporte (ej: "la bomba de incendio del puente" → busca bomba contra incendio).
- Si tu confianza es alta o media, ponelo en fields.assetId y NO lo agregues a missingFields.
- Si tu confianza es baja, ponelo en missingFields y armá una nextQuestion clara y CORTA, mencionando 2-3 candidatos posibles si los hay.

CAMPOS MINIMOS REQUERIDOS para que el reporte sea util:
- type
- description
- Para defect: assetId, classification, severity
- Para near_miss: category, severity (location es opcional)

Devuelve UN UNICO JSON valido sin texto adicional, sin code fence:

{
  "type": "defect" | "near_miss" | "unknown",
  "confidence": "high" | "medium" | "low",
  "fields": {
    // campos arriba, los que no apliquen al type omitir o null
  },
  "missingFields": ["<nombre del campo critico que falta>", ...],
  "nextQuestion": "<una sola pregunta corta al usuario para completar lo que falta, o null si nada critico falta>",
  "reasoning": "<una linea breve explicando por que elegiste type y assetId>"
}

REGLAS:
- nextQuestion DEBE ser conciso, en español, una sola pregunta a la vez. Si faltan 2 cosas, pregunta una sola y dejala como nextQuestion. La otra queda en missingFields.
- description: siempre presente, siempre reformulada con tono tecnico.
- NO inventes datos que no estan en la transcripcion.
- Si la transcripcion no tiene contenido suficiente para identificar nada, type="unknown" y nextQuestion = "Puede repetir el reporte con mas detalle? Que equipo o area estaba afectado?".`;

const ASSET_LIST_LIMIT = 80;

export interface VoiceReportInput {
  /** Transcripcion completa del audio (puede tener errores de ASR). */
  transcript: string;
  vesselCode: string;
  /** Si el usuario ya respondio una nextQuestion previa, su respuesta. */
  userAnswer?: string;
  /** Snapshot del JSON anterior para que la IA refine en vez de reempezar. */
  previousState?: unknown;
  /** Si el usuario tocó un mic específico (defect vs near miss), forzar tipo. */
  forcedType?: "defect" | "near_miss";
}

export interface VoiceReportFields {
  assetId?: string | null;
  description?: string;
  classification?: string;
  severity?: string;
  operationalState?: string;
  immediateAction?: string | null;
  category?: string;
  location?: string | null;
}

export interface VoiceReportOutput {
  type: "defect" | "near_miss" | "unknown";
  confidence: "high" | "medium" | "low";
  fields: VoiceReportFields;
  missingFields: string[];
  nextQuestion: string | null;
  reasoning?: string;
  /** Echo del listado de assets usado (para que el frontend muestre nombre, no id). */
  assetSnapshot?: Array<{ id: string; name: string | null; sfiCode?: string | null }>;
}

export async function parseVoiceReport(
  session: TenantAccessSession,
  input: VoiceReportInput,
): Promise<VoiceReportOutput> {
  // Wrapper top-level: capturamos cualquier error JS no controlado y lo
  // convertimos en RouteError(500) con un mensaje útil + log con stack.
  // Sin esto el cliente solo ve "An internal error occurred".
  try {
    return await parseVoiceReportInner(session, input);
  } catch (err) {
    if (err instanceof RouteError) throw err;
    log.error("[parseVoiceReport] unhandled error:", err, {
      stack: err instanceof Error ? err.stack : undefined,
      vesselCode: input?.vesselCode,
      forcedType: input?.forcedType,
      transcriptChars: typeof input?.transcript === "string" ? input.transcript.length : null,
      userId: session.user.id,
    });
    const detail = err instanceof Error ? err.message : String(err);
    throw new RouteError(500, "VOICE_PARSE_ERROR", `Error procesando el reporte: ${detail}`);
  }
}

async function parseVoiceReportInner(
  session: TenantAccessSession,
  input: VoiceReportInput,
): Promise<VoiceReportOutput> {
  log.info(`[parseVoiceReport] start — user=${session.user.email} vessel=${input?.vesselCode} forcedType=${input?.forcedType ?? "none"} chars=${typeof input?.transcript === "string" ? input.transcript.length : 0}`);

  const transcript = String(input.transcript ?? "").trim();
  if (!transcript) throw new RouteError(400, "VALIDATION_ERROR", "Falta la transcripcion.");
  const vesselCode = String(input.vesselCode ?? "").trim().toUpperCase();
  if (!vesselCode) throw new RouteError(400, "VALIDATION_ERROR", "Falta el vesselCode.");
  // Guard defensivo: assignedVesselCodes podría ser undefined si la sesión
  // viene de un user creado antes de que ese campo existiera.
  const assignedVessels = Array.isArray(session.user.assignedVesselCodes) ? session.user.assignedVesselCodes : [];
  if (session.user.role !== "TENANT_ADMIN" && !assignedVessels.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel.");
  }

  // Listamos los assets del vessel para que la IA pueda elegir uno.
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const assets = await (prisma as unknown as {
    asset: { findMany(a: unknown): Promise<Array<{ id: string; name: string | null; sfiCode: string | null; criticality: string }>> };
  }).asset.findMany({
    where: { tenantId: tenant.id, vesselCode, deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true, sfiCode: true, criticality: true } as never,
    orderBy: { name: "asc" },
    take: ASSET_LIST_LIMIT,
  });

  const assetListLines = assets.map(a => `- ${a.id} | ${a.sfiCode ?? ""} | ${a.name ?? "(sin nombre)"} | criticidad ${a.criticality}`).join("\n");

  const forcedType = input.forcedType && ["defect", "near_miss"].includes(input.forcedType)
    ? input.forcedType
    : null;

  const userContent = [
    `Vessel: ${vesselCode}`,
    forcedType
      ? `TIPO FORZADO: "${forcedType}". El usuario eligió explícitamente este tipo desde la UI. NO clasifiques: usá "${forcedType}" sí o sí en el campo "type" del JSON, y extraé los campos correspondientes a ese tipo. Si la transcripción claramente no encaja con el tipo forzado (ej: forzado "defect" pero el usuario describe un near miss puro sin daño material), igual respetá el tipo y avisá en "reasoning" la inconsistencia.`
      : null,
    `Transcripcion del reporte verbal:\n"${transcript}"`,
    input.userAnswer ? `Respuesta del usuario a la pregunta anterior: "${input.userAnswer}"` : null,
    input.previousState ? `Estado previo del parseo (refiná):\n${JSON.stringify(input.previousState).slice(0, 2000)}` : null,
    "",
    `Assets disponibles en este vessel (id | sfiCode | nombre | criticidad):`,
    assetListLines || "(sin assets)",
  ].filter(Boolean).join("\n");

  const raw = await callClaude(
    session,
    "voice_report_parse",
    PROMPT_VOICE_REPORT,
    userContent,
    1500,
  );

  // Validamos que la IA haya devuelto un JSON de objeto. Cualquier otra cosa
  // (null, array, primitivo) lo tratamos como AI_PARSE_ERROR — antes acceder
  // a .fields/.type sobre null causaba un 500 sin contexto.
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(stripCodeFence(raw));
  } catch {
    log.warn("[parseVoiceReport] JSON parse failed, raw:", raw.slice(0, 400));
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió un formato inválido. Probá repetir el reporte con más detalle.");
  }
  if (!rawParsed || typeof rawParsed !== "object" || Array.isArray(rawParsed)) {
    log.warn("[parseVoiceReport] parsed is not an object, raw:", raw.slice(0, 400));
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió un formato inesperado. Probá repetir el reporte.");
  }

  // A partir de acá hardenizamos todo el post-procesamiento. Si algo
  // explota validando campos opcionales, loggeamos y devolvemos 502 con
  // contexto en vez de un 500 genérico "An internal error occurred".
  try {
    const parsed = rawParsed as VoiceReportOutput;

    // Validacion suave: aseguramos campos mínimos y casteamos enums.
    if (!["defect", "near_miss", "unknown"].includes(parsed.type as string)) parsed.type = "unknown";
    if (!["high", "medium", "low"].includes(parsed.confidence as string)) parsed.confidence = "low";
    if (!parsed.fields || typeof parsed.fields !== "object" || Array.isArray(parsed.fields)) {
      parsed.fields = {};
    }
    parsed.missingFields = Array.isArray(parsed.missingFields) ? parsed.missingFields : [];
    parsed.nextQuestion = typeof parsed.nextQuestion === "string" ? parsed.nextQuestion : null;

    // Si el frontend forzó un tipo, lo respetamos aún si la IA lo cambió.
    if (forcedType) parsed.type = forcedType;

    // Asset validation: si IA devolvio un assetId, debe estar en la lista.
    if (parsed.fields.assetId) {
      const found = assets.find(a => a.id === parsed.fields.assetId);
      if (!found) {
        parsed.fields.assetId = null;
        if (!parsed.missingFields.includes("assetId")) parsed.missingFields.push("assetId");
      }
    }

    // Echo del snapshot de assets para que el frontend pueda mostrar nombres
    parsed.assetSnapshot = assets.map(a => ({ id: a.id, name: a.name, sfiCode: a.sfiCode }));

    return parsed;
  } catch (err) {
    log.error("[parseVoiceReport] post-parse error:", err, "raw:", raw.slice(0, 400));
    throw new RouteError(502, "AI_POSTPROCESS_ERROR", "No se pudo procesar la respuesta de la IA. Probá repetir el reporte.");
  }
}
