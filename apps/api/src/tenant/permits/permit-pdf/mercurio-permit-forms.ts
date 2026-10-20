// Literales de los formularios de Permiso de Trabajo de Mercurio
// (REGI-SYE-01.4 .. 01.9, rev 3, vigentes desde 29.12.2025).
//
// Transcripción del papel — los textos se imprimen tal cual porque son parte del
// documento controlado: cambiarlos altera el formulario auditable. Los originales
// están en MisDocs/MercurioSGS/FormsMerc/*.docm.
//
// Sin lógica: sólo datos que consume template-mercurio.ts.

export interface ChecklistGroup {
  /** Subtítulo dentro del bloque (null = sin subtítulo). */
  title: string | null;
  items: string[];
}

export interface GasResultRow {
  gas: string;
  reference: string;
  /** Lectura del gas test que corresponde a esta fila, si el sistema la tiene. */
  reading: "o2" | "lel" | "h2s" | "co" | null;
}

export interface MercurioPermitForm {
  /** Título del bloque de checklist (vacío = el formulario no lo tiene). */
  considerationsTitle: string;
  considerations: ChecklistGroup[];
  ppe: string[];
  /** Filas del recuadro RESOLUCION. Vacío = una sola fila sin etiqueta. */
  resolutionRows: string[];
  /** Opciones del recuadro TRABAJO PARA REALIZAR / TIPO DE TRABAJO A REALIZARSE. */
  workKinds: string[];
  gasRows: GasResultRow[];
}

// ── Bloques repetidos entre formularios ──────────────────────────────────────

const PPE_STANDARD = [
  "Casco",
  "Luz Minero - Antiexplosiva",
  "Guantes",
  "Zapatos de Seguridad",
  "Anteojos de Seguridad",
  "Antiparras",
  "Protección Auditiva",
  "Arnés",
  "Línea de Vida",
  "Chaleco Salvavidas",
  "Filtro Respiratorio",
];

// El 01.9 dice "Luz Minero" a secas (el buzo no trabaja en atmósfera explosiva).
const PPE_UNDERWATER = PPE_STANDARD.map(p => (p === "Luz Minero - Antiexplosiva" ? "Luz Minero" : p));

export const PPE_HEADER = "EQUIPO DE PROTECCION PERSONAL (Debe ser completado por el Inspector o Supervisor del Trabajo)";
export const CONSIDERATIONS_HEADER = "CONSIDERACIONES PREVIAS (Debe ser completado por el Inspector o Supervisor del Trabajo)";

/** Texto fijo del recuadro COMENTARIOS ESPECIALES (idéntico en los 5 formularios que lo tienen). */
export const SPECIAL_COMMENTS: string[] = [
  "El presente permiso tiene validez hasta la fecha y hora indicada.",
  "No se expedirán permisos por más de 7 días de trabajo.",
  "Los permisos de acceso a espacios confinados tendrán una validez máxima de 24 hs tras lo cual se debe generar un nuevo permiso.",
  "En caso de cambiar las condiciones antes expuestas el presente permiso carece de validez.",
  "Se debe operar en todo caso con buenas condiciones de mar y tiempo.",
  "La responsabilidad de mantener las condiciones de seguridad será siempre del Capitán o la Máxima autoridad a bordo en su caso. Si el trabajo está a cargo de personal en tierra, se designará un responsable.",
  "Debe estar el presente a la vista para el caso de ser inspeccionado.",
  "Se debe enviar una copia del mismo al Jefe de Seguridad previo al inicio de los trabajos.",
  "Se debe comunicar la finalización de los mismos.",
];

/** Recuadro ESTADO DEL BUQUE (01.7 / 01.8 / 01.9). */
export const SHIP_STATUS_OPTIONS = ["NAVEGACION", "AMARRADO", "PUERTO", "VARADERO"];

/** Recuadro DEPARTAMENTO del encabezado (01.4 / 01.5 / 01.6). */
export const DEPARTMENT_OPTIONS = ["CUBIERTA", "MAQUINAS", "SERVICIOS", "OTRO"];

