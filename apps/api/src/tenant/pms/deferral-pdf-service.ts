import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getDeferral } from "./deferrals-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo } from "./pdf-helpers";

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-AR");
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-AR");
}

function val(v: string | null | undefined): string {
  return v?.trim() || "—";
}

function daysBetween(from: Date | string | null | undefined, to: Date | string | null | undefined): string {
  if (!from || !to) return "—";
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b)) return "—";
  const days = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return `${days} día${days === 1 ? "" : "s"}`;
}

const STATUS_LABEL: Record<string, string> = {
  REQUESTED:    "Solicitado",
  UNDER_REVIEW: "En revisión",
  APPROVED:     "Aprobado",
  REJECTED:     "Rechazado",
  ACTIVE:       "Activo",
  EXPIRED:      "Vencido",
  CLOSED:       "Cerrado",
};

const STATUS_COLOR: Record<string, string> = {
  REQUESTED:    "#0369a1",
  UNDER_REVIEW: "#6d28d9",
  APPROVED:     "#0f766e",
  REJECTED:     "#b91c1c",
  ACTIVE:       "#166534",
  EXPIRED:      "#475569",
  CLOSED:       "#166534",
};

const SOURCE_TYPE_LABEL: Record<string, string> = {
  WORK_ORDER:       "Orden de trabajo",
  DEFECT:           "Defecto",
  MAINTENANCE_PLAN: "Plan de mantenimiento",
};

const PAGE_H        = 841.89;
const CM            = 72 / 2.54;
const MARGIN_V      = Math.round(1.5 * CM);
const FOOTER_SIZE   = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

