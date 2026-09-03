import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevWorkOrdersForTenant } from "../../platform/data/dev-domain-store";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { workOrderPrefix } from "../../common/wo-code";
import { recalculateNextDue, restorePlanAfterWoCancellation } from "../maintenance-plans/maintenance-plans-service";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { createDeferralInternal } from "../pms/deferrals-service";
import { addItemComment, findSpecItemForDeferral } from "../pms/drydock-spec-items-service";
import { closeLinkedAuditFinding } from "../pms/defects-service";
import { createFluidSampleFromWorkOrder, type FluidType as FluidTypeEnum } from "../fluid-analyses/fluid-analyses-service";
import { log } from "../../common/logger";
import { assertNotLocked, assertCanReopen, assertReopenReason } from "../../common/record-lock";
import { withUniqueRetry } from "../../common/unique-retry";
import { isInspectionWorkOrder, inspectionSkipsApproval, inspectionApprovalStamps } from "./wo-inspection-flow";

export interface WorkOrderListFilters {
  vesselCode?: string | null;
  status?: string | null;
  type?: string | null;
  priority?: string | null;
  assignedToUserId?: string | null;
  assetId?: string | null;
}

export interface CreateWorkOrderInput {
  vesselCode: string;
  assetId: string;
  type?: "PREVENTIVE" | "CORRECTIVE" | "INSPECTION";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  criticality?: "A" | "B" | "C";
  openDate?: string | Date;
  dueDate?: string | Date | null;
  title?: string | null;
  description?: string | null;
  assignedToUserId?: string | null;
  estimatedHours?: number | null;
  taskMasterId?: string | null;
  acceptanceCriteria?: string | null;
  loto?: string | null;
  riskLevel?: string | null;
  riskAnalysisResult?: string | null;
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
  department?: WorkOrderDepartment | null;
  providerId?: string | null;
  /** Empresa tercerizada fuera del catálogo (alternativa a providerId). */
  providerOther?: string | null;
  location?: string | null;
  communicationMethod?: string[];
  distribution?: string[];
  // Formulario controlado REGI-MAN-02.3 (ver WoFormFields).
  voyageNumber?: string | null;
  operatingCondition?: WorkOrderOperatingCondition | null;
  requestedByArea?: WorkOrderRequestedByArea | null;
  assignedToArea?: WorkOrderAssignedToArea | null;
  systemArea?: WorkOrderSystemArea | null;
  maintenanceKind?: WorkOrderMaintenanceKind | null;
  // Solo TENANT_ADMIN: abrir la OT en nombre de otro usuario (SOLICITA / createdByUserId).
  createdByUserId?: string | null;
}

export type WorkOrderDepartment = "CUBIERTA" | "MAQUINAS" | "BARCAZA" | "PROVEEDOR" | "OTROS";

// ── Formulario controlado REGI-MAN-02.3 "Orden de trabajo" ───────────────────
export type WorkOrderRequestedByArea = "CUBIERTA" | "MAQUINAS" | "TECNICA" | "OPS_SSMA";
export type WorkOrderAssignedToArea  = "TRIPULACION" | "TERCERIZADO" | "TECNICA" | "OPS_SSMA";
export type WorkOrderSystemArea      = "MAQUINAS" | "RE_CUBIERTA" | "BARCAZAS";
// Condición operativa del buque al ejecutar el trabajo (evidencia TMSA de las
// prácticas observadas en navegación).
export type WorkOrderOperatingCondition = "NAVEGACION" | "PUERTO" | "FONDEADO" | "DIQUE";
export type WorkOrderMaintenanceKind =
  | "PREVENTIVO" | "CORRECTIVO_PROGRAMADO" | "CORRECTIVO_NO_PROGRAMADO" | "PREDICTIVO" | "EMERGENCIA";

/**
 * El formulario distingue 5 tipos de mantenimiento; `WorkOrderType` sólo 3.
 * Mantenemos ambos: `type` es el eje que consumen MTTR, el flujo OT→Defecto y
 * los reportes (filtran por "CORRECTIVE"), así que ensancharlo los rompería en
 * silencio. Al setear `maintenanceKind` derivamos `type` para que esos
 * consumidores sigan viendo lo que esperan.
 */
export function deriveTypeFromMaintenanceKind(
  kind: WorkOrderMaintenanceKind,
): "PREVENTIVE" | "CORRECTIVE" {
  return kind === "PREVENTIVO" || kind === "PREDICTIVO" ? "PREVENTIVE" : "CORRECTIVE";
}

export interface UpdateWorkOrderInput {
  assetId?: string;
  type?: "PREVENTIVE" | "CORRECTIVE" | "INSPECTION";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  criticality?: "A" | "B" | "C";
  dueDate?: string | Date | null;
  openDate?: string | Date | null;
  // FECHA INICIO del recuadro PROGRAMACION DE TRABAJO. El sistema la setea solo
  // al pasar la OT a ejecución, pero el papel la escribe a mano: las OT cargadas
  // de forma histórica o cerradas sin pasar por "iniciar" salían con el casillero
  // vacío, así que también se puede editar.
  startDate?: string | Date | null;
  title?: string | null;
  description?: string | null;
  assignedToUserId?: string | null;
  estimatedHours?: number | null;
  taskMasterId?: string | null;
  // Plan fields
  acceptanceCriteria?: string | null;
  loto?: string | null;
  riskLevel?: string | null;
  riskAnalysisResult?: string | null;
  checklistDocUrl?: string | null;
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
  // Result fields
  woResult?: string | null;
  executedByName?: string | null;
  completedDate?: string | Date | null;
  runningHoursAtExecution?: number | null;
  actualHours?: number | null;
  observations?: string | null;
  supportingDocUrl?: string | null;
  // Área / responsable + Mercurio form fields
  department?: WorkOrderDepartment | null;
  providerId?: string | null;
  providerOther?: string | null;
  location?: string | null;
  communicationMethod?: string[];
  distribution?: string[];
  // Formulario controlado REGI-MAN-02.3
  voyageNumber?: string | null;
  operatingCondition?: WorkOrderOperatingCondition | null;
  requestedByArea?: WorkOrderRequestedByArea | null;
  assignedToArea?: WorkOrderAssignedToArea | null;
  systemArea?: WorkOrderSystemArea | null;
  maintenanceKind?: WorkOrderMaintenanceKind | null;
  taskCompleted?: boolean | null;
  pendingDetail?: string | null;
  // Spare usages — replaces previous ISSUE movements for this WO
  spareUsages?: Array<{ spareId: string; qty: number; unit: string }>;
}

export interface HoldWorkOrderInput {
  holdReason: string;
  targetDate?: string | Date | null;
  compensatoryMeasures?: string | null;
  /** El trabajo se hace en la próxima varada, no cuando se pueda. */
  toNextDrydock?: boolean | null;
}

export interface CloseWorkOrderInput {
  woResult: "SATISFACTORY" | "WITH_DEFICIENCIES";
  executedByName?: string | null;
  completedDate?: string | Date | null;
  // Solo TENANT_ADMIN: cerrar en nombre de otro usuario → su firma va en CIERRA.
  closedByUserId?: string | null;
  observations?: string | null;
  supportingDocUrl?: string | null;
  independentVerifier?: string | null;
  runningHoursAtExecution?: number | null;
  actualHours?: number | null;
  spareUsages?: Array<{ spareId: string; qty: number; unit: string }>;
}

export interface CancelWorkOrderInput {
  cancelReason: string;
}

interface WorkLogRecord {
  id: string;
  createdAt: Date;
}

interface WorkOrderRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  maintenancePlanId: string | null;
  workOrderCode: string;
  status: string;
  type: string;
  priority: string;
  openDate: Date;
  deletedAt: Date | null;
  workLogs?: WorkLogRecord[];
}

interface MaintenancePlanRecord {
  id: string;
  tenantId: string;
  assetId: string;
  triggerType: string;
  frequencyMonths: number | null;
  frequencyHours: number | null;
  lastExecutionHours: number | null;
}

type WorkOrderDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown; select?: Record<string, unknown> }): Promise<WorkOrderRecord[]>;
  findFirst(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<WorkOrderRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<WorkOrderRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<WorkOrderRecord>;
};

type MaintenancePlanDelegate = {
  findFirst(args: { where: Record<string, unknown> }): Promise<MaintenancePlanRecord | null>;
  findMany(args: { where: Record<string, unknown> }): Promise<MaintenancePlanRecord[]>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<MaintenancePlanRecord>;
};

// Vínculos OT ↔ planes del PDM que ejecuta (ver WorkOrderMaintenancePlan).
type WorkOrderPlanLinkDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown; select?: Record<string, unknown> }): Promise<{ maintenancePlanId: string }[]>;
};

interface WorkOrdersTx {
  workOrder: WorkOrderDelegate;
  maintenancePlan: MaintenancePlanDelegate;
  workOrderMaintenancePlan: WorkOrderPlanLinkDelegate;
}

interface WorkOrdersPrismaClient extends WorkOrdersTx {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  $transaction<T>(fn: (tx: WorkOrdersTx) => Promise<T>): Promise<T>;
}

function workOrdersClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): WorkOrdersPrismaClient {
  return prisma as unknown as WorkOrdersPrismaClient;
}

