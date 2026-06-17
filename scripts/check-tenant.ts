import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  console.log(JSON.stringify(tenants, null, 2));
  await prisma.$disconnect();
}
main();
