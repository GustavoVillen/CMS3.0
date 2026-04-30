/**
 * Deterministic insight generator.
 * Evaluates threshold rules against current DB state and upserts AiInsight records.
 * Per docs/10: "For MVP, prefer deterministic threshold generation first."
 */

import { getPrismaClient } from "../../platform/data/prisma-client";

type PrismaClient = NonNullable<ReturnType<typeof getPrismaClient>>;

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

  for (const spare of spares) {
    if (spare.currentStock < spare.minStock) {
      drafts.push({
        insightCode:    `STOCK-MIN-${spare.id}`,
        insightType:    "stock_below_minimum",
        priority:       "HIGH",
        targetType:     "SPARE",
        targetId:       spare.id,
        vesselCode:     spare.vesselCode,
        title:          `Stock bajo mínimo: ${spare.name ?? spare.sku}`,
        summary:        `El repuesto ${spare.sku} tiene stock ${spare.currentStock} por debajo del mínimo ${spare.minStock}.`,
        recommendation: "Emitir orden de compra urgente para reponer el stock al nivel mínimo.",
      });
    } else if (spare.currentStock <= spare.reorderPoint) {
      drafts.push({
        insightCode:    `STOCK-REORDER-${spare.id}`,
        insightType:    "stock_below_reorder_point",
        priority:       "MEDIUM",
        targetType:     "SPARE",
        targetId:       spare.id,
        vesselCode:     spare.vesselCode,
        title:          `Stock en punto de reorden: ${spare.name ?? spare.sku}`,
        summary:        `El repuesto ${spare.sku} alcanzó el punto de reorden (${spare.reorderPoint}). Stock actual: ${spare.currentStock}.`,
        recommendation: "Planificar reposición de stock antes de alcanzar el mínimo.",
      });
    }
  }
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

  for (const cert of certs) {
    if (!cert.expiryDate) continue;
    const expiry = new Date(cert.expiryDate);

    if (expiry < today) {
      drafts.push({
        insightCode:    `CERT-EXP-${cert.id}`,
        insightType:    "certificate_expired",
        priority:       "CRITICAL",
        targetType:     "CERTIFICATE",
        targetId:       cert.id,
        vesselCode:     cert.vesselCode,
        title:          `Certificado vencido: ${cert.name ?? cert.certificateCode}`,
        summary:        `El certificado ${cert.certificateCode} venció el ${expiry.toISOString().split("T")[0]}.`,
        recommendation: "Iniciar proceso de renovación inmediata. Riesgo de incumplimiento regulatorio.",
      });
    } else if (expiry <= in30Days) {
      drafts.push({
        insightCode:    `CERT-EXPIRING-${cert.id}`,
        insightType:    "certificate_expiring",
        priority:       "HIGH",
        targetType:     "CERTIFICATE",
        targetId:       cert.id,
        vesselCode:     cert.vesselCode,
        title:          `Certificado próximo a vencer: ${cert.name ?? cert.certificateCode}`,
        summary:        `El certificado ${cert.certificateCode} vence el ${expiry.toISOString().split("T")[0]} (≤ 30 días).`,
        recommendation: "Iniciar proceso de renovación para evitar interrupción operacional.",
      });
    }
  }
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

  for (const wo of workOrders) {
    const threshold = wo.criticality === "A" ? overdueA : overdueThreshold;
    if (wo.dueDate && new Date(wo.dueDate) < threshold) {
      drafts.push({
        insightCode:    `WO-OVERDUE-${wo.id}`,
        insightType:    "overdue_work_order",
        priority:       wo.criticality === "A" ? "CRITICAL" : "HIGH",
        targetType:     "WORK_ORDER",
        targetId:       wo.id,
        vesselCode:     wo.vesselCode,
        title:          `Orden de trabajo vencida: ${wo.workOrderCode}`,
        summary:        `La OT ${wo.workOrderCode} venció el ${new Date(wo.dueDate!).toISOString().split("T")[0]} y sigue abierta.`,
        recommendation: "Revisar y reprogramar o escalar la orden de trabajo.",
      });
    }
  }
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

  for (const capa of capas) {
    drafts.push({
      insightCode:    `CAPA-OVERDUE-${capa.id}`,
      insightType:    "overdue_capa",
      priority:       capa.priority === "CRITICAL" || capa.priority === "HIGH" ? "CRITICAL" : "HIGH",
      targetType:     "CAPA",
      targetId:       capa.id,
      vesselCode:     capa.vesselCode,
      title:          `CAPA vencida: ${capa.capaCode}`,
      summary:        `La CAPA ${capa.capaCode} venció el ${new Date(capa.dueDate!).toISOString().split("T")[0]} sin completarse.`,
      recommendation: "Actualizar el estado de la CAPA o escalar al responsable.",
    });
  }
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

  for (const [assetId, entry] of byAsset.entries()) {
    if (entry.count >= 3) {
      drafts.push({
        insightCode:    `REPEAT-FAIL-${assetId}`,
        insightType:    "repeated_failure",
        priority:       "HIGH",
        targetType:     "ASSET",
        targetId:       assetId,
        vesselCode:     entry.vesselCode,
        title:          `Falla repetida detectada en activo`,
        summary:        `Se registraron ${entry.count} defectos en el mismo activo en los últimos 90 días.`,
        recommendation: "Investigar causa raíz y revisar el plan de mantenimiento preventivo.",
      });
    }
  }
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
    select: { id: true, assetId: true, vesselCode: true },
  });

  const byAsset = new Map<string, { count: number; vesselCode: string }>();
  for (const d of deferrals) {
    if (!d.assetId) continue;
    const entry = byAsset.get(d.assetId) ?? { count: 0, vesselCode: d.vesselCode };
    entry.count++;
    byAsset.set(d.assetId, entry);
  }

  for (const [assetId, entry] of byAsset.entries()) {
    if (entry.count >= 2) {
      drafts.push({
        insightCode:    `REPEAT-DEF-${assetId}`,
        insightType:    "repeated_deferral",
        priority:       "MEDIUM",
        targetType:     "ASSET",
        targetId:       assetId,
        vesselCode:     entry.vesselCode,
        title:          `Postergaciones repetidas en activo`,
        summary:        `Se registraron ${entry.count} postergaciones en el mismo activo en los últimos 90 días.`,
        recommendation: "Evaluar si la tarea debe redefinirse o si el activo requiere atención urgente.",
      });
    }
  }
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

  for (const [assetId, entry] of byAsset.entries()) {
    if (entry.critical >= 1) {
      drafts.push({
        insightCode:    `FLUID-CRIT-${assetId}`,
        insightType:    "fluid_analysis_critical",
        priority:       "HIGH",
        targetType:     "ASSET",
        targetId:       assetId,
        vesselCode:     entry.vesselCode,
        title:          `Análisis de fluido crítico en activo`,
        summary:        `Se detectaron ${entry.critical} resultado(s) CRÍTICO/ACCIÓN REQUERIDA en análisis de fluidos de los últimos 90 días.`,
        recommendation: "Revisar el estado del lubricante o fluido, considerar cambio inmediato y verificar condición del equipo.",
      });
    } else if (entry.caution >= 2) {
      drafts.push({
        insightCode:    `FLUID-CAUT-${assetId}`,
        insightType:    "fluid_analysis_caution_trend",
        priority:       "MEDIUM",
        targetType:     "ASSET",
        targetId:       assetId,
        vesselCode:     entry.vesselCode,
        title:          `Tendencia de precaución en análisis de fluidos`,
        summary:        `El activo acumula ${entry.caution} resultados en estado PRECAUCIÓN en los últimos 90 días.`,
        recommendation: "Incrementar frecuencia de muestreo y revisar condición del fluido antes del próximo mantenimiento.",
      });
    }
  }
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
