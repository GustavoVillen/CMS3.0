import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";

interface ResolvedTenant { id: string }

async function resolveTenant(session: TenantAccessSession): Promise<ResolvedTenant | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const t = await (prisma as any).tenant.findUnique({
    where: { slug: session.tenantSlug },
    select: { id: true },
  });
  return t ?? null;
}

export interface CreateStandbyTestInput {
  assetId: string;
  testedAt: string | Date;
  result: "OK" | "FAILED";
  notes?: string | null;
}

export async function createStandbyTest(session: TenantAccessSession, input: CreateStandbyTestInput) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await resolveTenant(session);
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const assetId = String(input.assetId || "").trim();
  if (!assetId) throw new RouteError(400, "VALIDATION_ERROR", "assetId requerido.");

  // Validar que el asset pertenezca al tenant y sea safety-critical.
  const asset = await (prisma as any).asset.findFirst({
    where: { id: assetId, tenantId: tenant.id, deletedAt: null },
    select: { id: true, isSafetyCritical: true, name: true, vesselCode: true },
  });
  if (!asset) throw new RouteError(404, "ASSET_NOT_FOUND", "Asset no encontrado.");
  if (!asset.isSafetyCritical) {
    throw new RouteError(400, "ASSET_NOT_SAFETY_CRITICAL", "Solo se registran pruebas en equipos safety-critical (ISM).");
  }

  const testedAt = new Date(input.testedAt);
  if (isNaN(testedAt.getTime())) {
    throw new RouteError(400, "VALIDATION_ERROR", "testedAt inválida.");
  }

  if (input.result !== "OK" && input.result !== "FAILED") {
    throw new RouteError(400, "VALIDATION_ERROR", "result debe ser OK o FAILED.");
  }

  return (prisma as any).standbyTest.create({
    data: {
      tenantId: tenant.id,
      assetId,
      testedAt,
      result: input.result,
      notes: input.notes?.trim() || null,
      executedByUserId: session.user.id,
    },
  });
}

/**
 * Lista de pruebas de standby pendientes — equipos isSafetyCritical
 * con standbyTestFrequencyDays definido cuya última prueba (o instalación)
 * está fuera del intervalo. Los más vencidos primero.
 */
export async function listPendingStandbyTests(session: TenantAccessSession, vesselCode?: string | null) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenant = await resolveTenant(session);
  if (!tenant) return [];

  const where: Record<string, unknown> = {
    tenantId: tenant.id,
    deletedAt: null,
    isSafetyCritical: true,
    standbyTestFrequencyDays: { not: null },
  };
  // Vessel scope (FAIL-CLOSED): TENANT_ADMIN y FLEET_SUPERINTENDENT ven todos
  // los buques. El resto solo ve sus buques asignados; sin asignación → ninguno.
  if (
    session.user.role !== "TENANT_ADMIN" &&
    session.user.role !== "FLEET_SUPERINTENDENT"
  ) {
    where.vesselCode = session.user.assignedVesselCodes.length === 0
      ? "__NO_ASSIGNED_VESSEL__"
      : { in: session.user.assignedVesselCodes };
  }
  if (vesselCode) where.vesselCode = vesselCode;

  const assets = await (prisma as any).asset.findMany({
    where,
    select: {
      id: true,
      assetCode: true,
      name: true,
      vesselCode: true,
      sfiCode: true,
      standbyTestFrequencyDays: true,
      installationDate: true,
      standbyTests: {
        orderBy: { testedAt: "desc" },
        take: 1,
        select: { testedAt: true, result: true },
      },
    },
  });

  const now = Date.now();
  const items = assets.map((a: any) => {
    const last = a.standbyTests[0]?.testedAt ?? a.installationDate ?? a.createdAt ?? null;
    const lastMs = last ? new Date(last).getTime() : null;
    const dueMs = lastMs ? lastMs + a.standbyTestFrequencyDays * 24 * 60 * 60 * 1000 : now;
    const overdueDays = lastMs ? Math.floor((now - dueMs) / (24 * 60 * 60 * 1000)) : 0;
    const daysSinceLastTest = lastMs ? Math.floor((now - lastMs) / (24 * 60 * 60 * 1000)) : null;
    return {
      assetId: a.id,
      assetCode: a.assetCode,
      assetName: a.name,
      vesselCode: a.vesselCode,
      sfiCode: a.sfiCode,
      frequencyDays: a.standbyTestFrequencyDays,
      lastTestedAt: last,
      lastResult: a.standbyTests[0]?.result ?? null,
      daysSinceLastTest,
      overdueDays: overdueDays > 0 ? overdueDays : 0,
      isOverdue: overdueDays > 0,
    };
  });

  // Solo retornar los vencidos o por vencer pronto (gracePeriod = 7 días antes)
  const GRACE = 7;
  const relevant = items.filter((i: any) =>
    i.isOverdue || (i.daysSinceLastTest !== null && i.frequencyDays - (i.daysSinceLastTest ?? 0) <= GRACE),
  );
  // Ordenar: más vencidos primero
  relevant.sort((a: any, b: any) => b.overdueDays - a.overdueDays);
  return relevant;
}

export async function listStandbyTestsForAsset(
  session: TenantAccessSession,
  assetId: string,
  limit = 50,
) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenant = await resolveTenant(session);
  if (!tenant) return [];

  // Validar tenancy del asset
  const asset = await (prisma as any).asset.findFirst({
    where: { id: assetId, tenantId: tenant.id, deletedAt: null },
    select: { id: true },
  });
  if (!asset) throw new RouteError(404, "ASSET_NOT_FOUND", "Asset no encontrado.");

  return (prisma as any).standbyTest.findMany({
    where: { tenantId: tenant.id, assetId },
    orderBy: { testedAt: "desc" },
    take: Math.min(limit, 200),
  });
}
