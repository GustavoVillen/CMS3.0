// Cuerpo gráfico del PDF del Informe de salud del equipo (rediseño sep 2026,
// prototipo V1 aprobado: claude/mockups/informe-salud-pdf/preview-v1.html).
//
// Lo comparten las dos versiones del PDF (documento controlado de Mercurio y
// estándar): ambas dibujan el mismo cuerpo y sólo cambia el encabezado/pie.
//
// Reglas de color: salen SÓLO de los conteos del sistema (`metrics`), nunca de la
// IA. Verde = sin alertas · ámbar = por vencer / precaución / defectos abiertos /
// postergaciones activas · rojo = tareas vencidas o análisis crítico. Todo estado
// va con color + ícono + palabra, para que también se lea impreso en blanco y negro.
//
// Paginación (skill pms-pdf-generation): nada de rectángulos de fondo que dependan
// de texto libre. Cada fila (recomendación, viñeta) se mide y se dibuja por sí sola
// y las cajas se arman fila por fila, así un texto largo pasa de página sin dejar
// el fondo atrás. El único texto libre "en caja" (limitaciones) usa
// renderLabeledTextBox.
import type { HealthMetrics, HealthReportText, HealthSources } from "../assets/asset-health-service";
import { sanitizePdfText } from "./pdf-helpers";

/** Cursor + salto de página del documento que dibuja (el canvas de Mercurio ya lo cumple). */
export interface Flow {
  y: number;
  ensureSpace(h: number): void;
}

export type Kind = "good" | "warn" | "bad" | "neu";

const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const SOFT = "#f1f5f9";
const NAVY = "#1e3a5f";

const KIND = {
  good: { fg: "#166534", bg: "#ecfdf5", line: "#86efac", solid: "#16a34a" },
  warn: { fg: "#92400e", bg: "#fffbeb", line: "#fcd34d", solid: "#d97706" },
  bad:  { fg: "#991b1b", bg: "#fef2f2", line: "#fca5a5", solid: "#dc2626" },
  neu:  { fg: "#475569", bg: "#f1f5f9", line: "#cbd5e1", solid: "#64748b" },
} as const;

const STATE_KIND: Record<string, { kind: Kind; label: string; note: string }> = {
  GOOD:      { kind: "good", label: "BUENO",    note: "Sin novedades" },
  ATTENTION: { kind: "warn", label: "ATENCIÓN", note: "Requiere atención" },
  RISK:      { kind: "bad",  label: "RIESGO",   note: "Requiere acción" },
};

// ── Primitivas ───────────────────────────────────────────────────────────────

/** Círculo con el símbolo del estado (✓ / ! / ✕ / i) dibujado con trazos, sin fuentes. */
function drawSymbol(
  doc: PDFKit.PDFDocument, kind: Kind, cx: number, cy: number, r: number,
  style: "solid" | "ring" = "solid",
) {
  const c = KIND[kind];
  const mark = style === "solid" ? "#ffffff" : c.solid;
  if (style === "solid") {
    doc.circle(cx, cy, r).fillColor(c.solid).fill();
  } else {
    doc.lineWidth(r * 0.17).circle(cx, cy, r).fillAndStroke("#ffffff", c.solid);
  }
  const lw = r * (style === "solid" ? 0.26 : 0.24);
  doc.lineWidth(lw).lineCap("round").lineJoin("round").strokeColor(mark);
  if (kind === "good") {
    doc.moveTo(cx - r * 0.42, cy + r * 0.05).lineTo(cx - r * 0.1, cy + r * 0.38).lineTo(cx + r * 0.46, cy - r * 0.32).stroke();
  } else if (kind === "warn") {
    doc.moveTo(cx, cy - r * 0.5).lineTo(cx, cy + r * 0.12).stroke();
    doc.circle(cx, cy + r * 0.48, lw * 0.6).fillColor(mark).fill();
  } else if (kind === "bad") {
    doc.moveTo(cx - r * 0.36, cy - r * 0.36).lineTo(cx + r * 0.36, cy + r * 0.36).stroke();
    doc.moveTo(cx + r * 0.36, cy - r * 0.36).lineTo(cx - r * 0.36, cy + r * 0.36).stroke();
  } else {
    doc.circle(cx, cy - r * 0.46, lw * 0.6).fillColor(mark).fill();
    doc.moveTo(cx, cy - r * 0.1).lineTo(cx, cy + r * 0.5).stroke();
  }
  doc.lineCap("butt").lineJoin("miter");
}

