// Solicitud de Servicio (SS) — pedido de un servicio EXTERNO (un taller).
//
// Regla central del dominio: una SS SÓLO se abre desde una OT abierta Y
// AUTORIZADA, y queda ligada a ella (1 OT → N SS). Por eso no existe un
// `createServiceRequest` que reciba vesselCode suelto: el único punto de entrada
// es `POST /app/pms/work-orders/:id/service-requests`, que resuelve la OT primero.
//
// Flujo: DRAFT → SOLICITADA → APROBADA → AUTORIZADA → IN_PROGRESS → COMPLETED.
// Contratar un tercero compromete gasto, así que la autorización es un gate duro:
//   · IN_PROGRESS sólo se alcanza desde AUTORIZADA (409 si no).
//   · Autorizar es exclusivo de tierra: TENANT_ADMIN ("DPA / Director de
//     Operaciones") o FLEET_SUPERINTENDENT ("Superintendente técnico") — 403 para
//     el resto, incluido MAINTENANCE_MANAGER ("Capitán / Jefe de Máquinas"), que
//     sí puede aprobar a bordo. Quien pide el servicio no puede habilitar el
//     gasto: son dos personas distintas.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { withUniqueRetry } from "../../common/unique-retry";
import { assertNotLocked } from "../../common/record-lock";
import { getTenantWorkOrder, requireWorkOrderScope } from "../work-orders/work-orders-service";
import { buildHojaRuta } from "./hoja-ruta";

// Estados de OT desde los que se puede pedir un servicio externo. DEFERRED queda
// fuera a propósito: el trabajo se postergó formalmente. assertNotLocked() no
// alcanza acá — sólo bloquea CLOSED/CANCELLED y dejaría pasar DEFERRED.
// Además de estar abierta, la OT tiene que estar AUTORIZADA (ver
// createServiceRequestForWorkOrder).
const WO_OPEN_STATUSES = ["PLANNED", "IN_PROGRESS", "ON_HOLD"];

/**
 * DEPARTAMENTO de la SS (Cubierta/Máquinas/Barcaza/Otros) a partir del SISTEMA
 * de la OT (Máquinas / R-E Cubierta / Barcazas). REGI-OPE-26.3 no tiene
 * "departamento": el eje equivalente del papel es el sistema sobre el que se
 * trabaja, y es el que mejor describe a qué área va el servicio.
 */
function departmentFromSystemArea(systemArea: string | null | undefined): string | null {
  switch (systemArea) {
    case "MAQUINAS":    return "MAQUINAS";
    case "RE_CUBIERTA": return "CUBIERTA";
    case "BARCAZAS":    return "BARCAZA";
    default:            return null;
  }
}

export interface ServiceRequestListFilters {
  status?: string | null;
  priority?: string | null;
  vesselCode?: string | null;
  workOrderId?: string | null;
}

export interface CreateServiceRequestInput {
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  openDate?: string | null;
  title?: string | null;
  description?: string | null;
  causes?: string | null;
  providerId?: string | null;
  tallerNotes?: string | null;
  /** NORMAL | AFECTA SEGURIDAD | AFECTA SERVICIO — el papel admite varias. */
  purchaseRequestKinds?: string[];
  department?: string | null;
  communicationMethod?: string[];
  distribution?: string[];
  observations?: string | null;
  // Pie del formulario: firman Jefe de Máquinas y Capitán.
  capitanName?: string | null;
  jefeMaquinasName?: string | null;
}

export interface UpdateServiceRequestInput extends CreateServiceRequestInput {}

// ── RBAC ─────────────────────────────────────────────────────────────────────
// No hay sistema de permisos en el proyecto: son checks ad-hoc por servicio
// (mismo patrón que work-orders-service / spare-requests-service).

/** Crear / editar / enviar: todos salvo el auditor externo (solo-lectura). */
function canManage(session: TenantAccessSession): boolean {
  return session.user.role !== "AUDITOR_READONLY";
}

/** Aprobar a bordo: incluye al Capitán / Jefe de Máquinas. */
function canApprove(session: TenantAccessSession): boolean {
  return ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER"].includes(session.user.role);
}

