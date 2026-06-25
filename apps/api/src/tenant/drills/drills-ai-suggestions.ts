import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";

const MODEL = "claude-haiku-4-5-20251001";

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
  requirementId: string;          // id del DrillRequirement
  vesselCode?: string | null;
  vesselName?: string | null;
  lastScenario?: string | null;
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

  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();

  const locale = await getTenantAiLocale(session.tenantSlug);
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${userContent}` }],
    });
    log.info(`[${feature}] Claude responded in ${Date.now() - aiStarted}ms (in=${response.usage.input_tokens} out=${response.usage.output_tokens})`);
  } catch (err) {
    log.error(`[${feature}] Anthropic call failed after ${Date.now() - aiStarted}ms:`, err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo obtener sugerencia de la IA.");
  }

  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
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
  const requirementId = String(input.requirementId ?? "").trim();
  if (!requirementId) {
    throw new RouteError(400, "VALIDATION_ERROR", "requirementId es requerido.");
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const requirement = await (prisma as unknown as {
    drillRequirement: { findFirst(a: unknown): Promise<{ id: string; title: string; solasRegulation: string | null } | null> };
  }).drillRequirement.findFirst({
    where: { id: requirementId, tenantId: tenant.id, deletedAt: null },
  });
  if (!requirement) throw new RouteError(404, "NOT_FOUND", "Requisito de simulacro no encontrado.");

  // Último simulacro del mismo requirement en el vessel (para variar el escenario)
  let lastScenario = input.lastScenario ?? null;
  let lastCompletedDate = input.lastCompletedDate ?? null;
  if (!lastScenario && input.vesselCode) {
    try {
      const recent = await (prisma as unknown as {
        drill: { findFirst(a: unknown): Promise<{ scenario: string | null; completedDate: Date | null } | null> };
      }).drill.findFirst({
        where: {
          tenantId: tenant.id,
          vesselCode: input.vesselCode,
          requirementId,
          status: "COMPLETED",
          deletedAt: null,
        },
        orderBy: { completedDate: "desc" },
      });
      if (recent) {
        lastScenario = recent.scenario ?? null;
        lastCompletedDate = recent.completedDate ? recent.completedDate.toISOString().slice(0, 10) : null;
      }
    } catch (err) {
      log.warn("[suggestDrillScenario] no se pudo cargar último simulacro:", err);
    }
  }

  const lines: string[] = [
    `Tipo de simulacro: ${requirement.title}`,
    `Vessel: ${input.vesselName ? `${input.vesselCode} — ${input.vesselName}` : (input.vesselCode ?? "no especificado")}`,
    `Referencia normativa aplicable: ${requirement.solasRegulation ?? "—"}`,
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
