// Voyage Tank Report PDF (Formulario M2 — Medición de Tanques por Viaje).
// Reproduce el formulario en papel: encabezado, tabla de carboneras Inicial/Final
// con NATURALES, horómetros por motor, bloque de viaje (SUBIDA), bunker y firma.
// Mismo patrón pdfkit que daily-reports-pdf-service.ts. Sigue pms-pdf-generation.

import PDFDocument from "pdfkit";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { log } from "../../common/logger";
import type { TenantAccessSession } from "../auth/session-store";
import { getVoyageTankReportFull } from "./voyage-tank-reports-integration-service";
import { resolveTenantLogo, sanitizePdfText, renderLabeledTextBox } from "../pms/pdf-helpers";

function val(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return sanitizePdfText(String(v));
}

// Formato de litros con separador de miles estilo es-AR (1.234) para calzar con el papel.
function fmtLts(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Math.round(v).toLocaleString("es-AR");
}

function fmtHrs(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("es-AR");
}

function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Helpers de cálculo (duplicados en el frontend; fórmula trivial) ──
const netInitial = (t: any) => (t.volumeTotalLtsInitial ?? 0) - (t.volumeWaterLtsInitial ?? 0);
const netFinal   = (t: any) => (t.volumeTotalLtsFinal ?? 0) - (t.volumeWaterLtsFinal ?? 0);

export async function buildVoyageTankReportPdf(session: TenantAccessSession, reportId: string): Promise<Buffer> {
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
    return await renderPdf({ tenantName, vesselName, logoBuffer, report });
  } catch (err) {
    log.error("[buildVoyageTankReportPdf] render failed:", err);
    throw new RouteError(500, "PDF_RENDER_FAILED", err instanceof Error ? err.message : "No se pudo generar el PDF.");
  }
}

