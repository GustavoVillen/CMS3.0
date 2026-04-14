import type { TenantBootstrapPayload, TenantBootstrapSource } from "@pms-saas/shared-types";
import { PRODUCT_CONFIG } from "@pms-saas/config";
import { resolveActiveSessionLocale } from "../i18n/locale-resolution";

export interface BuildTenantBootstrapOptions {
  requestedLocale?: string | null;
  preferredLocale?: string | null;
}

export function buildTenantBootstrapPayload(
  tenant: TenantBootstrapSource,
  options: BuildTenantBootstrapOptions = {},
): TenantBootstrapPayload {
  const locale = resolveActiveSessionLocale({
    requestedLocale: options.requestedLocale,
    preferredLocale: options.preferredLocale,
    defaultLocale: tenant.defaultLocale,
    enabledLocales: tenant.enabledLocales,
  });

  return {
    tenant: {
      slug: tenant.slug,
      displayName: tenant.displayName,
      logoUrl: tenant.logoUrl ?? null,
      primaryColor: tenant.primaryColor ?? null,
      supportEmail: tenant.supportEmail,
      locale,
      enabledLocales: tenant.enabledLocales,
      timezone: tenant.timezone,
      currency: tenant.currency,
    },
    auth: {
      loginMode: PRODUCT_CONFIG.tenantLoginMode,
    },
  };
}
