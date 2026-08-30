/** Read-only — imprime JSON de planes de M01 (mercurio): id, taskCode, title, assetId. */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

async function main() {
  const t = await prisma.tenant.findFirst({ where: { slug: "mercurio" }, select: { id: true } });
  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId: t.id, vesselCode: "M01" },
    select: { id: true, taskCode: true, title: true, assetId: true, triggerType: true, frequencyMonths: true, frequencyHours: true },
    orderBy: { taskCode: "asc" },
  });
  console.log(JSON.stringify(plans));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
