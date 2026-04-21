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
  movementType: "RECEIPT" | "ISSUE" | "ADJUSTMENT" | "TRANSFER";
  quantity: number;
  unit: string;
  occurredAt: string | Date;
  referenceType?: "SPARE_ORDER" | "WORK_ORDER" | "DEFECT" | "ADJUSTMENT" | null;
  referenceId?: string | null;
  notes?: string | null;
}

function canManage(session: TenantAccessSession): boolean {
  return ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "PROCUREMENT_STORE"].includes(session.user.role);
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

  return prisma.stockMovement.findMany({ where, orderBy: { occurredAt: "desc" } });
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
  if ((movementType === "RECEIPT" || movementType === "ISSUE" || movementType === "TRANSFER") && quantity < 0) {
    throw new RouteError(400, "VALIDATION_ERROR", "Para RECEIPT/ISSUE/TRANSFER quantity debe ser positivo.");
  }

  const occurredAt = parseDate(payload.occurredAt);
  const movementCode = `MOV-${vesselCode}-${Date.now()}`;

  return prisma.$transaction(async (tx) => {
    const spare = await tx.spare.findFirst({
      where: { id: payload.spareId, tenantId, vesselCode, deletedAt: null },
    });
    if (!spare) throw new RouteError(404, "SPARE_NOT_FOUND", "Spare no encontrado.");

    let delta = 0;
    if (movementType === "RECEIPT") delta = quantity;
    if (movementType === "ISSUE") delta = -quantity;
    if (movementType === "TRANSFER") delta = -quantity;
    if (movementType === "ADJUSTMENT") delta = quantity;

    const movement = await tx.stockMovement.create({
      data: {
        tenantId,
        vesselCode,
        spareId: spare.id,
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

    await tx.spare.update({
      where: { id: spare.id },
      data: { currentStock: spare.currentStock + delta, updatedByUserId: session.user.id },
    });

    return movement;
  });
}
