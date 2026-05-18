import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getMoc } from "./moc-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, renderLabeledTextBox } from "../pms/pdf-helpers";

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-AR");
}

function val(v: string | null | undefined): string {
  return (v?.trim() || "—").replace(/[ð☐☑☒□■✓✔✘]/g, "[ ]");
}

// Normaliza caracteres no soportados por la fuente Helvetica de pdfkit.
function sanitize(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[ð☐☑☒□■✓✔✘]/g, "[ ]")
    // Filtrar chars no soportados (mantener tab/newline + ASCII + latin-1 extendido)
    .split("")
    .filter(c => {
      const cc = c.charCodeAt(0);
      return cc === 9 || cc === 10 || (cc >= 0x20 && cc !== 0x7F && cc <= 0xFF);
    })
    .join("");
}

const CATEGORY_LABEL: Record<string, string> = {
  EQUIPMENT_CHANGE:   "Cambio de equipo",
  PROCEDURE_CHANGE:   "Cambio de procedimiento",
  ORGANIZATIONAL:     "Organizacional",
  TEMPORARY:          "Cambio temporal",
  SOFTWARE_FIRMWARE:  "Software / Firmware",
  OTHER:              "Otro",
};

const STATUS_LABEL: Record<string, string> = {
  REQUESTED:       "Solicitado",
  UNDER_ANALYSIS:  "En análisis",
  APPROVED:        "Aprobado",
  IN_PROGRESS:     "Implementando",
  IMPLEMENTED:     "Implementado",
  REVIEWED:        "Revisado",
  REJECTED:        "Rechazado",
  CANCELLED:       "Cancelado",
};

const STATUS_COLOR: Record<string, string> = {
  REQUESTED:      "#0369a1",
  UNDER_ANALYSIS: "#ca8a04",
  APPROVED:       "#16a34a",
  IN_PROGRESS:    "#b45309",
  IMPLEMENTED:    "#6d28d9",
  REVIEWED:       "#15803d",
  REJECTED:       "#b91c1c",
  CANCELLED:      "#475569",
};

const RISK_LABEL: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Crítico" };
const RISK_COLOR: Record<string, string> = {
  LOW: "#16a34a", MEDIUM: "#b45309", HIGH: "#b91c1c", CRITICAL: "#7f1d1d",
};

const PAGE_H        = 841.89;
const CM            = 72 / 2.54;
const MARGIN_V      = Math.round(0.9 * CM); // 0.9cm — antes 1.5cm, gana ~34pt
const FOOTER_SIZE   = 32;                   // antes 40
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

interface MocRecord {
  id: string;
  mocCode: string;
  vesselCode: string;
  category: string;
  status: string;
  title: string;
  reasonForChange: string;
  proposedChange: string;
  riskLevel: string;
  impactAreasJson: string[] | null;
  riskAssessmentNotes: string | null;
  mitigationActions: string | null;
  approvedAt: Date | string | null;
  approvedByName: string | null;
  rejectedReason: string | null;
  plannedDate: Date | string | null;
  implementedAt: Date | string | null;
  implementedByName: string | null;
  implementationNotes: string | null;
  reviewedAt: Date | string | null;
  reviewNotes: string | null;
  reviewOutcome: string | null;
  createdAt: Date | string;
}

