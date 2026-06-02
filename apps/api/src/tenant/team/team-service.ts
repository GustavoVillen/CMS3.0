import { randomBytes } from "node:crypto";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { hashOpaqueToken } from "../../platform/auth/passwords";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import {
  listDevInvitations,
  createDevInvitation,
} from "../../platform/data/dev-invitation-store";
import type { DevTenantUserRecord } from "../../platform/data/dev-tenant-user-store";

const VALID_ROLES = [
  "TENANT_ADMIN",
  "FLEET_SUPERINTENDENT",
  "MAINTENANCE_MANAGER",
  "TECHNICIAN_OPERATOR",
  "INSPECTOR_COMPLIANCE",
  "PROCUREMENT_STORE",
  "AUDITOR_READONLY",
] as const;

type TenantRole = typeof VALID_ROLES[number];

function ensureAdmin(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden gestionar miembros del equipo.");
  }
}

async function getTenantId(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, slug: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

// ─── List Members ─────────────────────────────────────────────────────────────

export async function listTeamMembers(session: TenantAccessSession) {
  ensureAdmin(session);
  const prisma = getPrismaClient();

  if (!prisma) {
    // Dev mode: read from in-memory store
    const { listDevTenantUsers } = await import("../../platform/data/dev-tenant-user-store");
    const users: DevTenantUserRecord[] = listDevTenantUsers({ tenantSlug: session.tenantSlug });
    return users.map(u => ({
      userId: u.id,
      email: u.email,
      legacyUserId: u.legacyUserId,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      status: u.membershipStatus,
      assignedVesselCodes: u.assignedVesselCodes,
      joinedAt: u.createdAt,
    }));
  }

  const tenantId = await getTenantId(prisma, session.tenantSlug);
  const memberships = await (prisma as any).tenantMembership.findMany({
    where: { tenantId },
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  const memberships2 = await (prisma as any).tenantMembership.findMany({
    where: { tenantId },
    include: {
      user: { select: { id: true, email: true, legacyUserId: true, firstName: true, lastName: true, status: true } },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  return memberships2.map((m: any) => ({
    userId: m.userId,
    email: m.user.email,
    legacyUserId: m.user.legacyUserId,
    firstName: m.user.firstName,
    lastName: m.user.lastName,
    role: m.role,
    status: m.status,
    assignedVesselCodes: m.assignedVesselCodes,
    joinedAt: m.joinedAt ?? m.createdAt,
  }));
}

// ─── Create Invitation ────────────────────────────────────────────────────────

export interface CreateInvitationInput {
  email: string;
  role: TenantRole;
}

export async function createTeamInvitation(session: TenantAccessSession, input: CreateInvitationInput) {
  ensureAdmin(session);

  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new RouteError(400, "INVALID_EMAIL", "Email inválido.");
  }
  if (!VALID_ROLES.includes(input.role)) {
    throw new RouteError(400, "INVALID_ROLE", "Rol inválido.");
  }

  const prisma = getPrismaClient();

  if (!prisma) {
    // Dev mode
    try {
      const record = createDevInvitation({
        tenantSlug: session.tenantSlug,
        email,
        role: input.role,
        locale: "es",
      });
      return { token: record.token, email, role: input.role, expiresAt: record.expiresAt };
    } catch (err: any) {
      if (err?.message === "INVITATION_ALREADY_EXISTS") {
        throw new RouteError(409, "INVITATION_EXISTS", "Ya existe una invitación activa para ese email.");
      }
      throw err;
    }
  }

  const tenantId = await getTenantId(prisma, session.tenantSlug);

  // Check user doesn't already belong to the tenant
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const membership = await (prisma as any).tenantMembership.findFirst({
      where: { tenantId, userId: existing.id, status: { not: "REVOKED" } },
    });
    if (membership) {
      throw new RouteError(409, "USER_ALREADY_MEMBER", "El usuario ya es miembro de este tenant.");
    }
  }

  // Check for pending invitation
  const pending = await prisma.userInvitation.findFirst({
    where: {
      tenantId,
      email,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (pending) {
    throw new RouteError(409, "INVITATION_EXISTS", "Ya existe una invitación activa para ese email.");
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashOpaqueToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.userInvitation.create({
    data: {
      tenantId,
      email,
      role: input.role,
      tokenHash,
      expiresAt,
    },
  });

  return { token: rawToken, email, role: input.role, expiresAt: expiresAt.toISOString() };
}

// ─── Update Member Role ───────────────────────────────────────────────────────

export async function updateMemberRole(session: TenantAccessSession, userId: string, role: string) {
  ensureAdmin(session);

  if (!VALID_ROLES.includes(role as TenantRole)) {
    throw new RouteError(400, "INVALID_ROLE", `Rol inválido.`);
  }
  if (userId === session.user.id) {
    throw new RouteError(400, "CANNOT_CHANGE_OWN_ROLE", "No podés cambiar tu propio rol.");
  }

  const prisma = getPrismaClient();

  if (!prisma) {
    const { updateDevTenantUser, getDevTenantUserById } = await import("../../platform/data/dev-tenant-user-store");
    const user = getDevTenantUserById(userId);
    if (!user || user.tenantSlug !== session.tenantSlug) {
      throw new RouteError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
    }
    updateDevTenantUser(userId, { role: role as TenantRole });
    return { userId, role };
  }

  const tenantId = await getTenantId(prisma, session.tenantSlug);
  const membership = await (prisma as any).tenantMembership.findFirst({
    where: { tenantId, userId, status: { not: "REVOKED" } },
  });
  if (!membership) throw new RouteError(404, "USER_NOT_FOUND", "Miembro no encontrado.");

  // Validar TECHNICIAN_OPERATOR sin vessels asignados → bloquear el cambio.
  if (role === "TECHNICIAN_OPERATOR" && (membership.assignedVesselCodes ?? []).length === 0) {
    throw new RouteError(
      400,
      "TECHNICIAN_REQUIRES_VESSEL",
      "Asigná al menos una embarcación antes de marcar al usuario como Técnico/Operador.",
    );
  }

  // If demoting from FLEET_SUPERINTENDENT, deactivate vessel assignments
  if (membership.role === "FLEET_SUPERINTENDENT" && role !== "FLEET_SUPERINTENDENT") {
    await (prisma as any).vesselSuperintendentAssignment.updateMany({
      where: { tenantId, userId, isActive: true },
      data: { isActive: false, deactivatedAt: new Date(), deactivatedByUserId: session.user.id },
    });
  }

  // Preservar assignedVesselCodes en el cambio de rol — antes los reseteaba a []
  // salvo para FLEET_SUPERINTENDENT, lo que dejaba a los técnicos sin scope y veían
  // datos vacíos por el fail-closed. Ahora se mantienen y el admin los ajusta aparte.
  await (prisma as any).tenantMembership.update({
    where: { id: membership.id },
    data: { role },
  });

  return { userId, role };
}

// ─── Deactivate Member ────────────────────────────────────────────────────────

export async function deleteMember(session: TenantAccessSession, userId: string) {
  ensureAdmin(session);

  if (userId === session.user.id) {
    throw new RouteError(400, "CANNOT_DELETE_SELF", "No podés eliminarte a vos mismo.");
  }

  const prisma = getPrismaClient();

  if (!prisma) {
    const { deleteDevTenantUser, getDevTenantUserById } = await import("../../platform/data/dev-tenant-user-store");
    const user = getDevTenantUserById(userId);
    if (!user || user.tenantSlug !== session.tenantSlug) {
      throw new RouteError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
    }
    deleteDevTenantUser(userId);
    return { userId, deleted: true };
  }

  const tenantId = await getTenantId(prisma, session.tenantSlug);
  const membership = await (prisma as any).tenantMembership.findFirst({
    where: { tenantId, userId },
  });
  if (!membership) throw new RouteError(404, "USER_NOT_FOUND", "Miembro no encontrado.");

  await (prisma as any).vesselSuperintendentAssignment.updateMany({
    where: { tenantId, userId, isActive: true },
    data: { isActive: false, deactivatedAt: new Date(), deactivatedByUserId: session.user.id },
  });

  await (prisma as any).tenantMembership.delete({ where: { id: membership.id } });

  // Si el User no tiene otras memberships activas, liberar su legacyUserId/email
  // para que un admin pueda recrear con el mismo USER. Preservamos el User para
  // mantener referencias históricas en audit logs.
  const remainingMemberships = await (prisma as any).tenantMembership.count({ where: { userId } });
  if (remainingMemberships === 0) {
    const stamp = Date.now();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          legacyUserId: user.legacyUserId ? `__deleted__${stamp}__${user.legacyUserId}` : null,
          email: `__deleted__${stamp}__${user.email}`,
          status: "DISABLED",
        },
      });
    }
  }

  return { userId, deleted: true };
}

// ─── Create Direct Member (no invitation, no login) ──────────────────────────

export interface CreateDirectMemberInput {
  firstName: string;
  lastName?: string;
  email?: string;
  role: TenantRole;
}

export async function createDirectMember(session: TenantAccessSession, input: CreateDirectMemberInput) {
  ensureAdmin(session);

  if (!input.firstName?.trim()) {
    throw new RouteError(400, "NAME_REQUIRED", "El nombre es requerido.");
  }
  if (!VALID_ROLES.includes(input.role)) {
    throw new RouteError(400, "INVALID_ROLE", "Rol inválido.");
  }

  const prisma = getPrismaClient();
  const now = new Date().toISOString();

  if (!prisma) {
    const {
      listDevTenantUsers,
      createDevTenantUser,
      updateDevTenantUser,
      getDevTenantUserByEmail,
      getDevTenantUserByLegacyId,
    } = await import("../../platform/data/dev-tenant-user-store");
    const internalEmail = input.email?.trim().toLowerCase()
      || `named-${Date.now()}@internal.${session.tenantSlug}.local`;

    const cleanUsername = input.firstName.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "");

    // Mismo flujo que en Prisma mode: reusar user existente, reactivar si está
    // REVOKED, rechazar si ya es miembro activo.
    const existingByUsername = getDevTenantUserByLegacyId(cleanUsername);
    if (input.email) {
      const existingByEmail = getDevTenantUserByEmail(internalEmail);
      if (existingByEmail && existingByEmail.id !== existingByUsername?.id) {
        throw new RouteError(409, "EMAIL_TAKEN", `El email "${internalEmail}" pertenece a otro usuario.`);
      }
    }

    if (existingByUsername) {
      if (existingByUsername.tenantSlug === session.tenantSlug) {
        if (existingByUsername.membershipStatus === "ACTIVE") {
          throw new RouteError(409, "ALREADY_MEMBER", `"${cleanUsername}" ya es miembro activo de este tenant.`);
        }
        const updated = updateDevTenantUser(existingByUsername.id, {
          role: input.role,
          membershipStatus: "ACTIVE",
          userStatus: "ACTIVE",
        });
        if (!updated) throw new RouteError(500, "REACTIVATE_FAILED", "No se pudo reactivar al miembro.");
        return {
          userId: updated.id,
          email: updated.email,
          firstName: updated.firstName,
          lastName: updated.lastName,
          role: updated.role,
          status: updated.membershipStatus,
          assignedVesselCodes: updated.assignedVesselCodes ?? [],
          joinedAt: now,
        };
      }
      // En el dev store cada record pertenece a un tenant — no hay verdadera
      // separación global User/Membership como en Prisma. Si el username está
      // tomado en otro tenant, lo permitimos creando un nuevo record (dev mode
      // no tiene unique global real).
    }

    const record = createDevTenantUser({
      tenantSlug: session.tenantSlug,
      email: internalEmail,
      legacyUserId: cleanUsername,
      passwordHash: "none$no-login",
      preferredLocale: "es",
      firstName: input.firstName.trim(),
      lastName: input.lastName?.trim() ?? "",
      role: input.role,
      assignedVesselCodes: [],
      userStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
    });
    // listDevTenantUsers se importa para mantener compat — no se usa en este flujo
    void listDevTenantUsers;

    return {
      userId: record.id,
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      role: record.role,
      status: record.membershipStatus,
      assignedVesselCodes: [],
      joinedAt: now,
    };
  }

  // Prisma mode
  const { hashPassword } = await import("../../platform/auth/passwords");
  const tenantId = await getTenantId(prisma, session.tenantSlug);
  const internalEmail = input.email?.trim().toLowerCase()
    || `named-${Date.now()}@internal.${session.tenantSlug}.local`;

  const cleanUsername = input.firstName.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "");

  // El modelo User es global (legacyUserId y email son @unique global), pero la
  // pertenencia a un tenant la define TenantMembership. Por eso "ya existe un
  // user con USER X" no implica conflicto en este tenant — puede pertenecer a
  // otro tenant o haber quedado huérfano. Flujo correcto:
  //   1. Si no existe el User globalmente → crear User + membership.
  //   2. Si existe el User globalmente:
  //      a. Si ya es miembro ACTIVE de este tenant → 409 (ya está en el equipo).
  //      b. Si es miembro REVOKED de este tenant → reactivar la membership.
  //      c. Si no tiene membership en este tenant → crear membership reutilizando el User.
  //   3. Email: si se pasa un email y pertenece a OTRO User existente, 409.
  const existingByUsername = await prisma.user.findUnique({ where: { legacyUserId: cleanUsername } });
  if (input.email) {
    const existingByEmail = await prisma.user.findUnique({ where: { email: internalEmail } });
    if (existingByEmail && existingByEmail.id !== existingByUsername?.id) {
      throw new RouteError(409, "EMAIL_TAKEN", `El email "${internalEmail}" pertenece a otro usuario.`);
    }
  }

  let user: { id: string; email: string; firstName: string | null; lastName: string | null };

  if (existingByUsername) {
    // El user ya existe globalmente — reutilizarlo. Chequeamos su membership
    // en este tenant para decidir si crear, reactivar o rechazar.
    const existingMembership = await (prisma as any).tenantMembership.findFirst({
      where: { tenantId, userId: existingByUsername.id },
    });
    if (existingMembership?.status === "ACTIVE") {
      throw new RouteError(409, "ALREADY_MEMBER", `"${cleanUsername}" ya es miembro activo de este tenant.`);
    }
    if (existingMembership?.status === "REVOKED" || existingMembership?.status === "SUSPENDED") {
      await (prisma as any).tenantMembership.update({
        where: { id: existingMembership.id },
        data: { role: input.role, status: "ACTIVE" },
      });
    } else if (!existingMembership) {
      await (prisma as any).tenantMembership.create({
        data: { tenantId, userId: existingByUsername.id, role: input.role, status: "ACTIVE", joinedAt: new Date() },
      });
    } else {
      // Estado INVITED u otro — promovemos a ACTIVE.
      await (prisma as any).tenantMembership.update({
        where: { id: existingMembership.id },
        data: { role: input.role, status: "ACTIVE" },
      });
    }
    user = existingByUsername;
  } else {
    // User nuevo: crear globalmente + membership.
    try {
      user = await prisma.user.create({
        data: {
          email: internalEmail,
          legacyUserId: cleanUsername,
          firstName: input.firstName.trim(),
          lastName: input.lastName?.trim() ?? null,
          passwordHash: hashPassword(randomBytes(32).toString("hex")),
          status: "ACTIVE",
        },
      });
    } catch (err: any) {
      // Race entre el findUnique y el create (otro proceso pudo haber creado
      // el user en el medio). 409 con el mismo mensaje sería más correcto
      // ahora, pero como el flujo de reuso ya cubrió el caso normal, esto
      // solo ocurre bajo carrera real.
      if (err?.code === "P2002") {
        throw new RouteError(409, "USERNAME_TAKEN", "Conflicto al crear el usuario. Reintentá.");
      }
      throw err;
    }
    await (prisma as any).tenantMembership.create({
      data: { tenantId, userId: user.id, role: input.role, status: "ACTIVE", joinedAt: new Date() },
    });
  }

  return {
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: input.role,
    status: "ACTIVE",
    assignedVesselCodes: [],
    joinedAt: now,
  };
}

// ─── Sync Vessel Assignments ──────────────────────────────────────────────────

export async function syncMemberVessels(session: TenantAccessSession, userId: string, vesselCodes: string[]) {
  ensureAdmin(session);

  const prisma = getPrismaClient();

  if (!prisma) {
    const { updateDevTenantUser, getDevTenantUserById } = await import("../../platform/data/dev-tenant-user-store");
    const user = getDevTenantUserById(userId);
    if (!user || user.tenantSlug !== session.tenantSlug) {
      throw new RouteError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
    }
    if (user.role === "TECHNICIAN_OPERATOR" && vesselCodes.length === 0) {
      throw new RouteError(400, "TECHNICIAN_REQUIRES_VESSEL", "Un Técnico/Operador debe tener al menos una embarcación asignada.");
    }
    updateDevTenantUser(userId, { assignedVesselCodes: vesselCodes });
    return { userId, assignedVesselCodes: vesselCodes };
  }

  const tenantId = await getTenantId(prisma, session.tenantSlug);
  const membership = await (prisma as any).tenantMembership.findFirst({
    where: { tenantId, userId },
  });
  if (!membership) throw new RouteError(404, "USER_NOT_FOUND", "Miembro no encontrado.");

  if (membership.role === "TECHNICIAN_OPERATOR" && vesselCodes.length === 0) {
    throw new RouteError(400, "TECHNICIAN_REQUIRES_VESSEL", "Un Técnico/Operador debe tener al menos una embarcación asignada.");
  }

  await (prisma as any).tenantMembership.update({
    where: { id: membership.id },
    data: { assignedVesselCodes: vesselCodes },
  });

  return { userId, assignedVesselCodes: vesselCodes };
}

// ─── List Pending Invitations ─────────────────────────────────────────────────

export async function listPendingInvitations(session: TenantAccessSession) {
  ensureAdmin(session);
  const prisma = getPrismaClient();

  if (!prisma) {
    const invites = listDevInvitations(session.tenantSlug, { status: "INVITED" });
    return invites.map(i => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
    }));
  }

  const tenantId = await getTenantId(prisma, session.tenantSlug);
  const invitations = await prisma.userInvitation.findMany({
    where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  return invitations.map(i => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  }));
}

