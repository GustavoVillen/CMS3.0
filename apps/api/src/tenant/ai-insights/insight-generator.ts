/**
 * Deterministic insight generator.
 * Evaluates threshold rules against current DB state and upserts AiInsight records.
 * Per docs/10: "For MVP, prefer deterministic threshold generation first."
 *
 * Agrupación: cuando varios items del mismo tipo/vessel caerían como insights
 * separados (ej. 10 certificados vencidos del mismo buque), emitimos UNO solo
 * agrupado con la lista resumida en lugar de N tarjetas idénticas. Threshold
 * controlado por GROUP_THRESHOLD.
 *
 * Cleanup: al final del run, los insights OPEN cuyo `insightCode` no aparece
 * entre los drafts de su tipo se marcan como RESOLVED (el problema ya no aplica
 * o fue absorbido por un grupo). Sólo aplica para tipos que SÍ generaron drafts
 * en este run, así un fallo parcial no resuelve nada por error.
 */

import { getPrismaClient } from "../../platform/data/prisma-client";

type PrismaClient = NonNullable<ReturnType<typeof getPrismaClient>>;

/** A partir de N items del mismo (tipo + vessel) emitimos un único insight agrupado. */
const GROUP_THRESHOLD = 4;

/** Cuántos códigos listar dentro del summary del grupo antes de "y N más". */
const GROUP_LIST_LIMIT = 10;

interface InsightDraft {
  insightCode: string;
  insightType: string;
  priority: string;
  targetType: string;
  targetId: string | null;
  vesselCode: string | null;
  title: string;
  summary: string;
  recommendation: string;
}

const NO_VESSEL_KEY = "__NO_VESSEL__";

/**
 * Emite drafts con agrupación automática por vessel.
 *
 * Cada `hit` tiene su vesselCode + un display string corto que va en la lista
 * resumida del grupo si supera el threshold. Si el grupo (vessel) tiene
 * ≥ GROUP_THRESHOLD hits emitimos UN solo draft agrupado con la lista; si no,
 * emitimos los individuales que arme `individualDraft(hit)`.
 */
