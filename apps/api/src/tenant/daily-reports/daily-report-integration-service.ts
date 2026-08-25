/**
 * Daily Report → PMS Integration
 *
 * When a daily report is confirmed, this service:
 * 1. Updates running hours on maintenance plans (HOURS/RUNNING_HOURS trigger)
 * 2. Recalculates execution windows (nextDue, executionStatus)
 * 3. Closes matching due items when maintenance entries confirm completion
 * 4. Returns suggestions for findings, WO drafts, spare consumption (non-persistent)
 */

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { computeNextDueDate, computeNextDueHours } from "../pms/execution-windows-service";
import { refreshExecutionStatuses } from "../pms/execution-windows-service";
import { log } from "../../common/logger";
import { resolveTenantTime, fmtDate as fmtDateTz } from "../../common/tenant-time";
import { recordHoursReadings, ensureCanWriteAssetHours } from "../asset-hours/asset-hours-service";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

export interface IntegrationResult {
  updatedRunningHoursCount: number;
  recalculatedPlansCount: number;
  closedDueItemsCount: number;
  suggestions: IntegrationSuggestion[];
}

export interface IntegrationSuggestion {
  type: "FINDING_DRAFT" | "WO_DRAFT" | "SPARE_CONSUMPTION" | "DEFERRAL_SUGGESTION" | "CLOSE_PLAN";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  detail: string;
  sourceEntryId?: string;
  linkedPlanId?: string;
  linkedWOId?: string;
}

function ensureCanConfirm(session: TenantAccessSession) {
  const allowed = ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER", "TECHNICIAN_OPERATOR"];
  if (!allowed.includes(session.user.role)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para confirmar reportes diarios.");
  }
}

