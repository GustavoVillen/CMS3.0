// Resolver de formularios controlados por tenant + generador de codigo.
//
// `TenantForm` es la fuente de verdad de TODAS las diferencias del formulario por
// tenant (numero, revision, vigencia, logo, secciones, opciones, footer, patron
// de codigo). Cuando no hay fila, se cae a defaults en codigo que replican EXACTO
// el comportamiento Mercurio actual (cero cambio visual).
//
// Aislamiento multitenant: todo se resuelve y filtra por el `tenantId` derivado
// del slug de la sesion — nunca desde input del cliente. La autonumeracion vive
// por (tenantId, type) y se reserva de forma atomica dentro de una transaccion.

import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { resolveTenantLogo } from "./pdf-helpers";
import type { ControlledDocMeta } from "./pdf-form-chrome";

export type TenantFormType =
  | "WORK_ORDER" | "SERVICE_REQUEST" | "MAINTENANCE_PLAN" | "DEFERRAL"
  // Un formulario controlado por tipo de permiso de trabajo (REGI-SYE-01.4..01.9).
  | "PERMIT_ENCLOSED_SPACE" | "PERMIT_HOT_WORK" | "PERMIT_COLD_WORK"
  | "PERMIT_ALOFT" | "PERMIT_ELECTRICAL" | "PERMIT_UNDERWATER";

const PUBLIC_DIR = join(process.cwd(), "..", "web-modern", "public");

// ── Config de listas/etiquetas/secciones del formulario ──────────────────────
export interface FormConfig {
  /** Ids de secciones a incluir, en orden. */
  sections: string[];
  /** Opciones de listas (override de defaults). */
  departments: string[];
  distribution: string[];
  communicationMethods: string[];
  purchaseRequest: string[];
  /** Etiquetas por sectionId (override de titulos por defecto). */
  labels: Record<string, string>;
}

interface FormFooterDefaults { preparedBy: string; reviewedBy: string; approvedBy: string }

interface FormDefaults {
  style: "STANDARD" | "MERCURIO";
  formCode: string;
  title: string;
  revision: number;
  effectiveFrom: string;
  codePattern: string | null;
  footer: FormFooterDefaults;
  config: FormConfig;
}

// Footer Mercurio genérico (fallback para formularios sin uno propio).
const MERCURIO_FOOTER: FormFooterDefaults = {
  preparedBy: "Departamento Tecnico Mercurio",
  reviewedBy: "Gerente Mantenimiento",
  approvedBy: "Gerencia General",
};

// Cada documento controlado trae SU pie de firmas — no son intercambiables.
// Literal de los formularios del cliente.
const WORK_ORDER_FOOTER: FormFooterDefaults = {        // REGI-OPE-26.3
  preparedBy: "Mercurio Group",
  reviewedBy: "Persona Designada en Tierra",
  approvedBy: "Gerente General",
};
const SERVICE_REQUEST_FOOTER: FormFooterDefaults = {   // REGI-LOG-01.3
  preparedBy: "Mercurio Group",
  reviewedBy: "Asesoria Juridica",
  approvedBy: "Gerente General",
};
const PERMIT_FOOTER: FormFooterDefaults = {            // REGI-SYE-01.4 .. 01.9
  preparedBy: "Mercurio Group",
  reviewedBy: "Persona Designada en Tierra",
  approvedBy: "Gerente General",
};

// Orden e identificadores replican el papel REGI-LOG-01.3 (ver SS-74-M01-2026).
// `workOrderRef` es el único agregado: imprime la OT de la que cuelga la SS —
// toda SS nace de una OT y sin el número no se puede rastrear el servicio.
const SERVICE_REQUEST_CONFIG: FormConfig = {
  sections: [
    "header", "deptDate", "assignedTo", "equipment", "workOrderRef",
    "description", "causes", "purchaseRequest", "tramitacion", "hojaRuta",
    "taller", "entregaRecepcion", "comments", "signatures",
    "communication", "distribution",
  ],
  // Recuadro ASIGNADO A del papel. PROVEEDOR no está en el formulario impreso.
  departments: ["CUBIERTA", "MAQUINAS", "BARCAZA", "OTROS"],
  distribution: ["GGE", "PDT", "JTE", "JOP", "JRH", "JVE", "JCO", "JSE", "JUR", "ADM", "CAP", "JMA"],
  communicationMethods: ["IMPRESO", "EMAIL", "WHAPP", "OTRO"],
  purchaseRequest: ["NORMAL", "AFECTA SEGURIDAD", "AFECTA SERVICIO"],
  labels: {},
};

