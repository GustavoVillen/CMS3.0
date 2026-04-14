import type { LocaleCode, TenantRole } from "@pms-saas/shared-types";

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
  return tenantSessions.get(accessToken) || null;
}

export function getPlatformAccessSession(accessToken: string): PlatformAccessSession | null {
  return platformSessions.get(accessToken) || null;
}
