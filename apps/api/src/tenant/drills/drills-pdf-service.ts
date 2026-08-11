// Drill PDF — registro del simulacro. Título y referencia normativa vienen
// del DrillRequirement asociado (catálogo configurable per-tenant). El
// checklist es genérico (las prácticas específicas se documentan en el
// scenario/observations del drill).
//
// Usa pdfkit igual que el resto de los PDFs del PMS.

import PDFDocument from "pdfkit";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { log } from "../../common/logger";
import type { TenantAccessSession } from "../auth/session-store";
import { getDrill } from "./drills-service";
import { getTenantAiLocale, type AiLocale } from "../ai/ai-locale";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";

type DrillStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED";

const I18N: Record<AiLocale, {
  pdfTitle: string;
  registry: string;
  status: Record<DrillStatus, string>;
  type: string;
  statusLabel: string;
  schedDate: string;
  doneDate: string;
  regRef: string;
  goodPractice: string;
  scenario: string;
  observations: string;
  lessons: string;
  participants: (n: number) => string;
  noParticipants: string;
  noName: string;
  checklistTitle: string;
  applicable: string;
  colItem: string;
  colOk: string;
  colNa: string;
  colObs: string;
  sigDrill: string;
  sigCaptain: string;
  generated: string;
  dateFormatLocale: string;
  drillTitle: string;
  checklist: string[];
}> = {
  es: {
    pdfTitle: "Simulacro",
    registry: "REGISTRO DE SIMULACRO",
    status: { SCHEDULED: "Programado", COMPLETED: "Realizado", CANCELLED: "Cancelado" },
    type: "Tipo",
    statusLabel: "Estado",
    schedDate: "Fecha programada",
    doneDate: "Fecha realizada",
    regRef: "REFERENCIA NORMATIVA",
    goodPractice: "Buena practica maritima.",
    scenario: "Escenario",
    observations: "Observaciones",
    lessons: "Lecciones aprendidas",
    participants: n => `Participantes (${n})`,
    noParticipants: "Sin participantes registrados.",
    noName: "(sin nombre)",
    checklistTitle: "LISTA DE CHEQUEO REGULATORIA",
    applicable: "Aplicable",
    colItem: "ITEM",
    colOk: "OK",
    colNa: "N/A",
    colObs: "OBS.",
    sigDrill: "FIRMA RESPONSABLE DEL SIMULACRO",
    sigCaptain: "FIRMA CAPITAN / OFICIAL DE GUARDIA",
    generated: "Generado",
    dateFormatLocale: "es-AR",
    drillTitle: "Simulacro",
    checklist: [
      "Alarma / inicio del simulacro registrado en bitacora",
      "Briefing pre-drill realizado",
      "Roles y responsabilidades asignados",
      "Equipos necesarios verificados operativos",
      "Comunicaciones internas funcionando",
      "Tiempo de respuesta documentado",
      "Reporte de novedades / heridos / desaparecidos",
      "Stand-down y debriefing al final",
      "Lecciones aprendidas documentadas",
    ],
  },
  en: {
    pdfTitle: "Drill",
    registry: "DRILL RECORD",
    status: { SCHEDULED: "Scheduled", COMPLETED: "Completed", CANCELLED: "Cancelled" },
    type: "Type",
    statusLabel: "Status",
    schedDate: "Scheduled date",
    doneDate: "Completion date",
    regRef: "REGULATORY REFERENCE",
    goodPractice: "Good maritime practice.",
    scenario: "Scenario",
    observations: "Observations",
    lessons: "Lessons learned",
    participants: n => `Participants (${n})`,
    noParticipants: "No participants recorded.",
    noName: "(no name)",
    checklistTitle: "REGULATORY CHECKLIST",
    applicable: "Applicable",
    colItem: "ITEM",
    colOk: "OK",
    colNa: "N/A",
    colObs: "OBS.",
    sigDrill: "DRILL RESPONSIBLE SIGNATURE",
    sigCaptain: "CAPTAIN / WATCH OFFICER SIGNATURE",
    generated: "Generated",
    dateFormatLocale: "en-GB",
    drillTitle: "Drill",
    checklist: [
      "Alarm / drill start recorded in logbook",
      "Pre-drill briefing performed",
      "Roles and responsibilities assigned",
      "Required equipment verified operational",
      "Internal communications working",
      "Response time documented",
      "Status / injuries / missing persons report",
      "Stand-down and debriefing at the end",
      "Lessons learned documented",
    ],
  },
  pt: {
    pdfTitle: "Simulado",
    registry: "REGISTRO DE SIMULADO",
    status: { SCHEDULED: "Programado", COMPLETED: "Realizado", CANCELLED: "Cancelado" },
    type: "Tipo",
    statusLabel: "Estado",
    schedDate: "Data programada",
    doneDate: "Data realizada",
    regRef: "REFERÊNCIA NORMATIVA",
    goodPractice: "Boa prática marítima.",
    scenario: "Cenário",
    observations: "Observações",
    lessons: "Lições aprendidas",
    participants: n => `Participantes (${n})`,
    noParticipants: "Sem participantes registrados.",
    noName: "(sem nome)",
    checklistTitle: "LISTA DE VERIFICAÇÃO REGULATÓRIA",
    applicable: "Aplicável",
    colItem: "ITEM",
    colOk: "OK",
    colNa: "N/A",
    colObs: "OBS.",
    sigDrill: "ASSINATURA RESPONSÁVEL PELO SIMULADO",
    sigCaptain: "ASSINATURA CAPITÃO / OFICIAL DE QUARTO",
    generated: "Gerado",
    dateFormatLocale: "pt-BR",
    drillTitle: "Simulado",
    checklist: [
      "Alarme / início do simulado registrado no diário",
      "Briefing pré-simulado realizado",
      "Funções e responsabilidades atribuídas",
      "Equipamentos necessários verificados operacionais",
      "Comunicações internas funcionando",
      "Tempo de resposta documentado",
      "Relatório de novidades / feridos / desaparecidos",
      "Stand-down e debriefing ao final",
      "Lições aprendidas documentadas",
    ],
  },
};


