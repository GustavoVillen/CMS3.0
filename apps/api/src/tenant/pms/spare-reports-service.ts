import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { getOnHandMap } from "./stock-calc-service";
import {
  resolveSpareDepartment, isBarcaza, spareKindFromCategory, splitNameForEquipment,
  type Department, type SpareKind,
} from "./department-mapping";

// ─── Public types ────────────────────────────────────────────────────────────

export interface SpareInventoryFilters {
  vesselCode: string;
  /** Optional dept filter (CUBIERTA / MAQUINAS / COCINA / BARCAZA). If omitted, returns all. */
  department?: Department | null;
  /** Snapshot date — currently a header field; on-hand is always real-time. */
  asOfDate?: string | Date | null;
}

export interface SpareInventoryItem {
  id: string;
  sku: string;
  name: string;
  longDescription: string | null;
  category: string | null;
  unit: string;
  /** Real on-hand quantity computed from stock movements. */
  onHand: number;
  minStock: number;
  reorderPoint: number;
  belowReorder: boolean;
  location: string | null;
  sfiCode: string | null;
  /** Description of the SFI node (e.g. "Fuel Oil System") when sfiCode resolves. */
  sfiName: string | null;
  department: Department | null;
  /** Date of the last movement (any type) for this spare, ISO string. */
  lastMovementAt: string | null;
  /** TOOL va a la sección Herramientas del REGI-MAN-04.1; el resto a Repuestos. */
  kind: SpareKind;
  /** Nombre sin el "para <equipo>" final (columna REPUESTO). */
  itemLabel: string;
  /** Equipo al que sirve (columna PARA QUE): equipo vinculado, el nombre o el SFI. */
  equipmentLabel: string | null;
  partNumber: string | null;
}

export interface SpareStandardFilters {
  vesselCode: string;
  department?: Department | null;
  /** HALF = "medio estándar" de la planilla de suministro. */
  mode?: "FULL" | "HALF";
  voyageNumber?: string | null;
}

export interface SpareStandardItem {
  id: string;
  section: "FILTER_LUBE" | "ARTICLE";
  /** Equipo agrupador (nombre) — sólo filtros/lubricantes. */
  equipmentName: string | null;
  /** "Marca/Modelo" del equipo vinculado, si lo hay. */
  equipmentMakeModel: string | null;
  itemLabel: string;
  partNumber: string | null;
  unit: string;
  standard: number;
  onBoard: number;
  request: number;
}

export interface SpareStandardReport {
  vessel: { code: string; name: string; type: string | null; isBarcaza: boolean };
  filters: { department: Department; mode: "FULL" | "HALF"; voyageNumber: string | null };
  items: SpareStandardItem[];
  summary: { totalItems: number; itemsToRequest: number };
}

export interface SpareInventoryReport {
  vessel: {
    code: string;
    name: string;
    type: string | null;
    isBarcaza: boolean;
  };
  /** Header context auto-populated from the latest Daily Report (if any). */
  context: {
    reportDate: string | null;
    operationalStatus: string | null;
    currentPort: string | null;
    positionLat: number | null;
    positionLon: number | null;
  };
  filters: {
    asOfDate: string;
    department: Department | null;
  };
  items: SpareInventoryItem[];
  summary: {
    totalItems: number;
    belowReorderCount: number;
  };
  documentRevision: number;
}

export interface SpareConsumptionFilters {
  vesselCode: string;
  /** 1-12 */
  month: number;
  year: number;
}

export interface SpareConsumptionItem {
  spareId: string;
  sku: string;
  name: string;
  unit: string;
  sfiCode: string | null;
  department: Department | null;
  consumed: number;
  /** Distinct WO/Plan refs that triggered consumption. */
  references: Array<{ type: string; id: string }>;
}

export interface SpareConsumptionReport {
  vessel: {
    code: string;
    name: string;
    type: string | null;
    isBarcaza: boolean;
  };
  period: {
    year: number;
    month: number;
    fromIso: string;
    toIso: string;
  };
  items: SpareConsumptionItem[];
  summary: {
    totalLines: number;
    totalConsumedQty: number;
  };
  documentRevision: number;
}

