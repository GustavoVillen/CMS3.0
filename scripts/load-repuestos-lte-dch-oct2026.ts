/**
 * Reemplazo de repuestos pedido por Gustavo (2026-10-08). Mismo criterio que
 * load-mao02-estandar-pdf.ts:
 *
 *   LTE (LATERE): se dan de baja TODOS los repuestos del buque y se cargan los del
 *     inventario de setiembre 2026 (MisDocs/LTE/Repuestos: "INVENTARIO SETIEMBRE 2026"
 *     y "INVENTARIO DE FILTROS SEPTIEMBRE 2026", ambos del 05/09/2026). Las
 *     herramientas del inventario no son repuestos y no se cargan. El inventario no
 *     trae estándar: targetStock queda vacío y la cantidad es la remanencia a bordo.
 *   DCH (DON CHICUETO): se dan de baja SOLO los filtros (category Filtro*) y se cargan
 *     los 21 filtros del "Estándar de filtros y lubricantes" SC-01-DCH-24-09-2026.
 *     Los lubricantes de esa planilla no se tocan (el pedido fue de filtros).
 *
 *   - Baja lógica (deletedAt), no DELETE: OT cerradas guardan el id en sus ítems.
 *   - Remanencia a bordo = movimiento ADJUSTMENT_PLUS de carga inicial.
 *   - "Equipos donde se usa" (SpareAsset) según el bloque o la columna del documento.
 *   - Tareas del plan y OT abiertas que citaban un repuesto dado de baja se reapuntan
 *     a su equivalente nuevo (lista REMAP explícita, no por coincidencia de nombre).
 *
 * Uso:  DATABASE_URL=<url> VESSEL=LTE|DCH npx tsx scripts/load-repuestos-lte-dch-oct2026.ts
 *       DRY=1 ...  → previsualiza sin escribir
 * Idempotente: si ya existen los SKU nuevos del buque, no hace nada.
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const TENANT_SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = process.env.VESSEL ?? "";
const DRY = process.env.DRY === "1";
const LOCATION = "Pañol Maquinas";

interface Item {
  sku: string;
  name: string;
  category: string;
  unit: string;
  onBoard: number;
  standard?: number;
  pn?: string;
  manufacturer?: string;
  sfi?: string;
  assets?: string[];
  printed: string;   // cómo figura en el documento, para trazabilidad
  note?: string;
}

interface Remap { kind: "plan" | "wo"; code: string; oldSku: string; newSku: string }

interface VesselLoad {
  prefix: string;               // SKU de los nuevos; también es la marca de idempotencia
  source: string;
  occurredAt: Date;
  retire: (s: { category: string | null }) => boolean;
  items: Item[];
  remap: Remap[];
}

// ─── LATERE ──────────────────────────────────────────────────────────────────
const LTE_MP = "motor principal Cummins KTA-50";
const LTE_MG = "motor generador Cummins N855";
const LTE_A_MP = ["LTE-MP-#1", "LTE-MP-#2", "LTE-MP-#3", "LTE-MP-#4"];
const LTE_A_MG = ["LTE-MA-#1", "LTE-MA-#2", "LTE-MA-PTO"];
const LTE_A_MG_PRINC = ["LTE-MA-#1", "LTE-MA-#2"];
const LTE_A_MG_AUX = ["LTE-MA-PTO"];
const LTE_A_CR = ["LTE-CR-#1", "LTE-CR-#2", "LTE-CR-#3", "LTE-CR-#4"];

const mp = (sku: string, name: string, category: string, onBoard: number, printed: string): Item =>
  ({ sku, name: `${name} para ${LTE_MP}`, category, unit: "ud", onBoard, assets: LTE_A_MP, printed });
const mg = (sku: string, name: string, category: string, onBoard: number, printed: string, note?: string): Item =>
  ({ sku, name: `${name} para ${LTE_MG}`, category, unit: "ud", onBoard, assets: LTE_A_MG, printed, note });
const flt = (sku: string, name: string, pn: string, onBoard: number, assets: string[], printed: string, manufacturer = "Fleetguard"): Item =>
  ({ sku, name, category: "Filtro", unit: "ud", onBoard, pn, manufacturer, assets, printed });

const LTE: VesselLoad = {
  prefix: "INV-",
  source: "Inventario de repuestos del LATERE del 05/09/2026",
  occurredAt: new Date("2026-09-05T12:00:00.000Z"),
  retire: () => true,
  items: [
    mp("INV-MP-01", "Termostato usado", "Termostato", 10, "TERMOSTATO · USADO · M/P"),
    mp("INV-MP-02", "Junta de culata", "Junta", 15, "Junta culata · Nuevo · MP."),
    mp("INV-MP-03", "Manguera de agua de retorno del compensador", "Manguera", 7, "Manguera de agua retorno compenso · MP."),
    mp("INV-MP-04", "Sensor de presión de aceite", "Sensor", 1, "Sensor presión de aceite · Nuevo · MP."),
    mp("INV-MP-05", "Junta sello cooler", "Junta", 8, "Junta cello cooler · Nuevo · MP."),
    mp("INV-MP-06", "Junta de aftercooler", "Junta", 4, "Junta aster cooler · Nuevo · MP."),
    mp("INV-MP-07", "Junta de tapa de levas", "Junta", 6, "Junta tapa leva · Nuevo · MP."),
    mp("INV-MP-08", "Botador", "Repuesto", 2, "Botador · Nuevo · MP."),
    mp("INV-MP-09", "Sello a prueba de polvo", "Sello", 6, "Sello a prueba de polvo · Nuevo · MP."),
    mp("INV-MP-10", "Junta de escape", "Junta", 3, "Junta escape · Nuevo · MP."),
    mp("INV-MP-11", "O-ring para riel colector", "Sello", 17, "Orring para riel colector · Nuevo · MP."),
    mp("INV-MP-12", "Tornillo para riel colector", "Repuesto", 12, "Tornillo para riel colector · Nuevo · MP."),
    mp("INV-MP-13", "Abrazadera de caño de escape", "Abrazadera", 4, "Abrazadera de caño escape · Nuevo · MP."),
    mp("INV-MP-14", "Sello anillo tórico", "Sello", 30, "Sello anillo tórico · Nuevo · MP."),
    mp("INV-MP-15", "Pico inyector a recorrer", "Inyector", 16, "Pico inyector recorrido · A RECORRER · M/P"),
    mp("INV-MP-16", "Turbo recorrido", "Turbo", 2, "TURBO · RECORRIDO · M/P"),
    mp("INV-MP-17", "Bomba de agua recorrida", "Bomba", 1, "BOMBA DE AGUA · RECORRIDO · M/P"),
    mg("INV-MG-01", "Retén de guía de válvula", "Retén", 6, "Reten guía de válvula · Nuevo · MG.",
      "En el inventario está en el bloque del motor propulsor, pero la columna «Para qué» indica MG"),
    mg("INV-MG-02", "Pico inyector nuevo", "Inyector", 5, "Pico inyector NUEVO · Nuevo · MG"),
    mg("INV-MG-03", "Pico inyector a recorrer", "Inyector", 12, "Pico inyector usado · A recorrer · MG"),
    mg("INV-MG-04", "Correa de alternador", "Correa", 1, "Corea alternador · Nuevo · MG"),
    mg("INV-MG-05", "Retén de bancada trasero", "Retén", 1, "Reten bancada tracero · Nuevo · MG."),
    mg("INV-MG-06", "Junta de tapa de balancines", "Junta", 3, "Junta tapa balancín · Nuevo · MG"),
    mg("INV-MG-07", "Bomba de agua recorrida", "Bomba", 1, "Bomba de agua · RECORRIDO · M/G"),
    { sku: "INV-COMP-01", name: "Correa para compresor", category: "Correa", unit: "ud", onBoard: 2,
      assets: ["LTE-COMP-NK40"], printed: "Correa para compresor · Nuevo (bloque Compresor)" },
    flt("INV-FIL-01", `Filtro de aceite primario para ${LTE_MP}`, "LF3325", 50, LTE_A_MP, "Filtro de aceite PRIMARIO · FLETGUARD LF-3325 · PROPULSOR"),
    flt("INV-FIL-02", `Filtro de aceite secundario para ${LTE_MP}`, "LF777", 26, LTE_A_MP, "Filtro de aceite SECUNDARIO · FLETGUARD LF-777 · PROPULSOR"),
    flt("INV-FIL-03", `Filtro de gasoil para ${LTE_MP}`, "FS19841", 23, LTE_A_MP, "Filtro de gasoil · FLETGUARD FS-19841 · PROPULSOR"),
    flt("INV-FIL-04", `Filtro de agua para ${LTE_MP}`, "WF2075", 25, LTE_A_MP, "Filtro de agua · FLETGUARD WF 2075 · PROPULSOR"),
    flt("INV-FIL-05", `Filtro de aire para ${LTE_MP}`, "AF4553M", 10, LTE_A_MP, "Filtro de aire · FLETGUARDAF-4553M · PROPULSOR"),
    flt("INV-FIL-06", "Filtro de aceite para motores generadores principales", "LF9009", 9, LTE_A_MG_PRINC, "Filtro de aceite · FLETGUARD LF-9009 · GENERADOR"),
    flt("INV-FIL-07", "Filtro de gasoil para motores generadores principales", "FF105D", 9, LTE_A_MG_PRINC, "Filtro de gasoil · FLETGUARD FF-105D · GENERADOR"),
    flt("INV-FIL-08", "Filtro de agua para motores generadores principales", "WF2076", 14, LTE_A_MG_PRINC, "Filtro de agua · FLETGUARD WF 2076 · GENERADOR"),
    flt("INV-FIL-09", "Filtro de aire para motores generadores principales", "AF928M", 3, LTE_A_MG_PRINC, "Filtro de aire · FLETGUARD AF-928M · GENERADOR"),
    flt("INV-FIL-10", "Filtro de gasoil para motor generador auxiliar", "FF5052", 6, LTE_A_MG_AUX, "Filtro de gasoil · FLETGUARD FF 5052 · M/G AUX"),
    flt("INV-FIL-11", "Filtro de aceite para motor generador auxiliar", "LF3959", 8, LTE_A_MG_AUX, "Filtro de aceite · FLETGUARD LF 3959 · M/G AUX"),
    flt("INV-FIL-12", "Filtro de aire para motor generador auxiliar", "AH19003", 6, LTE_A_MG_AUX, "Filtro de aire · FLETGUARD AH 19003 · M/G AUX"),
    flt("INV-FIL-13", "Filtro de aceite para cajas reductoras Reintjes", "A-550019", 8, LTE_A_CR, "FILTRO DE ACEITE · REINTJES A-550019 · CAJA RED.", "Reintjes"),
  ],
  remap: [
    // Cambio de aceite y filtros de aceite de los MP: citaban por error el filtro del compresor.
    { kind: "plan", code: "LTE-MP-#4-01", oldSku: "COMP-FIL-ACE-01", newSku: "INV-FIL-01" },
    { kind: "plan", code: "LTE-MP-BR-01", oldSku: "COMP-FIL-ACE-01", newSku: "INV-FIL-01" },
    // OT abierta de recorrido de inyectores N°1 a N°16 del MP #3: citaba el inyector del generador.
    { kind: "wo", code: "OT-LTE-26-0115", oldSku: "GEN-INY-01", newSku: "INV-MP-15" },
  ],
};

// ─── DON CHICUETO ────────────────────────────────────────────────────────────
const DCH_MP = "motores principales EMD 710";
const DCH_MG = "motores generadores John Deere";
const DCH_A_MP = ["DCH-MP-BR", "DCH-MP-ER"];
const DCH_A_MG = ["DCH-MA-BR", "DCH-MA-ER"];
const DCH_A_MG_PTO = ["DCH-MA-PTO"];

const std = (n: number, name: string, standard: number, onBoard: number, pn: string | undefined,
  manufacturer: string | undefined, assets: string[] | undefined, printed: string, note?: string, sfi?: string): Item =>
  ({ sku: `STD-FIL-${String(n).padStart(2, "0")}`, name, category: "Filtro", unit: "Unid.", standard, onBoard,
    pn, manufacturer, assets, printed, note, sfi });

const DCH: VesselLoad = {
  prefix: "STD-FIL-",
  source: "Estándar de filtros y lubricantes para viaje SC-01-DCH-24-09-2026, firmado por el Jefe de Máquinas",
  occurredAt: new Date("2026-09-24T12:00:00.000Z"),
  retire: s => /^filtro/i.test(s.category ?? ""),
  items: [
    std(1, `Filtro de aceite para ${DCH_MP}`, 33, 33, "P1510", "Baldwin", DCH_A_MP, "Filtro de aceite MMPP Baldwin P1510"),
    std(2, `Filtro de aceite para ${DCH_MP}`, 10, 10, "40035123", "Electro-Motive", DCH_A_MP, "Filtro de aceite MMPP Electro Motive 40035123"),
    std(3, `Filtro de aceite para ${DCH_MP}`, 12, 12, "P554005", "Donaldson", DCH_A_MP, "Filtro de aceite MMPP Donaldson (paralelo a 40035123) P554005", "Alternativo al original EMD 40035123"),
    std(4, "Filtro de gasoil Racor 2020 (RAMA) para motores generadores", 15, 13, "2020", "Racor", DCH_A_MG, "Filtro de gasoil RACOR 2020 RAMA M/G"),
    std(5, "Filtro de gasoil Racor SFR", 12, 12, "FW 2130", "Racor", undefined, "Filtro de gasoil RACOR SFR (racor) FW 2130", "La planilla no indica el equipo"),
    std(6, `Filtro de gasoil para ${DCH_MP}`, 18, 18, "40052587", "Electro-Motive", DCH_A_MP, "Filtro de gasoil MMPP Electro motive 40052587"),
    std(7, `Filtro de gasoil para ${DCH_MP}`, 11, 11, "33406", "Wix", DCH_A_MP, "Filtro de gasoil MMPP Wix (Paralelo a 40052587) 33406", "Alternativo al original EMD 40052587"),
    std(8, `Filtro de aire para ${DCH_MP}`, 6, 6, "P618921", undefined, DCH_A_MP, "Filtro de aire MMPP Air filter P618921"),
    std(9, `Filtro de aceite para ${DCH_MG}`, 15, 15, "RE504836", "John Deere", DCH_A_MG, "Filtro de aceite john Deere M/G RE 504836"),
    std(10, `Filtro de aceite para ${DCH_MG}`, 10, 10, "RE502284", "John Deere", DCH_A_MG, "Filtro de aceite john Deere M/G RE 502284"),
    std(11, "Filtro de gasoil para motor generador de puerto John Deere", 18, 18, "RE509036", "John Deere", DCH_A_MG_PTO, "Filtro de gasoil John Deere M/G de Pto. RE 509036"),
    std(12, "Filtro de gasoil para motor generador de puerto John Deere", 20, 20, "RE509032", "John Deere", DCH_A_MG_PTO, "Filtro de gasoil John Deere M/G de Pto. RE 509032"),
    std(13, `Filtro de gasoil para ${DCH_MG}`, 19, 19, "RE531278", "John Deere", DCH_A_MG, "Filtro de gasoil john Deere M/G RE 531278"),
    std(14, `Filtro de aceite para ${DCH_MG}`, 19, 19, "RE520906", "John Deere", DCH_A_MG, "Filtro de aceite john Deere M/G RE 520906"),
    std(15, `Filtro de aire para ${DCH_MG}`, 5, 3, "RE527920", "John Deere", DCH_A_MG, "Filtro de aire john Deere M/G RE 527920"),
    std(16, "Filtro separador de aceite para compresor a tornillo Cetec NK-40", 5, 5, "LB 962/2", "Mann Filter", ["DCH-COMP-NK40"], "Filtro de aceite Mann Filter compresor Cetec LB 962/2"),
    std(17, "Filtro de aceite para compresor a tornillo Cetec NK-40", 7, 7, "WD 920", "Mann Filter", ["DCH-COMP-NK40"], "Filtro de aceite Mann Filter compresor Cetec WD 920"),
    std(18, "Filtro de aire para compresor a tornillo Cetec NK-40", 5, 5, "C 1213", "Mann Filter", ["DCH-COMP-NK40"], "Filtro de aire Mann Filter compresor Cetec C1213"),
    std(19, "Filtro de aire para compresores a pistón Airdin 41", 3, 3, undefined, undefined, ["DCH-COMP-1", "DCH-COMP-2"], "Filtro de aire sin nombre compresor Airdin Sin código", "La planilla no trae marca ni código"),
    std(20, "Filtro de aceite para central hidráulica de timones", 3, 3, "P550388", undefined, ["DCH-CENT-HID"], "Filtro de aceite de timones T central hidraulica P 550388", undefined, "700"),
    std(21, "Filtro de aire para motor generador de puerto Scania", 13, 13, "219517", "Scania", DCH_A_MG_PTO, "Filtro de aire Scania M/G de Pto. 219517"),
  ],
  remap: [
    { kind: "plan", code: "DCH-MA-BR-2", oldSku: "RE 504836", newSku: "STD-FIL-09" },
    { kind: "wo", code: "OT-DCH-26-0313", oldSku: "RE 504836", newSku: "STD-FIL-09" },
  ],
};

// ─── MAO 02 ──────────────────────────────────────────────────────────────────
// Sólo se SUMAN los 3 repuestos del inventario REGI-MAN-04.1 del 14/09/2026; el
// estándar del 09/09 (STD-*, load-mao02-estandar-pdf.ts) queda como está.
const M02_MG = "Motores generadores Cummins 4BTA 3.9";

const M02: VesselLoad = {
  prefix: "INV-",
  source: "Inventario de repuestos y herramientas REGI-MAN-04.1 del MAO 02 del 14/09/2026",
  occurredAt: new Date("2026-09-14T12:00:00.000Z"),
  retire: () => false,
  items: [
    { sku: "INV-MG-01", name: `Bomba inyectora recorrida para ${M02_MG}`, category: "Bomba", unit: "UN", onBoard: 2,
      assets: ["M02-MA-BR", "M02-MA-ER"], printed: "BOMBA INYECTORA · RECORRIDO · GENERADOR CUMMINS · 02 UND" },
    { sku: "INV-MG-02", name: `Bomba de agua para ${M02_MG}`, category: "Bomba", unit: "UN", onBoard: 2,
      assets: ["M02-MA-BR", "M02-MA-ER"], printed: "BOMBA DE AGUA · NUEVO · GENERADOR CUMMINS · 02 UND" },
    { sku: "INV-MG-03", name: `Retén de cigüeñal para ${M02_MG}`, category: "Retén", unit: "UN", onBoard: 2,
      assets: ["M02-MA-BR", "M02-MA-ER"], printed: "RETEN DE SIGUEÑAL · NUEVO · GENERADOR CUMMINS · 02 UND" },
  ],
  remap: [],
};

const LOADS: Record<string, VesselLoad> = { LTE, DCH, M02 };

async function main() {
  const cfg = LOADS[VESSEL];
  if (!cfg) throw new Error(`VESSEL debe ser ${Object.keys(LOADS).join(" o ")}`);

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`No existe el tenant ${TENANT_SLUG}`);
  const tenantId: string = tenant.id;

  const admins = await prisma.tenantMembership.findMany({
    where: { tenantId, role: "TENANT_ADMIN" }, select: { userId: true },
  });
  if (!admins.length) throw new Error("No hay TENANT_ADMIN");
  const actor: string = admins[0].userId;

  const already = await prisma.spare.count({ where: { tenantId, vesselCode: VESSEL, sku: { startsWith: cfg.prefix }, deletedAt: null } });
  if (already > 0) { console.log(`Ya hay ${already} repuestos ${cfg.prefix}* en ${VESSEL}: nada que hacer.`); return; }

  const skus = cfg.items.map(i => i.sku);
  if (new Set(skus).size !== skus.length) throw new Error("SKU repetido en la lista");
  const taken = await prisma.spare.findMany({ where: { tenantId, vesselCode: VESSEL, sku: { in: skus } }, select: { sku: true } });
  if (taken.length) throw new Error(`SKU ya usados (aun dados de baja): ${taken.map((t: any) => t.sku).join(", ")}`);

  const assets = await prisma.asset.findMany({
    where: { tenantId, vesselCode: VESSEL, deletedAt: null }, select: { id: true, assetCode: true },
  });
  const assetId = new Map<string, string>(assets.map((a: any) => [a.assetCode, a.id]));
  const missing = [...new Set(cfg.items.flatMap(i => i.assets ?? []))].filter(c => !assetId.has(c));
  if (missing.length) throw new Error(`Faltan equipos en ${VESSEL}: ${missing.join(", ")}`);

  const alive = await prisma.spare.findMany({ where: { tenantId, vesselCode: VESSEL, deletedAt: null } });
  const old = alive.filter(cfg.retire);
  const oldBySku = new Map<string, any>(old.map((s: any) => [s.sku, s]));
  const oldIds = new Set<string>(old.map((s: any) => s.id));

  for (const r of cfg.remap) {
    if (!oldBySku.has(r.oldSku)) throw new Error(`Reapunte ${r.code}: ${r.oldSku} no está entre los que se dan de baja`);
    if (!skus.includes(r.newSku)) throw new Error(`Reapunte ${r.code}: ${r.newSku} no está en la lista nueva`);
  }

  // Referencias vivas a los que se dan de baja: tareas activas y OT abiertas.
  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: VESSEL, deletedAt: null },
    select: { id: true, taskCode: true, spares: true },
  });
  const plansHit = plans.filter((p: any) => Array.isArray(p.spares) && p.spares.some((s: any) => oldIds.has(s?.spareId)));
  const woItems = await prisma.workOrderItem.findMany({
    where: { spareId: { in: [...oldIds] }, workOrder: { tenantId, status: { notIn: ["CLOSED", "CANCELLED"] } } },
    select: { id: true, spareId: true, description: true, unit: true, workOrder: { select: { workOrderCode: true } } },
  });

  const sinEquivalente: string[] = [];
  for (const p of plansHit) for (const s of p.spares as any[]) {
    if (!oldIds.has(s?.spareId)) continue;
    const sku = old.find((o: any) => o.id === s.spareId)!.sku;
    if (!cfg.remap.some(r => r.kind === "plan" && r.code === p.taskCode && r.oldSku === sku)) sinEquivalente.push(`tarea ${p.taskCode} → ${sku}`);
  }
  for (const it of woItems) {
    const sku = old.find((o: any) => o.id === it.spareId)!.sku;
    if (!cfg.remap.some(r => r.kind === "wo" && r.code === it.workOrder.workOrderCode && r.oldSku === sku)) sinEquivalente.push(`OT ${it.workOrder.workOrderCode} → ${sku}`);
  }
  if (sinEquivalente.length) throw new Error(`Referencias abiertas sin reapunte definido:\n  ${sinEquivalente.join("\n  ")}`);

  console.log(`Tenant ${TENANT_SLUG} · ${VESSEL}: ${old.length} repuestos a dar de baja (de ${alive.length} vivos), ${cfg.items.length} a cargar`);
  console.log(`Vínculos a equipos: ${cfg.items.reduce((n, i) => n + (i.assets?.length ?? 0), 0)} · movimientos de stock: ${cfg.items.filter(i => i.onBoard > 0).length} (${cfg.items.reduce((n, i) => n + i.onBoard, 0)} unidades)`);
  console.log(`Tareas a reapuntar: ${plansHit.map((p: any) => p.taskCode).join(", ") || "-"} · ítems de OT abiertas: ${woItems.map((i: any) => i.workOrder.workOrderCode).join(", ") || "-"}`);
  if (DRY) {
    for (const s of old) console.log(`  baja  ${s.sku}  ${s.name}`);
    for (const i of cfg.items) console.log(`  alta  ${i.sku}  ${i.name}  [${i.pn ?? "-"}]  a bordo ${i.onBoard}${i.standard !== undefined ? ` / estándar ${i.standard}` : ""}  ${(i.assets ?? []).join(",")}`);
    console.log("DRY: no se escribió nada");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`scripts/_tmp-backup-repuestos-${VESSEL}-${stamp}.json`,
    JSON.stringify({ spares: old, plans: plansHit, workOrderItems: woItems }, null, 1));

  const now = Date.now();
  await prisma.$transaction(async (tx: any) => {
    await tx.spare.updateMany({
      where: { id: { in: [...oldIds] } },
      data: { deletedAt: new Date(), deletedByUserId: actor, updatedByUserId: actor },
    });

    const newBySku = new Map<string, { id: string; name: string; unit: string }>();
    let n = 0;
    for (const it of cfg.items) {
      const note = it.note ? ` ${it.note}.` : "";
      const created = await tx.spare.create({
        data: {
          tenantId, vesselCode: VESSEL, sku: it.sku, name: it.name, category: it.category,
          criticality: "B", manufacturer: it.manufacturer ?? null, unit: it.unit,
          minStock: 0, reorderPoint: 0, targetStock: it.standard ?? null, status: "ACTIVE",
          location: LOCATION, sfiCode: it.sfi ?? "600",
          manufacturerPartNumber: it.pn ?? null,
          longDescription: `${cfg.source}. Figura como: «${it.printed}».${note}`,
          createdByUserId: actor, updatedByUserId: actor,
        },
      });
      newBySku.set(it.sku, { id: created.id, name: it.name, unit: it.unit });

      for (const code of it.assets ?? []) {
        await tx.spareAsset.create({
          data: { tenantId, spareId: created.id, assetId: assetId.get(code)!, createdByUserId: actor },
        });
      }
      if (it.onBoard > 0) {
        await tx.stockMovement.create({
          data: {
            tenantId, vesselCode: VESSEL, spareId: created.id,
            movementCode: `MOV-${VESSEL}-${now + n++}`,
            movementType: "ADJUSTMENT_PLUS", quantity: it.onBoard, unit: it.unit,
            occurredAt: cfg.occurredAt, referenceType: "ADJUSTMENT",
            notes: `Carga inicial: remanencia a bordo según ${cfg.source}.`,
            createdByUserId: actor,
          },
        });
      }
    }

    const target = (r: Remap) => {
      const nu = newBySku.get(r.newSku)!;
      return { id: nu.id, unit: nu.unit, description: `${r.newSku} — ${nu.name}` };
    };

    for (const p of plansHit) {
      const next = (p.spares as any[]).map((s: any) => {
        const sku = oldIds.has(s?.spareId) ? old.find((o: any) => o.id === s.spareId)!.sku : null;
        const r = sku ? cfg.remap.find(x => x.kind === "plan" && x.code === p.taskCode && x.oldSku === sku) : undefined;
        if (!r) return s;
        const t = target(r);
        return { ...s, spareId: t.id, unit: t.unit, description: t.description };
      });
      await tx.maintenancePlan.update({ where: { id: p.id }, data: { spares: next, updatedByUserId: actor } });
      console.log(`  tarea ${p.taskCode}: repuesto reapuntado`);
    }

    for (const it of woItems) {
      const sku = old.find((o: any) => o.id === it.spareId)!.sku;
      const r = cfg.remap.find(x => x.kind === "wo" && x.code === it.workOrder.workOrderCode && x.oldSku === sku)!;
      const t = target(r);
      await tx.workOrderItem.update({
        where: { id: it.id },
        data: { spareId: t.id, unit: t.unit, description: t.description, updatedByUserId: actor },
      });
      console.log(`  ${it.workOrder.workOrderCode}: ítem reapuntado`);
    }
  }, { timeout: 120000 });

  console.log("Listo.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
