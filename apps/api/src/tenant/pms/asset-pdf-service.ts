// Ficha de equipo (PDF) — preview V2, aprobada con PROCEDER el 30/09/2026.
//
// Pensada para leerse de un vistazo y alineada a los procedimientos de
// Mercurio (PROC-MAN): arriba los avisos con la regla que corresponde, un
// resumen del estado del equipo y después una sección por cada cosa que el
// procedimiento pide llevar por equipo (plan, repuestos, averías, análisis,
// historial). Cada sección dice qué punto del procedimiento cubre.
//
// No es un documento controlado: PROC-MAN no tiene un REGI para la ficha. Es un
// reporte del sistema informático (PROC-MAN-02 §4.4.3).
//
// "Equipo crítico" de PROC-MAN-03 = el tilde "Crítico ISM 10.3" del equipo.
// Los avisos citan el procedimiento sólo para esos equipos.
import PDFDocument from "pdfkit";
import type { TenantAccessSession } from "../auth/session-store";
import { getTenantAsset } from "../assets/assets-service";
import { listTenantWorkOrders } from "../work-orders/work-orders-service";
import { listTenantMaintenancePlans } from "../maintenance-plans/maintenance-plans-service";
import { listDefects } from "./defects-service";
import { listFluidSamples } from "../fluid-analyses/fluid-analyses-service";
import { getOnHandMap } from "./stock-calc-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { canAccessVessel } from "../files/file-access-service";
import { renderLabeledTextBox, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";

// ── Rótulos ──────────────────────────────────────────────────────────────────

type Tone = "ok" | "warn" | "bad" | "info" | "violet" | "muted";
type IconKind = "check" | "warn" | "stop" | "clock" | "shield" | "dot" | "box";

const TONE: Record<Tone, { fg: string; bg: string }> = {
  ok:     { fg: "#15803d", bg: "#e8f5ec" },
  warn:   { fg: "#b45309", bg: "#fdf3e3" },
  bad:    { fg: "#b91c1c", bg: "#fcebeb" },
  info:   { fg: "#0369a1", bg: "#e7f2f9" },
  violet: { fg: "#6d28d9", bg: "#f1ebfd" },
  muted:  { fg: "#64748b", bg: "#f1f4f8" },
};

const SFI_GROUP: Record<string, string> = {
  "0": "Inspecciones y Pruebas", "1": "Casco y Estructuras", "2": "Equipamiento", "3": "LCI y Salvamento",
  "4": "Sistemas de Navegación", "5": "Sistemas de Habitabilidad", "6": "Sistemas de Propulsión y Generación",
  "7": "Sistemas Auxiliares", "8": "Sistemas Eléctricos",
};
const CRIT: Record<string, { label: string; color: string }> = {
  A: { label: "Crítico", color: "#b91c1c" }, B: { label: "Importante", color: "#b45309" }, C: { label: "Rutinario", color: "#15803d" },
};
const ASSET_STATUS: Record<string, [string, Tone, IconKind]> = {
  OPERATIONAL: ["Operativo", "ok", "check"], DEGRADED: ["Degradado", "warn", "warn"], OUT_OF_SERVICE: ["Fuera de servicio", "bad", "stop"],
};
// Estado de la tarea en palabras de uso diario; "Al día" es como lo agrupa el tablero.
const PLAN_STATUS: Record<string, [string, Tone, IconKind, number]> = {
  OVERDUE: ["Vencida", "bad", "warn", 0], DUE: ["Vence hoy", "bad", "warn", 1], IN_WINDOW: ["En ventana", "violet", "clock", 2],
  UPCOMING: ["Próxima", "info", "clock", 3], FUTURE: ["Al día", "ok", "check", 4], COMPLETED: ["Completada", "ok", "check", 5],
  NEVER_EXECUTED: ["Sin ejecutar", "muted", "dot", 6],
};
const WO_TYPE: Record<string, string> = { PREVENTIVE: "Preventiva", CORRECTIVE: "Correctiva", INSPECTION: "Inspección" };
const WO_STATUS: Record<string, [string, Tone]> = {
  PLANNED: ["Planificada", "info"], IN_PROGRESS: ["En curso", "warn"], ON_HOLD: ["En espera", "violet"],
  DEFERRED: ["Diferida", "muted"], CLOSED: ["Cerrada", "ok"], CANCELLED: ["Cancelada", "muted"],
};
const DEFECT_SEVERITY: Record<string, [string, Tone]> = { CRITICAL: ["Crítica", "bad"], HIGH: ["Alta", "bad"], MEDIUM: ["Media", "warn"], LOW: ["Baja", "muted"] };
const DEFECT_STATUS: Record<string, [string, Tone]> = {
  OPEN: ["Abierto", "bad"], UNDER_REVIEW: ["En revisión", "warn"], IN_PROGRESS: ["En curso", "warn"],
  DEFERRED: ["Diferido", "muted"], RESOLVED: ["Resuelto", "ok"], CLOSED: ["Cerrado", "ok"],
};
const VERDICT: Record<string, [string, Tone, IconKind]> = {
  NORMAL: ["Normal", "ok", "check"], CAUTION: ["Precaución", "warn", "warn"],
  CRITICAL: ["Crítico", "bad", "warn"], ACTION_REQUIRED: ["Acción requerida", "bad", "stop"],
};
const SAMPLE_KIND: Record<string, string> = {
  FLUID: "Aceite / fluido", VIBRATION: "Vibraciones", THERMAL: "Termografía", INSULATION: "Megado", ULTRASOUND: "Ultrasonido", OTHER: "Otro",
};

// ── Tipos de lo que se lee ───────────────────────────────────────────────────

interface AssetForPdf {
  id: string; tenantId: string; vesselCode: string; assetCode: string; sfiCode: string | null; name: string;
  criticality: string; criticalityRationale?: string | null; isSafetyCritical?: boolean; status: string;
  trackDailyReport: boolean; manufacturer: string | null; model: string | null; serialNumber: string | null;
  installationDate: Date | null; lastOverhaulDate: Date | null; replacementDate: Date | null; currentHours: number | null;
}
interface WoRow { workOrderCode: string; type: string; status: string; title: string | null; openDate: string | Date; completedDate: string | Date | null }
interface PlanRow {
  taskCode: string; taskType: string; title: string; status?: string | null; triggerType: string;
  frequencyHours: number | null; frequencyMonths: number | null; nextDueDate: string | Date | null; nextDueHours: number | null;
  executionStatus?: string | null; spares?: Array<{ spareId?: string | null; quantity?: number | null }> | null;
}
interface DefectRow { defectCode: string; description?: string | null; severity?: string | null; status: string; reportedAt?: string | Date | null }
interface SampleRow { sampleCode: string; kind?: string | null; sampledAt: string | Date; labName?: string | null; result?: { verdict?: string | null } | null }
interface SpareRow { name: string; sku: string; unit: string | null; minStock: number; onHand: number; tasks: number }

// ── Página ───────────────────────────────────────────────────────────────────

const PAGE_H = 841.89;
const PAGE_W = 595.28;
const ML = 40;
const W = PAGE_W - ML * 2;
const TOP = 40;
const FOOTER_Y = PAGE_H - 30;
const CONTENT_BOTTOM = FOOTER_Y - 12;
const NAVY = "#0c2461";
const INK = "#0f172a";
const GRAY = "#64748b";
const LINE = "#dbe2ea";
const SOFT = "#f5f7fa";
const DAY_MS = 86_400_000;

export async function buildAssetPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  // Fechas en la hora de la EMPRESA: el servidor corre en UTC.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);
  const num = (n: number) => Number(n).toLocaleString("es-AR");
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 365 * DAY_MS);

  const asset = (await getTenantAsset(session, id)) as unknown as AssetForPdf;
  // getTenantAsset sólo filtra por empresa: el buque se valida acá. Fuera de sus
  // buques el equipo "no existe" para el usuario, igual que en los listados.
  if (!canAccessVessel(session, asset.vesselCode)) {
    throw new RouteError(404, "NOT_FOUND", "Asset no encontrado.");
  }
  const [wos, plans, defects, samplesRes] = await Promise.all([
    listTenantWorkOrders(session, { assetId: asset.id }) as unknown as Promise<WoRow[]>,
    listTenantMaintenancePlans(session, { assetId: asset.id }) as unknown as Promise<PlanRow[]>,
    listDefects(session, { assetId: asset.id }) as unknown as Promise<DefectRow[]>,
    listFluidSamples(session, { assetId: asset.id }) as unknown as Promise<{ items: SampleRow[] }>,
  ]);
  const samples = (samplesRes?.items ?? []).slice(0, 4);

  let vesselName = asset.vesselCode;
  let tenantLogoBuffer: Buffer | null = null;
  let tenantName: string | null = null;
  let spares: SpareRow[] = [];
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const vessel = await (prisma as any).vessel.findFirst({ where: { tenantId: asset.tenantId, code: asset.vesselCode }, select: { name: true } });
      vesselName = vessel?.name ?? asset.vesselCode;
    } catch { /* se queda el código */ }
    try {
      const tenantRow = await (prisma as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { logoUrl: true, logoUrlLight: true, displayName: true } } },
      });
      tenantName = tenantRow?.settings?.displayName ?? null;
      tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, tenantRow?.settings?.logoUrl, tenantRow?.settings?.logoUrlLight);
    } catch { /* sin logo */ }
    // Repuestos del equipo = los que usan sus tareas activas, con stock contra
    // mínimo (PROC-MAN-02 §4.5 y PROC-MAN-04). Mismo criterio que "Repuestos de
    // sus tareas" de la ventana del equipo.
    try {
      const perSpare = new Map<string, number>();
      for (const p of plans) {
        if (p.status === "INACTIVE") continue;
        for (const l of Array.isArray(p.spares) ? p.spares : []) {
          if (l?.spareId) perSpare.set(l.spareId, (perSpare.get(l.spareId) ?? 0) + 1);
        }
      }
      if (perSpare.size > 0) {
        const rows: Array<{ id: string; sku: string; name: string; unit: string | null; minStock: number }> = await (prisma as any).spare.findMany({
          where: { id: { in: [...perSpare.keys()] }, tenantId: asset.tenantId, deletedAt: null },
          select: { id: true, sku: true, name: true, unit: true, minStock: true },
          orderBy: { name: "asc" },
        });
        const onHand = await getOnHandMap(prisma as never, rows.map(r => r.id), { tenantId: asset.tenantId });
        spares = rows.map(r => ({ name: r.name, sku: r.sku, unit: r.unit, minStock: Number(r.minStock) || 0, onHand: onHand.get(r.id) ?? 0, tasks: perSpare.get(r.id) ?? 0 }));
      }
    } catch { /* la sección queda con su aviso de "sin repuestos" */ }
  }

  // ── Cálculos ──────────────────────────────────────────────────────────────
  const crit = !!asset.isSafetyCritical;
  const critInfo = CRIT[asset.criticality] ?? { label: "", color: GRAY };
  const sfiTab = (asset.sfiCode ?? "").trim().charAt(0);
  const counts: Record<string, number> = {};
  for (const p of plans) counts[p.executionStatus ?? ""] = (counts[p.executionStatus ?? ""] ?? 0) + 1;
  const overdue = (counts.OVERDUE ?? 0) + (counts.DUE ?? 0);
  const compliance = plans.length ? Math.round(100 * (plans.length - overdue) / plans.length) : null;
  const sortedPlans = [...plans].sort((a, b) =>
    (PLAN_STATUS[a.executionStatus ?? ""]?.[3] ?? 9) - (PLAN_STATUS[b.executionStatus ?? ""]?.[3] ?? 9)
    || (a.nextDueHours ?? 1e12) - (b.nextDueHours ?? 1e12)
    || String(a.nextDueDate ?? "").localeCompare(String(b.nextDueDate ?? "")));
  const isOpenWo = (w: WoRow) => w.status !== "CLOSED" && w.status !== "CANCELLED";
  const openWos = wos.filter(isOpenWo);
  const closedWos = wos.filter(w => w.status === "CLOSED")
    .sort((a, b) => new Date(b.completedDate ?? b.openDate).getTime() - new Date(a.completedDate ?? a.openDate).getTime());
  const cancelledWos = wos.filter(w => w.status === "CANCELLED");
  const correctives = wos.filter(w => w.type === "CORRECTIVE");
  const isOpenDefect = (d: DefectRow) => d.status !== "RESOLVED" && d.status !== "CLOSED";
  const failures12 = correctives.filter(w => new Date(w.openDate) >= yearAgo).length
    + defects.filter(d => d.reportedAt && new Date(d.reportedAt) >= yearAgo).length;
  const lowSpares = spares.filter(s => s.minStock > 0 && s.onHand < s.minStock);
  const lastSample = samples[0];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: `${asset.assetCode} - Ficha de equipo` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = TOP;
    doc.on("pageAdded", () => { y = TOP; });
    const ensureSpace = (h: number) => { if (y + h > CONTENT_BOTTOM) doc.addPage(); };
    const txt = (s: string | null | undefined) => sanitizePdfText(String(s ?? "")).replace(/\s+/g, " ").trim();

    // ── Piezas de dibujo ────────────────────────────────────────────────────
    /** Ícono vectorial de 16×16 escalado a `size`, con el color del estado. */
    function icon(kind: IconKind, x: number, iy: number, size: number, color: string) {
      doc.save().translate(x, iy).scale(size / 16).lineWidth(1.8).strokeColor(color).fillColor(color);
      switch (kind) {
        case "check":
          doc.circle(8, 8, 7).fillOpacity(0.18).fill().fillOpacity(1);
          doc.moveTo(4.5, 8.3).lineTo(6.7, 10.5).lineTo(11.5, 5.7).stroke(); break;
        case "warn":
          doc.path("M8 1.5 L15 14 L1 14 Z").fillOpacity(0.18).fill().fillOpacity(1);
          doc.moveTo(8, 6).lineTo(8, 10).stroke(); doc.circle(8, 12.2, 0.9).fill(); break;
        case "stop":
          doc.circle(8, 8, 7).fillOpacity(0.18).fill().fillOpacity(1);
          doc.moveTo(5, 5).lineTo(11, 11).stroke(); doc.moveTo(11, 5).lineTo(5, 11).stroke(); break;
        case "clock":
          doc.lineWidth(1.5).circle(8, 8, 6.5).stroke(); doc.moveTo(8, 4.5).lineTo(8, 8).lineTo(10.5, 9.5).stroke(); break;
        case "shield":
          doc.lineWidth(1.3).path("M8 1.5 L13.5 3.5 L13.5 7.7 C13.5 11 11.2 13.5 8 14.5 C4.8 13.5 2.5 11 2.5 7.7 L2.5 3.5 Z")
            .fillOpacity(0.2).fillAndStroke(); doc.fillOpacity(1); break;
        case "box":
          doc.lineWidth(1.2).path("M2 5 L8 2 L14 5 L14 11 L8 14 L2 11 Z").fillOpacity(0.18).fillAndStroke(); doc.fillOpacity(1); break;
        default:
          doc.circle(8, 8, 4).fill();
      }
      doc.restore();
    }

    /** Rótulo de estado (color + ícono + texto). Devuelve el ancho usado. */
    function pill(x: number, py: number, label: string, tone: Tone, ic?: IconKind): number {
      const t = TONE[tone];
      doc.fontSize(7).font("Helvetica-Bold");
      const w = doc.widthOfString(label) + (ic ? 19 : 12);
      doc.roundedRect(x, py, w, 12, 6).fillColor(t.bg).fill();
      if (ic) icon(ic, x + 4, py + 2, 8, t.fg);
      doc.fillColor(t.fg).text(label, x + (ic ? 14 : 6), py + 2.6, { lineBreak: false });
      return w;
    }

    /** Banda de sección (título a la izquierda, punto del procedimiento a la derecha). */
    function sectionBar(title: string, ref: string, extra?: string) {
      ensureSpace(60);
      doc.roundedRect(ML, y, W, 16, 2).fillColor(NAVY).fill();
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#ffffff")
        .text(title.toUpperCase(), ML + 8, y + 4.5, { characterSpacing: 1, lineBreak: false, continued: !!extra });
      if (extra) doc.fontSize(7).font("Helvetica").fillColor("#c7d2fe").text(`   ${extra}`, { characterSpacing: 0, lineBreak: false });
      doc.fontSize(6.5).font("Helvetica").fillColor("#c7d2fe").text(ref, ML, y + 5, { width: W - 8, align: "right", lineBreak: false });
      y += 20;
    }

    /** Recuadro punteado para una sección sin datos: dice qué falta y por qué importa. */
    function emptyNote(bold: string, rest: string) {
      doc.fontSize(8).font("Helvetica");
      const h = doc.heightOfString(`${bold} ${rest}`, { width: W - 20 }) + 14;
      ensureSpace(h);
      doc.roundedRect(ML, y, W, h, 3).dash(2, { space: 2 }).strokeColor(LINE).lineWidth(0.8).stroke().undash();
      doc.fillColor(INK).font("Helvetica-Bold").text(bold, ML + 10, y + 7, { width: W - 20, continued: true })
        .font("Helvetica").fillColor(GRAY).text(` ${rest}`);
      y += h + 10;
    }

    type Cell = { text?: string; sub?: string; subMono?: boolean; subColor?: string; bold?: boolean; mono?: boolean; color?: string; pill?: [string, Tone, IconKind?] };
    interface Col { label: string; w: number }

    /** Tabla con filas de alto variable, cabecera repetida al cambiar de página y filas de grupo. */
    function table(cols: Col[], rows: Array<{ cells: Cell[]; hot?: boolean } | { group: string }>) {
      const PAD = 5;
      const colX = (i: number) => ML + cols.slice(0, i).reduce((s, c) => s + c.w, 0);
      const header = () => {
        doc.rect(ML, y, W, 15).fillColor("#eef2f6").fill();
        cols.forEach((c, i) => doc.fontSize(6.5).font("Helvetica-Bold").fillColor(GRAY)
          .text(c.label.toUpperCase(), colX(i) + PAD, y + 5, { width: c.w - PAD * 2, characterSpacing: 0.4, lineBreak: false, ellipsis: true }));
        y += 15;
      };
      ensureSpace(15 + 20);
      header();
      for (const row of rows) {
        if ("group" in row) {
          if (y + 15 + 20 > CONTENT_BOTTOM) { doc.addPage(); header(); }
          doc.rect(ML, y, W, 14).fillColor("#f8fafc").fill();
          doc.fontSize(7).font("Helvetica-Bold").fillColor(NAVY).text(row.group.toUpperCase(), ML + PAD, y + 4, { characterSpacing: 0.5, lineBreak: false });
          y += 14;
          continue;
        }
        const heights = row.cells.map((c, i) => {
          if (c.pill) return 12;
          doc.fontSize(8).font(c.bold ? "Helvetica-Bold" : c.mono ? "Courier-Bold" : "Helvetica");
          let h = doc.heightOfString(c.text || " ", { width: cols[i]!.w - PAD * 2 });
          if (c.sub) { doc.fontSize(6.5).font(c.subMono ? "Courier" : "Helvetica"); h += doc.heightOfString(c.sub, { width: cols[i]!.w - PAD * 2 }) + 1; }
          return h;
        });
        const rh = Math.max(18, Math.max(...heights) + 9);
        if (y + rh > CONTENT_BOTTOM) { doc.addPage(); header(); }
        if (row.hot) doc.rect(ML, y, W, rh).fillColor("#fff5f5").fill();
        doc.moveTo(ML, y + rh).lineTo(ML + W, y + rh).strokeColor(LINE).lineWidth(0.5).stroke();
        row.cells.forEach((c, i) => {
          const cx = colX(i) + PAD;
          const cw = cols[i]!.w - PAD * 2;
          if (c.pill) { pill(cx, y + 4, c.pill[0], c.pill[1], c.pill[2]); return; }
          doc.fontSize(8).font(c.bold ? "Helvetica-Bold" : c.mono ? "Courier-Bold" : "Helvetica").fillColor(c.color ?? INK)
            .text(c.text || "—", cx, y + 4.5, { width: cw });
          if (c.sub) doc.fontSize(c.subMono ? 6.5 : 7).font(c.subMono ? "Courier" : "Helvetica").fillColor(c.subColor ?? GRAY).text(c.sub, cx, doc.y + 1, { width: cw });
        });
        y += rh;
      }
      y += 12;
    }

    // ── Encabezado (mismo marco que los demás documentos del sistema) ────────
    const HDR_H = 44;
    const LOGO_W = 110;
    const META_W = 128;
    doc.rect(ML, y, W, HDR_H).strokeColor(LINE).lineWidth(1).stroke();
    doc.moveTo(ML + LOGO_W, y).lineTo(ML + LOGO_W, y + HDR_H).stroke();
    doc.moveTo(ML + W - META_W, y).lineTo(ML + W - META_W, y + HDR_H).stroke();
    doc.moveTo(ML + W - META_W, y + HDR_H / 2).lineTo(ML + W, y + HDR_H / 2).stroke();
    let logoDrawn = false;
    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, ML + 8, y + 5, { fit: [LOGO_W - 16, HDR_H - 10], align: "center", valign: "center" }); logoDrawn = true; } catch { /* sin logo */ }
    }
    // Sin logo cargado: el nombre de la empresa, para que la celda no quede vacía.
    if (!logoDrawn && tenantName) {
      doc.fontSize(9).font("Helvetica-Bold").fillColor(NAVY).text(txt(tenantName), ML + 6, y + 15, { width: LOGO_W - 12, align: "center", height: HDR_H - 16, ellipsis: true });
    }
    doc.fontSize(14).font("Helvetica-Bold").fillColor(NAVY)
      .text("FICHA DE EQUIPO", ML + LOGO_W, y + 15, { width: W - LOGO_W - META_W, align: "center", characterSpacing: 0.8 });
    doc.fontSize(7).font("Helvetica").fillColor(GRAY).text("Generado", ML + W - META_W + 7, y + 8, { lineBreak: false });
    doc.font("Helvetica-Bold").fillColor(INK).text(fmtDateTime(now), ML + W - META_W, y + 8, { width: META_W - 7, align: "right", lineBreak: false });
    doc.font("Helvetica").fillColor(GRAY).text("Página", ML + W - META_W + 7, y + HDR_H / 2 + 8, { lineBreak: false });
    const pageNumberSlot = { x: ML + W - META_W, y: y + HDR_H / 2 + 8, w: META_W - 7 };
    y += HDR_H + 8;

    // ── Avisos: lo que el procedimiento pide hacer, primero ─────────────────
    function alertBand(tone: "crit" | Tone, ic: IconKind, title: string, detail?: string, proc?: string) {
      const bg = tone === "crit" ? "#7f1d1d" : tone === "bad" ? "#b91c1c" : TONE[tone].bg;
      const fg = tone === "crit" || tone === "bad" ? "#ffffff" : TONE[tone].fg;
      const tw = W - 34;
      doc.fontSize(8.5).font("Helvetica-Bold");
      let h = doc.heightOfString(title + (detail ? `  ${detail}` : ""), { width: tw });
      if (proc) { doc.fontSize(7.5).font("Helvetica"); h += doc.heightOfString(proc, { width: tw }) + 2; }
      h += 12;
      ensureSpace(h);
      doc.roundedRect(ML, y, W, h, 3).fillColor(bg).fill();
      icon(ic, ML + 9, y + 6, 11, fg);
      doc.fontSize(8.5).font("Helvetica-Bold").fillColor(fg).text(title, ML + 26, y + 6.5, { width: tw, continued: !!detail });
      if (detail) doc.font("Helvetica").fontSize(7.5).text(`  ${detail}`);
      if (proc) doc.fontSize(7.5).font("Helvetica").fillColor(fg).text(proc, ML + 26, doc.y + 2, { width: tw });
      y += h + 5;
    }
    if (asset.status === "OUT_OF_SERVICE") {
      const wo = openWos[0];
      alertBand(crit ? "crit" : "bad", "stop", crit ? "Equipo crítico fuera de servicio" : "Equipo fuera de servicio",
        wo ? `· OT abierta ${wo.workOrderCode} — ${txt(wo.title)}` : undefined,
        crit ? "PROC-MAN-03: informar de inmediato a la PDT y al Gerente Técnico, y hacer la Evaluación de Riesgos (REGI-SYE-01.1)." : undefined);
    }
    if (overdue > 0) {
      alertBand(crit ? "bad" : "warn", "warn",
        `${overdue === 1 ? "1 tarea del plan vencida" : `${overdue} tareas del plan vencidas`}${crit ? " en un equipo crítico" : ""}`, undefined,
        crit ? "PROC-MAN-03: toda falla de mantenimiento de un equipo crítico es una falla del Sistema de Gestión y motivo de No Conformidad." : undefined);
    }
    for (const d of defects.filter(d => isOpenDefect(d) && (d.severity === "CRITICAL" || d.severity === "HIGH"))) {
      alertBand("warn", "warn", `Falla abierta ${d.defectCode} · gravedad ${(DEFECT_SEVERITY[d.severity ?? ""]?.[0] ?? "").toLowerCase()}`, undefined,
        crit ? "PROC-MAN-03: las reparaciones de equipos críticos se hacen con prioridad." : undefined);
    }
    if (lowSpares.length > 0) {
      alertBand("warn", "box", `${lowSpares.length === 1 ? "1 repuesto" : `${lowSpares.length} repuestos`} por debajo del stock mínimo`, undefined,
        crit ? "PROC-MAN-04: si falta un repuesto de un equipo crítico, el Capitán informa al Jefe Técnico por el medio más rápido." : undefined);
    }

    // ── Identidad ────────────────────────────────────────────────────────────
    const CHIP_W = 200;
    const leftW = W - CHIP_W - 14;
    const heroTop = y + 4;
    doc.fontSize(18).font("Helvetica-Bold").fillColor(INK).text(txt(asset.name), ML, heroTop, { width: leftW });
    doc.fontSize(8).font("Courier-Bold").fillColor(INK).text(asset.assetCode, ML, doc.y + 3, { continued: true })
      .font("Helvetica").fillColor(GRAY)
      .text(`  ·  ${txt(vesselName)}  ·  ${sfiTab && SFI_GROUP[sfiTab] ? `${sfiTab} · ${SFI_GROUP[sfiTab]}` : "Sin grupo SFI"}${asset.sfiCode ? ` (SFI ${asset.sfiCode})` : ""}`, { width: leftW });
    const leftBottom = doc.y;

    const [stLabel, stTone, stIcon] = ASSET_STATUS[asset.status] ?? [asset.status, "muted" as Tone, "dot" as IconKind];
    const chips: Array<{ k: string; label: string; fg: string; bg: string; ic?: IconKind; scale?: boolean }> = [
      { k: "Estado", label: stLabel, fg: TONE[stTone].fg, bg: TONE[stTone].bg, ic: stIcon },
      crit
        ? { k: "Equipo crítico", label: "Sí · PROC-MAN-03 / ISM 10.3", fg: TONE.violet.fg, bg: TONE.violet.bg, ic: "shield" }
        : { k: "Equipo crítico", label: "No", fg: TONE.muted.fg, bg: TONE.muted.bg },
      { k: "Criticidad", label: `${asset.criticality} · ${critInfo.label}`, fg: critInfo.color, bg: "#f7f2ee", scale: true },
      { k: "Horas", label: asset.trackDailyReport ? "Se cargan en el reporte diario" : "No lleva horómetro", fg: TONE.muted.fg, bg: TONE.muted.bg, ic: asset.trackDailyReport ? "check" : undefined },
    ];
    let cy = heroTop;
    const chipX = ML + W - CHIP_W;
    for (const c of chips) {
      doc.roundedRect(chipX, cy, CHIP_W, 17, 3).fillColor(c.bg).fill();
      doc.fontSize(6).font("Helvetica").fillColor(c.fg).text(c.k.toUpperCase(), chipX + 7, cy + 6, { width: 56, characterSpacing: 0.3, lineBreak: false });
      let lx = chipX + 66;
      if (c.ic) { icon(c.ic, lx, cy + 4, 9, c.fg); lx += 13; }
      doc.fontSize(7.5).font("Helvetica-Bold").fillColor(c.fg).text(c.label, lx, cy + 5, { lineBreak: false });
      if (c.scale) {
        ["A", "B", "C"].forEach((letter, i) => {
          const sx = chipX + CHIP_W - 48 + i * 15;
          const on = letter === asset.criticality;
          doc.roundedRect(sx, cy + 3, 12, 11, 2).fillColor(on ? CRIT[letter]!.color : "#ffffff").fill();
          if (!on) doc.roundedRect(sx, cy + 3, 12, 11, 2).strokeColor(LINE).lineWidth(0.6).stroke();
          doc.fontSize(6.5).font("Helvetica-Bold").fillColor(on ? "#ffffff" : "#94a3b8").text(letter, sx, cy + 5.5, { width: 12, align: "center", lineBreak: false });
        });
      }
      cy += 20;
    }
    y = Math.max(leftBottom, cy) + 6;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(NAVY).lineWidth(1.5).stroke();
    y += 10;

    // ── Resumen ──────────────────────────────────────────────────────────────
    type Tile = { k: string; v: string; d?: string; bad?: boolean; bar?: boolean };
    const tiles: Tile[] = [];
    if (asset.currentHours != null) tiles.push({ k: "Horas acumuladas", v: `${num(asset.currentHours)} h`, d: "Última lectura cargada" });
    tiles.push({ k: "Cumplimiento del plan", v: compliance == null ? "—" : `${compliance} %`, bad: overdue > 0, bar: plans.length > 0, d: plans.length ? undefined : "Sin tareas en el plan" });
    tiles.push({ k: "Averías (12 meses)", v: String(failures12), d: "OT correctivas y defectos reportados" });
    tiles.push({
      k: "Último análisis", v: lastSample ? fmt(lastSample.sampledAt) : "—",
      d: lastSample ? `${SAMPLE_KIND[lastSample.kind ?? "FLUID"] ?? ""} · ${VERDICT[lastSample.result?.verdict ?? ""]?.[0] ?? "esperando informe"}` : "Sin análisis cargados",
      bad: !!lastSample && ["CRITICAL", "ACTION_REQUIRED"].includes(lastSample.result?.verdict ?? ""),
    });
    tiles.push({
      k: "OT abiertas", v: String(openWos.length),
      d: openWos.length ? openWos.slice(0, 2).map(w => `${WO_TYPE[w.type] ?? w.type}: ${w.workOrderCode}`).join("\n") : "Ninguna pendiente",
      bad: openWos.some(w => w.type === "CORRECTIVE"),
    });
    const TILE_GAP = 6;
    const tileW = (W - TILE_GAP * (tiles.length - 1)) / tiles.length;
    const TILE_H = 58;
    ensureSpace(TILE_H + 10);
    const segs: Array<[string, string]> = [["OVERDUE", "#b91c1c"], ["DUE", "#b91c1c"], ["IN_WINDOW", "#6d28d9"], ["UPCOMING", "#0369a1"], ["FUTURE", "#15803d"]];
    tiles.forEach((t, i) => {
      const tx = ML + i * (tileW + TILE_GAP);
      doc.roundedRect(tx, y, tileW, TILE_H, 4).fillColor(t.bad ? "#fff8f8" : "#ffffff").fill();
      doc.roundedRect(tx, y, tileW, TILE_H, 4).strokeColor(t.bad ? "#f1b8b8" : LINE).lineWidth(0.8).stroke();
      doc.fontSize(6).font("Helvetica-Bold").fillColor(GRAY).text(t.k.toUpperCase(), tx + 7, y + 6, { width: tileW - 14, characterSpacing: 0.3 });
      doc.fontSize(t.v.length > 8 ? 11.5 : 14).font("Helvetica-Bold").fillColor(t.bad ? "#b91c1c" : INK).text(t.v, tx + 7, y + 20, { width: tileW - 14, lineBreak: false });
      if (t.bar) {
        const bx = tx + 7; const bw = tileW - 14; let off = 0;
        doc.roundedRect(bx, y + 38, bw, 4, 2).fillColor("#eef2f6").fill();
        for (const [k, c] of segs) {
          const n = counts[k] ?? 0; if (!n) continue;
          const sw = bw * n / plans.length;
          doc.rect(bx + off, y + 38, sw, 4).fillColor(c).fill(); off += sw;
        }
        const legend = segs.filter(([k]) => counts[k]).map(([k]) => `${counts[k]} ${PLAN_STATUS[k]![0].toLowerCase()}`).join(" · ");
        doc.fontSize(6).font("Helvetica").fillColor(GRAY).text(legend, bx, y + 45, { width: bw });
      } else if (t.d) {
        doc.fontSize(6.5).font("Helvetica").fillColor(GRAY).text(t.d, tx + 7, y + 38, { width: tileW - 14, height: TILE_H - 40, ellipsis: true });
      }
    });
    y += TILE_H + 12;

    // ── Datos técnicos ───────────────────────────────────────────────────────
    sectionBar("Datos técnicos", "PROC-MAN-02 §4.5");
    const kv: Array<[string, string | null]> = [
      ["Fabricante", asset.manufacturer ? txt(asset.manufacturer) : null], ["Modelo", asset.model ? txt(asset.model) : null],
      ["N° de serie", asset.serialNumber ? txt(asset.serialNumber) : null], ["Instalación", asset.installationDate ? fmt(asset.installationDate) : null],
      ["Última reparación mayor", asset.lastOverhaulDate ? fmt(asset.lastOverhaulDate) : null], ["Reemplazo previsto", asset.replacementDate ? fmt(asset.replacementDate) : null],
    ];
    const cellW = W / 3; const CELL_H = 28;
    ensureSpace(CELL_H * 2);
    doc.roundedRect(ML, y, W, CELL_H * 2, 3).strokeColor(LINE).lineWidth(0.8).stroke();
    doc.moveTo(ML + cellW, y).lineTo(ML + cellW, y + CELL_H * 2).stroke();
    doc.moveTo(ML + cellW * 2, y).lineTo(ML + cellW * 2, y + CELL_H * 2).stroke();
    doc.moveTo(ML, y + CELL_H).lineTo(ML + W, y + CELL_H).stroke();
    kv.forEach(([k, v], i) => {
      const cx = ML + (i % 3) * cellW + 8; const cyy = y + Math.floor(i / 3) * CELL_H;
      doc.fontSize(6).font("Helvetica-Bold").fillColor(GRAY).text(k.toUpperCase(), cx, cyy + 6, { width: cellW - 16, characterSpacing: 0.3, lineBreak: false });
      doc.fontSize(8.5).font(v ? "Helvetica-Bold" : "Helvetica").fillColor(v ? INK : "#aab4c2")
        .text(v ?? "Sin dato", cx, cyy + 15, { width: cellW - 16, lineBreak: false, ellipsis: true });
    });
    y += CELL_H * 2 + 12;

    // ── Fundamento de la criticidad (texto libre: helper multi-página) ──────
    sectionBar("Fundamento de la criticidad", "Criterio de la empresa");
    y = renderLabeledTextBox(doc, {
      label: `Por qué es criticidad ${asset.criticality}${critInfo.label ? ` · ${critInfo.label}` : ""}`,
      text: asset.criticalityRationale?.trim() || "Sin fundamento cargado.",
      x: ML, y, width: W, pageBottom: CONTENT_BOTTOM, pageTop: TOP,
      labelPosition: "inside", labelColor: critInfo.color, border: critInfo.color, bg: SOFT,
      fontSize: 8.5, sectionGap: 12,
    });

    // ── Plan de mantenimiento ────────────────────────────────────────────────
    const freqText = (p: PlanRow) => p.frequencyHours ? `Cada ${num(p.frequencyHours)} h`
      : p.frequencyMonths ? (p.frequencyMonths === 1 ? "Cada mes" : `Cada ${p.frequencyMonths} meses`) : "—";
    const nextText = (p: PlanRow): { text: string; sub?: string; subColor?: string } => {
      if (p.nextDueHours != null) {
        const left = asset.currentHours != null ? p.nextDueHours - asset.currentHours : null;
        if (left == null) return { text: `${num(p.nextDueHours)} h` };
        return left < 0
          ? { text: `${num(p.nextDueHours)} h`, sub: `pasada por ${num(-left)} h`, subColor: "#b91c1c" }
          : { text: `${num(p.nextDueHours)} h`, sub: `faltan ${num(left)} h`, subColor: left <= 100 ? "#b45309" : GRAY };
      }
      if (p.nextDueDate) {
        const n = Math.round((new Date(p.nextDueDate).getTime() - now.getTime()) / DAY_MS);
        return n < 0
          ? { text: fmt(p.nextDueDate), sub: `vencida hace ${-n} días`, subColor: "#b91c1c" }
          : { text: fmt(p.nextDueDate), sub: n <= 30 ? `en ${n} días` : `en ${Math.max(1, Math.round(n / 30))} meses`, subColor: n <= 30 ? "#b45309" : GRAY };
      }
      return { text: "Sin fecha ni horas de referencia" };
    };
    sectionBar("Plan de mantenimiento", "PROC-MAN-02 §4.5 · §4.7",
      plans.length ? `${plans.length} ${plans.length === 1 ? "tarea" : "tareas"} · primero lo vencido` : undefined);
    if (plans.length === 0) {
      emptyNote("Este equipo no tiene tareas en el plan.", "PROC-MAN-02 §4.5: cada equipo lleva su plan, armado sobre el manual del fabricante.");
    } else {
      table(
        [{ label: "Estado", w: 76 }, { label: "Tarea", w: W - 76 - 72 - 70 - 100 }, { label: "Tipo", w: 72 }, { label: "Frecuencia", w: 70 }, { label: "Próximo", w: 100 }],
        sortedPlans.map(p => {
          const st = PLAN_STATUS[p.executionStatus ?? ""] ?? [p.executionStatus ?? "—", "muted" as Tone, "dot" as IconKind, 9];
          const nx = nextText(p);
          return {
            hot: p.executionStatus === "OVERDUE" || p.executionStatus === "DUE",
            cells: [
              { pill: [st[0], st[1], st[2]] },
              { text: txt(p.title), bold: true, sub: p.taskCode, subMono: true },
              { text: p.taskType === "INSPECTION" ? "Inspección" : "Mantenimiento" },
              { text: freqText(p) },
              { text: nx.text, sub: nx.sub, subColor: nx.subColor, color: nx.sub ? INK : GRAY },
            ] as Cell[],
          };
        }),
      );
    }

    // ── Repuestos del equipo ─────────────────────────────────────────────────
    sectionBar("Repuestos del equipo", "PROC-MAN-02 §4.5 · PROC-MAN-04", spares.length ? `${spares.length} en sus tareas` : undefined);
    if (spares.length === 0) {
      emptyNote("Sus tareas no tienen repuestos cargados.", "PROC-MAN-02 §4.5 pide un listado de repuestos por equipo, con stock mínimo para 2 veces el plazo de entrega del fabricante.");
    } else {
      table(
        [{ label: "Repuesto", w: W - 62 - 62 - 110 - 46 }, { label: "En stock", w: 62 }, { label: "Mínimo", w: 62 }, { label: "Estado", w: 110 }, { label: "Tareas", w: 46 }],
        spares.map(s => {
          const low = s.minStock > 0 && s.onHand < s.minStock;
          const st: [string, Tone, IconKind] = s.minStock > 0 ? (low ? ["Bajo el mínimo", "bad", "warn"] : ["Cubierto", "ok", "check"]) : ["Sin mínimo definido", "muted", "dot"];
          const unit = s.unit ? ` ${s.unit}` : "";
          return {
            hot: low,
            cells: [
              { text: txt(s.name), bold: true, sub: s.sku, subMono: true },
              { text: `${num(s.onHand)}${unit}` },
              { text: s.minStock > 0 ? `${num(s.minStock)}${unit}` : "—" },
              { pill: st },
              { text: String(s.tasks) },
            ] as Cell[],
          };
        }),
      );
    }

    // ── Averías e incidencias ────────────────────────────────────────────────
    const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
    const averias = [
      ...defects.map(d => ({
        date: d.reportedAt ? new Date(d.reportedAt).getTime() : 0,
        hot: isOpenDefect(d),
        cells: [
          { text: fmt(d.reportedAt ?? null) }, { text: "Defecto" }, { text: d.defectCode, mono: true },
          { text: clip(txt(d.description), 280) },
          DEFECT_SEVERITY[d.severity ?? ""] ? { pill: DEFECT_SEVERITY[d.severity ?? ""]! } : { text: "—" },
          { pill: DEFECT_STATUS[d.status] ?? [d.status, "muted"] },
        ] as Cell[],
      })),
      ...correctives.map(w => ({
        date: new Date(w.openDate).getTime(),
        hot: isOpenWo(w),
        cells: [
          { text: fmt(w.openDate) }, { text: "OT correctiva" }, { text: w.workOrderCode, mono: true },
          { text: clip(txt(w.title), 280) }, { text: "—", color: GRAY },
          { pill: WO_STATUS[w.status] ?? [w.status, "muted"] },
        ] as Cell[],
      })),
    ].sort((a, b) => b.date - a.date);
    sectionBar("Averías e incidencias", "PROC-MAN-02 §4.5 · PROC-MAN-03", averias.length ? `${averias.length} · la más reciente primero` : undefined);
    if (averias.length === 0) {
      emptyNote("Sin averías registradas.", "Acá aparecen los defectos del equipo y sus OT correctivas.");
    } else {
      table(
        [{ label: "Fecha", w: 54 }, { label: "Tipo", w: 62 }, { label: "N°", w: 92 }, { label: "Descripción", w: W - 54 - 62 - 92 - 56 - 70 }, { label: "Gravedad", w: 56 }, { label: "Estado", w: 70 }],
        averias.map(a => ({ hot: a.hot, cells: a.cells })),
      );
    }

    // ── Análisis de condición ────────────────────────────────────────────────
    sectionBar("Análisis de condición", "PROC-MAN-02 §4.4.2 · §4.8", samples.length ? "últimos 4" : undefined);
    if (samples.length === 0) {
      emptyNote("Sin análisis de condición cargados.", "PROC-MAN-02 §4.8 fija la frecuencia de análisis de aceite por tipo de equipo.");
    } else {
      table(
        [{ label: "Análisis", w: 90 }, { label: "Fecha", w: 58 }, { label: "Tipo", w: 86 }, { label: "Laboratorio", w: W - 90 - 58 - 86 - 110 }, { label: "Resultado", w: 110 }],
        samples.map(s => {
          const v = VERDICT[s.result?.verdict ?? ""];
          return {
            hot: !!v && v[1] === "bad",
            cells: [
              { text: s.sampleCode, mono: true }, { text: fmt(s.sampledAt) }, { text: SAMPLE_KIND[s.kind ?? "FLUID"] ?? "—" },
              { text: txt(s.labName) || "—" },
              { pill: v ? [v[0], v[1], v[2]] : ["Esperando informe", "muted", "clock"] },
            ] as Cell[],
          };
        }),
      );
    }

    // ── Historial de órdenes de trabajo ──────────────────────────────────────
    sectionBar("Historial de órdenes de trabajo", "PROC-MAN-02 §4.9",
      wos.length ? `${wos.length} OT · ${closedWos.length} realizadas · ${openWos.length} abiertas` : undefined);
    if (wos.length === 0) {
      emptyNote("Este equipo todavía no tiene órdenes de trabajo.", "");
    } else {
      const woCells = (w: WoRow): { hot: boolean; cells: Cell[] } => ({
        hot: w.type === "CORRECTIVE" && isOpenWo(w),
        cells: [
          { text: w.workOrderCode, mono: true }, { text: WO_TYPE[w.type] ?? w.type }, { text: txt(w.title) || "—" },
          { text: fmt(w.openDate) }, { text: w.completedDate ? fmt(w.completedDate) : "—" },
          { pill: WO_STATUS[w.status] ?? [w.status, "muted"] },
        ],
      });
      table(
        [{ label: "OT", w: 92 }, { label: "Tipo", w: 62 }, { label: "Descripción", w: W - 92 - 62 - 56 - 60 - 70 }, { label: "Apertura", w: 56 }, { label: "Realización", w: 60 }, { label: "Estado", w: 70 }],
        [
          ...(openWos.length ? [{ group: `Abiertas (${openWos.length})` }, ...openWos.map(woCells)] : []),
          ...(closedWos.length ? [{ group: `Realizadas (${closedWos.length}) · de la más reciente a la más antigua` }, ...closedWos.map(woCells)] : []),
          ...(cancelledWos.length ? [{ group: `Canceladas (${cancelledWos.length})` }, ...cancelledWos.map(woCells)] : []),
        ],
      );
    }

    // ── Número de página (encabezado) y pie en todas las hojas ───────────────
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = 0; i < total; i++) {
      doc.switchToPage(range.start + i);
      if (i === 0) {
        doc.fontSize(7).font("Helvetica-Bold").fillColor(INK)
          .text(`1 de ${total}`, pageNumberSlot.x, pageNumberSlot.y, { width: pageNumberSlot.w, align: "right", lineBreak: false });
      }
      doc.moveTo(ML, FOOTER_Y - 6).lineTo(ML + W, FOOTER_Y - 6).strokeColor(LINE).lineWidth(0.8).stroke();
      doc.fontSize(7).font("Helvetica").fillColor(GRAY)
        .text(`Copilot Management System · Ficha de equipo · ${txt(asset.name)} · ${txt(vesselName)}`, ML, FOOTER_Y, { width: W * 0.75, lineBreak: false, ellipsis: true });
      doc.text(`Página ${i + 1} de ${total}`, ML, FOOTER_Y, { width: W, align: "right", lineBreak: false });
    }

    doc.end();
  });
}
