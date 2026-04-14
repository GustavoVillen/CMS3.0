import type { LocaleCode } from "@pms-saas/shared-types";
import { RouteError } from "../../http/route-error";
import { hashPassword, hashOpaqueToken } from "../../platform/auth/passwords";
import { getPrismaClient } from "../../platform/data/prisma-client";
import {
  acceptDevInvitation,
  getDevInvitationByToken,
} from "../../platform/data/dev-invitation-store";
import {
  createDevTenantUser,
  getDevTenantUserByEmail,
  getDevTenantUserByLegacyId,
} from "../../platform/data/dev-tenant-user-store";

export interface InvitationAcceptRequest {
  token: string;
  password: string;
  firstName: string;
  lastName: string;
  legacyUserId?: string | null;
  preferredLocale?: LocaleCode;
}

export interface InvitationAcceptResponse {
  tenantSlug: string;
  userId: string;
  email: string;
  role: string;
}

function ensureRequired(value: string, code: string, message: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new RouteError(400, code, message);
  }
  return normalized;
}

function ensurePassword(value: string): string {
  const normalized = String(value || "");
  if (normalized.length < 6) {
    throw new RouteError(400, "INVITE_PASSWORD_WEAK", "Password must be at least 6 characters.");
  }
  return normalized;
}

export async function acceptTenantInvitation(
  tenantSlug: string,
  request: InvitationAcceptRequest,
): Promise<InvitationAcceptResponse> {
  const token = ensureRequired(request.token, "INVITE_TOKEN_REQUIRED", "Invitation token is required.");
  const password = ensurePassword(request.password);
  const firstName = ensureRequired(request.firstName, "INVITE_FIRST_NAME_REQUIRED", "First name is required.");
  const lastName = ensureRequired(request.lastName, "INVITE_LAST_NAME_REQUIRED", "Last name is required.");

  const prisma = getPrismaClient();
  if (!prisma) {
    const invite = getDevInvitationByToken(token);
    if (!invite) {
      throw new RouteError(404, "INVITE_NOT_FOUND", "Invitation not found.");
    }
    if (invite.tenantSlug !== tenantSlug) {
      throw new RouteError(403, "INVITE_TENANT_MISMATCH", "Invitation does not match tenant.");
    }
    if (invite.status !== "INVITED") {
      throw new RouteError(409, "INVITE_NOT_ACTIVE", "Invitation is not active.");
    }
    if (new Date(invite.expiresAt) <= new Date()) {
      acceptDevInvitation(token, "system");
      throw new RouteError(409, "INVITE_EXPIRED", "Invitation has expired.");
    }
    if (getDevTenantUserByEmail(invite.email)) {
      throw new RouteError(409, "INVITE_USER_EXISTS", "User already exists.");
    }
    if (request.legacyUserId && getDevTenantUserByLegacyId(request.legacyUserId)) {
      throw new RouteError(409, "INVITE_USER_EXISTS", "Legacy user id already exists.");
    }

    const user = createDevTenantUser({
      tenantSlug: invite.tenantSlug,
      email: invite.email,
      legacyUserId: request.legacyUserId ?? null,
      passwordHash: hashPassword(password),
      preferredLocale: request.preferredLocale || invite.locale,
      firstName,
      lastName,
      role: invite.role,
      assignedVesselCodes: [],
      userStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
    });
    acceptDevInvitation(token, user.id);
    return {
      tenantSlug: invite.tenantSlug,
      userId: user.id,
      email: user.email,
      role: user.role,
    };
  }

  const tokenHash = hashOpaqueToken(token);
  const invitation = await prisma.userInvitation.findFirst({
    where: {
      tokenHash,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
      tenant: { slug: tenantSlug },
    },
    include: { tenant: true },
  });
  if (!invitation) {
    throw new RouteError(404, "INVITE_NOT_FOUND", "Invitation not found.");
  }

  const existing = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (existing) {
    throw new RouteError(409, "INVITE_USER_EXISTS", "User already exists.");
  }
  if (request.legacyUserId) {
    const legacy = await prisma.user.findUnique({ where: { legacyUserId: request.legacyUserId } });
    if (legacy) {
      throw new RouteError(409, "INVITE_USER_EXISTS", "Legacy user id already exists.");
    }
  }

  const preferredLocale = request.preferredLocale || invitation.locale || null;

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: invitation.email,
        legacyUserId: request.legacyUserId || null,
        passwordHash: hashPassword(password),
        status: "ACTIVE",
        preferredLocale,
        firstName,
        lastName,
        memberships: {
          create: {
            tenantId: invitation.tenantId,
            role: invitation.role,
            status: "ACTIVE",
            assignedVesselCodes: [],
          },
        },
      },
    });

    await tx.userInvitation.update({
      where: { id: invitation.id },
      data: {
        acceptedAt: new Date(),
        acceptedByUserId: created.id,
      },
    });

    return created;
  });

  return {
    tenantSlug: invitation.tenant.slug,
    userId: user.id,
    email: user.email,
    role: invitation.role,
  };
}
