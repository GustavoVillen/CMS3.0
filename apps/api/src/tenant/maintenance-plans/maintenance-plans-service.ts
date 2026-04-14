import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevMaintenancePlansForTenant } from "../../platform/data/dev-domain-store";

export interface MaintenancePlanListFilters {
  vesselCode?: string | null;
  status?: string | null;
  triggerType?: string | null;
}

export async function listTenantMaintenancePlans(session: TenantAccessSession, filters: MaintenancePlanListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevMaintenancePlansForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status) where.status = filters.status;
  if (filters.triggerType) where.triggerType = filters.triggerType;

  return prisma.maintenancePlan.findMany({ where, orderBy: { nextDue: "asc" } });
}