/** Recuadro de firmas del encabezado (01.4 / 01.5 / 01.6). */
export const HEADER_ROLES = ["CAPITAN", "PRACTICO", "PATRON BAQUEANO", "JEFE DE MAQUINAS"];

// ── REGI-SYE-01.5 — Trabajo en caliente ──────────────────────────────────────

const HOT_WORK_CONSIDERATIONS: ChecklistGroup[] = [{
  title: null,
  items: [
    "¿Se ha familiarizado al personal que hará el trabajo sobre las medidas de seguridad?",
    "¿Se ha familiarizado al personal que hará el trabajo sobre las medidas de emergencia?",
    "¿Se cuenta con personal fuera del área de trabajo de respaldo ante emergencias?",
    "¿Ha sido dicho personal familiarizado con medidas de seguridad?",
    "¿Ha sido dicho personal familiarizado con medidas de emergencia?",
    "¿Se ha marcado el área de trabajo?",
    "¿Se colocaron carteles indicadores para impedir que se transite?",
    "¿El área de trabajo está limpia y libre de derivados de hidrocarburos o residuos?",
    "¿Se desgasificó la zona?",
    "¿En caso de Trabajos en Caliente se cerraron venteos, sondas y registros cercanos al área de trabajo?",
    "¿En caso de Trabajos en Caliente se colocaron tapones goma con junta de expansión regulable con tornillo para hacerlo estanco?",
    "¿En caso de Trabajos en Caliente se inertizó o completó con agua los compartimentos linderos al área de trabajo?",
    "¿Se colocaron en el área 2 extintores y manguera de incendio con puntero doble propósito conectada?",
    "¿Es necesaria ventilación forzada?",
    "¿Es necesaria arresta llamas, o pantallas para control de chispas?",
    "¿Hay riesgo de incendios por maderas, plásticos u otros elementos inflamables?",
    "Quitar el revestimiento del mamparo",
    "Calentar / cortar sólo punta de tornillos",
    "¿Se cuenta con vías de comunicación con el personal a realizar el trabajo?",
    "Desenergizar el área de trabajo, colocando cartel indicador",
    "Cable a tierra de pieza a ser soldada, próximo al lugar",
    "La Energía de iluminación y/o trabajo debe estar protegida contra choques eléctricos o menor de 32 volts",
  ],
}];

const HOT_WORK_GAS_ROWS: GasResultRow[] = [
  { gas: "OXIGENO",            reference: "20.8% - 21.0%", reading: "o2" },
  { gas: "GASES COMBUSTIBLES", reference: "-10% LIL",      reading: "lel" },
  { gas: "NH3",                reference: "(< 25 ppm)",    reading: null },
  { gas: "CO",                 reference: "(< 12.5 ppm)",  reading: "co" },
  { gas: "OTRO",               reference: "",              reading: null },
];

// ── REGI-SYE-01.7 — Trabajo en altura ────────────────────────────────────────

