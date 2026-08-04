import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface TaskMasterListFilters {
  taskType?: string | null;
  triggerType?: string | null;
  status?: string | null;
}

export interface CreateTaskMasterInput {
  code: string;
  title: string;
  taskType: "MAINTENANCE" | "INSPECTION";
  triggerType: "HOURS" | "MONTHS" | "CONDITION" | "EVENT" | "CALENDAR" | "RUNNING_HOURS";
  triggerResultMode?: "DUE_ONLY" | "AUTO_WO" | "APPROVAL_WO";
  frequencyDays?: number | null;
  frequencyHours?: number | null;
  estimatedHours?: number | null;
  procedure?: string | null;
  procedureReference?: string | null;
  acceptanceCriteria?: string | null;
  evidenceRequired?: boolean;
  status?: string;
}

export interface UpdateTaskMasterInput {
  code?: string;
  title?: string;
  taskType?: "MAINTENANCE" | "INSPECTION";
  triggerType?: "HOURS" | "MONTHS" | "CONDITION" | "EVENT" | "CALENDAR" | "RUNNING_HOURS";
  triggerResultMode?: "DUE_ONLY" | "AUTO_WO" | "APPROVAL_WO";
  frequencyDays?: number | null;
  frequencyHours?: number | null;
  estimatedHours?: number | null;
  procedure?: string | null;
  procedureReference?: string | null;
  acceptanceCriteria?: string | null;
  evidenceRequired?: boolean;
  status?: string;
}

interface TaskMasterRecord {
  id: string;
  tenantId: string | null;
  code: string;
  title: string;
  taskType: string;
  triggerType: string;
  triggerResultMode: string;
  frequencyDays: number | null;
  frequencyHours: number | null;
  estimatedHours: number | null;
  procedure: string | null;
  procedureReference: string | null;
  acceptanceCriteria: string | null;
  evidenceRequired: boolean;
  isGlobal: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

type TaskMasterDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<TaskMasterRecord[]>;
  findUnique(args: { where: { id: string } }): Promise<TaskMasterRecord | null>;
  findFirst(args: { where: Record<string, unknown> }): Promise<TaskMasterRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<TaskMasterRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<TaskMasterRecord>;
};

interface TaskMastersPrismaClient {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  taskMaster: TaskMasterDelegate;
}

function taskMastersClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): TaskMastersPrismaClient {
  return prisma as unknown as TaskMastersPrismaClient;
}

function canWriteTaskMasters(session: TenantAccessSession): boolean {
  return session.user.role === "TENANT_ADMIN" || session.user.role === "FLEET_SUPERINTENDENT" || session.user.role === "MAINTENANCE_MANAGER";
}

