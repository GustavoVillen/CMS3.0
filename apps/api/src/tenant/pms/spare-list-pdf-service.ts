// PDF de la lista de Repuestos & Stock: lo que el usuario está viendo en
// pantalla, con sus filtros ya aplicados, en papel.
//
// No reemplaza al Inventario mensual (spare-inventory-pdf-service): ese es el
// reporte formal de un buque, con contexto del parte diario y queda asentado en
// el historial de reportes. Este es la impresión de la pantalla — sirve para
// llevar la lista al pañol o adjuntarla a un pedido.
//
// Por eso recibe los IDS que la pantalla tiene a la vista: los filtros de texto,
// categoría y semáforo de stock son del navegador, y si el backend volviera a
// filtrar por su cuenta el papel no coincidiría con la pantalla.
import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { getOnHandMap } from "./stock-calc-service";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";

// A4 apaisado: la tabla tiene 9 columnas y en vertical no entran.
const PAGE_W_LANDSCAPE = 841.89;
const PAGE_H_LANDSCAPE = 595.28;
const MARGIN_V = 40;
const FOOTER_SIZE = 30;
const CONTENT_BOTTOM = PAGE_H_LANDSCAPE - FOOTER_SIZE - MARGIN_V;

/** Tope defensivo: un tenant grande tiene miles de repuestos. */
const MAX_ROWS = 3000;

export interface SpareListPdfInput {
  /** Ids en el orden en que se ven en pantalla. */
  ids: string[];
  /** Texto del filtro activo, para dejar asentado de qué es esta lista. */
  filterLabel?: string | null;
}

