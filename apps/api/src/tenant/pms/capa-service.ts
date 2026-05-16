import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { assertNotLocked, assertCanReopen, assertReopenReason } from "../../common/record-lock";
import { withUniqueRetry } from "../../common/unique-retry";

export interface CapaListFilters {
  vesselCode?: string | null;
  status?: string | null;
  priority?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}

export interface CreateCapaRecordInput {
  vesselCode: string;
  assetId: string;
  // Debe coincidir con enum CapaSourceType del schema (DEFECT | WORK_ORDER | INSPECTION).
  sourceType: "DEFECT" | "WORK_ORDER" | "INSPECTION";
  sourceId: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description?: string | null;
  owner?: string | null;
  dueDate?: string | Date | null;
}

export interface UpdateCapaRecordInput {
  vesselCode?: string;
  assetId?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title?: string;
  description?: string | null;
  owner?: string | null;
  dueDate?: string | Date | null;
}

interface CapaRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  sourceType: string;
  sourceId: string;
  capaCode: string;
  status: string;
  priority: string;
  title: string;
  description: string | null;
  owner: string | null;
  dueDate: Date | null;
  completedAt: Date | null;
  verificationNote: string | null;
  cancelReason: string | null;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
}

type CapaDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<CapaRecord[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<CapaRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<CapaRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<CapaRecord>;
};

interface CapaPrismaClient {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  capaRecord: CapaDelegate;
}

function capaDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): CapaDelegate {
  return (prisma as unknown as { capaRecord: CapaDelegate }).capaRecord;
}

function capaClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): CapaPrismaClient {
  return prisma as unknown as CapaPrismaClient;
}

function ensureCanManageCapa(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "FLEET_SUPERINTENDENT" && session.user.role !== "MAINTENANCE_MANAGER") {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar CAPA.");
  }
}

