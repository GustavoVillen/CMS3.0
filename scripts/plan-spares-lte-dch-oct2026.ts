/**
 * Repuestos previstos en las tareas del plan (MaintenancePlan.spares) de LATERE y
 * DON CHICUETO, con los repuestos cargados el 2026-10-08
 * (load-repuestos-lte-dch-oct2026.ts). Pedido de Gustavo (2026-10-08).
 *
 * Sólo consumibles que la tarea reemplaza siempre (filtros, correas, baterías). No se
 * planifican repuestos de recorridos generales ni de inspecciones.
 *
 * Cantidades por equipo:
 *   - LTE MP Cummins KTA-50: 5 filtros de aceite primarios (registrado en OT-LTE-26-0080)
 *     + 2 secundarios, 2 de aire (OT-LTE-26-0055), 4 baterías (OT-LTE-26-0116/0117).
 *     Gasoil y agua: 2 por motor, consistente con la proporción del inventario frente a
 *     los filtros de aceite, que se cambian en el mismo servicio de 400 h. El filtro de
 *     agua se cambia con el aceite y al renovar el refrigerante.
 *   - DCH MP EMD 8-710: 4 elementos de aceite, 2 del turbo, 2 de gasoil y 1 de aire.
 *     Son las cantidades que mantienen parejo el estándar para viaje del DCH entre
 *     tareas de 1.500 h y 3.000 h.
 *   - Generadores, cajas, compresores e hidráulicos: 1 por posición.
 *   - El generador de puerto del DCH no lleva filtro de aceite: la planilla trae tres
 *     códigos John Deere para «M/G» sin decir cuál va en cada uno.
 *
 * Fusiona con lo que la tarea ya tenía: una línea con el mismo repuesto se actualiza
 * a la cantidad de la regla y las demás líneas se respetan.
 *
 * Uso:  DATABASE_URL=<url> npx tsx scripts/plan-spares-lte-dch-oct2026.ts
 *       DRY=1 ...  → previsualiza sin escribir
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const TENANT_SLUG = process.env.TENANT_SLUG ?? "mercurio";
const DRY = process.env.DRY === "1";

interface Rule { vessel: string; assets: string[]; title: RegExp; items: Array<[sku: string, qty: number]> }

const LTE_MP = ["LTE-MP-#1", "LTE-MP-#2", "LTE-MP-#3", "LTE-MP-#4"];
const LTE_MG = ["LTE-MA-#1", "LTE-MA-#2"];
const LTE_CR = ["LTE-CR-#1", "LTE-CR-#2", "LTE-CR-#3", "LTE-CR-#4"];
const DCH_MP = ["DCH-MP-BR", "DCH-MP-ER"];
const DCH_MG = ["DCH-MA-BR", "DCH-MA-ER"];

const RULES: Rule[] = [
  { vessel: "LTE", assets: LTE_MP, title: /^SERVICE: Cambio de aceite y filtros de aceite/i, items: [["INV-FIL-01", 5], ["INV-FIL-02", 2], ["INV-FIL-04", 2]] },
  { vessel: "LTE", assets: LTE_MP, title: /^FILTROS: Cambio de filtro de Gas Oil/i, items: [["INV-FIL-03", 2]] },
  { vessel: "LTE", assets: LTE_MP, title: /^FILTROS: Cambio de filtro de aire/i, items: [["INV-FIL-05", 2]] },
  { vessel: "LTE", assets: LTE_MP, title: /^LIQUIDO REFRIGERANTE: Renovacion/i, items: [["INV-FIL-04", 2]] },
  { vessel: "LTE", assets: LTE_MP, title: /^BATERIAS DE ARRANQUE/i, items: [["BAT-01", 4]] },

  { vessel: "LTE", assets: LTE_MG, title: /^SERVICE: Cambio de aceite y filtro de aceite/i, items: [["INV-FIL-06", 1], ["INV-FIL-08", 1]] },
  { vessel: "LTE", assets: LTE_MG, title: /^FILTROS: Cambio de filtro de Gas Oil/i, items: [["INV-FIL-07", 1]] },
  { vessel: "LTE", assets: LTE_MG, title: /^FILTROS: Cambio de filtro de aire/i, items: [["INV-FIL-09", 1]] },
  { vessel: "LTE", assets: LTE_MG, title: /^LIQUIDO REFRIGERANTE: Renovacion/i, items: [["INV-FIL-08", 1]] },

  { vessel: "LTE", assets: ["LTE-MA-PTO"], title: /^SERVICE: Cambio de aceite y filtro de aceite/i, items: [["INV-FIL-11", 1]] },
  { vessel: "LTE", assets: ["LTE-MA-PTO"], title: /^FILTROS: Cambio de filtro de Gas Oil/i, items: [["INV-FIL-10", 1]] },
  { vessel: "LTE", assets: ["LTE-MA-PTO"], title: /^FILTROS: Cambio de filtro de aire/i, items: [["INV-FIL-12", 1]] },

  { vessel: "LTE", assets: LTE_CR, title: /^SERVICE: Cambio de aceite, filtro de descarga/i, items: [["INV-FIL-13", 1]] },
  { vessel: "LTE", assets: ["LTE-COMP-NK40"], title: /^CAMBIO: Correas de transmision/i, items: [["INV-COMP-01", 1]] },

  { vessel: "DCH", assets: DCH_MP, title: /^FILTRO ACEITE: Cambio filtro/i, items: [["STD-FIL-01", 4]] },
  { vessel: "DCH", assets: DCH_MP, title: /^FILTRO ACEITE TURBOSOPLANTE/i, items: [["STD-FIL-02", 2]] },
  { vessel: "DCH", assets: DCH_MP, title: /^FILTRO DE COMBUSTIBLE/i, items: [["STD-FIL-06", 2]] },
  { vessel: "DCH", assets: DCH_MP, title: /^FILTRO DE AIRE/i, items: [["STD-FIL-08", 1]] },

  { vessel: "DCH", assets: DCH_MG, title: /^FILTRO DE ACEITE Y ACEITE/i, items: [["STD-FIL-09", 1]] },
  { vessel: "DCH", assets: DCH_MG, title: /^FILTRO GASOIL/i, items: [["STD-FIL-04", 1], ["STD-FIL-13", 1]] },
  { vessel: "DCH", assets: DCH_MG, title: /^FILTRO AIRE/i, items: [["STD-FIL-15", 1]] },

  { vessel: "DCH", assets: ["DCH-MA-PTO"], title: /^FILTRO GASOIL/i, items: [["STD-FIL-12", 1], ["STD-FIL-11", 1]] },
  { vessel: "DCH", assets: ["DCH-MA-PTO"], title: /^FILTRO AIRE/i, items: [["STD-FIL-21", 1]] },

  { vessel: "DCH", assets: ["DCH-COMP-NK40"], title: /Cambio de filtros de aceite, aceite, aire/i, items: [["STD-FIL-17", 1], ["STD-FIL-16", 1], ["STD-FIL-18", 1]] },
  { vessel: "DCH", assets: ["DCH-COMP-1", "DCH-COMP-2"], title: /Cambio aceite y filtro de aire/i, items: [["STD-FIL-19", 1]] },
  { vessel: "DCH", assets: ["DCH-TIM-AV", "DCH-TIM-RE"], title: /Tanque-Filtro de Aceite y aceite/i, items: [["STD-FIL-20", 1]] },
  { vessel: "DCH", assets: ["DCH-CENT-HID"], title: /^ACEITE Y FILTRO/i, items: [["STD-FIL-20", 1]] },
];

// El filtro P550388 es «de timones y central hidráulica» (3 en el estándar = uno por
// sistema): se suma el vínculo a los dos timones, además de la central.
const EXTRA_LINKS: Array<{ vessel: string; sku: string; assets: string[] }> = [
  { vessel: "DCH", sku: "STD-FIL-20", assets: ["DCH-TIM-AV", "DCH-TIM-RE"] },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`No existe el tenant ${TENANT_SLUG}`);
  const tenantId: string = tenant.id;
  const admins = await prisma.tenantMembership.findMany({ where: { tenantId, role: "TENANT_ADMIN" }, select: { userId: true } });
  if (!admins.length) throw new Error("No hay TENANT_ADMIN");
  const actor: string = admins[0].userId;

  const vessels = [...new Set(RULES.map(r => r.vessel))];
  const spares = await prisma.spare.findMany({
    where: { tenantId, vesselCode: { in: vessels }, deletedAt: null },
    select: { id: true, vesselCode: true, sku: true, name: true, unit: true },
  });
  const spareOf = (vessel: string, sku: string) => {
    const s = spares.find((x: any) => x.vesselCode === vessel && x.sku === sku);
    if (!s) throw new Error(`No existe el repuesto ${sku} en ${vessel}`);
    return s;
  };
  for (const r of RULES) for (const [sku] of r.items) spareOf(r.vessel, sku);

  const assets = await prisma.asset.findMany({
    where: { tenantId, vesselCode: { in: vessels }, deletedAt: null }, select: { id: true, assetCode: true },
  });
  const assetId = new Map<string, string>(assets.map((a: any) => [a.assetCode, a.id]));
  const missing = [...new Set([...RULES.flatMap(r => r.assets), ...EXTRA_LINKS.flatMap(l => l.assets)])].filter(c => !assetId.has(c));
  if (missing.length) throw new Error(`Faltan equipos: ${missing.join(", ")}`);

  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: { in: vessels }, deletedAt: null, status: "ACTIVE", assetId: { in: [...assetId.values()] } },
    select: { id: true, vesselCode: true, taskCode: true, title: true, assetId: true, spares: true },
  });
  const codeOf = new Map<string, string>(assets.map((a: any) => [a.id, a.assetCode]));

  const updates: Array<{ id: string; taskCode: string; before: unknown; after: any[] }> = [];
  const matchedRules = new Map<Rule, number>();
  for (const p of plans) {
    const code = codeOf.get(p.assetId)!;
    const rules = RULES.filter(r => r.vessel === p.vesselCode && r.assets.includes(code) && r.title.test(p.title));
    if (!rules.length) continue;
    for (const r of rules) matchedRules.set(r, (matchedRules.get(r) ?? 0) + 1);

    const next: any[] = Array.isArray(p.spares) ? p.spares.map((s: any) => ({ ...s })) : [];
    for (const r of rules) for (const [sku, qty] of r.items) {
      const s = spareOf(r.vessel, sku);
      const line = next.find(x => x?.spareId === s.id);
      if (line) line.quantity = qty;
      else next.push({ kind: "SPARE", spareId: s.id, description: `${s.sku} — ${s.name}`, quantity: qty, unit: s.unit });
    }
    if (JSON.stringify(next) === JSON.stringify(p.spares)) continue;
    updates.push({ id: p.id, taskCode: p.taskCode, before: p.spares, after: next });
  }

  const unused = RULES.filter(r => !matchedRules.has(r));
  if (unused.length) throw new Error(`Reglas sin ninguna tarea:\n  ${unused.map(r => `${r.vessel} ${r.assets.join(",")} ${r.title}`).join("\n  ")}`);

  for (const u of updates) {
    console.log(`  ${u.taskCode}: ${u.after.map(x => `${x.description.split(" — ")[0]} x${x.quantity}`).join(" + ")}`);
  }
  console.log(`Tareas a actualizar: ${updates.length}`);
  if (DRY) { console.log("DRY: no se escribió nada"); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`scripts/_tmp-backup-plan-spares-${stamp}.json`, JSON.stringify(updates.map(u => ({ id: u.id, taskCode: u.taskCode, spares: u.before })), null, 1));

  await prisma.$transaction(async (tx: any) => {
    for (const u of updates) {
      await tx.maintenancePlan.update({ where: { id: u.id }, data: { spares: u.after, updatedByUserId: actor } });
    }
    for (const l of EXTRA_LINKS) {
      const s = spareOf(l.vessel, l.sku);
      await tx.spareAsset.createMany({
        data: l.assets.map(c => ({ tenantId, spareId: s.id, assetId: assetId.get(c)!, createdByUserId: actor })),
        skipDuplicates: true,
      });
    }
  }, { timeout: 120000 });
  console.log("Listo.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
