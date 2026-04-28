import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevStockMovementsForTenant } from "../../platform/data/dev-domain-store";
import { RouteError } from "../../http/route-error";

export interface StockMovementListFilters {
  vesselCode?: string | null;
  movementType?: string | null;
  spareId?: string | null;
}

export interface CreateStockMovementInput {
  vesselCode: string;
  spareId: string;
  locationId?: string | null;
  movementType: "RECEIPT" | "ISSUE" | "ADJUSTMENT" | "TRANSFER" | "TRANSFER_IN" | "TRANSFER_OUT" | "RETURN_IN" | "ADJUSTMENT_PLUS" | "ADJUSTMENT_MINUS";
  quantity: number;
  unit: string;
  occurredAt: string | Date;
  referenceType?: "SPARE_ORDER" | "WORK_ORDER" | "DEFECT" | "ADJUSTMENT" | null;
  referenceId?: string | null;
  notes?: string | null;
}

function canManage(session: TenantAccessSession): boolean {
  return ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER", "PROCUREMENT_STORE"].includes(session.user.role);
}

function normalizeText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}

function parseDate(value: unknown): Date {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new RouteError(400, "VALIDATION_ERROR", "Fecha inválida.");
  return parsed;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

function applyVesselScope(session: TenantAccessSession, where: Record<string, unknown>, vesselCode?: string | null, forbid = false) {
  if (session.user.role === "TENANT_ADMIN") {
    if (vesselCode) where.vesselCode = vesselCode;
    return;
  }

  if (vesselCode) {
    if (!session.user.assignedVesselCodes.includes(vesselCode)) {
      if (forbid) throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
      where.vesselCode = "__NO_MATCH__";
      return;
    }
    where.vesselCode = vesselCode;
    return;
  }

  if (session.user.assignedVesselCodes.length === 0) {
    where.vesselCode = "__NO_MATCH__";
    return;
  }
  where.vesselCode = { in: session.user.assignedVesselCodes };
}

export async function listTenantStockMovements(session: TenantAccessSession, filters: StockMovementListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevStockMovementsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.movementType) where.movementType = filters.movementType;
  if (filters.spareId) where.spareId = filters.spareId;

  const movements = await prisma.stockMovement.findMany({ where, orderBy: { occurredAt: "desc" } });
  if (movements.length === 0) return [];

  const woIds  = [...new Set(movements.filter(m => m.referenceType === "WORK_ORDER" && m.referenceId).map(m => m.referenceId!))];
  const defIds = [...new Set(movements.filter(m => m.referenceType === "DEFECT"     && m.referenceId).map(m => m.referenceId!))];

  type WORow  = { id: string; workOrderCode: string };
  type DefRow = { id: string; defectCode:    string };
  const prismaAny = prisma as unknown as {
    workOrder: { findMany(a: unknown): Promise<WORow[]> };
    defect:    { findMany(a: unknown): Promise<DefRow[]> };
  };

  const [workOrders, defects] = await Promise.all([
    woIds.length  > 0 ? prismaAny.workOrder.findMany({ where: { id: { in: woIds  } }, select: { id: true, workOrderCode: true } }) : [] as WORow[],
    defIds.length > 0 ? prismaAny.defect.findMany(   { where: { id: { in: defIds } }, select: { id: true, defectCode:    true } }) : [] as DefRow[],
  ]);

  const codeMap = new Map<string, string>();
  workOrders.forEach(r => codeMap.set(r.id, r.workOrderCode));
  defects.forEach(r    => codeMap.set(r.id, r.defectCode));

  return movements.map(m => ({
    ...m,
    referenceCode: m.referenceId ? (codeMap.get(m.referenceId) ?? null) : null,
  }));
}

export async function createStockMovement(session: TenantAccessSession, payload: CreateStockMovementInput) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para registrar movimientos.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const vesselCode = normalizeText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);

  const quantity = Number(payload.quantity);
  if (!Number.isFinite(quantity) || quantity === 0) {
    throw new RouteError(400, "VALIDATION_ERROR", "quantity debe ser un número distinto de cero.");
  }

  const movementType = payload.movementType;
  const positiveOnlyTypes = ["RECEIPT", "ISSUE", "TRANSFER", "TRANSFER_IN", "TRANSFER_OUT", "RETURN_IN", "ADJUSTMENT_PLUS", "ADJUSTMENT_MINUS"];
  if (positiveOnlyTypes.includes(movementType) && quantity < 0) {
    throw new RouteError(400, "VALIDATION_ERROR", "La cantidad debe ser positiva para este tipo de movimiento.");
  }

  const occurredAt = parseDate(payload.occurredAt);
  const movementCode = `MOV-${vesselCode}-${Date.now()}`;

  const spare = await prisma.spare.findFirst({
    where: { id: payload.spareId, tenantId, vesselCode, deletedAt: null },
  });
  if (!spare) throw new RouteError(404, "SPARE_NOT_FOUND", "Spare no encontrado.");

  const movement = await prisma.stockMovement.create({
    data: {
      tenantId,
      vesselCode,
      spareId: spare.id,
      locationId: payload.locationId ?? null,
      movementCode,
      movementType,
      quantity,
      unit: normalizeText(payload.unit, "unit"),
      occurredAt,
      referenceType: payload.referenceType ?? null,
      referenceId: payload.referenceId ? String(payload.referenceId).trim() : null,
      notes: payload.notes ? String(payload.notes).trim() : null,
      createdByUserId: session.user.id,
    },
  });

  // Log manual adjustments to the audit log (bitácora)
  if (payload.referenceType === "ADJUSTMENT") {
    await prisma.auditEvent.create({
      data: {
        tenantId,
        actorType:   "TENANT_USER",
        actorUserId: session.user.id,
        action:      "STOCK_ADJUSTED",
        entityType:  "Spare",
        entityId:    spare.id,
        metadata: {
          sku:         spare.sku,
          movementType,
          quantity,
          unit:        normalizeText(payload.unit, "unit"),
          notes:       payload.notes ?? null,
          adjustedBy:  `${session.user.firstName ?? ""} ${session.user.lastName ?? ""}`.trim() || session.user.id,
        },
      },
    });
  }

  return movement;
}
