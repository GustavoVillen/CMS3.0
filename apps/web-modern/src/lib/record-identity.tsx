// IDENTIDAD VISUAL DE LAS TRES ENTIDADES QUE SE CONFUNDEN.
//
// Plan de Mantenimiento, Orden de Trabajo y Solicitud de Servicio tienen
// pantallas y ventanas casi calcadas: el mismo encabezado, y en el caso de la OT
// y la SS la misma hoja de documento controlado, donde lo único distinto es el
// código del formulario en letra chica. Este módulo les da a las tres una
// identidad fija —color, ícono y nombre escrito— para reconocerlas de un vistazo.
//
// Tres ingredientes, siempre juntos:
//   · el NOMBRE escrito ("Orden de Trabajo")
//   · el ÍCONO, el mismo del menú lateral
//   · el COLOR, como refuerzo
// El color nunca va solo: hay gente que no lo distingue, y los formularios se
// imprimen en blanco y negro.
//
// POR QUÉ ESTOS COLORES Y NO OTROS: en la app el color ya significa estado, y
// eso no se toca. Azul = aprobado, violeta = autorizado, verde = normal / hecho,
// ámbar = precaución, rojo = crítico / rechazado. Quedaban libres el celeste (que
// la OT ya venía usando), el verde azulado y el fucsia. Si alguno no gusta, se
// cambia acá y cambia en toda la app.

import { ClipboardList, Wrench, Handshake, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "./i18n";

export type RecordKind = "plan" | "workOrder" | "serviceRequest";

export interface RecordIdentity {
  icon: LucideIcon;
  /** Nombre de la entidad EN SINGULAR: identifica un registro, no la pantalla. */
  labelKey: TranslationKey;
  /** Texto e ícono. */
  text: string;
  /** Franja del borde superior de la ventana. */
  edge: string;
  /** Recuadro del ícono en el encabezado de la pantalla. */
  box: string;
}

export const RECORD_IDENTITY: Record<RecordKind, RecordIdentity> = {
  plan: {
    icon: ClipboardList,
    labelKey: "mp.entityLabel",
    text: "text-teal-700 dark:text-teal-400",
    edge: "border-t-teal-500",
    box:  "bg-teal-500/10 border-teal-500/25",
  },
  workOrder: {
    icon: Wrench,
    labelKey: "wo.entityLabel",
    // La OT se queda con el celeste del tema: es la entidad más usada y ya la
    // tenía. Cambiarla habría movido el color de media app sin ganar nada.
    text: "text-accent",
    edge: "border-t-accent",
    box:  "bg-accent/10 border-accent/25",
  },
  serviceRequest: {
    icon: Handshake,
    labelKey: "ss.entityLabel",
    text: "text-fuchsia-700 dark:text-fuchsia-400",
    edge: "border-t-fuchsia-500",
    box:  "bg-fuchsia-500/10 border-fuchsia-500/25",
  },
};

/**
 * Franja de color para el encabezado de la ventana de un registro. Se le agrega
 * al div del header que ya existe, sin mover nada de lugar.
 *
 * Es un borde superior y no un elemento aparte por dos razones: la ventana la
 * recorta con sus esquinas redondeadas, y en la SS —donde el encabezado es
 * pegajoso— la franja sigue a la vista mientras se scrollea la hoja.
 *
 * Sin fondo tintado a propósito: el encabezado de la SS necesita fondo OPACO
 * para que la hoja no se transparente al scrollear debajo, y dos colores de
 * fondo en el mismo elemento se pelean. La identidad la dan la franja, el ícono,
 * el nombre y el color del código, que además funcionan impresos en blanco y
 * negro.
 */
export function recordHeaderClass(kind: RecordKind): string {
  return `border-t-4 ${RECORD_IDENTITY[kind].edge}`;
}