function emitGroupedByVessel<T>(
  drafts: InsightDraft[],
  hits: Array<{ vesselCode: string | null; display: string; item: T }>,
  opts: {
    insightType: string;
    priority: string;
    /** Texto para el title del grupo. Recibe count + " en VESSEL" (o "" si flota). */
    groupTitle: (count: number, vesselSuffix: string) => string;
    /** Texto para el summary del grupo. Recibe count + " en VESSEL" + lista. */
    groupSummary: (count: number, vesselSuffix: string, list: string) => string;
    groupRecommendation: string;
    /** Sufijo único para el insightCode del grupo, ej. "STOCK-MIN-GROUP". */
    groupCodePrefix: string;
    /** Cómo construir un draft individual a partir del hit. */
    individualDraft: (vesselCode: string | null, item: T) => InsightDraft;
  },
) {
  const byVessel = new Map<string, typeof hits>();
  for (const h of hits) {
    const k = h.vesselCode ?? NO_VESSEL_KEY;
    const arr = byVessel.get(k) ?? [];
    arr.push(h);
    byVessel.set(k, arr);
  }
  for (const [key, group] of byVessel.entries()) {
    const vesselCode = key === NO_VESSEL_KEY ? null : key;
    const suffix = vesselCode ? ` en ${vesselCode}` : "";
    if (group.length >= GROUP_THRESHOLD) {
      const head = group.slice(0, GROUP_LIST_LIMIT).map(h => h.display).join(", ");
      const rest = group.length - GROUP_LIST_LIMIT;
      const list = rest > 0 ? `${head} y ${rest} más` : head;
      drafts.push({
        insightCode:    `${opts.groupCodePrefix}-${key}`,
        insightType:    opts.insightType,
        priority:       opts.priority,
        targetType:     vesselCode ? "VESSEL" : "FLEET",
        targetId:       vesselCode,
        vesselCode,
        title:          opts.groupTitle(group.length, suffix),
        summary:        opts.groupSummary(group.length, suffix, list),
        recommendation: opts.groupRecommendation,
      });
    } else {
      for (const h of group) drafts.push(opts.individualDraft(vesselCode, h.item));
    }
  }
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function generateInsightsForTenant(tenantId: string): Promise<number> {
  const prisma = getPrismaClient();
  if (!prisma) return 0;

  const drafts: InsightDraft[] = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  await collectStockInsights(prisma, tenantId, drafts);
  await collectCertificateInsights(prisma, tenantId, drafts, today);
  await collectWorkOrderInsights(prisma, tenantId, drafts, today);
  await collectCapaInsights(prisma, tenantId, drafts, today);
  await collectBacklogRiskInsights(prisma, tenantId, drafts, today);
  await collectRepeatedFailureInsights(prisma, tenantId, drafts, now);
  await collectRepeatedDeferralInsights(prisma, tenantId, drafts, now);
  await collectInspectionFailureInsights(prisma, tenantId, drafts, now);
  await collectFluidAnalysisInsights(prisma, tenantId, drafts, now);
  await collectFuelConsumptionInsights(prisma, tenantId, drafts, now);

  let upserted = 0;
  for (const draft of drafts) {
    try {
      await prisma.aiInsight.upsert({
        where: {
          tenantId_insightType_targetType_targetId: {
            tenantId,
            insightType: draft.insightType as any,
            targetType:  draft.targetType as any,
            targetId:    draft.targetId ?? "",
          },
        },
        create: {
          tenantId,
          insightCode:     draft.insightCode,
          insightType:     draft.insightType as any,
          status:          "OPEN",
          priority:        draft.priority as any,
          targetType:      draft.targetType as any,
          targetId:        draft.targetId,
          vesselCode:      draft.vesselCode,
          title:           draft.title,
          summary:         draft.summary,
          recommendation:  draft.recommendation,
          detectedAt:      now,
          createdByUserId: "system",
          updatedByUserId: "system",
        },
        update: {
          priority:        draft.priority as any,
          title:           draft.title,
          summary:         draft.summary,
          recommendation:  draft.recommendation,
          detectedAt:      now,
          updatedByUserId: "system",
          status:          "OPEN",
          resolvedAt:      null,
          dismissedAt:     null,
        },
      });
      upserted++;
    } catch {
      // skip individual failures to keep batch running
    }
  }

  // ── Cleanup: auto-resolver OPEN insights que ya no aparecen entre los drafts ──
  // Importante: SOLO resolvemos un insightType si HUBO al menos un draft de ese
  // tipo en este run. Así, si una de las funciones collect*() falla y no genera
  // drafts, no marcamos masivamente como resuelto algo que sigue siendo válido.
  //
  // Esto cubre dos casos:
  //   1. El problema desapareció (el cert se renovó, el stock se repuso).
  //   2. N items individuales fueron absorbidos por un nuevo insight agrupado.
  try {
    const activeCodesByType = new Map<string, Set<string>>();
    for (const d of drafts) {
      const set = activeCodesByType.get(d.insightType) ?? new Set<string>();
      set.add(d.insightCode);
      activeCodesByType.set(d.insightType, set);
    }
    for (const [insightType, activeCodes] of activeCodesByType.entries()) {
      const existing = await prisma.aiInsight.findMany({
        where: { tenantId, insightType: insightType as any, status: "OPEN" },
        select: { id: true, insightCode: true },
      });
      const staleIds = existing
        .filter(e => !activeCodes.has(e.insightCode))
        .map(e => e.id);
      if (staleIds.length > 0) {
        await prisma.aiInsight.updateMany({
          where: { id: { in: staleIds } },
          data: { status: "RESOLVED", resolvedAt: now, updatedByUserId: "system" },
        });
      }
    }
  } catch {
    // cleanup best-effort: no romper el run si falla
  }

  return upserted;
}

// ---------------------------------------------------------------------------
// Threshold rules
// ---------------------------------------------------------------------------

async function collectStockInsights(prisma: PrismaClient, tenantId: string, drafts: InsightDraft[]) {
  const spares = await prisma.spare.findMany({
    where: { tenantId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, sku: true, name: true, vesselCode: true, currentStock: true, minStock: true, reorderPoint: true },
  });

  type Spare = typeof spares[number];
  const belowMin: Array<{ vesselCode: string | null; display: string; item: Spare }> = [];
  const belowReorder: Array<{ vesselCode: string | null; display: string; item: Spare }> = [];

  for (const spare of spares) {
    if (spare.currentStock < spare.minStock) {
      belowMin.push({
        vesselCode: spare.vesselCode,
        display: `${spare.sku} (${spare.currentStock}/${spare.minStock})`,
        item: spare,
      });
    } else if (spare.currentStock <= spare.reorderPoint) {
      belowReorder.push({
        vesselCode: spare.vesselCode,
        display: `${spare.sku} (${spare.currentStock}/${spare.reorderPoint})`,
        item: spare,
      });
    }
  }

  emitGroupedByVessel(drafts, belowMin, {
    insightType:    "stock_below_minimum",
    priority:       "HIGH",
    groupCodePrefix:"STOCK-MIN-GROUP",
    groupTitle:     (n, suf) => `${n} repuestos bajo mínimo${suf}`,
    groupSummary:   (n, suf, list) => `Hay ${n} repuestos por debajo del stock mínimo${suf}: ${list}.`,
    groupRecommendation: "Emitir órdenes de compra urgentes para reponer al nivel mínimo todos los repuestos listados.",
    individualDraft: (vesselCode, spare) => ({
      insightCode:    `STOCK-MIN-${spare.id}`,
      insightType:    "stock_below_minimum",
      priority:       "HIGH",
      targetType:     "SPARE",
      targetId:       spare.id,
      vesselCode,
      title:          `Stock bajo mínimo: ${spare.name ?? spare.sku}`,
      summary:        `El repuesto ${spare.sku} tiene stock ${spare.currentStock} por debajo del mínimo ${spare.minStock}.`,
      recommendation: "Emitir orden de compra urgente para reponer el stock al nivel mínimo.",
    }),
  });

  emitGroupedByVessel(drafts, belowReorder, {
    insightType:    "stock_below_reorder_point",
    priority:       "MEDIUM",
    groupCodePrefix:"STOCK-REORDER-GROUP",
    groupTitle:     (n, suf) => `${n} repuestos en punto de reorden${suf}`,
    groupSummary:   (n, suf, list) => `Hay ${n} repuestos en o por debajo del punto de reorden${suf}: ${list}.`,
    groupRecommendation: "Planificar reposición de los repuestos listados antes de que toquen el stock mínimo.",
    individualDraft: (vesselCode, spare) => ({
      insightCode:    `STOCK-REORDER-${spare.id}`,
      insightType:    "stock_below_reorder_point",
      priority:       "MEDIUM",
      targetType:     "SPARE",
      targetId:       spare.id,
      vesselCode,
      title:          `Stock en punto de reorden: ${spare.name ?? spare.sku}`,
      summary:        `El repuesto ${spare.sku} alcanzó el punto de reorden (${spare.reorderPoint}). Stock actual: ${spare.currentStock}.`,
      recommendation: "Planificar reposición de stock antes de alcanzar el mínimo.",
    }),
  });
}

async function collectCertificateInsights(
  prisma: PrismaClient,
  tenantId: string,
  drafts: InsightDraft[],
  today: Date,
) {
  const certs = await prisma.certificate.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, certificateCode: true, name: true, vesselCode: true, expiryDate: true, status: true },
  });

  const in30Days = new Date(today);
  in30Days.setDate(in30Days.getDate() + 30);

  type CertItem = { id: string; code: string; name: string | null; expiry: Date };
  const expired:  Array<{ vesselCode: string | null; display: string; item: CertItem }> = [];
  const expiring: Array<{ vesselCode: string | null; display: string; item: CertItem }> = [];

  for (const cert of certs) {
    if (!cert.expiryDate) continue;
    const expiry = new Date(cert.expiryDate);
    const item: CertItem = { id: cert.id, code: cert.certificateCode, name: cert.name, expiry };
    const display = `${cert.certificateCode} (${expiry.toISOString().split("T")[0]})`;
    if (expiry < today) expired.push({ vesselCode: cert.vesselCode, display, item });
    else if (expiry <= in30Days) expiring.push({ vesselCode: cert.vesselCode, display, item });
  }

  emitGroupedByVessel(drafts, expired, {
    insightType:    "certificate_expired",
    priority:       "CRITICAL",
    groupCodePrefix:"CERT-EXP-GROUP",
    groupTitle:     (n, suf) => `${n} certificados vencidos${suf}`,
    groupSummary:   (n, suf, list) => `Hay ${n} certificados vencidos${suf}: ${list}.`,
    groupRecommendation: "Iniciar proceso de renovación inmediata de todos los certificados listados. Riesgo de incumplimiento regulatorio.",
    individualDraft: (vesselCode, item) => ({
      insightCode:    `CERT-EXP-${item.id}`,
      insightType:    "certificate_expired",
      priority:       "CRITICAL",
      targetType:     "CERTIFICATE",
      targetId:       item.id,
      vesselCode,
      title:          `Certificado vencido: ${item.name ?? item.code}`,
      summary:        `El certificado ${item.code} venció el ${item.expiry.toISOString().split("T")[0]}.`,
      recommendation: "Iniciar proceso de renovación inmediata. Riesgo de incumplimiento regulatorio.",
    }),
  });

  emitGroupedByVessel(drafts, expiring, {
    insightType:    "certificate_expiring",
    priority:       "HIGH",
    groupCodePrefix:"CERT-EXPIRING-GROUP",
    groupTitle:     (n, suf) => `${n} certificados próximos a vencer${suf}`,
    groupSummary:   (n, suf, list) => `Hay ${n} certificados que vencen en ≤30 días${suf}: ${list}.`,
    groupRecommendation: "Planificar la renovación de todos los certificados listados antes de su vencimiento.",
    individualDraft: (vesselCode, item) => ({
      insightCode:    `CERT-EXPIRING-${item.id}`,
      insightType:    "certificate_expiring",
      priority:       "HIGH",
      targetType:     "CERTIFICATE",
      targetId:       item.id,
      vesselCode,
      title:          `Certificado próximo a vencer: ${item.name ?? item.code}`,
      summary:        `El certificado ${item.code} vence el ${item.expiry.toISOString().split("T")[0]} (≤ 30 días).`,
      recommendation: "Iniciar proceso de renovación para evitar interrupción operacional.",
    }),
  });
}

