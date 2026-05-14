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
  if (filters.status)      where.status      = filters.status;
  if (filters.insightType) where.insightType = filters.insightType;
  if (filters.targetType)  where.targetType  = filters.targetType;

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