const EMPTY_CONFIG: FormConfig = {
  sections: [], departments: [], distribution: [], communicationMethods: [], purchaseRequest: [], labels: {},
};

// ── Permisos de trabajo (REGI-SYE-01.4 .. 01.9) ──────────────────────────────
// El orden de `sections` replica el papel de cada formulario. Los ids los
// resuelve el catalogo de secciones de permits/permit-pdf/template-mercurio.ts.
// `departments` es la lista del recuadro DEPARTAMENTO del encabezado.
const PERMIT_DEPARTMENTS = ["CUBIERTA", "MAQUINAS", "SERVICIOS", "OTRO"];

function permitConfig(sections: string[]): FormConfig {
  return { sections, departments: PERMIT_DEPARTMENTS, distribution: [], communicationMethods: [], purchaseRequest: [], labels: {} };
}

// REGI-SYE-01.4 — formato distinto al resto: texto tipo IMO con secciones 1/2/3,
// notas al pie y registro de ingresos, sin recuadro de resolucion ni de EPP.
const PERMIT_ENCLOSED_SPACE_SECTIONS = [
  "vesselHeader", "esGeneral", "esSection1", "esSection2", "esSignatures",
  "esSection3", "esNotes", "esEntryLog", "generatedBy",
];
const PERMIT_HOT_WORK_SECTIONS = [
  "vesselHeader", "workKindHotCold", "motiveZone", "adjacentAreas", "sketch",
  "performers", "supervisors", "gasTesters", "gasEquipment", "gasResults",
  "considerations", "ppe", "resolution", "validity", "specialComments",
  "completion", "additionalComments", "generatedBy",
];
const PERMIT_COLD_WORK_SECTIONS = [
  "vesselHeader", "motiveZone", "adjacentAreas",
  "performers", "supervisors", "gasTesters", "gasEquipment",
  "ppe", "resolution", "validity", "specialComments",
  "completion", "additionalComments", "generatedBy",
];
const PERMIT_ALOFT_SECTIONS = [
  "vesselHeaderShort", "shipStatus", "workKindMaint", "motiveHeight", "tools", "sketch",
  "performers", "supervisors", "considerations", "ppe", "resolution", "validity",
  "specialComments", "completion", "additionalComments", "generatedBy",
];
const PERMIT_ELECTRICAL_SECTIONS = [
  "vesselHeaderShort", "shipStatus", "affectedEquipment", "workKindMaint", "motiveHeight",
  "tools", "sketch", "performers", "supervisors", "ppe", "resolution", "validity",
  "specialComments", "completion", "additionalComments", "generatedBy",
];
const PERMIT_UNDERWATER_SECTIONS = [
  "vesselHeaderShort", "shipStatus", "affectedEquipment", "sketch",
  "performers", "supervisors", "considerations", "ppe", "resolution", "validity",
  "specialComments", "completion", "additionalComments", "generatedBy",
];

// Formulario de OT REGI-OPE-26.3 "Orden de trabajo" (rev 0, 29.12.2025).
// El orden de `sections` replica el papel. Las listas de opciones de los
// recuadros (SOLICITADO POR / ASIGNADO A / TIPO / SISTEMA / autorizaciones)
// son enums del schema, no config: cambiarlas es un cambio de dominio.
// `departments` acá es la lista del recuadro DEPARTAMENTO del encabezado.
const WORK_ORDER_CONFIG: FormConfig = {
  sections: [
    "header", "requestedBy", "assignedTo", "priorityKindSystem", "permits",
    "request", "task", "spares", "materials", "schedule", "completion",
    "pending", "risk", "signatures", "riskAnnex",
  ],
  departments: ["CUBIERTA", "MAQUINAS", "BARCAZA", "PROVEEDOR", "OTROS"],
  distribution: [],
  communicationMethods: [],
  purchaseRequest: [],
  labels: {},
};

