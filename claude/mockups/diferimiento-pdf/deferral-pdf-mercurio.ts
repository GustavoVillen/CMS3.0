// Template Mercurio (documento controlado) para el Informe de diferimiento.
// Renderer puro: recibe los datos ya cargados y devuelve un Buffer.
//
// Mismo lenguaje que los formularios de papel de Mercurio (REGI-MAN-02.4,
// REGI-LOG-01.3): barras azules de sección, grilla etiqueta/valor y recuadros
// de firma. Reusa el chrome del documento controlado y el textArea paginado de
// ../pdf-form-chrome (skill pms-pdf-generation).
//
// PROC-MAN no asigna un REGI al diferimiento. El punto que lo rige es
// PROC-MAN-03 §4.3: si el mantenimiento de un equipo crítico no se puede hacer
// como estaba previsto, antes del aplazamiento se hace una evaluación de riesgo
// documentada y aprobada por la gerencia. Si la empresa le asigna un número, se
// carga en la fila TenantForm DEFERRAL y sale en el header sin tocar código.

import PDFDocument from "../../../apps/api/node_modules/pdfkit";
import { sanitizePdfText } from "../../../apps/api/src/tenant/pms/pdf-helpers";
import { fmtDate as fmtDateTz } from "../../../apps/api/src/common/tenant-time";
import {
  FORM_COLORS, FOOTER_H, PAGE_H,
  drawControlledDocHeader, drawControlledDocFooter, createFormCanvas, renderRiskMatrix,
  type ControlledDocMeta,
} from "../../../apps/api/src/tenant/pms/pdf-form-chrome";

const PW       = 595.28;
const ML       = 36;
const MR       = 36;
const W        = PW - ML - MR;
const MARGIN_T = 36;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;
const SECTION_GAP = 6;

const { NAVY, WHITE, BLACK, GRAY, BORDER, LIGHT } = FORM_COLORS;

export interface MercurioDeferralSigner {
  name: string | null;
  /** Cargo · matrícula · experiencia (TenantMembership). */
  qualification: string | null;
  signature: Buffer | null;
}

export interface MercurioDeferralData {
  meta: ControlledDocMeta;
  logoBuffer: Buffer | null;
  tenantName: string;
  deferral: {
    deferralCode: string;
    status: string;
    requestedAt: Date | string;
    targetDate: Date | string | null;
    toNextDrydock: boolean;
    justification: string | null;
    compensatoryMeasures: string | null;
    riskLevel: string | null;
    riskProbability: string | null;
    riskConsequence: string | null;
    riskAnalysisResult: string | null;
    reviewNotes: string | null;
    decisionAt: Date | string | null;
    activeSince: Date | string | null;
    closedAt: Date | string | null;
    closeNotes: string | null;
    rejectionReason: string | null;
  };
  /** Nombre del buque (nunca el código). */
  vesselName: string;
  assetName: string | null;
  assetIsSafetyCritical: boolean;
  source: {
    typeLabel: string;
    code: string | null;
    title: string | null;
    description: string | null;
  };
  requester: MercurioDeferralSigner;
  /** Quien aprobó o rechazó. */
  decider: MercurioDeferralSigner;
  tz: string;
  locale: string;
}

const STATUS_LABEL: Record<string, string> = {
  REQUESTED:    "Solicitado",
  UNDER_REVIEW: "En revisión",
  APPROVED:     "Aprobado",
  REJECTED:     "Rechazado",
  ACTIVE:       "Vigente",
  EXPIRED:      "Vencido",
  CLOSED:       "Cerrado",
};
const PROB_LABEL: Record<string, string> = {
  LIKELY: "Muy probable", PROBABLE: "Probable", UNLIKELY: "Improbable", RARE: "Altamente improbable",
};
const CONS_LABEL: Record<string, string> = {
  FATALITY: "Fatalidad", MAJOR: "Lesiones importantes", MINOR: "Lesiones leves", NEGLIGIBLE: "Lesiones insignificantes",
};
const RISK_LEVEL_LABEL: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Crítico" };
const RISK_LEVEL_COLOR: Record<string, string> = { LOW: "#15803d", MEDIUM: "#b45309", HIGH: "#b91c1c", CRITICAL: "#7f1d1d" };

