import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevVesselsForTenant } from "../../platform/data/dev-domain-store";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { buildChangeDiff } from "../audit/build-change-diff";

const VESSEL_SELECT = {
  id: true,
  code: true,
  name: true,
  owner: true,
  vesselType: true,
  imo: true,
  registration: true,
  powerHp: true,
  dwtTons: true,
  lengthM: true,
  beamM: true,
  depthM: true,
  trnTn: true,
  trbTn: true,
  buildYear: true,
  buildCountry: true,
  incorporationDate: true,
  incorporationType: true,
  status: true,
  createdAt: true,
} as const;

export async function listTenantVessels(session: TenantAccessSession) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevVesselsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.code = { in: session.user.assignedVesselCodes };
  }

  return prisma.vessel.findMany({
    where: where as any,
    select: VESSEL_SELECT,
    orderBy: { code: "asc" },
  });
}

export async function getTenantVesselById(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return null;
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return null;

  const record = await prisma.vessel.findFirst({
    where: { id, tenantId: tenant.id, deletedAt: null },
    select: VESSEL_SELECT,
  });
  if (!record) return null;

  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    if (!session.user.assignedVesselCodes.includes(record.code)) return null;
  }

  return record;
}

export interface VesselWriteInput {
  code: string;
  name: string;
  owner?: string | null;
  vesselType?: string | null;
  imo?: string | null;
  registration?: string | null;
  powerHp?: number | string | null;
  dwtTons?: number | string | null;
  lengthM?: number | string | null;
  beamM?: number | string | null;
  depthM?: number | string | null;
  trnTn?: number | string | null;
  trbTn?: number | string | null;
  buildYear?: number | string | null;
  buildCountry?: string | null;
  incorporationDate?: string | null;
  incorporationType?: string | null;
  status?: string;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOptionalInt(value: unknown): number | null {
  const num = normalizeOptionalNumber(value);
  if (num === null) return null;
  return Math.trunc(num);
}

function normalizeOptionalDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildVesselDetailsData(input: Partial<VesselWriteInput>): Record<string, unknown> {
  return {
    owner: normalizeOptionalText(input.owner),
    vesselType: normalizeOptionalText(input.vesselType),
    imo: normalizeOptionalText(input.imo),
    registration: normalizeOptionalText(input.registration),
    powerHp: normalizeOptionalNumber(input.powerHp),
    dwtTons: normalizeOptionalNumber(input.dwtTons),
    lengthM: normalizeOptionalNumber(input.lengthM),
    beamM: normalizeOptionalNumber(input.beamM),
    depthM: normalizeOptionalNumber(input.depthM),
    trnTn: normalizeOptionalNumber(input.trnTn),
    trbTn: normalizeOptionalNumber(input.trbTn),
    buildYear: normalizeOptionalInt(input.buildYear),
    buildCountry: normalizeOptionalText(input.buildCountry),
    incorporationDate: normalizeOptionalDate(input.incorporationDate),
    incorporationType: normalizeOptionalText(input.incorporationType),
  };
}

const DETAIL_FIELDS = new Set([
  "owner", "vesselType", "imo", "registration",
  "powerHp", "dwtTons", "lengthM", "beamM", "depthM", "trnTn", "trbTn",
  "buildYear", "buildCountry", "incorporationDate", "incorporationType",
]);

async function updateVesselDetails(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  vesselId: string,
  tenantId: string,
  details: Record<string, unknown>,
): Promise<void> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (DETAIL_FIELDS.has(key)) data[key] = value;
  }
  if (Object.keys(data).length === 0) return;

  // updateMany lets us scope by both id AND tenantId in WHERE — defense in depth.
  await prisma.vessel.updateMany({
    where: { id: vesselId, tenantId },
    data: data as any,
  });
}

