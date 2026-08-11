import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface AssignSuperintendentInput {
  userId: string;
  vesselCode: string;
  assignmentType?: "PRIMARY" | "SECONDARY";
}

export interface BulkAssignInput {
  userId: string;
  vesselCodes: string[];
  assignmentType?: "PRIMARY" | "SECONDARY";
  replaceExisting?: boolean;
}

function ensureAdmin(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden gestionar asignaciones de superintendentes.");
  }
}

async function getTenantId(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, slug: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

async function syncVesselCodesOnMembership(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  userId: string,
): Promise<void> {
  const active = await (prisma as any).vesselSuperintendentAssignment.findMany({
    where: { tenantId, userId, isActive: true },
    select: { vesselCode: true },
  });
  const codes: string[] = active.map((a: { vesselCode: string }) => a.vesselCode);
  await (prisma as any).tenantMembership.updateMany({
    where: { tenantId, userId },
    data: { assignedVesselCodes: codes },
  });
}

export async function listSuperintendentAssignments(
  session: TenantAccessSession,
  filters: { userId?: string | null; vesselCode?: string | null; isActive?: boolean | null } = {},
) {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await getTenantId(prisma, session.tenantSlug);
  const where: Record<string, unknown> = { tenantId };
  if (filters.userId) where.userId = filters.userId;
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.isActive !== null && filters.isActive !== undefined) where.isActive = filters.isActive;

  const rows = await (prisma as any).vesselSuperintendentAssignment.findMany({
    where,
    include: {
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
    orderBy: [{ vesselCode: "asc" }, { assignmentType: "asc" }],
  });

  return rows;
}

export async function assignSuperintendent(session: TenantAccessSession, input: AssignSuperintendentInput) {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await getTenantId(prisma, session.tenantSlug);

  // Verify user exists and belongs to this tenant with FLEET_SUPERINTENDENT role
  const membership = await (prisma as any).tenantMembership.findFirst({
    where: { tenantId, userId: input.userId },
  });
  if (!membership) throw new RouteError(404, "USER_NOT_FOUND", "Usuario no pertenece a este tenant.");
  if (membership.role !== "FLEET_SUPERINTENDENT") {
    throw new RouteError(400, "INVALID_ROLE", "Solo usuarios con rol FLEET_SUPERINTENDENT pueden ser asignados como superintendentes.");
  }

  // Verify vessel exists
  const vessel = await (prisma as any).vessel.findFirst({
    where: { tenantId, code: input.vesselCode.toUpperCase(), deletedAt: null },
  });
  if (!vessel) throw new RouteError(404, "VESSEL_NOT_FOUND", "Buque no encontrado.");

  const vesselCode = input.vesselCode.toUpperCase();

  const existing = await (prisma as any).vesselSuperintendentAssignment.findFirst({
    where: { tenantId, vesselCode, userId: input.userId },
  });

  let result: unknown;
  if (existing) {
    result = await (prisma as any).vesselSuperintendentAssignment.update({
      where: { id: existing.id },
      data: {
        assignmentType: input.assignmentType ?? "PRIMARY",
        isActive: true,
        assignedAt: new Date(),
        assignedByUserId: session.user.id,
        deactivatedAt: null,
        deactivatedByUserId: null,
      },
    });
  } else {
    result = await (prisma as any).vesselSuperintendentAssignment.create({
      data: {
        tenantId,
        vesselCode,
        userId: input.userId,
        assignmentType: input.assignmentType ?? "PRIMARY",
        isActive: true,
        assignedByUserId: session.user.id,
      },
    });
  }

  await syncVesselCodesOnMembership(prisma, tenantId, input.userId);
  return result;
}

export async function deactivateSuperintendentAssignment(
  session: TenantAccessSession,
  assignmentId: string,
) {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await getTenantId(prisma, session.tenantSlug);

  const assignment = await (prisma as any).vesselSuperintendentAssignment.findFirst({
    where: { id: assignmentId, tenantId },
  });
  if (!assignment) throw new RouteError(404, "NOT_FOUND", "Asignación no encontrada.");

  const result = await (prisma as any).vesselSuperintendentAssignment.update({
    where: { id: assignmentId },
    data: {
      isActive: false,
      deactivatedAt: new Date(),
      deactivatedByUserId: session.user.id,
    },
  });

  await syncVesselCodesOnMembership(prisma, tenantId, assignment.userId);
  return result;
}

export async function bulkAssignSuperintendent(session: TenantAccessSession, input: BulkAssignInput) {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await getTenantId(prisma, session.tenantSlug);

  const membership = await (prisma as any).tenantMembership.findFirst({
    where: { tenantId, userId: input.userId },
  });
  if (!membership) throw new RouteError(404, "USER_NOT_FOUND", "Usuario no pertenece a este tenant.");
  if (membership.role !== "FLEET_SUPERINTENDENT") {
    throw new RouteError(400, "INVALID_ROLE", "Solo usuarios con rol FLEET_SUPERINTENDENT pueden ser asignados.");
  }

  if (input.replaceExisting) {
    await (prisma as any).vesselSuperintendentAssignment.updateMany({
      where: { tenantId, userId: input.userId, isActive: true },
      data: { isActive: false, deactivatedAt: new Date(), deactivatedByUserId: session.user.id },
    });
  }

  const results = [];
  for (const rawCode of input.vesselCodes) {
    const vesselCode = rawCode.toUpperCase();
    const existing = await (prisma as any).vesselSuperintendentAssignment.findFirst({
      where: { tenantId, vesselCode, userId: input.userId },
    });
    if (existing) {
      results.push(await (prisma as any).vesselSuperintendentAssignment.update({
        where: { id: existing.id },
        data: {
          assignmentType: input.assignmentType ?? "PRIMARY",
          isActive: true,
          assignedAt: new Date(),
          assignedByUserId: session.user.id,
          deactivatedAt: null,
          deactivatedByUserId: null,
        },
      }));
    } else {
      results.push(await (prisma as any).vesselSuperintendentAssignment.create({
        data: {
          tenantId,
          vesselCode,
          userId: input.userId,
          assignmentType: input.assignmentType ?? "PRIMARY",
          isActive: true,
          assignedByUserId: session.user.id,
        },
      }));
    }
  }

  await syncVesselCodesOnMembership(prisma, tenantId, input.userId);
  return { assigned: results.length, vesselCodes: input.vesselCodes.map((c) => c.toUpperCase()) };
}

export async function listPromotableCandidates(session: TenantAccessSession) {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await getTenantId(prisma, session.tenantSlug);

  const memberships = await (prisma as any).tenantMembership.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      role: { not: "FLEET_SUPERINTENDENT" },
    },
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
    orderBy: [{ role: "asc" }],
  });

  return memberships;
}

