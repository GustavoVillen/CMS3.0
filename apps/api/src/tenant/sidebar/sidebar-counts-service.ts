// Sidebar counts — un solo endpoint que devuelve los contadores que el
// sidebar muestra como badges. Evita N fetches desde el frontend.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

export interface SidebarCounts {
  workOrdersOpen: number;
  defectsOpen: number;
  deferralsOpen: number;
  capaOpen: number;
  certsExpiringOrExpired: number;
  nearMissOpen: number;
  restHoursViolations: number;
  externalAuditsFindingsOpen: number;
  mocOpen: number;
}

const EMPTY: SidebarCounts = {
  workOrdersOpen: 0, defectsOpen: 0, deferralsOpen: 0, capaOpen: 0,
  certsExpiringOrExpired: 0, nearMissOpen: 0, restHoursViolations: 0,
  externalAuditsFindingsOpen: 0, mocOpen: 0,
};

function vesselWhere(session: TenantAccessSession, requestedVesselCode: string | null, tenantId: string): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId };
  if (requestedVesselCode) {
    if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(requestedVesselCode)) {
      where.vesselCode = "__NO_ACCESS__";
      return where;
    }
    where.vesselCode = requestedVesselCode;
    return where;
  }
  if (session.user.role !== "TENANT_ADMIN") {
    if (session.user.assignedVesselCodes.length === 0) {
      where.vesselCode = "__NO_ACCESS__";
      return where;
    }
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  return where;
}

export async function getSidebarCounts(session: TenantAccessSession, vesselCode: string | null): Promise<SidebarCounts> {
  const prisma = getPrismaClient();
  if (!prisma) return EMPTY;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return EMPTY;
  const base = vesselWhere(session, vesselCode, tenant.id);

  const p = prisma as unknown as {
    workOrder: { count(a: { where: Record<string, unknown> }): Promise<number> };
    defect: { count(a: { where: Record<string, unknown> }): Promise<number> };
    deferral: { count(a: { where: Record<string, unknown> }): Promise<number> };
    capaRecord: { count(a: { where: Record<string, unknown> }): Promise<number> };
    certificate: { count(a: { where: Record<string, unknown> }): Promise<number> };
    nearMissReport: { count(a: { where: Record<string, unknown> }): Promise<number> };
    crewRestHours: { count(a: { where: Record<string, unknown> }): Promise<number> };
    externalAuditFinding: { count(a: { where: Record<string, unknown> }): Promise<number> };
    mocRecord: { count(a: { where: Record<string, unknown> }): Promise<number> };
  };

  // Ejecutamos las queries en paralelo para minimizar latencia.
  const [
    workOrdersOpen,
    defectsOpen,
    deferralsOpen,
    capaOpen,
    certsExpiringOrExpired,
    nearMissOpen,
    restHoursViolations,
    externalAuditsFindingsOpen,
    mocOpen,
  ] = await Promise.all([
    safe(() => p.workOrder.count({ where: { ...base, deletedAt: null, status: { in: ["PLANNED", "IN_PROGRESS"] } } })),
    safe(() => p.defect.count({ where: { ...base, deletedAt: null, status: { notIn: ["RESOLVED", "CLOSED"] } } })),
    safe(() => p.deferral.count({ where: { ...base, deletedAt: null, status: { notIn: ["CLOSED", "CANCELLED", "EXPIRED", "REJECTED"] } } })),
    safe(() => p.capaRecord.count({ where: { ...base, deletedAt: null, status: { notIn: ["CLOSED", "CANCELLED", "VERIFIED_EFFECTIVE"] } } })),
    safe(() => p.certificate.count({ where: { ...base, deletedAt: null, status: { in: ["EXPIRED", "EXPIRING_SOON"] } } })),
    safe(() => p.nearMissReport.count({ where: { ...base, deletedAt: null, status: { notIn: ["CLOSED"] } } })),
    safe(() => p.crewRestHours.count({ where: { ...base, hasViolation: true } })),
    safe(() => p.externalAuditFinding.count({ where: { ...base, status: { in: ["OPEN", "IN_PROGRESS"] } } })),
    safe(() => p.mocRecord.count({ where: { ...base, deletedAt: null, status: { notIn: ["REVIEWED", "REJECTED", "CANCELLED"] } } })),
  ]);

  return {
    workOrdersOpen, defectsOpen, deferralsOpen, capaOpen,
    certsExpiringOrExpired, nearMissOpen, restHoursViolations,
    externalAuditsFindingsOpen, mocOpen,
  };
}

/** Wraps a count() so that failures (table missing, schema drift) return 0 instead of breaking the whole endpoint. */
async function safe(fn: () => Promise<number>): Promise<number> {
  try { return await fn(); } catch { return 0; }
}
