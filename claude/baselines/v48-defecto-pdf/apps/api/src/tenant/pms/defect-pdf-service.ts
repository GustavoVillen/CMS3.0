import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getDefect } from "./defects-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, splitTextIntoPageSegments } from "./pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";


function val(v: string | null | undefined): string {
  return (v?.trim() || "—").replace(/[ð☐☑☒□■✓✔✘]/g, "[ ]");
}

// Strip markdown syntax so it renders as clean plain text in the PDF
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")                               // headings → plain text
    .replace(/^\|[-:\s|]+\|$/gm, "")                           // table separator rows
    .replace(/^\|(.*)\|$/gm, (_, c: string) =>                 // table rows → bullet list
      c.split("|").map(s => s.trim()).filter(Boolean).join("  ·  ")
    )
    .replace(/\[CLOSE\]\s*/g, "")                              // close note prefix
    .replace(/^---+$/gm, "")                                   // horizontal rules
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")                  // bold/italic
    .replace(/[ð☐☑☒□■✓✔✘]/g, "[ ]")                          // checkbox chars → plain text
    .replace(/\n{3,}/g, "\n\n")                                // collapse blank lines
    .trim();
}

const SEVERITY_COLOR: Record<string, string> = {
  LOW: "#16a34a", MEDIUM: "#b45309", HIGH: "#b91c1c", CRITICAL: "#7f1d1d",
};
const STATUS_COLOR: Record<string, string> = {
  OPEN: "#0369a1", UNDER_REVIEW: "#6d28d9", IN_PROGRESS: "#b45309",
  DEFERRED: "#475569", RESOLVED: "#0f766e", CLOSED: "#166534",
};

const PAGE_H      = 841.89;            // A4 height pts
const CM          = 72 / 2.54;         // pts per cm
const MARGIN_V    = Math.round(1.5 * CM); // 1.5cm ≈ 43pts
const FOOTER_SIZE = 40;                // footer block height
// content must stop this far from the bottom (footer + bottom margin)
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

