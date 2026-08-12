// Permiso de trabajo → Word (.doc). Espejo HTML de template-mercurio.ts.
//
// Mismo formulario controlado (REGI-SYE-01.4 .. 01.9) y mismas secciones, pero
// abierto y editable en Word: a bordo se completan a mano las casillas, los
// nombres y las firmas, y se imprime.
//
// Recorre `ctx.formConfig.sections` igual que el PDF — si un tenant reordena o
// saca una sección, los dos documentos cambian juntos.

import { fmtDate, fmtDateTime, fmtTime } from "../../../common/tenant-time";
import {
  wrapAsWordDoc, bufferToDataUri, esc, escMultiline, docControlledHeader,
  docControlledFooter, docSection, docKvRow, docTable, docTextBox, docSpacer, imagePixelSize, fitLogoBox,
} from "../../pms/doc-export";
import {
  mercurioPermitForm, SPECIAL_COMMENTS, SHIP_STATUS_OPTIONS, DEPARTMENT_OPTIONS,
  HEADER_ROLES, PPE_HEADER, ES_SECTION_1, ES_SECTION_1_TITLE, ES_SECTION_2,
  ES_SECTION_2_TITLE, ES_SIGNERS, ES_SECTION_3_TITLE, ES_SECTION_3_TEXT,
  ES_SECTION_3_SIGN, ES_INVALID_WARNING, ES_NOTES, ES_GAS_BLOCK_TITLE,
  ES_GAS_BLOCK_NOTE, ES_GAS_READINGS, ES_GAS_BLOCK_FOOTNOTE,
} from "./mercurio-permit-forms";
import {
  derivePermitFields, isAuthorized, val, PERMIT_STATUS_LABEL, PERMIT_TYPE_LABEL,
  PERMIT_ROLE_LABEL, type PermitPdfContext,
} from "./shared";
import { buildPermitChecklist } from "../../../common/regulations/maritime";

/** Casilla para tildar en Word. `on` la deja marcada por el sistema. */
function cbx(on = false): string {
  return `<span class="cbx">${on ? "X" : "&nbsp;"}</span>`;
}

/** Fila de celdas con casilla centrada (una por opción). */
function checkOptions(options: string[], selected: string[] = []): string {
  if (options.length === 0) return "";
  const head = `<tr class="hdr">${options.map(o => `<td>${esc(o)}</td>`).join("")}</tr>`;
  const body = `<tr>${options.map(o => `<td class="center">${cbx(selected.includes(o))}</td>`).join("")}</tr>`;
  return `<table>${head}${body}</table>`;
}

/** Opciones con la casilla al lado del texto, en una sola fila. */
function inlineOptions(options: string[]): string {
  return `<table><tr>${options.map(o =>
    `<td class="center"><b style="font-size:7pt;">${esc(o)}</b> ${cbx()}</td>`).join("")}</tr></table>`;
}

/** Tabla PREGUNTA | SI | NO | NA | NOTA con casillas vacías. */
function checkTable(items: string[], noteCol = true): string {
  const wQ = noteCol ? "62%" : "76%";
  const head = `<tr class="hdr"><td style="width:${wQ};text-align:left;">PREGUNTA</td>`
    + `<td style="width:8%">SI</td><td style="width:8%">NO</td><td style="width:8%">NA</td>`
    + (noteCol ? `<td style="width:14%">NOTA</td>` : "")
    + `</tr>`;
  const body = items.map(it =>
    `<tr><td style="font-size:8pt;">${esc(it)}</td>`
    + `<td class="center">${cbx()}</td><td class="center">${cbx()}</td><td class="center">${cbx()}</td>`
    + (noteCol ? `<td>&nbsp;</td>` : "")
    + `</tr>`).join("");
  return `<table>${head}${body}</table>`;
}

/** Recuadro NOMBRE Y APELLIDO | DOCUMENTO | FIRMA. */
function peopleTable(names: string[], minRows: number): string {
  return docTable(["NOMBRE Y APELLIDO", "DOCUMENTO", "FIRMA"],
    names.map(n => [n, "", ""]), Math.max(0, minRows - names.length));
}

