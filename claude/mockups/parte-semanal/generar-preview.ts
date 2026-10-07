// Preview V1 del parte semanal rediseñado. Genera los dos correos (lunes y
// viernes) con DATOS REALES de la base local, en HTML apto para correo
// (tablas + estilos en línea: Outlook usa el motor de Word).
//
// Correr:  npx tsx --env-file=.env claude/mockups/parte-semanal/generar-preview.ts
// Salida:  claude/mockups/parte-semanal/preview-v1-lunes.html / -viernes.html
//
// No toca producción: sólo lee con los mismos listados que usa el parte real.

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT_DIR = resolve("claude/mockups/parte-semanal");

// ── Paleta (misma familia que el parte actual, con más aire) ────────────────
const NAVY = "#12305F";
const NAVY_2 = "#1F4A8A";
const INK = "#15213A";
const MUTED = "#5E6B82";
const PAPER = "#EEF2F7";
const CARD = "#FFFFFF";
const RULE = "#E1E7EF";
const SOFT = "#F6F8FB";
const CRIT = "#B42318"; const CRIT_BG = "#FDECEA";
const WARN = "#B26A00"; const WARN_BG = "#FFF4E0";
const OK = "#157A55";   const OK_BG = "#E6F5EE";
const SANS = "'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif";

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Tone = "crit" | "warn" | "ok" | "plain";
const toneFg = (t: Tone) => t === "crit" ? CRIT : t === "warn" ? WARN : t === "ok" ? OK : INK;
const toneBg = (t: Tone) => t === "crit" ? CRIT_BG : t === "warn" ? WARN_BG : t === "ok" ? OK_BG : SOFT;

function chip(text: string, tone: Tone): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${toneBg(tone)};color:${toneFg(tone)};`
    + `font:700 11px/1.6 ${SANS};white-space:nowrap;">${esc(text)}</span>`;
}
function dot(tone: Tone): string {
  return `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${toneFg(tone)};"></span>`;
}
/** Barra horizontal con tablas (lo único que respeta Outlook). */
function bar(value: number, max: number, tone: Tone, width = 120): string {
  const w = max > 0 ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * width)) : 0;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>`
    + (w > 0 ? `<td width="${w}" height="8" style="background:${toneFg(tone)};border-radius:4px;font-size:0;line-height:0;">&nbsp;</td>` : "")
    + `<td width="${width - w}" height="8" style="background:${RULE};border-radius:4px;font-size:0;line-height:0;">&nbsp;</td>`
    + `</tr></table>`;
}
function progress(pct: number, tone: Tone): string {
  const w = Math.max(0, Math.min(100, Math.round(pct)));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>`
    + (w > 0 ? `<td width="${w}%" height="14" style="background:${toneFg(tone)};border-radius:7px 0 0 7px;font-size:0;">&nbsp;</td>` : "")
    + (w < 100 ? `<td width="${100 - w}%" height="14" style="background:${RULE};border-radius:${w > 0 ? "0 7px 7px 0" : "7px"};font-size:0;">&nbsp;</td>` : "")
    + `</tr></table>`;
}

function section(title: string, subtitle: string | null, body: string): string {
  return `<tr><td style="padding:22px 28px 6px;">`
    + `<div style="font:800 15px/1.3 ${SANS};color:${INK};">${esc(title)}</div>`
    + (subtitle ? `<div style="font:400 12.5px/1.5 ${SANS};color:${MUTED};padding-top:3px;">${esc(subtitle)}</div>` : "")
    + `</td></tr><tr><td style="padding:10px 28px 4px;">${body}</td></tr>`;
}
function emptyState(text: string): string {
  return `<div style="padding:14px 16px;border:1px dashed ${RULE};border-radius:10px;font:400 13px/1.5 ${SANS};color:${MUTED};">${esc(text)}</div>`;
}

