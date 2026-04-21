import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface CreateOrderLineInput {
  spareId?: string | null;
  description: string;
  partNumber?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice?: number | null;
  currency?: string | null;
  notes?: string | null;
}

export interface UpdateOrderLineInput {
  spareId?: string | null;
  description?: string;
  partNumber?: string | null;
  quantity?: number;
  unit?: string | null;
  unitPrice?: number | null;
  currency?: string | null;
  notes?: string | null;
}

interface LineRecord {
  id: string;
  spareOrderId: string;
  spareId: string | null;
  description: string;
  partNumber: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  currency: string | null;
  notes: string | null;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string;
}

type LineDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<LineRecord[]>;
  create(args: { data: Record<string, unknown> }): Promise<LineRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<LineRecord>;
  delete(args: { where: { id: string } }): Promise<LineRecord>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
};

function lineDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): LineDelegate {
  return (prisma as unknown as { spareOrderLine: LineDelegate }).spareOrderLine;
}

function canManage(session: TenantAccessSession): boolean {
  return ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "PROCUREMENT_STORE"].includes(session.user.role);
}

function normalizeText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizePositiveNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) throw new RouteError(400, "VALIDATION_ERROR", `${field} debe ser un número positivo.`);
  return n;
}

async function assertOrderAccess(session: TenantAccessSession, spareOrderId: string): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  const order = await prisma.spareOrder.findFirst({ where: { id: spareOrderId, tenantId: tenant.id, deletedAt: null } });
  if (!order) throw new RouteError(404, "ORDER_NOT_FOUND", "Orden no encontrada.");
}

export async function listOrderLines(session: TenantAccessSession, spareOrderId: string) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  await assertOrderAccess(session, spareOrderId);

  const lines = await lineDelegate(prisma).findMany({ where: { spareOrderId }, orderBy: { createdAt: "asc" } });

  const spareIds = [...new Set(lines.map(l => l.spareId).filter(Boolean))] as string[];
  const spares = spareIds.length > 0
    ? await prisma.spare.findMany({ where: { id: { in: spareIds } }, select: { id: true, sku: true, name: true, unit: true } })
    : [];
  const spareMap = new Map(spares.map(s => [s.id, s]));

  return lines.map(l => ({
    ...l,
    spareSku:  l.spareId ? (spareMap.get(l.spareId)?.sku  ?? null) : null,
    spareName: l.spareId ? (spareMap.get(l.spareId)?.name ?? null) : null,
  }));
}

async function syncTotalLines(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, spareOrderId: string, userId: string) {
  const count = await lineDelegate(prisma).count({ where: { spareOrderId } });
  await prisma.spareOrder.update({ where: { id: spareOrderId }, data: { totalLines: count, updatedByUserId: userId } });
}

export async function addOrderLine(session: TenantAccessSession, spareOrderId: string, payload: CreateOrderLineInput) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar líneas.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  await assertOrderAccess(session, spareOrderId);

  const line = await lineDelegate(prisma).create({
    data: {
      spareOrderId,
      spareId:     normalizeOptionalText(payload.spareId),
      description: normalizeText(payload.description, "description"),
      partNumber:  normalizeOptionalText(payload.partNumber),
      quantity:    normalizePositiveNumber(payload.quantity, "quantity"),
      unit:        normalizeOptionalText(payload.unit),
      unitPrice:   payload.unitPrice != null ? Number(payload.unitPrice) : null,
      currency:    normalizeOptionalText(payload.currency),
      notes:       normalizeOptionalText(payload.notes),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
  await syncTotalLines(prisma, spareOrderId, session.user.id);
  return line;
}

export async function updateOrderLine(
  session: TenantAccessSession,
  spareOrderId: string,
  lineId: string,
  payload: UpdateOrderLineInput,
) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar líneas.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  await assertOrderAccess(session, spareOrderId);

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.spareId      !== undefined) data.spareId     = normalizeOptionalText(payload.spareId);
  if (payload.description  !== undefined) data.description = normalizeText(payload.description, "description");
  if (payload.partNumber   !== undefined) data.partNumber  = normalizeOptionalText(payload.partNumber);
  if (payload.quantity     !== undefined) data.quantity    = normalizePositiveNumber(payload.quantity, "quantity");
  if (payload.unit         !== undefined) data.unit        = normalizeOptionalText(payload.unit);
  if (payload.unitPrice    !== undefined) data.unitPrice   = payload.unitPrice != null ? Number(payload.unitPrice) : null;
  if (payload.currency     !== undefined) data.currency    = normalizeOptionalText(payload.currency);
  if (payload.notes        !== undefined) data.notes       = normalizeOptionalText(payload.notes);

  return lineDelegate(prisma).update({ where: { id: lineId }, data });
}

export async function deleteOrderLine(session: TenantAccessSession, spareOrderId: string, lineId: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar líneas.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  await assertOrderAccess(session, spareOrderId);

  await lineDelegate(prisma).delete({ where: { id: lineId } });
  await syncTotalLines(prisma, spareOrderId, session.user.id);
  return { ok: true };
}
