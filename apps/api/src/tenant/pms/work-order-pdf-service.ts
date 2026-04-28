import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getTenantWorkOrder } from "../work-orders/work-orders-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo } from "./pdf-helpers";

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-AR");
}

function val(v: string | null | undefined): string {
  return (v?.trim() || "—").replace(/ð/g, "").replace(/[☐☑☒□■✓✔✘]/g, "[ ]");
}

function typeLabel(t: string): string {
  if (t === "INSPECTION") return "Inspección";
  if (t === "CORRECTIVE")  return "Reparación / Correctivo";
  return "Mantenimiento Preventivo";
}

function statusLabel(s: string): string {
  const m: Record<string, string> = {
    PLANNED: "Planificada", IN_PROGRESS: "En ejecución", ON_HOLD: "Postergada",
    CLOSED: "Cerrada", CANCELLED: "Cancelada",
  };
  return m[s] ?? s;
}

function priorityLabel(p: string): string {
  const m: Record<string, string> = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica" };
  return m[p] ?? p;
}

function riskLabel(r: string | null | undefined): string {
  if (!r) return "—";
  const m: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Crítico" };
  return m[r] ?? r;
}

function woResultLabel(r: string | null | undefined): string {
  if (!r) return "—";
  return r === "SATISFACTORY" ? "Satisfactorio" : "Con deficiencias";
}

const STATUS_COLOR: Record<string, string> = {
  PLANNED: "#0369a1", IN_PROGRESS: "#b45309", ON_HOLD: "#7c3aed",
  CLOSED: "#166534", CANCELLED: "#991b1b",
};
const PRIORITY_COLOR: Record<string, string> = {
  LOW: "#16a34a", MEDIUM: "#b45309", HIGH: "#b91c1c", CRITICAL: "#7f1d1d",
};

const PAGE_H      = 841.89;
const CM          = 72 / 2.54;
const MARGIN_V    = Math.round(1.5 * CM);
const FOOTER_SIZE = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

