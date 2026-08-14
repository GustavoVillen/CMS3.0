// Respaldos del permiso de trabajo (PTW).
//
// El permiso se emite acá, se imprime, se firma en papel a bordo y se escanea.
// Ese scan es la evidencia que pide una auditoría TMSA/SIRE, así que tiene que
// quedar colgada del permiso. Reusamos el modelo Attachment genérico
// (targetType = WORK_PERMIT) en vez de campos nuevos en PermitToWork.
//
// A diferencia de la edición del permiso, subir respaldo NO está limitado a
// DRAFT/REQUESTED: el papel firmado vuelve después de aprobar, activar o cerrar.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { saveAttachment, mimeTypeForFilename } from "../attachments/attachment-uploads-service";
import { getPermit } from "./permits-service";

/** Subdirectorio de uploads y valor del enum AttachmentTarget. */
const ENTITY_TYPE = "WorkPermit";
const TARGET_TYPE = "WORK_PERMIT";

type PermitRow = { id: string; tenantId: string; vesselCode: string; permitCode: string };

export interface PermitAttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Path del archivo. Se sirve autenticado vía /app/files/... (ver files-router). */
  url: string;
  uploadedAt: string;
  uploadedByUserId: string;
  uploadedByName: string | null;
}

function ensureCanManage(session: TenantAccessSession) {
  if (!hasPermission(session, "permit.manage")) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar permisos.");
  }
}

/**
 * Resuelve nombres de los usuarios que subieron, para no mostrar ids crudos.
 * Una sola query para todo el listado.
 */
async function resolveUploaderNames(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  userIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, firstName: true, lastName: true, formName: true, email: true },
  });
  return new Map(users.map(u => [
    u.id,
    u.formName?.trim() || [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email,
  ]));
}

/** Lista los respaldos del permiso. getPermit valida tenant + scope de buque. */
export async function listPermitAttachments(
  session: TenantAccessSession,
  permitId: string,
): Promise<PermitAttachmentDto[]> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const permit = await getPermit(session, permitId) as unknown as PermitRow;

  const rows = await prisma.attachment.findMany({
    where: {
      tenantId:   permit.tenantId,
      targetType: TARGET_TYPE as never,
      targetId:   permit.id,
      deletedAt:  null,
    },
    orderBy: { uploadedAt: "desc" },
  });

  const names = await resolveUploaderNames(prisma, rows.map(r => r.uploadedByUserId));

  return rows.map(r => ({
    id:               r.id,
    filename:         r.filename,
    mimeType:         r.mimeType,
    sizeBytes:        r.sizeBytes,
    // La URL del archivo se guarda en description — misma convención que usa
    // registerAttachmentRecord para el resto de los módulos.
    url:              r.description ?? "",
    uploadedAt:       r.uploadedAt.toISOString(),
    uploadedByUserId: r.uploadedByUserId,
    uploadedByName:   names.get(r.uploadedByUserId) ?? null,
  }));
}

export async function uploadPermitAttachment(
  session: TenantAccessSession,
  permitId: string,
  originalName: string,
  buffer: Buffer,
): Promise<PermitAttachmentDto> {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const permit = await getPermit(session, permitId) as unknown as PermitRow;

  // saveAttachment valida la extensión contra la lista de tipos permitidos.
  let saved: { url: string; name: string };
  try {
    saved = await saveAttachment(session.tenantSlug, ENTITY_TYPE, originalName, buffer);
  } catch (err) {
    throw new RouteError(400, "INVALID_FILE_TYPE", err instanceof Error ? err.message : "Tipo de archivo no permitido.");
  }

  const now = new Date();
  const created = await prisma.attachment.create({
    data: {
      tenantId:         permit.tenantId,
      vesselCode:       permit.vesselCode,
      targetType:       TARGET_TYPE as never,
      targetId:         permit.id,
      filename:         saved.name,
      mimeType:         mimeTypeForFilename(saved.name),
      sizeBytes:        buffer.length,
      status:           "ACTIVE",
      uploadedAt:       now,
      uploadedByUserId: session.user.id,
      description:      saved.url,
      createdByUserId:  session.user.id,
      updatedByUserId:  session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId:    permit.tenantId,
    actorUserId: session.user.id,
    action:      "Permit.attachmentAdded",
    entityType:  "Permit",
    entityId:    permit.id,
    metadata:    { permitCode: permit.permitCode, vesselCode: permit.vesselCode, filename: saved.name, attachmentId: created.id },
  });

  const names = await resolveUploaderNames(prisma, [session.user.id]);
  return {
    id:               created.id,
    filename:         created.filename,
    mimeType:         created.mimeType,
    sizeBytes:        created.sizeBytes,
    url:              saved.url,
    uploadedAt:       created.uploadedAt.toISOString(),
    uploadedByUserId: created.uploadedByUserId,
    uploadedByName:   names.get(session.user.id) ?? null,
  };
}

/** Borrado lógico: la evidencia queda en la tabla con deletedAt, no se pierde el rastro. */
export async function deletePermitAttachment(
  session: TenantAccessSession,
  permitId: string,
  attachmentId: string,
): Promise<void> {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const permit = await getPermit(session, permitId) as unknown as PermitRow;

  const existing = await prisma.attachment.findFirst({
    where: {
      id:         attachmentId,
      tenantId:   permit.tenantId,
      targetType: TARGET_TYPE as never,
      targetId:   permit.id,
      deletedAt:  null,
    },
  });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Respaldo no encontrado.");

  await prisma.attachment.update({
    where: { id: attachmentId },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });

  void publishAudit(prisma, {
    tenantId:    permit.tenantId,
    actorUserId: session.user.id,
    action:      "Permit.attachmentDeleted",
    entityType:  "Permit",
    entityId:    permit.id,
    metadata:    { permitCode: permit.permitCode, vesselCode: permit.vesselCode, filename: existing.filename, attachmentId },
  });
}
