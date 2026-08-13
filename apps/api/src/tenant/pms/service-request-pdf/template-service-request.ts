// Solicitud de servicios (estilo documento controlado, ej. REGI-LOG-01.3).
// Renderer puro: recibe un ServiceRequestPdfContext y devuelve un Buffer.
//
// La SS es una entidad propia (prisma ServiceRequest) que cuelga de una OT
// abierta — no es una vista de la OT. Los campos que el formulario pide sobre el
// trabajo (equipo afectado, nro de OT) salen de `ctx.wo`; el resto, de `ctx.sr`.
//
// El body recorre `ctx.formConfig.sections` (orden e inclusion = data del
// tenant) invocando el catalogo de secciones definido abajo. Las opciones de
// listas y etiquetas salen de ctx.formConfig. Los section ids son los mismos que
// ya tienen sembrados los tenants — no renombrarlos sin migrar TenantForm.config.

import PDFDocument from "pdfkit";
import { makeFormatters, val, sanitizePdfText, departmentLabel, PAGE_H } from "../work-order-pdf/shared";
import { buildHojaRuta } from "../../service-requests/hoja-ruta";
import type { ServiceRequestPdfContext } from "./shared";
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

export async function renderServiceRequestPdf(ctx: ServiceRequestPdfContext): Promise<Buffer> {
  const { sr, wo, assetLabel, assetIsSafetyCritical, assignedName, createdByName, providerName, tenant, formLogoBuffer, formMeta, formConfig, tenantSlug } = ctx;
  // Todas las fechas del papel, en la hora de la empresa (ver common/tenant-time).
  const { fmt } = makeFormatters(ctx.tz, ctx.locale);
  const docCode = ctx.docCode || "";

  const department: string | null = sr.department ?? null;
  const commMethods: string[] = sr.communicationMethod ?? [];
  const distList: string[] = sr.distribution ?? [];

  const label = (id: string, fallback: string) => formConfig.labels[id] ?? fallback;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Solicitud ${docCode}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const rightInfo = (page: number) =>
      `${formMeta.formCode} — Pagina ${page} — ${docCode} — ${sr.vesselCode} — ${fmt(new Date())}`;

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
        cell(ML + 90, canvas.y, HALF - 90, H, sanitizePdfText(ctx.vesselName ?? sr.vesselCode ?? ""), { fontSize: 9 });
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
        cell(ML + DEP_LBL, canvas.y, W - DEP_LBL - FECHA_W * 2, H, sanitizePdfText(department ? departmentLabel(department) : ""), { fontSize: 9 });
        cell(ML + W - FECHA_W * 2, canvas.y, FECHA_W, H, label("fecha", "FECHA"), { bold: true, fontSize: 8, bg: NAVY, color: WHITE, align: "center" });
        cell(ML + W - FECHA_W, canvas.y, FECHA_W, H, fmt(sr.openDate), { fontSize: 9, align: "center" });
        canvas.y += H;
      },
      // ASIGNADO A: el área que se hace cargo (Cubierta/Máquinas/Barcaza/Otros).
      // Hereda el departamento de la OT.
      assignedTo: () => {
        sectionHeader(label("assignedTo", "ASIGNADO A"));
        checkboxRow(formConfig.departments, department ? [department] : []);
      },
      // EQUIPO O SISTEMA AFECTADO: texto — sale del activo de la OT
      // (ej. "SISTEMA DE GOBIERNO").
      equipment: () => {
        const H = 22;
        ensureSpace(H);
        const LBL = 150;
        const assetText = assetIsSafetyCritical ? `${assetLabel}  [ISM 10.3]` : assetLabel;
        cell(ML, canvas.y, LBL, H, label("equipment", "EQUIPO O SISTEMA AFECTADO"), { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
        cell(ML + LBL, canvas.y, W - LBL, H, assetText, { fontSize: 9 });
        canvas.y += H;
      },
      // Toda SS nace de una OT: dejar el número visible en el papel es lo que
      // permite rastrear el servicio hasta el trabajo que lo originó.
      workOrderRef: () => {
        const H = 22;
        ensureSpace(H);
        const LBL = 110;
        cell(ML, canvas.y, LBL, H, label("workOrderRef", "ORDEN DE TRABAJO"), { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
        cell(ML + LBL, canvas.y, W - LBL, H,
          sanitizePdfText(wo ? `${wo.workOrderCode}${wo.title ? ` — ${wo.title}` : ""}` : ""),
          { fontSize: 9 });
        canvas.y += H;
      },
      description: () => {
        sectionHeader(label("description", "DESCRIPCION DEL SERVICIO"));
        ensureSpace(44);
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(sr.description ?? sr.title ?? ""), 44);
      },
      // El papel (rev. 2) lo titula "DETALLE DE LAS CAUSAS"; el cliente lo pasó
      // a "DETALLE DEL SERVICIO" — es lo que se detalla ahí en la práctica.
      causes: () => {
        sectionHeader(label("causes", "DETALLE DEL SERVICIO"));
        ensureSpace(38);
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(sr.causes ?? ""), 38);
      },
      // SOLICITUD DE COMPRAS — admite varias marcadas a la vez (en el formulario
      // real conviven "AFECTA SEGURIDAD" y "AFECTA SERVICIO").
      purchaseRequest: () => {
        sectionHeader(label("purchaseRequest", "SOLICITUD DE COMPRAS"));
        checkboxRow(formConfig.purchaseRequest, (sr.purchaseRequestKinds ?? []) as string[]);
      },
      /**
       * TRAMITACION DE LA SOLICITUD — estructura del papel:
       *   NOMBRE | TRAMITE (SOLICITA/APRUEBA/AUTORIZA) | APROBACION (SI/NO)
       * El sistema estampa nombre, firma y tilda SI cuando el paso ocurre en la
       * app. Los pasos que todavía no pasaron salen en blanco para firmar a mano.
       */
      // Encolumnado (mismo bloque de firmas que la OT): una columna por paso, con
      // firma + nombre + fecha. Un paso firmado y fechado ES la aprobación; el
      // rechazo se marca en rojo sobre la columna que lo frenó, con el motivo debajo.
      tramitacion: () => {
        sectionHeader(label("tramitacion", "TRAMITACION DE LA SOLICITUD"));
        const rechazadaEn = sr.status === "REJECTED" ? (sr.aprobadoAt ? "AUTORIZA" : "APRUEBA") : null;
        const trCols: Array<{ rol: string; nombre: string | null; fecha: unknown; sig?: Buffer | null }> = [
          // El nombre editado por el admin gana sobre el del usuario que la creó.
          { rol: "SOLICITA", nombre: sr.solicitaByName ?? ctx.createdByFormName ?? createdByName,
            fecha: sr.openDate, sig: ctx.solicitaSignatureBuffer },
          // APRUEBA y AUTORIZA salen SIEMPRE en blanco (decision del cliente,
          // ago 2026): se firman a mano sobre el papel. El sistema sigue
          // registrando quien aprobo/autorizo y cuando — esa trazabilidad vive
          // en la app y en la HOJA DE RUTA, no en este bloque de firmas.
          { rol: "APRUEBA",  nombre: null, fecha: null, sig: null },
          { rol: "AUTORIZA", nombre: null, fecha: null, sig: null },
        ];

        const SIG_H = 110;
        ensureSpace(SIG_H);
        const trCW = Math.floor(W / trCols.length);
        trCols.forEach((c, i) => {
          const bx = ML + i * trCW;
          const bw = i === trCols.length - 1 ? W - trCW * (trCols.length - 1) : trCW; // la última toma el resto (alineación)
          const noAqui = rechazadaEn === c.rol;
          doc.rect(bx, canvas.y, bw, SIG_H).fillColor(LIGHT).fill();
          doc.rect(bx, canvas.y, bw, SIG_H).strokeColor(BORDER).lineWidth(0.5).stroke();
          doc.fontSize(7).font("Helvetica-Bold").fillColor(noAqui ? "#b91c1c" : GRAY)
            .text(noAqui ? `${c.rol} — NO APROBADA` : c.rol, bx + 6, canvas.y + 5,
              { width: bw - 12, align: "center", lineBreak: false, characterSpacing: 0.5 });
          // Firma digital (si el paso lo hizo un usuario con firma cargada).
          if (c.sig) {
            try { doc.image(c.sig, bx + bw / 2 - 78, canvas.y + 16, { fit: [156, 66], align: "center", valign: "center" }); } catch { /* skip */ }
          }
          // Línea de firma + nombre + fecha.
          doc.moveTo(bx + 8, canvas.y + 88).lineTo(bx + bw - 8, canvas.y + 88).strokeColor("#aaaaaa").lineWidth(0.8).stroke();
          if (c.nombre) {
            doc.fontSize(8).font("Helvetica").fillColor(BLACK)
              .text(sanitizePdfText(c.nombre), bx + 5, canvas.y + 90, { width: bw - 10, align: "center", lineBreak: false, ellipsis: true });
          }
          if (c.fecha) {
            doc.fontSize(6).font("Helvetica").fillColor(GRAY)
              .text(fmt(c.fecha as Date), bx + 5, canvas.y + 100, { width: bw - 10, align: "center", lineBreak: false });
          }
        });
        canvas.y += SIG_H;

        if (sr.status === "REJECTED" && sr.rechazoReason) {
          ensureSpace(26);
          canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(`NO APROBADA — ${sr.rechazoReason}`), 26);
        }
      },
      taller: () => {
        sectionHeader(label("taller", "TALLER QUE CONCURRE A REALIZAR EL SERVICIO"));
        ensureSpace(32);
        const taller = [providerName, sr.tallerNotes].filter(Boolean).join(" — ");
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(taller), 32);
      },
      // Hitos derivados + novedades a mano (ver buildHojaRuta: único lugar donde
      // se arma). Si no hay nada, quedan los renglones en blanco del papel.
      hojaRuta: () => {
        sectionHeader(label("hojaRuta", "HOJA DE RUTA DEL PEDIDO"));
        const fechaW = Math.floor(W * 0.2);
        const asientaW = Math.floor(W * 0.25);
        const novedadW = W - fechaW - asientaW;
        const cols = [
          { label: "FECHA", w: fechaW }, { label: "NOVEDAD", w: novedadW }, { label: "ASIENTA", w: asientaW },
        ];
        tableHeader(cols);

        const filas = buildHojaRuta(sr, providerName, ctx.createdByFormName ?? createdByName);

        const H = 16;
        for (const f of filas) {
          ensureSpace(H);
          cell(ML, canvas.y, fechaW, H, fmt(f.fecha), { fontSize: 8, align: "center" });
          cell(ML + fechaW, canvas.y, novedadW, H, sanitizePdfText(f.novedad), { fontSize: 8 });
          cell(ML + fechaW + novedadW, canvas.y, asientaW, H, sanitizePdfText(f.asienta), { fontSize: 8, align: "center" });
          canvas.y += H;
        }
        // El papel nunca sale sin renglones: se completan hasta 3 para anotar a mano.
        if (filas.length < 3) emptyRows(cols.map(x => x.w), 3 - filas.length);
      },
      /**
       * ENTREGA / RECEPCION — se completa al recibir el servicio del taller:
       * quién lo recibió y si hubo conformidad. Es la evidencia de que el
       * trabajo del tercero se aceptó.
       */
      entregaRecepcion: () => {
        sectionHeader(label("entregaRecepcion", "ENTREGA / RECEPCION"));
        ensureSpace(12);
        doc.fontSize(6.5).font("Helvetica-Oblique").fillColor(GRAY)
          .text("Se debe indicar si por parte de quien solicito el servicio, hay conformidad con el trabajo realizado",
            ML + 4, canvas.y + 2, { width: W - 8, align: "center", lineBreak: false });
        canvas.y += 12;

        const siW = Math.floor(W * 0.15);
        const itemW = Math.floor(W * 0.45);
        const recibeW = W - itemW - siW * 2;
        tableHeader([
          { label: "ITEM", w: itemW }, { label: "RECIBE", w: recibeW },
          { label: "CONFORM. SÍ", w: siW }, { label: "CONFORM. NO", w: siW },
        ]);

        const H = 18;
        const recibio = !!sr.receivedByName;
        // 1ª fila: el dato cargado al recibir. Las siguientes quedan libres.
        for (let i = 0; i < 3; i++) {
          ensureSpace(H);
          const primera = i === 0 && recibio;
          cell(ML, canvas.y, itemW, H, primera ? sanitizePdfText(sr.receptionItem ?? "") : "", { fontSize: 8 });
          cell(ML + itemW, canvas.y, recibeW, H, primera ? sanitizePdfText(sr.receivedByName) : "", { fontSize: 8, align: "center" });
          cell(ML + itemW + recibeW, canvas.y, siW, H, "", {});
          checkbox(ML + itemW + recibeW + siW / 2 - 4, canvas.y + 5, "", primera && sr.receptionConform === true);
          cell(ML + itemW + recibeW + siW, canvas.y, siW, H, "", {});
          checkbox(ML + itemW + recibeW + siW + siW / 2 - 4, canvas.y + 5, "", primera && sr.receptionConform === false);
          canvas.y += H;
        }
      },
      comments: () => {
        sectionHeader(label("comments", "COMENTARIOS ADICIONALES"));
        ensureSpace(38);
        const txt = val(sr.observations) !== "—" ? val(sr.observations) : val(sr.closeNotes);
        canvas.y += textArea(ML, canvas.y, W, txt === "—" ? "" : txt, 38);
      },
      /**
       * Pie del formulario: "Deben firmar y registrarse el Jefe de Máquinas y
       * Capitán". Dos cajas con nombre + cargo (ej. "CAP. WILLIAM RIQUELME" /
       * "J.M. CRISTHIAN VERON") y espacio de firma.
       */
      signatures: () => {
        ensureSpace(14);
        doc.fontSize(6.5).font("Helvetica-Oblique").fillColor(GRAY)
          .text("(Indicar nombre, posicion y si es impreso sello) — Deben firmar y registrarse el Jefe de Maquinas y Capitan",
            ML + 4, canvas.y + 2, { width: W - 8, align: "center", lineBreak: false });
        canvas.y += 12;

        ensureSpace(62);
        const H = 56;
        const half = Math.floor(W / 2);
        const cajas: Array<[string, string | null]> = [
          ["CAPITAN", sr.capitanName ?? null],
          ["JEFE DE MAQUINAS", sr.jefeMaquinasName ?? null],
        ];
        cajas.forEach(([lab, nombre], i) => {
          const bx = ML + i * half;
          const bw = i === 0 ? half : W - half;
          doc.rect(bx, canvas.y, bw, H).fillColor(WHITE).fill();
          doc.rect(bx, canvas.y, bw, H).strokeColor(BORDER).lineWidth(0.5).stroke();
          if (nombre) {
            doc.fontSize(9).font("Helvetica-Bold").fillColor(BLACK)
              .text(sanitizePdfText(nombre), bx + 8, canvas.y + 8, { width: bw - 16, lineBreak: false });
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
