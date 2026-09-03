import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { getVesselAiContext } from "../ai/vessel-ai-context";

const MODEL = AI_MODEL.fast;

const SYSTEM_PROMPT = `Sos experto en RCM (Reliability-Centered Maintenance) aplicado a buques.

CONTEXTO IMPORTANTE — qué te están pidiendo:
RCM clasifica cada plan/tarea por la CONSECUENCIA que se produce si la tarea NO se ejecuta y por lo tanto la falla del equipo ocurre. La pregunta es: "si nunca hago esta tarea, ¿qué pasa cuando el equipo falle?".

NO confundir con Análisis de Riesgo del trabajo / JSA (otra herramienta del sistema). El JSA pregunta lo opuesto: "¿qué peligros corre el operario MIENTRAS hace la tarea?". El JSA mira riesgos al ejecutar (espacio confinado, hot work, EPP). Vos NO tenés que pensar en eso.

Vos pensás en: si esta tarea no se hace y el equipo falla por esa razón, ¿la falla mata gente? ¿contamina? ¿para la operación? ¿solo cuesta plata? La consecuencia es DEL EQUIPO FALLADO en el futuro, no del trabajo de mantenimiento.

Casos típicos donde se ve la diferencia:
- Probar bomba CI standby: JSA dice LOW (apretar un botón). RCM dice SAFETY (si no se prueba y falla en incendio, mueren personas).
- Cambiar ánodos en sentina: JSA dice HIGH (espacio confinado). RCM dice NON_OPERATIONAL (si se posterga, corrosión gradual sin impacto inmediato).

TENÉ EN CUENTA EL TIPO DE TAREA (si se indica):
- INSPECCIÓN / PRUEBA: busca detectar una falla OCULTA. Si no se ejecuta, la falla queda sin detectar hasta que se necesita la función — típico de dispositivos de protección y seguridades (alarmas, paradas de emergencia, bombas standby), que suelen caer en SAFETY o ENVIRONMENTAL. Preguntate: "¿qué función protectora queda sin verificar y qué pasa cuando se la necesita?".
- MANTENIMIENTO: previene la degradación o falla funcional del propio equipo. Si no se hace, el equipo se degrada y eventualmente falla en servicio (derate, paro → OPERATIONAL; o solo costo de reparación → NON_OPERATIONAL).

Las 4 categorías RCM:
- SAFETY: la falla pone en riesgo a personas (lesión, fatalidad). Ej: bomba CI standby no probada → no arranca en incendio.
- ENVIRONMENTAL: la falla causa daño ambiental (vertido oleoso, emisión, contaminación). Ej: separador OWS no calibrado → descarga sobre 15ppm.
- OPERATIONAL: la falla detiene o degrada operación (paro, retraso, pérdida de carga). Ej: motor principal sin cambio de filtros → derate.
- NON_OPERATIONAL: la falla solo genera costo de reparación, sin impacto en seguridad/ambiente/operación. Ej: pintura de bandejas, cambio de ojos de buey rotos.

ALCANCE — juzgá la tarea que está escrita, no la que podría existir (regla dura):
- Clasificá la consecuencia de no ejecutar ESTA tarea, tal como está descripta. No la reinterpretes como una intervención mayor ni le atribuyas la prevención de fallas que la tarea no cubre.
- Una inspección general (de Clase, de bandera, de la Compañía, ronda de rutina) no previene la falla de un componente puntual: lo que se pierde si no se hace es la detección temprana del deterioro y la evidencia de cumplimiento. Clasificá por eso, no por la peor falla imaginable del equipo.
- El fundamento lo lee la tripulación: lenguaje simple y directo, sin tecnicismos innecesarios.

La consecuencia debe ser la PEOR plausible si el plan no se hace. Si un mismo plan previene falla con consecuencias múltiples, elegí la más severa: SAFETY > ENVIRONMENTAL > OPERATIONAL > NON_OPERATIONAL.

REGLAS DE CONCISIÓN para el rationale:
- Máximo 2 oraciones cortas. Total ≤ 40 palabras.
- Mencioná QUÉ falla en el equipo y QUÉ consecuencia genera (no narres procedimientos).
- Estructura recomendada: "[modo de falla del equipo]. [Impacto principal en la categoría elegida]."
- Ejemplo SAFETY: "Bomba CI standby no probada puede no arrancar en incendio. Riesgo de fatalidad si fuego escala sin agua disponible."
- Ejemplo OPERATIONAL: "Filtros saturados causan derate del motor principal. Pérdida de propulsión y demora en ruta."

Te paso el activo + descripción del plan. Respondé EXCLUSIVAMENTE con un JSON válido (sin markdown, sin texto extra):
{"category": "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL", "rationale": "1-2 oraciones técnicas concisas"}`;

interface SuggestInput {
  assetName: string;
  assetSfiCode?: string | null;
  planTitle?: string | null;
  planDescription?: string | null;
  taskType?: "INSPECTION" | "MAINTENANCE" | null;
  /** Buque del plan, para saber qué clase de embarcación es. */
  vesselCode?: string | null;
}

export interface RcmConsequenceResult {
  category: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL";
  rationale: string;
}

const VALID_CATEGORIES = new Set(["SAFETY", "ENVIRONMENTAL", "OPERATIONAL", "NON_OPERATIONAL"]);

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function suggestPlanConsequence(
  session: TenantAccessSession,
  input: SuggestInput,
): Promise<RcmConsequenceResult> {
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");

  const assetName = (input.assetName ?? "").trim();
  if (!assetName) throw new RouteError(400, "VALIDATION_ERROR", "El nombre del activo es requerido.");

  const payload = {
    activo: assetName,
    sfi: input.assetSfiCode ?? null,
    plan: input.planTitle ?? null,
    descripcion: input.planDescription ?? null,
    sobreElBuque: await getVesselAiContext(session.tenantSlug, input.vesselCode),
    tipoTarea:
      input.taskType === "INSPECTION" ? "Inspección / prueba (detecta falla oculta)"
      : input.taskType === "MAINTENANCE" ? "Mantenimiento (previene degradación/falla funcional)"
      : null,
  };

  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const client = createAiClient({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${JSON.stringify(payload, null, 2)}` }],
    });
  } catch (err) {
    log.error("[suggestPlanConsequence] Anthropic call failed:", err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo obtener sugerencia de la IA.");
  }

  // Telemetría no bloqueante (tenant cacheado, ver tenant-cache.ts).
  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId: tenant.id,
      tenantSlug: session.tenantSlug,
      userId: session.user.id,
      userEmail: session.user.email,
      vesselCode: null,
      feature: "plan_rcm_consequence_suggestion",
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

  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió una respuesta inválida.");
  }

  const category = String(parsed?.category ?? "").toUpperCase();
  if (!VALID_CATEGORIES.has(category)) {
    throw new RouteError(502, "AI_PARSE_ERROR", `Categoría inválida: ${category}`);
  }
  const rationale = String(parsed?.rationale ?? "").trim();
  if (!rationale) {
    throw new RouteError(502, "AI_PARSE_ERROR", "Falta el fundamento.");
  }

  return { category: category as RcmConsequenceResult["category"], rationale };
}
