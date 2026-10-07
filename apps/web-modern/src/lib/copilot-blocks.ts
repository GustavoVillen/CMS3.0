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

/** Dónde está un bloque [CAMPOS] en el texto y su JSON (null si todavía no llegó entero o vino cortado). */
interface CamposSpan { start: number; end: number; json: string | null }

const CAMPOS_OPEN = "[CAMPOS]";
const CAMPOS_CLOSE = "[/CAMPOS]";

/**
 * Bloques [CAMPOS] del texto. El final se busca contando llaves, no confiando
 * en la etiqueta de cierre: Gemini a veces la omite o deja un corchete de más
 * antes ("...}]}][/CAMPOS]"), y el bloque entero se perdía (OT-M02-26-0472:
 * los repuestos no entraron y el resto de la respuesta quedó oculto). El
 * servidor lo lee con la misma regla (copilot-fields-block.ts), para poder
 * anular lo que el panel cargaría.
 */
function locateCamposBlocks(text: string): CamposSpan[] {
  const out: CamposSpan[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(CAMPOS_OPEN, from);
    if (start < 0) return out;
    let i = start + CAMPOS_OPEN.length;
    i += /^\s*(?:```(?:json)?\s*)?/i.exec(text.slice(i))![0].length;
    const jsonEnd = text[i] === "{" ? closingBraceEnd(text, i) : -1;
    if (jsonEnd < 0) {
      // JSON a medio llegar (el chat streamea) o cortado: hasta el cierre, si lo hay.
      const close = text.indexOf(CAMPOS_CLOSE, i);
      const end = close >= 0 ? close + CAMPOS_CLOSE.length : text.length;
      out.push({ start, end, json: null });
      from = end;
      continue;
    }
    // Lo que sobra entre el JSON y el cierre (corchetes, llaves, ```) va con el bloque.
    const tail = /^[\s\]}`]*\[\/CAMPOS\]/.exec(text.slice(jsonEnd)) ?? /^\s*```/.exec(text.slice(jsonEnd));
    const end = jsonEnd + (tail ? tail[0].length : 0);
    out.push({ start, end, json: text.slice(i, jsonEnd) });
    from = end;
  }
}

/** Posición justo después de la llave que cierra el objeto que abre en `open`; -1 si no cierra. */
function closingBraceEnd(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/** El texto sin los bloques [CAMPOS] (también el que está a medio llegar). */
export function removeCamposBlocks(text: string): string {
  let out = "";
  let last = 0;
  for (const b of locateCamposBlocks(text)) {
    out += text.slice(last, b.start);
    last = b.end;
  }
  return (out + text.slice(last)).replace(/\[\/CAMPOS\]/g, "");
}

/**
 * Extract the JSON payload from a [CAMPOS]{...}[/CAMPOS] block, or null if absent/invalid.
 *
 * Tolera lo que el modelo a veces manda mal: el JSON entre ``` , el cierre
 * ausente o con un corchete de más, saltos de línea reales dentro de un texto
 * (un análisis de varios renglones) y valores que no son texto (una lista de
 * acciones se carga un renglón por ítem). Antes cualquiera de esas cosas hacía
 * que el bloque se descartara.
 */
export function extractCamposBlock(text: string): Record<string, string> | null {
  // El servidor anula los datos del cierre de una OT que no está abierta y aprobada en pantalla.
  if (text.includes("[CAMPOS_ANULADO]")) return null;
  const raw = locateCamposBlocks(text)[0]?.json;
  if (!raw) return null;
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
  return removeCamposBlocks(text)
    .replace(/\[RECALCULAR\][\s\S]*?\[\/RECALCULAR\]/g, "")
    .replace(/\[ABRIR\][\s\S]*?\[\/ABRIR\]/g, "")
    .replace(/\[COMPLETAR\][\s\S]*?\[\/COMPLETAR\]/g, "")
    .replace(/\[(?:RECALCULAR|ABRIR|COMPLETAR)\][\s\S]*$/, "")
    // Avisos internos del panel a la IA: si el modelo los repite, no se muestran.
    .replace(/\[(?:SIGUIENTE PASO|AYUDAR|CAMBIO EN PANTALLA|COMPLETAR OT|COMPLETAR_ANULADO|CAMPOS_ANULADO)\]/g, "")
    .trim();
}
