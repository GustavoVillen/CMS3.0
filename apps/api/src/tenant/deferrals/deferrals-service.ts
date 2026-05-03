import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevDeferralsForTenant } from "../../platform/data/dev-domain-store";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

export interface DeferralListFilters {
  vesselCode?: string | null;
  status?: string | null;
  sourceType?: string | null;
}

export async function listTenantDeferrals(session: TenantAccessSession, filters: DeferralListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevDeferralsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.sourceType) where.sourceType = filters.sourceType;

  const deferrals = await prisma.deferral.findMany({ where, orderBy: { requestedAt: "desc" } });
  if (deferrals.length === 0) return [];

  // Batch-resolve source codes (one query per type)
  const woIds   = deferrals.filter(d => d.sourceType === "WORK_ORDER"       ).map(d => d.sourceId);
  const defIds  = deferrals.filter(d => d.sourceType === "DEFECT"            ).map(d => d.sourceId);
  const planIds = deferrals.filter(d => d.sourceType === "MAINTENANCE_PLAN"  ).map(d => d.sourceId);

  const [workOrders, defects, plans] = await Promise.all([
    woIds.length   > 0 ? prisma.workOrder.findMany({ where: { id: { in: woIds   }, tenantId: tenant.id }, select: { id: true, workOrderCode: true } }) : [],
    defIds.length  > 0 ? prisma.defect.findMany(   { where: { id: { in: defIds  }, tenantId: tenant.id }, select: { id: true, defectCode:    true } }) : [],
    planIds.length > 0 ? prisma.maintenancePlan.findMany({ where: { id: { in: planIds }, tenantId: tenant.id }, select: { id: true, taskCode: true } }) : [],
  ]);

  const codeMap = new Map<string, string>();
  workOrders.forEach(r => codeMap.set(r.id, r.workOrderCode));
  defects.forEach(r    => codeMap.set(r.id, r.defectCode));
  plans.forEach(r      => codeMap.set(r.id, r.taskCode));

  return deferrals.map(d => ({ ...d, sourceCode: codeMap.get(d.sourceId) ?? null }));
}
