import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PUBLIC_DIR = join(process.cwd(), "..", "web-modern", "public");

// WinAnsi (Windows-1252) safe range for PDFKit built-in fonts (Helvetica, etc.).
// Characters outside this range are replaced with ASCII equivalents before rendering.
const WINANSI_SAFE = new Set<number>([
  // Windows-1252 extensions (0x80-0x9F mapped codepoints)
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6,
  0x2030, 0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C,
  0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A,
  0x0153, 0x017E, 0x0178,
]);

function isWinAnsiSafe(cp: number): boolean {
  return cp <= 0xFF || WINANSI_SAFE.has(cp);
}

/**
 * Sanitize text for PDFKit built-in fonts (Helvetica / WinAnsi encoding).
 * Replaces known technical Unicode symbols with ASCII equivalents and
 * strips any remaining characters outside WinAnsi to prevent garbled output.
 */
export function sanitizePdfText(s: string, opts: { keepMarkdown?: boolean } = {}): string {
  let t = s;
  if (!opts.keepMarkdown) {
    // Strip markdown bold/italic. Skip when caller plans to interpret the
    // markdown inline (see `renderLabeledTextBox({ markdown: true })`).
    t = t
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1");
  }
  return t
    // Mathematical comparison operators — \uXXXX escapes only, no literal Unicode chars
    .replace(/[≥≧⩾]/g, ">=")   // ≥ ≧ ⩾
    .replace(/[≤≦⩽]/g, "<=")   // ≤ ≦ ⩽
    .replace(/≠/g, "!=")                  // ≠
    .replace(/≈/g, "~=")                  // ≈
    .replace(/∞/g, "inf")                 // ∞
    .replace(/√/g, "sqrt")                // √
    .replace(/∑/g, "sum")                 // ∑
    .replace(/[Δ∆]/g, "Delta")       // Δ ∆
    // Arrows
    .replace(/[→⟹⇒]/g, "->")   // → ⟹ ⇒
    .replace(/[←⟸⇐]/g, "<-")   // ← ⟸ ⇐
    .replace(/↑/g, "^")                   // ↑
    .replace(/↓/g, "v")                   // ↓
    .replace(/↔/g, "<->")                 // ↔
    // Greek letters
    .replace(/Ω/g, "Ohm")                 // Ω
    .replace(/μ/g, "u")                   // μ
    .replace(/Σ/g, "Sigma")               // Σ
    .replace(/π/g, "pi")                  // π
    .replace(/α/g, "alpha")               // α
    .replace(/β/g, "beta")                // β
    .replace(/γ/g, "gamma")               // γ
    .replace(/λ/g, "lambda")              // λ
    .replace(/ρ/g, "rho")                 // ρ
    .replace(/θ/g, "theta")               // θ
    .replace(/φ/g, "phi")                 // φ
    // Checkbox-like symbols → plain marker
    .replace(/[ð☐☑☒□■✓✔✘]/g, "[ ]")
    // Fallback: replace any remaining non-WinAnsi char
    .replace(/[\s\S]/g, ch => {
      const cp = ch.codePointAt(0) ?? 0;
      if (isWinAnsiSafe(cp)) return ch;
      if (cp >= 0x2212 && cp <= 0x2215) return "-";
      return "?";
    });
}

export const LOGO_PATH = join(PUBLIC_DIR, "logo.png");

// ─────────────────────────────────────────────────────────────────────────────
// Multi-page text segmentation
//
// Use case: an information box (label + multi-line text) that may not fit in
// the remaining space of the current page. The naive approach (`ensureSpace`
// → draw single rectangle → render text) breaks visually when the rectangle
// height exceeds available space: text overflows the rectangle, the border
// gets clipped, and subsequent pages show text without any box around it.
//
// `splitTextIntoPageSegments` solves this by pre-measuring each line of the
// text and grouping them into segments that respect page breaks. Each segment
// can then be rendered independently with its own box + label, giving a clean
// "(cont.)" continuation experience.
// ─────────────────────────────────────────────────────────────────────────────

export type TextSegment = {
  /** Lines joined with \n that fit in this segment. */
  text: string;
  /** Total content height (sum of line heights), no padding. */
  contentHeight: number;
  /** True for segments after the first one. */
  isContinuation: boolean;
};

