// Armado del Excel de la PLANILLA DE MANTENIMIENTO (formato de papel del armador).
//
// Separado de export-maintenance-sheet.ts —que busca los datos y dispara la
// descarga en el navegador— porque este archivo no toca nada del navegador: lo
// usa también la API para el respaldo semanal en Excel que se sube al Drive de
// la empresa (apps/api/src/tenant/excel/weekly-excel-backup-service.ts). Así la
// planilla del botón y la del Drive salen idénticas.
//
// Cómo se AGRUPA y se ORDENA la planilla vive en `maintenance-sheet-model.ts`.

import {
  type SheetPlan, type AssetInfo,
  ICON_SAMPLING, ICON_INSPECTION, ICON_MAINTENANCE, ICON_PROVIDER,
  buildSheetGroups, everyLabel, isSampling, milestone, providerLabel, severityOfRow,
} from "./maintenance-sheet-model";

/** Logo del armador ya leído, listo para incrustar en la banda de título. */
export interface SheetLogo {
  base64: string;
  extension: "png" | "jpeg" | "gif";
  /** Ancho / alto, para no deformarlo. */
  ratio: number;
}

/**
 * Arma el workbook. Separado de `exportMaintenanceSheet` —que busca los datos y
 * dispara la descarga— para poder generar la planilla fuera del navegador y
 * revisarla: es un documento que se imprime, y los errores de layout (una banda
 * que no llega al ancho nuevo, una columna sin borde) no los ve un typecheck.
 */
