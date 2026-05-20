import { Prisma } from '../../../generated/prisma';
import { PrismaClient } from '@prisma/client';

export interface TrainingItemRow {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  regulation?: string | null;
  category?: string | null;
  validityYears?: number | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function listTrainingItemsByTenant(db: PrismaClient, tenantId: string): Promise<TrainingItemRow[]> {
  return db.trainingItem.findMany({
    where: { tenantId },
    orderBy: { sortOrder: 'asc' },
  }) as Promise<TrainingItemRow[]>;
}

export async function listTrainingItemsByCategory(
  db: PrismaClient,
  tenantId: string,
  category: string
): Promise<TrainingItemRow[]> {
  return db.trainingItem.findMany({
    where: { tenantId, category },
    orderBy: { sortOrder: 'asc' },
  }) as Promise<TrainingItemRow[]>;
}

export async function getTrainingItemById(db: PrismaClient, itemId: string): Promise<TrainingItemRow | null> {
  return db.trainingItem.findUnique({
    where: { id: itemId },
  }) as Promise<TrainingItemRow | null>;
}

export async function getTrainingItemByCode(
  db: PrismaClient,
  tenantId: string,
  code: string
): Promise<TrainingItemRow | null> {
  return db.trainingItem.findFirst({
    where: { tenantId, code },
  }) as Promise<TrainingItemRow | null>;
}

export async function createTrainingItem(
  db: PrismaClient,
  tenantId: string,
  data: {
    code: string;
    name: string;
    regulation?: string;
    category?: string;
    validityYears?: number;
    sortOrder?: number;
  }
): Promise<TrainingItemRow> {
  return db.trainingItem.create({
    data: {
      tenantId,
      code: data.code,
      name: data.name,
      regulation: data.regulation,
      category: data.category,
      validityYears: data.validityYears,
      sortOrder: data.sortOrder ?? 0,
    },
  }) as Promise<TrainingItemRow>;
}

export async function updateTrainingItem(
  db: PrismaClient,
  itemId: string,
  data: {
    name?: string;
    regulation?: string;
    category?: string;
    validityYears?: number;
    sortOrder?: number;
  }
): Promise<TrainingItemRow> {
  return db.trainingItem.update({
    where: { id: itemId },
    data,
  }) as Promise<TrainingItemRow>;
}

export async function deleteTrainingItem(db: PrismaClient, itemId: string): Promise<void> {
  await db.trainingItem.delete({
    where: { id: itemId },
  });
}