// Defaults por tipo (replican el comportamiento Mercurio actual).
const FORM_DEFAULTS: Record<TenantFormType, FormDefaults> = {
  // Hasta jul-2026 este default apuntaba a REGI-LOG-01.3 "Solicitud de
  // Servicios" — el formulario de la SS, no el de la OT. Era el mismo
  // malentendido OT=SS: son dos documentos distintos del cliente.
  WORK_ORDER: {
    style: "MERCURIO",
    formCode: "REGI-OPE-26.3",
    title: "Orden de trabajo",
    revision: 0,
    effectiveFrom: "29.12.2025",
    codePattern: null, // usa el workOrderCode existente
    footer: WORK_ORDER_FOOTER,
    config: WORK_ORDER_CONFIG,
  },
  SERVICE_REQUEST: {
    style: "MERCURIO",
    formCode: "REGI-LOG-01.3",
    title: "Solicitud de servicios",
    revision: 2,
    effectiveFrom: "01.05.2025",
    // El código lo genera el service al crear la SS, con el formato del papel
    // (SS-<seq>-<BUQUE>-<AÑO>, correlativo por buque y año). Este patrón emitía
    // un número distinto al imprimir y con otro padding (SS-0074-M01-2026).
    codePattern: null,
    footer: SERVICE_REQUEST_FOOTER,
    config: SERVICE_REQUEST_CONFIG,
  },
  // El Plan de mantenimiento no emite correlativo propio: el "PM No." es el
  // taskCode del plan. Style default STANDARD → solo los tenants con estilo
  // Mercurio (workOrderPdfTemplate=MERCURIO) reciben el documento controlado.
  MAINTENANCE_PLAN: {
    style: "STANDARD",
    formCode: "",
    title: "PLAN DE MANTENIMIENTO",
    revision: 2,
    effectiveFrom: "01.05.2025",
    codePattern: null,
    footer: MERCURIO_FOOTER,
    config: EMPTY_CONFIG,
  },
  // El diferimiento ya emite su propio código (deferralCode "APL-..."), por eso
  // codePattern null. Sigue el estilo del tenant (legacyStyle): Mercurio recibe
  // el documento controlado "INFORME DE DIFERIMIENTO".
  DEFERRAL: {
    style: "STANDARD",
    formCode: "",
    title: "INFORME DE DIFERIMIENTO",
    revision: 2,
    effectiveFrom: "01.05.2025",
    codePattern: null,
    footer: MERCURIO_FOOTER,
    config: EMPTY_CONFIG,
  },

  // Permisos de trabajo — rev 3, vigentes desde 29.12.2025. Style STANDARD por
  // defecto: solo los tenants con estilo de documento Mercurio (o con fila
  // TenantForm propia) reciben el formulario controlado; el resto sigue con el
  // PDF generico de permisos.
  // El codigo del documento es el permitCode que ya emite permits-service.
  PERMIT_ENCLOSED_SPACE: {
    style: "STANDARD",
    formCode: "REGI-SYE-01.4",
    title: "Ingreso a espacio confinado",
    revision: 3,
    effectiveFrom: "29.12.2025",
    codePattern: null,
    footer: PERMIT_FOOTER,
    config: permitConfig(PERMIT_ENCLOSED_SPACE_SECTIONS),
  },
  PERMIT_HOT_WORK: {
    style: "STANDARD",
    formCode: "REGI-SYE-01.5",
    title: "Trabajo en caliente",
    revision: 3,
    effectiveFrom: "29.12.2025",
    codePattern: null,
    footer: PERMIT_FOOTER,
    config: permitConfig(PERMIT_HOT_WORK_SECTIONS),
  },
  PERMIT_COLD_WORK: {
    style: "STANDARD",
    formCode: "REGI-SYE-01.6",
    title: "Trabajo en frio",
    revision: 3,
    effectiveFrom: "29.12.2025",
    codePattern: null,
    footer: PERMIT_FOOTER,
    config: permitConfig(PERMIT_COLD_WORK_SECTIONS),
  },
  PERMIT_ALOFT: {
    style: "STANDARD",
    formCode: "REGI-SYE-01.7",
    title: "Permiso de Trabajo en Altura",
    revision: 3,
    effectiveFrom: "29.12.2025",
    codePattern: null,
    footer: PERMIT_FOOTER,
    config: permitConfig(PERMIT_ALOFT_SECTIONS),
  },
  PERMIT_ELECTRICAL: {
    style: "STANDARD",
    formCode: "REGI-SYE-01.8",
    title: "Permiso de Trabajo en Electrico",
    revision: 3,
    effectiveFrom: "29.12.2025",
    codePattern: null,
    footer: PERMIT_FOOTER,
    config: permitConfig(PERMIT_ELECTRICAL_SECTIONS),
  },
  PERMIT_UNDERWATER: {
    style: "STANDARD",
    formCode: "REGI-SYE-01.9",
    title: "Permiso de trabajo subaqua",
    revision: 3,
    effectiveFrom: "29.12.2025",
    codePattern: null,
    footer: PERMIT_FOOTER,
    config: permitConfig(PERMIT_UNDERWATER_SECTIONS),
  },
};

