// REPUESTOS / MATERIALES planificados de una OT (recuadros del formulario
// REGI-OPE-26.3). Se cargan al abrir la OT, antes de ejecutar.
//
// No confundir con:
//   · StockMovement ISSUE → lo que se consumió realmente (se registra al cerrar).
//   · SpareRequest        → el pedido a compras (módulo aparte).

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { assertNotLocked } from "../../common/record-lock";
import { requireWorkOrderScope } from "./work-orders-service";

export type WorkOrderItemKind = "SPARE" | "MATERIAL";

export interface WorkOrderItemInput {
  kind?: WorkOrderItemKind;
  spareId?: string | null;
  description?: string;
  quantity?: number;
  unit?: string;
  sortOrder?: number;
}

function canManage(session: TenantAccessSession): boolean {
  return session.user.role !== "AUDITOR_READONLY";
}

function ensureCanManage(session: TenantAccessSession) {
  if (!canManage(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para editar los ítems de la orden de trabajo.");
  }
}

/**
 * Resuelve la OT aplicando tenant + vessel scope (404 si no es visible).
 * Chequeo LIVIANO: estos handlers sólo necesitan id/vesselCode/status, nunca el
 * detalle completo. Antes reusaban getTenantWorkOrder "por comodidad", lo que
 * hacía que abrir el modal pagara el costo del detalle 3 veces.
 */
async function requireWorkOrder(session: TenantAccessSession, workOrderId: string) {
  return requireWorkOrderScope(session, workOrderId);
}

export async function listWorkOrderItems(session: TenantAccessSession, workOrderId: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  await requireWorkOrder(session, workOrderId);
  return (prisma as any).workOrderItem.findMany({
    where: { workOrderId },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function createWorkOrderItem(session: TenantAccessSession, workOrderId: string, payload: WorkOrderItemInput) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const wo = await requireWorkOrder(session, workOrderId);
  assertNotLocked("WORK_ORDER", (wo as any).status);

  const description = String(payload.description ?? "").trim();
  if (!description) throw new RouteError(400, "VALIDATION_ERROR", "La descripción del ítem es requerida.");
  const kind = payload.kind === "MATERIAL" ? "MATERIAL" : "SPARE";

  return (prisma as any).workOrderItem.create({
    data: {
      workOrderId,
      kind,
      spareId: payload.spareId?.trim() || null,
      description,
      quantity: Number.isFinite(payload.quantity) ? Number(payload.quantity) : 1,
      unit: String(payload.unit ?? "ud").trim() || "ud",
      sortOrder: Number.isFinite(payload.sortOrder) ? Number(payload.sortOrder) : 0,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
}

export async function updateWorkOrderItem(
  session: TenantAccessSession,
  workOrderId: string,
  itemId: string,
  payload: WorkOrderItemInput,
) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const wo = await requireWorkOrder(session, workOrderId);
  assertNotLocked("WORK_ORDER", (wo as any).status);

  const current = await (prisma as any).workOrderItem.findFirst({ where: { id: itemId, workOrderId } });
  if (!current) throw new RouteError(404, "NOT_FOUND", "Ítem no encontrado.");

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.kind !== undefined) data.kind = payload.kind === "MATERIAL" ? "MATERIAL" : "SPARE";
  if (payload.spareId !== undefined) data.spareId = payload.spareId?.trim() || null;
  if (payload.description !== undefined) {
    const d = String(payload.description).trim();
    if (!d) throw new RouteError(400, "VALIDATION_ERROR", "La descripción del ítem es requerida.");
    data.description = d;
  }
  if (payload.quantity !== undefined) {
    const q = Number(payload.quantity);
    if (!Number.isFinite(q)) throw new RouteError(400, "VALIDATION_ERROR", "La cantidad debe ser un número válido.");
    data.quantity = q;
  }
  if (payload.unit !== undefined) data.unit = String(payload.unit).trim() || "ud";
  if (payload.sortOrder !== undefined) {
    const s = Number(payload.sortOrder);
    if (!Number.isFinite(s)) throw new RouteError(400, "VALIDATION_ERROR", "El orden debe ser un número válido.");
    data.sortOrder = s;
  }

  return (prisma as any).workOrderItem.update({ where: { id: itemId }, data });
}

export async function deleteWorkOrderItem(session: TenantAccessSession, workOrderId: string, itemId: string) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const wo = await requireWorkOrder(session, workOrderId);
  assertNotLocked("WORK_ORDER", (wo as any).status);

  const current = await (prisma as any).workOrderItem.findFirst({ where: { id: itemId, workOrderId } });
  if (!current) throw new RouteError(404, "NOT_FOUND", "Ítem no encontrado.");
  // Hard delete: es una lista de planificación, no un registro auditable.
  await (prisma as any).workOrderItem.delete({ where: { id: itemId } });
  return { ok: true };
}
