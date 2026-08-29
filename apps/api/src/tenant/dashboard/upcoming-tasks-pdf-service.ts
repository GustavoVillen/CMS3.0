// PDF: "Tareas pendientes — hasta el domingo de la semana que viene".
// Es la versión imprimible de la ventanita del Dashboard: misma fuente de datos
// (getUpcomingTasks), mismos tres bloques (Vencido / Esta semana / Próxima
// semana), para colgar en la sala de máquinas o llevarla a la reunión.
//
// Tabla plana: cada fila entra en una altura fija y el texto largo se recorta con
// ellipsis, así que no hay cajas de texto libre multi-página (no aplica
// renderLabeledTextBox; ver skill pms-pdf-generation).

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText } from "../pms/pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz } from "../../common/tenant-time";
import { getUpcomingTasks, type UpcomingTaskItem, type UpcomingTaskBucket } from "./upcoming-tasks-service";

// ── Layout (A4 apaisado, igual que el reporte de OT abiertas) ──
const PW       = 841.89;
const PAGE_H   = 595.28;
const ML       = 32;
const MR       = 32;
const W        = PW - ML - MR;
const MARGIN_T = 32;
const FOOTER_H = 26;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 6;

const NAVY   = "#0C2461";
const WHITE  = "#FFFFFF";
const BLACK  = "#111827";
const GRAY   = "#6B7280";
const BORDER = "#9CA3AF";
const RED    = "#B91C1C";

const BUCKETS: { key: UpcomingTaskBucket; label: string; color: string }[] = [
  { key: "OVERDUE",   label: "Vencido",         color: "#991B1B" },
  { key: "THIS_WEEK", label: "Esta semana",     color: "#1E3A8A" },
  { key: "NEXT_WEEK", label: "Próxima semana",  color: "#334155" },
];

const STATUS_LABELS: Record<string, string> = {
  OVERDUE: "Vencido",
  DUE: "Vence",
  IN_WINDOW: "En ventana",
  UPCOMING: "Próximo",
  PLANNED: "Planificada",
  IN_PROGRESS: "En ejecución",
  ON_HOLD: "En espera",
};

