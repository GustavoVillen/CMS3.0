import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { log } from "../../common/logger";

export interface DeferralListFilters {
  vesselCode?: string | null;
  status?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}

export interface CreateDeferralInput {
  vesselCode: string;
  assetId: string;
  sourceType: "DEFECT" | "WORK_ORDER" | "MAINTENANCE_PLAN";
  sourceId: string;
  requestedAt?: string | Date | null;
  targetDate?: string | Date | null;
  justification?: string | null;
  compensatoryMeasures?: string | null;
  reviewNotes?: string | null;
}

interface DeferralRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  sourceType: string;
  sourceId: string;
  deferralCode: string;
  status: string;
  requestedAt: Date;
  requestedByUserId: string;
  targetDate: Date | null;
  justification: string | null;
  compensatoryMeasures: string | null;
  reviewNotes: string | null;
  decisionAt: Date | null;
  decidedByUserId: string | null;
  approverName: string | null;
  rejectorName: string | null;
  activeSince: Date | null;
  expiredAt: Date | null;
  closedAt: Date | null;
  closeNotes: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
}

type DeferralDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<DeferralRecord[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<DeferralRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<DeferralRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<DeferralRecord>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
};

interface DeferralsPrismaClient {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  deferral: DeferralDelegate;
}

function deferralDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): DeferralDelegate {
  return (prisma as unknown as { deferral: DeferralDelegate }).deferral;
}

function deferralsClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): DeferralsPrismaClient {
  return prisma as unknown as DeferralsPrismaClient;
}

function ensureCanManageDeferrals(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "FLEET_SUPERINTENDENT" && session.user.role !== "MAINTENANCE_MANAGER") {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar deferrals.");
  }
}

