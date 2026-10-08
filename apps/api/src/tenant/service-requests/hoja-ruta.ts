// HOJA DE RUTA DEL PEDIDO (REGI-LOG-01.3): FECHA | NOVEDAD | ASIENTA.
//
// Única fuente de verdad de cómo se arma. La consumen el PDF, el Word y la
// pantalla — si cada uno la derivara por su cuenta, el mismo pedido podría
// contar tres historias distintas.
//
// Mezcla, ordenado por fecha:
//  · hitos DERIVADOS de las fechas que ya tiene la SS. No se guardan como filas:
//    duplicarlos dejaría que la hoja de ruta contradiga a la tramitación del
//    mismo formulario. El admin les puede sumar un detalle (hojaRutaHitos).
//  · novedades asentadas a mano (ServiceRequestLog) — lo que el sistema no puede
//    saber solo ("el taller reprogramó").

/** Paso de la tramitación del que sale cada hito. */
export type HojaRutaHito = "CREADA" | "APROBADA" | "AUTORIZADA" | "RECHAZADA" | "ENVIADA" | "RECIBIDA";

/**
 * De qué campos de la SS sale cada hito. Corregir un hito (sólo el admin) es
 * corregir esos campos, así la hoja de ruta y la tramitación siguen leyendo el
 * mismo dato.
 *
 * Quién asienta:
 *  · `firma`: es el firmante de ese paso de la tramitación. Se elige de la lista
 *    del personal y cambia en toda la SS (nombre + usuario, que da la firma del PDF).
 *  · `nameField`: nombre suelto de la SS, sin firma detrás.
 *  · ninguno ("Enviada al taller"): el nombre se guarda en hojaRutaHitos.
 *
 * El detalle se guarda en hojaRutaHitos, salvo en "No aprobada", donde el
 * detalle es el motivo del rechazo que ya tiene la SS.
 */
export const HITO_FIELDS: Record<HojaRutaHito, {
  dateField: string;
  label: string;
  firma?: "SOLICITA" | "APRUEBA" | "AUTORIZA";
  nameField?: string;
  detailField?: string;
}> = {
  CREADA:     { dateField: "openDate",     label: "Solicitud creada",  firma: "SOLICITA" },
  APROBADA:   { dateField: "aprobadoAt",   label: "Aprobada",          firma: "APRUEBA" },
  AUTORIZADA: { dateField: "autorizadoAt", label: "Autorizada",        firma: "AUTORIZA" },
  RECHAZADA:  { dateField: "rechazadoAt",  label: "No aprobada",       nameField: "rechazadoByName", detailField: "rechazoReason" },
  ENVIADA:    { dateField: "startedAt",    label: "Enviada al taller" },
  RECIBIDA:   { dateField: "receivedAt",   label: "Servicio recibido", nameField: "receivedByName" },
};

/** Lo que el admin le sumó a cada hito (ServiceRequest.hojaRutaHitos). */
export type HojaRutaHitosExtra = Partial<Record<HojaRutaHito, { detalle?: string; asienta?: string }>>;

export interface HojaRutaRow {
  fecha: Date;
  novedad: string;
  asienta: string;
  /** Presente sólo en las novedades a mano: es lo único borrable. */
  logId?: string;
  // ── Sólo en los hitos (para la ventana de corrección del admin) ──
  hito?: HojaRutaHito;
  /** Texto que pone el sistema, sin el detalle. */
  hitoTexto?: string;
  detalle?: string | null;
  /**
   * "firma" = se elige de la lista del personal (cambia el firmante en la SS);
   * "texto" = nombre suelto; sin valor = todavía no se puede corregir (la
   * solicitud en borrador no tiene quién solicita).
   */
  asientaModo?: "firma" | "texto";
  /** Paso y usuario del firmante, cuando asientaModo = "firma". */
  firma?: "SOLICITA" | "APRUEBA" | "AUTORIZA";
  asientaUserId?: string | null;
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
  const extra = (sr.hojaRutaHitos ?? {}) as HojaRutaHitosExtra;
  const push = (fecha: unknown, novedad: string, asienta: unknown, logId?: string) => {
    if (!fecha) return null;
    const d = new Date(fecha as string);
    if (Number.isNaN(d.getTime())) return null;
    const quien = typeof asienta === "string" ? asienta.trim() : "";
    const fila: HojaRutaRow = { fecha: d, novedad, asienta: quien || "—", ...(logId ? { logId } : {}) };
    filas.push(fila);
    return fila;
  };
  const hito = (h: HojaRutaHito, texto: string, asienta: unknown, firmaUserId?: unknown) => {
    const campos = HITO_FIELDS[h];
    const detalle = campos.detailField ? sr[campos.detailField] ?? null : extra[h]?.detalle ?? null;
    const fila = push(sr[campos.dateField], detalle ? `${texto} — ${detalle}` : texto, asienta);
    if (!fila) return;
    // Solicita recién tiene firmante cuando la SS salió de borrador (mismo criterio
    // que SIGNATURE_STEPS en el service).
    const firmable = campos.firma && (h !== "CREADA" || sr.status !== "DRAFT");
    Object.assign(fila, {
      hito: h, hitoTexto: texto, detalle,
      ...(firmable ? { asientaModo: "firma", firma: campos.firma, asientaUserId: firmaUserId ?? null }
        : campos.firma ? {} : { asientaModo: "texto" }),
    });
  };

  const solicita = sr.solicitaByName ?? solicitaFallback ?? null;
  hito("CREADA", HITO_FIELDS.CREADA.label, solicita, sr.solicitaByUserId);
  hito("APROBADA", HITO_FIELDS.APROBADA.label, sr.aprobadoByName, sr.aprobadoByUserId);
  hito("AUTORIZADA", HITO_FIELDS.AUTORIZADA.label, sr.autorizadoByName, sr.autorizadoByUserId);
  hito("RECHAZADA", HITO_FIELDS.RECHAZADA.label, sr.rechazadoByName);
  const taller = tallerName ?? sr.tallerNotes ?? null;
  hito("ENVIADA", `${HITO_FIELDS.ENVIADA.label}${taller ? ` ${taller}` : ""}`,
    extra.ENVIADA?.asienta ?? sr.autorizadoByName ?? solicita);
  hito("RECIBIDA", `${HITO_FIELDS.RECIBIDA.label} ${sr.receptionConform === false ? "NO conforme" : "conforme"}`,
    sr.receivedByName);
  for (const l of (sr.hojaRuta ?? []) as Array<Record<string, any>>) {
    push(l.entryDate, String(l.novedad ?? ""), l.asientaByName, String(l.id));
  }

  filas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  return filas;
}
