// OT abierta dos veces por error (pedido de Gustavo, oct 2026).
//
// Pasa sobre todo así: alguien abre la OT y después pide la SS con "Nueva SS →
// Mantenimiento / Reparación / Clase", que abre OTRA OT junto con la SS. O se
// toca dos veces "Crear". En la base había 14 OT anuladas como "repetida" o
// "duplicado" y dos pares todavía abiertos (OT-M02-26-0500/0501,
// OT-M01-26-0576/0577).
//
// Criterio, calibrado contra esa base (detecta 11 de las 14 y avisa en ~8% de
// las aperturas, casi todas duplicadas de verdad):
//   · mismo buque y mismo equipo, y la otra OT abierta;
//   · comparten un ítem del plan, o el título se parece (≥ 0,5 de palabras en común);
//   · si las dos ejecutan ítems del plan y ninguno coincide, son trabajos
//     distintos ("Cambio de filtro de aire" y "de gasoil" del mismo motor).
// Es un aviso, nunca un bloqueo: quien carga decide. Un par marcado "No es
// duplicada" no vuelve a avisar, en ninguno de los dos sentidos.
//
// La OT abierta desde un plan tiene además su propio control, más estricto
// (listOpenWorkOrdersForPlans / PLAN_WO_ALREADY_OPEN).

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { log } from "../../common/logger";
import { getTenantWorkOrder, cancelWorkOrder } from "./work-orders-service";
import { cancelServiceRequest } from "../service-requests/service-requests-service";

/** Una OT diferida sigue sin cerrar: también cuenta. */
const WO_OPEN_STATUSES = ["PLANNED", "IN_PROGRESS", "ON_HOLD", "DEFERRED"];
/** SS dadas de baja: no acompañan a ninguna OT. */
const VOID_SR_STATUSES = ["CANCELLED", "REJECTED"];
/** La SS ya salió al taller (o volvió hecha): no se cancela, se pasa a la OT que queda. */
const SR_SENT_STATUSES = ["IN_PROGRESS", "COMPLETED"];
const DISMISS_ACTION = "WorkOrder.duplicateDismissed";
const SIMILAR_TITLE = 0.5;

const STOPWORDS = new Set(["del", "las", "los", "por", "para", "con", "una", "uno", "sus", "the", "and", "for", "dos", "das"]);

function titleWords(text: string): Set<string> {
  const plain = text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return new Set((plain.match(/[a-z0-9]+/g) ?? []).filter(w => w.length > 2 && !STOPWORDS.has(w)));
}

/** Palabras en común sobre palabras totales (0 a 1), sin tildes ni palabras cortas. */
export function titleSimilarity(a: string, b: string): number {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / (wa.size + wb.size - common);
}

export interface PossibleDuplicate {
  id: string;
  workOrderCode: string;
  title: string | null;
  status: string;
  openDate: Date;
  createdByName: string | null;
  /** Por qué se parece. */
  reason: "SAME_PLAN" | "SIMILAR_TITLE";
  /** SS vigentes de esa OT (para decidir cuál anular). */
  serviceRequests: Array<{ id: string; serviceRequestCode: string; status: string; providerName: string | null }>;
}

interface DuplicateRef {
  /** La OT que se está mirando. Ausente = todavía no existe (control antes de crearla). */
  id?: string | null;
  vesselCode: string;
  assetId: string;
  title: string | null;
  planIds: string[];
}

