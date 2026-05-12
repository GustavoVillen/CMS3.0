// Servicio para WorkOrderProgressNote — notas de avance que el técnico carga
// durante la ejecución de una OT desde el mobile. Cada nota puede ser TEXT,
// PHOTO, VIDEO o AUDIO. El pipeline AI (iteración posterior) las procesa para
// transcribir/OCR y reescribir en formato técnico hacia wo.observations.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { saveAttachment } from "../attachments/attachment-uploads-service";

export interface CreateProgressNoteInput {
  kind: "TEXT" | "PHOTO" | "VIDEO" | "AUDIO";
  text?: string | null;
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
): Promise<{ id: string; tenantId: string; vesselCode: string }> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await (prismaRaw as any).tenant.findUnique({
    where: { slug: session.tenantSlug },
    select: { id: true },
  });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const wo = await (prismaRaw as any).workOrder.findFirst({
    where: { id: workOrderId, tenantId: tenant.id, deletedAt: null },
    select: { id: true, tenantId: true, vesselCode: true },
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

  // Para TEXT: processedText = text (no requiere pipeline AI).
  // Para PHOTO/VIDEO/AUDIO: processedText queda null hasta que corra el pipeline.
  const processedText = input.kind === "TEXT" ? (input.text ?? "").trim() : null;
  const processed = input.kind === "TEXT";

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
    },
  });

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

export async function deleteProgressNote(
  session: TenantAccessSession,
  workOrderId: string,
  noteId: string,
): Promise<void> {
  const wo = await getWorkOrderOrThrow(session, workOrderId);

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
}
