// Existencias de repuestos: se calculan SIEMPRE sumando los movimientos, nunca
// leyendo un saldo guardado (`Spare.currentStock` quedó deprecado por eso).
// Una sola fuente de verdad y trazable: cada unidad tiene su movimiento.
//
// PERF-001 (auditoría 2026-09-09): la suma se hacía trayendo TODOS los
// movimientos históricos de los repuestos pedidos y sumándolos en JavaScript.
// El trabajo crece con el historial, no con la cantidad de repuestos: con un
// millón de movimientos, listar el catálogo materializa un millón de filas.
// Ahora la suma la hace Postgres y vuelve UNA fila por (repuesto, tipo).
//
// La agregación es EQUIVALENTE a la anterior, no una aproximación: se piden por
// separado la suma cruda y la suma de valores absolutos, porque `signedQty`
// trata distinto los dos casos (ver abajo). Sumar y después aplicar el signo
// habría cambiado el resultado de cualquier movimiento cargado con signo
// invertido, que en datos históricos existe.

/** Cliente Prisma, o el `tx` de una transacción, o un doble de prueba. */
export interface StockCalcClient {
  stockMovement: {
    findMany(args: unknown): Promise<{ spareId?: string; movementType: string; quantity: number }[]>;
  };
  stockReservation?: {
    findMany(args: unknown): Promise<{ spareId: string; quantity: number }[]>;
  };
  $queryRawUnsafe?: (query: string, ...params: unknown[]) => Promise<unknown>;
}

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

/**
 * Aporte de un grupo (repuesto, tipo de movimiento) ya sumado en la base.
 *
 * `signedQty` aplica `Math.abs` a cada movimiento salvo en ADJUSTMENT, así que
 * el equivalente exacto de la suma fila por fila es:
 *   · ADJUSTMENT           → la suma CRUDA (conserva los signos guardados);
 *   · el resto de tipos    → la suma de ABSOLUTOS, con el signo del tipo;
 *   · un tipo desconocido  → 0, igual que antes.
 */
export function bucketContribution(movementType: string, rawSum: number, absSum: number): number {
  if (movementType === "ADJUSTMENT") return rawSum;
  return signedQty(movementType, absSum);
}

interface Bucket { spareId: string; movementType: string; rawSum: number; absSum: number }

/**
 * Suma los movimientos agrupando por (repuesto, tipo) en la base.
 *
 * Si el cliente no sabe correr SQL crudo —los dobles de prueba no tienen
 * `$queryRawUnsafe`— cae al camino anterior (findMany + suma en memoria), que
 * da el mismo resultado. El fallback mira si el método EXISTE; no se traga
 * errores de la consulta: si el SQL falla en producción, el error sube.
 */
async function aggregateMovements(
  client: StockCalcClient,
  spareIds: string[],
  opts: { tenantId?: string | null; locationId?: string | null } = {},
): Promise<Bucket[]> {
  if (spareIds.length === 0) return [];

  if (typeof client.$queryRawUnsafe === "function") {
    const params: unknown[] = [spareIds];
    const conds = [`"spareId" = ANY($1::text[])`];
    if (opts.tenantId) { params.push(opts.tenantId); conds.push(`"tenantId" = $${params.length}`); }
    if (opts.locationId != null) { params.push(opts.locationId); conds.push(`"locationId" = $${params.length}`); }

    const rows = await client.$queryRawUnsafe(
      `SELECT "spareId",
              "movementType"::text AS "movementType",
              COALESCE(SUM("quantity"), 0)      AS "rawSum",
              COALESCE(SUM(ABS("quantity")), 0) AS "absSum"
         FROM "StockMovement"
        WHERE ${conds.join(" AND ")}
        GROUP BY "spareId", "movementType"`,
      ...params,
    ) as { spareId: string; movementType: string; rawSum: unknown; absSum: unknown }[];

    return rows.map((r) => ({
      spareId: r.spareId,
      movementType: String(r.movementType),
      rawSum: Number(r.rawSum),
      absSum: Number(r.absSum),
    }));
  }

  // Camino sin SQL crudo: mismo cálculo, agrupando en memoria.
  const where: Record<string, unknown> = { spareId: { in: spareIds } };
  if (opts.tenantId) where.tenantId = opts.tenantId;
  if (opts.locationId != null) where.locationId = opts.locationId;

  const movements = await client.stockMovement.findMany({
    where,
    select: { spareId: true, movementType: true, quantity: true },
  });

  const byKey = new Map<string, Bucket>();
  for (const m of movements) {
    const spareId = String(m.spareId ?? spareIds[0]);
    const key = `${spareId}|${m.movementType}`;
    const bucket = byKey.get(key) ?? { spareId, movementType: String(m.movementType), rawSum: 0, absSum: 0 };
    bucket.rawSum += m.quantity;
    bucket.absSum += Math.abs(m.quantity);
    byKey.set(key, bucket);
  }
  return [...byKey.values()];
}

export async function getOnHandQty(
  client: StockCalcClient,
  spareId: string,
  locationId?: string | null,
  opts: { tenantId?: string | null } = {},
): Promise<number> {
  const buckets = await aggregateMovements(client, [spareId], { tenantId: opts.tenantId, locationId });
  return buckets.reduce((sum, b) => sum + bucketContribution(b.movementType, b.rawSum, b.absSum), 0);
}

/**
 * Existencias por repuesto.
 *
 * `opts.tenantId` es opcional por compatibilidad con los llamadores que ya
 * filtraron el catálogo por empresa, pero conviene pasarlo siempre: acota la
 * consulta a la empresa aunque a la lista se le cuele un id ajeno.
 */
export async function getOnHandMap(
  client: StockCalcClient,
  spareIds: string[],
  opts: { tenantId?: string | null } = {},
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (spareIds.length === 0) return map;

  const buckets = await aggregateMovements(client, spareIds, { tenantId: opts.tenantId });
  for (const b of buckets) {
    const prev = map.get(b.spareId) ?? 0;
    map.set(b.spareId, prev + bucketContribution(b.movementType, b.rawSum, b.absSum));
  }
  return map;
}

export function getAvailableQty(onHand: number, reserved = 0): number {
  return onHand - reserved;
}

/** Returns a map of spareId → reserved quantity from ACTIVE StockReservations. */
export async function getReservedMapFromCalc(
  client: StockCalcClient,
  tenantId: string,
  spareIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (spareIds.length === 0 || !client.stockReservation) return map;

  const reservations = await client.stockReservation.findMany({
    where: { tenantId, spareId: { in: spareIds }, status: "ACTIVE" },
    select: { spareId: true, quantity: true },
  });

  for (const r of reservations) {
    map.set(r.spareId, (map.get(r.spareId) ?? 0) + r.quantity);
  }
  return map;
}
