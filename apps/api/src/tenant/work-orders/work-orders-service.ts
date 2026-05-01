import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevWorkOrdersForTenant } from "../../platform/data/dev-domain-store";
import { RouteError } from "../../http/route-error";
import { recalculateNextDue, restorePlanAfterWoCancellation } from "../maintenance-plans/maintenance-plans-service";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { createDeferralInternal } from "../pms/deferrals-service";
import { createFluidSampleFromWorkOrder, type FluidType as FluidTypeEnum } from "../fluid-analyses/fluid-analyses-service";
import { log } from "../../common/logger";

export interface WorkOrderListFilters {
  vesselCode?: string | null;
  status?: string | null;
  type?: string | null;
  priority?: string | null;
  assignedToUserId?: string | null;
}

export interface CreateWorkOrderInput {
  vesselCode: string;
  assetId: string;
  type?: "PREVENTIVE" | "CORRECTIVE" | "INSPECTION";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  criticality?: "A" | "B" | "C";
  openDate?: string | Date;
  dueDate?: string | Date | null;
  title?: string | null;
  description?: string | null;
  assignedToUserId?: string | null;
  estimatedHours?: number | null;
  taskMasterId?: string | null;
  acceptanceCriteria?: string | null;
  loto?: string | null;
  riskLevel?: string | null;
  riskAnalysisResult?: string | null;
  department?: "CUBIERTA" | "MAQUINAS" | "BARCAZA" | "SERVICIOS" | null;
  location?: string | null;
  communicationMethod?: string[];
  distribution?: string[];
}

export interface UpdateWorkOrderInput {
  assetId?: string;
  type?: "PREVENTIVE" | "CORRECTIVE" | "INSPECTION";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  criticality?: "A" | "B" | "C";
  dueDate?: string | Date | null;
  title?: string | null;
  description?: string | null;
  assignedToUserId?: string | null;
  estimatedHours?: number | null;
  taskMasterId?: string | null;
  // Plan fields
  acceptanceCriteria?: string | null;
  loto?: string | null;
  riskLevel?: string | null;
  riskAnalysisResult?: string | null;
  checklistDocUrl?: string | null;
  // Result fields
  woResult?: string | null;
  executedByName?: string | null;
  completedDate?: string | Date | null;
  runningHoursAtExecution?: number | null;
  observations?: string | null;
  supportingDocUrl?: string | null;
  // Mercurio form fields
  department?: "CUBIERTA" | "MAQUINAS" | "BARCAZA" | "SERVICIOS" | null;
  location?: string | null;
  communicationMethod?: string[];
  distribution?: string[];
}

export interface HoldWorkOrderInput {
  holdReason: string;
  targetDate?: string | Date | null;
}

export interface CloseWorkOrderInput {
  woResult: "SATISFACTORY" | "WITH_DEFICIENCIES";
  executedByName?: string | null;
  completedDate?: string | Date | null;
  observations?: string | null;
  supportingDocUrl?: string | null;
  independentVerifier?: string | null;
  runningHoursAtExecution?: number | null;
  spareUsages?: Array<{ spareId: string; qty: number; unit: string }>;
}

export interface CancelWorkOrderInput {
  cancelReason: string;
}

interface WorkLogRecord {
  id: string;
  createdAt: Date;
}

interface WorkOrderRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  maintenancePlanId: string | null;
  workOrderCode: string;
  status: string;
  type: string;
  priority: string;
  openDate: Date;
  deletedAt: Date | null;
  workLogs?: WorkLogRecord[];
}

interface MaintenancePlanRecord {
  id: string;
  tenantId: string;
  triggerType: string;
  frequencyMonths: number | null;
  frequencyHours: number | null;
  lastExecutionHours: number | null;
}

type WorkOrderDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<WorkOrderRecord[]>;
  findFirst(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<WorkOrderRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<WorkOrderRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<WorkOrderRecord>;
};

type MaintenancePlanDelegate = {
  findFirst(args: { where: Record<string, unknown> }): Promise<MaintenancePlanRecord | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<MaintenancePlanRecord>;
};

