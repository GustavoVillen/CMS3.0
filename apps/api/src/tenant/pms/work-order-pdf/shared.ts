// Shared primitives for Work Order PDF templates.
// Both STANDARD and MERCURIO templates depend on this module.
// Pure helpers — no Prisma, no I/O.

export { sanitizePdfText, resolveTenantLogo, LOGO_PATH } from "../pdf-helpers";
import type { ControlledDocMeta } from "../pdf-form-chrome";
import type { FormConfig } from "../tenant-forms-service";
export type { ControlledDocMeta, FormConfig };

// ── Format helpers ───────────────────────────────────────────────────────────

export function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  // Las fechas SIN hora (apertura, vencimiento, jornadas: lo que el usuario
  // eligió en un calendario) se guardan como medianoche UTC. Formatearlas en
  // hora local las corría un día para atrás y el papel salía con la fecha
  // equivocada. Cuando la hora es 00:00 UTC se formatea en UTC; los sellos de
  // tiempo reales (cierre, firmas) siguen en hora local, que es lo correcto.
  const esFechaSola =
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  return date.toLocaleDateString("es-AR", esFechaSola ? { timeZone: "UTC" } : undefined);
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-AR");
}

export function val(v: string | null | undefined): string {
  return (v?.trim() || "—").replace(/ð/g, "").replace(/[☐☑☒□■✓✔✘]/g, "[ ]");
}

// ── Label translators ────────────────────────────────────────────────────────

export function typeLabel(t: string): string {
  if (t === "INSPECTION")  return "Inspección";
  if (t === "CORRECTIVE")  return "Reparación / Correctivo";
  return "Mantenimiento Preventivo";
}

export function statusLabel(s: string): string {
  const m: Record<string, string> = {
    PLANNED: "Planificada", IN_PROGRESS: "En ejecución", ON_HOLD: "Postergada",
    CLOSED: "Cerrada", CANCELLED: "Cancelada", DEFERRED: "Diferida",
  };
  return m[s] ?? s;
}

export function priorityLabel(p: string): string {
  const m: Record<string, string> = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica" };
  return m[p] ?? p;
}

export function riskLabel(r: string | null | undefined): string {
  if (!r) return "—";
  const m: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Crítico" };
  return m[r] ?? r;
}

export function woResultLabel(r: string | null | undefined): string {
  if (!r) return "—";
  return r === "SATISFACTORY" ? "Satisfactorio" : "Con deficiencias";
}

export function departmentLabel(d: string | null | undefined): string {
  if (!d) return "—";
  const m: Record<string, string> = {
    CUBIERTA: "Cubierta", MAQUINAS: "Máquinas", BARCAZA: "Barcaza",
    PROVEEDOR: "Proveedor", OTROS: "Otros",
  };
  return m[d] ?? d;
}

/** Área / responsable como texto; cuando es PROVEEDOR agrega el nombre del proveedor. */
export function areaText(wo: { department?: string | null; providerName?: string | null }): string {
  if (!wo.department) return "";
  const base = departmentLabel(wo.department);
  return wo.department === "PROVEEDOR" && wo.providerName ? `${base} — ${wo.providerName}` : base;
}

export function motivoFromType(type: string): string {
  if (type === "CORRECTIVE")  return "FALLA";
  if (type === "INSPECTION")  return "INSPECCION";
  if (type === "PREVENTIVE")  return "PLANIFICADO";
  return "OTRO";
}

// ── Color palettes ───────────────────────────────────────────────────────────

export const STATUS_COLOR: Record<string, string> = {
  PLANNED: "#0369a1", IN_PROGRESS: "#b45309", ON_HOLD: "#7c3aed",
  CLOSED: "#166534", CANCELLED: "#991b1b", DEFERRED: "#374151",
};

export const PRIORITY_COLOR: Record<string, string> = {
  LOW: "#16a34a", MEDIUM: "#b45309", HIGH: "#b91c1c", CRITICAL: "#7f1d1d",
};

// ── Page layout constants (A4 portrait) ──────────────────────────────────────

export const PAGE_W       = 595.28;
export const PAGE_H       = 841.89;
export const CM           = 72 / 2.54;

// ── Context shape consumed by templates ──────────────────────────────────────

export interface WorkOrderPdfTenantInfo {
  name?: string;
  logoUrl?: string | null;
  logoUrlLight?: string | null;
}

export interface WorkOrderSpareUsage {
  spareName: string;
  quantity: number;
  unit: string;
}

