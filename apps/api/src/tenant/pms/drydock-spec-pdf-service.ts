// PDF de la Especificación de Varada — el documento que se manda al astillero.
//
// Estructura: encabezado con el NOMBRE del buque (nunca el código), datos de la
// varada, alcance general, y la lista de trabajos agrupada por rubro. Salen los
// ítems ACEPTADOS por tierra; si la spec todavía no está aprobada se agrega el
// anexo de ítems propuestos y descartados, para que el borrador sirva de
// documento de trabajo.
//
// Regla obligatoria (skill pms-pdf-generation): todo texto libre va por
// renderLabeledTextBox — nunca roundedRect + doc.text.

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getDrydockSpecFull } from "./drydock-specs-service";
import { LOGO_PATH, resolveTenantLogo, renderLabeledTextBox, sanitizePdfText } from "./pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";

const PAGE_H      = 841.89;
const PAGE_W      = 595.28;
const CM          = 72 / 2.54;
const MARGIN_V    = Math.round(1.5 * CM);
const FOOTER_SIZE = 40;

const STATUS_LABEL: Record<string, string> = {
  DRAFT:        "Borrador",
  SUBMITTED:    "Enviada a tierra",
  UNDER_REVIEW: "En revisión",
  APPROVED:     "Aprobada",
  REJECTED:     "Devuelta al buque",
  CANCELLED:    "Anulada",
};

const CATEGORY_LABEL: Record<string, string> = {
  HULL_STRUCTURE:  "Casco y estructura",
  MACHINERY:       "Máquinas",
  ELECTRICAL:      "Eléctrico",
  PIPING_VALVES:   "Cañerías y válvulas",
  TANKS:           "Tanques",
  SAFETY_EQUIPMENT: "Equipos de seguridad",
  CLASS_STATUTORY: "Clase y estatutario",
  PAINTING:        "Pintura",
  OTHER:           "Otros",
};

// Orden de rubros en el papel: casco primero, "otros" al final.
const CATEGORY_ORDER = [
  "HULL_STRUCTURE", "MACHINERY", "ELECTRICAL", "PIPING_VALVES", "TANKS",
  "SAFETY_EQUIPMENT", "CLASS_STATUTORY", "PAINTING", "OTHER",
];

const PRIORITY_LABEL: Record<string, string> = {
  LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica",
};

const SOURCE_LABEL: Record<string, string> = {
  MANUAL:     "Manual",
  DEFERRAL:   "Diferimiento",
  DEFECT:     "Defecto",
  WORK_ORDER: "Orden de trabajo",
};

function val(v: string | null | undefined): string {
  return v?.trim() || "—";
}

