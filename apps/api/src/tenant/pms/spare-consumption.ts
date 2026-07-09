import { RouteError } from "../../http/route-error";

// ---------------------------------------------------------------------------
// Consumo de repuestos atado a un WorkLog (mantenimiento express de un plan).
//
// Reutilizable por el flujo de ejecución de planes (report-execution →
// quickClosePlan). Un consumo se modela como StockMovement ISSUE con
// referenceType=WORK_LOG / referenceId=<workLog.id>, que descuenta stock (el
// on-hand se deriva sumando movimientos vía stock-calc-service) y queda
// atribuido al equipo/plan del WorkLog.
// ---------------------------------------------------------------------------

export interface SpareUsageInput {
  spareId: string;
  qty: number;
  unit?: string | null;
}

export interface ResolvedConsumable {
  spareId: string;
  quantity: number;
  unit: string;
}

function reqText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}

function optText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

/**
 * Valida cada repuesto (pertenece al tenant/vessel, cantidad > 0) y resuelve la
 * unidad por defecto = unit del spare. Falla temprano (antes de cualquier
 * escritura) si un spareId no es del buque/tenant actual.
 */
export async function resolveConsumables(
  db: any,
  scope: { tenantId: string; vesselCode: string },
  usages: SpareUsageInput[] | undefined,
): Promise<ResolvedConsumable[]> {
  const lines = Array.isArray(usages) ? usages : [];
  const resolved: ResolvedConsumable[] = [];
  for (const [i, line] of lines.entries()) {
    const spareId = reqText(line.spareId, `spareUsages[${i}].spareId`);
    const quantity = Number(line.qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new RouteError(400, "VALIDATION_ERROR", `spareUsages[${i}].qty debe ser un número mayor a cero.`);
    }
    const spare = await db.spare.findFirst({
      where: { id: spareId, tenantId: scope.tenantId, vesselCode: scope.vesselCode, deletedAt: null },
      select: { id: true, unit: true },
    });
    if (!spare) {
      throw new RouteError(400, "SPARE_SCOPE_INVALID", `Repuesto ${spareId} inválido para el tenant/vessel actual.`);
    }
    const unit = optText(line.unit) ?? optText(spare.unit) ?? "u";
    resolved.push({ spareId: spare.id, quantity, unit });
  }
  return resolved;
}

/**
 * Crea los movimientos ISSUE de un WorkLog dentro de una transacción. Cada
 * ejecución de plan genera un WorkLog nuevo, así que no hay delete-then-recreate.
 */
export async function createWorkLogSpareMovements(
  tx: any,
  scope: { tenantId: string; vesselCode: string },
  workLogId: string,
  logCode: string,
  resolved: ResolvedConsumable[],
  actorUserId: string,
): Promise<void> {
  const stamp = Date.now();
  for (const [i, line] of resolved.entries()) {
    await tx.stockMovement.create({
      data: {
        tenantId: scope.tenantId,
        vesselCode: scope.vesselCode,
        spareId: line.spareId,
        movementCode: `MOV-${scope.vesselCode}-${stamp}-${i}`,
        movementType: "ISSUE",
        quantity: line.quantity,
        unit: line.unit,
        occurredAt: new Date(),
        referenceType: "WORK_LOG",
        referenceId: workLogId,
        notes: `Consumido en ${logCode}`,
        createdByUserId: actorUserId,
      },
    });
  }
}
