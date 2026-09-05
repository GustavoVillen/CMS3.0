// Desempate por IA de las líneas de remito que el matcher por texto no pudo
// resolver solo (spare-match.ts las marca "ambiguous" o "none").
//
// Por qué hace falta: el remito escribe "FILTRO COMB. GEN 1" y el catálogo dice
// "Filtro de combustible generador N°1". Comparar palabras alcanza a veces; el
// resto necesita entender el dominio. Esto es exactamente lo mismo que hace
// ai/asset-ai-match.ts para los equipos.
//
// Anti-alucinación (misma regla que asset-ai-match): el modelo NO devuelve ids.
// Devuelve el número de fila de la lista que se le mostró; un número fuera de
// rango se descarta. Y aun con match, nada se guarda sin que el usuario lo
// confirme en la pantalla de revisión.
import type Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey } from "../ai/ai-provider";
import { getCachedTenantBySlug } from "../tenant-cache";
import { recordAiUsage } from "../usage/usage-service";
import type { TenantAccessSession } from "../auth/session-store";
import type { SpareCandidate } from "./spare-match";

export interface AiLineInput {
  /** Índice de la línea dentro del remito (se devuelve tal cual). */
  line: number;
  description: string;
  partNumber?: string | null;
  candidates: SpareCandidate[];
}

export interface AiLineDecision {
  line: number;
  spareId: string | null;
  confidence: "high" | "medium" | "low";
  reason: string | null;
}

const SYSTEM_PROMPT = `Sos un pañolero de barco que recibe repuestos y decide si lo que llegó ya está en el stock del buque o es un artículo nuevo.

Recibís una lista de ÍTEMS de un remito. Cada ítem trae su texto tal como lo escribió el proveedor y una lista NUMERADA de repuestos parecidos que ya existen en el buque.

Devolvés EXCLUSIVAMENTE un JSON, sin markdown ni texto alrededor:
{ "results": [ { "line": <número del ítem>, "index": <número del repuesto de SU lista> | null, "confidence": "high"|"medium"|"low", "reason": "<una frase corta>" } ] }

REGLAS:
- "index" es el número que precede al repuesto en la lista DE ESE ítem. Nunca inventes números que no estén en esa lista.
- Si ninguno corresponde, "index": null. Es preferible null a un match dudoso: un null hace que el usuario lo dé de alta a mano, un match equivocado suma stock al repuesto equivocado.
- Es el MISMO repuesto aunque cambie la redacción o las abreviaturas: "FILTRO COMB. GEN 1" = "Filtro de combustible generador N°1"; "EMPAQ. TAPA CIL." = "Empaquetadura de tapa de cilindro"; "O-RING 25X3" = "Aro tórico 25x3".
- NO es el mismo repuesto si cambia la función, la medida o el equipo al que pertenece: filtro de aceite ≠ filtro de combustible; correa 13x1200 ≠ correa 13x900; filtro del generador 1 ≠ filtro del generador 2 cuando el catálogo los tiene separados.
- Si el catálogo NO separa por número (un solo "Filtro de combustible generador") y el remito dice "GEN 1", es el mismo: elegilo.
- El part number manda: si coincide con el de un repuesto de la lista, es ese, aunque el texto difiera.
- "high" cuando es inequívoco; "medium" cuando es la lectura razonable; "low" cuando es conjetura (el usuario lo va a revisar igual).`;

export async function matchSparesByAi(
  session: TenantAccessSession,
  vesselCode: string,
  lines: AiLineInput[],
): Promise<AiLineDecision[]> {
  const usable = lines.filter(l => l.candidates.length > 0 && l.description.trim());
  if (usable.length === 0) return [];

  const apiKey = aiApiKey();
  if (!apiKey) return [];

  const prompt = usable.map(l => {
    const list = l.candidates
      .map((c, i) => `   ${i + 1}. ${c.name} [${c.sku}]${c.manufacturerPartNumber ? ` P/N ${c.manufacturerPartNumber}` : ""}`)
      .join("\n");
    const pn = l.partNumber ? ` (P/N del remito: ${l.partNumber})` : "";
    return `Ítem ${l.line}: "${l.description}"${pn}\n   Repuestos parecidos del buque:\n${list}`;
  }).join("\n\n");

  const client = createAiClient({ apiKey, timeout: 45_000, maxRetries: 1 });
  const model = AI_MODEL.fast;
  const started = Date.now();

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });
  } catch {
    // Sin IA la pantalla igual muestra los candidatos del matcher por texto.
    return [];
  }

  void recordUsage(session, vesselCode, model, response, started);

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: { results?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.results)) return [];

  const byLine = new Map(usable.map(l => [l.line, l]));
  const out: AiLineDecision[] = [];
  for (const item of parsed.results) {
    if (!item || typeof item !== "object") continue;
    const r = item as { line?: unknown; index?: unknown; confidence?: unknown; reason?: unknown };
    const lineNo = Number(r.line);
    const input = byLine.get(lineNo);
    if (!input) continue;

    const index = Number(r.index);
    const valid = Number.isInteger(index) && index >= 1 && index <= input.candidates.length;
    out.push({
      line: lineNo,
      spareId: valid ? input.candidates[index - 1]!.id : null,
      confidence: ["high", "medium", "low"].includes(String(r.confidence))
        ? (String(r.confidence) as AiLineDecision["confidence"])
        : "low",
      reason: typeof r.reason === "string" && r.reason.trim() ? r.reason.trim() : null,
    });
  }
  return out;
}

async function recordUsage(
  session: TenantAccessSession,
  vesselCode: string,
  model: string,
  response: Anthropic.Message,
  started: number,
): Promise<void> {
  try {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId:            tenant.id,
      tenantSlug:          session.tenantSlug,
      userId:              session.user.id,
      userEmail:           session.user.email,
      vesselCode,
      feature:             "goods_receipt",
      model,
      inputTokens:         response.usage.input_tokens,
      outputTokens:        response.usage.output_tokens,
      cacheReadTokens:     response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs:           Date.now() - started,
    });
  } catch { /* swallow */ }
}