interface Kpi { value: string | number; label: string; hint: string; tone: Tone }
function kpiGrid(kpis: Kpi[]): string {
  const cells = kpis.map(k =>
    `<td width="33.33%" valign="top" style="padding:6px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${CARD};border:1px solid ${RULE};border-top:4px solid ${toneFg(k.tone)};border-radius:10px;">`
    + `<tr><td style="padding:12px 14px 12px;">`
    + `<div style="font:800 28px/1 ${SANS};color:${toneFg(k.tone)};letter-spacing:-.02em;">${esc(k.value)}</div>`
    + `<div style="font:700 12px/1.3 ${SANS};color:${INK};padding-top:6px;">${esc(k.label)}</div>`
    + `<div style="font:400 11px/1.4 ${SANS};color:${MUTED};padding-top:2px;">${esc(k.hint)}</div>`
    + `</td></tr></table></td>`);
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 3) rows.push(`<tr>${cells.slice(i, i + 3).join("")}</tr>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 -6px;">${rows.join("")}</table>`;
}

function shell(opts: { eyebrow: string; title: string; period: string; greeting: string; summary: string; body: string; appUrl: string }): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${esc(opts.title)}</title></head>`
    + `<body style="margin:0;padding:0;background:${PAPER};">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};"><tr><td align="center" style="padding:24px 12px;">`
    + `<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:${CARD};border-radius:14px;overflow:hidden;border:1px solid ${RULE};">`
    // Banda superior
    + `<tr><td style="background:${NAVY};background-image:linear-gradient(135deg,${NAVY} 0%,${NAVY_2} 100%);padding:26px 28px 24px;">`
    + `<div style="font:700 11px/1.4 ${SANS};color:#A9C4EE;letter-spacing:.14em;text-transform:uppercase;">${esc(opts.eyebrow)}</div>`
    + `<div style="font:800 26px/1.2 ${SANS};color:#FFFFFF;padding-top:6px;">${esc(opts.title)}</div>`
    + `<div style="font:400 13px/1.5 ${SANS};color:#D6E3F7;padding-top:4px;">${esc(opts.period)}</div>`
    + `</td></tr>`
    // Saludo + resumen
    + `<tr><td style="padding:24px 28px 4px;">`
    + `<div style="font:400 15px/1.55 ${SANS};color:${INK};">${esc(opts.greeting)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-collapse:separate;background:${SOFT};border-left:4px solid ${NAVY_2};border-radius:8px;">`
    + `<tr><td style="padding:12px 16px;font:400 14px/1.55 ${SANS};color:${INK};"><b style="color:${NAVY};">En una línea:</b> ${opts.summary}</td></tr></table>`
    + `</td></tr>`
    + opts.body
    // Botón
    + `<tr><td align="center" style="padding:26px 28px 8px;">`
    + `<a href="${esc(opts.appUrl)}" style="display:inline-block;background:${NAVY_2};color:#FFFFFF;text-decoration:none;font:700 14px/1 ${SANS};padding:14px 26px;border-radius:10px;">Abrir CMS3.0</a>`
    + `</td></tr>`
    // Pie
    + `<tr><td style="padding:18px 28px 24px;font:400 11.5px/1.6 ${SANS};color:${MUTED};border-top:1px solid ${RULE};">`
    + `Este parte lo arma CMS3.0 solo, con los datos cargados en el sistema al momento de enviarlo. `
    + `Los números los calcula el sistema; no hay interpretación de IA. Te llega porque estás en la lista de destinatarios `
    + `del parte semanal (Configuración → Parte semanal por correo).`
    + `</td></tr>`
    + `</table></td></tr></table></body></html>`;
}

// ── Datos ────────────────────────────────────────────────────────────────────

