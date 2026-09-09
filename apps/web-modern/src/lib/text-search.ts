// Comparación de texto para los buscadores de pantalla.
//
// La gente escribe sin acentos: pone "linea" y el equipo se llama "Línea de eje
// Babor". Antes no lo encontraba, porque el filtro comparaba los caracteres tal
// cual. Acá los dos lados —lo tipeado y el dato— pasan por la misma
// normalización, así que también funciona al revés: buscar "línea" encuentra un
// "Linea" cargado sin acento.
//
// Qué se ignora al comparar: mayúsculas y TODOS los signos sobre las letras
// (tildes, diéresis y también la ñ, que se compara como n). Es el mismo criterio
// que usa Postgres con `unaccent`, para que el día que la búsqueda se haga en la
// base el resultado sea el mismo. En la práctica ayuda más de lo que molesta:
// "canieria" encuentra "cañería" y "pinon" encuentra "piñón".
//
// Ojo: esto NO es para guardar ni para comparar códigos por igualdad — es sólo
// para buscar. Normalizar un dato antes de guardarlo le sacaría los acentos de
// verdad.

/** Texto listo para comparar: sin acentos y en minúsculas. */
export function normText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * ¿`haystack` contiene lo buscado, ignorando acentos y mayúsculas?
 *
 * Con búsqueda vacía devuelve `true`: "sin filtro" es "entran todos", que es lo
 * que espera cualquier `.filter()` cuando el buscador está en blanco.
 */
export function textMatches(
  haystack: string | null | undefined,
  query: string | null | undefined,
): boolean {
  const q = normText(query);
  if (!q) return true;
  return normText(haystack).includes(q);
}