async function findPossibleDuplicates(prisma: any, tenantId: string, ref: DuplicateRef): Promise<PossibleDuplicate[]> {
  const rows: Array<{
    id: string; workOrderCode: string; title: string | null; status: string; openDate: Date;
    createdByUserId: string | null; maintenancePlanId: string | null; planLinks: Array<{ maintenancePlanId: string }>;
  }> = await prisma.workOrder.findMany({
    where: {
      tenantId,
      vesselCode: ref.vesselCode,
      assetId: ref.assetId,
      deletedAt: null,
      status: { in: WO_OPEN_STATUSES },
      ...(ref.id ? { id: { not: ref.id } } : {}),
    },
    select: {
      id: true, workOrderCode: true, title: true, status: true, openDate: true, createdByUserId: true,
      maintenancePlanId: true, planLinks: { select: { maintenancePlanId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const mine = new Set(ref.planIds.filter(Boolean));
  let matches: Array<{ row: (typeof rows)[number]; reason: PossibleDuplicate["reason"] }> = [];
  for (const row of rows) {
    const theirs = new Set([row.maintenancePlanId, ...row.planLinks.map(l => l.maintenancePlanId)].filter((p): p is string => !!p));
    if ([...theirs].some(p => mine.has(p))) { matches.push({ row, reason: "SAME_PLAN" }); continue; }
    // Cada una ejecuta su propio ítem del plan: son trabajos distintos.
    if (mine.size > 0 && theirs.size > 0) continue;
    if (titleSimilarity(ref.title ?? "", row.title ?? "") >= SIMILAR_TITLE) matches.push({ row, reason: "SIMILAR_TITLE" });
  }
  if (matches.length === 0) return [];

  // Pares que alguien ya marcó "No es duplicada", en cualquiera de las dos OT.
  if (ref.id) {
    const ids = matches.map(m => m.row.id);
    const events: Array<{ entityId: string | null; metadata: unknown }> = await prisma.auditEvent.findMany({
      where: { tenantId, action: DISMISS_ACTION, entityType: "WorkOrder", entityId: { in: [ref.id, ...ids] } },
      select: { entityId: true, metadata: true },
    });
    const dismissed = new Set<string>();
    for (const e of events) {
      const other = (e.metadata as { otherId?: unknown } | null)?.otherId;
      if (typeof other !== "string") continue;
      if (e.entityId === ref.id) dismissed.add(other);
      else if (other === ref.id && e.entityId) dismissed.add(e.entityId);
    }
    matches = matches.filter(m => !dismissed.has(m.row.id));
    if (matches.length === 0) return [];
  }

  const ids = matches.map(m => m.row.id);
  const creatorIds = [...new Set(matches.map(m => m.row.createdByUserId).filter((u): u is string => !!u))];
  const [users, srs] = await Promise.all([
    creatorIds.length
      ? prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, firstName: true, lastName: true, formName: true } })
      : [],
    prisma.serviceRequest.findMany({
      where: { tenantId, workOrderId: { in: ids }, deletedAt: null, status: { notIn: VOID_SR_STATUSES } },
      select: { id: true, workOrderId: true, serviceRequestCode: true, status: true, providerId: true },
      orderBy: { createdAt: "asc" },
    }) as Promise<Array<{ id: string; workOrderId: string; serviceRequestCode: string; status: string; providerId: string | null }>>,
  ]);
  const providerIds = [...new Set(srs.map(s => s.providerId).filter((p): p is string => !!p))];
  const providers: Array<{ id: string; name: string | null }> = providerIds.length
    ? await prisma.provider.findMany({ where: { tenantId, id: { in: providerIds } }, select: { id: true, name: true } })
    : [];
  const providerName = new Map(providers.map(p => [p.id, p.name]));
  const userName = new Map((users as Array<{ id: string; firstName: string | null; lastName: string | null; formName: string | null }>)
    .map(u => [u.id, u.formName?.trim() || [u.firstName, u.lastName].filter(Boolean).join(" ") || null]));

  return matches.map(({ row, reason }) => ({
    id: row.id,
    workOrderCode: row.workOrderCode,
    title: row.title,
    status: row.status,
    openDate: row.openDate,
    createdByName: row.createdByUserId ? userName.get(row.createdByUserId) ?? null : null,
    reason,
    serviceRequests: srs.filter(s => s.workOrderId === row.id).map(s => ({
      id: s.id, serviceRequestCode: s.serviceRequestCode, status: s.status,
      providerName: s.providerId ? providerName.get(s.providerId) ?? null : null,
    })),
  }));
}

async function tenantIdOf(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

/**
 * Antes de crear una OT a mano (alta común, desde un defecto, desde "Nueva SS"
 * o la App a bordo): ¿ya hay una abierta que parece la misma? Fuera del alcance
 * del usuario devuelve vacío, sin decir nada de buques que no ve.
 */
export async function checkWorkOrderDuplicatesBeforeCreate(
  session: TenantAccessSession,
  input: { vesselCode?: string | null; assetId?: string | null; title?: string | null },
): Promise<PossibleDuplicate[]> {
  if (session.user.role === "AUDITOR_READONLY") return [];
  const vesselCode = (input.vesselCode ?? "").trim().toUpperCase();
  const assetId = (input.assetId ?? "").trim();
  if (!vesselCode || !assetId) return [];
  const scope: Record<string, unknown> = {};
  applyAssignedVesselScope(session, scope, vesselCode);
  if (scope.vesselCode !== vesselCode) return [];
  const tenantId = await tenantIdOf(session);
  return findPossibleDuplicates(getPrismaClient(), tenantId, {
    vesselCode, assetId, title: (input.title ?? "").trim() || null, planIds: [],
  });
}

async function planIdsOf(prisma: any, wo: { id: string; maintenancePlanId?: string | null }): Promise<string[]> {
  const links: Array<{ maintenancePlanId: string }> = await prisma.workOrderMaintenancePlan.findMany({
    where: { workOrderId: wo.id }, select: { maintenancePlanId: true },
  });
  return [...new Set([wo.maintenancePlanId, ...links.map(l => l.maintenancePlanId)].filter((p): p is string => !!p))];
}

/** Aviso de la ficha: OT abiertas que parecen la misma que esta. Cerrada o cancelada, nada. */
export async function listWorkOrderPossibleDuplicates(session: TenantAccessSession, id: string): Promise<PossibleDuplicate[]> {
  const prisma = getPrismaClient() as any;
  const wo = await getTenantWorkOrder(session, id);
  if (!WO_OPEN_STATUSES.includes(wo.status)) return [];
  const extra = wo as unknown as { maintenancePlanId?: string | null; title?: string | null };
  return findPossibleDuplicates(prisma, wo.tenantId, {
    id: wo.id, vesselCode: wo.vesselCode, assetId: wo.assetId, title: extra.title ?? null,
    planIds: await planIdsOf(prisma, { id: wo.id, maintenancePlanId: extra.maintenancePlanId }),
  });
}

/** "No es duplicada": el par no vuelve a avisar en ninguna de las dos OT. */
export async function dismissWorkOrderDuplicate(session: TenantAccessSession, id: string, otherId: unknown) {
  if (!hasPermission(session, "wo.operate") && !hasPermission(session, "wo.manage")) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para operar órdenes de trabajo.");
  }
  if (typeof otherId !== "string" || !otherId.trim()) {
    throw new RouteError(400, "VALIDATION_ERROR", "Falta la OT con la que se compara.");
  }
  const prisma = getPrismaClient() as any;
  // Las dos tienen que ser visibles para el usuario (empresa y buque).
  const wo = await getTenantWorkOrder(session, id);
  const other = await getTenantWorkOrder(session, otherId.trim());
  await publishAudit(prisma, {
    tenantId: wo.tenantId,
    actorUserId: session.user.id,
    action: DISMISS_ACTION,
    entityType: "WorkOrder",
    entityId: wo.id,
    metadata: { workOrderCode: wo.workOrderCode, vesselCode: wo.vesselCode, otherId: other.id, otherCode: other.workOrderCode },
  });
  return { ok: true };
}

export interface CancelAsDuplicateResult {
  workOrderCode: string;
  keptWorkOrderCode: string;
  /** SS que pasaron a la OT que queda. */
  movedServiceRequests: string[];
  /** SS canceladas porque la OT que queda ya tenía una al mismo taller. */
  cancelledServiceRequests: string[];
  /** SS que no se pudieron resolver (quedan en la OT anulada, como antes). */
  failedServiceRequests: string[];
}

/**
 * "Anular esta por duplicada": cancela la OT con el motivo "Duplicada de OT-X"
 * y resuelve sus SS, que antes quedaban vivas colgando de una OT cancelada (así
 * quedaron SS-1 y SS-2-MGT19-2026, autorizadas, al anular las repetidas de MGT 19):
 *   · si la OT que queda ya tiene una SS vigente al mismo taller y esta todavía
 *     no salió al taller, esta se cancela;
 *   · si no, se pasa a la OT que queda y se asienta en su hoja de ruta.
 *
 * Los permisos y el control de trabajo registrado son los de cancelWorkOrder.
 * Con muestras de aceite no se anula desde acá: cuelgan de la OT y hay que
 * decidir a mano a cuál van.
 */
export async function cancelWorkOrderAsDuplicate(
  session: TenantAccessSession,
  id: string,
  keepId: unknown,
): Promise<CancelAsDuplicateResult> {
  // Mismo permiso que cancelWorkOrder, pero antes de tocar nada.
  if (!hasPermission(session, "wo.manage")) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para anular órdenes de trabajo.");
  }
  if (typeof keepId !== "string" || !keepId.trim()) {
    throw new RouteError(400, "VALIDATION_ERROR", "Falta la OT que queda.");
  }
  const prisma = getPrismaClient() as any;
  const dup = await getTenantWorkOrder(session, id);
  const keep = await getTenantWorkOrder(session, keepId.trim());
  if (dup.id === keep.id) throw new RouteError(400, "VALIDATION_ERROR", "La OT que queda tiene que ser otra.");
  if (dup.vesselCode !== keep.vesselCode) {
    throw new RouteError(400, "OTHER_VESSEL", "Las dos OT tienen que ser del mismo buque.");
  }
  if (!WO_OPEN_STATUSES.includes(keep.status)) {
    throw new RouteError(409, "KEEP_NOT_OPEN", `La ${keep.workOrderCode} está cerrada o cancelada: no puede quedar en lugar de esta.`);
  }
  const samples = await prisma.fluidSample.count({ where: { tenantId: dup.tenantId, sourceWorkOrderId: dup.id, deletedAt: null } });
  if (samples > 0) {
    throw new RouteError(
      409,
      "HAS_FLUID_SAMPLES",
      `La ${dup.workOrderCode} tiene muestras de aceite cargadas. Revisá a cuál OT corresponden y anulala con "Cancelar".`,
    );
  }

  await cancelWorkOrder(session, dup.id, { cancelReason: `Duplicada de ${keep.workOrderCode}.` });

  const result: CancelAsDuplicateResult = {
    workOrderCode: dup.workOrderCode,
    keptWorkOrderCode: keep.workOrderCode,
    movedServiceRequests: [],
    cancelledServiceRequests: [],
    failedServiceRequests: [],
  };
  const [dupSrs, keepSrs]: Array<Array<{ id: string; serviceRequestCode: string; status: string; providerId: string | null }>> = await Promise.all(
    [dup.id, keep.id].map(woId => prisma.serviceRequest.findMany({
      where: { tenantId: dup.tenantId, workOrderId: woId, deletedAt: null, status: { notIn: VOID_SR_STATUSES } },
      select: { id: true, serviceRequestCode: true, status: true, providerId: true },
    })),
  );
  const keepByProvider = new Map(keepSrs.filter(s => s.providerId).map(s => [s.providerId!, s.serviceRequestCode]));
  const asientaByName = `${session.user.firstName ?? ""} ${session.user.lastName ?? ""}`.trim() || session.user.email;

  for (const sr of dupSrs) {
    try {
      const twin = sr.providerId ? keepByProvider.get(sr.providerId) : undefined;
      if (twin && !SR_SENT_STATUSES.includes(sr.status)) {
        await cancelServiceRequest(session, sr.id, `Duplicada: la ${keep.workOrderCode} ya tiene la ${twin} al mismo taller.`);
        result.cancelledServiceRequests.push(sr.serviceRequestCode);
        continue;
      }
      await prisma.serviceRequest.update({
        where: { id: sr.id },
        data: { workOrderId: keep.id, updatedByUserId: session.user.id },
      });
      await prisma.serviceRequestLog.create({
        data: {
          tenantId: dup.tenantId,
          serviceRequestId: sr.id,
          entryDate: new Date(),
          novedad: `Pasada de la ${dup.workOrderCode} a la ${keep.workOrderCode}: la ${dup.workOrderCode} se anuló por duplicada.`,
          asientaByName,
          asientaByUserId: session.user.id,
          createdByUserId: session.user.id,
        },
      });
      result.movedServiceRequests.push(sr.serviceRequestCode);
    } catch (e) {
      log.error("wo.cancel_duplicate.sr_failed", { serviceRequestId: sr.id, error: e instanceof Error ? e.message : String(e) });
      result.failedServiceRequests.push(sr.serviceRequestCode);
    }
  }

  await publishAudit(prisma, {
    tenantId: dup.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.cancelledAsDuplicate",
    entityType: "WorkOrder",
    entityId: dup.id,
    metadata: {
      workOrderCode: dup.workOrderCode,
      vesselCode: dup.vesselCode,
      keptId: keep.id,
      keptCode: keep.workOrderCode,
      movedServiceRequests: result.movedServiceRequests,
      cancelledServiceRequests: result.cancelledServiceRequests,
      failedServiceRequests: result.failedServiceRequests,
    },
  });
  return result;
}
