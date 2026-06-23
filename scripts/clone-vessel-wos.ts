/**
 * Clona las SS (WorkOrders) + sus notas de avance de un buque a otro (mismo tenant),
 * y replica el timing de los planes desde ese historial. Complemento de
 * scripts/clone-vessel-mp.ts (que clona Assets+Planes+Spares). Hecho M01 → M02,
 * tenant mercurio, junio 2026.
 *
 * Qué hace:
 *   1) Borra los clones previos en DST (idempotencia) — ver criterio abajo — y reinserta.
 *   2) Clona cada WorkOrder de SRC remapeando:
 *        vesselCode → DST ;  assetId → asset DST (por assetCode renombrado) ;
 *        maintenancePlanId → plan DST (por taskCode renombrado) ;
 *        workOrderCode → renumerado (ver abajo). Resto de campos verbatim
 *        (fechas, horas, status, usuarios, proveedores: todo es tenant-scoped).
 *   3) Clona las WorkOrderProgressNote de cada WO (mismas fileUrl: storage compartido).
 *   4) Copia el timing de cada plan de SRC a su par en DST
 *        (lastExecution / nextDue / executionStatus / window / status) — deriva del mismo
 *        historial que se está clonando, equivale a recalcular nextDue desde las SS.
 *
 * Exclusión del amarre:
 *   El asset SRC `${SRC}-7-SD-001` (Sistema de Amarre) NO se clona porque DST ya opera
 *   su propio amarre con SS reales. Se omiten sus WOs y NO se toca el timing de sus planes.
 *   EXCLUDE_ASSET_CODE override (código en el espacio SRC) para ajustar.
 *
 * Renumeración de códigos (evita colisión con las SS reales de DST):
 *   SS-<SRC>-<YY>-<seq>  →  SS-<DST>-<YY>-<seq'>  con seq' continuando el máximo real
 *   de DST para ese año. Determinista (el baseline son las SS preservadas de DST).
 *
 * Idempotencia (criterio de "clon previo"):
 *   Todas las SS reales de DST están sobre el amarre preservado. Por eso un clon previo =
 *   WO de DST cuyo asset NO es el amarre. Se borran (hard delete; las notas caen por
 *   cascade) y se reinsertan. ⚠ Si en el futuro DST genera SS propias fuera del amarre,
 *   revisar este criterio antes de re-correr (borraría esas SS reales).
 *
 * Uso (en el VPS):
 *   DATABASE_URL=<url> npx tsx scripts/clone-vessel-wos.ts
 *   DRY=1 ...   → no escribe, sólo reporta
 *   SRC_VESSEL=M01 DST_VESSEL=M02 TENANT_SLUG=mercurio  (overridables)
 *   NOTES=0     → no clonar las notas de avance
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const SRC = process.env.SRC_VESSEL ?? "M01";
const DST = process.env.DST_VESSEL ?? "M02";
const DRY = process.env.DRY === "1";
const CLONE_NOTES = process.env.NOTES !== "0";
const EXCLUDE_ASSET_CODE = process.env.EXCLUDE_ASSET_CODE ?? `${SRC}-7-SD-001`;

/** Reemplaza el prefijo de buque del código. SRC-... → DST-... ; SRC... → DST... */
function renameCode(code: string): string {
  if (code.startsWith(`${SRC}-`)) return `${DST}-${code.slice(SRC.length + 1)}`;
  if (code.startsWith(SRC)) return `${DST}${code.slice(SRC.length)}`;
  return `${DST}-${code}`;
}

