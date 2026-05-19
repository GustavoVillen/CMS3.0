// Daily Report PDF — replicacion server-side del reporte que antes se
// imprimia con window.print(). Usa pdfkit, mismo patron que el resto de los
// PDFs del PMS (drills, MOC, maintenance plan, etc.).
//
// Layout: header navy con codigo de buque y fecha, identificacion, posicion
// como texto (sin mapa — el browser esta en mejores condiciones para
// renderizar el mapa interactivo; el PDF muestra solo lat/lon), tabla de
// horas de equipo, tabla de consumos, y secciones opcionales para
// mantenimiento, repuestos, defectos y diferimientos.

import PDFDocument from "pdfkit";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { log } from "../../common/logger";
import type { TenantAccessSession } from "../auth/session-store";
import { getDailyReportWithSubEntities } from "./daily-report-integration-service";

function sanitize(s: string | null | undefined): string {
  if (s === null || s === undefined) return "";
  const normalised = String(s)
    .replace(/\r\n/g, "\n")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
  let out = "";
  for (let i = 0; i < normalised.length; i++) {
    const c = normalised.charCodeAt(i);
    if (c === 9 || c === 10 || (c >= 0x20 && c <= 0xFF && c !== 0x7F)) {
      out += normalised[i];
    }
  }
  return out;
}

