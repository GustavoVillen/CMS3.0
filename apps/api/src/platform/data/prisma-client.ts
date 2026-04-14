import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

type PrismaClientLike = PrismaClient;

let prismaClient: PrismaClientLike | null = null;

export function getPrismaClient(): PrismaClientLike | null {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  console.log("[prisma-client] DATABASE_URL:", databaseUrl ? databaseUrl.substring(0, 50) : "(empty)");
  if (!databaseUrl) return null;

  try {
    if (!prismaClient) {
      const pool = new Pool({ connectionString: databaseUrl });
      const adapter = new PrismaPg(pool);
      prismaClient = new PrismaClient({ adapter } as any);
    }
    return prismaClient;
  } catch (err) {
    console.error("[prisma-client] Failed to create client:", err);
    return null;
  }
}
