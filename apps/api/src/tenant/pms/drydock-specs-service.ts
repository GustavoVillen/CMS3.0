// Especificación de Varada (Drydock Spec) — TMSA 4.2.4 y 4.4.2.
//
// Documento formal de trabajos de varada. El buque lo arma en DRAFT (a mano o
// importando del backlog), lo envía a tierra (SUBMITTED), la superintendencia lo
// toma (UNDER_REVIEW), comenta y decide ítem por ítem, y lo aprueba o lo devuelve.
// APPROVED congela el documento: sólo quedan comentarios y PDF.
//
// Patrón: espeja voyage-tank-reports-service.ts (scope tenant+vessel, código
// incremental anual, bloqueo al cerrar) y la máquina de estados de moc-service.ts.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { hasPermission } from "../auth/role-permissions";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { withUniqueRetry } from "../../common/unique-retry";

export const DRYDOCK_SPEC_STATUSES = [
  "DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED",
] as const;
export type DrydockSpecStatus = (typeof DRYDOCK_SPEC_STATUSES)[number];

/** Estados en los que el documento ya no se edita (sólo comentarios y PDF). */
export const FROZEN_STATUSES: readonly string[] = ["APPROVED", "CANCELLED"];

export interface DrydockSpecListFilters {
  vesselCode?: string | null;
  status?: string | null;
}

export interface CreateDrydockSpecInput {
  vesselCode: string;
  title: string;
  shipyardName?: string | null;
  shipyardProviderId?: string | null;
  port?: string | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  scopeSummary?: string | null;
}

export type UpdateDrydockSpecInput = Partial<Omit<CreateDrydockSpecInput, "vesselCode">>;

export interface TransitionDrydockSpecInput {
  status: string;
  rejectedReason?: string | null;
  approvedByName?: string | null;
}

// ─── Permisos ────────────────────────────────────────────────────────────────
// Armar la spec la puede cualquier rol operativo: el buque es quien la carga
// (incluye TECHNICIAN_OPERATOR). Aprobar/rechazar exige el permiso configurable.

export function canManageDrydock(s: TenantAccessSession): boolean {
  return s.user.role !== "AUDITOR_READONLY";
}

export function canApproveDrydock(s: TenantAccessSession): boolean {
  return hasPermission(s, "drydock.approve");
}

export function ensureCanManageDrydock(s: TenantAccessSession) {
  if (!canManageDrydock(s)) {
    throw new RouteError(403, "FORBIDDEN", "Solo-lectura no puede editar especificaciones de varada.");
  }
}

