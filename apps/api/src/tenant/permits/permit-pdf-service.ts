import PDFDocument from "pdfkit";
import type { TenantAccessSession } from "../auth/session-store";
import { getPermit } from "./permits-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { resolveTenantLogo } from "../pms/pdf-helpers";
import { buildPermitChecklist } from "../../common/regulations/maritime";

/**
 * PDF imprimible para Permit to Work. SOLAS/class lo exigen impreso y firmado a bordo
 * (no basta con el registro electrónico). Diseñado A4, formato clásico de PTW marítimo.
 */

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
  let tenantTz: string | null = null;
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const tenantRow = await (prisma as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true, timezone: true } } },
      });
      tenantName = tenantRow?.settings?.displayName;
      tenantTz = tenantRow?.settings?.timezone ?? null;
      tenantLogoBuffer = await resolveTenantLogo(
        session.tenantSlug,
        tenantRow?.settings?.logoUrl,
        tenantRow?.settings?.logoUrlLight,
      );
    } catch { /* non-blocking */ }
  }

  /**
   * Fecha y hora EN LA ZONA HORARIA DE LA EMPRESA.
   *
   * El servidor corre en UTC: formatear con la hora del proceso hacía que un
   * permiso cargado de 08:00 a 18:00 saliera impreso de 11:00 a 21:00. El
   * permiso se firma y se cuelga en el buque: la hora tiene que ser la de
   * abordo, no la del servidor.
   */
  const fmt = (d: Date | string | null | undefined): string => {
    if (!d) return "—";
    const date = new Date(d);
    try {
      return date.toLocaleString("es-AR", {
        dateStyle: "short", timeStyle: "short",
        ...(tenantTz ? { timeZone: tenantTz } : {}),
      });
    } catch {
      // Zona horaria mal cargada en la empresa: no se rompe el PDF por eso.
      return date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
    }
  };

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
    doc.fontSize(9).fillColor("#475569").text(tenantName ?? "CMS3.0", 100, 38);
    doc.fontSize(16).fillColor("#0f172a").font("Helvetica-Bold")
      .text("PERMISO DE TRABAJO", 0, 35, { align: "center" });
    doc.fontSize(11).fillColor("#475569").font("Helvetica")
      .text(TYPE_LABEL[permit.type] ?? permit.type, 0, 55, { align: "center" });

    doc.fontSize(10).fillColor("#0f172a").font("Helvetica-Bold")
      .text(`Nº ${permit.permitCode}`, 40, 80, { width: 515, align: "right" });
    doc.fontSize(9).fillColor("#0369a1")
      .text(`ESTADO: ${STATUS_LABEL[permit.status] ?? permit.status}`, 40, 95, { width: 515, align: "right" });

    doc.moveTo(40, 115).lineTo(555, 115).strokeColor("#cbd5e1").lineWidth(1).stroke();

    // Geometría de página.
    //
    // pdfkit respeta el margen inferior incluso cuando pasás `y` explícito en
    // doc.text(): si la línea que querés dibujar caería bajo el margen, agrega
    // una página y la dibuja en la nueva (mi y manual queda desfasado).
    //
    // Estrategia: dejar buffer ancho debajo del contenido para que ningún
    // text() quede pegado al borde. El footer y los sigBoxes viven adentro
    // de ese buffer, en y conocidas.
    //
    // Layout vertical:
    //   - margen top 40
    //   - contenido 40..770  (BOTTOM_Y)
    //   - sigBoxes y footer cabe en 770..801 si vinimos sin paginar
    //   - footer al final en y=790
    const A4_H = 841.89;
    const TOP_Y = 40;
    const BOTTOM_Y = 770; // mi cap de contenido — deja 31pt para footer/sigs
    let y = 125;
    const labelCol = 40;
    const valueCol = 165;

    function ensureSpace(needed: number) {
      if (y + needed > BOTTOM_Y) {
        doc.addPage();
        y = TOP_Y;
      }
    }

    function row(label: string, value: string) {
      ensureSpace(14);
      doc.fontSize(8).fillColor("#64748b").font("Helvetica-Bold").text(label.toUpperCase(), labelCol, y, { width: 120 });
      doc.fontSize(9).fillColor("#0f172a").font("Helvetica").text(value, valueCol, y, { width: 390 });
      // doc.y es la posición real del cursor de pdfkit después del último text.
      // Si el value se wrapeó a varias líneas, doc.y refleja eso correctamente.
      // Si pdfkit auto-paginó, doc.y está en la nueva página — y mi y sigue
      // alineado porque siempre lo asignamos desde acá.
      y = doc.y;
    }

    function sectionTitle(text: string) {
      // El rect coloreado no puede partirse entre páginas — asegurar espacio
      // para padding superior (6) + rect (16) + padding inferior (6).
      ensureSpace(28);
      y += 6;
      doc.fontSize(9).fillColor("#ffffff").font("Helvetica-Bold").rect(40, y, 515, 16).fill("#0f172a");
      doc.fillColor("#ffffff").text(text.toUpperCase(), 46, y + 4);
      y += 22;
    }

    function block(label: string, content: string) {
      doc.fontSize(9).font("Helvetica"); // setear font ANTES de heightOfString
      const opts = { width: 515 };
      // Estimar el alto del bloque para decidir si paginar preventivamente.
      // Para textos largos, dejamos que pdfkit haga split interno si hace falta.
      const contentH = doc.heightOfString(content, opts);
      const labelH = label ? 11 : 0;
      ensureSpace(labelH + Math.min(contentH, 100) + 8);
      if (label) {
        doc.fontSize(8).fillColor("#64748b").font("Helvetica-Bold").text(label.toUpperCase(), labelCol, y);
        y = doc.y;
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
      // "hasta" y no una flecha: la fuente del PDF (Helvetica/WinAnsi) no tiene
      // el carácter → y salía un garabato en el papel.
      row("Validez", `${fmt(permit.validFrom)}  hasta  ${fmt(permit.validTo)}`);
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

    // Checklist regulatorio por tipo — items accionables con cita normativa.
    // Se imprime antes de las firmas: el operador lo verifica y después firma.
    const checklist = buildPermitChecklist(permit.type);
    if (checklist.length > 0) {
      sectionTitle("Checklist regulatorio");
      for (const c of checklist) {
        // Estimar alto del item: texto del item a 380pt + padding bottom 4pt.
        doc.fontSize(8).font("Helvetica");
        const itemH = doc.heightOfString(c.item, { width: 380 });
        ensureSpace(Math.max(itemH, 12) + 6);
        // Checkbox vacío (9x9pt) alineado con la primera línea del texto.
        doc.rect(labelCol, y + 1, 9, 9).strokeColor("#0f172a").lineWidth(0.7).stroke();
        // Texto del item en columna izquierda (380pt de ancho).
        doc.fillColor("#0f172a").font("Helvetica").fontSize(8)
          .text(c.item, labelCol + 14, y, { width: 380 });
        const afterItemY = doc.y;
        // Referencia normativa a la derecha, italic gris claro, 7pt — alineada
        // a la base del primer renglón del item.
        doc.fillColor("#94a3b8").font("Helvetica-Oblique").fontSize(7)
          .text(c.reference, labelCol + 400, y + 1, { width: 115, align: "right" });
        // Reset font
        doc.font("Helvetica").fontSize(8).fillColor("#0f172a");
        y = afterItemY + 4;
      }
    }

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

    // Footer en la última página, DENTRO del área de contenido (margen
    // inferior es 40 → contenido 40..801). y=790 deja 11pt de respiro y NO
    // dispara la auto-paginación de pdfkit que ocurría con y=815.
    doc.fontSize(7).fillColor("#94a3b8")
      .text(`Generado ${fmt(new Date())}  ·  ${permit.permitCode}`, 40, 790, { width: 515, align: "center" });

    doc.end();
  });
}