async function collectWorkOrderInsights(
  prisma: PrismaClient,
  tenantId: string,
  drafts: InsightDraft[],
  today: Date,
) {
  const overdueThreshold = new Date(today);
  overdueThreshold.setDate(overdueThreshold.getDate() - 3);

  const overdueA = new Date(today);
  overdueA.setDate(overdueA.getDate() - 1);

  const workOrders = await prisma.workOrder.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status:    { in: ["PLANNED", "IN_PROGRESS"] },
      dueDate:   { lt: overdueThreshold },
    },
    select: { id: true, workOrderCode: true, vesselCode: true, dueDate: true, criticality: true },
  });

  type WO = typeof workOrders[number];
  const overdueA_list: Array<{ vesselCode: string | null; display: string; item: WO }> = [];
  const overdueRest:   Array<{ vesselCode: string | null; display: string; item: WO }> = [];

  for (const wo of workOrders) {
    const threshold = wo.criticality === "A" ? overdueA : overdueThreshold;
    if (!wo.dueDate || new Date(wo.dueDate) >= threshold) continue;
    const dueStr = new Date(wo.dueDate).toISOString().split("T")[0];
    const hit = { vesselCode: wo.vesselCode, display: `${wo.workOrderCode} (${dueStr})`, item: wo };
    if (wo.criticality === "A") overdueA_list.push(hit);
    else overdueRest.push(hit);
  }

  // Las críticas (criticidad A) se reportan como insights CRITICAL — agrupadas
  // por vessel cuando son muchas.
  emitGroupedByVessel(drafts, overdueA_list, {
    insightType:    "overdue_work_order",
    priority:       "CRITICAL",
    groupCodePrefix:"WO-OVERDUE-A-GROUP",
    groupTitle:     (n, suf) => `${n} OTs críticas vencidas${suf}`,
    groupSummary:   (n, suf, list) => `Hay ${n} órdenes de trabajo de criticidad A vencidas${suf}: ${list}.`,
    groupRecommendation: "Revisar, reprogramar o escalar de inmediato. Riesgo operativo elevado.",
    individualDraft: (vesselCode, wo) => ({
      insightCode:    `WO-OVERDUE-${wo.id}`,
      insightType:    "overdue_work_order",
      priority:       "CRITICAL",
      targetType:     "WORK_ORDER",
      targetId:       wo.id,
      vesselCode,
      title:          `Orden de trabajo vencida: ${wo.workOrderCode}`,
      summary:        `La OT ${wo.workOrderCode} (criticidad A) venció el ${new Date(wo.dueDate!).toISOString().split("T")[0]} y sigue abierta.`,
      recommendation: "Revisar y reprogramar o escalar la orden de trabajo.",
    }),
  });

  emitGroupedByVessel(drafts, overdueRest, {
    insightType:    "overdue_work_order",
    priority:       "HIGH",
    groupCodePrefix:"WO-OVERDUE-GROUP",
    groupTitle:     (n, suf) => `${n} OTs vencidas${suf}`,
    groupSummary:   (n, suf, list) => `Hay ${n} órdenes de trabajo vencidas${suf}: ${list}.`,
    groupRecommendation: "Revisar el backlog y reprogramar o escalar las OTs vencidas.",
    individualDraft: (vesselCode, wo) => ({
      insightCode:    `WO-OVERDUE-${wo.id}`,
      insightType:    "overdue_work_order",
      priority:       "HIGH",
      targetType:     "WORK_ORDER",
      targetId:       wo.id,
      vesselCode,
      title:          `Orden de trabajo vencida: ${wo.workOrderCode}`,
      summary:        `La OT ${wo.workOrderCode} venció el ${new Date(wo.dueDate!).toISOString().split("T")[0]} y sigue abierta.`,
      recommendation: "Revisar y reprogramar o escalar la orden de trabajo.",
    }),
  });
}

