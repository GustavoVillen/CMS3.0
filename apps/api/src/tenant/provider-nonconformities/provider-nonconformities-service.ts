import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevProviderNonconformitiesForTenant } from "../../platform/data/dev-domain-store";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

export interface ProviderNonconformityListFilters {
  vesselCode?: string | null;
  status?: string | null;
  severity?: string | null;
}

export async function listTenantProviderNonconformities(session: TenantAccessSession, filters: ProviderNonconformityListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevProviderNonconformitiesForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.severity) where.severity = filters.severity;

  return prisma.providerNonconformity.findMany({ where, orderBy: { reportedAt: "desc" } });
}
