export interface DevTenantDomainRecord {
  id: string;
  tenantSlug: string;
  host: string;
  isPrimary: boolean;
  createdAt: string;
}

const DEV_TENANT_DOMAINS: DevTenantDomainRecord[] = [
  {
    id: "dev-tenant-domain-demo-primary",
    tenantSlug: "demo",
    host: "demo.localhost",
    isPrimary: true,
    createdAt: "2026-04-01T00:00:00.000Z",
  },
  {
    id: "dev-tenant-domain-operations-primary",
    tenantSlug: "operations",
    host: "operations.localhost",
    isPrimary: true,
    createdAt: "2026-04-01T00:00:00.000Z",
  },
];

function normalizeHost(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/:\d+$/, "");
}

export function listDevTenantDomains(tenantSlug: string): DevTenantDomainRecord[] {
  return DEV_TENANT_DOMAINS.filter((domain) => domain.tenantSlug === tenantSlug);
}

export function getDevTenantDomainById(id: string): DevTenantDomainRecord | null {
  return DEV_TENANT_DOMAINS.find((domain) => domain.id === id) || null;
}

export function createDevTenantDomain(
  tenantSlug: string,
  host: string,
  isPrimary: boolean,
): DevTenantDomainRecord {
  const normalizedHost = normalizeHost(host);
  const existing = DEV_TENANT_DOMAINS.find((domain) => domain.host === normalizedHost);
  if (existing) {
    throw new Error("DOMAIN_ALREADY_EXISTS");
  }

  if (isPrimary) {
    DEV_TENANT_DOMAINS.forEach((domain) => {
      if (domain.tenantSlug === tenantSlug) {
        domain.isPrimary = false;
      }
    });
  }

  const record: DevTenantDomainRecord = {
    id: `dev-tenant-domain-${tenantSlug}-${normalizedHost.replace(/[^a-z0-9]+/g, "-")}`,
    tenantSlug,
    host: normalizedHost,
    isPrimary,
    createdAt: new Date().toISOString(),
  };
  DEV_TENANT_DOMAINS.push(record);
  return record;
}

export function updateDevTenantDomain(
  id: string,
  input: { host?: string; isPrimary?: boolean },
): DevTenantDomainRecord | null {
  const record = DEV_TENANT_DOMAINS.find((domain) => domain.id === id);
  if (!record) return null;

  if (input.host) {
    const normalizedHost = normalizeHost(input.host);
    const existing = DEV_TENANT_DOMAINS.find(
      (domain) => domain.host === normalizedHost && domain.id !== record.id,
    );
    if (existing) {
      throw new Error("DOMAIN_ALREADY_EXISTS");
    }
    record.host = normalizedHost;
  }

  if (input.isPrimary) {
    DEV_TENANT_DOMAINS.forEach((domain) => {
      if (domain.tenantSlug === record.tenantSlug) {
        domain.isPrimary = false;
      }
    });
    record.isPrimary = true;
  }

  if (input.isPrimary === false) {
    record.isPrimary = false;
  }

  return record;
}
