// Chrome compartido para formularios controlados (estilo Mercurio).
//
// Centraliza el header ("documento controlado": logo + numero + titulo + caja
// Revision/Desde/Pagina/Documento Controlado) y el footer (banda de aprobacion
// editable + linea de info), mas las primitivas de dibujo (sectionHeader, cell,
// checkbox, textArea). La logica de page-split de `textArea` — origen del bug
// historico de "texto que se sale del marco al cambiar de pagina" — vive aca,
// en un solo lugar reutilizable por todos los templates.
//
// Renderer puro: no Prisma, no I/O (salvo leer el LOGO_PATH local del footer).

import { existsSync } from "node:fs";
import { sanitizePdfText, LOGO_PATH } from "./pdf-helpers";

// ── Paleta (formularios densos con headers azul marino) ──────────────────────
export const FORM_COLORS = {
  NAVY:   "#0C2461",
  WHITE:  "#FFFFFF",
  BLACK:  "#111827",
  GRAY:   "#6B7280",
  BORDER: "#9CA3AF",
  LIGHT:  "#F3F4F6",
};
export type FormCanvasColors = typeof FORM_COLORS;

// ── Geometria A4 portrait + footer ───────────────────────────────────────────
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const APPROVAL_BAND_H = 18;
export const FOOTER_INFO_H   = 28;
export const FOOTER_H = APPROVAL_BAND_H + FOOTER_INFO_H; // 46

// ── Metadatos del documento controlado (ya resueltos por tenant) ─────────────
export interface ControlledDocMeta {
  style: "STANDARD" | "MERCURIO";
  formCode: string;       // "REGI-LOG-01.3"
  title: string;          // "Solicitud de servicios"
  revision: number | string;
  effectiveFrom: string;  // "01.05.2025"
  preparedBy: string;     // footer "Elaborado:"
  reviewedBy: string;     // footer "Revisado:"
  approvedBy: string;     // footer "Aprobado:"
}

