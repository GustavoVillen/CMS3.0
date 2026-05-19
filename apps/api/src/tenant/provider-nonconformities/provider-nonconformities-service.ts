import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevProviderNonconformitiesForTenant } from "../../platform/data/dev-domain-store";

export interface ProviderNonconformityListFilters {
  vesselCode?: string | null;
  status?: string | null;
  severity?: string | null;
}

/**
 * NCRs son fleet-wide visibles: cualquier usuario del tenant puede ver todas
 * las no-conformidades de proveedores, sin importar a qué vessels esté
 * asignado. Una NC ocurrida en un buque es información operativa relevante
 * para toda la compañía (el mismo proveedor sirve a otros buques, hay
 * aprendizaje cross-flota, alertas tempranas, etc.). El campo `vesselCode`
 * de la NC se conserva como dato de DÓNDE ocurrió, no como filtro de
 * visibilidad. El filtro `vesselCode` solo se aplica si el user lo pide
 * explícitamente desde la UI para acotar la vista.
 */
export async function listTenantProviderNonconformities(session: TenantAccessSession, filters: ProviderNonconformityListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevProviderNonconformitiesForTenant(session.tenantSlug, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status)     where.status     = filters.status;
  if (filters.severity)   where.severity   = filters.severity;

  return prisma.providerNonconformity.findMany({ where, orderBy: { reportedAt: "desc" } });
}
