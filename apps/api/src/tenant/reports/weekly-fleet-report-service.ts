// PARTE SEMANAL DE FLOTA — armado de los dos correos automaticos.
//
//   · Lunes  (WEEKLY_OPENING): como esta la flota y que vence en la semana.
//   · Viernes (WEEKLY_CLOSING): que se ejecuto y que quedo abierto.
//
// No escribe consultas propias: reutiliza los mismos services que alimentan las
// pantallas, para que el correo y el sistema nunca digan numeros distintos.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { resolveTenantTime, fmtDate } from "../../common/tenant-time";
import { listTenantVessels } from "../vessels/vessels-service";
import { listTenantMaintenancePlans } from "../maintenance-plans/maintenance-plans-service";
import { listTenantWorkOrders } from "../work-orders/work-orders-service";
import { listTenantDefects } from "../defects/defects-service";
import { listTenantCertificates } from "../certificates/certificates-service";
import {
  renderOpeningHtml, renderOpeningText,
  renderClosingHtml, renderClosingText,
  type ReportKpi, type ReportTaskRow, type ReportDoneRow, type ReportBarRow,
} from "./weekly-fleet-report-html";

export type WeeklyReportKind = "WEEKLY_OPENING" | "WEEKLY_CLOSING";

export interface BuiltReport {
  subject: string;
  html: string;
  text: string;
}

/** Cuantos dias hacia adelante mira el parte del lunes. */
const LOOKAHEAD_DAYS = 7;
/** Tope de filas en las tablas: un correo con 300 filas no lo lee nadie. */
const MAX_TABLE_ROWS = 25;
/** Cuantos buques entran en el ranking de atraso. */
const MAX_BACKLOG_BARS = 8;
/** Ventana del aviso de certificados proximos a vencer. */
const CERT_WARNING_DAYS = 30;

/**
 * Sesion sintetica para los jobs automaticos.
 *
 * Los services de listado piden un `TenantAccessSession` porque aplican el scope
 * por buque del usuario. Un job no tiene usuario, asi que se arma el objeto a
 * mano con rol TENANT_ADMIN (unico que ve la flota completa).
 *
 * Deliberadamente NO se exporta y NO se registra en `session-store`: no es un
 * token valido, no sirve para autenticar nada y no puede llegar a una ruta HTTP.
 * Existe solo para no tener que duplicar aca las consultas filtradas por tenant,
 * que es exactamente donde se colaria una fuga entre empresas.
 */
function buildSystemSession(tenantSlug: string): TenantAccessSession {
  return {
    kind: "tenant",
    tenantSlug,
    accessToken: "system-scheduler",
    refreshToken: "system-scheduler",
    accessTokenExpiresAt: new Date(0).toISOString(),
    user: {
      id: "system",
      email: "system@local",
      firstName: "Sistema",
      lastName: null,
      role: "TENANT_ADMIN",
      assignedVesselCodes: [],
      locale: "es",
      permissions: [],
    },
  } as TenantAccessSession;
}

// ── Calendario en la hora de la empresa ─────────────────────────────────────
// El proceso corre en UTC. Sin esto, "lunes 07:00" seria las 03:00 en Paraguay.

export interface LocalNow {
  year: number;
  month: number;
  day: number;
  /** 1 = lunes … 7 = domingo. */
  weekday: number;
  hour: number;
  tz: string;
}

export function localNow(now: Date, tz: string): LocalNow {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hour12: false, weekday: "short",
    }).formatToParts(now);
  } catch {
    // Zona horaria mal cargada: se sigue en UTC en vez de romper el job.
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hour12: false, weekday: "short",
    }).formatToParts(now);
    tz = "UTC";
  }
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const wd = get("weekday").toLowerCase();
  const map: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: map[wd.slice(0, 3)] ?? 1,
    // "24" es medianoche en algunos locales de Intl.
    hour: Number(get("hour")) % 24,
    tz,
  };
}

/** Medianoche UTC del dia local. Las fechas de calendario se guardan asi. */
function dayStart(l: LocalNow, offsetDays = 0): Date {
  return new Date(Date.UTC(l.year, l.month - 1, l.day + offsetDays));
}

/**
 * Semana ISO del dia local, "2026-W35". Junto al tipo de parte identifica el
 * envio, y es lo que impide mandar dos veces el mismo correo.
 */