// ── Header del documento controlado ──────────────────────────────────────────
// Dibuja [logo][centro: codigo + titulo][caja: Revision/Desde/Pagina/Controlado].
// Devuelve el alto consumido.
export function drawControlledDocHeader(
  doc: PDFKit.PDFDocument,
  opts: {
    meta: ControlledDocMeta;
    logoBuffer: Buffer | null;
    tenantName: string;
    x: number;
    y: number;
    w: number;
    page?: number;
  },
): number {
  const { meta, logoBuffer, tenantName, x, y, w } = opts;
  const page = opts.page ?? 1;
  const { NAVY, BLACK, GRAY, BORDER } = FORM_COLORS;

  const HDR_H = 72;
  doc.rect(x, y, w, HDR_H).strokeColor(BORDER).lineWidth(0.8).stroke();

  const LOGO_W = Math.floor(w * 0.22);
  doc.rect(x, y, LOGO_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
  if (logoBuffer) {
    try { doc.image(logoBuffer, x + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" }); } catch {}
  } else if (existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, x + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" }); } catch {}
  } else {
    doc.fontSize(8).font("Helvetica-Bold").fillColor(NAVY)
      .text(sanitizePdfText(tenantName), x + 4, y + 28, { width: LOGO_W - 8, align: "center" });
  }

  const INFO_W = Math.floor(w * 0.25);
  const CTR_X  = x + LOGO_W;
  const CTR_W  = w - LOGO_W - INFO_W;
  doc.rect(CTR_X, y, CTR_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
  doc.fontSize(9).font("Helvetica-Bold").fillColor(NAVY)
    .text(sanitizePdfText(meta.formCode), CTR_X + 4, y + 14, { width: CTR_W - 8, align: "center" });
  doc.fontSize(10).font("Helvetica-Bold").fillColor(NAVY)
    .text(sanitizePdfText(meta.title), CTR_X + 4, y + 32, { width: CTR_W - 8, align: "center" });

  const INFO_X = x + LOGO_W + CTR_W;
  const ROW_H_INFO = Math.floor(HDR_H / 4);
  const infoRows: Array<[string, string]> = [
    ["Revision N°", String(meta.revision)],
    ["Desde:", meta.effectiveFrom],
    ["Pagina:", String(page)],
    ["Documento Controlado", ""],
  ];
  infoRows.forEach(([label, value], i) => {
    const iy = y + i * ROW_H_INFO;
    const ih = i === 3 ? HDR_H - 3 * ROW_H_INFO : ROW_H_INFO;
    doc.rect(INFO_X, iy, INFO_W, ih).strokeColor(BORDER).lineWidth(0.4).stroke();
    if (i < 3) {
      const halfW = Math.floor(INFO_W / 2);
      doc.rect(INFO_X + halfW, iy, INFO_W - halfW, ih).strokeColor(BORDER).lineWidth(0.4).stroke();
      doc.fontSize(7).font("Helvetica").fillColor(GRAY)
        .text(sanitizePdfText(label), INFO_X + 3, iy + (ih - 7) / 2 + 1, { width: halfW - 6, lineBreak: false });
      doc.fontSize(8).font("Helvetica-Bold").fillColor(BLACK)
        .text(sanitizePdfText(value), INFO_X + halfW + 3, iy + (ih - 8) / 2 + 1, { width: INFO_W - halfW - 6, lineBreak: false, align: "center" });
    } else {
      doc.fontSize(7).font("Helvetica-Bold").fillColor("#1d4ed8")
        .text(sanitizePdfText(label), INFO_X + 3, iy + (ih - 7) / 2 + 1, { width: INFO_W - 6, align: "center", lineBreak: false });
    }
  });

  return HDR_H;
}

// ── Footer del documento controlado ──────────────────────────────────────────
// Banda de aprobacion (Elaborado/Revisado/Aprobado — editable desde meta) +
// linea de info (logo CMS + "Copilot Management System" + rightInfo a la derecha).
export function drawControlledDocFooter(
  doc: PDFKit.PDFDocument,
  opts: { meta: ControlledDocMeta; rightInfo: string; x: number; w: number },
): void {
  const { meta, rightInfo, x, w } = opts;
  const { GRAY, BORDER } = FORM_COLORS;

  const fy = PAGE_H - FOOTER_H;
  doc.moveTo(x, fy).lineTo(x + w, fy).strokeColor(BORDER).lineWidth(0.5).stroke();

  const cols = [
    { label: "Elaborado:", value: meta.preparedBy },
    { label: "Revisado:",  value: meta.reviewedBy },
    { label: "Aprobado:",  value: meta.approvedBy },
  ];
  const cw = Math.floor(w / cols.length);
  cols.forEach((col, i) => {
    const cx = x + i * cw;
    if (i > 0) {
      doc.moveTo(cx, fy + 2).lineTo(cx, fy + APPROVAL_BAND_H - 2)
         .strokeColor(BORDER).lineWidth(0.4).stroke();
    }
    const text = sanitizePdfText(`${col.label} ${col.value}`);
    doc.fontSize(7).font("Helvetica").fillColor(GRAY)
      .text(text, cx + 6, fy + (APPROVAL_BAND_H - 7) / 2 + 1, {
        width: cw - 12, align: "center", lineBreak: false, ellipsis: true,
      });
  });

  const ify = fy + APPROVAL_BAND_H;
  doc.moveTo(x, ify).lineTo(x + w, ify).strokeColor(BORDER).lineWidth(0.5).stroke();

  let textX = x;
  if (existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, x, ify + 6, { width: 14, height: 14 });
      textX = x + 18;
    } catch { /* non-blocking */ }
  }
  doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
    .text("Copilot Management System", textX, ify + 9, { width: w / 2 - 18, lineBreak: false });
  doc.fontSize(7).font("Helvetica").fillColor(GRAY)
    .text(sanitizePdfText(rightInfo), x, ify + 9, { width: w, align: "right" });
}

// ── Canvas de formulario ─────────────────────────────────────────────────────
// Posee el cursor `y` y el numero de pagina, registra el handler `pageAdded`,
// y expone las primitivas de dibujo. Centraliza el page-split de `textArea`.
export interface CellOpts {
  bold?: boolean;
  fontSize?: number;
  align?: "left" | "center" | "right";
  bg?: string;
  color?: string;
  noStroke?: boolean;
}

export interface FormCanvas {
  /** Cursor vertical (mutable). */
  y: number;
  /** Numero de pagina actual (1-based). */
  readonly page: number;
  /** Si no entra `h` en la pagina, cierra footer y agrega pagina. */
  ensureSpace(h: number): void;
  /** Cierra footer de la pagina actual y agrega una nueva (cursor a marginT). */
  pageBreak(): void;
  /** Barra de seccion azul marino con titulo. Avanza el cursor. */
  sectionHeader(title: string, h?: number): void;
  /** Celda con borde/relleno y texto opcional (coordenadas explicitas). */
  cell(cx: number, cy: number, cw: number, ch: number, text: string, opts?: CellOpts): void;
  /** Checkbox con label (coordenadas explicitas). */
  checkbox(cx: number, cy: number, label: string, checked: boolean): void;
  /** Caja de texto con borde, soporta split entre paginas. Devuelve alto del ultimo segmento. */
  textArea(cx: number, cy: number, cw: number, text: string, minH?: number): number;
}

export interface CreateFormCanvasOpts {
  ml: number;
  w: number;
  marginT: number;
  contentBottom: number;
  colors?: FormCanvasColors;
  /** Dibuja el footer de la pagina indicada. Llamado en cada page break. */
  drawFooter: (page: number) => void;
}

// ── Parseo de tablas Markdown (para dibujarlas como grilla en los campos) ─────
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|") || !t.includes("-")) return false;
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(t);
}
function parseTableRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map(c => c.trim());
}
// Una "fila de tabla" es una línea cuyo trim empieza con "|" y tiene >=2 pipes
// (ej. "| a | b |"). NO se exige fila separadora "|---|" — muchos contenidos
// generados omiten el separador y aun así son tablas (espejo del renderer del
// PDF estándar). Los separadores, si existen, se detectan y se descartan.
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && (t.match(/\|/g)?.length ?? 0) >= 2;
}
function hasMarkdownTable(text: string): boolean {
  return text.split("\n").some(isTableRow);
}
type RichBlock =
  | { type: "text"; lines: string[] }
  | { type: "table"; header: string[]; rows: string[][] };
