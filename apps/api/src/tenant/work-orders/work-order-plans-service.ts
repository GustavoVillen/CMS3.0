// PLANES DE MANTENIMIENTO que ejecuta una OT.
//
// Una parada de astillero cubre varios ítems del PDM en una sola orden
// ("ITEM DEL PDM: 1.7 / 1.8 / 1.9 …"), incluso de equipos distintos. La lista
// completa vive en WorkOrderMaintenancePlan; `WorkOrder.maintenancePlanId`
// sigue siendo el PLAN PRINCIPAL (el que dio equipo, título y datos heredados).
//
// Todo lo que necesita "los planes de esta OT" — cierre, cancelación, historial
// del plan, ITEM DEL PDM del PDF, muestras de fluido — pasa por acá.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { assertNotLocked } from "../../common/record-lock";
import { requireWorkOrderScope } from "./work-orders-service";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { mergePlanTexts, type PlanTextSource } from "./wo-plan-text";
import { hasPermission } from "../auth/role-permissions";
import { resolvePlanProviderRequests } from "../maintenance-plans/maintenance-plans-service";
import { withUniqueRetry } from "../../common/unique-retry";

export interface WorkOrderPlanRow {
  id: string;             // id del plan
  taskCode: string;
  title: string;
  assetId: string;
  assetName: string | null;
  isPrimary: boolean;     // = WorkOrder.maintenancePlanId
}

type AnyPrisma = NonNullable<ReturnType<typeof getPrismaClient>>;

// Mismo criterio que openFormalWorkOrder (maintenance-plans-service.ts): vincular/
// desvincular un item del PDM de una OT es lo que la acredita al cerrarla, asi que
// exige el mismo permiso operativo, no solo excluir al rol solo-lectura.
function ensureCanManage(session: TenantAccessSession) {
  if (!hasPermission(session, "wo.manage") && !hasPermission(session, "wo.operate")) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para editar los planes de la orden de trabajo.");
  }
}

/**
 * Los ids de plan de una OT, en orden (el principal primero).
 *
 * Cae al `maintenancePlanId` de la OT si todavía no hay vínculos: las OT
 * anteriores a esta tabla quedaron migradas, pero una fila puede faltar si el
 * vínculo se creó fuera del flujo normal (scripts de carga, por ejemplo).
 */
export async function listWorkOrderPlanIds(
  prismaRaw: AnyPrisma,
  workOrder: { id: string; maintenancePlanId?: string | null },
): Promise<string[]> {
  const links = await (prismaRaw as any).workOrderMaintenancePlan.findMany({
    where: { workOrderId: workOrder.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { maintenancePlanId: true },
  });
  const ids = links.map((l: { maintenancePlanId: string }) => l.maintenancePlanId);
  const primary = workOrder.maintenancePlanId ?? null;
  if (primary && !ids.includes(primary)) ids.unshift(primary);
  return ids;
}

/** Ids de plan de varias OT a la vez (para listados). Map woId → planIds. */
export async function mapWorkOrderPlanIds(
  prismaRaw: AnyPrisma,
  workOrderIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (workOrderIds.length === 0) return out;
  const links = await (prismaRaw as any).workOrderMaintenancePlan.findMany({
    where: { workOrderId: { in: workOrderIds } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { workOrderId: true, maintenancePlanId: true },
  });
  for (const l of links as Array<{ workOrderId: string; maintenancePlanId: string }>) {
    const list = out.get(l.workOrderId) ?? [];
    list.push(l.maintenancePlanId);
    out.set(l.workOrderId, list);
  }
  return out;
}

/** Los planes de una OT con lo que hace falta para mostrarlos (código, tarea, equipo). */
export async function listWorkOrderPlans(
  prismaRaw: AnyPrisma,
  tenantId: string,
  workOrder: { id: string; maintenancePlanId?: string | null },
): Promise<WorkOrderPlanRow[]> {
  const ids = await listWorkOrderPlanIds(prismaRaw, workOrder);
  if (ids.length === 0) return [];

  const plans = await (prismaRaw as any).maintenancePlan.findMany({
    where: { id: { in: ids }, tenantId, deletedAt: null },
    select: { id: true, taskCode: true, title: true, assetId: true },
  });
  const assetIds = [...new Set(plans.map((p: any) => p.assetId))] as string[];
  const assets = assetIds.length > 0
    ? await (prismaRaw as any).asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, name: true } })
    : [];
  const assetNames = new Map<string, string | null>(assets.map((a: any) => [a.id, a.name ?? null]));
  const byId = new Map<string, any>(plans.map((p: any) => [p.id, p]));

  // Se recorre `ids` (no `plans`) para respetar el orden de los vínculos.
  const rows: WorkOrderPlanRow[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue; // plan borrado: el vínculo queda, pero no se muestra
    rows.push({
      id: p.id,
      taskCode: p.taskCode,
      title: p.title,
      assetId: p.assetId,
      assetName: assetNames.get(p.assetId) ?? null,
      isPrimary: p.id === workOrder.maintenancePlanId,
    });
  }
  return rows;
}