function ensureTenantAdmin(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Operacion permitida solo para TENANT_ADMIN.");
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

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha invalida en ${field}.`);
  return parsed;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = deferralsClient(prismaRaw);
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

function ensureStatus(current: string, expected: string, action: string) {
  if (current !== expected) {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `${action} requiere estado ${expected} (actual: ${current}).`);
  }
}

export async function listDeferrals(session: TenantAccessSession, filters: DeferralListFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return [];
  const deferral = deferralDelegate(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.sourceType) where.sourceType = filters.sourceType;
  if (filters.sourceId) where.sourceId = filters.sourceId;

  const records = await deferral.findMany({ where, orderBy: { requestedAt: "desc" } });
  if (records.length === 0) return [];

  const assetIds = [...new Set(records.map(r => r.assetId).filter(Boolean))];
  const assetRows = assetIds.length > 0
    ? await (prismaRaw as unknown as { asset: { findMany(a: unknown): Promise<{ id: string; name: string | null }[]> } }).asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, name: true } })
    : [];
  const assetNameMap = new Map(assetRows.map(a => [a.id, a.name ?? null]));

  // Batch-resolve source codes by type
  const woIds   = records.filter(r => r.sourceType === "WORK_ORDER"      ).map(r => r.sourceId);
  const defIds  = records.filter(r => r.sourceType === "DEFECT"           ).map(r => r.sourceId);
  const planIds = records.filter(r => r.sourceType === "MAINTENANCE_PLAN" ).map(r => r.sourceId);

  const prisma = prismaRaw as unknown as {
    workOrder:       { findMany(a: unknown): Promise<{ id: string; workOrderCode: string }[]> };
    defect:          { findMany(a: unknown): Promise<{ id: string; defectCode:    string }[]> };
    maintenancePlan: { findMany(a: unknown): Promise<{ id: string; taskCode:      string }[]> };
  };

  const [workOrders, defects, plans] = await Promise.all([
    woIds.length   > 0 ? prisma.workOrder.findMany(      { where: { id: { in: woIds   }, tenantId }, select: { id: true, workOrderCode: true } }) : [],
    defIds.length  > 0 ? prisma.defect.findMany(         { where: { id: { in: defIds  }, tenantId }, select: { id: true, defectCode:    true } }) : [],
    planIds.length > 0 ? prisma.maintenancePlan.findMany({ where: { id: { in: planIds }, tenantId }, select: { id: true, taskCode:      true } }) : [],
  ]);

  const codeMap = new Map<string, string>();
  workOrders.forEach(r => codeMap.set(r.id, r.workOrderCode));
  defects.forEach(r    => codeMap.set(r.id, r.defectCode));
  plans.forEach(r      => codeMap.set(r.id, r.taskCode));

  // Resolve requesters and decision-makers display names in a single batch
  const userIds = [...new Set([
    ...records.map(r => r.requestedByUserId).filter((v): v is string => !!v),
    ...records.map(r => r.decidedByUserId).filter((v): v is string => !!v),
  ])];
  const userRows = userIds.length > 0
    ? await (prismaRaw as unknown as { user: { findMany(a: unknown): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string }[]> } })
        .user.findMany({ where: { id: { in: userIds }, memberships: { some: { tenantId, status: "ACTIVE" } } }, select: { id: true, firstName: true, lastName: true, email: true } })
    : [];
  const userNameMap = new Map(userRows.map(u => {
    const full = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
    return [u.id, full || u.email];
  }));

  return records.map(r => ({
    ...r,
    assetName:       assetNameMap.get(r.assetId) ?? null,
    sourceCode:      codeMap.get(r.sourceId) ?? null,
    requestedByName: r.requestedByUserId ? userNameMap.get(r.requestedByUserId) ?? null : null,
    decidedByName:   r.decidedByUserId   ? userNameMap.get(r.decidedByUserId)   ?? null : null,
  }));
}

export async function getDeferral(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const deferral = deferralDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await deferral.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Deferral no encontrado.");
  let assetName: string | null = null;
  try {
    const assetRow = await (prismaRaw as unknown as { asset: { findFirst(a: unknown): Promise<{ name: string | null } | null> } })
      .asset.findFirst({ where: { id: record.assetId, tenantId }, select: { name: true } });
    assetName = assetRow?.name ?? null;
  } catch { /* non-blocking */ }

  const userIds = [record.requestedByUserId, record.decidedByUserId].filter((v): v is string => !!v);
  const userMap = new Map<string, string>();
  if (userIds.length > 0) {
    try {
      const userRows = await (prismaRaw as unknown as { user: { findMany(a: unknown): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string }[]> } })
        .user.findMany({ where: { id: { in: userIds }, memberships: { some: { tenantId, status: "ACTIVE" } } }, select: { id: true, firstName: true, lastName: true, email: true } });
      for (const u of userRows) {
        const fullName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
        userMap.set(u.id, fullName || u.email);
      }
    } catch { /* non-blocking */ }
  }

  return {
    ...record,
    assetName,
    requestedByName: record.requestedByUserId ? userMap.get(record.requestedByUserId) ?? null : null,
    decidedByName:   record.decidedByUserId   ? userMap.get(record.decidedByUserId)   ?? null : null,
  };
}

async function createDeferralCore(session: TenantAccessSession, payload: CreateDeferralInput) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const deferral = deferralDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  const assetId = normalizeRequiredText(payload.assetId, "assetId");
  const sourceId = normalizeRequiredText(payload.sourceId, "sourceId");

  // Validar tenant ownership de assetId y sourceId — sin esto, un atacante
  // podría inyectar IDs cross-tenant y los lookups de display leakean
  // codes de WO/defect/plan ajenos. (Defense-in-depth en lookups ya está,
  // pero el fix root es validar acá.)
  const assetCount = await (prismaRaw as any).asset.count({
    where: { id: assetId, tenantId, deletedAt: null },
  });
  if (assetCount === 0) {
    throw new RouteError(404, "ASSET_NOT_FOUND", "Asset no encontrado o no pertenece a este tenant.");
  }

  const sourceModel = payload.sourceType === "WORK_ORDER" ? "workOrder"
    : payload.sourceType === "DEFECT" ? "defect"
    : payload.sourceType === "MAINTENANCE_PLAN" ? "maintenancePlan"
    : null;
  if (sourceModel) {
    const sourceCount = await (prismaRaw as any)[sourceModel].count({
      where: { id: sourceId, tenantId, deletedAt: null },
    });
    if (sourceCount === 0) {
      throw new RouteError(404, "SOURCE_NOT_FOUND", "Origen del aplazamiento no encontrado o no pertenece a este tenant.");
    }
  }

  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const deferralCount = await deferral.count({ where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
  const deferralCode = `APL-${vesselCode}-${yy}-${String(deferralCount + 1).padStart(4, "0")}`;
  const created = await deferral.create({
    data: {
      tenantId,
      vesselCode,
      assetId,
      sourceType: payload.sourceType,
      sourceId,
      deferralCode,
      status: "REQUESTED",
      requestedAt: parseOptionalDate(payload.requestedAt, "requestedAt") ?? new Date(),
      requestedByUserId: session.user.id,
      targetDate: parseOptionalDate(payload.targetDate, "targetDate"),
      justification: normalizeOptionalText(payload.justification),
      compensatoryMeasures: normalizeOptionalText(payload.compensatoryMeasures),
      reviewNotes: normalizeOptionalText(payload.reviewNotes),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prismaRaw, {
    tenantId,
    actorUserId: session.user.id,
    action: "Deferral.created",
    entityType: "Deferral",
    entityId: created.id,
    metadata: { deferralCode: created.deferralCode, vesselCode: created.vesselCode, sourceType: created.sourceType },
  });
  return created;
}

export async function createDeferralInternal(session: TenantAccessSession, payload: CreateDeferralInput) {
  return createDeferralCore(session, payload);
}

export async function createDeferral(session: TenantAccessSession, payload: CreateDeferralInput) {
  ensureCanManageDeferrals(session);
  applyVesselScope(session, {}, normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase(), true);
  return createDeferralCore(session, payload);
}

export async function reviewDeferral(
  session: TenantAccessSession,
  id: string,
  payload: { reviewNotes?: string; compensatoryMeasures?: string | null },
) {
  ensureCanManageDeferrals(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const deferral = deferralDelegate(prismaRaw);

  const current = await getDeferral(session, id);
  ensureStatus(current.status, "REQUESTED", "Review");

  const data: Record<string, unknown> = {
    status: "UNDER_REVIEW",
    reviewNotes: normalizeOptionalText(payload.reviewNotes),
    updatedByUserId: session.user.id,
  };
  if (payload.compensatoryMeasures !== undefined) {
    data.compensatoryMeasures = normalizeOptionalText(payload.compensatoryMeasures);
  }

  return deferral.update({ where: { id: current.id }, data });
}

export async function approveDeferral(
  session: TenantAccessSession,
  id: string,
  payload: { targetDate?: string | Date | null; compensatoryMeasures?: string | null; approverName: string },
) {
  ensureTenantAdmin(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const deferral = deferralDelegate(prismaRaw);

  const current = await getDeferral(session, id);
  ensureStatus(current.status, "UNDER_REVIEW", "Approve");

  const approverName = normalizeRequiredText(payload.approverName, "approverName");

  const approved = await deferral.update({
    where: { id: current.id },
    data: {
      status: "APPROVED",
      targetDate: parseOptionalDate(payload.targetDate, "targetDate"),
      compensatoryMeasures: normalizeOptionalText(payload.compensatoryMeasures),
      decisionAt: new Date(),
      decidedByUserId: session.user.id,
      approverName,
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prismaRaw, {
    tenantId: approved.tenantId,
    actorUserId: session.user.id,
    action: "Deferral.approved",
    entityType: "Deferral",
    entityId: approved.id,
    metadata: { deferralCode: approved.deferralCode, vesselCode: approved.vesselCode, sourceType: approved.sourceType },
  });
  return approved;
}

export async function rejectDeferral(
  session: TenantAccessSession,
  id: string,
  payload: { rejectionReason: string; rejectorName: string },
) {
  ensureTenantAdmin(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const deferral = deferralDelegate(prismaRaw);

  const current = await getDeferral(session, id);
  ensureStatus(current.status, "UNDER_REVIEW", "Reject");

  const rejectorName = normalizeRequiredText(payload.rejectorName, "rejectorName");

  const rejected = await deferral.update({
    where: { id: current.id },
    data: {
      status: "REJECTED",
      rejectionReason: normalizeRequiredText(payload.rejectionReason, "rejectionReason"),
      decisionAt: new Date(),
      decidedByUserId: session.user.id,
      rejectorName,
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prismaRaw, {
    tenantId: rejected.tenantId,
    actorUserId: session.user.id,
    action: "Deferral.rejected",
    entityType: "Deferral",
    entityId: rejected.id,
    metadata: { deferralCode: rejected.deferralCode, vesselCode: rejected.vesselCode, sourceType: rejected.sourceType },
  });
  return rejected;
}

export async function activateDeferral(session: TenantAccessSession, id: string) {
  ensureCanManageDeferrals(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const deferral = deferralDelegate(prismaRaw);

  const current = await getDeferral(session, id);
  ensureStatus(current.status, "APPROVED", "Activate");

  return deferral.update({
    where: { id: current.id },
    data: {
      status: "ACTIVE",
      activeSince: new Date(),
      updatedByUserId: session.user.id,
    },
  });
}

export async function updateDeferral(
  session: TenantAccessSession,
  id: string,
  payload: { justification?: string | null; compensatoryMeasures?: string | null; targetDate?: string | Date | null },
) {
  ensureCanManageDeferrals(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const deferral = deferralDelegate(prismaRaw);

  const current = await getDeferral(session, id);
  if (current.status !== "REQUESTED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo se puede editar un aplazamiento en estado REQUESTED (actual: ${current.status}).`);
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.justification        !== undefined) data.justification        = normalizeOptionalText(payload.justification);
  if (payload.compensatoryMeasures !== undefined) data.compensatoryMeasures = normalizeOptionalText(payload.compensatoryMeasures);
  if (payload.targetDate           !== undefined) data.targetDate           = parseOptionalDate(payload.targetDate, "targetDate");

  return deferral.update({ where: { id: current.id }, data });
}

