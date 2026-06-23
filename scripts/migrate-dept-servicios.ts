/**
 * One-shot: prepara el enum WorkOrderDepartment para el nuevo set
 * (CUBIERTA, MAQUINAS, BARCAZA, PROVEEDOR, OTROS) ANTES del `db push`.
 *
 * Postgres no permite borrar un valor de enum en uso, así que:
 *   1) agrega PROVEEDOR y OTROS a la vista del enum (idempotente)
 *   2) migra las filas con department='SERVICIOS' a 'OTROS'
 * Tras correr esto, `prisma db push` puede remover SERVICIOS sin error.
 *
 * Usage:
 *   pnpm exec tsx --env-file .env scripts/migrate-dept-servicios.ts
 */

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const pool = new Pool({ connectionString: String(process.env.DATABASE_URL || "").trim() });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  // ADD VALUE no puede ir dentro de una transacción → cada uno por separado.
  await prisma.$executeRawUnsafe(`ALTER TYPE "WorkOrderDepartment" ADD VALUE IF NOT EXISTS 'PROVEEDOR'`);
  await prisma.$executeRawUnsafe(`ALTER TYPE "WorkOrderDepartment" ADD VALUE IF NOT EXISTS 'OTROS'`);
  console.log("Enum: PROVEEDOR y OTROS asegurados.");

  const migrated = await prisma.$executeRawUnsafe(
    `UPDATE "WorkOrder" SET "department" = 'OTROS' WHERE "department" = 'SERVICIOS'`,
  );
  console.log(`WorkOrder migradas SERVICIOS→OTROS: ${migrated}`);

  // Crear las columnas nuevas ANTES del db push. La columna enum
  // MaintenancePlan.department debe existir para que el paso AlterEnum (que
  // recrea el tipo al remover SERVICIOS) pueda re-castear todas sus columnas.
  await prisma.$executeRawUnsafe(`ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "providerId" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "MaintenancePlan" ADD COLUMN IF NOT EXISTS "department" "WorkOrderDepartment"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "MaintenancePlan" ADD COLUMN IF NOT EXISTS "providerId" TEXT`);
  console.log("Columnas nuevas aseguradas (WorkOrder.providerId, MaintenancePlan.department/providerId).");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
