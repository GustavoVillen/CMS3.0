// Aplicador de "acciones sugeridas" del copiloto.
//
// La IA puede emitir acciones estructuradas al final de su respuesta (ver
// formato en streamCopilotoChat). El frontend las muestra como botones
// "Aplicar". Cuando el usuario confirma, llega aquí — validamos, mapeamos
// el `target` humano (taskCode) al id interno y delegamos al service real.
//
// Whitelist de tipos soportados — agregar nuevos casos solo después de
// confirmar que la operación es segura y reversible.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { updateTenantMaintenancePlan, openFormalWorkOrder } from "../maintenance-plans/maintenance-plans-service";
import { createTenantWorkOrder, type WorkOrderDepartment } from "../work-orders/work-orders-service";
import { createServiceRequestForWorkOrder } from "../service-requests/service-requests-service";
import { log } from "../../common/logger";

/**
 * Campos permitidos en el patch del update_plan. Cualquier otro campo
 * que la IA mande se ignora silenciosamente.
 */
const ALLOWED_PLAN_FIELDS = new Set([
  "responsible",
  "description",
  "triggerType",
  "frequencyHours",
  "frequencyMonths",
  "estimatedHours",
  "acceptanceCriteria",
  "loto",
  "riskLevel",
]);

/** create_work_order_from_plan: todo opcional, openFormalWorkOrder hereda el resto del plan. */
const ALLOWED_WO_FROM_PLAN_FIELDS = new Set(["dueDate", "priority", "assignedToUserId"]);

/** create_work_order (standalone/correctivo): title y type los exige applyCreateWorkOrder, no la whitelist. */
const ALLOWED_WO_STANDALONE_FIELDS = new Set([
  "title", "description", "type", "priority", "department", "providerId", "dueDate",
]);

/** create_service_request: cuelga de una OT ya existente. */
const ALLOWED_SERVICE_REQUEST_FIELDS = new Set(["title", "description", "providerId", "priority"]);

export interface CopilotAction {
  /** Tipo de acción: "update_plan" | "create_work_order_from_plan" | "create_work_order" | "create_service_request". */
  type: string;
  /**
   * Identificador humano del target — el código que el usuario reconoce, NO un
   * id interno: taskCode del plan, assetCode del equipo o workOrderCode de la
   * OT, según el tipo. Siempre tiene que salir de un resultado real de una
   * tool query_* (el modelo no lo inventa) — mismo criterio que update_plan.
   */
  target: string;
  /** Campos a actualizar. Filtrados contra una whitelist por tipo. */
  patch: Record<string, unknown>;
  /** Texto descriptivo opcional (el que la IA mostró al usuario). */
  label?: string;
  /** vesselCode opcional para acotar la búsqueda del target. */
  vesselCode?: string;
}

export interface ApplyCopilotActionResult {
  ok: true;
  applied: { type: string; target: string; entityId: string };
}

export async function applyCopilotAction(
  session: TenantAccessSession,
  action: CopilotAction,
): Promise<ApplyCopilotActionResult> {
  if (!action || typeof action !== "object") {
    throw new RouteError(400, "INVALID_ACTION", "Acción inválida.");
  }
  if (action.type === "update_plan") {
    return applyUpdatePlan(session, action);
  }
  if (action.type === "create_work_order_from_plan") {
    return applyCreateWorkOrderFromPlan(session, action);
  }
  if (action.type === "create_work_order") {
    return applyCreateWorkOrder(session, action);
  }
  if (action.type === "create_service_request") {
    return applyCreateServiceRequest(session, action);
  }
  throw new RouteError(400, "UNSUPPORTED_ACTION_TYPE", `Tipo de acción no soportado: "${action.type}".`);
}

/** Filtra `patch` contra una whitelist; tira 400 si no queda ningún campo permitido y `patch` no estaba vacío. */
function filterPatch(patch: Record<string, unknown> | undefined, allowed: Set<string>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (allowed.has(key)) filtered[key] = value;
  }
  return filtered;
}

