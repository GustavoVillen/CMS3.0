import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface InspectionTemplateFilters {
  equipmentClassId?: string | null;
  sfiCode?: string | null;
  triggerType?: string | null;
  status?: string | null;
}

export interface ChecklistItemWriteInput {
  sortOrder?: number;
  description: string;
  itemType: "BOOLEAN_OK_NOK" | "PASS_FAIL_NA" | "NUMERIC_READING" | "SHORT_TEXT" | "TECHNICAL_NOTES" | "PHOTO_REQUIRED";
  acceptanceCriteria?: string | null;
  nominalValue?: number | null;
  minValue?: number | null;
  maxValue?: number | null;
  unit?: string | null;
  requiresInstrument?: boolean;
  requiredInstrumentType?: string | null;
  evidenceRequired?: boolean;
  deficiencySeverity?: "OBSERVATION" | "DEFICIENCY" | "CRITICAL" | null;
  criteriaSource?: "MAKER_MANUAL" | "COMPANY_STANDARD" | "CLASS_REQUIREMENT" | "STATUTORY" | "ENGINEERING_CRITERION" | null;
  isOptional?: boolean;
}

export interface CreateInspectionTemplateInput {
  code: string;
  title: string;
  description?: string | null;
  equipmentClassId?: string | null;
  sfiCode?: string | null;
  triggerType: "CALENDAR" | "RUNNING_HOURS" | "ON_CONDITION" | "EVENT_BASED";
  triggerResultMode?: "DUE_ONLY" | "AUTO_WO" | "APPROVAL_WO";
  frequencyDays?: number | null;
  windowMode?: "AUTO" | "MANUAL";
  windowLeadDays?: number | null;
  evidenceRequired?: boolean;
  status?: string;
  checklistItems?: ChecklistItemWriteInput[];
}

export interface UpdateInspectionTemplateInput {
  code?: string;
  title?: string;
  description?: string | null;
  equipmentClassId?: string | null;
  sfiCode?: string | null;
  triggerType?: "CALENDAR" | "RUNNING_HOURS" | "ON_CONDITION" | "EVENT_BASED";
  triggerResultMode?: "DUE_ONLY" | "AUTO_WO" | "APPROVAL_WO";
  frequencyDays?: number | null;
  windowMode?: "AUTO" | "MANUAL";
  windowLeadDays?: number | null;
  evidenceRequired?: boolean;
  status?: string;
  checklistItems?: ChecklistItemWriteInput[];
}

interface InspectionChecklistItemRecord {
  id: string;
  templateId: string;
  sortOrder: number;
  description: string;
  itemType: string;
  acceptanceCriteria: string | null;
  nominalValue: number | null;
  minValue: number | null;
  maxValue: number | null;
  unit: string | null;
  requiresInstrument: boolean;
  requiredInstrumentType: string | null;
  evidenceRequired: boolean;
  deficiencySeverity: string | null;
  criteriaSource: string | null;
  isOptional: boolean;
}

interface InspectionTemplateRecord {
  id: string;
  tenantId: string | null;
  code: string;
  title: string;
  description: string | null;
  equipmentClassId: string | null;
  sfiCode: string | null;
  triggerType: string;
  triggerResultMode: string;
  frequencyDays: number | null;
  windowMode: string;
  windowLeadDays: number | null;
  evidenceRequired: boolean;
  isGlobal: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  checklistItems?: InspectionChecklistItemRecord[];
}

type InspectionTemplateDelegate = {
  findMany(args: { where: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: unknown }): Promise<InspectionTemplateRecord[]>;
  findFirst(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<InspectionTemplateRecord | null>;
  findUnique(args: { where: { id: string }; include?: Record<string, unknown> }): Promise<InspectionTemplateRecord | null>;
  create(args: { data: Record<string, unknown>; include?: Record<string, unknown> }): Promise<InspectionTemplateRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown>; include?: Record<string, unknown> }): Promise<InspectionTemplateRecord>;
};

function templateDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): InspectionTemplateDelegate {
  return (prisma as unknown as { inspectionTemplate: InspectionTemplateDelegate }).inspectionTemplate;
}

function hasInspectionTemplateDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): boolean {
  const candidate = prisma as unknown as { inspectionTemplate?: InspectionTemplateDelegate };
  return Boolean(candidate.inspectionTemplate && typeof candidate.inspectionTemplate.findMany === "function");
}

