// Reporte Excel de planes de mantenimiento PRÓXIMOS A VENCER.
//
// Mismo criterio que el toggle "VENCIDOS / PRÓX." de la página de Planes:
// executionStatus ∈ { OVERDUE, DUE, IN_WINDOW }. Reutiliza
// listTenantMaintenancePlans (que ya deriva executionStatus con las horas
// actuales del activo y resuelve assetName) para que el conteo coincida con la UI.
//
// Columnas: Embarcación · TaskID · Equipo · Tarea · Tareas a realizar · Frecuencia · Vencimiento.

import ExcelJS from "exceljs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listTenantMaintenancePlans } from "../maintenance-plans/maintenance-plans-service";

const DUE_SOON_STATUSES = new Set(["OVERDUE", "DUE", "IN_WINDOW"]);

function formatFrequency(frequencyMonths: number | null, frequencyHours: number | null, triggerType: string): string {
  if (frequencyMonths != null) return `${frequencyMonths} ${frequencyMonths === 1 ? "mes" : "meses"}`;
  if (frequencyHours != null) return `${frequencyHours.toLocaleString("es-AR")} hs`;
  return triggerType ?? "—";
}

function formatDue(nextDueDate: unknown, nextDueHours: number | null): string {
  if (nextDueDate) return new Date(nextDueDate as string).toLocaleDateString("es-AR");
  if (nextDueHours != null) return `${nextDueHours.toLocaleString("es-AR")} hs`;
  return "—";
}

const STATUS_LABEL: Record<string, string> = {
  OVERDUE: "Vencido",
  DUE: "Por vencer",
  IN_WINDOW: "En ventana",
};

export async function buildDueSoonPlansXlsx(
  session: TenantAccessSession,
  options: { vesselCode?: string | null } = {},
): Promise<Buffer> {
  const items = await listTenantMaintenancePlans(session, { vesselCode: options.vesselCode ?? null });
  const due = items.filter((p) => DUE_SOON_STATUSES.has(String((p as { executionStatus?: string }).executionStatus)));

  // Nombre del buque (mostrar NOMBRE, no código) — resuelto por tenant.
  const vesselNameMap = new Map<string, string>();
  const prismaRaw = getPrismaClient();
  if (prismaRaw && due.length > 0) {
    try {
      const t = await (prismaRaw as any).tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
      const tenantId = t?.id ?? null;
      if (tenantId) {
        const codes = [...new Set(due.map((p) => p.vesselCode))];
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

  for (const p of due) {
    sheet.addRow({
      embarcacion: vesselNameMap.get(p.vesselCode) ?? p.vesselCode,
      taskId:      p.taskCode,
      equipo:      (p as { assetName?: string | null }).assetName ?? "—",
      tarea:       p.title,
      tareas:      (p.description ?? "").trim() || "—",
      frecuencia:  formatFrequency(p.frequencyMonths ?? null, p.frequencyHours ?? null, p.triggerType),
      vencimiento: formatDue((p as { nextDueDate?: unknown }).nextDueDate, p.nextDueHours ?? null),
    });
  }

  // Ajuste: la columna "Tareas a realizar" puede ser larga → wrap text.
  sheet.getColumn("tareas").alignment = { wrapText: true, vertical: "top" };
  sheet.getColumn("equipo").alignment = { wrapText: true, vertical: "top" };
  sheet.getColumn("tarea").alignment = { wrapText: true, vertical: "top" };

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
