// Exportación a Word (.doc) vía HTML-como-msword.
//
// Genera un HTML compatible con Microsoft Word (lo abre editable) y lo sirve con
// Content-Type application/msword. No requiere librerías nuevas. Replica la
// estética del "documento controlado" (cabecera navy, bordes, footer) con tablas
// HTML — el mismo chrome que pdf-form-chrome.ts pero en HTML.

import type { ServerResponse } from "node:http";
import { FORM_COLORS, type ControlledDocMeta } from "./pdf-form-chrome";

const { NAVY, GRAY, BORDER, LIGHT } = FORM_COLORS;

// ── Escape HTML ──────────────────────────────────────────────────────────────
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Texto multilínea → HTML con <br>. */
export function escMultiline(v: unknown): string {
  return esc(v).replace(/\r?\n/g, "<br>");
}

/** Buffer de imagen → data URI base64 (detecta png/jpeg/gif/webp por magic bytes). */
export function bufferToDataUri(buf: Buffer | null | undefined): string | null {
  if (!buf || buf.length < 4) return null;
  let mime = "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
  else if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) mime = "image/gif";
  else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46) mime = "image/webp";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * Tamaño en píxeles de un PNG (chunk IHDR) o JPEG (marcadores SOFn).
 *
 * Word ignora `max-width` y `height:auto`: hay que darle ancho Y alto explícitos.
 * Sin conocer la proporción real, un logo casi cuadrado metido en una caja
 * apaisada sale estirado. Devuelve null si no se puede determinar.
 */