async function collectCapaInsights(
  prisma: PrismaClient,
  tenantId: string,
  drafts: InsightDraft[],
  today: Date,
) {
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() - 3);

  const capas = await prisma.capaRecord.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status:    { in: ["OPEN", "IN_PROGRESS"] },
      dueDate:   { lt: threshold },
    },
    select: { id: true, capaCode: true, vesselCode: true, dueDate: true, priority: true },
  });

  type Capa = typeof capas[number];
  // Dividimos por priority del CAPA: CRITICAL/HIGH del registro → insight
  // priority CRITICAL; resto → HIGH. Esto preserva la lógica original.
  const groupCritical: Array<{ vesselCode: string | null; display: string; item: Capa }> = [];
  const groupHigh:     Array<{ vesselCode: string | null; display: string; item: Capa }> = [];

  for (const capa of capas) {
    const dueStr = new Date(capa.dueDate!).toISOString().split("T")[0];
    const hit = { vesselCode: capa.vesselCode, display: `${capa.capaCode} (${dueStr})`, item: capa };
    if (capa.priority === "CRITICAL" || capa.priority === "HIGH") groupCritical.push(hit);
    else groupHigh.push(hit);
  }

  emitGroupedByVessel(drafts, groupCritical, {
    insightType:    "overdue_capa",
    priority:       "CRITICAL",
    groupCodePrefix:"CAPA-OVERDUE-CRIT-GROUP",
    groupTitle:     (n, suf) => `${n} CAPAs críticas vencidas${suf}`,
    groupSummary:   (n, suf, list) => `Hay ${n} CAPAs de prioridad CRITICAL/HIGH vencidas${suf}: ${list}.`,
    groupRecommendation: "Escalar y actualizar el estado de las CAPAs listadas con urgencia.",
    individualDraft: (vesselCode, capa) => ({
      insightCode:    `CAPA-OVERDUE-${capa.id}`,
      insightType:    "overdue_capa",
      priority:       "CRITICAL",
      targetType:     "CAPA",
      targetId:       capa.id,
      vesselCode,
      title:          `CAPA vencida: ${capa.capaCode}`,
      summary:        `La CAPA ${capa.capaCode} venció el ${new Date(capa.dueDate!).toISOString().split("T")[0]} sin completarse.`,
      recommendation: "Actualizar el estado de la CAPA o escalar al responsable.",
    }),
  });

  emitGroupedByVessel(drafts, groupHigh, {
    insightType:    "overdue_capa",
    priority:       "HIGH",
    groupCodePrefix:"CAPA-OVERDUE-GROUP",
    groupTitle:     (n, suf) => `${n} CAPAs vencidas${suf}`,
    groupSummary:   (n, suf, list) => `Hay ${n} CAPAs vencidas${suf}: ${list}.`,
    groupRecommendation: "Revisar y actualizar el estado de las CAPAs listadas.",
    individualDraft: (vesselCode, capa) => ({
      insightCode:    `CAPA-OVERDUE-${capa.id}`,
      insightType:    "overdue_capa",
      priority:       "HIGH",
      targetType:     "CAPA",
      targetId:       capa.id,
      vesselCode,
      title:          `CAPA vencida: ${capa.capaCode}`,
      summary:        `La CAPA ${capa.capaCode} venció el ${new Date(capa.dueDate!).toISOString().split("T")[0]} sin completarse.`,
      recommendation: "Actualizar el estado de la CAPA o escalar al responsable.",
    }),
  });
}

