/**
 * Borrado LOGICO de todos los planes de mantenimiento de un buque (deletedAt).
 * NO toca equipos (Assets) ni ordenes de trabajo (WorkOrder) — las OT cerradas
 * quedan como historial. Reversible. DRY=1 previsualiza.
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = process.env.VESSEL ?? "MGT10";
const DRY = process.env.DRY === "1";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tid: string = tenant.id;
  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: tid, role: "TENANT_ADMIN" }, select: { userId: true },
  });
  const uid: string | undefined = member?.userId;
  if (!uid) throw new Error(`No hay TENANT_ADMIN en '${SLUG}'.`);

  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId: tid, vesselCode: VESSEL, deletedAt: null },
    select: { id: true, taskCode: true, title: true },
    orderBy: { taskCode: "asc" },
  });
  console.log(`${DRY ? "DRY-RUN · " : ""}${VESSEL}: ${plans.length} planes a borrar (logico)`);
  for (const p of plans) console.log(`  ${p.taskCode.padEnd(20)} ${p.title}`);

  if (!DRY && plans.length) {
    const r = await prisma.maintenancePlan.updateMany({
      where: { id: { in: plans.map((p: any) => p.id) } },
      data: { deletedAt: new Date(), deletedByUserId: uid, updatedByUserId: uid },
    });
    console.log(`\n✅ ${r.count} planes marcados como borrados.`);
  } else {
    console.log(`\n${DRY ? "DRY-RUN (no se escribio nada)." : "Nada que borrar."}`);
  }
}
main().catch((e) => { console.error("❌", e?.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
