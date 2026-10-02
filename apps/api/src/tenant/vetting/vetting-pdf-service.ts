// PDF de preparación para vetting (BIQ5, OCIMF). Es el papel con el que la
// compañía se prepara para la inspección de una barcaza o un remolcador: por
// buque y por capítulo del cuestionario, la evidencia que tiene el sistema, con
// el diagnóstico de lo que falta. Cierra con lo que el sistema no puede
// comprobar y queda a verificar a bordo.
//
// Mismo armado que el PDF del Capítulo 10 de ISM (ism-pdf-service.ts).

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText, renderLabeledTextBox } from "../pms/pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";
import {
  GROUP_TITLE as TMSA_GROUP_TITLE,
  METRIC_LABEL as TMSA_METRIC_LABEL,
  FIX_TEXT as TMSA_FIX_TEXT,
} from "../tmsa/tmsa-pdf-service";
import { requireAuditPanelAccess, type TmsaMetric } from "../tmsa/tmsa-service";
import { getVettingBiqEvidence, type VetStatus, type VetFinding } from "./vetting-service";
import { BIQ_CHAPTERS } from "./vetting-topics";
import { CHAPTER_TEXT, OWN_GROUP_TITLE, FIX_TEXT, ownMetricLabel } from "./vetting-labels";

const FIX_TONE: Record<string, { bg: string; border: string }> = {
  GAP:       { bg: "#fef2f2", border: "#fecaca" },
  ATTENTION: { bg: "#fffbeb", border: "#fde68a" },
  INFO:      { bg: "#f8fafc", border: "#e2e8f0" },
};

const STATUS_TEXT: Record<VetStatus, string> = { OK: "OK", ATTENTION: "ATENCIÓN", GAP: "BRECHA", INFO: "INFO" };
const STATUS_COLOR: Record<VetStatus, string> = { OK: "#16a34a", ATTENTION: "#b45309", GAP: "#b91c1c", INFO: "#64748b" };

const groupTitle = (key: string) => OWN_GROUP_TITLE[key] ?? TMSA_GROUP_TITLE[key] ?? key;
const metricLabel = (key: string) => ownMetricLabel(key) ?? TMSA_METRIC_LABEL[key] ?? key;
/** Los hallazgos heredados de TMSA llevan su propio texto. */
const fixText = (f: VetFinding, own: boolean) => (own ? FIX_TEXT[f.key] : TMSA_FIX_TEXT[f.key]);

function findingValue(f: VetFinding): string {
  if (f.kind === "pct") return `${Math.round(f.value * 100)}%`;
  return f.value > 0 ? String(f.value) : "";
}
function metricText(m: TmsaMetric): string {
  return m.kind === "pct" ? `${Math.round(m.value * 100)}%` : String(m.value);
}

const PAGE_H      = 841.89;
const PAGE_W      = 595.28;
const CM          = 72 / 2.54;
const MARGIN_V    = Math.round(1.5 * CM);
const FOOTER_SIZE = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

