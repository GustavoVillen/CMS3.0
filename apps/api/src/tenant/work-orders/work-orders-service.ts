import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevWorkOrdersForTenant } from "../../platform/data/dev-domain-store";
import { RouteError } from "../../http/route-error";
import { recalculateNextDue, restorePlanAfterWoCancellation } from "../maintenance-plans/maintenance-plans-service";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { createDeferralInternal } from "../pms/deferrals-service";
import { createFluidSampleFromWorkOrder, type FluidType as FluidTypeEnum } from "../fluid-analyses/fluid-analyses-service";
import { log } from "../../common/logger";
import { assertNotLocked, assertCanReopen, assertReopenReason } from "../../common/record-lock";
import { withUniqueRetry } from "../../common/unique-retry";

export interface WorkOrderListFilters {
  vesselCode?: string | null;
  status?: string | null;
  type?: string | null;
  priority?: string | null;
  assignedToUserId?: string | null;
  assetId?: string | null;
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
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
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
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
  // Result fields
  woResult?: string | null;
  executedByName?: string | null;
  completedDate?: string | Date | null;
  runningHoursAtExecution?: number | null;
  actualHours?: number | null;
  observations?: string | null;
  supportingDocUrl?: string | null;
  // Mercurio form fields
  department?: "CUBIERTA" | "MAQUINAS" | "BARCAZA" | "SERVICIOS" | null;
  location?: string | null;
  communicationMethod?: string[];
  distribution?: string[];
  // Spare usages — replaces previous ISSUE movements for this WO
  spareUsages?: Array<{ spareId: string; qty: number; unit: string }>;
}

export interface HoldWorkOrderInput {
  holdReason: string;
  targetDate?: string | Date | null;
  compensatoryMeasures?: string | null;
}

export interface CloseWorkOrderInput {
  woResult: "SATISFACTORY" | "WITH_DEFICIENCIES";
  executedByName?: string | null;
  completedDate?: string | Date | null;
  observations?: string | null;
  supportingDocUrl?: string | null;
  independentVerifier?: string | null;
  runningHoursAtExecution?: number | null;
  actualHours?: number | null;
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

/**
 * Crear OT: permitido a TODOS los roles del tenant salvo AUDITOR_READONLY.
 * La creación es un punto de entrada operativo (especialmente desde defectos
 * detectados a bordo); restringirla bloqueaba flujos legítimos.
 *
 * Editar/cancelar/cerrar siguen siendo más restrictivos (canManageWorkOrders
 * / canOperateWorkOrders) — sólo se afloja la creación.
 */
function canCreateWorkOrders(session: TenantAccessSession): boolean {
  return session.user.role !== "AUDITOR_READONLY";
}

function ensureCanManageWorkOrders(session: TenantAccessSession) {
  if (!canManageWorkOrders(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar work orders.");
  }
}

function ensureCanCreateWorkOrders(session: TenantAccessSession) {
  if (!canCreateWorkOrders(session)) {
    throw new RouteError(403, "FORBIDDEN", "Los usuarios solo-lectura no pueden crear órdenes de trabajo.");
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
      const assetId = "assetId" in item ? (item as unknown as { assetId?: string | null }).assetId : undefined;
      if (filters.priority && priority !== filters.priority) return false;
      if (filters.assignedToUserId && assignedToUserId !== filters.assignedToUserId) return false;
      if (filters.assetId && assetId !== filters.assetId) return false;
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
  if (filters.assetId) where.assetId = filters.assetId;

  const orders = await prisma.workOrder.findMany({ where, orderBy: { openDate: "desc" } });

  const assetIds = [...new Set(orders.map(o => o.assetId).filter(Boolean))];
  const userIds  = [...new Set(orders.map(o => (o as unknown as { assignedToUserId?: string | null }).assignedToUserId).filter((v): v is string => !!v))];

  const [assetRows, userRows] = await Promise.all([
    assetIds.length > 0
      ? (prismaRaw as unknown as { asset: { findMany(a: unknown): Promise<{ id: string; name: string | null }[]> } }).asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, name: true } })
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
      where: { id: record.assetId, tenantId },
      select: { name: true },
    });
    assetName = asset?.name ?? null;
  } catch { /* non-blocking */ }

  // Reconstruct spare usages from stock movements scoped to this WO
  const spareUsages: Array<{ spareId: string; qty: number; unit: string; sku: string; name: string; criticality: string }> = [];
  try {
    const movements = await (prismaRaw as any).stockMovement.findMany({
      where: { tenantId, referenceType: "WORK_ORDER", referenceId: record.id },
      select: { spareId: true, quantity: true, unit: true },
      orderBy: { occurredAt: "asc" },
    });
    if (movements.length > 0) {
      const spareIds = [...new Set(movements.map((m: any) => m.spareId).filter(Boolean))] as string[];
      const spares = await (prismaRaw as any).spare.findMany({
        where: { id: { in: spareIds }, tenantId },
        select: { id: true, sku: true, name: true, criticality: true },
      });
      const spareMap = new Map<string, { sku: string; name: string; criticality: string }>(
        spares.map((s: any) => [s.id, { sku: s.sku, name: s.name, criticality: s.criticality }]),
      );
      for (const m of movements as any[]) {
        const meta = spareMap.get(m.spareId) ?? { sku: m.spareId, name: m.spareId, criticality: "C" };
        spareUsages.push({
          spareId: m.spareId,
          qty: Number(m.quantity),
          unit: m.unit,
          sku: meta.sku,
          name: meta.name,
          criticality: meta.criticality,
        });
      }
    }
  } catch { /* non-blocking */ }

  return { ...record, assetName, spareUsages };
}

