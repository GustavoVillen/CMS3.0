// Drill PDF — registro del simulacro con datos visibles en pantalla
// más la referencia regulatoria del tipo.
//
// Usa pdfkit igual que el resto de los PDFs del PMS.

import PDFDocument from "pdfkit";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { log } from "../../common/logger";
import type { TenantAccessSession } from "../auth/session-store";
import { getDrill } from "./drills-service";

const DRILL_TYPE_LABEL: Record<string, string> = {
  FIRE:           "Incendio",
  ABANDON_SHIP:   "Abandono de buque",
  ENCLOSED_SPACE: "Espacios confinados",
  MAN_OVERBOARD:  "Hombre al agua",
  POLLUTION:      "Contaminacion",
  OIL_SPILL:      "Derrame de combustible",
  SECURITY:       "Seguridad (ISPS)",
  MEDICAL:        "Emergencia medica",
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
  FIRE:           "SOLAS III/19.3.2 - drill mensual contra incendio.",
  ABANDON_SHIP:   "SOLAS III/19.3.2 y 19.3.3.1 - abandono mensual; dentro de 24 h si >25% de tripulacion es nueva.",
  ENCLOSED_SPACE: "SOLAS III/19.3.3.3 (MSC.350(92)) - entrada y rescate cada 2 meses.",
  MAN_OVERBOARD:  "SOLAS V/26 + practica recomendada - maniobra Williamson / Anderson.",
  POLLUTION:      "MARPOL Anexo I Reg. 37 + SOPEP - ejercicio trimestral.",
  OIL_SPILL:      "MARPOL Anexo I + SOPEP/SMPEP. OPA 90 para aguas USA.",
  SECURITY:       "ISPS Code A/13.4 - drill trimestral; exercise anual del SSP.",
  MEDICAL:        "MLC 2006 + SMS de la compania. Ref: IMGS / WHO Medical Guide for Ships.",
  STEERING_GEAR:  "SOLAS V/26.4 - prueba trimestral del aparato de gobierno de emergencia.",
  BLACKOUT:       "SMS de la compania + buena practica (dead-ship recovery).",
  OTHER:          "Buena practica maritima y SMS de la compania.",
};

/**
 * Listas de chequeo regulatorias por tipo de simulacro.
 * Cada item es un punto de verificacion que el inspector / oficial responsable
 * tilda durante o despues del simulacro. Construidas en base a:
 *   - SOLAS Cap. III (LSA), Cap. V/26 (steering), Cap. II-2 (fire)
 *   - ISGOTT (buques tanque, fire & enclosed space)
 *   - MARPOL Anexo I + SOPEP/SMPEP
 *   - ISPS Code Parte A
 *   - MLC 2006 + IMGS (medico)
 *   - IAMSAR Manual (MOB / SAR)
 *   - IMO Res. A.1050(27) (enclosed space)
 *   - MSC.1/Circ.1578 (dead-ship)
 */
