import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevCertificatesForTenant } from "../../platform/data/dev-domain-store";

export interface CertificateListFilters {
  vesselCode?: string | null;
  status?: string | null;
}

export async function listTenantCertificates(session: TenantAccessSession, filters: CertificateListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevCertificatesForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status) where.status = filters.status;

  return prisma.certificate.findMany({ where, orderBy: { expiryDate: "asc" } });
}
