// Formulario Mercurio REGI-MAN-04.1 "Inventario de repuestos y herramientas"
// (Revisión 3, desde 29.12.2025). Réplica del papel controlado: encabezado,
// estado del buque, departamento, REPUESTOS (repuesto · detalles · para qué ·
// cantidad), HERRAMIENTAS, comentarios, "generado por" y el pie
// Elaborado / Revisado / Aprobado. Aprobado en Preview V1 (claude/mockups/inventario-formularios).

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";
import { getSpareInventoryReport, type SpareInventoryFilters } from "./spare-reports-service";
import { resolveTenantTime, fmtDate as fmtDateTz } from "../../common/tenant-time";

// Datos del documento controlado vigente (papel REGI-MAN-04.1).
const FORM_CODE     = "REGI-MAN-04.1";
const FORM_REVISION = "3";
const FORM_SINCE    = "29.12.2025";

// ── Layout (A4 vertical) ────────────────────────────────────────────────────
const PW       = 595.28;
const PAGE_H   = 841.89;
const ML       = 36;
const W        = PW - ML * 2;
const MARGIN_T = 30;
const FOOTER_H = 30;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const NAVY   = "#0C2461";
const WHITE  = "#FFFFFF";
const BLACK  = "#111111";
const LINE   = "#555555";
const LABEL_BG = "#F2F2F2";

const ESTADOS = ["NAVEGACION", "AMARRADO", "PUERTO", "VARADERO"] as const;
const DEPARTMENTS = ["CUBIERTA", "MAQUINAS", "COCINA", "BARCAZA"] as const;

// DailyReport.operationalStatus → casilla ESTADO DEL BUQUE
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

/** "02 UND", "20 L", "1.5 KG" — como se escribe en el papel. */
function fmtQuantity(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? String(qty).padStart(2, "0") : String(qty);
  const u = unit.trim().toLowerCase();
  const label = u === "ud" || u === "un" || u === "u" || u === "unidad" || u === "unidades" ? "UND" : unit.trim().toUpperCase();
  return `${n} ${label}`;
}