function ensureTenantAdmin(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Operacion permitida solo para TENANT_ADMIN.");
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

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha invalida en ${field}.`);
  return parsed;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = capaClient(prismaRaw);
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

function ensureStatus(current: string, expected: string, action: string) {
  if (current !== expected) {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `${action} requiere estado ${expected} (actual: ${current}).`);
  }
}

export async function listCapaRecords(session: TenantAccessSession, filters: CapaListFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return [];
  const capa = capaDelegate(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.sourceType) where.sourceType = filters.sourceType;
  if (filters.sourceId) where.sourceId = filters.sourceId;

  const records = await capa.findMany({ where, orderBy: { createdAt: "desc" } });
  const assetIds = [...new Set(records.map(r => r.assetId).filter(Boolean))];
  const assetRows = assetIds.length > 0
    ? await (prismaRaw as unknown as { asset: { findMany(a: unknown): Promise<{ id: string; name: string | null }[]> } }).asset.findMany({ where: { id: { in: assetIds }, tenantId, deletedAt: null }, select: { id: true, name: true } })
    : [];
  const assetNameMap = new Map(assetRows.map(a => [a.id, a.name ?? null]));

  // Enriquecer con código humano del source (defectCode / workOrderCode /
  // inspection code) para que el UI no muestre el cuid crudo.
  const sourceCodeMap = await resolveSourceCodes(prismaRaw, tenantId, records);

  return records.map(r => ({
    ...r,
    assetName: assetNameMap.get(r.assetId) ?? null,
    sourceCode: sourceCodeMap.get(`${r.sourceType}|${r.sourceId}`) ?? null,
  }));
}

/**
 * Lookup batch del código humano del origen de cada CAPA. La key del map
 * es "sourceType|sourceId" para distinguir entre tipos.
 */
async function resolveSourceCodes(
  prismaRaw: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  records: Array<{ sourceType: string; sourceId: string }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const defIds  = records.filter(r => r.sourceType === "DEFECT").map(r => r.sourceId);
  const woIds   = records.filter(r => r.sourceType === "WORK_ORDER").map(r => r.sourceId);
  const inspIds = records.filter(r => r.sourceType === "INSPECTION").map(r => r.sourceId);

  const prismaAny = prismaRaw as unknown as {
    defect:     { findMany(a: unknown): Promise<Array<{ id: string; defectCode: string }>> };
    workOrder:  { findMany(a: unknown): Promise<Array<{ id: string; workOrderCode: string }>> };
    inspection: { findMany(a: unknown): Promise<Array<{ id: string; inspectionCode?: string | null }>> };
  };

  if (defIds.length > 0) {
    const defects = await prismaAny.defect.findMany({
      where: { id: { in: defIds }, tenantId, deletedAt: null },
      select: { id: true, defectCode: true },
    });
    for (const d of defects) map.set(`DEFECT|${d.id}`, d.defectCode);
  }
  if (woIds.length > 0) {
    const wos = await prismaAny.workOrder.findMany({
      where: { id: { in: woIds }, tenantId, deletedAt: null },
      select: { id: true, workOrderCode: true },
    });
    for (const w of wos) map.set(`WORK_ORDER|${w.id}`, w.workOrderCode);
  }
  if (inspIds.length > 0) {
    const inspections = await prismaAny.inspection.findMany({
      where: { id: { in: inspIds }, tenantId, deletedAt: null },
      select: { id: true, inspectionCode: true },
    });
    for (const i of inspections) {
      if (i.inspectionCode) map.set(`INSPECTION|${i.id}`, i.inspectionCode);
    }
  }
  return map;
}

export async function getCapaRecord(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await capa.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "CAPA no encontrada.");

  // Enriquecer con nombre del activo y código humano del origen, para
  // que el UI no muestre cuids crudos.
  const assetRow = await (prismaRaw as unknown as { asset: { findFirst(a: unknown): Promise<{ name: string | null } | null> } })
    .asset.findFirst({ where: { id: record.assetId, tenantId, deletedAt: null }, select: { name: true } });
  const sourceCodeMap = await resolveSourceCodes(prismaRaw, tenantId, [record]);

  return {
    ...record,
    assetName: assetRow?.name ?? null,
    sourceCode: sourceCodeMap.get(`${record.sourceType}|${record.sourceId}`) ?? null,
  };
}

export async function createCapaRecord(session: TenantAccessSession, payload: CreateCapaRecordInput) {
  ensureCanManageCapa(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);
  const assetId = normalizeRequiredText(payload.assetId, "assetId");
  const sourceId = normalizeRequiredText(payload.sourceId, "sourceId");

  // Validar tenant ownership de assetId y sourceId.
  const assetCount = await (prismaRaw as any).asset.count({
    where: { id: assetId, tenantId, deletedAt: null },
  });
  if (assetCount === 0) {
    throw new RouteError(404, "ASSET_NOT_FOUND", "Asset no encontrado o no pertenece a este tenant.");
  }
  const sourceModel = payload.sourceType === "DEFECT" ? "defect"
    : payload.sourceType === "WORK_ORDER" ? "workOrder"
    : payload.sourceType === "INSPECTION" ? "inspection"
    : null;
  if (sourceModel) {
    const sourceCount = await (prismaRaw as any)[sourceModel].count({
      where: { id: sourceId, tenantId, deletedAt: null },
    });
    if (sourceCount === 0) {
      throw new RouteError(404, "SOURCE_NOT_FOUND", "Origen no encontrado o no pertenece a este tenant.");
    }
  }

  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const capaCount = await capa.count({ where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
  const capaCode = `CAPA-${vesselCode}-${yy}-${String(capaCount + 1).padStart(4, "0")}`;
  const created = await capa.create({
    data: {
      tenantId,
      vesselCode,
      assetId,
      sourceType: payload.sourceType,
      sourceId,
      capaCode,
      status: "OPEN",
      priority: payload.priority ?? "MEDIUM",
      title: normalizeRequiredText(payload.title, "title"),
      description: normalizeOptionalText(payload.description),
      owner: normalizeOptionalText(payload.owner),
      dueDate: parseOptionalDate(payload.dueDate, "dueDate"),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prismaRaw, {
    tenantId,
    actorUserId: session.user.id,
    action: "Capa.created",
    entityType: "Capa",
    entityId: created.id,
    metadata: { capaCode: created.capaCode, title: created.title, vesselCode: created.vesselCode },
  });
  return created;
}

export async function updateCapaRecord(session: TenantAccessSession, id: string, payload: UpdateCapaRecordInput) {
  ensureCanManageCapa(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const current = await getCapaRecord(session, id);
  // Lockdown vetting: CAPA VERIFIED_EFFECTIVE / CLOSED / CANCELLED → /reopen.
  assertNotLocked("CAPA", current.status);
  if (payload.vesselCode !== undefined) {
    const requested = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
    if (requested !== current.vesselCode) {
      throw new RouteError(400, "VESSEL_IMMUTABLE", "No se permite cambiar vesselCode.");
    }
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.assetId !== undefined) data.assetId = normalizeRequiredText(payload.assetId, "assetId");
  if (payload.priority !== undefined) data.priority = payload.priority;
  if (payload.title !== undefined) data.title = normalizeRequiredText(payload.title, "title");
  if (payload.description !== undefined) data.description = normalizeOptionalText(payload.description);
  if (payload.owner !== undefined) data.owner = normalizeOptionalText(payload.owner);
  if (payload.dueDate !== undefined) data.dueDate = parseOptionalDate(payload.dueDate, "dueDate");

  const updated = await capa.update({ where: { id: current.id }, data });
  void publishAudit(prismaRaw, {
    tenantId: updated.tenantId,
    actorUserId: session.user.id,
    action: "Capa.updated",
    entityType: "Capa",
    entityId: updated.id,
    metadata: { capaCode: updated.capaCode, title: updated.title, vesselCode: updated.vesselCode },
  });
  return updated;
}

export async function completeCapaRecord(session: TenantAccessSession, id: string, payload: { verificationNote?: string }) {
  ensureCanManageCapa(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const current = await getCapaRecord(session, id);
  ensureStatus(current.status, "IN_PROGRESS", "Complete");

  const completed = await capa.update({
    where: { id: current.id },
    data: {
      status: "PENDING_VERIFICATION",
      completedAt: new Date(),
      verificationNote: normalizeOptionalText(payload.verificationNote),
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prismaRaw, {
    tenantId: completed.tenantId,
    actorUserId: session.user.id,
    action: "Capa.completed",
    entityType: "Capa",
    entityId: completed.id,
    metadata: { capaCode: completed.capaCode, title: completed.title, vesselCode: completed.vesselCode },
  });
  return completed;
}

export async function closeCapaRecord(session: TenantAccessSession, id: string, payload: { verificationNote: string }) {
  ensureCanManageCapa(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const current = await getCapaRecord(session, id);
  ensureStatus(current.status, "PENDING_VERIFICATION", "Close");

  return capa.update({
    where: { id: current.id },
    data: {
      status: "CLOSED",
      verificationNote: normalizeRequiredText(payload.verificationNote, "verificationNote"),
      updatedByUserId: session.user.id,
    },
  });
}

export async function reopenCapaRecord(
  session: TenantAccessSession,
  id: string,
  payload: { reason: string },
) {
  assertCanReopen(session.user.role);
  const reason = assertReopenReason(payload?.reason);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const current = await getCapaRecord(session, id);
  if (current.status !== "CLOSED" && current.status !== "CANCELLED" && current.status !== "VERIFIED_EFFECTIVE") {
    throw new RouteError(
      409,
      "INVALID_STATUS_TRANSITION",
      `Solo CAPAs CLOSED, CANCELLED o VERIFIED_EFFECTIVE pueden re-abrirse (actual: ${current.status}).`,
    );
  }

  const now = new Date();
  const reopened = await capa.update({
    where: { id: current.id },
    data: {
      status: "IN_PROGRESS",
      completedAt: null,
      cancelReason: null,
      reopenCount: { increment: 1 },
      lastReopenAt: now,
      lastReopenReason: reason,
      lastReopenByUserId: session.user.id,
      updatedByUserId: session.user.id,
    } as Record<string, unknown>,
  });

  void publishAudit(prismaRaw, {
    tenantId: reopened.tenantId,
    actorUserId: session.user.id,
    action: "Capa.reopened",
    entityType: "Capa",
    entityId: reopened.id,
    metadata: {
      capaCode: reopened.capaCode,
      vesselCode: reopened.vesselCode,
      previousStatus: current.status,
      newStatus: "IN_PROGRESS",
      reason,
    },
  });

  return reopened;
}

export async function cancelCapaRecord(session: TenantAccessSession, id: string, payload: { cancelReason: string }) {
  ensureTenantAdmin(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const capa = capaDelegate(prismaRaw);

  const current = await getCapaRecord(session, id);
  if (current.status === "CLOSED" || current.status === "CANCELLED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `No se puede cancelar desde estado ${current.status}.`);
  }

  return capa.update({
    where: { id: current.id },
    data: {
      status: "CANCELLED",
      cancelReason: normalizeRequiredText(payload.cancelReason, "cancelReason"),
      updatedByUserId: session.user.id,
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// createCapaInternal — helper usado por otros services (defects, inspections)
// para crear CAPAs automáticamente desde sus disparadores. NO valida permisos
// (la operación de origen ya pasó por su propio gate). Anti-duplicado por
// (sourceType, sourceId): si ya existe un CapaRecord activo (no terminal)
// vinculado al mismo origen, devuelve el existente en vez de crear otro.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Cliente Prisma usable como el cliente global o como un tx dentro de una
 * transaction abierta por otro servicio. Necesita `capaRecord` y, para el
 * advisory lock anti-race, `$queryRaw`.
 */
type CapaCreatorPrisma = {
  capaRecord: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; capaCode: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; capaCode: string; title: string; vesselCode: string }>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
  $queryRawUnsafe?: (query: string, ...params: unknown[]) => Promise<unknown>;
};

/**
 * Hash determinístico de un string a un int32 (rango aceptable para
 * pg_advisory_xact_lock). FNV-1a: distribución decente y rápido.
 */
function hashToInt32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  // Postgres pg_advisory_xact_lock(int) acepta int32 signed.
  return h | 0;
}

export interface CapaInternalInput {
  tenantId: string;
  vesselCode: string;
  assetId: string;
  // Debe coincidir con enum CapaSourceType del schema (DEFECT | WORK_ORDER | INSPECTION).
  sourceType: "DEFECT" | "WORK_ORDER" | "INSPECTION";
  sourceId: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description?: string | null;
  /** userId que dispara el origen (ej. el que aprobó el RCA o completó la inspección) */
  actorUserId: string;
}

const TERMINAL_CAPA_STATES = ["CLOSED", "CANCELLED", "VERIFIED_EFFECTIVE"];

const VALID_CAPA_SOURCE_TYPES = new Set(["DEFECT", "WORK_ORDER", "INSPECTION"]);

export async function createCapaInternal(
  prisma: CapaCreatorPrisma,
  input: CapaInternalInput,
): Promise<{ id: string; capaCode: string; alreadyExisted: boolean } | null> {
  // Guard defensivo: validar sourceType ANTES de tocar la DB. Si llega
  // un valor inválido (ej. "RCA" — bug histórico que ya arreglamos pero
  // queda este guard para que no se repita), tiramos error claro en lugar
  // de dejar que Prisma crashee con "Invalid value for argument sourceType".
  if (!VALID_CAPA_SOURCE_TYPES.has(input.sourceType)) {
    throw new RouteError(
      500,
      "CAPA_INVALID_SOURCE_TYPE",
      `sourceType "${input.sourceType}" no es válido. Esperado: DEFECT | WORK_ORDER | INSPECTION.`,
    );
  }

  // Anti-race: si dos requests entran al mismo tiempo (ej. RCA aprobado 2x),
  // el findFirst de ambas devuelve null y ambas crean una CAPA. Para
  // prevenirlo, tomamos un advisory lock de Postgres por (tenantId, sourceType,
  // sourceId). El lock dura la transacción enclosing (o la statement si no
  // hay tx). Si el caller pasó un tx (inspection-executions), el lock vive
  // hasta el commit; si pasó el client global (defects on RCA), el lock vive
  // hasta esta función. Suficiente para serializar el findFirst+create.
  if (prisma.$queryRawUnsafe) {
    const lockKey = hashToInt32(`${input.tenantId}|${input.sourceType}|${input.sourceId}`);
    try {
      await prisma.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
    } catch {
      // Si la DB no soporta advisory locks (test runner, sqlite, etc.), seguimos
      // sin lock — el peor caso es el race que el lock previene.
    }
  }

  // Anti-duplicado: si ya hay una CAPA activa (no terminal) para el mismo
  // (sourceType, sourceId), no creamos otra.
  const existing = await prisma.capaRecord.findFirst({
    where: {
      tenantId:   input.tenantId,
      sourceType: input.sourceType,
      sourceId:   input.sourceId,
      deletedAt:  null,
      status:     { notIn: TERMINAL_CAPA_STATES },
    },
  });
  if (existing) {
    return { id: existing.id, capaCode: existing.capaCode, alreadyExisted: true };
  }

  // Generar capaCode con prefijo + vessel + año + secuencial.
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);

  // Race protection con @@unique(capaCode): si dos requests entran al mismo
  // tiempo, el segundo crash con P2002 y reintentamos con count+1+attempt.
  const created = await withUniqueRetry(async (attempt) => {
    const yearCount = await prisma.capaRecord.count({
      where: {
        tenantId:   input.tenantId,
        vesselCode: input.vesselCode,
        createdAt:  { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) },
      },
    });
    const capaCode = `CAPA-${input.vesselCode}-${yy}-${String(yearCount + 1 + attempt).padStart(4, "0")}`;
    return prisma.capaRecord.create({
      data: {
        tenantId:        input.tenantId,
        vesselCode:      input.vesselCode,
        assetId:         input.assetId,
        sourceType:      input.sourceType,
        sourceId:        input.sourceId,
        capaCode,
        status:          "OPEN",
        priority:        input.priority,
        title:           input.title,
        description:     input.description ?? null,
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
      },
    });
  });
  return { id: created.id, capaCode: created.capaCode, alreadyExisted: false };
}
