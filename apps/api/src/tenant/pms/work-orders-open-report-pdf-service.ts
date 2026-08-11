// PDF: Reporte de OTs abiertas agrupadas por Responsable
// Incluye PLANNED + IN_PROGRESS (badges "Abierta" y "Vencida"), excluye
// ON_HOLD/CLOSED/CANCELLED/DEFERRED.

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText } from "./pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz } from "../../common/tenant-time";

// ── Layout (A4 landscape, columnas anchas para nombres largos) ──
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
const AMBER  = "#B45309";
const GREEN  = "#166534";

const SIN_RESPONSABLE = "Sin responsable asignado";


function typeShort(t: string): string {
  if (t === "INSPECTION") return "Inspección";
  if (t === "CORRECTIVE") return "Reparación";
  return "Mantenimiento";
}

function priorityLabel(p: string): string {
  const m: Record<string, string> = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica" };
  return m[p] ?? p;
}

interface OpenWoRow {
  id: string;
  workOrderCode: string;
  vesselCode: string;
  assetName: string | null;
  title: string | null;
  type: string;
  priority: string;
  status: string;
  openDate: Date | string;
  dueDate: Date | string | null;
  assignedToUserId: string | null;
  assignedToUserName: string | null;
  responsibleLabel: string;
  isOverdue: boolean;
}

