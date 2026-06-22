// Seed idempotente — formularios controlados del tenant Mercurio.
//   - WORK_ORDER     → REGI-MAN-02.4 "Orden Interna de Trabajo" (estilo MERCURIO)
//   - SERVICE_REQUEST→ REGI-LOG-01.3 "Solicitud de servicios" (logo propio LogoMercurio.png)
//   - Footer editable del documento controlado en TenantSetting.
//
// Uso (desde la raiz del repo, DATABASE_URL exportada):
//   npx tsx scripts/seed-mercurio-forms.ts
//   DRY=1 npx tsx scripts/seed-mercurio-forms.ts   → previsualiza
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) } as any);

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const DRY = process.env.DRY === "1";

const SERVICE_REQUEST_CONFIG = {
  sections: [
    "header", "deptDate", "equipment", "equipAssigned", "description", "causes",
    "purchaseRequest", "tramitacion", "taller", "hojaRuta", "entregaRecepcion",
    "comments", "generatedBy", "signatures", "communication", "distribution",
  ],
  footer: {
    preparedBy: "Departamento Tecnico Mercurio",
    reviewedBy: "Gerente Mantenimiento",
    approvedBy: "Gerencia General",
  },
  departments: ["CUBIERTA", "MAQUINAS", "BARCAZA", "OTROS"],
  distribution: ["JMA", "CAP"],
  communicationMethods: ["IMPRESO", "EMAIL", "WHAPP", "OTRO"],
  purchaseRequest: ["NORMAL", "AFECTA SEGURIDAD", "AFECTA SERVICIO"],
  labels: {},
};

async function main() {
  const tenant = await (prisma as any).tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) { console.error(`Tenant '${SLUG}' no encontrado en esta base.`); return; }
  const tenantId: string = tenant.id;
  console.log(`Tenant '${SLUG}' → ${tenantId}`);

  const forms = [
    {
      type: "WORK_ORDER" as const,
      create: {
        tenantId, type: "WORK_ORDER" as const, style: "MERCURIO" as const,
        formCode: "REGI-MAN-02.4", title: "Orden Interna de Trabajo", revision: 2,
        effectiveFrom: "01.05.2025", codePattern: null, enabled: true,
      },
      update: {
        style: "MERCURIO" as const, formCode: "REGI-MAN-02.4", title: "Orden Interna de Trabajo",
        revision: 2, effectiveFrom: "01.05.2025",
      },
    },
    {
      type: "SERVICE_REQUEST" as const,
      create: {
        tenantId, type: "SERVICE_REQUEST" as const, style: "MERCURIO" as const,
        formCode: "REGI-LOG-01.3", title: "Solicitud de servicios", revision: 2,
        effectiveFrom: "01.05.2025", logoUrl: "/LogoMercurio.png",
        codePattern: "SS-{seq:0000}-{vesselShort}-{year}", config: SERVICE_REQUEST_CONFIG, enabled: true,
      },
      update: {
        style: "MERCURIO" as const, formCode: "REGI-LOG-01.3", title: "Solicitud de servicios",
        revision: 2, effectiveFrom: "01.05.2025", logoUrl: "/LogoMercurio.png",
        codePattern: "SS-{seq:0000}-{vesselShort}-{year}", config: SERVICE_REQUEST_CONFIG,
      },
    },
  ];

  for (const f of forms) {
    if (DRY) { console.log(`[DRY] upsert TenantForm ${f.type}`); continue; }
    const row = await (prisma as any).tenantForm.upsert({
      where: { tenantId_type: { tenantId, type: f.type } },
      create: f.create,
      update: f.update,
    });
    console.log(`✔ TenantForm ${f.type} → ${row.formCode} (codeSeq=${row.codeSeq})`);
  }

  if (!DRY) {
    await (prisma as any).tenantSetting.update({
      where: { tenantId },
      data: {
        controlledDocPreparedBy: "Departamento Tecnico Mercurio",
        controlledDocReviewedBy: "Gerente Mantenimiento",
        controlledDocApprovedBy: "Gerencia General",
      },
    });
    console.log("✔ TenantSetting footer (Departamento Tecnico Mercurio / Gerente Mantenimiento / Gerencia General)");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
