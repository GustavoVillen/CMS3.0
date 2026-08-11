// Generic monthly spare-consumption report (REP-CONS-01.0).
// Renders an aggregated table of spares consumed during a calendar month
// for a given vessel. Layout is intentionally simpler than the Mercurio
// inventory form — it is a tabular report, not a controlled document.

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";
import { getSpareConsumptionReport, type SpareConsumptionFilters } from "./spare-reports-service";
import { resolveTenantTime, fmtDate as fmtDateTz } from "../../common/tenant-time";

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

const MONTH_NAMES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];


export async function buildSpareConsumptionPdf(
  session: TenantAccessSession,
  filters: SpareConsumptionFilters,
): Promise<Buffer> {
  // Fechas y horas del documento en la hora de la EMPRESA: el servidor
  // corre en UTC y sin esto el papel salía con la hora del servidor.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDate = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const report = await getSpareConsumptionReport(session, filters);

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
      info: { Title: `REP-CONS-01.0 ${report.vessel.code} ${report.period.year}-${String(report.period.month).padStart(2, "0")}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = MARGIN_T;
    let page = 1;

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
        .text(`REP-CONS-01.0 — Pagina ${page} — ${report.vessel.code} — ${fmtDate(new Date())}`,
          ML, fy + 9, { width: W, align: "right" });
    }

    doc.on("pageAdded", () => { page++; y = MARGIN_T; });

    // ── HEADER ──────────────────────────────────────────────────────────────
    const HDR_H = 64;
    doc.rect(ML, y, W, HDR_H).strokeColor(BORDER).lineWidth(0.8).stroke();

    const LOGO_W = Math.floor(W * 0.18);
    doc.rect(ML, y, LOGO_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, ML + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" }); } catch {}
    } else if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" }); } catch {}
    } else {
      doc.fontSize(8).font("Helvetica-Bold").fillColor(NAVY)
        .text(sanitizePdfText(tenantName ?? session.tenantSlug.toUpperCase()), ML + 4, y + 26, { width: LOGO_W - 8, align: "center" });
    }

    const INFO_W = Math.floor(W * 0.22);
    const CTR_X  = ML + LOGO_W;
    const CTR_W  = W - LOGO_W - INFO_W;
    doc.rect(CTR_X, y, CTR_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(9).font("Helvetica-Bold").fillColor(NAVY)
      .text("REP-CONS-01.0", CTR_X + 4, y + 10, { width: CTR_W - 8, align: "center" });
    doc.fontSize(11).font("Helvetica-Bold").fillColor(NAVY)
      .text("Reporte de Consumo Mensual de Repuestos", CTR_X + 4, y + 26, { width: CTR_W - 8, align: "center" });
    doc.fontSize(9).font("Helvetica").fillColor(GRAY)
      .text(`${MONTH_NAMES[report.period.month - 1]} ${report.period.year}`, CTR_X + 4, y + 44, { width: CTR_W - 8, align: "center" });

    const INFO_X = ML + LOGO_W + CTR_W;
    const ROW_H_INFO = Math.floor(HDR_H / 3);
    const infoRows = [
      ["Revision N°", String(report.documentRevision)],
      ["Buque:", report.vessel.code],
      ["Generado:", fmtDate(new Date())],
    ];
    infoRows.forEach(([label, value], i) => {
      const iy = y + i * ROW_H_INFO;
      const ih = i === 2 ? HDR_H - 2 * ROW_H_INFO : ROW_H_INFO;
      doc.rect(INFO_X, iy, INFO_W, ih).strokeColor(BORDER).lineWidth(0.4).stroke();
      const halfW = Math.floor(INFO_W / 2);
      doc.rect(INFO_X + halfW, iy, INFO_W - halfW, ih).strokeColor(BORDER).lineWidth(0.4).stroke();
      doc.fontSize(7).font("Helvetica").fillColor(GRAY).text(label, INFO_X + 3, iy + (ih - 7) / 2 + 1, { width: halfW - 6, lineBreak: false });
      doc.fontSize(8).font("Helvetica-Bold").fillColor(BLACK).text(sanitizePdfText(value), INFO_X + halfW + 3, iy + (ih - 8) / 2 + 1, { width: INFO_W - halfW - 6, lineBreak: false, align: "center" });
    });
    y += HDR_H;

    // Spacer
    y += 8;

    // ── VESSEL ROW ──────────────────────────────────────────────────────────
    const ROW_H = 22;
    ensureSpace(ROW_H);
    cell(ML, y, 80, ROW_H, "BUQUE", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + 80, y, W - 80, ROW_H, sanitizePdfText(`${report.vessel.code} — ${report.vessel.name ?? ""}`), { fontSize: 9 });
    y += ROW_H;

    // ── TABLA CONSUMO ───────────────────────────────────────────────────────
    // SKU 12% | REPUESTO 32% | SFI 10% | DEPTO 12% | CANT 10% | UN 6% | OTs 18%
    const colW = [
      Math.floor(W * 0.12),
      Math.floor(W * 0.32),
      Math.floor(W * 0.10),
      Math.floor(W * 0.12),
      Math.floor(W * 0.10),
      Math.floor(W * 0.06),
      0,
    ];
    colW[6] = W - colW.slice(0, 6).reduce((a, b) => a + b, 0);
    const colX = (i: number) => ML + colW.slice(0, i).reduce((a, b) => a + b, 0);
    const headers = ["SKU", "REPUESTO", "SFI", "DEPARTAMENTO", "CONSUMO", "UN", "REFERENCIAS"];

    const HDR_ROW_H = 18;
    ensureSpace(HDR_ROW_H);
    headers.forEach((h, i) => {
      cell(colX(i), y, colW[i], HDR_ROW_H, h, { bold: true, fontSize: 7, bg: NAVY, color: WHITE, align: "center" });
    });
    y += HDR_ROW_H;

    if (report.items.length === 0) {
      ensureSpace(40);
      doc.rect(ML, y, W, 40).strokeColor(BORDER).lineWidth(0.4).stroke();
      doc.fontSize(10).font("Helvetica").fillColor(GRAY)
        .text("Sin consumo registrado para el período seleccionado.",
          ML, y + 16, { width: W, align: "center" });
      y += 40;
    } else {
      const ROW_H_DATA = 18;
      for (const it of report.items) {
        ensureSpace(ROW_H_DATA);
        // If page break happened, redraw header
        if (y === MARGIN_T) {
          headers.forEach((h, i) => {
            cell(colX(i), y, colW[i], HDR_ROW_H, h, { bold: true, fontSize: 7, bg: NAVY, color: WHITE, align: "center" });
          });
          y += HDR_ROW_H;
        }
        const refs = it.references.length > 0
          ? it.references.slice(0, 3).map(r => r.id.slice(0, 8)).join(", ") +
            (it.references.length > 3 ? ` +${it.references.length - 3}` : "")
          : "";
        cell(colX(0), y, colW[0], ROW_H_DATA, sanitizePdfText(it.sku), { fontSize: 7.5, align: "center" });
        cell(colX(1), y, colW[1], ROW_H_DATA, sanitizePdfText(it.name), { fontSize: 8 });
        cell(colX(2), y, colW[2], ROW_H_DATA, sanitizePdfText(it.sfiCode ?? ""), { fontSize: 7.5, align: "center" });
        cell(colX(3), y, colW[3], ROW_H_DATA, sanitizePdfText(it.department ?? ""), { fontSize: 7.5, align: "center" });
        cell(colX(4), y, colW[4], ROW_H_DATA, String(it.consumed), { fontSize: 8, align: "right", bold: true });
        cell(colX(5), y, colW[5], ROW_H_DATA, sanitizePdfText(it.unit), { fontSize: 7.5, align: "center" });
        cell(colX(6), y, colW[6], ROW_H_DATA, sanitizePdfText(refs), { fontSize: 7, color: GRAY });
        y += ROW_H_DATA;
      }
    }

    // ── SUMMARY ─────────────────────────────────────────────────────────────
    ensureSpace(ROW_H);
    const sumText =
      `Total ítems consumidos: ${report.summary.totalLines}    ·    ` +
      `Cantidad total: ${report.summary.totalConsumedQty.toFixed(2)}`;
    cell(ML, y, W, ROW_H, sumText, { bold: true, fontSize: 9, align: "center", bg: "#F3F4F6" });
    y += ROW_H;

    drawFooter();
    doc.end();
  });
}
