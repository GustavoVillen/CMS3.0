// Department classification used by the spare-inventory PDF (formato Mercurio REGI-MAN-04.1).
// CUBIERTA / MAQUINAS / COCINA / BARCAZA come from the printed form's checkboxes.
//
// The mapping derives the department from the spare's SFI code (or its linked asset's SFI
// code as fallback). BARCAZA is special: it is only used when the vessel itself is of type
// "BARCAZA" — in that case ALL departments roll up to BARCAZA in the report header.

export type Department = "CUBIERTA" | "MAQUINAS" | "COCINA" | "BARCAZA";

/**
 * Maps an SFI group prefix (first digit of the numeric code, e.g. "200" → "2") to a department.
 *
 *  100-199  Hull / superstructure / deck         → CUBIERTA
 *  200-499  Propulsion / aux machinery / power   → MAQUINAS
 *  500-599  Automation / control                 → MAQUINAS
 *  600-699  Outfitting (accommodation)           → COCINA
 *  700-799  Galley / accommodation               → COCINA
 *  800-899  Ship common (fluids, ventilation)    → MAQUINAS
 */
const DEPARTMENT_BY_SFI_PREFIX: Record<string, Department> = {
  "1": "CUBIERTA",
  "2": "MAQUINAS",
  "3": "MAQUINAS",
  "4": "MAQUINAS",
  "5": "MAQUINAS",
  "6": "COCINA",
  "7": "COCINA",
  "8": "MAQUINAS",
};

export function departmentFromSfi(sfiCode: string | null | undefined): Department | null {
  if (!sfiCode) return null;
  const digits = String(sfiCode).replace(/\D/g, "");
  if (!digits) return null;
  return DEPARTMENT_BY_SFI_PREFIX[digits[0]] ?? null;
}

/**
 * Resolves the department for a spare given its own SFI code, the SFI of its linked
 * asset (fallback), and the vessel type. If the vessel is a BARCAZA the report
 * header always shows BARCAZA — but we still keep the per-row department for
 * filtering, since a BARCAZA still has cubierta/máquinas/cocina internally.
 */
export function resolveSpareDepartment(
  spareSfi: string | null | undefined,
  assetSfi: string | null | undefined,
): Department | null {
  return departmentFromSfi(spareSfi) ?? departmentFromSfi(assetSfi) ?? null;
}

export function isBarcaza(vesselType: string | null | undefined): boolean {
  return String(vesselType ?? "").toUpperCase().trim() === "BARCAZA";
}
