/**
 * Limpieza de la salida de texto de la IA antes de guardarla o mostrarla.
 *
 * Los prompts del PMS describen el formato esperado con ejemplos entre
 * corchetes ("- [peligro principal → control clave]"). Los modelos copian esos
 * corchetes con bastante frecuencia — Gemini más que Claude — y el texto termina
 * en la pantalla del plan y en el PDF de la OT con los corchetes puestos, o con
 * una línea suelta que dice literalmente "[criterios de aceptación]".
 *
 * Los prompts ya no usan corchetes para describir el formato, pero eso solo
 * baja la frecuencia: no la elimina, y no arregla lo ya generado. Esta función
 * es la red de seguridad, y se aplica a TODA salida de texto libre de la IA.
 *
 * No toca los corchetes que aparecen DENTRO de una línea con contenido real
 * ("- Presión 45-65 PSI [ver manual Cummins]"): ahí son del autor, no del molde.
 */

/** Línea suelta que es solo el nombre de una sección del molde: "[criterios de aceptación]". */
const MARKER_LINE = /^\s*\[[^\][]*\]\s*$/;

/** Bullet sin contenido, el "y seguí igual" del molde: "- [...]", "• [ … ]", "- []". */
const EMPTY_BULLET = /^\s*(?:[-*•]|\d+[.)])\s*\[\s*(?:\.{2,}|…)?\s*\]\s*$/;

/** Bullet con contenido real pero envuelto: "- [texto]" -> "- texto". */
const WRAPPED_BULLET = /^(\s*(?:[-*•]|\d+[.)])\s*)\[([^\][]+)\]\s*$/;

export function cleanAiText(text: string): string {
  return text
    .split("\n")
    .filter(line => !MARKER_LINE.test(line) && !EMPTY_BULLET.test(line))
    .map(line => line.replace(WRAPPED_BULLET, "$1$2"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
