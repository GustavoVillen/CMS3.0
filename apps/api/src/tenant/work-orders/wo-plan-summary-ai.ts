// Solicitud y Tarea de una OT que ejecuta VARIOS ítems del PDM, en una frase.
//
// wo-plan-text.ts arma esos campos como una lista "CÓDIGO · texto" por ítem.
// Con tres o cuatro ítems la OT arrancaba con un listado en vez de una
// solicitud, y así se veía en Seguimiento, en el tablero y en el papel. Pedido
// del usuario (oct 2026): la OT nace con una frase escrita por la IA.
//
// Los códigos no se pierden: los ítems siguen vinculados a la OT y el papel los
// imprime en ITEM DEL PDM. Sólo se reemplaza lo que sigue siendo la lista
// automática; si alguien escribió el campo a mano, manda lo suyo.
//
// Nunca frena la apertura de la OT: sin IA, sin presupuesto o con error, el
// campo queda con la lista de siempre.

import type Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey } from "../ai/ai-provider";
import { recordAiUsage, isAiBudgetAvailable } from "../usage/usage-service";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { log } from "../../common/logger";
import type { TenantAccessSession } from "../auth/session-store";
import type { getPrismaClient } from "../../platform/data/prisma-client";
import type { PlanTextSource } from "./wo-plan-text";

const FEATURE = "wo_multi_plan_summary";

const PROMPT = `Sos jefe de máquinas de una naviera. Una orden de trabajo ejecuta VARIOS ítems del plan de mantenimiento a la vez. Te paso los ítems con su equipo, su título y su descripción.

Escribí dos textos para la orden:
- "solicitud": qué se pide, en UNA frase de hasta 25 palabras. Ej: "Mantenimiento preventivo de la bomba de incendio principal y de los cortes de ventilación y combustible a distancia."
- "tarea": qué hay que hacer, en UNA frase de hasta 35 palabras, con las acciones principales de todos los ítems agrupadas por equipo. Ej: "Controlar la empaquetadura y engrasar los manchones de la bomba de incendio principal; probar las grampas de ventilación y los cortes de combustible a distancia."

REGLAS:
- No pongas los códigos de los ítems: ya figuran aparte en la orden.
- No dejes afuera ningún equipo ni sistema de la lista, y no agregues trabajos que no estén.
- Nombrá los equipos por su nombre, no por su código.
- Sin viñetas, sin saltos de línea, sin comillas, sin marcas de casilla como "[ ]".`;

const TOOL: Anthropic.Tool = {
  name: "wo_multi_plan_summary",
  description: "Registra la solicitud y la tarea de la orden de trabajo.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      solicitud: { type: "string", description: "Qué se pide, en una frase." },
      tarea: { type: "string", description: "Qué hay que hacer, en una frase." },
    },
    required: ["solicitud", "tarea"],
  },
};

type AnyPrisma = NonNullable<ReturnType<typeof getPrismaClient>>;

export type SummaryPlan = PlanTextSource & { assetId?: string | null };

/** Misma lista con otro espaciado sigue siendo la lista automática. */
const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").replace(/\s+/g, " ").trim() === (b ?? "").replace(/\s+/g, " ").trim();

/** Una sola línea: la IA a veces devuelve saltos o comillas igual. */
const oneLine = (v: unknown) =>
  String(v ?? "").replace(/\s+/g, " ").replace(/^["'«“]+|["'»”]+$/g, "").trim();

async function askAi(
  prismaRaw: AnyPrisma,
  session: TenantAccessSession,
  tenantId: string,
  vesselCode: string,
  plans: SummaryPlan[],
): Promise<{ solicitud: string; tarea: string } | null> {
  const apiKey = aiApiKey();
  if (!apiKey || !(await isAiBudgetAvailable(tenantId))) return null;

  const assetIds = [...new Set(plans.map(p => p.assetId).filter((v): v is string => !!v))];
  const assets: Array<{ id: string; name: string | null }> = assetIds.length > 0
    ? await (prismaRaw as any).asset.findMany({ where: { tenantId, id: { in: assetIds } }, select: { id: true, name: true } })
    : [];
  const assetName = new Map(assets.map(a => [a.id, a.name]));
  const items = plans.map(p => ({
    equipo: (p.assetId && assetName.get(p.assetId)) || null,
    titulo: p.title,
    descripcion: (p.description ?? "").trim().slice(0, 400) || null,
  }));

  const client = createAiClient({ apiKey, timeout: 30_000, maxRetries: 1 });
  const model = AI_MODEL.fast;
  const started = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 512,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${JSON.stringify({ items }, null, 2)}` }],
    });
  } catch (err) {
    log.error(`[${FEATURE}] AI call failed after ${Date.now() - started}ms:`, err);
    return null;
  }

  try {
    recordAiUsage({
      tenantId,
      tenantSlug: session.tenantSlug,
      userId: session.user.id,
      userEmail: session.user.email,
      vesselCode,
      feature: FEATURE,
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - started,
    });
  } catch { /* swallow */ }

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const out = (block?.input ?? {}) as { solicitud?: unknown; tarea?: unknown };
  const solicitud = oneLine(out.solicitud);
  const tarea = oneLine(out.tarea);
  return solicitud && tarea ? { solicitud, tarea } : null;
}

/**
 * Devuelve título (Tarea) y descripción (Solicitud) de la OT: los que siguen
 * siendo la lista automática de varios ítems pasan a la frase de la IA; el
 * resto vuelve tal cual. Con un solo ítem no hace nada.
 */
export async function summarizeMultiPlanFields(
  prismaRaw: AnyPrisma,
  session: TenantAccessSession,
  args: {
    tenantId: string;
    vesselCode: string;
    plans: SummaryPlan[];
    title: string | null;
    description: string | null;
    /** La lista automática (mergePlanTexts) contra la que se compara cada campo. */
    mergedTitle: string | null;
    mergedDescription: string | null;
  },
): Promise<{ title: string | null; description: string | null }> {
  const { title, description } = args;
  if (args.plans.length < 2) return { title, description };
  const titleIsList = !!title && sameText(title, args.mergedTitle);
  const descriptionIsList = !!description && sameText(description, args.mergedDescription);
  if (!titleIsList && !descriptionIsList) return { title, description };

  const ai = await askAi(prismaRaw, session, args.tenantId, args.vesselCode, args.plans);
  if (!ai) return { title, description };
  return {
    title: titleIsList ? ai.tarea : title,
    description: descriptionIsList ? ai.solicitud : description,
  };
}
