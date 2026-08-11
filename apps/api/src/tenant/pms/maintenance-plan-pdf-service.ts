import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TenantAccessSession } from "../auth/session-store";
import { getTenantMaintenancePlan } from "../maintenance-plans/maintenance-plans-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText, splitTextIntoPageSegments } from "./pdf-helpers";
import { resolveTenantForm } from "./tenant-forms-service";
import { renderMercurioMaintenancePlanPdf } from "./maintenance-plan-pdf-mercurio";
import { areaText } from "./work-order-pdf/shared";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";


function val(v: unknown): string {
  const s = String(v ?? "").trim();
  return s || "—";
}

function triggerLabel(t: unknown): string {
  const s = String(t ?? "");
  if (!s) return "—";
  const m: Record<string, string> = {
    CALENDAR: "Meses (calendario)", MONTHS: "Meses (calendario)",
    HOURS: "Horas de operación", RUNNING_HOURS: "Horas de operación",
  };
  return m[s.toUpperCase()] ?? s;
}

function statusLabel(s: unknown): string {
  const k = String(s ?? "");
  const m: Record<string, string> = {
    ACTIVE: "Activo", INACTIVE: "Inactivo", OVERDUE: "Vencido", DUE_SOON: "Por vencer",
  };
  return m[k] ?? (k || "—");
}

function executionStatusLabel(s: unknown): string {
  const k = String(s ?? "");
  const m: Record<string, string> = {
    FUTURE: "Futuro", UPCOMING: "Próximo", IN_WINDOW: "En ventana",
    DUE: "Por vencer", OVERDUE: "Vencido", COMPLETED: "Completado",
  };
  return m[k] ?? (k || "—");
}

function resultModeLabel(r: unknown): string {
  const k = String(r ?? "");
  const m: Record<string, string> = {
    DUE_ONLY: "Solo vencimiento", AUTO_WO: "OT automática",
    APPROVAL_WO: "OT con aprobación", CHECKLIST: "Completar Checklist",
  };
  return m[k] ?? (k || "—");
}

const PAGE_H   = 841.89;
const CM       = 72 / 2.54;
const MARGIN_V = Math.round(1.5 * CM);
const FOOTER_H = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - MARGIN_V;
const KEEP_MIN = 26; // "keep-with-next": mínimo de contenido que baja junto a un título (~2 líneas)

// DejaVu Sans has full Unicode support (including ≥ ≤ etc.)
// Paths for Linux (VPS) and Windows (local dev)
const DEJAVU_PATHS = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "C:\\Windows\\Fonts\\DejaVuSans.ttf",
  join(process.cwd(), "assets", "DejaVuSans.ttf"),
];
const DEJAVU_BOLD_PATHS = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "C:\\Windows\\Fonts\\DejaVuSans-Bold.ttf",
  join(process.cwd(), "assets", "DejaVuSans-Bold.ttf"),
];
const dejavuRegular = DEJAVU_PATHS.find(existsSync) ?? null;
const dejavuBold    = DEJAVU_BOLD_PATHS.find(existsSync) ?? null;

const FONT_REGULAR = dejavuRegular ? "DejaVuSans" : "Helvetica";
const FONT_BOLD    = dejavuBold    ? "DejaVuSans-Bold" : "Helvetica-Bold";

