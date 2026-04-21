import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevDomainEventsForTenant } from "../../platform/data/dev-domain-store";

export interface DomainEventListFilters {
  vesselCode?: string | null;
  entityType?: string | null;
  eventKind?: string | null;
}

export async function listTenantDomainEvents(
  session: TenantAccessSession,
  filters: DomainEventListFilters = {},
) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevDomainEventsForTenant(
      session.tenantSlug,
      session.user.role,
      session.user.assignedVesselCodes,
      filters as any,
    );
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id };

  // Vessel scope enforcement
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }

  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.eventKind)  where.eventKind  = filters.eventKind;

  return prisma.domainEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take:    200,
  });
}
