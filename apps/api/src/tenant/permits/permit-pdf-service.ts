import PDFDocument from "pdfkit";
import type { TenantAccessSession } from "../auth/session-store";
import { getPermit } from "./permits-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { resolveTenantLogo } from "../pms/pdf-helpers";

/**
 * PDF imprimible para Permit to Work. SOLAS/class lo exigen impreso y firmado a bordo
 * (no basta con el registro electrónico). Diseñado A4, formato clásico de PTW marítimo.
 */

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}
function val(v: string | null | undefined): string {
  return v?.trim() ? String(v).trim() : "—";
}

const TYPE_LABEL: Record<string, string> = {
  HOT_WORK: "TRABAJO EN CALIENTE",
  ENCLOSED_SPACE_ENTRY: "ENTRADA A ESPACIO CONFINADO",
  WORKING_ALOFT: "TRABAJO EN ALTURA",
  ELECTRICAL_ISOLATION: "AISLAMIENTO ELÉCTRICO",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "BORRADOR",
  REQUESTED: "SOLICITADO",
  APPROVED: "APROBADO",
  REJECTED: "RECHAZADO",
  ACTIVE: "ACTIVO",
  CLOSED: "CERRADO",
  CANCELLED: "CANCELADO",
};

const ROLE_LABEL: Record<string, string> = {
  PERFORMER: "Ejecutante",
  FIRE_WATCH: "Vigía de fuego",
  STAND_BY: "Stand-by",
  ATTENDANT: "Atendente",
  SUPERVISOR: "Supervisor",
};

interface GasTest {
  testedAt: Date;
  testedByName: string;
  location: string | null;
  o2Pct: number | null;
  lelPct: number | null;
  h2sPpm: number | null;
  coPpm: number | null;
  verdict: string;
  notes: string | null;
}
interface Participant {
  name: string;
  role: string;
}
interface Permit {
  id: string;
  permitCode: string;
  vesselCode: string;
  type: string;
  status: string;
  location: string;
  description: string;
  plannedStart: Date;
  plannedEnd: Date;
  validFrom: Date | null;
  validTo: Date | null;
  hazardsIdentified: string | null;
  controlMeasures: string | null;
  ppeRequired: string | null;
  details: Record<string, unknown> | null;
  requestedAt: Date | null;
  approvedAt: Date | null;
  activatedAt: Date | null;
  closedAt: Date | null;
  closeNotes: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  gasTests: GasTest[];
  participants: Participant[];
}

