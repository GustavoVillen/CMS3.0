import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { workOrderPrefix } from "../../common/wo-code";
import { listDevMaintenancePlansForTenant } from "../../platform/data/dev-domain-store";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { resolveConsumables, createWorkLogSpareMovements } from "../pms/spare-consumption";

export interface MaintenancePlanListFilters {
  vesselCode?: string | null;
  status?: string | null;
  triggerType?: string | null;
  executionStatus?: string | null;
  taskMasterId?: string | null;
  assetId?: string | null;
}

export interface CreateMaintenancePlanInput {
  vesselCode: string;
  assetId: string;
  /** Leave empty to auto-generate. Format: {VESSEL}-{SFI}-{SEQ} or {VESSEL}-PM-{SEQ}. */
  taskCode?: string | null;
  title: string;
  description?: string | null;
  taskType?: "MAINTENANCE" | "INSPECTION" | null;
  triggerType: "HOURS" | "MONTHS" | "CONDITION" | "EVENT" | "CALENDAR" | "RUNNING_HOURS";
  frequencyHours?: number | null;
  frequencyMonths?: number | null;
  estimatedHours?: number | null;
  responsible?: string | null;
  department?: MaintenancePlanDepartment | null;
  providerId?: string | null;
  acceptanceCriteria?: string | null;
  loto?: string | null;
  sfiGroupNumber?: number | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  riskProbability?: "LIKELY" | "PROBABLE" | "UNLIKELY" | "RARE" | null;
  riskConsequence?: "FATALITY" | "MAJOR" | "MINOR" | "NEGLIGIBLE" | null;
  riskAnalysisResult?: string | null;
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
  status?: "ACTIVE" | "DUE_SOON" | "OVERDUE" | "INACTIVE";
  taskMasterId?: string | null;
  /** Tipo de muestreo: si está set, al cerrar la OT se crea automáticamente un Sample DRAFT (kind correspondiente). */
  samplingKind?: "FLUID" | "VIBRATION" | "THERMAL" | "ULTRASOUND" | "OTHER" | null;
  /** Sub-tipo de fluido — solo relevante cuando samplingKind === "FLUID". */
  samplingFluidType?: "ENGINE_OIL" | "HYDRAULIC_OIL" | "GEARBOX_OIL" | "TRANSMISSION_OIL" | "FUEL_DIESEL" | "FUEL_GASOIL" | "COOLING_WATER" | "BOILER_WATER" | "POTABLE_WATER" | "REFRIGERANT" | "OTHER" | null;
  triggerResultMode?: "DUE_ONLY" | "AUTO_WO" | "APPROVAL_WO" | "CHECKLIST" | "EXPRESS";
  checklistTemplate?: string | null;
  windowMode?: "AUTO" | "MANUAL";
  windowLeadDays?: number | null;
  windowLeadHours?: number | null;
  windowLeadPercent?: number | null;
  windowOpenDate?: string | Date | null;
  windowOpenHours?: number | null;
  nextDueDate?: string | Date | null;
  nextDueHours?: number | null;
}

/** Área / responsable de la tarea — mismo set que WorkOrderDepartment. */
export type MaintenancePlanDepartment = "CUBIERTA" | "MAQUINAS" | "BARCAZA" | "PROVEEDOR" | "OTROS";

export interface UpdateMaintenancePlanInput {
  taskType?: "MAINTENANCE" | "INSPECTION" | null;
  assetId?: string;
  taskCode?: string;
  title?: string;
  description?: string | null;
  triggerType?: "HOURS" | "MONTHS" | "CONDITION" | "EVENT" | "CALENDAR" | "RUNNING_HOURS";
  frequencyHours?: number | null;
  frequencyMonths?: number | null;
  estimatedHours?: number | null;
  responsible?: string | null;
  department?: MaintenancePlanDepartment | null;
  providerId?: string | null;
  acceptanceCriteria?: string | null;
  loto?: string | null;
  sfiGroupNumber?: number | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  riskProbability?: "LIKELY" | "PROBABLE" | "UNLIKELY" | "RARE" | null;
  riskConsequence?: "FATALITY" | "MAJOR" | "MINOR" | "NEGLIGIBLE" | null;
  riskAnalysisResult?: string | null;
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
  status?: "ACTIVE" | "DUE_SOON" | "OVERDUE" | "INACTIVE";
  taskMasterId?: string | null;
  /** Tipo de muestreo: si está set, al cerrar la OT se crea automáticamente un Sample DRAFT (kind correspondiente). */
  samplingKind?: "FLUID" | "VIBRATION" | "THERMAL" | "ULTRASOUND" | "OTHER" | null;
  /** Sub-tipo de fluido — solo relevante cuando samplingKind === "FLUID". */
  samplingFluidType?: "ENGINE_OIL" | "HYDRAULIC_OIL" | "GEARBOX_OIL" | "TRANSMISSION_OIL" | "FUEL_DIESEL" | "FUEL_GASOIL" | "COOLING_WATER" | "BOILER_WATER" | "POTABLE_WATER" | "REFRIGERANT" | "OTHER" | null;
  triggerResultMode?: "DUE_ONLY" | "AUTO_WO" | "APPROVAL_WO" | "CHECKLIST" | "EXPRESS";
  checklistTemplate?: string | null;
  windowMode?: "AUTO" | "MANUAL";
  windowLeadDays?: number | null;
  windowLeadHours?: number | null;
  windowLeadPercent?: number | null;
  windowOpenDate?: string | Date | null;
  windowOpenHours?: number | null;
  nextDueDate?: string | Date | null;
  nextDueHours?: number | null;
  executionStatus?: "FUTURE" | "UPCOMING" | "IN_WINDOW" | "DUE" | "OVERDUE" | "COMPLETED";
  // Corrección manual (admin) de la última ejecución registrada del plan. NO crea
  // un WorkLog: es una edición directa del valor almacenado (p. ej. cargar histórico
  // o corregir una fecha errónea). El recálculo de vencimiento se hace por separado.
  lastExecutionDate?: string | Date | null;
  lastExecutionHours?: number | null;
}

export interface QuickClosePlanInput {
  result: "COMPLETED" | "COMPLETED_WITH_OBSERVATIONS" | "NOT_COMPLETED" | "FOLLOW_UP_REQUIRED";
  executedByName: string;
  /** Usuario que ejecutó (elegido por el admin). Default: quien reporta (session.user.id). */
  executedByUserId?: string | null;
  hoursWorked?: number | null;
  runningHoursAtExecution?: number | null;
  notes?: string | null;
  completedAt?: string | Date | null;
  /** Repuestos consumidos (solo Mantenimiento Express). Se registran como ISSUE atados al WorkLog. */
  spareUsages?: Array<{ spareId: string; qty: number; unit?: string | null }>;
}

export interface CompleteChecklistInput {
  result: "COMPLETED" | "COMPLETED_WITH_OBSERVATIONS" | "NOT_COMPLETED" | "FOLLOW_UP_REQUIRED";
  executedByName: string;
  notes?: string | null;
  checklistFileName?: string | null;
  completedAt?: string | Date | null;
  runningHoursAtExecution?: number | null;
  hoursWorked?: number | null;
}

export interface OpenFormalWorkOrderInput {
  title?: string | null;
  description?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  assignedToUserId?: string | null;
  estimatedHours?: number | null;
  dueDate?: string | Date | null;
  acceptanceCriteria?: string | null;
  loto?: string | null;
  riskLevel?: string | null;
  riskAnalysisResult?: string | null;
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
  // Solo TENANT_ADMIN: fecha de apertura (backdating) y abrir en nombre de
  // otro usuario (queda como SOLICITA / createdByUserId). Ignorados si el actor
  // no es admin. Ver openFormalWorkOrder.
  openDate?: string | Date | null;
  createdByUserId?: string | null;
  /**
   * OT EXPRESS: nace ya AUTORIZADA, sin pasar por aprobación ni autorización.
   * Es para los planes en modo "Solo Alerta", donde el trabajo se resuelve en el
   * momento y la tramitación formal sólo agregaría demora.
   *
   * Las tres firmas (solicita / aprueba / autoriza) quedan a nombre de quien
   * abre la OT: apretar el botón ES el acto de autorizar, y el PDF tiene que
   * salir con un responsable, no en blanco.
   *
   * ⚠️ Es la única vía por la que una OT llega a AUTORIZADA sin pasar por
   * canAuthorizeWorkOrders (tierra). Decisión de producto explícita: si se
   * exigiera tierra, el express perdería su razón de ser.
   */
  express?: boolean;
  /** Nombre a estampar en las firmas de la OT express. */
  signerName?: string | null;
}

interface RecalculatePlanInput {
  triggerType: string;
  frequencyMonths: number | null;
  frequencyHours: number | null;
}

interface RecalculateResult {
  nextDueDate: Date | null;
  nextDueHours: number | null;
}

function deriveExecutionStatus(
  plan: Pick<MaintenancePlanRecord, "executionStatus" | "nextDueDate" | "nextDueHours" | "triggerType">,
  currentHours?: number | null,
): string {
  // Only preserve IN_WINDOW: there's an active WO open for this plan.
  // COMPLETED is NOT preserved — if the next due date passed, it should become OVERDUE.
  if (plan.executionStatus === "IN_WINDOW") return "IN_WINDOW";

  const now = new Date();

  // Hours-based trigger
  if (plan.nextDueHours != null) {
    const hours = currentHours ?? 0;
    const diff = plan.nextDueHours - hours;
    if (diff <= 0) return "OVERDUE";
    if (diff <= 50) return "DUE";
    if (diff <= 250) return "UPCOMING";
    return "FUTURE";
  }

  // Date-based trigger
  if (plan.nextDueDate) {
    const due = new Date(plan.nextDueDate);
    const daysLeft = (due.getTime() - now.getTime()) / 86_400_000;
    if (daysLeft < 0) return "OVERDUE";
    if (daysLeft <= 7) return "DUE";
    if (daysLeft <= 30) return "UPCOMING";
    return "FUTURE";
  }

  return plan.executionStatus ?? "FUTURE";
}

interface WorkLogRecord {
  id: string;
  createdAt: Date;
}

interface MaintenancePlanRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  taskCode: string;
  title: string;
  description: string | null;
  responsible: string | null;
  taskType: string;
  acceptanceCriteria: string | null;
  loto: string | null;
  sfiGroupNumber: number | null;
  riskLevel: string | null;
  riskAnalysisResult: string | null;
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
  estimatedHours: number | null;
  status: string;
  lastExecutionDate: Date | null;
  nextDueDate: Date | null;
  lastExecutionHours: number | null;
  nextDueHours: number | null;
  taskMasterId?: string | null;
  executionStatus?: string | null;
  deletedAt: Date | null;
  workLogs?: WorkLogRecord[];
}

interface WorkOrderRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  maintenancePlanId: string | null;
  workOrderCode: string;
}

// Fila del historial de ejecuciones de un plan (una OT por ejecución).
interface WorkOrderExecRecord {
  id: string;
  workOrderCode: string;
  status: string;
  type: string;
  openDate: Date;
  completedDate: Date | null;
  executedByName: string | null;
  runningHoursAtExecution: number | null;
  woResult: string | null;
  observations: string | null;
}

type MaintenancePlanDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown; omit?: Record<string, true>; select?: Record<string, true> }): Promise<MaintenancePlanRecord[]>;
  findFirst(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<MaintenancePlanRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<MaintenancePlanRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown>; include?: Record<string, unknown> }): Promise<MaintenancePlanRecord>;
};

type WorkLogDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<WorkLogRecord>;
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown; take?: number }): Promise<WorkLogRecord[]>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
};

type WorkOrderDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<WorkOrderRecord>;
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown; select?: Record<string, true> }): Promise<WorkOrderExecRecord[]>;
  findFirst(args: { where: Record<string, unknown>; orderBy?: unknown; select?: Record<string, true> }): Promise<WorkOrderExecRecord | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<WorkOrderRecord>;
};

interface MaintenanceTx {
  maintenancePlan: MaintenancePlanDelegate;
  workLog: WorkLogDelegate;
  workOrder: WorkOrderDelegate;
}

interface MaintenancePrismaClient extends MaintenanceTx {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  $transaction<T>(fn: (tx: MaintenanceTx) => Promise<T>): Promise<T>;
}

function maintenanceClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): MaintenancePrismaClient {
  return prisma as unknown as MaintenancePrismaClient;
}

function canManagePlans(session: TenantAccessSession): boolean {
  const role = session.user.role;
  // Admin (gestión total) + Superintendente técnico (define planes desde
  // oficina) + Capitán/Jefe de Máquinas (ajusta planes desde el buque).
  return role === "TENANT_ADMIN" || role === "FLEET_SUPERINTENDENT" || role === "MAINTENANCE_MANAGER";
}

