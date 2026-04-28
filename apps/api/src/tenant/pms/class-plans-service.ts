import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface InstantiateClassPlansOptions {
  includeNonDefault?: boolean;
}

export interface InstantiateClassPlansResult {
  created: number;
  skipped: number;
  plans: MaintenancePlanRecord[];
}

interface AssetRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetCode: string;
  equipmentClassId: string | null;
  deletedAt: Date | null;
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
}

export interface MaintenancePlanRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  taskCode: string;
  title: string;
  description: string | null;
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
  responsible: string | null;
  acceptanceCriteria: string | null;
  loto: string | null;
  status: string;
  taskMasterId: string | null;
  triggerResultMode: string;
  windowMode: string;
  windowLeadDays: number | null;
  windowLeadHours: number | null;
  windowLeadPercent: number | null;
  windowOpenDate: Date | null;
  windowOpenHours: number | null;
  executionStatus: string;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
}

type AssetDelegate = {
  findFirst(args: { where: Record<string, unknown> }): Promise<AssetRecord | null>;
};

type TaskMasterDelegate = {
  findFirst(args: { where: Record<string, unknown> }): Promise<TaskMasterRecord | null>;
};

type ClassTaskTemplateDelegate = {
  findMany(args: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
    orderBy?: unknown;
    take?: number;
  }): Promise<ClassTaskTemplateRecord[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<ClassTaskTemplateRecord | null>;
  create(args: { data: Record<string, unknown>; include?: Record<string, unknown> }): Promise<ClassTaskTemplateRecord>;
  delete(args: { where: { id: string } }): Promise<ClassTaskTemplateRecord>;
};

type EquipmentClassDelegate = {
  findFirst(args: { where: Record<string, unknown> }): Promise<EquipmentClassRecord | null>;
};

type MaintenancePlanDelegate = {
  findFirst(args: { where: Record<string, unknown> }): Promise<MaintenancePlanRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<MaintenancePlanRecord>;
};

interface ClassPlansTx {
  maintenancePlan: MaintenancePlanDelegate;
}

interface ClassPlansPrismaClient extends ClassPlansTx {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  asset: AssetDelegate;
  equipmentClass: EquipmentClassDelegate;
  taskMaster: TaskMasterDelegate;
  classTaskTemplate: ClassTaskTemplateDelegate;
  $transaction<T>(fn: (tx: ClassPlansTx) => Promise<T>): Promise<T>;
}

function classPlansClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): ClassPlansPrismaClient {
  return prisma as unknown as ClassPlansPrismaClient;
}

function ensureCanInstantiateClassPlans(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "FLEET_SUPERINTENDENT" && session.user.role !== "MAINTENANCE_MANAGER") {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para instanciar class plans.");
  }
}

function ensureTenantAdmin(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede modificar class task templates.");
  }
}

function normalizeRequiredText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = classPlansClient(prismaRaw);
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

async function getTenantIdOrThrow(session: TenantAccessSession): Promise<string> {
  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenantId;
}

function applyVesselScope(
  session: TenantAccessSession,
  where: Record<string, unknown>,
  requestedVesselCode?: string | null,
  forbidOutOfScope = false,
) {
  if (session.user.role === "TENANT_ADMIN") {
    if (requestedVesselCode) where.vesselCode = requestedVesselCode;
    return;
  }

  if (requestedVesselCode) {
    if (!session.user.assignedVesselCodes.includes(requestedVesselCode)) {
      if (forbidOutOfScope) throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
      where.vesselCode = "__NO_ASSIGNED_VESSEL__";
      return;
    }
    where.vesselCode = requestedVesselCode;
    return;
  }

  if (session.user.assignedVesselCodes.length === 0) {
    where.vesselCode = "__NO_ASSIGNED_VESSEL__";
    return;
  }
  where.vesselCode = { in: session.user.assignedVesselCodes };
}

async function getAccessibleEquipmentClass(
  prisma: ClassPlansPrismaClient,
  tenantId: string,
  equipmentClassId: string,
): Promise<EquipmentClassRecord | null> {
  return prisma.equipmentClass.findFirst({
    where: {
      id: equipmentClassId,
      OR: [{ tenantId: null }, { tenantId }],
    },
  });
}

async function getEditableEquipmentClassOrThrow(
  prisma: ClassPlansPrismaClient,
  tenantId: string,
  equipmentClassId: string,
): Promise<EquipmentClassRecord> {
  const equipmentClass = await getAccessibleEquipmentClass(prisma, tenantId, equipmentClassId);
  if (!equipmentClass) throw new RouteError(404, "NOT_FOUND", "Equipment class no encontrada.");
  if (equipmentClass.tenantId === null) {
    throw new RouteError(403, "GLOBAL_EQUIPMENT_CLASS_READONLY", "No se puede modificar una equipment class global.");
  }
  return equipmentClass;
}

