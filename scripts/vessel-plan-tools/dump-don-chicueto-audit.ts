/** Read-only — vuelca el estado actual de los planes del DON CHICUETO para auditarlo
 *  contra la planilla en papel (07- PMP DON CHICUETO - JULIO.xlsm). */
import { PrismaClient } from "../../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "mercurio" }, select: { id: true } });
  const tenantId = tenant.id;

  const assets = await prisma.asset.findMany({
    where: { tenantId, vesselCode: "DCH" },
    select: { id: true, assetCode: true, name: true, manufacturer: true, model: true, deletedAt: true },
    orderBy: { assetCode: "asc" },
  });

  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: "DCH" },
    select: {
      id: true, taskCode: true, assetId: true, title: true, description: true,
      taskType: true, triggerType: true, frequencyMonths: true, frequencyHours: true,
      lastExecutionDate: true, lastExecutionHours: true,
      nextDueDate: true, nextDueHours: true,
      status: true, department: true, responsible: true, deletedAt: true,
      acceptanceCriteria: true, loto: true, riskLevel: true, consequenceCategory: true, executionStatus: true,
      updatedAt: true,
    },
    orderBy: [{ taskCode: "asc" }],
  });

  const wos = await prisma.workOrder.groupBy({
    by: ["maintenancePlanId"],
    where: { tenantId, vesselCode: "DCH", maintenancePlanId: { not: null } },
    _count: { _all: true },
  });

  writeFileSync("scripts/vessel-plan-tools/out/dch-estado.json",
    JSON.stringify({ generado: new Date().toISOString(), assets, plans, wos }, null, 1));
  console.log("activos:", assets.length, "(baja:", assets.filter((a: any) => a.deletedAt).length, ")",
    "planes:", plans.length, "(baja:", plans.filter((p: any) => p.deletedAt).length, ")",
    "planes con OT:", wos.length);
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
