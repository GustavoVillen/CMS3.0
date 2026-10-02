// Rótulos en español del panel de vetting, para el PDF y para la IA.
//
// Son el MISMO texto que muestra la pantalla (claves `vet.*` del diccionario de
// web-modern, lib/i18n.tsx). Si cambia uno, cambiar el otro: igual que ya pasa
// con ism-pdf-service y tmsa-pdf-service.
//
// Los capítulos van resumidos con palabras propias: el texto del BIQ es de
// OCIMF y tiene copyright. Del cuestionario sólo se usa el número de pregunta.

import type { BiqChapter } from "./vetting-topics";

export const CHAPTER_TEXT: Record<BiqChapter, { title: string; what: string; onboard: string }> = {
  "1": {
    title: "Datos generales",
    what: "Identificación del buque y de su operador: nombre, matrícula, bandera, porte, arqueo, año de entrega y operador técnico.",
    onboard: "Bandera, sociedad de clase y datos del operador técnico, contra los documentos originales.",
  },
  "2": {
    title: "Certificados y documentación",
    what: "Vigencia de los certificados estatutarios y de clase con sus inspecciones anuales e intermedias, informe de estado de clase, planos de disposición general y de estabilidad, último dique seco y resultado de la última inspección de bandera o del control del puerto.",
    onboard: "Certificados estatutarios (matrícula, seguridad, francobordo, arqueo, prevención de la contaminación), planos y políticas de la compañía.",
  },
  "3": {
    title: "Tripulación",
    what: "Títulos y dotación mínima, matriz de la tripulación, régimen de horas de descanso, política de alcohol y drogas y exámenes médicos.",
    onboard: "Dotación mínima de seguridad, política de alcohol y drogas, fechas de los últimos controles y exámenes médicos.",
  },
  "4": {
    title: "Navegación y comunicaciones",
    what: "Manual de puente, equipos de navegación y comunicaciones en servicio (compás, radar, GPS, VHF, AIS, ecosonda, luces y señales), cartas, avisos y plan de viaje.",
    onboard: "Que cada equipo funcione el día de la inspección, cartas y publicaciones al día, plan de viaje, errores del compás y calado aéreo a la vista.",
  },
  "5": {
    title: "Gestión de la seguridad",
    what: "Equipos contra incendio y de salvamento listos para usar, simulacros y entrenamiento, procedimientos de trabajo seguro (carga, espacios cerrados, trabajo en caliente), detección de gases y protección del personal.",
    onboard: "Estado del EPP, hojas de seguridad de la carga, detectores portátiles de gas y su calibración, botiquines, duchas lavaojos y señal de carga peligrosa.",
  },
  "6": {
    title: "Prevención de la contaminación",
    what: "Libro de registro de hidrocarburos, plan de emergencia ante derrames y su simulacro, barandas y bandejas antiderrame, sentinas y entrega de residuos.",
    onboard: "Libros de registro, avisos, bandejas antiderrame, bridas ciegas, válvulas de descarga precintadas y recibos de entrega de residuos.",
  },
  "7": {
    title: "Estructura",
    what: "Programa de inspección del casco y los tanques, mediciones de espesores, estado de tanques de carga y lastre, y prórrogas de dique o de inspección estructural.",
    onboard: "Informes de medición de espesores y estado visible de los tanques desde cubierta.",
  },
  "8": {
    title: "Manejo de la carga",
    what: "Manual y planes de carga, bombas y válvulas, pruebas de presión de cañerías y mangueras, alarmas de alto nivel, venteo y válvulas P/V, calibración de instrumentos y medición de tanques.",
    onboard: "Lista de verificación buque-tierra, plan de carga, certificados y pruebas de mangueras, tablas de calibración y precauciones de electricidad estática.",
  },
  "9": {
    title: "Amarre",
    what: "Amarre eficaz, guías y bitas en buen estado, guinches y su prueba de freno, cabos y molinete.",
    onboard: "Estado de los cabos y sus certificados, y el amarre del día de la inspección.",
  },
  "10": {
    title: "Remolque y empuje",
    what: "Potencia del remolcador para el convoy, equipos y cables de remolque, prueba de freno del guinche, brida, conexión de empuje y remolque de emergencia.",
    onboard: "Certificado y registro de inspección del cable, brida y cadena de la barcaza, y visibilidad desde el puente sobre el convoy.",
  },
  "11": {
    title: "Maquinaria",
    what: "Sala de máquinas limpia y sin pérdidas, sistema de mantenimiento planificado al día, generador de emergencia, alarmas, gobierno de emergencia, cortes de combustible y ventilación, procedimientos y libro de máquinas.",
    onboard: "Limpieza y pérdidas, aislación de superficies calientes, libro de máquinas y procedimiento de toma de combustible.",
  },
  "12": {
    title: "Aspecto general",
    what: "Estado del casco, la cubierta, la superestructura, la habitabilidad y la iluminación de cubierta.",
    onboard: "Todo el capítulo: es una verificación visual.",
  },
  "13": {
    title: "Cargas embaladas",
    what: "Carga en contenedores, tanques portátiles, camiones o tambores: estabilidad, trincado y certificación.",
    onboard: "No aplica a barcazas tanque; sólo si el buque lleva carga embalada.",
  },
};

