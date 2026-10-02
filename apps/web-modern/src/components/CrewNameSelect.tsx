// Campo de NOMBRE de una persona del equipo con lista y autocompletado: se
// escribe y la lista se filtra (ver PersonSelect). Guarda el NOMBRE, no el id:
// los recuadros del papel (Capitán, Jefe de Máquinas, Quién recibe) son texto y
// así salen en los PDF y en los registros viejos.
//
// `crew`:
//  · "captain" / "chief": el Capitán o el Jefe de Máquinas. Si en Equipo está
//    cargado el cargo, cada lista muestra sólo los suyos; sin cargo, salen en
//    las dos las personas con el rol de a bordo (MAINTENANCE_MANAGER). Primero
//    las del buque de la SS; si no hay nadie asignado a ese buque, todas.
//  · "any": cualquier persona de la empresa (quién recibe puede ser cualquier
//    operario).
//
// Un nombre viejo escrito a mano que no está en la lista se conserva como una
// opción más, para que editar el registro no lo borre.

import React, { useMemo } from "react";
import { useFetch } from "../lib/hooks";
import { PersonSelect, type PersonOption } from "./PersonSelect";
import type { DirectoryUser } from "./AssigneeSelect";

type Crew = "captain" | "chief" | "any";

const fold = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const isCaptain = (u: DirectoryUser) => /capit/.test(fold(u.jobTitle));
const isChief = (u: DirectoryUser) => /jefe\s*de\s*maq|maquinista|\bj\.?\s?m\b/.test(fold(u.jobTitle));
const ONBOARD_ROLE = "MAINTENANCE_MANAGER";

interface Props {
  value: string;
  onChange: (name: string) => void;
  crew: Crew;
  /** Buque del registro: sus Capitanes / Jefes de Máquinas van primero. */
  vesselCode?: string | null;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export const CrewNameSelect: React.FC<Props> = ({ value, onChange, crew, vesselCode, className, disabled, placeholder }) => {
  const { data } = useFetch<Array<DirectoryUser & { vesselCodes?: string[] }>>("/app/team/directory");

  const options = useMemo<PersonOption[]>(() => {
    const people = Array.isArray(data) ? data : [];
    let list = people;
    if (crew !== "any") {
      const pool = people.filter(u => u.role === ONBOARD_ROLE || isCaptain(u) || isChief(u));
      const onVessel = vesselCode ? pool.filter(u => (u.vesselCodes ?? []).includes(vesselCode)) : pool;
      const base = onVessel.length > 0 ? onVessel : pool;
      const mine = crew === "captain" ? isCaptain : isChief;
      // Cargo cargado: sólo los suyos. Sin cargo: puede ser cualquiera de los dos.
      const scoped = base.filter(u => mine(u) || (!isCaptain(u) && !isChief(u)));
      list = scoped.length > 0 ? scoped : people;
    }
    const seen = new Set<string>();
    const opts: PersonOption[] = [];
    for (const u of list) {
      if (seen.has(u.name)) continue;
      seen.add(u.name);
      opts.push({ value: u.name, name: u.name, role: u.role, jobTitle: u.jobTitle });
    }
    // Nombre viejo escrito a mano: queda como opción para no perderlo.
    if (value && !seen.has(value)) opts.unshift({ value, name: value });
    return opts;
  }, [data, crew, vesselCode, value]);

  return (
    <PersonSelect
      value={value}
      onChange={onChange}
      options={options}
      className={className}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
};
