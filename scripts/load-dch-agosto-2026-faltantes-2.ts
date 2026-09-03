/**
 * DON CHICUETO — el último renglón de la planilla de AGOSTO 2026 sin plan.
 *
 * Apareció al rehacer el emparejamiento planilla ↔ plan tarea por tarea: en la
 * primera pasada (`load-dch-plan-agosto-2026.ts`) el cotejo por parecido de texto
 * lo había dado por cubierto contra "Bomba – recorrido general", que no es la
 * misma tarea (esa es cada 6 años, en dique seco).
 *
 * De dónde salió el agujero: el 19/07 el admin del tenant borró
 * `DCH-CENT-HID-01` ("Mantenimiento MENSUAL"), que agrupaba los tres controles
 * mensuales de la central — bomba, válvulas de 2 vías y mangueras — porque la
 * carga de la planilla los había desglosado en planes propios. Pero sólo se
 * crearon dos de los tres (`-31` válvulas y `-32` mangueras): el de la bomba
 * nunca existió, así que al borrar el agrupado quedó sin cubrir.
 *
 * NO se recrea acá "AA SPLIT: Control de aprietes bulonerías, anclajes"
 * (`DCH-AA-SPLIT-32`), que también figura en la planilla sin plan vivo: ese plan
 * existió y el admin lo borró a propósito el 28/08 junto con el agrupado
 * `-02`, quedándose sólo con el control de ventiladores. Volver a crearlo sería
 * deshacer una decisión del cliente de hace días; se consulta antes.
 *
 * Como el resto de los planes de la planilla, los campos de HSE/RCM los completa
 * después `fill-plan-hse-rcm.ts`.
 *
 * Uso:
 *   pnpm exec tsx --env-file .env scripts/load-dch-agosto-2026-faltantes-2.ts
 *   DRY=1 ...   muestra lo que haría, sin escribir
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = "DCH";
const DRY = process.env.DRY === "1";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const SPECS = [
  {
    asset: "DCH-CENT-HID",
    code: "38",
    title: "BOMBA: Bomba – verificar funcionamiento",
    description: "[  ] Bomba – verificar funcionamiento",
    taskType: "INSPECTION" as const,
    frequencyMonths: 1,
    lastExecutionDate: "2026-07-25",
    nextDueDate: "2026-08-25",
    origen: "CTRAL HIDRAULICA guinche-pluma f.4 · mensual",
  },
];

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

  const assets = await prisma.asset.findMany({
    where: { tenantId, vesselCode: VESSEL, assetCode: { in: SPECS.map(s => s.asset) } },
    select: { id: true, assetCode: true, name: true, sfiCode: true },
  });
  const byCode = new Map<string, any>(assets.map((a: any) => [a.assetCode, a]));
  for (const s of SPECS) if (!byCode.has(s.asset)) throw new Error(`Equipo ${s.asset} no existe en ${VESSEL}.`);

  // taskCode es único por tenant+buque y un plan borrado sigue ocupando el suyo.
  const usados = new Set<string>(
    (await prisma.maintenancePlan.findMany({
      where: { tenantId, vesselCode: VESSEL },
      select: { taskCode: true },
    })).map((p: any) => p.taskCode),
  );

  const creates: any[] = [];
  for (const s of SPECS) {
    const asset = byCode.get(s.asset);
    const taskCode = `${s.asset}-${s.code}`;
    if (usados.has(taskCode)) throw new Error(`El código ${taskCode} ya está tomado.`);
    creates.push({
      tenantId,
      vesselCode: VESSEL,
      assetId: asset.id,
      taskCode,
      title: s.title,
      description: s.description,
      triggerType: "MONTHS",
      frequencyMonths: s.frequencyMonths,
      frequencyHours: null,
      taskType: s.taskType,
      department: "MAQUINAS",
      responsible: "Jefe de Máquinas",
      sfiGroupNumber: asset.sfiCode ? Number(String(asset.sfiCode)[0]) : null,
      criteriaSource: "COMPANY_STANDARD",
      triggerResultMode: "AUTO_WO",
      status: "ACTIVE",
      lastExecutionDate: d(s.lastExecutionDate),
      nextDueDate: d(s.nextDueDate),
      createdByUserId: userId,
      updatedByUserId: userId,
    });
  }

  console.log("── DON CHICUETO · últimos dos renglones de la planilla de agosto ──\n");
  for (const s of SPECS) {
    console.log(`  ${s.asset}-${s.code}  ${s.title}`);
    console.log(`      ${byCode.get(s.asset).name} · ${s.origen} · último ${s.lastExecutionDate} · próximo ${s.nextDueDate}`);
  }

  if (DRY) {
    console.log("\n[DRY] No se escribió nada.");
    return;
  }

  const n = (await prisma.maintenancePlan.createMany({ data: creates })).count;
  console.log(`\nOK — ${n} planes creados.`);
}

main()
  .catch(e => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