const DRILL_CHECKLISTS: Record<string, string[]> = {
  FIRE: [
    "Alarma general activada y reconocida en puente",
    "Mustering completo en puntos de reunion (head count)",
    "Foco identificado y localizacion comunicada al puente",
    "Comunicacion puente-comando-brigada operativa (UHF/walkie)",
    "Brigada contra incendio equipada con SCBA y traje proximidad",
    "Bombas de incendio principal y de emergencia operativas",
    "Aislacion electrica de la zona afectada confirmada",
    "Sistema fijo de extincion (CO2 / espuma / agua nebulizada) listo",
    "Cierre de dampers de ventilacion en zona afectada",
    "Boundary cooling iniciado en mamparas adyacentes",
    "Reporte de heridos / desaparecidos (head count vs. tripulacion)",
    "Tiempo de respuesta brigada operativa (objetivo < 5 min)",
    "Notificacion SAR / autoridad costera si aplica",
    "Reset del sistema y stand-down general anunciado",
  ],
  ABANDON_SHIP: [
    "Alarma de abandono (>=7 cortos + 1 largo) activada",
    "Mustering en puestos de embarque con chalecos puestos",
    "Chalecos salvavidas correctamente colocados (verificacion visual)",
    "Trajes de inmersion donned (segun aguas frias)",
    "Conteo de tripulacion vs. lista de embarque",
    "Documentacion del buque (Class, registry, ORB, bitacora) preparada",
    "Posicion GPS y bitacora actualizada con ultima posicion",
    "MAYDAY transmitido por VHF Ch.16 + DSC + Inmarsat",
    "EPIRB y SART activados (segun escenario)",
    "Lanzamiento de bote / balsa (real o simulado - documentar)",
    "Provisiones de agua y emergencia verificadas en bote",
    "Reagrupamiento de tripulacion fuera del buque exitoso",
    "Notificacion a SAR / armador / charterer",
    "Briefing post-drill con tripulacion completo",
  ],
  ENCLOSED_SPACE: [
    "Permit to Work (espacio confinado) emitido y firmado",
    "Gas test pre-entry: O2 >= 19.5%",
    "Gas test pre-entry: LEL < 1%",
    "Gas test pre-entry: H2S < 10 ppm",
    "Gas test pre-entry: CO < 50 ppm",
    "Aislacion de sistemas (lockout/tagout) confirmada",
    "Ventilacion forzada activa al menos 30 min previos",
    "Stand-by externo nombrado y posicionado fuera",
    "Comunicacion bidireccional radio confirmada cada 5 min",
    "BA con suministro de aire (NO filtros) disponible para rescate",
    "Linea de vida (harness + tag line) en uso",
    "Equipo de rescate preparado: trauma kit, camilla, triple-stand",
    "Briefing pre-entry completado con todo el equipo",
    "Tiempo maximo de permanencia definido y respetado",
    "Re-test atmosfera cada 30 min documentado",
    "Stand-down y permit cerrado al salir",
  ],
  MAN_OVERBOARD: [
    "Alarma MOB / 3 toques largos activada",
    "Aro salvavidas con humo + luz arrojado inmediatamente",
    "Posicion del MOB marcada en GPS (boton MOB)",
    "Maniobra evasiva (Williamson / Anderson / Scharnov) ejecutada",
    "Lookout adicional posicionado en cubierta",
    "Alerta VHF Ch.16 transmitida (MAYDAY RELAY si aplica)",
    "Comunicacion puente-sala de maquinas establecida",
    "Bote de rescate preparado para arriado",
    "Velocidad reducida y aproximacion a sotavento de la victima",
    "Recuperacion de la persona (real o maniqui) exitosa",
    "Primeros auxilios / hipotermia kit listos",
    "Reporte SAR si no se recupera en tiempo razonable",
    "Tiempo total desde alarma hasta recuperacion documentado",
  ],
  POLLUTION: [
    "Alarma de contaminacion activada",
    "SOPEP / SMPEP plan consultado por el oficial responsable",
    "Fuente del derrame identificada y aislada",
    "Tipo y cantidad estimada de producto registrada",
    "Notificacion inmediata a autoridad costera (CRO)",
    "Notificacion al armador / charterer / Class",
    "Despliegue de barreras flotantes (boom) si aplica",
    "Material absorbente desplegado en cubierta / zona afectada",
    "Bombas de trasvase / drenado preparadas",
    "Entrada en ORB (Oil Record Book) registrada",
    "Comunicacion P&I Club establecida",
    "Evaluacion de impacto ambiental inicial documentada",
    "Equipo PPE (overol, guantes nitrilo, mascara) usado",
    "Limpieza post-incidente coordinada",
  ],
  OIL_SPILL: [
    "Alarma SOPEP activada",
    "SOPEP plan consultado y rol asignado a cada miembro",
    "Cierre de valvulas y aislacion del tanque/sistema afectado",
    "Volumen estimado del derrame registrado",
    "Notificacion inmediata a autoridad costera (CRO/MAEDO)",
    "Notificacion al armador / charterer / agente",
    "Despliegue de oil booms si el derrame alcanzo el agua",
    "Aplicacion de absorbentes / dispersantes (segun aprobacion)",
    "Bombeo de retorno al tanque o slop tank",
    "Entrada detallada en ORB Parte I/II",
    "Foto-documentacion del area afectada",
    "Coordinacion con P&I Club y Class society",
    "Plan de clean-up post-incidente acordado",
  ],
  SECURITY: [
    "Alarma de security activada",
    "Ship Security Officer (SSO) toma comando",
    "Nivel de security (MARSEC) elevado segun el escenario",
    "Verificacion de accesos al buque (gangway control)",
    "Bridge / sala de control bloqueado",
    "Comunicacion con Company Security Officer (CSO)",
    "Notificacion a Flag State y autoridad portuaria",
    "Inspeccion de carga y compartimientos sospechosos",
    "Busqueda de personal no autorizado a bordo",
    "Coordinacion con autoridad portuaria / policia",
    "Ship Security Alert System (SSAS) NO activado (solo en emergencia real)",
    "Registro de incidente en el Continuous Synopsis Record (CSR)",
    "Briefing post-drill con SSO + tripulacion clave",
  ],
  MEDICAL: [
    "Oficial medico designado convocado",
    "Botiquin / hospital de a bordo abierto y accesible",
    "Evaluacion inicial paciente (ABCDE primary survey)",
    "Signos vitales registrados: TA, FC, FR, SpO2, Tº, glucemia",
    "Consulta telemedicina CIRM / TMAS establecida",
    "Diagnostico presuntivo y tratamiento documentado",
    "Preparacion para evacuacion (MEDEVAC) si aplica",
    "Notificacion al proximo puerto / agente / autoridad",
    "Coordinacion helicoptero o lancha ambulancia gestionada",
    "Provision de medicacion del botiquin registrada",
    "Acompañante de la tripulacion asignado para escolta",
    "Documentacion medica del paciente preparada para entrega",
  ],
  STEERING_GEAR: [
    "Prueba del aparato de gobierno principal (todas las bombas)",
    "Prueba del gobierno de emergencia (cambio remoto a local)",
    "Comunicacion puente-sala steering establecida",
    "Tiempo hard-over a hard-over <= 28 segundos verificado",
    "Prueba con cada bomba hidraulica independiente",
    "Verificacion de feedback rudder angle indicator vs. real",
    "Prueba de alarmas de fallo (low oil, power failure)",
    "Verificacion de gyrocompasses (master + repetidores)",
    "Backup magnetico operativo y verificado",
    "Comunicacion telefono / walkie puente-steering OK",
    "Prueba de telegrafo de maquinas / EOT",
    "Verificacion entrada en bitacora del puente",
  ],
  BLACKOUT: [
    "Black-out simulado (apertura de breaker principal)",
    "Emergency Diesel Generator (EDG) auto-start en <45 sec",
    "Verificacion de cargas esenciales en EDG: bombas CI, GMDSS, alumbrado emergencia",
    "Reporte simultaneo desde puente, sala de maquinas y cada zona",
    "Verificacion de UPS de puente (radar, ECDIS, GMDSS) operativos",
    "Reinicio del generador principal segun procedimiento dead-ship",
    "Re-energizacion paso a paso (load shedding controlado)",
    "Reconexion de cargas no-esenciales en orden de prioridad",
    "Verificacion de propulsion restablecida",
    "Comunicacion bridge-engine confirmada en cada paso",
    "Tiempo total time-to-restore documentado",
    "Verificacion de alarmas y registros del sistema PMS",
  ],
  OTHER: [
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
};

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("es-AR");
  } catch {
    return "-";
  }
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
  } catch (err) {
    log.warn("[buildDrillPdf] crew lookup failed:", err);
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

  let tenantName = session.tenantSlug;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: session.tenantSlug },
      select: { name: true },
    });
    if (tenant?.name) tenantName = tenant.name;
  } catch (err) {
    log.warn("[buildDrillPdf] tenant lookup failed:", err);
  }
  tenantName = sanitize(tenantName);

  try {
    return await renderPdf({ tenantName, drill, participants });
  } catch (err) {
    log.error("[buildDrillPdf] render failed:", err);
    throw new RouteError(500, "PDF_RENDER_FAILED", err instanceof Error ? err.message : "No se pudo generar el PDF.");
  }
}

