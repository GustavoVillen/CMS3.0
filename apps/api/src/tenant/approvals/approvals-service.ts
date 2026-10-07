// Bandeja de firmas — lo que un aprobador / autorizador tiene pendiente.
//
// Es una LENTE de sólo lectura sobre las OT y las SS: no guarda nada, no define
// estados propios y no agrega reglas. Junta en una sola llamada las cuatro
// bandejas que la pantalla móvil (/m-approvals) muestra como botones, para que
// el que firma vea de un vistazo qué le queda y con qué contexto decidir.
//
// Las firmas en sí siguen saliendo por los endpoints de siempre:
//   OT  → POST /app/pms/work-orders/:id/approval      (setWorkOrderApproval)
//   SS  → POST /app/pms/service-requests/:id/approve | /authorize | /reject
// Acá NO se muta nada: si alguna vez hace falta firmar en lote, va a ese lado.
//
// Los cuatro filtros son los mismos que las etapas del tablero de OT (woStage en
// WorkOrders.tsx) y los estados que cada acción de la SS acepta. Si el tablero
// cambia, esto tiene que cambiar con él: el aprobador no puede ver una bandeja
// distinta de la que ve el que preparó el trabajo.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { hasPermission } from "../auth/role-permissions";

/** Una fila de cualquiera de las cuatro bandejas. */
export interface PendingApprovalItem {
  kind: "WO" | "SR";
  id: string;
  code: string;
  vesselCode: string;
  vesselName: string | null;
  /** Equipo. En la SS sale de la OT de origen (la SS no guarda assetId propio). */
  assetName: string | null;
  /** Id del equipo (mismo origen que assetName): el nombre lleva a sus planes. */
  assetId: string | null;
  /**
   * TODOS los equipos de la OT, el principal primero: una OT puede ejecutar
   * planes de varios equipos ("una sola OT para ambos radares") y antes la fila
   * mostraba sólo el principal.
   */
  assetNames: string[];
  /** Ids de esos equipos: el nombre lleva a los planes de todos. */
  assetIds: string[];
  title: string | null;
  /** LA TAREA: descripción del trabajo (OT) o del servicio pedido (SS). */
  task: string | null;
  /** Sólo SS: DETALLE DE LAS CAUSAS del papel. */
  causes: string | null;
  priority: string | null;
  department: string | null;
  status: string;
  openDate: string | null;
  dueDate: string | null;
  /** Talleres / proveedores ya cargados en el registro (catálogo o texto libre). */
  providers: string[];
  /** Quién lo mandó a firmar y cuándo — el paso inmediatamente anterior. */
  requestedByName: string | null;
  requestedAt: string | null;
  /** Sólo OT: SS colgadas que la firma va a arrastrar. */
  serviceRequestCount: number;
  /** Sólo SS: la OT de la que cuelga. */
  workOrderCode: string | null;
  /** Sólo SS: NORMAL / AFECTA SEGURIDAD / AFECTA SERVICIO. */
  purchaseRequestKinds: string[];
  /** Sólo OT y SS autorizadas (woExecute / srExecute): quién autorizó y cuándo. */
  authorizedByName?: string | null;
  authorizedAt?: string | null;
  /** Sólo SS autorizadas: cuándo se mandó al proveedor (null = todavía no). */
  sentAt?: string | null;
  /** Sólo SS ya recibidas con la OT abierta: cuándo y si fue conforme. */
  receivedAt?: string | null;
  receptionConform?: boolean | null;
  /** Sólo OT autorizadas: avances cargados y repuestos consumidos hasta ahora. */
  progressNoteCount?: number;
  spareUsageCount?: number;
  /** Sólo SS autorizadas: novedades asentadas en su hoja de ruta. */
  routeEntryCount?: number;
  /** Sólo OT autorizadas: permisos de trabajo vinculados (sin los cancelados). */
  permitCount?: number;
  /**
   * Grupo SFI para el filtro G0…G9 de Seguimiento. Mismo criterio que los
   * tableros de OT y SS: el del plan (principal o el primero de sus ítems que lo
   * tenga) y, sin plan, el primer dígito del código SFI del equipo. La SS lleva
   * el de su OT.
   */
  sfiGroupNumber: number | null;
}

