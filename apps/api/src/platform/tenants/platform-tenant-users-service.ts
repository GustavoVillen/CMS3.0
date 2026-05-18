import type { LocaleCode, TenantRole } from "@pms-saas/shared-types";
import { RouteError } from "../../http/route-error";
import { hashPassword } from "../auth/passwords";
import { getPrismaClient } from "../data/prisma-client";
import { getDevTenantBySlug } from "../data/dev-tenant-store";
import { publishPlatformAudit } from "../audit/audit-publisher";
import {
  createDevTenantUser,
  getDevTenantUserByEmail,
  getDevTenantUserById,
  getDevTenantUserByLegacyId,
  listDevTenantUsers,
  updateDevTenantUser,
  type DevMembershipStatus,
  type DevTenantUserStatus,
} from "../data/dev-tenant-user-store";

export interface PlatformTenantUserSummary {
  id: string;
  tenantSlug: string;
  email: string;
  legacyUserId?: string | null;
  userStatus: DevTenantUserStatus;
  membershipStatus: DevMembershipStatus;
  role: TenantRole;
  assignedVesselCodes: string[];
  preferredLocale?: LocaleCode | null;
  firstName?: string | null;
  lastName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformTenantUserListFilters {
  userStatus?: string | null;
  membershipStatus?: string | null;
  role?: string | null;
  email?: string | null;
}

export interface PlatformTenantUserCreateRequest {
  email: string;
  legacyUserId?: string | null;
  password: string;
  role: TenantRole;
  assignedVesselCodes?: string[];
  preferredLocale?: LocaleCode;
  firstName?: string | null;
  lastName?: string | null;
  userStatus?: DevTenantUserStatus;
  membershipStatus?: DevMembershipStatus;
}

export interface PlatformTenantUserUpdateRequest {
  email?: string;
  legacyUserId?: string | null;
  password?: string;
  role?: TenantRole;
  assignedVesselCodes?: string[];
  preferredLocale?: LocaleCode;
  firstName?: string | null;
  lastName?: string | null;
  userStatus?: DevTenantUserStatus;
  membershipStatus?: DevMembershipStatus;
}

const EMAIL_PATTERN = /.+@.+\..+/;
const ROLE_VALUES: TenantRole[] = [
  "TENANT_ADMIN",
  "FLEET_SUPERINTENDENT",
  "MAINTENANCE_MANAGER",
  "TECHNICIAN_OPERATOR",
  "INSPECTOR_COMPLIANCE",
  "PROCUREMENT_STORE",
  "AUDITOR_READONLY",
];
const USER_STATUS_VALUES: DevTenantUserStatus[] = ["INVITED", "ACTIVE", "SUSPENDED", "DISABLED"];
const MEMBERSHIP_STATUS_VALUES: DevMembershipStatus[] = ["INVITED", "ACTIVE", "SUSPENDED", "REVOKED"];

function ensureEmail(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || !EMAIL_PATTERN.test(normalized)) {
    throw new RouteError(400, "TENANT_USER_INVALID_EMAIL", "Valid email is required.");
  }
  return normalized;
}

function ensurePassword(value: string): string {
  const normalized = String(value || "");
  if (normalized.length < 6) {
    throw new RouteError(400, "TENANT_USER_WEAK_PASSWORD", "Password must be at least 6 characters.");
  }
  return normalized;
}

function ensureRole(value: string): TenantRole {
  const normalized = String(value || "").trim().toUpperCase();
  if (!ROLE_VALUES.includes(normalized as TenantRole)) {
    throw new RouteError(400, "TENANT_USER_INVALID_ROLE", "Role is invalid.");
  }
  return normalized as TenantRole;
}

function ensureUserStatus(value: string, code: string): DevTenantUserStatus {
  const normalized = String(value || "").trim().toUpperCase();
  if (!USER_STATUS_VALUES.includes(normalized as DevTenantUserStatus)) {
    throw new RouteError(400, code, "User status is invalid.");
  }
  return normalized as DevTenantUserStatus;
}