interface WorkOrdersTx {
  workOrder: WorkOrderDelegate;
  maintenancePlan: MaintenancePlanDelegate;
}

interface WorkOrdersPrismaClient extends WorkOrdersTx {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  $transaction<T>(fn: (tx: WorkOrdersTx) => Promise<T>): Promise<T>;
}

function workOrdersClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): WorkOrdersPrismaClient {
  return prisma as unknown as WorkOrdersPrismaClient;
}

function canManageWorkOrders(session: TenantAccessSession): boolean {
  return session.user.role === "TENANT_ADMIN" || session.user.role === "FLEET_SUPERINTENDENT" || session.user.role === "MAINTENANCE_MANAGER";
}

function canOperateWorkOrders(session: TenantAccessSession): boolean {
  return canManageWorkOrders(session) || session.user.role === "TECHNICIAN_OPERATOR";
}

function ensureCanManageWorkOrders(session: TenantAccessSession) {
  if (!canManageWorkOrders(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar work orders.");
  }
}

function ensureCanOperateWorkOrders(session: TenantAccessSession) {
  if (!canOperateWorkOrders(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para operar work orders.");
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

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  return parsed;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = workOrdersClient(prismaRaw);
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

export async function listTenantWorkOrders(session: TenantAccessSession, filters: WorkOrderListFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) {
    const devItems = listDevWorkOrdersForTenant(
      session.tenantSlug,
      session.user.role,
      session.user.assignedVesselCodes,
      {
        vesselCode: filters.vesselCode,
        status: filters.status,
        type: filters.type,
      },
    );
    return devItems.filter((item) => {
      const priority = "priority" in item ? (item as unknown as { priority?: string }).priority : undefined;
      const assignedToUserId = "assignedToUserId" in item
        ? (item as unknown as { assignedToUserId?: string | null }).assignedToUserId
        : undefined;
      if (filters.priority && priority !== filters.priority) return false;
      if (filters.assignedToUserId && assignedToUserId !== filters.assignedToUserId) return false;
      return true;
    });
  }
  const prisma = workOrdersClient(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;
  if (filters.priority) where.priority = filters.priority;
  if (filters.assignedToUserId) where.assignedToUserId = filters.assignedToUserId;

  const orders = await prisma.workOrder.findMany({ where, orderBy: { openDate: "desc" } });

  const assetIds = [...new Set(orders.map(o => o.assetId).filter(Boolean))];
  const userIds  = [...new Set(orders.map(o => (o as unknown as { assignedToUserId?: string | null }).assignedToUserId).filter((v): v is string => !!v))];

  const [assetRows, userRows] = await Promise.all([
    assetIds.length > 0
      ? (prismaRaw as unknown as { asset: { findMany(a: unknown): Promise<{ id: string; name: string | null }[]> } }).asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string | null }[]),
    userIds.length > 0
      ? (prismaRaw as unknown as { user: { findMany(a: unknown): Promise<{ id: string; firstName: string | null; lastName: string | null }[]> } }).user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
      : Promise.resolve([] as { id: string; firstName: string | null; lastName: string | null }[]),
  ]);

  const assetNameMap = new Map(assetRows.map(a => [a.id, a.name ?? null]));
  const userNameMap  = new Map(userRows.map(u => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || null]));

  return orders.map(o => ({
    ...o,
    assetName: assetNameMap.get(o.assetId) ?? null,
    assignedToUserName: userNameMap.get((o as unknown as { assignedToUserId?: string | null }).assignedToUserId ?? "") ?? null,
  }));
}

export async function getTenantWorkOrder(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await prisma.workOrder.findFirst({
    where,
    include: { workLogs: { orderBy: { createdAt: "desc" } } },
  });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Work order no encontrada.");

  let assetName: string | null = null;
  try {
    const asset = await (prismaRaw as unknown as { asset: { findFirst: (a: unknown) => Promise<{ name: string | null } | null> } }).asset.findFirst({
      where: { id: record.assetId },
      select: { name: true },
    });
    assetName = asset?.name ?? null;
  } catch { /* non-blocking */ }

  return { ...record, assetName };
}

export async function createTenantWorkOrder(session: TenantAccessSession, payload: CreateWorkOrderInput) {
  ensureCanManageWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const existingCount = await prismaRaw.workOrder.count({ where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
  const workOrderCode = `WO-${vesselCode}-${yy}-${String(existingCount + 1).padStart(4, "0")}`;

  const created = await prisma.workOrder.create({
    data: {
      tenantId,
      vesselCode,
      assetId: normalizeRequiredText(payload.assetId, "assetId"),
      maintenancePlanId: null,
      workOrderCode,
      type: payload.type ?? "PREVENTIVE",
      status: "PLANNED",
      priority: payload.priority ?? "MEDIUM",
      criticality: payload.criticality ?? "B",
      openDate: parseOptionalDate(payload.openDate, "openDate") ?? new Date(),
      dueDate: parseOptionalDate(payload.dueDate, "dueDate"),
      title: normalizeOptionalText(payload.title),
      description: normalizeOptionalText(payload.description),
      assignedToUserId: normalizeOptionalText(payload.assignedToUserId),
      estimatedHours: normalizeOptionalNumber(payload.estimatedHours, "estimatedHours"),
      taskMasterId: normalizeOptionalText(payload.taskMasterId),
      acceptanceCriteria: normalizeOptionalText(payload.acceptanceCriteria),
      loto: normalizeOptionalText(payload.loto),
      riskLevel: normalizeOptionalText(payload.riskLevel),
      riskAnalysisResult: normalizeOptionalText(payload.riskAnalysisResult),
      department: payload.department ?? null,
      location: normalizeOptionalText(payload.location),
      communicationMethod: payload.communicationMethod ?? [],
      distribution: payload.distribution ?? [],
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prismaRaw, {
    tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.created",
    entityType: "WorkOrder",
    entityId: created.id,
    metadata: { workOrderCode, vesselCode, type: created.type },
  });
  return created;
}

export async function updateTenantWorkOrder(session: TenantAccessSession, id: string, payload: UpdateWorkOrderInput) {
  ensureCanManageWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.assetId !== undefined) data.assetId = normalizeRequiredText(payload.assetId, "assetId");
  if (payload.type !== undefined) data.type = payload.type;
  if (payload.priority !== undefined) data.priority = payload.priority;
  if (payload.criticality !== undefined) data.criticality = payload.criticality;
  if (payload.dueDate !== undefined) data.dueDate = parseOptionalDate(payload.dueDate, "dueDate");
  if (payload.title !== undefined) data.title = normalizeOptionalText(payload.title);
  if (payload.description !== undefined) data.description = normalizeOptionalText(payload.description);
  if (payload.assignedToUserId !== undefined) data.assignedToUserId = normalizeOptionalText(payload.assignedToUserId);
  if (payload.estimatedHours !== undefined) data.estimatedHours = normalizeOptionalNumber(payload.estimatedHours, "estimatedHours");
  if (payload.taskMasterId !== undefined) data.taskMasterId = normalizeOptionalText(payload.taskMasterId);
  if (payload.acceptanceCriteria !== undefined) data.acceptanceCriteria = normalizeOptionalText(payload.acceptanceCriteria);
  if (payload.loto !== undefined) data.loto = normalizeOptionalText(payload.loto);
  if (payload.riskLevel !== undefined) data.riskLevel = normalizeOptionalText(payload.riskLevel);
  if (payload.riskAnalysisResult !== undefined) data.riskAnalysisResult = normalizeOptionalText(payload.riskAnalysisResult);
  if (payload.checklistDocUrl !== undefined) data.checklistDocUrl = normalizeOptionalText(payload.checklistDocUrl);
  if (payload.woResult !== undefined) data.woResult = normalizeOptionalText(payload.woResult);
  if (payload.executedByName !== undefined) data.executedByName = normalizeOptionalText(payload.executedByName);
  if (payload.completedDate !== undefined) data.completedDate = parseOptionalDate(payload.completedDate, "completedDate");
  if (payload.runningHoursAtExecution !== undefined) data.runningHoursAtExecution = payload.runningHoursAtExecution ?? null;
  if (payload.observations !== undefined) data.observations = normalizeOptionalText(payload.observations);
  if (payload.supportingDocUrl !== undefined) data.supportingDocUrl = normalizeOptionalText(payload.supportingDocUrl);
  if (payload.department !== undefined) data.department = payload.department ?? null;
  if (payload.location !== undefined) data.location = normalizeOptionalText(payload.location);
  if (payload.communicationMethod !== undefined) data.communicationMethod = payload.communicationMethod;
  if (payload.distribution !== undefined) data.distribution = payload.distribution;

  return prisma.workOrder.update({ where: { id: current.id }, data });
}

export async function startWorkOrder(session: TenantAccessSession, id: string) {
  ensureCanOperateWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  if (current.status !== "PLANNED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo PLANNED puede pasar a IN_PROGRESS (actual: ${current.status}).`);
  }

  const started = await prisma.workOrder.update({
    where: { id: current.id },
    data: { status: "IN_PROGRESS", startDate: new Date(), updatedByUserId: session.user.id },
  });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.started",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: { workOrderCode: current.workOrderCode, vesselCode: current.vesselCode },
  });
  return started;
}

export async function holdWorkOrder(session: TenantAccessSession, id: string, payload: HoldWorkOrderInput) {
  ensureCanOperateWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  if (current.status !== "PLANNED" && current.status !== "IN_PROGRESS") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo PLANNED o IN_PROGRESS pueden pasar a ON_HOLD (actual: ${current.status}).`);
  }

  const held = await prisma.workOrder.update({
    where: { id: current.id },
    data: { status: "ON_HOLD", holdReason: normalizeRequiredText(payload.holdReason, "holdReason"), updatedByUserId: session.user.id },
  });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.held",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: { workOrderCode: current.workOrderCode, vesselCode: current.vesselCode, holdReason: payload.holdReason },
  });
  void createDeferralInternal(session, {
    vesselCode: current.vesselCode,
    assetId: current.assetId,
    sourceType: "WORK_ORDER",
    sourceId: current.id,
    justification: payload.holdReason,
    targetDate: payload.targetDate ?? null,
  }).catch((err: unknown) => { log.error("[holdWorkOrder] auto-deferral failed:", err); });
  return held;
}

export async function closeWorkOrder(session: TenantAccessSession, id: string, payload: CloseWorkOrderInput) {
  ensureCanOperateWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  if (current.status !== "IN_PROGRESS" && current.status !== "ON_HOLD" && current.status !== "PLANNED") {
    throw new RouteError(
      409,
      "INVALID_STATUS_TRANSITION",
      `Solo PLANNED, IN_PROGRESS u ON_HOLD pueden pasar a CLOSED (actual: ${current.status}).`,
    );
  }

  if (!payload.woResult) throw new RouteError(400, "VALIDATION_ERROR", "El resultado de la OT es requerido.");

  const completedDate = parseOptionalDate(payload.completedDate, "completedDate") ?? new Date();

  let samplingFluidType: string | null = null;
  let samplingPlanId: string | null = null;

  const closedResult = await prisma.$transaction(async (tx) => {
    const startDate = current.status === "PLANNED" ? completedDate : undefined;
    const closed = await tx.workOrder.update({
      where: { id: current.id },
      data: {
        status: "CLOSED",
        ...(startDate ? { startDate } : {}),
        completedDate,
        woResult: payload.woResult,
        executedByName: normalizeOptionalText(payload.executedByName),
        observations: normalizeOptionalText(payload.observations),
        closeNotes: normalizeOptionalText(payload.observations),
        independentVerifier: normalizeOptionalText(payload.independentVerifier),
        supportingDocUrl: normalizeOptionalText(payload.supportingDocUrl),
        runningHoursAtExecution: payload.runningHoursAtExecution ?? null,
        updatedByUserId: session.user.id,
      },
    });

    if (current.maintenancePlanId) {
      const plan = await tx.maintenancePlan.findFirst({
        where: { id: current.maintenancePlanId, tenantId: current.tenantId, deletedAt: null },
      });
      if (plan) {
        const executionHours = payload.runningHoursAtExecution ?? plan.lastExecutionHours;
        const nextDue = recalculateNextDue(
          {
            triggerType: plan.triggerType,
            frequencyMonths: plan.frequencyMonths,
            frequencyHours: plan.frequencyHours,
          },
          completedDate,
          executionHours,
        );
        await tx.maintenancePlan.update({
          where: { id: plan.id },
          data: {
            lastExecutionDate: completedDate,
            lastExecutionHours: payload.runningHoursAtExecution ?? plan.lastExecutionHours,
            nextDueDate: nextDue.nextDueDate,
            nextDueHours: nextDue.nextDueHours,
            executionStatus: "COMPLETED",
            updatedByUserId: session.user.id,
          },
        });
        // Capture sampling info for post-commit auto-creation of FluidSample
        if ((plan as any).samplingFluidType) {
          samplingFluidType = (plan as any).samplingFluidType;
          samplingPlanId = plan.id;
        }
      }
    }

    return closed;
  });
  const failedMovements: string[] = [];
  if (payload.spareUsages && payload.spareUsages.length > 0) {
    const smDelegate = (prismaRaw as unknown as { stockMovement: { create(a: unknown): Promise<unknown> } }).stockMovement;
    for (const usage of payload.spareUsages) {
      try {
        await smDelegate.create({
          data: {
            tenantId: current.tenantId,
            vesselCode: current.vesselCode,
            spareId: usage.spareId,
            movementCode: `MOV-${current.vesselCode}-${Date.now()}`,
            movementType: "ISSUE",
            quantity: usage.qty,
            unit: usage.unit,
            occurredAt: completedDate,
            referenceType: "WORK_ORDER",
            referenceId: current.id,
            notes: `Utilizado en OT ${current.workOrderCode}`,
            createdByUserId: session.user.id,
          },
        });
      } catch (err) {
        log.error("[closeWorkOrder] stock movement failed for spare", usage.spareId, err);
        failedMovements.push(usage.spareId);
      }
    }
  }

  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.closed",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: { workOrderCode: current.workOrderCode, vesselCode: current.vesselCode, woResult: payload.woResult },
  });

  // Auto-create FluidSample DRAFT if the plan was a fluid sampling plan
  let createdFluidSampleId: string | null = null;
  if (samplingFluidType) {
    try {
      createdFluidSampleId = await createFluidSampleFromWorkOrder({
        tenantId:        current.tenantId,
        vesselCode:      current.vesselCode,
        assetId:         current.assetId,
        fluidType:       samplingFluidType as FluidTypeEnum,
        workOrderId:     current.id,
        workOrderCode:   current.workOrderCode,
        planId:          samplingPlanId,
        runningHours:    payload.runningHoursAtExecution ?? null,
        completedAt:     completedDate,
        createdByUserId: session.user.id,
      });
    } catch (err) {
      log.error("[closeWorkOrder] auto-create FluidSample failed", err);
    }
  }

  return { ...closedResult, failedMovements, createdFluidSampleId };
}

export async function cancelWorkOrder(session: TenantAccessSession, id: string, payload: CancelWorkOrderInput) {
  ensureCanManageWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  if (current.status !== "PLANNED" && current.status !== "ON_HOLD") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo PLANNED u ON_HOLD pueden pasar a CANCELLED (actual: ${current.status}).`);
  }

  const cancelled = await prisma.workOrder.update({
    where: { id: current.id },
    data: { status: "CANCELLED", cancelReason: normalizeRequiredText(payload.cancelReason, "cancelReason"), updatedByUserId: session.user.id },
  });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.cancelled",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: { workOrderCode: current.workOrderCode, vesselCode: current.vesselCode, cancelReason: payload.cancelReason },
  });
  if (current.maintenancePlanId) {
    void restorePlanAfterWoCancellation(session, current.maintenancePlanId)
      .catch((err: unknown) => { log.error("[cancelWorkOrder] plan restore failed:", err); });
  }
  return cancelled;
}
