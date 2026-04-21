import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevSpareOrdersForTenant } from "../../platform/data/dev-domain-store";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";

export interface SpareOrderListFilters {
  vesselCode?: string | null;
  status?: string | null;
  priority?: string | null;
}

export interface CreateSpareOrderInput {
  vesselCode: string;
  status?: "DRAFT" | "REQUESTED" | "APPROVED" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  providerId?: string | null;
  requestedAt: string | Date;
  expectedDeliveryDate?: string | Date | null;
  totalLines?: number;
  totalCost?: number | null;
  currency?: string | null;
  notes?: string | null;
}

export interface UpdateSpareOrderInput {
  vesselCode?: string;
  status?: "DRAFT" | "REQUESTED" | "APPROVED" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  providerId?: string | null;
  requestedAt?: string | Date;
  expectedDeliveryDate?: string | Date | null;
  totalLines?: number;
  totalCost?: number | null;
  currency?: string | null;
  notes?: string | null;
}

function canManage(session: TenantAccessSession): boolean {
  return ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "PROCUREMENT_STORE"].includes(session.user.role);
}

function normalizeText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function parseDate(value: unknown, field: string): Date {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  return parsed;
}

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  return parseDate(value, field);
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

function applyVesselScope(session: TenantAccessSession, where: Record<string, unknown>, vesselCode?: string | null, forbid = false) {
  if (session.user.role === "TENANT_ADMIN") {
    if (vesselCode) where.vesselCode = vesselCode;
    return;
  }

  if (vesselCode) {
    if (!session.user.assignedVesselCodes.includes(vesselCode)) {
      if (forbid) throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
      where.vesselCode = "__NO_MATCH__";
      return;
    }
    where.vesselCode = vesselCode;
    return;
  }

  if (session.user.assignedVesselCodes.length === 0) {
    where.vesselCode = "__NO_MATCH__";
    return;
  }
  where.vesselCode = { in: session.user.assignedVesselCodes };
}

export async function listTenantSpareOrders(session: TenantAccessSession, filters: SpareOrderListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevSpareOrdersForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;

  const orders = await prisma.spareOrder.findMany({ where, orderBy: { requestedAt: "desc" } });
  const providerIds = [...new Set(orders.map(o => o.providerId).filter(Boolean))] as string[];
  const providers = providerIds.length > 0
    ? await prisma.provider.findMany({ where: { id: { in: providerIds } }, select: { id: true, name: true } })
    : [];
  const providerMap = new Map(providers.map(p => [p.id, p.name]));
  return orders.map(o => ({ ...o, providerName: o.providerId ? (providerMap.get(o.providerId) ?? null) : null }));
}

export async function getTenantSpareOrder(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where, null, true);

  const record = await prisma.spareOrder.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Spare order no encontrada.");
  let providerName: string | null = null;
  if (record.providerId) {
    try {
      const p = await prisma.provider.findFirst({ where: { id: record.providerId }, select: { name: true } });
      providerName = p?.name ?? null;
    } catch { /* non-blocking */ }
  }
  return { ...record, providerName };
}

export async function createSpareOrder(session: TenantAccessSession, payload: CreateSpareOrderInput) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para crear spare orders.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const vesselCode = normalizeText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);
  const orderCode = `ORD-${vesselCode}-${Date.now()}`;

  const created = await prisma.spareOrder.create({
    data: {
      tenantId,
      vesselCode,
      orderCode,
      status: payload.status ?? "DRAFT",
      priority: payload.priority ?? "MEDIUM",
      providerId: normalizeOptionalText(payload.providerId),
      requestedByUserId: session.user.id,
      requestedAt: parseDate(payload.requestedAt, "requestedAt"),
      expectedDeliveryDate: parseOptionalDate(payload.expectedDeliveryDate, "expectedDeliveryDate"),
      totalLines: payload.totalLines ?? 0,
      totalCost: payload.totalCost ?? null,
      currency: normalizeOptionalText(payload.currency),
      notes: normalizeOptionalText(payload.notes),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "SpareOrder.created",
    entityType: "SpareOrder",
    entityId: created.id,
    metadata: { orderCode: created.orderCode, vesselCode: created.vesselCode },
  });
  return created;
}

export async function updateSpareOrder(session: TenantAccessSession, id: string, payload: UpdateSpareOrderInput) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para editar spare orders.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getTenantSpareOrder(session, id);
  if (payload.vesselCode !== undefined && normalizeText(payload.vesselCode, "vesselCode").toUpperCase() !== current.vesselCode) {
    throw new RouteError(400, "VESSEL_IMMUTABLE", "No se permite cambiar vesselCode.");
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.status !== undefined) data.status = payload.status;
  if (payload.priority !== undefined) data.priority = payload.priority;
  if (payload.providerId !== undefined) data.providerId = normalizeOptionalText(payload.providerId);
  if (payload.requestedAt !== undefined) data.requestedAt = parseDate(payload.requestedAt, "requestedAt");
  if (payload.expectedDeliveryDate !== undefined) data.expectedDeliveryDate = parseOptionalDate(payload.expectedDeliveryDate, "expectedDeliveryDate");
  if (payload.totalLines !== undefined) data.totalLines = payload.totalLines;
  if (payload.totalCost !== undefined) data.totalCost = payload.totalCost;
  if (payload.currency !== undefined) data.currency = normalizeOptionalText(payload.currency);
  if (payload.notes !== undefined) data.notes = normalizeOptionalText(payload.notes);

  const updated = await prisma.spareOrder.update({ where: { id: current.id }, data });
  void publishAudit(prisma, {
    tenantId: updated.tenantId,
    actorUserId: session.user.id,
    action: "SpareOrder.updated",
    entityType: "SpareOrder",
    entityId: updated.id,
    metadata: { orderCode: updated.orderCode, vesselCode: updated.vesselCode },
  });
  return updated;
}

export async function deleteSpareOrder(session: TenantAccessSession, id: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para eliminar spare orders.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getTenantSpareOrder(session, id);
  if (current.status !== "DRAFT") {
    throw new RouteError(409, "ONLY_DRAFT_CAN_DELETE", "Solo se puede eliminar una orden en estado DRAFT.");
  }

  const deleted = await prisma.spareOrder.update({
    where: { id: current.id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "SpareOrder.deleted",
    entityType: "SpareOrder",
    entityId: current.id,
    metadata: { orderCode: current.orderCode, vesselCode: current.vesselCode },
  });
  return deleted;
}
