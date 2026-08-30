/**
 * Copia un MaintenancePlan de un buque a otro (mismo tenant), remapeando el activo.
 *
 *   - El taskCode destino se obtiene reemplazando el prefijo de buque (DCH-8-001 → M01-8-001).
 *   - El activo destino se resuelve por el mismo assetCode con el prefijo del buque destino
 *     (DCH-AJUSTES → M01-AJUSTES). Si no existe, aborta: no inventa activos.
 *   - Copia TODOS los campos de contenido: titulo, descripcion, criterios de aceptacion,
 *     LOTO, frecuencia, riesgo, SFI, responsable, departamento, sampling, etc.
 *   - RESET_TIMING=1 borra ultima ejecucion / proximo vencimiento (util al copiar entre
 *     buques con historial propio). Por defecto copia el timing tal cual.
 *   - Idempotente: upsert por (tenant, buque, taskCode). DRY=1 para previsualizar.
 *
 * Uso:
 *   DRY=1 SRC_CODE=DCH-8-001 DST_VESSEL=M01 npx tsx scripts/copy-plan-to-vessel.ts
 *   SRC_CODE=DCH-8-001 DST_VESSEL=M01 npx tsx scripts/copy-plan-to-vessel.ts
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const SRC_CODE = process.env.SRC_CODE ?? "DCH-8-001";
const DST = process.env.DST_VESSEL ?? "M01";
const DRY = process.env.DRY === "1";
const RESET_TIMING = process.env.RESET_TIMING === "1";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tid: string = tenant.id;
  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: tid, role: "TENANT_ADMIN" }, select: { userId: true },
  });
  const uid: string | undefined = member?.userId;
  if (!uid) throw new Error(`No hay TENANT_ADMIN en '${SLUG}'.`);

  const src = await prisma.maintenancePlan.findFirst({
    where: { tenantId: tid, taskCode: SRC_CODE, deletedAt: null },
  });
  if (!src) throw new Error(`Plan origen '${SRC_CODE}' no existe (o esta borrado).`);

  const SRCV: string = src.vesselCode;
  if (SRCV === DST) throw new Error(`El plan '${SRC_CODE}' ya pertenece a ${DST}.`);

  const srcAsset = await prisma.asset.findUnique({
    where: { id: src.assetId }, select: { assetCode: true, name: true },
  });
  if (!srcAsset) throw new Error(`El plan '${SRC_CODE}' apunta a un activo inexistente.`);

  // DCH-AJUSTES → M01-AJUSTES. DST_ASSET permite indicarlo a mano cuando los
  // buques no comparten la convencion de codigo (ej. M01 usa 8-CD-001 donde DCH usa AJUSTES).
  const dstAssetCode = process.env.DST_ASSET ?? (srcAsset.assetCode.startsWith(`${SRCV}-`)
    ? `${DST}-${srcAsset.assetCode.slice(SRCV.length + 1)}`
    : `${DST}-${srcAsset.assetCode}`);
  const dstAsset = await prisma.asset.findUnique({
    where: { tenantId_vesselCode_assetCode: { tenantId: tid, vesselCode: DST, assetCode: dstAssetCode } },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!dstAsset || dstAsset.deletedAt)
    throw new Error(`El activo '${dstAssetCode}' no existe en ${DST}. Hay que darlo de alta antes de copiar el plan.`);

  const dstCode = SRC_CODE.startsWith(`${SRCV}-`) ? `${DST}-${SRC_CODE.slice(SRCV.length + 1)}` : `${DST}-${SRC_CODE}`;
  const existing = await prisma.maintenancePlan.findUnique({
    where: { tenantId_vesselCode_taskCode: { tenantId: tid, vesselCode: DST, taskCode: dstCode } },
    select: { id: true, deletedAt: true },
  });

  const data: Record<string, unknown> = {
    title: src.title, description: src.description,
    triggerType: src.triggerType, frequencyHours: src.frequencyHours, frequencyMonths: src.frequencyMonths,
    estimatedHours: src.estimatedHours, responsible: src.responsible,
    department: src.department, providerId: src.providerId,
    acceptanceCriteria: src.acceptanceCriteria, loto: src.loto,
    sfiGroupNumber: src.sfiGroupNumber, sfiSubgroupCode: src.sfiSubgroupCode,
    riskLevel: src.riskLevel, riskProbability: src.riskProbability, riskConsequence: src.riskConsequence,
    riskAnalysisResult: src.riskAnalysisResult, taskType: src.taskType,
    consequenceCategory: src.consequenceCategory, consequenceRationale: src.consequenceRationale,
    taskMasterId: src.taskMasterId, samplingKind: src.samplingKind, samplingFluidType: src.samplingFluidType,
    triggerResultMode: src.triggerResultMode, checklistTemplate: src.checklistTemplate,
    windowMode: src.windowMode, windowLeadDays: src.windowLeadDays,
    windowLeadHours: src.windowLeadHours, windowLeadPercent: src.windowLeadPercent,
    status: src.status,
    deletedAt: null, deletedByUserId: null, // si existia borrado, se reactiva
  };
  if (RESET_TIMING) {
    Object.assign(data, {
      lastExecutionDate: null, nextDueDate: null, lastExecutionHours: null, nextDueHours: null,
      windowOpenDate: null, windowOpenHours: null, executionStatus: "FUTURE",
    });
  } else {
    Object.assign(data, {
      lastExecutionDate: src.lastExecutionDate, nextDueDate: src.nextDueDate,
      lastExecutionHours: src.lastExecutionHours, nextDueHours: src.nextDueHours,
      windowOpenDate: src.windowOpenDate, windowOpenHours: src.windowOpenHours,
      executionStatus: src.executionStatus,
    });
  }

  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "—");
  console.log(`${SRC_CODE}  →  ${dstCode}`);
  console.log(`  activo:   ${srcAsset.assetCode} (${srcAsset.name})`);
  console.log(`         →  ${dstAssetCode} (${dstAsset.name})`);
  console.log(`  titulo:   ${src.title}`);
  console.log(`  frec:     ${src.triggerType} fh=${src.frequencyHours} fm=${src.frequencyMonths} · est ${src.estimatedHours} h · ${src.responsible}`);
  console.log(`  riesgo:   ${src.riskLevel}/${src.riskProbability}/${src.riskConsequence} · consecuencia ${src.consequenceCategory}`);
  console.log(`  textos:   descripcion ${(src.description ?? "").length} car · criterios ${(src.acceptanceCriteria ?? "").length} car · LOTO ${(src.loto ?? "").length} car`);
  console.log(`  timing:   ${RESET_TIMING ? "RESETEADO" : `ult ${d(src.lastExecutionDate)} / prox ${d(src.nextDueDate)} (copiado)`}`);
  console.log(`  destino:  ${existing ? (existing.deletedAt ? "ya existe BORRADO → se reactiva y pisa" : "ya existe → se actualiza") : "no existe → se crea"}`);

  if (!DRY) {
    await prisma.maintenancePlan.upsert({
      where: { tenantId_vesselCode_taskCode: { tenantId: tid, vesselCode: DST, taskCode: dstCode } },
      update: { ...data, assetId: dstAsset.id, updatedByUserId: uid },
      create: { tenantId: tid, vesselCode: DST, taskCode: dstCode, assetId: dstAsset.id, ...data, createdByUserId: uid, updatedByUserId: uid },
    });
  }
  console.log(`\n${DRY ? "DRY-RUN (no se escribio nada)." : "✅ Plan copiado."}`);
}

main().catch((e) => { console.error("❌", e?.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
