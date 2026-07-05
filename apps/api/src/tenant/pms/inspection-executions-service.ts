import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { createCapaInternal } from "./capa-service";
import { log } from "../../common/logger";

export interface InspectionExecutionFilters {
  vesselCode?: string | null;
  status?: string | null;
  result?: string | null;
  templateId?: string | null;
}

export interface CreateInspectionExecutionInput {
  vesselCode: string;
  assetId?: string | null;
  templateId: string;
  scheduledAt?: string | Date | null;
  inspectorUserId?: string | null;
  inspectorName?: string | null;
  generalObservations?: string | null;
}

export interface SubmitInspectionResultItemInput {
  checklistItemId: string;
  resultValue?: string | null;
  numericValue?: number | null;
  isConforming?: boolean | null;
  deficiencySeverity?: "OBSERVATION" | "DEFICIENCY" | "CRITICAL" | null;
  instrumentId?: string | null;
  notes?: string | null;
}

export interface SubmitInspectionResultsInput {
  items: SubmitInspectionResultItemInput[];
}

export interface CompleteInspectionExecutionInput {
  result: "SATISFACTORY" | "SATISFACTORY_WITH_OBSERVATIONS" | "UNSATISFACTORY_FOLLOW_UP_REQUIRED" | "CRITICAL_DEFICIENCY_IMMEDIATE_ACTION";
  generalObservations?: string | null;
  nextScheduledDate?: string | Date | null;
  inspectorName?: string | null;
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

interface InspectionItemResultRecord {
  id: string;
  executionId: string;
  checklistItemId: string;
  resultValue: string | null;
  numericValue: number | null;
  isConforming: boolean | null;
  deficiencySeverity: string | null;
  instrumentId: string | null;
  notes: string | null;
  createdAt: Date;
  checklistItem?: InspectionChecklistItemRecord;
}

interface InspectionTemplateSummaryRecord {
  id: string;
  code: string;
  title: string;
  tenantId?: string | null;
}

interface InspectionExecutionRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string | null;
  templateId: string;
  executionCode: string;
  status: string;
  result: string | null;
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  inspectorUserId: string | null;
  inspectorName: string | null;
  generalObservations: string | null;
  nextScheduledDate: Date | null;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  template?: InspectionTemplateSummaryRecord;
  itemResults?: InspectionItemResultRecord[];
}

type InspectionTemplateDelegate = {
  findFirst(args: { where: Record<string, unknown>; select?: Record<string, unknown> }): Promise<InspectionTemplateSummaryRecord | null>;
};

type InspectionChecklistItemDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<InspectionChecklistItemRecord[]>;
};

type InspectionItemResultDelegate = {
  findMany(args: { where: Record<string, unknown> }): Promise<InspectionItemResultRecord[]>;
  upsert(args: {
    where: { executionId_checklistItemId: { executionId: string; checklistItemId: string } };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<InspectionItemResultRecord>;
};

type InspectionExecutionDelegate = {
  findMany(args: { where: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: unknown }): Promise<InspectionExecutionRecord[]>;
  findFirst(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<InspectionExecutionRecord | null>;
  create(args: { data: Record<string, unknown>; include?: Record<string, unknown> }): Promise<InspectionExecutionRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown>; include?: Record<string, unknown> }): Promise<InspectionExecutionRecord>;
};

type DefectDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
};

interface InspectionPrismaTx {
  inspectionExecution: InspectionExecutionDelegate;
  inspectionItemResult: InspectionItemResultDelegate;
  inspectionChecklistItem: InspectionChecklistItemDelegate;
  defect: DefectDelegate;
}

interface InspectionPrismaClient extends InspectionPrismaTx {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  inspectionTemplate?: InspectionTemplateDelegate;
  $transaction<T>(fn: (tx: InspectionPrismaTx) => Promise<T>): Promise<T>;
}

function inspectionClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): InspectionPrismaClient {
  return prisma as unknown as InspectionPrismaClient;
}

function hasInspectionDelegates(prisma: InspectionPrismaClient): prisma is InspectionPrismaClient & {
  inspectionExecution: InspectionExecutionDelegate;
  inspectionItemResult: InspectionItemResultDelegate;
  inspectionChecklistItem: InspectionChecklistItemDelegate;
  inspectionTemplate: InspectionTemplateDelegate;
} {
  return Boolean(
    prisma.inspectionExecution &&
    typeof prisma.inspectionExecution.findMany === "function" &&
    prisma.inspectionItemResult &&
    typeof prisma.inspectionItemResult.findMany === "function" &&
    prisma.inspectionChecklistItem &&
    typeof prisma.inspectionChecklistItem.findMany === "function" &&
    prisma.inspectionTemplate &&
    typeof prisma.inspectionTemplate.findFirst === "function",
  );
}

