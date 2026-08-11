import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getCapaRecord } from "./capa-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, splitTextIntoPageSegments } from "./pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";


function val(v: string | null | undefined): string {
  return (v?.trim() || "—").replace(/[ð☐☑☒□■✓✔✘]/g, "[ ]");
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\|[-:\s|]+\|$/gm, "")
    .replace(/^\|(.*)\|$/gm, (_, c: string) =>
      c.split("|").map(s => s.trim()).filter(Boolean).join("  ·  "))
    .replace(/^---+$/gm, "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/[ð☐☑☒□■✓✔✘]/g, "[ ]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Abierta",
  IN_PROGRESS: "En progreso",
  PENDING_VERIFICATION: "Pendiente de verificación",
  EFFECTIVENESS_REVIEW: "Revisión de efectividad",
  VERIFIED_EFFECTIVE: "Verificada (efectiva)",
  CLOSED: "Cerrada",
  CANCELLED: "Cancelada",
};

const STATUS_COLOR: Record<string, string> = {
  OPEN: "#0369a1",
  IN_PROGRESS: "#b45309",
  PENDING_VERIFICATION: "#6d28d9",
  EFFECTIVENESS_REVIEW: "#6d28d9",
  VERIFIED_EFFECTIVE: "#16a34a",
  CLOSED: "#166534",
  CANCELLED: "#475569",
};

const PRIORITY_LABEL: Record<string, string> = {
  LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica",
};
const PRIORITY_COLOR: Record<string, string> = {
  LOW: "#16a34a", MEDIUM: "#b45309", HIGH: "#b91c1c", CRITICAL: "#7f1d1d",
};

const SOURCE_TYPE_LABEL: Record<string, string> = {
  DEFECT: "Defecto",
  WORK_ORDER: "Orden de Trabajo",
  INSPECTION: "Inspección",
};

const PAGE_H      = 841.89;
const CM          = 72 / 2.54;
const MARGIN_V    = Math.round(1.5 * CM);
const FOOTER_SIZE = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

