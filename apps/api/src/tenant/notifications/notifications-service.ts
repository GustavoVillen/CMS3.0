/**
 * In-app notifications service.
 *
 * Una fila por destinatario. Unique (tenantId, recipientUserId, sourceType, sourceId)
 * garantiza que correr el sync no genere duplicados aunque pase varias veces.
 *
 * Triggers actuales:
 *  - Defect crítico al crear/editar (event-driven desde defects-service).
 *  - OT enviada a aprobar (event-driven desde work-orders-service, paso ENVIA).
 *  - WO vencida y Certificado vencido (lazy — sync al pedir la lista, con throttle).
 */

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export type NotificationType =
  | "DEFECT_CRITICAL"
  | "WORK_ORDER_OVERDUE"
  | "WORK_ORDER_PENDING_APPROVAL"
  | "CERTIFICATE_EXPIRED";

export type NotificationSeverity = "CRITICAL" | "HIGH" | "INFO";

/** Roles que deben recibir alertas operativas. */
export const NOTIFICATION_RECIPIENT_ROLES = [
  "TENANT_ADMIN",
  "FLEET_SUPERINTENDENT",
  "MAINTENANCE_MANAGER",
] as const;

export interface EnqueueParams {
  tenantId: string;
  vesselCode: string | null;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  sourceType: string;
  sourceId: string;
}

/**
 * Encola una notificación por cada usuario del tenant que tenga uno de los
 * roles destinatarios y acceso al vessel involucrado. Usa createMany con
 * skipDuplicates para que repeticiones sean no-op vía el @@unique.
 */
export async function enqueueNotificationForRoles(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  params: EnqueueParams,
): Promise<number> {
  return enqueueNotificationsBatch(prisma, [params]);
}

/**
 * Versión batch: los destinatarios dependen solo de (tenant, vessel), así que
 * se resuelven una vez por buque y todas las notificaciones entran en UN solo
 * createMany — no una query de memberships + un insert POR FILA como antes.
 */
export async function enqueueNotificationsBatch(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  items: EnqueueParams[],
): Promise<number> {
  if (items.length === 0) return 0;

  const vesselCodes = [...new Set(items.map((i) => i.vesselCode))];
  const recipientsByVessel = new Map<string | null, string[]>();
  await Promise.all(vesselCodes.map(async (vc) => {
    const memberships = await prisma.tenantMembership.findMany({
      where: {
        tenantId: items[0]!.tenantId,
        status: "ACTIVE",
        role: { in: [...NOTIFICATION_RECIPIENT_ROLES] },
        OR: vc
          ? [
              { role: "TENANT_ADMIN" },
              { assignedVesselCodes: { has: vc } },
            ]
          : undefined,
      },
      select: { userId: true },
    });
    recipientsByVessel.set(vc, memberships.map((m) => m.userId));
  }));

  const data = items.flatMap((params) =>
    (recipientsByVessel.get(params.vesselCode) ?? []).map((userId) => ({
      tenantId:        params.tenantId,
      recipientUserId: userId,
      vesselCode:      params.vesselCode,
      type:            params.type,
      severity:        params.severity,
      title:           params.title,
      body:            params.body ?? null,
      linkUrl:         params.linkUrl ?? null,
      sourceType:      params.sourceType,
      sourceId:        params.sourceId,
    })),
  );
  if (data.length === 0) return 0;

  const result = await prisma.notification.createMany({ data, skipDuplicates: true });
  return result.count;
}

// ---------------------------------------------------------------------------
// Listado / acciones del usuario
// ---------------------------------------------------------------------------

export interface NotificationView {
  id: string;
  vesselCode: string | null;
  type: string;
  severity: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  sourceType: string | null;
  sourceId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationListResponse {
  items: NotificationView[];
  unreadCount: number;
  criticalUnreadCount: number;
}

export async function listMyNotifications(
  session: TenantAccessSession,
): Promise<NotificationListResponse> {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [], unreadCount: 0, criticalUnreadCount: 0 };

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return { items: [], unreadCount: 0, criticalUnreadCount: 0 };

  // Lazy sync: alertas pasivas (WO vencida, cert vencido) se materializan acá.
  // Throttle in-memory para no recalcular en cada poll de 30s.
  // NO se hace await: es best-effort y correr en background evita que un sync
  // lento bloquee/cuelgue la respuesta de la lista (que se pollea cada 30s).
  // Lo que materialice aparecerá en el próximo poll.
  void syncStaleNotificationsIfDue(prisma, tenant.id, session);

  const baseWhere = { tenantId: tenant.id, recipientUserId: session.user.id, dismissedAt: null };

