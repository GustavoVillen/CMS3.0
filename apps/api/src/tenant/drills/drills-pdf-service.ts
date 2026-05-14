// Drill PDF — registro del simulacro con datos visibles en pantalla
// más la referencia regulatoria del tipo.
//
// Usa pdfkit igual que el resto de los PDFs del PMS.

import PDFDocument from "pdfkit";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getDrill } from "./drills-service";

const DRILL_TYPE_LABEL: Record<string, string> = {
  FIRE:           "Incendio",
  ABANDON_SHIP:   "Abandono de buque",
  ENCLOSED_SPACE: "Espacios confinados",
  MAN_OVERBOARD:  "Hombre al agua",
  POLLUTION:      "Contaminación",
  OIL_SPILL:      "Derrame de combustible",
  SECURITY:       "Seguridad (ISPS)",
  MEDICAL:        "Emergencia médica",
  STEERING_GEAR:  "Gobierno de emergencia",
  BLACKOUT:       "Blackout / dead ship",
  OTHER:          "Otro",
};

const DRILL_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Programado",
  COMPLETED: "Realizado",
  CANCELLED: "Cancelado",
};

const DRILL_REGULATORY_REF: Record<string, string> = {
  FIRE:           "SOLAS III/19.3.2 — drill mensual contra incendio.",
  ABANDON_SHIP:   "SOLAS III/19.3.2 y 19.3.3.1 — abandono mensual; dentro de 24 h si >25% de tripulación es nueva.",
  ENCLOSED_SPACE: "SOLAS III/19.3.3.3 (MSC.350(92)) — entrada y rescate cada 2 meses.",
  MAN_OVERBOARD:  "SOLAS V/26 + práctica recomendada — maniobra Williamson / Anderson.",
  POLLUTION:      "MARPOL Anexo I Reg. 37 + SOPEP — ejercicio trimestral.",
  OIL_SPILL:      "MARPOL Anexo I + SOPEP/SMPEP. OPA 90 para aguas USA.",
  SECURITY:       "ISPS Code A/13.4 — drill trimestral; exercise anual del SSP.",
  MEDICAL:        "MLC 2006 + SMS de la compañía. Ref: IMGS / WHO Medical Guide for Ships.",
  STEERING_GEAR:  "SOLAS V/26.4 — prueba trimestral del aparato de gobierno de emergencia.",
  BLACKOUT:       "SMS de la compañía + buena práctica (dead-ship recovery).",
  OTHER:          "Buena práctica marítima y SMS de la compañía.",
};

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-AR");
}

function val(v: string | null | undefined): string {
  return (v?.trim() || "—");
}

interface DrillRow {
  id: string; tenantId: string; vesselCode: string; drillCode: string;
  type: string; status: string;
  scheduledDate: Date | string; completedDate: Date | string | null;
  scenario: string | null; observations: string | null; lessonsLearned: string | null;
  participantCrewIds: unknown;
}

async function loadParticipants(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  ids: string[],
): Promise<Array<{ firstName: string | null; lastName: string | null; rank: string | null }>> {
  if (ids.length === 0) return [];
  try {
    return await (prisma as unknown as {
      crew: { findMany(a: { where: Record<string, unknown>; select: Record<string, boolean>; orderBy?: unknown }): Promise<Array<{ firstName: string | null; lastName: string | null; rank: string | null }>> };
    }).crew.findMany({
      where: { id: { in: ids }, tenantId },
      select: { firstName: true, lastName: true, rank: true },
      orderBy: { lastName: "asc" },
    });
  } catch {
    return [];
  }
}

