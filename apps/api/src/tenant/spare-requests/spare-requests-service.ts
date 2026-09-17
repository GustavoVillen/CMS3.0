import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { archivePdf } from "../settings/pdf-archive-service";
import { hasPermission } from "../auth/role-permissions";
import { NO_ASSIGNED_VESSEL_SENTINEL } from "../auth/vessel-scope";
// Vessel scope de solicitudes (nullable = general del tenant). Vive en
// spare-request-scope para que ítems y reservas apliquen EXACTAMENTE la misma
// regla; antes sólo estaba acá y los otros dos servicios no la miraban.
import { assertVesselAccess } from "./spare-request-scope";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { isMailConfigured, sendMail } from "../../common/mailer";
import { readSpareRequestMailbox } from "../settings/spare-request-config-service";

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

  const rows = await prisma.spareRequest.findMany({
    where,
    orderBy: { requestedAt: "desc" },
    include: { items: { select: { id: true, status: true, quantity: true, quantityFulfilled: true } } },
  });
  const names = await loadUserNames(prisma, rows.map(r => r.requestedByUserId));
  const sent = await loadSendEvents(prisma, tenantId, rows.map(r => r.id));
  return rows.map(r => ({
    ...r,
    requestedByName: names.get(r.requestedByUserId) ?? null,
    sentAt: sent.get(r.id)?.at ?? null,
  }));
}

// ─── Envío a Compras ───────────────────────────────────────────────────────────
// La solicitud es el formulario del buque a Compras: se manda por correo con el
// PDF y ahí termina. Lo que llega entra por Recepción con remito.

const SEND_ACTIONS = ["SpareRequest.submitted", "SpareRequest.resent"];

async function loadUserNames(prisma: any, ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true, email: true } });
  for (const u of users) map.set(u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email);
  return map;
}

/** Último envío de cada solicitud (fecha, casilla, quién), leído de la auditoría. */
async function loadSendEvents(prisma: any, tenantId: string, ids: string[]) {
  const map = new Map<string, { at: string; to: string | null; byUserId: string | null }>();
  if (ids.length === 0) return map;
  const events = await prisma.auditEvent.findMany({
    where: { tenantId, entityType: "SpareRequest", entityId: { in: ids }, action: { in: SEND_ACTIONS } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, createdAt: true, actorUserId: true, metadata: true },
  });
  for (const e of events) {
    if (!e.entityId || map.has(e.entityId)) continue;
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    map.set(e.entityId, {
      at: new Date(e.createdAt).toISOString(),
      to: typeof meta.to === "string" ? meta.to : null,
      byUserId: e.actorUserId ?? null,
    });
  }
  return map;
}

export interface SendToPurchasingResult {
  /** Salió el correo. Si es false la solicitud NO cambió de estado. */
  sent: boolean;
  to: string | null;
  reason?: "NO_MAILBOX" | "NOT_CONFIGURED" | "SEND_FAILED";
  error?: string;
}

const PRIORITY_ES: Record<string, string> = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica" };

async function mailToPurchasing(
  session: TenantAccessSession,
  req: { id: string; tenantId: string; requestCode: string; priority: string; notes: string | null; requestedForVesselCode: string | null },
  kind: "SEND" | "CANCEL",
  cancelReason?: string,
): Promise<SendToPurchasingResult> {
  const prisma = getPrismaClient()! as any;
  const to = await readSpareRequestMailbox(req.tenantId);
  if (!to) return { sent: false, to: null, reason: "NO_MAILBOX" };
  if (!isMailConfigured()) return { sent: false, to, reason: "NOT_CONFIGURED" };

  // Nombre del buque, nunca el código.
  const vessel = req.requestedForVesselCode
    ? await prisma.vessel.findFirst({ where: { tenantId: req.tenantId, code: req.requestedForVesselCode }, select: { name: true } })
    : null;
  const vesselName: string = vessel?.name ?? req.requestedForVesselCode ?? "—";
  const priority = PRIORITY_ES[req.priority] ?? req.priority;

  if (kind === "CANCEL") {
    const r = await sendMail({
      to,
      subject: `ANULADA — Solicitud de repuestos ${req.requestCode} — ${vesselName}`,
      text: [
        "Estimados,",
        "",
        `El buque ${vesselName} anula la Solicitud de repuestos ${req.requestCode}.`,
        cancelReason ? `Motivo: ${cancelReason}` : null,
        "",
        "Saludos.",
      ].filter((l): l is string => l !== null).join("\n"),
    });
    return { sent: r.sent, to, reason: r.reason, error: r.error };
  }

  const items = await prisma.spareRequestItem.findMany({
    where: { spareRequestId: req.id }, orderBy: { createdAt: "asc" },
    select: { description: true, quantity: true, unit: true },
  });
  const { buildSpareRequestPdf } = await import("../pms/spare-request-pdf-service");
  const buffer = await buildSpareRequestPdf(session, req.id, { forSending: true });
  const result = await sendMail({
    to,
    subject: `Solicitud de repuestos ${req.requestCode} — ${vesselName} — Prioridad ${priority}`,
    text: [
      "Estimados,",
      "",
      `Adjunto la Solicitud de repuestos ${req.requestCode} del buque ${vesselName} (prioridad ${priority}).`,
      "",
      ...items.map((i: { description: string; quantity: number; unit: string }) => `  · ${i.quantity} ${i.unit} — ${i.description}`),
      req.notes ? "" : null,
      req.notes ? `Motivo: ${req.notes}` : null,
      "",
      "Saludos.",
    ].filter((l): l is string => l !== null).join("\n"),
    attachments: [{ filename: `${req.requestCode}.pdf`, content: buffer, contentType: "application/pdf" }],
  });
  if (result.sent) void archivePdf(session, { kind: "REQ", id: req.id, buffer });
  return { sent: result.sent, to, reason: result.reason, error: result.error };
}

