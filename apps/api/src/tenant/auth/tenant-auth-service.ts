import type { TenantLoginRequest, TenantLoginResponse, TenantRefreshRequest, TenantRefreshResponse } from "./auth-types";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getDevTenantUserByIdentifier } from "../../platform/data/dev-tenant-user-store";
import { verifyPassword, verifyPasswordOrTimingDummy, hashOpaqueToken } from "../../platform/auth/passwords";
import { issueOpaqueSessionTokens } from "../../platform/auth/tokens";
import { RouteError } from "../../http/route-error";
import { buildTenantBootstrapPayload } from "../bootstrap/public-bootstrap";
import { resolveActiveSessionLocale } from "../i18n/locale-resolution";
import { TENANT_AUTH_POLICY } from "./auth-policies";
import { publishAudit, publishSystemAudit } from "../../platform/audit/audit-publisher";
import { redactEmail } from "../../common/pii";
import { assertNotLocked, recordLoginFailure, clearLoginFailures } from "../../http/login-lockout";

import { isDevelopmentMode } from "../../common/runtime-mode";

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

    // Lockout por identificador — defensa contra brute force distribuido
    // (botnet con muchas IPs ataca a una sola cuenta).
    assertNotLocked(`tenant:${tenant.slug}`, identifier);

    // El email ya NO es único: puede haber varios Users activos con el mismo
    // email en el tenant (buzón funcional compartido). Por eso traemos TODOS
    // los candidatos que matchean el identificador y autenticamos a aquel cuya
    // contraseña coincide. El legacyUserId (username) sigue siendo único, así
    // que el login por usuario siempre resuelve a un único candidato.
    const candidates = await prisma.tenantMembership.findMany({
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

    let membership: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (candidate.user.status !== "ACTIVE") continue;
      if (verifyPassword(password, candidate.user.passwordHash)) {
        membership = candidate;
        break;
      }
    }

    // Si ningún candidato coincide, corremos un scrypt dummy para no filtrar por
    // timing si el identificador no existía en absoluto.
    if (!membership) {
      verifyPasswordOrTimingDummy(password, null);
    }

    // Si la membership falla, no hay fallback. (El login de tripulación con
    // vesselCode + password fue eliminado — las tripulaciones ahora son Users
    // normales gestionados desde "Gestión del Equipo".)
    if (!membership) {
      // All paths failed. Single audit event with neutral metadata
      // (don't reveal which path got how far — keep response identical).
      recordLoginFailure(`tenant:${tenant.slug}`, identifier);
      await publishSystemAudit(prisma, {
        tenantId: tenant.id,
        action: "TENANT_LOGIN_FAILED",
        entityType: "Tenant",
        entityId: tenant.id,
        metadata: { tenantSlug: tenant.slug, identifierHash: redactEmail(identifier) },
      });
      throw new RouteError(401, "AUTH_INVALID_CREDENTIALS", "Invalid credentials.");
    }

    clearLoginFailures(`tenant:${tenant.slug}`, identifier);

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

    await publishAudit(prisma, {
      tenantId: tenant.id,
      actorUserId: membership.user.id,
      action: "TENANT_LOGIN_SUCCESS",
      entityType: "User",
      entityId: membership.user.id,
      metadata: { tenantSlug: tenant.slug, email: membership.user.email, role: membership.role },
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
          logoUrlLight: tenant.settings.logoUrlLight ?? null,
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
      // userId expuesto para que el router pueda re-registrar la sesión
      // en memoria (tenantSessions Map) — sin esto, el access token nuevo
      // emitido aquí no resuelve a una sesión válida y el primer request
      // post-refresh devuelve 401 → logout.
      userId: existing.userId,
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

/**
 * Revoca un refresh token (logout). Marca el row como revoked en DB para que
 * no se pueda usar para emitir nuevos access tokens. Idempotente: si el token
 * no existe o ya está revocado, no hace nada y devuelve OK igual (no leak de
 * "token válido vs no").
 *
 * El access token vigente sigue funcionando hasta su expiración (15 min) —
 * es por diseño de tokens opacos sin DB-roundtrip por request. El cliente
 * debe descartarlo localmente.
 */
export async function logoutTenantSession(
  tenantSlug: string,
  refreshToken: string,
): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) return; // dev sin DB: nada que revocar

  const incomingHash = hashOpaqueToken(String(refreshToken || ""));
  if (!incomingHash) return;

  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) return;

    await prisma.refreshToken.updateMany({
      where: {
        tenantId: tenant.id,
        refreshTokenHash: incomingHash,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  } catch { /* swallow — logout siempre exitoso desde la perspectiva del cliente */ }
}

export function getTenantAuthPolicy() {
  return TENANT_AUTH_POLICY;
}
