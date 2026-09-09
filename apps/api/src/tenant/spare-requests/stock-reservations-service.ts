// Reservas de stock de una solicitud de repuestos.
//
// Correcciones de la auditoría 2026-09-09 (BUG-002, BUG-003, CONC-001):
//
//   · la disponibilidad se leía UNA vez antes de la transacción y no bajaba al
//     reservar cada línea → una misma solicitud con el repuesto repetido podía
//     reservar más de lo que hay (10 en stock, dos líneas de 8 → 16 reservadas);
//   · nada serializaba dos solicitudes simultáneas sobre el mismo repuesto;
//   · el consumo leía la reserva ACTIVE fuera de la transacción y después la
//     actualizaba por id, sin exigir que siguiera activa → dos llamadas a la vez
//     descontaban el stock dos veces;
//   · ninguna de estas operaciones miraba el buque, sólo la empresa.
//
// Las tres protecciones son distintas y se necesitan las tres:
//   1. el saldo se recalcula DENTRO de la transacción y baja línea a línea;
//   2. un advisory lock por repuesto serializa a los que compiten por el mismo
//      stock (se toman en orden de id para no trabarse entre sí);
//   3. cada transición de estado se "reclama" con un updateMany condicionado:
//      el que pierde la carrera cuenta 0 y no escribe nada. Es lo único que
//      sigue protegiendo si el motor no soporta advisory locks.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { takeAdvisoryXactLock } from "../../common/advisory-lock";
import { getOnHandMap, type StockCalcClient } from "../pms/stock-calc-service";
import { assertVesselAccess } from "./spare-request-scope";
import type { SpareRequestStatus } from "../../../../../generated/prisma";

function canManage(session: TenantAccessSession): boolean {
  return hasPermission(session, "spare.manage");
}

/**
 * Márgenes de las transacciones que toman advisory locks.
 *
 * El default de Prisma para una transacción interactiva es 5 s. Estas esperan a
 * que otra suelte el lock del mismo repuesto, así que ese margen se puede
 * quedar corto justo cuando hay concurrencia — que es cuando el lock importa.
 * Si igual se agota, la transacción se deshace entera: se pierde la operación,
 * no la consistencia del stock.
 */
const TX_LOCK_OPTIONS = { timeout: 15_000, maxWait: 10_000 } as const;