function canManageWorkOrders(session: TenantAccessSession): boolean {
  return hasPermission(session, "wo.manage");
}

function canOperateWorkOrders(session: TenantAccessSession): boolean {
  return canManageWorkOrders(session) || hasPermission(session, "wo.operate");
}

/**
 * AUTORIZAR una OT: SÓLO tierra.
 *   TENANT_ADMIN         = "DPA / Director de Operaciones"
 *   FLEET_SUPERINTENDENT = "Superintendente técnico"
 *
 * Misma lista que `canAuthorize` de las Solicitudes de Servicio, a propósito:
 * autorizar es siempre un acto de tierra. Queda afuera el MAINTENANCE_MANAGER
 * ("Capitán / Jefe de Máquinas"), que sí aprueba a bordo, y el
 * TECHNICIAN_OPERATOR, que puede operar la OT pero no habilitarla.
 *
 * Importa además porque autorizar una OT ARRASTRA a sus SS (ver
 * cascadeWorkOrderApprovalToServiceRequests): si acá entrara alguien de a bordo,
 * el arrastre habilitaría gasto externo salteando el control de tierra.
 */
function canAuthorizeWorkOrders(session: TenantAccessSession): boolean {
  return hasPermission(session, "wo.authorize");
}

/**
 * Crear OT: permitido a TODOS los roles del tenant salvo AUDITOR_READONLY.
 * La creación es un punto de entrada operativo (especialmente desde defectos
 * detectados a bordo); restringirla bloqueaba flujos legítimos.
 *
 * Editar/cancelar/cerrar siguen siendo más restrictivos (canManageWorkOrders
 * / canOperateWorkOrders) — sólo se afloja la creación.
 */
function canCreateWorkOrders(session: TenantAccessSession): boolean {
  return session.user.role !== "AUDITOR_READONLY";
}

function ensureCanManageWorkOrders(session: TenantAccessSession) {
  if (!canManageWorkOrders(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar work orders.");
  }
}

function ensureCanCreateWorkOrders(session: TenantAccessSession) {
  if (!canCreateWorkOrders(session)) {
    throw new RouteError(403, "FORBIDDEN", "Los usuarios solo-lectura no pueden crear órdenes de trabajo.");
  }
}

function ensureCanOperateWorkOrders(session: TenantAccessSession) {
  if (!canOperateWorkOrders(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para operar work orders.");
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

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  return parsed;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = workOrdersClient(prismaRaw);
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

export async function listTenantWorkOrders(session: TenantAccessSession, filters: WorkOrderListFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) {
    const devItems = listDevWorkOrdersForTenant(
      session.tenantSlug,
      session.user.role,
      session.user.assignedVesselCodes,
      {
        vesselCode: filters.vesselCode,
        status: filters.status,
        type: filters.type,
      },
    );
    return devItems.filter((item) => {
      const priority = "priority" in item ? (item as unknown as { priority?: string }).priority : undefined;
      const assignedToUserId = "assignedToUserId" in item
        ? (item as unknown as { assignedToUserId?: string | null }).assignedToUserId
        : undefined;
      const assetId = "assetId" in item ? (item as unknown as { assetId?: string | null }).assetId : undefined;
      if (filters.priority && priority !== filters.priority) return false;
      if (filters.assignedToUserId && assignedToUserId !== filters.assignedToUserId) return false;
      if (filters.assetId && assetId !== filters.assetId) return false;
      return true;
    });
  }
  const prisma = workOrdersClient(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;
  if (filters.priority) where.priority = filters.priority;
  if (filters.assignedToUserId) where.assignedToUserId = filters.assignedToUserId;
  if (filters.assetId) where.assetId = filters.assetId;

  // El listado NO devuelve los campos de texto/markdown pesados (description,
  // observations, closeNotes, etc.): con cientos de OTs inflan la respuesta a
  // varios MB y la tabla no los usa. El detalle de cada OT los trae aparte
  // (getTenantWorkOrder). Allowlist explícita de los campos livianos del listado.
  const orders = await prisma.workOrder.findMany({
    where,
    orderBy: { openDate: "desc" },
    select: {
      id: true, tenantId: true, vesselCode: true, assetId: true, maintenancePlanId: true,
      workOrderCode: true, type: true, status: true, priority: true, criticality: true,
      openDate: true, startDate: true, dueDate: true, completedDate: true,
      independentVerifier: true, title: true, assignedToUserId: true,
      estimatedHours: true, actualHours: true, taskMasterId: true,
      riskLevel: true, checklistDocUrl: true, consequenceCategory: true,
      department: true, providerId: true, location: true, communicationMethod: true, distribution: true,
      // Formulario REGI-MAN-02.3 — sólo los campos livianos; `pendingDetail`
      // es texto largo y queda para el detalle (getTenantWorkOrder).
      voyageNumber: true, operatingCondition: true, requestedByArea: true, assignedToArea: true,
      systemArea: true, maintenanceKind: true, taskCompleted: true,
      woResult: true, executedByName: true, supportingDocUrl: true, runningHoursAtExecution: true,
      createdAt: true, createdByUserId: true, updatedAt: true, updatedByUserId: true,
      deletedAt: true, deletedByUserId: true,
      reopenCount: true, lastReopenAt: true, lastReopenByUserId: true,
      enviadoAprobacionByName: true, enviadoAprobacionByUserId: true, enviadoAprobacionAt: true,
      aprobadoByName: true, aprobadoByUserId: true, aprobadoAt: true,
      autorizadoByName: true, autorizadoByUserId: true, autorizadoAt: true,
      rechazadoByName: true, rechazadoAt: true, rechazoReason: true,
    },
  });

  const assetIds = [...new Set(orders.map(o => o.assetId).filter(Boolean))];
  // Se resuelven juntos el asignado y el creador: "GENERADO POR" es un recuadro
  // del formulario controlado (REGI-MAN-02.3) y sale de createdByUserId.
  const userIds  = [...new Set(orders.flatMap(o => [
    (o as unknown as { assignedToUserId?: string | null }).assignedToUserId,
    (o as unknown as { createdByUserId?: string | null }).createdByUserId,
  ]).filter((v): v is string => !!v))];
  const providerIds = [...new Set(orders.map(o => (o as unknown as { providerId?: string | null }).providerId).filter((v): v is string => !!v))];

  const [assetRows, userRows, providerRows] = await Promise.all([
    assetIds.length > 0
      ? (prismaRaw as unknown as { asset: { findMany(a: unknown): Promise<{ id: string; name: string | null }[]> } }).asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string | null }[]),
    userIds.length > 0
      ? (prismaRaw as unknown as { user: { findMany(a: unknown): Promise<{ id: string; firstName: string | null; lastName: string | null; formName: string | null }[]> } }).user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, formName: true } })
      : Promise.resolve([] as { id: string; firstName: string | null; lastName: string | null; formName: string | null }[]),
    providerIds.length > 0
      ? (prismaRaw as unknown as { provider: { findMany(a: unknown): Promise<{ id: string; name: string | null }[]> } }).provider.findMany({ where: { id: { in: providerIds }, tenantId }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string | null }[]),
  ]);

  const assetNameMap = new Map(assetRows.map(a => [a.id, a.name ?? null]));
  // Mismo criterio que el desplegable de responsable (team-service.listTeamDirectory):
  // el nombre para formularios manda, si no nombre y apellido.
  const userNameMap  = new Map(userRows.map(u => [u.id, u.formName?.trim() || [u.firstName, u.lastName].filter(Boolean).join(" ") || null]));
  const providerNameMap = new Map(providerRows.map(p => [p.id, p.name ?? null]));

  return orders.map(o => ({
    ...o,
    assetName: assetNameMap.get(o.assetId) ?? null,
    assignedToUserName: userNameMap.get((o as unknown as { assignedToUserId?: string | null }).assignedToUserId ?? "") ?? null,
    createdByName: userNameMap.get((o as unknown as { createdByUserId?: string | null }).createdByUserId ?? "") ?? null,
    // Mismo criterio que getTenantWorkOrder: catálogo, o el escrito a mano.
    providerName: providerNameMap.get((o as unknown as { providerId?: string | null }).providerId ?? "")
      ?? ((o as unknown as { providerOther?: string | null }).providerOther ?? null),
  }));
}

/**
 * Chequeo de scope LIVIANO de una OT: tenant + vessel + 404, con `select`
 * mínimo. Para endpoints que sólo necesitan validar visibilidad/estado y NO el
 * detalle completo (ítems planificados, SS asociadas, mutaciones). Evita pagar
 * el costo de getTenantWorkOrder (workLogs + asset + provider + stockMovement +
 * spare) sólo para autorizar. Devuelve lo justo: id, vesselCode, status.
 */
export async function requireWorkOrderScope(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await (prismaRaw as unknown as {
    workOrder: { findFirst: (a: unknown) => Promise<{ id: string; tenantId: string; vesselCode: string; status: string } | null> };
  }).workOrder.findFirst({
    where,
    select: { id: true, tenantId: true, vesselCode: true, status: true },
  });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Work order no encontrada.");
  return record;
}

