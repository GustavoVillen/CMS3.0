import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";

export interface CapaListFilters {
  vesselCode?: string | null;
  status?: string | null;
  priority?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}

export interface CreateCapaRecordInput {
  vesselCode: string;
  assetId: string;
  sourceType: "RCA" | "DEFECT" | "WORK_ORDER" | "INSPECTION";
  sourceId: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description?: string | null;
  owner?: string | null;
  dueDate?: string | Date | null;
}

export interface UpdateCapaRecordInput {
  vesselCode?: string;
  assetId?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title?: string;
  description?: string | null;
  owner?: string | null;
  dueDate?: string | Date | null;
}

interface CapaRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  sourceType: string;
  sourceId: string;
  capaCode: string;
  status: string;
  priority: string;
  title: string;
  description: string | null;
  owner: string | null;
  dueDate: Date | null;
  completedAt: Date | null;
  verificationNote: string | null;
  cancelReason: string | null;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
}

type CapaDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<CapaRecord[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<CapaRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<CapaRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<CapaRecord>;
};

interface CapaPrismaClient {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  capaRecord: CapaDelegate;
}

function capaDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): CapaDelegate {
  return (prisma as unknown as { capaRecord: CapaDelegate }).capaRecord;
}

function capaClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): CapaPrismaClient {
  return prisma as unknown as CapaPrismaClient;
}

function ensureCanManageCapa(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "FLEET_SUPERINTENDENT" && session.user.role !== "MAINTENANCE_MANAGER") {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar CAPA.");
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
  const prisma = capaClient(prismaRaw);
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

export async function listCapaRecords(session: TenantAccessSession, filters: CapaListFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return [];
  const capa = capaDelegate(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.sourceType) where.sourceType = filters.sourceType;
  if (filters.sourceId) where.sourceId = filters.sourceId;

  const records = await capa.findMany({ where, orderBy: { createdAt: "desc" } });
  const assetIds = [...new Set(records.map(r => r.assetId).filter(Boolean))];
  const assetRows = assetIds.length > 0
    ? await (prismaRaw as unknown as { asset: { findMany(a: unknown): Promise<{ id: string; name: string | null }[]> } }).asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, name: true } })
    : [];
  const assetNameMap = new Map(assetRows.map(a => [a.id, a.name ?? null]));
  return records.map(r => ({ ...r, assetName: assetNameMap.get(r.assetId) ?? null }));
}

export async function getCapaRecord(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await capa.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "CAPA no encontrada.");
  return record;
}