async function resolveTenantId(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient()!;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

/** Cliente con lo mínimo que usan las lecturas de reservas (prisma o `tx`). */
interface ReservationReader {
  stockReservation: { findMany(args: unknown): Promise<{ spareId: string; quantity: number }[]> };
}

/** Get reserved quantity map for a set of spareIds (only ACTIVE reservations). */
export async function getReservedMap(
  tenantId: string,
  spareIds: string[],
  client?: ReservationReader,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (spareIds.length === 0) return map;

  const reader = client ?? getPrismaClient();
  if (!reader) return map;

  const reservations = await reader.stockReservation.findMany({
    where: { tenantId, spareId: { in: spareIds }, status: "ACTIVE" },
    select: { spareId: true, quantity: true },
  });

  for (const r of reservations) {
    map.set(r.spareId, (map.get(r.spareId) ?? 0) + r.quantity);
  }
  return map;
}

// ── Reparto de la disponibilidad (decisión pura, sin base) ───────────────────

export interface ReservablePlanItem { id: string; spareId: string; quantity: number }
export interface ReservationAllocation { itemId: string; spareId: string; quantity: number }

/**
 * Reparte el stock disponible entre las líneas a reservar, EN ORDEN.
 *
 * El saldo baja con cada línea servida: por eso dos líneas del mismo repuesto
 * ya no pueden reservar cada una el total disponible (BUG-002). Una línea sin
 * saldo se saltea; una línea con saldo parcial reserva lo que hay.
 *
 * @param available  Disponible (existencias − reservas activas) por repuesto.
 *                   NO se modifica: se trabaja sobre una copia.
 */
export function planReservations(
  items: ReservablePlanItem[],
  available: Map<string, number>,
): { allocations: ReservationAllocation[]; skipped: number } {
  const saldo = new Map(available);
  const allocations: ReservationAllocation[] = [];
  let skipped = 0;

  for (const item of items) {
    const libre = saldo.get(item.spareId) ?? 0;
    if (libre <= 0) { skipped++; continue; }

    const toReserve = Math.min(item.quantity, libre);
    saldo.set(item.spareId, libre - toReserve);
    allocations.push({ itemId: item.id, spareId: item.spareId, quantity: toReserve });
  }

  return { allocations, skipped };
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
  assertVesselAccess(session, req.requestedForVesselCode);
  if (req.status !== "APPROVED") throw new RouteError(409, "INVALID_STATUS", "Solo se pueden crear reservas para solicitudes APPROVED.");

  const eligibleItems = req.items.filter(i => i.spareId && i.status === "PENDING");
  if (eligibleItems.length === 0) return { created: 0, skipped: 0 };

  // Orden estable de repuestos: todas las transacciones toman los locks en el
  // mismo orden, así dos solicitudes que comparten repuestos no se traban.
  const spareIds = [...new Set(eligibleItems.map(i => i.spareId as string))].sort();

  let created = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    for (const spareId of spareIds) {
      await takeAdvisoryXactLock(tx as never, `spare-stock|${tenantId}|${spareId}`);
    }

    // Recién con los locks tomados se mira el stock: cualquier reserva que
    // estuviera a mitad de camino ya terminó y está contada.
    const onHandMap   = await getOnHandMap(tx as unknown as StockCalcClient, spareIds, { tenantId });
    const reservedMap = await getReservedMap(tenantId, spareIds, tx as unknown as ReservationReader);

    const available = new Map<string, number>();
    for (const spareId of spareIds) {
      available.set(spareId, (onHandMap.get(spareId) ?? 0) - (reservedMap.get(spareId) ?? 0));
    }

    const plan = planReservations(
      eligibleItems.map(i => ({ id: i.id, spareId: i.spareId as string, quantity: i.quantity })),
      available,
    );
    skipped = plan.skipped;

    for (const alloc of plan.allocations) {
      const item = eligibleItems.find(i => i.id === alloc.itemId)!;
      const newStatus = alloc.quantity >= item.quantity ? "RESERVED" : "PARTIALLY_RESERVED";

      // El ítem se reclama en PENDING: si otra llamada a esta misma función ya
      // lo reservó, cuenta 0 y no se crea una reserva duplicada.
      const claimed = await tx.spareRequestItem.updateMany({
        where: { id: item.id, status: "PENDING" },
        data: {
          quantityReserved: alloc.quantity,
          status: newStatus,
          updatedByUserId: session.user.id,
        },
      });
      if (claimed.count === 0) { skipped++; continue; }

      await tx.stockReservation.create({
        data: {
          tenantId,
          spareId: alloc.spareId,
          requestItemId: item.id,
          locationId: req.requestedForLocationId ?? null,
          quantity: alloc.quantity,
          status: "ACTIVE",
          createdByUserId: session.user.id,
          updatedByUserId: session.user.id,
        },
      });

      created++;
    }
  }, TX_LOCK_OPTIONS);

  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id, action: "StockReservation.bulkCreated",
    entityType: "SpareRequest", entityId: req.id,
    metadata: { requestCode: req.requestCode, created, skipped },
  });

  return { created, skipped };
}

/**
 * Reserva + su solicitud, validando empresa y buque.
 *
 * BUG-003: antes alcanzaba con conocer el id de una reserva de la misma empresa
 * para liberarla o consumirla, aunque fuera de un buque que el usuario no tiene
 * asignado. La regla de buque es la misma que la de la solicitud padre.
 */
async function getReservationInScope(session: TenantAccessSession, tenantId: string, reservationId: string) {
  const prisma = getPrismaClient()!;
  const res = await prisma.stockReservation.findFirst({
    where: { id: reservationId, tenantId },
    include: { spare: true, requestItem: { include: { spareRequest: true } } },
  });
  if (!res) throw new RouteError(404, "NOT_FOUND", "Reserva no encontrada.");
  assertVesselAccess(session, res.requestItem.spareRequest.requestedForVesselCode);
  if (res.status !== "ACTIVE") throw new RouteError(404, "NOT_FOUND", "Reserva activa no encontrada.");
  return res;
}