function ensureCanWriteTaskMasters(session: TenantAccessSession) {
  if (!canWriteTaskMasters(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para modificar task masters.");
  }
}

function normalizeRequiredText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeOptionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new RouteError(400, "VALIDATION_ERROR", `Valor numérico inválido en ${field}.`);
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = taskMastersClient(prismaRaw);
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

async function getTenantIdOrThrow(session: TenantAccessSession): Promise<string> {
  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenantId;
}

export async function listTaskMasters(session: TenantAccessSession, filters: TaskMasterListFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return [];
  const prisma = taskMastersClient(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = {
    OR: [{ tenantId: null }, { tenantId }],
  };
  if (filters.taskType) where.taskType = filters.taskType;
  if (filters.triggerType) where.triggerType = filters.triggerType;
  if (filters.status) where.status = filters.status;

  return prisma.taskMaster.findMany({
    where,
    orderBy: [{ isGlobal: "desc" }, { code: "asc" }],
  });
}

export async function getTaskMaster(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = taskMastersClient(prismaRaw);

  // Mismo alcance que listTaskMasters: los propios del tenant más los globales
  // (tenantId null). Sin este filtro, el GET devolvía el task master privado de
  // cualquier otra empresa —procedimiento y criterios de aceptación incluidos—
  // con sólo conocer el id. El PATCH ya validaba; el GET había quedado afuera.
  const tenantId = await getTenantIdOrThrow(session);
  const record = await prisma.taskMaster.findFirst({
    where: { id, OR: [{ tenantId: null }, { tenantId }] },
  });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Task master no encontrado.");
  return record;
}

export async function createTaskMaster(session: TenantAccessSession, payload: CreateTaskMasterInput) {
  ensureCanWriteTaskMasters(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = taskMastersClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const code = normalizeRequiredText(payload.code, "code").toUpperCase();
  const duplicated = await prisma.taskMaster.findFirst({ where: { tenantId, code } });
  if (duplicated) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un task master con código ${code}.`);

  return prisma.taskMaster.create({
    data: {
      tenantId,
      code,
      title: normalizeRequiredText(payload.title, "title"),
      taskType: payload.taskType,
      triggerType: payload.triggerType,
      triggerResultMode: payload.triggerResultMode ?? "DUE_ONLY",
      frequencyDays: normalizeOptionalNumber(payload.frequencyDays, "frequencyDays"),
      frequencyHours: normalizeOptionalNumber(payload.frequencyHours, "frequencyHours"),
      estimatedHours: normalizeOptionalNumber(payload.estimatedHours, "estimatedHours"),
      procedure: normalizeOptionalText(payload.procedure),
      procedureReference: normalizeOptionalText(payload.procedureReference),
      acceptanceCriteria: normalizeOptionalText(payload.acceptanceCriteria),
      evidenceRequired: Boolean(payload.evidenceRequired),
      isGlobal: false,
      status: normalizeOptionalText(payload.status) ?? "ACTIVE",
    },
  });
}

export async function updateTaskMaster(session: TenantAccessSession, id: string, payload: UpdateTaskMasterInput) {
  ensureCanWriteTaskMasters(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = taskMastersClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const current = await prisma.taskMaster.findUnique({ where: { id } });
  if (!current) throw new RouteError(404, "NOT_FOUND", "Task master no encontrado.");
  if (current.tenantId === null) {
    throw new RouteError(403, "GLOBAL_TASK_MASTER_READONLY", "No se puede editar un task master global.");
  }
  if (current.tenantId !== tenantId) throw new RouteError(404, "NOT_FOUND", "Task master no encontrado.");

  if (payload.code !== undefined) {
    const nextCode = normalizeRequiredText(payload.code, "code").toUpperCase();
    if (nextCode !== current.code) {
      const duplicated = await prisma.taskMaster.findFirst({
        where: { tenantId, code: nextCode },
      });
      if (duplicated) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un task master con código ${nextCode}.`);
    }
  }

  const data: Record<string, unknown> = {};
  if (payload.code !== undefined) data.code = normalizeRequiredText(payload.code, "code").toUpperCase();
  if (payload.title !== undefined) data.title = normalizeRequiredText(payload.title, "title");
  if (payload.taskType !== undefined) data.taskType = payload.taskType;
  if (payload.triggerType !== undefined) data.triggerType = payload.triggerType;
  if (payload.triggerResultMode !== undefined) data.triggerResultMode = payload.triggerResultMode;
  if (payload.frequencyDays !== undefined) data.frequencyDays = normalizeOptionalNumber(payload.frequencyDays, "frequencyDays");
  if (payload.frequencyHours !== undefined) data.frequencyHours = normalizeOptionalNumber(payload.frequencyHours, "frequencyHours");
  if (payload.estimatedHours !== undefined) data.estimatedHours = normalizeOptionalNumber(payload.estimatedHours, "estimatedHours");
  if (payload.procedure !== undefined) data.procedure = normalizeOptionalText(payload.procedure);
  if (payload.procedureReference !== undefined) data.procedureReference = normalizeOptionalText(payload.procedureReference);
  if (payload.acceptanceCriteria !== undefined) data.acceptanceCriteria = normalizeOptionalText(payload.acceptanceCriteria);
  if (payload.evidenceRequired !== undefined) data.evidenceRequired = Boolean(payload.evidenceRequired);
  if (payload.status !== undefined) data.status = normalizeRequiredText(payload.status, "status");

  return prisma.taskMaster.update({ where: { id: current.id }, data });
}
