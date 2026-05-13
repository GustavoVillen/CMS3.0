import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

const MODEL = "claude-haiku-4-5-20251001";

// Referencias normativas por tipo — se inyectan en el prompt para anclar la IA
// a reglamentaciones reales y evitar escenarios genéricos.
const DRILL_REGULATORY_REF: Record<string, string> = {
  FIRE:           "SOLAS II-2 / III/19.3.2 — drill mensual contra incendio. ISGOTT cap. 7 (buques tanque).",
  ABANDON_SHIP:   "SOLAS III/19.3.2 y 19.3.3.1 — abandono mensual; ejercicio dentro de 24 h si >25% de tripulación es nueva.",
  ENCLOSED_SPACE: "SOLAS III/19.3.3.3 (MSC.350(92)) — entrada y rescate cada 2 meses. IMO Res. A.1050(27).",
  MAN_OVERBOARD:  "SOLAS V/26 + práctica recomendada. Maniobra Williamson/Anderson, recuperación con bote de rescate.",
  POLLUTION:      "MARPOL Anexo I Reg. 37 + SOPEP. Ejercicio trimestral típico.",
  OIL_SPILL:      "MARPOL Anexo I + SOPEP/SMPEP. OPA 90 para aguas USA.",
  SECURITY:       "ISPS Code A/13.4 — drill trimestral; exercise anual del SSP.",
  MEDICAL:        "MLC 2006 + SMS de la compañía. Guidance: IMGS / WHO Medical Guide for Ships.",
  STEERING_GEAR:  "SOLAS V/26.4 — prueba trimestral del aparato de gobierno de emergencia y comunicación puente-máquina.",
  BLACKOUT:       "SMS de la compañía + buena práctica. Recuperación del generador de emergencia, arranque ciego.",
  OTHER:          "Buena práctica marítima y SMS de la compañía.",
};

const DRILL_LABEL_ES: Record<string, string> = {
  FIRE:           "Incendio",
  ABANDON_SHIP:   "Abandono de buque",
  ENCLOSED_SPACE: "Espacios confinados",
  MAN_OVERBOARD:  "Hombre al agua",
  POLLUTION:      "Contaminación",
  OIL_SPILL:      "Derrame de combustible",
  SECURITY:       "Seguridad (ISPS)",
  MEDICAL:        "Emergencia médica",
  STEERING_GEAR:  "Gobierno de emergencia",
  BLACKOUT:       "Blackout / dead ship",
  OTHER:          "Otro",
};

const PROMPT_DRILL_SCENARIO = `Sos un instructor experto en simulacros de emergencia marítima, formado en SOLAS, ISPS y MARPOL.

Tu tarea: redactar un escenario de simulacro REALISTA, BREVE y OPERATIVO, alineado a las reglamentaciones internacionales aplicables al tipo solicitado.

REGLAS DE FORMATO:
- Texto plano (sin Markdown, sin code fences).
- Entre 6 y 10 líneas en total.
- Empezá con una situación gatillo CONCRETA (lugar exacto a bordo, hora, condición de mar/clima si aplica).
- Indicá el PUNTO DE REUNIÓN o ZONA DE OPERACIÓN esperada.
- Listá 2-4 acciones clave que la tripulación debe ejecutar.
- Cerrá con el OBJETIVO DEL EJERCICIO (qué se evalúa) en 1 línea.

REGLAS DE CONTENIDO:
- Específico al BUQUE y al TIPO. No respuestas genéricas tipo "se simula un incendio".
- Si el tipo lo requiere, incluí parámetros medibles (ej. nivel de O₂, LEL, tiempo de mustering objetivo).
- Coherente con el último simulacro del mismo tipo en este vessel si te lo doy — variar el escenario para no repetir.
- Referenciá brevemente la norma aplicable AL FINAL como "Ref: ..." (una sola línea).

NO incluyas:
- Disclaimers ni introducciones tipo "Aquí tenés..."
- Listas tipo bullet con guiones — usá oraciones cortas separadas por punto y aparte.
- Procedimientos extensos paso a paso (eso va en el plan de simulacros, no en el escenario).

Respondé ÚNICAMENTE con el escenario, sin encabezados ni explicaciones.`;

export interface DrillScenarioInput {
  type: string;                  // FIRE | ABANDON_SHIP | ...
  vesselCode?: string | null;
  vesselName?: string | null;
  lastScenario?: string | null;  // último escenario del mismo tipo en este vessel
  lastCompletedDate?: string | null;
}

async function callClaude(
  session: TenantAccessSession,
  feature: string,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

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

export async function suggestDrillScenario(
  session: TenantAccessSession,
  input: DrillScenarioInput,
): Promise<{ text: string }> {
  const type = String(input.type ?? "").toUpperCase();
  if (!DRILL_LABEL_ES[type]) {
    throw new RouteError(400, "VALIDATION_ERROR", `Tipo de simulacro inválido: ${input.type}.`);
  }

  // Consultamos el último simulacro del mismo tipo en el vessel para variar el escenario
  let lastScenario = input.lastScenario ?? null;
  let lastCompletedDate = input.lastCompletedDate ?? null;
  if (!lastScenario && input.vesselCode) {
    try {
      const prisma = getPrismaClient();
      if (prisma) {
        const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
        if (tenant) {
          const recent = await (prisma as unknown as {
            drill: { findFirst(a: unknown): Promise<{ scenario: string | null; completedDate: Date | null } | null> };
          }).drill.findFirst({
            where: {
              tenantId: tenant.id,
              vesselCode: input.vesselCode,
              type,
              status: "COMPLETED",
              deletedAt: null,
            },
            orderBy: { completedDate: "desc" },
          });
          if (recent) {
            lastScenario = recent.scenario ?? null;
            lastCompletedDate = recent.completedDate ? recent.completedDate.toISOString().slice(0, 10) : null;
          }
        }
      }
    } catch (err) {
      log.warn("[suggestDrillScenario] no se pudo cargar último simulacro:", err);
    }
  }

  const lines: string[] = [
    `Tipo de simulacro: ${DRILL_LABEL_ES[type]} (${type})`,
    `Vessel: ${input.vesselName ? `${input.vesselCode} — ${input.vesselName}` : (input.vesselCode ?? "no especificado")}`,
    `Referencia normativa aplicable: ${DRILL_REGULATORY_REF[type] ?? "—"}`,
  ];
  if (lastScenario) {
    lines.push(`Último escenario realizado${lastCompletedDate ? ` (${lastCompletedDate})` : ""}: ${lastScenario.slice(0, 400)}`);
    lines.push("Variá el escenario para no repetir lugar/condiciones del anterior.");
  }

  const text = await callClaude(
    session,
    "drill_scenario_suggestion",
    PROMPT_DRILL_SCENARIO,
    lines.join("\n"),
    700,
  );
  return { text };
}
