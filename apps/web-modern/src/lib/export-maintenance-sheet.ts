// Planilla de mantenimiento en Excel (.xlsx) con el formato de papel que usa la
// flota: una banda de título con el logo del armador y el nombre del buque,
// las tareas agrupadas por GRUPO SFI (G1: Casco y Estructuras, G2: Sistemas de
// Carga…) y, dentro de cada grupo, una fila por tarea con el ítem y la
// descripción del equipo combinados verticalmente sobre su bloque.
//
//   Ítem | Descripción (equipo + modelo) | Tarea a realizar | Realizar cada |
//   Última verificación | Próximo recorrido
//
// Las tareas por HORAS muestran el horómetro (23.564 → 24.064); las de
// calendario muestran fechas (17/06/2026 → 14/12/2026). Es una foto del estado
// actual de los planes del buque, no un histórico.
//
// Semáforo: las filas de tareas VENCIDAS salen en rojo y las PRÓXIMAS A VENCER
// (por vencer, en ventana o dentro de los 30 días) en amarillo, usando el mismo
// `executionStatus` que colorea el Gantt y el resto del PMS.
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
  /** Estado calculado por la API (OVERDUE / DUE / IN_WINDOW / UPCOMING / …). */
  executionStatus?: string | null;
  /** Grupo SFI del plan (0–9). Si falta, se deriva del código SFI del equipo. */
  sfiGroupNumber?: number | null;
}

interface AssetInfo { id: string; name: string | null; manufacturer?: string | null; model?: string | null; sfiCode?: string | null }

const isHours = (t: string) => t === "HOURS" || t === "RUNNING_HOURS";
const isMonths = (t: string) => t === "MONTHS" || t === "CALENDAR";

// ─── Grupos SFI ───────────────────────────────────────────────────────────────
// Mismas etiquetas que el resto de la app (claves "sfi.g.N" del diccionario i18n).
const SFI_GROUP_NAMES: Record<number, string> = {
  0: "Inspecciones y Pruebas",
  1: "Casco y Estructuras",
  2: "Sistemas de Carga",
  3: "LCI y Salvamento",
  4: "Sistemas de Navegación",
  5: "Sistemas de Habitabilidad",
  6: "Sistemas de Propulsión y Generación",
  7: "Sistemas Auxiliares",
  8: "Sistemas Eléctricos",
  9: "Sistemas de Automatización y Control",
};
const NO_GROUP = 99;

/** Primer dígito del código SFI del equipo → grupo (fallback si el plan no lo trae). */
function groupOfSfiCode(sfiCode: string | null | undefined): number | null {
  const d = (sfiCode ?? "").trim()[0];
  return /^[0-9]$/.test(d ?? "") ? Number(d) : null;
}

function groupBanner(g: number): string {
  return g === NO_GROUP ? "Sin grupo SFI asignado" : `G${g}: ${SFI_GROUP_NAMES[g] ?? ""}`;
}

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

/** Semáforo de la fila, derivado del estado que ya calcula la API. */
type Severity = "overdue" | "soon" | "none";
function severityOf(p: SheetPlan): Severity {
  switch ((p.executionStatus ?? "").toUpperCase()) {
    case "OVERDUE": return "overdue";
    case "DUE":
    case "IN_WINDOW":
    case "UPCOMING": return "soon";
    default: return "none";
  }
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

/**
 * Baja el logo del armador y lo deja listo para incrustar. Si falla (CORS, 404,
 * tenant sin logo) devuelve null: la planilla sale igual, sólo sin logo.
 */
async function loadLogo(url: string | null | undefined): Promise<{ base64: string; extension: "png" | "jpeg" | "gif"; ratio: number } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const extension = blob.type.includes("jpeg") || blob.type.includes("jpg")
      ? "jpeg"
      : blob.type.includes("gif") ? "gif" : "png";
    const base64 = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
    const ratio = await new Promise<number>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalHeight ? img.naturalWidth / img.naturalHeight : 3);
      img.onerror = () => resolve(3);
      img.src = base64;
    });
    return { base64, extension, ratio };
  } catch {
    return null;
  }
}

