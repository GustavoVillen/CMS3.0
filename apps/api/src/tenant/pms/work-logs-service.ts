import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface WorkLogListFilters {
  vesselCode?: string | null;
  workOrderId?: string | null;
  maintenancePlanId?: string | null;
  assetId?: string | null;
  taskType?: string | null;
  result?: string | null;
}

export interface CreateWorkLogInput {
  vesselCode: string;
  workOrderId?: string | null;
  maintenancePlanId?: string | null;
  assetId: string;
  taskType: "MAINTENANCE" | "INSPECTION";
  result: "COMPLETED" | "COMPLETED_WITH_OBSERVATIONS" | "NOT_COMPLETED" | "FOLLOW_UP_REQUIRED";
  startedAt: string | Date;
  completedAt?: string | Date | null;
  executedByUserId?: string | null;
  executedByName: string;
  hoursWorked?: number | null;
  runningHoursAtExecution?: number | null;
  notes?: string | null;
  followUpRequired?: boolean;
}

interface WorkLogRecord {
  id: string;
  createdAt: Date;
}

interface WorkLogFullRecord {
  id: string;
  logCode: string;
  taskType: string;
  result: string;
  startedAt: Date;
  completedAt: Date | null;
  executedByName: string;
  notes: string | null;
  maintenancePlanId: string | null;
  workOrderId: string | null;
  assetId: string;
  createdAt: Date;
  maintenancePlan: { taskCode: string; title: string } | null;
}

type WorkLogDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }): Promise<WorkLogFullRecord[]>;
  create(args: { data: Record<string, unknown> }): Promise<WorkLogRecord>;
};

type WorkOrderLookupDelegate = {
  findFirst(args: { where: Record<string, unknown>; select?: Record<string, unknown> }): Promise<{ id: string } | null>;
};

type MaintenancePlanLookupDelegate = {
  findFirst(args: { where: Record<string, unknown>; select?: Record<string, unknown> }): Promise<{ id: string } | null>;
};

interface WorkLogsPrismaClient {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  workLog: WorkLogDelegate;
  workOrder: WorkOrderLookupDelegate;
  maintenancePlan: MaintenancePlanLookupDelegate;
}

function workLogsClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): WorkLogsPrismaClient {
  return prisma as unknown as WorkLogsPrismaClient;
}

function canCreateWorkLog(session: TenantAccessSession): boolean {
  return (
    session.user.role === "TENANT_ADMIN" ||
    session.user.role === "MAINTENANCE_MANAGER" ||
    session.user.role === "TECHNICIAN_OPERATOR"
  );
}

function ensureCanCreateWorkLog(session: TenantAccessSession) {
  if (!canCreateWorkLog(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para crear work logs.");
  }
}

function normalizeRequiredText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeOptionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new RouteError(400, "VALIDATION_ERROR", `Valor numérico inválido en ${field}.`);
}

function parseRequiredDate(value: unknown, field: string): Date {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  return parsed;
}

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  return parseRequiredDate(value, field);
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = workLogsClient(prismaRaw);
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

async function getTenantIdOrThrow(session: TenantAccessSession): Promise<string> {
  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenantId;
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

export async function listWorkLogs(session: TenantAccessSession, filters: WorkLogListFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return [];
  const prisma = workLogsClient(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.workOrderId) where.workOrderId = filters.workOrderId;
  if (filters.maintenancePlanId) where.maintenancePlanId = filters.maintenancePlanId;
  if (filters.assetId) where.assetId = filters.assetId;
  if (filters.taskType) where.taskType = filters.taskType;
  if (filters.result) where.result = filters.result;

  return prisma.workLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { maintenancePlan: { select: { taskCode: true, title: true } } },
  });
}

export async function createWorkLog(session: TenantAccessSession, payload: CreateWorkLogInput) {
  ensureCanCreateWorkLog(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workLogsClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);

  const workOrderId = normalizeOptionalText(payload.workOrderId);
  if (workOrderId) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, tenantId, vesselCode, deletedAt: null },
      select: { id: true },
    });
    if (!workOrder) {
      throw new RouteError(400, "WORK_ORDER_SCOPE_INVALID", "workOrderId inválido para el tenant/vessel actual.");
    }
  }

  const maintenancePlanId = normalizeOptionalText(payload.maintenancePlanId);
  if (maintenancePlanId) {
    const plan = await prisma.maintenancePlan.findFirst({
      where: { id: maintenancePlanId, tenantId, vesselCode, deletedAt: null },
      select: { id: true },
    });
    if (!plan) {
      throw new RouteError(400, "MAINTENANCE_PLAN_SCOPE_INVALID", "maintenancePlanId inválido para el tenant/vessel actual.");
    }
  }

  const result = payload.result;
  const followUpRequired = payload.followUpRequired ?? result === "FOLLOW_UP_REQUIRED";
  const logCode = `LOG-${vesselCode}-${Date.now()}`;

  return prisma.workLog.create({
    data: {
      tenantId,
      vesselCode,
      workOrderId,
      maintenancePlanId,
      assetId: normalizeRequiredText(payload.assetId, "assetId"),
      logCode,
      taskType: payload.taskType,
      result,
      startedAt: parseRequiredDate(payload.startedAt, "startedAt"),
      completedAt: parseOptionalDate(payload.completedAt, "completedAt"),
      executedByUserId: normalizeOptionalText(payload.executedByUserId) ?? session.user.id,
      executedByName: normalizeRequiredText(payload.executedByName, "executedByName"),
      hoursWorked: normalizeOptionalNumber(payload.hoursWorked, "hoursWorked"),
      runningHoursAtExecution: normalizeOptionalNumber(payload.runningHoursAtExecution, "runningHoursAtExecution"),
      notes: normalizeOptionalText(payload.notes),
      followUpRequired,
      createdByUserId: session.user.id,
    },
  });
}
