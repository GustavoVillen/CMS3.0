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
  const env: AppEnv = {
    nodeEnv: String(source.NODE_ENV || "").trim().toLowerCase() || "unknown",
    rootDomain: String(source.APP_ROOT_DOMAIN || "localhost").trim().toLowerCase() || "localhost",
    adminSubdomain:
      String(source.APP_ADMIN_SUBDOMAIN || "admin").trim().toLowerCase() || "admin",
    allowTenantHeaderFallback:
      String(source.APP_ALLOW_TENANT_HEADER_FALLBACK || "false").trim().toLowerCase() === "true",
    hasDatabaseUrl: !!String(source.DATABASE_URL || "").trim(),
  };

  // SECURITY: APP_ALLOW_TENANT_HEADER_FALLBACK permite resolver el tenant vía
  // header X-Tenant-Slug. En dev es útil para probar varios tenants sin tocar
  // hosts. En producción es un bypass de aislamiento multi-tenant: cualquier
  // request puede forjar el header e impersonar a otro tenant. Fail-closed:
  // crashea al arranque si alguien intenta combinar ambos.
  if (env.allowTenantHeaderFallback && env.nodeEnv === "production") {
    throw new Error(
      "SECURITY: APP_ALLOW_TENANT_HEADER_FALLBACK=true is not allowed when NODE_ENV=production. " +
        "This flag bypasses multi-tenant isolation by allowing tenant resolution via X-Tenant-Slug header.",
    );
  }

  return env;
}
