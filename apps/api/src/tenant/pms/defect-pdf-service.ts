import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getDefect } from "./defects-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, renderLabeledTextBox, sanitizePdfText } from "./pdf-helpers";
import { resolveTenantForm } from "./tenant-forms-service";
import { drawControlledDocHeader, drawControlledDocFooter, FOOTER_H } from "./pdf-form-chrome";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";


function val(v: string | null | undefined): string {
  return (v?.trim() || "—").replace(/[ð☐☑☒□■✓✔✘]/g, "[ ]");
}

// Strip markdown syntax so it renders as clean plain text in the PDF
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")                               // headings → plain text
    .replace(/^\|[-:\s|]+\|$/gm, "")                           // table separator rows
    .replace(/^\|(.*)\|$/gm, (_, c: string) =>                 // table rows → bullet list
      c.split("|").map(s => s.trim()).filter(Boolean).join("  ·  ")
    )
    .replace(/\[CLOSE\]\s*/g, "")                              // close note prefix
    .replace(/^---+$/gm, "")                                   // horizontal rules
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")                  // bold/italic
    .replace(/[ð☐☑☒□■✓✔✘]/g, "[ ]")                          // checkbox chars → plain text
    .replace(/\n{3,}/g, "\n\n")                                // collapse blank lines
    .trim();
}

// Todo en español: el PDF imprimía los códigos internos (HIGH, CLOSED…). Preview V48.
const SEVERITY: Record<string, { label: string; color: string }> = {
  LOW: { label: "Baja", color: "#16a34a" }, MEDIUM: { label: "Media", color: "#b45309" },
  HIGH: { label: "Alta", color: "#b91c1c" }, CRITICAL: { label: "Crítica", color: "#7f1d1d" },
};
const STATUS: Record<string, { label: string; color: string }> = {
  OPEN: { label: "Abierto", color: "#0369a1" }, UNDER_REVIEW: { label: "En revisión", color: "#6d28d9" },
  IN_PROGRESS: { label: "En reparación", color: "#b45309" }, DEFERRED: { label: "Diferido", color: "#475569" },
  RESOLVED: { label: "Resuelto", color: "#0f766e" }, CLOSED: { label: "Cerrado", color: "#166534" },
};
const OPERATIONAL_STATE: Record<string, string> = {
  NORMAL: "Opera normal", DEGRADED: "Degradado", RESTRICTED: "Restringido", NO_GO: "Fuera de servicio",
};
const CLASSIFICATION: Record<string, string> = {
  WORK_ORDER_FINDING: "Hallazgo en OT",
  INSPECTION_FINDING: "Hallazgo en inspección",
  PREDICTIVE_FLUID_ANALYSIS: "Análisis de fluidos",
  EXTERNAL_AUDIT_FINDING: "Deficiencia de auditoría externa",
};
const RCA_METHOD: Record<string, string> = {
  FIVE_WHYS: "5 Porqués", FISHBONE: "Ishikawa (Espina de pescado)", FTA: "Árbol de fallas (FTA)", BARRIER_ANALYSIS: "Análisis de barreras",
};
const WO_STATUS: Record<string, string> = {
  PLANNED: "Planificada", IN_PROGRESS: "En curso", ON_HOLD: "En espera", DEFERRED: "Diferida", CLOSED: "Cerrada", CANCELLED: "Cancelada",
};

const PAGE_H      = 841.89;            // A4 height pts
const CM          = 72 / 2.54;         // pts per cm
const MARGIN_V    = Math.round(1.5 * CM); // 1.5cm ≈ 43pts
const FOOTER_SIZE = 40;                // footer block height

