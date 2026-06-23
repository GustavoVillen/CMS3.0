import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getDeferral } from "./deferrals-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, renderLabeledTextBox } from "./pdf-helpers";
import { hasMarkdownTable, renderMarkdownBlocks } from "./pdf-markdown";
import { resolveTenantForm } from "./tenant-forms-service";
import { drawControlledDocHeader, drawControlledDocFooter, FOOTER_H } from "./pdf-form-chrome";
import { renderRiskMatrixPdf } from "./risk-matrix-pdf";

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-AR");
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-AR");
}

function val(v: string | null | undefined): string {
  return v?.trim() || "—";
}

function daysBetween(from: Date | string | null | undefined, to: Date | string | null | undefined): string {
  if (!from || !to) return "—";
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b)) return "—";
  const days = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return `${days} día${days === 1 ? "" : "s"}`;
}

const STATUS_LABEL: Record<string, string> = {
  REQUESTED:    "Solicitado",
  UNDER_REVIEW: "En revisión",
  APPROVED:     "Aprobado",
  REJECTED:     "Rechazado",
  ACTIVE:       "Activo",
  EXPIRED:      "Vencido",
  CLOSED:       "Cerrado",
};

const SOURCE_TYPE_LABEL: Record<string, string> = {
  WORK_ORDER:       "Orden de trabajo",
  DEFECT:           "Defecto",
  MAINTENANCE_PLAN: "Plan de mantenimiento",
};

const PAGE_H        = 841.89;
const CM            = 72 / 2.54;
const MARGIN_V      = Math.round(1.5 * CM);
const FOOTER_SIZE   = 40;