function canManageTemplates(session: TenantAccessSession): boolean {
  return session.user.role === "TENANT_ADMIN";
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

function normalizeChecklistItems(items: ChecklistItemWriteInput[]): Array<Record<string, unknown>> {
  return items.map((item, index) => ({
    sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : index + 1,
    description: normalizeRequiredText(item.description, "checklistItems.description"),
    itemType: item.itemType,
    acceptanceCriteria: normalizeOptionalText(item.acceptanceCriteria),
    nominalValue: normalizeOptionalNumber(item.nominalValue, "checklistItems.nominalValue"),
    minValue: normalizeOptionalNumber(item.minValue, "checklistItems.minValue"),
    maxValue: normalizeOptionalNumber(item.maxValue, "checklistItems.maxValue"),
    unit: normalizeOptionalText(item.unit),
    requiresInstrument: Boolean(item.requiresInstrument),
    requiredInstrumentType: normalizeOptionalText(item.requiredInstrumentType),
    evidenceRequired: Boolean(item.evidenceRequired),
    deficiencySeverity: item.deficiencySeverity ?? null,
    criteriaSource: item.criteriaSource ?? null,
    isOptional: Boolean(item.isOptional),
  }));
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

async function getTenantIdOrThrow(session: TenantAccessSession): Promise<string> {
  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenantId;
}

export async function listInspectionTemplates(session: TenantAccessSession, filters: InspectionTemplateFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  if (!hasInspectionTemplateDelegate(prisma)) return [];

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = {
    OR: [{ tenantId: null }, { tenantId }],
  };
  if (filters.equipmentClassId) where.equipmentClassId = filters.equipmentClassId;
  if (filters.sfiCode) where.sfiCode = filters.sfiCode;
  if (filters.triggerType) where.triggerType = filters.triggerType;
  if (filters.status) where.status = filters.status;

  return templateDelegate(prisma).findMany({
    where,
    include: { checklistItems: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ isGlobal: "desc" }, { code: "asc" }],
  });
}

export async function getInspectionTemplate(id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  if (!hasInspectionTemplateDelegate(prisma)) {
    throw new RouteError(503, "INSPECTION_MODEL_UNAVAILABLE", "Modelo de plantillas de inspección no disponible en Prisma.");
  }

  const record = await templateDelegate(prisma).findUnique({
    where: { id },
    include: { checklistItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Template no encontrado.");
  return record;
}

export async function createInspectionTemplate(session: TenantAccessSession, payload: CreateInspectionTemplateInput) {
  if (!canManageTemplates(session)) {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede crear templates.");
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  if (!hasInspectionTemplateDelegate(prisma)) {
    throw new RouteError(503, "INSPECTION_MODEL_UNAVAILABLE", "Modelo de plantillas de inspección no disponible en Prisma.");
  }

  const tenantId = await getTenantIdOrThrow(session);
  const code = normalizeRequiredText(payload.code, "code").toUpperCase();
  const existing = await templateDelegate(prisma).findFirst({ where: { tenantId, code } });
  if (existing) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un template con código ${code}.`);

  const checklistItems = payload.checklistItems ?? [];
  return templateDelegate(prisma).create({
    data: {
      tenantId,
      code,
      title: normalizeRequiredText(payload.title, "title"),
      description: normalizeOptionalText(payload.description),
      equipmentClassId: normalizeOptionalText(payload.equipmentClassId),
      sfiCode: normalizeOptionalText(payload.sfiCode),
      triggerType: payload.triggerType,
      triggerResultMode: payload.triggerResultMode ?? "DUE_ONLY",
      frequencyDays: normalizeOptionalNumber(payload.frequencyDays, "frequencyDays"),
      windowMode: payload.windowMode ?? "AUTO",
      windowLeadDays: normalizeOptionalNumber(payload.windowLeadDays, "windowLeadDays"),
      evidenceRequired: Boolean(payload.evidenceRequired),
      isGlobal: false,
      status: normalizeOptionalText(payload.status) ?? "ACTIVE",
      checklistItems: checklistItems.length > 0 ? { create: normalizeChecklistItems(checklistItems) } : undefined,
    },
    include: { checklistItems: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function updateInspectionTemplate(
  session: TenantAccessSession,
  id: string,
  payload: UpdateInspectionTemplateInput,
) {
  if (!canManageTemplates(session)) {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede editar templates.");
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  if (!hasInspectionTemplateDelegate(prisma)) {
    throw new RouteError(503, "INSPECTION_MODEL_UNAVAILABLE", "Modelo de plantillas de inspección no disponible en Prisma.");
  }

  const tenantId = await getTenantIdOrThrow(session);
  const current = await templateDelegate(prisma).findUnique({ where: { id } });
  if (!current) throw new RouteError(404, "NOT_FOUND", "Template no encontrado.");
  if (current.tenantId === null) {
    throw new RouteError(403, "GLOBAL_TEMPLATE_READONLY", "No se puede editar un template global.");
  }
  if (current.tenantId !== tenantId) throw new RouteError(404, "NOT_FOUND", "Template no encontrado.");

  if (payload.code !== undefined) {
    const nextCode = normalizeRequiredText(payload.code, "code").toUpperCase();
    if (nextCode !== current.code) {
      const duplicated = await templateDelegate(prisma).findFirst({
        where: { tenantId, code: nextCode },
      });
      if (duplicated) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un template con código ${nextCode}.`);
    }
  }

  const data: Record<string, unknown> = {};
  if (payload.code !== undefined) data.code = normalizeRequiredText(payload.code, "code").toUpperCase();
  if (payload.title !== undefined) data.title = normalizeRequiredText(payload.title, "title");
  if (payload.description !== undefined) data.description = normalizeOptionalText(payload.description);
  if (payload.equipmentClassId !== undefined) data.equipmentClassId = normalizeOptionalText(payload.equipmentClassId);
  if (payload.sfiCode !== undefined) data.sfiCode = normalizeOptionalText(payload.sfiCode);
  if (payload.triggerType !== undefined) data.triggerType = payload.triggerType;
  if (payload.triggerResultMode !== undefined) data.triggerResultMode = payload.triggerResultMode;
  if (payload.frequencyDays !== undefined) data.frequencyDays = normalizeOptionalNumber(payload.frequencyDays, "frequencyDays");
  if (payload.windowMode !== undefined) data.windowMode = payload.windowMode;
  if (payload.windowLeadDays !== undefined) data.windowLeadDays = normalizeOptionalNumber(payload.windowLeadDays, "windowLeadDays");
  if (payload.evidenceRequired !== undefined) data.evidenceRequired = Boolean(payload.evidenceRequired);
  if (payload.status !== undefined) data.status = normalizeRequiredText(payload.status, "status");
  if (payload.checklistItems !== undefined) {
    data.checklistItems = {
      deleteMany: {},
      create: normalizeChecklistItems(payload.checklistItems),
    };
  }

  return templateDelegate(prisma).update({
    where: { id: current.id },
    data,
    include: { checklistItems: { orderBy: { sortOrder: "asc" } } },
  });
}
