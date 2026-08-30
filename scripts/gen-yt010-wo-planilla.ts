/**
 * Genera planilla CSV con OTs que YT010 debería tener ejecutando entre 1 Ene 2026 y hoy.
 * Calcula cuándo vence cada plan según su frecuencia y genera los registros.
 *
 * Uso:
 *   DATABASE_URL=<url> npx tsx scripts/gen-yt010-wo-planilla.ts
 *   OUT_FILE=mi-planilla.csv ...
 */
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const VESSEL = "YT010";
const TENANT_SLUG = "mercurio";
const OUT_FILE = process.env.OUT_FILE || "yt010-wo-planilla.xlsx";

// Usar medianoche LOCAL (no UTC) para evitar problemas de zona horaria
function localDate(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}

const START_DATE = localDate(2026, 1, 1);
const END_DATE = localDate(2026, 7, 7);

// ── Helpers ───────────────────────────────────────────────────────────────
function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoTime(d: Date): string {
  return d.toISOString();
}

/** Calcula todas las fechas de vencimiento entre START y END para un plan */
function calculateDueDates(
  initialDate: Date,
  triggerType: string,
  frequencyMonths: number | null,
  frequencyHours: number | null,
  upTo: Date,
): Date[] {
  const dates: Date[] = [];
  let current = new Date(initialDate);

  if (triggerType === "MONTHS" || triggerType === "CALENDAR") {
    const freq = frequencyMonths || 1;
    while (current <= upTo) {
      if (current >= START_DATE && current <= upTo) {
        dates.push(new Date(current));
      }
      current = addMonths(current, freq);
    }
  } else if (triggerType === "DAY") {
    const freq = frequencyMonths || 1; // Almacenado en frequencyMonths pero es días
    while (current <= upTo) {
      if (current >= START_DATE && current <= upTo) {
        dates.push(new Date(current));
      }
      current = addDays(current, freq);
    }
  } else if (triggerType === "WEEK") {
    const freq = frequencyMonths || 1; // Almacenado en frequencyMonths pero es semanas
    while (current <= upTo) {
      if (current >= START_DATE && current <= upTo) {
        dates.push(new Date(current));
      }
      current = addWeeks(current, freq);
    }
  }

  return dates;
}

/** Genera código único para OT (secuencial por plan) */
function generateWoCode(planCode: string, index: number): string {
  return `${planCode}-WO-${String(index + 1).padStart(3, "0")}`;
}

interface WorkOrderRow {
  workOrderCode: string;
  vesselCode: string;
  type: string;
  status: string;
  priority: string;
  criticality: string;
  title: string;
  openDate: string;
  dueDate: string;
  startDate: string;
  completedDate: string;
  estimatedHours: string;
  description: string;
  id: string;
  createdAt: string;
  updatedAt: string;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true },
  });
  if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' no encontrado.`);

  const vessel = await prisma.vessel.findUnique({
    where: { tenantId_code: { tenantId: tenant.id, code: VESSEL } },
    select: { id: true, name: true },
  });
  if (!vessel) throw new Error(`Vessel '${VESSEL}' no encontrado.`);

  const plans = await prisma.maintenancePlan.findMany({
    where: {
      tenantId: tenant.id,
      vesselCode: VESSEL,
      status: "ACTIVE",
      triggerType: { in: ["MONTHS", "DAY", "WEEK", "CALENDAR"] },
    },
    orderBy: { taskCode: "asc" },
  });

  // Buscar assets para obtener criticality
  const assetIds = [...new Set(plans.map((p) => p.assetId))];
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, criticality: true },
  });
  const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]));

  console.log(`\n📋 Generando OTs para ${VESSEL} (${plans.length} planes)...`);
  console.log(`   Período: ${iso(START_DATE)} → ${iso(END_DATE)}\n`);

  const rows: WorkOrderRow[] = [];
  let totalWos = 0;

  for (const plan of plans) {
    const dueDates = calculateDueDates(
      START_DATE, // Asumir que el plan inicia el 1 Ene
      plan.triggerType,
      plan.frequencyMonths,
      plan.frequencyHours,
      END_DATE,
    );

    console.log(
      `${plan.taskCode}: ${plan.title}` +
        `\n  Trigger: ${plan.triggerType}, Freq: ${plan.frequencyMonths || plan.frequencyHours} ` +
        `\n  → ${dueDates.length} OT(s) vencidas`,
    );

    for (let i = 0; i < dueDates.length; i++) {
      const dueDate = dueDates[i];
      const woCode = generateWoCode(plan.taskCode, i);
      const criticality = assetMap[plan.assetId]?.criticality || "B";

      rows.push({
        workOrderCode: woCode,
        vesselCode: VESSEL,
        type: "PREVENTIVE",
        status: "PLANNED",
        priority: criticality === "A" ? "HIGH" : criticality === "B" ? "MEDIUM" : "LOW",
        criticality,
        title: plan.title,
        openDate: iso(dueDate),
        dueDate: iso(dueDate),
        startDate: "",
        completedDate: "",
        estimatedHours: plan.estimatedHours?.toString() || "0",
        description: "",
        id: "",
        createdAt: isoTime(new Date()),
        updatedAt: isoTime(new Date()),
      });
      totalWos++;
    }

    console.log("");
  }

  // ── Generar Excel ────────────────────────────────────────────────────────
  if (rows.length === 0) {
    console.log("⚠️  No hay OTs para el período especificado.");
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Work Orders");

  // Headers
  const headers = Object.keys(rows[0]);
  worksheet.columns = headers.map((h) => ({
    header: h,
    key: h,
    width: h === "title" || h === "description" ? 40 : h === "workOrderCode" ? 30 : 15,
  }));

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF366092" } };
  headerRow.alignment = { horizontal: "center", vertical: "center", wrapText: true };

  // Add rows
  rows.forEach((row) => {
    worksheet.addRow(row);
  });

  // Auto-fit columns based on content
  worksheet.columns.forEach((col) => {
    if (col.width === 15) col.width = Math.min(20, Math.max(12, col.header?.toString().length || 12));
  });

  // Save
  await workbook.xlsx.writeFile(OUT_FILE);

  console.log(`\n✅ Planilla generada: ${OUT_FILE}`);
  console.log(`   Total OTs: ${totalWos}`);
  console.log(`   Total filas: ${rows.length}`);
}

main()
  .catch((e) => {
    console.error("❌ Error:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