export async function createTenantVessel(session: TenantAccessSession, input: VesselWriteInput) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const code = String(input.code || "").trim().toUpperCase();
  const name = String(input.name || "").trim();
  if (!code) throw new RouteError(400, "VALIDATION_ERROR", "El código del vessel es requerido.");
  if (!name) throw new RouteError(400, "VALIDATION_ERROR", "El nombre del vessel es requerido.");

  const existing = await prisma.vessel.findUnique({
    where: { tenantId_code: { tenantId: tenant.id, code } },
  });
  if (existing && !existing.deletedAt) {
    throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un vessel con código ${code}.`);
  }

  const vessel = await prisma.vessel.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code } },
    update: {
      name,
      status: (input.status as any) ?? "ACTIVE",
      deletedAt: null,
      deletedByUserId: null,
      updatedByUserId: session.user.id,
    },
    create: {
      tenantId: tenant.id,
      code,
      name,
      status: (input.status as any) ?? "ACTIVE",
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  await updateVesselDetails(prisma, vessel.id, tenant.id, buildVesselDetailsData(input));
  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "Vessel.created",
    entityType: "Vessel",
    entityId: vessel.id,
    metadata: { code: vessel.code, name: vessel.name },
  });
  return vessel;
}

export async function updateTenantVessel(session: TenantAccessSession, id: string, input: Partial<VesselWriteInput>) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const vessel = await prisma.vessel.findFirst({
    where: { id, tenantId: tenant.id, deletedAt: null },
  });
  if (!vessel) throw new RouteError(404, "NOT_FOUND", "Vessel no encontrado.");

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new RouteError(400, "VALIDATION_ERROR", "El nombre no puede estar vacío.");
    data.name = name;
  }
  if (input.status !== undefined) data.status = input.status;

  const updated = await prisma.vessel.update({ where: { id }, data });

  const detailsToUpdate: Record<string, unknown> = {};
  if (input.owner !== undefined) detailsToUpdate.owner = normalizeOptionalText(input.owner);
  if (input.vesselType !== undefined) detailsToUpdate.vesselType = normalizeOptionalText(input.vesselType);
  if (input.imo !== undefined) detailsToUpdate.imo = normalizeOptionalText(input.imo);
  if (input.registration !== undefined) detailsToUpdate.registration = normalizeOptionalText(input.registration);
  if (input.powerHp !== undefined) detailsToUpdate.powerHp = normalizeOptionalNumber(input.powerHp);
  if (input.dwtTons !== undefined) detailsToUpdate.dwtTons = normalizeOptionalNumber(input.dwtTons);
  if (input.lengthM !== undefined) detailsToUpdate.lengthM = normalizeOptionalNumber(input.lengthM);
  if (input.beamM !== undefined) detailsToUpdate.beamM = normalizeOptionalNumber(input.beamM);
  if (input.depthM !== undefined) detailsToUpdate.depthM = normalizeOptionalNumber(input.depthM);
  if (input.trnTn !== undefined) detailsToUpdate.trnTn = normalizeOptionalNumber(input.trnTn);
  if (input.trbTn !== undefined) detailsToUpdate.trbTn = normalizeOptionalNumber(input.trbTn);
  if (input.buildYear !== undefined) detailsToUpdate.buildYear = normalizeOptionalInt(input.buildYear);
  if (input.buildCountry !== undefined) detailsToUpdate.buildCountry = normalizeOptionalText(input.buildCountry);
  if (input.incorporationDate !== undefined) detailsToUpdate.incorporationDate = normalizeOptionalDate(input.incorporationDate);
  if (input.incorporationType !== undefined) detailsToUpdate.incorporationType = normalizeOptionalText(input.incorporationType);

  await updateVesselDetails(prisma, id, tenant.id, detailsToUpdate);

  const changedFields = Object.keys(data).filter(k => !["updatedByUserId"].includes(k));
  const allChangedKeys = [...changedFields, ...Object.keys(detailsToUpdate)];
  const afterValues = { ...data, ...detailsToUpdate };
  const changes = buildChangeDiff(
    vessel as unknown as Record<string, unknown>,
    afterValues,
    allChangedKeys,
  );

  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "Vessel.updated",
    entityType: "Vessel",
    entityId: id,
    metadata: { code: vessel.code, name: vessel.name, vesselCode: vessel.code, changes },
  });
  return updated;
}

export async function deleteTenantVessel(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const vessel = await prisma.vessel.findFirst({
    where: { id, tenantId: tenant.id, deletedAt: null },
  });
  if (!vessel) throw new RouteError(404, "NOT_FOUND", "Vessel no encontrado.");

  const deleted = await prisma.vessel.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "Vessel.deleted",
    entityType: "Vessel",
    entityId: id,
    metadata: { code: vessel.code, name: vessel.name },
  });
  return deleted;
}
