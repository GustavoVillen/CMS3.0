import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { assertCanReopen, assertReopenReason } from "../../common/record-lock";

// Días antes del vencimiento en los que la matriz marca DUE_SOON
const DUE_SOON_THRESHOLD_DAYS = 14;

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface DrillListFilters {
  vesselCode?: string | null;
  status?: string | null;
  requirementId?: string | null;
}

export interface DrillWriteInput {
  vesselCode?: string;
  drillCode?: string;
  requirementId?: string;
  scheduledDate?: string;
  scheduledTime?: string | null;
  completedDate?: string | null;
  completedTime?: string | null;
  scenario?: string | null;
  observations?: string | null;
  lessonsLearned?: string | null;
  participantCrewIds?: string[];
}

export interface CompleteDrillInput {
  completedDate?: string;
  completedTime?: string | null;
  observations?: string | null;
  lessonsLearned?: string | null;
  participantCrewIds?: string[];
}

export interface DrillRequirementInput {
  title?: string;
  solasRegulation?: string | null;
  frequencyDays?: number;
  intervalLabel?: string | null;
  performedBy?: string[];
  applicableVesselCodes?: string[];
  notes?: string | null;
  enabled?: boolean;
  sortOrder?: number;
}

export interface DrillMatrixCell {
  vesselCode: string;
  requirementId: string;
  requirementTitle: string;
  solasRegulation: string | null;
  intervalLabel: string | null;
  frequencyDays: number;
  lastCompletedDate: string | null;
  lastDrillId: string | null;
  nextDueDate: string | null;
  daysUntilDue: number | null;
  status: "NEVER" | "OVERDUE" | "DUE_SOON" | "OK";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function canManage(session: TenantAccessSession): boolean {
  return hasPermission(session, "drill.manage");
}

function ensureCanManage(session: TenantAccessSession) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar simulacros.");
}

function normalizeRequired(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}

function normalizeOptional(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function parseDate(value: unknown, field: string): Date {
  if (!value) throw new RouteError(400, "VALIDATION_ERROR", `${field} es requerido.`);
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `${field} no es una fecha válida.`);
  return d;
}

// Hora "HH:mm" (24h). Devuelve null si viene vacía; valida formato.
function normalizeTime(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    throw new RouteError(400, "VALIDATION_ERROR", "scheduledTime debe tener formato HH:mm (00:00–23:59).");
  }
  return text;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(v => String(v ?? "").trim()).filter(Boolean);
}

function parseFrequencyDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 3650 || Math.floor(n) !== n) {
    throw new RouteError(400, "VALIDATION_ERROR", "frequencyDays debe ser entero entre 1 y 3650.");
  }
  return n;
}

// ─── Delegates loose (Prisma client) ─────────────────────────────────────────

type DrillClient = {
  drill: {
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }): Promise<Record<string, unknown>[]>;
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
};

type RequirementClient = {
  drillRequirement: {
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<DrillRequirementRow[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<DrillRequirementRow | null>;
    findUnique(args: { where: Record<string, unknown> }): Promise<DrillRequirementRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<DrillRequirementRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<DrillRequirementRow>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
};

interface DrillRequirementRow {
  id: string;
  tenantId: string;
  title: string;
  solasRegulation: string | null;
  frequencyDays: number;
  intervalLabel: string | null;
  performedBy: unknown;
  applicableVesselCodes: unknown;
  notes: string | null;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function drillClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): DrillClient {
  return prisma as unknown as DrillClient;
}

function reqClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): RequirementClient {
  return prisma as unknown as RequirementClient;
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v));
  return [];
}

// Carga requirements habilitados aplicables a un vessel (vacío en
// applicableVesselCodes = aplica a toda la flota).
async function loadActiveRequirementsForVessel(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  vesselCode: string,
): Promise<DrillRequirementRow[]> {
  const all = await reqClient(prisma).drillRequirement.findMany({
    where: { tenantId, enabled: true, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });
  return all.filter(r => {
    const scope = jsonArray(r.applicableVesselCodes);
    return scope.length === 0 || scope.includes(vesselCode);
  });
}

async function assertRequirementBelongsToTenant(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  requirementId: string,
): Promise<DrillRequirementRow> {
  const req = await reqClient(prisma).drillRequirement.findFirst({
    where: { id: requirementId, tenantId, deletedAt: null },
  });
  if (!req) throw new RouteError(404, "NOT_FOUND", "Requisito de simulacro no encontrado.");
  if (!req.enabled) throw new RouteError(409, "REQUIREMENT_DISABLED", "El requisito de simulacro está deshabilitado.");
  return req;
}

// ─── DrillRequirement CRUD ───────────────────────────────────────────────────

export async function listDrillRequirements(session: TenantAccessSession) {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [] as DrillRequirementRow[] };
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const items = await reqClient(prisma).drillRequirement.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });
  return {
    items: items.map(r => ({
      ...r,
      performedBy: jsonArray(r.performedBy),
      applicableVesselCodes: jsonArray(r.applicableVesselCodes),
    })),
  };
}

