import type { PrismaClient } from '../../../../../generated/prisma';

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

export async function listRecordsByCrewMember(
  db: PrismaClient,
  crewId: string
): Promise<CrewTrainingRecordRow[]> {
  return db.crewTrainingRecord.findMany({
    where: { crewId },
    orderBy: { completedAt: 'desc' },
  }) as Promise<CrewTrainingRecordRow[]>;
}

export async function listRecordsByTrainingItem(
  db: PrismaClient,
  trainingItemId: string
): Promise<CrewTrainingRecordRow[]> {
  return db.crewTrainingRecord.findMany({
    where: { trainingItemId },
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

export async function getRecordById(db: PrismaClient, recordId: string): Promise<CrewTrainingRecordRow | null> {
  return db.crewTrainingRecord.findUnique({
    where: { id: recordId },
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
  recordId: string,
  data: {
    completedAt?: Date;
    expiryDate?: Date | null;
    docUrl?: string | null;
    notes?: string | null;
  }
): Promise<CrewTrainingRecordRow> {
  return db.crewTrainingRecord.update({
    where: { id: recordId },
    data,
  }) as Promise<CrewTrainingRecordRow>;
}

export async function deleteRecord(db: PrismaClient, recordId: string): Promise<void> {
  await db.crewTrainingRecord.delete({
    where: { id: recordId },
  });
}

export async function deleteRecordsByCrewMember(db: PrismaClient, crewId: string): Promise<void> {
  await db.crewTrainingRecord.deleteMany({
    where: { crewId },
  });
}
