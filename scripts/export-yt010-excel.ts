/**
 * Exporta Assets + MaintenancePlans + Spares de YT010 a Excels .xlsx listos para importar en VPS.
 * Uso:
 *   DATABASE_URL=<url> npx tsx scripts/export-yt010-excel.ts
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as path from "path";
import * as fs from "fs";

// Intenta importar exceljs, si no está disponible usa xlsx
let ExcelJS: any;
try {
  ExcelJS = require("exceljs");
} catch (e) {
  console.log("⚠ exceljs no disponible, intentando con xlsx...");
  ExcelJS = require("xlsx");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = "mercurio";
const VESSEL = "YT010";

// Genera Excel
async function generateExcel(filename: string, sheetName: string, headers: string[], rows: any[]): Promise<void> {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);

    // Add headers
    worksheet.addRow(headers);
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3D3D3" } };

    // Add data rows
    for (const row of rows) {
      worksheet.addRow(headers.map(h => row[h] || ""));
    }

    // Auto-adjust column widths
    worksheet.columns.forEach(col => {
      let maxLength = 0;
      col.eachCell?.((cell: any) => {
        const len = String(cell.value || "").length;
        if (len > maxLength) maxLength = len;
      });
      col.width = Math.min(maxLength + 2, 50);
    });

    await workbook.xlsx.writeFile(filename);
    console.log(`✓ ${path.basename(filename)} (${rows.length} filas)`);
  } catch (e) {
    console.error(`❌ Error generando ${filename}:`, (e as Error).message);
    throw e;
  }
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado`);
  const tid = tenant.id;

  // ── ASSETS ──────────────────────────────────────────────────────────────
  const assets = await prisma.asset.findMany({
    where: { tenantId: tid, vesselCode: VESSEL, deletedAt: null },
    orderBy: { assetCode: "asc" },
  });

  const assetRows = assets.map(a => ({
    vesselCode: VESSEL,
    sfiCode: a.sfiCode || "",
    assetCode: a.assetCode,
    name: a.name,
    criticality: a.criticality,
    status: a.status,
    manufacturer: a.manufacturer || "",
    model: a.model || "",
    serialNumber: a.serialNumber || "",
    installationDate: a.installationDate ? a.installationDate.toISOString().split("T")[0] : "",
    lastOverhaulDate: a.lastOverhaulDate ? a.lastOverhaulDate.toISOString().split("T")[0] : "",
    replacementDate: a.replacementDate ? a.replacementDate.toISOString().split("T")[0] : "",
    trackDailyReport: a.trackDailyReport ? "true" : "false",
    id: "",
    createdAt: "",
    updatedAt: "",
  }));

  await generateExcel(
    path.join(process.cwd(), "YT010_Assets.xlsx"),
    "Assets",
    ["vesselCode", "sfiCode", "assetCode", "name", "criticality", "status", "manufacturer", "model", "serialNumber", "installationDate", "lastOverhaulDate", "replacementDate", "trackDailyReport", "id", "createdAt", "updatedAt"],
    assetRows
  );

  // ── MAINTENANCE PLANS ───────────────────────────────────────────────────
  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId: tid, vesselCode: VESSEL, deletedAt: null },
    orderBy: { taskCode: "asc" },
  });

  const planRows = plans.map(p => ({
    vesselCode: VESSEL,
    assetCode: p.taskCode?.split("-")?.slice(0, -1)?.join("-") || "",
    sfiGroupNumber: p.sfiGroupNumber || "",
    sfiCode: p.sfiCode || "",
    taskCode: p.taskCode,
    title: p.title,
    description: p.description || "",
    taskType: p.taskType || "",
    triggerType: p.triggerType || "",
    frequencyMonths: p.frequencyMonths || "",
    frequencyHours: p.frequencyHours || "",
    estimatedHours: p.estimatedHours || "",
    responsible: p.responsible || "",
    acceptanceCriteria: p.acceptanceCriteria || "",
    loto: p.loto ? "true" : "false",
    riskLevel: p.riskLevel || "",
    riskAnalysisResult: p.riskAnalysisResult || "",
    consequenceCategory: p.consequenceCategory || "",
    consequenceRationale: p.consequenceRationale || "",
    triggerResultMode: p.triggerResultMode || "",
    windowMode: p.windowMode || "",
    windowLeadDays: p.windowLeadDays || "",
    windowLeadHours: p.windowLeadHours || "",
    lastExecutionDate: p.lastExecutionDate ? p.lastExecutionDate.toISOString().split("T")[0] : "",
    nextDueDate: p.nextDueDate ? p.nextDueDate.toISOString().split("T")[0] : "",
    lastExecutionHours: p.lastExecutionHours || "",
    nextDueHours: p.nextDueHours || "",
    checklistTemplate: p.checklistTemplate || "",
    samplingKind: p.samplingKind || "",
    samplingFluidType: p.samplingFluidType || "",
    status: p.status,
    id: "",
    createdAt: "",
    updatedAt: "",
  }));

  await generateExcel(
    path.join(process.cwd(), "YT010_MaintenancePlans.xlsx"),
    "MaintenancePlans",
    ["vesselCode", "assetCode", "sfiGroupNumber", "sfiCode", "taskCode", "title", "description", "taskType", "triggerType", "frequencyMonths", "frequencyHours", "estimatedHours", "responsible", "acceptanceCriteria", "loto", "riskLevel", "riskAnalysisResult", "consequenceCategory", "consequenceRationale", "triggerResultMode", "windowMode", "windowLeadDays", "windowLeadHours", "lastExecutionDate", "nextDueDate", "lastExecutionHours", "nextDueHours", "checklistTemplate", "samplingKind", "samplingFluidType", "status", "id", "createdAt", "updatedAt"],
    planRows
  );

  // ── SPARES ──────────────────────────────────────────────────────────────
  const spares = await prisma.spare.findMany({
    where: { tenantId: tid, vesselCode: VESSEL, deletedAt: null },
    orderBy: { sku: "asc" },
  });

  const spareRows = spares.map(s => ({
    vesselCode: VESSEL,
    sku: s.sku,
    name: s.name,
    category: s.category || "",
    criticality: s.criticality,
    status: s.status,
    manufacturer: s.manufacturer || "",
    model: s.model || "",
    internalPartNumber: s.internalPartNumber || "",
    manufacturerPartNumber: s.manufacturerPartNumber || "",
    unit: s.unit,
    currentStock: s.currentStock || "",
    minStock: s.minStock || "",
    reorderPoint: s.reorderPoint || "",
    targetStock: s.targetStock || "",
    location: s.location || "",
    sfiCode: s.sfiCode || "",
    leadTimeDays: s.leadTimeDays || "",
    longDescription: s.longDescription || "",
    id: "",
    createdAt: "",
    updatedAt: "",
  }));

  await generateExcel(
    path.join(process.cwd(), "YT010_Spares.xlsx"),
    "Spares",
    ["vesselCode", "sku", "name", "category", "criticality", "status", "manufacturer", "model", "internalPartNumber", "manufacturerPartNumber", "unit", "currentStock", "minStock", "reorderPoint", "targetStock", "location", "sfiCode", "leadTimeDays", "longDescription", "id", "createdAt", "updatedAt"],
    spareRows
  );

  console.log(`\n✅ Exportados 3 archivos Excel:`);
  console.log(`  - YT010_Assets.xlsx (${assetRows.length} activos)`);
  console.log(`  - YT010_MaintenancePlans.xlsx (${planRows.length} planes)`);
  console.log(`  - YT010_Spares.xlsx (${spareRows.length} repuestos)`);
  console.log(`\nDescárgalos e importa en: https://mercurio.cms3.shipcms.cloud/`);
}

main()
  .catch(e => {
    console.error("❌ Error:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
