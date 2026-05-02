import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getFluidSample } from "./fluid-analyses-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo } from "../pms/pdf-helpers";

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-AR");
}

function val(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const VERDICT_COLOR: Record<string, string> = {
  NORMAL: "#16a34a",
  CAUTION: "#b45309",
  ACTION_REQUIRED: "#b91c1c",
  CRITICAL: "#7f1d1d",
};

export async function buildFluidAnalysisPdf(session: TenantAccessSession, sampleId: string): Promise<Buffer> {
  const sample = await getFluidSample(session, sampleId);

  // Resolve asset name
  const prisma = getPrismaClient();
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

  // Tenant logo
  let tenantName: string | null = null;
  let tenantLogoBuffer: Buffer | null = null;
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

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: { Title: `${sample.sampleCode}-${sample.vesselCode}` },
    });

    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header ─────────────────────────────────────────────────────────────
    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, 50, 40, { fit: [60, 60] }); } catch { /* ignore */ }
    }
    doc.fontSize(16).fillColor("#0f172a").text("Análisis de Fluido", 120, 50);
    doc.fontSize(10).fillColor("#64748b").text(tenantName ?? session.tenantSlug, 120, 70);
    doc.moveDown(2);

    // ── Identification ─────────────────────────────────────────────────────
    doc.fillColor("#0f172a").fontSize(12).text(`${sample.sampleCode} · ${sample.fluidType}`, { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(10).fillColor("#475569");
    const identLines = [
      `Buque: ${sample.vesselCode}`,
      `Equipo: ${assetCode ? assetCode + " — " : ""}${assetName ?? sample.assetId}`,
      `Fluido: ${sample.fluidType}${sample.fluidProduct ? " · " + sample.fluidProduct : ""}`,
      `Toma: ${fmt(sample.sampledAt)}${sample.runningHours != null ? "  ·  Horas: " + sample.runningHours : ""}`,
      `Estado: ${sample.status}`,
    ];
    for (const l of identLines) doc.text(l);

    if (sample.result) {
      const verdictColor = VERDICT_COLOR[sample.result.verdict] ?? "#475569";
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor(verdictColor).text(`Veredicto: ${sample.result.verdict}`);
      doc.fontSize(10).fillColor("#475569").text(`Recibido: ${fmt(sample.result.receivedAt)}`);
      if (sample.result.summary) {
        doc.moveDown(0.3);
        doc.fillColor("#0f172a").text(`Resumen: ${sample.result.summary}`);
      }
    }

    // ── Parameters ─────────────────────────────────────────────────────────
    if (sample.result?.parameters && typeof sample.result.parameters === "object") {
      doc.moveDown(1);
      doc.fontSize(12).fillColor("#0f172a").text("Parámetros", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10);
      const params = sample.result.parameters as Record<string, any>;
      for (const [k, raw] of Object.entries(params)) {
        const v = (raw && typeof raw === "object" && "value" in raw) ? raw.value : raw;
        const unit = (raw && typeof raw === "object" && "unit" in raw) ? raw.unit : "";
        doc.fillColor("#475569").text(`${k}:`, { continued: true })
           .fillColor("#0f172a").text(`  ${val(v)}${unit ? " " + unit : ""}`);
      }
    }

    // ── AI analysis ────────────────────────────────────────────────────────
    if (sample.result?.aiAnalysis) {
      doc.moveDown(1);
      doc.fontSize(12).fillColor("#0f172a").text("Análisis IA", { underline: true });
      doc.moveDown(0.3);
      if (sample.result.aiAnalysisGeneratedAt) {
        doc.fontSize(8).fillColor("#94a3b8").text(`Generado: ${fmt(sample.result.aiAnalysisGeneratedAt)}`);
      }
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("#0f172a");
      doc.text(stripMarkdown(sample.result.aiAnalysis), { align: "left" });
    }

    // ── Footer con sello CMS ────────────────────────────────────────────────
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;
    const ML = 50;
    const W = PAGE_W - 2 * ML;
    const FOOTER_SIZE = 40;
    const footerY = PAGE_H - FOOTER_SIZE;

    doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor("#cbd5e1").lineWidth(1).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* ignore */ }
    }
    doc.fontSize(8).font("Helvetica").fillColor("#94a3b8")
      .text("Copilot Management System — Documento generado automáticamente. No requiere firma digital.",
        ML + 18, footerY, { width: W / 2 - 18 });
    doc.fontSize(8).font("Helvetica").fillColor("#94a3b8")
      .text(`${sample.sampleCode} · ${sample.vesselCode} · ${fmt(new Date())}`,
        ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
