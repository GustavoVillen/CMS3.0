// Voyage Tank Report PDF (Formulario M2 — Medición de Tanques por Viaje).
// Reproduce el FORMULARIO M2 en papel de Mercurio (apaisado): encabezado con
// logo + título + "Formulario M2 Rev 0", fecha/tramo/barcaza, barra verde
// "Medición de Carboneras", dos paneles Inicial/Final lado a lado con Altura
// líquida/agua (mm) y Volúmenes (L) + NATURALES, horómetros (amarillo), caja
// SUBIDA (km/fechas/consumo + bunker) y bloque de firma. Sigue pms-pdf-generation.

import PDFDocument from "pdfkit";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { log } from "../../common/logger";
import type { TenantAccessSession } from "../auth/session-store";
import { getVoyageTankReportFull } from "./voyage-tank-reports-integration-service";
import { resolveTenantLogo, sanitizePdfText } from "../pms/pdf-helpers";
import { resolveTenantTime, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";

function val(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return sanitizePdfText(String(v));
}

// Litros con separador de miles estilo es-AR (1.234) para calzar con el papel.
function fmtLts(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Math.round(v).toLocaleString("es-AR");
}

function fmtMm(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  return v.toLocaleString("es-AR");
}

function fmtHrs(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("es-AR");
}


// ── Helpers de cálculo (duplicados en el frontend; fórmula trivial) ──
const netInitial = (t: any) => (t.volumeTotalLtsInitial ?? 0) - (t.volumeWaterLtsInitial ?? 0);
const netFinal   = (t: any) => (t.volumeTotalLtsFinal ?? 0) - (t.volumeWaterLtsFinal ?? 0);

export async function buildVoyageTankReportPdf(session: TenantAccessSession, reportId: string): Promise<Buffer> {
  // Fechas y horas del documento en la hora de la EMPRESA: el servidor
  // corre en UTC y sin esto el papel salía con la hora del servidor.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantRow = await prisma.tenant.findUnique({
    where: { slug: session.tenantSlug },
    include: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
  });
  const tenantName = tenantRow?.settings?.displayName ?? session.tenantSlug;

  const report = await getVoyageTankReportFull(session, reportId);
  if (!report) throw new RouteError(404, "NOT_FOUND", "Medición no encontrada.");

  // Nombre del buque (mostrar NOMBRE, no código).
  let vesselName: string = report.vesselCode;
  if (tenantRow) {
    const vessel = await prisma.vessel.findFirst({ where: { tenantId: tenantRow.id, code: report.vesselCode }, select: { name: true } });
    if (vessel?.name) vesselName = vessel.name;
  }
  const logoBuffer = await resolveTenantLogo(session.tenantSlug, tenantRow?.settings?.logoUrl, tenantRow?.settings?.logoUrlLight);

  try {
    return await renderPdf({ tenantName, vesselName, logoBuffer, report, tz, locale });
  } catch (err) {
    log.error("[buildVoyageTankReportPdf] render failed:", err);
    throw new RouteError(500, "PDF_RENDER_FAILED", err instanceof Error ? err.message : "No se pudo generar el PDF.");
  }
}

