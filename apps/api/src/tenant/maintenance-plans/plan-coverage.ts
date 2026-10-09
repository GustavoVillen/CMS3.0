// Qué equipos revisa cada tarea del plan: su equipo principal (MaintenancePlan.assetId)
// más los "equipos que revisa" declarados (MaintenancePlanCoveredAsset). El checklist
// mensual consolidado cuelga de un equipo "Inspecciones MENSUALES" pero cubre las
// balsas, las luces portátiles, el CO2…: para la cobertura del PMS (listado de
// equipos, TMSA 4.1, ISM 10.3, vetting) esos equipos TIENEN plan.
//
// Regla única: cualquier indicador que pregunte "¿este equipo tiene una tarea
// activa?" arma su conjunto con estas funciones, así la tarjeta, su lista
// desplegada y la pantalla de Equipos no pueden dar números distintos.

import type { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

type Db = NonNullable<ReturnType<typeof getPrismaClient>>;

export interface CoveredAssetRef { id: string; assetCode: string; name: string }

/**
 * planId → equipos que revisa (el principal + los cubiertos). Las tareas que se
 * pasan ya vienen filtradas por el llamador (activas, del alcance); acá sólo se
 * suman los cubiertos que siguen vivos.
 */
export async function loadPlanAssetOwners(
  db: Db,
  tenantId: string,
  plans: Array<{ id: string; assetId: string }>,
): Promise<Map<string, Set<string>>> {
  const owners = new Map<string, Set<string>>();
  for (const p of plans) owners.set(p.id, new Set([p.assetId]));
  if (plans.length === 0) return owners;
  const links = await db.maintenancePlanCoveredAsset.findMany({
    where: { tenantId, maintenancePlanId: { in: plans.map(p => p.id) }, asset: { deletedAt: null } },
    select: { maintenancePlanId: true, assetId: true },
  });
  for (const l of links) owners.get(l.maintenancePlanId)?.add(l.assetId);
  return owners;
}

/** Todos los equipos que alguna de esas tareas revisa. */
export function assetsCoveredBy(owners: Map<string, Set<string>>): Set<string> {
  const out = new Set<string>();
  for (const ids of owners.values()) for (const id of ids) out.add(id);
  return out;
}

/** planId → equipos cubiertos (sin el principal), para mostrar en pantalla y PDF. */
export async function listCoveredAssetsByPlan(
  db: Db,
  tenantId: string,
  planIds: string[],
): Promise<Map<string, CoveredAssetRef[]>> {
  const out = new Map<string, CoveredAssetRef[]>();
  if (planIds.length === 0) return out;
  const links = await db.maintenancePlanCoveredAsset.findMany({
    where: { tenantId, maintenancePlanId: { in: planIds }, asset: { deletedAt: null } },
    select: { maintenancePlanId: true, asset: { select: { id: true, assetCode: true, name: true } } },
    orderBy: { asset: { assetCode: "asc" } },
  });
  for (const l of links) {
    const list = out.get(l.maintenancePlanId) ?? [];
    list.push(l.asset);
    out.set(l.maintenancePlanId, list);
  }
  return out;
}

/**
 * Valida la lista que manda el formulario: equipos vivos de la empresa y del
 * MISMO buque que la tarea (un checklist de MAO 01 no revisa equipos de MAO 02).
 * El equipo principal se descarta: ya está cubierto por ser el dueño de la tarea.
 */
export async function resolveCoveredAssetIds(
  db: Db,
  args: { tenantId: string; vesselCode: string; mainAssetId: string; ids: unknown },
): Promise<string[]> {
  if (!Array.isArray(args.ids)) {
    throw new RouteError(400, "INVALID_COVERED_ASSETS", "coveredAssetIds debe ser una lista.");
  }
  const ids = [...new Set(args.ids.filter((x): x is string => typeof x === "string").map(x => x.trim()).filter(Boolean))]
    .filter(id => id !== args.mainAssetId);
  if (ids.length === 0) return [];
  const rows = await db.asset.findMany({
    where: { id: { in: ids }, tenantId: args.tenantId, deletedAt: null },
    select: { id: true, vesselCode: true },
  });
  if (rows.length !== ids.length) {
    throw new RouteError(404, "ASSET_NOT_FOUND", "Alguno de los equipos que revisa la tarea no existe.");
  }
  if (rows.some(r => r.vesselCode !== args.vesselCode)) {
    throw new RouteError(400, "VESSEL_MISMATCH", "Los equipos que revisa la tarea tienen que ser del mismo buque.");
  }
  return ids;
}

/** Deja la lista de la tarea igual a `assetIds` y devuelve qué cambió (para la auditoría). */
export async function replaceCoveredAssets(
  db: Db,
  args: { tenantId: string; planId: string; assetIds: string[]; userId: string },
): Promise<{ added: string[]; removed: string[] }> {
  const current = await db.maintenancePlanCoveredAsset.findMany({
    where: { tenantId: args.tenantId, maintenancePlanId: args.planId },
    select: { assetId: true },
  });
  const before = new Set(current.map(c => c.assetId));
  const after = new Set(args.assetIds);
  const added = args.assetIds.filter(id => !before.has(id));
  const removed = [...before].filter(id => !after.has(id));
  if (added.length === 0 && removed.length === 0) return { added, removed };
  await db.$transaction([
    db.maintenancePlanCoveredAsset.deleteMany({
      where: { tenantId: args.tenantId, maintenancePlanId: args.planId, assetId: { in: removed } },
    }),
    db.maintenancePlanCoveredAsset.createMany({
      data: added.map(assetId => ({
        tenantId: args.tenantId, maintenancePlanId: args.planId, assetId, createdByUserId: args.userId,
      })),
      skipDuplicates: true,
    }),
  ]);
  return { added, removed };
}
