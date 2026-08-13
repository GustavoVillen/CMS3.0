// Desplegable de "Responsable": elige un usuario del sistema en vez de escribir
// el nombre a mano.
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

export interface DirectoryUser {
  userId: string;
  name: string;
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
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className={className}
    >
      <option value="">{t("wo.modal.assigneeNone")}</option>
      {legacy && <option value={legacy}>{legacy}</option>}
      {people.map(p => (
        <option key={p.userId} value={p.userId}>{p.name}</option>
      ))}
    </select>
  );
};
