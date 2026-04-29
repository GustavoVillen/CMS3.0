import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";

function requireAdmin(session: TenantAccessSession): void {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo el administrador del tenant puede gestionar documentos de IA.");
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listTenantAiDocuments(session: TenantAccessSession) {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [], total: 0 };

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");

  const docs = await prisma.aiDocument.findMany({
    where:   { tenantId: tenant.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      versions: {
        orderBy: { version: "desc" },
        select: { id: true, version: true, status: true, mimeType: true, sizeBytes: true, activatedAt: true, createdAt: true, createdByUserId: true },
      },
    },
  });

  return { items: docs, total: docs.length };
}

// ---------------------------------------------------------------------------
// Get single
// ---------------------------------------------------------------------------

export async function getTenantAiDocument(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");

  const doc = await prisma.aiDocument.findFirst({
    where:   { id, tenantId: tenant.id, deletedAt: null },
    include: {
      versions: {
        orderBy: { version: "desc" },
      },
    },
  });

  if (!doc) throw new RouteError(404, "AI_DOCUMENT_NOT_FOUND", "Documento no encontrado.");
  return doc;
}

// ---------------------------------------------------------------------------
// Create document + initial version
// ---------------------------------------------------------------------------

export interface CreateAiDocumentRequest {
  name: string;
  description?: string;
  content: string;
  mimeType?: string;
}