const ALOFT_CONSIDERATIONS: ChecklistGroup[] = [
  {
    title: "ANALISIS DEL ENTORNO",
    items: [
      "El sitio de trabajo está libre de lluvia, tormenta eléctrica, vientos fuertes o cualquier condición adversa",
      "El lugar de trabajo se encuentra en las condiciones de orden y aseo, requeridas para ejecutar la labor",
      "Los trabajos en áreas adyacentes producen riesgos sobre este trabajo",
      "Se han analizado los peligros y controles por trabajos adyacentes",
      "Se ha informado al personal autorizado sobre las otras actividades que se ejecutan en el área de trabajo",
      "En caso de trabajos con posibilidad de riesgo eléctrico (líneas o equipos energizados), se elaboró el permiso de trabajo con riesgo eléctrico",
      "Se ha instalado la señalización adecuada y necesaria para delimitar el área de trabajo",
    ],
  },
  {
    title: "LISTA DE VERIFICACION",
    items: [
      "Se cuenta con un procedimiento de seguridad divulgado para trabajo en alturas",
      "Se cuenta con un procedimiento de rescate en caso de emergencia",
      "Existe línea de vida y puntos de anclaje en buen estado para los trabajadores",
      "Está la línea de seguridad anclada a un soporte diferente a la estructura donde se van a parar los trabajadores",
      "Se tienen medidas de seguridad para el manejo de herramientas en altura con posibilidad de caída",
      "La actividad de trabajo en alturas se realiza mínimo entre dos personas",
      "Existen barandas a 1 metro mínimo de la superficie de trabajo (cuando aplique)",
    ],
  },
  {
    title: "TRABAJO CON ANDAMIOS",
    items: [
      "¿El andamio se encuentra certificado?",
      "La estructura del andamio es estable y metálica",
      "Está en buenas condiciones, completo y ha sido nivelado",
      "Todos los parales están debidamente anclados",
      "El piso de apoyo esta firme y bien nivelado",
      "Existe línea de vida asegurada e independiente al andamio",
      "¿En caso de usar andamio colgante, están las poleas lubricadas y en buen estado?",
      "¿El sistema de sujeción del andamio colgante está bien asegurado?",
      "¿Están instalados los guardapiés?",
    ],
  },
  {
    title: "TRABAJOS CON ESCALERAS",
    items: [
      "La distancia entre escalones es la misma y máx. 40 cm",
      "Están los pasos en buen estado",
      "Los largueros son máximos de 5 m. (aplica para escaleras sin extensión)",
      "Sobresalen por lo menos 1 m. sobre su apoyo superior",
      "Está soportada sobre una superficie firme",
      "Están las uniones optimas",
      "Es posible amarrar la escalera",
      "Si no es posible amarrar la escalera, hay un ayudante para sostenerla",
      "Las zapatas de la escalera están en buen estado",
      "Es la escalera de material dieléctrico (si se requiere)",
      "La cuerda para la extensión esta amarrada y en buen estado (aplica para escaleras de extensión)",
      "La distancia pared a base de la escalera es 1/4 de longitud",
      "Escalera de tijera con tensores en optimo estado",
    ],
  },
];

// ── REGI-SYE-01.9 — Trabajo subacuático ──────────────────────────────────────

const UNDERWATER_CONSIDERATIONS: ChecklistGroup[] = [
  {
    title: "PARA SER LLENADO POR EL CAPITAN",
    items: [
      "¿Terminal / Autoridad Portuaria / Agente, informado y obtenido el permiso?",
      "¿Esta Izada la Bandera ALFA \"A\": buzo en el agua?",
      "¿Se colocaron avisos de advertencia en la popa?",
      "¿Acordadas y probadas las comunicaciones con el Supervisor de Buzos?",
    ],
  },
  {
    title: "PARA SER LLENADO POR EL JEFE DE MAQUINAS",
    items: [
      "¿Se acordó con el Supervisor de Buzos la manera en que se llevará a cabo el trabajo?",
      "¿Se inmovilizó y aisló toda maquinaria relacionada con la operación de Buceo?",
      "¿Se colocaron avisos de \"NO OPERAR\" en los controles e interruptores?",
      "¿Se informó al Supervisor de Buzos sobre la condición de la maquinaria submarina?",
      "¿Se informó al Supervisor de Buzos sobre la condición de las tomas y descargas?",
      "¿Se informó al Supervisor de Buzos si se va a girar la hélice?",
      "¿Se acordaron y probaron las comunicaciones con el Supervisor de Buzos?",
      "¿Se acordaron las Señales entre el buzo y la Sala de Máquinas?",
      "¿Se informó a todo el personal apropiado de la Sala de Máquinas sobre la operación de buceo?",
    ],
  },
  {
    title: "PARA SER LLENADO POR EL SUPERVISOR DEL BUZO",
    items: [
      "Discuta y acuerde el trabajo con el Capitán y los Oficiales de Cubierta y Máquinas involucrados.",
      "Acuerde y pruebe las comunicaciones con el Buque.",
      "Imparta las instrucciones de trabajo a los Buzos.",
    ],
  },
];

// ── REGI-SYE-01.4 — Ingreso a espacio confinado ──────────────────────────────
// Papel del 02.10.2026 (sigue diciendo rev 3 / 29.12.2025). Reemplaza al
// formato IMO anterior: sin notas al pie ni bloque SPAN GAS de 8 gases; suma la
// verificación con gas patrón y la planilla de mediciones por compartimento.
//
// El papel repite las dos últimas preguntas de la Sección 1 y pone dos veces
// "TK CARGA 1 ER" en las mediciones (ítems 17 y 21): las preguntas van una sola
// vez y el renglón 21 queda en blanco para anotar otra ubicación.