export async function confirmAndIntegrateDailyReport(
  session: TenantAccessSession,
  reportId: string,
): Promise<IntegrationResult> {
  ensureCanConfirm(session);

  // La nota que queda en el registro de trabajo lleva la fecha del parte: en la
  // hora de la empresa, para que coincida con la que se ve en pantalla.
  const { tz: reportTz, locale: reportLocale } = await resolveTenantTime(session.tenantSlug);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const report = await (prisma as any).dailyReport.findFirst({
    where: { id: reportId, tenantId: tenant.id, deletedAt: null },
    include: {
      equipmentHours: true,
      maintenanceEntries: true,
      defectEntries: true,
      spareUsages: true,
    },
  });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Reporte no encontrado.");

  if (report.status === "CLOSED") {
    throw new RouteError(409, "REPORT_CLOSED", "No se puede integrar un reporte cerrado.");
  }

  const result: IntegrationResult = {
    updatedRunningHoursCount: 0,
    recalculatedPlansCount: 0,
    closedDueItemsCount: 0,
    suggestions: [],
  };

  const vesselCode = report.vesselCode as string;

  // ── Step 1: Update running hours on HOURS-triggered plans ─────────────────
  const equipmentHoursEntries = (report.equipmentHours ?? []) as Array<{
    assetId?: string | null;
    runningHoursTotal?: number | null;
    equipmentLabel: string;
  }>;

  // Las horas del parte se asientan como lecturas de horómetro (única fuente de
  // "horas actuales" del equipo) y el escritor de tenant/asset-hours avanza los
  // planes por horas. Antes esta lógica estaba duplicada acá y en el M2.
  const reportReadingDate = (report.reportDate as Date | null) ?? (report.createdAt as Date);
  try {
    const recorded = await recordHoursReadings(
      session,
      equipmentHoursEntries
        .filter((e) => e.assetId && e.runningHoursTotal != null)
        .map((e) => ({
          assetId: e.assetId!,
          runningHours: e.runningHoursTotal!,
          readingDate: reportReadingDate.toISOString().slice(0, 10),
        })),
      { source: "DAILY_REPORT", sourceRecordId: reportId, skipPermissionCheck: true },
    );
    result.updatedRunningHoursCount = recorded.plansTouched;
  } catch (err) {
    log.error("[daily-report integrate] registro de horómetros falló:", err);
  }

  // ── Step 2: Recalculate all execution statuses for the vessel ─────────────
  const maxHoursEntry = equipmentHoursEntries.reduce<number | undefined>((max, e) => {
    if (e.runningHoursTotal == null) return max;
    return max == null || e.runningHoursTotal > max ? e.runningHoursTotal : max;
  }, undefined);

  const refreshed = await refreshExecutionStatuses(tenant.id, maxHoursEntry, report.vesselCode);
  result.recalculatedPlansCount = refreshed;

  // ── Step 3: Auto-close due items when maintenance entries confirm completion ─
  const maintenanceEntries = (report.maintenanceEntries ?? []) as Array<{
    id: string;
    maintenancePlanId?: string | null;
    workOrderId?: string | null;
    resultStatus: string;
    taskTitle: string;
    performedBy?: string | null;
    followUpRequired: boolean;
  }>;

  for (const entry of maintenanceEntries) {
    if (!entry.maintenancePlanId) continue;
    if (entry.resultStatus !== "COMPLETED" && entry.resultStatus !== "COMPLETED_WITH_OBSERVATIONS") continue;

    const plan = await (prisma as any).maintenancePlan.findFirst({
      where: { id: entry.maintenancePlanId, tenantId: tenant.id, deletedAt: null },
    });
    if (!plan) continue;

    const completedAt = report.reportDate instanceof Date ? report.reportDate : new Date(report.reportDate);
    const nextDueDate = computeNextDueDate(plan, completedAt);
    const nextDueHours = maxHoursEntry != null ? computeNextDueHours(plan, maxHoursEntry) : null;

    await (prisma as any).maintenancePlan.update({
      where: { id: plan.id },
      data: {
        lastExecutionDate: completedAt,
        lastExecutionHours: maxHoursEntry ?? null,
        nextDueDate: nextDueDate ?? plan.nextDueDate,
        nextDueHours: nextDueHours ?? plan.nextDueHours,
        executionStatus: "FUTURE",
      },
    });

    // Create WorkLog record
    await (prisma as any).workLog.create({
      data: {
        tenantId: tenant.id,
        vesselCode,
        maintenancePlanId: plan.id,
        workOrderId: entry.workOrderId ?? null,
        assetId: plan.assetId,
        logCode: `WL-DR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        taskType: "MAINTENANCE",
        result: entry.resultStatus as never,
        startedAt: completedAt,
        completedAt,
        executedByName: entry.performedBy ?? session.user.firstName ?? "Tripulación",
        executedByUserId: session.user.id,
        followUpRequired: entry.followUpRequired,
        createdByUserId: session.user.id,
        notes: `Registrado desde Reporte Diario del ${fmtDateTz(completedAt, reportTz, reportLocale)}`,
      },
    });

    result.closedDueItemsCount++;

    if (entry.followUpRequired) {
      result.suggestions.push({
        type: "FINDING_DRAFT",
        confidence: "HIGH",
        title: `Seguimiento requerido: ${entry.taskTitle}`,
        detail: "La entrada de mantenimiento marcó seguimiento requerido. Considerar registrar defecto.",
        sourceEntryId: entry.id,
        linkedPlanId: entry.maintenancePlanId ?? undefined,
      });
    }
  }

  // ── Step 4: Generate suggestions from defect entries ──────────────────────
  const defectEntries = (report.defectEntries ?? []) as Array<{
    id: string;
    description: string;
    severitySuggested?: string | null;
    followUpRequired: boolean;
    affectedEquipmentLabel?: string | null;
  }>;

  for (const defEntry of defectEntries) {
    if (defEntry.followUpRequired || defEntry.severitySuggested === "HIGH" || defEntry.severitySuggested === "CRITICAL") {
      result.suggestions.push({
        type: "FINDING_DRAFT",
        confidence: defEntry.severitySuggested === "CRITICAL" ? "HIGH" : "MEDIUM",
        title: `Defecto detectado: ${defEntry.affectedEquipmentLabel ?? "Equipo no especificado"}`,
        detail: defEntry.description,
        sourceEntryId: defEntry.id,
      });
    }
  }

  // ── Step 5: Generate suggestions from spare usages ────────────────────────
  const spareUsages = (report.spareUsages ?? []) as Array<{
    id: string;
    spareName: string;
    quantity: number;
    unit: string;
    spareId?: string | null;
  }>;

  for (const usage of spareUsages) {
    if (usage.spareId) {
      result.suggestions.push({
        type: "SPARE_CONSUMPTION",
        confidence: "HIGH",
        title: `Consumo de repuesto: ${usage.spareName}`,
        detail: `${usage.quantity} ${usage.unit} registrados en Daily Report. Confirmar descuento de stock.`,
        sourceEntryId: usage.id,
      });
    }
  }

  // ── Step 6: Suggestions based on next port / maintenance opportunity ───────
  if (report.maintenanceOpportunity === "YES" || report.maintenanceOpportunity === "LIMITED") {
    const upcomingPlans = await (prisma as any).maintenancePlan.findMany({
      where: {
        tenantId: tenant.id,
        vesselCode,
        executionStatus: { in: ["UPCOMING", "IN_WINDOW", "DUE", "OVERDUE"] },
        deletedAt: null,
      },
      orderBy: { nextDueDate: "asc" },
      take: 5,
    });

    if (upcomingPlans.length > 0) {
      result.suggestions.push({
        type: "CLOSE_PLAN",
        confidence: "MEDIUM",
        title: `${upcomingPlans.length} ítems por vencer — oportunidad en ${report.nextPort ?? "próxima escala"}`,
        detail: `Oportunidad de mantenimiento: ${report.maintenanceOpportunity}. ETA: ${report.etaNextPort ?? "no definida"}.`,
      });
    }
  }

  // ── Step 7: Mark report as integrated ────────────────────────────────────
  // Solo registra la integración (integratedAt). No avanza el status:
  // el frontend ya lo dejó en SUBMITTED al apretar Submit. La transición
  // a REVIEWED queda como acción manual posterior.
  await (prisma as any).dailyReport.update({
    where: { id: reportId },
    data: {
      integratedAt: new Date(),
      updatedByUserId: session.user.id,
    },
  });

  return result;
}

export async function getDailyReportWithSubEntities(
  session: TenantAccessSession,
  reportId: string,
) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const where: Record<string, unknown> = { id: reportId, tenantId: tenant.id, deletedAt: null };
  // FAIL-CLOSED: TENANT_ADMIN y FLEET_SUPERINTENDENT ven todo el tenant.
  // El resto solo ve sus vessels asignados; sin asignación → no ve nada.
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "FLEET_SUPERINTENDENT") {
    where.vesselCode = session.user.assignedVesselCodes.length === 0
      ? "__NO_ASSIGNED_VESSEL__"
      : { in: session.user.assignedVesselCodes };
  }

  const report = await (prisma as any).dailyReport.findFirst({
    where,
    include: {
      equipmentHours: { orderBy: { createdAt: "asc" } },
      maintenanceEntries: { orderBy: { createdAt: "asc" } },
      spareUsages: { orderBy: { createdAt: "asc" } },
      defectEntries: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!report) throw new RouteError(404, "NOT_FOUND", "Reporte no encontrado.");

  // Enrich maintenanceEntries with taskCode from the related MaintenancePlan
  const planIds: string[] = report.maintenanceEntries
    .map((e: any) => e.maintenancePlanId)
    .filter(Boolean);

  const taskCodeMap = new Map<string, string>();
  if (planIds.length > 0) {
    const plans = await (prisma as any).maintenancePlan.findMany({
      where: { id: { in: planIds }, tenantId: tenant.id, deletedAt: null },
      select: { id: true, taskCode: true },
    });
    for (const p of plans) taskCodeMap.set(p.id, p.taskCode);
  }

  report.maintenanceEntries = report.maintenanceEntries.map((e: any) => ({
    ...e,
    taskCode: e.maintenancePlanId ? (taskCodeMap.get(e.maintenancePlanId) ?? null) : null,
  }));

  // Enrich defectEntries with defectCode — try FK first, then description match
  const defectIds: string[] = report.defectEntries
    .map((e: any) => e.defectId)
    .filter(Boolean);

  const defectCodeById = new Map<string, string>();
  if (defectIds.length > 0) {
    const defects = await (prisma as any).defect.findMany({
      where: { id: { in: defectIds }, tenantId: tenant.id, deletedAt: null },
      select: { id: true, defectCode: true },
    });
    for (const d of defects) defectCodeById.set(d.id, d.defectCode);
  }

  // For entries without a FK, look up by description + vesselCode
  const unlinkedDescriptions: string[] = report.defectEntries
    .filter((e: any) => !e.defectId && e.description)
    .map((e: any) => e.description as string);

  const defectCodeByDesc = new Map<string, string>();
  if (unlinkedDescriptions.length > 0) {
    const matched = await (prisma as any).defect.findMany({
      where: {
        tenantId: tenant.id,
        vesselCode: report.vesselCode,
        description: { in: unlinkedDescriptions },
        deletedAt: null,
      },
      select: { description: true, defectCode: true },
      orderBy: { createdAt: "desc" },
    });
    for (const d of matched) {
      if (!defectCodeByDesc.has(d.description)) defectCodeByDesc.set(d.description, d.defectCode);
    }
  }

  report.defectEntries = report.defectEntries.map((e: any) => ({
    ...e,
    defectCode: e.defectId
      ? (defectCodeById.get(e.defectId) ?? null)
      : (defectCodeByDesc.get(e.description) ?? null),
  }));

  return report;
}

export async function upsertDailyEquipmentHours(
  session: TenantAccessSession,
  reportId: string,
  entries: Array<{
    id?: string;
    assetId?: string | null;
    equipmentLabel: string;
    runningHoursTotal?: number | null;
    fuelConsumptionLiters?: number | null;
    oilConsumptionLiters?: number | null;
    inService?: boolean | null;
    standby?: boolean | null;
    remarks?: string | null;
  }>,
) {
  // Escribir horas es una operación de carga, no de lectura: exige permiso y que el
  // reporte sea de un buque del usuario. Sin estos dos controles, cualquier usuario
  // autenticado (incluido AUDITOR_READONLY) podía escribir horas de cualquier buque
  // del tenant con sólo conocer el id del reporte.
  ensureCanWriteAssetHours(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const reportWhere: Record<string, unknown> = { id: reportId, tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, reportWhere);
  const report = await (prisma as any).dailyReport.findFirst({ where: reportWhere });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Reporte no encontrado.");

  await (prisma as any).dailyEquipmentHours.deleteMany({ where: { dailyReportId: reportId } });

  const results = [];
  for (const entry of entries) {
    results.push(await (prisma as any).dailyEquipmentHours.create({
      data: {
        tenantId: tenant.id,
        vesselCode: report.vesselCode,
        dailyReportId: reportId,
        assetId: entry.assetId ?? null,
        equipmentLabel: entry.equipmentLabel,
        runningHoursTotal: entry.runningHoursTotal ?? null,
        fuelConsumptionLiters: entry.fuelConsumptionLiters ?? null,
        oilConsumptionLiters: entry.oilConsumptionLiters ?? null,
        inService: entry.inService ?? null,
        standby: entry.standby ?? null,
        remarks: entry.remarks ?? null,
      },
    }));
  }

  // Las horas cargadas quedan asentadas como lecturas de horómetro (fecha = día del
  // parte), que es lo que el resto del sistema lee como "horas actuales". El escritor
  // único también avanza/siembra los planes por horas del equipo.
  const readingDate = ((report.reportDate as Date | null) ?? (report.createdAt as Date))
    .toISOString().slice(0, 10);
  try {
    await recordHoursReadings(
      session,
      entries
        .filter((e) => e.assetId && e.runningHoursTotal != null)
        .map((e) => ({ assetId: e.assetId!, runningHours: e.runningHoursTotal!, readingDate })),
      { source: "DAILY_REPORT", sourceRecordId: reportId, skipPermissionCheck: true },
    );
  } catch (err) {
    log.error("[daily-hours] registro de lecturas falló:", err);
  }

  return results;
}

export async function upsertDailyMaintenanceEntries(
  session: TenantAccessSession,
  reportId: string,
  entries: Array<{
    id?: string;
    assetId?: string | null;
    equipmentLabel?: string | null;
    taskTitle: string;
    taskType: "MAINTENANCE" | "INSPECTION";
    shortDescription?: string | null;
    performedBy?: string | null;
    maintenancePlanId?: string | null;
    workOrderId?: string | null;
    resultStatus: "COMPLETED" | "COMPLETED_WITH_OBSERVATIONS" | "NOT_COMPLETED" | "FOLLOW_UP_REQUIRED";
    followUpRequired?: boolean;
  }>,
) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const report = await (prisma as any).dailyReport.findFirst({
    where: { id: reportId, tenantId: tenant.id, deletedAt: null },
  });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Reporte no encontrado.");

  await (prisma as any).dailyMaintenanceEntry.deleteMany({ where: { dailyReportId: reportId } });

  const results = [];
  for (const entry of entries) {
    results.push(await (prisma as any).dailyMaintenanceEntry.create({
      data: {
        tenantId: tenant.id,
        vesselCode: report.vesselCode,
        dailyReportId: reportId,
        assetId: entry.assetId ?? null,
        equipmentLabel: entry.equipmentLabel ?? "",
        taskTitle: entry.taskTitle,
        taskType: entry.taskType as never,
        shortDescription: entry.shortDescription ?? null,
        performedBy: entry.performedBy ?? null,
        maintenancePlanId: entry.maintenancePlanId ?? null,
        workOrderId: entry.workOrderId ?? null,
        resultStatus: entry.resultStatus as never,
        followUpRequired: entry.followUpRequired ?? false,
      },
    }));
  }
  return results;
}

export async function upsertDailyDefectEntries(
  session: TenantAccessSession,
  reportId: string,
  entries: Array<{
    id?: string;
    affectedEquipmentId?: string | null;
    affectedEquipmentLabel?: string | null;
    description: string;
    severitySuggested?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
    immediateActionTaken?: string | null;
    followUpRequired?: boolean;
    defectId?: string | null;
  }>,
) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const report = await (prisma as any).dailyReport.findFirst({
    where: { id: reportId, tenantId: tenant.id, deletedAt: null },
  });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Reporte no encontrado.");

  await (prisma as any).dailyDefectEntry.deleteMany({ where: { dailyReportId: reportId } });

  const results = [];
  for (const entry of entries) {
    results.push(await (prisma as any).dailyDefectEntry.create({
      data: {
        tenantId: tenant.id,
        vesselCode: report.vesselCode,
        dailyReportId: reportId,
        affectedEquipmentId: entry.affectedEquipmentId ?? null,
        affectedEquipmentLabel: entry.affectedEquipmentLabel ?? null,
        description: entry.description,
        severitySuggested: (entry.severitySuggested ?? null) as never,
        immediateActionTaken: entry.immediateActionTaken ?? null,
        followUpRequired: entry.followUpRequired ?? false,
        defectId: entry.defectId ?? null,
      },
    }));
  }
  return results;
}

export async function upsertDailySpareUsages(
  session: TenantAccessSession,
  reportId: string,
  entries: Array<{
    id?: string;
    spareId?: string | null;
    spareName: string;
    quantity: number;
    unit: string;
    linkedEquipmentId?: string | null;
    linkedMaintenanceEntryId?: string | null;
    notes?: string | null;
  }>,
) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const report = await (prisma as any).dailyReport.findFirst({
    where: { id: reportId, tenantId: tenant.id, deletedAt: null },
  });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Reporte no encontrado.");

  await (prisma as any).dailySpareUsage.deleteMany({ where: { dailyReportId: reportId } });

  const results = [];
  for (const entry of entries) {
    results.push(await (prisma as any).dailySpareUsage.create({
      data: {
        tenantId: tenant.id,
        vesselCode: report.vesselCode,
        dailyReportId: reportId,
        spareId: entry.spareId ?? null,
        spareName: entry.spareName,
        quantity: entry.quantity,
        unit: entry.unit,
        linkedEquipmentId: entry.linkedEquipmentId ?? null,
        linkedMaintenanceEntryId: entry.linkedMaintenanceEntryId ?? null,
        notes: entry.notes ?? null,
      },
    }));
  }
  return results;
}
