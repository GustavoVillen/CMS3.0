import type { TenantBootstrapSource } from "@pms-saas/shared-types";
import { getPrismaClient } from "./prisma-client";

export async function findTenantBootstrapSourceBySlug(
  slug: string,
): Promise<TenantBootstrapSource | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    include: { settings: true },
  });

  if (!tenant || !tenant.settings) return null;

  return {
    slug: tenant.slug,
    displayName: tenant.settings.displayName,
    logoUrl: tenant.settings.logoUrl,
    primaryColor: tenant.settings.primaryColor,
    supportEmail: tenant.settings.supportEmail,
    defaultLocale: tenant.settings.defaultLocale,
    enabledLocales: tenant.settings.enabledLocales,
    timezone: tenant.settings.timezone,
    currency: tenant.settings.currency,
    workOrderPdfTemplate: (tenant.settings as any).workOrderPdfTemplate ?? null,
  };
}
