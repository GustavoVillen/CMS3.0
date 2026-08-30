// Chequeo: ¿hay reportCode duplicados por tenant en DailyReport?
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

async function main() {
  const dupes = await prisma.$queryRawUnsafe(
    `SELECT "tenantId", "reportCode", COUNT(*) AS n
     FROM "DailyReport"
     WHERE "reportCode" IS NOT NULL
     GROUP BY "tenantId", "reportCode"
     HAVING COUNT(*) > 1
     ORDER BY n DESC
     LIMIT 50`,
  );
  console.log(JSON.stringify(dupes, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2));
  console.log("duplicados:", (dupes as unknown[]).length);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
