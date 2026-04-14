import type { TenantAccessSession } from "../auth/session-store";
import { listDevAiInsightsForTenant } from "../../platform/data/dev-domain-store";

export interface AiInsightListFilters {
  vesselCode?: string | null;
  status?: string | null;
  insightType?: string | null;
  targetType?: string | null;
}

export function listTenantAiInsights(
  session: TenantAccessSession,
  filters: AiInsightListFilters = {},
) {
  return listDevAiInsightsForTenant(session.tenantSlug, filters);
}
