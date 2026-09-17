// Formulario "Solicitud de repuestos": lo que el buque le manda al departamento
// de Compras (va adjunto al correo de "Enviar a Compras"). Aprobado en Preview V4
// (claude/mockups/inventario-formularios). Sin aprobación ni recepción: lo que
// llega entra por Recepción con remito.

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getSpareRequest } from "../spare-requests/spare-requests-service";
import { listRequestItems } from "../spare-requests/spare-request-items-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, renderLabeledTextBox, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";
import { fmtDate as fmtDateTz } from "../../common/tenant-time";

const PW       = 595.28;
const PAGE_H   = 841.89;
const ML       = 36;
const W        = PW - ML * 2;
const MARGIN_T = 36;
const FOOTER_H = 30;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 10;

const NAVY  = "#0C2461";
const WHITE = "#FFFFFF";
const BLACK = "#111111";
const GRAY  = "#6B7280";
const LINE  = "#555555";
const LABEL_BG = "#F2F2F2";

const PRIORITY: Record<string, { label: string; color: string }> = {
  LOW: { label: "BAJA", color: BLACK },
  MEDIUM: { label: "MEDIA", color: BLACK },
  HIGH: { label: "ALTA", color: "#B45309" },
  CRITICAL: { label: "CRÍTICA", color: "#B91C1C" },
};

const STATUS: Record<string, string> = {
  DRAFT: "BORRADOR", SUBMITTED: "ENVIADA A COMPRAS", CANCELLED: "ANULADA",
  APPROVED: "APROBADA", REJECTED: "RECHAZADA", PARTIALLY_FULFILLED: "PARCIALMENTE ENTREGADA", FULFILLED: "ENTREGADA",
};

/** "04 UN", "20 L" — como se escribe en los formularios de papel. */
function fmtQty(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? String(qty).padStart(2, "0") : String(qty);
  const u = unit.trim().toLowerCase();
  return `${n} ${u === "ud" || u === "u" || u === "unidad" || u === "unidades" ? "UN" : unit.trim().toUpperCase()}`;
}

/**
 * `forSending`: el PDF se arma ANTES de pasar a Enviada (el correo tiene que salir
 * primero), así que el adjunto ya se rotula como enviado.
 */
