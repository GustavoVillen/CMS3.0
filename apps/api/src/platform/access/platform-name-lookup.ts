/**
 * Nombres legibles para la consola de plataforma.
 *
 * Los registros de uso, accesos, preguntas y auditoría guardan códigos
 * (slug de la empresa, código del buque, email del usuario). La consola los
 * muestra por nombre: este módulo resuelve esos códigos en lote, con una sola
 * consulta por tipo, para no hacer una por fila.
 *
 * Sólo lo usa la consola SUPERADMIN, que ve todas las empresas: no filtra por
 * tenant a propósito.
 */
import { getPrismaClient } from "../data/prisma-client";

type Prisma = NonNullable<ReturnType<typeof getPrismaClient>>;

/** slug → nombre comercial de la empresa (TenantSetting.displayName). */
export async function getTenantNames(prisma: Prisma): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const rows = await prisma.tenant.findMany({
      select: { slug: true, settings: { select: { displayName: true } } },
    });
    for (const t of rows) out.set(t.slug, t.settings?.displayName || t.slug);
  } catch {
    /* el nombre es de apoyo: si falla se muestra el slug */
  }
  return out;
}

export const vesselKey = (tenantSlug: string, vesselCode: string) => `${tenantSlug}|${vesselCode}`;

/** `${slug}|${código}` → nombre del buque, sólo para los pares pedidos. */
export async function getVesselNames(
  prisma: Prisma,
  pairs: Array<{ tenantSlug: string | null | undefined; vesselCode: string | null | undefined }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const codesBySlug = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!p.tenantSlug || !p.vesselCode) continue;
    if (!codesBySlug.has(p.tenantSlug)) codesBySlug.set(p.tenantSlug, new Set());
    codesBySlug.get(p.tenantSlug)!.add(p.vesselCode);
  }
  if (codesBySlug.size === 0) return out;
  try {
    const tenants = await prisma.tenant.findMany({
      where: { slug: { in: [...codesBySlug.keys()] } },
      select: { id: true, slug: true },
    });
    const slugById = new Map(tenants.map((t) => [t.id, t.slug]));
    const allCodes = [...new Set([...codesBySlug.values()].flatMap((s) => [...s]))];
    const vessels = await prisma.vessel.findMany({
      where: { tenantId: { in: tenants.map((t) => t.id) }, code: { in: allCodes } },
      select: { tenantId: true, code: true, name: true },
    });
    for (const v of vessels) {
      const slug = slugById.get(v.tenantId);
      if (slug) out.set(vesselKey(slug, v.code), v.name);
    }
  } catch {
    /* sin nombre se muestra el código */
  }
  return out;
}

/**
 * email → nombre y apellido. El email no es único (buzones compartidos):
 * si dos usuarios comparten email, gana el primero que tenga nombre cargado.
 */
export async function getUserNamesByEmail(prisma: Prisma, emails: Array<string | null | undefined>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(emails.filter((e): e is string => !!e))];
  if (list.length === 0) return out;
  try {
    const users = await prisma.user.findMany({
      where: { email: { in: list } },
      select: { email: true, firstName: true, lastName: true },
    });
    for (const u of users) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
      if (name && !out.has(u.email)) out.set(u.email, name);
    }
  } catch {
    /* sin nombre se muestra el email */
  }
  return out;
}