/**
 * Splits `text` into segments that respect page boundaries.
 *
 * Caller passes available content space for the first segment (usually the
 * remaining space on the current page minus label + padding) and for any
 * continuation segment (usually a full page of content space minus label +
 * padding). The function measures each `\n`-separated line at the given font
 * settings, then groups lines greedily.
 *
 * If a single line is taller than the available space, it goes alone in its
 * segment (PDFKit will wrap it to multiple visual lines and the rectangle
 * may still overflow — this case is rare in practice).
 */
export function splitTextIntoPageSegments(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  fontConfig: { font: string; fontSize: number; lineGap?: number },
  firstSegmentAvailable: number,
  continuationAvailable: number,
): TextSegment[] {
  const safeText = text || " ";
  doc.fontSize(fontConfig.fontSize).font(fontConfig.font);
  const lines = safeText.split("\n");
  const lineHeights = lines.map((l) =>
    doc.heightOfString(l || " ", { width, lineGap: fontConfig.lineGap ?? 0 }),
  );

  const segments: TextSegment[] = [];
  let curLines: string[] = [];
  let curHeight = 0;
  let available = firstSegmentAvailable;

  for (let i = 0; i < lines.length; i++) {
    if (curHeight + lineHeights[i] > available && curLines.length > 0) {
      segments.push({
        text: curLines.join("\n"),
        contentHeight: curHeight,
        isContinuation: segments.length > 0,
      });
      curLines = [];
      curHeight = 0;
      available = continuationAvailable;
    }
    curLines.push(lines[i]);
    curHeight += lineHeights[i];
  }

  segments.push({
    text: curLines.join("\n"),
    contentHeight: curHeight,
    isContinuation: segments.length > 0,
  });

  return segments;
}

// ─────────────────────────────────────────────────────────────────────────────
// Labeled text box (multi-page safe, optional **bold** markdown)
//
// USE THIS for any PDF section that has:
//   - a small uppercase label
//   - a body of free-form text that may overflow the page
//   - a gray "badge" background that must visually contain the text
//
// Why: rolling your own (single roundedRect + doc.text) breaks the moment the
// text exceeds the page — pdfkit auto-paginates the text but doesn't redraw
// the rectangle, leaving the continuation floating on white. The MOC PDF had
// exactly this bug. Always go through this helper instead.
//
// Set `markdown: true` to interpret **bold** segments inline.
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderLabeledTextBoxOptions {
  /** Section label (rendered uppercased; continuation pages append " (CONT.)"). */
  label: string;
  /** Body text. Use "\n" for line breaks. Pass empty string to render "—". */
  text: string;
  /** Left X of the box. */
  x: number;
  /** Starting Y. The helper updates the caller's cursor via the returned value. */
  y: number;
  /** Full box width. Inner text width = `width - 2*padding`. */
  width: number;
  /** Bottom Y for the current page content area. */
  pageBottom: number;
  /** Top Y to use when a new page is added (typically vertical margin). */
  pageTop: number;
  /** Label position: above the box (default) or inside the top of the box. */
  labelPosition?: "above" | "inside";
  /** Reserved height for the label when `labelPosition: "above"`. Default 11. */
  labelHeightAbove?: number;
  /** Reserved height for the label band when `labelPosition: "inside"`. Default 18. */
  labelHeightInside?: number;
  /** Font size for the label. Default 7 (above) / 8 (inside). */
  labelFontSize?: number;
  /** Label color. Default "#64748b" (slate-500). */
  labelColor?: string;
  /** Body font size. Default 9. */
  fontSize?: number;
  /** Body text color. Default "#0f172a" (slate-900). */
  textColor?: string;
  /** Line gap (pdfkit lineGap). Default 2. */
  lineGap?: number;
  /** Inner padding on all 4 sides. Default 6 (above-label) / 10 (inside-label). */
  padding?: number;
  /** Box background. Default "#f8fafc" (slate-50). */
  bg?: string;
  /** Box border. Default "#e2e8f0" (slate-200). */
  border?: string;
  /** Corner radius. Default 3. */
  cornerRadius?: number;
  /** Gap appended after the box. Default 6. */
  sectionGap?: number;
  /** Interpret `**bold**` segments inline. Default false. */
  markdown?: boolean;
  /** Optional callback fired after each `doc.addPage()` (e.g., to reset header). */
  onPageAdd?: () => void;
}

