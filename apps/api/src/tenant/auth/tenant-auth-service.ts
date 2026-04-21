import type { TenantLoginRequest, TenantLoginResponse, TenantRefreshRequest, TenantRefreshResponse } from "./auth-types";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getDevTenantUserByIdentifier } from "../../platform/data/dev-tenant-user-store";
import { verifyPassword, hashOpaqueToken } from "../../platform/auth/passwords";
import { issueOpaqueSessionTokens } from "../../platform/auth/tokens";
import { RouteError } from "../../http/route-error";
import { buildTenantBootstrapPayload } from "../bootstrap/public-bootstrap";
import { resolveActiveSessionLocale } from "../i18n/locale-resolution";
import { TENANT_AUTH_POLICY } from "./auth-policies";

function isDevelopmentMode(): boolean {
  return String(process.env.NODE_ENV || "development").trim().toLowerCase() === "development";
}

function loginTenantUserFromDevelopmentFallback(
  tenantSlug: string,
  request: TenantLoginRequest,
): TenantLoginResponse {
  const identifier = String(request.identifier || "").trim();
  const password = String(request.password || "");

  const match = getDevTenantUserByIdentifier(tenantSlug, identifier);

  if (
    !match ||
    match.userStatus !== "ACTIVE" ||
    match.membershipStatus !== "ACTIVE" ||
    !verifyPassword(password, match.passwordHash)
  ) {
    throw new RouteError(401, "AUTH_INVALID_CREDENTIALS", "Invalid credentials.");
  }

  const locale = resolveActiveSessionLocale({
    requestedLocale: request.locale,
      preferredLocale: match.preferredLocale,
    defaultLocale: "es",
    enabledLocales: ["es", "en", "pt"],
  });

  const tokens = issueOpaqueSessionTokens();

  return {
    session: tokens,
    user: {
      id: match.id,
      email: match.email,
      firstName: match.firstName,
      lastName: match.lastName,
      role: match.role,
      assignedVesselCodes: match.assignedVesselCodes,
      locale,
    },
    bootstrap: buildTenantBootstrapPayload(
      {
        slug: tenantSlug,
        displayName: "Demo Tenant",
        logoUrl: null,
        primaryColor: "#2563eb",
        supportEmail: "support@demo.local",
        defaultLocale: "es",
        enabledLocales: ["es", "en", "pt"],
        timezone: "America/Argentina/Buenos_Aires",
        currency: "USD",
      },
      {
        requestedLocale: locale,
        preferredLocale: locale,
      },
    ),
  };
}

async function loginVesselCrew(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenant: { id: string; slug: string; settings: any },
  vesselCode: string,
  password: string,
  requestedLocale?: string | null,
): Promise<TenantLoginResponse> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; code: string; name: string; crewPasswordHash: string | null;
  }>>(
    `SELECT "id", "code", "name", "crewPasswordHash" FROM "Vessel"
     WHERE "tenantId" = $1 AND UPPER("code") = UPPER($2) AND "deletedAt" IS NULL LIMIT 1`,
    tenant.id, vesselCode,
  );

  if (!rows.length || !rows[0].crewPasswordHash) {
    throw new RouteError(401, "AUTH_INVALID_CREDENTIALS", "Invalid credentials.");
  }

  if (!verifyPassword(password, rows[0].crewPasswordHash)) {
    throw new RouteError(401, "AUTH_INVALID_CREDENTIALS", "Invalid credentials.");
  }

  const vessel = rows[0];
  const locale = resolveActiveSessionLocale({
    requestedLocale: requestedLocale,
    preferredLocale: null,
    defaultLocale: tenant.settings?.defaultLocale ?? "es",
    enabledLocales: tenant.settings?.enabledLocales ?? ["es"],
  });

  const tokens = issueOpaqueSessionTokens();

  return {
    session: tokens,
    user: {
      id: `crew-${vessel.code}`,
      email: `tripulacion@${vessel.code.toLowerCase()}.vessel`,
      firstName: `Tripulación`,
      lastName: vessel.name,
      role: "TECHNICIAN_OPERATOR",
      assignedVesselCodes: [vessel.code],
      locale,
    },
    bootstrap: buildTenantBootstrapPayload(
      {
        slug: tenant.slug,
        displayName: tenant.settings?.displayName ?? tenant.slug,
        logoUrl: tenant.settings?.logoUrl ?? null,
        primaryColor: tenant.settings?.primaryColor ?? "#2563eb",
        supportEmail: tenant.settings?.supportEmail ?? "",
        defaultLocale: tenant.settings?.defaultLocale ?? "es",
        enabledLocales: tenant.settings?.enabledLocales ?? ["es"],
        timezone: tenant.settings?.timezone ?? "UTC",
        currency: tenant.settings?.currency ?? "USD",
      },
      { requestedLocale: locale, preferredLocale: locale },
    ),
  };
}

