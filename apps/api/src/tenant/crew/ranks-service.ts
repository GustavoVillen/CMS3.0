import type { PrismaClient } from '../../../../../generated/prisma';
import { RouteError } from '../../http/route-error';

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

// El rankId llega desde la URL: sin tenantId en el where, cualquier usuario
// autenticado podía leer, renombrar o borrar el catálogo de rangos de otra
// empresa conociendo el id. Mismo criterio que training-items-service.
export async function getRankById(
  db: PrismaClient,
  tenantId: string,
  rankId: string
): Promise<RankRow | null> {
  return db.rankDefinition.findFirst({
    where: { id: rankId, tenantId },
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
  tenantId: string,
  rankId: string,
  data: {
    name?: string;
    sortOrder?: number;
  }
): Promise<RankRow> {
  const result = await db.rankDefinition.updateMany({
    where: { id: rankId, tenantId },
    data,
  });
  if (result.count === 0) {
    throw new RouteError(404, "NOT_FOUND", "Rango no encontrado.");
  }
  return db.rankDefinition.findFirst({
    where: { id: rankId, tenantId },
  }) as Promise<RankRow>;
}

export async function deleteRank(
  db: PrismaClient,
  tenantId: string,
  rankId: string
): Promise<void> {
  const result = await db.rankDefinition.deleteMany({
    where: { id: rankId, tenantId },
  });
  if (result.count === 0) {
    throw new RouteError(404, "NOT_FOUND", "Rango no encontrado.");
  }
}
