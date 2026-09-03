import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getCachedTenantBySlug } from "../tenant-cache";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { listDueItems } from "../pms/due-items-service";

// ---------------------------------------------------------------------------
// Tareas pendientes de la próxima semana — accesso directo del Dashboard.
// ---------------------------------------------------------------------------
// Junta en UNA lista lo que hoy hay que ir a buscar a dos pantallas distintas:
//
//   - Planes de mantenimiento que vencen dentro de la ventana (los trae
//     listDueItems: ya deriva el estado real por fecha y por horas de equipo,
//     aplica tenant + alcance por buque y SACA los planes que ya tienen una OT
//     abierta, así nada aparece dos veces).
//   - Órdenes de trabajo abiertas (PLANNED / IN_PROGRESS / ON_HOLD) con
//     vencimiento dentro de la ventana.
//
// Ventana = todo lo VENCIDO (sin piso: el atrasado sigue siendo trabajo
// pendiente) + hasta el domingo de la semana que viene inclusive. Las semanas
// arrancan el lunes en UTC, igual que la proyección de carga de trabajo
// (maintenance-plans-service.ts), para que los cortes coincidan entre pantallas.

/** Estados de OT que siguen siendo trabajo por hacer. DEFERRED queda afuera:
 *  una OT diferida se postergó formalmente y no es tarea de esta semana. */
const OPEN_WO_STATUSES = ["PLANNED", "IN_PROGRESS", "ON_HOLD"] as const;

/** Planes por horas: sin fecha de vencimiento, sólo entran si el equipo ya
 *  llegó (o está por llegar) a la marca. FUTURE / UPCOMING quedan afuera. */
const HOURS_DUE_STATUSES = ["OVERDUE", "DUE", "IN_WINDOW"];

export type UpcomingTaskKind = "PLAN" | "WO";
export type UpcomingTaskBucket = "OVERDUE" | "THIS_WEEK" | "NEXT_WEEK";

export interface UpcomingTaskItem {
  kind: UpcomingTaskKind;
  id: string;
  /** taskCode del plan o workOrderCode de la OT — es lo que abre la ficha. */
  code: string;
  title: string;
  vesselCode: string;
  assetId: string;
  /** ISO date-only. null en planes por horas (vencen por contador, no por fecha). */
  dueDate: string | null;
  dueHours: number | null;
  currentHours: number | null;
  /** executionStatus derivado del plan, o status de la OT. */
  status: string;
  bucket: UpcomingTaskBucket;
}

export interface UpcomingTasksResponse {
  /** Lunes de la semana que viene (ISO date-only). */
  nextWeekStart: string;
  /** Domingo de la semana que viene, último día incluido (ISO date-only). */
  windowEnd: string;
  items: UpcomingTaskItem[];
  totals: { overdue: number; thisWeek: number; nextWeek: number; total: number };
}

interface WorkOrderRow {
  id: string;
  workOrderCode: string;
  title: string | null;
  vesselCode: string;
  assetId: string;
  dueDate: Date | null;
  status: string;
}

function startOfWeekUtcMonday(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = out.getUTCDay();               // 0 = domingo
  const diff = dow === 0 ? -6 : 1 - dow;     // retroceder al lunes
  out.setUTCDate(out.getUTCDate() + diff);
  return out;
}

function addUtcDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface UpcomingTasksFilters {
  vesselCode?: string | null;
}