export async function createCapaRecord(session: TenantAccessSession, payload: CreateCapaRecordInput) {
  ensureCanManageCapa(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);
  const assetId = normalizeRequiredText(payload.assetId, "assetId");
  const sourceId = normalizeRequiredText(payload.sourceId, "sourceId");

  // Validar tenant ownership de assetId y sourceId.
  const assetCount = await (prismaRaw as any).asset.count({
    where: { id: assetId, tenantId, deletedAt: null },
  });
  if (assetCount === 0) {
    throw new RouteError(404, "ASSET_NOT_FOUND", "Asset no encontrado o no pertenece a este tenant.");
  }
  const sourceModel = payload.sourceType === "DEFECT" ? "defect"
    : payload.sourceType === "WORK_ORDER" ? "workOrder"
    : payload.sourceType === "INSPECTION" ? "inspection"
    : null;
  if (sourceModel) {
    const sourceCount = await (prismaRaw as any)[sourceModel].count({
      where: { id: sourceId, tenantId, deletedAt: null },
    });
    if (sourceCount === 0) {
      throw new RouteError(404, "SOURCE_NOT_FOUND", "Origen no encontrado o no pertenece a este tenant.");
    }
  }

  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const capaCount = await capa.count({ where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
  const capaCode = `CAPA-${vesselCode}-${yy}-${String(capaCount + 1).padStart(4, "0")}`;
  const created = await capa.create({
    data: {
      tenantId,
      vesselCode,
      assetId,
      sourceType: payload.sourceType,
      sourceId,
      capaCode,
      status: "OPEN",
      priority: payload.priority ?? "MEDIUM",
      title: normalizeRequiredText(payload.title, "title"),
      description: normalizeOptionalText(payload.description),
      owner: normalizeOptionalText(payload.owner),
      dueDate: parseOptionalDate(payload.dueDate, "dueDate"),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prismaRaw, {
    tenantId,
    actorUserId: session.user.id,
    action: "Capa.created",
    entityType: "Capa",
    entityId: created.id,
    metadata: { capaCode: created.capaCode, title: created.title, vesselCode: created.vesselCode },
  });
  return created;
}

export async function updateCapaRecord(session: TenantAccessSession, id: string, payload: UpdateCapaRecordInput) {
  ensureCanManageCapa(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const current = await getCapaRecord(session, id);
  if (current.status === "CLOSED" || current.status === "CANCELLED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", "No se puede editar un CAPA cerrado o cancelado.");
  }
  if (payload.vesselCode !== undefined) {
    const requested = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
    if (requested !== current.vesselCode) {
      throw new RouteError(400, "VESSEL_IMMUTABLE", "No se permite cambiar vesselCode.");
    }
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.assetId !== undefined) data.assetId = normalizeRequiredText(payload.assetId, "assetId");
  if (payload.priority !== undefined) data.priority = payload.priority;
  if (payload.title !== undefined) data.title = normalizeRequiredText(payload.title, "title");
  if (payload.description !== undefined) data.description = normalizeOptionalText(payload.description);
  if (payload.owner !== undefined) data.owner = normalizeOptionalText(payload.owner);
  if (payload.dueDate !== undefined) data.dueDate = parseOptionalDate(payload.dueDate, "dueDate");

  const updated = await capa.update({ where: { id: current.id }, data });
  void publishAudit(prismaRaw, {
    tenantId: updated.tenantId,
    actorUserId: session.user.id,
    action: "Capa.updated",
    entityType: "Capa",
    entityId: updated.id,
    metadata: { capaCode: updated.capaCode, title: updated.title, vesselCode: updated.vesselCode },
  });
  return updated;
}

export async function completeCapaRecord(session: TenantAccessSession, id: string, payload: { verificationNote?: string }) {
  ensureCanManageCapa(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const current = await getCapaRecord(session, id);
  ensureStatus(current.status, "IN_PROGRESS", "Complete");

  const completed = await capa.update({
    where: { id: current.id },
    data: {
      status: "PENDING_VERIFICATION",
      completedAt: new Date(),
      verificationNote: normalizeOptionalText(payload.verificationNote),
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prismaRaw, {
    tenantId: completed.tenantId,
    actorUserId: session.user.id,
    action: "Capa.completed",
    entityType: "Capa",
    entityId: completed.id,
    metadata: { capaCode: completed.capaCode, title: completed.title, vesselCode: completed.vesselCode },
  });
  return completed;
}

export async function closeCapaRecord(session: TenantAccessSession, id: string, payload: { verificationNote: string }) {
  ensureCanManageCapa(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const current = await getCapaRecord(session, id);
  ensureStatus(current.status, "PENDING_VERIFICATION", "Close");

  return capa.update({
    where: { id: current.id },
    data: {
      status: "CLOSED",
      verificationNote: normalizeRequiredText(payload.verificationNote, "verificationNote"),
      updatedByUserId: session.user.id,
    },
  });
}

export async function cancelCapaRecord(session: TenantAccessSession, id: string, payload: { cancelReason: string }) {
  ensureTenantAdmin(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const current = await getCapaRecord(session, id);
  if (current.status === "CLOSED" || current.status === "CANCELLED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `No se puede cancelar desde estado ${current.status}.`);
  }

  return capa.update({
    where: { id: current.id },
    data: {
      status: "CANCELLED",
      cancelReason: normalizeRequiredText(payload.cancelReason, "cancelReason"),
      updatedByUserId: session.user.id,
    },
  });
}