export async function createTenantWorkOrder(session: TenantAccessSession, payload: CreateWorkOrderInput) {
  ensureCanCreateWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);
  const assetId = normalizeRequiredText(payload.assetId, "assetId");

  // Validar tenant ownership de assetId.
  const assetCount = await (prismaRaw as any).asset.count({
    where: { id: assetId, tenantId, deletedAt: null },
  });
  if (assetCount === 0) {
    throw new RouteError(404, "ASSET_NOT_FOUND", "Asset no encontrado o no pertenece a este tenant.");
  }

  // Validar tenant ownership de taskMasterId (cross-reference cross-tenant
  // sería un data-integrity issue: la WO referenciaría un task de otro tenant).
  const taskMasterId = normalizeOptionalText(payload.taskMasterId);
  if (taskMasterId) {
    const tmCount = await (prismaRaw as any).taskMaster.count({
      where: { id: taskMasterId, OR: [{ tenantId }, { isGlobal: true }] },
    });
    if (tmCount === 0) {
      throw new RouteError(404, "TASK_MASTER_NOT_FOUND", "TaskMaster no encontrado o no pertenece a este tenant.");
    }
  }

  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);

  // Race protection con @@unique(workOrderCode): retry en P2002.
  const created = await withUniqueRetry(async (attempt) => {
    const existingCount = await prismaRaw.workOrder.count({ where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
    const workOrderCode = `WO-${vesselCode}-${yy}-${String(existingCount + 1 + attempt).padStart(4, "0")}`;
    return prisma.workOrder.create({
      data: {
        tenantId,
        vesselCode,
        assetId,
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
        taskMasterId,
        acceptanceCriteria: normalizeOptionalText(payload.acceptanceCriteria),
        loto: normalizeOptionalText(payload.loto),
        riskLevel: normalizeOptionalText(payload.riskLevel),
        riskAnalysisResult: normalizeOptionalText(payload.riskAnalysisResult),
        consequenceCategory: payload.consequenceCategory ?? null,
        consequenceRationale: normalizeOptionalText(payload.consequenceRationale),
        department: payload.department ?? null,
        location: normalizeOptionalText(payload.location),
        communicationMethod: payload.communicationMethod ?? [],
        distribution: payload.distribution ?? [],
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
      },
    });
  });
  void publishAudit(prismaRaw, {
    tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.created",
    entityType: "WorkOrder",
    entityId: created.id,
    metadata: { workOrderCode: created.workOrderCode, vesselCode, type: created.type },
  });
  return created;
}

/**
 * Replace spare-usage stock movements for a WO. Deletes previous ISSUE
 * movements scoped to this WO (referenceType=WORK_ORDER, referenceId=woId)
 * and creates new ones from the supplied list.
 *
 * Used both by save and close — ensures repeated saves don't duplicate.
 */
async function applySpareUsagesToWo(
  prismaRaw: NonNullable<ReturnType<typeof getPrismaClient>>,
  wo: { id: string; tenantId: string; vesselCode: string; workOrderCode: string },
  usages: Array<{ spareId: string; qty: number; unit: string }>,
  occurredAt: Date,
  actorUserId: string,
): Promise<{ failedMovements: string[] }> {
  const smDelegate = (prismaRaw as unknown as {
    stockMovement: {
      deleteMany(a: unknown): Promise<{ count: number }>;
      create(a: unknown): Promise<unknown>;
    };
  }).stockMovement;

  await smDelegate.deleteMany({
    where: { tenantId: wo.tenantId, referenceType: "WORK_ORDER", referenceId: wo.id },
  });

  // Validar que todos los spareIds pertenecen al tenant. Sin esto, un user
  // podría inyectar IDs cross-tenant y crear stock movements con spareIds
  // que no le pertenecen — corrupción de datos.
  const proposedIds = [...new Set(usages.map(u => u.spareId).filter(Boolean))];
  const validIds = new Set<string>();
  if (proposedIds.length > 0) {
    const valid = await (prismaRaw as any).spare.findMany({
      where: { id: { in: proposedIds }, tenantId: wo.tenantId, deletedAt: null },
      select: { id: true },
    });
    for (const s of valid as Array<{ id: string }>) validIds.add(s.id);
  }

  const failedMovements: string[] = [];
  for (const usage of usages) {
    if (!usage.spareId || !usage.qty || usage.qty <= 0) continue;
    if (!validIds.has(usage.spareId)) {
      failedMovements.push(usage.spareId);
      continue;
    }
    try {
      await smDelegate.create({
        data: {
          tenantId: wo.tenantId,
          vesselCode: wo.vesselCode,
          spareId: usage.spareId,
          movementCode: `MOV-${wo.vesselCode}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          movementType: "ISSUE",
          quantity: usage.qty,
          unit: usage.unit,
          occurredAt,
          referenceType: "WORK_ORDER",
          referenceId: wo.id,
          notes: `Utilizado en OT ${wo.workOrderCode}`,
          createdByUserId: actorUserId,
        },
      });
    } catch (err) {
      log.error("[applySpareUsagesToWo] stock movement failed for spare", usage.spareId, err);
      failedMovements.push(usage.spareId);
    }
  }
  return { failedMovements };
}

export async function updateTenantWorkOrder(session: TenantAccessSession, id: string, payload: UpdateWorkOrderInput) {
  ensureCanManageWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  // Lockdown vetting: una OT CLOSED/CANCELLED no se edita.
  // Para corregirla hace falta /reopen explícito por TENANT_ADMIN.
  assertNotLocked("WORK_ORDER", current.status);

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
  if (payload.consequenceCategory !== undefined) data.consequenceCategory = payload.consequenceCategory ?? null;
  if (payload.consequenceRationale !== undefined) data.consequenceRationale = normalizeOptionalText(payload.consequenceRationale);
  if (payload.woResult !== undefined) data.woResult = normalizeOptionalText(payload.woResult);
  if (payload.executedByName !== undefined) data.executedByName = normalizeOptionalText(payload.executedByName);
  if (payload.completedDate !== undefined) data.completedDate = parseOptionalDate(payload.completedDate, "completedDate");
  if (payload.runningHoursAtExecution !== undefined) data.runningHoursAtExecution = payload.runningHoursAtExecution ?? null;
  if (payload.actualHours !== undefined) data.actualHours = payload.actualHours ?? null;
  if (payload.observations !== undefined) data.observations = normalizeOptionalText(payload.observations);
  if (payload.supportingDocUrl !== undefined) data.supportingDocUrl = normalizeOptionalText(payload.supportingDocUrl);
  if (payload.department !== undefined) data.department = payload.department ?? null;
  if (payload.location !== undefined) data.location = normalizeOptionalText(payload.location);
  if (payload.communicationMethod !== undefined) data.communicationMethod = payload.communicationMethod;
  if (payload.distribution !== undefined) data.distribution = payload.distribution;

  const updated = await prisma.workOrder.update({ where: { id: current.id }, data });

  if (payload.spareUsages !== undefined) {
    await applySpareUsagesToWo(
      prismaRaw,
      { id: current.id, tenantId: current.tenantId, vesselCode: current.vesselCode, workOrderCode: current.workOrderCode },
      payload.spareUsages,
      new Date(),
      session.user.id,
    );
  }

  return updated;
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
  let deferralId: string | null = null;
  try {
    const created = await createDeferralInternal(session, {
      vesselCode: current.vesselCode,
      assetId: current.assetId,
      sourceType: "WORK_ORDER",
      sourceId: current.id,
      justification: payload.holdReason,
      targetDate: payload.targetDate ?? null,
      compensatoryMeasures: payload.compensatoryMeasures ?? null,
    });
    deferralId = created.id;
  } catch (err) {
    log.error("[holdWorkOrder] auto-deferral failed:", err);
  }
  return { ...held, deferralId };
}

/**
 * Reanuda una OT en espera: ON_HOLD → IN_PROGRESS.
 * Resuelve el diferimiento vinculado según su estado:
 *   - REQUESTED / UNDER_REVIEW → cancelar (soft-delete)
 *   - APPROVED / ACTIVE        → cerrar (status CLOSED)
 */
export async function resumeWorkOrder(session: TenantAccessSession, id: string) {
  ensureCanOperateWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  if (current.status !== "ON_HOLD") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo ON_HOLD puede pasar a IN_PROGRESS vía resume (actual: ${current.status}).`);
  }

  const resumed = await prisma.workOrder.update({
    where: { id: current.id },
    data: { status: "IN_PROGRESS", holdReason: null, updatedByUserId: session.user.id },
  });

  // Resolver diferimiento vinculado según su estado
  try {
    const deferralDelegate = (prismaRaw as unknown as {
      deferral: {
        findFirst(a: unknown): Promise<{ id: string; status: string } | null>;
        update(a: unknown): Promise<unknown>;
      };
    }).deferral;
    const linked = await deferralDelegate.findFirst({
      where: {
        sourceType: "WORK_ORDER",
        sourceId: current.id,
        deletedAt: null,
        status: { in: ["REQUESTED", "UNDER_REVIEW", "APPROVED", "ACTIVE"] },
      },
    });
    if (linked) {
      const now = new Date();
      if (linked.status === "REQUESTED" || linked.status === "UNDER_REVIEW") {
        // Cancelar: soft-delete
        await deferralDelegate.update({
          where: { id: linked.id },
          data: { deletedAt: now, deletedByUserId: session.user.id, updatedByUserId: session.user.id },
        });
      } else {
        // APPROVED o ACTIVE: cerrar
        await deferralDelegate.update({
          where: { id: linked.id },
          data: {
            status: "CLOSED",
            closedAt: now,
            closeNotes: "Cerrado al reanudar la OT.",
            updatedByUserId: session.user.id,
          },
        });
      }
    }
  } catch (err) {
    log.error("[resumeWorkOrder] failed to handle linked deferral:", err);
  }

  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.resumed",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: { workOrderCode: current.workOrderCode, vesselCode: current.vesselCode },
  });
  return resumed;
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

  let samplingKind:      string | null = null;
  let samplingFluidType: string | null = null;
  let samplingPlanId:    string | null = null;

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
        actualHours: payload.actualHours ?? null,
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
        // Capture sampling info for post-commit auto-creation of Sample.
        // samplingKind disparador del auto-create. Si solo está samplingFluidType
        // (datos heredados pre-CBM), inferimos kind=FLUID por compatibilidad.
        const planKind      = (plan as any).samplingKind as string | null;
        const planFluidType = (plan as any).samplingFluidType as string | null;
        if (planKind || planFluidType) {
          samplingKind      = planKind || "FLUID";
          samplingFluidType = planFluidType;
          samplingPlanId    = plan.id;
        }
      }
    }

    return closed;
  });
  let failedMovements: string[] = [];
  if (payload.spareUsages !== undefined) {
    const result = await applySpareUsagesToWo(
      prismaRaw,
      { id: current.id, tenantId: current.tenantId, vesselCode: current.vesselCode, workOrderCode: current.workOrderCode },
      payload.spareUsages,
      completedDate,
      session.user.id,
    );
    failedMovements = result.failedMovements;
  }

  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.closed",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: { workOrderCode: current.workOrderCode, vesselCode: current.vesselCode, woResult: payload.woResult },
  });

  // Cerrar aplazamientos asociados a esta OT (sourceType=WORK_ORDER, sourceId=woId)
  // en cualquier estado no-terminal. Estados terminales (REJECTED, EXPIRED, CLOSED)
  // se omiten porque ya están finalizados.
  // Cuando se aplaza una OT, el aplazamiento queda colgado aunque después se ejecute
  // la OT; al cerrar la OT, ese aplazamiento ya no tiene sentido y debe quedar CLOSED.
  try {
    const deferralDelegateLocal = (prismaRaw as unknown as {
      deferral: {
        findMany(a: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{ id: string; deferralCode: string; status: string }[]>;
        update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
      };
    }).deferral;
    const openDeferrals = await deferralDelegateLocal.findMany({
      where: {
        tenantId: current.tenantId,
        sourceType: "WORK_ORDER",
        sourceId: current.id,
        status: { notIn: ["CLOSED", "REJECTED", "EXPIRED"] },
        deletedAt: null,
      },
      select: { id: true, deferralCode: true, status: true },
    });
    for (const d of openDeferrals) {
      await deferralDelegateLocal.update({
        where: { id: d.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closeNotes: `Cerrado automáticamente al cerrar la OT ${current.workOrderCode} (estado previo: ${d.status}).`,
          updatedByUserId: session.user.id,
        },
      });
      void publishAudit(prismaRaw, {
        tenantId: current.tenantId,
        actorUserId: session.user.id,
        action: "Deferral.closed",
        entityType: "Deferral",
        entityId: d.id,
        metadata: { deferralCode: d.deferralCode, vesselCode: current.vesselCode, autoClosedBy: "WORK_ORDER_CLOSED", previousStatus: d.status, workOrderCode: current.workOrderCode },
      });
    }
  } catch (err) {
    log.error("[closeWorkOrder] failed to auto-close associated deferrals:", err);
  }

  // Auto-create Sample DRAFT si el plan era un plan de muestreo (cualquier kind).
  let createdFluidSampleId: string | null = null;
  if (samplingKind) {
    try {
      createdFluidSampleId = await createFluidSampleFromWorkOrder({
        tenantId:        current.tenantId,
        vesselCode:      current.vesselCode,
        assetId:         current.assetId,
        kind:            samplingKind as "FLUID" | "VIBRATION" | "THERMAL" | "ULTRASOUND" | "OTHER",
        fluidType:       samplingFluidType as FluidTypeEnum | null,
        workOrderId:     current.id,
        workOrderCode:   current.workOrderCode,
        planId:          samplingPlanId,
        runningHours:    payload.runningHoursAtExecution ?? null,
        completedAt:     completedDate,
        createdByUserId: session.user.id,
      });
    } catch (err) {
      log.error("[closeWorkOrder] auto-create Sample failed", err);
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
  if (current.status === "CLOSED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", "Esta OT ya está cerrada. Solo TENANT_ADMIN puede re-abrirla con justificación.");
  }
  if (current.status === "CANCELLED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", "Esta OT ya fue cancelada.");
  }
  if (current.status === "IN_PROGRESS") {
    // Permitir cancelar IN_PROGRESS solo si NO hay trabajo registrado todavía
    const delegates = prismaRaw as unknown as {
      workLog: { count(a: { where: Record<string, unknown> }): Promise<number> };
      workOrderProgressNote: { count(a: { where: Record<string, unknown> }): Promise<number> };
      stockMovement: { count(a: { where: Record<string, unknown> }): Promise<number> };
    };
    const [workLogCount, progressNoteCount, stockMovementCount] = await Promise.all([
      delegates.workLog.count({ where: { workOrderId: current.id } }),
      delegates.workOrderProgressNote.count({ where: { workOrderId: current.id } }),
      delegates.stockMovement.count({ where: { referenceType: "WORK_ORDER", referenceId: current.id } }),
    ]);
    if (workLogCount > 0 || progressNoteCount > 0 || stockMovementCount > 0) {
      const parts: string[] = [];
      if (workLogCount > 0) parts.push(`${workLogCount} registro(s) de trabajo`);
      if (progressNoteCount > 0) parts.push(`${progressNoteCount} nota(s) de avance`);
      if (stockMovementCount > 0) parts.push(`${stockMovementCount} movimiento(s) de stock`);
      throw new RouteError(
        409,
        "INVALID_STATUS_TRANSITION",
        `Esta OT ya tiene trabajo registrado (${parts.join(", ")}). Cancelarla rompería la trazabilidad. Para finalizarla, cerrala con resultado (ej. "No completada") o pasala a En Espera primero.`,
      );
    }
  } else if (current.status !== "PLANNED" && current.status !== "ON_HOLD") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo OTs en estado Planificada, En Progreso (sin trabajo registrado) o En Espera pueden cancelarse (actual: ${current.status}).`);
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

  // Cerrar aplazamientos asociados a esta OT en cualquier estado no-terminal
  try {
    const deferralDelegateLocal = (prismaRaw as unknown as {
      deferral: {
        findMany(a: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{ id: string; deferralCode: string; status: string }[]>;
        update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
      };
    }).deferral;
    const openDeferrals = await deferralDelegateLocal.findMany({
      where: {
        tenantId: current.tenantId,
        sourceType: "WORK_ORDER",
        sourceId: current.id,
        status: { notIn: ["CLOSED", "REJECTED", "EXPIRED"] },
        deletedAt: null,
      },
      select: { id: true, deferralCode: true, status: true },
    });
    for (const d of openDeferrals) {
      await deferralDelegateLocal.update({
        where: { id: d.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closeNotes: `Cerrado automáticamente al cancelar la OT ${current.workOrderCode} (estado previo: ${d.status}).`,
          updatedByUserId: session.user.id,
        },
      });
      void publishAudit(prismaRaw, {
        tenantId: current.tenantId,
        actorUserId: session.user.id,
        action: "Deferral.closed",
        entityType: "Deferral",
        entityId: d.id,
        metadata: { deferralCode: d.deferralCode, vesselCode: current.vesselCode, autoClosedBy: "WORK_ORDER_CANCELLED", previousStatus: d.status, workOrderCode: current.workOrderCode },
      });
    }
  } catch (err) {
    log.error("[cancelWorkOrder] failed to auto-close associated deferrals:", err);
  }

  if (current.maintenancePlanId) {
    void restorePlanAfterWoCancellation(session, current.maintenancePlanId)
      .catch((err: unknown) => { log.error("[cancelWorkOrder] plan restore failed:", err); });
  }
  return cancelled;
}

export interface ReopenWorkOrderInput {
  reason: string;
}

/**
 * Re-abre una OT cerrada o cancelada. Solo TENANT_ADMIN.
 *
 * - CLOSED  → IN_PROGRESS (vuelve a estar editable)
 * - CANCELLED → PLANNED   (vuelve al backlog)
 *
 * El motivo queda auditado en lastReopenReason + auditoría central.
 */
export async function reopenWorkOrder(session: TenantAccessSession, id: string, payload: ReopenWorkOrderInput) {
  assertCanReopen(session.user.role);
  const reason = assertReopenReason(payload?.reason);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  if (current.status !== "CLOSED" && current.status !== "CANCELLED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo OTs CLOSED o CANCELLED pueden re-abrirse (actual: ${current.status}).`);
  }

  const nextStatus = current.status === "CANCELLED" ? "PLANNED" : "IN_PROGRESS";
  const now = new Date();

  const reopened = await prisma.workOrder.update({
    where: { id: current.id },
    data: {
      status: nextStatus,
      reopenCount: { increment: 1 },
      lastReopenAt: now,
      lastReopenReason: reason,
      lastReopenByUserId: session.user.id,
      updatedByUserId: session.user.id,
    } as Record<string, unknown>,
  });

  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.reopened",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: {
      workOrderCode: current.workOrderCode,
      vesselCode: current.vesselCode,
      previousStatus: current.status,
      newStatus: nextStatus,
      reason,
    },
  });

  return reopened;
}
