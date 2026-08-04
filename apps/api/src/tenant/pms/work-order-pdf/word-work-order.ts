// Work Order → Word (.doc). Espejo HTML de template-mercurio.ts.
// Recibe el mismo WorkOrderPdfContext que el PDF y devuelve un Buffer .doc.

import { fmt, val, statusLabel, priorityLabel, riskLabel, woResultLabel, type WorkOrderPdfContext } from "./shared";
import {
  wrapAsWordDoc, bufferToDataUri, esc, docControlledHeader, docControlledFooter,
  docSection, docKvRow, docTable, docCheckboxRow, docTextBox, docSpacer,
} from "../doc-export";

const DEPTS = ["CUBIERTA", "MAQUINAS", "BARCAZA", "PROVEEDOR", "OTROS"];
const MOTIVOS = ["FALLA", "AVERIA", "INSPECCION", "PLANIFICADO", "CAMBIO", "OTRO"];
const COMM_OPTS = ["IMPRESO", "EMAIL", "WHAPP", "OTRO"];
const RISK_COLOR: Record<string, string> = { LOW: "#16a34a", MEDIUM: "#b45309", HIGH: "#b91c1c", CRITICAL: "#7f1d1d" };
const STATUS_COLOR: Record<string, string> = {
  PLANNED: "#0369a1", IN_PROGRESS: "#b45309", ON_HOLD: "#7c3aed", CLOSED: "#166534", CANCELLED: "#991b1b", DEFERRED: "#374151",
};