function fmt(d: Date | string | null | undefined, dateLocale: string, tz: string): string {
  return fmtDateTz(d, tz, dateLocale, "-");
}

/**
 * pdfkit con Helvetica usa WinAnsiEncoding. Caracteres fuera de ese rango
 * (emojis, ciertos simbolos Unicode) producen errores o glifos vacios.
 * Sanitizamos: normalizamos puntuacion unicode comun, quitamos control
 * chars y filtramos lo que esta fuera de Latin-1.
 *
 * Usamos escapes \uXXXX para evitar control chars literales en el regex.
 */
function sanitize(s: string): string {
  // Normalizamos puntuacion unicode comun
  const normalised = s
    .replace(/\r\n/g, "\n")
    .replace(/[‘’‚‛]/g, "'")  // smart single quotes
    .replace(/[“”„‟]/g, '"')  // smart double quotes
    .replace(/[–—−]/g, "-")             // en/em dash, minus
    .replace(/…/g, "...")                          // ellipsis
    .replace(/ /g, " ");                           // nbsp
  // Filtramos por charCode: mantenemos \t \n y Latin-1 imprimible (0x20-0xFF, excluye 0x7F DEL)
  let out = "";
  for (let i = 0; i < normalised.length; i++) {
    const c = normalised.charCodeAt(i);
    if (c === 9 || c === 10 || (c >= 0x20 && c <= 0xFF && c !== 0x7F)) {
      out += normalised[i];
    }
  }
  return out;
}
function val(v: string | null | undefined): string {
  const s = sanitize(v?.trim() || "");
  return s || "-";
}

