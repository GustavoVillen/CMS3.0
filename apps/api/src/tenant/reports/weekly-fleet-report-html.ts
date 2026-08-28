// Plantillas del parte semanal de flota que se manda por correo (lunes y viernes).
//
// Por que esta escrito con tablas y estilos en linea en vez de CSS moderno:
// Outlook renderiza con el motor de Word. No soporta flexbox, grid, ni hojas de
// estilo externas; una <div> con `display:flex` se apila y el correo se rompe.
// Tablas anidadas + `style=` en cada celda es lo unico que se ve igual en Gmail,
// Outlook y el celular. Mismo criterio de "HTML autocontenido, sin JS" que
// `dashboard/dashboard-html-service.ts`, pero mas conservador todavia.
//
// El logo se referencia por URL publica, no embebido: los clientes de correo
// bloquean data-URIs y los adjuntos inline inflan el mensaje. Si el destinatario
// tiene las imagenes bloqueadas, el correo igual se entiende.

const INK = "#16233D";
const NAVY = "#1F3A6E";
const PAPER = "#F4F6F9";
const CARD = "#FFFFFF";
const RULE = "#DCE2EB";
const MUTED = "#5C6B85";
const CRIT = "#A32B2B";
const WARN = "#B5761F";
const OK = "#1E6B57";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

/** Escapa texto que viene de la base (titulos de tarea, nombres de equipo). */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ReportKpi {
  value: string | number;
  label: string;
  tone?: "plain" | "crit" | "warn" | "ok";
}

export interface ReportTaskRow {
  vesselName: string;
  taskCode: string;
  title: string;
  assetName: string;
  dueLabel: string;
  riskLabel: string;
}

export interface ReportDoneRow {
  workOrderCode: string;
  vesselName: string;
  title: string;
  assetName: string;
  dateLabel: string;
  executedBy: string;
  resultLabel: string;
  resultOk: boolean;
}

export interface ReportBarRow {
  label: string;
  value: number;
}

const toneColor = (tone: ReportKpi["tone"]): string =>
  tone === "crit" ? CRIT : tone === "warn" ? WARN : tone === "ok" ? OK : INK;

function chip(text: string, color: string, bg: string): string {
  return `<span style="display:inline-block;padding:2px 7px;border-radius:3px;background:${bg};`
    + `color:${color};font:600 11px/1.5 ${SANS};letter-spacing:.02em;white-space:nowrap;">${esc(text)}</span>`;
}

function kpiCell(k: ReportKpi): string {
  return `<td width="33.33%" align="center" style="padding:14px 10px;border:1px solid ${RULE};background:${CARD};">`
    + `<div style="font:700 26px/1.1 ${SANS};color:${toneColor(k.tone)};letter-spacing:-.02em;`
    + `font-variant-numeric:tabular-nums;">${esc(k.value)}</div>`
    + `<div style="font:600 10px/1.4 ${SANS};color:${MUTED};letter-spacing:.09em;`
    + `text-transform:uppercase;padding-top:5px;">${esc(k.label)}</div></td>`;
}

/** Rellena la ultima fila para que la grilla siempre tenga 3 columnas. */
function kpiGrid(kpis: ReportKpi[]): string {
  const rows: string[] = [];
  for (let i = 0; i < kpis.length; i += 3) {
    const group = kpis.slice(i, i + 3);
    const cells = group.map(kpiCell).join("");
    const filler = '<td width="33.33%" style="padding:0;">&nbsp;</td>'.repeat(3 - group.length);
    rows.push(`<tr>${cells}${filler}</tr>`);
  }
  return `<tr><td style="padding:14px 28px 0;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" `
    + `style="border-collapse:separate;border-spacing:6px;">${rows.join("")}</table></td></tr>`;
}

function section(title: string, sub = ""): string {
  const subHtml = sub
    ? `<div style="font:400 13px/1.5 ${SANS};color:${MUTED};padding-top:4px;">${esc(sub)}</div>`
    : "";
  return `<tr><td style="padding:26px 28px 0;">`
    + `<div style="font:700 11px/1.4 ${SANS};color:${NAVY};letter-spacing:.13em;`
    + `text-transform:uppercase;">${esc(title)}</div>${subHtml}`
    + `<div style="height:1px;background:${RULE};margin-top:12px;font-size:0;line-height:0;">&nbsp;</div>`
    + `</td></tr>`;
}

