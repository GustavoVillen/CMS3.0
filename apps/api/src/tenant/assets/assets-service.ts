import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevAssetsForTenant } from "../../platform/data/dev-domain-store";

export interface AssetListFilters {
  vesselCode?: string | null;
}

export async function listTenantAssets(session: TenantAccessSession, filters: AssetListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevAssetsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters.vesselCode);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;

  return prisma.asset.findMany({ where, orderBy: [{ vesselCode: "asc" }, { assetCode: "asc" }] });
}
