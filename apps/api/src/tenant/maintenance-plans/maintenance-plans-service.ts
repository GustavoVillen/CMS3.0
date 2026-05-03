import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { listDevMaintenancePlansForTenant } from "../../platform/data/dev-domain-store";
import { publishAudit } from "../../platform/audit/audit-publisher";

export interface MaintenancePlanListFilters {
  vesselCode?: string | null;
  status?: string | null;
  triggerType?: string | null;
  executionStatus?: string | null;
  taskMasterId?: string | null;
}

export interface CreateMaintenancePlanInput {
  vesselCode: string;
  assetId: string;
  /** Leave empty to auto-generate. Format: {VESSEL}-{SFI}-{SEQ} or {VESSEL}-PM-{SEQ}. */
  taskCode?: string | null;
  title: string;
  description?: string | null;
  taskType?: "MAINTENANCE" | "INSPECTION" | null;
  triggerType: "HOURS" | "MONTHS" | "CONDITION" | "EVENT" | "CALENDAR" | "RUNNING_HOURS";
  frequencyHours?: number | null;
  frequencyMonths?: number | null;
  responsible?: string | null;
  acceptanceCriteria?: string | null;
  loto?: string | null;
  sfiGroupNumber?: number | null;
  sfiSubgroupCode?: string | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  riskAnalysisResult?: string | null;
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
  status?: "ACTIVE" | "DUE_SOON" | "OVERDUE" | "INACTIVE";
  taskMasterId?: string | null;
  /** Si está set, al cerrar la OT del plan se crea automáticamente un FluidSample DRAFT con horas/asset/fluidType pre-cargados. */
  samplingFluidType?: "ENGINE_OIL" | "HYDRAULIC_OIL" | "GEARBOX_OIL" | "TRANSMISSION_OIL" | "FUEL_DIESEL" | "FUEL_GASOIL" | "COOLING_WATER" | "BOILER_WATER" | "POTABLE_WATER" | "REFRIGERANT" | "OTHER" | null;
  triggerResultMode?: "DUE_ONLY" | "AUTO_WO" | "APPROVAL_WO" | "CHECKLIST";
  checklistTemplate?: string | null;
  windowMode?: "AUTO" | "MANUAL";
  windowLeadDays?: number | null;
  windowLeadHours?: number | null;
  windowLeadPercent?: number | null;
  windowOpenDate?: string | Date | null;
  windowOpenHours?: number | null;
  nextDueDate?: string | Date | null;
  nextDueHours?: number | null;
}

export interface UpdateMaintenancePlanInput {
  taskType?: "MAINTENANCE" | "INSPECTION" | null;
  assetId?: string;
  taskCode?: string;
  title?: string;
  description?: string | null;
  triggerType?: "HOURS" | "MONTHS" | "CONDITION" | "EVENT" | "CALENDAR" | "RUNNING_HOURS";
  frequencyHours?: number | null;
  frequencyMonths?: number | null;
  responsible?: string | null;
  acceptanceCriteria?: string | null;
  loto?: string | null;
  sfiGroupNumber?: number | null;
  sfiSubgroupCode?: string | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  riskAnalysisResult?: string | null;
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
  status?: "ACTIVE" | "DUE_SOON" | "OVERDUE" | "INACTIVE";
  taskMasterId?: string | null;
  /** Si está set, al cerrar la OT del plan se crea automáticamente un FluidSample DRAFT con horas/asset/fluidType pre-cargados. */
  samplingFluidType?: "ENGINE_OIL" | "HYDRAULIC_OIL" | "GEARBOX_OIL" | "TRANSMISSION_OIL" | "FUEL_DIESEL" | "FUEL_GASOIL" | "COOLING_WATER" | "BOILER_WATER" | "POTABLE_WATER" | "REFRIGERANT" | "OTHER" | null;
  triggerResultMode?: "DUE_ONLY" | "AUTO_WO" | "APPROVAL_WO" | "CHECKLIST";
  checklistTemplate?: string | null;
  windowMode?: "AUTO" | "MANUAL";
  windowLeadDays?: number | null;
  windowLeadHours?: number | null;
  windowLeadPercent?: number | null;
  windowOpenDate?: string | Date | null;
  windowOpenHours?: number | null;
  nextDueDate?: string | Date | null;
  nextDueHours?: number | null;
  executionStatus?: "FUTURE" | "UPCOMING" | "IN_WINDOW" | "DUE" | "OVERDUE" | "COMPLETED";
}

export interface QuickClosePlanInput {
  result: "COMPLETED" | "COMPLETED_WITH_OBSERVATIONS" | "NOT_COMPLETED" | "FOLLOW_UP_REQUIRED";
  executedByName: string;
  hoursWorked?: number | null;
  runningHoursAtExecution?: number | null;
  notes?: string | null;
  completedAt?: string | Date | null;
}

export interface CompleteChecklistInput {
  result: "COMPLETED" | "COMPLETED_WITH_OBSERVATIONS" | "NOT_COMPLETED" | "FOLLOW_UP_REQUIRED";
  executedByName: string;
  notes?: string | null;
  checklistFileName?: string | null;
  completedAt?: string | Date | null;
  runningHoursAtExecution?: number | null;
  hoursWorked?: number | null;
}