export async function getTenantWorkOrder(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await prisma.workOrder.findFirst({
    where,
    include: { workLogs: { orderBy: { createdAt: "desc" } } },
  });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Work order no encontrada.");

  const recProviderId = (record as unknown as { providerId?: string | null }).providerId ?? null;

  // Las tres lecturas auxiliares (asset, provider, movimientos+repuestos) son
  // independientes entre sí: se resuelven en paralelo para no encadenar RTTs a
  // la DB. Mismo criterio que ya usa listTenantWorkOrders. Cada bloque conserva
  // su try/catch para seguir siendo non-blocking.
  const [assetName, providerFromCatalog, spareUsages, plans] = await Promise.all([
    (async (): Promise<string | null> => {
      try {
        const asset = await (prismaRaw as unknown as { asset: { findFirst: (a: unknown) => Promise<{ name: string | null } | null> } }).asset.findFirst({
          where: { id: record.assetId, tenantId },
          select: { name: true },
        });
        return asset?.name ?? null;
      } catch { return null; /* non-blocking */ }
    })(),
    // Nombre de la empresa que hace el trabajo: del catálogo si se eligió de la
    // lista, o el escrito a mano (providerOther) si no estaba. Al resolverse acá,
    // todo lo que lee la OT (PDF, "ASIGNADO A", reportes) ve un solo campo y no
    // se entera de cuál de los dos lo llenó.
    (async (): Promise<string | null> => {
      if (!recProviderId) return null;
      try {
        const provider = await (prismaRaw as unknown as { provider: { findFirst: (a: unknown) => Promise<{ name: string | null } | null> } }).provider.findFirst({
          where: { id: recProviderId, tenantId },
          select: { name: true },
        });
        return provider?.name ?? null;
      } catch { return null; /* non-blocking */ }
    })(),
    // Reconstruct spare usages from stock movements scoped to this WO
    (async (): Promise<Array<{ spareId: string; qty: number; unit: string; sku: string; name: string; criticality: string }>> => {
      const usages: Array<{ spareId: string; qty: number; unit: string; sku: string; name: string; criticality: string }> = [];
      try {
        const movements = await (prismaRaw as any).stockMovement.findMany({
          where: { tenantId, referenceType: "WORK_ORDER", referenceId: record.id },
          select: { spareId: true, quantity: true, unit: true },
          orderBy: { occurredAt: "asc" },
        });
        if (movements.length > 0) {
          const spareIds = [...new Set(movements.map((m: any) => m.spareId).filter(Boolean))] as string[];
          const spares = await (prismaRaw as any).spare.findMany({
            where: { id: { in: spareIds }, tenantId },
            select: { id: true, sku: true, name: true, criticality: true },
          });
          const spareMap = new Map<string, { sku: string; name: string; criticality: string }>(
            spares.map((s: any) => [s.id, { sku: s.sku, name: s.name, criticality: s.criticality }]),
          );
          for (const m of movements as any[]) {
            const meta = spareMap.get(m.spareId) ?? { sku: m.spareId, name: m.spareId, criticality: "C" };
            usages.push({
              spareId: m.spareId,
              qty: Number(m.quantity),
              unit: m.unit,
              sku: meta.sku,
              name: meta.name,
              criticality: meta.criticality,
            });
          }
        }
      } catch { /* non-blocking */ }
      return usages;
    })(),
    // Planes del PDM que ejecuta esta OT (uno o varios). Import dinámico para no
    // cerrar el ciclo con work-order-plans-service, que importa de este módulo.
    (async () => {
      try {
        const { listWorkOrderPlans } = await import("./work-order-plans-service");
        return await listWorkOrderPlans(prismaRaw, tenantId, record as any);
      } catch { return []; /* non-blocking */ }
    })(),
  ]);

  const providerName = providerFromCatalog ?? ((record as unknown as { providerOther?: string | null }).providerOther ?? null);

  // GENERADO POR del formulario controlado. Mismo criterio de nombre que el
  // listado: el nombre para formularios manda, si no nombre y apellido.
  let createdByName: string | null = null;
  const creatorId = (record as unknown as { createdByUserId?: string | null }).createdByUserId;
  if (creatorId) {
    try {
      const u = await (prismaRaw as any).user.findUnique({
        where: { id: creatorId },
        select: { firstName: true, lastName: true, formName: true },
      });
      if (u) createdByName = u.formName?.trim() || [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
    } catch { /* non-blocking */ }
  }

  return { ...record, assetName, providerName, createdByName, spareUsages, plans };
}

export async function createTenantWorkOrder(session: TenantAccessSession, payload: CreateWorkOrderInput) {
  ensureCanCreateWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

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

  // Validar tenant ownership de taskMasterId (cross-reference cross-tenant
  // sería un data-integrity issue: la WO referenciaría un task de otro tenant).
  const taskMasterId = normalizeOptionalText(payload.taskMasterId);
  if (taskMasterId) {
    const tmCount = await (prismaRaw as any).taskMaster.count({
      where: { id: taskMasterId, OR: [{ tenantId }, { isGlobal: true }] },
    });
    if (tmCount === 0) {
      throw new RouteError(404, "TASK_MASTER_NOT_FOUND", "TaskMaster no encontrado o no pertenece a este tenant.");
    }
  }

  // Solo TENANT_ADMIN puede abrir la OT en nombre de otro usuario. El actor real
  // queda en el audit log. createdAt se alinea a openDate para que el PDF muestre
  // la misma fecha en FECHA y en la firma de SOLICITA.
  const isAdmin = session.user.role === "TENANT_ADMIN";
  const woOpenDate = parseOptionalDate(payload.openDate, "openDate") ?? new Date();
  let woCreatorId = session.user.id;
  if (isAdmin) {
    const onBehalf = normalizeOptionalText(payload.createdByUserId);
    if (onBehalf && onBehalf !== session.user.id) {
      const membership = await (prismaRaw as any).tenantMembership.findFirst({
        where: { tenantId, userId: onBehalf },
        select: { userId: true },
      });
      if (!membership) throw new RouteError(400, "USER_NOT_IN_TENANT", "El usuario indicado no pertenece a esta empresa.");
      woCreatorId = onBehalf;
    }
  }

  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  // Secuencia por MAX del número en el código (no COUNT por createdAt): con
  // backdating o gaps el COUNT no coincide con el máximo real y generaba códigos
  // ya usados (P2002). Match prefijo-agnóstico para continuar la numeración aunque
  // cambie el prefijo (WO-/SS-). Mismo criterio que openFormalWorkOrder.
  const codeBody = `${vesselCode}-${yy}-`;
  const codePrefix = `${workOrderPrefix(session.tenantSlug)}-${codeBody}`;

  // Race protection con @@unique(workOrderCode): retry en P2002.
  const created = await withUniqueRetry(async (attempt) => {
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
    const workOrderCode = `${codePrefix}${String(maxSeq + 1 + attempt).padStart(4, "0")}`;
    // `maintenanceKind` (5 opciones del formulario) manda sobre `type` (3):
    // así MTTR / OT→Defecto / reportes siguen viendo el eje que esperan.
    const woType = payload.maintenanceKind
      ? deriveTypeFromMaintenanceKind(payload.maintenanceKind)
      : payload.type ?? "PREVENTIVE";
    return prisma.workOrder.create({
      data: {
        tenantId,
        vesselCode,
        assetId,
        maintenancePlanId: null,
        workOrderCode,
        type: woType,
        status: "PLANNED",
        // Inspección: nace autorizada, sin aprobación ni autorización manual
        // (ver wo-inspection-flow). Sus SS siguen su propia tramitación.
        // Excepción: si el trabajo se terceriza hay gasto, y entonces la orden
        // recorre la tramitación completa como cualquier otra. Misma señal que
        // gobierna `providerId` unas líneas más abajo.
        ...(inspectionSkipsApproval(
          woType,
          payload.assignedToArea === "TERCERIZADO" || payload.department === "PROVEEDOR",
        ) ? inspectionApprovalStamps(woOpenDate) : {}),
        priority: payload.priority ?? "MEDIUM",
        criticality: payload.criticality ?? "B",
        openDate: woOpenDate,
        ...(isAdmin ? { createdAt: woOpenDate } : {}),
        dueDate: parseOptionalDate(payload.dueDate, "dueDate"),
        title: normalizeOptionalText(payload.title),
        description: normalizeOptionalText(payload.description),
        assignedToUserId: normalizeOptionalText(payload.assignedToUserId),
        estimatedHours: normalizeOptionalNumber(payload.estimatedHours, "estimatedHours"),
        taskMasterId,
        acceptanceCriteria: normalizeOptionalText(payload.acceptanceCriteria),
        loto: normalizeOptionalText(payload.loto),
        riskLevel: normalizeOptionalText(payload.riskLevel),
        riskAnalysisResult: normalizeOptionalText(payload.riskAnalysisResult),
        consequenceCategory: payload.consequenceCategory ?? null,
        consequenceRationale: normalizeOptionalText(payload.consequenceRationale),
        department: payload.department ?? null,
        // providerId solo aplica cuando el área es PROVEEDOR; en otros casos se descarta.
        // El taller sólo aplica si el trabajo se terceriza: "Asignado a:
        // TERCERIZADO" (REGI-MAN-02.3) o área PROVEEDOR (formulario anterior).
        providerId: (payload.assignedToArea === "TERCERIZADO" || payload.department === "PROVEEDOR")
          ? normalizeOptionalText(payload.providerId)
          : null,
        location: normalizeOptionalText(payload.location),
        communicationMethod: payload.communicationMethod ?? [],
        distribution: payload.distribution ?? [],
        // Formulario REGI-MAN-02.3 — nullable, sólo se llenan si vienen.
        voyageNumber: normalizeOptionalText(payload.voyageNumber),
        operatingCondition: payload.operatingCondition ?? null,
        requestedByArea: payload.requestedByArea ?? null,
        assignedToArea: payload.assignedToArea ?? null,
        systemArea: payload.systemArea ?? null,
        maintenanceKind: payload.maintenanceKind ?? null,
        createdByUserId: woCreatorId,
        updatedByUserId: woCreatorId,
      },
    });
  });
  void publishAudit(prismaRaw, {
    tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.created",
    entityType: "WorkOrder",
    entityId: created.id,
    metadata: { workOrderCode: created.workOrderCode, vesselCode, type: created.type },
  });
  return created;
}

/**
 * Replace spare-usage stock movements for a WO. Deletes previous ISSUE
 * movements scoped to this WO (referenceType=WORK_ORDER, referenceId=woId)
 * and creates new ones from the supplied list.
 *
 * Used both by save and close — ensures repeated saves don't duplicate.
 */
async function applySpareUsagesToWo(
  prismaRaw: NonNullable<ReturnType<typeof getPrismaClient>>,
  wo: { id: string; tenantId: string; vesselCode: string; workOrderCode: string },
  usages: Array<{ spareId: string; qty: number; unit: string }>,
  occurredAt: Date,
  actorUserId: string,
): Promise<{ failedMovements: string[] }> {
  const smDelegate = (prismaRaw as unknown as {
    stockMovement: {
      deleteMany(a: unknown): Promise<{ count: number }>;
      create(a: unknown): Promise<unknown>;
    };
  }).stockMovement;

  await smDelegate.deleteMany({
    where: { tenantId: wo.tenantId, referenceType: "WORK_ORDER", referenceId: wo.id },
  });

  // Validar que todos los spareIds pertenecen al tenant. Sin esto, un user
  // podría inyectar IDs cross-tenant y crear stock movements con spareIds
  // que no le pertenecen — corrupción de datos.
  const proposedIds = [...new Set(usages.map(u => u.spareId).filter(Boolean))];
  const validIds = new Set<string>();
  if (proposedIds.length > 0) {
    const valid = await (prismaRaw as any).spare.findMany({
      where: { id: { in: proposedIds }, tenantId: wo.tenantId, deletedAt: null },
      select: { id: true },
    });
    for (const s of valid as Array<{ id: string }>) validIds.add(s.id);
  }

  const failedMovements: string[] = [];
  for (const usage of usages) {
    if (!usage.spareId || !usage.qty || usage.qty <= 0) continue;
    if (!validIds.has(usage.spareId)) {
      failedMovements.push(usage.spareId);
      continue;
    }
    try {
      await smDelegate.create({
        data: {
          tenantId: wo.tenantId,
          vesselCode: wo.vesselCode,
          spareId: usage.spareId,
          movementCode: `MOV-${wo.vesselCode}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          movementType: "ISSUE",
          quantity: usage.qty,
          unit: usage.unit,
          occurredAt,
          referenceType: "WORK_ORDER",
          referenceId: wo.id,
          notes: `Utilizado en OT ${wo.workOrderCode}`,
          createdByUserId: actorUserId,
        },
      });
    } catch (err) {
      log.error("[applySpareUsagesToWo] stock movement failed for spare", usage.spareId, err);
      failedMovements.push(usage.spareId);
    }
  }
  return { failedMovements };
}

export async function updateTenantWorkOrder(session: TenantAccessSession, id: string, payload: UpdateWorkOrderInput) {
  ensureCanManageWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  // Lockdown vetting: una OT CLOSED/CANCELLED no se edita.
  // Para corregirla hace falta /reopen explícito por TENANT_ADMIN.
  assertNotLocked("WORK_ORDER", current.status);

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.assetId !== undefined) data.assetId = normalizeRequiredText(payload.assetId, "assetId");
  if (payload.type !== undefined) data.type = payload.type;
  if (payload.priority !== undefined) data.priority = payload.priority;
  if (payload.criticality !== undefined) data.criticality = payload.criticality;
  if (payload.dueDate !== undefined) data.dueDate = parseOptionalDate(payload.dueDate, "dueDate");
  if (payload.startDate !== undefined) data.startDate = parseOptionalDate(payload.startDate, "startDate");
  // openDate es NOT NULL en el schema: solo se actualiza si llega una fecha válida.
  if (payload.openDate !== undefined) { const d = parseOptionalDate(payload.openDate, "openDate"); if (d) data.openDate = d; }
  if (payload.title !== undefined) data.title = normalizeOptionalText(payload.title);
  if (payload.description !== undefined) data.description = normalizeOptionalText(payload.description);
  if (payload.assignedToUserId !== undefined) data.assignedToUserId = normalizeOptionalText(payload.assignedToUserId);
  if (payload.estimatedHours !== undefined) data.estimatedHours = normalizeOptionalNumber(payload.estimatedHours, "estimatedHours");
  if (payload.taskMasterId !== undefined) data.taskMasterId = normalizeOptionalText(payload.taskMasterId);
  if (payload.acceptanceCriteria !== undefined) data.acceptanceCriteria = normalizeOptionalText(payload.acceptanceCriteria);
  if (payload.loto !== undefined) data.loto = normalizeOptionalText(payload.loto);
  if (payload.riskLevel !== undefined) data.riskLevel = normalizeOptionalText(payload.riskLevel);
  if (payload.riskAnalysisResult !== undefined) data.riskAnalysisResult = normalizeOptionalText(payload.riskAnalysisResult);
  if (payload.checklistDocUrl !== undefined) data.checklistDocUrl = normalizeOptionalText(payload.checklistDocUrl);
  if (payload.consequenceCategory !== undefined) data.consequenceCategory = payload.consequenceCategory ?? null;
  if (payload.consequenceRationale !== undefined) data.consequenceRationale = normalizeOptionalText(payload.consequenceRationale);
  if (payload.woResult !== undefined) data.woResult = normalizeOptionalText(payload.woResult);
  if (payload.executedByName !== undefined) data.executedByName = normalizeOptionalText(payload.executedByName);
  if (payload.completedDate !== undefined) data.completedDate = parseOptionalDate(payload.completedDate, "completedDate");
  if (payload.runningHoursAtExecution !== undefined) data.runningHoursAtExecution = payload.runningHoursAtExecution ?? null;
  if (payload.actualHours !== undefined) data.actualHours = payload.actualHours ?? null;
  if (payload.observations !== undefined) data.observations = normalizeOptionalText(payload.observations);
  if (payload.supportingDocUrl !== undefined) data.supportingDocUrl = normalizeOptionalText(payload.supportingDocUrl);
  if (payload.department !== undefined) data.department = payload.department ?? null;

  // ¿El trabajo queda en manos de un tercero? Hay dos ejes según el formulario
  // del tenant: "Asignado a: TERCERIZADO" (REGI-MAN-02.3) o el área PROVEEDOR
  // (formulario anterior). El taller sólo se guarda si alguno aplica, y se
  // limpia si el trabajo deja de estar tercerizado.
  //
  // Se evalúa sobre el valor FINAL (lo que viene en el payload o, si no viene,
  // lo que ya tenía la OT): antes se miraba sólo `payload.department`, y como
  // los tenants con el formulario nuevo mandan department vacío, el taller se
  // borraba en cada guardado.
  const assignedToAreaFinal = payload.assignedToArea !== undefined
    ? payload.assignedToArea
    : (current as any).assignedToArea;
  const departmentFinal = payload.department !== undefined
    ? payload.department
    : (current as any).department;
  const tercerizado = assignedToAreaFinal === "TERCERIZADO" || departmentFinal === "PROVEEDOR";

  // La empresa se elige del catálogo (providerId) O se escribe a mano
  // (providerOther) — son excluyentes. Y las dos se limpian si el trabajo deja
  // de estar tercerizado: si no, quedaría una empresa colgada en una OT propia.
  if (payload.providerId !== undefined) {
    data.providerId = tercerizado ? normalizeOptionalText(payload.providerId) : null;
  } else if (!tercerizado) {
    data.providerId = null;
  }
  if (payload.providerOther !== undefined) {
    data.providerOther = tercerizado ? normalizeOptionalText(payload.providerOther) : null;
  } else if (!tercerizado) {
    data.providerOther = null;
  }
  if (payload.location !== undefined) data.location = normalizeOptionalText(payload.location);
  if (payload.communicationMethod !== undefined) data.communicationMethod = payload.communicationMethod;
  if (payload.distribution !== undefined) data.distribution = payload.distribution;
  // ── Formulario REGI-MAN-02.3 ──
  if (payload.voyageNumber !== undefined) data.voyageNumber = normalizeOptionalText(payload.voyageNumber);
  if (payload.operatingCondition !== undefined) data.operatingCondition = payload.operatingCondition ?? null;
  if (payload.requestedByArea !== undefined) data.requestedByArea = payload.requestedByArea ?? null;
  if (payload.assignedToArea !== undefined) data.assignedToArea = payload.assignedToArea ?? null;
  if (payload.systemArea !== undefined) data.systemArea = payload.systemArea ?? null;
  if (payload.taskCompleted !== undefined) data.taskCompleted = payload.taskCompleted ?? null;
  if (payload.pendingDetail !== undefined) data.pendingDetail = normalizeOptionalText(payload.pendingDetail);
  // Cambiar el tipo del formulario re-deriva `type` (ver deriveTypeFromMaintenanceKind).
  if (payload.maintenanceKind !== undefined) {
    data.maintenanceKind = payload.maintenanceKind ?? null;
    if (payload.maintenanceKind) data.type = deriveTypeFromMaintenanceKind(payload.maintenanceKind);
  }

  const updated = await prisma.workOrder.update({ where: { id: current.id }, data });

  if (payload.spareUsages !== undefined) {
    await applySpareUsagesToWo(
      prismaRaw,
      { id: current.id, tenantId: current.tenantId, vesselCode: current.vesselCode, workOrderCode: current.workOrderCode },
      payload.spareUsages,
      new Date(),
      session.user.id,
    );
  }

  return updated;
}

/**
 * Cambiar SOLO el tipo de la OT (Preventivo/Correctivo/Inspección). Permiso
 * amplio (cualquier usuario salvo AUDITOR_READONLY): es un ajuste operativo
 * liviano, a diferencia de la edición completa (canManageWorkOrders). Una OT
 * CLOSED/CANCELLED no se toca (assertNotLocked).
 */
export async function setWorkOrderType(session: TenantAccessSession, id: string, payload: { type?: string }) {
  ensureCanCreateWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const type = String(payload.type ?? "").toUpperCase();
  if (!["PREVENTIVE", "CORRECTIVE", "INSPECTION"].includes(type)) {
    throw new RouteError(400, "VALIDATION_ERROR", "Tipo de OT inválido.");
  }

  const current = await getTenantWorkOrder(session, id);
  assertNotLocked("WORK_ORDER", current.status);

  const updated = await prisma.workOrder.update({
    where: { id: current.id },
    data: { type, updatedByUserId: session.user.id },
  });

  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.typeChanged",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: { workOrderCode: current.workOrderCode, from: current.type, to: type },
  });

  return updated;
}

export async function startWorkOrder(session: TenantAccessSession, id: string) {
  ensureCanOperateWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  if (current.status !== "PLANNED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo PLANNED puede pasar a IN_PROGRESS (actual: ${current.status}).`);
  }

  const started = await prisma.workOrder.update({
    where: { id: current.id },
    data: { status: "IN_PROGRESS", startDate: new Date(), updatedByUserId: session.user.id },
  });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.started",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: { workOrderCode: current.workOrderCode, vesselCode: current.vesselCode },
  });
  return started;
}

export async function holdWorkOrder(session: TenantAccessSession, id: string, payload: HoldWorkOrderInput) {
  ensureCanOperateWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  if (current.status !== "PLANNED" && current.status !== "IN_PROGRESS") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo PLANNED o IN_PROGRESS pueden pasar a ON_HOLD (actual: ${current.status}).`);
  }

  const held = await prisma.workOrder.update({
    where: { id: current.id },
    data: { status: "ON_HOLD", holdReason: normalizeRequiredText(payload.holdReason, "holdReason"), updatedByUserId: session.user.id },
  });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.held",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: { workOrderCode: current.workOrderCode, vesselCode: current.vesselCode, holdReason: payload.holdReason },
  });
  let deferralId: string | null = null;
  try {
    const created = await createDeferralInternal(session, {
      vesselCode: current.vesselCode,
      assetId: current.assetId,
      sourceType: "WORK_ORDER",
      sourceId: current.id,
      justification: payload.holdReason,
      targetDate: payload.targetDate ?? null,
      compensatoryMeasures: payload.compensatoryMeasures ?? null,
      toNextDrydock: payload.toNextDrydock === true,
    });
    deferralId = created.id;
  } catch (err) {
    log.error("[holdWorkOrder] auto-deferral failed:", err);
  }
  return { ...held, deferralId };
}

/**
 * Reanuda una OT en espera: ON_HOLD → IN_PROGRESS.
 * Resuelve el diferimiento vinculado según su estado:
 *   - REQUESTED / UNDER_REVIEW → cancelar (soft-delete)
 *   - APPROVED / ACTIVE        → cerrar (status CLOSED)
 */
export async function resumeWorkOrder(session: TenantAccessSession, id: string) {
  ensureCanOperateWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  if (current.status !== "ON_HOLD") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo ON_HOLD puede pasar a IN_PROGRESS vía resume (actual: ${current.status}).`);
  }

  const resumed = await prisma.workOrder.update({
    where: { id: current.id },
    data: { status: "IN_PROGRESS", holdReason: null, updatedByUserId: session.user.id },
  });

  // Resolver diferimiento vinculado según su estado
  try {
    const deferralDelegate = (prismaRaw as unknown as {
      deferral: {
        findFirst(a: unknown): Promise<{ id: string; status: string; deferralCode: string } | null>;
        update(a: unknown): Promise<unknown>;
      };
    }).deferral;
    const linked = await deferralDelegate.findFirst({
      where: {
        tenantId: current.tenantId,
        sourceType: "WORK_ORDER",
        sourceId: current.id,
        deletedAt: null,
        status: { in: ["REQUESTED", "UNDER_REVIEW", "APPROVED", "ACTIVE"] },
      },
    });
    if (linked) {
      const now = new Date();
      if (linked.status === "REQUESTED" || linked.status === "UNDER_REVIEW") {
        // Cancelar: soft-delete
        await deferralDelegate.update({
          where: { id: linked.id },
          data: { deletedAt: now, deletedByUserId: session.user.id, updatedByUserId: session.user.id },
        });
      } else {
        // APPROVED o ACTIVE: cerrar
        await deferralDelegate.update({
          where: { id: linked.id },
          data: {
            status: "CLOSED",
            closedAt: now,
            closeNotes: "Cerrado al reanudar la OT.",
            updatedByUserId: session.user.id,
          },
        });
      }
      // Si ese diferimiento ya había entrado a una especificación de varada, la
      // línea NO se borra: el astillero y el auditor tienen que poder ver que se
      // propuso. Se avisa en el hilo de la línea para que tierra decida.
      try {
        const specItem = await findSpecItemForDeferral(current.tenantId, linked.id);
        if (specItem) {
          await addItemComment(
            session,
            specItem.itemId,
            `El diferimiento ${linked.deferralCode} se cerró al reanudar la ${current.workOrderCode}: el trabajo volvió a ejecución a bordo.`,
          );
        }
      } catch (err) {
        log.error("[resumeWorkOrder] failed to annotate drydock spec item:", err);
      }
    }
  } catch (err) {
    log.error("[resumeWorkOrder] failed to handle linked deferral:", err);
  }

  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.resumed",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: { workOrderCode: current.workOrderCode, vesselCode: current.vesselCode },
  });
  return resumed;
}