export interface PendingApprovalsResult {
  can: {
    woApprove: boolean; woAuthorize: boolean; srApprove: boolean; srAuthorize: boolean;
    /** Cargar avances y cerrar la OT (mismo gate que closeWorkOrder). */
    woOperate: boolean;
    /** Registrar consumo de repuestos: va por el PATCH de la OT, que pide wo.manage. */
    woManage: boolean;
    /** Enviar la SS al proveedor y asentar en su hoja de ruta (canManage de la SS). */
    srManage: boolean;
  };
  /**
   * OT abiertas que todavía no se enviaron a aprobar (en preparación). Sólo en
   * Seguimiento (`followAll`): se ven en su lugar de la planilla con "EN
   * PREPARACIÓN" en vez del botón de aprobar (pedido del usuario, oct 2026).
   */
  woPrepare: PendingApprovalItem[];
  woApprove: PendingApprovalItem[];
  woAuthorize: PendingApprovalItem[];
  srApprove: PendingApprovalItem[];
  srAuthorize: PendingApprovalItem[];
  /**
   * OT ya autorizadas que siguen abiertas: la bandeja las conserva hasta el
   * cierre para cargar avances, repuestos y cerrarlas sin salir de la planilla.
   * Nadie firma nada acá; son el paso siguiente de las que ya se firmaron.
   */
  woExecute: PendingApprovalItem[];
  /**
   * SS autorizadas que todavía no se recibieron: para mandarlas al proveedor y
   * seguir su hoja de ruta. Al recibirse (COMPLETED) siguen mientras su OT esté
   * abierta, marcadas como cerradas: la OT todavía las tiene asociadas (pedido
   * de Gustavo, 02-oct-2026). Con la OT cerrada, salen.
   */
  srExecute: PendingApprovalItem[];
}

// Espejo de los gates reales. APROBAR una OT tiene permiso propio desde sep
// 2026 ("wo.approve", el mismo que exige setWorkOrderApproval). AUTORIZAR (OT y
// SS) es de tierra. No inventar permisos acá: si el gate del backend cambia,
// esta lista se corrige con él o la bandeja miente.
const canWoApprove   = (s: TenantAccessSession) => hasPermission(s, "wo.approve");
const canWoAuthorize = (s: TenantAccessSession) => hasPermission(s, "wo.authorize");
const canSrApprove   = (s: TenantAccessSession) => hasPermission(s, "sr.approve");
const canSrAuthorize = (s: TenantAccessSession) => hasPermission(s, "sr.authorize");
// Espejo de canManageWorkOrders / canOperateWorkOrders de work-orders-service.
const canWoManage    = (s: TenantAccessSession) => hasPermission(s, "wo.manage");
const canWoOperate   = (s: TenantAccessSession) => canWoManage(s) || hasPermission(s, "wo.operate");
// Espejo de canManage de service-requests-service: todos menos el auditor.
const canSrManage    = (s: TenantAccessSession) => s.user.role !== "AUDITOR_READONLY";

async function resolveTenantId(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : null);

/** Una OT cerrada o cancelada no espera la firma de nadie. */
const OPEN_WO_STATUSES = ["PLANNED", "IN_PROGRESS", "ON_HOLD", "DEFERRED"];

const WO_SELECT = {
  id: true, workOrderCode: true, vesselCode: true, assetId: true, maintenancePlanId: true,
  title: true, description: true, priority: true, department: true, status: true,
  openDate: true, dueDate: true, providerId: true, providerOther: true,
  enviadoAprobacionByName: true, enviadoAprobacionAt: true,
  aprobadoByName: true, aprobadoAt: true,
  autorizadoByName: true, autorizadoAt: true,
} as const;

const SR_SELECT = {
  id: true, serviceRequestCode: true, vesselCode: true, workOrderId: true,
  title: true, description: true, causes: true, priority: true, department: true,
  status: true, openDate: true, providerId: true, tallerNotes: true,
  purchaseRequestKinds: true, solicitaByName: true, createdAt: true,
  aprobadoByName: true, aprobadoAt: true,
  autorizadoByName: true, autorizadoAt: true, startedAt: true,
  receivedAt: true, receptionConform: true,
} as const;

/**
 * Las cuatro bandejas de firma del usuario, en una sola llamada.
 *
 * Cada bandeja se consulta SÓLO si el usuario tiene la atribución de firmarla:
 * sin permiso devuelve `[]` y el botón sale apagado. El alcance por buque lo
 * pone applyAssignedVesselScope (fail-closed: sin buques asignados no ve nada).
 *
 * `followAll` (Seguimiento, sep 2026): las pendientes de aprobar / autorizar se
 * listan también a quien no las firma pero sigue el circuito (quien opera las
 * OT o gestiona las SS). Caso real: el Jefe de Máquinas manda la OT a aprobar
 * y no la veía en Seguimiento porque la firma es de otro. Sólo se VEN — el
 * botón de firma sale "Sin permiso" y el backend de la firma sigue exigiendo
 * el permiso. Son OT/SS que esa persona ya ve en sus listas, con el mismo
 * alcance por buque. La bandeja del celular no lo pide: allí todo lo que llega
 * se cuenta como "para firmar".
 */
