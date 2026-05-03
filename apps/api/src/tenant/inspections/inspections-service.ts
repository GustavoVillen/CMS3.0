import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevInspectionsForTenant } from "../../platform/data/dev-domain-store";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

export interface InspectionListFilters {
  vesselCode?: string | null;
  status?: string | null;
  result?: string | null;
  type?: string | null;
}

export async function listTenantInspections(session: TenantAccessSession, filters: InspectionListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevInspectionsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.result) where.result = filters.result;
  if (filters.type) where.type = filters.type;

  return prisma.inspection.findMany({ where, orderBy: { scheduledAt: "desc" } });
}