export async function buildDeferralPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const deferral = await getDeferral(session, id);

  // Resolve source code + label + task description
  let sourceCode:  string | null = null;
  let sourceTitle: string | null = null;
  let sourceTask:  string | null = null;
  const prismaRaw = getPrismaClient();
  let tenantId: string | null = null;
  if (prismaRaw) {
    try {
      const t = await (prismaRaw as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { id: true },
      });
      tenantId = t?.id ?? null;
    } catch { /* non-blocking */ }

    try {
      if (deferral.sourceType === "WORK_ORDER" && tenantId) {
        const wo = await (prismaRaw as any).workOrder.findFirst({ where: { id: deferral.sourceId, tenantId }, select: { workOrderCode: true, title: true, description: true } });
        sourceCode  = wo?.workOrderCode ?? null;
        sourceTitle = wo?.title ?? null;
        sourceTask  = wo?.description ?? null;
      } else if (deferral.sourceType === "DEFECT" && tenantId) {
        const def = await (prismaRaw as any).defect.findFirst({ where: { id: deferral.sourceId, tenantId }, select: { defectCode: true, classification: true, description: true } });
        sourceCode  = def?.defectCode ?? null;
        sourceTitle = def?.classification ?? null;
        sourceTask  = def?.description ?? null;
      } else if (deferral.sourceType === "MAINTENANCE_PLAN" && tenantId) {
        const mp = await (prismaRaw as any).maintenancePlan.findFirst({ where: { id: deferral.sourceId, tenantId }, select: { taskCode: true, title: true, description: true } });
        sourceCode  = mp?.taskCode ?? null;
        sourceTitle = mp?.title ?? null;
        sourceTask  = mp?.description ?? null;
      }
    } catch { /* non-blocking */ }
  }

  // Resolve user names (requester, decider) — filtrado a miembros del tenant.
  let requestedByName: string | null = null;
  let decidedByName:   string | null = null;
  if (prismaRaw && tenantId) {
    try {
      const userIds = [deferral.requestedByUserId, deferral.decidedByUserId].filter((x): x is string => Boolean(x));
      if (userIds.length > 0) {
        const users = await (prismaRaw as any).user.findMany({
          where: { id: { in: userIds }, memberships: { some: { tenantId, status: "ACTIVE" } } },
          select: { id: true, firstName: true, lastName: true, email: true },
        });
        const nameById = new Map<string, string>(users.map((u: any) => {
          const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
          return [u.id, fullName || u.email || u.id];
        }));
        requestedByName = nameById.get(deferral.requestedByUserId) ?? null;
        if (deferral.decidedByUserId) decidedByName = nameById.get(deferral.decidedByUserId) ?? null;
      }
    } catch { /* non-blocking */ }
  }

  // Tenant logo
  let tenant: { name?: string; logoUrl?: string | null; logoUrlLight?: string | null } | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  if (prismaRaw) {
    try {
      const tenantRow = await (prismaRaw as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      tenant = tenantRow?.settings
        ? { name: tenantRow.settings.displayName, logoUrl: tenantRow.settings.logoUrl, logoUrlLight: tenantRow.settings.logoUrlLight }
        : null;
      tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, tenant?.logoUrl, tenant?.logoUrlLight);
    } catch { /* non-blocking */ }
  }

  // Documento controlado por tenant (INFORME DE DIFERIMIENTO). Mercurio recibe
  // header + footer controlado; el resto mantiene el estilo simple.
  const form = await resolveTenantForm(session.tenantSlug, "DEFERRAL");
  const controlled = form.meta.style === "MERCURIO";
  const headerLogo = form.logoBuffer ?? tenantLogoBuffer;
  const tenantName = tenant?.name ?? session.tenantSlug.toUpperCase();
  const isMercurio = session.tenantSlug === "mercurio";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: deferral.deferralCode } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML       = 48;
    const MR       = 48;
    const PW       = 595.28;
    const W        = PW - ML - MR;
    const black    = "#0f172a";
    const navy     = "#1e3a5f";
    const gray     = "#64748b";
    const lightGray = "#94a3b8";
    const border   = "#e2e8f0";
    const bgBox    = "#f8fafc";
    const accentBg = "#eff6ff";

    const footerH      = controlled ? FOOTER_H : FOOTER_SIZE;
    const contentBottom = PAGE_H - footerH - MARGIN_V;

    let y = MARGIN_V;
    doc.on("pageAdded", () => { (doc as any).y = MARGIN_V; y = MARGIN_V; });

    function ensureSpace(needed: number) {
      if (y + needed > contentBottom) { doc.addPage(); y = MARGIN_V; }
    }

    // ── Header ────────────────────────────────────────────────────────────────
    if (controlled) {
      const hdrH = drawControlledDocHeader(doc, {
        meta: form.meta, logoBuffer: headerLogo, tenantName, x: ML, y, w: W, page: 1,
      });
      y += hdrH + 12;
    } else {
      const HEADER_H = 64;
      const LOGO_MAX_W = 90;
      if (tenantLogoBuffer) {
        try { doc.image(tenantLogoBuffer, ML + W - LOGO_MAX_W, y, { fit: [LOGO_MAX_W, HEADER_H], align: "right", valign: "center" }); } catch {}
      }
      const titleW = W - LOGO_MAX_W - 16;
      doc.fontSize(22).font("Helvetica-Bold").fillColor(navy).text("INFORME DE DIFERIMIENTO", ML, y + 2, { width: titleW });
      doc.fontSize(13).font("Helvetica-Bold").fillColor(navy).text(deferral.deferralCode, ML, y + 34, { width: titleW });
      doc.fontSize(8).font("Helvetica").fillColor(gray).text(`Generado: ${fmtDateTime(new Date())}`, ML, y + 52, { width: titleW });
      y += HEADER_H + 12;
      doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(navy).lineWidth(2).stroke();
      y += 14;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
    function labeledBox(x: number, yy: number, w: number, h: number, label: string, content: string, color = black, bg = bgBox) {
      doc.roundedRect(x, yy, w, h, 6).fill(bg).stroke(border);
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray).text(label.toUpperCase(), x + 8, yy + 7, { width: w - 16 });
      doc.fontSize(10).font("Helvetica-Bold").fillColor(color).text(content, x + 8, yy + 21, { width: w - 16, lineBreak: false, ellipsis: true });
    }

    function sectionTitle(text: string) {
      ensureSpace(24);
      doc.fontSize(9).font("Helvetica-Bold").fillColor(navy).text(text.toUpperCase(), ML, y, { width: W });
      y += 13;
      doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.5).stroke();
      y += 8;
    }

    // Text block: tabla Markdown → grilla; resto → caja etiquetada con **negrita**.
    function textBlock(label: string, content: string, opts: { highlight?: boolean } = {}) {
      const text       = content || "—";
      const bg         = opts.highlight ? accentBg : bgBox;
      const labelColor = opts.highlight ? "#0369a1" : gray;

      if (text !== "—" && hasMarkdownTable(text)) {
        const titleH = 14;
        ensureSpace(titleH + 28);
        doc.fontSize(8).font("Helvetica-Bold").fillColor(labelColor).text(label.toUpperCase(), ML, y, { width: W });
        y += titleH;
        y = renderMarkdownBlocks(doc, text, {
          x: ML, width: W, startY: y, contentBottom, resetY: MARGIN_V,
          fontRegular: "Helvetica", fontBold: "Helvetica-Bold", fontSize: 9,
          color: black, borderColor: border, headerBg: "#e2e8f0",
        });
        y += 8;
        return;
      }

      y = renderLabeledTextBox(doc, {
        label, text: content, x: ML, y, width: W,
        pageBottom: contentBottom, pageTop: MARGIN_V,
        markdown: true,
        bg, border, labelColor,
        textColor: content && content !== "—" ? black : lightGray,
        cornerRadius: 6, sectionGap: 6,
      });
    }

    // ── Recuadro 1: Embarcación / Solicitud Número ───────────────────────────
    ensureSpace(58);
    labeledBox(ML,           y, W / 2 - 6, 48, "Embarcación",      deferral.vesselCode, "#0369a1", accentBg);
    labeledBox(ML + W/2 + 6, y, W / 2 - 6, 48, "Solicitud número", deferral.deferralCode, "#1d4ed8");
    y += 56;

    // ── Datos del diferimiento ────────────────────────────────────────────────
    sectionTitle("Datos del diferimiento");

    const srcTypeLabel = deferral.sourceType === "WORK_ORDER"
      ? (isMercurio ? "Solicitud de Servicio" : "Orden de trabajo")
      : (SOURCE_TYPE_LABEL[deferral.sourceType] ?? deferral.sourceType);

    ensureSpace(58);
    labeledBox(ML,           y, W / 2 - 6, 48, "Activo",         val(deferral.assetName));
    labeledBox(ML + W/2 + 6, y, W / 2 - 6, 48, "Tipo de origen", srcTypeLabel);
    y += 56;

    ensureSpace(58);
    labeledBox(ML,           y, W / 2 - 6, 48, "Código",  val(sourceCode));
    labeledBox(ML + W/2 + 6, y, W / 2 - 6, 48, "Estado",  STATUS_LABEL[deferral.status] ?? deferral.status);
    y += 56;

    ensureSpace(58);
    labeledBox(ML,           y, W / 2 - 6, 48, "Fecha de solicitud", fmt(deferral.requestedAt));
    labeledBox(ML + W/2 + 6, y, W / 2 - 6, 48, "Fecha objetivo",     fmt(deferral.targetDate), deferral.targetDate ? "#b45309" : black);
    y += 56;

    ensureSpace(58);
    labeledBox(ML,           y, W / 2 - 6, 48, "Duración estimada", daysBetween(deferral.requestedAt, deferral.targetDate));
    labeledBox(ML + W/2 + 6, y, W / 2 - 6, 48, "Solicitado por",    val(requestedByName));
    y += 56;

    // Espacio de ~1cm antes del detalle de la tarea
    y += CM;

    if (sourceTitle) {
      ensureSpace(50);
      labeledBox(ML, y, W, 44, "Título de la tarea", sourceTitle);
      y += 52;
    }
    if (sourceTask) {
      const taskLabel = deferral.sourceType === "WORK_ORDER" ? "Tarea"
        : deferral.sourceType === "MAINTENANCE_PLAN" ? "Descripción del plan"
        : "Descripción del defecto";
      textBlock(taskLabel, sourceTask);
    }

    // ── Justificación ─────────────────────────────────────────────────────────
    sectionTitle("Justificación");
    textBlock("Justificación", val(deferral.justification));

    // ── Análisis de riesgo (matriz prob × consecuencia) ──────────────────────
    const hasRiskMatrix = !!(deferral.riskProbability && deferral.riskConsequence);
    if (hasRiskMatrix || deferral.riskAnalysisResult) {
      sectionTitle("Análisis de riesgo");
      if (hasRiskMatrix) {
        ensureSpace(160);
        y = renderRiskMatrixPdf(doc, {
          x: ML, w: W, y, contentBottom, marginTop: MARGIN_V,
          probability: deferral.riskProbability, consequence: deferral.riskConsequence,
          fontRegular: "Helvetica", fontBold: "Helvetica-Bold",
          onAddPage: () => { doc.addPage(); },
        });
        y += 8;
      }
      if (deferral.riskAnalysisResult) {
        textBlock("Resultado del análisis de riesgos", val(deferral.riskAnalysisResult));
      }
    }

    // ── Medidas compensatorias ────────────────────────────────────────────────
    sectionTitle("Medidas compensatorias");
    textBlock("Medidas compensatorias", val(deferral.compensatoryMeasures), { highlight: true });

    // ── Decisión y trazabilidad (condicional) ────────────────────────────────
    const hasDecision = deferral.decisionAt
      || deferral.reviewNotes
      || deferral.rejectionReason
      || deferral.activeSince
      || deferral.closedAt
      || deferral.closeNotes;

    if (hasDecision) {
      sectionTitle("Decisión y trazabilidad");
      if (deferral.decisionAt || deferral.activeSince || deferral.closedAt) {
        ensureSpace(58);
        const cellW = (W - 12) / 3;
        labeledBox(ML,                   y, cellW, 48, "Decisión",     fmt(deferral.decisionAt));
        labeledBox(ML + cellW + 6,       y, cellW, 48, "Activo desde", fmt(deferral.activeSince));
        labeledBox(ML + (cellW + 6) * 2, y, cellW, 48, "Cerrado",      fmt(deferral.closedAt));
        y += 56;
      }
      if (decidedByName) {
        ensureSpace(50);
        const decidedLabel = deferral.status === "REJECTED" ? "Diferimiento rechazado por" : "Diferimiento aprobado por";
        labeledBox(ML, y, W, 44, decidedLabel, decidedByName);
        y += 52;
      }
      if (deferral.reviewNotes)     textBlock("Notas de revisión", val(deferral.reviewNotes));
      if (deferral.rejectionReason) textBlock("Motivo de rechazo", val(deferral.rejectionReason));
      if (deferral.closeNotes)      textBlock("Notas de cierre",   val(deferral.closeNotes));
    }

    // ── Footer por página (buffered) ──────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      if (controlled) {
        const rightInfo = `${form.meta.formCode} — ${deferral.deferralCode} — ${deferral.vesselCode} — Pagina ${i + 1} — ${fmt(new Date())}`;
        drawControlledDocFooter(doc, { meta: form.meta, rightInfo, x: ML, w: W });
      } else {
        const footerY = PAGE_H - FOOTER_SIZE;
        doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
        if (existsSync(LOGO_PATH)) {
          try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch {}
        }
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text("Copilot Management System — Documento generado automáticamente.", ML + 18, footerY, { width: W / 2 - 18 });
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text(`${deferral.deferralCode} · ${deferral.vesselCode} · ${fmt(new Date())}`, ML, footerY, { width: W, align: "right" });
      }
    }
    doc.flushPages();
    doc.end();
  });
}
