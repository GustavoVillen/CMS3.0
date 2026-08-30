// Encuentra, dentro del catálogo de equipos de un buque, el que representa las
// inspecciones de la sociedad de clasificación.
//
// El nombre NO es uniforme en la flota ni entre empresas: conviven
// "Inspeccion de Clase", "Inspecciones por Sociedad Clasificadora",
// "Inspeccion de Sociedad Clasificadora" y sus variantes en inglés. Buscar por
// nombre EXACTO dejaba el alta de OT sin equipo elegido en todos los buques que
// no usaran el nombre escrito a mano en el código, así que se busca por patrón.

/** Minúsculas y sin acentos, para comparar nombres cargados a mano. */
const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** Nombra a la sociedad de clasificación: no hay ambigüedad posible. */
const RE_SOCIETY = /clasificador|classificador|classification society/;
/** "Inspección / Survey ... de Clase" — el otro nombre habitual del mismo equipo. */
const RE_INSPECTION = /inspec|survey/;
const RE_CLASS = /\bclase\b|\bclasse\b|\bclass\b/;

/**
 * Devuelve el equipo de inspección de clase del buque, o `undefined` si el
 * catálogo no tiene uno dedicado (en ese caso el usuario lo elige a mano).
 */
export function findClassInspectionAsset<T extends { name: string }>(assets: T[]): T | undefined {
  const named = assets.map(a => ({ a, n: norm(a.name ?? "") }));
  return (
    named.find(x => RE_SOCIETY.test(x.n))?.a ??
    named.find(x => RE_INSPECTION.test(x.n) && RE_CLASS.test(x.n))?.a
  );
}
