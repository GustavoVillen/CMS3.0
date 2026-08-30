import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";

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

═══ 3. ¿DEBE ESTAR EN EL PLAN DE MANTENIMIENTO? (true / false) ═══

No todo equipo lleva plan preventivo, pero la decisión tiene que estar tomada y escrita.

LLEVA PLAN (requiresMaintenancePlan = true):
- Todo lo clasificado A, sin excepción.
- Todo lo SAFETY-CRITICAL ISM 10.3, sin excepción: el Código exige mantenerlo Y probarlo periódicamente.
- Maquinaria rotante, motores, bombas, compresores, reductores, sistemas hidráulicos y eléctricos de potencia: tienen desgaste y horas de servicio.
- Todo lo que el fabricante, la clase o la bandera obliga a mantener o inspeccionar con frecuencia definida.

PUEDE NO LLEVAR PLAN (requiresMaintenancePlan = false):
- Consumibles y elementos de reemplazo directo sin mantenimiento posible.
- Mobiliario, habitabilidad y confort sin partes móviles ni energía peligrosa.
- Estructura pasiva y accesorios que se atienden por inspección general del buque o en dique.
- Equipo redundante de bajo impacto cuya falla se resuelve por correctivo sin consecuencia operativa.
Ante la duda, LLEVA PLAN.

═══ FORMATO DE RESPUESTA ═══

Respondé EXCLUSIVAMENTE con un JSON válido (sin markdown, sin texto extra):
{"criticality": "A" | "B" | "C", "isSafetyCritical": true | false, "requiresMaintenancePlan": true | false, "rationale": "texto"}

El rationale debe ser técnico, específico al equipo (no genérico), y EXPLICAR LAS TRES DECISIONES. Formato:
"Criticidad <X> porque <razón operacional>. <ISM-crítico|No ISM-crítico> porque <razón ISM>. Requiere plan de mantenimiento: <SÍ|NO> — <por qué>."
Mencioná el grupo SFI si es relevante.

Si en los datos viene "criticidadAsignada" (A/B/C), JUSTIFICÁ ESA, no la que vos hubieras elegido: la criticidad operacional es un criterio de la empresa y ya la decidieron. Sólo si es claramente incorrecta, agregá al final una oración que empiece con "Revisar criticidad:" explicando cuál correspondería y por qué; devolvé igual en el JSON la criticidad asignada.

El flag SAFETY-CRITICAL ISM 10.3, en cambio, EVALUALO VOS SIEMPRE, venga o no "ismCriticoAsignado": no es una preferencia de la empresa sino una definición del Código, y si el equipo entra en la definición el flag corresponde aunque hoy esté sin marcar.`;

interface SuggestInput {
  name: string;
  vesselCode?: string | null;
  sfiCode?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  /** Clasificación ya asignada por el usuario. Si viene, la IA la justifica en
   *  vez de reclasificar (y avisa con "Revisar criticidad:" si la ve mal). */
  currentCriticality?: "A" | "B" | "C" | null;
  currentSafetyCritical?: boolean | null;
}

export interface SuggestResult {
  criticality: "A" | "B" | "C";
  isSafetyCritical: boolean;
  /** Si el equipo debe estar cubierto por un plan de mantenimiento. */
  requiresMaintenancePlan: boolean;
  rationale: string;
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function suggestAssetCriticality(
  session: TenantAccessSession,
  input: SuggestInput,
): Promise<SuggestResult> {
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");

  const name = (input.name ?? "").trim();
  if (!name) throw new RouteError(400, "VALIDATION_ERROR", "El nombre del equipo es requerido.");

  const payload = {
    name,
    vesselCode: input.vesselCode ?? null,
    sfiCode: input.sfiCode ?? null,
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
    serialNumber: input.serialNumber ?? null,
    criticidadAsignada: input.currentCriticality ?? null,
    ismCriticoAsignado: input.currentSafetyCritical ?? null,
  };

  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const client = createAiClient({ apiKey, timeout: 30_000, maxRetries: 1 });
  const model = AI_MODEL.fast;
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
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${JSON.stringify(payload, null, 2)}` }],
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
  // Ante una respuesta ambigua, el default es que SÍ lleva plan: dejar un equipo
  // fuera del PMS por un parseo dudoso es el error caro.
  const requiresMaintenancePlan = parsed?.requiresMaintenancePlan === false && !isSafetyCritical ? false : true;
  const rationale = String(parsed?.rationale ?? "").trim();
  if (!rationale) {
    throw new RouteError(502, "AI_PARSE_ERROR", "Falta el fundamento.");
  }

  return { criticality: crit as "A" | "B" | "C", isSafetyCritical, requiresMaintenancePlan, rationale };
}
