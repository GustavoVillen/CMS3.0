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
  /** Certificados que renueva un plan de mantenimiento puntual. */
  maintenancePlanId?: string | null;
}

/**
 * Completa cada certificado con el nombre del equipo y los datos del plan que lo
 * renueva (código, título y última ejecución).
 *
 * La última ejecución es lo que permite a la UI avisar "pendiente de actualizar"
 * cuando el mantenimiento ya se hizo pero el certificado todavía tiene las fechas
 * viejas — sin guardar ningún estado nuevo, y sirve para TODAS las formas de
 * cerrar un mantenimiento (móvil, express, OT, reporte diario).
 */
async function attachLinks<T extends { assetId: string | null; maintenancePlanId?: string | null }>(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  rows: T[],
) {
  const assetIds = [...new Set(rows.map(r => r.assetId).filter((v): v is string => !!v))];
  const planIds = [...new Set(rows.map(r => r.maintenancePlanId ?? null).filter((v): v is string => !!v))];

  const [assets, plans] = await Promise.all([
    assetIds.length
      ? prisma.asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, name: true } })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    planIds.length
      ? prisma.maintenancePlan.findMany({
          where: { id: { in: planIds }, tenantId },
          select: { id: true, taskCode: true, title: true, lastExecutionDate: true, deletedAt: true },
        })
      : Promise.resolve([] as Array<{ id: string; taskCode: string; title: string; lastExecutionDate: Date | null; deletedAt: Date | null }>),
  ]);

  const assetById = new Map(assets.map(a => [a.id, a]));
  const planById = new Map(plans.filter(p => !p.deletedAt).map(p => [p.id, p]));

  return rows.map(r => {
    const plan = r.maintenancePlanId ? planById.get(r.maintenancePlanId) : undefined;
    return {
      ...r,
      assetName: r.assetId ? assetById.get(r.assetId)?.name ?? null : null,
      maintenancePlanTaskCode: plan?.taskCode ?? null,
      maintenancePlanTitle: plan?.title ?? null,
      maintenancePlanLastExecutionDate: plan?.lastExecutionDate ?? null,
    };
  });
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
  if (filters.maintenancePlanId) where.maintenancePlanId = filters.maintenancePlanId;

  // No filtramos por `status` en la query: el status guardado en BD es el
  // "original" (ACTIVE al crear), pero EXPIRING_SOON / EXPIRED se computan
  // dinámicamente desde expiryDate en withComputedStatus. Filtrar por
  // status en BD devolvía 0 filas para las consultas que vienen desde la
  // alerta del dashboard (?status=EXPIRING_SOON). Mantenemos withComputedStatus
  // como única fuente de verdad y aplicamos el filtro de status post-mapeo.
  const rows = await prisma.certificate.findMany({ where, orderBy: { expiryDate: "asc" } });
  const computed = await attachLinks(prisma, tenant.id, rows.map(withComputedStatus));
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

  const [withLinks] = await attachLinks(prisma, tenant.id, [withComputedStatus(cert)]);
  // Historial de vigencias, de la más reciente a la más vieja.
  const renewals = await prisma.certificateRenewal.findMany({
    where: { certificateId: cert.id, tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
  });
  return { ...withLinks, renewals };
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
  /** Plan de mantenimiento que renueva este certificado (servicio tercerizado). */
  maintenancePlanId?: string | null;
  originalSourceLink?: string | null;
  originalSourceName?: string | null;
  originalSourceMimeOrExt?: string | null;
}

export type AutoCertificateStatus = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED";

export function computeAutoCertificateStatus(expiryDate: Date): AutoCertificateStatus {
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((expiryDate.getTime() - now.getTime()) / msPerDay);
  if (diffDays < 0) return "EXPIRED";
  if (diffDays <= 30) return "EXPIRING_SOON";
  return "ACTIVE";
}

