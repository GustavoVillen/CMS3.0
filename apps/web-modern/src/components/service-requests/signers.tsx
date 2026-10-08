// Firmantes de la TRAMITACION de la SS (Solicita / Aprueba / Autoriza).
//
// Lo comparten el bloque de firmas del formulario y la corrección de la hoja de
// ruta: corregir quién aprobó desde cualquiera de los dos tiene que ofrecer la
// misma gente, con la misma regla que valida el backend.

import { useT } from "../../lib/i18n";
import { PersonSelect } from "../PersonSelect";

export interface TeamMember {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  formName: string | null;
  role: string;
  /** Cargo cargado en Equipo (se muestra al lado del nombre; si no hay, el rol). */
  jobTitle?: string | null;
  hasSignature: boolean;
  /** Para ofrecer sólo a los que están a cargo del buque de la SS. */
  assignedVesselCodes?: string[];
}

/** Nombre a estampar en el formulario: el configurado para documentos, si tiene. */
export const memberLabel = (m: TeamMember) =>
  m.formName?.trim() || `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "(sin nombre)";

/**
 * Quién puede figurar en cada paso de la tramitación. Un ADMIN siempre; el
 * SUPERINTENDENTE sólo si está a cargo del buque de la SS; el JEFE DE MÁQUINAS
 * sólo para APROBAR — autorizar es atribución de tierra. Solicitar no es una
 * firma: el pedido lo puede originar cualquiera del buque.
 *
 * Misma regla que valida el backend en resolveSigner. Se comparte entre el modal
 * de firma y la corrección de nombres del admin: dos copias divergiendo serían
 * un desplegable ofreciendo gente que el backend después rechaza.
 */
export function eligibleSigners(
  members: TeamMember[],
  step: "SOLICITA" | "APRUEBA" | "AUTORIZA",
  vesselCode: string,
  /** Matriz de Equipo → Permisos ("Aprobar SS" / "Autorizar SS"), la misma que valida el backend. */
  roleHas: (role: string, key: string) => boolean,
): TeamMember[] {
  return members.filter(m => {
    if (m.role === "AUDITOR_READONLY") return false; // solo-lectura: no pide ni firma
    if (m.role === "TENANT_ADMIN") return true;
    const enElBuque = (m.assignedVesselCodes ?? []).includes(vesselCode);
    if (step === "SOLICITA") return enElBuque;
    return enElBuque && roleHas(m.role, step === "APRUEBA" ? "sr.approve" : "sr.authorize");
  });
}

/**
 * Nombre de un paso de la tramitacion. Sólo lo ve el admin y sólo sobre un paso
 * YA CUMPLIDO.
 *
 * Es un desplegable, no texto libre: el que figura firmando tiene que ser
 * alguien del equipo habilitado para ese paso. Si el nombre guardado no está
 * entre los elegibles (cargó una SS de papel, o esa persona ya no está en la
 * empresa) se conserva como opción propia para no borrarlo sin querer.
 */
export function SignerSelect({ value, onChange, options, className }: {
  /** Nombre y usuario van juntos: el usuario es el que le da la firma al PDF. */
  value: { name: string; userId: string };
  onChange: (v: { name: string; userId: string }) => void;
  options: TeamMember[];
  className?: string;
}) {
  // El select se maneja por userId, no por nombre: dos personas pueden llamarse
  // igual, y el nombre suelto no alcanza para saber de quién es la firma.
  const HUERFANO = "__HUERFANO__";
  const t = useT();
  const enLista = options.some(m => m.userId === value.userId);
  const huerfano = !enLista && value.name ? value.name : null;
  return (
    <PersonSelect
      className={className ?? "w-full bg-transparent text-[11px] text-fg outline-none"}
      value={enLista ? value.userId : (huerfano ? HUERFANO : "")}
      onChange={uid => {
        if (uid === HUERFANO) return; // no se re-elige: es el nombre que ya estaba
        const m = options.find(x => x.userId === uid);
        onChange(m ? { name: memberLabel(m), userId: m.userId } : { name: "", userId: "" });
      }}
      emptyLabel={t("person.unassigned")}
      options={[
        // Nombre viejo sin usuario (SS de papel, o alguien que ya no está en la
        // empresa). Se ofrece para no borrarlo sin querer, pero el PDF no le
        // pone firma: no hay a quién buscársela.
        ...(huerfano ? [{ value: HUERFANO, name: huerfano, note: t("person.noSignature") }] : []),
        ...options.map(m => ({
          value: m.userId, name: memberLabel(m), role: m.role, jobTitle: m.jobTitle,
          note: m.hasSignature ? null : t("person.noSignature"),
        })),
      ]}
    />
  );
}
