import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TenantAccessSession } from "../auth/session-store";
import { getTenantMaintenancePlan } from "../maintenance-plans/maintenance-plans-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";

function fmt(d: unknown): string {
  if (!d) return "—";
  const dt = new Date(d as string);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("es-AR");
}

function val(v: unknown): string {
  const s = String(v ?? "").trim();
  return s || "—";
}

function triggerLabel(t: unknown): string {
  const s = String(t ?? "");
  if (!s) return "—";
  const m: Record<string, string> = {
    CALENDAR: "Meses (calendario)", MONTHS: "Meses (calendario)",
    HOURS: "Horas de operación", RUNNING_HOURS: "Horas de operación",
  };
  return m[s.toUpperCase()] ?? s;
}

function statusLabel(s: unknown): string {
  const k = String(s ?? "");
  const m: Record<string, string> = {
    ACTIVE: "Activo", INACTIVE: "Inactivo", OVERDUE: "Vencido", DUE_SOON: "Por vencer",
  };
  return m[k] ?? (k || "—");
}

function executionStatusLabel(s: unknown): string {
  const k = String(s ?? "");
  const m: Record<string, string> = {
    FUTURE: "Futuro", UPCOMING: "Próximo", IN_WINDOW: "En ventana",
    DUE: "Por vencer", OVERDUE: "Vencido", COMPLETED: "Completado",
  };
  return m[k] ?? (k || "—");
}

function resultModeLabel(r: unknown): string {
  const k = String(r ?? "");
  const m: Record<string, string> = {
    DUE_ONLY: "Solo vencimiento", AUTO_WO: "OT automática",
    APPROVAL_WO: "OT con aprobación", CHECKLIST: "Completar Checklist",
  };
  return m[k] ?? (k || "—");
}

const PAGE_H   = 841.89;
const CM       = 72 / 2.54;
const MARGIN_V = Math.round(1.5 * CM);
const FOOTER_H = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - MARGIN_V;

// DejaVu Sans has full Unicode support (including ≥ ≤ etc.)
// Paths for Linux (VPS) and Windows (local dev)
const DEJAVU_PATHS = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "C:\\Windows\\Fonts\\DejaVuSans.ttf",
  join(process.cwd(), "assets", "DejaVuSans.ttf"),
];
const DEJAVU_BOLD_PATHS = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "C:\\Windows\\Fonts\\DejaVuSans-Bold.ttf",
  join(process.cwd(), "assets", "DejaVuSans-Bold.ttf"),
];
const dejavuRegular = DEJAVU_PATHS.find(existsSync) ?? null;
const dejavuBold    = DEJAVU_BOLD_PATHS.find(existsSync) ?? null;

const FONT_REGULAR = dejavuRegular ? "DejaVuSans" : "Helvetica";
const FONT_BOLD    = dejavuBold    ? "DejaVuSans-Bold" : "Helvetica-Bold";

