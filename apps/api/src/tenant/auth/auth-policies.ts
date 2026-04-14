import type { LoginMode } from "@pms-saas/shared-types";
import { PRODUCT_CONFIG } from "@pms-saas/config";

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
