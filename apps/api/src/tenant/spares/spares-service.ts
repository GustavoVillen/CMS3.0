import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { listDevSparesForTenant } from "../../platform/data/dev-domain-store";
import { publishAudit } from "../../platform/audit/audit-publisher";

export interface SpareListFilters {
  vesselCode?: string | null;
  status?: string | null;
  criticality?: string | null;
  belowReorder?: boolean;
}

export interface CreateSpareInput {
  vesselCode: string;
  sku: string;
  name: string;
  category?: string | null;
  criticality?: "A" | "B" | "C";
  manufacturer?: string | null;
  model?: string | null;
  unit: string;
  currentStock?: number;
  minStock?: number;
  reorderPoint?: number;
  status?: "ACTIVE" | "OBSOLETE";
  location?: string | null;
}

export interface UpdateSpareInput {
  vesselCode?: string;
  sku?: string;
  name?: string;
  category?: string | null;
  criticality?: "A" | "B" | "C";
  manufacturer?: string | null;
  model?: string | null;
  unit?: string;
  currentStock?: number;
  minStock?: number;
  reorderPoint?: number;
  status?: "ACTIVE" | "OBSOLETE";
  location?: string | null;
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

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new RouteError(400, "VALIDATION_ERROR", "Valor numérico inválido.");
}

function parseBooleanQuery(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
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
  vesselCode?: string | null,
  forbidOutOfScope = false,
) {
  if (session.user.role === "TENANT_ADMIN") {
    if (vesselCode) where.vesselCode = vesselCode;
    return;
  }

  if (vesselCode) {
    if (!session.user.assignedVesselCodes.includes(vesselCode)) {
      if (forbidOutOfScope) throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
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

function isP2002(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && (error as { code?: unknown }).code === "P2002";
}

export async function listTenantSpares(session: TenantAccessSession, filters: SpareListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevSparesForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.criticality) where.criticality = filters.criticality;
  const items = await prisma.spare.findMany({ where, orderBy: [{ vesselCode: "asc" }, { sku: "asc" }] });
  if (!filters.belowReorder) return items;
  return items.filter((item) => item.currentStock <= item.reorderPoint);
}

export async function getTenantSpare(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where, null, true);

  const record = await prisma.spare.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Spare no encontrado.");
  return record;
}

export async function createTenantSpare(session: TenantAccessSession, payload: CreateSpareInput) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para crear spares.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);

  try {
    const created = await prisma.spare.create({
      data: {
        tenantId,
        vesselCode,
        sku: normalizeText(payload.sku, "sku").toUpperCase(),
        name: normalizeText(payload.name, "name"),
        category: normalizeOptionalText(payload.category),
        criticality: payload.criticality ?? "B",
        manufacturer: normalizeOptionalText(payload.manufacturer),
        model: normalizeOptionalText(payload.model),
        unit: normalizeText(payload.unit, "unit"),
        currentStock: payload.currentStock ?? 0,
        minStock: payload.minStock ?? 0,
        reorderPoint: payload.reorderPoint ?? 0,
        status: payload.status ?? "ACTIVE",
        location: normalizeOptionalText(payload.location),
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
      },
    });
    void publishAudit(prisma, {
      tenantId,
      actorUserId: session.user.id,
      action: "Spare.created",
      entityType: "Spare",
      entityId: created.id,
      metadata: { sku: created.sku, name: created.name, vesselCode: created.vesselCode },
    });
    return created;
  } catch (error: unknown) {
    if (isP2002(error)) {
      throw new RouteError(409, "DUPLICATE_SKU", "Ya existe un spare con ese SKU para el vessel.");
    }
    throw error;
  }
}

export async function updateTenantSpare(session: TenantAccessSession, id: string, payload: UpdateSpareInput) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para editar spares.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getTenantSpare(session, id);
  const vesselCandidate = payload.vesselCode ? normalizeText(payload.vesselCode, "vesselCode").toUpperCase() : current.vesselCode;
  applyVesselScope(session, {}, vesselCandidate, true);

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.vesselCode !== undefined) data.vesselCode = vesselCandidate;
  if (payload.sku !== undefined) data.sku = normalizeText(payload.sku, "sku").toUpperCase();
  if (payload.name !== undefined) data.name = normalizeText(payload.name, "name");
  if (payload.category !== undefined) data.category = normalizeOptionalText(payload.category);
  if (payload.criticality !== undefined) data.criticality = payload.criticality;
  if (payload.manufacturer !== undefined) data.manufacturer = normalizeOptionalText(payload.manufacturer);
  if (payload.model !== undefined) data.model = normalizeOptionalText(payload.model);
  if (payload.unit !== undefined) data.unit = normalizeText(payload.unit, "unit");
  if (payload.currentStock !== undefined) data.currentStock = normalizeOptionalNumber(payload.currentStock);
  if (payload.minStock !== undefined) data.minStock = normalizeOptionalNumber(payload.minStock);
  if (payload.reorderPoint !== undefined) data.reorderPoint = normalizeOptionalNumber(payload.reorderPoint);
  if (payload.status !== undefined) data.status = payload.status;
  if (payload.location !== undefined) data.location = normalizeOptionalText(payload.location);

  try {
    const updated = await prisma.spare.update({ where: { id: current.id }, data });
    void publishAudit(prisma, {
      tenantId: updated.tenantId,
      actorUserId: session.user.id,
      action: "Spare.updated",
      entityType: "Spare",
      entityId: updated.id,
      metadata: { sku: updated.sku, name: updated.name, vesselCode: updated.vesselCode },
    });
    return updated;
  } catch (error: unknown) {
    if (isP2002(error)) {
      throw new RouteError(409, "DUPLICATE_SKU", "Ya existe un spare con ese SKU para el vessel.");
    }
    throw error;
  }
}

export async function deleteTenantSpare(session: TenantAccessSession, id: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para eliminar spares.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getTenantSpare(session, id);
  const deleted = await prisma.spare.update({
    where: { id: current.id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Spare.deleted",
    entityType: "Spare",
    entityId: current.id,
    metadata: { sku: current.sku, name: current.name, vesselCode: current.vesselCode },
  });
  return deleted;
}

export async function listReorderAlerts(session: TenantAccessSession, vesselCode?: string | null) {
  const prisma = getPrismaClient();
  if (!prisma) return [];

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, status: "ACTIVE", deletedAt: null };
  applyVesselScope(session, where, vesselCode ?? null);
  const items = await prisma.spare.findMany({
    where,
    orderBy: [{ vesselCode: "asc" }, { criticality: "asc" }, { sku: "asc" }],
  });
  return items.filter((item) => item.currentStock <= item.reorderPoint);
}

export function parseBelowReorderQuery(value: string | null): boolean {
  return parseBooleanQuery(value);
}
