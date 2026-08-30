/**
 * Completa la SS (ServiceRequest) faltante de las 64 OT históricas de DON CHICUETO
 * (OT-DCH-26-0002 … OT-DCH-26-0065) cargadas ANTES de que existiera la entidad SS
 * (ver [[cargar-ss-standalone-dch]]) — quedaron como OT sin su SS asociada
 * (confirmado: 0 ServiceRequest en DCH antes de correr esto).
 *
 * NO se tocan las OT: se leen tal cual están y se genera 1 SS por cada una,
 * heredando sus datos (mismo criterio que usa createServiceRequestForWorkOrder
 * en vivo, pero acá se copia también la tramitación ya cargada en la OT en vez
 * de pedirla de nuevo).
 *
 * Mapeo OT → SS:
 *   title/description → title/description · riskAnalysisResult → causes
 *   (NO description: acá description es igual al title; riskAnalysisResult es
 *   donde vive la narrativa de "por qué" en estas OT, ver update-dch-ss-risk.ts)
 *   department/communicationMethod/openDate/priority → copiados tal cual
 *   aprobado/autorizado → copiados tal cual (misma tramitación que ya tiene la OT:
 *   Ronald Silva aprueba, Jorge Bael autoriza, uniforme en las 64)
 *   executedByName ("Oscar Duarte") → receivedByName, con receptionConform=true
 *   assignedToUserId ("Jefe de Maquinas") → solicitaByName + jefeMaquinasName
 *
 * NO capturado (no había PDF para volver a leer, sólo la OT ya cargada):
 *   - taller/providerId: se deja null (las 64 OT ya tienen providerId null)
 *   - purchaseRequestKinds: se deja [] (vacío) — NO se inventa qué casillero
 *     "SOLICITUD DE COMPRAS" estaba marcado en el papel original.
 *
 * serviceRequestCode: preserva la numeración original de la carga histórica
 * (SS-<n>-DCH-2026, n = 1..64, derivado de workOrderCode: OT-DCH-26-00XX → n=XX-1).
 *
 * Idempotente: si una OT del rango YA tiene una SS (children.length > 0), se saltea.
 *
 * Uso (en el VPS):
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/complete-dch-ss.ts     # previsualiza
 *   npx tsx scripts/complete-dch-ss.ts           # ejecuta
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const VESSEL = "DCH";
const TENANT_SLUG = "mercurio";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} no encontrado`);
  const tenantId = tenant.id;

  const codes = Array.from({ length: 64 }, (_, i) => `OT-${VESSEL}-26-${String(i + 2).padStart(4, "0")}`);
  const ots = await prisma.workOrder.findMany({
    where: { tenantId, vesselCode: VESSEL, workOrderCode: { in: codes } },
    include: { serviceRequests: { select: { id: true } } },
    orderBy: { workOrderCode: "asc" },
  });
  if (ots.length !== 64) throw new Error(`Esperaba 64 OT (0002..0065), encontré ${ots.length}`);

  const assets = await prisma.asset.findMany({ where: { tenantId, vesselCode: VESSEL }, select: { id: true, name: true } });
  const assetNameById = new Map<string, string>(assets.map((a: any) => [a.id, a.name]));

  const pending = ots.filter((o: any) => o.serviceRequests.length === 0);
  const already = ots.filter((o: any) => o.serviceRequests.length > 0);

  console.log(`\n===== COMPLETAR SS de DCH (${DRY ? "DRY-RUN" : "LIVE"}) =====`);
  console.log(`Tenant: ${TENANT_SLUG} (${tenantId})  Buque: ${VESSEL}`);
  console.log(`OT en rango: ${ots.length}  Ya tienen SS (se saltean): ${already.length}  Pendientes: ${pending.length}`);
  if (already.length) console.log(`  Ya completas: ${already.map((o: any) => o.workOrderCode).join(", ")}`);

  if (DRY) {
    console.log(`\n-- Muestra (primeras 6 de ${pending.length}) --`);
    for (const o of pending.slice(0, 6)) {
      const n = Number(o.workOrderCode.split("-").pop()) - 1;
      console.log(`  ${o.workOrderCode} → SS-${n}-${VESSEL}-2026  [${o.openDate.toISOString().slice(0, 10)}] ${assetNameById.get(o.assetId) ?? "?"} → "${(o.title ?? "").slice(0, 60)}"`);
    }
    console.log(`\n(DRY-RUN: no se escribió nada. Quitá DRY=1 para ejecutar.)\n`);
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  for (const o of pending) {
    const n = Number(o.workOrderCode.split("-").pop()) - 1;
    const srCode = `SS-${n}-${VESSEL}-2026`;
    const when = o.openDate;

    await prisma.serviceRequest.create({
      data: {
        tenantId,
        vesselCode: VESSEL,
        workOrderId: o.id,
        serviceRequestCode: srCode,
        status: "COMPLETED",
        priority: o.priority,
        openDate: when,
        title: o.title,
        description: o.title,
        causes: o.riskAnalysisResult,
        providerId: null,
        tallerNotes: null,
        purchaseRequestKinds: [],
        department: o.department,
        communicationMethod: o.communicationMethod,
        distribution: [],
        observations: null,
        closeNotes: o.closeNotes,
        receptionItem: assetNameById.get(o.assetId) ?? null,
        receivedByName: o.executedByName,
        receptionConform: true,
        startedAt: when,
        receivedAt: when,
        capitanName: null,
        jefeMaquinasName: o.assignedToUserId,
        solicitaByName: o.assignedToUserId,
        aprobadoByName: o.aprobadoByName,
        aprobadoByUserId: o.aprobadoByUserId,
        aprobadoAt: o.aprobadoAt,
        autorizadoByName: o.autorizadoByName,
        autorizadoByUserId: o.autorizadoByUserId,
        autorizadoAt: o.autorizadoAt,
        createdAt: when,
        createdByUserId: o.createdByUserId,
        updatedByUserId: o.createdByUserId,
      },
    });
    ok++;
    if (ok % 10 === 0 || ok === pending.length) console.log(`  [${ok}/${pending.length}] ${o.workOrderCode} → ${srCode} OK`);
  }

  console.log(`\n===== LISTO: ${ok} SS creadas (completando OT ya existentes) =====\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
