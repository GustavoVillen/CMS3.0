import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevCertificatesForTenant } from "../../platform/data/dev-domain-store";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { buildChangeDiff } from "../audit/build-change-diff";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

export interface CertificateListFilters {
  vesselCode?: string | null;
  status?: string | null;
}

export async function listTenantCertificates(session: TenantAccessSession, filters: CertificateListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevCertificatesForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);

  // No filtramos por `status` en la query: el status guardado en BD es el
  // "original" (ACTIVE al crear), pero EXPIRING_SOON / EXPIRED se computan
  // dinámicamente desde expiryDate en withComputedStatus. Filtrar por
  // status en BD devolvía 0 filas para las consultas que vienen desde la
  // alerta del dashboard (?status=EXPIRING_SOON). Mantenemos withComputedStatus
  // como única fuente de verdad y aplicamos el filtro de status post-mapeo.
  const rows = await prisma.certificate.findMany({ where, orderBy: { expiryDate: "asc" } });
  const computed = rows.map(withComputedStatus);
  return filters.status ? computed.filter(r => r.status === filters.status) : computed;
}

export async function getTenantCertificateById(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) return null;

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return null;

  const cert = await prisma.certificate.findFirst({ where: { id, tenantId: tenant.id, deletedAt: null } });
  if (!cert) return null;

  if (session.user.role !== "TENANT_ADMIN") {
    if (!session.user.assignedVesselCodes.includes(cert.vesselCode)) return null;
  }

  return withComputedStatus(cert);
}

export interface CertificateWriteInput {
  certificateCode?: string;
  name: string;
  vesselCode: string;
  issuingAuthority: string;
  status?: string;
  issueDate: string;
  expiryDate: string;
  lastInspectionDate?: string | null;
  notes?: string | null;
  assetId?: string | null;
  originalSourceLink?: string | null;
  originalSourceName?: string | null;
  originalSourceMimeOrExt?: string | null;
}

type AutoCertificateStatus = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED";

function computeAutoCertificateStatus(expiryDate: Date): AutoCertificateStatus {
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((expiryDate.getTime() - now.getTime()) / msPerDay);
  if (diffDays < 0) return "EXPIRED";
  if (diffDays <= 30) return "EXPIRING_SOON";
  return "ACTIVE";
}

function resolveComputedStatus(expiryDate: Date, currentStatus: string): string {
  if (currentStatus === "SUSPENDED" || currentStatus === "CLOSED") {
    return currentStatus;
  }
  return computeAutoCertificateStatus(expiryDate);
}

function withComputedStatus<T extends { status: string; expiryDate: Date }>(cert: T): T {
  return {
    ...cert,
    status: resolveComputedStatus(cert.expiryDate, cert.status),
  };
}

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function isSupportedOriginalSourceReference(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) ||
    /^file:\/\//i.test(value) ||
    /^smb:\/\//i.test(value) ||
    /^\\\\[^\\]+\\[^\\]+/i.test(value) ||
    /^\/\/[^/]+\/[^/]+/i.test(value) ||
    /^[a-zA-Z]:\\/.test(value) ||
    /^\//.test(value)
  );
}

function normalizeOriginalSourceLink(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (/fakepath/i.test(text)) {
    throw new RouteError(400, "INVALID_ORIGINAL_SOURCE_LINK", "La ruta fakepath del navegador no es una referencia reutilizable.");
  }
  if (!isSupportedOriginalSourceReference(text)) {
    throw new RouteError(
      400,
      "INVALID_ORIGINAL_SOURCE_LINK",
      "La referencia original debe ser una URL/ruta válida (https://, file://, smb://, UNC o ruta absoluta).",
    );
  }
  return text;
}

function requireDate(value: unknown, field: string): Date {
  if (!value) throw new RouteError(400, "VALIDATION_ERROR", `${field} es requerido.`);
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `${field} no es una fecha válida.`);
  return d;
}

