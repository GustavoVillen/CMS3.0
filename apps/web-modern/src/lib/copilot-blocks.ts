// Lo que el copiloto manda además del texto: opciones numeradas y bloques de
// máquina ([CAMPOS], [RECALCULAR], [ABRIR]).
//
// Vive acá y no dentro del panel de escritorio porque hay dos pantallas que lo
// leen: el CopilotoPanel de la PC y el agente de voz del celular. Una sola
// regla — si cambia el formato, cambia en un solo lugar.

/** Una opción numerada de la respuesta, ya lista para pintar como botón. */
export interface NumberedOption { n: string; label: string }

/**
 * Opciones numeradas de una respuesta del copiloto ("1. Mantenimiento", "2)
 * Reparación"): se muestran como botones para que el usuario toque en vez de
 * escribir el número. Hacen falta al menos dos para que sea una elección.
 */
export function extractNumberedOptions(text: string): NumberedOption[] {
  const out: NumberedOption[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d{1,2})[.)]\s+(.+?)\s*$/);
    if (m) out.push({ n: m[1]!, label: m[2]!.replace(/\*\*/g, "") });
  }
  return out.length >= 2 ? out.slice(0, 30) : [];
}

/** Extract the JSON payload from a [CAMPOS]{...}[/CAMPOS] block, or null if absent/invalid. */
export function extractCamposBlock(text: string): Record<string, string> | null {
  const match = text.match(/\[CAMPOS\]([\s\S]*?)\[\/CAMPOS\]/);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[1]!.trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch { /* invalid JSON */ }
  return null;
}

/**
 * Asistentes del formulario que la IA pide correr:
 * [RECALCULAR]["acceptanceCriteria","loto","risk"][/RECALCULAR].
 */
export function extractRecalcBlock(text: string): string[] | null {
  const match = text.match(/\[RECALCULAR\]([\s\S]*?)\[\/RECALCULAR\]/);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[1]!.trim());
    if (Array.isArray(parsed)) {
      const names = parsed.filter((v): v is string => typeof v === "string");
      return names.length > 0 ? names : null;
    }
  } catch { /* invalid JSON */ }
  return null;
}

/**
 * Pantalla que la IA pide abrir: [ABRIR]/asset-hours[/ABRIR].
 *
 * Es sólo navegación, así que no pide confirmación: abrir una pantalla no
 * cambia ningún dato. Se acepta únicamente una ruta interna (empieza con "/" y
 * sin "//"): con esto el modelo no puede mandar al usuario a un sitio de afuera.
 */
export function extractOpenScreenBlock(text: string): string | null {
  const match = text.match(/\[ABRIR\]([\s\S]*?)\[\/ABRIR\]/);
  if (!match) return null;
  const path = match[1]!.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

/**
 * Texto que se ve en el globo del chat: sin los bloques de máquina.
 * También corta un bloque a medio llegar (el chat streamea de a pedazos), para
 * que el usuario no vea el marcador crudo por un instante.
 */
export function stripAiBlocks(text: string): string {
  return text
    .replace(/\[CAMPOS\][\s\S]*?\[\/CAMPOS\]/g, "")
    .replace(/\[RECALCULAR\][\s\S]*?\[\/RECALCULAR\]/g, "")
    .replace(/\[ABRIR\][\s\S]*?\[\/ABRIR\]/g, "")
    .replace(/\[(?:CAMPOS|RECALCULAR|ABRIR)\][\s\S]*$/, "")
    // Avisos internos del panel a la IA: si el modelo los repite, no se muestran.
    .replace(/\[(?:SIGUIENTE PASO|AYUDAR|CAMBIO EN PANTALLA)\]/g, "")
    .trim();
}
