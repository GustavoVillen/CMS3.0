import ExcelJS from "exceljs";
import { getPrismaClient } from "../../platform/data/prisma-client";
import type { TenantAccessSession } from "../auth/session-store";
import type { ExcelModule } from "./excel-permissions";
import { getModuleColumns } from "./excel-template";

const DYNAMIC_COLUMN_PRIORITIES: Record<ExcelModule, string[]> = {
  vessels: [
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  assets: [
    "equipmentClassId",
    "parentAssetId",
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  work_orders: [
    "holdReason",
    "cancelReason",
    "closeNotes",
    "independentVerifier",
    "testResult",
    "assignedToUserId",
    "maintenancePlanId",
    "assetId",
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  maintenance_plans: [
    "sfiGroupNumber",
    "sfiSubgroupCode",
    "responsible",
    "acceptanceCriteria",
    "loto",
    "riskLevel",
    "riskAnalysisResult",
    "frequencyHours",
    "frequencyMonths",
    "triggerResultMode",
    "taskMasterId",
    "executionStatus",
    "lastExecutionDate",
    "nextDueDate",
    "lastExecutionHours",
    "nextDueHours",
    "windowMode",
    "windowLeadDays",
    "windowLeadHours",
    "windowLeadPercent",
    "windowOpenDate",
    "windowOpenHours",
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  spares: [
    "currentStock",
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  providers: [
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  certificates: [
    "lastInspectionDate",
    "notes",
    "assetId",
    "originalSourceLink",
    "originalSourceName",
    "originalSourceMimeOrExt",
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
};

function sortDynamicKeys(module: ExcelModule, keys: string[]): string[] {
  const priorities = DYNAMIC_COLUMN_PRIORITIES[module];
  const priorityIndex = new Map<string, number>();
  priorities.forEach((key, index) => {
    priorityIndex.set(key, index);
  });

  return [...keys].sort((a, b) => {
    const aIdx = priorityIndex.get(a);
    const bIdx = priorityIndex.get(b);
    if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
    if (aIdx !== undefined) return -1;
    if (bIdx !== undefined) return 1;
    return a.localeCompare(b);
  });
}

export async function exportModule(
  session: TenantAccessSession,
  module: ExcelModule,
  filters: Record<string, string | null>
): Promise<Buffer> {
  const prisma = getPrismaClient();
  if (!prisma) throw new Error("Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new Error("Tenant no encontrado.");

  const baseWhere: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };

  // Vessel scope enforcement
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    baseWhere.vesselCode = { in: session.user.assignedVesselCodes };
  }

  // Apply optional vesselCode filter from query params
  if (filters.vesselCode) baseWhere.vesselCode = filters.vesselCode;

  const records = await fetchRecords(prisma, module, baseWhere, filters);
  return buildWorkbook(module, records);
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchRecords(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  module: ExcelModule,
  where: Record<string, unknown>,
  filters: Record<string, string | null>
): Promise<Record<string, unknown>[]> {
  switch (module) {
    case "vessels": {
      if (filters.status) where.status = filters.status;
      return prisma.vessel.findMany({ where, orderBy: { code: "asc" } }) as any;
    }
    case "assets": {
      if (filters.status)      where.status      = filters.status;
      if (filters.criticality) where.criticality = filters.criticality;
      return prisma.asset.findMany({ where, orderBy: [{ vesselCode: "asc" }, { assetCode: "asc" }] }) as any;
    }
    case "maintenance_plans": {
      if (filters.status)      where.status      = filters.status;
      if (filters.triggerType) where.triggerType = filters.triggerType;
      const rows = await prisma.maintenancePlan.findMany({
        where,
        orderBy: { nextDueDate: "asc" },
      }) as Array<Record<string, unknown> & { assetId: string; tenantId: string }>;

      // MaintenancePlan stores assetId as a "soft" FK (no Prisma @relation).
      // The template columns assetCode / sfiCode describe the linked Asset, not
      // the plan itself — fetch them in one query and merge.
      const assetIds = [...new Set(rows.map((r) => r.assetId).filter(Boolean))];
      const assets = assetIds.length
        ? await prisma.asset.findMany({
            where: { id: { in: assetIds }, tenantId: where.tenantId as string },
            select: { id: true, assetCode: true, sfiCode: true },
          })
        : [];
      const assetMap = new Map(assets.map((a) => [a.id, a]));

      return rows.map((r) => {
        const a = assetMap.get(r.assetId);
        return {
          ...r,
          assetCode: a?.assetCode ?? null,
          sfiCode:   a?.sfiCode   ?? null,
        };
      });
    }
    case "work_orders": {
      if (filters.status)   where.status   = filters.status;
      if (filters.priority) where.priority = filters.priority;
      if (filters.type)     where.type     = filters.type;
      return (prisma as any).workOrder.findMany({ where, orderBy: { openDate: "desc" } }) as any;
    }
    case "spares": {
      if (filters.status)      where.status      = filters.status;
      if (filters.criticality) where.criticality = filters.criticality;
      return prisma.spare.findMany({ where, orderBy: [{ vesselCode: "asc" }, { sku: "asc" }] }) as any;
    }
    case "providers": {
      if (filters.status)   where.status   = filters.status;
      if (filters.category) where.category = filters.category;
      return prisma.provider.findMany({ where, orderBy: { name: "asc" } }) as any;
    }
    case "certificates": {
      if (filters.status) where.status = filters.status;
      return prisma.certificate.findMany({ where, orderBy: { expiryDate: "asc" } }) as any;
    }
  }
}

// ---------------------------------------------------------------------------
// Build workbook
// ---------------------------------------------------------------------------

function toExcelValue(val: unknown): string | number | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString().split("T")[0];
  if (typeof val === "boolean") return val ? "true" : "false";
  return val as string | number;
}

async function buildWorkbook(module: ExcelModule, records: Record<string, unknown>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GPMS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(module);
  const templateCols = getModuleColumns(module);

  const baseCols = templateCols.map((c) => ({ key: c.key, header: c.header, width: c.width ?? 20 }));
  const reserved = new Set(baseCols.map((c) => c.key));
  reserved.add("id");
  reserved.add("createdAt");
  reserved.add("updatedAt");

  // Include every extra field returned by DB so exports remain complete when schema evolves.
  const dynamicKeys: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (reserved.has(key)) continue;
      reserved.add(key);
      dynamicKeys.push(key);
    }
  }

  const dynamicCols = sortDynamicKeys(module, dynamicKeys).map((key) => ({
    key,
    header: key,
    width: Math.min(Math.max(key.length + 4, 14), 36),
  }));

  // Export columns = template columns + detected fields + audit columns
  const exportCols = [
    ...baseCols,
    ...dynamicCols,
    { key: "id", header: "id", width: 30 },
    { key: "createdAt", header: "createdAt", width: 22 },
    { key: "updatedAt", header: "updatedAt", width: 22 },
  ];

  sheet.columns = exportCols;

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
  headerRow.commit();

  for (const record of records) {
    const row: Record<string, string | number | null> = {};
    for (const col of exportCols) {
      row[col.key] = toExcelValue(record[col.key]);
    }
    sheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
