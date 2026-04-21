import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { streamCopilotoChat } from "../copiloto/copiloto-service";
import { publishAudit } from "../../platform/audit/audit-publisher";

export interface RcaListFilters {
  vesselCode?: string | null;
  status?: string | null;
  methodology?: string | null;
  defectId?: string | null;
}

export interface CreateRcaRecordInput {
  vesselCode: string;
  assetId: string;
  defectId?: string | null;
  workOrderId?: string | null;
  methodology: "FIVE_WHYS" | "FISHBONE" | "FTA" | "BARRIER_ANALYSIS";
  analysisSummary?: string | null;
  immediateCause?: string | null;
  contributingCause?: string | null;
  rootCause?: string | null;
  correctiveActions?: string | null;
  preventiveActions?: string | null;
}

export interface UpdateRcaRecordInput {
  vesselCode?: string;
  assetId?: string;
  defectId?: string | null;
  workOrderId?: string | null;
  methodology?: "FIVE_WHYS" | "FISHBONE" | "FTA" | "BARRIER_ANALYSIS";
  analysisSummary?: string | null;
  immediateCause?: string | null;
  contributingCause?: string | null;
  rootCause?: string | null;
  correctiveActions?: string | null;
  preventiveActions?: string | null;
}

export interface RcaAiAssistInput {
  analysisSummary?: string | null;
  immediateCause?: string | null;
  contributingCause?: string | null;
  rootCause?: string | null;
  correctiveActions?: string | null;
  preventiveActions?: string | null;
}

export interface RcaAiAssistResponse {
  immediateCause?: string;
  contributingCause?: string;
  rootCause?: string;
  correctiveActions?: string;
  preventiveActions?: string;
  analysisSummary?: string;
  assistantNote?: string;
}

interface RcaRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  defectId: string | null;
  workOrderId: string | null;
  rcaCode: string;
  status: string;
  methodology: string;
  analysisSummary: string | null;
  immediateCause: string | null;
  contributingCause: string | null;
  rootCause: string | null;
  correctiveActions: string | null;
  preventiveActions: string | null;
  completedAt: Date | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  closedAt: Date | null;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
}

type RcaDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<RcaRecord[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<RcaRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<RcaRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<RcaRecord>;
};

interface RcaPrismaClient {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  rcaRecord: RcaDelegate;
}

function rcaDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): RcaDelegate {
  return (prisma as unknown as { rcaRecord: RcaDelegate }).rcaRecord;
}

function rcaClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): RcaPrismaClient {
  return prisma as unknown as RcaPrismaClient;
}

function ensureCanManageRca(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "FLEET_SUPERINTENDENT" && session.user.role !== "MAINTENANCE_MANAGER") {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar RCA.");
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

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = rcaClient(prismaRaw);
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

function toNullableTrimmed(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function parseAiAssistJson(text: string): RcaAiAssistResponse | null {
  const raw = text.trim();
  if (!raw) return null;

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || raw;
  const firstObjStart = candidate.indexOf("{");
  const lastObjEnd = candidate.lastIndexOf("}");
  const jsonSlice = firstObjStart >= 0 && lastObjEnd > firstObjStart
    ? candidate.slice(firstObjStart, lastObjEnd + 1)
    : candidate;

  try {
    const parsed = JSON.parse(jsonSlice) as Record<string, unknown>;
    const response: RcaAiAssistResponse = {};
    if (toNullableTrimmed(parsed.immediateCause)) response.immediateCause = toNullableTrimmed(parsed.immediateCause) ?? undefined;
    if (toNullableTrimmed(parsed.contributingCause)) response.contributingCause = toNullableTrimmed(parsed.contributingCause) ?? undefined;
    if (toNullableTrimmed(parsed.rootCause)) response.rootCause = toNullableTrimmed(parsed.rootCause) ?? undefined;
    if (toNullableTrimmed(parsed.correctiveActions)) response.correctiveActions = toNullableTrimmed(parsed.correctiveActions) ?? undefined;
    if (toNullableTrimmed(parsed.preventiveActions)) response.preventiveActions = toNullableTrimmed(parsed.preventiveActions) ?? undefined;
    if (toNullableTrimmed(parsed.analysisSummary)) response.analysisSummary = toNullableTrimmed(parsed.analysisSummary) ?? undefined;
    if (toNullableTrimmed(parsed.assistantNote)) response.assistantNote = toNullableTrimmed(parsed.assistantNote) ?? undefined;
    return response;
  } catch {
    return {
      assistantNote: raw,
    };
  }
}

export async function listRcaRecords(session: TenantAccessSession, filters: RcaListFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return [];
  const rca = rcaDelegate(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.methodology) where.methodology = filters.methodology;
  if (filters.defectId) where.defectId = filters.defectId;

  const records = await rca.findMany({ where, orderBy: { createdAt: "desc" } });
  const assetIds = [...new Set(records.map(r => r.assetId).filter(Boolean))];
  const assetRows = assetIds.length > 0
    ? await (prismaRaw as unknown as { asset: { findMany(a: unknown): Promise<{ id: string; name: string | null }[]> } }).asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, name: true } })
    : [];
  const assetNameMap = new Map(assetRows.map(a => [a.id, a.name ?? null]));
  return records.map(r => ({ ...r, assetName: assetNameMap.get(r.assetId) ?? null }));
}