function th(text: string, align: "left" | "center" = "left"): string {
  return `<th align="${align}" style="padding:9px 10px;border-bottom:1px solid ${RULE};`
    + `font:700 10px/1.4 ${SANS};color:${MUTED};letter-spacing:.09em;text-transform:uppercase;">${esc(text)}</th>`;
}

function td(html: string, align: "left" | "center" = "left", color = INK, weight = "400", nums = false): string {
  const n = nums ? "font-variant-numeric:tabular-nums;" : "";
  return `<td align="${align}" style="padding:10px;border-bottom:1px solid ${RULE};`
    + `font:${weight} 13px/1.45 ${SANS};color:${color};${n}">${html}</td>`;
}

function codeSpan(text: string): string {
  return `<span style="color:${MUTED};font:600 11px ${SANS};letter-spacing:.02em;">${esc(text)}</span>`;
}

function barRow(label: string, value: number, max: number): string {
  const pct = Math.max(3, Math.round((value * 100) / Math.max(1, max)));
  const color = value >= 40 ? CRIT : value >= 10 ? WARN : MUTED;
  return `<tr>`
    + `<td width="150" style="padding:7px 10px 7px 0;font:600 13px/1.4 ${SANS};color:${INK};`
    + `white-space:nowrap;">${esc(label)}</td>`
    + `<td style="padding:7px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`
    + `<td width="${pct}%" style="background:${color};height:9px;font-size:0;line-height:0;border-radius:2px;">&nbsp;</td>`
    + `<td style="background:${PAPER};height:9px;font-size:0;line-height:0;">&nbsp;</td>`
    + `</tr></table></td>`
    + `<td width="46" align="right" style="padding:7px 0 7px 12px;font:700 13px/1.4 ${SANS};`
    + `color:${color};font-variant-numeric:tabular-nums;">${value}</td></tr>`;
}

function masthead(eyebrow: string, title: string, dateline: string, logoUrl: string | null): string {
  const logoCell = logoUrl
    ? `<td width="46" valign="middle"><img src="${esc(logoUrl)}" width="46" height="42" alt="" `
      + `style="display:block;border:0;width:46px;height:auto;"></td>`
    : "";
  const pad = logoUrl ? ' style="padding-left:14px;"' : "";
  return `<tr><td style="background:${NAVY};padding:22px 28px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${logoCell}`
    + `<td valign="middle"${pad}>`
    + `<div style="font:600 10px/1.4 ${SANS};color:#9FB4D8;letter-spacing:.14em;`
    + `text-transform:uppercase;">${esc(eyebrow)}</div>`
    + `<div style="font:700 19px/1.25 ${SANS};color:#FFFFFF;letter-spacing:-.01em;`
    + `padding-top:2px;">${esc(title)}</div></td>`
    + `<td valign="middle" align="right" style="font:600 12px/1.4 ${SANS};color:#9FB4D8;`
    + `font-variant-numeric:tabular-nums;white-space:nowrap;">${esc(dateline)}</td>`
    + `</tr></table></td></tr>`;
}

function footer(cadence: string, appUrl: string): string {
  return `<tr><td style="padding:24px 28px 30px;">`
    + `<div style="height:1px;background:${RULE};font-size:0;line-height:0;">&nbsp;</div>`
    + `<div style="font:400 12px/1.7 ${SANS};color:${MUTED};padding-top:16px;">${esc(cadence)}<br>`
    + `<a href="${esc(appUrl)}" style="color:${NAVY};font-weight:600;text-decoration:none;">Abrir Mercurio&nbsp;CMS</a>`
    + `&nbsp;&middot;&nbsp; Los n&uacute;meros salen del sistema en el momento del env&iacute;o.`
    + `</div></td></tr>`;
}

function bullets(items: string[]): string {
  const rows = items
    .map(i => `<tr><td style="padding:0 0 8px;font:400 14px/1.6 ${SANS};color:${INK};">&bull;&nbsp; ${i}</td></tr>`)
    .join("");
  return `<tr><td style="padding:14px 28px 0;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>`;
}