export function imagePixelSize(buf: Buffer | null | undefined): { w: number; h: number } | null {
  if (!buf || buf.length < 24) return null;
  // PNG: 8 bytes de firma + chunk IHDR (largo 4 + tipo 4 + ancho 4 + alto 4).
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // JPEG: recorrer segmentos hasta un SOF (0xC0..0xCF, salvo C4/C8/CC).
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/**
 * Ancho/alto en cm para que la imagen entre en la caja respetando su proporción.
 * Sin tamaño conocido, cae a la caja completa (comportamiento anterior).
 */
export function fitLogoBox(
  size: { w: number; h: number } | null,
  boxWcm = 3.5,
  boxHcm = 2,
): { wcm: number; hcm: number } {
  if (!size || size.w <= 0 || size.h <= 0) return { wcm: boxWcm, hcm: boxHcm };
  const scale = Math.min(boxWcm / size.w, boxHcm / size.h);
  return { wcm: +(size.w * scale).toFixed(2), hcm: +(size.h * scale).toFixed(2) };
}

// ── Wrapper Word ─────────────────────────────────────────────────────────────
export interface WordDocOptions {
  title: string;
  bodyHtml: string;
  /** HTML del footer (banda de aprobación). Se repite en cada página vía mso-footer. */
  footerHtml?: string;
}

/** El .doc es HTML; el .docx lo reusa adentro del contenedor OOXML (ver docx-export). */
export function wrapAsWordDoc(opts: WordDocOptions): Buffer {
  return Buffer.from(buildWordHtml(opts), "utf-8");
}

export function buildWordHtml(opts: WordDocOptions): string {
  const footerBlock = opts.footerHtml
    ? `<div style="mso-element:footer" id="f1">${opts.footerHtml}</div>`
    : "";
  const msoFooter = opts.footerHtml ? "mso-footer:f1;" : "";

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${esc(opts.title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
@page Section1 { size:595.3pt 841.9pt; margin:1.4cm 1.1cm 1.4cm 1.1cm; ${msoFooter} mso-footer-margin:0.6cm; }
div.Section1 { page:Section1; }
body { font-family:Arial, Helvetica, sans-serif; font-size:9pt; color:#111827; line-height:100%; mso-line-height-rule:exactly; }
p { margin:0; mso-margin-top-alt:0; margin-bottom:0; mso-margin-bottom-alt:0; line-height:100%; mso-line-height-rule:exactly; }
table { border-collapse:collapse; width:100%; table-layout:fixed; }
td, th { border:0.5pt solid ${BORDER}; padding:3pt 5pt; vertical-align:middle; word-wrap:break-word; line-height:100%; mso-line-height-rule:exactly; }
.sec td { background:${NAVY}; color:#fff; font-weight:bold; font-size:8pt; letter-spacing:0.4pt; text-transform:uppercase; }
.lbl { background:${NAVY}; color:#fff; font-weight:bold; font-size:8pt; }
.hdr td { background:${LIGHT}; color:${GRAY}; font-weight:bold; font-size:7pt; text-align:center; }
.box { border:0.5pt solid ${BORDER}; min-height:30pt; padding:4pt 6pt; }
.cbx { display:inline-block; width:9pt; height:9pt; border:0.7pt solid ${GRAY}; text-align:center; line-height:9pt; font-size:7pt; vertical-align:middle; }
.muted { color:${GRAY}; }
.center { text-align:center; }
.spacer { height:8pt; border:none; }
</style>
</head>
<body lang="ES">
<div class="Section1">
${opts.bodyHtml}
${footerBlock}
</div>
</body>
</html>`;
  return html;
}

// ── Servir como .doc ─────────────────────────────────────────────────────────
export function serveDoc(response: ServerResponse, buffer: Buffer, filename: string): void {
  const safe = filename.endsWith(".doc") ? filename : `${filename}.doc`;
  response.writeHead(200, {
    "Content-Type": "application/msword; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safe}"`,
    "Content-Length": buffer.length,
  });
  response.end(buffer);
}

// ── Helpers de chrome (HTML) ─────────────────────────────────────────────────

/** Cabecera del documento controlado: logo + código + título + caja Revisión/Desde/Página/Controlado. */
export function docControlledHeader(
  meta: ControlledDocMeta,
  logoDataUri: string | null,
  tenantName: string,
  /** Tamaño real del logo en píxeles: sin él la imagen se estira a la caja. */
  logoSize?: { w: number; h: number } | null,
): string {
  // Word ignora max-width/height: hay que dar ancho/alto explícitos. El logo
  // entra en una caja de 3,5cm × 2cm respetando su proporción.
  const { wcm, hcm } = fitLogoBox(logoSize ?? null);
  const logoCell = logoDataUri
    ? `<img src="${logoDataUri}" width="${Math.round(wcm * 37.8)}" height="${Math.round(hcm * 37.8)}" style="width:${wcm}cm;height:${hcm}cm;" alt="logo">`
    : `<b style="color:${NAVY};font-size:8pt;">${esc(tenantName)}</b>`;
  return `<table>
  <tr>
    <td rowspan="4" style="width:22%;text-align:center;">${logoCell}</td>
    <td rowspan="4" style="width:53%;text-align:center;">
      <b style="color:${NAVY};font-size:10pt;">${esc(meta.formCode)}</b><br>
      <b style="color:${NAVY};font-size:11pt;">${esc(meta.title)}</b>
    </td>
    <td style="width:13%;font-size:7pt;color:${GRAY};">Revision N°</td>
    <td style="width:12%;text-align:center;"><b>${esc(meta.revision)}</b></td>
  </tr>
  <tr><td style="font-size:7pt;color:${GRAY};">Desde:</td><td class="center"><b>${esc(meta.effectiveFrom)}</b></td></tr>
  <tr><td style="font-size:7pt;color:${GRAY};">Pagina:</td><td class="center"><b>1</b></td></tr>
  <tr><td colspan="2" class="center"><b style="color:#1d4ed8;font-size:7pt;">Documento Controlado</b></td></tr>
</table>`;
}

/** Footer del documento controlado: banda Elaborado/Revisado/Aprobado. */
export function docControlledFooter(meta: ControlledDocMeta): string {
  const cell = (label: string, value: string) =>
    `<td style="border:none;border-top:0.5pt solid ${BORDER};font-size:7pt;color:${GRAY};text-align:center;">${esc(label)} ${esc(value)}</td>`;
  return `<table>
  <tr>
    ${cell("Elaborado:", meta.preparedBy)}
    ${cell("Revisado:", meta.reviewedBy)}
    ${cell("Aprobado:", meta.approvedBy)}
  </tr>
</table>`;
}

/** Barra de sección azul marino con título. */
export function docSection(title: string): string {
  return `<table class="sec"><tr><td>${esc(title)}</td></tr></table>`;
}

/** Fila de pares etiqueta(navy) + valor. cols: [{label, value, labelWidth?, color?}]. */
export interface DocKvCol { label: string; value: string; labelWidth?: string; valueWidth?: string; color?: string }
export function docKvRow(cols: DocKvCol[]): string {
  const cells = cols.map(c => {
    const lw = c.labelWidth ? ` style="width:${c.labelWidth}"` : "";
    const vw = c.valueWidth ? ` style="width:${c.valueWidth};${c.color ? `color:${c.color};font-weight:bold;` : ""}"` : (c.color ? ` style="color:${c.color};font-weight:bold;"` : "");
    return `<td class="lbl"${lw}>${esc(c.label)}</td><td${vw}>${esc(c.value)}</td>`;
  }).join("");
  return `<table><tr>${cells}</tr></table>`;
}

/** Tabla con cabecera gris + filas. */
export function docTable(headers: string[], rows: string[][], emptyRows = 0): string {
  const head = `<tr class="hdr">${headers.map(h => `<td>${esc(h)}</td>`).join("")}</tr>`;
  const body = rows.map(r => `<tr>${r.map(c => `<td>${escMultiline(c)}</td>`).join("")}</tr>`).join("");
  let empties = "";
  for (let i = 0; i < emptyRows; i++) {
    empties += `<tr>${headers.map(() => `<td>&nbsp;</td>`).join("")}</tr>`;
  }
  return `<table>${head}${body}${empties}</table>`;
}

/** Fila de checkboxes con etiqueta. */
export function docCheckboxRow(opts: string[], selected: string[]): string {
  const cells = opts.map(o => {
    const on = selected.includes(o);
    const box = `<span class="cbx">${on ? "X" : ""}</span>`;
    return `<td class="center">${box} ${esc(o)}</td>`;
  }).join("");
  return `<table><tr>${cells}</tr></table>`;
}

// ── Markdown → HTML (GFM-lite) para los campos de texto ──────────────────────
// Soporta: **negrita**, tablas con pipes (| a | b |), encabezados (#) y viñetas (-).
// Pensado para Word: tablas con borde (grilla) y <b> real.

/** Inline: escapa y convierte **negrita**. */
export function mdInline(text: string): string {
  return esc(text).replace(/\*\*([^*]+?)\*\*/g, "<b>$1</b>");
}

function splitTableRow(line: string): string[] {
  let cells = line.split("|").map(s => s.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

function isTableSeparator(line: string): boolean {
  return /-/.test(line) && /^[\s|:\-]+$/.test(line) && /\|/.test(line);
}

export function mdToHtml(raw: string): string {
  const lines = (raw ?? "").split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Tabla: línea con | seguida de separador |---|---|
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && !isTableSeparator(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const head = `<tr class="hdr">${header.map(c => `<td>${mdInline(c)}</td>`).join("")}</tr>`;
      const body = rows.map(r => `<tr>${r.map(c => `<td>${mdInline(c)}</td>`).join("")}</tr>`).join("");
      out.push(`<table style="margin:2pt 0;">${head}${body}</table>`);
      continue;
    }
    // Encabezado markdown (#) → línea en negrita
    const h = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) { out.push(`<p style="margin:3pt 0 1pt;"><b>${mdInline(h[1])}</b></p>`); i++; continue; }
    // Viñeta (- o *)
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    if (b) { out.push(`<p style="margin:0 0 0 14pt;">• ${mdInline(b[1])}</p>`); i++; continue; }
    // Línea en blanco
    if (!line.trim()) { out.push(`<p style="margin:0;">&nbsp;</p>`); i++; continue; }
    // Párrafo normal
    out.push(`<p style="margin:1pt 0;">${mdInline(line)}</p>`);
    i++;
  }
  return out.join("");
}

/** Caja de texto con borde (para descripciones / áreas a completar). Interpreta Markdown. */
export function docTextBox(text: string, minHeight = "30pt"): string {
  const content = text && text.trim() ? mdToHtml(text) : "&nbsp;";
  return `<div class="box" style="min-height:${minHeight}">${content}</div>`;
}

/** Espaciador vertical (~1cm entre secciones). */
export function docSpacer(): string {
  return `<table><tr><td class="spacer"></td></tr></table>`;
}
