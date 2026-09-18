// Template Mercurio (documento controlado) para el Informe de salud del equipo.
// Renderer puro: recibe los datos ya cargados y devuelve un Buffer.
//
// Mismo chrome que el plan de mantenimiento y el diferimiento (header con
// Revisión/Desde/Página + pie Elaborado/Revisado/Aprobado) y el mismo canvas con
// textArea autoajustable, que es el que evita el bug histórico del texto que se
// sale del recuadro al cambiar de página (skill pms-pdf-generation).

import PDFDocument from "pdfkit";
import { sanitizePdfText } from "./pdf-helpers";
import { fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";
import {
  FORM_COLORS, FOOTER_H, PAGE_H,
  drawControlledDocHeader, drawControlledDocFooter, createFormCanvas,
  type ControlledDocMeta,
} from "./pdf-form-chrome";

const PW       = 595.28;
const ML       = 36;
const MR       = 36;
const W        = PW - ML - MR;
const MARGIN_T = 36;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const PT_PER_MM = 72 / 25.4;
const TITLE_GAP = 7 * PT_PER_MM;
const LABEL_H   = 15;
const KEEP_MIN  = 26;

const { NAVY, BLACK, GRAY, LIGHT } = FORM_COLORS;

const STATE_LABEL: Record<string, { label: string; color: string }> = {
  GOOD:      { label: "Bueno",    color: "#166534" },
  ATTENTION: { label: "Atencion", color: "#92400e" },
  RISK:      { label: "Riesgo",   color: "#991b1b" },
};

export interface MercurioAssetHealthData {
  meta: ControlledDocMeta;
  logoBuffer: Buffer | null;
  tenantName: string;
  report: {
    healthState: string;
    createdAt: Date | string;
    createdByName: string | null;
    periodFrom: Date | string;
    periodTo: Date | string;
  };
  asset: { assetCode: string; name: string | null; vesselCode: string; vesselName: string | null };
  /** Números del sistema (no de la IA). */
  kpis: Array<{ label: string; value: string }>;
  /** Secciones de texto, en orden. */
  sections: Array<{ label: string; body: string }>;
  tz: string;
  locale: string;
}

function val(v: unknown): string {
  const s = String(v ?? "").trim();
  return s || "—";
}

export async function renderMercurioAssetHealthPdf(data: MercurioAssetHealthData): Promise<Buffer> {
  const { meta, logoBuffer, tenantName, report, asset, kpis, sections, tz, locale } = data;
  const fmtDate = (d: unknown) => fmtDateTz(d as string | null | undefined, tz, locale);
  const state = STATE_LABEL[report.healthState] ?? STATE_LABEL.ATTENTION!;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4", margin: 0,
      info: { Title: `Informe de salud — ${val(asset.name ?? asset.assetCode)}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // El buque va por NOMBRE, no por código (regla del proyecto).
    const vesselText = val(asset.vesselName ?? asset.vesselCode);
    const rightInfo = (page: number) =>
      `${val(asset.assetCode)} — ${vesselText} — Pagina ${page} — ${fmtDate(report.createdAt)}`;

    const canvas = createFormCanvas(doc, {
      ml: ML, w: W, marginT: MARGIN_T, contentBottom: CONTENT_BOTTOM,
      drawFooter: (page) => drawControlledDocFooter(doc, { meta, rightInfo: rightInfo(page), x: ML, w: W }),
    });
    const { cell, textArea, ensureSpace } = canvas;

    // ── HEADER (documento controlado) ───────────────────────────────────────
    const hdrH = drawControlledDocHeader(doc, {
      meta, logoBuffer, tenantName, x: ML, y: MARGIN_T, w: W, page: canvas.page,
    });
    canvas.y = MARGIN_T + hdrH + 6;

    // ── IDENTIFICACIÓN ──────────────────────────────────────────────────────
    const RH = 20;
    const lbl = { bold: true, fontSize: 8, bg: LIGHT, color: BLACK } as const;
    const LBL_W = 95, R_LBL_W = 70, R_VAL_W = 120;
    const midW = W - LBL_W - R_LBL_W - R_VAL_W;

    ensureSpace(RH);
    cell(ML, canvas.y, LBL_W, RH, "Embarcacion", lbl);
    cell(ML + LBL_W, canvas.y, midW, RH, sanitizePdfText(vesselText), { bold: true, fontSize: 9, align: "center" });
    cell(ML + LBL_W + midW, canvas.y, R_LBL_W, RH, "Fecha", lbl);
    cell(ML + LBL_W + midW + R_LBL_W, canvas.y, R_VAL_W, RH, fmtDate(report.createdAt), { fontSize: 9, align: "center" });
    canvas.y += RH;

    ensureSpace(RH);
    cell(ML, canvas.y, LBL_W, RH, "Equipo:", lbl);
    cell(ML + LBL_W, canvas.y, midW, RH, sanitizePdfText(val(asset.name ?? asset.assetCode)), { fontSize: 9 });
    cell(ML + LBL_W + midW, canvas.y, R_LBL_W, RH, "Codigo", lbl);
    cell(ML + LBL_W + midW + R_LBL_W, canvas.y, R_VAL_W, RH, sanitizePdfText(val(asset.assetCode)), { bold: true, fontSize: 9, color: "#1d4ed8", align: "center" });
    canvas.y += RH;

    ensureSpace(RH);
    cell(ML, canvas.y, LBL_W, RH, "Periodo:", lbl);
    cell(ML + LBL_W, canvas.y, midW, RH, `${fmtDate(report.periodFrom)} a ${fmtDate(report.periodTo)}`, { fontSize: 9, align: "center" });
    cell(ML + LBL_W + midW, canvas.y, R_LBL_W, RH, "Estado", lbl);
    cell(ML + LBL_W + midW + R_LBL_W, canvas.y, R_VAL_W, RH, state.label, { bold: true, fontSize: 9, color: state.color, align: "center" });
    canvas.y += RH;

    ensureSpace(RH);
    const GEN_LBL_W = 140;
    cell(ML, canvas.y, GEN_LBL_W, RH, "Generado por:", lbl);
    cell(ML + GEN_LBL_W, canvas.y, W - GEN_LBL_W, RH,
      sanitizePdfText(`${val(report.createdByName)} — ${fmtDateTimeTz(report.createdAt as string | Date, tz, locale)}`), { fontSize: 9 });
    canvas.y += RH;

    // ── NÚMEROS DEL SISTEMA ─────────────────────────────────────────────────
    if (kpis.length > 0) {
      const KR = 20;
      ensureSpace(KR * 2);
      const cw = Math.floor(W / kpis.length);
      kpis.forEach((k, i) => cell(ML + i * cw, canvas.y, cw, KR, sanitizePdfText(k.label), { bold: true, fontSize: 7, bg: LIGHT, color: GRAY }));
      canvas.y += KR;
      kpis.forEach((k, i) => cell(ML + i * cw, canvas.y, cw, KR, sanitizePdfText(k.value), { bold: true, fontSize: 9, color: BLACK }));
      canvas.y += KR + 2;
      doc.fontSize(7).font("Helvetica-Oblique").fillColor(GRAY)
        .text("Los numeros los calcula el sistema; la IA redacta la lectura y las sugerencias.", ML, canvas.y, { width: W });
      canvas.y += 12;
    }

    // ── SECCIONES DE TEXTO ──────────────────────────────────────────────────
    function labelLine(label: string, keepWithH = KEEP_MIN) {
      ensureSpace(TITLE_GAP + LABEL_H + keepWithH);
      canvas.y += TITLE_GAP;
      const y0 = canvas.y;
      doc.fontSize(9.5).font("Helvetica-Bold").fillColor(BLACK).text(label, ML, y0, { lineBreak: false });
      const lblW = doc.font("Helvetica-Bold").fontSize(9.5).widthOfString(label);
      doc.moveTo(ML, y0 + 12).lineTo(ML + lblW, y0 + 12).strokeColor(BLACK).lineWidth(0.6).stroke();
      canvas.y = y0 + 15;
    }
    for (const s of sections) {
      labelLine(s.label);
      canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(s.body || "—", { keepMarkdown: true }), 36);
    }

    // Quién decide: el informe es una lectura de la IA, no un dictamen.
    canvas.y += 6;
    ensureSpace(14);
    doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(NAVY)
      .text("La IA sugiere; el diagnostico y las decisiones tecnicas son del Superintendente.", ML, canvas.y, { width: W });

    drawControlledDocFooter(doc, { meta, rightInfo: rightInfo(canvas.page), x: ML, w: W });
    doc.end();
  });
}
