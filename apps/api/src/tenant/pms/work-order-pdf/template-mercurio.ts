// Mercurio Group template (estilo de documento controlado).
// Renderer puro: recibe un WorkOrderPdfContext ya cargado y devuelve un Buffer.
//
// El "chrome" (header/footer del documento controlado) y las primitivas de
// dibujo viven en ../pdf-form-chrome.ts. Los metadatos del formulario (numero,
// revision, vigencia, footer) salen de ctx.formMeta — fuente de verdad: TenantForm.

import PDFDocument from "pdfkit";
import {
  fmt, val, motivoFromType, statusLabel, priorityLabel, riskLabel, woResultLabel,
  STATUS_COLOR, PRIORITY_COLOR, sanitizePdfText, PAGE_H,
  type WorkOrderPdfContext,
} from "./shared";
import {
  FORM_COLORS, FOOTER_H, drawControlledDocHeader, drawControlledDocFooter, createFormCanvas,
} from "../pdf-form-chrome";

// ── Layout constants ─────────────────────────────────────────────────────────
const PW       = 595.28;
const ML       = 36;
const MR       = 36;
const W        = PW - ML - MR;
const MARGIN_T = 36;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const { NAVY, WHITE, BLACK, GRAY, BORDER, LIGHT } = FORM_COLORS;

