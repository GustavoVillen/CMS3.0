/**
 * Unifica el equipo de casco de TODA la flota y le carga el plan anual de
 * inspeccion de integridad estructural de espacios internos.
 *
 * 1) Renombra el activo de casco de los 37 buques a "Casco, Cubierta y Espacios".
 *    Hoy conviven dos nombres: "Casco, Cubierta, Casillaje (Equipos y Estructura
 *    en general)" en los remolcadores y "Casco, Cubierta, Tronco y Espacios" en
 *    las barcazas. Ningun buque queda sin el equipo (los 37 ya lo tienen).
 *
 * 2) Deja en cada buque UN plan anual (12 meses) titulado
 *    "Inspeccion de Integridad estructural de espacios internos (Coff/ Piques/ Tanques)".
 *    - Barcazas: se REUSA el plan anual de casco que ya existe (departamento BARCAZA,
 *      12 meses) y se lo renombra/completa. No se crea uno nuevo: duplicar generaria
 *      dos OT anuales por el mismo trabajo. En MGT20/MGT24 el plan extra a PROVEEDOR
 *      no se toca. Las fechas de ultima ejecucion / proximo vencimiento se preservan.
 *    - Remolcadores: no tenian plan equivalente, se crea uno nuevo (<BUQUE>-1-010).
 *
 * Idempotente. DRY=1 para previsualizar sin escribir.
 *
 * Uso:
 *   DRY=1 npx tsx scripts/load-fleet-structural-integrity-plan.ts
 *   npx tsx scripts/load-fleet-structural-integrity-plan.ts
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const DRY = process.env.DRY === "1";

const ASSET_NAME = "Casco, Cubierta y Espacios";
const PLAN_TITLE = "Inspeccion de Integridad estructural de espacios internos (Coff/ Piques/ Tanques)";
const NEW_TASK_SUFFIX = "1-010"; // libre en los 4 remolcadores, tambien entre los borrados

const TASKS_TABLE = [
  "| Espacio              | Condicion estructural | Condicion Pintura | Presencia de agua/producto | Observaciones |",
  "|                      | B / D / P             | B / D / P         | Si / No                    |               |",
  "|                      | B / D / P             | B / D / P         | Si / No                    |               |",
].join("\n");

const ACCEPTANCE_CRITERIA = [
  "Todos los espacios internos accesibles (coferdams, piques y tanques) fueron abiertos, ventilados e inspeccionados, y el resultado quedo registrado en la tabla.",
  "Estructura sin fisuras, deformaciones, corrosion perforante ni refuerzos sueltos.",
  "Recubrimiento sin desprendimientos generalizados ni oxidacion activa.",
  "Ausencia de agua o producto en espacios que deben estar secos; si hay presencia, se identifica el origen.",
  "Toda condicion marcada D o P se registra como defecto en el modulo de Defectos antes de cerrar la OT.",
].map((l, i) => `${i + 1}. ${l}`).join("\n");

const LOTO = [
  "ENTRADA A ESPACIO CONFINADO. No ingresar sin permiso de trabajo firmado.",
  "1. Aislar y bloquear el espacio: cerrar y bloquear valvulas de carga, lastre y venteo; bloquear bombas y agitadores asociados.",
  "2. Colocar tarjeta y candado en cada punto de aislacion; el ejecutante conserva la llave.",
  "3. Vaciar, lavar, desgasificar y ventilar el espacio antes del ingreso.",
  "4. Medir atmosfera antes de entrar y repetir la medicion durante la permanencia: oxigeno 20,8%, gases inflamables 0% LEL, toxicos bajo el limite.",
  "5. Vigia permanente en la boca de entrada, comunicacion continua y equipo de rescate disponible.",
  "6. Retirar bloqueos y tarjetas unicamente al finalizar, con el espacio cerrado y todo el personal fuera.",
].join("\n");

const RISK_ANALYSIS = [
  "Peligro principal: entrada a espacio confinado con atmosfera deficiente en oxigeno, inflamable o toxica (restos de carga, oxidacion del acero).",
  "Consecuencia potencial: fatalidad del ejecutante y de quien intente el rescate.",
  "Probabilidad: improbable mientras se cumpla el permiso de entrada, la desgasificacion y la medicion continua de atmosfera.",
  "Nivel resultante: ALTO. La tarea solo se ejecuta con permiso de trabajo, vigia y equipo de rescate en boca de entrada.",
  "Peligros secundarios: caida de altura por escalas y pozos, resbalones por superficies humedas, iluminacion deficiente, golpes contra refuerzos estructurales.",
].join("\n");

const CONSEQUENCE_RATIONALE =
  "Consecuencia de SEGURIDAD: la falla no detectada de la integridad estructural de coferdams, piques y tanques puede derivar en inundacion, perdida de flotabilidad o ingreso de producto a espacios adyacentes, con riesgo directo para la tripulacion. La tarea en si misma es una entrada a espacio confinado, la actividad de mayor letalidad a bordo.";

type Group = {
  kind: "BARCAZA" | "REMOLCADOR";
  department: "BARCAZA" | "CUBIERTA";
  responsible: string;
};

const GROUPS: Record<Group["kind"], Group> = {
  BARCAZA:    { kind: "BARCAZA",    department: "BARCAZA",  responsible: "Mantenimiento Barcazas" },
  REMOLCADOR: { kind: "REMOLCADOR", department: "CUBIERTA", responsible: "Capitán" },
};

/** El tipo real en la base es "Remolcador" o "Barcaza Tanque - Rake/Box". */
function groupOf(vesselType: string | null): Group {
  return /barcaza/i.test(vesselType ?? "") ? GROUPS.BARCAZA : GROUPS.REMOLCADOR;
}

