import type { TenantBootstrapSource } from "@cms3/shared-types";
import { findTenantBootstrapSourceBySlug } from "../../platform/data/tenant-store";
import { getDevTenantBootstrapSourceBySlug } from "../../platform/data/dev-tenant-store";

/**
 * Temporary source for the public bootstrap endpoint until Prisma-backed
 * tenant loading is available in every environment.
 */
export async function getTenantBootstrapSourceBySlug(slug: string): Promise<TenantBootstrapSource | null> {
  try {
    const fromDatabase = await findTenantBootstrapSourceBySlug(slug);
    if (fromDatabase) return fromDatabase;
  } catch {
    // Development fallback remains available when database connectivity is not ready yet.
  }

  return getDevTenantBootstrapSourceBySlug(slug);
}
