import type { LoginMode } from "@cms3/shared-types";
import { PRODUCT_CONFIG } from "@cms3/config";

export interface TenantAuthPolicy {
  loginMode: LoginMode;
  invitationOnly: boolean;
  supportsPasswordReset: boolean;
  requiresEmailVerification: boolean;
}

export const TENANT_AUTH_POLICY: TenantAuthPolicy = {
  loginMode: PRODUCT_CONFIG.tenantLoginMode,
  invitationOnly: true,
  supportsPasswordReset: true,
  requiresEmailVerification: false,
};