export async function getUpcomingTasks(
  session: TenantAccessSession,
  filters: UpcomingTasksFilters = {},
): Promise<UpcomingTasksResponse> {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const thisWeekStart = startOfWeekUtcMonday(now);
  const nextWeekStart = addUtcDays(thisWeekStart, 7);
  // Fin de la ventana: domingo de la semana que viene, último instante del día.
  const windowEndExclusive = addUtcDays(thisWeekStart, 14);
  const windowEndDay = addUtcDays(thisWeekStart, 13);

  const empty: UpcomingTasksResponse = {
    nextWeekStart: isoDateOnly(nextWeekStart),
    windowEnd: isoDateOnly(windowEndDay),
    items: [],
    totals: { overdue: 0, thisWeek: 0, nextWeek: 0, total: 0 },
  };

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return empty;

  const tenant = await getCachedTenantBySlug(session.tenantSlug);
  if (!tenant) return empty;

  function bucketOf(due: Date | null, overdue: boolean): UpcomingTaskBucket {
    if (overdue) return "OVERDUE";
    if (!due) return "THIS_WEEK";
    if (due.getTime() < todayStart.getTime()) return "OVERDUE";
    if (due.getTime() < nextWeekStart.getTime()) return "THIS_WEEK";
    return "NEXT_WEEK";
  }

  const items: UpcomingTaskItem[] = [];

  // ── Planes de mantenimiento ────────────────────────────────────────────────
  const duePlans = await listDueItems(session, { vesselCode: filters.vesselCode ?? null });

  // Equipos parados: sus planes NO entran en el listado. Esto es lo que hay que
  // hacer esta semana, y sobre una máquina fuera de servicio no hay nada que
  // hacer hasta que vuelva a operar. El plan sigue venciendo y se sigue viendo
  // en el Plan de Mantenimiento, rotulado como fuera de servicio; lo que no
  // corresponde es que aparezca en la lista de trabajo ni en su PDF, donde se
  // lee como una tarea pendiente más.
  //
  // Las ÓRDENES DE TRABAJO abiertas sí se mantienen, aunque el equipo esté
  // parado: una OT la abrió una persona y sigue siendo un compromiso que hay
  // que cerrar o cancelar a mano. Sacarla escondería trabajo real.
  const oosAssetIds = new Set<string>();
  const planAssetIds = [...new Set(duePlans.map(p => p.assetId).filter(Boolean))];
  if (planAssetIds.length > 0) {
    const assetDelegate = (prismaRaw as unknown as {
      asset: { findMany(args: unknown): Promise<{ id: string }[]> };
    }).asset;
    const oos = await assetDelegate.findMany({
      where: { tenantId: tenant.id, deletedAt: null, status: "OUT_OF_SERVICE", id: { in: planAssetIds } },
      select: { id: true },
    });
    for (const a of oos) oosAssetIds.add(a.id);
  }

  for (const plan of duePlans) {
    if (oosAssetIds.has(plan.assetId)) continue;
    const due = plan.nextDueDate ? new Date(plan.nextDueDate) : null;
    const isHours = plan.triggerType === "HOURS" || plan.triggerType === "RUNNING_HOURS";

    if (due) {
      if (due.getTime() >= windowEndExclusive.getTime()) continue;
    } else if (!(isHours && HOURS_DUE_STATUSES.includes(plan.executionStatus))) {
      // Sin fecha y sin contador vencido: no es tarea de esta ventana.
      continue;
    }

    items.push({
      kind: "PLAN",
      id: plan.id,
      code: plan.taskCode,
      title: plan.title,
      vesselCode: plan.vesselCode,
      assetId: plan.assetId,
      dueDate: due ? isoDateOnly(due) : null,
      dueHours: plan.nextDueHours ?? null,
      currentHours: plan.currentHours ?? null,
      status: plan.executionStatus,
      bucket: bucketOf(due, plan.executionStatus === "OVERDUE"),
    });
  }

  // ── Órdenes de trabajo abiertas ────────────────────────────────────────────
  const woWhere: Record<string, unknown> = {
    tenantId: tenant.id,
    deletedAt: null,
    status: { in: [...OPEN_WO_STATUSES] },
    dueDate: { not: null, lt: windowEndExclusive },
  };
  applyAssignedVesselScope(session, woWhere, filters.vesselCode ?? null);

  const workOrderDelegate = (prismaRaw as unknown as {
    workOrder: { findMany(args: unknown): Promise<WorkOrderRow[]> };
  }).workOrder;

  const workOrders = await workOrderDelegate.findMany({
    where: woWhere,
    select: {
      id: true,
      workOrderCode: true,
      title: true,
      vesselCode: true,
      assetId: true,
      dueDate: true,
      status: true,
    },
    orderBy: { dueDate: "asc" },
  });

  for (const wo of workOrders) {
    const due = wo.dueDate ? new Date(wo.dueDate) : null;
    items.push({
      kind: "WO",
      id: wo.id,
      code: wo.workOrderCode,
      title: wo.title ?? wo.workOrderCode,
      vesselCode: wo.vesselCode,
      assetId: wo.assetId,
      dueDate: due ? isoDateOnly(due) : null,
      dueHours: null,
      currentHours: null,
      status: wo.status,
      bucket: bucketOf(due, false),
    });
  }

  // Orden operativo: primero lo vencido, después por fecha. Los planes por horas
  // (sin fecha) cierran su bloque.
  const bucketRank: Record<UpcomingTaskBucket, number> = { OVERDUE: 0, THIS_WEEK: 1, NEXT_WEEK: 2 };
  items.sort((a, b) => {
    const byBucket = bucketRank[a.bucket] - bucketRank[b.bucket];
    if (byBucket !== 0) return byBucket;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return a.code.localeCompare(b.code);
  });

  return {
    nextWeekStart: isoDateOnly(nextWeekStart),
    windowEnd: isoDateOnly(windowEndDay),
    items,
    totals: {
      overdue: items.filter(i => i.bucket === "OVERDUE").length,
      thisWeek: items.filter(i => i.bucket === "THIS_WEEK").length,
      nextWeek: items.filter(i => i.bucket === "NEXT_WEEK").length,
      total: items.length,
    },
  };
}