export async function buildOpenWorkOrdersReportPdf(
  session: TenantAccessSession,
  options: { vesselCode?: string | null } = {},
): Promise<Buffer> {
  // Fechas y horas del documento en la hora de la EMPRESA: el servidor
  // corre en UTC y sin esto el papel salía con la hora del servidor.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDate = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new Error("Database unavailable");
  const requestedVessel = options.vesselCode?.trim() || null;

  // Resolver tenantId
  const tenantRow = await (prismaRaw as any).tenant.findUnique({
    where: { slug: session.tenantSlug },
    select: {
      id: true,
      settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true, workOrderPdfTemplate: true } },
    },
  });
  if (!tenantRow) throw new Error("Tenant not found");
  const tenantId = tenantRow.id;
  const tenantName: string | null = tenantRow.settings?.displayName ?? null;
  // "MERCURIO_OT" (REGI-OPE-26.3, vigente) y "MERCURIO" (anterior, conservado
  // para poder volver atrás) comparten el estilo del documento controlado.
  const isMercurio = !!tenantRow.settings?.workOrderPdfTemplate?.startsWith("MERCURIO");
  const tenantLogoBuffer = await resolveTenantLogo(
    session.tenantSlug,
    tenantRow.settings?.logoUrl,
    tenantRow.settings?.logoUrlLight,
  );

  // Filtro de scope por vessel asignado
  const where: Record<string, unknown> = {
    tenantId,
    deletedAt: null,
    status: { in: ["PLANNED", "IN_PROGRESS"] },
  };
  // Vessel scope: combina el filtro pedido con el scope del usuario
  if (session.user.role === "TENANT_ADMIN") {
    if (requestedVessel) where.vesselCode = requestedVessel;
  } else if (requestedVessel) {
    if (!session.user.assignedVesselCodes.includes(requestedVessel)) {
      where.vesselCode = "__NO_ASSIGNED_VESSEL__";
    } else {
      where.vesselCode = requestedVessel;
    }
  } else if (session.user.assignedVesselCodes.length === 0) {
    where.vesselCode = "__NO_ASSIGNED_VESSEL__";
  } else {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }

  const orders = await (prismaRaw as any).workOrder.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { openDate: "desc" }],
  });

  // Resolver assets y users (igual que listTenantWorkOrders)
  const assetIds = [...new Set(orders.map((o: any) => o.assetId).filter(Boolean))] as string[];
  const userIds  = [...new Set(orders.map((o: any) => o.assignedToUserId).filter((v: any): v is string => !!v))] as string[];

  const [assetRows, userRows] = await Promise.all([
    assetIds.length > 0
      ? (prismaRaw as any).asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, name: true } })
      : Promise.resolve([]),
    userIds.length > 0
      ? (prismaRaw as any).user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
      : Promise.resolve([]),
  ]);

  const assetNameMap = new Map<string, string | null>(assetRows.map((a: any) => [a.id, a.name ?? null]));
  const userNameMap  = new Map<string, string | null>(userRows.map((u: any) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || null]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows: OpenWoRow[] = orders.map((o: any) => {
    const assignedToUserName = userNameMap.get(o.assignedToUserId ?? "") ?? null;
    const responsibleLabel = assignedToUserName ?? o.assignedToUserId ?? SIN_RESPONSABLE;
    const isOverdue = !!o.dueDate && new Date(o.dueDate) < today;
    return {
      id: o.id,
      workOrderCode: o.workOrderCode,
      vesselCode: o.vesselCode,
      assetName: assetNameMap.get(o.assetId) ?? null,
      title: o.title ?? null,
      type: o.type,
      priority: o.priority,
      status: o.status,
      openDate: o.openDate,
      dueDate: o.dueDate,
      assignedToUserId: o.assignedToUserId ?? null,
      assignedToUserName,
      responsibleLabel,
      isOverdue,
    };
  });

  // Agrupar por responsable
  const groups = new Map<string, OpenWoRow[]>();
  for (const r of rows) {
    const arr = groups.get(r.responsibleLabel) ?? [];
    arr.push(r);
    groups.set(r.responsibleLabel, arr);
  }
  // Orden: responsables alfabéticos primero, "Sin responsable" al final
  const groupKeys = [...groups.keys()].sort((a, b) => {
    if (a === SIN_RESPONSABLE) return 1;
    if (b === SIN_RESPONSABLE) return -1;
    return a.localeCompare(b, "es");
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 0,
      info: { Title: `OTs Abiertas — ${session.tenantSlug}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = MARGIN_T;
    let page = 1;

    // ── Helpers ────────────────────────────────────────────────────────
    function ensureSpace(h: number) {
      if (y + h > CONTENT_BOTTOM) { drawFooter(); doc.addPage({ size: "A4", layout: "landscape", margin: 0 }); }
    }

    function cell(cx: number, cy: number, cw: number, ch: number, text: string, opts: {
      bold?: boolean; fontSize?: number; align?: "left" | "center" | "right";
      bg?: string; color?: string; wrap?: boolean;
    } = {}) {
      if (opts.bg) doc.rect(cx, cy, cw, ch).fillColor(opts.bg).fill();
      doc.rect(cx, cy, cw, ch).strokeColor(BORDER).lineWidth(0.4).stroke();
      if (text) {
        const fs = opts.fontSize ?? 9;
        const ty = opts.wrap ? cy + 3 : cy + (ch - fs) / 2;
        doc.fontSize(fs)
          .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
          .fillColor(opts.color ?? BLACK)
          .text(text, cx + 4, ty, {
            width: cw - 8,
            align: opts.align ?? "left",
            lineBreak: !!opts.wrap,
            ellipsis: !opts.wrap,
          });
      }
    }

    function drawFooter() {
      const fy = PAGE_H - FOOTER_H;
      doc.moveTo(ML, fy).lineTo(ML + W, fy).strokeColor(BORDER).lineWidth(0.5).stroke();
      let textX = ML;
      if (existsSync(LOGO_PATH)) {
        try { doc.image(LOGO_PATH, ML, fy + 6, { width: 12, height: 12 }); textX = ML + 16; } catch {}
      }
      doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
        .text("Copilot Management System", textX, fy + 8, { width: W / 2, lineBreak: false });
      doc.fontSize(7).font("Helvetica").fillColor(GRAY)
        .text(`OTs Abiertas — Página ${page} — ${fmtDate(new Date())}`,
          ML, fy + 8, { width: W, align: "right" });
    }

    doc.on("pageAdded", () => { page++; y = MARGIN_T; });

    // ── HEADER ──────────────────────────────────────────────────────────
    const HDR_H = 56;
    doc.rect(ML, y, W, HDR_H).strokeColor(BORDER).lineWidth(0.8).stroke();

    const LOGO_W = 110;
    doc.rect(ML, y, LOGO_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, ML + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" }); } catch {}
    } else if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML + 4, y + 4, { fit: [LOGO_W - 8, HDR_H - 8], align: "center", valign: "center" }); } catch {}
    } else {
      doc.fontSize(9).font("Helvetica-Bold").fillColor(NAVY)
        .text(sanitizePdfText(tenantName ?? session.tenantSlug.toUpperCase()), ML + 4, y + 22, { width: LOGO_W - 8, align: "center" });
    }

    const TITLE_W = W - LOGO_W - 180;
    doc.rect(ML + LOGO_W, y, TITLE_W, HDR_H).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(14).font("Helvetica-Bold").fillColor(NAVY)
      .text("Reporte de Órdenes de Trabajo Abiertas", ML + LOGO_W + 8, y + 12, { width: TITLE_W - 16, align: "center" });
    const scopeText = requestedVessel
      ? `Embarcación: ${requestedVessel} — agrupadas por responsable (incluye OTs vencidas)`
      : "Todas las embarcaciones — agrupadas por responsable (incluye OTs vencidas)";
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
      .text("Total OTs:", INFO_X + 6, y + halfH + 4, { lineBreak: false });
    doc.fontSize(10).font("Helvetica-Bold").fillColor(BLACK)
      .text(String(rows.length), INFO_X + 6, y + halfH + 14, { width: INFO_W - 12, lineBreak: false });

    y += HDR_H + 10;

    if (rows.length === 0) {
      doc.fontSize(11).font("Helvetica").fillColor(GRAY)
        .text("No hay órdenes de trabajo abiertas.", ML, y + 30, { width: W, align: "center" });
      drawFooter();
      doc.end();
      return;
    }

    // ── Columnas de la tabla ────────────────────────────────────────────
    // Código | Embarcación | Equipo / Tarea | Tipo | Prioridad | F. Apertura | F. Vencimiento | Estado
    const cols = [
      { key: "code",    title: "Código",          w: Math.floor(W * 0.13) },
      { key: "vessel",  title: "Embarc.",         w: Math.floor(W * 0.07) },
      { key: "asset",   title: "Equipo / Tarea",  w: Math.floor(W * 0.36) },
      { key: "type",    title: "Categoría",       w: Math.floor(W * 0.10) },
      { key: "prio",    title: "Prioridad",       w: Math.floor(W * 0.08) },
      { key: "open",    title: "F. Apertura",     w: Math.floor(W * 0.08) },
      { key: "due",     title: "F. Vencimiento",  w: Math.floor(W * 0.09) },
    ];
    // Última columna toma resto
    const usedW = cols.reduce((s, c) => s + c.w, 0);
    const lastW = W - usedW;
    cols.push({ key: "status", title: "Estado", w: lastW });

    function drawTableHeader() {
      const HH = 18;
      let cx = ML;
      for (const col of cols) {
        cell(cx, y, col.w, HH, col.title, { bold: true, fontSize: 8, bg: NAVY, color: WHITE, align: "center" });
        cx += col.w;
      }
      y += HH;
    }

    function drawRow(r: OpenWoRow) {
      const HH = 28;
      ensureSpace(HH);
      let cx = ML;
      // Código + vessel (separado en 2 líneas dentro del código)
      cell(cx, y, cols[0].w, HH, sanitizePdfText(r.workOrderCode), { fontSize: 8, bold: true });
      cx += cols[0].w;
      cell(cx, y, cols[1].w, HH, sanitizePdfText(r.vesselCode), { fontSize: 8, align: "center" });
      cx += cols[1].w;
      // Equipo / Tarea (2 líneas: asset + title)
      const assetText = r.assetName ?? "—";
      const titleText = r.title?.trim() ?? "";
      doc.rect(cx, y, cols[2].w, HH).strokeColor(BORDER).lineWidth(0.4).stroke();
      doc.fontSize(8).font("Helvetica-Bold").fillColor(BLACK)
        .text(sanitizePdfText(assetText), cx + 4, y + 4, { width: cols[2].w - 8, lineBreak: false, ellipsis: true });
      if (titleText) {
        doc.fontSize(7).font("Helvetica").fillColor(GRAY)
          .text(sanitizePdfText(titleText), cx + 4, y + 16, { width: cols[2].w - 8, lineBreak: false, ellipsis: true });
      }
      cx += cols[2].w;
      cell(cx, y, cols[3].w, HH, typeShort(r.type), { fontSize: 8, align: "center" });
      cx += cols[3].w;
      cell(cx, y, cols[4].w, HH, priorityLabel(r.priority), { fontSize: 8, align: "center", bold: r.priority === "HIGH" || r.priority === "CRITICAL", color: r.priority === "CRITICAL" ? RED : r.priority === "HIGH" ? AMBER : BLACK });
      cx += cols[4].w;
      cell(cx, y, cols[5].w, HH, fmtDate(r.openDate), { fontSize: 8, align: "center" });
      cx += cols[5].w;
      cell(cx, y, cols[6].w, HH, fmtDate(r.dueDate), { fontSize: 8, align: "center", bold: r.isOverdue, color: r.isOverdue ? RED : BLACK });
      cx += cols[6].w;
      const statusLbl = r.isOverdue ? "Vencida" : "Abierta";
      const statusColor = r.isOverdue ? RED : GREEN;
      cell(cx, y, cols[7].w, HH, statusLbl, { fontSize: 8, bold: true, align: "center", color: statusColor });
      y += HH;
    }

    // ── Render por grupo ────────────────────────────────────────────────
    for (const responsible of groupKeys) {
      const items = groups.get(responsible)!;
      // Header del grupo
      ensureSpace(24 + 18 + 28); // header + table header + 1 row
      const GH = 22;
      doc.rect(ML, y, W, GH).fillColor("#1E3A8A").fill();
      doc.rect(ML, y, W, GH).strokeColor(BORDER).lineWidth(0.4).stroke();
      const overdueCount = items.filter(i => i.isOverdue).length;
      const summary = overdueCount > 0
        ? `${items.length} OT${items.length !== 1 ? "s" : ""} (${overdueCount} vencida${overdueCount !== 1 ? "s" : ""})`
        : `${items.length} OT${items.length !== 1 ? "s" : ""}`;
      doc.fontSize(11).font("Helvetica-Bold").fillColor(WHITE)
        .text(`Responsable: ${sanitizePdfText(responsible)}`, ML + 8, y + 6, { width: W - 200, lineBreak: false });
      doc.fontSize(9).font("Helvetica").fillColor(WHITE)
        .text(summary, ML + W - 200, y + 7, { width: 192, align: "right", lineBreak: false });
      y += GH;

      // Header de tabla
      drawTableHeader();
      // Filas
      for (const r of items) drawRow(r);
      y += 8; // separación entre grupos
    }

    // ── Bloque de firmas (solo Mercurio) ────────────────────────────────
    if (isMercurio) {
      const SIGN_H = 38;
      ensureSpace(SIGN_H + 12);
      y += 12;
      const colW = Math.floor(W / 3);
      const labels = [
        "Elaborado: Mercurio Group",
        "Revisado: Asesoría Jurídica",
        "Aprobado: Gerente General",
      ];
      labels.forEach((label, i) => {
        const cx = ML + i * colW;
        const cw = i === 2 ? W - 2 * colW : colW;
        doc.rect(cx, y, cw, SIGN_H).fillColor("#F3F4F6").fill();
        doc.rect(cx, y, cw, SIGN_H).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.fontSize(8).font("Helvetica-Bold").fillColor(BLACK)
          .text(sanitizePdfText(label), cx + 6, y + (SIGN_H - 8) / 2, { width: cw - 12, align: "center", lineBreak: false });
      });
      y += SIGN_H;
    }

    drawFooter();
    doc.end();
  });
}
