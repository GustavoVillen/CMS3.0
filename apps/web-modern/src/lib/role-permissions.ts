// Matriz de permisos por rol de la empresa (Equipo → Permisos), para saber qué
// puede hacer OTRA persona — p. ej. a quién ofrecer como firmante al aprobar.
// Lo que puede hacer el usuario logueado ya viaja en la sesión: para eso, useCan().
//
// Es la misma matriz que valida el servidor (roleHasPermission): si el
// desplegable ofreciera a alguien que el permiso no habilita, el servidor lo
// rechazaría con un 403.

import { useCallback } from "react";
import { useFetch } from "./hooks";

interface RolePermissionsPayload {
  matrix: Record<string, string[]>;
}

/** (rol, permiso) → ¿ese rol lo tiene? TENANT_ADMIN siempre sí. Mientras carga, sólo el admin. */
export function useRoleHasPermission(enabled = true): (role: string | null | undefined, key: string) => boolean {
  const { data } = useFetch<RolePermissionsPayload>(enabled ? "/app/tenant/role-permissions" : null, [enabled]);
  const matrix = data?.matrix ?? null;
  return useCallback((role, key) => {
    if (role === "TENANT_ADMIN") return true;
    if (!role || !matrix) return false;
    return (matrix[role] ?? []).includes(key);
  }, [matrix]);
}
