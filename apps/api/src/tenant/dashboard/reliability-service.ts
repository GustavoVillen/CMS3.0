import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

// ---------------------------------------------------------------------------
// KPIs de confiabilidad — MTBF / MTTR / Disponibilidad por activo (o agrupado).
// ---------------------------------------------------------------------------
// Deriva métricas de datos que ya existen, SIN cambios de schema:
//   - Fallas      → Defect (reportedAt en el período, severidad ≥ umbral).
//   - Horas oper. → DailyEquipmentHours (delta de runningHoursTotal en el período).
//                   Si el activo no tiene historial → fallback a horas calendario.
//   - Reparación  → WorkOrder type=CORRECTIVE status=CLOSED (completedDate-openDate).
//                   Se toman las OT correctivas del activo DIRECTAMENTE (por assetId)
//                   y no vía Defect.workOrderId, porque ese campo es ambiguo (puede ser
//                   la OT de ORIGEN de un finding, no la resolutora).
//
// Fórmulas (por activo):
//   MTBF = horas / nº fallas            (N/A si no hubo fallas)
//   MTTR = Σ duración reparaciones / nº reparaciones
//   Disponibilidad = MTBF / (MTBF + MTTR)   (disponibilidad inherente)
//
// Agregación por nivel (SFI / buque / criticidad): NO se promedian los MTBF; se
// re-suman los datos crudos del grupo (Σ horas / Σ fallas, Σ tiempos / Σ reparaciones).

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type ReliabilityGroupBy = "asset" | "sfi" | "vessel" | "criticality";

export interface ReliabilityFilters {
  vesselCode?: string | null;
  assetId?: string | null;
  sfiPrefix?: string | null;      // primer dígito del SFI (ej. "6" → G6)
  criticality?: string | null;    // A | B | C
  from?: string | null;           // ISO; default: to - 12 meses
  to?: string | null;             // ISO; default: ahora
  minSeverity?: string | null;    // LOW | MEDIUM | HIGH | CRITICAL ; default MEDIUM
  groupBy?: ReliabilityGroupBy;   // default "asset"
}

export interface ReliabilityRow {
  key: string;                    // id de activo, o clave de grupo
  label: string;                  // nombre del activo o del grupo
  sublabel?: string | null;       // assetCode / contexto
  vesselCode?: string | null;
  failures: number;
  opHours: number | null;         // horas de operación medidas (null si no hay historial)
  hoursBasis: "operating" | "calendar";
  hoursForMtbf: number;           // base usada para MTBF (opHours o calendario)
  mtbf: number | null;            // horas
  mttr: number | null;            // horas
  availability: number | null;    // 0..1
  repairs: number;
}