/** Etiqueta de estado: círculo con símbolo + palabra, con borde y fondo del color del estado. */
function drawPill(doc: PDFKit.PDFDocument, kind: Kind, text: string, x: number, y: number, align: "left" | "right" = "left"): number {
  const c = KIND[kind];
  const label = sanitizePdfText(text);
  doc.font("Helvetica-Bold").fontSize(6.8);
  const tw = doc.widthOfString(label);
  const h = 11.5, w = 4 + 7.2 + 3.5 + tw + 6;
  const px = align === "right" ? x - w : x;
  doc.lineWidth(0.6).roundedRect(px, y, w, h, h / 2).fillAndStroke(c.bg, c.line);
  drawSymbol(doc, kind, px + 4 + 3.6, y + h / 2, 3.6);
  doc.font("Helvetica-Bold").fontSize(6.8).fillColor(c.fg).text(label, px + 4 + 7.2 + 3.5, y + 2.9, { lineBreak: false });
  return w;
}

/** Barra apilada 100 % con esquinas redondeadas; los tramos en 0 no se dibujan. */
function drawStack(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, parts: Array<[number, string]>) {
  const total = parts.reduce((s, p) => s + Math.max(0, p[0]), 0);
  doc.save();
  doc.roundedRect(x, y, w, h, h / 2).clip();
  doc.rect(x, y, w, h).fillColor(SOFT).fill();
  if (total > 0) {
    let cx = x;
    const nonZero = parts.filter(p => p[0] > 0);
    nonZero.forEach((p, i) => {
      const pw = (p[0] / total) * w;
      doc.rect(cx, y, pw - (i < nonZero.length - 1 ? 1 : 0), h).fillColor(p[1]).fill();
      cx += pw;
    });
  }
  doc.restore();
}

function drawLegend(doc: PDFKit.PDFDocument, x: number, y: number, items: Array<[string, string]>) {
  doc.font("Helvetica").fontSize(6.3);
  let cx = x;
  for (const [color, text] of items) {
    const t = sanitizePdfText(text);
    doc.roundedRect(cx, y + 1, 5, 5, 1).fillColor(color).fill();
    doc.fillColor("#475569").text(t, cx + 7, y, { lineBreak: false });
    cx += 7 + doc.widthOfString(t) + 8;
  }
}

function nf(n: number, locale: string): string {
  return Math.round(n).toLocaleString(locale);
}

// ── Reglas de estado por conteo ──────────────────────────────────────────────

function planKind(m: HealthMetrics): { kind: Kind; text: string } {
  if (m.plansOverdue > 0) return { kind: "bad", text: "Vencidas" };
  if (m.plansDueSoon > 0) return { kind: "warn", text: "Por vencer" };
  return { kind: "good", text: "Al día" };
}
function labKind(m: HealthMetrics): { kind: Kind; text: string } {
  if (m.labBad > 0) return { kind: "bad", text: "Crítico" };
  if (m.labCaution > 0) return { kind: "warn", text: "Precaución" };
  return { kind: "good", text: "Sin alertas" };
}
function defectKind(m: HealthMetrics): { kind: Kind; text: string } {
  return m.defectsOpen > 0 ? { kind: "warn", text: m.defectsOpen === 1 ? "1 abierto" : `${m.defectsOpen} abiertos` } : { kind: "good", text: "Sin abiertos" };
}

// ── Bloques ──────────────────────────────────────────────────────────────────

