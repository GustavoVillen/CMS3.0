import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevDefectsForTenant } from "../../platform/data/dev-domain-store";

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
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status) where.status = filters.status;
  if (filters.severity) where.severity = filters.severity;

  return prisma.defect.findMany({ where, orderBy: { reportedAt: "desc" } });
}
