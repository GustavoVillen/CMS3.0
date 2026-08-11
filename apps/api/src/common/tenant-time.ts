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

function safeFormat(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return date.toLocaleString(locale, options);
  } catch {
    // Zona horaria mal cargada en la empresa: no se rompe el documento por eso.
    const { timeZone, ...rest } = options;
    void timeZone;
    return date.toLocaleString(locale, rest);
  }
}

/**
 * Fecha (sin hora) para un documento. Las fechas de calendario salen tal como se
 * eligieron; los sellos de tiempo, en el día que corresponde a la hora local.
 */
export function fmtDate(
  d: Date | string | null | undefined,
  tz: string,
  locale = "es-AR",
  empty = "—",
): string {
  if (!d) return empty;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return empty;
  return safeFormat(date, locale, {
    day: "2-digit", month: "2-digit", year: "numeric",
    timeZone: isDateOnly(date) ? "UTC" : tz,
  });
}

/** Fecha y hora para un documento, en la hora de la empresa. */
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
  if (isDateOnly(date)) {
    return safeFormat(date, locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  }
  return safeFormat(date, locale, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: tz,
  });
}

/** Solo la hora (HH:MM) de un sello de tiempo, en la hora de la empresa. */
export function fmtTime(
  d: Date | string | null | undefined,
  tz: string,
  locale = "es-AR",
  empty = "—",
): string {
  if (!d) return empty;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return empty;
  return safeFormat(date, locale, { hour: "2-digit", minute: "2-digit", timeZone: tz });
}
