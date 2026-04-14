import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevVesselsForTenant } from "../../platform/data/dev-domain-store";

export async function listTenantVessels(session: TenantAccessSession) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevVesselsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.code = { in: session.user.assignedVesselCodes };
  }

  return prisma.vessel.findMany({ where, orderBy: { code: "asc" } });
}