export async function buildSpareInventoryPdf(
  session: TenantAccessSession,
  filters: SpareInventoryFilters,
): Promise<Buffer> {
  // Fechas en la hora de la EMPRESA (el servidor corre en UTC).
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDate = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const report = await getSpareInventoryReport(session, filters);

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

  // Un inventario lista lo que HAY a bordo: sin stock no se imprime.
  const onBoard = report.items.filter(it => it.onHand > 0);
  const spares = onBoard.filter(it => it.kind !== "TOOL");
  const tools  = onBoard.filter(it => it.kind === "TOOL");
  const generatedBy = [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") || session.user.email;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: { Title: `${FORM_CODE} ${report.vessel.name}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = MARGIN_T;
    let page = 1;

    // ── Helpers ─────────────────────────────────────────────────────────────
    function cell(cx: number, cy: number, cw: number, ch: number, text: string, opts: {
      bold?: boolean; fontSize?: number; align?: "left" | "center" | "right";
      bg?: string; color?: string; wrap?: boolean;
    } = {}) {
      if (opts.bg) doc.rect(cx, cy, cw, ch).fillColor(opts.bg).fill();
      doc.rect(cx, cy, cw, ch).strokeColor(LINE).lineWidth(0.5).stroke();
      if (!text) return;
      const fs = opts.fontSize ?? 8;
      doc.fontSize(fs).font(opts.bold ? "Helvetica-Bold" : "Helvetica");
      const ty = opts.wrap ? cy + 3 : cy + (ch - fs) / 2 + 0.5;
      doc.fillColor(opts.color ?? BLACK).text(text, cx + 4, ty, {
        width: cw - 8,
        align: opts.align ?? "left",
        lineBreak: !!opts.wrap,
        ellipsis: !opts.wrap,
      });
    }

    function navyBar(text: string, h = 15) {
      cell(ML, y, W, h, text, { bold: true, fontSize: 8.5, bg: NAVY, color: WHITE, align: "center" });
      y += h;
    }

    function textH(text: string, fontSize: number, width: number): number {
      if (!text) return 0;
      doc.fontSize(fontSize).font("Helvetica-Bold");
      return doc.heightOfString(text, { width: width - 8 });
    }

    function checkboxRow(labels: readonly string[], active: (l: string) => boolean) {
      const h = 16;
      const labelW = W / labels.length * 0.72;
      const boxW = W / labels.length - labelW;
      labels.forEach((l, i) => {
        const x = ML + i * (labelW + boxW);
        cell(x, y, labelW, h, l, { bold: true, fontSize: 8, align: "center" });
        cell(x + labelW, y, boxW, h, "");
        const B = 7;
        const bx = x + labelW + (boxW - B) / 2;
        const by = y + (h - B) / 2;
        doc.rect(bx, by, B, B).strokeColor(BLACK).lineWidth(0.6).stroke();
        if (active(l)) doc.rect(bx + 1.5, by + 1.5, B - 3, B - 3).fillColor(BLACK).fill();
      });
      y += h;
    }

    function drawHeader() {
      const HDR_H = 76;
      const top = MARGIN_T;
      const LOGO_W = 96;
      const META_W = 110;
      const CTR_W = W - LOGO_W - META_W;
      doc.rect(ML, top, W, HDR_H).strokeColor(LINE).lineWidth(0.6).stroke();
      doc.rect(ML, top, LOGO_W, HDR_H).strokeColor(LINE).lineWidth(0.5).stroke();
      const logo = tenantLogoBuffer ?? (existsSync(LOGO_PATH) ? LOGO_PATH : null);
      if (logo) {
        try { doc.image(logo, ML + 6, top + 6, { fit: [LOGO_W - 12, HDR_H - 12], align: "center", valign: "center" }); } catch {}
      } else {
        doc.fontSize(8).font("Helvetica-Bold").fillColor(NAVY)
          .text(sanitizePdfText(tenantName ?? session.tenantSlug.toUpperCase()), ML + 4, top + 32, { width: LOGO_W - 8, align: "center" });
      }

      const cx = ML + LOGO_W;
      doc.rect(cx, top, CTR_W, HDR_H).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.fontSize(10).font("Times-Bold").fillColor(NAVY)
        .text(FORM_CODE, cx + 4, top + 12, { width: CTR_W - 8, align: "center" });
      doc.fontSize(10).font("Times-Bold").fillColor(BLACK)
        .text("Inventario de repuestos y herramientas", cx + 4, top + 44, { width: CTR_W - 8, align: "center" });

      const mx = cx + CTR_W;
      const rowH = 14;
      const halfW = 58;
      [["Revisión N°", FORM_REVISION], ["Desde:", FORM_SINCE], ["Página:", String(page)]].forEach(([label, val], i) => {
        const ry = top + i * rowH;
        doc.rect(mx, ry, halfW, rowH).strokeColor(LINE).lineWidth(0.5).stroke();
        doc.rect(mx + halfW, ry, META_W - halfW, rowH).strokeColor(LINE).lineWidth(0.5).stroke();
        doc.fontSize(7).font("Helvetica").fillColor(NAVY).text(sanitizePdfText(label!), mx + 3, ry + 4, { width: halfW - 6, lineBreak: false });
        doc.fontSize(7).font("Helvetica").fillColor(BLACK).text(val!, mx + halfW, ry + 4, { width: META_W - halfW, align: "center", lineBreak: false });
      });
      doc.fontSize(7.5).font("Helvetica-Bold").fillColor(NAVY)
        .text("Documento Controlado", mx + 2, top + 3 * rowH + (HDR_H - 3 * rowH - 8) / 2, { width: META_W - 4, align: "center", lineBreak: false });
      y = top + HDR_H + 12;
    }

    function drawFooter() {
      const fy = PAGE_H - FOOTER_H;
      doc.rect(ML, fy, W, 13).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.fontSize(7.5).font("Helvetica").fillColor(BLACK);
      const third = W / 3;
      doc.text(sanitizePdfText(`Elaborado: ${tenantName ?? session.tenantSlug}`), ML + 6, fy + 3, { width: third - 6, lineBreak: false, ellipsis: true });
      doc.text("Revisado: Persona Designada en Tierra", ML + third, fy + 3, { width: third, align: "center", lineBreak: false });
      doc.text("Aprobado: Gerente General", ML + 2 * third, fy + 3, { width: third - 6, align: "right", lineBreak: false });
    }

    function newPage() {
      drawFooter();
      doc.addPage();
      page++;
      drawHeader();
    }

    function ensureSpace(h: number, onNewPage?: () => void) {
      if (y + h > CONTENT_BOTTOM) { newPage(); onNewPage?.(); }
    }

    drawHeader();

    // ── REMOLCADOR / FECHA ──────────────────────────────────────────────────
    const ROW = 16;
    const Q = W / 4;
    cell(ML, y, Q * 0.85, ROW, report.vessel.isBarcaza ? "BARCAZA" : "REMOLCADOR", { bold: true, fontSize: 9, bg: NAVY, color: WHITE, align: "center" });
    cell(ML + Q * 0.85, y, Q * 1.15, ROW, sanitizePdfText(report.vessel.name.toUpperCase()), { bold: true, fontSize: 8.5 });
    cell(ML + 2 * Q, y, Q, ROW, "FECHA", { bold: true, fontSize: 8.5, bg: LABEL_BG, align: "center" });
    cell(ML + 3 * Q, y, Q, ROW, fmtDate(report.filters.asOfDate), { bold: true, fontSize: 8.5, align: "center" });
    y += ROW;

    // ── ZONA / RIO / KM / MARGEN (a mano: el sistema no los tiene) ──────────
    const pairW = W / 8;
    ["ZONA", "RIO", "KM", "MARGEN"].forEach((l, i) => {
      cell(ML + i * 2 * pairW, y, pairW, 26, l, { bold: true, fontSize: 8, bg: LABEL_BG, align: "center" });
      cell(ML + (i * 2 + 1) * pairW, y, pairW, 26, "");
    });
    y += 26;

    // ── ESTADO DEL BUQUE ────────────────────────────────────────────────────
    navyBar("ESTADO DEL BUQUE");
    const estadoActivo = estadoFromOpStatus(report.context.operationalStatus);
    checkboxRow(ESTADOS, l => l === estadoActivo);

    // ── RIO / KM / CIUDAD ───────────────────────────────────────────────────
    const sixth = W / 6;
    [["RIO", ""], ["KM", ""], ["CIUDAD", report.context.currentPort ?? ""]].forEach(([l, v], i) => {
      cell(ML + i * 2 * sixth, y, sixth, 30, "", {});
      doc.fontSize(8).font("Helvetica-Bold").fillColor(BLACK).text(l!, ML + i * 2 * sixth, y + 3, { width: sixth, align: "center" });
      cell(ML + (i * 2 + 1) * sixth, y, sixth, 30, sanitizePdfText(v!.toUpperCase()), { bold: true, fontSize: 8, wrap: true });
    });
    y += 30;

    // ── DEPARTAMENTO ────────────────────────────────────────────────────────
    navyBar("DEPARTAMENTO");
    checkboxRow(DEPARTMENTS, l => l === "BARCAZA" ? report.vessel.isBarcaza : l === report.filters.department);

    // ── REPUESTOS ───────────────────────────────────────────────────────────
    const spCols = [W * 0.28, W * 0.22, W * 0.36, W * 0.14];
    const spX = (i: number) => ML + spCols.slice(0, i).reduce((a, b) => a + b, 0);
    const spareHeader = () => {
      ["REPUESTO", "DETALLES", "PARA QUE", "CANTIDAD"].forEach((h, i) =>
        cell(spX(i), y, spCols[i]!, 13, h, { bold: true, fontSize: 8, bg: LABEL_BG, align: "center" }));
      y += 13;
    };
    ensureSpace(15 + 13 + 14);
    navyBar("REPUESTOS");
    spareHeader();

    const MIN_ROW = 13;
    for (const it of spares) {
      const texts = [
        sanitizePdfText(it.itemLabel.toUpperCase()),
        sanitizePdfText(it.partNumber ? `P/N ${it.partNumber}` : ""),
        sanitizePdfText((it.equipmentLabel ?? "").toUpperCase()),
        sanitizePdfText(fmtQuantity(it.onHand, it.unit)),
      ];
      const rowH = Math.max(MIN_ROW, ...texts.map((t, i) => textH(t, 7.5, spCols[i]!) + 5));
      ensureSpace(rowH, spareHeader);
      texts.forEach((t, i) => cell(spX(i), y, spCols[i]!, rowH, t, { bold: true, fontSize: 7.5, wrap: true }));
      y += rowH;
    }
    // Renglones libres para anotar a mano, como el papel.
    const spareBlank = Math.max(4, 12 - spares.length);
    for (let i = 0; i < spareBlank && y + MIN_ROW <= CONTENT_BOTTOM; i++) {
      spCols.forEach((w, ci) => cell(spX(ci), y, w, MIN_ROW, ""));
      y += MIN_ROW;
    }

    // ── HERRAMIENTAS ────────────────────────────────────────────────────────
    const tlCols = [W * 0.85, W * 0.15];
    const toolHeader = () => {
      cell(ML, y, tlCols[0]!, 13, "NOMBRE Y DESCRIPCION", { bold: true, fontSize: 8, bg: LABEL_BG, align: "center" });
      cell(ML + tlCols[0]!, y, tlCols[1]!, 13, "CANTIDAD", { bold: true, fontSize: 8, bg: LABEL_BG, align: "center" });
      y += 13;
    };
    ensureSpace(15 + 13 + MIN_ROW * 2);
    navyBar("HERRAMIENTAS");
    toolHeader();
    for (const it of tools) {
      const name = sanitizePdfText(it.name.toUpperCase());
      const qty = sanitizePdfText(fmtQuantity(it.onHand, it.unit));
      const rowH = Math.max(MIN_ROW, textH(name, 7.5, tlCols[0]!) + 5);
      ensureSpace(rowH, toolHeader);
      cell(ML, y, tlCols[0]!, rowH, name, { bold: true, fontSize: 7.5, wrap: true });
      cell(ML + tlCols[0]!, y, tlCols[1]!, rowH, qty, { bold: true, fontSize: 7.5, wrap: true });
      y += rowH;
    }
    const toolBlank = Math.max(2, 6 - tools.length);
    for (let i = 0; i < toolBlank && y + MIN_ROW <= CONTENT_BOTTOM; i++) {
      tlCols.forEach((w, ci) => cell(ML + (ci === 0 ? 0 : tlCols[0]!), y, w, MIN_ROW, ""));
      y += MIN_ROW;
    }

    // ── COMENTARIOS ADICIONALES / GENERADO POR ──────────────────────────────
    ensureSpace(15 + 34 + 15 + 16);
    navyBar("COMENTARIOS ADICIONALES");
    cell(ML, y, W, 34, "");
    y += 34;
    navyBar("EL PRESENTE FUE GENERADO POR");
    cell(ML, y, W, 16, sanitizePdfText(generatedBy.toUpperCase()), { bold: true, fontSize: 8.5 });
    y += 16;

    drawFooter();
    doc.end();
  });
}
