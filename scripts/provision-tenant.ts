// Provisiona un tenant COMPLETO (idempotente): Tenant + Settings + formularios
// controlados (WORK_ORDER REGI-MAN-02.3, SERVICE_REQUEST REGI-LOG-01.3) + usuario
// admin. Pensado para correr en produccion contra la DATABASE_URL de prod.
//
// Uso:
//   DATABASE_URL=<prod> \
//   TENANT_SLUG=mercurio TENANT_NAME="Mercurio Naviera" \
//   ADMIN_EMAIL=admin@mercurio.com ADMIN_PASSWORD='CambiaEsto123' \
//   TZ_NAME=America/Asuncion CURRENCY=PYG \
//   npx tsx scripts/provision-tenant.ts
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { createPlatformTenant, getPlatformTenant } from "../apps/api/src/platform/tenants/platform-tenants-service";
import { createPlatformTenantUser } from "../apps/api/src/platform/tenants/platform-tenant-users-service";

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) } as any);

const SLUG     = (process.env.TENANT_SLUG || "mercurio").toLowerCase();
const NAME     = process.env.TENANT_NAME || "Mercurio Naviera";
const EMAIL    = process.env.ADMIN_EMAIL || "admin@mercurio.com";

// Sin default: este script crea un TENANT_ADMIN en producción. Un fallback fijo
// significa que olvidarse la variable deja una cuenta con la contraseña escrita
// en el repositorio, y el script termina sin avisar nada.
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD || PASSWORD.length < 12) {
  throw new Error(
    "ADMIN_PASSWORD es obligatorio (mínimo 12 caracteres). Ejemplo:\n" +
    "  ADMIN_PASSWORD='<contraseña-fuerte>' npx tsx scripts/provision-tenant.ts",
  );
}
const TZ       = process.env.TZ_NAME || "America/Asuncion";
const CURRENCY = process.env.CURRENCY || "PYG";

// Cada documento controlado trae SU pie de firmas (literal del papel).
const WORK_ORDER_FOOTER = {        // REGI-MAN-02.3
  preparedBy: "Mercurio Group",
  reviewedBy: "Persona Designada en Tierra",
  approvedBy: "Gerente General",
};
const SERVICE_REQUEST_FOOTER = {   // REGI-LOG-01.3
  preparedBy: "Mercurio Group",
  reviewedBy: "Asesoria Juridica",
  approvedBy: "Gerente General",
};

// Formulario de OT (REGI-MAN-02.3). El orden replica el papel.
const WORK_ORDER_CONFIG = {
  sections: [
    "header", "requestedBy", "assignedTo", "priorityKindSystem", "permits",
    "request", "task", "spares", "materials", "schedule", "completion",
    "pending", "risk", "signatures",
  ],
  footer: WORK_ORDER_FOOTER,
  departments: ["CUBIERTA", "MAQUINAS", "BARCAZA", "PROVEEDOR", "OTROS"],
  distribution: [],
  communicationMethods: [],
  purchaseRequest: [],
  labels: {},
};

// Formulario de SS (REGI-LOG-01.3). `workOrderRef` es el único agregado al papel:
// la OT de la que cuelga la SS.
const SERVICE_REQUEST_CONFIG = {
  sections: [
    "header", "deptDate", "assignedTo", "equipment", "workOrderRef",
    "description", "causes", "purchaseRequest", "tramitacion", "hojaRuta",
    "taller", "entregaRecepcion", "comments", "signatures",
    "communication", "distribution",
  ],
  footer: SERVICE_REQUEST_FOOTER,
  departments: ["CUBIERTA", "MAQUINAS", "BARCAZA", "OTROS"],
  distribution: ["JMA", "CAP"],
  communicationMethods: ["IMPRESO", "EMAIL", "WHAPP", "OTRO"],
  purchaseRequest: ["NORMAL", "AFECTA SEGURIDAD", "AFECTA SERVICIO"],
  labels: {},
};

async function main() {
  // 1) Tenant + Settings
  const existing = await getPlatformTenant(SLUG).catch(() => null);
  if (existing) {
    console.log(`• Tenant '${SLUG}' ya existe (${existing.id})`);
  } else {
    const t = await createPlatformTenant({
      slug: SLUG, status: "ACTIVE", displayName: NAME, supportEmail: EMAIL,
      defaultLocale: "es" as any, enabledLocales: ["es"] as any,
      timezone: TZ, currency: CURRENCY, workOrderPdfTemplate: "MERCURIO",
      logoUrl: "/mercurio-logo.png", logoUrlLight: "/mercurio-logo-light.png",
    });
    console.log(`✔ Tenant creado '${t.slug}' (${t.id})`);
  }

  const tenant = await (prisma as any).tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  const tenantId: string = tenant.id;

  // 2) Formularios controlados
  const forms = [
    { type: "WORK_ORDER", data: { style: "MERCURIO", formCode: "REGI-MAN-02.3", title: "Orden de trabajo", revision: 0, effectiveFrom: "29.12.2025", codePattern: null, config: WORK_ORDER_CONFIG } },
    { type: "SERVICE_REQUEST", data: { style: "MERCURIO", formCode: "REGI-LOG-01.3", title: "Solicitud de servicios", revision: 2, effectiveFrom: "01.05.2025", logoUrl: "/LogoMercurio.png", codePattern: null, config: SERVICE_REQUEST_CONFIG } },
  ];
  for (const f of forms) {
    const row = await (prisma as any).tenantForm.upsert({
      where: { tenantId_type: { tenantId, type: f.type } },
      create: { tenantId, type: f.type, enabled: true, ...f.data },
      update: f.data,
    });
    console.log(`✔ Form ${f.type} → ${row.formCode}`);
  }
  await (prisma as any).tenantSetting.update({
    where: { tenantId },
    data: {
      controlledDocPreparedBy: "Departamento Tecnico Mercurio",
      controlledDocReviewedBy: "Gerente Mantenimiento",
      controlledDocApprovedBy: "Gerencia General",
    },
  });
  console.log("✔ Footer del documento controlado seteado");

  // 3) Usuario admin
  try {
    const u = await createPlatformTenantUser(SLUG, {
      email: EMAIL, password: PASSWORD, role: "TENANT_ADMIN" as any,
      firstName: "Admin", lastName: "Mercurio",
      userStatus: "ACTIVE" as any, membershipStatus: "ACTIVE" as any, assignedVesselCodes: [],
    } as any);
    console.log(`✔ Usuario admin creado: ${u.email}`);
  } catch (e: any) {
    if (String(e?.message || "").toLowerCase().includes("exist")) console.log(`• Usuario ${EMAIL} ya existe (sin cambios)`);
    else throw e;
  }

  console.log(`\nListo. Acceso: https://${SLUG}.<TU_DOMINIO>  | usuario ${EMAIL}`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error("ERROR:", e?.message ?? e); await prisma.$disconnect(); process.exit(1); });
