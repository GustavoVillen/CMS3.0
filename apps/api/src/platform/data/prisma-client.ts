import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../../generated/prisma";

type PrismaClientLike = PrismaClient;

let prismaClient: PrismaClientLike | null = null;
let dbReachable = true; // optimistic; flips to false on first connection error

export function getPrismaClient(): PrismaClientLike | null {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl || !dbReachable) return null;

  try {
    if (!prismaClient) {
      const pool = new Pool({ connectionString: databaseUrl });

      // When the pool can't reach the DB, mark it unreachable so subsequent
      // calls return null and trigger dev-data fallbacks instead of hanging.
      pool.on("error", () => {
        dbReachable = false;
        prismaClient = null;
      });

      const adapter = new PrismaPg(pool);
      prismaClient = new PrismaClient({ adapter } as any);
    }
    return prismaClient;
  } catch {
    return null;
  }
}

/** Call this to force a reconnect attempt (e.g. after Docker comes back up). */
export function resetPrismaClient(): void {
  dbReachable = true;
  prismaClient = null;
}
