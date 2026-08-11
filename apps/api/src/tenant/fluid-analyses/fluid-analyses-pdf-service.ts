import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getFluidSample } from "./fluid-analyses-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, splitTextIntoPageSegments, sanitizePdfText, renderInlineBoldText } from "../pms/pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";


function val(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

const FLUID_LABELS: Record<string, string> = {
  ENGINE_OIL: "Aceite motor", HYDRAULIC_OIL: "Hidráulico", GEARBOX_OIL: "Reductora",
  TRANSMISSION_OIL: "Transmisión", FUEL_DIESEL: "Diesel", FUEL_GASOIL: "Gasoil",
  COOLING_WATER: "Refrigeración", BOILER_WATER: "Caldera", POTABLE_WATER: "Agua potable",
  REFRIGERANT: "Refrigerante", OTHER: "Otro",
};

const SAMPLE_KIND_LABELS: Record<string, string> = {
  FLUID: "Fluido", VIBRATION: "Vibración", THERMAL: "Termografía", ULTRASOUND: "Ultrasonido", OTHER: "Otro",
};

const VERDICT_STYLE: Record<string, { label: string; color: string }> = {
  NORMAL:          { label: "NORMAL",           color: "#15803d" },
  CAUTION:         { label: "PRECAUCIÓN",       color: "#b45309" },
  CRITICAL:        { label: "CRÍTICO",          color: "#b91c1c" },
  ACTION_REQUIRED: { label: "ACCIÓN REQUERIDA", color: "#991b1b" },
};

const PAGE_H         = 841.89;
const PAGE_W         = 595.28;
const CM             = 72 / 2.54;
const MARGIN_V       = Math.round(1.5 * CM);
const FOOTER_SIZE    = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

export async function buildFluidAnalysisPdf(session: TenantAccessSession, sampleId: string): Promise<Buffer> {
  // Fechas y horas del documento en la hora de la EMPRESA: el servidor
  // corre en UTC y sin esto el papel salía con la hora del servidor.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const sample = await getFluidSample(session, sampleId);

  const prisma = getPrismaClient();

  // Resolve asset name
  let assetName: string | null = null;
  let assetCode: string | null = null;
  if (prisma) {
    try {
      const asset = await (prisma as any).asset.findUnique({
        where: { id: sample.assetId },
        select: { name: true, assetCode: true },
      });
      assetName = asset?.name ?? null;
      assetCode = asset?.assetCode ?? null;
    } catch { /* non-blocking */ }
  }

  // Tenant logo + vessel name (mostrar nombre del buque, no el código)
  let tenantName: string | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  let vesselName = sample.vesselCode;
  if (prisma) {
    try {
      const tenantRow = await (prisma as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { id: true, settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      tenantName = tenantRow?.settings?.displayName ?? null;
      tenantLogoBuffer = await resolveTenantLogo(
        session.tenantSlug,
        tenantRow?.settings?.logoUrl,
        tenantRow?.settings?.logoUrlLight,
      );
      if (tenantRow?.id) {
        const vessel = await (prisma as any).vessel.findFirst({
          where: { tenantId: tenantRow.id, code: sample.vesselCode },
          select: { name: true },
        });
        vesselName = vessel?.name ?? sample.vesselCode;
      }
    } catch { /* non-blocking */ }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `${sample.sampleCode}-${sample.vesselCode}` } });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML = 48;
    const W  = PAGE_W - ML * 2;

    const navy   = "#0f2744";
    const black  = "#0f172a";
    const gray   = "#64748b";
    const border = "#cbd5e1";
    const bgBox  = "#f8fafc";
    const bgHead = "#0f2744";

    let y = MARGIN_V;
    doc.on("pageAdded", () => { (doc as any).y = MARGIN_V; y = MARGIN_V; });

    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_V; }
    }

    function sectionHeader(title: string) {
      ensureSpace(22);
      doc.rect(ML, y, W, 18).fillColor(bgHead).fill();
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#ffffff")
        .text(title.toUpperCase(), ML + 10, y + 5, { width: W - 20, characterSpacing: 1.2 });
      y += 18;
    }

    function inlineRow(fields: Array<{ label: string; value: string; color?: string }>) {
      const boxH = 42;
      ensureSpace(boxH);
      const colW = W / fields.length;
      fields.forEach((f, i) => {
        const bx = ML + i * colW;
        doc.roundedRect(bx, y, colW, boxH, 0).fillColor(bgBox).fill();
        doc.roundedRect(bx, y, colW, boxH, 0).strokeColor(border).lineWidth(0.5).stroke();
        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
          .text(f.label.toUpperCase(), bx + 10, y + 7, { width: colW - 20, characterSpacing: 0.5 });
        doc.fontSize(10.5).font("Helvetica-Bold").fillColor(f.color ?? black)
          .text(f.value, bx + 10, y + 19, { width: colW - 20, ellipsis: true });
      });
      y += boxH;
    }

    // Cuadro con label arriba y texto libre. Se parte en segmentos con caja
    // propia si excede la página, con "(cont.)" en el label de continuaciones.
    function textRow(label: string, rawText: string) {
      const text  = val(rawText);
      const innerW = W - 20;
      const LABEL_H = 18;
      const TOP_PAD = 6;
      const BOTTOM_PAD = 4;

      const firstAvailable = CONTENT_BOTTOM - y - LABEL_H - BOTTOM_PAD;
      const continuationAvailable = CONTENT_BOTTOM - MARGIN_V - LABEL_H - BOTTOM_PAD;
      const segments = splitTextIntoPageSegments(
        doc, text, innerW,
        { font: "Helvetica", fontSize: 9.5, lineGap: 2 },
        firstAvailable, continuationAvailable,
      );

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (i > 0) { doc.addPage(); y = MARGIN_V; }
        const segH = Math.max(38, LABEL_H + seg.contentHeight + BOTTOM_PAD);
        const segLabel = seg.isContinuation ? `${label.toUpperCase()} (CONT.)` : label.toUpperCase();
        doc.roundedRect(ML, y, W, segH, 0).fillColor(bgBox).fill();
        doc.roundedRect(ML, y, W, segH, 0).strokeColor(border).lineWidth(0.5).stroke();
        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
          .text(segLabel, ML + 10, y + TOP_PAD, { width: innerW, characterSpacing: 0.5 });
        doc.fontSize(9.5).font("Helvetica").fillColor(black)
          .text(seg.text, ML + 10, y + LABEL_H, { width: innerW, lineGap: 2 });
        y += segH + 8;
      }
    }

    // ── Renderizado de Markdown (informe IA) ──────────────────────────────────
    // El análisis IA viene como Markdown con encabevados (##/###), tablas y
    // texto con **negrita**. Renderizamos cada bloque respetando saltos de
    // página. Para texto libre NO usamos caja de fondo (no hay "badge" que se
    // pueda quedar atrás), así que el patrón splitTextIntoPageSegments basta.

    const isMdRow = (l: string) => {
      const t = l.trim();
      return t.startsWith("|") && t.endsWith("|") && t.length > 1;
    };
    const isMdSep = (l: string) => {
      const t = l.trim();
      if (!isMdRow(t)) return false;
      return t.slice(1, -1).split("|").every(c => /^\s*:?-+:?\s*$/.test(c));
    };
    const parseMdRow = (l: string) => l.trim().slice(1, -1).split("|").map(c => c.trim());

    function renderMdHeading(text: string, level: number) {
      const clean = sanitizePdfText(text);
      if (level <= 2) {
        ensureSpace(30);
        doc.rect(ML, y, W, 16).fillColor("#eef2f7").fill();
        doc.fontSize(9).font("Helvetica-Bold").fillColor(navy)
          .text(clean, ML + 8, y + 4, { width: W - 16 });
        y += 26;
      } else {
        ensureSpace(26);
        doc.fontSize(9.5).font("Helvetica-Bold").fillColor(navy)
          .text(clean, ML, y + 4, { width: W });
        y = doc.y + 9;
      }
    }

    function renderMdBodyText(text: string) {
      const clean = sanitizePdfText(text, { keepMarkdown: true });
      // Evitar escribir la primera línea sobre el footer si el cursor quedó al pie.
      if (CONTENT_BOTTOM - y < 24) { doc.addPage(); y = MARGIN_V; }
      const firstAvail = CONTENT_BOTTOM - y;
      const contAvail  = CONTENT_BOTTOM - MARGIN_V;
      // Medimos con Helvetica-Bold (cota superior de altura) para que ningún
      // segmento medido "que entra" termine desbordando en el render real.
      const segs = splitTextIntoPageSegments(
        doc, clean, W,
        { font: "Helvetica-Bold", fontSize: 8.5, lineGap: 2 },
        firstAvail, contAvail,
      );
      for (let i = 0; i < segs.length; i++) {
        if (i > 0) { doc.addPage(); y = MARGIN_V; }
        renderInlineBoldText(doc, segs[i].text, ML, y, W, 8.5, 2, black);
        y = doc.y + 4;
      }
    }

    function renderMdTable(header: string[], rows: string[][]) {
      const nCols = Math.max(1, header.length);
      const colW = W / nCols;
      const cellPad = 3;
      const fs = 7;
      const lg = 1;

      const measureRow = (cells: string[], bold: boolean) => {
        let maxH = 0;
        for (let c = 0; c < nCols; c++) {
          const txt = sanitizePdfText(cells[c] ?? "");
          doc.fontSize(fs).font(bold ? "Helvetica-Bold" : "Helvetica");
          const h = doc.heightOfString(txt || " ", { width: colW - 2 * cellPad, lineGap: lg });
          if (h > maxH) maxH = h;
        }
        return Math.max(13, maxH + 2 * cellPad);
      };

      const drawRow = (cells: string[], bold: boolean, idx: number) => {
        const rowH = measureRow(cells, bold);
        // Salto de página: reabrimos el encabezado en la página nueva.
        if (y + rowH > CONTENT_BOTTOM) {
          doc.addPage(); y = MARGIN_V;
          drawRow(header, true, -1);
        }
        const bg = bold ? "#e2e8f0" : (idx % 2 === 0 ? bgBox : "#ffffff");
        doc.rect(ML, y, W, rowH).fillColor(bg).fill();
        doc.rect(ML, y, W, rowH).strokeColor(border).lineWidth(0.3).stroke();
        for (let c = 0; c < nCols; c++) {
          const cx = ML + c * colW;
          if (c > 0) {
            doc.moveTo(cx, y).lineTo(cx, y + rowH).strokeColor(border).lineWidth(0.3).stroke();
          }
          doc.fontSize(fs).font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(bold ? gray : black)
            .text(sanitizePdfText(cells[c] ?? ""), cx + cellPad, y + cellPad, { width: colW - 2 * cellPad, lineGap: lg });
        }
        y += rowH;
      };

      ensureSpace(30);
      drawRow(header, true, -1);
      rows.forEach((r, idx) => drawRow(r, false, idx));
      y += 8;
    }

    function renderAiReport(md: string) {
      const lines = md.replace(/\r\n/g, "\n").split("\n");
      let paraBuf: string[] = [];
      const flushPara = () => {
        const text = paraBuf.join("\n").trim();
        paraBuf = [];
        if (text) renderMdBodyText(text);
      };

      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        // Tabla: fila de encabezado + separador |---|
        if (isMdRow(line) && i + 1 < lines.length && isMdSep(lines[i + 1])) {
          flushPara();
          const header = parseMdRow(line);
          const bodyRows: string[][] = [];
          let j = i + 2;
          while (j < lines.length && isMdRow(lines[j]) && !isMdSep(lines[j])) {
            bodyRows.push(parseMdRow(lines[j]));
            j++;
          }
          renderMdTable(header, bodyRows);
          i = j;
          continue;
        }
        // Encabezados
        const hMatch = /^(#{1,3})\s+(.*)$/.exec(line);
        if (hMatch) {
          flushPara();
          renderMdHeading(hMatch[2], hMatch[1].length);
          i++;
          continue;
        }
        paraBuf.push(line);
        i++;
      }
      flushPara();
    }

    // ── Header ──────────────────────────────────────────────────────────────
    const HEADER_H = 56;
    const TENANT_LOGO_MAX_W = 90;
    doc.rect(ML, y, 4, HEADER_H).fillColor("#1e40af").fill();

    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + W - TENANT_LOGO_MAX_W, y,
          { fit: [TENANT_LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
      } catch { /* ignore */ }
    }

    doc.fontSize(17).font("Helvetica-Bold").fillColor(navy)
      .text("ANÁLISIS DE FLUIDO", ML + 14, y + 4, { width: W * 0.55, lineGap: 2 });
    const fluidSubtitle = `${FLUID_LABELS[sample.fluidType ?? ""] ?? sample.fluidType ?? "—"}${sample.kind !== "FLUID" ? " · " + (SAMPLE_KIND_LABELS[sample.kind] ?? sample.kind) : ""}`;
    doc.fontSize(9).font("Helvetica").fillColor(gray)
      .text(fluidSubtitle, ML + 14, y + 26, { width: W * 0.55 });
    if (!tenantLogoBuffer && tenantName) {
      doc.fontSize(8.5).font("Helvetica").fillColor(gray)
        .text(tenantName, ML + 14, y + 40, { width: W * 0.55 });
    }

    const metaX = ML + W * 0.58;
    const metaW = ML + W - TENANT_LOGO_MAX_W - 8 - metaX;
    doc.fontSize(7.5).font("Helvetica").fillColor(gray)
      .text("Código:", metaX, y, { width: metaW, align: "right" });
    doc.fontSize(12).font("Helvetica-Bold").fillColor(navy)
      .text(sample.sampleCode, metaX, y + 10, { width: metaW, align: "right" });
    doc.fontSize(7.5).font("Helvetica").fillColor(gray)
      .text(`Generado: ${fmtDateTime(new Date())}`, metaX, y + 38, { width: metaW, align: "right" });

    y += 64;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 12;

    // ── Identificación ──────────────────────────────────────────────────────
    sectionHeader("Identificación");
    inlineRow([
      { label: "Buque",         value: vesselName, color: "#1d4ed8" },
      { label: "Equipo",        value: assetCode ? `${assetCode} — ${assetName ?? ""}` : val(assetName ?? sample.assetId) },
      { label: "Tipo de muestra", value: SAMPLE_KIND_LABELS[sample.kind] ?? sample.kind },
    ]);
    inlineRow([
      { label: "Fluido",  value: `${FLUID_LABELS[sample.fluidType ?? ""] ?? val(sample.fluidType)}${sample.fluidProduct ? " · " + sample.fluidProduct : ""}` },
      { label: "Toma",    value: fmt(sample.sampledAt) },
      { label: "Horas",   value: sample.runningHours != null ? String(sample.runningHours) : "—" },
    ]);
    if (sample.labName || sample.labReference || sample.containerCode) {
      inlineRow([
        { label: "Laboratorio",     value: val(sample.labName) },
        { label: "Referencia lab.", value: val(sample.labReference) },
        { label: "Contenedor",      value: val(sample.containerCode) },
      ]);
    }
    inlineRow([
      { label: "Estado",   value: sample.status },
      { label: "Enviada",  value: fmt(sample.sentAt) },
    ]);
    y += 4;

    // ── Resultado ───────────────────────────────────────────────────────────
    if (sample.result) {
      const vs = VERDICT_STYLE[sample.result.verdict] ?? { label: sample.result.verdict, color: black };
      sectionHeader("Resultado");
      inlineRow([
        { label: "Veredicto", value: vs.label, color: vs.color },
        { label: "Recibido",  value: fmt(sample.result.receivedAt) },
      ]);
      if (sample.result.summary) textRow("Resumen", sample.result.summary);
      y += 4;
    }

    // ── Parámetros ──────────────────────────────────────────────────────────
    const rawParams = (sample.result?.parameters && typeof sample.result.parameters === "object")
      ? sample.result.parameters as Record<string, any>
      : null;
    if (rawParams && Object.keys(rawParams).length > 0) {
      sectionHeader("Parámetros");

      const ROW_H = 16;
      const COL_PARAM = W * 0.45;
      const COL_VALUE = W * 0.30;
      const COL_UNIT  = W * 0.25;

      ensureSpace(ROW_H);
      const hBg = "#e2e8f0";
      doc.rect(ML, y, W, ROW_H - 4).fillColor(hBg).fill();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray);
      doc.text("PARÁMETRO", ML + 8, y + 5, { width: COL_PARAM - 8 });
      doc.text("VALOR",     ML + COL_PARAM, y + 5, { width: COL_VALUE, align: "right" });
      doc.text("UNIDAD",    ML + COL_PARAM + COL_VALUE + 8, y + 5, { width: COL_UNIT });
      y += ROW_H - 4;

      const entries = Object.entries(rawParams);
      entries.forEach(([key, raw], idx) => {
        const v    = (raw && typeof raw === "object" && "value" in raw) ? raw.value : raw;
        const unit = (raw && typeof raw === "object" && "unit" in raw) ? raw.unit : "";
        ensureSpace(ROW_H);
        const rowBg = idx % 2 === 0 ? bgBox : "#ffffff";
        doc.rect(ML, y, W, ROW_H).fillColor(rowBg).fill();
        doc.moveTo(ML, y + ROW_H).lineTo(ML + W, y + ROW_H).strokeColor(border).lineWidth(0.3).stroke();
        doc.fontSize(8.5).font("Helvetica").fillColor(black)
          .text(key, ML + 8, y + 4, { width: COL_PARAM - 8 });
        doc.fontSize(8.5).font("Helvetica-Bold").fillColor(black)
          .text(val(v), ML + COL_PARAM, y + 4, { width: COL_VALUE, align: "right" });
        doc.fontSize(8.5).font("Helvetica").fillColor(gray)
          .text(unit ? String(unit) : "—", ML + COL_PARAM + COL_VALUE + 8, y + 4, { width: COL_UNIT });
        y += ROW_H;
      });
      y += 12;
    }

    // ── Análisis ────────────────────────────────────────────────────────────
    if (sample.result?.aiAnalysis) {
      sectionHeader("Análisis");
      if (sample.result.aiAnalysisGeneratedAt) {
        ensureSpace(12);
        doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(gray)
          .text(`Generado: ${fmt(sample.result.aiAnalysisGeneratedAt)}`, ML, y, { width: W });
        y += 12;
      }
      renderAiReport(sample.result.aiAnalysis);
    }

    // ── Footer con sello CMS3.0 ────────────────────────────────────────────
    const footerY = PAGE_H - FOOTER_SIZE;
    doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* ignore */ }
    }
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text("Copilot Management System — Documento generado automáticamente. No requiere firma digital.",
        ML + 18, footerY, { width: W / 2 - 18 });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`${sample.sampleCode} · ${vesselName} · ${fmt(new Date())}`,
        ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