/** Formulario controlado que corresponde a cada tipo de permiso de trabajo. */
export const PERMIT_FORM_TYPE_BY_PERMIT_TYPE: Record<string, TenantFormType> = {
  ENCLOSED_SPACE_ENTRY: "PERMIT_ENCLOSED_SPACE",
  HOT_WORK:             "PERMIT_HOT_WORK",
  COLD_WORK:            "PERMIT_COLD_WORK",
  WORKING_ALOFT:        "PERMIT_ALOFT",
  ELECTRICAL_ISOLATION: "PERMIT_ELECTRICAL",
  UNDERWATER_WORK:      "PERMIT_UNDERWATER",
};

export interface ResolvedTenantForm {
  meta: ControlledDocMeta;
  config: FormConfig;
  logoBuffer: Buffer | null;
}

/** Lee un logo propio del formulario desde public/ por su `logoUrl` (ej "/LogoMercurio.png"). */
function resolveFormLogo(logoUrl: string | null | undefined): Buffer | null {
  if (!logoUrl) return null;
  try {
    const file = join(PUBLIC_DIR, basename(logoUrl));
    if (existsSync(file)) return readFileSync(file);
  } catch { /* non-blocking */ }
  return null;
}

function mergeConfig(def: FormConfig, override: any): FormConfig {
  if (!override || typeof override !== "object") return def;
  return {
    sections: Array.isArray(override.sections) && override.sections.length ? override.sections : def.sections,
    departments: Array.isArray(override.departments) && override.departments.length ? override.departments : def.departments,
    distribution: Array.isArray(override.distribution) && override.distribution.length ? override.distribution : def.distribution,
    communicationMethods: Array.isArray(override.communicationMethods) && override.communicationMethods.length ? override.communicationMethods : def.communicationMethods,
    purchaseRequest: Array.isArray(override.purchaseRequest) && override.purchaseRequest.length ? override.purchaseRequest : def.purchaseRequest,
    labels: { ...def.labels, ...(override.labels && typeof override.labels === "object" ? override.labels : {}) },
  };
}

/**
 * Resuelve la definicion del formulario para un tenant. Si no hay fila TenantForm,
 * cae a los defaults (estilo Mercurio actual). Aislado por slug → tenantId.
 */