export async function getSpareRequest(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient()!;
  const req = await getRequestOrThrow(session, id);
  const row = await prisma.spareRequest.findFirst({
    where: { id: req.id },
    include: { items: true },
  });
  if (!row) return row;
  const sent = (await loadSendEvents(prisma, req.tenantId, [row.id])).get(row.id) ?? null;
  const names = await loadUserNames(prisma, [row.requestedByUserId, sent?.byUserId]);
  return {
    ...row,
    requestedByName: names.get(row.requestedByUserId) ?? null,
    sentAt: sent?.at ?? null,
    sentTo: sent?.to ?? null,
    sentByName: sent?.byUserId ? names.get(sent.byUserId) ?? null : null,
  };
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

/**
 * "Enviar a Compras": manda el formulario PDF a la casilla de Compras y recién
 * con el correo afuera pasa a SUBMITTED. Fail-closed: si no hay casilla, no hay
 * SMTP o el envío falla, la solicitud sigue en Borrador y se devuelve el motivo.
 */
export async function submitSpareRequest(session: TenantAccessSession, id: string): Promise<SendToPurchasingResult> {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado.");
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "DRAFT") throw new RouteError(409, "INVALID_STATUS", "Solo se puede enviar una solicitud en Borrador.");
  if (!current.requestedForVesselCode) throw new RouteError(400, "VESSEL_REQUIRED", "Elegí el buque antes de enviar la solicitud.");
  const prisma = getPrismaClient()!;
  const itemCount = await prisma.spareRequestItem.count({ where: { spareRequestId: id } });
  if (itemCount === 0) throw new RouteError(400, "NO_ITEMS", "La solicitud debe tener al menos un ítem.");

  const result = await mailToPurchasing(session, current, "SEND");
  if (!result.sent) return result;

  await prisma.spareRequest.update({
    where: { id: current.id },
    data: { status: "SUBMITTED", updatedByUserId: session.user.id },
  });
  await publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id, action: "SpareRequest.submitted",
    entityType: "SpareRequest", entityId: current.id,
    metadata: { requestCode: current.requestCode, vesselCode: current.requestedForVesselCode, to: result.to, detail: `Solicitud ${current.requestCode} enviada a Compras (${result.to}).` },
  });
  return result;
}

/** Vuelve a mandar el correo de una solicitud ya enviada (no cambia el estado). */
export async function resendSpareRequest(session: TenantAccessSession, id: string): Promise<SendToPurchasingResult> {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado.");
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "SUBMITTED") throw new RouteError(409, "INVALID_STATUS", "Solo se puede reenviar una solicitud ya enviada a Compras.");
  const result = await mailToPurchasing(session, current, "SEND");
  if (result.sent) {
    await publishAudit(getPrismaClient()!, {
      tenantId: current.tenantId, actorUserId: session.user.id, action: "SpareRequest.resent",
      entityType: "SpareRequest", entityId: current.id,
      metadata: { requestCode: current.requestCode, vesselCode: current.requestedForVesselCode ?? undefined, to: result.to, detail: `Solicitud ${current.requestCode} reenviada a Compras (${result.to}).` },
    });
  }
  return result;
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
  void archivePdf(session, { kind: "REQ", id: current.id });
  return updated;
}

/**
 * Anula una solicitud. El motivo es obligatorio y se guarda en `rejectionReason`
 * (con estado CANCELLED es el motivo de anulación). Si ya había salido a Compras
 * se les avisa por correo; ese aviso no frena la anulación.
 */
export async function cancelSpareRequest(session: TenantAccessSession, id: string, reason = "") {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado.");
  const current = await getRequestOrThrow(session, id);
  if (["FULFILLED", "CANCELLED"].includes(current.status)) {
    throw new RouteError(409, "INVALID_STATUS", "No se puede cancelar una solicitud en este estado.");
  }
  const cleanReason = String(reason ?? "").trim();
  if (!cleanReason) throw new RouteError(400, "REASON_REQUIRED", "Escribí el motivo de la anulación.");
  const prisma = getPrismaClient()!;

  // Release any active reservations
  await prisma.stockReservation.updateMany({
    where: { requestItem: { spareRequestId: id }, status: "ACTIVE" },
    data: { status: "RELEASED", releasedAt: new Date(), updatedByUserId: session.user.id },
  });

  const updated = await prisma.spareRequest.update({
    where: { id: current.id },
    data: { status: "CANCELLED", rejectionReason: cleanReason, updatedByUserId: session.user.id },
    include: { items: true },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id, action: "SpareRequest.cancelled",
    entityType: "SpareRequest", entityId: current.id, metadata: { requestCode: current.requestCode, vesselCode: current.requestedForVesselCode ?? undefined, reason: cleanReason, detail: `Solicitud ${current.requestCode} anulada: ${cleanReason}.` },
  });
  void archivePdf(session, { kind: "REQ", id: current.id });
  const notice = current.status === "SUBMITTED"
    ? await mailToPurchasing(session, current, "CANCEL", cleanReason)
    : null;
  return { ...updated, purchasingNotified: notice?.sent ?? false };
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
