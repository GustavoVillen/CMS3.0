import { randomBytes } from "node:crypto";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { hashPassword, verifyPassword } from "../../platform/auth/passwords";
import { RouteError } from "../../http/route-error";

// ─── Dev mode in-memory store ─────────────────────────────────────────────────

interface DevCrewCredential {
  vesselId: string;
  vesselCode: string;
  tenantSlug: string;
  passwordHash: string;
  updatedAt: string;
}

const DEV_CREW_CREDENTIALS: DevCrewCredential[] = [];

// ─── Service ──────────────────────────────────────────────────────────────────

import { isDevelopmentMode as isDev } from "../../common/runtime-mode";

export async function getCrewCredentials(session: TenantAccessSession, vesselId: string) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden ver credenciales.");
  }

  const prisma = getPrismaClient();

  if (!prisma) {
    const cred = DEV_CREW_CREDENTIALS.find(c => c.vesselId === vesselId && c.tenantSlug === session.tenantSlug);
    return { hasPassword: !!cred, updatedAt: cred?.updatedAt ?? null };
  }

  const tenantId = await getTenantId(prisma, session.tenantSlug);
  const vessel = await prisma.vessel.findFirst({
    where: { id: vesselId, tenantId, deletedAt: null },
    select: { crewPasswordHash: true, crewPasswordUpdatedAt: true },
  });
  if (!vessel) throw new RouteError(404, "NOT_FOUND", "Vessel no encontrado.");

  return {
    hasPassword: !!vessel.crewPasswordHash,
    updatedAt: vessel.crewPasswordUpdatedAt?.toISOString() ?? null,
  };
}

export async function setCrewPassword(
  session: TenantAccessSession,
  vesselId: string,
  vesselCode: string,
  password: string,
) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden configurar credenciales.");
  }
  if (!password || password.length < 4) {
    throw new RouteError(400, "PASSWORD_TOO_SHORT", "La contraseña debe tener al menos 4 caracteres.");
  }

  const prisma = getPrismaClient();
  const now = new Date().toISOString();

  if (!prisma) {
    const hash = `plain$${password}`;
    const existing = DEV_CREW_CREDENTIALS.findIndex(c => c.vesselId === vesselId && c.tenantSlug === session.tenantSlug);
    if (existing >= 0) {
      DEV_CREW_CREDENTIALS[existing].passwordHash = hash;
      DEV_CREW_CREDENTIALS[existing].updatedAt = now;
    } else {
      DEV_CREW_CREDENTIALS.push({ vesselId, vesselCode, tenantSlug: session.tenantSlug, passwordHash: hash, updatedAt: now });
    }
    return { ok: true, updatedAt: now };
  }

  const tenantId = await getTenantId(prisma, session.tenantSlug);
  // updateMany returns count — atomic check-and-update scoped to id+tenantId.
  // If 0 rows match, the vessel doesn't exist in this tenant → 404.
  // Eliminates the prior SELECT-then-UPDATE race and closes M-01 (UPDATE
  // previously had no tenantId in WHERE).
  const result = await prisma.vessel.updateMany({
    where: { id: vesselId, tenantId, deletedAt: null },
    data: {
      crewPasswordHash: hashPassword(password),
      crewPasswordUpdatedAt: new Date(),
    },
  });
  if (result.count === 0) throw new RouteError(404, "NOT_FOUND", "Vessel no encontrado.");

  const { publishAudit } = await import("../../platform/audit/audit-publisher");
  await publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "VESSEL_CREW_PASSWORD_CHANGED",
    entityType: "Vessel",
    entityId: vesselId,
    metadata: { tenantSlug: session.tenantSlug, vesselCode },
  });

  return { ok: true, updatedAt: now };
}

async function getTenantId(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, slug: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}
