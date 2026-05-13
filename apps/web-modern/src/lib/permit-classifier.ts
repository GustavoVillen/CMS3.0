/**
 * Clasificador heurístico de tipo de PTW a partir del texto de una OT.
 *
 * Para cada PermitType, define una lista de keywords típicos del trabajo.
 * El clasificador escanea título + descripción de la OT y devuelve los tipos
 * de PTW que probablemente apliquen. Es advisory — no reemplaza el criterio
 * del operador, sólo le sugiere al guardar.
 *
 * Decisión de diseño: heurística simple (no IA) porque:
 *   - es predecible y debuggable
 *   - cero latencia y cero costo
 *   - los falsos positivos son baratos (banner ignorable)
 *   - los falsos negativos los corrige el operador a mano
 *
 * Si más adelante queremos clasificación más precisa, se puede sumar IA como
 * fallback: usar heurística para casos obvios, IA cuando ningún keyword matchea
 * pero el texto sugiere riesgo (ej. "trabajo en tanque #3").
 */

export type PermitType = "HOT_WORK" | "ENCLOSED_SPACE_ENTRY" | "WORKING_ALOFT" | "ELECTRICAL_ISOLATION";

export interface PermitMatch {
  type: PermitType;
  matchedKeywords: string[];
}

const KEYWORDS: Record<PermitType, string[]> = {
  HOT_WORK: [
    "soldadura", "soldar", "soldado", "soldando",
    "oxicorte", "oxiacetileno", "oxiacetilénico",
    "esmerilado", "esmerilar", "amolar", "amolado",
    "llama abierta", "soplete", "brazing",
    "corte con disco", "disco de corte", "disco abrasivo",
    "rectificado", "calentamiento con llama",
    "torcha", "antorcha",
  ],
  ENCLOSED_SPACE_ENTRY: [
    "tanque", "tanques",
    "sentina", "sentinas",
    "void", "void space",
    "pañol cerrado",
    "doble fondo",
    "cofferdam",
    "bodega cerrada",
    "slop tank",
    "ballast tank",
    "fuel tank",
    "espacio confinado", "espacios confinados",
    "cisterna",
    "ducto cerrado",
    "entrada en", // catches "entrada en void", "entrada en tanque"
  ],
  WORKING_ALOFT: [
    "altura",
    "mástil",
    "antena",
    "exterior de casco", "exterior del casco",
    "escalera de gato",
    "sobre el agua",
    "izado de personal",
    "gantry",
    "plataforma elevada",
    "trabajo en altura",
    "aloft",
    "outboard",
  ],
  ELECTRICAL_ISOLATION: [
    "cuadro eléctrico", "cuadro electrico",
    "panel eléctrico", "panel electrico",
    "breaker", "interruptor automático",
    "seccionador",
    "transformador",
    "alternador",
    "capacitor", "condensador",
    "alta tensión", "alta tension",
    "media tensión", "media tension",
    "440v", "440 v",
    "6.6kv", "6.6 kv",
    "energizado", "energizada",
    "loto", "lock-out", "lockout",
    "aislamiento eléctrico", "aislamiento electrico",
  ],
};

export function suggestPermitTypesFromText(rawText: string): PermitMatch[] {
  const haystack = (rawText ?? "").toLowerCase();
  if (!haystack.trim()) return [];

  const matches: PermitMatch[] = [];
  for (const [type, kws] of Object.entries(KEYWORDS) as Array<[PermitType, string[]]>) {
    const matched = kws.filter(k => haystack.includes(k));
    if (matched.length > 0) {
      matches.push({ type, matchedKeywords: matched });
    }
  }
  return matches;
}

export const PERMIT_TYPE_LABEL: Record<PermitType, string> = {
  HOT_WORK: "Trabajo en caliente",
  ENCLOSED_SPACE_ENTRY: "Espacio confinado",
  WORKING_ALOFT: "Trabajo en altura",
  ELECTRICAL_ISOLATION: "Aislamiento eléctrico",
};
