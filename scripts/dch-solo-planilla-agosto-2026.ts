/**
 * DON CHICUETO — dejar vivos SÓLO los planes que están en la planilla de agosto.
 *
 * Pedido del usuario: que el plan de mantenimiento del sistema sea exactamente
 * la planilla del buque (`08- PMP DON CHICUETO - AGOSTO.xlsm`, cierre 31/08/2026)
 * y nada más. Hoy conviven tres orígenes: la planilla, los manuales de los
 * fabricantes (cargados el 04/08) y unos planes creados a mano para cerrar
 * brechas de cobertura.
 *
 * Qué hace: calcula los planes que la planilla respalda —los mismos 377 que
 * sincroniza `sync-dch-agosto-2026.ts`, emparejados por código y por texto de la
 * tarea— y da de baja TODO el resto de DCH.
 *
 * La baja es la misma del botón "Eliminar" de la pantalla: `deletedAt` +
 * `deletedByUserId`. No borra filas, así que se revierte poniendo `deletedAt` en
 * NULL (el script deja el listado de ids en un JSON para poder hacerlo).
 *
 * Antes de escribir informa qué se lleva puesto: planes con OT ejecutadas,
 * planes que renuevan un certificado y planes de equipos que se quedarían sin
 * ninguna tarea. Eso NO frena el borrado —lo pidió el usuario— pero queda
 * escrito.
 *
 * Uso:
 *   pnpm exec tsx --env-file .env scripts/dch-solo-planilla-agosto-2026.ts
 *   APLICAR=1 ...   ejecuta la baja (sin el flag sólo informa)
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync, writeFileSync } from "node:fs";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = "DCH";
const APLICAR = process.env.APLICAR === "1";
const FUENTE = "scripts/data/dch-agosto-2026-estado.json";
const RESPALDO = "scripts/_tmp-backup-dch-solo-planilla.json";

type Entrada = { taskCode: string; tipo: string; hoja: string; trabajo: string };

/** Texto comparable: sin acentos, sin puntuación y en minúsculas. */
const norm = (s: string) =>
  String(s ?? "")
    .normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim().toLowerCase();