/** Renglones de firma INSPECTOR / SUPERVISOR. */
function signerRows(rows: Array<{ role: string; name: string }>): string {
  const head = `<tr class="hdr"><td style="width:20%">&nbsp;</td><td style="width:45%">NOMBRE Y APELLIDO</td><td style="width:35%">FIRMA</td></tr>`;
  const body = rows.map(r =>
    `<tr><td class="hdr" style="background:#F3F4F6;font-size:7pt;text-align:center;"><b>${esc(r.role)}</b></td>`
    + `<td class="center" style="height:26pt;">${esc(r.name)}</td><td style="height:26pt;">&nbsp;</td></tr>`).join("");
  return `<table>${head}${body}</table>`;
}

/** Caja vacía para completar a mano (croquis, áreas linderas, herramientas). */
function blankBox(height: string): string {
  return `<div class="box" style="min-height:${height}">&nbsp;</div>`;
}

export function renderMercurioPermitDoc(ctx: PermitPdfContext): Buffer {
  const { permit, vesselName, tenantName, formMeta, formConfig, formLogoBuffer, tz, locale } = ctx;
  const form = mercurioPermitForm(permit.type);
  const logo = bufferToDataUri(formLogoBuffer);
  const label = (id: string, fallback: string) => formConfig.labels[id] ?? fallback;

  const fDate = (d: Date | string | null | undefined) => fmtDate(d, tz, locale, "");
  const fDateTime = (d: Date | string | null | undefined) => fmtDateTime(d, tz, locale, "");
  /** Hora en 24 h, igual que el PDF. */
  const fTime = (d: Date | string | null | undefined): string => {
    if (!d) return "";
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz });
    } catch {
      return fmtTime(d, tz, locale, "");
    }
  };

  const { validFrom, validTo, supervisors, performers, lastGas, gasTesters, gasReading } =
    derivePermitFields(permit);
  const departments = formConfig.departments.length ? formConfig.departments : DEPARTMENT_OPTIONS;
  const authorized = isAuthorized(permit.status);
  const rejected   = permit.status === "REJECTED";

  const sections: Record<string, () => string> = {
    vesselHeader: () =>
      docKvRow([
        { label: label("remolcador", "REMOLCADOR"), value: vesselName, labelWidth: "18%", valueWidth: "42%" },
        { label: label("fecha", "FECHA"), value: fDate(permit.requestedAt ?? permit.createdAt), labelWidth: "12%", valueWidth: "28%" },
      ])
      + docKvRow([
        { label: label("zona", "ZONA"), value: permit.location, labelWidth: "10%", valueWidth: "40%" },
        { label: label("rio", "RIO"), value: "", labelWidth: "8%", valueWidth: "14%" },
        { label: label("km", "KM"), value: "", labelWidth: "8%", valueWidth: "10%" },
        { label: label("margen", "MARGEN"), value: "", labelWidth: "10%", valueWidth: "10%" },
      ])
      + `<table><tr class="hdr">${HEADER_ROLES.map(r => `<td>${esc(r)}</td>`).join("")}</tr>`
      + `<tr>${HEADER_ROLES.map(() => `<td style="height:26pt;">&nbsp;</td>`).join("")}</tr></table>`
      + docSection(label("departamento", "DEPARTAMENTO"))
      + checkOptions(departments)
      + docSpacer(),

    vesselHeaderShort: () =>
      docKvRow([
        { label: label("remolcador", "REMOLCADOR"), value: vesselName, labelWidth: "18%", valueWidth: "42%" },
        { label: label("fecha", "FECHA"), value: fDate(permit.requestedAt ?? permit.createdAt), labelWidth: "12%", valueWidth: "28%" },
      ])
      + docKvRow([
        { label: label("zona", "ZONA"), value: permit.location, labelWidth: "10%", valueWidth: "40%" },
        { label: label("rio", "RIO"), value: "", labelWidth: "8%", valueWidth: "14%" },
        { label: label("km", "KM"), value: "", labelWidth: "8%", valueWidth: "10%" },
        { label: label("margen", "MARGEN"), value: "", labelWidth: "10%", valueWidth: "10%" },
      ])
      + docSpacer(),

    shipStatus: () => docSection(label("shipStatus", "ESTADO DEL BUQUE"))
      + inlineOptions(SHIP_STATUS_OPTIONS)
      + docKvRow([
        { label: "RIO", value: "", labelWidth: "10%", valueWidth: "30%" },
        { label: "KM", value: "", labelWidth: "8%", valueWidth: "22%" },
        { label: "CIUDAD", value: "", labelWidth: "12%", valueWidth: "18%" },
      ])
      + docSpacer(),

    workKindHotCold: () => {
      const selected = permit.type === "HOT_WORK" ? ["TRABAJO EN CALIENTE"]
        : permit.type === "COLD_WORK" ? ["TRABAJO EN FRIO"]
        : permit.type === "ENCLOSED_SPACE_ENTRY" ? ["INGRESO A ESPACIO CONFINADO"] : [];
      return docSection(label("workKind", "TRABAJO PARA REALIZAR"))
        + checkOptions(form.workKinds, selected) + docSpacer();
    },

    workKindMaint: () => docSection(label("workKind", "TIPO DE TRABAJO A REALIZARSE"))
      + checkOptions(form.workKinds) + docSpacer(),

    affectedEquipment: () => docKvRow([
      { label: label("equipo", "EQUIPO AFECTADO"), value: "", labelWidth: "24%", valueWidth: "76%" },
    ])
      + docSection(label("workDesc", "DESCRIPCION DEL TRABAJO A SER REALIZADO"))
      + docTextBox(permit.description, "34pt") + docSpacer(),

    motiveZone: () => docSection(label("motive", "MOTIVO Y ZONA DEL TRABAJO"))
      + docTable(["N°", "ZONA", "MOTIVO", "DETALLE DEL TRABAJO"],
        [["1", permit.location, "", permit.description]], 2)
      + docSpacer(),

    motiveHeight: () => docSection(label("motive", "MOTIVO Y ALTURA DEL TRABAJO"))
      + docTable(["N°", "ZONA", "MOTIVO", "ALTURA"],
        [["1", permit.location, permit.description, ""]], 2)
      + docSpacer(),

    adjacentAreas: () => docSection(label("adjacent", "EN CORRESPONDENCIA CON (Describir las áreas linderas)"))
      + blankBox("34pt") + docSpacer(),

    tools: () => docSection(label("tools", "HERRAMIENTAS PARA UTILIZAR"))
      + blankBox("34pt") + docSpacer(),

    sketch: () => docSection(label("sketch", "CROQUIS DE LA ZONA A TRABAJARSE"))
      + blankBox("120pt") + docSpacer(),

    performers: () => docSection(label("performers", "QUIEN REALIZARA EL TRABAJO"))
      + peopleTable(performers, 3) + docSpacer(),

    supervisors: () => docSection(label("supervisors", "QUIEN SUPERVISARA EL TRABAJO"))
      + peopleTable(supervisors, 2) + docSpacer(),

    gasTesters: () => docSection(label("gasTesters", "QUIEN HARA MEDICION DE GASES"))
      + peopleTable(gasTesters, 2) + docSpacer(),

    gasEquipment: () => docSection(label("gasEquipment", "EQUIPO DE MEDICION DE GASES"))
      + docTable(["MARCA", "MODELO", "CERTIFICADO", "VENCE"], [], 1) + docSpacer(),

    gasResults: () => {
      const head = `<tr class="hdr"><td style="width:7%">ITEM</td><td style="width:26%">GAS</td>`
        + `<td style="width:20%">REFERENCIA</td><td style="width:17%">RESULTADO</td>`
        + `<td style="width:15%">HOMBRE SEGURO</td><td style="width:15%">HOMBRE NO SEGURO</td></tr>`;
      // Las dos casillas quedan vacías: el veredicto del sistema es global, no
      // por gas — quien mide decide y firma cada renglón.
      const body = form.gasRows.map((g, i) =>
        `<tr><td class="center">${i + 1}</td><td>${esc(g.gas)}</td>`
        + `<td class="center">${esc(g.reference)}</td><td class="center">${esc(gasReading(g.reading))}</td>`
        + `<td class="center">${cbx()}</td><td class="center">${cbx()}</td></tr>`).join("");
      const registrado = lastGas
        ? docKvRow([{
          label: "REGISTRADO",
          value: `${lastGas.verdict === "PASS" ? "SEGURO" : "NO SEGURO"} — ${fDate(lastGas.testedAt)} ${fTime(lastGas.testedAt)} — ${lastGas.testedByName}`,
          labelWidth: "16%", valueWidth: "84%",
        }])
        : "";
      return docSection(label("gasResults", "RESULTADO DE LA MEDICION DE GASES"))
        + `<table>${head}${body}</table>` + registrado + docSpacer();
    },

    considerations: () => {
      if (form.considerations.length === 0) return "";
      const blocks = form.considerations
        .map(g => (g.title ? docSection(g.title) : "") + checkTable(g.items))
        .join("");
      const comentarios = [permit.hazardsIdentified, permit.controlMeasures].filter(Boolean).join("\n");
      return (form.considerationsTitle ? docSection(form.considerationsTitle) : "")
        + blocks
        + docSection(label("otherComments", "OTROS COMENTARIOS"))
        + docTextBox(comentarios, "28pt") + docSpacer();
    },

    ppe: () => {
      if (form.ppe.length === 0) return "";
      const head = `<tr class="hdr"><td style="width:62%;text-align:left;">EQUIPO</td>`
        + `<td style="width:8%">SI</td><td style="width:8%">NO</td><td style="width:8%">NA</td><td style="width:14%">NOTA</td></tr>`;
      const body = form.ppe.map(p =>
        `<tr><td style="font-size:8pt;">${esc(p)}</td>`
        + `<td class="center">${cbx()}</td><td class="center">${cbx()}</td><td class="center">${cbx()}</td>`
        + `<td>&nbsp;</td></tr>`).join("");
      return docSection(PPE_HEADER) + `<table>${head}${body}</table>`
        + docSection(label("ppeComments", "OTROS COMENTARIOS"))
        + docTextBox(permit.ppeRequired ?? "", "24pt") + docSpacer();
    },

    resolution: () => {
      const rows = form.resolutionRows.length > 0 ? form.resolutionRows : [""];
      // Sólo se tilda la fila del trabajo que este permiso autoriza.
      const ownRow = permit.type === "HOT_WORK" ? "Trabajo en Caliente"
        : permit.type === "COLD_WORK" ? "Trabajo en Frío" : "";
      const head = `<tr class="hdr"><td style="width:50%">${form.resolutionRows.length > 0 ? "TRABAJO" : "&nbsp;"}</td>`
        + `<td style="width:25%">AUTORIZADO</td><td style="width:25%">NO AUTORIZADO</td></tr>`;
      const body = rows.map(r => {
        const isOwn = form.resolutionRows.length === 0 || r === ownRow;
        return `<tr><td style="font-size:8pt;">${esc(r)}</td>`
          + `<td class="center">${cbx(isOwn && authorized)}</td>`
          + `<td class="center">${cbx(isOwn && rejected)}</td></tr>`;
      }).join("");
      return docSection(label("resolution", "RESOLUCION DEL INSPECTOR O SUPERVISOR"))
        + `<table>${head}${body}</table>`
        + docSection(label("rejectCauses", "EN CASO DE NO AUTORIZADO DETALLAR CAUSAS"))
        + docTextBox(permit.rejectionReason ?? permit.cancelReason ?? "", "26pt")
        + docSection(label("specialMeasures", "EN CASO DE AUTORIZADO SI CORRESPONDEN MEDIDAS ESPECIALES"))
        + docTextBox(permit.controlMeasures ?? "", "26pt") + docSpacer();
    },

    validity: () => docSection(label("validity", "VALIDEZ"))
      + docKvRow([
        { label: "FECHA EXPEDICION", value: fDate(validFrom), labelWidth: "22%", valueWidth: "38%" },
        { label: "HORA", value: fTime(validFrom), labelWidth: "10%", valueWidth: "30%" },
      ])
      + docKvRow([
        { label: "FECHA VENCIMIENTO", value: fDate(validTo), labelWidth: "22%", valueWidth: "38%" },
        { label: "HORA", value: fTime(validTo), labelWidth: "10%", valueWidth: "30%" },
      ])
      // INSPECTOR y SUPERVISOR firman a bordo: sólo se imprime el nombre.
      + signerRows([
        { role: "INSPECTOR", name: authorized ? (ctx.approvedByName ?? "") : "" },
        { role: "SUPERVISOR", name: supervisors[0] ?? "" },
      ])
      + docSpacer(),

    specialComments: () => docSection(label("specialComments", "COMENTARIOS ESPECIALES"))
      + `<div class="box" style="min-height:40pt">`
      + SPECIAL_COMMENTS.map((l, i) => `<p style="margin:1pt 0;">${i + 1}. ${esc(l)}</p>`).join("")
      + `</div>` + docSpacer(),

    completion: () => docSection(label("completion", "FINALIZACION DE LOS TRABAJOS"))
      + docTable(["N°", "ZONA", "DETALLE", "FECHA DE REALIZADO"],
        permit.closedAt
          ? [["1", permit.location, permit.closeNotes ?? permit.description, fDate(permit.closedAt)]]
          : [], 2)
      + signerRows([
        { role: "INSPECTOR", name: permit.closedAt ? (ctx.closedByName ?? "") : "" },
        { role: "SUPERVISOR", name: "" },
      ])
      + docSpacer(),

    additionalComments: () => docSection(label("additionalComments", "COMENTARIOS ADICIONALES"))
      + docTextBox(permit.closeNotes ?? "", "40pt") + docSpacer(),

    generatedBy: () => docKvRow([{
      label: label("generatedBy", "EL PRESENTE FUE GENERADO POR"),
      value: `${ctx.createdByName ?? ""}  —  ${permit.permitCode}`,
      labelWidth: "34%", valueWidth: "66%",
    }]),

    // ── REGI-SYE-01.4 (formato IMO) ──
    esGeneral: () => docSection(label("esGeneral", "GENERAL"))
      + docKvRow([{ label: "LOCALIZACION / NOMBRE DEL ESPACIO CERRADO", value: permit.location, labelWidth: "42%", valueWidth: "58%" }])
      + docKvRow([{ label: "MOTIVO DE LA ENTRADA", value: permit.description, labelWidth: "42%", valueWidth: "58%" }])
      + docKvRow([
        { label: "VALIDO DESDE", value: `${fDate(validFrom)} ${fTime(validFrom)}`, labelWidth: "18%", valueWidth: "32%" },
        { label: "HASTA (ver nota 1)", value: `${fDate(validTo)} ${fTime(validTo)}`, labelWidth: "20%", valueWidth: "30%" },
      ])
      + docSpacer(),

    esSection1: () => docSection(ES_SECTION_1_TITLE) + checkTable(ES_SECTION_1, false)
      + docSection(ES_GAS_BLOCK_TITLE)
      + `<div class="box" style="min-height:22pt"><p style="margin:1pt 0;">${esc(ES_GAS_BLOCK_NOTE)}</p></div>`
      + docTable(["LECTURA", "LIMITE", "VALOR"],
        ES_GAS_READINGS.map(r => [r.label, r.limit, gasReading(r.reading)]))
      + `<div class="box" style="min-height:24pt"><p style="margin:1pt 0;">${esc(ES_GAS_BLOCK_FOOTNOTE)}</p></div>`
      + docSpacer(),

    esSection2: () => docSection(ES_SECTION_2_TITLE) + checkTable(ES_SECTION_2, false) + docSpacer(),

    esSignatures: () => {
      const head = `<tr class="hdr"><td style="width:40%">&nbsp;</td><td style="width:33%">NOMBRE Y FIRMA</td><td style="width:27%">FECHA Y HORA</td></tr>`;
      const body = ES_SIGNERS.map(s =>
        `<tr><td class="hdr" style="background:#F3F4F6;font-size:7pt;text-align:left;">${esc(s)}</td>`
        + `<td style="height:28pt;">&nbsp;</td><td style="height:28pt;">&nbsp;</td></tr>`).join("");
      return docSection(label("esSignatures", "PARA SER FIRMADO POR")) + `<table>${head}${body}</table>` + docSpacer();
    },

    esSection3: () => docSection(ES_SECTION_3_TITLE)
      + `<div class="box" style="min-height:34pt"><p style="margin:1pt 0;">${escMultiline(`${ES_SECTION_3_TEXT}\n${ES_SECTION_3_SIGN}`)}</p></div>`
      + docTable(["FIRMA DEL RESPONSABLE", "ACLARACION", "FECHA Y HORA"], [], 1)
      + `<div class="box" style="min-height:24pt"><p style="margin:1pt 0;"><b>${esc(ES_INVALID_WARNING)}</b></p></div>`
      + docSpacer(),

    esNotes: () => docSection(label("esNotes", "NOTAS"))
      + `<div class="box" style="min-height:40pt">`
      + ES_NOTES.map(n => `<p style="margin:1pt 0;">${esc(n)}</p>`).join("")
      + `</div>` + docSpacer(),

    esEntryLog: () => docSection(label("esEntryLog", "REGISTRO DE PERSONAS QUE INGRESARON AL ESPACIO CERRADO"))
      + docTable(["N°", "NOMBRE Y APELLIDO", "HORA / INGRESO", "HORA / SALIDA", "FIRMA"],
        performers.map((n, i) => [String(i + 1), n, "", "", ""]),
        Math.max(0, 6 - performers.length))
      + docSection(label("esObs", "OBSERVACIONES")) + blankBox("26pt") + docSpacer(),
  };

  const order = formConfig.sections.length > 0 ? formConfig.sections : ["vesselHeader", "generatedBy"];
  const parts: string[] = [docControlledHeader(formMeta, logo, tenantName, imagePixelSize(formLogoBuffer)), docSpacer()];
  // Número del permiso: no está en el papel, pero sin él el documento impreso
  // no se puede rastrear contra el sistema.
  parts.push(docKvRow([
    { label: "N° PERMISO", value: permit.permitCode, labelWidth: "16%", valueWidth: "44%" },
    { label: "ESTADO", value: PERMIT_STATUS_LABEL[permit.status] ?? permit.status, labelWidth: "12%", valueWidth: "28%" },
  ]));
  parts.push(docSpacer());
  for (const id of order) {
    const fn = sections[id];
    if (fn) parts.push(fn());
  }
  parts.push(`<p style="font-size:6.5pt;color:#6B7280;margin:6pt 0 0;">${esc(`${formMeta.formCode} — ${permit.permitCode} — ${vesselName} — ${fDateTime(new Date())}`)}</p>`);

  return wrapAsWordDoc({
    title: `${formMeta.formCode} ${permit.permitCode}`,
    bodyHtml: parts.join("\n"),
    footerHtml: docControlledFooter(formMeta),
  });
}

