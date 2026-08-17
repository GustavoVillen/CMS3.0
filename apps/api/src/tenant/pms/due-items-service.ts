import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { log } from "../../common/logger";
import { loadCurrentHoursNumberByAsset } from "../asset-hours/asset-hours-service";

export interface DueItemsFilters {
  vesselCode?: string | null;
  triggerType?: string | null;
  executionStatus?: string | null;
  assetId?: string | null;
}

export interface DueItemsSummary {
  upcoming: number;
  inWindow: number;
  due: number;
  overdue: number;
  total: number;
}

interface MaintenancePlanRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  triggerType: string;
  status?: string | null;
  executionStatus?: string | null;
  nextDueDate?: Date | null;
  nextDueHours?: number | null;
  windowOpenDate?: Date | null;
  windowOpenHours?: number | null;
  frequencyHours?: number | null;
  checklistTemplate?: string | null;
  lastExecutionDate?: Date | null;
  lastExecutionHours?: number | null;
  deletedAt: Date | null;
}

interface MaintenancePlanDelegate {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<MaintenancePlanRecord[]>;
}

interface DueItemsPrismaClient {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  maintenancePlan: MaintenancePlanDelegate;
}

const DUE_EXECUTION_STATUSES = ["DUE", "OVERDUE", "IN_WINDOW", "UPCOMING"] as const;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function dueItemsClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): DueItemsPrismaClient {
  return prisma as unknown as DueItemsPrismaClient;
}

function maintenancePlanDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): MaintenancePlanDelegate {
  return (prisma as unknown as { maintenancePlan: MaintenancePlanDelegate }).maintenancePlan;
}

function isUnknownExecutionStatusArgument(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return message.includes("Unknown argument `executionStatus`");
}

function deriveHoursStatus(plan: MaintenancePlanRecord, currentHours: number | null): string | null {
  if (plan.nextDueHours == null) return null;
  if (currentHours == null) return null;

  const freq = plan.frequencyHours && plan.frequencyHours > 0 ? plan.frequencyHours : null;
  const remaining = plan.nextDueHours - currentHours;

  if (remaining <= 0) return "OVERDUE";

  // DUE: within 5% of frequency before due (or within 50 h if no frequency set)
  const dueThreshold = freq ? freq * 0.05 : 50;
  if (remaining <= dueThreshold) return "DUE";

  if (plan.windowOpenHours != null && currentHours >= plan.windowOpenHours) return "IN_WINDOW";

  // UPCOMING: within 20% of frequency before due (or within 200 h if no frequency set)
  const upcomingThreshold = freq ? freq * 0.2 : 200;
  if (remaining <= upcomingThreshold) return "UPCOMING";

  return "FUTURE";
}

