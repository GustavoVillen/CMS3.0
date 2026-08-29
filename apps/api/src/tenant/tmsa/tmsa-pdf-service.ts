// TMSA Elemento 4 (Reliability & Maintenance) → PDF de evidencia.
//
// Documento de soporte para vetting/auditoría: por buque, muestra los grupos
// del Elemento 4 (y adyacentes de mantenimiento) con semáforo + métricas.
// Molde: compliance-pdf-service.ts (misma lib pdfkit, header/footer, logo tenant).
// Muestra el NOMBRE del buque (no el código) — ver regla "Nombres, no códigos".

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getTmsaMaintenanceEvidence, type TmsaStatus, type TmsaMetric } from "./tmsa-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo } from "../pms/pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";


export const GROUP_TITLE: Record<string, string> = {
  pmsCoverage:        "Cobertura del PMS",
  criticalEquipment:  "Equipo crítico",
  plannedMaintenance: "Mantenimiento planificado",
  deferralControl:    "Control de diferimientos",
  criticalSpares:     "Repuestos críticos",
  conditionMonitoring:"Monitoreo de condición (CBM)",
  failureAnalysis:    "Análisis de fallas / RCA",
  managementOfChange: "Gestión del cambio (MOC)",
  drydockSpec:        "Especificación de varada",
  // Grupos agregados después: sin esta entrada el PDF imprimía la clave cruda.
  defectReporting:    "Reporte de defectos",
  certificates:       "Certificados",
  inspections:        "Inspecciones",
  permits:            "Permisos de Trabajo",
  engineeringAudit:   "Auditoría de ingeniería",
};

export const METRIC_LABEL: Record<string, string> = {
  assetsTotal: "Activos totales",
  assetsWithPlan: "Con plan activo",
  assetsWithoutPlan: "Sin plan",
  coverage: "Cobertura",
  criticalAssets: "Activos criticidad A",
  safetyCritical: "Safety-critical (ISM 10.3)",
  criticalOverdueWo: "OT crítica vencida",
  woComplianceRate: "OT en plazo (90d)",
  woOpen: "OT abiertas",
  woOverdue: "OT vencidas",
  woCriticalOverdue: "OT crít. vencida +30d",
  plansOverdue: "Planes vencidos",
  deferralsActive: "Diferimientos activos",
  deferralsWithRisk: "Con riesgo evaluado",
  deferralsWithApproval: "Con aprobación",
  deferralsExpired: "Vencidos aún activos",
  sparesCriticalLow: "Repuesto crít. bajo mínimo",
  spareRequestsPending: "Solicitudes pendientes",
  plansWithSampling: "Planes con muestreo",
  analysesOutOfRange: "Análisis fuera de rango",
  defectsWithRca: "Defectos con RCA",
  recurringAssets: "Activos recurrentes",
  mocOpen: "MOC abiertos",
  mocPendingImpl: "Pend. implementación",
  drydockSpecsOpen: "Specs en curso",
  drydockItemsTotal: "Trabajos listados",
  drydockItemsFromBacklog: "Del backlog",
  deferralsNotInSpec: "Diferidos fuera de la spec",
  defectsTotal: "Defectos registrados",
  defectsStaleOpen: "Abiertos +60d",
  certificatesTotal: "Certificados",
  certificatesExpired: "Vencidos",
  certificatesExpiringSoon: "Por vencer",
  inspectionsTotal: "Inspecciones",
  inspectionsOverdue: "Vencidas sin hacer",
  permitsTotal: "Permisos emitidos",
  permitsDraftStuck: "Borradores trabados",
  auditsLast12m: "Auditorías en 12 meses",
  auditsAtSea: "Hechas en navegación",
};

const STATUS_TEXT: Record<TmsaStatus, string> = { OK: "OK", ATTENTION: "ATENCIÓN", GAP: "BRECHA", INFO: "INFO" };
const STATUS_COLOR: Record<TmsaStatus, string> = { OK: "#16a34a", ATTENTION: "#b45309", GAP: "#b91c1c", INFO: "#64748b" };

function metricText(m: TmsaMetric): string {
  return m.kind === "pct" ? `${Math.round(m.value * 100)}%` : String(m.value);
}

const PAGE_H      = 841.89;
const CM          = 72 / 2.54;
const MARGIN_V    = Math.round(1.5 * CM);
const FOOTER_SIZE = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

