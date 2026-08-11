import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { getPermitForRelatedWrite } from "./permits-service";

const ROLES = ["PERFORMER", "FIRE_WATCH", "STAND_BY", "ATTENDANT", "SUPERVISOR"] as const;
type Role = typeof ROLES[number];

export interface ParticipantWriteInput {
  crewId?: string | null;
  name?: string;
  role?: string;
}

function canManage(session: TenantAccessSession): boolean {
  return hasPermission(session, "permit.manage");
}

function normalizeRequired(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `${field} es requerido.`);
  return text;
}
function normalizeOptional(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}
function parseRole(value: unknown): Role {
  const v = String(value ?? "").trim().toUpperCase();
  if (!ROLES.includes(v as Role)) throw new RouteError(400, "VALIDATION_ERROR", `role inválido: ${v}.`);
  return v as Role;
}

type ParticipantClient = {
  permitParticipant: {
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<Record<string, unknown>[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    delete(args: { where: { id: string } }): Promise<Record<string, unknown>>;
  };
  crew: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; firstName: string; lastName: string } | null> };
};
function pClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): ParticipantClient {
  return prisma as unknown as ParticipantClient;
}

export async function listParticipants(session: TenantAccessSession, permitId: string) {
  const permit = await getPermitForRelatedWrite(session, permitId);
  const prisma = getPrismaClient();
  if (!prisma) return [];
  return pClient(prisma).permitParticipant.findMany({
    where: { permitId: permit.id, tenantId: permit.tenantId },
    orderBy: { createdAt: "asc" },
  });
}

export async function createParticipant(session: TenantAccessSession, permitId: string, input: ParticipantWriteInput) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado.");

  const permit = await getPermitForRelatedWrite(session, permitId);
  if (["CLOSED", "CANCELLED", "REJECTED"].includes(permit.status)) {
    throw new RouteError(409, "RECORD_LOCKED", `No se pueden agregar participantes a un permiso ${permit.status}.`);
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const role = parseRole(input.role);
  const crewId = normalizeOptional(input.crewId);
  let name = normalizeOptional(input.name);

  // Si vino crewId, derivar el nombre del Crew para snapshot.
  if (crewId) {
    const crew = await pClient(prisma).crew.findFirst({ where: { id: crewId, tenantId: permit.tenantId, deletedAt: null } });
    if (!crew) throw new RouteError(404, "CREW_NOT_FOUND", "Tripulante no encontrado.");
    name = `${crew.firstName} ${crew.lastName}`;
  }
  if (!name) throw new RouteError(400, "VALIDATION_ERROR", "Se requiere crewId o name.");

  const created = await pClient(prisma).permitParticipant.create({
    data: {
      tenantId: permit.tenantId,
      permitId: permit.id,
      crewId,
      name,
      role,
      createdByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: permit.tenantId,
    actorUserId: session.user.id,
    action: "Permit.participantAdded",
    entityType: "Permit",
    entityId: permit.id,
    metadata: { permitCode: permit.permitCode, vesselCode: permit.vesselCode, name, role },
  });

  return created;
}

export async function deleteParticipant(session: TenantAccessSession, permitId: string, participantId: string) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado.");

  const permit = await getPermitForRelatedWrite(session, permitId);
  if (["CLOSED", "CANCELLED", "REJECTED"].includes(permit.status)) {
    throw new RouteError(409, "RECORD_LOCKED", `No se puede borrar un participante de un permiso ${permit.status}.`);
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const existing = await pClient(prisma).permitParticipant.findFirst({
    where: { id: participantId, permitId: permit.id, tenantId: permit.tenantId },
  });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Participante no encontrado.");

  await pClient(prisma).permitParticipant.delete({ where: { id: participantId } });

  void publishAudit(prisma, {
    tenantId: permit.tenantId,
    actorUserId: session.user.id,
    action: "Permit.participantRemoved",
    entityType: "Permit",
    entityId: permit.id,
    metadata: { permitCode: permit.permitCode, vesselCode: permit.vesselCode, participantId },
  });
}