export interface ReliabilityResponse {
  rows: ReliabilityRow[];
  meta: {
    from: string;
    to: string;
    groupBy: ReliabilityGroupBy;
    minSeverity: string;
    assetsTotal: number;
    assetsWithoutHours: number;   // cuántos cayeron a base calendario
  };
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = prismaRaw as unknown as {
    tenant: { findUnique(args: unknown): Promise<{ id: string } | null> };
  };
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

function applyVesselScope(
  session: TenantAccessSession,
  where: Record<string, unknown>,
  requestedVesselCode?: string | null,
) {
  if (session.user.role === "TENANT_ADMIN") {
    if (requestedVesselCode) where.vesselCode = requestedVesselCode;
    return;
  }
  if (requestedVesselCode) {
    if (!session.user.assignedVesselCodes.includes(requestedVesselCode)) {
      where.vesselCode = "__NO_ASSIGNED_VESSEL__";
      return;
    }
    where.vesselCode = requestedVesselCode;
    return;
  }
  if (session.user.assignedVesselCodes.length === 0) {
    where.vesselCode = "__NO_ASSIGNED_VESSEL__";
    return;
  }
  where.vesselCode = { in: session.user.assignedVesselCodes };
}

function sfiGroupKey(sfiCode: string | null | undefined): string {
  const c = (sfiCode ?? "").trim();
  if (!c) return "—";
  const d = c[0];
  return d >= "0" && d <= "9" ? `G${d}` : "—";
}

// Acumulador crudo por fila (asset o grupo): se computan KPIs recién al final.
interface Acc {
  key: string;
  label: string;
  sublabel?: string | null;
  vesselCode?: string | null;
  failures: number;
  opHoursSum: number;       // suma de horas de operación medidas
  hoursForMtbfSum: number;  // suma de base usada (op o calendario)
  repairHoursSum: number;
  repairs: number;
  anyCalendar: boolean;     // si algún activo del grupo cayó a calendario
  allMeasured: boolean;     // si todos tuvieron horas medidas
}

function finalizeRow(a: Acc): ReliabilityRow {
  const mtbf = a.failures > 0 ? a.hoursForMtbfSum / a.failures : null;
  const mttr = a.repairs > 0 ? a.repairHoursSum / a.repairs : null;
  let availability: number | null;
  if (a.failures === 0) availability = 1;                 // sin fallas → disponible
  else if (mtbf != null && mttr != null) availability = mtbf / (mtbf + mttr);
  else availability = null;                               // fallas sin datos de reparación
  return {
    key: a.key,
    label: a.label,
    sublabel: a.sublabel ?? null,
    vesselCode: a.vesselCode ?? null,
    failures: a.failures,
    opHours: a.allMeasured ? Math.round(a.opHoursSum) : null,
    hoursBasis: a.anyCalendar ? "calendar" : "operating",
    hoursForMtbf: Math.round(a.hoursForMtbfSum),
    mtbf: mtbf != null ? Math.round(mtbf * 10) / 10 : null,
    mttr: mttr != null ? Math.round(mttr * 10) / 10 : null,
    availability: availability != null ? Math.round(availability * 10000) / 10000 : null,
    repairs: a.repairs,
  };
}

export async function getReliabilityKpis(
  session: TenantAccessSession,
  filters: ReliabilityFilters = {},
): Promise<ReliabilityResponse> {
  const to = filters.to ? new Date(filters.to) : new Date();
  const from = filters.from ? new Date(filters.from) : new Date(to.getTime() - 365 * DAY_MS);
  const groupBy: ReliabilityGroupBy = filters.groupBy ?? "asset";
  const minSeverity = (filters.minSeverity ?? "MEDIUM").toUpperCase();
  const sevIdx = Math.max(0, SEVERITY_ORDER.indexOf(minSeverity as (typeof SEVERITY_ORDER)[number]));
  const allowedSeverities = SEVERITY_ORDER.slice(sevIdx);
  const periodHours = Math.max(0, (to.getTime() - from.getTime()) / HOUR_MS);

  const empty: ReliabilityResponse = {
    rows: [],
    meta: {
      from: from.toISOString(), to: to.toISOString(), groupBy,
      minSeverity, assetsTotal: 0, assetsWithoutHours: 0,
    },
  };

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return empty;
  const tenantId = await resolveTenantId(session);
  if (!tenantId) return empty;

  const db = prismaRaw as unknown as {
    asset: { findMany(args: unknown): Promise<{ id: string; vesselCode: string; assetCode: string; sfiCode: string | null; name: string; criticality: string }[]> };
    defect: { findMany(args: unknown): Promise<{ assetId: string }[]> };
    workOrder: { findMany(args: unknown): Promise<{ assetId: string; openDate: Date; completedDate: Date | null }[]> };
  };

  // 1) Activos en scope
  const assetWhere: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, assetWhere, filters.vesselCode ?? null);
  if (filters.assetId) assetWhere.id = filters.assetId;
  if (filters.criticality) assetWhere.criticality = filters.criticality.toUpperCase();
  if (filters.sfiPrefix) assetWhere.sfiCode = { startsWith: filters.sfiPrefix };

  const assets = await db.asset.findMany({
    where: assetWhere,
    select: { id: true, vesselCode: true, assetCode: true, sfiCode: true, name: true, criticality: true },
  });
  if (assets.length === 0) return empty;
  const assetIds = assets.map(a => a.id);

  // 2) Fallas = Defects en el período (con severidad ≥ umbral) → conteo por activo
  const defects = await db.defect.findMany({
    where: {
      tenantId, deletedAt: null,
      assetId: { in: assetIds },
      reportedAt: { gte: from, lte: to },
      severity: { in: allowedSeverities },
    },
    select: { assetId: true },
  });
  const failuresByAsset = new Map<string, number>();
  for (const d of defects) failuresByAsset.set(d.assetId, (failuresByAsset.get(d.assetId) ?? 0) + 1);

