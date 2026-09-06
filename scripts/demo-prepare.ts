// Convierte una copia de la base de produccion en la base de PRACTICA.
//
// NUNCA debe correr contra produccion: lo primero que hace es preguntarle al
// motor como se llama la base a la que esta conectado y aborta si no es
// `cms3demo`. La traba es del lado del servidor, no de una variable que uno
// pueda olvidarse de setear.
//
// Que hace:
//   1. Archiva el tenant `demo` heredado (queda DISABLED, sin subdominio).
//   2. Renombra `mercurio` -> `demo`, para que demo.<dominio> resuelva a el,
//      y le pone un nombre visible que grita que es practica.
//   3. Le pone a TODAS las personas la misma contrasena de practica.
//   4. Le pone contrasena al azar a los usuarios de plataforma (SUPERADMIN):
//      la consola de plataforma de la demo no la usa nadie.
//
// Uso (en el servidor, desde /app-cms3-demo):
//   DEMO_PASSWORD='...' npx tsx scripts/demo-prepare.ts
import { randomBytes } from "node:crypto";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { hashPassword } from "../apps/api/src/platform/auth/passwords";

const EXPECTED_DB = "cms3demo";
const SOURCE_SLUG = "mercurio";
const DEMO_SLUG = "demo";
const ARCHIVED_SLUG = "demo-archivado";
const DEMO_DISPLAY_NAME = "MERCURIO — PRACTICA";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any);

async function main(): Promise<void> {
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error("Falta DEMO_PASSWORD");

  // ── Traba de seguridad ────────────────────────────────────────────────────
  const rows = await prisma.$queryRawUnsafe<{ db: string }[]>(
    "SELECT current_database() AS db",
  );
  const db = rows[0]?.db;
  if (db !== EXPECTED_DB) {
    throw new Error(
      `ABORTADO: conectado a la base '${db}', se esperaba '${EXPECTED_DB}'. ` +
      "Este script reescribe contrasenas y nombres de tenant; no corre en otra base.",
    );
  }
  process.stdout.write(`Base verificada: ${db}\n`);

  // ── 1. Archivar el tenant demo heredado ───────────────────────────────────
  const inherited = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  if (inherited) {
    await prisma.tenant.update({
      where: { id: inherited.id },
      data: { slug: ARCHIVED_SLUG, status: "DISABLED" },
    });
    process.stdout.write(`Tenant '${DEMO_SLUG}' heredado archivado como '${ARCHIVED_SLUG}' (DISABLED)\n`);
  }

  // ── 2. mercurio -> demo ───────────────────────────────────────────────────
  const source = await prisma.tenant.findUnique({ where: { slug: SOURCE_SLUG } });
  if (!source) throw new Error(`No existe el tenant '${SOURCE_SLUG}' en esta base`);
  await prisma.tenant.update({ where: { id: source.id }, data: { slug: DEMO_SLUG, status: "ACTIVE" } });
  await prisma.tenantSetting.update({
    where: { tenantId: source.id },
    data: { displayName: DEMO_DISPLAY_NAME },
  });
  process.stdout.write(`Tenant '${SOURCE_SLUG}' renombrado a '${DEMO_SLUG}' — "${DEMO_DISPLAY_NAME}"\n`);

  // El subdominio manda: los hosts heredados apuntarian a la instancia real.
  const domains = await prisma.tenantDomain.deleteMany({});
  process.stdout.write(`Dominios heredados borrados: ${domains.count}\n`);

  // ── 3. Contrasena de practica para todas las personas ─────────────────────
  const users = await prisma.user.findMany({ select: { id: true } });
  for (const u of users) {
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: hashPassword(password) } });
  }
  process.stdout.write(`Contrasena de practica aplicada a ${users.length} personas\n`);

  // ── 4. Usuarios de plataforma fuera de juego ──────────────────────────────
  const platformUsers = await prisma.platformUser.findMany({ select: { id: true } });
  for (const p of platformUsers) {
    await prisma.platformUser.update({
      where: { id: p.id },
      data: { passwordHash: hashPassword(randomBytes(32).toString("hex")) },
    });
  }
  process.stdout.write(`Usuarios de plataforma con contrasena al azar: ${platformUsers.length}\n`);

  process.stdout.write("\nBase de practica lista.\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    process.stderr.write(`ERROR: ${e?.message ?? e}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