// Los vínculos de una OT nacida de un plan se crean dentro de la transacción de
// openFormalWorkOrder (maintenance-plans-service), no acá: importar este módulo
// desde allá cerraría un ciclo con work-orders-service.

/** Campos de la OT que se heredan de los planes y se rearman al cambiar la lista. */
const MERGED_FIELDS = [
  "title", "description", "acceptanceCriteria", "loto",
  "riskLevel", "riskAnalysisResult", "consequenceCategory", "consequenceRationale",
] as const;

const PLAN_TEXT_SELECT = {
  id: true, taskCode: true, title: true, description: true,
  acceptanceCriteria: true, loto: true, riskLevel: true, riskAnalysisResult: true,
  consequenceCategory: true, consequenceRationale: true,
};

/**
 * Rearma los textos de la OT tras agregar o quitar un ítem del PDM.
 *
 * Solo pisa un campo si su valor actual es EXACTAMENTE el que había armado la
 * lista anterior de planes: si el usuario lo editó a mano, su texto manda. Sin
 * ese resguardo, sumar un ítem borraría la redacción de quien preparó la orden.
 */
async function recomposeWorkOrderText(
  prismaRaw: AnyPrisma,
  args: { workOrderId: string; tenantId: string; beforePlanIds: string[]; afterPlanIds: string[]; actorUserId: string },
) {
  const ids = [...new Set([...args.beforePlanIds, ...args.afterPlanIds])];
  if (ids.length === 0) return;

  const [wo, plans] = await Promise.all([
    (prismaRaw as any).workOrder.findFirst({
      where: { id: args.workOrderId },
      select: Object.fromEntries(MERGED_FIELDS.map((f) => [f, true])),
    }),
    (prismaRaw as any).maintenancePlan.findMany({
      where: { id: { in: ids }, tenantId: args.tenantId, deletedAt: null },
      select: PLAN_TEXT_SELECT,
    }),
  ]);
  if (!wo) return;

  const byId = new Map<string, PlanTextSource & { id: string }>(plans.map((p: any) => [p.id, p]));
  const order = (list: string[]) => list.map((id) => byId.get(id)).filter((p): p is PlanTextSource & { id: string } => !!p);
  const before = mergePlanTexts(order(args.beforePlanIds));
  const after  = mergePlanTexts(order(args.afterPlanIds));

  const data: Record<string, unknown> = {};
  for (const field of MERGED_FIELDS) {
    const current = (wo as any)[field] ?? null;
    const expected = (before as any)[field] ?? null;
    const next = (after as any)[field] ?? null;
    if (current !== expected) continue;   // editado a mano: no se toca
    if (current === next) continue;       // sin cambios
    data[field] = next;
  }
  if (Object.keys(data).length === 0) return;

  await (prismaRaw as any).workOrder.update({
    where: { id: args.workOrderId },
    data: { ...data, updatedByUserId: args.actorUserId },
  });
}