/**
 * Renders a labeled text box that automatically segments across pages, so the
 * gray badge always visually contains the text. Returns the new Y cursor.
 *
 * The text is pre-measured line-by-line with `heightOfString` (with `**`
 * stripped if `markdown: true`), split into page-fitting chunks, and each
 * chunk is rendered with its own rectangle. Continuation pages get a label
 * suffix " (CONT.)" for auditor clarity.
 */
export function renderLabeledTextBox(
  doc: PDFKit.PDFDocument,
  opts: RenderLabeledTextBoxOptions,
): number {
  const labelPosition   = opts.labelPosition ?? "above";
  const padding         = opts.padding ?? (labelPosition === "inside" ? 10 : 6);
  const labelHeight     = labelPosition === "inside"
    ? (opts.labelHeightInside ?? 18)
    : (opts.labelHeightAbove ?? 11);
  const labelFontSize   = opts.labelFontSize ?? (labelPosition === "inside" ? 8 : 7);
  const labelColor      = opts.labelColor ?? "#64748b";
  const fontSize        = opts.fontSize ?? 9;
  const textColor       = opts.textColor ?? "#0f172a";
  const lineGap         = opts.lineGap ?? 2;
  const bg              = opts.bg ?? "#f8fafc";
  const border          = opts.border ?? "#e2e8f0";
  const cornerRadius    = opts.cornerRadius ?? 3;
  const sectionGap      = opts.sectionGap ?? 6;
  const markdown        = opts.markdown ?? false;
  const onPageAdd       = opts.onPageAdd;

  const safeText = sanitizePdfText(opts.text || "—", { keepMarkdown: markdown });
  const innerW = opts.width - padding * 2;

  // For "inside" labels the label sits inside the box top; the text body
  // height accounts only for the text, not for the label band.
  const insideLabelBand = labelPosition === "inside" ? labelHeight : 0;
  // For "above" labels we reserve labelHeight above the box on every chunk.
  const aboveLabelBand = labelPosition === "above" ? labelHeight : 0;

  // Pre-measure each logical line. Para markdown se mide en Helvetica-Bold (la
  // fuente más ancha): es una cota SUPERIOR de la altura real con tramos
  // **negrita** mixtos, así nunca se subestima y el siguiente bloque no se
  // solapa con el cuadro (la negrita wrapea a más líneas que el texto regular).
  const rawLines = safeText.split(/\r?\n/);
  const measureFont = markdown ? "Helvetica-Bold" : "Helvetica";
  const lineHeights = rawLines.map(l => {
    const stripped = markdown ? l.replace(/\*\*/g, "") : l;
    if (!stripped.trim()) return fontSize + lineGap;
    doc.fontSize(fontSize).font(measureFont);
    return doc.heightOfString(stripped, { width: innerW, lineGap });
  });

  let y = opts.y;

  // If the page has less than (label + min 22pt content + 2*padding + gap)
  // available, jump to next page first to avoid orphan labels.
  const minStart = aboveLabelBand + insideLabelBand + 22 + padding * 2 + sectionGap;
  if ((opts.pageBottom - y) < minStart) {
    doc.addPage();
    onPageAdd?.();
    y = opts.pageTop;
  }

  let idx = 0;
  let isFirstChunk = true;
  while (idx < rawLines.length) {
    // Above-label
    if (labelPosition === "above") {
      const labelText = isFirstChunk
        ? opts.label.toUpperCase()
        : opts.label.toUpperCase() + " (CONT.)";
      doc.fontSize(labelFontSize).font("Helvetica-Bold").fillColor(labelColor)
        .text(labelText, opts.x, y, { width: opts.width, characterSpacing: 0.6 });
      y += labelHeight;
    }

    const startY = y;
    // Inner max excludes the inside-label band (if any), top+bottom padding,
    // and the gap appended after the box.
    const innerMax = opts.pageBottom - startY - padding * 2 - insideLabelBand - sectionGap;

    // Accumulate lines that fit in innerMax. Always include the first line
    // of the chunk (defensive against pathological cases where a single line
    // is taller than the available space — better overflow once than loop).
    let used = 0;
    const startIdx = idx;
    while (idx < rawLines.length) {
      const h = lineHeights[idx];
      if (idx > startIdx && used + h > innerMax) break;
      used += h;
      idx++;
    }

    const boxH = Math.max(22, used + padding * 2 + insideLabelBand);
    doc.roundedRect(opts.x, startY, opts.width, boxH, cornerRadius).fill(bg);
    doc.roundedRect(opts.x, startY, opts.width, boxH, cornerRadius).strokeColor(border).lineWidth(0.5).stroke();

    // Inside-label
    let textTop = startY + padding;
    if (labelPosition === "inside") {
      const labelText = isFirstChunk
        ? opts.label.toUpperCase()
        : opts.label.toUpperCase() + " (CONT.)";
      doc.fontSize(labelFontSize).font("Helvetica-Bold").fillColor(labelColor)
        .text(labelText, opts.x + padding, startY + padding, { width: innerW });
      textTop = startY + padding + labelHeight;
    }

    const chunkText = rawLines.slice(startIdx, idx).join("\n");
    if (markdown) {
      renderInlineBoldText(doc, chunkText, opts.x + padding, textTop, innerW, fontSize, lineGap, textColor);
    } else {
      doc.fontSize(fontSize).font("Helvetica").fillColor(textColor)
        .text(chunkText, opts.x + padding, textTop, { width: innerW, lineGap });
    }

    y = startY + boxH + sectionGap;
    isFirstChunk = false;

    if (idx < rawLines.length) {
      doc.addPage();
      onPageAdd?.();
      y = opts.pageTop;
    }
  }

  return y;
}

