import { RouteError } from "../../http/route-error";
import { getPrismaClient } from "../data/prisma-client";
import { getDevTenantBySlug } from "../data/dev-tenant-store";
import {
  createDevTenantDomain,
  getDevTenantDomainById,
  listDevTenantDomains,
  updateDevTenantDomain,
  type DevTenantDomainRecord,
} from "../data/dev-tenant-domain-store";

export interface PlatformTenantDomainSummary {
  id: string;
  tenantSlug: string;
  host: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface PlatformTenantDomainCreateRequest {
  host: string;
  isPrimary?: boolean;
}

export interface PlatformTenantDomainUpdateRequest {
  host?: string;
  isPrimary?: boolean;
}

function normalizeHost(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/:\d+$/, "");
}

function ensureHost(value: string): string {
  const normalized = normalizeHost(value);
  if (!normalized || normalized.length < 3) {
    throw new RouteError(400, "DOMAIN_INVALID_HOST", "Domain host is required.");
  }
  return normalized;
}

function toSummaryFromDev(record: DevTenantDomainRecord): PlatformTenantDomainSummary {
  return {
    id: record.id,
    tenantSlug: record.tenantSlug,
    host: record.host,
    isPrimary: record.isPrimary,
    createdAt: record.createdAt,
  };
}

export async function listPlatformTenantDomains(tenantSlug: string): Promise<PlatformTenantDomainSummary[]> {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevTenantDomains(tenantSlug).map((record) => toSummaryFromDev(record));
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  }

  const records = await prisma.tenantDomain.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
  });

  return records.map((record) => ({
    id: record.id,
    tenantSlug,
    host: record.host,
    isPrimary: record.isPrimary,
    createdAt: record.createdAt.toISOString(),
  }));
}

export async function createPlatformTenantDomain(
  tenantSlug: string,
  request: PlatformTenantDomainCreateRequest,
): Promise<PlatformTenantDomainSummary> {
  const host = ensureHost(request.host);
  const isPrimary = Boolean(request.isPrimary);
  const prisma = getPrismaClient();
  if (!prisma) {
    const tenant = getDevTenantBySlug(tenantSlug);
    if (!tenant) {
      throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    }
    try {
      const record = createDevTenantDomain(tenant.slug, host, isPrimary);
      return toSummaryFromDev(record);
    } catch (error) {
      if (String(error).includes("DOMAIN_ALREADY_EXISTS")) {
        throw new RouteError(409, "DOMAIN_ALREADY_EXISTS", "Domain host already exists.");
      }
      throw error;
    }
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  }

  const existing = await prisma.tenantDomain.findUnique({ where: { host } });
  if (existing) {
    throw new RouteError(409, "DOMAIN_ALREADY_EXISTS", "Domain host already exists.");
  }

  const record = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.tenantDomain.updateMany({
        where: { tenantId: tenant.id, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return tx.tenantDomain.create({
      data: {
        tenantId: tenant.id,
        host,
        isPrimary,
      },
    });
  });

  return {
    id: record.id,
    tenantSlug,
    host: record.host,
    isPrimary: record.isPrimary,
    createdAt: record.createdAt.toISOString(),
  };
}

export async function updatePlatformTenantDomain(
  tenantSlug: string,
  domainId: string,
  request: PlatformTenantDomainUpdateRequest,
): Promise<PlatformTenantDomainSummary> {
  const prisma = getPrismaClient();
  if (!prisma) {
    const record = getDevTenantDomainById(domainId);
    if (!record || record.tenantSlug !== tenantSlug) {
      throw new RouteError(404, "DOMAIN_NOT_FOUND", "Domain not found.");
    }
    const host = request.host ? ensureHost(request.host) : undefined;
    try {
      const updated = updateDevTenantDomain(domainId, { host, isPrimary: request.isPrimary });
      if (!updated) {
        throw new RouteError(404, "DOMAIN_NOT_FOUND", "Domain not found.");
      }
      return toSummaryFromDev(updated);
    } catch (error) {
      if (String(error).includes("DOMAIN_ALREADY_EXISTS")) {
        throw new RouteError(409, "DOMAIN_ALREADY_EXISTS", "Domain host already exists.");
      }
      throw error;
    }
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  }

  const existing = await prisma.tenantDomain.findUnique({ where: { id: domainId } });
  if (!existing || existing.tenantId !== tenant.id) {
    throw new RouteError(404, "DOMAIN_NOT_FOUND", "Domain not found.");
  }

  const host = request.host ? ensureHost(request.host) : undefined;
  if (host && host !== existing.host) {
    const clash = await prisma.tenantDomain.findUnique({ where: { host } });
    if (clash) {
      throw new RouteError(409, "DOMAIN_ALREADY_EXISTS", "Domain host already exists.");
    }
  }

  const record = await prisma.$transaction(async (tx) => {
    if (request.isPrimary) {
      await tx.tenantDomain.updateMany({
        where: { tenantId: tenant.id, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return tx.tenantDomain.update({
      where: { id: existing.id },
      data: {
        host: host || undefined,
        isPrimary: request.isPrimary ?? undefined,
      },
    });
  });

  return {
    id: record.id,
    tenantSlug,
    host: record.host,
    isPrimary: record.isPrimary,
    createdAt: record.createdAt.toISOString(),
  };
}
