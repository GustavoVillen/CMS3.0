// Resolución de un equipo por IA a partir del texto con que lo nombra un
// documento externo (reporte de laboratorio, remito, informe de tercero).
//
// Por qué existe además de `suggestAssetByFuzzyText`: el fuzzy por tokens sólo
// acierta cuando el documento usa casi las mismas palabras que el maestro de
// equipos. En los reportes reales no pasa — el laboratorio escribe "MOTOR
// PROPULSOR N1" y el equipo se llama "Motor Principal #1"; "TIMON N 2" es el
// "Servomotor N°2 del Sistema de Gobierno". Ahí hace falta entender el dominio,
// no comparar palabras.
//
// Anti-alucinación: el modelo NO devuelve un id. Devuelve el número de la fila
// de la lista que se le pasó, y este módulo lo traduce al id real. Un número
// fuera de rango se trata como "no encontrado", nunca como un id inventado.
import type Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey } from "./ai-provider";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getCachedTenantBySlug } from "../tenant-cache";
import { recordAiUsage } from "../usage/usage-service";
import type { TenantAccessSession } from "../auth/session-store";

export interface AssetAiMatch {
  id: string;
  name: string;
  confidence: "high" | "medium" | "low";
  /** Por qué el modelo eligió ese equipo. Se le muestra al usuario en la revisión. */
  reason: string | null;
}

export interface AssetCandidate {
  id: string;
  name: string | null;
  assetCode: string | null;
}

const SYSTEM_PROMPT = `Sos un técnico naval que identifica de qué equipo de a bordo habla un documento externo (reporte de laboratorio, remito, informe de tercero).

Recibís:
1. El texto con el que el documento nombra al equipo.
2. La lista NUMERADA de los equipos reales del buque.

Devolvés EXCLUSIVAMENTE un JSON con esta forma, sin markdown ni texto alrededor:
{ "index": <número de la lista> | null, "confidence": "high" | "medium" | "low", "reason": "<una frase corta>" }

REGLAS:
- "index" es el número que precede al equipo en la lista. Nunca inventes un número que no esté en la lista.
- Si ningún equipo de la lista corresponde, devolvé "index": null y explicá en "reason" por qué.
- Traducí la jerga del documento al nombre del maestro. Ejemplos del dominio:
  "MOTOR PROPULSOR N1" / "ME N°1" / "MAIN ENGINE 1" → el motor principal número 1.
  "MOTOR GENERADOR N2" / "AUXILIAR 2" / "DG2" → el motor auxiliar/generador número 2.
  "TIMON N1" / "STEERING 1" → el servomotor / equipo de gobierno número 1.
  "COMPRESOR" → el compresor de aire de arranque, si hay uno solo.
- El NÚMERO importa: "N1" no es "N2". Si el documento numera y en la lista hay varios equipos iguales numerados, elegí el del mismo número. Si el documento no numera y en la lista hay varios candidatos numerados, devolvé "index": null (no adivines cuál).
- Babor/Estribor: sólo usalos para desempatar si el documento también los menciona.
- "high" si la correspondencia es inequívoca; "medium" si es la lectura razonable pero el nombre difiere bastante; "low" si es una conjetura.`;

/**
 * Resuelve el equipo del buque que corresponde a `referenceText`.
 * Devuelve null si no hay IA configurada, si el buque no tiene equipos, o si el
 * modelo no encontró correspondencia.
 */
export async function matchAssetByAi(
  session: TenantAccessSession,
  vesselCode: string,
  referenceText: string,
  opts: { candidates?: AssetCandidate[]; feature?: string } = {},
): Promise<AssetAiMatch | null> {
  const text = referenceText.trim();
  if (!text) return null;

  const apiKey = aiApiKey();
  if (!apiKey) return null;

  const candidates = opts.candidates ?? await loadVesselAssets(session, vesselCode);
  if (candidates.length === 0) return null;

  const list = candidates
    .map((a, i) => `${i + 1}. ${a.name ?? a.assetCode ?? a.id}${a.assetCode && a.name ? ` (${a.assetCode})` : ""}`)
    .join("\n");

  const client = createAiClient({ apiKey, timeout: 30_000, maxRetries: 1 });
  const model = AI_MODEL.fast;
  const started = Date.now();

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 256,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: `Equipo según el documento: "${text}"\n\nEquipos del buque:\n${list}`,
      }],
    });
  } catch {
    // Sin match por IA el llamador cae al fuzzy o le pide el equipo al usuario.
    return null;
  }

  void recordUsage(session, vesselCode, model, response, started, opts.feature ?? "asset_match");

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: { index?: unknown; confidence?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const index = Number(parsed.index);
  if (!Number.isInteger(index) || index < 1 || index > candidates.length) return null;

  const asset = candidates[index - 1]!;
  const confidence = ["high", "medium", "low"].includes(String(parsed.confidence))
    ? (String(parsed.confidence) as AssetAiMatch["confidence"])
    : "low";

  return {
    id: asset.id,
    name: asset.name ?? asset.assetCode ?? asset.id,
    confidence,
    reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : null,
  };
}

/** Equipos del buque, en el orden en que se le muestran al modelo. */
export async function loadVesselAssets(
  session: TenantAccessSession,
  vesselCode: string,
): Promise<AssetCandidate[]> {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenant = await getCachedTenantBySlug(session.tenantSlug);
  if (!tenant) return [];
  return (prisma as any).asset.findMany({
    where: { tenantId: tenant.id, vesselCode, deletedAt: null },
    select: { id: true, name: true, assetCode: true },
    orderBy: { assetCode: "asc" },
    take: 500,
  });
}

async function recordUsage(
  session: TenantAccessSession,
  vesselCode: string,
  model: string,
  response: Anthropic.Message,
  started: number,
  feature: string,
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
      feature,
      model,
      inputTokens:         response.usage.input_tokens,
      outputTokens:        response.usage.output_tokens,
      cacheReadTokens:     response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs:           Date.now() - started,
    });
  } catch { /* swallow */ }
}
