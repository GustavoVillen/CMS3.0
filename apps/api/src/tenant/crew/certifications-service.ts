import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";

const CERT_TYPES = [
  "STCW_II_1", "STCW_II_2", "STCW_III_1", "STCW_III_2", "STCW_IV_2",
  "STCW_V_1", "STCW_VI_1", "STCW_VI_2", "STCW_VI_3", "STCW_VI_4",
  "GMDSS_GOC", "GMDSS_ROC", "BST", "MEDICAL_ENOG", "MEDICAL_FIRST_AID",
  "ADVANCED_FIRE_FIGHTING", "SHIP_SECURITY_OFFICER", "CROWD_MANAGEMENT",
  "PASSPORT", "SEAMANS_BOOK", "OTHER",
] as const;
type CertType = typeof CERT_TYPES[number];
type CertStatus = "VALID" | "EXPIRING_SOON" | "EXPIRED";

export interface CertificationWriteInput {
  type?: string;
  certificateNumber?: string | null;
  issuingAuthority?: string | null;
  issuedDate?: string | null;
  expiryDate?: string | null;
  docUrl?: string | null;
  notes?: string | null;
}

function canManage(session: TenantAccessSession): boolean {
  const r = session.user.role;
  return r === "TENANT_ADMIN" || r === "FLEET_SUPERINTENDENT" || r === "MAINTENANCE_MANAGER";
}

function ensureCanManage(session: TenantAccessSession) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar certificaciones.");
}

function parseType(value: unknown): CertType {
  const v = String(value ?? "").trim().toUpperCase();
  if (!CERT_TYPES.includes(v as CertType)) {
    throw new RouteError(400, "VALIDATION_ERROR", `type de certificación inválido: ${v}.`);
  }
  return v as CertType;
}

function normalizeOptional(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function parseOptionalDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function computeStatus(expiryDate: Date | null | undefined): CertStatus {
  if (!expiryDate) return "VALID";
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.floor((expiryDate.getTime() - Date.now()) / msPerDay);
  if (diff < 0) return "EXPIRED";
  if (diff <= 30) return "EXPIRING_SOON";
  return "VALID";
}

type CertClient = {
  crewCertification: {
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<Record<string, unknown>[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
  crew: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; vesselCode: string; tenantId: string; crewCode: string } | null> };
};

function certClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): CertClient {
  return prisma as unknown as CertClient;
}

async function ensureCrewAccess(session: TenantAccessSession, crewId: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const crew = await certClient(prisma).crew.findFirst({
    where: { id: crewId, tenantId: tenant.id, deletedAt: null },
  });
  if (!crew) throw new RouteError(404, "NOT_FOUND", "Tripulante no encontrado.");
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(crew.vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel de este tripulante.");
  }
  return { tenant, crew };
}

export async function listCertifications(session: TenantAccessSession, crewId: string) {
  const { tenant } = await ensureCrewAccess(session, crewId);
  const prisma = getPrismaClient();
  if (!prisma) return [];

  const rows = await certClient(prisma).crewCertification.findMany({
    where: { tenantId: tenant.id, crewId, deletedAt: null },
    orderBy: { expiryDate: "asc" },
  });
  return rows.map(r => ({ ...r, status: computeStatus((r as { expiryDate: Date | null }).expiryDate) }));
}

export async function createCertification(session: TenantAccessSession, crewId: string, input: CertificationWriteInput) {
  ensureCanManage(session);
  const { tenant } = await ensureCrewAccess(session, crewId);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const type = parseType(input.type);
  const expiryDate = parseOptionalDate(input.expiryDate);

  const created = await certClient(prisma).crewCertification.create({
    data: {
      tenantId: tenant.id,
      crewId,
      type,
      certificateNumber: normalizeOptional(input.certificateNumber),
      issuingAuthority: normalizeOptional(input.issuingAuthority),
      issuedDate: parseOptionalDate(input.issuedDate),
      expiryDate,
      docUrl: normalizeOptional(input.docUrl),
      status: computeStatus(expiryDate),
      notes: normalizeOptional(input.notes),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "CrewCertification.created",
    entityType: "CrewCertification",
    entityId: created.id as string,
    metadata: { crewId, type, expiryDate: expiryDate?.toISOString() ?? null },
  });

  return { ...created, status: computeStatus(expiryDate) };
}

export async function updateCertification(session: TenantAccessSession, crewId: string, certId: string, input: CertificationWriteInput) {
  ensureCanManage(session);
  const { tenant } = await ensureCrewAccess(session, crewId);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const existing = await certClient(prisma).crewCertification.findFirst({
    where: { id: certId, crewId, tenantId: tenant.id, deletedAt: null },
  });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Certificación no encontrada.");

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.type !== undefined) data.type = parseType(input.type);
  if (input.certificateNumber !== undefined) data.certificateNumber = normalizeOptional(input.certificateNumber);
  if (input.issuingAuthority !== undefined) data.issuingAuthority = normalizeOptional(input.issuingAuthority);
  if (input.issuedDate !== undefined) data.issuedDate = parseOptionalDate(input.issuedDate);
  if (input.docUrl !== undefined) data.docUrl = normalizeOptional(input.docUrl);
  if (input.notes !== undefined) data.notes = normalizeOptional(input.notes);

  const nextExpiry = input.expiryDate !== undefined
    ? parseOptionalDate(input.expiryDate)
    : ((existing as { expiryDate: Date | null }).expiryDate ?? null);
  if (input.expiryDate !== undefined) data.expiryDate = nextExpiry;
  data.status = computeStatus(nextExpiry);

  const updated = await certClient(prisma).crewCertification.update({ where: { id: certId }, data });

  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "CrewCertification.updated",
    entityType: "CrewCertification",
    entityId: certId,
    metadata: { crewId },
  });

  return { ...updated, status: computeStatus(nextExpiry) };
}

export async function deleteCertification(session: TenantAccessSession, crewId: string, certId: string) {
  ensureCanManage(session);
  const { tenant } = await ensureCrewAccess(session, crewId);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const existing = await certClient(prisma).crewCertification.findFirst({
    where: { id: certId, crewId, tenantId: tenant.id, deletedAt: null },
  });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Certificación no encontrada.");

  await certClient(prisma).crewCertification.update({
    where: { id: certId },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });

  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "CrewCertification.deleted",
    entityType: "CrewCertification",
    entityId: certId,
    metadata: { crewId },
  });
}
