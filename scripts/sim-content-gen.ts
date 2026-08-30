// Generador DETERMINISTICO de contenido para la simulacion de OTs (M01).
//
// No usa IA: deriva contenido coherente por tarea a partir del taskCode/title
// del plan, mediante heuristicas por palabra clave. Todo es revisable en el
// dry-run de simulate-wo-history.ts antes de escribir en produccion.
//
// Regla del proyecto (CLAUDE.md §8): no fabricar decisiones de criticidad/
// cumplimiento. Por eso los campos de riesgo/RCM SOLO se generan cuando el plan
// no los trae (decision explicita del usuario), y se mantienen conservadores.

export type ConsequenceCategory =
  | "SAFETY"
  | "ENVIRONMENTAL"
  | "OPERATIONAL"
  | "NON_OPERATIONAL";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface PlanLike {
  taskCode: string;
  title: string;
  description?: string | null;
  estimatedHours?: number | null;
  acceptanceCriteria?: string | null;
  loto?: string | null;
  riskLevel?: string | null;
  riskAnalysisResult?: string | null;
  consequenceCategory?: string | null;
  consequenceRationale?: string | null;
}

/** Campos de apertura de la OT (heredados del plan si existen, generados si faltan). */
export interface OpenContent {
  description: string;
  acceptanceCriteria: string;
  loto: string;
  riskLevel: RiskLevel;
  riskAnalysisResult: string;
  consequenceCategory: ConsequenceCategory;
  consequenceRationale: string;
  /** Que campos se GENERARON (vs heredados) — para mostrar en el dry-run. */
  generated: string[];
}

/** Contenido de ejecucion (varia levemente por ocurrencia). */
export interface ExecutionContent {
  avance: string;
  observations: string;
  actualHours: number;
}