// ── Tramitación: cadena de aprobación ────────────────────────────────────────
// En preparación → Envía a aprobar → Aprueba → Autoriza. Cada paso se dispara
// desde la caja TRAMITACIÓN o por drag-and-drop en el tablero, y captura el
// nombre del firmante. Solo registra los campos de tramitación (no toca el
// status operativo). Secuencial: no se aprueba sin enviar, ni se autoriza sin
// aprobar.
export async function setWorkOrderApproval(
  session: TenantAccessSession,
  id: string,
  payload: { step: "ENVIA" | "APRUEBA" | "AUTORIZA" | "RECHAZA"; name: string; reason?: string | null; onBehalfUserId?: string | null; actionDate?: string | Date | null },
) {
  ensureCanOperateWorkOrders(session);
  // Autorizar es de tierra, igual que en la SS (ver canAuthorizeWorkOrders).
  if (payload.step === "AUTORIZA" && !canAuthorizeWorkOrders(session)) {
    throw new RouteError(
      403,
      "FORBIDDEN",
      "Autorizar una orden de trabajo es atribución de tierra: Superintendente técnico o DPA / Director de Operaciones.",
    );
  }

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const name = normalizeRequiredText(payload.name, "name");
  const current = await getTenantWorkOrder(session, id) as any;
  const now = new Date();

  // Solo TENANT_ADMIN puede aprobar/autorizar en nombre de otro usuario (la firma
  // del PDF se toma de ESE usuario) y/o registrar una fecha distinta de la acción.
  // El actor real siempre queda en el audit log y en updatedByUserId.
  let signerUserId = session.user.id;
  let actionAt = now;
  if (session.user.role === "TENANT_ADMIN" && payload.step !== "RECHAZA") {
    const onBehalf = normalizeOptionalText(payload.onBehalfUserId);
    if (onBehalf && onBehalf !== session.user.id) {
      const membership = await (prismaRaw as any).tenantMembership.findFirst({
        where: { tenantId: current.tenantId, userId: onBehalf },
        select: { userId: true, role: true, assignedVesselCodes: true },
      });
      if (!membership) throw new RouteError(400, "USER_NOT_IN_TENANT", "El usuario indicado no pertenece a esta empresa.");
      // La elegibilidad depende del PASO. ENVIA no es una firma de autoridad
      // (es "ya la completé, fírmenla"): lo manda cualquiera embarcado, salvo
      // el auditor externo, que es de sólo lectura — mismo criterio que
      // SOLICITA en la SS. APRUEBA admite al JEFE DE MÁQUINAS (es a bordo);
      // AUTORIZA no, porque es de tierra. Sin esta distinción un admin podría
      // autorizar "en nombre de" un jefe de máquinas y saltear el gate por la
      // ventana. Defensa en profundidad: el front ya filtra la lista.
      const enElBuque = Array.isArray(membership.assignedVesselCodes)
        && membership.assignedVesselCodes.includes(current.vesselCode);
      const eligible = membership.role === "TENANT_ADMIN"
        || (payload.step === "ENVIA" && enElBuque && membership.role !== "AUDITOR_READONLY")
        || (membership.role === "FLEET_SUPERINTENDENT" && enElBuque)
        || (payload.step === "APRUEBA" && membership.role === "MAINTENANCE_MANAGER" && enElBuque);
      if (!eligible) {
        throw new RouteError(
          403,
          "NOT_ELIGIBLE_APPROVER",
          payload.step === "ENVIA"
            ? "Quien envía la orden a aprobar tiene que estar asignado a este buque."
            : payload.step === "APRUEBA"
            ? "Solo un administrador, el superintendente o el jefe de máquinas a cargo del buque puede aprobar."
            : "Autorizar es sólo del Superintendente técnico o el DPA / Director de Operaciones.",
        );
      }
      signerUserId = onBehalf;
    }
    const d = parseOptionalDate(payload.actionDate, "actionDate");
    if (d) actionAt = d;
  }

  let data: Record<string, unknown>;
  if (payload.step === "ENVIA") {
    // EN PREPARACIÓN → PENDIENTE DE APROBACIÓN. No exige rol de aprobador: es
    // el que abrió la OT diciendo "ya está lista, fírmenla". Limpia el rechazo
    // para que el ciclo corregir-y-reenviar salga del rojo.
    if (current.enviadoAprobacionAt) throw new RouteError(409, "ALREADY_SUBMITTED", "La OT ya fue enviada a aprobar.");
    data = {
      enviadoAprobacionByName: name, enviadoAprobacionByUserId: signerUserId, enviadoAprobacionAt: actionAt,
      rechazadoByName: null, rechazadoAt: null, rechazoReason: null,
    };
  } else if (payload.step === "APRUEBA") {
    if (!current.enviadoAprobacionAt) throw new RouteError(409, "NOT_SUBMITTED", "La OT tiene que enviarse a aprobar antes de aprobarla.");
    if (current.aprobadoAt) throw new RouteError(409, "ALREADY_APPROVED", "La OT ya fue aprobada.");
    // Re-aprobar tras un rechazo: limpia el flag de rechazo (sale del rojo).
    // Se guarda el userId del firmante para incrustar su firma digital en el PDF.
    data = { aprobadoByName: name, aprobadoByUserId: signerUserId, aprobadoAt: actionAt, rechazadoByName: null, rechazadoAt: null, rechazoReason: null };
  } else if (payload.step === "AUTORIZA") {
    if (!current.aprobadoAt) throw new RouteError(409, "NOT_APPROVED", "La OT debe estar aprobada antes de autorizar.");
    if (current.autorizadoAt) throw new RouteError(409, "ALREADY_AUTHORIZED", "La OT ya fue autorizada.");
    data = { autorizadoByName: name, autorizadoByUserId: signerUserId, autorizadoAt: actionAt };
  } else if (payload.step === "RECHAZA") {
    // [NO APROBADA] / [NO AUTORIZADA]: devuelve la OT a EN PREPARACIÓN (en
    // rojo), limpiando enviado/aprobado/autorizado y registrando quién rechazó
    // + el motivo. Vuelve a preparación y no a "pendiente de aprobación"
    // porque rechazar significa "corregila": el que la abrió tiene que poder
    // arreglarla y reenviarla, y ese reenvío vuelve a avisar a quien aprueba.
    const reason = normalizeRequiredText(payload.reason ?? "", "reason");
    data = {
      enviadoAprobacionByName: null, enviadoAprobacionByUserId: null, enviadoAprobacionAt: null,
      aprobadoByName: null, aprobadoByUserId: null, aprobadoAt: null,
      autorizadoByName: null, autorizadoByUserId: null, autorizadoAt: null,
      rechazadoByName: name, rechazadoAt: now, rechazoReason: reason,
    };
  } else {
    throw new RouteError(400, "VALIDATION_ERROR", "Paso de tramitación inválido. Use ENVIA, APRUEBA, AUTORIZA o RECHAZA.");
  }

  const updated = await prisma.workOrder.update({
    where: { id: current.id },
    data: { ...data, updatedByUserId: session.user.id },
  });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: payload.step === "ENVIA" ? "WorkOrder.submittedForApproval"
      : payload.step === "APRUEBA" ? "WorkOrder.approved"
      : payload.step === "AUTORIZA" ? "WorkOrder.authorized"
      : "WorkOrder.rejected",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: {
      workOrderCode: current.workOrderCode, vesselCode: current.vesselCode, name,
      onBehalfOf: signerUserId !== session.user.id ? signerUserId : undefined,
    },
  });

  // Aviso a quien tiene que aprobar ESTE buque (admin / superintendente / jefe
  // de máquinas asignado — lo resuelve enqueueNotificationForRoles). Es el
  // único punto donde después se engancha el correo.
  //
  // Se borra el aviso anterior de esta misma OT antes de encolar: la tabla
  // tiene @@unique(tenantId, recipientUserId, sourceType, sourceId), así que
  // un reenvío tras un rechazo se saltearía en silencio y nadie se enteraría.
  if (payload.step === "ENVIA") {
    void (async () => {
      try {
        const { enqueueNotificationForRoles } = await import("../notifications/notifications-service");
        await (prismaRaw as any).notification.deleteMany({
          where: { tenantId: current.tenantId, sourceType: "WORK_ORDER_APPROVAL", sourceId: current.id },
        });
        await enqueueNotificationForRoles(prismaRaw as any, {
          tenantId:   current.tenantId,
          vesselCode: current.vesselCode,
          type:       "WORK_ORDER_PENDING_APPROVAL",
          severity:   "HIGH",
          title:      `Pendiente de aprobación — ${current.workOrderCode}`,
          body:       (current.title as string | null)?.slice(0, 200) ?? null,
          linkUrl:    `/work-orders?autoCode=${encodeURIComponent(current.workOrderCode)}`,
          sourceType: "WORK_ORDER_APPROVAL",
          sourceId:   current.id,
        });
      } catch (err) {
        // Nunca puede voltear la tramitación: la OT ya quedó enviada.
        log.error("[setWorkOrderApproval] aviso de pendiente de aprobación falló", err);
      }
    })();
  }

  // Arrastre a las Solicitudes de Servicio colgadas de esta OT: firmar la OT
  // firma también sus SS (OT aprobada → SS aprobada; OT autorizada → SS
  // autorizada; OT rechazada → se revierte lo que el arrastre había adelantado).
  // Import dinámico para no crear un ciclo: service-requests-service ya importa
  // de este módulo. En try/catch como el auto-create de muestras: un problema
  // con las SS no puede tumbar la tramitación de la OT, que ya está guardada.
  try {
    const { cascadeWorkOrderApprovalToServiceRequests } = await import("../service-requests/service-requests-service");
    const touched = await cascadeWorkOrderApprovalToServiceRequests({
      tenantId:      current.tenantId,
      workOrderId:   current.id,
      workOrderCode: current.workOrderCode,
      step:          payload.step,
      signerName:    name,
      signerUserId,
      actionAt:      payload.step === "RECHAZA" ? now : actionAt,
      actorUserId:   session.user.id,
    });
    if (touched > 0) log.info(`[setWorkOrderApproval] ${payload.step}: ${touched} SS arrastrada(s) de ${current.workOrderCode}`);
  } catch (err) {
    log.error("[setWorkOrderApproval] cascade a Solicitudes de Servicio falló", err);
  }

  // Auto-create Sample DRAFT al AUTORIZAR (no al cerrar): así la tripulación ya
  // sabe, desde que la OT se despacha, que debe tomar la muestra durante la
  // ejecución. Horas/fecha reales se completan al cerrar la OT (ver closeWorkOrder).
  // Se devuelven las muestras creadas para que el frontend le avise al usuario
  // (popup) que se generó el registro de análisis — si no, quedaba invisible
  // hasta que alguien entrara a Análisis de Fluidos a buscarlo.
  const createdFluidSamples: Array<{ id: string; sampleCode: string; kind: string }> = [];
  if (payload.step === "AUTORIZA") {
    try {
      // Se recorren TODOS los planes de la OT: si la orden cubre varios ítems
      // del PDM y dos piden muestra, salen dos muestras (una por plan, con su
      // equipo y su fluido). El dedupe es por OT + plan, no sólo por OT.
      const { listWorkOrderPlanIds } = await import("./work-order-plans-service");
      const planIds = await listWorkOrderPlanIds(prismaRaw, current);
      const plans = planIds.length > 0
        ? await (prismaRaw as any).maintenancePlan.findMany({
            where: { id: { in: planIds }, tenantId: current.tenantId, deletedAt: null },
            select: { id: true, assetId: true, samplingKind: true, samplingFluidType: true },
          })
        : [];
      for (const plan of plans) {
        const planKind      = plan?.samplingKind as string | null;
        const planFluidType = plan?.samplingFluidType as string | null;
        if (!planKind && !planFluidType) continue;
        const existing = await (prismaRaw as any).fluidSample.findFirst({
          where: { tenantId: current.tenantId, sourceWorkOrderId: current.id, sourcePlanId: plan.id, deletedAt: null },
          select: { id: true },
        });
        if (existing) continue;
        const created = await createFluidSampleFromWorkOrder({
          tenantId:        current.tenantId,
          vesselCode:      current.vesselCode,
          // El equipo es el DEL PLAN: con varios ítems del PDM cada muestra
          // corresponde a su propio equipo, no al principal de la OT.
          assetId:         plan.assetId ?? current.assetId,
          kind:            (planKind || "FLUID") as "FLUID" | "VIBRATION" | "THERMAL" | "ULTRASOUND" | "OTHER",
          fluidType:       planFluidType as FluidTypeEnum | null,
          workOrderId:     current.id,
          workOrderCode:   current.workOrderCode,
          planId:          plan.id,
          runningHours:    null,
          completedAt:     actionAt,
          createdByUserId: session.user.id,
        });
        if (created) createdFluidSamples.push({ ...created, kind: planKind || "FLUID" });
      }
    } catch (err) {
      log.error("[setWorkOrderApproval] auto-create Sample failed", err);
    }
  }

  return { ...updated, createdFluidSamples };
}