/** Mismo criterio que sync-dch-agosto-2026.ts: código y, si se repite, título. */
function elegirPlan(cands: any[], trabajo: string): any | null {
  if (cands.length === 1) return cands[0];
  const t = norm(trabajo);
  const hit = cands.filter((c) => {
    const titulo = norm(c.title);
    return titulo.includes(t) || t.includes(titulo);
  });
  return hit.length === 1 ? hit[0] : null;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant ${SLUG} no encontrado.`);
  const tenantId: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId, role: "TENANT_ADMIN" },
    select: { userId: true },
  });
  if (!member?.userId) throw new Error(`No hay TENANT_ADMIN en ${SLUG}.`);
  const userId: string = member.userId;

  const doc = JSON.parse(readFileSync(FUENTE, "utf8")) as { fuente: string; planes: Entrada[] };

  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: VESSEL, deletedAt: null },
    select: { id: true, taskCode: true, title: true, assetId: true, sfiGroupNumber: true },
  });

  const byCode = new Map<string, any[]>();
  for (const p of plans as any[]) {
    const arr = byCode.get(p.taskCode);
    if (arr) arr.push(p); else byCode.set(p.taskCode, [p]);
  }

  // 1. Los que se quedan: uno por renglón de la planilla.
  const quedan = new Set<string>();
  const sinResolver: string[] = [];
  for (const e of doc.planes) {
    const cands = byCode.get(e.taskCode);
    if (!cands?.length) { sinResolver.push(`${e.taskCode} (no existe)`); continue; }
    const p = elegirPlan(cands, e.trabajo);
    if (!p) { sinResolver.push(`${e.taskCode} (código repetido, no se pudo decidir)`); continue; }
    quedan.add(p.id);
  }

  const bajas = (plans as any[]).filter((p) => !quedan.has(p.id));

  // 2. Qué se lleva puesto cada baja.
  const ids = bajas.map((p) => p.id);
  const otsDirectas = await prisma.workOrder.groupBy({
    by: ["maintenancePlanId"],
    where: { tenantId, deletedAt: null, maintenancePlanId: { in: ids } },
    _count: { _all: true },
  });
  const otsPorPlan = new Map<string, number>(
    otsDirectas.map((r: any) => [r.maintenancePlanId, r._count._all]),
  );
  const otsVinculadas = await prisma.workOrderMaintenancePlan.groupBy({
    by: ["maintenancePlanId"],
    where: { maintenancePlanId: { in: ids } },
    _count: { _all: true },
  }).catch(() => [] as any[]);
  for (const r of otsVinculadas as any[]) {
    otsPorPlan.set(r.maintenancePlanId, (otsPorPlan.get(r.maintenancePlanId) ?? 0) + r._count._all);
  }

  const certs = await prisma.certificate.findMany({
    where: { tenantId, deletedAt: null, maintenancePlanId: { in: ids } },
    select: { maintenancePlanId: true, name: true },
  }).catch(() => [] as any[]);
  const certsPorPlan = new Map<string, string[]>();
  for (const c of certs as any[]) {
    const arr = certsPorPlan.get(c.maintenancePlanId) ?? [];
    arr.push(c.name);
    certsPorPlan.set(c.maintenancePlanId, arr);
  }

  // 3. Equipos que quedarían sin ninguna tarea viva.
  const assets = await prisma.asset.findMany({
    where: { tenantId, vesselCode: VESSEL, deletedAt: null },
    select: { id: true, assetCode: true, name: true },
  });
  const assetById = new Map<string, any>((assets as any[]).map((a) => [a.id, a]));
  const vivosPorAsset = new Map<string, number>();
  for (const p of plans as any[]) {
    if (!p.assetId || !quedan.has(p.id)) continue;
    vivosPorAsset.set(p.assetId, (vivosPorAsset.get(p.assetId) ?? 0) + 1);
  }
  const huerfanos = (assets as any[]).filter((a) => !vivosPorAsset.get(a.id));

  const conOts = bajas.filter((p) => (otsPorPlan.get(p.id) ?? 0) > 0);
  const conCert = bajas.filter((p) => certsPorPlan.has(p.id));
  const totalOts = conOts.reduce((n, p) => n + (otsPorPlan.get(p.id) ?? 0), 0);

  console.log("── DON CHICUETO · dejar sólo lo que está en la planilla ──");
  console.log(`Fuente: ${doc.fuente}`);
  console.log(APLICAR ? "Modo: APLICAR — da de baja\n" : "Modo: informe — no escribe nada\n");
  console.log(`Planes vivos hoy:            ${plans.length}`);
  console.log(`  respaldados por planilla:  ${quedan.size}`);
  console.log(`  se dan de baja:            ${bajas.length}`);
  console.log(`     de ellos, con OT:       ${conOts.length}  (${totalOts} OT en total)`);
  console.log(`     de ellos, con certif.:  ${conCert.length}`);
  console.log(`Equipos que quedan sin ninguna tarea: ${huerfanos.length}\n`);

  if (sinResolver.length) {
    console.log(`── Renglones de la planilla sin plan asignado (${sinResolver.length}) ──`);
    for (const s of sinResolver) console.log(`  ${s}`);
    console.log();
  }

  if (conOts.length) {
    console.log(`── Bajas CON historial de OT (${conOts.length}) ──`);
    for (const p of conOts.sort((a, b) => (otsPorPlan.get(b.id) ?? 0) - (otsPorPlan.get(a.id) ?? 0))) {
      const a = assetById.get(p.assetId);
      console.log(`  ${String(otsPorPlan.get(p.id)).padStart(3)} OT  ${p.taskCode.padEnd(20)}${String(a?.name ?? "-").slice(0, 26).padEnd(28)}${String(p.title).slice(0, 46)}`);
    }
    console.log();
  }

  if (conCert.length) {
    console.log(`── Bajas que renuevan un certificado (${conCert.length}) ──`);
    for (const p of conCert) {
      console.log(`  ${p.taskCode.padEnd(20)}${String(p.title).slice(0, 40).padEnd(42)}${(certsPorPlan.get(p.id) ?? []).join(", ")}`);
    }
    console.log();
  }

  if (huerfanos.length) {
    console.log(`── Equipos que se quedan sin ninguna tarea (${huerfanos.length}) ──`);
    for (const a of huerfanos) console.log(`  ${a.assetCode.padEnd(20)}${a.name}`);
    console.log();
  }

  if (!APLICAR) {
    console.log("[INFORME] No se escribió nada. Correr con APLICAR=1 para dar de baja.");
    return;
  }

  writeFileSync(RESPALDO, JSON.stringify({
    fecha: new Date().toISOString(),
    fuente: doc.fuente,
    // Para revertir: UPDATE "MaintenancePlan" SET "deletedAt"=NULL WHERE id IN (…)
    dadosDeBaja: bajas.map((p) => ({ id: p.id, taskCode: p.taskCode, title: p.title })),
  }, null, 1), "utf8");

  const ahora = new Date();
  for (const p of bajas) {
    await prisma.maintenancePlan.update({
      where: { id: p.id },
      data: { deletedAt: ahora, deletedByUserId: userId },
    });
  }

  console.log(`OK — ${bajas.length} planes dados de baja, ${quedan.size} vivos (los de la planilla).`);
  console.log(`Respaldo para revertir: ${RESPALDO}`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
