import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevStockMovementsForTenant } from "../../platform/data/dev-domain-store";

export interface StockMovementListFilters {
  vesselCode?: string | null;
  movementType?: string | null;
  spareId?: string | null;
}

export async function listTenantStockMovements(session: TenantAccessSession, filters: StockMovementListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevStockMovementsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  // StockMovement is append-only (no deletedAt)
  const where: Record<string, unknown> = { tenantId: tenant.id };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.movementType) where.movementType = filters.movementType;
  if (filters.spareId) where.spareId = filters.spareId;

  return prisma.stockMovement.findMany({ where, orderBy: { occurredAt: "desc" } });
}
