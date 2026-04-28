import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface MaintenancePlanRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
  nextDueDate: Date | null;
  nextDueHours: number | null;
  windowOpenDate: Date | null;
  windowOpenHours: number | null;
  executionStatus: string;
  status: string;
  deletedAt: Date | null;
}

interface MaintenancePlanDelegate {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<MaintenancePlanRecord[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<MaintenancePlanRecord | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<MaintenancePlanRecord>;
}

interface ExecutionWindowsPrismaClient {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  maintenancePlan: MaintenancePlanDelegate;
}

function executionWindowsClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): ExecutionWindowsPrismaClient {
  return prisma as unknown as ExecutionWindowsPrismaClient;
}

function maintenancePlanDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): MaintenancePlanDelegate {
  return (prisma as unknown as { maintenancePlan: MaintenancePlanDelegate }).maintenancePlan;
}

function ensureCanWriteExecutionWindows(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "FLEET_SUPERINTENDENT" && session.user.role !== "MAINTENANCE_MANAGER") {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar execution windows.");
  }
}

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  return parsed;
}

function normalizeOptionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new RouteError(400, "VALIDATION_ERROR", `Valor numérico inválido en ${field}.`);
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function computeNextDueDate(plan: MaintenancePlanRecord, completedAt: Date): Date | null {
  if (plan.triggerType === "MONTHS" || plan.triggerType === "CALENDAR") {
    if (plan.frequencyMonths && plan.frequencyMonths > 0) {
      return addMonths(completedAt, plan.frequencyMonths);
    }
  }
  return null;
}

export function computeNextDueHours(plan: MaintenancePlanRecord, completedAtHours: number): number | null {
  if (plan.triggerType === "HOURS" || plan.triggerType === "RUNNING_HOURS") {
    if (plan.frequencyHours && plan.frequencyHours > 0) {
      return completedAtHours + plan.frequencyHours;
    }
  }
  return null;
}

function computeHoursExecutionStatus(plan: MaintenancePlanRecord, currentHours: number): string {
  if (plan.nextDueHours !== null && currentHours >= plan.nextDueHours) {
    return "OVERDUE";
  }
  if (plan.windowOpenHours !== null && currentHours >= plan.windowOpenHours) {
    return "IN_WINDOW";
  }
  if (
    plan.windowOpenHours === null &&
    plan.frequencyHours !== null &&
    plan.frequencyHours > 0 &&
    plan.nextDueHours !== null &&
    currentHours >= plan.nextDueHours - plan.frequencyHours * 0.1
  ) {
    return "UPCOMING";
  }
  return "FUTURE";
}

function computeDateExecutionStatus(plan: MaintenancePlanRecord, now: Date): string {
  if (!plan.nextDueDate) return plan.executionStatus;
  if (now > plan.nextDueDate) {
    return "OVERDUE";
  }
  if (plan.windowOpenDate !== null && now >= plan.windowOpenDate) {
    return "IN_WINDOW";
  }
  if (plan.windowOpenDate === null) {
    const daysUntilDue = (plan.nextDueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    if (daysUntilDue <= 30) return "UPCOMING";
  }
  return "FUTURE";
}

export async function refreshExecutionStatuses(tenantId: string, currentHours?: number): Promise<number> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return 0;
  const maintenancePlan = maintenancePlanDelegate(prismaRaw);

  const plans = await maintenancePlan.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  let updated = 0;
  const now = new Date();
  const hasCurrentHours = typeof currentHours === "number" && Number.isFinite(currentHours);

  for (const plan of plans) {
    if (plan.triggerType === "CONDITION" || plan.triggerType === "EVENT") continue;
    if (plan.status === "INACTIVE") continue;

    let nextStatus = plan.executionStatus;
    if (plan.triggerType === "HOURS" || plan.triggerType === "RUNNING_HOURS") {
      const hoursToUse = (plan as any).assetCurrentHours ?? currentHours;
      if (hoursToUse == null || !Number.isFinite(hoursToUse)) continue;
      nextStatus = computeHoursExecutionStatus(plan, hoursToUse as number);
    } else if (plan.triggerType === "MONTHS" || plan.triggerType === "CALENDAR") {
      nextStatus = computeDateExecutionStatus(plan, now);
    }

    if (nextStatus !== plan.executionStatus) {
      await maintenancePlan.update({
        where: { id: plan.id },
        data: { executionStatus: nextStatus },
      });
      updated += 1;
    }
  }

  return updated;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = executionWindowsClient(prismaRaw);
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

function applyVesselScope(
  session: TenantAccessSession,
  where: Record<string, unknown>,
  requestedVesselCode?: string | null,
  forbidOutOfScope = false,
) {
  if (session.user.role === "TENANT_ADMIN") {
    if (requestedVesselCode) where.vesselCode = requestedVesselCode;
    return;
  }

  if (requestedVesselCode) {
    if (!session.user.assignedVesselCodes.includes(requestedVesselCode)) {
      if (forbidOutOfScope) throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
      where.vesselCode = "__NO_ASSIGNED_VESSEL__";
      return;
    }
    where.vesselCode = requestedVesselCode;
    return;
  }

  if (session.user.assignedVesselCodes.length === 0) {
    where.vesselCode = "__NO_ASSIGNED_VESSEL__";
    return;
  }
  where.vesselCode = { in: session.user.assignedVesselCodes };
}

export async function openExecutionWindow(
  session: TenantAccessSession,
  planId: string,
  payload: { windowOpenDate?: Date | string | null; windowOpenHours?: number | null },
) {
  ensureCanWriteExecutionWindows(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const maintenancePlan = maintenancePlanDelegate(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const where: Record<string, unknown> = { id: planId, tenantId, deletedAt: null };
  applyVesselScope(session, where);
  const plan = await maintenancePlan.findFirst({ where });
  if (!plan) throw new RouteError(404, "NOT_FOUND", "Maintenance plan no encontrado.");

  const windowOpenDate = parseOptionalDate(payload.windowOpenDate, "windowOpenDate");
  const windowOpenHours = normalizeOptionalNumber(payload.windowOpenHours, "windowOpenHours");
  if (windowOpenDate === null && windowOpenHours === null) {
    throw new RouteError(400, "VALIDATION_ERROR", "Debes enviar windowOpenDate y/o windowOpenHours.");
  }

  const data: Record<string, unknown> = { windowMode: "MANUAL" };
  if (payload.windowOpenDate !== undefined) data.windowOpenDate = windowOpenDate;
  if (payload.windowOpenHours !== undefined) data.windowOpenHours = windowOpenHours;

  return maintenancePlan.update({
    where: { id: plan.id },
    data,
  });
}
