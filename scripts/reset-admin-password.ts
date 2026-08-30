// Restablece la clave de un usuario local. Uso:
//   pnpm tsx --env-file=.env scripts/_tmp-reset-admin-pass.ts
// EMAIL / NEWPASS opcionales por env.
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const EMAIL = process.env.EMAIL ?? "admin@mercurio.com";
const NEWPASS = process.env.NEWPASS ?? "Verify2026!";

async function main() {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(NEWPASS, salt, 64).toString("hex");
  const hash = `scrypt$${salt}$${key}`;

  const users = await prisma.user.findMany({
    where: { email: EMAIL },
    select: { id: true, email: true, memberships: { select: { role: true, status: true, tenant: { select: { slug: true } } } } },
  });
  if (users.length === 0) {
    console.log(`No existe ningún usuario con email ${EMAIL}`);
    return;
  }
  for (const u of users) {
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: hash } });
    console.log(`OK: clave restablecida para ${u.email} (${u.id})`);
    for (const m of u.memberships) console.log(`   tenant=${m.tenant.slug} rol=${m.role} estado=${m.status}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