function renderPdf(ctx: { tenantName: string; vesselName: string; logoBuffer: Buffer | null; report: any; tz: string; locale: string }): Promise<Buffer> {
  const { tenantName, vesselName, logoBuffer, report, tz, locale } = ctx;
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);

  return new Promise<Buffer>((resolve, reject) => {
    // Apaisado para reproducir el M2 de papel (dos paneles Inicial/Final).
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 0,
      info: { Title: sanitizePdfText(`Medicion de Tanques ${vesselName} ${report.voyageCode ?? ""}`) },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // A4 landscape
    const PW = 841.89, PH = 595.28;
    const ML = 28, MR = 28;
    const W = PW - ML - MR;

    // Paleta estilo planilla Mercurio (Excel).
    const green = "#548235", greenDark = "#375623";
    const blue = "#DDEBF7", blueMid = "#BDD7EE";
    const yellow = "#FFFF00", yellowLt = "#FFF2CC";
    const gray = "#D9D9D9", grayLt = "#F2F2F2";
    const border = "#7F7F7F", black = "#000000", ink = "#1a1a1a", muted = "#595959";

    let y = 26;

    const setFont = (size: number, bold = false) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    const box = (x: number, yy: number, w: number, h: number, fill?: string) => {
      if (fill) doc.rect(x, yy, w, h).fillColor(fill).fill();
      doc.rect(x, yy, w, h).strokeColor(border).lineWidth(0.6).stroke();
    };
    // Texto dentro de una celda con alineación y padding.
    const cellText = (s: string, x: number, yy: number, w: number, h: number, opts: { size?: number; bold?: boolean; color?: string; align?: "left" | "center" | "right" } = {}) => {
      setFont(opts.size ?? 8, opts.bold ?? false);
      doc.fillColor(opts.color ?? ink);
      const th = doc.currentLineHeight();
      const ty = yy + Math.max(2, (h - th) / 2);
      doc.text(sanitizePdfText(s), x + 4, ty, { width: w - 8, align: opts.align ?? "left", ellipsis: true, lineBreak: false });
    };

    // ── Encabezado: logo | título | Formulario M2 ──
    const headH = 46;
    const logoW = 150, formW = 150, titleW = W - logoW - formW;
    box(ML, y, logoW, headH);
    box(ML + logoW, y, titleW, headH);
    box(ML + logoW + titleW, y, formW, headH);
    if (logoBuffer) {
      try { doc.image(logoBuffer, ML + 8, y + 7, { fit: [logoW - 16, headH - 14], align: "center", valign: "center" }); }
      catch { cellText(tenantName, ML, y, logoW, headH, { size: 8, bold: true, align: "center" }); }
    } else {
      cellText(tenantName, ML, y, logoW, headH, { size: 8, bold: true, align: "center" });
    }
    setFont(11, true);
    doc.fillColor(greenDark).text("MEDICIÓN DE TANQUES DE\nALMACENAMIENTO Y CONSUMO", ML + logoW + 6, y + 9, { width: titleW - 12, align: "center", lineGap: 2 });
    cellText("FORMULARIO M2", ML + logoW + titleW, y + 6, formW, 16, { size: 9, bold: true, align: "center", color: greenDark });
    cellText("Rev 0", ML + logoW + titleW, y + 24, formW, 14, { size: 8, align: "center", color: muted });
    y += headH;

    // ── Fecha / Tramo / Barcaza ──
    const infoRow = (label: string, value: string) => {
      const rh = 16, lw = 120;
      box(ML, y, lw, rh, grayLt);
      box(ML + lw, y, W - lw, rh, blue);
      cellText(label, ML, y, lw, rh, { size: 8, bold: true, color: greenDark });
      cellText(value, ML + lw, y, W - lw, rh, { size: 8.5 });
      y += rh;
    };
    infoRow("FECHA", fmtDateTime(report.reportDateTime));
    infoRow("TRAMO", val(report.tramo));
    infoRow("BARCAZA / BUQUE", vesselName);

    // ── Barra verde "MEDICIÓN DE CARBONERAS" + Viaje ──
    const barH = 18, viajeW = 150;
    box(ML, y, W - viajeW, barH, green);
    box(ML + W - viajeW, y, viajeW, barH, blueMid);
    cellText("MEDICIÓN DE CARBONERAS", ML, y, W - viajeW, barH, { size: 9, bold: true, color: "#ffffff", align: "center" });
    cellText(`Viaje: ${val(report.voyageCode)}`, ML + W - viajeW, y, viajeW, barH, { size: 9, bold: true, align: "center", color: greenDark });
    y += barH;

    // ── Dos paneles Inicial / Final ──
    const tanks = (report.tankReadings ?? []) as any[];
    const gap = 10;
    const panelW = (W - gap) / 2;
    // columnas dentro del panel: TK | Alt.líq | Alt.agua | Vol.total | Vol.agua | Vol.neto
    const c0 = panelW * 0.26;            // TK
    const cN = (panelW - c0) / 5;        // resto
    const cols = [c0, cN, cN, cN, cN, cN];
    const headers = ["TK", "Alt. líq.\n(mm)", "Alt. agua\n(mm)", "Vol. total\n(lts)", "Vol. agua\n(lts)", "Vol. neto\n(lts)"];

    const panelTop = y;
    const drawPanel = (px: number, title: string, phase: "ini" | "fin") => {
      let py = panelTop;
      // header verde
      box(px, py, panelW, 16, green);
      cellText(title, px, py, panelW, 16, { size: 9, bold: true, color: "#ffffff", align: "center" });
      py += 16;
      // fila de columnas
      const chH = 22;
      let cx = px;
      for (let i = 0; i < cols.length; i++) {
        box(cx, py, cols[i]!, chH, grayLt);
        setFont(6.2, true); doc.fillColor(greenDark);
        doc.text(sanitizePdfText(headers[i]!), cx + 2, py + 4, { width: cols[i]! - 4, align: "center", lineGap: 0 });
        cx += cols[i]!;
      }
      py += chH;
      // filas de tanques
      let sum = 0;
      for (const t of tanks) {
        const rh = 14;
        const isIni = phase === "ini";
        const net = isIni ? netInitial(t) : netFinal(t);
        sum += net;
        const vals = isIni
          ? [t.tankLabel, fmtMm(t.liquidHeightMmInitial), fmtMm(t.waterHeightMmInitial), fmtLts(t.volumeTotalLtsInitial), fmtLts(t.volumeWaterLtsInitial), fmtLts(net)]
          : [t.tankLabel, fmtMm(t.liquidHeightMmFinal), fmtMm(t.waterHeightMmFinal), fmtLts(t.volumeTotalLtsFinal), fmtLts(t.volumeWaterLtsFinal), fmtLts(net)];
        cx = px;
        for (let i = 0; i < cols.length; i++) {
          box(cx, py, cols[i]!, rh);
          cellText(String(vals[i] ?? ""), cx, py, cols[i]!, rh, { size: 6.8, align: i === 0 ? "left" : "right" });
          cx += cols[i]!;
        }
        py += rh;
      }
      // NATURALES
      const nh = 15;
      box(px, py, c0 + cN + cN + cN + cN, nh, gray);
      box(px + c0 + cN + cN + cN + cN, py, cN, nh, gray);
      cellText("NATURALES", px, py, c0, nh, { size: 7.5, bold: true });
      cellText(fmtLts(sum), px + c0 + cN + cN + cN + cN, py, cN, nh, { size: 7.5, bold: true, align: "right" });
      py += nh;
      return py;
    };
    const yLeft = drawPanel(ML, `${vesselName} — INICIAL`, "ini");
    drawPanel(ML + panelW + gap, `${vesselName} — FINAL`, "fin");
    y = yLeft + 8;

    // ── Sección inferior: Horómetros (izq) + Subida/Bunker (der) ──
    const engines = (report.engineHours ?? []) as any[];
    const secTop = y;
    const leftW = panelW;               // horómetros ~ mitad
    const rightW = W - leftW - gap;     // subida ~ mitad

    // Horómetros
    let ly = secTop;
    box(ML, ly, leftW, 16, yellow);
    cellText("HORÓMETROS", ML, ly, leftW, 16, { size: 9, bold: true, align: "center", color: black });
    ly += 16;
    const eCols = [leftW * 0.4, leftW * 0.2, leftW * 0.2, leftW * 0.2];
    const eHead = ["Motor", "Inicial (hs)", "Final (hs)", "Diferencia (hs)"];
    let ex = ML;
    for (let i = 0; i < eCols.length; i++) {
      box(ex, ly, eCols[i]!, 14, yellowLt);
      cellText(eHead[i]!, ex, ly, eCols[i]!, 14, { size: 6.8, bold: true, align: i === 0 ? "left" : "center", color: greenDark });
      ex += eCols[i]!;
    }
    ly += 14;
    if (engines.length === 0) {
      box(ML, ly, leftW, 14);
      cellText("Sin horómetros cargados", ML, ly, leftW, 14, { size: 7, color: muted, align: "center" });
      ly += 14;
    } else {
      for (const e of engines) {
        const rh = 14;
        const hasBoth = e.hoursInitial != null && e.hoursFinal != null;
        const diff = (e.hoursFinal ?? 0) - (e.hoursInitial ?? 0);
        const cells = [e.engineLabel, fmtHrs(e.hoursInitial), fmtHrs(e.hoursFinal), hasBoth ? fmtHrs(diff) : "—"];
        ex = ML;
        for (let i = 0; i < eCols.length; i++) {
          box(ex, ly, eCols[i]!, rh);
          cellText(String(cells[i] ?? ""), ex, ly, eCols[i]!, rh, { size: 7, align: i === 0 ? "left" : "right" });
          ex += eCols[i]!;
        }
        ly += rh;
      }
    }

    // Subida / Bunker
    const rx = ML + leftW + gap;
    let ry = secTop;
    box(rx, ry, rightW, 16, blueMid);
    cellText("SUBIDA", rx, ry, rightW, 16, { size: 9, bold: true, align: "center", color: greenDark });
    ry += 16;
    const kmDiff = (report.kmStart != null && report.kmEnd != null) ? (report.kmEnd - report.kmStart) : null;
    const subRow = (label: string, v1: string, v2: string, v3: string, v3label?: string) => {
      const rh = 15, lw = rightW * 0.22, vw = (rightW - lw) / 3;
      box(rx, ry, lw, rh, yellowLt);
      cellText(label, rx, ry, lw, rh, { size: 7.5, bold: true, color: greenDark });
      const vs = [v1, v2, v3];
      for (let i = 0; i < 3; i++) {
        box(rx + lw + vw * i, ry, vw, rh);
        cellText(vs[i]!, rx + lw + vw * i, ry, vw, rh, { size: 7.5, align: "center" });
      }
      ry += rh;
    };
    // encabezado de columnas de SUBIDA
    const lw = rightW * 0.22, vw = (rightW - lw) / 3;
    box(rx, ry, lw, 13, grayLt);
    for (let i = 0; i < 3; i++) box(rx + lw + vw * i, ry, vw, 13, grayLt);
    cellText("Inicial", rx + lw, ry, vw, 13, { size: 6.8, bold: true, align: "center", color: muted });
    cellText("Final", rx + lw + vw, ry, vw, 13, { size: 6.8, bold: true, align: "center", color: muted });
    cellText("Diferencia", rx + lw + vw * 2, ry, vw, 13, { size: 6.8, bold: true, align: "center", color: muted });
    ry += 13;
    subRow("Km", report.kmStart != null ? report.kmStart.toLocaleString("es-AR") : "—", report.kmEnd != null ? report.kmEnd.toLocaleString("es-AR") : "—", kmDiff != null ? kmDiff.toLocaleString("es-AR") : "—");
    subRow("Fecha", fmtDateTime(report.dateStart), fmtDateTime(report.dateEnd), report.daysNav != null ? `${report.daysNav} días` : "—");
    // Consumo (destacado)
    const consumo = tanks.reduce((s, t) => s + netInitial(t), 0) - tanks.reduce((s, t) => s + netFinal(t), 0);
    const ch = 18;
    box(rx, ry, lw, ch, yellow);
    box(rx + lw, ry, rightW - lw, ch, yellowLt);
    cellText("Consumo", rx, ry, lw, ch, { size: 8, bold: true, color: black });
    cellText(`${fmtLts(consumo)} Lts`, rx + lw, ry, rightW - lw, ch, { size: 10, bold: true, align: "center", color: greenDark });
    ry += ch;
    // Recepción / Entrega
    const halfW = rightW / 2;
    box(rx, ry, halfW, 14, grayLt); box(rx + halfW, ry, halfW, 14, grayLt);
    cellText("Recepción (bunker)", rx, ry, halfW, 14, { size: 6.8, bold: true, align: "center", color: greenDark });
    cellText("Entrega (Bczas)", rx + halfW, ry, halfW, 14, { size: 6.8, bold: true, align: "center", color: greenDark });
    ry += 14;
    box(rx, ry, halfW, 15); box(rx + halfW, ry, halfW, 15);
    cellText(`${fmtLts(report.bunkerReceivedLts)} L`, rx, ry, halfW, 15, { size: 8, align: "center" });
    cellText(`${fmtLts(report.bargeDeliveredLts)} L`, rx + halfW, ry, halfW, 15, { size: 8, align: "center" });
    ry += 15;

    y = Math.max(ly, ry) + 22;

    // ── Firma ──
    if (y > PH - 70) { doc.addPage(); y = 40; }
    const sigW = 240;
    const sigX = ML + W - sigW - 10;
    doc.moveTo(sigX, y).lineTo(sigX + sigW, y).strokeColor(black).lineWidth(0.8).stroke();
    y += 5;
    cellText(val(report.signatory) === "—" ? "Jefe de Máquinas" : val(report.signatory), sigX, y, sigW, 12, { size: 9, bold: true, align: "center", color: black });
    y += 12;
    cellText("Jefe de Máquinas — Firma y Sello", sigX, y, sigW, 12, { size: 7, align: "center", color: muted });

    // ── Footer ──
    setFont(6.5, false);
    doc.fillColor(muted).text(
      `${val(report.reportCode)} · Copilot Management System · ${fmtDateTime(new Date())}`,
      ML, PH - 22, { width: W, align: "center" },
    );

    doc.end();
  });
}