export async function buildDefectPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  // Fechas y horas del documento en la hora de la EMPRESA: el servidor
  // corre en UTC y sin esto el papel salía con la hora del servidor.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const defect = await getDefect(session, id);

  // Resolve WO code when linked
  let linkedWoCode: string | null = null;
  if (defect.workOrderId) {
    const prismaRaw = getPrismaClient();
    if (prismaRaw) {
      try {
        const wo = await (prismaRaw as any).workOrder.findUnique({
          where: { id: defect.workOrderId },
          select: { workOrderCode: true },
        });
        linkedWoCode = wo?.workOrderCode ?? null;
      } catch { /* non-blocking */ }
    }
  }

  // Resolve asset name (the defect carries assetId; the PDF should show the equipment)
  let assetName: string | null = null;
  if (defect.assetId) {
    const prismaRaw = getPrismaClient();
    if (prismaRaw) {
      try {
        const asset = await (prismaRaw as any).asset.findUnique({
          where: { id: defect.assetId },
          select: { name: true, assetCode: true },
        });
        assetName = asset?.name ?? asset?.assetCode ?? null;
      } catch { /* non-blocking */ }
    }
  }

  // Get tenant logo
  let tenant: { name?: string; logoUrl?: string | null; logoUrlLight?: string | null } | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const tenantRow = await (prisma as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      tenant = tenantRow?.settings
        ? { name: tenantRow.settings.displayName, logoUrl: tenantRow.settings.logoUrl, logoUrlLight: tenantRow.settings.logoUrlLight }
        : null;
      tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, tenant?.logoUrl, tenant?.logoUrlLight);
    } catch { /* non-blocking */ }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: { Title: `${defect.defectCode}-${defect.vesselCode}` },
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

    // When PDFKit auto-creates a page during a long .text() call it starts at y=0.
    // Override with MARGIN_V so pages 2+ always start with the correct top margin.
    doc.on("pageAdded", () => {
      (doc as unknown as { y: number }).y = MARGIN_V;
      y = MARGIN_V;
    });

    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) {
        doc.addPage();
        y = MARGIN_V; // top margin from page 2 onward
      }
    }

    // ── Header ────────────────────────────────────────────────────────────────
    const HEADER_H = 64;
    const TENANT_LOGO_MAX_W = 90;

    // Tenant logo — top-right, proportional to header height
    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + W - TENANT_LOGO_MAX_W, y,
          { fit: [TENANT_LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
      } catch {}
    }

    const titleW = W - TENANT_LOGO_MAX_W - 16;
    doc.fontSize(22).font("Helvetica-Bold").fillColor(black)
      .text("REPORTE DE DEFECTO", ML, y + 2, { width: titleW });
    doc.fontSize(13).font("Helvetica-Bold").fillColor(black)
      .text(`${defect.defectCode}  ·  ${defect.vesselCode}`, ML, y + 30, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`Generado: ${fmtDateTime(new Date())}`, ML, y + 48, { width: titleW });

    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 14;

    // ── Labeled compact box ───────────────────────────────────────────────────
    function labeledBox(bx: number, by: number, bw: number, bh: number, label: string, value: string, valueColor = black) {
      doc.roundedRect(bx, by, bw, bh, 4).strokeColor(border).lineWidth(1).stroke().fillColor(bgBox).fill();
      doc.roundedRect(bx, by, bw, bh, 4).strokeColor(border).lineWidth(1).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), bx + 10, by + 8, { width: bw - 20, characterSpacing: 0.5 });
      doc.fontSize(11).font("Helvetica-Bold").fillColor(valueColor)
        .text(value, bx + 10, by + 20, { width: bw - 20 });
    }

    // ── Text section with page-break awareness ────────────────────────────────
    // Renderiza una sección con label en gris arriba y texto en caja.
    // Si el contenido excede la página, se parte en segmentos con caja propia
    // (cada uno con el label correspondiente "(cont.)").
    function textSection(label: string, rawText: string) {
      const text  = rawText === "—" ? "—" : stripMarkdown(rawText);
      const color = text === "—" ? gray : black;
      const LABEL_H = 14;
      const BOX_PAD_TOP = 10;
      const BOX_PAD_BOT = 10;
      const SECTION_GAP = 14;
      const TOTAL_RESERVED = LABEL_H + BOX_PAD_TOP + BOX_PAD_BOT + SECTION_GAP;

      // Caso "—": single line, render simple
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
        const seg = segments[i];
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

    // ── Equipo (Asset) — identificador primario del defecto, full-width ───────
    labeledBox(ML, y, W, 44, "Equipo", assetName ?? "—", "#0369a1");
    y += 58;

    // ── Row 1: Fecha + Clasificación ──────────────────────────────────────────
    const half = (W - 8) / 2;
    labeledBox(ML,            y, half, 44, "Fecha de Reporte", fmt(defect.reportedAt));
    labeledBox(ML + half + 8, y, half, 44, "Clasificación",    val(defect.classification));
    y += 58;

    // ── Row 2: Severidad + Estado Operacional + Estado ────────────────────────
    const third = (W - 16) / 3;
    labeledBox(ML,                   y, third, 44, "Severidad",          defect.severity,        SEVERITY_COLOR[defect.severity] ?? black);
    labeledBox(ML + third + 8,       y, third, 44, "Estado Operacional", defect.operationalState);
    labeledBox(ML + (third + 8) * 2, y, third, 44, "Estado",            defect.status,           STATUS_COLOR[defect.status] ?? black);
    y += 58;

    // ── Banner OT — distinguir ORIGEN vs RESOLUTORA ───────────────────────────
    // Si el defecto se originó en una OT (WORK_ORDER_FINDING), workOrderId ES la
    // OT de origen (no se le crea correctiva). En cualquier otro caso, una OT
    // vinculada es la que resolvió el defecto. No confundir ambas.
    const originIsWo = defect.classification === "WORK_ORDER_FINDING";
    const resolvedWithWo =
      !originIsWo && (defect.status === "RESOLVED" || defect.status === "CLOSED") && !!defect.workOrderId;
    if (originIsWo && defect.workOrderId) {
      ensureSpace(44);
      labeledBox(ML, y, W, 38, "Origen: Orden de Trabajo", linkedWoCode ?? defect.workOrderId, "#0369a1");
      y += 50;
    } else if (resolvedWithWo) {
      ensureSpace(44);
      // Banner ancho con color success-sea (verde), más visible que la caja chica
      const woLabel = linkedWoCode ?? defect.workOrderId ?? "—";
      labeledBox(ML, y, W, 38, "Resuelto vía Orden de Trabajo", woLabel, "#16a34a");
      y += 50;
    }

    // ── Text sections ─────────────────────────────────────────────────────────
    textSection("Descripción",    val(defect.description));
    textSection("Acción Inmediata", val(defect.immediateAction));
    textSection("Análisis RCA",   val(defect.rcaAnalysis));
    textSection("CAPA",           val(defect.capaDescription));

    // Repair type & WO (solo cuando NO se mostró el banner arriba)
    if (defect.repairType) {
      ensureSpace(58);
      const repairLabel = defect.repairType === "PERMANENTE" ? "Permanente" : "Temporaria";
      const repairColor = defect.repairType === "PERMANENTE" ? "#16a34a" : "#b45309";
      labeledBox(ML, y, W / 3, 44, "Tipo de Reparación", repairLabel, repairColor);
      y += 58;
    }

    if (defect.workOrderId && !resolvedWithWo && !originIsWo) {
      ensureSpace(58);
      labeledBox(ML, y, W / 3, 44, "Work Order Vinculada", linkedWoCode ?? defect.workOrderId, "#0369a1");
      y += 58;
    }

    // ── Verificación de eficacia (ISM 10.2.3) ─────────────────────────────────
    // Es la evidencia que pide el auditor: no sólo qué se hizo, sino que alguien
    // confirmó después que el problema no volvió.
    if (defect.effectivenessVerifiedAt || defect.effectivenessDueAt) {
      ensureSpace(58);
      const verified = !!defect.effectivenessVerifiedAt;
      const outcomeLabel = defect.effectivenessOutcome === "EFFECTIVE" ? "Efectiva"
        : defect.effectivenessOutcome === "PARTIALLY_EFFECTIVE" ? "Parcialmente efectiva"
        : defect.effectivenessOutcome === "INEFFECTIVE" ? "No efectiva"
        : "Pendiente";
      const boxValue = verified
        ? `${outcomeLabel} · ${fmt(defect.effectivenessVerifiedAt)}`
        : `Pendiente · a revisar el ${fmt(defect.effectivenessDueAt)}`;
      const boxColor = !verified ? "#b45309"
        : defect.effectivenessOutcome === "INEFFECTIVE" ? "#b91c1c" : "#16a34a";
      labeledBox(ML, y, W, 44, "Verificación de Eficacia de la Medida Correctiva", boxValue, boxColor);
      y += 58;
      if (defect.effectivenessNote) textSection("Observación de la Verificación", val(defect.effectivenessNote));
    }

    // ── Footer (last page) ────────────────────────────────────────────────────
    const footerY = PAGE_H - FOOTER_SIZE;
    doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch {}
    }
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text("Copilot Management System — Reporte generado automáticamente", ML + 18, footerY, { width: W / 2 - 18 });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`${defect.defectCode} · ${defect.vesselCode} · ${fmt(new Date())}`, ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
