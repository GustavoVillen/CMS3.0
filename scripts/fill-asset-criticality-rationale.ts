/**
 * Completa el "Fundamento de Criticidad" de los equipos que lo tienen vacio y,
 * de paso, deja registrada la decision de si el equipo debe estar dentro del
 * plan de mantenimiento.
 *
 * Usa el mismo generador de IA que el boton de varita de la ficha del equipo
 * (`assets-criticality-ai`), al que se le pasa la clasificacion YA asignada por
 * el usuario: la IA la justifica, no la reemplaza. Si la ve claramente mal,
 * agrega una oracion "Revisar criticidad: ..." — el script las junta al final
 * para que una persona decida.
 *
 * El flag ISM 10.3 es la excepcion: es una definicion del Codigo, no una
 * preferencia, asi que la IA lo evalua de cero. El script solo AGREGA el flag
 * cuando falta; nunca lo saca (sacarlo se reporta para revision manual).
 *
 * Lo que si escribe:
 *   - criticalityRationale (solo si estaba vacio, salvo FORCE=1)
 *   - isSafetyCritical, solo de false -> true
 *   - planNotRequired + planNotRequiredReason cuando la IA concluye que el
 *     equipo no lleva plan preventivo. Nunca sobre equipos safety-critical
 *     (ISM 10.3) ni sobre equipos que YA tienen planes activos cargados.
 *
 * Uso:
 *   pnpm exec tsx --env-file .env scripts/fill-asset-criticality-rationale.ts
 *   DRY=1 / VESSEL=M01 / LIMIT=5 / CONCURRENCY=3 (default 3)
 *   FORCE=1  regenera tambien los que ya tienen fundamento escrito
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { suggestAssetCriticality } from "../apps/api/src/tenant/assets/assets-criticality-ai";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = process.env.VESSEL ?? "";
const DRY = process.env.DRY === "1";
const FORCE = process.env.FORCE === "1";
const LIMIT = Number(process.env.LIMIT ?? 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? 3));

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tenantId: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId, role: "TENANT_ADMIN" },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (!member?.userId) throw new Error(`No hay TENANT_ADMIN en '${SLUG}'.`);
  const session = { tenantSlug: SLUG, user: { id: member.userId, email: member.user?.email ?? "" } } as any;

  const assets = await prisma.asset.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(VESSEL ? { vesselCode: VESSEL } : {}),
      ...(FORCE ? {} : { OR: [{ criticalityRationale: null }, { criticalityRationale: "" }] }),
    },
    select: {
      id: true, assetCode: true, name: true, vesselCode: true, sfiCode: true,
      manufacturer: true, model: true, serialNumber: true,
      criticality: true, isSafetyCritical: true, criticalityRationale: true, planNotRequired: true,
    },
    orderBy: [{ vesselCode: "asc" }, { assetCode: "asc" }],
  });

  // Un equipo que YA tiene planes activos no puede quedar marcado como "no
  // requiere plan": el dato real manda sobre la opinion de la IA.
  const conPlan = new Set<string>(
    (await prisma.maintenancePlan.findMany({
      where: { tenantId, deletedAt: null, status: "ACTIVE" },
      select: { assetId: true },
      distinct: ["assetId"],
    })).map((p: any) => p.assetId),
  );

  const targets = LIMIT > 0 ? assets.slice(0, LIMIT) : assets;
  console.log(`${DRY ? "DRY-RUN · " : ""}${targets.length} equipos a fundamentar` +
    (VESSEL ? ` (buque ${VESSEL})` : "") + `\n`);
  if (DRY) {
    for (const a of targets) {
      console.log(`  ${a.vesselCode.padEnd(6)} ${String(a.assetCode).padEnd(16)} ${a.criticality}${a.isSafetyCritical ? "/ISM" : "    "}  ${a.name}`);
    }
    await prisma.$disconnect();
    return;
  }

  let ok = 0, fail = 0, exentos = 0;
  const revisar: string[] = [];
  const ismAgregado: string[] = [];
  const ismDeMas: string[] = [];
  const errores: string[] = [];

  async function run(a: any) {
    try {
      const r = await suggestAssetCriticality(session, {
        name: a.name,
        vesselCode: a.vesselCode,
        sfiCode: a.sfiCode,
        manufacturer: a.manufacturer,
        model: a.model,
        serialNumber: a.serialNumber,
        currentCriticality: a.criticality,
        currentSafetyCritical: a.isSafetyCritical,
      });

      const data: Record<string, unknown> = {
        criticalityRationale: r.rationale,
        updatedByUserId: member!.userId,
      };
      // ISM 10.3 solo se AGREGA. Quitar un flag de seguridad es una decision
      // que no se automatiza: si la IA lo ve de mas, se reporta y listo.
      if (r.isSafetyCritical && !a.isSafetyCritical) {
        data.isSafetyCritical = true;
        ismAgregado.push(`${a.vesselCode} ${a.assetCode} - ${a.name}`);
      } else if (!r.isSafetyCritical && a.isSafetyCritical) {
        ismDeMas.push(`${a.vesselCode} ${a.assetCode} - ${a.name}`);
      }
      // La exencion solo se propone: nunca sobre ISM 10.3 ni sobre equipos que
      // ya tienen planes cargados (ahi la decision practica ya esta tomada).
      const puedeExento = r.requiresMaintenancePlan === false
        && !a.isSafetyCritical && !r.isSafetyCritical && !conPlan.has(a.id);
      if (puedeExento) {
        data.planNotRequired = true;
        data.planNotRequiredReason = r.rationale;
        exentos++;
      }
      await prisma.asset.update({ where: { id: a.id }, data });

      const m = /Revisar criticidad:[^.]*\./i.exec(r.rationale);
      if (m) revisar.push(`${a.vesselCode} ${a.assetCode} (${a.name}) — ${m[0]}`);
      ok++;
      console.log(`  OK   ${a.vesselCode.padEnd(6)} ${String(a.assetCode).padEnd(16)} ${puedeExento ? "SIN PLAN" : "lleva plan"}`);
    } catch (err) {
      fail++;
      const msg = err instanceof Error ? err.message : String(err);
      errores.push(`${a.vesselCode} ${a.assetCode}: ${msg}`);
      console.log(`  FALLA ${a.vesselCode.padEnd(6)} ${String(a.assetCode).padEnd(16)} ${msg}`);
    }
  }

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    await Promise.all(targets.slice(i, i + CONCURRENCY).map(run));
  }

  console.log(`\nFundamentados: ${ok} · Marcados "no requiere plan": ${exentos} · ISM 10.3 agregados: ${ismAgregado.length} · Fallados: ${fail}`);
  if (ismAgregado.length) {
    console.log(`\nSe marcaron como criticos para la seguridad (ISM 10.3), antes estaban sin marcar:`);
    console.log(ismAgregado.map(r => `  + ${r}`).join("\n"));
  }
  if (ismDeMas.length) {
    console.log(`\nLa IA NO los ve safety-critical pero estan marcados (no se toco nada, revisar a mano):`);
    console.log(ismDeMas.map(r => `  ? ${r}`).join("\n"));
  }
  if (revisar.length) {
    console.log(`\nLa IA sugiere revisar la clasificacion de ${revisar.length} equipos (NO se cambio nada):`);
    console.log(revisar.map(r => `  - ${r}`).join("\n"));
  }
  if (errores.length) console.log(`\nErrores:\n${errores.map(e => `  - ${e}`).join("\n")}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
