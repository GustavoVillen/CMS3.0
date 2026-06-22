// Mercurio Group template (estilo de documento controlado).
// Renderer puro: recibe un WorkOrderPdfContext ya cargado y devuelve un Buffer.
//
// El "chrome" (header/footer del documento controlado) y las primitivas de
// dibujo viven en ../pdf-form-chrome.ts. Los metadatos del formulario (numero,
// revision, vigencia, footer) salen de ctx.formMeta — fuente de verdad: TenantForm.

import PDFDocument from "pdfkit";
import {
  fmt, val, statusLabel, priorityLabel, riskLabel, woResultLabel,
  STATUS_COLOR, PRIORITY_COLOR, sanitizePdfText, PAGE_H,
  type WorkOrderPdfContext,
} from "./shared";
import {
  FORM_COLORS, FOOTER_H, drawControlledDocHeader, drawControlledDocFooter, createFormCanvas, renderRiskMatrix,
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
  const { wo, assetLabel, vesselName, assetIsSafetyCritical, assignedName, createdByName, tenant, formLogoBuffer, formMeta, spareUsages, tenantSlug } = ctx;

  // Checkboxes ahora interactivos (AcroForm): se tildan desde el visor PDF, sin
  // pre-marcado del sistema. Solo se usan las etiquetas de cada grupo.
  const motivos = ["FALLA", "AVERIA", "INSPECCION", "PLANIFICADO", "CAMBIO", "OTRO"] as const;
  const DEPTS = ["CUBIERTA", "MAQUINAS", "BARCAZA", "SERVICIOS"] as const;
  const COMM_OPTS = ["IMPRESO", "EMAIL", "WHAPP", "OTRO"] as const;
  // La OT nace de un plan / mantenimiento programado → motivo "PLANIFICADO" tildado.
  const isPlanned = !!(wo as any).maintenancePlanId || (wo as any).type === "PREVENTIVE";

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
    const { sectionHeader, cell, textArea, ensureSpace } = canvas;

    // ── Campos de formulario interactivos (AcroForm) ──
    // Permiten tildar checkboxes y completar nombre/firma desde el visor PDF.
    (doc as any).initForm();
    let _fid = 0;
    const fcheck = (cx: number, cy: number, label: string, box = 9) => {
      (doc as any).formCheckbox(`chk_${_fid++}`, cx, cy, box, box, { borderColor: BORDER, borderWidth: 0.8 });
      if (label) {
        doc.fontSize(8).font("Helvetica").fillColor(BLACK)
          .text(label, cx + box + 4, cy + 0.5, { lineBreak: false });
      }
    };
    const ftext = (cx: number, cy: number, cw: number, ch: number, value: string,
      o: { fontSize?: number; align?: "left" | "center" | "right" } = {}) => {
      (doc as any).formText(`txt_${_fid++}`, cx, cy, cw, ch, {
        value: value || "", fontSize: o.fontSize ?? 9, align: o.align ?? "left",
      });
    };
    // Separación de ~1cm antes de cada título de sección + el título.
    const SEC_GAP = 28;
    const GAP_5MM = 14; // ~5mm de separación entre recuadros
    // Casilla tildada estática (dato del sistema, no editable): borde + check dibujado.
    const drawCheckedBox = (cx: number, cy: number, label: string, box = 9) => {
      doc.rect(cx, cy, box, box).fillColor(WHITE).fill();
      doc.rect(cx, cy, box, box).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.moveTo(cx + 1.8, cy + box * 0.55)
        .lineTo(cx + box * 0.42, cy + box - 1.8)
        .lineTo(cx + box - 1.3, cy + 1.6)
        .strokeColor(BLACK).lineWidth(1.1).stroke();
      if (label) {
        doc.fontSize(8).font("Helvetica").fillColor(BLACK)
          .text(label, cx + box + 4, cy + 0.5, { lineBreak: false });
      }
    };
    const section = (title: string) => { canvas.y += SEC_GAP; sectionHeader(title); };

    // ── HEADER (documento controlado) ───────────────────────────────────────
    const hdrH = drawControlledDocHeader(doc, {
      meta: formMeta,
      logoBuffer: formLogoBuffer,
      tenantName: tenant?.name ?? tenantSlug.toUpperCase(),
      x: ML, y: MARGIN_T, w: W, page: canvas.page,
    });
    canvas.y = MARGIN_T + hdrH + SEC_GAP; // ~1cm de separación entre el header y el recuadro

    // ── REMOLCADOR / SOLICITUD NUMERO ───────────────────────────────────────
    const R1_H = 22;
    ensureSpace(R1_H);
    const HALF = Math.floor(W / 2);
    cell(ML, canvas.y, 80, R1_H, "EMBARCACION", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + 80, canvas.y, HALF - 80, R1_H, sanitizePdfText(vesselName ?? wo.vesselCode ?? ""), { fontSize: 9 });
    cell(ML + HALF, canvas.y, 100, R1_H, "Solicitud Numero:", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + HALF + 100, canvas.y, W - HALF - 100, R1_H, sanitizePdfText(wo.workOrderCode ?? ""), { bold: true, fontSize: 9, color: "#1d4ed8" });
    canvas.y += R1_H;
    canvas.y += GAP_5MM; // 5mm entre Remolcador/Solicitud y Departamento

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
    DEPTS.forEach((d, i) => { fcheck(ML + i * deptW + 6, canvas.y + 6, d); });
    cell(ML + W - FECHA_W, canvas.y, FECHA_W, DEPT_ROW_H, fmt(wo.openDate), { fontSize: 9, align: "center" });
    canvas.y += DEPT_ROW_H;
    canvas.y += GAP_5MM; // 5mm entre Departamento y Equipo Afectado

    // ── EQUIPO AFECTADO (ancho completo) ────────────────────────────────────
    const R3_H = 22;
    ensureSpace(R3_H * 2);
    cell(ML, canvas.y, W, R3_H, "EQUIPO AFECTADO", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    canvas.y += R3_H;
    cell(ML, canvas.y, W, R3_H, assetLabel, { fontSize: 9 });
    canvas.y += R3_H;

    // ── Datos de planificación (Responsable / Horas / Prioridad) ─────────────
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
      // La última columna toma el resto para que el borde derecho alinee con W.
      const cwOf = (i: number) => (i === planCols.length - 1 ? W - colW * (planCols.length - 1) : colW);
      planCols.forEach((col, i) => { cell(ML + i * colW, canvas.y, cwOf(i), PLAN_ROW_H, col.label, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY }); });
      canvas.y += PLAN_ROW_H;
      planCols.forEach((col, i) => { cell(ML + i * colW, canvas.y, cwOf(i), PLAN_ROW_H, col.value, { fontSize: 9, color: col.color }); });
      canvas.y += PLAN_ROW_H;
    }

    // ── MOTIVO DE LA SOLICITUD DE SERVICIO ───────────────────────────────────
    section("MOTIVO DE LA SOLICITUD DE SERVICIO");
    const MOTIVO_H = 22;
    ensureSpace(MOTIVO_H);
    doc.rect(ML, canvas.y, W, MOTIVO_H).fillColor(WHITE).fill();
    doc.rect(ML, canvas.y, W, MOTIVO_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const motivoW = Math.floor(W / motivos.length);
    motivos.forEach((m, i) => {
      const cx = ML + i * motivoW + 6;
      const cy = canvas.y + 6;
      // "PLANIFICADO" queda tildado por el sistema cuando la OT es programada.
      if (m === "PLANIFICADO" && isPlanned) drawCheckedBox(cx, cy, m);
      else fcheck(cx, cy, m);
    });
    canvas.y += MOTIVO_H;

    // ── TITULO DE LA OT (en el estilo del formulario) ────────────────────────
    const TIT_H = 22;
    ensureSpace(TIT_H);
    cell(ML, canvas.y, 70, TIT_H, "TITULO", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
    cell(ML + 70, canvas.y, W - 70, TIT_H, sanitizePdfText((wo as any).title ?? ""), { fontSize: 9 });
    canvas.y += TIT_H;

    // ── DESCRIPCION DEL TRABAJO A REALIZARSE ─────────────────────────────────
    section("DESCRIPCION DEL TRABAJO A REALIZARSE");
    ensureSpace(38);
    canvas.y += textArea(ML, canvas.y, W, sanitizePdfText((wo as any).description ?? ""), 38);

    // ── CRITERIOS DE ACEPTACION ──────────────────────────────────────────────
    section("CRITERIOS DE ACEPTACION");
    ensureSpace(38);
    canvas.y += textArea(ML, canvas.y, W, sanitizePdfText((wo as any).acceptanceCriteria ?? ""), 38);

    // ── TRAMITACION DE LA ORDEN ──────────────────────────────────────────────
    section("TRAMITACION DE LA ORDEN");
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
    if ((wo as any).rechazadoAt) {
      ensureSpace(TR_RH);
      cell(ML, canvas.y, trPasoW, TR_RH, "Rechaza", { bold: true, fontSize: 8, color: "#b91c1c" });
      cell(ML + trPasoW, canvas.y, trNombreW, TR_RH, sanitizePdfText((wo as any).rechazadoByName ?? "—"), { fontSize: 9, color: "#b91c1c" });
      cell(ML + trPasoW + trNombreW, canvas.y, trFechaW, TR_RH, fmt((wo as any).rechazadoAt), { fontSize: 8, align: "center", color: "#b91c1c" });
      canvas.y += TR_RH;
      if ((wo as any).rechazoReason) {
        section("MOTIVO DEL RECHAZO");
        ensureSpace(30);
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText((wo as any).rechazoReason), 30);
      }
    }

    // ── REGISTRO DE AVANCES ──────────────────────────────────────────────────
    if (ctx.progressNotes && ctx.progressNotes.length > 0) {
      section("REGISTRO DE AVANCES");
      const KIND_LBL: Record<string, string> = { TEXT: "Nota", PHOTO: "Foto", VIDEO: "Video", AUDIO: "Audio" };
      for (const n of ctx.progressNotes) {
        const ts = new Date(n.createdAt).toLocaleString("es-AR", {
          day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
        });
        const head = `${ts}  ·  ${KIND_LBL[n.kind] ?? n.kind}`;
        const body = n.text && n.text.trim()
          ? n.text.trim()
          : (n.kind === "PHOTO" ? "[Foto adjunta — ver anexo fotográfico]"
            : n.kind === "VIDEO" ? "[Video adjunto]"
            : n.kind === "AUDIO" ? "[Audio adjunto]" : "—");
        ensureSpace(12 + 20);
        doc.rect(ML, canvas.y, W, 12).fillColor(LIGHT).fill();
        doc.rect(ML, canvas.y, W, 12).strokeColor(BORDER).lineWidth(0.4).stroke();
        doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
          .text(head, ML + 4, canvas.y + 3, { width: W - 8, lineBreak: false });
        canvas.y += 12;
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(body), 18);
      }
    }

    // ── REPUESTOS UTILIZADOS ─────────────────────────────────────────────────
    section("REPUESTOS UTILIZADOS");
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

    // ── COMENTARIOS ──────────────────────────────────────────────────────────
    section("COMENTARIOS");
    ensureSpace(38);
    canvas.y += textArea(ML, canvas.y, W, val((wo as any).observations), 38);

    // CMS3.0 extras: resultado de ejecución
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

    // ── MEDIO DE COMUNICACIÓN UTILIZADO ──────────────────────────────────────
    section("MEDIO DE COMUNICACIÓN UTILIZADO");
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
      fcheck(cx + commW / 2 - 4.5, canvas.y + 12, "");
    });
    canvas.y += COMM_H;

    // ── DISTRIBUCION ─────────────────────────────────────────────────────────
    section("DISTRIBUCION");
    const DIST_H = 22;
    ensureSpace(DIST_H);
    doc.rect(ML, canvas.y, W, DIST_H).fillColor(WHITE).fill();
    doc.rect(ML, canvas.y, W, DIST_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const distHalf = Math.floor(W / 2);
    doc.rect(ML, canvas.y, distHalf, DIST_H).strokeColor(BORDER).lineWidth(0.3).stroke();
    doc.rect(ML + distHalf, canvas.y, W - distHalf, DIST_H).strokeColor(BORDER).lineWidth(0.3).stroke();
    fcheck(ML + 8, canvas.y + 6, "Original: Recursos Humanos");
    fcheck(ML + distHalf + 8, canvas.y + 6, "Copia: Destinatarios");
    canvas.y += DIST_H;

    // ── FIRMAS ───────────────────────────────────────────────────────────────
    canvas.y += SEC_GAP;
    ensureSpace(68);
    const sigLabels = ["Responsable de ejecucion", "Supervisor / Jefe de Maquinas", "Verificado por"];
    const sigW2 = Math.floor(W / 3);
    const SIG_H = 56;
    sigLabels.forEach((label, i) => {
      const bx = ML + i * sigW2;
      doc.rect(bx, canvas.y, sigW2, SIG_H).fillColor(LIGHT).fill();
      doc.rect(bx, canvas.y, sigW2, SIG_H).strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
        .text(label.toUpperCase(), bx + 6, canvas.y + 6, { width: sigW2 - 12, align: "center", lineBreak: false, characterSpacing: 0.3 });
      // Caja del responsable (i===0): incrusta la firma configurada del asignado.
      if (i === 0 && ctx.assignedSignatureBuffer) {
        try { doc.image(ctx.assignedSignatureBuffer, bx + sigW2 / 2 - 28, canvas.y + 12, { fit: [56, 20], align: "center", valign: "center" }); } catch { /* skip */ }
      }
      // Zona para firmar (a mano / Adobe Fill&Sign) y campo de texto para el nombre.
      doc.moveTo(bx + 10, canvas.y + 34).lineTo(bx + sigW2 - 10, canvas.y + 34).strokeColor("#aaaaaa").lineWidth(0.8).stroke();
      doc.fontSize(6).font("Helvetica").fillColor(GRAY)
        .text("Firma", bx + 6, canvas.y + 36, { width: sigW2 - 12, align: "center", lineBreak: false });
      ftext(bx + 8, canvas.y + 44, sigW2 - 16, 12, i === 0 ? (ctx.assignedFormName ?? assignedName ?? "") : "", { fontSize: 8, align: "center" });
    });
    canvas.y += SIG_H;

    // ── (OTRA HOJA) NIVEL DE RIESGO / RESULTADO ANÁLISIS / LOTO ──────────────
    canvas.pageBreak();
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
    canvas.y += 2;
    renderRiskMatrix(doc, canvas, ML, W, ctx.riskProbability, ctx.riskConsequence);

    // ── RESULTADO DEL ANALISIS DE RIESGO ─────────────────────────────────────
    section("RESULTADO DEL ANALISIS DE RIESGO");
    ensureSpace(38);
    canvas.y += textArea(ML, canvas.y, W, sanitizePdfText((wo as any).riskAnalysisResult ?? ""), 38);

    // ── LOTO ─────────────────────────────────────────────────────────────────
    section("LOTO (LOCKOUT / TAGOUT)");
    ensureSpace(38);
    canvas.y += textArea(ML, canvas.y, W, sanitizePdfText((wo as any).loto ?? ""), 38);

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