export async function listClassTaskTemplates(session: TenantAccessSession, equipmentClassId: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return [];
  const prisma = classPlansClient(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const equipmentClass = await getAccessibleEquipmentClass(prisma, tenantId, equipmentClassId);
  if (!equipmentClass) throw new RouteError(404, "NOT_FOUND", "Equipment class no encontrada.");

  return prisma.classTaskTemplate.findMany({
    where: { equipmentClassId: equipmentClass.id },
    include: { taskMaster: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function addClassTaskTemplate(session: TenantAccessSession, equipmentClassId: string, taskMasterId: string) {
  ensureTenantAdmin(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = classPlansClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const equipmentClass = await getEditableEquipmentClassOrThrow(prisma, tenantId, equipmentClassId);

  const taskMaster = await prisma.taskMaster.findFirst({
    where: {
      id: taskMasterId,
      OR: [{ tenantId: null }, { tenantId }],
    },
  });
  if (!taskMaster) throw new RouteError(404, "NOT_FOUND", "Task master no encontrado.");

  const existing = await prisma.classTaskTemplate.findFirst({
    where: {
      equipmentClassId: equipmentClass.id,
      taskMasterId: taskMaster.id,
    },
  });
  if (existing) {
    throw new RouteError(409, "DUPLICATE_CLASS_TASK_TEMPLATE", "La relacion equipmentClassId + taskMasterId ya existe.");
  }

  const latest = await prisma.classTaskTemplate.findMany({
    where: { equipmentClassId: equipmentClass.id },
    orderBy: { sortOrder: "desc" },
    take: 1,
  });
  const nextSortOrder = latest.length > 0 ? latest[0]!.sortOrder + 1 : 0;

  return prisma.classTaskTemplate.create({
    data: {
      equipmentClassId: equipmentClass.id,
      taskMasterId: taskMaster.id,
      isDefault: true,
      sortOrder: nextSortOrder,
    },
    include: { taskMaster: true },
  });
}

export async function removeClassTaskTemplate(session: TenantAccessSession, equipmentClassId: string, taskMasterId: string) {
  ensureTenantAdmin(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = classPlansClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const equipmentClass = await getEditableEquipmentClassOrThrow(prisma, tenantId, equipmentClassId);

  const existing = await prisma.classTaskTemplate.findFirst({
    where: {
      equipmentClassId: equipmentClass.id,
      taskMasterId,
    },
  });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Class task template no encontrado.");

  await prisma.classTaskTemplate.delete({ where: { id: existing.id } });
  return { ok: true };
}

export async function instantiateClassPlans(
  session: TenantAccessSession,
  assetId: string,
  options: InstantiateClassPlansOptions = {},
): Promise<InstantiateClassPlansResult> {
  ensureCanInstantiateClassPlans(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = classPlansClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const normalizedAssetId = normalizeRequiredText(assetId, "assetId");

  const assetWhere: Record<string, unknown> = {
    id: normalizedAssetId,
    tenantId,
    deletedAt: null,
  };
  applyVesselScope(session, assetWhere);

  const asset = await prisma.asset.findFirst({ where: assetWhere });
  if (!asset) throw new RouteError(404, "NOT_FOUND", "Asset no encontrado.");
  if (!asset.equipmentClassId) {
    throw new RouteError(404, "ASSET_WITHOUT_EQUIPMENT_CLASS", "El asset no tiene equipmentClassId.");
  }

  const templatesWhere: Record<string, unknown> = {
    equipmentClassId: asset.equipmentClassId,
  };
  if (!options.includeNonDefault) {
    templatesWhere.isDefault = true;
  }

  const templates = await prisma.classTaskTemplate.findMany({
    where: templatesWhere,
    include: { taskMaster: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  if (templates.length === 0) {
    return { created: 0, skipped: 0, plans: [] };
  }

  return prisma.$transaction(async (tx) => {
    let created = 0;
    let skipped = 0;
    const plans: MaintenancePlanRecord[] = [];

    for (const template of templates) {
      const taskMaster = template.taskMaster;
      if (!taskMaster) {
        skipped += 1;
        continue;
      }

      const existingByTaskMaster = await tx.maintenancePlan.findFirst({
        where: {
          tenantId,
          vesselCode: asset.vesselCode,
          assetId: asset.id,
          taskMasterId: taskMaster.id,
          deletedAt: null,
        },
      });
      if (existingByTaskMaster) {
        skipped += 1;
        continue;
      }

      const taskCode = `${taskMaster.code}-${asset.assetCode}`.toUpperCase();
      const existingByTaskCode = await tx.maintenancePlan.findFirst({
        where: {
          tenantId,
          vesselCode: asset.vesselCode,
          taskCode,
          deletedAt: null,
        },
      });
      if (existingByTaskCode) {
        skipped += 1;
        continue;
      }

      const createdPlan = await tx.maintenancePlan.create({
        data: {
          tenantId,
          vesselCode: asset.vesselCode,
          assetId: asset.id,
          taskCode,
          title: taskMaster.title,
          description: null,
          triggerType: taskMaster.triggerType,
          frequencyHours: taskMaster.frequencyHours ?? null,
          frequencyMonths: taskMaster.frequencyDays ? Math.round(taskMaster.frequencyDays / 30) : null,
          responsible: null,
          acceptanceCriteria: null,
          loto: null,
          status: "ACTIVE",
          taskMasterId: taskMaster.id,
          triggerResultMode: taskMaster.triggerResultMode,
          executionStatus: "FUTURE",
          createdByUserId: session.user.id,
          updatedByUserId: session.user.id,
        },
      });

      created += 1;
      plans.push(createdPlan);
    }

    return { created, skipped, plans };
  });
}