interface DrillRow {
  id: string; tenantId: string; vesselCode: string; drillCode: string;
  requirementId: string; status: string;
  requirement: { title: string; solasRegulation: string | null } | null;
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
    const crew = await (prisma as unknown as {
      crew: { findMany(a: { where: Record<string, unknown>; select: Record<string, unknown>; orderBy?: unknown }): Promise<Array<{ firstName: string | null; lastName: string | null; rankDefinition: { name: string } | null }>> };
    }).crew.findMany({
      where: { id: { in: ids }, tenantId },
      select: { firstName: true, lastName: true, rankDefinition: { select: { name: true } } },
      orderBy: { lastName: "asc" },
    });
    // Map rankDefinition to rank string for backward compatibility
    return crew.map(c => ({
      firstName: c.firstName,
      lastName: c.lastName,
      rank: c.rankDefinition?.name ?? null,
    }));
  } catch (err) {
    log.warn("[buildDrillPdf] crew lookup failed:", err);
    return [];
  }
}

export async function buildDrillPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  // Fechas en la hora de la EMPRESA (el servidor corre en UTC).
  const { tz } = await resolveTenantTime(session.tenantSlug);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const drill = await getDrill(session, id) as unknown as DrillRow;

  const participantIds = Array.isArray(drill.participantCrewIds)
    ? (drill.participantCrewIds as unknown[]).map(v => String(v ?? "")).filter(Boolean)
    : [];
  const participants = await loadParticipants(prisma, drill.tenantId, participantIds);

  let tenantName = session.tenantSlug;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: session.tenantSlug },
      select: { slug: true },
    });
    if (tenant?.slug) tenantName = tenant.slug;
  } catch (err) {
    log.warn("[buildDrillPdf] tenant lookup failed:", err);
  }
  tenantName = sanitize(tenantName);

  const locale = await getTenantAiLocale(session.tenantSlug);

  try {
    return await renderPdf({ tenantName, drill, participants, locale, tz });
  } catch (err) {
    log.error("[buildDrillPdf] render failed:", err);
    throw new RouteError(500, "PDF_RENDER_FAILED", err instanceof Error ? err.message : "No se pudo generar el PDF.");
  }
}