export function resolveComputedStatus(expiryDate: Date, currentStatus: string): string {
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

/**
 * El equipo y el plan tienen que existir y ser del MISMO buque que el
 * certificado: si no, el aviso de "pendiente de actualizar" apuntaría al
 * mantenimiento de otra embarcación. `assetId` viene de antes sin FK y se
 * validaba con un simple trim; ahora se verifica de verdad.
 */
async function validateLinks(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  vesselCode: string,
  assetId: string | null,
  maintenancePlanId: string | null,
): Promise<void> {
  if (assetId) {
    const asset = await prisma.asset.findFirst({ where: { id: assetId, tenantId, deletedAt: null }, select: { vesselCode: true } });
    if (!asset) throw new RouteError(400, "VALIDATION_ERROR", "El equipo indicado no existe.");
    if (asset.vesselCode !== vesselCode) {
      throw new RouteError(400, "VALIDATION_ERROR", "El equipo pertenece a otro buque.");
    }
  }
  if (maintenancePlanId) {
    const plan = await prisma.maintenancePlan.findFirst({
      where: { id: maintenancePlanId, tenantId, deletedAt: null },
      select: { vesselCode: true },
    });
    if (!plan) throw new RouteError(400, "VALIDATION_ERROR", "El plan de mantenimiento indicado no existe.");
    if (plan.vesselCode !== vesselCode) {
      throw new RouteError(400, "VALIDATION_ERROR", "El plan de mantenimiento pertenece a otro buque.");
    }
  }
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

  const assetId = normalizeText(input.assetId);
  const maintenancePlanId = normalizeText(input.maintenancePlanId);
  await validateLinks(prisma, tenant.id, vesselCode, assetId, maintenancePlanId);

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
    assetId,
    maintenancePlanId,
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
  if (input.assetId !== undefined || input.maintenancePlanId !== undefined) {
    const nextAssetId = input.assetId !== undefined ? normalizeText(input.assetId) : cert.assetId;
    const nextPlanId = input.maintenancePlanId !== undefined ? normalizeText(input.maintenancePlanId) : cert.maintenancePlanId;
    await validateLinks(prisma, tenant.id, cert.vesselCode, nextAssetId, nextPlanId);
    if (input.assetId !== undefined) data.assetId = nextAssetId;
    if (input.maintenancePlanId !== undefined) data.maintenancePlanId = nextPlanId;
  }
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

export interface CertificateRenewInput {
  issueDate: string;
  expiryDate: string;
  lastInspectionDate?: string | null;
  originalSourceLink?: string | null;
  originalSourceName?: string | null;
  originalSourceMimeOrExt?: string | null;
  /** Ejecución que originó la renovación (para la trazabilidad del historial). */
  maintenancePlanId?: string | null;
  workLogId?: string | null;
  notes?: string | null;
}

/**
 * Renueva un certificado: archiva la vigencia actual en el historial y deja las
 * fechas (y el archivo) nuevos en el certificado.
 *
 * Es SIEMPRE una acción explícita del usuario: el certificado es un documento
 * legal emitido por un tercero, así que sus fechas salen del papel del proveedor
 * y no de cuándo se registró el mantenimiento. Por eso ningún cierre de plan u
 * OT toca certificados por su cuenta.
 */
export async function renewTenantCertificate(session: TenantAccessSession, id: string, input: CertificateRenewInput) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const cert = await prisma.certificate.findFirst({ where: { id, tenantId: tenant.id, deletedAt: null } });
  if (!cert) throw new RouteError(404, "NOT_FOUND", "Certificado no encontrado.");
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(cert.vesselCode)) {
    throw new RouteError(404, "NOT_FOUND", "Certificado no encontrado.");
  }

  const issueDate = requireDate(input.issueDate, "issueDate");
  const expiryDate = requireDate(input.expiryDate, "expiryDate");
  if (expiryDate.getTime() <= issueDate.getTime()) {
    throw new RouteError(400, "VALIDATION_ERROR", "El vencimiento debe ser posterior a la fecha de emisión.");
  }

  // Archivo nuevo: si no se adjunta uno, se conserva el que ya tenía.
  const hasNewFile = input.originalSourceLink !== undefined;
  const nextLink = hasNewFile ? normalizeOriginalSourceLink(input.originalSourceLink) : cert.originalSourceLink;
  const nextName = hasNewFile ? normalizeText(input.originalSourceName) : cert.originalSourceName;
  const nextMime = hasNewFile ? normalizeText(input.originalSourceMimeOrExt) : cert.originalSourceMimeOrExt;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.certificateRenewal.create({
      data: {
        tenantId: tenant.id,
        vesselCode: cert.vesselCode,
        certificateId: cert.id,
        previousIssueDate: cert.issueDate,
        previousExpiryDate: cert.expiryDate,
        previousSourceLink: cert.originalSourceLink,
        previousSourceName: cert.originalSourceName,
        issueDate,
        expiryDate,
        lastInspectionDate: input.lastInspectionDate ? new Date(input.lastInspectionDate) : null,
        maintenancePlanId: normalizeText(input.maintenancePlanId) ?? cert.maintenancePlanId,
        workLogId: normalizeText(input.workLogId),
        notes: normalizeText(input.notes),
        createdByUserId: session.user.id,
        createdByName: `${session.user.firstName ?? ""} ${session.user.lastName ?? ""}`.trim() || session.user.email,
      },
    });

    return tx.certificate.update({
      where: { id: cert.id },
      data: {
        issueDate,
        expiryDate,
        // El status se recalcula: varios consumidores (contadores del sidebar,
        // compliance) leen el campo persistido, no el derivado.
        status: resolveComputedStatus(expiryDate, cert.status) as typeof cert.status,
        ...(input.lastInspectionDate !== undefined
          ? { lastInspectionDate: input.lastInspectionDate ? new Date(input.lastInspectionDate) : null }
          : {}),
        originalSourceLink: nextLink,
        originalSourceName: nextName,
        originalSourceMimeOrExt: nextMime,
        updatedByUserId: session.user.id,
      },
    });
  });

  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "Certificate.renewed",
    entityType: "Certificate",
    entityId: cert.id,
    metadata: {
      certificateCode: cert.certificateCode,
      vesselCode: cert.vesselCode,
      previous: { issueDate: cert.issueDate, expiryDate: cert.expiryDate },
      next: { issueDate, expiryDate },
      maintenancePlanId: normalizeText(input.maintenancePlanId) ?? cert.maintenancePlanId,
    },
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