function ensureMembershipStatus(value: string, code: string): DevMembershipStatus {
  const normalized = String(value || "").trim().toUpperCase();
  if (!MEMBERSHIP_STATUS_VALUES.includes(normalized as DevMembershipStatus)) {
    throw new RouteError(400, code, "Membership status is invalid.");
  }
  return normalized as DevMembershipStatus;
}

function toSummaryFromDev(record: {
  id: string;
  tenantSlug: string;
  email: string;
  legacyUserId?: string | null;
  userStatus: DevTenantUserStatus;
  membershipStatus: DevMembershipStatus;
  role: TenantRole;
  assignedVesselCodes: string[];
  preferredLocale?: LocaleCode;
  firstName?: string | null;
  lastName?: string | null;
  createdAt: string;
  updatedAt: string;
}): PlatformTenantUserSummary {
  return {
    id: record.id,
    tenantSlug: record.tenantSlug,
    email: record.email,
    legacyUserId: record.legacyUserId || null,
    userStatus: record.userStatus,
    membershipStatus: record.membershipStatus,
    role: record.role,
    assignedVesselCodes: record.assignedVesselCodes,
    preferredLocale: record.preferredLocale || null,
    firstName: record.firstName ?? null,
    lastName: record.lastName ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toSummaryFromPrisma(record: {
  tenant: { slug: string };
  user: {
    id: string;
    email: string;
    legacyUserId: string | null;
    status: DevTenantUserStatus;
    preferredLocale: LocaleCode | null;
    firstName: string | null;
    lastName: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  role: TenantRole;
  status: DevMembershipStatus;
  assignedVesselCodes: string[];
}): PlatformTenantUserSummary {
  return {
    id: record.user.id,
    tenantSlug: record.tenant.slug,
    email: record.user.email,
    legacyUserId: record.user.legacyUserId,
    userStatus: record.user.status,
    membershipStatus: record.status,
    role: record.role,
    assignedVesselCodes: record.assignedVesselCodes,
    preferredLocale: record.user.preferredLocale,
    firstName: record.user.firstName,
    lastName: record.user.lastName,
    createdAt: record.user.createdAt.toISOString(),
    updatedAt: record.user.updatedAt.toISOString(),
  };
}

async function resolveTenantId(slug: string): Promise<{ id: string; slug: string }> {
  const prisma = getPrismaClient();
  if (!prisma) {
    const record = getDevTenantBySlug(slug);
    if (!record) {
      throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    }
    return { id: record.id, slug: record.slug };
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  }
  return { id: tenant.id, slug: tenant.slug };
}

export async function listPlatformTenantUsers(
  tenantSlug: string,
  filters: PlatformTenantUserListFilters = {},
): Promise<PlatformTenantUserSummary[]> {
  const tenant = await resolveTenantId(tenantSlug);
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevTenantUsers({
      tenantSlug: tenant.slug,
      userStatus: filters.userStatus,
      membershipStatus: filters.membershipStatus,
      role: filters.role,
      email: filters.email,
    }).map((record) => toSummaryFromDev(record));
  }

  const membershipWhere: Record<string, unknown> = { tenantId: tenant.id };
  if (filters.role) membershipWhere.role = filters.role;
  if (filters.membershipStatus) membershipWhere.status = filters.membershipStatus;
  const userWhere: Record<string, unknown> = {};
  if (filters.userStatus) userWhere.status = filters.userStatus;
  if (filters.email) userWhere.email = filters.email;
  if (Object.keys(userWhere).length > 0) membershipWhere.user = userWhere;

  const records = await prisma.tenantMembership.findMany({
    where: membershipWhere as Parameters<typeof prisma.tenantMembership.findMany>[0]["where"],
    include: { tenant: true, user: true },
    orderBy: { createdAt: "asc" },
  });

  return records.map((record) => toSummaryFromPrisma(record));
}

export async function getPlatformTenantUser(
  tenantSlug: string,
  userId: string,
): Promise<PlatformTenantUserSummary> {
  const tenant = await resolveTenantId(tenantSlug);
  const prisma = getPrismaClient();
  if (!prisma) {
    const record = getDevTenantUserById(userId);
    if (!record || record.tenantSlug !== tenant.slug) {
      throw new RouteError(404, "TENANT_USER_NOT_FOUND", "Tenant user not found.");
    }
    return toSummaryFromDev(record);
  }

  const record = await prisma.tenantMembership.findFirst({
    where: {
      tenantId: tenant.id,
      userId,
    },
    include: {
      tenant: true,
      user: true,
    },
  });
  if (!record) {
    throw new RouteError(404, "TENANT_USER_NOT_FOUND", "Tenant user not found.");
  }

  return toSummaryFromPrisma(record);
}

export async function createPlatformTenantUser(
  tenantSlug: string,
  request: PlatformTenantUserCreateRequest,
): Promise<PlatformTenantUserSummary> {
  const tenant = await resolveTenantId(tenantSlug);
  const email = ensureEmail(request.email);
  const password = ensurePassword(request.password);
  const role = ensureRole(request.role);
  const userStatus = request.userStatus
    ? ensureUserStatus(request.userStatus, "TENANT_USER_INVALID_STATUS")
    : "ACTIVE";
  const membershipStatus = request.membershipStatus
    ? ensureMembershipStatus(request.membershipStatus, "TENANT_MEMBERSHIP_INVALID_STATUS")
    : "ACTIVE";
  const assignedVesselCodes = request.assignedVesselCodes || [];

  const prisma = getPrismaClient();
  if (!prisma) {
    if (getDevTenantUserByEmail(email)) {
      throw new RouteError(409, "TENANT_USER_EXISTS", "User email already exists.");
    }
    if (request.legacyUserId && getDevTenantUserByLegacyId(request.legacyUserId)) {
      throw new RouteError(409, "TENANT_USER_EXISTS", "Legacy user id already exists.");
    }

    const record = createDevTenantUser({
      tenantSlug: tenant.slug,
      email,
      legacyUserId: request.legacyUserId ?? null,
      passwordHash: hashPassword(password),
      preferredLocale: request.preferredLocale || "es",
      firstName: request.firstName || "",
      lastName: request.lastName || "",
      role,
      assignedVesselCodes,
      userStatus,
      membershipStatus,
    });
    return toSummaryFromDev(record);
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email },
        request.legacyUserId ? { legacyUserId: request.legacyUserId } : undefined,
      ].filter(Boolean) as { email?: string; legacyUserId?: string }[],
    },
  });
  if (existing) {
    throw new RouteError(409, "TENANT_USER_EXISTS", "User already exists.");
  }

  const record = await prisma.user.create({
    data: {
      email,
      legacyUserId: request.legacyUserId || null,
      passwordHash: hashPassword(password),
      status: userStatus,
      preferredLocale: request.preferredLocale || null,
      firstName: request.firstName || null,
      lastName: request.lastName || null,
      memberships: {
        create: {
          tenantId: tenant.id,
          role,
          status: membershipStatus,
          assignedVesselCodes,
        },
      },
    },
    include: {
      memberships: {
        include: { tenant: true, user: true },
      },
    },
  });

  const membership = record.memberships[0];
  return toSummaryFromPrisma(membership);
}