export async function closeWorkOrder(session: TenantAccessSession, id: string, payload: CloseWorkOrderInput) {
  ensureCanOperateWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  if (current.status !== "IN_PROGRESS" && current.status !== "ON_HOLD" && current.status !== "PLANNED") {
    throw new RouteError(
      409,
      "INVALID_STATUS_TRANSITION",
      `Solo PLANNED, IN_PROGRESS u ON_HOLD pueden pasar a CLOSED (actual: ${current.status}).`,
    );
  }

  if (!payload.woResult) throw new RouteError(400, "VALIDATION_ERROR", "El resultado de la OT es requerido.");

  const completedDate = parseOptionalDate(payload.completedDate, "completedDate") ?? new Date();
  // Anclaje a mediodía UTC para el recálculo de vencimientos (mismo fix que
  // updateTenantMaintenancePlan): la fecha "solo día" llega como medianoche UTC
  // y addMonths suma con la hora LOCAL del server — sin anclar, el próximo
  // vencimiento puede quedar corrido un día según la zona horaria del proceso.
  const completedDateAnchored = new Date(Date.UTC(
    completedDate.getUTCFullYear(), completedDate.getUTCMonth(), completedDate.getUTCDate(), 12, 0, 0,
  ));

  // Solo TENANT_ADMIN puede cerrar en nombre de otro: la firma de CIERRA del PDF
  // se toma de ESE usuario (updatedByUserId → cierraSignatureBuffer). El actor
  // real queda en el audit log.
  let closerUserId = session.user.id;
  if (session.user.role === "TENANT_ADMIN") {
    const onBehalf = normalizeOptionalText(payload.closedByUserId);
    if (onBehalf && onBehalf !== session.user.id) {
      const membership = await (prismaRaw as any).tenantMembership.findFirst({
        where: { tenantId: current.tenantId, userId: onBehalf },
        select: { userId: true },
      });
      if (!membership) throw new RouteError(400, "USER_NOT_IN_TENANT", "El usuario indicado no pertenece a esta empresa.");
      closerUserId = onBehalf;
    }
  }

  const closedResult = await prisma.$transaction(async (tx) => {
    const startDate = current.status === "PLANNED" ? completedDate : undefined;
    const closed = await tx.workOrder.update({
      where: { id: current.id },
      data: {
        status: "CLOSED",
        ...(startDate ? { startDate } : {}),
        completedDate,
        woResult: payload.woResult,
        executedByName: normalizeOptionalText(payload.executedByName),
        observations: normalizeOptionalText(payload.observations),
        closeNotes: normalizeOptionalText(payload.observations),
        independentVerifier: normalizeOptionalText(payload.independentVerifier),
        supportingDocUrl: normalizeOptionalText(payload.supportingDocUrl),
        runningHoursAtExecution: payload.runningHoursAtExecution ?? null,
        actualHours: payload.actualHours ?? null,
        updatedByUserId: closerUserId,
      },
    });

    // Cerrar la OT da por ejecutados TODOS los planes que incluye, no sólo el
    // principal: una parada de astillero cubre varios ítems del PDM ("1.7 / 1.8
    // / 1.9 …") y si se avanzara uno solo, los demás seguirían venciendo aunque
    // el trabajo se hizo. Cada plan recalcula su propio próximo vencimiento con
    // SU frecuencia.
    const planLinks = await tx.workOrderMaintenancePlan.findMany({
      where: { workOrderId: current.id },
      select: { maintenancePlanId: true },
    });
    const planIds = [...new Set([
      ...(current.maintenancePlanId ? [current.maintenancePlanId] : []),
      ...planLinks.map((l) => l.maintenancePlanId),
    ])];

    if (planIds.length > 0) {
      const plans = await tx.maintenancePlan.findMany({
        where: { id: { in: planIds }, tenantId: current.tenantId, deletedAt: null },
      });
      for (const plan of plans) {
        // Las horas informadas son las del equipo de LA OT. Un plan de otro
        // equipo (astillero: válvulas, manifold, LCI…) no puede tomarlas: su
        // cuentahoras es otro. Ese avanza por fecha y conserva sus horas.
        const sameAsset = plan.assetId === current.assetId;
        const reportedHours = sameAsset ? payload.runningHoursAtExecution ?? null : null;
        const executionHours = reportedHours ?? plan.lastExecutionHours;
        const nextDue = recalculateNextDue(
          {
            triggerType: plan.triggerType,
            frequencyMonths: plan.frequencyMonths,
            frequencyHours: plan.frequencyHours,
          },
          completedDateAnchored,
          executionHours,
        );
        await tx.maintenancePlan.update({
          where: { id: plan.id },
          data: {
            lastExecutionDate: completedDateAnchored,
            lastExecutionHours: reportedHours ?? plan.lastExecutionHours,
            nextDueDate: nextDue.nextDueDate,
            nextDueHours: nextDue.nextDueHours,
            executionStatus: "COMPLETED",
            updatedByUserId: session.user.id,
          },
        });
      }
    }

    return closed;
  });
  let failedMovements: string[] = [];
  if (payload.spareUsages !== undefined) {
    // La OT ya quedó CLOSED en la transacción de arriba: un fallo acá no debe
    // devolver 500 (el usuario creería que el cierre no se aplicó). Se reportan
    // los repuestos no registrados en failedMovements y se sigue.
    try {
      const result = await applySpareUsagesToWo(
        prismaRaw,
        { id: current.id, tenantId: current.tenantId, vesselCode: current.vesselCode, workOrderCode: current.workOrderCode },
        payload.spareUsages,
        completedDate,
        session.user.id,
      );
      failedMovements = result.failedMovements;
    } catch (err) {
      log.error("[closeWorkOrder] applySpareUsagesToWo failed after close", current.workOrderCode, err);
      failedMovements = payload.spareUsages.map((u) => u.spareId).filter(Boolean);
    }
  }

  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.closed",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: { workOrderCode: current.workOrderCode, vesselCode: current.vesselCode, woResult: payload.woResult },
  });

  // Cerrar aplazamientos asociados a esta OT (sourceType=WORK_ORDER, sourceId=woId)
  // en cualquier estado no-terminal. Estados terminales (REJECTED, EXPIRED, CLOSED)
  // se omiten porque ya están finalizados.
  // Cuando se aplaza una OT, el aplazamiento queda colgado aunque después se ejecute
  // la OT; al cerrar la OT, ese aplazamiento ya no tiene sentido y debe quedar CLOSED.
  try {
    const deferralDelegateLocal = (prismaRaw as unknown as {
      deferral: {
        findMany(a: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{ id: string; deferralCode: string; status: string }[]>;
        update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
      };
    }).deferral;
    const openDeferrals = await deferralDelegateLocal.findMany({
      where: {
        tenantId: current.tenantId,
        sourceType: "WORK_ORDER",
        sourceId: current.id,
        status: { notIn: ["CLOSED", "REJECTED", "EXPIRED"] },
        deletedAt: null,
      },
      select: { id: true, deferralCode: true, status: true },
    });
    for (const d of openDeferrals) {
      await deferralDelegateLocal.update({
        where: { id: d.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closeNotes: `Cerrado automáticamente al cerrar la OT ${current.workOrderCode} (estado previo: ${d.status}).`,
          updatedByUserId: session.user.id,
        },
      });
      void publishAudit(prismaRaw, {
        tenantId: current.tenantId,
        actorUserId: session.user.id,
        action: "Deferral.closed",
        entityType: "Deferral",
        entityId: d.id,
        metadata: { deferralCode: d.deferralCode, vesselCode: current.vesselCode, autoClosedBy: "WORK_ORDER_CLOSED", previousStatus: d.status, workOrderCode: current.workOrderCode },
      });
    }
  } catch (err) {
    log.error("[closeWorkOrder] failed to auto-close associated deferrals:", err);
  }

  // Resolver el Defecto de auditoría/inspección externa vinculado a esta OT (la deficiencia
  // se gestiona como Defect). Al cerrar la OT correctiva, el defecto pasa a RESOLVED y, en
  // cascada, se cierra el finding de origen (closeLinkedAuditFinding). Solo defectos
  // EXTERNAL_AUDIT_FINDING en estado no terminal. No bloqueante.
  try {
    const defectDel = (prismaRaw as unknown as {
      defect: {
        findMany(a: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<Array<{ id: string; defectCode: string; status: string; classification: string; sourceType: string | null; sourceId: string | null; tenantId: string; vesselCode: string }>>;
        update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
      };
    }).defect;
    const linkedDefects = await defectDel.findMany({
      where: {
        tenantId: current.tenantId,
        workOrderId: current.id,
        classification: "EXTERNAL_AUDIT_FINDING",
        status: { notIn: ["RESOLVED", "CLOSED"] },
        deletedAt: null,
      },
      select: { id: true, defectCode: true, status: true, classification: true, sourceType: true, sourceId: true, tenantId: true, vesselCode: true },
    });
    for (const d of linkedDefects) {
      await defectDel.update({
        where: { id: d.id },
        data: { status: "RESOLVED", updatedByUserId: session.user.id },
      });
      void publishAudit(prismaRaw, {
        tenantId: current.tenantId,
        actorUserId: session.user.id,
        action: "Defect.resolved",
        entityType: "Defect",
        entityId: d.id,
        metadata: { defectCode: d.defectCode, vesselCode: current.vesselCode, autoResolvedBy: "WORK_ORDER_CLOSED", previousStatus: d.status, workOrderCode: current.workOrderCode },
      });
      // Cascade: cerrar el finding de auditoría de origen.
      void closeLinkedAuditFinding(prismaRaw, d, session.user.id);
    }
  } catch (err) {
    log.error("[closeWorkOrder] failed to auto-resolve linked external-audit defects:", err);
  }

  // La muestra DRAFT ya se creó al AUTORIZAR la OT (ver setWorkOrderApproval).
  // Acá solo completamos sus datos reales de ejecución (horas/fecha), que al
  // autorizar todavía no se conocían.
  try {
    const sampleDel = (prismaRaw as unknown as {
      fluidSample: {
        findFirst(a: { where: Record<string, unknown> }): Promise<{ id: string; runningHours: number | null } | null>;
        update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
      };
    }).fluidSample;
    const linkedSample = await sampleDel.findFirst({
      where: { tenantId: current.tenantId, sourceWorkOrderId: current.id, status: "DRAFT", deletedAt: null },
    });
    if (linkedSample && linkedSample.runningHours == null) {
      await sampleDel.update({
        where: { id: linkedSample.id },
        data: { sampledAt: completedDate, runningHours: payload.runningHoursAtExecution ?? null, updatedByUserId: session.user.id },
      });
    }
  } catch (err) {
    log.error("[closeWorkOrder] failed to backfill linked Sample:", err);
  }

  return { ...closedResult, failedMovements };
}

export async function cancelWorkOrder(session: TenantAccessSession, id: string, payload: CancelWorkOrderInput) {
  ensureCanManageWorkOrders(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  if (current.status === "CLOSED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", "Esta OT ya está cerrada. Solo TENANT_ADMIN puede re-abrirla con justificación.");
  }
  if (current.status === "CANCELLED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", "Esta OT ya fue cancelada.");
  }
  if (current.status === "IN_PROGRESS") {
    // Permitir cancelar IN_PROGRESS solo si NO hay trabajo registrado todavía
    const delegates = prismaRaw as unknown as {
      workLog: { count(a: { where: Record<string, unknown> }): Promise<number> };
      workOrderProgressNote: { count(a: { where: Record<string, unknown> }): Promise<number> };
      stockMovement: { count(a: { where: Record<string, unknown> }): Promise<number> };
    };
    const [workLogCount, progressNoteCount, stockMovementCount] = await Promise.all([
      delegates.workLog.count({ where: { workOrderId: current.id } }),
      delegates.workOrderProgressNote.count({ where: { workOrderId: current.id } }),
      delegates.stockMovement.count({ where: { referenceType: "WORK_ORDER", referenceId: current.id } }),
    ]);
    if (workLogCount > 0 || progressNoteCount > 0 || stockMovementCount > 0) {
      const parts: string[] = [];
      if (workLogCount > 0) parts.push(`${workLogCount} registro(s) de trabajo`);
      if (progressNoteCount > 0) parts.push(`${progressNoteCount} nota(s) de avance`);
      if (stockMovementCount > 0) parts.push(`${stockMovementCount} movimiento(s) de stock`);
      throw new RouteError(
        409,
        "INVALID_STATUS_TRANSITION",
        `Esta OT ya tiene trabajo registrado (${parts.join(", ")}). Cancelarla rompería la trazabilidad. Para finalizarla, cerrala con resultado (ej. "No completada") o pasala a En Espera primero.`,
      );
    }
  } else if (current.status !== "PLANNED" && current.status !== "ON_HOLD") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo OTs en estado Planificada, En Progreso (sin trabajo registrado) o En Espera pueden cancelarse (actual: ${current.status}).`);
  }

  const cancelled = await prisma.workOrder.update({
    where: { id: current.id },
    data: { status: "CANCELLED", cancelReason: normalizeRequiredText(payload.cancelReason, "cancelReason"), updatedByUserId: session.user.id },
  });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.cancelled",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: { workOrderCode: current.workOrderCode, vesselCode: current.vesselCode, cancelReason: payload.cancelReason },
  });

  // Cerrar aplazamientos asociados a esta OT en cualquier estado no-terminal
  try {
    const deferralDelegateLocal = (prismaRaw as unknown as {
      deferral: {
        findMany(a: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{ id: string; deferralCode: string; status: string }[]>;
        update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
      };
    }).deferral;
    const openDeferrals = await deferralDelegateLocal.findMany({
      where: {
        tenantId: current.tenantId,
        sourceType: "WORK_ORDER",
        sourceId: current.id,
        status: { notIn: ["CLOSED", "REJECTED", "EXPIRED"] },
        deletedAt: null,
      },
      select: { id: true, deferralCode: true, status: true },
    });
    for (const d of openDeferrals) {
      await deferralDelegateLocal.update({
        where: { id: d.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closeNotes: `Cerrado automáticamente al cancelar la OT ${current.workOrderCode} (estado previo: ${d.status}).`,
          updatedByUserId: session.user.id,
        },
      });
      void publishAudit(prismaRaw, {
        tenantId: current.tenantId,
        actorUserId: session.user.id,
        action: "Deferral.closed",
        entityType: "Deferral",
        entityId: d.id,
        metadata: { deferralCode: d.deferralCode, vesselCode: current.vesselCode, autoClosedBy: "WORK_ORDER_CANCELLED", previousStatus: d.status, workOrderCode: current.workOrderCode },
      });
    }
  } catch (err) {
    log.error("[cancelWorkOrder] failed to auto-close associated deferrals:", err);
  }

  // Cancelar devuelve a su vencimiento real a TODOS los planes incluidos, no
  // sólo al principal: ninguno se va a ejecutar por esta OT.
  void (async () => {
    try {
      const { listWorkOrderPlanIds } = await import("./work-order-plans-service");
      const planIds = await listWorkOrderPlanIds(prismaRaw, current);
      for (const planId of planIds) {
        await restorePlanAfterWoCancellation(session, planId);
      }
    } catch (err) {
      log.error("[cancelWorkOrder] plan restore failed:", err);
    }
  })();
  return cancelled;
}

export interface ReopenWorkOrderInput {
  reason: string;
}

/**
 * Re-abre una OT cerrada o cancelada. Solo TENANT_ADMIN.
 *
 * - CLOSED  → IN_PROGRESS (vuelve a estar editable)
 * - CANCELLED → PLANNED   (vuelve al backlog)
 *
 * El motivo queda auditado en lastReopenReason + auditoría central.
 */
export async function reopenWorkOrder(session: TenantAccessSession, id: string, payload: ReopenWorkOrderInput) {
  assertCanReopen(session.user.role);
  const reason = assertReopenReason(payload?.reason);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = workOrdersClient(prismaRaw);

  const current = await getTenantWorkOrder(session, id);
  if (current.status !== "CLOSED" && current.status !== "CANCELLED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo OTs CLOSED o CANCELLED pueden re-abrirse (actual: ${current.status}).`);
  }

  const nextStatus = current.status === "CANCELLED" ? "PLANNED" : "IN_PROGRESS";
  const now = new Date();

  const reopened = await prisma.workOrder.update({
    where: { id: current.id },
    data: {
      status: nextStatus,
      reopenCount: { increment: 1 },
      lastReopenAt: now,
      lastReopenReason: reason,
      lastReopenByUserId: session.user.id,
      updatedByUserId: session.user.id,
    } as Record<string, unknown>,
  });

  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.reopened",
    entityType: "WorkOrder",
    entityId: current.id,
    metadata: {
      workOrderCode: current.workOrderCode,
      vesselCode: current.vesselCode,
      previousStatus: current.status,
      newStatus: nextStatus,
      reason,
    },
  });

  return reopened;
}
