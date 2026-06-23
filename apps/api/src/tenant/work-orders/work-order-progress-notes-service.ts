// Servicio para WorkOrderProgressNote — notas de avance que el técnico carga
// durante la ejecución de una OT desde el mobile. Cada nota puede ser TEXT,
// PHOTO, VIDEO o AUDIO. El pipeline AI (iteración posterior) las procesa para
// transcribir/OCR y reescribir en formato técnico hacia wo.observations.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { saveAttachment } from "../attachments/attachment-uploads-service";
import { processNoteAndRegenerate, regenerateObservationsForWorkOrder } from "./work-order-progress-ai";
import { log } from "../../common/logger";
import { assertNotLocked } from "../../common/record-lock";

export interface CreateProgressNoteInput {
  kind: "TEXT" | "PHOTO" | "VIDEO" | "AUDIO";
  text?: string | null;
  // Fecha/hora del avance (editable desde el cliente). Si no viene o es inválida,
  // se usa el momento actual. Es la fecha que se muestra y por la que se ordena.
  occurredAt?: string | Date | null;
  // Para PHOTO/VIDEO/AUDIO: contenido del archivo
  fileBuffer?: Buffer;
  fileName?: string;
  mimeType?: string;
}

export interface ProgressNoteRow {
  id: string;
  workOrderId: string;
  kind: string;
  text: string | null;
  fileUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  processedText: string | null;
  processed: boolean;
  processError: string | null;
  createdAt: Date;
  createdByUserId: string;
}

async function getWorkOrderOrThrow(
  session: TenantAccessSession,
  workOrderId: string,
): Promise<{ id: string; tenantId: string; vesselCode: string; status: string }> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await (prismaRaw as any).tenant.findUnique({
    where: { slug: session.tenantSlug },
    select: { id: true },
  });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const wo = await (prismaRaw as any).workOrder.findFirst({
    where: { id: workOrderId, tenantId: tenant.id, deletedAt: null },
    select: { id: true, tenantId: true, vesselCode: true, status: true },
  });
  if (!wo) throw new RouteError(404, "WORK_ORDER_NOT_FOUND", "Orden de trabajo no encontrada.");

  // Scope por vessel para no-admin
  if (session.user.role !== "TENANT_ADMIN") {
    if (!session.user.assignedVesselCodes.includes(wo.vesselCode)) {
      throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel de esta OT.");
    }
  }

  return wo;
}

export async function createProgressNote(
  session: TenantAccessSession,
  workOrderId: string,
  input: CreateProgressNoteInput,
): Promise<ProgressNoteRow> {
  const wo = await getWorkOrderOrThrow(session, workOrderId);
  // Lockdown vetting: no se pueden agregar notas a una OT cerrada/cancelada.
  assertNotLocked("WORK_ORDER", wo.status);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  if (input.kind === "TEXT") {
    if (!input.text || !input.text.trim()) {
      throw new RouteError(400, "VALIDATION_ERROR", "El texto de la nota es requerido.");
    }
  } else {
    if (!input.fileBuffer || input.fileBuffer.length === 0) {
      throw new RouteError(400, "VALIDATION_ERROR", "El archivo es requerido para este tipo de nota.");
    }
  }

  let fileUrl: string | null = null;
  let mimeType: string | null = null;
  let sizeBytes: number | null = null;

  if (input.fileBuffer && input.fileName) {
    try {
      const saved = await saveAttachment(
        session.tenantSlug,
        "WorkOrderProgress",
        input.fileName,
        input.fileBuffer,
      );
      fileUrl = saved.url;
      mimeType = input.mimeType ?? null;
      sizeBytes = input.fileBuffer.length;
    } catch (err) {
      throw new RouteError(
        400,
        "UPLOAD_FAILED",
        err instanceof Error ? err.message : "No se pudo guardar el archivo.",
      );
    }
  }

  // Política inicial de processedText/processed:
  // - TEXT  : el texto crudo ya es definitivo (no requiere pipeline AI)
  // - AUDIO : el cliente envía la transcripción client-side (Web Speech API)
  //           como input.text → se toma como processedText
  // - VIDEO : si vino caption, se usa; no procesamos el video todavía
  // - PHOTO : queda processed=false; el pipeline AI corre OCR
  let processedText: string | null = null;
  let processed = false;
  if (input.kind === "TEXT" || input.kind === "AUDIO" || input.kind === "VIDEO") {
    const t = (input.text ?? "").trim();
    processedText = t || null;
    processed = true;
  }

  // Fecha del avance: el cliente puede editarla. Si es válida, sobrescribe el
  // createdAt (que es la fecha mostrada/ordenada); si no, default = now().
  let occurredAt: Date | undefined;
  if (input.occurredAt) {
    const d = new Date(input.occurredAt);
    if (!isNaN(d.getTime())) occurredAt = d;
  }

  const created = await (prismaRaw as any).workOrderProgressNote.create({
    data: {
      tenantId: wo.tenantId,
      vesselCode: wo.vesselCode,
      workOrderId: wo.id,
      kind: input.kind,
      text: input.text?.trim() || null,
      fileUrl,
      mimeType,
      sizeBytes,
      processedText,
      processed,
      createdByUserId: session.user.id,
      ...(occurredAt ? { createdAt: occurredAt } : {}),
    },
  });

  // Fire-and-forget: pipeline AI procesa la nota (OCR si es foto) y regenera
  // observations consolidando todas las notas de la OT. No bloquea la respuesta.
  // Para AUDIO/VIDEO sin transcripción client-side (text vacío), se salta el OCR
  // pero igual regenera observations con las otras notas procesadas.
  void processNoteAndRegenerate(created.id, {
    tenantSlug: session.tenantSlug,
    userId: session.user.id,
    userEmail: session.user.email,
  }).catch((err) => log.error("[progress-notes] AI pipeline failed:", err));

  return created as ProgressNoteRow;
}

