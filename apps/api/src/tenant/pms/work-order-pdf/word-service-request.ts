// Solicitud de servicios → Word (.doc). Espejo HTML de template-service-request.ts.
// Recorre ctx.formConfig.sections (orden e inclusión = data del tenant).

import { fmt, val, type WorkOrderPdfContext } from "./shared";
import {
  wrapAsWordDoc, bufferToDataUri, esc, docControlledHeader, docControlledFooter,
  docSection, docKvRow, docTable, docCheckboxRow, docTextBox, docSpacer,
} from "../doc-export";

export function renderServiceRequestDoc(ctx: WorkOrderPdfContext): Buffer {
  const { wo, assetLabel, assignedName, createdByName, tenant, formLogoBuffer, formMeta, formConfig, tenantSlug } = ctx;
  const w = wo as any;
  const docCode = ctx.docCode ?? (wo.workOrderCode ?? "");
  const department: string | null = w.department ?? null;
  const commMethods: string[] = w.communicationMethod ?? [];
  const distList: string[] = w.distribution ?? [];
  const logo = bufferToDataUri(formLogoBuffer);
  const label = (id: string, fallback: string) => formConfig.labels[id] ?? fallback;

  // Fila de opciones centradas (sin checkbox), ej. SOLICITUD DE COMPRAS.
  const optionRow = (opts: string[]) =>
    `<table><tr>${opts.map(o => `<td class="center"><b class="muted">${esc(o)}</b></td>`).join("")}</tr></table>`;

  const sections: Record<string, () => string> = {
    header: () => docKvRow([
      { label: label("remolcador", "REMOLCADOR"), value: wo.vesselCode ?? "", labelWidth: "16%", valueWidth: "34%" },
      { label: label("solicitudN", "SOLICITUD N°"), value: docCode, labelWidth: "18%", valueWidth: "32%", color: "#1d4ed8" },
    ]),
    deptDate: () => docKvRow([
      { label: label("departamento", "DEPARTAMENTO"), value: w.departmentText ?? "", labelWidth: "18%", valueWidth: "52%" },
      { label: label("fecha", "FECHA"), value: fmt(wo.openDate), labelWidth: "12%", valueWidth: "18%" },
    ]),
    equipment: () => docSection(label("equipment", "EQUIPO O SISTEMA AFECTADO")) +
      docCheckboxRow(formConfig.departments, department ? [department] : []),
    equipAssigned: () => docKvRow([
      { label: label("equipo", "EQUIPO"), value: assetLabel, labelWidth: "12%", valueWidth: "53%" },
      { label: label("asignadoA", "ASIGNADO A"), value: assignedName ?? "", labelWidth: "15%", valueWidth: "20%" },
    ]),
    description: () => docSection(label("description", "DESCRIPCION DEL SERVICIO")) + docTextBox(w.description ?? "", "44pt"),
    causes: () => docSection(label("causes", "DETALLE DE LAS CAUSAS")) + docTextBox(w.riskAnalysisResult ?? "", "36pt"),
    purchaseRequest: () => docSection(label("purchaseRequest", "SOLICITUD DE COMPRAS")) + optionRow(formConfig.purchaseRequest),
    tramitacion: () => docSection(label("tramitacion", "TRAMITACION DE LA SOLICITUD")) +
      docTable(["NOMBRE", "SOLICITA", "APRUEBA", "AUTORIZA", "APROB. SI", "APROB. NO"], [], 3),
    taller: () => docSection(label("taller", "TALLER QUE CONCURRE A REALIZAR EL SERVICIO")) + docTextBox("", "32pt"),
    hojaRuta: () => docSection(label("hojaRuta", "HOJA DE RUTA DEL PEDIDO")) +
      docTable(["FECHA", "NOVEDAD", "ASIENTA"], [], 3),
    entregaRecepcion: () => docSection(label("entregaRecepcion", "ENTREGA / RECEPCION")) +
      docTable(["ITEM", "RECIBE", "CONFORM. SI", "CONFORM. NO"], [], 3),
    comments: () => {
      const txt = val(w.observations) !== "—" ? val(w.observations) : val(w.closeNotes);
      return docSection(label("comments", "COMENTARIOS ADICIONALES")) + docTextBox(txt === "—" ? "" : txt, "36pt");
    },
    generatedBy: () => docSection(label("generatedBy", "ESTE DOCUMENTO FUE GENERADO POR")) +
      `<table><tr><td class="center muted" style="font-size:7pt;">(Indicar nombre, posicion y si es impreso sello)</td></tr></table>` +
      docTextBox(createdByName ?? "", "24pt"),
    signatures: () => `<table><tr>` +
      `<td style="width:50%;height:48pt;vertical-align:top;">${esc(ctx.assignedFormName ?? assignedName ?? createdByName ?? "")}<br><br>_______________<br><span style="font-size:7pt;" class="muted">NOMBRE Y POSICION</span></td>` +
      `<td style="width:50%;height:48pt;vertical-align:top;text-align:center;">${bufferToDataUri(ctx.assignedSignatureBuffer) ? `<img src="${bufferToDataUri(ctx.assignedSignatureBuffer)}" style="height:30pt;max-width:80%;"><br>` : "<br><br>"}_______________<br><span style="font-size:7pt;" class="muted">FIRMA</span></td>` +
      `</tr></table>`,
    communication: () => docSection(label("communication", "MEDIO DE COMUNICACION UTILIZADO")) +
      docCheckboxRow(formConfig.communicationMethods, commMethods),
    distribution: () => docSection(label("distribution", "DISTRIBUCION")) +
      docKvRow([{ label: "Original", value: "Recursos Humanos", labelWidth: "16%", valueWidth: "84%" }]) +
      docKvRow([{ label: "Copia", value: `Destinatarios   ${distList.join(", ")}`, labelWidth: "16%", valueWidth: "84%" }]),
  };

  const order = formConfig.sections.length ? formConfig.sections : Object.keys(sections);
  const parts: string[] = [];
  parts.push(docControlledHeader(formMeta, logo, tenant?.name ?? tenantSlug.toUpperCase()));
  parts.push(docSpacer());
  for (const id of order) {
    const fn = sections[id];
    if (fn) parts.push(fn());
  }

  return wrapAsWordDoc({
    title: `Solicitud ${docCode}`,
    bodyHtml: parts.join("\n"),
    footerHtml: docControlledFooter(formMeta),
  });
}
