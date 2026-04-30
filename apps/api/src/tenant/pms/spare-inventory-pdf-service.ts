// Mercurio Group spare-inventory form (REGI-MAN-04.1).
// PDF renderer for the monthly inventory snapshot. Reuses Mercurio styling
// from work-order-pdf/template-mercurio.ts (navy blue headers, dense layout).

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";
import { getSpareInventoryReport, type SpareInventoryFilters } from "./spare-reports-service";

// ── Layout constants (A4 portrait, dense like Mercurio WO PDF) ──────────────
const PW       = 595.28;
const PAGE_H   = 841.89;
const ML       = 36;
const MR       = 36;
const W        = PW - ML - MR;
const MARGIN_T = 36;
const FOOTER_H = 28;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const NAVY   = "#0C2461";
const WHITE  = "#FFFFFF";
const BLACK  = "#111827";
const GRAY   = "#6B7280";
const BORDER = "#9CA3AF";
const RED    = "#B91C1C";

const ESTADOS = ["NAVEGACION", "AMARRADO", "PUERTO", "VARADERO"] as const;

// Map DailyReport.operationalStatus → ESTADO checkbox
function estadoFromOpStatus(opStatus: string | null): string | null {
  if (!opStatus) return null;
  const m: Record<string, string> = {
    AT_SEA: "NAVEGACION",
    MANOEUVRING: "NAVEGACION",
    ANCHORED: "AMARRADO",
    LAID_UP: "AMARRADO",
    IN_PORT: "PUERTO",
    DRY_DOCK: "VARADERO",
  };
  return m[opStatus] ?? null;
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export async function buildSpareInventoryPdf(
  session: TenantAccessSession,
  filters: SpareInventoryFilters,
): Promise<Buffer> {
  const report = await getSpareInventoryReport(session, filters);

  // Tenant logo
  let tenantName: string | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const tenantRow = await (prisma as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      tenantName = tenantRow?.settings?.displayName ?? null;
      tenantLogoBuffer = await resolveTenantLogo(
        session.tenantSlug,
        tenantRow?.settings?.logoUrl,
        tenantRow?.settings?.logoUrlLight,
      );
    } catch { /* non-blocking */ }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: { Title: `REGI-MAN-04.1 ${report.vessel.code}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = MARGIN_T;
    let page = 1;

    // ── Helpers ─────────────────────────────────────────────────────────────
    function ensureSpace(h: number) {
      if (y + h > CONTENT_BOTTOM) { drawFooter(); doc.addPage(); }
    }

    function cell(cx: number, cy: number, cw: number, ch: number, text: string, opts: {
      bold?: boolean; fontSize?: number; align?: "left" | "center" | "right";
      bg?: string; color?: string;
    } = {}) {
      if (opts.bg) doc.rect(cx, cy, cw, ch).fillColor(opts.bg).fill();
      doc.rect(cx, cy, cw, ch).strokeColor(BORDER).lineWidth(0.4).stroke();
      if (text) {
        doc.fontSize(opts.fontSize ?? 9)
          .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
          .fillColor(opts.color ?? BLACK)
          .text(text, cx + 5, cy + (ch - (opts.fontSize ?? 9)) / 2, {
            width: cw - 10,
            align: opts.align ?? "left",
            lineBreak: false,
            ellipsis: true,
          });
      }
    }

    function checkbox(cx: number, cy: number, label: string, checked: boolean) {
      const BOX = 8;
      doc.rect(cx, cy, BOX, BOX).strokeColor(BORDER).lineWidth(0.6).stroke();
      if (checked) {
        doc.fontSize(6).font("Helvetica-Bold").fillColor(NAVY)
          .text("X", cx + 1, cy + 1, { width: BOX - 2, align: "center", lineBreak: false });
      }
      doc.fontSize(8).font("Helvetica").fillColor(BLACK)
        .text(label, cx + BOX + 4, cy + 0.5, { lineBreak: false });
    }

    function drawFooter() {
      const fy = PAGE_H - FOOTER_H;
      doc.moveTo(ML, fy).lineTo(ML + W, fy).strokeColor(BORDER).lineWidth(0.5).stroke();
      let textX = ML;
      if (existsSync(LOGO_PATH)) {
        try { doc.image(LOGO_PATH, ML, fy + 6, { width: 14, height: 14 }); textX = ML + 18; } catch {}
      }
      doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
        .text("Copilot Management System", textX, fy + 9, { width: W / 2 - 18, lineBreak: false });
      doc.fontSize(7).font("Helvetica").fillColor(GRAY)
        .text(`REGI-MAN-04.1 — Pagina ${page} — ${report.vessel.code} — ${fmtDate(new Date())}`,
          ML, fy + 9, { width: W, align: "right" });
    }

    doc.on("pageAdded", () => { page++; y = MARGIN_T; });

    // ── HEADER ──────────────────────────────────────────────────────────────
    const HDR_H = 72;
    doc.rect(ML, y, W, HDR_H).strokeColor(BORDER).lineWidth(0.8).stroke();

    const LOGO_W = Math.floor(W * 0.22);
    doc.rect(ML, y, LOGO_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, ML + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" }); } catch {}
    } else if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" }); } catch {}
    } else {
      doc.fontSize(8).font("Helvetica-Bold").fillColor(NAVY)
        .text(sanitizePdfText(tenantName ?? session.tenantSlug.toUpperCase()), ML + 4, y + 28, { width: LOGO_W - 8, align: "center" });
    }

    const INFO_W = Math.floor(W * 0.25);
    const CTR_X  = ML + LOGO_W;
    const CTR_W  = W - LOGO_W - INFO_W;
    doc.rect(CTR_X, y, CTR_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(9).font("Helvetica-Bold").fillColor(NAVY)
      .text("REGI-MAN-04.1", CTR_X + 4, y + 14, { width: CTR_W - 8, align: "center" });
    doc.fontSize(10).font("Helvetica-Bold").fillColor(NAVY)
      .text("Inventario de repuestos y herramientas", CTR_X + 4, y + 32, { width: CTR_W - 8, align: "center" });

    const INFO_X = ML + LOGO_W + CTR_W;
    const ROW_H_INFO = Math.floor(HDR_H / 4);
    const infoRows = [
      ["Revision N°", String(report.documentRevision)],
      ["Desde:", "01.05.2025"],
      ["Pagina:", String(page)],
      ["Documento Controlado", ""],
    ];
    infoRows.forEach(([label, val2], i) => {
      const iy = y + i * ROW_H_INFO;
      const ih = i === 3 ? HDR_H - 3 * ROW_H_INFO : ROW_H_INFO;
      doc.rect(INFO_X, iy, INFO_W, ih).strokeColor(BORDER).lineWidth(0.4).stroke();
      if (i < 3) {
        const halfW = Math.floor(INFO_W / 2);
        doc.rect(INFO_X + halfW, iy, INFO_W - halfW, ih).strokeColor(BORDER).lineWidth(0.4).stroke();
        doc.fontSize(7).font("Helvetica").fillColor(GRAY).text(label, INFO_X + 3, iy + (ih - 7) / 2 + 1, { width: halfW - 6, lineBreak: false });
        doc.fontSize(8).font("Helvetica-Bold").fillColor(BLACK).text(val2, INFO_X + halfW + 3, iy + (ih - 8) / 2 + 1, { width: INFO_W - halfW - 6, lineBreak: false, align: "center" });
      } else {
        doc.fontSize(7).font("Helvetica-Bold").fillColor("#1d4ed8")
          .text(label, INFO_X + 3, iy + (ih - 7) / 2 + 1, { width: INFO_W - 6, align: "center", lineBreak: false });
      }
    });
    y += HDR_H;

    // ── REMOLCADOR / FECHA ──────────────────────────────────────────────────
    const ROW_H = 22;
    ensureSpace(ROW_H);
    const HALF = Math.floor(W / 2);
    cell(ML, y, 100, ROW_H, "REMOLCADOR", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + 100, y, HALF - 100, ROW_H, sanitizePdfText(report.vessel.name ?? report.vessel.code), { fontSize: 9 });
    cell(ML + HALF, y, 80, ROW_H, "FECHA", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + HALF + 80, y, W - HALF - 80, ROW_H, fmtDate(report.filters.asOfDate), { fontSize: 9 });
    y += ROW_H;

    // ── ZONA / RIO / KM / MARGEN (4 columns, blank for manual fill) ─────────
    ensureSpace(ROW_H);
    const Q_W = Math.floor(W / 4);
    cell(ML,           y, 50, ROW_H, "ZONA",   { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + 50,      y, Q_W - 50, ROW_H, "", {});
    cell(ML + Q_W,     y, 40, ROW_H, "RIO",    { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + Q_W + 40, y, Q_W - 40, ROW_H, "", {});
    cell(ML + 2*Q_W,   y, 35, ROW_H, "KM",     { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + 2*Q_W + 35, y, Q_W - 35, ROW_H, "", {});
    cell(ML + 3*Q_W,   y, 60, ROW_H, "MARGEN", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + 3*Q_W + 60, y, W - 3*Q_W - 60, ROW_H, "", {});
    y += ROW_H;

    // ── ESTADO DEL BUQUE (4 checkboxes) ─────────────────────────────────────
    ensureSpace(ROW_H + 22);
    cell(ML, y, W, ROW_H, "ESTADO DEL BUQUE", { bold: true, fontSize: 8, bg: NAVY, color: WHITE, align: "center" });
    y += ROW_H;
    const estadoActivo = estadoFromOpStatus(report.context.operationalStatus);
    const ESTADO_ROW_H = 22;
    doc.rect(ML, y, W, ESTADO_ROW_H).fillColor(WHITE).fill();
    doc.rect(ML, y, W, ESTADO_ROW_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const estW = Math.floor(W / ESTADOS.length);
    ESTADOS.forEach((e, i) => { checkbox(ML + i * estW + 8, y + 7, e, estadoActivo === e); });
    y += ESTADO_ROW_H;

    // ── RIO / KM / CIUDAD ───────────────────────────────────────────────────
    ensureSpace(ROW_H);
    const T_W = Math.floor(W / 3);
    cell(ML,         y, 40, ROW_H, "RIO",    { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + 40,    y, T_W - 40, ROW_H, "", {});
    cell(ML + T_W,   y, 35, ROW_H, "KM",     { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + T_W + 35, y, T_W - 35, ROW_H, "", {});
    cell(ML + 2*T_W, y, 60, ROW_H, "CIUDAD", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + 2*T_W + 60, y, W - 2*T_W - 60, ROW_H, sanitizePdfText(report.context.currentPort ?? ""), { fontSize: 9 });
    y += ROW_H;

    // ── DEPARTAMENTO (4 checkboxes) ─────────────────────────────────────────
    ensureSpace(ROW_H + 22);
    cell(ML, y, W, ROW_H, "DEPARTAMENTO", { bold: true, fontSize: 8, bg: NAVY, color: WHITE, align: "center" });
    y += ROW_H;
    const DEPARTMENTS = report.vessel.isBarcaza
      ? ["CUBIERTA", "MAQUINAS", "COCINA", "BARCAZA"]
      : ["CUBIERTA", "MAQUINAS", "COCINA", "BARCAZA"];
    const deptActivo = report.filters.department ?? (report.vessel.isBarcaza ? "BARCAZA" : null);
    const DEPT_ROW_H = 22;
    doc.rect(ML, y, W, DEPT_ROW_H).fillColor(WHITE).fill();
    doc.rect(ML, y, W, DEPT_ROW_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const dW = Math.floor(W / DEPARTMENTS.length);
    DEPARTMENTS.forEach((d, i) => {
      // BARCAZA only checkable when vessel is BARCAZA
      const checked = d === "BARCAZA"
        ? report.vessel.isBarcaza
        : deptActivo === d;
      checkbox(ML + i * dW + 8, y + 7, d, checked);
    });
    y += DEPT_ROW_H;

    // ── TABLA REPUESTOS ─────────────────────────────────────────────────────
    ensureSpace(ROW_H + 16);
    cell(ML, y, W, ROW_H, "REPUESTOS", { bold: true, fontSize: 8, bg: NAVY, color: WHITE, align: "center" });
    y += ROW_H;

    // Column layout:
    // REPUESTO 24% | DETALLES 28% | PARA QUE (SFI) 12% | CANT 8% | UN 6% | UBIC 12% | ULT MOV 10%
    const colW = [
      Math.floor(W * 0.24),
      Math.floor(W * 0.28),
      Math.floor(W * 0.12),
      Math.floor(W * 0.08),
      Math.floor(W * 0.06),
      Math.floor(W * 0.12),
      0, // last col gets remainder
    ];
    colW[6] = W - colW.slice(0, 6).reduce((a, b) => a + b, 0);
    const colX = (i: number) => ML + colW.slice(0, i).reduce((a, b) => a + b, 0);
    const headers = ["REPUESTO", "DETALLES", "PARA QUE (SFI)", "CANTIDAD", "UN", "UBICACION", "ULT.MOV"];

    const HDR_ROW_H = 18;
    ensureSpace(HDR_ROW_H);
    headers.forEach((h, i) => {
      cell(colX(i), y, colW[i], HDR_ROW_H, h, { bold: true, fontSize: 7, bg: "#E5E7EB", align: "center" });
    });
    y += HDR_ROW_H;

    const ROW_H_DATA = 16;
    const detailsFor = (it: typeof report.items[number]): string => {
      const parts = [];
      if (it.longDescription) parts.push(it.longDescription);
      if (it.category) parts.push(`Cat: ${it.category}`);
      if (it.minStock > 0) parts.push(`Mín: ${it.minStock}`);
      return parts.join(" · ");
    };

    for (const it of report.items) {
      ensureSpace(ROW_H_DATA);
      const color = it.belowReorder ? RED : BLACK;
      cell(colX(0), y, colW[0], ROW_H_DATA, sanitizePdfText(`${it.sku} — ${it.name}`), { fontSize: 8, color });
      cell(colX(1), y, colW[1], ROW_H_DATA, sanitizePdfText(detailsFor(it)), { fontSize: 7.5, color });
      cell(colX(2), y, colW[2], ROW_H_DATA, sanitizePdfText(it.sfiCode ?? ""), { fontSize: 8, color, align: "center" });
      cell(colX(3), y, colW[3], ROW_H_DATA, String(it.onHand), { fontSize: 8, color, align: "right", bold: it.belowReorder });
      cell(colX(4), y, colW[4], ROW_H_DATA, sanitizePdfText(it.unit), { fontSize: 7.5, color, align: "center" });
      cell(colX(5), y, colW[5], ROW_H_DATA, sanitizePdfText(it.location ?? ""), { fontSize: 7.5, color });
      cell(colX(6), y, colW[6], ROW_H_DATA, fmtDate(it.lastMovementAt), { fontSize: 7.5, color, align: "center" });
      y += ROW_H_DATA;
    }

    // Fill remaining page with empty rows for handwritten additions (Mercurio style)
    const minTotalRows = 18;
    const filledRows = report.items.length;
    const emptyRowsToDraw = Math.max(0, minTotalRows - filledRows);
    for (let i = 0; i < emptyRowsToDraw; i++) {
      if (y + ROW_H_DATA > CONTENT_BOTTOM) break;
      headers.forEach((_, ci) => {
        cell(colX(ci), y, colW[ci], ROW_H_DATA, "", {});
      });
      y += ROW_H_DATA;
    }

    // ── SUMMARY (mejora sobre el original) ──────────────────────────────────
    ensureSpace(ROW_H);
    const sumText = `Total ítems: ${report.summary.totalItems}    ·    Bajo reorden: ${report.summary.belowReorderCount}`;
    cell(ML, y, W, ROW_H, sumText, { bold: true, fontSize: 9, align: "center", bg: "#F3F4F6" });
    y += ROW_H;

    drawFooter();
    doc.end();
  });
}