export async function buildMaintenancePlanPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const plan = await getTenantMaintenancePlan(session, id);
  const p = plan as Record<string, unknown>;

  const prisma = getPrismaClient();
  let tenantName: string | null = null;
  let tenantLogoUrl: string | null = null;
  let tenantLogoUrlLight: string | null = null;
  let tenantDbId: string | null = null;
  let assetName: string | null = null;
  let assetIsSafetyCritical = false;
  let lastLog: { result: string; executedByName: string; completedAt: Date | null; runningHoursAtExecution: number | null; notes: string | null } | null = null;
  if (prisma) {
    const tenantRow = await (prisma as any).tenant.findUnique({
      where: { slug: session.tenantSlug },
      select: { id: true, settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
    });
    tenantDbId = tenantRow?.id ?? null;
    tenantName = tenantRow?.settings?.displayName ?? null;
    tenantLogoUrl = tenantRow?.settings?.logoUrl ?? null;
    tenantLogoUrlLight = tenantRow?.settings?.logoUrlLight ?? null;
    lastLog = await (prisma as any).workLog.findFirst({
      where: { maintenancePlanId: id, tenantId: tenantDbId },
      orderBy: { completedAt: "desc" },
      select: { result: true, executedByName: true, completedAt: true, runningHoursAtExecution: true, notes: true },
    });
    if (plan.assetId) {
      try {
        const asset = await (prisma as any).asset.findUnique({
          where: { id: plan.assetId },
          select: { name: true, isSafetyCritical: true },
        });
        assetName = asset?.name ?? null;
        assetIsSafetyCritical = Boolean(asset?.isSafetyCritical);
      } catch { /* non-blocking */ }
    }
  }

  let tenantLogoBuffer: Buffer | null = await resolveTenantLogo(session.tenantSlug, tenantLogoUrl, tenantLogoUrlLight);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: { Title: `Plan ${p["taskCode"] ?? id}` },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (dejavuRegular) doc.registerFont("DejaVuSans", dejavuRegular);
    if (dejavuBold)    doc.registerFont("DejaVuSans-Bold", dejavuBold);

    const ML = 48;
    const MR = 48;
    const PW = 595.28;
    const W  = PW - ML - MR;

    const navy   = "#0f2744";
    const black  = "#0f172a";
    const gray   = "#64748b";
    const border = "#cbd5e1";
    const bgBox  = "#f8fafc";
    const bgHead = "#0f2744";
    const accent = "#d97706"; // amber

    let y = MARGIN_V;

    doc.on("pageAdded", () => { y = MARGIN_V; });

    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_V; }
    }

    function sectionHeader(title: string) {
      ensureSpace(22);
      doc.rect(ML, y, W, 18).fillColor(bgHead).fill();
      doc.fontSize(8).font(FONT_BOLD).fillColor("#ffffff")
        .text(title.toUpperCase(), ML + 10, y + 5, { width: W - 20, characterSpacing: 1.2 });
      y += 18;
    }

    function inlineRow(fields: Array<{ label: string; value: string; color?: string }>) {
      const boxH = 42;
      ensureSpace(boxH);
      const colW = W / fields.length;
      fields.forEach((f, i) => {
        const bx = ML + i * colW;
        doc.roundedRect(bx, y, colW, boxH, 0).fillColor(bgBox).fill();
        doc.roundedRect(bx, y, colW, boxH, 0).strokeColor(border).lineWidth(0.5).stroke();
        doc.fontSize(7).font(FONT_BOLD).fillColor(gray)
          .text(f.label.toUpperCase(), bx + 10, y + 7, { width: colW - 20, characterSpacing: 0.5 });
        doc.fontSize(10.5).font(FONT_BOLD).fillColor(f.color ?? black)
          .text(sanitizePdfText(f.value), bx + 10, y + 19, { width: colW - 20 });
      });
      y += boxH;
    }

    function textBox(label: string, text: string, span = 1, totalCols = 3) {
      const clean = text === "—" ? text : sanitizePdfText(text);
      const innerW = (W / totalCols) * span - 20;
      const contentH = clean === "—"
        ? 14
        : doc.fontSize(9.5).font(FONT_REGULAR).heightOfString(clean, { width: innerW, lineGap: 2 });
      const boxH = Math.max(38, contentH + 22);
      ensureSpace(boxH);
      const boxW = (W / totalCols) * span;
      doc.roundedRect(ML, y, boxW, boxH, 0).fillColor(bgBox).fill();
      doc.roundedRect(ML, y, boxW, boxH, 0).strokeColor(border).lineWidth(0.5).stroke();
      doc.fontSize(7).font(FONT_BOLD).fillColor(gray)
        .text(label.toUpperCase(), ML + 10, y + 6, { width: innerW, characterSpacing: 0.5 });
      doc.fontSize(9.5).font(FONT_REGULAR).fillColor(clean === "—" ? gray : black)
        .text(clean, ML + 10, y + 18, { width: innerW, lineGap: 2 });
      y += boxH;
    }

    function renderMarkdownTable(rows: string[][]) {
      if (rows.length === 0) return;
      const headers = rows[0];
      const dataRows = rows.slice(1);
      const nCols = headers.length;
      const cellPad = 5;

      // First column gets 35% of width, rest split equally
      const firstColW = nCols > 1 ? W * 0.35 : W;
      const restColW  = nCols > 1 ? (W - firstColW) / (nCols - 1) : 0;
      const colWidths = headers.map((_, i) => i === 0 ? firstColW : restColW);
      const colX = (i: number) => ML + colWidths.slice(0, i).reduce((a, b) => a + b, 0);

      const headerH = 18;
      ensureSpace(headerH);
      headers.forEach((h, i) => {
        doc.rect(colX(i), y, colWidths[i], headerH).fillColor("#e2e8f0").fill();
        doc.rect(colX(i), y, colWidths[i], headerH).strokeColor(border).lineWidth(0.4).stroke();
        doc.fontSize(7.5).font(FONT_BOLD).fillColor(black)
          .text(h.trim(), colX(i) + cellPad, y + 5, { width: colWidths[i] - cellPad * 2, ellipsis: true });
      });
      y += headerH;

      dataRows.forEach(row => {
        // Calculate dynamic row height based on tallest cell
        const cellHeights = row.map((cell, i) => {
          const cw = colWidths[i] ?? restColW;
          const raw = cell.trim();
          const hasCheckbox = /^[☐☑☒□■✓✔✘ð]/u.test(raw);
          const cleanText = sanitizePdfText(hasCheckbox ? raw.replace(/^[☐☑☒□■✓✔✘ð]+\s*/, "") : raw);
          const textW = cw - cellPad * 2 - (hasCheckbox ? 11 : 0);
          if (!cleanText) return 16;
          return doc.fontSize(7.5).font(FONT_REGULAR).heightOfString(cleanText, { width: textW, lineGap: 1 }) + 8;
        });
        const rowH = Math.max(16, ...cellHeights);
        ensureSpace(rowH);
        row.forEach((cell, i) => {
          const cw = colWidths[i] ?? restColW;
          doc.rect(colX(i), y, cw, rowH).strokeColor(border).lineWidth(0.3).stroke();
          const raw = cell.trim();
          const hasCheckbox = /^[☐☑☒□■✓✔✘ð]/u.test(raw);
          const cleanText = sanitizePdfText(hasCheckbox ? raw.replace(/^[☐☑☒□■✓✔✘ð]+\s*/, "") : raw);
          let textX = colX(i) + cellPad;
          if (hasCheckbox) {
            const cbSize = 7;
            doc.rect(textX, y + (rowH - cbSize) / 2, cbSize, cbSize).strokeColor("#555").lineWidth(0.6).stroke();
            textX += cbSize + 3;
          }
          if (cleanText) {
            doc.fontSize(7.5).font(FONT_REGULAR).fillColor(black)
              .text(cleanText, textX, y + 4, { width: cw - (textX - colX(i)) - cellPad, lineGap: 1 });
          }
        });
        y += rowH;
      });
      y += 6;
    }

    function renderDescription(label: string, text: string, useBlueHeader = false) {
      if (!text || text === "—") { textBox(label, "—", 3, 3); return; }

      // Split into lines and detect markdown table blocks
      const lines = text.split("\n");
      let i = 0;
      const segments: Array<{ type: "text"; content: string } | { type: "table"; rows: string[][] }> = [];
      while (i < lines.length) {
        const line = lines[i];
        if (line.trim().startsWith("|")) {
          // Collect table lines
          const tableLines: string[] = [];
          while (i < lines.length && lines[i].trim().startsWith("|")) {
            // Skip separator rows (|---|---|)
            if (!/^\|[-:\s|]+\|$/.test(lines[i].trim())) {
              tableLines.push(lines[i]);
            }
            i++;
          }
          if (tableLines.length > 0) {
            const rows = tableLines.map(l =>
              l.trim().replace(/^\||\|$/g, "").split("|")
            );
            segments.push({ type: "table", rows });
          }
        } else {
          // Collect text lines until next table
          const textLines: string[] = [];
          while (i < lines.length && !lines[i].trim().startsWith("|")) {
            textLines.push(lines[i]);
            i++;
          }
          const content = textLines.join("\n").trim();
          if (content) segments.push({ type: "text", content });
        }
      }

      // Render label header
      if (useBlueHeader) {
        sectionHeader(label);
        y += 6;
      } else {
        y += 10; // gap between previous element and this label
        ensureSpace(22);
        doc.fontSize(7).font(FONT_BOLD).fillColor(gray)
          .text(label.toUpperCase(), ML, y, { width: W, characterSpacing: 0.5 });
        y += 12;
      }

      for (const seg of segments) {
        if (seg.type === "text") {
          const innerW = W - 20;
          for (const line of seg.content.split("\n")) {
            // Only treat actual checkbox/square symbols as checkboxes — not comparison operators like ≥
            const hasCheckbox = /^[☐☑☒□■✓✔✘ð]/u.test(line.trim());
            const cleanLine = sanitizePdfText(hasCheckbox ? line.replace(/^[☐☑☒□■✓✔✘ð]+\s*/, "") : line);
            const lineH = doc.fontSize(9.5).font(FONT_REGULAR).heightOfString(cleanLine || " ", { width: innerW - (hasCheckbox ? 14 : 0), lineGap: 1 });
            ensureSpace(lineH + 4);
            let textX = ML;
            if (hasCheckbox) {
              const cbSize = 7;
              doc.rect(textX, y + 2, cbSize, cbSize).strokeColor("#555").lineWidth(0.6).stroke();
              textX += cbSize + 4;
            }
            if (cleanLine.trim()) {
              doc.fontSize(9.5).font(FONT_REGULAR).fillColor(black)
                .text(cleanLine, textX, y, { width: innerW - (textX - ML), lineGap: 1 });
            }
            y += lineH + 2;
          }
          y += 4;
        } else {
          renderMarkdownTable(seg.rows);
        }
      }
      y += 8;
    }

    // ── HEADER ────────────────────────────────────────────────────────────────
    const HEADER_H = 64;
    const TENANT_LOGO_MAX_W = 90;
    doc.rect(ML, y, 4, HEADER_H).fillColor("#1e40af").fill();

    // Tenant logo — top-right, proportional to header height
    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + W - TENANT_LOGO_MAX_W, y,
          { fit: [TENANT_LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
      } catch {}
    }

    const titleW = W - TENANT_LOGO_MAX_W - 16;
    doc.fontSize(20).font(FONT_BOLD).fillColor(navy)
      .text("PLAN DE MANTENIMIENTO", ML + 14, y + 2, { width: titleW });
    doc.fontSize(13).font(FONT_BOLD).fillColor(navy)
      .text(val(p["taskCode"]), ML + 14, y + 28, { width: titleW });
    doc.fontSize(8).font(FONT_REGULAR).fillColor(gray)
      .text(`Generado: ${new Date().toLocaleString("es-AR")}`, ML + 14, y + 48, { width: titleW });

    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 12;

    // ── SECCIÓN 1: IDENTIFICACIÓN ─────────────────────────────────────────────
    sectionHeader("Identificación");

    inlineRow([
      { label: "Embarcación",   value: val(p["vesselCode"]),   color: "#1d4ed8" },
      { label: "Activo / Equipo", value: val(assetName ?? p["assetId"]) },
      { label: "Estado",        value: statusLabel(p["status"] as string), color: accent },
    ]);
    inlineRow([
      { label: "Código de tarea",  value: val(p["taskCode"]) },
      { label: "Grupo SFI",        value: p["sfiGroupNumber"] != null ? `G${p["sfiGroupNumber"]}` : "—" },
      { label: "Subgrupo SFI",     value: val(p["sfiSubgroupCode"]) },
    ]);
    inlineRow([
      { label: "Tipo de tarea",    value: val(p["taskType"]) },
      { label: "Responsable",      value: val(p["responsible"]) },
      { label: "Criticidad",       value: val(p["criticality"]) },
    ]);
    if (assetIsSafetyCritical) {
      inlineRow([
        { label: "Equipo crítico para seguridad (ISM 10.3)", value: "Sí", color: "#b45309" },
        { label: "", value: "" },
        { label: "", value: "" },
      ]);
    }
    y += 6;

    // ── SECCIÓN 2: PLANIFICACIÓN ──────────────────────────────────────────────
    sectionHeader("Planificación y Frecuencia");

    inlineRow([
      { label: "Tipo de trigger",      value: triggerLabel(p["triggerType"] as string) },
      { label: "Frecuencia (meses)",   value: p["frequencyMonths"] != null ? `${p["frequencyMonths"]} meses` : "—" },
      { label: "Frecuencia (horas)",   value: p["frequencyHours"] != null ? `${p["frequencyHours"]} h` : "—" },
    ]);
    inlineRow([
      { label: "Última ejecución",     value: fmt(p["lastExecutionDate"] as string) },
      { label: "Próximo vencimiento",  value: fmt(p["nextDueDate"] as string), color: "#b91c1c" },
      { label: "Estado de ejecución",  value: executionStatusLabel(p["executionStatus"] as string) },
    ]);
    inlineRow([
      { label: "Modo de resultado",    value: resultModeLabel(p["triggerResultMode"] as string) },
      { label: "Modo de ventana",      value: val(p["windowMode"]) },
      { label: "Días ventana anticipada", value: p["windowLeadDays"] != null ? `${p["windowLeadDays"]} días` : "—" },
    ]);
    y += 6;

    // ── SECCIÓN 3: DESCRIPCIÓN ────────────────────────────────────────────────
    sectionHeader("Tareas a Realizar");
    y += 14; // 5mm gap between section header and content

    textBox("Título", val(p["title"]), 3, 3);
    renderDescription("Tareas a realizar / Descripción", val(p["description"]), true);

    if (p["acceptanceCriteria"]) {
      renderDescription("Criterios de aceptación", val(p["acceptanceCriteria"]), true);
    }
    if (p["loto"]) {
      renderDescription("LOTO (Lockout/Tagout)", val(p["loto"]), true);
    }
    if (p["riskLevel"]) {
      inlineRow([
        { label: "Nivel de riesgo", value: val(p["riskLevel"]) },
        { label: "", value: "" },
        { label: "", value: "" },
      ]);
    }
    if (p["riskAnalysisResult"]) {
      renderDescription("Resultado análisis de riesgo", val(p["riskAnalysisResult"]), true);
    }
    // RCM consequence (si está clasificada)
    if (p["consequenceCategory"]) {
      const consequenceLabel: Record<string, string> = {
        SAFETY: "Riesgo a personas (lesión / fatalidad)",
        ENVIRONMENTAL: "Daño ambiental (vertido, emisión)",
        OPERATIONAL: "Pérdida de operación (paro, retraso)",
        NON_OPERATIONAL: "Solo costo de reparación",
      };
      const cat = String(p["consequenceCategory"]);
      inlineRow([
        { label: "Consecuencia (RCM)", value: consequenceLabel[cat] ?? cat },
        { label: "", value: "" },
        { label: "", value: "" },
      ]);
      if (p["consequenceRationale"]) {
        renderDescription("Fundamento de consecuencia", val(p["consequenceRationale"]), true);
      }
    }
    y += 16;

    // ── SECCIÓN 4: RESULTADO DE EJECUCIÓN (si existe) ─────────────────────────
    if (lastLog) {
      sectionHeader("Resultado de la Ejecución");
      const isSatisfactory = lastLog.result === "COMPLETED";
      const resultLabel = isSatisfactory ? "Satisfactorio" : "Con Deficiencias";
      const resultColor = isSatisfactory ? "#166534" : "#991b1b";
      inlineRow([
        { label: "Resultado",         value: resultLabel,                                              color: resultColor },
        { label: "Ejecutado por",     value: lastLog.executedByName || "—" },
        { label: "Fecha de ejecución", value: fmt(lastLog.completedAt) },
      ]);
      if (lastLog.runningHoursAtExecution != null) {
        inlineRow([
          { label: "Horas motor al ejecutar", value: `${lastLog.runningHoursAtExecution.toLocaleString()} h` },
          { label: "", value: "" },
          { label: "", value: "" },
        ]);
      }
      if (lastLog.notes) {
        textBox("Observaciones / Deficiencias", lastLog.notes, 3, 3);
      }
      y += 12;
    }

    // ── FIRMAS ────────────────────────────────────────────────────────────────
    ensureSpace(72);
    const sigW = W / 3;
    const sigH = 64;
    const sigLabels = ["Responsable de ejecución", "Supervisor / Jefe de Máquinas", "Verificado por"];

    sigLabels.forEach((label, i) => {
      const bx = ML + i * sigW;
      doc.roundedRect(bx, y, sigW, sigH, 0).fillColor(bgBox).fill();
      doc.roundedRect(bx, y, sigW, sigH, 0).strokeColor(border).lineWidth(0.5).stroke();
      doc.fontSize(7).font(FONT_BOLD).fillColor(gray)
        .text(label.toUpperCase(), bx + 10, y + 8, { width: sigW - 20, characterSpacing: 0.5 });
      doc.moveTo(bx + 10, y + 50).lineTo(bx + sigW - 10, y + 50).strokeColor("#aaaaaa").lineWidth(0.8).stroke();
    });
    y += sigH + 8;

    // ── FOOTER ────────────────────────────────────────────────────────────────
    const footerY = PAGE_H - FOOTER_H;
    doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch {}
    }
    doc.fontSize(8).font(FONT_REGULAR).fillColor(gray)
      .text("Copilot Management System — Documento generado automáticamente.", ML + 18, footerY, { width: W / 2 - 18 });
    doc.fontSize(8).font(FONT_REGULAR).fillColor(gray)
      .text(`${val(p["taskCode"])} · ${val(p["vesselCode"])} · ${fmt(new Date())}`, ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