export interface OpenFormalWorkOrderInput {
  title?: string | null;
  description?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  assignedToUserId?: string | null;
  estimatedHours?: number | null;
  dueDate?: string | Date | null;
  acceptanceCriteria?: string | null;
  loto?: string | null;
  riskLevel?: string | null;
  riskAnalysisResult?: string | null;
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
}

interface RecalculatePlanInput {
  triggerType: string;
  frequencyMonths: number | null;
  frequencyHours: number | null;
}

interface RecalculateResult {
  nextDueDate: Date | null;
  nextDueHours: number | null;
}

function deriveExecutionStatus(
  plan: Pick<MaintenancePlanRecord, "executionStatus" | "nextDueDate" | "nextDueHours" | "triggerType">,
  currentHours?: number | null,
): string {
  // Only preserve IN_WINDOW: there's an active WO open for this plan.
  // COMPLETED is NOT preserved — if the next due date passed, it should become OVERDUE.
  if (plan.executionStatus === "IN_WINDOW") return "IN_WINDOW";

  const now = new Date();

  // Hours-based trigger
  if (plan.nextDueHours != null) {
    const hours = currentHours ?? 0;
    const diff = plan.nextDueHours - hours;
    if (diff <= 0) return "OVERDUE";
    if (diff <= 50) return "DUE";
    if (diff <= 250) return "UPCOMING";
    return "FUTURE";
  }

  // Date-based trigger
  if (plan.nextDueDate) {
    const due = new Date(plan.nextDueDate);
    const daysLeft = (due.getTime() - now.getTime()) / 86_400_000;
    if (daysLeft < 0) return "OVERDUE";
    if (daysLeft <= 7) return "DUE";
    if (daysLeft <= 30) return "UPCOMING";
    return "FUTURE";
  }

  return plan.executionStatus ?? "FUTURE";
}

interface WorkLogRecord {
  id: string;
  createdAt: Date;
}

interface MaintenancePlanRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  taskCode: string;
  title: string;
  description: string | null;
  responsible: string | null;
  acceptanceCriteria: string | null;
  loto: string | null;
  sfiGroupNumber: number | null;
  sfiSubgroupCode: string | null;
  riskLevel: string | null;
  riskAnalysisResult: string | null;
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
  status: string;
  lastExecutionDate: Date | null;
  nextDueDate: Date | null;
  lastExecutionHours: number | null;
  nextDueHours: number | null;
  taskMasterId?: string | null;
  executionStatus?: string | null;
  deletedAt: Date | null;
  workLogs?: WorkLogRecord[];
}

interface WorkOrderRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  maintenancePlanId: string | null;
  workOrderCode: string;
}

type MaintenancePlanDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<MaintenancePlanRecord[]>;
  findFirst(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<MaintenancePlanRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<MaintenancePlanRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown>; include?: Record<string, unknown> }): Promise<MaintenancePlanRecord>;
};

type WorkLogDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<WorkLogRecord>;
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown; take?: number }): Promise<WorkLogRecord[]>;
};

type WorkOrderDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<WorkOrderRecord>;
};

interface MaintenanceTx {
  maintenancePlan: MaintenancePlanDelegate;
  workLog: WorkLogDelegate;
  workOrder: WorkOrderDelegate;
}

interface MaintenancePrismaClient extends MaintenanceTx {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  $transaction<T>(fn: (tx: MaintenanceTx) => Promise<T>): Promise<T>;
}

function maintenanceClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): MaintenancePrismaClient {
  return prisma as unknown as MaintenancePrismaClient;
}

function canManagePlans(session: TenantAccessSession): boolean {
  return session.user.role === "TENANT_ADMIN";
}

function ensureCanManagePlans(session: TenantAccessSession) {
  if (!canManagePlans(session)) {
    throw new RouteError(403, "FORBIDDEN", "Solo el administrador del tenant puede modificar planes de mantenimiento.");
  }
}

// Abrir una OT desde un plan no modifica el plan — es una acción operativa.
// Los técnicos a bordo y los managers de mantenimiento pueden hacerlo.
function canOpenWorkOrderFromPlan(session: TenantAccessSession): boolean {
  const role = session.user.role;
  return role === "TENANT_ADMIN"
    || role === "FLEET_SUPERINTENDENT"
    || role === "MAINTENANCE_MANAGER"
    || role === "TECHNICIAN_OPERATOR";
}

