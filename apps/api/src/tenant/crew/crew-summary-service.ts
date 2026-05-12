import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

/**
 * Resumen agregado para el dashboard:
 *
 * - onboard: tripulantes ONBOARD
 * - certsExpired / certsExpiringSoon: certificaciones VALID con expiryDate vencida / dentro de 30 días
 * - drillsScheduled: simulacros SCHEDULED en el mes actual
 * - drillsCompletedYear: simulacros COMPLETED en el año en curso
 */
export interface CrewSummary {
  onboard: number;
  certsExpired: number;
  certsExpiringSoon: number;
  drillsScheduled: number;
  drillsCompletedYear: number;
}

type SummaryClient = {
  crew: { count(args: { where: Record<string, unknown> }): Promise<number> };
  crewCertification: { count(args: { where: Record<string, unknown> }): Promise<number> };
  drill: { count(args: { where: Record<string, unknown> }): Promise<number> };
};

export async function getCrewSummary(
  session: TenantAccessSession,
  filters: { vesselCode?: string | null } = {},
): Promise<CrewSummary> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) {
    return { onboard: 0, certsExpired: 0, certsExpiringSoon: 0, drillsScheduled: 0, drillsCompletedYear: 0 };
  }

  const tenant = await prismaRaw.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return { onboard: 0, certsExpired: 0, certsExpiringSoon: 0, drillsScheduled: 0, drillsCompletedYear: 0 };

  const prisma = prismaRaw as unknown as SummaryClient;

  // Where base con scope de vessel
  const whereVesselScoped: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, whereVesselScoped, filters.vesselCode ?? null);

  const now = new Date();
  const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);

  // Para certificaciones: filtrar por crew dentro del scope (no tienen vesselCode propio).
  // Filtramos en dos pasos vía relación crew → vesselCode.
  const crewVesselFilter: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, crewVesselFilter, filters.vesselCode ?? null);

  const certBase: Record<string, unknown> = {
    tenantId: tenant.id,
    deletedAt: null,
    crew: crewVesselFilter,
  };

  const [onboard, certsExpired, certsExpiringSoon, drillsScheduled, drillsCompletedYear] = await Promise.all([
    prisma.crew.count({ where: { ...whereVesselScoped, status: "ONBOARD" } }),
    prisma.crewCertification.count({ where: { ...certBase, expiryDate: { lt: now }, status: { not: "EXPIRED" } } }).catch(() => 0),
    prisma.crewCertification.count({ where: { ...certBase, expiryDate: { gte: now, lt: in30d } } }).catch(() => 0),
    prisma.drill.count({ where: { ...whereVesselScoped, status: "SCHEDULED", scheduledDate: { gte: monthStart, lt: monthEnd } } }),
    prisma.drill.count({ where: { ...whereVesselScoped, status: "COMPLETED", completedDate: { gte: yearStart, lt: yearEnd } } }),
  ]);

  return { onboard, certsExpired, certsExpiringSoon, drillsScheduled, drillsCompletedYear };
}