// ─── Helpers (private) ───────────────────────────────────────────────────────

async function resolveTenantContext(session: TenantAccessSession) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await (prisma as any).tenant.findUnique({
    where: { slug: session.tenantSlug },
    select: {
      id: true,
      settings: { select: { spareInventoryRevision: true, spareConsumptionRevision: true } },
    },
  });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return {
    prisma,
    tenantId: tenant.id as string,
    inventoryRevision: tenant.settings?.spareInventoryRevision ?? 2,
    consumptionRevision: tenant.settings?.spareConsumptionRevision ?? 1,
  };
}

function assertVesselScope(session: TenantAccessSession, vesselCode: string) {
  if (session.user.role === "TENANT_ADMIN") return;
  if (!session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
  }
}

async function loadVesselInfo(prisma: any, tenantId: string, vesselCode: string) {
  const v = await prisma.vessel.findUnique({
    where: { tenantId_code: { tenantId, code: vesselCode } },
    select: { code: true, name: true, vesselType: true },
  });
  if (!v) throw new RouteError(404, "VESSEL_NOT_FOUND", "Vessel no encontrado.");
  return { code: v.code, name: v.name, type: v.vesselType, isBarcaza: isBarcaza(v.vesselType) };
}

async function loadLatestDailyReportContext(prisma: any, tenantId: string, vesselCode: string) {
  const dr = await prisma.dailyReport.findFirst({
    where: { tenantId, vesselCode },
    orderBy: { reportDate: "desc" },
    select: {
      reportDate: true,
      operationalStatus: true,
      currentPort: true,
      positionLat: true,
      positionLon: true,
    },
  });
  if (!dr) {
    return { reportDate: null, operationalStatus: null, currentPort: null, positionLat: null, positionLon: null };
  }
  return {
    reportDate: dr.reportDate ? new Date(dr.reportDate).toISOString() : null,
    operationalStatus: dr.operationalStatus ?? null,
    currentPort: dr.currentPort ?? null,
    positionLat: dr.positionLat ?? null,
    positionLon: dr.positionLon ?? null,
  };
}

interface LinkedAsset {
  sfiCode: string | null;
  name: string;
  makeModel: string | null;
  /** "Motor principal Caterpillar 3412" */
  label: string;
}

