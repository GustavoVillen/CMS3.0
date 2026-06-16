import type { LocaleCode, TenantBootstrapSource } from "@cms3/shared-types";

export type DevTenantStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export interface DevTenantRecord {
  id: string;
  slug: string;
  status: DevTenantStatus;
  displayName: string;
  logoUrl?: string | null;
  logoUrlLight?: string | null;
  primaryColor?: string | null;
  supportEmail: string;
  defaultLocale: LocaleCode;
  enabledLocales: LocaleCode[];
  timezone: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

const DEV_TENANTS: DevTenantRecord[] = [
  {
    id: "dev-tenant-demo",
    slug: "demo",
    status: "ACTIVE",
    displayName: "Demo Tenant",
    logoUrl: null,
    primaryColor: "#2563eb",
    supportEmail: "support@demo.local",
    defaultLocale: "es",
    enabledLocales: ["es", "en", "pt"],
    timezone: "America/Argentina/Buenos_Aires",
    currency: "USD",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
  },
  {
    id: "dev-tenant-operations",
    slug: "operations",
    status: "ACTIVE",
    displayName: "Operations Tenant",
    logoUrl: null,
    primaryColor: "#0ea5e9",
    supportEmail: "support@operations.local",
    defaultLocale: "en",
    enabledLocales: ["es", "en", "pt"],
    timezone: "UTC",
    currency: "USD",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
  },
];

export interface DevTenantCreateInput {
  slug: string;
  status: DevTenantStatus;
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

export interface DevTenantUpdateInput {
  status?: DevTenantStatus;
  displayName?: string;
  logoUrl?: string | null;
  logoUrlLight?: string | null;
  primaryColor?: string | null;
  supportEmail?: string;
  defaultLocale?: LocaleCode;
  enabledLocales?: LocaleCode[];
  timezone?: string;
  currency?: string;
}

export function listDevTenants(filters: { status?: string | null; slug?: string | null } = {}): DevTenantRecord[] {
  return DEV_TENANTS.filter((tenant) => {
    if (filters.status && tenant.status !== filters.status) return false;
    if (filters.slug && tenant.slug !== filters.slug) return false;
    return true;
  });
}

export function getDevTenantBySlug(slug: string): DevTenantRecord | null {
  return DEV_TENANTS.find((tenant) => tenant.slug === slug) || null;
}

export function getDevTenantBootstrapSourceBySlug(slug: string): TenantBootstrapSource | null {
  const tenant = getDevTenantBySlug(slug);
  if (!tenant) return null;

  return {
    slug: tenant.slug,
    displayName: tenant.displayName,
    logoUrl: tenant.logoUrl ?? null,
    primaryColor: tenant.primaryColor ?? null,
    supportEmail: tenant.supportEmail,
    defaultLocale: tenant.defaultLocale,
    enabledLocales: tenant.enabledLocales,
    timezone: tenant.timezone,
    currency: tenant.currency,
  };
}

export function createDevTenant(input: DevTenantCreateInput): DevTenantRecord {
  const now = new Date().toISOString();
  const record: DevTenantRecord = {
    id: `dev-tenant-${input.slug}`,
    slug: input.slug,
    status: input.status,
    displayName: input.displayName,
    logoUrl: input.logoUrl ?? null,
    logoUrlLight: input.logoUrlLight ?? null,
    primaryColor: input.primaryColor ?? null,
    supportEmail: input.supportEmail,
    defaultLocale: input.defaultLocale,
    enabledLocales: [...input.enabledLocales],
    timezone: input.timezone,
    currency: input.currency,
    createdAt: now,
    updatedAt: now,
  };
  DEV_TENANTS.push(record);
  return record;
}

export function updateDevTenant(slug: string, input: DevTenantUpdateInput): DevTenantRecord | null {
  const tenant = DEV_TENANTS.find((record) => record.slug === slug);
  if (!tenant) return null;

  if (input.status) tenant.status = input.status;
  if (input.displayName) tenant.displayName = input.displayName;
  if (input.supportEmail) tenant.supportEmail = input.supportEmail;
  if (input.defaultLocale) tenant.defaultLocale = input.defaultLocale;
  if (input.enabledLocales) tenant.enabledLocales = [...input.enabledLocales];
  if (input.timezone) tenant.timezone = input.timezone;
  if (input.currency) tenant.currency = input.currency;
  if (input.logoUrl !== undefined) tenant.logoUrl = input.logoUrl;
  if (input.logoUrlLight !== undefined) tenant.logoUrlLight = input.logoUrlLight;
  if (input.primaryColor !== undefined) tenant.primaryColor = input.primaryColor;

  tenant.updatedAt = new Date().toISOString();
  return tenant;
}