export async function createDrillRequirement(session: TenantAccessSession, input: DrillRequirementInput) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const title = normalizeRequired(input.title, "title");
  const frequencyDays = parseFrequencyDays(input.frequencyDays);

  const dup = await reqClient(prisma).drillRequirement.findFirst({
    where: { tenantId: tenant.id, title, deletedAt: null },
  });
  if (dup) throw new RouteError(409, "DUPLICATE_TITLE", `Ya existe un requisito con título "${title}".`);

  const row = await reqClient(prisma).drillRequirement.create({
    data: {
      tenantId: tenant.id,
      title,
      solasRegulation: normalizeOptional(input.solasRegulation),
      frequencyDays,
      intervalLabel: normalizeOptional(input.intervalLabel),
      performedBy: parseStringArray(input.performedBy),
      applicableVesselCodes: parseStringArray(input.applicableVesselCodes).map(s => s.toUpperCase()),
      notes: normalizeOptional(input.notes),
      enabled: input.enabled ?? true,
      sortOrder: typeof input.sortOrder === "number" ? input.sortOrder : 0,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "DrillRequirement.created",
    entityType: "DrillRequirement",
    entityId: row.id,
    metadata: { title, frequencyDays },
  });
  return row;
}

export async function updateDrillRequirement(session: TenantAccessSession, id: string, input: DrillRequirementInput) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const current = await reqClient(prisma).drillRequirement.findFirst({
    where: { id, tenantId: tenant.id, deletedAt: null },
  });
  if (!current) throw new RouteError(404, "NOT_FOUND", "Requisito de simulacro no encontrado.");

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.title !== undefined) {
    const title = normalizeRequired(input.title, "title");
    if (title !== current.title) {
      const dup = await reqClient(prisma).drillRequirement.findFirst({
        where: { tenantId: tenant.id, title, deletedAt: null, NOT: { id } },
      });
      if (dup) throw new RouteError(409, "DUPLICATE_TITLE", `Ya existe un requisito con título "${title}".`);
    }
    data.title = title;
  }
  if (input.solasRegulation !== undefined) data.solasRegulation = normalizeOptional(input.solasRegulation);
  if (input.frequencyDays !== undefined) data.frequencyDays = parseFrequencyDays(input.frequencyDays);
  if (input.intervalLabel !== undefined) data.intervalLabel = normalizeOptional(input.intervalLabel);
  if (input.performedBy !== undefined) data.performedBy = parseStringArray(input.performedBy);
  if (input.applicableVesselCodes !== undefined) data.applicableVesselCodes = parseStringArray(input.applicableVesselCodes).map(s => s.toUpperCase());
  if (input.notes !== undefined) data.notes = normalizeOptional(input.notes);
  if (input.enabled !== undefined) data.enabled = Boolean(input.enabled);
  if (input.sortOrder !== undefined) data.sortOrder = Number(input.sortOrder);

  const row = await reqClient(prisma).drillRequirement.update({ where: { id }, data });

  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "DrillRequirement.updated",
    entityType: "DrillRequirement",
    entityId: id,
    metadata: { title: row.title },
  });
  return row;
}

export async function deleteDrillRequirement(session: TenantAccessSession, id: string) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede eliminar requisitos de simulacro.");
  }
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const current = await reqClient(prisma).drillRequirement.findFirst({
    where: { id, tenantId: tenant.id, deletedAt: null },
  });
  if (!current) throw new RouteError(404, "NOT_FOUND", "Requisito de simulacro no encontrado.");

  // Si tiene drills asociados, soft-delete (deshabilita y marca borrado);
  // si no tiene, también soft-delete por consistencia.
  await reqClient(prisma).drillRequirement.update({
    where: { id },
    data: { deletedAt: new Date(), enabled: false, updatedByUserId: session.user.id },
  });

  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "DrillRequirement.deleted",
    entityType: "DrillRequirement",
    entityId: id,
    metadata: { title: current.title },
  });
}