export async function getRcaRecord(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const rca = rcaDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await rca.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "RCA no encontrado.");
  return record;
}

export async function createRcaRecord(session: TenantAccessSession, payload: CreateRcaRecordInput) {
  ensureCanManageRca(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const rca = rcaDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);

  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const rcaCount = await rca.count({ where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
  const rcaCode = `RCA-${vesselCode}-${yy}-${String(rcaCount + 1).padStart(4, "0")}`;
  const created = await rca.create({
    data: {
      tenantId,
      vesselCode,
      assetId: normalizeRequiredText(payload.assetId, "assetId"),
      defectId: normalizeOptionalText(payload.defectId),
      workOrderId: normalizeOptionalText(payload.workOrderId),
      rcaCode,
      status: "DRAFT",
      methodology: payload.methodology,
      analysisSummary: normalizeOptionalText(payload.analysisSummary),
      immediateCause: normalizeOptionalText(payload.immediateCause),
      contributingCause: normalizeOptionalText(payload.contributingCause),
      rootCause: normalizeOptionalText(payload.rootCause),
      correctiveActions: normalizeOptionalText(payload.correctiveActions),
      preventiveActions: normalizeOptionalText(payload.preventiveActions),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prismaRaw, {
    tenantId,
    actorUserId: session.user.id,
    action: "Rca.created",
    entityType: "Rca",
    entityId: created.id,
    metadata: { rcaCode: created.rcaCode, vesselCode: created.vesselCode },
  });
  return created;
}

export async function updateRcaRecord(session: TenantAccessSession, id: string, payload: UpdateRcaRecordInput) {
  ensureCanManageRca(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const rca = rcaDelegate(prismaRaw);

  const current = await getRcaRecord(session, id);
  if (current.status === "CLOSED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", "No se puede editar un RCA cerrado.");
  }
  if (payload.vesselCode !== undefined) {
    const requested = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
    if (requested !== current.vesselCode) {
      throw new RouteError(400, "VESSEL_IMMUTABLE", "No se permite cambiar vesselCode.");
    }
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.assetId !== undefined) data.assetId = normalizeRequiredText(payload.assetId, "assetId");
  if (payload.defectId !== undefined) data.defectId = normalizeOptionalText(payload.defectId);
  if (payload.workOrderId !== undefined) data.workOrderId = normalizeOptionalText(payload.workOrderId);
  if (payload.methodology !== undefined) data.methodology = payload.methodology;
  if (payload.analysisSummary !== undefined) data.analysisSummary = normalizeOptionalText(payload.analysisSummary);
  if (payload.immediateCause !== undefined) data.immediateCause = normalizeOptionalText(payload.immediateCause);
  if (payload.contributingCause !== undefined) data.contributingCause = normalizeOptionalText(payload.contributingCause);
  if (payload.rootCause !== undefined) data.rootCause = normalizeOptionalText(payload.rootCause);
  if (payload.correctiveActions !== undefined) data.correctiveActions = normalizeOptionalText(payload.correctiveActions);
  if (payload.preventiveActions !== undefined) data.preventiveActions = normalizeOptionalText(payload.preventiveActions);

  const updated = await rca.update({ where: { id: current.id }, data });
  void publishAudit(prismaRaw, {
    tenantId: updated.tenantId,
    actorUserId: session.user.id,
    action: "Rca.updated",
    entityType: "Rca",
    entityId: updated.id,
    metadata: { rcaCode: updated.rcaCode, vesselCode: updated.vesselCode },
  });
  return updated;
}

export async function completeRca(
  session: TenantAccessSession,
  id: string,
  payload: { rootCause: string; correctiveActions: string; preventiveActions: string; analysisSummary?: string },
) {
  ensureCanManageRca(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const rca = rcaDelegate(prismaRaw);

  const current = await getRcaRecord(session, id);
  ensureStatus(current.status, "UNDER_ANALYSIS", "Complete");

  const rootCause = normalizeRequiredText(payload.rootCause, "rootCause");
  return rca.update({
    where: { id: current.id },
    data: {
      status: "COMPLETED",
      rootCause,
      correctiveActions: normalizeRequiredText(payload.correctiveActions, "correctiveActions"),
      preventiveActions: normalizeRequiredText(payload.preventiveActions, "preventiveActions"),
      analysisSummary: normalizeOptionalText(payload.analysisSummary),
      completedAt: new Date(),
      updatedByUserId: session.user.id,
    },
  });
}

export async function approveRca(session: TenantAccessSession, id: string) {
  ensureTenantAdmin(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const rca = rcaDelegate(prismaRaw);

  const current = await getRcaRecord(session, id);
  ensureStatus(current.status, "COMPLETED", "Approve");

  return rca.update({
    where: { id: current.id },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
}

export async function closeRca(session: TenantAccessSession, id: string) {
  ensureTenantAdmin(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const rca = rcaDelegate(prismaRaw);

  const current = await getRcaRecord(session, id);
  ensureStatus(current.status, "APPROVED", "Close");

  const closed = await rca.update({
    where: { id: current.id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prismaRaw, {
    tenantId: closed.tenantId,
    actorUserId: session.user.id,
    action: "Rca.closed",
    entityType: "Rca",
    entityId: closed.id,
    metadata: { rcaCode: closed.rcaCode, vesselCode: closed.vesselCode },
  });
  return closed;
}

export async function generateRcaAssistance(
  session: TenantAccessSession,
  id: string,
  payload: RcaAiAssistInput = {},
): Promise<RcaAiAssistResponse> {
  ensureCanManageRca(session);

  const record = await getRcaRecord(session, id);
  const tenantId = await getTenantIdOrThrow(session);

  const currentContext = {
    rcaCode: record.rcaCode,
    status: record.status,
    methodology: record.methodology,
    vesselCode: record.vesselCode,
    assetId: record.assetId,
    defectId: record.defectId,
    workOrderId: record.workOrderId,
    analysisSummary: toNullableTrimmed(payload.analysisSummary) ?? record.analysisSummary,
    immediateCause: toNullableTrimmed(payload.immediateCause) ?? record.immediateCause,
    contributingCause: toNullableTrimmed(payload.contributingCause) ?? record.contributingCause,
    rootCause: toNullableTrimmed(payload.rootCause) ?? record.rootCause,
    correctiveActions: toNullableTrimmed(payload.correctiveActions) ?? record.correctiveActions,
    preventiveActions: toNullableTrimmed(payload.preventiveActions) ?? record.preventiveActions,
  };

  const userPrompt = [
    "Actua como experto en RCA naval y completa/sugiere estos campos con enfoque practico y verificable:",
    "- immediateCause",
    "- contributingCause",
    "- rootCause",
    "- correctiveActions",
    "- preventiveActions",
    "- analysisSummary (opcional)",
    "",
    "Responde SOLO en JSON valido con esas claves y assistantNote.",
    "Contexto RCA:",
    JSON.stringify(currentContext, null, 2),
  ].join("\n");

  let output = "";
  await streamCopilotoChat(
    {
      capability: "rca_assistant",
      locale: session.user.locale,
      messages: [{ role: "user", content: userPrompt }],
      vesselCode: record.vesselCode,
      tenantId,
      tenantSlug: session.tenantSlug,
    },
    (chunk) => {
      output += chunk;
    },
  );

  const parsed = parseAiAssistJson(output);
  if (!parsed) {
    throw new RouteError(502, "AI_INVALID_RESPONSE", "No se pudo interpretar la respuesta del asistente IA.");
  }
  return parsed;
}