function canWriteExecutions(session: TenantAccessSession): boolean {
  return ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER", "INSPECTOR_COMPLIANCE"].includes(session.user.role);
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

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  return parsed;
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
      if (forbidOutOfScope) {
        throw new RouteError(403, "FORBIDDEN", "No tienes acceso al vessel solicitado.");
      }
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

async function findScopedExecution(
  session: TenantAccessSession,
  id: string,
  prisma: InspectionPrismaClient,
  include?: Record<string, unknown>,
): Promise<InspectionExecutionRecord | null> {
  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);
  return prisma.inspectionExecution.findFirst({ where, include });
}

export async function listInspectionExecutions(
  session: TenantAccessSession,
  filters: InspectionExecutionFilters = {},
) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return [];
  const prisma = inspectionClient(prismaRaw);
  if (!hasInspectionDelegates(prisma)) return [];

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.result) where.result = filters.result;
  if (filters.templateId) where.templateId = filters.templateId;

  return prisma.inspectionExecution.findMany({
    where,
    include: {
      template: { select: { id: true, code: true, title: true } },
      itemResults: true,
    },
    orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function getInspectionExecution(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = inspectionClient(prismaRaw);
  if (!hasInspectionDelegates(prisma)) {
    throw new RouteError(503, "INSPECTION_MODEL_UNAVAILABLE", "Modelo de inspecciones no disponible en Prisma.");
  }

  const execution = await findScopedExecution(session, id, prisma, {
    template: { select: { id: true, code: true, title: true } },
    itemResults: {
      include: { checklistItem: true },
    },
  });
  if (!execution) throw new RouteError(404, "NOT_FOUND", "Inspection execution no encontrada.");
  return execution;
}

export async function createInspectionExecution(session: TenantAccessSession, payload: CreateInspectionExecutionInput) {
  if (!canWriteExecutions(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para crear inspecciones.");
  }

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = inspectionClient(prismaRaw);
  if (!hasInspectionDelegates(prisma)) {
    throw new RouteError(503, "INSPECTION_MODEL_UNAVAILABLE", "Modelo de inspecciones no disponible en Prisma.");
  }

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);

  const template = await prisma.inspectionTemplate.findFirst({
    where: {
      id: normalizeRequiredText(payload.templateId, "templateId"),
      OR: [{ tenantId: null }, { tenantId }],
    },
    select: { id: true, code: true, title: true, tenantId: true },
  });
  if (!template) throw new RouteError(404, "TEMPLATE_NOT_FOUND", "Template no encontrado.");

  const executionCode = `INSP-${vesselCode}-${Date.now()}`;
  return prisma.inspectionExecution.create({
    data: {
      tenantId,
      vesselCode,
      assetId: normalizeOptionalText(payload.assetId),
      templateId: template.id,
      executionCode,
      status: "SCHEDULED",
      scheduledAt: parseOptionalDate(payload.scheduledAt, "scheduledAt"),
      inspectorUserId: normalizeOptionalText(payload.inspectorUserId),
      inspectorName: normalizeOptionalText(payload.inspectorName),
      generalObservations: normalizeOptionalText(payload.generalObservations),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
    include: {
      template: { select: { id: true, code: true, title: true } },
      itemResults: true,
    },
  });
}

export async function startInspectionExecution(session: TenantAccessSession, id: string) {
  if (!canWriteExecutions(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para iniciar inspecciones.");
  }

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = inspectionClient(prismaRaw);
  if (!hasInspectionDelegates(prisma)) {
    throw new RouteError(503, "INSPECTION_MODEL_UNAVAILABLE", "Modelo de inspecciones no disponible en Prisma.");
  }

  const execution = await findScopedExecution(session, id, prisma);
  if (!execution) throw new RouteError(404, "NOT_FOUND", "Inspection execution no encontrada.");
  if (execution.status === "IN_PROGRESS" || execution.status === "COMPLETED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `No se puede iniciar desde estado ${execution.status}.`);
  }
  if (execution.status !== "SCHEDULED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo SCHEDULED puede pasar a IN_PROGRESS (actual: ${execution.status}).`);
  }

  return prisma.inspectionExecution.update({
    where: { id: execution.id },
    data: {
      status: "IN_PROGRESS",
      startedAt: new Date(),
      inspectorUserId: execution.inspectorUserId ?? session.user.id,
      updatedByUserId: session.user.id,
    },
    include: {
      template: { select: { id: true, code: true, title: true } },
      itemResults: true,
    },
  });
}

function computeIsConforming(
  item: InspectionChecklistItemRecord,
  result: SubmitInspectionResultItemInput,
): boolean | null {
  if (
    item.itemType === "NUMERIC_READING" &&
    typeof result.numericValue === "number" &&
    Number.isFinite(result.numericValue) &&
    item.minValue !== null &&
    item.maxValue !== null
  ) {
    return result.numericValue >= item.minValue && result.numericValue <= item.maxValue;
  }
  if (result.isConforming === undefined || result.isConforming === null) return null;
  return Boolean(result.isConforming);
}

export async function submitInspectionResults(
  session: TenantAccessSession,
  id: string,
  payload: SubmitInspectionResultsInput,
) {
  if (!canWriteExecutions(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para cargar resultados de inspección.");
  }
  if (!Array.isArray(payload.items)) {
    throw new RouteError(400, "VALIDATION_ERROR", "Se esperaba un array en items.");
  }

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = inspectionClient(prismaRaw);
  if (!hasInspectionDelegates(prisma)) {
    throw new RouteError(503, "INSPECTION_MODEL_UNAVAILABLE", "Modelo de inspecciones no disponible en Prisma.");
  }

  const execution = await findScopedExecution(session, id, prisma);
  if (!execution) throw new RouteError(404, "NOT_FOUND", "Inspection execution no encontrada.");
  if (execution.status !== "IN_PROGRESS") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", "Solo se pueden cargar resultados cuando está IN_PROGRESS.");
  }

  const checklistItems = await prisma.inspectionChecklistItem.findMany({
    where: { templateId: execution.templateId },
    orderBy: { sortOrder: "asc" },
  });
  const itemById = new Map(checklistItems.map((item) => [item.id, item]));

  await prisma.$transaction(async (tx) => {
    for (const entry of payload.items) {
      const checklistItemId = normalizeRequiredText(entry.checklistItemId, "checklistItemId");
      const item = itemById.get(checklistItemId);
      if (!item) {
        throw new RouteError(400, "CHECKLIST_ITEM_INVALID", `El ítem ${checklistItemId} no pertenece al template de la ejecución.`);
      }

      const numericValue = normalizeOptionalNumber(entry.numericValue, "numericValue");
      const isConforming = computeIsConforming(item, { ...entry, numericValue });
      const deficiencySeverity = entry.deficiencySeverity ?? item.deficiencySeverity ?? null;
      const resultValue = normalizeOptionalText(entry.resultValue);
      const notes = normalizeOptionalText(entry.notes);
      const instrumentId = normalizeOptionalText(entry.instrumentId);

      await tx.inspectionItemResult.upsert({
        where: {
          executionId_checklistItemId: {
            executionId: execution.id,
            checklistItemId: item.id,
          },
        },
        create: {
          executionId: execution.id,
          checklistItemId: item.id,
          resultValue,
          numericValue,
          isConforming,
          deficiencySeverity,
          instrumentId,
          notes,
        },
        update: {
          resultValue,
          numericValue,
          isConforming,
          deficiencySeverity,
          instrumentId,
          notes,
        },
      });
    }
  });

  return getInspectionExecution(session, execution.id);
}

function shouldCreateDefect(result: string): boolean {
  return (
    result === "CRITICAL_DEFICIENCY_IMMEDIATE_ACTION" ||
    result === "UNSATISFACTORY_FOLLOW_UP_REQUIRED"
  );
}

function mapResultToSeverity(result: string): "CRITICAL" | "HIGH" {
  if (result === "CRITICAL_DEFICIENCY_IMMEDIATE_ACTION") return "CRITICAL";
  return "HIGH";
}

export async function completeInspectionExecution(
  session: TenantAccessSession,
  id: string,
  payload: CompleteInspectionExecutionInput,
) {
  if (!canWriteExecutions(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para completar inspecciones.");
  }

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = inspectionClient(prismaRaw);
  if (!hasInspectionDelegates(prisma)) {
    throw new RouteError(503, "INSPECTION_MODEL_UNAVAILABLE", "Modelo de inspecciones no disponible en Prisma.");
  }

  const execution = await findScopedExecution(session, id, prisma, {
    template: { select: { id: true, code: true, title: true } },
  });
  if (!execution) throw new RouteError(404, "NOT_FOUND", "Inspection execution no encontrada.");
  if (execution.status !== "IN_PROGRESS") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", "Solo una inspección IN_PROGRESS puede completarse.");
  }

  const result = payload.result;
  if (!result) throw new RouteError(400, "VALIDATION_ERROR", "El campo result es requerido.");

  await prisma.$transaction(async (tx) => {
    const mandatoryItems = await tx.inspectionChecklistItem.findMany({
      where: { templateId: execution.templateId, isOptional: false },
    });
    const mandatoryIds = mandatoryItems.map((item) => item.id);

    if (mandatoryIds.length > 0) {
      const recorded = await tx.inspectionItemResult.findMany({
        where: {
          executionId: execution.id,
          checklistItemId: { in: mandatoryIds },
        },
      });
      const completedSet = new Set(recorded.map((row) => row.checklistItemId));
      const missing = mandatoryIds.filter((itemId) => !completedSet.has(itemId));
      if (missing.length > 0) {
        throw new RouteError(400, "MISSING_ITEM_RESULTS", "Faltan resultados en ítems obligatorios.");
      }
    }

    const now = new Date();
    await tx.inspectionExecution.update({
      where: { id: execution.id },
      data: {
        status: "COMPLETED",
        result,
        generalObservations: normalizeOptionalText(payload.generalObservations),
        nextScheduledDate: parseOptionalDate(payload.nextScheduledDate, "nextScheduledDate"),
        inspectorName: normalizeOptionalText(payload.inspectorName) ?? execution.inspectorName,
        inspectorUserId: execution.inspectorUserId ?? session.user.id,
        completedAt: now,
        updatedByUserId: session.user.id,
      },
    });

    if (shouldCreateDefect(result)) {
      const year = new Date().getFullYear();
      const yy = String(year).slice(-2);
      const defectsThisYear = await (tx.defect as any).findMany({ where: { tenantId: execution.tenantId, vesselCode: execution.vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
      const defectCode = `DEF-${execution.vesselCode}-${yy}-${String(defectsThisYear.length + 1).padStart(4, "0")}`;
      const descriptionBase = execution.template?.title ?? "Inspection";
      const details = normalizeOptionalText(payload.generalObservations);
      const description = details ? `${descriptionBase}: ${details}` : `${descriptionBase}: finding generado por inspección.`;

      await tx.defect.create({
        data: {
          tenantId: execution.tenantId,
          vesselCode: execution.vesselCode,
          assetId: execution.assetId ?? "UNASSIGNED_ASSET",
          defectCode,
          severity: mapResultToSeverity(result),
          classification: "INSPECTION_FINDING",
          description,
          reportedAt: now,
          createdByUserId: session.user.id,
          updatedByUserId: session.user.id,
        },
      });

      // Auto-CAPA por finding de inspección con no-conformidad. Prioridad
      // CRITICAL para deficiencias inmediatas, HIGH para follow-up requerido.
      // Anti-duplicado por (sourceType=INSPECTION, sourceId=executionId).
      // CAPA DORMANTE (2026-07-05): módulo CAPA oculto de la entrega — se apaga la
      // auto-creación para no dejar registros huérfanos (el finding igual crea un Defecto,
      // arriba, que sí se mantiene). Reactivar: CAPA_AUTO_CREATE = true.
      const CAPA_AUTO_CREATE: boolean = false;
      if (CAPA_AUTO_CREATE) {
        try {
          await createCapaInternal(tx as unknown as Parameters<typeof createCapaInternal>[0], {
            tenantId:    execution.tenantId,
            vesselCode:  execution.vesselCode,
            assetId:     execution.assetId ?? "UNASSIGNED_ASSET",
            sourceType:  "INSPECTION",
            sourceId:    execution.id,
            priority:    mapResultToSeverity(result),
            title:       `CAPA — ${descriptionBase} (${result === "CRITICAL_DEFICIENCY_IMMEDIATE_ACTION" ? "deficiencia crítica" : "follow-up requerido"})`,
            description,
            actorUserId: session.user.id,
          });
        } catch (err) {
          // Best-effort: no romper la completion de la inspección si la CAPA falla.
          log.error("[completeInspectionExecution] auto-CAPA failed:", err);
        }
      }
    }
  });

  return getInspectionExecution(session, execution.id);
}

export async function cancelInspectionExecution(session: TenantAccessSession, id: string) {
  if (!canWriteExecutions(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para cancelar inspecciones.");
  }

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = inspectionClient(prismaRaw);
  if (!hasInspectionDelegates(prisma)) {
    throw new RouteError(503, "INSPECTION_MODEL_UNAVAILABLE", "Modelo de inspecciones no disponible en Prisma.");
  }

  const execution = await findScopedExecution(session, id, prisma);
  if (!execution) throw new RouteError(404, "NOT_FOUND", "Inspection execution no encontrada.");
  if (execution.status !== "SCHEDULED" && execution.status !== "IN_PROGRESS") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `No se puede cancelar en estado ${execution.status}.`);
  }

  return prisma.inspectionExecution.update({
    where: { id: execution.id },
    data: {
      status: "CANCELLED",
      updatedByUserId: session.user.id,
    },
    include: {
      template: { select: { id: true, code: true, title: true } },
      itemResults: true,
    },
  });
}
