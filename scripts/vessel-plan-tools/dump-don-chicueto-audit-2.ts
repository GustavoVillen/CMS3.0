/** Read-only — segunda pasada de la auditoria del DON CHICUETO:
 *  quien movio la ultima ejecucion de los planes que quedaron adelantados
 *  respecto de la planilla, y que planes nacieron despues de la carga del 17-ago. */
import { PrismaClient } from "../../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const CODES = process.env.CODES ? process.env.CODES.split(",") : [];

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "mercurio" }, select: { id: true } });
  const tenantId = tenant.id;

  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: "DCH", taskCode: { in: CODES } },
    select: { id: true, taskCode: true, title: true, lastExecutionDate: true, updatedAt: true, updatedByUserId: true },
  });
  const ids = plans.map((p: any) => p.id);

  const directas = await prisma.workOrder.findMany({
    where: { tenantId, vesselCode: "DCH", maintenancePlanId: { in: ids } },
    select: { workOrderCode: true, title: true, status: true, completedDate: true, maintenancePlanId: true },
  });
  const links = await prisma.workOrderMaintenancePlan.findMany({
    where: { tenantId, maintenancePlanId: { in: ids } },
    select: { maintenancePlanId: true, workOrder: { select: { workOrderCode: true, status: true, completedDate: true } } },
  });
  const logs = await prisma.workLog.findMany({
    where: { maintenancePlanId: { in: ids } },
    select: { maintenancePlanId: true, startedAt: true, completedAt: true, createdAt: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(plans.map((p: any) => p.updatedByUserId))] } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });

  // Planes nacidos despues de la carga de las 20 hojas.
  const nuevos = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: "DCH", deletedAt: null, createdAt: { gt: new Date("2026-08-18T00:00:00Z") } },
    select: { taskCode: true, title: true, createdAt: true, createdByUserId: true },
    orderBy: { createdAt: "asc" },
  });

  writeFileSync("scripts/vessel-plan-tools/out/dch-auditoria2.json",
    JSON.stringify({ plans, directas, links, logs, users, nuevos }, null, 1));
  console.log("planes:", plans.length, "OT directas:", directas.length, "OT por link:", links.length,
    "worklogs:", logs.length, "planes creados despues del 18-ago:", nuevos.length);
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
