import { getPrismaClient } from "../data/prisma-client";
import { listDevAuditEvents } from "../data/dev-audit-store";
import { getTenantNames } from "../access/platform-name-lookup";

export interface PlatformAuditEventSummary {
  id: string;
  tenantId?: string | null;
  tenantSlug?: string | null;
  /** Nombre comercial de la empresa. */
  tenantName?: string | null;
  actorType: string;
  /** Nombre (o email) de quien hizo el cambio; null si fue el sistema. */
  actorName?: string | null;
  actorEmail?: string | null;
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
  from?: Date | null;
  to?: Date | null;
  limit?: number;
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

  // Antes traía la tabla entera; con meses de ingresos registrados eso son
  // decenas de miles de filas. Se limita y se filtra por fecha.
  const limit = Math.min(Math.max(filters.limit ?? 500, 1), 2000);
  const [records, tenantNames] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        actorType: filters.actorType ? (filters.actorType as any) : undefined,
        action: filters.action || undefined,
        entityType: filters.entityType || undefined,
        tenant: filters.tenantSlug ? { slug: filters.tenantSlug } : undefined,
        createdAt: filters.from || filters.to
          ? { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) }
          : undefined,
      },
      include: {
        tenant: { select: { slug: true } },
        actorUser: { select: { email: true, firstName: true, lastName: true } },
        actorPlatformUser: { select: { email: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    getTenantNames(prisma),
  ]);

  return records.map((event) => ({
    id: event.id,
    tenantId: event.tenantId,
    tenantSlug: event.tenant?.slug ?? null,
    tenantName: event.tenant?.slug ? tenantNames.get(event.tenant.slug) ?? event.tenant.slug : null,
    actorType: event.actorType,
    actorName: personName(event.actorUser ?? event.actorPlatformUser),
    actorEmail: (event.actorUser ?? event.actorPlatformUser)?.email ?? null,
    actorUserId: event.actorUserId ?? null,
    actorPlatformUserId: event.actorPlatformUserId ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    metadata: (event.metadata as Record<string, unknown> | null) ?? null,
    createdAt: event.createdAt.toISOString(),
  }));
}

function personName(p: { email: string; firstName: string | null; lastName: string | null } | null | undefined): string | null {
  if (!p) return null;
  const full = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return full || p.email;
}
