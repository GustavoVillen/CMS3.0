/**
 * Formatted date utility for standardizing date display across the platform.
 * Returns a string in 'DD/MM/YYYY' format or '—' if null/undefined.
 */
export function fmtDate(d?: string | null) {
  if (!d) return "—";
  try {
    // Date-only strings (YYYY-MM-DD) must NOT go through Date() — UTC parsing shifts the day.
    // Parse them directly to avoid timezone-induced off-by-one.
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (dateOnly) {
      const [y, m, day] = d.split("-");
      return `${day}/${m}/${y}`;
    }
    // Prisma @db.Date fields serialize as ISO at UTC midnight (e.g. "2026-04-23T00:00:00.000Z").
    // They carry no time component, so converting them to a local timezone would shift the day
    // (in Argentina, midnight UTC = 21:00 the previous day). Treat them as date-only instead.
    const utcMidnight = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?Z$/.exec(d);
    if (utcMidnight) {
      return `${utcMidnight[3]}/${utcMidnight[2]}/${utcMidnight[1]}`;
    }
    return new Date(d).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "America/Argentina/Buenos_Aires",
    });
  } catch {
    return "—";
  }
}

/**
 * Parse a date-only string as LOCAL midnight, not UTC midnight.
 *
 * `new Date("2026-04-28")` is parsed as UTC 00:00 — in UTC-3 that's 21:00 the
 * previous day, which makes date comparisons wrong by one day.
 * Always use this function when comparing a date-only field against today.
 */
export function parseLocalDate(d: string): Date {
  // "YYYY-MM-DD" → local midnight
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (dateOnly) return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]);
  // Prisma @db.Date serialized as UTC midnight ("...T00:00:00.000Z") — use only the date part
  const utcMidnight = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?Z$/.exec(d);
  if (utcMidnight) return new Date(+utcMidnight[1], +utcMidnight[2] - 1, +utcMidnight[3]);
  return new Date(d);
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