function ensureCanOpenWorkOrderFromPlan(session: TenantAccessSession) {
  if (!canOpenWorkOrderFromPlan(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para crear órdenes de trabajo desde planes.");
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

function normalizeRiskLevel(value: unknown): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null {
  if (value === undefined || value === null || value === "") return null;
  const riskLevel = String(value).trim().toUpperCase();
  if (riskLevel === "LOW" || riskLevel === "MEDIUM" || riskLevel === "HIGH" || riskLevel === "CRITICAL") {
    return riskLevel;
  }
  throw new RouteError(400, "VALIDATION_ERROR", "riskLevel inválido. Valores permitidos: LOW, MEDIUM, HIGH, CRITICAL.");
}

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  return parsed;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function autoInitialNextDueDate(triggerType: string, frequencyMonths: number | null): Date | null {
  if (!frequencyMonths || frequencyMonths <= 0) return null;
  const today = new Date();
  const tt = triggerType.toUpperCase();
  if (tt === "MONTHS" || tt === "CALENDAR") return addMonths(today, frequencyMonths);
  if (tt === "DAY") return addDays(today, frequencyMonths);
  if (tt === "WEEK") return addDays(today, frequencyMonths * 7);
  return null;
}

export function recalculateNextDue(
  plan: RecalculatePlanInput,
  lastExecutionDate: Date,
  lastExecutionHours: number | null,
): RecalculateResult {
  const triggerType = String(plan.triggerType || "");
  const frequencyMonths = plan.frequencyMonths ?? null;
  const frequencyHours = plan.frequencyHours ?? null;

  if (triggerType === "MONTHS" || triggerType === "CALENDAR") {
    if (frequencyMonths && frequencyMonths > 0) {
      return { nextDueDate: addMonths(lastExecutionDate, frequencyMonths), nextDueHours: null };
    }
    return { nextDueDate: null, nextDueHours: null };
  }

  if (triggerType === "HOURS" || triggerType === "RUNNING_HOURS") {
    if (lastExecutionHours !== null && frequencyHours !== null && frequencyHours > 0) {
      return { nextDueDate: null, nextDueHours: lastExecutionHours + frequencyHours };
    }
    return { nextDueDate: null, nextDueHours: null };
  }

  if (triggerType === "DAY") {
    if (frequencyMonths && frequencyMonths > 0) {
      return { nextDueDate: addDays(lastExecutionDate, frequencyMonths), nextDueHours: null };
    }
    return { nextDueDate: null, nextDueHours: null };
  }

  if (triggerType === "WEEK") {
    if (frequencyMonths && frequencyMonths > 0) {
      return { nextDueDate: addDays(lastExecutionDate, frequencyMonths * 7), nextDueHours: null };
    }
    return { nextDueDate: null, nextDueHours: null };
  }

  if (triggerType === "CONDITION" || triggerType === "EVENT") {
    return { nextDueDate: null, nextDueHours: null };
  }

  return { nextDueDate: null, nextDueHours: null };
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = maintenanceClient(prismaRaw);
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

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (!("code" in error)) return false;
  return (error as { code?: unknown }).code === "P2002";
}

async function loadRecentWorkLogs(
  workLog: WorkLogDelegate | undefined,
  tenantId: string,
  maintenancePlanId: string,
): Promise<WorkLogRecord[]> {
  if (!workLog || typeof workLog.findMany !== "function") return [];
  return workLog.findMany({
    where: { tenantId, maintenancePlanId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}

export async function listTenantMaintenancePlans(
  session: TenantAccessSession,
  filters: MaintenancePlanListFilters = {},
) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) {
    const devItems = listDevMaintenancePlansForTenant(
      session.tenantSlug,
      session.user.role,
      session.user.assignedVesselCodes,
      {
        vesselCode: filters.vesselCode,
        status: filters.status,
        triggerType: filters.triggerType,
      },
    );
    return devItems
      .map(item => ({
        ...item,
        executionStatus: deriveExecutionStatus(item as unknown as Pick<MaintenancePlanRecord, "executionStatus" | "nextDueDate" | "nextDueHours" | "triggerType">),
      }))
      .filter((item) => {
        const taskMasterId = "taskMasterId" in item ? (item as unknown as { taskMasterId?: string | null }).taskMasterId : undefined;
        if (filters.executionStatus && item.executionStatus !== filters.executionStatus) return false;
        if (filters.taskMasterId && taskMasterId !== filters.taskMasterId) return false;
        return true;
      });
  }
  const prisma = maintenanceClient(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.triggerType) where.triggerType = filters.triggerType;
  if (filters.executionStatus) where.executionStatus = filters.executionStatus;
  if (filters.taskMasterId) where.taskMasterId = filters.taskMasterId;

  const plans = await prisma.maintenancePlan.findMany({
    where,
    orderBy: [{ nextDueDate: "asc" }, { nextDueHours: "asc" }, { taskCode: "asc" }],
  });

  const planIds = plans.map((p) => p.id);
  const assetIds = [...new Set(plans.map((p) => p.assetId))];

  // Fetch asset names, current hours, and active WO codes in parallel
  const [assetRows, currentHoursRows, activeWos] = await Promise.all([
    assetIds.length > 0
      ? (prismaRaw as unknown as { asset: { findMany: (args: unknown) => Promise<{ id: string; name: string | null }[]> } }).asset.findMany({
          where: { id: { in: assetIds }, tenantId },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string | null }[]),
    assetIds.length > 0
      ? (() => {
          // Window function (ROW_NUMBER OVER PARTITION) has no direct Prisma ORM
          // equivalent. Kept as raw but explicitly scoped by tenantId for defense
          // in depth (M-02). assetIds come from a tenant-scoped findMany above
          // so the implicit scope was already correct, but explicit > implicit.
          const placeholders = assetIds.map((_: string, i: number) => `$${i + 1}`).join(", ");
          const tenantPlaceholder = `$${assetIds.length + 1}`;
          return prismaRaw.$queryRawUnsafe<{ assetId: string; runningHoursTotal: number }[]>(
            `SELECT "assetId", "runningHoursTotal"
             FROM (
               SELECT "assetId", "runningHoursTotal",
                      ROW_NUMBER() OVER (PARTITION BY "assetId" ORDER BY "createdAt" DESC) AS rn
               FROM "DailyEquipmentHours"
               WHERE "assetId" IN (${placeholders})
                 AND "tenantId" = ${tenantPlaceholder}
                 AND "runningHoursTotal" IS NOT NULL
             ) sub WHERE rn = 1`,
            ...assetIds, tenantId,
          );
        })()
      : Promise.resolve([] as { assetId: string; runningHoursTotal: number }[]),
    planIds.length > 0
      ? (prismaRaw as unknown as { workOrder: { findMany: (args: unknown) => Promise<{ maintenancePlanId: string | null; workOrderCode: string }[]> } }).workOrder.findMany({
          where: { tenantId, maintenancePlanId: { in: planIds }, status: { in: ["PLANNED", "IN_PROGRESS"] }, deletedAt: null },
          select: { maintenancePlanId: true, workOrderCode: true },
          orderBy: { createdAt: "desc" as const },
        })
      : Promise.resolve([] as { maintenancePlanId: string | null; workOrderCode: string }[]),
  ]);

  const assetNameMap = new Map(assetRows.map((a) => [a.id, a.name ?? null]));
  const assetCurrentHoursMap = new Map(currentHoursRows.map((r) => [r.assetId, Number(r.runningHoursTotal)]));
  const activeWoMap = new Map<string, string>();
  for (const wo of activeWos) {
    if (wo.maintenancePlanId && !activeWoMap.has(wo.maintenancePlanId)) {
      activeWoMap.set(wo.maintenancePlanId, wo.workOrderCode);
    }
  }

  return plans.map((p) => ({
    ...p,
    assetName: assetNameMap.get(p.assetId) ?? null,
    assetCurrentHours: assetCurrentHoursMap.get(p.assetId) ?? null,
    activeWorkOrderCode: activeWoMap.get(p.id) ?? null,
    executionStatus: deriveExecutionStatus(p),
  }));
}

export async function getTenantMaintenancePlan(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await prisma.maintenancePlan.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Maintenance plan no encontrado.");
  const workLogs = await loadRecentWorkLogs(prisma.workLog, record.tenantId, record.id);
  return { ...record, workLogs };
}

// ---------------------------------------------------------------------------
// Delete (soft)
// ---------------------------------------------------------------------------

export async function deleteTenantMaintenancePlan(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await prisma.maintenancePlan.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Maintenance plan no encontrado.");

  await prisma.maintenancePlan.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id },
  });
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique task code for a new maintenance plan.
 * Format: {VESSEL}-{SFI_GROUP}-{SEQ:03d}   (e.g. LATERE-200-001)
 *    or:  {VESSEL}-PM-{SEQ:03d}             (e.g. LATERE-PM-001, no SFI)
 * SEQ is the next available sequence for that prefix within the tenant+vessel.
 */
export async function generateUniqueTaskCode(
  session: TenantAccessSession,
  vesselCode: string,
  sfiGroupNumber: number | null,
): Promise<string> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vc = vesselCode.toUpperCase();
  const suffix = sfiGroupNumber !== null ? String(sfiGroupNumber) : "PM";
  const prefix = `${vc}-${suffix}`;

  const existing = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: vc, deletedAt: null },
    select: { taskCode: true },
  });

  // Extract sequence numbers from codes that match the prefix pattern
  const escapedPrefix = prefix.replace(/[-]/g, "\\-");
  const regex = new RegExp(`^${escapedPrefix}-(\\d+)$`, "i");
  const seqs = existing
    .map(r => { const m = r.taskCode.match(regex); return m ? parseInt(m[1]!, 10) : 0; })
    .filter(n => n > 0);

  const nextSeq = seqs.length > 0 ? Math.max(...seqs) + 1 : 1;
  return `${prefix}-${String(nextSeq).padStart(3, "0")}`;
}

