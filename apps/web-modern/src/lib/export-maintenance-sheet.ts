// Planilla de mantenimiento en Excel (.xlsx) con el formato de papel que usa la
// flota: una fila por tarea, agrupadas por equipo, con el ítem y la descripción
// del equipo combinados verticalmente sobre su bloque.
//
//   Ítem | Descripción (equipo + modelo) | Tarea a realizar | Realizar cada |
//   Última verificación | Próximo recorrido
//
// Las tareas por HORAS muestran el horómetro (23.564 → 24.064); las de
// calendario muestran fechas (17/06/2026 → 14/12/2026). Es una foto del estado
// actual de los planes del buque, no un histórico.
//
// Se genera en el cliente con exceljs (import dinámico → chunk aparte, no
// engorda el bundle principal), igual que la exportación de la Matriz.

import { api } from "./api";

/** Plan tal como lo devuelve `/app/pms/maintenance-plans`, recortado a lo que la planilla usa. */
export interface SheetPlan {
  id: string;
  taskCode: string;
  title: string;
  assetId?: string | null;
  assetName: string | null;
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
  lastExecutionDate: string | null;
  lastExecutionHours?: number | null;
  nextDueDate: string | null;
  nextDueHours?: number | null;
}

interface AssetInfo { id: string; name: string | null; manufacturer?: string | null; model?: string | null }

const isHours = (t: string) => t === "HOURS" || t === "RUNNING_HOURS";
const isMonths = (t: string) => t === "MONTHS" || t === "CALENDAR";

/** "Realizar cada": número de horas, o el lapso en palabras (6 meses, 7 días…). */
function everyLabel(p: SheetPlan): string | number {
  const t = p.triggerType;
  if (isHours(t)) return p.frequencyHours ?? "—";
  // DAY y WEEK guardan su valor en frequencyMonths (ver recalculateNextDue en la API).
  const n = p.frequencyMonths;
  if (n == null) return "—";
  if (isMonths(t)) return n === 1 ? "1 mes" : `${n} meses`;
  if (t === "DAY") return n === 1 ? "1 día" : `${n} días`;
  if (t === "WEEK") return n === 1 ? "1 semana" : `${n} semanas`;
  if (t === "CONDITION") return "Según condición";
  if (t === "EVENT") return "Por evento";
  return "—";
}

function fmtDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Última verificación / próximo recorrido: horómetro si el plan va por horas, si no fecha. */
function milestone(p: SheetPlan, which: "last" | "next"): string | number {
  if (isHours(p.triggerType)) {
    const h = which === "last" ? p.lastExecutionHours : p.nextDueHours;
    return h ?? "N/A";
  }
  return fmtDate(which === "last" ? p.lastExecutionDate : p.nextDueDate) ?? "N/A";
}

/** Orden estable dentro del equipo: primero las de horas, después las de calendario. */
function sortPlans(a: SheetPlan, b: SheetPlan): number {
  const ah = isHours(a.triggerType) ? 0 : 1;
  const bh = isHours(b.triggerType) ? 0 : 1;
  if (ah !== bh) return ah - bh;
  const av = (isHours(a.triggerType) ? a.frequencyHours : a.frequencyMonths) ?? Number.MAX_SAFE_INTEGER;
  const bv = (isHours(b.triggerType) ? b.frequencyHours : b.frequencyMonths) ?? Number.MAX_SAFE_INTEGER;
  if (av !== bv) return av - bv;
  return a.title.localeCompare(b.title, "es");
}