async function applyUpdatePlan(
  session: TenantAccessSession,
  action: CopilotAction,
): Promise<ApplyCopilotActionResult> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const taskCode = String(action.target ?? "").trim().toUpperCase();
  if (!taskCode) throw new RouteError(400, "MISSING_TARGET", "Falta el taskCode del plan.");

  // Lookup del plan por taskCode dentro del tenant (y vesselCode si vino).
  const planWhere: Record<string, unknown> = { tenantId: tenant.id, taskCode, deletedAt: null };
  if (action.vesselCode) planWhere.vesselCode = action.vesselCode;
  const plan = await (prisma as unknown as { maintenancePlan: { findFirst(a: unknown): Promise<{ id: string; vesselCode: string } | null> } })
    .maintenancePlan.findFirst({ where: planWhere, select: { id: true, vesselCode: true } });
  if (!plan) {
    throw new RouteError(404, "PLAN_NOT_FOUND", `No se encontró un plan con taskCode "${taskCode}".`);
  }

  // Verificar scope: el user puede tocar este vessel?
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(plan.vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel del plan.");
  }

  // Filtrar patch contra whitelist. La IA puede sugerir cualquier cosa;
  // acá decidimos qué campos son seguros de tocar via acción automática.
  const filteredPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(action.patch ?? {})) {
    if (ALLOWED_PLAN_FIELDS.has(key)) {
      filteredPatch[key] = value;
    }
  }
  if (Object.keys(filteredPatch).length === 0) {
    throw new RouteError(400, "NO_VALID_FIELDS", "El patch no tiene campos permitidos. Permitidos: " + [...ALLOWED_PLAN_FIELDS].join(", "));
  }

  log.info(`[copilot-action] update_plan target=${taskCode} fields=${Object.keys(filteredPatch).join(",")} user=${session.user.email}`);

  await updateTenantMaintenancePlan(session, plan.id, filteredPatch);

  return { ok: true, applied: { type: action.type, target: taskCode, entityId: plan.id } };
}

/**
 * create_work_order_from_plan: abre la OT desde un ítem del PDM ya existente.
 * Reutiliza openFormalWorkOrder tal cual — mismo camino que "Abrir OT" a mano
 * desde Planes, así que hereda TODO su comportamiento (título/criterios/LOTO
 * del plan, y si el plan es de taller (PROVEEDOR) abre también la(s)
 * Solicitud(es) de Servicio correspondientes, sin código extra acá).
 * openFormalWorkOrder valida permisos (wo.manage/wo.operate) y vessel scope
 * por su cuenta — no se duplica ese chequeo.
 */
async function applyCreateWorkOrderFromPlan(
  session: TenantAccessSession,
  action: CopilotAction,
): Promise<ApplyCopilotActionResult> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const taskCode = String(action.target ?? "").trim().toUpperCase();
  if (!taskCode) throw new RouteError(400, "MISSING_TARGET", "Falta el taskCode del plan.");

  const planWhere: Record<string, unknown> = { tenantId: tenant.id, taskCode, deletedAt: null };
  if (action.vesselCode) planWhere.vesselCode = action.vesselCode;
  const plan = await (prisma as unknown as { maintenancePlan: { findFirst(a: unknown): Promise<{ id: string } | null> } })
    .maintenancePlan.findFirst({ where: planWhere, select: { id: true } });
  if (!plan) {
    throw new RouteError(404, "PLAN_NOT_FOUND", `No se encontró un plan con taskCode "${taskCode}".`);
  }

  const patch = filterPatch(action.patch, ALLOWED_WO_FROM_PLAN_FIELDS) as {
    dueDate?: string; priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; assignedToUserId?: string;
  };

  log.info(`[copilot-action] create_work_order_from_plan target=${taskCode} user=${session.user.email}`);

  const workOrder = await openFormalWorkOrder(session, plan.id, patch);

  return { ok: true, applied: { type: action.type, target: taskCode, entityId: workOrder.id } };
}