export function drawFicha(
  doc: PDFKit.PDFDocument, flow: Flow, o: { x: number; w: number; vessel: string; equipment: string; code: string; period: string; generated: string },
) {
  const H = 30;
  flow.ensureSpace(H + 14);
  const { x, w } = o;
  const y = flow.y;
  const cols = [w * 0.24, w * 0.46, w * 0.30];
  doc.lineWidth(0.7).roundedRect(x, y, w, H, 4).strokeColor(LINE).stroke();
  let cx = x;
  const cells: Array<[string, string, string?]> = [
    ["EMBARCACIÓN", o.vessel],
    ["EQUIPO", o.equipment, o.code],
    ["PERÍODO ANALIZADO", o.period],
  ];
  cells.forEach(([lab, val, extra], i) => {
    if (i > 0) doc.moveTo(cx, y).lineTo(cx, y + H).strokeColor(LINE).lineWidth(0.7).stroke();
    doc.font("Helvetica").fontSize(6).fillColor(MUTED).text(lab, cx + 8, y + 5, { lineBreak: false, characterSpacing: 0.5 });
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK)
      .text(sanitizePdfText(val), cx + 8, y + 15, { width: cols[i]! - 14, lineBreak: false, ellipsis: true });
    if (extra) {
      const vw = doc.font("Helvetica-Bold").fontSize(9).widthOfString(sanitizePdfText(val));
      if (vw + 8 < cols[i]! - 60) doc.font("Helvetica").fontSize(8).fillColor("#1d4ed8").text(`· ${sanitizePdfText(extra)}`, cx + 8 + vw + 4, y + 16, { lineBreak: false });
    }
    cx += cols[i]!;
  });
  doc.font("Helvetica").fontSize(6.8).fillColor(MUTED).text(sanitizePdfText(o.generated), x, y + H + 4, { width: w, lineBreak: false });
  flow.y = y + H + 15;
}

