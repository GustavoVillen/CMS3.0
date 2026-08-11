// Reporte Excel de planes de mantenimiento PRÓXIMOS A VENCER.
//
// Incluye: VENCIDOS (OVERDUE), POR VENCER (DUE), EN VENTANA (IN_WINDOW) y
// SIN EJECUTAR (NEVER_EXECUTED). Se replica la MISMA función computeStatus de la
// página de Planes (apps/web-modern/src/pages/MaintenancePlans.tsx) para que el
// criterio coincida exactamente con lo que ve el usuario en pantalla — el
// executionStatus del backend no produce NEVER_EXECUTED (se deriva en el front).
//
// Columnas: Estado · Embarcación · TaskID · Equipo · Tarea · Tareas a realizar · Frecuencia · Vencimiento.

import ExcelJS from "exceljs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listTenantMaintenancePlans } from "../maintenance-plans/maintenance-plans-service";
import { resolveTenantTime, fmtDate as fmtDateTz } from "../../common/tenant-time";

// Estados que entran al reporte.
const INCLUDED_STATUSES = new Set(["OVERDUE", "DUE", "IN_WINDOW", "NEVER_EXECUTED"]);
// Orden de aparición (más urgente primero).
const STATUS_ORDER: Record<string, number> = { OVERDUE: 0, DUE: 1, IN_WINDOW: 2, NEVER_EXECUTED: 3 };

// Espejo de computeStatus del front (MaintenancePlans.tsx): ventanas fijas + prioridad.
function computePlanStatus(p: any): string {
  if (p.executionStatus === "IN_WINDOW") return "IN_WINDOW";
  const neverExecuted = p.lastExecutionDate == null && p.lastExecutionHours == null;
  if (p.nextDueHours != null) {
    const diff = p.nextDueHours - (p.assetCurrentHours ?? 0);
    if (diff <= 0) return "OVERDUE";
    if (neverExecuted) return "NEVER_EXECUTED";
    if (diff <= 50) return "DUE";
    if (diff <= 250) return "UPCOMING";
    return "FUTURE";
  }
  if (p.nextDueDate) {
    const due = new Date(p.nextDueDate);
    const dueMid = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const daysLeft = Math.round((dueMid.getTime() - today.getTime()) / 86_400_000);
    if (daysLeft < 0) return "OVERDUE";
    if (neverExecuted) return "NEVER_EXECUTED";
    if (daysLeft <= 7) return "DUE";
    if (daysLeft <= 30) return "UPCOMING";
    return "FUTURE";
  }
  if (neverExecuted) return "NEVER_EXECUTED";
  return p.executionStatus ?? "FUTURE";
}

function formatFrequency(frequencyMonths: number | null, frequencyHours: number | null, triggerType: string): string {
  if (frequencyMonths != null) return `${frequencyMonths} ${frequencyMonths === 1 ? "mes" : "meses"}`;
  if (frequencyHours != null) return `${frequencyHours.toLocaleString("es-AR")} hs`;
  return triggerType ?? "—";
}

function formatDue(nextDueDate: unknown, nextDueHours: number | null, fmt: (d: Date | string | null | undefined) => string): string {
  if (nextDueDate) return fmt(nextDueDate as string);
  if (nextDueHours != null) return `${nextDueHours.toLocaleString("es-AR")} hs`;
  return "—";
}

const STATUS_LABEL: Record<string, string> = {
  OVERDUE: "Vencido",
  DUE: "Por vencer",
  IN_WINDOW: "En ventana",
  NEVER_EXECUTED: "Sin ejecutar",
};

export async function buildDueSoonPlansXlsx(
  session: TenantAccessSession,
  options: { vesselCode?: string | null } = {},
): Promise<Buffer> {
  // La fecha de vencimiento es una fecha de calendario: formateada en la hora
  // del servidor se corría un día para atrás.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const items = await listTenantMaintenancePlans(session, { vesselCode: options.vesselCode ?? null });
  const due = items
    .map((p) => ({ p, status: computePlanStatus(p) }))
    .filter((x) => INCLUDED_STATUSES.has(x.status))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));

  // Nombre del buque (mostrar NOMBRE, no código) — resuelto por tenant.
  const vesselNameMap = new Map<string, string>();
  const prismaRaw = getPrismaClient();
  if (prismaRaw && due.length > 0) {
    try {
      const t = await (prismaRaw as any).tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
      const tenantId = t?.id ?? null;
      if (tenantId) {
        const codes = [...new Set(due.map((x) => x.p.vesselCode))];
        const vessels = await (prismaRaw as any).vessel.findMany({
          where: { tenantId, code: { in: codes } },
          select: { code: true, name: true },
        });
        for (const v of vessels as { code: string; name: string | null }[]) {
          if (v.name) vesselNameMap.set(v.code, v.name);
        }
      }
    } catch { /* non-blocking: si falla, se usa el código */ }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMS3.0";
  const sheet = workbook.addWorksheet("Próximos a vencer");

  sheet.columns = [
    { key: "estado",       header: "Estado",            width: 14 },
    { key: "embarcacion",  header: "Embarcación",      width: 22 },
    { key: "taskId",       header: "TaskID",            width: 16 },
    { key: "equipo",       header: "Equipo",            width: 34 },
    { key: "tarea",        header: "Tarea",             width: 34 },
    { key: "tareas",       header: "Tareas a realizar", width: 50 },
    { key: "frecuencia",   header: "Frecuencia",        width: 14 },
    { key: "vencimiento",  header: "Vencimiento",       width: 16 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
  headerRow.commit();

  for (const { p, status } of due) {
    sheet.addRow({
      estado:      STATUS_LABEL[status] ?? status,
      embarcacion: vesselNameMap.get(p.vesselCode) ?? p.vesselCode,
      taskId:      p.taskCode,
      equipo:      (p as { assetName?: string | null }).assetName ?? "—",
      tarea:       p.title,
      tareas:      (p.description ?? "").trim() || "—",
      frecuencia:  formatFrequency(p.frequencyMonths ?? null, p.frequencyHours ?? null, p.triggerType),
      vencimiento: formatDue((p as { nextDueDate?: unknown }).nextDueDate, p.nextDueHours ?? null, fmt),
    });
  }

  // Ajuste: la columna "Tareas a realizar" puede ser larga → wrap text.
  sheet.getColumn("tareas").alignment = { wrapText: true, vertical: "top" };
  sheet.getColumn("equipo").alignment = { wrapText: true, vertical: "top" };
  sheet.getColumn("tarea").alignment = { wrapText: true, vertical: "top" };

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
