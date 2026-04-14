export interface AppEnv {
  nodeEnv: string;
  rootDomain: string;
  adminSubdomain: string;
  allowTenantHeaderFallback: boolean;
  hasDatabaseUrl: boolean;
}

export type EnvSource = Record<string, string | undefined>;

export function parseAppEnv(source: EnvSource): AppEnv {
  return {
    nodeEnv: String(source.NODE_ENV || "development").trim() || "development",
    rootDomain: String(source.APP_ROOT_DOMAIN || "localhost").trim().toLowerCase() || "localhost",
    adminSubdomain:
      String(source.APP_ADMIN_SUBDOMAIN || "admin").trim().toLowerCase() || "admin",
    allowTenantHeaderFallback:
      String(source.APP_ALLOW_TENANT_HEADER_FALLBACK || "false").trim().toLowerCase() === "true",
    hasDatabaseUrl: !!String(source.DATABASE_URL || "").trim(),
  };
}
