import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getFluidSample } from "./fluid-analyses-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, splitTextIntoPageSegments, sanitizePdfText, renderInlineBoldText, renderLabeledTextBox } from "../pms/pdf-helpers";
import { resolveTenantForm } from "../pms/tenant-forms-service";
import { drawControlledDocHeader, drawControlledDocFooter, FOOTER_H } from "../pms/pdf-form-chrome";
import { paramLabel, splitVibrationSummary } from "./analysis-text";
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
  FLUID: "Fluido", VIBRATION: "Vibraciones", THERMAL: "Termografía", ULTRASOUND: "Ultrasonido", OTHER: "Otro",
};

// El informe no es siempre de aceite: el título sigue al tipo de muestra (preview V44).
const REPORT_TITLE: Record<string, string> = {
  FLUID: "INFORME DE ANÁLISIS DE FLUIDO",
  VIBRATION: "INFORME DE ANÁLISIS DE VIBRACIONES",
  THERMAL: "INFORME DE TERMOGRAFÍA",
  ULTRASOUND: "INFORME DE ANÁLISIS POR ULTRASONIDO",
  OTHER: "INFORME DE ANÁLISIS",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador", SENT: "Enviada", REPORTED: "Informada", ARCHIVED: "Archivada",
};

const VERDICT_STYLE: Record<string, { label: string; color: string }> = {
  NORMAL:          { label: "NORMAL",           color: "#15803d" },
  CAUTION:         { label: "PRECAUCIÓN",       color: "#b45309" },
  CRITICAL:        { label: "CRÍTICO",          color: "#b91c1c" },
  ACTION_REQUIRED: { label: "ACCIÓN REQUERIDA", color: "#991b1b" },
};

// Vibraciones: el veredicto sale de la severidad que escribió el analista
// (verdictForVibrationSeverity). Se vuelve a mostrar con SUS palabras.
const VIBRATION_SEVERITY = [
  { verdict: "NORMAL",          label: "Ninguna", hint: "Sin hallazgos",               color: "#15803d" },
  { verdict: "CAUTION",         label: "Normal",  hint: "Vigilar · operable",          color: "#ca8a04" },
  { verdict: "CRITICAL",        label: "Alerta",  hint: "Operable con bajo desempeño", color: "#ea580c" },
  { verdict: "ACTION_REQUIRED", label: "Alarma",  hint: "No operable",                 color: "#b91c1c" },
];

// Parámetro que se grafica: el principal de cada punto de medición.
const CHART_PARAM_PRIORITY = ["anchor_velocity", "input_shaft_radial_velocity", "stern_tube_velocity", "input_shaft_axial_velocity"];