export async function buildSpareListPdf(
  session: TenantAccessSession,
  input: SpareListPdfInput,
): Promise<Buffer> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const ids = Array.isArray(input.ids) ? input.ids.filter(i => typeof i === "string").slice(0, MAX_ROWS) : [];
  if (ids.length === 0) throw new RouteError(400, "VALIDATION_ERROR", "No hay repuestos para imprimir.");

  const tenant = await prisma.tenant.findUnique({
    where: { slug: session.tenantSlug },
    select: { id: true, settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
  });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  // Scope: el listado sólo puede traer repuestos del tenant y de los buques
  // asignados. Un id de otro tenant simplemente no aparece.
  const where: Record<string, unknown> = { id: { in: ids }, tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN") {
    where.vesselCode = { in: session.user.assignedVesselCodes.length ? session.user.assignedVesselCodes : ["__NO_MATCH__"] };
  }
  const spares = await prisma.spare.findMany({
    where: where as never,
    select: {
      id: true, sku: true, name: true, vesselCode: true, category: true, criticality: true,
      unit: true, minStock: true, reorderPoint: true, status: true,
    },
  });
  if (spares.length === 0) throw new RouteError(404, "NOT_FOUND", "No hay repuestos para imprimir.");

  const onHandMap = await getOnHandMap(prisma, spares.map(s => s.id));
  // Se respeta el orden de la pantalla.
  const order = new Map(ids.map((id, i) => [id, i]));
  const rows = spares
    .map(s => ({ ...s, onHand: onHandMap.get(s.id) ?? 0 }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  // Nombres de buque: en el papel va el nombre, no el código.
  const vessels = await prisma.vessel.findMany({
    where: { tenantId: tenant.id, code: { in: Array.from(new Set(rows.map(r => r.vesselCode))) } },
    select: { code: true, name: true },
  });
  const vesselName = new Map(vessels.map(v => [v.code, v.name]));

  const tenantName = tenant.settings?.displayName ?? null;
  let tenantLogoBuffer: Buffer | null = null;
  try {
    tenantLogoBuffer = await resolveTenantLogo(
      session.tenantSlug,
      tenant.settings?.logoUrl ?? null,
      tenant.settings?.logoUrlLight ?? null,
    );
  } catch { /* non-blocking */ }

  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmt = (d: Date) => fmtDateTz(d, tz, locale);
  const fmtDateTime = (d: Date) => fmtDateTimeTz(d, tz, locale);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 0,
      bufferPages: true,
      info: { Title: `Repuestos y stock — ${tenantName ?? session.tenantSlug}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML = 36, W = PAGE_W_LANDSCAPE - ML * 2;
    const black = "#0f172a", gray = "#64748b", border = "#e2e8f0", bgBox = "#f8fafc";
    const red = "#dc2626", amber = "#d97706", green = "#16a34a";
    let y = MARGIN_V;

    doc.on("pageAdded", () => { (doc as unknown as { y: number }).y = MARGIN_V; y = MARGIN_V; });

    // ── Header ───────────────────────────────────────────────────────────────
    const HEADER_H = 52, LOGO_W = 80;
    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, ML + W - LOGO_W, y, { fit: [LOGO_W, HEADER_H], align: "right", valign: "center" }); }
      catch { /* logo unavailable */ }
    }
    const titleW = W - LOGO_W - 16;
    doc.fontSize(16).font("Helvetica-Bold").fillColor(black)
      .text("REPUESTOS Y STOCK", ML, y + 2, { width: titleW });
    doc.fontSize(9).font("Helvetica").fillColor(gray)
      .text(sanitizePdfText(input.filterLabel ? `${input.filterLabel} · ${rows.length} repuestos` : `${rows.length} repuestos`), ML, y + 24, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`${tenantName ?? session.tenantSlug} · Generado: ${fmtDateTime(new Date())}`, ML, y + 38, { width: titleW });
    y += HEADER_H + 6;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 10;

    // ── Tabla ────────────────────────────────────────────────────────────────
    // Mismas columnas que la pantalla.
    const COLS = [78, W - 78 - 92 - 76 - 40 - 54 - 44 - 46 - 48, 92, 76, 40, 54, 44, 46, 48];
    const HEAD = ["SKU", "Nombre", "Buque", "Categoría", "Crit.", "Stock", "Mínimo", "Reorden", "Estado"];
    const ALIGN_RIGHT = new Set([5, 6, 7]);

    const drawHead = () => {
      doc.roundedRect(ML, y, W, 16, 3).fillColor(bgBox).fill();
      let x = ML + 5;
      HEAD.forEach((h, i) => {
        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
          .text(h, x, y + 5, { width: COLS[i]! - 5, align: ALIGN_RIGHT.has(i) ? "right" : "left" });
        x += COLS[i]!;
      });
      y += 18;
    };

    drawHead();
    for (const r of rows) {
      // Semáforo de stock: mismo criterio que la pantalla (rojo bajo el mínimo,
      // ámbar en el punto de reorden).
      const stockColor = r.onHand < r.minStock ? red : r.onHand <= r.reorderPoint ? amber : green;
      const cells = [
        sanitizePdfText(r.sku),
        sanitizePdfText(r.name),
        sanitizePdfText(vesselName.get(r.vesselCode) ?? r.vesselCode),
        sanitizePdfText(r.category ?? "—"),
        r.criticality,
        `${trimNum(r.onHand)} ${r.unit}`,
        trimNum(r.minStock),
        trimNum(r.reorderPoint),
        r.status === "ACTIVE" ? "Activo" : "Obsoleto",
      ];
      const rowH = Math.max(14, ...cells.map((c, i) => {
        doc.fontSize(i === 0 ? 7 : 7.5).font(i === 0 ? "Helvetica-Bold" : "Helvetica");
        return doc.heightOfString(String(c), { width: COLS[i]! - 5 }) + 6;
      }));
      if (y + rowH > CONTENT_BOTTOM) { doc.addPage(); drawHead(); }

      // Criticidad con el mismo color que el badge de la pantalla.
      const critColor = r.criticality === "A" ? red : r.criticality === "B" ? amber : gray;
      let x = ML + 5;
      cells.forEach((c, i) => {
        doc.fontSize(i === 0 ? 7 : 7.5)
          .font(i === 0 || i === 4 || i === 5 ? "Helvetica-Bold" : "Helvetica")
          .fillColor(i === 5 ? stockColor : i === 4 ? critColor : i === 2 || i === 3 ? gray : black)
          .text(String(c), x, y + 3, { width: COLS[i]! - 5, align: ALIGN_RIGHT.has(i) ? "right" : "left" });
        x += COLS[i]!;
      });
      y += rowH;
      doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.4).stroke();
      y += 1.5;
    }

    // ── Pie en todas las páginas ─────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    const footerY = PAGE_H_LANDSCAPE - FOOTER_SIZE;
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
      if (existsSync(LOGO_PATH)) {
        try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* logo missing */ }
      }
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text("Copilot Management System — Repuestos y stock", ML + 18, footerY, { width: W / 2 });
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text(`${tenantName ?? session.tenantSlug} · ${fmt(new Date())} · Página ${i - range.start + 1} de ${range.count}`, ML, footerY, { width: W, align: "right" });
    }

    doc.end();
  });
}

/** 3 en vez de 3.0000000001, pero 2.5 se mantiene. */
function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
