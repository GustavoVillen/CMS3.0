import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getMoc } from "./moc-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo } from "../pms/pdf-helpers";

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
const MARGIN_V      = Math.round(1.5 * CM);
const FOOTER_SIZE   = 40;
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
      .text("MANAGEMENT OF CHANGE", ML, y + 2, { width: titleW });
    doc.fontSize(13).font("Helvetica-Bold").fillColor(black)
      .text(`${moc.mocCode}  ·  ${moc.vesselCode}`, ML, y + 30, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(sanitize(`Generado: ${new Date().toLocaleString("es-AR")}`), ML, y + 48, { width: titleW });

    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 14;

    function labeledBox(bx: number, by: number, bw: number, bh: number, label: string, value: string, valueColor = black) {
      doc.roundedRect(bx, by, bw, bh, 4).strokeColor(border).lineWidth(1).stroke().fillColor(bgBox).fill();
      doc.roundedRect(bx, by, bw, bh, 4).strokeColor(border).lineWidth(1).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), bx + 10, by + 8, { width: bw - 20, characterSpacing: 0.5 });
      doc.fontSize(11).font("Helvetica-Bold").fillColor(valueColor)
        .text(sanitize(value), bx + 10, by + 20, { width: bw - 20 });
    }

    /** Parte una línea en segmentos { text, bold } a partir de **bold**. */
    function tokenize(line: string): Array<{ text: string; bold: boolean }> {
      const segments: Array<{ text: string; bold: boolean }> = [];
      let rest = line;
      while (rest.length > 0) {
        const m = rest.match(/^\*\*([^*]+)\*\*/);
        if (m) {
          segments.push({ text: m[1]!, bold: true });
          rest = rest.slice(m[0].length);
          continue;
        }
        const idx = rest.indexOf("**");
        if (idx === -1) {
          segments.push({ text: rest, bold: false });
          rest = "";
        } else {
          if (idx > 0) segments.push({ text: rest.slice(0, idx), bold: false });
          rest = rest.slice(idx);
        }
      }
      return segments;
    }

    /**
     * Mide la altura real que ocupará el texto al renderizarse en `width` pts,
     * considerando wrap automático de pdfkit. Usa heightOfString sobre la
     * versión sin asteriscos (el ancho de **bold** vs normal difiere en
     * <5% para Helvetica, suficiente para reservar caja).
     */
    function measureTextHeight(text: string, width: number, fontSize: number, lineGap: number): number {
      const lines = text.split(/\r?\n/);
      doc.fontSize(fontSize).font("Helvetica");
      let total = 0;
      for (const rawLine of lines) {
        const sanitized = sanitize(rawLine);
        const stripped = sanitized.replace(/\*\*/g, "");
        if (!stripped.trim()) {
          total += fontSize + lineGap;
          continue;
        }
        total += doc.heightOfString(stripped, { width, lineGap });
      }
      return total;
    }

    /**
     * Renderiza un texto con soporte light de Markdown (**bold** + newlines)
     * usando el cursor automático de pdfkit, que respeta wrap. Cada línea
     * lógica del input se pinta como una secuencia de segmentos continuos
     * (cada uno con su fuente), y el último segmento de cada línea cierra
     * el bloque (continued: false) para forzar el line break.
     */
    function textWithBold(text: string, x: number, startY: number, width: number, fontSize: number, lineGap: number): void {
      const lines = text.split(/\r?\n/);
      doc.fontSize(fontSize).fillColor(black);
      // Posicionar cursor manualmente en la primera línea; las siguientes
      // continúan desde doc.y / doc.x que pdfkit actualiza.
      let firstOfLine = true;
      doc.x = x;
      doc.y = startY;

      for (let li = 0; li < lines.length; li++) {
        const rawLine = lines[li]!;
        const line = sanitize(rawLine);
        if (!line.trim()) {
          // Línea vacía: avanzamos un line height aproximado.
          doc.text(" ", x, doc.y, { width, lineGap });
          firstOfLine = true;
          continue;
        }
        const segments = tokenize(line);
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i]!;
          const last = i === segments.length - 1;
          doc.font(seg.bold ? "Helvetica-Bold" : "Helvetica").fillColor(black);
          if (firstOfLine) {
            doc.text(seg.text, x, doc.y, {
              continued: !last,
              width,
              lineGap,
            });
            firstOfLine = false;
          } else {
            doc.text(seg.text, {
              continued: !last,
              width,
              lineGap,
            });
          }
          if (last) firstOfLine = true;
        }
      }
    }

    function textSection(label: string, rawText: string) {
      const text = val(rawText);
      const LABEL_H = 14;
      const BOX_PAD_TOP = 10;
      const BOX_PAD_BOT = 10;
      const SECTION_GAP = 14;
      const LINE_GAP = 3;
      const FONT_SIZE = 10;

      // Pre-medir altura REAL del texto considerando wrap.
      const contentH = measureTextHeight(text, W - 20, FONT_SIZE, LINE_GAP);
      const boxH = Math.max(36, contentH + BOX_PAD_TOP + BOX_PAD_BOT);

      ensureSpace(LABEL_H + boxH + SECTION_GAP);

      doc.fontSize(8).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), ML, y, { width: W, characterSpacing: 0.8 });
      y += LABEL_H;

      doc.roundedRect(ML, y, W, boxH, 4).fillColor(bgBox).fill();
      doc.roundedRect(ML, y, W, boxH, 4).strokeColor(border).lineWidth(1).stroke();

      textWithBold(text, ML + 10, y + BOX_PAD_TOP, W - 20, FONT_SIZE, LINE_GAP);

      y += boxH + SECTION_GAP;
    }

    // ── Row 1: Estado + Riesgo + Categoría ────────────────────────────────────
    const third = (W - 16) / 3;
    labeledBox(ML,                   y, third, 44, "Estado",    STATUS_LABEL[moc.status] ?? moc.status, STATUS_COLOR[moc.status] ?? black);
    labeledBox(ML + third + 8,       y, third, 44, "Riesgo",    RISK_LABEL[moc.riskLevel] ?? moc.riskLevel, RISK_COLOR[moc.riskLevel] ?? black);
    labeledBox(ML + (third + 8) * 2, y, third, 44, "Categoría", CATEGORY_LABEL[moc.category] ?? moc.category);
    y += 58;

    // ── Row 2: Creado + Planeado + Implementado ──────────────────────────────
    labeledBox(ML,                   y, third, 44, "Creado",      fmt(moc.createdAt));
    labeledBox(ML + third + 8,       y, third, 44, "Planeado",    fmt(moc.plannedDate));
    labeledBox(ML + (third + 8) * 2, y, third, 44, "Implementado",fmt(moc.implementedAt));
    y += 58;

    // ── Áreas de impacto (chips) ──────────────────────────────────────────────
    const areas = moc.impactAreasJson ?? [];
    if (areas.length > 0) {
      ensureSpace(36);
      doc.fontSize(8).font("Helvetica-Bold").fillColor(gray)
        .text("ÁREAS DE IMPACTO", ML, y, { width: W, characterSpacing: 0.8 });
      y += 14;
      const chipsText = areas.map(a => `[ ${a} ]`).join("   ");
      doc.fontSize(10).font("Helvetica-Bold").fillColor(black)
        .text(sanitize(chipsText), ML, y, { width: W });
      y += 22;
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
    const footerY = PAGE_H - FOOTER_SIZE;
    doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* logo missing */ }
    }
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text("Copilot Management System - Management of Change", ML + 18, footerY, { width: W / 2 - 18 });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(sanitize(`${moc.mocCode} - ${moc.vesselCode} - ${fmt(new Date())}`), ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
