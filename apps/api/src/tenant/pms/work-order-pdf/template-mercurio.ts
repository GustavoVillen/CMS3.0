// Mercurio Group template (REGI-MAN-02.4 form layout).
// Pure renderer — receives a fully-loaded WorkOrderPdfContext and returns a PDF buffer.

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import {
  fmt, val, motivoFromType, statusLabel, priorityLabel, riskLabel, woResultLabel,
  STATUS_COLOR, PRIORITY_COLOR, sanitizePdfText, LOGO_PATH, PAGE_H,
  type WorkOrderPdfContext,
} from "./shared";

// ── Layout constants (Mercurio form is dense, uses navy blue headers) ───────
const PW       = 595.28;
const ML       = 36;
const MR       = 36;
const W        = PW - ML - MR;
const MARGIN_T = 36;
const APPROVAL_BAND_H = 18;
const FOOTER_INFO_H   = 28;
const FOOTER_H = APPROVAL_BAND_H + FOOTER_INFO_H;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const APPROVAL_COLS = [
  { label: "Elaborado:", value: "Barlovento Servicios Profesionales" },
  { label: "Revisado:",  value: "Asesoría Jurídica" },
  { label: "Aprobado:",  value: "Gerente General" },
];

const NAVY   = "#0C2461";
const WHITE  = "#FFFFFF";
const BLACK  = "#111827";
const GRAY   = "#6B7280";
const BORDER = "#9CA3AF";
const LIGHT  = "#F3F4F6";

