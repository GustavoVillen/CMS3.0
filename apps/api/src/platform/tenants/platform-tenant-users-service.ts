import type { LocaleCode, TenantRole } from "@pms-saas/shared-types";
import { RouteError } from "../../http/route-error";
import { hashPassword } from "../auth/passwords";
import { getPrismaClient } from "../data/prisma-client";
import { getDevTenantBySlug } from "../data/dev-tenant-store";
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

  const records = await prisma.tenantMembership.findMany({
    where: {
      tenantId: tenant.id,
      role: filters.role as TenantRole | undefined,
      status: filters.membershipStatus as DevMembershipStatus | undefined,
      user: {
        status: filters.userStatus as DevTenantUserStatus | undefined,
        email: filters.email || undefined,
      },
    },
    include: {
      tenant: true,
      user: true,
    },
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

  return toSummaryFromPrisma(updated);
}
