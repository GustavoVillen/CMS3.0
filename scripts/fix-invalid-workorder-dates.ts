/**
 * Corrige las OT que quedaron con fechas fuera del rango de fechas de JS
 * (llegan como "Invalid Date" y rompían el export a Excel del módulo entero).
 *
 * Uso:
 *   npx tsx scripts/fix-invalid-workorder-dates.ts            # sólo reporta
 *   APPLY=1 npx tsx scripts/fix-invalid-workorder-dates.ts    # corrige
 *
 * La fecha de reemplazo sale de FIXES (mapa código de OT -> fecha), definido
 * a mano: no se puede inferir el valor correcto de un timestamp corrupto.
 */
import "dotenv/config";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma: any = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any);

/** workOrderCode -> fecha de apertura correcta (YYYY-MM-DD). */
const FIXES: Record<string, string> = {
  "OT-LTE-26-0032": "2026-06-20",
};

const DATE_FIELDS = [
  "openDate", "dueDate", "startDate", "completedDate",
  "createdAt", "updatedAt", "lastReopenAt",
  "enviadoAprobacionAt", "aprobadoAt", "autorizadoAt", "rechazadoAt",
] as const;

async function main() {
  const apply = process.env.APPLY === "1";

  const rows = await prisma.workOrder.findMany({
    where: { deletedAt: null },
    select: DATE_FIELDS.reduce(
      (acc, f) => ({ ...acc, [f]: true }),
      { id: true, workOrderCode: true, vesselCode: true, title: true } as Record<string, boolean>,
    ),
  });

  const bad = rows.filter((r: any) =>
    DATE_FIELDS.some((f) => r[f] instanceof Date && Number.isNaN(r[f].getTime())),
  );

  console.log(`OT revisadas: ${rows.length} — con fecha inválida: ${bad.length}`);

  for (const wo of bad) {
    const broken = DATE_FIELDS.filter((f) => wo[f] instanceof Date && Number.isNaN(wo[f].getTime()));
    console.log(`\n${wo.workOrderCode} (${wo.vesselCode}) — ${wo.title}`);
    console.log(`  campos rotos: ${broken.join(", ")}`);

    const replacement = FIXES[wo.workOrderCode];
    if (!replacement) {
      console.log("  SIN CORRECCIÓN definida en FIXES — se deja como está.");
      continue;
    }
    if (!apply) {
      console.log(`  se corregirían a ${replacement} (correr con APPLY=1)`);
      continue;
    }

    const data: Record<string, Date> = {};
    for (const f of broken) data[f] = new Date(`${replacement}T00:00:00.000Z`);
    await prisma.workOrder.update({ where: { id: wo.id }, data });

    const after = await prisma.workOrder.findUnique({
      where: { id: wo.id },
      select: broken.reduce((acc, f) => ({ ...acc, [f]: true }), {} as Record<string, boolean>),
    });
    console.log(`  CORREGIDO -> ${broken.map((f) => `${f}=${String(after[f])}`).join(", ")}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
