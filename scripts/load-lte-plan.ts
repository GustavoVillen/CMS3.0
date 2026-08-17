/**
 * Aplica al LATERE (LTE) un lote de planes de mantenimiento sacado del plan en
 * papel "PLAN DE MANT. LTE - JULIO.xlsx".
 *
 * Es el cargador generico de todas las tandas: recibe por argumento un JSON con
 * los planes ya resueltos (lo genera el script Python de cada hoja del Excel) y
 * lo aplica contra la base. No hay numeros escritos aca: todo viene del Excel.
 *
 * Un plan del JSON se considera "el mismo" que uno del sistema cuando coinciden
 * el activo y el sufijo numerico del taskCode (LTE-MP-BR-01, LTE-MP-#3-01 -> "01").
 * Si existe se corrige; si no, se crea. El taskCode viejo se respeta: renombrarlo
 * no aporta nada y los planes ya tienen historial colgando.
 *
 * Los planes del sistema que quedan sin par conservan su tarea, su frecuencia y
 * su modo de disparo: se listan al final para el informe (son en general tareas
 * de clase o del fabricante que no figuran en la planilla de papel). Lo unico
 * que se les completa es el area y el responsable, que el plan de maquinas del
 * buque exige en todos sus planes por igual.
 *
 * NO toca criterios de aceptacion, LOTO, riesgo ni RCM: eso lo completa despues
 * load-lte-plan-ia.ts.
 *
 * Idempotente: se puede correr las veces que haga falta.
 *
 * Uso (en el VPS):
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/load-lte-plan.ts scripts/_tmp-lte-cajas-plans.json
 *   npx tsx scripts/load-lte-plan.ts scripts/_tmp-lte-cajas-plans.json
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const TENANT_SLUG = "mercurio";
const VESSEL = "LTE";
const USER_LEGACY_ID = "MAQUINASLATERE";

interface PlanSpec {
  asset: string;
  code: string;
  title: string;
  description: string;
  triggerType: "HOURS" | "MONTHS" | "DAY" | "WEEK" | "EVENT" | "CONDITION";
  taskType: "MAINTENANCE" | "INSPECTION";
  frequencyHours: number | null;
  frequencyMonths: number | null;
  lastExecutionHours: number | null;
  nextDueHours: number | null;
  lastExecutionDate: string | null;
  nextDueDate: string | null;
  samplingKind?: string;
  samplingFluidType?: string;
  origen?: string;
  nota?: string | null;
}

/** Ficha del activo a corregir cuando el plan en papel la contradice. */
interface AssetFix { asset: string; manufacturer?: string; model?: string; name?: string }

/** Equipo que esta en el plan en papel pero todavia no existe como activo. */
interface AssetNew {
  assetCode: string;
  name: string;
  sfiCode?: string;
  criticality?: "A" | "B" | "C";
  manufacturer?: string;
  model?: string;
}

interface Lote {
  titulo: string;
  planes: PlanSpec[];
  assetFixes?: AssetFix[];
  assetCreates?: AssetNew[];
}

/** Sufijo numerico del taskCode: LTE-MP-BR-01 -> "01", LTE-CR-#3-08 -> "08". */
function codeSuffix(taskCode: string): string {
  const m = taskCode.match(/-(\d+)$/);
  return m ? m[1] : taskCode;
}

const d = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

