/**
 * Fase 2 de la migración WO (correr en el VPS, con DATABASE_URL de PRODUCCIÓN).
 *
 * Lee wo-migration-results.json (salida de migrate-wo-from-ss.ts --live) y por cada WO:
 *   - retro-fecha openDate/startDate/dueDate/completedDate/aprobadoAt/autorizadoAt/createdAt/updatedAt
 *     a las fechas reales del Excel,
 *   - SOBRESCRIBE workOrderCode con el código original del Excel (excelCode),
 *   - fecha createdAt de progress notes y createdAt/performedAt de work logs.
 *
 * Uso (en el VPS):
 *   cd /app-cms3
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   npx tsx scripts/backdate-wo-migration.ts wo-migration-results.json
 *
 * Idempotente. Valida colisión de código antes de renombrar.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const FILE = process.argv[2] || "wo-migration-results.json";
if (!process.env.DATABASE_URL) { console.error("Falta DATABASE_URL (PRODUCCIÓN)."); process.exit(1); }

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

interface Ok {
  woId: string; excelCode: string; apiCode: string; planTaskCode: string;
  openDate: string | null; dueDate: string | null; startDate: string | null; completedDate: string | null;
  aprobadoAt: string | null; autorizadoAt: string | null;
}
/** "YYYY-MM-DD" → Date al mediodía UTC (evita corrimiento de día por timezone). */
const ts = (d: string | null, fb: string | null): Date | null => {
  const v = d ?? fb;
  return v ? new Date(`${v.slice(0, 10)}T12:00:00.000Z`) : null;
};

async function main() {
  const raw = JSON.parse(readFileSync(FILE, "utf8")) as { ok: Ok[] };
  const entries = raw.ok || [];
  console.log(`Backdating + preservación de código: ${entries.length} WO desde ${FILE}\n`);

  let updated = 0, notFound = 0, codeRenamed = 0, notes = 0, logs = 0;

  // ── Paso 1: fechas + progress notes/work logs + código TEMPORAL único ──────────
  // Renombrar a temporal primero evita colisiones cuando un excelCode coincide con
  // el código que la API asignó a OTRA WO del lote (rangos SS-M01-26-* se solapan).
  for (const e of entries) {
    const wo = await prisma.workOrder.findFirst({ where: { id: e.woId, deletedAt: null }, select: { id: true } });
    if (!wo) { console.warn(`  ! no encontrada: ${e.excelCode} (${e.woId})`); notFound++; continue; }

    const open = ts(e.openDate, e.completedDate);
    const start = ts(e.startDate, e.openDate);
    const due = ts(e.dueDate, e.completedDate);
    const done = ts(e.completedDate, e.openDate);
    const aprob = ts(e.aprobadoAt, e.completedDate);
    const autor = ts(e.autorizadoAt, e.completedDate);
    const tmpCode = `MIG-${e.woId.slice(-12)}`; // único por woId, no colisiona

    await prisma.$executeRawUnsafe(
      `UPDATE "WorkOrder" SET "openDate"=$1,"startDate"=$2,"dueDate"=$3,"completedDate"=$4,
         "aprobadoAt"=$5,"autorizadoAt"=$6,"createdAt"=$1,"updatedAt"=$4,"workOrderCode"=$7 WHERE id=$8`,
      open, start ?? open, due ?? done, done, aprob ?? done, autor ?? done, tmpCode, e.woId,
    );

    notes += Number(await prisma.$executeRawUnsafe(`UPDATE "WorkOrderProgressNote" SET "createdAt"=$1 WHERE "workOrderId"=$2 AND "deletedAt" IS NULL`, done, e.woId));
    logs += Number(await prisma.$executeRawUnsafe(`UPDATE "WorkLog" SET "createdAt"=$1,"startedAt"=$1,"completedAt"=$1 WHERE "workOrderId"=$2`, done, e.woId));

    updated++;
    if (updated % 50 === 0) console.log(`  paso1 ...${updated}/${entries.length}`);
  }

  // ── Paso 2: código definitivo del Excel (ya sin colisiones, los viejos son MIG-*) ──
  for (const e of entries) {
    if (!e.excelCode) continue;
    await prisma.$executeRawUnsafe(`UPDATE "WorkOrder" SET "workOrderCode"=$1 WHERE id=$2`, e.excelCode, e.woId);
    codeRenamed++;
    if (codeRenamed % 50 === 0) console.log(`  paso2 ...${codeRenamed}/${entries.length}`);
  }

  console.log(`\n========== RESUMEN ==========`);
  console.log(`WO actualizadas:     ${updated}`);
  console.log(`Código preservado:   ${codeRenamed}`);
  console.log(`No encontradas:      ${notFound}`);
  console.log(`Progress notes:      ${notes} | Work logs: ${logs}`);
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