export async function cancelDeferral(session: TenantAccessSession, id: string) {
  ensureCanManageDeferrals(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const deferral = deferralDelegate(prismaRaw);

  const current = await getDeferral(session, id);
  ensureStatus(current.status, "REQUESTED", "Cancel");

  const cancelled = await deferral.update({
    where: { id: current.id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });

  // Revert source entity status when applicable.
  // The deferral was auto-created by holdWorkOrder which set the WO to ON_HOLD.
  // Cancelling the deferral should restore the WO to PLANNED and clear holdReason.
  if (current.sourceType === "WORK_ORDER") {
    try {
      const woClient = (prismaRaw as unknown as {
        workOrder: {
          findUnique(a: { where: { id: string }; select?: Record<string, boolean> }): Promise<{ status: string } | null>;
          update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
        };
      }).workOrder;
      const wo = await woClient.findUnique({ where: { id: current.sourceId }, select: { status: true } });
      if (wo?.status === "ON_HOLD") {
        await woClient.update({
          where: { id: current.sourceId },
          data: { status: "PLANNED", holdReason: null, updatedByUserId: session.user.id },
        });
      }
    } catch (err) {
      log.error("[cancelDeferral] failed to revert WO status:", err);
    }
  }

  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Deferral.cancelled",
    entityType: "Deferral",
    entityId: current.id,
    metadata: { deferralCode: current.deferralCode, vesselCode: current.vesselCode, sourceType: current.sourceType },
  });
  return cancelled;
}

export async function closeDeferral(session: TenantAccessSession, id: string, payload: { closeNotes?: string }) {
  ensureCanManageDeferrals(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const deferral = deferralDelegate(prismaRaw);

  const current = await getDeferral(session, id);
  ensureStatus(current.status, "ACTIVE", "Close");

  return deferral.update({
    where: { id: current.id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closeNotes: normalizeOptionalText(payload.closeNotes),
      updatedByUserId: session.user.id,
    },
  });
}
