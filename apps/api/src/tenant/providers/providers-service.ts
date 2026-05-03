import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevProvidersForTenant } from "../../platform/data/dev-domain-store";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { buildChangeDiff } from "../audit/build-change-diff";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

export interface ProviderListFilters {
  vesselCode?: string | null;
  status?: string | null;
  category?: string | null;
}

export interface CreateProviderInput {
  vesselCode: string;
  providerCode?: string | null;
  name: string;
  category?: string | null;
  status?: "ACTIVE" | "INACTIVE";
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  location?: string | null;
}

export interface UpdateProviderInput {
  name?: string;
  category?: string | null;
  status?: "ACTIVE" | "INACTIVE";
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
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

export async function listTenantProviders(session: TenantAccessSession, filters: ProviderListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevProvidersForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status)     where.status     = filters.status;
  if (filters.category)   where.category   = filters.category;

  return prisma.provider.findMany({ where, orderBy: { name: "asc" } });
}

export async function getTenantProvider(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await getTenantIdOrThrow(session);
  const record = await prisma.provider.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Proveedor no encontrado.");
  return record;
}

export async function createProvider(session: TenantAccessSession, payload: CreateProviderInput) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para crear proveedores.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeText(payload.vesselCode, "vesselCode").toUpperCase();

  let providerCode = normalizeOptionalText(payload.providerCode);
  if (!providerCode) {
    const count = await prisma.provider.count({ where: { tenantId, vesselCode } });
    providerCode = `PRV-${vesselCode}-${String(count + 1).padStart(4, "0")}`;
  }

  try {
    const created = await prisma.provider.create({
      data: {
        tenantId,
        vesselCode,
        providerCode,
        name:         normalizeText(payload.name, "name"),
        category:     normalizeOptionalText(payload.category),
        status:       payload.status ?? "ACTIVE",
        contactName:  normalizeOptionalText(payload.contactName),
        contactEmail: normalizeOptionalText(payload.contactEmail),
        contactPhone: normalizeOptionalText(payload.contactPhone),
        location:     normalizeOptionalText(payload.location),
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
      },
    });
    void publishAudit(prisma, {
      tenantId,
      actorUserId: session.user.id,
      action: "Provider.created",
      entityType: "Provider",
      entityId: created.id,
      metadata: { providerCode: created.providerCode, name: created.name, vesselCode: created.vesselCode },
    });
    return created;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002") {
      throw new RouteError(409, "DUPLICATE_CODE", "Ya existe un proveedor con ese código para el vessel.");
    }
    throw error;
  }
}

export async function updateProvider(session: TenantAccessSession, id: string, payload: UpdateProviderInput) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para editar proveedores.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getTenantProvider(session, id);
  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.name         !== undefined) data.name         = normalizeText(payload.name, "name");
  if (payload.category     !== undefined) data.category     = normalizeOptionalText(payload.category);
  if (payload.status       !== undefined) data.status       = payload.status;
  if (payload.contactName  !== undefined) data.contactName  = normalizeOptionalText(payload.contactName);
  if (payload.contactEmail !== undefined) data.contactEmail = normalizeOptionalText(payload.contactEmail);
  if (payload.contactPhone !== undefined) data.contactPhone = normalizeOptionalText(payload.contactPhone);
  if (payload.location     !== undefined) data.location     = normalizeOptionalText(payload.location);

  const updated = await prisma.provider.update({ where: { id: current.id }, data });
  const changedKeys = Object.keys(data).filter(k => k !== "updatedByUserId");
  const changes = buildChangeDiff(current as unknown as Record<string, unknown>, data, changedKeys);
  void publishAudit(prisma, {
    tenantId: updated.tenantId,
    actorUserId: session.user.id,
    action: "Provider.updated",
    entityType: "Provider",
    entityId: updated.id,
    metadata: { providerCode: updated.providerCode, name: updated.name, vesselCode: updated.vesselCode, changes },
  });
  return updated;
}

export async function deleteProvider(session: TenantAccessSession, id: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para eliminar proveedores.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getTenantProvider(session, id);
  const deleted = await prisma.provider.update({
    where: { id: current.id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Provider.deleted",
    entityType: "Provider",
    entityId: current.id,
    metadata: { providerCode: current.providerCode, name: current.name },
  });
  return deleted;
}
