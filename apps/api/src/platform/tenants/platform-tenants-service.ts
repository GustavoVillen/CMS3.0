import type { LocaleCode } from "@pms-saas/shared-types";
import { RouteError } from "../../http/route-error";
import { getPrismaClient } from "../data/prisma-client";
import {
  createDevTenant,
  getDevTenantBySlug,
  listDevTenants,
  updateDevTenant,
  type DevTenantRecord,
  type DevTenantUpdateInput,
  type DevTenantStatus,
} from "../data/dev-tenant-store";

export type WorkOrderPdfTemplateKey = "STANDARD" | "MERCURIO";

export interface PlatformTenantSummary {
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
  workOrderPdfTemplate: WorkOrderPdfTemplateKey;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformTenantListFilters {
  status?: string | null;
  slug?: string | null;
}

export interface PlatformTenantCreateRequest {
  slug: string;
  status?: DevTenantStatus;
  displayName: string;
  logoUrl?: string | null;
  logoUrlLight?: string | null;
  primaryColor?: string | null;
  supportEmail: string;
  defaultLocale: LocaleCode;
  enabledLocales: LocaleCode[];
  timezone: string;
  currency: string;
  workOrderPdfTemplate?: WorkOrderPdfTemplateKey;
}

export interface PlatformTenantUpdateRequest {
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
  workOrderPdfTemplate?: WorkOrderPdfTemplateKey;
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

function ensureSlug(slug: string): string {
  const normalized = normalizeSlug(slug);
  if (!normalized || !SLUG_PATTERN.test(normalized)) {
    throw new RouteError(400, "TENANT_INVALID_SLUG", "Tenant slug must be lowercase alphanumeric with hyphens.");
  }
  return normalized;
}

function ensureLocales(defaultLocale: LocaleCode, enabledLocales: LocaleCode[]): LocaleCode[] {
  if (!enabledLocales.length) {
    throw new RouteError(400, "TENANT_INVALID_LOCALES", "Enabled locales must contain at least one locale.");
  }
  if (!enabledLocales.includes(defaultLocale)) {
    throw new RouteError(400, "TENANT_INVALID_LOCALES", "Default locale must be included in enabled locales.");
  }
  return enabledLocales;
}

function ensureRequiredString(value: string, code: string, message: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new RouteError(400, code, message);
  }
  return normalized;
}

function toSummaryFromDev(record: DevTenantRecord): PlatformTenantSummary {
  return {
    id: record.id,
    slug: record.slug,
    status: record.status,
    displayName: record.displayName,
    logoUrl: record.logoUrl ?? null,
    logoUrlLight: record.logoUrlLight ?? null,
    primaryColor: record.primaryColor ?? null,
    supportEmail: record.supportEmail,
    defaultLocale: record.defaultLocale,
    enabledLocales: record.enabledLocales,
    timezone: record.timezone,
    currency: record.currency,
    workOrderPdfTemplate: ((record as any).workOrderPdfTemplate as WorkOrderPdfTemplateKey) ?? "STANDARD",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toSummaryFromPrisma(tenant: {
  id: string;
  slug: string;
  status: DevTenantStatus;
  createdAt: Date;
  updatedAt: Date;
  settings: {
    displayName: string;
    logoUrl: string | null;
    logoUrlLight?: string | null;
    primaryColor: string | null;
    supportEmail: string;
    defaultLocale: LocaleCode;
    enabledLocales: LocaleCode[];
    timezone: string;
    currency: string;
    workOrderPdfTemplate?: string | null;
  } | null;
}): PlatformTenantSummary {
  if (!tenant.settings) {
    throw new RouteError(500, "TENANT_SETTINGS_MISSING", "Tenant settings are missing.");
  }

  return {
    id: tenant.id,
    slug: tenant.slug,
    status: tenant.status,
    displayName: tenant.settings.displayName,
    logoUrl: tenant.settings.logoUrl,
    logoUrlLight: tenant.settings.logoUrlLight ?? null,
    primaryColor: tenant.settings.primaryColor,
    supportEmail: tenant.settings.supportEmail,
    defaultLocale: tenant.settings.defaultLocale,
    enabledLocales: tenant.settings.enabledLocales,
    timezone: tenant.settings.timezone,
    currency: tenant.settings.currency,
    workOrderPdfTemplate: (tenant.settings.workOrderPdfTemplate as WorkOrderPdfTemplateKey) ?? "STANDARD",
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}

export async function listPlatformTenants(filters: PlatformTenantListFilters = {}): Promise<PlatformTenantSummary[]> {
  const prisma = getPrismaClient();
  const normalizedSlug = filters.slug ? ensureSlug(filters.slug) : undefined;
  if (!prisma) {
    return listDevTenants({ status: filters.status, slug: normalizedSlug }).map((record) => toSummaryFromDev(record));
  }

  const tenants = await prisma.tenant.findMany({
    where: {
      status: filters.status ? (filters.status as DevTenantStatus) : undefined,
      slug: normalizedSlug,
    },
    include: { settings: true },
    orderBy: { createdAt: "asc" },
  });

  return tenants.map((tenant) => toSummaryFromPrisma(tenant));
}

export async function getPlatformTenant(slug: string): Promise<PlatformTenantSummary> {
  const normalizedSlug = ensureSlug(slug);
  const prisma = getPrismaClient();
  if (!prisma) {
    const record = getDevTenantBySlug(normalizedSlug);
    if (!record) {
      throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    }
    return toSummaryFromDev(record);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: normalizedSlug },
    include: { settings: true },
  });
  if (!tenant) {
    throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  }

  return toSummaryFromPrisma(tenant);
}

export async function createPlatformTenant(request: PlatformTenantCreateRequest): Promise<PlatformTenantSummary> {
  const slug = ensureSlug(request.slug);
  const displayName = ensureRequiredString(
    request.displayName,
    "TENANT_INVALID_DISPLAY_NAME",
    "Display name is required.",
  );
  const supportEmail = ensureRequiredString(
    request.supportEmail,
    "TENANT_INVALID_SUPPORT_EMAIL",
    "Support email is required.",
  );
  const timezone = ensureRequiredString(request.timezone, "TENANT_INVALID_TIMEZONE", "Timezone is required.");
  const currency = ensureRequiredString(request.currency, "TENANT_INVALID_CURRENCY", "Currency is required.");
  const enabledLocales = ensureLocales(request.defaultLocale, request.enabledLocales);
  const prisma = getPrismaClient();
  if (!prisma) {
    if (getDevTenantBySlug(slug)) {
      throw new RouteError(409, "TENANT_ALREADY_EXISTS", "Tenant slug already exists.");
    }

    const record = createDevTenant({
      slug,
      status: request.status || "ACTIVE",
      displayName,
      logoUrl: request.logoUrl ?? null,
      primaryColor: request.primaryColor ?? null,
      supportEmail,
      defaultLocale: request.defaultLocale,
      enabledLocales,
      timezone,
      currency,
    });
    return toSummaryFromDev(record);
  }

  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    throw new RouteError(409, "TENANT_ALREADY_EXISTS", "Tenant slug already exists.");
  }

  const tenant = await prisma.tenant.create({
    data: {
      slug,
      status: request.status || "ACTIVE",
      settings: {
        create: {
          displayName,
          logoUrl: request.logoUrl ?? null,
          logoUrlLight: request.logoUrlLight ?? null,
          primaryColor: request.primaryColor ?? null,
          supportEmail,
          defaultLocale: request.defaultLocale,
          enabledLocales,
          timezone,
          currency,
          workOrderPdfTemplate: request.workOrderPdfTemplate ?? "STANDARD",
        } as any,
      },
    },
    include: { settings: true },
  });

  return toSummaryFromPrisma(tenant as any);
}

export async function updatePlatformTenant(
  slug: string,
  request: PlatformTenantUpdateRequest,
): Promise<PlatformTenantSummary> {
  const normalizedSlug = ensureSlug(slug);
  const prisma = getPrismaClient();
  if (!prisma) {
    const existing = getDevTenantBySlug(normalizedSlug);
    if (!existing) {
      throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    }
    const nextDefault = request.defaultLocale || existing.defaultLocale;
    const nextEnabled = request.enabledLocales || existing.enabledLocales;
    ensureLocales(nextDefault, nextEnabled);
    const record = updateDevTenant(normalizedSlug, request as DevTenantUpdateInput);
    if (!record) {
      throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    }
    return toSummaryFromDev(record);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: normalizedSlug },
    include: { settings: true },
  });
  if (!tenant) {
    throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  }

  const nextDefaultLocale = request.defaultLocale || tenant.settings?.defaultLocale || "en";
  const nextEnabledLocales = request.enabledLocales || tenant.settings?.enabledLocales || ["en"];
  ensureLocales(nextDefaultLocale, nextEnabledLocales);

  const settingsData: Record<string, unknown> = {};
  if (request.displayName !== undefined) settingsData.displayName = request.displayName;
  if (request.logoUrl !== undefined) settingsData.logoUrl = request.logoUrl ?? null;
  if (request.logoUrlLight !== undefined) settingsData.logoUrlLight = request.logoUrlLight ?? null;
  if (request.primaryColor !== undefined) settingsData.primaryColor = request.primaryColor ?? null;
  if (request.supportEmail !== undefined) settingsData.supportEmail = request.supportEmail;
  if (request.defaultLocale !== undefined) settingsData.defaultLocale = request.defaultLocale;
  if (request.enabledLocales !== undefined) settingsData.enabledLocales = request.enabledLocales;
  if (request.timezone !== undefined) settingsData.timezone = request.timezone;
  if (request.currency !== undefined) settingsData.currency = request.currency;
  if (request.workOrderPdfTemplate !== undefined) settingsData.workOrderPdfTemplate = request.workOrderPdfTemplate;

  const tenantUpdate = await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      status: request.status || undefined,
      settings: {
        upsert: {
          create: {
            displayName: request.displayName || tenant.settings?.displayName || tenant.slug,
            logoUrl: request.logoUrl ?? tenant.settings?.logoUrl ?? null,
            logoUrlLight: request.logoUrlLight ?? tenant.settings?.logoUrlLight ?? null,
            primaryColor: request.primaryColor ?? tenant.settings?.primaryColor ?? null,
            supportEmail: request.supportEmail || tenant.settings?.supportEmail || "support@example.com",
            defaultLocale: request.defaultLocale || tenant.settings?.defaultLocale || "en",
            enabledLocales: request.enabledLocales || tenant.settings?.enabledLocales || ["en"],
            timezone: request.timezone || tenant.settings?.timezone || "UTC",
            currency: request.currency || tenant.settings?.currency || "USD",
            workOrderPdfTemplate: request.workOrderPdfTemplate ?? "STANDARD",
          } as any,
          update: settingsData,
        },
      },
    },
    include: { settings: true },
  });

  return toSummaryFromPrisma(tenantUpdate as any);
}
