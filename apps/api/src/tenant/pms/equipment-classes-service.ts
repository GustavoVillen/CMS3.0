import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface EquipmentClassesFilters {
  status?: string | null;
}

export interface CreateEquipmentClassInput {
  code: string;
  name: string;
  description?: string | null;
  defaultSfiCode?: string | null;
  defaultCriticality?: "A" | "B" | "C" | null;
  status?: string;
}

export interface UpdateEquipmentClassInput {
  code?: string;
  name?: string;
  description?: string | null;
  defaultSfiCode?: string | null;
  defaultCriticality?: "A" | "B" | "C" | null;
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

interface ClassTaskTemplateRecord {
  id: string;
  equipmentClassId: string;
  taskMasterId: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  taskMaster?: TaskMasterRecord;
}

interface EquipmentClassRecord {
  id: string;
  tenantId: string | null;
  code: string;
  name: string;
  description: string | null;
  defaultSfiCode: string | null;
  defaultCriticality: string | null;
  isGlobal: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  taskTemplates?: ClassTaskTemplateRecord[];
}

type EquipmentClassDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<EquipmentClassRecord[]>;
  findUnique(args: { where: { id: string }; include?: Record<string, unknown> }): Promise<EquipmentClassRecord | null>;
  findFirst(args: { where: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: unknown }): Promise<EquipmentClassRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<EquipmentClassRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<EquipmentClassRecord>;
};

interface EquipmentClassesPrismaClient {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  equipmentClass: EquipmentClassDelegate;
}

function equipmentClassesClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): EquipmentClassesPrismaClient {
  return prisma as unknown as EquipmentClassesPrismaClient;
}

function ensureTenantAdmin(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede modificar equipment classes.");
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

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = equipmentClassesClient(prismaRaw);
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

async function getTenantIdOrThrow(session: TenantAccessSession): Promise<string> {
  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenantId;
}

export async function listEquipmentClasses(session: TenantAccessSession, filters: EquipmentClassesFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return [];
  const prisma = equipmentClassesClient(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = {
    OR: [{ tenantId: null }, { tenantId }],
  };
  if (filters.status) where.status = filters.status;

  return prisma.equipmentClass.findMany({
    where,
    orderBy: [{ isGlobal: "desc" }, { code: "asc" }],
  });
}

export async function getEquipmentClass(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = equipmentClassesClient(prismaRaw);

  const tenantId = await resolveTenantId(session);

  const record = await prisma.equipmentClass.findFirst({
    where: {
      id,
      OR: [{ tenantId: null }, { tenantId: tenantId ?? "__NO_TENANT__" }],
    },
    include: {
      taskTemplates: {
        include: { taskMaster: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Equipment class no encontrada.");
  return record;
}

export async function createEquipmentClass(session: TenantAccessSession, payload: CreateEquipmentClassInput) {
  ensureTenantAdmin(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = equipmentClassesClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const code = normalizeRequiredText(payload.code, "code").toUpperCase();
  const existing = await prisma.equipmentClass.findFirst({ where: { tenantId, code } });
  if (existing) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe una equipment class con codigo ${code}.`);

  return prisma.equipmentClass.create({
    data: {
      tenantId,
      code,
      name: normalizeRequiredText(payload.name, "name"),
      description: normalizeOptionalText(payload.description),
      defaultSfiCode: normalizeOptionalText(payload.defaultSfiCode),
      defaultCriticality: payload.defaultCriticality ?? null,
      isGlobal: false,
      status: normalizeOptionalText(payload.status) ?? "ACTIVE",
    },
  });
}

export async function updateEquipmentClass(
  session: TenantAccessSession,
  id: string,
  payload: UpdateEquipmentClassInput,
) {
  ensureTenantAdmin(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = equipmentClassesClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const current = await prisma.equipmentClass.findUnique({ where: { id } });
  if (!current) throw new RouteError(404, "NOT_FOUND", "Equipment class no encontrada.");
  if (current.tenantId === null) {
    throw new RouteError(403, "GLOBAL_EQUIPMENT_CLASS_READONLY", "No se puede editar una equipment class global.");
  }
  if (current.tenantId !== tenantId) throw new RouteError(404, "NOT_FOUND", "Equipment class no encontrada.");

  if (payload.code !== undefined) {
    const nextCode = normalizeRequiredText(payload.code, "code").toUpperCase();
    if (nextCode !== current.code) {
      const duplicated = await prisma.equipmentClass.findFirst({ where: { tenantId, code: nextCode } });
      if (duplicated) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe una equipment class con codigo ${nextCode}.`);
    }
  }

  const data: Record<string, unknown> = {};
  if (payload.code !== undefined) data.code = normalizeRequiredText(payload.code, "code").toUpperCase();
  if (payload.name !== undefined) data.name = normalizeRequiredText(payload.name, "name");
  if (payload.description !== undefined) data.description = normalizeOptionalText(payload.description);
  if (payload.defaultSfiCode !== undefined) data.defaultSfiCode = normalizeOptionalText(payload.defaultSfiCode);
  if (payload.defaultCriticality !== undefined) data.defaultCriticality = payload.defaultCriticality;
  if (payload.status !== undefined) data.status = normalizeRequiredText(payload.status, "status");

  return prisma.equipmentClass.update({
    where: { id: current.id },
    data,
  });
}