export async function buildMaintenanceSheet(o: {
  plans: SheetPlan[];
  assetById: Map<string, AssetInfo>;
  vesselName: string;
  vesselCode: string;
  logo: SheetLogo | null;
}) {
  const { plans, assetById, vesselName, vesselCode, logo } = o;

  // Agrupación, orden y numeración de ítems: los arma el modelo compartido, para
  // que el papel y la pantalla no puedan diferir.
  const sheetGroups = buildSheetGroups(plans, assetById);

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
  const HEADERS = [
    "Ítem", "Descripción", "Tarea a realizar", "Realizar cada: Hs/lapso",
    "Última verificación", "Próximo recorrido",
    "Muestreo", "Inspección", "Mantenimiento", "Proveedor",
    "Fuera de servicio",
  ];
  const LAST_COL = HEADERS.length;   // K

  const NAVY = "FF1F3864";        // texto azul oscuro de la planilla de papel
  const PEACH = "FFF8CBAD";       // franja del equipo
  const HEADER_BG = "FFD9E2E3";   // gris del encabezado
  const YELLOW = "FFFFFF00";      // próximo a vencer
  const RED = "FFFF0000";         // vencido
  // Equipo fuera de servicio: el mismo rosa claro que ya usaba la celda
  // "FUERA DE SERVICIO" de la última columna, ahora en toda la fila.
  const PINK = "FFFFE0E0";

  // ── Banda de título: logo del armador a la izquierda, buque a la derecha ──
  const titleRow = ws.getRow(1);
  titleRow.height = 46;
  ws.mergeCells(1, 1, 1, 2);
  ws.mergeCells(1, 3, 1, LAST_COL);
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
  for (const sg of sheetGroups) {
    // Banda del grupo, a todo el ancho.
    ws.mergeCells(r, 1, r, LAST_COL);
    const band = ws.getCell(r, 1);
    band.value = sg.banner;
    band.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    band.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    for (let c = 1; c <= LAST_COL; c++) ws.getCell(r, c).border = border;
    ws.getRow(r).height = 20;
    r++;

    for (const e of sg.blocks) {
      const first = r;
      for (const p of e.plans) {
        const row = ws.getRow(r);
        const sev = severityOfRow(p, e.outOfService);

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

        // G–J: qué clase de trabajo es. Vacío cuando no aplica — una columna con
        // un ícono cada dos filas se lee mucho mejor que una llena de "NO".
        const sampling = row.getCell(7);
        sampling.value = isSampling(p) ? ICON_SAMPLING : "";

        const inspection = row.getCell(8);
        inspection.value = p.taskType === "INSPECTION" ? ICON_INSPECTION : "";

        const maintenance = row.getCell(9);
        // Sin taskType el plan es de mantenimiento (es el default del modelo).
        maintenance.value = p.taskType !== "INSPECTION" ? ICON_MAINTENANCE : "";

        const provider = row.getCell(10);
        provider.value = providerLabel(p);

        // Semáforo: rojo = vencida, amarillo = próxima a vencer, rosa = el equipo
        // está fuera de servicio (no es un atraso), sin relleno = al día.
        const fill = sev === "outOfService" ? PINK : sev === "overdue" ? RED : sev === "soon" ? YELLOW : null;
        const fontColor = sev === "outOfService" ? "FFC00000"
          : sev === "overdue" ? "FFFFFFFF"
          : sev === "soon" ? "FF7F6000"
          : NAVY;
        [task, every, last, next, sampling, inspection, maintenance, provider].forEach((c, i) => {
          if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
          c.font = { size: 10, color: { argb: fontColor }, bold: sev !== "none" };
          c.border = border;
          if (i > 0) c.alignment = { horizontal: "center", vertical: "middle" };
        });
        // El nombre del taller es texto, no un ícono: va a la izquierda y parte
        // en varias líneas si el plan declara más de uno.
        provider.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
        r++;
      }
      const lastRow = r - 1;

      // Ítem y Descripción combinados sobre todo el bloque del equipo.
      ws.mergeCells(first, 1, lastRow, 1);
      const itemCell = ws.getCell(first, 1);
      itemCell.value = e.itemNumber;
      itemCell.font = { bold: true, size: 11 };
      itemCell.alignment = { horizontal: "center", vertical: "middle" };

      ws.mergeCells(first, 2, lastRow, 2);
      const desc = ws.getCell(first, 2);
      desc.value = e.subtitle ? `${e.name}\n${e.subtitle}` : e.name;
      desc.font = { bold: true, size: 10, color: { argb: "FF000000" } };
      desc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PEACH } };
      desc.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

      // K: fuera de servicio. Es una condición del EQUIPO, no de cada tarea, así
      // que va combinada sobre todo el bloque igual que el ítem y la descripción.
      // Vacía cuando la máquina está en uso: una columna con "NO" en cada fila
      // tapa el dato que importa.
      ws.mergeCells(first, LAST_COL, lastRow, LAST_COL);
      const oos = ws.getCell(first, LAST_COL);
      if (e.outOfService) {
        oos.value = "FUERA DE SERVICIO";
        oos.font = { bold: true, size: 9, color: { argb: "FFC00000" } };
        oos.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE0E0" } };
      }
      oos.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

      // Bordes en cada celda del bloque combinado (Excel no los hereda del merge).
      for (let i = first; i <= lastRow; i++) {
        ws.getCell(i, 1).border = border;
        ws.getCell(i, 2).border = border;
        ws.getCell(i, LAST_COL).border = border;
      }
    }
  }
  const lastDataRow = r - 1;

  // ── Referencia de colores, debajo de la tabla ──
  r++;
  ([
    [ICON_SAMPLING, "Requiere toma de muestra para el laboratorio"],
    [ICON_INSPECTION, "Inspección"],
    [ICON_MAINTENANCE, "Mantenimiento"],
    [ICON_PROVIDER, "Lo ejecuta un taller externo (se indica cuál)"],
  ] as const).forEach(([icon, label]) => {
    const iconCell = ws.getCell(r, 2);
    iconCell.value = icon;
    iconCell.alignment = { horizontal: "center", vertical: "middle" };
    iconCell.border = border;
    const text = ws.getCell(r, 3);
    text.value = label;
    text.font = { size: 10, italic: true, color: { argb: NAVY } };
    text.alignment = { horizontal: "left", vertical: "middle" };
    r++;
  });
  r++;

  ([
    [RED, "Vencido"],
    [YELLOW, "Próximo a vencer"],
    [PINK, "Equipo fuera de servicio"],
  ] as const).forEach(([argb, label]) => {
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
  // G–I sólo llevan un ícono; J, el nombre del taller.
  ws.getColumn(7).width = 11;
  ws.getColumn(8).width = 11;
  ws.getColumn(9).width = 14;
  ws.getColumn(10).width = 26;
  ws.getColumn(11).width = 14;
  ws.autoFilter = { from: { row: 2, column: 3 }, to: { row: lastDataRow, column: LAST_COL } };

  return wb;
}
