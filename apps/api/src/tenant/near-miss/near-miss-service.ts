// SIRE 2.0 Ch. 4 — Near Miss / Hazard Observation reporting.
// Separado de Defect porque registra eventos o condiciones de riesgo, no
// problemas materiales.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";

const CATEGORIES = ["NEAR_MISS", "HAZARD_OBSERVATION", "UNSAFE_ACT", "UNSAFE_CONDITION"] as const;
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const STATUSES = ["REPORTED", "UNDER_REVIEW", "ACTIONED", "CLOSED"] as const;

export interface NearMissListFilters {
  vesselCode?: string | null;
  category?: string | null;
  status?: string | null;
  severity?: string | null;
}

export interface NearMissWriteInput {
  vesselCode?: string;
  category?: string;
  severity?: string;
  status?: string;
  occurredAt?: string | Date;
  location?: string | null;
  description?: string;
  immediateAction?: string | null;
  rootCause?: string | null;
  preventiveActions?: string | null;
  lessonsLearned?: string | null;
  assetId?: string | null;
  reportedByName?: string | null;
  reportedByCrewId?: string | null;
}

function canWriteNearMiss(s: TenantAccessSession): boolean {
  return s.user.role !== "AUDITOR_READONLY"; // cualquiera reporta cultura de seguridad
}

function ensureCanWriteNearMiss(s: TenantAccessSession) {
  if (!canWriteNearMiss(s)) throw new RouteError(403, "FORBIDDEN", "Los usuarios solo-lectura no pueden reportar near miss.");
}

function normReq(v: unknown, f: string): string {
  const t = String(v ?? "").trim();
  if (!t) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${f} es requerido.`);
  return t;
}
function normOpt(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t || null;
}
function parseDate(v: unknown, f: string): Date {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${f}.`);
  return d;
}
function parseEnum<T extends string>(v: unknown, allowed: readonly T[], f: string): T {
  const s = String(v ?? "").trim().toUpperCase();
  if (!allowed.includes(s as T)) throw new RouteError(400, "VALIDATION_ERROR", `${f} inválido: ${s}.`);
  return s as T;
}

type Delegate = {
  findMany(a: unknown): Promise<Record<string, unknown>[]>;
  findFirst(a: unknown): Promise<Record<string, unknown> | null>;
  create(a: unknown): Promise<Record<string, unknown>>;
  update(a: unknown): Promise<Record<string, unknown>>;
  count(a: unknown): Promise<number>;
};

function delegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) {
  return (prisma as unknown as { nearMissReport: Delegate }).nearMissReport;
}

async function getTenantIdOrThrow(s: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: s.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

function applyVesselScope(s: TenantAccessSession, where: Record<string, unknown>, requested?: string | null) {
  if (s.user.role === "TENANT_ADMIN") {
    if (requested) where.vesselCode = requested;
    return;
  }
  if (requested) {
    if (!s.user.assignedVesselCodes.includes(requested)) { where.vesselCode = "__NO_ASSIGNED_VESSEL__"; return; }
    where.vesselCode = requested;
    return;
  }
  if (s.user.assignedVesselCodes.length === 0) { where.vesselCode = "__NO_ASSIGNED_VESSEL__"; return; }
  where.vesselCode = { in: s.user.assignedVesselCodes };
}

export async function listNearMisses(session: TenantAccessSession, filters: NearMissListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.category) where.category = filters.category;
  if (filters.status)   where.status = filters.status;
  if (filters.severity) where.severity = filters.severity;
  return delegate(prisma).findMany({ where, orderBy: { occurredAt: "desc" } });
}

export async function getNearMiss(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);
  const rec = await delegate(prisma).findFirst({ where });
  if (!rec) throw new RouteError(404, "NOT_FOUND", "Reporte no encontrado.");
  return rec;
}

async function generateNearMissCode(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, tenantId: string, vesselCode: string): Promise<string> {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const count = await delegate(prisma).count({
    where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
  });
  return `NM-${vesselCode}-${yy}-${String(count + 1).padStart(4, "0")}`;
}

