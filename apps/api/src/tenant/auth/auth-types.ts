import type { LocaleCode, TenantBootstrapPayload, TenantRole } from "@cms3/shared-types";

export interface TenantLoginRequest {
  identifier: string;
  password: string;
  locale?: string | null;
}

export interface TenantRefreshRequest {
  refreshToken: string;
}

/**
 * De dónde vino el pedido: lo llena el router desde el request HTTP y se guarda
 * en el RefreshToken y en el audit del login, para la consola de accesos del
 * SUPERADMIN. Es informativo — nunca condiciona la autenticación.
 */
export interface RequestOrigin {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface TenantSessionUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: TenantRole;
  assignedVesselCodes: string[];
  locale: LocaleCode;
}

export interface TenantLoginResponse {
  session: {
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
  };
  user: TenantSessionUser;
  bootstrap: TenantBootstrapPayload;
}

export interface TenantRefreshResponse {
  session: {
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
  };
  userId?: string;
}