export async function listProgressNotes(
  session: TenantAccessSession,
  workOrderId: string,
): Promise<ProgressNoteRow[]> {
  const wo = await getWorkOrderOrThrow(session, workOrderId);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const rows = await (prismaRaw as any).workOrderProgressNote.findMany({
    where: { workOrderId: wo.id, tenantId: wo.tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return rows as ProgressNoteRow[];
}

export async function updateProgressNote(
  session: TenantAccessSession,
  workOrderId: string,
  noteId: string,
  input: { text: string | null },
): Promise<ProgressNoteRow> {
  const wo = await getWorkOrderOrThrow(session, workOrderId);
  // Lockdown vetting: no se puede editar notas de una OT cerrada/cancelada.
  assertNotLocked("WORK_ORDER", wo.status);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const note = await (prismaRaw as any).workOrderProgressNote.findFirst({
    where: { id: noteId, workOrderId: wo.id, tenantId: wo.tenantId, deletedAt: null },
  });
  if (!note) throw new RouteError(404, "NOT_FOUND", "Nota de avance no encontrada.");

  const text = (input.text ?? "").trim();
  if (note.kind === "TEXT" && !text) {
    throw new RouteError(400, "VALIDATION_ERROR", "El texto de la nota es requerido.");
  }

  const data: Record<string, unknown> = { text: text || null };
  // Para notas con texto definitivo (no foto con OCR) mantenemos processedText en sync.
  if (note.kind === "TEXT" || note.kind === "AUDIO" || note.kind === "VIDEO") {
    data.processedText = text || null;
  }

  const updated = await (prismaRaw as any).workOrderProgressNote.update({
    where: { id: noteId },
    data,
  });

  // Re-generar observations con el texto editado (fire-and-forget).
  void regenerateObservationsForWorkOrder(wo.id, {
    tenantSlug: session.tenantSlug,
    userId: session.user.id,
    userEmail: session.user.email,
  }).catch((err) => log.error("[progress-notes] regenerate after edit failed:", err));

  return updated as ProgressNoteRow;
}

export async function deleteProgressNote(
  session: TenantAccessSession,
  workOrderId: string,
  noteId: string,
): Promise<void> {
  const wo = await getWorkOrderOrThrow(session, workOrderId);
  // Lockdown vetting: tampoco se pueden borrar notas de una OT cerrada.
  assertNotLocked("WORK_ORDER", wo.status);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const note = await (prismaRaw as any).workOrderProgressNote.findFirst({
    where: { id: noteId, workOrderId: wo.id, tenantId: wo.tenantId, deletedAt: null },
  });
  if (!note) throw new RouteError(404, "NOT_FOUND", "Nota de avance no encontrada.");

  await (prismaRaw as any).workOrderProgressNote.update({
    where: { id: noteId },
    data: {
      deletedAt: new Date(),
      deletedByUserId: session.user.id,
    },
  });

  // Re-generar observations sin la nota borrada (fire-and-forget)
  void regenerateObservationsForWorkOrder(wo.id, {
    tenantSlug: session.tenantSlug,
    userId: session.user.id,
    userEmail: session.user.email,
  }).catch((err) => log.error("[progress-notes] regenerate after delete failed:", err));
}
