import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getMoc } from "./moc-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, renderLabeledTextBox } from "../pms/pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz } from "../../common/tenant-time";
import {
  EVAL_GROUPS, EVAL_QUESTIONS, EFFECTIVENESS_QUESTIONS, EVALUATOR_AREAS,
  CHANGE_TYPES, LOCATION_TYPES, DURATION_LABELS, YESNO_LABELS, RISK_LABELS,
} from "./moc-form-catalog";

// ─── Helpers de texto ─────────────────────────────────────────────────────────

function val(v: string | null | undefined): string {
  return v?.trim() || "—";
}
function sanitize(text: string): string {
  return text
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/[ð☐☑☒□■✓✔✘]/g, "")
    .split("")
    .filter(c => { const cc = c.charCodeAt(0); return cc === 9 || cc === 10 || (cc >= 0x20 && cc !== 0x7F && cc <= 0xFF); })
    .join("");
}

interface TechReview { team?: string; evaluatorName?: string; methodology?: string; impact?: string; viable?: string; justification?: string; riskClassification?: string }
interface ActionRow { impact?: string; action?: string; responsible?: string; dueDate?: string; status?: string; observations?: string }
interface EvalAnswer { n: number; answer?: string; canImpact?: boolean }
interface EffAnswer { n: number; answer?: string; detail?: string }

interface MocRecord {
  mocCode: string; vesselCode: string; title: string; status: string;
  category: string; riskLevel: string; createdAt: Date | string;
  reasonForChange: string; proposedChange: string;
  riskAssessmentNotes: string | null; mitigationActions: string | null;
  approvedAt: Date | string | null; approvedByName: string | null; rejectedReason: string | null;
  plannedDate: Date | string | null; implementedAt: Date | string | null;
  // REGI-GES-06.1
  requesterName: string | null; requesterRegistration: string | null;
  changeManagerName: string | null; changeManagerRegistration: string | null;
  requestingArea: string | null; areaSupervisor: string | null;
  managementName: string | null; managerName: string | null;
  changeTypesJson: string[] | null; duration: string | null; temporaryUntil: Date | string | null;
  locationType: string | null; locationUnit: string | null; physicalArea: string | null;
  currentSituation: string | null; expectedResult: string | null;
  evaluationAnswersJson: EvalAnswer[] | null; evaluatorAreasJson: string[] | null;
  requiresFullManagement: boolean;
  technicalReviewsJson: TechReview[] | null; actionPlanJson: ActionRow[] | null;
  finalRiskLevel: string | null; recommendationsBeforeChange: string | null; additionalInfo: string | null;
  effectivenessAnswersJson: EffAnswer[] | null;
}

// Paleta espejo del documento controlado.
const NAVY = "#1F3864";     // barra de título
const BLUE = "#2F5496";     // barras de sección
const SUB  = "#4472C4";     // subgrupos
const GRAYL = "#f1f5f9";    // fondo celdas
const LABEL = "#475569";
const INK  = "#0f172a";
const BORDER = "#cbd5e1";

const PAGE_H = 841.89, PAGE_W = 595.28;
const CM = 72 / 2.54;
const MARGIN_V = Math.round(0.8 * CM);
const FOOTER_SIZE = 30;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

