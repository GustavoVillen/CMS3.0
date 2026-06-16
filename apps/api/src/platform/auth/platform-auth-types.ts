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
  };
  context: {
    kind: TenantResolutionKind;
  };
}