  // 3) Horas de operación medidas por activo (delta runningHoursTotal en el período)
  const placeholders = assetIds.map((_, i) => `$${i + 1}`).join(", ");
  const tenantPh = `$${assetIds.length + 1}`;
  const fromPh = `$${assetIds.length + 2}`;
  const toPh = `$${assetIds.length + 3}`;
  const opHoursRows = await prismaRaw.$queryRawUnsafe<{ assetId: string; oph: number }[]>(
    `SELECT "assetId", (MAX("runningHoursTotal") - MIN("runningHoursTotal"))::float AS oph
     FROM "DailyEquipmentHours"
     WHERE "assetId" IN (${placeholders})
       AND "tenantId" = ${tenantPh}
       AND "runningHoursTotal" IS NOT NULL
       AND "createdAt" >= ${fromPh} AND "createdAt" <= ${toPh}
     GROUP BY "assetId"
     HAVING COUNT(*) >= 2`,
    ...assetIds, tenantId, from, to,
  );
  const opHoursByAsset = new Map<string, number>();
  for (const r of opHoursRows) {
    const v = Number(r.oph);
    if (isFinite(v) && v > 0) opHoursByAsset.set(r.assetId, v);
  }

  // 4) Reparaciones = OT correctivas cerradas del activo → duración por activo
  const workOrders = await db.workOrder.findMany({
    where: {
      tenantId, deletedAt: null,
      assetId: { in: assetIds },
      type: "CORRECTIVE",
      status: "CLOSED",
      completedDate: { gte: from, lte: to },
    },
    select: { assetId: true, openDate: true, completedDate: true },
  });
  const repairByAsset = new Map<string, { sum: number; count: number }>();
  for (const wo of workOrders) {
    if (!wo.completedDate || !wo.openDate) continue;
    const hrs = (new Date(wo.completedDate).getTime() - new Date(wo.openDate).getTime()) / HOUR_MS;
    if (!isFinite(hrs) || hrs < 0) continue;
    const cur = repairByAsset.get(wo.assetId) ?? { sum: 0, count: 0 };
    cur.sum += hrs; cur.count += 1;
    repairByAsset.set(wo.assetId, cur);
  }

  // 5) Acumular por activo (y luego, si corresponde, por grupo)
  const accs = new Map<string, Acc>();
  let assetsWithoutHours = 0;

  const groupKeyOf = (a: typeof assets[number]): { key: string; label: string; sublabel?: string | null; vesselCode?: string | null } => {
    switch (groupBy) {
      case "sfi":         return { key: sfiGroupKey(a.sfiCode), label: sfiGroupKey(a.sfiCode) };
      case "vessel":      return { key: a.vesselCode, label: a.vesselCode, vesselCode: a.vesselCode };
      case "criticality": return { key: a.criticality, label: a.criticality };
      default:            return { key: a.id, label: a.name, sublabel: a.assetCode, vesselCode: a.vesselCode };
    }
  };

  for (const a of assets) {
    const failures = failuresByAsset.get(a.id) ?? 0;
    const op = opHoursByAsset.get(a.id) ?? null;
    if (op == null) assetsWithoutHours++;
    const hoursForMtbf = op ?? periodHours;
    const rep = repairByAsset.get(a.id) ?? { sum: 0, count: 0 };

    const g = groupKeyOf(a);
    const acc = accs.get(g.key) ?? {
      key: g.key, label: g.label, sublabel: g.sublabel, vesselCode: g.vesselCode,
      failures: 0, opHoursSum: 0, hoursForMtbfSum: 0, repairHoursSum: 0, repairs: 0,
      anyCalendar: false, allMeasured: true,
    } satisfies Acc;

    acc.failures += failures;
    acc.hoursForMtbfSum += hoursForMtbf;
    if (op != null) acc.opHoursSum += op; else { acc.anyCalendar = true; acc.allMeasured = false; }
    acc.repairHoursSum += rep.sum;
    acc.repairs += rep.count;
    accs.set(g.key, acc);
  }

  const rows = [...accs.values()].map(finalizeRow);
  // Orden por defecto: peores primero (disponibilidad asc; sin dato al final; luego MTBF asc)
  rows.sort((x, y) => {
    const ax = x.availability ?? 2, ay = y.availability ?? 2;
    if (ax !== ay) return ax - ay;
    const mx = x.mtbf ?? Infinity, my = y.mtbf ?? Infinity;
    return mx - my;
  });

  return {
    rows,
    meta: {
      from: from.toISOString(), to: to.toISOString(), groupBy,
      minSeverity, assetsTotal: assets.length, assetsWithoutHours,
    },
  };
}
