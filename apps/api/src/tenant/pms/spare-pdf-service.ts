import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getTenantSpare } from "../spares/spares-service";
import { getOnHandQty, getReservedMapFromCalc } from "./stock-calc-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, renderLabeledTextBox, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-AR");
}

function val(v: string | null | undefined): string {
  return v?.trim() || "—";
}

const CRITICALITY_COLOR: Record<string, string> = {
  A: "#b91c1c", B: "#b45309", C: "#16a34a",
};

// Etiquetas de tipo de movimiento (mismas que la UI de Repuestos).
const MOVEMENT_LABEL: Record<string, string> = {
  RECEIPT: "Ingreso", ISSUE: "Egreso", ADJUSTMENT: "Ajuste", TRANSFER: "Transferencia",
  TRANSFER_IN: "Transf. entrada", TRANSFER_OUT: "Transf. salida",
  RETURN_IN: "Devolución", ADJUSTMENT_PLUS: "Ajuste +", ADJUSTMENT_MINUS: "Ajuste −",
};

// Signo del movimiento para mostrar la cantidad con + / − en el historial.
function signedQty(movementType: string, quantity: number): number {
  switch (movementType) {
    case "RECEIPT": case "TRANSFER_IN": case "RETURN_IN": case "ADJUSTMENT_PLUS":
      return Math.abs(quantity);
    case "ISSUE": case "TRANSFER_OUT": case "TRANSFER": case "ADJUSTMENT_MINUS":
      return -Math.abs(quantity);
    case "ADJUSTMENT":
      return quantity;
    default:
      return quantity;
  }
}

const PAGE_H      = 841.89;
const PAGE_W      = 595.28;
const CM          = 72 / 2.54;
const MARGIN_V    = Math.round(1.5 * CM);
const FOOTER_SIZE = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

interface SpareForPdf {
  id: string;
  tenantId: string;
  vesselCode: string;
  sku: string;
  name: string;
  category: string | null;
  criticality: string;
  status: string;
  manufacturer: string | null;
  model: string | null;
  unit: string;
  minStock: number;
  reorderPoint: number;
  targetStock: number | null;
  location: string | null;
  internalPartNumber: string | null;
  manufacturerPartNumber: string | null;
  longDescription: string | null;
  sfiCode: string | null;
  leadTimeDays: number | null;
  isEquivalent: boolean;
}

interface MovementRow {
  movementType: string;
  quantity: number;
  unit: string | null;
  occurredAt: Date;
  notes: string | null;
}

