/**
 * Completa con IA los campos de analisis de los planes de mantenimiento de un
 * buque: criterios de aceptacion, LOTO, analisis de riesgo (JSA) y RCM.
 *
 * Usa los mismos servicios que el boton "Actualizar con IA" de la pantalla de
 * planes (maintenance-plans-ai-suggestions + maintenance-plans-rcm-ai), asi que
 * el resultado es identico al que saldria haciendolo a mano plan por plan.
 *
 * El orden por plan importa: LOTO recibe los criterios de aceptacion y el
 * analisis de riesgo recibe ambos, igual que en la pantalla.
 *
 * Idempotente: saltea los planes que ya tienen los cuatro campos completos.
 * Con FORCE=1 los regenera igual.
 *
 * Uso (en el VPS):
 *   npx tsx scripts/load-lte-plan-ia.ts LTE-MP-#1 LTE-MP-#2 LTE-MP-#3 LTE-MP-#4
 *   npx tsx scripts/load-lte-plan-ia.ts --todos          # todo el buque
 *   npx tsx scripts/load-lte-plan-ia.ts --buque=DCH --todos
 *   FORCE=1 npx tsx scripts/load-lte-plan-ia.ts LTE-MP-#1
 *   CLEAN=1 npx tsx scripts/load-lte-plan-ia.ts --todos  # solo sanear, sin IA
 */
import "../apps/api/src/config/bootstrap-env";

import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  suggestPlanAcceptanceCriteria,
  suggestPlanLoto,
  suggestPlanRisk,
} from "../apps/api/src/tenant/maintenance-plans/maintenance-plans-ai-suggestions";
import { suggestPlanConsequence } from "../apps/api/src/tenant/maintenance-plans/maintenance-plans-rcm-ai";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const TENANT_SLUG = "mercurio";
/** Buque sobre el que se corre; el primer argumento puede pisarlo con --buque=XXX. */
const VESSEL = (process.argv.find(a => a.startsWith("--buque="))?.split("=")[1] ?? "LTE").toUpperCase();
const USUARIO_POR_BUQUE: Record<string, string> = {
  LTE: "MAQUINASLATERE",
  DCH: "OSCAR-DUARTE",
};
const USER_LEGACY_ID = USUARIO_POR_BUQUE[VESSEL];
const FORCE = process.env.FORCE === "1";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);

/**
 * Limpia los restos de la plantilla del prompt que el proveedor de IA a veces
 * copia literal: la linea marcador "[criterios de aceptación]" y los bullets
 * envueltos en corchetes ("- [peligro → control]"). Sin esto el texto se ve con
 * los corchetes en la pantalla del plan y en el PDF de la OT.
 */
