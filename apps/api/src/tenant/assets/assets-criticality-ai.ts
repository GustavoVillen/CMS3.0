import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction } from "../ai/ai-locale";

const SYSTEM_PROMPT = `Sos un experto en mantenimiento y clasificación de equipos en buques.
Te paso los datos de un equipo (asset). Tu tarea es asignarle DOS clasificaciones independientes y justificarlas en un único rationale combinado.

═══ 1. CRITICIDAD OPERACIONAL (A / B / C) ═══

- A — Crítico: la falla compromete seguridad, vida humana, navegación, propulsión principal o cumplimiento regulatorio. Requiere redundancia o atención inmediata.
- B — Importante: la falla afecta operación pero hay alternativas o tiempo para reaccionar. Mantenimiento preventivo riguroso.
- C — Estándar: la falla tiene impacto operativo bajo. Mantenimiento básico/correctivo.

═══ 2. SAFETY-CRITICAL ISM 10.3 (true / false) ═══

ISM 10.3 exige identificar "equipos cuya falla súbita puede provocar situaciones peligrosas". Es INDEPENDIENTE de la criticidad operacional — un equipo puede ser C operacional pero ISM-crítico (ej: balsa salvavidas, motor de bote) o B operacional y NO-ISM (ej: bomba de carga estándar).

Casos típicos SAFETY-CRITICAL:
- Sistemas de gobierno y propulsión emergencia
- Sistemas contraincendio (bombas CI principales y emergencia, detección, supresión)
- Sistemas de salvamento (botes salvavidas, balsas, MOB)
- Achique de emergencia / bombas de sentina
- Generadores y switchboards de emergencia
- Detección de gases tóxicos / explosivos
- Comunicación GMDSS (radio salvamento)
- Iluminación de emergencia
- Cierre estanco automático
- Alarma general

Casos típicos NO safety-critical (operacional pero no riesgo a vidas):
- Compresores principales de servicio
- Equipos de cocina, lavandería, AC confort
- Bombas de carga (excepto si afectan estabilidad)
- Comunicación NO-GMDSS

Pista SFI: 770 (contraincendio) y 850 (emergencia) son típicamente ISM-críticos. SFI 700/800 tienen ambos casos.

═══ FORMATO DE RESPUESTA ═══

Respondé EXCLUSIVAMENTE con un JSON válido (sin markdown, sin texto extra):
{"criticality": "A" | "B" | "C", "isSafetyCritical": true | false, "rationale": "texto"}

El rationale debe ser técnico, específico al equipo (no genérico), y EXPLICAR LAS DOS DECISIONES. Sugerencia de formato:
"Criticidad <X> porque <razón operacional>. <ISM-crítico|No ISM-crítico> porque <razón ISM>."
Mencioná el grupo SFI si es relevante.`;

interface SuggestInput {
  name: string;
  vesselCode?: string | null;
  sfiCode?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
}

export interface SuggestResult {
  criticality: "A" | "B" | "C";
  isSafetyCritical: boolean;
  rationale: string;
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function suggestAssetCriticality(
  session: TenantAccessSession,
  input: SuggestInput,
): Promise<SuggestResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

  const name = (input.name ?? "").trim();
  if (!name) throw new RouteError(400, "VALIDATION_ERROR", "El nombre del equipo es requerido.");

  const payload = {
    name,
    vesselCode: input.vesselCode ?? null,
    sfiCode: input.sfiCode ?? null,
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
    serialNumber: input.serialNumber ?? null,
  };

  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const model = "claude-haiku-4-5-20251001";
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 512,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
    });
  } catch (err) {
    log.error("[suggestAssetCriticality] Anthropic call failed:", err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo obtener sugerencia de la IA.");
  }

  // Telemetría no bloqueante. Tenant via cache (5min TTL) — evita un
  // findUnique extra por cada llamada IA.
  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId: tenant.id,
      tenantSlug: session.tenantSlug,
      userId: session.user.id,
      userEmail: session.user.email,
      vesselCode: input.vesselCode ?? null,
      feature: "asset_criticality_suggestion",
      model,
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

  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió una respuesta inválida.");
  }

  const crit = String(parsed?.criticality ?? "").toUpperCase();
  if (crit !== "A" && crit !== "B" && crit !== "C") {
    throw new RouteError(502, "AI_PARSE_ERROR", `Criticidad inválida: ${crit}`);
  }
  const isSafetyCritical = Boolean(parsed?.isSafetyCritical);
  const rationale = String(parsed?.rationale ?? "").trim();
  if (!rationale) {
    throw new RouteError(502, "AI_PARSE_ERROR", "Falta el fundamento.");
  }

  return { criticality: crit as "A" | "B" | "C", isSafetyCritical, rationale };
}