function emptyNote(text: string): string {
  return `<tr><td style="padding:16px 28px 0;font:400 14px/1.6 ${SANS};color:${MUTED};">${esc(text)}</td></tr>`;
}

function shell(title: string, preheader: string, body: string): string {
  return `<!DOCTYPE html>\n<html lang="es"><head>`
    + `<meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="x-apple-disable-message-reformatting">`
    + `<title>${esc(title)}</title></head>`
    + `<body style="margin:0;padding:0;background:${PAPER};">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">`
    + `<tr><td align="center" style="padding:24px 12px;">`
    + `<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" `
    + `style="width:640px;max-width:100%;background:${CARD};border:1px solid ${RULE};`
    + `border-radius:4px;overflow:hidden;">${body}</table>`
    + `</td></tr></table></body></html>`;
}

// ── Lunes: apertura de semana ───────────────────────────────────────────────

export interface OpeningReportData {
  greetingName: string | null;
  dateline: string;
  weekLabel: string;
  kpis: ReportKpi[];
  backlogBars: ReportBarRow[];
  backlogNote: string;
  tasks: ReportTaskRow[];
  logoUrl: string | null;
  appUrl: string;
}

export function renderOpeningHtml(d: OpeningReportData): string {
  const hola = d.greetingName ? `Buen d&iacute;a, ${esc(d.greetingName)}.` : "Buen d&iacute;a.";
  const maxBar = d.backlogBars.reduce((m, b) => Math.max(m, b.value), 0);

  const bars = d.backlogBars.length > 0
    ? `<tr><td style="padding:10px 28px 0;">`
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`
      + d.backlogBars.map(b => barRow(b.label, b.value, maxBar)).join("")
      + `</table></td></tr>`
    : emptyNote("No hay planes vencidos en la flota.");

  const taskRows = d.tasks.map(t =>
    `<tr>${td(esc(t.vesselName), "left", INK, "600")}`
    + `${td(`${codeSpan(t.taskCode)}<br>${esc(t.title)}`)}`
    + `${td(esc(t.assetName), "left", MUTED)}`
    + `${td(esc(t.dueLabel), "center", INK, "600", true)}`
    + `${td(chip(t.riskLabel, "#8A5A12", "#FBF0DC"), "center")}</tr>`).join("");

  const tasksBlock = d.tasks.length > 0
    ? `<tr><td style="padding:6px 28px 0;">`
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">`
      + `<tr>${th("Buque")}${th("Tarea")}${th("Equipo")}${th("Vence", "center")}${th("Riesgo", "center")}</tr>`
      + taskRows + `</table></td></tr>`
    : emptyNote("No hay tareas con vencimiento en esta semana.");

  const body = masthead("Resumen semanal &middot; Mantenimiento",
                        "Estado de flota y tareas de la semana", d.dateline, d.logoUrl)
    + `<tr><td style="padding:24px 28px 0;font:400 14px/1.6 ${SANS};color:${INK};">`
    + `${hola} As&iacute; arranca la semana del <strong>${esc(d.weekLabel)}</strong>.</td></tr>`
    + section("Estado de la flota", "Foto de hoy, al momento del envío.")
    + kpiGrid(d.kpis)
    + section("Dónde está el atraso", d.backlogNote)
    + bars
    + section("Tareas de esta semana", `${d.tasks.length} ${d.tasks.length === 1 ? "plan vence" : "planes vencen"} en los próximos 7 días.`)
    + tasksBlock
    + footer("Se envía automáticamente los lunes a las 07:00.", d.appUrl);

  return shell("Estado de flota y tareas de la semana",
               `${d.tasks.length} tareas vencen esta semana`, body);
}

// ── Viernes: cierre de semana ───────────────────────────────────────────────

export interface ClosingReportData {
  greetingName: string | null;
  dateline: string;
  weekLabel: string;
  kpis: ReportKpi[];
  done: ReportDoneRow[];
  openItems: string[];
  logoUrl: string | null;
  appUrl: string;
}

