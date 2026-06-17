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

export type TenantFormType = "WORK_ORDER" | "SERVICE_REQUEST" | "MAINTENANCE_PLAN";

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

// Footer Mercurio actual (hoy hardcodeado en template-mercurio.ts).
const MERCURIO_FOOTER: FormFooterDefaults = {
  preparedBy: "Barlovento Servicios Profesionales",
  reviewedBy: "Asesoría Jurídica",
  approvedBy: "Gerente General",
};

const SERVICE_REQUEST_CONFIG: FormConfig = {
  sections: [
    "header", "deptDate", "equipment", "equipAssigned", "description", "causes",
    "purchaseRequest", "tramitacion", "taller", "hojaRuta", "entregaRecepcion",
    "comments", "generatedBy", "signatures", "communication", "distribution",
  ],
  departments: ["CUBIERTA", "MAQUINAS", "BARCAZA", "OTROS"],
  distribution: ["GGE", "PDT", "JTE", "JOP", "JRH", "JVE", "JCO", "JSE", "JUR", "ADM", "CAP", "JMA"],
  communicationMethods: ["IMPRESO", "EMAIL", "WHAPP", "OTRO"],
  purchaseRequest: ["NORMAL", "AFECTA SEGURIDAD", "AFECTA SERVICIO"],
  labels: {},
};

const EMPTY_CONFIG: FormConfig = {
  sections: [], departments: [], distribution: [], communicationMethods: [], purchaseRequest: [], labels: {},
};

// Defaults por tipo (replican el comportamiento Mercurio actual).
const FORM_DEFAULTS: Record<TenantFormType, FormDefaults> = {
  WORK_ORDER: {
    style: "MERCURIO",
    formCode: "REGI-MAN-02.4",
    title: "Orden Interna de Trabajo",
    revision: 2,
    effectiveFrom: "01.05.2025",
    codePattern: null, // usa el workOrderCode existente
    footer: MERCURIO_FOOTER,
    config: EMPTY_CONFIG,
  },
  SERVICE_REQUEST: {
    style: "MERCURIO",
    formCode: "REGI-LOG-01.3",
    title: "Solicitud de servicios",
    revision: 2,
    effectiveFrom: "01.05.2025",
    codePattern: "SS-{seq:0000}-{vesselShort}-{year}",
    footer: MERCURIO_FOOTER,
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
  const legacyStyle = (type === "WORK_ORDER" || type === "MAINTENANCE_PLAN")
    ? (settings?.workOrderPdfTemplate as string | undefined)
    : undefined;
  const style = (form?.style ?? legacyStyle ?? def.style) as "STANDARD" | "MERCURIO";

  const cfgFooter = (form?.config?.footer && typeof form.config.footer === "object") ? form.config.footer : {};
  const meta: ControlledDocMeta = {
    style,
    formCode: form?.formCode ?? def.formCode,
    title: form?.title ?? def.title,
    revision: form?.revision ?? def.revision,
    effectiveFrom: form?.effectiveFrom ?? def.effectiveFrom,
    preparedBy: cfgFooter.preparedBy ?? settings?.controlledDocPreparedBy ?? def.footer.preparedBy,
    reviewedBy: cfgFooter.reviewedBy ?? settings?.controlledDocReviewedBy ?? def.footer.reviewedBy,
    approvedBy: cfgFooter.approvedBy ?? settings?.controlledDocApprovedBy ?? def.footer.approvedBy,
  };

  const config = mergeConfig(def.config, form?.config);

  // Logo: del formulario > del tenant.
  let logoBuffer: Buffer | null = resolveFormLogo(form?.logoUrl);
  if (!logoBuffer) {
    try { logoBuffer = await resolveTenantLogo(slug, settings?.logoUrl, settings?.logoUrlLight); } catch { /* */ }
  }

  return { meta, config, logoBuffer };
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