async function loadLinkedAssets(prisma: any, tenantId: string, spares: Array<{ linkedAssetId: string | null }>) {
  const map = new Map<string, LinkedAsset>();
  const ids = [...new Set(spares.map(s => s.linkedAssetId).filter(Boolean))] as string[];
  if (ids.length === 0) return map;
  const assets = await prisma.asset.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, sfiCode: true, name: true, manufacturer: true, model: true },
  });
  for (const a of assets) {
    const makeModel = [a.manufacturer, a.model].filter(Boolean).join(" ") || null;
    map.set(a.id, {
      sfiCode: a.sfiCode ?? null,
      name: a.name,
      makeModel,
      label: makeModel ? `${a.name} ${makeModel}` : a.name,
    });
  }
  return map;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getSpareInventoryReport(
  session: TenantAccessSession,
  filters: SpareInventoryFilters,
): Promise<SpareInventoryReport> {
  if (!filters.vesselCode) throw new RouteError(400, "VALIDATION_ERROR", "vesselCode es requerido.");
  assertVesselScope(session, filters.vesselCode);

  const { prisma, tenantId, inventoryRevision } = await resolveTenantContext(session);
  const vessel = await loadVesselInfo(prisma, tenantId, filters.vesselCode);
  const context = await loadLatestDailyReportContext(prisma, tenantId, filters.vesselCode);

  const spares = await (prisma as any).spare.findMany({
    where: { tenantId, vesselCode: filters.vesselCode, deletedAt: null, status: "ACTIVE" },
    select: {
      id: true, sku: true, name: true, longDescription: true, category: true,
      unit: true, minStock: true, reorderPoint: true, location: true, sfiCode: true,
      linkedAssetId: true, manufacturerPartNumber: true, internalPartNumber: true,
    },
    orderBy: [{ sfiCode: "asc" }, { name: "asc" }],
  });

  // Resolve linked asset SFI codes (fallback for spares without sfiCode)
  const assetMap = await loadLinkedAssets(prisma, tenantId, spares);
  const assetSfiMap = new Map<string, string | null>();
  for (const [id, a] of assetMap) assetSfiMap.set(id, a.sfiCode);

  const onHandMap = await getOnHandMap(prisma, spares.map((s: any) => s.id));

  // SFI description map (global + tenant-specific). Used to render
  // "Fuel Oil System (710)" instead of just the code.
  const sfiCodes = new Set<string>();
  for (const s of spares) {
    if (s.sfiCode) sfiCodes.add(s.sfiCode);
    const aSfi = s.linkedAssetId ? assetSfiMap.get(s.linkedAssetId) : null;
    if (aSfi) sfiCodes.add(aSfi);
  }
  const sfiNameMap = new Map<string, string>();
  if (sfiCodes.size > 0) {
    const sfiRows = await (prisma as any).sfiNode.findMany({
      where: {
        code: { in: Array.from(sfiCodes) },
        OR: [{ tenantId: null }, { tenantId }],
      },
      select: { code: true, description: true, tenantId: true },
    });
    // Tenant-specific overrides the global one if both exist.
    for (const r of sfiRows) {
      const existing = sfiNameMap.get(r.code);
      if (!existing || r.tenantId === tenantId) sfiNameMap.set(r.code, r.description);
    }
  }

  // Last movement per spare
  const lastMoveMap = new Map<string, string>();
  if (spares.length > 0) {
    const moves = await (prisma as any).stockMovement.findMany({
      where: { spareId: { in: spares.map((s: any) => s.id) } },
      orderBy: { occurredAt: "desc" },
      select: { spareId: true, occurredAt: true },
    });
    for (const m of moves) {
      if (!lastMoveMap.has(m.spareId)) {
        lastMoveMap.set(m.spareId, new Date(m.occurredAt).toISOString());
      }
    }
  }

  const items: SpareInventoryItem[] = [];
  for (const s of spares) {
    const assetSfi = s.linkedAssetId ? assetSfiMap.get(s.linkedAssetId) ?? null : null;
    const dept = resolveSpareDepartment(s.sfiCode, assetSfi);
    const kind = spareKindFromCategory(s.category);
    // Herramientas y artículos no suelen tener SFI: sin departamento propio,
    // entran en el inventario de cualquier departamento.
    if (filters.department && dept !== filters.department && !(dept === null && kind !== "SPARE")) continue;

    const onHand = onHandMap.get(s.id) ?? 0;
    const resolvedSfi = s.sfiCode ?? assetSfi ?? null;
    const asset = s.linkedAssetId ? assetMap.get(s.linkedAssetId) : undefined;
    const split = splitNameForEquipment(s.name);
    const sfiName = resolvedSfi ? sfiNameMap.get(resolvedSfi) ?? null : null;
    items.push({
      id: s.id,
      sku: s.sku,
      name: s.name,
      longDescription: s.longDescription,
      category: s.category,
      unit: s.unit,
      onHand,
      minStock: s.minStock ?? 0,
      reorderPoint: s.reorderPoint ?? 0,
      belowReorder: onHand <= (s.reorderPoint ?? 0),
      location: s.location,
      sfiCode: resolvedSfi,
      sfiName,
      department: dept,
      lastMovementAt: lastMoveMap.get(s.id) ?? null,
      kind,
      itemLabel: asset ? s.name : split.item,
      equipmentLabel: asset ? asset.label : split.equipment ?? sfiName,
      partNumber: s.manufacturerPartNumber ?? s.internalPartNumber ?? null,
    });
  }

  const asOfDate = filters.asOfDate ? new Date(filters.asOfDate).toISOString() : new Date().toISOString();

  return {
    vessel,
    context,
    filters: { asOfDate, department: filters.department ?? null },
    items,
    summary: {
      totalItems: items.length,
      belowReorderCount: items.filter(i => i.belowReorder).length,
    },
    documentRevision: inventoryRevision,
  };
}