function renderPdf(ctx: { tenantName: string; vesselName: string; logoBuffer: Buffer | null; report: any }): Promise<Buffer> {
  const { tenantName, vesselName, logoBuffer, report } = ctx;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: { Title: sanitizePdfText(`Medicion de Tanques ${vesselName} ${report.voyageCode ?? ""}`) },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW = 595.28, PH = 841.89;
    const ML = 48, MR = 48;
    const W = PW - ML - MR;
    const navy = "#0f2744", black = "#0f172a", gray = "#64748b", border = "#cbd5e1", bgBox = "#f8fafc";
    const MARGIN_V = 42;
    let y = MARGIN_V;

    doc.on("pageAdded", () => { y = MARGIN_V; });

    function setFont(size: number, bold = false) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    }
    function ensureSpace(needed: number) {
      if (y + needed > PH - 80) { doc.addPage(); y = MARGIN_V; }
    }

    // ── Header ──
    doc.rect(0, 0, PW, 60).fillColor(navy).fill();
    setFont(8, true);
    doc.fillColor("#94a3b8").text(sanitizePdfText(tenantName.toUpperCase()), ML, 18, { width: W, characterSpacing: 1.5 });
    setFont(15, true);
    doc.fillColor("#ffffff").text("MEDICION DE TANQUES DE ALMACENAMIENTO Y CONSUMO", ML, 32, { width: W - 130 });
    if (logoBuffer) {
      const lw = 120, lh = 42, lx = PW - MR - lw, ly = 9;
      doc.roundedRect(lx, ly, lw, lh, 4).fillColor("#ffffff").fill();
      try { doc.image(logoBuffer, lx + 6, ly + 5, { fit: [lw - 12, lh - 10], align: "center", valign: "center" }); } catch { /* skip */ }
    }
    y = 80;

    // ── Identificacion ──
    doc.rect(ML, y, W, 22).fillColor(navy).fill();
    setFont(9, true);
    doc.fillColor("#ffffff").text(
      sanitizePdfText(`${vesselName}  -  Viaje ${report.voyageCode ?? "—"}  -  Formulario M2`),
      ML + 10, y + 7, { width: W - 20 },
    );
    y += 22;

    function rowPair(l1: string, v1: string, l2: string, v2: string) {
      const colW = W / 2;
      ensureSpace(24);
      doc.rect(ML, y, colW, 24).strokeColor(border).lineWidth(0.5).stroke();
      doc.rect(ML + colW, y, colW, 24).strokeColor(border).lineWidth(0.5).stroke();
      setFont(7, true);
      doc.fillColor(gray).text(sanitizePdfText(l1.toUpperCase()), ML + 8, y + 4, { width: colW - 16, characterSpacing: 0.8 });
      setFont(9.5, false);
      doc.fillColor(black).text(v1, ML + 8, y + 14, { width: colW - 16, ellipsis: true });
      setFont(7, true);
      doc.fillColor(gray).text(sanitizePdfText(l2.toUpperCase()), ML + colW + 8, y + 4, { width: colW - 16, characterSpacing: 0.8 });
      setFont(9.5, false);
      doc.fillColor(black).text(v2, ML + colW + 8, y + 14, { width: colW - 16, ellipsis: true });
      y += 24;
    }

    rowPair("Fecha", fmtDateTime(report.reportDateTime), "Estado", val(report.status));
    rowPair("Tramo", val(report.tramo), "Barcaza / Buque", val(vesselName));
    y += 6;

    // ── Tabla CARBONERAS (Inicial / Final) ──
    const tanks = (report.tankReadings ?? []) as any[];
    setFont(11, true);
    ensureSpace(20);
    doc.fillColor(navy).text("Medición de Carboneras", ML, y);
    y += 16;

    // Columnas: Tanque | Ini Total | Ini Agua | Ini Neto | Fin Total | Fin Agua | Fin Neto
    const cw = [W * 0.28, W * 0.12, W * 0.12, W * 0.12, W * 0.12, W * 0.12, W * 0.12];
    const drawTableHeader = () => {
      // Fila de grupo (INICIAL / FINAL)
      doc.rect(ML, y, cw[0]!, 14).fillColor("#e2e8f0").fill();
      const iniW = cw[1]! + cw[2]! + cw[3]!;
      const finW = cw[4]! + cw[5]! + cw[6]!;
      doc.rect(ML + cw[0]!, y, iniW, 14).fillColor("#dbeafe").fill();
      doc.rect(ML + cw[0]! + iniW, y, finW, 14).fillColor("#fee2e2").fill();
      setFont(7, true);
      doc.fillColor(navy).text("INICIAL", ML + cw[0]! + 4, y + 4, { width: iniW - 8, align: "center" });
      doc.fillColor(navy).text("FINAL", ML + cw[0]! + iniW + 4, y + 4, { width: finW - 8, align: "center" });
      y += 14;
      // Fila de columnas
      doc.rect(ML, y, W, 14).fillColor("#f1f5f9").fill();
      const headers = ["Tanque", "Total (L)", "Agua (L)", "Neto (L)", "Total (L)", "Agua (L)", "Neto (L)"];
      setFont(6.5, true);
      let x = ML;
      doc.fillColor(navy);
      for (let i = 0; i < headers.length; i++) {
        doc.text(sanitizePdfText(headers[i]!.toUpperCase()), x + 4, y + 4, { width: cw[i]! - 8, align: i === 0 ? "left" : "right" });
        x += cw[i]!;
      }
      y += 14;
    };
    ensureSpace(28 + 16);
    drawTableHeader();

    let sumIni = 0, sumFin = 0;
    setFont(8, false);
    for (const t of tanks) {
      ensureSpace(15);
      if (y === MARGIN_V) drawTableHeader();
      const ni = netInitial(t), nf = netFinal(t);
      sumIni += ni; sumFin += nf;
      doc.rect(ML, y, W, 15).strokeColor(border).lineWidth(0.3).stroke();
      const cells = [
        val(t.tankLabel),
        fmtLts(t.volumeTotalLtsInitial),
        fmtLts(t.volumeWaterLtsInitial),
        fmtLts(ni),
        fmtLts(t.volumeTotalLtsFinal),
        fmtLts(t.volumeWaterLtsFinal),
        fmtLts(nf),
      ];
      let x = ML;
      doc.fillColor(black);
      for (let i = 0; i < cells.length; i++) {
        doc.text(cells[i]!, x + 4, y + 4, { width: cw[i]! - 8, align: i === 0 ? "left" : "right", ellipsis: true });
        x += cw[i]!;
      }
      y += 15;
    }
    // Fila NATURALES (suma de netos)
    ensureSpace(16);
    doc.rect(ML, y, W, 16).fillColor("#f1f5f9").fill();
    setFont(8, true);
    doc.fillColor(navy).text("NATURALES", ML + 4, y + 5, { width: cw[0]! - 8 });
    doc.text(fmtLts(sumIni), ML + cw[0]! + cw[1]! + cw[2]!, y + 5, { width: cw[3]! - 4, align: "right" });
    doc.text(fmtLts(sumFin), ML + cw[0]! + cw[1]! + cw[2]! + cw[3]! + cw[4]! + cw[5]!, y + 5, { width: cw[6]! - 4, align: "right" });
    y += 16;

    // ── Consumo del viaje (destacado) ──
    const consumo = sumIni - sumFin;
    ensureSpace(30);
    doc.rect(ML, y, W, 26).fillColor(navy).fill();
    setFont(8, true);
    doc.fillColor("#94a3b8").text("CONSUMO DEL VIAJE (NATURALES INICIAL − FINAL)", ML + 10, y + 5, { characterSpacing: 0.8 });
    setFont(13, true);
    doc.fillColor("#ffffff").text(`${fmtLts(consumo)} Lts`, ML + 10, y + 13, { width: W - 20 });
    y += 32;

    // ── HORÓMETROS ──
    const engines = (report.engineHours ?? []) as any[];
    if (engines.length > 0) {
      ensureSpace(20 + 16 + engines.length * 15);
      setFont(11, true);
      doc.fillColor(navy).text("Horómetros", ML, y);
      y += 16;
      const ecw = [W * 0.46, W * 0.18, W * 0.18, W * 0.18];
      doc.rect(ML, y, W, 14).fillColor("#f1f5f9").fill();
      setFont(7, true);
      const eh = ["Motor", "Inicial (hs)", "Final (hs)", "Diferencia (hs)"];
      let x = ML;
      doc.fillColor(navy);
      for (let i = 0; i < eh.length; i++) {
        doc.text(sanitizePdfText(eh[i]!.toUpperCase()), x + 4, y + 4, { width: ecw[i]! - 8, align: i === 0 ? "left" : "right" });
        x += ecw[i]!;
      }
      y += 14;
      setFont(8.5, false);
      for (const e of engines) {
        ensureSpace(15);
        const diff = (e.hoursFinal ?? 0) - (e.hoursInitial ?? 0);
        const hasBoth = e.hoursFinal != null && e.hoursInitial != null;
        doc.rect(ML, y, W, 15).strokeColor(border).lineWidth(0.3).stroke();
        const cells = [val(e.engineLabel), fmtHrs(e.hoursInitial), fmtHrs(e.hoursFinal), hasBoth ? fmtHrs(diff) : "—"];
        x = ML;
        doc.fillColor(black);
        for (let i = 0; i < cells.length; i++) {
          doc.text(cells[i]!, x + 4, y + 4, { width: ecw[i]! - 8, align: i === 0 ? "left" : "right", ellipsis: true });
          x += ecw[i]!;
        }
        y += 15;
      }
      y += 6;
    }

    // ── SUBIDA (viaje) + Bunker ──
    ensureSpace(20);
    setFont(11, true);
    doc.fillColor(navy).text("Viaje", ML, y);
    y += 16;
    const kmTxt = (report.kmStart != null || report.kmEnd != null)
      ? `${report.kmStart != null ? report.kmStart.toLocaleString("es-AR") : "—"} → ${report.kmEnd != null ? report.kmEnd.toLocaleString("es-AR") : "—"}`
      : "—";
    rowPair("Km inicio → fin", kmTxt, "Días de navegación", val(report.daysNav));
    rowPair("Fecha inicio", fmtDateTime(report.dateStart), "Fecha fin", fmtDateTime(report.dateEnd));
    rowPair("Recepción bunker (L)", fmtLts(report.bunkerReceivedLts), "Entrega a barcazas (L)", fmtLts(report.bargeDeliveredLts));
    y += 8;

    // ── Observaciones (texto libre, multi-página seguro) ──
    if (report.notes && String(report.notes).trim()) {
      y = renderLabeledTextBox(doc, {
        label: "Observaciones",
        text: sanitizePdfText(report.notes),
        x: ML, y, width: W,
        pageBottom: PH - 80, pageTop: MARGIN_V,
        labelPosition: "above", fontSize: 9, bg: bgBox, border,
      });
    }

    // ── Bloque de firma ──
    ensureSpace(70);
    y += 20;
    const sigW = 220;
    const sigX = ML + (W - sigW) / 2;
    doc.moveTo(sigX, y).lineTo(sigX + sigW, y).strokeColor(black).lineWidth(0.8).stroke();
    y += 6;
    setFont(9, true);
    doc.fillColor(black).text(val(report.signatory) === "—" ? "Jefe de Máquinas" : val(report.signatory), sigX, y, { width: sigW, align: "center" });
    y += 12;
    setFont(7, false);
    doc.fillColor(gray).text("Jefe de Máquinas — Firma y Sello", sigX, y, { width: sigW, align: "center" });

    // ── Footer ──
    const footY = PH - 30;
    setFont(7, false);
    doc.fillColor(gray).text(
      `Copilot Management System - ${val(report.reportCode)} - Generado ${fmtDateTime(new Date())}`,
      ML, footY, { width: W, align: "center" },
    );

    doc.end();
  });
}