function sanitize(text: string): string {
  return text
    .split("\n")
    .filter(l => !/^\s*\[\s*(criterios de aceptaci[oó]n|lista de herramientas[^\]]*|peligro[^\]]*|EPP[^\]]*)\s*\]\s*$/i.test(l))
    .map(l => l.replace(/^(\s*[-*•]\s*)\[(.+)\]\s*$/, "$1$2"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Sesion sintetica: los servicios de IA solo leen tenantSlug y user para el registro de uso. */
function buildSession(user: any): any {
  return {
    kind: "tenant",
    tenantSlug: TENANT_SLUG,
    accessToken: "script",
    refreshToken: "script",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: "MAINTENANCE_MANAGER",
      assignedVesselCodes: [VESSEL],
      locale: "es",
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const TODOS = argv.includes("--todos");
  const assetCodes = argv.filter(a => a !== "--todos" && !a.startsWith("--buque="));
  if (!assetCodes.length && !TODOS) {
    throw new Error("Indicar al menos un assetCode (ej. LTE-MP-#1) o --todos para el buque entero.");
  }

  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG }, select: { id: true } });
  const tenantId = tenant.id;
  const user = await prisma.user.findFirst({
    where: { legacyUserId: USER_LEGACY_ID },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (!user) throw new Error(`Usuario ${USER_LEGACY_ID} no encontrado`);
  const session = buildSession(user);

  const assets = await prisma.asset.findMany({
    where: {
      tenantId, vesselCode: VESSEL, deletedAt: null,
      ...(TODOS ? {} : { assetCode: { in: assetCodes } }),
    },
    select: { id: true, assetCode: true, name: true, sfiCode: true, manufacturer: true, model: true },
  });
  const assetById = new Map<string, any>(assets.map((a: any) => [a.id, a]));

  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: VESSEL, assetId: { in: assets.map((a: any) => a.id) }, deletedAt: null },
    select: {
      id: true, taskCode: true, title: true, description: true, taskType: true, assetId: true,
      acceptanceCriteria: true, loto: true, riskLevel: true, riskAnalysisResult: true,
      consequenceCategory: true,
    },
    orderBy: [{ assetId: "asc" }, { taskCode: "asc" }],
  });

  // CLEAN=1: no llama a la IA, solo pasa por sanitize() lo que ya esta guardado.
  if (process.env.CLEAN === "1") {
    let n = 0;
    for (const p of plans as any[]) {
      const data: any = {};
      for (const f of ["acceptanceCriteria", "loto", "riskAnalysisResult"] as const) {
        if (p[f] && sanitize(p[f]) !== p[f]) data[f] = sanitize(p[f]);
      }
      if (Object.keys(data).length) {
        await prisma.maintenancePlan.update({ where: { id: p.id }, data });
        n++;
      }
    }
    console.log(`Limpieza: ${n} planes ajustados de ${plans.length}.`);
    return;
  }

  const pending = plans.filter((p: any) =>
    FORCE || !p.acceptanceCriteria || !p.loto || !p.riskLevel || !p.consequenceCategory);

  console.log(`Planes en los activos indicados: ${plans.length}`);
  console.log(`A completar con IA: ${pending.length}${FORCE ? " (FORCE)" : ""}`);
  if (!pending.length) return;

  let done = 0, failed = 0;
  const errors: string[] = [];

  async function work(plan: any) {
    const asset = assetById.get(plan.assetId);
    const assetLabel = [asset.name, [asset.manufacturer, asset.model].filter(Boolean).join(" ")]
      .filter(Boolean).join(" — ") + ` (R/E LATERE, remolcador)`;
    const taskDesc = [plan.title, plan.description].filter(Boolean).join("\n");
    const taskType = plan.taskType as "INSPECTION" | "MAINTENANCE";

    try {
      const acc = await suggestPlanAcceptanceCriteria(session, { assetLabel, taskDesc, taskType });
      const loto = await suggestPlanLoto(session, { assetLabel, taskDesc, taskType, acceptanceCriteria: acc.text });
      const risk = await suggestPlanRisk(session, {
        assetLabel, taskDesc, taskType, acceptanceCriteria: acc.text, loto: loto.text,
      });
      const rcm = await suggestPlanConsequence(session, {
        assetName: assetLabel, assetSfiCode: asset.sfiCode, planTitle: plan.title,
        planDescription: plan.description, taskType,
      });

      await prisma.maintenancePlan.update({
        where: { id: plan.id },
        data: {
          acceptanceCriteria: sanitize(acc.text),
          loto: sanitize(loto.text),
          riskLevel: risk.level,
          riskProbability: risk.probability,
          riskConsequence: risk.consequence,
          riskAnalysisResult: sanitize(risk.analysis),
          consequenceCategory: rcm.category,
          consequenceRationale: rcm.rationale,
          updatedByUserId: user.id,
        },
      });
      done++;
      console.log(`  ✓ ${plan.taskCode.padEnd(16)} ${risk.level.padEnd(8)} ${rcm.category.padEnd(16)} ${plan.title.slice(0, 45)}`);
    } catch (e: any) {
      failed++;
      const msg = `${plan.taskCode}: ${e?.message ?? e}`;
      errors.push(msg);
      console.log(`  ✗ ${msg}`);
    }
  }

  // Cola con concurrencia acotada: el proveedor de IA no agradece 60 llamadas juntas.
  const queue = [...pending];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) await work(p);
  }));

  console.log(`\nOK — ${done} planes completados, ${failed} con error.`);
  if (errors.length) {
    console.log("Errores:");
    for (const e of errors) console.log("  ·", e);
  }
}

main().catch(e => { console.error("ERROR:", e.message ?? e); process.exitCode = 1; }).finally(() => process.exit());
