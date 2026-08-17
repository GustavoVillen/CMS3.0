/**
 * Alinea los planes de mantenimiento de los MOTORES PROPULSORES del LATERE (LTE)
 * con el plan en papel "PLAN DE MANT. LTE - JULIO.xlsx" (hoja MOTORES_PROPULSORES).
 *
 * Contexto: los 4 motores principales del LTE se habian dado de alta clonando el
 * plan de un buque con motores Volvo Penta D16 MH. El LTE tiene Cummins KTA-50,
 * asi que las frecuencias cargadas no eran las suyas (500 h de aceite contra 400,
 * refrigerante por horas en vez de cada 24 meses, etc.) y faltaban 6 tareas por
 * motor. Este script corrige las 9 existentes y crea las 6 que faltan, y carga
 * las horas y fechas reales de ultima ejecucion y vencimiento.
 *
 * Los datos NO estan escritos aca: salen de scripts/_tmp-lte-mp-plans.json, que
 * genera scripts/_tmp-gen-lte-mp-plans.py leyendo el Excel. Asi no hay numeros
 * transcriptos a mano.
 *
 * Los planes existentes se reconocen por el sufijo numerico del taskCode
 * (LTE-MP-BR-01, LTE-MP-#3-01 -> "01"). El taskCode viejo se respeta: renombrarlo
 * no aporta nada y los planes ya tienen historial colgando.
 *
 * NO toca criterios de aceptacion, LOTO, riesgo ni RCM: eso lo completa la pasada
 * de IA posterior (load-lte-plan-ia.ts).
 *
 * Idempotente: se puede correr las veces que haga falta; deja el mismo resultado.
 *
 * Uso (en el VPS):
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/load-lte-plan-motores.ts    # previsualiza, no escribe
 *   npx tsx scripts/load-lte-plan-motores.ts          # aplica
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync, writeFileSync } from "node:fs";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const TENANT_SLUG = "mercurio";
const VESSEL = "LTE";
const USER_LEGACY_ID = "MAQUINASLATERE";
const SRC = "scripts/_tmp-lte-mp-plans.json";

interface PlanSpec {
  asset: string;
  motor: string;
  code: string;
  title: string;
  description: string;
  triggerType: "HOURS" | "MONTHS";
  taskType: "MAINTENANCE" | "INSPECTION";
  frequencyHours: number | null;
  frequencyMonths: number | null;
  lastExecutionHours: number | null;
  nextDueHours: number | null;
  lastExecutionDate: string | null;
  nextDueDate: string | null;
  samplingKind?: string;
  samplingFluidType?: string;
  nota: string | null;
}

/** Sufijo numerico del taskCode: LTE-MP-BR-01 -> "01", LTE-MP-#3-18 -> "18". */
function codeSuffix(taskCode: string): string {
  const m = taskCode.match(/-(\d+)$/);
  return m ? m[1] : taskCode;
}

