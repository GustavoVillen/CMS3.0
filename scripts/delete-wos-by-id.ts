/**
 * Borrado LOGICO de ordenes de trabajo por id. Sirve para limpiar OT que quedaron
 * a medio crear (por ejemplo, una carga masiva que se corto en el medio).
 *
 * Se niega a tocar una OT que ya este cerrada (completedDate) salvo que se pase
 * FORCE=1: una OT cerrada es evidencia, no basura de una corrida fallida.
 *
 * Uso:
 *   export DATABASE_URL="postgresql://..."
 *   DRY=1 npx tsx scripts/delete-wos-by-id.ts <id> <id> ...
 *   npx tsx scripts/delete-wos-by-id.ts <id> <id> ...
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const FORCE = process.env.FORCE === "1";
const IDS = process.argv.slice(2).filter(Boolean);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL.");
  if (!IDS.length) throw new Error("Pasá al menos un id de OT.");

  const wos = await prisma.workOrder.findMany({ where: { id: { in: IDS } } });
  console.log(`${DRY ? "DRY-RUN · " : ""}${wos.length} de ${IDS.length} ids encontrados\n`);

  const faltantes = IDS.filter((id) => !wos.some((w: any) => w.id === id));
  for (const id of faltantes) console.log(`  [no existe] ${id}`);

  const aBorrar: any[] = [];
  for (const w of wos) {
    const estado = `${w.workOrderCode} | ${w.vesselCode} | ${w.status} | cerrada=${w.completedDate ? w.completedDate.toISOString().slice(0, 10) : "no"} | ya borrada=${w.deletedAt ? "si" : "no"}`;
    if (w.deletedAt) {
      console.log(`  [ya borrada] ${estado}`);
      continue;
    }
    if (w.completedDate && !FORCE) {
      console.log(`  [SE OMITE, está cerrada] ${estado}`);
      continue;
    }
    console.log(`  [borra] ${estado}`);
    aBorrar.push(w);
  }

  console.log(`\nA borrar: ${aBorrar.length}`);
  if (DRY || !aBorrar.length) {
    if (DRY) console.log("DRY-RUN: no se borró nada.");
    return;
  }

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: aBorrar[0].tenantId, role: "TENANT_ADMIN" },
    select: { userId: true },
  });
  const uid = member?.userId;
  if (!uid) throw new Error("No encontré un TENANT_ADMIN para firmar el borrado.");

  const r = await prisma.workOrder.updateMany({
    where: { id: { in: aBorrar.map((w: any) => w.id) } },
    data: { deletedAt: new Date(), deletedByUserId: uid, updatedByUserId: uid },
  });
  console.log(`Borradas (lógico): ${r.count}`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
