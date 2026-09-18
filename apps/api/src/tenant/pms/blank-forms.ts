// Formularios EN BLANCO en Word (.docx) para completar a mano: la OT
// (REGI-MAN-02.4) y la Solicitud de Servicio. Se bajan desde el encabezado de
// Órdenes de Trabajo y de Solicitudes de Servicio.
//
// Mismo documento controlado que el PDF (logo, código, revisión, pie
// Elaborado/Revisado/Aprobado y secciones en el orden que define el tenant),
// pero sin datos: todas las casillas vacías y los recuadros con lugar para escribir.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { resolveTenantForm } from "./tenant-forms-service";
import { resolveTenantLogo } from "./pdf-helpers";
import { resolveTenantTime } from "../../common/tenant-time";
import {
  buildWordHtml, bufferToDataUri, esc, docControlledHeader, docControlledFooter,
  docSection, docKvRow, docTable, docSpacer, imagePixelSize,
} from "./doc-export";
import { wrapHtmlAsDocx } from "./docx-export";
import { renderServiceRequestHtml } from "./service-request-pdf/word-service-request";
import {
  REQUESTED_BY, ASSIGNED_TO, SYSTEM_AREAS, MAINT_KINDS, PRIORITIES, PERMIT_ROWS,
} from "./work-order-pdf/template-mercurio-ot";

