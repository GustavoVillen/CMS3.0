// PDF del estado de mantenimiento de un equipo: lo mismo que muestra la ventana
// del Dashboard, en papel y completo.
//
// Dos partes: el PLAN VIGENTE abierto en tres bloques (vencidas / próximas a
// vencer / al día) y el HISTORIAL de lo que se le hizo al equipo. Sirve para
// auditoría, entrega de guardia y clase: el auditor ve qué falta y qué se hizo
// en la misma hoja. Se arma con los MISMOS servicios que alimentan la pantalla
// (planes activos del equipo + OT del equipo + ejecuciones de plan sin OT), así
// no hay dos verdades. En pantalla las tablas scrollean; acá se paginan.
import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { getTenantAsset } from "../assets/assets-service";
import { listTenantWorkOrders } from "../work-orders/work-orders-service";
import { listTenantMaintenancePlans } from "../maintenance-plans/maintenance-plans-service";
import { listWorkLogs } from "./work-logs-service";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";

const WO_STATUS_TEXT: Record<string, string> = {
  PLANNED:     "Planificada",
  IN_PROGRESS: "En ejecución",
  ON_HOLD:     "En espera",
  DEFERRED:    "Diferida",
  CLOSED:      "Cerrada",
  CANCELLED:   "Cancelada",
};

const LOG_RESULT_TEXT: Record<string, string> = {
  COMPLETED:                   "Completado",
  COMPLETED_WITH_OBSERVATIONS: "Completado c/obs.",
  NOT_COMPLETED:               "No completado",
  FOLLOW_UP_REQUIRED:          "Requiere seguimiento",
};

interface HistoryRow {
  code: string;
  isInspection: boolean;
  title: string;
  openDate: string | null;
  completedDate: string | null;
  statusText: string;
}

/** Una tarea del plan vigente, tal como se lista en la ventana. */
interface PlanRow {
  taskCode: string;
  title: string;
  frequencyText: string;
  nextDueText: string;
  nextDueDate: string | null;
}

// executionStatus → bloque. Mismo criterio que el semáforo de la pantalla
// (web-modern/src/lib/maintenance-severity.ts): si cambia allá, cambia acá, o
// el papel y la pantalla dicen cosas distintas.
const PLAN_BUCKET: Record<string, "OVERDUE" | "UPCOMING" | "OK"> = {
  OVERDUE: "OVERDUE",
  DUE: "UPCOMING",
  IN_WINDOW: "UPCOMING",
  UPCOMING: "UPCOMING",
  FUTURE: "OK",
  COMPLETED: "OK",
};

const CM = 28.35;
const PAGE_H = 841.89;
const PAGE_W = 595.28;
const MARGIN_V = Math.round(1.5 * CM);
const FOOTER_SIZE = 30;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

