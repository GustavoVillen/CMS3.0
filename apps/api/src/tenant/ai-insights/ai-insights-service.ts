import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevAiInsightsForTenant } from "../../platform/data/dev-domain-store";
import { RouteError } from "../../http/route-error";

export interface AiInsightListFilters {
  vesselCode?: string | null;
  status?: string | null;
  insightType?: string | null;
  targetType?: string | null;
}

// Whitelist de valores válidos para los enums Prisma — coincide con el schema.
// Si llega un valor distinto, lo ignoramos (en vez de pasarlo crudo a Prisma
// donde tira un 500 o devuelve [] sin contexto).
const INSIGHT_STATUS_SET = new Set(["OPEN", "DISMISSED", "RESOLVED"]);
const INSIGHT_TARGET_TYPE_SET = new Set([
  "VESSEL", "ASSET", "WORK_ORDER", "DEFECT", "CAPA",
  "SPARE", "CERTIFICATE", "INSPECTION", "FLEET",
]);
const INSIGHT_TYPE_SET = new Set([
  "backlog_risk", "repeated_failure", "repeated_deferral", "pm_frequency_review",
  "stock_below_minimum", "stock_below_reorder_point", "certificate_expiring",
  "certificate_expired", "inspection_failure_pattern", "overdue_capa",
  "overdue_work_order", "documentation_gap", "operational_anomaly",
  "recurring_asset_downtime", "trend_based_maintenance_improvement",
  "cross_vessel_spare_availability", "fleet_repeated_failure_pattern",
  "fleet_known_fix_suggestion", "fleet_shared_operational_experience",
]);

function pickEnum(value: string | null | undefined, set: Set<string>): string | null {
  if (!value) return null;
  return set.has(value) ? value : null;
}

export async function listTenantAiInsights(
  session: TenantAccessSession,
  filters: AiInsightListFilters = {},
) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevAiInsightsForTenant(session.tenantSlug, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id };

  // Cross-vessel rule: non-admin users see their vessel insights + FLEET insights.
  // FAIL-CLOSED: usuarios sin vessels asignados solo ven los FLEET (nunca todo el tenant).
  if (session.user.role !== "TENANT_ADMIN") {
    if (session.user.assignedVesselCodes.length === 0) {
      where.targetType = "FLEET";
    } else {
      where.OR = [
        { vesselCode: { in: session.user.assignedVesselCodes } },
        { targetType: "FLEET" },
      ];
    }
  }

  if (filters.vesselCode) {
    // Filtramos por el vessel pedido pero seguimos incluyendo los FLEET
    // (insights cross-vessel: flota completa). Si el caller ya restringió
    // arriba con OR por scope de usuario, lo respetamos vía AND.
    const vesselClause = {
      OR: [{ vesselCode: filters.vesselCode }, { targetType: "FLEET" }],
    };
    if (where.OR) {
      where.AND = [{ OR: where.OR }, vesselClause];
      delete where.OR;
    } else {
      Object.assign(where, vesselClause);
    }
  }
  const validStatus      = pickEnum(filters.status,      INSIGHT_STATUS_SET);
  const validInsightType = pickEnum(filters.insightType, INSIGHT_TYPE_SET);
  const validTargetType  = pickEnum(filters.targetType,  INSIGHT_TARGET_TYPE_SET);
  if (validStatus)      where.status      = validStatus;
  if (validInsightType) where.insightType = validInsightType;
  // Solo aplicamos filtro targetType si NO entró ya por scope de vessel arriba.
  if (validTargetType && where.targetType === undefined) where.targetType = validTargetType;

  return prisma.aiInsight.findMany({
    where,
    orderBy: [{ priority: "desc" }, { detectedAt: "desc" }],
  });
}

export async function updateTenantAiInsightStatus(
  session: TenantAccessSession,
  id: string,
  status: "DISMISSED" | "RESOLVED",
) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DB_UNAVAILABLE", "Database not available.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");

  const insight = await prisma.aiInsight.findFirst({ where: { id, tenantId: tenant.id } });
  if (!insight) throw new RouteError(404, "NOT_FOUND", "Insight not found.");

  const now = new Date();
  return prisma.aiInsight.update({
    where: { id },
    data: {
      status,
      resolvedAt:      status === "RESOLVED"  ? now : undefined,
      dismissedAt:     status === "DISMISSED" ? now : undefined,
      updatedAt:       now,
      updatedByUserId: session.user.id,
    },
  });
}