function parseRichBlocks(text: string): RichBlock[] {
  const lines = text.split("\n");
  const blocks: RichBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i])) {
      const tableLines: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        if (!isTableSeparator(lines[i])) tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length > 0) {
        const header = parseTableRow(tableLines[0]);
        const rows = tableLines.slice(1).map(parseTableRow);
        blocks.push({ type: "table", header, rows });
      }
    } else {
      const tl: string[] = [];
      while (i < lines.length && !isTableRow(lines[i])) { tl.push(lines[i]); i++; }
      blocks.push({ type: "text", lines: tl });
    }
  }
  return blocks;
}

export function createFormCanvas(doc: PDFKit.PDFDocument, opts: CreateFormCanvasOpts): FormCanvas {
  const { ml: ML, w: W, marginT: MARGIN_T, contentBottom: CONTENT_BOTTOM, drawFooter } = opts;
  const C = opts.colors ?? FORM_COLORS;

  let y = MARGIN_T;
  let page = 1;
  doc.on("pageAdded", () => { page++; y = MARGIN_T; });

  function pageBreak() {
    drawFooter(page);
    doc.addPage();
  }

  function ensureSpace(h: number) {
    if (y + h > CONTENT_BOTTOM) pageBreak();
  }

  function sectionHeader(title: string, h = 18) {
    ensureSpace(h + 2);
    doc.rect(ML, y, W, h).fillColor(C.NAVY).fill();
    doc.rect(ML, y, W, h).strokeColor(C.NAVY).lineWidth(0.5).stroke();
    doc.fontSize(8).font("Helvetica-Bold").fillColor(C.WHITE)
      .text(title.toUpperCase(), ML + 8, y + (h - 8) / 2 + 1, { width: W - 16, characterSpacing: 0.8 });
    y += h;
  }

  function cell(cx: number, cy: number, cw: number, ch: number, text: string, o: CellOpts = {}) {
    if (o.bg) doc.rect(cx, cy, cw, ch).fillColor(o.bg).fill();
    if (!o.noStroke) doc.rect(cx, cy, cw, ch).strokeColor(C.BORDER).lineWidth(0.4).stroke();
    if (text) {
      doc.fontSize(o.fontSize ?? 9)
        .font(o.bold ? "Helvetica-Bold" : "Helvetica")
        .fillColor(o.color ?? C.BLACK)
        .text(text, cx + 5, cy + (ch - (o.fontSize ?? 9)) / 2, {
          width: cw - 10,
          align: o.align ?? "left",
          lineBreak: false,
          ellipsis: true,
        });
    }
  }

  function checkbox(cx: number, cy: number, label: string, checked: boolean) {
    const BOX = 8;
    doc.rect(cx, cy, BOX, BOX).strokeColor(C.BORDER).lineWidth(0.6).stroke();
    if (checked) {
      doc.fontSize(6).font("Helvetica-Bold").fillColor(C.NAVY)
        .text("X", cx + 1, cy + 1, { width: BOX - 2, align: "center", lineBreak: false });
    }
    doc.fontSize(8).font("Helvetica").fillColor(C.BLACK)
      .text(label, cx + BOX + 4, cy + 0.5, { lineBreak: false });
  }

  // Lineas que empiezan con bullet (• · ● ◦ ▪ ▫) reciben un cuadrado vacio.
  const BULLET_RE = /^(\s*)[•·●◦▪▫]\s*(.*)$/;
  const BULLET_BOX = 6;
  const BULLET_GUTTER = 12;
  const LINE_PAD = 5;

  // Dibuja una línea/celda interpretando **negrita** inline. Devuelve la altura
  // que ocuparía (medida sobre el texto sin marcadores). Cada segmento se
  // sanitiza (convierte unicode); los `**` se consumen al partir en tramos.
  function drawInlineRich(text: string, x: number, yy: number, width: number, fontSize: number): number {
    doc.fontSize(fontSize);
    const plain = sanitizePdfText(text);
    const h = doc.font("Helvetica").heightOfString(plain || " ", { width });
    const parts = text.split(/(\*\*[^*\n]+?\*\*)/g).filter(p => p.length > 0);
    if (parts.length === 0) {
      doc.font("Helvetica").fillColor(C.BLACK).text(" ", x, yy, { width });
      return h;
    }
    parts.forEach((part, idx) => {
      const isBold = part.length > 4 && part.startsWith("**") && part.endsWith("**");
      const seg = sanitizePdfText(isBold ? part.slice(2, -2) : part);
      const isLast = idx === parts.length - 1;
      doc.font(isBold ? "Helvetica-Bold" : "Helvetica").fillColor(C.BLACK);
      if (idx === 0) doc.text(seg || " ", x, yy, { width, continued: !isLast });
      else           doc.text(seg,        { width, continued: !isLast });
    });
    return h;
  }

  // Renderiza texto que contiene tablas Markdown: párrafos como texto y los
  // bloques `| a | b |` como grilla. Maneja salto de página por línea/fila.
  function renderRichTextArea(cx: number, cy: number, cw: number, text: string, minH: number): number {
    const innerW = cw - LINE_PAD * 2;
    const blocks = parseRichBlocks(text);
    let curY = cy + LINE_PAD;
    let broke = false;
    const ensure = (h: number) => {
      if (curY + h > CONTENT_BOTTOM) { pageBreak(); curY = MARGIN_T; broke = true; }
    };

    for (const block of blocks) {
      if (block.type === "text") {
        doc.fontSize(9).font("Helvetica").fillColor(C.BLACK);
        for (const line of block.lines) {
          const m = line.match(BULLET_RE);
          const content = m ? m[2] : line;
          const isBullet = !!m;
          const lw = isBullet ? innerW - BULLET_GUTTER : innerW;
          const h = doc.fontSize(9).font("Helvetica").heightOfString(sanitizePdfText(content) || " ", { width: lw });
          ensure(h);
          if (isBullet) {
            doc.rect(cx + LINE_PAD, curY + 2, BULLET_BOX, BULLET_BOX).strokeColor(C.BLACK).lineWidth(0.7).stroke();
            drawInlineRich(content, cx + LINE_PAD + BULLET_GUTTER, curY, lw, 9);
          } else {
            drawInlineRich(content, cx + LINE_PAD, curY, lw, 9);
          }
          curY += h;
        }
      } else {
        const nCols = Math.max(block.header.length, ...block.rows.map(r => r.length), 1);
        const colW = cw / nCols;
        const PAD = 3;
        const FS = 8;
        const measure = (cells: string[]) => {
          doc.fontSize(FS).font("Helvetica");
          let maxH = 0;
          for (let c = 0; c < nCols; c++) {
            const h = doc.heightOfString(sanitizePdfText(cells[c] ?? "") || " ", { width: colW - PAD * 2 });
            if (h > maxH) maxH = h;
          }
          return maxH + PAD * 2;
        };
        const drawRow = (cells: string[], header: boolean) => {
          const rowH = measure(cells);
          ensure(rowH);
          for (let c = 0; c < nCols; c++) {
            const x = cx + c * colW;
            if (header) doc.rect(x, curY, colW, rowH).fillColor("#e2e8f0").fill();
            doc.rect(x, curY, colW, rowH).strokeColor(C.BORDER).lineWidth(0.5).stroke();
            if (header) {
              // El header va todo en negrita (no se interpreta **inline**).
              doc.fontSize(FS).font("Helvetica-Bold").fillColor(C.BLACK)
                .text(sanitizePdfText(cells[c] ?? ""), x + PAD, curY + PAD, { width: colW - PAD * 2 });
            } else {
              drawInlineRich(cells[c] ?? "", x + PAD, curY + PAD, colW - PAD * 2, FS);
            }
          }
          curY += rowH;
        };
        drawRow(block.header, true);
        for (const r of block.rows) drawRow(r, false);
        curY += 3;
      }
    }
    curY += LINE_PAD;
    if (!broke && curY - cy < minH) curY = cy + minH;
    return curY - cy;
  }

  function textArea(cx: number, cy: number, cw: number, text: string, minH = 28): number {
    if (text && hasMarkdownTable(text)) return renderRichTextArea(cx, cy, cw, text, minH);
    const innerW = cw - LINE_PAD * 2;
    const innerWBullet = innerW - BULLET_GUTTER;
    const rawLines = text ? text.split("\n") : [""];

    doc.fontSize(9).font("Helvetica");
    type Item = { content: string; bullet: boolean; width: number; height: number };
    const items: Item[] = rawLines.map((line) => {
      const m = line.match(BULLET_RE);
      const content = m ? m[2] : line;
      const wdt = m ? innerWBullet : innerW;
      // Medir sobre el texto sin marcadores **; el render interpreta la negrita.
      return { content, bullet: !!m, width: wdt, height: doc.heightOfString(sanitizePdfText(content) || " ", { width: wdt }) };
    });

    // Pre-computar segmentos (uno por pagina)
    type Segment = { startY: number; items: Item[] };
    const segments: Segment[] = [];
    let segStartY = cy;
    let segItems: Item[] = [];
    let curLy = cy + LINE_PAD;
    for (const item of items) {
      if (curLy + item.height + LINE_PAD > CONTENT_BOTTOM && segItems.length > 0) {
        segments.push({ startY: segStartY, items: segItems });
        segItems = [];
        segStartY = MARGIN_T;
        curLy = MARGIN_T + LINE_PAD;
      }
      segItems.push(item);
      curLy += item.height;
    }
    segments.push({ startY: segStartY, items: segItems });

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (i > 0) pageBreak();
      const contentH = seg.items.reduce((s, it) => s + it.height, 0);
      const isSinglePage = segments.length === 1;
      const segH = isSinglePage ? Math.max(minH, contentH + LINE_PAD * 2) : contentH + LINE_PAD * 2;

      doc.rect(cx, seg.startY, cw, segH).fillColor(C.WHITE).fill();
      doc.rect(cx, seg.startY, cw, segH).strokeColor(C.BORDER).lineWidth(0.4).stroke();

      let ly = seg.startY + LINE_PAD;
      doc.fontSize(9).font("Helvetica").fillColor(C.BLACK);
      for (const item of seg.items) {
        if (item.bullet) {
          doc.rect(cx + LINE_PAD, ly + 2, BULLET_BOX, BULLET_BOX)
             .strokeColor(C.BLACK).lineWidth(0.7).stroke();
          drawInlineRich(item.content, cx + LINE_PAD + BULLET_GUTTER, ly, item.width, 9);
        } else {
          drawInlineRich(item.content, cx + LINE_PAD, ly, item.width, 9);
        }
        ly += item.height;
      }
    }

    const lastSeg = segments[segments.length - 1];
    const lastContentH = lastSeg.items.reduce((s, it) => s + it.height, 0);
    const lastBoxH = segments.length === 1
      ? Math.max(minH, lastContentH + LINE_PAD * 2)
      : lastContentH + LINE_PAD * 2;
    // Devuelve el delta desde el inicio (cy) hasta el fondo real del contenido.
    // Los callers hacen `canvas.y += textArea(...)` con cy === canvas.y, así que
    // el delta deja la `y` exactamente en el fondo. Con page-break el último
    // segmento arranca en MARGIN_T (otra página): sin este delta, el `+=` sumaba
    // sobre la `y` de la página anterior y dejaba huecos enormes entre títulos.
    return (lastSeg.startY + lastBoxH) - cy;
  }

  return {
    get y() { return y; },
    set y(v: number) { y = v; },
    get page() { return page; },
    ensureSpace,
    pageBreak,
    sectionHeader,
    cell,
    checkbox,
    textArea,
  };
}

