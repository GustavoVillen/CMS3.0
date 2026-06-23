/**
 * Clona el Plan de Mantenimiento completo de un buque a otro (mismo tenant).
 * Copia: Assets + MaintenancePlans + Spares.  NO copia WorkOrders ni WorkLogs.
 *
 * Reglas:
 *   - assetCode / taskCode: se reemplaza el prefijo del buque origen por el destino
 *     (ej: M01-MP-ER → DCH-MP-ER ; M01-610-001 → DCH-610-001).
 *   - Spares: el sku es part-number del fabricante → se conserva igual. Stock = 0.
 *   - TIMING RESETEADO en los planes: lastExecution* / nextDue* / windowOpen* en
 *     blanco, executionStatus=FUTURE, status=ACTIVE. El historial heredado se carga
 *     aparte (Excel). Un buque distinto tiene horas de motor propias.
 *   - Idempotente: upsert por (tenantId, vesselCode, code). Re-correr actualiza.
 *   - SKIP_EXISTING=1: NO toca registros que ya existen en el destino (assets/planes/
 *     spares cuyo código/sku ya está en DST). Sólo crea lo que falta. Útil cuando el
 *     destino ya tiene datos en uso (ej. OTs colgando de un plan) que no se deben pisar
 *     ni resetear. Los assets preexistentes igual se mapean para remapear FKs de lo nuevo.
 *   - FKs que son por-buque NO se copian a ciegas:
 *       · MaintenancePlan.assetId  → remapeado al asset del destino (obligatorio).
 *       · Spare.linkedAssetId      → remapeado si apunta a un asset del origen, si no null.
 *       · Spare.defaultLocationId  → null (las ubicaciones de stock son por buque).
 *     FKs tenant-scoped SÍ se copian: providerId, taskMasterId, preferredSupplierId,
 *     equipmentClassId.
 *
 * Uso:
 *   DATABASE_URL=<url> npx tsx scripts/clone-vessel-mp.ts
 *   DRY=1 ...   → previsualiza, no escribe
 *   SRC_VESSEL=M01 DST_VESSEL=DCH TENANT_SLUG=mercurio  (overridables por env)
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const SRC = process.env.SRC_VESSEL ?? "M01";
const DST = process.env.DST_VESSEL ?? "DCH";
const DRY = process.env.DRY === "1";
const SKIP_EXISTING = process.env.SKIP_EXISTING === "1";

/** Reemplaza el prefijo de buque del código. M01-... → DCH-... ; M01... → DCH... */
function renameCode(code: string): string {
  if (code.startsWith(`${SRC}-`)) return `${DST}-${code.slice(SRC.length + 1)}`;
  if (code.startsWith(SRC)) return `${DST}${code.slice(SRC.length)}`;
  return `${DST}-${code}`; // no debería pasar con los datos de M01
}

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

  for (const code of [SRC, DST]) {
    const v = await prisma.vessel.findUnique({
      where: { tenantId_code: { tenantId: tid, code } },
      select: { code: true, name: true },
    });
    if (!v) throw new Error(`Buque '${code}' no existe en tenant '${SLUG}'.`);
    console.log(`  buque ${code} = ${v.name}`);
  }

  // ── 1) ASSETS ───────────────────────────────────────────────────────────────
  const srcAssets = await prisma.asset.findMany({
    where: { tenantId: tid, vesselCode: SRC, deletedAt: null },
    orderBy: { assetCode: "asc" },
  });
  const assetMap = new Map<string, string>(); // srcAssetId → dstAssetId
  const seenAssetCodes = new Set<string>();

  // Registros que ya existen en destino (para SKIP_EXISTING): code/sku → id.
  const existingAssetByCode = new Map<string, string>();
  const existingPlanCodes = new Set<string>();
  const existingSpareSkus = new Set<string>();
  if (SKIP_EXISTING) {
    for (const a of await prisma.asset.findMany({ where: { tenantId: tid, vesselCode: DST, deletedAt: null }, select: { id: true, assetCode: true } }))
      existingAssetByCode.set(a.assetCode, a.id);
    for (const p of await prisma.maintenancePlan.findMany({ where: { tenantId: tid, vesselCode: DST, deletedAt: null }, select: { taskCode: true } }))
      existingPlanCodes.add(p.taskCode);
    for (const s of await prisma.spare.findMany({ where: { tenantId: tid, vesselCode: DST, deletedAt: null }, select: { sku: true } }))
      existingSpareSkus.add(s.sku);
    console.log(`SKIP_EXISTING: destino ya tiene ${existingAssetByCode.size} activos · ${existingPlanCodes.size} planes · ${existingSpareSkus.size} repuestos (no se tocarán).`);
  }

  let nAssets = 0, skipAssets = 0;
  for (const a of srcAssets) {
    const newCode = renameCode(a.assetCode);
    if (seenAssetCodes.has(newCode)) throw new Error(`Colisión de assetCode destino: ${newCode}`);
    seenAssetCodes.add(newCode);
    if (SKIP_EXISTING && existingAssetByCode.has(newCode)) {
      assetMap.set(a.id, existingAssetByCode.get(newCode)!); // mapear al existente para FKs de lo nuevo
      skipAssets++;
      console.log(`↷ Asset ${a.assetCode} → ${newCode} ya existe en ${DST}; se preserva`);
      continue;
    }
    const data = {
      sfiCode: a.sfiCode, name: a.name, criticality: a.criticality, status: a.status,
      manufacturer: a.manufacturer, model: a.model, serialNumber: a.serialNumber,
      installationDate: a.installationDate, lastOverhaulDate: a.lastOverhaulDate,
      replacementDate: a.replacementDate, trackDailyReport: a.trackDailyReport,
      criticalityRationale: a.criticalityRationale, isSafetyCritical: a.isSafetyCritical,
      equipmentClassId: a.equipmentClassId,
      // parentAssetId se resuelve en una 2ª pasada (los assets de M01 no usan jerarquía).
    };
    nAssets++;
    if (!DRY) {
      const created = await prisma.asset.upsert({
        where: { tenantId_vesselCode_assetCode: { tenantId: tid, vesselCode: DST, assetCode: newCode } },
        update: { ...data, updatedByUserId: uid },
        create: { tenantId: tid, vesselCode: DST, assetCode: newCode, ...data, createdByUserId: uid, updatedByUserId: uid },
        select: { id: true },
      });
      assetMap.set(a.id, created.id);
    } else {
      assetMap.set(a.id, `(dry:${newCode})`);
    }
    console.log(`${DRY ? "DRY " : "✓ "}Asset ${a.assetCode} → ${newCode}`);
  }

  // 2ª pasada: jerarquía parentAssetId (remapeada). Sólo si el origen la usa.
  if (!DRY) {
    for (const a of srcAssets) {
      if (!a.parentAssetId) continue;
      const newParent = assetMap.get(a.parentAssetId);
      if (!newParent) { console.warn(`⚠ parent de ${a.assetCode} fuera del set; se deja sin padre`); continue; }
      await prisma.asset.update({ where: { id: assetMap.get(a.id) }, data: { parentAssetId: newParent } });
    }
  }

  // ── 2) MAINTENANCE PLANS ─────────────────────────────────────────────────────
  const srcPlans = await prisma.maintenancePlan.findMany({
    where: { tenantId: tid, vesselCode: SRC, deletedAt: null },
    orderBy: { taskCode: "asc" },
  });
  const seenTaskCodes = new Set<string>();
  let nPlans = 0, skipped = 0;
  for (const p of srcPlans) {
    const dstAssetId = assetMap.get(p.assetId);
    if (!dstAssetId) { console.warn(`⚠ Plan ${p.taskCode}: asset ${p.assetId} no clonado; se omite`); skipped++; continue; }
    const newCode = renameCode(p.taskCode);
    if (seenTaskCodes.has(newCode)) throw new Error(`Colisión de taskCode destino: ${newCode}`);
    seenTaskCodes.add(newCode);
    if (SKIP_EXISTING && existingPlanCodes.has(newCode)) {
      skipped++;
      console.log(`↷ Plan ${p.taskCode} → ${newCode} ya existe en ${DST}; se preserva`);
      continue;
    }
    const data = {
      title: p.title, description: p.description, triggerType: p.triggerType,
      frequencyHours: p.frequencyHours, frequencyMonths: p.frequencyMonths, estimatedHours: p.estimatedHours,
      responsible: p.responsible, department: p.department, providerId: p.providerId,
      acceptanceCriteria: p.acceptanceCriteria, loto: p.loto,
      sfiGroupNumber: p.sfiGroupNumber, sfiSubgroupCode: p.sfiSubgroupCode,
      riskLevel: p.riskLevel, riskProbability: p.riskProbability, riskConsequence: p.riskConsequence,
      riskAnalysisResult: p.riskAnalysisResult, taskType: p.taskType,
      consequenceCategory: p.consequenceCategory, consequenceRationale: p.consequenceRationale,
      taskMasterId: p.taskMasterId, samplingKind: p.samplingKind, samplingFluidType: p.samplingFluidType,
      triggerResultMode: p.triggerResultMode, checklistTemplate: p.checklistTemplate,
      windowMode: p.windowMode, windowLeadDays: p.windowLeadDays,
      windowLeadHours: p.windowLeadHours, windowLeadPercent: p.windowLeadPercent,
      // timing reseteado:
      status: "ACTIVE", executionStatus: "FUTURE",
      lastExecutionDate: null, nextDueDate: null, lastExecutionHours: null, nextDueHours: null,
      windowOpenDate: null, windowOpenHours: null,
    };
    nPlans++;
    if (!DRY) {
      await prisma.maintenancePlan.upsert({
        where: { tenantId_vesselCode_taskCode: { tenantId: tid, vesselCode: DST, taskCode: newCode } },
        update: { ...data, assetId: dstAssetId, updatedByUserId: uid },
        create: { tenantId: tid, vesselCode: DST, taskCode: newCode, assetId: dstAssetId, ...data, createdByUserId: uid, updatedByUserId: uid },
      });
    }
  }

  // ── 3) SPARES ────────────────────────────────────────────────────────────────
  const srcSpares = await prisma.spare.findMany({
    where: { tenantId: tid, vesselCode: SRC, deletedAt: null },
    orderBy: { sku: "asc" },
  });
  let nSpares = 0, skipSpares = 0;
  for (const s of srcSpares) {
    if (SKIP_EXISTING && existingSpareSkus.has(s.sku)) { skipSpares++; continue; }
    const linked = s.linkedAssetId ? assetMap.get(s.linkedAssetId) ?? null : null;
    const data = {
      name: s.name, category: s.category, criticality: s.criticality,
      manufacturer: s.manufacturer, model: s.model, unit: s.unit,
      currentStock: 0, minStock: s.minStock, reorderPoint: s.reorderPoint, targetStock: s.targetStock,
      status: s.status, location: s.location,
      internalPartNumber: s.internalPartNumber, manufacturerPartNumber: s.manufacturerPartNumber,
      longDescription: s.longDescription, sfiCode: s.sfiCode, leadTimeDays: s.leadTimeDays,
      isEquivalent: s.isEquivalent, preferredSupplierId: s.preferredSupplierId,
      defaultLocationId: null, // ubicaciones de stock son por buque
      linkedAssetId: typeof linked === "string" && !linked.startsWith("(dry") ? linked : null,
    };
    nSpares++;
    if (!DRY) {
      await prisma.spare.upsert({
        where: { tenantId_vesselCode_sku: { tenantId: tid, vesselCode: DST, sku: s.sku } },
        update: { ...data, updatedByUserId: uid },
        create: { tenantId: tid, vesselCode: DST, sku: s.sku, ...data, createdByUserId: uid, updatedByUserId: uid },
      });
    }
  }

  console.log(
    `\n${DRY ? "DRY-RUN (no se escribió nada). " : "✅ Completado. "}` +
      `${SRC} → ${DST}: ${nAssets} activos${skipAssets ? ` (+${skipAssets} preservados)` : ""}` +
      ` · ${nPlans} planes${skipped ? ` (${skipped} ${SKIP_EXISTING ? "preservados" : "omitidos"})` : ""}` +
      ` · ${nSpares} repuestos${skipSpares ? ` (+${skipSpares} preservados)` : ""}.`,
  );
}

main()
  .catch((e) => { console.error("❌ Error:", e?.message ?? e); process.exit(1); })
  .finally(() => prisma.$disconnect());