export async function buildCapaPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  // Fechas y horas del documento en la hora de la EMPRESA: el servidor
  // corre en UTC y sin esto el papel salía con la hora del servidor.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const record = await getCapaRecord(session, id) as Awaited<ReturnType<typeof getCapaRecord>> & {
    assetName: string | null;
    sourceCode: string | null;
  };

  // Tenant logo
  let tenantLogoBuffer: Buffer | null = null;
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const tenantRow = await (prisma as unknown as { tenant: { findUnique(a: unknown): Promise<{ settings?: { displayName?: string; logoUrl?: string | null; logoUrlLight?: string | null } | null } | null> } }).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
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
      info: { Title: `${record.capaCode}-${record.vesselCode}` },
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
      .text("CAPA", ML, y + 2, { width: titleW });
    doc.fontSize(13).font("Helvetica-Bold").fillColor(black)
      .text(`${record.capaCode}  ·  ${record.vesselCode}`, ML, y + 30, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`Generado: ${fmtDateTime(new Date())}`, ML, y + 48, { width: titleW });

    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 14;

    function labeledBox(bx: number, by: number, bw: number, bh: number, label: string, value: string, valueColor = black) {
      doc.roundedRect(bx, by, bw, bh, 4).strokeColor(border).lineWidth(1).stroke().fillColor(bgBox).fill();
      doc.roundedRect(bx, by, bw, bh, 4).strokeColor(border).lineWidth(1).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), bx + 10, by + 8, { width: bw - 20, characterSpacing: 0.5 });
      doc.fontSize(11).font("Helvetica-Bold").fillColor(valueColor)
        .text(value, bx + 10, by + 20, { width: bw - 20 });
    }

    function textSection(label: string, rawText: string) {
      const text  = rawText === "—" ? "—" : stripMarkdown(rawText);
      const color = text === "—" ? gray : black;
      const LABEL_H = 14;
      const BOX_PAD_TOP = 10;
      const BOX_PAD_BOT = 10;
      const SECTION_GAP = 14;
      const TOTAL_RESERVED = LABEL_H + BOX_PAD_TOP + BOX_PAD_BOT + SECTION_GAP;

      if (text === "—") {
        doc.fontSize(10).font("Helvetica");
        const oneH = doc.heightOfString("—", { width: W - 20, lineGap: 2 });
        const boxH = Math.max(44, oneH + BOX_PAD_TOP + BOX_PAD_BOT);
        ensureSpace(LABEL_H + boxH + SECTION_GAP);
        doc.fontSize(8).font("Helvetica-Bold").fillColor(gray)
          .text(label.toUpperCase(), ML, y, { width: W, characterSpacing: 0.8 });
        y += LABEL_H;
        doc.roundedRect(ML, y, W, boxH, 4).fillColor(bgBox).fill();
        doc.roundedRect(ML, y, W, boxH, 4).strokeColor(border).lineWidth(1).stroke();
        doc.fontSize(10).font("Helvetica").fillColor(color)
          .text("—", ML + 10, y + BOX_PAD_TOP, { width: W - 20, lineGap: 2 });
        y += boxH + SECTION_GAP;
        return;
      }

      const firstAvailable = CONTENT_BOTTOM - y - TOTAL_RESERVED;
      const continuationAvailable = CONTENT_BOTTOM - MARGIN_V - TOTAL_RESERVED;
      const segments = splitTextIntoPageSegments(
        doc, text, W - 20,
        { font: "Helvetica", fontSize: 10, lineGap: 2 },
        firstAvailable, continuationAvailable,
      );

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        if (i > 0) { doc.addPage(); y = MARGIN_V; }
        const segLabel = seg.isContinuation ? `${label.toUpperCase()} (CONT.)` : label.toUpperCase();
        const boxH = Math.max(segments.length === 1 ? 44 : 24, seg.contentHeight + BOX_PAD_TOP + BOX_PAD_BOT);
        doc.fontSize(8).font("Helvetica-Bold").fillColor(gray)
          .text(segLabel, ML, y, { width: W, characterSpacing: 0.8 });
        y += LABEL_H;
        doc.roundedRect(ML, y, W, boxH, 4).fillColor(bgBox).fill();
        doc.roundedRect(ML, y, W, boxH, 4).strokeColor(border).lineWidth(1).stroke();
        doc.fontSize(10).font("Helvetica").fillColor(color)
          .text(seg.text, ML + 10, y + BOX_PAD_TOP, { width: W - 20, lineGap: 2 });
        y += boxH + SECTION_GAP;
      }
    }

    // ── Row 1: Estado + Prioridad ─────────────────────────────────────────────
    const half = (W - 8) / 2;
    labeledBox(ML,            y, half, 44, "Estado",   STATUS_LABEL[record.status] ?? record.status,   STATUS_COLOR[record.status] ?? black);
    labeledBox(ML + half + 8, y, half, 44, "Prioridad", PRIORITY_LABEL[record.priority] ?? record.priority, PRIORITY_COLOR[record.priority] ?? black);
    y += 58;

    // ── Row 2: Equipo + Tipo de origen + Origen ───────────────────────────────
    const third = (W - 16) / 3;
    labeledBox(ML,                   y, third, 44, "Equipo",        val(record.assetName));
    labeledBox(ML + third + 8,       y, third, 44, "Tipo de Origen", SOURCE_TYPE_LABEL[record.sourceType] ?? record.sourceType);
    labeledBox(ML + (third + 8) * 2, y, third, 44, "Origen",        val(record.sourceCode));
    y += 58;

    // ── Row 3: Responsable + Vence + Creada ───────────────────────────────────
    labeledBox(ML,                   y, third, 44, "Responsable", val(record.owner));
    labeledBox(ML + third + 8,       y, third, 44, "Vence",       fmt(record.dueDate));
    labeledBox(ML + (third + 8) * 2, y, third, 44, "Creada",      fmt(record.createdAt));
    y += 58;

    // ── Banner cuando está completada / verificada / cancelada ────────────────
    if (record.completedAt) {
      ensureSpace(44);
      labeledBox(ML, y, W, 38, "Completada", fmt(record.completedAt), "#16a34a");
      y += 50;
    }

    // ── Text sections ─────────────────────────────────────────────────────────
    textSection("Título",      val(record.title));
    textSection("Descripción", val(record.description));
    if (record.actionsTaken)     textSection("Acciones Realizadas (a bordo)", val(record.actionsTaken));
    if (record.verificationNote) textSection("Verificación de Gerencia Técnica", val(record.verificationNote));
    if (record.cancelReason)     textSection("Motivo de Cancelación", val(record.cancelReason));

    // ── Footer (last page) ────────────────────────────────────────────────────
    const footerY = PAGE_H - FOOTER_SIZE;
    doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* logo missing */ }
    }
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text("Copilot Management System — Reporte generado automáticamente", ML + 18, footerY, { width: W / 2 - 18 });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`${record.capaCode} · ${record.vesselCode} · ${fmt(new Date())}`, ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