export async function buildSpareRequestPdf(session: TenantAccessSession, id: string, opts: { forSending?: boolean } = {}): Promise<Buffer> {
  const req = await getSpareRequest(session, id);
  if (!req) throw new Error("Solicitud no encontrada.");
  const items = await listRequestItems(session, id);

  let tenantTz = "UTC";
  let tenantLocale = "es-AR";
  let tenantName = session.tenantSlug;
  let tenantLogoBuffer: Buffer | null = null;
  let vesselName = req.requestedForVesselCode ?? "—";
  const prisma = getPrismaClient();
  if (prisma) {
    const tenantRow = await (prisma as any).tenant.findUnique({
      where: { slug: session.tenantSlug },
      select: { id: true, settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true, timezone: true, defaultLocale: true } } },
    });
    const ts = tenantRow?.settings;
    if (ts?.displayName) tenantName = ts.displayName;
    if (ts?.timezone) tenantTz = ts.timezone;
    if (ts?.defaultLocale) tenantLocale = ts.defaultLocale === "en" ? "en-GB" : ts.defaultLocale === "pt" ? "pt-BR" : "es-AR";
    tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, ts?.logoUrl, ts?.logoUrlLight);
    // Nombre del buque, nunca el código.
    if (tenantRow?.id && req.requestedForVesselCode) {
      const v = await (prisma as any).vessel.findFirst({ where: { tenantId: tenantRow.id, code: req.requestedForVesselCode }, select: { name: true } });
      if (v?.name) vesselName = v.name;
    }
  }
  const f = (d: Date | string | null | undefined) => fmtDateTz(d, tenantTz, tenantLocale);
  const requestedBy = req.requestedByName ?? "—";
  const status = opts.forSending ? "SUBMITTED" : req.status;

  return new Promise((resolve, reject) => {
    // bufferPages: el pie (con "Página N de M") se dibuja al final en todas las hojas,
    // también en las que agrega renderLabeledTextBox por su cuenta.
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: req.requestCode } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = MARGIN_T;

    function cell(cx: number, cy: number, cw: number, ch: number, text: string, opts: {
      bold?: boolean; fontSize?: number; align?: "left" | "center" | "right"; bg?: string; color?: string; font?: string;
    } = {}) {
      if (opts.bg) doc.rect(cx, cy, cw, ch).fillColor(opts.bg).fill();
      doc.rect(cx, cy, cw, ch).strokeColor(LINE).lineWidth(0.5).stroke();
      if (!text) return;
      const fs = opts.fontSize ?? 8.5;
      doc.fontSize(fs).font(opts.font ?? (opts.bold ? "Helvetica-Bold" : "Helvetica"));
      const h = doc.heightOfString(text, { width: cw - 8, align: opts.align ?? "left" });
      doc.fillColor(opts.color ?? BLACK).text(text, cx + 4, cy + Math.max(2.5, (ch - h) / 2), { width: cw - 8, align: opts.align ?? "left" });
    }

    function drawFooter(page: number, total: number) {
      const fy = PAGE_H - FOOTER_H;
      doc.moveTo(ML, fy).lineTo(ML + W, fy).strokeColor(LINE).lineWidth(0.5).stroke();
      let tx = ML;
      if (existsSync(LOGO_PATH)) { try { doc.image(LOGO_PATH, ML, fy + 6, { width: 12, height: 12 }); tx = ML + 16; } catch {} }
      doc.fontSize(7).font("Helvetica").fillColor(GRAY)
        .text(sanitizePdfText(`${tenantName} — Solicitud de repuestos`), tx, fy + 9, { width: W / 2, lineBreak: false });
      doc.text(sanitizePdfText(`${req!.requestCode} · ${vesselName} · Página ${page} de ${total}`), ML, fy + 9, { width: W, align: "right", lineBreak: false });
    }

    function newPage() {
      doc.addPage();
      y = MARGIN_T;
    }

    function ensureSpace(h: number, onNewPage?: () => void) {
      if (y + h > CONTENT_BOTTOM) { newPage(); onNewPage?.(); }
    }

    // ── Encabezado ───────────────────────────────────────────────────────────
    const HDR_H = 60;
    const LOGO_W = 110;
    const META_W = 150;
    const CTR_W = W - LOGO_W - META_W;
    doc.rect(ML, y, W, HDR_H).strokeColor(LINE).lineWidth(0.6).stroke();
    doc.rect(ML, y, LOGO_W, HDR_H).strokeColor(LINE).lineWidth(0.5).stroke();
    const logo = tenantLogoBuffer ?? (existsSync(LOGO_PATH) ? LOGO_PATH : null);
    if (logo) {
      try { doc.image(logo, ML + 6, y + 6, { fit: [LOGO_W - 12, HDR_H - 12], align: "center", valign: "center" }); } catch {}
    }
    doc.rect(ML + LOGO_W, y, CTR_W, HDR_H).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.fontSize(14).font("Times-Bold").fillColor(NAVY)
      .text("SOLICITUD DE REPUESTOS", ML + LOGO_W, y + 14, { width: CTR_W, align: "center" });
    doc.fontSize(9).font("Helvetica").fillColor(BLACK)
      .text("Buque a Departamento de Compras", ML + LOGO_W, y + 36, { width: CTR_W, align: "center" });
    const mx = ML + LOGO_W + CTR_W;
    cell(mx, y, META_W, HDR_H / 3, sanitizePdfText(`N° ${req.requestCode}`), { bold: true, fontSize: 8.5 });
    cell(mx, y + HDR_H / 3, META_W, HDR_H / 3, sanitizePdfText(`Fecha ${f(req.requestedAt)}`), { fontSize: 8.5 });
    cell(mx, y + (2 * HDR_H) / 3, META_W, HDR_H / 3, STATUS[status] ?? status, {
      bold: true, fontSize: 7.5, color: status === "CANCELLED" ? "#B91C1C" : NAVY,
    });
    y += HDR_H + 10;

    // ── Datos ────────────────────────────────────────────────────────────────
    const ROW = 18;
    const LBL = W * 0.18;
    const prio = PRIORITY[req.priority] ?? { label: req.priority, color: BLACK };
    cell(ML, y, LBL, ROW, "BUQUE", { bold: true, fontSize: 8, bg: LABEL_BG });
    cell(ML + LBL, y, W / 2 - LBL, ROW, sanitizePdfText(vesselName.toUpperCase()), { bold: true });
    cell(ML + W / 2, y, LBL, ROW, "PRIORIDAD", { bold: true, fontSize: 8, bg: LABEL_BG });
    cell(ML + W / 2 + LBL, y, W / 2 - LBL, ROW, sanitizePdfText(prio.label), { bold: true, color: prio.color });
    y += ROW;
    cell(ML, y, LBL, ROW, "PEDIDO POR", { bold: true, fontSize: 8, bg: LABEL_BG });
    cell(ML + LBL, y, W - LBL, ROW, sanitizePdfText(requestedBy));
    y += ROW + 10;

    // ── Ítems ────────────────────────────────────────────────────────────────
    const cols = [W * 0.05, W * 0.3, W * 0.16, W * 0.27, W * 0.09, W * 0.13];
    const colX = (i: number) => ML + cols.slice(0, i).reduce((a, b) => a + b, 0);
    const itemHeader = () => {
      ["#", "REPUESTO", "N° DE PARTE", "PARA QUÉ (EQUIPO)", "A BORDO", "CANTIDAD"].forEach((h, i) =>
        cell(colX(i), y, cols[i]!, 16, sanitizePdfText(h), { bold: true, fontSize: 7.5, bg: LABEL_BG, align: "center" }));
      y += 16;
    };
    ensureSpace(18 + 16 + 16);
    cell(ML, y, W, 18, "REPUESTOS SOLICITADOS", { bold: true, fontSize: 8.5, bg: NAVY, color: WHITE, align: "center" });
    y += 18;
    itemHeader();

    if (items.length === 0) {
      cell(ML, y, W, 18, "Sin ítems cargados.", { color: GRAY, align: "center" });
      y += 18;
    }
    items.forEach((it, idx) => {
      const texts = [
        String(idx + 1),
        sanitizePdfText(it.itemLabel.toUpperCase()),
        sanitizePdfText(it.partNumber ?? ""),
        sanitizePdfText((it.equipment ?? "").toUpperCase()),
        it.onHand == null ? "—" : String(it.onHand),
        sanitizePdfText(fmtQty(it.quantity, it.unit)),
      ];
      doc.fontSize(8).font("Helvetica");
      const rowH = Math.max(16, ...texts.map((t, i) => doc.heightOfString(t, { width: cols[i]! - 8 }) + 6));
      ensureSpace(rowH, itemHeader);
      texts.forEach((t, i) => cell(colX(i), y, cols[i]!, rowH, t, {
        fontSize: 8, bold: i === 5, align: i === 0 || i >= 4 ? "center" : "left",
      }));
      y += rowH;
      if (it.notes) {
        const note = sanitizePdfText(`Obs.: ${it.notes}`);
        doc.fontSize(7.5).font("Helvetica-Oblique");
        const nh = doc.heightOfString(note, { width: W - cols[0]! - 8 }) + 5;
        ensureSpace(nh, itemHeader);
        cell(colX(0), y, cols[0]!, nh, "");
        doc.rect(colX(1), y, W - cols[0]!, nh).strokeColor(LINE).lineWidth(0.5).stroke();
        doc.fillColor(GRAY).text(note, colX(1) + 4, y + 2.5, { width: W - cols[0]! - 8 });
        y += nh;
      }
    });
    y += 10;

    // ── Motivo (texto libre: puede ocupar más de una página) ─────────────────
    y = renderLabeledTextBox(doc, {
      label: "MOTIVO / JUSTIFICACIÓN", text: req.notes ?? "—",
      x: ML, y, width: W, pageBottom: CONTENT_BOTTOM, pageTop: MARGIN_T,
      fontSize: 9, bg: "#FFFFFF", border: LINE, cornerRadius: 0, sectionGap: 10,
    });
    if (req.status === "CANCELLED" && req.rejectionReason) {
      y = renderLabeledTextBox(doc, {
        label: "ANULADA — MOTIVO", text: req.rejectionReason,
        x: ML, y, width: W, pageBottom: CONTENT_BOTTOM, pageTop: MARGIN_T,
        fontSize: 9, labelColor: "#B91C1C", bg: "#FEF2F2", border: "#FCA5A5", cornerRadius: 0, sectionGap: 10,
      });
    }
    if (req.sentAt) {
      ensureSpace(14);
      doc.fontSize(7.5).font("Helvetica").fillColor(GRAY)
        .text(sanitizePdfText(`Enviada a Compras${req.sentTo ? ` (${req.sentTo})` : ""} el ${f(req.sentAt)}${req.sentByName ? ` por ${req.sentByName}` : ""}.`), ML, y, { width: W });
      y += 14;
    }

    // ── Firmas ───────────────────────────────────────────────────────────────
    const SIG_H = 58;
    ensureSpace(SIG_H + 8);
    y += 8;
    [["FIRMA JEFE DE MÁQUINAS / CAPITÁN", requestedBy], ["RECIBIDO COMPRAS (firma y fecha)", ""]].forEach(([label, name], i) => {
      const bx = ML + i * (W / 2);
      doc.rect(bx, y, W / 2, SIG_H).strokeColor(LINE).lineWidth(0.5).stroke();
      if (name) {
        doc.fontSize(8.5).font("Helvetica-Bold").fillColor(BLACK)
          .text(sanitizePdfText(name!), bx + 4, y + 8, { width: W / 2 - 8, align: "center" });
      }
      doc.moveTo(bx + 20, y + SIG_H - 18).lineTo(bx + W / 2 - 20, y + SIG_H - 18).strokeColor("#999999").lineWidth(0.6).stroke();
      doc.fontSize(7.5).font("Helvetica").fillColor(BLACK)
        .text(sanitizePdfText(label!), bx + 4, y + SIG_H - 13, { width: W / 2 - 8, align: "center" });
    });
    y += SIG_H;

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawFooter(i + 1, range.count);
    }
    doc.end();
  });
}