export async function buildMocPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const moc = await getMoc(session, id) as unknown as MocRecord;

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
      info: { Title: `${moc.mocCode}-${moc.vesselCode}` },
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

    // ── Header (compacto) ────────────────────────────────────────────────────
    const HEADER_H = 48;             // antes 64
    const TENANT_LOGO_MAX_W = 70;    // antes 90

    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + W - TENANT_LOGO_MAX_W, y,
          { fit: [TENANT_LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
      } catch { /* logo unavailable */ }
    }

    const titleW = W - TENANT_LOGO_MAX_W - 16;
    doc.fontSize(18).font("Helvetica-Bold").fillColor(black)
      .text("MANAGEMENT OF CHANGE", ML, y + 2, { width: titleW });
    doc.fontSize(11).font("Helvetica-Bold").fillColor(black)
      .text(`${moc.mocCode}  ·  ${moc.vesselCode}`, ML, y + 24, { width: titleW });
    doc.fontSize(7).font("Helvetica").fillColor(gray)
      .text(sanitize(`Generado: ${new Date().toLocaleString("es-AR")}`), ML, y + 38, { width: titleW });

    y += HEADER_H + 4;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1).stroke();
    y += 8;

    function labeledBox(bx: number, by: number, bw: number, bh: number, label: string, value: string, valueColor = black) {
      doc.roundedRect(bx, by, bw, bh, 3).strokeColor(border).lineWidth(0.5).stroke().fillColor(bgBox).fill();
      doc.roundedRect(bx, by, bw, bh, 3).strokeColor(border).lineWidth(0.5).stroke();
      doc.fontSize(6.5).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), bx + 7, by + 5, { width: bw - 14, characterSpacing: 0.4 });
      doc.fontSize(9.5).font("Helvetica-Bold").fillColor(valueColor)
        .text(sanitize(value), bx + 7, by + 14, { width: bw - 14 });
    }

    function textSection(label: string, rawText: string) {
      // Delegamos en el helper compartido — soporta multi-página con badge
      // redibujado por página y soporta **bold** markdown (necesario para el
      // output del análisis de riesgo de la IA).
      y = renderLabeledTextBox(doc, {
        label,
        text: val(rawText),
        x: ML,
        y,
        width: W,
        pageBottom: CONTENT_BOTTOM,
        pageTop: MARGIN_V,
        labelPosition: "above",
        labelHeightAbove: 11,
        padding: 6,
        fontSize: 9,
        lineGap: 2,
        sectionGap: 6,
        bg: bgBox,
        border,
        labelColor: gray,
        textColor: black,
        cornerRadius: 3,
        markdown: true,
      });
    }

    // ── Row 1: Estado + Riesgo + Categoría ────────────────────────────────────
    const third = (W - 16) / 3;
    const BOX_H = 32; // antes 44
    labeledBox(ML,                   y, third, BOX_H, "Estado",    STATUS_LABEL[moc.status] ?? moc.status, STATUS_COLOR[moc.status] ?? black);
    labeledBox(ML + third + 8,       y, third, BOX_H, "Riesgo",    RISK_LABEL[moc.riskLevel] ?? moc.riskLevel, RISK_COLOR[moc.riskLevel] ?? black);
    labeledBox(ML + (third + 8) * 2, y, third, BOX_H, "Categoría", CATEGORY_LABEL[moc.category] ?? moc.category);
    y += BOX_H + 6;

    // ── Row 2: Creado + Planeado + Implementado ──────────────────────────────
    labeledBox(ML,                   y, third, BOX_H, "Creado",      fmt(moc.createdAt));
    labeledBox(ML + third + 8,       y, third, BOX_H, "Planeado",    fmt(moc.plannedDate));
    labeledBox(ML + (third + 8) * 2, y, third, BOX_H, "Implementado",fmt(moc.implementedAt));
    y += BOX_H + 8;

    // ── Áreas de impacto (chips) ────────────────────────────────────────────
    // Label arriba + chips en línea (o varias líneas si no entran). Antes era
    // un `continued: true` con `y += 14` hardcodeado: si los chips wrapeaban
    // a 2 líneas, la sección siguiente se pisaba con los chips de abajo.
    const areas = moc.impactAreasJson ?? [];
    if (areas.length > 0) {
      const chipsText = sanitize(areas.map(a => `[ ${a} ]`).join("  "));
      doc.fontSize(9).font("Helvetica-Bold");
      const chipsH = doc.heightOfString(chipsText, { width: W });
      ensureSpace(11 + chipsH + 6);

      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text("ÁREAS DE IMPACTO", ML, y, { width: W, characterSpacing: 0.6 });
      y += 11;
      doc.fontSize(9).font("Helvetica-Bold").fillColor(black)
        .text(chipsText, ML, y, { width: W });
      y += chipsH + 6;
    }

    // ── Text sections ─────────────────────────────────────────────────────────
    // Las 5 secciones del cuerpo se renderizan SIEMPRE, aunque estén vacías,
    // para que la ausencia sea visible al revisor / auditor.
    textSection("Título",                    moc.title);
    textSection("Razón del cambio",          moc.reasonForChange);
    textSection("Cambio propuesto",          moc.proposedChange);
    textSection("Análisis de Riesgo",        moc.riskAssessmentNotes ?? "");
    textSection("Medidas de Mitigación",     moc.mitigationActions ?? "");

    // ── Trazabilidad ──────────────────────────────────────────────────────────
    const traceParts: string[] = [];
    if (moc.approvedAt)        traceParts.push(`Aprobado por ${moc.approvedByName ?? "—"} el ${fmt(moc.approvedAt)}.`);
    if (moc.rejectedReason)    traceParts.push(`Rechazado: ${moc.rejectedReason}`);
    if (moc.implementedAt)     traceParts.push(`Implementado el ${fmt(moc.implementedAt)}${moc.implementedByName ? ` por ${moc.implementedByName}` : ""}.${moc.implementationNotes ? ` ${moc.implementationNotes}` : ""}`);
    if (moc.reviewedAt)        traceParts.push(`Revisado el ${fmt(moc.reviewedAt)}: ${moc.reviewOutcome ?? "—"}.${moc.reviewNotes ? ` ${moc.reviewNotes}` : ""}`);
    if (traceParts.length > 0) textSection("Trazabilidad", traceParts.join("\n"));

    // ── Footer (last page) ────────────────────────────────────────────────────
    const footerY = PAGE_H - FOOTER_SIZE + 8;
    doc.moveTo(ML, footerY - 6).lineTo(ML + W, footerY - 6).strokeColor(border).lineWidth(0.5).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 12, height: 12 }); } catch { /* logo missing */ }
    }
    doc.fontSize(7).font("Helvetica").fillColor(gray)
      .text("Copilot Management System - Management of Change", ML + 16, footerY, { width: W / 2 - 16 });
    doc.fontSize(7).font("Helvetica").fillColor(gray)
      .text(sanitize(`${moc.mocCode} - ${moc.vesselCode} - ${fmt(new Date())}`), ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