// ── Matriz de riesgo (probabilidad × consecuencia) ────────────────────────────
// Compartida por el PDF del Plan de mantenimiento y el de la OT. Filas =
// consecuencia, columnas = probabilidad. Resalta la celda (prob × cons) si se
// pasan ambos ejes; si no, dibuja la grilla de referencia sin resaltado.
export function renderRiskMatrix(
  doc: PDFKit.PDFDocument,
  canvas: FormCanvas,
  ml: number,
  w: number,
  probability: string | null,
  consequence: string | null,
): void {
  const { NAVY, WHITE, BLACK } = FORM_COLORS;
  const PROBS = ["LIKELY", "PROBABLE", "UNLIKELY", "RARE"];
  const CONS = ["FATALITY", "MAJOR", "MINOR", "NEGLIGIBLE"];
  const probLabels: Record<string, string> = {
    LIKELY: "Muy probable", PROBABLE: "Probable", UNLIKELY: "Improbable", RARE: "Altamente improbable",
  };
  const consLabels: Record<string, string> = {
    FATALITY: "Fatalidad", MAJOR: "Lesiones importantes", MINOR: "Lesiones leves", NEGLIGIBLE: "Lesiones insignificantes",
  };
  const grid: Record<string, Record<string, "H" | "M" | "B">> = {
    FATALITY:   { LIKELY: "H", PROBABLE: "H", UNLIKELY: "H", RARE: "M" },
    MAJOR:      { LIKELY: "H", PROBABLE: "H", UNLIKELY: "M", RARE: "M" },
    MINOR:      { LIKELY: "H", PROBABLE: "M", UNLIKELY: "M", RARE: "B" },
    NEGLIGIBLE: { LIKELY: "M", PROBABLE: "M", UNLIKELY: "B", RARE: "B" },
  };
  const levelColor = { H: "#dc2626", M: "#f59e0b", B: "#16a34a" } as const;
  const levelText = { H: "Alto", M: "Medio", B: "Bajo" } as const;

  const labelColW = 96;
  const cellW = (w - labelColW) / PROBS.length;
  const headerH = 26;
  const rowH = 24;
  const totalH = headerH + rowH * CONS.length;

  canvas.ensureSpace(totalH + 2);
  const top = canvas.y;

  doc.rect(ml, top, labelColW, headerH).fillColor(NAVY).fill();
  doc.fontSize(6.5).font("Helvetica-Bold").fillColor(WHITE)
    .text("CONSECUENCIA", ml + 3, top + headerH / 2 - 4, { width: labelColW - 6, align: "center", lineBreak: false });
  PROBS.forEach((pb, ci) => {
    const cx = ml + labelColW + ci * cellW;
    doc.rect(cx, top, cellW, headerH).fillColor("#1e3a5f").fill();
    doc.rect(cx, top, cellW, headerH).strokeColor(WHITE).lineWidth(0.5).stroke();
    doc.fontSize(6.5).font("Helvetica-Bold").fillColor(WHITE)
      .text(probLabels[pb], cx + 2, top + 4, { width: cellW - 4, align: "center", lineGap: 0.5 });
  });

  CONS.forEach((cs, ri) => {
    const ry = top + headerH + ri * rowH;
    doc.rect(ml, ry, labelColW, rowH).fillColor("#e2e8f0").fill();
    doc.rect(ml, ry, labelColW, rowH).strokeColor(WHITE).lineWidth(0.5).stroke();
    doc.fontSize(6.5).font("Helvetica-Bold").fillColor(BLACK)
      .text(consLabels[cs], ml + 3, ry + rowH / 2 - 6, { width: labelColW - 6, align: "center", lineGap: 0.5 });
    PROBS.forEach((pb, ci) => {
      const cx = ml + labelColW + ci * cellW;
      const lvl = grid[cs][pb];
      const isSel = pb === probability && cs === consequence;
      doc.rect(cx, ry, cellW, rowH).fillColor(levelColor[lvl]).fill();
      doc.fontSize(8.5).font("Helvetica-Bold").fillColor(WHITE)
        .text(levelText[lvl], cx, ry + rowH / 2 - 5, { width: cellW, align: "center", lineBreak: false });
      if (isSel) {
        doc.rect(cx + 1.5, ry + 1.5, cellW - 3, rowH - 3).strokeColor("#0f172a").lineWidth(2.5).stroke();
      } else {
        doc.rect(cx, ry, cellW, rowH).strokeColor(WHITE).lineWidth(0.5).stroke();
      }
    });
  });
  canvas.y = top + totalH;
}
