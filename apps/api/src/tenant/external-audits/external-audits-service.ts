// SIRE 2.0 Ch. 4 — External audits (PSC / Flag / Class / Vetting).
// Registro histórico de inspecciones externas + findings con tracking de cierre.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";

const AUDIT_TYPES = ["PSC", "FLAG", "CLASS", "VETTING_OIL_MAJOR", "CDI", "RIGHTSHIP", "OTHER"] as const;
const FINDING_TYPES = ["DEFICIENCY", "OBSERVATION", "RECOMMENDATION", "POSITIVE_OBSERVATION"] as const;
const FINDING_STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED", "REJECTED_BY_AUDITOR"] as const;

export interface ExternalAuditListFilters {
  vesselCode?: string | null;
  auditType?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}

export interface CreateExternalAuditInput {
  vesselCode: string;
  auditType: string;
  auditDate: string | Date;
  port?: string | null;
  country?: string | null;
  agencyOrAuthority?: string | null;
  inspectorName?: string | null;
  durationHours?: number | null;
  overallResult?: string | null;
  summary?: string | null;
  scoreOrRating?: string | null;
  reportUrl?: string | null;
}

export interface UpdateExternalAuditInput extends Partial<Omit<CreateExternalAuditInput, "vesselCode">> {}

export interface CreateFindingInput {
  findingCode?: string | null;
  findingType: string;
  category?: string | null;
  description: string;
  severity?: string | null;
  detentionRelated?: boolean;
  rectificationDeadline?: string | Date | null;
}

export interface UpdateFindingInput extends Partial<CreateFindingInput> {
  status?: string;
  clearingDate?: string | Date | null;
  evidenceNotes?: string | null;
  evidenceDocUrl?: string | null;
}

function canWrite(session: TenantAccessSession): boolean {
  const r = session.user.role;
  return r === "TENANT_ADMIN" || r === "FLEET_SUPERINTENDENT" || r === "MAINTENANCE_MANAGER" || r === "INSPECTOR_COMPLIANCE";
}

function ensureCanWrite(session: TenantAccessSession) {
  if (!canWrite(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar auditorías externas.");
}

function normReq(value: unknown, field: string): string {
  const t = String(value ?? "").trim();
  if (!t) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return t;
}

function normOpt(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const t = String(value).trim();
  return t || null;
}

function parseDate(value: unknown, field: string): Date {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  return d;
}

function parseOptDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  return parseDate(value, field);
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const v = String(value ?? "").trim().toUpperCase();
  if (!allowed.includes(v as T)) {
    throw new RouteError(400, "VALIDATION_ERROR", `${field} inválido: ${v}.`);
  }
  return v as T;
}

type AuditDelegate = {
  findMany(a: unknown): Promise<Record<string, unknown>[]>;
  findFirst(a: unknown): Promise<Record<string, unknown> | null>;
  create(a: unknown): Promise<Record<string, unknown>>;
  update(a: unknown): Promise<Record<string, unknown>>;
  count(a: unknown): Promise<number>;
};

function auditDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) {
  return (prisma as unknown as { externalAudit: AuditDelegate }).externalAudit;
}

function findingDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) {
  return (prisma as unknown as { externalAuditFinding: AuditDelegate }).externalAuditFinding;
}

