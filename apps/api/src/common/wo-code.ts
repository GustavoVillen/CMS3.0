/**
 * Prefijo del código de Orden de Trabajo por tenant.
 *
 * Mercurio nombra sus OT como "Solicitud de Servicio" → prefijo "SS-"
 * (ej. SS-M01-26-0001). El resto de los tenants usa "WO-".
 *
 * El cuerpo del código ({VESSEL}-{YY}-{NNNN}) no cambia, así que la numeración
 * continúa aunque se cambie el prefijo (las consultas de MAX hacen match
 * prefijo-agnóstico sobre los primeros 3 caracteres).
 */
export function workOrderPrefix(tenantSlug: string | null | undefined): string {
  return tenantSlug === "mercurio" ? "SS" : "WO";
}
