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
import { updateTenantMaintenancePlan } from "../maintenance-plans/maintenance-plans-service";
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

export interface CopilotAction {
  /** Tipo de acción. Por ahora solo "update_plan". */
  type: string;
  /** Identificador humano del target (ej. taskCode "DONCHI-LAN-01-1M-M"). */
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
  throw new RouteError(400, "UNSUPPORTED_ACTION_TYPE", `Tipo de acción no soportado: "${action.type}".`);
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
