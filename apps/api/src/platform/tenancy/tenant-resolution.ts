import type { TenantResolutionInput, TenantResolutionResult } from "@cms3/shared-types";

export interface TenantResolutionConfig {
  rootDomain: string;
  adminSubdomain: string;
  allowTenantHeaderFallback?: boolean;
}

function normalizeHost(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/:\d+$/, "");
}

function normalizePath(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function sanitizeSlug(value: string | null | undefined): string | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");

  return normalized || null;
}

function resolveTenantFromSubdomain(host: string, config: TenantResolutionConfig): TenantResolutionResult | null {
  const adminHost = `${config.adminSubdomain}.${config.rootDomain}`;
  if (host === adminHost) {
    return {
      kind: "platform",
      source: "admin_subdomain",
      tenantSlug: null,
    };
  }

  const suffix = `.${config.rootDomain}`;
  if (!host.endsWith(suffix)) return null;

  const candidate = host.slice(0, -suffix.length);
  if (!candidate || candidate.includes(".")) return null;

  const tenantSlug = sanitizeSlug(candidate);
  if (!tenantSlug) return null;

  return {
    kind: "tenant",
    source: "subdomain",
    tenantSlug,
  };
}

function resolveTenantFromPath(path: string): TenantResolutionResult | null {
  const match = path.match(/^\/t\/([a-zA-Z0-9-]+)(?:\/|$)/);
  if (!match) return null;

  const tenantSlug = sanitizeSlug(match[1]);
  if (!tenantSlug) return null;

  return {
    kind: "tenant",
    source: "path",
    tenantSlug,
  };
}

export function resolveTenantRequest(
  input: TenantResolutionInput,
  config: TenantResolutionConfig,
): TenantResolutionResult {
  const normalizedHost = normalizeHost(input.host);
  const normalizedPath = normalizePath(input.path);

  const fromSubdomain = resolveTenantFromSubdomain(normalizedHost, config);
  if (fromSubdomain) return fromSubdomain;

  const fromPath = resolveTenantFromPath(normalizedPath);
  if (fromPath) return fromPath;

  const fromQuery = sanitizeSlug(input.tenantQuery);
  if (fromQuery) {
    return {
      kind: "tenant",
      source: "query",
      tenantSlug: fromQuery,
    };
  }

  if (config.allowTenantHeaderFallback) {
    const fromHeader = sanitizeSlug(input.tenantHeader);
    if (fromHeader) {
      return {
        kind: "tenant",
        source: "header",
        tenantSlug: fromHeader,
      };
    }
  }

  return {
    kind: "unresolved",
    source: "none",
    tenantSlug: null,
  };
}
