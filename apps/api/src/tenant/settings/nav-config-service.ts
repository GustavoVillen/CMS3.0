import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

// Paths que NUNCA se pueden ocultar (el admin quedaría sin forma de volver a
// habilitar módulos, o sin dashboard). Red de seguridad en el servidor: aunque
// el cliente los mande, se descartan.
const LOCKED_PATHS = new Set<string>(["/", "/configuration"]);

const MAX_PATHS = 100;

/** Sanea la lista recibida del cliente: strings no vacíos, sin locked, únicos. */
function sanitizeHiddenPaths(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new RouteError(400, "INVALID_BODY", "Se esperaba { hiddenNavPaths: string[] }.");
  }
  const cleaned = input
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.length <= 200 && p.startsWith("/") && !LOCKED_PATHS.has(p));
  return Array.from(new Set(cleaned)).slice(0, MAX_PATHS);
}

/**
 * Devuelve los paths del menú lateral ocultos para el tenant. Fail-open: si la
 * DB no está disponible o el tenant no tiene settings aún, devuelve [] (todo
 * visible) para no romper el sidebar.
 */
export async function getHiddenNavPaths(session: TenantAccessSession): Promise<string[]> {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];
  const settings = await prisma.tenantSetting.findUnique({
    where: { tenantId: tenant.id },
    select: { hiddenNavPaths: true },
  });
  return settings?.hiddenNavPaths ?? [];
}

/** Guarda la lista de paths ocultos (solo TENANT_ADMIN, validado en el router). */
export async function setHiddenNavPaths(
  session: TenantAccessSession,
  input: unknown,
): Promise<string[]> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const hiddenNavPaths = sanitizeHiddenPaths(input);
  const updated = await prisma.tenantSetting.update({
    where: { tenantId: tenant.id },
    data: { hiddenNavPaths },
    select: { hiddenNavPaths: true },
  });
  return updated.hiddenNavPaths;
}
