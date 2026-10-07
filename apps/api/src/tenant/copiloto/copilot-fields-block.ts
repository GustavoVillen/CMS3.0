/**
 * Lectura del bloque [CAMPOS] que manda el modelo.
 *
 * El final del bloque se busca contando llaves, no confiando en la etiqueta de
 * cierre: Gemini a veces la omite o deja un corchete de más antes
 * ("...}]}][/CAMPOS]"). Con la lectura estricta el bloque se perdía entero
 * (OT-M02-26-0472: los repuestos no entraron y el detector preguntó por los
 * mismos que el modelo ya había elegido).
 *
 * El panel lo lee con la misma regla (apps/web-modern/src/lib/copilot-blocks.ts):
 * lo que el panel carga, el servidor lo tiene que ver para poder anularlo.
 */

/** Un bloque [CAMPOS]: su JSON crudo (null si vino cortado) y los campos ya leídos (null si no se pudo). */
export interface CamposBlock {
  json: string | null;
  fields: Record<string, unknown> | null;
}

const OPEN = "[CAMPOS]";
const CLOSE = "[/CAMPOS]";

export function readCamposBlocks(text: string): CamposBlock[] {
  const out: CamposBlock[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(OPEN, from);
    if (start < 0) return out;
    let i = start + OPEN.length;
    i += /^\s*(?:```(?:json)?\s*)?/i.exec(text.slice(i))![0].length;
    const jsonEnd = text[i] === "{" ? closingBraceEnd(text, i) : -1;
    if (jsonEnd < 0) {
      const close = text.indexOf(CLOSE, i);
      out.push({ json: null, fields: null });
      from = close >= 0 ? close + CLOSE.length : text.length;
      continue;
    }
    const json = text.slice(i, jsonEnd);
    out.push({ json, fields: parseJsonObject(json) });
    from = jsonEnd;
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

function parseJsonObject(json: string): Record<string, unknown> | null {
  for (const candidate of [json, escapeControlCharsInJsonStrings(json)]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* se prueba la siguiente forma */ }
  }
  return null;
}

/**
 * Escapa saltos de línea y tabulaciones que aparecen DENTRO de un texto entre
 * comillas de un JSON; los de afuera (formato) quedan como están.
 */
export function escapeControlCharsInJsonStrings(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (inString) {
      if (escaped) { escaped = false; out += ch; continue; }
      if (ch === "\\") { escaped = true; out += ch; continue; }
      if (ch === "\"") { inString = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
      continue;
    }
    if (ch === "\"") inString = true;
    out += ch;
  }
  return out;
}
