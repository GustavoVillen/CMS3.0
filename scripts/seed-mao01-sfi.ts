/**
 * LIMPIEZA — elimina los nodos SFI propios del tenant "mercurio".
 *
 * En una versión anterior se crearon 26 SfiNode tenant-scoped con códigos
 * inventados (601, 802, 902, …). Eso fue un error: el sistema ya trae el
 * catálogo SFI oficial (610, 620, 710, 810, 920, …) con nombres i18n.
 * Los activos/planes del MAO 01 se re-mapearon a esos códigos oficiales, así
 * que estos nodos propios sobran y ensucian los desplegables ([sfi.c.xxx]).
 *
 * Este script borra TODOS los SfiNode tenant-scoped de mercurio (tenantId set);
 * NO toca el catálogo global (tenantId = null).
 *
 * Uso:
 *   DATABASE_URL=<url> npx tsx scripts/seed-mao01-sfi.ts
 *   DRY=1 DATABASE_URL=<url> npx tsx scripts/seed-mao01-sfi.ts
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const DRY = process.env.DRY === "1";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tid: string = tenant.id;

  const nodes = await prisma.sfiNode.findMany({
    where: { tenantId: tid },
    select: { id: true, code: true, description: true },
    orderBy: { code: "asc" },
  });

  if (nodes.length === 0) {
    console.log(`No hay SfiNode propios en '${SLUG}'. Nada que borrar.`);
    return;
  }

  for (const n of nodes) {
    console.log(`${DRY ? "DRY " : "✓ "}borrar SfiNode ${n.code} — ${n.description}`);
  }

  if (!DRY) {
    await prisma.sfiNode.deleteMany({ where: { tenantId: tid } });
  }

  console.log(
    `\n${DRY ? "DRY-RUN (no se borró nada). " : "✅ Completado. "}` +
      `${nodes.length} SfiNode propios de '${SLUG}' ${DRY ? "se borrarían" : "borrados"}. El catálogo global queda intacto.`,
  );
}

main()
  .catch((e) => {
    console.error("❌ Error:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