export async function createTenantMaintenancePlan(session: TenantAccessSession, payload: CreateMaintenancePlanInput) {
  ensureCanManagePlans(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

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

  // Validar tenant ownership de taskMasterId (incluye globales).
  const taskMasterId = normalizeOptionalText(payload.taskMasterId);
  if (taskMasterId) {
    const tmCount = await (prismaRaw as any).taskMaster.count({
      where: { id: taskMasterId, OR: [{ tenantId }, { isGlobal: true }] },
    });
    if (tmCount === 0) {
      throw new RouteError(404, "TASK_MASTER_NOT_FOUND", "TaskMaster no encontrado o no pertenece a este tenant.");
    }
  }

  // Auto-generate taskCode if not provided
  const sfiGroupNumber = normalizeOptionalNumber(payload.sfiGroupNumber, "sfiGroupNumber");
  const resolvedTaskCode = payload.taskCode?.trim()
    ? payload.taskCode.trim().toUpperCase()
    : await generateUniqueTaskCode(session, vesselCode, sfiGroupNumber);

  const data: Record<string, unknown> = {
    tenantId,
    vesselCode,
    assetId,
    taskCode: resolvedTaskCode,
    title: normalizeRequiredText(payload.title, "title"),
    description: normalizeOptionalText(payload.description),
    taskType: payload.taskType ?? "MAINTENANCE",
    triggerType: payload.triggerType,
    frequencyHours: normalizeOptionalNumber(payload.frequencyHours, "frequencyHours"),
    frequencyMonths: normalizeOptionalNumber(payload.frequencyMonths, "frequencyMonths"),
    responsible: normalizeOptionalText(payload.responsible),
    acceptanceCriteria: normalizeOptionalText(payload.acceptanceCriteria),
    loto: normalizeOptionalText(payload.loto),
    sfiGroupNumber,
    sfiSubgroupCode: normalizeOptionalText(payload.sfiSubgroupCode),
    riskLevel: normalizeRiskLevel(payload.riskLevel),
    riskAnalysisResult: normalizeOptionalText(payload.riskAnalysisResult),
    consequenceCategory: payload.consequenceCategory ?? null,
    consequenceRationale: normalizeOptionalText(payload.consequenceRationale),
    status: payload.status ?? "ACTIVE",
    taskMasterId,
    samplingFluidType: payload.samplingFluidType ?? null,
    triggerResultMode: payload.triggerResultMode ?? "DUE_ONLY",
    checklistTemplate: normalizeOptionalText(payload.checklistTemplate),
    windowMode: payload.windowMode ?? "AUTO",
    windowLeadDays: normalizeOptionalNumber(payload.windowLeadDays, "windowLeadDays"),
    windowLeadHours: normalizeOptionalNumber(payload.windowLeadHours, "windowLeadHours"),
    windowLeadPercent: normalizeOptionalNumber(payload.windowLeadPercent, "windowLeadPercent"),
    windowOpenDate: parseOptionalDate(payload.windowOpenDate, "windowOpenDate"),
    windowOpenHours: normalizeOptionalNumber(payload.windowOpenHours, "windowOpenHours"),
    nextDueDate: parseOptionalDate(payload.nextDueDate, "nextDueDate")
      ?? autoInitialNextDueDate(String(payload.triggerType), normalizeOptionalNumber(payload.frequencyMonths, "frequencyMonths")),
    nextDueHours: normalizeOptionalNumber(payload.nextDueHours, "nextDueHours"),
    executionStatus: "FUTURE",
    createdByUserId: session.user.id,
    updatedByUserId: session.user.id,
  };

  try {
    const created = await prisma.maintenancePlan.create({ data });
    void publishAudit(prismaRaw, {
      tenantId: created.tenantId,
      actorUserId: session.user.id,
      action: "MaintenancePlan.created",
      entityType: "MaintenancePlan",
      entityId: created.id,
      metadata: { title: created.title, taskCode: created.taskCode, vesselCode: created.vesselCode },
    });
    return created;
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new RouteError(409, "DUPLICATE_TASK_CODE", `Ya existe un plan con taskCode ${String(data.taskCode)} para el vessel.`);
    }
    throw error;
  }
}