export function ensureCanApproveDrydock(s: TenantAccessSession) {
  if (!canApproveDrydock(s)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para aprobar o rechazar la especificacion de varada.");
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normReq(v: unknown, field: string): string {
  const t = String(v ?? "").trim();
  if (!t) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return t;
}

function normOpt(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t || null;
}

function parseOptDate(v: unknown, field: string): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha invalida en ${field}.`);
  return d;
}

function requirePrisma() {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  return prisma;
}

async function getTenantIdOrThrow(session: TenantAccessSession): Promise<string> {
  const prisma = requirePrisma();
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

/**
 * Carga la spec aplicando tenant + vessel scope. Es el único punto de acceso a
 * un registro por id: cualquier ruta que reciba un :id pasa por acá.
 */
export async function loadScopedSpec(session: TenantAccessSession, id: string) {
  const prisma = requirePrisma();
  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyAssignedVesselScope(session, where);
  const spec = await prisma.drydockSpec.findFirst({ where });
  if (!spec) throw new RouteError(404, "NOT_FOUND", "Especificacion de varada no encontrada.");
  return spec;
}

/** Lanza si el documento está congelado (aprobado o cancelado). */
export function ensureEditable(spec: { status: string }) {
  if (FROZEN_STATUSES.includes(spec.status)) {
    throw new RouteError(409, "SPEC_FROZEN", "La especificacion esta cerrada: no admite cambios.");
  }
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

export async function listDrydockSpecs(session: TenantAccessSession, filters: DrydockSpecListFilters = {}) {
  const prisma = requirePrisma();
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;

  const specs = await prisma.drydockSpec.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { _count: { select: { items: true } } },
  });

  // Contadores por documento: cuántas líneas aceptó tierra y cuántas salieron
  // del backlog (es la evidencia TMSA 4.4.2).
  const specIds = specs.map(s => s.id);
  const grouped = specIds.length > 0
    ? await prisma.drydockSpecItem.groupBy({
        by: ["specId", "itemStatus"],
        where: { specId: { in: specIds } },
        _count: { _all: true },
      })
    : [];
  const acceptedBySpec = new Map<string, number>();
  for (const row of grouped) {
    if (row.itemStatus === "ACCEPTED") acceptedBySpec.set(row.specId, row._count._all);
  }

  return specs.map(s => ({
    ...s,
    itemCount: s._count.items,
    acceptedCount: acceptedBySpec.get(s.id) ?? 0,
  }));
}

/** Cabecera + ítems + comentarios: es lo que consume el modal de detalle. */
export async function getDrydockSpecFull(session: TenantAccessSession, id: string) {
  const prisma = requirePrisma();
  const spec = await loadScopedSpec(session, id);

  const items = await prisma.drydockSpecItem.findMany({
    where: { specId: spec.id },
    orderBy: { itemNo: "asc" },
    include: { comments: { orderBy: { createdAt: "asc" } } },
  });

  // Nombre del equipo asociado (mostrar nombres, nunca ids ni códigos sueltos).
  const assetIds = [...new Set(items.map(i => i.assetId).filter((v): v is string => !!v))];
  const assets = assetIds.length > 0
    ? await prisma.asset.findMany({
        where: { id: { in: assetIds }, tenantId: spec.tenantId },
        select: { id: true, name: true, assetCode: true },
      })
    : [];
  const assetMap = new Map(assets.map(a => [a.id, a]));

  const vessel = await prisma.vessel.findFirst({
    where: { tenantId: spec.tenantId, code: spec.vesselCode },
    select: { name: true },
  });

  return {
    ...spec,
    vesselName: vessel?.name ?? spec.vesselCode,
    items: items.map(i => ({
      ...i,
      assetName: i.assetId ? assetMap.get(i.assetId)?.name ?? null : null,
      assetCode: i.assetId ? assetMap.get(i.assetId)?.assetCode ?? null : null,
    })),
  };
}

// ─── Escritura ───────────────────────────────────────────────────────────────

export async function createDrydockSpec(session: TenantAccessSession, input: CreateDrydockSpecInput) {
  ensureCanManageDrydock(session);
  const prisma = requirePrisma();
  const tenantId = await getTenantIdOrThrow(session);

  const vesselCode = normReq(input.vesselCode, "vesselCode");
  // Vessel scope estricto en la creación: no se crea para un buque ajeno.
  const scopeCheck: Record<string, unknown> = {};
  applyAssignedVesselScope(session, scopeCheck, vesselCode);
  if (scopeCheck.vesselCode !== vesselCode) {
    throw new RouteError(403, "FORBIDDEN", "Buque fuera del alcance asignado.");
  }
  const vessel = await prisma.vessel.findFirst({ where: { tenantId, code: vesselCode, deletedAt: null } });
  if (!vessel) throw new RouteError(404, "VESSEL_NOT_FOUND", "Buque no encontrado.");

  const title = normReq(input.title, "title");
  const plannedStartDate = parseOptDate(input.plannedStartDate, "plannedStartDate");
  const plannedEndDate = parseOptDate(input.plannedEndDate, "plannedEndDate");
  if (plannedStartDate && plannedEndDate && plannedEndDate < plannedStartDate) {
    throw new RouteError(400, "VALIDATION_ERROR", "La fecha de fin no puede ser anterior a la de inicio.");
  }

  const yy = String(new Date().getFullYear()).slice(-2);
  const created = await withUniqueRetry(async (attempt) => {
    const count = await prisma.drydockSpec.count({ where: { tenantId, vesselCode } });
    const next = count + 1 + attempt;
    const specCode = `VAR-${vesselCode}-${yy}-${String(next).padStart(4, "0")}`;
    return prisma.drydockSpec.create({
      data: {
        tenantId,
        vesselCode,
        specCode,
        title,
        status: "DRAFT",
        shipyardName: normOpt(input.shipyardName),
        shipyardProviderId: normOpt(input.shipyardProviderId),
        port: normOpt(input.port),
        plannedStartDate,
        plannedEndDate,
        scopeSummary: normOpt(input.scopeSummary),
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
      },
    });
  });

  void publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "DrydockSpec.created",
    entityType: "DrydockSpec",
    entityId: created.id,
    metadata: { specCode: created.specCode, vesselCode },
  });

  return created;
}

export async function updateDrydockSpec(session: TenantAccessSession, id: string, input: UpdateDrydockSpecInput) {
  ensureCanManageDrydock(session);
  const prisma = requirePrisma();
  const spec = await loadScopedSpec(session, id);
  ensureEditable(spec);

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.title !== undefined) data.title = normReq(input.title, "title");
  if (input.shipyardName !== undefined) data.shipyardName = normOpt(input.shipyardName);
  if (input.shipyardProviderId !== undefined) data.shipyardProviderId = normOpt(input.shipyardProviderId);
  if (input.port !== undefined) data.port = normOpt(input.port);
  if (input.scopeSummary !== undefined) data.scopeSummary = normOpt(input.scopeSummary);
  if (input.plannedStartDate !== undefined) data.plannedStartDate = parseOptDate(input.plannedStartDate, "plannedStartDate");
  if (input.plannedEndDate !== undefined) data.plannedEndDate = parseOptDate(input.plannedEndDate, "plannedEndDate");

  const start = (data.plannedStartDate as Date | null | undefined) ?? spec.plannedStartDate;
  const end = (data.plannedEndDate as Date | null | undefined) ?? spec.plannedEndDate;
  if (start && end && end < start) {
    throw new RouteError(400, "VALIDATION_ERROR", "La fecha de fin no puede ser anterior a la de inicio.");
  }

  return prisma.drydockSpec.update({ where: { id: spec.id }, data });
}

export async function deleteDrydockSpec(session: TenantAccessSession, id: string) {
  ensureCanManageDrydock(session);
  const prisma = requirePrisma();
  const spec = await loadScopedSpec(session, id);
  if (spec.status !== "DRAFT") {
    throw new RouteError(409, "INVALID_STATE", "Solo se puede eliminar una especificacion en borrador.");
  }

  const deleted = await prisma.drydockSpec.update({
    where: { id: spec.id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });

  void publishAudit(prisma, {
    tenantId: spec.tenantId,
    actorUserId: session.user.id,
    action: "DrydockSpec.deleted",
    entityType: "DrydockSpec",
    entityId: spec.id,
    metadata: { specCode: spec.specCode, vesselCode: spec.vesselCode },
  });

  return deleted;
}

// ─── Máquina de estados ──────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT:        ["SUBMITTED", "CANCELLED"],
  SUBMITTED:    ["UNDER_REVIEW", "DRAFT", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED:     [],
  REJECTED:     ["DRAFT"],
  CANCELLED:    [],
};

export async function transitionDrydockSpec(
  session: TenantAccessSession,
  id: string,
  input: TransitionDrydockSpecInput,
) {
  const prisma = requirePrisma();
  const spec = await loadScopedSpec(session, id);

  const next = String(input.status ?? "").trim().toUpperCase();
  if (!(DRYDOCK_SPEC_STATUSES as readonly string[]).includes(next)) {
    throw new RouteError(400, "VALIDATION_ERROR", `Estado invalido: ${next}.`);
  }
  const allowed = VALID_TRANSITIONS[spec.status] ?? [];
  if (!allowed.includes(next)) {
    throw new RouteError(409, "INVALID_TRANSITION", `${spec.status} → ${next} no permitido.`);
  }

  // Aprobar y rechazar son decisiones de tierra; el resto lo mueve el operativo.
  if (next === "APPROVED" || next === "REJECTED") ensureCanApproveDrydock(session);
  else ensureCanManageDrydock(session);

  // No se manda a tierra un documento vacío.
  if (next === "SUBMITTED") {
    const itemCount = await prisma.drydockSpecItem.count({ where: { specId: spec.id } });
    if (itemCount === 0) {
      throw new RouteError(400, "VALIDATION_ERROR", "La especificacion no tiene items para enviar.");
    }
  }
  // Aprobar sin ninguna línea aceptada no describe ninguna varada.
  if (next === "APPROVED") {
    const accepted = await prisma.drydockSpecItem.count({ where: { specId: spec.id, itemStatus: "ACCEPTED" } });
    if (accepted === 0) {
      throw new RouteError(400, "VALIDATION_ERROR", "No hay items aceptados: la especificacion no se puede aprobar.");
    }
  }

  const now = new Date();
  // El PDF va al astillero: se firma con el nombre de la persona, no con su
  // dirección de correo interna. El mail queda sólo como último recurso.
  const signerName = [session.user.firstName, session.user.lastName]
    .filter(Boolean).join(" ").trim() || session.user.email;

  const data: Record<string, unknown> = { status: next, updatedByUserId: session.user.id };
  if (next === "SUBMITTED") {
    data.submittedAt = now;
    data.submittedByUserId = session.user.id;
    data.submittedByName = signerName;
  }
  if (next === "UNDER_REVIEW") data.reviewStartedAt = now;
  if (next === "APPROVED") {
    data.approvedAt = now;
    data.approvedByUserId = session.user.id;
    data.approvedByName = normOpt(input.approvedByName) ?? signerName;
  }
  if (next === "REJECTED") {
    data.rejectedAt = now;
    data.rejectedReason = normReq(input.rejectedReason, "rejectedReason");
  }
  // Devolver a borrador limpia la decisión anterior: el ciclo vuelve a empezar.
  if (next === "DRAFT") {
    data.submittedAt = null;
    data.submittedByUserId = null;
    data.submittedByName = null;
    data.reviewStartedAt = null;
    data.rejectedAt = null;
    data.rejectedReason = null;
  }

  const updated = await prisma.drydockSpec.update({ where: { id: spec.id }, data });

  void publishAudit(prisma, {
    tenantId: spec.tenantId,
    actorUserId: session.user.id,
    action: `DrydockSpec.${next.toLowerCase()}`,
    entityType: "DrydockSpec",
    entityId: spec.id,
    metadata: {
      specCode: spec.specCode,
      vesselCode: spec.vesselCode,
      previousStatus: spec.status,
      newStatus: next,
    },
  });

  return updated;
}
