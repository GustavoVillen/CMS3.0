import { Prisma } from '../../../generated/prisma';
import { PrismaClient } from '@prisma/client';

export interface RankRow {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function listRanksByTenant(db: PrismaClient, tenantId: string): Promise<RankRow[]> {
  return db.rankDefinition.findMany({
    where: { tenantId },
    orderBy: { sortOrder: 'asc' },
  }) as Promise<RankRow[]>;
}

export async function getRankById(db: PrismaClient, rankId: string): Promise<RankRow | null> {
  return db.rankDefinition.findUnique({
    where: { id: rankId },
  }) as Promise<RankRow | null>;
}

export async function getRankByCode(
  db: PrismaClient,
  tenantId: string,
  code: string
): Promise<RankRow | null> {
  return db.rankDefinition.findFirst({
    where: { tenantId, code },
  }) as Promise<RankRow | null>;
}

export async function createRank(
  db: PrismaClient,
  tenantId: string,
  data: {
    code: string;
    name: string;
    sortOrder?: number;
  }
): Promise<RankRow> {
  return db.rankDefinition.create({
    data: {
      tenantId,
      code: data.code,
      name: data.name,
      sortOrder: data.sortOrder ?? 0,
    },
  }) as Promise<RankRow>;
}

export async function updateRank(
  db: PrismaClient,
  rankId: string,
  data: {
    name?: string;
    sortOrder?: number;
  }
): Promise<RankRow> {
  return db.rankDefinition.update({
    where: { id: rankId },
    data,
  }) as Promise<RankRow>;
}

export async function deleteRank(db: PrismaClient, rankId: string): Promise<void> {
  await db.rankDefinition.delete({
    where: { id: rankId },
  });
}