function val(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return sanitize(String(v));
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

function fmtCoord(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(5)}°`;
}

export async function buildDailyReportPdf(session: TenantAccessSession, reportId: string): Promise<Buffer> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantRow = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug }, include: { settings: { select: { displayName: true } } } });
  const tenantName = tenantRow?.settings?.displayName ?? session.tenantSlug;

  const report = await getDailyReportWithSubEntities(session, reportId);
  if (!report) throw new RouteError(404, "NOT_FOUND", "Reporte no encontrado.");

  try {
    return await renderPdf({ tenantName, report });
  } catch (err) {
    log.error("[buildDailyReportPdf] render failed:", err);
    throw new RouteError(500, "PDF_RENDER_FAILED", err instanceof Error ? err.message : "No se pudo generar el PDF.");
  }
}

function renderPdf(ctx: { tenantName: string; report: any }): Promise<Buffer> {
  const { tenantName, report } = ctx;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: { Title: sanitize(`Reporte Diario ${report.vesselCode} ${fmtDate(report.reportDate)}`) },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW = 595.28, PH = 841.89;
    const ML = 48, MR = 48;
    const W  = PW - ML - MR;
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
    doc.fillColor("#94a3b8").text(sanitize(tenantName.toUpperCase()), ML, 18, { width: W, characterSpacing: 1.5 });
    setFont(16, true);
    doc.fillColor("#ffffff").text("REPORTE DIARIO", ML, 32, { width: W });
    y = 80;

    // ── Identificacion ──
    doc.rect(ML, y, W, 22).fillColor(navy).fill();
    setFont(9, true);
    doc.fillColor("#ffffff")
      .text(sanitize(`${report.vesselCode}  -  ${fmtDate(report.reportDate)}`), ML + 10, y + 7, { width: W - 20 });
    y += 22;

    function rowPair(l1: string, v1: string, l2: string, v2: string) {
      const colW = W / 2;
      ensureSpace(22);
      doc.rect(ML, y, colW, 22).strokeColor(border).lineWidth(0.5).stroke();
      doc.rect(ML + colW, y, colW, 22).strokeColor(border).lineWidth(0.5).stroke();
      setFont(7, true);
      doc.fillColor(gray).text(sanitize(l1.toUpperCase()), ML + 8, y + 4, { width: colW - 16, characterSpacing: 0.8 });
      setFont(9.5, false);
      doc.fillColor(black).text(val(v1), ML + 8, y + 14, { width: colW - 16 });
      setFont(7, true);
      doc.fillColor(gray).text(sanitize(l2.toUpperCase()), ML + colW + 8, y + 4, { width: colW - 16, characterSpacing: 0.8 });
      setFont(9.5, false);
      doc.fillColor(black).text(val(v2), ML + colW + 8, y + 14, { width: colW - 16 });
      y += 22;
    }

    rowPair("Estado", report.status, "Tipo de escala", report.scheduleType ?? "—");
    rowPair("Puerto actual", report.currentPort ?? "—", "Proximo puerto", report.nextPort ?? "—");
    rowPair("ETA proximo", fmtDate(report.nextPortEta), "Operacion", report.operationalStatus ?? "—");
    rowPair("Oport. mantenimiento", report.maintenanceOpportunity ?? "—", "Recepcion repuestos", report.spareReception ?? "—");

    // ── Posicion geografica ──
    y += 8;
    ensureSpace(40);
    doc.rect(ML, y, W, 32).fillColor(bgBox).fill();
    setFont(7, true);
    doc.fillColor(navy).text("POSICION GEOGRAFICA", ML + 8, y + 6, { characterSpacing: 0.8 });
    setFont(10, false);
    doc.fillColor(black)
      .text(`Latitud: ${fmtCoord(report.positionLat)}    Longitud: ${fmtCoord(report.positionLon)}`,
            ML + 8, y + 18, { width: W - 16 });
    y += 36;

    // ── Resumen del dia ──
    if (report.summary && String(report.summary).trim()) {
      const text = sanitize(report.summary);
      setFont(9.5, false);
      const bodyH = Math.max(28, doc.heightOfString(text, { width: W - 16, lineGap: 3 }) + 24);
      ensureSpace(bodyH);
      doc.rect(ML, y, W, bodyH).fillColor(bgBox).fill();
      setFont(7, true);
      doc.fillColor(navy).text("RESUMEN DEL DIA", ML + 8, y + 6, { characterSpacing: 0.8 });
      setFont(9.5, false);
      doc.fillColor(black).text(text, ML + 8, y + 18, { width: W - 16, lineGap: 3 });
      y += bodyH + 6;
    }

    // ── Tabla de horas de equipo ──
    const equipmentHours = (report.equipmentHours ?? []) as Array<{ equipmentLabel: string; runningHoursTotal?: number | null; fuelConsumptionLiters?: number | null; oilConsumptionLiters?: number | null; inService?: boolean }>;
    if (equipmentHours.length > 0) {
      ensureSpace(22 + equipmentHours.length * 18);
      setFont(10, true);
      doc.fillColor(navy).text("Horas de equipo", ML, y);
      y += 14;
      const colWidths = [W * 0.42, W * 0.18, W * 0.13, W * 0.13, W * 0.14];
      const headers = ["Equipo", "Hs. acumuladas", "Comb. (L)", "Aceite (L)", "En servicio"];
      doc.rect(ML, y, W, 16).fillColor("#e2e8f0").fill();
      setFont(7, true);
      let x = ML + 6;
      doc.fillColor(navy);
      for (let i = 0; i < headers.length; i++) {
        doc.text(sanitize(headers[i]!.toUpperCase()), x, y + 4, { width: colWidths[i]! - 8, characterSpacing: 0.5 });
        x += colWidths[i]!;
      }
      y += 16;
      setFont(9, false);
      for (const e of equipmentHours) {
        ensureSpace(16);
        doc.rect(ML, y, W, 16).strokeColor(border).lineWidth(0.3).stroke();
        x = ML + 6;
        const vals = [
          val(e.equipmentLabel),
          val(e.runningHoursTotal),
          val(e.fuelConsumptionLiters),
          val(e.oilConsumptionLiters),
          e.inService ? "Si" : "No",
        ];
        doc.fillColor(black);
        for (let i = 0; i < vals.length; i++) {
          doc.text(vals[i]!, x, y + 4, { width: colWidths[i]! - 8, ellipsis: true });
          x += colWidths[i]!;
        }
        y += 16;
      }
      y += 6;
    }

    // ── Consumos del dia (totales) ──
    if (report.fuelConsumedLiters != null || report.oilConsumedLiters != null) {
      ensureSpace(40);
      doc.rect(ML, y, W, 32).fillColor(bgBox).fill();
      setFont(7, true);
      doc.fillColor(navy).text("CONSUMOS DEL DIA (TOTAL)", ML + 8, y + 6, { characterSpacing: 0.8 });
      setFont(10, false);
      const fuelStr = report.fuelConsumedLiters != null ? `${report.fuelConsumedLiters} L combustible` : "Combustible: —";
      const oilStr  = report.oilConsumedLiters != null ? `${report.oilConsumedLiters} L aceite` : "Aceite: —";
      doc.fillColor(black).text(`${fuelStr}    ${oilStr}`, ML + 8, y + 18, { width: W - 16 });
      y += 36;
    }

    // ── Mantenimiento ejecutado ──
    const maintenance = (report.maintenanceEntries ?? []) as Array<{ title?: string; description?: string; equipmentLabel?: string }>;
    if (maintenance.length > 0) {
      ensureSpace(22);
      setFont(10, true);
      doc.fillColor(navy).text("Mantenimiento ejecutado", ML, y);
      y += 14;
      setFont(9, false);
      doc.fillColor(black);
      for (const m of maintenance) {
        const line = `• ${val(m.equipmentLabel || m.title)}: ${val(m.description || m.title)}`;
        const h = doc.heightOfString(line, { width: W - 16 });
        ensureSpace(h + 4);
        doc.text(line, ML + 8, y, { width: W - 16 });
        y += h + 4;
      }
      y += 4;
    }

    // ── Repuestos utilizados ──
    const spareUsages = (report.spareUsages ?? []) as Array<{ spareSku?: string; spareName?: string; quantity?: number; unit?: string }>;
    if (spareUsages.length > 0) {
      ensureSpace(22);
      setFont(10, true);
      doc.fillColor(navy).text("Repuestos utilizados", ML, y);
      y += 14;
      setFont(9, false);
      doc.fillColor(black);
      for (const s of spareUsages) {
        const line = `• ${val(s.spareSku)} - ${val(s.spareName)}: ${val(s.quantity)} ${val(s.unit)}`;
        const h = doc.heightOfString(line, { width: W - 16 });
        ensureSpace(h + 4);
        doc.text(line, ML + 8, y, { width: W - 16 });
        y += h + 4;
      }
      y += 4;
    }

    // ── Defectos reportados ──
    const defects = (report.defectEntries ?? []) as Array<{ defectCode?: string; description?: string; severity?: string }>;
    if (defects.length > 0) {
      ensureSpace(22);
      setFont(10, true);
      doc.fillColor(navy).text("Defectos reportados", ML, y);
      y += 14;
      setFont(9, false);
      doc.fillColor(black);
      for (const d of defects) {
        const line = `• [${val(d.severity)}] ${val(d.defectCode)}: ${val(d.description)}`;
        const h = doc.heightOfString(line, { width: W - 16 });
        ensureSpace(h + 4);
        doc.text(line, ML + 8, y, { width: W - 16 });
        y += h + 4;
      }
      y += 4;
    }

    // ── Diferimientos activos ──
    const deferrals = (report.deferralEntries ?? []) as Array<{ deferralCode?: string; description?: string; targetDate?: string }>;
    if (deferrals.length > 0) {
      ensureSpace(22);
      setFont(10, true);
      doc.fillColor(navy).text("Diferimientos activos", ML, y);
      y += 14;
      setFont(9, false);
      doc.fillColor(black);
      for (const d of deferrals) {
        const line = `• ${val(d.deferralCode)}: ${val(d.description)} (cierre: ${fmtDate(d.targetDate)})`;
        const h = doc.heightOfString(line, { width: W - 16 });
        ensureSpace(h + 4);
        doc.text(line, ML + 8, y, { width: W - 16 });
        y += h + 4;
      }
      y += 4;
    }

    // ── Comentarios operativos ──
    if (report.operationalNotes && String(report.operationalNotes).trim()) {
      const text = sanitize(report.operationalNotes);
      setFont(9.5, false);
      const bodyH = Math.max(28, doc.heightOfString(text, { width: W - 16, lineGap: 3 }) + 24);
      ensureSpace(bodyH);
      doc.rect(ML, y, W, bodyH).fillColor(bgBox).fill();
      setFont(7, true);
      doc.fillColor(navy).text("COMENTARIOS OPERATIVOS", ML + 8, y + 6, { characterSpacing: 0.8 });
      setFont(9.5, false);
      doc.fillColor(black).text(text, ML + 8, y + 18, { width: W - 16, lineGap: 3 });
      y += bodyH + 6;
    }

    // ── Footer ──
    const footY = PH - 30;
    setFont(7, false);
    doc.fillColor(gray).text(
      `Copilot Management System - Reporte generado automaticamente - ${fmtDateTime(new Date())}`,
      ML, footY, { width: W, align: "center" },
    );

    doc.end();
  });
}
