import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevProviderEvaluationsForTenant } from "../../platform/data/dev-domain-store";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

export interface ProviderEvaluationListFilters {
  vesselCode?: string | null;
  status?: string | null;
  rating?: string | null;
}

export async function listTenantProviderEvaluations(session: TenantAccessSession, filters: ProviderEvaluationListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevProviderEvaluationsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.rating) where.rating = filters.rating;

  return prisma.providerEvaluation.findMany({ where, orderBy: { evaluatedAt: "desc" } });
}