async function collectBacklogRiskInsights(
  prisma: PrismaClient,
  tenantId: string,
  drafts: InsightDraft[],
  today: Date,
) {
  // Count overdue PLANNED work orders per vessel
  const vessels = await prisma.vessel.findMany({
    where:  { tenantId, deletedAt: null },
    select: { code: true },
  });

  for (const vessel of vessels) {
    const overdueCount = await prisma.workOrder.count({
      where: {
        tenantId,
        vesselCode: vessel.code,
        deletedAt:  null,
        status:     "PLANNED",
        dueDate:    { lt: today },
      },
    });

    if (overdueCount > 5) {
      drafts.push({
        insightCode:    `BACKLOG-${vessel.code}`,
        insightType:    "backlog_risk",
        priority:       "HIGH",
        targetType:     "VESSEL",
        targetId:       vessel.code,
        vesselCode:     vessel.code,
        title:          `Riesgo de backlog: ${vessel.code}`,
        summary:        `El buque ${vessel.code} tiene ${overdueCount} órdenes preventivas vencidas sin ejecutar.`,
        recommendation: "Revisar el backlog de mantenimiento y reprogramar o escalar las órdenes críticas.",
      });
    }
  }
}

async function collectRepeatedFailureInsights(
  prisma: PrismaClient,
  tenantId: string,
  drafts: InsightDraft[],
  now: Date,
) {
  const window90 = new Date(now);
  window90.setDate(window90.getDate() - 90);

  // Group defects by assetId in last 90 days
  const defects = await prisma.defect.findMany({
    where: {
      tenantId,
      deletedAt:  null,
      reportedAt: { gte: window90 },
    },
    select: { id: true, assetId: true, vesselCode: true, reportedAt: true },
  });

  const byAsset = new Map<string, { count: number; vesselCode: string; assetId: string }>();
  for (const d of defects) {
    if (!d.assetId) continue;
    const entry = byAsset.get(d.assetId) ?? { count: 0, vesselCode: d.vesselCode, assetId: d.assetId };
    entry.count++;
    byAsset.set(d.assetId, entry);
  }

  const hits: Array<{ vesselCode: string | null; display: string; item: { assetId: string; count: number; vesselCode: string } }> = [];
  for (const [assetId, entry] of byAsset.entries()) {
    if (entry.count >= 3) {
      hits.push({
        vesselCode: entry.vesselCode,
        display: `${assetId.slice(-6)} (${entry.count} fallas)`,
        item: { assetId, count: entry.count, vesselCode: entry.vesselCode },
      });
    }
  }

  emitGroupedByVessel(drafts, hits, {
    insightType:    "repeated_failure",
    priority:       "HIGH",
    groupCodePrefix:"REPEAT-FAIL-GROUP",
    groupTitle:     (n, suf) => `${n} activos con fallas repetidas${suf}`,
    groupSummary:   (n, suf, list) => `${n} activos registraron ≥3 defectos en los últimos 90 días${suf}: ${list}.`,
    groupRecommendation: "Investigar causa raíz por activo y revisar planes preventivos de los listados.",
    individualDraft: (vesselCode, it) => ({
      insightCode:    `REPEAT-FAIL-${it.assetId}`,
      insightType:    "repeated_failure",
      priority:       "HIGH",
      targetType:     "ASSET",
      targetId:       it.assetId,
      vesselCode,
      title:          `Falla repetida detectada en activo`,
      summary:        `Se registraron ${it.count} defectos en el mismo activo en los últimos 90 días.`,
      recommendation: "Investigar causa raíz y revisar el plan de mantenimiento preventivo.",
    }),
  });
}

