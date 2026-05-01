export type LocaleCode = "es" | "en" | "pt";

export type LoginMode = "email_or_legacy_user_id";

export type TenantRole =
  | "TENANT_ADMIN"
  | "FLEET_SUPERINTENDENT"
  | "MAINTENANCE_MANAGER"
  | "TECHNICIAN_OPERATOR"
  | "INSPECTOR_COMPLIANCE"
  | "PROCUREMENT_STORE"
  | "AUDITOR_READONLY";

export type TenantResolutionKind = "tenant" | "platform" | "unresolved";

export interface TenantPublicIdentity {
  slug: string;
}

export interface TenantBrandingSettings {
  displayName: string;
  logoUrl?: string | null;
  logoUrlLight?: string | null;
  primaryColor?: string | null;
  supportEmail: string;
}

export interface TenantFormattingSettings {
  defaultLocale: LocaleCode;
  enabledLocales: LocaleCode[];
  timezone: string;
  currency: string;
}

export interface TenantBootstrapAuth {
  loginMode: LoginMode;
}

export interface TenantBootstrapPayload {
  tenant: TenantPublicIdentity & TenantBrandingSettings & {
    locale: LocaleCode;
    enabledLocales: LocaleCode[];
    timezone: string;
    currency: string;
  };
  auth: TenantBootstrapAuth;
}

export interface TenantResolutionInput {
  host?: string | null;
  path?: string | null;
  tenantHeader?: string | null;
  tenantQuery?: string | null;
}

export interface TenantResolutionResult {
  kind: TenantResolutionKind;
  source: "subdomain" | "path" | "header" | "query" | "admin_subdomain" | "none";
  tenantSlug: string | null;
}

export interface SessionLocalePreferenceInput {
  requestedLocale?: string | null;
  preferredLocale?: string | null;
  defaultLocale: LocaleCode;
  enabledLocales: LocaleCode[];
}

export interface TenantBootstrapSource {
  slug: string;
  displayName: string;
  logoUrl?: string | null;
  logoUrlLight?: string | null;
  primaryColor?: string | null;
  supportEmail: string;
  defaultLocale: LocaleCode;
  enabledLocales: LocaleCode[];
  timezone: string;
  currency: string;
}
