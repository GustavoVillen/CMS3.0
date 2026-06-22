// Solicitud de servicios (estilo documento controlado, ej. REGI-LOG-01.3).
// Renderer puro: recibe un WorkOrderPdfContext (cargado con formType
// SERVICE_REQUEST) + docCode emitido, y devuelve un Buffer.
//
// El body recorre `ctx.formConfig.sections` (orden e inclusion = data del
// tenant) invocando el catalogo de secciones definido abajo. Las opciones de
// listas y etiquetas salen de ctx.formConfig.

import PDFDocument from "pdfkit";
import { fmt, val, sanitizePdfText, PAGE_H, type WorkOrderPdfContext } from "./shared";
import {
  FORM_COLORS, FOOTER_H, drawControlledDocHeader, drawControlledDocFooter, createFormCanvas,
} from "../pdf-form-chrome";

const PW       = 595.28;
const ML       = 36;
const MR       = 36;
const W        = PW - ML - MR;
const MARGIN_T = 36;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const { NAVY, WHITE, BLACK, GRAY, BORDER, LIGHT } = FORM_COLORS;

export async function renderServiceRequestPdf(ctx: WorkOrderPdfContext): Promise<Buffer> {
  const { wo, assetLabel, assetIsSafetyCritical, assignedName, createdByName, tenant, formLogoBuffer, formMeta, formConfig, tenantSlug } = ctx;
  const docCode = ctx.docCode ?? (wo.workOrderCode ?? "");

  const department: string | null = (wo as any).department ?? null;
  const commMethods: string[] = (wo as any).communicationMethod ?? [];
  const distList: string[] = (wo as any).distribution ?? [];

  const label = (id: string, fallback: string) => formConfig.labels[id] ?? fallback;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Solicitud ${docCode}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const rightInfo = (page: number) =>
      `${formMeta.formCode} — Pagina ${page} — ${docCode} — ${wo.vesselCode} — ${fmt(new Date())}`;

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

    // ── Helpers locales de tabla ────────────────────────────────────────────
    function optionRow(opts: string[], h = 22) {
      ensureSpace(h);
      doc.rect(ML, canvas.y, W, h).fillColor(WHITE).fill();
      doc.rect(ML, canvas.y, W, h).strokeColor(BORDER).lineWidth(0.4).stroke();
      const cw = Math.floor(W / Math.max(opts.length, 1));
      opts.forEach((o, i) => {
        doc.fontSize(8).font("Helvetica-Bold").fillColor(GRAY)
          .text(o, ML + i * cw + 4, canvas.y + (h - 8) / 2, { width: cw - 8, align: "center", lineBreak: false });
      });
      canvas.y += h;
    }

    function checkboxRow(opts: string[], selected: string[], h = 24) {
      ensureSpace(h);
      doc.rect(ML, canvas.y, W, h).fillColor(WHITE).fill();
      doc.rect(ML, canvas.y, W, h).strokeColor(BORDER).lineWidth(0.4).stroke();
      const cw = Math.floor(W / Math.max(opts.length, 1));
      opts.forEach((o, i) => {
        const cx = ML + i * cw;
        doc.rect(cx, canvas.y, cw, h).strokeColor(BORDER).lineWidth(0.3).stroke();
        doc.fontSize(8).font("Helvetica-Bold").fillColor(GRAY)
          .text(o, cx + 4, canvas.y + 3, { width: cw - 8, align: "center", lineBreak: false });
        checkbox(cx + cw / 2 - 4, canvas.y + 13, "", selected.includes(o));
      });
      canvas.y += h;
    }

    function tableHeader(cols: Array<{ label: string; w: number }>, h = 16) {
      ensureSpace(h);
      let cx = ML;
      cols.forEach(c => { cell(cx, canvas.y, c.w, h, c.label, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" }); cx += c.w; });
      canvas.y += h;
    }

    function emptyRows(colWidths: number[], n: number, h = 18) {
      for (let r = 0; r < n; r++) {
        ensureSpace(h);
        let cx = ML;
        colWidths.forEach(cwid => { cell(cx, canvas.y, cwid, h, "", {}); cx += cwid; });
        canvas.y += h;
      }
    }

    // ── Catalogo de secciones ───────────────────────────────────────────────
    const sections: Record<string, () => void> = {
      header: () => {
        const H = 22;
        ensureSpace(H);
        const HALF = Math.floor(W / 2);
        cell(ML, canvas.y, 90, H, label("remolcador", "REMOLCADOR"), { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
        cell(ML + 90, canvas.y, HALF - 90, H, sanitizePdfText(wo.vesselCode ?? ""), { fontSize: 9 });
        cell(ML + HALF, canvas.y, 95, H, label("solicitudN", "SOLICITUD N°"), { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
        cell(ML + HALF + 95, canvas.y, W - HALF - 95, H, sanitizePdfText(docCode), { bold: true, fontSize: 9, color: "#1d4ed8" });
        canvas.y += H;
      },
      deptDate: () => {
        const H = 22;
        ensureSpace(H);
        const FECHA_W = 90;
        const DEP_LBL = 95;
        cell(ML, canvas.y, DEP_LBL, H, label("departamento", "DEPARTAMENTO"), { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
        cell(ML + DEP_LBL, canvas.y, W - DEP_LBL - FECHA_W * 2, H, sanitizePdfText((wo as any).departmentText ?? ""), { fontSize: 9 });
        cell(ML + W - FECHA_W * 2, canvas.y, FECHA_W, H, label("fecha", "FECHA"), { bold: true, fontSize: 8, bg: NAVY, color: WHITE, align: "center" });
        cell(ML + W - FECHA_W, canvas.y, FECHA_W, H, fmt(wo.openDate), { fontSize: 9, align: "center" });
        canvas.y += H;
      },
      equipment: () => {
        sectionHeader(label("equipment", "EQUIPO O SISTEMA AFECTADO"));
        checkboxRow(formConfig.departments, department ? [department] : []);
      },
      equipAssigned: () => {
        const H = 22;
        ensureSpace(H);
        const EQ_LBL = 70, ASG_LBL = 80;
        const eqW = Math.floor((W - EQ_LBL - ASG_LBL) * 0.55);
        const assetText = assetIsSafetyCritical ? `${assetLabel}  [ISM 10.3]` : assetLabel;
        cell(ML, canvas.y, EQ_LBL, H, label("equipo", "EQUIPO"), { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
        cell(ML + EQ_LBL, canvas.y, eqW, H, assetText, { fontSize: 9 });
        cell(ML + EQ_LBL + eqW, canvas.y, ASG_LBL, H, label("asignadoA", "ASIGNADO A"), { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
        cell(ML + EQ_LBL + eqW + ASG_LBL, canvas.y, W - EQ_LBL - eqW - ASG_LBL, H, sanitizePdfText(assignedName ?? ""), { fontSize: 9 });
        canvas.y += H;
      },
      description: () => {
        sectionHeader(label("description", "DESCRIPCION DEL SERVICIO"));
        ensureSpace(44);
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText((wo as any).description ?? ""), 44);
      },
      causes: () => {
        sectionHeader(label("causes", "DETALLE DE LAS CAUSAS"));
        ensureSpace(38);
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText((wo as any).riskAnalysisResult ?? ""), 38);
      },
      purchaseRequest: () => {
        sectionHeader(label("purchaseRequest", "SOLICITUD DE COMPRAS"));
        optionRow(formConfig.purchaseRequest);
      },
      tramitacion: () => {
        sectionHeader(label("tramitacion", "TRAMITACION DE LA SOLICITUD"));
        const nameW = Math.floor(W * 0.4);
        const rest = W - nameW;
        const c = Math.floor(rest / 5);
        const cols = [
          { label: "NOMBRE", w: nameW }, { label: "SOLICITA", w: c }, { label: "APRUEBA", w: c },
          { label: "AUTORIZA", w: c }, { label: "APROB. SÍ", w: c }, { label: "APROB. NO", w: rest - c * 4 },
        ];
        tableHeader(cols);
        emptyRows(cols.map(x => x.w), 3);
      },
      taller: () => {
        sectionHeader(label("taller", "TALLER QUE CONCURRE A REALIZAR EL SERVICIO"));
        ensureSpace(32);
        canvas.y += textArea(ML, canvas.y, W, "", 32);
      },
      hojaRuta: () => {
        sectionHeader(label("hojaRuta", "HOJA DE RUTA DEL PEDIDO"));
        const fechaW = Math.floor(W * 0.2);
        const asientaW = Math.floor(W * 0.25);
        const cols = [
          { label: "FECHA", w: fechaW }, { label: "NOVEDAD", w: W - fechaW - asientaW }, { label: "ASIENTA", w: asientaW },
        ];
        tableHeader(cols);
        emptyRows(cols.map(x => x.w), 3);
      },
      entregaRecepcion: () => {
        sectionHeader(label("entregaRecepcion", "ENTREGA / RECEPCION"));
        const siW = Math.floor(W * 0.15);
        const itemW = Math.floor(W * 0.45);
        const cols = [
          { label: "ITEM", w: itemW }, { label: "RECIBE", w: W - itemW - siW * 2 },
          { label: "CONFORM. SÍ", w: siW }, { label: "CONFORM. NO", w: siW },
        ];
        tableHeader(cols);
        emptyRows(cols.map(x => x.w), 3);
      },
      comments: () => {
        sectionHeader(label("comments", "COMENTARIOS ADICIONALES"));
        ensureSpace(38);
        const txt = val((wo as any).observations) !== "—" ? val((wo as any).observations) : val((wo as any).closeNotes);
        canvas.y += textArea(ML, canvas.y, W, txt === "—" ? "" : txt, 38);
      },
      generatedBy: () => {
        sectionHeader(label("generatedBy", "ESTE DOCUMENTO FUE GENERADO POR"));
        ensureSpace(34);
        doc.rect(ML, canvas.y, W, 12).fillColor(LIGHT).fill();
        doc.rect(ML, canvas.y, W, 12).strokeColor(BORDER).lineWidth(0.4).stroke();
        doc.fontSize(7).font("Helvetica").fillColor(GRAY)
          .text("(Indicar nombre, posicion y si es impreso sello)", ML + 6, canvas.y + 2, { width: W - 12, align: "center" });
        canvas.y += 12;
        canvas.y += textArea(ML, canvas.y, W, createdByName ? sanitizePdfText(createdByName) : "", 22);
      },
      signatures: () => {
        ensureSpace(70);
        const H = 60;
        const half = Math.floor(W / 2);
        const nombrePos = ctx.assignedFormName ?? assignedName ?? createdByName ?? "";
        [["NOMBRE Y POSICION", nombrePos], ["FIRMA", ""]].forEach(([lab, value], i) => {
          const bx = ML + i * half;
          const bw = i === 0 ? half : W - half;
          doc.rect(bx, canvas.y, bw, H).fillColor(WHITE).fill();
          doc.rect(bx, canvas.y, bw, H).strokeColor(BORDER).lineWidth(0.5).stroke();
          // Caja FIRMA (i===1): incrusta la firma configurada del asignado.
          if (i === 1 && ctx.assignedSignatureBuffer) {
            try { doc.image(ctx.assignedSignatureBuffer, bx + bw / 2 - 35, canvas.y + 8, { fit: [70, 26], align: "center", valign: "center" }); } catch { /* skip */ }
          }
          if (value) {
            doc.fontSize(9).font("Helvetica").fillColor(BLACK)
              .text(sanitizePdfText(value), bx + 8, canvas.y + 10, { width: bw - 16, lineBreak: false });
          }
          doc.moveTo(bx + 10, canvas.y + H - 16).lineTo(bx + bw - 10, canvas.y + H - 16).strokeColor("#aaaaaa").lineWidth(0.8).stroke();
          doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
            .text(lab, bx + 6, canvas.y + H - 12, { width: bw - 12, align: "center", lineBreak: false, characterSpacing: 0.3 });
        });
        canvas.y += H;
      },
      communication: () => {
        sectionHeader(label("communication", "MEDIO DE COMUNICACION UTILIZADO"));
        checkboxRow(formConfig.communicationMethods, commMethods);
      },
      distribution: () => {
        sectionHeader(label("distribution", "DISTRIBUCION"));
        const H = 18;
        const lblW = 90, midW = 150;
        ensureSpace(H * 2);
        cell(ML, canvas.y, lblW, H, "Original", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
        cell(ML + lblW, canvas.y, midW, H, "Recursos Humanos", { bold: true, fontSize: 8, color: GRAY });
        cell(ML + lblW + midW, canvas.y, W - lblW - midW, H, "", {});
        canvas.y += H;
        cell(ML, canvas.y, lblW, H, "Copia", { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
        cell(ML + lblW, canvas.y, midW, H, "Destinatarios", { bold: true, fontSize: 8, color: GRAY });
        cell(ML + lblW + midW, canvas.y, W - lblW - midW, H, sanitizePdfText(distList.join(", ")), { bold: true, fontSize: 9, color: BLACK });
        canvas.y += H;
      },
    };

    const order = formConfig.sections.length ? formConfig.sections : Object.keys(sections);
    for (const id of order) {
      const fn = sections[id];
      if (fn) fn();
    }

    drawControlledDocFooter(doc, { meta: formMeta, rightInfo: rightInfo(canvas.page), x: ML, w: W });
    doc.end();
  });
}
