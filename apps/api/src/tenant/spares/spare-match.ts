// Empareja una línea de remito ("2 filtros de comb. GEN 1") contra los repuestos
// que YA existen en el buque. Determinístico, sin IA: normaliza el texto, expande
// las abreviaturas que se usan a bordo y compara por tokens.
//
// Es la primera línea de defensa contra el duplicado que motivó todo esto:
// "Filtro de combustible generador" y "Filtro de combustible GEN" son el mismo
// repuesto y tienen que caer en la misma ficha. Nunca decide sola el alta de un
// repuesto nuevo — devuelve candidatos con score y el llamador (y al final el
// usuario) confirma.
//
// Mismo criterio de scoring que ai/asset-fuzzy-match.ts (Jaccard de tokens),
// extendido con part numbers, que son la clave fuerte.

export interface SpareCandidate {
  id: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  longDescription?: string | null;
  internalPartNumber?: string | null;
  manufacturerPartNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
}

export interface SpareMatchResult {
  /** Mejor candidato, si alcanzó el umbral de "dudoso". */
  best: { candidate: SpareCandidate; score: number; reason: MatchReason } | null;
  /** Hasta 5 candidatos ordenados por score, para que el usuario elija. */
  candidates: Array<{ candidate: SpareCandidate; score: number }>;
  /** matched = alto; ambiguous = hay que confirmar; none = probablemente nuevo. */
  status: "matched" | "ambiguous" | "none";
}

export type MatchReason = "PART_NUMBER" | "TEXT";

/** ≥ este score el emparejamiento se da por bueno y viene preseleccionado. */
export const MATCH_THRESHOLD = 0.6;
/** Entre AMBIGUOUS y MATCH se muestran candidatos y el usuario decide. */
export const AMBIGUOUS_THRESHOLD = 0.35;

// Abreviaturas de a bordo. La clave es lo que se escribe en el remito, el valor
// lo que suele estar en el catálogo. Se expande en los DOS textos antes de
// comparar, así da igual de qué lado esté la abreviatura.
const SYNONYMS: Record<string, string> = {
  gen: "generador",
  ge: "generador",
  gens: "generador",
  mp: "motor principal",
  me: "motor principal",
  mmpp: "motor principal",
  aux: "auxiliar",
  comb: "combustible",
  combust: "combustible",
  fuel: "combustible",
  filt: "filtro",
  filtr: "filtro",
  oil: "aceite",
  lub: "lubricante",
  hidr: "hidraulico",
  hyd: "hidraulico",
  hidraulica: "hidraulico",
  refrig: "refrigerante",
  ref: "refrigerante",
  br: "babor",
  port: "babor",
  er: "estribor",
  stbd: "estribor",
  sb: "estribor",
  bba: "bomba",
  bbas: "bomba",
  pump: "bomba",
  emerg: "emergencia",
  princ: "principal",
  sec: "secundario",
  cil: "cilindro",
  temp: "temperatura",
  pres: "presion",
  elec: "electrico",
  electrica: "electrico",
  jgo: "juego",
  jto: "junta",
  emp: "empaquetadura",
  rod: "rodamiento",
  reten: "reten",
  valv: "valvula",
  vlv: "valvula",
  man: "manguera",
  cart: "cartucho",
  sep: "separador",
  purif: "purificador",
  turbo: "turbocompresor",
  inyec: "inyector",
  arranq: "arranque",
  bat: "bateria",
  correa: "correa",
  faja: "correa",
};

/** Palabras que no aportan a la comparación (aparecen en casi todas las líneas). */
const STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "para", "con", "y", "o", "a", "en",
  "un", "una", "unidad", "unidades", "pza", "pzas", "u", "uds", "nro", "no",
  "num", "numero", "ref", "referencia", "marca", "tipo", "cod", "codigo",
]);

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Part number comparable: sin guiones, puntos ni espacios. */
export function normalizePartNumber(value: string | null | undefined): string {
  if (!value) return "";
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokenize(value: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normalizeText(value).split(" ")) {
    if (!raw || STOPWORDS.has(raw)) continue;
    const expanded = SYNONYMS[raw];
    if (expanded) {
      for (const t of expanded.split(" ")) out.add(t);
    } else {
      out.add(raw);
    }
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Score de una línea de remito contra un repuesto del catálogo.
 * Combina el parecido con el nombre (lo que más pesa) y con la descripción
 * larga, y se queda con el mejor de los dos: la descripción suele ser más
 * larga que la línea del remito y castiga el Jaccard sin motivo.
 */
function textScore(lineTokens: Set<string>, candidate: SpareCandidate): number {
  const nameScore = jaccard(lineTokens, tokenize(`${candidate.name} ${candidate.manufacturer ?? ""} ${candidate.model ?? ""}`));
  const descScore = candidate.longDescription
    ? jaccard(lineTokens, tokenize(candidate.longDescription)) * 0.8
    : 0;
  const skuScore = jaccard(lineTokens, tokenize(candidate.sku)) * 0.7;
  return Math.max(nameScore, descScore, skuScore);
}

export interface MatchInput {
  /** Texto de la línea del remito (descripción del ítem). */
  description: string;
  /** Part number leído del remito, si el remito lo trae. */
  partNumber?: string | null;
}

export function matchSpare(input: MatchInput, catalog: SpareCandidate[]): SpareMatchResult {
  const pn = normalizePartNumber(input.partNumber);

  // 1) Part number exacto: es el mismo repuesto, sin preguntar.
  if (pn.length >= 3) {
    const exact = catalog.find(c =>
      normalizePartNumber(c.internalPartNumber) === pn ||
      normalizePartNumber(c.manufacturerPartNumber) === pn ||
      normalizePartNumber(c.sku) === pn,
    );
    if (exact) {
      return {
        best: { candidate: exact, score: 1, reason: "PART_NUMBER" },
        candidates: [{ candidate: exact, score: 1 }],
        status: "matched",
      };
    }
  }

  // 2) Parecido de texto. El part number del remito, si lo hay, entra como un
  //    token más: muchas veces el catálogo lo tiene metido en el nombre.
  const lineTokens = tokenize(`${input.description} ${input.partNumber ?? ""}`);
  const scored = catalog
    .map(candidate => ({ candidate, score: textScore(lineTokens, candidate) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const top = scored[0];
  if (!top) return { best: null, candidates: [], status: "none" };
  if (top.score >= MATCH_THRESHOLD) {
    return { best: { candidate: top.candidate, score: top.score, reason: "TEXT" }, candidates: scored, status: "matched" };
  }
  if (top.score >= AMBIGUOUS_THRESHOLD) {
    return { best: { candidate: top.candidate, score: top.score, reason: "TEXT" }, candidates: scored, status: "ambiguous" };
  }
  // Aun sin llegar al umbral se devuelven los candidatos: la pantalla los
  // muestra bajo "¿no es alguno de estos?" antes de dejar crear uno nuevo.
  return { best: null, candidates: scored, status: "none" };
}
