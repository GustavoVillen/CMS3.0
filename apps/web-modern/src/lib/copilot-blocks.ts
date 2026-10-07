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
  let out: NumberedOption[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d{1,2})[.)]\s+(.+?)\s*$/);
    if (!m) continue;
    // Cada "1." arranca una lista nueva y vale sólo la última: si el mensaje
    // enumera datos (las OT) y después pregunta (Sí / No), los botones son la
    // pregunta. Antes salían las dos listas y había dos "1" y dos "2".
    if (m[1] === "1") out = [];
    // El botón muestra texto plano: los links quedan con su texto ([x](/ruta) → x).
    out.push({ n: m[1]!, label: m[2]!.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\(\s*\)/g, "").replace(/\*\*/g, "").trim() });
  }
  return out.length >= 2 ? out.slice(0, 30) : [];
}

/**
 * Extract the JSON payload from a [CAMPOS]{...}[/CAMPOS] block, or null if absent/invalid.
 *
 * Tolera lo que el modelo a veces manda mal: el JSON entre ``` , saltos de
 * línea reales dentro de un texto (un análisis de varios renglones) y valores
 * que no son texto (una lista de acciones se carga un renglón por ítem). Antes
 * cualquiera de esas cosas hacía que el bloque se descartara sin aviso.
 */
export function extractCamposBlock(text: string): Record<string, string> | null {
  // El servidor anula los datos del cierre de una OT que no está abierta y aprobada en pantalla.
  if (text.includes("[CAMPOS_ANULADO]")) return null;
  const match = text.match(/\[CAMPOS\]([\s\S]*?)\[\/CAMPOS\]/);
  if (!match) return null;
  const raw = match[1]!.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  for (const candidate of [raw, escapeLineBreaksInStrings(raw)]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (value == null) continue;
          // Los objetos de una lista (los repuestos {spareId, qty}) van como JSON, uno por renglón.
          out[key] = Array.isArray(value) ? value.map(v => (v && typeof v === "object" ? JSON.stringify(v) : String(v))).join("\n")
            : typeof value === "object" ? JSON.stringify(value)
            : String(value);
        }
        return out;
      }
    } catch { /* se prueba la siguiente forma */ }
  }
  return null;
}

/** Escapa los saltos de línea y tabs que quedaron crudos dentro de los textos del JSON. */
function escapeLineBreaksInStrings(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (!inString) {
      if (ch === "\"") inString = true;
      out += ch;
      continue;
    }
    if (escaped) { escaped = false; out += ch; continue; }
    if (ch === "\\") { escaped = true; out += ch; continue; }
    if (ch === "\"") { inString = false; out += ch; continue; }
    if (ch === "\n") { out += "\\n"; continue; }
    if (ch === "\r") continue;
    if (ch === "\t") { out += "\\t"; continue; }
    out += ch;
  }
  return out;
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
 * OT que la IA abre para completarla desde un parte de a bordo:
 * [COMPLETAR]OT-M01-26-0123[/COMPLETAR]. El panel la abre y, cuando ya está en
 * pantalla, le avisa a la IA para que cargue el cierre. Sólo se acepta un
 * código (letras, números y guiones): nada de rutas ni direcciones.
 */
export function extractCompleteWoBlock(text: string): string | null {
  // El servidor lo anula si la OT no está abierta y aprobada (copiloto-service).
  if (text.includes("[COMPLETAR_ANULADO]")) return null;
  const match = text.match(/\[COMPLETAR\]([\s\S]*?)\[\/COMPLETAR\]/);
  if (!match) return null;
  const code = match[1]!.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{2,40}$/.test(code) ? code : null;
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
    .replace(/\[COMPLETAR\][\s\S]*?\[\/COMPLETAR\]/g, "")
    .replace(/\[(?:CAMPOS|RECALCULAR|ABRIR|COMPLETAR)\][\s\S]*$/, "")
    // Avisos internos del panel a la IA: si el modelo los repite, no se muestran.
    .replace(/\[(?:SIGUIENTE PASO|AYUDAR|CAMBIO EN PANTALLA|COMPLETAR OT|COMPLETAR_ANULADO|CAMPOS_ANULADO)\]/g, "")
    .trim();
}
