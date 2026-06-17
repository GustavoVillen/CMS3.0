/**
 * Backfill — eliminar el SUBGRUPO SFI de los datos existentes (no destructivo).
 *
 * El sistema ahora solo usa el GRUPO SFI (0-9). Este script normaliza los datos
 * ya cargados, SIN borrar columnas/tablas:
 *   - Asset.sfiCode              "610" → "600"  (se conserva solo el grupo "G00")
 *   - Spare.sfiCode              "710" → "700"
 *   - InspectionTemplate.sfiCode "xxx" → "G00"
 *   - EquipmentClass.defaultSfiCode "xxx" → "G00"
 *   - MaintenancePlan.sfiSubgroupCode → null   (se conserva sfiGroupNumber)
 *
 * Idempotente. Corre sobre TODOS los tenants.
 *
 * Uso:
 *   DATABASE_URL=<url> npx tsx scripts/backfill-sfi-group-only.ts
 *   DRY=1 DATABASE_URL=<url> npx tsx scripts/backfill-sfi-group-only.ts
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";

/** Devuelve el código de grupo "G00" a partir de cualquier código SFI, o null. */
function toGroupCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const digit = String(code).trim().replace(/\D/g, "")[0];
  return /^[0-9]$/.test(digit ?? "") ? `${digit}00` : null;
}

async function backfillSfiCode(model: string, delegate: any): Promise<{ scanned: number; changed: number }> {
  const rows = await delegate.findMany({ where: { sfiCode: { not: null } }, select: { id: true, sfiCode: true } });
  let changed = 0;
  for (const r of rows) {
    const next = toGroupCode(r.sfiCode);
    if (next && next !== r.sfiCode) {
      if (!DRY) await delegate.update({ where: { id: r.id }, data: { sfiCode: next } });
      changed++;
    }
  }
  console.log(`  ${model}: ${rows.length} con sfiCode · ${changed} ${DRY ? "se normalizarían" : "normalizados"}`);
  return { scanned: rows.length, changed };
}

async function main() {
  console.log(DRY ? "== DRY-RUN (no escribe) ==" : "== Aplicando backfill ==");

  // 1) Assets / Spares / InspectionTemplate
  await backfillSfiCode("Asset", prisma.asset);
  await backfillSfiCode("Spare", prisma.spare);
  await backfillSfiCode("InspectionTemplate", prisma.inspectionTemplate);

  // 2) EquipmentClass.defaultSfiCode
  {
    const rows = await prisma.equipmentClass.findMany({ where: { defaultSfiCode: { not: null } }, select: { id: true, defaultSfiCode: true } });
    let changed = 0;
    for (const r of rows) {
      const next = toGroupCode(r.defaultSfiCode);
      if (next && next !== r.defaultSfiCode) {
        if (!DRY) await prisma.equipmentClass.update({ where: { id: r.id }, data: { defaultSfiCode: next } });
        changed++;
      }
    }
    console.log(`  EquipmentClass.defaultSfiCode: ${rows.length} · ${changed} ${DRY ? "se normalizarían" : "normalizados"}`);
  }

  // 3) MaintenancePlan.sfiSubgroupCode → null (conservando sfiGroupNumber)
  {
    const count = await prisma.maintenancePlan.count({ where: { sfiSubgroupCode: { not: null } } });
    if (!DRY && count > 0) {
      await prisma.maintenancePlan.updateMany({ where: { sfiSubgroupCode: { not: null } }, data: { sfiSubgroupCode: null } });
    }
    console.log(`  MaintenancePlan.sfiSubgroupCode: ${count} ${DRY ? "se vaciarían" : "vaciados (→ null)"}`);
  }

  console.log(`\n${DRY ? "DRY-RUN terminado." : "✅ Backfill completado."}`);
}

main()
  .catch((e) => {
    console.error("❌ Error:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
