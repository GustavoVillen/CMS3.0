// Solicitud de servicios → Word (.doc). Espejo HTML de template-service-request.ts.
// Recorre ctx.formConfig.sections (orden e inclusión = data del tenant).

import { makeFormatters, val, departmentLabel } from "../work-order-pdf/shared";
import { buildHojaRuta } from "../../service-requests/hoja-ruta";
import type { ServiceRequestPdfContext } from "./shared";
import {
  buildWordHtml, bufferToDataUri, esc, docControlledHeader, docControlledFooter,
  docSection, docKvRow, docTable, docCheckboxRow, docTextBox, docSpacer, imagePixelSize, fitLogoBox,
} from "../doc-export";

// Caja de la firma en la TRAMITACION: mismo tamaño que el PDF (fit:[156,66]pt),
// para que Word y PDF salgan iguales. Sin ancho explícito, Word ignora la altura
// CSS y estampa el PNG a su tamaño de píxeles nativo (firma gigante a página completa).
const SIG_BOX = { wcm: 156 / 28.35, hcm: 66 / 28.35 };

export function renderServiceRequestDoc(ctx: ServiceRequestPdfContext): Buffer {
  return Buffer.from(renderServiceRequestHtml(ctx), "utf-8");
}

/** El mismo documento como HTML: lo usa el .doc y también el contenedor .docx. */
export function renderServiceRequestHtml(ctx: ServiceRequestPdfContext): string {
  const { sr, wo, assetLabel, assignedName, createdByName, providerName, tenant, formLogoBuffer, formMeta, formConfig, tenantSlug } = ctx;
  // Todas las fechas del documento, en la hora de la empresa (ver common/tenant-time).
  const { fmt } = makeFormatters(ctx.tz, ctx.locale);
  const docCode = ctx.docCode || "";
  const department: string | null = sr.department ?? null;
  const commMethods: string[] = sr.communicationMethod ?? [];
  const distList: string[] = sr.distribution ?? [];
  const logo = bufferToDataUri(formLogoBuffer);
  const label = (id: string, fallback: string) => formConfig.labels[id] ?? fallback;

  const sections: Record<string, () => string> = {
    header: () => docKvRow([
      { label: label("remolcador", "REMOLCADOR"), value: ctx.vesselName ?? sr.vesselCode ?? "", labelWidth: "16%", valueWidth: "34%" },
      { label: label("solicitudN", "SOLICITUD N°"), value: docCode, labelWidth: "18%", valueWidth: "32%", color: "#1d4ed8" },
    ]),
    deptDate: () => docKvRow([
      { label: label("departamento", "DEPARTAMENTO"), value: department ? departmentLabel(department) : "", labelWidth: "18%", valueWidth: "52%" },
      { label: label("fecha", "FECHA"), value: fmt(sr.openDate), labelWidth: "12%", valueWidth: "18%" },
    ]),
    // ASIGNADO A = el área (hereda el departamento de la OT).
    assignedTo: () => docSection(label("assignedTo", "ASIGNADO A")) +
      docCheckboxRow(formConfig.departments, department ? [department] : []),
    // EQUIPO O SISTEMA AFECTADO = texto, del activo de la OT.
    equipment: () => docKvRow([
      { label: label("equipment", "EQUIPO O SISTEMA AFECTADO"), value: assetLabel, labelWidth: "28%", valueWidth: "72%" },
    ]),
    // Toda SS nace de una OT: el número queda visible para rastrear el servicio.
    workOrderRef: () => docKvRow([
      { label: label("workOrderRef", "ORDEN DE TRABAJO"),
        value: wo ? `${wo.workOrderCode}${wo.title ? ` — ${wo.title}` : ""}` : "",
        labelWidth: "18%", valueWidth: "82%" },
    ]),
    description: () => docSection(label("description", "DESCRIPCION DEL SERVICIO")) + docTextBox(sr.description ?? sr.title ?? "", "44pt"),
    causes: () => docSection(label("causes", "DETALLE DEL SERVICIO")) + docTextBox(sr.causes ?? "", "36pt"),
    // Admite varias marcadas (ej. AFECTA SEGURIDAD + AFECTA SERVICIO).
    purchaseRequest: () => docSection(label("purchaseRequest", "SOLICITUD DE COMPRAS")) +
      docCheckboxRow(formConfig.purchaseRequest, (sr.purchaseRequestKinds ?? []) as string[]),
    // Encolumnado: una columna por paso, con firma + nombre + fecha (espejo del PDF).
    tramitacion: () => {
      const rechazadaEn = sr.status === "REJECTED" ? (sr.aprobadoAt ? "AUTORIZA" : "APRUEBA") : null;
      const cols: Array<{ rol: string; nombre: string | null; fecha: unknown; sig?: Buffer | null }> = [
        // El nombre editado por el admin gana sobre el del usuario que la creó.
        { rol: "SOLICITA", nombre: sr.solicitaByName ?? ctx.createdByFormName ?? createdByName ?? null,
          fecha: sr.openDate, sig: ctx.solicitaSignatureBuffer },
        // Espejo del PDF: APRUEBA y AUTORIZA van SIEMPRE en blanco, se firman
        // a mano. El sistema sigue registrando quien y cuando (app + hoja de ruta).
        { rol: "APRUEBA",  nombre: null, fecha: null, sig: null },
        { rol: "AUTORIZA", nombre: null, fecha: null, sig: null },
      ];
      const celda = (c: (typeof cols)[number]) => {
        const noAqui = rechazadaEn === c.rol;
        const sigUri = c.sig ? bufferToDataUri(c.sig) : null;
        const sigBox = c.sig ? fitLogoBox(imagePixelSize(c.sig), SIG_BOX.wcm, SIG_BOX.hcm) : null;
        return `<td style="width:33.33%;height:82pt;vertical-align:top;text-align:center;background:#f5f5f5;">` +
          `<span style="font-size:7pt;${noAqui ? "color:#b91c1c;" : "color:#666666;"}"><b>${noAqui ? `${c.rol} — NO APROBADA` : c.rol}</b></span><br>` +
          (sigUri && sigBox
            ? `<img src="${sigUri}" width="${Math.round(sigBox.wcm * 37.8)}" height="${Math.round(sigBox.hcm * 37.8)}" style="width:${sigBox.wcm}cm;height:${sigBox.hcm}cm;"><br>`
            : `<br><br><br>`) +
          `_____________________<br>` +
          `<span style="font-size:8pt;">${c.nombre ? esc(c.nombre) : "&nbsp;"}</span><br>` +
          `<span style="font-size:6pt;" class="muted">${c.fecha ? fmt(c.fecha as Date) : ""}</span>` +
          `</td>`;
      };
      const motivo = sr.status === "REJECTED" && sr.rechazoReason
        ? docTextBox(`NO APROBADA — ${sr.rechazoReason}`, "26pt") : "";
      return docSection(label("tramitacion", "TRAMITACION DE LA SOLICITUD")) +
        `<table><tr>${cols.map(celda).join("")}</tr></table>` + motivo;
    },
    taller: () => docSection(label("taller", "TALLER QUE CONCURRE A REALIZAR EL SERVICIO")) +
      docTextBox([providerName, sr.tallerNotes].filter(Boolean).join(" — "), "32pt"),
    // Espejo del PDF: mismo buildHojaRuta, misma historia.
    hojaRuta: () => {
      const filas = buildHojaRuta(sr, providerName, ctx.createdByFormName ?? createdByName);
      return docSection(label("hojaRuta", "HOJA DE RUTA DEL PEDIDO")) +
        docTable(["FECHA", "NOVEDAD", "ASIENTA"],
          filas.map(f => [fmt(f.fecha), esc(f.novedad), esc(f.asienta)]),
          Math.max(0, 3 - filas.length));
    },
    // Conformidad del servicio recibido (se carga al completar la SS).
    entregaRecepcion: () => docSection(label("entregaRecepcion", "ENTREGA / RECEPCION")) +
      `<table><tr><td class="center muted" style="font-size:7pt;">Se debe indicar si por parte de quien solicito el servicio, hay conformidad con el trabajo realizado</td></tr></table>` +
      docTable(["ITEM", "RECIBE", "CONFORM. SI", "CONFORM. NO"],
        sr.receivedByName
          ? [[esc(sr.receptionItem ?? ""), esc(sr.receivedByName), sr.receptionConform === true ? "X" : "", sr.receptionConform === false ? "X" : ""]]
          : [], 3),
    comments: () => {
      const txt = val(sr.observations) !== "—" ? val(sr.observations) : val(sr.closeNotes);
      return docSection(label("comments", "COMENTARIOS ADICIONALES")) + docTextBox(txt === "—" ? "" : txt, "36pt");
    },
    // Pie: firman Jefe de Máquinas y Capitán.
    signatures: () =>
      `<table><tr><td class="center muted" style="font-size:7pt;">(Indicar nombre, posicion y si es impreso sello) — Deben firmar y registrarse el Jefe de Maquinas y Capitan</td></tr></table>` +
      `<table><tr>` +
      `<td style="width:50%;height:48pt;vertical-align:top;"><b>${esc(sr.capitanName ?? "")}</b><br><br>_______________<br><span style="font-size:7pt;" class="muted">CAPITAN</span></td>` +
      `<td style="width:50%;height:48pt;vertical-align:top;"><b>${esc(sr.jefeMaquinasName ?? "")}</b><br><br>_______________<br><span style="font-size:7pt;" class="muted">JEFE DE MAQUINAS</span></td>` +
      `</tr></table>`,
    communication: () => docSection(label("communication", "MEDIO DE COMUNICACION UTILIZADO")) +
      docCheckboxRow(formConfig.communicationMethods, commMethods),
    distribution: () => docSection(label("distribution", "DISTRIBUCION")) +
      docKvRow([{ label: "Original", value: "Recursos Humanos", labelWidth: "16%", valueWidth: "84%" }]) +
      docKvRow([{ label: "Copia", value: `Destinatarios   ${distList.join(", ")}`, labelWidth: "16%", valueWidth: "84%" }]),
  };

  const order = formConfig.sections.length ? formConfig.sections : Object.keys(sections);
  const parts: string[] = [];
  parts.push(docControlledHeader(formMeta, logo, tenant?.name ?? tenantSlug.toUpperCase(), imagePixelSize(formLogoBuffer)));
  parts.push(docSpacer());
  for (const id of order) {
    const fn = sections[id];
    if (fn) parts.push(fn());
  }

  return buildWordHtml({
    title: `Solicitud ${docCode}`,
    bodyHtml: parts.join("\n"),
    footerHtml: docControlledFooter(formMeta),
  });
}