export async function buildWorkOrderPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const wo = await getTenantWorkOrder(session, id);

  // Best-effort: resolve assigned user name
  let assignedName: string | null = null;
  const prismaRaw = getPrismaClient();
  if (prismaRaw && wo.assignedToUserId) {
    try {
      const u = await (prismaRaw as any).user.findUnique({
        where: { id: wo.assignedToUserId },
        select: { firstName: true, lastName: true },
      });
      if (u) assignedName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null;
    } catch { /* non-blocking */ }
  }

  // Get tenant logo
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

  const assetLabel = (wo as any).assetName ?? wo.assetId;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: { Title: `OT ${wo.workOrderCode}` },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML  = 48;
    const MR  = 48;
    const PW  = 595.28;
    const W   = PW - ML - MR;

    const navy  = "#0f2744";
    const black = "#0f172a";
    const gray  = "#64748b";
    const border= "#cbd5e1";
    const bgBox = "#f8fafc";
    const bgHead= "#0f2744";

    let y = MARGIN_V;

    doc.on("pageAdded", () => {
      (doc as any).y = MARGIN_V;
      y = MARGIN_V;
    });

    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) {
        doc.addPage();
        y = MARGIN_V;
      }
    }

    // ── Labeled box (compact) ────────────────────────────────────────────────
    function labeledBox(bx: number, by: number, bw: number, bh: number, label: string, value: string, valueColor = black) {
      doc.roundedRect(bx, by, bw, bh, 4).fillColor(bgBox).fill();
      doc.roundedRect(bx, by, bw, bh, 4).strokeColor(border).lineWidth(1).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), bx + 10, by + 8, { width: bw - 20, characterSpacing: 0.5 });
      doc.fontSize(10.5).font("Helvetica-Bold").fillColor(valueColor)
        .text(value, bx + 10, by + 20, { width: bw - 20 });
    }

    // ── Section header + rows ────────────────────────────────────────────────
    function sectionHeader(title: string) {
      ensureSpace(22);
      doc.rect(ML, y, W, 18).fillColor(bgHead).fill();
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#ffffff")
        .text(title.toUpperCase(), ML + 10, y + 5, { width: W - 20, characterSpacing: 1.2 });
      y += 18;
    }

    // ── Parse markdown table lines into rows ─────────────────────────────────
    function parseMarkdownTable(lines: string[]): string[][] {
      return lines
        .filter(l => !l.replace(/[\s|:-]/g, "")) // skip separator rows (|---|)
        .map(l => l.replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
    }

    // Strip **bold** markers (used for height measurement and table cells)
    function stripBold(s: string): string {
      return s.replace(/\*\*([^*]+?)\*\*/g, "$1");
    }

    // Render a single line with inline **bold** markers — emits segments using continued:true
    function renderLineWithBold(line: string, cx: number, cy: number, width: number): number {
      const parts = line.split(/(\*\*[^*]+?\*\*)/g).filter(p => p.length > 0);
      if (parts.length === 0) return 0;
      doc.fontSize(9.5).fillColor(black);
      parts.forEach((part, i) => {
        const isBold = part.startsWith("**") && part.endsWith("**");
        const txt    = isBold ? part.slice(2, -2) : part;
        const isLast = i === parts.length - 1;
        doc.font(isBold ? "Helvetica-Bold" : "Helvetica");
        if (i === 0) {
          doc.text(txt, cx, cy, { width, continued: !isLast, lineGap: 2 });
        } else {
          doc.text(txt, { width, continued: !isLast, lineGap: 2 });
        }
      });
      return doc.y - cy;
    }

    // ── Estimate height of content with embedded markdown tables ─────────────
    function estimateContentHeight(text: string, width: number): number {
      const ROW_H = 16;
      const lines = text.split("\n");
      let h = 0;
      let i = 0;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trimStart().startsWith("|") && l.trimEnd().endsWith("|")) {
          // collect table block
          const block: string[] = [];
          while (i < lines.length && lines[i].trimStart().startsWith("|") && lines[i].trimEnd().endsWith("|")) {
            block.push(lines[i]); i++;
          }
          const rows = parseMarkdownTable(block);
          h += rows.length * ROW_H + 4;
        } else {
          if (l.trim()) h += doc.fontSize(9.5).font("Helvetica").heightOfString(stripBold(l), { width, lineGap: 2 });
          else h += 6;
          i++;
        }
      }
      return h;
    }

    // ── Render text block with markdown table support ─────────────────────────
    function renderContentAt(text: string, cx: number, cy: number, width: number): number {
      const ROW_H = 16;
      const lines = text.split("\n");
      let ry = cy;
      let i = 0;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trimStart().startsWith("|") && l.trimEnd().endsWith("|")) {
          // collect entire table block
          const block: string[] = [];
          while (i < lines.length && lines[i].trimStart().startsWith("|") && lines[i].trimEnd().endsWith("|")) {
            block.push(lines[i]); i++;
          }
          const rows = parseMarkdownTable(block);
          if (!rows.length) continue;
          const colCount = rows[0].length;
          const colW2 = width / colCount;
          rows.forEach((row, ri) => {
            const isHeader = ri === 0;
            const rowBg = isHeader ? "#e2e8f0" : (ri % 2 === 0 ? "#f8fafc" : "#ffffff");
            doc.rect(cx, ry, width, ROW_H).fillColor(rowBg).fill();
            doc.rect(cx, ry, width, ROW_H).strokeColor(border).lineWidth(0.4).stroke();
            row.forEach((cell, ci) => {
              doc.fontSize(8)
                .font(isHeader ? "Helvetica-Bold" : "Helvetica")
                .fillColor(black)
                .text(stripBold(cell), cx + ci * colW2 + 4, ry + 4, { width: colW2 - 8, lineBreak: false });
            });
            ry += ROW_H;
          });
          ry += 4;
        } else {
          if (l.trim()) {
            const lh = renderLineWithBold(l, cx, ry, width);
            ry += lh;
          } else {
            ry += 6;
          }
          i++;
        }
      }
      return ry;
    }

    // ── Multiline text row (full width) — supports markdown tables ────────────
    function textRow(label: string, rawText: string, span = 1, totalCols = 3) {
      const text  = val(rawText);
      const colW  = W / totalCols;
      const boxW  = colW * span;
      const innerW = boxW - 20;

      const LABEL_H = 18;
      const contentH = text === "—"
        ? doc.fontSize(10).font("Helvetica").heightOfString("—", { width: innerW, lineGap: 2 })
        : estimateContentHeight(text, innerW);
      const boxH = Math.max(38, contentH + LABEL_H + 6);

      ensureSpace(boxH);
      doc.roundedRect(ML, y, boxW, boxH, 0).fillColor(bgBox).fill();
      doc.roundedRect(ML, y, boxW, boxH, 0).strokeColor(border).lineWidth(0.5).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), ML + 10, y + 6, { width: innerW, characterSpacing: 0.5 });

      if (text === "—") {
        doc.fontSize(10).font("Helvetica").fillColor(gray)
          .text("—", ML + 10, y + LABEL_H, { width: innerW, lineGap: 2 });
      } else {
        renderContentAt(text, ML + 10, y + LABEL_H, innerW);
      }
      y += boxH;
    }

    // ── Multiline text row con header destacado ──────────────────────────────
    function textRowHighlight(label: string, rawText: string, span = 1, totalCols = 3) {
      const text  = val(rawText);
      const colW  = W / totalCols;
      const boxW  = colW * span;
      const innerW = boxW - 20;
      const LABEL_H = 22;
      const contentH = text === "—"
        ? doc.fontSize(10).font("Helvetica").heightOfString("—", { width: innerW, lineGap: 2 })
        : estimateContentHeight(text, innerW);
      const boxH = Math.max(44, contentH + LABEL_H + 8);
      ensureSpace(boxH);
      doc.rect(ML, y, boxW, LABEL_H).fillColor("#0f172a").fill();
      doc.fontSize(11.2).font("Helvetica-Bold").fillColor("#ffffff")
        .text(label.toUpperCase(), ML + 10, y + 5, { width: boxW - 20, characterSpacing: 0.8 });
      doc.roundedRect(ML, y + LABEL_H, boxW, boxH - LABEL_H, 0).fillColor(bgBox).fill();
      doc.roundedRect(ML, y + LABEL_H, boxW, boxH - LABEL_H, 0).strokeColor(border).lineWidth(0.5).stroke();
      if (text === "—") {
        doc.fontSize(10).font("Helvetica").fillColor(gray)
          .text("—", ML + 10, y + LABEL_H + 5, { width: innerW, lineGap: 2 });
      } else {
        renderContentAt(text, ML + 10, y + LABEL_H + 5, innerW);
      }
      y += boxH;
    }

    // ── Inline row grid ──────────────────────────────────────────────────────
    function inlineRow(fields: Array<{ label: string; value: string; color?: string }>) {
      const boxH = 42;
      ensureSpace(boxH);
      const colW = W / fields.length;
      fields.forEach((f, i) => {
        const bx = ML + i * colW;
        doc.roundedRect(bx, y, colW, boxH, 0).fillColor(bgBox).fill();
        doc.roundedRect(bx, y, colW, boxH, 0).strokeColor(border).lineWidth(0.5).stroke();
        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
          .text(f.label.toUpperCase(), bx + 10, y + 7, { width: colW - 20, characterSpacing: 0.5 });
        doc.fontSize(10.5).font("Helvetica-Bold").fillColor(f.color ?? black)
          .text(f.value, bx + 10, y + 19, { width: colW - 20 });
      });
      y += boxH;
    }

    // ── HEADER ───────────────────────────────────────────────────────────────
    const HEADER_H = 64;
    const TENANT_LOGO_MAX_W = 90;
    // Left stripe
    doc.rect(ML, y, 4, HEADER_H).fillColor("#1e40af").fill();

    // Tenant logo — top-right, proportional to header height
    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + W - TENANT_LOGO_MAX_W, y,
          { fit: [TENANT_LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
      } catch {}
    }

    const titleW = W - TENANT_LOGO_MAX_W - 16;
    doc.fontSize(22).font("Helvetica-Bold").fillColor(navy)
      .text("ORDEN DE TRABAJO", ML + 14, y + 2, { width: titleW });
    doc.fontSize(13).font("Helvetica-Bold").fillColor(navy)
      .text(wo.workOrderCode, ML + 14, y + 30, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`Generado: ${new Date().toLocaleString("es-AR")}`, ML + 14, y + 48, { width: titleW });

    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 12;

    // ── SECCIÓN 1: INFORMACIÓN ───────────────────────────────────────────────
    sectionHeader("Información General");

    inlineRow([
      { label: "Embarcación",  value: wo.vesselCode,       color: "#1d4ed8" },
      { label: "Equipo",       value: assetLabel           },
      { label: "Tipo",         value: typeLabel(wo.type)   },
    ]);
    inlineRow([
      { label: "Estado",       value: statusLabel(wo.status),       color: STATUS_COLOR[wo.status] ?? black },
      { label: "Prioridad",    value: priorityLabel(wo.priority),   color: PRIORITY_COLOR[wo.priority] ?? black },
      { label: "Criticidad",   value: wo.criticality ?? "—" },
    ]);
    inlineRow([
      { label: "Fecha Apertura",     value: fmt(wo.openDate) },
      { label: "Fecha Vencimiento",  value: fmt((wo as any).dueDate) },
      { label: "Fecha Cierre",       value: fmt((wo as any).completedDate) },
    ]);
    y += 6;

    // ── SECCIÓN 2: PLAN ──────────────────────────────────────────────────────
    sectionHeader("Plan de la Tarea");

    textRow("Título de la OT", val((wo as any).title), 3, 3);
    textRowHighlight("Descripción / Tarea a ejecutar", val((wo as any).description), 3, 3);

    inlineRow([
      { label: "Responsable asignado", value: assignedName ?? val((wo as any).assignedToUserId) },
      { label: "Nivel de Riesgo",       value: riskLabel((wo as any).riskLevel) },
      { label: "Horas estimadas",       value: (wo as any).estimatedHours != null ? `${(wo as any).estimatedHours} h` : "—" },
    ]);

    textRowHighlight("LOTO (Lockout/Tagout)", val((wo as any).loto), 3, 3);
    textRowHighlight("Criterios de Aceptación", val((wo as any).acceptanceCriteria), 3, 3);

    if ((wo as any).riskAnalysisResult) {
      textRowHighlight("Resultado Análisis de Riesgo", val((wo as any).riskAnalysisResult), 3, 3);
    }
    y += 6;

    // ── SECCIÓN 3: RESULTADO ─────────────────────────────────────────────────
    sectionHeader("Resultado de la Ejecución");

    inlineRow([
      { label: "Resultado OT",    value: woResultLabel((wo as any).woResult), color: (wo as any).woResult === "SATISFACTORY" ? "#166534" : (wo as any).woResult === "WITH_DEFICIENCIES" ? "#991b1b" : undefined },
      { label: "Ejecutado por",   value: val((wo as any).executedByName ?? (wo as any).assignedToUserId) },
      { label: "Horas motor al ejecutar", value: (wo as any).runningHoursAtExecution != null ? `${(wo as any).runningHoursAtExecution} h` : "—" },
    ]);

    if ((wo as any).observations) {
      textRow("Observaciones", val((wo as any).observations), 3, 3);
    }
    if ((wo as any).holdReason) {
      textRow("Motivo de postergación", val((wo as any).holdReason), 3, 3);
    }
    if ((wo as any).cancelReason) {
      textRow("Motivo de cancelación", val((wo as any).cancelReason), 3, 3);
    }
    y += 16;

    // ── FIRMAS ───────────────────────────────────────────────────────────────
    ensureSpace(80);
    const sigW = W / 3;
    const sigH = 64;
    const sigLabels = ["Responsable de ejecución", "Supervisor / Jefe de Máquinas", "Verificado por"];
    const sigValues = [assignedName ?? "", "", ""];

    sigLabels.forEach((label, i) => {
      const bx = ML + i * sigW;
      doc.roundedRect(bx, y, sigW, sigH, 0).fillColor(bgBox).fill();
      doc.roundedRect(bx, y, sigW, sigH, 0).strokeColor(border).lineWidth(0.5).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), bx + 10, y + 8, { width: sigW - 20, characterSpacing: 0.5 });
      // Signature line
      doc.moveTo(bx + 10, y + 50).lineTo(bx + sigW - 10, y + 50).strokeColor("#aaaaaa").lineWidth(0.8).stroke();
      if (sigValues[i]) {
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text(sigValues[i], bx + 10, y + 52, { width: sigW - 20 });
      }
    });
    y += sigH + 8;

    // ── FOOTER ───────────────────────────────────────────────────────────────
    const footerY = PAGE_H - FOOTER_SIZE;
    doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch {}
    }
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text("Copilot Management System — Documento generado automáticamente. No requiere firma digital.", ML + 18, footerY, { width: W / 2 - 18 });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`${wo.workOrderCode} · ${wo.vesselCode} · ${fmt(new Date())}`, ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
