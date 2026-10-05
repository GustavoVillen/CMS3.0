import type { TenantResolutionKind } from "@cms3/shared-types";

export interface PlatformLoginRequest {
  email: string;
  password: string;
}

export interface PlatformRefreshRequest {
  refreshToken: string;
}

export interface PlatformLoginResponse {
  session: {
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
  };
  user: {
    id: string;
    email: string;
    role: string;
    firstName?: string | null;
    lastName?: string | null;
  };
  context: {
    kind: TenantResolutionKind;
  };
}