export async function buildDefectPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  // Fechas y horas del documento en la hora de la EMPRESA: el servidor
  // corre en UTC y sin esto el papel salía con la hora del servidor.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const defect = await getDefect(session, id);
  const d = defect as typeof defect & Record<string, any>;

  const prisma = getPrismaClient();
  let tenantId: string | null = null;
  let tenantName: string | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  let vesselName: string = defect.vesselCode;
  let assetLabel: string | null = null;
  let linkedWo: { workOrderCode: string; status: string } | null = null;
  if (prisma) {
    try {
      const tenantRow = await (prisma as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { id: true, settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      tenantId = tenantRow?.id ?? null;
      tenantName = tenantRow?.settings?.displayName ?? null;
      tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, tenantRow?.settings?.logoUrl, tenantRow?.settings?.logoUrlLight);
      if (tenantId) {
        const [vessel, asset, wo] = await Promise.all([
          (prisma as any).vessel.findFirst({ where: { tenantId, code: defect.vesselCode }, select: { name: true } }),
          defect.assetId
            ? (prisma as any).asset.findFirst({ where: { id: defect.assetId, tenantId }, select: { name: true, assetCode: true } })
            : null,
          defect.workOrderId
            ? (prisma as any).workOrder.findFirst({ where: { id: defect.workOrderId, tenantId }, select: { workOrderCode: true, status: true } })
            : null,
        ]);
        // Nombre del buque, no el código.
        vesselName = vessel?.name ?? defect.vesselCode;
        assetLabel = asset ? [asset.assetCode, asset.name].filter(Boolean).join(" — ") : null;
        linkedWo = wo ?? null;
      }
    } catch { /* non-blocking */ }
  }

  const form = await resolveTenantForm(session.tenantSlug, "DEFECT");
  const controlled = form.meta.style === "MERCURIO";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      bufferPages: true,
      info: { Title: `${defect.defectCode}-${defect.vesselCode}` },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML     = 48;
    const MR     = 48;
    const PW     = 595.28;
    const W      = PW - ML - MR;
    const navy   = controlled ? "#0C2461" : "#0f2744";
    const black  = "#0f172a";
    const gray   = "#64748b";
    const border = "#cbd5e1";
    const bgBox  = "#f8fafc";
    const CONTENT_BOTTOM = PAGE_H - (controlled ? FOOTER_H : FOOTER_SIZE) - MARGIN_V;

    let y = MARGIN_V;

    // When PDFKit auto-creates a page during a long .text() call it starts at y=0.
    doc.on("pageAdded", () => {
      (doc as unknown as { y: number }).y = MARGIN_V;
      y = MARGIN_V;
    });

    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_V; }
    }

    function sectionHeader(title: string, keepWith = 0) {
      ensureSpace(22 + keepWith);
      doc.rect(ML, y, W, 18).fillColor(navy).fill();
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#ffffff")
        .text(title.toUpperCase(), ML + 10, y + 5, { width: W - 20, characterSpacing: 1.2 });
      y += 18;
    }

    function inlineRow(fields: Array<{ label: string; value: string; color?: string }>) {
      const boxH = 42;
      ensureSpace(boxH);
      const colW = W / fields.length;
      fields.forEach((f, i) => {
        const bx = ML + i * colW;
        doc.rect(bx, y, colW, boxH).fillColor(bgBox).fill();
        doc.rect(bx, y, colW, boxH).strokeColor(border).lineWidth(0.5).stroke();
        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
          .text(f.label.toUpperCase(), bx + 10, y + 7, { width: colW - 20, characterSpacing: 0.5 });
        const txt = sanitizePdfText(f.value);
        doc.font("Helvetica-Bold").fontSize(10.5);
        const fs = doc.widthOfString(txt) > colW - 20 ? 8.5 : 10.5;
        doc.fontSize(fs).fillColor(f.color ?? black)
          .text(txt, bx + 10, y + (fs < 10 ? 17 : 19), { width: colW - 20, height: 22, ellipsis: true });
      });
      y += boxH;
    }

    // Texto libre: caja partible entre páginas (skill pms-pdf-generation).
    function textRow(label: string, raw: string | null | undefined) {
      const text = val(raw) === "—" ? "—" : stripMarkdown(raw!);
      doc.font("Helvetica").fontSize(9.5);
      const estH = doc.heightOfString(sanitizePdfText(text), { width: W - 20, lineGap: 2 }) + 18 + 20 + 8;
      if (estH < 180) ensureSpace(estH);
      y = renderLabeledTextBox(doc, {
        label, text, x: ML, y, width: W,
        pageBottom: CONTENT_BOTTOM, pageTop: MARGIN_V,
        labelPosition: "inside", fontSize: 9.5, bg: bgBox, border, cornerRadius: 0, sectionGap: 0,
      });
    }

    // ── Header ────────────────────────────────────────────────────────────────
    if (controlled) {
      const hdrH = drawControlledDocHeader(doc, {
        meta: form.meta, logoBuffer: form.logoBuffer ?? tenantLogoBuffer,
        tenantName: tenantName ?? session.tenantSlug.toUpperCase(), x: ML, y, w: W, page: 1,
      });
      y += hdrH + 6;
      doc.fontSize(7.5).font("Helvetica").fillColor(gray)
        .text(`Generado: ${fmtDateTime(new Date())}`, ML, y + 4, { width: W / 2 });
      doc.fontSize(7.5).font("Helvetica").fillColor(gray)
        .text("Código: ", ML + W / 2, y + 4, { width: W / 2 - 140, align: "right" });
      doc.fontSize(12).font("Helvetica-Bold").fillColor(navy)
        .text(defect.defectCode, ML + W - 140, y, { width: 140, align: "right", lineBreak: false });
      y += 22;
    } else {
      const HEADER_H = 64;
      const TENANT_LOGO_MAX_W = 90;
      if (tenantLogoBuffer) {
        try {
          doc.image(tenantLogoBuffer, ML + W - TENANT_LOGO_MAX_W, y,
            { fit: [TENANT_LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
        } catch { /* ignore */ }
      }
      const titleW = W - TENANT_LOGO_MAX_W - 16;
      doc.fontSize(22).font("Helvetica-Bold").fillColor(black)
        .text("REPORTE DE DEFECTO", ML, y + 2, { width: titleW });
      doc.fontSize(13).font("Helvetica-Bold").fillColor(black)
        .text(`${defect.defectCode}  ·  ${sanitizePdfText(vesselName)}`, ML, y + 30, { width: titleW });
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text(`Generado: ${fmtDateTime(new Date())}`, ML, y + 48, { width: titleW });
      y += HEADER_H + 8;
      doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
      y += 14;
    }

    // ── Identificación ────────────────────────────────────────────────────────
    const sev = SEVERITY[defect.severity] ?? { label: defect.severity, color: black };
    sectionHeader("Identificación");
    inlineRow([
      { label: "Buque",  value: vesselName, color: "#1d4ed8" },
      { label: "Equipo", value: assetLabel ?? "—" },
      { label: "Origen", value: CLASSIFICATION[defect.classification] ?? val(defect.classification) },
    ]);
    inlineRow([
      { label: "Fecha de reporte",  value: fmt(defect.reportedAt) },
      { label: "Severidad",         value: sev.label, color: sev.color },
      { label: "Estado del equipo", value: OPERATIONAL_STATE[defect.operationalState] ?? val(defect.operationalState) },
    ]);
    y += 4;

    // ── Estado y resolución ───────────────────────────────────────────────────
    // Si el defecto se originó en una OT (WORK_ORDER_FINDING), workOrderId ES la
    // OT de origen, no la que lo resolvió. No confundir ambas.
    const st = STATUS[defect.status] ?? { label: defect.status, color: black };
    const originIsWo = defect.classification === "WORK_ORDER_FINDING";
    const woCode = linkedWo?.workOrderCode ?? defect.workOrderId ?? null;
    const resolution: Array<{ label: string; value: string; color?: string }> = [
      { label: "Estado del defecto", value: st.label, color: st.color },
    ];
    if (woCode) {
      resolution.push({ label: originIsWo ? "Origen: OT" : "Resuelto vía OT", value: woCode, color: "#1d4ed8" });
      if (linkedWo) resolution.push({ label: "Estado de la OT", value: WO_STATUS[linkedWo.status] ?? linkedWo.status });
    }
    if (defect.repairType) {
      resolution.push({
        label: "Tipo de reparación",
        value: defect.repairType === "PERMANENTE" ? "Permanente" : "Temporaria",
        color: defect.repairType === "PERMANENTE" ? "#16a34a" : "#b45309",
      });
    }
    sectionHeader("Estado y resolución", 42);
    inlineRow(resolution.slice(0, 3));
    if (resolution.length > 3) inlineRow(resolution.slice(3));
    y += 4;

    // ── Qué pasó ──────────────────────────────────────────────────────────────
    sectionHeader("Qué pasó", 50);
    textRow("Descripción", defect.description);
    textRow("Acción inmediata", defect.immediateAction);
    if (d.capaDescription) textRow("CAPA", d.capaDescription);
    y += 4;

    // ── Análisis de causa raíz (V48: se imprime completo) ─────────────────────
    const hasRca = [d.rcaMethodology, d.rcaImmediateCause, d.rcaContributingCause, d.rcaRootCause, d.rcaAnalysis, d.rcaPreventiveActions]
      .some(v => typeof v === "string" && v.trim());
    if (hasRca) {
      sectionHeader("Análisis de causa raíz", 42);
      inlineRow([
        { label: "Metodología", value: RCA_METHOD[String(d.rcaMethodology ?? "")] ?? val(d.rcaMethodology) },
        { label: "Aprobado", value: d.rcaApprovedAt ? fmt(d.rcaApprovedAt) : "Pendiente" },
      ]);
      if (d.rcaImmediateCause)    textRow("Causa inmediata", d.rcaImmediateCause);
      if (d.rcaContributingCause) textRow("Causa contribuyente", d.rcaContributingCause);
      if (d.rcaRootCause)         textRow("Causa raíz", d.rcaRootCause);
      if (d.rcaAnalysis)          textRow("Análisis", d.rcaAnalysis);
      if (d.rcaPreventiveActions) textRow("Acciones preventivas", d.rcaPreventiveActions);
      y += 4;
    }

    // ── Verificación de eficacia (ISM 10.2.3) ─────────────────────────────────
    // Es la evidencia que pide el auditor: no sólo qué se hizo, sino que alguien
    // confirmó después que el problema no volvió.
    if (defect.effectivenessVerifiedAt || defect.effectivenessDueAt) {
      const verified = !!defect.effectivenessVerifiedAt;
      const outcomeLabel = defect.effectivenessOutcome === "EFFECTIVE" ? "Efectiva"
        : defect.effectivenessOutcome === "PARTIALLY_EFFECTIVE" ? "Parcialmente efectiva"
        : defect.effectivenessOutcome === "INEFFECTIVE" ? "No efectiva"
        : "Pendiente";
      const boxValue = verified
        ? `${outcomeLabel} · ${fmt(defect.effectivenessVerifiedAt)}`
        : `Pendiente · a revisar el ${fmt(defect.effectivenessDueAt)}`;
      const boxColor = !verified ? "#b45309"
        : defect.effectivenessOutcome === "INEFFECTIVE" ? "#b91c1c" : "#16a34a";
      sectionHeader("Verificación de eficacia (ISM 10.2.3)", 42);
      inlineRow([{ label: "Resultado", value: boxValue, color: boxColor }]);
      if (defect.effectivenessNote) textRow("Observación de la verificación", defect.effectivenessNote);
    }

    // ── Footer por página ─────────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      if (controlled) {
        const rightInfo = [form.meta.formCode, defect.defectCode, vesselName, `Pagina ${i + 1}`, fmt(new Date())].filter(Boolean).join(" — ");
        drawControlledDocFooter(doc, { meta: form.meta, rightInfo, x: ML, w: W });
      } else {
        const footerY = PAGE_H - FOOTER_SIZE;
        doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
        if (existsSync(LOGO_PATH)) {
          try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* ignore */ }
        }
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text("Copilot Management System — Reporte generado automáticamente", ML + 18, footerY, { width: W / 2 - 18, lineBreak: false });
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text(`${defect.defectCode} · ${sanitizePdfText(vesselName)} · ${fmt(new Date())}`, ML, footerY, { width: W, align: "right", lineBreak: false });
      }
    }

    doc.end();
  });
}