export function isoWeekKey(l: LocalNow): string {
  const d = new Date(Date.UTC(l.year, l.month - 1, l.day));
  // Jueves de la misma semana: define el año ISO.
  d.setUTCDate(d.getUTCDate() + 4 - l.weekday);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── Armado ──────────────────────────────────────────────────────────────────

const riskLabel = (v: unknown): string => {
  const s = String(v ?? "").toUpperCase();
  if (s === "HIGH" || s === "ALTO" || s === "ALTA") return "Alta";
  if (s === "LOW" || s === "BAJO" || s === "BAJA") return "Baja";
  if (s === "MEDIUM" || s === "MEDIO" || s === "MEDIA") return "Media";
  return "—";
};

function appBaseUrl(tenantSlug: string): string {
  const configured = String(process.env.APP_PUBLIC_BASE_URL ?? "").trim();
  if (configured) return configured.replace(/\/+$/, "") + "/";
  return `https://${tenantSlug}.cms3.shipcms.cloud/`;
}

/** El logo del masthead va sobre azul oscuro: se prefiere la version clara. */
async function resolveLogo(tenantSlug: string, base: string): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { settings: { select: { logoUrl: true, logoUrlLight: true } } },
    });
    const path = tenant?.settings?.logoUrlLight || tenant?.settings?.logoUrl;
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    return base.replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "");
  } catch {
    return null;
  }
}

/**
 * Arma el parte.
 *
 * `viewerSession` es la clave del alcance: cuando se pasa la sesion real de
 * quien esta mirando la pantalla, los listados aplican SU scope por buque
 * (`applyAssignedVesselScope`), asi que un tripulante ve solo sus buques y no
 * la flota entera. El job automatico no tiene usuario y pasa `null`: ahi si se
 * usa la sesion de sistema, y por eso el parte archivado es de flota completa
 * y solo lo puede abrir quien ve toda la flota.
 */