const DEFERRAL_TYPE_LABEL: Record<string, string> = {
  OPERATIONAL_CONSTRAINT:      "restricción operacional",
  NO_PORT_OPPORTUNITY:         "sin oportunidad en puerto",
  SPARES_MISSING:              "faltan repuestos",
  CONTRACTOR_REQUIRED:         "requiere contratista",
  SAFETY_CONSTRAINT:           "restricción de seguridad",
  WEATHER_CONSTRAINT:          "condiciones meteorológicas",
  EQUIPMENT_CANNOT_BE_STOPPED: "equipo no puede detenerse",
  PERMIT_NOT_AVAILABLE:        "permiso no disponible",
  CREW_LIMITATION:             "limitación de tripulación",
  LOW_RISK_RESCHEDULE:         "reprogramación de bajo riesgo",
  OTHER:                       "otro",
};

function buildDeferralSummary(count: number, reasons: Array<{ type: string | null; justification: string | null }>): string {
  const typeCounts = new Map<string, number>();
  const justifications: string[] = [];
  for (const r of reasons) {
    if (r.type) {
      const label = DEFERRAL_TYPE_LABEL[r.type] ?? r.type.replace(/_/g, " ").toLowerCase();
      typeCounts.set(label, (typeCounts.get(label) ?? 0) + 1);
    }
    if (r.justification?.trim()) {
      const j = r.justification.trim().replace(/\s+/g, " ");
      justifications.push(j.length > 90 ? j.slice(0, 90) + "…" : j);
    }
  }
  const typesText = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, c]) => (c > 1 ? `${label} (${c})` : label))
    .join(", ");

  let summary = `${count} postergaciones en los últimos 90 días`;
  if (typesText)              summary += `. Motivos: ${typesText}`;
  if (justifications.length)  summary += `. Notas: ${justifications.slice(0, 2).map(j => `«${j}»`).join("; ")}`;
  return summary + ".";
}

async function collectRepeatedDeferralInsights(
  prisma: PrismaClient,
  tenantId: string,
  drafts: InsightDraft[],
  now: Date,
) {
  const window90 = new Date(now);
  window90.setDate(window90.getDate() - 90);

  const deferrals = await prisma.deferral.findMany({
    where: {
      tenantId,
      deletedAt:    null,
      requestedAt:  { gte: window90 },
    },
    select: { id: true, assetId: true, vesselCode: true, justification: true, deferralType: true, requestedAt: true },
    orderBy: { requestedAt: "desc" },
  });

  const byAsset = new Map<string, { count: number; vesselCode: string; reasons: Array<{ type: string | null; justification: string | null }> }>();
  for (const d of deferrals) {
    if (!d.assetId) continue;
    const entry = byAsset.get(d.assetId) ?? { count: 0, vesselCode: d.vesselCode, reasons: [] };
    entry.count++;
    entry.reasons.push({ type: d.deferralType ?? null, justification: d.justification ?? null });
    byAsset.set(d.assetId, entry);
  }

  const repeatedIds = [...byAsset.entries()].filter(([, e]) => e.count >= 2).map(([id]) => id);
  if (repeatedIds.length === 0) return;

  // Cargar nombres de los assets afectados para mostrarlos en title/display.
  const assets = await prisma.asset.findMany({
    where:  { id: { in: repeatedIds }, tenantId, deletedAt: null },
    select: { id: true, name: true, sfiCode: true },
  });
  const assetMap = new Map(assets.map(a => [a.id, a]));

  const hits: Array<{ vesselCode: string | null; display: string; item: { assetId: string; assetLabel: string; count: number; vesselCode: string; reasons: Array<{ type: string | null; justification: string | null }> } }> = [];
  for (const assetId of repeatedIds) {
    const entry = byAsset.get(assetId)!;
    const asset = assetMap.get(assetId);
    const assetLabel = asset
      ? `${asset.name}${asset.sfiCode ? ` (${asset.sfiCode})` : ""}`
      : `asset ${assetId.slice(0, 8)}`;
    hits.push({
      vesselCode: entry.vesselCode,
      display:    `${assetLabel} ×${entry.count}`,
      item:       { assetId, assetLabel, count: entry.count, vesselCode: entry.vesselCode, reasons: entry.reasons },
    });
  }

  emitGroupedByVessel(drafts, hits, {
    insightType:    "repeated_deferral",
    priority:       "MEDIUM",
    groupCodePrefix:"REPEAT-DEF-GROUP",
    groupTitle:     (n, suf) => `${n} activos con diferimientos repetidos${suf}`,
    groupSummary:   (n, suf, list) => `${n} activos acumulan ≥2 diferimientos en los últimos 90 días${suf}: ${list}.`,
    groupRecommendation: "Evaluar redefinir las tareas o priorizar la atención de los activos listados.",
    individualDraft: (vesselCode, it) => ({
      insightCode:    `REPEAT-DEF-${it.assetId}`,
      insightType:    "repeated_deferral",
      priority:       "MEDIUM",
      targetType:     "ASSET",
      targetId:       it.assetId,
      vesselCode,
      title:          `Postergaciones repetidas: ${it.assetLabel}`,
      summary:        buildDeferralSummary(it.count, it.reasons),
      recommendation: "Revisar si la tarea debe redefinirse, si faltan repuestos u otra restricción se está repitiendo, o si el activo requiere intervención urgente.",
    }),
  });
}

