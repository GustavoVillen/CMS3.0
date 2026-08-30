/**
 * One-shot: backdate all date fields on a specific WO to simulate
 * maintenance performed on a given date.
 *
 * Usage:
 *   export DATABASE_URL="..."
 *   npx tsx scripts/backdate-wo.ts WO-M02-26-0002 2025-11-20
 */

import { PrismaClient } from "../generated/prisma";

const [, , woCode, dateStr] = process.argv;
if (!woCode || !dateStr) {
  console.error("Usage: backdate-wo.ts <WO_CODE> <YYYY-MM-DD>");
  process.exit(1);
}

const target = new Date(dateStr + "T12:00:00.000Z");

const prisma = new PrismaClient();

async function main() {
  const wo = await (prisma as any).workOrder.findFirst({
    where: { workOrderCode: woCode, deletedAt: null },
    select: { id: true, workOrderCode: true, tenantId: true, vesselCode: true },
  });

  if (!wo) {
    console.error(`WO "${woCode}" not found.`);
    process.exit(1);
  }

  console.log(`Found: ${wo.workOrderCode} (${wo.id})`);

  // Update WO date fields
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkOrder"
     SET
       "openDate"      = $1,
       "startDate"     = $1,
       "dueDate"       = $1,
       "completedDate" = $1,
       "aprobadoAt"    = $1,
       "autorizadoAt"  = $1,
       "createdAt"     = $1,
       "updatedAt"     = $1
     WHERE id = $2`,
    target,
    wo.id,
  );
  console.log(`WorkOrder dates → ${target.toISOString()}`);

  // Update all progress notes
  const result = await prisma.$executeRawUnsafe(
    `UPDATE "WorkOrderProgressNote"
     SET "createdAt" = $1
     WHERE "workOrderId" = $2 AND "deletedAt" IS NULL`,
    target,
    wo.id,
  );
  console.log(`ProgressNotes updated: ${result}`);

  // Update work logs
  const logs = await prisma.$executeRawUnsafe(
    `UPDATE "WorkLog"
     SET "createdAt" = $1, "performedAt" = $1
     WHERE "workOrderId" = $2`,
    target,
    wo.id,
  );
  console.log(`WorkLogs updated: ${logs}`);

  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
