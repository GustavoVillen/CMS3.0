// PDF de evidencia del Código ISM, Capítulo 10 — Mantenimiento del buque y el
// equipo. Es el papel que se le pone delante al auditor de bandera, a la
// Organización Reconocida o al auditor interno del SGS.
//
// Se organiza POR CLÁUSULA (10.1, 10.2.1 … 10.4), con el texto del Código
// arriba de cada bloque y debajo la evidencia objetiva que sale del PMS.
//
// Reusa los rótulos de métricas del PDF de TMSA para los grupos heredados y
// suma los propios del Capítulo 10.

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText } from "../pms/pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";
import { GROUP_TITLE as TMSA_GROUP_TITLE, METRIC_LABEL as TMSA_METRIC_LABEL } from "../tmsa/tmsa-pdf-service";
import { getIsmChapter10Evidence, type IsmStatus, type IsmMetric } from "./ism-service";

/** Texto del Código para cada cláusula (resumen fiel, no cita literal completa). */
const CLAUSE_TEXT: Record<string, { title: string; text: string }> = {
  "10.1": {
    title: "Conformidad con reglas, reglamentos y requisitos de la Compañía",
    text: "La Compañía debe establecer procedimientos para asegurar que el buque se mantiene de conformidad con las disposiciones de las reglas y los reglamentos pertinentes, así como con cualquier requisito adicional que establezca la Compañía.",
  },
  "10.2.1": {
    title: "Inspecciones a intervalos apropiados",
    text: "Para cumplir con estos requisitos, la Compañía debe garantizar que las inspecciones se realicen a intervalos apropiados.",
  },
  "10.2.2": {
    title: "Notificación de no conformidades con su posible causa",
    text: "Toda no conformidad debe notificarse, indicando su posible causa, si se conoce.",
  },
  "10.2.3": {
    title: "Adopción de medidas correctivas apropiadas",
    text: "Deben adoptarse las medidas correctivas apropiadas.",
  },
  "10.2.4": {
    title: "Conservación de los registros de estas actividades",
    text: "Debe conservarse un registro de estas actividades.",
  },
  "10.3": {
    title: "Equipo crítico y pruebas periódicas",
    text: "La Compañía debe identificar en el SGS el equipo y los sistemas técnicos cuyo fallo repentino pueda ocasionar situaciones peligrosas, y prever medidas concretas para promover su fiabilidad, incluida la prueba periódica de los dispositivos y equipos de reserva o de los sistemas técnicos que no estén en uso continuo.",
  },
  "10.4": {
    title: "Integración en el mantenimiento ordinario",
    text: "Las inspecciones mencionadas en 10.2 y las medidas indicadas en 10.3 deben integrarse en las operaciones ordinarias de mantenimiento del buque.",
  },
};

/** Rótulos de los grupos propios del Capítulo 10 (los heredados salen de TMSA). */
const OWN_GROUP_TITLE: Record<string, string> = {
  regulatoryBasis:    "Base normativa del mantenimiento",
  nonConformity:      "No conformidades y su causa",
  correctiveAction:   "Medidas correctivas",
  maintenanceRecords: "Registros de mantenimiento",
  standbyTesting:     "Fiabilidad y prueba del equipo crítico",
};

const OWN_METRIC_LABEL: Record<string, string> = {
  ismRuleBasedCriteria:        "Tareas con origen de regla o clase",
  ismCompanyCriteria:          "Tareas con origen de la Compañía",
  ismPlansWithoutCriteria:     "Tareas sin origen declarado",
  ismInspectionCriteria:       "Inspecciones con origen (12 m)",
  ismRegulatoryInspections:    "Inspecciones reglamentarias",
  ismCertificatesWithPlan:     "Certificados con plan",
  ismNcOpen:                   "No conformidades abiertas",
  ismNcWithCause:              "Con causa registrada",
  ismNcWithoutCause:           "Sin causa registrada",
  ismAuditFindingsOpen:        "Hallazgos de auditoría abiertos",
  ismInspectionNonConforming:  "Ítems no conformes (12 m)",
  ismDefectsClosed90d:         "Cerradas (90 d)",
  ismClosedWithAction:         "Con medida registrada",
  ismClosedWithoutAction:      "Sin medida registrada",
  ismCorrectiveWoOpen:         "OT correctivas abiertas",
  ismEffectivenessVerified:    "Eficacia verificada",
  ismEffectivenessOverdue:     "Verificación vencida",
  ismCorrectiveActionRate:     "Cobertura de medidas",
  ismWoClosed90d:              "OT cerradas (90 d)",
  ismWorkLogs90d:              "Partes de trabajo (90 d)",
  ismInspectionExecutions90d:  "Inspecciones ejecutadas (90 d)",
  ismMaintenanceAttachments:   "Evidencia adjunta",
  ismRecordCoverage:           "Cobertura de registro",
  ismSafetyCriticalTotal:      "Equipos críticos",
  ismSafetyCriticalWithPlan:   "Con plan activo",
  ismSafetyCriticalWithoutPlan: "Sin plan activo",
  ismStandbyTotal:             "Equipos de reserva",
  ismStandbyWithTest:          "Con prueba periódica",
  ismStandbyWithoutTest:       "Sin prueba periódica",
  ismPreDepartureChecks30d:    "Verificaciones de zarpe (30 d)",
};

