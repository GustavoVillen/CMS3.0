/**
 * Completa los campos de seguridad y confiabilidad que falten en los planes de
 * mantenimiento: criterios de aceptacion, LOTO, analisis de riesgo del trabajo
 * (nivel + probabilidad + consecuencia + texto) y categoria RCM.
 *
 * Usa EXACTAMENTE los mismos generadores de IA que los botones de varita del
 * formulario de planes (`maintenance-plans-ai-suggestions` y
 * `maintenance-plans-rcm-ai`), asi que el contenido sale con el mismo criterio
 * que si un usuario los hubiera apretado uno por uno.
 *
 * Solo COMPLETA lo que esta vacio: nunca pisa contenido ya cargado. Lo que ya
 * existe se le pasa a la IA como contexto (el LOTO se genera sabiendo los
 * criterios de aceptacion, el riesgo sabiendo los dos).
 *
 * Contexto de flota: se le pasa el vesselCode y el propio servicio de IA
 * resuelve si es un remolcador tripulado o una barcaza no tripulada
 * (tenant/ai/vessel-ai-context). Cambia el analisis: en una barcaza sin
 * dotacion permanente no hay nadie a bordo cuando falla el equipo.
 *
 * Uso:
 *   pnpm exec tsx --env-file .env scripts/fill-plan-hse-rcm.ts
 *   DRY=1 ...            solo lista lo que falta, sin llamar a la IA
 *   VESSEL=M01 ...       limita a un buque
 *   LIMIT=5 ...          corta despues de N planes (prueba)
 *   CODES=A-01,A-02 ...  limita a esos taskCode (una carga puntual)
 *   CONCURRENCY=3 ...    planes en paralelo (default 3)
 */
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

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = process.env.VESSEL ?? "";
const DRY = process.env.DRY === "1";
const LIMIT = Number(process.env.LIMIT ?? 0);
const CODES = (process.env.CODES ?? "").split(",").map(c => c.trim()).filter(Boolean);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? 3));

const empty = (v: unknown) => !String(v ?? "").trim();

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tenantId: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId, role: "TENANT_ADMIN" },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (!member?.userId) throw new Error(`No hay TENANT_ADMIN en '${SLUG}'.`);
  // Las funciones de IA piden una sesion para el control de presupuesto y la
  // telemetria de uso. Se firma con el admin del tenant, que es quien habria
  // apretado el boton de varita.
  const session = { tenantSlug: SLUG, user: { id: member.userId, email: member.user?.email ?? "" } } as any;

  const plans = await prisma.maintenancePlan.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(VESSEL ? { vesselCode: VESSEL } : {}),
      ...(CODES.length ? { taskCode: { in: CODES } } : {}),
      OR: [
        { acceptanceCriteria: null }, { acceptanceCriteria: "" },
        { loto: null }, { loto: "" },
        { riskLevel: null },
        { riskAnalysisResult: null }, { riskAnalysisResult: "" },
        { consequenceCategory: null },
      ],
    },
    select: {
      id: true, taskCode: true, title: true, description: true, vesselCode: true,
      taskType: true, assetId: true, sfiSubgroupCode: true,
      acceptanceCriteria: true, loto: true, riskLevel: true, riskAnalysisResult: true,
      consequenceCategory: true,
    },
    orderBy: [{ vesselCode: "asc" }, { taskCode: "asc" }],
  });

  const assetIds = [...new Set(plans.map((p: any) => p.assetId))];
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } }, select: { id: true, name: true },
  });
  const assetMap = new Map<string, string>(assets.map((a: any) => [a.id, a.name ?? ""]));

  const targets = LIMIT > 0 ? plans.slice(0, LIMIT) : plans;
  console.log(`${DRY ? "DRY-RUN · " : ""}${targets.length} planes con campos faltantes` +
    (VESSEL ? ` (buque ${VESSEL})` : "") + `\n`);

  if (DRY) {
    for (const p of targets) {
      const falta = [
        empty(p.acceptanceCriteria) && "criterios",
        empty(p.loto) && "loto",
        !p.riskLevel && "nivel",
        empty(p.riskAnalysisResult) && "analisis",
        !p.consequenceCategory && "rcm",
      ].filter(Boolean).join(", ");
      console.log(`  ${p.vesselCode.padEnd(6)} ${p.taskCode.padEnd(18)} ${String(p.title).slice(0, 50).padEnd(52)} falta: ${falta}`);
    }
    await prisma.$disconnect();
    return;
  }

  let ok = 0, fail = 0;
  const errores: string[] = [];

  async function run(p: any) {
    const assetName = assetMap.get(p.assetId) ?? "equipo";
    // El tipo de buque lo resuelve el propio servicio de IA desde vesselCode
    // (tenant/ai/vessel-ai-context): no hace falta escribirlo en el label.
    const assetLabel = assetName;
    const taskDesc = [p.title, p.description].filter(Boolean).join(" — ");
    const taskType = p.taskType === "INSPECTION" ? "INSPECTION" : "MAINTENANCE";
    const data: Record<string, unknown> = {};

    try {
      let acceptance = p.acceptanceCriteria as string | null;
      if (empty(acceptance)) {
        acceptance = (await suggestPlanAcceptanceCriteria(session, { assetLabel, taskDesc, taskType, vesselCode: p.vesselCode })).text;
        data.acceptanceCriteria = acceptance;
      }

      let loto = p.loto as string | null;
      if (empty(loto)) {
        loto = (await suggestPlanLoto(session, { assetLabel, taskDesc, taskType, acceptanceCriteria: acceptance, vesselCode: p.vesselCode })).text;
        data.loto = loto;
      }

      if (!p.riskLevel || empty(p.riskAnalysisResult)) {
        const risk = await suggestPlanRisk(session, {
          assetLabel, taskDesc, taskType, acceptanceCriteria: acceptance, loto, vesselCode: p.vesselCode,
        });
        data.riskLevel = risk.level;
        data.riskProbability = risk.probability;
        data.riskConsequence = risk.consequence;
        data.riskAnalysisResult = risk.analysis;
      }

      if (!p.consequenceCategory) {
        const rcm = await suggestPlanConsequence(session, {
          assetName: assetLabel,
          vesselCode: p.vesselCode,
          assetSfiCode: p.sfiSubgroupCode,
          planTitle: p.title,
          planDescription: p.description,
          taskType,
        });
        data.consequenceCategory = rcm.category;
        data.consequenceRationale = rcm.rationale;
      }

      if (Object.keys(data).length > 0) {
        data.updatedByUserId = member!.userId;
        await prisma.maintenancePlan.update({ where: { id: p.id }, data });
      }
      ok++;
      console.log(`  OK   ${p.vesselCode.padEnd(6)} ${p.taskCode.padEnd(18)} ${Object.keys(data).filter(k => k !== "updatedByUserId").join(", ")}`);
    } catch (err) {
      fail++;
      const msg = err instanceof Error ? err.message : String(err);
      errores.push(`${p.vesselCode} ${p.taskCode}: ${msg}`);
      console.log(`  FALLA ${p.vesselCode.padEnd(6)} ${p.taskCode.padEnd(18)} ${msg}`);
    }
  }

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    await Promise.all(targets.slice(i, i + CONCURRENCY).map(run));
  }

  console.log(`\nCompletados: ${ok} · Fallados: ${fail}`);
  if (errores.length) console.log(errores.map(e => `  - ${e}`).join("\n"));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
