// AI extractor for fluid analysis lab reports.
// Receives a file (PDF or image), asks Claude (vision/document) to extract
// structured data, and returns it with per-field confidence scores.

import Anthropic from "@anthropic-ai/sdk";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { FLUID_TYPES, type FluidType } from "./fluid-analyses-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getCachedTenantBySlug } from "../tenant-cache";
import { recordAiUsage } from "../usage/usage-service";

export interface ExtractedField<T> {
  value: T | null;
  confidence: "high" | "medium" | "low";
}

export interface ExtractedReport {
  fluidType: ExtractedField<FluidType>;
  sampledAt: ExtractedField<string>;          // ISO date
  receivedAt: ExtractedField<string>;
  runningHours: ExtractedField<number>;
  labName: ExtractedField<string>;
  labReference: ExtractedField<string>;
  fluidProduct: ExtractedField<string>;
  assetReferenceText: ExtractedField<string>; // texto crudo del equipo (ej: "Motor Principal Babor")
  assetIdSuggestion: { id: string; name: string; score: number } | null;
  verdict: ExtractedField<"NORMAL" | "CAUTION" | "CRITICAL" | "ACTION_REQUIRED">;
  summary: ExtractedField<string>;
  parameters: Record<string, { value: number | string; unit?: string; confidence: "high" | "medium" | "low" }>;
  notes?: string;
}

const SYSTEM_PROMPT = `Sos un experto en interpretar reportes de laboratorio de análisis de fluidos marítimos (lubricantes, combustibles, agua, refrigerante).

Tu tarea: extraer del documento (PDF o imagen) los siguientes campos en JSON estricto. Si un campo no está presente o no podés determinarlo, devolvé null.

Para cada campo top-level (excepto "parameters", "notes" y "assetIdSuggestion"), devolvés un objeto con esta forma:
  { "value": ..., "confidence": "high" | "medium" | "low" }

Para "parameters", devolvés un objeto donde cada clave es el código del parámetro normalizado (ej: "fe", "cu", "tbn", "viscosity100", "water", "ph", "nitrites", "sediment", "sulfur", "density", "iso", etc.) y el valor es:
  { "value": <número o string>, "unit": "ppm"|"%"|"cSt"|"mgKOH/g"|...", "confidence": "high"|"medium"|"low" }

CAMPOS A EXTRAER (esquema exacto):
{
  "fluidType":         { value: "ENGINE_OIL"|"HYDRAULIC_OIL"|"GEARBOX_OIL"|"TRANSMISSION_OIL"|"FUEL_DIESEL"|"FUEL_GASOIL"|"COOLING_WATER"|"BOILER_WATER"|"POTABLE_WATER"|"REFRIGERANT"|"OTHER"|null, confidence },
  "sampledAt":         { value: "YYYY-MM-DD"|null, confidence },        // fecha de toma de muestra
  "receivedAt":        { value: "YYYY-MM-DD"|null, confidence },        // fecha de recepción/análisis del lab
  "runningHours":      { value: number|null, confidence },              // horas de máquina al momento de la toma
  "labName":           { value: string|null, confidence },              // nombre del laboratorio
  "labReference":      { value: string|null, confidence },              // protocolo o referencia interna del lab
  "fluidProduct":      { value: string|null, confidence },              // marca/grado del fluido (ej: "Mobilgard M312 SAE 30")
  "assetReferenceText":{ value: string|null, confidence },              // texto que identifica al equipo en el reporte (ej: "ME PORT", "Generador 1")
  "verdict":           { value: "NORMAL"|"CAUTION"|"CRITICAL"|"ACTION_REQUIRED"|null, confidence }, // veredicto final del lab
  "summary":           { value: string|null, confidence },              // recomendación textual del lab si aparece
  "parameters":        { <param_key>: { value, unit, confidence }, ... },
  "notes":             string | null   // cualquier observación útil que no encaja en los campos
}

REGLAS:
- "high" cuando el dato está claramente impreso y legible.
- "medium" cuando lo deducís con cierta seguridad pero puede tener error tipográfico o no ser explícito.
- "low" cuando es una conjetura razonable (ejemplo: el reporte no dice fecha de toma pero infieres del contexto).
- Para parámetros: usar siempre nombres en minúsculas y abreviados estándar (fe, cu, cr, pb, al, sn, si, water, fuel, tbn, tan, viscosity40, viscosity100, ph, alkalinity, hardness, nitrites, chlorides, freeChlorine, sediment, sulfur, density, iso, particles, etc.)
- Devolvé EXCLUSIVAMENTE JSON válido — sin texto antes, sin markdown, sin comentarios, sin trailing comma.
- Si la imagen es ilegible o no es un reporte de análisis, devolvé un JSON con todos los value en null y notes explicando por qué.`;

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

