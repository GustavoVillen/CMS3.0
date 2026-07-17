/**
 * Renumera las Órdenes de Trabajo de Mercurio: `SS-<VESSEL>-<YY>-<NNNN>` → `OT-…`.
 *
 * Por qué: se creía que una Orden de Trabajo (OT) y una Solicitud de Servicio (SS)
 * eran la misma entidad con distinto nombre. No lo son — la SS es el pedido de un
 * servicio externo que cuelga de una OT abierta. Todo lo cargado hasta ahora son
 * OT, así que recuperan su prefijo real y "SS-" queda libre para la entidad nueva.
 *
 * Qué toca (todo dentro de una transacción):
 *   1. WorkOrder.workOrderCode   SS- → OT-   (incluye soft-deleted: si no, un
 *      undelete futuro chocaría contra @@unique([tenantId, vesselCode, code]))
 *   2. StockMovement.notes       el código embebido en el texto libre
 *   3. FluidSample.notes         idem
 *   4. TenantForm.codePattern    SERVICE_REQUEST → NULL (el código de la SS pasa a
 *      ser natural `SS-<VESSEL>-<YY>-<NNNN>`, generado en el create; la fila en DB
 *      gana sobre el default en código, así que hay que limpiarla acá)
 *
 * Qué NO toca, deliberadamente:
 *   · AuditEvent / BitacoraEntry → audit trail y bitácora escrita por humanos.
 *     Reescribirlos es justo lo que audita un vetting inspector (ver record-lock.ts).
 *   · FormDocument.code → son números de documento SS-0001-<VESSEL>-<YEAR>, no
 *     códigos de OT. Quedan como traza de lo ya emitido.
 *   · Notification / AiInsight → se regeneran solos.
 *   · Otros tenants → el prefijo es por slug (mercurio=OT, resto=WO).
 *
 * La numeración NO se rompe: las queries de correlativo hacen
 * `SUBSTRING("workOrderCode", 4)`, y OT- ocupa 3 chars igual que SS-/WO-.
 *
 * Idempotente: si ya hay códigos OT-*, no vuelve a correr.
 *
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/rename-ss-to-ot.ts   → previsualiza, no escribe
 *   npx tsx scripts/rename-ss-to-ot.ts         → ejecuta
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const TENANT_SLUG = process.env.TENANT_SLUG ?? "mercurio";

// Solo reemplaza cuando matchea el formato de código completo
// (SS-<VESSEL>-<YY>-<SEQ>). Un REPLACE ciego de 'SS-' podría pisar texto libre.
const CODE_RE = "SS-([A-Z0-9]+-[0-9]+-[0-9]+)";

async function main() {
  console.log(`\n${DRY ? "🔍 DRY-RUN (no escribe nada)" : "⚠️  EJECUCIÓN REAL"} — tenant '${TENANT_SLUG}'\n`);

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' no encontrado en esta base.`);
  const tenantId: string = tenant.id;

  // ── 0. Pre-checks ──────────────────────────────────────────────────────────
  const [{ count: yaMigradas }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM "WorkOrder" WHERE "tenantId" = $1 AND "workOrderCode" LIKE 'OT-%'`,
    tenantId,
  );
  if (Number(yaMigradas) > 0) {
    console.log(`✅ Ya hay ${yaMigradas} OT con prefijo OT-. La migración ya corrió — nada que hacer.`);
    return;
  }

  const porBuque = await prisma.$queryRawUnsafe<{ vesselCode: string; total: bigint; borradas: bigint }[]>(
    `SELECT "vesselCode",
            COUNT(*)::bigint AS total,
            COUNT("deletedAt")::bigint AS borradas
       FROM "WorkOrder"
      WHERE "tenantId" = $1 AND "workOrderCode" LIKE 'SS-%'
      GROUP BY "vesselCode" ORDER BY 2 DESC`,
    tenantId,
  );
  const totalWo = porBuque.reduce((a, r) => a + Number(r.total), 0);
  if (totalWo === 0) {
    console.log("No hay OT con prefijo SS-. Nada que migrar.");
    return;
  }
  console.log(`OT a renumerar: ${totalWo}`);
  for (const r of porBuque) {
    console.log(`   ${r.vesselCode.padEnd(8)} ${String(r.total).padStart(5)}${Number(r.borradas) ? `  (${r.borradas} soft-deleted)` : ""}`);
  }

  // Códigos con otro formato → se reportan y NO se tocan.
  const raros = await prisma.$queryRawUnsafe<{ workOrderCode: string }[]>(
    `SELECT "workOrderCode" FROM "WorkOrder"
      WHERE "tenantId" = $1 AND "workOrderCode" LIKE 'SS-%'
        AND "workOrderCode" !~ '^${CODE_RE}$' LIMIT 10`,
    tenantId,
  );
  if (raros.length) {
    console.log(`\n⚠️  ${raros.length} código(s) con formato inesperado (se renumeran igual, revisar):`);
    raros.forEach(r => console.log(`   ${r.workOrderCode}`));
  }

  // ── Muestras antes → después ───────────────────────────────────────────────
  const muestras = await prisma.$queryRawUnsafe<{ antes: string; despues: string }[]>(
    `SELECT "workOrderCode" AS antes, 'OT-' || SUBSTRING("workOrderCode", 4) AS despues
       FROM "WorkOrder" WHERE "tenantId" = $1 AND "workOrderCode" LIKE 'SS-%'
      ORDER BY "workOrderCode" LIMIT 5`,
    tenantId,
  );
  console.log("\nMuestras WorkOrder:");
  muestras.forEach(m => console.log(`   ${m.antes.padEnd(20)} → ${m.despues}`));

  const notasSm = await prisma.$queryRawUnsafe<{ antes: string; despues: string }[]>(
    `SELECT LEFT(notes, 60) AS antes, LEFT(REGEXP_REPLACE(notes, '${CODE_RE}', 'OT-\\1', 'g'), 60) AS despues
       FROM "StockMovement" WHERE "tenantId" = $1 AND notes ~ '${CODE_RE}' LIMIT 3`,
    tenantId,
  );
  if (notasSm.length) {
    console.log("\nMuestras StockMovement.notes:");
    notasSm.forEach(m => console.log(`   ${m.antes}\n → ${m.despues}`));
  }

  const notasFs = await prisma.$queryRawUnsafe<{ antes: string; despues: string }[]>(
    `SELECT LEFT(notes, 60) AS antes, LEFT(REGEXP_REPLACE(notes, '${CODE_RE}', 'OT-\\1', 'g'), 60) AS despues
       FROM "FluidSample" WHERE "tenantId" = $1 AND notes ~ '${CODE_RE}' LIMIT 3`,
    tenantId,
  );
  if (notasFs.length) {
    console.log("\nMuestras FluidSample.notes:");
    notasFs.forEach(m => console.log(`   ${m.antes}\n → ${m.despues}`));
  }

  if (DRY) {
    console.log("\n🔍 DRY-RUN — no se escribió nada. Quitá DRY=1 para ejecutar.\n");
    return;
  }

  // ── Ejecución ──────────────────────────────────────────────────────────────
  const res = await prisma.$transaction(async (tx: any) => {
    const wo = await tx.$executeRawUnsafe(
      `UPDATE "WorkOrder" SET "workOrderCode" = 'OT-' || SUBSTRING("workOrderCode", 4)
        WHERE "tenantId" = $1 AND "workOrderCode" LIKE 'SS-%'`,
      tenantId,
    );
    const sm = await tx.$executeRawUnsafe(
      `UPDATE "StockMovement" SET notes = REGEXP_REPLACE(notes, '${CODE_RE}', 'OT-\\1', 'g')
        WHERE "tenantId" = $1 AND notes ~ '${CODE_RE}'`,
      tenantId,
    );
    const fs = await tx.$executeRawUnsafe(
      `UPDATE "FluidSample" SET notes = REGEXP_REPLACE(notes, '${CODE_RE}', 'OT-\\1', 'g')
        WHERE "tenantId" = $1 AND notes ~ '${CODE_RE}'`,
      tenantId,
    );
    // El código de la SS pasa a ser natural (SS-<VESSEL>-<YY>-<NNNN>, generado en
    // el create del ServiceRequest). Sin esto seguiría emitiendo SS-0001-<V>-<YEAR>.
    const tf = await tx.$executeRawUnsafe(
      `UPDATE "TenantForm" SET "codePattern" = NULL
        WHERE "tenantId" = $1 AND "type" = 'SERVICE_REQUEST' AND "codePattern" IS NOT NULL`,
      tenantId,
    );
    return { wo, sm, fs, tf };
  });

  console.log("\n✅ Migración aplicada:");
  console.log(`   WorkOrder.workOrderCode : ${res.wo}`);
  console.log(`   StockMovement.notes     : ${res.sm}`);
  console.log(`   FluidSample.notes       : ${res.fs}`);
  console.log(`   TenantForm.codePattern  : ${res.tf}`);

  // ── Post-check ─────────────────────────────────────────────────────────────
  const [{ count: quedan }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM "WorkOrder" WHERE "tenantId" = $1 AND "workOrderCode" LIKE 'SS-%'`,
    tenantId,
  );
  if (Number(quedan) > 0) throw new Error(`❌ Post-check: quedaron ${quedan} OT con prefijo SS-.`);
  console.log(`   Post-check              : 0 OT con SS- ✔\n`);
}

main()
  .catch(e => { console.error("\n❌ ERROR:", e.message, "\n"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