/** Devuelve true si el resumen es tan largo que la tarjeta salió sin texto (el llamador lo imprime en una caja aparte). */
export function drawStateHero(
  doc: PDFKit.PDFDocument, flow: Flow, o: { x: number; w: number; healthState: string; summary: string },
): boolean {
  const st = STATE_KIND[o.healthState] ?? STATE_KIND.ATTENTION!;
  const c = KIND[st.kind];
  const { x, w } = o;
  const LEFT = 126, PAD = 14;
  const textW = w - LEFT - PAD * 2;
  const summary = sanitizePdfText(o.summary || "—");
  doc.font("Helvetica").fontSize(9.2);
  const textH = doc.heightOfString(summary, { width: textW, lineGap: 2 });
  const compact = textH > 190; // resumen fuera de lo normal: la tarjeta va sin texto y el resumen en una caja aparte
  const H = compact ? 96 : Math.max(98, 22 + textH + 6 + 28);

  flow.ensureSpace(H + 8);
  const y = flow.y;
  doc.lineWidth(1).roundedRect(x, y, w, H, 6).fillAndStroke(c.bg, c.line);
  doc.moveTo(x + LEFT, y + 8).lineTo(x + LEFT, y + H - 8).strokeColor(c.line).lineWidth(0.8).stroke();

  // Izquierda: ícono grande + estado
  drawSymbol(doc, st.kind, x + LEFT / 2, y + 32, 21, "ring");
  doc.font("Helvetica").fontSize(5.8).fillColor(MUTED).text("ESTADO DEL EQUIPO", x, y + 60, { width: LEFT, align: "center", characterSpacing: 0.6, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(15).fillColor(c.fg).text(st.label, x, y + 71, { width: LEFT, align: "center", lineBreak: false });

  // Derecha: lectura + escala
  const rx = x + LEFT + PAD;
  doc.font("Helvetica").fontSize(6.2).fillColor(MUTED)
    .text(`LECTURA GENERAL · ${st.note.toUpperCase()}`, rx, y + 10, { width: textW, characterSpacing: 0.5, lineBreak: false });
  if (!compact) doc.font("Helvetica").fontSize(9.2).fillColor(INK).text(summary, rx, y + 22, { width: textW, lineGap: 2 });
  else doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text("El resumen completo va debajo de esta tarjeta.", rx, y + 26, { width: textW, lineBreak: false });

  const scaleY = y + H - 24, segW = (textW - 6) / 3;
  const segs: Array<[Kind, string]> = [["good", "Bueno"], ["warn", "Atención"], ["bad", "Riesgo"]];
  segs.forEach(([k, label], i) => {
    const sx = rx + i * (segW + 3);
    const on = k === st.kind;
    doc.roundedRect(sx, scaleY, segW, 5, 2.5).fillColor(on ? KIND[k].solid : KIND[k].line).fill();
    doc.font(on ? "Helvetica-Bold" : "Helvetica").fontSize(6.2).fillColor(on ? KIND[k].fg : MUTED)
      .text(label, sx, scaleY + 8, { width: segW, align: "center", lineBreak: false });
  });
  flow.y = y + H + 8;
  return compact;
}

export function drawSectionTitle(doc: PDFKit.PDFDocument, flow: Flow, o: { x: number; w: number; title: string; note?: string; keepWith?: number }) {
  flow.ensureSpace(20 + (o.keepWith ?? 30));
  const y = flow.y + 4;
  const title = sanitizePdfText(o.title.toUpperCase());
  doc.font("Helvetica-Bold").fontSize(7.6).fillColor(NAVY).text(title, o.x, y, { lineBreak: false, characterSpacing: 0.8 });
  let endX = o.x + doc.widthOfString(title, { characterSpacing: 0.8 }) + 6;
  if (o.note) {
    const note = sanitizePdfText(`· ${o.note}`);
    doc.font("Helvetica").fontSize(6.8).fillColor(MUTED).text(note, endX, y + 0.6, { lineBreak: false });
    endX += doc.widthOfString(note) + 6;
  }
  doc.moveTo(endX, y + 4).lineTo(o.x + o.w, y + 4).strokeColor(LINE).lineWidth(0.8).stroke();
  flow.y = y + 14;
}

export function drawTiles(
  doc: PDFKit.PDFDocument, flow: Flow, o: { x: number; w: number; metrics: HealthMetrics; locale: string; fmtDate: (d: string) => string },
) {
  const m = o.metrics;
  const GAP = 6, TW = (o.w - GAP * 2) / 3, TH = 88;
  flow.ensureSpace(TH * 2 + GAP + 4);
  const planOk = Math.max(0, m.plansActive - m.plansOverdue - m.plansDueSoon);
  const woPrev = Math.max(0, m.workOrdersInPeriod - m.correctiveWorkOrders);
  const labOk = Math.max(0, m.labInPeriod - m.labBad - m.labCaution);
  const pk = planKind(m), lk = labKind(m), dk = defectKind(m);
  const G = KIND.good.solid, A = "#f59e0b", R = KIND.bad.solid, B = "#3b82f6", N = "#94a3b8";

  interface Tile {
    title: string; value: string; suffix: string; sub?: string;
    bar?: Array<[number, string]>; legend?: Array<[string, string]>;
    pill: { kind: Kind; text: string };
  }
  const tiles: Tile[] = [
    { title: "PLAN DE MANTENIMIENTO", value: String(m.plansOverdue), suffix: `de ${m.plansActive} tareas vencidas`,
      bar: [[planOk, G], [m.plansDueSoon, A], [m.plansOverdue, R]],
      legend: [[G, `${planOk} al día`], [A, `${m.plansDueSoon} por vencer`], [R, `${m.plansOverdue} vencidas`]], pill: pk },
    { title: "ÓRDENES DE TRABAJO (12 MESES)", value: String(m.workOrdersInPeriod), suffix: "ejecutadas",
      bar: [[woPrev, B], [m.correctiveWorkOrders, A]],
      legend: [[B, `${woPrev} preventivas`], [A, `${m.correctiveWorkOrders} correctivas`]],
      pill: { kind: "neu", text: m.workOrdersOpen > 0 ? (m.workOrdersOpen === 1 ? "1 abierta" : `${m.workOrdersOpen} abiertas`) : "Informativo" } },
    { title: "ANÁLISIS DE LABORATORIO", value: String(m.labInPeriod), suffix: "en el período",
      bar: [[labOk, G], [m.labCaution, A], [m.labBad, R]],
      legend: [[G, `${labOk} normal`], [A, `${m.labCaution} precaución`], [R, `${m.labBad} crítico`]], pill: lk },
    { title: "DEFECTOS", value: String(m.defectsOpen), suffix: "abiertos", sub: `${m.defectsInPeriod} registrados en el período`,
      ...(m.defectsInPeriod > 0 && m.defectsOpen <= m.defectsInPeriod
        ? { bar: [[m.defectsOpen, A], [m.defectsInPeriod - m.defectsOpen, N]] as Array<[number, string]>, legend: [[A, "abiertos"], [N, "cerrados"]] as Array<[string, string]> }
        : {}),
      pill: dk },
    { title: "POSTERGACIONES ACTIVAS", value: String(m.deferralsActive), suffix: m.deferralsActive === 1 ? "tarea diferida" : "tareas diferidas",
      sub: "Tareas del plan con fecha corrida",
      pill: m.deferralsActive > 0 ? { kind: "warn", text: "Activas" } : { kind: "good", text: "Ninguna" } },
    { title: "HORAS DE MARCHA", value: m.currentHours != null ? nf(m.currentHours, o.locale) : "—", suffix: m.currentHours != null ? "h" : "",
      sub: m.currentHoursDate ? `Última lectura al ${o.fmtDate(m.currentHoursDate)}` : "Sin lecturas",
      pill: { kind: "neu", text: "Dato del horómetro" } },
  ];

  const y0 = flow.y;
  tiles.forEach((t, i) => {
    const tx = o.x + (i % 3) * (TW + GAP), ty = y0 + Math.floor(i / 3) * (TH + GAP);
    doc.lineWidth(0.7).roundedRect(tx, ty, TW, TH, 5).strokeColor(LINE).stroke();
    doc.font("Helvetica-Bold").fontSize(5.9).fillColor(MUTED).text(sanitizePdfText(t.title), tx + 8, ty + 7, { width: TW - 16, characterSpacing: 0.5, lineBreak: false, ellipsis: true });
    doc.font("Helvetica-Bold").fontSize(17).fillColor(INK).text(sanitizePdfText(t.value), tx + 8, ty + 17, { lineBreak: false });
    const vw = doc.widthOfString(sanitizePdfText(t.value));
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(sanitizePdfText(t.suffix), tx + 8 + vw + 4, ty + 26, { width: TW - 20 - vw, lineBreak: false, ellipsis: true });
    if (t.sub) doc.font("Helvetica").fontSize(6.6).fillColor(MUTED).text(sanitizePdfText(t.sub), tx + 8, ty + 40, { width: TW - 16, lineBreak: false, ellipsis: true });
    if (t.bar) {
      const by = ty + (t.sub ? 51 : 45);
      drawStack(doc, tx + 8, by, TW - 16, 6.5, t.bar);
      if (t.legend) drawLegend(doc, tx + 8, by + 9.5, t.legend);
    }
    drawPill(doc, t.pill.kind, t.pill.text, tx + 8, ty + TH - 17);
  });
  flow.y = y0 + TH * 2 + GAP + 4;
}

function parseLines(text: string): { items: string[]; bullets: boolean } {
  const lines = sanitizePdfText(text || "", { keepMarkdown: false }).split("\n").map(l => l.trim()).filter(Boolean);
  const marker = /^([-•*]|\d+[.)])\s+/;
  const bullets = lines.some(l => marker.test(l)) || lines.length > 1;
  return { items: lines.map(l => l.replace(marker, "")), bullets };
}

/** Sugerencias: una fila por sugerencia (círculo numerado); la primera resaltada. */
export function drawRecommendations(
  doc: PDFKit.PDFDocument, flow: Flow, o: { x: number; w: number; items: string[]; highlightKind: Kind },
) {
  const items = o.items.map(t => sanitizePdfText(t)).filter(Boolean);
  const TX = o.x + 34, TWD = o.w - 34 - 10;
  items.forEach((t, i) => {
    doc.font("Helvetica").fontSize(9);
    const h = Math.max(26, doc.heightOfString(t, { width: TWD, lineGap: 1.5 }) + 12);
    flow.ensureSpace(h + 2);
    const y = flow.y;
    const first = i === 0 && o.highlightKind !== "good";
    doc.lineWidth(0.7).rect(o.x, y, o.w, h).fillAndStroke(first ? KIND[o.highlightKind].bg : "#ffffff", LINE);
    doc.circle(o.x + 17, y + 13, 7.5).fillColor(NAVY).fill();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff").text(String(i + 1), o.x + 17 - 7.5, y + 9.6, { width: 15, align: "center", lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(t, TX, y + 6.5, { width: TWD, lineGap: 1.5 });
    flow.y = y + h;
  });
  if (items.length === 0) {
    flow.ensureSpace(24);
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text("Sin sugerencias.", o.x, flow.y + 4, { lineBreak: false });
    flow.y += 24;
  }
  flow.y += 3;
  flow.ensureSpace(12);
  doc.font("Helvetica-Oblique").fontSize(6.8).fillColor(MUTED)
    .text("Ordenadas de mayor a menor urgencia. La decisión técnica es del Superintendente.", o.x, flow.y, { width: o.w, lineBreak: false });
  flow.y += 12;
}

/** Tarjeta por área: encabezado + una fila por viñeta, con franja de color por tramo (pasa de página sin romperse). */
export function drawAreaCard(
  doc: PDFKit.PDFDocument, flow: Flow, o: { x: number; w: number; kind: Kind; title: string; pill: string; text: string },
) {
  const c = KIND[o.kind];
  const { items, bullets } = parseLines(o.text || "—");
  const HEAD = 26, IND = bullets ? 13 : 0, TXW = o.w - 14 - IND - 8;
  const rowH = (t: string) => { doc.font("Helvetica").fontSize(9); return doc.heightOfString(t, { width: TXW, lineGap: 1.5 }) + 4.5; };
  const stripe = (y: number, h: number) => doc.rect(o.x, y, 3.5, h).fillColor(c.solid).fill();

  flow.ensureSpace(HEAD + rowH(items[0] ?? "—") + 4);
  const hy = flow.y + 6;
  doc.lineWidth(0.7).rect(o.x, hy, o.w, HEAD).fillAndStroke("#ffffff", LINE);
  stripe(hy, HEAD);
  drawSymbol(doc, o.kind, o.x + 20, hy + HEAD / 2, 7.5);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(sanitizePdfText(o.title), o.x + 34, hy + 8, { lineBreak: false });
  drawPill(doc, o.kind, o.pill, o.x + o.w - 8, hy + (HEAD - 11.5) / 2, "right");
  flow.y = hy + HEAD;

  items.forEach(t => {
    const h = rowH(t);
    flow.ensureSpace(h);
    const y = flow.y;
    doc.lineWidth(0.7);
    doc.moveTo(o.x + o.w, y).lineTo(o.x + o.w, y + h).strokeColor(LINE).stroke();
    doc.moveTo(o.x, y + h).lineTo(o.x + o.w, y + h).strokeColor(LINE).stroke();
    stripe(y, h);
    if (bullets) doc.circle(o.x + 14, y + 8, 2).fillColor(c.solid).fill();
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(t, o.x + 14 + IND, y + 3, { width: TXW, lineGap: 1.5 });
    flow.y = y + h;
  });
  flow.y += 2;
}

/** Evidencia revisada, como etiquetas; las que valen 0 van atenuadas. */
export function drawSourceChips(doc: PDFKit.PDFDocument, flow: Flow, o: { x: number; w: number; sources: HealthSources }) {
  const s = o.sources;
  const chips: Array<[number, string]> = [
    [s.plans, "planes"], [s.workOrders, "órdenes de trabajo"], [s.workLogs, "ejecuciones sin OT"],
    [s.labAnalyses, "análisis de laboratorio"], [s.defects, "defectos"], [s.deferrals, "postergaciones"],
    [s.inspections, "inspecciones"], [s.mocs, "MOC"], [s.hoursReadings, "lecturas de horas"], [s.alerts, "alertas automáticas"],
  ];
  const CH = 13, GAP = 4;
  let cx = o.x;
  flow.ensureSpace(CH + 4);
  let y = flow.y + 2;
  for (const [n, label] of chips) {
    const txt = sanitizePdfText(label);
    doc.font("Helvetica-Bold").fontSize(7);
    const nw = doc.widthOfString(String(n));
    doc.font("Helvetica").fontSize(7);
    const w = 8 + nw + 3 + doc.widthOfString(txt) + 8;
    if (cx + w > o.x + o.w) {
      flow.y = y + CH + GAP;
      flow.ensureSpace(CH + 4);
      y = flow.y;
      cx = o.x;
    }
    const zero = n === 0;
    doc.lineWidth(0.6).roundedRect(cx, y, w, CH, CH / 2).fillAndStroke(zero ? SOFT : "#ffffff", LINE);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(zero ? "#94a3b8" : INK).text(String(n), cx + 8, y + 3.4, { lineBreak: false });
    doc.font("Helvetica").fontSize(7).fillColor(zero ? "#94a3b8" : INK).text(txt, cx + 8 + nw + 3, y + 3.4, { lineBreak: false });
    cx += w + GAP;
  }
  flow.y = y + CH + 4;
}

export interface HealthBodyInput {
  x: number;
  w: number;
  locale: string;
  fmtDate: (d: string | Date | null | undefined) => string;
  healthState: string;
  metrics: HealthMetrics;
  text: HealthReportText;
  sources: HealthSources;
  /** Sólo el PDF de Mercurio: el estándar ya trae esos datos en su encabezado. */
  ficha?: { vessel: string; equipment: string; code: string; period: string; generated: string };
}

/**
 * Cuerpo completo del informe, en el orden aprobado: ficha · estado · números ·
 * sugerencias (página 1) · detalle por área · limitaciones · evidencia.
 * `textBox("", cuerpo)` imprime un texto libre en caja con su propio salto de página (cada
 * documento aporta el suyo: el canvas de Mercurio dibuja el pie en cada salto).
 */
export function drawHealthBody(
  doc: PDFKit.PDFDocument, flow: Flow, input: HealthBodyInput,
  textBox: (label: string, body: string) => void,
) {
  const { x, w, metrics: m, text } = input;
  if (input.ficha) drawFicha(doc, flow, { x, w, ...input.ficha });

  const compact = drawStateHero(doc, flow, { x, w, healthState: input.healthState, summary: text.summary });
  if (compact) {
    drawSectionTitle(doc, flow, { x, w, title: "Resumen", keepWith: 50 });
    textBox("", text.summary);
  }

  drawSectionTitle(doc, flow, { x, w, title: "Los números del equipo", note: "los calcula el sistema", keepWith: 170 });
  drawTiles(doc, flow, { x, w, metrics: m, locale: input.locale, fmtDate: d => input.fmtDate(d) });

  const st = STATE_KIND[input.healthState] ?? STATE_KIND.ATTENTION!;
  drawSectionTitle(doc, flow, { x, w, title: "Qué conviene revisar", note: "sugerencias", keepWith: 40 });
  drawRecommendations(doc, flow, { x, w, items: text.recommendations ?? [], highlightKind: st.kind });

  flow.y += 4;
  const pk = planKind(m), lk = labKind(m), dk = defectKind(m);
  // El detalle arranca en hoja propia si en la actual no entra el primer bloque.
  flow.ensureSpace(190);
  drawSectionTitle(doc, flow, { x, w, title: "Detalle por área", keepWith: 60 });
  drawAreaCard(doc, flow, { x, w, kind: pk.kind, title: "Mantenimiento planificado", pill: pk.text, text: text.maintenance });
  drawAreaCard(doc, flow, { x, w, kind: lk.kind, title: "Análisis de laboratorio", pill: lk.text, text: text.lab });
  drawAreaCard(doc, flow, { x, w, kind: dk.kind, title: "Defectos y fallas repetidas", pill: dk.text, text: text.defects });

  if (text.limitations) {
    flow.y += 4;
    drawSectionTitle(doc, flow, { x, w, title: "Limitaciones de la lectura", keepWith: 50 });
    textBox("", text.limitations);
    flow.y += 4;
  }

  flow.y += 4;
  drawSectionTitle(doc, flow, { x, w, title: "Qué se tuvo en cuenta", note: "evidencia revisada", keepWith: 24 });
  drawSourceChips(doc, flow, { x, w, sources: input.sources });

  flow.ensureSpace(14);
  doc.font("Helvetica-Oblique").fontSize(7.2).fillColor(NAVY)
    .text("Las sugerencias son orientativas; el diagnóstico y las decisiones técnicas son del Superintendente.", x, flow.y + 4, { width: w, lineBreak: false });
  flow.y += 16;
}

export type { HealthMetrics, HealthReportText, HealthSources };
