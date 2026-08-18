// Lee la foto/PDF de una OT llenada a mano en papel (flujo habitual a bordo
// sin conectividad) y extrae los campos que el formulario de creación de OT
// (CreateWorkOrderModal, modo standalone) puede completar. Mismo patrón que
// fluid-analyses-ai-extractor.ts: nunca guarda nada, sólo devuelve el JSON
// con confianza por campo para que el usuario revise y confirme.
//
// No incluye tipo/clasificación (preventivo/correctivo/inspección): eso es
// una decisión de criterio, no una transcripción de dato — se deja siempre
// al usuario, igual que el copiloto nunca decide criticidad ni cumplimiento.
import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { suggestAssetByFuzzyText } from "../ai/asset-fuzzy-match";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";

export interface ExtractedField<T> {
  value: T | null;
  confidence: "high" | "medium" | "low";
}

export interface ExtractedWorkOrder {
  title:               ExtractedField<string>;
  description:         ExtractedField<string>;   // tareas a ejecutar
  acceptanceCriteria:  ExtractedField<string>;
  priority:            ExtractedField<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">;
  dueDate:             ExtractedField<string>;    // ISO date
  assetReferenceText:  ExtractedField<string>;    // texto del equipo tal como está escrito en el papel
  assetIdSuggestion:   { id: string; name: string; score: number } | null;
  notes?: string;
}

const SYSTEM_PROMPT = `Sos un experto en leer órdenes de trabajo (OT) de mantenimiento naval llenadas a mano en papel, para volcarlas al sistema digital.

Tu tarea: extraer del documento (foto o PDF) los siguientes campos en JSON estricto. Si un campo no está presente o no podés determinarlo con razonabilidad, devolvé null.

Para cada campo (excepto "notes" y "assetIdSuggestion"), devolvés un objeto con esta forma:
  { "value": ..., "confidence": "high" | "medium" | "low" }

CAMPOS A EXTRAER (esquema exacto):
{
  "title":              { value: string|null, confidence },  // título/asunto breve de la orden
  "description":        { value: string|null, confidence },  // la tarea o el trabajo a realizar, tal como está descripto (puede ser una lista)
  "acceptanceCriteria": { value: string|null, confidence },  // criterios de aceptación o de cierre, SOLO si el papel los menciona explícitamente
  "priority":           { value: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL"|null, confidence },  // SOLO si el papel marca explícitamente una prioridad/urgencia
  "dueDate":            { value: "YYYY-MM-DD"|null, confidence },  // fecha límite o requerida, si figura
  "assetReferenceText": { value: string|null, confidence },  // texto que identifica al equipo (ej: "Motor Principal Babor", "Generador 2")
  "notes":              string | null   // cualquier observación útil que no encaja en los campos de arriba
}

REGLAS:
- "high" cuando el dato está claramente escrito y legible.
- "medium" cuando lo deducís con cierta seguridad pero la letra o el papel no son del todo claros.
- "low" cuando es una conjetura razonable.
- NUNCA inventes un valor para completar un campo vacío: si no está en el papel, "value": null.
- Devolvé EXCLUSIVAMENTE JSON válido — sin texto antes, sin markdown, sin comentarios, sin trailing comma.
- Si la imagen es ilegible o no es una orden de trabajo, devolvé un JSON con todos los value en null y notes explicando por qué.`;

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

interface ExtractInput {
  buffer: Buffer;
  mime: string;
  vesselCode?: string | null;
}

export async function extractWorkOrderScan(
  session: TenantAccessSession,
  input: ExtractInput,
): Promise<ExtractedWorkOrder> {
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");

  const { buffer, mime } = input;
  if (!buffer || buffer.length === 0) throw new RouteError(400, "EMPTY_FILE", "El archivo está vacío.");
  if (buffer.length > 15 * 1024 * 1024) throw new RouteError(413, "FILE_TOO_LARGE", "El archivo excede 15 MB.");

  const isImage    = ALLOWED_IMAGE_MIMES.has(mime);
  const isDocument = mime === "application/pdf";
  if (!isImage && !isDocument) {
    throw new RouteError(415, "UNSUPPORTED_MEDIA", `Tipo no soportado: ${mime}. Use PDF, JPG, PNG, GIF o WebP.`);
  }

  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const base64 = buffer.toString("base64");
  const client = createAiClient({ apiKey, timeout: 60_000, maxRetries: 1 });

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
  const model = AI_MODEL.fast;
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);
  contentBlocks.push({
    type: "text",
    text: `${localeUserReminder(locale)}\nExtraé los campos de la orden de trabajo en papel adjunta y devolvé únicamente el JSON estructurado.`,
  });

  const response = await client.messages.create({
    model,
    max_tokens: 1500,
    system: [
      { type: "text", text: localeInstruction(locale) },
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: contentBlocks }],
  });

  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId:            tenant.id,
      tenantSlug:          session.tenantSlug,
      userId:              session.user.id,
      userEmail:           session.user.email,
      vesselCode:          input.vesselCode ?? null,
      feature:             "wo_scan_extraction",
      model,
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
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió una respuesta inválida. Completá el formulario manualmente.");
  }

  const result: ExtractedWorkOrder = {
    title:              shapeField(parsed.title, normStr),
    description:        shapeField(parsed.description, normStr),
    acceptanceCriteria: shapeField(parsed.acceptanceCriteria, normStr),
    priority:           shapeField(parsed.priority, (v) => ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(v)) ? (String(v) as any) : null),
    dueDate:            shapeField(parsed.dueDate, normDate),
    assetReferenceText: shapeField(parsed.assetReferenceText, normStr),
    assetIdSuggestion:  null,
    notes:              typeof parsed.notes === "string" ? parsed.notes : undefined,
  };

  if (result.assetReferenceText.value) {
    result.assetIdSuggestion = await suggestAssetByFuzzyText(session, input.vesselCode ?? null, result.assetReferenceText.value);
  }

  return result;
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function shapeField<T>(raw: unknown, parser: (v: unknown) => T | null): ExtractedField<T> {
  if (!raw || typeof raw !== "object") return { value: null, confidence: "low" };
  const r = raw as { value?: unknown; confidence?: unknown };
  const value = parser(r.value);
  const confidence = ["high", "medium", "low"].includes(r.confidence as string) ? (r.confidence as ExtractedField<T>["confidence"]) : "low";
  return { value, confidence };
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