async function getTenantIdOrThrow(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

function applyVesselScope(session: TenantAccessSession, where: Record<string, unknown>, requested?: string | null) {
  if (session.user.role === "TENANT_ADMIN") {
    if (requested) where.vesselCode = requested;
    return;
  }
  if (requested) {
    if (!session.user.assignedVesselCodes.includes(requested)) {
      where.vesselCode = "__NO_ASSIGNED_VESSEL__";
      return;
    }
    where.vesselCode = requested;
    return;
  }
  if (session.user.assignedVesselCodes.length === 0) {
    where.vesselCode = "__NO_ASSIGNED_VESSEL__";
    return;
  }
  where.vesselCode = { in: session.user.assignedVesselCodes };
}

export async function listExternalAudits(session: TenantAccessSession, filters: ExternalAuditListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.auditType) where.auditType = filters.auditType;
  if (filters.fromDate || filters.toDate) {
    const range: Record<string, Date> = {};
    if (filters.fromDate) range.gte = parseDate(filters.fromDate, "fromDate");
    if (filters.toDate) range.lte = parseDate(filters.toDate, "toDate");
    where.auditDate = range;
  }
  const items = await auditDelegate(prisma).findMany({ where, orderBy: { auditDate: "desc" } });

  // Contadores de findings por audit
  const ids = items.map(a => (a as { id: string }).id);
  let findingCounts = new Map<string, { total: number; open: number }>();
  if (ids.length > 0) {
    const findings = await findingDelegate(prisma).findMany({
      where: { auditId: { in: ids } },
      select: { auditId: true, status: true } as never,
    });
    for (const f of findings as Array<{ auditId: string; status: string }>) {
      const entry = findingCounts.get(f.auditId) ?? { total: 0, open: 0 };
      entry.total++;
      if (f.status === "OPEN" || f.status === "IN_PROGRESS") entry.open++;
      findingCounts.set(f.auditId, entry);
    }
  }
  return items.map(a => {
    const id = (a as { id: string }).id;
    const counts = findingCounts.get(id) ?? { total: 0, open: 0 };
    return { ...a, findingsTotal: counts.total, findingsOpen: counts.open };
  });
}

export async function getExternalAudit(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);
  const audit = await auditDelegate(prisma).findFirst({ where });
  if (!audit) throw new RouteError(404, "NOT_FOUND", "Auditoría externa no encontrada.");
  const findings = await findingDelegate(prisma).findMany({
    where: { auditId: id }, orderBy: { createdAt: "asc" },
  });
  return { ...audit, findings };
}

async function generateAuditCode(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, tenantId: string, vesselCode: string): Promise<string> {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const count = await auditDelegate(prisma).count({
    where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
  });
  return `EXT-${vesselCode}-${yy}-${String(count + 1).padStart(4, "0")}`;
}

export async function createExternalAudit(session: TenantAccessSession, input: CreateExternalAuditInput) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normReq(input.vesselCode, "vesselCode").toUpperCase();
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
  }
  const auditType = parseEnum(input.auditType, AUDIT_TYPES, "auditType");
  const auditDate = parseDate(input.auditDate, "auditDate");
  const auditCode = await generateAuditCode(prisma, tenantId, vesselCode);

  const created = await auditDelegate(prisma).create({
    data: {
      tenantId, vesselCode, auditCode, auditType, auditDate,
      port:              normOpt(input.port),
      country:           normOpt(input.country),
      agencyOrAuthority: normOpt(input.agencyOrAuthority),
      inspectorName:     normOpt(input.inspectorName),
      durationHours:     input.durationHours ?? null,
      overallResult:     normOpt(input.overallResult),
      summary:           normOpt(input.summary),
      scoreOrRating:     normOpt(input.scoreOrRating),
      reportUrl:         normOpt(input.reportUrl),
      createdByUserId:   session.user.id,
      updatedByUserId:   session.user.id,
    },
  });
  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id,
    action: "ExternalAudit.created", entityType: "ExternalAudit",
    entityId: (created as { id: string }).id,
    metadata: { auditCode, vesselCode, auditType },
  });
  return created;
}