export async function updatePlatformTenantUser(
  tenantSlug: string,
  userId: string,
  request: PlatformTenantUserUpdateRequest,
  actorPlatformUserId?: string,
): Promise<PlatformTenantUserSummary> {
  const tenant = await resolveTenantId(tenantSlug);
  const prisma = getPrismaClient();
  const nextEmail = request.email ? ensureEmail(request.email) : undefined;
  const nextPasswordHash = request.password ? hashPassword(ensurePassword(request.password)) : undefined;
  const nextRole = request.role ? ensureRole(request.role) : undefined;
  const nextUserStatus = request.userStatus
    ? ensureUserStatus(request.userStatus, "TENANT_USER_INVALID_STATUS")
    : undefined;
  const nextMembershipStatus = request.membershipStatus
    ? ensureMembershipStatus(request.membershipStatus, "TENANT_MEMBERSHIP_INVALID_STATUS")
    : undefined;
  const hasAssignedVessels = request.assignedVesselCodes !== undefined;

  if (!prisma) {
    const existing = getDevTenantUserById(userId);
    if (!existing || existing.tenantSlug !== tenant.slug) {
      throw new RouteError(404, "TENANT_USER_NOT_FOUND", "Tenant user not found.");
    }
    if (nextEmail && existing.email !== nextEmail && getDevTenantUserByEmail(nextEmail)) {
      throw new RouteError(409, "TENANT_USER_EXISTS", "User email already exists.");
    }
    if (
      request.legacyUserId &&
      existing.legacyUserId !== request.legacyUserId &&
      getDevTenantUserByLegacyId(request.legacyUserId)
    ) {
      throw new RouteError(409, "TENANT_USER_EXISTS", "Legacy user id already exists.");
    }

    const record = updateDevTenantUser(userId, {
      email: nextEmail,
      legacyUserId: request.legacyUserId ?? undefined,
      passwordHash: nextPasswordHash,
      preferredLocale: request.preferredLocale,
      firstName: request.firstName ?? undefined,
      lastName: request.lastName ?? undefined,
      role: nextRole,
      assignedVesselCodes: request.assignedVesselCodes,
      userStatus: nextUserStatus,
      membershipStatus: nextMembershipStatus,
    });
    if (!record) {
      throw new RouteError(404, "TENANT_USER_NOT_FOUND", "Tenant user not found.");
    }
    return toSummaryFromDev(record);
  }

  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantId: tenant.id,
      userId,
    },
    include: {
      tenant: true,
      user: true,
    },
  });
  if (!membership) {
    throw new RouteError(404, "TENANT_USER_NOT_FOUND", "Tenant user not found.");
  }

  if (nextEmail && membership.user.email !== nextEmail) {
    const clash = await prisma.user.findUnique({ where: { email: nextEmail } });
    if (clash) {
      throw new RouteError(409, "TENANT_USER_EXISTS", "User email already exists.");
    }
  }
  if (request.legacyUserId && membership.user.legacyUserId !== request.legacyUserId) {
    const clash = await prisma.user.findUnique({ where: { legacyUserId: request.legacyUserId } });
    if (clash) {
      throw new RouteError(409, "TENANT_USER_EXISTS", "Legacy user id already exists.");
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (
      nextEmail ||
      nextPasswordHash ||
      nextUserStatus ||
      request.preferredLocale !== undefined ||
      request.firstName !== undefined ||
      request.lastName !== undefined ||
      request.legacyUserId !== undefined
    ) {
      await tx.user.update({
        where: { id: membership.userId },
        data: {
          email: nextEmail || undefined,
          legacyUserId: request.legacyUserId !== undefined ? request.legacyUserId : undefined,
          passwordHash: nextPasswordHash || undefined,
          status: nextUserStatus || undefined,
          preferredLocale: request.preferredLocale !== undefined ? request.preferredLocale : undefined,
          firstName: request.firstName !== undefined ? request.firstName : undefined,
          lastName: request.lastName !== undefined ? request.lastName : undefined,
        },
      });
    }

    if (nextRole || nextMembershipStatus || hasAssignedVessels) {
      await tx.tenantMembership.update({
        where: { id: membership.id },
        data: {
          role: nextRole || undefined,
          status: nextMembershipStatus || undefined,
          assignedVesselCodes: hasAssignedVessels ? request.assignedVesselCodes : undefined,
        },
      });
    }

    return tx.tenantMembership.findUnique({
      where: { id: membership.id },
      include: { tenant: true, user: true },
    });
  });

  if (!updated) {
    throw new RouteError(500, "TENANT_USER_UPDATE_FAILED", "Failed to update tenant user.");
  }

  if (actorPlatformUserId) {
    const changedFields: string[] = [];
    if (nextEmail) changedFields.push("email");
    if (nextPasswordHash) changedFields.push("password");
    if (nextRole) changedFields.push("role");
    if (nextUserStatus) changedFields.push("userStatus");
    if (nextMembershipStatus) changedFields.push("membershipStatus");
    if (hasAssignedVessels) changedFields.push("assignedVesselCodes");
    await publishPlatformAudit(prisma, {
      tenantId: tenant.id,
      actorPlatformUserId,
      action: nextPasswordHash ? "PASSWORD_CHANGED_BY_PLATFORM_ADMIN" : "TENANT_USER_UPDATED_BY_PLATFORM_ADMIN",
      entityType: "User",
      entityId: userId,
      metadata: { tenantSlug, changedFields },
    });
  }

  return toSummaryFromPrisma(updated);
}