export async function createTenantAiDocument(session: TenantAccessSession, request: CreateAiDocumentRequest) {
  requireAdmin(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const name = String(request.name || "").trim();
  if (!name) throw new RouteError(400, "AI_DOCUMENT_NAME_REQUIRED", "El nombre del documento es requerido.");

  const content = String(request.content || "").trim();
  if (!content) throw new RouteError(400, "AI_DOCUMENT_CONTENT_REQUIRED", "El contenido del documento es requerido.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");

  const now     = new Date();
  const mimeType = request.mimeType || "text/plain";

  const doc = await prisma.aiDocument.create({
    data: {
      tenantId:        tenant.id,
      name,
      description:     request.description ?? null,
      status:          "ACTIVE",
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
      versions: {
        create: {
          tenantId:        tenant.id,
          version:         1,
          status:          "DRAFT",
          content,
          mimeType,
          sizeBytes:       Buffer.byteLength(content, "utf8"),
          createdByUserId: session.user.id,
        },
      },
    },
    include: { versions: { orderBy: { version: "desc" } } },
  });

  return doc;
}

// ---------------------------------------------------------------------------
// Add version to existing document
// ---------------------------------------------------------------------------

export interface CreateAiDocumentVersionRequest {
  content: string;
  mimeType?: string;
}

export async function createTenantAiDocumentVersion(
  session: TenantAccessSession,
  documentId: string,
  request: CreateAiDocumentVersionRequest,
) {
  requireAdmin(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const content = String(request.content || "").trim();
  if (!content) throw new RouteError(400, "AI_DOCUMENT_CONTENT_REQUIRED", "El contenido del documento es requerido.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");

  const doc = await prisma.aiDocument.findFirst({ where: { id: documentId, tenantId: tenant.id, deletedAt: null } });
  if (!doc) throw new RouteError(404, "AI_DOCUMENT_NOT_FOUND", "Documento no encontrado.");

  const last = await prisma.aiDocumentVersion.findFirst({
    where:   { documentId },
    orderBy: { version: "desc" },
    select:  { version: true },
  });
  const nextVersion = (last?.version ?? 0) + 1;

  const version = await prisma.aiDocumentVersion.create({
    data: {
      documentId,
      tenantId:        tenant.id,
      version:         nextVersion,
      status:          "DRAFT",
      content,
      mimeType:        request.mimeType || "text/plain",
      sizeBytes:       Buffer.byteLength(content, "utf8"),
      createdByUserId: session.user.id,
    },
  });

  // Touch document updatedAt
  await prisma.aiDocument.update({
    where: { id: documentId },
    data:  { updatedByUserId: session.user.id },
  });

  return version;
}

// ---------------------------------------------------------------------------
// Update content of a DRAFT version
// ---------------------------------------------------------------------------

export async function updateTenantAiDocumentVersionContent(
  session: TenantAccessSession,
  documentId: string,
  versionId: string,
  content: string,
) {
  requireAdmin(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const trimmed = String(content || "").trim();
  if (!trimmed) throw new RouteError(400, "AI_DOCUMENT_CONTENT_REQUIRED", "El contenido del documento es requerido.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");

  const version = await prisma.aiDocumentVersion.findFirst({
    where: { id: versionId, documentId, tenantId: tenant.id },
  });
  if (!version) throw new RouteError(404, "AI_DOCUMENT_VERSION_NOT_FOUND", "Versión no encontrada.");
  if (version.status !== "DRAFT") {
    throw new RouteError(409, "AI_DOCUMENT_VERSION_NOT_DRAFT", "Solo se puede editar el contenido de versiones DRAFT. Para modificar una versión ACTIVE, creá una nueva versión.");
  }

  const updated = await prisma.aiDocumentVersion.update({
    where: { id: versionId },
    data:  { content: trimmed, sizeBytes: Buffer.byteLength(trimmed, "utf8") },
  });

  await prisma.aiDocument.update({
    where: { id: documentId },
    data:  { updatedByUserId: session.user.id },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Activate a version
// ---------------------------------------------------------------------------

export async function activateTenantAiDocumentVersion(
  session: TenantAccessSession,
  documentId: string,
  versionId: string,
) {
  requireAdmin(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");

  const version = await prisma.aiDocumentVersion.findFirst({
    where: { id: versionId, documentId, tenantId: tenant.id },
  });
  if (!version) throw new RouteError(404, "AI_DOCUMENT_VERSION_NOT_FOUND", "Versión no encontrada.");
  if (version.status === "ACTIVE") throw new RouteError(409, "AI_DOCUMENT_VERSION_ALREADY_ACTIVE", "La versión ya está activa.");

  const now = new Date();

  // Archive any currently ACTIVE version of this document
  await prisma.aiDocumentVersion.updateMany({
    where: { documentId, status: "ACTIVE" },
    data:  { status: "ARCHIVED", archivedAt: now, archivedByUserId: session.user.id },
  });

  // Activate the target version
  const activated = await prisma.aiDocumentVersion.update({
    where: { id: versionId },
    data:  { status: "ACTIVE", activatedAt: now, activatedByUserId: session.user.id },
  });

  await prisma.aiDocument.update({
    where: { id: documentId },
    data:  { updatedByUserId: session.user.id },
  });

  return activated;
}

// ---------------------------------------------------------------------------
// Archive (soft-delete) document
// ---------------------------------------------------------------------------

export async function archiveTenantAiDocument(session: TenantAccessSession, id: string) {
  requireAdmin(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");

  const doc = await prisma.aiDocument.findFirst({ where: { id, tenantId: tenant.id, deletedAt: null } });
  if (!doc) throw new RouteError(404, "AI_DOCUMENT_NOT_FOUND", "Documento no encontrado.");

  const now = new Date();
  const updated = await prisma.aiDocument.update({
    where: { id },
    data:  { deletedAt: now, deletedByUserId: session.user.id, status: "ARCHIVED", updatedByUserId: session.user.id },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Delete a DRAFT version
// ---------------------------------------------------------------------------

export async function deleteTenantAiDocumentVersion(
  session: TenantAccessSession,
  documentId: string,
  versionId: string,
) {
  requireAdmin(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");

  const version = await prisma.aiDocumentVersion.findFirst({
    where: { id: versionId, documentId, tenantId: tenant.id },
  });
  if (!version) throw new RouteError(404, "AI_DOCUMENT_VERSION_NOT_FOUND", "Versión no encontrada.");
  if (version.status !== "DRAFT") {
    throw new RouteError(409, "AI_DOCUMENT_VERSION_NOT_DRAFT", "Solo se pueden eliminar versiones en estado DRAFT.");
  }

  await prisma.aiDocumentVersion.delete({ where: { id: versionId } });

  await prisma.aiDocument.update({
    where: { id: documentId },
    data:  { updatedByUserId: session.user.id },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// AI context helper — returns concatenated content of all ACTIVE versions
// ---------------------------------------------------------------------------

export async function getActiveTenantAiDocumentsContent(tenantId: string): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) return "";

  const versions = await prisma.aiDocumentVersion.findMany({
    where: { tenantId, status: "ACTIVE" },
    select: { content: true },
    take: 5,
  });
  return versions.map(v => v.content).join("\n\n---\n\n");
}