export function renderWorkOrderDoc(ctx: WorkOrderPdfContext): Buffer {
  const { wo, assetLabel, assignedName, createdByName, formMeta, spareUsages, tenant, tenantSlug, vesselName, providerNames } = ctx;
  const w = wo as any;
  const isPlanned = !!w.maintenancePlanId || w.type === "PREVENTIVE";
  const logo = bufferToDataUri(ctx.formLogoBuffer);

  const parts: string[] = [];

  // Cabecera
  parts.push(docControlledHeader(formMeta, logo, tenant?.name ?? tenantSlug.toUpperCase()));
  parts.push(docSpacer());

  // Embarcación / Solicitud Número
  parts.push(docKvRow([
    { label: "EMBARCACION", value: vesselName ?? wo.vesselCode ?? "", labelWidth: "16%", valueWidth: "34%" },
    { label: "Orden Numero:", value: wo.workOrderCode ?? "", labelWidth: "20%", valueWidth: "30%", color: "#1d4ed8" },
  ]));

  // Departamento + Fecha
  parts.push(docKvRow([
    { label: "DEPARTAMENTO", value: "", labelWidth: "20%" },
    { label: "FECHA", value: fmt(wo.openDate), labelWidth: "12%", valueWidth: "18%" },
  ]));
  parts.push(docCheckboxRow(DEPTS, w.department ? [w.department] : []));
  // Los talleres a los que se les pidió el trabajo: el de la OT y los de sus SS.
  // Antes salía sólo el de la OT, y cuando había varios quedaba en blanco.
  if (providerNames.length > 0) {
    parts.push(docKvRow([{ label: "PROVEEDOR", value: providerNames.join(", "), labelWidth: "20%", valueWidth: "80%" }]));
  }

  // Equipo afectado (solo el nombre)
  parts.push(docSection("EQUIPO AFECTADO"));
  parts.push(`<table><tr><td>${esc(assetLabel)}</td></tr></table>`);

  // Datos de planificación
  if (w.estimatedHours || assignedName || w.priority) {
    parts.push(docTable(
      ["Responsable", "Horas estimadas", "Horas trabajadas", "Prioridad"],
      [[
        assignedName ?? w.assignedToUserId ?? "—",
        w.estimatedHours != null ? `${w.estimatedHours} h` : "—",
        w.actualHours != null ? `${w.actualHours} h` : "—",
        priorityLabel(w.priority ?? ""),
      ]],
    ));
  }

  // Motivo
  parts.push(docSpacer());
  parts.push(docSection("MOTIVO DE LA ORDEN DE TRABAJO"));
  parts.push(docCheckboxRow(MOTIVOS, isPlanned ? ["PLANIFICADO"] : []));

  // Título
  parts.push(docKvRow([{ label: "TITULO", value: w.title ?? "", labelWidth: "14%", valueWidth: "86%" }]));

  // Descripción
  parts.push(docSpacer());
  parts.push(docSection("DESCRIPCION DEL TRABAJO A REALIZARSE"));
  parts.push(docTextBox(w.description ?? "", "40pt"));

  // Criterios de aceptación
  parts.push(docSection("CRITERIOS DE ACEPTACION"));
  parts.push(docTextBox(w.acceptanceCriteria ?? "", "36pt"));

  // Motivo del rechazo (si aplica). La tramitación con firma va al pie.
  if (w.rechazadoAt && w.rechazoReason) {
    parts.push(docSpacer());
    parts.push(docSection("MOTIVO DEL RECHAZO"));
    parts.push(docTextBox(`Rechazada por ${w.rechazadoByName ?? "—"} (${fmt(w.rechazadoAt)}): ${w.rechazoReason}`, "30pt"));
  }

  // Registro de avances
  if (ctx.progressNotes && ctx.progressNotes.length > 0) {
    parts.push(docSpacer());
    parts.push(docSection("REGISTRO DE AVANCES"));
    const KIND_LBL: Record<string, string> = { TEXT: "Nota", PHOTO: "Foto", VIDEO: "Video", AUDIO: "Audio" };
    const rows = ctx.progressNotes.map(n => {
      const ts = new Date(n.createdAt).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
      const body = n.text && n.text.trim() ? n.text.trim()
        : (n.kind === "PHOTO" ? "[Foto adjunta]" : n.kind === "VIDEO" ? "[Video adjunto]" : n.kind === "AUDIO" ? "[Audio adjunto]" : "—");
      return [`${ts} · ${KIND_LBL[n.kind] ?? n.kind}`, body];
    });
    parts.push(docTable(["Fecha · Tipo", "Detalle"], rows));
  }

  // Repuestos
  parts.push(docSpacer());
  parts.push(docSection("REPUESTOS UTILIZADOS"));
  if (spareUsages.length > 0) {
    parts.push(docTable(
      ["Descripcion / N° Parte", "Cantidad", "Unidad"],
      spareUsages.map(s => [s.spareName, String(s.quantity), s.unit]),
    ));
  } else {
    parts.push(docTextBox("", "28pt"));
  }

  // Comentarios
  parts.push(docSection("COMENTARIOS"));
  parts.push(docTextBox(val(w.observations) === "—" ? "" : val(w.observations), "36pt"));

  // Resultado de ejecución
  if (w.woResult) {
    parts.push(docKvRow([
      { label: "Resultado OT", value: woResultLabel(w.woResult), color: w.woResult === "SATISFACTORY" ? "#166534" : "#991b1b" },
      { label: "Estado", value: statusLabel(w.status ?? ""), color: STATUS_COLOR[w.status ?? ""] },
    ]));
    parts.push(docKvRow([
      { label: "Ejecutado por", value: w.executedByName ?? "—" },
      { label: "Horas motor", value: w.runningHoursAtExecution != null ? `${w.runningHoursAtExecution} h` : "—" },
    ]));
  }

  // Medio de comunicación
  parts.push(docSpacer());
  parts.push(docSection("MEDIO DE COMUNICACION UTILIZADO"));
  parts.push(docCheckboxRow(COMM_OPTS, []));

  // Distribución
  parts.push(docSection("DISTRIBUCION"));
  parts.push(docCheckboxRow(["Original: Recursos Humanos", "Copia: Destinatarios"], []));

  // Tramitación de la orden (firma digital + nombre + fecha)
  parts.push(docSpacer());
  parts.push(docSection("TRAMITACION DE LA ORDEN"));
  const trCols = [
    { label: "SOLICITA",     name: ctx.createdByFormName ?? createdByName, date: w.createdAt, sig: bufferToDataUri(ctx.solicitaSignatureBuffer) },
    { label: "APRUEBA",      name: w.aprobadoByName, date: w.aprobadoAt, sig: bufferToDataUri(ctx.apruebaSignatureBuffer) },
    { label: "AUTORIZA",     name: w.autorizadoByName, date: w.autorizadoAt, sig: bufferToDataUri(ctx.autorizaSignatureBuffer) },
    { label: "CIERRA LA OT", name: w.executedByName, date: w.completedDate, sig: bufferToDataUri(ctx.cierraSignatureBuffer) },
  ];
  parts.push(`<table><tr>${trCols.map(c => {
    const img = c.sig ? `<img src="${c.sig}" style="height:72pt;max-width:95%;">` : "";
    return `<td style="width:25%;height:110pt;background:#F3F4F6;text-align:center;vertical-align:top;font-size:7pt;color:#6B7280;">` +
      `<b>${esc(c.label)}</b><br>${img}<br>_______________<br>` +
      `<span style="font-size:8pt;color:#111827;">${esc(c.name ?? "—")}</span>` +
      `${c.date ? `<br><span style="font-size:6pt;">${esc(fmt(c.date))}</span>` : ""}</td>`;
  }).join("")}</tr></table>`);

  // Nivel de riesgo + análisis + LOTO
  parts.push(docSpacer());
  parts.push(docSection("NIVEL DE RIESGO"));
  parts.push(`<table><tr><td class="center" style="font-size:11pt;font-weight:bold;color:${RISK_COLOR[w.riskLevel ?? ""] ?? "#111827"};">${esc(riskLabel(w.riskLevel))}</td></tr></table>`);
  if (ctx.riskProbability || ctx.riskConsequence) {
    parts.push(docKvRow([
      { label: "Probabilidad", value: ctx.riskProbability ?? "—" },
      { label: "Consecuencia", value: ctx.riskConsequence ?? "—" },
    ]));
  }
  parts.push(docSection("RESULTADO DEL ANALISIS DE RIESGO"));
  parts.push(docTextBox(w.riskAnalysisResult ?? "", "36pt"));
  parts.push(docSection("LOTO (LOCKOUT / TAGOUT)"));
  parts.push(docTextBox(w.loto ?? "", "36pt"));

  // Anexo fotográfico
  const fotos = (ctx.progressPhotos ?? []).filter(p => p.buffer && p.buffer.length > 0);
  if (fotos.length > 0) {
    parts.push(docSpacer());
    parts.push(docSection("ANEXO FOTOGRAFICO"));
    const cells = fotos.map(f => {
      const uri = bufferToDataUri(f.buffer);
      const ts = new Date(f.createdAt).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
      const cap = `${ts}${f.text ? " · " + esc(f.text) : ""}`;
      return `<td style="width:50%;text-align:center;vertical-align:top;">${uri ? `<img src="${uri}" style="max-width:100%;max-height:220pt;">` : "[Imagen no disponible]"}<br><span style="font-size:7pt;color:#6B7280;">${cap}</span></td>`;
    });
    // 2 columnas
    const rows: string[] = [];
    for (let i = 0; i < cells.length; i += 2) {
      rows.push(`<tr>${cells[i]}${cells[i + 1] ?? "<td style='width:50%;'>&nbsp;</td>"}</tr>`);
    }
    parts.push(`<table>${rows.join("")}</table>`);
  }

  return wrapAsWordDoc({
    title: `OT ${wo.workOrderCode}`,
    bodyHtml: parts.join("\n"),
    footerHtml: docControlledFooter(formMeta),
  });
}
