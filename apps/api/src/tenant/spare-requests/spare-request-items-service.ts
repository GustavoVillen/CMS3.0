import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface AddRequestItemInput {
  spareId?: string | null;
  description: string;
  quantity: number;
  unit: string;
  notes?: string | null;
}

export interface UpdateRequestItemInput {
  spareId?: string | null;
  description?: string;
  quantity?: number;
  unit?: string;
  notes?: string | null;
}

function canManage(session: TenantAccessSession): boolean {
  return ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "PROCUREMENT_STORE", "TECHNICIAN_OPERATOR"].includes(session.user.role);
}

async function assertRequestAccess(session: TenantAccessSession, spareRequestId: string) {
  const prisma = getPrismaClient()!;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  const req = await prisma.spareRequest.findFirst({
    where: { id: spareRequestId, tenantId: tenant.id, deletedAt: null },
  });
  if (!req) throw new RouteError(404, "NOT_FOUND", "Solicitud no encontrada.");
  return req;
}

export async function listRequestItems(session: TenantAccessSession, spareRequestId: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const req = await assertRequestAccess(session, spareRequestId);

  const items = await prisma.spareRequestItem.findMany({
    where: { spareRequestId: req.id },
    orderBy: { createdAt: "asc" },
  });

  // Enrich with spareSku/spareName
  const spareIds = items.map(i => i.spareId).filter(Boolean) as string[];
  const spares = spareIds.length > 0
    ? await prisma.spare.findMany({ where: { id: { in: spareIds }, tenantId: req.tenantId }, select: { id: true, sku: true, name: true, unit: true } })
    : [];
  const spareMap = new Map(spares.map(s => [s.id, s]));

  return items.map(i => ({
    ...i,
    spareSku:  i.spareId ? (spareMap.get(i.spareId)?.sku  ?? null) : null,
    spareName: i.spareId ? (spareMap.get(i.spareId)?.name ?? null) : null,
  }));
}

