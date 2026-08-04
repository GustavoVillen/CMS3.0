import type { PrismaClient } from '../../../../../generated/prisma';
import { RouteError } from '../../http/route-error';

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

// Buscar por id SIEMPRE lleva el tenantId en el where. Con findUnique({ id })
// cualquier usuario autenticado podía leer/editar/borrar el ítem de otra empresa
// con sólo conocer el id: el router valida la sesión, no la pertenencia del dato.
export async function getTrainingItemById(
  db: PrismaClient,
  tenantId: string,
  itemId: string
): Promise<TrainingItemRow | null> {
  return db.trainingItem.findFirst({
    where: { id: itemId, tenantId },
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

// updateMany/deleteMany (no update/delete) porque son las variantes que aceptan
// un where compuesto: si el id es de otra empresa el count vuelve 0 y se
// responde 404, en vez de tocar el registro ajeno.
export async function updateTrainingItem(
  db: PrismaClient,
  tenantId: string,
  itemId: string,
  data: {
    name?: string;
    regulation?: string;
    category?: string;
    validityYears?: number;
    sortOrder?: number;
  }
): Promise<TrainingItemRow> {
  const result = await db.trainingItem.updateMany({
    where: { id: itemId, tenantId },
    data,
  });
  if (result.count === 0) {
    throw new RouteError(404, "NOT_FOUND", "Ítem de capacitación no encontrado.");
  }
  return db.trainingItem.findFirst({
    where: { id: itemId, tenantId },
  }) as Promise<TrainingItemRow>;
}

export async function deleteTrainingItem(
  db: PrismaClient,
  tenantId: string,
  itemId: string
): Promise<void> {
  const result = await db.trainingItem.deleteMany({
    where: { id: itemId, tenantId },
  });
  if (result.count === 0) {
    throw new RouteError(404, "NOT_FOUND", "Ítem de capacitación no encontrado.");
  }
}
