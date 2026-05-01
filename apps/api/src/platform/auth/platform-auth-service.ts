import type { PlatformLoginRequest, PlatformLoginResponse, PlatformRefreshRequest } from "./platform-auth-types";
import { getPrismaClient } from "../data/prisma-client";
import { getDevPlatformUserByEmail } from "../data/dev-platform-user-store";
import { RouteError } from "../../http/route-error";
import { verifyPassword, hashOpaqueToken } from "./passwords";
import { issueOpaqueSessionTokens } from "./tokens";
import { publishPlatformAudit, publishSystemAudit } from "../audit/audit-publisher";

function isDevelopmentMode(): boolean {
  return String(process.env.NODE_ENV || "development").trim().toLowerCase() === "development";
}

function loginPlatformUserFromDevelopmentFallback(request: PlatformLoginRequest): PlatformLoginResponse {
  const email = String(request.email || "").trim();
  const password = String(request.password || "");
  const match = getDevPlatformUserByEmail(email);

  if (!match || !verifyPassword(password, match.passwordHash) || match.status !== "ACTIVE") {
    throw new RouteError(401, "AUTH_INVALID_CREDENTIALS", "Invalid credentials.");
  }

  return {
    session: issueOpaqueSessionTokens(),
    user: {
      id: match.id,
      email: match.email,
      role: match.role,
    },
    context: {
      kind: "platform",
    },
  };
}

export async function loginPlatformUser(request: PlatformLoginRequest): Promise<PlatformLoginResponse> {
  const prisma = getPrismaClient();
  if (!prisma) {
    if (isDevelopmentMode()) {
      return loginPlatformUserFromDevelopmentFallback(request);
    }

    throw new RouteError(503, "DATABASE_NOT_CONFIGURED", "Platform auth requires a configured database connection.");
  }

  try {
    const email = String(request.email || "").trim();
    const password = String(request.password || "");
    if (!email || !password) {
      throw new RouteError(400, "AUTH_INVALID_REQUEST", "Email and password are required.");
    }

    const user = await prisma.platformUser.findUnique({ where: { email } });
    if (!user || user.status !== "ACTIVE") {
      await publishSystemAudit(prisma, {
        action: "PLATFORM_LOGIN_FAILED",
        entityType: "PlatformUser",
        entityId: null,
        metadata: { email, reason: user ? "user_inactive" : "user_not_found" },
      });
      throw new RouteError(401, "AUTH_INVALID_CREDENTIALS", "Invalid credentials.");
    }

    if (!verifyPassword(password, user.passwordHash)) {
      await publishSystemAudit(prisma, {
        action: "PLATFORM_LOGIN_FAILED",
        entityType: "PlatformUser",
        entityId: user.id,
        metadata: { email, reason: "wrong_password" },
      });
      throw new RouteError(401, "AUTH_INVALID_CREDENTIALS", "Invalid credentials.");
    }

    const tokens = issueOpaqueSessionTokens();

    await prisma.platformSession.create({
      data: {
        platformUserId: user.id,
        refreshTokenHash: hashOpaqueToken(tokens.refreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    await publishPlatformAudit(prisma, {
      actorPlatformUserId: user.id,
      action: "PLATFORM_LOGIN_SUCCESS",
      entityType: "PlatformUser",
      entityId: user.id,
      metadata: { email: user.email, role: user.role },
    });

    return {
      session: tokens,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      context: {
        kind: "platform",
      },
    };
  } catch (error) {
    if (isDevelopmentMode()) {
      return loginPlatformUserFromDevelopmentFallback(request);
    }

    throw error;
  }
}

export async function refreshPlatformSession(request: PlatformRefreshRequest): Promise<PlatformLoginResponse["session"]> {
  const prisma = getPrismaClient();
  if (!prisma) {
    if (isDevelopmentMode()) {
      if (!String(request.refreshToken || "").trim()) {
        throw new RouteError(401, "AUTH_REFRESH_INVALID", "Refresh token is invalid or expired.");
      }

      return issueOpaqueSessionTokens();
    }

    throw new RouteError(503, "DATABASE_NOT_CONFIGURED", "Platform auth requires a configured database connection.");
  }

  try {
    const incomingHash = hashOpaqueToken(String(request.refreshToken || ""));
    const existing = await prisma.platformSession.findFirst({
      where: {
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
      prisma.platformSession.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      }),
      prisma.platformSession.create({
        data: {
          platformUserId: existing.platformUserId,
          refreshTokenHash: hashOpaqueToken(tokens.refreshToken),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    return tokens;
  } catch (error) {
    if (isDevelopmentMode()) {
      if (!String(request.refreshToken || "").trim()) {
        throw new RouteError(401, "AUTH_REFRESH_INVALID", "Refresh token is invalid or expired.");
      }

      return issueOpaqueSessionTokens();
    }

    throw error;
  }
}
