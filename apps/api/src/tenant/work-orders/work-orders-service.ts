import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevWorkOrdersForTenant } from "../../platform/data/dev-domain-store";

export interface WorkOrderListFilters {
  vesselCode?: string | null;
  status?: string | null;
  type?: string | null;
}

export async function listTenantWorkOrders(session: TenantAccessSession, filters: WorkOrderListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevWorkOrdersForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;

  return prisma.workOrder.findMany({ where, orderBy: { openDate: "desc" } });
}