/** SS-<vessel>-<YY>-<seq> → { yy, seq }. Devuelve null si no matchea. */
function parseWoCode(code: string): { yy: string; seq: number } | null {
  const m = code.match(/^SS-[^-]+-(\d+)-(\d+)$/);
  return m ? { yy: m[1], seq: parseInt(m[2], 10) } : null;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado en esta base.`);
  const tid: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: tid, role: "TENANT_ADMIN" }, select: { userId: true },
  });
  const uid: string | undefined = member?.userId;
  if (!uid) throw new Error(`No hay usuario TENANT_ADMIN en tenant '${SLUG}'.`);

  for (const code of [SRC, DST]) {
    const v = await prisma.vessel.findUnique({
      where: { tenantId_code: { tenantId: tid, code } }, select: { name: true },
    });
    if (!v) throw new Error(`Buque '${code}' no existe en tenant '${SLUG}'.`);
    console.log(`  buque ${code} = ${v.name}`);
  }

  // ── Mapas de remapeo (por código renombrado) ────────────────────────────────
  const srcAssets = await prisma.asset.findMany({
    where: { tenantId: tid, vesselCode: SRC, deletedAt: null }, select: { id: true, assetCode: true },
  });
  const dstAssets = await prisma.asset.findMany({
    where: { tenantId: tid, vesselCode: DST, deletedAt: null }, select: { id: true, assetCode: true },
  });
  const dstAssetIdByCode = new Map<string, string>(dstAssets.map((a: any) => [a.assetCode, a.id]));
  const assetMap = new Map<string, string>(); // srcAssetId → dstAssetId
  let excludeSrcAssetId: string | null = null;
  for (const a of srcAssets) {
    if (a.assetCode === EXCLUDE_ASSET_CODE) { excludeSrcAssetId = a.id; continue; }
    const dstId = dstAssetIdByCode.get(renameCode(a.assetCode));
    if (dstId) assetMap.set(a.id, dstId);
  }
  if (!excludeSrcAssetId) console.warn(`⚠ No se encontró el asset a excluir '${EXCLUDE_ASSET_CODE}' en ${SRC}.`);

  const srcPlans = await prisma.maintenancePlan.findMany({
    where: { tenantId: tid, vesselCode: SRC, deletedAt: null },
    select: {
      id: true, taskCode: true, assetId: true,
      lastExecutionDate: true, lastExecutionHours: true, nextDueDate: true, nextDueHours: true,
      executionStatus: true, status: true, windowOpenDate: true, windowOpenHours: true,
    },
  });
  const dstPlans = await prisma.maintenancePlan.findMany({
    where: { tenantId: tid, vesselCode: DST, deletedAt: null }, select: { id: true, taskCode: true },
  });
  const dstPlanIdByCode = new Map<string, string>(dstPlans.map((p: any) => [p.taskCode, p.id]));
  const planMap = new Map<string, string>(); // srcPlanId → dstPlanId
  for (const p of srcPlans) {
    const dstId = dstPlanIdByCode.get(renameCode(p.taskCode));
    if (dstId) planMap.set(p.id, dstId);
  }

  // ── Idempotencia: borrar clones previos en DST (WOs fuera del amarre) ─────────
  const mooringDstId = excludeSrcAssetId ? dstAssetIdByCode.get(renameCode(EXCLUDE_ASSET_CODE)) ?? null : null;
  const priorClones = await prisma.workOrder.findMany({
    where: { tenantId: tid, vesselCode: DST, ...(mooringDstId ? { assetId: { not: mooringDstId } } : {}) },
    select: { id: true },
  });
  if (priorClones.length) {
    console.log(`${DRY ? "DRY " : ""}↺ ${priorClones.length} SS clonadas previas en ${DST} → se borran y reinsertan.`);
    if (!DRY) {
      await prisma.workOrder.deleteMany({ where: { id: { in: priorClones.map((w: any) => w.id) } } });
    }
  }

  // ── Baseline de secuencias por año (SS reales preservadas de DST) ─────────────
  const dstReal = await prisma.workOrder.findMany({
    where: { tenantId: tid, vesselCode: DST, ...(mooringDstId ? { assetId: mooringDstId } : {}) },
    select: { workOrderCode: true },
  });
  const baselineMax = new Map<string, number>(); // yy → max seq real
  for (const w of dstReal) {
    const pc = parseWoCode(w.workOrderCode);
    if (pc) baselineMax.set(pc.yy, Math.max(baselineMax.get(pc.yy) ?? 0, pc.seq));
  }
  const counter = new Map<string, number>(); // yy → cuántas clonadas van este run

  // ── Clonar WorkOrders (orden estable por código → numeración determinista) ────
  const srcWos = await prisma.workOrder.findMany({
    where: { tenantId: tid, vesselCode: SRC, deletedAt: null, ...(excludeSrcAssetId ? { assetId: { not: excludeSrcAssetId } } : {}) },
    orderBy: { workOrderCode: "asc" },
  });

  let nWos = 0, skippedAsset = 0, nNotes = 0;
  for (const w of srcWos) {
    const dstAssetId = assetMap.get(w.assetId);
    if (!dstAssetId) { console.warn(`⚠ SS ${w.workOrderCode}: asset no clonado; se omite`); skippedAsset++; continue; }
    const dstPlanId = w.maintenancePlanId ? planMap.get(w.maintenancePlanId) ?? null : null;

    const pc = parseWoCode(w.workOrderCode);
    if (!pc) { console.warn(`⚠ SS ${w.workOrderCode}: código no parseable; se omite`); continue; }
    const base = baselineMax.get(pc.yy) ?? 0;
    const n = (counter.get(pc.yy) ?? 0) + 1; counter.set(pc.yy, n);
    const newCode = `SS-${DST}-${pc.yy}-${String(base + n).padStart(4, "0")}`;

    const data: any = {
      tenantId: tid, vesselCode: DST, assetId: dstAssetId, maintenancePlanId: dstPlanId,
      workOrderCode: newCode,
      type: w.type, status: w.status, priority: w.priority, criticality: w.criticality,
      openDate: w.openDate, startDate: w.startDate, dueDate: w.dueDate, completedDate: w.completedDate,
      holdReason: w.holdReason, cancelReason: w.cancelReason, closeNotes: w.closeNotes,
      independentVerifier: w.independentVerifier, testResult: w.testResult,
      title: w.title, description: w.description, assignedToUserId: w.assignedToUserId,
      estimatedHours: w.estimatedHours, actualHours: w.actualHours, taskMasterId: w.taskMasterId,
      acceptanceCriteria: w.acceptanceCriteria, loto: w.loto, riskLevel: w.riskLevel,
      riskAnalysisResult: w.riskAnalysisResult, checklistDocUrl: w.checklistDocUrl,
      consequenceCategory: w.consequenceCategory, consequenceRationale: w.consequenceRationale,
      department: w.department, providerId: w.providerId, location: w.location,
      communicationMethod: w.communicationMethod, distribution: w.distribution,
      woResult: w.woResult, executedByName: w.executedByName, observations: w.observations,
      supportingDocUrl: w.supportingDocUrl, runningHoursAtExecution: w.runningHoursAtExecution,
      createdAt: w.createdAt, createdByUserId: w.createdByUserId, updatedByUserId: w.updatedByUserId,
      reopenCount: w.reopenCount, lastReopenAt: w.lastReopenAt, lastReopenReason: w.lastReopenReason,
      lastReopenByUserId: w.lastReopenByUserId,
      aprobadoByName: w.aprobadoByName, aprobadoByUserId: w.aprobadoByUserId, aprobadoAt: w.aprobadoAt,
      autorizadoByName: w.autorizadoByName, autorizadoByUserId: w.autorizadoByUserId, autorizadoAt: w.autorizadoAt,
      rechazadoByName: w.rechazadoByName, rechazadoAt: w.rechazadoAt, rechazoReason: w.rechazoReason,
    };
    nWos++;
    if (!DRY) {
      const createdWo = await prisma.workOrder.create({ data, select: { id: true } });
      if (CLONE_NOTES) {
        const notes = await prisma.workOrderProgressNote.findMany({
          where: { workOrderId: w.id, deletedAt: null }, orderBy: { createdAt: "asc" },
        });
        for (const nt of notes) {
          await prisma.workOrderProgressNote.create({
            data: {
              tenantId: tid, vesselCode: DST, workOrderId: createdWo.id, kind: nt.kind,
              text: nt.text, fileUrl: nt.fileUrl, mimeType: nt.mimeType, sizeBytes: nt.sizeBytes,
              processedText: nt.processedText, processed: nt.processed, processError: nt.processError,
              createdAt: nt.createdAt, createdByUserId: nt.createdByUserId,
            },
          });
          nNotes++;
        }
      }
    } else if (CLONE_NOTES) {
      nNotes += await prisma.workOrderProgressNote.count({ where: { workOrderId: w.id, deletedAt: null } });
    }
  }

  // ── Copiar timing de planes SRC → DST (no toca los planes del amarre) ─────────
  let nTiming = 0;
  for (const p of srcPlans) {
    if (p.assetId === excludeSrcAssetId) continue;            // amarre: preservar timing de DST
    const dstPlanId = planMap.get(p.id);
    if (!dstPlanId) continue;
    if (!DRY) {
      await prisma.maintenancePlan.update({
        where: { id: dstPlanId },
        data: {
          lastExecutionDate: p.lastExecutionDate, lastExecutionHours: p.lastExecutionHours,
          nextDueDate: p.nextDueDate, nextDueHours: p.nextDueHours,
          executionStatus: p.executionStatus, status: p.status,
          windowOpenDate: p.windowOpenDate, windowOpenHours: p.windowOpenHours,
          updatedByUserId: uid,
        },
      });
    }
    nTiming++;
  }

  console.log(
    `\n${DRY ? "DRY-RUN (no se escribió nada). " : "✅ Completado. "}` +
      `${SRC} → ${DST}: ${nWos} SS${skippedAsset ? ` (${skippedAsset} omitidas por asset)` : ""}` +
      ` · ${nNotes} notas${CLONE_NOTES ? "" : " (omitidas)"} · ${nTiming} planes con timing replicado.`,
  );
}

main()
  .catch((e) => { console.error("❌ Error:", e?.message ?? e); process.exit(1); })
  .finally(() => prisma.$disconnect());
