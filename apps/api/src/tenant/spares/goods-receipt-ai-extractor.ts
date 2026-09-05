// Lector de remitos de repuestos (PDF escaneado o foto del celular).
// Devuelve la cabecera (proveedor, número, fecha) y las líneas del papel.
// NO decide nada sobre el catálogo ni sobre el stock: sólo transcribe lo que
// ve. El emparejamiento contra los repuestos existentes lo hace spare-match.ts
// y lo confirma el usuario en pantalla.
//
// Copia del patrón de fluid-analyses/fluid-analyses-ai-extractor.ts (vision +
// documento en base64, modelo rápido, presupuesto de IA y registro de uso).

import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";

export interface ExtractedReceiptLine {
  description: string;
  quantity: number | null;
  unit: string | null;
  partNumber: string | null;
  manufacturer: string | null;
  confidence: "high" | "medium" | "low";
}

export interface ExtractedReceipt {
  documentNumber: string | null;
  providerName: string | null;
  receivedAt: string | null;   // YYYY-MM-DD
  lines: ExtractedReceiptLine[];
  notes: string | null;
}

const SYSTEM_PROMPT = `Sos un asistente que transcribe REMITOS y notas de entrega de repuestos de barcos.

Tu tarea: leer el documento (PDF o foto) y devolver en JSON estricto la cabecera y TODAS las líneas de ítems.

ESQUEMA EXACTO:
{
  "documentNumber": string | null,   // número de remito / nota de entrega, tal como figura
  "providerName":   string | null,   // razón social del proveedor que entrega
  "receivedAt":     "YYYY-MM-DD" | null,  // fecha del remito
  "lines": [
    {
      "description":  string,                 // descripción del ítem, TAL COMO ESTÁ ESCRITA
      "quantity":     number | null,          // cantidad entregada
      "unit":         string | null,          // unidad tal como figura (u, pza, lt, kg, m, caja...)
      "partNumber":   string | null,          // código/part number del ítem si aparece
      "manufacturer": string | null,          // marca/fabricante si aparece
      "confidence":   "high" | "medium" | "low"
    }
  ],
  "notes": string | null   // cualquier observación útil (papel ilegible, ítems tachados, etc.)
}

REGLAS:
- Devolvé EXCLUSIVAMENTE JSON válido: sin texto antes ni después, sin markdown, sin comentarios.
- "description": copiá el texto del remito sin corregirlo ni traducirlo ni completar abreviaturas. Si el papel dice "FILTRO COMB. GEN 1", eso va.
- Una línea por ítem. No agrupes ítems distintos ni separes uno en varios.
- No inventes cantidades: si la cantidad no se lee, quantity = null y confidence = "low".
- Ignorá totales, subtotales, impuestos, fletes y firmas: no son ítems.
- Si el documento no es un remito o es ilegible, devolvé lines = [] y explicá en notes.
- Las cantidades con coma decimal ("1,5") van como número (1.5).
- confidence: "high" si se lee claro; "medium" si lo deducís; "low" si es conjetura.`;

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

interface ExtractInput {
  buffer: Buffer;
  mime: string;
  vesselCode?: string | null;
}

export async function extractGoodsReceipt(
  session: TenantAccessSession,
  input: ExtractInput,
): Promise<ExtractedReceipt> {
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
    text: `${localeUserReminder(locale)}\nTranscribí el remito adjunto y devolvé únicamente el JSON estructurado con la cabecera y todas las líneas.`,
  });

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
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
      feature:             "goods_receipt",
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
    throw new RouteError(502, "AI_PARSE_ERROR", "No se pudo leer el remito. Cargá los ítems a mano.");
  }

  const rawLines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const lines: ExtractedReceiptLine[] = [];
  for (const raw of rawLines) {
    if (!raw || typeof raw !== "object") continue;
    const description = normStr(raw.description);
    if (!description) continue;
    lines.push({
      description,
      quantity:     normNumber(raw.quantity),
      unit:         normStr(raw.unit),
      partNumber:   normStr(raw.partNumber),
      manufacturer: normStr(raw.manufacturer),
      confidence:   ["high", "medium", "low"].includes(raw.confidence) ? raw.confidence : "low",
    });
    // Tope defensivo: un remito real no tiene 200 renglones; si la IA se
    // desboca, no arrastramos basura a la pantalla de revisión.
    if (lines.length >= 100) break;
  }

  return {
    documentNumber: normStr(parsed?.documentNumber),
    providerName:   normStr(parsed?.providerName),
    receivedAt:     normDate(parsed?.receivedAt),
    lines,
    notes:          normStr(parsed?.notes),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripCodeFence(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function normStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function normNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
