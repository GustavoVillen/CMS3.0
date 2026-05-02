export interface AppEnv {
  nodeEnv: string;
  rootDomain: string;
  adminSubdomain: string;
  allowTenantHeaderFallback: boolean;
  hasDatabaseUrl: boolean;
}

export type EnvSource = Record<string, string | undefined>;

export function parseAppEnv(source: EnvSource): AppEnv {
  // nodeEnv NO defaultea a "development" — eso activaría dev fallbacks
  // (login con credenciales demo, mocks) en cualquier entorno que olvidara
  // setear NODE_ENV. En su lugar, fail-closed: si no está seteado, "unknown"
  // (que no es ni "development" ni "production" → ningún fallback corre).
  return {
    nodeEnv: String(source.NODE_ENV || "").trim().toLowerCase() || "unknown",
    rootDomain: String(source.APP_ROOT_DOMAIN || "localhost").trim().toLowerCase() || "localhost",
    adminSubdomain:
      String(source.APP_ADMIN_SUBDOMAIN || "admin").trim().toLowerCase() || "admin",
    allowTenantHeaderFallback:
      String(source.APP_ALLOW_TENANT_HEADER_FALLBACK || "false").trim().toLowerCase() === "true",
    hasDatabaseUrl: !!String(source.DATABASE_URL || "").trim(),
  };
}