function val(v: unknown): string {
  const s = String(v ?? "").trim();
  return s || "—";
}

function daysBetween(from: Date | string | null | undefined, to: Date | string | null | undefined): string {
  if (!from || !to) return "—";
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b)) return "—";
  const days = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return `${days} día${days === 1 ? "" : "s"}`;
}

/**
 * Texto de un campo para el textArea del chrome: conserva **negrita** y tablas
 * `| a | b |`, y convierte los títulos Markdown (`## Título`) en una línea en
 * negrita. Sin esto los `##` salían impresos tal cual en el papel.
 */
function fieldText(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  if (!t) return "";
  const lines = t.split("\n")
    .filter((l) => !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l))
    .map((l) => {
      const m = l.match(/^\s*#{1,6}\s+(.*)$/);
      return m ? `**${m[1].replace(/\*\*/g, "").trim()}**` : l;
    });
  return sanitizePdfText(lines.join("\n"), { keepMarkdown: true });
}

export async function renderMercurioDeferralPdf(data: MercurioDeferralData): Promise<Buffer> {
  const { meta, logoBuffer, tenantName, deferral: d, vesselName, source, requester, decider, tz, locale } = data;
  const fmtDate = (v: unknown) => fmtDateTz(v as string | null | undefined, tz, locale);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: d.deferralCode } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const rightInfo = (page: number) =>
      [meta.formCode, d.deferralCode, vesselName, `Pagina ${page}`, fmtDate(new Date())].filter(Boolean).join(" — ");

    const canvas = createFormCanvas(doc, {
      ml: ML, w: W, marginT: MARGIN_T, contentBottom: CONTENT_BOTTOM,
      drawFooter: (page) => drawControlledDocFooter(doc, { meta, rightInfo: rightInfo(page), x: ML, w: W }),
    });
    const { sectionHeader, cell, textArea, ensureSpace } = canvas;

    // ── HEADER (documento controlado) ───────────────────────────────────────
    const hdrH = drawControlledDocHeader(doc, {
      meta, logoBuffer, tenantName, x: ML, y: MARGIN_T, w: W, page: canvas.page,
    });
    canvas.y = MARGIN_T + hdrH + 8;

    /**
     * Fila etiqueta/valor (etiqueta en azul, como la grilla de la OT). La fila
     * crece si un valor no entra en una línea.
     */
    function kvRow(pairs: Array<{ label: string; value: string; lw?: number; color?: string; bold?: boolean }>, h = 18) {
      const each = Math.floor(W / pairs.length);
      const geom = pairs.map((p, i) => {
        const lw = p.lw ?? 92;
        return { x: ML + i * each, lw, vw: (i === pairs.length - 1 ? W - i * each : each) - lw };
      });
      const values = pairs.map((p) => sanitizePdfText(p.value));
      const needed = values.map((v, i) =>
        canvas.measureCellHeight([v], [geom[i]!.vw], { fontSize: 8.5, bold: pairs[i]!.bold, minHeight: h }));
      const rowH = Math.max(h, ...needed);
      ensureSpace(rowH);
      pairs.forEach((p, i) => {
        const g = geom[i]!;
        cell(g.x, canvas.y, g.lw, rowH, p.label, { bold: true, fontSize: 7, bg: NAVY, color: WHITE });
        cell(g.x + g.lw, canvas.y, g.vw, rowH, values[i]!, {
          fontSize: 8.5, bold: p.bold, color: p.color, wrap: needed[i]! > h,
        });
      });
      canvas.y += rowH;
    }

    /** Rótulo gris de un recuadro de texto (no queda solo al pie de página). */
    function subLabel(text: string, keepWith = 28) {
      const H = 15;
      ensureSpace(H + keepWith);
      cell(ML, canvas.y, W, H, text, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY });
      canvas.y += H;
    }

    function textBox(text: string | null | undefined, minH = 32) {
      canvas.y += textArea(ML, canvas.y, W, fieldText(text), minH);
    }

    // ── IDENTIFICACIÓN ──────────────────────────────────────────────────────
    const critical = data.assetIsSafetyCritical;
    const target = d.toNextDrydock
      ? (d.targetDate ? `Próxima varada (${fmtDate(d.targetDate)})` : "Próxima varada")
      : fmtDate(d.targetDate);

    kvRow([
      { label: "EMBARCACIÓN", value: vesselName, bold: true },
      { label: "DIFERIMIENTO N°", value: d.deferralCode, bold: true, color: "#1d4ed8" },
    ]);
    kvRow([
      { label: "EQUIPO", value: val(data.assetName) + (critical ? "  ·  Equipo crítico" : ""), bold: true },
      { label: "ESTADO", value: STATUS_LABEL[d.status] ?? d.status },
    ]);
    kvRow([
      { label: "ORIGEN", value: source.typeLabel },
      { label: "N° DE ORIGEN", value: val(source.code) },
    ]);
    kvRow([
      { label: "FECHA SOLICITUD", value: fmtDate(d.requestedAt) },
      { label: "FECHA OBJETIVO", value: target, bold: true, color: d.targetDate || d.toNextDrydock ? "#b45309" : BLACK },
    ]);
    kvRow([
      { label: "PLAZO SOLICITADO", value: d.toNextDrydock && !d.targetDate ? "—" : daysBetween(d.requestedAt, d.targetDate) },
      { label: "SOLICITADO POR", value: val(requester.name) },
    ]);

    // ── TAREA DIFERIDA ──────────────────────────────────────────────────────
    canvas.y += SECTION_GAP;
    sectionHeader("Tarea diferida", 18, 18 + 40);
    kvRow([{ label: "TAREA", value: val(source.title), bold: true }]);
    if (source.description?.trim()) textBox(source.description, 32);

    // ── JUSTIFICACIÓN ───────────────────────────────────────────────────────
    canvas.y += SECTION_GAP;
    sectionHeader("Justificación del diferimiento", 18, 28);
    textBox(d.justification, 28);

    // ── EVALUACIÓN DE RIESGO ────────────────────────────────────────────────
    canvas.y += SECTION_GAP;
    // La barra baja junto con la nota, los tres valores y la matriz entera
    // (~122 pt): que la matriz no quede sola en la página siguiente.
    sectionHeader("Evaluación de riesgo", 18, (critical ? 28 : 0) + 18 + 4 + 124);
    if (critical) {
      const note = "Equipo crítico. PROC-MAN-03, punto 4.3: si el mantenimiento planificado no puede completarse "
        + "como estaba previsto, la evaluación de riesgo se documenta y la aprueba la gerencia antes del aplazamiento.";
      const nh = canvas.measureCellHeight([note], [W], { fontSize: 7.5, minHeight: 18 });
      ensureSpace(nh);
      cell(ML, canvas.y, W, nh, note, { fontSize: 7.5, color: "#5b21b6", bg: "#f5f3ff", wrap: nh > 18 });
      canvas.y += nh;
    }
    const lvl = d.riskLevel ?? "";
    kvRow([
      { label: "PROBABILIDAD", value: d.riskProbability ? (PROB_LABEL[d.riskProbability] ?? d.riskProbability) : "—", lw: 74 },
      { label: "CONSECUENCIA", value: d.riskConsequence ? (CONS_LABEL[d.riskConsequence] ?? d.riskConsequence) : "—", lw: 74 },
      { label: "NIVEL", value: lvl ? (RISK_LEVEL_LABEL[lvl] ?? lvl) : "—", lw: 50, bold: true, color: RISK_LEVEL_COLOR[lvl] ?? BLACK },
    ]);
    canvas.y += 4;
    renderRiskMatrix(doc, canvas, ML, W, d.riskProbability, d.riskConsequence);
    canvas.y += 6;
    subLabel("RESULTADO DEL ANÁLISIS DE RIESGO");
    textBox(d.riskAnalysisResult, 28);

    // ── MEDIDAS COMPENSATORIAS ──────────────────────────────────────────────
    canvas.y += SECTION_GAP;
    sectionHeader("Medidas compensatorias", 18, 28);
    textBox(d.compensatoryMeasures, 28);

    // ── DECISIÓN ────────────────────────────────────────────────────────────
    canvas.y += SECTION_GAP;
    sectionHeader("Decisión", 18, 36);
    const decision = d.status === "REJECTED" ? "Rechazado"
      : d.decisionAt ? "Aprobado"
      : "Pendiente";
    kvRow([
      { label: "DECISIÓN", value: decision, bold: true, color: decision === "Rechazado" ? "#b91c1c" : decision === "Aprobado" ? "#15803d" : BLACK },
      { label: "FECHA", value: fmtDate(d.decisionAt) },
    ]);
    kvRow([
      { label: "VIGENTE DESDE", value: fmtDate(d.activeSince) },
      { label: "CERRADO", value: fmtDate(d.closedAt) },
    ]);
    if (d.reviewNotes?.trim())     { subLabel("NOTAS DE REVISIÓN"); textBox(d.reviewNotes, 28); }
    if (d.rejectionReason?.trim()) { subLabel("MOTIVO DE RECHAZO"); textBox(d.rejectionReason, 28); }
    if (d.closeNotes?.trim())      { subLabel("NOTAS DE CIERRE");   textBox(d.closeNotes, 28); }

    // ── FIRMAS ──────────────────────────────────────────────────────────────
    canvas.y += SECTION_GAP;
    const H = 80;
    const SIG_W = 150, SIG_H = 42;
    ensureSpace(H);
    const half = Math.floor(W / 2);
    const boxes: Array<[string, MercurioDeferralSigner]> = [
      ["FIRMA Y ACLARACIÓN DEL SOLICITANTE", requester],
      [d.status === "REJECTED" ? "FIRMA Y ACLARACIÓN DE QUIEN RECHAZA" : "FIRMA Y ACLARACIÓN DE QUIEN APRUEBA", decider],
    ];
    boxes.forEach(([lab, s], i) => {
      const bx = ML + i * half;
      const bw = i === 0 ? half : W - half;
      doc.rect(bx, canvas.y, bw, H).fillColor(WHITE).fill();
      doc.rect(bx, canvas.y, bw, H).strokeColor(BORDER).lineWidth(0.5).stroke();
      if (s.signature) {
        try { doc.image(s.signature, bx + bw / 2 - SIG_W / 2, canvas.y + 6, { fit: [SIG_W, SIG_H], align: "center", valign: "center" }); } catch { /* skip */ }
      }
      if (s.qualification) {
        doc.fontSize(6).font("Helvetica").fillColor(GRAY)
          .text(sanitizePdfText(s.qualification), bx + 8, canvas.y + H - 36, { width: bw - 16, lineBreak: false });
      }
      if (s.name) {
        doc.fontSize(8).font("Helvetica").fillColor(BLACK)
          .text(sanitizePdfText(s.name), bx + 8, canvas.y + H - 26, { width: bw - 16, lineBreak: false });
      }
      doc.moveTo(bx + 10, canvas.y + H - 14).lineTo(bx + bw - 10, canvas.y + H - 14)
        .strokeColor("#aaaaaa").lineWidth(0.8).stroke();
      doc.fontSize(6).font("Helvetica-Bold").fillColor(GRAY)
        .text(lab, bx + 6, canvas.y + H - 10, { width: bw - 12, align: "center", lineBreak: false });
    });
    canvas.y += H;

    drawControlledDocFooter(doc, { meta, rightInfo: rightInfo(canvas.page), x: ML, w: W });
    doc.end();
  });
}
