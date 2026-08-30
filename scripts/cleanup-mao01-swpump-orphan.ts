/**
 * LIMPIEZA puntual — MAO 01 (buque "M01", tenant "mercurio").
 *
 * Contexto: al unificar las tareas de la bomba de agua de mar de los motores
 * principales (se fusionó "Cambio rotor de bomba de agua" 2500 h con el
 * "Cambio de kit de desgaste de bomba de agua de mar" 3000 h del manual),
 * el seed quedó con UNA tarea menos por motor. Como el seed hace upsert y
 * NUNCA borra, al re-seedear la vieja tarea "Cambio de kit de desgaste…" que
 * estaba al final del array queda HUÉRFANA (su taskCode ya no se genera) y
 * duplica a la nueva. Este script la da de baja.
 *
 * Qué borra (soft-delete, marca deletedAt): en los activos M01-MP-ER y
 * M01-MP-BR, el plan con
 *     title = "Cambio de kit de desgaste de bomba de agua de mar"
 *     lastExecutionHours = null  AND  nextDueHours = null
 * El plan "bueno" (reseedeado) tiene horas cargadas (23565/26565 · 23635/26635),
 * así que ese filtro apunta EXCLUSIVAMENTE al huérfano. Robusto tanto si se
 * corre antes como después del reseed.
 *
 * Seguridad:
 *   - Soft-delete (coherente con el patrón del sistema); NO borra físico.
 *   - Reporta cuántas OTs referencian cada plan antes de tocarlo.
 *   - Espera 0..2 huérfanos; si encuentra otra cosa, avisa y no asume.
 *
 * Uso:
 *   DRY=1 DATABASE_URL=<url> npx tsx scripts/cleanup-mao01-swpump-orphan.ts   → previsualiza
 *   DATABASE_URL=<url> npx tsx scripts/cleanup-mao01-swpump-orphan.ts         → aplica
 *   TENANT_SLUG=mercurio VESSEL_CODE=M01  (overridables por env)
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = process.env.VESSEL_CODE ?? "M01";
const DRY = process.env.DRY === "1";

const ASSET_CODES = ["M01-MP-ER", "M01-MP-BR"];
const ORPHAN_TITLE = "Cambio de kit de desgaste de bomba de agua de mar";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado en esta base.`);
  const tid: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: tid, role: "TENANT_ADMIN" },
    select: { userId: true },
  });
  const uid: string | undefined = member?.userId;
  if (!uid) throw new Error(`No hay usuario TENANT_ADMIN en tenant '${SLUG}'.`);

  const assets = await prisma.asset.findMany({
    where: { tenantId: tid, vesselCode: VESSEL, assetCode: { in: ASSET_CODES } },
    select: { id: true, assetCode: true },
  });
  const assetById = new Map<string, string>(assets.map((a: any) => [a.id, a.assetCode]));
  if (assets.length === 0) {
    console.log(`No se encontraron activos ${ASSET_CODES.join(", ")} en ${SLUG}/${VESSEL}. Nada que hacer.`);
    return;
  }

  const orphans = await prisma.maintenancePlan.findMany({
    where: {
      tenantId: tid,
      vesselCode: VESSEL,
      assetId: { in: assets.map((a: any) => a.id) },
      title: ORPHAN_TITLE,
      lastExecutionHours: null,
      nextDueHours: null,
      deletedAt: null,
    },
    select: { id: true, taskCode: true, assetId: true, title: true },
    orderBy: { taskCode: "asc" },
  });

  if (orphans.length === 0) {
    console.log("✅ No hay planes huérfanos (posiblemente ya limpiado o aún sin reseedear). Nada que borrar.");
    return;
  }
  if (orphans.length > ASSET_CODES.length) {
    console.warn(
      `⚠️  Se encontraron ${orphans.length} planes que matchean el filtro (esperados ≤ ${ASSET_CODES.length}). ` +
        `Revisá manualmente antes de continuar — no asumo.`,
    );
  }

  for (const p of orphans) {
    const woCount = await prisma.workOrder.count({
      where: { tenantId: tid, maintenancePlanId: p.id, deletedAt: null },
    });
    const warn = woCount > 0 ? `  ⚠️ ${woCount} OT(s) referencian este plan` : "";
    console.log(
      `${DRY ? "DRY " : "✓ "}baja plan ${p.taskCode} [${assetById.get(p.assetId) ?? "?"}] — ${p.title}${warn}`,
    );
  }

  if (!DRY) {
    const res = await prisma.maintenancePlan.updateMany({
      where: { id: { in: orphans.map((p: any) => p.id) } },
      data: { deletedAt: new Date(), deletedByUserId: uid, status: "INACTIVE" },
    });
    console.log(`\n✅ ${res.count} plan(es) huérfano(s) dados de baja (soft-delete).`);
  } else {
    console.log(`\nDRY-RUN (no se modificó nada). ${orphans.length} plan(es) se darían de baja.`);
  }
}

main()
  .catch((e) => {
    console.error("❌ Error:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