/** Sección 1 — Preparativo previo a la entrada (Capitán u Oficial responsable). */
export const ES_SECTION_1_TITLE = "SECCION 1. Preparativo previo a la entrada (Para ser comprobados por el Capitán u Oficial responsable)";
export const ES_SECTION_1: string[] = [
  "¿Ha sido aislado el espacio por desconexión o aislamiento de las tuberías en el tanque?",
  "¿Se han asegurado todas las válvulas de las tuberías dentro de este espacio para evitar una apertura accidental?",
  "¿Se ha limpiado el espacio a entrar?",
  "¿Ha sido totalmente ventilado el espacio?",
  "¿Se ha dispuesto que se lleven a cabo comprobaciones frecuentes en la atmósfera del espacio cerrado mientras está ocupado y después de que comiencen los trabajos?",
  "¿Se ha dispuesto que el espacio esté continuamente ventilado durante el periodo de ocupación y durante el comienzo de los trabajos?",
  "¿Se tiene iluminación adecuada?",
  "¿Está el equipo de resucitación y rescate disponible para uso inmediato en la entrada del espacio cerrado?",
  "¿Ha sido avisado el Of. de Guardia (puente / máquinas / sala control de cargamento) de la entrada planificada?",
  "¿Se ha acordado y comprobado el sistema de comunicación entre el personal en la entrada y aquellos que han entrado en el espacio cerrado?",
  "¿Se han establecido y comprendido los procedimientos de emergencia y evacuación?",
  "¿Hay algún sistema para registrar quien está en el espacio cerrado?",
];

/** Verificación del medidor con gas patrón (ITEM | SI | NO). */
export const ES_GAS_CHECK_TITLE = "VERIFICACION PREVIA CON GAS PATRON";
export const ES_GAS_CHECK: string[] = [
  "¿Previo al uso del medidor de gas, se utilizó el gas patrón para verificar su uso?",
  "¿Los resultados fueron satisfactorios?",
  "¿En caso de no ser satisfactorios, se cambió el medidor de gas?",
  "¿En caso de un nuevo medidor de gases, se utilizó el gas patrón para verificar los niveles?",
];

/** Gases del contraste y de las mediciones, con el límite impreso bajo cada columna. */
export const ES_CONTRAST_TITLE = "CONTRASTE GAS PATRON";
export const ES_GASES: Array<{ gas: string; limit: string; reading: "o2" | "lel" | "co" | "h2s" }> = [
  { gas: "O2",  limit: "Entre 20.8 y 21.0%", reading: "o2" },
  { gas: "LEL", limit: "<1%",                reading: "lel" },
  { gas: "CO",  limit: "<12.5 ppm",          reading: "co" },
  { gas: "H2S", limit: "<10 ppm",            reading: "h2s" },
];

/** Renglones de MEDICIONES DE GAS. Vacío = renglón para completar a mano. */
export const ES_GAS_READINGS_TITLE = "MEDICIONES DE GAS";
export const ES_GAS_LOCATIONS: string[] = [
  "P. PROA",
  "COFF 1 BR", "COFF 2 BR", "COFF 3 BR", "COFF 4 BR", "COFF 5 BR",
  "P. POPA",
  "COFF 1 ER", "COFF 2 ER", "COFF 3 ER", "COFF 4 ER", "COFF 5 ER",
  "TK CARGA 1 BR", "TK CARGA 2 BR", "TK CARGA 3 BR", "TK CARGA 4 BR",
  "TK CARGA 1 ER", "TK CARGA 2 ER", "TK CARGA 3 ER", "TK CARGA 4 ER",
  "",
];