/** Release a single reservation (e.g. when item is cancelled or request cancelled). */
export async function releaseReservation(session: TenantAccessSession, reservationId: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para liberar reservas.");
  const prisma = getPrismaClient()!;
  const tenantId = await resolveTenantId(session);

  const res = await getReservationInScope(session, tenantId, reservationId);

  // Transición atómica: dos liberaciones simultáneas no pueden ganar las dos.
  const claimed = await prisma.stockReservation.updateMany({
    where: { id: res.id, tenantId, status: "ACTIVE" },
    data: { status: "RELEASED", releasedAt: new Date(), updatedByUserId: session.user.id },
  });
  if (claimed.count === 0) throw new RouteError(404, "NOT_FOUND", "Reserva activa no encontrada.");

  // If item no longer has any active reservation, revert to PENDING
  const stillActive = await prisma.stockReservation.count({
    where: { requestItemId: res.requestItemId, status: "ACTIVE" },
  });
  if (stillActive === 0) {
    // Sólo vuelve a PENDING si sigue reservado: un ítem ya entregado
    // (FULFILLED) no se revierte al liberar una reserva sobrante.
    await prisma.spareRequestItem.updateMany({
      where: { id: res.requestItemId, status: { in: ["RESERVED", "PARTIALLY_RESERVED"] } },
      data: { quantityReserved: 0, status: "PENDING", updatedByUserId: session.user.id },
    });
  }

  return prisma.stockReservation.findFirst({ where: { id: res.id } });
}

/** Consume a reservation: record a stock movement (ISSUE) and mark reservation CONSUMED. */
export async function consumeReservation(session: TenantAccessSession, reservationId: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para consumir reservas.");
  const prisma = getPrismaClient()!;
  const tenantId = await resolveTenantId(session);

  const res = await getReservationInScope(session, tenantId, reservationId);
  const movementCode = `MOV-${res.spare.vesselCode}-${Date.now()}`;

  await prisma.$transaction(async (tx) => {
    // Serializa los consumos del MISMO ítem: dos reservas distintas del mismo
    // ítem no pueden calcular `quantityFulfilled` sobre la misma lectura.
    await takeAdvisoryXactLock(tx as never, `spare-request-item|${res.requestItemId}`);

    // CONC-001: la reserva se reclama acá, no antes de la transacción. El
    // `status: "ACTIVE"` en el where es la condición de la carrera: sólo una
    // llamada puede pasar de ACTIVE a CONSUMED, y sólo esa registra el
    // movimiento de stock. La otra aborta sin escribir nada.
    const claimed = await tx.stockReservation.updateMany({
      where: { id: res.id, tenantId, status: "ACTIVE" },
      data: { status: "CONSUMED", consumedAt: new Date(), updatedByUserId: session.user.id },
    });
    if (claimed.count === 0) {
      throw new RouteError(409, "RESERVATION_NOT_ACTIVE", "La reserva ya fue consumida o liberada.");
    }

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
        referenceType: "SPARE_REQUEST",
        referenceId: res.requestItem.spareRequest.requestCode,
        notes: `Consumo de reserva para ${res.requestItem.spareRequest.requestCode}`,
        createdByUserId: session.user.id,
      },
    });

    // La cantidad entregada se relee DENTRO de la transacción: sumar sobre la
    // lectura previa perdía lo que hubiera entregado otra reserva del ítem.
    const item = await tx.spareRequestItem.findUnique({
      where: { id: res.requestItemId },
      select: { quantity: true, quantityFulfilled: true },
    });
    const previo = item?.quantityFulfilled ?? res.requestItem.quantityFulfilled;
    const total  = item?.quantity ?? res.requestItem.quantity;

    const newFulfilled = previo + res.quantity;
    const newStatus = newFulfilled >= total ? "FULFILLED" : "PARTIALLY_RESERVED";
    await tx.spareRequestItem.update({
      where: { id: res.requestItemId },
      data: { quantityFulfilled: newFulfilled, status: newStatus, updatedByUserId: session.user.id },
    });
  }, TX_LOCK_OPTIONS);

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
  assertVesselAccess(session, req.requestedForVesselCode);

  return prisma.stockReservation.findMany({
    where: { requestItem: { spareRequestId } },
    include: { spare: { select: { sku: true, name: true } }, location: { select: { code: true, name: true } } },
    orderBy: { reservedAt: "desc" },
  });
}
