import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { NO_ASSIGNED_VESSEL_SENTINEL } from "../auth/vessel-scope";
import { publishAudit } from "../../platform/audit/audit-publisher";

export interface SpareRequestListFilters {
  status?: string | null;
  priority?: string | null;
  vesselCode?: string | null;
}

export interface CreateSpareRequestInput {
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  notes?: string | null;
  requestedForVesselCode?: string | null;
  requestedForAssetId?: string | null;
  requestedForLocationId?: string | null;
}

export interface UpdateSpareRequestInput {
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  notes?: string | null;
  requestedForVesselCode?: string | null;
  requestedForAssetId?: string | null;
  requestedForLocationId?: string | null;
}

function canManage(session: TenantAccessSession): boolean {
  return hasPermission(session, "spareRequest.manage");
}

function canApprove(session: TenantAccessSession): boolean {
  return hasPermission(session, "spareRequest.approve");
}

// Vessel scope adaptado a requestedForVesselCode (nullable): las solicitudes
// generales (sin buque) las ve todo el tenant; las de un buque, solo quien lo
// tiene asignado. TENANT_ADMIN ve todo.
function assertVesselAccess(session: TenantAccessSession, vesselCode: string | null): void {
  if (session.user.role === "TENANT_ADMIN") return;
  if (!vesselCode) return;
  const assigned = session.user.assignedVesselCodes ?? [];
  if (!assigned.includes(vesselCode)) {
    throw new RouteError(404, "NOT_FOUND", "Solicitud no encontrada.");
  }
}

async function resolveTenantId(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

async function getRequestOrThrow(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient()!;
  const tenantId = await resolveTenantId(session);
  const req = await prisma.spareRequest.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!req) throw new RouteError(404, "NOT_FOUND", "Solicitud no encontrada.");
  assertVesselAccess(session, req.requestedForVesselCode);
  return req;
}

export async function listSpareRequests(session: TenantAccessSession, filters: SpareRequestListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await resolveTenantId(session);
  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  if (filters.status === "PENDING") {
    where.status = { in: ["SUBMITTED", "APPROVED", "PARTIALLY_FULFILLED"] };
  } else if (filters.status) {
    where.status = filters.status;
  }
  if (filters.priority)   where.priority = filters.priority;

  // Vessel scope: mismo criterio fail-closed que vessel-scope.ts, adaptado al
  // campo nullable requestedForVesselCode (null = solicitud general del tenant).
  if (session.user.role === "TENANT_ADMIN") {
    if (filters.vesselCode) where.requestedForVesselCode = filters.vesselCode;
  } else {
    const assigned = session.user.assignedVesselCodes ?? [];
    if (filters.vesselCode) {
      where.requestedForVesselCode = assigned.includes(filters.vesselCode)
        ? filters.vesselCode
        : NO_ASSIGNED_VESSEL_SENTINEL;
    } else {
      where.OR = [
        { requestedForVesselCode: { in: assigned } },
        { requestedForVesselCode: null },
      ];
    }
  }

  return prisma.spareRequest.findMany({
    where,
    orderBy: { requestedAt: "desc" },
    include: { items: { select: { id: true, status: true, quantity: true, quantityFulfilled: true } } },
  });
}

export async function getSpareRequest(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient()!;
  const req = await getRequestOrThrow(session, id);
  return prisma.spareRequest.findFirst({
    where: { id: req.id },
    include: { items: true },
  });
}

export async function createSpareRequest(session: TenantAccessSession, payload: CreateSpareRequestInput) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para crear solicitudes.");
  const prisma = getPrismaClient()!;
  const tenantId = await resolveTenantId(session);

  const requestedVessel = payload.requestedForVesselCode?.trim().toUpperCase() || null;
  assertVesselAccess(session, requestedVessel);

  const vesselCode = requestedVessel ?? "GEN";
  const yy = String(new Date().getFullYear()).slice(-2);
  const count = await prisma.spareRequest.count({ where: { tenantId, requestCode: { startsWith: `REQ-${vesselCode}-${yy}-` } } });
  const requestCode = `REQ-${vesselCode}-${yy}-${String(count + 1).padStart(4, "0")}`;

  const created = await prisma.spareRequest.create({
    data: {
      tenantId,
      requestCode,
      status: "DRAFT",
      priority: payload.priority ?? "MEDIUM",
      requestedByUserId: session.user.id,
      requestedAt: new Date(),
      notes: payload.notes ? String(payload.notes).trim() || null : null,
      requestedForVesselCode: requestedVessel,
      requestedForAssetId: payload.requestedForAssetId ?? null,
      requestedForLocationId: payload.requestedForLocationId ?? null,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
    include: { items: true },
  });

  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id, action: "SpareRequest.created",
    entityType: "SpareRequest", entityId: created.id,
    metadata: { requestCode: created.requestCode, vesselCode: created.requestedForVesselCode ?? undefined, detail: `Solicitud ${created.requestCode} creada. Prioridad: ${created.priority}.` },
  });
  return created;
}

