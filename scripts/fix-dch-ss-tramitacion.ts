/**
 * Corrige la tramitación + firmas de las 64 SS de DCH (SS-DCH-26-0002..0065).
 *
 * El PDF (template-mercurio) arma cada columna así:
 *   SOLICITA      → nombre+firma de createdByUserId
 *   APRUEBA       → nombre = aprobadoByName, firma de aprobadoByUserId
 *   AUTORIZA      → nombre = autorizadoByName, firma de autorizadoByUserId
 *   CIERRA LA SS  → nombre = executedByName, firma de updatedByUserId (si CLOSED)
 *
 * Jefe de Máquinas = Oscar Duarte (solicita Y cierra). Aprueba Ronald Silva,
 * autoriza Jorge Bael. Los tres tienen firma (data-URI) cargada → se incrustan.
 *
 * Idempotente. DRY=1 para previsualizar.
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/fix-dch-ss-tramitacion.ts
 *   npx tsx scripts/fix-dch-ss-tramitacion.ts
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const VESSEL = "DCH";
const TENANT_SLUG = "mercurio";

const OSCAR = "cmqzd266m00wfmel400orx52a";   // Oscar Duarte — Jefe de Máquinas
const RONALD = "cmqp9rgb5005g1ml4onazz8ut";  // Ronald Silva
const JORGE = "cmqp9qix900591ml4haiefuh9";   // Jorge Bael
const JEFE_NAME = "Oscar Duarte";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} no encontrado`);
  const tenantId = tenant.id;

  const codes = Array.from({ length: 64 }, (_, i) => `SS-${VESSEL}-26-${String(i + 2).padStart(4, "0")}`);
  const wos = await prisma.workOrder.findMany({
    where: { tenantId, vesselCode: VESSEL, workOrderCode: { in: codes } },
    select: { id: true, workOrderCode: true },
  });

  console.log(`\n===== FIX tramitación/firmas SS DCH (${DRY ? "DRY-RUN" : "LIVE"}) =====`);
  console.log(`SS encontradas: ${wos.length}/64`);
  console.log(`SOLICITA = Oscar Duarte | APRUEBA = Ronald Silva | AUTORIZA = Jorge Bael | CIERRA = Oscar Duarte`);

  if (DRY) {
    console.log(`(DRY-RUN: no se escribió nada.)\n`);
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  for (const wo of wos) {
    await prisma.workOrder.update({
      where: { id: wo.id },
      data: {
        createdByUserId: OSCAR,        // SOLICITA (nombre + firma)
        updatedByUserId: OSCAR,        // CIERRA LA SS (firma)
        aprobadoByUserId: RONALD,      // APRUEBA (firma); aprobadoByName ya = "Ronald Silva"
        autorizadoByUserId: JORGE,     // AUTORIZA (firma); autorizadoByName ya = "Jorge Bael"
        executedByName: JEFE_NAME,     // CIERRA LA SS (nombre)
      },
    });
    // El avance lo registra el Jefe de Máquinas
    await prisma.workOrderProgressNote.updateMany({
      where: { workOrderId: wo.id },
      data: { createdByUserId: OSCAR },
    });
    ok++;
    if (ok % 10 === 0 || ok === wos.length) console.log(`  [${ok}/${wos.length}] ${wo.workOrderCode} OK`);
  }

  console.log(`\n===== LISTO: ${ok} SS corregidas =====\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
