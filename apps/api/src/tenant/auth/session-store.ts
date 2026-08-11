import type { LocaleCode, TenantRole } from "@cms3/shared-types";

export interface TenantAccessSession {
  kind: "tenant";
  tenantSlug: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  user: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role: TenantRole;
    assignedVesselCodes: string[];
    locale: LocaleCode;
    /**
     * Autorizaciones efectivas del rol (catalogo de `role-permissions.ts`).
     * Se calculan al loguear/refrescar y se refrescan en vivo cuando el admin
     * guarda la matriz, para que los gates de los services sean sincronicos.
     * Opcional: los tokens emitidos antes de este cambio no la traen y el
     * chequeo cae a los defaults del rol.
     */
    permissions?: string[];
  };
}

export interface PlatformAccessSession {
  kind: "platform";
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
}

const tenantSessions = new Map<string, TenantAccessSession>();
const platformSessions = new Map<string, PlatformAccessSession>();

export function registerTenantAccessSession(session: TenantAccessSession): void {
  tenantSessions.set(session.accessToken, session);
}

export function registerPlatformAccessSession(session: PlatformAccessSession): void {
  platformSessions.set(session.accessToken, session);
}

export function getTenantAccessSession(accessToken: string): TenantAccessSession | null {
  const session = tenantSessions.get(accessToken);
  if (!session) return null;
  if (new Date(session.accessTokenExpiresAt).getTime() <= Date.now()) {
    tenantSessions.delete(accessToken);
    return null;
  }
  return session;
}

export function getPlatformAccessSession(accessToken: string): PlatformAccessSession | null {
  const session = platformSessions.get(accessToken);
  if (!session) return null;
  if (new Date(session.accessTokenExpiresAt).getTime() <= Date.now()) {
    platformSessions.delete(accessToken);
    return null;
  }
  return session;
}

/**
 * Periodic cleanup — removes expired sessions from the in-memory Maps to
 * prevent unbounded growth. Tokens are also lazily evicted in get*() above,
 * so this is a safety net for tokens that are issued but never queried again.
 */
export function evictExpiredSessions(): void {
  const now = Date.now();
  for (const [token, s] of tenantSessions) {
    if (new Date(s.accessTokenExpiresAt).getTime() <= now) tenantSessions.delete(token);
  }
  for (const [token, s] of platformSessions) {
    if (new Date(s.accessTokenExpiresAt).getTime() <= now) platformSessions.delete(token);
  }
}

/**
 * Reaplica la matriz de autorizaciones a TODAS las sesiones vivas del tenant.
 * Se llama cuando el admin guarda Permisos por rol: el cambio impacta en la
 * proxima accion del usuario, sin obligarlo a volver a loguearse.
 */
export function refreshTenantSessionPermissions(
  tenantSlug: string,
  matrix: Record<string, string[]>,
): number {
  let updated = 0;
  for (const session of tenantSessions.values()) {
    if (session.tenantSlug !== tenantSlug) continue;
    const next = matrix[session.user.role];
    if (!next) continue;
    session.user.permissions = [...next];
    updated += 1;
  }
  return updated;
}

/** Logout: borra el access token del Map en memoria. */
export function revokeTenantAccessSession(accessToken: string): void {
  tenantSessions.delete(accessToken);
}

export function revokePlatformAccessSession(accessToken: string): void {
  platformSessions.delete(accessToken);
}
