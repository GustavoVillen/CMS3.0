import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevAttachmentsForTenant } from "../../platform/data/dev-domain-store";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

export interface AttachmentListFilters {
  vesselCode?: string | null;
  status?: string | null;
  targetType?: string | null;
}

export async function listTenantAttachments(session: TenantAccessSession, filters: AttachmentListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevAttachmentsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.targetType) where.targetType = filters.targetType;

  return prisma.attachment.findMany({ where, orderBy: { uploadedAt: "desc" } });
}
