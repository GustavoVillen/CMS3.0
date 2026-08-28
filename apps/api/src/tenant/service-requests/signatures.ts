// Firmas de la TRAMITACION de la Solicitud de Servicio.
//
// Unico lugar donde se decide QUE firma corresponde a cada paso. Lo usan el PDF
// (que la estampa como imagen) y la pantalla del formulario (que la muestra
// sobre la linea de firma): si la regla viviera duplicada, el papel y la
// pantalla podrian atribuir firmas distintas al mismo paso.

import { getPrismaClient } from "../../platform/data/prisma-client";

/** Nombres comparables: sin dobles espacios, sin mayusculas. */
const norm = (s: unknown) =>
  typeof s === "string" ? s.trim().replace(/\s+/g, " ").toLocaleLowerCase() : "";

/**
 * Firma del usuario, y SOLO si es de la persona cuyo nombre lleva el recuadro.
 *
 * El chequeo del nombre no es paranoia: la SS es un documento controlado y
 * estampar la firma de alguien debajo del nombre de otro es atribuirle una
 * conformidad que no dio. Paso de verdad — el paso SOLICITA no guardaba a su
 * usuario y caia a la firma de quien habia creado el registro (SS-112-M01-2026,
 * ago 2026). Sin usuario o con nombre que no coincide, la linea sale en blanco
 * para firmar a mano, que es lo correcto.
 */
export async function signatureUrlOf(
  userId: string | null | undefined,
  nombreImpreso?: string | null,
): Promise<string | null> {
  const prisma = getPrismaClient() as any;
  if (!prisma || !userId) return null;
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { signatureUrl: true, firstName: true, lastName: true, formName: true },
    });
    if (!u) return null;
    // El nombre guardado puede ser el del formulario o "nombre apellido": el
    // desplegable ofrece uno u otro segun lo que tenga cargado el usuario.
    if (nombreImpreso) {
      const candidatos = [u.formName, `${u.firstName ?? ""} ${u.lastName ?? ""}`].map(norm);
      if (!candidatos.includes(norm(nombreImpreso))) return null;
    }
    const url = u.signatureUrl;
    return typeof url === "string" && /^data:image\/[a-z+]+;base64,/i.test(url) ? url : null;
  } catch { return null; }
}

/** La misma firma como Buffer, para el PDF. */
export function signatureUrlToBuffer(signatureUrl: string | null | undefined): Buffer | null {
  if (!signatureUrl || typeof signatureUrl !== "string") return null;
  const m = signatureUrl.match(/^data:image\/[a-z+]+;base64,(.+)$/i);
  if (!m) return null;
  try { return Buffer.from(m[1], "base64"); } catch { return null; }
}

export interface ServiceRequestSignatures {
  solicita: string | null;
  aprueba: string | null;
  autoriza: string | null;
}

/**
 * Las tres firmas de la tramitacion. Cada paso lleva la de quien lo ejecuto, y
 * solo si el paso YA OCURRIO (la SS salio de borrador / aprobadoAt /
 * autorizadoAt).
 *
 * SOLICITA sale de solicitaByUserId. Las SS anteriores a ese campo lo tienen en
 * null: ahi se cae al creador, pero solo si el nombre impreso es el suyo — es lo
 * que evita repetir el bug de la firma ajena.
 */
export async function resolveServiceRequestSignatures(
  sr: {
    status: string;
    solicitaByUserId?: string | null;
    createdByUserId?: string | null;
    aprobadoAt?: Date | string | null;
    aprobadoByUserId?: string | null;
    aprobadoByName?: string | null;
    autorizadoAt?: Date | string | null;
    autorizadoByUserId?: string | null;
    autorizadoByName?: string | null;
  },
  /** Nombre que lleva el recuadro SOLICITA (el corregido, o el del creador). */
  solicitaNombre: string | null,
): Promise<ServiceRequestSignatures> {
  const solicita = sr.status !== "DRAFT"
    ? (await signatureUrlOf(sr.solicitaByUserId, solicitaNombre)
      ?? await signatureUrlOf(sr.createdByUserId, solicitaNombre))
    : null;
  const aprueba  = sr.aprobadoAt   ? await signatureUrlOf(sr.aprobadoByUserId, sr.aprobadoByName)     : null;
  const autoriza = sr.autorizadoAt ? await signatureUrlOf(sr.autorizadoByUserId, sr.autorizadoByName) : null;
  return { solicita, aprueba, autoriza };
}