function renderPdf(ctx: {
  tenantName: string;
  drill: DrillRow;
  participants: Array<{ firstName: string | null; lastName: string | null; rank: string | null }>;
}): Promise<Buffer> {
  const { tenantName, drill, participants } = ctx;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: sanitize(`Simulacro ${drill.drillCode}`) } });
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
      .text("REGISTRO DE SIMULACRO", ML, 32, { width: W });
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

    rowPair("Tipo", DRILL_TYPE_LABEL[drill.type] ?? drill.type, "Estado", DRILL_STATUS_LABEL[drill.status] ?? drill.status);
    rowPair("Fecha programada", fmt(drill.scheduledDate), "Fecha realizada", fmt(drill.completedDate));

    // ── Referencia normativa ──
    y += 6;
    const ref = DRILL_REGULATORY_REF[drill.type] ?? "-";
    setFont(9.5, false);
    const refH = doc.heightOfString(ref, { width: W - 16, lineGap: 2 }) + 30;
    ensureSpace(refH);
    doc.rect(ML, y, W, refH).fillColor(bgBox).fill();
    setFont(7, true);
    doc.fillColor(navy)
      .text("REFERENCIA NORMATIVA", ML + 8, y + 6, { characterSpacing: 0.8 });
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

    textBlock("Escenario", drill.scenario ?? "");
    textBlock("Observaciones", drill.observations ?? "");
    textBlock("Lecciones aprendidas", drill.lessonsLearned ?? "");

    // ── Participantes ──
    const partLabel = `Participantes (${participants.length})`;
    const partRows = participants.length > 0
      ? participants.map((p, i) => {
          const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || "(sin nombre)";
          const rank = p.rank ?? "-";
          return `${i + 1}. ${name} - ${rank}`;
        }).join("\n")
      : "Sin participantes registrados.";
    textBlock(partLabel, partRows);

    // ── Lista de chequeo regulatoria (segun SOLAS / ISPS / MARPOL / IAMSAR) ──
    const checklist = DRILL_CHECKLISTS[drill.type] ?? DRILL_CHECKLISTS["OTHER"];
    if (checklist && checklist.length > 0) {
      // Header de la seccion (mismo estilo que textBlock pero sin caja blanca)
      const labelH = 14;
      ensureSpace(labelH + 12);
      doc.rect(ML, y, W, labelH).fillColor(navy).fill();
      setFont(7, true);
      doc.fillColor("#ffffff")
        .text("LISTA DE CHEQUEO REGULATORIA", ML + 8, y + 4, { width: W - 16, characterSpacing: 0.8 });
      y += labelH;

      // Subtitulo: norma aplicable
      setFont(7, false);
      doc.fillColor(gray)
        .text(`Aplicable: ${sanitize(DRILL_REGULATORY_REF[drill.type] ?? "Buena practica maritima.")}`,
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
      doc.text("ITEM",  ML + colCheckW + 4,                        y + 4, { width: colTextW, characterSpacing: 0.4 });
      doc.text("OK",    ML + colCheckW + colTextW + 8,             y + 4, { width: colOkW, align: "center", characterSpacing: 0.4 });
      doc.text("N/A",   ML + colCheckW + colTextW + colOkW + 12,   y + 4, { width: colNaW, align: "center", characterSpacing: 0.4 });
      doc.text("OBS.",  ML + colCheckW + colTextW + colOkW + colNaW + 16, y + 4, { width: colNotesW, align: "center", characterSpacing: 0.4 });
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
      .text("FIRMA RESPONSABLE DEL SIMULACRO", ML + 8, y + 6, { width: sigW - 16, characterSpacing: 0.8 });
    doc.text("FIRMA CAPITAN / OFICIAL DE GUARDIA", ML + sigW + 28, y + 6, { width: sigW - 16, characterSpacing: 0.8 });
    y += 60;

    // ── Footer ──
    const footerY = PH - 38;
    setFont(7, false);
    doc.fillColor(gray)
      .text(
        sanitize(`Generado: ${new Date().toLocaleString("es-AR")}   -   ${drill.drillCode}   -   ${tenantName}`),
        ML, footerY, { width: W, align: "center" }
      );

    doc.end();
  });
}