export const ES_SECTION_2_TITLE = "SECCION 2. Comprobaciones previas a la entrada (para ser llevadas a cabo por la persona autorizada a dirigir el equipo de entrada)";
export const ES_SECTION_2: string[] = [
  "La sección 1 de este permiso ha sido comprobada totalmente",
  "Estoy enterado de que este espacio debe ser evacuado inmediatamente en el caso de fallo en la ventilación o variaciones en las comprobaciones de la atmósfera que se ha establecido como criterio de seguridad",
  "Acepto los procedimientos de comunicación",
  "Acepto informar cada 15 Minutos",
  "Los procedimientos de evacuación y emergencia han sido acordados y comprendidos",
];

export const ES_INVALID_WARNING = "ESTE PERMISO SE CONSIDERARÁ INVALIDO SI LA VENTILACIÓN DEL ESPACIO CERRADO SE INTERRUMPE O SI CAMBIARA ALGUNA DE LAS CONDICIONES REGISTRADAS EN LA PRESENTE LISTA";

export const ES_SECTION_3_TITLE = "SECCION 3. Comprobación a la salida";
export const ES_SECTION_3: string[] = [
  "Se ha producido el egreso del espacio confinado de todo el personal supervisado a la entrada, no se ha registrado ninguna novedad",
  "Estoy enterado de que este espacio debe ser evacuado inmediatamente en el caso de fallo en la ventilación o variaciones en las comprobaciones de la atmósfera que se ha establecido como criterio",
];

/** Los dos recuadros NOMBRE Y FIRMA (PUESTO | NOMBRE | FECHA/HORA | FIRMA). */
export const ES_EXIT_SIGNERS = ["Supervisor de Trabajo", "Supervisor de Entrada"] as const;
export const ES_SIGNERS = [
  "Capitán", "Oficial Responsable", "Supervisor que midió gases",
  "Supervisor de Entrada", "Operador que entra", "Operador que entra",
] as const;

/** Renglones del registro de quienes entraron (12 en la hoja 3 + 3 en la 4). */
export const ES_ENTRY_LOG_ROWS = 15;

// ── Definición por tipo de permiso ───────────────────────────────────────────

export const MERCURIO_PERMIT_FORMS: Record<string, MercurioPermitForm> = {
  HOT_WORK: {
    considerationsTitle: CONSIDERATIONS_HEADER,
    considerations: HOT_WORK_CONSIDERATIONS,
    ppe: PPE_STANDARD,
    resolutionRows: ["Trabajo en Caliente", "Trabajo en Frío", "Ingreso Hombre Seguro"],
    workKinds: ["TRABAJO EN CALIENTE", "TRABAJO EN FRIO", "LIMPIEZA", "INGRESO A ESPACIO CONFINADO"],
    gasRows: HOT_WORK_GAS_ROWS,
  },
  COLD_WORK: {
    considerationsTitle: "",
    considerations: [],
    ppe: PPE_STANDARD,
    resolutionRows: ["Trabajo en Frío"],
    workKinds: [],
    gasRows: [],
  },
  WORKING_ALOFT: {
    considerationsTitle: CONSIDERATIONS_HEADER,
    considerations: ALOFT_CONSIDERATIONS,
    ppe: PPE_STANDARD,
    resolutionRows: [],
    workKinds: ["MANTENIMIENTO", "REPARACION", "PINTURA", "OTRO"],
    gasRows: [],
  },
  ELECTRICAL_ISOLATION: {
    considerationsTitle: "",
    considerations: [],
    ppe: PPE_STANDARD,
    resolutionRows: [],
    workKinds: ["MANTENIMIENTO", "REPARACION", "PINTURA", "OTRO"],
    gasRows: [],
  },
  UNDERWATER_WORK: {
    considerationsTitle: "",
    considerations: UNDERWATER_CONSIDERATIONS,
    ppe: PPE_UNDERWATER,
    resolutionRows: [],
    workKinds: [],
    gasRows: [],
  },
  ENCLOSED_SPACE_ENTRY: {
    considerationsTitle: "",
    considerations: [],
    ppe: [],
    resolutionRows: [],
    workKinds: [],
    gasRows: [],
  },
};

export function mercurioPermitForm(permitType: string): MercurioPermitForm {
  return MERCURIO_PERMIT_FORMS[permitType] ?? MERCURIO_PERMIT_FORMS.HOT_WORK;
}