/** Nombre y logo de la empresa: el logo propio del formulario gana sobre el del tenant. */
async function tenantChrome(slug: string, formLogo: Buffer | null) {
  let name = slug.toUpperCase();
  let logo = formLogo;
  const prisma = getPrismaClient() as any;
  if (prisma) {
    try {
      const row = await prisma.tenant.findUnique({
        where: { slug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      if (row?.settings?.displayName) name = row.settings.displayName;
      if (!logo) logo = await resolveTenantLogo(slug, row?.settings?.logoUrl, row?.settings?.logoUrlLight);
    } catch { /* sin logo: el encabezado muestra el nombre */ }
  }
  return { name, logo };
}

// ── Piezas en blanco ─────────────────────────────────────────────────────────

const box = `<span class="cbx">&nbsp;</span>`;

/** Recuadro vacío para escribir a mano (Word respeta la altura de la celda, no min-height). */
const writeBox = (heightPt: number) => `<table><tr><td style="height:${heightPt}pt;">&nbsp;</td></tr></table>`;

/** Fila de opciones con casilla vacía. */
const optionsRow = (opts: Array<{ l: string }>) =>
  `<table><tr>${opts.map(o => `<td style="font-size:7pt;font-weight:bold;">${box} ${esc(o.l)}</td>`).join("")}</tr></table>`;

/** Pares etiqueta / valor vacío, dos por fila. */
const kvBlank = (pairs: Array<[string, string]>) => pairs
  .map(([a, b]) => docKvRow([
    { label: a, value: "", labelWidth: "20%", valueWidth: "30%" },
    { label: b, value: "", labelWidth: "20%", valueWidth: "30%" },
  ])).join("");

/** PRIORIDAD / TIPO DE MANTENIMIENTO / SISTEMA uno al lado del otro, como en el papel. */
function optionBoxes(boxes: Array<{ title: string; opts: Array<{ l: string }>; width: string }>): string {
  const rows = Math.max(...boxes.map(b => b.opts.length));
  const head = `<tr>${boxes.map(b => `<td class="lbl center" style="width:${b.width};">${esc(b.title)}</td>`).join("")}</tr>`;
  let body = "";
  for (let i = 0; i < rows; i++) {
    body += `<tr>${boxes.map(b => {
      const o = b.opts[i];
      return `<td style="font-size:7pt;">${o ? `${box} ${esc(o.l)}` : "&nbsp;"}</td>`;
    }).join("")}</tr>`;
  }
  return `<table>${head}${body}</table>`;
}

/** Matriz de riesgo sin celda marcada (misma grilla que el PDF). */
function riskMatrix(): string {
  const probs = ["Muy probable", "Probable", "Improbable", "Altamente improbable"];
  const rows: Array<[string, Array<"H" | "M" | "B">]> = [
    ["Fatalidad", ["H", "H", "H", "M"]],
    ["Lesiones importantes", ["H", "H", "M", "M"]],
    ["Lesiones leves", ["H", "M", "M", "B"]],
    ["Lesiones insignificantes", ["M", "M", "B", "B"]],
  ];
  const color = { H: "#dc2626", M: "#f59e0b", B: "#16a34a" };
  const text = { H: "Alto", M: "Medio", B: "Bajo" };
  const head = `<tr><td class="lbl center" style="width:24%;font-size:7pt;">CONSECUENCIA</td>${probs.map(p =>
    `<td class="center" style="background:#1e3a5f;color:#ffffff;font-size:7pt;font-weight:bold;">${p}</td>`).join("")}</tr>`;
  const body = rows.map(([c, lv]) => `<tr><td class="center" style="background:#e2e8f0;font-size:7pt;font-weight:bold;">${c}</td>${lv.map(l =>
    `<td class="center" style="background:${color[l]};color:#ffffff;font-weight:bold;">${text[l]}</td>`).join("")}</tr>`).join("");
  return `<table>${head}${body}</table>`;
}

/** Dos recuadros de firma con línea y rótulo. */
const signatureBoxes = (labels: [string, string]) =>
  `<table><tr>${labels.map(l =>
    `<td style="width:50%;height:84pt;vertical-align:bottom;text-align:center;">_______________________________<br><span style="font-size:6pt;" class="muted"><b>${esc(l)}</b></span></td>`).join("")}</tr></table>`;

// ── OT en blanco (REGI-MAN-02.4) ─────────────────────────────────────────────

export async function buildBlankWorkOrderDocx(session: TenantAccessSession): Promise<Buffer> {
  const form = await resolveTenantForm(session.tenantSlug, "WORK_ORDER");
  const { name, logo } = await tenantChrome(session.tenantSlug, form.logoBuffer);
  const label = (id: string, fallback: string) => form.config.labels[id] ?? fallback;
  const items = (title: string) => docSection(title) + docTable(["DESCRIPCION", "CANTIDAD"], [], 4);

  const sections: Record<string, () => string> = {
    header: () => kvBlank([
      [label("unidad", "UNIDAD"), label("nroOt", "NRO DE OT")],
      [label("equipo", "EQUIPO"), label("nroSsSc", "NRO DE SS/SC")],
      [label("ubicacion", "UBICACION"), label("fecha", "FECHA")],
      [label("itemPdm", "ITEM DEL PDM"), label("estadoOt", "ESTADO DE OT")],
      [label("generadoPor", "GENERADO POR"), label("nroViaje", "NRO DE VIAJE")],
    ]) + docKvRow([{ label: label("condicion", "CONDICION"), value: "", labelWidth: "20%", valueWidth: "80%" }]),
    requestedBy: () => docSection(label("requestedBy", "SOLICITADO POR")) + optionsRow(REQUESTED_BY),
    assignedTo: () => docSection(label("assignedTo", "ASIGNADO A")) + optionsRow(ASSIGNED_TO) +
      docKvRow([{ label: label("tecnico", "TECNICO"), value: "", labelWidth: "20%", valueWidth: "80%" }]) +
      docKvRow([{ label: label("proveedor", "PROVEEDOR"), value: "", labelWidth: "20%", valueWidth: "80%" }]),
    priorityKindSystem: () => optionBoxes([
      { title: label("prioridad", "PRIORIDAD"), opts: PRIORITIES, width: "31%" },
      { title: label("tipoMant", "TIPO DE MANTENIMIENTO"), opts: MAINT_KINDS, width: "38%" },
      { title: label("sistema", "SISTEMA"), opts: SYSTEM_AREAS, width: "31%" },
    ]),
    permits: () => docSection(label("permits", "AUTORIZACION DE TRABAJO")) +
      `<table><tr><td style="font-size:7pt;" class="muted">Completo correctamente la autorizacion de trabajo correspondiente a las tareas de:</td></tr></table>` +
      optionsRow(PERMIT_ROWS),
    request: () => docSection(label("request", "TRABAJO SOLICITADO")) + writeBox(60),
    task: () => docSection(label("task", "TAREA")) + writeBox(60),
    spares: () => items(label("spares", "REPUESTOS")),
    materials: () => items(label("materials", "MATERIALES")),
    schedule: () => docSection(label("schedule", "PROGRAMACION DE TRABAJO")) +
      docKvRow([
        { label: label("fechaInicio", "FECHA INICIO"), value: "", labelWidth: "20%", valueWidth: "30%" },
        { label: label("fechaFin", "FECHA FINALIZACION"), value: "", labelWidth: "20%", valueWidth: "30%" },
      ]) +
      docTable(["FECHA", "TECNICO ASIGNADO", "LUGAR", "EMPRESA", "HORARIO"], [], 4),
    completion: () => `<table><tr><td class="lbl" style="width:26%;">${esc(label("taskCompleted", "TAREA CONCLUIDA?"))}</td>` +
      `<td style="font-weight:bold;">${box} SI</td><td style="font-weight:bold;">${box} NO</td></tr></table>`,
    pending: () => docSection(label("pending", "DETALLE DE PENDIENTES (MATERIALES/TAREAS)")) + writeBox(50),
    risk: () => docSection(label("risk", "NIVEL DE RIESGO")) +
      docKvRow([{ label: "NIVEL", value: "", labelWidth: "20%", valueWidth: "80%" }]) +
      riskMatrix() +
      `<table><tr><td class="center" style="border:none;font-size:7.5pt;"><b>${esc(label("riskAnnexNote", "Ver adjunto el resultado del Analisis de Riesgo y LOTO."))}</b></td></tr>` +
      `<tr><td class="center muted" style="border:none;font-size:6.5pt;"><i>ANTES DE COMENZAR LA TAREA, REALICE UN ANALISIS PRELIMINAR DE RIESGOS Y TOME LAS MEDIDAS NECESARIAS PARA CADA CASO.</i></td></tr></table>`,
    // Hoja aparte, como en el PDF: se entrega y archiva suelta de la OT.
    riskAnnex: () => `<br style="page-break-before:always;" clear="all">` +
      `<table class="sec"><tr><td class="center">${esc(label("riskAnnexTitle", "ANEXO — ANALISIS DE RIESGO Y LOTO"))}</td></tr></table>` +
      kvBlank([["ORDEN DE TRABAJO", "UNIDAD"], ["EQUIPO", "FECHA"]]) + docSpacer() +
      docSection(label("riskResult", "RESULTADO DEL ANALISIS DE RIESGO")) + writeBox(180) +
      docSection(label("loto", "LOTO (LOCKOUT / TAGOUT)")) + writeBox(140),
    signatures: () => signatureBoxes(["FIRMA Y ACLARACION DEL SOLICITANTE", "FIRMA Y ACLARACION DEL ASIGNADO"]),
  };

  const order = form.config.sections.length ? form.config.sections : Object.keys(sections);
  const parts = [docControlledHeader(form.meta, bufferToDataUri(logo), name, imagePixelSize(logo)), docSpacer()];
  // Mismo orden que el PDF; si el tenant usa otro formulario de OT, los ids que
  // no están en este catálogo se saltean y se completa con el orden estándar.
  let known = order.filter(id => sections[id]);
  if (known.length === 0) known = Object.keys(sections);
  // Las firmas van antes del anexo: el anexo es una hoja aparte.
  const withoutAnnex = known.filter(id => id !== "riskAnnex");
  for (const id of withoutAnnex) parts.push(sections[id]!());
  if (known.includes("riskAnnex")) parts.push(sections.riskAnnex!());

  const html = buildWordHtml({
    title: `${form.meta.formCode} ${form.meta.title} (en blanco)`,
    bodyHtml: parts.join("\n"),
    footerHtml: docControlledFooter(form.meta),
  });
  return wrapHtmlAsDocx(html);
}

// ── SS en blanco ─────────────────────────────────────────────────────────────

/** Mismo renderer que la SS real, con una solicitud vacía: el papel sale idéntico, sin datos. */
export async function buildBlankServiceRequestDocx(session: TenantAccessSession): Promise<Buffer> {
  const form = await resolveTenantForm(session.tenantSlug, "SERVICE_REQUEST");
  const { name, logo } = await tenantChrome(session.tenantSlug, form.logoBuffer);
  const html = renderServiceRequestHtml({
    sr: {},
    wo: null,
    assetLabel: "",
    assetIsSafetyCritical: false,
    vesselName: "",
    providerName: null,
    createdByName: null,
    createdByFormName: null,
    assignedName: null,
    assignedFormName: null,
    assignedSignatureBuffer: null,
    solicitaSignatureBuffer: null,
    apruebaSignatureBuffer: null,
    autorizaSignatureBuffer: null,
    tenant: { name, logoUrl: null, logoUrlLight: null },
    tenantSlug: session.tenantSlug,
    ...(await resolveTenantTime(session.tenantSlug)),
    formMeta: form.meta,
    formConfig: form.config,
    formLogoBuffer: logo,
    docCode: "",
  });
  return wrapHtmlAsDocx(html);
}