const STATUS_TEXT: Record<IsmStatus, string> = { OK: "OK", ATTENTION: "ATENCIÓN", GAP: "BRECHA", INFO: "INFO" };
const STATUS_COLOR: Record<IsmStatus, string> = { OK: "#16a34a", ATTENTION: "#b45309", GAP: "#b91c1c", INFO: "#64748b" };

const groupTitle = (key: string) => OWN_GROUP_TITLE[key] ?? TMSA_GROUP_TITLE[key] ?? key;
const metricLabel = (key: string) => OWN_METRIC_LABEL[key] ?? TMSA_METRIC_LABEL[key] ?? key;

function metricText(m: IsmMetric): string {
  return m.kind === "pct" ? `${Math.round(m.value * 100)}%` : String(m.value);
}

const PAGE_H      = 841.89;
const PAGE_W      = 595.28;
const CM          = 72 / 2.54;
const MARGIN_V    = Math.round(1.5 * CM);
const FOOTER_SIZE = 40;
const CONTENT_BOTTOM = PAGE_H - FOOTER_SIZE - MARGIN_V;

export async function buildIsmChapter10Pdf(
  session: TenantAccessSession,
  vesselCode: string | null,
): Promise<Buffer> {
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const fmtDateTime = (d: Date | string | null | undefined) => fmtDateTimeTz(d, tz, locale);
  const fmt = (d: Date | string | null | undefined) => fmtDateTz(d, tz, locale);

  // "perVessel": igual que el PDF de TMSA, el documento del auditor conserva el
  // desglose barco por barco (ver TmsaEvidenceMode).
  const { items } = await getIsmChapter10Evidence(session, vesselCode, "perVessel");

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

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      bufferPages: true,
      info: { Title: `ISM Cap. 10 — ${tenantName ?? session.tenantSlug}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ML = 48, MR = 48, W = PAGE_W - ML - MR;
    const black = "#0f172a", navy = "#1e3a5f", gray = "#64748b", border = "#e2e8f0", bgBox = "#f8fafc";
    let y = MARGIN_V;

    doc.on("pageAdded", () => { (doc as unknown as { y: number }).y = MARGIN_V; y = MARGIN_V; });
    function ensureSpace(needed: number) {
      if (y + needed > CONTENT_BOTTOM) { doc.addPage(); y = MARGIN_V; }
    }

    // ── Header ───────────────────────────────────────────────────────────────
    const HEADER_H = 64, LOGO_MAX_W = 90;
    if (tenantLogoBuffer) {
      try {
        doc.image(tenantLogoBuffer, ML + W - LOGO_MAX_W, y, { fit: [LOGO_MAX_W, HEADER_H], align: "right", valign: "center" });
      } catch { /* logo unavailable */ }
    }
    const titleW = W - LOGO_MAX_W - 16;
    // 17pt y una sola línea: a 20pt (el tamaño del PDF de TMSA) este título es
    // más largo, se partía en dos y el "10" se montaba sobre el subtítulo.
    doc.fontSize(17).font("Helvetica-Bold").fillColor(navy)
      .text("EVIDENCIA CÓDIGO ISM — CAPÍTULO 10", ML, y + 4, { width: titleW, lineBreak: false });
    doc.fontSize(11).font("Helvetica").fillColor(gray)
      .text("Mantenimiento del buque y el equipo", ML, y + 28, { width: titleW });
    doc.fontSize(8).font("Helvetica").fillColor(gray)
      .text(sanitizePdfText(`${tenantName ?? session.tenantSlug} · Generado: ${fmtDateTime(new Date())}`), ML, y + 46, { width: titleW });
    y += HEADER_H + 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(navy).lineWidth(1.5).stroke();
    y += 14;

    if (items.length === 0) {
      doc.fontSize(10).font("Helvetica").fillColor(gray)
        .text("No hay datos disponibles para el alcance solicitado.", ML, y, { width: W });
      drawFooters();
      doc.end();
      return;
    }

    for (const v of items) {
      ensureSpace(40);
      doc.fontSize(13).font("Helvetica-Bold").fillColor(black)
        .text(sanitizePdfText(v.vesselName), ML, y, { width: W * 0.55 });
      const chips = `OK ${v.summary.ok}   ·   Atención ${v.summary.attention}   ·   Brecha ${v.summary.gap}`;
      doc.fontSize(9).font("Helvetica-Bold").fillColor(gray)
        .text(chips, ML + W * 0.55, y + 2, { width: W * 0.45, align: "right" });
      y += 22;
      doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.7).stroke();
      y += 10;

      // Los grupos ya vienen ordenados por cláusula: se imprime el encabezado
      // del Código cada vez que cambia, y debajo su evidencia.
      let lastClause: string | null = null;
      for (const g of v.groups) {
        if (g.clause !== lastClause) {
          const meta = CLAUSE_TEXT[g.clause];
          const clauseTitle = meta ? `${g.clause} · ${meta.title}` : g.clause;
          const bodyText = sanitizePdfText(meta?.text ?? "");
          doc.fontSize(9).font("Helvetica");
          const textH = bodyText ? doc.heightOfString(bodyText, { width: W - 24 }) : 0;
          // Encabezado de cláusula + su texto entran juntos o pasan de página:
          // un requisito partido de su enunciado no se puede auditar.
          ensureSpace(20 + textH + 12);
          doc.fontSize(10).font("Helvetica-Bold").fillColor(navy)
            .text(sanitizePdfText(clauseTitle.toUpperCase()), ML, y, { width: W });
          y += 14;
          if (bodyText) {
            doc.fontSize(9).font("Helvetica-Oblique").fillColor(gray)
              .text(bodyText, ML + 12, y, { width: W - 24 });
            y += textH + 8;
          }
          lastClause = g.clause;
        }

        const rows = Math.ceil(g.metrics.length / 2);
        const BLOCK_H = 22 + rows * 16 + 8;
        ensureSpace(BLOCK_H + 6);

        doc.roundedRect(ML, y, W, BLOCK_H, 5).fillColor(bgBox).fill();
        doc.roundedRect(ML, y, W, BLOCK_H, 5).strokeColor(border).lineWidth(1).stroke();

        doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
          .text(`ISM ${g.clause}`, ML + 12, y + 8, { characterSpacing: 0.6 });
        doc.fontSize(11).font("Helvetica-Bold").fillColor(black)
          .text(sanitizePdfText(groupTitle(g.key)), ML + 12, y + 17, { width: W * 0.6 });

        const pillW = 62, pillH = 16;
        doc.roundedRect(ML + W - pillW - 12, y + 10, pillW, pillH, 8).fillColor(STATUS_COLOR[g.status]).fill();
        doc.fontSize(8).font("Helvetica-Bold").fillColor("#ffffff")
          .text(STATUS_TEXT[g.status], ML + W - pillW - 12, y + 14, { width: pillW, align: "center", characterSpacing: 0.5 });

        const COL_W = (W - 24) / 2;
        const mTop = y + 36;
        g.metrics.forEach((m, i) => {
          const col = i % 2, row = Math.floor(i / 2);
          const cx = ML + 12 + col * COL_W;
          const cy = mTop + row * 16;
          doc.fontSize(8).font("Helvetica").fillColor(gray)
            .text(sanitizePdfText(metricLabel(m.key)), cx, cy, { width: COL_W - 60 });
          doc.fontSize(9).font("Helvetica-Bold").fillColor(black)
            .text(metricText(m), cx + COL_W - 56, cy, { width: 50, align: "right" });
        });

        y += BLOCK_H + 6;
      }
      y += 10;
    }

    // Disclaimer
    ensureSpace(52);
    doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor(border).lineWidth(0.7).stroke();
    y += 8;
    doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(gray).text(
      sanitizePdfText(
        "Documento de evidencia interna generado a partir del PMS. No constituye una declaración de conformidad con el Código ISM: " +
        "la certificación del Sistema de Gestión de la Seguridad corresponde a la Administración de bandera o a la Organización Reconocida. " +
        "Este reporte reúne los datos objetivos del sistema que respaldan cada cláusula del Capítulo 10.",
      ),
      ML, y, { width: W },
    );

    drawFooters();
    doc.end();

    // Footer en TODAS las páginas (bufferPages + switchToPage).
    function drawFooters() {
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        const footerY = PAGE_H - FOOTER_SIZE;
        doc.moveTo(ML, footerY - 8).lineTo(ML + W, footerY - 8).strokeColor(border).lineWidth(1).stroke();
        if (existsSync(LOGO_PATH)) {
          try { doc.image(LOGO_PATH, ML, footerY - 1, { width: 14, height: 14 }); } catch { /* logo missing */ }
        }
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text("Copilot Management System — Evidencia ISM Capítulo 10", ML + 18, footerY, { width: W / 2 - 18 });
        doc.fontSize(8).font("Helvetica").fillColor(gray)
          .text(sanitizePdfText(`${tenantName ?? session.tenantSlug} · ${fmt(new Date())} · Pág. ${i + 1}/${range.count}`), ML, footerY, { width: W, align: "right" });
      }
      doc.flushPages();
    }
  });
}