export async function buildMocPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  // Fechas y horas del documento en la hora de la EMPRESA: el servidor
  // corre en UTC y sin esto el papel salía con la hora del servidor.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const moc = await getMoc(session, id) as unknown as MocRecord;

  let tenantLogoBuffer: Buffer | null = null;
  const vesselMap = new Map<string, string>(); // code → name (convención: mostrar nombre, no código)
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const row = await (prisma as unknown as { tenant: { findUnique(a: unknown): Promise<{ id?: string; settings?: { logoUrl?: string | null; logoUrlLight?: string | null } | null } | null> } }).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { id: true, settings: { select: { logoUrl: true, logoUrlLight: true } } },
      });
      tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, row?.settings?.logoUrl ?? null, row?.settings?.logoUrlLight ?? null);
      if (row?.id) {
        const vessels = await (prisma as unknown as { vessel: { findMany(a: unknown): Promise<{ code: string; name: string | null }[]> } })
          .vessel.findMany({ where: { tenantId: row.id }, select: { code: true, name: true } });
        for (const v of vessels) vesselMap.set(v.code, v.name ?? v.code);
      }
    } catch { /* non-blocking */ }
  }
  const vesselName = vesselMap.get(moc.vesselCode) ?? moc.vesselCode;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `${moc.mocCode}-${moc.vesselCode}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML = 32, MR = 32, W = PAGE_W - ML - MR;
    let y = MARGIN_V;
    doc.on("pageAdded", () => { (doc as unknown as { y: number }).y = MARGIN_V; y = MARGIN_V; });

    const ensureSpace = (needed: number) => { if (y + needed > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_V; } };
    const S = (t: string) => sanitize(t);

    // ── Barra de sección ──────────────────────────────────────────────────────
    const bar = (title: string, color = BLUE, subtitle?: string) => {
      ensureSpace(subtitle ? 26 : 16);
      doc.rect(ML, y, W, 15).fill(color);
      doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#ffffff").text(S(title), ML + 6, y + 4, { width: W - 12 });
      y += 15;
      if (subtitle) {
        doc.rect(ML, y, W, 11).fill("#eef2f8");
        doc.fontSize(6.5).font("Helvetica-Oblique").fillColor(LABEL).text(S(subtitle), ML + 6, y + 2.5, { width: W - 12 });
        y += 11;
      }
      y += 2;
    };
    const subBar = (title: string) => {
      ensureSpace(13);
      doc.rect(ML, y, W, 12).fill(SUB);
      doc.fontSize(7).font("Helvetica-Bold").fillColor("#ffffff").text(S(title.toUpperCase()), ML + 6, y + 3, { width: W - 12 });
      y += 13;
    };

    // ── Fila de celdas etiquetadas (valores de una sola línea) ─────────────────
    const cellRow = (cells: { label: string; value: string; w: number }[], h = 26) => {
      ensureSpace(h + 1);
      let x = ML;
      for (const c of cells) {
        doc.rect(x, y, c.w, h).fillAndStroke(GRAYL, BORDER);
        doc.fontSize(6).font("Helvetica-Bold").fillColor(LABEL).text(S(c.label.toUpperCase()), x + 4, y + 3, { width: c.w - 8 });
        doc.fontSize(8).font("Helvetica-Bold").fillColor(INK).text(S(c.value), x + 4, y + 12, { width: c.w - 8, height: h - 14, ellipsis: true });
        x += c.w;
      }
      y += h;
    };

    // ── Checkboxes en línea ─────────────────────────────────────────────────────
    const checkLine = (label: string, items: { label: string; on: boolean }[]) => {
      ensureSpace(16);
      doc.rect(ML, y, W, 15).fillAndStroke(GRAYL, BORDER);
      doc.fontSize(6.5).font("Helvetica-Bold").fillColor(LABEL).text(S(label.toUpperCase()), ML + 4, y + 5, { width: 90 });
      let x = ML + 100;
      for (const it of items) {
        doc.rect(x, y + 4, 7, 7).lineWidth(0.6).strokeColor(INK).stroke();
        if (it.on) { doc.fontSize(7).font("Helvetica-Bold").fillColor(INK).text("X", x + 1.2, y + 4, { lineBreak: false }); }
        doc.fontSize(7.5).font("Helvetica").fillColor(INK).text(S(it.label), x + 11, y + 4.5, { width: 120, lineBreak: false });
        x += 12 + Math.min(120, doc.widthOfString(S(it.label)) + 16);
        if (x > ML + W - 60) { x = ML + 100; y += 12; ensureSpace(12); }
      }
      y += 15 + 1;
    };

    // ── Texto libre multi-página (badge redibujado por página) ─────────────────
    const freeText = (label: string, text: string, markdown = false) => {
      y = renderLabeledTextBox(doc, {
        label, text: val(text), x: ML, y, width: W, pageBottom: CONTENT_BOTTOM, pageTop: MARGIN_V,
        labelPosition: "above", labelHeightAbove: 10, padding: 5, fontSize: 8, lineGap: 1.5, sectionGap: 5,
        bg: GRAYL, border: BORDER, labelColor: LABEL, textColor: INK, cornerRadius: 2, markdown,
      });
    };

    // ── Cabecera de tabla + fila con celdas que envuelven ──────────────────────
    const tableHeader = (cols: { title: string; w: number }[]) => {
      ensureSpace(14);
      let x = ML;
      for (const c of cols) { doc.rect(x, y, c.w, 13).fillAndStroke(SUB, BORDER); doc.fontSize(6.5).font("Helvetica-Bold").fillColor("#ffffff").text(S(c.title.toUpperCase()), x + 3, y + 3.5, { width: c.w - 6 }); x += c.w; }
      y += 13;
    };
    const tableRow = (cells: { text: string; w: number }[]) => {
      doc.fontSize(7.5).font("Helvetica");
      const pad = 3;
      const h = Math.max(16, ...cells.map(c => doc.heightOfString(S(c.text || "—"), { width: c.w - pad * 2 }) + pad * 2));
      ensureSpace(h);
      let x = ML;
      for (const c of cells) {
        doc.rect(x, y, c.w, h).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.fontSize(7.5).font("Helvetica").fillColor(INK).text(S(c.text || "—"), x + pad, y + pad, { width: c.w - pad * 2 });
        x += c.w;
      }
      y += h;
    };

    // ── Header del documento controlado ────────────────────────────────────────
    const headBoxW = 150, headH = 40;
    if (tenantLogoBuffer) { try { doc.image(tenantLogoBuffer, ML, y, { fit: [90, headH], valign: "center" }); } catch { /* */ } }
    // Bloque central: código + subtítulo
    doc.rect(ML + 96, y, W - 96 - headBoxW, headH).fillAndStroke("#ffffff", BORDER);
    doc.fontSize(10).font("Helvetica-Bold").fillColor(INK).text("REGI-GES-06.1", ML + 96, y + 6, { width: W - 96 - headBoxW, align: "center" });
    doc.fontSize(7.5).font("Helvetica").fillColor(LABEL).text("Administración del Cambio", ML + 96, y + 22, { width: W - 96 - headBoxW, align: "center" });
    // Bloque derecho: control documental
    doc.rect(ML + W - headBoxW, y, headBoxW, headH).fillAndStroke("#ffffff", BORDER);
    doc.fontSize(6.5).font("Helvetica").fillColor(LABEL)
      .text(S(`Revisión N°: —\nEmitido: ${fmt(new Date())}\nMOC: ${moc.mocCode} · ${vesselName}\nDocumento Controlado`), ML + W - headBoxW + 5, y + 4, { width: headBoxW - 10, lineGap: 1 });
    y += headH + 2;
    // Barra de título
    doc.rect(ML, y, W, 17).fill(NAVY);
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#ffffff").text("FORMULARIO DE GESTIÓN DE CAMBIOS", ML, y + 4.5, { width: W, align: "center" });
    y += 20;

    // ── 1 · IDENTIFICACIÓN ──────────────────────────────────────────────────────
    bar("1 · IDENTIFICACIÓN DEL CAMBIO", BLUE, "Datos de la solicitud y responsables");
    cellRow([{ label: "Nombre del cambio", value: val(moc.title), w: W }], 24);
    cellRow([
      { label: "Solicitante", value: val(moc.requesterName), w: W * 0.4 },
      { label: "Matrícula", value: val(moc.requesterRegistration), w: W * 0.25 },
      { label: "Fecha de solicitud", value: fmt(moc.createdAt), w: W * 0.35 },
    ]);
    cellRow([
      { label: "Gestor del cambio", value: val(moc.changeManagerName), w: W * 0.4 },
      { label: "Matrícula", value: val(moc.changeManagerRegistration), w: W * 0.25 },
      { label: "Área", value: val(moc.requestingArea), w: W * 0.35 },
    ]);
    cellRow([
      { label: "Supervisor del área", value: val(moc.areaSupervisor), w: W / 3 },
      { label: "Gerencia", value: val(moc.managementName), w: W / 3 },
      { label: "Gerente", value: val(moc.managerName), w: W / 3 },
    ]);

    // Dimensión
    subBar("Dimensión del cambio");
    const types = moc.changeTypesJson ?? [];
    checkLine("Tipo de cambio", CHANGE_TYPES.map(c => ({ label: c.label, on: types.includes(c.key) })));
    const durItems = Object.keys(DURATION_LABELS).map(k => ({ label: DURATION_LABELS[k]!, on: moc.duration === k }));
    if (moc.temporaryUntil) durItems.push({ label: `Temporal hasta ${fmt(moc.temporaryUntil)}`, on: true });
    checkLine("Duración", durItems);
    checkLine("Lugar", LOCATION_TYPES.map(l => ({ label: l.label, on: moc.locationType === l.key })));
    cellRow([
      { label: "Unidad / embarcación", value: val(moc.locationUnit ? (vesselMap.get(moc.locationUnit) ?? moc.locationUnit) : null), w: W * 0.4 },
      { label: "Especificar / área física", value: val(moc.physicalArea), w: W * 0.6 },
    ]);

    // Descripción
    subBar("Descripción del cambio — información detallada");
    freeText("Situación actual", moc.currentSituation ?? "");
    freeText("Motivo de la solicitud del cambio", moc.reasonForChange);
    freeText("Cambio propuesto", moc.proposedChange);
    freeText("Resultado esperado", moc.expectedResult ?? "");

    // ── 2 · EVALUACIÓN PREVIA ───────────────────────────────────────────────────
    bar("2 · EVALUACIÓN PREVIA AL CAMBIO", BLUE, "Esta sección debe ser completada por el Gestor del Cambio");
    ensureSpace(14);
    doc.fontSize(6.5).font("Helvetica-BoldOblique").fillColor("#b91c1c")
      .text(S("IMPORTANTE: En caso de responder Sí o No sabe en la columna de Impacto, la Gestión de Cambio debe ser aplicada."), ML + 2, y, { width: W - 4 });
    y += 12;
    const answersByN = new Map<number, EvalAnswer>((moc.evaluationAnswersJson ?? []).map(a => [a.n, a]));
    const IMPACT_W = 66, NUM_W = 16, Q_W = W - IMPACT_W - NUM_W;
    for (const g of EVAL_GROUPS) {
      subBar(g.label);
      // encabezado de columna impacto
      for (const q of EVAL_QUESTIONS.filter(q => q.group === g.key)) {
        doc.fontSize(7.5).font("Helvetica");
        const pad = 3;
        const qh = doc.heightOfString(S(q.text), { width: Q_W - pad * 2 }) + pad * 2;
        const h = Math.max(15, qh);
        ensureSpace(h);
        const a = answersByN.get(q.n);
        const impact = a?.answer ? (YESNO_LABELS[a.answer] ?? a.answer) : (a?.canImpact ? "Sí" : "—");
        doc.rect(ML, y, NUM_W, h).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.rect(ML + NUM_W, y, Q_W, h).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.rect(ML + NUM_W + Q_W, y, IMPACT_W, h).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.fontSize(7).font("Helvetica-Bold").fillColor(LABEL).text(String(q.n), ML + 2, y + pad, { width: NUM_W - 4 });
        doc.fontSize(7.5).font("Helvetica").fillColor(INK).text(S(q.text), ML + NUM_W + pad, y + pad, { width: Q_W - pad * 2 });
        const impactColor = impact === "Sí" || impact === "No sabe" ? "#b91c1c" : INK;
        doc.fontSize(8).font("Helvetica-Bold").fillColor(impactColor).text(S(impact), ML + NUM_W + Q_W, y + pad, { width: IMPACT_W, align: "center" });
        y += h;
      }
    }
    // Áreas evaluadoras
    subBar("Áreas y personas que deberán evaluar el cambio");
    const evAreas = moc.evaluatorAreasJson ?? [];
    checkLine("Equipo", EVALUATOR_AREAS.map(a => ({ label: a.label, on: evAreas.includes(a.key) })));

    // ── 3 · CLASIFICACIÓN, VIABILIDAD Y OPINIÓN TÉCNICA ────────────────────────
    bar("3 · CLASIFICACIÓN, VIABILIDAD Y OPINIÓN TÉCNICA", BLUE);
    const reviews = moc.technicalReviewsJson ?? [];
    for (const team of ["SSMA", "SUPPORT"]) {
      const r = reviews.find(x => x.team === team) ?? {};
      subBar(team === "SSMA" ? "Equipo de SSMA" : "Equipo de Apoyo");
      cellRow([
        { label: "Evaluador", value: val(r.evaluatorName), w: W * 0.4 },
        { label: "Metodología", value: val(r.methodology), w: W * 0.3 },
        { label: "¿Es viable?", value: r.viable ? (YESNO_LABELS[r.viable] ?? r.viable) : "—", w: W * 0.3 },
      ]);
      cellRow([
        { label: "Impacto para SSMA", value: r.impact === "WITH" ? "Con impacto" : r.impact === "WITHOUT" ? "Sin impacto" : "—", w: W * 0.5 },
        { label: "Calif. de riesgo", value: val(r.riskClassification), w: W * 0.5 },
      ]);
      freeText("Parecer técnico y recomendaciones", r.justification ?? "");
    }

    // ── 4 · PLAN DE ACCIÓN ──────────────────────────────────────────────────────
    bar("4 · PLAN DE ACCIÓN PARA LA IMPLEMENTACIÓN", BLUE, "Acciones para los riesgos clasificados como Altos y Muy Altos");
    tableHeader([
      { title: "Impacto en proceso/tarea", w: W * 0.2 },
      { title: "Acción a realizar", w: W * 0.24 },
      { title: "Responsable", w: W * 0.16 },
      { title: "Fecha", w: W * 0.1 },
      { title: "Estatus", w: W * 0.12 },
      { title: "Observaciones", w: W * 0.18 },
    ]);
    const plan = moc.actionPlanJson ?? [];
    if (plan.length === 0) tableRow([{ text: "Sin acciones registradas.", w: W }]);
    for (const r of plan) {
      tableRow([
        { text: val(r.impact), w: W * 0.2 },
        { text: val(r.action), w: W * 0.24 },
        { text: val(r.responsible), w: W * 0.16 },
        { text: r.dueDate ? fmt(r.dueDate) : "—", w: W * 0.1 },
        { text: val(r.status), w: W * 0.12 },
        { text: val(r.observations), w: W * 0.18 },
      ]);
    }
    freeText("Informaciones adicionales", moc.additionalInfo ?? "");

    // ── 5 · APROBACIÓN ──────────────────────────────────────────────────────────
    bar("5 · APROBACIÓN PARA LA IMPLANTACIÓN DEL CAMBIO", BLUE);
    cellRow([
      { label: "Clasificación final del riesgo", value: moc.finalRiskLevel ? (RISK_LABELS[moc.finalRiskLevel] ?? moc.finalRiskLevel) : (RISK_LABELS[moc.riskLevel] ?? moc.riskLevel), w: W * 0.4 },
      { label: "¿Cambio aprobado?", value: moc.approvedAt ? "Sí" : (moc.rejectedReason ? "No" : "—"), w: W * 0.3 },
      { label: "Fecha de aprobación", value: fmt(moc.approvedAt), w: W * 0.3 },
    ]);
    freeText("Recomendaciones realizadas antes del cambio", moc.recommendationsBeforeChange ?? "");
    if (moc.rejectedReason) freeText("Motivo (si no fue aprobado)", moc.rejectedReason);

    // ── 6 · ANÁLISIS DE EFICACIA ────────────────────────────────────────────────
    bar("6 · ANÁLISIS DE EFICACIA", BLUE, "Completada por el responsable del Área Solicitante o Gestor del Cambio");
    const effByN = new Map<number, EffAnswer>((moc.effectivenessAnswersJson ?? []).map(a => [a.n, a]));
    tableHeader([{ title: "Verificación", w: W * 0.62 }, { title: "Sí/No", w: W * 0.1 }, { title: "Detalles / Fundamento", w: W * 0.28 }]);
    for (const q of EFFECTIVENESS_QUESTIONS) {
      const a = effByN.get(q.n);
      tableRow([
        { text: `${q.n}. ${q.text}`, w: W * 0.62 },
        { text: a?.answer ? (YESNO_LABELS[a.answer] ?? a.answer) : "—", w: W * 0.1 },
        { text: val(a?.detail), w: W * 0.28 },
      ]);
    }

    // ── Firmas ──────────────────────────────────────────────────────────────────
    bar("FINALIZACIÓN DEL CAMBIO", NAVY);
    ensureSpace(50);
    const sigW = (W - 16) / 3;
    const sigs = [
      { role: "Elaborado por", name: val(moc.requesterName) },
      { role: "Revisado por", name: "Persona Designada" },
      { role: "Aprobado por", name: val(moc.approvedByName) },
    ];
    y += 22;
    let sx = ML;
    for (const s of sigs) {
      doc.moveTo(sx, y).lineTo(sx + sigW, y).strokeColor(INK).lineWidth(0.6).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(INK).text(S(s.name), sx, y + 3, { width: sigW, align: "center" });
      doc.fontSize(6.5).font("Helvetica").fillColor(LABEL).text(S(s.role), sx, y + 13, { width: sigW, align: "center" });
      sx += sigW + 8;
    }
    y += 26;

    // ── Footer ──────────────────────────────────────────────────────────────────
    const footerY = PAGE_H - FOOTER_SIZE + 8;
    doc.moveTo(ML, footerY - 6).lineTo(ML + W, footerY - 6).strokeColor(BORDER).lineWidth(0.5).stroke();
    if (existsSync(LOGO_PATH)) { try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 11, height: 11 }); } catch { /* */ } }
    doc.fontSize(6.5).font("Helvetica").fillColor(LABEL).text("Copilot Management System · REGI-GES-06.1", ML + 15, footerY, { width: W / 2 });
    doc.fontSize(6.5).font("Helvetica").fillColor(LABEL).text(S(`${moc.mocCode} · ${vesselName} · ${fmt(new Date())}`), ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
