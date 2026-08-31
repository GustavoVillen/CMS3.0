/** Read-only — vuelca el estado de los planes de mantenimiento de TODA la flota
 *  para auditarlo contra las planillas en papel de cada buque.
 *
 *  Es la version generica de dump-don-chicueto-audit.ts, que solo miraba el DCH.
 *  No escribe nada: se corre en el VPS y el JSON se baja para analizarlo local.
 *
 *  Uso (en el VPS, desde /app-cms3):
 *    export $(grep -E '^DATABASE_URL=' .env | xargs)
 *    npx tsx scripts/vessel-plan-tools/dump-fleet-plans.ts
 *    npx tsx scripts/vessel-plan-tools/dump-fleet-plans.ts --buque=DCH --buque=LTE
 */
import { PrismaClient } from "../../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const TENANT_SLUG = "mercurio";
const SALIDA = "scripts/vessel-plan-tools/out/flota-estado.json";

/** Buques pedidos por argumento; sin argumentos, todos los del tenant. */
const PEDIDOS = process.argv
  .filter(a => a.startsWith("--buque="))
  .map(a => a.split("=")[1].toUpperCase());

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`no existe el tenant ${TENANT_SLUG}`);
  const tenantId = tenant.id;

  // Ojo: en Vessel el campo se llama `code`; es en Asset y MaintenancePlan donde
  // se llama `vesselCode`. Se renombra aca para que el JSON hable un solo idioma.
  const filas = await prisma.vessel.findMany({
    where: { tenantId, ...(PEDIDOS.length ? { code: { in: PEDIDOS } } : {}) },
    select: { code: true, name: true, vesselType: true, isCrewed: true, status: true, deletedAt: true },
    orderBy: { code: "asc" },
  });
  const vessels = filas.map(({ code, ...v }: any) => ({ vesselCode: code, ...v }));
  const codes = vessels.map((v: any) => v.vesselCode);

  const assets = await prisma.asset.findMany({
    where: { tenantId, vesselCode: { in: codes } },
    select: {
      id: true, vesselCode: true, assetCode: true, name: true,
      manufacturer: true, model: true, criticality: true, deletedAt: true,
    },
    orderBy: [{ vesselCode: "asc" }, { assetCode: "asc" }],
  });

  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: { in: codes } },
    select: {
      id: true, vesselCode: true, taskCode: true, assetId: true, title: true,
      taskType: true, triggerType: true, frequencyMonths: true, frequencyHours: true,
      lastExecutionDate: true, lastExecutionHours: true,
      nextDueDate: true, nextDueHours: true,
      status: true, department: true, responsible: true, deletedAt: true,
      acceptanceCriteria: true, loto: true, riskLevel: true, consequenceCategory: true,
      createdAt: true, updatedAt: true,
    },
    orderBy: [{ vesselCode: "asc" }, { taskCode: "asc" }],
  });

  // Conteo de OT por plan: una tarea con historial pesa distinto que una vacia.
  const wos = await prisma.workOrder.groupBy({
    by: ["maintenancePlanId"],
    where: { tenantId, vesselCode: { in: codes }, maintenancePlanId: { not: null } },
    _count: { _all: true },
  });

  writeFileSync(SALIDA, JSON.stringify({
    generado: new Date().toISOString(), tenant: TENANT_SLUG, vessels, assets, plans, wos,
  }, null, 1));

  const vivos = plans.filter((p: any) => !p.deletedAt);
  console.log(`buques: ${vessels.length} | activos: ${assets.length} | planes: ${plans.length}` +
    ` (vivos ${vivos.length}, baja ${plans.length - vivos.length}) | planes con OT: ${wos.length}`);
  const porBuque: Record<string, number> = {};
  for (const p of vivos) porBuque[p.vesselCode] = (porBuque[p.vesselCode] ?? 0) + 1;
  for (const v of vessels) console.log(`   ${v.vesselCode.padEnd(8)} ${String(porBuque[v.vesselCode] ?? 0).padStart(4)}  ${v.name}`);
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
