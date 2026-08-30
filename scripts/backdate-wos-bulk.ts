// Fase 2 de la simulacion: retro-fecha los timestamps de las OTs creadas por
// simulate-wo-history.ts al dia simulado (la API los estampa en "hoy").
//
// Lee wo_results.json (salida de la fase API) y, por cada OT en `ok`, setea al
// simDay: openDate, startDate, dueDate, completedDate, createdAt, updatedAt,
// aprobadoAt, autorizadoAt; y el createdAt de sus progress notes / work logs.
//
// NO toca lastExecutionDate/nextDueDate del plan (ya quedaron correctos via API).
//
// Debe correr donde este la DATABASE_URL de PRODUCCION (VPS):
//   ssh gpms-vps ; cd /app-cms3
//   export DATABASE_URL="postgresql://...prod..."
//   npx tsx scripts/backdate-wos-bulk.ts wo_results.json
//
// Idempotente: re-correrlo deja los mismos valores.

import { readFileSync } from "node:fs";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const RESULTS_FILE = process.argv[2] || "wo_results.json";

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL (debe apuntar a la base de PRODUCCION).");
  process.exit(1);
}

interface OkEntry {
  taskCode: string;
  planId: string;
  woId: string;
  workOrderCode: string;
  simDay: string; // YYYY-MM-DD
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL as string),
} as any);

/** simDay -> Date al mediodia UTC (evita corrimientos de un dia por timezone). */
function targetDate(simDay: string): Date {
  return new Date(`${simDay.slice(0, 10)}T12:00:00.000Z`);
}

async function main() {
  const raw = JSON.parse(readFileSync(RESULTS_FILE, "utf8")) as { ok: OkEntry[] };
  const entries = raw.ok || [];
  console.log(`Backdating ${entries.length} OTs desde ${RESULTS_FILE}...`);

  let okCount = 0;
  let notFound = 0;
  let progressNotes = 0;
  let workLogs = 0;

  for (const e of entries) {
    const target = targetDate(e.simDay);

    const wo = await (prisma as any).workOrder.findFirst({
      where: { id: e.woId, deletedAt: null },
      select: { id: true },
    });
    if (!wo) {
      console.warn(`  ! WO no encontrada: ${e.workOrderCode} (${e.woId})`);
      notFound++;
      continue;
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "WorkOrder"
       SET "openDate" = $1, "startDate" = $1, "dueDate" = $1, "completedDate" = $1,
           "aprobadoAt" = $1, "autorizadoAt" = $1, "createdAt" = $1, "updatedAt" = $1
       WHERE id = $2`,
      target,
      e.woId,
    );

    progressNotes += Number(
      await prisma.$executeRawUnsafe(
        `UPDATE "WorkOrderProgressNote" SET "createdAt" = $1 WHERE "workOrderId" = $2 AND "deletedAt" IS NULL`,
        target,
        e.woId,
      ),
    );
    workLogs += Number(
      await prisma.$executeRawUnsafe(
        `UPDATE "WorkLog" SET "createdAt" = $1, "performedAt" = $1 WHERE "workOrderId" = $2`,
        target,
        e.woId,
      ),
    );

    okCount++;
    if (okCount % 50 === 0) console.log(`  ...${okCount}/${entries.length}`);
  }

  console.log(`\nListo. OTs backdateadas: ${okCount} | no encontradas: ${notFound}`);
  console.log(`Progress notes: ${progressNotes} | work logs: ${workLogs}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