export async function addRequestItem(session: TenantAccessSession, spareRequestId: string, payload: AddRequestItemInput) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para agregar ítems.");
  const prisma = getPrismaClient()!;
  const req = await assertRequestAccess(session, spareRequestId);
  if (!["DRAFT"].includes(req.status)) {
    throw new RouteError(409, "INVALID_STATUS", "Solo se pueden agregar ítems a solicitudes en estado DRAFT.");
  }

  const description = String(payload.description ?? "").trim();
  if (!description) throw new RouteError(400, "VALIDATION_ERROR", "La descripción es requerida.");
  const quantity = Number(payload.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new RouteError(400, "VALIDATION_ERROR", "La cantidad debe ser mayor a cero.");
  const unit = String(payload.unit ?? "").trim();
  if (!unit) throw new RouteError(400, "VALIDATION_ERROR", "La unidad es requerida.");

  return prisma.spareRequestItem.create({
    data: {
      spareRequestId: req.id,
      spareId: payload.spareId ?? null,
      description,
      quantity,
      unit,
      notes: payload.notes ? String(payload.notes).trim() || null : null,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
}

export async function updateRequestItem(
  session: TenantAccessSession,
  spareRequestId: string,
  itemId: string,
  payload: UpdateRequestItemInput,
) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para editar ítems.");
  const prisma = getPrismaClient()!;
  const req = await assertRequestAccess(session, spareRequestId);
  if (!["DRAFT"].includes(req.status)) {
    throw new RouteError(409, "INVALID_STATUS", "Solo se pueden editar ítems de solicitudes en estado DRAFT.");
  }

  const item = await prisma.spareRequestItem.findFirst({ where: { id: itemId, spareRequestId: req.id } });
  if (!item) throw new RouteError(404, "NOT_FOUND", "Ítem no encontrado.");

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.spareId !== undefined)    data.spareId = payload.spareId ?? null;
  if (payload.description !== undefined) {
    const desc = String(payload.description).trim();
    if (!desc) throw new RouteError(400, "VALIDATION_ERROR", "La descripción es requerida.");
    data.description = desc;
  }
  if (payload.quantity !== undefined) {
    const qty = Number(payload.quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw new RouteError(400, "VALIDATION_ERROR", "La cantidad debe ser mayor a cero.");
    data.quantity = qty;
  }
  if (payload.unit !== undefined) {
    const u = String(payload.unit).trim();
    if (!u) throw new RouteError(400, "VALIDATION_ERROR", "La unidad es requerida.");
    data.unit = u;
  }
  if (payload.notes !== undefined) data.notes = payload.notes ? String(payload.notes).trim() || null : null;

  return prisma.spareRequestItem.update({ where: { id: item.id }, data });
}

export async function fulfillItem(
  session: TenantAccessSession,
  spareRequestId: string,
  itemId: string,
  payload: { receivedAt?: string | null; receiptNotes?: string | null } = {},
) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para registrar entregas.");
  const prisma = getPrismaClient()!;
  const req = await assertRequestAccess(session, spareRequestId);
  if (!["APPROVED", "PARTIALLY_FULFILLED"].includes(req.status)) {
    throw new RouteError(409, "INVALID_STATUS", "La solicitud debe estar aprobada para registrar entregas.");
  }

  const item = await prisma.spareRequestItem.findFirst({
    where: { id: itemId, spareRequestId: req.id },
    include: { spare: true },
  });
  if (!item) throw new RouteError(404, "NOT_FOUND", "Ítem no encontrado.");
  if (item.status === "FULFILLED") throw new RouteError(409, "ALREADY_FULFILLED", "El ítem ya fue entregado.");

  const tenant = await prisma.tenant.findUnique({
    where: { slug: session.tenantSlug },
    include: { settings: true },
  });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const tenantTz = (tenant as any).settings?.timezone ?? "UTC";
  function parseLocalDate(dateStr: string): Date {
    if (dateStr.includes("T")) return new Date(dateStr);
    // Interpret date-only as noon in tenant timezone to avoid day-boundary shifts
    const [y, mo, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, mo! - 1, d!, 12, 0, 0));
    const tzOffset = new Intl.DateTimeFormat("en", { timeZone: tenantTz, timeZoneName: "shortOffset" })
      .formatToParts(dt).find(p => p.type === "timeZoneName")?.value ?? "";
    const match = tzOffset.match(/([+-])(\d+):?(\d*)/);
    if (match) {
      const sign = match[1] === "+" ? -1 : 1;
      dt.setUTCMinutes(dt.getUTCMinutes() + sign * (parseInt(match[2]!) * 60 + parseInt(match[3] || "0")));
    }
    return dt;
  }

  await prisma.$transaction(async (tx) => {
    // Stock movement ISSUE if item has a linked spare
    if (item.spareId && item.spare) {
      const movementCode = `RCP-${item.spare.vesselCode}-${Date.now()}`;
      await tx.stockMovement.create({
        data: {
          tenantId: tenant.id,
          vesselCode: item.spare.vesselCode,
          spareId: item.spareId,
          movementCode,
          movementType: "RECEIPT",
          quantity: item.quantity,
          unit: item.unit,
          occurredAt: new Date(),
          referenceType: "SPARE_REQUEST",
          referenceId: req.requestCode,
          notes: `Recepción por ${req.requestCode}`,
          createdByUserId: session.user.id,
        },
      });
    }

    // Mark item fulfilled
    await tx.spareRequestItem.update({
      where: { id: item.id },
      data: {
        status: "FULFILLED",
        quantityFulfilled: item.quantity,
        receivedAt: payload.receivedAt ? parseLocalDate(payload.receivedAt) : new Date(),
        receiptNotes: payload.receiptNotes?.trim() || null,
        updatedByUserId: session.user.id,
      },
    });

    // Sync request status
    const allItems = await tx.spareRequestItem.findMany({ where: { spareRequestId: req.id } });
    const fulfilled = allItems.filter(i => i.id === item.id || i.status === "FULFILLED").length;
    const cancelled = allItems.filter(i => i.status === "CANCELLED").length;
    const total = allItems.length;
    let newStatus: string | null = null;
    if (fulfilled + cancelled === total && fulfilled > 0) newStatus = "FULFILLED";
    else if (fulfilled > 0) newStatus = "PARTIALLY_FULFILLED";
    if (newStatus) {
      await tx.spareRequest.update({
        where: { id: req.id },
        data: { status: newStatus as any, updatedByUserId: session.user.id },
      });
    }
  });

  return { ok: true };
}

export async function deleteRequestItem(session: TenantAccessSession, spareRequestId: string, itemId: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para eliminar ítems.");
  const prisma = getPrismaClient()!;
  const req = await assertRequestAccess(session, spareRequestId);
  if (!["DRAFT"].includes(req.status)) {
    throw new RouteError(409, "INVALID_STATUS", "Solo se pueden eliminar ítems de solicitudes en estado DRAFT.");
  }

  const item = await prisma.spareRequestItem.findFirst({ where: { id: itemId, spareRequestId: req.id } });
  if (!item) throw new RouteError(404, "NOT_FOUND", "Ítem no encontrado.");

  await prisma.spareRequestItem.delete({ where: { id: item.id } });
  return { ok: true };
}