// ─── Drill CRUD ──────────────────────────────────────────────────────────────

export async function listDrills(session: TenantAccessSession, filters: DrillListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return [];

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.requirementId) where.requirementId = filters.requirementId;

  return drillClient(prisma).drill.findMany({
    where,
    orderBy: [{ scheduledDate: "desc" }],
    include: { requirement: true },
  });
}

export async function getDrill(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const row = await drillClient(prisma).drill.findFirst({
    where: { id, tenantId: tenant.id, deletedAt: null },
    include: { requirement: true },
  });
  if (!row) throw new RouteError(404, "NOT_FOUND", "Simulacro no encontrado.");

  if (session.user.role !== "TENANT_ADMIN") {
    const vesselCode = (row as { vesselCode: string }).vesselCode;
    if (!session.user.assignedVesselCodes.includes(vesselCode)) {
      throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel de este simulacro.");
    }
  }
  return row;
}

async function generateDrillCode(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, tenantId: string, vesselCode: string): Promise<string> {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const count = await drillClient(prisma).drill.count({
    where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
  });
  return `DRL-${vesselCode}-${yy}-${String(count + 1).padStart(4, "0")}`;
}

export async function createDrill(session: TenantAccessSession, input: DrillWriteInput) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const vesselCode = normalizeRequired(input.vesselCode, "vesselCode").toUpperCase();
  const requirementId = normalizeRequired(input.requirementId, "requirementId");
  const requirement = await assertRequirementBelongsToTenant(prisma, tenant.id, requirementId);

  // Validar que el requirement aplica al vessel
  const scope = jsonArray(requirement.applicableVesselCodes);
  if (scope.length > 0 && !scope.includes(vesselCode)) {
    throw new RouteError(409, "REQUIREMENT_NOT_APPLICABLE", `El requisito "${requirement.title}" no aplica al buque ${vesselCode}.`);
  }

  const scheduledDate = parseDate(input.scheduledDate, "scheduledDate");

  const code = input.drillCode
    ? normalizeRequired(input.drillCode, "drillCode").toUpperCase()
    : await generateDrillCode(prisma, tenant.id, vesselCode);

  const existing = await drillClient(prisma).drill.findFirst({
    where: { tenantId: tenant.id, vesselCode, drillCode: code, deletedAt: null },
  });
  if (existing) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un simulacro con código ${code}.`);

  // Si viene fecha de realización al crear, el simulacro se registra como ya
  // realizado (COMPLETED); si no, queda programado (SCHEDULED).
  const completedDate = input.completedDate ? parseDate(input.completedDate, "completedDate") : null;

  const created = await drillClient(prisma).drill.create({
    data: {
      tenantId: tenant.id,
      vesselCode,
      drillCode: code,
      requirementId,
      status: completedDate ? "COMPLETED" : "SCHEDULED",
      scheduledDate,
      scheduledTime: normalizeTime(input.scheduledTime),
      completedDate,
      completedTime: normalizeTime(input.completedTime),
      scenario: normalizeOptional(input.scenario),
      observations: normalizeOptional(input.observations),
      lessonsLearned: normalizeOptional(input.lessonsLearned),
      participantCrewIds: parseStringArray(input.participantCrewIds),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "Drill.created",
    entityType: "Drill",
    entityId: created.id as string,
    metadata: { drillCode: code, vesselCode, requirementId, requirementTitle: requirement.title, scheduledDate: scheduledDate.toISOString() },
  });

  return created;
}

export async function updateDrill(session: TenantAccessSession, id: string, input: DrillWriteInput) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getDrill(session, id);
  const status = (current as { status: string }).status;
  if (status === "COMPLETED" || status === "CANCELLED") {
    throw new RouteError(409, "RECORD_LOCKED", `Este simulacro está ${status}. Sólo un administrador puede re-abrirlo con justificación.`);
  }

  const tenantId = (current as { tenantId: string }).tenantId;
  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.requirementId !== undefined) {
    const requirementId = normalizeRequired(input.requirementId, "requirementId");
    await assertRequirementBelongsToTenant(prisma, tenantId, requirementId);
    data.requirementId = requirementId;
  }
  if (input.scheduledDate !== undefined) data.scheduledDate = parseDate(input.scheduledDate, "scheduledDate");
  if (input.scheduledTime !== undefined) data.scheduledTime = normalizeTime(input.scheduledTime);
  // Cargar fecha de realización en un simulacro programado lo marca como realizado.
  if (input.completedDate !== undefined) {
    const cd = input.completedDate ? parseDate(input.completedDate, "completedDate") : null;
    data.completedDate = cd;
    if (cd) data.status = "COMPLETED";
  }
  if (input.completedTime !== undefined) data.completedTime = normalizeTime(input.completedTime);
  if (input.scenario !== undefined) data.scenario = normalizeOptional(input.scenario);
  if (input.observations !== undefined) data.observations = normalizeOptional(input.observations);
  if (input.lessonsLearned !== undefined) data.lessonsLearned = normalizeOptional(input.lessonsLearned);
  if (input.participantCrewIds !== undefined) data.participantCrewIds = parseStringArray(input.participantCrewIds);

  const updated = await drillClient(prisma).drill.update({ where: { id }, data });

  void publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "Drill.updated",
    entityType: "Drill",
    entityId: id,
    metadata: { drillCode: (current as { drillCode: string }).drillCode },
  });

  return updated;
}

export async function completeDrill(session: TenantAccessSession, id: string, input: CompleteDrillInput) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getDrill(session, id);
  if ((current as { status: string }).status !== "SCHEDULED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo simulacros SCHEDULED pueden completarse (actual: ${(current as { status: string }).status}).`);
  }

  const completedDate = input.completedDate ? parseDate(input.completedDate, "completedDate") : new Date();

  const data: Record<string, unknown> = {
    status: "COMPLETED",
    completedDate,
    completedTime: normalizeTime(input.completedTime),
    updatedByUserId: session.user.id,
  };
  if (input.observations !== undefined) data.observations = normalizeOptional(input.observations);
  if (input.lessonsLearned !== undefined) data.lessonsLearned = normalizeOptional(input.lessonsLearned);
  if (input.participantCrewIds !== undefined) data.participantCrewIds = parseStringArray(input.participantCrewIds);

  const updated = await drillClient(prisma).drill.update({ where: { id }, data });

  void publishAudit(prisma, {
    tenantId: (current as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "Drill.completed",
    entityType: "Drill",
    entityId: id,
    metadata: {
      drillCode: (current as { drillCode: string }).drillCode,
      vesselCode: (current as { vesselCode: string }).vesselCode,
      completedDate: completedDate.toISOString(),
    },
  });

  return updated;
}