export async function buildAssetMaintenanceHistoryPdf(
  session: TenantAccessSession,
  assetId: string,
): Promise<Buffer> {
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmt = (d: Date | string | null | undefined) => (d ? fmtDateTz(d, tz, locale) : "—");
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);

  const asset = await getTenantAsset(session, assetId) as {
    id: string; name: string | null; assetCode: string; status?: string | null; vesselCode?: string | null;
  } | null;
  if (!asset) throw new RouteError(404, "NOT_FOUND", "Equipo no encontrado.");

  const workOrders = await listTenantWorkOrders(session, { assetId }) as unknown as Array<{
    workOrderCode: string; type: string; title: string | null; status: string;
    openDate: string | Date | null; completedDate: string | Date | null;
  }>;
  // Plan vigente del equipo: sólo los ACTIVE, que son los que la tripulación
  // tiene que ejecutar. El executionStatus ya viene derivado por el service.
  const activePlans = await listTenantMaintenancePlans(session, { assetId, status: "ACTIVE" }) as unknown as Array<{
    taskCode: string; title: string; executionStatus: string; triggerType: string;
    frequencyMonths: number | null; frequencyHours: number | null;
    nextDueDate: string | Date | null; nextDueHours: number | null;
  }>;

  const workLogs = await listWorkLogs(session, { assetId }) as Array<{
    id: string; logCode: string; taskType: string; result: string; notes: string | null;
    workOrderId: string | null; startedAt: string | Date | null; completedAt: string | Date | null;
    maintenancePlan: { taskCode: string; title: string } | null;
  }>;

  // Historial unificado, mismo criterio que AssetHistory: OT del equipo +
  // ejecuciones directas de plan (WorkLog sin OT, para no duplicar).
  const rows: HistoryRow[] = [
    ...workOrders.map(wo => ({
      code: wo.workOrderCode,
      isInspection: wo.type === "INSPECTION",
      title: wo.title ?? wo.workOrderCode,
      openDate: toIso(wo.openDate),
      completedDate: toIso(wo.completedDate),
      statusText: WO_STATUS_TEXT[wo.status] ?? wo.status,
    })),
    ...workLogs.filter(l => !l.workOrderId).map(l => ({
      code: l.maintenancePlan?.taskCode ?? l.logCode,
      isInspection: l.taskType === "INSPECTION",
      title: l.maintenancePlan?.title ?? l.notes ?? "—",
      openDate: toIso(l.startedAt),
      completedDate: toIso(l.completedAt),
      statusText: LOG_RESULT_TEXT[l.result] ?? l.result,
    })),
  ].sort((a, b) => ref(b) - ref(a));

  // Plan vigente en los mismos tres bloques que la ventana. Lo que no está
  // mapeado en PLAN_BUCKET cuenta como "al día" (igual que en pantalla).
  const planBuckets: Record<"OVERDUE" | "UPCOMING" | "OK", PlanRow[]> = { OVERDUE: [], UPCOMING: [], OK: [] };
  for (const p of activePlans) {
    const bucket = PLAN_BUCKET[p.executionStatus] ?? "OK";
    const nextDueIso = toIso(p.nextDueDate);
    planBuckets[bucket].push({
      taskCode: p.taskCode,
      title: p.title,
      frequencyText: frequencyText(p),
      nextDueText: nextDueIso
        ? fmt(nextDueIso)
        : p.nextDueHours != null
          ? `${p.nextDueHours.toLocaleString(locale)} h`
          : "—",
      nextDueDate: nextDueIso,
    });
  }
  // Lo que vence antes va primero; los que vencen por horas (sin fecha), al final.
  const byDue = (a: PlanRow, b: PlanRow) =>
    (a.nextDueDate ?? "9999").localeCompare(b.nextDueDate ?? "9999") || a.taskCode.localeCompare(b.taskCode);
  planBuckets.OVERDUE.sort(byDue);
  planBuckets.UPCOMING.sort(byDue);
  planBuckets.OK.sort(byDue);
  const planTotal = activePlans.length;

  let tenantName: string | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const tenantRow = await prisma.tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      tenantName = tenantRow?.settings?.displayName ?? null;
      tenantLogoBuffer = await resolveTenantLogo(
        session.tenantSlug,
        tenantRow?.settings?.logoUrl ?? null,
        tenantRow?.settings?.logoUrlLight ?? null,
      );
    } catch { /* non-blocking */ }
  }

  // El buque se muestra con su NOMBRE, no con el código.
  let vesselName: string | null = null;
  if (prisma && asset.vesselCode) {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
      if (tenant) {
        const vessel = await prisma.vessel.findFirst({
          where: { tenantId: tenant.id, code: asset.vesselCode },
          select: { name: true },
        });
        vesselName = vessel?.name ?? null;
      }
    } catch { /* non-blocking */ }
  }

  const assetTitle = asset.name ?? asset.assetCode;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      // bufferPages: el pie va en TODAS las páginas, y para numerarlas hay que
      // saber cuántas son. Sin esto el pie sólo caía en la última.
      bufferPages: true,
      info: { Title: `Estado de mantenimiento — ${assetTitle}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML = 48, MR = 48, W = PAGE_W - ML - MR;
    const black = "#0f172a", gray = "#64748b", border = "#e2e8f0", bgBox = "#f8fafc";
    let y = MARGIN_V;

    doc.on("pageAdded", () => { (doc as unknown as { y: number }).y = MARGIN_V; y = MARGIN_V; });
    const ensureSpace = (needed: number) => { if (y + needed > CONTENT_BOTTOM) doc.addPage(); };

    // ── Header ───────────────────────────────────────────────────────────────
    const HEADER_H = 64, LOGO_W = 90;
    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, ML + W - LOGO_W, y, { fit: [LOGO_W, HEADER_H], align: "right", valign: "center" }); }
      catch { /* logo unavailable */ }
    }
    const titleW = W - LOGO_W - 16;
    doc.fontSize(17).font("Helvetica-Bold").fillColor(black)
      .text(sanitizePdfText(assetTitle), ML, y + 2, { width: titleW });
    doc.fontSize(10).font("Helvetica").fillColor(gray)
      .text(sanitizePdfText([asset.assetCode, vesselName].filter(Boolean).join("  ·  ")), ML, y + 26, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`Plan de mantenimiento vigente e historial · ${tenantName ?? session.tenantSlug} · Generado: ${fmtDateTime(new Date())}`, ML, y + 44, { width: titleW });
    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 14;

    // ── Plan vigente ─────────────────────────────────────────────────────────
    // Los tres bloques se imprimen SIEMPRE, incluso vacíos: en una auditoría el
    // "no hay tareas vencidas" es tanta evidencia como la lista de las que hay.
    planSection(`Tareas vencidas · ${planBuckets.OVERDUE.length}`, planBuckets.OVERDUE);
    planSection(`Tareas próximas a vencer · ${planBuckets.UPCOMING.length}`, planBuckets.UPCOMING);
    planSection(`Tareas al día · ${planBuckets.OK.length}`, planBuckets.OK);
    if (planTotal === 0) {
      ensureSpace(20);
      doc.fontSize(9).font("Helvetica").fillColor(gray).text("El equipo no tiene plan de mantenimiento activo.", ML, y, { width: W });
      y += 16;
    }
    y += 6;

    // ── Historial ────────────────────────────────────────────────────────────
    sectionTitle(`Historial de mantenimientos e inspecciones · ${rows.length}`);
    if (rows.length === 0) {
      ensureSpace(20);
      doc.fontSize(9).font("Helvetica").fillColor(gray).text("Sin registros.", ML, y, { width: W });
      y += 16;
    } else {
      historyTable(rows);
    }

    drawFooters();
    doc.end();

    // ── Helpers de dibujo ────────────────────────────────────────────────────

    function sectionTitle(text: string) {
      ensureSpace(26);
      doc.fontSize(7.5).font("Helvetica-Bold").fillColor(gray)
        .text(sanitizePdfText(text.toUpperCase()), ML, y, { width: W, characterSpacing: 0.6 });
      y += 14;
    }

    /** Un bloque del plan: título + tabla (o la constancia de que está vacío). */
    function planSection(title: string, list: PlanRow[]) {
      sectionTitle(title);
      if (list.length === 0) {
        ensureSpace(20);
        doc.fontSize(9).font("Helvetica").fillColor(gray).text("Sin tareas.", ML, y, { width: W });
        y += 18;
        return;
      }
      planTable(list);
      y += 8;
    }

    function planTable(list: PlanRow[]) {
      // Anchos: código, descripción (lo que sobra), frecuencia, próxima.
      const COLS = [92, W - 92 - 78 - 74, 78, 74];
      const HEAD = ["Tarea", "Descripción", "Frecuencia", "Próxima"];

      const drawHead = () => {
        ensureSpace(22);
        doc.roundedRect(ML, y, W, 18, 3).fillColor(bgBox).fill();
        let x = ML + 6;
        HEAD.forEach((h, i) => {
          doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
            .text(h, x, y + 6, { width: COLS[i]! - 6, characterSpacing: 0.3 });
          x += COLS[i]!;
        });
        y += 20;
      };

      drawHead();
      for (const r of list) {
        const cells = [
          sanitizePdfText(r.taskCode ?? ""),
          sanitizePdfText(r.title ?? ""),
          sanitizePdfText(r.frequencyText),
          sanitizePdfText(r.nextDueText),
        ];
        // El alto lo manda la celda MÁS alta (mismo criterio que el historial):
        // una descripción larga no puede montarse sobre la fila de abajo.
        const rowH = Math.max(16, ...cells.map((c, i) => {
          doc.fontSize(i === 0 ? 7.5 : 8).font(i === 0 ? "Helvetica-Bold" : "Helvetica");
          return doc.heightOfString(String(c), { width: COLS[i]! - 6 }) + 8;
        }));
        if (y + rowH > CONTENT_BOTTOM) { doc.addPage(); drawHead(); }

        let x = ML + 6;
        cells.forEach((c, i) => {
          const isCode = i === 0;
          doc.fontSize(isCode ? 7.5 : 8)
            .font(isCode ? "Helvetica-Bold" : "Helvetica")
            .fillColor(i === 2 ? gray : black)
            .text(String(c), x, y + 4, { width: COLS[i]! - 6 });
          x += COLS[i]!;
        });
        y += rowH;
        doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.4).stroke();
        y += 2;
      }
    }

    function historyTable(list: HistoryRow[]) {
      // Anchos: código, tipo, descripción (lo que sobra), apertura, realización, estado.
      const COLS = [86, 66, W - 86 - 66 - 58 - 60 - 70, 58, 60, 70];
      const HEAD = ["OT / Tarea", "Tipo", "Descripción", "F. Apertura", "F. Realiz.", "Estado"];

      const drawHead = () => {
        ensureSpace(22);
        doc.roundedRect(ML, y, W, 18, 3).fillColor(bgBox).fill();
        let x = ML + 6;
        HEAD.forEach((h, i) => {
          doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
            .text(h, x, y + 6, { width: COLS[i]! - 6, characterSpacing: 0.3 });
          x += COLS[i]!;
        });
        y += 20;
      };

      drawHead();
      for (const r of list) {
        const cells = [
          sanitizePdfText(r.code ?? ""),
          r.isInspection ? "Inspección" : "Mantenimiento",
          sanitizePdfText(r.title ?? ""),
          fmt(r.openDate),
          fmt(r.completedDate),
          sanitizePdfText(r.statusText ?? ""),
        ];
        // El alto lo manda la celda MÁS alta, no sólo la descripción: si no,
        // "Mantenimiento" partido en dos líneas se montaba sobre la fila de abajo.
        const rowH = Math.max(16, ...cells.map((c, i) => {
          doc.fontSize(i === 0 ? 7.5 : 8).font(i === 0 ? "Helvetica-Bold" : "Helvetica");
          return doc.heightOfString(String(c), { width: COLS[i]! - 6 }) + 8;
        }));
        // Si la fila no entra, se pagina y se repite el encabezado de la tabla.
        if (y + rowH > CONTENT_BOTTOM) { doc.addPage(); drawHead(); }

        let x = ML + 6;
        cells.forEach((c, i) => {
          const isCode = i === 0;
          doc.fontSize(isCode ? 7.5 : 8)
            .font(isCode ? "Helvetica-Bold" : "Helvetica")
            .fillColor(i === 1 ? gray : black)
            .text(String(c), x, y + 4, { width: COLS[i]! - 6 });
          x += COLS[i]!;
        });
        y += rowH;
        doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.4).stroke();
        y += 2;
      }
    }

    /** Pie en todas las páginas, con numeración. */
    function drawFooters() {
      const range = doc.bufferedPageRange();
      const footerY = PAGE_H - FOOTER_SIZE;
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
        if (existsSync(LOGO_PATH)) {
          try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* logo missing */ }
        }
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text("Copilot Management System — Estado de mantenimiento del equipo", ML + 18, footerY, { width: W / 2 + 40 });
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text(`${tenantName ?? session.tenantSlug} · ${fmt(new Date())} · Página ${i - range.start + 1} de ${range.count}`, ML, footerY, { width: W, align: "right" });
      }
    }
  });
}

function toIso(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  return typeof d === "string" ? d : d.toISOString();
}

function ref(r: HistoryRow): number {
  const d = r.completedDate ?? r.openDate;
  const t = d ? new Date(d).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** Frecuencia legible del plan, con el mismo criterio que la pantalla de planes. */
function frequencyText(p: {
  triggerType: string; frequencyMonths: number | null; frequencyHours: number | null;
}): string {
  const tt = String(p.triggerType ?? "").toUpperCase();
  if ((tt === "HOURS" || tt === "RUNNING_HOURS") && p.frequencyHours != null) return `Cada ${p.frequencyHours} h`;
  if (p.frequencyMonths != null) return p.frequencyMonths === 1 ? "Cada mes" : `Cada ${p.frequencyMonths} meses`;
  if (p.frequencyHours != null) return `Cada ${p.frequencyHours} h`;
  if (tt === "CONDITION") return "Según condición";
  if (tt === "EVENT") return "Por evento";
  return "—";
}
