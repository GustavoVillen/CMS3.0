import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";

export interface StockLocationListFilters {
  vesselCode?: string | null;
  isActive?: boolean;
}

export interface CreateStockLocationInput {
  code: string;
  name: string;
  vesselCode?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export interface UpdateStockLocationInput {
  name?: string;
  description?: string | null;
  isActive?: boolean;
}

function canManage(session: TenantAccessSession): boolean {
  return ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "PROCUREMENT_STORE"].includes(session.user.role);
}

async function resolveTenantId(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

export async function listStockLocations(
  session: TenantAccessSession,
  filters: StockLocationListFilters = {},
) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await resolveTenantId(session);
  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.isActive !== undefined) where.isActive = filters.isActive;

  return prisma.stockLocation.findMany({ where, orderBy: [{ vesselCode: "asc" }, { code: "asc" }] });
}

export async function getStockLocation(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await resolveTenantId(session);
  const record = await prisma.stockLocation.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Ubicación de stock no encontrada.");
  return record;
}

export async function createStockLocation(
  session: TenantAccessSession,
  payload: CreateStockLocationInput,
) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para crear ubicaciones.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await resolveTenantId(session);
  const code = String(payload.code ?? "").trim().toUpperCase();
  if (!code) throw new RouteError(400, "VALIDATION_ERROR", "El código es requerido.");
  const name = String(payload.name ?? "").trim();
  if (!name) throw new RouteError(400, "VALIDATION_ERROR", "El nombre es requerido.");

  try {
    const created = await prisma.stockLocation.create({
      data: {
        tenantId,
        code,
        name,
        vesselCode: payload.vesselCode ? payload.vesselCode.trim().toUpperCase() : null,
        description: payload.description ? String(payload.description).trim() || null : null,
        isActive: payload.isActive ?? true,
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
      },
    });
    void publishAudit(prisma, {
      tenantId,
      actorUserId: session.user.id,
      action: "StockLocation.created",
      entityType: "StockLocation",
      entityId: created.id,
      metadata: { code: created.code, name: created.name },
    });
    return created;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002") {
      throw new RouteError(409, "DUPLICATE_CODE", "Ya existe una ubicación con ese código.");
    }
    throw error;
  }
}

export async function updateStockLocation(
  session: TenantAccessSession,
  id: string,
  payload: UpdateStockLocationInput,
) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para editar ubicaciones.");
  const current = await getStockLocation(session, id);
  const prisma = getPrismaClient()!;

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.name !== undefined) {
    const name = String(payload.name).trim();
    if (!name) throw new RouteError(400, "VALIDATION_ERROR", "El nombre es requerido.");
    data.name = name;
  }
  if (payload.description !== undefined) data.description = payload.description ? String(payload.description).trim() || null : null;
  if (payload.isActive !== undefined) data.isActive = payload.isActive;

  const updated = await prisma.stockLocation.update({ where: { id: current.id }, data });
  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "StockLocation.updated",
    entityType: "StockLocation",
    entityId: updated.id,
    metadata: { code: updated.code, name: updated.name },
  });
  return updated;
}

export async function deleteStockLocation(session: TenantAccessSession, id: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para eliminar ubicaciones.");
  const current = await getStockLocation(session, id);
  const prisma = getPrismaClient()!;

  const deleted = await prisma.stockLocation.update({
    where: { id: current.id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "StockLocation.deleted",
    entityType: "StockLocation",
    entityId: current.id,
    metadata: { code: current.code, name: current.name },
  });
  return deleted;
}