/**
 * create_work_order: OT standalone (correctivo o sin plan que matchee).
 * Reutiliza createTenantWorkOrder — valida permisos y vessel scope por su
 * cuenta. `target` = assetCode del equipo (resuelto por la IA vía
 * query_assets, nunca inventado).
 */
async function applyCreateWorkOrder(
  session: TenantAccessSession,
  action: CopilotAction,
): Promise<ApplyCopilotActionResult> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const assetCode = String(action.target ?? "").trim();
  if (!assetCode) throw new RouteError(400, "MISSING_TARGET", "Falta el assetCode del equipo.");

  const assetWhere: Record<string, unknown> = { tenantId: tenant.id, assetCode, deletedAt: null };
  if (action.vesselCode) assetWhere.vesselCode = action.vesselCode;
  const asset = await (prisma as unknown as { asset: { findFirst(a: unknown): Promise<{ id: string; vesselCode: string } | null> } })
    .asset.findFirst({ where: assetWhere, select: { id: true, vesselCode: true } });
  if (!asset) {
    throw new RouteError(404, "ASSET_NOT_FOUND", `No se encontró un equipo con código "${assetCode}".`);
  }

  const patch = filterPatch(action.patch, ALLOWED_WO_STANDALONE_FIELDS) as {
    title?: string; description?: string;
    type?: "PREVENTIVE" | "CORRECTIVE" | "INSPECTION";
    priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    department?: WorkOrderDepartment; providerId?: string; dueDate?: string;
  };
  if (!patch.title) {
    throw new RouteError(400, "MISSING_TITLE", "Falta el título de la orden de trabajo.");
  }

  log.info(`[copilot-action] create_work_order target=${assetCode} user=${session.user.email}`);

  const workOrder = await createTenantWorkOrder(session, {
    vesselCode: asset.vesselCode,
    assetId: asset.id,
    ...patch,
  });

  return { ok: true, applied: { type: action.type, target: assetCode, entityId: workOrder.id } };
}

/**
 * create_service_request: abre una SS colgada de una OT ya existente.
 * Reutiliza createServiceRequestForWorkOrder — valida permisos, vessel scope
 * y que la OT esté abierta por su cuenta. `target` = workOrderCode.
 */
async function applyCreateServiceRequest(
  session: TenantAccessSession,
  action: CopilotAction,
): Promise<ApplyCopilotActionResult> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const workOrderCode = String(action.target ?? "").trim().toUpperCase();
  if (!workOrderCode) throw new RouteError(400, "MISSING_TARGET", "Falta el código de la orden de trabajo.");

  const woWhere: Record<string, unknown> = { tenantId: tenant.id, workOrderCode, deletedAt: null };
  if (action.vesselCode) woWhere.vesselCode = action.vesselCode;
  const workOrder = await (prisma as unknown as { workOrder: { findFirst(a: unknown): Promise<{ id: string } | null> } })
    .workOrder.findFirst({ where: woWhere, select: { id: true } });
  if (!workOrder) {
    throw new RouteError(404, "WORK_ORDER_NOT_FOUND", `No se encontró una orden de trabajo con código "${workOrderCode}".`);
  }

  const patch = filterPatch(action.patch, ALLOWED_SERVICE_REQUEST_FIELDS) as {
    title?: string; description?: string; providerId?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  };
  if (!patch.providerId) {
    throw new RouteError(400, "MISSING_PROVIDER", "Falta el taller (providerId) al que se le pide el servicio.");
  }

  log.info(`[copilot-action] create_service_request target=${workOrderCode} user=${session.user.email}`);

  const serviceRequest = await createServiceRequestForWorkOrder(session, workOrder.id, patch);

  return { ok: true, applied: { type: action.type, target: workOrderCode, entityId: serviceRequest.id } };
}
