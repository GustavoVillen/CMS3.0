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

// ── REGI-SYE-01.4 — Ingreso a espacio confinado (formato IMO) ────────────────

/** Sección 1 — Preparativo previo a la entrada (Capitán u Oficial responsable). */
export const ES_SECTION_1_TITLE = "Sección 1.- Preparativo previo a la entrada (Para ser comprobados por el Capitán u Oficial responsable)";
export const ES_SECTION_1: string[] = [
  "¿Ha sido aislado el espacio por desconexión o aislamiento de las tuberías en el tanque?",
  "¿Se han asegurado todas las válvulas de las tuberías dentro de este espacio para evitar una apertura accidental?",
  "¿Se ha limpiado el espacio a entrar?",
  "¿Ha sido totalmente ventilado el espacio?",
  "¿Se ha dispuesto que se lleven a cabo comprobaciones frecuentes en la atmósfera del espacio cerrado mientras está ocupado y después de que comiencen los trabajos?",
  "¿Se ha dispuesto que el espacio esté continuamente ventilado durante el periodo de ocupación y durante el comienzo de los trabajos?",
  "¿Se tiene iluminación adecuada?",
  "¿Está el equipo de resucitación y rescate disponible para uso inmediato en la entrada del espacio cerrado?",
  "¿Se ha designado una persona responsable para permanecer en la entrada del espacio cerrado?",
  "¿Ha sido avisado el Of. de Guardia (puente / máquinas / sala control de cargamento) de la entrada planificada?",
  "¿Se ha acordado y comprobado el sistema de comunicación entre el personal en la entrada y aquellos que han entrado en el espacio cerrado?",
  "¿Se han establecido y comprendido los procedimientos de emergencia y evacuación?",
  "¿Hay algún sistema para registrar quien está en el espacio cerrado?",
  "¿Es el equipo a utilizar de tipo homologado?",
];

/** Contraste del multigas — fila con lecturas y sus límites (literal del papel). */
export const ES_GAS_BLOCK_TITLE = "Contraste de equipo multigas con cilindro SPAN GAS";
export const ES_GAS_BLOCK_NOTE = "OBSERVACIONES: (en caso de dar lectura normal colocar OK, caso contrario colocar lectura según indica el equipo y enviar a calibración inmediata)";
export const ES_GAS_READINGS: Array<{ label: string; limit: string; reading: "o2" | "lel" | "h2s" | "co" | null }> = [
  { label: "Oxigeno",                  limit: "(Entre 20.8 a 21.0 %)", reading: "o2" },
  { label: "Hidrocarburos (% LFL)",    limit: "(< 1 %)",               reading: "lel" },
  { label: "Monóxido de carbono (ppm)", limit: "(< 12.5 ppm)",         reading: "co" },
  { label: "Sulfuro de Hidrógeno H2S (ppm)", limit: "(< 10 ppm)",      reading: "h2s" },
  { label: "Amoniaco NH3 (ppm)",       limit: "(< 25 ppm)",            reading: null },
  { label: "Benceno (ppm)",            limit: "(< 1 ppm)",             reading: null },
  { label: "Tolueno (ppm)",            limit: "(< 100 ppm)",           reading: null },
  { label: "Xileno (ppm)",             limit: "(< 100 ppm)",           reading: null },
];
export const ES_GAS_BLOCK_FOOTNOTE = "Valores distintos a estos no son permitidos. La normativa ACGIH (American Conference of Governmental Industrial Hygienists) estipula los valores de Monóxido de carbono para ingreso a espacio confinado.";

export const ES_SECTION_2_TITLE = "Sección 2.- Comprobaciones previas a la entrada (para ser llevadas a cabo por la persona autorizada a dirigir el equipo de entrada)";
export const ES_SECTION_2: string[] = [
  "La sección 1 de este permiso ha sido comprobada totalmente",
  "Estoy enterado de que este espacio debe ser evacuado inmediatamente en el caso de fallo en la ventilación o variaciones en las comprobaciones de la atmósfera que se ha establecido como criterio de seguridad.",
  "Acepto los procedimientos de comunicación",
  "Acepto informar cada ............................. minutos.",
  "Los procedimientos de evacuación y emergencia han sido acordados y comprendidos.",
];

export const ES_SIGNERS: string[] = [
  "Capitán u Oficial responsable",
  "Persona que dirige el equipo de entrada",
  "Responsable de supervisar la entrada",
];

export const ES_SECTION_3_TITLE = "Sección 3.- Comprobación a la salida";
export const ES_SECTION_3_TEXT = "Se ha producido el egreso del espacio confinado de todo el personal supervisado a la entrada, no se ha registrado ninguna novedad.";
export const ES_SECTION_3_SIGN = "Firma y aclaración de la persona responsable de supervisar el egreso del personal que realizó el trabajo.";

export const ES_INVALID_WARNING = "ESTE PERMISO SE CONSIDERARÁ INVALIDO SI LA VENTILACIÓN DEL ESPACIO CERRADO SE INTERRUMPE O SI CAMBIARA ALGUNA DE LAS CONDICIONES REGISTRADAS EN LA PRESENTE LISTA.";

export const ES_NOTES: string[] = [
  "1.- El permiso de entrada deberá contener una indicación clara de su máximo periodo de validez, el cual en ningún caso excederá de media jornada normal de trabajo en espacios que hayan contenido hidrocarburos, o en espacios adyacentes a ellos, y una jornada normal de trabajo en cualquier otro espacio.",
  "2.- Para obtener una muestra representativa de la atmósfera en los distintos departamentos, las muestras se tomarán a distintas profundidades y a través de tantas aberturas como sea posible. La ventilación se parará unos 10 minutos antes de que se lleven a cabo las comprobaciones de atmósfera previas a la entrada.",
  "3.- Se llevarán a cabo test de contaminantes tóxicos específicos, tales como benceno o sulfhídrico si se ha transportado en ese tanque carga con esos componentes.",
];

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
