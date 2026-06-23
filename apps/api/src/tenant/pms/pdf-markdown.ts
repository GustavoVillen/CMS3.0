// Render de Markdown ligero (tablas + **negrita** inline) sobre un PDFDocument
// "plano" (sin el chrome de createFormCanvas). Pensado para PDFs que manejan su
// propio cursor `y` y page-breaks vía `doc.on("pageAdded")`.
//
// Detección de tablas SIN exigir fila separadora "|---|" (muchos contenidos
// generados la omiten). Espejo de la lógica de pdf-form-chrome.ts.

import { sanitizePdfText } from "./pdf-helpers";

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
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && (t.match(/\|/g)?.length ?? 0) >= 2;
}

export function hasMarkdownTable(text: string): boolean {
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

export interface InlineFont { regular: string; bold: string; }

/**
 * Dibuja una línea/celda interpretando **negrita** inline. Devuelve la altura
 * ocupada (medida sobre el texto sin marcadores). Cada segmento se sanitiza
 * (convierte unicode); los `**` se consumen al partir en tramos.
 */
export function drawInlineBold(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  font: InlineFont,
  fontSize: number,
  color: string,
  lineGap = 2,
): number {
  doc.fontSize(fontSize);
  const plain = sanitizePdfText(text);
  const h = doc.font(font.regular).heightOfString(plain || " ", { width, lineGap });
  const parts = text.split(/(\*\*[^*\n]+?\*\*)/g).filter(p => p.length > 0);
  if (parts.length === 0) {
    doc.font(font.regular).fillColor(color).text(" ", x, y, { width, lineGap });
    return h;
  }
  parts.forEach((part, idx) => {
    const isBold = part.length > 4 && part.startsWith("**") && part.endsWith("**");
    const seg = sanitizePdfText(isBold ? part.slice(2, -2) : part);
    const isLast = idx === parts.length - 1;
    doc.font(isBold ? font.bold : font.regular).fillColor(color);
    if (idx === 0) doc.text(seg || " ", x, y, { width, continued: !isLast, lineGap });
    else           doc.text(seg,        { width, continued: !isLast, lineGap });
  });
  return h;
}

export interface MarkdownBlocksOpts {
  x: number;
  width: number;
  startY: number;
  /** Y máximo de contenido; al superarlo se hace doc.addPage(). */
  contentBottom: number;
  /** Y a usar tras un salto de página (típicamente el margen vertical). */
  resetY: number;
  fontRegular: string;
  fontBold: string;
  fontSize?: number;
  color?: string;
  borderColor?: string;
  headerBg?: string;
  lineGap?: number;
}

/**
 * Renderiza contenido Markdown (párrafos con **negrita** + tablas como grilla)
 * de forma "fluida" desde `startY`, saltando de página con `doc.addPage()`
 * cuando hace falta. Devuelve el Y final.
 *
 * El caller debe resetear su propio cursor al valor devuelto, y tener un
 * `doc.on("pageAdded")` que reponga su `y` (este helper igual usa su `resetY`).
 */
export function renderMarkdownBlocks(doc: PDFKit.PDFDocument, text: string, o: MarkdownBlocksOpts): number {
  const fontSize    = o.fontSize ?? 9;
  const color       = o.color ?? "#0f172a";
  const borderColor = o.borderColor ?? "#cbd5e1";
  const headerBg    = o.headerBg ?? "#e2e8f0";
  const lineGap     = o.lineGap ?? 2;
  const font: InlineFont = { regular: o.fontRegular, bold: o.fontBold };

  let curY = o.startY;
  const ensure = (h: number) => {
    if (curY + h > o.contentBottom) { doc.addPage(); curY = o.resetY; }
  };

  for (const block of parseRichBlocks(text)) {
    if (block.type === "text") {
      for (const line of block.lines) {
        if (!line.trim()) { curY += fontSize * 0.5; continue; }
        const h = doc.fontSize(fontSize).font(font.regular)
          .heightOfString(sanitizePdfText(line) || " ", { width: o.width, lineGap });
        ensure(h);
        drawInlineBold(doc, line, o.x, curY, o.width, font, fontSize, color, lineGap);
        curY += h;
      }
    } else {
      const nCols = Math.max(block.header.length, ...block.rows.map(r => r.length), 1);
      const colW = o.width / nCols;
      const PAD = 3;
      const FS = Math.max(7, fontSize - 1);
      const measure = (cells: string[]) => {
        doc.fontSize(FS).font(font.regular);
        let maxH = 0;
        for (let c = 0; c < nCols; c++) {
          const hh = doc.heightOfString(sanitizePdfText(cells[c] ?? "") || " ", { width: colW - PAD * 2, lineGap });
          if (hh > maxH) maxH = hh;
        }
        return maxH + PAD * 2;
      };
      const drawRow = (cells: string[], header: boolean) => {
        const rowH = measure(cells);
        ensure(rowH);
        for (let c = 0; c < nCols; c++) {
          const cx = o.x + c * colW;
          if (header) doc.rect(cx, curY, colW, rowH).fillColor(headerBg).fill();
          doc.rect(cx, curY, colW, rowH).strokeColor(borderColor).lineWidth(0.5).stroke();
          if (header) {
            doc.fontSize(FS).font(font.bold).fillColor(color)
              .text(sanitizePdfText(cells[c] ?? ""), cx + PAD, curY + PAD, { width: colW - PAD * 2, lineGap });
          } else {
            drawInlineBold(doc, cells[c] ?? "", cx + PAD, curY + PAD, colW - PAD * 2, font, FS, color, lineGap);
          }
        }
        curY += rowH;
      };
      drawRow(block.header, true);
      for (const r of block.rows) drawRow(r, false);
      curY += 4;
    }
  }
  return curY;
}
