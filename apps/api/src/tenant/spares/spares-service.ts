import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevSparesForTenant } from "../../platform/data/dev-domain-store";

export interface SpareListFilters {
  vesselCode?: string | null;
  status?: string | null;
  criticality?: string | null;
}

export async function listTenantSpares(session: TenantAccessSession, filters: SpareListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevSparesForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status) where.status = filters.status;
  if (filters.criticality) where.criticality = filters.criticality;

  return prisma.spare.findMany({ where, orderBy: [{ vesselCode: "asc" }, { sku: "asc" }] });
}