export async function exportMaintenanceSheet(opts: {
  vesselCode: string;
  vesselName: string;
  /** Logo del tenant (el mismo que muestra el header). Opcional. */
  logoUrl?: string | null;
}): Promise<void> {
  const { vesselCode, vesselName, logoUrl } = opts;

  // La planilla trae su PROPIA lista completa del buque: la pantalla del Gantt
  // carga como máximo 500 planes, y exportar una planilla recortada en silencio
  // sería peor que no exportarla.
  const listed = await api.get<{ items: SheetPlan[] }>(
    `/app/pms/maintenance-plans?vesselCode=${encodeURIComponent(vesselCode)}&limit=2000`,
  );
  const plans = (listed.items ?? []).filter(p => (p as { status?: string }).status !== "INACTIVE");
  if (plans.length === 0) throw new Error("Este buque no tiene tareas de mantenimiento para exportar.");

  // Marca, modelo y código SFI salen del catálogo de equipos (la lista de planes
  // sólo trae el nombre). Si falla, la planilla igual sale: pierde esa segunda
  // línea y el grupo se deduce sólo del que trae cada plan.
  let assetById = new Map<string, AssetInfo>();
  try {
    const res = await api.get<{ items: AssetInfo[] }>(
      `/app/pms/assets?vesselCode=${encodeURIComponent(vesselCode)}&limit=500`,
    );
    assetById = new Map((res.items ?? []).map(a => [a.id, a]));
  } catch { /* sin catálogo: se muestra sólo el nombre del equipo */ }

  // Agrupar por equipo, respetando el orden alfabético del nombre.
  interface EquipBlock { name: string; subtitle: string; group: number; plans: SheetPlan[] }
  const groups = new Map<string, EquipBlock>();
  for (const p of plans) {
    const key = p.assetId ?? `__sin__${p.assetName ?? ""}`;
    if (!groups.has(key)) {
      const a = p.assetId ? assetById.get(p.assetId) : undefined;
      const subtitle = [a?.manufacturer, a?.model].filter(Boolean).join(" ");
      groups.set(key, {
        name: p.assetName ?? a?.name ?? "Sin equipo asignado",
        subtitle,
        // El grupo del equipo lo manda su código SFI; si no lo tiene, el del plan.
        group: groupOfSfiCode(a?.sfiCode) ?? p.sfiGroupNumber ?? NO_GROUP,
        plans: [],
      });
    }
    const blk = groups.get(key)!;
    if (blk.group === NO_GROUP && p.sfiGroupNumber != null) blk.group = p.sfiGroupNumber;
    blk.plans.push(p);
  }
  const equipos = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  equipos.forEach(g => g.plans.sort(sortPlans));

  // Bloques de equipos repartidos por grupo SFI, en orden 0…9 y "sin grupo" al final.
  const byGroup = new Map<number, EquipBlock[]>();
  for (const e of equipos) {
    if (!byGroup.has(e.group)) byGroup.set(e.group, []);
    byGroup.get(e.group)!.push(e);
  }
  const orderedGroups = [...byGroup.keys()].sort((a, b) => a - b);

  const logo = await loadLogo(logoUrl);

  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(vesselName.slice(0, 28) || vesselCode, {
    views: [{ state: "frozen", ySplit: 2 }],
    pageSetup: {
      orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: "1:2",
    },
  });

  const thin = { style: "thin" as const, color: { argb: "FF000000" } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const HEADERS = ["Ítem", "Descripción", "Tarea a realizar", "Realizar cada: Hs/lapso", "Última verificación", "Próximo recorrido"];

  const NAVY = "FF1F3864";        // texto azul oscuro de la planilla de papel
  const PEACH = "FFF8CBAD";       // franja del equipo
  const HEADER_BG = "FFD9E2E3";   // gris del encabezado
  const YELLOW = "FFFFFF00";      // próximo a vencer
  const RED = "FFFF0000";         // vencido

  // ── Banda de título: logo del armador a la izquierda, buque a la derecha ──
  const titleRow = ws.getRow(1);
  titleRow.height = 46;
  ws.mergeCells(1, 1, 1, 2);
  ws.mergeCells(1, 3, 1, 6);
  const nameCell = ws.getCell(1, 3); // C1: celda ancla del merge C..F
  nameCell.value = vesselName || vesselCode;
  nameCell.font = { bold: true, size: 26, color: { argb: "FF000000" } };
  nameCell.alignment = { horizontal: "right", vertical: "middle" };
  if (logo) {
    const h = 40;                              // px, entra holgado en los 46pt de la fila
    const imgId = wb.addImage({ base64: logo.base64, extension: logo.extension });
    ws.addImage(imgId, {
      tl: { col: 0.15, row: 0.12 },
      ext: { width: Math.round(h * logo.ratio), height: h },
      editAs: "oneCell",
    });
  }

  // ── Encabezado de columnas ──
  const hr = ws.getRow(2);
  HEADERS.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 10, color: { argb: "FF000000" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = border;
  });
  hr.height = 30;

  // ── Cuerpo: un bloque por grupo SFI, y dentro un bloque por equipo ──
  let r = 3;
  let item = 0;
  for (const g of orderedGroups) {
    // Banda del grupo, a todo el ancho.
    ws.mergeCells(r, 1, r, 6);
    const band = ws.getCell(r, 1);
    band.value = groupBanner(g);
    band.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    band.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    for (let c = 1; c <= 6; c++) ws.getCell(r, c).border = border;
    ws.getRow(r).height = 20;
    r++;

    for (const e of byGroup.get(g)!) {
      const first = r;
      for (const p of e.plans) {
        const row = ws.getRow(r);
        const sev = severityOf(p);

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

        // Semáforo: rojo = vencida, amarillo = próxima a vencer, sin relleno = al día.
        const fill = sev === "overdue" ? RED : sev === "soon" ? YELLOW : null;
        const fontColor = sev === "overdue" ? "FFFFFFFF" : sev === "soon" ? "FF7F6000" : NAVY;
        [task, every, last, next].forEach((c, i) => {
          if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
          c.font = { size: 10, color: { argb: fontColor }, bold: sev !== "none" };
          c.border = border;
          if (i > 0) c.alignment = { horizontal: "center", vertical: "middle" };
        });
        r++;
      }
      const lastRow = r - 1;

      // Ítem y Descripción combinados sobre todo el bloque del equipo.
      item++;
      ws.mergeCells(first, 1, lastRow, 1);
      const itemCell = ws.getCell(first, 1);
      itemCell.value = item;
      itemCell.font = { bold: true, size: 11 };
      itemCell.alignment = { horizontal: "center", vertical: "middle" };

      ws.mergeCells(first, 2, lastRow, 2);
      const desc = ws.getCell(first, 2);
      desc.value = e.subtitle ? `${e.name}\n${e.subtitle}` : e.name;
      desc.font = { bold: true, size: 10, color: { argb: "FF000000" } };
      desc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PEACH } };
      desc.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

      // Bordes en cada celda del bloque combinado (Excel no los hereda del merge).
      for (let i = first; i <= lastRow; i++) {
        ws.getCell(i, 1).border = border;
        ws.getCell(i, 2).border = border;
      }
    }
  }
  const lastDataRow = r - 1;

  // ── Referencia de colores, debajo de la tabla ──
  r++;
  ([[RED, "Vencido"], [YELLOW, "Próximo a vencer"]] as const).forEach(([argb, label]) => {
    const swatch = ws.getCell(r, 2);
    swatch.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    swatch.border = border;
    const text = ws.getCell(r, 3);
    text.value = label;
    text.font = { size: 10, italic: true, color: { argb: NAVY } };
    text.alignment = { horizontal: "left", vertical: "middle" };
    r++;
  });

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 32;
  ws.getColumn(3).width = 62;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 16;
  ws.getColumn(6).width = 16;
  ws.autoFilter = { from: { row: 2, column: 3 }, to: { row: lastDataRow, column: 6 } };

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
