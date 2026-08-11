// In-memory cache para `prisma.tenant.findUnique({ where: { slug } })`.
//
// Razón: cada llamada a IA (suggestion services + telemetría) hacía un
// findUnique por slug. Eran ~17 queries extra por interacción. Tenant data
// cambia muy rara vez (admin actualiza displayName, logo) → cachear 5 min
// es seguro.
//
// La función cacheable expone solo los campos que TODOS los call sites
// necesitan (id, slug, settings). Si en algún call site hay que leer otros
// campos del tenant, llamar prisma directo y NO usar este helper.
//
// Invalidación manual: `invalidateTenantCache(slug)`. Llamar después de
// updates a la tabla Tenant o TenantSettings.

import { getPrismaClient } from "../platform/data/prisma-client";

export interface CachedTenant {
  id: string;
  slug: string;
  // Subset de TenantSettings que algunos call sites necesitan (logo, name).
  // Si está null el tenant no tiene settings row creada todavía.
  settings: {
    displayName: string | null;
    logoUrl: string | null;
    logoUrlLight: string | null;
    defaultLocale: string | null;
    enabledLocales: string[] | null;
    // Zona horaria de la empresa (ej. "America/Asuncion"). La usan TODOS los
    // documentos: el servidor corre en UTC y sin esto los papeles salían con la
    // hora del servidor, no con la de a bordo.
    timezone: string | null;
  } | null;
}

interface Entry {
  value: CachedTenant | null;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutos
const cache = new Map<string, Entry>();

export async function getCachedTenantBySlug(slug: string): Promise<CachedTenant | null> {
  const now = Date.now();
  const hit = cache.get(slug);
  if (hit && hit.expiresAt > now) return hit.value;

  const prisma = getPrismaClient();
  if (!prisma) return null;

  const row = await prisma.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true, defaultLocale: true, enabledLocales: true, timezone: true } },
    },
  });

  const value: CachedTenant | null = row
    ? {
        id: row.id,
        slug: row.slug,
        settings: row.settings
          ? {
              displayName: row.settings.displayName,
              logoUrl: row.settings.logoUrl,
              logoUrlLight: row.settings.logoUrlLight,
              defaultLocale: row.settings.defaultLocale ?? null,
              enabledLocales: (row.settings.enabledLocales as string[] | null) ?? null,
              timezone: (row.settings as { timezone?: string | null }).timezone ?? null,
            }
          : null,
      }
    : null;
  cache.set(slug, { value, expiresAt: now + TTL_MS });
  return value;
}

/**
 * Invalidar entry específica del cache. Llamar después de un update al tenant
 * o a sus settings (ej. cambio de displayName, logo).
 */
export function invalidateTenantCache(slug: string): void {
  cache.delete(slug);
}

/** Para tests / debug. */
export function clearTenantCache(): void {
  cache.clear();
}