export async function cancelDrill(session: TenantAccessSession, id: string, payload: { reason: string }) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getDrill(session, id);
  if ((current as { status: string }).status !== "SCHEDULED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", "Solo simulacros SCHEDULED pueden cancelarse.");
  }

  const reason = String(payload?.reason ?? "").trim();
  if (!reason) throw new RouteError(400, "VALIDATION_ERROR", "El motivo de cancelación es requerido.");

  const updated = await drillClient(prisma).drill.update({
    where: { id },
    data: {
      status: "CANCELLED",
      observations: `[CANCELLED] ${reason}`,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: (current as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "Drill.cancelled",
    entityType: "Drill",
    entityId: id,
    metadata: { drillCode: (current as { drillCode: string }).drillCode, reason },
  });

  return updated;
}

export async function reopenDrill(session: TenantAccessSession, id: string, payload: { reason: string }) {
  assertCanReopen(session.user.role);
  const reason = assertReopenReason(payload?.reason);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getDrill(session, id);
  const status = (current as { status: string }).status;
  if (status !== "COMPLETED" && status !== "CANCELLED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo simulacros COMPLETED o CANCELLED pueden re-abrirse (actual: ${status}).`);
  }

  const now = new Date();
  const reopened = await drillClient(prisma).drill.update({
    where: { id },
    data: {
      status: "SCHEDULED",
      completedDate: null,
      reopenCount: { increment: 1 },
      lastReopenAt: now,
      lastReopenReason: reason,
      lastReopenByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: (current as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "Drill.reopened",
    entityType: "Drill",
    entityId: id,
    metadata: { drillCode: (current as { drillCode: string }).drillCode, previousStatus: status, reason },
  });

  return reopened;
}

// ─── Matriz de cumplimiento ──────────────────────────────────────────────────

/**
 * Matriz de cumplimiento: por cada (vessel, requirement aplicable) calcula
 * último COMPLETED, próximo vencimiento según requirement.frequencyDays y estado.
 *
 *  - NEVER     : nunca se completó un simulacro de ese requirement en el vessel
 *  - OVERDUE   : la fecha de próximo vencimiento ya pasó
 *  - DUE_SOON  : faltan ≤ DUE_SOON_THRESHOLD_DAYS para el vencimiento
 *  - OK        : todavía en plazo
 */
export async function getDrillsMatrix(session: TenantAccessSession, filters: { vesselCode?: string | null } = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return { cells: [] as DrillMatrixCell[] };

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return { cells: [] as DrillMatrixCell[] };

  const vesselWhere: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN") {
    if (session.user.assignedVesselCodes.length === 0) return { cells: [] as DrillMatrixCell[] };
    vesselWhere.code = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) vesselWhere.code = filters.vesselCode;

  const vessels = await (prisma as unknown as {
    vessel: { findMany(a: { where: Record<string, unknown>; orderBy?: unknown }): Promise<{ code: string }[]> };
  }).vessel.findMany({ where: vesselWhere, orderBy: { code: "asc" } });
  if (vessels.length === 0) return { cells: [] as DrillMatrixCell[] };

  // Trae todos los requirements habilitados del tenant
  const allReqs = await reqClient(prisma).drillRequirement.findMany({
    where: { tenantId: tenant.id, enabled: true, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });

  // Trae todos los drills COMPLETED del tenant (filtrados por vessels en scope)
  const drills = await drillClient(prisma).drill.findMany({
    where: {
      tenantId: tenant.id,
      status: "COMPLETED",
      deletedAt: null,
      vesselCode: { in: vessels.map(v => v.code) },
    },
    orderBy: { completedDate: "desc" },
  }) as Array<{ id: string; vesselCode: string; requirementId: string; completedDate: Date | null }>;

  // Mapa (vesselCode|requirementId) → drill más reciente
  const latest = new Map<string, { id: string; completedDate: Date | null }>();
  for (const d of drills) {
    const k = `${d.vesselCode}|${d.requirementId}`;
    if (!latest.has(k) && d.completedDate) latest.set(k, { id: d.id, completedDate: d.completedDate });
  }

  const now = new Date();
  const MS_PER_DAY = 86_400_000;
  const cells: DrillMatrixCell[] = [];

  for (const v of vessels) {
    for (const req of allReqs) {
      // Aplicabilidad por vessel
      const scope = jsonArray(req.applicableVesselCodes);
      if (scope.length > 0 && !scope.includes(v.code)) continue;

      const found = latest.get(`${v.code}|${req.id}`);
      if (!found || !found.completedDate) {
        cells.push({
          vesselCode: v.code,
          requirementId: req.id,
          requirementTitle: req.title,
          solasRegulation: req.solasRegulation,
          intervalLabel: req.intervalLabel,
          frequencyDays: req.frequencyDays,
          lastCompletedDate: null,
          lastDrillId: null,
          nextDueDate: null,
          daysUntilDue: null,
          status: "NEVER",
        });
        continue;
      }
      const nextDue = new Date(found.completedDate.getTime() + req.frequencyDays * MS_PER_DAY);
      const daysUntilDue = Math.ceil((nextDue.getTime() - now.getTime()) / MS_PER_DAY);
      const status: DrillMatrixCell["status"] =
        daysUntilDue < 0 ? "OVERDUE" :
        daysUntilDue <= DUE_SOON_THRESHOLD_DAYS ? "DUE_SOON" :
        "OK";
      cells.push({
        vesselCode: v.code,
        requirementId: req.id,
        requirementTitle: req.title,
        solasRegulation: req.solasRegulation,
        intervalLabel: req.intervalLabel,
        frequencyDays: req.frequencyDays,
        lastCompletedDate: found.completedDate.toISOString(),
        lastDrillId: found.id,
        nextDueDate: nextDue.toISOString(),
        daysUntilDue,
        status,
      });
    }
  }

  return { cells };
}

export async function deleteDrill(session: TenantAccessSession, id: string) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede eliminar simulacros.");
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getDrill(session, id);
  await drillClient(prisma).drill.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });

  void publishAudit(prisma, {
    tenantId: (current as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "Drill.deleted",
    entityType: "Drill",
    entityId: id,
    metadata: { drillCode: (current as { drillCode: string }).drillCode },
  });
}

// Helper público: número de requirements aplicables a un vessel (usado por
// compliance-service para cálculo de drillCompliance).
export async function countActiveRequirementsForVessel(
  tenantId: string,
  vesselCode: string,
): Promise<number> {
  const prisma = getPrismaClient();
  if (!prisma) return 0;
  const reqs = await loadActiveRequirementsForVessel(prisma, tenantId, vesselCode);
  return reqs.length;
}
