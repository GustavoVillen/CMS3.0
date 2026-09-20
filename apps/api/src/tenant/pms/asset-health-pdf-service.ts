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
import { resolveTenantForm } from "./tenant-forms-service";
import { renderMercurioAssetHealthPdf } from "./asset-health-pdf-mercurio";
import { drawHealthBody } from "./asset-health-pdf-visuals";

const CM = 28.35;
const PAGE_H = 841.89;
const PAGE_W = 595.28;
const MARGIN_V = Math.round(1.5 * CM);
const FOOTER_SIZE = 30;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

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

  // Documento controlado para los tenants con estilo Mercurio (mismo criterio
  // que el plan de mantenimiento y el diferimiento).
  const form = await resolveTenantForm(session.tenantSlug, "ASSET_HEALTH");
  if (form.meta.style === "MERCURIO") {
    const mercurioBuffer = await renderMercurioAssetHealthPdf({
      meta: form.meta,
      logoBuffer: form.logoBuffer ?? tenantLogoBuffer,
      tenantName: tenantName ?? session.tenantSlug,
      report: {
        healthState: r.healthState,
        createdAt: r.createdAt,
        createdByName: r.createdByName ?? null,
        periodFrom: r.periodFrom,
        periodTo: r.periodTo,
      },
      asset: {
        assetCode: r.asset.assetCode,
        name: r.asset.name ?? null,
        vesselCode: r.asset.vesselCode ?? "",
        vesselName: r.asset.vesselName ?? null,
      },
      metrics, text, sources,
      tz, locale,
    });
    return { buffer: mercurioBuffer, fileName };
  }

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

    // ── Cuerpo gráfico (compartido con el PDF de Mercurio) ──
    const flow = { get y() { return y; }, set y(v: number) { y = v; }, ensureSpace };
    const textBox = (label: string, body: string) => {
      ensureSpace(40);
      y = renderLabeledTextBox(doc, {
        label: label || " ", text: body || "—", x: ML, y, width: W,
        pageBottom: CONTENT_BOTTOM, pageTop: MARGIN_V, fontSize: 9, sectionGap: 10,
      });
    };
    drawHealthBody(doc, flow, {
      x: ML, w: W, locale, fmtDate: (d) => fmt(d),
      healthState: r.healthState, metrics, text, sources,
    }, textBox);

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
