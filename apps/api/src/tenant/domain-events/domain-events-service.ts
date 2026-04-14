import type { TenantAccessSession } from "../auth/session-store";
import { listDevDomainEventsForTenant } from "../../platform/data/dev-domain-store";

export interface DomainEventListFilters {
  vesselCode?: string | null;
  category?: string | null;
  eventType?: string | null;
}

export function listTenantDomainEvents(
  session: TenantAccessSession,
  filters: DomainEventListFilters = {},
) {
  return listDevDomainEventsForTenant(
    session.tenantSlug,
    session.user.role,
    session.user.assignedVesselCodes,
    filters,
  );
}