/**
 * Revoca el acceso de un usuario a un tenant marcando su membership como
 * REVOKED (soft delete). No borra el registro porque foreign keys de
 * audit / MOC / changelogs apuntan al user.
 *
 * Reglas de negocio:
 *   - No se puede revocar al último TENANT_ADMIN ACTIVO o INVITED del tenant
 *     (dejaría el tenant sin administrador).
 *   - Si la membership ya está REVOKED devuelve 409.
 *
 * Nota: la decisión de impedir auto-revoke se aplica en el router, donde
 * tenemos identificado al actor.
 */
export async function revokePlatformTenantUser(
  tenantSlug: string,
  userId: string,
  actorPlatformUserId?: string,
): Promise<PlatformTenantUserSummary> {
  const tenant = await resolveTenantId(tenantSlug);
  const prisma = getPrismaClient();

  if (!prisma) {
    const existing = getDevTenantUserById(userId);
    if (!existing || existing.tenantSlug !== tenant.slug) {
      throw new RouteError(404, "TENANT_USER_NOT_FOUND", "Tenant user not found.");
    }
    if (existing.membershipStatus === "REVOKED") {
      throw new RouteError(409, "TENANT_USER_ALREADY_REVOKED", "User access is already revoked.");
    }
    // Último admin: cuenta admins distintos a este user que no estén REVOKED.
    if (existing.role === "TENANT_ADMIN") {
      const otherAdmins = listDevTenantUsers({ tenantSlug: tenant.slug, role: "TENANT_ADMIN" })
        .filter(u => u.id !== userId && u.membershipStatus !== "REVOKED");
      if (otherAdmins.length === 0) {
        throw new RouteError(409, "TENANT_LAST_ADMIN", "Cannot revoke the last admin of the tenant.");
      }
    }
    const record = updateDevTenantUser(userId, { membershipStatus: "REVOKED" });
    if (!record) {
      throw new RouteError(404, "TENANT_USER_NOT_FOUND", "Tenant user not found.");
    }
    return toSummaryFromDev(record);
  }

  const membership = await prisma.tenantMembership.findFirst({
    where: { tenantId: tenant.id, userId },
    include: { tenant: true, user: true },
  });
  if (!membership) {
    throw new RouteError(404, "TENANT_USER_NOT_FOUND", "Tenant user not found.");
  }
  if (membership.status === "REVOKED") {
    throw new RouteError(409, "TENANT_USER_ALREADY_REVOKED", "User access is already revoked.");
  }
  if (membership.role === "TENANT_ADMIN") {
    const otherAdmins = await prisma.tenantMembership.count({
      where: {
        tenantId: tenant.id,
        role: "TENANT_ADMIN",
        status: { not: "REVOKED" },
        userId: { not: userId },
      },
    });
    if (otherAdmins === 0) {
      throw new RouteError(409, "TENANT_LAST_ADMIN", "Cannot revoke the last admin of the tenant.");
    }
  }

  const updated = await prisma.tenantMembership.update({
    where: { id: membership.id },
    data: { status: "REVOKED" },
    include: { tenant: true, user: true },
  });

  if (actorPlatformUserId) {
    await publishPlatformAudit(prisma, {
      tenantId: tenant.id,
      actorPlatformUserId,
      action: "TENANT_USER_REVOKED_BY_PLATFORM_ADMIN",
      entityType: "User",
      entityId: userId,
      metadata: { tenantSlug, role: membership.role, email: membership.user.email },
    });
  }

  return toSummaryFromPrisma(updated);
}