/** Grupos propios. Los heredados toman su título de tmsa-pdf-service. */
export const OWN_GROUP_TITLE: Record<string, string> = {
  vesselParticulars:   "Ficha del buque",
  classSurveys:        "Clase: vigencia e inspecciones del ciclo",
  externalInspections: "Inspecciones externas y vetting anteriores",
  crewCompliance:      "Tripulación: títulos y descanso",
  drills:              "Simulacros",
  navEquipment:        "Equipos de navegación y comunicaciones",
  fireFighting:        "Equipos contra incendio",
  lifeSaving:          "Equipos de salvamento",
  structure:           "Casco y tanques",
  cargoSystem:         "Sistema de carga",
  mooring:             "Amarre y fondeo",
  towing:              "Remolque y empuje",
  machinerySafety:     "Seguridad de máquinas y emergencia",
};

const TOPIC_MEASURE_LABEL: Record<string, string> = {
  assets:       "Equipos",
  withPlan:     "Con plan activo",
  withoutPlan:  "Sin plan",
  overduePlans: "Tareas vencidas",
  openDefects:  "Defectos abiertos",
};

const OWN_METRIC_LABEL: Record<string, string> = {
  vetVesselsComplete:       "Fichas completas",
  vetVesselsIncomplete:     "Fichas incompletas",
  vetClassUpToDate:         "Clase al día",
  vetClassWindowOpen:       "Inspección en ventana",
  vetClassUnrecorded:       "Inspección sin registrar",
  vetClassExpired:          "Clase vencida o suspendida",
  vetClassMissing:          "Sin certificado de clase",
  vetDockShaftOverdue:      "Dique o eje vencido",
  vetDockShaftDueSoon:      "Dique o eje en 90 días",
  vetExtAudits12m:          "Inspecciones externas (12 m)",
  vetVettingInspections12m: "Vetting (12 m)",
  vetExtFindingsOpen:       "Hallazgos abiertos",
  vetExtFindingsOverdue:    "Hallazgos con plazo vencido",
  vetCrewOnboard:           "Tripulantes a bordo",
  vetCrewCertsExpired:      "Títulos vencidos",
  vetRestRecords30d:        "Registros de descanso (30 d)",
  vetRestViolations30d:     "Días con violación (30 d)",
  vetDrillsOk:              "Simulacros al día",
  vetDrillsDueSoon:         "Próximos a vencer",
  vetDrillsOverdue:         "Vencidos o nunca hechos",
};

/** Rótulo de una métrica propia, o null si es heredada de TMSA. */
export function ownMetricLabel(key: string): string | null {
  const eq = /^vetEq_[A-Za-z]+_([A-Za-z]+)$/.exec(key);
  if (eq) return TOPIC_MEASURE_LABEL[eq[1]!] ?? key;
  return OWN_METRIC_LABEL[key] ?? null;
}

/**
 * Qué está mal y cómo se arregla, por hallazgo propio. Mismo texto que
 * `vet.fix.<clave>` en la pantalla. Los pasos van separados por saltos de línea.
 */