export async function buildPermitPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const permit = await getPermit(session, id) as unknown as Permit;

  // Tenant logo
  let tenantLogoBuffer: Buffer | null = null;
  let tenantName: string | undefined;
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const tenantRow = await (prisma as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      tenantName = tenantRow?.settings?.displayName;
      tenantLogoBuffer = await resolveTenantLogo(
        session.tenantSlug,
        tenantRow?.settings?.logoUrl,
        tenantRow?.settings?.logoUrlLight,
      );
    } catch { /* non-blocking */ }
  }

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: permit.permitCode } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header ────────────────────────────────────────────────────────────────
    if (tenantLogoBuffer) {
      try { doc.image(tenantLogoBuffer, 40, 32, { width: 50 }); } catch { /* non-blocking */ }
    }
    doc.fontSize(9).fillColor("#475569").text(tenantName ?? "GPMS", 100, 38);
    doc.fontSize(16).fillColor("#0f172a").font("Helvetica-Bold")
      .text("PERMISO DE TRABAJO", 0, 35, { align: "center" });
    doc.fontSize(11).fillColor("#475569").font("Helvetica")
      .text(TYPE_LABEL[permit.type] ?? permit.type, 0, 55, { align: "center" });

    doc.fontSize(10).fillColor("#0f172a").font("Helvetica-Bold")
      .text(`Nº ${permit.permitCode}`, 40, 80, { width: 515, align: "right" });
    doc.fontSize(9).fillColor("#0369a1")
      .text(`ESTADO: ${STATUS_LABEL[permit.status] ?? permit.status}`, 40, 95, { width: 515, align: "right" });

    doc.moveTo(40, 115).lineTo(555, 115).strokeColor("#cbd5e1").lineWidth(1).stroke();

    // Geometría de página + tracker de cursor.
    // IMPORTANTE: pdfkit auto-pagina cuando un text() largo desborda. Si no
    // sincronizamos `y = doc.y` después de cada text(), `y` queda apuntando
    // al "pasado" de la página vieja y los siguientes elementos se dibujan
    // off-page, generando hojas en blanco en cascada. Fix: sync siempre.
    const A4_H = 841.89;
    const TOP_Y = 40;
    const BOTTOM_Y = A4_H - 40; // 801
    let y = 125;
    const labelCol = 40;
    const valueCol = 165;
    const lineH = 14;

    function ensureSpace(needed: number) {
      if (y + needed > BOTTOM_Y) {
        doc.addPage();
        y = TOP_Y;
      }
    }

    function row(label: string, value: string) {
      ensureSpace(lineH);
      doc.fontSize(8).fillColor("#64748b").font("Helvetica-Bold").text(label.toUpperCase(), labelCol, y, { width: 120 });
      doc.fontSize(9).fillColor("#0f172a").font("Helvetica").text(value, valueCol, y, { width: 390 });
      // doc.y refleja la posición real del cursor después del último text();
      // sumarle un pequeño padding fijo de baseline. Si el value se wrapeó a
      // varias líneas, doc.y avanzó solo; row sigue avanzando lineH mínimo.
      y = Math.max(doc.y, y + lineH);
    }

    function sectionTitle(text: string) {
      // El rect coloreado no puede partirse entre páginas — asegurar espacio
      // para el rect (16) + padding superior (6) + padding inferior (6).
      ensureSpace(28);
      y += 6;
      doc.fontSize(9).fillColor("#ffffff").font("Helvetica-Bold").rect(40, y, 515, 16).fill("#0f172a");
      doc.fillColor("#ffffff").text(text.toUpperCase(), 46, y + 4);
      y += 22;
    }

    function block(label: string, content: string) {
      doc.fontSize(9).font("Helvetica"); // setear font ANTES de heightOfString
      const opts = { width: 515 };
      const contentH = doc.heightOfString(content, opts);
      // Si el bloque entero no entra, ir a nueva página primero.
      // (No intentamos partir un bloque entre páginas — pdfkit lo hace solo si
      // hace falta, pero al menos arrancamos limpio.)
      const labelH = label ? 11 : 0;
      ensureSpace(labelH + Math.min(contentH, 200) + 8);
      if (label) {
        doc.fontSize(8).fillColor("#64748b").font("Helvetica-Bold").text(label.toUpperCase(), labelCol, y);
        y += 11;
      }
      doc.fontSize(9).fillColor("#0f172a").font("Helvetica").text(content, labelCol, y, opts);
      y = doc.y + 8;
    }

    sectionTitle("Identificación");
    row("Vessel", permit.vesselCode);
    row("Ubicación", val(permit.location));
    row("Inicio planeado", fmt(permit.plannedStart));
    row("Fin planeado", fmt(permit.plannedEnd));
    if (permit.validFrom || permit.validTo) {
      row("Validez", `${fmt(permit.validFrom)}  →  ${fmt(permit.validTo)}`);
    }

    sectionTitle("Descripción del trabajo");
    block("", val(permit.description));

    if (permit.hazardsIdentified) {
      sectionTitle("Peligros identificados");
      block("", permit.hazardsIdentified);
    }
    if (permit.controlMeasures) {
      sectionTitle("Medidas de control");
      block("", permit.controlMeasures);
    }
    if (permit.ppeRequired) {
      sectionTitle("EPP requerido");
      block("", permit.ppeRequired);
    }

    // Specific fields per type (from details JSON)
    if (permit.details && Object.keys(permit.details).length > 0) {
      sectionTitle("Detalle específico");
      for (const [k, v] of Object.entries(permit.details)) {
        const s = typeof v === "object" ? JSON.stringify(v) : String(v);
        row(k, s);
      }
    }

    // Participants
    if (permit.participants.length > 0) {
      sectionTitle("Participantes");
      for (const p of permit.participants) {
        row(ROLE_LABEL[p.role] ?? p.role, p.name);
      }
    }

    // Gas tests (enclosed space).
    // Cita: SOLAS XI-1/7 exige el equipamiento de medición; los umbrales
    // operativos vienen de ISGOTT 6 Cap. 11 (estándar industrial), no de
    // IMO A.1050(27) directamente (esa es procedural, no numérica).
    if (permit.gasTests.length > 0) {
      sectionTitle("Gas Tests (SOLAS XI-1/7 + ISGOTT 6 Cap. 11)");
      // Header de tabla
      ensureSpace(20);
      doc.fontSize(8).fillColor("#64748b").font("Helvetica-Bold");
      doc.text("Fecha/Hora", 40, y, { width: 90 });
      doc.text("Medido por", 130, y, { width: 100 });
      doc.text("O₂%", 230, y, { width: 40 });
      doc.text("LEL%", 270, y, { width: 40 });
      doc.text("H₂S", 310, y, { width: 40 });
      doc.text("CO", 350, y, { width: 40 });
      doc.text("Verdict", 390, y, { width: 60 });
      y += 12;
      doc.moveTo(40, y).lineTo(555, y).strokeColor("#cbd5e1").lineWidth(0.5).stroke();
      y += 4;
      doc.font("Helvetica").fillColor("#0f172a").fontSize(8);
      for (const g of permit.gasTests) {
        ensureSpace(13);
        doc.text(fmt(g.testedAt), 40, y, { width: 90 });
        doc.text(g.testedByName, 130, y, { width: 100 });
        doc.text(g.o2Pct !== null ? g.o2Pct.toFixed(1) : "—", 230, y, { width: 40 });
        doc.text(g.lelPct !== null ? g.lelPct.toFixed(2) : "—", 270, y, { width: 40 });
        doc.text(g.h2sPpm !== null ? g.h2sPpm.toFixed(0) : "—", 310, y, { width: 40 });
        doc.text(g.coPpm !== null ? g.coPpm.toFixed(0) : "—", 350, y, { width: 40 });
        const verdictColor = g.verdict === "PASS" ? "#16a34a" : "#b91c1c";
        doc.fillColor(verdictColor).font("Helvetica-Bold").text(g.verdict, 390, y, { width: 60 });
        doc.fillColor("#0f172a").font("Helvetica");
        y += 11;
      }
    }

    // Workflow timestamps
    sectionTitle("Trazabilidad");
    if (permit.requestedAt) row("Solicitado", fmt(permit.requestedAt));
    if (permit.approvedAt) row("Aprobado", fmt(permit.approvedAt));
    if (permit.activatedAt) row("Activado", fmt(permit.activatedAt));
    if (permit.closedAt) row("Cerrado", fmt(permit.closedAt));
    if (permit.closeNotes) block("Notas de cierre", permit.closeNotes);
    if (permit.rejectionReason) block("Motivo de rechazo", permit.rejectionReason);
    if (permit.cancelReason) block("Motivo de cancelación", permit.cancelReason);

    // Signature block — cajas para firmas impresas.
    // ensureSpace tiene en cuenta: sectionTitle (28) + altura del box (55) + 10
    ensureSpace(28 + 55 + 10);
    sectionTitle("Firmas (a completar a bordo)");
    const sigBoxY = y;
    const sigW = 165;
    const sigH = 55;
    const sigGap = 10;
    function sigBox(label: string, x: number) {
      doc.rect(x, sigBoxY, sigW, sigH).strokeColor("#cbd5e1").lineWidth(0.7).stroke();
      doc.fontSize(7).fillColor("#64748b").text(label.toUpperCase(), x + 4, sigBoxY + 4);
      doc.fontSize(7).fillColor("#94a3b8").text("Nombre / Firma / Fecha", x + 4, sigBoxY + sigH - 12);
    }
    sigBox("Solicitante", 40);
    sigBox("Aprobador (Capitán / Jefe Máq.)", 40 + sigW + sigGap);
    sigBox("Cierre", 40 + 2 * (sigW + sigGap));
    y = sigBoxY + sigH + 10;

    // Footer en la última página (la página actual al hacer end()).
    doc.fontSize(7).fillColor("#94a3b8")
      .text(`Generado ${new Date().toLocaleString("es-AR")}  ·  ${permit.permitCode}`, 40, 815, { width: 515, align: "center" });

    doc.end();
  });
}
