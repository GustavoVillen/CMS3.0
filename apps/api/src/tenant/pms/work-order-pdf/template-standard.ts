// STANDARD template — generic CMS work-order PDF.
// Modern layout with navy headers, badge inline rows, signature boxes.
// Pure renderer — receives WorkOrderPdfContext, returns Buffer.

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import {
  fmt, val, typeLabel, statusLabel, priorityLabel, riskLabel, woResultLabel,
  STATUS_COLOR, PRIORITY_COLOR, LOGO_PATH, PAGE_H,
  type WorkOrderPdfContext,
} from "./shared";

const CM             = 72 / 2.54;
const MARGIN_V       = Math.round(1.5 * CM);
const APPROVAL_BAND_H = 18;
const FOOTER_SIZE    = 40 + APPROVAL_BAND_H;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

const APPROVAL_COLS = [
  { label: "Elaborado:", value: "Barlovento Servicios Profesionales" },
  { label: "Revisado:",  value: "Asesoría Jurídica" },
  { label: "Aprobado:",  value: "Gerente General" },
];

export async function renderStandardWorkOrderPdf(ctx: WorkOrderPdfContext): Promise<Buffer> {
  const { wo, assetLabel, assignedName, tenantLogoBuffer } = ctx;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `OT ${wo.workOrderCode}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML = 48, MR = 48, PW = 595.28, W = PW - ML - MR;
    const navy = "#0f2744", black = "#0f172a", gray = "#64748b";
    const border = "#cbd5e1", bgBox = "#f8fafc", bgHead = "#0f2744";

    let y = MARGIN_V;
    doc.on("pageAdded", () => { (doc as any).y = MARGIN_V; y = MARGIN_V; });

    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_V; }
    }

    function sectionHeader(title: string) {
      ensureSpace(22);
      doc.rect(ML, y, W, 18).fillColor(bgHead).fill();
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#ffffff")
        .text(title.toUpperCase(), ML + 10, y + 5, { width: W - 20, characterSpacing: 1.2 });
      y += 18;
    }

    // ── Markdown table support (preserved from original) ─────────────────────
    function parseMarkdownTable(lines: string[]): string[][] {
      return lines
        .filter(l => !l.replace(/[\s|:-]/g, ""))
        .map(l => l.replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
    }
    function stripBold(s: string): string {
      return s.replace(/\*\*([^*]+?)\*\*/g, "$1");
    }
    function renderLineWithBold(line: string, cx: number, cy: number, width: number): number {
      const parts = line.split(/(\*\*[^*]+?\*\*)/g).filter(p => p.length > 0);
      if (parts.length === 0) return 0;
      doc.fontSize(9.5).fillColor(black);
      parts.forEach((part, i) => {
        const isBold = part.startsWith("**") && part.endsWith("**");
        const txt = isBold ? part.slice(2, -2) : part;
        const isLast = i === parts.length - 1;
        doc.font(isBold ? "Helvetica-Bold" : "Helvetica");
        if (i === 0) doc.text(txt, cx, cy, { width, continued: !isLast, lineGap: 2 });
        else         doc.text(txt,        { width, continued: !isLast, lineGap: 2 });
      });
      return doc.y - cy;
    }
    function estimateContentHeight(text: string, width: number): number {
      const ROW_H = 16;
      const lines = text.split("\n");
      let h = 0, i = 0;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trimStart().startsWith("|") && l.trimEnd().endsWith("|")) {
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
    function renderContentAt(text: string, cx: number, cy: number, width: number): number {
      const ROW_H = 16;
      const lines = text.split("\n");
      let ry = cy, i = 0;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trimStart().startsWith("|") && l.trimEnd().endsWith("|")) {
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
            row.forEach((cellVal, ci) => {
              doc.fontSize(8).font(isHeader ? "Helvetica-Bold" : "Helvetica").fillColor(black)
                .text(stripBold(cellVal), cx + ci * colW2 + 4, ry + 4, { width: colW2 - 8, lineBreak: false });
            });
            ry += ROW_H;
          });
          ry += 4;
        } else {
          if (l.trim()) ry += renderLineWithBold(l, cx, ry, width);
          else          ry += 6;
          i++;
        }
      }
      return ry;
    }

    function textRow(label: string, rawText: string, span = 1, totalCols = 3) {
      const text = val(rawText);
      const colW = W / totalCols;
      const boxW = colW * span;
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
        doc.fontSize(10).font("Helvetica").fillColor(gray).text("—", ML + 10, y + LABEL_H, { width: innerW, lineGap: 2 });
      } else {
        renderContentAt(text, ML + 10, y + LABEL_H, innerW);
      }
      y += boxH;
    }

    function textRowHighlight(label: string, rawText: string, span = 1, totalCols = 3) {
      const text = val(rawText);
      const colW = W / totalCols;
      const boxW = colW * span;
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
        doc.fontSize(10).font("Helvetica").fillColor(gray).text("—", ML + 10, y + LABEL_H + 5, { width: innerW, lineGap: 2 });
      } else {
        renderContentAt(text, ML + 10, y + LABEL_H + 5, innerW);
      }
      y += boxH;
    }

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

    // ── HEADER ────────────────────────────────────────────────────────────────
    const HEADER_H = 64;
    const TENANT_LOGO_MAX_W = 90;
    doc.rect(ML, y, 4, HEADER_H).fillColor("#1e40af").fill();

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
      { label: "Embarcación", value: wo.vesselCode, color: "#1d4ed8" },
      { label: "Equipo",      value: assetLabel },
      { label: "Tipo",        value: typeLabel(wo.type) },
    ]);
    inlineRow([
      { label: "Estado",     value: statusLabel(wo.status),     color: STATUS_COLOR[wo.status] ?? black },
      { label: "Prioridad",  value: priorityLabel(wo.priority), color: PRIORITY_COLOR[wo.priority] ?? black },
      { label: "Criticidad", value: (wo as any).criticality ?? "—" },
    ]);
    inlineRow([
      { label: "Fecha Apertura",    value: fmt(wo.openDate) },
      { label: "Fecha Vencimiento", value: fmt((wo as any).dueDate) },
      { label: "Fecha Cierre",      value: fmt((wo as any).completedDate) },
    ]);
    y += 6;

    // ── SECCIÓN 2: PLAN ──────────────────────────────────────────────────────
    sectionHeader("Plan de la Tarea");
    textRow("Título de la OT", val((wo as any).title), 3, 3);
    textRowHighlight("Descripción / Tarea a ejecutar", val((wo as any).description), 3, 3);
    inlineRow([
      { label: "Responsable asignado", value: assignedName ?? val((wo as any).assignedToUserId) },
      { label: "Nivel de Riesgo",      value: riskLabel((wo as any).riskLevel) },
      { label: "Horas estimadas",      value: (wo as any).estimatedHours != null ? `${(wo as any).estimatedHours} h` : "—" },
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
      { label: "Resultado OT",
        value: woResultLabel((wo as any).woResult),
        color: (wo as any).woResult === "SATISFACTORY" ? "#166534"
             : (wo as any).woResult === "WITH_DEFICIENCIES" ? "#991b1b" : undefined },
      { label: "Ejecutado por", value: val((wo as any).executedByName ?? (wo as any).assignedToUserId) },
      { label: "Horas motor al ejecutar",
        value: (wo as any).runningHoursAtExecution != null ? `${(wo as any).runningHoursAtExecution} h` : "—" },
    ]);
    if ((wo as any).observations) textRow("Observaciones", val((wo as any).observations), 3, 3);
    if ((wo as any).holdReason)   textRow("Motivo de postergación", val((wo as any).holdReason), 3, 3);
    if ((wo as any).cancelReason) textRow("Motivo de cancelación", val((wo as any).cancelReason), 3, 3);
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
      doc.moveTo(bx + 10, y + 50).lineTo(bx + sigW - 10, y + 50).strokeColor("#aaaaaa").lineWidth(0.8).stroke();
      if (sigValues[i]) {
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text(sigValues[i], bx + 10, y + 52, { width: sigW - 20 });
      }
    });
    y += sigH + 8;

    // ── FOOTER ───────────────────────────────────────────────────────────────
    // Approval band on top
    const bandY = PAGE_H - FOOTER_SIZE;
    const NAVY_FOOTER = "#0C2461";
    doc.rect(ML, bandY, W, APPROVAL_BAND_H).fillColor(NAVY_FOOTER).fill();
    const cw = Math.floor(W / APPROVAL_COLS.length);
    APPROVAL_COLS.forEach((col, i) => {
      const cx = ML + i * cw;
      if (i > 0) {
        doc.moveTo(cx, bandY + 2).lineTo(cx, bandY + APPROVAL_BAND_H - 2)
           .strokeColor("#FFFFFF").opacity(0.35).lineWidth(0.4).stroke().opacity(1);
      }
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#FFFFFF")
        .text(`${col.label} ${col.value}`, cx + 6, bandY + (APPROVAL_BAND_H - 8) / 2 + 1, {
          width: cw - 12, align: "center", lineBreak: false, ellipsis: true,
        });
    });

    // Existing logo + app name + WO code line below the band
    const footerY = bandY + APPROVAL_BAND_H + 8;
    doc.moveTo(ML, footerY - 4).lineTo(ML + W, footerY - 4).strokeColor(border).lineWidth(1).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY + 1, { width: 14, height: 14 }); } catch {}
    }
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text("Copilot Management System — Documento generado automáticamente. No requiere firma digital.",
        ML + 18, footerY + 3, { width: W / 2 - 18 });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`${wo.workOrderCode} · ${wo.vesselCode} · ${fmt(new Date())}`, ML, footerY + 3, { width: W, align: "right" });

    doc.end();
  });
}
