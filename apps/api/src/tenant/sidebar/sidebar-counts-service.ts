// Sidebar counts — un solo endpoint que devuelve los contadores que el
// sidebar muestra como badges. Evita N fetches desde el frontend.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getOnHandMap } from "../pms/stock-calc-service";

export interface SidebarCounts {
  // Items con badge desde Fase 1.
  workOrdersOpen: number;
  defectsOpen: number;
  deferralsOpen: number;
  capaOpen: number;
  certsExpiringOrExpired: number;
  nearMissOpen: number;
  restHoursViolations: number;
  externalAuditsFindingsOpen: number;
  mocOpen: number;
  // Fase 2: badges agregados para "acciones requeridas" en el resto del sidebar.
  maintenancePlansOverdue: number;   // /maintenance-plans
  dailyReportsMissing: number;       // /daily-reports
  fluidAnalysisCritical: number;     // /fluid-analyses
  spareRequestsPending: number;      // /spare-requests
  cviqFindingsOpen: number;          // /cviq
  checklistsOverdue: number;         // /checklists
  permitsAttention: number;          // /permits
  crewCertsAttention: number;        // /crew
  drillsOverdue: number;             // /drills
  sparesCriticalLow: number;         // /spares
  providerNcOpen: number;            // /providers
}

const EMPTY: SidebarCounts = {
  workOrdersOpen: 0, defectsOpen: 0, deferralsOpen: 0, capaOpen: 0,
  certsExpiringOrExpired: 0, nearMissOpen: 0, restHoursViolations: 0,
  externalAuditsFindingsOpen: 0, mocOpen: 0,
  maintenancePlansOverdue: 0, dailyReportsMissing: 0,
  fluidAnalysisCritical: 0, spareRequestsPending: 0,
  cviqFindingsOpen: 0, checklistsOverdue: 0,
  permitsAttention: 0, crewCertsAttention: 0,
  drillsOverdue: 0, sparesCriticalLow: 0, providerNcOpen: 0,
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

// Devuelve los códigos de buque del scope efectivo (para queries que necesitan
// listar los buques antes de contar otra cosa por buque, ej. daily reports).
async function listScopeVesselCodes(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  session: TenantAccessSession,
  tenantId: string,
  requestedVesselCode: string | null,
): Promise<string[]> {
  if (requestedVesselCode) {
    if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(requestedVesselCode)) {
      return [];
    }
    return [requestedVesselCode];
  }
  if (session.user.role !== "TENANT_ADMIN") {
    return session.user.assignedVesselCodes;
  }
  // Admin sin filtro: listamos todos los buques activos del tenant.
  type VesselLite = { code: string };
  const vessels = await (prisma as unknown as { vessel: { findMany(a: { where: { tenantId: string }; select: { code: true } }): Promise<VesselLite[]> } })
    .vessel.findMany({ where: { tenantId }, select: { code: true } });
  return vessels.map(v => v.code);
}

