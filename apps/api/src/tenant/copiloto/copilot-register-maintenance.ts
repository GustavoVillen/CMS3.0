/**
 * "Registrar un mantenimiento hecho" desde el copiloto (pedido de Gustavo, oct
 * 2026): la OT que corresponde la decide este código, no el modelo.
 *
 * Con el modelo rápido eligiendo solo, el copiloto llegó a "encontrar" OT que
 * no tenían nada que ver (una cerrada de pescantes como "Service del MG"). Acá
 * se resuelve con datos: el equipo por nombre (con el vocabulario de a bordo),
 * sus OT abiertas —también las que lo cubren por un plan vinculado— y, si no
 * hay ninguna, sus planes. La respuesta dice qué hacer y con qué código exacto.
 *
 * Reglas del negocio que aplica:
 *   - OT abierta y aprobada (o autorizada) → se completa.
 *   - OT abierta sin aprobar → se abre y se avisa que hay que esperar la aprobación.
 *   - Sin OT abierta → se abre desde el plan y se avisa que tiene que ser aprobada.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { applyVesselWhereScope, wrapUntrusted, type VesselScope } from "./copilot-tool-utils";

/**
 * Cómo nombra la tripulación a los equipos ("Servis MG babor") vs. cómo están
 * en el registro. Cada palabra vale por cualquiera de sus equivalentes. Las
 * siglas de 2 letras sólo valen si están acá.
 */
export const CREW_ASSET_SYNONYMS: Record<string, string[]> = {
  mg: ["generador", "auxiliar"],
  generador: ["generador", "auxiliar"],
  auxiliar: ["auxiliar", "generador"],
  mp: ["principal"],
  mm: ["principal"],
  br: ["babor"],
  bb: ["babor"],
  er: ["estribor"],
  eb: ["estribor"],
};

export const FIND_WORK_ORDER_TO_REGISTER = "find_work_order_to_register";

export const REGISTER_MAINTENANCE_TOOL: Anthropic.Tool = {
  name: FIND_WORK_ORDER_TO_REGISTER,
  description:
    "Use this FIRST and ONLY ONCE whenever the user wants to register maintenance that was done on an equipment " +
    "(\"registrar mantenimiento del MG babor\", \"hice el service del auxiliar estribor\", or a pasted crew report of work done). " +
    "It finds the equipment, its open work orders and, if none is open, its maintenance plans, and tells you exactly what to do next (field `next`) and which code to use. " +
    "Never choose an OT or a plan yourself and never write an OT code this tool did not return.",
  input_schema: {
    type: "object" as const,
    properties: {
      vesselCode: { type: "string", description: "Vessel code (the vessel selected in the app, or the one the user named)." },
      equipment: { type: "string", description: "The equipment in the user's own words, e.g. \"mg babor\", \"principal estribor\"." },
      work: { type: "string", description: "What was done, in the user's words (\"service\", \"cambio de aceite y filtros\", or the whole report)." },
      pick: { type: "string", description: "Only when the user answered one of this tool's numbered lists: exactly what they chose — the number, the code (OT-… or the plan code) or the title. Send the same equipment and work as before." },
    },
    required: ["vesselCode", "equipment"],
  },
};

const OPEN_STATUSES = ["PLANNED", "IN_PROGRESS", "ON_HOLD"];

/** Palabras que no dicen QUÉ trabajo se hizo (cantidades, relleno, el propio equipo). */
const NOISE = new Set([
  "para", "con", "del", "los", "las", "una", "uno", "que", "por", "cada", "total", "hora", "horas", "unidad", "unidades",
  "litro", "litros", "registrar", "registro", "hice", "hicimos", "realizo", "realizado", "motor", "babor", "estribor",
  "generador", "auxiliar", "principal", "equipo",
  // "Registrar mantenimiento del MG" no dice cuál: con sólo esto se toman todas las OT abiertas del equipo.
  "mantenimiento",
]);

