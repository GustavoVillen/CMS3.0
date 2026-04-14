import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevDeferralsForTenant } from "../../platform/data/dev-domain-store";

export interface DeferralListFilters {
  vesselCode?: string | null;
  status?: string | null;
  sourceType?: string | null;
}

export async function listTenantDeferrals(session: TenantAccessSession, filters: DeferralListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevDeferralsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status) where.status = filters.status;
  if (filters.sourceType) where.sourceType = filters.sourceType;

  return prisma.deferral.findMany({ where, orderBy: { requestedAt: "desc" } });
}
