// FECHAS Y HORAS DE LOS DOCUMENTOS, en la hora de la empresa.
//
// El proceso de la API corre en UTC. Formatear con la hora del proceso hacía que
// un permiso cargado de 08:00 a 18:00 se imprimiera de 11:00 a 21:00, y que una
// fecha de apertura del 03/08 saliera 02/08. Los papeles se firman y se archivan
// a bordo: la fecha y la hora tienen que ser las del buque, no las del servidor.
//
// Hay DOS clases de valor guardados en la base y se tratan distinto:
//
//   · SELLO DE TIEMPO real (firma, cierre, "generado"): es un instante. Se
//     muestra en la zona horaria de la empresa.
//   · FECHA SOLA elegida en un calendario (apertura, vencimiento, jornada): se
//     guarda como medianoche UTC y representa un día del almanaque, no un
//     instante. Convertirla a la hora local la corría al día anterior, así que
//     se formatea en UTC — el resultado es el día que el usuario eligió.
//
// La distinción se hace por el valor: 00:00:00.000 UTC = fecha sola. Un sello de
// tiempo que caiga justo en ese instante es tan improbable como inofensivo.

import { getCachedTenantBySlug } from "../tenant/tenant-cache";

/** Fallback cuando la empresa no tiene zona horaria cargada. */
export const FALLBACK_TZ = "UTC";

/** Locale de los documentos según el idioma de la empresa. */
export function localeOf(defaultLocale?: string | null): string {
  return defaultLocale === "en" ? "en-GB" : defaultLocale === "pt" ? "pt-BR" : "es-AR";
}

/** Zona horaria + locale de la empresa (cacheado 5 min por tenant-cache). */
export async function resolveTenantTime(tenantSlug: string): Promise<{ tz: string; locale: string }> {
  try {
    const tenant = await getCachedTenantBySlug(tenantSlug);
    return {
      tz: tenant?.settings?.timezone || FALLBACK_TZ,
      locale: localeOf(tenant?.settings?.defaultLocale),
    };
  } catch {
    return { tz: FALLBACK_TZ, locale: "es-AR" };
  }
}

function isDateOnly(date: Date): boolean {
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
}

/**
 * Día, mes, año, hora y minutos de un instante en una zona horaria, siempre con
 * dos dígitos. Regla del producto: toda fecha que lee una persona sale
 * DD/MM/AAAA, y con hora DD/MM/AAAA HH:MM (24 h), sea cual sea el idioma de la
 * empresa. Por eso el texto se arma acá y no se le deja al locale (en-GB y
 * pt-BR meten coma, es-AR con dateStyle corto da el año en dos cifras).
 */
function parts(date: Date, tz: string) {
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  };
  let list: Intl.DateTimeFormatPart[];
  try {
    list = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz }).formatToParts(date);
  } catch {
    // Zona horaria mal cargada en la empresa: no se rompe el documento por eso.
    list = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).formatToParts(date);
  }
  const p = (type: Intl.DateTimeFormatPartTypes) => list.find(x => x.type === type)?.value ?? "";
  return { day: p("day"), month: p("month"), year: p("year"), hour: p("hour"), minute: p("minute") };
}

/**
 * Fecha (sin hora) para un documento, DD/MM/AAAA. Las fechas de calendario salen
 * tal como se eligieron; los sellos de tiempo, en el día que corresponde a la
 * hora local. `locale` queda por compatibilidad: el formato es el mismo en todos
 * los idiomas.
 */
export function fmtDate(
  d: Date | string | null | undefined,
  tz: string,
  locale = "es-AR",
  empty = "—",
): string {
  void locale;
  if (!d) return empty;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return empty;
  const p = parts(date, isDateOnly(date) ? "UTC" : tz);
  return `${p.day}/${p.month}/${p.year}`;
}

/** Fecha y hora para un documento, DD/MM/AAAA HH:MM en la hora de la empresa. */
export function fmtDateTime(
  d: Date | string | null | undefined,
  tz: string,
  locale = "es-AR",
  empty = "—",
): string {
  if (!d) return empty;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return empty;
  // Una fecha sola no tiene hora que mostrar: se imprime como fecha, si no
  // saldría "00:00" (o "21:00" del día anterior) inventando una precisión falsa.
  if (isDateOnly(date)) return fmtDate(date, tz, locale, empty);
  const p = parts(date, tz);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/**
 * DD/MM/AAAA HH:MM siempre como instante, sin la regla de "medianoche UTC =
 * fecha sola": para horarios elegidos a mano. Un permiso de 21:00 en Argentina
 * cae justo en las 00:00 UTC y no puede perder la hora ni cambiar de día.
 */
export function fmtInstant(d: Date | string | null | undefined, tz: string, empty = "—"): string {
  if (!d) return empty;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return empty;
  const p = parts(date, tz);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/**
 * Día del almanaque (AAAA-MM-DD) en que cae una fecha, con el mismo criterio que
 * fmtDate: sirve para comparar días (lo que ve la gente), no instantes.
 */
export function dayKey(d: Date | string, tz: string): string {
  const date = new Date(d);
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: isDateOnly(date) ? "UTC" : tz }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).formatToParts(date);
  }
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Solo la hora (HH:MM) de un sello de tiempo, en la hora de la empresa. */
export function fmtTime(
  d: Date | string | null | undefined,
  tz: string,
  locale = "es-AR",
  empty = "—",
): string {
  void locale;
  if (!d) return empty;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return empty;
  const p = parts(date, tz);
  return `${p.hour}:${p.minute}`;
}
