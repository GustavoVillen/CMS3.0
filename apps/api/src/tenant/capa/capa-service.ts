import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevCapasForTenant } from "../../platform/data/dev-domain-store";

export interface CapaListFilters {
  vesselCode?: string | null;
  status?: string | null;
  priority?: string | null;
  sourceType?: string | null;
}

export async function listTenantCapas(session: TenantAccessSession, filters: CapaListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevCapasForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.sourceType) where.sourceType = filters.sourceType;

  return prisma.capaRecord.findMany({ where, orderBy: { createdAt: "desc" } });
}