export async function buildMaintenancePlanPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  // Fechas y horas del documento en la hora de la EMPRESA: el servidor
  // corre en UTC y sin esto el papel salía con la hora del servidor.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const plan = await getTenantMaintenancePlan(session, id);
  const p = plan as Record<string, unknown>;

  const prisma = getPrismaClient();
  let tenantName: string | null = null;
  let tenantLogoUrl: string | null = null;
  let tenantLogoUrlLight: string | null = null;
  let tenantDbId: string | null = null;
  let assetName: string | null = null;
  let assetIsSafetyCritical = false;
  let lastLog: { result: string; executedByName: string; completedAt: Date | null; runningHoursAtExecution: number | null; notes: string | null } | null = null;
  if (prisma) {
    const tenantRow = await (prisma as any).tenant.findUnique({
      where: { slug: session.tenantSlug },
      select: { id: true, settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
    });
    tenantDbId = tenantRow?.id ?? null;
    tenantName = tenantRow?.settings?.displayName ?? null;
    tenantLogoUrl = tenantRow?.settings?.logoUrl ?? null;
    tenantLogoUrlLight = tenantRow?.settings?.logoUrlLight ?? null;
    lastLog = await (prisma as any).workLog.findFirst({
      where: { maintenancePlanId: id, tenantId: tenantDbId },
      orderBy: { completedAt: "desc" },
      select: { result: true, executedByName: true, completedAt: true, runningHoursAtExecution: true, notes: true },
    });
    // Registros antiguos guardaron el ID interno del reporte diario en la nota
    // ("Registrado desde Daily Report <cuid>"). Al imprimir, lo reemplazamos por
    // una referencia legible (fecha del reporte) — no mostrar códigos internos.
    if (lastLog?.notes) {
      const m = lastLog.notes.match(/^Registrado desde Daily Report\s+(\S+)\s*$/);
      if (m) {
        let ref = "Reporte Diario";
        try {
          const dr = await (prisma as any).dailyReport.findFirst({
            where: { id: m[1], tenantId: tenantDbId },
            select: { reportDate: true },
          });
          if (dr?.reportDate) ref = `Reporte Diario del ${fmt(dr.reportDate)}`;
        } catch { /* non-blocking */ }
        lastLog.notes = `Registrado desde ${ref}`;
      }
    }
    if (plan.assetId) {
      try {
        const asset = await (prisma as any).asset.findUnique({
          where: { id: plan.assetId },
          select: { name: true, isSafetyCritical: true },
        });
        assetName = asset?.name ?? null;
        assetIsSafetyCritical = Boolean(asset?.isSafetyCritical);
      } catch { /* non-blocking */ }
    }
  }

  let tenantLogoBuffer: Buffer | null = await resolveTenantLogo(session.tenantSlug, tenantLogoUrl, tenantLogoUrlLight);

  // Estilo de documento del tenant: los tenants Mercurio reciben el formato de
  // documento controlado; el resto mantiene el layout estándar de abajo.
  const form = await resolveTenantForm(session.tenantSlug, "MAINTENANCE_PLAN");
  if (form.meta.style === "MERCURIO") {
    return renderMercurioMaintenancePlanPdf({
      meta: form.meta,
      logoBuffer: form.logoBuffer ?? tenantLogoBuffer,
      tenantName: tenantName ?? session.tenantSlug.toUpperCase(),
      plan: p,
      assetName,
      assetIsSafetyCritical,
      lastLog,
      tz,
      locale,
    });
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: { Title: `Plan ${p["taskCode"] ?? id}` },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (dejavuRegular) doc.registerFont("DejaVuSans", dejavuRegular);
    if (dejavuBold)    doc.registerFont("DejaVuSans-Bold", dejavuBold);

    const ML = 48;
    const MR = 48;
    const PW = 595.28;
    const W  = PW - ML - MR;

    const navy   = "#0f2744";
    const black  = "#0f172a";
    const gray   = "#64748b";
    const border = "#cbd5e1";
    const bgBox  = "#f8fafc";
    const bgHead = "#0f2744";
    const accent = "#d97706"; // amber

    let y = MARGIN_V;

    doc.on("pageAdded", () => { y = MARGIN_V; });

    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_V; }
    }

    function sectionHeader(title: string) {
      // keep-with-next: reservar la barra-título + un mínimo de contenido para que
      // el encabezado no quede huérfano al pie de página.
      ensureSpace(22 + KEEP_MIN);
      doc.rect(ML, y, W, 18).fillColor(bgHead).fill();
      doc.fontSize(8).font(FONT_BOLD).fillColor("#ffffff")
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
        doc.fontSize(7).font(FONT_BOLD).fillColor(gray)
          .text(f.label.toUpperCase(), bx + 10, y + 7, { width: colW - 20, characterSpacing: 0.5 });
        doc.fontSize(10.5).font(FONT_BOLD).fillColor(f.color ?? black)
          .text(sanitizePdfText(f.value), bx + 10, y + 19, { width: colW - 20 });
      });
      y += boxH;
    }

    // Renderiza una caja con label arriba y texto. Si el contenido excede la
    // página, se divide en segmentos: cada uno con su propia caja completa,
    // y el label en continuaciones lleva sufijo "(cont.)".
    function textBox(label: string, text: string, span = 1, totalCols = 3) {
      const clean = text === "—" ? text : sanitizePdfText(text);
      const innerW = (W / totalCols) * span - 20;
      const boxW = (W / totalCols) * span;
      const LABEL_H = 18;
      const TOP_PAD = 6;
      const BOTTOM_PAD = 4;

      // Caso "—": solo una línea, render directo
      if (clean === "—") {
        const boxH = Math.max(38, 14 + LABEL_H + BOTTOM_PAD);
        ensureSpace(boxH);
        doc.roundedRect(ML, y, boxW, boxH, 0).fillColor(bgBox).fill();
        doc.roundedRect(ML, y, boxW, boxH, 0).strokeColor(border).lineWidth(0.5).stroke();
        doc.fontSize(7).font(FONT_BOLD).fillColor(gray)
          .text(label.toUpperCase(), ML + 10, y + TOP_PAD, { width: innerW, characterSpacing: 0.5 });
        doc.fontSize(9.5).font(FONT_REGULAR).fillColor(gray)
          .text("—", ML + 10, y + LABEL_H, { width: innerW, lineGap: 2 });
        y += boxH;
        return;
      }

      const firstAvailable = CONTENT_BOTTOM - y - LABEL_H - BOTTOM_PAD;
      const continuationAvailable = CONTENT_BOTTOM - MARGIN_V - LABEL_H - BOTTOM_PAD;
      const segments = splitTextIntoPageSegments(
        doc, clean, innerW,
        { font: FONT_REGULAR, fontSize: 9.5, lineGap: 2 },
        firstAvailable, continuationAvailable,
      );

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (i > 0) { doc.addPage(); y = MARGIN_V; }
        const segH = Math.max(segments.length === 1 ? 38 : LABEL_H + 8,
                              LABEL_H + seg.contentHeight + BOTTOM_PAD);
        doc.roundedRect(ML, y, boxW, segH, 0).fillColor(bgBox).fill();
        doc.roundedRect(ML, y, boxW, segH, 0).strokeColor(border).lineWidth(0.5).stroke();
        const segLabel = seg.isContinuation ? `${label.toUpperCase()} (CONT.)` : label.toUpperCase();
        doc.fontSize(7).font(FONT_BOLD).fillColor(gray)
          .text(segLabel, ML + 10, y + TOP_PAD, { width: innerW, characterSpacing: 0.5 });
        doc.fontSize(9.5).font(FONT_REGULAR).fillColor(black)
          .text(seg.text, ML + 10, y + LABEL_H, { width: innerW, lineGap: 2 });
        y += segH;
      }
    }

    function renderMarkdownTable(rows: string[][]) {
      if (rows.length === 0) return;
      const headers = rows[0];
      const dataRows = rows.slice(1);
      const nCols = headers.length;
      const cellPad = 4;

      // ── Ancho de columnas ────────────────────────────────────────────────
      // Antes: primera columna fija 35% y el resto a partes iguales.
      // Problema: con muchas columnas (ej. 12 para checklist de vibración),
      // la primera quedaba enorme y las otras 11 a ~5% cada una → headers
      // wrappeados carácter por carácter.
      //
      // Ahora: peso proporcional al largo del header (mínimo 8 chars), y la
      // primera columna se capea cuando hay muchas columnas para que no
      // monopolice. Después se aplica un piso mínimo de 30pt y se rebalancea
      // el resto.
      const minColW = 30;
      // Peso por columna según el CONTENIDO real (header + celda más larga),
      // no solo el largo del header. Así una columna corta (ej. "Item": "1 [ ]")
      // no se lleva el mismo ancho que una de texto largo (Tarea / Criterios).
      // Se mide el texto sin el checkbox y se topea a 60 para que una celda
      // excepcionalmente larga no monopolice (igual wrappea).
      const measureLen = (s: string) =>
        sanitizePdfText((s ?? "").trim().replace(/^[☐☑☒□■✓✔✘ð]+\s*/u, "")).length;
      const weights = headers.map((h, i) => {
        const headerLen = h.trim().length;
        const cellMax = dataRows.reduce((m, r) => Math.max(m, measureLen(r[i] ?? "")), 0);
        return Math.max(6, Math.min(Math.max(headerLen, cellMax), 60));
      });
      if (nCols >= 6) {
        // Cap primera columna a 1.5× el promedio del resto.
        const avgRest = weights.slice(1).reduce((s, x) => s + x, 0) / Math.max(1, nCols - 1);
        weights[0] = Math.min(weights[0], avgRest * 1.5);
      }
      const totalWeight = weights.reduce((s, x) => s + x, 0) || 1;
      let colWidths = weights.map(w => (w / totalWeight) * W);

      // Aplicar piso mínimo: si hay columnas debajo del piso, fijarlas en el
      // piso y redistribuir el resto entre las "anchas" proporcionalmente.
      // Si todas terminan en piso (tabla muy densa), se acepta el overflow
      // (caso patológico — convendría más de una página o landscape).
      const needsFloor = colWidths.some(w => w < minColW);
      if (needsFloor) {
        const widePool = colWidths.filter(w => w >= minColW).reduce((s, x) => s + x, 0);
        const narrowCount = colWidths.filter(w => w < minColW).length;
        const remainder = Math.max(0, W - narrowCount * minColW);
        if (widePool > 0) {
          colWidths = colWidths.map(w => w < minColW ? minColW : (w / widePool) * remainder);
        } else {
          // Todas igual al piso → split equitativo (acepta overflow).
          colWidths = colWidths.map(() => W / nCols);
        }
      }
      const colX = (i: number) => ML + colWidths.slice(0, i).reduce((a, b) => a + b, 0);

      // ── Header height dinámico ───────────────────────────────────────────
      // Antes: 18pt fijo. Si el header wrappeaba a 3+ líneas, invadía las
      // filas de datos. Ahora medimos la altura real por columna y tomamos
      // la mayor. También bajamos el font cuando hay muchas columnas.
      const headerFont = nCols >= 10 ? 6 : nCols >= 7 ? 6.5 : 7.5;
      const headerHeights = headers.map((h, i) => {
        const cw = colWidths[i];
        return doc.fontSize(headerFont).font(FONT_BOLD).heightOfString(h.trim(), {
          width: cw - cellPad * 2,
          lineGap: 0.5,
        });
      });
      const headerH = Math.max(18, ...headerHeights) + 8;
      ensureSpace(headerH + 16); // keep-with-next: header de tabla + al menos la primera fila
      headers.forEach((h, i) => {
        doc.rect(colX(i), y, colWidths[i], headerH).fillColor("#e2e8f0").fill();
        doc.rect(colX(i), y, colWidths[i], headerH).strokeColor(border).lineWidth(0.4).stroke();
        doc.fontSize(headerFont).font(FONT_BOLD).fillColor(black)
          .text(h.trim(), colX(i) + cellPad, y + 4, { width: colWidths[i] - cellPad * 2, lineGap: 0.5 });
      });
      y += headerH;

      // Mismo escalado de font para celdas que para headers — coherente y
      // evita que celdas largas (ej. observaciones) wrappen a 10 líneas.
      const cellFont = nCols >= 10 ? 6 : nCols >= 7 ? 6.5 : 7.5;

      dataRows.forEach(row => {
        // Calculate dynamic row height based on tallest cell
        const cellHeights = row.map((cell, i) => {
          const cw = colWidths[i] ?? minColW;
          const raw = cell.trim();
          const hasCheckbox = /^[☐☑☒□■✓✔✘ð]/u.test(raw);
          const cleanText = sanitizePdfText(hasCheckbox ? raw.replace(/^[☐☑☒□■✓✔✘ð]+\s*/, "") : raw);
          const textW = cw - cellPad * 2 - (hasCheckbox ? 11 : 0);
          if (!cleanText) return 16;
          return doc.fontSize(cellFont).font(FONT_REGULAR).heightOfString(cleanText, { width: textW, lineGap: 1 }) + 8;
        });
        const rowH = Math.max(16, ...cellHeights);
        ensureSpace(rowH);
        row.forEach((cell, i) => {
          const cw = colWidths[i] ?? minColW;
          doc.rect(colX(i), y, cw, rowH).strokeColor(border).lineWidth(0.3).stroke();
          const raw = cell.trim();
          const hasCheckbox = /^[☐☑☒□■✓✔✘ð]/u.test(raw);
          const cleanText = sanitizePdfText(hasCheckbox ? raw.replace(/^[☐☑☒□■✓✔✘ð]+\s*/, "") : raw);
          let textX = colX(i) + cellPad;
          if (hasCheckbox) {
            const cbSize = 7;
            doc.rect(textX, y + (rowH - cbSize) / 2, cbSize, cbSize).strokeColor("#555").lineWidth(0.6).stroke();
            textX += cbSize + 3;
          }
          if (cleanText) {
            doc.fontSize(cellFont).font(FONT_REGULAR).fillColor(black)
              .text(cleanText, textX, y + 4, { width: cw - (textX - colX(i)) - cellPad, lineGap: 1 });
          }
        });
        y += rowH;
      });
      y += 6;
    }

    // Renderiza una línea con markdown inline:
    //  - "# titulo" / "## titulo" → negrita, sin el prefijo "#".
    //  - tramos "**negrita**" dentro del texto → en negrita.
    // Devuelve la altura renderizada para avanzar el cursor con precisión.
    function renderRichLine(rawLine: string, x: number, width: number, startY: number): number {
      const heading = rawLine.match(/^\s*(#{1,6})\s+(.*)$/);
      if (heading) {
        const txt = sanitizePdfText(heading[2]) || " ";
        const fs  = heading[1].length <= 1 ? 11 : 10;
        doc.fontSize(fs).font(FONT_BOLD).fillColor(black).text(txt, x, startY, { width, lineGap: 1 });
        return doc.y - startY;
      }
      // keepMarkdown preserva los ** para poder partir en tramos negrita/normal.
      const kept = sanitizePdfText(rawLine, { keepMarkdown: true });
      const parts = kept.split(/(\*\*[^*\n]+?\*\*)/g).filter(p => p.length > 0);
      doc.fontSize(9.5).fillColor(black);
      if (parts.length === 0) {
        doc.font(FONT_REGULAR).text(" ", x, startY, { width, lineGap: 1 });
        return doc.y - startY;
      }
      parts.forEach((part, idx) => {
        const isBold = part.length > 4 && part.startsWith("**") && part.endsWith("**");
        const txt    = isBold ? part.slice(2, -2) : part;
        const isLast = idx === parts.length - 1;
        doc.font(isBold ? FONT_BOLD : FONT_REGULAR);
        if (idx === 0) doc.text(txt, x, startY, { width, continued: !isLast, lineGap: 1 });
        else           doc.text(txt,            { width, continued: !isLast, lineGap: 1 });
      });
      return doc.y - startY;
    }

    function renderDescription(label: string, text: string, useBlueHeader = false) {
      if (!text || text === "—") { textBox(label, "—", 3, 3); return; }

      // Split into lines and detect markdown table blocks
      const lines = text.split("\n");
      let i = 0;
      const segments: Array<{ type: "text"; content: string } | { type: "table"; rows: string[][] }> = [];
      while (i < lines.length) {
        const line = lines[i];
        if (line.trim().startsWith("|")) {
          // Collect table lines
          const tableLines: string[] = [];
          while (i < lines.length && lines[i].trim().startsWith("|")) {
            // Skip separator rows (|---|---|)
            if (!/^\|[-:\s|]+\|$/.test(lines[i].trim())) {
              tableLines.push(lines[i]);
            }
            i++;
          }
          if (tableLines.length > 0) {
            const rows = tableLines.map(l =>
              l.trim().replace(/^\||\|$/g, "").split("|")
            );
            segments.push({ type: "table", rows });
          }
        } else {
          // Collect text lines until next table
          const textLines: string[] = [];
          while (i < lines.length && !lines[i].trim().startsWith("|")) {
            textLines.push(lines[i]);
            i++;
          }
          const content = textLines.join("\n").trim();
          if (content) segments.push({ type: "text", content });
        }
      }

      // Render label header
      if (useBlueHeader) {
        sectionHeader(label);
        y += 6;
      } else {
        y += 10; // gap between previous element and this label
        ensureSpace(22 + KEEP_MIN); // keep-with-next: título + mínimo de contenido juntos
        doc.fontSize(7).font(FONT_BOLD).fillColor(gray)
          .text(label.toUpperCase(), ML, y, { width: W, characterSpacing: 0.5 });
        y += 12;
      }

      for (const seg of segments) {
        if (seg.type === "text") {
          const innerW = W - 20;
          for (const line of seg.content.split("\n")) {
            // Only treat actual checkbox/square symbols as checkboxes — not comparison operators like ≥
            const hasCheckbox = /^[☐☑☒□■✓✔✘ð]/u.test(line.trim());
            const lineForRender = hasCheckbox ? line.replace(/^[☐☑☒□■✓✔✘ð]+\s*/, "") : line;
            // Estimación de altura (texto sin markdown, fuente regular) para el page-break.
            const measureText = sanitizePdfText(lineForRender);
            const lineH = doc.fontSize(9.5).font(FONT_REGULAR).heightOfString(measureText || " ", { width: innerW - (hasCheckbox ? 14 : 0), lineGap: 1 });
            ensureSpace(lineH + 6);
            let textX = ML;
            if (hasCheckbox) {
              const cbSize = 7;
              doc.rect(textX, y + 2, cbSize, cbSize).strokeColor("#555").lineWidth(0.6).stroke();
              textX += cbSize + 4;
            }
            if (measureText.trim()) {
              const renderedH = renderRichLine(lineForRender, textX, innerW - (textX - ML), y);
              y += renderedH + 2;
            } else {
              y += lineH + 2;
            }
          }
          y += 4;
        } else {
          renderMarkdownTable(seg.rows);
        }
      }
      y += 8;
    }

    // Matriz de análisis de riesgo (probabilidad × consecuencia), estilo IMO.
    // Resalta la celda del plan y muestra el nivel derivado. Mismas reglas que
    // la UI y el backend (deriveRiskLevelFromMatrix).
    function renderRiskMatrix(probability: string, consequence: string) {
      const PROBS = ["LIKELY", "PROBABLE", "UNLIKELY", "RARE"];
      const CONS = ["FATALITY", "MAJOR", "MINOR", "NEGLIGIBLE"];
      const probLabels: Record<string, string> = {
        LIKELY: "Muy probable", PROBABLE: "Probable", UNLIKELY: "Improbable", RARE: "Altamente improbable",
      };
      const consLabels: Record<string, string> = {
        FATALITY: "Fatalidad", MAJOR: "Lesiones importantes", MINOR: "Lesiones leves", NEGLIGIBLE: "Lesiones insignificantes",
      };
      // Filas = consecuencia, columnas = probabilidad. H=Alto, M=Medio, B=Bajo.
      const grid: Record<string, Record<string, "H" | "M" | "B">> = {
        FATALITY:   { LIKELY: "H", PROBABLE: "H", UNLIKELY: "H", RARE: "M" },
        MAJOR:      { LIKELY: "H", PROBABLE: "H", UNLIKELY: "M", RARE: "M" },
        MINOR:      { LIKELY: "H", PROBABLE: "M", UNLIKELY: "M", RARE: "B" },
        NEGLIGIBLE: { LIKELY: "M", PROBABLE: "M", UNLIKELY: "B", RARE: "B" },
      };
      const levelColor = { H: "#dc2626", M: "#f59e0b", B: "#16a34a" } as const;
      const levelText  = { H: "Alto", M: "Medio", B: "Bajo" } as const;

      const labelColW = 96;
      const cellW = (W - labelColW) / PROBS.length;
      const headerH = 30;
      const rowH = 30;
      const totalH = headerH + rowH * CONS.length;

      sectionHeader("Análisis de riesgo");
      y += 6;
      // Título de ejes
      doc.fontSize(7).font(FONT_BOLD).fillColor(gray)
        .text("PROBABILIDAD", ML + labelColW, y, { width: W - labelColW, align: "center", characterSpacing: 0.5 });
      y += 11;

      ensureSpace(totalH + 4);
      const top = y;

      // Esquina + headers de probabilidad
      doc.rect(ML, top, labelColW, headerH).fillColor("#0f2744").fill();
      doc.fontSize(6.5).font(FONT_BOLD).fillColor("#ffffff")
        .text("CONSECUENCIA", ML + 4, top + headerH / 2 - 6, { width: labelColW - 8, align: "center" });
      PROBS.forEach((pb, ci) => {
        const cx = ML + labelColW + ci * cellW;
        doc.rect(cx, top, cellW, headerH).fillColor("#1e3a5f").fill();
        doc.rect(cx, top, cellW, headerH).strokeColor("#ffffff").lineWidth(0.5).stroke();
        doc.fontSize(6.5).font(FONT_BOLD).fillColor("#ffffff")
          .text(probLabels[pb], cx + 3, top + 5, { width: cellW - 6, align: "center", lineGap: 0.5 });
      });

      // Filas de consecuencia
      CONS.forEach((cs, ri) => {
        const ry = top + headerH + ri * rowH;
        // Label de consecuencia
        doc.rect(ML, ry, labelColW, rowH).fillColor("#e2e8f0").fill();
        doc.rect(ML, ry, labelColW, rowH).strokeColor("#ffffff").lineWidth(0.5).stroke();
        doc.fontSize(6.5).font(FONT_BOLD).fillColor(black)
          .text(consLabels[cs], ML + 4, ry + rowH / 2 - 7, { width: labelColW - 8, align: "center", lineGap: 0.5 });
        // Celdas coloreadas
        PROBS.forEach((pb, ci) => {
          const cx = ML + labelColW + ci * cellW;
          const lvl = grid[cs][pb];
          const isSelected = pb === probability && cs === consequence;
          doc.rect(cx, ry, cellW, rowH).fillColor(levelColor[lvl]).fill();
          doc.fontSize(9).font(FONT_BOLD).fillColor("#ffffff")
            .text(levelText[lvl], cx, ry + rowH / 2 - 6, { width: cellW, align: "center" });
          if (isSelected) {
            // Borde grueso oscuro para marcar la celda del plan
            doc.rect(cx + 1.5, ry + 1.5, cellW - 3, rowH - 3).strokeColor("#0f172a").lineWidth(2.5).stroke();
          } else {
            doc.rect(cx, ry, cellW, rowH).strokeColor("#ffffff").lineWidth(0.5).stroke();
          }
        });
      });
      y = top + totalH + 8;

      // Resultado derivado
      const selLvl = grid[consequence]?.[probability];
      if (selLvl) {
        inlineRow([
          { label: "Probabilidad", value: probLabels[probability] ?? probability },
          { label: "Consecuencia", value: consLabels[consequence] ?? consequence },
          { label: "Nivel de riesgo", value: levelText[selLvl], color: levelColor[selLvl] },
        ]);
      }
    }

    // ── HEADER ────────────────────────────────────────────────────────────────
    const HEADER_H = 64;
    const TENANT_LOGO_MAX_W = 90;
    doc.rect(ML, y, 4, HEADER_H).fillColor("#1e40af").fill();

    // Tenant logo — top-right, proportional to header height
    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + W - TENANT_LOGO_MAX_W, y,
          { fit: [TENANT_LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
      } catch {}
    }

    const titleW = W - TENANT_LOGO_MAX_W - 16;
    doc.fontSize(20).font(FONT_BOLD).fillColor(navy)
      .text("PLAN DE MANTENIMIENTO", ML + 14, y + 2, { width: titleW });
    doc.fontSize(13).font(FONT_BOLD).fillColor(navy)
      .text(val(p["taskCode"]), ML + 14, y + 28, { width: titleW });
    doc.fontSize(8).font(FONT_REGULAR).fillColor(gray)
      .text(`Generado: ${fmtDateTime(new Date())}`, ML + 14, y + 48, { width: titleW });

    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 12;

    // ── SECCIÓN 1: IDENTIFICACIÓN ─────────────────────────────────────────────
    sectionHeader("Identificación");

    inlineRow([
      { label: "Embarcación",   value: val(p["vesselCode"]),   color: "#1d4ed8" },
      { label: "Activo / Equipo", value: val(assetName ?? p["assetId"]) },
      { label: "Estado",        value: statusLabel(p["status"] as string), color: accent },
    ]);
    inlineRow([
      { label: "Código de tarea",  value: val(p["taskCode"]) },
      { label: "Grupo SFI",        value: p["sfiGroupNumber"] != null ? `G${p["sfiGroupNumber"]}` : "—" },
      { label: "Departamento / Área", value: val(areaText(p as any)) },
    ]);
    inlineRow([
      { label: "Tipo de tarea",    value: val(p["taskType"]) },
      { label: "Responsable",      value: val(p["responsible"]) },
      { label: "Criticidad",       value: val(p["criticality"]) },
    ]);
    if (assetIsSafetyCritical) {
      inlineRow([
        { label: "Equipo crítico para seguridad (ISM 10.3)", value: "Sí", color: "#b45309" },
        { label: "", value: "" },
        { label: "", value: "" },
      ]);
    }
    y += 6;

    // ── SECCIÓN 2: PLANIFICACIÓN ──────────────────────────────────────────────
    sectionHeader("Planificación y Frecuencia");

    inlineRow([
      { label: "Tipo de trigger",      value: triggerLabel(p["triggerType"] as string) },
      { label: "Frecuencia (meses)",   value: p["frequencyMonths"] != null ? `${p["frequencyMonths"]} meses` : "—" },
      { label: "Frecuencia (horas)",   value: p["frequencyHours"] != null ? `${p["frequencyHours"]} h` : "—" },
    ]);
    inlineRow([
      { label: "Última ejecución",     value: fmt(p["lastExecutionDate"] as string) },
      { label: "Próximo vencimiento",  value: fmt(p["nextDueDate"] as string), color: "#b91c1c" },
      { label: "Estado de ejecución",  value: executionStatusLabel(p["executionStatus"] as string) },
    ]);
    inlineRow([
      { label: "Modo de resultado",    value: resultModeLabel(p["triggerResultMode"] as string) },
      { label: "Modo de ventana",      value: val(p["windowMode"]) },
      { label: "Días ventana anticipada", value: p["windowLeadDays"] != null ? `${p["windowLeadDays"]} días` : "—" },
    ]);
    y += 6;

    // ── SECCIÓN 3: DESCRIPCIÓN ────────────────────────────────────────────────
    sectionHeader("Tareas a Realizar");
    y += 14; // 5mm gap between section header and content

    textBox("Título", val(p["title"]), 3, 3);
    renderDescription("Tareas a realizar / Descripción", val(p["description"]), true);

    if (p["acceptanceCriteria"]) {
      renderDescription("Criterios de aceptación", val(p["acceptanceCriteria"]), true);
    }
    if (p["loto"]) {
      renderDescription("LOTO (Lockout/Tagout)", val(p["loto"]), true);
    }
    const riskProb = p["riskProbability"] ? String(p["riskProbability"]) : null;
    const riskCons = p["riskConsequence"] ? String(p["riskConsequence"]) : null;
    if (riskProb && riskCons) {
      // Matriz interactiva: dibuja la grilla y resalta la celda del plan.
      renderRiskMatrix(riskProb, riskCons);
    } else if (p["riskLevel"]) {
      // Fallback (planes sin ejes de matriz): nivel suelto, como antes.
      const riskLevelLabel: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Crítico" };
      inlineRow([
        { label: "Nivel de riesgo", value: riskLevelLabel[String(p["riskLevel"])] ?? val(p["riskLevel"]) },
        { label: "", value: "" },
        { label: "", value: "" },
      ]);
    }
    if (p["riskAnalysisResult"]) {
      renderDescription("Resultado análisis de riesgo", val(p["riskAnalysisResult"]), true);
    }
    // RCM consequence (si está clasificada)
    if (p["consequenceCategory"]) {
      const consequenceLabel: Record<string, string> = {
        SAFETY: "Riesgo a personas (lesión / fatalidad)",
        ENVIRONMENTAL: "Daño ambiental (vertido, emisión)",
        OPERATIONAL: "Pérdida de operación (paro, retraso)",
        NON_OPERATIONAL: "Solo costo de reparación",
      };
      const cat = String(p["consequenceCategory"]);
      inlineRow([
        { label: "Consecuencia (RCM)", value: consequenceLabel[cat] ?? cat },
        { label: "", value: "" },
        { label: "", value: "" },
      ]);
      if (p["consequenceRationale"]) {
        renderDescription("Fundamento de consecuencia", val(p["consequenceRationale"]), true);
      }
    }
    y += 16;

    // ── SECCIÓN 4: RESULTADO DE EJECUCIÓN (si existe) ─────────────────────────
    if (lastLog) {
      sectionHeader("Resultado de la Ejecución");
      const isSatisfactory = lastLog.result === "COMPLETED";
      const resultLabel = isSatisfactory ? "Satisfactorio" : "Con Deficiencias";
      const resultColor = isSatisfactory ? "#166534" : "#991b1b";
      inlineRow([
        { label: "Resultado",         value: resultLabel,                                              color: resultColor },
        { label: "Ejecutado por",     value: lastLog.executedByName || "—" },
        { label: "Fecha de ejecución", value: fmt(lastLog.completedAt) },
      ]);
      if (lastLog.runningHoursAtExecution != null) {
        inlineRow([
          { label: "Horas motor al ejecutar", value: `${lastLog.runningHoursAtExecution.toLocaleString()} h` },
          { label: "", value: "" },
          { label: "", value: "" },
        ]);
      }
      if (lastLog.notes) {
        textBox("Observaciones / Deficiencias", lastLog.notes, 3, 3);
      }
      y += 12;
    }

    // ── FIRMAS ────────────────────────────────────────────────────────────────
    ensureSpace(72);
    const sigW = W / 3;
    const sigH = 64;
    const sigLabels = ["Responsable de ejecución", "Supervisor / Jefe de Máquinas", "Verificado por"];

    sigLabels.forEach((label, i) => {
      const bx = ML + i * sigW;
      doc.roundedRect(bx, y, sigW, sigH, 0).fillColor(bgBox).fill();
      doc.roundedRect(bx, y, sigW, sigH, 0).strokeColor(border).lineWidth(0.5).stroke();
      doc.fontSize(7).font(FONT_BOLD).fillColor(gray)
        .text(label.toUpperCase(), bx + 10, y + 8, { width: sigW - 20, characterSpacing: 0.5 });
      doc.moveTo(bx + 10, y + 50).lineTo(bx + sigW - 10, y + 50).strokeColor("#aaaaaa").lineWidth(0.8).stroke();
    });
    y += sigH + 8;

    // ── FOOTER ────────────────────────────────────────────────────────────────
    const footerY = PAGE_H - FOOTER_H;
    doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch {}
    }
    doc.fontSize(8).font(FONT_REGULAR).fillColor(gray)
      .text("Copilot Management System — Documento generado automáticamente.", ML + 18, footerY, { width: W / 2 - 18 });
    doc.fontSize(8).font(FONT_REGULAR).fillColor(gray)
      .text(`${val(p["taskCode"])} · ${val(p["vesselCode"])} · ${fmt(new Date())}`, ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
