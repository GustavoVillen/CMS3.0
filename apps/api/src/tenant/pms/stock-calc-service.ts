import type { PrismaClient } from "../../../../../generated/prisma";

// Positive types always add stock; negative types always reduce it.
// ADJUSTMENT uses signed quantity as stored (can be + or -).
function signedQty(movementType: string, quantity: number): number {
  switch (movementType) {
    case "RECEIPT":
    case "TRANSFER_IN":
    case "RETURN_IN":
    case "ADJUSTMENT_PLUS":
      return Math.abs(quantity);
    case "ISSUE":
    case "TRANSFER_OUT":
    case "TRANSFER":
    case "ADJUSTMENT_MINUS":
      return -Math.abs(quantity);
    case "ADJUSTMENT":
      return quantity; // stored as signed
    default:
      return 0;
  }
}

export async function getOnHandQty(
  prisma: PrismaClient,
  spareId: string,
  locationId?: string | null,
): Promise<number> {
  const where: Record<string, unknown> = { spareId };
  if (locationId !== undefined && locationId !== null) where.locationId = locationId;

  const movements = await prisma.stockMovement.findMany({
    where,
    select: { movementType: true, quantity: true },
  });

  return movements.reduce((sum: number, m) => sum + signedQty(m.movementType, m.quantity), 0);
}

export async function getOnHandMap(
  prisma: PrismaClient,
  spareIds: string[],
): Promise<Map<string, number>> {
  if (spareIds.length === 0) return new Map();

  const movements = await prisma.stockMovement.findMany({
    where: { spareId: { in: spareIds } },
    select: { spareId: true, movementType: true, quantity: true },
  });

  const map = new Map<string, number>();
  for (const m of movements) {
    const prev = map.get(m.spareId as string) ?? 0;
    map.set(m.spareId as string, prev + signedQty(m.movementType as string, m.quantity as number));
  }
  return map;
}

export function getAvailableQty(onHand: number, reserved = 0): number {
  return onHand - reserved;
}

/** Returns a map of spareId → reserved quantity from ACTIVE StockReservations. */
export async function getReservedMapFromCalc(
  prisma: PrismaClient,
  tenantId: string,
  spareIds: string[],
): Promise<Map<string, number>> {
  if (spareIds.length === 0) return new Map();

  const reservations = await prisma.stockReservation.findMany({
    where: { tenantId, spareId: { in: spareIds }, status: "ACTIVE" },
    select: { spareId: true, quantity: true },
  });

  const map = new Map<string, number>();
  for (const r of reservations) {
    map.set(r.spareId as string, (map.get(r.spareId as string) ?? 0) + (r.quantity as number));
  }
  return map;
}