export async function buildVettingBiqPdf(
  session: TenantAccessSession,
  vesselCode: string | null,
): Promise<Buffer> {
  requireAuditPanelAccess(session);
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);

  // Desglose barco por barco, como los PDF de TMSA e ISM.
  const { items } = await getVettingBiqEvidence(session, vesselCode, "perVessel");

  let tenantName: string | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const tenantRow = await prisma.tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      tenantName = tenantRow?.settings?.displayName ?? null;
      tenantLogoBuffer = await resolveTenantLogo(
        session.tenantSlug,
        tenantRow?.settings?.logoUrl ?? null,
        tenantRow?.settings?.logoUrlLight ?? null,
      );
    } catch { /* non-blocking */ }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      bufferPages: true,
      info: { Title: `Vetting BIQ5 — ${tenantName ?? session.tenantSlug}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML = 48, MR = 48, W = PAGE_W - ML - MR;
    const black = "#0f172a", navy = "#1e3a5f", gray = "#64748b", border = "#e2e8f0", bgBox = "#f8fafc";
    let y = MARGIN_V;

    doc.on("pageAdded", () => { (doc as unknown as { y: number }).y = MARGIN_V; y = MARGIN_V; });
    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_V; }
    }

    // ── Header ───────────────────────────────────────────────────────────────
    const HEADER_H = 64, LOGO_MAX_W = 90;
    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + W - LOGO_MAX_W, y, { fit: [LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
      } catch { /* logo unavailable */ }
    }
    const titleW = W - LOGO_MAX_W - 16;
    doc.fontSize(17).font("Helvetica-Bold").fillColor(navy)
      .text("PREPARACIÓN PARA VETTING — BIQ5", ML, y + 4, { width: titleW, lineBreak: false });
    doc.fontSize(11).font("Helvetica").fillColor(gray)
      .text("Cuestionario OCIMF de inspección de barcazas y remolcadores", ML, y + 28, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(sanitizePdfText(`${tenantName ?? session.tenantSlug} · Emitido: ${fmtDateTime(new Date())}`), ML, y + 46, { width: titleW });
    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(navy).lineWidth(1.5).stroke();
    y += 14;

    if (items.length === 0) {
      doc.fontSize(10).font("Helvetica").fillColor(gray)
        .text("No hay datos disponibles para el alcance solicitado.", ML, y, { width: W });
      drawFooters();
      doc.end();
      return;
    }

    for (const v of items) {
      ensureSpace(40);
      doc.fontSize(13).font("Helvetica-Bold").fillColor(black)
        .text(sanitizePdfText(v.vesselName), ML, y, { width: W * 0.55 });
      const chips = `OK ${v.summary.ok}   ·   Atención ${v.summary.attention}   ·   Brecha ${v.summary.gap}`;
      doc.fontSize(9).font("Helvetica-Bold").fillColor(gray)
        .text(chips, ML + W * 0.55, y + 2, { width: W * 0.45, align: "right" });
      y += 22;
      doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.7).stroke();
      y += 10;

      // Los grupos vienen en el orden del cuestionario: se imprime el capítulo
      // cada vez que cambia, con qué mira el inspector, y debajo la evidencia.
      let lastChapter: string | null = null;
      for (const g of v.groups) {
        if (g.chapter !== lastChapter) {
          const meta = CHAPTER_TEXT[g.chapter];
          const bodyText = sanitizePdfText(meta.what);
          doc.fontSize(9).font("Helvetica");
          const textH = doc.heightOfString(bodyText, { width: W - 24 });
          // El capítulo y su enunciado entran juntos o pasan de página.
          ensureSpace(20 + textH + 12);
          doc.fontSize(10).font("Helvetica-Bold").fillColor(navy)
            .text(sanitizePdfText(`CAPÍTULO ${g.chapter} · ${meta.title.toUpperCase()}`), ML, y, { width: W });
          y += 14;
          doc.fontSize(9).font("Helvetica-Oblique").fillColor(gray)
            .text(bodyText, ML + 12, y, { width: W - 24 });
          y += textH + 8;
          lastChapter = g.chapter;
        }

        const rows = Math.ceil(g.metrics.length / 2);
        const BLOCK_H = 22 + rows * 16 + 8;
        ensureSpace(BLOCK_H + 6);

        doc.roundedRect(ML, y, W, BLOCK_H, 5).fillColor(bgBox).fill();
        doc.roundedRect(ML, y, W, BLOCK_H, 5).strokeColor(border).lineWidth(1).stroke();

        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
          .text(sanitizePdfText(`BIQ ${g.questions}`), ML + 12, y + 8, { characterSpacing: 0.6, width: W * 0.6, lineBreak: false });
        doc.fontSize(11).font("Helvetica-Bold").fillColor(black)
          .text(sanitizePdfText(groupTitle(g.key)), ML + 12, y + 17, { width: W * 0.6 });

        const pillW = 62, pillH = 16;
        doc.roundedRect(ML + W - pillW - 12, y + 10, pillW, pillH, 8).fillColor(STATUS_COLOR[g.status]).fill();
        doc.fontSize(8).font("Helvetica-Bold").fillColor("#ffffff")
          .text(STATUS_TEXT[g.status], ML + W - pillW - 12, y + 14, { width: pillW, align: "center", characterSpacing: 0.5 });

        const COL_W = (W - 24) / 2;
        const mTop = y + 36;
        g.metrics.forEach((m, i) => {
          const col = i % 2, row = Math.floor(i / 2);
          const cx = ML + 12 + col * COL_W;
          const cy = mTop + row * 16;
          doc.fontSize(8).font("Helvetica").fillColor(gray)
            .text(sanitizePdfText(metricLabel(m.key)), cx, cy, { width: COL_W - 60 });
          doc.fontSize(9).font("Helvetica-Bold").fillColor(black)
            .text(metricText(m), cx + COL_W - 56, cy, { width: 50, align: "right" });
        });

        y += BLOCK_H + 6;

        // Diagnóstico: cajas paginadas (renderLabeledTextBox), obligatorio para
        // texto libre según la skill pms-pdf-generation.
        for (const f of g.findings ?? []) {
          const fx = fixText(f, g.own);
          if (!fx) continue;
          const steps = fx.how
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean)
            .map((line, i) => `${i + 1}. ${line}`)
            .join("\n");
          const value = findingValue(f);
          const tone = FIX_TONE[f.status] ?? FIX_TONE.INFO!;
          y = renderLabeledTextBox(doc, {
            label: `${STATUS_TEXT[f.status]} · ${fx.title}${value ? ` · ${value}` : ""}`,
            text: `**Qué está mal:** ${fx.what}\n\n**Cómo se arregla:**\n${steps}`,
            x: ML,
            y,
            width: W,
            pageBottom: CONTENT_BOTTOM,
            pageTop: MARGIN_V,
            labelPosition: "above",
            labelColor: STATUS_COLOR[f.status],
            fontSize: 8.5,
            bg: tone.bg,
            border: tone.border,
            markdown: true,
          });
        }
      }
      y += 10;
    }

    // ── Lo que el sistema no puede comprobar ────────────────────────────────
    // Una sola vez, para todos los buques: es lo mismo en cada uno.
    ensureSpace(40);
    doc.fontSize(12).font("Helvetica-Bold").fillColor(navy)
      .text("A VERIFICAR A BORDO", ML, y, { width: W });
    y += 18;
    y = renderLabeledTextBox(doc, {
      label: "Lo que el inspector comprueba mirando el buque y sus documentos originales",
      text: BIQ_CHAPTERS.map(ch => `**${ch} · ${CHAPTER_TEXT[ch].title}:** ${CHAPTER_TEXT[ch].onboard}`).join("\n"),
      x: ML,
      y,
      width: W,
      pageBottom: CONTENT_BOTTOM,
      pageTop: MARGIN_V,
      labelPosition: "above",
      fontSize: 8.5,
      bg: bgBox,
      border,
      markdown: true,
    });

    // Aclaración
    ensureSpace(52);
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.7).stroke();
    y += 8;
    doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(gray).text(
      sanitizePdfText(
        "Documento interno de preparación para la inspección. No anticipa el resultado de la inspección de vetting ni reemplaza " +
        "la verificación a bordo: reúne la evidencia registrada en el sistema de mantenimiento para cada capítulo del cuestionario " +
        "BIQ5 de OCIMF, cuyo texto completo es propiedad de OCIMF.",
      ),
      ML, y, { width: W },
    );

    drawFooters();
    doc.end();

    function drawFooters() {
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        const footerY = PAGE_H - FOOTER_SIZE;
        doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
        if (existsSync(LOGO_PATH)) {
          try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* logo missing */ }
        }
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text("Copilot Management System — Preparación para vetting (BIQ5)", ML + 18, footerY, { width: W / 2 - 18 });
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text(sanitizePdfText(`${tenantName ?? session.tenantSlug} · ${fmt(new Date())} · Pág. ${i + 1}/${range.count}`), ML, footerY, { width: W, align: "right" });
      }
      doc.flushPages();
    }
  });
}
