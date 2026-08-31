// ¿La embarcación lleva dotación permanente a bordo?
//
// La respuesta cambia decisiones de negocio, no es un adorno: en una barcaza sin
// gente a bordo una falla no lastima a nadie en el momento (RCM), no corresponden
// simulacros ni STCW (compliance), y el mantenimiento se hace en visitas
// programadas al convoy entero, no buque por buque (apertura de OT en grupo).
//
// El dato canónico es `Vessel.isCrewed`. Es opcional porque los buques cargados
// antes de que existiera el campo no lo declaran; en esos casos se deduce del
// `vesselType`, que es TEXTO LIBRE. Por eso el match es por substring y no por
// igualdad: en Mercurio el tipo dice "Barcaza Tanque - Rake", "Barcaza Tanque -
// Box", "Remolcador"… Una comparación exacta contra "BARCAZA" daría falso en
// toda la flota real.
//
// Vive acá y no repetido en cada módulo: la heurística ya estaba escrita cuatro
// veces con criterios ligeramente distintos, y que dos pantallas discrepen sobre
// si un buque es barcaza es un bug esperando pasar.

export interface VesselCrewingFacts {
  vesselType: string | null;
  isCrewed?: boolean | null;
}

/** true = tripulada, false = sin dotación, null = no se puede afirmar. */
export function isCrewedVessel(v: VesselCrewingFacts): boolean | null {
  if (v.isCrewed !== null && v.isCrewed !== undefined) return v.isCrewed;
  const t = (v.vesselType ?? "").toLowerCase();
  if (t.includes("barcaza") || t.includes("barge")) return false;
  if (t.includes("remolcador") || t.includes("empuje") || t.includes("tug")) return true;
  return null;
}

/**
 * ¿Es una embarcación sin gente a bordo (barcaza)?
 *
 * `null` (no declarado y tipo que no dice nada) cuenta como NO: ante la duda no
 * se la trata como barcaza. Las funciones que dependen de esto —abrir una misma
 * OT para todo un convoy— asumen que las embarcaciones se atienden juntas, y
 * asumirlo de un buque cualquiera registraría trabajos que no se hicieron.
 */
export function isUncrewedVessel(v: VesselCrewingFacts): boolean {
  return isCrewedVessel(v) === false;
}