function deriveExecutionStatus(
  plan: MaintenancePlanRecord,
  now: Date,
  currentHoursByAsset: Map<string, number>,
): string {
  if (plan.status === "OVERDUE") return "OVERDUE";

  const isHoursTrigger = plan.triggerType === "HOURS" || plan.triggerType === "RUNNING_HOURS";
  if (isHoursTrigger) {
    const currentHours = currentHoursByAsset.get(plan.assetId) ?? null;
    const hoursStatus = deriveHoursStatus(plan, currentHours);
    if (hoursStatus) return hoursStatus;
    // No live hours data — use stored executionStatus if it's a meaningful due status.
    if (plan.nextDueHours != null) {
      const stored = plan.executionStatus ?? null;
      if (stored && DUE_EXECUTION_STATUSES.includes(stored as (typeof DUE_EXECUTION_STATUSES)[number])) {
        return stored;
      }
      return "FUTURE"; // hours plan but no data yet — don't show
    }
    // Fall through to date-based only if no nextDueHours configured.
  }

  const nextDueDate = plan.nextDueDate ? new Date(plan.nextDueDate) : null;
  const windowOpenDate = plan.windowOpenDate ? new Date(plan.windowOpenDate) : null;

  if (nextDueDate) {
    const delta = nextDueDate.getTime() - now.getTime();
    if (delta < 0) return "OVERDUE";
    if (delta <= ONE_DAY_MS) return "DUE";
    if (windowOpenDate && now.getTime() >= windowOpenDate.getTime()) return "IN_WINDOW";
    if (plan.lastExecutionDate) {
      const msSinceExecution = now.getTime() - new Date(plan.lastExecutionDate).getTime();
      if (msSinceExecution < ONE_DAY_MS) return "COMPLETED";
    }
    if (delta <= THIRTY_DAYS_MS) return "UPCOMING";
    return "FUTURE";
  }

  if (plan.status === "DUE_SOON") return "UPCOMING";
  return "FUTURE";
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = dueItemsClient(prismaRaw);
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

function applyVesselScope(
  session: TenantAccessSession,
  where: Record<string, unknown>,
  requestedVesselCode?: string | null,
) {
  if (session.user.role === "TENANT_ADMIN") {
    if (requestedVesselCode) where.vesselCode = requestedVesselCode;
    return;
  }

  if (requestedVesselCode) {
    if (!session.user.assignedVesselCodes.includes(requestedVesselCode)) {
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

export async function listDueItems(session: TenantAccessSession, filters: DueItemsFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return [];
  const maintenancePlan = maintenancePlanDelegate(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.triggerType) where.triggerType = filters.triggerType;
  if (filters.assetId) where.assetId = filters.assetId;

  const requestedStatus = filters.executionStatus ?? null;
  if (requestedStatus && !DUE_EXECUTION_STATUSES.includes(requestedStatus as (typeof DUE_EXECUTION_STATUSES)[number])) {
    return [];
  }

  // Fetch all non-deleted, non-completed plans and derive executionStatus dynamically
  // so VesselPlan is always accurate regardless of when executionStatus was last stored.
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + THIRTY_DAYS_MS);

  const windowedWhere: Record<string, unknown> = {
    ...where,
    deletedAt: null,
    OR: [
      { nextDueDate: { lte: thirtyDaysFromNow } },
      { triggerType: { in: ["HOURS", "RUNNING_HOURS"] } },
      { executionStatus: { in: DUE_EXECUTION_STATUSES } },
    ],
  };

  let raw: MaintenancePlanRecord[];
  try {
    raw = await maintenancePlan.findMany({
      where: windowedWhere,
      orderBy: [{ nextDueDate: "asc" }, { nextDueHours: "asc" }],
    });
  } catch {
    raw = await maintenancePlan.findMany({
      where,
      orderBy: [{ nextDueDate: "asc" }, { nextDueHours: "asc" }],
    });
  }

  const assetIds = Array.from(new Set(raw.map((p) => p.assetId).filter(Boolean)));
  const currentHoursByAsset = await loadCurrentHoursNumberByAsset(prismaRaw, tenantId, assetIds);

  const computed = raw.map((item) => ({
    ...item,
    executionStatus: deriveExecutionStatus(item, now, currentHoursByAsset),
    currentHours: currentHoursByAsset.get(item.assetId) ?? null,
  }));

  // Exclude plans that already have an active Work Order open
  const planIdsWithActiveWO = new Set<string>();
  const planIds = computed.map(x => x.id);
  if (planIds.length > 0) {
    try {
      type WORow = { maintenancePlanId: string | null };
      const wos = await (prismaRaw as unknown as {
        workOrder: { findMany(args: { where: Record<string, unknown> }): Promise<WORow[]> };
      }).workOrder.findMany({
        where: {
          tenantId,
          maintenancePlanId: { in: planIds },
          status: { in: ["PLANNED", "IN_PROGRESS", "ON_HOLD"] },
        },
      });
      for (const wo of wos) {
        if (wo.maintenancePlanId) planIdsWithActiveWO.add(wo.maintenancePlanId);
      }
    } catch (err) {
      log.error("[due-items] WO filter failed:", err);
    }
  }

  const active = computed.filter(item => !planIdsWithActiveWO.has(item.id));

  if (requestedStatus) {
    return active.filter((item) => item.executionStatus === requestedStatus);
  }
  return active.filter((item) =>
    DUE_EXECUTION_STATUSES.includes(item.executionStatus as (typeof DUE_EXECUTION_STATUSES)[number]),
  );
}

export async function getDueItemsSummary(session: TenantAccessSession, vesselCode?: string | null): Promise<DueItemsSummary> {
  const items = await listDueItems(session, { vesselCode: vesselCode ?? null });
  const summary: DueItemsSummary = {
    upcoming: 0,
    inWindow: 0,
    due: 0,
    overdue: 0,
    total: 0,
  };

  for (const item of items) {
    if (item.executionStatus === "UPCOMING") summary.upcoming += 1;
    if (item.executionStatus === "IN_WINDOW") summary.inWindow += 1;
    if (item.executionStatus === "DUE") summary.due += 1;
    if (item.executionStatus === "OVERDUE") summary.overdue += 1;
  }

  summary.total = summary.upcoming + summary.inWindow + summary.due + summary.overdue;
  return summary;
}