export async function promoteMemberToSuperintendent(session: TenantAccessSession, userId: string) {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await getTenantId(prisma, session.tenantSlug);

  const membership = await (prisma as any).tenantMembership.findFirst({
    where: { tenantId, userId, status: "ACTIVE" },
  });
  if (!membership) throw new RouteError(404, "USER_NOT_FOUND", "Usuario no encontrado en este tenant.");
  if (membership.role === "FLEET_SUPERINTENDENT") {
    throw new RouteError(400, "ALREADY_SUPERINTENDENT", "El usuario ya es Fleet Superintendent.");
  }

  return (prisma as any).tenantMembership.update({
    where: { id: membership.id },
    data: { role: "FLEET_SUPERINTENDENT" },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
  });
}

export async function demoteSuperintendent(session: TenantAccessSession, userId: string, newRole: string) {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const VALID_ROLES = ["MAINTENANCE_MANAGER", "TECHNICIAN_OPERATOR", "INSPECTOR_COMPLIANCE", "PROCUREMENT_STORE", "HSE_MANAGER", "AUDITOR_READONLY"];
  if (!VALID_ROLES.includes(newRole)) {
    throw new RouteError(400, "INVALID_ROLE", `Rol inválido. Opciones: ${VALID_ROLES.join(", ")}`);
  }

  const tenantId = await getTenantId(prisma, session.tenantSlug);

  const membership = await (prisma as any).tenantMembership.findFirst({
    where: { tenantId, userId, status: "ACTIVE" },
  });
  if (!membership) throw new RouteError(404, "USER_NOT_FOUND", "Usuario no encontrado.");

  // Deactivate all vessel assignments
  await (prisma as any).vesselSuperintendentAssignment.updateMany({
    where: { tenantId, userId, isActive: true },
    data: { isActive: false, deactivatedAt: new Date(), deactivatedByUserId: session.user.id },
  });

  return (prisma as any).tenantMembership.update({
    where: { id: membership.id },
    data: { role: newRole, assignedVesselCodes: [] },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
  });
}

export async function listFleetSuperintendents(session: TenantAccessSession) {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await getTenantId(prisma, session.tenantSlug);

  const memberships = await (prisma as any).tenantMembership.findMany({
    where: { tenantId, role: "FLEET_SUPERINTENDENT", status: "ACTIVE" },
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });

  const userIds: string[] = memberships.map((m: { userId: string }) => m.userId);
  const assignments = await (prisma as any).vesselSuperintendentAssignment.findMany({
    where: { tenantId, userId: { in: userIds }, isActive: true },
    orderBy: [{ vesselCode: "asc" }],
  });

  return memberships.map((m: { userId: string; user: object; assignedVesselCodes: string[] }) => ({
    userId: m.userId,
    user: m.user,
    assignedVesselCodes: m.assignedVesselCodes,
    assignments: assignments.filter((a: { userId: string }) => a.userId === m.userId),
  }));
}