async function collectInspectionFailureInsights(
  prisma: PrismaClient,
  tenantId: string,
  drafts: InsightDraft[],
  now: Date,
) {
  const window90 = new Date(now);
  window90.setDate(window90.getDate() - 90);

  const vessels = await prisma.vessel.findMany({
    where:  { tenantId, deletedAt: null },
    select: { code: true },
  });

  for (const vessel of vessels) {
    const failCount = await prisma.inspection.count({
      where: {
        tenantId,
        vesselCode:   vessel.code,
        deletedAt:    null,
        result:       "FAIL",
        completedAt:  { gte: window90 },
      },
    });

    const conditionalCount = await prisma.inspection.count({
      where: {
        tenantId,
        vesselCode:   vessel.code,
        deletedAt:    null,
        result:       "CONDITIONAL",
        completedAt:  { gte: window90 },
      },
    });

    if (failCount >= 2 || conditionalCount >= 3) {
      drafts.push({
        insightCode:    `INSP-FAIL-${vessel.code}`,
        insightType:    "inspection_failure_pattern",
        priority:       failCount >= 2 ? "HIGH" : "MEDIUM",
        targetType:     "VESSEL",
        targetId:       vessel.code,
        vesselCode:     vessel.code,
        title:          `Patrón de fallas en inspecciones: ${vessel.code}`,
        summary:        `El buque ${vessel.code} registró ${failCount} inspecciones FAIL y ${conditionalCount} CONDITIONAL en 90 días.`,
        recommendation: "Revisar los hallazgos de inspección y generar acciones correctivas (CAPA).",
      });
    }
  }
}