export async function buildDeferralPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const deferral = await getDeferral(session, id);

  // Resolve source code + label + task description
  let sourceCode:  string | null = null;
  let sourceTitle: string | null = null;
  let sourceTask:  string | null = null;
  const prismaRaw = getPrismaClient();
  let tenantId: string | null = null;
  if (prismaRaw) {
    try {
      const t = await (prismaRaw as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { id: true },
      });
      tenantId = t?.id ?? null;
    } catch { /* non-blocking */ }

    try {
      if (deferral.sourceType === "WORK_ORDER" && tenantId) {
        const wo = await (prismaRaw as any).workOrder.findFirst({ where: { id: deferral.sourceId, tenantId }, select: { workOrderCode: true, title: true, description: true } });
        sourceCode  = wo?.workOrderCode ?? null;
        sourceTitle = wo?.title ?? null;
        sourceTask  = wo?.description ?? null;
      } else if (deferral.sourceType === "DEFECT" && tenantId) {
        const def = await (prismaRaw as any).defect.findFirst({ where: { id: deferral.sourceId, tenantId }, select: { defectCode: true, classification: true, description: true } });
        sourceCode  = def?.defectCode ?? null;
        sourceTitle = def?.classification ?? null;
        sourceTask  = def?.description ?? null;
      } else if (deferral.sourceType === "MAINTENANCE_PLAN" && tenantId) {
        const mp = await (prismaRaw as any).maintenancePlan.findFirst({ where: { id: deferral.sourceId, tenantId }, select: { taskCode: true, title: true, description: true } });
        sourceCode  = mp?.taskCode ?? null;
        sourceTitle = mp?.title ?? null;
        sourceTask  = mp?.description ?? null;
      }
    } catch { /* non-blocking */ }
  }

  // Resolve user names (requester, decider) — filtered to users that
  // are members of this tenant, so cross-tenant userIds (theoretical
  // legacy data) don't leak names/emails.
  let requestedByName: string | null = null;
  let decidedByName:   string | null = null;
  if (prismaRaw && tenantId) {
    try {
      const userIds = [deferral.requestedByUserId, deferral.decidedByUserId].filter((x): x is string => Boolean(x));
      if (userIds.length > 0) {
        const users = await (prismaRaw as any).user.findMany({
          where: { id: { in: userIds }, memberships: { some: { tenantId, status: "ACTIVE" } } },
          select: { id: true, firstName: true, lastName: true, email: true },
        });
        const nameById = new Map<string, string>(users.map((u: any) => {
          const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
          return [u.id, fullName || u.email || u.id];
        }));
        requestedByName = nameById.get(deferral.requestedByUserId) ?? null;
        if (deferral.decidedByUserId) decidedByName = nameById.get(deferral.decidedByUserId) ?? null;
      }
    } catch { /* non-blocking */ }
  }

  // Tenant logo
  let tenant: { name?: string; logoUrl?: string | null; logoUrlLight?: string | null } | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  if (prismaRaw) {
    try {
      const tenantRow = await (prismaRaw as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      tenant = tenantRow?.settings
        ? { name: tenantRow.settings.displayName, logoUrl: tenantRow.settings.logoUrl, logoUrlLight: tenantRow.settings.logoUrlLight }
        : null;
      tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, tenant?.logoUrl, tenant?.logoUrlLight);
    } catch { /* non-blocking */ }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: deferral.deferralCode } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML       = 48;
    const MR       = 48;
    const PW       = 595.28;
    const W        = PW - ML - MR;
    const black    = "#0f172a";
    const navy     = "#1e3a5f";
    const gray     = "#64748b";
    const lightGray = "#94a3b8";
    const border   = "#e2e8f0";
    const bgBox    = "#f8fafc";
    const accentBg = "#eff6ff";

    let y = ML;

    doc.on("pageAdded", () => { (doc as any).y = MARGIN_V; y = MARGIN_V; });

    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_V; }
    }

    // ── Header ────────────────────────────────────────────────────────────────
    const HEADER_H = 64;
    const LOGO_MAX_W = 90;

    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, ML + W - LOGO_MAX_W, y, { fit: [LOGO_MAX_W, HEADER_H], align: "right", valign: "center" }); } catch {}
    }

    const titleW = W - LOGO_MAX_W - 16;
    doc.fontSize(22).font("Helvetica-Bold").fillColor(navy)
      .text("APLAZAMIENTO", ML, y + 2, { width: titleW });
    doc.fontSize(13).font("Helvetica-Bold").fillColor(navy)
      .text(deferral.deferralCode, ML, y + 30, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`Generado: ${fmtDateTime(new Date())}`, ML, y + 48, { width: titleW });

    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(navy).lineWidth(2).stroke();
    y += 16;

    // ── Status badge + key dates strip ────────────────────────────────────────
    const statusText  = STATUS_LABEL[deferral.status] ?? deferral.status;
    const statusColor = STATUS_COLOR[deferral.status] ?? "#475569";
    doc.roundedRect(ML, y, 110, 22, 4).fill(statusColor);
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#ffffff").text(statusText, ML, y + 6, { width: 110, align: "center" });

    // Days deferred summary on the right
    const daysLabel = daysBetween(deferral.requestedAt, deferral.targetDate);
    doc.fontSize(8).font("Helvetica").fillColor(gray).text("DURACIÓN ESTIMADA:", ML + W - 200, y + 4, { width: 200, align: "right" });
    doc.fontSize(11).font("Helvetica-Bold").fillColor(navy).text(daysLabel, ML + W - 200, y + 14, { width: 200, align: "right" });

    y += 38;

    // ── labeledBox helper ────────────────────────────────────────────────────
    function labeledBox(x: number, yy: number, w: number, h: number, label: string, content: string, color = black, bg = bgBox) {
      doc.roundedRect(x, yy, w, h, 6).fill(bg).stroke(border);
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray).text(label.toUpperCase(), x + 8, yy + 7, { width: w - 16 });
      doc.fontSize(10).font("Helvetica-Bold").fillColor(color).text(content, x + 8, yy + 21, { width: w - 16 });
    }

    // ── Section title helper ─────────────────────────────────────────────────
    function sectionTitle(text: string) {
      ensureSpace(24);
      doc.fontSize(9).font("Helvetica-Bold").fillColor(navy).text(text.toUpperCase(), ML, y, { width: W });
      y += 13;
      doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.5).stroke();
      y += 8;
    }

    // ── INFORMACIÓN GENERAL ──────────────────────────────────────────────────
    sectionTitle("Información general");

    // Row 1: vessel + asset
    ensureSpace(58);
    labeledBox(ML,           y, W / 2 - 6, 48, "Buque",  deferral.vesselCode, "#0369a1", accentBg);
    labeledBox(ML + W/2 + 6, y, W / 2 - 6, 48, "Activo", val(deferral.assetName));
    y += 56;

    // Row 2: source type + source code
    ensureSpace(58);
    const srcTypeLabel = SOURCE_TYPE_LABEL[deferral.sourceType] ?? deferral.sourceType;
    labeledBox(ML,           y, W / 2 - 6, 48, "Tipo de origen", srcTypeLabel);
    labeledBox(ML + W/2 + 6, y, W / 2 - 6, 48, "Código origen",  val(sourceCode));
    y += 56;

    // Row 3: source title (full width if exists)
    if (sourceTitle) {
      ensureSpace(50);
      labeledBox(ML, y, W, 44, "Detalle del origen", sourceTitle);
      y += 52;
    }

    // Row 4: inherited task description (full width, dynamic height)
    if (sourceTask) {
      const taskLabel = deferral.sourceType === "WORK_ORDER" ? "Tarea de la OT"
        : deferral.sourceType === "MAINTENANCE_PLAN" ? "Descripción del plan"
        : "Descripción del defecto";
      textBlock(taskLabel, sourceTask);
    }

    // ── FECHAS Y RESPONSABLE ─────────────────────────────────────────────────
    sectionTitle("Fechas y responsable");

    // Row 4: requested at + target date
    ensureSpace(58);
    labeledBox(ML,           y, W / 2 - 6, 48, "Fecha de solicitud", fmt(deferral.requestedAt));
    labeledBox(ML + W/2 + 6, y, W / 2 - 6, 48, "Fecha objetivo",     fmt(deferral.targetDate), deferral.targetDate ? "#b45309" : black);
    y += 56;

    // Row 5: requested by
    if (requestedByName) {
      ensureSpace(50);
      labeledBox(ML, y, W, 44, "Solicitado por", requestedByName);
      y += 52;
    }

    // ── JUSTIFICACIÓN Y MEDIDAS COMPENSATORIAS (always visible) ──────────────
    sectionTitle("Análisis técnico");

    // Text block helper — always renders, even with "—"
    function textBlock(label: string, content: string, opts: { highlight?: boolean } = {}) {
      const text     = content || "—";
      const padding  = 10;
      const titleH   = 18;
      const innerW   = W - padding * 2;

      // Measure actual rendered height (handles word wrapping)
      doc.fontSize(9).font("Helvetica");
      const textH    = doc.heightOfString(text, { width: innerW, lineGap: 2 });
      const boxH     = titleH + textH + padding * 2;
      const needed   = boxH + 6;
      ensureSpace(needed);

      const bg = opts.highlight ? accentBg : bgBox;
      doc.roundedRect(ML, y, W, boxH, 6).fill(bg).stroke(border);
      doc.fontSize(8).font("Helvetica-Bold").fillColor(opts.highlight ? "#0369a1" : gray)
        .text(label.toUpperCase(), ML + padding, y + padding, { width: innerW });
      doc.fontSize(9).font("Helvetica").fillColor(content && content !== "—" ? black : lightGray)
        .text(text, ML + padding, y + padding + titleH, { width: innerW, lineGap: 2 });
      y += needed;
    }

    textBlock("Justificación",          val(deferral.justification));
    textBlock("Medidas compensatorias", val(deferral.compensatoryMeasures), { highlight: true });

    // ── DECISIÓN (only if relevant) ──────────────────────────────────────────
    const hasDecision = deferral.decisionAt
      || deferral.reviewNotes
      || deferral.rejectionReason
      || deferral.activeSince
      || deferral.closedAt
      || deferral.closeNotes;

    if (hasDecision) {
      sectionTitle("Decisión y trazabilidad");

      // Decision dates
      if (deferral.decisionAt || deferral.activeSince || deferral.closedAt) {
        ensureSpace(58);
        const cellW = (W - 12) / 3;
        labeledBox(ML,                   y, cellW, 48, "Decisión",      fmt(deferral.decisionAt));
        labeledBox(ML + cellW + 6,       y, cellW, 48, "Activo desde",  fmt(deferral.activeSince));
        labeledBox(ML + (cellW + 6) * 2, y, cellW, 48, "Cerrado",       fmt(deferral.closedAt));
        y += 56;
      }

      if (decidedByName) {
        ensureSpace(50);
        labeledBox(ML, y, W, 44, "Decidido por", decidedByName);
        y += 52;
      }

      if (deferral.reviewNotes)     textBlock("Notas de revisión",   val(deferral.reviewNotes));
      if (deferral.rejectionReason) textBlock("Motivo de rechazo",   val(deferral.rejectionReason));
      if (deferral.closeNotes)      textBlock("Notas de cierre",     val(deferral.closeNotes));
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = PAGE_H - FOOTER_SIZE;
    doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch {}
    }
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text("Copilot Management System — Documento generado automáticamente.", ML + 18, footerY, { width: W / 2 - 18 });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`${deferral.deferralCode} · ${deferral.vesselCode} · ${fmt(new Date())}`, ML, footerY, { width: W, align: "right" });

    doc.end();
  });
}