export async function getSidebarCounts(session: TenantAccessSession, vesselCode: string | null): Promise<SidebarCounts> {
  const prisma = getPrismaClient();
  if (!prisma) return EMPTY;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return EMPTY;
  const base = vesselWhere(session, vesselCode, tenant.id);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const fourHoursAhead = new Date(now.getTime() + 4 * 60 * 60 * 1000);

  // Cast genérico al cliente Prisma. Mantiene este servicio robusto frente
  // a regeneraciones donde los nombres de delegados pueden faltar.
  const p = prisma as unknown as {
    workOrder: Delegate;
    defect: Delegate;
    deferral: Delegate;
    capaRecord: Delegate;
    certificate: Delegate;
    nearMissReport: Delegate;
    crewRestHours: Delegate;
    externalAuditFinding: Delegate;
    mocRecord: Delegate;
    maintenancePlan: Delegate;
    dailyReport: { findMany(a: { where: Record<string, unknown>; select: { vesselCode: true }; distinct: ["vesselCode"] }): Promise<Array<{ vesselCode: string }>> };
    fluidAnalysisResult: Delegate;
    spareRequest: Delegate;
    cviqResponse: Delegate;
    checklistExecution: Delegate;
    permitToWork: Delegate;
    crewCertification: Delegate;
    drill: Delegate;
    spare: { findMany(a: { where: Record<string, unknown>; select: { id: true; minStock: true } }): Promise<Array<{ id: string; minStock: number }>> };
    providerNonconformity: Delegate;
  };

  // Lista de buques en scope (usada por dailyReportsMissing).
  const scopeVesselCodesPromise = listScopeVesselCodes(prisma, session, tenant.id, vesselCode);

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
    maintenancePlansOverdue,
    fluidAnalysisCritical,
    spareRequestsPending,
    cviqFindingsOpen,
    checklistsOverdue,
    permitsAttention,
    crewCertsAttention,
    drillsOverdue,
    providerNcOpen,
    scopeVesselCodes,
    sparesCriticalLow,
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
    // MaintenancePlan: solo OVERDUE; el resto se considera al día.
    safe(() => p.maintenancePlan.count({ where: { ...base, deletedAt: null, status: "OVERDUE" } })),
    // Fluid analyses con verdict crítico o que pide acción.
    safe(() => p.fluidAnalysisResult.count({ where: { tenantId: base.tenantId, verdict: { in: ["CRITICAL", "ACTION_REQUIRED"] } } })),
    // Solicitudes de repuestos pendientes (DRAFT o SUBMITTED).
    safe(() => p.spareRequest.count({ where: { tenantId: base.tenantId, deletedAt: null, status: { in: ["DRAFT", "SUBMITTED"] } } })),
    // CVIQ: respuestas no conformes o parcialmente conformes (findings abiertos).
    safe(() => p.cviqResponse.count({ where: { tenantId: base.tenantId, status: { in: ["NOT_CONFORMING", "PARTIALLY_CONFORMING"] } } })),
    // Checklists en curso con más de 24 h desde el evento (atrasados).
    safe(() => p.checklistExecution.count({ where: { ...base, status: "IN_PROGRESS", eventDateTime: { lt: dayAgo } } })),
    // Permisos: ACTIVE que expiran en < 4 h OR REQUESTED pendientes de aprobación.
    safe(() => p.permitToWork.count({
      where: {
        ...base, deletedAt: null,
        OR: [
          { status: "ACTIVE", validTo: { lte: fourHoursAhead, gt: now } },
          { status: "REQUESTED" },
        ],
      },
    })),
    // CrewCertification: filtro a través de la relación Crew (tiene vesselCode).
    safe(() => p.crewCertification.count({
      where: {
        tenantId: base.tenantId, deletedAt: null,
        status: { in: ["EXPIRED", "EXPIRING_SOON"] },
        crew: { ...base, deletedAt: null },
      },
    })),
    // Drills SCHEDULED con fecha pasada = vencidos.
    safe(() => p.drill.count({ where: { ...base, deletedAt: null, status: "SCHEDULED", scheduledDate: { lt: now } } })),
    // Provider non-conformities abiertas o en revisión.
    safe(() => p.providerNonconformity.count({ where: { ...base, deletedAt: null, status: { in: ["OPEN", "UNDER_REVIEW"] } } })),
    // Lista de buques en scope (Promise paralela, se usa abajo solo si hay buques).
    scopeVesselCodesPromise,
    // Spares: criticidad A activos con onHand < minStock. Usa stock-calc-service.
    // Limita a criticidad A para que el costo (movements scan) sea pequeño.
    (async () => {
      try {
        const spares = await p.spare.findMany({
          where: { ...base, deletedAt: null, criticality: "A", status: "ACTIVE" },
          select: { id: true, minStock: true },
        });
        if (spares.length === 0) return 0;
        const onHand = await getOnHandMap(prisma, spares.map(s => s.id));
        return spares.filter(s => (onHand.get(s.id) ?? 0) < s.minStock).length;
      } catch { return 0; }
    })(),
  ]);

  // Daily reports faltantes: cantidad de buques del scope sin DailyReport de hoy.
  let dailyReportsMissing = 0;
  try {
    if (scopeVesselCodes.length > 0) {
      const reported = await p.dailyReport.findMany({
        where: {
          tenantId: tenant.id,
          vesselCode: { in: scopeVesselCodes },
          reportDate: { gte: startOfToday, lt: startOfTomorrow },
        },
        select: { vesselCode: true },
        distinct: ["vesselCode"],
      });
      dailyReportsMissing = Math.max(0, scopeVesselCodes.length - reported.length);
    }
  } catch { /* silent */ }

  return {
    workOrdersOpen, defectsOpen, deferralsOpen, capaOpen,
    certsExpiringOrExpired, nearMissOpen, restHoursViolations,
    externalAuditsFindingsOpen, mocOpen,
    maintenancePlansOverdue, dailyReportsMissing,
    fluidAnalysisCritical, spareRequestsPending,
    cviqFindingsOpen, checklistsOverdue,
    permitsAttention, crewCertsAttention,
    drillsOverdue, sparesCriticalLow, providerNcOpen,
  };
}

interface Delegate {
  count(a: { where: Record<string, unknown> }): Promise<number>;
}

/** Wraps a count() so that failures (table missing, schema drift) return 0 instead of breaking the whole endpoint. */
async function safe(fn: () => Promise<number>): Promise<number> {
  try { return await fn(); } catch { return 0; }
}
