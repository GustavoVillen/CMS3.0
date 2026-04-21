/**
 * Formatted date utility for standardizing date display across the platform.
 * Returns a string in 'DD/MM/YYYY' format or '—' if null/undefined.
 */
export function fmtDate(d?: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

/**
 * Repository-wide rule for filter dropdowns:
 * never use <option value=""> directly in native <select>.
 */
export const FILTER_ALL_VALUE = "__ALL__";

export function toFilterSelectValue(value?: string | null): string {
  const normalized = (value ?? "").trim();
  return normalized || FILTER_ALL_VALUE;
}

export function fromFilterSelectValue(value: string): string {
  return value === FILTER_ALL_VALUE ? "" : value;
}
