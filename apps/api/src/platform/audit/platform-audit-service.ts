import { getPrismaClient } from "../data/prisma-client";
import { listDevAuditEvents } from "../data/dev-audit-store";

export interface PlatformAuditEventSummary {
  id: string;
  tenantId?: string | null;
  tenantSlug?: string | null;
  actorType: string;
  actorUserId?: string | null;
  actorPlatformUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface PlatformAuditEventFilters {
  tenantSlug?: string | null;
  actorType?: string | null;
  action?: string | null;
  entityType?: string | null;
}

export async function listPlatformAuditEvents(
  filters: PlatformAuditEventFilters = {},
): Promise<PlatformAuditEventSummary[]> {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevAuditEvents(filters).map((event) => ({
      id: event.id,
      tenantSlug: event.tenantSlug ?? null,
      actorType: event.actorType,
      actorUserId: event.actorUserId ?? null,
      actorPlatformUserId: event.actorPlatformUserId ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      metadata: event.metadata ?? null,
      createdAt: event.createdAt,
    }));
  }

  const records = await prisma.auditEvent.findMany({
    where: {
      actorType: filters.actorType || undefined,
      action: filters.action || undefined,
      entityType: filters.entityType || undefined,
      tenant: filters.tenantSlug ? { slug: filters.tenantSlug } : undefined,
    },
    include: { tenant: true },
    orderBy: { createdAt: "desc" },
  });

  return records.map((event) => ({
    id: event.id,
    tenantId: event.tenantId,
    tenantSlug: event.tenant?.slug ?? null,
    actorType: event.actorType,
    actorUserId: event.actorUserId ?? null,
    actorPlatformUserId: event.actorPlatformUserId ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    metadata: (event.metadata as Record<string, unknown> | null) ?? null,
    createdAt: event.createdAt.toISOString(),
  }));
}