async function main() {
  process.chdir(join(process.cwd(), "apps", "api"));
  const { listTenantVessels } = await import("../../../apps/api/src/tenant/vessels/vessels-service") as any;
  const { listTenantMaintenancePlans } = await import("../../../apps/api/src/tenant/maintenance-plans/maintenance-plans-service") as any;
  const { listTenantWorkOrders } = await import("../../../apps/api/src/tenant/work-orders/work-orders-service") as any;
  const { listTenantDefects } = await import("../../../apps/api/src/tenant/defects/defects-service") as any;
  const { listTenantCertificates } = await import("../../../apps/api/src/tenant/certificates/certificates-service") as any;

  const session = { kind: "tenant", tenantSlug: "mercurio", accessToken: "x", refreshToken: "x",
    accessTokenExpiresAt: new Date(Date.now() + 3600e3).toISOString(),
    user: { id: "system", email: "s@l", role: "TENANT_ADMIN", assignedVesselCodes: [], locale: "es" } };

  const [vessels, plans, wos, defects, certs] = await Promise.all([
    listTenantVessels(session), listTenantMaintenancePlans(session, {}), listTenantWorkOrders(session, {}),
    listTenantDefects(session, {}), listTenantCertificates(session, {}),
  ]) as any[][];

  const nameOf = new Map<string, string>(vessels.map((v: any) => [v.code, v.name || v.code]));
  const vName = (c: string) => nameOf.get(c) ?? c;
  const fmt = (d: Date | string) => new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  const fmtLong = (d: Date | string) => new Date(d).toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit" });
  const DAY = 86400000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const inDays = (n: number) => new Date(today.getTime() + n * DAY);

  const active = plans.filter((p: any) => p.status === "ACTIVE");
  const overdue = active.filter((p: any) => p.nextDueDate && new Date(p.nextDueDate) < today);
  const openWos = wos.filter((w: any) => w.status === "PLANNED" || w.status === "IN_PROGRESS");
  const openDefects = defects.filter((d: any) => d.status !== "CLOSED");
  const certsSoon = certs.filter((c: any) => c.expiryDate && new Date(c.expiryDate) >= today && new Date(c.expiryDate) < inDays(30))
    .sort((a: any, b: any) => +new Date(a.expiryDate) - +new Date(b.expiryDate));
  const SEV = ["CRITICAL", "HIGH", "MAJOR", "MEDIUM", "MODERATE", "MINOR", "LOW"];
  const sevRank = (s: string) => { const i = SEV.indexOf(String(s ?? "").toUpperCase()); return i < 0 ? 99 : i; };
  const sevLabel: Record<string, string> = { CRITICAL: "Crítico", HIGH: "Alto", MAJOR: "Mayor", MEDIUM: "Medio", MODERATE: "Moderado", MINOR: "Menor", LOW: "Bajo" };
  const sevTone = (s: string): Tone => sevRank(s) <= 1 ? "crit" : sevRank(s) <= 4 ? "warn" : "plain";
  const riskTone = (r: string): Tone => /CRIT|HIGH/i.test(r) ? "crit" : /MED/i.test(r) ? "warn" : "plain";
  const riskLbl: Record<string, string> = { CRITICAL: "Crítico", HIGH: "Alto", MEDIUM: "Medio", LOW: "Bajo" };
  const appUrl = "https://mercurio.cms3.shipcms.cloud/";

  // ── LUNES ──────────────────────────────────────────────────────────────────
  const dueWeek = active.filter((p: any) => p.nextDueDate && new Date(p.nextDueDate) >= today && new Date(p.nextDueDate) < inDays(7))
    .sort((a: any, b: any) => +new Date(a.nextDueDate) - +new Date(b.nextDueDate));

  const perVessel = vessels.map((v: any) => {
    const c = v.code;
    const o = overdue.filter((p: any) => p.vesselCode === c).length;
    const w = dueWeek.filter((p: any) => p.vesselCode === c).length;
    const ot = openWos.filter((x: any) => x.vesselCode === c).length;
    const df = openDefects.filter((x: any) => x.vesselCode === c).length;
    const tone: Tone = o >= 5 ? "crit" : (o > 0 || df > 0) ? "warn" : "ok";
    return { name: vName(c), o, w, ot, df, tone };
  }).filter((r: any) => r.o + r.w + r.ot + r.df > 0)
    .sort((a: any, b: any) => (b.o - a.o) || (b.df - a.df) || (b.w - a.w));
  const maxO = Math.max(1, ...perVessel.map((r: any) => r.o));

  const redCount = perVessel.filter((r: any) => r.tone === "crit").length;
  const worst = perVessel[0];
  const summaryMon = `esta semana vencen <b>${dueWeek.length} tareas</b> del plan y hay <b style="color:${CRIT};">${overdue.length} vencidas</b> de antes`
    + (worst && worst.o > 0 ? `; <b>${esc(worst.name)}</b> es el buque con más atraso (${worst.o}).` : ".")
    + (certsSoon.length ? ` Además, ${certsSoon.length} ${certsSoon.length === 1 ? "certificado vence" : "certificados vencen"} en los próximos 30 días.` : "");

  const healthTable = perVessel.length === 0 ? emptyState("Ningún buque tiene tareas vencidas ni pendientes esta semana.") :
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font:400 13px/1.4 ${SANS};color:${INK};">`
    + `<tr style="background:${SOFT};">`
    + ["Buque", "Vencidas", "", "Esta semana", "OT abiertas", "Defectos"].map((h, i) =>
      `<td style="padding:9px 8px;font:700 10.5px/1.3 ${SANS};color:${MUTED};letter-spacing:.06em;text-transform:uppercase;${i > 0 && i !== 2 ? "text-align:center;" : ""}border-bottom:1px solid ${RULE};">${h}</td>`).join("")
    + `</tr>`
    + perVessel.slice(0, 14).map((r: any) =>
      `<tr><td style="padding:9px 8px;border-bottom:1px solid ${RULE};white-space:nowrap;">${dot(r.tone)}&nbsp;&nbsp;<b>${esc(r.name)}</b></td>`
      + `<td style="padding:9px 8px;border-bottom:1px solid ${RULE};text-align:center;font-weight:800;color:${r.o ? CRIT : MUTED};">${r.o}</td>`
      + `<td style="padding:9px 4px;border-bottom:1px solid ${RULE};">${bar(r.o, maxO, r.o >= 5 ? "crit" : "warn", 110)}</td>`
      + `<td style="padding:9px 8px;border-bottom:1px solid ${RULE};text-align:center;">${r.w || "—"}</td>`
      + `<td style="padding:9px 8px;border-bottom:1px solid ${RULE};text-align:center;">${r.ot || "—"}</td>`
      + `<td style="padding:9px 8px;border-bottom:1px solid ${RULE};text-align:center;color:${r.df ? WARN : MUTED};font-weight:${r.df ? 700 : 400};">${r.df || "—"}</td></tr>`).join("")
    + `</table>`
    + `<div style="font:400 11.5px/1.5 ${SANS};color:${MUTED};padding-top:8px;">${dot("crit")} 5 o más tareas vencidas &nbsp;&nbsp; ${dot("warn")} alguna vencida o defecto abierto &nbsp;&nbsp; ${dot("ok")} al día`
    + (perVessel.length > 14 ? ` &nbsp;·&nbsp; y ${perVessel.length - 14} buques más en el sistema` : "") + `</div>`;

  // Agenda por día
  const byDay = new Map<string, any[]>();
  for (const p of dueWeek) {
    const k = new Date(p.nextDueDate).toDateString();
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(p);
  }
  const agenda = dueWeek.length === 0 ? emptyState("No vence ninguna tarea del plan esta semana.") :
    Array.from(byDay.entries()).map(([k, items]) => {
      const head = `<tr><td colspan="3" style="padding:12px 0 6px;font:800 12px/1.3 ${SANS};color:${NAVY};text-transform:capitalize;">${esc(fmtLong(k))} <span style="color:${MUTED};font-weight:600;">· ${items.length} ${items.length === 1 ? "tarea" : "tareas"}</span></td></tr>`;
      const rows = items.slice(0, 6).map((p: any) =>
        `<tr><td style="padding:7px 10px 7px 0;border-bottom:1px solid ${RULE};width:118px;font:700 12px/1.4 ${SANS};color:${INK};white-space:nowrap;">${esc(vName(p.vesselCode))}</td>`
        + `<td style="padding:7px 10px 7px 0;border-bottom:1px solid ${RULE};font:400 13px/1.4 ${SANS};color:${INK};">${esc(p.title)}<div style="font:400 11.5px/1.4 ${SANS};color:${MUTED};">${esc(p.assetName ?? "—")} · ${esc(p.taskCode)}</div></td>`
        + `<td style="padding:7px 0;border-bottom:1px solid ${RULE};text-align:right;">${p.riskLevel ? chip(riskLbl[p.riskLevel] ?? p.riskLevel, riskTone(p.riskLevel)) : ""}</td></tr>`).join("")
        + (items.length > 6 ? `<tr><td colspan="3" style="padding:6px 0;font:400 12px/1.4 ${SANS};color:${MUTED};">y ${items.length - 6} más ese día.</td></tr>` : "");
      return head + rows;
    }).join("");
  const agendaTable = dueWeek.length === 0 ? agenda : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${agenda}</table>`;

  const certList = certsSoon.length === 0 ? emptyState("Ningún certificado vence en los próximos 30 días.") :
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`
    + certsSoon.slice(0, 8).map((c: any) => {
      const days = Math.round((+new Date(c.expiryDate) - +today) / DAY);
      const tone: Tone = days <= 7 ? "crit" : days <= 15 ? "warn" : "plain";
      return `<tr><td style="padding:8px 10px 8px 0;border-bottom:1px solid ${RULE};font:400 13px/1.4 ${SANS};color:${INK};">${esc(c.name)}<div style="font:400 11.5px/1.4 ${SANS};color:${MUTED};">${esc(vName(c.vesselCode))} · vence el ${fmt(c.expiryDate)}</div></td>`
        + `<td style="padding:8px 0;border-bottom:1px solid ${RULE};text-align:right;">${chip(days === 0 ? "Vence hoy" : `En ${days} días`, tone)}</td></tr>`;
    }).join("") + `</table>`;

  const topDefects = openDefects.slice().sort((a: any, b: any) => sevRank(a.severity) - sevRank(b.severity)).slice(0, 5);
  const defList = topDefects.length === 0 ? emptyState("No hay defectos abiertos.") :
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`
    + topDefects.map((d: any) => {
      const age = d.reportedAt ? Math.round((+today - +new Date(d.reportedAt)) / DAY) : null;
      const desc = String(d.description ?? "").replace(/\s+/g, " ").trim();
      return `<tr><td style="padding:8px 10px 8px 0;border-bottom:1px solid ${RULE};font:400 13px/1.4 ${SANS};color:${INK};">${esc(desc.length > 90 ? desc.slice(0, 88) + "…" : desc || d.defectCode)}`
        + `<div style="font:400 11.5px/1.4 ${SANS};color:${MUTED};">${esc(vName(d.vesselCode))} · ${esc(d.defectCode)} · ${age != null ? `abierto hace ${age} días` : "sin fecha de reporte"}</div></td>`
        + `<td style="padding:8px 0;border-bottom:1px solid ${RULE};text-align:right;">${chip(sevLabel[String(d.severity).toUpperCase()] ?? String(d.severity ?? "—"), sevTone(d.severity))}</td></tr>`;
    }).join("") + `</table>`;

  const monBody =
    `<tr><td style="padding:18px 22px 0;">${kpiGrid([
      { value: overdue.length, label: "Tareas vencidas", hint: "Del plan, de semanas anteriores", tone: overdue.length ? "crit" : "ok" },
      { value: dueWeek.length, label: "Vencen esta semana", hint: "Hay que ejecutarlas antes del domingo", tone: dueWeek.length ? "warn" : "plain" },
      { value: openWos.length, label: "OT abiertas", hint: "Planificadas o en ejecución", tone: "plain" },
      { value: openDefects.length, label: "Defectos abiertos", hint: "Sin cerrar en el sistema", tone: openDefects.length ? "warn" : "ok" },
      { value: certsSoon.length, label: "Certificados", hint: "Vencen en los próximos 30 días", tone: certsSoon.length ? "warn" : "ok" },
      { value: redCount, label: "Buques en rojo", hint: "Con 5 o más tareas vencidas", tone: redCount ? "crit" : "ok" },
    ])}</td></tr>`
    + section("Cómo está cada buque", "Ordenados de más a menos atrasado. El color resume el estado de un vistazo.", healthTable)
    + section("Agenda de la semana", "Las tareas del plan que vencen en los próximos 7 días, día por día.", agendaTable)
    + section("Certificados que vencen pronto", "Próximos 30 días. En rojo, los que vencen esta semana.", certList)
    + section("Defectos abiertos más importantes", "Los 5 de mayor gravedad que siguen sin cerrar.", defList);

  const lunes = shell({
    eyebrow: "Parte semanal · lunes",
    title: "Estado de la flota",
    period: `Semana del ${fmt(today)} al ${fmt(inDays(6))}`,
    greeting: "Buen día, Gustavo. Este es el panorama de la flota para arrancar la semana.",
    summary: summaryMon,
    body: monBody,
    appUrl,
  });
  writeFileSync(join(OUT_DIR, "preview-v1-lunes.html"), lunes, "utf8");

  // ── VIERNES ────────────────────────────────────────────────────────────────
  const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY);
  const tomorrow = inDays(1);
  const inWeek = (d: any) => d && new Date(d) >= monday && new Date(d) < tomorrow;
  const closed = wos.filter((w: any) => w.status === "CLOSED" && inWeek(w.completedDate))
    .sort((a: any, b: any) => +new Date(a.completedDate) - +new Date(b.completedDate));
  const deficient = closed.filter((w: any) => /DEFICIENC/i.test(String(w.woResult ?? "")));
  const sunday = new Date(monday.getTime() + 7 * DAY);
  const dueInWeek = wos.filter((w: any) => w.dueDate && new Date(w.dueDate) >= monday && new Date(w.dueDate) < sunday && w.status !== "CANCELLED");
  const dueDone = dueInWeek.filter((w: any) => w.status === "CLOSED").length;
  const compliance = dueInWeek.length ? (dueDone * 100) / dueInWeek.length : 100;
  const newDefs = defects.filter((d: any) => inWeek(d.reportedAt));
  const nextWeek = active.filter((p: any) => p.nextDueDate && new Date(p.nextDueDate) >= inDays(3) && new Date(p.nextDueDate) < inDays(10));

  const summaryFri = closed.length
    ? `se cerraron <b style="color:${OK};">${closed.length} órdenes de trabajo</b>`
      + (deficient.length ? `, ${deficient.length} con deficiencias` : ", todas satisfactorias")
      + `. De lo que vencía esta semana está cerrado el <b>${Math.round(compliance)}%</b>.`
    : `esta semana no se cerró ninguna orden de trabajo en el sistema. Quedan <b style="color:${CRIT};">${overdue.length} tareas vencidas</b> para la próxima.`;

  const actByVessel = vessels.map((v: any) => {
    const c = v.code;
    const cl = closed.filter((w: any) => w.vesselCode === c).length;
    const df = deficient.filter((w: any) => w.vesselCode === c).length;
    const nd = newDefs.filter((d: any) => d.vesselCode === c).length;
    const ov = overdue.filter((p: any) => p.vesselCode === c).length;
    return { name: vName(c), cl, df, nd, ov };
  }).filter((r: any) => r.cl + r.nd + r.ov > 0).sort((a: any, b: any) => (b.cl - a.cl) || (b.ov - a.ov));
  const maxCl = Math.max(1, ...actByVessel.map((r: any) => r.cl));

  const actTable = actByVessel.length === 0 ? emptyState("Sin actividad registrada esta semana.") :
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font:400 13px/1.4 ${SANS};color:${INK};">`
    + `<tr style="background:${SOFT};">` + ["Buque", "OT cerradas", ...(closed.length ? [""] : []), "Con deficiencias", "Defectos nuevos", "Sigue vencido"].map((h, i) =>
      `<td style="padding:9px 8px;font:700 10.5px/1.3 ${SANS};color:${MUTED};letter-spacing:.06em;text-transform:uppercase;${i > 0 && i !== 2 ? "text-align:center;" : ""}border-bottom:1px solid ${RULE};">${h}</td>`).join("") + `</tr>`
    + actByVessel.slice(0, 14).map((r: any) =>
      `<tr><td style="padding:9px 8px;border-bottom:1px solid ${RULE};white-space:nowrap;"><b>${esc(r.name)}</b></td>`
      + `<td style="padding:9px 8px;border-bottom:1px solid ${RULE};text-align:center;font-weight:800;color:${r.cl ? OK : MUTED};">${r.cl}</td>`
      + (closed.length ? `<td style="padding:9px 4px;border-bottom:1px solid ${RULE};">${bar(r.cl, maxCl, "ok", 100)}</td>` : "")
      + `<td style="padding:9px 8px;border-bottom:1px solid ${RULE};text-align:center;color:${r.df ? WARN : MUTED};">${r.df || "—"}</td>`
      + `<td style="padding:9px 8px;border-bottom:1px solid ${RULE};text-align:center;color:${r.nd ? WARN : MUTED};">${r.nd || "—"}</td>`
      + `<td style="padding:9px 8px;border-bottom:1px solid ${RULE};text-align:center;color:${r.ov ? CRIT : MUTED};font-weight:${r.ov ? 700 : 400};">${r.ov || "—"}</td></tr>`).join("")
    + `</table>`;

  const doneList = closed.length === 0 ? emptyState("No se cerró ninguna orden de trabajo esta semana.") :
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`
    + closed.slice(0, 12).map((w: any) => {
      const bad = /DEFICIENC/i.test(String(w.woResult ?? ""));
      return `<tr><td style="padding:8px 10px 8px 0;border-bottom:1px solid ${RULE};font:400 13px/1.4 ${SANS};color:${INK};">${esc(w.title)}`
        + `<div style="font:400 11.5px/1.4 ${SANS};color:${MUTED};">${esc(vName(w.vesselCode))} · ${esc(w.workOrderCode)} · ${fmt(w.completedDate)}${w.executedByName ? ` · ${esc(w.executedByName)}` : ""}</div></td>`
        + `<td style="padding:8px 0;border-bottom:1px solid ${RULE};text-align:right;">${chip(bad ? "Con deficiencias" : "Satisfactoria", bad ? "warn" : "ok")}</td></tr>`;
    }).join("")
    + (closed.length > 12 ? `<tr><td colspan="2" style="padding:8px 0;font:400 12px/1.4 ${SANS};color:${MUTED};">y ${closed.length - 12} más — el detalle completo está en el sistema.</td></tr>` : "")
    + `</table>`;

  const complianceBlock =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${SOFT};border-radius:10px;"><tr><td style="padding:16px 18px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
    + `<td style="font:800 30px/1 ${SANS};color:${toneFg(compliance >= 90 ? "ok" : compliance >= 60 ? "warn" : "crit")};width:90px;">${Math.round(compliance)}%</td>`
    + `<td style="font:400 13px/1.5 ${SANS};color:${INK};">${dueInWeek.length === 0 ? "No había órdenes de trabajo con vencimiento esta semana." : `De las <b>${dueInWeek.length}</b> ${dueInWeek.length === 1 ? "orden de trabajo" : "órdenes de trabajo"} con vencimiento esta semana, <b>${dueDone}</b> ${dueDone === 1 ? "ya está cerrada" : "ya están cerradas"} y <b>${dueInWeek.length - dueDone}</b> ${dueInWeek.length - dueDone === 1 ? "sigue abierta" : "siguen abiertas"}.`}</td></tr></table>`
    + `<div style="padding-top:12px;">${progress(compliance, compliance >= 90 ? "ok" : compliance >= 60 ? "warn" : "crit")}</div>`
    + `</td></tr></table>`;

  const newDefList = newDefs.length === 0 ? emptyState("No se reportaron defectos nuevos esta semana.") :
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`
    + newDefs.slice(0, 8).map((d: any) =>
      `<tr><td style="padding:8px 10px 8px 0;border-bottom:1px solid ${RULE};font:400 13px/1.4 ${SANS};color:${INK};">${esc(String(d.description ?? d.defectCode).replace(/\s+/g, " ").slice(0, 90))}<div style="font:400 11.5px/1.4 ${SANS};color:${MUTED};">${esc(vName(d.vesselCode))} · ${esc(d.defectCode)} · reportado el ${fmt(d.reportedAt)}</div></td>`
      + `<td style="padding:8px 0;border-bottom:1px solid ${RULE};text-align:right;">${chip(sevLabel[String(d.severity).toUpperCase()] ?? String(d.severity ?? "—"), sevTone(d.severity))}</td></tr>`).join("")
    + `</table>`;

  const friBody =
    `<tr><td style="padding:18px 22px 0;">${kpiGrid([
      { value: closed.length, label: "OT cerradas esta semana", hint: "Con fecha de cierre de lunes a hoy", tone: closed.length ? "ok" : "plain" },
      { value: `${Math.round(compliance)}%`, label: "Cumplimiento", hint: "De las OT que vencían esta semana, cuántas están cerradas", tone: compliance >= 90 ? "ok" : compliance >= 60 ? "warn" : "crit" },
      { value: deficient.length, label: "Con deficiencias", hint: "Cerradas con observaciones", tone: deficient.length ? "warn" : "ok" },
      { value: newDefs.length, label: "Defectos nuevos", hint: "Reportados esta semana", tone: newDefs.length ? "warn" : "ok" },
      { value: openWos.length, label: "OT abiertas", hint: "Pasan a la semana próxima", tone: "plain" },
      { value: overdue.length, label: "Sigue vencido", hint: "Tareas del plan atrasadas", tone: overdue.length ? "crit" : "ok" },
    ])}</td></tr>`
    + section("Cumplimiento de la semana", null, complianceBlock)
    + section("Actividad por buque", "Qué se cerró, qué apareció y qué sigue pendiente en cada buque.", actTable)
    + section("Lo que se ejecutó", "Órdenes de trabajo cerradas esta semana.", doneList)
    + section("Defectos nuevos", "Reportados de lunes a hoy.", newDefList)
    + section("Lo que viene", `La semana próxima vencen ${nextWeek.length} tareas del plan. El lunes llega el detalle día por día.`, "");

  const viernes = shell({
    eyebrow: "Parte semanal · viernes",
    title: "Cierre de semana",
    period: `Semana del ${fmt(monday)} al ${fmt(today)}`,
    greeting: "Buenas tardes, Gustavo. Así cerró la semana en la flota.",
    summary: summaryFri,
    body: friBody,
    appUrl,
  });
  writeFileSync(join(OUT_DIR, "preview-v1-viernes.html"), viernes, "utf8");

  process.stdout.write(`lunes: ${dueWeek.length} esta semana, ${overdue.length} vencidas, ${perVessel.length} buques | viernes: ${closed.length} cerradas, cumplimiento ${Math.round(compliance)}%\n`);
  process.exit(0);
}
main().catch(e => { process.stderr.write(String(e?.stack ?? e) + "\n"); process.exit(1); });
