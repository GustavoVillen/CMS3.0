/**
 * Clona puntualmente 2 planes de M02 (MAO 02) a M01 (MAO 01) que son
 * genuinamente nuevos en M01 (nunca existieron, no son un borrado a restaurar):
 *   - M02-4-001 (CO2)     → M01-4-001, sobre asset M01-CO2 (activo)
 *   - M02-5-001 (Sewage)  → M01-5-001, sobre asset M01-SEWAGE (activo)
 *
 * Se excluyen a propósito del clon masivo M02→M01 los códigos que en M01
 * corresponden a borrados intencionales recientes (AIS, AJUSTES, y 3 planes
 * SERVICE/OVERHAUL) para no revivirlos.
 *
 * Uso: DATABASE_URL=<url> npx tsx scripts/clone-two-plans-m02-m01.ts [DRY=1]
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const SLUG = "mercurio";

const PAIRS = [
  { srcCode: "M02-4-001", dstCode: "M01-4-001", dstAssetCode: "M01-CO2" },
  { srcCode: "M02-5-001", dstCode: "M01-5-001", dstAssetCode: "M01-SEWAGE" },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tid: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: tid, role: "TENANT_ADMIN" },
    select: { userId: true },
  });
  const uid: string | undefined = member?.userId;
  if (!uid) throw new Error(`No hay usuario TENANT_ADMIN en tenant '${SLUG}'.`);

  for (const pair of PAIRS) {
    const src = await prisma.maintenancePlan.findFirst({
      where: { tenantId: tid, vesselCode: "M02", taskCode: pair.srcCode, deletedAt: null },
    });
    if (!src) { console.warn(`⚠ ${pair.srcCode} no encontrado en M02; se omite`); continue; }

    const existing = await prisma.maintenancePlan.findFirst({
      where: { tenantId: tid, vesselCode: "M01", taskCode: pair.dstCode },
      select: { id: true, deletedAt: true },
    });
    if (existing) { console.warn(`⚠ ${pair.dstCode} ya existe en M01 (deletedAt=${existing.deletedAt}); se omite para no pisar`); continue; }

    const asset = await prisma.asset.findFirst({
      where: { tenantId: tid, vesselCode: "M01", assetCode: pair.dstAssetCode, deletedAt: null },
      select: { id: true },
    });
    if (!asset) { console.warn(`⚠ Asset destino ${pair.dstAssetCode} no existe/activo en M01; se omite`); continue; }

    const data = {
      title: src.title, description: src.description, triggerType: src.triggerType,
      frequencyHours: src.frequencyHours, frequencyMonths: src.frequencyMonths, estimatedHours: src.estimatedHours,
      responsible: src.responsible, department: src.department, providerId: src.providerId,
      acceptanceCriteria: src.acceptanceCriteria, loto: src.loto,
      sfiGroupNumber: src.sfiGroupNumber, sfiSubgroupCode: src.sfiSubgroupCode,
      riskLevel: src.riskLevel, riskProbability: src.riskProbability, riskConsequence: src.riskConsequence,
      riskAnalysisResult: src.riskAnalysisResult, taskType: src.taskType,
      consequenceCategory: src.consequenceCategory, consequenceRationale: src.consequenceRationale,
      taskMasterId: src.taskMasterId, samplingKind: src.samplingKind, samplingFluidType: src.samplingFluidType,
      triggerResultMode: src.triggerResultMode, checklistTemplate: src.checklistTemplate,
      windowMode: src.windowMode, windowLeadDays: src.windowLeadDays,
      windowLeadHours: src.windowLeadHours, windowLeadPercent: src.windowLeadPercent,
      status: "ACTIVE", executionStatus: "FUTURE",
      lastExecutionDate: null, nextDueDate: null, lastExecutionHours: null, nextDueHours: null,
      windowOpenDate: null, windowOpenHours: null,
    };

    console.log(`${DRY ? "DRY " : "✓ "}Plan ${pair.srcCode} → ${pair.dstCode} (asset ${pair.dstAssetCode})`);
    if (!DRY) {
      await prisma.maintenancePlan.create({
        data: { tenantId: tid, vesselCode: "M01", taskCode: pair.dstCode, assetId: asset.id, ...data, createdByUserId: uid, updatedByUserId: uid },
      });
    }
  }
  console.log(DRY ? "\nDRY-RUN (no se escribió nada)." : "\n✅ Completado.");
}

main()
  .catch((e) => { console.error("❌ Error:", e?.message ?? e); process.exit(1); })
  .finally(() => prisma.$disconnect());
