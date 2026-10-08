// HOJA DE RUTA DEL PEDIDO (REGI-LOG-01.3): FECHA | NOVEDAD | ASIENTA.
//
// Única fuente de verdad de cómo se arma. La consumen el PDF, el Word y la
// pantalla — si cada uno la derivara por su cuenta, el mismo pedido podría
// contar tres historias distintas.
//
// Mezcla, ordenado por fecha:
//  · hitos DERIVADOS de las fechas que ya tiene la SS. No se guardan como filas:
//    duplicarlos dejaría que la hoja de ruta contradiga a la tramitación del
//    mismo formulario.
//  · novedades asentadas a mano (ServiceRequestLog) — lo que el sistema no puede
//    saber solo ("el taller reprogramó").

/** Paso de la tramitación del que sale cada hito. */
export type HojaRutaHito = "CREADA" | "APROBADA" | "AUTORIZADA" | "RECHAZADA" | "ENVIADA" | "RECIBIDA";

/**
 * De qué campos de la SS sale cada hito. Corregir un hito (sólo el admin) es
 * corregir esos campos, así la hoja de ruta y la tramitación siguen leyendo el
 * mismo dato.
 *
 * `nameField` null = el nombre no se corrige desde la hoja de ruta. En Solicita,
 * Aprueba y Autoriza el nombre viaja con el usuario que da la firma del PDF y se
 * corrige en la tramitación; el de "Enviada al taller" sale de quien autorizó.
 */
export const HITO_FIELDS: Record<HojaRutaHito, { dateField: string; nameField: string | null; label: string }> = {
  CREADA:     { dateField: "openDate",     nameField: null,              label: "Solicitud creada" },
  APROBADA:   { dateField: "aprobadoAt",   nameField: null,              label: "Aprobada" },
  AUTORIZADA: { dateField: "autorizadoAt", nameField: null,              label: "Autorizada" },
  RECHAZADA:  { dateField: "rechazadoAt",  nameField: "rechazadoByName", label: "No aprobada" },
  ENVIADA:    { dateField: "startedAt",    nameField: null,              label: "Enviada al taller" },
  RECIBIDA:   { dateField: "receivedAt",   nameField: "receivedByName",  label: "Servicio recibido" },
};

export interface HojaRutaRow {
  fecha: Date;
  novedad: string;
  asienta: string;
  /** Presente sólo en las novedades a mano: es lo único borrable. */
  logId?: string;
  /** Presente sólo en los hitos: el admin corrige su fecha (y el nombre si asientaEditable). */
  hito?: HojaRutaHito;
  asientaEditable?: boolean;
}

/**
 * @param sr  ServiceRequest con `hojaRuta` incluido (ver getServiceRequest).
 * @param tallerName  Provider resuelto; si no hay, cae a sr.tallerNotes.
 * @param solicitaFallback  Nombre de quien creó la SS, si no hay solicitaByName.
 */
export function buildHojaRuta(
  sr: Record<string, any>,
  tallerName?: string | null,
  solicitaFallback?: string | null,
): HojaRutaRow[] {
  const filas: HojaRutaRow[] = [];
  const push = (fecha: unknown, novedad: string, asienta: unknown, extra: Pick<HojaRutaRow, "logId" | "hito"> = {}) => {
    if (!fecha) return;
    const d = new Date(fecha as string);
    if (Number.isNaN(d.getTime())) return;
    const quien = typeof asienta === "string" ? asienta.trim() : "";
    filas.push({
      fecha: d, novedad, asienta: quien || "—", ...extra,
      ...(extra.hito ? { asientaEditable: HITO_FIELDS[extra.hito].nameField !== null } : {}),
    });
  };

  const solicita = sr.solicitaByName ?? solicitaFallback ?? null;
  push(sr.openDate, HITO_FIELDS.CREADA.label, solicita, { hito: "CREADA" });
  push(sr.aprobadoAt, HITO_FIELDS.APROBADA.label, sr.aprobadoByName, { hito: "APROBADA" });
  push(sr.autorizadoAt, HITO_FIELDS.AUTORIZADA.label, sr.autorizadoByName, { hito: "AUTORIZADA" });
  push(
    sr.rechazadoAt,
    `${HITO_FIELDS.RECHAZADA.label}${sr.rechazoReason ? ` — ${sr.rechazoReason}` : ""}`,
    sr.rechazadoByName,
    { hito: "RECHAZADA" },
  );
  const taller = tallerName ?? sr.tallerNotes ?? null;
  push(sr.startedAt, `${HITO_FIELDS.ENVIADA.label}${taller ? ` ${taller}` : ""}`, sr.autorizadoByName ?? solicita, { hito: "ENVIADA" });
  push(
    sr.receivedAt,
    `${HITO_FIELDS.RECIBIDA.label} ${sr.receptionConform === false ? "NO conforme" : "conforme"}`,
    sr.receivedByName,
    { hito: "RECIBIDA" },
  );
  for (const l of (sr.hojaRuta ?? []) as Array<Record<string, any>>) {
    push(l.entryDate, String(l.novedad ?? ""), l.asientaByName, { logId: String(l.id) });
  }

  filas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  return filas;
}