export async function exportMaintenanceSheet(opts: {
  vesselCode: string;
  vesselName: string;
}): Promise<void> {
  const { vesselCode, vesselName } = opts;

  // La planilla trae su PROPIA lista completa del buque: la pantalla del Gantt
  // carga como máximo 500 planes, y exportar una planilla recortada en silencio
  // sería peor que no exportarla.
  const listed = await api.get<{ items: SheetPlan[] }>(
    `/app/pms/maintenance-plans?vesselCode=${encodeURIComponent(vesselCode)}&limit=2000`,
  );
  const plans = (listed.items ?? []).filter(p => (p as { status?: string }).status !== "INACTIVE");
  if (plans.length === 0) throw new Error("Este buque no tiene tareas de mantenimiento para exportar.");

  // Marca y modelo salen del catálogo de equipos (la lista de planes sólo trae
  // el nombre). Si falla, la planilla igual sale: sólo pierde esa segunda línea.
  let assetById = new Map<string, AssetInfo>();
  try {
    const res = await api.get<{ items: AssetInfo[] }>(
      `/app/pms/assets?vesselCode=${encodeURIComponent(vesselCode)}&limit=500`,
    );
    assetById = new Map((res.items ?? []).map(a => [a.id, a]));
  } catch { /* sin catálogo: se muestra sólo el nombre del equipo */ }

  // Agrupar por equipo, respetando el orden alfabético del nombre.
  const groups = new Map<string, { name: string; subtitle: string; plans: SheetPlan[] }>();
  for (const p of plans) {
    const key = p.assetId ?? `__sin__${p.assetName ?? ""}`;
    if (!groups.has(key)) {
      const a = p.assetId ? assetById.get(p.assetId) : undefined;
      const subtitle = [a?.manufacturer, a?.model].filter(Boolean).join(" ");
      groups.set(key, { name: p.assetName ?? a?.name ?? "Sin equipo asignado", subtitle, plans: [] });
    }
    groups.get(key)!.plans.push(p);
  }
  const ordered = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  ordered.forEach(g => g.plans.sort(sortPlans));

  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(vesselName.slice(0, 28) || vesselCode, {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const thin = { style: "thin" as const, color: { argb: "FF000000" } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const HEADERS = ["Ítem", "Descripción", "Tarea a realizar", "Realizar cada: Hs/lapso", "Última verificación", "Próximo recorrido"];

  // Encabezado
  const hr = ws.getRow(1);
  HEADERS.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 10, color: { argb: "FF000000" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2E3" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = border;
  });
  hr.height = 30;

  // Bloques por equipo
  let r = 2;
  ordered.forEach((g, gi) => {
    const first = r;
    for (const p of g.plans) {
      const row = ws.getRow(r);

      const task = row.getCell(3);
      task.value = p.title;
      task.alignment = { horizontal: "left", vertical: "middle", wrapText: true };

      const every = row.getCell(4);
      every.value = everyLabel(p);
      if (typeof every.value === "number") every.numFmt = "#,##0";

      const last = row.getCell(5);
      last.value = milestone(p, "last");
      if (typeof last.value === "number") last.numFmt = "#,##0";

      const next = row.getCell(6);
      next.value = milestone(p, "next");
      if (typeof next.value === "number") next.numFmt = "#,##0";

      // Amarillo + texto azul oscuro, como la planilla de papel.
      [task, every, last, next].forEach((c, i) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
        c.font = { size: 10, color: { argb: "FF1F3864" } };
        c.border = border;
        if (i > 0) c.alignment = { horizontal: "center", vertical: "middle" };
      });
      r++;
    }
    const last = r - 1;

    // Ítem y Descripción combinados sobre todo el bloque del equipo.
    ws.mergeCells(first, 1, last, 1);
    const item = ws.getCell(first, 1);
    item.value = gi + 1;
    item.font = { bold: true, size: 11 };
    item.alignment = { horizontal: "center", vertical: "middle" };

    ws.mergeCells(first, 2, last, 2);
    const desc = ws.getCell(first, 2);
    desc.value = g.subtitle ? `${g.name}\n${g.subtitle}` : g.name;
    desc.font = { bold: true, size: 10, color: { argb: "FF000000" } };
    desc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8CBAD" } };
    desc.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

    // Bordes en cada celda del bloque combinado (Excel no los hereda del merge).
    for (let i = first; i <= last; i++) {
      ws.getCell(i, 1).border = border;
      ws.getCell(i, 2).border = border;
    }
  });

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 32;
  ws.getColumn(3).width = 62;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 16;
  ws.getColumn(6).width = 16;
  ws.autoFilter = { from: { row: 1, column: 3 }, to: { row: r - 1, column: 6 } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Planilla-Mantenimiento-${vesselName || vesselCode}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