export async function renderMercurioWorkOrderPdf(ctx: WorkOrderPdfContext): Promise<Buffer> {
  const { wo, assetLabel, assetIsSafetyCritical, assignedName, createdByName, tenant, tenantLogoBuffer, spareUsages, tenantSlug } = ctx;

  const motivos = ["FALLA", "AVERIA", "INSPECCION", "PLANIFICADO", "CAMBIO", "OTRO"] as const;
  const motivoActivo = motivoFromType((wo as any).type ?? "");
  const department: string | null = (wo as any).department ?? null;
  const DEPTS = ["CUBIERTA", "MAQUINAS", "BARCAZA", "SERVICIOS"] as const;
  const commMethods: string[] = (wo as any).communicationMethod ?? [];
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

    function drawFooter() {
      const fy = PAGE_H - FOOTER_H;

      // ── Approval band (no background — same style as footer text) ──
      doc.moveTo(ML, fy).lineTo(ML + W, fy).strokeColor(BORDER).lineWidth(0.5).stroke();
      const cw = Math.floor(W / APPROVAL_COLS.length);
      APPROVAL_COLS.forEach((col, i) => {
        const cx = ML + i * cw;
        if (i > 0) {
          doc.moveTo(cx, fy + 2).lineTo(cx, fy + APPROVAL_BAND_H - 2)
             .strokeColor(BORDER).lineWidth(0.4).stroke();
        }
        const text = sanitizePdfText(`${col.label} ${col.value}`);
        doc.fontSize(7).font("Helvetica").fillColor(GRAY)
          .text(text, cx + 6, fy + (APPROVAL_BAND_H - 7) / 2 + 1, {
            width: cw - 12, align: "center", lineBreak: false, ellipsis: true,
          });
      });

      // ── Info line: CMS logo + app name (left) | page info (right) ──
      const ify = fy + APPROVAL_BAND_H;
      doc.moveTo(ML, ify).lineTo(ML + W, ify).strokeColor(BORDER).lineWidth(0.5).stroke();

      let textX = ML;
      if (existsSync(LOGO_PATH)) {
        try {
          doc.image(LOGO_PATH, ML, ify + 6, { width: 14, height: 14 });
          textX = ML + 18;
        } catch { /* non-blocking */ }
      }
      doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
        .text("Copilot Management System", textX, ify + 9, { width: W / 2 - 18, lineBreak: false });
      doc.fontSize(7).font("Helvetica").fillColor(GRAY)
        .text(`REGI-MAN-02.4 — Pagina ${page} — ${wo.workOrderCode} — ${wo.vesselCode} — ${fmt(new Date())}`,
          ML, ify + 9, { width: W, align: "right" });
    }

    doc.on("pageAdded", () => { page++; y = MARGIN_T; });

    function ensureSpace(h: number) {
      if (y + h > CONTENT_BOTTOM) { drawFooter(); doc.addPage(); }
    }

    function sectionHeader(title: string, h = 18) {
      ensureSpace(h + 2);
      doc.rect(ML, y, W, h).fillColor(NAVY).fill();
      doc.rect(ML, y, W, h).strokeColor(NAVY).lineWidth(0.5).stroke();
      doc.fontSize(8).font("Helvetica-Bold").fillColor(WHITE)
        .text(title.toUpperCase(), ML + 8, y + (h - 8) / 2 + 1, { width: W - 16, characterSpacing: 0.8 });
      y += h;
    }

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

    // Render text area. Lines starting with a bullet (• · ● ◦ ▪ ▫) get
    // an empty closed square drawn instead of the bullet character.
    const BULLET_RE = /^(\s*)[•·●◦▪▫]\s*(.*)$/;
    const BULLET_BOX = 6;
    const BULLET_GUTTER = 12; // total horizontal space reserved before the text
    const LINE_PAD = 5;

    // Renderiza un cuadro de texto con borde y soporta SPLIT entre páginas:
    // si el contenido excede el espacio disponible, cierra el cuadro en la
    // página actual, mete un page break y continúa en una nueva caja arriba
    // de la página siguiente. Esto evita que un LOTO largo se "salga" del
    // marco y desaparezca el borde en las páginas siguientes.
    function textArea(cx: number, cy: number, cw: number, text: string, minH = 28): number {
      const innerW = cw - LINE_PAD * 2;
      const innerWBullet = innerW - BULLET_GUTTER;
      const rawLines = text ? text.split("\n") : [""];

      doc.fontSize(9).font("Helvetica");
      type Item = { content: string; bullet: boolean; width: number; height: number };
      const items: Item[] = rawLines.map((line) => {
        const m = line.match(BULLET_RE);
        const content = m ? m[2] : line;
        const w = m ? innerWBullet : innerW;
        return { content, bullet: !!m, width: w, height: doc.heightOfString(content || " ", { width: w }) };
      });

      // Pre-compute segments (one per page)
      type Segment = { startY: number; items: Item[] };
      const segments: Segment[] = [];
      let segStartY = cy;
      let segItems: Item[] = [];
      let curLy = cy + LINE_PAD;
      for (const item of items) {
        // Si esta línea no entra en la página actual y ya hay contenido,
        // cerramos el segmento y empezamos uno nuevo arriba de la siguiente.
        if (curLy + item.height + LINE_PAD > CONTENT_BOTTOM && segItems.length > 0) {
          segments.push({ startY: segStartY, items: segItems });
          segItems = [];
          segStartY = MARGIN_T;
          curLy = MARGIN_T + LINE_PAD;
        }
        segItems.push(item);
        curLy += item.height;
      }
      segments.push({ startY: segStartY, items: segItems });

      // Render: una caja por segmento, page break entre segmentos
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (i > 0) {
          drawFooter();
          doc.addPage();
        }
        const contentH = seg.items.reduce((s, it) => s + it.height, 0);
        const isSinglePage = segments.length === 1;
        const segH = isSinglePage ? Math.max(minH, contentH + LINE_PAD * 2) : contentH + LINE_PAD * 2;

        doc.rect(cx, seg.startY, cw, segH).fillColor(WHITE).fill();
        doc.rect(cx, seg.startY, cw, segH).strokeColor(BORDER).lineWidth(0.4).stroke();

        let ly = seg.startY + LINE_PAD;
        doc.fontSize(9).font("Helvetica").fillColor(BLACK);
        for (const item of seg.items) {
          if (item.bullet) {
            doc.rect(cx + LINE_PAD, ly + 2, BULLET_BOX, BULLET_BOX)
               .strokeColor(BLACK).lineWidth(0.7).stroke();
            doc.fillColor(BLACK).font("Helvetica").fontSize(9)
               .text(item.content || " ", cx + LINE_PAD + BULLET_GUTTER, ly, { width: item.width });
          } else {
            doc.fillColor(BLACK).font("Helvetica").fontSize(9)
               .text(item.content || " ", cx + LINE_PAD, ly, { width: item.width });
          }
          ly += item.height;
        }
      }

      // Si hubo page breaks, el handler `pageAdded` ya reseteó y = MARGIN_T.
      // Devolvemos la altura del ÚLTIMO segmento para que el caller, con
      // `y += textArea(...)`, quede al final del último segmento renderizado.
      const lastSeg = segments[segments.length - 1];
      const lastH = lastSeg.items.reduce((s, it) => s + it.height, 0) + LINE_PAD * 2;
      return segments.length === 1 ? Math.max(minH, lastH) : lastH;
    }

    // ── HEADER ────────────────────────────────────────────────────────────────
    const HDR_H = 72;
    doc.rect(ML, y, W, HDR_H).strokeColor(BORDER).lineWidth(0.8).stroke();

    const LOGO_W = Math.floor(W * 0.22);
    doc.rect(ML, y, LOGO_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();

    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, ML + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" }); } catch {}
    } else if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" }); } catch {}
    } else {
      doc.fontSize(8).font("Helvetica-Bold").fillColor(NAVY)
        .text(sanitizePdfText(tenant?.name ?? tenantSlug.toUpperCase()), ML + 4, y + 28, { width: LOGO_W - 8, align: "center" });
    }

    const INFO_W = Math.floor(W * 0.25);
    const CTR_X  = ML + LOGO_W;
    const CTR_W  = W - LOGO_W - INFO_W;
    doc.rect(CTR_X, y, CTR_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(9).font("Helvetica-Bold").fillColor(NAVY)
      .text("REGI-MAN-02.4", CTR_X + 4, y + 14, { width: CTR_W - 8, align: "center" });
    doc.fontSize(10).font("Helvetica-Bold").fillColor(NAVY)
      .text("Orden Interna de Trabajo", CTR_X + 4, y + 32, { width: CTR_W - 8, align: "center" });

    const INFO_X = ML + LOGO_W + CTR_W;
    const ROW_H_INFO = Math.floor(HDR_H / 4);
    const infoRows = [
      ["Revision N°", "2"], ["Desde:", "01.05.2025"], ["Pagina:", String(page)], ["Documento Controlado", ""],
    ];
    infoRows.forEach(([label, val2], i) => {
      const iy = y + i * ROW_H_INFO;
      const ih = i === 3 ? HDR_H - 3 * ROW_H_INFO : ROW_H_INFO;
      doc.rect(INFO_X, iy, INFO_W, ih).strokeColor(BORDER).lineWidth(0.4).stroke();
      if (i < 3) {
        const halfW = Math.floor(INFO_W / 2);
        doc.rect(INFO_X + halfW, iy, INFO_W - halfW, ih).strokeColor(BORDER).lineWidth(0.4).stroke();
        doc.fontSize(7).font("Helvetica").fillColor(GRAY).text(label, INFO_X + 3, iy + (ih - 7) / 2 + 1, { width: halfW - 6, lineBreak: false });
        doc.fontSize(8).font("Helvetica-Bold").fillColor(BLACK).text(val2, INFO_X + halfW + 3, iy + (ih - 8) / 2 + 1, { width: INFO_W - halfW - 6, lineBreak: false, align: "center" });
      } else {
        doc.fontSize(7).font("Helvetica-Bold").fillColor("#1d4ed8")
          .text(label, INFO_X + 3, iy + (ih - 7) / 2 + 1, { width: INFO_W - 6, align: "center", lineBreak: false });
      }
    });
    y += HDR_H;

    // ── REMOLCADOR / ORDEN INTERNA ────────────────────────────────────────────
    const R1_H = 22;
    ensureSpace(R1_H);
    const HALF = Math.floor(W / 2);
    cell(ML, y, 80, R1_H, "REMOLCADOR", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + 80, y, HALF - 80, R1_H, sanitizePdfText(wo.vesselCode ?? ""), { fontSize: 9 });
    cell(ML + HALF, y, 100, R1_H, "ORDEN INTERNA N°", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + HALF + 100, y, W - HALF - 100, R1_H, sanitizePdfText(wo.workOrderCode ?? ""), { bold: true, fontSize: 9, color: "#1d4ed8" });
    y += R1_H;

    // ── DEPARTAMENTO + FECHA ──────────────────────────────────────────────────
    const R2_H = 18;
    ensureSpace(R2_H * 2);
    const FECHA_W = 80;
    cell(ML, y, W - FECHA_W, R2_H, "DEPARTAMENTO", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + W - FECHA_W, y, FECHA_W, R2_H, "FECHA", { bold: true, fontSize: 8, bg: NAVY, color: WHITE, align: "center" });
    y += R2_H;

    const DEPT_ROW_H = 22;
    doc.rect(ML, y, W - FECHA_W, DEPT_ROW_H).fillColor(WHITE).fill();
    doc.rect(ML, y, W - FECHA_W, DEPT_ROW_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const deptW = Math.floor((W - FECHA_W) / DEPTS.length);
    DEPTS.forEach((d, i) => { checkbox(ML + i * deptW + 6, y + 7, d, department === d); });
    cell(ML + W - FECHA_W, y, FECHA_W, DEPT_ROW_H, fmt(wo.openDate), { fontSize: 9, align: "center" });
    y += DEPT_ROW_H;

    // ── EQUIPO / UBICACION ────────────────────────────────────────────────────
    const R3_H = 22;
    ensureSpace(R3_H * 2);
    cell(ML, y, Math.floor(W * 0.4), R3_H, "EQUIPO AFECTADO", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + Math.floor(W * 0.4), y, W - Math.floor(W * 0.4), R3_H, "UBICACION", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    y += R3_H;
    const EQ_W = Math.floor(W * 0.4);
    const assetCellText = assetIsSafetyCritical ? `${assetLabel}  [ISM 10.3]` : assetLabel;
    cell(ML, y, EQ_W, R3_H, assetCellText, { fontSize: 9 });
    cell(ML + EQ_W, y, W - EQ_W, R3_H, sanitizePdfText((wo as any).location ?? ""), { fontSize: 9 });
    y += R3_H;

    // ── MOTIVO ────────────────────────────────────────────────────────────────
    sectionHeader("MOTIVO DE LA ORDEN INTERNA DE TRABAJO");
    const MOTIVO_H = 22;
    ensureSpace(MOTIVO_H);
    doc.rect(ML, y, W, MOTIVO_H).fillColor(WHITE).fill();
    doc.rect(ML, y, W, MOTIVO_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const motivoW = Math.floor(W / motivos.length);
    motivos.forEach((m, i) => { checkbox(ML + i * motivoW + 6, y + 7, m, m === motivoActivo); });
    y += MOTIVO_H;

    // ── DESCRIPCION ───────────────────────────────────────────────────────────
    sectionHeader("DESCRIPCION DEL TRABAJO A REALIZARSE");
    ensureSpace(38);
    y += textArea(ML, y, W, sanitizePdfText((wo as any).description ?? ""), 38);

    // ── CRITERIOS DE ACEPTACION ───────────────────────────────────────────────
    sectionHeader("CRITERIOS DE ACEPTACION");
    ensureSpace(38);
    y += textArea(ML, y, W, sanitizePdfText((wo as any).acceptanceCriteria ?? ""), 38);

    // ── LOTO ──────────────────────────────────────────────────────────────────
    sectionHeader("LOTO (LOCKOUT / TAGOUT)");
    ensureSpace(38);
    y += textArea(ML, y, W, sanitizePdfText((wo as any).loto ?? ""), 38);

    // ── NIVEL DE RIESGO ───────────────────────────────────────────────────────
    sectionHeader("NIVEL DE RIESGO");
    const RISK_H = 22;
    ensureSpace(RISK_H);
    const RISK_COLOR: Record<string, string> = {
      LOW: "#16a34a", MEDIUM: "#b45309", HIGH: "#b91c1c", CRITICAL: "#7f1d1d",
    };
    cell(ML, y, W, RISK_H, sanitizePdfText(riskLabel((wo as any).riskLevel)), {
      fontSize: 11, bold: true, align: "center",
      color: RISK_COLOR[(wo as any).riskLevel ?? ""] ?? BLACK,
    });
    y += RISK_H;

    // ── RESULTADO ANALISIS DE RIESGO ──────────────────────────────────────────
    sectionHeader("RESULTADO DEL ANALISIS DE RIESGO");
    ensureSpace(38);
    y += textArea(ML, y, W, sanitizePdfText((wo as any).riskAnalysisResult ?? ""), 38);

    // CMS extras: plan inline (Responsable / Horas / Prioridad — riesgo ya tiene su propia sección)
    if ((wo as any).estimatedHours || assignedName || (wo as any).priority) {
      const PLAN_ROW_H = 22;
      ensureSpace(PLAN_ROW_H * 2);
      const planCols = [
        { label: "Responsable", value: sanitizePdfText(assignedName ?? (wo as any).assignedToUserId ?? "—") },
        { label: "Horas estimadas", value: (wo as any).estimatedHours != null ? `${(wo as any).estimatedHours} h` : "—" },
        { label: "Horas trabajadas", value: (wo as any).actualHours != null ? `${(wo as any).actualHours} h` : "—" },
        { label: "Prioridad", value: sanitizePdfText(priorityLabel((wo as any).priority ?? "")), color: PRIORITY_COLOR[(wo as any).priority ?? ""] },
      ];
      const colW = Math.floor(W / planCols.length);
      planCols.forEach((col, i) => { cell(ML + i * colW, y, colW, PLAN_ROW_H, col.label, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY }); });
      y += PLAN_ROW_H;
      planCols.forEach((col, i) => { cell(ML + i * colW, y, colW, PLAN_ROW_H, col.value, { fontSize: 9, color: col.color }); });
      y += PLAN_ROW_H;
    }

    // ── REPUESTOS ─────────────────────────────────────────────────────────────
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
      y += textArea(ML, y, W, "", 28);
    }

    // ── FALLAS / NOVEDADES ────────────────────────────────────────────────────
    sectionHeader("FALLAS, DAÑOS, AVERÍAS O NOVEDADES CONSTATADAS");
    ensureSpace(38);
    y += textArea(ML, y, W, val((wo as any).observations), 38);

    // CMS extras: resultado
    if ((wo as any).woResult) {
      ensureSpace(44);
      const RES_ROW = 22;
      const resCols = [
        { label: "Resultado OT", value: sanitizePdfText(woResultLabel((wo as any).woResult)),
          color: (wo as any).woResult === "SATISFACTORY" ? "#166534" : "#991b1b" },
        { label: "Estado", value: sanitizePdfText(statusLabel((wo as any).status ?? "")), color: STATUS_COLOR[(wo as any).status ?? ""] },
        { label: "Ejecutado por", value: sanitizePdfText((wo as any).executedByName ?? "—") },
        { label: "Horas motor al ejecutar", value: (wo as any).runningHoursAtExecution != null ? `${(wo as any).runningHoursAtExecution} h` : "—" },
      ];
      const rColW = Math.floor(W / resCols.length);
      resCols.forEach((col, i) => { cell(ML + i * rColW, y, rColW, RES_ROW, col.label, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY }); });
      y += RES_ROW;
      resCols.forEach((col, i) => { cell(ML + i * rColW, y, rColW, RES_ROW, col.value, { fontSize: 9, bold: true, color: col.color }); });
      y += RES_ROW;
    }

    // ── COMENTARIOS ───────────────────────────────────────────────────────────
    sectionHeader("COMENTARIOS ADICIONALES");
    ensureSpace(38);
    const closeNotes = val((wo as any).closeNotes) || val((wo as any).acceptanceCriteria) || val((wo as any).loto) || "";
    y += textArea(ML, y, W, closeNotes, 38);

    // ── GENERADO POR ──────────────────────────────────────────────────────────
    sectionHeader("ESTE DOCUMENTO FUE GENERADO POR");
    ensureSpace(34);
    doc.rect(ML, y, W, 12).fillColor(LIGHT).fill();
    doc.rect(ML, y, W, 12).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(7).font("Helvetica").fillColor(GRAY)
      .text("(Indicar nombre, posicion y si es impreso sello)", ML + 6, y + 2, { width: W - 12, align: "center" });
    y += 12;
    y += textArea(ML, y, W, createdByName ? sanitizePdfText(createdByName) : "", 22);

    // ── COMUNICACION ──────────────────────────────────────────────────────────
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

    // ── DISTRIBUCION ──────────────────────────────────────────────────────────
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

    const OTROS_H = 20;
    doc.rect(ML, y, W, OTROS_H).fillColor(WHITE).fill();
    doc.rect(ML, y, W, OTROS_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(8).font("Helvetica-Bold").fillColor(GRAY)
      .text("OTROS (Indicar):", ML + 4, y + 6, { width: 80, lineBreak: false });
    y += OTROS_H;

    // ── FIRMAS ────────────────────────────────────────────────────────────────
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

    // ── ANEXO FOTOGRÁFICO ─────────────────────────────────────────────────────
    // Si la OT tiene fotos cargadas como avances (kind=PHOTO), se anexan al
    // final del documento. Grid de 2 columnas, una página por bloque de 4 fotos.
    if (ctx.progressPhotos && ctx.progressPhotos.length > 0) {
      const fotosConBuffer = ctx.progressPhotos.filter(p => p.buffer && p.buffer.length > 0);
      if (fotosConBuffer.length > 0) {
        drawFooter();
        doc.addPage();
        y = MARGIN_T;
        sectionHeader("ANEXO FOTOGRÁFICO");

        const COLS = 2;
        const GAP_X = 12;
        const GAP_Y = 16;
        const cellW = (W - GAP_X * (COLS - 1)) / COLS;
        const imgH = 200;
        const captionH = 36;
        const cellH = imgH + captionH;

        for (let i = 0; i < fotosConBuffer.length; i++) {
          const foto = fotosConBuffer[i];
          const col = i % COLS;
          if (col === 0 && i > 0) {
            y += cellH + GAP_Y;
          }
          if (y + cellH > CONTENT_BOTTOM) {
            drawFooter();
            doc.addPage();
            sectionHeader("ANEXO FOTOGRÁFICO (CONT.)");
          }
          const x = ML + col * (cellW + GAP_X);
          try {
            doc.image(foto.buffer!, x, y, { fit: [cellW, imgH], align: "center", valign: "center" });
            doc.rect(x, y, cellW, imgH).strokeColor(BORDER).lineWidth(0.5).stroke();
          } catch {
            doc.rect(x, y, cellW, imgH).strokeColor(BORDER).lineWidth(0.5).stroke();
            doc.fontSize(8).font("Helvetica").fillColor(GRAY)
              .text("[Imagen no disponible]", x + 8, y + imgH / 2 - 4, { width: cellW - 16, align: "center" });
          }
          const captionY = y + imgH + 4;
          const tsLabel = new Date(foto.createdAt).toLocaleString("es-AR", {
            day: "2-digit", month: "2-digit", year: "2-digit",
            hour: "2-digit", minute: "2-digit",
          });
          doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
            .text(tsLabel, x, captionY, { width: cellW, lineBreak: false });
          if (foto.text) {
            doc.fontSize(8).font("Helvetica").fillColor(BLACK)
              .text(sanitizePdfText(foto.text), x, captionY + 10, { width: cellW, height: captionH - 12, ellipsis: true, lineBreak: true });
          }
        }
        y += cellH;
      }
    }

    drawFooter();
    doc.end();
  });
}