  const [rows, unread, critUnread] = await Promise.all([
    prisma.notification.findMany({
      where: baseWhere,
      orderBy: [{ createdAt: "desc" }],
      take: 50,
      select: {
        id: true, vesselCode: true, type: true, severity: true,
        title: true, body: true, linkUrl: true,
        sourceType: true, sourceId: true, createdAt: true, readAt: true,
      },
    }),
    prisma.notification.count({ where: { ...baseWhere, readAt: null } }),
    prisma.notification.count({ where: { ...baseWhere, readAt: null, severity: "CRITICAL" } }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      vesselCode: r.vesselCode,
      type: r.type,
      severity: r.severity,
      title: r.title,
      body: r.body,
      linkUrl: r.linkUrl,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt ? r.readAt.toISOString() : null,
    })),
    unreadCount: unread,
    criticalUnreadCount: critUnread,
  };
}

async function ensureOwned(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  session: TenantAccessSession,
  id: string,
) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  const row = await prisma.notification.findFirst({
    where: { id, tenantId: tenant.id, recipientUserId: session.user.id },
    select: { id: true },
  });
  if (!row) throw new RouteError(404, "NOT_FOUND", "Notification not found.");
  return tenant.id;
}

export async function markNotificationRead(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DB_UNAVAILABLE", "Database not available.");
  await ensureOwned(prisma, session, id);
  await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  return { ok: true };
}

export async function dismissNotification(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DB_UNAVAILABLE", "Database not available.");
  await ensureOwned(prisma, session, id);
  const now = new Date();
  await prisma.notification.update({
    where: { id },
    data: { dismissedAt: now, readAt: now },
  });
  return { ok: true };
}

export async function markAllNotificationsRead(session: TenantAccessSession) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DB_UNAVAILABLE", "Database not available.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  await prisma.notification.updateMany({
    where: { tenantId: tenant.id, recipientUserId: session.user.id, readAt: null, dismissedAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sync diferido — alertas que no son event-driven (WO vencidas, certs vencidos)
// Se calcula sobre el estado actual y se inserta lo que falte. Throttled.
// ---------------------------------------------------------------------------

const SYNC_THROTTLE_MS = 5 * 60_000; // cada 5 min por tenant
const lastSyncAt = new Map<string, number>();

async function syncStaleNotificationsIfDue(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  session: TenantAccessSession,
) {
  const last = lastSyncAt.get(tenantId) ?? 0;
  const now  = Date.now();
  if (now - last < SYNC_THROTTLE_MS) return;
  lastSyncAt.set(tenantId, now);

  // Best-effort: si falla, la lista igual se devuelve con lo que ya había.
  try {
    await syncOverdueWorkOrders(prisma, tenantId);
    await syncExpiredCertificates(prisma, tenantId);
  } catch {
    // swallow — silent best-effort sync
    void session;
  }
}

async function syncOverdueWorkOrders(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
) {
  const now = new Date();
  const overdue = await prisma.workOrder.findMany({
    where: {
      tenantId,
      deletedAt: null,
      dueDate: { lt: now },
      status: { notIn: ["CLOSED", "CANCELLED"] },
    },
    select: {
      id: true, workOrderCode: true, vesselCode: true, title: true, dueDate: true, priority: true,
    },
    take: 200,
  });
  await enqueueNotificationsBatch(prisma, overdue.map((wo) => {
    const daysOverdue = Math.floor((now.getTime() - (wo.dueDate?.getTime() ?? now.getTime())) / 86_400_000);
    return {
      tenantId,
      vesselCode: wo.vesselCode,
      type:       "WORK_ORDER_OVERDUE" as NotificationType,
      severity:   (wo.priority === "CRITICAL" ? "CRITICAL" : "HIGH") as NotificationSeverity,
      title:      `OT vencida — ${wo.workOrderCode}`,
      body:       `${wo.title}${daysOverdue > 0 ? ` · ${daysOverdue}d vencida` : ""}`,
      linkUrl:    `/work-orders?openId=${wo.id}`,
      sourceType: "WORK_ORDER",
      sourceId:   wo.id,
    };
  }));
}

async function syncExpiredCertificates(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
) {
  const now = new Date();
  const expired = await prisma.certificate.findMany({
    where: {
      tenantId,
      deletedAt: null,
      expiryDate: { lt: now },
      status: { notIn: ["SUSPENDED", "CLOSED"] },
    },
    select: {
      id: true, certificateCode: true, vesselCode: true, name: true, expiryDate: true,
    },
    take: 200,
  });
  await enqueueNotificationsBatch(prisma, expired.map((c) => ({
    tenantId,
    vesselCode: c.vesselCode,
    type:       "CERTIFICATE_EXPIRED" as NotificationType,
    severity:   "CRITICAL" as NotificationSeverity,
    title:      `Certificado vencido — ${c.name}`,
    body:       c.certificateCode ? `Código ${c.certificateCode}` : null,
    linkUrl:    `/certificates?vesselCode=${encodeURIComponent(c.vesselCode)}&status=EXPIRED`,
    sourceType: "CERTIFICATE",
    sourceId:   c.id,
  })));
}
