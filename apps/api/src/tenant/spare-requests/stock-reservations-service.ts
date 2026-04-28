import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { getOnHandMap } from "../pms/stock-calc-service";
import type { SpareRequestStatus } from "../../../../../generated/prisma";

function canManage(session: TenantAccessSession): boolean {
  return ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "PROCUREMENT_STORE"].includes(session.user.role);
}

async function resolveTenantId(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient()!;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

/** Get reserved quantity map for a set of spareIds (only ACTIVE reservations). */
export async function getReservedMap(
  tenantId: string,
  spareIds: string[],
): Promise<Map<string, number>> {
  if (spareIds.length === 0) return new Map();
  const prisma = getPrismaClient();
  if (!prisma) return new Map();

  const reservations = await prisma.stockReservation.findMany({
    where: { tenantId, spareId: { in: spareIds }, status: "ACTIVE" },
    select: { spareId: true, quantity: true },
  });

  const map = new Map<string, number>();
  for (const r of reservations) {
    map.set(r.spareId, (map.get(r.spareId) ?? 0) + r.quantity);
  }
  return map;
}

/** Create reservations for all PENDING items of an approved request that have a spareId. */
export async function createReservationsForRequest(session: TenantAccessSession, spareRequestId: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para crear reservas.");
  const prisma = getPrismaClient()!;
  const tenantId = await resolveTenantId(session);

  const req = await prisma.spareRequest.findFirst({
    where: { id: spareRequestId, tenantId, deletedAt: null },
    include: { items: true },
  });
  if (!req) throw new RouteError(404, "NOT_FOUND", "Solicitud no encontrada.");
  if (req.status !== "APPROVED") throw new RouteError(409, "INVALID_STATUS", "Solo se pueden crear reservas para solicitudes APPROVED.");

  const eligibleItems = req.items.filter(i => i.spareId && i.status === "PENDING");
  if (eligibleItems.length === 0) return { created: 0, skipped: 0 };

  const spareIds = eligibleItems.map(i => i.spareId as string);
  const onHandMap = await getOnHandMap(prisma, spareIds);
  const reservedMap = await getReservedMap(tenantId, spareIds);

  let created = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    for (const item of eligibleItems) {
      const spareId = item.spareId as string;
      const onHand   = onHandMap.get(spareId)   ?? 0;
      const reserved = reservedMap.get(spareId) ?? 0;
      const available = onHand - reserved;

      if (available <= 0) { skipped++; continue; }

      const toReserve = Math.min(item.quantity, available);

      await tx.stockReservation.create({
        data: {
          tenantId,
          spareId,
          requestItemId: item.id,
          locationId: req.requestedForLocationId ?? null,
          quantity: toReserve,
          status: "ACTIVE",
          createdByUserId: session.user.id,
          updatedByUserId: session.user.id,
        },
      });

      const newStatus = toReserve >= item.quantity ? "RESERVED" : "PARTIALLY_RESERVED";
      await tx.spareRequestItem.update({
        where: { id: item.id },
        data: {
          quantityReserved: toReserve,
          status: newStatus,
          updatedByUserId: session.user.id,
        },
      });

      created++;
    }
  });

  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id, action: "StockReservation.bulkCreated",
    entityType: "SpareRequest", entityId: req.id,
    metadata: { requestCode: req.requestCode, created, skipped },
  });

  return { created, skipped };
}

/** Release a single reservation (e.g. when item is cancelled or request cancelled). */
export async function releaseReservation(session: TenantAccessSession, reservationId: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para liberar reservas.");
  const prisma = getPrismaClient()!;
  const tenantId = await resolveTenantId(session);

  const res = await prisma.stockReservation.findFirst({ where: { id: reservationId, tenantId, status: "ACTIVE" } });
  if (!res) throw new RouteError(404, "NOT_FOUND", "Reserva activa no encontrada.");

  const updated = await prisma.stockReservation.update({
    where: { id: res.id },
    data: { status: "RELEASED", releasedAt: new Date(), updatedByUserId: session.user.id },
  });

  // If item no longer has any active reservation, revert to PENDING
  const stillActive = await prisma.stockReservation.count({
    where: { requestItemId: res.requestItemId, status: "ACTIVE" },
  });
  if (stillActive === 0) {
    await prisma.spareRequestItem.update({
      where: { id: res.requestItemId },
      data: { quantityReserved: 0, status: "PENDING", updatedByUserId: session.user.id },
    });
  }

  return updated;
}

