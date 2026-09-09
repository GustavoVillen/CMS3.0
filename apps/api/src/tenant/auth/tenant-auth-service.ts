import type { RequestOrigin, TenantLoginRequest, TenantLoginResponse, TenantRefreshRequest, TenantRefreshResponse } from "./auth-types";
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
import { loadLiveMembership } from "./live-session-guard";
import { revokeTenantSessionsForUser } from "./session-store";

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

export async function loginTenantUser(
  tenantSlug: string,
  request: TenantLoginRequest,
  origin: RequestOrigin = { ipAddress: null, userAgent: null },
): Promise<TenantLoginResponse> {
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
        metadata: {
          tenantSlug: tenant.slug,
          identifierHash: redactEmail(identifier),
          ip: origin.ipAddress,
          userAgent: origin.userAgent,
        },
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
        ipAddress: origin.ipAddress,
        userAgent: origin.userAgent,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    await publishAudit(prisma, {
      tenantId: tenant.id,
      actorUserId: membership.user.id,
      action: "TENANT_LOGIN_SUCCESS",
      entityType: "User",
      entityId: membership.user.id,
      metadata: {
        tenantSlug: tenant.slug,
        email: membership.user.email,
        role: membership.role,
        ip: origin.ipAddress,
        userAgent: origin.userAgent,
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
          logoUrlLight: tenant.settings.logoUrlLight ?? null,
          primaryColor: tenant.settings.primaryColor,
          supportEmail: tenant.settings.supportEmail,
          defaultLocale: tenant.settings.defaultLocale,
          enabledLocales: tenant.settings.enabledLocales,
          timezone: tenant.settings.timezone,
          currency: tenant.settings.currency,
          // Faltaba: el front lo usa para saber si el tenant usa el formulario
          // controlado de Mercurio (campos del form + plantilla del PDF). Sin
          // esto llegaba null y esos campos no se mostraban nunca.
          workOrderPdfTemplate: (tenant.settings as any).workOrderPdfTemplate ?? null,
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

    // AUDITORIA 2026-09-09 - la renovacion no puede devolver accesos revocados.
    // Antes rotaba el token sin mirar nada mas: alguien dado de baja, suspendido
    // o con el usuario global deshabilitado seguia renovando indefinidamente.
    // Ahora se revalida la membership y, si ya no puede operar, se revoca ESE
    // refresh token (no solo se rechaza) para que la cadena termine aca.
    const live = await loadLiveMembership(tenantSlug, existing.userId);
    if (!live) {
      await prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
      throw new RouteError(
        401,
        "AUTH_SESSION_REVOKED",
        "Tu acceso a esta empresa fue dado de baja o suspendido. Volve a iniciar sesion.",
      );
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

/**
 * Corta el acceso de un usuario a un tenant AHORA: revoca todos sus refresh
 * tokens en la base (efecto en todas las instancias — sin refresh no hay
 * renovación) y borra sus sesiones vivas del Map de este proceso.
 *
 * Se llama al cambiarle la contraseña o al darlo de baja del equipo.
 *
 * @param exceptRefreshToken  refresh token en claro que NO hay que revocar.
 * @param exceptAccessToken   access token que NO hay que sacar del Map.
 *        Los usa el cambio de contraseña hecho por el propio usuario: cierra
 *        las demás sesiones sin echarse a sí mismo de la que está usando.
 * @returns cuántos refresh tokens quedaron revocados.
 *
 * LÍMITE: un access token ya emitido en OTRA instancia sigue sirviendo hasta
 * vencer (15 min como máximo), porque el registro de access tokens es por
 * proceso. La baja y la suspensión sí cortan de inmediato en todas las
 * instancias, porque las detecta `enforceLiveTenantSession` contra la base.
 */
export async function revokeUserTenantCredentials(
  tenantSlug: string,
  userId: string,
  exceptRefreshToken?: string | null,
  exceptAccessToken?: string | null,
): Promise<number> {
  revokeTenantSessionsForUser(tenantSlug, userId, exceptAccessToken);

  const prisma = getPrismaClient();
  if (!prisma) return 0;

  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant) return 0;

    const keepHash = exceptRefreshToken ? hashOpaqueToken(exceptRefreshToken) : null;

    const result = await prisma.refreshToken.updateMany({
      where: {
        tenantId: tenant.id,
        userId,
        revokedAt: null,
        ...(keepHash ? { refreshTokenHash: { not: keepHash } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  } catch {
    // No bloquear la operación de negocio por un fallo al revocar: la
    // revalidación por membership sigue siendo la barrera principal.
    return 0;
  }
}
