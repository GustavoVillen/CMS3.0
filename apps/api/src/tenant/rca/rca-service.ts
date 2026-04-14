import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevRcasForTenant } from "../../platform/data/dev-domain-store";

export interface RcaListFilters {
  vesselCode?: string | null;
  status?: string | null;
  methodology?: string | null;
}

export async function listTenantRcas(session: TenantAccessSession, filters: RcaListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevRcasForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status) where.status = filters.status;
  if (filters.methodology) where.methodology = filters.methodology;

  return prisma.rcaRecord.findMany({ where, orderBy: { createdAt: "desc" } });
}
