/**
 * Regla de tramitación de las INSPECCIONES.
 *
 * Una OT de inspección recorre el mismo camino que cualquier otra, con una sola
 * excepción de negocio: NO requiere aprobación ni autorización. Nace AUTORIZADA
 * y queda lista para ejecutarse.
 *
 * Lo que NO cambia: las Solicitudes de Servicio colgadas de esa OT sí requieren
 * aprobación y autorización, y siguen su propia tramitación (nacen DRAFT y se
 * firman desde la SS). Por eso la inspección no usa el camino "OT express", que
 * arrastra las SS a AUTORIZADA junto con la orden.
 *
 * Las tres firmas quedan a nombre de "Sistema": no hubo firma humana, la habilitó
 * la regla. Dejarlas en blanco sería peor (una OT autorizada sin decir por quién);
 * mismo criterio que el cierre rápido de un plan.
 */

export const INSPECTION_AUTO_SIGNER = "Sistema";

/** ¿El tipo de OT es una inspección? */
export function isInspectionWorkOrder(type: string | null | undefined): boolean {
  return type === "INSPECTION";
}

/**
 * Sellos de tramitación de una OT de inspección: enviada, aprobada y autorizada
 * en el momento de la apertura. Se mezclan en el `data` del create.
 */
export function inspectionApprovalStamps(openDate: Date): Record<string, unknown> {
  return {
    enviadoAprobacionByName: INSPECTION_AUTO_SIGNER,
    enviadoAprobacionAt: openDate,
    aprobadoByName: INSPECTION_AUTO_SIGNER,
    aprobadoAt: openDate,
    autorizadoByName: INSPECTION_AUTO_SIGNER,
    autorizadoAt: openDate,
  };
}
