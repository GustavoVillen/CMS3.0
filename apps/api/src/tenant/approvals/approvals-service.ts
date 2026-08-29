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
}

export interface PendingApprovalsResult {
  can: { woApprove: boolean; woAuthorize: boolean; srApprove: boolean; srAuthorize: boolean };
  woApprove: PendingApprovalItem[];
  woAuthorize: PendingApprovalItem[];
  srApprove: PendingApprovalItem[];
  srAuthorize: PendingApprovalItem[];
}

// Espejo de los gates reales. APROBAR una OT no tiene permiso propio: lo cubre
// el mismo canOperateWorkOrders que exige setWorkOrderApproval. AUTORIZAR (OT y
// SS) es de tierra. No inventar permisos acá: si el gate del backend cambia,
// esta lista se corrige con él o la bandeja miente.
const canWoApprove   = (s: TenantAccessSession) => hasPermission(s, "wo.manage") || hasPermission(s, "wo.operate");
const canWoAuthorize = (s: TenantAccessSession) => hasPermission(s, "wo.authorize");
const canSrApprove   = (s: TenantAccessSession) => hasPermission(s, "sr.approve");
const canSrAuthorize = (s: TenantAccessSession) => hasPermission(s, "sr.authorize");

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
  id: true, workOrderCode: true, vesselCode: true, assetId: true,
  title: true, description: true, priority: true, department: true, status: true,
  openDate: true, dueDate: true, providerId: true, providerOther: true,
  enviadoAprobacionByName: true, enviadoAprobacionAt: true,
  aprobadoByName: true, aprobadoAt: true,
} as const;

const SR_SELECT = {
  id: true, serviceRequestCode: true, vesselCode: true, workOrderId: true,
  title: true, description: true, causes: true, priority: true, department: true,
  status: true, openDate: true, providerId: true, tallerNotes: true,
  purchaseRequestKinds: true, solicitaByName: true, createdAt: true,
  aprobadoByName: true, aprobadoAt: true,
} as const;

/**
 * Las cuatro bandejas de firma del usuario, en una sola llamada.
 *
 * Cada bandeja se consulta SÓLO si el usuario tiene la atribución de firmarla:
 * sin permiso devuelve `[]` y el botón sale apagado. El alcance por buque lo
 * pone applyAssignedVesselScope (fail-closed: sin buques asignados no ve nada).
 */
export async function listPendingApprovals(
  session: TenantAccessSession,
  filters: { vesselCode?: string | null } = {},
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
  };

  const woWhere = (stage: "APROBAR" | "AUTORIZAR") => {
    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      status: { in: OPEN_WO_STATUSES },
      ...(stage === "APROBAR"
        // Pendiente de aprobación: ya la mandaron a firmar y nadie la aprobó.
        // Sin enviadoAprobacionAt la OT está EN PREPARACIÓN y no es de nadie más.
        ? { enviadoAprobacionAt: { not: null }, aprobadoAt: null }
        // Pendiente de autorización: aprobada a bordo, falta la firma de tierra.
        : { aprobadoAt: { not: null }, autorizadoAt: null }),
    };
    applyAssignedVesselScope(session, where, vesselCode);
    return where;
  };

  const srWhere = (status: "SOLICITADA" | "APROBADA") => {
    const where: Record<string, unknown> = { tenantId, deletedAt: null, status };
    applyAssignedVesselScope(session, where, vesselCode);
    return where;
  };

  const orderWo = [{ enviadoAprobacionAt: "asc" as const }, { workOrderCode: "asc" as const }];
  const orderSr = [{ openDate: "asc" as const }, { serviceRequestCode: "asc" as const }];

  const [woApproveRows, woAuthorizeRows, srApproveRows, srAuthorizeRows] = await Promise.all([
    can.woApprove
      ? (prisma as any).workOrder.findMany({ where: woWhere("APROBAR"), select: WO_SELECT, orderBy: orderWo })
      : Promise.resolve([]),
    can.woAuthorize
      ? (prisma as any).workOrder.findMany({ where: woWhere("AUTORIZAR"), select: WO_SELECT, orderBy: orderWo })
      : Promise.resolve([]),
    can.srApprove
      ? (prisma as any).serviceRequest.findMany({ where: srWhere("SOLICITADA"), select: SR_SELECT, orderBy: orderSr })
      : Promise.resolve([]),
    can.srAuthorize
      ? (prisma as any).serviceRequest.findMany({ where: srWhere("APROBADA"), select: SR_SELECT, orderBy: orderSr })
      : Promise.resolve([]),
  ]);

  const woRows = [...woApproveRows, ...woAuthorizeRows] as any[];
  const srRows = [...srApproveRows, ...srAuthorizeRows] as any[];
  if (woRows.length === 0 && srRows.length === 0) {
    return { can, woApprove: [], woAuthorize: [], srApprove: [], srAuthorize: [] };
  }

  // ── Resolución en lote de todo lo que las filas sólo tienen como id ─────────
  // Mismo patrón que listServiceRequests: una consulta por dimensión, nunca una
  // por fila. El nombre del buque se resuelve siempre (nunca se muestra el
  // código a un usuario: ver "DON CHICUETO", no "DCH").
  const woIds     = woRows.map(r => r.id);
  const srWoIds   = [...new Set(srRows.map(r => r.workOrderId).filter(Boolean))] as string[];
  const vesselCodes = [...new Set([...woRows, ...srRows].map(r => r.vesselCode).filter(Boolean))] as string[];

  const [srOfWoRows, parentWoRows, vesselRows] = await Promise.all([
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
          select: { id: true, workOrderCode: true, assetId: true },
        })
      : Promise.resolve([]),
    vesselCodes.length > 0
      ? (prisma as any).vessel.findMany({
          where: { tenantId, code: { in: vesselCodes } },
          select: { code: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const assetIds = [...new Set([
    ...woRows.map(r => r.assetId),
    ...(parentWoRows as any[]).map(w => w.assetId),
  ].filter(Boolean))] as string[];
  const providerIds = [...new Set([
    ...woRows.map(r => r.providerId),
    ...srRows.map(r => r.providerId),
    ...(srOfWoRows as any[]).map(s => s.providerId),
  ].filter(Boolean))] as string[];

  const [assetRows, providerRows] = await Promise.all([
    assetIds.length > 0
      ? (prisma as any).asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, name: true } })
      : Promise.resolve([]),
    providerIds.length > 0
      ? (prisma as any).provider.findMany({ where: { id: { in: providerIds }, tenantId }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const vesselNameById   = new Map<string, string | null>((vesselRows as any[]).map(v => [v.code, v.name ?? null]));
  const assetNameById    = new Map<string, string | null>((assetRows as any[]).map(a => [a.id, a.name ?? null]));
  const providerNameById = new Map<string, string | null>((providerRows as any[]).map(p => [p.id, p.name ?? null]));
  const parentWoById     = new Map<string, any>((parentWoRows as any[]).map(w => [w.id, w]));

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
    };
  };

  return {
    can,
    woApprove:   (woApproveRows as any[]).map(mapWo),
    woAuthorize: (woAuthorizeRows as any[]).map(mapWo),
    srApprove:   (srApproveRows as any[]).map(mapSr),
    srAuthorize: (srAuthorizeRows as any[]).map(mapSr),
  };
}
