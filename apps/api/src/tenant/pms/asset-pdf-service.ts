import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getTenantAsset } from "../assets/assets-service";
import { listTenantWorkOrders } from "../work-orders/work-orders-service";
import { listTenantMaintenancePlans } from "../maintenance-plans/maintenance-plans-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, renderLabeledTextBox, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-AR");
}

function val(v: string | null | undefined): string {
  return v?.trim() || "—";
}

const CRITICALITY_COLOR: Record<string, string> = {
  A: "#b91c1c", B: "#b45309", C: "#16a34a",
};
const ASSET_STATUS_COLOR: Record<string, string> = {
  OPERATIONAL: "#166534", DEGRADED: "#b45309", OUT_OF_SERVICE: "#b91c1c",
};
const WO_TYPE_LABEL: Record<string, string> = {
  PREVENTIVE: "Mantenimiento", CORRECTIVE: "Reparación", INSPECTION: "Inspección",
};
const WO_STATUS_LABEL: Record<string, string> = {
  PLANNED: "Planificada", IN_PROGRESS: "En curso", ON_HOLD: "En espera",
  DEFERRED: "Diferida", CLOSED: "Cerrada", CANCELLED: "Cancelada",
};
const WO_STATUS_COLOR: Record<string, string> = {
  PLANNED: "#0369a1", IN_PROGRESS: "#b45309", ON_HOLD: "#6d28d9",
  DEFERRED: "#475569", CLOSED: "#166534", CANCELLED: "#b91c1c",
};
const PLAN_TYPE_LABEL: Record<string, string> = {
  MAINTENANCE: "Mantenimiento", INSPECTION: "Inspección",
};
// Etiquetas/colores de executionStatus (mismo cálculo que la lista de planes).
const PLAN_STATUS_LABEL: Record<string, string> = {
  FUTURE: "Futuro", UPCOMING: "Próximo", IN_WINDOW: "En ventana",
  DUE: "Por vencer", OVERDUE: "Vencido", COMPLETED: "Completado",
  NEVER_EXECUTED: "Sin ejecutar",
};
const PLAN_STATUS_COLOR: Record<string, string> = {
  FUTURE: "#475569", UPCOMING: "#0369a1", IN_WINDOW: "#6d28d9",
  DUE: "#b45309", OVERDUE: "#b91c1c", COMPLETED: "#166534",
  NEVER_EXECUTED: "#475569",
};

function fmtPlanFreq(p: PlanRow): string {
  const tt = p.triggerType;
  if ((tt === "HOURS" || tt === "RUNNING_HOURS") && p.frequencyHours) return `${Number(p.frequencyHours).toLocaleString("es-AR")} h`;
  if ((tt === "MONTHS" || tt === "CALENDAR") && p.frequencyMonths) return `${p.frequencyMonths} m`;
  if (tt === "DAY" && p.frequencyMonths) return `${p.frequencyMonths} d`;
  if (tt === "WEEK" && p.frequencyMonths) return `${p.frequencyMonths} sem`;
  return tt;
}

// Clave numérica para ordenar por frecuencia: todo a "horas equivalentes" para
// comparar entre unidades (meses/horas/días/semanas). Planes sin frecuencia van al final.
function planFreqSortKey(p: PlanRow): number {
  const tt = p.triggerType;
  if ((tt === "HOURS" || tt === "RUNNING_HOURS") && p.frequencyHours) return Number(p.frequencyHours);
  if ((tt === "MONTHS" || tt === "CALENDAR") && p.frequencyMonths) return p.frequencyMonths * 730;
  if (tt === "WEEK" && p.frequencyMonths) return p.frequencyMonths * 168;
  if (tt === "DAY" && p.frequencyMonths) return p.frequencyMonths * 24;
  return Number.POSITIVE_INFINITY;
}

function fmtPlanNextDue(p: PlanRow): string {
  if (p.nextDueHours != null) return `${Number(p.nextDueHours).toLocaleString("es-AR")} h`;
  if (p.nextDueDate) return fmt(p.nextDueDate);
  return "—";
}

const PAGE_H      = 841.89;            // A4 height pts
const PAGE_W      = 595.28;            // A4 width pts
const CM          = 72 / 2.54;
const MARGIN_V    = Math.round(1.5 * CM);
const FOOTER_SIZE = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

