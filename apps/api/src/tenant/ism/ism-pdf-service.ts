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
import { LOGO_PATH, resolveTenantLogo, sanitizePdfText, renderLabeledTextBox } from "../pms/pdf-helpers";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";
import { GROUP_TITLE as TMSA_GROUP_TITLE, METRIC_LABEL as TMSA_METRIC_LABEL } from "../tmsa/tmsa-pdf-service";
import { getIsmChapter10Evidence, type IsmStatus, type IsmMetric, type IsmFinding } from "./ism-service";

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

/**
 * Qué está mal y cómo se arregla, por hallazgo. Es el MISMO texto que muestra
 * la pantalla al tocar el badge de una cláusula: son las claves `ism.fix.*` del
 * diccionario de web-modern (lib/i18n.tsx), en español, que es el idioma de
 * este PDF. Si cambia el texto de la pantalla, cambiar también acá — igual que
 * ya pasa con los rótulos de grupos y métricas de arriba.
 *
 * Los pasos van en un solo texto separados por saltos de línea; se numeran al
 * imprimirlos.
 */
const FIX_TEXT: Record<string, { title: string; what: string; how: string }> = {
  auditFindingsOpen: {
    title: "Hallazgos de auditoría externa abiertos",
    what: "Hay hallazgos de auditoría externa todavía abiertos. No son no conformidades del buque, pero el auditor los va a cruzar con lo que se corrigió.",
    how: "Abrí Auditorías Externas.\nEntrá a cada hallazgo abierto.\nRegistrá qué se hizo y cerralo.\nSi el hallazgo exige un trabajo a bordo, abrí la OT correctiva desde el defecto.",
  },
  caEffectivenessOverdue: {
    title: "Verificaciones de eficacia vencidas",
    what: "A los 30 días de cerrar un defecto el sistema pide confirmar si el problema volvió. Hay confirmaciones vencidas sin firmar: la medida está registrada, pero no se sabe si sirvió.",
    how: "Abrí Defectos.\nEntrá a los cerrados que piden verificación.\nCompletá la Verificación de eficacia diciendo si el problema volvió o no.\nQueda firmada con usuario y fecha: eso es lo que mira el auditor.",
  },
  caLowRate: {
    title: "La mayoría de los defectos cerrados no dice qué se hizo",
    what: "Menos de la mitad de los defectos cerrados en los últimos 90 días tiene registrada la medida correctiva. Cerrar sin decir cómo se resolvió deja a la cláusula 10.2.3 sin evidencia.",
    how: "Abrí Defectos y mirá los cerrados en los últimos 90 días.\nEntrá a los que no tienen Acción correctiva y escribí qué se hizo.\nSumá las Acciones preventivas cuando el problema pueda repetirse.\nDe acá en adelante, completá la medida ANTES de cerrar el defecto.",
  },
  caNothing: {
    title: "Todavía no hay medidas correctivas registradas",
    what: "En los últimos 90 días no se cerró ningún defecto ni se verificó ninguna eficacia. No es un incumplimiento, pero tampoco hay evidencia de que las no conformidades terminen en una medida.",
    how: "Abrí Defectos.\nAl cerrar cada defecto, completá la Acción correctiva: qué se hizo para resolverlo.\nSi la corrección exige trabajo a bordo, abrí la OT correctiva desde el propio defecto.\nA los 30 días el sistema te va a pedir confirmar si el problema volvió.",
  },
  caWithoutAction: {
    title: "Defectos cerrados sin medida registrada",
    what: "Hay defectos cerrados en los últimos 90 días que no dicen qué se hizo para resolverlos. Al auditor le falta justo el eslabón entre el problema y la solución.",
    how: "Abrí Defectos.\nEntrá a los cerrados sin Acción correctiva.\nEscribí qué se hizo, con una línea concreta: qué se cambió, reparó o ajustó.\nSi hubo trabajo a bordo, enlazá la OT correctiva que lo ejecutó.",
  },
  certificatesWithoutPlan: {
    title: "Certificados sin plan que los renueve",
    what: "Ningún certificado del buque está enlazado al plan que lo mantiene vigente. El certificado prueba el estado, pero no muestra qué mantenimiento lo sostiene.",
    how: "Abrí Certificados.\nEntrá al certificado y buscá el campo «Se renueva con el plan».\nElegí la tarea del plan que lo mantiene vigente: la inspección o el servicio que lo renueva.\nRepetí con cada certificado que dependa de un mantenimiento.",
  },
  inspectionsNone: {
    title: "Todavía no hay inspecciones cargadas",
    what: "No hay ninguna inspección registrada para este buque. La cláusula pide inspecciones a intervalos apropiados, y sin registros no hay con qué probarlo.",
    how: "Abrí Inspecciones.\nCreá la inspección con su plantilla y su periodicidad.\nEl sistema calcula solo la próxima fecha y avisa cuando se vence.\nLos checklists de a bordo (zarpe, arribo, espacios confinados) se cargan en Check Lists.",
  },
  inspectionsOverdue: {
    title: "Inspecciones vencidas sin hacer",
    what: "Hay inspecciones cuya fecha ya pasó y siguen sin ejecutarse. Es la falta más directa contra «intervalos apropiados» y la primera que mira un auditor.",
    how: "Abrí Inspecciones.\nEntrá a las que figuran vencidas.\nEjecutalas y cerralas con su resultado.\nSi ahora no se pueden hacer a bordo, dejá registrado el diferimiento con su análisis de riesgo en vez de dejarlas vencidas en silencio.",
  },
  ncNoCause: {
    title: "No conformidades abiertas y ninguna con causa",
    what: "Hay varias no conformidades abiertas y ninguna tiene causa registrada. El Código pide notificarlas indicando su posible causa; hoy no hay ninguna cargada.",
    how: "Abrí Defectos.\nEntrá a cada no conformidad abierta.\nCompletá la Causa inmediata y, si se conoce, la Causa contribuyente y la Causa raíz.\nCon eso la no conformidad queda notificada como pide 10.2.2.",
  },
  ncWithoutCause: {
    title: "No conformidades sin causa registrada",
    what: "Quedan no conformidades abiertas sin ninguna causa cargada. El Código pide la causa «si se conoce», así que la que falta hay que completarla o dejar dicho por qué todavía no se sabe.",
    how: "Abrí Defectos y filtrá las abiertas.\nEntrá a las que no tienen causa.\nCompletá la Causa inmediata; si el caso lo amerita, sumá Causa contribuyente y Causa raíz.\nSi la causa todavía no se conoce, dejalo escrito en el análisis: eso también es notificar.",
  },
  plansWithoutCriteria: {
    title: "Tareas sin origen declarado",
    what: "Quedan tareas del plan con el campo Origen del criterio vacío. La trazabilidad regla → mantenimiento está empezada pero incompleta, y el auditor suele pedir justo las que faltan.",
    how: "Abrí Plan de Mantenimiento y pasá a Vista Planilla.\nOrdená por la columna Origen para juntar las que están vacías.\nSeleccionalas y usá «Asignar origen del criterio».\nSi la tarea sale del manual del equipo, elegí Manual del fabricante; si la puso la empresa, Estándar de la Compañía.",
  },
  preDepartureMissing: {
    title: "Sin verificaciones de zarpe en el último mes",
    what: "No hay ningún checklist de zarpe completado en los últimos 30 días. Es la evidencia más simple de que el equipo crítico se prueba antes de salir a navegar.",
    how: "Abrí Check Lists.\nCompletá el checklist Pre-Departure antes de zarpar.\nQueda registrado con usuario, fecha y firma.\nSi el buque no navegó en el mes, no hay nada que corregir: el número vuelve solo en el próximo zarpe.",
  },
  recLowCoverage: {
    title: "Pocas órdenes cerradas tienen parte de trabajo",
    what: "Menos del 80% de las órdenes cerradas tiene un parte que cuente qué se hizo. La evidencia existe, pero con huecos: el auditor va a caer justo en una orden sin registro.",
    how: "Tomá la costumbre de asentar el avance el mismo día del trabajo.\nUsá el botón verde «Nuevo registro de Avance de OT» en Inicio: no hace falta abrir el formulario entero.\nUna foto del antes y el después vale más que tres renglones.\nAcordate de que la orden cerrada ya no admite avances: cargalo antes de cerrar.",
  },
  recNoWorkLogs: {
    title: "Órdenes cerradas sin ningún parte de trabajo",
    what: "Se cerraron órdenes de trabajo sin un solo parte que cuente qué se hizo. Hay mantenimiento ejecutado del que no quedó registro: es exactamente lo que busca un auditor.",
    how: "En Inicio usá el botón verde «Nuevo registro de Avance de OT».\nElegí la orden y asentá qué se hizo: texto, foto, video o documento.\nCargá el avance ANTES de cerrar la orden: una vez cerrada ya no admite avances.\nAl cerrar, completá además el resultado del trabajo.",
  },
  recNothing: {
    title: "No hay órdenes cerradas en los últimos 90 días",
    what: "No se cerró ninguna orden de trabajo en los últimos 90 días, así que no hay registros de mantenimiento recientes que mostrar.",
    how: "Abrí Órdenes de Trabajo y revisá qué hay abierto.\nCerrá las que ya se ejecutaron, con su resultado.\nSi el trabajo se hizo y nadie lo cargó, registralo con su fecha real de ejecución.\nEl parte de trabajo se carga con «Nuevo registro de Avance de OT», desde Inicio o desde la propia orden.",
  },
  regulatoryNothing: {
    title: "Todavía no hay nada cargado",
    what: "Este buque no tiene planes de mantenimiento, ni inspecciones reglamentarias, ni certificados cargados. Sin eso no hay con qué mostrar de dónde sale el mantenimiento que se hace a bordo.",
    how: "Abrí Plan de Mantenimiento.\nCargá los equipos y sus tareas, o cloná el plan de un buque hermano.\nCargá los certificados del buque en Certificados.\nVolvé a esta pantalla: los números se actualizan solos.",
  },
  regulatoryUndeclared: {
    title: "Ninguna tarea declara de qué regla nace",
    what: "Ninguna tarea del plan tiene declarado su Origen del criterio y tampoco hay inspecciones reglamentarias cargadas. Delante de un auditor no se puede explicar por qué se mantiene lo que se mantiene.",
    how: "Abrí Plan de Mantenimiento y pasá a Vista Planilla.\nSeleccioná varias tareas juntas y usá «Asignar origen del criterio».\nElegí de dónde nace cada una: requisito de clase, estatutario, manual del fabricante, estándar de la Compañía o criterio de ingeniería.\nLo que nace de una inspección de clase o bandera se carga además en Inspecciones.",
  },
  scNothing: {
    title: "Ningún equipo marcado como crítico",
    what: "Este buque no tiene ningún equipo marcado como crítico para la seguridad. La cláusula pide identificar aquellos cuyo fallo repentino pueda crear una situación peligrosa.",
    how: "Abrí Equipos.\nEntrá al equipo y marcá «Equipo crítico para seguridad».\nDeclará si trabaja en uso continuo o está De reserva.\nEmpezá por los obvios: gobierno, contra incendio, generación de emergencia, achique.",
  },
  scWithoutPlan: {
    title: "Equipos críticos sin plan activo",
    what: "Hay equipos marcados como críticos que no tienen ninguna tarea activa en el plan. Sin plan no hay ninguna medida que promueva su fiabilidad, que es lo que pide la cláusula.",
    how: "Abrí Equipos y mirá cuáles están marcados como críticos.\nEn Plan de Mantenimiento creá al menos una tarea activa para cada uno.\nPonele periodicidad y origen del criterio (normalmente el manual del fabricante).\nSi el equipo está fuera de uso y no lleva plan, dejalo escrito en la excepción del propio equipo.",
  },
  standbyWithoutTest: {
    title: "Equipos de reserva sin prueba periódica designada",
    what: "Hay equipos de reserva sin declarar cuál de sus tareas es la prueba periódica. La cláusula lo exige expresamente: al equipo que no se usa de forma continua hay que probarlo cada tanto.",
    how: "Abrí Equipos.\nEntrá a cada equipo marcado De reserva.\nEn «¿Cuál de sus tareas es la prueba periódica?» elegí la tarea con la que se prueba que arranca.\nSi todavía no tiene esa tarea, creala en el plan y después volvé a elegirla acá.",
  },
  woComplianceLow: {
    title: "Cumplimiento en plazo por debajo del objetivo",
    what: "El porcentaje de órdenes cerradas dentro de su fecha está por debajo del 85% esperado; por debajo del 75% se cuenta como brecha. Dice que el plan se cumple tarde, no que no se cumple.",
    how: "Abrí Órdenes de Trabajo y mirá las vencidas.\nCerrá primero las más viejas: son las que más bajan el porcentaje.\nSi una tarea nunca llega a tiempo, revisá su periodicidad en el plan: puede que el intervalo no sea realista.\nLo que no se pueda cumplir va como diferimiento aprobado, no como vencido.",
  },
  woCriticalOverdue: {
    title: "Órdenes de equipo crítico vencidas",
    what: "Hay órdenes de trabajo vencidas sobre equipo crítico. Es la peor combinación posible: el equipo cuyo fallo crea una situación peligrosa es justo el que está esperando mantenimiento.",
    how: "Abrí Órdenes de Trabajo.\nAtendé primero las de equipo crítico vencidas.\nEjecutalas y cerralas con su resultado y su parte de trabajo.\nLo que no se pueda hacer ahora va como diferimiento, con análisis de riesgo y aprobación de tierra.",
  },
  woOverdue: {
    title: "Órdenes de trabajo vencidas",
    what: "Hay órdenes de trabajo cuya fecha ya pasó y siguen abiertas. Mientras el atraso no se explique, el mantenimiento planificado no se ve integrado en la operación del buque.",
    how: "Abrí Órdenes de Trabajo y ordená por vencimiento.\nCerrá primero las más viejas.\nSi el trabajo ya se hizo, cerrala con la fecha real de ejecución.\nSi no se puede hacer a tiempo, cargá el diferimiento: vencida en silencio es lo único que no sirve.",
  },
};

