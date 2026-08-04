import type { PrismaClient } from '../../../../../generated/prisma';
import { RouteError } from '../../http/route-error';

export interface CrewTrainingRecordRow {
  id: string;
  tenantId: string;
  crewId: string;
  trainingItemId: string;
  completedAt: Date;
  expiryDate?: Date | null;
  docUrl?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Todas las consultas de este módulo llevan tenantId en el where: los ids de
// tripulante, de ítem y de registro llegan desde la URL, así que sin ese filtro
// un usuario de otra empresa podía leer o modificar registros ajenos.
export async function listRecordsByCrewMember(
  db: PrismaClient,
  tenantId: string,
  crewId: string
): Promise<CrewTrainingRecordRow[]> {
  return db.crewTrainingRecord.findMany({
    where: { crewId, tenantId },
    orderBy: { completedAt: 'desc' },
  }) as Promise<CrewTrainingRecordRow[]>;
}

export async function listRecordsByTrainingItem(
  db: PrismaClient,
  tenantId: string,
  trainingItemId: string
): Promise<CrewTrainingRecordRow[]> {
  return db.crewTrainingRecord.findMany({
    where: { trainingItemId, tenantId },
    orderBy: { completedAt: 'desc' },
  }) as Promise<CrewTrainingRecordRow[]>;
}

export async function listExpiredRecordsByTenant(
  db: PrismaClient,
  tenantId: string,
  beforeDate: Date
): Promise<CrewTrainingRecordRow[]> {
  return db.crewTrainingRecord.findMany({
    where: {
      tenantId,
      expiryDate: { lt: beforeDate },
    },
    orderBy: { expiryDate: 'asc' },
  }) as Promise<CrewTrainingRecordRow[]>;
}

export async function getRecordById(
  db: PrismaClient,
  tenantId: string,
  recordId: string
): Promise<CrewTrainingRecordRow | null> {
  return db.crewTrainingRecord.findFirst({
    where: { id: recordId, tenantId },
  }) as Promise<CrewTrainingRecordRow | null>;
}

export async function getOrCreateRecord(
  db: PrismaClient,
  crewId: string,
  trainingItemId: string,
  tenantId: string,
  data: {
    completedAt: Date;
    expiryDate?: Date;
    docUrl?: string;
    notes?: string;
  }
): Promise<CrewTrainingRecordRow> {
  // El upsert resuelve por (crewId, trainingItemId), que son globales. Sin
  // validar antes que ambos sean de esta empresa, la rama `update` del upsert
  // caía sobre el registro de otra empresa.
  const [crewCount, itemCount] = await Promise.all([
    db.crew.count({ where: { id: crewId, tenantId } }),
    db.trainingItem.count({ where: { id: trainingItemId, tenantId } }),
  ]);
  if (crewCount === 0) {
    throw new RouteError(404, "NOT_FOUND", "Tripulante no encontrado.");
  }
  if (itemCount === 0) {
    throw new RouteError(404, "NOT_FOUND", "Ítem de capacitación no encontrado.");
  }

  return db.crewTrainingRecord.upsert({
    where: {
      crewId_trainingItemId: { crewId, trainingItemId },
    },
    update: data,
    create: {
      tenantId,
      crewId,
      trainingItemId,
      ...data,
    },
  }) as Promise<CrewTrainingRecordRow>;
}

export async function updateRecord(
  db: PrismaClient,
  tenantId: string,
  recordId: string,
  data: {
    completedAt?: Date;
    expiryDate?: Date | null;
    docUrl?: string | null;
    notes?: string | null;
  }
): Promise<CrewTrainingRecordRow> {
  const result = await db.crewTrainingRecord.updateMany({
    where: { id: recordId, tenantId },
    data,
  });
  if (result.count === 0) {
    throw new RouteError(404, "NOT_FOUND", "Registro de capacitación no encontrado.");
  }
  return db.crewTrainingRecord.findFirst({
    where: { id: recordId, tenantId },
  }) as Promise<CrewTrainingRecordRow>;
}

export async function deleteRecord(
  db: PrismaClient,
  tenantId: string,
  recordId: string
): Promise<void> {
  const result = await db.crewTrainingRecord.deleteMany({
    where: { id: recordId, tenantId },
  });
  if (result.count === 0) {
    throw new RouteError(404, "NOT_FOUND", "Registro de capacitación no encontrado.");
  }
}

export async function deleteRecordsByCrewMember(
  db: PrismaClient,
  tenantId: string,
  crewId: string
): Promise<void> {
  await db.crewTrainingRecord.deleteMany({
    where: { crewId, tenantId },
  });
}
