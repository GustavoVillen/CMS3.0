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

export interface HojaRutaRow {
  fecha: Date;
  novedad: string;
  asienta: string;
  /** Presente sólo en las novedades a mano: es lo único borrable. */
  logId?: string;
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
  const push = (fecha: unknown, novedad: string, asienta: unknown, logId?: string) => {
    if (!fecha) return;
    const d = new Date(fecha as string);
    if (Number.isNaN(d.getTime())) return;
    const quien = typeof asienta === "string" ? asienta.trim() : "";
    filas.push({ fecha: d, novedad, asienta: quien || "—", ...(logId ? { logId } : {}) });
  };

  const solicita = sr.solicitaByName ?? solicitaFallback ?? null;
  push(sr.openDate, "Solicitud creada", solicita);
  push(sr.aprobadoAt, "Aprobada", sr.aprobadoByName);
  push(sr.autorizadoAt, "Autorizada", sr.autorizadoByName);
  push(
    sr.rechazadoAt,
    `No aprobada${sr.rechazoReason ? ` — ${sr.rechazoReason}` : ""}`,
    sr.rechazadoByName,
  );
  const taller = tallerName ?? sr.tallerNotes ?? null;
  push(sr.startedAt, `Enviada al taller${taller ? ` ${taller}` : ""}`, sr.autorizadoByName ?? solicita);
  push(
    sr.receivedAt,
    `Servicio recibido ${sr.receptionConform === false ? "NO conforme" : "conforme"}`,
    sr.receivedByName,
  );
  for (const l of (sr.hojaRuta ?? []) as Array<Record<string, any>>) {
    push(l.entryDate, String(l.novedad ?? ""), l.asientaByName, String(l.id));
  }

  filas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  return filas;
}
