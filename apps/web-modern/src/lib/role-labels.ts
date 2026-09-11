// Nombres visibles de los roles del sistema, traducidos al idioma del tenant.
//
// Viven acá (y no sólo en Equipo) porque también se muestran al lado del nombre
// en todos los desplegables de personas: quién solicita, quién aprueba, el
// responsable… Elegir a alguien sin saber qué papel tiene es cómo termina
// firmando la persona equivocada.

import { useCallback, useMemo } from "react";
import { useT, type TranslationKey } from "./i18n";

export const ROLE_LABEL_KEYS: Record<string, TranslationKey> = {
  TENANT_ADMIN:         "role.tenantAdmin",
  FLEET_SUPERINTENDENT: "role.fleetSuperintendent",
  MAINTENANCE_MANAGER:  "role.maintenanceManager",
  TECHNICIAN_OPERATOR:  "role.technicianOperator",
  INSPECTOR_COMPLIANCE: "role.inspectorCompliance",
  PROCUREMENT_STORE:    "role.procurementStore",
  HSE_MANAGER:          "role.hseManager",
  AUDITOR_READONLY:     "role.auditorReadonly",
};

/** Rol del sistema → nombre visible traducido. */
export function useRoleLabels(): Record<string, string> {
  const t = useT();
  return useMemo(
    () => Object.fromEntries(Object.entries(ROLE_LABEL_KEYS).map(([role, key]) => [role, t(key)])),
    [t],
  );
}

/**
 * Lo que va al lado del nombre de una persona: su cargo si lo cargaron en
 * Equipo (es lo que la gente reconoce: "Jefe de Máquinas del M01"); si no, el
 * rol del sistema traducido.
 */
export function usePersonRoleText(): (role?: string | null, jobTitle?: string | null) => string {
  const labels = useRoleLabels();
  return useCallback(
    (role, jobTitle) => jobTitle?.trim() || (role ? labels[role] ?? "" : ""),
    [labels],
  );
}