export async function createNearMiss(session: TenantAccessSession, input: NearMissWriteInput) {
  ensureCanWriteNearMiss(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normReq(input.vesselCode, "vesselCode").toUpperCase();
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
  }
  const nearMissCode = await generateNearMissCode(prisma, tenantId, vesselCode);

  const created = await delegate(prisma).create({
    data: {
      tenantId, vesselCode, nearMissCode,
      category:          parseEnum(input.category, CATEGORIES, "category"),
      severity:          input.severity ? parseEnum(input.severity, SEVERITIES, "severity") : "MEDIUM",
      status:            "REPORTED",
      occurredAt:        input.occurredAt ? parseDate(input.occurredAt, "occurredAt") : new Date(),
      location:          normOpt(input.location),
      description:       normReq(input.description, "description"),
      immediateAction:   normOpt(input.immediateAction),
      assetId:           normOpt(input.assetId),
      reportedByName:    normOpt(input.reportedByName),
      reportedByCrewId:  normOpt(input.reportedByCrewId),
      createdByUserId:   session.user.id,
      updatedByUserId:   session.user.id,
    },
  });
  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id,
    action: "NearMiss.created", entityType: "NearMissReport",
    entityId: (created as { id: string }).id,
    metadata: { nearMissCode, vesselCode, category: input.category, severity: input.severity ?? "MEDIUM" },
  });
  return created;
}

export async function updateNearMiss(session: TenantAccessSession, id: string, input: NearMissWriteInput) {
  ensureCanWriteNearMiss(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const current = await getNearMiss(session, id) as unknown as { id: string; tenantId: string; status: string; nearMissCode: string };
  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.category !== undefined) data.category = parseEnum(input.category, CATEGORIES, "category");
  if (input.severity !== undefined) data.severity = parseEnum(input.severity, SEVERITIES, "severity");
  if (input.status !== undefined) {
    const next = parseEnum(input.status, STATUSES, "status");
    data.status = next;
    if (next === "UNDER_REVIEW" && current.status !== "UNDER_REVIEW") {
      data.reviewedAt = new Date();
      data.reviewedByUserId = session.user.id;
    }
    if (next === "CLOSED" && current.status !== "CLOSED") {
      data.closedAt = new Date();
    }
  }
  if (input.occurredAt !== undefined) data.occurredAt = parseDate(input.occurredAt, "occurredAt");
  if (input.location !== undefined) data.location = normOpt(input.location);
  if (input.description !== undefined) data.description = normReq(input.description, "description");
  if (input.immediateAction !== undefined) data.immediateAction = normOpt(input.immediateAction);
  if (input.rootCause !== undefined) data.rootCause = normOpt(input.rootCause);
  if (input.preventiveActions !== undefined) data.preventiveActions = normOpt(input.preventiveActions);
  if (input.lessonsLearned !== undefined) data.lessonsLearned = normOpt(input.lessonsLearned);
  if (input.assetId !== undefined) data.assetId = normOpt(input.assetId);
  if (input.reportedByName !== undefined) data.reportedByName = normOpt(input.reportedByName);
  if (input.reportedByCrewId !== undefined) data.reportedByCrewId = normOpt(input.reportedByCrewId);
  const updated = await delegate(prisma).update({ where: { id }, data });
  void publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id,
    action: "NearMiss.updated", entityType: "NearMissReport", entityId: id,
    metadata: { nearMissCode: current.nearMissCode },
  });
  return updated;
}

export async function deleteNearMiss(session: TenantAccessSession, id: string) {
  if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede eliminar reportes.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const current = await getNearMiss(session, id) as unknown as { id: string; tenantId: string; nearMissCode: string };
  await delegate(prisma).update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id,
    action: "NearMiss.deleted", entityType: "NearMissReport", entityId: id,
    metadata: { nearMissCode: current.nearMissCode },
  });
}
