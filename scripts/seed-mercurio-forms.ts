// Seed idempotente — formularios controlados del tenant Mercurio.
//   - WORK_ORDER     → REGI-MAN-02.3 "Orden de trabajo" (rev 0, 29.12.2025)
//   - SERVICE_REQUEST→ REGI-LOG-01.3 "Solicitud de servicios" (logo propio LogoMercurio.png)
//   - Footer editable del documento controlado en TenantSetting.
//
// El codigo del formulario de OT paso de REGI-OPE-26.3 a REGI-MAN-02.3 (sep-2026),
// para alinearlo con el juego de procedimientos rev. 3 del 29.12.2025, donde
// PROC-MAN-02 §5 y PROC-MAN-03 §5 lo listan asi. El formulario en si no cambio.
// Pendiente de definir con Mercurio: si REGI-MAN-02.4 "Orden Interna de Trabajo"
// sigue vivo como registro separado o si la OT lo absorbe.
//
// OT y SS son documentos distintos: la OT es el trabajo de mantenimiento; la SS es
// el pedido de un servicio externo que cuelga de una OT abierta.
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

// Formulario de OT. El orden replica el papel REGI-MAN-02.3.
const WORK_ORDER_CONFIG = {
  sections: [
    "header", "requestedBy", "assignedTo", "priorityKindSystem", "permits",
    "request", "task", "spares", "materials", "schedule", "completion",
    "pending", "risk", "signatures", "riskAnnex",
  ],
  footer: WORK_ORDER_FOOTER,
  departments: ["CUBIERTA", "MAQUINAS", "BARCAZA", "PROVEEDOR", "OTROS"],
  distribution: [],
  communicationMethods: [],
  purchaseRequest: [],
  labels: {},
};

// Formulario de SS. El orden replica el papel REGI-LOG-01.3 (ver SS-74-M01-2026).
// `workOrderRef` es el único agregado: la OT de la que cuelga la SS.
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
  const tenant = await (prisma as any).tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) { console.error(`Tenant '${SLUG}' no encontrado en esta base.`); return; }
  const tenantId: string = tenant.id;
  console.log(`Tenant '${SLUG}' → ${tenantId}`);

  const forms = [
    {
      type: "WORK_ORDER" as const,
      create: {
        tenantId, type: "WORK_ORDER" as const, style: "MERCURIO" as const,
        formCode: "REGI-MAN-02.3", title: "Orden de trabajo", revision: 0,
        effectiveFrom: "29.12.2025", codePattern: null, config: WORK_ORDER_CONFIG, enabled: true,
      },
      update: {
        style: "MERCURIO" as const, formCode: "REGI-MAN-02.3", title: "Orden de trabajo",
        revision: 0, effectiveFrom: "29.12.2025", config: WORK_ORDER_CONFIG,
      },
    },
    {
      type: "SERVICE_REQUEST" as const,
      create: {
        tenantId, type: "SERVICE_REQUEST" as const, style: "MERCURIO" as const,
        formCode: "REGI-LOG-01.3", title: "Solicitud de servicios", revision: 2,
        effectiveFrom: "01.05.2025", logoUrl: "/LogoMercurio.png",
        codePattern: null, config: SERVICE_REQUEST_CONFIG, enabled: true,
      },
      update: {
        style: "MERCURIO" as const, formCode: "REGI-LOG-01.3", title: "Solicitud de servicios",
        revision: 2, effectiveFrom: "01.05.2025", logoUrl: "/LogoMercurio.png",
        codePattern: null, config: SERVICE_REQUEST_CONFIG,
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