export async function buildTmsaMaintenancePdf(
  session: TenantAccessSession,
  vesselCode: string | null,
): Promise<Buffer> {
  // Fechas y horas del documento en la hora de la EMPRESA: el servidor
  // corre en UTC y sin esto el papel salía con la hora del servidor.
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);
  const { items } = await getTmsaMaintenanceEvidence(session, vesselCode);

  let tenantName: string | null = null;
  let tenantLogoBuffer: Buffer | null = null;
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const tenantRow = await (prisma as unknown as { tenant: { findUnique(a: unknown): Promise<{ settings?: { displayName?: string; logoUrl?: string | null; logoUrlLight?: string | null } | null } | null> } }).tenant.findUnique({
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

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: { Title: `TMSA Elemento 4 — ${tenantName ?? session.tenantSlug}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML = 48, MR = 48, PW = 595.28, W = PW - ML - MR;
    const black = "#0f172a", gray = "#64748b", border = "#e2e8f0", bgBox = "#f8fafc";
    let y = ML;

    doc.on("pageAdded", () => { (doc as unknown as { y: number }).y = MARGIN_V; y = MARGIN_V; });
    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_V; }
    }

    // ── Header ────────────────────────────────────────────────────────────────
    const HEADER_H = 64, TENANT_LOGO_MAX_W = 90;
    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + W - TENANT_LOGO_MAX_W, y, { fit: [TENANT_LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
      } catch { /* logo unavailable */ }
    }
    const titleW = W - TENANT_LOGO_MAX_W - 16;
    doc.fontSize(20).font("Helvetica-Bold").fillColor(black)
      .text("EVIDENCIA TMSA — ELEMENTO 4", ML, y + 2, { width: titleW });
    doc.fontSize(11).font("Helvetica").fillColor(gray)
      .text("Reliability & Maintenance Standards", ML, y + 28, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(`${tenantName ?? session.tenantSlug} · Generado: ${fmtDateTime(new Date())}`, ML, y + 46, { width: titleW });
    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(1.5).stroke();
    y += 14;

    if (items.length === 0) {
      doc.fontSize(10).font("Helvetica").fillColor(gray)
        .text("No hay datos disponibles para el alcance solicitado.", ML, y, { width: W });
      drawFooter();
      doc.end();
      return;
    }

    for (const v of items) {
      // Encabezado de buque + resumen (chips OK / Atención / Brecha).
      ensureSpace(40);
      doc.fontSize(13).font("Helvetica-Bold").fillColor(black).text(v.vesselName, ML, y, { width: W * 0.55 });
      const chips = `OK ${v.summary.ok}   ·   Atención ${v.summary.attention}   ·   Brecha ${v.summary.gap}`;
      doc.fontSize(9).font("Helvetica-Bold").fillColor(gray).text(chips, ML + W * 0.55, y + 2, { width: W * 0.45, align: "right" });
      y += 22;
      doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.7).stroke();
      y += 8;

      for (const g of v.groups) {
        // Alto del bloque: título + filas de métricas (2 columnas).
        const rows = Math.ceil(g.metrics.length / 2);
        const BLOCK_H = 22 + rows * 16 + 8;
        ensureSpace(BLOCK_H);

        doc.roundedRect(ML, y, W, BLOCK_H, 5).fillColor(bgBox).fill();
        doc.roundedRect(ML, y, W, BLOCK_H, 5).strokeColor(border).lineWidth(1).stroke();

        // Referencia TMSA + título
        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray).text(`TMSA ${g.element}`, ML + 12, y + 8, { characterSpacing: 0.6 });
        doc.fontSize(11).font("Helvetica-Bold").fillColor(black).text(GROUP_TITLE[g.key] ?? g.key, ML + 12, y + 17, { width: W * 0.6 });

        // Semáforo (pill)
        const st = g.status;
        const pillW = 62, pillH = 16;
        doc.roundedRect(ML + W - pillW - 12, y + 10, pillW, pillH, 8).fillColor(STATUS_COLOR[st]).fill();
        doc.fontSize(8).font("Helvetica-Bold").fillColor("#ffffff")
          .text(STATUS_TEXT[st], ML + W - pillW - 12, y + 14, { width: pillW, align: "center", characterSpacing: 0.5 });

        // Métricas en 2 columnas
        const COL_W = (W - 24) / 2;
        const mTop = y + 36;
        g.metrics.forEach((m, i) => {
          const col = i % 2, row = Math.floor(i / 2);
          const cx = ML + 12 + col * COL_W;
          const cy = mTop + row * 16;
          doc.fontSize(8).font("Helvetica").fillColor(gray).text(METRIC_LABEL[m.key] ?? m.key, cx, cy, { width: COL_W - 60 });
          doc.fontSize(9).font("Helvetica-Bold").fillColor(black).text(metricText(m), cx + COL_W - 56, cy, { width: 50, align: "right" });
        });

        y += BLOCK_H + 6;
      }
      y += 8;
    }

    // Disclaimer
    ensureSpace(46);
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.7).stroke();
    y += 8;
    doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(gray).text(
      "Documento de evidencia interna generado a partir del PMS. El nivel TMSA es una autoevaluación de la compañía; " +
      "este reporte aporta datos objetivos de soporte para el Elemento 4 (Reliability & Maintenance) y elementos adyacentes de mantenimiento (MOC, Defectos/RCA).",
      ML, y, { width: W },
    );

    drawFooter();
    doc.end();

    function drawFooter() {
      const footerY = PAGE_H - FOOTER_SIZE;
      doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
      if (existsSync(LOGO_PATH)) {
        try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* logo missing */ }
      }
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text("Copilot Management System — Evidencia TMSA Elemento 4", ML + 18, footerY, { width: W / 2 - 18 });
      doc.fontSize(8).font("Helvetica").fillColor(gray)
        .text(`${tenantName ?? session.tenantSlug} · ${fmt(new Date())}`, ML, footerY, { width: W, align: "right" });
    }
  });
}
