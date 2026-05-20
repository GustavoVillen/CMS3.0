// Crew Requirements Matrix (config) — define qué entrenamientos son obligatorios
// para cada rango. Grilla: ranks (filas) × training items (columnas) × level.
// Solo TENANT_ADMIN puede editar.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

const ALLOWED_LEVELS = ["OBRIGATORIO", "VALIDO", "DESEJAVEL"] as const;
type Level = typeof ALLOWED_LEVELS[number];

export interface UpsertRequirementInput {
  rankDefinitionId: string;
  trainingItemId: string;
  level: string;
  validityYears?: number | null;
}

function ensureAdmin(s: TenantAccessSession) {
  if (s.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede editar la matriz de requerimientos.");
  }
}

async function tenantIdOrThrow(s: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: s.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

function parseLevel(v: unknown): Level {
  const s = String(v ?? "").trim().toUpperCase();
  if (!ALLOWED_LEVELS.includes(s as Level)) {
    throw new RouteError(400, "VALIDATION_ERROR", `level inválido: ${s}. Esperado: ${ALLOWED_LEVELS.join(", ")}`);
  }
  return s as Level;
}

export async function getRequirementsMatrix(session: TenantAccessSession, filters: { category?: string | null } = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return { ranks: [], trainingItems: [], categories: [], requirements: [] };
  }
  const tenantId = await tenantIdOrThrow(session);

  // 1. Ranks del tenant
  const ranks = await (prisma as unknown as {
    rankDefinition: { findMany(a: unknown): Promise<Array<{
      id: string; code: string; name: string; sortOrder: number;
    }>> };
  }).rankDefinition.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, sortOrder: true },
  });

  // 2. Training items (filtrados por categoría si aplica)
  const trainingItems = await (prisma as unknown as {
    trainingItem: { findMany(a: unknown): Promise<Array<{
      id: string; code: string; name: string; regulation: string | null;
      category: string | null; validityYears: number | null; sortOrder: number;
    }>> };
  }).trainingItem.findMany({
    where: { tenantId, ...(filters.category ? { category: filters.category } : {}) },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });

  // 3. Categorías únicas
  const allItems = await (prisma as unknown as {
    trainingItem: { findMany(a: unknown): Promise<Array<{ category: string | null }>> };
  }).trainingItem.findMany({
    where: { tenantId },
    select: { category: true },
    distinct: ["category"],
  });
  const categories = allItems
    .map(i => i.category)
    .filter((c): c is string => c !== null && c.length > 0)
    .sort();

  // 4. Requirements existentes (solo para los items filtrados)
  const itemIds = trainingItems.map(i => i.id);
  const rankIds = ranks.map(r => r.id);
  const requirements = rankIds.length > 0 && itemIds.length > 0
    ? await (prisma as unknown as {
        rankTrainingRequirement: { findMany(a: unknown): Promise<Array<{
          id: string; rankDefinitionId: string; trainingItemId: string;
          level: string; validityYears: number | null;
        }>> };
      }).rankTrainingRequirement.findMany({
        where: { rankDefinitionId: { in: rankIds }, trainingItemId: { in: itemIds } },
      })
    : [];

  return { ranks, trainingItems, categories, requirements };
}

export async function upsertRequirement(session: TenantAccessSession, input: UpsertRequirementInput) {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await tenantIdOrThrow(session);

  if (!input.rankDefinitionId) throw new RouteError(400, "VALIDATION_ERROR", "rankDefinitionId requerido.");
  if (!input.trainingItemId)   throw new RouteError(400, "VALIDATION_ERROR", "trainingItemId requerido.");
  const level = parseLevel(input.level);

  // Validar que rank y item pertenecen al tenant del session
  const rank = await (prisma as unknown as {
    rankDefinition: { findFirst(a: unknown): Promise<{ id: string } | null> };
  }).rankDefinition.findFirst({ where: { id: input.rankDefinitionId, tenantId } });
  if (!rank) throw new RouteError(404, "NOT_FOUND", "Rango no encontrado.");

  const item = await (prisma as unknown as {
    trainingItem: { findFirst(a: unknown): Promise<{ id: string } | null> };
  }).trainingItem.findFirst({ where: { id: input.trainingItemId, tenantId } });
  if (!item) throw new RouteError(404, "NOT_FOUND", "Entrenamiento no encontrado.");

  const validityYears = input.validityYears === undefined || input.validityYears === null
    ? null
    : Number(input.validityYears);

  return (prisma as unknown as {
    rankTrainingRequirement: { upsert(a: unknown): Promise<unknown> };
  }).rankTrainingRequirement.upsert({
    where: {
      rankDefinitionId_trainingItemId: {
        rankDefinitionId: input.rankDefinitionId,
        trainingItemId: input.trainingItemId,
      },
    },
    create: {
      rankDefinitionId: input.rankDefinitionId,
      trainingItemId: input.trainingItemId,
      level,
      validityYears,
    },
    update: { level, validityYears },
  });
}

export async function deleteRequirement(session: TenantAccessSession, rankDefinitionId: string, trainingItemId: string) {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await tenantIdOrThrow(session);

  const rank = await (prisma as unknown as {
    rankDefinition: { findFirst(a: unknown): Promise<{ id: string } | null> };
  }).rankDefinition.findFirst({ where: { id: rankDefinitionId, tenantId } });
  if (!rank) throw new RouteError(404, "NOT_FOUND", "Rango no encontrado.");

  await (prisma as unknown as {
    rankTrainingRequirement: { deleteMany(a: unknown): Promise<unknown> };
  }).rankTrainingRequirement.deleteMany({
    where: { rankDefinitionId, trainingItemId },
  });
}
