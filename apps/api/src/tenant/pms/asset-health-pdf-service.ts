// PDF de un informe de salud del equipo ya GUARDADO (asset-health-service.ts).
//
// No regenera nada: imprime la fila tal como quedó, así el papel y la pantalla
// dicen lo mismo y un PDF bajado hoy de un informe de junio es el de junio.
// Los números salen de `metrics` (calculados por el sistema) y el texto de
// `report` (IA). Las secciones de texto usan renderLabeledTextBox (skill
// pms-pdf-generation): pueden pasar de página.
import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getAssetHealthReport, type HealthMetrics, type HealthReportText, type HealthSources } from "../assets/asset-health-service";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText, renderLabeledTextBox } from "./pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";

const CM = 28.35;
const PAGE_H = 841.89;
const PAGE_W = 595.28;
const MARGIN_V = Math.round(1.5 * CM);
const FOOTER_SIZE = 30;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

const STATE_TEXT: Record<string, { label: string; color: string; bg: string }> = {
  GOOD:      { label: "Bueno",    color: "#047857", bg: "#ecfdf5" },
  ATTENTION: { label: "Atención", color: "#92400e", bg: "#fffbeb" },
  RISK:      { label: "Riesgo",   color: "#b91c1c", bg: "#fef2f2" },
};