export async function buildDrillPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const drill = await getDrill(session, id) as DrillRow;

  const participantIds = Array.isArray(drill.participantCrewIds)
    ? (drill.participantCrewIds as unknown[]).map(v => String(v ?? "")).filter(Boolean)
    : [];
  const participants = await loadParticipants(prisma, drill.tenantId, participantIds);

  const tenant = await prisma.tenant.findUnique({
    where: { slug: session.tenantSlug },
    select: { name: true },
  });
  const tenantName = tenant?.name ?? session.tenantSlug;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Simulacro ${drill.drillCode}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW = 595.28, PH = 841.89;
    const ML = 48, MR = 48;
    const W  = PW - ML - MR;
    const navy = "#0f2744", black = "#0f172a", gray = "#64748b", border = "#cbd5e1", bgBox = "#f8fafc";

    const MARGIN_V = 42;
    let y = MARGIN_V;

    doc.on("pageAdded", () => { y = MARGIN_V; });

    function ensureSpace(needed: number) {
      if (y + needed > PH - 80) { doc.addPage(); y = MARGIN_V; }
    }

    // ── Header ──
    doc.rect(0, 0, PW, 60).fillColor(navy).fill();
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8")
      .text(tenantName.toUpperCase(), ML, 18, { width: W, characterSpacing: 1.5 });
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#ffffff")
      .text("REGISTRO DE SIMULACRO", ML, 32, { width: W });
    y = 80;

    // ── Identificación ──
    doc.fillColor(black);
    doc.rect(ML, y, W, 22).fillColor(navy).fill();
    doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold")
      .text(`${drill.drillCode}  ·  ${drill.vesselCode}`, ML + 10, y + 7, { width: W - 20 });
    y += 22;

    function row(label: string, value: string) {
      const colW = W / 2;
      ensureSpace(22);
      doc.rect(ML, y, W, 22).strokeColor(border).lineWidth(0.5).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(label.toUpperCase(), ML + 8, y + 4, { width: colW - 16, characterSpacing: 0.8 });
      doc.fontSize(9.5).font("Helvetica").fillColor(black)
        .text(value, ML + 8, y + 14, { width: colW - 16 });
      y += 22;
    }

    function rowPair(l1: string, v1: string, l2: string, v2: string) {
      const colW = W / 2;
      ensureSpace(22);
      doc.rect(ML, y, colW, 22).strokeColor(border).lineWidth(0.5).stroke();
      doc.rect(ML + colW, y, colW, 22).strokeColor(border).lineWidth(0.5).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(l1.toUpperCase(), ML + 8, y + 4, { width: colW - 16, characterSpacing: 0.8 });
      doc.fontSize(9.5).font("Helvetica").fillColor(black)
        .text(v1, ML + 8, y + 14, { width: colW - 16 });
      doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
        .text(l2.toUpperCase(), ML + colW + 8, y + 4, { width: colW - 16, characterSpacing: 0.8 });
      doc.fontSize(9.5).font("Helvetica").fillColor(black)
        .text(v2, ML + colW + 8, y + 14, { width: colW - 16 });
      y += 22;
    }

    rowPair("Tipo", DRILL_TYPE_LABEL[drill.type] ?? drill.type, "Estado", DRILL_STATUS_LABEL[drill.status] ?? drill.status);
    rowPair("Fecha programada", fmt(drill.scheduledDate), "Fecha realizada", fmt(drill.completedDate));

    // ── Referencia normativa ──
    y += 6;
    const ref = DRILL_REGULATORY_REF[drill.type] ?? "—";
    const refH = doc.heightOfString(ref, { width: W - 16, lineGap: 2 }) + 30;
    ensureSpace(refH);
    doc.rect(ML, y, W, refH).fillColor(bgBox).fill();
    doc.fontSize(7).font("Helvetica-Bold").fillColor(navy)
      .text("REFERENCIA NORMATIVA", ML + 8, y + 6, { characterSpacing: 0.8 });
    doc.fontSize(9.5).font("Helvetica").fillColor(black)
      .text(ref, ML + 8, y + 18, { width: W - 16, lineGap: 2 });
    y += refH + 6;

    // ── Sección bloque de texto ──
    function textBlock(label: string, value: string) {
      const text = val(value);
      const labelH = 14;
      const bodyH  = Math.max(40, doc.heightOfString(text, { width: W - 16, lineGap: 3 }) + 16);
      ensureSpace(labelH + bodyH + 4);
      doc.rect(ML, y, W, labelH).fillColor(navy).fill();
      doc.fontSize(7).font("Helvetica-Bold").fillColor("#ffffff")
        .text(label.toUpperCase(), ML + 8, y + 4, { width: W - 16, characterSpacing: 0.8 });
      y += labelH;
      doc.rect(ML, y, W, bodyH).strokeColor(border).lineWidth(0.5).stroke();
      doc.fontSize(9.5).font("Helvetica").fillColor(black)
        .text(text, ML + 8, y + 8, { width: W - 16, lineGap: 3 });
      y += bodyH + 4;
    }

    textBlock("Escenario", drill.scenario ?? "");
    textBlock("Observaciones", drill.observations ?? "");
    textBlock("Lecciones aprendidas", drill.lessonsLearned ?? "");

    // ── Participantes ──
    const partLabel = `Participantes (${participants.length})`;
    const partRows = participants.length > 0
      ? participants.map((p, i) => {
          const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || "(sin nombre)";
          const rank = p.rank ?? "—";
          return `${i + 1}. ${name} — ${rank}`;
        }).join("\n")
      : "Sin participantes registrados.";
    textBlock(partLabel, partRows);

    // ── Firmas ──
    y += 10;
    const sigW = (W - 20) / 2;
    ensureSpace(70);
    doc.rect(ML, y, sigW, 60).strokeColor(border).lineWidth(0.5).stroke();
    doc.rect(ML + sigW + 20, y, sigW, 60).strokeColor(border).lineWidth(0.5).stroke();
    doc.fontSize(7).font("Helvetica-Bold").fillColor(gray)
      .text("FIRMA RESPONSABLE DEL SIMULACRO", ML + 8, y + 6, { width: sigW - 16, characterSpacing: 0.8 });
    doc.text("FIRMA CAPITÁN / OFICIAL DE GUARDIA", ML + sigW + 28, y + 6, { width: sigW - 16, characterSpacing: 0.8 });
    y += 60;

    // ── Footer ──
    const footerY = PH - 38;
    doc.fontSize(7).font("Helvetica").fillColor(gray)
      .text(`Generado: ${new Date().toLocaleString("es-AR")}   ·   ${drill.drillCode}   ·   ${tenantName}`,
        ML, footerY, { width: W, align: "center" });

    doc.end();
  });
}
