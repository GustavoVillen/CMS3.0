// Contexto que consumen los renderers de la Solicitud de Servicio (SS).
//
// La SS es una entidad propia (ver prisma ServiceRequest), no una vista de la OT.
// Igual arrastra la OT de la que cuelga: el formulario imprime el equipo afectado
// y el número de OT, que viven en ella.
//
// Los helpers de dibujo/formato (fmt, val, sanitizePdfText, …) se reusan del
// módulo de OT: son genéricos, no específicos de esa entidad.

import type { ControlledDocMeta } from "../pdf-form-chrome";
import type { FormConfig } from "../tenant-forms-service";

export interface ServiceRequestPdfTenantInfo {
  name?: string;
  logoUrl?: string | null;
  logoUrlLight?: string | null;
}

export interface ServiceRequestPdfContext {
  /** La SS. */
  sr: Record<string, any>;
  /** OT de la que cuelga (siempre existe: workOrderId es NOT NULL). */
  wo: { id: string; workOrderCode: string; title: string | null; status: string } | null;
  /** Equipo afectado — sale del asset de la OT. */
  assetLabel: string;
  assetIsSafetyCritical: boolean;
  vesselName: string | null;
  /** Taller que concurre (Provider resuelto por sr.providerId). */
  providerName: string | null;
  createdByName: string | null;
  createdByFormName: string | null;
  assignedName: string | null;
  assignedFormName: string | null;
  assignedSignatureBuffer: Buffer | null;
  // Firmas de la tramitación (SOLICITA / APRUEBA / AUTORIZA). Se incrustan en la
  // fila del paso que ya ocurrió; los pendientes quedan en blanco para firmar
  // a mano. Sólo se resuelven si el usuario tiene firma cargada (data-URI).
  solicitaSignatureBuffer: Buffer | null;
  apruebaSignatureBuffer: Buffer | null;
  autorizaSignatureBuffer: Buffer | null;
  tenant: ServiceRequestPdfTenantInfo | null;
  tenantSlug: string;
  formMeta: ControlledDocMeta;
  formConfig: FormConfig;
  formLogoBuffer: Buffer | null;
  /** Código impreso del documento = sr.serviceRequestCode. */
  docCode: string;
}
