/**
 * Borrado LOGICO de ordenes de trabajo por id. Sirve para limpiar OT que quedaron
 * a medio crear (por ejemplo, una carga masiva que se corto en el medio).
 *
 * Se niega a tocar una OT que ya este cerrada (completedDate) salvo que se pase
 * FORCE=1: una OT cerrada es evidencia, no basura de una corrida fallida.
 *
 * ADEMAS LIBERA EL NUMERO DE ORDEN. El generador de codigos busca el maximo
 * correlativo entre las OT NO borradas (generateWorkOrderCode, "deletedAt IS
 * NULL"), pero el indice unico si cuenta las borradas. Resultado: una OT borrada
 * se queda con su numero y la proxima OT del buque choca contra el con un 500.
 * Por eso al borrar se le antepone ANUL- al codigo: queda trazable, y como el
 * generador compara con SUBSTRING(codigo, 4) el renombrado sale del conteo.
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

  const ANUL = "ANUL-";
  const aBorrar: any[] = [];
  const aLiberar: any[] = [];
  for (const w of wos) {
    const estado = `${w.workOrderCode} | ${w.vesselCode} | ${w.status} | cerrada=${w.completedDate ? w.completedDate.toISOString().slice(0, 10) : "no"} | ya borrada=${w.deletedAt ? "si" : "no"}`;
    if (w.deletedAt) {
      if (w.workOrderCode.startsWith(ANUL)) {
        console.log(`  [ya borrada, número ya liberado] ${estado}`);
      } else {
        console.log(`  [ya borrada, se libera el número] ${estado} → ${ANUL}${w.workOrderCode}`);
        aLiberar.push(w);
      }
      continue;
    }
    if (w.completedDate && !FORCE) {
      console.log(`  [SE OMITE, está cerrada] ${estado}`);
      continue;
    }
    console.log(`  [borra y libera el número] ${estado} → ${ANUL}${w.workOrderCode}`);
    aBorrar.push(w);
  }

  console.log(`\nA borrar: ${aBorrar.length} · números a liberar de borradas previas: ${aLiberar.length}`);
  if (DRY || (!aBorrar.length && !aLiberar.length)) {
    if (DRY) console.log("DRY-RUN: no se tocó nada.");
    return;
  }

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: (aBorrar[0] ?? aLiberar[0]).tenantId, role: "TENANT_ADMIN" },
    select: { userId: true },
  });
  const uid = member?.userId;
  if (!uid) throw new Error("No encontré un TENANT_ADMIN para firmar el borrado.");

  const now = new Date();
  let borradas = 0;
  for (const w of aBorrar) {
    await prisma.workOrder.update({
      where: { id: w.id },
      data: { deletedAt: now, deletedByUserId: uid, updatedByUserId: uid, workOrderCode: `${ANUL}${w.workOrderCode}` },
    });
    borradas++;
  }
  let liberadas = 0;
  for (const w of aLiberar) {
    await prisma.workOrder.update({
      where: { id: w.id },
      data: { workOrderCode: `${ANUL}${w.workOrderCode}`, updatedByUserId: uid },
    });
    liberadas++;
  }
  console.log(`Borradas (lógico): ${borradas} · números liberados: ${liberadas}`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
