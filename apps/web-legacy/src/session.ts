// ─── Tenant Session ──────────────────────────────────────────────────────────

export interface TenantSessionUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: string;
  assignedVesselCodes: string[];
  locale: string;
}

export interface TenantSession {
  user: TenantSessionUser;
  tenantSlug: string;
  tenantDisplayName: string;
  tenantPrimaryColor: string;
  tenantLocale: string;
  accessToken: string;
  refreshToken: string;
}

const TENANT_SESSION_KEY = "pms_tenant_session";
const TENANT_TOKEN_KEY   = "pms_tenant_token";

export function getTenantSession(): TenantSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(TENANT_SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as TenantSession; } catch { return null; }
}

export function setTenantSession(session: TenantSession): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TENANT_SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(TENANT_TOKEN_KEY, session.accessToken);
}

export function clearTenantSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TENANT_SESSION_KEY);
  localStorage.removeItem(TENANT_TOKEN_KEY);
}

export function isTenantAuthenticated(): boolean {
  return !!getTenantSession();
}

export function getCurrentLocale(): string {
  return getTenantSession()?.tenantLocale ?? "es";
}

export function getTenantSlug(): string | null {
  return getTenantSession()?.tenantSlug ?? null;
}

// ─── Platform Session ─────────────────────────────────────────────────────────

export interface PlatformSessionUser {
  id: string;
  email: string;
  role: string;
}

export interface PlatformSession {
  user: PlatformSessionUser;
  accessToken: string;
  refreshToken: string;
}

const PLATFORM_SESSION_KEY = "pms_platform_session";
const PLATFORM_TOKEN_KEY   = "pms_platform_token";

export function getPlatformSession(): PlatformSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(PLATFORM_SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as PlatformSession; } catch { return null; }
}

export function setPlatformSession(session: PlatformSession): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PLATFORM_SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(PLATFORM_TOKEN_KEY, session.accessToken);
}

export function clearPlatformSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PLATFORM_SESSION_KEY);
  localStorage.removeItem(PLATFORM_TOKEN_KEY);
}

export function isPlatformAuthenticated(): boolean {
  return !!getPlatformSession();
}

// ─── Compatibility alias ──────────────────────────────────────────────────────
// Legacy page modules use getSession() — maps to the tenant session.
export { getTenantSession as getSession };