export function ensureCanManagePlans(session: TenantAccessSession) {
  if (!canManagePlans(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para modificar planes de mantenimiento.");
  }
}

// Abrir una OT desde un plan no modifica el plan — es una acción operativa.
// Los técnicos a bordo y los managers de mantenimiento pueden hacerlo.
function canOpenWorkOrderFromPlan(session: TenantAccessSession): boolean {
  const role = session.user.role;
  return role === "TENANT_ADMIN"
    || role === "FLEET_SUPERINTENDENT"
    || role === "MAINTENANCE_MANAGER"
    || role === "TECHNICIAN_OPERATOR";
}

function ensureCanOpenWorkOrderFromPlan(session: TenantAccessSession) {
  if (!canOpenWorkOrderFromPlan(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para crear órdenes de trabajo desde planes.");
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

function normalizeRiskLevel(value: unknown): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null {
  if (value === undefined || value === null || value === "") return null;
  const riskLevel = String(value).trim().toUpperCase();
  if (riskLevel === "LOW" || riskLevel === "MEDIUM" || riskLevel === "HIGH" || riskLevel === "CRITICAL") {
    return riskLevel;
  }
  throw new RouteError(400, "VALIDATION_ERROR", "riskLevel inválido. Valores permitidos: LOW, MEDIUM, HIGH, CRITICAL.");
}

const RISK_PROBABILITIES = ["LIKELY", "PROBABLE", "UNLIKELY", "RARE"] as const;
const RISK_CONSEQUENCES = ["FATALITY", "MAJOR", "MINOR", "NEGLIGIBLE"] as const;
type RiskProbability = (typeof RISK_PROBABILITIES)[number];
type RiskConsequence = (typeof RISK_CONSEQUENCES)[number];

function normalizeRiskProbability(value: unknown): RiskProbability | null {
  if (value === undefined || value === null || value === "") return null;
  const v = String(value).trim().toUpperCase();
  if ((RISK_PROBABILITIES as readonly string[]).includes(v)) return v as RiskProbability;
  throw new RouteError(400, "VALIDATION_ERROR", `riskProbability inválido. Valores permitidos: ${RISK_PROBABILITIES.join(", ")}.`);
}

function normalizeRiskConsequence(value: unknown): RiskConsequence | null {
  if (value === undefined || value === null || value === "") return null;
  const v = String(value).trim().toUpperCase();
  if ((RISK_CONSEQUENCES as readonly string[]).includes(v)) return v as RiskConsequence;
  throw new RouteError(400, "VALIDATION_ERROR", `riskConsequence inválido. Valores permitidos: ${RISK_CONSEQUENCES.join(", ")}.`);
}

// Deriva el nivel de riesgo (LOW/MEDIUM/HIGH) desde la celda probabilidad ×
// consecuencia. Misma matriz que la UI y el PDF (fuente única de la regla).
// Filas = consecuencia, columnas = probabilidad. A=Alto(HIGH), M=Medio(MEDIUM), B=Bajo(LOW).
function deriveRiskLevelFromMatrix(
  probability: RiskProbability | null,
  consequence: RiskConsequence | null,
): "LOW" | "MEDIUM" | "HIGH" | null {
  if (!probability || !consequence) return null;
  const grid: Record<RiskConsequence, Record<RiskProbability, "LOW" | "MEDIUM" | "HIGH">> = {
    FATALITY:   { LIKELY: "HIGH", PROBABLE: "HIGH",   UNLIKELY: "HIGH",   RARE: "MEDIUM" },
    MAJOR:      { LIKELY: "HIGH", PROBABLE: "HIGH",   UNLIKELY: "MEDIUM", RARE: "MEDIUM" },
    MINOR:      { LIKELY: "HIGH", PROBABLE: "MEDIUM", UNLIKELY: "MEDIUM", RARE: "LOW" },
    NEGLIGIBLE: { LIKELY: "MEDIUM", PROBABLE: "MEDIUM", UNLIKELY: "LOW",  RARE: "LOW" },
  };
  return grid[consequence][probability];
}

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  return parsed;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function autoInitialNextDueDate(triggerType: string, frequencyMonths: number | null): Date | null {
  if (!frequencyMonths || frequencyMonths <= 0) return null;
  const today = new Date();
  const tt = triggerType.toUpperCase();
  if (tt === "MONTHS" || tt === "CALENDAR") return addMonths(today, frequencyMonths);
  if (tt === "DAY") return addDays(today, frequencyMonths);
  if (tt === "WEEK") return addDays(today, frequencyMonths * 7);
  return null;
}

export function recalculateNextDue(
  plan: RecalculatePlanInput,
  lastExecutionDate: Date,
  lastExecutionHours: number | null,
): RecalculateResult {
  const triggerType = String(plan.triggerType || "");
  const frequencyMonths = plan.frequencyMonths ?? null;
  const frequencyHours = plan.frequencyHours ?? null;

  if (triggerType === "MONTHS" || triggerType === "CALENDAR") {
    if (frequencyMonths && frequencyMonths > 0) {
      return { nextDueDate: addMonths(lastExecutionDate, frequencyMonths), nextDueHours: null };
    }
    return { nextDueDate: null, nextDueHours: null };
  }

  if (triggerType === "HOURS" || triggerType === "RUNNING_HOURS") {
    if (lastExecutionHours !== null && frequencyHours !== null && frequencyHours > 0) {
      return { nextDueDate: null, nextDueHours: lastExecutionHours + frequencyHours };
    }
    return { nextDueDate: null, nextDueHours: null };
  }

  if (triggerType === "DAY") {
    if (frequencyMonths && frequencyMonths > 0) {
      return { nextDueDate: addDays(lastExecutionDate, frequencyMonths), nextDueHours: null };
    }
    return { nextDueDate: null, nextDueHours: null };
  }

  if (triggerType === "WEEK") {
    if (frequencyMonths && frequencyMonths > 0) {
      return { nextDueDate: addDays(lastExecutionDate, frequencyMonths * 7), nextDueHours: null };
    }
    return { nextDueDate: null, nextDueHours: null };
  }

  if (triggerType === "CONDITION" || triggerType === "EVENT") {
    return { nextDueDate: null, nextDueHours: null };
  }

  return { nextDueDate: null, nextDueHours: null };
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = maintenanceClient(prismaRaw);
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

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (!("code" in error)) return false;
  return (error as { code?: unknown }).code === "P2002";
}

async function loadRecentWorkLogs(
  workLog: WorkLogDelegate | undefined,
  tenantId: string,
  maintenancePlanId: string,
): Promise<WorkLogRecord[]> {
  if (!workLog || typeof workLog.findMany !== "function") return [];
  return workLog.findMany({
    where: { tenantId, maintenancePlanId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}

export async function listTenantMaintenancePlans(
  session: TenantAccessSession,
  filters: MaintenancePlanListFilters = {},
) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) {
    const devItems = listDevMaintenancePlansForTenant(
      session.tenantSlug,
      session.user.role,
      session.user.assignedVesselCodes,
      {
        vesselCode: filters.vesselCode,
        status: filters.status,
        triggerType: filters.triggerType,
      },
    );
    return devItems
      .map(item => ({
        ...item,
        executionStatus: deriveExecutionStatus(item as unknown as Pick<MaintenancePlanRecord, "executionStatus" | "nextDueDate" | "nextDueHours" | "triggerType">),
      }))
      .filter((item) => {
        const taskMasterId = "taskMasterId" in item ? (item as unknown as { taskMasterId?: string | null }).taskMasterId : undefined;
        if (filters.executionStatus && item.executionStatus !== filters.executionStatus) return false;
        if (filters.taskMasterId && taskMasterId !== filters.taskMasterId) return false;
        if (filters.assetId && (item as unknown as { assetId?: string }).assetId !== filters.assetId) return false;
        return true;
      });
  }
  const prisma = maintenanceClient(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.triggerType) where.triggerType = filters.triggerType;
  if (filters.executionStatus) where.executionStatus = filters.executionStatus;
  if (filters.taskMasterId) where.taskMasterId = filters.taskMasterId;
  if (filters.assetId) where.assetId = filters.assetId;

  // Omit heavy AI-generated text fields from the list response — they are
  // refetched on demand via getTenantMaintenancePlan when the user opens a row.
  // This drops ~10 KB per plan from the payload.
  const plans = await prisma.maintenancePlan.findMany({
    where,
    omit: {
      acceptanceCriteria: true,
      loto: true,
      riskAnalysisResult: true,
      consequenceRationale: true,
      checklistTemplate: true,
    },
    orderBy: [{ nextDueDate: "asc" }, { nextDueHours: "asc" }, { taskCode: "asc" }],
  });

  const planIds = plans.map((p) => p.id);
  const assetIds = [...new Set(plans.map((p) => p.assetId))];

  // Fetch asset names, current hours, and active WO codes in parallel
  const [assetRows, currentHoursRows, activeWos] = await Promise.all([
    assetIds.length > 0
      ? (prismaRaw as unknown as { asset: { findMany: (args: unknown) => Promise<{ id: string; name: string | null }[]> } }).asset.findMany({
          where: { id: { in: assetIds }, tenantId },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string | null }[]),
    assetIds.length > 0
      ? (() => {
          // Window function (ROW_NUMBER OVER PARTITION) has no direct Prisma ORM
          // equivalent. Kept as raw but explicitly scoped by tenantId for defense
          // in depth (M-02). assetIds come from a tenant-scoped findMany above
          // so the implicit scope was already correct, but explicit > implicit.
          const placeholders = assetIds.map((_: string, i: number) => `$${i + 1}`).join(", ");
          const tenantPlaceholder = `$${assetIds.length + 1}`;
          return prismaRaw.$queryRawUnsafe<{ assetId: string; runningHoursTotal: number }[]>(
            `SELECT "assetId", "runningHoursTotal"
             FROM (
               SELECT "assetId", "runningHoursTotal",
                      ROW_NUMBER() OVER (PARTITION BY "assetId" ORDER BY "createdAt" DESC) AS rn
               FROM "DailyEquipmentHours"
               WHERE "assetId" IN (${placeholders})
                 AND "tenantId" = ${tenantPlaceholder}
                 AND "runningHoursTotal" IS NOT NULL
             ) sub WHERE rn = 1`,
            ...assetIds, tenantId,
          );
        })()
      : Promise.resolve([] as { assetId: string; runningHoursTotal: number }[]),
    planIds.length > 0
      ? (prismaRaw as unknown as { workOrder: { findMany: (args: unknown) => Promise<{ maintenancePlanId: string | null; workOrderCode: string; status: string }[]> } }).workOrder.findMany({
          // ON_HOLD incluido: una OT diferida no es "activa" (no cuelga de activeWoMap),
          // pero su código debe seguir visible en el plan con marca de diferida.
          where: { tenantId, maintenancePlanId: { in: planIds }, status: { in: ["PLANNED", "IN_PROGRESS", "ON_HOLD"] }, deletedAt: null },
          select: { maintenancePlanId: true, workOrderCode: true, status: true },
          orderBy: { createdAt: "desc" as const },
        })
      : Promise.resolve([] as { maintenancePlanId: string | null; workOrderCode: string; status: string }[]),
  ]);

  const assetNameMap = new Map(assetRows.map((a) => [a.id, a.name ?? null]));
  const assetCurrentHoursMap = new Map(currentHoursRows.map((r) => [r.assetId, Number(r.runningHoursTotal)]));
  const activeWoMap = new Map<string, string>();   // OT PLANNED/IN_PROGRESS (activa)
  const deferredWoMap = new Map<string, string>(); // OT ON_HOLD (diferida)
  for (const wo of activeWos) {
    if (!wo.maintenancePlanId) continue;
    const target = wo.status === "ON_HOLD" ? deferredWoMap : activeWoMap;
    if (!target.has(wo.maintenancePlanId)) target.set(wo.maintenancePlanId, wo.workOrderCode);
  }

  // Resolver nombre del proveedor para los planes con área = PROVEEDOR.
  const providerIds = [...new Set(plans.map((p) => (p as unknown as { providerId?: string | null }).providerId).filter((v): v is string => !!v))];
  const providerRows = providerIds.length > 0
    ? await (prismaRaw as unknown as { provider: { findMany: (args: unknown) => Promise<{ id: string; name: string | null }[]> } }).provider.findMany({
        where: { id: { in: providerIds }, tenantId },
        select: { id: true, name: true },
      })
    : [];
  const providerNameMap = new Map(providerRows.map((p) => [p.id, p.name ?? null]));

  // Planes por horas sin nextDueDate no tienen dónde ubicarse en una vista de
  // calendario (Gantt). Se les estima una fecha proyectada a partir del
  // promedio de horas/día del asset — mismo cálculo que la curva de carga de
  // trabajo. Es una estimación (no un vencimiento real): el consumidor
  // (Gantt) es responsable de distinguirla visualmente si corresponde.
  const projectionAssetIds = [
    ...new Set(plans.filter((p) => p.nextDueDate == null && p.nextDueHours != null).map((p) => p.assetId)),
  ];
  const avgHoursPerDayMap = await loadAvgHoursPerDayMap(prismaRaw, tenantId, projectionAssetIds, new Date());

  return plans.map((p) => {
    const currentHours = assetCurrentHoursMap.get(p.assetId) ?? null;
    let projectedDueDate: string | null = null;
    if (p.nextDueDate == null && p.nextDueHours != null) {
      const avgPerDay = avgHoursPerDayMap.get(p.assetId) ?? 0;
      if (avgPerDay > 0) {
        const daysToNext = (p.nextDueHours - (currentHours ?? 0)) / avgPerDay;
        projectedDueDate = new Date(Date.now() + daysToNext * DAY_MS).toISOString().slice(0, 10);
      }
    }
    return {
      ...p,
      assetName: assetNameMap.get(p.assetId) ?? null,
      assetCurrentHours: currentHours,
      activeWorkOrderCode: activeWoMap.get(p.id) ?? null,
      deferredWorkOrderCode: deferredWoMap.get(p.id) ?? null,
      providerName: providerNameMap.get((p as unknown as { providerId?: string | null }).providerId ?? "") ?? null,
      executionStatus: deriveExecutionStatus(p, currentHours),
      projectedDueDate,
    };
  });
}

// ─── Dashboard summary ─────────────────────────────────────────────────────
// Returns only execution-status counts. ~50 bytes vs 755 KB of the full list.
// Logic mirrors mpStatusCounts in apps/web-modern/src/pages/Dashboard.tsx.

export interface MaintenancePlansSummary {
  counts: {
    NEVER_EXECUTED: number;
    OVERDUE: number;
    DUE: number;
    IN_WINDOW: number;
    UPCOMING: number;
    FUTURE: number;
  };
  total: number;
}

export async function getTenantMaintenancePlansSummary(
  session: TenantAccessSession,
  filters: { vesselCode?: string | null } = {},
): Promise<MaintenancePlansSummary> {
  const counts = { NEVER_EXECUTED: 0, OVERDUE: 0, DUE: 0, IN_WINDOW: 0, UPCOMING: 0, FUTURE: 0 };
  const prismaRaw = getPrismaClient();

  if (!prismaRaw) {
    const devItems = listDevMaintenancePlansForTenant(
      session.tenantSlug,
      session.user.role,
      session.user.assignedVesselCodes,
      { vesselCode: filters.vesselCode },
    );
    for (const item of devItems) {
      const status = deriveDashboardStatus({
        executionStatus: null, // Dev store does not track execution status
        lastExecutionDate: item.lastExecutionDate ?? null,
        lastExecutionHours: item.lastExecutionHours ?? null,
        nextDueDate: item.nextDueDate ?? null,
        nextDueHours: item.nextDueHours ?? null,
        assetCurrentHours: null,
      });
      counts[status]++;
    }
    return { counts, total: devItems.length };
  }

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return { counts, total: 0 };

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);

  // Minimal select — only the fields needed to compute the dashboard status.
  const planDelegate = (prismaRaw as unknown as {
    maintenancePlan: {
      findMany(args: unknown): Promise<{
        executionStatus: string | null;
        lastExecutionDate: Date | null;
        lastExecutionHours: number | null;
        nextDueDate: Date | null;
        nextDueHours: number | null;
        assetId: string;
      }[]>;
    };
  }).maintenancePlan;

  const plans = await planDelegate.findMany({
    where,
    select: {
      executionStatus: true,
      lastExecutionDate: true,
      lastExecutionHours: true,
      nextDueDate: true,
      nextDueHours: true,
      assetId: true,
    },
  });

  if (plans.length === 0) return { counts, total: 0 };

  // Latest running hours per asset (only needed when any plan is hours-based).
  const hoursPlanAssetIds = [...new Set(plans.filter(p => p.nextDueHours != null).map(p => p.assetId))];
  let assetCurrentHoursMap = new Map<string, number>();
  if (hoursPlanAssetIds.length > 0) {
    const placeholders = hoursPlanAssetIds.map((_: string, i: number) => `$${i + 1}`).join(", ");
    const tenantPlaceholder = `$${hoursPlanAssetIds.length + 1}`;
    const rows = await prismaRaw.$queryRawUnsafe<{ assetId: string; runningHoursTotal: number }[]>(
      `SELECT "assetId", "runningHoursTotal"
       FROM (
         SELECT "assetId", "runningHoursTotal",
                ROW_NUMBER() OVER (PARTITION BY "assetId" ORDER BY "createdAt" DESC) AS rn
         FROM "DailyEquipmentHours"
         WHERE "assetId" IN (${placeholders})
           AND "tenantId" = ${tenantPlaceholder}
           AND "runningHoursTotal" IS NOT NULL
       ) sub WHERE rn = 1`,
      ...hoursPlanAssetIds, tenantId,
    );
    assetCurrentHoursMap = new Map(rows.map(r => [r.assetId, Number(r.runningHoursTotal)]));
  }

  for (const p of plans) {
    const status = deriveDashboardStatus({
      executionStatus: p.executionStatus,
      lastExecutionDate: p.lastExecutionDate,
      lastExecutionHours: p.lastExecutionHours,
      nextDueDate: p.nextDueDate,
      nextDueHours: p.nextDueHours,
      assetCurrentHours: assetCurrentHoursMap.get(p.assetId) ?? null,
    });
    counts[status]++;
  }

  return { counts, total: plans.length };
}

type DashboardStatus = "NEVER_EXECUTED" | "OVERDUE" | "DUE" | "IN_WINDOW" | "UPCOMING" | "FUTURE";

function deriveDashboardStatus(p: {
  executionStatus: string | null;
  lastExecutionDate: Date | string | null;
  lastExecutionHours: number | null;
  nextDueDate: Date | string | null;
  nextDueHours: number | null;
  assetCurrentHours: number | null;
}): DashboardStatus {
  if (p.executionStatus === "IN_WINDOW") return "IN_WINDOW";

  // Un plan VENCIDO se cuenta como OVERDUE aunque nunca se haya ejecutado: el
  // vencimiento tiene prioridad sobre "nunca ejecutado". "NEVER_EXECUTED" queda
  // solo para los planes que todavía NO vencieron y nunca corrieron — coherente
  // con deriveExecutionStatus (la lista) que ya prioriza OVERDUE.
  const neverExecuted = p.lastExecutionDate == null && p.lastExecutionHours == null;

  if (p.nextDueHours != null) {
    const hours = p.assetCurrentHours ?? 0;
    const diff = p.nextDueHours - hours;
    if (diff <= 0) return "OVERDUE";
    if (neverExecuted) return "NEVER_EXECUTED";
    if (diff <= 50) return "DUE";
    if (diff <= 250) return "UPCOMING";
    return "FUTURE";
  }
  if (p.nextDueDate) {
    const due = typeof p.nextDueDate === "string" ? new Date(p.nextDueDate) : p.nextDueDate;
    const days = (due.getTime() - Date.now()) / 86_400_000;
    if (days < 0) return "OVERDUE";
    if (neverExecuted) return "NEVER_EXECUTED";
    if (days <= 7) return "DUE";
    if (days <= 30) return "UPCOMING";
    return "FUTURE";
  }
  if (neverExecuted) return "NEVER_EXECUTED";
  return "FUTURE";
}

export async function getTenantMaintenancePlan(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await prisma.maintenancePlan.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Maintenance plan no encontrado.");
  const workLogs = await loadRecentWorkLogs(prisma.workLog, record.tenantId, record.id);

  let providerName: string | null = null;
  const recProviderId = (record as unknown as { providerId?: string | null }).providerId ?? null;
  if (recProviderId) {
    try {
      const provider = await (prismaRaw as unknown as { provider: { findFirst: (a: unknown) => Promise<{ name: string | null } | null> } }).provider.findFirst({
        where: { id: recProviderId, tenantId },
        select: { name: true },
      });
      providerName = provider?.name ?? null;
    } catch { /* non-blocking */ }
  }

  return { ...record, providerName, workLogs };
}

// ---------------------------------------------------------------------------
// Delete (soft)
// ---------------------------------------------------------------------------

export async function deleteTenantMaintenancePlan(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await prisma.maintenancePlan.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Maintenance plan no encontrado.");

  await prisma.maintenancePlan.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id },
  });
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique task code for a new maintenance plan.
 * Format: {VESSEL}-{SFI_GROUP}-{SEQ:03d}   (e.g. LATERE-200-001)
 *    or:  {VESSEL}-PM-{SEQ:03d}             (e.g. LATERE-PM-001, no SFI)
 * SEQ is the next available sequence for that prefix within the tenant+vessel.
 */
export async function generateUniqueTaskCode(
  session: TenantAccessSession,
  vesselCode: string,
  sfiGroupNumber: number | null,
): Promise<string> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vc = vesselCode.toUpperCase();
  const suffix = sfiGroupNumber !== null ? String(sfiGroupNumber) : "PM";
  const prefix = `${vc}-${suffix}`;

  const existing = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: vc, deletedAt: null },
    select: { taskCode: true },
  });

  // Extract sequence numbers from codes that match the prefix pattern
  const escapedPrefix = prefix.replace(/[-]/g, "\\-");
  const regex = new RegExp(`^${escapedPrefix}-(\\d+)$`, "i");
  const seqs = existing
    .map(r => { const m = r.taskCode.match(regex); return m ? parseInt(m[1]!, 10) : 0; })
    .filter(n => n > 0);

  const nextSeq = seqs.length > 0 ? Math.max(...seqs) + 1 : 1;
  return `${prefix}-${String(nextSeq).padStart(3, "0")}`;
}

