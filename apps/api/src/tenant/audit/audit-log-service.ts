import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface AuditLogFilters {
  entityType?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export async function listTenantAuditLog(
  session: TenantAccessSession,
  filters: AuditLogFilters = {},
): Promise<{ items: AuditLogItem[]; total: number }> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const where: Record<string, unknown> = {
    tenantId: tenant.id,
    actorType: "TENANT_USER",
  };

  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.action) where.action = filters.action;

  if (filters.from || filters.to) {
    const createdAt: Record<string, unknown> = {};
    if (filters.from) createdAt.gte = new Date(filters.from);
    if (filters.to) createdAt.lte = new Date(filters.to);
    where.createdAt = createdAt;
  }

  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const [records, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { actorUser: { select: { firstName: true, lastName: true } } },
    }),
    prisma.auditEvent.count({ where }),
  ]);

  const items: AuditLogItem[] = records.map((r) => {
    const actor = (r as unknown as { actorUser?: { firstName?: string; lastName?: string } | null }).actorUser;
    const actorName = actor ? `${actor.firstName ?? ""} ${actor.lastName ?? ""}`.trim() || null : null;
    return {
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId ?? null,
      actorUserId: r.actorUserId ?? null,
      actorName,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });

  return { items, total };
}