function planFields(g: Group) {
  return {
    title: PLAN_TITLE,
    description: TASKS_TABLE,
    triggerType: "MONTHS",
    frequencyMonths: 12,
    frequencyHours: null,
    estimatedHours: 6,
    responsible: g.responsible,
    department: g.department,
    taskType: "INSPECTION",
    triggerResultMode: "AUTO_WO",
    sfiGroupNumber: 1,
    riskProbability: "UNLIKELY",
    riskConsequence: "FATALITY",
    riskLevel: "HIGH",
    riskAnalysisResult: RISK_ANALYSIS,
    loto: LOTO,
    acceptanceCriteria: ACCEPTANCE_CRITERIA,
    consequenceCategory: "SAFETY",
    consequenceRationale: CONSEQUENCE_RATIONALE,
    status: "ACTIVE",
  };
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tid: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: tid, role: "TENANT_ADMIN" }, select: { userId: true },
  });
  const uid: string | undefined = member?.userId;
  if (!uid) throw new Error(`No hay TENANT_ADMIN en '${SLUG}'.`);

  const vessels = await prisma.vessel.findMany({
    where: { tenantId: tid, deletedAt: null },
    select: { code: true, name: true, vesselType: true },
    orderBy: { code: "asc" },
  });

  console.log(`${DRY ? "DRY-RUN · " : ""}${vessels.length} buques en '${SLUG}'\n`);

  let nRenamed = 0, nPlanUpdated = 0, nPlanCreated = 0;
  const problems: string[] = [];

  for (const v of vessels) {
    const g = groupOf(v.vesselType);

    // ── 1) Activo de casco ────────────────────────────────────────────────────
    const cascoAssets = await prisma.asset.findMany({
      where: { tenantId: tid, vesselCode: v.code, deletedAt: null, sfiCode: "100", name: { contains: "Casco", mode: "insensitive" } },
      select: { id: true, assetCode: true, name: true },
    });
    if (cascoAssets.length !== 1) {
      problems.push(`${v.code}: ${cascoAssets.length} activos de casco (se esperaba 1) — se omite`);
      continue;
    }
    const asset = cascoAssets[0];
    const needsRename = asset.name !== ASSET_NAME;
    if (needsRename) {
      nRenamed++;
      if (!DRY) {
        await prisma.asset.update({
          where: { id: asset.id },
          data: { name: ASSET_NAME, updatedByUserId: uid },
        });
      }
    }
    console.log(`${v.code.padEnd(7)} ${v.name.padEnd(14)} [${g.kind}]  ${asset.assetCode}` +
      (needsRename ? `  ✎ "${asset.name}" → "${ASSET_NAME}"` : `  (nombre ya correcto)`));

    // ── 2) Plan anual de integridad estructural ───────────────────────────────
    // Barcazas: reusar el plan anual de casco que ya existe (dept BARCAZA, 12 m).
    // Remolcadores: no hay equivalente, se crea.
    const existing = g.kind === "BARCAZA"
      ? await prisma.maintenancePlan.findMany({
          where: {
            tenantId: tid, vesselCode: v.code, assetId: asset.id, deletedAt: null,
            frequencyMonths: 12, department: "BARCAZA",
          },
          select: { id: true, taskCode: true, title: true },
        })
      : await prisma.maintenancePlan.findMany({
          where: { tenantId: tid, vesselCode: v.code, assetId: asset.id, deletedAt: null, title: PLAN_TITLE },
          select: { id: true, taskCode: true, title: true },
        });

    if (existing.length > 1) {
      problems.push(`${v.code}: ${existing.length} planes anuales candidatos (${existing.map((p: any) => p.taskCode).join(", ")}) — se omite el plan`);
      continue;
    }

    const data = planFields(g);

    if (existing.length === 1) {
      const p = existing[0];
      nPlanUpdated++;
      console.log(`        plan ${p.taskCode.padEnd(16)} ← se reusa  "${p.title}"`);
      if (!DRY) {
        await prisma.maintenancePlan.update({
          where: { id: p.id },
          data: { ...data, updatedByUserId: uid },
        });
      }
    } else {
      const taskCode = `${v.code}-${NEW_TASK_SUFFIX}`;
      const clash = await prisma.maintenancePlan.findUnique({
        where: { tenantId_vesselCode_taskCode: { tenantId: tid, vesselCode: v.code, taskCode } },
        select: { id: true, deletedAt: true },
      });
      if (clash) {
        problems.push(`${v.code}: el codigo ${taskCode} ya esta ocupado${clash.deletedAt ? " (plan borrado)" : ""} — se omite el plan`);
        continue;
      }
      nPlanCreated++;
      console.log(`        plan ${taskCode.padEnd(16)} + se crea`);
      if (!DRY) {
        await prisma.maintenancePlan.create({
          data: {
            tenantId: tid, vesselCode: v.code, taskCode, assetId: asset.id,
            ...data, executionStatus: "FUTURE", windowMode: "AUTO",
            createdByUserId: uid, updatedByUserId: uid,
          },
        });
      }
    }
  }

  console.log(
    `\n${DRY ? "DRY-RUN (no se escribio nada). " : "✅ Completado. "}` +
    `${nRenamed} equipos renombrados · ${nPlanUpdated} planes reusados · ${nPlanCreated} planes creados.`,
  );
  if (problems.length) {
    console.log(`\n⚠ ${problems.length} casos NO aplicados:`);
    for (const p of problems) console.log(`  - ${p}`);
  }
}

main().catch((e) => { console.error("❌", e?.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
