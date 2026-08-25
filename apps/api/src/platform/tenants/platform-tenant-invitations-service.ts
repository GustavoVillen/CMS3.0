import { randomBytes } from "node:crypto";
import type { LocaleCode, TenantRole } from "@cms3/shared-types";
import { RouteError } from "../../http/route-error";
import { hashOpaqueToken } from "../auth/passwords";
import { getPrismaClient } from "../data/prisma-client";
import { getDevTenantBySlug } from "../data/dev-tenant-store";
import {
  createDevInvitation,
  listDevInvitations,
  type DevInvitationRecord,
  type DevInvitationStatus,
} from "../data/dev-invitation-store";
import { getDevTenantUserByEmail } from "../data/dev-tenant-user-store";

export interface PlatformInvitationSummary {
  id: string;
  tenantSlug: string;
  email: string;
  role: TenantRole;
  locale: LocaleCode;
  status: DevInvitationStatus;
  token?: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string | null;
  acceptedByUserId?: string | null;
}

export interface PlatformInvitationListFilters {
  status?: string | null;
  email?: string | null;
}

export interface PlatformInvitationCreateRequest {
  email: string;
  role: TenantRole;
  locale: LocaleCode;
}

const EMAIL_PATTERN = /.+@.+\..+/;

function ensureEmail(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || !EMAIL_PATTERN.test(normalized)) {
    throw new RouteError(400, "INVITE_INVALID_EMAIL", "Valid email is required.");
  }
  return normalized;
}

function toSummaryFromDev(record: DevInvitationRecord): PlatformInvitationSummary {
  return {
    id: record.id,
    tenantSlug: record.tenantSlug,
    email: record.email,
    role: record.role,
    locale: record.locale,
    status: record.status,
    token: record.token,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    acceptedAt: record.acceptedAt ?? null,
    acceptedByUserId: record.acceptedByUserId ?? null,
  };
}

export async function listPlatformTenantInvitations(
  tenantSlug: string,
  filters: PlatformInvitationListFilters = {},
): Promise<PlatformInvitationSummary[]> {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevInvitations(tenantSlug, filters).map((record) => toSummaryFromDev(record));
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  }

  const records = await prisma.userInvitation.findMany({
    where: {
      tenantId: tenant.id,
      acceptedAt: filters.status === "ACCEPTED" ? { not: null } : undefined,
      email: filters.email || undefined,
    },
    orderBy: { createdAt: "desc" },
  });

  return records.map((record) => ({
    id: record.id,
    tenantSlug,
    email: record.email,
    role: record.role as TenantRole,
    locale: record.locale as LocaleCode,
    status: record.acceptedAt ? "ACCEPTED" : "INVITED",
    token: null,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    acceptedAt: record.acceptedAt ? record.acceptedAt.toISOString() : null,
    acceptedByUserId: record.acceptedByUserId || null,
  }));
}

export async function createPlatformTenantInvitation(
  tenantSlug: string,
  request: PlatformInvitationCreateRequest,
): Promise<PlatformInvitationSummary> {
  const prisma = getPrismaClient();
  const email = ensureEmail(request.email);
  if (!prisma) {
    const tenant = getDevTenantBySlug(tenantSlug);
    if (!tenant) {
      throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    }
    if (getDevTenantUserByEmail(email)) {
      throw new RouteError(409, "INVITE_USER_EXISTS", "User already exists.");
    }
    try {
      const record = createDevInvitation({
        tenantSlug: tenant.slug,
        email,
        role: request.role,
        locale: request.locale,
      });
      return toSummaryFromDev(record);
    } catch (error) {
      if (String(error).includes("INVITATION_ALREADY_EXISTS")) {
        throw new RouteError(409, "INVITE_ALREADY_EXISTS", "Invitation already exists.");
      }
      throw error;
    }
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  }
  // email ya no es único en User; findFirst para no romper tipos. La invitación
  // crea un alta nueva, así que un email ya existente se trata como conflicto.
  const existingUser = await prisma.user.findFirst({ where: { email } });
  if (existingUser) {
    throw new RouteError(409, "INVITE_USER_EXISTS", "User already exists.");
  }

  const token = `invite-${randomBytes(32).toString("hex")}`;
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invitation = await prisma.userInvitation.create({
    data: {
      tenantId: tenant.id,
      email,
      role: request.role,
      locale: request.locale,
      tokenHash,
      expiresAt,
    },
  });

  return {
    id: invitation.id,
    tenantSlug,
    email,
    role: request.role,
    locale: request.locale,
    status: "INVITED",
    token,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.acceptedAt ? invitation.acceptedAt.toISOString() : null,
    acceptedByUserId: invitation.acceptedByUserId || null,
  };
}
