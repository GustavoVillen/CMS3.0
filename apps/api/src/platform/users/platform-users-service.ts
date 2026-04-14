import { RouteError } from "../../http/route-error";
import { getPrismaClient } from "../data/prisma-client";
import { hashPassword } from "../auth/passwords";
import {
  createDevPlatformUser,
  getDevPlatformUserByEmail,
  getDevPlatformUserById,
  listDevPlatformUsers,
  updateDevPlatformUser,
  type DevPlatformUserRole,
  type DevPlatformUserStatus,
} from "../data/dev-platform-user-store";

export interface PlatformUserSummary {
  id: string;
  email: string;
  role: DevPlatformUserRole;
  status: DevPlatformUserStatus;
  firstName?: string | null;
  lastName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformUserListFilters {
  status?: string | null;
  role?: string | null;
  email?: string | null;
}

export interface PlatformUserCreateRequest {
  email: string;
  password: string;
  role: DevPlatformUserRole;
  status?: DevPlatformUserStatus;
  firstName?: string | null;
  lastName?: string | null;
}

export interface PlatformUserUpdateRequest {
  email?: string;
  password?: string;
  role?: DevPlatformUserRole;
  status?: DevPlatformUserStatus;
  firstName?: string | null;
  lastName?: string | null;
}

const EMAIL_PATTERN = /.+@.+\..+/;

function ensureEmail(value: string, code: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || !EMAIL_PATTERN.test(normalized)) {
    throw new RouteError(400, code, "Valid email is required.");
  }
  return normalized;
}

function ensurePassword(value: string): string {
  const normalized = String(value || "");
  if (normalized.length < 6) {
    throw new RouteError(400, "PLATFORM_PASSWORD_WEAK", "Password must be at least 6 characters.");
  }
  return normalized;
}

function toSummaryFromDev(record: {
  id: string;
  email: string;
  role: DevPlatformUserRole;
  status: DevPlatformUserStatus;
  firstName?: string | null;
  lastName?: string | null;
  createdAt: string;
  updatedAt: string;
}): PlatformUserSummary {
  return {
    id: record.id,
    email: record.email,
    role: record.role,
    status: record.status,
    firstName: record.firstName ?? null,
    lastName: record.lastName ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toSummaryFromPrisma(record: {
  id: string;
  email: string;
  role: DevPlatformUserRole;
  status: DevPlatformUserStatus;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PlatformUserSummary {
  return {
    id: record.id,
    email: record.email,
    role: record.role,
    status: record.status,
    firstName: record.firstName,
    lastName: record.lastName,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function listPlatformUsers(filters: PlatformUserListFilters = {}): Promise<PlatformUserSummary[]> {
  const prisma = getPrismaClient();
  const normalizedEmail = filters.email ? ensureEmail(filters.email, "PLATFORM_EMAIL_INVALID") : undefined;
  if (!prisma) {
    return listDevPlatformUsers({
      status: filters.status,
      role: filters.role,
      email: normalizedEmail,
    }).map((record) => toSummaryFromDev(record));
  }

  const records = await prisma.platformUser.findMany({
    where: {
      status: filters.status as DevPlatformUserStatus | undefined,
      role: filters.role as DevPlatformUserRole | undefined,
      email: normalizedEmail || undefined,
    },
    orderBy: { createdAt: "asc" },
  });

  return records.map((record) => toSummaryFromPrisma(record));
}

export async function getPlatformUser(id: string): Promise<PlatformUserSummary> {
  const prisma = getPrismaClient();
  if (!prisma) {
    const record = getDevPlatformUserById(id);
    if (!record) {
      throw new RouteError(404, "PLATFORM_USER_NOT_FOUND", "Platform user not found.");
    }
    return toSummaryFromDev(record);
  }

  const record = await prisma.platformUser.findUnique({ where: { id } });
  if (!record) {
    throw new RouteError(404, "PLATFORM_USER_NOT_FOUND", "Platform user not found.");
  }
  return toSummaryFromPrisma(record);
}

export async function createPlatformUser(request: PlatformUserCreateRequest): Promise<PlatformUserSummary> {
  const email = ensureEmail(request.email, "PLATFORM_EMAIL_INVALID");
  const password = ensurePassword(request.password);
  const prisma = getPrismaClient();
  if (!prisma) {
    if (getDevPlatformUserByEmail(email)) {
      throw new RouteError(409, "PLATFORM_USER_EXISTS", "Platform user already exists.");
    }
    const record = createDevPlatformUser({
      email,
      passwordHash: hashPassword(password),
      role: request.role,
      status: request.status || "ACTIVE",
      firstName: request.firstName ?? null,
      lastName: request.lastName ?? null,
    });
    return toSummaryFromDev(record);
  }

  const existing = await prisma.platformUser.findUnique({ where: { email } });
  if (existing) {
    throw new RouteError(409, "PLATFORM_USER_EXISTS", "Platform user already exists.");
  }

  const record = await prisma.platformUser.create({
    data: {
      email,
      passwordHash: hashPassword(password),
      role: request.role,
      status: request.status || "ACTIVE",
      firstName: request.firstName || null,
      lastName: request.lastName || null,
    },
  });

  return toSummaryFromPrisma(record);
}

export async function updatePlatformUser(id: string, request: PlatformUserUpdateRequest): Promise<PlatformUserSummary> {
  const prisma = getPrismaClient();
  const nextEmail = request.email ? ensureEmail(request.email, "PLATFORM_EMAIL_INVALID") : undefined;
  const nextPasswordHash = request.password ? hashPassword(ensurePassword(request.password)) : undefined;
  if (!prisma) {
    const existing = getDevPlatformUserById(id);
    if (!existing) {
      throw new RouteError(404, "PLATFORM_USER_NOT_FOUND", "Platform user not found.");
    }
    if (nextEmail && existing.email !== nextEmail && getDevPlatformUserByEmail(nextEmail)) {
      throw new RouteError(409, "PLATFORM_USER_EXISTS", "Platform user already exists.");
    }
    const record = updateDevPlatformUser(id, {
      email: nextEmail,
      passwordHash: nextPasswordHash,
      role: request.role,
      status: request.status,
      firstName: request.firstName ?? undefined,
      lastName: request.lastName ?? undefined,
    });
    if (!record) {
      throw new RouteError(404, "PLATFORM_USER_NOT_FOUND", "Platform user not found.");
    }
    return toSummaryFromDev(record);
  }

  const existing = await prisma.platformUser.findUnique({ where: { id } });
  if (!existing) {
    throw new RouteError(404, "PLATFORM_USER_NOT_FOUND", "Platform user not found.");
  }
  if (nextEmail && existing.email !== nextEmail) {
    const clash = await prisma.platformUser.findUnique({ where: { email: nextEmail } });
    if (clash) {
      throw new RouteError(409, "PLATFORM_USER_EXISTS", "Platform user already exists.");
    }
  }

  const record = await prisma.platformUser.update({
    where: { id },
    data: {
      email: nextEmail || undefined,
      passwordHash: nextPasswordHash || undefined,
      role: request.role || undefined,
      status: request.status || undefined,
      firstName: request.firstName !== undefined ? request.firstName : undefined,
      lastName: request.lastName !== undefined ? request.lastName : undefined,
    },
  });

  return toSummaryFromPrisma(record);
}
