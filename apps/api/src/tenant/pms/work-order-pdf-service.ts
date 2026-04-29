import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getTenantWorkOrder } from "../work-orders/work-orders-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-AR");
}

function val(v: string | null | undefined): string {
  if (!v?.trim()) return "";
  return sanitizePdfText(v.trim());
}

function motivo(type: string): string {
  if (type === "CORRECTIVE")  return "FALLA";
  if (type === "INSPECTION")  return "INSPECCION";
  if (type === "PREVENTIVE")  return "PLANIFICADO";
  return "OTRO";
}

function statusLabel(s: string): string {
  const m: Record<string, string> = {
    PLANNED: "Planificada", IN_PROGRESS: "En ejecucion", ON_HOLD: "Postergada",
    CLOSED: "Cerrada", CANCELLED: "Cancelada", DEFERRED: "Diferida",
  };
  return m[s] ?? s;
}

function priorityLabel(p: string): string {
  const m: Record<string, string> = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Critica" };
  return m[p] ?? p;
}

function riskLabel(r: string | null | undefined): string {
  if (!r) return "—";
  return { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Critico" }[r] ?? r;
}

function woResultLabel(r: string | null | undefined): string {
  if (!r) return "—";
  return r === "SATISFACTORY" ? "Satisfactorio" : "Con deficiencias";
}

const STATUS_COLOR: Record<string, string> = {
  PLANNED: "#0369a1", IN_PROGRESS: "#b45309", ON_HOLD: "#7c3aed",
  CLOSED: "#166534", CANCELLED: "#991b1b", DEFERRED: "#374151",
};
const PRIORITY_COLOR: Record<string, string> = {
  LOW: "#16a34a", MEDIUM: "#b45309", HIGH: "#b91c1c", CRITICAL: "#7f1d1d",
};

// ── Layout constants ──────────────────────────────────────────────────────────

const PW       = 595.28;
const PAGE_H   = 841.89;
const ML       = 36;
const MR       = 36;
const W        = PW - ML - MR;
const MARGIN_T = 36;
const FOOTER_H = 28;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const NAVY   = "#0C2461";
const WHITE  = "#FFFFFF";
const BLACK  = "#111827";
const GRAY   = "#6B7280";
const BORDER = "#9CA3AF";
const LIGHT  = "#F3F4F6";

// ── PDF builder ───────────────────────────────────────────────────────────────

export async function buildWorkOrderPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const wo = await getTenantWorkOrder(session, id);
  const prismaRaw = getPrismaClient();

  // Resolve assigned user name
  let assignedName: string | null = null;
  if (prismaRaw && (wo as any).assignedToUserId) {
    try {
      const u = await (prismaRaw as any).user.findUnique({
        where: { id: (wo as any).assignedToUserId },
        select: { firstName: true, lastName: true },
      });
      if (u) assignedName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null;
    } catch { /* non-blocking */ }
  }

  // Resolve created-by user name
  let createdByName: string | null = null;
  if (prismaRaw && (wo as any).createdByUserId) {
    try {
      const u = await (prismaRaw as any).user.findUnique({
        where: { id: (wo as any).createdByUserId },
        select: { firstName: true, lastName: true, email: true },
      });
      if (u) createdByName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || null;
    } catch { /* non-blocking */ }
  }

  // Tenant logo + name
  let tenant: { name?: string; logoUrl?: string | null; logoUrlLight?: string | null } | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  if (prismaRaw) {
    try {
      const row = await (prismaRaw as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      tenant = row?.settings
        ? { name: row.settings.displayName, logoUrl: row.settings.logoUrl, logoUrlLight: row.settings.logoUrlLight }
        : null;
      tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, tenant?.logoUrl, tenant?.logoUrlLight);
    } catch { /* non-blocking */ }
  }

  // Spare usages for this work order
  type SpareRow = { spareName: string; quantity: number; unit: string };
  const spareUsages: SpareRow[] = [];
  if (prismaRaw) {
    try {
      const movements = await (prismaRaw as any).stockMovement.findMany({
        where: { referenceType: "WORK_ORDER", referenceId: wo.id, tenantId: (wo as any).tenantId, quantity: { gt: 0 } },
        select: { quantity: true, unit: true, spareId: true },
      });
      for (const m of movements) {
        try {
          const spare = await (prismaRaw as any).spare.findUnique({
            where: { id: m.spareId },
            select: { name: true, partNumber: true },
          });
          spareUsages.push({
            spareName: spare ? `${spare.name}${spare.partNumber ? ` (${spare.partNumber})` : ""}` : m.spareId,
            quantity: m.quantity,
            unit: m.unit,
          });
        } catch { /* non-blocking */ }
      }
    } catch { /* non-blocking */ }
  }

  const assetLabel = sanitizePdfText((wo as any).assetName ?? wo.assetId ?? "—");
  const motivos = ["FALLA", "AVERIA", "INSPECCION", "PLANIFICADO", "CAMBIO", "OTRO"] as const;
  const motivoActivo = motivo((wo as any).type ?? "");

  const department: string | null = (wo as any).department ?? null;
  const DEPTS = ["CUBIERTA", "MAQUINAS", "BARCAZA", "SERVICIOS"] as const;

  const commMethods: string[]  = (wo as any).communicationMethod ?? [];
  const COMM_OPTS = ["IMPRESO", "EMAIL", "WHAPP", "OTRO"] as const;

  const distList: string[] = (wo as any).distribution ?? [];
  const DIST_ROWS = [
    ["GGE", "PDT", "JTE", "JOP", "JRH", "JVE"],
    ["JCO", "JSE", "JUR", "ADM", "CAP", "JMA"],
  ] as const;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `OT ${wo.workOrderCode}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = MARGIN_T;
    let page = 1;

    // ── Footer renderer ───────────────────────────────────────────────────────
    function drawFooter() {
      const fy = PAGE_H - FOOTER_H;
      doc.moveTo(ML, fy).lineTo(ML + W, fy).strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.fontSize(7).font("Helvetica").fillColor(GRAY)
        .text(`REGI-MAN — Pagina ${page} — ${wo.workOrderCode} — ${wo.vesselCode} — ${fmt(new Date())}`,
          ML, fy + 7, { width: W, align: "center" });
    }

    doc.on("pageAdded", () => {
      page++;
      y = MARGIN_T;
    });

    function ensureSpace(h: number) {
      if (y + h > CONTENT_BOTTOM) {
        drawFooter();
        doc.addPage();
      }
    }

    // ── Section header (full-width dark navy) ─────────────────────────────────
    function sectionHeader(title: string, h = 18) {
      ensureSpace(h + 2);
      doc.rect(ML, y, W, h).fillColor(NAVY).fill();
      doc.rect(ML, y, W, h).strokeColor(NAVY).lineWidth(0.5).stroke();
      doc.fontSize(8).font("Helvetica-Bold").fillColor(WHITE)
        .text(title.toUpperCase(), ML + 8, y + (h - 8) / 2 + 1, { width: W - 16, characterSpacing: 0.8 });
      y += h;
    }

    // ── Content cell with border ──────────────────────────────────────────────
    function cell(cx: number, cy: number, cw: number, ch: number, text: string, opts: {
      bold?: boolean; fontSize?: number; align?: "left" | "center" | "right";
      bg?: string; color?: string; noStroke?: boolean;
    } = {}) {
      if (opts.bg) doc.rect(cx, cy, cw, ch).fillColor(opts.bg).fill();
      if (!opts.noStroke) doc.rect(cx, cy, cw, ch).strokeColor(BORDER).lineWidth(0.4).stroke();
      if (text) {
        doc.fontSize(opts.fontSize ?? 9)
          .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
          .fillColor(opts.color ?? BLACK)
          .text(text, cx + 5, cy + (ch - (opts.fontSize ?? 9)) / 2, {
            width: cw - 10,
            align: opts.align ?? "left",
            lineBreak: false,
            ellipsis: true,
          });
      }
    }

    // ── Checkbox ──────────────────────────────────────────────────────────────
    function checkbox(cx: number, cy: number, label: string, checked: boolean) {
      const BOX = 8;
      doc.rect(cx, cy, BOX, BOX).strokeColor(BORDER).lineWidth(0.6).stroke();
      if (checked) {
        doc.fontSize(6).font("Helvetica-Bold").fillColor(NAVY)
          .text("X", cx + 1, cy + 1, { width: BOX - 2, align: "center", lineBreak: false });
      }
      doc.fontSize(8).font("Helvetica").fillColor(BLACK)
        .text(label, cx + BOX + 4, cy + 0.5, { lineBreak: false });
    }

    // ── Multi-line text area ──────────────────────────────────────────────────
    function textArea(cx: number, cy: number, cw: number, text: string, minH = 28): number {
      const innerW = cw - 10;
      const h = Math.max(minH, text
        ? doc.fontSize(9).font("Helvetica").heightOfString(text, { width: innerW }) + 10
        : minH);
      doc.rect(cx, cy, cw, h).fillColor(WHITE).fill();
      doc.rect(cx, cy, cw, h).strokeColor(BORDER).lineWidth(0.4).stroke();
      if (text) {
        doc.fontSize(9).font("Helvetica").fillColor(BLACK)
          .text(text, cx + 5, cy + 5, { width: innerW });
      }
      return h;
    }

    // ════════════════════════════════════════════════════════════════════════
    // HEADER
    // ════════════════════════════════════════════════════════════════════════
    const HDR_H = 72;

    // Outer border
    doc.rect(ML, y, W, HDR_H).strokeColor(BORDER).lineWidth(0.8).stroke();

    // Logo zone (left, ~20% width)
    const LOGO_W = Math.floor(W * 0.22);
    doc.rect(ML, y, LOGO_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();

    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" });
      } catch { /* non-blocking */ }
    } else if (existsSync(LOGO_PATH)) {
      try {
        doc.image(LOGO_PATH, ML + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" });
      } catch { /* non-blocking */ }
    } else {
      doc.fontSize(8).font("Helvetica-Bold").fillColor(NAVY)
        .text(sanitizePdfText(tenant?.name ?? session.tenantSlug.toUpperCase()), ML + 4, y + 28, {
          width: LOGO_W - 8, align: "center",
        });
    }

    // Center zone: document code + title
    const INFO_W = Math.floor(W * 0.25);
    const CTR_X  = ML + LOGO_W;
    const CTR_W  = W - LOGO_W - INFO_W;
    doc.rect(CTR_X, y, CTR_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(9).font("Helvetica-Bold").fillColor(NAVY)
      .text("REGI-MAN-02.4", CTR_X + 4, y + 14, { width: CTR_W - 8, align: "center" });
    doc.fontSize(10).font("Helvetica-Bold").fillColor(NAVY)
      .text("Orden Interna de Trabajo", CTR_X + 4, y + 32, { width: CTR_W - 8, align: "center" });

    // Right zone: revision info
    const INFO_X = ML + LOGO_W + CTR_W;
    const ROW_H_INFO = Math.floor(HDR_H / 4);
    const infoRows = [
      ["Revision N°", "2"],
      ["Desde:", "01.05.2025"],
      ["Pagina:", String(page)],
      ["Documento Controlado", ""],
    ];
    infoRows.forEach(([label, val2], i) => {
      const iy = y + i * ROW_H_INFO;
      const ih = i === 3 ? HDR_H - 3 * ROW_H_INFO : ROW_H_INFO;
      doc.rect(INFO_X, iy, INFO_W, ih).strokeColor(BORDER).lineWidth(0.4).stroke();
      if (i < 3) {
        const halfW = Math.floor(INFO_W / 2);
        doc.rect(INFO_X + halfW, iy, INFO_W - halfW, ih).strokeColor(BORDER).lineWidth(0.4).stroke();
        doc.fontSize(7).font("Helvetica").fillColor(GRAY)
          .text(label, INFO_X + 3, iy + (ih - 7) / 2 + 1, { width: halfW - 6, lineBreak: false });
        doc.fontSize(8).font("Helvetica-Bold").fillColor(BLACK)
          .text(val2, INFO_X + halfW + 3, iy + (ih - 8) / 2 + 1, { width: INFO_W - halfW - 6, lineBreak: false, align: "center" });
      } else {
        doc.fontSize(7).font("Helvetica-Bold").fillColor("#1d4ed8")
          .text(label, INFO_X + 3, iy + (ih - 7) / 2 + 1, { width: INFO_W - 6, align: "center", lineBreak: false });
      }
    });

    y += HDR_H;

    // ════════════════════════════════════════════════════════════════════════
    // ROW 1: REMOLCADOR | ORDEN INTERNA N°
    // ════════════════════════════════════════════════════════════════════════
    const R1_H = 22;
    ensureSpace(R1_H);
    const HALF = Math.floor(W / 2);

    // REMOLCADOR
    cell(ML, y, 80, R1_H, "REMOLCADOR", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + 80, y, HALF - 80, R1_H, sanitizePdfText(wo.vesselCode ?? ""), { fontSize: 9 });

    // ORDEN INTERNA N°
    cell(ML + HALF, y, 100, R1_H, "ORDEN INTERNA N°", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + HALF + 100, y, W - HALF - 100, R1_H, sanitizePdfText(wo.workOrderCode ?? ""), { bold: true, fontSize: 9, color: "#1d4ed8" });

    y += R1_H;

    // ════════════════════════════════════════════════════════════════════════
    // ROW 2: DEPARTAMENTO + FECHA
    // ════════════════════════════════════════════════════════════════════════
    const R2_H = 18;
    ensureSpace(R2_H * 2);

    // Header "DEPARTAMENTO ... FECHA"
    const FECHA_W = 80;
    cell(ML, y, W - FECHA_W, R2_H, "DEPARTAMENTO", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + W - FECHA_W, y, FECHA_W, R2_H, "FECHA", { bold: true, fontSize: 8, bg: NAVY, color: WHITE, align: "center" });
    y += R2_H;

    // Checkboxes row + date
    const DEPT_ROW_H = 22;
    doc.rect(ML, y, W - FECHA_W, DEPT_ROW_H).fillColor(WHITE).fill();
    doc.rect(ML, y, W - FECHA_W, DEPT_ROW_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const deptW = Math.floor((W - FECHA_W) / DEPTS.length);
    DEPTS.forEach((d, i) => {
      checkbox(ML + i * deptW + 6, y + 7, d, department === d);
    });
    cell(ML + W - FECHA_W, y, FECHA_W, DEPT_ROW_H, fmt(wo.openDate), { fontSize: 9, align: "center" });
    y += DEPT_ROW_H;

    // ════════════════════════════════════════════════════════════════════════
    // ROW 3: EQUIPO AFECTADO | UBICACION
    // ════════════════════════════════════════════════════════════════════════
    const R3_H = 22;
    ensureSpace(R3_H * 2);

    cell(ML, y, Math.floor(W * 0.4), R3_H, "EQUIPO AFECTADO", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + Math.floor(W * 0.4), y, W - Math.floor(W * 0.4), R3_H, "UBICACION", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    y += R3_H;

    const EQ_W = Math.floor(W * 0.4);
    cell(ML, y, EQ_W, R3_H, assetLabel, { fontSize: 9 });
    cell(ML + EQ_W, y, W - EQ_W, R3_H, val((wo as any).location), { fontSize: 9 });
    y += R3_H;

    // ════════════════════════════════════════════════════════════════════════
    // MOTIVO
    // ════════════════════════════════════════════════════════════════════════
    const MOTIVO_H = 22;
    sectionHeader("MOTIVO DE LA ORDEN INTERNA DE TRABAJO");
    ensureSpace(MOTIVO_H);
    doc.rect(ML, y, W, MOTIVO_H).fillColor(WHITE).fill();
    doc.rect(ML, y, W, MOTIVO_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const motivoW = Math.floor(W / motivos.length);
    motivos.forEach((m, i) => {
      checkbox(ML + i * motivoW + 6, y + 7, m, m === motivoActivo);
    });
    y += MOTIVO_H;

    // ════════════════════════════════════════════════════════════════════════
    // DESCRIPCION DEL TRABAJO
    // ════════════════════════════════════════════════════════════════════════
    sectionHeader("DESCRIPCION DEL TRABAJO A REALIZARSE");
    ensureSpace(38);
    const descH = textArea(ML, y, W, val((wo as any).description), 38);
    y += descH;

    // CMS extra — plan fields inline
    if ((wo as any).estimatedHours || (wo as any).riskLevel || assignedName) {
      const PLAN_ROW_H = 22;
      ensureSpace(PLAN_ROW_H * 2);
      const planCols = [
        { label: "Responsable", value: sanitizePdfText(assignedName ?? (wo as any).assignedToUserId ?? "—") },
        { label: "Horas estimadas", value: (wo as any).estimatedHours != null ? `${(wo as any).estimatedHours} h` : "—" },
        { label: "Nivel de riesgo", value: riskLabel((wo as any).riskLevel) },
        { label: "Prioridad", value: sanitizePdfText(priorityLabel((wo as any).priority ?? "")), color: PRIORITY_COLOR[(wo as any).priority ?? ""] },
      ];
      const colW = Math.floor(W / planCols.length);
      planCols.forEach((col, i) => {
        cell(ML + i * colW, y, colW, PLAN_ROW_H, col.label, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY });
      });
      y += PLAN_ROW_H;
      planCols.forEach((col, i) => {
        cell(ML + i * colW, y, colW, PLAN_ROW_H, col.value, { fontSize: 9, color: col.color });
      });
      y += PLAN_ROW_H;
    }

    // ════════════════════════════════════════════════════════════════════════
    // REPUESTOS UTILIZADOS
    // ════════════════════════════════════════════════════════════════════════
    sectionHeader("REPUESTOS UTILIZADOS");
    ensureSpace(28);
    if (spareUsages.length > 0) {
      const ROW_H_S = 16;
      const COL_W = [Math.floor(W * 0.7), Math.floor(W * 0.15), W - Math.floor(W * 0.7) - Math.floor(W * 0.15)];
      const headers = ["Descripcion / N° Parte", "Cantidad", "Unidad"];
      headers.forEach((h, i) => {
        const cx = ML + COL_W.slice(0, i).reduce((a, b) => a + b, 0);
        cell(cx, y, COL_W[i], ROW_H_S, h, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY });
      });
      y += ROW_H_S;
      spareUsages.forEach(s => {
        ensureSpace(ROW_H_S);
        const row = [s.spareName, String(s.quantity), s.unit];
        row.forEach((v, i) => {
          const cx = ML + COL_W.slice(0, i).reduce((a, b) => a + b, 0);
          cell(cx, y, COL_W[i], ROW_H_S, sanitizePdfText(v), { fontSize: 8 });
        });
        y += ROW_H_S;
      });
    } else {
      const emptyH = textArea(ML, y, W, "", 28);
      y += emptyH;
    }

    // ════════════════════════════════════════════════════════════════════════
    // FALLAS, DAÑOS, AVERÍAS O NOVEDADES CONSTATADAS
    // ════════════════════════════════════════════════════════════════════════
    sectionHeader("FALLAS, DAÑOS, AVERÍAS O NOVEDADES CONSTATADAS");
    ensureSpace(38);
    const obsH = textArea(ML, y, W, val((wo as any).observations), 38);
    y += obsH;

    // CMS extra — resultado de ejecucion
    if ((wo as any).woResult) {
      ensureSpace(44);
      const RES_ROW = 22;
      const resCols = [
        { label: "Resultado OT", value: sanitizePdfText(woResultLabel((wo as any).woResult)),
          color: (wo as any).woResult === "SATISFACTORY" ? "#166534" : "#991b1b" },
        { label: "Estado", value: sanitizePdfText(statusLabel((wo as any).status ?? "")),
          color: STATUS_COLOR[(wo as any).status ?? ""] },
        { label: "Ejecutado por", value: sanitizePdfText((wo as any).executedByName ?? "—") },
        { label: "Horas motor al ejecutar", value: (wo as any).runningHoursAtExecution != null ? `${(wo as any).runningHoursAtExecution} h` : "—" },
      ];
      const rColW = Math.floor(W / resCols.length);
      resCols.forEach((col, i) => {
        cell(ML + i * rColW, y, rColW, RES_ROW, col.label, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY });
      });
      y += RES_ROW;
      resCols.forEach((col, i) => {
        cell(ML + i * rColW, y, rColW, RES_ROW, col.value, { fontSize: 9, bold: true, color: col.color });
      });
      y += RES_ROW;
    }

    // ════════════════════════════════════════════════════════════════════════
    // COMENTARIOS ADICIONALES
    // ════════════════════════════════════════════════════════════════════════
    sectionHeader("COMENTARIOS ADICIONALES");
    ensureSpace(38);
    const closeNotes = val((wo as any).closeNotes) || val((wo as any).acceptanceCriteria) || val((wo as any).loto) || "";
    const cmtH = textArea(ML, y, W, closeNotes, 38);
    y += cmtH;

    // ════════════════════════════════════════════════════════════════════════
    // GENERADO POR
    // ════════════════════════════════════════════════════════════════════════
    sectionHeader("ESTE DOCUMENTO FUE GENERADO POR");
    ensureSpace(34);
    doc.rect(ML, y, W, 12).fillColor(LIGHT).fill();
    doc.rect(ML, y, W, 12).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(7).font("Helvetica").fillColor(GRAY)
      .text("(Indicar nombre, posicion y si es impreso sello)", ML + 6, y + 2, { width: W - 12, align: "center" });
    y += 12;
    const byH = textArea(ML, y, W, createdByName ? sanitizePdfText(createdByName) : "", 22);
    y += byH;

    // ════════════════════════════════════════════════════════════════════════
    // MEDIO DE COMUNICACIÓN
    // ════════════════════════════════════════════════════════════════════════
    sectionHeader("MEDIO DE COMUNICACIÓN UTILIZADO");
    ensureSpace(24);
    const COMM_H = 24;
    doc.rect(ML, y, W, COMM_H).fillColor(WHITE).fill();
    doc.rect(ML, y, W, COMM_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const commW = Math.floor(W / COMM_OPTS.length);
    COMM_OPTS.forEach((opt, i) => {
      const cx = ML + i * commW;
      doc.rect(cx, y, commW, COMM_H).strokeColor(BORDER).lineWidth(0.3).stroke();
      doc.fontSize(8).font("Helvetica-Bold").fillColor(GRAY)
        .text(opt, cx + 4, y + 3, { width: commW - 8, align: "center", lineBreak: false });
      checkbox(cx + commW / 2 - 4, y + 13, "", commMethods.includes(opt));
    });
    y += COMM_H;

    // ════════════════════════════════════════════════════════════════════════
    // DISTRIBUCIÓN
    // ════════════════════════════════════════════════════════════════════════
    sectionHeader("DISTRIBUCION");
    ensureSpace(60);

    DIST_ROWS.forEach(row => {
      const DIST_H = 18;
      doc.rect(ML, y, W, DIST_H).fillColor(WHITE).fill();
      doc.rect(ML, y, W, DIST_H).strokeColor(BORDER).lineWidth(0.4).stroke();
      const dw = Math.floor(W / row.length);
      (row as readonly string[]).forEach((code, i) => {
        const cx = ML + i * dw;
        doc.rect(cx, y, dw, DIST_H).strokeColor(BORDER).lineWidth(0.3).stroke();
        checkbox(cx + 4, y + 5, code, distList.includes(code));
      });
      y += DIST_H;
    });

    // OTROS row
    const OTROS_H = 20;
    doc.rect(ML, y, W, OTROS_H).fillColor(WHITE).fill();
    doc.rect(ML, y, W, OTROS_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(8).font("Helvetica-Bold").fillColor(GRAY)
      .text("OTROS (Indicar):", ML + 4, y + 6, { width: 80, lineBreak: false });
    y += OTROS_H;

    // ════════════════════════════════════════════════════════════════════════
    // CMS EXTRA — FIRMAS
    // ════════════════════════════════════════════════════════════════════════
    ensureSpace(68);
    y += 8;
    const sigLabels = ["Responsable de ejecucion", "Supervisor / Jefe de Maquinas", "Verificado por"];
    const sigW2 = Math.floor(W / 3);
    const SIG_H = 56;
    sigLabels.forEach((label, i) => {
      const bx = ML + i * sigW2;
      doc.rect(bx, y, sigW2, SIG_H).fillColor(LIGHT).fill();
      doc.rect(bx, y, sigW2, SIG_H).strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
        .text(label.toUpperCase(), bx + 6, y + 6, { width: sigW2 - 12, align: "center", lineBreak: false, characterSpacing: 0.3 });
      doc.moveTo(bx + 10, y + 44).lineTo(bx + sigW2 - 10, y + 44).strokeColor("#aaaaaa").lineWidth(0.8).stroke();
      if (i === 0 && assignedName) {
        doc.fontSize(7).font("Helvetica").fillColor(GRAY)
          .text(sanitizePdfText(assignedName), bx + 6, y + 46, { width: sigW2 - 12, align: "center", lineBreak: false });
      }
    });
    y += SIG_H;

    drawFooter();
    doc.end();
  });
}