export function renderClosingHtml(d: ClosingReportData): string {
  const hola = d.greetingName ? `${esc(d.greetingName)}, esto` : "Esto";

  const doneRows = d.done.map(r =>
    `<tr>${td(`${codeSpan(r.workOrderCode)}<br><strong>${esc(r.vesselName)}</strong>`)}`
    + `${td(esc(r.title))}`
    + `${td(esc(r.assetName), "left", MUTED)}`
    + `${td(esc(r.dateLabel), "center", INK, "600", true)}`
    + `${td(esc(r.executedBy), "left", MUTED)}`
    + `${td(r.resultOk
        ? chip(r.resultLabel, "#0F5040", "#DDF0E8")
        : chip(r.resultLabel, "#8A2020", "#F7E2E2"), "center")}</tr>`).join("");

  const doneBlock = d.done.length > 0
    ? `<tr><td style="padding:6px 28px 0;">`
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">`
      + `<tr>${th("OT / Buque")}${th("Tarea")}${th("Equipo")}${th("Cierre", "center")}${th("Ejecutó")}${th("Resultado", "center")}</tr>`
      + doneRows + `</table></td></tr>`
    : emptyNote("No se cerró ninguna orden de trabajo esta semana.");

  const body = masthead("Cierre de semana &middot; Mantenimiento",
                        "Lo que se ejecutó esta semana", d.dateline, d.logoUrl)
    + `<tr><td style="padding:24px 28px 0;font:400 14px/1.6 ${SANS};color:${INK};">`
    + `${hola} es lo que qued&oacute; hecho entre el <strong>${esc(d.weekLabel)}</strong>.</td></tr>`
    + section("La semana en números")
    + kpiGrid(d.kpis)
    + section("Órdenes de trabajo cerradas")
    + doneBlock
    + section("Lo que quedó abierto", "Para arrancar el lunes.")
    + bullets(d.openItems)
    + footer("Se envía automáticamente los viernes a las 17:00.", d.appUrl);

  return shell("Lo que se ejecuto esta semana",
               `${d.done.length} OT cerradas esta semana`, body);
}

// ── Alternativa en texto plano ──────────────────────────────────────────────
// Va SIEMPRE junto al HTML: es lo que ven los clientes que no muestran HTML y
// mejora el puntaje antispam.

export function renderOpeningText(d: OpeningReportData): string {
  const lines = [
    `ESTADO DE FLOTA Y TAREAS DE LA SEMANA - ${d.dateline}`,
    `Semana del ${d.weekLabel}`,
    "",
    "ESTADO DE LA FLOTA",
    ...d.kpis.map(k => `  ${k.value} - ${k.label}`),
    "",
    "DONDE ESTA EL ATRASO",
    ...(d.backlogBars.length
      ? d.backlogBars.map(b => `  ${b.label}: ${b.value}`)
      : ["  Sin planes vencidos."]),
    "",
    `TAREAS DE ESTA SEMANA (${d.tasks.length})`,
    ...(d.tasks.length
      ? d.tasks.map(t => `  ${t.dueLabel} - ${t.vesselName} - ${t.taskCode} - ${t.title} (${t.assetName})`)
      : ["  Sin tareas con vencimiento esta semana."]),
    "",
    `Abrir Mercurio CMS: ${d.appUrl}`,
    "Se envia automaticamente los lunes a las 07:00.",
  ];
  return lines.join("\n");
}

export function renderClosingText(d: ClosingReportData): string {
  const lines = [
    `LO QUE SE EJECUTO ESTA SEMANA - ${d.dateline}`,
    `Semana del ${d.weekLabel}`,
    "",
    "LA SEMANA EN NUMEROS",
    ...d.kpis.map(k => `  ${k.value} - ${k.label}`),
    "",
    `ORDENES DE TRABAJO CERRADAS (${d.done.length})`,
    ...(d.done.length
      ? d.done.map(r => `  ${r.dateLabel} - ${r.workOrderCode} - ${r.vesselName} - ${r.title} (${r.executedBy})`)
      : ["  No se cerro ninguna orden de trabajo."]),
    "",
    "LO QUE QUEDO ABIERTO",
    ...d.openItems.map(i => `  - ${i.replace(/<[^>]+>/g, "")}`),
    "",
    `Abrir Mercurio CMS: ${d.appUrl}`,
    "Se envia automaticamente los viernes a las 17:00.",
  ];
  return lines.join("\n");
}
