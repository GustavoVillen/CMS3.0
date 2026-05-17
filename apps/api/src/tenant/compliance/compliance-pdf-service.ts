// Compliance scores → PDF.
// Renderiza una tabla con score por buque y el desglose de los 6 componentes.
// Útil como reporte ejecutivo para auditoría externa.

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getComplianceScores } from "./compliance-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo } from "../pms/pdf-helpers";

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-AR");
}

const LABEL_TEXT: Record<string, string> = {
  EXCELLENT: "Excelente",
  GOOD:      "Bueno",
  FAIR:      "Regular",
  POOR:      "Pobre",
};

const LABEL_COLOR: Record<string, string> = {
  EXCELLENT: "#16a34a",
  GOOD:      "#b45309",
  FAIR:      "#ca8a04",
  POOR:      "#b91c1c",
};

function componentColor(value: number): string {
  if (value >= 0.85) return "#16a34a";
  if (value >= 0.6)  return "#b45309";
  return "#b91c1c";
}

const PAGE_H      = 841.89;
const CM          = 72 / 2.54;
const MARGIN_V    = Math.round(1.5 * CM);
const FOOTER_SIZE = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

export async function buildCompliancePdf(
  session: TenantAccessSession,
  vesselCode: string | null,
): Promise<Buffer> {
  const { items: scores } = await getComplianceScores(session, vesselCode);

  // Tenant logo + display name
  let tenantName: string | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const tenantRow = await (prisma as unknown as { tenant: { findUnique(a: unknown): Promise<{ settings?: { displayName?: string; logoUrl?: string | null; logoUrlLight?: string | null } | null } | null> } }).tenant.findUnique({
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
      info: { Title: `Compliance Score ${tenantName ?? session.tenantSlug}` },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML     = 48;
    const MR     = 48;
    const PW     = 595.28;
    const W      = PW - ML - MR;
    const black  = "#0f172a";
    const gray   = "#64748b";
    const border = "#e2e8f0";
    const bgBox  = "#f8fafc";

    let y = ML;

    doc.on("pageAdded", () => {
      (doc as unknown as { y: number }).y = MARGIN_V;
      y = MARGIN_V;
    });

    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) {
        doc.addPage();
        y = MARGIN_V;
      }
    }

    // ── Header ────────────────────────────────────────────────────────────────
    const HEADER_H = 64;
    const TENANT_LOGO_MAX_W = 90;

    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + W - TENANT_LOGO_MAX_W, y,
          { fit: [TENANT_LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
      } catch { /* logo unavailable */ }
    }

    const titleW = W - TENANT_LOGO_MAX_W - 16;
    doc.fontSize(22).font("Helvetica-Bold").fillColor(black)
      .text("COMPLIANCE SCORE", ML, y + 2, { width: titleW });
    doc.fontSize(13).font("Helvetica-Bold").fillColor(black)
      .text(vesselCode ? `${tenantName ?? ""} — ${vesselCode}` : (tenantName ?? "Flota completa"), ML, y + 30, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`Generado: ${new Date().toLocaleString("es-AR")}`, ML, y + 48, { width: titleW });

    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 14;

    // ── Resumen general (si hay >1 buque) ────────────────────────────────────
    if (scores.length === 0) {
      doc.fontSize(10).font("Helvetica").fillColor(gray)
        .text("No hay scores disponibles para mostrar.", ML, y, { width: W });
      // footer y end
      drawFooter();
      doc.end();
      return;
    }

    if (scores.length > 1) {
      const avgScore = Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length);
      const summaryH = 50;
      doc.roundedRect(ML, y, W, summaryH, 6).fillColor(bgBox).fill();
      doc.roundedRect(ML, y, W, summaryH, 6).strokeColor(border).lineWidth(1).stroke();

      doc.fontSize(8).font("Helvetica-Bold").fillColor(gray)
        .text("PROMEDIO DE FLOTA", ML + 12, y + 8, { characterSpacing: 0.8 });
      doc.fontSize(28).font("Helvetica-Bold").fillColor(black)
        .text(String(avgScore), ML + 12, y + 18);
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text(`${scores.length} buques`, ML + 80, y + 30);
      y += summaryH + 14;
    }

    // ── Tarjeta por buque ────────────────────────────────────────────────────
    for (const s of scores) {
      // Card height: depends on whether we show component breakdown
      const CARD_H = 130;
      ensureSpace(CARD_H + 10);

      // Card background
      doc.roundedRect(ML, y, W, CARD_H, 6).fillColor(bgBox).fill();
      doc.roundedRect(ML, y, W, CARD_H, 6).strokeColor(border).lineWidth(1).stroke();

      // Encabezado: vessel + score
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text(s.vesselCode, ML + 14, y + 12, { characterSpacing: 0.8 });
      doc.fontSize(14).font("Helvetica-Bold").fillColor(black)
        .text(s.vesselName, ML + 14, y + 22, { width: W * 0.55 });

      const labelColor = LABEL_COLOR[s.label] ?? black;
      doc.fontSize(28).font("Helvetica-Bold").fillColor(labelColor)
        .text(String(s.score), ML + W - 80, y + 12, { width: 70, align: "right" });
      doc.fontSize(8).font("Helvetica-Bold").fillColor(labelColor)
        .text((LABEL_TEXT[s.label] ?? s.label).toUpperCase(), ML + W - 80, y + 42, { width: 70, align: "right", characterSpacing: 0.5 });

      // Componentes — grid 3x2. Drills y STCW solo se muestran para buques
      // tripulados; barcazas omiten esas dos filas y dejan 4 componentes.
      const COMP_TOP = y + 60;
      const COMP_W = (W - 28) / 3;
      const COMP_H = 28;

      const allRows = [
        { label: "OT compliance",  v: s.components.woComplianceRate,        hint: `${s.totals.woCompletedOnTime}/${s.totals.woClosedTotal}`, crewedOnly: false },
        { label: "Drills (90d)",   v: s.components.drillCompliance,         hint: `${s.totals.drillsDone90d}/${s.totals.drillsExpected90d}`, crewedOnly: true },
        { label: "Certs vigentes", v: s.components.certVigent,              hint: `${s.totals.certsActive}/${s.totals.certsTotal}`, crewedOnly: false },
        { label: "Findings PSC",   v: s.components.noFindingsPenalty,       hint: s.totals.findingsOpen > 0 ? `${s.totals.findingsOpen} abiertos` : "Sin findings", crewedOnly: false },
        { label: "Def. críticos",  v: s.components.noCriticalDefects,       hint: s.totals.criticalDefectsOpen > 0 ? `${s.totals.criticalDefectsOpen} abiertos` : "Sin críticos", crewedOnly: false },
        { label: "STCW (30d)",     v: s.components.noRestHoursViolations,   hint: s.totals.restHoursViolations30d > 0 ? `${s.totals.restHoursViolations30d} violaciones` : "Sin violaciones", crewedOnly: true },
      ];
      const rows = allRows.filter(r => s.crewedOperation || !r.crewedOnly);

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        const col = i % 3;
        const row = Math.floor(i / 3);
        const cx  = ML + 14 + col * COMP_W;
        const cy  = COMP_TOP + row * COMP_H;

        const pct = Math.round(r.v * 100);
        const color = componentColor(r.v);

        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
          .text(r.label.toUpperCase(), cx, cy, { width: COMP_W - 4, characterSpacing: 0.4 });
        doc.fontSize(11).font("Helvetica-Bold").fillColor(color)
          .text(`${pct}%`, cx, cy + 10, { width: 40 });
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text(r.hint, cx + 42, cy + 11, { width: COMP_W - 46 });
      }

      // Nota al pie de la tarjeta cuando es no-tripulada (barcaza)
      if (!s.crewedOperation) {
        doc.fontSize(7).font("Helvetica-Oblique").fillColor(gray)
          .text("Buque no tripulado — drills y STCW no aplican al cálculo.",
            ML + 14, y + CARD_H - 18, { width: W - 28 });
      }

      y += CARD_H + 10;
    }

    drawFooter();
    doc.end();

    function drawFooter() {
      const footerY = PAGE_H - FOOTER_SIZE;
      doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
      if (existsSync(LOGO_PATH)) {
        try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* logo missing */ }
      }
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text("Copilot Management System — Compliance Score", ML + 18, footerY, { width: W / 2 - 18 });
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text(`${tenantName ?? session.tenantSlug} · ${fmt(new Date())}`, ML, footerY, { width: W, align: "right" });
    }
  });
}