/**
 * Asegura la(s) Solicitud(es) de Servicio de un plan recién sumado a una OT,
 * mismo mecanismo que usa openFormalWorkOrder al abrir la OT desde el plan
 * (una SS por taller, nunca por ítem). Sólo aplica si el plan es de taller
 * (department = PROVEEDOR). Si la OT ya tiene una SS abierta a ese mismo
 * proveedor — porque otro plan sumado antes ya la creó — se le agrega este
 * ítem en vez de duplicarla.
 *
 * `providerOverride` permite mandarla a un taller distinto del que trae
 * configurado el plan (ad hoc, sólo para esta OT — no toca el plan). Clave =
 * providerId original del plan, valor = providerId elegido por el usuario.
 */
async function ensureServiceRequestsForPlan(
  prismaRaw: AnyPrisma,
  session: TenantAccessSession,
  wo: { id: string; tenantId: string; vesselCode: string },
  plan: { id: string; taskCode: string; title: string; description?: string | null; department?: string | null; providerId?: string | null; providerRequests?: unknown },
  providerOverride?: Record<string, string>,
) {
  if (plan.department !== "PROVEEDOR") return;
  let requests = resolvePlanProviderRequests(plan as any);
  if (requests.length === 0) return;
  if (providerOverride) {
    requests = requests.map(r => ({ ...r, providerId: providerOverride[r.providerId] ?? r.providerId }));
  }

  const { queryMaxServiceRequestSeq, insertServiceRequestForWorkOrderTx } =
    await import("../service-requests/service-requests-service");

  const servicio = plan.title;
  const causaBlock = `${plan.taskCode} · ${plan.description ?? plan.title}`;

  await withUniqueRetry(async (attempt) => {
    const year = new Date().getFullYear();
    let seqOffset = 0;
    for (const req of requests) {
      const existingSS = await (prismaRaw as any).serviceRequest.findFirst({
        where: { workOrderId: wo.id, providerId: req.providerId, department: "PROVEEDOR", deletedAt: null },
      });
      if (existingSS) {
        // Ya hay una SS para este taller en esta OT (de otro plan sumado
        // antes): se le agrega el ítem nuevo, no se duplica el pedido.
        if (!(existingSS.causes ?? "").includes(plan.taskCode)) {
          await (prismaRaw as any).serviceRequest.update({
            where: { id: existingSS.id },
            data: {
              causes: existingSS.causes ? `${existingSS.causes}\n\n${causaBlock}` : causaBlock,
              description: existingSS.description ? `${existingSS.description}\n${plan.taskCode} · ${servicio}` : servicio,
              updatedByUserId: session.user.id,
            },
          });
        }
        continue;
      }
      const seqBase = await queryMaxServiceRequestSeq(prismaRaw, wo.tenantId, wo.vesselCode, year);
      await insertServiceRequestForWorkOrderTx(prismaRaw, {
        tenantId: wo.tenantId,
        vesselCode: wo.vesselCode,
        workOrderId: wo.id,
        year,
        openDate: new Date(),
        seqBase,
        seqOffset: seqOffset + attempt,
        actorUserId: session.user.id,
        data: {
          department: "PROVEEDOR",
          providerId: req.providerId,
          title: servicio,
          description: servicio,
          causes: causaBlock,
          priority: "MEDIUM",
        },
      });
      seqOffset++;
    }
  });
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export async function listTenantWorkOrderPlans(session: TenantAccessSession, workOrderId: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const wo = await requireWorkOrderScope(session, workOrderId);
  const full = await (prismaRaw as any).workOrder.findFirst({
    where: { id: wo.id },
    select: { id: true, maintenancePlanId: true },
  });
  return { items: await listWorkOrderPlans(prismaRaw, wo.tenantId, full ?? { id: wo.id }) };
}

/**
 * Suma un plan a la OT. El plan tiene que ser del mismo tenant y del mismo
 * buque: una OT es de un buque, y un plan de otro buque en la misma orden
 * rompería el scope por vessel de todo lo que cuelga (historial, vencimientos).
 * El equipo SÍ puede ser distinto — es justamente el caso de astillero.
 */
export async function addPlanToWorkOrder(
  session: TenantAccessSession,
  workOrderId: string,
  planId: string,
  /** Taller elegido por el usuario en vez del que trae el plan (ad hoc, sólo esta OT). Clave = providerId original. */
  providerOverride?: Record<string, string>,
) {
  ensureCanManage(session);
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const wo = await requireWorkOrderScope(session, workOrderId);
  assertNotLocked("WORK_ORDER", wo.status);

  const plan = await (prismaRaw as any).maintenancePlan.findFirst({
    where: { id: planId, tenantId: wo.tenantId, deletedAt: null },
    select: {
      id: true, taskCode: true, title: true, description: true, vesselCode: true,
      estimatedHours: true, department: true, providerId: true, providerRequests: true,
    },
  });
  if (!plan) throw new RouteError(404, "PLAN_NOT_FOUND", "Plan de mantenimiento no encontrado.");
  if (plan.vesselCode !== wo.vesselCode) {
    throw new RouteError(400, "PLAN_OTHER_VESSEL", "El plan pertenece a otro buque: una orden de trabajo no puede mezclar buques.");
  }

  const existing = await (prismaRaw as any).workOrderMaintenancePlan.findFirst({
    where: { workOrderId: wo.id, maintenancePlanId: planId },
    select: { id: true },
  });
  if (existing) throw new RouteError(409, "PLAN_ALREADY_LINKED", "Ese plan ya está incluido en la orden de trabajo.");

  const full = await (prismaRaw as any).workOrder.findFirst({
    where: { id: wo.id }, select: { id: true, maintenancePlanId: true },
  });
  const beforePlanIds = await listWorkOrderPlanIds(prismaRaw, full ?? { id: wo.id });

  const count = await (prismaRaw as any).workOrderMaintenancePlan.count({ where: { workOrderId: wo.id } });
  await (prismaRaw as any).workOrderMaintenancePlan.create({
    data: {
      tenantId: wo.tenantId,
      workOrderId: wo.id,
      maintenancePlanId: planId,
      sortOrder: count,
      createdByUserId: session.user.id,
    },
  });

  // Título, tarea, criterios, LOTO, riesgo y RCM pasan a incluir el ítem nuevo.
  await recomposeWorkOrderText(prismaRaw, {
    workOrderId: wo.id,
    tenantId: wo.tenantId,
    beforePlanIds,
    afterPlanIds: [...beforePlanIds, planId],
    actorUserId: session.user.id,
  });

  // El plan pasa a "en ventana": ya tiene una OT abierta que lo va a ejecutar,
  // igual que cuando la OT nace del plan (ver openFormalWorkOrder).
  await (prismaRaw as any).maintenancePlan.update({
    where: { id: planId },
    data: { executionStatus: "IN_WINDOW", updatedByUserId: session.user.id },
  });

  // Horas estimadas, área/responsable y proveedor: mismo criterio "no pisar
  // lo que ya tiene" que recomposeWorkOrderText — sólo completan lo que la OT
  // todavía no tiene definido (una OT libre normalmente arranca sin nada de
  // esto, así que en la práctica siempre hereda del plan que se vincula).
  {
    const currentWo = await (prismaRaw as any).workOrder.findFirst({
      where: { id: wo.id }, select: { estimatedHours: true, department: true, assignedToArea: true, providerId: true },
    });
    if (currentWo) {
      const data: Record<string, unknown> = {};
      if (currentWo.estimatedHours == null && plan.estimatedHours != null) {
        data.estimatedHours = plan.estimatedHours;
      }
      if (!currentWo.department && plan.department) {
        data.department = plan.department;
        // Mismo mapeo que openFormalWorkOrder: PROVEEDOR → Tercerizado,
        // dotación propia → Tripulación.
        data.assignedToArea =
          plan.department === "PROVEEDOR" ? "TERCERIZADO"
          : (plan.department === "CUBIERTA" || plan.department === "MAQUINAS" || plan.department === "BARCAZA") ? "TRIPULACION"
          : null;
      }
      if (!currentWo.providerId && plan.department === "PROVEEDOR") {
        const requests = resolvePlanProviderRequests(plan as any);
        // Igual que collapseProviderId en openFormalWorkOrder: si el plan
        // resuelve a un único taller, ese es el proveedor de la OT; si
        // resuelve a varios, se deja sin definir (ambiguo).
        if (requests.length === 1) {
          const providerId = requests[0]!.providerId;
          data.providerId = providerOverride?.[providerId] ?? providerId;
        }
      }
      if (Object.keys(data).length > 0) {
        await (prismaRaw as any).workOrder.update({
          where: { id: wo.id },
          data: { ...data, updatedByUserId: session.user.id },
        });
      }
    }
  }

  // Si el plan es de taller (PROVEEDOR), asegura la SS — mismo mecanismo que
  // abrir la OT desde el plan (una SS por taller). Si la OT ya tiene una SS
  // abierta a ese mismo proveedor (por otro plan sumado antes), se agrega el
  // ítem nuevo a esa SS en vez de duplicarla.
  await ensureServiceRequestsForPlan(prismaRaw, session, wo, plan, providerOverride);

  void publishAudit(prismaRaw, {
    tenantId: wo.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.planLinked",
    entityType: "WorkOrder",
    entityId: wo.id,
    metadata: { planId, taskCode: plan.taskCode, vesselCode: wo.vesselCode },
  });

  return listTenantWorkOrderPlans(session, workOrderId);
}

/**
 * Quita un plan de la OT. El plan PRINCIPAL no se puede quitar: es el que le dio
 * equipo y datos a la orden, y sacarlo dejaría la OT hablando de un trabajo que
 * ya no declara ejecutar. Para eso se cancela la OT.
 */
export async function removePlanFromWorkOrder(session: TenantAccessSession, workOrderId: string, planId: string) {
  ensureCanManage(session);
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const wo = await requireWorkOrderScope(session, workOrderId);
  assertNotLocked("WORK_ORDER", wo.status);

  const full = await (prismaRaw as any).workOrder.findFirst({
    where: { id: wo.id },
    select: { id: true, maintenancePlanId: true },
  });
  if (full?.maintenancePlanId === planId) {
    throw new RouteError(400, "PLAN_IS_PRIMARY", "Ese es el plan principal de la orden de trabajo: no puede quitarse.");
  }

  const link = await (prismaRaw as any).workOrderMaintenancePlan.findFirst({
    where: { workOrderId: wo.id, maintenancePlanId: planId },
    select: { id: true },
  });
  if (!link) throw new RouteError(404, "PLAN_NOT_LINKED", "Ese plan no está incluido en la orden de trabajo.");

  const beforePlanIds = await listWorkOrderPlanIds(prismaRaw, full ?? { id: wo.id });
  await (prismaRaw as any).workOrderMaintenancePlan.delete({ where: { id: link.id } });

  // Los textos vuelven a describir sólo los ítems que quedan.
  await recomposeWorkOrderText(prismaRaw, {
    workOrderId: wo.id,
    tenantId: wo.tenantId,
    beforePlanIds,
    afterPlanIds: beforePlanIds.filter((id) => id !== planId),
    actorUserId: session.user.id,
  });

  // El plan vuelve al estado que le corresponde por vencimiento: ya no tiene
  // esta OT ejecutándolo. Mismo criterio que cancelar una OT.
  try {
    const { restorePlanAfterWoCancellation } = await import("../maintenance-plans/maintenance-plans-service");
    await restorePlanAfterWoCancellation(session, planId);
  } catch { /* non-blocking: el vínculo ya se quitó */ }

  void publishAudit(prismaRaw, {
    tenantId: wo.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.planUnlinked",
    entityType: "WorkOrder",
    entityId: wo.id,
    metadata: { planId, vesselCode: wo.vesselCode },
  });

  return listTenantWorkOrderPlans(session, workOrderId);
}