export async function buildAssetHealthReportPdf(
  session: TenantAccessSession,
  assetId: string,
  reportId: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmt = (d: Date | string | null | undefined) => (d ? fmtDateTz(d, tz, locale) : "—");

  const r = await getAssetHealthReport(session, assetId, reportId) as any;
  const metrics = r.metrics as HealthMetrics;
  const text = r.report as HealthReportText;
  const sources = r.sources as HealthSources;
  const state = STATE_TEXT[r.healthState] ?? STATE_TEXT.ATTENTION!;
  const assetTitle = r.asset.name ?? r.asset.assetCode;

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
      tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, tenantRow?.settings?.logoUrl ?? null, tenantRow?.settings?.logoUrlLight ?? null);
    } catch { /* non-blocking */ }
  }

  const dateStr = new Date(r.createdAt).toISOString().slice(0, 10);
  // Los códigos traen "#" ("LTE-MP-#4"): fuera del nombre de archivo.
  const fileName = `informe-salud-${String(r.asset.assetCode).replace(/[^A-Za-z0-9._-]+/g, "")}-${dateStr}.pdf`;

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: `Informe de salud — ${assetTitle}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML = 48, W = PAGE_W - ML * 2;
    const black = "#0f172a", gray = "#64748b", border = "#e2e8f0";
    let y = MARGIN_V;
    doc.on("pageAdded", () => { y = MARGIN_V; });
    const ensureSpace = (needed: number) => { if (y + needed > CONTENT_BOTTOM) doc.addPage(); };

    // ── Encabezado ──
    const HEADER_H = 64, LOGO_W = 90;
    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, ML + W - LOGO_W, y, { fit: [LOGO_W, HEADER_H], align: "right", valign: "center" }); }
      catch { /* logo unavailable */ }
    }
    const titleW = W - LOGO_W - 16;
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#6d28d9").text("INFORME DE SALUD DEL EQUIPO", ML, y, { width: titleW, characterSpacing: 0.6 });
    doc.fontSize(17).font("Helvetica-Bold").fillColor(black).text(sanitizePdfText(assetTitle), ML, y + 12, { width: titleW });
    doc.fontSize(10).font("Helvetica").fillColor(gray)
      .text(sanitizePdfText([r.asset.assetCode, r.asset.vesselName].filter(Boolean).join("  ·  ")), ML, y + 34, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(sanitizePdfText(`Generado ${fmtDateTimeTz(r.createdAt, tz, locale)} por ${r.createdByName ?? "—"} · Período ${fmt(r.periodFrom)} a ${fmt(r.periodTo)}`), ML, y + 50, { width: titleW });
    y += HEADER_H + 10;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 12;

    // ── Estado (una línea: badge) ──
    doc.roundedRect(ML, y, W, 26, 5).fillColor(state.bg).fill();
    doc.fontSize(11).font("Helvetica-Bold").fillColor(state.color)
      .text(`Estado: ${state.label}`, ML + 10, y + 8, { width: W / 2 });
    doc.fontSize(7.5).font("Helvetica").fillColor(gray)
      .text("Lectura de la IA", ML + W / 2, y + 10, { width: W / 2 - 10, align: "right" });
    y += 34;

    // ── Números (una línea cada uno) ──
    const hours = metrics.currentHours != null
      ? `${Math.round(metrics.currentHours).toLocaleString(locale)} h`
      : "—";
    const kpis: Array<[string, string]> = [
      [`${metrics.plansOverdue} de ${metrics.plansActive}`, "Tareas del plan vencidas"],
      [String(metrics.defectsOpen), "Defectos abiertos"],
      [`${metrics.labBad} / ${metrics.labCaution}`, "Análisis en rojo / precaución"],
      [hours, metrics.currentHoursDate ? `Horas de marcha al ${fmt(metrics.currentHoursDate)}` : "Horas de marcha"],
    ];
    const KW = (W - 18) / 4;
    kpis.forEach(([value, label], i) => {
      const x = ML + i * (KW + 6);
      doc.roundedRect(x, y, KW, 38, 4).strokeColor(border).lineWidth(0.8).stroke();
      doc.fontSize(12).font("Helvetica-Bold").fillColor(black).text(sanitizePdfText(value), x + 7, y + 6, { width: KW - 14, lineBreak: false, ellipsis: true });
      doc.fontSize(7).font("Helvetica").fillColor(gray).text(sanitizePdfText(label), x + 7, y + 24, { width: KW - 14, lineBreak: false, ellipsis: true });
    });
    y += 44;
    doc.fontSize(7).font("Helvetica-Oblique").fillColor(gray)
      .text("Los números los calcula el sistema; la IA redacta la lectura y las sugerencias.", ML, y, { width: W });
    y += 16;

    // ── Texto ──
    const box = (label: string, body: string) => {
      ensureSpace(40);
      y = renderLabeledTextBox(doc, {
        label, text: body || "—", x: ML, y, width: W,
        pageBottom: CONTENT_BOTTOM, pageTop: MARGIN_V, fontSize: 9, sectionGap: 10,
      });
    };
    box("Resumen", text.summary);
    box("Mantenimiento planificado", text.maintenance);
    box("Análisis de laboratorio", text.lab);
    box("Defectos y fallas repetidas", text.defects);
    box("Qué conviene revisar (sugerencias de la IA)", text.recommendations.map((t, i) => `${i + 1}. ${t}`).join("\n"));
    if (text.limitations) box("Limitaciones de la lectura", text.limitations);

    const sourceLine = [
      `${sources.plans} planes`, `${sources.workOrders} órdenes de trabajo`, `${sources.workLogs} ejecuciones sin OT`,
      `${sources.labAnalyses} análisis de laboratorio`, `${sources.defects} defectos`, `${sources.deferrals} postergaciones`,
      `${sources.inspections} inspecciones`, `${sources.mocs} MOC`, `${sources.hoursReadings} lecturas de horas`, `${sources.alerts} alertas automáticas`,
    ].join(" · ");
    box("Qué se tuvo en cuenta", `${sourceLine}\nLa IA sugiere; el diagnóstico y las decisiones técnicas son del Superintendente.`);

    // ── Pie ──
    const range = doc.bufferedPageRange();
    const footerY = PAGE_H - FOOTER_SIZE;
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
      if (existsSync(LOGO_PATH)) {
        try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* logo missing */ }
      }
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text("Copilot Management System — Informe de salud del equipo", ML + 18, footerY, { width: W / 2 + 40, lineBreak: false });
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text(`${tenantName ?? session.tenantSlug} · Página ${i - range.start + 1} de ${range.count}`, ML, footerY, { width: W, align: "right", lineBreak: false });
    }
    doc.end();
  });

  return { buffer, fileName };
}
