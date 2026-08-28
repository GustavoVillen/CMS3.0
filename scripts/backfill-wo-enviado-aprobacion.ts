/**
 * Backfill de `enviadoAprobacionAt` en las OT que ya existían antes del flujo
 * de 4 etapas (En preparación → Pendiente de aprobación → Pendiente de
 * autorización → Autorizada y en proceso).
 *
 * Por qué hace falta: la etapa de la OT se DEDUCE de fechas (ver woStage en
 * WorkOrders.tsx). Con el campo nuevo en null, TODAS las OT históricas
 * caerían en "En preparación" — incluidas las que están realmente esperando
 * la firma de alguien. Antes de este cambio no existía el paso "enviar a
 * aprobar": toda OT nacía ya solicitada, así que la lectura correcta del
 * histórico es "todas fueron enviadas".
 *
 * Qué escribe, por OT (la primera fecha que tenga, en este orden):
 *   aprobadoAt → autorizadoAt → openDate → createdAt
 * y `enviadoAprobacionByName = "Sistema (migración)"` para dejar claro en la
 * trazabilidad que ese envío no lo firmó una persona.
 *
 * Sólo toca filas con enviadoAprobacionAt = null, así que es idempotente:
 * correrlo dos veces no cambia nada la segunda vez, y no pisa los envíos
 * reales que se hagan después.
 *
 * Uso:
 *   DRY=1 npx tsx scripts/backfill-wo-enviado-aprobacion.ts   # previsualiza
 *   npx tsx scripts/backfill-wo-enviado-aprobacion.ts         # ejecuta
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const MIGRATION_NAME = "Sistema (migración)";

async function main() {
  const pendientes = await prisma.workOrder.findMany({
    where: { enviadoAprobacionAt: null },
    select: {
      id: true, workOrderCode: true, vesselCode: true, status: true,
      openDate: true, createdAt: true, createdByUserId: true,
      aprobadoAt: true, autorizadoAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (pendientes.length === 0) {
    console.log("Nada que hacer: todas las OT ya tienen enviadoAprobacionAt.");
    return;
  }

  // Reparto por etapa ANTES de tocar nada, para poder comparar después.
  const porEtapa = { autorizadas: 0, aprobadas: 0, sinFirmar: 0 };
  for (const wo of pendientes) {
    if (wo.autorizadoAt) porEtapa.autorizadas++;
    else if (wo.aprobadoAt) porEtapa.aprobadas++;
    else porEtapa.sinFirmar++;
  }

  console.log(`OT sin enviadoAprobacionAt: ${pendientes.length}`);
  console.log(`  ya autorizadas ............ ${porEtapa.autorizadas}`);
  console.log(`  aprobadas sin autorizar ... ${porEtapa.aprobadas}`);
  console.log(`  sin firmar (quedan en "Pendiente de aprobación") ... ${porEtapa.sinFirmar}`);

  // Las sin firmar son las únicas que un error acá movería de columna a la
  // vista del usuario: se listan una por una para poder revisarlas.
  const sinFirmar = pendientes.filter((wo: any) => !wo.aprobadoAt && !wo.autorizadoAt);
  if (sinFirmar.length > 0) {
    console.log("\nOT que hoy esperan aprobación (deben seguir en 'Pendiente de aprobación'):");
    for (const wo of sinFirmar) {
      console.log(`  ${wo.vesselCode} · ${wo.workOrderCode} · ${wo.status} · apertura ${String(wo.openDate).slice(0, 10)}`);
    }
  }

  if (DRY) {
    console.log("\nDRY=1 — no se escribió nada.");
    return;
  }

  let escritas = 0;
  for (const wo of pendientes) {
    const fecha = wo.aprobadoAt ?? wo.autorizadoAt ?? wo.openDate ?? wo.createdAt;
    await prisma.workOrder.update({
      where: { id: wo.id },
      data: {
        enviadoAprobacionAt: fecha,
        enviadoAprobacionByName: MIGRATION_NAME,
        // Sin usuario: nadie firmó esto a mano. Dejarlo en null evita que el
        // PDF estampe la firma digital de alguien que no la dio.
        enviadoAprobacionByUserId: null,
      },
    });
    escritas++;
  }

  const quedan = await prisma.workOrder.count({ where: { enviadoAprobacionAt: null } });
  console.log(`\nListo: ${escritas} OT actualizadas. Quedan sin enviar: ${quedan} (debe ser 0).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