/** Consume a reservation: record a stock movement (ISSUE) and mark reservation CONSUMED. */
export async function consumeReservation(session: TenantAccessSession, reservationId: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para consumir reservas.");
  const prisma = getPrismaClient()!;
  const tenantId = await resolveTenantId(session);

  const res = await prisma.stockReservation.findFirst({
    where: { id: reservationId, tenantId, status: "ACTIVE" },
    include: { spare: true, requestItem: { include: { spareRequest: true } } },
  });
  if (!res) throw new RouteError(404, "NOT_FOUND", "Reserva activa no encontrada.");

  const movementCode = `MOV-${res.spare.vesselCode}-${Date.now()}`;

  await prisma.$transaction(async (tx) => {
    // Create ISSUE movement
    await tx.stockMovement.create({
      data: {
        tenantId,
        vesselCode: res.spare.vesselCode,
        spareId: res.spareId,
        locationId: res.locationId,
        movementCode,
        movementType: "ISSUE",
        quantity: res.quantity,
        unit: res.spare.unit,
        occurredAt: new Date(),
        referenceType: "SPARE_ORDER",
        referenceId: res.requestItem.spareRequest.requestCode,
        notes: `Consumo de reserva para ${res.requestItem.spareRequest.requestCode}`,
        createdByUserId: session.user.id,
      },
    });

    // Mark reservation consumed
    await tx.stockReservation.update({
      where: { id: res.id },
      data: { status: "CONSUMED", consumedAt: new Date(), updatedByUserId: session.user.id },
    });

    // Update item fulfilled quantity
    const item = res.requestItem;
    const newFulfilled = item.quantityFulfilled + res.quantity;
    const newStatus = newFulfilled >= item.quantity ? "FULFILLED" : "PARTIALLY_RESERVED";
    await tx.spareRequestItem.update({
      where: { id: item.id },
      data: { quantityFulfilled: newFulfilled, status: newStatus, updatedByUserId: session.user.id },
    });
  });

  // Sync request status
  await syncRequestStatus(prisma, res.requestItem.spareRequestId, session.user.id);

  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id, action: "StockReservation.consumed",
    entityType: "StockReservation", entityId: res.id,
    metadata: { spareId: res.spareId, quantity: res.quantity },
  });

  return { ok: true };
}

async function syncRequestStatus(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, spareRequestId: string, userId: string) {
  const items = await prisma.spareRequestItem.findMany({ where: { spareRequestId } });
  const total = items.length;
  if (total === 0) return;
  const fulfilled = items.filter(i => i.status === "FULFILLED").length;
  const cancelled = items.filter(i => i.status === "CANCELLED").length;

  let status: SpareRequestStatus | null = null;
  if (fulfilled + cancelled === total && fulfilled > 0) status = "FULFILLED";
  else if (fulfilled > 0) status = "PARTIALLY_FULFILLED";

  if (status) {
    await prisma.spareRequest.update({
      where: { id: spareRequestId },
      data: { status, updatedByUserId: userId },
    });
  }
}

export async function listReservationsForRequest(session: TenantAccessSession, spareRequestId: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const req = await prisma.spareRequest.findFirst({ where: { id: spareRequestId, tenantId, deletedAt: null } });
  if (!req) throw new RouteError(404, "NOT_FOUND", "Solicitud no encontrada.");

  return prisma.stockReservation.findMany({
    where: { requestItem: { spareRequestId } },
    include: { spare: { select: { sku: true, name: true } }, location: { select: { code: true, name: true } } },
    orderBy: { reservedAt: "desc" },
  });
}
