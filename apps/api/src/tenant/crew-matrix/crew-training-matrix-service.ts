// Crew Training Matrix — qué entrenamientos completó cada tripulante.
// Reemplaza la lógica vieja de CrewCapability con TrainingItem + CrewTrainingRecord.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface TrainingMatrixFilters {
  vesselCode?: string | null;
  category?: string | null;
}

async function tenantIdOrThrow(s: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: s.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

export async function getTrainingMatrix(session: TenantAccessSession, filters: TrainingMatrixFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return { crew: [], trainingItems: [], records: [], categories: [], requirements: [] };
  }
  const tenantId = await tenantIdOrThrow(session);
  const vesselCode = filters.vesselCode?.toUpperCase();
  if (vesselCode && session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel.");
  }

  // 1. Crew ONBOARD del tenant (filtrado por vessel + scope)
  const crewRaw = await (prisma as unknown as {
    crew: { findMany(a: unknown): Promise<Array<{
      id: string; firstName: string; lastName: string; vesselCode: string;
      rankId: string | null;
      rankDefinition: { code: string; name: string } | null;
    }>> };
  }).crew.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: "ONBOARD",
      ...(vesselCode
        ? { vesselCode }
        : (session.user.role !== "TENANT_ADMIN" ? { vesselCode: { in: session.user.assignedVesselCodes } } : {})),
    },
    select: {
      id: true, firstName: true, lastName: true, vesselCode: true, rankId: true,
      rankDefinition: { select: { code: true, name: true } },
    },
    orderBy: { lastName: "asc" },
  });

  const crew = crewRaw.map(c => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    vesselCode: c.vesselCode,
    rankId: c.rankId,
    rankCode: c.rankDefinition?.code ?? null,
    rankName: c.rankDefinition?.name ?? null,
  }));

  // 2. TrainingItems del tenant (filtrados por categoría si aplica)
  const trainingItems = await (prisma as unknown as {
    trainingItem: { findMany(a: unknown): Promise<Array<{
      id: string; code: string; name: string; regulation: string | null;
      category: string | null; validityYears: number | null; sortOrder: number;
    }>> };
  }).trainingItem.findMany({
    where: {
      tenantId,
      ...(filters.category ? { category: filters.category } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });

  // 3. Lista de categorías únicas del tenant (para el dropdown de filtro)
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

  // 4. Records de entrenamiento de los crew filtrados, solo para items filtrados
  const crewIds = crew.map(c => c.id);
  const itemIds = trainingItems.map(i => i.id);
  const records = crewIds.length > 0 && itemIds.length > 0
    ? await (prisma as unknown as {
        crewTrainingRecord: { findMany(a: unknown): Promise<Array<{
          id: string; crewId: string; trainingItemId: string;
          completedAt: Date; expiryDate: Date | null;
          docUrl: string | null; notes: string | null;
        }>> };
      }).crewTrainingRecord.findMany({
        where: { tenantId, crewId: { in: crewIds }, trainingItemId: { in: itemIds } },
      })
    : [];

  // 5. Requirements por rango: solo los necesarios para los rangos presentes
  const rankIds = Array.from(new Set(crew.map(c => c.rankId).filter((id): id is string => id !== null)));
  const requirements = rankIds.length > 0 && itemIds.length > 0
    ? await (prisma as unknown as {
        rankTrainingRequirement: { findMany(a: unknown): Promise<Array<{
          rankDefinitionId: string; trainingItemId: string; level: string;
        }>> };
      }).rankTrainingRequirement.findMany({
        where: { rankDefinitionId: { in: rankIds }, trainingItemId: { in: itemIds } },
        select: { rankDefinitionId: true, trainingItemId: true, level: true },
      })
    : [];

  return { crew, trainingItems, records, categories, requirements };
}
