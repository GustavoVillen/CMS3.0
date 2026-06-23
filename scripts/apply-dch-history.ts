/**
 * Aplica la ULTIMA EJECUCION a los planes de DCH desde el mapping generado por
 * scripts/match-dch-history.py (MisDocs/_dch_history_map.json).
 *
 *   { "<taskCode>": { "hours": <n> } | { "date": "YYYY-MM-DD" }, ... }
 *
 * Setea lastExecutionHours/Date y calcula nextDue con la MISMA fórmula del sistema
 * (recalculateNextDue: MONTHS→+meses, HOURS→última+freq, DAY→+días, WEEK→+días*7).
 * executionStatus se deriva en lectura desde nextDue, no hace falta tocarlo.
 * Idempotente. DRY=1 para previsualizar.
 *
 * Uso (en el VPS):
 *   DATABASE_URL=<url> MAP=MisDocs/_dch_history_map.json npx tsx scripts/apply-dch-history.ts
 *   DRY=1 ...   → no escribe
 */
import { readFileSync } from "fs";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}
/** Misma lógica que recalculateNextDue() del service. */
function computeNextDue(
  trigger: string, fh: number | null, fm: number | null,
  lastDate: Date | null, lastHours: number | null,
): { nextDueDate: Date | null; nextDueHours: number | null } {
  if (trigger === "MONTHS" || trigger === "CALENDAR")
    return fm && fm > 0 && lastDate ? { nextDueDate: addMonths(lastDate, fm), nextDueHours: null } : { nextDueDate: null, nextDueHours: null };
  if (trigger === "HOURS" || trigger === "RUNNING_HOURS")
    return lastHours != null && fh && fh > 0 ? { nextDueDate: null, nextDueHours: lastHours + fh } : { nextDueDate: null, nextDueHours: null };
  if (trigger === "DAY")
    return fm && fm > 0 && lastDate ? { nextDueDate: addDays(lastDate, fm), nextDueHours: null } : { nextDueDate: null, nextDueHours: null };
  if (trigger === "WEEK")
    return fm && fm > 0 && lastDate ? { nextDueDate: addDays(lastDate, fm * 7), nextDueHours: null } : { nextDueDate: null, nextDueHours: null };
  return { nextDueDate: null, nextDueHours: null };
}

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = process.env.DST_VESSEL ?? "DCH";
const MAP = process.env.MAP ?? "MisDocs/_dch_history_map.json";
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

  const map: Record<string, { hours?: number; date?: string; cov?: string }> = JSON.parse(readFileSync(MAP, "utf8"));
  const codes = Object.keys(map);
  let nH = 0, nD = 0, miss = 0;

  for (const taskCode of codes) {
    const entry = map[taskCode];
    const plan = await prisma.maintenancePlan.findUnique({
      where: { tenantId_vesselCode_taskCode: { tenantId: tid, vesselCode: VESSEL, taskCode } },
      select: { id: true, triggerType: true, frequencyHours: true, frequencyMonths: true },
    });
    if (!plan) { console.warn(`⚠ plan no encontrado: ${taskCode}`); miss++; continue; }

    const data: Record<string, unknown> = {};
    let lastDate: Date | null = null, lastHours: number | null = null;
    if (typeof entry.hours === "number") { lastHours = entry.hours; data.lastExecutionHours = lastHours; nH++; }
    else if (entry.date) { lastDate = new Date(`${entry.date}T00:00:00.000Z`); data.lastExecutionDate = lastDate; nD++; }
    else continue;

    const nd = computeNextDue(String(plan.triggerType), plan.frequencyHours, plan.frequencyMonths, lastDate, lastHours);
    data.nextDueDate = nd.nextDueDate;
    data.nextDueHours = nd.nextDueHours;

    if (!DRY) {
      await prisma.maintenancePlan.update({ where: { id: plan.id }, data: { ...data, updatedByUserId: uid } });
    }
  }

  console.log(
    `\n${DRY ? "DRY-RUN. " : "✅ Completado. "}${VESSEL}: ${nH} planes con horas · ${nD} con fecha` +
      `${miss ? ` · ${miss} no encontrados` : ""} (de ${codes.length} en el mapping).`,
  );
}

main().catch((e) => { console.error("❌", e?.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
