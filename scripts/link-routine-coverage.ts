/**
 * Carga inicial de "Equipos que revisa" (MaintenancePlanCoveredAsset): vincula los
 * checklists consolidados (semanal/mensual de cubierta y máquinas de los
 * remolcadores) y las pruebas de barcazas (válvulas P/V, paradas de emergencia)
 * con los equipos que revisan, para que dejen de figurar "Sin plan".
 *
 * Entrada: JSON aprobado por Gustavo, lista de { vessel, taskCode, assetCode }
 * (sale de la planilla "Rutinas y equipos que revisan", columna Incluir = Sí).
 *
 * Por defecto NO escribe (muestra qué haría). Con --apply graba. Idempotente:
 * un vínculo que ya existe no se duplica. Valida mismo buque, tarea ACTIVA y
 * equipo vivo; deja una entrada de auditoría por tarea.
 *
 * Uso (en el VPS, desde apps/api):
 *   ACTOR_EMAIL=... npx tsx --env-file=/app-cms3/.env ../../scripts/link-routine-coverage.ts lista.json
 *   ACTOR_EMAIL=... npx tsx --env-file=/app-cms3/.env ../../scripts/link-routine-coverage.ts lista.json --apply
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const file = process.argv[2];
const APPLY = process.argv.includes("--apply");

interface Row { vessel: string; taskCode: string; assetCode: string }

async function main() {
  if (!file) throw new Error("Falta el archivo JSON con la lista aprobada.");
  const rows = JSON.parse(readFileSync(file, "utf8")) as Row[];
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`No existe el tenant ${SLUG}`);
  const actor = process.env.ACTOR_EMAIL
    // El email no es único entre empresas: se busca entre los miembros de ésta.
    ? await prisma.user.findFirst({ where: { email: process.env.ACTOR_EMAIL, memberships: { some: { tenantId: tenant.id } } } })
    : null;
  if (!actor) throw new Error("ACTOR_EMAIL no corresponde a un usuario.");

  const byPlan = new Map<string, { plan: any; assets: any[] }>();
  const errors: string[] = [];
  for (const r of rows) {
    const plan = await prisma.maintenancePlan.findFirst({
      where: { tenantId: tenant.id, vesselCode: r.vessel, taskCode: r.taskCode, deletedAt: null, status: "ACTIVE" },
      select: { id: true, taskCode: true, title: true, vesselCode: true, assetId: true },
    });
    const asset = await prisma.asset.findFirst({
      where: { tenantId: tenant.id, vesselCode: r.vessel, assetCode: r.assetCode, deletedAt: null },
      select: { id: true, assetCode: true, name: true },
    });
    if (!plan) { errors.push(`${r.vessel} ${r.taskCode}: tarea inexistente o no activa`); continue; }
    if (!asset) { errors.push(`${r.vessel} ${r.assetCode}: equipo inexistente`); continue; }
    if (asset.id === plan.assetId) continue; // ya es el equipo principal
    const entry = byPlan.get(plan.id) ?? { plan, assets: [] };
    if (!entry.assets.some(a => a.id === asset.id)) entry.assets.push(asset);
    byPlan.set(plan.id, entry);
  }
  if (errors.length > 0) {
    console.log("ERRORES (no se graba nada):\n  " + errors.join("\n  "));
    process.exitCode = 1;
    return;
  }

  let added = 0;
  for (const { plan, assets } of byPlan.values()) {
    const existing = new Set((await prisma.maintenancePlanCoveredAsset.findMany({
      where: { tenantId: tenant.id, maintenancePlanId: plan.id }, select: { assetId: true },
    })).map((l: { assetId: string }) => l.assetId));
    const toAdd = assets.filter(a => !existing.has(a.id));
    console.log(`${plan.vesselCode} ${plan.taskCode} (${plan.title}): +${toAdd.length} ${toAdd.map(a => a.assetCode).join(", ")}`);
    if (!APPLY || toAdd.length === 0) { added += toAdd.length; continue; }
    await prisma.$transaction([
      prisma.maintenancePlanCoveredAsset.createMany({
        data: toAdd.map(a => ({ tenantId: tenant.id, maintenancePlanId: plan.id, assetId: a.id, createdByUserId: actor.id })),
        skipDuplicates: true,
      }),
      prisma.auditEvent.create({
        data: {
          tenantId: tenant.id, actorType: "TENANT_USER", actorUserId: actor.id, action: "MaintenancePlan.updated",
          entityType: "MaintenancePlan", entityId: plan.id,
          metadata: { title: plan.title, taskCode: plan.taskCode, vesselCode: plan.vesselCode, coveredAssets: { added: toAdd.map(a => a.id), removed: [] } },
        },
      }),
    ]);
    added += toAdd.length;
  }
  console.log(`${APPLY ? "Grabados" : "Se grabarían"} ${added} vínculos en ${byPlan.size} tareas.${APPLY ? "" : " (sin --apply no se escribió nada)"}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