export async function createTenantCertificate(session: TenantAccessSession, input: CertificateWriteInput) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const code = String(input.certificateCode ?? "").trim().toUpperCase();
  if (!code) throw new RouteError(400, "VALIDATION_ERROR", "El código del certificado es requerido.");
  const name = String(input.name ?? "").trim();
  if (!name) throw new RouteError(400, "VALIDATION_ERROR", "El nombre es requerido.");
  const vesselCode = String(input.vesselCode ?? "").trim().toUpperCase();
  if (!vesselCode) throw new RouteError(400, "VALIDATION_ERROR", "El código del vessel es requerido.");
  const issuingAuthority = String(input.issuingAuthority ?? "").trim();
  if (!issuingAuthority) throw new RouteError(400, "VALIDATION_ERROR", "La autoridad emisora es requerida.");

  const issueDate = requireDate(input.issueDate, "issueDate");
  const expiryDate = requireDate(input.expiryDate, "expiryDate");
  const originalSourceLink = normalizeOriginalSourceLink(input.originalSourceLink);
  const originalSourceName = normalizeText(input.originalSourceName);
  const originalSourceMimeOrExt = normalizeText(input.originalSourceMimeOrExt);

  const existing = await prisma.certificate.findFirst({
    where: { tenantId: tenant.id, vesselCode, certificateCode: code, deletedAt: null },
  });
  if (existing) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un certificado con código ${code} para este vessel.`);

  const data: Record<string, unknown> = {
    tenantId: tenant.id,
    vesselCode,
    certificateCode: code,
    name,
    issuingAuthority,
    status: computeAutoCertificateStatus(expiryDate),
    issueDate,
    expiryDate,
    lastInspectionDate: input.lastInspectionDate ? new Date(input.lastInspectionDate) : null,
    notes: normalizeText(input.notes),
    assetId: normalizeText(input.assetId),
    originalSourceLink,
    originalSourceName,
    originalSourceMimeOrExt,
    createdByUserId: session.user.id,
    updatedByUserId: session.user.id,
  };

  const created = await (prisma as unknown as {
    certificate: { create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>> };
  }).certificate.create({ data });
  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "Certificate.created",
    entityType: "Certificate",
    entityId: (created as { id?: string }).id ?? null,
    metadata: { certificateCode: code, name, vesselCode },
  });
  return created;
}

export async function updateTenantCertificate(session: TenantAccessSession, id: string, input: Partial<CertificateWriteInput>) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const cert = await prisma.certificate.findFirst({ where: { id, tenantId: tenant.id, deletedAt: null } });
  if (!cert) throw new RouteError(404, "NOT_FOUND", "Certificado no encontrado.");

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };

  if (input.certificateCode !== undefined) {
    const nextCode = String(input.certificateCode).trim().toUpperCase();
    if (!nextCode) throw new RouteError(400, "VALIDATION_ERROR", "El código no puede estar vacío.");
    if (nextCode !== cert.certificateCode) {
      // Verificar unicidad por (tenantId, vesselCode, certificateCode) — index único en DB.
      const dup = await prisma.certificate.findFirst({
        where: { tenantId: tenant.id, vesselCode: cert.vesselCode, certificateCode: nextCode, deletedAt: null, NOT: { id } },
      });
      if (dup) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un certificado con código ${nextCode} en este buque.`);
      data.certificateCode = nextCode;
    }
  }

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new RouteError(400, "VALIDATION_ERROR", "El nombre no puede estar vacío.");
    data.name = name;
  }
  if (input.issuingAuthority !== undefined) {
    const auth = String(input.issuingAuthority).trim();
    if (!auth) throw new RouteError(400, "VALIDATION_ERROR", "La autoridad emisora no puede estar vacía.");
    data.issuingAuthority = auth;
  }
  if (input.issueDate !== undefined) data.issueDate = new Date(input.issueDate);
  const nextExpiryDate = input.expiryDate !== undefined ? new Date(input.expiryDate) : cert.expiryDate;
  if (input.expiryDate !== undefined) data.expiryDate = nextExpiryDate;
  data.status = resolveComputedStatus(nextExpiryDate, cert.status);
  if (input.lastInspectionDate !== undefined) data.lastInspectionDate = input.lastInspectionDate ? new Date(input.lastInspectionDate) : null;
  if (input.notes !== undefined) data.notes = normalizeText(input.notes);
  if (input.assetId !== undefined) data.assetId = normalizeText(input.assetId);
  if (input.originalSourceLink !== undefined) {
    const nextLink = normalizeOriginalSourceLink(input.originalSourceLink);
    data.originalSourceLink = nextLink;
    if (!nextLink) {
      data.originalSourceName = null;
      data.originalSourceMimeOrExt = null;
    }
  }
  if (input.originalSourceName !== undefined) data.originalSourceName = normalizeText(input.originalSourceName);
  if (input.originalSourceMimeOrExt !== undefined) data.originalSourceMimeOrExt = normalizeText(input.originalSourceMimeOrExt);

  const updated = await prisma.certificate.update({ where: { id }, data });
  const changedKeys = Object.keys(data).filter(k => !["updatedByUserId"].includes(k));
  const changes = buildChangeDiff(
    cert as unknown as Record<string, unknown>,
    data,
    changedKeys,
  );
  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "Certificate.updated",
    entityType: "Certificate",
    entityId: updated.id,
    metadata: { certificateCode: updated.certificateCode, name: updated.name, vesselCode: updated.vesselCode, changes },
  });
  return withComputedStatus(updated);
}

export async function deleteTenantCertificate(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const cert = await prisma.certificate.findFirst({ where: { id, tenantId: tenant.id, deletedAt: null } });
  if (!cert) throw new RouteError(404, "NOT_FOUND", "Certificado no encontrado.");

  const deleted = await prisma.certificate.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "Certificate.deleted",
    entityType: "Certificate",
    entityId: cert.id,
    metadata: { certificateCode: cert.certificateCode, name: cert.name, vesselCode: cert.vesselCode },
  });
  return deleted;
}
