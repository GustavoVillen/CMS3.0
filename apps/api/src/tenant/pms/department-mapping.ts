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
 * Grupos tal como están en la tabla SfiNode (SFI estándar):
 *  100-199  Casco general                          → CUBIERTA
 *  200-399  Equipo / manipulación de carga         → MAQUINAS (en las barcazas lo
 *           atiende máquinas: bombas de carga y su motor; ahí están sus aceites/filtros)
 *  400-499  Equipo de barco (fondeo, amarre, nav.) → CUBIERTA
 *  500-599  Alojamiento                            → COCINA
 *  600-699  Componentes principales de maquinaria  → MAQUINAS
 *  700-799  Sistemas de maquinaria                 → MAQUINAS
 *  800-899  Sistemas eléctricos                    → MAQUINAS
 *
 * Antes 600/700 caían en COCINA y 500 en MAQUINAS: los motores y generadores
 * salían en el inventario de cocina.
 */
const DEPARTMENT_BY_SFI_PREFIX: Record<string, Department> = {
  "1": "CUBIERTA",
  "2": "MAQUINAS",
  "3": "MAQUINAS",
  "4": "CUBIERTA",
  "5": "COCINA",
  "6": "MAQUINAS",
  "7": "MAQUINAS",
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

// El tipo real viene como "Barcaza Tanque - Rake" / "Barcaza Tanque - Box".
export function isBarcaza(vesselType: string | null | undefined): boolean {
  return String(vesselType ?? "").toUpperCase().trim().startsWith("BARCAZA");
}

// ─── Clasificación por categoría (texto libre en Spare.category) ────────────
// La categoría se escribe a mano ("Filtro", "Filtros", "Lubricantes"…), así que
// se compara sin acentos, sin mayúsculas y por prefijo.

export type SpareKind = "TOOL" | "ARTICLE" | "FILTER_LUBE" | "SPARE";

function normalizeCategory(category: string | null | undefined): string {
  return String(category ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function spareKindFromCategory(category: string | null | undefined): SpareKind {
  const c = normalizeCategory(category);
  if (c.startsWith("herramienta")) return "TOOL";
  if (c.startsWith("articulo") || c.startsWith("consumible")) return "ARTICLE";
  if (c.startsWith("filtro") || c.startsWith("lubricante") || c.startsWith("refrigerante")) return "FILTER_LUBE";
  return "SPARE";
}

/**
 * Los repuestos cargados desde planilla traen el equipo en el nombre
 * ("Filtro de aire para electrocompresor CETEC NK"). Separa las dos partes
 * para las columnas "Repuesto" / "Para qué" cuando no hay equipo vinculado.
 */
export function splitNameForEquipment(name: string): { item: string; equipment: string | null } {
  const m = name.match(/^(.+?)\s+para\s+(.+)$/i);
  if (!m) return { item: name, equipment: null };
  return { item: m[1]!.trim(), equipment: m[2]!.trim() };
}