export async function updateExternalAudit(session: TenantAccessSession, id: string, input: UpdateExternalAuditInput) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const current = await getExternalAudit(session, id);
  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.auditType !== undefined) data.auditType = parseEnum(input.auditType, AUDIT_TYPES, "auditType");
  if (input.auditDate !== undefined) data.auditDate = parseDate(input.auditDate, "auditDate");
  if (input.port !== undefined) data.port = normOpt(input.port);
  if (input.country !== undefined) data.country = normOpt(input.country);
  if (input.agencyOrAuthority !== undefined) data.agencyOrAuthority = normOpt(input.agencyOrAuthority);
  if (input.inspectorName !== undefined) data.inspectorName = normOpt(input.inspectorName);
  if (input.durationHours !== undefined) data.durationHours = input.durationHours;
  if (input.overallResult !== undefined) data.overallResult = normOpt(input.overallResult);
  if (input.summary !== undefined) data.summary = normOpt(input.summary);
  if (input.scoreOrRating !== undefined) data.scoreOrRating = normOpt(input.scoreOrRating);
  if (input.reportUrl !== undefined) data.reportUrl = normOpt(input.reportUrl);
  const updated = await auditDelegate(prisma).update({ where: { id }, data });
  void publishAudit(prisma, {
    tenantId: (current as unknown as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "ExternalAudit.updated", entityType: "ExternalAudit", entityId: id,
    metadata: { auditCode: (current as unknown as { auditCode: string }).auditCode },
  });
  return updated;
}

export async function softDeleteExternalAudit(session: TenantAccessSession, id: string) {
  if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede eliminar auditorías.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const current = await getExternalAudit(session, id);
  await auditDelegate(prisma).update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId: (current as unknown as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "ExternalAudit.deleted", entityType: "ExternalAudit", entityId: id,
    metadata: { auditCode: (current as unknown as { auditCode: string }).auditCode },
  });
}

// ─── Findings ───────────────────────────────────────────────────────────────

export async function createFinding(session: TenantAccessSession, auditId: string, input: CreateFindingInput) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const audit = await getExternalAudit(session, auditId) as unknown as { id: string; tenantId: string; vesselCode: string };
  const findingType = parseEnum(input.findingType, FINDING_TYPES, "findingType");
  const created = await findingDelegate(prisma).create({
    data: {
      tenantId:              audit.tenantId,
      auditId:               audit.id,
      vesselCode:            audit.vesselCode,
      findingCode:           normOpt(input.findingCode),
      findingType,
      category:              normOpt(input.category),
      description:           normReq(input.description, "description"),
      severity:              normOpt(input.severity),
      detentionRelated:      !!input.detentionRelated,
      rectificationDeadline: parseOptDate(input.rectificationDeadline, "rectificationDeadline"),
      createdByUserId:       session.user.id,
      updatedByUserId:       session.user.id,
    },
  });
  return created;
}

export async function updateFinding(session: TenantAccessSession, auditId: string, findingId: string, input: UpdateFindingInput) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  // Verifica acceso al audit
  await getExternalAudit(session, auditId);
  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.findingCode !== undefined) data.findingCode = normOpt(input.findingCode);
  if (input.findingType !== undefined) data.findingType = parseEnum(input.findingType, FINDING_TYPES, "findingType");
  if (input.category !== undefined) data.category = normOpt(input.category);
  if (input.description !== undefined) data.description = normReq(input.description, "description");
  if (input.severity !== undefined) data.severity = normOpt(input.severity);
  if (input.detentionRelated !== undefined) data.detentionRelated = !!input.detentionRelated;
  if (input.rectificationDeadline !== undefined) data.rectificationDeadline = parseOptDate(input.rectificationDeadline, "rectificationDeadline");
  if (input.status !== undefined) data.status = parseEnum(input.status, FINDING_STATUSES, "status");
  if (input.clearingDate !== undefined) data.clearingDate = parseOptDate(input.clearingDate, "clearingDate");
  if (input.evidenceNotes !== undefined) data.evidenceNotes = normOpt(input.evidenceNotes);
  if (input.evidenceDocUrl !== undefined) data.evidenceDocUrl = normOpt(input.evidenceDocUrl);
  return findingDelegate(prisma).update({ where: { id: findingId }, data });
}

export async function deleteFinding(session: TenantAccessSession, auditId: string, findingId: string) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  await getExternalAudit(session, auditId);
  await (prisma as unknown as { externalAuditFinding: { delete(a: unknown): Promise<unknown> } })
    .externalAuditFinding.delete({ where: { id: findingId } });
}