export async function buildWeeklyFleetReport(
  tenantSlug: string,
  kind: WeeklyReportKind,
  now: Date = new Date(),
  greetingName: string | null = null,
  viewerSession: TenantAccessSession | null = null,
): Promise<BuiltReport> {
  const session = viewerSession ?? buildSystemSession(tenantSlug);
  const { tz, locale } = await resolveTenantTime(tenantSlug);
  const l = localNow(now, tz);
  const base = appBaseUrl(tenantSlug);
  const logoUrl = await resolveLogo(tenantSlug, base);

  const [vessels, plans, workOrders, defects, certificates] = await Promise.all([
    listTenantVessels(session),
    listTenantMaintenancePlans(session),
    listTenantWorkOrders(session),
    listTenantDefects(session),
    listTenantCertificates(session),
  ]);

  const vesselName = new Map<string, string>();
  for (const v of vessels as Array<{ code?: string; name?: string }>) {
    if (v.code) vesselName.set(v.code, v.name || v.code);
  }
  // Regla del proyecto: en documentos va el NOMBRE del buque, nunca el codigo.
  const nameOf = (code: unknown): string => vesselName.get(String(code ?? "")) ?? String(code ?? "—");

  const today = dayStart(l);
  const activePlans = (plans as Array<Record<string, any>>).filter(p => p.status === "ACTIVE");

  const overdue = activePlans.filter(p => p.nextDueDate && new Date(p.nextDueDate) < today);
  const openWos = (workOrders as Array<Record<string, any>>)
    .filter(w => w.status === "PLANNED" || w.status === "IN_PROGRESS");
  const openDefects = (defects as Array<Record<string, any>>).filter(d => d.status !== "CLOSED");

  const certLimit = dayStart(l, CERT_WARNING_DAYS);
  const expiringCerts = (certificates as Array<Record<string, any>>).filter(c => {
    if (!c.expiryDate) return false;
    const exp = new Date(c.expiryDate);
    return exp >= today && exp < certLimit;
  });

  const dateline = fmtDate(now, tz, locale);

  if (kind === "WEEKLY_OPENING") {
    const windowEnd = dayStart(l, LOOKAHEAD_DAYS);
    const dueThisWeek = activePlans
      .filter(p => p.nextDueDate && new Date(p.nextDueDate) >= today && new Date(p.nextDueDate) < windowEnd)
      .sort((a, b) => new Date(a.nextDueDate).getTime() - new Date(b.nextDueDate).getTime());

    const byVessel = new Map<string, number>();
    for (const p of overdue) byVessel.set(p.vesselCode, (byVessel.get(p.vesselCode) ?? 0) + 1);
    const bars: ReportBarRow[] = Array.from(byVessel.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_BACKLOG_BARS)
      .map(([code, value]) => ({ label: nameOf(code), value }));

    const top4 = bars.slice(0, 4).reduce((s, b) => s + b.value, 0);
    const backlogNote = overdue.length > 0
      ? `Planes vencidos por buque. Los primeros cuatro concentran el ${Math.round((top4 * 100) / overdue.length)}%.`
      : "";

    const kpis: ReportKpi[] = [
      { value: vessels.length, label: "Buques" },
      { value: overdue.length, label: "Planes vencidos", tone: overdue.length > 0 ? "crit" : "ok" },
      { value: dueThisWeek.length, label: "Vencen esta semana", tone: dueThisWeek.length > 0 ? "warn" : "plain" },
      { value: openWos.length, label: "OT abiertas" },
      { value: openDefects.length, label: "Defectos abiertos", tone: openDefects.length > 0 ? "warn" : "plain" },
      { value: expiringCerts.length, label: `Certificados < ${CERT_WARNING_DAYS} días`, tone: expiringCerts.length > 0 ? "warn" : "plain" },
    ];

    const tasks: ReportTaskRow[] = dueThisWeek.slice(0, MAX_TABLE_ROWS).map(p => ({
      vesselName: nameOf(p.vesselCode),
      taskCode: String(p.taskCode ?? ""),
      title: String(p.title ?? ""),
      assetName: String(p.assetName ?? "—"),
      dueLabel: fmtDate(p.nextDueDate, tz, locale),
      riskLabel: riskLabel(p.riskLevel),
    }));

    const data = {
      greetingName,
      dateline,
      weekLabel: `${fmtDate(today, tz, locale)} al ${fmtDate(dayStart(l, LOOKAHEAD_DAYS - 1), tz, locale)}`,
      kpis, backlogBars: bars, backlogNote, tasks, logoUrl, appUrl: base,
    };
    return {
      subject: `Estado de flota · ${dueThisWeek.length} ${dueThisWeek.length === 1 ? "tarea vence" : "tareas vencen"} esta semana`,
      html: renderOpeningHtml(data),
      text: renderOpeningText(data),
    };
  }

  // ── Viernes ───────────────────────────────────────────────────────────────
  const weekStart = dayStart(l, 1 - l.weekday);   // lunes de la semana local
  const weekEnd = dayStart(l, 1);                 // hasta el final de hoy
  const closed = (workOrders as Array<Record<string, any>>)
    .filter(w => {
      if (w.status !== "CLOSED" || !w.completedDate) return false;
      const d = new Date(w.completedDate);
      return d >= weekStart && d < weekEnd;
    })
    .sort((a, b) => new Date(a.completedDate).getTime() - new Date(b.completedDate).getTime());

  const okCount = closed.filter(w => !/DEFICIENC/i.test(String(w.woResult ?? ""))).length;
  const vesselsTouched = new Set(closed.map(w => w.vesselCode)).size;
  const newDefects = (defects as Array<Record<string, any>>).filter(d => {
    if (!d.reportedAt) return false;
    const r = new Date(d.reportedAt);
    return r >= weekStart && r < weekEnd;
  }).length;

  const kpis: ReportKpi[] = [
    { value: closed.length, label: "OT cerradas", tone: closed.length > 0 ? "ok" : "plain" },
    { value: vesselsTouched, label: "Buques con actividad" },
    { value: okCount, label: "Sin deficiencias", tone: "ok" },
    { value: newDefects, label: "Defectos nuevos", tone: newDefects > 0 ? "warn" : "plain" },
    { value: openWos.length, label: "OT abiertas" },
    { value: overdue.length, label: "Sigue vencido", tone: overdue.length > 0 ? "crit" : "ok" },
  ];

  const done: ReportDoneRow[] = closed.slice(0, MAX_TABLE_ROWS).map(w => {
    const deficient = /DEFICIENC/i.test(String(w.woResult ?? ""));
    return {
      workOrderCode: String(w.workOrderCode ?? ""),
      vesselName: nameOf(w.vesselCode),
      title: String(w.title ?? ""),
      assetName: String(w.assetName ?? "—"),
      dateLabel: fmtDate(w.completedDate, tz, locale),
      executedBy: String(w.executedByName || "—"),
      resultLabel: deficient ? "Con deficiencias" : "Satisfactorio",
      resultOk: !deficient,
    };
  });

  const overdueByVessel = new Map<string, number>();
  for (const p of overdue) {
    const code = String(p.vesselCode ?? "");
    overdueByVessel.set(code, (overdueByVessel.get(code) ?? 0) + 1);
  }
  const worst = Array.from(overdueByVessel.entries()).sort((a, b) => b[1] - a[1])[0];

  const openItems: string[] = [
    overdue.length > 0
      ? `<strong style="color:#A32B2B;">${overdue.length} planes vencidos</strong> en la flota.`
        + (worst ? ` ${nameOf(worst[0])} concentra ${worst[1]}.` : "")
      : "Ningún plan vencido en la flota.",
    `<strong>${openWos.length} OT abiertas</strong> y <strong>${openDefects.length} defectos</strong> sin cerrar.`,
    expiringCerts.length > 0
      ? `<strong>${expiringCerts.length} ${expiringCerts.length === 1 ? "certificado vence" : "certificados vencen"}</strong> dentro de los próximos ${CERT_WARNING_DAYS} días.`
      : `Ningún certificado vence en los próximos ${CERT_WARNING_DAYS} días.`,
  ];

  const data = {
    greetingName,
    dateline,
    weekLabel: `${fmtDate(weekStart, tz, locale)} al ${fmtDate(today, tz, locale)}`,
    kpis, done, openItems, logoUrl, appUrl: base,
  };
  return {
    subject: `Cierre de semana · ${closed.length} ${closed.length === 1 ? "OT cerrada" : "OT cerradas"}`,
    html: renderClosingHtml(data),
    text: renderClosingText(data),
  };
}