export const FIX_TEXT: Record<string, { title: string; what: string; how: string }> = {
  particularsIncomplete: {
    title: "Ficha del buque incompleta",
    what: "Al buque le faltan datos que el inspector anota al empezar: matrícula, tipo, armador, año de construcción, porte bruto o arqueo bruto.",
    how: "Abrí Buques.\nEntrá al buque y completá los datos que faltan, tal como figuran en el certificado de matrícula.\nVolvé a esta pantalla: el número se actualiza solo.",
  },
  classMissing: {
    title: "Buques sin certificado de clase cargado",
    what: "El sistema no tiene el certificado de clase del buque. Sin él no se puede mostrar la vigencia ni el ciclo de inspecciones que el inspector va a pedir.",
    how: "Abrí Certificados.\nCargá el certificado de clase del buque con su fecha de emisión y de vencimiento.\nCompletá las fechas de las inspecciones del ciclo tal como figuran en el Ship Status.",
  },
  classExpired: {
    title: "Certificado de clase vencido o suspendido",
    what: "El certificado de clase del buque está vencido o suspendido. Es lo primero que mira un inspector de vetting y alcanza para rechazar el buque.",
    how: "Abrí Certificados y revisá el certificado de clase del buque.\nSi ya se renovó, cargá la renovación con las fechas nuevas.\nSi todavía no, coordiná la inspección de renovación con la sociedad de clase.",
  },
  classUnrecorded: {
    title: "Inspección de clase sin registrar",
    what: "La ventana de una inspección intermedia o periódica ya cerró y el certificado no tiene cargada la fecha en que se hizo. Puede estar hecha y sin registrar, o vencida.",
    how: "Abrí Certificados y entrá al certificado de clase del buque.\nCargá la fecha de la inspección tal como figura en el Ship Status.\nSi no se hizo, coordinala con la sociedad de clase cuanto antes.",
  },
  dockShaftOverdue: {
    title: "Dique seco o eje portahélice vencido",
    what: "Pasó la fecha límite de la inspección en dique seco o del eje portahélice y no hay una inspección registrada cerca de esa fecha.",
    how: "Abrí Certificados y revisá las fechas de dique y de eje del certificado de clase.\nSi la inspección se hizo, cargá su fecha.\nSi no, planificá la varada y dejá registrada la prórroga que haya otorgado la clase.",
  },
  classWindowOpen: {
    title: "Inspección de clase en ventana",
    what: "El buque está dentro de la ventana de una inspección de clase (intermedia, periódica o renovación). No es una falta, pero el inspector va a preguntar cuándo se hace.",
    how: "Coordiná la fecha con la sociedad de clase.\nCuando se haga, cargá la fecha en el certificado de clase, en Certificados.",
  },
  dockShaftDueSoon: {
    title: "Dique seco o eje en los próximos 90 días",
    what: "La inspección en dique seco o del eje portahélice vence en menos de 90 días.",
    how: "Confirmá la fecha de varada con el astillero y la sociedad de clase.\nArmá la especificación de varada con los pendientes del buque.",
  },
  extNothing: {
    title: "No hay inspecciones externas cargadas",
    what: "No hay ninguna inspección de bandera, del control del puerto, de clase ni de vetting cargada en el último año. El inspector pregunta por la última y por sus observaciones.",
    how: "Abrí Auditoría / Inspección externa.\nCargá la última inspección de cada tipo con su fecha y su resultado.\nCargá cada observación con su plazo de corrección.",
  },
  extFindingsOverdue: {
    title: "Observaciones con plazo vencido",
    what: "Hay observaciones de inspecciones externas abiertas con el plazo de corrección vencido. Un inspector de vetting las ve como una falta que la compañía no cerró.",
    how: "Abrí Auditoría / Inspección externa.\nEntrá a cada observación vencida.\nRegistrá qué se hizo y cerrala, o abrí la OT correctiva si falta el trabajo a bordo.",
  },
  extFindingsOpen: {
    title: "Observaciones de inspecciones externas abiertas",
    what: "Quedan observaciones abiertas de inspecciones anteriores, todavía dentro de su plazo. El inspector va a preguntar cómo se están corrigiendo.",
    how: "Abrí Auditoría / Inspección externa.\nRevisá cada observación abierta y su plazo.\nCerrala con la evidencia de lo que se hizo.",
  },
  crewNotApplicable: {
    title: "No aplica: buque sin dotación",
    what: "Las barcazas no llevan tripulación propia. Este capítulo se responde con la tripulación del remolcador.",
    how: "Revisá este capítulo en el remolcador que opera la barcaza.",
  },
  crewNothing: {
    title: "No hay tripulación cargada",
    what: "El sistema no tiene tripulantes a bordo cargados, así que no puede mostrar títulos, vencimientos ni horas de descanso.",
    how: "Abrí Tripulantes y cargá la tripulación a bordo con su cargo.\nCargá los títulos de cada uno con su vencimiento en Certificados Tripulación.\nRegistrá las horas de descanso en Horas de Descanso.",
  },
  crewCertsExpired: {
    title: "Títulos de tripulantes vencidos",
    what: "Hay tripulantes a bordo con títulos o certificados vencidos. Es una observación segura en cualquier inspección.",
    how: "Abrí Certificados Tripulación.\nRenová o reemplazá los títulos vencidos.\nCargá el título nuevo con su vencimiento.",
  },
  restNoRecords: {
    title: "Sin registros de horas de descanso",
    what: "Hay tripulación a bordo y no hay horas de descanso registradas en los últimos 30 días. El inspector pide ese registro también en buques chicos.",
    how: "Abrí Horas de Descanso.\nCargá el registro diario de cada tripulante.\nEl sistema marca solo los días que no cumplen el mínimo.",
  },
  restViolations: {
    title: "Días con violación del descanso",
    what: "En los últimos 30 días hay días en que algún tripulante no cumplió las horas mínimas de descanso.",
    how: "Abrí Horas de Descanso y revisá los días marcados.\nVerificá si es un error de carga o una violación real.\nSi es real, dejá escrita la causa y la medida para que no se repita.",
  },
  drillsNotApplicable: {
    title: "No aplica: buque sin dotación",
    what: "Los simulacros los hace la tripulación del remolcador, no la barcaza.",
    how: "Revisá los simulacros en el remolcador que opera la barcaza.",
  },
  drillsNothing: {
    title: "No hay simulacros configurados",
    what: "No hay ningún simulacro requerido con su frecuencia, así que el sistema no puede decir si están al día. El inspector pide el registro de los de incendio, abandono y derrame.",
    how: "Abrí Simulacros.\nCargá los simulacros requeridos con su frecuencia: incendio, abandono, derrame (SOPEP), hombre al agua.\nRegistrá cada simulacro hecho con su fecha y participantes.",
  },
  drillsOverdue: {
    title: "Simulacros vencidos o nunca hechos",
    what: "Hay simulacros requeridos que pasaron su frecuencia o que nunca se registraron.",
    how: "Abrí Simulacros.\nProgramá y hacé los vencidos.\nRegistralos con fecha, escenario y participantes.",
  },
  drillsDueSoon: {
    title: "Simulacros próximos a vencer",
    what: "Hay simulacros que vencen en los próximos 14 días.",
    how: "Abrí Simulacros y programalos antes de que venzan.",
  },
  eqNothing: {
    title: "Sin equipos reconocidos para este tema",
    what: "El sistema no encontró equipos de este tema en el buque. Puede que no apliquen a este tipo de buque, o que estén cargados con otro nombre.",
    how: "Si el buque tiene estos equipos, abrí Equipos y verificá que estén cargados con un nombre reconocible.\nSi no aplican a este buque, no hay nada que corregir.",
  },
  eqWithoutPlan: {
    title: "Equipos sin plan de mantenimiento",
    what: "Hay equipos de este tema sin ninguna tarea activa en el plan. Sin plan no hay registro de mantenimiento que mostrarle al inspector.",
    how: "Tocá el número para ver qué equipos son.\nEn Plan de Mantenimiento creá al menos una tarea activa para cada uno, con su periodicidad.\nSi lo mantiene un proveedor (balsas, extintores, CO2), cargá igual la tarea con área Proveedor.\nSi el equipo no lleva plan por decisión escrita, dejalo como excepción en la ficha del equipo.",
  },
  eqOverduePlans: {
    title: "Tareas de mantenimiento vencidas",
    what: "Hay tareas del plan de estos equipos que pasaron su fecha sin ejecutarse.",
    how: "Tocá el número para ver qué tareas son.\nEjecutalas y cerrá su OT con el resultado.\nSi no se pueden hacer a tiempo, cargá el diferimiento con su análisis de riesgo.",
  },
  eqOpenDefects: {
    title: "Defectos abiertos en estos equipos",
    what: "Hay defectos abiertos sobre equipos de este tema. El inspector los puede ver funcionando mal el día de la inspección.",
    how: "Tocá el número para ver qué defectos son.\nCorregilos o abrí la OT correctiva.\nSi la corrección espera un repuesto o una varada, dejalo registrado como diferimiento.",
  },
};