// ── Helpers de matching (robustos: segmentos de codigo + palabras completas) ─────
// Normaliza: quita acentos y pasa a mayusculas.
function norm(s: string): string {
  return (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
}
// Segmentos del taskCode: "M01-BBA-INC-EM-03" -> ["M01","BBA","INC","EM","03"].
function segsOf(taskCode: string): string[] {
  return norm(taskCode).split(/[-_ ]+/).filter(Boolean);
}
// Match de codigos cortos SOLO contra segmentos exactos (evita "MA" dentro de "Mantenimiento").
function hasSeg(segs: string[], codes: string[]): boolean {
  return codes.some((c) => segs.includes(c));
}
// Match de palabras del titulo con limite de palabra (evita "INC" dentro de "principal").
function hasWord(text: string, words: string[]): boolean {
  const t = norm(text);
  return words.some((w) => new RegExp(`\\b${w}`).test(t));
}

function nonEmpty(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

// ── Clasificacion de dominio (RCM consequenceCategory) ──────────────────────────
// Precedencia: SAFETY > ENVIRONMENTAL > NON_OPERATIONAL (confort) > OPERATIONAL (default).
const SAFETY_SEG = ["INC", "CO2", "EXT"];
const SAFETY_WORD = ["INCENDIO", "CONTRAINCENDIO", "EXTINTOR", "BENGALA", "PIROTEC", "SALVAVIDA", "BALSA", "EPIRB", "SART", "NAUFRAG"];
const ENV_SEG = ["COMB", "SEWAGE", "ACH", "SENTINA"];
const ENV_WORD = ["COMBUSTIBLE", "GASOIL", "ACEITE", "SENTINA", "OLEOSO", "SEPARADOR", "AGUAS", "RESIDUO", "DERRAME", "LUBRICANTE"];
const NONOP_SEG = ["COCINA", "INTERCOM", "TEL", "ELEV", "REF"];
const NONOP_WORD = ["COCINA", "INTERCOMUNICADOR", "TELEFON", "ASCENSOR", "CONFORT", "REFRIGERAC", "AIRE ACOND"];

export function classifyConsequence(p: PlanLike): ConsequenceCategory {
  const segs = segsOf(p.taskCode);
  const title = p.title;
  if (hasSeg(segs, SAFETY_SEG) || hasWord(title, SAFETY_WORD)) return "SAFETY";
  if (hasSeg(segs, ENV_SEG) || hasWord(title, ENV_WORD)) return "ENVIRONMENTAL";
  if (hasSeg(segs, NONOP_SEG) || hasWord(title, NONOP_WORD)) return "NON_OPERATIONAL";
  return "OPERATIONAL";
}

// ── Nivel de riesgo ─────────────────────────────────────────────────────────────
const HIGH_SEG = ["GOB", "TIMON", "EJE", "PROP"];
const HIGH_WORD = ["TURBO", "INYECTOR", "CULATA", "OVERHAUL", "DESARME", "ALINEAC", "REDUCTORA", "PROPULSION"];
const LOW_WORD = ["INSPECCION", "VERIFICAC", "REVISION", "CONTROL", "LECTURA", "PRUEBA", "CHEQUEO", "LIMPIEZA", "ENGRASE", "LUBRICAC", "CALIBRAC", "LIBRO"];

export function classifyRisk(p: PlanLike, cat: ConsequenceCategory): RiskLevel {
  const segs = segsOf(p.taskCode);
  if (cat === "SAFETY" || hasSeg(segs, HIGH_SEG) || hasWord(p.title, HIGH_WORD)) return "HIGH";
  if (hasWord(p.title, LOW_WORD)) return "LOW";
  return "MEDIUM";
}

// ── LOTO ────────────────────────────────────────────────────────────────────────
const HID_SEG = ["HID", "GOB", "TIMON", "MALACATE"];
const HID_WORD = ["HIDRAULIC", "GOBIERNO", "TIMON", "MALACATE"];
const ELEC_SEG = ["ALT", "BAT", "RADAR", "VHF", "AIS", "GPS", "TEL", "INTERCOM", "TABLERO"];
const ELEC_WORD = ["ELECTRIC", "ALTERNADOR", "BATERIA", "TABLERO", "LUCES", "ILUMINAC", "RADAR"];
const FUEL_SEG = ["COMB"];
const FUEL_WORD = ["COMBUSTIBLE", "GASOIL", "ACEITE", "LUBRICANTE"];
const ENGINE_SEG = ["MP", "MA", "CR", "EB", "BBA", "COMP", "EJE"];
const ENGINE_WORD = ["MOTOR", "BOMBA", "COMPRESOR", "REDUCTORA"];

export function buildLoto(p: PlanLike, risk: RiskLevel): string {
  const segs = segsOf(p.taskCode);
  const title = p.title;
  const anyEnergy =
    hasSeg(segs, [...HID_SEG, ...ELEC_SEG, ...FUEL_SEG, ...ENGINE_SEG]) ||
    hasWord(title, [...HID_WORD, ...ELEC_WORD, ...FUEL_WORD, ...ENGINE_WORD]);
  if (risk === "LOW" && !anyEnergy)
    return "No aplica — tarea de inspeccion/verificacion sin intervencion sobre fuentes de energia.";
  if (hasSeg(segs, HID_SEG) || hasWord(title, HID_WORD)) return "Despresurizacion del sistema hidraulico, bloqueo y etiquetado de la fuente (LOTO hidraulico).";
  if (hasSeg(segs, ELEC_SEG) || hasWord(title, ELEC_WORD)) return "Bloqueo y etiquetado de la alimentacion electrica del equipo (LOTO electrico).";
  if (hasSeg(segs, FUEL_SEG) || hasWord(title, FUEL_WORD)) return "Cierre y bloqueo de valvulas de combustible/aceite, alivio de presion y etiquetado (LOTO).";
  if (hasSeg(segs, ENGINE_SEG) || hasWord(title, ENGINE_WORD)) return "Equipo detenido, bloqueo de arranque y etiquetado; cierre de valvulas asociadas (LOTO).";
  return "Bloqueo y etiquetado de las fuentes de energia del equipo antes de la intervencion (LOTO).";
}

// ── Textos de riesgo / RCM ──────────────────────────────────────────────────────
const HAZARD: Record<ConsequenceCategory, string> = {
  SAFETY: "incendio/explosion y fallo de los medios de respuesta ante emergencia",
  ENVIRONMENTAL: "derrame de hidrocarburos/efluentes y contaminacion",
  OPERATIONAL: "atrapamiento, quemaduras y degradacion/falla del equipo",
  NON_OPERATIONAL: "riesgo bajo asociado a la intervencion",
};
const RCM_RATIONALE: Record<ConsequenceCategory, string> = {
  SAFETY: "Si la tarea no se ejecuta se compromete la seguridad de la tripulacion y la capacidad de respuesta ante emergencias.",
  ENVIRONMENTAL: "Si la tarea no se ejecuta aumenta el riesgo de derrame/contaminacion y posibles sanciones ambientales.",
  OPERATIONAL: "Si la tarea no se ejecuta se degrada el equipo, con impacto en la disponibilidad y la operacion del buque.",
  NON_OPERATIONAL: "Si la tarea no se ejecuta se afecta el confort/servicios a bordo, sin impacto operativo critico.",
};

function buildRiskAnalysis(cat: ConsequenceCategory): string {
  return `Peligros principales: ${HAZARD[cat]}. Mitigacion: uso de EPP, aplicacion de LOTO y cumplimiento del procedimiento del fabricante.`;
}

function buildAcceptance(p: PlanLike): string {
  const t = p.title.trim().replace(/\.$/, "");
  return `Equipo operativo y dentro de los parametros del fabricante tras "${t}"; sin fugas, ruidos anormales ni alarmas activas.`;
}

function buildDescription(p: PlanLike): string {
  const t = p.title.trim().replace(/\.$/, "");
  return `${t}. Mantenimiento preventivo programado conforme al plan ${p.taskCode} y a las recomendaciones del fabricante.`;
}

// ── API publica ─────────────────────────────────────────────────────────────────

/** Construye los campos de apertura: hereda lo que el plan trae, genera lo que falta. */
export function buildOpenContent(p: PlanLike): OpenContent {
  const cat = (nonEmpty(p.consequenceCategory) as ConsequenceCategory | null) ?? classifyConsequence(p);
  const risk = (nonEmpty(p.riskLevel) as RiskLevel | null) ?? classifyRisk(p, cat);
  const generated: string[] = [];

  const description = nonEmpty(p.description) ?? (generated.push("description"), buildDescription(p));
  const acceptanceCriteria = nonEmpty(p.acceptanceCriteria) ?? (generated.push("acceptanceCriteria"), buildAcceptance(p));
  const loto = nonEmpty(p.loto) ?? (generated.push("loto"), buildLoto(p, risk));
  if (!nonEmpty(p.riskLevel)) generated.push("riskLevel");
  const riskAnalysisResult = nonEmpty(p.riskAnalysisResult) ?? (generated.push("riskAnalysisResult"), buildRiskAnalysis(cat));
  if (!nonEmpty(p.consequenceCategory)) generated.push("consequenceCategory");
  const consequenceRationale = nonEmpty(p.consequenceRationale) ?? (generated.push("consequenceRationale"), RCM_RATIONALE[cat]);

  return {
    description,
    acceptanceCriteria,
    loto,
    riskLevel: risk,
    riskAnalysisResult,
    consequenceCategory: cat,
    consequenceRationale,
    generated,
  };
}

const AVANCE_CIERRES = [
  "Equipo probado en funcionamiento, sin novedades.",
  "Se verifico el correcto funcionamiento tras la intervencion.",
  "Equipo operativo y entregado a servicio.",
  "Pruebas finales conformes, sin observaciones.",
];
const OBS_DETALLE = [
  "Sin anomalias detectadas",
  "No se requirieron repuestos adicionales",
  "Parametros dentro de lo esperado",
  "Tarea de rutina completada en tiempo",
];

function shortTitle(title: string): string {
  const t = title.trim().replace(/\.$/, "");
  return t.length > 80 ? t.slice(0, 77) + "..." : t;
}

/** Horas base: estimatedHours del plan si es valido, si no por nivel de riesgo. */
export function baseHours(p: PlanLike, risk: RiskLevel): number {
  const est = p.estimatedHours;
  if (typeof est === "number" && est > 0) return est;
  return risk === "HIGH" ? 6 : risk === "MEDIUM" ? 2 : 1;
}

/** Contenido de ejecucion para la ocurrencia `occ` (0-based). Determinista. */
export function buildExecutionContent(p: PlanLike, risk: RiskLevel, occ: number): ExecutionContent {
  const st = shortTitle(p.title);
  const cierre = AVANCE_CIERRES[occ % AVANCE_CIERRES.length];
  const detalle = OBS_DETALLE[occ % OBS_DETALLE.length];
  return {
    avance: `Se ejecuto "${st}" conforme al procedimiento. ${cierre}`,
    observations: `Trabajo completado satisfactoriamente conforme a procedimiento. ${detalle}.`,
    actualHours: baseHours(p, risk),
  };
}
