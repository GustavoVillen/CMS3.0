// Planilla Mercurio "R/E <buque> — Estándar de filtros, lubricantes y artículos"
// (Planilla de Solicitud de Suministro). Estándar para viaje · Remanencia a bordo ·
// Solicitud para completar estándar, con opción de medio estándar.
// Aprobado en Preview V1 (claude/mockups/inventario-formularios).

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";
import { getSpareStandardReport, type SpareStandardFilters, type SpareStandardItem } from "./spare-reports-service";

const PW       = 595.28;
const PAGE_H   = 841.89;
const ML       = 30;
const W        = PW - ML * 2;
const MARGIN_T = 36;
const CONTENT_BOTTOM = PAGE_H - 36;

const BLACK  = "#111111";
const LINE   = "#555555";
const SKY    = "#B8DBE8";
const YELLOW = "#FDFBD3";
const GREEN  = "#DBE8CC";

const DEPT_LABEL: Record<string, string> = {
  MAQUINAS: "MAQUINAS", CUBIERTA: "CUBIERTA", COCINA: "COCINA", BARCAZA: "BARCAZA",
};

/** Unidad como en la planilla: "UN", "L", "KG". */
function fmtUnit(unit: string): string {
  const u = unit.trim().toLowerCase();
  return u === "ud" || u === "u" || u === "unidad" || u === "unidades" ? "UN" : unit.trim().toUpperCase();
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export async function buildSpareStandardPdf(
  session: TenantAccessSession,
  filters: SpareStandardFilters,
): Promise<Buffer> {
  const report = await getSpareStandardReport(session, filters);

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
      tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, tenantRow?.settings?.logoUrl, tenantRow?.settings?.logoUrlLight);
    } catch { /* non-blocking */ }
  }

  const dept = DEPT_LABEL[report.filters.department] ?? report.filters.department;
  const half = report.filters.mode === "HALF";
  const stdWord = half ? "MEDIO ESTANDAR" : "ESTANDAR";
  const signer = report.filters.department === "MAQUINAS" ? "FIRMA DEL JEFE DE MAQUINAS" : "FIRMA DEL CAPITAN";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `R/E ${report.vessel.name} ${stdWord}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = MARGIN_T;

    // ARTICULOS | N° DE PARTE | MEDIDA | ESTÁNDAR | REMANENCIA | SOLICITUD
    const cols = [W * 0.34, W * 0.17, W * 0.1, W * 0.11, W * 0.12, W * 0.16];
    const colX = (i: number) => ML + cols.slice(0, i).reduce((a, b) => a + b, 0);

    function cell(cx: number, cy: number, cw: number, ch: number, text: string, opts: {
      bold?: boolean; fontSize?: number; align?: "left" | "center" | "right"; bg?: string; font?: string;
    } = {}) {
      if (opts.bg) doc.rect(cx, cy, cw, ch).fillColor(opts.bg).fill();
      doc.rect(cx, cy, cw, ch).strokeColor(LINE).lineWidth(0.5).stroke();
      if (!text) return;
      const fs = opts.fontSize ?? 7.5;
      doc.fontSize(fs).font(opts.font ?? (opts.bold ? "Helvetica-Bold" : "Helvetica"));
      const h = doc.heightOfString(text, { width: cw - 6, align: opts.align ?? "left" });
      doc.fillColor(BLACK).text(text, cx + 3, cy + Math.max(2, (ch - h) / 2), { width: cw - 6, align: opts.align ?? "left" });
    }

    function drawTop() {
      const H = 44;
      const logoW = 90;
      const voyW = cols[5]!;
      doc.rect(ML, y, W, H).strokeColor(LINE).lineWidth(0.6).stroke();
      const logo = tenantLogoBuffer ?? (existsSync(LOGO_PATH) ? LOGO_PATH : null);
      if (logo) { try { doc.image(logo, ML + 4, y + 4, { fit: [logoW - 8, H - 8], align: "center", valign: "center" }); } catch {} }
      const title = sanitizePdfText(`R/E ${report.vessel.name} - ${tenantName ?? session.tenantSlug}`.toUpperCase());
      doc.fontSize(14).font("Times-Bold").fillColor(BLACK)
        .text(title, ML + logoW, y + 15, { width: W - logoW - voyW, align: "center", lineBreak: false, ellipsis: true });
      const voyage = report.filters.voyageNumber ? sanitizePdfText(report.filters.voyageNumber) : "______";
      cell(ML + W - voyW, y, voyW, H, `VIAJE N° ${voyage}`, { font: "Times-Bold", fontSize: 9, align: "center", bg: GREEN });
      y += H;
    }

    function drawColumnHeader() {
      const H = 30;
      const heads = ["ARTICULOS", "N° DE PARTE", "MEDIDA", `${stdWord}\nPARA VIAJE`, "REMANENCIA\nA BORDO", `SOLICITUD\nPARA COMPLETAR\n${stdWord}`];
      heads.forEach((h, i) => cell(colX(i), y, cols[i]!, H, h, { font: "Times-Bold", fontSize: 7.5, align: "center", bg: SKY }));
      y += H;
    }

    function newPage() {
      doc.addPage();
      y = MARGIN_T;
      drawTop();
      drawColumnHeader();
    }

    function ensureSpace(h: number) {
      if (y + h > CONTENT_BOTTOM) newPage();
    }

    function sectionTitle(text: string) {
      ensureSpace(18 + 14);
      cell(ML, y, W, 18, text, { font: "Times-Bold", fontSize: 11, align: "center", bg: SKY });
      y += 18;
    }

    function numberCells(it: SpareStandardItem, rowH: number) {
      cell(colX(3), y, cols[3]!, rowH, fmtNum(it.standard), { align: "center", bg: YELLOW });
      cell(colX(4), y, cols[4]!, rowH, fmtNum(it.onBoard), { align: "center", bg: GREEN });
      cell(colX(5), y, cols[5]!, rowH, fmtNum(it.request), { align: "center", bold: it.request > 0 });
    }

    function blankRows(n: number) {
      for (let i = 0; i < n; i++) {
        ensureSpace(13);
        cols.forEach((w, ci) => cell(colX(ci), y, w, 13, "", { bg: ci === 3 ? YELLOW : ci === 4 ? GREEN : undefined }));
        y += 13;
      }
    }

    drawTop();
    drawColumnHeader();

    // ── Filtros y lubricantes (agrupados por equipo) ────────────────────────
    sectionTitle(`${stdWord} DE FILTROS Y LUBRICANTES PARA ${dept}`);
    const filterLubes = report.items.filter(i => i.section === "FILTER_LUBE");
    for (const it of filterLubes) {
      const lines: Array<{ text: string; bold: boolean; indent: number }> = [];
      if (it.equipmentName) lines.push({ text: it.equipmentName, bold: true, indent: 0 });
      if (it.equipmentMakeModel) lines.push({ text: `Marca/Modelo: ${it.equipmentMakeModel}`, bold: false, indent: 0 });
      lines.push({ text: it.itemLabel, bold: true, indent: it.equipmentName ? 30 : 0 });

      const w0 = cols[0]! - 6;
      let textHeight = 0;
      for (const l of lines) {
        doc.fontSize(7.5).font(l.bold ? "Helvetica-Bold" : "Helvetica");
        textHeight += doc.heightOfString(sanitizePdfText(l.text), { width: w0 - l.indent });
      }
      doc.fontSize(7.5).font("Helvetica");
      const pnH = it.partNumber ? doc.heightOfString(sanitizePdfText(it.partNumber), { width: cols[1]! - 6 }) : 0;
      const rowH = Math.max(14, textHeight + 6, pnH + 6);
      ensureSpace(rowH);

      doc.rect(colX(0), y, cols[0]!, rowH).strokeColor(LINE).lineWidth(0.5).stroke();
      let ty = y + 3;
      for (const l of lines) {
        const t = sanitizePdfText(l.text);
        doc.fontSize(7.5).font(l.bold ? "Helvetica-Bold" : "Helvetica").fillColor(BLACK)
          .text(t, colX(0) + 3 + l.indent, ty, { width: w0 - l.indent });
        ty += doc.heightOfString(t, { width: w0 - l.indent });
      }
      cell(colX(1), y, cols[1]!, rowH, sanitizePdfText(it.partNumber ?? ""));
      cell(colX(2), y, cols[2]!, rowH, sanitizePdfText(fmtUnit(it.unit)), { align: "center" });
      numberCells(it, rowH);
      y += rowH;
    }
    if (filterLubes.length === 0) blankRows(3);

    // ── Artículos ───────────────────────────────────────────────────────────
    sectionTitle(`${stdWord} DE ARTICULOS PARA ${dept}`);
    const articles = report.items.filter(i => i.section === "ARTICLE");
    for (const it of articles) {
      const name = sanitizePdfText(it.itemLabel.toUpperCase());
      doc.fontSize(7.5).font("Helvetica");
      const rowH = Math.max(13, doc.heightOfString(name, { width: cols[0]! + cols[1]! - 6 }) + 4);
      ensureSpace(rowH);
      cell(colX(0), y, cols[0]! + cols[1]!, rowH, name);
      cell(colX(2), y, cols[2]!, rowH, sanitizePdfText(fmtUnit(it.unit)), { align: "center" });
      numberCells(it, rowH);
      y += rowH;
    }
    if (articles.length === 0) blankRows(3);

    // ── Comentarios + firma ─────────────────────────────────────────────────
    const BOX_H = 70;
    if (y + 16 + BOX_H > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_T; }
    y += 16;
    const signW = cols[5]! + 20;
    doc.rect(ML, y, W, BOX_H).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.fontSize(9).font("Helvetica-Bold").fillColor(BLACK).text("COMENTARIOS:", ML + 4, y + 4);
    for (let i = 0; i < 3; i++) {
      const ly = y + 26 + i * 14;
      doc.moveTo(ML + 4, ly).lineTo(ML + W - signW - 110, ly).dash(1, { space: 2 }).strokeColor(LINE).lineWidth(0.5).stroke().undash();
    }
    const sx = ML + W - signW;
    doc.rect(sx, y, signW, BOX_H).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.moveTo(sx, y + BOX_H * 0.6).lineTo(sx + signW, y + BOX_H * 0.6).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.fontSize(7.5).font("Helvetica").fillColor(BLACK);
    doc.text(signer, sx + 3, y + BOX_H * 0.6 - 20, { width: signW - 6, align: "center" });
    doc.text("ACLARACION DE FIRMA", sx + 3, y + BOX_H - 14, { width: signW - 6, align: "center" });

    doc.end();
  });
}
