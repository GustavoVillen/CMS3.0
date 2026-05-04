import ExcelJS from "exceljs";
import { getPrismaClient } from "../data/prisma-client";
import { escapeFormula, toExcelValue } from "../../tenant/excel/excel-export-service";

// Weekly backup datasets — each item produces ONE Excel file in the ZIP.
// `filename` is what the user sees inside the ZIP; `label` is the human title.
// `fetch` returns the rows scoped to a tenant (no soft-deleted rows).
//
// We deliberately don't reuse `excel-export-service.exportModule()`:
// that one is built for the interactive import/export flow (vessel scope,
// filters, role-restricted columns). Backups must dump everything in the
// tenant, no filters, no scope. Sharing the buildWorkbook helpers via the
// `escapeFormula` / `toExcelValue` exports keeps formula-injection guarantees
// without coupling the two flows.

interface BackupDatasetSpec {
  filename: string;
  label: string;
  fetch: (tenantId: string) => Promise<Record<string, unknown>[]>;
}

export interface BackupFile {
  filename: string;
  buffer: Buffer;
}

function flattenFluidSample(row: Record<string, unknown>): Record<string, unknown> {
  // FluidSample has a 1:1 relation `result` (FluidAnalysisResult). Flatten it
  // so the backup carries the lab outcome inline rather than forcing the user
  // to cross-reference two sheets.
  const result = (row as { result?: Record<string, unknown> | null }).result;
  if (!result) {
    const { result: _omit, ...rest } = row as Record<string, unknown>;
    void _omit;
    return rest;
  }
  const { result: _omit, ...rest } = row as Record<string, unknown>;
  void _omit;
  const prefixed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result)) {
    if (k === "id" || k === "tenantId" || k === "fluidSampleId") continue;
    prefixed[`result_${k}`] = v;
  }
  return { ...rest, ...prefixed };
}

const BACKUP_DATASETS: BackupDatasetSpec[] = [
  {
    filename: "Buques.xlsx",
    label: "Buques",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.vessel.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { code: "asc" },
      })) as unknown as Record<string, unknown>[];
    },
  },
  {
    filename: "Equipos.xlsx",
    label: "Equipos",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.asset.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: [{ vesselCode: "asc" }, { assetCode: "asc" }],
      })) as unknown as Record<string, unknown>[];
    },
  },
  {
    filename: "Plan_de_Mantenimiento.xlsx",
    label: "Plan de Mantenimiento",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.maintenancePlan.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: [{ vesselCode: "asc" }, { taskCode: "asc" }],
      })) as unknown as Record<string, unknown>[];
    },
  },
  {
    filename: "Ordenes_de_Trabajo.xlsx",
    label: "Órdenes de Trabajo",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.workOrder.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { openDate: "desc" },
      })) as unknown as Record<string, unknown>[];
    },
  },
  {
    filename: "Reportes_Diarios.xlsx",
    label: "Reportes Diarios",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.dailyReport.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: [{ vesselCode: "asc" }, { reportDate: "desc" }],
      })) as unknown as Record<string, unknown>[];
    },
  },
  {
    filename: "Reportes_Mensuales.xlsx",
    label: "Reportes Mensuales",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.monthlyReport.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: [{ vesselCode: "asc" }, { periodYear: "desc" }, { periodMonth: "desc" }],
      })) as unknown as Record<string, unknown>[];
    },
  },
  {
    filename: "Defectos.xlsx",
    label: "Defectos",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.defect.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: "desc" },
      })) as unknown as Record<string, unknown>[];
    },
  },
  {
    filename: "Bitacora.xlsx",
    label: "Bitácora",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.bitacoraEntry.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { entryAt: "desc" },
      })) as unknown as Record<string, unknown>[];
    },
  },
  {
    filename: "Diferimientos.xlsx",
    label: "Diferimientos",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.deferral.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: "desc" },
      })) as unknown as Record<string, unknown>[];
    },
  },
  {
    filename: "Certificados.xlsx",
    label: "Certificados",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.certificate.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { expiryDate: "asc" },
      })) as unknown as Record<string, unknown>[];
    },
  },
  {
    filename: "Analisis_de_Fluidos.xlsx",
    label: "Análisis de Fluidos",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      const rows = (await prisma.fluidSample.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { sampledAt: "desc" },
        include: { result: true },
      })) as unknown as Record<string, unknown>[];
      return rows.map(flattenFluidSample);
    },
  },
  {
    filename: "Solicitudes_de_Repuestos.xlsx",
    label: "Solicitudes de Repuestos",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.spareRequest.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: "desc" },
      })) as unknown as Record<string, unknown>[];
    },
  },
  {
    filename: "Repuestos.xlsx",
    label: "Repuestos",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.spare.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: [{ vesselCode: "asc" }, { sku: "asc" }],
      })) as unknown as Record<string, unknown>[];
    },
  },
  {
    filename: "Proveedores.xlsx",
    label: "Proveedores",
    fetch: async (tenantId) => {
      const prisma = getPrismaClient();
      if (!prisma) return [];
      return (await prisma.provider.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { name: "asc" },
      })) as unknown as Record<string, unknown>[];
    },
  },
];

async function buildWorkbookFromRecords(
  sheetName: string,
  records: Record<string, unknown>[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GPMS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName.slice(0, 31)); // ExcelJS sheet name limit
  // Discover columns by union over all records (handles sparse rows safely).
  const seen = new Set<string>();
  const columnKeys: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columnKeys.push(key);
    }
  }

  if (columnKeys.length === 0) {
    // Empty dataset — still emit a workbook with a single placeholder column
    // so the file is valid and the operator sees the module included.
    sheet.columns = [{ key: "info", header: "info", width: 40 }];
    sheet.addRow({ info: "(sin datos)" });
  } else {
    sheet.columns = columnKeys.map((key) => ({
      key,
      header: key,
      width: Math.min(Math.max(key.length + 4, 14), 40),
    }));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
    headerRow.commit();

    for (const record of records) {
      const row: Record<string, string | number | null> = {};
      for (const key of columnKeys) {
        const v = record[key];
        row[key] = v === undefined ? null : toExcelValue(v);
      }
      // Sanitize string headers themselves are static — no injection vector there.
      // Cell values pass through toExcelValue → escapeFormula.
      sheet.addRow(row);
    }
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// We import escapeFormula only to keep the dependency edge explicit; the
// runtime work happens inside toExcelValue. Re-export to avoid unused import.
void escapeFormula;

export async function buildAllBackupFiles(tenantId: string): Promise<BackupFile[]> {
  const out: BackupFile[] = [];
  for (const ds of BACKUP_DATASETS) {
    const records = await ds.fetch(tenantId);
    const buffer = await buildWorkbookFromRecords(ds.label, records);
    out.push({ filename: ds.filename, buffer });
  }
  return out;
}

export function listBackupDatasetLabels(): string[] {
  return BACKUP_DATASETS.map((d) => d.label);
}
