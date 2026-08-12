// Contexto y helpers compartidos por las plantillas de PDF de Permiso de Trabajo.
// Renderers puros: reciben el contexto ya cargado, no consultan Prisma.

export { sanitizePdfText } from "../../pms/pdf-helpers";
import type { ControlledDocMeta, FormConfig } from "../../pms/work-order-pdf/shared";
export type { ControlledDocMeta, FormConfig };

export interface PermitGasTest {
  testedAt: Date;
  testedByName: string;
  location: string | null;
  o2Pct: number | null;
  lelPct: number | null;
  h2sPpm: number | null;
  coPpm: number | null;
  verdict: string;
  notes: string | null;
}

export interface PermitParticipant {
  name: string;
  role: string;
}

export interface PermitRecord {
  id: string;
  permitCode: string;
  vesselCode: string;
  type: string;
  status: string;
  location: string;
  description: string;
  plannedStart: Date;
  plannedEnd: Date;
  validFrom: Date | null;
  validTo: Date | null;
  hazardsIdentified: string | null;
  controlMeasures: string | null;
  ppeRequired: string | null;
  details: Record<string, unknown> | null;
  requestedAt: Date | null;
  approvedAt: Date | null;
  activatedAt: Date | null;
  closedAt: Date | null;
  closeNotes: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  createdAt: Date;
  gasTests: PermitGasTest[];
  participants: PermitParticipant[];
}

export interface PermitPdfContext {
  permit: PermitRecord;
  /** Nombre del buque ("DON CHICUETO"), nunca el código. */
  vesselName: string;
  tenantName: string;
  createdByName: string | null;
  approvedByName: string | null;
  closedByName: string | null;
  /** Metadatos del documento controlado del tenant (código, revisión, footer). */
  formMeta: ControlledDocMeta;
  formConfig: FormConfig;
  formLogoBuffer: Buffer | null;
  /** Logo del tenant (plantilla estándar). */
  tenantLogoBuffer: Buffer | null;
  tz: string;
  locale: string;
}

export function val(v: string | null | undefined): string {
  return v?.trim() ? String(v).trim() : "—";
}

/** Igual que `val` pero deja la celda vacía: en el papel se completa a mano. */
export function blank(v: string | null | undefined): string {
  return v?.trim() ? String(v).trim() : "";
}

export const PERMIT_TYPE_LABEL: Record<string, string> = {
  HOT_WORK: "TRABAJO EN CALIENTE",
  ENCLOSED_SPACE_ENTRY: "ENTRADA A ESPACIO CONFINADO",
  WORKING_ALOFT: "TRABAJO EN ALTURA",
  ELECTRICAL_ISOLATION: "AISLAMIENTO ELÉCTRICO",
  COLD_WORK: "TRABAJO EN FRÍO",
  UNDERWATER_WORK: "TRABAJO SUBACUÁTICO",
};

export const PERMIT_STATUS_LABEL: Record<string, string> = {
  DRAFT: "BORRADOR",
  REQUESTED: "SOLICITADO",
  APPROVED: "APROBADO",
  REJECTED: "RECHAZADO",
  ACTIVE: "ACTIVO",
  CLOSED: "CERRADO",
  CANCELLED: "CANCELADO",
};

export const PERMIT_ROLE_LABEL: Record<string, string> = {
  PERFORMER: "Ejecutante",
  FIRE_WATCH: "Vigía de fuego",
  STAND_BY: "Stand-by",
  ATTENDANT: "Atendente",
  SUPERVISOR: "Supervisor",
};

/** Estados en los que el trabajo quedó autorizado por quien aprueba. */
export function isAuthorized(status: string): boolean {
  return status === "APPROVED" || status === "ACTIVE" || status === "CLOSED";
}

/**
 * Datos del permiso ya resueltos para el formulario, compartidos por el PDF y
 * el Word: los dos documentos son el MISMO formulario y no pueden divergir.
 */
export function derivePermitFields(permit: PermitRecord) {
  // Ventana autorizada: al aprobar, el sistema cae a la ventana planificada.
  const validFrom = permit.validFrom ?? permit.plannedStart;
  const validTo   = permit.validTo   ?? permit.plannedEnd;

  // Quién ejecuta y quién supervisa. Los roles de apoyo (vigía, stand-by,
  // atendente) van con los ejecutantes, aclarando el rol: el papel no tiene
  // recuadro propio para ellos y perderlos sería perder información real.
  const supervisors = permit.participants.filter(p => p.role === "SUPERVISOR").map(p => p.name);
  const performers  = permit.participants
    .filter(p => p.role !== "SUPERVISOR")
    .map(p => (p.role === "PERFORMER" ? p.name : `${p.name} (${PERMIT_ROLE_LABEL[p.role] ?? p.role})`));

  const lastGas: PermitGasTest | null = permit.gasTests[0] ?? null; // vienen desc por testedAt
  const gasTesters = Array.from(new Set(permit.gasTests.map(g => g.testedByName).filter(Boolean)));

  /** Lectura del último gas test para una fila del formulario. */
  const gasReading = (key: "o2" | "lel" | "h2s" | "co" | null): string => {
    if (!key || !lastGas) return "";
    const v = key === "o2" ? lastGas.o2Pct : key === "lel" ? lastGas.lelPct : key === "h2s" ? lastGas.h2sPpm : lastGas.coPpm;
    if (v === null || v === undefined) return "";
    return key === "o2" ? v.toFixed(1) : key === "lel" ? v.toFixed(2) : v.toFixed(0);
  };

  return { validFrom, validTo, supervisors, performers, lastGas, gasTesters, gasReading };
}