export async function buildDrydockSpecPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);

  const spec = await getDrydockSpecFull(session, id);

  // Logo del tenant (nunca por fetch HTTP: prohibido por SSRF).
  const prismaRaw = getPrismaClient();
  let tenantName = session.tenantSlug.toUpperCase();
  let tenantLogoBuffer: Buffer | null = null;
  if (prismaRaw) {
    try {
      const tenantRow = await prismaRaw.tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      if (tenantRow?.settings?.displayName) tenantName = tenantRow.settings.displayName;
      tenantLogoBuffer = await resolveTenantLogo(
        session.tenantSlug,
        tenantRow?.settings?.logoUrl,
        tenantRow?.settings?.logoUrlLight,
      );
    } catch { /* non-blocking */ }
  }

  const accepted = spec.items.filter(i => i.itemStatus === "ACCEPTED");
  const pending  = spec.items.filter(i => i.itemStatus === "PROPOSED");
  const rejected = spec.items.filter(i => i.itemStatus === "REJECTED");

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: spec.specCode } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML = 48;
    const MR = 48;
    const W  = PAGE_W - ML - MR;

    const black     = "#0f172a";
    const navy      = "#1e3a5f";
    const gray      = "#64748b";
    const lightGray = "#94a3b8";
    const border    = "#e2e8f0";
    const bgBox     = "#f8fafc";
    const accentBg  = "#eff6ff";
    const headerBg  = "#e2e8f0";

    const contentBottom = PAGE_H - FOOTER_SIZE - MARGIN_V;

    let y = MARGIN_V;
    doc.on("pageAdded", () => { (doc as unknown as { y: number }).y = MARGIN_V; y = MARGIN_V; });

    function ensureSpace(needed: number) {
      if (y + needed > contentBottom) { doc.addPage(); y = MARGIN_V; }
    }

    // Caja de una sola línea (estado, fechas, badges) — permitido por la skill.
    function labeledBox(x: number, yy: number, w: number, h: number, label: string, content: string, color = black, bg = bgBox) {
      doc.roundedRect(x, yy, w, h, 6).fill(bg).stroke(border);
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(sanitizePdfText(label.toUpperCase()), x + 8, yy + 7, { width: w - 16 });
      doc.fontSize(10).font("Helvetica-Bold").fillColor(color)
        .text(sanitizePdfText(content), x + 8, yy + 21, { width: w - 16, lineBreak: false, ellipsis: true });
    }

    function sectionTitle(text: string) {
      ensureSpace(26);
      doc.fontSize(9).font("Helvetica-Bold").fillColor(navy)
        .text(sanitizePdfText(text.toUpperCase()), ML, y, { width: W });
      y += 13;
      doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.5).stroke();
      y += 8;
    }

    function textBlock(label: string, content: string) {
      y = renderLabeledTextBox(doc, {
        label, text: content, x: ML, y, width: W,
        pageBottom: contentBottom, pageTop: MARGIN_V,
        bg: bgBox, border, labelColor: gray,
        textColor: content && content !== "—" ? black : lightGray,
        cornerRadius: 6, sectionGap: 6,
      });
    }

    // ── Tabla de ítems ───────────────────────────────────────────────────────
    // Columnas: Nº · Trabajo (título + descripción) · Equipo · Prioridad · Origen.
    const COL_NO    = 28;
    const COL_ASSET = 96;
    const COL_PRIO  = 52;
    const COL_SRC   = 68;
    const COL_WORK  = W - COL_NO - COL_ASSET - COL_PRIO - COL_SRC;

    function tableHeader() {
      const h = 18;
      ensureSpace(h + 20);
      doc.rect(ML, y, W, h).fill(headerBg);
      const cells: Array<[string, number, number]> = [
        ["N°", ML, COL_NO],
        ["Trabajo", ML + COL_NO, COL_WORK],
        ["Equipo", ML + COL_NO + COL_WORK, COL_ASSET],
        ["Prioridad", ML + COL_NO + COL_WORK + COL_ASSET, COL_PRIO],
        ["Origen", ML + COL_NO + COL_WORK + COL_ASSET + COL_PRIO, COL_SRC],
      ];
      doc.fontSize(7.5).font("Helvetica-Bold").fillColor(navy);
      for (const [label, x, w] of cells) {
        doc.text(sanitizePdfText(label.toUpperCase()), x + 4, y + 5.5, { width: w - 8, lineBreak: false, ellipsis: true });
      }
      y += h;
    }

    const ROW_PAD = 5;

    /** Alto que va a ocupar la fila. Se mide antes de dibujar nada. */
    function measureRow(item: (typeof spec.items)[number]) {
      const title = sanitizePdfText(item.title || "—");
      const desc  = sanitizePdfText(item.description || "");
      doc.fontSize(8).font("Helvetica-Bold");
      const titleH = doc.heightOfString(title, { width: COL_WORK - 8 });
      doc.fontSize(7.5).font("Helvetica");
      const descH = desc ? doc.heightOfString(desc, { width: COL_WORK - 8 }) : 0;
      // El sello "REQUISITO DE CLASE" ocupa su propio renglón: si no se suma acá,
      // se dibuja encima de la descripción en las filas cortas.
      const classH = item.classRelated ? 11 : 0;
      const rowH = Math.max(22, titleH + (descH ? descH + 2 : 0) + classH + ROW_PAD * 2);
      return { title, desc, titleH, descH, rowH };
    }

    function tableRow(item: (typeof spec.items)[number]) {
      const { title, desc, titleH, descH, rowH } = measureRow(item);
      const pad = ROW_PAD;

      // Fila entera a página nueva: nunca se parte una línea de trabajo.
      if (y + rowH > contentBottom) { doc.addPage(); y = MARGIN_V; tableHeader(); }

      doc.rect(ML, y, W, rowH).strokeColor(border).lineWidth(0.5).stroke();

      doc.fontSize(8).font("Helvetica-Bold").fillColor(black)
        .text(String(item.itemNo), ML + 4, y + pad, { width: COL_NO - 8 });

      let ty = y + pad;
      doc.fontSize(8).font("Helvetica-Bold").fillColor(black)
        .text(title, ML + COL_NO + 4, ty, { width: COL_WORK - 8 });
      ty += titleH;
      if (desc) {
        doc.fontSize(7.5).font("Helvetica").fillColor(gray)
          .text(desc, ML + COL_NO + 4, ty + 2, { width: COL_WORK - 8 });
        ty += descH + 2;
      }
      // Marca de requisito de clase: renglón propio, debajo del texto.
      if (item.classRelated) {
        doc.fontSize(6.5).font("Helvetica-Bold").fillColor("#b91c1c")
          .text("REQUISITO DE CLASE", ML + COL_NO + 4, ty + 2, { width: COL_WORK - 8, lineBreak: false });
      }

      doc.fontSize(7.5).font("Helvetica").fillColor(black)
        .text(sanitizePdfText(item.assetName ?? "—"), ML + COL_NO + COL_WORK + 4, y + pad, { width: COL_ASSET - 8 });
      doc.fontSize(7.5).font("Helvetica").fillColor(item.priority === "CRITICAL" || item.priority === "HIGH" ? "#b45309" : black)
        .text(item.priority ? (PRIORITY_LABEL[item.priority] ?? item.priority) : "—",
          ML + COL_NO + COL_WORK + COL_ASSET + 4, y + pad, { width: COL_PRIO - 8 });
      doc.fontSize(7).font("Helvetica").fillColor(gray)
        .text(SOURCE_LABEL[item.sourceType] ?? item.sourceType,
          ML + COL_NO + COL_WORK + COL_ASSET + COL_PRIO + 4, y + pad, { width: COL_SRC - 8 });

      y += rowH;
    }

    function itemsTable(items: typeof spec.items) {
      const byCategory = new Map<string, typeof spec.items>();
      for (const item of items) {
        const list = byCategory.get(item.category) ?? [];
        list.push(item);
        byCategory.set(item.category, list);
      }
      for (const category of CATEGORY_ORDER) {
        const list = byCategory.get(category);
        if (!list || list.length === 0) continue;
        // Título del rubro + encabezado + la PRIMERA fila entera: si no entra
        // todo eso, el rubro arranca en la página siguiente. Sin medir la fila
        // quedaba el encabezado solo al pie y repetido arriba. El tope evita el
        // caso patológico de una fila más alta que una página entera.
        const usable = contentBottom - MARGIN_V - 30;
        ensureSpace(12 + 18 + Math.min(measureRow(list[0]!).rowH, usable));
        doc.fontSize(8).font("Helvetica-Bold").fillColor("#0369a1")
          .text(sanitizePdfText(`${CATEGORY_LABEL[category] ?? category} (${list.length})`), ML, y, { width: W });
        y += 12;
        tableHeader();
        for (const item of list) tableRow(item);
        y += 10;
      }
    }

    // ── Header ───────────────────────────────────────────────────────────────
    const HEADER_H = 64;
    const LOGO_MAX_W = 90;
    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, ML + W - LOGO_MAX_W, y, { fit: [LOGO_MAX_W, HEADER_H], align: "right", valign: "center" }); } catch { /* non-blocking */ }
    }
    const titleW = W - LOGO_MAX_W - 16;
    doc.fontSize(20).font("Helvetica-Bold").fillColor(navy)
      .text("ESPECIFICACIÓN DE VARADA", ML, y + 2, { width: titleW });
    doc.fontSize(13).font("Helvetica-Bold").fillColor(navy)
      .text(sanitizePdfText(spec.specCode), ML, y + 32, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(sanitizePdfText(`${tenantName} · Generado: ${fmtDateTime(new Date())}`), ML, y + 50, { width: titleW });
    y += HEADER_H + 12;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(navy).lineWidth(2).stroke();
    y += 14;

    // ── Identificación ───────────────────────────────────────────────────────
    ensureSpace(58);
    labeledBox(ML,             y, W / 2 - 6, 48, "Embarcación", spec.vesselName, "#0369a1", accentBg);
    labeledBox(ML + W / 2 + 6, y, W / 2 - 6, 48, "Estado", STATUS_LABEL[spec.status] ?? spec.status, "#1d4ed8");
    y += 56;

    ensureSpace(50);
    labeledBox(ML, y, W, 44, "Título", val(spec.title));
    y += 52;

    // ── Datos de la varada ───────────────────────────────────────────────────
    sectionTitle("Datos de la varada");

    ensureSpace(58);
    labeledBox(ML,             y, W / 2 - 6, 48, "Astillero", val(spec.shipyardName));
    labeledBox(ML + W / 2 + 6, y, W / 2 - 6, 48, "Puerto", val(spec.port));
    y += 56;

    ensureSpace(58);
    labeledBox(ML,             y, W / 2 - 6, 48, "Inicio previsto", fmt(spec.plannedStartDate));
    labeledBox(ML + W / 2 + 6, y, W / 2 - 6, 48, "Fin previsto", fmt(spec.plannedEndDate));
    y += 56;

    if (spec.scopeSummary) textBlock("Alcance general", spec.scopeSummary);

    // ── Lista de trabajos ────────────────────────────────────────────────────
    sectionTitle(`Trabajos a ejecutar (${accepted.length})`);
    if (accepted.length === 0) {
      textBlock("Trabajos a ejecutar", "Sin trabajos aceptados.");
    } else {
      itemsTable(accepted);
    }

    // Anexo: mientras el documento no esté aprobado, el borrador tiene que
    // mostrar también lo que sigue en discusión y lo que tierra descartó.
    if (spec.status !== "APPROVED" && pending.length > 0) {
      sectionTitle(`Anexo — Items propuestos pendientes de decisión (${pending.length})`);
      itemsTable(pending);
    }
    if (spec.status !== "APPROVED" && rejected.length > 0) {
      sectionTitle(`Anexo — Items descartados (${rejected.length})`);
      itemsTable(rejected);
    }

    // ── Trazabilidad del circuito buque ↔ tierra ─────────────────────────────
    sectionTitle("Trazabilidad");
    ensureSpace(58);
    labeledBox(ML,             y, W / 2 - 6, 48, "Enviada por el buque", val(spec.submittedByName));
    labeledBox(ML + W / 2 + 6, y, W / 2 - 6, 48, "Fecha de envío", fmt(spec.submittedAt));
    y += 56;

    ensureSpace(58);
    labeledBox(ML,             y, W / 2 - 6, 48, "Aprobada por", val(spec.approvedByName));
    labeledBox(ML + W / 2 + 6, y, W / 2 - 6, 48, "Fecha de aprobación", fmt(spec.approvedAt));
    y += 56;

    if (spec.rejectedReason) textBlock("Motivo de devolución al buque", spec.rejectedReason);

    // ── Footer por página (buffered) ─────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const footerY = PAGE_H - FOOTER_SIZE;
      doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
      if (existsSync(LOGO_PATH)) {
        try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* non-blocking */ }
      }
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text("Copilot Management System — Documento generado automáticamente.", ML + 18, footerY, { width: W / 2 - 18 });
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text(sanitizePdfText(`${spec.specCode} · ${spec.vesselName} · Pág. ${i + 1}/${range.count}`), ML, footerY, { width: W, align: "right" });
    }
    doc.flushPages();
    doc.end();
  });
}
