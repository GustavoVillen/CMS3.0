/**
 * Ajusta el plan de Inspección de Renovación de Clase del DCH con las fechas
 * reales (tablero + correo de H. Portillo, 20/08/2026) y crea el plan de
 * Ship Status que faltaba.
 *
 * Contexto (acordado con el usuario):
 *  - DCH-0-001 ("Inspeccion de Renovacion de Clase") ya existía, con
 *    providerRequests = RINA (clase) + SENAT (espesores), department
 *    PROVEEDOR, windowMode MANUAL / 120 días — eso NO se toca. Sólo le
 *    faltaban lastExecutionDate / nextDueDate.
 *      lastExecutionDate = 2025-02-21 (última inspección de clase)
 *      nextDueDate       = 2030-11-10 (vencimiento, confirmado por tablero
 *                           y por el certificado que mandó Portillo)
 *  - Ship Status (DCH-0-002, nuevo): no existía ningún plan. Se crea con
 *    frecuencia 3 meses, proveedor RINA, windowMode AUTO (decisión del
 *    usuario: "por ahora AUTO").
 *      nextDueDate = 2026-11-20 — dato del correo de Portillo del 20/08/2026,
 *      que renovó el Ship Status de TODA la flota (MGT01-27 + DCH) a esa
 *      misma fecha. El 2026-04-26 que traía el tablero de enero está viejo,
 *      no se usa.
 *      lastExecutionDate = 2026-08-20 (fecha del envío de Portillo; Ship
 *      Status vale 3 meses, cierra justo en 2026-11-20).
 *
 * Idempotente: si DCH-0-002 ya existe (aun soft-deleted, por la colisión de
 * @@unique conocida) actualiza en vez de duplicar.
 *
 * Uso:
 *   DRY=1 npx tsx scripts/load-dch-class-inspections.ts   # previsualiza
 *   npx tsx scripts/load-dch-class-inspections.ts         # ejecuta
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const TENANT_SLUG = "mercurio";
const VESSEL = "DCH";
const HULL_ASSET_CODE = "DCH-1-CC-001";
const RINA_PROVIDER_CODE = "PRV-0003";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" no encontrado.`);

  const vessel = await prisma.vessel.findFirst({ where: { tenantId: tenant.id, code: VESSEL, deletedAt: null } });
  if (!vessel) throw new Error(`Vessel "${VESSEL}" no encontrado en el tenant ${TENANT_SLUG}.`);

  const asset = await prisma.asset.findFirst({
    where: { tenantId: tenant.id, vesselCode: VESSEL, assetCode: HULL_ASSET_CODE, deletedAt: null },
  });
  if (!asset) throw new Error(`Asset "${HULL_ASSET_CODE}" no encontrado.`);

  const rina = await prisma.provider.findFirst({
    where: { tenantId: tenant.id, providerCode: RINA_PROVIDER_CODE, deletedAt: null },
  });
  if (!rina) throw new Error(`Provider "${RINA_PROVIDER_CODE}" (RINA) no encontrado.`);

  const admins = await prisma.tenantMembership.findMany({
    where: { tenantId: tenant.id, role: "TENANT_ADMIN" },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (!admins.length) throw new Error(`No hay TENANT_ADMIN en el tenant ${TENANT_SLUG}.`);
  const actor =
    admins.find((a: any) => a.user?.email === "jbael@mercuriogroup.com.py")?.userId ?? admins[0].userId;

  const classPlan = await prisma.maintenancePlan.findFirst({
    where: { tenantId: tenant.id, vesselCode: VESSEL, taskCode: "DCH-0-001" },
  });
  if (!classPlan) throw new Error("DCH-0-001 no encontrado — se esperaba que ya existiera.");

  const shipStatusPlan = await prisma.maintenancePlan.findFirst({
    where: { tenantId: tenant.id, vesselCode: VESSEL, taskCode: "DCH-0-002" },
  });

  console.log(`Tenant ${TENANT_SLUG} (${tenant.id}) · Vessel ${VESSEL} · asset ${HULL_ASSET_CODE} (${asset.id}) · RINA ${rina.id} · actor ${actor}`);
  console.log("\n1) DCH-0-001 (Inspeccion de Renovacion de Clase) — sólo fechas, no se toca windowMode/windowLeadDays:");
  console.log("   lastExecutionDate: 2025-02-21");
  console.log("   nextDueDate:       2030-11-10");
  console.log(`\n2) DCH-0-002 (Ship Status) — ${shipStatusPlan ? "ya existe, se actualiza" : "no existe, se crea"}:`);
  console.log("   frequencyMonths: 3 · department: PROVEEDOR · provider: RINA PY · windowMode: AUTO");
  console.log("   lastExecutionDate: 2026-08-20");
  console.log("   nextDueDate:       2026-11-20");

  if (DRY) {
    console.log("\nDRY=1 — no se escribió nada.");
    return;
  }

  await prisma.maintenancePlan.update({
    where: { id: classPlan.id },
    data: {
      lastExecutionDate: new Date("2025-02-21T00:00:00.000Z"),
      nextDueDate: new Date("2030-11-10T00:00:00.000Z"),
      updatedByUserId: actor,
    },
  });
  console.log("\nDCH-0-001 actualizado.");

  const shipStatusData = {
    tenantId: tenant.id,
    vesselCode: VESSEL,
    assetId: asset.id,
    taskCode: "DCH-0-002",
    title: "Ship Status",
    description: "Renovación de Ship Status ante RINA PY. Cada renovación vale 3 meses.",
    taskType: "INSPECTION",
    triggerType: "MONTHS",
    frequencyMonths: 3,
    department: "PROVEEDOR",
    providerId: rina.id,
    providerRequests: [{ purpose: "Ship Status", providerId: rina.id }],
    status: "ACTIVE",
    windowMode: "AUTO",
    lastExecutionDate: new Date("2026-08-20T00:00:00.000Z"),
    nextDueDate: new Date("2026-11-20T00:00:00.000Z"),
    executionStatus: "FUTURE",
    updatedByUserId: actor,
  };

  if (shipStatusPlan) {
    await prisma.maintenancePlan.update({ where: { id: shipStatusPlan.id }, data: shipStatusData });
    console.log("DCH-0-002 actualizado (ya existía).");
  } else {
    await prisma.maintenancePlan.create({ data: { ...shipStatusData, createdByUserId: actor } });
    console.log("DCH-0-002 creado.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
