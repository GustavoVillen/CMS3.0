// Regla del producto: toda fecha que lee una persona sale DD/MM/AAAA, y con
// hora, DD/MM/AAAA HH:MM (24 h). Nada de "21 oct", "21/10" sin año ni el
// formato del navegador. Pasar siempre por fmtDate / fmtDateTime.

const DISPLAY_TZ = "America/Argentina/Buenos_Aires";

/** Fecha sola (DD/MM/AAAA) si el texto es una fecha de calendario, si no null. */
function calendarDay(d: string): string | null {
  // Date-only strings (YYYY-MM-DD) must NOT go through Date() — UTC parsing shifts the day.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  // Prisma @db.Date fields serialize as ISO at UTC midnight (e.g. "2026-04-23T00:00:00.000Z").
  // They carry no time component, so converting them to a local timezone would shift the day
  // (in Argentina, midnight UTC = 21:00 the previous day). Treat them as date-only instead.
  const utcMidnight = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?Z$/.exec(d);
  if (utcMidnight) return `${utcMidnight[3]}/${utcMidnight[2]}/${utcMidnight[1]}`;
  return null;
}

/**
 * Día, mes, año, hora y minutos, siempre con dos dígitos. Un texto de la API
 * (sello de tiempo) se lee en DISPLAY_TZ; un Date armado en el navegador
 * (hoy, parseLocalDate) ya es un día del almanaque local y se lee en local,
 * si no a bordo, fuera de la hora argentina, podía correrse un día.
 */
function dateParts(d: string | Date) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    timeZone: d instanceof Date ? undefined : DISPLAY_TZ,
  }).formatToParts(date);
  const p = (type: Intl.DateTimeFormatPartTypes) => parts.find(x => x.type === type)?.value ?? "";
  return { day: p("day"), month: p("month"), year: p("year"), hour: p("hour"), minute: p("minute") };
}

/** DD/MM/AAAA, o "—" si no hay fecha. */
export function fmtDate(d?: string | Date | null) {
  if (!d) return "—";
  const day = typeof d === "string" ? calendarDay(d) : null;
  if (day) return day;
  const p = dateParts(d);
  return p ? `${p.day}/${p.month}/${p.year}` : "—";
}

/** DD/MM/AAAA HH:MM (24 h). Una fecha de calendario sin hora sale como fmtDate. */
export function fmtDateTime(d?: string | Date | null) {
  if (!d) return "—";
  const day = typeof d === "string" ? calendarDay(d) : null;
  if (day) return day;
  const p = dateParts(d);
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : "—";
}

/** Sólo la hora, HH:MM (24 h), para cuando la fecha ya está a la vista. */
export function fmtTime(d?: string | Date | null) {
  if (!d) return "—";
  const p = dateParts(d);
  return p ? `${p.hour}:${p.minute}` : "—";
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
 * Escapa texto que se va a inyectar como HTML.
 *
 * React escapa solo, pero hay lugares donde armamos HTML a mano y el navegador
 * lo interpreta como tal: los popups y `divIcon` de Leaflet (que por dentro son
 * innerHTML). Ahí, un nombre de buque o un mail con `<img onerror=...>` se
 * ejecuta. Todo dato que venga de la base pasa por acá antes de entrar en esos
 * strings.
 */
export function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c
  ));
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

/**
 * Grupo SFI de un plan (G0…G9): el primer dígito de `sfiGroupNumber`. Un plan
 * puede traer el grupo suelto (0-9) o el código de subgrupo (600 → G6), así que
 * los dos casos se normalizan acá. Devuelve null si el plan no tiene grupo.
 *
 * G0 es el grupo de Inspecciones (incluidas las de Clase).
 */
export function sfiGroupDigit(sfiGroupNumber?: number | null): number | null {
  if (sfiGroupNumber == null) return null;
  const digit = sfiGroupNumber < 10 ? sfiGroupNumber : Math.floor(sfiGroupNumber / 100);
  return digit >= 0 && digit <= 9 ? digit : null;
}

/**
 * Grupo SFI de un EQUIPO a partir de los grupos que declaran sus planes. El
 * grupo lo declara cada plan, no el equipo, y un mismo equipo puede tener
 * tareas cargadas en más de un grupo: se toma el que más se repite (y ante
 * empate, el menor) para que el equipo no se parta en dos lugares de la lista.
 * Devuelve null si ningún plan trae grupo.
 */
export function dominantSfiGroup(sfiGroupNumbers: Array<number | null | undefined>): number | null {
  const counts = new Map<number, number>();
  for (const n of sfiGroupNumbers) {
    const d = sfiGroupDigit(n);
    if (d === null) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [d, n] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (n > bestCount) { best = d; bestCount = n; }
  }
  return best;
}

/** Orden de grupos SFI para listados: G0…G9 y, al final, lo que no tiene grupo. */
export function compareSfiGroup(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}