/** Fondo y borde de la caja del hallazgo, según su peso. */
const FIX_TONE: Record<string, { bg: string; border: string }> = {
  GAP:       { bg: "#fef2f2", border: "#fecaca" },
  ATTENTION: { bg: "#fffbeb", border: "#fde68a" },
  INFO:      { bg: "#f8fafc", border: "#e2e8f0" },
};

/** El número del hallazgo. Un cero no dice nada: en ese caso no se muestra. */
function findingValue(f: IsmFinding): string {
  if (f.kind === "pct") return `${Math.round(f.value * 100)}%`;
  return f.value > 0 ? String(f.value) : "";
}

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

        // Diagnóstico del bloque: qué está mal y cómo se arregla. Va en cajas
        // paginadas (renderLabeledTextBox), que es lo obligatorio para texto
        // libre: si la lista de pasos cruza de página, el recuadro la sigue.
        for (const f of g.findings ?? []) {
          const fx = FIX_TEXT[f.key];
          if (!fx) continue;
          const steps = fx.how
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean)
            .map((line, i) => `${i + 1}. ${line}`)
            .join("\n");
          const value = findingValue(f);
          const tone = FIX_TONE[f.status] ?? FIX_TONE.INFO;
          y = renderLabeledTextBox(doc, {
            label: `${STATUS_TEXT[f.status]} · ${fx.title}${value ? ` · ${value}` : ""}`,
            text: `**Qué está mal:** ${fx.what}\n\n**Cómo se arregla:**\n${steps}`,
            x: ML,
            y,
            width: W,
            pageBottom: CONTENT_BOTTOM,
            pageTop: MARGIN_V,
            labelPosition: "above",
            labelColor: STATUS_COLOR[f.status],
            fontSize: 8.5,
            bg: tone.bg,
            border: tone.border,
            markdown: true,
          });
        }
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
