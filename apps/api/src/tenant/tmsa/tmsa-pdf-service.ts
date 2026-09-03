// TMSA Elemento 4 (Reliability & Maintenance) → PDF de evidencia.
//
// Documento de soporte para vetting/auditoría: por buque, muestra los grupos
// del Elemento 4 (y adyacentes de mantenimiento) con semáforo + métricas.
// Molde: compliance-pdf-service.ts (misma lib pdfkit, header/footer, logo tenant).
// Muestra el NOMBRE del buque (no el código) — ver regla "Nombres, no códigos".

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import type { TenantAccessSession } from "../auth/session-store";
import { getTmsaMaintenanceEvidence, type TmsaStatus, type TmsaMetric, type TmsaFinding } from "./tmsa-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { LOGO_PATH, resolveTenantLogo, renderLabeledTextBox } from "../pms/pdf-helpers";
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

/**
 * Qué está mal y cómo se arregla, por hallazgo. Es el MISMO texto que muestra
 * la pantalla al tocar el badge de un requisito: son las claves `tmsa.fix.*`
 * del diccionario de web-modern (lib/i18n.tsx), en español, que es el idioma de
 * este PDF. Si cambia el texto de la pantalla, cambiar también acá — igual que
 * ya pasa con los rótulos de grupos y métricas de arriba.
 *
 * Los pasos van en un solo texto separados por saltos de línea; se numeran al
 * imprimirlos.
 */
