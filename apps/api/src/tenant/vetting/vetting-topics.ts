// Temas de equipo del cuestionario BIQ5 (OCIMF, barcazas y remolcadores).
//
// El BIQ pregunta por equipos concretos: bombas de incendio, balsas, guinches
// de remolque, válvulas P/V, alarmas de nivel… El PMS no tiene un campo que diga
// "esto es salvamento": el SFI que usa cada empresa es propio (en mercurio el
// 300 mezcla balsas con bombas de incendio y el 400 mete el CO2 entre los
// equipos de navegación) y nadie completa la clase de equipo. Lo que sí es
// estable es el NOMBRE: cada barcaza repite "Sistema de Lucha Contra Incendio",
// "Sistema de Venteo (Válvulas P/V)", etc.
//
// Por eso cada tema se reconoce por el nombre del equipo, normalizado (sin
// tildes, minúsculas). Si otra empresa los nombra distinto, el tema le sale
// "sin equipo reconocido" (INFO), nunca un verde falso; y el detalle de cada
// tarjeta lista exactamente qué equipos se tomaron, así se puede corregir acá.
//
// Verificado contra los 162 nombres de equipo de mercurio (oct 2026).

/** Capítulos del BIQ5, en el orden del cuestionario. */
export const BIQ_CHAPTERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"] as const;
export type BiqChapter = (typeof BIQ_CHAPTERS)[number];

export interface VettingTopic {
  key: string;
  chapter: BiqChapter;
  /** Preguntas del BIQ que respalda (sólo el número; el texto es de OCIMF). */
  questions: string;
  /**
   * Equipo de seguridad: si hay alguno sin plan de mantenimiento, el bloque va
   * en BRECHA y no en ATENCIÓN. Un inspector lo anota como observación seguro.
   */
  safety: boolean;
  /** Nombre normalizado que pertenece al tema, en cualquier buque. */
  pattern: RegExp;
  /** Nombres que lo matchean pero son de otro tema. */
  exclude?: RegExp;
  /**
   * Además, sólo en buques SIN dotación (barcazas): en una barcaza tanque no hay
   * propulsión ni servicios de habitabilidad, así que todo motor o bomba sirve a
   * la descarga ("Motor - Detroit…" es el motor de la bomba de carga).
   */
  bargePattern?: RegExp;
}

export const VETTING_TOPICS: readonly VettingTopic[] = [
  {
    key: "navEquipment", chapter: "4", questions: "4.2–4.26", safety: false,
    pattern: /\b(ais|gps|radar|vhf|navtex|dsc)\b|ecosonda|compas|girocompas|carta nautica|barometro|intercomunicador|telefono de consola|senales luminicas|luces de navegacion|proyector|reflector|\bpito\b|sirena/,
    // "bocina" NO: a bordo es el tubo de codaste ("Refrigeración de Bocinas").
  },
  {
    key: "fireFighting", chapter: "5", questions: "5.10–5.19", safety: true,
    pattern: /incendio|\bco2\b|extintor|espuma|rociador|sprinkler/,
  },
  {
    key: "lifeSaving", chapter: "5", questions: "5.20–5.23", safety: true,
    pattern: /salvavidas|salvamento|\bbalsas?\b|chaleco|\baros?\b|\blancha\b|bote de rescate|eebd|escape|bengala|pirotecni/,
  },
  {
    key: "structure", chapter: "7", questions: "7.1–7.5", safety: false,
    pattern: /\bcasco\b|tanques? de (combustible|lastre|carga|cargamento)|doble fondo|coferdam|cofferdam|espacios vacios|\bpique\b/,
  },
  {
    key: "cargoSystem", chapter: "8", questions: "8.19–8.52 · 8.68–8.96", safety: false,
    pattern: /cargamento|manifold|venteo|valvulas? p\/?v|medicion de nivel|alarmas? de (alto )?nivel|alarmas de tanques(?! de consumo)|manguera(s)? de (carga|cargamento)|calefaccion de (la )?carga/,
    bargePattern: /\bmotor\b|\bbomba\b/,
  },
  {
    key: "mooring", chapter: "9", questions: "9.2–9.9", safety: false,
    pattern: /amarre|fondeo|cabrestante|molinete|\bancla\b|\bbitas?\b|guias? de cabo/,
  },
  {
    key: "towing", chapter: "10", questions: "10.2–10.34", safety: false,
    pattern: /remolque|guinche|winche|\bempuje\b|tope de empuje|brida|bridle|gancho de remolque/,
  },
  {
    key: "machinerySafety", chapter: "11", questions: "11.4–11.16 · 11.26–11.33 · 11.41–11.45", safety: true,
    pattern: /emergencia|bateria|alarma|corte remoto|cortes y cierres|sentina|gran achique|servomotor|sistema de gobierno|\btimon\b|antiexplosivo|separador de aguas oleosas|tablero electrico principal|aislaciones|ventiladores y extractores/,
    // La alarma de nivel de los tanques de carga es del capítulo 8.
    exclude: /medicion de nivel/,
  },
];

export const TOPIC_KEYS = VETTING_TOPICS.map(t => t.key);

/** Mismo criterio que class-cycle.ts: sin tildes y en minúsculas. */
export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** ¿El equipo pertenece al tema? `crewed` = el buque lleva dotación. */
export function assetMatchesTopic(topic: VettingTopic, assetName: string, crewed: boolean | null): boolean {
  const n = normalizeName(assetName);
  if (topic.exclude?.test(n)) return false;
  if (topic.pattern.test(n)) return true;
  return crewed === false && !!topic.bargePattern?.test(n);
}

/**
 * Medidas de cada tema. La clave de métrica es `vetEq_<tema>_<medida>`: así el
 * detalle sabe qué tema y qué lista devolver, y la planilla del módulo filtra
 * por los mismos registros que contó la tarjeta.
 */
export const TOPIC_MEASURES = ["assets", "withPlan", "withoutPlan", "overduePlans", "openDefects"] as const;
export type TopicMeasure = (typeof TOPIC_MEASURES)[number];

export const topicMetricKey = (topic: string, measure: TopicMeasure) => `vetEq_${topic}_${measure}`;

export function parseTopicMetricKey(key: string): { topic: VettingTopic; measure: TopicMeasure } | null {
  const m = /^vetEq_([A-Za-z]+)_([A-Za-z]+)$/.exec(key);
  if (!m) return null;
  const topic = VETTING_TOPICS.find(t => t.key === m[1]);
  const measure = TOPIC_MEASURES.find(x => x === m[2]);
  return topic && measure ? { topic, measure } : null;
}