export async function buildSparePdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const spare = (await getTenantSpare(session, id)) as unknown as SpareForPdf;

  // Stock real desde el ledger de movimientos (la app ignora Spare.currentStock).
  let onHand = 0;
  let reserved = 0;
  let movements: MovementRow[] = [];
  let vesselName: string | null = null;
  let tenant: { logoUrl?: string | null; logoUrlLight?: string | null } | null = null;
  let tenantLogoBuffer: Buffer | null = null;

  const prisma = getPrismaClient();
  if (prisma) {
    try { onHand = await getOnHandQty(prisma as any, spare.id); } catch { /* non-blocking */ }
    try {
      const reservedMap = await getReservedMapFromCalc(prisma as any, spare.tenantId, [spare.id]);
      reserved = reservedMap.get(spare.id) ?? 0;
    } catch { /* non-blocking */ }
    try {
      movements = await (prisma as any).stockMovement.findMany({
        where: { spareId: spare.id },
        select: { movementType: true, quantity: true, unit: true, occurredAt: true, notes: true },
        orderBy: { occurredAt: "desc" },
        take: 200,
      });
    } catch { /* non-blocking */ }
    try {
      const vessel = await (prisma as any).vessel.findFirst({
        where: { tenantId: spare.tenantId, code: spare.vesselCode },
        select: { name: true },
      });
      vesselName = vessel?.name ?? null;
    } catch { /* non-blocking */ }
    try {
      const tenantRow = await (prisma as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { logoUrl: true, logoUrlLight: true } } },
      });
      tenant = tenantRow?.settings ?? null;
      tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, tenant?.logoUrl, tenant?.logoUrlLight);
    } catch { /* non-blocking */ }
  }
  const available = onHand - reserved;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: { Title: `${spare.sku}-${spare.vesselCode}` },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML     = 48;
    const MR     = 48;
    const W      = PAGE_W - ML - MR;
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
      } catch {}
    }

    const titleW = W - TENANT_LOGO_MAX_W - 16;
    doc.fontSize(22).font("Helvetica-Bold").fillColor(black)
      .text("FICHA DE REPUESTO", ML, y + 2, { width: titleW });
    doc.fontSize(13).font("Helvetica-Bold").fillColor(black)
      .text(sanitizePdfText(`${spare.sku}  ·  ${spare.name}`), ML, y + 30, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`Generado: ${new Date().toLocaleString("es-AR")}`, ML, y + 48, { width: titleW });

    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 14;

    // ── Compact labeled box (single-line value) ───────────────────────────────
    function labeledBox(bx: number, by: number, bw: number, bh: number, label: string, value: string, valueColor = black) {
      doc.roundedRect(bx, by, bw, bh, 4).fillColor(bgBox).fill();
      doc.roundedRect(bx, by, bw, bh, 4).strokeColor(border).lineWidth(1).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), bx + 10, by + 8, { width: bw - 20, characterSpacing: 0.5 });
      doc.fontSize(11).font("Helvetica-Bold").fillColor(valueColor)
        .text(sanitizePdfText(value), bx + 10, by + 20, { width: bw - 20, lineBreak: false, ellipsis: true });
    }

    function sectionTitle(text: string) {
      ensureSpace(28);
      doc.fontSize(11).font("Helvetica-Bold").fillColor(black).text(text, ML, y, { width: W });
      y += 20;
    }

    // ── Identidad del repuesto ─────────────────────────────────────────────────
    const half  = (W - 8) / 2;
    const third = (W - 16) / 3;

    labeledBox(ML,            y, half, 44, "Buque", vesselName ? `${vesselName} (${spare.vesselCode})` : spare.vesselCode);
    labeledBox(ML + half + 8, y, half, 44, "Categoría", val(spare.category));
    y += 58;

    labeledBox(ML,                   y, third, 44, "Criticidad", spare.criticality, CRITICALITY_COLOR[spare.criticality] ?? black);
    labeledBox(ML + third + 8,       y, third, 44, "Estado", spare.status, spare.status === "ACTIVE" ? "#166534" : gray);
    labeledBox(ML + (third + 8) * 2, y, third, 44, "Unidad", val(spare.unit));
    y += 58;

    labeledBox(ML,                   y, third, 44, "Fabricante", val(spare.manufacturer));
    labeledBox(ML + third + 8,       y, third, 44, "Modelo", val(spare.model));
    labeledBox(ML + (third + 8) * 2, y, third, 44, "Ubicación en bodega", val(spare.location));
    y += 58;

    labeledBox(ML,                   y, third, 44, "Código SFI", val(spare.sfiCode));
    labeledBox(ML + third + 8,       y, third, 44, "P/N Interno", val(spare.internalPartNumber));
    labeledBox(ML + (third + 8) * 2, y, third, 44, "P/N Fabricante", val(spare.manufacturerPartNumber));
    y += 58;

    labeledBox(ML,            y, half, 44, "Repuesto equivalente / no-OEM", spare.isEquivalent ? "Sí" : "No", spare.isEquivalent ? "#b45309" : gray);
    labeledBox(ML + half + 8, y, half, 44, "Lead time (días)", spare.leadTimeDays != null ? String(spare.leadTimeDays) : "—");
    y += 58;

    // ── Niveles de stock ───────────────────────────────────────────────────────
    sectionTitle("NIVELES DE STOCK");
    const stockCritical = onHand < spare.minStock;
    const stockWarn     = !stockCritical && onHand <= spare.reorderPoint;
    const stockColor    = stockCritical ? "#b91c1c" : stockWarn ? "#b45309" : "#166534";

    labeledBox(ML,                   y, third, 44, "Stock Actual", `${onHand} ${spare.unit}`, stockColor);
    labeledBox(ML + third + 8,       y, third, 44, "Disponible", `${available} ${spare.unit}`);
    labeledBox(ML + (third + 8) * 2, y, third, 44, "Reservado", `${reserved} ${spare.unit}`);
    y += 58;

    labeledBox(ML,                   y, third, 44, "Stock Mínimo", String(spare.minStock));
    labeledBox(ML + third + 8,       y, third, 44, "Punto de Reorden", String(spare.reorderPoint));
    labeledBox(ML + (third + 8) * 2, y, third, 44, "Stock Objetivo", spare.targetStock != null ? String(spare.targetStock) : "—");
    y += 58;

    // ── Descripción larga (free text, page-aware) ─────────────────────────────
    y = renderLabeledTextBox(doc, {
      label: "Descripción",
      text: sanitizePdfText(spare.longDescription ?? ""),
      x: ML,
      y,
      width: W,
      pageBottom: CONTENT_BOTTOM,
      pageTop: MARGIN_V,
      fontSize: 10,
      sectionGap: 14,
      onPageAdd: () => { y = MARGIN_V; },
    });

    // ── Historial de movimientos (table) ──────────────────────────────────────
    sectionTitle("HISTORIAL DE MOVIMIENTOS");

    const cols = [
      { label: "Fecha",    w: 70 },
      { label: "Tipo",     w: 88 },
      { label: "Cantidad", w: 62 },
      { label: "Notas",    w: W - 70 - 88 - 62 },
    ];
    const ROW_H     = 20;
    const HEADER_RH = 22;
    const CELL_PAD  = 6;

    function colX(index: number): number {
      let x = ML;
      for (let i = 0; i < index; i++) x += cols[i].w;
      return x;
    }

    function drawTableHeader() {
      doc.roundedRect(ML, y, W, HEADER_RH, 3).fillColor("#f1f5f9").fill();
      doc.roundedRect(ML, y, W, HEADER_RH, 3).strokeColor(border).lineWidth(1).stroke();
      cols.forEach((c, i) => {
        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
          .text(c.label.toUpperCase(), colX(i) + CELL_PAD, y + 7, { width: c.w - CELL_PAD * 2, characterSpacing: 0.3, lineBreak: false, ellipsis: true });
      });
      y += HEADER_RH;
    }

    if (movements.length === 0) {
      ensureSpace(HEADER_RH + ROW_H);
      drawTableHeader();
      doc.roundedRect(ML, y, W, ROW_H, 3).strokeColor(border).lineWidth(1).stroke();
      doc.fontSize(9).font("Helvetica").fillColor(gray)
        .text("Este repuesto aún no tiene movimientos de stock.", ML + CELL_PAD, y + 6, { width: W - CELL_PAD * 2, ellipsis: true });
      y += ROW_H;
    } else {
      ensureSpace(HEADER_RH + ROW_H);
      drawTableHeader();
      movements.forEach((m, idx) => {
        if (y + ROW_H > CONTENT_BOTTOM) {
          doc.addPage();
          y = MARGIN_V;
          drawTableHeader();
        }
        if (idx % 2 === 1) doc.rect(ML, y, W, ROW_H).fillColor("#f8fafc").fill();
        doc.rect(ML, y, W, ROW_H).strokeColor(border).lineWidth(0.5).stroke();

        const signed = signedQty(m.movementType, m.quantity);
        const qtyText = `${signed > 0 ? "+" : ""}${signed} ${m.unit ?? spare.unit}`;
        const qtyColor = signed > 0 ? "#166534" : signed < 0 ? "#b91c1c" : black;
        const cells: { text: string; color: string; bold?: boolean }[] = [
          { text: fmt(m.occurredAt), color: gray },
          { text: MOVEMENT_LABEL[m.movementType] ?? m.movementType, color: black },
          { text: qtyText, color: qtyColor, bold: true },
          { text: val(m.notes), color: "#334155" },
        ];
        cells.forEach((cell, i) => {
          doc.fontSize(8).font(cell.bold ? "Helvetica-Bold" : "Helvetica").fillColor(cell.color)
            .text(sanitizePdfText(cell.text), colX(i) + CELL_PAD, y + 6, { width: cols[i].w - CELL_PAD * 2, lineBreak: false, ellipsis: true });
        });
        y += ROW_H;
      });
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
      .text(`${spare.sku} · ${spare.vesselCode} · ${fmt(new Date())}`, ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