interface AssetForPdf {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetCode: string;
  sfiCode: string | null;
  name: string;
  criticality: string;
  criticalityRationale?: string | null;
  isSafetyCritical?: boolean;
  status: string;
  trackDailyReport: boolean;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  installationDate: Date | null;
  lastOverhaulDate: Date | null;
  replacementDate: Date | null;
  currentHours: number | null;
}

interface HistoryRow {
  workOrderCode: string;
  type: string;
  status: string;
  title: string | null;
  openDate: string | Date;
  completedDate: string | Date | null;
}

interface PlanRow {
  taskCode: string;
  taskType: string;
  title: string;
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
  nextDueDate: string | Date | null;
  nextDueHours: number | null;
  executionStatus?: string | null;
}

export async function buildAssetPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const asset = (await getTenantAsset(session, id)) as unknown as AssetForPdf;

  // Historial de mantenimientos/inspecciones (órdenes de trabajo del asset).
  const history = (await listTenantWorkOrders(session, { assetId: asset.id })) as unknown as HistoryRow[];

  // Tareas del plan de mantenimiento del asset (mismos registros que el módulo
  // Plan de Mantenimiento y que la sección del modal de Asset).
  const plans = (await listTenantMaintenancePlans(session, { assetId: asset.id })) as unknown as PlanRow[];

  // Nombre del buque (mostrar nombre, no solo código).
  let vesselName: string | null = null;
  let tenant: { logoUrl?: string | null; logoUrlLight?: string | null } | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const vessel = await (prisma as any).vessel.findFirst({
        where: { tenantId: asset.tenantId, code: asset.vesselCode },
        select: { name: true },
      });
      vesselName = vessel?.name ?? null;
    } catch { /* non-blocking */ }
    try {
      const tenantRow = await (prisma as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { logoUrl: true, logoUrlLight: true } } },
      });
      tenant = tenantRow?.settings ?? null;
      tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, tenant?.logoUrl, tenant?.logoUrlLight);
    } catch { /* non-blocking */ }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: { Title: `${asset.assetCode}-${asset.vesselCode}` },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML     = 48;
    const MR     = 48;
    const W      = PAGE_W - ML - MR;
    const black  = "#0f172a";
    const gray   = "#64748b";
    const border = "#e2e8f0";
    const bgBox  = "#f8fafc";

    let y = ML;

    doc.on("pageAdded", () => {
      (doc as unknown as { y: number }).y = MARGIN_V;
      y = MARGIN_V;
    });

    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) {
        doc.addPage();
        y = MARGIN_V;
      }
    }

    // ── Header ────────────────────────────────────────────────────────────────
    const HEADER_H = 64;
    const TENANT_LOGO_MAX_W = 90;

    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + W - TENANT_LOGO_MAX_W, y,
          { fit: [TENANT_LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
      } catch {}
    }

    const titleW = W - TENANT_LOGO_MAX_W - 16;
    doc.fontSize(22).font("Helvetica-Bold").fillColor(black)
      .text("FICHA DE EQUIPO", ML, y + 2, { width: titleW });
    doc.fontSize(13).font("Helvetica-Bold").fillColor(black)
      .text(sanitizePdfText(`${asset.assetCode}  ·  ${asset.name}`), ML, y + 30, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`Generado: ${new Date().toLocaleString("es-AR")}`, ML, y + 48, { width: titleW });

    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 14;

    // ── Compact labeled box (single-line value) ───────────────────────────────
    function labeledBox(bx: number, by: number, bw: number, bh: number, label: string, value: string, valueColor = black) {
      doc.roundedRect(bx, by, bw, bh, 3).fillColor(bgBox).fill();
      doc.roundedRect(bx, by, bw, bh, 3).strokeColor(border).lineWidth(1).stroke();
      doc.fontSize(6.5).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), bx + 8, by + 5, { width: bw - 16, characterSpacing: 0.4 });
      doc.fontSize(10).font("Helvetica-Bold").fillColor(valueColor)
        .text(sanitizePdfText(value), bx + 8, by + 15, { width: bw - 16, lineBreak: false, ellipsis: true });
    }

    // Identificación compacta: cajas más bajas y menos espacio entre filas.
    const BOX_H = 30;
    const ROW   = BOX_H + 6; // paso de fila (antes 58 con cajas de 44)

    // ── Asset identity ─────────────────────────────────────────────────────────
    const half = (W - 8) / 2;
    labeledBox(ML,            y, half, BOX_H, "Buque",  vesselName ? `${vesselName} (${asset.vesselCode})` : asset.vesselCode);
    labeledBox(ML + half + 8, y, half, BOX_H, "Código SFI", val(asset.sfiCode));
    y += ROW;

    const third = (W - 16) / 3;
    labeledBox(ML,                   y, third, BOX_H, "Criticidad", asset.criticality, CRITICALITY_COLOR[asset.criticality] ?? black);
    labeledBox(ML + third + 8,       y, third, BOX_H, "Estado",     asset.status,      ASSET_STATUS_COLOR[asset.status] ?? black);
    labeledBox(ML + (third + 8) * 2, y, third, BOX_H, "Crítico ISM 10.3", asset.isSafetyCritical ? "Sí" : "No", asset.isSafetyCritical ? "#b91c1c" : gray);
    y += ROW;

    labeledBox(ML,                   y, third, BOX_H, "Reporte Diario",  asset.trackDailyReport ? "Sí" : "No", asset.trackDailyReport ? "#166534" : gray);
    labeledBox(ML + third + 8,       y, third, BOX_H, "Hs. Acumuladas",  asset.currentHours != null ? `${Number(asset.currentHours).toLocaleString("es-AR")} h` : "—");
    labeledBox(ML + (third + 8) * 2, y, third, BOX_H, "Fabricante",      val(asset.manufacturer));
    y += ROW;

    labeledBox(ML,                   y, third, BOX_H, "Modelo", val(asset.model));
    labeledBox(ML + third + 8,       y, third, BOX_H, "Serial", val(asset.serialNumber));
    labeledBox(ML + (third + 8) * 2, y, third, BOX_H, "Instalación", fmt(asset.installationDate));
    y += ROW;

    labeledBox(ML,            y, half, BOX_H, "Última Reparación Mayor", fmt(asset.lastOverhaulDate));
    labeledBox(ML + half + 8, y, half, BOX_H, "Reemplazo Previsto",      fmt(asset.replacementDate));
    y += ROW;

    // ── Fundamento de Criticidad (free text, page-aware) ──────────────────────
    y = renderLabeledTextBox(doc, {
      label: "Fundamento de Criticidad",
      text: sanitizePdfText(asset.criticalityRationale ?? ""),
      x: ML,
      y,
      width: W,
      pageBottom: CONTENT_BOTTOM,
      pageTop: MARGIN_V,
      fontSize: 10,
      sectionGap: 14,
      onPageAdd: () => { y = MARGIN_V; },
    });

    // ── Generic table renderer (single-line cells) ────────────────────────────
    interface TableCol { label: string; w: number }
    type TableCell = { text: string; color: string; bold?: boolean };
    const ROW_H     = 20;
    const HEADER_RH = 22;
    const CELL_PAD  = 6;

    function colX(cols: TableCol[], index: number): number {
      let x = ML;
      for (let i = 0; i < index; i++) x += cols[i].w;
      return x;
    }

    function drawTableHeader(cols: TableCol[]) {
      doc.roundedRect(ML, y, W, HEADER_RH, 3).fillColor("#f1f5f9").fill();
      doc.roundedRect(ML, y, W, HEADER_RH, 3).strokeColor(border).lineWidth(1).stroke();
      cols.forEach((c, i) => {
        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
          .text(c.label.toUpperCase(), colX(cols, i) + CELL_PAD, y + 7, { width: c.w - CELL_PAD * 2, characterSpacing: 0.3, lineBreak: false, ellipsis: true });
      });
      y += HEADER_RH;
    }

    function renderTable(title: string, cols: TableCol[], rows: TableCell[][], emptyText: string) {
      ensureSpace(40);
      doc.fontSize(11).font("Helvetica-Bold").fillColor(black)
        .text(title, ML, y, { width: W });
      y += 20;

      ensureSpace(HEADER_RH + ROW_H);
      drawTableHeader(cols);

      if (rows.length === 0) {
        doc.roundedRect(ML, y, W, ROW_H, 3).strokeColor(border).lineWidth(1).stroke();
        doc.fontSize(9).font("Helvetica").fillColor(gray)
          .text(emptyText, ML + CELL_PAD, y + 6, { width: W - CELL_PAD * 2, ellipsis: true });
        y += ROW_H;
        return;
      }

      rows.forEach((cells, idx) => {
        // Texto de cada celda en una sola "cadena" (los títulos de plan pueden
        // traer saltos de línea → se colapsan para que el wrap sea por ancho).
        const texts = cells.map(c => sanitizePdfText(c.text).replace(/\s+/g, " ").trim());
        // Altura de fila dinámica: la del contenido más alto (con wrap por ancho).
        // Antes era fija (20pt) y los nombres largos se superponían a la fila siguiente.
        const cellHeights = cells.map((cell, i) => {
          doc.fontSize(8).font(cell.bold ? "Helvetica-Bold" : "Helvetica");
          return doc.heightOfString(texts[i] || " ", { width: cols[i].w - CELL_PAD * 2 });
        });
        const rowH = Math.max(ROW_H, Math.max(...cellHeights) + 10);

        if (y + rowH > CONTENT_BOTTOM) {
          doc.addPage();
          y = MARGIN_V;
          drawTableHeader(cols);
        }
        if (idx % 2 === 1) {
          doc.rect(ML, y, W, rowH).fillColor("#f8fafc").fill();
        }
        doc.rect(ML, y, W, rowH).strokeColor(border).lineWidth(0.5).stroke();
        cells.forEach((cell, i) => {
          doc.fontSize(8).font(cell.bold ? "Helvetica-Bold" : "Helvetica").fillColor(cell.color)
            .text(texts[i], colX(cols, i) + CELL_PAD, y + 6, { width: cols[i].w - CELL_PAD * 2 });
        });
        y += rowH;
      });
    }

    // ── Plan de mantenimiento (table) ─────────────────────────────────────────
    const planCols: TableCol[] = [
      { label: "Código",      w: 96 },
      { label: "Tipo",        w: 70 },
      { label: "Nombre",      w: W - 96 - 70 - 64 - 70 - 70 },
      { label: "Frecuencia",  w: 64 },
      { label: "Próximo",     w: 70 },
      { label: "Estado",      w: 70 },
    ];
    const planRows: TableCell[][] = [...plans]
      .sort((a, b) => planFreqSortKey(a) - planFreqSortKey(b))
      .map(p => [
      { text: p.taskCode, color: black, bold: true },
      { text: PLAN_TYPE_LABEL[p.taskType] ?? p.taskType, color: black },
      { text: val(p.title), color: "#334155" },
      { text: fmtPlanFreq(p), color: gray },
      { text: fmtPlanNextDue(p), color: "#0369a1" },
      { text: PLAN_STATUS_LABEL[p.executionStatus ?? ""] ?? (p.executionStatus ?? "—"), color: PLAN_STATUS_COLOR[p.executionStatus ?? ""] ?? black, bold: true },
    ]);
    renderTable("PLAN DE MANTENIMIENTO", planCols, planRows, "Este equipo aún no tiene tareas de mantenimiento.");
    y += 14;

    // ── Historial de mantenimientos e inspecciones (table) ────────────────────
    const histCols: TableCol[] = [
      { label: "OT",            w: 92 },
      { label: "Tipo",          w: 70 },
      { label: "Descripción",   w: W - 92 - 70 - 62 - 66 - 76 },
      { label: "F. Apertura",   w: 62 },
      { label: "F. Realización", w: 66 },
      { label: "Estado",        w: 76 },
    ];
    const histRows: TableCell[][] = history.map(row => [
      { text: row.workOrderCode, color: black, bold: true },
      { text: WO_TYPE_LABEL[row.type] ?? row.type, color: black },
      { text: val(row.title), color: "#334155" },
      { text: fmt(row.openDate), color: gray },
      { text: fmt(row.completedDate), color: gray },
      { text: WO_STATUS_LABEL[row.status] ?? row.status, color: WO_STATUS_COLOR[row.status] ?? black, bold: true },
    ]);
    renderTable("HISTORIAL DE MANTENIMIENTOS E INSPECCIONES", histCols, histRows, "Este equipo aún no tiene órdenes de trabajo registradas.");

    // ── Footer (last page) ────────────────────────────────────────────────────
    const footerY = PAGE_H - FOOTER_SIZE;
    doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch {}
    }
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text("Copilot Management System — Reporte generado automáticamente", ML + 18, footerY, { width: W / 2 - 18 });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`${asset.assetCode} · ${asset.vesselCode} · ${fmt(new Date())}`, ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