/**
 * Splits a single line on `**bold**` markers. Internal helper.
 */
function tokenizeBoldSegments(line: string): Array<{ text: string; bold: boolean }> {
  const segments: Array<{ text: string; bold: boolean }> = [];
  let rest = line;
  while (rest.length > 0) {
    const m = rest.match(/^\*\*([^*]+)\*\*/);
    if (m) {
      segments.push({ text: m[1]!, bold: true });
      rest = rest.slice(m[0].length);
      continue;
    }
    const idx = rest.indexOf("**");
    if (idx === -1) {
      segments.push({ text: rest, bold: false });
      rest = "";
    } else {
      if (idx > 0) segments.push({ text: rest.slice(0, idx), bold: false });
      rest = rest.slice(idx);
    }
  }
  return segments;
}

/**
 * Renders text with `**bold**` markdown inline, using pdfkit's cursor (which
 * handles word wrap correctly). Each logical line is a sequence of continued
 * segments closed by `continued: false` on the last segment.
 *
 * Used internally by `renderLabeledTextBox` when `markdown: true`. Exported
 * for advanced cases where you need bold rendering outside a labeled box.
 */
export function renderInlineBoldText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  startY: number,
  width: number,
  fontSize: number,
  lineGap: number,
  color: string = "#0f172a",
): void {
  const lines = text.split(/\r?\n/);
  doc.fontSize(fontSize).fillColor(color);
  let firstOfLine = true;
  doc.x = x;
  doc.y = startY;

  for (const rawLine of lines) {
    const line = rawLine;
    if (!line.trim()) {
      doc.text(" ", x, doc.y, { width, lineGap });
      firstOfLine = true;
      continue;
    }
    const segments = tokenizeBoldSegments(line);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const last = i === segments.length - 1;
      doc.font(seg.bold ? "Helvetica-Bold" : "Helvetica").fillColor(color);
      if (firstOfLine) {
        doc.text(seg.text, x, doc.y, { continued: !last, width, lineGap });
        firstOfLine = false;
      } else {
        doc.text(seg.text, { continued: !last, width, lineGap });
      }
      if (last) firstOfLine = true;
    }
  }
}

/**
 * Resolves the tenant logo buffer from local files only.
 * Looks for public/{slug}.{ext} (case-insensitive). Returns null if not found.
 *
 * Previously had a fallback that fetched logoUrl/logoUrlLight via HTTP — removed
 * (R-15 / H-01 SSRF). User-controlled tenant settings could trigger requests
 * to arbitrary URLs, including internal services. Local files are the only
 * trusted source; if a tenant needs a custom logo, it must be uploaded as a
 * file under public/.
 */
export async function resolveTenantLogo(
  slug: string,
  _logoUrl: string | null | undefined,
  _logoUrlLight: string | null | undefined,
): Promise<Buffer | null> {
  if (existsSync(PUBLIC_DIR)) {
    try {
      const files = readdirSync(PUBLIC_DIR);
      const slugLower = slug.toLowerCase();
      const match = files.find(f => f.toLowerCase().replace(/\.[^.]+$/, "") === slugLower);
      if (match) {
        return readFileSync(join(PUBLIC_DIR, match));
      }
    } catch { /* non-blocking */ }
  }

  return null;
}