const NEGATIVE_MOVEMENT_TYPES = new Set([
  "ISSUE", "TRANSFER_OUT", "TRANSFER", "ADJUSTMENT_MINUS",
]);

export async function getSpareConsumptionReport(
  session: TenantAccessSession,
  filters: SpareConsumptionFilters,
): Promise<SpareConsumptionReport> {
  if (!filters.vesselCode) throw new RouteError(400, "VALIDATION_ERROR", "vesselCode es requerido.");
  if (!filters.year || !filters.month || filters.month < 1 || filters.month > 12) {
    throw new RouteError(400, "VALIDATION_ERROR", "year/month inválidos.");
  }
  assertVesselScope(session, filters.vesselCode);

  const { prisma, tenantId, consumptionRevision } = await resolveTenantContext(session);
  const vessel = await loadVesselInfo(prisma, tenantId, filters.vesselCode);

  const from = new Date(Date.UTC(filters.year, filters.month - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(filters.year, filters.month, 1, 0, 0, 0));

  const movements = await (prisma as any).stockMovement.findMany({
    where: {
      tenantId,
      vesselCode: filters.vesselCode,
      occurredAt: { gte: from, lt: to },
    },
    select: {
      spareId: true, movementType: true, quantity: true,
      referenceType: true, referenceId: true,
    },
  });

  const consumptionMap = new Map<string, { qty: number; refs: Map<string, string> }>();
  for (const m of movements) {
    if (!NEGATIVE_MOVEMENT_TYPES.has(m.movementType)) continue;
    const prev = consumptionMap.get(m.spareId) ?? { qty: 0, refs: new Map<string, string>() };
    prev.qty += Math.abs(m.quantity);
    if (m.referenceType && m.referenceId) {
      prev.refs.set(`${m.referenceType}:${m.referenceId}`, m.referenceType);
    }
    consumptionMap.set(m.spareId, prev);
  }

  const spareIds = Array.from(consumptionMap.keys());
  if (spareIds.length === 0) {
    return {
      vessel,
      period: { year: filters.year, month: filters.month, fromIso: from.toISOString(), toIso: to.toISOString() },
      items: [],
      summary: { totalLines: 0, totalConsumedQty: 0 },
      documentRevision: consumptionRevision,
    };
  }

  const spares = await (prisma as any).spare.findMany({
    where: { id: { in: spareIds }, tenantId },
    select: { id: true, sku: true, name: true, unit: true, sfiCode: true, linkedAssetId: true },
  });

  const linkedAssetIds = spares.map((s: any) => s.linkedAssetId).filter(Boolean);
  const assetSfiMap = new Map<string, string | null>();
  if (linkedAssetIds.length > 0) {
    const assets = await (prisma as any).asset.findMany({
      where: { id: { in: linkedAssetIds }, tenantId },
      select: { id: true, sfiCode: true },
    });
    for (const a of assets) assetSfiMap.set(a.id, a.sfiCode ?? null);
  }

  const items: SpareConsumptionItem[] = [];
  let totalConsumed = 0;
  for (const s of spares) {
    const c = consumptionMap.get(s.id);
    if (!c) continue;
    const assetSfi = s.linkedAssetId ? assetSfiMap.get(s.linkedAssetId) ?? null : null;
    const refs = Array.from(c.refs.entries()).map(([key, type]) => {
      const id = key.substring(key.indexOf(":") + 1);
      return { type, id };
    });
    items.push({
      spareId: s.id,
      sku: s.sku,
      name: s.name,
      unit: s.unit,
      sfiCode: s.sfiCode ?? assetSfi ?? null,
      department: resolveSpareDepartment(s.sfiCode, assetSfi),
      consumed: c.qty,
      references: refs,
    });
    totalConsumed += c.qty;
  }

  items.sort((a, b) => (a.sfiCode ?? "").localeCompare(b.sfiCode ?? "") || a.name.localeCompare(b.name));

  return {
    vessel,
    period: { year: filters.year, month: filters.month, fromIso: from.toISOString(), toIso: to.toISOString() },
    items,
    summary: { totalLines: items.length, totalConsumedQty: totalConsumed },
    documentRevision: consumptionRevision,
  };
}

/**
 * Planilla "R/E Estándar de filtros, lubricantes y artículos" (Solicitud de
 * suministro). Estándar = Spare.targetStock (mitad redondeada hacia arriba en
 * modo HALF), a bordo = stock calculado, solicitud = lo que falta. Sólo entran
 * los ítems con estándar cargado y categoría Filtro/Lubricante/Refrigerante o
 * Artículo.
 */
export async function getSpareStandardReport(
  session: TenantAccessSession,
  filters: SpareStandardFilters,
): Promise<SpareStandardReport> {
  if (!filters.vesselCode) throw new RouteError(400, "VALIDATION_ERROR", "vesselCode es requerido.");
  assertVesselScope(session, filters.vesselCode);

  const department: Department = filters.department ?? "MAQUINAS";
  const mode = filters.mode === "HALF" ? "HALF" : "FULL";
  const voyageNumber = filters.voyageNumber?.trim().slice(0, 40) || null;

  const { prisma, tenantId } = await resolveTenantContext(session);
  const vessel = await loadVesselInfo(prisma, tenantId, filters.vesselCode);

  const spares = await (prisma as any).spare.findMany({
    where: {
      tenantId, vesselCode: filters.vesselCode, deletedAt: null, status: "ACTIVE",
      targetStock: { gt: 0 },
    },
    select: {
      id: true, name: true, category: true, unit: true, targetStock: true, sfiCode: true,
      linkedAssetId: true, manufacturerPartNumber: true, internalPartNumber: true,
    },
    orderBy: { name: "asc" },
  });

  const assetMap = await loadLinkedAssets(prisma, tenantId, spares);
  const onHandMap = await getOnHandMap(prisma, spares.map((s: any) => s.id));

  const items: SpareStandardItem[] = [];
  for (const s of spares) {
    const kind = spareKindFromCategory(s.category);
    if (kind !== "FILTER_LUBE" && kind !== "ARTICLE") continue;
    const asset = s.linkedAssetId ? assetMap.get(s.linkedAssetId) : undefined;
    const dept = resolveSpareDepartment(s.sfiCode, asset?.sfiCode ?? null);
    if (dept !== null && dept !== department) continue;

    const split = splitNameForEquipment(s.name);
    const standard = mode === "HALF" ? Math.ceil(s.targetStock / 2) : s.targetStock;
    // Un stock negativo es un error de carga: en la planilla cuenta como 0 a bordo.
    const onBoard = Math.max(0, onHandMap.get(s.id) ?? 0);
    items.push({
      id: s.id,
      section: kind,
      equipmentName: kind === "FILTER_LUBE" ? capitalize(asset?.name ?? split.equipment) : null,
      equipmentMakeModel: kind === "FILTER_LUBE" ? (asset?.makeModel ?? null) : null,
      itemLabel: asset || kind === "ARTICLE" ? s.name : split.item,
      partNumber: s.manufacturerPartNumber ?? s.internalPartNumber ?? null,
      unit: s.unit,
      standard,
      onBoard,
      request: Math.max(0, standard - onBoard),
    });
  }

  // Filtros/lubricantes agrupados por equipo, como la planilla; artículos por nombre.
  const sectionOrder = { FILTER_LUBE: 0, ARTICLE: 1 };
  items.sort((a, b) =>
    sectionOrder[a.section] - sectionOrder[b.section]
    || (a.equipmentName ?? "￿").localeCompare(b.equipmentName ?? "￿")
    || a.itemLabel.localeCompare(b.itemLabel));

  return {
    vessel,
    filters: { department, mode, voyageNumber },
    items,
    summary: { totalItems: items.length, itemsToRequest: items.filter(i => i.request > 0).length },
  };
}

function capitalize(text: string | null): string | null {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : null;
}
