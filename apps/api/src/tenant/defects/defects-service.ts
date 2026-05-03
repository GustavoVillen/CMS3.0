import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevDefectsForTenant } from "../../platform/data/dev-domain-store";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

export interface DefectListFilters {
  vesselCode?: string | null;
  status?: string | null;
  severity?: string | null;
}

export async function listTenantDefects(session: TenantAccessSession, filters: DefectListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevDefectsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.severity) where.severity = filters.severity;

  return prisma.defect.findMany({ where, orderBy: { reportedAt: "desc" } });
}
