import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevProvidersForTenant } from "../../platform/data/dev-domain-store";

export interface ProviderListFilters {
  vesselCode?: string | null;
  status?: string | null;
  category?: string | null;
}

export async function listTenantProviders(session: TenantAccessSession, filters: ProviderListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevProvidersForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status) where.status = filters.status;
  if (filters.category) where.category = filters.category;

  return prisma.provider.findMany({ where, orderBy: { name: "asc" } });
}