export async function createTenantMaintenancePlan(session: TenantAccessSession, payload: CreateMaintenancePlanInput) {
  ensureCanManagePlans(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);
  const assetId = normalizeRequiredText(payload.assetId, "assetId");

  // Validar tenant ownership de assetId.
  const assetCount = await (prismaRaw as any).asset.count({
    where: { id: assetId, tenantId, deletedAt: null },
  });
  if (assetCount === 0) {
    throw new RouteError(404, "ASSET_NOT_FOUND", "Asset no encontrado o no pertenece a este tenant.");
  }

  // Validar tenant ownership de taskMasterId (incluye globales).
  const taskMasterId = normalizeOptionalText(payload.taskMasterId);
  if (taskMasterId) {
    const tmCount = await (prismaRaw as any).taskMaster.count({
      where: { id: taskMasterId, OR: [{ tenantId }, { isGlobal: true }] },
    });
    if (tmCount === 0) {
      throw new RouteError(404, "TASK_MASTER_NOT_FOUND", "TaskMaster no encontrado o no pertenece a este tenant.");
    }
  }

  // Auto-generate taskCode if not provided
  const sfiGroupNumber = normalizeOptionalNumber(payload.sfiGroupNumber, "sfiGroupNumber");
  const resolvedTaskCode = payload.taskCode?.trim()
    ? payload.taskCode.trim().toUpperCase()
    : await generateUniqueTaskCode(session, vesselCode, sfiGroupNumber);

  // Riesgo: si vienen ambos ejes de la matriz, el nivel se deriva de la celda
  // (fuente única). Si no, se respeta el riskLevel explícito (compat / manual).
  const createRiskProbability = normalizeRiskProbability(payload.riskProbability);
  const createRiskConsequence = normalizeRiskConsequence(payload.riskConsequence);
  const createRiskLevel = deriveRiskLevelFromMatrix(createRiskProbability, createRiskConsequence)
    ?? normalizeRiskLevel(payload.riskLevel);

  const data: Record<string, unknown> = {
    tenantId,
    vesselCode,
    assetId,
    taskCode: resolvedTaskCode,
    title: normalizeRequiredText(payload.title, "title"),
    description: normalizeOptionalText(payload.description),
    taskType: payload.taskType ?? "MAINTENANCE",
    triggerType: payload.triggerType,
    frequencyHours: normalizeOptionalNumber(payload.frequencyHours, "frequencyHours"),
    frequencyMonths: normalizeOptionalNumber(payload.frequencyMonths, "frequencyMonths"),
    estimatedHours: normalizeOptionalNumber(payload.estimatedHours, "estimatedHours"),
    responsible: normalizeOptionalText(payload.responsible),
    department: payload.department ?? null,
    // providerId solo aplica cuando el área es PROVEEDOR; en otros casos se descarta.
    providerId: payload.department === "PROVEEDOR" ? normalizeOptionalText(payload.providerId) : null,
    acceptanceCriteria: normalizeOptionalText(payload.acceptanceCriteria),
    loto: normalizeOptionalText(payload.loto),
    sfiGroupNumber,
    sfiSubgroupCode: null,
    riskLevel: createRiskLevel,
    riskProbability: createRiskProbability,
    riskConsequence: createRiskConsequence,
    riskAnalysisResult: normalizeOptionalText(payload.riskAnalysisResult),
    consequenceCategory: payload.consequenceCategory ?? null,
    consequenceRationale: normalizeOptionalText(payload.consequenceRationale),
    status: payload.status ?? "ACTIVE",
    taskMasterId,
    samplingKind:      payload.samplingKind ?? null,
    samplingFluidType: payload.samplingFluidType ?? null,
    triggerResultMode: payload.triggerResultMode ?? "DUE_ONLY",
    checklistTemplate: normalizeOptionalText(payload.checklistTemplate),
    windowMode: payload.windowMode ?? "AUTO",
    windowLeadDays: normalizeOptionalNumber(payload.windowLeadDays, "windowLeadDays"),
    windowLeadHours: normalizeOptionalNumber(payload.windowLeadHours, "windowLeadHours"),
    windowLeadPercent: normalizeOptionalNumber(payload.windowLeadPercent, "windowLeadPercent"),
    windowOpenDate: parseOptionalDate(payload.windowOpenDate, "windowOpenDate"),
    windowOpenHours: normalizeOptionalNumber(payload.windowOpenHours, "windowOpenHours"),
    nextDueDate: parseOptionalDate(payload.nextDueDate, "nextDueDate")
      ?? autoInitialNextDueDate(String(payload.triggerType), normalizeOptionalNumber(payload.frequencyMonths, "frequencyMonths")),
    nextDueHours: normalizeOptionalNumber(payload.nextDueHours, "nextDueHours"),
    executionStatus: "FUTURE",
    createdByUserId: session.user.id,
    updatedByUserId: session.user.id,
  };

  try {
    const created = await prisma.maintenancePlan.create({ data });
    void publishAudit(prismaRaw, {
      tenantId: created.tenantId,
      actorUserId: session.user.id,
      action: "MaintenancePlan.created",
      entityType: "MaintenancePlan",
      entityId: created.id,
      metadata: { title: created.title, taskCode: created.taskCode, vesselCode: created.vesselCode },
    });
    return created;
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new RouteError(409, "DUPLICATE_TASK_CODE", `Ya existe un plan con taskCode ${String(data.taskCode)} para el vessel.`);
    }
    throw error;
  }
}

