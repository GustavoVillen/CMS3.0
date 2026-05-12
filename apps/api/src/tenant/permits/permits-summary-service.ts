import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

/**
 * Resumen de permisos para el dashboard:
 *  - active: permisos ACTIVE
 *  - pendingApproval: REQUESTED
 *  - expiringSoon: ACTIVE con validTo dentro de 24h
 *  - expired: ACTIVE con validTo vencido (no se cerraron a tiempo, problema operativo)
 */
export interface PermitsSummary {
  active: number;
  pendingApproval: number;
  expiringSoon: number;
  expired: number;
}

type SummaryClient = {
  permitToWork: { count(args: { where: Record<string, unknown> }): Promise<number> };
};

export async function getPermitsSummary(
  session: TenantAccessSession,
  filters: { vesselCode?: string | null } = {},
): Promise<PermitsSummary> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return { active: 0, pendingApproval: 0, expiringSoon: 0, expired: 0 };

  const tenant = await prismaRaw.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return { active: 0, pendingApproval: 0, expiringSoon: 0, expired: 0 };

  const prisma = prismaRaw as unknown as SummaryClient;
  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [active, pendingApproval, expiringSoon, expired] = await Promise.all([
    prisma.permitToWork.count({ where: { ...where, status: "ACTIVE" } }),
    prisma.permitToWork.count({ where: { ...where, status: "REQUESTED" } }),
    prisma.permitToWork.count({ where: { ...where, status: "ACTIVE", validTo: { gte: now, lt: in24h } } }),
    prisma.permitToWork.count({ where: { ...where, status: "ACTIVE", validTo: { lt: now } } }),
  ]);

  return { active, pendingApproval, expiringSoon, expired };
}
