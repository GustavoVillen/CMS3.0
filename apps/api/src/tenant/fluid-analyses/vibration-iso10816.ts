// ISO 10816-3 — evaluación de vibraciones en maquinaria rotativa.
//
// La norma define 4 clases de máquinas según potencia y rigidez del montaje,
// y para cada una 4 zonas A/B/C/D de niveles de vibración velocity RMS (mm/s):
//
//   - Zona A (Good):           equipo nuevo, sin problemas.
//   - Zona B (Acceptable):     operación sin restricciones.
//   - Zona C (Unsatisfactory): operable limitado; corregir pronto.
//   - Zona D (Unacceptable):   riesgo de daño inmediato; parar / reducir carga.
//
// Las clases son orientativas. El user (mantenedor) elige la clase del equipo
// al cargar la muestra; en futuras versiones puede vivir en `Asset.iso10816Class`.

export type IsoClass = "I" | "II" | "III" | "IV";
export type IsoZone  = "A" | "B" | "C" | "D";

interface Thresholds {
  // Límite superior de cada zona en mm/s RMS (velocity).
  // Zona D = todo lo que excede maxC.
  maxA: number;
  maxB: number;
  maxC: number;
}

const TABLE: Record<IsoClass, Thresholds> = {
  // Class I — máquinas chicas (≤ 15 kW): motores, bombas chicas.
  I:   { maxA: 0.71, maxB: 1.8,  maxC: 4.5  },
  // Class II — máquinas medianas (15–75 kW), o ≤ 300 kW con fundación rígida.
  II:  { maxA: 1.12, maxB: 2.8,  maxC: 7.1  },
  // Class III — máquinas grandes con fundación rígida.
  III: { maxA: 1.8,  maxB: 4.5,  maxC: 11.2 },
  // Class IV — máquinas grandes con fundación flexible.
  IV:  { maxA: 2.8,  maxB: 7.1,  maxC: 18.0 },
};

/** Devuelve la zona ISO 10816-3 para una clase y un velocity RMS (mm/s). */
export function zoneFor(klass: IsoClass, velocityRms: number): IsoZone {
  const t = TABLE[klass];
  if (velocityRms <= t.maxA) return "A";
  if (velocityRms <= t.maxB) return "B";
  if (velocityRms <= t.maxC) return "C";
  return "D";
}

/** Mapeo a `FluidVerdict` para reusar el mismo modelo de resultado. */
export function verdictForZone(zone: IsoZone): "NORMAL" | "CAUTION" | "CRITICAL" | "ACTION_REQUIRED" {
  switch (zone) {
    case "A": return "NORMAL";
    case "B": return "NORMAL";
    case "C": return "CAUTION";
    case "D": return "ACTION_REQUIRED";
  }
}

/** Resumen humano para la UI / PDF / context de la IA. */
export function describeZone(zone: IsoZone): string {
  switch (zone) {
    case "A": return "A — Bueno (equipo nuevo, sin problemas)";
    case "B": return "B — Aceptable (operación sin restricciones)";
    case "C": return "C — Insatisfactorio (operable limitado, corregir pronto)";
    case "D": return "D — Inaceptable (riesgo de daño, parar o reducir carga)";
  }
}

export function thresholdsFor(klass: IsoClass): Thresholds {
  return TABLE[klass];
}