export async function updateTenantMaintenancePlan(
  session: TenantAccessSession,
  id: string,
  payload: UpdateMaintenancePlanInput,
) {
  ensureCanManagePlans(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const current = await getTenantMaintenancePlan(session, id);
  if (payload.taskCode !== undefined && normalizeRequiredText(payload.taskCode, "taskCode").toUpperCase() !== current.taskCode) {
    const duplicated = await prisma.maintenancePlan.findFirst({
      where: {
        tenantId: current.tenantId,
        vesselCode: current.vesselCode,
        taskCode: normalizeRequiredText(payload.taskCode, "taskCode").toUpperCase(),
        deletedAt: null,
      },
    });
    if (duplicated && duplicated.id !== current.id) {
      throw new RouteError(409, "DUPLICATE_TASK_CODE", "Ya existe un maintenance plan con ese taskCode.");
    }
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.taskType !== undefined && payload.taskType !== null) data.taskType = payload.taskType;
  if (payload.assetId !== undefined && payload.assetId) data.assetId = normalizeRequiredText(payload.assetId, "assetId");
  if (payload.taskCode !== undefined) data.taskCode = normalizeRequiredText(payload.taskCode, "taskCode").toUpperCase();
  if (payload.title !== undefined) data.title = normalizeRequiredText(payload.title, "title");
  if (payload.description !== undefined) data.description = normalizeOptionalText(payload.description);
  if (payload.triggerType !== undefined) data.triggerType = payload.triggerType;
  if (payload.frequencyHours !== undefined) data.frequencyHours = normalizeOptionalNumber(payload.frequencyHours, "frequencyHours");
  if (payload.frequencyMonths !== undefined) data.frequencyMonths = normalizeOptionalNumber(payload.frequencyMonths, "frequencyMonths");
  if (payload.responsible !== undefined) data.responsible = normalizeOptionalText(payload.responsible);
  if (payload.acceptanceCriteria !== undefined) data.acceptanceCriteria = normalizeOptionalText(payload.acceptanceCriteria);
  if (payload.loto !== undefined) data.loto = normalizeOptionalText(payload.loto);
  if (payload.sfiGroupNumber !== undefined) data.sfiGroupNumber = normalizeOptionalNumber(payload.sfiGroupNumber, "sfiGroupNumber");
  if (payload.sfiSubgroupCode !== undefined) data.sfiSubgroupCode = normalizeOptionalText(payload.sfiSubgroupCode);
  if (payload.riskLevel !== undefined) data.riskLevel = normalizeRiskLevel(payload.riskLevel);
  if (payload.riskAnalysisResult !== undefined) data.riskAnalysisResult = normalizeOptionalText(payload.riskAnalysisResult);
  if (payload.consequenceCategory !== undefined) data.consequenceCategory = payload.consequenceCategory ?? null;
  if (payload.consequenceRationale !== undefined) data.consequenceRationale = normalizeOptionalText(payload.consequenceRationale);
  if (payload.status !== undefined) data.status = payload.status;
  if (payload.taskMasterId !== undefined) data.taskMasterId = normalizeOptionalText(payload.taskMasterId);
  if (payload.samplingFluidType !== undefined) data.samplingFluidType = payload.samplingFluidType ?? null;
  if (payload.triggerResultMode !== undefined) data.triggerResultMode = payload.triggerResultMode;
  if (payload.checklistTemplate !== undefined) data.checklistTemplate = normalizeOptionalText(payload.checklistTemplate);
  if (payload.windowMode !== undefined) data.windowMode = payload.windowMode;
  if (payload.windowLeadDays !== undefined) data.windowLeadDays = normalizeOptionalNumber(payload.windowLeadDays, "windowLeadDays");
  if (payload.windowLeadHours !== undefined) data.windowLeadHours = normalizeOptionalNumber(payload.windowLeadHours, "windowLeadHours");
  if (payload.windowLeadPercent !== undefined) data.windowLeadPercent = normalizeOptionalNumber(payload.windowLeadPercent, "windowLeadPercent");
  if (payload.windowOpenDate !== undefined) data.windowOpenDate = parseOptionalDate(payload.windowOpenDate, "windowOpenDate");
  if (payload.windowOpenHours !== undefined) data.windowOpenHours = normalizeOptionalNumber(payload.windowOpenHours, "windowOpenHours");
  if (payload.nextDueDate !== undefined) data.nextDueDate = parseOptionalDate(payload.nextDueDate, "nextDueDate");
  if (payload.nextDueHours !== undefined) data.nextDueHours = normalizeOptionalNumber(payload.nextDueHours, "nextDueHours");
  if (payload.executionStatus !== undefined) data.executionStatus = payload.executionStatus;

  // Auto-calculate nextDueDate if it's still null after updates
  if (!data.nextDueDate && !current.nextDueDate) {
    const tt = String((data.triggerType ?? current.triggerType) || "");
    const freq = (data.frequencyMonths as number | null) ?? current.frequencyMonths;
    const calculated = autoInitialNextDueDate(tt, freq);
    if (calculated) data.nextDueDate = calculated;
  }

  const updated = await prisma.maintenancePlan.update({ where: { id: current.id }, data });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "MaintenancePlan.updated",
    entityType: "MaintenancePlan",
    entityId: current.id,
    metadata: { title: current.title, taskCode: current.taskCode, vesselCode: current.vesselCode },
  });
  return updated;
}