/**
 * Word del PDF estándar (tenants sin documento controlado propio): misma ficha
 * de secciones que template-standard.ts, editable en Word.
 */
export function renderStandardPermitDoc(ctx: PermitPdfContext): Buffer {
  const { permit, vesselName, tenantName, tenantLogoBuffer, tz, locale } = ctx;
  const logo = bufferToDataUri(tenantLogoBuffer);
  const f = (d: Date | string | null | undefined) => fmtDateTime(d, tz, locale, "—");
  const { validFrom, validTo } = derivePermitFields(permit);

  const parts: string[] = [];
  // Tamaño real del logo: sin proporción, Word lo estira a la caja.
  const { wcm, hcm } = fitLogoBox(imagePixelSize(tenantLogoBuffer), 2.5, 1.4);
  parts.push(`<table><tr>
    <td style="width:20%;text-align:center;border:none;">${logo ? `<img src="${logo}" width="${Math.round(wcm * 37.8)}" height="${Math.round(hcm * 37.8)}" style="width:${wcm}cm;height:${hcm}cm;">` : `<b>${esc(tenantName)}</b>`}</td>
    <td style="width:60%;text-align:center;border:none;">
      <b style="font-size:14pt;">PERMISO DE TRABAJO</b><br>
      <span style="font-size:10pt;color:#6B7280;">${esc(PERMIT_TYPE_LABEL[permit.type] ?? permit.type)}</span>
    </td>
    <td style="width:20%;text-align:right;border:none;font-size:8pt;">
      <b>N° ${esc(permit.permitCode)}</b><br>
      <span style="color:#0369a1;">${esc(PERMIT_STATUS_LABEL[permit.status] ?? permit.status)}</span>
    </td>
  </tr></table>`);
  parts.push(docSpacer());

  parts.push(docSection("Identificación"));
  parts.push(docKvRow([{ label: "BUQUE", value: vesselName, labelWidth: "22%", valueWidth: "78%" }]));
  parts.push(docKvRow([{ label: "UBICACION", value: val(permit.location), labelWidth: "22%", valueWidth: "78%" }]));
  parts.push(docKvRow([
    { label: "INICIO PLANEADO", value: f(permit.plannedStart), labelWidth: "22%", valueWidth: "28%" },
    { label: "FIN PLANEADO", value: f(permit.plannedEnd), labelWidth: "20%", valueWidth: "30%" },
  ]));
  parts.push(docKvRow([
    { label: "VALIDO DESDE", value: f(validFrom), labelWidth: "22%", valueWidth: "28%" },
    { label: "VALIDO HASTA", value: f(validTo), labelWidth: "20%", valueWidth: "30%" },
  ]));

  parts.push(docSection("Descripción del trabajo"));
  parts.push(docTextBox(permit.description, "40pt"));
  if (permit.hazardsIdentified) { parts.push(docSection("Peligros identificados")); parts.push(docTextBox(permit.hazardsIdentified, "34pt")); }
  if (permit.controlMeasures)   { parts.push(docSection("Medidas de control"));     parts.push(docTextBox(permit.controlMeasures, "34pt")); }
  if (permit.ppeRequired)       { parts.push(docSection("EPP requerido"));          parts.push(docTextBox(permit.ppeRequired, "26pt")); }

  if (permit.participants.length > 0) {
    parts.push(docSection("Participantes"));
    parts.push(docTable(["ROL", "NOMBRE"],
      permit.participants.map(p => [PERMIT_ROLE_LABEL[p.role] ?? p.role, p.name])));
  }

  if (permit.gasTests.length > 0) {
    parts.push(docSection("Gas Tests (SOLAS XI-1/7 + ISGOTT 6 Cap. 11)"));
    parts.push(docTable(["FECHA/HORA", "MEDIDO POR", "O2 %", "LEL %", "H2S", "CO", "RESULTADO"],
      permit.gasTests.map(g => [
        f(g.testedAt), g.testedByName,
        g.o2Pct !== null ? g.o2Pct.toFixed(1) : "—",
        g.lelPct !== null ? g.lelPct.toFixed(2) : "—",
        g.h2sPpm !== null ? g.h2sPpm.toFixed(0) : "—",
        g.coPpm !== null ? g.coPpm.toFixed(0) : "—",
        g.verdict,
      ])));
  }

  parts.push(docSection("Trazabilidad"));
  parts.push(docTable(["HITO", "FECHA", "USUARIO"], [
    ["Solicitado", f(permit.requestedAt), ctx.createdByName ?? ""],
    ["Aprobado",   f(permit.approvedAt),  ctx.approvedByName ?? ""],
    ["Activado",   f(permit.activatedAt), ""],
    ["Cerrado",    f(permit.closedAt),    ctx.closedByName ?? ""],
  ]));
  if (permit.closeNotes)      { parts.push(docSection("Notas de cierre"));        parts.push(docTextBox(permit.closeNotes, "26pt")); }
  if (permit.rejectionReason) { parts.push(docSection("Motivo de rechazo"));      parts.push(docTextBox(permit.rejectionReason, "26pt")); }
  if (permit.cancelReason)    { parts.push(docSection("Motivo de cancelación"));  parts.push(docTextBox(permit.cancelReason, "26pt")); }

  const checklist = buildPermitChecklist(permit.type);
  if (checklist.length > 0) {
    parts.push(docSection("Checklist regulatorio"));
    parts.push(`<table>${checklist.map(c =>
      `<tr><td style="width:6%;text-align:center;">${cbx()}</td>`
      + `<td style="width:74%;font-size:8pt;">${esc(c.item)}</td>`
      + `<td style="width:20%;font-size:7pt;color:#6B7280;font-style:italic;">${esc(c.reference)}</td></tr>`).join("")}</table>`);
  }

  parts.push(docSection("Firmas (a completar a bordo)"));
  parts.push(`<table><tr>
    <td style="width:33%;height:64pt;vertical-align:top;font-size:7pt;color:#6B7280;">SOLICITANTE<br><br><br>Nombre / Firma / Fecha</td>
    <td style="width:34%;height:64pt;vertical-align:top;font-size:7pt;color:#6B7280;">APROBADOR (CAPITAN / JEFE MAQ.)<br><br><br>Nombre / Firma / Fecha</td>
    <td style="width:33%;height:64pt;vertical-align:top;font-size:7pt;color:#6B7280;">CIERRE<br><br><br>Nombre / Firma / Fecha</td>
  </tr></table>`);
  parts.push(`<p style="font-size:6.5pt;color:#6B7280;">${esc(`Generado ${f(new Date())} · ${permit.permitCode}`)}</p>`);

  return wrapAsWordDoc({ title: permit.permitCode, bodyHtml: parts.join("\n") });
}