// ─── Set Member Password ──────────────────────────────────────────────────────

export async function setMemberPassword(session: TenantAccessSession, userId: string, password: string) {
  ensureAdmin(session);
  if (!password || password.length < 4) {
    throw new RouteError(400, "PASSWORD_TOO_SHORT", "La contraseña debe tener al menos 4 caracteres.");
  }

  const prisma = getPrismaClient();

  if (!prisma) {
    const { updateDevTenantUser, getDevTenantUserById } = await import("../../platform/data/dev-tenant-user-store");
    const user = getDevTenantUserById(userId);
    if (!user || user.tenantSlug !== session.tenantSlug) {
      throw new RouteError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
    }
    updateDevTenantUser(userId, { passwordHash: `plain$${password}` });
    return { ok: true };
  }

  const { hashPassword } = await import("../../platform/auth/passwords");
  const tenantId = await getTenantId(prisma, session.tenantSlug);

  // updateMany scoped via membership: only updates if the user has a membership
  // in this tenant. Prevents an admin from another tenant from changing the
  // password of a user that doesn't belong to them.
  const result = await prisma.user.updateMany({
    where: {
      id: userId,
      memberships: { some: { tenantId } },
    },
    data: { passwordHash: hashPassword(password) },
  });
  if (result.count === 0) {
    throw new RouteError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
  }

  await publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "PASSWORD_CHANGED",
    entityType: "User",
    entityId: userId,
    metadata: { tenantSlug: session.tenantSlug, self: false, byAdmin: true },
  });

  return { ok: true };
}