export async function listPendingApprovals(
  session: TenantAccessSession,
  filters: { vesselCode?: string | null; followAll?: boolean } = {},
): Promise<PendingApprovalsResult> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);
  const vesselCode = filters.vesselCode ?? null;

  const can = {
    woApprove:   canWoApprove(session),
    woAuthorize: canWoAuthorize(session),
    srApprove:   canSrApprove(session),
    srAuthorize: canSrAuthorize(session),
    woOperate:   canWoOperate(session),
    woManage:    canWoManage(session),
    srManage:    canSrManage(session),
  };

  const woWhere = (stage: "PREPARAR" | "APROBAR" | "AUTORIZAR" | "EJECUTAR") => {
    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      status: { in: OPEN_WO_STATUSES },
      ...(stage === "PREPARAR"
        // En preparación: nadie la mandó a firmar todavía (o se la rechazaron y
        // volvió a preparación). La inspección propia y la OT Express nacen
        // autorizadas, así que no caen acá.
        ? { enviadoAprobacionAt: null, aprobadoAt: null, autorizadoAt: null }
        : stage === "APROBAR"
        // Pendiente de aprobación: ya la mandaron a firmar y nadie la aprobó.
        // Sin enviadoAprobacionAt la OT está EN PREPARACIÓN y no es de nadie más.
        ? { enviadoAprobacionAt: { not: null }, aprobadoAt: null }
        : stage === "AUTORIZAR"
        // Pendiente de autorización: aprobada a bordo, falta la firma de tierra.
        ? { aprobadoAt: { not: null }, autorizadoAt: null }
        // En ejecución: firmada del todo y todavía abierta.
        : { autorizadoAt: { not: null } }),
    };
    applyAssignedVesselScope(session, where, vesselCode);
    return where;
  };

  // EJECUTAR = autorizada (falta mandarla al taller), ya en el taller, o ya
  // recibida pero con su OT todavía abierta (se ve como cerrada).
  const srWhere = (status: "SOLICITADA" | "APROBADA" | "EJECUTAR") => {
    const where: Record<string, unknown> = {
      tenantId, deletedAt: null,
      ...(status === "EJECUTAR"
        ? { OR: [
            { status: { in: ["AUTORIZADA", "IN_PROGRESS"] } },
            { status: "COMPLETED", workOrder: { status: { in: OPEN_WO_STATUSES }, deletedAt: null } },
          ] }
        : { status }),
    };
    applyAssignedVesselScope(session, where, vesselCode);
    return where;
  };

  const orderWo = [{ enviadoAprobacionAt: "asc" as const }, { workOrderCode: "asc" as const }];
  const orderSr = [{ openDate: "asc" as const }, { serviceRequestCode: "asc" as const }];

  // Las autorizadas se listan a quien firma OT o puede operarlas: es la misma
  // gente que llega a esta pantalla. Sin ninguno de esos permisos, vacía.
  const seesExecute   = can.woApprove || can.woAuthorize || can.woOperate;
  const seesSrExecute = can.srApprove || can.srAuthorize || can.srManage;
  // Pendientes de firma: a quien firma siempre; a quien sólo sigue, con followAll.
  const follow = filters.followAll === true;
  const listWoApprove   = can.woApprove   || (follow && seesExecute);
  const listWoAuthorize = can.woAuthorize || (follow && seesExecute);
  const listSrApprove   = can.srApprove   || (follow && seesSrExecute);
  const listSrAuthorize = can.srAuthorize || (follow && seesSrExecute);
  // Las que están en preparación sólo se siguen: nadie las firma todavía.
  const listWoPrepare   = follow && seesExecute;

  const [woPrepareRows, woApproveRows, woAuthorizeRows, srApproveRows, srAuthorizeRows, woExecuteRows, srExecuteRows] = await Promise.all([
    listWoPrepare
      ? (prisma as any).workOrder.findMany({ where: woWhere("PREPARAR"), select: WO_SELECT, orderBy: [{ workOrderCode: "asc" as const }] })
      : Promise.resolve([]),
    listWoApprove
      ? (prisma as any).workOrder.findMany({ where: woWhere("APROBAR"), select: WO_SELECT, orderBy: orderWo })
      : Promise.resolve([]),
    listWoAuthorize
      ? (prisma as any).workOrder.findMany({ where: woWhere("AUTORIZAR"), select: WO_SELECT, orderBy: orderWo })
      : Promise.resolve([]),
    listSrApprove
      ? (prisma as any).serviceRequest.findMany({ where: srWhere("SOLICITADA"), select: SR_SELECT, orderBy: orderSr })
      : Promise.resolve([]),
    listSrAuthorize
      ? (prisma as any).serviceRequest.findMany({ where: srWhere("APROBADA"), select: SR_SELECT, orderBy: orderSr })
      : Promise.resolve([]),
    seesExecute
      ? (prisma as any).workOrder.findMany({ where: woWhere("EJECUTAR"), select: WO_SELECT, orderBy: orderWo })
      : Promise.resolve([]),
    seesSrExecute
      ? (prisma as any).serviceRequest.findMany({ where: srWhere("EJECUTAR"), select: SR_SELECT, orderBy: orderSr })
      : Promise.resolve([]),
  ]);

  const woRows = [...woPrepareRows, ...woApproveRows, ...woAuthorizeRows, ...woExecuteRows] as any[];
  const srRows = [...srApproveRows, ...srAuthorizeRows, ...srExecuteRows] as any[];
  if (woRows.length === 0 && srRows.length === 0) {
    return { can, woPrepare: [], woApprove: [], woAuthorize: [], srApprove: [], srAuthorize: [], woExecute: [], srExecute: [] };
  }

  // ── Resolución en lote de todo lo que las filas sólo tienen como id ─────────
  // Mismo patrón que listServiceRequests: una consulta por dimensión, nunca una
  // por fila. El nombre del buque se resuelve siempre (nunca se muestra el
  // código a un usuario: ver "DON CHICUETO", no "DCH").
  const woIds     = woRows.map(r => r.id);
  const execIds   = (woExecuteRows as any[]).map(r => r.id);
  const srExecIds = (srExecuteRows as any[]).map(r => r.id);
  const srWoIds   = [...new Set(srRows.map(r => r.workOrderId).filter(Boolean))] as string[];
  const vesselCodes = [...new Set([...woRows, ...srRows].map(r => r.vesselCode).filter(Boolean))] as string[];

  const [srOfWoRows, parentWoRows, vesselRows, noteCountRows, usageRows, routeCountRows, permitCountRows] = await Promise.all([
    // SS colgadas de las OT listadas: aportan sus talleres al contexto de la OT
    // y el aviso de "esta firma arrastra N solicitudes".
    woIds.length > 0
      ? (prisma as any).serviceRequest.findMany({
          where: { tenantId, deletedAt: null, workOrderId: { in: woIds } },
          select: { workOrderId: true, providerId: true, tallerNotes: true },
        })
      : Promise.resolve([]),
    // OT de origen de cada SS: de ahí salen el código de OT y el equipo.
    srWoIds.length > 0
      ? (prisma as any).workOrder.findMany({
          where: { id: { in: srWoIds }, tenantId },
          select: { id: true, workOrderCode: true, assetId: true, maintenancePlanId: true },
        })
      : Promise.resolve([]),
    vesselCodes.length > 0
      ? (prisma as any).vessel.findMany({
          where: { tenantId, code: { in: vesselCodes } },
          select: { code: true, name: true },
        })
      : Promise.resolve([]),
    // Cuánto se cargó ya en las autorizadas: avances vigentes y repuestos
    // consumidos (movimientos de stock con referencia a la OT, el mismo
    // registro que escribe applySpareUsagesToWo).
    execIds.length > 0
      ? (prisma as any).workOrderProgressNote.groupBy({
          by: ["workOrderId"],
          where: { tenantId, deletedAt: null, workOrderId: { in: execIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    execIds.length > 0
      ? (prisma as any).stockMovement.findMany({
          where: { tenantId, referenceType: "WORK_ORDER", referenceId: { in: execIds } },
          select: { referenceId: true, spareId: true },
        })
      : Promise.resolve([]),
    // Novedades de la hoja de ruta de cada SS autorizada (las asentadas, no
    // los hitos que el PDF deriva de las fechas).
    srExecIds.length > 0
      ? (prisma as any).serviceRequestLog.groupBy({
          by: ["serviceRequestId"],
          where: { tenantId, serviceRequestId: { in: srExecIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    // Permisos de trabajo de cada OT autorizada (los cancelados no cuentan).
    execIds.length > 0
      ? (prisma as any).permitToWork.groupBy({
          by: ["workOrderId"],
          where: { tenantId, workOrderId: { in: execIds }, status: { not: "CANCELLED" } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const noteCountByWo = new Map<string, number>(
    (noteCountRows as any[]).map(r => [r.workOrderId, Number(r._count?._all ?? 0)]),
  );
  const routeCountBySr = new Map<string, number>(
    (routeCountRows as any[]).map(r => [r.serviceRequestId, Number(r._count?._all ?? 0)]),
  );
  const permitCountByWo = new Map<string, number>(
    (permitCountRows as any[]).map(r => [r.workOrderId, Number(r._count?._all ?? 0)]),
  );
  // Repuestos distintos por OT, igual que la lista del consumo.
  const sparesByWo = new Map<string, Set<string>>();
  for (const m of usageRows as any[]) {
    const set = sparesByWo.get(m.referenceId) ?? new Set<string>();
    set.add(m.spareId);
    sparesByWo.set(m.referenceId, set);
  }

  const assetIds = [...new Set([
    ...woRows.map(r => r.assetId),
    ...(parentWoRows as any[]).map(w => w.assetId),
  ].filter(Boolean))] as string[];
  const providerIds = [...new Set([
    ...woRows.map(r => r.providerId),
    ...srRows.map(r => r.providerId),
    ...(srOfWoRows as any[]).map(s => s.providerId),
  ].filter(Boolean))] as string[];

  // OT cuyo grupo SFI hace falta: las listadas y las OT de origen de las SS.
  const groupWoIds = [...new Set([...woIds, ...srWoIds])];

  const [assetRows, providerRows, planLinkRows] = await Promise.all([
    assetIds.length > 0
      ? (prisma as any).asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, name: true, sfiCode: true } })
      : Promise.resolve([]),
    providerIds.length > 0
      ? (prisma as any).provider.findMany({ where: { id: { in: providerIds }, tenantId }, select: { id: true, name: true } })
      : Promise.resolve([]),
    // Ítems del PDM de cada OT, en el orden del papel (de ahí sale el grupo SFI).
    groupWoIds.length > 0
      ? (prisma as any).workOrderMaintenancePlan.findMany({
          where: { tenantId, workOrderId: { in: groupWoIds } },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { workOrderId: true, maintenancePlanId: true },
        })
      : Promise.resolve([]),
  ]);

  const planIds = [...new Set([
    ...woRows.map(r => r.maintenancePlanId),
    ...(parentWoRows as any[]).map(w => w.maintenancePlanId),
    ...(planLinkRows as any[]).map(l => l.maintenancePlanId),
  ].filter(Boolean))] as string[];
  const planRows = planIds.length > 0
    ? await (prisma as any).maintenancePlan.findMany({
        where: { id: { in: planIds }, tenantId },
        select: { id: true, sfiGroupNumber: true, assetId: true },
      }) as any[]
    : [];
  // Equipos de los planes vinculados que no son el principal de ninguna OT listada.
  const knownAssetIds = new Set((assetRows as any[]).map(a => a.id));
  const extraAssetIds = [...new Set(planRows.map(p => p.assetId).filter((id: string | null) => id && !knownAssetIds.has(id)))] as string[];
  const extraAssetRows = extraAssetIds.length > 0
    ? await (prisma as any).asset.findMany({ where: { id: { in: extraAssetIds }, tenantId }, select: { id: true, name: true, sfiCode: true } }) as any[]
    : [];

  const vesselNameById   = new Map<string, string | null>((vesselRows as any[]).map(v => [v.code, v.name ?? null]));
  const assetNameById    = new Map<string, string | null>([...(assetRows as any[]), ...extraAssetRows].map(a => [a.id, a.name ?? null]));
  const planAssetById    = new Map<string, string | null>(planRows.map(p => [p.id, p.assetId ?? null]));
  const assetSfiById     = new Map<string, string | null>((assetRows as any[]).map(a => [a.id, a.sfiCode ?? null]));
  const providerNameById = new Map<string, string | null>((providerRows as any[]).map(p => [p.id, p.name ?? null]));
  const parentWoById     = new Map<string, any>((parentWoRows as any[]).map(w => [w.id, w]));
  const planGroupById    = new Map<string, number | null>(planRows.map(p => [p.id, p.sfiGroupNumber ?? null]));
  const linkedPlansByWo  = new Map<string, string[]>();
  for (const l of planLinkRows as any[]) {
    linkedPlansByWo.set(l.workOrderId, [...(linkedPlansByWo.get(l.workOrderId) ?? []), l.maintenancePlanId]);
  }

  /** Grupo SFI de una OT: mismo criterio que woSfiGroup de work-orders-service. */
  const woSfiGroup = (wo: { id: string; assetId: string | null; maintenancePlanId: string | null } | null | undefined): number | null => {
    if (!wo) return null;
    const fromPlan = [wo.maintenancePlanId, ...(linkedPlansByWo.get(wo.id) ?? [])]
      .map(id => (id ? planGroupById.get(id) : null))
      .find((g): g is number => typeof g === "number");
    if (fromPlan !== undefined) return fromPlan;
    const digit = /^\s*(\d)/.exec((wo.assetId ? assetSfiById.get(wo.assetId) : null) ?? "");
    return digit ? Number(digit[1]) : null;
  };

  /** Ids de los equipos de una OT: el principal y los de sus planes, sin repetir. */
  const woAssetIds = (wo: { id: string; assetId: string | null; maintenancePlanId: string | null } | null | undefined): string[] => {
    if (!wo) return [];
    const ids = [wo.assetId, ...[wo.maintenancePlanId, ...(linkedPlansByWo.get(wo.id) ?? [])].map(id => (id ? planAssetById.get(id) : null))];
    return [...new Set(ids.filter((id): id is string => !!id))];
  };
  /** Nombres de esos equipos, en el mismo orden. */
  const woAssetNames = (wo: Parameters<typeof woAssetIds>[0]): string[] => {
    const names: string[] = [];
    for (const id of woAssetIds(wo)) {
      const name = assetNameById.get(id);
      if (name && !names.includes(name)) names.push(name);
    }
    return names;
  };

  /** Taller de una fila: el del catálogo si lo eligió de la lista, si no el texto libre. */
  const providerOf = (providerId: unknown, freeText: unknown): string | null => {
    if (providerId) {
      const name = providerNameById.get(String(providerId));
      if (name) return name;
    }
    const text = String(freeText ?? "").trim();
    return text || null;
  };

  // Talleres de las SS de cada OT, sin repetidos y sin perder el orden.
  const srProvidersByWo = new Map<string, string[]>();
  const srCountByWo = new Map<string, number>();
  for (const s of srOfWoRows as any[]) {
    srCountByWo.set(s.workOrderId, (srCountByWo.get(s.workOrderId) ?? 0) + 1);
    const name = providerOf(s.providerId, s.tallerNotes);
    if (!name) continue;
    const list = srProvidersByWo.get(s.workOrderId) ?? [];
    if (!list.includes(name)) list.push(name);
    srProvidersByWo.set(s.workOrderId, list);
  }

  const mapWo = (r: any): PendingApprovalItem => {
    // El proveedor propio de la OT (department = PROVEEDOR) más los talleres de
    // sus SS: es todo lo que el que firma necesita saber sobre quién concurre.
    const own = providerOf(r.providerId, r.providerOther);
    const providers = [...new Set([...(own ? [own] : []), ...(srProvidersByWo.get(r.id) ?? [])])];
    return {
      kind: "WO",
      id: r.id,
      code: r.workOrderCode,
      vesselCode: r.vesselCode,
      vesselName: vesselNameById.get(r.vesselCode) ?? null,
      assetName: r.assetId ? (assetNameById.get(r.assetId) ?? null) : null,
      assetId: r.assetId ?? null,
      assetNames: woAssetNames(r),
      assetIds: woAssetIds(r),
      title: r.title ?? null,
      task: r.description ?? null,
      causes: null,
      priority: r.priority ?? null,
      department: r.department ?? null,
      status: r.status,
      openDate: iso(r.openDate),
      dueDate: iso(r.dueDate),
      providers,
      // El paso anterior: para aprobar, quién la envió; para autorizar, quién aprobó.
      requestedByName: r.aprobadoAt ? (r.aprobadoByName ?? null) : (r.enviadoAprobacionByName ?? null),
      requestedAt: r.aprobadoAt ? iso(r.aprobadoAt) : iso(r.enviadoAprobacionAt),
      serviceRequestCount: srCountByWo.get(r.id) ?? 0,
      workOrderCode: null,
      purchaseRequestKinds: [],
      sfiGroupNumber: woSfiGroup(r),
    };
  };

  const mapSr = (r: any): PendingApprovalItem => {
    const wo = r.workOrderId ? parentWoById.get(r.workOrderId) : null;
    const taller = providerOf(r.providerId, r.tallerNotes);
    return {
      kind: "SR",
      id: r.id,
      code: r.serviceRequestCode,
      vesselCode: r.vesselCode,
      vesselName: vesselNameById.get(r.vesselCode) ?? null,
      assetName: wo?.assetId ? (assetNameById.get(wo.assetId) ?? null) : null,
      assetId: wo?.assetId ?? null,
      assetNames: woAssetNames(wo),
      assetIds: woAssetIds(wo),
      title: r.title ?? null,
      task: r.description ?? null,
      causes: r.causes ?? null,
      priority: r.priority ?? null,
      department: r.department ?? null,
      status: r.status,
      openDate: iso(r.openDate),
      dueDate: null,
      providers: taller ? [taller] : [],
      requestedByName: r.aprobadoAt ? (r.aprobadoByName ?? null) : (r.solicitaByName ?? null),
      requestedAt: r.aprobadoAt ? iso(r.aprobadoAt) : iso(r.openDate ?? r.createdAt),
      serviceRequestCount: 0,
      workOrderCode: wo?.workOrderCode ?? null,
      purchaseRequestKinds: Array.isArray(r.purchaseRequestKinds) ? r.purchaseRequestKinds : [],
      sfiGroupNumber: woSfiGroup(wo),
    };
  };

  return {
    can,
    woPrepare:   (woPrepareRows as any[]).map(mapWo),
    woApprove:   (woApproveRows as any[]).map(mapWo),
    woAuthorize: (woAuthorizeRows as any[]).map(mapWo),
    srApprove:   (srApproveRows as any[]).map(mapSr),
    srAuthorize: (srAuthorizeRows as any[]).map(mapSr),
    woExecute:   (woExecuteRows as any[]).map(r => ({
      ...mapWo(r),
      authorizedByName: r.autorizadoByName ?? null,
      authorizedAt: iso(r.autorizadoAt),
      progressNoteCount: noteCountByWo.get(r.id) ?? 0,
      spareUsageCount: sparesByWo.get(r.id)?.size ?? 0,
      permitCount: permitCountByWo.get(r.id) ?? 0,
    })),
    srExecute:   (srExecuteRows as any[]).map(r => ({
      ...mapSr(r),
      authorizedByName: r.autorizadoByName ?? null,
      authorizedAt: iso(r.autorizadoAt),
      sentAt: r.status === "IN_PROGRESS" || r.status === "COMPLETED" ? iso(r.startedAt) : null,
      routeEntryCount: routeCountBySr.get(r.id) ?? 0,
      // Recibida (cerrada): la fila queda en gris con la fecha y la conformidad.
      receivedAt: r.status === "COMPLETED" ? iso(r.receivedAt) : null,
      receptionConform: r.status === "COMPLETED" ? (r.receptionConform ?? null) : null,
    })),
  };
}

// ─── Lo que mandé a firmar (app a bordo, Preview V30) ─────────────────────────
//
// El lado opuesto de la bandeja: lo que ESTE usuario envió a aprobar —OT, SS y
// permisos de trabajo— y en qué quedó. Sirve para que el Capitán / Jefe de
// Máquinas vea desde el celular si le aprobaron o rechazaron algo, y por qué,
// sin bajar los listados completos por la conexión del buque.
//
// Misma regla que arriba: lente de sólo lectura, alcance por buque asignado
// (fail-closed) y nombre del buque resuelto, nunca el código.

export type MySubmissionState = "PENDING" | "APPROVED" | "AUTHORIZED" | "REJECTED" | "ACTIVE" | "CLOSED";

export interface MySubmissionItem {
  kind: "WO" | "SR" | "PTW";
  id: string;
  code: string;
  vesselName: string | null;
  title: string | null;
  /** Sólo PTW: tipo de permiso (HOT_WORK…), para rotularlo en el idioma del tenant. */
  permitType: string | null;
  state: MySubmissionState;
  /** Motivo del rechazo, si lo hubo. */
  reason: string | null;
  at: string | null;
}

const MY_SUBMISSIONS_DAYS = 30;

export async function listMySubmissions(
  session: TenantAccessSession,
  filters: { vesselCode?: string | null; limit?: number } = {},
): Promise<{ items: MySubmissionItem[] }> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);
  const vesselCode = filters.vesselCode ?? null;
  const limit = Math.min(Math.max(Number(filters.limit) || 5, 1), 20);
  const me = session.user.id;
  const since = new Date(Date.now() - MY_SUBMISSIONS_DAYS * 24 * 60 * 60 * 1000);

  const scoped = (where: Record<string, unknown>) => {
    applyAssignedVesselScope(session, where, vesselCode);
    return where;
  };

  const [woRows, srRows, ptwRows] = await Promise.all([
    // OT: enviadas por mí, o rechazadas (el rechazo limpia "enviado" y la
    // devuelve a preparación, así que ahí queda sólo quién la creó).
    (prisma as any).workOrder.findMany({
      where: scoped({
        tenantId, deletedAt: null, updatedAt: { gte: since },
        OR: [
          { enviadoAprobacionByUserId: me },
          { createdByUserId: me, rechazadoAt: { not: null }, enviadoAprobacionAt: null },
        ],
      }),
      select: {
        id: true, workOrderCode: true, vesselCode: true, title: true, status: true,
        enviadoAprobacionAt: true, aprobadoAt: true, autorizadoAt: true,
        rechazadoAt: true, rechazoReason: true, updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    (prisma as any).serviceRequest.findMany({
      where: scoped({
        tenantId, deletedAt: null, updatedAt: { gte: since },
        status: { in: ["SOLICITADA", "APROBADA", "AUTORIZADA", "REJECTED"] },
        OR: [{ solicitaByUserId: me }, { createdByUserId: me }],
      }),
      select: {
        id: true, serviceRequestCode: true, vesselCode: true, title: true, description: true,
        status: true, rechazoReason: true, updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    (prisma as any).permitToWork.findMany({
      where: scoped({
        tenantId, deletedAt: null, updatedAt: { gte: since },
        status: { in: ["REQUESTED", "APPROVED", "REJECTED", "ACTIVE"] },
        OR: [{ requestedByUserId: me }, { createdByUserId: me }],
      }),
      select: {
        id: true, permitCode: true, vesselCode: true, type: true, location: true,
        status: true, rejectionReason: true, updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
  ]) as [any[], any[], any[]];

  const vesselCodes = [...new Set([...woRows, ...srRows, ...ptwRows].map(r => r.vesselCode).filter(Boolean))];
  const vesselRows = vesselCodes.length > 0
    ? await (prisma as any).vessel.findMany({ where: { tenantId, code: { in: vesselCodes } }, select: { code: true, name: true } }) as any[]
    : [];
  const vesselName = new Map<string, string | null>(vesselRows.map(v => [v.code, v.name ?? null]));

  const woState = (r: any): MySubmissionState | null => {
    if (r.status === "CLOSED" || r.status === "DONE") return "CLOSED";
    if (r.autorizadoAt) return "AUTHORIZED";
    if (r.aprobadoAt) return "APPROVED";
    if (r.enviadoAprobacionAt) return "PENDING";
    if (r.rechazadoAt) return "REJECTED";
    return null;
  };
  const srState: Record<string, MySubmissionState> = {
    SOLICITADA: "PENDING", APROBADA: "APPROVED", AUTORIZADA: "AUTHORIZED", REJECTED: "REJECTED",
  };
  const ptwState: Record<string, MySubmissionState> = {
    REQUESTED: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED", ACTIVE: "ACTIVE",
  };

  const items: MySubmissionItem[] = [];
  for (const r of woRows) {
    const state = woState(r);
    if (!state || state === "CLOSED") continue;
    items.push({
      kind: "WO", id: r.id, code: r.workOrderCode, vesselName: vesselName.get(r.vesselCode) ?? null,
      title: r.title ?? null, permitType: null, state,
      reason: state === "REJECTED" ? (r.rechazoReason ?? null) : null, at: iso(r.updatedAt),
    });
  }
  for (const r of srRows) {
    items.push({
      kind: "SR", id: r.id, code: r.serviceRequestCode, vesselName: vesselName.get(r.vesselCode) ?? null,
      title: r.title ?? r.description ?? null, permitType: null, state: srState[r.status] ?? "PENDING",
      reason: r.status === "REJECTED" ? (r.rechazoReason ?? null) : null, at: iso(r.updatedAt),
    });
  }
  for (const r of ptwRows) {
    items.push({
      kind: "PTW", id: r.id, code: r.permitCode, vesselName: vesselName.get(r.vesselCode) ?? null,
      title: r.location ?? null, permitType: r.type ?? null, state: ptwState[r.status] ?? "PENDING",
      reason: r.status === "REJECTED" ? (r.rejectionReason ?? null) : null, at: iso(r.updatedAt),
    });
  }

  items.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  return { items: items.slice(0, limit) };
}
