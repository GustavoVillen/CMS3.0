import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { log } from "../../common/logger";

export async function getDailyReportPeriodSuggestions(session: TenantAccessSession, reportId: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const report = await (prisma as any).dailyReport.findFirst({
    where: { id: reportId, tenantId: tenant.id, deletedAt: null },
  });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Reporte no encontrado.");

  const vesselCode: string = report.vesselCode;
  const reportDate: Date   = report.reportDate;

  // Find the previous report for this vessel to determine period start
  const prevReport = await (prisma as any).dailyReport.findFirst({
    where: {
      tenantId: tenant.id,
      vesselCode,
      reportDate: { lt: reportDate },
      deletedAt: null,
    },
    orderBy: { reportDate: "desc" },
  });

  const periodStart: Date = prevReport
    ? new Date(prevReport.reportDate.getTime() + 1) // 1ms after previous report date
    : new Date(0);
  // Include the full reportDate day (add 2 days to be timezone-safe, then filter by date on display)
  const periodEnd: Date = new Date(reportDate.getTime() + 2 * 86400000);

  log.debug("[period-suggestions] vessel:", vesselCode, "reportDate:", reportDate.toISOString(), "period:", periodStart.toISOString(), "→", periodEnd.toISOString());

  // ── Work Orders closed in period ────────────────────────────────────────
  const workOrders = await (prisma as any).workOrder.findMany({
    where: {
      tenantId: tenant.id,
      vesselCode,
      deletedAt: null,
      status: "CLOSED",
      completedDate: { gte: periodStart, lt: periodEnd },
    },
    include: { workLogs: { take: 1, orderBy: { createdAt: "desc" } } },
    orderBy: { completedDate: "asc" },
  });
  log.debug("[period-suggestions] workOrders found:", workOrders.length);

  // Plan IDs already covered by a closed WO (avoid duplicates)
  const woPlansIds = new Set<string>(workOrders.map((wo: any) => wo.maintenancePlanId).filter(Boolean));

  // ── Maintenance plans directly executed in period (quick-close / report-execution) ──
  const directPlansWhere: Record<string, unknown> = {
    tenantId: tenant.id,
    vesselCode,
    deletedAt: null,
    lastExecutionDate: { gte: periodStart, lt: periodEnd },
  };
  if (woPlansIds.size > 0) {
    directPlansWhere["NOT"] = { id: { in: [...woPlansIds] } };
  }
  const directPlans = await (prisma as any).maintenancePlan.findMany({
    where: directPlansWhere,
    orderBy: { lastExecutionDate: "asc" },
  });
  log.debug("[period-suggestions] directPlans found:", directPlans.length, directPlans.map((p: any) => ({ id: p.id, taskCode: p.taskCode, lastExecutionDate: p.lastExecutionDate })));

  // ── Defects reported/created in period ──────────────────────────────────
  const defects = await (prisma as any).defect.findMany({
    where: {
      tenantId: tenant.id,
      vesselCode,
      deletedAt: null,
      reportedAt: { gte: periodStart, lt: periodEnd },
    },
    orderBy: { reportedAt: "asc" },
  });

  // ── Spare request items received in period ──────────────────────────────
  const spareItems = await (prisma as any).spareRequestItem.findMany({
    where: {
      spareRequest: { tenantId: tenant.id, requestedForVesselCode: vesselCode, deletedAt: null },
      status: "FULFILLED",
      OR: [
        { receivedAt: { gte: periodStart, lt: periodEnd } },
        { receivedAt: null, updatedAt: { gte: periodStart, lt: periodEnd } },
      ],
    },
    include: {
      spare: { select: { id: true, sku: true, name: true, unit: true } },
      spareRequest: { select: { requestCode: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  // ── Deferrals active in period ───────────────────────────────────────────
  const deferrals = await (prisma as any).deferral.findMany({
    where: {
      tenantId: tenant.id,
      vesselCode,
      deletedAt: null,
      status: { in: ["REQUESTED", "UNDER_REVIEW", "APPROVED", "ACTIVE"] },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    period: {
      from: prevReport ? prevReport.reportDate.toISOString().slice(0, 10) : null,
      to: reportDate.toISOString().slice(0, 10),
    },
    maintenance: [
      ...workOrders.map((wo: any) => ({
        workOrderId:       wo.id,
        workOrderCode:     wo.workOrderCode,
        taskTitle:         wo.title ?? wo.description ?? wo.workOrderCode,
        taskType:          "MAINTENANCE" as const,
        shortDescription:  wo.closeNotes ?? wo.observations ?? null,
        performedBy:       wo.executedByName ?? wo.workLogs?.[0]?.createdByUserId ?? null,
        maintenancePlanId: wo.maintenancePlanId ?? null,
        resultStatus:      "COMPLETED" as const,
      })),
      ...directPlans.map((p: any) => ({
        workOrderId:       null,
        workOrderCode:     null,
        taskTitle:         p.title ?? p.taskCode,
        taskType:          p.taskType ?? "MAINTENANCE",
        shortDescription:  null,
        performedBy:       p.responsible ?? null,
        maintenancePlanId: p.id,
        resultStatus:      "COMPLETED" as const,
      })),
    ],
    defects: defects.map((d: any) => ({
      defectId:               d.id,
      defectCode:             d.defectCode,
      affectedEquipmentId:    d.assetId ?? null,
      affectedEquipmentLabel: d.classification ?? null,
      description:            d.description,
      severitySuggested:      d.severity ?? null,
      immediateActionTaken:   d.immediateAction ?? null,
      followUpRequired:       d.status === "OPEN",
    })),
    spares: spareItems.map((i: any) => ({
      spareId:   i.spareId ?? null,
      spareName: i.spare?.name ?? i.description,
      spareSku:  i.spare?.sku ?? null,
      quantity:  i.quantity,
      unit:      i.unit,
      notes:     i.spareRequest?.requestCode ? `Solicitud ${i.spareRequest.requestCode}` : null,
    })),
    deferrals,
  };
}
