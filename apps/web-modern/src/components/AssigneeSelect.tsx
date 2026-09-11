// Desplegable de "Responsable": elige un usuario del sistema en vez de escribir
// el nombre a mano. Al lado del nombre muestra, más tenue, su rol o cargo.
//
// Guarda el ID del usuario, no el texto. Así el nombre sale siempre bien en la
// pantalla y en los PDF (que resuelven el nombre por ID) aunque después se
// corrija cómo se escribe, y deja de haber tres formas distintas de escribir a
// la misma persona.
//
// Compatibilidad: las OT viejas tienen el nombre tipeado a mano guardado en ese
// mismo campo. Ese valor se agrega como una opción más (marcada) para que
// editar la OT no lo borre; al elegir a alguien de la lista, queda migrado.

import React from "react";
import { useFetch } from "../lib/hooks";
import { useT } from "../lib/i18n";
import { PersonSelect } from "./PersonSelect";

export interface DirectoryUser {
  userId: string;
  name: string;
  role?: string | null;
  jobTitle?: string | null;
}

interface Props {
  /** ID del usuario o, en registros viejos, el nombre tipeado a mano. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export const AssigneeSelect: React.FC<Props> = ({ value, onChange, disabled, className }) => {
  const t = useT();
  const { data } = useFetch<DirectoryUser[]>("/app/team/directory");
  const people = Array.isArray(data) ? data : [];

  // El valor guardado no está en la lista: o es un nombre viejo tipeado a mano,
  // o el usuario ya no está activo. En los dos casos se conserva visible.
  const isKnown = people.some(p => p.userId === value);
  const legacy = value && !isKnown ? value : null;

  return (
    <PersonSelect
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={className}
      emptyLabel={t("wo.modal.assigneeNone")}
      options={[
        ...(legacy ? [{ value: legacy, name: legacy }] : []),
        ...people.map(p => ({ value: p.userId, name: p.name, role: p.role, jobTitle: p.jobTitle })),
      ]}
    />
  );
};
