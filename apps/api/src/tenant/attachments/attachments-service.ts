import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevAttachmentsForTenant } from "../../platform/data/dev-domain-store";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { RouteError } from "../../http/route-error";
import { extname } from "node:path";

export interface AttachmentListFilters {
  vesselCode?: string | null;
  status?: string | null;
  targetType?: string | null;
  targetId?: string | null;
}

const MIME_BY_EXT: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".doc":  "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls":  "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".webm": "audio/webm",
  ".mp3":  "audio/mpeg",
  ".m4a":  "audio/mp4",
  ".ogg":  "audio/ogg",
  ".wav":  "audio/wav",
  ".mp4":  "video/mp4",
  ".mov":  "video/quicktime",
};

// El frontend usa entityType en CamelCase (ej. "Defect", "WorkOrder").
// La columna targetType del schema es enum SCREAMING_SNAKE (DEFECT, WORK_ORDER, ...).
const ENTITY_TYPE_MAP: Record<string, string> = {
  Defect:              "DEFECT",
  WorkOrder:           "WORK_ORDER",
  MaintenancePlan:     "MAINTENANCE_PLAN",
  Inspection:          "INSPECTION",
  Certificate:         "CERTIFICATE",
  DailyReport:         "DAILY_REPORT",
  Capa:                "CAPA",
  SpareOrder:          "SPARE_ORDER",
  InspectionExecution: "INSPECTION_EXECUTION",
  WorkLog:             "WORK_LOG",
};

export async function listTenantAttachments(session: TenantAccessSession, filters: AttachmentListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevAttachmentsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.targetType) where.targetType = filters.targetType;
  if (filters.targetId)   where.targetId   = filters.targetId;

  return prisma.attachment.findMany({ where, orderBy: { uploadedAt: "desc" } });
}

/**
 * Registra un archivo recién subido como Attachment en DB. Permite listar y
 * borrar después. Llamado desde el handler POST /app/attachments/upload cuando
 * el caller proporciona entityType + entityId.
 *
 * Para entityType=Defect, hace lookup del defecto para obtener vesselCode
 * (requerido por el modelo).
 */
export async function registerAttachmentRecord(
  session: TenantAccessSession,
  input: { entityType: string; entityId: string | null; originalName: string; savedUrl: string; sizeBytes: number },
): Promise<string | null> {
  if (!input.entityId) return null;
  const targetType = ENTITY_TYPE_MAP[input.entityType];
  if (!targetType) return null;

  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return null;

  // Para validar tenant + vesselCode, buscamos la entidad parent.
  // Soportado de momento: Defect. Para los demás, no creamos registro (no rompe el upload).
  let vesselCode: string | null = null;
  if (input.entityType === "Defect") {
    const def = await (prisma as unknown as {
      defect: { findFirst(a: { where: Record<string, unknown>; select: Record<string, boolean> }): Promise<{ id: string; vesselCode: string } | null> };
    }).defect.findFirst({
      where: { id: input.entityId, tenantId: tenant.id, deletedAt: null },
      select: { id: true, vesselCode: true },
    });
    if (!def) return null;
    vesselCode = def.vesselCode;
  } else {
    // Otros entityType: ampliar acá cuando hagan falta.
    return null;
  }

  const ext = extname(input.originalName).toLowerCase();
  const mimeType = MIME_BY_EXT[ext] ?? "application/octet-stream";

  const now = new Date();
  const created = await prisma.attachment.create({
    data: {
      tenantId:         tenant.id,
      vesselCode,
      targetType:       targetType as never,
      targetId:         input.entityId,
      filename:         input.originalName,
      mimeType,
      sizeBytes:        input.sizeBytes,
      status:           "ACTIVE",
      uploadedAt:       now,
      uploadedByUserId: session.user.id,
      description:      input.savedUrl, // url se mete acá para retornarla en list
      createdByUserId:  session.user.id,
      updatedByUserId:  session.user.id,
    },
  });
  return created.id;
}

export async function softDeleteTenantAttachment(session: TenantAccessSession, id: string): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DB_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const existing = await prisma.attachment.findFirst({ where: { id, tenantId: tenant.id, deletedAt: null } });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Adjunto no encontrado.");

  // Scope check
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(existing.vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel del adjunto.");
  }

  await prisma.attachment.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
}
