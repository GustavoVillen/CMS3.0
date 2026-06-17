// Demo data seed — tenant "Capital Maritima" (capitalmaritima).
// Puebla lastExecution* / nextDue* / executionStatus de los MaintenancePlan
// para una demo: mayoría válidos (FUTURE), 5 vencidos (OVERDUE) y 8 próximos
// (planificar/DUE). NO toca estimatedHours (ya están coherentes).
//
// Uso (en el VPS, cwd /app, con DATABASE_URL exportada):
//   node_modules/.bin/tsx tmp-seed-cm.ts          → aplica
//   DRY=1 node_modules/.bin/tsx tmp-seed-cm.ts     → previsualiza, sin escribir
//   REVERT=1 node_modules/.bin/tsx tmp-seed-cm.ts  → vuelve los 4 campos a null
import { PrismaClient } from "./generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

const TENANT_ID = "cmorbemkq003bful4e5w6zkqc"; // Capital Maritima
const DRY = process.env.DRY === "1";
const REVERT = process.env.REVERT === "1";

const N_OVERDUE = 5;
const N_DUE = 8;

const today = new Date();
today.setHours(0, 0, 0, 0);

function addMonths(d: Date, m: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function daysAgo(n: number): Date { return addDays(today, -n); }

// pseudo-random determinístico en [0,1) a partir de un string (FNV-1a)
function rng(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

interface PlanLite { id: string; taskCode: string; triggerType: string; frequencyMonths: number | null; frequencyHours: number | null; }

function isWeek(p: PlanLite) { return p.triggerType === "WEEK"; }
function freqDays(p: PlanLite): number { return isWeek(p) ? (p.frequencyMonths ?? 1) * 7 : (p.frequencyMonths ?? 1) * 30; }
function nextFromLast(p: PlanLite, last: Date): Date { return isWeek(p) ? addDays(last, (p.frequencyMonths ?? 1) * 7) : addMonths(last, p.frequencyMonths ?? 1); }
function subFreq(p: PlanLite, d: Date): Date { return isWeek(p) ? addDays(d, -((p.frequencyMonths ?? 1) * 7)) : addMonths(d, -(p.frequencyMonths ?? 1)); }
function planWindow(p: PlanLite): number { return (!isWeek(p) && p.frequencyMonths != null && p.frequencyMonths >= 12) ? 30 : 7; }

async function main() {
  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId: TENANT_ID, deletedAt: null },
    select: { id: true, taskCode: true, triggerType: true, frequencyMonths: true, frequencyHours: true },
  }) as PlanLite[];

  if (REVERT) {
    if (DRY) { console.log(`DRY REVERT: ${plans.length} planes volverían a null`); await prisma.$disconnect(); return; }
    let n = 0;
    for (const p of plans) {
      await prisma.maintenancePlan.update({ where: { id: p.id }, data: { lastExecutionDate: null, lastExecutionHours: null, nextDueDate: null, nextDueHours: null, executionStatus: "FUTURE" } });
      n++;
    }
    console.log(`REVERT OK: ${n} planes`);
    await prisma.$disconnect();
    return;
  }

  const hours = plans.filter(p => p.triggerType === "HOURS" || p.triggerType === "RUNNING_HOURS");
  const weekly = plans.filter(isWeek);
  const monthly = plans.filter(p => p.triggerType === "MONTHS" || p.triggerType === "CALENDAR");

  // Elegir vencidos/próximos de los mensuales, repartidos por equipo (orden por hash de id).
  const monthlySorted = [...monthly].sort((a, b) => rng(a.id) - rng(b.id));
  const overdueIds = new Set(monthlySorted.slice(0, N_OVERDUE).map(p => p.id));
  const dueIds = new Set(monthlySorted.slice(N_OVERDUE, N_OVERDUE + N_DUE).map(p => p.id));

  const updates: { id: string; taskCode: string; bucket: string; data: Record<string, unknown> }[] = [];

  // Date-based (mensuales + semanales)
  for (const p of [...monthly, ...weekly]) {
    const r = rng(p.id + "x");
    let bucket: string;
    let last: Date;
    let nextDue: Date;

    if (overdueIds.has(p.id)) {
      bucket = "OVERDUE";
      nextDue = daysAgo(3 + Math.round(r * 37));   // vencido hace 3..40 días
      last = subFreq(p, nextDue);
    } else if (dueIds.has(p.id)) {
      bucket = "DUE";
      const w = planWindow(p);
      nextDue = addDays(today, 2 + Math.round(r * Math.max(1, w - 2))); // dentro de la ventana
      last = subFreq(p, nextDue);
    } else {
      bucket = "VALID";
      const elapsed = Math.max(1, Math.round(freqDays(p) * (0.2 + r * 0.4))); // 20-60% consumido
      last = daysAgo(elapsed);
      nextDue = nextFromLast(p, last);
    }

    updates.push({
      id: p.id, taskCode: p.taskCode, bucket,
      data: { lastExecutionDate: last, lastExecutionHours: null, nextDueDate: nextDue, nextDueHours: null, executionStatus: bucket === "OVERDUE" ? "OVERDUE" : bucket === "DUE" ? "DUE" : "FUTURE" },
    });
  }

  // Hours-based (todos válidos): no hay horas de marcha cargadas → quedan FUTURE.
  for (const p of hours) {
    const freq = p.frequencyHours ?? 500;
    const last = daysAgo(30 + Math.round(rng(p.id) * 120));
    updates.push({
      id: p.id, taskCode: p.taskCode, bucket: "VALID_H",
      data: { lastExecutionDate: last, lastExecutionHours: freq, nextDueDate: null, nextDueHours: freq * 2, executionStatus: "FUTURE" },
    });
  }

  const counts: Record<string, number> = {};
  for (const u of updates) counts[u.bucket] = (counts[u.bucket] ?? 0) + 1;
  console.log("COUNTS:", JSON.stringify(counts), "total", updates.length);
  console.log("OVERDUE:", updates.filter(u => u.bucket === "OVERDUE").map(u => u.taskCode).join(", "));
  console.log("DUE:", updates.filter(u => u.bucket === "DUE").map(u => u.taskCode).join(", "));

  if (DRY) {
    console.log("DRY RUN — sin escrituras. Ejemplos:");
    for (const u of updates.slice(0, 6)) console.log(" ", u.taskCode, u.bucket, JSON.stringify(u.data));
    await prisma.$disconnect();
    return;
  }

  let n = 0;
  for (const u of updates) { await prisma.maintenancePlan.update({ where: { id: u.id }, data: u.data }); n++; }
  console.log(`UPDATED ${n} planes`);
  await prisma.$disconnect();
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
