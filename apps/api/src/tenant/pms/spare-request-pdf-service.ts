import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getSpareRequest } from "../spare-requests/spare-requests-service";
import { listRequestItems } from "../spare-requests/spare-request-items-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo } from "./pdf-helpers";

function fmt(d: Date | string | null | undefined, tz = "UTC", locale = "es-AR"): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(locale, { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" });
}

function val(v: string | null | undefined): string {
  return (v?.trim() || "—").replace(/[ð☐☑☒□■✓✔✘]/g, "[ ]");
}

function priorityLabel(p: string): string {
  const m: Record<string, string> = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica" };
  return m[p] ?? p;
}

function statusLabel(s: string): string {
  const m: Record<string, string> = {
    DRAFT: "Borrador", SUBMITTED: "Enviada", APPROVED: "Aprobada",
    REJECTED: "Rechazada", PARTIALLY_FULFILLED: "Parcialmente atendida",
    FULFILLED: "Atendida", CANCELLED: "Cancelada",
  };
  return m[s] ?? s;
}

function itemStatusLabel(s: string, receivedAt: Date | string | null | undefined, fmtFn: (d: Date | string | null | undefined) => string): string {
  if (s === "FULFILLED") return `Recibido el ${fmtFn(receivedAt)}`;
  if (s === "CANCELLED") return "Cancelado";
  return "No recibido";
}

const PAGE_H         = 841.89;
const CM             = 72 / 2.54;
const MARGIN_V       = Math.round(1.5 * CM);
const FOOTER_SIZE    = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

export async function buildSpareRequestPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const req = await getSpareRequest(session, id);
  if (!req) throw new Error("Solicitud no encontrada.");

  const items = await listRequestItems(session, id);

  // Resolve tenant timezone, locale, and logo
  let tenantTz     = "UTC";
  let tenantLocale = "es-AR";
  let tenantName   = "Copilot Management System";
  let tenantLogoBuffer: Buffer | null = null;
  const prisma = getPrismaClient();
  if (prisma) {
    const tenantRow = await (prisma as any).tenant.findUnique({
      where: { slug: session.tenantSlug },
      select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true, timezone: true, defaultLocale: true } } },
    });
    const ts = tenantRow?.settings;
    if (ts?.displayName) tenantName = ts.displayName;
    if (ts?.timezone) tenantTz = ts.timezone;
    if (ts?.defaultLocale) {
      const loc = ts.defaultLocale;
      tenantLocale = loc === "en" ? "en-GB" : loc === "pt" ? "pt-BR" : "es-AR";
    }
    tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, ts?.logoUrl, ts?.logoUrlLight);
  }

  const f = (d: Date | string | null | undefined) => fmt(d, tenantTz, tenantLocale);

  // Resolve requester, approver, and receiver names
  let requesterName: string | null = null;
  let approverName:  string | null = null;
  let receiverName:  string | null = null;
  if (prisma) {
    const resolveUser = async (userId: string | null): Promise<string | null> => {
      if (!userId) return null;
      try {
        const u = await (prisma as any).user.findUnique({
          where: { id: userId },
          select: { firstName: true, lastName: true },
        });
        return u ? (`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null) : null;
      } catch { return null; }
    };
    // Receiver: updatedByUserId of any FULFILLED item
    const fulfilledItem = items.find((i: any) => i.status === "FULFILLED");
    [requesterName, approverName, receiverName] = await Promise.all([
      resolveUser(req.requestedByUserId),
      resolveUser((req as any).approvedByUserId ?? null),
      resolveUser(fulfilledItem ? (fulfilledItem as any).updatedByUserId ?? null : null),
    ]);
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: req.requestCode } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML  = 48;
    const PW  = 595.28;
    const W   = PW - ML * 2;

    const navy  = "#0f2744";
    const black = "#0f172a";
    const gray  = "#64748b";
    const border= "#cbd5e1";
    const bgBox = "#f8fafc";
    const bgHead= "#0f2744";

    let y = MARGIN_V;

    doc.on("pageAdded", () => {
      (doc as any).y = MARGIN_V;
      y = MARGIN_V;
    });

    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_V; }
    }

    function sectionHeader(title: string) {
      ensureSpace(22);
      doc.rect(ML, y, W, 18).fillColor(bgHead).fill();
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#ffffff")
        .text(title.toUpperCase(), ML + 10, y + 5, { width: W - 20, characterSpacing: 1.2 });
      y += 18;
    }

    function inlineRow(fields: Array<{ label: string; value: string; color?: string }>) {
      const boxH = 42;
      ensureSpace(boxH);
      const colW = W / fields.length;
      fields.forEach((f, i) => {
        const bx = ML + i * colW;
        doc.roundedRect(bx, y, colW, boxH, 0).fillColor(bgBox).fill();
        doc.roundedRect(bx, y, colW, boxH, 0).strokeColor(border).lineWidth(0.5).stroke();
        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
          .text(f.label.toUpperCase(), bx + 10, y + 7, { width: colW - 20, characterSpacing: 0.5 });
        doc.fontSize(10.5).font("Helvetica-Bold").fillColor(f.color ?? black)
          .text(f.value, bx + 10, y + 19, { width: colW - 20 });
      });
      y += boxH;
    }

    function textRow(label: string, rawText: string) {
      const text  = val(rawText);
      const color = text === "—" ? gray : black;
      doc.fontSize(10).font("Helvetica");
      const textH = doc.heightOfString(text, { width: W - 20, lineGap: 2 });
      const boxH  = Math.max(38, textH + 18);
      ensureSpace(boxH);
      doc.roundedRect(ML, y, W, boxH, 0).fillColor(bgBox).fill();
      doc.roundedRect(ML, y, W, boxH, 0).strokeColor(border).lineWidth(0.5).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), ML + 10, y + 6, { width: W - 20, characterSpacing: 0.5 });
      doc.fontSize(10).font("Helvetica").fillColor(color)
        .text(text, ML + 10, y + 18, { width: W - 20, lineGap: 2 });
      y += boxH;
    }

    // ── HEADER ──────────────────────────────────────────────────────────────────
    const HEADER_H = 56;
    const TENANT_LOGO_MAX_W = 90;
    doc.rect(ML, y, 4, HEADER_H).fillColor("#1e40af").fill();

    // Tenant logo — top-right, proportional to header height
    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + W - TENANT_LOGO_MAX_W, y,
          { fit: [TENANT_LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
      } catch {}
    }

    doc.fontSize(17).font("Helvetica-Bold").fillColor(navy)
      .text("SOLICITUD DE REPUESTOS", ML + 14, y + 4, { width: W * 0.55, lineGap: 2 });

    // Tenant name fallback when no logo
    if (!tenantLogoBuffer) {
      doc.fontSize(8.5).font("Helvetica").fillColor(gray)
        .text(tenantName, ML + 14, y + 34, { width: W * 0.55 });
    }

    const metaX = ML + W * 0.58;
    const metaW = ML + W - TENANT_LOGO_MAX_W - 8 - metaX;
    doc.fontSize(7.5).font("Helvetica").fillColor(gray)
      .text("Código:", metaX, y, { width: metaW, align: "right" });
    doc.fontSize(12).font("Helvetica-Bold").fillColor(navy)
      .text(req.requestCode, metaX, y + 10, { width: metaW, align: "right" });
    doc.fontSize(7.5).font("Helvetica").fillColor(gray)
      .text(`Generado: ${new Date().toLocaleString(tenantLocale, { timeZone: tenantTz })}`, metaX, y + 38, { width: metaW, align: "right" });

    y += 64;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 12;

    // ── SECCIÓN 1: INFORMACIÓN GENERAL ─────────────────────────────────────────
    sectionHeader("Información General");
    inlineRow([
      { label: "Vessel",     value: val(req.requestedForVesselCode), color: "#1d4ed8" },
      { label: "Estado",     value: statusLabel(req.status) },
      { label: "Prioridad",  value: priorityLabel(req.priority) },
    ]);
    inlineRow([
      { label: "Solicitado por",  value: requesterName ?? "—" },
      { label: "Fecha solicitud", value: f(req.requestedAt) },
      { label: "Fecha aprobación",value: req.approvedAt ? f(req.approvedAt) : "—" },
    ]);
    if (req.notes) textRow("Notas / Observaciones", req.notes);
    if (req.rejectionReason) textRow("Motivo de rechazo", req.rejectionReason);
    y += 8;

    // ── SECCIÓN 2: ÍTEMS SOLICITADOS ────────────────────────────────────────────
    sectionHeader("Ítems Solicitados");

    const ROW_H = 28;
    const COL_DESC  = W * 0.42;
    const COL_SKU   = W * 0.18;
    const COL_QTY   = W * 0.10;
    const COL_UNIT  = W * 0.10;
    const COL_STAT  = W * 0.20;

    // Table header
    ensureSpace(ROW_H);
    const hBg = "#e2e8f0";
    doc.rect(ML, y, W, ROW_H - 4).fillColor(hBg).fill();
    doc.fontSize(7).font("Helvetica-Bold").fillColor(gray);
    doc.text("DESCRIPCIÓN",        ML + 8,                   y + 8, { width: COL_DESC - 8 });
    doc.text("SKU",                ML + COL_DESC,            y + 8, { width: COL_SKU });
    doc.text("CANT.",              ML + COL_DESC + COL_SKU,  y + 8, { width: COL_QTY, align: "right" });
    doc.text("UNIDAD",             ML + COL_DESC + COL_SKU + COL_QTY, y + 8, { width: COL_UNIT });
    doc.text("ESTADO",             ML + COL_DESC + COL_SKU + COL_QTY + COL_UNIT, y + 8, { width: COL_STAT });
    y += ROW_H - 4;

    if (items.length === 0) {
      ensureSpace(30);
      doc.fontSize(10).font("Helvetica").fillColor(gray)
        .text("Sin ítems registrados.", ML + 8, y + 8, { width: W });
      y += 30;
    } else {
      items.forEach((item, idx) => {
        const receiptNotes: string | null = (item as any).receiptNotes ?? null;
        const hasNotes = item.status === "FULFILLED" && receiptNotes;
        const noteH = hasNotes ? 14 : 0;
        const totalH = ROW_H + noteH;
        const rowBg = idx % 2 === 0 ? bgBox : "#ffffff";
        ensureSpace(totalH);
        doc.rect(ML, y, W, totalH).fillColor(rowBg).fill();
        doc.moveTo(ML, y + totalH).lineTo(ML + W, y + totalH).strokeColor(border).lineWidth(0.3).stroke();

        doc.fontSize(9).font("Helvetica").fillColor(black)
          .text(item.description || "—", ML + 8, y + 8, { width: COL_DESC - 8, ellipsis: true });
        doc.fontSize(8).font("Helvetica").fillColor("#1d4ed8")
          .text(item.spareSku ?? "—", ML + COL_DESC, y + 8, { width: COL_SKU });
        doc.fontSize(9).font("Helvetica-Bold").fillColor(black)
          .text(String(item.quantity), ML + COL_DESC + COL_SKU, y + 8, { width: COL_QTY, align: "right" });
        doc.fontSize(9).font("Helvetica").fillColor(gray)
          .text(item.unit || "—", ML + COL_DESC + COL_SKU + COL_QTY + 4, y + 8, { width: COL_UNIT });
        const isFulfilled = item.status === "FULFILLED";
        const statusColor = isFulfilled ? "#15803d" : item.status === "CANCELLED" ? "#b91c1c" : "#b45309";
        doc.fontSize(8).font("Helvetica").fillColor(statusColor)
          .text(itemStatusLabel(item.status, (item as any).receivedAt, f), ML + COL_DESC + COL_SKU + COL_QTY + COL_UNIT, y + 8, { width: COL_STAT });

        if (hasNotes) {
          doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(gray)
            .text(`Obs.: ${receiptNotes}`, ML + 8, y + ROW_H + 2, { width: W - 16, ellipsis: true });
        }
        y += totalH;
      });
    }

    y += 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.5).stroke();
    y += 16;

    // ── FIRMAS ───────────────────────────────────────────────────────────────────
    ensureSpace(72);
    const sigW = W / 3;
    const sigH = 64;
    const sigDefs = [
      { label: "Solicitado por", name: requesterName },
      { label: "Aprobado por",   name: approverName  },
      { label: "Almacenes / Recibido por", name: receiverName },
    ];
    sigDefs.forEach(({ label, name }, i) => {
      const bx = ML + i * sigW;
      doc.roundedRect(bx, y, sigW, sigH, 0).fillColor(bgBox).fill();
      doc.roundedRect(bx, y, sigW, sigH, 0).strokeColor(border).lineWidth(0.5).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), bx + 10, y + 8, { width: sigW - 20, characterSpacing: 0.5 });
      if (name) {
        doc.fontSize(9).font("Helvetica-Bold").fillColor(black)
          .text(name, bx + 10, y + 22, { width: sigW - 20 });
      }
      doc.moveTo(bx + 10, y + 50).lineTo(bx + sigW - 10, y + 50).strokeColor("#aaaaaa").lineWidth(0.8).stroke();
    });
    y += sigH + 8;

    // ── FOOTER ────────────────────────────────────────────────────────────────────
    const footerY = PAGE_H - FOOTER_SIZE;
    doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch {}
    }
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text("Copilot Management System — Documento generado automáticamente. No requiere firma digital.", ML + 18, footerY, { width: W / 2 - 18 });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`${req.requestCode} · ${val(req.requestedForVesselCode)} · ${f(new Date())}`, ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
