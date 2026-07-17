/**
 * Prefijo del código de Orden de Trabajo por tenant.
 *
 * Mercurio usa "OT-" (ej. OT-M01-26-0001); el resto de los tenants usa "WO-".
 *
 * Histórico: hasta jul-2026 Mercurio usaba el prefijo "SS-" porque se creía que
 * una Orden de Trabajo y una Solicitud de Servicio eran la misma entidad con
 * distinto nombre. No lo son: la SS es el pedido de un servicio externo que
 * cuelga de una OT abierta (ver ServiceRequest). Las OT existentes se
 * renumeraron con `scripts/rename-ss-to-ot.ts`.
 *
 * El cuerpo del código ({VESSEL}-{YY}-{NNNN}) no cambia, así que la numeración
 * continúa aunque se cambie el prefijo (las consultas de MAX hacen match
 * prefijo-agnóstico sobre los primeros 3 caracteres).
 */
export function workOrderPrefix(tenantSlug: string | null | undefined): string {
  return tenantSlug === "mercurio" ? "OT" : "WO";
}