export async function updateTenantMaintenancePlan(
  session: TenantAccessSession,
  id: string,
  payload: UpdateMaintenancePlanInput,
) {
  ensureCanManagePlans(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const current = await getTenantMaintenancePlan(session, id);
  if (payload.taskCode !== undefined && normalizeRequiredText(payload.taskCode, "taskCode").toUpperCase() !== current.taskCode) {
    const duplicated = await prisma.maintenancePlan.findFirst({
      where: {
        tenantId: current.tenantId,
        vesselCode: current.vesselCode,
        taskCode: normalizeRequiredText(payload.taskCode, "taskCode").toUpperCase(),
        deletedAt: null,
      },
    });
    if (duplicated && duplicated.id !== current.id) {
      throw new RouteError(409, "DUPLICATE_TASK_CODE", "Ya existe un maintenance plan con ese taskCode.");
    }
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.taskType !== undefined && payload.taskType !== null) data.taskType = payload.taskType;
  if (payload.assetId !== undefined && payload.assetId) data.assetId = normalizeRequiredText(payload.assetId, "assetId");
  if (payload.taskCode !== undefined) data.taskCode = normalizeRequiredText(payload.taskCode, "taskCode").toUpperCase();
  if (payload.title !== undefined) data.title = normalizeRequiredText(payload.title, "title");
  if (payload.description !== undefined) data.description = normalizeOptionalText(payload.description);
  if (payload.triggerType !== undefined) data.triggerType = payload.triggerType;
  if (payload.frequencyHours !== undefined) data.frequencyHours = normalizeOptionalNumber(payload.frequencyHours, "frequencyHours");
  if (payload.frequencyMonths !== undefined) data.frequencyMonths = normalizeOptionalNumber(payload.frequencyMonths, "frequencyMonths");
  if (payload.estimatedHours !== undefined) data.estimatedHours = normalizeOptionalNumber(payload.estimatedHours, "estimatedHours");
  if (payload.responsible !== undefined) data.responsible = normalizeOptionalText(payload.responsible);
  if (payload.department !== undefined) {
    data.department = payload.department ?? null;
    // Cambiar el área a algo distinto de PROVEEDOR limpia el proveedor asociado.
    if (payload.department !== "PROVEEDOR") data.providerId = null;
  }
  if (payload.providerId !== undefined && data.providerId === undefined) {
    data.providerId = normalizeOptionalText(payload.providerId);
  }
  if (payload.acceptanceCriteria !== undefined) data.acceptanceCriteria = normalizeOptionalText(payload.acceptanceCriteria);
  if (payload.loto !== undefined) data.loto = normalizeOptionalText(payload.loto);
  if (payload.sfiGroupNumber !== undefined) data.sfiGroupNumber = normalizeOptionalNumber(payload.sfiGroupNumber, "sfiGroupNumber");
  // Riesgo: si la actualización toca alguno de los ejes de la matriz, se
  // recalcula el nivel desde la celda resultante (combinando lo enviado con lo
  // ya guardado). Si no se tocó ningún eje, se respeta el riskLevel explícito.
  const touchesMatrix = payload.riskProbability !== undefined || payload.riskConsequence !== undefined;
  if (touchesMatrix) {
    const finalProb = payload.riskProbability !== undefined
      ? normalizeRiskProbability(payload.riskProbability)
      : normalizeRiskProbability((current as any).riskProbability);
    const finalCons = payload.riskConsequence !== undefined
      ? normalizeRiskConsequence(payload.riskConsequence)
      : normalizeRiskConsequence((current as any).riskConsequence);
    data.riskProbability = finalProb;
    data.riskConsequence = finalCons;
    const derived = deriveRiskLevelFromMatrix(finalProb, finalCons);
    // Solo derivamos cuando hay celda completa; si queda incompleta y vino un
    // riskLevel explícito en el mismo payload, se respeta ese.
    data.riskLevel = derived ?? (payload.riskLevel !== undefined ? normalizeRiskLevel(payload.riskLevel) : null);
  } else if (payload.riskLevel !== undefined) {
    data.riskLevel = normalizeRiskLevel(payload.riskLevel);
  }
  if (payload.riskAnalysisResult !== undefined) data.riskAnalysisResult = normalizeOptionalText(payload.riskAnalysisResult);
  if (payload.consequenceCategory !== undefined) data.consequenceCategory = payload.consequenceCategory ?? null;
  if (payload.consequenceRationale !== undefined) data.consequenceRationale = normalizeOptionalText(payload.consequenceRationale);
  if (payload.status !== undefined) data.status = payload.status;
  if (payload.taskMasterId !== undefined) data.taskMasterId = normalizeOptionalText(payload.taskMasterId);
  if (payload.samplingKind !== undefined)      data.samplingKind      = payload.samplingKind ?? null;
  if (payload.samplingFluidType !== undefined) data.samplingFluidType = payload.samplingFluidType ?? null;
  if (payload.triggerResultMode !== undefined) data.triggerResultMode = payload.triggerResultMode;
  if (payload.checklistTemplate !== undefined) data.checklistTemplate = normalizeOptionalText(payload.checklistTemplate);
  if (payload.windowMode !== undefined) data.windowMode = payload.windowMode;
  if (payload.windowLeadDays !== undefined) data.windowLeadDays = normalizeOptionalNumber(payload.windowLeadDays, "windowLeadDays");
  if (payload.windowLeadHours !== undefined) data.windowLeadHours = normalizeOptionalNumber(payload.windowLeadHours, "windowLeadHours");
  if (payload.windowLeadPercent !== undefined) data.windowLeadPercent = normalizeOptionalNumber(payload.windowLeadPercent, "windowLeadPercent");
  if (payload.windowOpenDate !== undefined) data.windowOpenDate = parseOptionalDate(payload.windowOpenDate, "windowOpenDate");
  if (payload.windowOpenHours !== undefined) data.windowOpenHours = normalizeOptionalNumber(payload.windowOpenHours, "windowOpenHours");
  if (payload.nextDueDate !== undefined) data.nextDueDate = parseOptionalDate(payload.nextDueDate, "nextDueDate");
  if (payload.nextDueHours !== undefined) data.nextDueHours = normalizeOptionalNumber(payload.nextDueHours, "nextDueHours");
  if (payload.executionStatus !== undefined) data.executionStatus = payload.executionStatus;
  if (payload.lastExecutionDate !== undefined) data.lastExecutionDate = parseOptionalDate(payload.lastExecutionDate, "lastExecutionDate");
  if (payload.lastExecutionHours !== undefined) data.lastExecutionHours = normalizeOptionalNumber(payload.lastExecutionHours, "lastExecutionHours");

  // Auto-calculate nextDueDate if it's still null after updates
  if (!data.nextDueDate && !current.nextDueDate) {
    const tt = String((data.triggerType ?? current.triggerType) || "");
    const freq = (data.frequencyMonths as number | null) ?? current.frequencyMonths;
    const calculated = autoInitialNextDueDate(tt, freq);
    if (calculated) data.nextDueDate = calculated;
  }

  const updated = await prisma.maintenancePlan.update({ where: { id: current.id }, data });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "MaintenancePlan.updated",
    entityType: "MaintenancePlan",
    entityId: current.id,
    metadata: { title: current.title, taskCode: current.taskCode, vesselCode: current.vesselCode },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// generateWorkOrderCode — código único de OT ({PREFIX}-{VESSEL}-{YY}-{NNNN}).
// Usa MAX del número de secuencia (no COUNT) para tolerar renombrados/backdating
// sin duplicar; match de prefijo-agnóstico (3 chars WO-/SS-) para continuar la
// secuencia al cambiar de prefijo. Reutilizado por openFormalWorkOrder y por la
// OT automática de quickClosePlan.
// ---------------------------------------------------------------------------
async function generateWorkOrderCode(
  prismaRaw: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantSlug: string | null | undefined,
  tenantId: string,
  vesselCode: string,
): Promise<string> {
  const woYY = String(new Date().getFullYear()).slice(-2);
  const codeBody = `${vesselCode}-${woYY}-`;
  const codePrefix = `${workOrderPrefix(tenantSlug)}-${codeBody}`;
  const maxSeqRows = await prismaRaw.$queryRawUnsafe<{ max_seq: number | null }[]>(
    `SELECT MAX(CAST(SUBSTRING("workOrderCode", ${codePrefix.length + 1}) AS INTEGER)) AS max_seq
     FROM "WorkOrder"
     WHERE "tenantId" = $1 AND "vesselCode" = $2
       AND SUBSTRING("workOrderCode", 4) LIKE $3 AND "deletedAt" IS NULL`,
    tenantId,
    vesselCode,
    codeBody + "%",
  );
  const maxSeq = maxSeqRows[0]?.max_seq ?? 0;
  return `${workOrderPrefix(tenantSlug)}-${vesselCode}-${woYY}-${String(maxSeq + 1).padStart(4, "0")}`;
}

export async function quickClosePlan(
  session: TenantAccessSession,
  id: string,
  payload: QuickClosePlanInput,
) {
  ensureCanManagePlans(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const plan = await getTenantMaintenancePlan(session, id);

  // Consumo de repuestos (Mantenimiento Express): validar/resolver ANTES de la
  // transacción para fallar temprano si algún repuesto no es del buque/tenant.
  const resolvedConsumables = payload.spareUsages?.length
    ? await resolveConsumables(prismaRaw, { tenantId: plan.tenantId, vesselCode: plan.vesselCode }, payload.spareUsages)
    : [];

  const completedAt = parseOptionalDate(payload.completedAt, "completedAt") ?? new Date();
  const runningHoursAtExecution = normalizeOptionalNumber(payload.runningHoursAtExecution, "runningHoursAtExecution");
  const hoursWorked = normalizeOptionalNumber(payload.hoursWorked, "hoursWorked");
  const result = payload.result;
  const logCode = `LOG-${plan.vesselCode}-${Date.now()}`;
  const nextDue = recalculateNextDue(
    {
      triggerType: plan.triggerType,
      frequencyHours: plan.frequencyHours,
      frequencyMonths: plan.frequencyMonths,
    },
    completedAt,
    runningHoursAtExecution,
  );

  const executedByName = normalizeRequiredText(payload.executedByName, "executedByName");
  const planAny = plan as any;
  // Toda ejecución sin flujo de OT (DUE_ONLY / CHECKLIST / EXPRESS) genera igual
  // un registro de OT: nace AUTORIZADA (firmada por "Sistema", sin aprobación
  // manual) y ya CERRADA. AUTO_WO/APPROVAL_WO no pasan por quickClosePlan (usan
  // openFormalWorkOrder), así que el registro queda naturalmente acotado.
  const shouldCreateWo = planAny.triggerResultMode !== "AUTO_WO" && planAny.triggerResultMode !== "APPROVAL_WO";
  const autoWoCode = shouldCreateWo
    ? await generateWorkOrderCode(prismaRaw, session.tenantSlug, plan.tenantId, plan.vesselCode)
    : null;

  const txResult = await prisma.$transaction(async (tx) => {
    // OT automática (registro): nace AUTORIZADA por Sistema y ya cerrada.
    const workOrder = shouldCreateWo && autoWoCode
      ? await tx.workOrder.create({
          data: {
            tenantId: plan.tenantId,
            vesselCode: plan.vesselCode,
            assetId: plan.assetId,
            maintenancePlanId: plan.id,
            workOrderCode: autoWoCode,
            type: plan.taskType === "INSPECTION" ? "INSPECTION" : "PREVENTIVE",
            status: "CLOSED",
            priority: "MEDIUM",
            openDate: completedAt,
            createdAt: completedAt,
            completedDate: completedAt,
            woResult: result === "COMPLETED" ? "SATISFACTORY" : "WITH_DEFICIENCIES",
            executedByName,
            observations: normalizeOptionalText(payload.notes),
            runningHoursAtExecution,
            actualHours: hoursWorked,
            title: plan.title,
            description: plan.description,
            taskMasterId: plan.taskMasterId ?? null,
            department: planAny.department ?? null,
            providerId: planAny.providerId ?? null,
            // Tramitación automática: aprobada + autorizada por Sistema (sin firma humana).
            aprobadoByName: "Sistema",
            aprobadoAt: completedAt,
            autorizadoByName: "Sistema",
            autorizadoAt: completedAt,
            createdByUserId: session.user.id,
            updatedByUserId: session.user.id,
          },
        })
      : null;

    const workLog = await tx.workLog.create({
      data: {
        tenantId: plan.tenantId,
        vesselCode: plan.vesselCode,
        workOrderId: workOrder?.id ?? null,
        maintenancePlanId: plan.id,
        assetId: plan.assetId,
        logCode,
        taskType: plan.taskType,
        result,
        startedAt: completedAt,
        completedAt,
        // El admin puede reportar en nombre de otro usuario (executedByUserId elegido);
        // si no se especifica, queda quien reporta. createdByUserId siempre es el actor real.
        executedByUserId: (payload.executedByUserId && String(payload.executedByUserId).trim()) || session.user.id,
        executedByName,
        hoursWorked,
        runningHoursAtExecution,
        notes: normalizeOptionalText(payload.notes),
        followUpRequired: result === "FOLLOW_UP_REQUIRED",
        createdByUserId: session.user.id,
      },
    });

    if (resolvedConsumables.length > 0) {
      await createWorkLogSpareMovements(
        tx,
        { tenantId: plan.tenantId, vesselCode: plan.vesselCode },
        workLog.id,
        logCode,
        resolvedConsumables,
        session.user.id,
      );
    }

    const updatedPlan = await tx.maintenancePlan.update({
      where: { id: plan.id },
      data: {
        lastExecutionDate: completedAt,
        lastExecutionHours: runningHoursAtExecution,
        nextDueDate: nextDue.nextDueDate,
        nextDueHours: nextDue.nextDueHours,
        executionStatus: "COMPLETED",
        updatedByUserId: session.user.id,
      },
    });
    const workLogs = await loadRecentWorkLogs(tx.workLog, plan.tenantId, plan.id);

    return { plan: { ...updatedPlan, workLogs }, workLog, workOrder };
  });
  void publishAudit(prismaRaw, {
    tenantId: plan.tenantId,
    actorUserId: session.user.id,
    action: "MaintenancePlan.executed",
    entityType: "MaintenancePlan",
    entityId: plan.id,
    metadata: {
      title: plan.title,
      taskCode: plan.taskCode,
      vesselCode: plan.vesselCode,
      result,
      executedByName: payload.executedByName,
      completedAt: completedAt.toISOString(),
    },
  });
  if (txResult.workOrder) {
    void publishAudit(prismaRaw, {
      tenantId: plan.tenantId,
      actorUserId: session.user.id,
      action: "WorkOrder.autoClosedFromPlan",
      entityType: "WorkOrder",
      entityId: txResult.workOrder.id,
      metadata: {
        workOrderCode: txResult.workOrder.workOrderCode,
        planId: plan.id,
        taskCode: plan.taskCode,
        vesselCode: plan.vesselCode,
        triggerResultMode: planAny.triggerResultMode,
        completedAt: completedAt.toISOString(),
      },
    });
  }
  return txResult;
}

// ── Historial de ejecuciones del plan ────────────────────────────────────────
// Cada ejecución de un plan queda registrada como una WorkOrder con
// maintenancePlanId = plan.id (las express además tienen un WorkLog espejo por
// workOrderId). La OT es por tanto la fuente canónica y completa del historial.

export interface UpdatePlanExecutionInput {
  completedDate?: string | Date | null;
  executedByName?: string | null;
  runningHoursAtExecution?: number | null;
  woResult?: string | null;
  observations?: string | null;
}

/** Lista las ejecuciones (OTs) de un plan, más recientes primero. Read scope = poder ver el plan. */
export async function listPlanExecutions(session: TenantAccessSession, planId: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  // getTenantMaintenancePlan aplica scope tenant/vessel y lanza 404 si no hay acceso.
  const plan = await getTenantMaintenancePlan(session, planId);

  const rows = await prisma.workOrder.findMany({
    where: { tenantId: plan.tenantId, maintenancePlanId: plan.id, deletedAt: null },
    orderBy: [{ completedDate: "desc" }, { openDate: "desc" }],
    select: {
      id: true, workOrderCode: true, status: true, type: true,
      openDate: true, completedDate: true, executedByName: true,
      runningHoursAtExecution: true, woResult: true, observations: true,
    },
  });
  return rows;
}

/**
 * Edita una ejecución del historial (fecha / ejecutado por / horas / resultado /
 * observaciones) sobre la OT que la representa, incluso si está CERRADA — es una
 * corrección de historial acotada, solo admin (canManagePlans). No pasa por el
 * candado de OT (assertNotLocked) a propósito: no reabre la OT ni toca su
 * tramitación, solo estos campos. Sincroniza el WorkLog espejo (ejecución
 * express) para que el copiloto y los reportes vean datos coherentes, y refresca
 * lastExecution/nextDue del plan desde la ejecución más reciente.
 */
export async function updatePlanExecution(
  session: TenantAccessSession,
  planId: string,
  workOrderId: string,
  payload: UpdatePlanExecutionInput,
) {
  ensureCanManagePlans(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const plan = await getTenantMaintenancePlan(session, planId);

  // La OT debe existir, ser de este tenant y pertenecer a este plan.
  const wo = await prisma.workOrder.findFirst({
    where: { id: workOrderId, tenantId: plan.tenantId, maintenancePlanId: plan.id, deletedAt: null },
    select: { id: true, workOrderCode: true, status: true, type: true, openDate: true, completedDate: true, executedByName: true, runningHoursAtExecution: true, woResult: true, observations: true },
  });
  if (!wo) throw new RouteError(404, "EXECUTION_NOT_FOUND", "Ejecución no encontrada para este plan.");

  const woData: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.completedDate !== undefined) woData.completedDate = parseOptionalDate(payload.completedDate, "completedDate");
  if (payload.executedByName !== undefined) woData.executedByName = normalizeOptionalText(payload.executedByName);
  if (payload.runningHoursAtExecution !== undefined) woData.runningHoursAtExecution = normalizeOptionalNumber(payload.runningHoursAtExecution, "runningHoursAtExecution");
  if (payload.woResult !== undefined) woData.woResult = normalizeOptionalText(payload.woResult);
  if (payload.observations !== undefined) woData.observations = normalizeOptionalText(payload.observations);

  await prisma.$transaction(async (tx) => {
    await tx.workOrder.update({ where: { id: wo.id }, data: woData });

    // Sincronizar el WorkLog espejo (solo existe en ejecuciones express).
    const logData: Record<string, unknown> = {};
    if (payload.completedDate !== undefined) logData.completedAt = woData.completedDate;
    // executedByName en WorkLog es NOT NULL: solo se sincroniza si hay valor.
    if (payload.executedByName !== undefined && woData.executedByName) logData.executedByName = woData.executedByName;
    if (payload.runningHoursAtExecution !== undefined) logData.runningHoursAtExecution = woData.runningHoursAtExecution;
    if (payload.observations !== undefined) logData.notes = woData.observations;
    if (Object.keys(logData).length > 0) {
      await tx.workLog.updateMany({ where: { workOrderId: wo.id, tenantId: plan.tenantId }, data: logData });
    }

    // Refrescar el resumen del plan desde la ejecución más reciente (por fecha).
    const latest = await tx.workOrder.findFirst({
      where: { tenantId: plan.tenantId, maintenancePlanId: plan.id, deletedAt: null, completedDate: { not: null } },
      orderBy: { completedDate: "desc" },
      select: { completedDate: true, runningHoursAtExecution: true },
    });
    if (latest?.completedDate) {
      const nextDue = recalculateNextDue(
        { triggerType: plan.triggerType, frequencyHours: plan.frequencyHours, frequencyMonths: plan.frequencyMonths },
        latest.completedDate,
        latest.runningHoursAtExecution ?? null,
      );
      await tx.maintenancePlan.update({
        where: { id: plan.id },
        data: {
          lastExecutionDate: latest.completedDate,
          lastExecutionHours: latest.runningHoursAtExecution ?? null,
          nextDueDate: nextDue.nextDueDate,
          nextDueHours: nextDue.nextDueHours,
          updatedByUserId: session.user.id,
        },
      });
    }
  });

  void publishAudit(prismaRaw, {
    tenantId: plan.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.executionEdited",
    entityType: "WorkOrder",
    entityId: wo.id,
    metadata: {
      workOrderCode: wo.workOrderCode,
      planId: plan.id,
      taskCode: plan.taskCode,
      vesselCode: plan.vesselCode,
      changed: Object.keys(payload),
    },
  });

  return listPlanExecutions(session, planId);
}

export async function completeChecklistPlan(
  session: TenantAccessSession,
  id: string,
  payload: CompleteChecklistInput,
) {
  const noteParts: string[] = [];
  const noteText = String(payload.notes ?? "").trim();
  if (noteText) noteParts.push(noteText);
  if (payload.checklistFileName) noteParts.push(`[Checklist: ${payload.checklistFileName}]`);

  return quickClosePlan(session, id, {
    result: payload.result,
    executedByName: payload.executedByName,
    notes: noteParts.length > 0 ? noteParts.join("\n") : null,
    completedAt: payload.completedAt,
    runningHoursAtExecution: payload.runningHoursAtExecution,
    hoursWorked: payload.hoursWorked,
  });
}

export async function openFormalWorkOrder(
  session: TenantAccessSession,
  id: string,
  payload: OpenFormalWorkOrderInput,
) {
  ensureCanOpenWorkOrderFromPlan(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);

  const plan = await getTenantMaintenancePlan(session, id);
  const workOrderCode = await generateWorkOrderCode(prismaRaw, session.tenantSlug, plan.tenantId, plan.vesselCode);

  // Hereda del plan cuando el payload no lo provee. Si el payload manda
  // el campo (incluso vacío "", el normalizeOptionalText lo convertirá a
  // null), respeta esa intención del usuario.
  const inherit = <T>(payloadValue: unknown, planValue: T | null | undefined): T | null => {
    if (payloadValue === undefined) return (planValue ?? null) as T | null;
    const txt = normalizeOptionalText(payloadValue as string | null | undefined);
    return (txt as unknown as T) ?? null;
  };
  const planAny = plan as any;

  // Solo TENANT_ADMIN puede registrar una fecha de apertura distinta (backdating)
  // o abrir la OT en nombre de otro usuario (queda como SOLICITA / createdByUserId).
  // Para el resto, se usa la fecha actual y el propio usuario. El actor real
  // siempre queda en el audit log.
  const isAdmin = session.user.role === "TENANT_ADMIN";
  let woOpenDate: Date = new Date();
  let woCreatorId = session.user.id;
  if (isAdmin) {
    const backdated = parseOptionalDate(payload.openDate, "openDate");
    if (backdated) woOpenDate = backdated;
    const onBehalf = normalizeOptionalText(payload.createdByUserId);
    if (onBehalf && onBehalf !== session.user.id) {
      const membership = await (prismaRaw as any).tenantMembership.findFirst({
        where: { tenantId: plan.tenantId, userId: onBehalf },
        select: { userId: true },
      });
      if (!membership) throw new RouteError(400, "USER_NOT_IN_TENANT", "El usuario indicado no pertenece a esta empresa.");
      woCreatorId = onBehalf;
    }
  }

  // OT Express: se firma sola a nombre de quien la abre. Sin esto la OT quedaría
  // AUTORIZADA con las firmas en blanco, que es peor que no tenerla autorizada:
  // el papel saldría diciendo que alguien la habilitó sin decir quién.
  const isExpress = payload.express === true;
  const expressSigner = normalizeOptionalText(payload.signerName) ?? null;
  const expressStamps = isExpress
    ? {
        aprobadoByName:   expressSigner,
        aprobadoByUserId: woCreatorId,
        aprobadoAt:       woOpenDate,
        autorizadoByName:   expressSigner,
        autorizadoByUserId: woCreatorId,
        autorizadoAt:       woOpenDate,
      }
    : {};

  const woTxResult = await prisma.$transaction(async (tx) => {
    const workOrder = await tx.workOrder.create({
      data: {
        tenantId: plan.tenantId,
        vesselCode: plan.vesselCode,
        assetId: plan.assetId,
        maintenancePlanId: plan.id,
        workOrderCode,
        type: "PREVENTIVE",
        status: "PLANNED",
        ...expressStamps,
        priority: payload.priority ?? "MEDIUM",
        openDate: woOpenDate,
        // createdAt alineado a la fecha de apertura: así en el PDF coinciden la
        // FECHA y la fecha de la firma de SOLICITA (que se toma de createdAt).
        createdAt: woOpenDate,
        dueDate: parseOptionalDate(payload.dueDate, "dueDate"),
        title: normalizeOptionalText(payload.title) ?? plan.title,
        description: normalizeOptionalText(payload.description) ?? plan.description,
        assignedToUserId: normalizeOptionalText(payload.assignedToUserId),
        estimatedHours: payload.estimatedHours !== undefined
          ? normalizeOptionalNumber(payload.estimatedHours, "estimatedHours")
          : (planAny.estimatedHours ?? null),
        taskMasterId: plan.taskMasterId ?? null,
        acceptanceCriteria: inherit<string>(payload.acceptanceCriteria, planAny.acceptanceCriteria),
        loto: inherit<string>(payload.loto, planAny.loto),
        riskLevel: inherit<string>(payload.riskLevel, planAny.riskLevel),
        riskAnalysisResult: inherit<string>(payload.riskAnalysisResult, planAny.riskAnalysisResult),
        consequenceCategory: payload.consequenceCategory !== undefined
          ? (payload.consequenceCategory ?? null)
          : (planAny.consequenceCategory ?? null),
        consequenceRationale: inherit<string>(payload.consequenceRationale, planAny.consequenceRationale),
        // Área / responsable: se hereda del plan a la OT.
        department: planAny.department ?? null,
        providerId: planAny.providerId ?? null,
        createdByUserId: woCreatorId,
        updatedByUserId: woCreatorId,
      },
    });

    await tx.maintenancePlan.update({
      where: { id: plan.id },
      data: {
        executionStatus: "IN_WINDOW",
        updatedByUserId: session.user.id,
      },
    });

    return workOrder;
  });
  void publishAudit(prismaRaw, {
    tenantId: plan.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.openedFromPlan",
    entityType: "WorkOrder",
    entityId: woTxResult.id,
    metadata: {
      workOrderCode: woTxResult.workOrderCode,
      planTitle: plan.title,
      planId: plan.id,
      vesselCode: plan.vesselCode,
      // Trazabilidad cuando un admin abre en nombre de otro / backdatea.
      onBehalfOf: woCreatorId !== session.user.id ? woCreatorId : undefined,
      openDate: woOpenDate.toISOString(),
      // Deja explícito que esta OT nació AUTORIZADA sin pasar por la
      // tramitación: es la excepción y tiene que poder auditarse como tal.
      express: isExpress || undefined,
      expressSigner: isExpress ? expressSigner : undefined,
    },
  });
  return woTxResult;
}

// ---------------------------------------------------------------------------
// reportExecution — simplified execution flow without requiring a Work Order
// ---------------------------------------------------------------------------

export interface ReportExecutionInput {
  executedByName: string;
  executedByUserId?: string | null;
  result: "SATISFACTORIO" | "CON_DEFICIENCIAS";
  notes?: string | null;
  deficienciesNotes?: string | null;
  completedAt?: string | Date | null;
  runningHoursAtExecution?: number | null;
  hoursWorked?: number | null;
  spareUsages?: Array<{ spareId: string; qty: number; unit?: string | null }>;
}

export async function reportExecution(
  session: TenantAccessSession,
  id: string,
  payload: ReportExecutionInput,
) {
  const workLogResult =
    payload.result === "SATISFACTORIO" ? "COMPLETED" : "COMPLETED_WITH_OBSERVATIONS";

  const noteParts: string[] = [];
  if (String(payload.notes ?? "").trim()) noteParts.push(String(payload.notes!).trim());
  if (String(payload.deficienciesNotes ?? "").trim())
    noteParts.push(`[Deficiencias]: ${String(payload.deficienciesNotes!).trim()}`);

  const closeResult = await quickClosePlan(session, id, {
    result: workLogResult,
    executedByName: normalizeRequiredText(payload.executedByName, "executedByName"),
    executedByUserId: payload.executedByUserId ?? null,
    notes: noteParts.join("\n\n") || null,
    completedAt: payload.completedAt,
    runningHoursAtExecution: normalizeOptionalNumber(payload.runningHoursAtExecution, "runningHoursAtExecution"),
    hoursWorked: normalizeOptionalNumber(payload.hoursWorked, "hoursWorked"),
    spareUsages: payload.spareUsages,
  });

  return {
    ...closeResult,
    hasDeficiencies: payload.result === "CON_DEFICIENCIAS",
    deficienciesNotes: normalizeOptionalText(payload.deficienciesNotes),
  };
}

// ---------------------------------------------------------------------------
// getLastSpareUsage — repuestos consumidos en la última ejecución del plan.
// Alimenta el prellenado del reporte de Mantenimiento Express.
// ---------------------------------------------------------------------------

export async function getLastSpareUsage(session: TenantAccessSession, planId: string) {
  const plan = await getTenantMaintenancePlan(session, planId);
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return { lines: [] as Array<{ spareId: string; qty: number; unit: string }> };
  const db = prismaRaw as any;

  const lastLog = await db.workLog.findFirst({
    where: { tenantId: plan.tenantId, maintenancePlanId: plan.id },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!lastLog) return { lines: [] };

  const movements = await db.stockMovement.findMany({
    where: { tenantId: plan.tenantId, referenceType: "WORK_LOG", referenceId: lastLog.id, movementType: "ISSUE" },
    select: { spareId: true, quantity: true, unit: true },
  });

  return {
    lines: movements.map((m: any) => ({ spareId: m.spareId, qty: m.quantity, unit: m.unit })),
  };
}

// ---------------------------------------------------------------------------
// postponePlan — creates a Deferral linked to this plan
// ---------------------------------------------------------------------------

export interface PostponePlanInput {
  newDueDate?: string | Date | null;
  newDueHours?: number | null;
  justification: string;
  compensatoryMeasures?: string | null;
  authorizedBy?: string | null;
}

type MinimalDeferralRow = { deferralCode: string };

type DeferralWriteDelegate = {
  findMany(args: { where: Record<string, unknown> }): Promise<MinimalDeferralRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<{ id: string; deferralCode: string; status: string }>;
};

export async function postponePlan(
  session: TenantAccessSession,
  id: string,
  payload: PostponePlanInput,
) {
  ensureCanManagePlans(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = maintenanceClient(prismaRaw);
  const deferral = (prismaRaw as unknown as { deferral: DeferralWriteDelegate }).deferral;

  const plan = await getTenantMaintenancePlan(session, id);
  const justification = normalizeRequiredText(payload.justification, "justification");
  const authorizedBy = normalizeOptionalText(payload.authorizedBy);
  const newDueDate = parseOptionalDate(payload.newDueDate, "newDueDate");
  const newDueHours = normalizeOptionalNumber(payload.newDueHours, "newDueHours");

  const aplYear = new Date().getFullYear();
  const aplYY = String(aplYear).slice(-2);
  const deferralsThisYear = await (deferral as any).findMany({ where: { tenantId: plan.tenantId, vesselCode: plan.vesselCode, createdAt: { gte: new Date(aplYear, 0, 1), lt: new Date(aplYear + 1, 0, 1) } } });
  const deferralCode = `APL-${plan.vesselCode}-${aplYY}-${String(deferralsThisYear.length + 1).padStart(4, "0")}`;

  const deferralStatus = authorizedBy ? "APPROVED" : "REQUESTED";
  const now = new Date();

  const created = await deferral.create({
    data: {
      tenantId: plan.tenantId,
      vesselCode: plan.vesselCode,
      assetId: plan.assetId,
      deferralCode,
      sourceType: "MAINTENANCE_PLAN",
      sourceId: plan.id,
      status: deferralStatus,
      requestedAt: now,
      requestedByUserId: session.user.id,
      targetDate: newDueDate,
      justification,
      compensatoryMeasures: normalizeOptionalText(payload.compensatoryMeasures),
      reviewNotes: authorizedBy ? `Autorizado por: ${authorizedBy}` : null,
      decidedByUserId: authorizedBy ? session.user.id : null,
      decisionAt: authorizedBy ? now : null,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  // When authorized and new due values are provided, update the plan
  let updatedPlan = plan;
  if (authorizedBy && (newDueDate || newDueHours !== null)) {
    const updateData: Record<string, unknown> = { updatedByUserId: session.user.id };
    if (newDueDate) updateData.nextDueDate = newDueDate;
    if (newDueHours !== null) updateData.nextDueHours = newDueHours;
    updatedPlan = await prisma.maintenancePlan.update({ where: { id: plan.id }, data: updateData }) as any;
  }

  void publishAudit(prismaRaw, {
    tenantId: plan.tenantId,
    actorUserId: session.user.id,
    action: "MaintenancePlan.postponed",
    entityType: "MaintenancePlan",
    entityId: plan.id,
    metadata: {
      deferralCode,
      taskCode: plan.taskCode,
      vesselCode: plan.vesselCode,
      authorizedBy,
      status: deferralStatus,
    },
  });

  return { deferral: created, plan: updatedPlan };
}

// ---------------------------------------------------------------------------
// restorePlanAfterWoCancellation — revert plan executionStatus when its WO is cancelled
// ---------------------------------------------------------------------------

export async function restorePlanAfterWoCancellation(
  session: TenantAccessSession,
  planId: string,
): Promise<void> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return;
  const prisma = maintenanceClient(prismaRaw);

  const plan = await prisma.maintenancePlan.findFirst({ where: { id: planId, deletedAt: null } });
  if (!plan) return;

  // Planes por horas necesitan el acumulado actual del asset para no caer
  // siempre en "FUTURE" (mismo patrón que listTenantMaintenancePlans/deriveDashboardStatus).
  let currentHours: number | null = null;
  if (plan.nextDueHours != null) {
    const rows = await prismaRaw.$queryRawUnsafe<{ runningHoursTotal: number }[]>(
      `SELECT "runningHoursTotal" FROM "DailyEquipmentHours"
       WHERE "assetId" = $1 AND "tenantId" = $2 AND "runningHoursTotal" IS NOT NULL
       ORDER BY "createdAt" DESC LIMIT 1`,
      plan.assetId, plan.tenantId,
    );
    currentHours = rows[0]?.runningHoursTotal != null ? Number(rows[0].runningHoursTotal) : null;
  }

  // Re-derive status ignoring the IN_WINDOW override (WO no longer active)
  const restoredStatus = deriveExecutionStatus({ ...plan, executionStatus: null }, currentHours);

  await prisma.maintenancePlan.update({
    where: { id: planId },
    data: { executionStatus: restoredStatus, updatedByUserId: session.user.id },
  });
}

// ---------------------------------------------------------------------------
// Maintenance workload projection — line chart (next N weeks)
// ---------------------------------------------------------------------------
// Para cada plan activo, proyecta sus próximas ocurrencias dentro de la ventana
// configurada y agrupa por semana (lunes UTC). Soporta:
//   - Planes por fecha (MONTHS / CALENDAR / DAY / WEEK): itera nextDueDate +
//     frecuencia en la unidad correspondiente.
//   - Planes por horas (HOURS / RUNNING_HOURS): estima horas/día promedio del
//     asset (últimos 90 días en DailyEquipmentHours) y traduce frequencyHours
//     a días reales. Si no hay historia suficiente, se reporta como
//     "unscheduledHoursPlans" para que la UI lo informe al usuario.
//
// Etapa actual: cuenta tareas. Etapa futura: cuando exista un campo
// `estimatedExecutionHours` en MaintenancePlan, sumar horas en lugar de tareas.

export interface MaintenanceWorkloadFilters {
  vesselCode?: string | null;
  weeks?: number;
  /**
   * Si se especifica (YYYY-MM-DD del lunes UTC de una semana del rango), además de la
   * curva se devuelve `weekPlanIds`: los planes con ≥1 ocurrencia proyectada en ESA
   * semana. Permite que al clickear un pico se abra el listado con exactamente esas tareas
   * (incluye recurrencias y planes por horas — coincide 1:1 con la curva).
   */
  detailWeekStart?: string | null;
}

export interface WorkloadWeek {
  weekStart: string;   // YYYY-MM-DD del lunes UTC
  taskCount: number;
  dateBased: number;
  hoursBased: number;
  /** Horas-hombre estimadas que caen en esta semana (suma de plan.estimatedHours por cada ocurrencia proyectada). */
  laborHours: number;
}

export interface MaintenanceWorkloadProjection {
  weeks: WorkloadWeek[];
  totalPlans: number;
  projectedPlans: number;
  unscheduledHoursPlans: number;
  unscheduledDatePlans: number;
  /** Cantidad de planes proyectados que no tienen estimatedHours definido. Indica cuánto de la curva de horas no está siendo contado. */
  plansWithoutEstimate: number;
  /**
   * Planes vencidos (backlog): por fecha cuya próxima ocurrencia natural quedó
   * antes de la semana actual, o por horas cuyas horas de marcha ya superaron
   * nextDueHours. NO se vuelcan a la semana 1 — se reportan como métrica aparte
   * para no inflar la proyección semanal con trabajo atrasado.
   */
  overduePlans: number;
  /** Horas-hombre estimadas acumuladas de los planes vencidos. */
  overdueHours: number;
  /** IDs de planes con ≥1 ocurrencia en filters.detailWeekStart (solo si se pidió). */
  weekPlanIds?: string[];
}

const DAY_MS = 86_400_000;
const HOURS_HISTORY_WINDOW_DAYS = 90;
// Un horómetro no puede acumular más de 24 h de marcha por día calendario. Si el
// historial arroja un promedio mayor, es dato corrupto (saltos de runningHoursTotal)
// → se acota a 24 para no producir intervalos absurdamente cortos en la proyección.
const MAX_RUNNING_HOURS_PER_DAY = 24;

function startOfWeekUtcMonday(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = out.getUTCDay(); // 0=Sun..6=Sat
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  out.setUTCDate(out.getUTCDate() + offsetToMonday);
  return out;
}

function addUtcDays(d: Date, days: number): Date {
  // Aritmética por milisegundos: setUTCDate(x + 0.16) trunca la fracción y NO avanza
  // el cursor, lo que apilaba ocurrencias en la misma fecha cuando daysBetween < 1.
  return new Date(d.getTime() + days * DAY_MS);
}

function addUtcMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Avanza una fecha según triggerType + frecuencia. Refleja la semántica usada
 * en `recalculateNextDue` para los triggers de fecha.
 *  - MONTHS / CALENDAR → meses
 *  - WEEK              → semanas (frequencyMonths se usa como nº de semanas)
 *  - DAY               → días   (frequencyMonths se usa como nº de días)
 * Devuelve null si no aplica o si la frecuencia es inválida.
 */
function advanceDateOccurrence(
  triggerType: string,
  freq: number | null | undefined,
  from: Date,
): Date | null {
  if (!freq || freq <= 0) return null;
  if (triggerType === "MONTHS" || triggerType === "CALENDAR") return addUtcMonths(from, freq);
  if (triggerType === "WEEK") return addUtcDays(from, freq * 7);
  if (triggerType === "DAY") return addUtcDays(from, freq);
  return null;
}

function isHoursTrigger(triggerType: string): boolean {
  return triggerType === "HOURS" || triggerType === "RUNNING_HOURS";
}

function isDateTrigger(triggerType: string): boolean {
  return triggerType === "MONTHS" || triggerType === "CALENDAR" || triggerType === "DAY" || triggerType === "WEEK";
}

/**
 * Promedio de horas de marcha por día calendario, por asset, en base a los
 * últimos HOURS_HISTORY_WINDOW_DAYS días de DailyEquipmentHours. Usado para
 * traducir un vencimiento por horas (nextDueHours) a una fecha proyectada
 * estimada — tanto para la curva de carga de trabajo como para el Gantt.
 */
async function loadAvgHoursPerDayMap(
  prismaRaw: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  assetIds: string[],
  today: Date,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (assetIds.length === 0) return map;
  const sinceDate = addUtcDays(today, -HOURS_HISTORY_WINDOW_DAYS);
  const placeholders = assetIds.map((_, i) => `$${i + 1}`).join(", ");
  const tenantPlaceholder = `$${assetIds.length + 1}`;
  const sincePlaceholder = `$${assetIds.length + 2}`;
  const historyRows = await prismaRaw.$queryRawUnsafe<{
    assetId: string;
    minHours: number;
    maxHours: number;
    minAt: Date;
    maxAt: Date;
  }[]>(
    `SELECT "assetId",
            MIN("runningHoursTotal")::float AS "minHours",
            MAX("runningHoursTotal")::float AS "maxHours",
            MIN("createdAt") AS "minAt",
            MAX("createdAt") AS "maxAt"
     FROM "DailyEquipmentHours"
     WHERE "assetId" IN (${placeholders})
       AND "tenantId" = ${tenantPlaceholder}
       AND "runningHoursTotal" IS NOT NULL
       AND "createdAt" >= ${sincePlaceholder}
     GROUP BY "assetId"`,
    ...assetIds, tenantId, sinceDate,
  );
  for (const r of historyRows) {
    const dayDiff = (new Date(r.maxAt).getTime() - new Date(r.minAt).getTime()) / DAY_MS;
    if (dayDiff <= 0) continue;
    const hoursDiff = Number(r.maxHours) - Number(r.minHours);
    if (hoursDiff <= 0) continue;
    map.set(r.assetId, Math.min(hoursDiff / dayDiff, MAX_RUNNING_HOURS_PER_DAY));
  }
  return map;
}

export async function getMaintenanceWorkloadProjection(
  session: TenantAccessSession,
  filters: MaintenanceWorkloadFilters = {},
): Promise<MaintenanceWorkloadProjection> {
  const weeks = Math.max(4, Math.min(104, filters.weeks ?? 52));

  // Inicializar estructura semanal vacía desde el lunes de la semana actual.
  const today = new Date();
  const firstWeek = startOfWeekUtcMonday(today);
  const weekBuckets: WorkloadWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    weekBuckets.push({
      weekStart: isoDateOnly(addUtcDays(firstWeek, i * 7)),
      taskCount: 0,
      dateBased: 0,
      hoursBased: 0,
      laborHours: 0,
    });
  }
  const weekIndexByStart = new Map(weekBuckets.map((w, i) => [w.weekStart, i]));
  const projectionEnd = addUtcDays(firstWeek, weeks * 7); // exclusivo

  function bucketForDate(d: Date): WorkloadWeek | null {
    if (d.getTime() < firstWeek.getTime() || d.getTime() >= projectionEnd.getTime()) return null;
    const ws = isoDateOnly(startOfWeekUtcMonday(d));
    const idx = weekIndexByStart.get(ws);
    if (idx == null) return null;
    return weekBuckets[idx];
  }

  const empty: MaintenanceWorkloadProjection = {
    weeks: weekBuckets,
    totalPlans: 0,
    projectedPlans: 0,
    unscheduledHoursPlans: 0,
    unscheduledDatePlans: 0,
    plansWithoutEstimate: 0,
    overduePlans: 0,
    overdueHours: 0,
  };

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return empty;

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return empty;

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);

  const planDelegate = (prismaRaw as unknown as {
    maintenancePlan: {
      findMany(args: unknown): Promise<{
        id: string;
        assetId: string;
        triggerType: string;
        frequencyHours: number | null;
        frequencyMonths: number | null;
        estimatedHours: number | null;
        nextDueDate: Date | null;
        nextDueHours: number | null;
        lastExecutionDate: Date | null;
        lastExecutionHours: number | null;
      }[]>;
    };
  }).maintenancePlan;

  const plans = await planDelegate.findMany({
    where,
    select: {
      id: true,
      assetId: true,
      triggerType: true,
      frequencyHours: true,
      frequencyMonths: true,
      estimatedHours: true,
      nextDueDate: true,
      nextDueHours: true,
      lastExecutionDate: true,
      lastExecutionHours: true,
    },
  });

  if (plans.length === 0) return empty;

  // ── Horas: traer current + history para los assets de planes hours-based ──
  const hoursPlanAssetIds = [
    ...new Set(plans.filter(p => isHoursTrigger(p.triggerType)).map(p => p.assetId)),
  ];

  const currentHoursMap = new Map<string, number>();

  if (hoursPlanAssetIds.length > 0) {
    // Latest runningHoursTotal por asset
    const placeholders = hoursPlanAssetIds.map((_, i) => `$${i + 1}`).join(", ");
    const tenantPlaceholder = `$${hoursPlanAssetIds.length + 1}`;
    const currentRows = await prismaRaw.$queryRawUnsafe<{ assetId: string; runningHoursTotal: number }[]>(
      `SELECT "assetId", "runningHoursTotal"
       FROM (
         SELECT "assetId", "runningHoursTotal",
                ROW_NUMBER() OVER (PARTITION BY "assetId" ORDER BY "createdAt" DESC) AS rn
         FROM "DailyEquipmentHours"
         WHERE "assetId" IN (${placeholders})
           AND "tenantId" = ${tenantPlaceholder}
           AND "runningHoursTotal" IS NOT NULL
       ) sub WHERE rn = 1`,
      ...hoursPlanAssetIds, tenantId,
    );
    for (const r of currentRows) currentHoursMap.set(r.assetId, Number(r.runningHoursTotal));
  }

  // Promedio horas/día por asset usando últimos N días
  const avgHoursPerDayMap = await loadAvgHoursPerDayMap(prismaRaw, tenantId, hoursPlanAssetIds, today);

  // ── Proyección por plan ────────────────────────────────────────────────────
  let projectedPlans = 0;
  let unscheduledHoursPlans = 0;
  let unscheduledDatePlans = 0;
  let plansWithoutEstimate = 0;
  let overduePlans = 0;
  let overdueHours = 0;
  // Detalle de una semana: IDs de planes con ocurrencia en filters.detailWeekStart.
  const detailWeekStart = filters.detailWeekStart || null;
  const weekPlanIdSet = new Set<string>();

  // Tope defensivo: máximo de ocurrencias proyectadas por plan dentro de la ventana.
  // Aún para planes semanales con ventana de 104 semanas, 200 alcanza con margen.
  const MAX_OCCURRENCES_PER_PLAN = 200;

  for (const plan of plans) {
    const trigger = plan.triggerType;
    const estHours = plan.estimatedHours ?? 0;

    if (isDateTrigger(trigger)) {
      // Punto de partida
      let cursor: Date | null = null;
      if (plan.nextDueDate) {
        cursor = new Date(plan.nextDueDate);
      } else if (plan.lastExecutionDate) {
        cursor = advanceDateOccurrence(trigger, plan.frequencyMonths, new Date(plan.lastExecutionDate));
      }
      if (!cursor) {
        unscheduledDatePlans++;
        continue;
      }
      // Vencido (backlog): la próxima ocurrencia natural quedó antes de la semana
      // actual. Se cuenta como métrica aparte y NO se vuelca a la semana 1 — el
      // cursor se rueda hacia adelante para proyectar solo ocurrencias futuras.
      if (cursor.getTime() < firstWeek.getTime()) {
        overduePlans++;
        overdueHours += estHours;
      }
      // Adelantar el cursor hasta entrar en la ventana
      while (cursor.getTime() < firstWeek.getTime()) {
        const next = advanceDateOccurrence(trigger, plan.frequencyMonths, cursor);
        if (!next || next.getTime() === cursor.getTime()) break;
        cursor = next;
      }
      let scheduledThisPlan = false;
      let count = 0;
      while (cursor && cursor.getTime() < projectionEnd.getTime() && count < MAX_OCCURRENCES_PER_PLAN) {
        const bucket = bucketForDate(cursor);
        if (bucket) {
          bucket.taskCount++;
          bucket.dateBased++;
          bucket.laborHours += estHours;
          scheduledThisPlan = true;
          if (detailWeekStart && bucket.weekStart === detailWeekStart) weekPlanIdSet.add(plan.id);
        }
        const next = advanceDateOccurrence(trigger, plan.frequencyMonths, cursor);
        if (!next || next.getTime() === cursor.getTime()) break;
        cursor = next;
        count++;
      }
      if (scheduledThisPlan) {
        projectedPlans++;
        if (plan.estimatedHours == null) plansWithoutEstimate++;
      } else {
        unscheduledDatePlans++;
      }
      continue;
    }

    if (isHoursTrigger(trigger)) {
      const avgPerDay = avgHoursPerDayMap.get(plan.assetId) ?? 0;
      if (avgPerDay <= 0 || !plan.frequencyHours || plan.frequencyHours <= 0 || plan.nextDueHours == null) {
        unscheduledHoursPlans++;
        continue;
      }
      const currentHrs = currentHoursMap.get(plan.assetId) ?? 0;
      const hoursToNext = plan.nextDueHours - currentHrs;
      const daysBetween = plan.frequencyHours / avgPerDay;
      if (!isFinite(daysBetween) || daysBetween <= 0) {
        unscheduledHoursPlans++;
        continue;
      }
      // Vencido por horas (backlog): las horas de marcha ya superaron nextDueHours.
      // Antes esto se aplastaba en "hoy" (daysToNext=0) y apilaba TODOS los planes
      // vencidos en la semana 1 → pico artificial. Ahora se cuenta aparte y la
      // proyección arranca en la siguiente ocurrencia futura (today + un intervalo).
      const overdue = hoursToNext <= 0;
      if (overdue) {
        overduePlans++;
        overdueHours += estHours;
      }
      const daysToNext = overdue ? daysBetween : hoursToNext / avgPerDay;
      let occurrence = addUtcDays(today, daysToNext);
      let scheduledThisPlan = false;
      let count = 0;
      while (occurrence.getTime() < projectionEnd.getTime() && count < MAX_OCCURRENCES_PER_PLAN) {
        const bucket = bucketForDate(occurrence);
        if (bucket) {
          bucket.taskCount++;
          bucket.hoursBased++;
          bucket.laborHours += estHours;
          scheduledThisPlan = true;
          if (detailWeekStart && bucket.weekStart === detailWeekStart) weekPlanIdSet.add(plan.id);
        }
        occurrence = addUtcDays(occurrence, daysBetween);
        count++;
      }
      if (scheduledThisPlan) {
        projectedPlans++;
        if (plan.estimatedHours == null) plansWithoutEstimate++;
      } else {
        unscheduledHoursPlans++;
      }
      continue;
    }

    // CONDITION / EVENT / desconocido → no proyectables
  }

  return {
    weeks: weekBuckets,
    totalPlans: plans.length,
    projectedPlans,
    unscheduledHoursPlans,
    unscheduledDatePlans,
    plansWithoutEstimate,
    overduePlans,
    overdueHours,
    ...(detailWeekStart ? { weekPlanIds: [...weekPlanIdSet] } : {}),
  };
}