async function main() {
  const src = process.argv[2];
  if (!src) throw new Error("Indicar el JSON del lote. Ej: scripts/_tmp-lte-cajas-plans.json");
  const lote: Lote = JSON.parse(readFileSync(src, "utf8"));
  const specs = lote.planes;

  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} no encontrado`);
  const tenantId = tenant.id;

  const user = await prisma.user.findFirst({
    where: { legacyUserId: USER_LEGACY_ID },
    select: { id: true, firstName: true },
  });
  if (!user) throw new Error(`Usuario ${USER_LEGACY_ID} no encontrado`);

  // Activos que toca este lote: los de los planes, mas los que solo vienen a que
  // se les corrija la ficha (p. ej. unificar el nombre de equipos hermanos).
  const assetCodes = [...new Set(specs.map(s => s.asset))];
  const todosLosCodes = [...new Set([...assetCodes, ...(lote.assetFixes ?? []).map(f => f.asset)])];
  const SEL = { id: true, assetCode: true, name: true, sfiCode: true, manufacturer: true, model: true };

  // Alta de los equipos del plan en papel que todavia no existen como activo.
  // Idempotente: si ya estan, no se crea nada.
  const declarados = lote.assetCreates ?? [];
  const yaExisten = new Set((await prisma.asset.findMany({
    where: { tenantId, vesselCode: VESSEL, assetCode: { in: declarados.map(a => a.assetCode) } },
    select: { assetCode: true },
  })).map((a: any) => a.assetCode));
  const nuevos = declarados.filter(a => !yaExisten.has(a.assetCode));

  if (nuevos.length && !DRY) {
    await prisma.asset.createMany({
      data: nuevos.map(a => ({
        tenantId, vesselCode: VESSEL,
        assetCode: a.assetCode, name: a.name,
        sfiCode: a.sfiCode ?? null,
        criticality: a.criticality ?? "B",
        manufacturer: a.manufacturer ?? null,
        model: a.model ?? null,
        createdByUserId: user.id, updatedByUserId: user.id,
      })),
    });
  }

  const todos = await prisma.asset.findMany({
    where: { tenantId, vesselCode: VESSEL, assetCode: { in: todosLosCodes }, deletedAt: null },
    select: SEL,
  });
  // Los planes solo se buscan y escriben sobre los activos del lote; los que
  // vinieron unicamente por assetFixes no aportan planes.
  const assets = todos.filter((a: any) => assetCodes.includes(a.assetCode));
  const byCode = new Map<string, any>(todos.map((a: any) => [a.assetCode, a]));
  // En DRY los nuevos no llegaron a crearse: se simulan para poder previsualizar
  // sus planes sin escribir nada.
  if (DRY) {
    for (const a of nuevos) {
      byCode.set(a.assetCode, { id: `(nuevo:${a.assetCode})`, assetCode: a.assetCode, name: a.name, sfiCode: a.sfiCode ?? null });
    }
  }
  const faltantes = assetCodes.filter(c => !byCode.has(c));
  if (faltantes.length) throw new Error(`Activos inexistentes en ${VESSEL}: ${faltantes.join(", ")}`);

  const existing = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: VESSEL, assetId: { in: assets.map((a: any) => a.id) }, deletedAt: null },
  });
  writeFileSync(`scripts/_tmp-backup-${basename(src, ".json")}.json`, JSON.stringify(existing, null, 1));

  const plans = new Map<string, any>();
  for (const p of existing) plans.set(`${p.assetId}|${codeSuffix(p.taskCode)}`, p);

  const creates: any[] = [];
  const updates: { plan: any; data: any; spec: PlanSpec }[] = [];

  for (const s of specs) {
    const asset = byCode.get(s.asset)!;
    const data: any = {
      title: s.title,
      description: s.description,
      triggerType: s.triggerType,
      frequencyHours: s.frequencyHours,
      frequencyMonths: s.frequencyMonths,
      taskType: s.taskType,
      department: "MAQUINAS",
      responsible: "Jefe de Máquinas",
      sfiGroupNumber: asset.sfiCode ? Number(String(asset.sfiCode)[0]) : null,
      triggerResultMode: "AUTO_WO",
      status: "ACTIVE",
      lastExecutionHours: s.lastExecutionHours,
      nextDueHours: s.nextDueHours,
      lastExecutionDate: d(s.lastExecutionDate),
      nextDueDate: d(s.nextDueDate),
      samplingKind: s.samplingKind ?? null,
      samplingFluidType: s.samplingFluidType ?? null,
      updatedByUserId: user.id,
    };
    const found = plans.get(`${asset.id}|${s.code}`);
    if (found) updates.push({ plan: found, data, spec: s });
    else creates.push({
      ...data, tenantId, vesselCode: VESSEL, assetId: asset.id,
      taskCode: `${s.asset}-${s.code}`, createdByUserId: user.id,
    });
  }

  const tocados = new Set(updates.map(u => u.plan.id));
  const sinPar = existing.filter((p: any) => !tocados.has(p.id));
  const assetById = new Map<string, any>(assets.map((a: any) => [a.id, a]));

  // A los sin par solo se les completa area y responsable (y se unifica el
  // responsable, que venia escrito "Jefe de Maquinas" sin tilde en los planes
  // heredados del clon).
  const normaliza = sinPar.filter((p: any) =>
    p.department !== "MAQUINAS" || p.responsible !== "Jefe de Máquinas");

  console.log(`── ${lote.titulo} ──`);
  console.log(`Buque ${VESSEL} · usuario ${user.firstName}`);
  console.log(`Corrige ${updates.length} · crea ${creates.length} · deja sin tocar ${sinPar.length}\n`);

  if (nuevos.length) {
    console.log("ACTIVOS NUEVOS (no existian en el sistema)");
    for (const a of nuevos) console.log(`  ${a.assetCode.padEnd(16)} SFI ${a.sfiCode ?? "-"}  crit ${a.criticality ?? "B"}  ${a.name}`);
    console.log("");
  }

  console.log("CAMBIOS DE FRECUENCIA");
  let cambios = 0;
  for (const u of updates) {
    const before = u.plan.triggerType === "HOURS" ? `${u.plan.frequencyHours}h`
      : u.plan.frequencyMonths ? `${u.plan.frequencyMonths}m` : u.plan.triggerType;
    const after = u.data.triggerType === "HOURS" ? `${u.data.frequencyHours}h`
      : u.data.frequencyMonths ? `${u.data.frequencyMonths}m` : u.data.triggerType;
    if (before !== after) {
      cambios++;
      console.log(`  ${u.plan.taskCode.padEnd(18)} ${before.padStart(8)} → ${after.padStart(8)}  ${u.data.title}`);
    }
  }
  if (!cambios) console.log("  (ninguno)");

  if (creates.length) {
    console.log("\nNUEVOS");
    for (const c of creates) {
      const f = c.triggerType === "HOURS" ? `${c.frequencyHours}h`
        : c.frequencyMonths ? `${c.frequencyMonths}m` : c.triggerType;
      console.log(`  ${c.taskCode.padEnd(18)} ${f.padStart(8)}  ${c.title}`);
    }
  }

  if (sinPar.length) {
    console.log("\nEN EL SISTEMA PERO NO EN EL PLAN EN PAPEL (se conserva tarea y frecuencia)");
    for (const p of sinPar) {
      const f = p.triggerType === "HOURS" ? `${p.frequencyHours}h`
        : p.frequencyMonths ? `${p.frequencyMonths}m` : p.triggerType;
      console.log(`  ${assetById.get(p.assetId)?.assetCode.padEnd(12)} ${p.taskCode.padEnd(18)} ${f.padStart(8)}  ${p.title}`);
    }
    console.log(`  → a ${normaliza.length} de ellos se les completa area/responsable`);
  }

  const notas = specs.filter(s => s.nota);
  if (notas.length) {
    console.log("\nOBSERVACIONES SOBRE LOS DATOS DEL PLAN EN PAPEL");
    for (const s of notas) console.log(`  ${s.asset} · ${s.title}\n     ${s.nota}`);
  }

  if (lote.assetFixes?.length) {
    console.log("\nFICHA DE ACTIVOS A CORREGIR");
    for (const f of lote.assetFixes) {
      const a = byCode.get(f.asset);
      if (f.name) console.log(`  ${f.asset}: nombre "${a?.name}" → "${f.name}"`);
      if (f.manufacturer || f.model) {
        console.log(`  ${f.asset}: ${a?.manufacturer ?? "-"} ${a?.model ?? ""} → ${f.manufacturer ?? a?.manufacturer} ${f.model ?? a?.model}`);
      }
    }
  }

  if (DRY) {
    console.log("\n[DRY] No se escribio nada.");
    return;
  }

  for (const u of updates) await prisma.maintenancePlan.update({ where: { id: u.plan.id }, data: u.data });
  const nNew = creates.length ? (await prisma.maintenancePlan.createMany({ data: creates })).count : 0;

  for (const p of normaliza) {
    await prisma.maintenancePlan.update({
      where: { id: p.id },
      data: { department: "MAQUINAS", responsible: "Jefe de Máquinas", updatedByUserId: user.id },
    });
  }

  let nFix = 0;
  for (const f of lote.assetFixes ?? []) {
    const data: any = {};
    if (f.manufacturer) data.manufacturer = f.manufacturer;
    if (f.model) data.model = f.model;
    if (f.name) data.name = f.name;
    if (Object.keys(data).length) {
      await prisma.asset.update({ where: { id: byCode.get(f.asset).id }, data });
      nFix++;
    }
  }

  console.log(`\nOK — ${nuevos.length} activos dados de alta, ${updates.length} planes corregidos, ${nNew} creados, ${normaliza.length} con area/responsable completados, ${nFix} fichas de activo ajustadas.`);
  console.log(`Respaldo previo: scripts/_tmp-backup-${basename(src, ".json")}.json`);
}

main().catch(e => { console.error("ERROR:", e.message ?? e); process.exitCode = 1; }).finally(() => process.exit());
