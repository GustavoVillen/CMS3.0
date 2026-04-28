import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import type { BitacoraCategory } from "../../../generated/prisma";

export interface BitacoraListFilters {
  vesselCode?: string | null;
  category?: string | null;
  isMonitoring?: boolean | null;
  from?: string | null;
  to?: string | null;
}

export interface CreateBitacoraEntryInput {
  vesselCode: string;
  entryDate?: string;
  category?: BitacoraCategory;
  title: string;
  body: string;
  relatedAssetId?: string | null;
  isMonitoring?: boolean;
}

export interface UpdateBitacoraEntryInput {
  category?: BitacoraCategory;
  title?: string;
  body?: string;
  relatedAssetId?: string | null;
  isMonitoring?: boolean;
  monitoringClosedAt?: string | null;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

async function nextEntryCode(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, tenantId: string, vesselCode: string): Promise<string> {
  const count = await prisma.bitacoraEntry.count({ where: { tenantId, vesselCode } });
  return `BITA-${String(count + 1).padStart(5, "0")}`;
}

export async function listBitacoraEntries(session: TenantAccessSession, filters: BitacoraListFilters) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const where: Parameters<typeof prisma.bitacoraEntry.findMany>[0]["where"] = {
    tenantId,
    deletedAt: null,
  };

  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.category)   where.category   = filters.category as BitacoraCategory;
  if (filters.isMonitoring != null) where.isMonitoring = filters.isMonitoring;
  if (filters.from || filters.to) {
    where.entryDate = {};
    if (filters.from) where.entryDate.gte = new Date(filters.from);
    if (filters.to)   where.entryDate.lte = new Date(filters.to + "T23:59:59Z");
  }

  return prisma.bitacoraEntry.findMany({
    where,
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function createBitacoraEntry(session: TenantAccessSession, input: CreateBitacoraEntryInput) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  if (!input.vesselCode?.trim()) throw new RouteError(400, "VALIDATION_ERROR", "vesselCode es requerido.");
  if (!input.title?.trim())      throw new RouteError(400, "VALIDATION_ERROR", "title es requerido.");
  if (!input.body?.trim())       throw new RouteError(400, "VALIDATION_ERROR", "body es requerido.");

  const entryCode = await nextEntryCode(prisma, tenantId, input.vesselCode);
  const entryDate = input.entryDate ? new Date(input.entryDate) : new Date();

  return prisma.bitacoraEntry.create({
    data: {
      tenantId,
      vesselCode:     input.vesselCode,
      entryCode,
      entryDate,
      category:       input.category ?? "ANOTACION_GENERAL",
      title:          input.title.trim(),
      body:           input.body.trim(),
      relatedAssetId: input.relatedAssetId ?? null,
      isMonitoring:   input.isMonitoring ?? false,
      createdByUserId: session.user.userId,
      updatedByUserId: session.user.userId,
    },
  });
}

export async function updateBitacoraEntry(session: TenantAccessSession, id: string, input: UpdateBitacoraEntryInput) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const entry = await prisma.bitacoraEntry.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!entry) throw new RouteError(404, "NOT_FOUND", "Entrada de bitácora no encontrada.");

  return prisma.bitacoraEntry.update({
    where: { id },
    data: {
      ...(input.category        != null && { category: input.category }),
      ...(input.title           != null && { title: input.title.trim() }),
      ...(input.body            != null && { body: input.body.trim() }),
      ...(input.relatedAssetId  !== undefined && { relatedAssetId: input.relatedAssetId }),
      ...(input.isMonitoring    != null && { isMonitoring: input.isMonitoring }),
      ...(input.monitoringClosedAt !== undefined && {
        monitoringClosedAt: input.monitoringClosedAt ? new Date(input.monitoringClosedAt) : null,
      }),
      updatedByUserId: session.user.userId,
    },
  });
}

export async function deleteBitacoraEntry(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const entry = await prisma.bitacoraEntry.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!entry) throw new RouteError(404, "NOT_FOUND", "Entrada de bitácora no encontrada.");

  await prisma.bitacoraEntry.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.userId, updatedByUserId: session.user.userId },
  });
}