/** Repuesto o material PLANIFICADO (recuadros del formulario REGI-OPE-26.3). */
export interface WorkOrderPlannedItem {
  kind: "SPARE" | "MATERIAL";
  description: string;
  quantity: number;
  unit: string;
}

/** Ejecución programada del trabajo (filas de PROGRAMACION DE TRABAJO). */
export interface WorkOrderScheduleRow {
  date: Date | null;
  technician: string;
  place: string;
  company: string;
  time: string;
}

export interface WorkOrderProgressPhoto {
  id: string;
  fileUrl: string;
  text: string | null;
  createdAt: Date;
  /** Buffer del archivo leído del disk para embed directo en el PDF. */
  buffer: Buffer | null;
  /** MIME real del archivo (image/jpeg, image/png, image/webp, etc.). */
  mimeType: string | null;
}

export interface WorkOrderPdfContext {
  /** Full WO record (typed loosely; templates use `(wo as any).field` for optional cols). */
  wo: any;
  /** Resolved asset display name or fallback. */
  assetLabel: string;
  /** Nombre de la embarcación (Vessel.name); fallback al code si no se resuelve. */
  vesselName: string | null;
  /** ISM Code 10.3 — flag de seguridad del activo. */
  assetIsSafetyCritical: boolean;
  /** Display name for assigned user (firstName + lastName) or null. */
  assignedName: string | null;
  /** Nombre configurado para formularios del usuario asignado (o null). */
  assignedFormName?: string | null;
  /** Firma del usuario asignado (imagen decodificada) para la caja del responsable. */
  assignedSignatureBuffer?: Buffer | null;
  /** Display name (or email fallback) for the user that created the WO. */
  createdByName: string | null;
  /** Nombre para formularios del creador (= Solicita) y firmas de tramitación. */
  createdByFormName?: string | null;
  solicitaSignatureBuffer?: Buffer | null;
  apruebaSignatureBuffer?: Buffer | null;
  autorizaSignatureBuffer?: Buffer | null;
  /** Firma de quien cerró la OT (= "Cierra la SS"); solo si la OT está CLOSED. */
  cierraSignatureBuffer?: Buffer | null;
  /** Tenant settings snapshot. */
  tenant: WorkOrderPdfTenantInfo | null;
  /** Resolved logo image buffer or null. */
  tenantLogoBuffer: Buffer | null;
  /** Spare usages reconstructed from stock movements. */
  spareUsages: WorkOrderSpareUsage[];
  /** Fotos de avances de trabajo (progress notes con kind=PHOTO). */
  progressPhotos: WorkOrderProgressPhoto[];
  /** Todos los avances (TEXT/PHOTO/VIDEO/AUDIO) para el listado del PDF. */
  progressNotes: { kind: string; text: string | null; createdAt: Date }[];
  /** Ejes de la matriz de riesgo, tomados del plan de mantenimiento vinculado. */
  riskProbability: string | null;
  riskConsequence: string | null;
  // ── Formulario REGI-OPE-26.3 ──
  /** REPUESTOS / MATERIALES planificados (WorkOrderItem). */
  plannedItems: WorkOrderPlannedItem[];
  /** Filas de PROGRAMACION DE TRABAJO, derivadas de los WorkLog de la OT. */
  scheduleRows: WorkOrderScheduleRow[];
  /** Tipos de permiso de trabajo vinculados (recuadro de autorizaciones). */
  permitTypes: string[];
  /** Códigos de las SS abiertas desde esta OT (celda "NRO DE SS/SC"). */
  serviceRequestCodes: string[];
  /**
   * Talleres a los que se les pidió el trabajo: el proveedor de la OT y los de
   * sus SS, sin repetir. El papel tiene que decir QUIÉN lo hace, no un id.
   */
  providerNames: string[];
  /** Item del PDM: taskCode de los planes vinculados, separados por " / ". */
  planTaskCode: string | null;
  /** Selected template key for this tenant ("STANDARD" | "MERCURIO" | future…). */
  templateKey: string;
  /** Tenant slug (used by some templates as fallback header text). */
  tenantSlug: string;
  /** Metadatos del documento controlado (numero, revision, footer…) resueltos por tenant. */
  formMeta: ControlledDocMeta;
  /** Config de secciones/opciones/etiquetas del formulario resuelta por tenant. */
  formConfig: FormConfig;
  /** Logo propio del formulario (fallback al logo del tenant). */
  formLogoBuffer: Buffer | null;
  /** Codigo del documento emitido (ej "SS-0001-DONCHI-2026"). Solo para formularios con patron. */
  docCode?: string;
}