function norm(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Raíz corta: "servis"/"service"/"servicio" → "servi"; "filtros" → "filtr"; "muestras" → "muest". */
const stem = (word: string) => word.slice(0, 5);

/** Raíces con contenido de un texto (sin relleno, sin números, sin las palabras del equipo). */
function stemsOf(text: string, skip: Set<string> = new Set()): Set<string> {
  return new Set(
    norm(text).split(" ")
      .filter(w => w.length >= 4 && !NOISE.has(w) && !skip.has(w) && !/^\d+$/.test(w))
      .map(stem),
  );
}

/**
 * Qué tan bien el trabajo informado describe un título: la parte de las
 * palabras del título que aparecen en el trabajo. Se mide así, y no contando
 * palabras sueltas, porque un parte largo ("aceite, filtros, combustible…")
 * hacía ganar al plan "Cambio de filtro de aceite" sobre la OT abierta
 * "Cambio de aceite", que era la que correspondía.
 */
interface Fit { cov: number; hits: number }
function fit(work: Set<string>, ...texts: Array<string | null | undefined>): Fit {
  let best: Fit = { cov: 0, hits: 0 };
  for (const text of texts) {
    const words = [...stemsOf(text ?? "")];
    if (words.length === 0) continue;
    const hits = words.filter(w => work.has(w)).length;
    const cand = { cov: hits / words.length, hits };
    if (cand.cov > best.cov || (cand.cov === best.cov && cand.hits > best.hits)) best = cand;
  }
  return best;
}
const byFit = (a: { fit: Fit }, b: { fit: Fit }) => b.fit.cov - a.fit.cov || b.fit.hits - a.fit.hits;
const sameFit = (a: Fit, b: Fit) => a.cov === b.cov && a.hits === b.hits;
/** A partir de acá el título se considera el trabajo informado. */
const GOOD_FIT = 0.5;

type Stage = "EN_PREPARACION" | "SOLICITADA" | "APROBADA" | "AUTORIZADA";
function stageOf(wo: { enviadoAprobacionAt: Date | null; aprobadoAt: Date | null; autorizadoAt: Date | null }): Stage {
  return wo.autorizadoAt ? "AUTORIZADA" : wo.aprobadoAt ? "APROBADA" : wo.enviadoAprobacionAt ? "SOLICITADA" : "EN_PREPARACION";
}

export async function findWorkOrderToRegister(
  input: Record<string, unknown>,
  tenantId: string,
  scope: VesselScope,
): Promise<string> {
  const prisma = getPrismaClient() as any;
  if (!prisma) return JSON.stringify({ error: "Database not available in current environment" });

  const vesselCode = typeof input.vesselCode === "string" ? input.vesselCode.trim() : "";
  const equipment = typeof input.equipment === "string" ? input.equipment.trim() : "";
  const work = typeof input.work === "string" ? input.work : "";
  if (!vesselCode) return JSON.stringify({ next: "ASK_VESSEL", instruction: "Ask the user which vessel it is." });
  if (!equipment) return JSON.stringify({ next: "ASK_EQUIPMENT", instruction: "Ask the user which equipment it is." });

  const assetWhere: Record<string, unknown> = { tenantId, deletedAt: null };
  const scoped = applyVesselWhereScope(assetWhere, vesselCode, scope);
  if (!scoped.ok) return scoped.reason;

  // ── El equipo ──
  const tokens = norm(equipment).split(" ").filter(t => t.length >= 3 || CREW_ASSET_SYNONYMS[t]);
  if (tokens.length > 0) {
    assetWhere.AND = tokens.map(tok => ({
      OR: (CREW_ASSET_SYNONYMS[tok] ?? [tok]).flatMap(word =>
        ["name", "assetCode"].map(f => ({ [f]: { contains: word, mode: "insensitive" } }))),
    }));
  }
  const assets: Array<{ id: string; name: string; assetCode: string }> = await prisma.asset.findMany({
    where: assetWhere, select: { id: true, name: true, assetCode: true }, orderBy: { name: "asc" }, take: 8,
  });
  if (assets.length === 0) {
    return JSON.stringify({
      next: "NO_EQUIPMENT",
      instruction: `No equipment matches "${equipment}" on this vessel. Say so in one line and ask the user to name the equipment as it appears in the system.`,
    });
  }
  // El mismo nombre cargado dos veces (pasa en algunos buques) se trata como un
  // solo equipo: la OT o el plan dicen cuál es. Nombres distintos sí se preguntan.
  if (new Set(assets.map(a => norm(a.name))).size > 1) {
    return wrapUntrusted(JSON.stringify({
      next: "ASK_EQUIPMENT",
      candidates: assets.map(a => ({ name: a.name, assetCode: a.assetCode })),
      instruction: "Several equipments match. Show their names as a numbered list and ask which one. Nothing else.",
    }));
  }
  const assetIds = assets.map(a => a.id);
  const equipmentOut = { name: assets[0]!.name, assetCode: assets[0]!.assetCode };
  const workStems = stemsOf(work, new Set(norm(equipment).split(" ")));

  // ── Sus OT abiertas (también las que lo cubren por un plan vinculado) ──
  const openWos: Array<{
    workOrderCode: string; title: string | null; enviadoAprobacionAt: Date | null; aprobadoAt: Date | null; autorizadoAt: Date | null;
    planLinks: Array<{ maintenancePlan: { taskCode: string; title: string } | null }>;
  }> = await prisma.workOrder.findMany({
    where: {
      tenantId, vesselCode, deletedAt: null, status: { in: OPEN_STATUSES },
      OR: [{ assetId: { in: assetIds } }, { planLinks: { some: { maintenancePlan: { assetId: { in: assetIds } } } } }],
    },
    select: {
      workOrderCode: true, title: true, enviadoAprobacionAt: true, aprobadoAt: true, autorizadoAt: true,
      planLinks: { select: { maintenancePlan: { select: { taskCode: true, title: true } } } },
    },
    orderBy: { openDate: "desc" },
    take: 30,
  });
  const allWos = openWos.map(wo => ({
    workOrderCode: wo.workOrderCode,
    title: (wo.title ?? "").split("\n")[0]!.slice(0, 120),
    stage: stageOf(wo),
    fit: fit(workStems, wo.title, ...wo.planLinks.map(l => l.maintenancePlan?.title)),
  }));
  type Wo = typeof allWos[number];
  const wos = allWos.filter(wo => workStems.size === 0 || wo.fit.hits > 0).sort(byFit);
  const show = (wo: Wo) => ({ workOrderCode: wo.workOrderCode, title: wo.title, stage: wo.stage });

  // ── Sus planes que no tienen ya una OT abierta ──
  const pick = typeof input.pick === "string" ? input.pick.trim() : "";
  const coveredTaskCodes = new Set(openWos.flatMap(wo => wo.planLinks.map(l => l.maintenancePlan?.taskCode).filter(Boolean)));
  const plans: Array<{ taskCode: string; title: string }> = workStems.size === 0 && !pick ? [] : await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode, assetId: { in: assetIds }, deletedAt: null, status: { not: "INACTIVE" } },
    select: { taskCode: true, title: true },
    orderBy: { taskCode: "asc" },
    take: 80,
  });
  const allPlans = plans
    .filter(p => !coveredTaskCodes.has(p.taskCode))
    .map(p => ({ taskCode: p.taskCode, title: p.title, fit: fit(workStems, p.title) }));
  type Plan = typeof allPlans[number];
  const rankedPlans = allPlans.filter(p => p.fit.hits > 0).sort(byFit);

  // ── Qué hacer con una OT o con un plan ──
  const forWo = (best: Wo, others: Wo[]): string => {
    if (best.stage === "APROBADA" || best.stage === "AUTORIZADA") {
      return wrapUntrusted(JSON.stringify({
        next: "COMPLETE",
        equipment: equipmentOut,
        workOrder: show(best),
        otherOpenMatches: others.map(show),
        instruction: `Say in one line that you are opening ${best.workOrderCode} (${best.title}) to register it, and end the reply with exactly: [COMPLETAR]${best.workOrderCode}[/COMPLETAR]. Nothing else, no question.`,
      }));
    }
    const notSent = best.stage === "EN_PREPARACION";
    return wrapUntrusted(JSON.stringify({
      next: notSent ? "WAIT_SEND" : "WAIT_APPROVAL",
      equipment: equipmentOut,
      workOrder: show(best),
      instruction: (notSent
        ? `Tell the user that ${best.workOrderCode} (${best.title}) is open but has not been sent for approval yet: it must be sent ("Enviar a aprobar") and approved before the maintenance can be registered. `
        : `Tell the user that ${best.workOrderCode} (${best.title}) is waiting for approval. `) +
        `They must wait for the approval; once it is approved, they ask you again and you complete it. ` +
        `End the reply with exactly: [ABRIR]/work-orders/${best.workOrderCode}[/ABRIR]. Load nothing and ask nothing else.`,
    }));
  };
  /** Abrir la OT desde un plan; con `extra`, una sola OT que ejecuta todos esos planes. */
  const forPlan = (plan: Plan, extra: Plan[] = []): string => {
    const names = [plan, ...extra].map(p => `"${p.title}"`).join(", ");
    const patch = extra.length > 0 ? { additionalPlans: extra.map(p => p.taskCode) } : {};
    return wrapUntrusted(JSON.stringify({
      next: "OPEN_FROM_PLAN",
      equipment: equipmentOut,
      plan: { taskCode: plan.taskCode, title: plan.title },
      ...(extra.length > 0 ? { additionalPlans: extra.map(p => ({ taskCode: p.taskCode, title: p.title })) } : {}),
      otherOpenMatches: wos.filter(wo => wo.fit.cov >= 0.4).slice(0, 2).map(show),
      instruction:
        (extra.length > 0
          ? `Tell the user there is no open work order for this, that the button opens ONE work order for the plans ${names}, and that it then has to be approved: `
          : `Tell the user there is no open work order for this, that the button opens it from the plan ${names}, and that it then has to be approved: `) +
        `until it is approved the maintenance cannot be registered, so they must wait for the approval and ask you again. ` +
        `End the reply with exactly: [ACCIONES][${JSON.stringify({ type: "create_work_order_from_plan", target: plan.taskCode, label: "Abrir OT", intent: "register_maintenance", patch })}][/ACCIONES]. ` +
        `Do not ask the form questions (voyage, condition, etc.).`,
    }));
  };
  const askList = "Show them as a numbered list IN THIS ORDER (code · title, and whether it is approved) and ask which one. Nothing else. " +
    "When the user answers, call this tool again with the same equipment and work and `pick` = the CODE of the item they chose (as you showed it; their number only if you cannot tell).";

  const bestWo = wos[0];
  const bestPlan = rankedPlans[0];
  // Regla de Gustavo: si ya hay una OT abierta para eso, se usa esa. Se abre una
  // nueva desde el plan sólo cuando ninguna OT abierta encaja bien y un plan sí.
  const useWo = !!bestWo && (workStems.size === 0 || bestWo.fit.cov >= GOOD_FIT || !bestPlan || bestPlan.fit.cov < GOOD_FIT);
  const tiedWos = bestWo ? wos.filter(wo => sameFit(wo.fit, bestWo.fit)).slice(0, 4) : [];
  const tiedPlans = bestPlan ? rankedPlans.filter(p => sameFit(p.fit, bestPlan.fit)).slice(0, 4) : [];

  // ── El usuario eligió de una lista: se resuelve acá, no lo interpreta el modelo ──
  if (pick) {
    const p = pick.toUpperCase();
    const pNorm = norm(pick);
    const listed: Array<{ wo?: Wo; plan?: Plan }> = useWo
      ? tiedWos.map(wo => ({ wo }))
      : tiedPlans.map(plan => ({ plan }));
    // "Una sola OT para ambos/todos": la opción que va al final de la lista de planes.
    if (!useWo && tiedPlans.length > 1 &&
        (/\b(ambos|ambas|todos|todas|una sola|both|all)\b/i.test(pick) || pick === String(tiedPlans.length + 1))) {
      return forPlan(tiedPlans[0]!, tiedPlans.slice(1));
    }
    const digits = pick.match(/\d+/g)?.find(d => d.length >= 3);
    const chosen: { wo?: Wo; plan?: Plan } | undefined =
      (() => { const wo = allWos.find(w => w.workOrderCode.toUpperCase() === p); return wo ? { wo } : undefined; })()
      ?? (() => { const plan = allPlans.find(x => x.taskCode.toUpperCase() === p); return plan ? { plan } : undefined; })()
      ?? (/^\d{1,2}$/.test(pick) ? listed[Number(pick) - 1] : undefined)
      ?? (() => { const wo = digits ? allWos.find(w => w.workOrderCode.endsWith("-" + digits.padStart(4, "0"))) : undefined; return wo ? { wo } : undefined; })()
      ?? (() => { const wo = allWos.find(w => norm(w.title) === pNorm); return wo ? { wo } : undefined; })()
      ?? (() => { const plan = allPlans.find(x => norm(x.title) === pNorm || norm(x.taskCode) === pNorm); return plan ? { plan } : undefined; })();
    if (chosen?.wo) return forWo(chosen.wo, []);
    if (chosen?.plan) return forPlan(chosen.plan);
    // No se reconoce la elección: se vuelve a preguntar con la lista de siempre.
  }

  if (useWo) {
    if (tiedWos.length > 1) {
      return wrapUntrusted(JSON.stringify({ next: "ASK_WHICH", equipment: equipmentOut, candidates: tiedWos.map(show),
        instruction: "Several open work orders fit. " + askList }));
    }
    return forWo(bestWo!, wos.slice(1).filter(wo => wo.fit.cov >= 0.4).slice(0, 2));
  }

  // ── Sin OT abierta que encaje: se abre desde el plan ──
  if (!bestPlan) {
    return wrapUntrusted(JSON.stringify({
      next: workStems.size === 0 ? "ASK_WORK" : "NOTHING_FOUND",
      equipment: equipmentOut,
      instruction: workStems.size === 0
        ? `${equipmentOut.name} has no open work order. Ask in one line which maintenance was done (e.g. "¿Qué mantenimiento le hiciste?").`
        : `There is no open work order and no maintenance plan of ${equipmentOut.name} that matches that work. Say so in one line and ask which maintenance it was (or whether it was a repair, to open a corrective OT).`,
    }));
  }
  if (tiedPlans.length > 1) {
    return wrapUntrusted(JSON.stringify({
      next: "ASK_PLAN", equipment: equipmentOut,
      candidates: tiedPlans.map(pl => ({ taskCode: pl.taskCode, title: pl.title })),
      instruction: "There is no open work order for this. Several plans fit: show their titles as a numbered list IN THIS ORDER and ask which one to open, " +
        `adding as the last option "${tiedPlans.length === 2 ? "Una sola OT para ambos" : "Una sola OT para todos"}". Nothing else. ` +
        "When the user answers, call this tool again with the same equipment and work and `pick` = what they chose (the plan code or title, or \"todos\" for the single OT).",
    }));
  }
  return forPlan(bestPlan);
}