export async function renderMercurioWorkOrderPdf(ctx: WorkOrderPdfContext): Promise<Buffer> {
  const { wo, assetLabel, assetIsSafetyCritical, assignedName, createdByName, tenant, formLogoBuffer, formMeta, spareUsages, tenantSlug } = ctx;

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

    const rightInfo = (page: number) =>
      `${formMeta.formCode} — Pagina ${page} — ${wo.workOrderCode} — ${wo.vesselCode} — ${fmt(new Date())}`;

    const canvas = createFormCanvas(doc, {
      ml: ML, w: W, marginT: MARGIN_T, contentBottom: CONTENT_BOTTOM,
      drawFooter: (page) => drawControlledDocFooter(doc, { meta: formMeta, rightInfo: rightInfo(page), x: ML, w: W }),
    });
    const { sectionHeader, cell, checkbox, textArea, ensureSpace } = canvas;

    // ── HEADER (documento controlado) ───────────────────────────────────────
    const hdrH = drawControlledDocHeader(doc, {
      meta: formMeta,
      logoBuffer: formLogoBuffer,
      tenantName: tenant?.name ?? tenantSlug.toUpperCase(),
      x: ML, y: MARGIN_T, w: W, page: canvas.page,
    });
    canvas.y = MARGIN_T + hdrH;

    // ── REMOLCADOR / ORDEN INTERNA ──────────────────────────────────────────
    const R1_H = 22;
    ensureSpace(R1_H);
    const HALF = Math.floor(W / 2);
    cell(ML, canvas.y, 80, R1_H, "REMOLCADOR", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + 80, canvas.y, HALF - 80, R1_H, sanitizePdfText(wo.vesselCode ?? ""), { fontSize: 9 });
    cell(ML + HALF, canvas.y, 100, R1_H, "ORDEN INTERNA N°", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + HALF + 100, canvas.y, W - HALF - 100, R1_H, sanitizePdfText(wo.workOrderCode ?? ""), { bold: true, fontSize: 9, color: "#1d4ed8" });
    canvas.y += R1_H;

    // ── DEPARTAMENTO + FECHA ────────────────────────────────────────────────
    const R2_H = 18;
    ensureSpace(R2_H * 2);
    const FECHA_W = 80;
    cell(ML, canvas.y, W - FECHA_W, R2_H, "DEPARTAMENTO", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + W - FECHA_W, canvas.y, FECHA_W, R2_H, "FECHA", { bold: true, fontSize: 8, bg: NAVY, color: WHITE, align: "center" });
    canvas.y += R2_H;

    const DEPT_ROW_H = 22;
    doc.rect(ML, canvas.y, W - FECHA_W, DEPT_ROW_H).fillColor(WHITE).fill();
    doc.rect(ML, canvas.y, W - FECHA_W, DEPT_ROW_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const deptW = Math.floor((W - FECHA_W) / DEPTS.length);
    DEPTS.forEach((d, i) => { checkbox(ML + i * deptW + 6, canvas.y + 7, d, department === d); });
    cell(ML + W - FECHA_W, canvas.y, FECHA_W, DEPT_ROW_H, fmt(wo.openDate), { fontSize: 9, align: "center" });
    canvas.y += DEPT_ROW_H;

    // ── EQUIPO / UBICACION ──────────────────────────────────────────────────
    const R3_H = 22;
    ensureSpace(R3_H * 2);
    cell(ML, canvas.y, Math.floor(W * 0.4), R3_H, "EQUIPO AFECTADO", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + Math.floor(W * 0.4), canvas.y, W - Math.floor(W * 0.4), R3_H, "UBICACION", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    canvas.y += R3_H;
    const EQ_W = Math.floor(W * 0.4);
    const assetCellText = assetIsSafetyCritical ? `${assetLabel}  [ISM 10.3]` : assetLabel;
    cell(ML, canvas.y, EQ_W, R3_H, assetCellText, { fontSize: 9 });
    cell(ML + EQ_W, canvas.y, W - EQ_W, R3_H, sanitizePdfText((wo as any).location ?? ""), { fontSize: 9 });
    canvas.y += R3_H;

    // ── MOTIVO ──────────────────────────────────────────────────────────────
    sectionHeader("MOTIVO DE LA ORDEN INTERNA DE TRABAJO");
    const MOTIVO_H = 22;
    ensureSpace(MOTIVO_H);
    doc.rect(ML, canvas.y, W, MOTIVO_H).fillColor(WHITE).fill();
    doc.rect(ML, canvas.y, W, MOTIVO_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const motivoW = Math.floor(W / motivos.length);
    motivos.forEach((m, i) => { checkbox(ML + i * motivoW + 6, canvas.y + 7, m, m === motivoActivo); });
    canvas.y += MOTIVO_H;

    // ── DESCRIPCION ─────────────────────────────────────────────────────────
    sectionHeader("DESCRIPCION DEL TRABAJO A REALIZARSE");
    ensureSpace(38);
    canvas.y += textArea(ML, canvas.y, W, sanitizePdfText((wo as any).description ?? ""), 38);

    // ── CRITERIOS DE ACEPTACION ─────────────────────────────────────────────
    sectionHeader("CRITERIOS DE ACEPTACION");
    ensureSpace(38);
    canvas.y += textArea(ML, canvas.y, W, sanitizePdfText((wo as any).acceptanceCriteria ?? ""), 38);

    // ── LOTO ────────────────────────────────────────────────────────────────
    sectionHeader("LOTO (LOCKOUT / TAGOUT)");
    ensureSpace(38);
    canvas.y += textArea(ML, canvas.y, W, sanitizePdfText((wo as any).loto ?? ""), 38);

    // ── NIVEL DE RIESGO ─────────────────────────────────────────────────────
    sectionHeader("NIVEL DE RIESGO");
    const RISK_H = 22;
    ensureSpace(RISK_H);
    const RISK_COLOR: Record<string, string> = {
      LOW: "#16a34a", MEDIUM: "#b45309", HIGH: "#b91c1c", CRITICAL: "#7f1d1d",
    };
    cell(ML, canvas.y, W, RISK_H, sanitizePdfText(riskLabel((wo as any).riskLevel)), {
      fontSize: 11, bold: true, align: "center",
      color: RISK_COLOR[(wo as any).riskLevel ?? ""] ?? BLACK,
    });
    canvas.y += RISK_H;

    // ── RESULTADO ANALISIS DE RIESGO ────────────────────────────────────────
    sectionHeader("RESULTADO DEL ANALISIS DE RIESGO");
    ensureSpace(38);
    canvas.y += textArea(ML, canvas.y, W, sanitizePdfText((wo as any).riskAnalysisResult ?? ""), 38);

    // CMS3.0 extras: plan inline (Responsable / Horas / Prioridad)
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
      planCols.forEach((col, i) => { cell(ML + i * colW, canvas.y, colW, PLAN_ROW_H, col.label, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY }); });
      canvas.y += PLAN_ROW_H;
      planCols.forEach((col, i) => { cell(ML + i * colW, canvas.y, colW, PLAN_ROW_H, col.value, { fontSize: 9, color: col.color }); });
      canvas.y += PLAN_ROW_H;
    }

    // ── REPUESTOS ───────────────────────────────────────────────────────────
    sectionHeader("REPUESTOS UTILIZADOS");
    ensureSpace(28);
    if (spareUsages.length > 0) {
      const ROW_H_S = 16;
      const COL_W = [Math.floor(W * 0.7), Math.floor(W * 0.15), W - Math.floor(W * 0.7) - Math.floor(W * 0.15)];
      const headers = ["Descripcion / N° Parte", "Cantidad", "Unidad"];
      headers.forEach((h, i) => {
        const cx = ML + COL_W.slice(0, i).reduce((a, b) => a + b, 0);
        cell(cx, canvas.y, COL_W[i], ROW_H_S, h, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY });
      });
      canvas.y += ROW_H_S;
      spareUsages.forEach(s => {
        ensureSpace(ROW_H_S);
        const row = [s.spareName, String(s.quantity), s.unit];
        row.forEach((v, i) => {
          const cx = ML + COL_W.slice(0, i).reduce((a, b) => a + b, 0);
          cell(cx, canvas.y, COL_W[i], ROW_H_S, sanitizePdfText(v), { fontSize: 8 });
        });
        canvas.y += ROW_H_S;
      });
    } else {
      canvas.y += textArea(ML, canvas.y, W, "", 28);
    }

    // ── FALLAS / NOVEDADES ──────────────────────────────────────────────────
    sectionHeader("FALLAS, DAÑOS, AVERÍAS O NOVEDADES CONSTATADAS");
    ensureSpace(38);
    canvas.y += textArea(ML, canvas.y, W, val((wo as any).observations), 38);

    // CMS3.0 extras: resultado
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
      resCols.forEach((col, i) => { cell(ML + i * rColW, canvas.y, rColW, RES_ROW, col.label, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY }); });
      canvas.y += RES_ROW;
      resCols.forEach((col, i) => { cell(ML + i * rColW, canvas.y, rColW, RES_ROW, col.value, { fontSize: 9, bold: true, color: col.color }); });
      canvas.y += RES_ROW;
    }

    // ── COMENTARIOS ─────────────────────────────────────────────────────────
    sectionHeader("COMENTARIOS ADICIONALES");
    ensureSpace(38);
    const closeNotes = val((wo as any).closeNotes) || val((wo as any).acceptanceCriteria) || val((wo as any).loto) || "";
    canvas.y += textArea(ML, canvas.y, W, closeNotes, 38);

    // ── GENERADO POR ────────────────────────────────────────────────────────
    sectionHeader("ESTE DOCUMENTO FUE GENERADO POR");
    ensureSpace(34);
    doc.rect(ML, canvas.y, W, 12).fillColor(LIGHT).fill();
    doc.rect(ML, canvas.y, W, 12).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(7).font("Helvetica").fillColor(GRAY)
      .text("(Indicar nombre, posicion y si es impreso sello)", ML + 6, canvas.y + 2, { width: W - 12, align: "center" });
    canvas.y += 12;
    canvas.y += textArea(ML, canvas.y, W, createdByName ? sanitizePdfText(createdByName) : "", 22);

    // ── COMUNICACION ────────────────────────────────────────────────────────
    sectionHeader("MEDIO DE COMUNICACIÓN UTILIZADO");
    ensureSpace(24);
    const COMM_H = 24;
    doc.rect(ML, canvas.y, W, COMM_H).fillColor(WHITE).fill();
    doc.rect(ML, canvas.y, W, COMM_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const commW = Math.floor(W / COMM_OPTS.length);
    COMM_OPTS.forEach((opt, i) => {
      const cx = ML + i * commW;
      doc.rect(cx, canvas.y, commW, COMM_H).strokeColor(BORDER).lineWidth(0.3).stroke();
      doc.fontSize(8).font("Helvetica-Bold").fillColor(GRAY)
        .text(opt, cx + 4, canvas.y + 3, { width: commW - 8, align: "center", lineBreak: false });
      checkbox(cx + commW / 2 - 4, canvas.y + 13, "", commMethods.includes(opt));
    });
    canvas.y += COMM_H;

    // ── DISTRIBUCION ────────────────────────────────────────────────────────
    sectionHeader("DISTRIBUCION");
    ensureSpace(60);
    DIST_ROWS.forEach(row => {
      const DIST_H = 18;
      doc.rect(ML, canvas.y, W, DIST_H).fillColor(WHITE).fill();
      doc.rect(ML, canvas.y, W, DIST_H).strokeColor(BORDER).lineWidth(0.4).stroke();
      const dw = Math.floor(W / row.length);
      (row as readonly string[]).forEach((code, i) => {
        const cx = ML + i * dw;
        doc.rect(cx, canvas.y, dw, DIST_H).strokeColor(BORDER).lineWidth(0.3).stroke();
        checkbox(cx + 4, canvas.y + 5, code, distList.includes(code));
      });
      canvas.y += DIST_H;
    });

    const OTROS_H = 20;
    doc.rect(ML, canvas.y, W, OTROS_H).fillColor(WHITE).fill();
    doc.rect(ML, canvas.y, W, OTROS_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(8).font("Helvetica-Bold").fillColor(GRAY)
      .text("OTROS (Indicar):", ML + 4, canvas.y + 6, { width: 80, lineBreak: false });
    canvas.y += OTROS_H;

    // ── TRAMITACIÓN (cadena de aprobación: Solicita / Aprueba / Autoriza) ─────
    sectionHeader("TRAMITACION DE LA ORDEN");
    const TR_RH = 20;
    const trPasoW = Math.floor(W * 0.22);
    const trFechaW = Math.floor(W * 0.22);
    const trNombreW = W - trPasoW - trFechaW;
    ensureSpace(TR_RH);
    cell(ML, canvas.y, trPasoW, TR_RH, "PASO", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY });
    cell(ML + trPasoW, canvas.y, trNombreW, TR_RH, "NOMBRE", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY });
    cell(ML + trPasoW + trNombreW, canvas.y, trFechaW, TR_RH, "FECHA", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
    canvas.y += TR_RH;
    const trRows: Array<[string, string, string]> = [
      ["Solicita", createdByName ?? "—", fmt((wo as any).createdAt)],
      ["Aprueba",  (wo as any).aprobadoByName ?? "—", (wo as any).aprobadoAt ? fmt((wo as any).aprobadoAt) : "—"],
      ["Autoriza", (wo as any).autorizadoByName ?? "—", (wo as any).autorizadoAt ? fmt((wo as any).autorizadoAt) : "—"],
    ];
    for (const [paso, nombre, fecha] of trRows) {
      ensureSpace(TR_RH);
      cell(ML, canvas.y, trPasoW, TR_RH, paso, { bold: true, fontSize: 8 });
      cell(ML + trPasoW, canvas.y, trNombreW, TR_RH, sanitizePdfText(nombre), { fontSize: 9 });
      cell(ML + trPasoW + trNombreW, canvas.y, trFechaW, TR_RH, fecha, { fontSize: 8, align: "center" });
      canvas.y += TR_RH;
    }
    // Rechazo: si la OT fue rechazada en tramitación, fila destacada + motivo.
    if ((wo as any).rechazadoAt) {
      ensureSpace(TR_RH);
      cell(ML, canvas.y, trPasoW, TR_RH, "Rechaza", { bold: true, fontSize: 8, color: "#b91c1c" });
      cell(ML + trPasoW, canvas.y, trNombreW, TR_RH, sanitizePdfText((wo as any).rechazadoByName ?? "—"), { fontSize: 9, color: "#b91c1c" });
      cell(ML + trPasoW + trNombreW, canvas.y, trFechaW, TR_RH, fmt((wo as any).rechazadoAt), { fontSize: 8, align: "center", color: "#b91c1c" });
      canvas.y += TR_RH;
      if ((wo as any).rechazoReason) {
        sectionHeader("MOTIVO DEL RECHAZO");
        ensureSpace(30);
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText((wo as any).rechazoReason), 30);
      }
    }

    // ── FIRMAS ──────────────────────────────────────────────────────────────
    ensureSpace(68);
    canvas.y += 8;
    const sigLabels = ["Responsable de ejecucion", "Supervisor / Jefe de Maquinas", "Verificado por"];
    const sigW2 = Math.floor(W / 3);
    const SIG_H = 56;
    sigLabels.forEach((label, i) => {
      const bx = ML + i * sigW2;
      doc.rect(bx, canvas.y, sigW2, SIG_H).fillColor(LIGHT).fill();
      doc.rect(bx, canvas.y, sigW2, SIG_H).strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
        .text(label.toUpperCase(), bx + 6, canvas.y + 6, { width: sigW2 - 12, align: "center", lineBreak: false, characterSpacing: 0.3 });
      doc.moveTo(bx + 10, canvas.y + 44).lineTo(bx + sigW2 - 10, canvas.y + 44).strokeColor("#aaaaaa").lineWidth(0.8).stroke();
      if (i === 0 && assignedName) {
        doc.fontSize(7).font("Helvetica").fillColor(GRAY)
          .text(sanitizePdfText(assignedName), bx + 6, canvas.y + 46, { width: sigW2 - 12, align: "center", lineBreak: false });
      }
    });
    canvas.y += SIG_H;

    // ── ANEXO FOTOGRÁFICO ───────────────────────────────────────────────────
    if (ctx.progressPhotos && ctx.progressPhotos.length > 0) {
      const fotosConBuffer = ctx.progressPhotos.filter(p => p.buffer && p.buffer.length > 0);
      if (fotosConBuffer.length > 0) {
        canvas.pageBreak();
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
            canvas.y += cellH + GAP_Y;
          }
          if (canvas.y + cellH > CONTENT_BOTTOM) {
            canvas.pageBreak();
            sectionHeader("ANEXO FOTOGRÁFICO (CONT.)");
          }
          const x = ML + col * (cellW + GAP_X);
          try {
            doc.image(foto.buffer!, x, canvas.y, { fit: [cellW, imgH], align: "center", valign: "center" });
            doc.rect(x, canvas.y, cellW, imgH).strokeColor(BORDER).lineWidth(0.5).stroke();
          } catch {
            doc.rect(x, canvas.y, cellW, imgH).strokeColor(BORDER).lineWidth(0.5).stroke();
            doc.fontSize(8).font("Helvetica").fillColor(GRAY)
              .text("[Imagen no disponible]", x + 8, canvas.y + imgH / 2 - 4, { width: cellW - 16, align: "center" });
          }
          const captionY = canvas.y + imgH + 4;
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
        canvas.y += cellH;
      }
    }

    drawControlledDocFooter(doc, { meta: formMeta, rightInfo: rightInfo(canvas.page), x: ML, w: W });
    doc.end();
  });
}