export async function resolveTenantForm(slug: string, type: TenantFormType): Promise<ResolvedTenantForm> {
  const def = FORM_DEFAULTS[type];
  const prisma = getPrismaClient();

  if (!prisma) {
    return {
      meta: { style: def.style, formCode: def.formCode, title: def.title, revision: def.revision,
        effectiveFrom: def.effectiveFrom, preparedBy: def.footer.preparedBy,
        reviewedBy: def.footer.reviewedBy, approvedBy: def.footer.approvedBy },
      config: def.config,
      logoBuffer: null,
    };
  }

  let form: any = null;
  let settings: any = null;
  try {
    const tenant = await (prisma as any).tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        settings: {
          select: {
            displayName: true, logoUrl: true, logoUrlLight: true, workOrderPdfTemplate: true,
            controlledDocPreparedBy: true, controlledDocReviewedBy: true, controlledDocApprovedBy: true,
          },
        },
      },
    });
    settings = tenant?.settings ?? null;
    if (tenant) {
      form = await (prisma as any).tenantForm.findUnique({
        where: { tenantId_type: { tenantId: tenant.id, type } },
      });
      if (form && form.enabled === false) form = null;
    }
  } catch { /* non-blocking → defaults */ }

  // Estilo: fila > (legacy enum del tenant) > default.
  // El Plan de mantenimiento sigue el estilo de documento del tenant (mismo
  // signal que la OT): así un tenant Mercurio recibe el formato controlado.
  const rawLegacy = settings?.workOrderPdfTemplate as string | undefined;
  const legacyStyle = (type === "WORK_ORDER" || type === "MAINTENANCE_PLAN" || type === "DEFERRAL")
    ? rawLegacy
    // Los permisos siguen el mismo signal, pero normalizado: MERCURIO_OT es una
    // plantilla de OT, no un FormStyle — para los permisos cualquier variante
    // Mercurio significa "documento controlado".
    : type.startsWith("PERMIT_")
      ? (rawLegacy?.startsWith("MERCURIO") ? "MERCURIO" : rawLegacy)
      : undefined;
  const style = (form?.style ?? legacyStyle ?? def.style) as "STANDARD" | "MERCURIO";

  const cfgFooter = (form?.config?.footer && typeof form.config.footer === "object") ? form.config.footer : {};
  // Los permisos de trabajo traen impreso SU pie de firmas (Elaborado: Mercurio
  // Group / Revisado: Persona Designada en Tierra / Aprobado: Gerente General):
  // el pie genérico del tenant no debe pisarlo. La fila TenantForm sí puede.
  const tenantFooter = type.startsWith("PERMIT_")
    ? { preparedBy: undefined, reviewedBy: undefined, approvedBy: undefined }
    : {
      preparedBy: settings?.controlledDocPreparedBy as string | undefined,
      reviewedBy: settings?.controlledDocReviewedBy as string | undefined,
      approvedBy: settings?.controlledDocApprovedBy as string | undefined,
    };
  const meta: ControlledDocMeta = {
    style,
    formCode: form?.formCode ?? def.formCode,
    title: form?.title ?? def.title,
    revision: form?.revision ?? def.revision,
    effectiveFrom: form?.effectiveFrom ?? def.effectiveFrom,
    preparedBy: cfgFooter.preparedBy ?? tenantFooter.preparedBy ?? def.footer.preparedBy,
    reviewedBy: cfgFooter.reviewedBy ?? tenantFooter.reviewedBy ?? def.footer.reviewedBy,
    approvedBy: cfgFooter.approvedBy ?? tenantFooter.approvedBy ?? def.footer.approvedBy,
  };

  const config = mergeConfig(def.config, form?.config);

  // Logo: del formulario > del tenant.
  let logoBuffer: Buffer | null = resolveFormLogo(form?.logoUrl);
  if (!logoBuffer) {
    try { logoBuffer = await resolveTenantLogo(slug, settings?.logoUrl, settings?.logoUrlLight); } catch { /* */ }
  }

  return { meta, config, logoBuffer };
}

// ── Registros operativos sin fila TenantForm ─────────────────────────────────
// Un registro del SGS (checklist firmado, inspección ejecutada) también es
// documento controlado, pero su número y su título no viven en TenantForm: los
// trae la plantilla que se ejecutó — el `code`/`title` de la plantilla de
// inspección, o el nombre del checklist cuando arranca con el código del
// formulario ("REGI-OPE-3.3 — Lista previa al zarpe"). Esto arma el mismo
// chrome (logo, empresa y pie Elaborado/Revisado/Aprobado) para esos casos,
// sin inventar un tipo de formulario nuevo por cada plantilla.

export interface ControlledDocChrome {
  meta: ControlledDocMeta;
  logoBuffer: Buffer | null;
  tenantName: string;
}

/**
 * Separa "REGI-OPE-3.3 — Lista previa al zarpe" en código + título. Si el texto
 * no arranca con un código de formulario, todo el texto es el título.
 */
export function splitFormCodeFromTitle(raw: string | null | undefined): { formCode: string; title: string } {
  const text = String(raw ?? "").trim();
  const m = text.match(/^([A-Za-z]{2,6}-[A-Za-z]{2,6}-[\d.]+)\s*[-–—:.]?\s*(.*)$/);
  if (!m || !m[2]?.trim()) return { formCode: "", title: text };
  return { formCode: m[1].toUpperCase(), title: m[2].trim() };
}