export async function updateSpareRequest(session: TenantAccessSession, id: string, payload: UpdateSpareRequestInput) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para editar solicitudes.");
  const current = await getRequestOrThrow(session, id);
  if (!["DRAFT"].includes(current.status)) {
    throw new RouteError(409, "INVALID_STATUS", "Solo se puede editar una solicitud en estado DRAFT.");
  }
  const prisma = getPrismaClient()!;
  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.priority !== undefined) data.priority = payload.priority;
  if (payload.notes !== undefined) data.notes = payload.notes ? String(payload.notes).trim() || null : null;
  if (payload.requestedForVesselCode !== undefined) {
    const nextVessel = payload.requestedForVesselCode?.trim().toUpperCase() || null;
    assertVesselAccess(session, nextVessel);
    data.requestedForVesselCode = nextVessel;
  }
  if (payload.requestedForAssetId !== undefined) data.requestedForAssetId = payload.requestedForAssetId ?? null;
  if (payload.requestedForLocationId !== undefined) data.requestedForLocationId = payload.requestedForLocationId ?? null;

  return prisma.spareRequest.update({ where: { id: current.id }, data, include: { items: true } });
}

export async function submitSpareRequest(session: TenantAccessSession, id: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado.");
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "DRAFT") throw new RouteError(409, "INVALID_STATUS", "Solo se puede enviar una solicitud en estado DRAFT.");
  const prisma = getPrismaClient()!;
  const itemCount = await prisma.spareRequestItem.count({ where: { spareRequestId: id } });
  if (itemCount === 0) throw new RouteError(400, "NO_ITEMS", "La solicitud debe tener al menos un ítem.");

  const updated = await prisma.spareRequest.update({
    where: { id: current.id },
    data: { status: "SUBMITTED", updatedByUserId: session.user.id },
    include: { items: true },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id, action: "SpareRequest.submitted",
    entityType: "SpareRequest", entityId: current.id, metadata: { requestCode: current.requestCode, vesselCode: current.requestedForVesselCode ?? undefined, detail: `Solicitud ${current.requestCode} enviada para aprobación.` },
  });
  return updated;
}

export async function approveSpareRequest(session: TenantAccessSession, id: string) {
  if (!canApprove(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para aprobar solicitudes.");
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "SUBMITTED") throw new RouteError(409, "INVALID_STATUS", "Solo se puede aprobar una solicitud en estado SUBMITTED.");
  const prisma = getPrismaClient()!;

  const updated = await prisma.spareRequest.update({
    where: { id: current.id },
    data: { status: "APPROVED", approvedByUserId: session.user.id, approvedAt: new Date(), updatedByUserId: session.user.id },
    include: { items: true },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id, action: "SpareRequest.approved",
    entityType: "SpareRequest", entityId: current.id, metadata: { requestCode: current.requestCode, vesselCode: current.requestedForVesselCode ?? undefined, detail: `Solicitud ${current.requestCode} aprobada.` },
  });
  return updated;
}

export async function rejectSpareRequest(session: TenantAccessSession, id: string, reason: string) {
  if (!canApprove(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para rechazar solicitudes.");
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "SUBMITTED") throw new RouteError(409, "INVALID_STATUS", "Solo se puede rechazar una solicitud en estado SUBMITTED.");
  const prisma = getPrismaClient()!;

  const updated = await prisma.spareRequest.update({
    where: { id: current.id },
    data: {
      status: "REJECTED",
      rejectionReason: String(reason ?? "").trim() || null,
      updatedByUserId: session.user.id,
    },
    include: { items: true },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id, action: "SpareRequest.rejected",
    entityType: "SpareRequest", entityId: current.id, metadata: { requestCode: current.requestCode, vesselCode: current.requestedForVesselCode ?? undefined, reason, detail: `Solicitud ${current.requestCode} rechazada${reason ? `: ${reason}` : ""}.` },
  });
  return updated;
}

export async function cancelSpareRequest(session: TenantAccessSession, id: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado.");
  const current = await getRequestOrThrow(session, id);
  if (["FULFILLED", "CANCELLED"].includes(current.status)) {
    throw new RouteError(409, "INVALID_STATUS", "No se puede cancelar una solicitud en este estado.");
  }
  const prisma = getPrismaClient()!;

  // Release any active reservations
  await prisma.stockReservation.updateMany({
    where: { requestItem: { spareRequestId: id }, status: "ACTIVE" },
    data: { status: "RELEASED", releasedAt: new Date(), updatedByUserId: session.user.id },
  });

  const updated = await prisma.spareRequest.update({
    where: { id: current.id },
    data: { status: "CANCELLED", updatedByUserId: session.user.id },
    include: { items: true },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id, action: "SpareRequest.cancelled",
    entityType: "SpareRequest", entityId: current.id, metadata: { requestCode: current.requestCode, vesselCode: current.requestedForVesselCode ?? undefined, detail: `Solicitud ${current.requestCode} cancelada.` },
  });
  return updated;
}

export async function deleteSpareRequest(session: TenantAccessSession, id: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado.");
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "DRAFT") throw new RouteError(409, "INVALID_STATUS", "Solo se puede eliminar una solicitud en estado DRAFT.");
  const prisma = getPrismaClient()!;

  await prisma.spareRequest.update({
    where: { id: current.id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id, action: "SpareRequest.deleted",
    entityType: "SpareRequest", entityId: current.id, metadata: { requestCode: current.requestCode, vesselCode: current.requestedForVesselCode ?? undefined, detail: `Solicitud ${current.requestCode} eliminada.` },
  });
}