export async function loginTenantUser(tenantSlug: string, request: TenantLoginRequest): Promise<TenantLoginResponse> {
  const prisma = getPrismaClient();
  if (!prisma) {
    if (isDevelopmentMode()) {
      return loginTenantUserFromDevelopmentFallback(tenantSlug, request);
    }

    throw new RouteError(503, "DATABASE_NOT_CONFIGURED", "Tenant auth requires a configured database connection.");
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      include: { settings: true },
    });

    if (!tenant || !tenant.settings) {
      throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    }

    const identifier = String(request.identifier || "").trim();
    const password = String(request.password || "");

    if (!identifier || !password) {
      throw new RouteError(400, "AUTH_INVALID_REQUEST", "Identifier and password are required.");
    }

    const membership = await prisma.tenantMembership.findFirst({
      where: {
        tenantId: tenant.id,
        status: "ACTIVE",
        user: {
          OR: [{ email: identifier }, { legacyUserId: identifier }],
        },
      },
      include: {
        user: true,
      },
    });

    // Try vessel crew login if no user membership found
    if (!membership || membership.user.status !== "ACTIVE") {
      return await loginVesselCrew(prisma, tenant, identifier, password, request.locale);
    }

    if (!verifyPassword(password, membership.user.passwordHash)) {
      return await loginVesselCrew(prisma, tenant, identifier, password, request.locale);
    }

    const locale = resolveActiveSessionLocale({
      requestedLocale: request.locale,
      preferredLocale: membership.user.preferredLocale,
      defaultLocale: tenant.settings.defaultLocale,
      enabledLocales: tenant.settings.enabledLocales,
    });

    const tokens = issueOpaqueSessionTokens();

    await prisma.refreshToken.create({
      data: {
        userId: membership.user.id,
        tenantId: tenant.id,
        refreshTokenHash: hashOpaqueToken(tokens.refreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      session: tokens,
      user: {
        id: membership.user.id,
        email: membership.user.email,
        firstName: membership.user.firstName,
        lastName: membership.user.lastName,
        role: membership.role,
        assignedVesselCodes: membership.assignedVesselCodes,
        locale,
      },
      bootstrap: buildTenantBootstrapPayload(
        {
          slug: tenant.slug,
          displayName: tenant.settings.displayName,
          logoUrl: tenant.settings.logoUrl,
          primaryColor: tenant.settings.primaryColor,
          supportEmail: tenant.settings.supportEmail,
          defaultLocale: tenant.settings.defaultLocale,
          enabledLocales: tenant.settings.enabledLocales,
          timezone: tenant.settings.timezone,
          currency: tenant.settings.currency,
        },
        {
          requestedLocale: locale,
          preferredLocale: locale,
        },
      ),
    };
  } catch (error) {
    if (isDevelopmentMode()) {
      return loginTenantUserFromDevelopmentFallback(tenantSlug, request);
    }

    throw error;
  }
}

export async function refreshTenantSession(
  tenantSlug: string,
  request: TenantRefreshRequest,
): Promise<TenantRefreshResponse> {
  const prisma = getPrismaClient();
  if (!prisma) {
    if (isDevelopmentMode()) {
      if (!String(request.refreshToken || "").trim()) {
        throw new RouteError(401, "AUTH_REFRESH_INVALID", "Refresh token is invalid or expired.");
      }

      return {
        session: issueOpaqueSessionTokens(),
      };
    }

    throw new RouteError(503, "DATABASE_NOT_CONFIGURED", "Tenant auth requires a configured database connection.");
  }

  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    }

    const incomingHash = hashOpaqueToken(String(request.refreshToken || ""));
    const existing = await prisma.refreshToken.findFirst({
      where: {
        tenantId: tenant.id,
        refreshTokenHash: incomingHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!existing) {
      throw new RouteError(401, "AUTH_REFRESH_INVALID", "Refresh token is invalid or expired.");
    }

    const tokens = issueOpaqueSessionTokens();

    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      }),
      prisma.refreshToken.create({
        data: {
          userId: existing.userId,
          tenantId: existing.tenantId,
          refreshTokenHash: hashOpaqueToken(tokens.refreshToken),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    return {
      session: tokens,
    };
  } catch (error) {
    if (isDevelopmentMode()) {
      if (!String(request.refreshToken || "").trim()) {
        throw new RouteError(401, "AUTH_REFRESH_INVALID", "Refresh token is invalid or expired.");
      }

      return {
        session: issueOpaqueSessionTokens(),
      };
    }

    throw error;
  }
}

export function getTenantAuthPolicy() {
  return TENANT_AUTH_POLICY;
}