type ParamMap = Record<string, unknown>;
function paramValue(raw: unknown): { value: number | null; text: string; unit: string } {
  const v = (raw && typeof raw === "object" && "value" in (raw as object)) ? (raw as { value: unknown }).value : raw;
  const unit = (raw && typeof raw === "object" && "unit" in (raw as object)) ? String((raw as { unit: unknown }).unit ?? "") : "";
  // Sin valor (el parámetro no existe en esa muestra) NO es cero.
  const n = v === null || v === undefined || v === "" ? NaN
    : typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return { value: Number.isFinite(n) ? n : null, text: val(v as string | number | null), unit };
}
function fmtNum(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

const PAGE_H         = 841.89;
const PAGE_W         = 595.28;
const CM             = 72 / 2.54;
const MARGIN_V       = Math.round(1.5 * CM);
const FOOTER_SIZE    = 40;

interface ChartPoint { label: string; value: number; color: string; highlight?: boolean }

export async function buildFluidAnalysisPdf(session: TenantAccessSession, sampleId: string): Promise<Buffer> {
  // Fechas y horas del documento en la hora de la EMPRESA: el servidor
  // corre en UTC y sin esto el papel salía con la hora del servidor.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const sample = await getFluidSample(session, sampleId);
  const kind = String(sample.kind ?? "FLUID");
  const isFluid = kind === "FLUID";
  const isVibration = kind === "VIBRATION";

  const prisma = getPrismaClient();

  let assetName: string | null = null;
  let assetCode: string | null = null;
  let tenantId: string | null = null;
  let tenantName: string | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  let vesselName = sample.vesselCode;
  if (prisma) {
    try {
      const tenantRow = await (prisma as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { id: true, settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      tenantId = tenantRow?.id ?? null;
      tenantName = tenantRow?.settings?.displayName ?? null;
      tenantLogoBuffer = await resolveTenantLogo(
        session.tenantSlug,
        tenantRow?.settings?.logoUrl,
        tenantRow?.settings?.logoUrlLight,
      );
      if (tenantId) {
        const [asset, vessel] = await Promise.all([
          (prisma as any).asset.findFirst({ where: { id: sample.assetId, tenantId }, select: { name: true, assetCode: true } }),
          (prisma as any).vessel.findFirst({ where: { tenantId, code: sample.vesselCode }, select: { name: true } }),
        ]);
        assetName = asset?.name ?? null;
        assetCode = asset?.assetCode ?? null;
        vesselName = vessel?.name ?? sample.vesselCode;
      }
    } catch { /* non-blocking */ }
  }

  const rawParams: ParamMap | null = (sample.result?.parameters && typeof sample.result.parameters === "object")
    ? sample.result.parameters as ParamMap
    : null;

  // ── Datos para los gráficos de vibraciones (sólo lo que ya está cargado) ──
  let chartKey: string | null = null;
  let campaign: ChartPoint[] = [];
  let trend: Array<{ date: string; value: number }> = [];
  if (isVibration && prisma && tenantId && rawParams) {
    const keys = Object.keys(rawParams).filter(k => paramValue(rawParams[k]).value !== null);
    chartKey = CHART_PARAM_PRIORITY.find(k => keys.includes(k)) ?? keys[0] ?? null;
    if (chartKey) {
      try {
        // Mismo informe (referencia + día) y mismo punto de medición: los equipos del mismo tipo.
        if (sample.labReference) {
          const day = new Date(sample.sampledAt);
          const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
          const to = new Date(from.getTime() + 24 * 3600_000);
          const peers = await (prisma as any).fluidSample.findMany({
            where: {
              tenantId, vesselCode: sample.vesselCode, kind: "VIBRATION", deletedAt: null,
              labReference: sample.labReference, sampledAt: { gte: from, lt: to },
            },
            select: { id: true, assetId: true, result: { select: { verdict: true, parameters: true } } },
          }) as Array<{ id: string; assetId: string; result: { verdict: string; parameters: ParamMap | null } | null }>;
          const withKey = peers.filter(p => p.result?.parameters && paramValue(p.result.parameters[chartKey!]).value !== null);
          if (withKey.length >= 2) {
            const assets = await (prisma as any).asset.findMany({
              where: { tenantId, id: { in: withKey.map(p => p.assetId) } },
              select: { id: true, name: true },
            }) as Array<{ id: string; name: string }>;
            const nameById = new Map(assets.map(a => [a.id, a.name]));
            campaign = withKey.map(p => ({
              label: nameById.get(p.assetId) ?? "—",
              value: paramValue(p.result!.parameters![chartKey!]).value!,
              color: VIBRATION_SEVERITY.find(s => s.verdict === p.result!.verdict)?.color ?? "#64748b",
              highlight: p.id === sample.id,
            })).sort((a, b) => a.label.localeCompare(b.label, "es", { numeric: true }));
          }
        }
        // Evolución del mismo equipo en el tiempo.
        const history = await (prisma as any).fluidSample.findMany({
          where: { tenantId, assetId: sample.assetId, kind: "VIBRATION", deletedAt: null },
          orderBy: { sampledAt: "asc" },
          select: { sampledAt: true, result: { select: { parameters: true } } },
        }) as Array<{ sampledAt: Date; result: { parameters: ParamMap | null } | null }>;
        trend = history
          .map(h => ({ date: fmt(h.sampledAt), value: h.result?.parameters ? paramValue(h.result.parameters[chartKey!]).value : null }))
          .filter((h): h is { date: string; value: number } => h.value !== null);
      } catch { /* los gráficos son complemento: sin ellos el informe sale igual */ }
    }
  }

  // Documento controlado del tenant (Mercurio recibe header + footer controlado).
  const form = await resolveTenantForm(session.tenantSlug, "FLUID_ANALYSIS");
  const controlled = form.meta.style === "MERCURIO";
  const reportTitle = REPORT_TITLE[kind] ?? REPORT_TITLE.OTHER!;
  const headerMeta = { ...form.meta, title: reportTitle };

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: `${sample.sampleCode}-${sample.vesselCode}` } });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML = 48;
    const W  = PAGE_W - ML * 2;

    const navy   = controlled ? "#0C2461" : "#0f2744";
    const black  = "#0f172a";
    const gray   = "#64748b";
    const border = "#cbd5e1";
    const bgBox  = "#f8fafc";
    const bgHead = navy;

    const CONTENT_BOTTOM = PAGE_H - (controlled ? FOOTER_H : FOOTER_SIZE) - MARGIN_V;

    let y = MARGIN_V;
    doc.on("pageAdded", () => { (doc as any).y = MARGIN_V; y = MARGIN_V; });

    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_V; }
    }

    function sectionHeader(title: string, keepWith = 0) {
      ensureSpace(22 + keepWith);
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
        doc.rect(bx, y, colW, boxH).fillColor(bgBox).fill();
        doc.rect(bx, y, colW, boxH).strokeColor(border).lineWidth(0.5).stroke();
        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
          .text(f.label.toUpperCase(), bx + 10, y + 7, { width: colW - 20, characterSpacing: 0.5 });
        // Hasta dos líneas: nombres de equipo largos ("LTE-MP-#4 — Motor Principal #4").
        const txt = sanitizePdfText(f.value);
        doc.font("Helvetica-Bold").fontSize(10.5);
        const fs = doc.widthOfString(txt) > colW - 20 ? 8.5 : 10.5;
        doc.fontSize(fs).fillColor(f.color ?? black)
          .text(txt, bx + 10, y + (fs < 10 ? 17 : 19), { width: colW - 20, height: 22, ellipsis: true });
      });
      y += boxH;
    }

    function textRow(label: string, rawText: string) {
      // Un recuadro corto no se parte: pasa entero a la página siguiente.
      doc.font("Helvetica").fontSize(9.5);
      const estH = doc.heightOfString(sanitizePdfText(val(rawText)), { width: W - 20, lineGap: 2 }) + 18 + 20 + 8;
      if (estH < 180) ensureSpace(estH);
      y = renderLabeledTextBox(doc, {
        label, text: val(rawText), x: ML, y, width: W,
        pageBottom: CONTENT_BOTTOM, pageTop: MARGIN_V,
        labelPosition: "inside", fontSize: 9.5, bg: bgBox, border, cornerRadius: 0, sectionGap: 8,
      });
    }

    // ── Renderizado de Markdown (informe IA) ──────────────────────────────────
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
      if (CONTENT_BOTTOM - y < 24) { doc.addPage(); y = MARGIN_V; }
      const firstAvail = CONTENT_BOTTOM - y;
      const contAvail  = CONTENT_BOTTOM - MARGIN_V;
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

    // ── Gráficos de vibraciones ───────────────────────────────────────────────
    function severityScale(verdict: string, priority: string | null) {
      const H = 44;
      ensureSpace(H + 30);
      const gap = 4;
      const boxW = (W - 20 - gap * 3) / 4;
      doc.rect(ML, y, W, H + 30).strokeColor(border).lineWidth(0.5).stroke();
      VIBRATION_SEVERITY.forEach((s, i) => {
        const bx = ML + 10 + i * (boxW + gap);
        const on = s.verdict === verdict;
        doc.roundedRect(bx, y + 8, boxW, H - 8, 3).fillColor(on ? s.color : "#f3f4f6").fill();
        if (on) doc.roundedRect(bx, y + 8, boxW, H - 8, 3).strokeColor("#111827").lineWidth(1.5).stroke();
        doc.fontSize(10).font("Helvetica-Bold").fillColor(on ? "#ffffff" : "#374151")
          .text(s.label, bx, y + 14, { width: boxW, align: "center" });
        doc.fontSize(7).font("Helvetica").fillColor(on ? "#ffffff" : gray)
          .text(s.hint, bx + 2, y + 28, { width: boxW - 4, align: "center", lineBreak: false, ellipsis: true });
      });
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text("Severidad informada por el analista", ML + 10, y + H + 12, { width: W / 2 });
      if (priority) {
        doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#9a3412")
          .text(`Prioridad: ${sanitizePdfText(priority)}`, ML + W / 2, y + H + 11, { width: W / 2 - 10, align: "right" });
      }
      y += H + 30;
    }

    function measurementCards(params: ParamMap) {
      const entries = Object.entries(params);
      const perRow = Math.min(3, Math.max(1, entries.length));
      const colW = W / perRow;
      const boxH = 46;
      for (let r = 0; r < entries.length; r += perRow) {
        ensureSpace(boxH);
        entries.slice(r, r + perRow).forEach(([key, raw], i) => {
          const bx = ML + i * colW;
          const pv = paramValue(raw);
          doc.rect(bx, y, colW, boxH).strokeColor(border).lineWidth(0.5).stroke();
          doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
            .text(paramLabel(key).toUpperCase(), bx + 9, y + 7, { width: colW - 18, lineBreak: false, ellipsis: true, characterSpacing: 0.3 });
          const num = pv.value !== null ? fmtNum(pv.value) : pv.text;
          doc.fontSize(17).font("Helvetica-Bold").fillColor("#c2410c").text(num, bx + 9, y + 20, { continued: true, lineBreak: false });
          doc.fontSize(9).font("Helvetica").fillColor(gray).text(pv.unit ? `  ${sanitizePdfText(pv.unit)}` : "", { lineBreak: false });
        });
        y += boxH;
      }
    }

    function campaignChart(points: ChartPoint[], key: string, unit: string) {
      const rowH = 18;
      const headH = 34;
      const legendH = 18;
      const total = headH + points.length * rowH + legendH + 8;
      ensureSpace(Math.min(total, 220));
      const top = y;
      doc.fontSize(9).font("Helvetica-Bold").fillColor(navy)
        .text(`Comparación con equipos del mismo tipo · Informe ${sanitizePdfText(sample.labReference ?? "")}`, ML + 10, y + 7, { width: W - 20 });
      doc.fontSize(7.5).font("Helvetica").fillColor(gray)
        .text(`${paramLabel(key)}${unit ? ` (${sanitizePdfText(unit)})` : ""} medida el mismo día. La barra marcada es este equipo.`, ML + 10, y + 19, { width: W - 20 });
      y += headH;
      const labelW = 130;
      const valW = 44;
      const trackX = ML + 10 + labelW;
      const trackW = W - 20 - labelW - valW;
      const max = Math.max(...points.map(p => p.value), 0.0001);
      for (const p of points) {
        ensureSpace(rowH);
        doc.fontSize(8.5).font(p.highlight ? "Helvetica-Bold" : "Helvetica").fillColor(black)
          .text(sanitizePdfText(`${p.highlight ? "> " : ""}${p.label}`), ML + 10, y + 3, { width: labelW - 6, lineBreak: false, ellipsis: true });
        doc.rect(trackX, y + 2, trackW, 12).fillColor("#f3f4f6").fill();
        doc.rect(trackX, y + 2, Math.max(2, trackW * (p.value / max)), 12).fillColor(p.color).fill();
        if (p.highlight) doc.rect(trackX, y + 2, trackW, 12).strokeColor("#111827").lineWidth(1).stroke();
        doc.fontSize(8.5).font("Helvetica-Bold").fillColor(black)
          .text(fmtNum(p.value), trackX + trackW, y + 3, { width: valW, align: "right" });
        y += rowH;
      }
      let lx = ML + 10;
      for (const s of VIBRATION_SEVERITY) {
        doc.rect(lx, y + 6, 7, 7).fillColor(s.color).fill();
        doc.fontSize(7).font("Helvetica").fillColor(gray).text(s.label, lx + 10, y + 6, { lineBreak: false });
        lx += 58;
      }
      doc.fontSize(7).font("Helvetica").fillColor(gray)
        .text("Color = severidad del analista para cada equipo.", lx + 4, y + 6, { width: ML + W - lx - 14, lineBreak: false });
      y += legendH + 8;
      if (y - top < 300) doc.rect(ML, top, W, y - top).strokeColor(border).lineWidth(0.5).stroke();
    }

    function trendChart(points: Array<{ date: string; value: number }>, key: string, unit: string) {
      const H = 150;
      ensureSpace(H);
      const top = y;
      doc.rect(ML, top, W, H).strokeColor(border).lineWidth(0.5).stroke();
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text(`${paramLabel(key)}${unit ? ` (${sanitizePdfText(unit)})` : ""} en cada medición de este equipo`, ML + 10, top + 7, { width: W - 20 });
      const px = ML + 40, pw = W - 60, py = top + 26, ph = H - 54;
      const max = Math.max(...points.map(p => p.value)) * 1.15 || 1;
      for (let g = 0; g <= 4; g++) {
        const gy = py + ph - (ph * g) / 4;
        doc.moveTo(px, gy).lineTo(px + pw, gy).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
        doc.fontSize(6.5).font("Helvetica").fillColor(gray).text(fmtNum((max * g) / 4), ML + 4, gy - 3, { width: 32, align: "right" });
      }
      const step = points.length > 1 ? pw / (points.length - 1) : 0;
      const xy = points.map((p, i) => ({ x: px + i * step, y: py + ph - (ph * p.value) / max, p }));
      xy.forEach((pt, i) => { if (i === 0) doc.moveTo(pt.x, pt.y); else doc.lineTo(pt.x, pt.y); });
      doc.strokeColor("#1d4ed8").lineWidth(1.5).stroke();
      xy.forEach((pt, i) => {
        const last = i === xy.length - 1;
        doc.circle(pt.x, pt.y, last ? 3.5 : 2.5).fillColor(last ? "#c2410c" : "#1d4ed8").fill();
        doc.fontSize(7).font("Helvetica-Bold").fillColor(black).text(fmtNum(pt.p.value), pt.x - 20, pt.y - 13, { width: 40, align: "center" });
        doc.fontSize(6.5).font("Helvetica").fillColor(gray).text(pt.p.date, pt.x - 28, py + ph + 6, { width: 56, align: "center" });
      });
      y = top + H + 8;
    }

    // ── Header ──────────────────────────────────────────────────────────────
    if (controlled) {
      const hdrH = drawControlledDocHeader(doc, {
        meta: headerMeta, logoBuffer: form.logoBuffer ?? tenantLogoBuffer,
        tenantName: tenantName ?? session.tenantSlug.toUpperCase(), x: ML, y, w: W, page: 1,
      });
      y += hdrH + 6;
      doc.fontSize(7.5).font("Helvetica").fillColor(gray)
        .text(`Generado: ${fmtDateTime(new Date())}`, ML, y + 4, { width: W / 2 });
      doc.fontSize(7.5).font("Helvetica").fillColor(gray)
        .text("Código: ", ML + W / 2, y + 4, { width: W / 2 - 140, align: "right" });
      doc.fontSize(12).font("Helvetica-Bold").fillColor(navy)
        .text(sample.sampleCode, ML + W - 140, y, { width: 140, align: "right", lineBreak: false });
      y += 22;
    } else {
      const HEADER_H = 56;
      const TENANT_LOGO_MAX_W = 90;
      doc.rect(ML, y, 4, HEADER_H).fillColor("#1e40af").fill();
      if (tenantLogoBuffer) {
        try {
          doc.image(tenantLogoBuffer, ML + W - TENANT_LOGO_MAX_W, y,
            { fit: [TENANT_LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
        } catch { /* ignore */ }
      }
      doc.fontSize(15).font("Helvetica-Bold").fillColor(navy)
        .text(reportTitle, ML + 14, y + 4, { width: W * 0.55, lineGap: 2 });
      if (!tenantLogoBuffer && tenantName) {
        doc.fontSize(8.5).font("Helvetica").fillColor(gray)
          .text(tenantName, ML + 14, y + 42, { width: W * 0.55 });
      }
      const metaX = ML + W * 0.55;
      const metaW = ML + W - TENANT_LOGO_MAX_W - 8 - metaX;
      doc.fontSize(7.5).font("Helvetica").fillColor(gray)
        .text("Código:", metaX, y, { width: metaW, align: "right" });
      doc.fontSize(12).font("Helvetica-Bold").fillColor(navy)
        .text(sample.sampleCode, metaX, y + 10, { width: metaW, align: "right" });
      doc.fontSize(7.5).font("Helvetica").fillColor(gray)
        .text(`Generado: ${fmtDateTime(new Date())}`, metaX, y + 38, { width: metaW, align: "right", lineBreak: false });
      y += 64;
      doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
      y += 12;
    }

    // ── Identificación ──────────────────────────────────────────────────────
    sectionHeader("Identificación");
    inlineRow([
      { label: "Buque",            value: vesselName, color: "#1d4ed8" },
      { label: "Equipo",           value: assetCode ? `${assetCode} — ${assetName ?? ""}` : val(assetName ?? sample.assetId) },
      { label: "Tipo de análisis", value: SAMPLE_KIND_LABELS[kind] ?? kind },
    ]);
    if (isFluid) {
      inlineRow([
        { label: "Fluido", value: `${FLUID_LABELS[sample.fluidType ?? ""] ?? val(sample.fluidType)}${sample.fluidProduct ? " · " + sample.fluidProduct : ""}` },
        { label: "Toma",   value: fmt(sample.sampledAt) },
        { label: "Horas",  value: sample.runningHours != null ? String(sample.runningHours) : "—" },
      ]);
    } else {
      inlineRow([
        { label: "Fecha de medición", value: fmt(sample.sampledAt) },
        { label: "Horas",             value: sample.runningHours != null ? String(sample.runningHours) : "—" },
        { label: "Estado",            value: STATUS_LABELS[sample.status] ?? sample.status },
      ]);
    }
    if (sample.labName || sample.labReference || sample.containerCode) {
      inlineRow([
        { label: isFluid ? "Laboratorio" : "Analista", value: val(sample.labName) },
        { label: isFluid ? "Referencia lab." : "Informe N°", value: val(sample.labReference) },
        ...(isFluid ? [{ label: "Contenedor", value: val(sample.containerCode) }] : []),
      ]);
    }
    if (isFluid) {
      inlineRow([
        { label: "Estado",  value: STATUS_LABELS[sample.status] ?? sample.status },
        { label: "Enviada", value: fmt(sample.sentAt) },
      ]);
    }
    y += 4;

    if (isVibration && sample.result) {
      // ── Vibraciones: resultado gráfico (preview V44) ────────────────────────
      const parts = splitVibrationSummary(sample.result.summary);
      sectionHeader("Resultado del analista", 74);
      severityScale(sample.result.verdict, parts.priority);
      y += 4;

      if (rawParams && Object.keys(rawParams).length > 0) {
        sectionHeader("Mediciones", 46);
        measurementCards(rawParams);
        if (chartKey && campaign.length >= 2) {
          campaignChart(campaign, chartKey, paramValue(rawParams[chartKey]).unit);
        }
        y += 4;
      }

      if (parts.finding || parts.recommendation.length > 0) {
        sectionHeader("Diagnóstico y recomendación", 40);
        if (parts.finding) textRow("Hallazgo", parts.finding);
        if (parts.recommendation.length > 0) textRow("Recomendación", parts.recommendation.map(r => `• ${r}`).join("\n"));
      }

      if (chartKey && trend.length >= 2) {
        sectionHeader("Evolución del equipo", 150);
        trendChart(trend, chartKey, rawParams ? paramValue(rawParams[chartKey]).unit : "");
      }
    } else {
      // ── Resultado ─────────────────────────────────────────────────────────
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

      // ── Parámetros ────────────────────────────────────────────────────────
      if (rawParams && Object.keys(rawParams).length > 0) {
        sectionHeader("Parámetros");

        const ROW_H = 16;
        const COL_PARAM = W * 0.45;
        const COL_VALUE = W * 0.30;
        const COL_UNIT  = W * 0.25;

        ensureSpace(ROW_H);
        doc.rect(ML, y, W, ROW_H - 4).fillColor("#e2e8f0").fill();
        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray);
        doc.text("PARÁMETRO", ML + 8, y + 5, { width: COL_PARAM - 8 });
        doc.text("VALOR",     ML + COL_PARAM, y + 5, { width: COL_VALUE, align: "right" });
        doc.text("UNIDAD",    ML + COL_PARAM + COL_VALUE + 8, y + 5, { width: COL_UNIT });
        y += ROW_H - 4;

        Object.entries(rawParams).forEach(([key, raw], idx) => {
          const pv = paramValue(raw);
          ensureSpace(ROW_H);
          doc.rect(ML, y, W, ROW_H).fillColor(idx % 2 === 0 ? bgBox : "#ffffff").fill();
          doc.moveTo(ML, y + ROW_H).lineTo(ML + W, y + ROW_H).strokeColor(border).lineWidth(0.3).stroke();
          doc.fontSize(8.5).font("Helvetica").fillColor(black)
            .text(sanitizePdfText(isFluid ? key : paramLabel(key)), ML + 8, y + 4, { width: COL_PARAM - 8 });
          doc.fontSize(8.5).font("Helvetica-Bold").fillColor(black)
            .text(sanitizePdfText(pv.text), ML + COL_PARAM, y + 4, { width: COL_VALUE, align: "right" });
          doc.fontSize(8.5).font("Helvetica").fillColor(gray)
            .text(pv.unit ? sanitizePdfText(pv.unit) : "—", ML + COL_PARAM + COL_VALUE + 8, y + 4, { width: COL_UNIT });
          y += ROW_H;
        });
        y += 12;
      }
    }

    // ── Análisis IA ─────────────────────────────────────────────────────────
    // Sólo en fluidos: el análisis automático hoy está pensado para aceite y en
    // otros tipos de muestra sale fuera de contexto (decisión V44).
    if (isFluid && sample.result?.aiAnalysis) {
      sectionHeader("Análisis", 80);
      if (sample.result.aiAnalysisGeneratedAt) {
        ensureSpace(12);
        doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(gray)
          .text(`Generado: ${fmt(sample.result.aiAnalysisGeneratedAt)}`, ML, y + 4, { width: W });
        y += 16;
      }
      renderAiReport(sample.result.aiAnalysis);
    }

    // ── Footer por página ───────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      if (controlled) {
        const rightInfo = [form.meta.formCode, sample.sampleCode, vesselName, `Pagina ${i + 1}`, fmt(new Date())].filter(Boolean).join(" — ");
        drawControlledDocFooter(doc, { meta: headerMeta, rightInfo, x: ML, w: W });
      } else {
        const footerY = PAGE_H - FOOTER_SIZE;
        doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
        if (existsSync(LOGO_PATH)) {
          try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* ignore */ }
        }
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text("Copilot Management System — Documento generado automáticamente. No requiere firma digital.",
            ML + 18, footerY, { width: W / 2 - 18, lineBreak: false });
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text(`${sample.sampleCode} · ${vesselName} · ${fmt(new Date())}`,
            ML, footerY, { width: W, align: "right", lineBreak: false });
      }
    }

    doc.end();
  });
}
