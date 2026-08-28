// Migra los planes que quedaron con triggerResultMode = EXPRESS al modo
// "Solo Alerta" (DUE_ONLY), tras eliminar el modulo "Mantenimiento Express".
//
// Correr SIEMPRE ANTES de aplicar el schema nuevo (`prisma db push`): el push
// elimina el valor EXPRESS del enum y falla si alguna fila todavia lo usa.
//
// Solo toca la configuracion del plan: NO borra ejecuciones, WorkLogs ni
// movimientos de stock ya registrados. Idempotente y seguro de correr aunque el
// enum ya no tenga EXPRESS (compara sobre texto, no sobre el enum).
//
// Uso:
//   DATABASE_URL=<...> npx tsx scripts/migrate-express-plans.ts
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any);

async function main() {
  const plans = await prisma.$queryRawUnsafe<Array<{ taskCode: string | null; title: string; vesselCode: string }>>(
    `SELECT "taskCode", "title", "vesselCode" FROM "MaintenancePlan" WHERE "triggerResultMode"::text = 'EXPRESS'`,
  );

  if (plans.length === 0) {
    console.log("Nada que migrar: ningun plan usa EXPRESS.");
  } else {
    for (const p of plans) console.log(`  ${p.vesselCode} · ${p.taskCode ?? "(sin codigo)"} · ${p.title}`);
    const count = await prisma.$executeRawUnsafe(
      `UPDATE "MaintenancePlan" SET "triggerResultMode" = 'DUE_ONLY' WHERE "triggerResultMode"::text = 'EXPRESS'`,
    );
    console.log(`✔ ${count} plan(es) migrados de EXPRESS a DUE_ONLY.`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
