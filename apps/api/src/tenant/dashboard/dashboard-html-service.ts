// Export HTML standalone (single file, sin JS, CSS inline) de:
//   - Dashboard (sidebar-counts + breakdown por buque)
//   - Maintenance Workload (proyección semanal)
//
// Útil para imprimir, mandar por email, archivar como evidencia. Las páginas
// vivas son SPAs con React/Recharts — esto es una versión "snapshot" sin JS.

import type { TenantAccessSession } from "../auth/session-store";
import { getSidebarCounts } from "../sidebar/sidebar-counts-service";
import { getMaintenanceWorkloadProjection } from "../maintenance-plans/maintenance-plans-service";
import { resolveTenantTime, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function htmlShell(title: string, body: string, generado: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    margin: 0; padding: 24px;
    color: #0f172a;
    background: #ffffff;
    line-height: 1.45;
  }
  h1 { font-size: 22px; margin: 0 0 6px; color: #0f172a; }
  h2 { font-size: 14px; margin: 22px 0 10px; color: #0f172a; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .sub { color: #64748b; font-size: 12px; margin-bottom: 18px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-bottom: 14px; }
  th, td { padding: 6px 8px; border: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
  th { background: #f8fafc; font-weight: 700; }
  td.right, th.right { text-align: right; font-variant-numeric: tabular-nums; }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-bottom: 16px; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; background: #f8fafc; }
  .kpi .label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
  .kpi .value { font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 2px; }
  .kpi.high   .value { color: #b91c1c; }
  .kpi.medium .value { color: #b45309; }
  .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; }
  .muted { color: #64748b; }
  @media print {
    body { padding: 12px; }
    h2 { page-break-after: avoid; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
${body}
<div class="footer">Generado por Copilot Management System — ${esc(generado)}</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard HTML
// ─────────────────────────────────────────────────────────────────────────────

interface KpiDef {
  key: string;
  label: string;
  /** Umbral arriba del cual se considera "high" (rojo) — opcional. */
  highIf?: (n: number) => boolean;
  /** Umbral arriba del cual se considera "medium" (naranja). */
  mediumIf?: (n: number) => boolean;
}

const DASHBOARD_KPIS: Array<KpiDef> = [
  { key: "workOrdersOpen",            label: "OTs abiertas",                highIf: n => n > 20, mediumIf: n => n > 5 },
  { key: "defectsOpen",               label: "Defectos abiertos",           highIf: n => n > 15, mediumIf: n => n > 3 },
  { key: "deferralsOpen",             label: "Diferimientos activos",       highIf: n => n > 10, mediumIf: n => n > 0 },
  { key: "capaOpen",                  label: "CAPA abiertas",               highIf: n => n > 10, mediumIf: n => n > 0 },
  { key: "certsExpiringOrExpired",    label: "Certificados venc./por vencer", highIf: n => n > 0 },
  { key: "nearMissOpen",              label: "Near miss abiertos",          mediumIf: n => n > 0 },
  { key: "restHoursViolations",       label: "Días con violación STCW/MLC", highIf: n => n > 0 },
  { key: "externalAuditsFindingsOpen", label: "Findings auditoría externa", highIf: n => n > 0 },
  { key: "mocOpen",                   label: "MOC en curso",                mediumIf: n => n > 0 },
  { key: "maintenancePlansOverdue",   label: "Planes vencidos",             highIf: n => n > 0 },
  { key: "fluidAnalysisCritical",     label: "Análisis fluido crítico",     highIf: n => n > 0 },
  { key: "spareRequestsPending",      label: "Solicitudes de repuestos",    mediumIf: n => n > 0 },
  { key: "checklistsOverdue",         label: "Checklists atrasados",        mediumIf: n => n > 0 },
  { key: "permitsAttention",          label: "Permisos requieren atención", highIf: n => n > 0 },
  { key: "crewCertsAttention",        label: "Certif. tripulación venc.",   highIf: n => n > 0 },
  { key: "drillsOverdue",             label: "Drills vencidos",             highIf: n => n > 0 },
  { key: "providerNcOpen",            label: "NCRs proveedor abiertas",     mediumIf: n => n > 0 },
  { key: "sparesCriticalLow",         label: "Spares críticos bajo mínimo", highIf: n => n > 0 },
];

export async function buildDashboardHtml(
  session: TenantAccessSession,
  vesselCode: string | null,
): Promise<string> {
  // Sello de generación en la hora de la EMPRESA (el servidor corre en UTC).
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const counts = await getSidebarCounts(session, vesselCode) as unknown as Record<string, number>;

  const scopeLabel = vesselCode
    ? `Buque: ${esc(vesselCode)}`
    : `Flota completa (${session.user.role === "TENANT_ADMIN" ? "todos los buques del tenant" : "buques asignados al usuario"})`;

  const kpiHtml = DASHBOARD_KPIS.map(kpi => {
    const value = counts[kpi.key] ?? 0;
    const klass = kpi.highIf?.(value)
      ? " high"
      : kpi.mediumIf?.(value)
        ? " medium"
        : "";
    return `<div class="kpi${klass}"><div class="label">${esc(kpi.label)}</div><div class="value">${value}</div></div>`;
  }).join("");

  const body = `
<h1>Dashboard — ${esc(session.tenantSlug)}</h1>
<div class="sub">${scopeLabel} · Generado ${esc(fmtDateTimeTz(new Date(), tz, locale))}</div>

<h2>Acciones requeridas</h2>
<div class="kpi-grid">
  ${kpiHtml}
</div>

<p class="muted" style="font-size:11px;">
  Esta vista es un snapshot estático. Las cifras representan el estado en el momento de exportación.
  Para datos actualizados en vivo, abrir la aplicación.
</p>
`;
  return htmlShell(`Dashboard — ${session.tenantSlug}`, body, fmtDateTimeTz(new Date(), tz, locale));
}

// ─────────────────────────────────────────────────────────────────────────────
// Maintenance Workload HTML
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Line chart SVG inline (sin JS) de "tareas por semana", réplica estática del
 * gráfico Recharts de la página viva. Tema claro, coherente con htmlShell.
 */
function workloadChartSvg(
  weeks: Array<{ weekStart: string; taskCount: number }>,
): string {
  if (weeks.length === 0) return "";
  const W = 960, H = 340;
  const mL = 40, mR = 16, mT = 16, mB = 44;
  const plotW = W - mL - mR;
  const plotH = H - mT - mB;
  const n = weeks.length;

  const rawMax = Math.max(...weeks.map(w => w.taskCount), 0);
  const maxY = Math.max(4, Math.ceil(rawMax / 4) * 4);

  const x = (i: number) => mL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => mT + plotH - (v / maxY) * plotH;

  // Grilla + labels Y (5 líneas: 0..maxY)
  const yTicks = [0, 1, 2, 3, 4].map(k => (maxY / 4) * k);
  const grid = yTicks.map(v => {
    const yy = y(v).toFixed(1);
    return `<line x1="${mL}" y1="${yy}" x2="${W - mR}" y2="${yy}" stroke="#e2e8f0" stroke-width="1"/>`
      + `<text x="${mL - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#94a3b8">${v}</text>`;
  }).join("");

  // Labels X (~12 marcas máximo, dd/mm)
  const step = Math.max(1, Math.ceil(n / 12));
  const xLabels = weeks.map((w, i) => {
    if (i % step !== 0 && i !== n - 1) return "";
    const d = w.weekStart.slice(0, 10);
    const [, mm, dd] = d.split("-");
    const lbl = dd && mm ? `${dd}/${mm}` : esc(d);
    return `<text x="${x(i).toFixed(1)}" y="${H - mB + 16}" text-anchor="middle" font-size="10" fill="#94a3b8">${lbl}</text>`;
  }).join("");

  // Línea + marcadores
  const pts = weeks.map((w, i) => `${x(i).toFixed(1)},${y(w.taskCount).toFixed(1)}`).join(" ");
  const dots = weeks.map((w, i) =>
    w.taskCount > 0
      ? `<circle cx="${x(i).toFixed(1)}" cy="${y(w.taskCount).toFixed(1)}" r="2.5" fill="#0284c7"/>`
      : "").join("");

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Tareas por semana" style="max-width:100%;height:auto;">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
  ${grid}
  <line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT + plotH}" stroke="#cbd5e1" stroke-width="1"/>
  <line x1="${mL}" y1="${mT + plotH}" x2="${W - mR}" y2="${mT + plotH}" stroke="#cbd5e1" stroke-width="1"/>
  <polyline fill="none" stroke="#0284c7" stroke-width="1.5" points="${pts}"/>
  ${dots}
  ${xLabels}
</svg>`;
}

export async function buildWorkloadHtml(
  session: TenantAccessSession,
  vesselCode: string | null,
  weeks: number,
): Promise<string> {
  // Sello de generación en la hora de la EMPRESA (el servidor corre en UTC).
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const proj = await getMaintenanceWorkloadProjection(session, { vesselCode, weeks }) as unknown as {
    weeks: Array<{ weekStart: string; taskCount: number; dateBased: number; hoursBased: number; laborHours: number }>;
    totalPlans: number;
    projectedPlans: number;
    unscheduledHoursPlans: number;
    unscheduledDatePlans: number;
    plansWithoutEstimate: number;
    overduePlans: number;
    overdueHours: number;
  };

  const totalTasks = proj.weeks.reduce((s, w) => s + w.taskCount, 0);
  const totalLabor = proj.weeks.reduce((s, w) => s + w.laborHours, 0);

  const scopeLabel = vesselCode ? `Buque: ${esc(vesselCode)}` : "Flota completa";

  const rows = proj.weeks.map(w => `
    <tr>
      <td>${esc(w.weekStart)}</td>
      <td class="right">${w.taskCount}</td>
      <td class="right">${w.dateBased}</td>
      <td class="right">${w.hoursBased}</td>
      <td class="right">${w.laborHours.toFixed(1)}</td>
    </tr>`).join("");

  const body = `
<h1>Carga de Mantenimiento</h1>
<div class="sub">${scopeLabel} · Ventana ${weeks} semanas · Generado ${esc(fmtDateTimeTz(new Date(), tz, locale))}</div>

<h2>Resumen</h2>
<div class="kpi-grid">
  <div class="kpi"><div class="label">Planes totales</div><div class="value">${proj.totalPlans}</div></div>
  <div class="kpi"><div class="label">Proyectados</div><div class="value">${proj.projectedPlans}</div></div>
  <div class="kpi"><div class="label">Vencidos (backlog)</div><div class="value">${proj.overduePlans}</div></div>
  <div class="kpi"><div class="label">Sin horas pico</div><div class="value">${proj.unscheduledHoursPlans}</div></div>
  <div class="kpi"><div class="label">Sin fecha</div><div class="value">${proj.unscheduledDatePlans}</div></div>
  <div class="kpi"><div class="label">Sin estimación</div><div class="value">${proj.plansWithoutEstimate}</div></div>
  <div class="kpi"><div class="label">Total tareas (ventana)</div><div class="value">${totalTasks}</div></div>
  <div class="kpi"><div class="label">Total hs-hombre</div><div class="value">${totalLabor.toFixed(1)}</div></div>
</div>

<h2>Tareas por semana</h2>
<div class="sub" style="margin-bottom:8px;">Suma de ocurrencias proyectadas — próximas ${weeks} semanas.</div>
<div style="border:1px solid #e2e8f0;border-radius:6px;padding:8px;margin-bottom:16px;">
  ${workloadChartSvg(proj.weeks)}
</div>

<h2>Distribución semanal</h2>
<table>
  <thead>
    <tr>
      <th>Semana</th>
      <th class="right">Tareas</th>
      <th class="right">Por fecha</th>
      <th class="right">Por horas</th>
      <th class="right">Hs-hombre</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>
`;
  return htmlShell(`Carga de Mantenimiento — ${session.tenantSlug}`, body, fmtDateTimeTz(new Date(), tz, locale));
}