function renderPdf(ctx: {
  tenantName: string;
  drill: DrillRow;
  participants: Array<{ firstName: string | null; lastName: string | null; rank: string | null }>;
  locale: AiLocale;
  /** Zona horaria de la empresa: las fechas del papel salen con esa hora. */
  tz: string;
}): Promise<Buffer> {
  const { tenantName, drill, participants, locale, tz } = ctx;
  const L = I18N[locale];

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: sanitize(`${L.drillTitle} ${drill.drillCode}`) } });
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

    function setFont(size: number, bold = false) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    }

    function ensureSpace(needed: number) {
      if (y + needed > PH - 80) { doc.addPage(); y = MARGIN_V; }
    }

    // ── Header ──
    doc.rect(0, 0, PW, 60).fillColor(navy).fill();
    setFont(8, true);
    doc.fillColor("#94a3b8")
      .text(tenantName.toUpperCase(), ML, 18, { width: W, characterSpacing: 1.5 });
    setFont(16, true);
    doc.fillColor("#ffffff")
      .text(L.registry, ML, 32, { width: W });
    y = 80;

    // ── Identificacion ──
    doc.rect(ML, y, W, 22).fillColor(navy).fill();
    setFont(9, true);
    doc.fillColor("#ffffff")
      .text(sanitize(`${drill.drillCode}  -  ${drill.vesselCode}`), ML + 10, y + 7, { width: W - 20 });
    y += 22;

    function rowPair(l1: string, v1: string, l2: string, v2: string) {
      const colW = W / 2;
      ensureSpace(22);
      doc.rect(ML, y, colW, 22).strokeColor(border).lineWidth(0.5).stroke();
      doc.rect(ML + colW, y, colW, 22).strokeColor(border).lineWidth(0.5).stroke();
      setFont(7, true);
      doc.fillColor(gray)
        .text(sanitize(l1.toUpperCase()), ML + 8, y + 4, { width: colW - 16, characterSpacing: 0.8 });
      setFont(9.5, false);
      doc.fillColor(black)
        .text(val(v1), ML + 8, y + 14, { width: colW - 16 });
      setFont(7, true);
      doc.fillColor(gray)
        .text(sanitize(l2.toUpperCase()), ML + colW + 8, y + 4, { width: colW - 16, characterSpacing: 0.8 });
      setFont(9.5, false);
      doc.fillColor(black)
        .text(val(v2), ML + colW + 8, y + 14, { width: colW - 16 });
      y += 22;
    }

    const reqTitle = drill.requirement?.title ?? "-";
    const statusLbl = L.status[drill.status as DrillStatus] ?? drill.status;
    rowPair(L.type, reqTitle, L.statusLabel, statusLbl);
    rowPair(L.schedDate, fmt(drill.scheduledDate, L.dateFormatLocale, tz), L.doneDate, fmt(drill.completedDate, L.dateFormatLocale, tz));

    // ── Referencia normativa ──
    y += 6;
    const ref = drill.requirement?.solasRegulation ?? "-";
    setFont(9.5, false);
    const refH = doc.heightOfString(ref, { width: W - 16, lineGap: 2 }) + 30;
    ensureSpace(refH);
    doc.rect(ML, y, W, refH).fillColor(bgBox).fill();
    setFont(7, true);
    doc.fillColor(navy)
      .text(L.regRef, ML + 8, y + 6, { characterSpacing: 0.8 });
    setFont(9.5, false);
    doc.fillColor(black)
      .text(ref, ML + 8, y + 18, { width: W - 16, lineGap: 2 });
    y += refH + 6;

    // ── Bloque de texto generico ──
    function textBlock(label: string, value: string) {
      const text = val(value);
      const labelH = 14;
      setFont(9.5, false);
      const bodyH  = Math.max(40, doc.heightOfString(text, { width: W - 16, lineGap: 3 }) + 16);
      ensureSpace(labelH + bodyH + 4);
      doc.rect(ML, y, W, labelH).fillColor(navy).fill();
      setFont(7, true);
      doc.fillColor("#ffffff")
        .text(sanitize(label.toUpperCase()), ML + 8, y + 4, { width: W - 16, characterSpacing: 0.8 });
      y += labelH;
      doc.rect(ML, y, W, bodyH).strokeColor(border).lineWidth(0.5).stroke();
      setFont(9.5, false);
      doc.fillColor(black)
        .text(text, ML + 8, y + 8, { width: W - 16, lineGap: 3 });
      y += bodyH + 4;
    }

    textBlock(L.scenario, drill.scenario ?? "");
    textBlock(L.observations, drill.observations ?? "");
    textBlock(L.lessons, drill.lessonsLearned ?? "");

    // ── Participantes ──
    const partLabel = L.participants(participants.length);
    const partRows = participants.length > 0
      ? participants.map((p, i) => {
          const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || L.noName;
          const rank = p.rank ?? "-";
          return `${i + 1}. ${name} - ${rank}`;
        }).join("\n")
      : L.noParticipants;
    textBlock(partLabel, partRows);

    // ── Lista de chequeo regulatoria (segun SOLAS / ISPS / MARPOL / IAMSAR) ──
    const checklist = L.checklist;
    if (checklist && checklist.length > 0) {
      // Header de la seccion (mismo estilo que textBlock pero sin caja blanca)
      const labelH = 14;
      ensureSpace(labelH + 12);
      doc.rect(ML, y, W, labelH).fillColor(navy).fill();
      setFont(7, true);
      doc.fillColor("#ffffff")
        .text(L.checklistTitle, ML + 8, y + 4, { width: W - 16, characterSpacing: 0.8 });
      y += labelH;

      // Subtitulo: norma aplicable
      setFont(7, false);
      doc.fillColor(gray)
        .text(`${L.applicable}: ${sanitize(drill.requirement?.solasRegulation ?? L.goodPractice)}`,
          ML + 8, y + 2, { width: W - 16, lineGap: 1 });
      y += 14;

      // Items con checkbox manual + "OK" / "N/A" columns
      const colCheckW = 14;
      const colTextW  = W - colCheckW - 100;
      const colOkW    = 30;
      const colNaW    = 30;
      const colNotesW = 32;
      const rowH      = 16;

      // Header de columnas
      ensureSpace(rowH + 4);
      setFont(6.5, true);
      doc.fillColor(gray);
      doc.text("#",     ML + 2,                                    y + 4, { width: colCheckW, align: "center", characterSpacing: 0.4 });
      doc.text(L.colItem,  ML + colCheckW + 4,                     y + 4, { width: colTextW, characterSpacing: 0.4 });
      doc.text(L.colOk,    ML + colCheckW + colTextW + 8,          y + 4, { width: colOkW, align: "center", characterSpacing: 0.4 });
      doc.text(L.colNa,    ML + colCheckW + colTextW + colOkW + 12, y + 4, { width: colNaW, align: "center", characterSpacing: 0.4 });
      doc.text(L.colObs,   ML + colCheckW + colTextW + colOkW + colNaW + 16, y + 4, { width: colNotesW, align: "center", characterSpacing: 0.4 });
      doc.moveTo(ML, y + rowH).lineTo(ML + W, y + rowH).strokeColor(border).lineWidth(0.5).stroke();
      y += rowH;

      // Filas
      checklist.forEach((item, idx) => {
        setFont(9, false);
        const textHeight = doc.heightOfString(sanitize(item), { width: colTextW - 8 });
        const thisRowH = Math.max(rowH, textHeight + 6);
        ensureSpace(thisRowH);

        // Bordes laterales y bottom de la fila
        doc.moveTo(ML, y + thisRowH).lineTo(ML + W, y + thisRowH).strokeColor("#e2e8f0").lineWidth(0.3).stroke();

        // Numero
        setFont(8, true);
        doc.fillColor(gray)
          .text(String(idx + 1), ML + 2, y + 4, { width: colCheckW, align: "center" });

        // Texto del item
        setFont(9, false);
        doc.fillColor(black)
          .text(sanitize(item), ML + colCheckW + 4, y + 3, { width: colTextW - 8, lineGap: 1 });

        // Checkbox OK
        doc.rect(ML + colCheckW + colTextW + 17, y + 3, 10, 10).strokeColor(border).lineWidth(0.5).stroke();
        // Checkbox N/A
        doc.rect(ML + colCheckW + colTextW + colOkW + 22, y + 3, 10, 10).strokeColor(border).lineWidth(0.5).stroke();
        // Espacio observaciones (linea)
        doc.moveTo(ML + colCheckW + colTextW + colOkW + colNaW + 18, y + thisRowH - 4)
           .lineTo(ML + W - 4, y + thisRowH - 4).strokeColor("#cbd5e1").lineWidth(0.3).stroke();

        y += thisRowH;
      });
      y += 8;
    }

    // ── Firmas ──
    y += 10;
    const sigW = (W - 20) / 2;
    ensureSpace(70);
    doc.rect(ML, y, sigW, 60).strokeColor(border).lineWidth(0.5).stroke();
    doc.rect(ML + sigW + 20, y, sigW, 60).strokeColor(border).lineWidth(0.5).stroke();
    setFont(7, true);
    doc.fillColor(gray)
      .text(L.sigDrill, ML + 8, y + 6, { width: sigW - 16, characterSpacing: 0.8 });
    doc.text(L.sigCaptain, ML + sigW + 28, y + 6, { width: sigW - 16, characterSpacing: 0.8 });
    y += 60;

    // ── Footer ──
    const footerY = PH - 38;
    setFont(7, false);
    doc.fillColor(gray)
      .text(
        sanitize(`${L.generated}: ${fmtDateTimeTz(new Date(), tz, L.dateFormatLocale)}   -   ${drill.drillCode}   -   ${tenantName}`),
        ML, footerY, { width: W, align: "center" }
      );

    doc.end();
  });
}