// ─── Update Member Email ──────────────────────────────────────────────────────

export async function updateMemberEmail(session: TenantAccessSession, userId: string, emailRaw: string) {
  ensureAdmin(session);

  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || email.length < 5) {
    throw new RouteError(400, "INVALID_EMAIL", "Email inválido.");
  }

  const prisma = getPrismaClient();

  if (!prisma) {
    const { updateDevTenantUser, getDevTenantUserById, getDevTenantUserByEmail } =
      await import("../../platform/data/dev-tenant-user-store");
    const user = getDevTenantUserById(userId);
    if (!user || user.tenantSlug !== session.tenantSlug) {
      throw new RouteError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
    }
    const taken = getDevTenantUserByEmail(email);
    if (taken && taken.id !== userId) {
      throw new RouteError(409, "EMAIL_TAKEN", `El email "${email}" pertenece a otro usuario.`);
    }
    updateDevTenantUser(userId, { email });
    return { userId, email };
  }

  const tenantId = await getTenantId(prisma, session.tenantSlug);

  // email es @unique global en User — rechazar si ya pertenece a otro user.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.id !== userId) {
    throw new RouteError(409, "EMAIL_TAKEN", `El email "${email}" pertenece a otro usuario.`);
  }

  // updateMany scopeado por membership: solo actualiza si el user pertenece a
  // este tenant — un admin de otro tenant no puede cambiar el email de un user ajeno.
  const result = await prisma.user.updateMany({
    where: { id: userId, memberships: { some: { tenantId } } },
    data: { email },
  });
  if (result.count === 0) {
    throw new RouteError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
  }

  await publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "EMAIL_CHANGED",
    entityType: "User",
    entityId: userId,
    metadata: { tenantSlug: session.tenantSlug, newEmail: email, byAdmin: true },
  });

  return { userId, email };
}