/**
 * Autorizar (habilita mandar el trabajo al taller): SÓLO tierra.
 *   TENANT_ADMIN         = "DPA / Director de Operaciones"
 *   FLEET_SUPERINTENDENT = "Superintendente técnico"
 *
 * El Jefe de Máquinas (MAINTENANCE_MANAGER) aprueba a bordo pero NO autoriza:
 * así el gasto con el tercero siempre lo habilita alguien distinto de quien lo
 * pidió. Es a propósito más estricto que la tramitación de la OT (trabajo
 * propio) — no unificar con ella.
 */
function canAuthorize(session: TenantAccessSession): boolean {
  return ["TENANT_ADMIN", "FLEET_SUPERINTENDENT"].includes(session.user.role);
}

function ensureCanManage(session: TenantAccessSession) {
  if (!canManage(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar solicitudes de servicio.");
  }
}

function ensureCanApprove(session: TenantAccessSession) {
  if (!canApprove(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para aprobar solicitudes de servicio.");
  }
}

function ensureCanAuthorize(session: TenantAccessSession) {
  if (!canAuthorize(session)) {
    throw new RouteError(
      403,
      "FORBIDDEN",
      "Sólo el Superintendente técnico o el DPA / Director de Operaciones pueden autorizar una solicitud de servicio.",
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveTenantId(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(v => String(v).trim()).filter(Boolean);
}

/** Nombre a estampar en la tramitación: el que se pasó, o el del usuario. */
function signerName(session: TenantAccessSession, name?: string | null): string | null {
  const explicit = normalizeOptionalText(name);
  if (explicit) return explicit;
  const full = `${session.user.firstName ?? ""} ${session.user.lastName ?? ""}`.trim();
  return full || null;
}

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} no es una fecha válida.`);
  return d;
}

async function getRequestOrThrow(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient()!;
  const tenantId = await resolveTenantId(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyAssignedVesselScope(session, where, null);
  const sr = await (prisma as any).serviceRequest.findFirst({ where });
  if (!sr) throw new RouteError(404, "NOT_FOUND", "Solicitud de servicio no encontrada.");
  return sr;
}

/** Campos editables comunes a create/update. */
function writableFields(payload: CreateServiceRequestInput) {
  const comm = normalizeStringArray(payload.communicationMethod);
  const dist = normalizeStringArray(payload.distribution);
  const compras = normalizeStringArray(payload.purchaseRequestKinds);
  return {
    ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
    ...(payload.title !== undefined ? { title: normalizeOptionalText(payload.title) } : {}),
    ...(payload.description !== undefined ? { description: normalizeOptionalText(payload.description) } : {}),
    ...(payload.causes !== undefined ? { causes: normalizeOptionalText(payload.causes) } : {}),
    ...(payload.providerId !== undefined ? { providerId: normalizeOptionalText(payload.providerId) } : {}),
    ...(payload.tallerNotes !== undefined ? { tallerNotes: normalizeOptionalText(payload.tallerNotes) } : {}),
    ...(compras !== undefined ? { purchaseRequestKinds: compras } : {}),
    ...(payload.department !== undefined ? { department: normalizeOptionalText(payload.department) as any } : {}),
    ...(comm !== undefined ? { communicationMethod: comm } : {}),
    ...(dist !== undefined ? { distribution: dist } : {}),
    ...(payload.observations !== undefined ? { observations: normalizeOptionalText(payload.observations) } : {}),
    ...(payload.capitanName !== undefined ? { capitanName: normalizeOptionalText(payload.capitanName) } : {}),
    ...(payload.jefeMaquinasName !== undefined ? { jefeMaquinasName: normalizeOptionalText(payload.jefeMaquinasName) } : {}),
  };
}

// ── Lectura ──────────────────────────────────────────────────────────────────

export async function listServiceRequests(session: TenantAccessSession, filters: ServiceRequestListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.workOrderId) where.workOrderId = filters.workOrderId;
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);

  const rows = await (prisma as any).serviceRequest.findMany({
    where,
    orderBy: [{ openDate: "desc" }, { serviceRequestCode: "desc" }],
    include: { workOrder: { select: { id: true, workOrderCode: true, title: true, status: true, assetId: true } } },
  });

  // El equipo lo tiene la OT de origen (la SS no guarda assetId propio). Se
  // resuelve el nombre en lote y se adjunta a workOrder.assetName para que el
  // modal lo muestre en el header sin un fetch extra.
  const assetIds = [...new Set(rows.map((r: any) => r.workOrder?.assetId).filter(Boolean))] as string[];
  // El TALLER QUE CONCURRE puede estar como proveedor del catálogo (providerId)
  // o como texto libre (tallerNotes). Se resuelve el nombre del catálogo en lote
  // para que el modal muestre el taller cuando vino elegido de la lista (si no,
  // el campo queda vacío aunque la hoja de ruta sí lo muestre).
  const providerIds = [...new Set(rows.map((r: any) => r.providerId).filter(Boolean))] as string[];
  const [assetRows, providerRows] = await Promise.all([
    assetIds.length > 0
      ? (prisma as any).asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, name: true } })
      : Promise.resolve([]),
    providerIds.length > 0
      ? (prisma as any).provider.findMany({ where: { id: { in: providerIds }, tenantId }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const assetNameMap = new Map<string, string | null>(assetRows.map((a: any) => [a.id, a.name ?? null]));
  const providerNameMap = new Map<string, string | null>(providerRows.map((p: any) => [p.id, p.name ?? null]));

  return rows.map((r: any) => ({
    ...r,
    providerName: r.providerId ? (providerNameMap.get(r.providerId) ?? null) : null,
    workOrder: r.workOrder
      ? { ...r.workOrder, assetName: assetNameMap.get(r.workOrder.assetId) ?? null }
      : r.workOrder,
  }));
}

export async function getServiceRequest(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient()!;
  const sr = await getRequestOrThrow(session, id);
  const [wo, hojaRuta] = await Promise.all([
    (prisma as any).workOrder.findUnique({
      where: { id: sr.workOrderId },
      select: { id: true, workOrderCode: true, title: true, status: true, assetId: true },
    }),
    // Novedades asentadas a mano; el PDF las mezcla con los hitos derivados.
    (prisma as any).serviceRequestLog.findMany({
      where: { serviceRequestId: id },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const [asset, provider] = await Promise.all([
    wo?.assetId
      ? (prisma as any).asset.findFirst({ where: { id: wo.assetId, tenantId: (sr as any).tenantId }, select: { name: true } })
      : null,
    (sr as any).providerId
      ? (prisma as any).provider.findUnique({ where: { id: (sr as any).providerId }, select: { name: true } })
      : null,
  ]);
  const assetName: string | null = asset?.name ?? null;
  const providerName: string | null = provider?.name ?? null;
  return { ...sr, providerName, workOrder: wo ? { ...wo, assetName } : wo, hojaRuta };
}

/** SS de una OT — panel del modal de OT. */
export async function listWorkOrderServiceRequests(session: TenantAccessSession, workOrderId: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  // Resuelve tenant + vessel scope + 404 si la OT no es visible para el usuario.
  // Chequeo LIVIANO: este panel sólo lista las SS, no necesita el detalle de la
  // OT (evita repetir getTenantWorkOrder al abrir el modal).
  await requireWorkOrderScope(session, workOrderId);
  const tenantId = await resolveTenantId(session);
  return (prisma as any).serviceRequest.findMany({
    where: { tenantId, workOrderId, deletedAt: null },
    orderBy: { serviceRequestCode: "asc" },
  });
}

// ── Creación (única vía: desde una OT abierta) ───────────────────────────────

export async function createServiceRequestForWorkOrder(
  session: TenantAccessSession,
  workOrderId: string,
  payload: CreateServiceRequestInput,
) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prismaRaw = prisma as any;
  const tenantId = await resolveTenantId(session);

  // getTenantWorkOrder aplica tenant + vessel scope y tira 404 si no es visible.
  const wo = await getTenantWorkOrder(session, workOrderId);
  if (!WO_OPEN_STATUSES.includes(String((wo as any).status))) {
    throw new RouteError(
      409,
      "WO_NOT_OPEN",
      "Una solicitud de servicio sólo puede abrirse desde una orden de trabajo abierta.",
    );
  }
  // La OT tiene que estar AUTORIZADA. Contratar un taller compromete gasto, y
  // mal podría hacerse para un trabajo que la propia empresa todavía no aprobó:
  // sería saltear la tramitación de la OT por la ventana de la SS.
  if (!(wo as any).autorizadoAt) {
    throw new RouteError(
      409,
      "WO_NOT_AUTHORIZED",
      "La orden de trabajo debe estar autorizada antes de solicitar un servicio externo.",
    );
  }

  const vesselCode = String((wo as any).vesselCode);
  const openDate = parseOptionalDate(payload.openDate, "openDate") ?? new Date();
  const year = openDate.getFullYear();

  // ── Herencia desde la OT ──────────────────────────────────────────────────
  // El objetivo del formulario: pedir el servicio sin volver a tipear lo que ya
  // está en la OT. Lo que venga en el payload gana; el resto sale de la OT.
  const inherited = {
    // DEPARTAMENTO: del SISTEMA de la OT (el papel nuevo no tiene departamento).
    // Fallback al `department` de la OT para las que vienen de un plan o de
    // tenants con el formulario anterior.
    department: payload.department
      ?? departmentFromSystemArea((wo as any).systemArea)
      ?? (wo as any).department
      ?? null,
    // DETALLE DE LAS CAUSAS = por qué se pide el servicio. La falla que motivó
    // la OT es exactamente eso, así que arranca de ahí y se puede editar.
    causes: payload.causes ?? (wo as any).description ?? null,
    // Si el trabajo de la OT ya se terceriza, el taller viene elegido.
    providerId: payload.providerId ?? (wo as any).providerId ?? null,
  };

  // Formato del documento controlado: SS-<seq>-<BUQUE>-<AÑO> (ej. SS-74-M01-2026).
  // Correlativo por buque y año, sin padding — así lo numera el cliente.
  const created = await withUniqueRetry(async (attempt) => {
    // MAX sobre el correlativo (no COUNT): con gaps o soft-deletes el COUNT no
    // coincide con el máximo real y repite códigos (P2002). SPLIT_PART toma el
    // 2º segmento, que es el seq; los vesselCode no llevan guiones.
    const rows = (await prismaRaw.$queryRawUnsafe(
      `SELECT MAX(CAST(SPLIT_PART("serviceRequestCode", '-', 2) AS INTEGER)) AS max_seq
         FROM "ServiceRequest"
        WHERE "tenantId" = $1 AND "vesselCode" = $2
          AND "serviceRequestCode" ~ ('^SS-[0-9]+-' || $2 || '-' || $3 || '$')
          AND "deletedAt" IS NULL`,
      tenantId,
      vesselCode,
      String(year),
    )) as { max_seq: number | null }[];
    const maxSeq = rows[0]?.max_seq ?? 0;
    const serviceRequestCode = `SS-${maxSeq + 1 + attempt}-${vesselCode}-${year}`;
    return prismaRaw.serviceRequest.create({
      data: {
        tenantId,
        vesselCode,
        workOrderId,
        serviceRequestCode,
        status: "DRAFT",
        openDate,
        ...inherited,
        ...writableFields(payload),
        priority: payload.priority ?? (wo as any).priority ?? "MEDIUM",
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
      },
    });
  });

  void publishAudit(prismaRaw, {
    tenantId,
    actorUserId: session.user.id,
    action: "SERVICE_REQUEST_CREATED",
    entityType: "ServiceRequest",
    entityId: created.id,
    metadata: { serviceRequestCode: created.serviceRequestCode, workOrderId, vesselCode },
  });

  return created;
}

// ── Edición ──────────────────────────────────────────────────────────────────

export async function updateServiceRequest(session: TenantAccessSession, id: string, payload: UpdateServiceRequestInput) {
  ensureCanManage(session);
  const prisma = getPrismaClient()!;
  const current = await getRequestOrThrow(session, id);
  assertNotLocked("SERVICE_REQUEST", current.status);

  return (prisma as any).serviceRequest.update({
    where: { id },
    data: { ...writableFields(payload), updatedByUserId: session.user.id },
  });
}

export async function deleteServiceRequest(session: TenantAccessSession, id: string) {
  ensureCanManage(session);
  const prisma = getPrismaClient()!;
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "DRAFT") {
    throw new RouteError(409, "INVALID_STATUS", "Sólo se puede eliminar una solicitud en borrador.");
  }
  return (prisma as any).serviceRequest.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
}

// ── Transiciones ─────────────────────────────────────────────────────────────

export interface SubmitInput {
  /** Quién solicita. Es el nombre que la hoja de ruta imprime en "Solicitud creada". */
  name?: string | null;
  /** Fechar la solicitud en otro día (sólo TENANT_ADMIN) — SS de papel o corrección. */
  actionDate?: string | Date | null;
}

/**
 * DRAFT → SOLICITADA
 *
 * Registra quién solicita y en qué fecha, igual que los pasos de aprobación.
 * No hay campos nuevos: "quién" es `solicitaByName` (el que ya consume la hoja
 * de ruta como fallback del creador) y "cuándo" es `openDate` — la misma fecha
 * que la hoja imprime como "Solicitud creada".
 *
 * Retrasar la fecha queda restringido al TENANT_ADMIN, mismo criterio que
 * resolveSigner: a bordo se firma con la fecha del día.
 */
export async function submitServiceRequest(session: TenantAccessSession, id: string, payload: SubmitInput = {}) {
  ensureCanManage(session);
  const prisma = getPrismaClient()!;
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "DRAFT") {
    throw new RouteError(409, "INVALID_STATUS", "Sólo se puede enviar una solicitud en borrador.");
  }
  if (!current.description && !current.title) {
    throw new RouteError(400, "VALIDATION_ERROR", "Describí el servicio antes de enviar la solicitud.");
  }
  const solicita = normalizeOptionalText(payload.name);
  const openDate = session.user.role === "TENANT_ADMIN"
    ? parseOptionalDate(payload.actionDate, "actionDate")
    : null;

  return (prisma as any).serviceRequest.update({
    where: { id },
    data: {
      status: "SOLICITADA",
      ...(solicita ? { solicitaByName: solicita } : {}),
      ...(openDate ? { openDate } : {}),
      updatedByUserId: session.user.id,
    },
  });
}

/**
 * SOLICITADA → DRAFT — corregir antes de que la firme nadie.
 *
 * Sólo desde SOLICITADA a propósito: una vez aprobada hay una firma asentada, y
 * volver a borrador la borraría sin dejar rastro. Para deshacer después de una
 * firma están rechazar o cancelar, que sí quedan registrados.
 */
export async function unsubmitServiceRequest(session: TenantAccessSession, id: string) {
  ensureCanManage(session);
  const prisma = getPrismaClient()!;
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "SOLICITADA") {
    throw new RouteError(409, "INVALID_STATUS", "Sólo se puede volver a borrador una solicitud en estado Solicitada.");
  }
  return (prisma as any).serviceRequest.update({
    where: { id },
    data: { status: "DRAFT", updatedByUserId: session.user.id },
  });
}

export interface ApprovalInput {
  /** Nombre a estampar. Si no viene, el del usuario de la sesión. */
  name?: string | null;
  /** Firmar en nombre de otro (sólo TENANT_ADMIN). De ahí sale la firma del PDF. */
  onBehalfUserId?: string | null;
  /** Fechar el paso en otro día (sólo TENANT_ADMIN) — SS de papel o corrección. */
  actionDate?: string | Date | null;
}

/**
 * Firmante y fecha del paso — mismo trato que la tramitación de la OT
 * (setWorkOrderApproval): sólo un TENANT_ADMIN puede firmar en nombre de otro
 * y/o fechar el paso en otro día (SS de papel, corrección de carga). El actor
 * real siempre queda en updatedByUserId y en el audit.
 *
 * La elegibilidad depende del PASO, y por eso NO se copia la de la OT: aprobar
 * admite al Jefe de Máquinas (a bordo), autorizar no — es sólo tierra. Sin esta
 * distinción un admin podría autorizar "en nombre de" un Jefe de Máquinas y
 * saltear por la ventana el gate del gasto (ver canAuthorize).
 *
 * Defensa en profundidad: el front ya ofrece sólo los elegibles de cada paso,
 * pero el que decide es esto.
 */
async function resolveSigner(
  session: TenantAccessSession,
  current: Record<string, any>,
  step: "APRUEBA" | "AUTORIZA",
  payload: ApprovalInput,
): Promise<{ signerUserId: string; actionAt: Date }> {
  let signerUserId = session.user.id;
  let actionAt = new Date();
  if (session.user.role !== "TENANT_ADMIN") return { signerUserId, actionAt };

  const prisma = getPrismaClient()!;
  const onBehalf = normalizeOptionalText(payload.onBehalfUserId);
  if (onBehalf && onBehalf !== session.user.id) {
    const membership = await (prisma as any).tenantMembership.findFirst({
      where: { tenantId: current.tenantId, userId: onBehalf },
      select: { userId: true, role: true, assignedVesselCodes: true },
    });
    if (!membership) {
      throw new RouteError(400, "USER_NOT_IN_TENANT", "El usuario indicado no pertenece a esta empresa.");
    }
    // Un admin firma por cualquiera; el superintendente sólo si está a cargo de
    // ESTE buque; el jefe de máquinas, además, sólo puede APROBAR.
    const enElBuque = Array.isArray(membership.assignedVesselCodes)
      && membership.assignedVesselCodes.includes(current.vesselCode);
    const eligible = membership.role === "TENANT_ADMIN"
      || (membership.role === "FLEET_SUPERINTENDENT" && enElBuque)
      || (step === "APRUEBA" && membership.role === "MAINTENANCE_MANAGER" && enElBuque);
    if (!eligible) {
      throw new RouteError(
        403,
        "NOT_ELIGIBLE_APPROVER",
        step === "APRUEBA"
          ? "Sólo un administrador, el superintendente o el jefe de máquinas a cargo del buque puede aprobar."
          : "Autorizar es sólo del Superintendente técnico o el DPA / Director de Operaciones.",
      );
    }
    signerUserId = onBehalf;
  }
  const d = parseOptionalDate(payload.actionDate, "actionDate");
  if (d) actionAt = d;
  return { signerUserId, actionAt };
}

/** SOLICITADA → APROBADA (a bordo). */
export async function approveServiceRequest(session: TenantAccessSession, id: string, payload: ApprovalInput = {}) {
  ensureCanApprove(session);
  const prisma = getPrismaClient()!;
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "SOLICITADA") {
    throw new RouteError(409, "INVALID_STATUS", "Sólo se puede aprobar una solicitud en estado Solicitada.");
  }
  const { signerUserId, actionAt } = await resolveSigner(session, current, "APRUEBA", payload);
  return (prisma as any).serviceRequest.update({
    where: { id },
    data: {
      status: "APROBADA",
      aprobadoByUserId: signerUserId,
      aprobadoByName: signerName(session, payload.name),
      aprobadoAt: actionAt,
      updatedByUserId: session.user.id,
    },
  });
}

/**
 * APROBADA → AUTORIZADA. Gate del gasto: sólo Superintendente técnico o DPA.
 */
export async function authorizeServiceRequest(session: TenantAccessSession, id: string, payload: ApprovalInput = {}) {
  ensureCanAuthorize(session);
  const prisma = getPrismaClient()!;
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "APROBADA") {
    throw new RouteError(409, "INVALID_STATUS", "Sólo se puede autorizar una solicitud aprobada.");
  }
  const { signerUserId, actionAt } = await resolveSigner(session, current, "AUTORIZA", payload);
  const updated = await (prisma as any).serviceRequest.update({
    where: { id },
    data: {
      status: "AUTORIZADA",
      autorizadoByUserId: signerUserId,
      autorizadoByName: signerName(session, payload.name),
      autorizadoAt: actionAt,
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prisma as any, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "SERVICE_REQUEST_AUTHORIZED",
    entityType: "ServiceRequest",
    entityId: id,
    metadata: {
      serviceRequestCode: current.serviceRequestCode,
      role: session.user.role,
      // Si el admin autorizó en nombre de otro, queda quién firma vs quién actuó.
      ...(signerUserId !== session.user.id ? { onBehalfUserId: signerUserId } : {}),
    },
  });
  return updated;
}

/**
 * AUTORIZADA → IN_PROGRESS. El taller no arranca sin autorización: éste es el
 * punto donde el gate se vuelve efectivo.
 */
export async function startServiceRequest(session: TenantAccessSession, id: string) {
  ensureCanManage(session);
  const prisma = getPrismaClient()!;
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "AUTORIZADA") {
    throw new RouteError(
      409,
      "NOT_AUTHORIZED_YET",
      "La solicitud debe estar autorizada por el Superintendente técnico o el DPA antes de mandar el trabajo al taller.",
    );
  }
  return (prisma as any).serviceRequest.update({
    where: { id },
    data: { status: "IN_PROGRESS", startedAt: new Date(), updatedByUserId: session.user.id },
  });
}

export interface CompleteServiceRequestInput {
  closeNotes?: string | null;
  /** ENTREGA / RECEPCION del formulario. */
  receptionItem?: string | null;
  receivedByName?: string | null;
  receptionConform?: boolean | null;
}

/**
 * IN_PROGRESS → COMPLETED. Es el momento de la ENTREGA / RECEPCION: el
 * formulario pide dejar asentado quién recibió el trabajo del tercero y si hubo
 * conformidad — sin eso el servicio no queda cerrado de verdad.
 */
export async function completeServiceRequest(
  session: TenantAccessSession,
  id: string,
  payload: CompleteServiceRequestInput = {},
) {
  ensureCanManage(session);
  const prisma = getPrismaClient()!;
  const current = await getRequestOrThrow(session, id);
  if (current.status !== "IN_PROGRESS") {
    throw new RouteError(409, "INVALID_STATUS", "Sólo se puede completar una solicitud en ejecución.");
  }
  const recibe = normalizeOptionalText(payload.receivedByName);
  if (!recibe) {
    throw new RouteError(400, "VALIDATION_ERROR", "Indicá quién recibe el servicio (Entrega / Recepción).");
  }
  if (payload.receptionConform === undefined || payload.receptionConform === null) {
    throw new RouteError(400, "VALIDATION_ERROR", "Indicá si hay conformidad con el trabajo realizado.");
  }
  return (prisma as any).serviceRequest.update({
    where: { id },
    data: {
      status: "COMPLETED",
      closeNotes: normalizeOptionalText(payload.closeNotes),
      receptionItem: normalizeOptionalText(payload.receptionItem),
      receivedByName: recibe,
      receptionConform: payload.receptionConform,
      receivedAt: new Date(),
      updatedByUserId: session.user.id,
    },
  });
}

/**
 * Rechazo de tramitación. Lo puede hacer quien aprueba y quien autoriza — el
 * rechazo de la autorización queda restringido igual que la autorización.
 */
export async function rejectServiceRequest(session: TenantAccessSession, id: string, reason: string) {
  const prisma = getPrismaClient()!;
  const current = await getRequestOrThrow(session, id);
  if (!["SOLICITADA", "APROBADA"].includes(current.status)) {
    throw new RouteError(409, "INVALID_STATUS", "Sólo se puede rechazar una solicitud solicitada o aprobada.");
  }
  // Rechazar una APROBADA es negar la autorización → mismo gate que autorizar.
  if (current.status === "APROBADA") ensureCanAuthorize(session);
  else ensureCanApprove(session);

  const motivo = String(reason ?? "").trim();
  if (!motivo) throw new RouteError(400, "VALIDATION_ERROR", "El motivo del rechazo es requerido.");

  return (prisma as any).serviceRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      rechazadoByName: signerName(session),
      rechazadoAt: new Date(),
      rechazoReason: motivo,
      updatedByUserId: session.user.id,
    },
  });
}

export async function cancelServiceRequest(session: TenantAccessSession, id: string, reason?: string | null) {
  ensureCanManage(session);
  const prisma = getPrismaClient()!;
  const current = await getRequestOrThrow(session, id);
  if (["COMPLETED", "CANCELLED"].includes(current.status)) {
    throw new RouteError(409, "INVALID_STATUS", "La solicitud ya está cerrada.");
  }
  return (prisma as any).serviceRequest.update({
    where: { id },
    data: {
      status: "CANCELLED",
      cancelReason: normalizeOptionalText(reason),
      updatedByUserId: session.user.id,
    },
  });
}

// ── HOJA DE RUTA DEL PEDIDO ──────────────────────────────────────────────────
// Sólo las novedades asentadas a mano. Los hitos del sistema se derivan al
// renderizar (ver template-service-request.ts) — acá no se guardan.

export interface HojaRutaEntryInput {
  entryDate?: string | null;
  novedad?: string | null;
  asientaByName?: string | null;
}

/**
 * La HOJA DE RUTA tal como se imprime: hitos derivados + novedades a mano,
 * ordenados por fecha. Las filas con `logId` son las asentadas a mano (las
 * únicas borrables); el resto son hitos que el sistema deriva.
 */
export async function listHojaRuta(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient()!;
  const sr = await getRequestOrThrow(session, id); // tenant + vessel scope + 404
  const [hojaRuta, provider, creador] = await Promise.all([
    (prisma as any).serviceRequestLog.findMany({
      where: { serviceRequestId: id },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
    }),
    sr.providerId
      ? (prisma as any).provider.findUnique({ where: { id: sr.providerId }, select: { name: true } })
      : null,
    sr.createdByUserId
      ? (prisma as any).user.findUnique({
          where: { id: sr.createdByUserId },
          select: { firstName: true, lastName: true, formName: true },
        })
      : null,
  ]);
  const creadorName = creador
    ? (creador.formName?.trim() || `${creador.firstName ?? ""} ${creador.lastName ?? ""}`.trim() || null)
    : null;
  return buildHojaRuta({ ...sr, hojaRuta }, provider?.name ?? null, creadorName);
}

export async function addHojaRutaEntry(session: TenantAccessSession, id: string, payload: HojaRutaEntryInput) {
  ensureCanManage(session);
  const prisma = getPrismaClient()!;
  const current = await getRequestOrThrow(session, id);
  // Una SS cerrada ya no admite novedades nuevas: el pedido dejó de moverse.
  assertNotLocked("SERVICE_REQUEST", current.status);

  const novedad = normalizeOptionalText(payload.novedad);
  if (!novedad) throw new RouteError(400, "VALIDATION_ERROR", "Escribí la novedad.");
  // Sin fecha explícita, la novedad es de hoy.
  const entryDate = parseOptionalDate(payload.entryDate, "entryDate") ?? new Date();
  // Sin nombre explícito, asienta quien la carga.
  const asientaByName = normalizeOptionalText(payload.asientaByName)
    ?? (`${session.user.firstName ?? ""} ${session.user.lastName ?? ""}`.trim() || session.user.email);

  return (prisma as any).serviceRequestLog.create({
    data: {
      tenantId: current.tenantId,
      serviceRequestId: id,
      entryDate,
      novedad,
      asientaByName,
      asientaByUserId: session.user.id,
      createdByUserId: session.user.id,
    },
  });
}

/**
 * Borrar una novedad es corregir un error de carga, no reescribir el historial:
 * queda restringido al admin y auditado. La hoja de ruta es evidencia de cómo se
 * tramitó un pedido con un tercero.
 */
export async function deleteHojaRutaEntry(session: TenantAccessSession, id: string, logId: string) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Sólo un administrador puede borrar una novedad de la hoja de ruta.");
  }
  const prisma = getPrismaClient()!;
  const current = await getRequestOrThrow(session, id);
  const entry = await (prisma as any).serviceRequestLog.findFirst({
    where: { id: logId, serviceRequestId: id },
  });
  if (!entry) throw new RouteError(404, "NOT_FOUND", "Novedad no encontrada.");

  await (prisma as any).serviceRequestLog.delete({ where: { id: logId } });

  void publishAudit(prisma as any, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "SERVICE_REQUEST_HOJA_RUTA_DELETED",
    entityType: "ServiceRequest",
    entityId: id,
    metadata: {
      serviceRequestCode: current.serviceRequestCode,
      novedad: entry.novedad,
      entryDate: entry.entryDate,
      asientaByName: entry.asientaByName,
    },
  });
  return { ok: true };
}