export async function quickClosePlan(
  session: TenantAccessSession,
  id: string,
  payload: QuickClosePlanInput,
) {
  ensureCanManagePlans(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const plan = await getTenantMaintenancePlan(session, id);
  const completedAt = parseOptionalDate(payload.completedAt, "completedAt") ?? new Date();
  const runningHoursAtExecution = normalizeOptionalNumber(payload.runningHoursAtExecution, "runningHoursAtExecution");
  const hoursWorked = normalizeOptionalNumber(payload.hoursWorked, "hoursWorked");
  const result = payload.result;
  const logCode = `LOG-${plan.vesselCode}-${Date.now()}`;
  const nextDue = recalculateNextDue(
    {
      triggerType: plan.triggerType,
      frequencyHours: plan.frequencyHours,
      frequencyMonths: plan.frequencyMonths,
    },
    completedAt,
    runningHoursAtExecution,
  );

  const txResult = await prisma.$transaction(async (tx) => {
    const workLog = await tx.workLog.create({
      data: {
        tenantId: plan.tenantId,
        vesselCode: plan.vesselCode,
        workOrderId: null,
        maintenancePlanId: plan.id,
        assetId: plan.assetId,
        logCode,
        taskType: "MAINTENANCE",
        result,
        startedAt: completedAt,
        completedAt,
        executedByUserId: session.user.id,
        executedByName: normalizeRequiredText(payload.executedByName, "executedByName"),
        hoursWorked,
        runningHoursAtExecution,
        notes: normalizeOptionalText(payload.notes),
        followUpRequired: result === "FOLLOW_UP_REQUIRED",
        createdByUserId: session.user.id,
      },
    });

    const updatedPlan = await tx.maintenancePlan.update({
      where: { id: plan.id },
      data: {
        lastExecutionDate: completedAt,
        lastExecutionHours: runningHoursAtExecution,
        nextDueDate: nextDue.nextDueDate,
        nextDueHours: nextDue.nextDueHours,
        executionStatus: "COMPLETED",
        updatedByUserId: session.user.id,
      },
    });
    const workLogs = await loadRecentWorkLogs(tx.workLog, plan.tenantId, plan.id);

    return { plan: { ...updatedPlan, workLogs }, workLog };
  });
  void publishAudit(prismaRaw, {
    tenantId: plan.tenantId,
    actorUserId: session.user.id,
    action: "MaintenancePlan.executed",
    entityType: "MaintenancePlan",
    entityId: plan.id,
    metadata: {
      title: plan.title,
      taskCode: plan.taskCode,
      vesselCode: plan.vesselCode,
      result,
      executedByName: payload.executedByName,
      completedAt: completedAt.toISOString(),
    },
  });
  return txResult;
}

export async function completeChecklistPlan(
  session: TenantAccessSession,
  id: string,
  payload: CompleteChecklistInput,
) {
  const noteParts: string[] = [];
  const noteText = String(payload.notes ?? "").trim();
  if (noteText) noteParts.push(noteText);
  if (payload.checklistFileName) noteParts.push(`[Checklist: ${payload.checklistFileName}]`);

  return quickClosePlan(session, id, {
    result: payload.result,
    executedByName: payload.executedByName,
    notes: noteParts.length > 0 ? noteParts.join("\n") : null,
    completedAt: payload.completedAt,
    runningHoursAtExecution: payload.runningHoursAtExecution,
    hoursWorked: payload.hoursWorked,
  });
}

export async function openFormalWorkOrder(
  session: TenantAccessSession,
  id: string,
  payload: OpenFormalWorkOrderInput,
) {
  ensureCanOpenWorkOrderFromPlan(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const plan = await getTenantMaintenancePlan(session, id);
  const woYear = new Date().getFullYear();
  const woYY = String(woYear).slice(-2);
  const woCount = await prismaRaw.workOrder.count({ where: { tenantId: plan.tenantId, vesselCode: plan.vesselCode, createdAt: { gte: new Date(woYear, 0, 1), lt: new Date(woYear + 1, 0, 1) } } });
  const workOrderCode = `WO-${plan.vesselCode}-${woYY}-${String(woCount + 1).padStart(4, "0")}`;

  // Hereda del plan cuando el payload no lo provee. Si el payload manda
  // el campo (incluso vacío "", el normalizeOptionalText lo convertirá a
  // null), respeta esa intención del usuario.
  const inherit = <T>(payloadValue: unknown, planValue: T | null | undefined): T | null => {
    if (payloadValue === undefined) return (planValue ?? null) as T | null;
    const txt = normalizeOptionalText(payloadValue as string | null | undefined);
    return (txt as unknown as T) ?? null;
  };
  const planAny = plan as any;

  const woTxResult = await prisma.$transaction(async (tx) => {
    const workOrder = await tx.workOrder.create({
      data: {
        tenantId: plan.tenantId,
        vesselCode: plan.vesselCode,
        assetId: plan.assetId,
        maintenancePlanId: plan.id,
        workOrderCode,
        type: "PREVENTIVE",
        status: "PLANNED",
        priority: payload.priority ?? "MEDIUM",
        openDate: new Date(),
        dueDate: parseOptionalDate(payload.dueDate, "dueDate"),
        title: normalizeOptionalText(payload.title) ?? plan.title,
        description: normalizeOptionalText(payload.description) ?? plan.description,
        assignedToUserId: normalizeOptionalText(payload.assignedToUserId),
        estimatedHours: normalizeOptionalNumber(payload.estimatedHours, "estimatedHours"),
        taskMasterId: plan.taskMasterId ?? null,
        acceptanceCriteria: inherit<string>(payload.acceptanceCriteria, planAny.acceptanceCriteria),
        loto: inherit<string>(payload.loto, planAny.loto),
        riskLevel: inherit<string>(payload.riskLevel, planAny.riskLevel),
        riskAnalysisResult: inherit<string>(payload.riskAnalysisResult, planAny.riskAnalysisResult),
        consequenceCategory: payload.consequenceCategory !== undefined
          ? (payload.consequenceCategory ?? null)
          : (planAny.consequenceCategory ?? null),
        consequenceRationale: inherit<string>(payload.consequenceRationale, planAny.consequenceRationale),
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
      },
    });

    await tx.maintenancePlan.update({
      where: { id: plan.id },
      data: {
        executionStatus: "IN_WINDOW",
        updatedByUserId: session.user.id,
      },
    });

    return workOrder;
  });
  void publishAudit(prismaRaw, {
    tenantId: plan.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.openedFromPlan",
    entityType: "WorkOrder",
    entityId: woTxResult.id,
    metadata: {
      workOrderCode: woTxResult.workOrderCode,
      planTitle: plan.title,
      planId: plan.id,
      vesselCode: plan.vesselCode,
    },
  });
  return woTxResult;
}

// ---------------------------------------------------------------------------
// reportExecution — simplified execution flow without requiring a Work Order
// ---------------------------------------------------------------------------

export interface ReportExecutionInput {
  executedByName: string;
  result: "SATISFACTORIO" | "CON_DEFICIENCIAS";
  notes?: string | null;
  deficienciesNotes?: string | null;
  completedAt?: string | Date | null;
  runningHoursAtExecution?: number | null;
  hoursWorked?: number | null;
}

export async function reportExecution(
  session: TenantAccessSession,
  id: string,
  payload: ReportExecutionInput,
) {
  const workLogResult =
    payload.result === "SATISFACTORIO" ? "COMPLETED" : "COMPLETED_WITH_OBSERVATIONS";

  const noteParts: string[] = [];
  if (String(payload.notes ?? "").trim()) noteParts.push(String(payload.notes!).trim());
  if (String(payload.deficienciesNotes ?? "").trim())
    noteParts.push(`[Deficiencias]: ${String(payload.deficienciesNotes!).trim()}`);

  const closeResult = await quickClosePlan(session, id, {
    result: workLogResult,
    executedByName: normalizeRequiredText(payload.executedByName, "executedByName"),
    notes: noteParts.join("\n\n") || null,
    completedAt: payload.completedAt,
    runningHoursAtExecution: normalizeOptionalNumber(payload.runningHoursAtExecution, "runningHoursAtExecution"),
    hoursWorked: normalizeOptionalNumber(payload.hoursWorked, "hoursWorked"),
  });

  return {
    ...closeResult,
    hasDeficiencies: payload.result === "CON_DEFICIENCIAS",
    deficienciesNotes: normalizeOptionalText(payload.deficienciesNotes),
  };
}

// ---------------------------------------------------------------------------
// postponePlan — creates a Deferral linked to this plan
// ---------------------------------------------------------------------------

export interface PostponePlanInput {
  newDueDate?: string | Date | null;
  newDueHours?: number | null;
  justification: string;
  compensatoryMeasures?: string | null;
  authorizedBy?: string | null;
}

type MinimalDeferralRow = { deferralCode: string };

type DeferralWriteDelegate = {
  findMany(args: { where: Record<string, unknown> }): Promise<MinimalDeferralRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<{ id: string; deferralCode: string; status: string }>;
};

export async function postponePlan(
  session: TenantAccessSession,
  id: string,
  payload: PostponePlanInput,
) {
  ensureCanManagePlans(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);
  const deferral = (prismaRaw as unknown as { deferral: DeferralWriteDelegate }).deferral;

  const plan = await getTenantMaintenancePlan(session, id);
  const justification = normalizeRequiredText(payload.justification, "justification");
  const authorizedBy = normalizeOptionalText(payload.authorizedBy);
  const newDueDate = parseOptionalDate(payload.newDueDate, "newDueDate");
  const newDueHours = normalizeOptionalNumber(payload.newDueHours, "newDueHours");

  const aplYear = new Date().getFullYear();
  const aplYY = String(aplYear).slice(-2);
  const aplCount = await deferral.count({ where: { tenantId: plan.tenantId, vesselCode: plan.vesselCode, createdAt: { gte: new Date(aplYear, 0, 1), lt: new Date(aplYear + 1, 0, 1) } } });
  const deferralCode = `APL-${plan.vesselCode}-${aplYY}-${String(aplCount + 1).padStart(4, "0")}`;

  const deferralStatus = authorizedBy ? "APPROVED" : "REQUESTED";
  const now = new Date();

  const created = await deferral.create({
    data: {
      tenantId: plan.tenantId,
      vesselCode: plan.vesselCode,
      assetId: plan.assetId,
      deferralCode,
      sourceType: "MAINTENANCE_PLAN",
      sourceId: plan.id,
      status: deferralStatus,
      requestedAt: now,
      requestedByUserId: session.user.id,
      targetDate: newDueDate,
      justification,
      compensatoryMeasures: normalizeOptionalText(payload.compensatoryMeasures),
      reviewNotes: authorizedBy ? `Autorizado por: ${authorizedBy}` : null,
      decidedByUserId: authorizedBy ? session.user.id : null,
      decisionAt: authorizedBy ? now : null,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  // When authorized and new due values are provided, update the plan
  let updatedPlan = plan;
  if (authorizedBy && (newDueDate || newDueHours !== null)) {
    const updateData: Record<string, unknown> = { updatedByUserId: session.user.id };
    if (newDueDate) updateData.nextDueDate = newDueDate;
    if (newDueHours !== null) updateData.nextDueHours = newDueHours;
    updatedPlan = await prisma.maintenancePlan.update({ where: { id: plan.id }, data: updateData });
  }

  void publishAudit(prismaRaw, {
    tenantId: plan.tenantId,
    actorUserId: session.user.id,
    action: "MaintenancePlan.postponed",
    entityType: "MaintenancePlan",
    entityId: plan.id,
    metadata: {
      deferralCode,
      taskCode: plan.taskCode,
      vesselCode: plan.vesselCode,
      authorizedBy,
      status: deferralStatus,
    },
  });

  return { deferral: created, plan: updatedPlan };
}

// ---------------------------------------------------------------------------
// restorePlanAfterWoCancellation — revert plan executionStatus when its WO is cancelled
// ---------------------------------------------------------------------------

export async function restorePlanAfterWoCancellation(
  session: TenantAccessSession,
  planId: string,
): Promise<void> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return;
  const prisma = maintenanceClient(prismaRaw);

  const plan = await prisma.maintenancePlan.findFirst({ where: { id: planId, deletedAt: null } });
  if (!plan) return;

  // Re-derive status ignoring the IN_WINDOW override (WO no longer active)
  const restoredStatus = deriveExecutionStatus({ ...plan, executionStatus: null });

  await prisma.maintenancePlan.update({
    where: { id: planId },
    data: { executionStatus: restoredStatus, updatedByUserId: session.user.id },
  });
}
