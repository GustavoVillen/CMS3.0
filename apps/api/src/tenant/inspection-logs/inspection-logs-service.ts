import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevInspectionLogsForTenant } from "../../platform/data/dev-domain-store";

export interface InspectionLogListFilters {
  vesselCode?: string | null;
  inspectionId?: string | null;
  entryType?: string | null;
  severity?: string | null;
}

export async function listTenantInspectionLogs(session: TenantAccessSession, filters: InspectionLogListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevInspectionLogsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  // InspectionLog is append-only (no deletedAt)
  const where: Record<string, unknown> = { tenantId: tenant.id };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.inspectionId) where.inspectionId = filters.inspectionId;
  if (filters.entryType) where.entryType = filters.entryType;
  if (filters.severity) where.severity = filters.severity;

  return prisma.inspectionLog.findMany({ where, orderBy: { observedAt: "desc" } });
}