const d = (s: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

async function main() {
  const specs: PlanSpec[] = JSON.parse(readFileSync(SRC, "utf8"));

  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} no encontrado`);
  const tenantId = tenant.id;

  const user = await prisma.user.findFirst({
    where: { legacyUserId: USER_LEGACY_ID },
    select: { id: true, firstName: true },
  });
  if (!user) throw new Error(`Usuario ${USER_LEGACY_ID} no encontrado`);

  const assetCodes = [...new Set(specs.map(s => s.asset))];
  const assets = await prisma.asset.findMany({
    where: { tenantId, vesselCode: VESSEL, assetCode: { in: assetCodes }, deletedAt: null },
    select: { id: true, assetCode: true, name: true, sfiCode: true, manufacturer: true, model: true },
  });
  const byCode = new Map<string, any>(assets.map((a: any) => [a.assetCode, a]));
  for (const c of assetCodes) if (!byCode.has(c)) throw new Error(`Asset ${c} no encontrado en ${VESSEL}`);

  const existing = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: VESSEL, assetId: { in: assets.map((a: any) => a.id) }, deletedAt: null },
  });

  // Respaldo del estado previo, para poder volver atras sin depender del dump.
  writeFileSync("scripts/_tmp-lte-mp-backup.json", JSON.stringify(existing, null, 1));

  const plans = new Map<string, any>(); // assetId|sufijo -> plan
  for (const p of existing) plans.set(`${p.assetId}|${codeSuffix(p.taskCode)}`, p);

  const creates: any[] = [];
  const updates: { plan: any; data: any; spec: PlanSpec }[] = [];

  for (const s of specs) {
    const asset = byCode.get(s.asset)!;
    const found = plans.get(`${asset.id}|${s.code}`);

    const data: any = {
      title: s.title,
      description: s.description,
      triggerType: s.triggerType,
      frequencyHours: s.frequencyHours,
      frequencyMonths: s.frequencyMonths,
      taskType: s.taskType,
      // Area/responsable del plan de maquinas del buque.
      department: "MAQUINAS",
      responsible: "Jefe de Máquinas",
      // El grupo SFI sale del activo (los MP tienen sfiCode 600 -> grupo 6).
      sfiGroupNumber: asset.sfiCode ? Number(String(asset.sfiCode)[0]) : 6,
      // Todas las tareas del plan de maquinas abren OT al vencer.
      triggerResultMode: "AUTO_WO",
      status: "ACTIVE",
      lastExecutionHours: s.lastExecutionHours,
      nextDueHours: s.nextDueHours,
      lastExecutionDate: d(s.lastExecutionDate),
      nextDueDate: d(s.nextDueDate),
      samplingKind: s.samplingKind ?? null,
      samplingFluidType: s.samplingFluidType ?? null,
      updatedByUserId: user.id,
    };

    if (found) {
      updates.push({ plan: found, data, spec: s });
    } else {
      creates.push({
        ...data,
        tenantId,
        vesselCode: VESSEL,
        assetId: asset.id,
        taskCode: `${s.asset}-${s.code}`,
        createdByUserId: user.id,
      });
    }
  }

  // Planes de motor que quedan fuera del plan en papel (ninguno esperado, pero
  // se reporta si aparece alguno).
  const tocados = new Set(updates.map(u => u.plan.id));
  const huerfanos = existing.filter((p: any) => !tocados.has(p.id));

  console.log("── LATERE / MOTORES PROPULSORES ──────────────────────────────");
  console.log(`Buque:    ${VESSEL}   Usuario: ${user.firstName} (${USER_LEGACY_ID})`);
  console.log(`Corrige:  ${updates.length} planes existentes`);
  console.log(`Crea:     ${creates.length} planes nuevos`);
  console.log(`Sin par:  ${huerfanos.length} planes del sistema fuera del plan en papel`);
  for (const p of huerfanos) console.log(`   · ${p.taskCode} — ${p.title}`);

  console.log("\n── CAMBIOS DE FRECUENCIA ─────────────────────────────────────");
  for (const u of updates) {
    const before = u.plan.triggerType === "HOURS" ? `${u.plan.frequencyHours}h` : `${u.plan.frequencyMonths}m`;
    const after = u.data.triggerType === "HOURS" ? `${u.data.frequencyHours}h` : `${u.data.frequencyMonths}m`;
    if (before !== after) console.log(`   ${u.plan.taskCode.padEnd(16)} ${before.padStart(7)} → ${after.padStart(7)}   ${u.data.title}`);
  }

  console.log("\n── NUEVOS ────────────────────────────────────────────────────");
  for (const c of creates) {
    const f = c.triggerType === "HOURS" ? `${c.frequencyHours}h` : `${c.frequencyMonths}m`;
    console.log(`   ${c.taskCode.padEnd(16)} ${f.padStart(7)}   ${c.title}`);
  }

  const notas = specs.filter(s => s.nota);
  if (notas.length) {
    console.log("\n── OBSERVACIONES SOBRE LOS DATOS DEL PLAN EN PAPEL ───────────");
    for (const s of notas) console.log(`   ${s.motor} ${s.title}\n      ${s.nota}`);
  }

  if (DRY) {
    console.log("\n[DRY] No se escribio nada.");
    return;
  }

  let nUpd = 0;
  for (const u of updates) {
    await prisma.maintenancePlan.update({ where: { id: u.plan.id }, data: u.data });
    nUpd++;
  }
  const nNew = creates.length ? (await prisma.maintenancePlan.createMany({ data: creates })).count : 0;

  console.log(`\nOK — ${nUpd} planes corregidos, ${nNew} creados.`);
  console.log("Respaldo del estado previo: scripts/_tmp-lte-mp-backup.json");
}

main().catch(e => { console.error("ERROR:", e.message ?? e); process.exitCode = 1; }).finally(() => process.exit());