async function collectFluidAnalysisInsights(
  prisma: PrismaClient,
  tenantId: string,
  drafts: InsightDraft[],
  now: Date,
) {
  const window90 = new Date(now);
  window90.setDate(window90.getDate() - 90);

  const results = await prisma.fluidAnalysisResult.findMany({
    where: {
      tenantId,
      receivedAt: { gte: window90 },
      verdict: { in: ["CAUTION", "CRITICAL", "ACTION_REQUIRED"] as any[] },
    },
    select: {
      verdict: true,
      sample: { select: { assetId: true, vesselCode: true, sampleCode: true } },
    },
  });

  type AssetEntry = { critical: number; caution: number; vesselCode: string; sampleCode: string };
  const byAsset = new Map<string, AssetEntry>();

  for (const r of results) {
    const assetId = r.sample.assetId;
    const entry = byAsset.get(assetId) ?? {
      critical: 0, caution: 0,
      vesselCode: r.sample.vesselCode,
      sampleCode: r.sample.sampleCode,
    };
    if (r.verdict === "CRITICAL" || r.verdict === "ACTION_REQUIRED") entry.critical++;
    else entry.caution++;
    byAsset.set(assetId, entry);
  }

  const critHits: Array<{ vesselCode: string | null; display: string; item: { assetId: string; entry: AssetEntry } }> = [];
  const cautHits: Array<{ vesselCode: string | null; display: string; item: { assetId: string; entry: AssetEntry } }> = [];
  for (const [assetId, entry] of byAsset.entries()) {
    if (entry.critical >= 1) {
      critHits.push({
        vesselCode: entry.vesselCode,
        display: `${assetId.slice(-6)} (${entry.critical} crit.)`,
        item: { assetId, entry },
      });
    } else if (entry.caution >= 2) {
      cautHits.push({
        vesselCode: entry.vesselCode,
        display: `${assetId.slice(-6)} (${entry.caution} prec.)`,
        item: { assetId, entry },
      });
    }
  }

  emitGroupedByVessel(drafts, critHits, {
    insightType:    "fluid_analysis_critical",
    priority:       "HIGH",
    groupCodePrefix:"FLUID-CRIT-GROUP",
    groupTitle:     (n, suf) => `${n} activos con análisis de fluido crítico${suf}`,
    groupSummary:   (n, suf, list) => `${n} activos con resultados CRÍTICO/ACCIÓN REQUERIDA en 90 días${suf}: ${list}.`,
    groupRecommendation: "Revisar lubricante/fluido y condición de los activos listados; considerar cambios inmediatos.",
    individualDraft: (vesselCode, it) => ({
      insightCode:    `FLUID-CRIT-${it.assetId}`,
      insightType:    "fluid_analysis_critical",
      priority:       "HIGH",
      targetType:     "ASSET",
      targetId:       it.assetId,
      vesselCode,
      title:          `Análisis de fluido crítico en activo`,
      summary:        `Se detectaron ${it.entry.critical} resultado(s) CRÍTICO/ACCIÓN REQUERIDA en análisis de fluidos de los últimos 90 días.`,
      recommendation: "Revisar el estado del lubricante o fluido, considerar cambio inmediato y verificar condición del equipo.",
    }),
  });

  emitGroupedByVessel(drafts, cautHits, {
    insightType:    "fluid_analysis_caution_trend",
    priority:       "MEDIUM",
    groupCodePrefix:"FLUID-CAUT-GROUP",
    groupTitle:     (n, suf) => `${n} activos con tendencia de precaución en fluidos${suf}`,
    groupSummary:   (n, suf, list) => `${n} activos acumulan ≥2 resultados PRECAUCIÓN en 90 días${suf}: ${list}.`,
    groupRecommendation: "Incrementar frecuencia de muestreo de los activos listados y revisar antes del próximo mantenimiento.",
    individualDraft: (vesselCode, it) => ({
      insightCode:    `FLUID-CAUT-${it.assetId}`,
      insightType:    "fluid_analysis_caution_trend",
      priority:       "MEDIUM",
      targetType:     "ASSET",
      targetId:       it.assetId,
      vesselCode,
      title:          `Tendencia de precaución en análisis de fluidos`,
      summary:        `El activo acumula ${it.entry.caution} resultados en estado PRECAUCIÓN en los últimos 90 días.`,
      recommendation: "Incrementar frecuencia de muestreo y revisar condición del fluido antes del próximo mantenimiento.",
    }),
  });
}

async function collectFuelConsumptionInsights(
  prisma: PrismaClient,
  tenantId: string,
  drafts: InsightDraft[],
  now: Date,
) {
  const day30 = new Date(now);
  day30.setDate(day30.getDate() - 30);
  const day60 = new Date(now);
  day60.setDate(day60.getDate() - 60);

  const vessels = await prisma.vessel.findMany({
    where:  { tenantId, deletedAt: null },
    select: { code: true },
  });

  for (const vessel of vessels) {
    const recent = await prisma.dailyReport.findMany({
      where: {
        tenantId,
        vesselCode:       vessel.code,
        deletedAt:        null,
        reportDate:       { gte: day30 },
        fuelConsumedLiters: { gt: 0 },
      },
      select: { fuelConsumedLiters: true },
    });

    const prior = await prisma.dailyReport.findMany({
      where: {
        tenantId,
        vesselCode:       vessel.code,
        deletedAt:        null,
        reportDate:       { gte: day60, lt: day30 },
        fuelConsumedLiters: { gt: 0 },
      },
      select: { fuelConsumedLiters: true },
    });

    if (recent.length < 3 || prior.length < 3) continue;

    const avgRecent = recent.reduce((s, r) => s + (r.fuelConsumedLiters ?? 0), 0) / recent.length;
    const avgPrior  = prior.reduce((s, r) => s + (r.fuelConsumedLiters ?? 0), 0) / prior.length;

    if (avgPrior <= 0) continue;

    const pctIncrease = ((avgRecent - avgPrior) / avgPrior) * 100;

    if (pctIncrease >= 20) {
      drafts.push({
        insightCode:    `FUEL-TREND-${vessel.code}`,
        insightType:    "fuel_consumption_increase",
        priority:       pctIncrease >= 35 ? "HIGH" : "MEDIUM",
        targetType:     "VESSEL",
        targetId:       vessel.code,
        vesselCode:     vessel.code,
        title:          `Aumento de consumo de combustible: ${vessel.code}`,
        summary:        `El consumo promedio de los últimos 30 días (${avgRecent.toFixed(0)} L/día) es un ${pctIncrease.toFixed(0)}% mayor que el período anterior (${avgPrior.toFixed(0)} L/día).`,
        recommendation: "Verificar eficiencia de motores, condiciones de navegación, carga y posibles fugas.",
      });
    }
  }
}