const FIX_TEXT: Record<string, { title: string; what: string; how: string }> = {
  analysesOutOfRange: {
    title: "Análisis de laboratorio fuera de rango",
    what: "Hay análisis con valores fuera del rango aceptable. El monitoreo sirve si la alarma dispara una acción: un resultado fuera de rango sin nada hecho es peor que no medir.",
    how: "Abrí Análisis de Fluidos y entrá a los que están fuera de rango.\nDecidí la acción: cambio de aceite, filtro, inspección interna o repetir la muestra.\nAbrí la OT correctiva desde el propio análisis para que quede el vínculo.\nSi el resultado se repite en el mismo equipo, cargá el defecto y su análisis de causa.",
  },
  assetsWithoutPlan: {
    title: "Equipos sin plan de mantenimiento",
    what: "Hay equipos dados de alta que no tienen ninguna tarea activa en el plan. TMSA mide la cobertura del PMS: por debajo del 98% es atención, y por debajo del 90%, brecha.",
    how: "Tocá la métrica «Sin plan» de esta tarjeta: te lleva a la lista de esos equipos.\nEn Plan de Mantenimiento creá al menos una tarea activa para cada uno.\nPonele periodicidad y origen del criterio (normalmente el manual del fabricante).\nSi un equipo no lleva plan por decisión escrita, marcá la excepción en su ficha: sale del cálculo sin ensuciar la cobertura.",
  },
  auditBelowTwo: {
    title: "Menos de dos auditorías en navegación en el año",
    what: "Se esperan dos auditorías de ingeniería en navegación por año y hay menos. La práctica existe, la frecuencia todavía no alcanza.",
    how: "Programá la visita que falta antes de fin de año.\nEjecutá la OT de auditoría a bordo, navegando.\nCerrala con la condición operativa «Navegación» y lo observado.\nSi el buque no navega tanto, dejá escrito el criterio de frecuencia que sí aplica.",
  },
  auditNoPlan: {
    title: "Sin plan de auditoría de ingeniería",
    what: "Este buque no tiene ninguna tarea de auditoría de ingeniería en el plan. En las barcazas sin tripulación de máquinas es lo esperable; en un remolcador tripulado, falta.",
    how: "Si el buque lleva tripulación de máquinas, abrí Plan de Mantenimiento.\nCreá la tarea de auditoría de ingeniería del representante de la Compañía, semestral.\nAl ejecutarla, cerrá la OT declarando la condición operativa «Navegación» cuando la visita se haga a bordo navegando.\nSi es una barcaza sin gente, no hay nada que corregir.",
  },
  auditNoneAtSea: {
    title: "Ninguna auditoría hecha en navegación",
    what: "En los últimos 12 meses no se registró ninguna auditoría de ingeniería hecha durante la navegación. TMSA pide justamente eso: observar las prácticas mientras el buque opera, no en puerto.",
    how: "Coordiná la visita del superintendente para un tramo navegando.\nEjecutá la OT de auditoría de ingeniería a bordo, en navegación.\nAl cerrarla, declará la condición operativa «Navegación»: es lo que la cuenta como evidencia.\nDejá en la orden lo observado, no sólo que se hizo.",
  },
  cbmNothing: {
    title: "Ningún plan con muestreo de fluidos",
    what: "No hay tareas del plan que pidan tomar muestra de aceite, agua o combustible. El monitoreo por condición es una de las medidas que TMSA espera para el equipo crítico.",
    how: "Abrí Plan de Mantenimiento.\nEn los equipos que lo justifiquen, marcá la tarea como muestreo y elegí el fluido.\nDefinile periodicidad (lo habitual: cada 250 o 500 horas, o mensual).\nLos resultados del laboratorio se cargan después en Análisis de Fluidos.",
  },
  certificatesExpired: {
    title: "Certificados vencidos",
    what: "Hay certificados con la fecha de vencimiento pasada. Navegar con documentación vencida es una detención posible, y en el panel es brecha directa.",
    how: "Tocá la métrica «Vencidos»: te lleva a la lista.\nSi el certificado ya se renovó, cargá la renovación con el archivo nuevo.\nSi todavía no, gestioná la inspección o el trámite que corresponda.\nRevisá que la fecha cargada sea la del Ship Status y no la de emisión del certificado.",
  },
  certificatesExpiringSoon: {
    title: "Certificados por vencer en 30 días",
    what: "Hay certificados que vencen dentro de los próximos 30 días. Todavía no es una falta, pero si el trámite no arranca ahora, en un mes lo va a ser.",
    how: "Tocá la métrica «Por vencer (30d)» para ver cuáles son.\nCoordiná la inspección o el trámite de renovación con tiempo.\nSi la renovación depende de un mantenimiento, adelantá esa tarea del plan.\nAl renovar, cargá el certificado nuevo con su archivo.",
  },
  certificatesNothing: {
    title: "Sin certificados cargados",
    what: "Este buque no tiene certificados en el sistema. La validez de la documentación estatutaria y de clase es de las primeras cosas que se verifican en una inspección.",
    how: "Abrí Certificados.\nCargá los certificados del buque con su emisor, emisión y vencimiento.\nAdjuntá el archivo escaneado de cada uno.\nEnlazá al plan que lo renueva el certificado que dependa de un mantenimiento.",
  },
  criticalNothing: {
    title: "Ningún equipo marcado como crítico",
    what: "Este buque no tiene equipos con criticidad A ni marcados como críticos para la seguridad. Sin esa marca el sistema no puede priorizar nada y el inspector no ve el criterio de la empresa.",
    how: "Abrí Equipos.\nPonele criticidad A, B o C según el criterio de la empresa.\nMarcá «Equipo crítico para seguridad» en los que su falla repentina crea una situación peligrosa.\nEmpezá por gobierno, contra incendio, generación de emergencia y achique.",
  },
  criticalOverdueWo: {
    title: "Órdenes vencidas en equipo crítico",
    what: "Hay equipos críticos con órdenes de trabajo vencidas. Es lo primero que mira un inspector: el equipo que no puede fallar es justo el que está esperando mantenimiento.",
    how: "Abrí Órdenes de Trabajo.\nAtendé primero las de equipo crítico vencidas.\nCerralas con su resultado y su parte de trabajo.\nLo que no se pueda hacer ahora va como diferimiento, con riesgo evaluado y aprobación de tierra.",
  },
  defectsNothing: {
    title: "El módulo de Defectos no tiene registros",
    what: "No hay ningún defecto cargado para este buque. El inspector pregunta cómo se reportan las fallas a bordo; sin registros, la respuesta no se puede mostrar.",
    how: "Abrí Defectos.\nCargá lo que aparezca a bordo, aunque sea menor: pérdida, ruido, alarma repetida.\nCada defecto puede abrir su OT correctiva desde el mismo formulario.\nLa tripulación también puede cargarlo desde la vista móvil.",
  },
  defectsStaleOpen: {
    title: "Defectos abiertos hace más de 60 días",
    what: "Hay defectos que llevan más de dos meses abiertos sin resolverse ni cerrarse. Un defecto viejo abierto es, para el inspector, un problema que nadie está atendiendo.",
    how: "Abrí Defectos y ordená por antigüedad.\nEl que ya se resolvió, cerralo con la acción correctiva de lo que se hizo.\nEl que sigue pendiente, enlazalo con su OT o su diferimiento para que se vea qué lo está frenando.\nEl que dejó de ser un problema, cerralo diciendo por qué.",
  },
  deferralsExpired: {
    title: "Diferimientos vencidos y todavía activos",
    what: "Hay diferimientos cuya fecha límite ya pasó y siguen abiertos. El permiso para postergar tenía un plazo: vencido el plazo, el trabajo está pendiente sin cobertura.",
    how: "Abrí Diferimientos y mirá los vencidos aún activos.\nSi el trabajo se hizo, cerrá el diferimiento con su OT.\nSi sigue sin poder hacerse, pedí una extensión con riesgo actualizado y nueva aprobación.\nLo que no se puede es dejarlo corriendo con el plazo vencido.",
  },
  deferralsNotInSpec: {
    title: "Diferimientos que no están en ninguna especificación",
    what: "Hay trabajos diferidos que no figuran en ninguna especificación de varada. El trabajo se postergó, pero no tiene dónde ejecutarse: es el agujero que el inspector busca en 4.4.2.",
    how: "Abrí Especificación de Varada.\nEntrá a la especificación en curso (o creá una si no hay).\nUsá el importador de diferimientos y sumá los que faltan.\nSi un diferimiento no va a dique porque se resuelve a flote, cerralo con su OT en vez de dejarlo vigente.",
  },
  deferralsWithoutApproval: {
    title: "Diferimientos sin aprobación registrada",
    what: "Hay diferimientos activos que nadie de tierra aprobó en el sistema. Sin la decisión firmada, el trabajo quedó postergado por el buque solo, y eso el inspector lo lee como falta de control.",
    how: "Abrí Diferimientos.\nEntrá a cada diferimiento activo sin decisión.\nQue el responsable de tierra apruebe o rechace, con su fecha.\nQueda firmado con usuario y fecha: eso es la evidencia del control.",
  },
  deferralsWithoutRisk: {
    title: "Diferimientos sin riesgo evaluado",
    what: "Hay diferimientos activos que no declaran su nivel de riesgo. Postergar un trabajo sin decir qué riesgo se acepta es lo que TMSA no admite: el diferimiento tiene que ser una decisión evaluada, no una demora.",
    how: "Abrí Diferimientos.\nEntrá a cada diferimiento activo sin riesgo.\nCompletá el nivel de riesgo y la justificación técnica de la postergación.\nSumá las medidas de mitigación mientras el trabajo siga pendiente.",
  },
  drydockNoItems: {
    title: "La especificación no tiene trabajos listados",
    what: "Hay una especificación de varada creada pero sin un solo renglón de trabajo. Un documento vacío no sirve de evidencia: el requisito es que la varada se planifique entre buque y tierra.",
    how: "Abrí Especificación de Varada.\nEntrá a la especificación y sumá los trabajos.\nImportá primero desde el backlog y los diferimientos: eso ya está justificado.\nAgregá a mano lo que salga de la inspección de clase o del criterio del superintendente.",
  },
  drydockNothing: {
    title: "Sin especificación de varada ni diferimientos",
    what: "Este buque no tiene ninguna especificación de varada armada ni diferimientos vigentes. No hay nada que revisar todavía; el bloque queda informativo hasta la próxima varada.",
    how: "Abrí Especificación de Varada cuando empiece la preparación.\nCreá la especificación del buque y su período.\nImportá desde el backlog los trabajos que se van a hacer en dique.\nLos diferimientos vigentes se importan ahí mismo, para que ninguno quede suelto.",
  },
  inspectionsNone: {
    title: "Todavía no hay inspecciones cargadas",
    what: "No hay ninguna inspección registrada para este buque: ni de tanques y lastre, ni las visitas del superintendente. Sin registros no hay con qué probar la frecuencia.",
    how: "Abrí Inspecciones.\nCreá la inspección con su plantilla, su periodicidad y su ventana.\nEl sistema calcula solo la próxima fecha y avisa cuando se vence.\nLos checklists de a bordo se completan en Check Lists.",
  },
  inspectionsOverdue: {
    title: "Inspecciones vencidas sin hacer",
    what: "Hay inspecciones cuya fecha ya pasó y siguen sin ejecutarse. La frecuencia declarada es la que el inspector va a verificar contra los registros.",
    how: "Abrí Inspecciones y entrá a las vencidas.\nEjecutalas y cerralas con su resultado.\nSi no se pueden hacer ahora, cargá el diferimiento con su riesgo.\nSi la periodicidad no es realista, revisala en vez de acumular vencidas.",
  },
  mocPendingImpl: {
    title: "Cambios aprobados sin implementar",
    what: "Hay gestiones de cambio aprobadas que todavía no se implementaron. No es una brecha del Elemento 4, pero un cambio aprobado y parado es una decisión sin cerrar.",
    how: "Abrí Gestión del Cambio.\nEntrá a los cambios aprobados pendientes.\nRegistrá la implementación con su fecha, o cerralos si ya no aplican.\nSi el cambio afecta el plan de mantenimiento, actualizá también la tarea.",
  },
  noRca: {
    title: "Ningún defecto tiene análisis de causa",
    what: "Hay defectos registrados pero ninguno con análisis de causa raíz. Se está anotando qué falló, no por qué: sin el porqué la falla vuelve.",
    how: "Abrí Defectos y empezá por los de equipo crítico o los que se repiten.\nCompletá causa inmediata, contribuyente y raíz.\nSumá las acciones preventivas.\nNo hace falta hacerlo en todos: TMSA mira que el análisis exista donde importa.",
  },
  permitsDraftStuck: {
    title: "Permisos en borrador hace más de 60 días",
    what: "Hay permisos de trabajo que quedaron en borrador y nunca avanzaron. Un permiso a medio hacer no autoriza nada y ensucia la evidencia: parece que el control se abandona por el camino.",
    how: "Abrí Permisos de Trabajo y filtrá los borradores.\nEl que corresponde a un trabajo que se hizo, completalo y cerralo con sus firmas.\nEl que quedó por un trabajo que nunca se ejecutó, cancelalo.\nNo dejes borradores abiertos: o autoriza o no existe.",
  },
  permitsNothing: {
    title: "Sin permisos de trabajo registrados",
    what: "No hay permisos de trabajo cargados para este buque. El trabajo en equipo crítico, en caliente o en espacio confinado tiene que quedar autorizado por escrito.",
    how: "Abrí Permisos de Trabajo.\nGenerá el permiso antes de empezar el trabajo que lo requiera.\nDesde una OT de equipo crítico se puede abrir el permiso ya enlazado.\nQuede firmado por quien autoriza y por quien ejecuta.",
  },
  pmsNothing: {
    title: "Todavía no hay equipos cargados",
    what: "Este buque no tiene ningún equipo dado de alta, así que no hay cobertura de PMS que medir ni plan que auditar.",
    how: "Abrí Equipos.\nCargá los equipos del buque, o cloná los de un buque hermano.\nEn Plan de Mantenimiento creá al menos una tarea activa por equipo.\nEl panel se actualiza solo con lo que vayas cargando.",
  },
  rcaNothing: {
    title: "No hay defectos cargados",
    what: "Este buque no tiene defectos registrados, así que no hay análisis de fallas que mostrar. No es que esté impecable: es que no hay evidencia.",
    how: "Abrí Defectos y cargá lo que aparezca, aunque sea menor.\nCada defecto lleva su causa inmediata y, si el caso lo amerita, su causa raíz.\nDe la falla sale la OT correctiva y, si corresponde, el cambio al plan.\nUn buque sin ningún defecto cargado en meses le dice al inspector que no se reporta, no que no falla.",
  },
  recurringAssets: {
    title: "Equipos con fallas repetidas",
    what: "Hay equipos con varios defectos registrados. La repetición es la señal que TMSA quiere que el sistema levante: el mismo equipo fallando otra vez pide análisis, no otra reparación igual.",
    how: "Abrí Defectos y filtrá por el equipo que se repite.\nHacé el análisis de causa raíz del conjunto, no de cada falla suelta.\nCargá las acciones preventivas que eviten la recurrencia.\nSi la causa está en el mantenimiento, corregí la tarea del plan: periodicidad, criterio o repuesto.",
  },
  sparesCriticalLow: {
    title: "Repuestos críticos por debajo del mínimo",
    what: "Hay repuestos críticos con existencia por debajo del stock mínimo declarado. Si el equipo falla hoy, no hay con qué repararlo a bordo.",
    how: "Tocá la métrica «Repuesto crít. bajo mínimo»: te lleva a la lista.\nGenerá la solicitud de repuestos de lo que falta.\nSi el mínimo quedó viejo (cambió el equipo o el consumo), corregilo en la ficha del repuesto.\nCuando llegue el material, registrá el ingreso para que el stock vuelva a reflejar la realidad.",
  },
  sparesNothing: {
    title: "Sin repuestos críticos cargados",
    what: "No hay ningún repuesto marcado como crítico para este buque. Sin esa marca no se puede probar que el inventario mínimo de a bordo está definido y controlado.",
    how: "Abrí Repuestos.\nMarcá criticidad A en los repuestos de equipo crítico.\nPonele stock mínimo a cada uno: ese es el número contra el que se compara.\nEmpezá por los del motor principal, generación y gobierno.",
  },
  woComplianceLow: {
    title: "Cumplimiento en plazo por debajo del objetivo",
    what: "El porcentaje de órdenes cerradas dentro de su fecha, en los últimos 90 días, está por debajo del 85% esperado; por debajo del 75% se cuenta como brecha. Dice que el plan se cumple tarde, no que no se cumple.",
    how: "Abrí Órdenes de Trabajo y mirá las vencidas.\nCerrá primero las más viejas: son las que más bajan el porcentaje.\nSi una tarea nunca llega a tiempo, revisá su periodicidad en el plan: puede que el intervalo no sea realista.\nLo que no se pueda cumplir va como diferimiento aprobado, no como vencido.",
  },
  woCriticalOverdue: {
    title: "OT de equipo crítico vencidas hace más de 30 días",
    what: "Hay órdenes de equipo crítico con más de 30 días de atraso. Un mes de demora en un equipo crítico ya no es una demora operativa: es una falla del sistema de planificación.",
    how: "Abrí Órdenes de Trabajo y ordená por vencimiento.\nResolvé primero las de equipo crítico.\nSi el trabajo ya se hizo, cerralas con la fecha real de ejecución.\nSi no se puede ejecutar, cargá el diferimiento con su riesgo y su aprobación: dejarlas vencidas en silencio es lo único que no sirve.",
  },
  woOverdue: {
    title: "Órdenes de trabajo vencidas",
    what: "Hay órdenes cuya fecha ya pasó y siguen abiertas. Cada una que se queda vencida baja el porcentaje de cumplimiento en plazo, que es el número que mira el inspector.",
    how: "Abrí Órdenes de Trabajo y ordená por vencimiento.\nCerrá primero las más viejas.\nSi el trabajo ya se hizo, cerrala con la fecha real de ejecución.\nSi no se puede hacer a tiempo, cargá el diferimiento en vez de dejarla vencida.",
  },
};

/** Fondo y borde de la caja del hallazgo, según su peso. */
const FIX_TONE: Record<string, { bg: string; border: string }> = {
  GAP:       { bg: "#fef2f2", border: "#fecaca" },
  ATTENTION: { bg: "#fffbeb", border: "#fde68a" },
  INFO:      { bg: "#f8fafc", border: "#e2e8f0" },
};

/** El número del hallazgo. Un cero no dice nada: en ese caso no se muestra. */
function findingValue(f: TmsaFinding): string {
  if (f.kind === "pct") return `${Math.round(f.value * 100)}%`;
  return f.value > 0 ? String(f.value) : "";
}

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
  // "perVessel": el PDF es el documento que se le entrega al auditor, y ahí el
  // desglose barco por barco ES lo que se quiere. La pantalla, en cambio, pide
  // el consolidado (ver TmsaEvidenceMode).
  const { items } = await getTmsaMaintenanceEvidence(session, vesselCode, "perVessel");

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