/** Chrome de documento controlado para un registro que no tiene fila TenantForm. */
export async function resolveControlledDocChrome(
  slug: string,
  docMeta: { formCode?: string | null; title: string; revision?: number | string | null; effectiveFrom?: string | null },
): Promise<ControlledDocChrome> {
  let settings: any = null;
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const tenant = await (prisma as any).tenant.findUnique({
        where: { slug },
        select: {
          settings: {
            select: {
              displayName: true, logoUrl: true, logoUrlLight: true, workOrderPdfTemplate: true,
              controlledDocPreparedBy: true, controlledDocReviewedBy: true, controlledDocApprovedBy: true,
            },
          },
        },
      });
      settings = tenant?.settings ?? null;
    } catch { /* non-blocking → defaults */ }
  }

  let logoBuffer: Buffer | null = null;
  try { logoBuffer = await resolveTenantLogo(slug, settings?.logoUrl, settings?.logoUrlLight); } catch { /* */ }

  const meta: ControlledDocMeta = {
    style: String(settings?.workOrderPdfTemplate ?? "").startsWith("MERCURIO") ? "MERCURIO" : "STANDARD",
    formCode: (docMeta.formCode ?? "").trim(),
    title: docMeta.title.trim(),
    revision: docMeta.revision ?? 1,
    effectiveFrom: (docMeta.effectiveFrom ?? "").trim(),
    preparedBy: settings?.controlledDocPreparedBy ?? MERCURIO_FOOTER.preparedBy,
    reviewedBy: settings?.controlledDocReviewedBy ?? MERCURIO_FOOTER.reviewedBy,
    approvedBy: settings?.controlledDocApprovedBy ?? MERCURIO_FOOTER.approvedBy,
  };

  return { meta, logoBuffer, tenantName: settings?.displayName ?? slug };
}

// ── Generacion de codigo (idempotente + atomica por tenant) ──────────────────
function renderCodePattern(pattern: string, vars: { seq: number; vesselShort: string; year: number }): string {
  return pattern.replace(/\{(\w+)(?::([0#]+))?\}/g, (_m, key: string, pad?: string) => {
    if (key === "seq") {
      const s = String(vars.seq);
      return pad ? s.padStart(pad.length, "0") : s;
    }
    if (key === "vesselShort" || key === "vessel") return vars.vesselShort;
    if (key === "year") return String(vars.year);
    return _m;
  });
}

export interface FormCodeSource {
  sourceType: string; // "WORK_ORDER"
  sourceId: string;
  vesselCode: string;
  fallbackCode: string; // codigo natural (ej workOrderCode) si no hay patron
}

/**
 * Devuelve el codigo del documento para una fuente concreta. Idempotente: si ya
 * se emitio, devuelve el mismo codigo (reimpresiones estables, sin consumir
 * secuencia). La reserva del correlativo es atomica dentro de una transaccion.
 */
export async function issueFormCode(slug: string, type: TenantFormType, source: FormCodeSource): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) return source.fallbackCode;

  const def = FORM_DEFAULTS[type];
  const tenant = await (prisma as any).tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) return source.fallbackCode;
  const tenantId: string = tenant.id;

  const findExisting = () => (prisma as any).formDocument.findUnique({
    where: { tenantId_type_sourceId: { tenantId, type, sourceId: source.sourceId } },
    select: { code: true },
  });

  const existing = await findExisting();
  if (existing) return existing.code;

  const vesselShort = (source.vesselCode || "").trim().toUpperCase();
  const year = new Date().getFullYear();

  try {
    return await (prisma as any).$transaction(async (tx: any) => {
      const again = await tx.formDocument.findUnique({
        where: { tenantId_type_sourceId: { tenantId, type, sourceId: source.sourceId } },
        select: { code: true },
      });
      if (again) return again.code;

      // Reserva atomica del correlativo (crea la fila si el tenant aun no la tiene).
      const form = await tx.tenantForm.upsert({
        where: { tenantId_type: { tenantId, type } },
        create: {
          tenantId, type, style: def.style, formCode: def.formCode, title: def.title,
          revision: def.revision, effectiveFrom: def.effectiveFrom, codePattern: def.codePattern,
          codeSeq: 1,
        },
        update: { codeSeq: { increment: 1 } },
        select: { codeSeq: true, codePattern: true },
      });

      const pattern = form.codePattern ?? def.codePattern;
      if (!pattern) return source.fallbackCode;

      const code = renderCodePattern(pattern, { seq: form.codeSeq, vesselShort, year });
      await tx.formDocument.create({
        data: { tenantId, type, sourceType: source.sourceType, sourceId: source.sourceId, code, seq: form.codeSeq },
      });
      return code;
    });
  } catch {
    // Race: otra emision concurrente creo el FormDocument. Releer y devolver.
    const after = await findExisting();
    return after?.code ?? source.fallbackCode;
  }
}