export async function buildUpcomingTasksPdf(
  session: TenantAccessSession,
  options: { vesselCode?: string | null } = {},
): Promise<Buffer> {
  // Fechas en la hora de la EMPRESA: el servidor corre en UTC.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDate = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new Error("Database unavailable");
  const requestedVessel = options.vesselCode?.trim() || null;

  const data = await getUpcomingTasks(session, { vesselCode: requestedVessel });

  const tenantRow = await (prismaRaw as any).tenant.findUnique({
    where: { slug: session.tenantSlug },
    select: { id: true, settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
  });
  if (!tenantRow) throw new Error("Tenant not found");
  const tenantId = tenantRow.id;
  const tenantName: string | null = tenantRow.settings?.displayName ?? null;
  const tenantLogoBuffer = await resolveTenantLogo(
    session.tenantSlug,
    tenantRow.settings?.logoUrl,
    tenantRow.settings?.logoUrlLight,
  );

  // Nombres, no códigos: el papel muestra "DON CHICUETO", no "DCH".
  const vesselCodes = [...new Set(data.items.map(i => i.vesselCode).filter(Boolean))];
  const assetIds    = [...new Set(data.items.map(i => i.assetId).filter(Boolean))];
  const [vesselRows, assetRows] = await Promise.all([
    vesselCodes.length
      ? (prismaRaw as any).vessel.findMany({ where: { tenantId, code: { in: vesselCodes } }, select: { code: true, name: true } })
      : Promise.resolve([]),
    assetIds.length
      ? (prismaRaw as any).asset.findMany({ where: { tenantId, id: { in: assetIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const vesselNameMap = new Map<string, string>(vesselRows.map((v: any) => [v.code, v.name ?? v.code]));
  const assetNameMap  = new Map<string, string>(assetRows.map((a: any) => [a.id, a.name ?? ""]));

  const scopeName = requestedVessel ? (vesselNameMap.get(requestedVessel) ?? requestedVessel) : null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 0,
      info: { Title: `Tareas pendientes — ${session.tenantSlug}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = MARGIN_T;
    let page = 1;

    function ensureSpace(h: number) {
      if (y + h > CONTENT_BOTTOM) { drawFooter(); doc.addPage({ size: "A4", layout: "landscape", margin: 0 }); }
    }

    function cell(cx: number, cy: number, cw: number, ch: number, text: string, opts: {
      bold?: boolean; fontSize?: number; align?: "left" | "center" | "right";
      bg?: string; color?: string;
    } = {}) {
      if (opts.bg) doc.rect(cx, cy, cw, ch).fillColor(opts.bg).fill();
      doc.rect(cx, cy, cw, ch).strokeColor(BORDER).lineWidth(0.4).stroke();
      if (text) {
        const fs = opts.fontSize ?? 8;
        doc.fontSize(fs).font(opts.bold ? "Helvetica-Bold" : "Helvetica");
        doc.fillColor(opts.color ?? BLACK)
          .text(fitOneLine(text, cw - 8), cx + 4, cy + (ch - fs) / 2, {
            width: cw - 8,
            align: opts.align ?? "left",
            lineBreak: false,
          });
      }
    }

    /** Una fila = una línea. Los títulos largos (o con saltos propios) se
     *  recortan a mano: con lineBreak:false pdfkit igual parte en los saltos y
     *  la segunda línea se salía de la celda. */
    function fitOneLine(text: string, maxWidth: number): string {
      const flat = text.replace(/\s+/g, " ").trim();
      if (doc.widthOfString(flat) <= maxWidth) return flat;
      let lo = 0;
      let hi = flat.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (doc.widthOfString(`${flat.slice(0, mid)}...`) <= maxWidth) lo = mid; else hi = mid - 1;
      }
      return `${flat.slice(0, lo).trimEnd()}...`;
    }

    function drawFooter() {
      const fy = PAGE_H - FOOTER_H;
      doc.moveTo(ML, fy).lineTo(ML + W, fy).strokeColor(BORDER).lineWidth(0.5).stroke();
      let textX = ML;
      if (existsSync(LOGO_PATH)) {
        try { doc.image(LOGO_PATH, ML, fy + 6, { width: 12, height: 12 }); textX = ML + 16; } catch { /* logo opcional */ }
      }
      doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
        .text("Copilot Management System", textX, fy + 8, { width: W / 2, lineBreak: false });
      doc.fontSize(7).font("Helvetica").fillColor(GRAY)
        .text(`Tareas pendientes — Página ${page} — ${fmtDate(new Date())}`,
          ML, fy + 8, { width: W, align: "right" });
    }

    doc.on("pageAdded", () => { page++; y = MARGIN_T; });

    // ── Encabezado ──────────────────────────────────────────────────────────
    const HDR_H = 56;
    doc.rect(ML, y, W, HDR_H).strokeColor(BORDER).lineWidth(0.8).stroke();

    const LOGO_W = 110;
    doc.rect(ML, y, LOGO_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, ML + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" }); } catch { /* logo opcional */ }
    } else if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" }); } catch { /* logo opcional */ }
    } else {
      doc.fontSize(9).font("Helvetica-Bold").fillColor(NAVY)
        .text(sanitizePdfText(tenantName ?? session.tenantSlug.toUpperCase()), ML + 4, y + 22, { width: LOGO_W - 8, align: "center" });
    }

    const TITLE_W = W - LOGO_W - 180;
    doc.rect(ML + LOGO_W, y, TITLE_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(14).font("Helvetica-Bold").fillColor(NAVY)
      .text("Tareas Pendientes — Próxima Semana", ML + LOGO_W + 8, y + 12, { width: TITLE_W - 16, align: "center" });
    const scopeText = `${scopeName ? `Embarcación: ${sanitizePdfText(scopeName)}` : "Toda la flota"} — vencidas + todo lo que vence hasta el ${fmtDate(data.windowEnd)}`;
    doc.fontSize(9).font("Helvetica").fillColor(BLACK)
      .text(scopeText, ML + LOGO_W + 8, y + 32, { width: TITLE_W - 16, align: "center" });

    const INFO_X = ML + LOGO_W + TITLE_W;
    const INFO_W = 180;
    doc.rect(INFO_X, y, INFO_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    const halfH = HDR_H / 2;
    doc.rect(INFO_X, y + halfH, INFO_W, halfH).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(8).font("Helvetica").fillColor(GRAY)
      .text("Generado:", INFO_X + 6, y + 6, { lineBreak: false });
    doc.fontSize(10).font("Helvetica-Bold").fillColor(BLACK)
      .text(fmtDate(new Date()), INFO_X + 6, y + 16, { width: INFO_W - 12, lineBreak: false });
    doc.fontSize(8).font("Helvetica").fillColor(GRAY)
      .text("Total tareas:", INFO_X + 6, y + halfH + 4, { lineBreak: false });
    doc.fontSize(10).font("Helvetica-Bold").fillColor(BLACK)
      .text(`${data.totals.total}  (${data.totals.overdue} vencidas)`, INFO_X + 6, y + halfH + 14, { width: INFO_W - 12, lineBreak: false });

    y += HDR_H + 10;

    if (data.items.length === 0) {
      doc.fontSize(11).font("Helvetica").fillColor(GRAY)
        .text("No hay tareas pendientes para la próxima semana.", ML, y + 30, { width: W, align: "center" });
      drawFooter();
      doc.end();
      return;
    }

    // ── Columnas ────────────────────────────────────────────────────────────
    const cols = [
      { key: "origin", title: "Origen",        w: Math.floor(W * 0.07) },
      { key: "code",   title: "Código",        w: Math.floor(W * 0.13) },
      { key: "vessel", title: "Embarcación",   w: Math.floor(W * 0.14) },
      { key: "asset",  title: "Equipo",        w: Math.floor(W * 0.20) },
      { key: "task",   title: "Tarea",         w: Math.floor(W * 0.29) },
      { key: "due",    title: "Vencimiento",   w: Math.floor(W * 0.10) },
    ];
    const usedW = cols.reduce((s, c) => s + c.w, 0);
    cols.push({ key: "status", title: "Estado", w: W - usedW });

    function drawTableHeader() {
      const HH = 18;
      let cx = ML;
      for (const col of cols) {
        cell(cx, y, col.w, HH, col.title, { bold: true, fontSize: 8, bg: NAVY, color: WHITE, align: "center" });
        cx += col.w;
      }
      y += HH;
    }

    function drawRow(item: UpcomingTaskItem, overdue: boolean) {
      const HH = 18;
      // Al saltar de página, la tabla arranca con su encabezado de columnas.
      if (y + HH > CONTENT_BOTTOM) { ensureSpace(HH); drawTableHeader(); }
      const dueText = item.dueDate
        ? fmtDate(item.dueDate)
        : item.dueHours != null ? `${item.dueHours.toLocaleString("es-AR")} hs` : "—";
      let cx = ML;
      cell(cx, y, cols[0].w, HH, item.kind === "PLAN" ? "Plan" : "OT", { fontSize: 8, align: "center", bold: true });
      cx += cols[0].w;
      cell(cx, y, cols[1].w, HH, sanitizePdfText(item.code), { fontSize: 8, bold: true });
      cx += cols[1].w;
      cell(cx, y, cols[2].w, HH, sanitizePdfText(vesselNameMap.get(item.vesselCode) ?? item.vesselCode), { fontSize: 8 });
      cx += cols[2].w;
      cell(cx, y, cols[3].w, HH, sanitizePdfText(assetNameMap.get(item.assetId) ?? "—"), { fontSize: 8 });
      cx += cols[3].w;
      cell(cx, y, cols[4].w, HH, sanitizePdfText(item.title), { fontSize: 8 });
      cx += cols[4].w;
      cell(cx, y, cols[5].w, HH, dueText, { fontSize: 8, align: "center", bold: overdue, color: overdue ? RED : BLACK });
      cx += cols[5].w;
      cell(cx, y, cols[6].w, HH, STATUS_LABELS[item.status] ?? item.status, { fontSize: 8, align: "center", color: overdue ? RED : BLACK });
      y += HH;
    }

    // ── Bloques ─────────────────────────────────────────────────────────────
    for (const bucket of BUCKETS) {
      const items = data.items.filter(i => i.bucket === bucket.key);
      if (items.length === 0) continue;

      ensureSpace(22 + 18 + 18); // header de grupo + header de tabla + 1 fila
      const GH = 22;
      doc.rect(ML, y, W, GH).fillColor(bucket.color).fill();
      doc.rect(ML, y, W, GH).strokeColor(BORDER).lineWidth(0.4).stroke();
      doc.fontSize(11).font("Helvetica-Bold").fillColor(WHITE)
        .text(bucket.label.toUpperCase(), ML + 8, y + 6, { width: W - 200, lineBreak: false });
      doc.fontSize(9).font("Helvetica").fillColor(WHITE)
        .text(`${items.length} tarea${items.length !== 1 ? "s" : ""}`, ML + W - 200, y + 7, { width: 192, align: "right", lineBreak: false });
      y += GH;

      drawTableHeader();
      for (const item of items) drawRow(item, bucket.key === "OVERDUE");
      y += 8;
    }

    drawFooter();
    doc.end();
  });
}
