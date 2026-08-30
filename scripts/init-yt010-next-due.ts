/**
 * Asignar nextDueDate = 1 Ene 2026 a todos los planes ACTIVE de YT010.
 * Esto define el "estado inicial" para la simulación.
 *
 * Uso:
 *   DATABASE_URL=<url> npx tsx scripts/init-yt010-next-due.ts
 *   DRY=1 ...  → previsualiza sin escribir
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const VESSEL = "YT010";
const TENANT_SLUG = "mercurio";
const DRY = process.env.DRY === "1";
const INITIAL_DATE = new Date("2026-01-01T00:00:00.000Z");

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true },
  });
  if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' no encontrado.`);
  const tid = tenant.id;

  const plans = await prisma.maintenancePlan.findMany({
    where: {
      tenantId: tid,
      vesselCode: VESSEL,
      status: "ACTIVE",
      triggerType: { in: ["MONTHS", "DAY", "WEEK", "CALENDAR"] }, // Solo planes por fecha
    },
    select: {
      id: true,
      taskCode: true,
      title: true,
      frequencyMonths: true,
      triggerType: true,
      nextDueDate: true,
    },
  });

  console.log(`Encontrados ${plans.length} planes ACTIVE de ${VESSEL} con trigger por fecha.\n`);

  let updated = 0;
  for (const plan of plans) {
    console.log(
      `[${plan.triggerType}] ${plan.taskCode}: ${plan.title}` +
        `\n  Frecuencia: ${plan.frequencyMonths} meses` +
        `\n  nextDueDate actual: ${plan.nextDueDate?.toISOString() ?? "NULL"}` +
        `\n  → Nuevo nextDueDate: ${INITIAL_DATE.toISOString()}`,
    );

    if (!DRY) {
      await prisma.maintenancePlan.update({
        where: { id: plan.id },
        data: { nextDueDate: INITIAL_DATE },
      });
      updated++;
    }

    console.log("");
  }

  console.log(
    `${DRY ? "DRY-RUN: " : "✅ "}${updated}/${plans.length} planes actualizados al 1 Ene 2026.`,
  );
}

main()
  .catch((e) => {
    console.error("❌ Error:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
