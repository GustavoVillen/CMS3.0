/**
 * Corrige el "próximo vencimiento" por horas de planes (MAO 02 y uno de DCH) que quedó
 * desfasado respecto de última ejecución + frecuencia (error de copia de la
 * planilla del Owner: la última se actualizó y el próximo quedó del ciclo anterior,
 * o quedó vacío).
 *
 * Sólo toca nextDueHours y sólo si el valor actual coincide con el que se vio
 * (idempotente y seguro de correr en otra base).
 *
 * Uso:  DATABASE_URL=<url> npx tsx scripts/fix-next-due-hours-mao02.ts
 *       DRY=1 ...  → previsualiza sin escribir
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";

// id, código, próximo actual esperado (null = vacío)
const FIXES: Array<[string, string, number | null]> = [
  ["cmqr4wb6v005beal4av2apqlw", "M02-MP-BR-10", 11632],
  ["cmt1f4bkl000ltfl4zc3c31tt", "M02-MP-BR-33", 8632],
  ["cmqr4wb75005heal41v6r78w6", "M02-MP-BR-24", 8632],
  ["cmqr4wb6m0058eal4p00l05bj", "M02-MP-BR-05", 8074],
  ["cmqr4wb6t005aeal4j2pcimq4", "M02-MP-BR-08", null],
  ["cmqr4wb6n0059eal4gk1w3va1", "M02-MP-BR-07", null],
  ["cmqr4wb2f002zeal43yluijpc", "M02-CR-BR-03", null],
  // Segunda tanda: se decidió última + frecuencia en todos (2026-09-19).
  ["cmqr4wb6a004zeal47woyo1ke", "M02-MA-ER-18", 89037],
  ["cmsewppg303jdw7l4tsfss28c", "M02-MA-ER-18", 89037],
  ["cmsewpplt03nhw7l4x5ykeyiq", "M02-MA-BR-18", 86590],
  ["cmqr4wb5n004neal4jsmi5o4q", "M02-MA-BR-18", 86590],
  ["cmsewppeo03iaw7l4b2duzhvi", "M02-MP-ER-05", 25365],
  ["cmsewppfr03j3w7l4h5c6m9kr", "M02-MP-BR-05", 25435],
  ["cmt1f4bkm0032tfl41lmbcnm4", "M02-COMP-BR-33", 1315],
  ["cmt1f4bkm0035tfl4lhfkjrvk", "M02-COMP-BR-36", 6000],
  ["cmt1f4bkl001itfl4kvt08qwf", "M02-MA-BR-36", 6145],
  ["cmsxhccz600007cl4cgylbz34", "DCH-MA-PTO-30", 23386],
];

// SQL=1 imprime el UPDATE equivalente (para correrlo con psql donde no hay tsx).
if (process.env.SQL === "1") {
  for (const [id, code, exp] of FIXES) {
    const cond = exp === null ? `"nextDueHours" IS NULL` : `"nextDueHours" = ${exp}`;
    console.log(`UPDATE "MaintenancePlan" SET "nextDueHours" = "lastExecutionHours" + "frequencyHours" WHERE id = '${id}' AND "taskCode" = '${code}' AND ${cond} AND "lastExecutionHours" IS NOT NULL AND "frequencyHours" > 0; -- ${code}`);
  }
  process.exit(0);
}

async function main() {
  const backup: unknown[] = [];
  for (const [id, code, expectedNext] of FIXES) {
    const p = await prisma.maintenancePlan.findUnique({
      where: { id },
      select: { taskCode: true, frequencyHours: true, lastExecutionHours: true, nextDueHours: true },
    });
    if (!p || p.taskCode !== code) { console.log(`${code}: no existe con ese id, se salta`); continue; }
    if (p.nextDueHours !== expectedNext) { console.log(`${code}: próximo ya es ${p.nextDueHours} (esperaba ${expectedNext}), se salta`); continue; }
    if (p.lastExecutionHours == null || !p.frequencyHours) { console.log(`${code}: sin última o sin frecuencia, se salta`); continue; }
    const next = p.lastExecutionHours + p.frequencyHours;
    console.log(`${code}: ${p.nextDueHours ?? "vacío"} -> ${next} (${p.lastExecutionHours} + ${p.frequencyHours})`);
    backup.push({ id, code, nextDueHours: p.nextDueHours });
    if (!DRY) await prisma.maintenancePlan.update({ where: { id }, data: { nextDueHours: next } });
  }
  if (!DRY && backup.length) writeFileSync("scripts/_tmp-backup-next-due.json", JSON.stringify(backup, null, 1));
  console.log(DRY ? "DRY: no se escribió nada" : `Listo: ${backup.length} planes corregidos`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