interface ExtractInput {
  buffer: Buffer;
  mime: string;
  vesselCode?: string | null;
}

export async function extractFluidReport(
  session: TenantAccessSession,
  input: ExtractInput,
): Promise<ExtractedReport> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

  const { buffer, mime } = input;
  if (!buffer || buffer.length === 0) throw new RouteError(400, "EMPTY_FILE", "El archivo está vacío.");
  if (buffer.length > 15 * 1024 * 1024) throw new RouteError(413, "FILE_TOO_LARGE", "El archivo excede 15 MB.");

  const isImage    = ALLOWED_IMAGE_MIMES.has(mime);
  const isDocument = mime === "application/pdf";
  if (!isImage && !isDocument) {
    throw new RouteError(415, "UNSUPPORTED_MEDIA", `Tipo no soportado: ${mime}. Use PDF, JPG, PNG, GIF o WebP.`);
  }

  const base64 = buffer.toString("base64");
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });

  const contentBlocks: Anthropic.ContentBlockParam[] = [];
  if (isImage) {
    contentBlocks.push({
      type: "image",
      source: { type: "base64", media_type: mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 },
    });
  } else {
    contentBlocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    } as unknown as Anthropic.ContentBlockParam);
  }
  contentBlocks.push({
    type: "text",
    text: "Extraé los campos del reporte de análisis adjunto y devolvé únicamente el JSON estructurado.",
  });

  // Antes Sonnet 4.6 + 4096. Haiku ya hace OCR de PDF y es ~5× más rápido/barato.
  // Se mantiene Sonnet como fallback potencial si se mide caída de precisión.
  const fluidModel = "claude-haiku-4-5-20251001";
  const aiStarted = Date.now();
  const response = await client.messages.create({
    model: fluidModel,
    max_tokens: 2048,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: contentBlocks }],
  });

  // Record token usage — non-blocking. Resolve tenantId lazily.
  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId:            tenant.id,
      tenantSlug:          session.tenantSlug,
      userId:              session.user.id,
      userEmail:           session.user.email,
      vesselCode:          input.vesselCode ?? null,
      feature:             "fluid_analyses",
      model:               fluidModel,
      inputTokens:         response.usage.input_tokens,
      outputTokens:        response.usage.output_tokens,
      cacheReadTokens:     response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs:           Date.now() - aiStarted,
    });
  })().catch(() => { /* swallow */ });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  let parsed: any;
  try {
    const jsonText = stripCodeFence(text);
    parsed = JSON.parse(jsonText);
  } catch {
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió una respuesta inválida. Cargá el resultado manualmente.");
  }

  // Sanitize and shape
  const result: ExtractedReport = {
    fluidType:          shapeField(parsed.fluidType, (v) => FLUID_TYPES.includes(v as FluidType) ? (v as FluidType) : null),
    sampledAt:          shapeField(parsed.sampledAt,  (v) => normDate(v)),
    receivedAt:         shapeField(parsed.receivedAt, (v) => normDate(v)),
    runningHours:       shapeField(parsed.runningHours, (v) => Number.isFinite(Number(v)) ? Number(v) : null),
    labName:            shapeField(parsed.labName,      (v) => normStr(v)),
    labReference:       shapeField(parsed.labReference, (v) => normStr(v)),
    fluidProduct:       shapeField(parsed.fluidProduct, (v) => normStr(v)),
    assetReferenceText: shapeField(parsed.assetReferenceText, (v) => normStr(v)),
    assetIdSuggestion:  null,
    verdict:            shapeField(parsed.verdict, (v) => ["NORMAL","CAUTION","CRITICAL","ACTION_REQUIRED"].includes(String(v)) ? String(v) as any : null),
    summary:            shapeField(parsed.summary, (v) => normStr(v)),
    parameters:         shapeParameters(parsed.parameters),
    notes:              typeof parsed.notes === "string" ? parsed.notes : undefined,
  };

  // Fuzzy match against tenant assets
  if (result.assetReferenceText.value) {
    result.assetIdSuggestion = await suggestAsset(session, input.vesselCode ?? null, result.assetReferenceText.value);
  }

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripCodeFence(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function shapeField<T>(raw: unknown, parser: (v: unknown) => T | null): ExtractedField<T> {
  if (!raw || typeof raw !== "object") return { value: null, confidence: "low" };
  const r = raw as { value?: unknown; confidence?: unknown };
  const value = parser(r.value);
  const confidence = ["high", "medium", "low"].includes(r.confidence as string) ? (r.confidence as ExtractedField<T>["confidence"]) : "low";
  return { value, confidence };
}

function shapeParameters(raw: unknown): ExtractedReport["parameters"] {
  const out: ExtractedReport["parameters"] = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, rawVal] of Object.entries(raw as Record<string, unknown>)) {
    if (!rawVal || typeof rawVal !== "object") continue;
    const r = rawVal as { value?: unknown; unit?: unknown; confidence?: unknown };
    const v = r.value;
    const value = typeof v === "number" ? v : (typeof v === "string" && v.trim() ? (Number.isFinite(Number(v)) ? Number(v) : v.trim()) : null);
    if (value === null) continue;
    out[key] = {
      value,
      unit: typeof r.unit === "string" ? r.unit : undefined,
      confidence: ["high", "medium", "low"].includes(r.confidence as string) ? (r.confidence as "high" | "medium" | "low") : "low",
    };
  }
  return out;
}

function normStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function normDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Fuzzy match the asset reference text against tenant assets (and maybe vessel-scoped)
async function suggestAsset(
  session: TenantAccessSession,
  vesselCode: string | null,
  referenceText: string,
): Promise<ExtractedReport["assetIdSuggestion"]> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await (prisma as any).tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return null;

  const where: any = { tenantId: tenant.id, deletedAt: null };
  if (vesselCode) where.vesselCode = vesselCode;
  const assets: Array<{ id: string; name: string | null; assetCode: string | null }> = await (prisma as any).asset.findMany({
    where, select: { id: true, name: true, assetCode: true }, take: 500,
  });

  const ref = normalize(referenceText);
  let best: { id: string; name: string; score: number } | null = null;
  for (const a of assets) {
    const candidate = `${a.name ?? ""} ${a.assetCode ?? ""}`;
    const cand = normalize(candidate);
    const score = jaccard(ref, cand);
    if (!best || score > best.score) best = { id: a.id, name: a.name ?? a.assetCode ?? a.id, score };
  }
  // Threshold 0.5: requiere al menos 50% de tokens compartidos (Jaccard).
  // El 0.25 anterior era muy permisivo — "Motor Port" matchea con "Pump Motor"
  // por compartir 1 token. Un match falso en fluid analyses lleva a registrar
  // el análisis contra el activo equivocado.
  if (best && best.score >= 0.5) return best;
  return null;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function jaccard(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
