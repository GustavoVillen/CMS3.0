/**
 * MAO 02 — reemplaza el listado de repuestos por el de la planilla
 * "Estándar de artículos, filtros y lubricantes para Máquinas MAO 02" (09/09/2026,
 * firmada por el Jefe de Máquinas). Pedido de Gustavo (2026-09-20): borrar todo lo
 * que había (estaba mal) y dejar SOLO lo que dice ese PDF.
 *
 *   1. Los repuestos actuales del buque se dan de baja (deletedAt). Baja lógica y no
 *      DELETE: 6 ítems de OT cerradas (OT-M02-26-0462/0463) y un plan los citan por id.
 *   2. Se cargan 46 ítems: 8 lubricantes/refrigerante, 13 filtros y 25 artículos.
 *      Estándar = targetStock (lo que lee el formulario "Estándar para viaje").
 *      Medida = unit, tal como está impresa.
 *   3. "Equipos donde se usa" (SpareAsset) sólo donde el PDF nombra el equipo.
 *   4. Remanencia a bordo = movimiento ADJUSTMENT_PLUS de carga inicial.
 *   5. El plan M02-MA-BR-01 citaba dos filtros dados de baja: se reapunta a sus
 *      equivalentes del PDF (filtro de aceite / de combustible de los generadores).
 *
 * Uso:  DATABASE_URL=<url> TENANT_SLUG=mercurio npx tsx scripts/load-mao02-estandar-pdf.ts
 *       DRY=1 ...  → previsualiza sin escribir
 * Idempotente: si ya existen SKUs STD-* del buque, no hace nada.
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const TENANT_SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = "M02";
const DRY = process.env.DRY === "1";
const LOCATION = "Pañol Maquinas";
const SOURCE = "Estándar MAO 02 (planilla del 09/09/2026)";
const OCCURRED_AT = new Date("2026-09-09T12:00:00.000Z");

const MP = "Motor principal Caterpillar 3412";
const GEN = "Motores generadores Cummins 4BTA 3.9";
const CR = "caja reductora Twin Disc 520-1HP";
const COMP = "compresor alternativo Ingersoll-Rand 2-242E5";

const A_MP = ["M02-MP-BR", "M02-MP-ER"];
const A_GEN = ["M02-MA-BR", "M02-MA-ER"];
const A_CR = ["M02-CR-BR", "M02-CR-ER"];
const A_COMP = ["M02-COMP-BR", "M02-COMP-ER"];

interface Item {
  sku: string;
  name: string;
  category: "Lubricante" | "Refrigerante" | "Filtro" | "Artículo";
  unit: string;
  standard: number;
  onBoard: number;
  pn?: string;
  manufacturer?: string;
  sfi?: string;
  assets?: string[];
  use?: string;
}

const LUBES: Item[] = [
  { sku: "STD-LUB-01", name: "Shell RIMULA R4 L 15W40", category: "Lubricante", unit: "Tambor x 200 lts", standard: 2, onBoard: 1, manufacturer: "Shell", assets: [...A_MP, ...A_GEN], use: `${MP} y ${GEN}` },
  { sku: "STD-LUB-02", name: "Shell Gadinia S3 40", category: "Lubricante", unit: "Tambor x 200 lts", standard: 1, onBoard: 1, manufacturer: "Shell", assets: A_CR, use: CR },
  { sku: "STD-LUB-03", name: "Shell Corena S2R 100", category: "Lubricante", unit: "Balde x 20 lts", standard: 2, onBoard: 2, manufacturer: "Shell", assets: A_COMP, use: COMP },
  { sku: "STD-LUB-04", name: "Shell Tellus S2 M 68", category: "Lubricante", unit: "Tambor x 200 lts", standard: 1, onBoard: 1, manufacturer: "Shell", sfi: "700", assets: ["M02-HID-GOB"], use: "Sistema de timón" },
  { sku: "STD-LUB-05", name: "Shell Gadus S2 V 100 2", category: "Lubricante", unit: "Balde x 20 lts", standard: 1, onBoard: 1, manufacturer: "Shell", use: "Engrase de motores eléctricos" },
  { sku: "STD-LUB-06", name: "Shell Gadus S2 V 220 AC 2", category: "Lubricante", unit: "Balde x 20 Kg", standard: 1, onBoard: 1, manufacturer: "Shell", use: "Engrase general" },
  { sku: "STD-LUB-07", name: "Shell Gadus S2 A 320 2", category: "Lubricante", unit: "Balde x 20 Kg", standard: 4, onBoard: 4, manufacturer: "Shell", use: "Engrase de cabos" },
  { sku: "STD-LUB-08", name: "KLAAS G 48 (50/50)", category: "Refrigerante", unit: "Tambor x 200 lts", standard: 1, onBoard: 1, manufacturer: "Klaas", use: "Refrigerante" },
];

const FILTERS: Item[] = [
  { sku: "STD-FIL-01", name: `Filtro de aceite para ${MP}`, category: "Filtro", unit: "UN", standard: 8, onBoard: 8, pn: "Donaldson P 554005", assets: A_MP },
  { sku: "STD-FIL-02", name: `Filtro de aceite by pass para ${MP}`, category: "Filtro", unit: "UN", standard: 4, onBoard: 6, assets: A_MP },
  { sku: "STD-FIL-03", name: `Filtro de combustible para ${MP}`, category: "Filtro", unit: "UN", standard: 12, onBoard: 10, pn: "PSC 172", assets: A_MP },
  { sku: "STD-FIL-04", name: `Filtro de aire para ${MP}`, category: "Filtro", unit: "UN", standard: 6, onBoard: 6, assets: A_MP },
  { sku: "STD-FIL-05", name: `Filtro de aceite para ${CR}`, category: "Filtro", unit: "UN", standard: 6, onBoard: 6, pn: "P550223", assets: A_CR },
  { sku: "STD-FIL-06", name: `Filtro de aceite para ${GEN}`, category: "Filtro", unit: "UN", standard: 6, onBoard: 4, pn: "P558616", assets: A_GEN },
  { sku: "STD-FIL-07", name: `Filtro de combustible con trampa de agua para ${GEN}`, category: "Filtro", unit: "UN", standard: 6, onBoard: 10, pn: "PSC496 / PSC410", assets: A_GEN },
  { sku: "STD-FIL-08", name: `Filtro de combustible para ${GEN}`, category: "Filtro", unit: "UN", standard: 4, onBoard: 2, pn: "TB181", assets: A_GEN },
  { sku: "STD-FIL-09", name: `Filtro de aire para ${GEN}`, category: "Filtro", unit: "UN", standard: 6, onBoard: 7, assets: A_GEN },
  { sku: "STD-FIL-10", name: `Filtro de combustible RAMA / Racor para ${MP} y ${GEN}`, category: "Filtro", unit: "UN", standard: 8, onBoard: 8, pn: "RAMA SMA 2020 / Parker Racor 2020PM-OR", assets: [...A_MP, ...A_GEN] },
  { sku: "STD-FIL-11", name: `Filtro de aceite para ${COMP}`, category: "Filtro", unit: "UN", standard: 4, onBoard: 2, pn: "MANN WD-920", assets: A_COMP },
  { sku: "STD-FIL-12", name: `Filtro de aire para ${COMP}`, category: "Filtro", unit: "UN", standard: 4, onBoard: 2, pn: "MANN C-1213", assets: A_COMP },
  { sku: "STD-FIL-13", name: `Filtro separador de aceite para ${COMP}`, category: "Filtro", unit: "UN", standard: 4, onBoard: 2, pn: "MANN LB 962/2", assets: A_COMP },
];

// [nombre tal como está impreso, medida, estándar, remanencia a bordo]
const ARTICLES: Array<[string, string, number, number]> = [
  ["CINTA - TIPO AISLADORA 3M", "UN", 2, 0],
  ["CLORO - TIPO LIQUIDO", "LITROS", 10, 20],
  ["DESENGRASANTE INDUSTRIAL - TIPO LÍQUIDO", "LITROS", 10, 0],
  ["DETERGENTE INDUSTRIAL - TIPO LÍQUIDO", "LITROS", 15, 0],
  ["GUANTE - TIPO DE CUERO VAQUETA (AMARILLO) Pref: Indalco", "UN", 12, 0],
  ["GUANTE - TIPO DE HILO", "PAR", 12, 0],
  ['PILA DURACELL - TIPO "AA" PAQ DE 4 UNID', "UN", 6, 1],
  ['PILA DURACELL - TIPO "AAA" PAQ DE 4 UNID', "UN", 6, 0],
  ['PILA DURACELL - TIPO "D" PAQ DE 4 UNID', "UN", 6, 1],
  ["PILA DURACELL - 9 V", "UN", 3, 1],
  ['CINTA DE TEFLON 3/4"', "UN", 4, 2],
  ["CARAMBA W20 (DESENGRIPANTE)", "UN", 2, 1],
  ["BOLSA DE RESIDUOS REFORZADO 300 LTS (PAQUETE X 10)", "UN", 6, 1],
  ["BOLSA DE RESIDUOS REFORZADO 100 LTS (PAQUETE X 10)", "UN", 3, 1],
  ["JABON - TIPO EN BARRA DE COCO (MARCA CABALLARO)", "UN", 2, 0],
  ["JABON - TIPO EN POLVO Pref: OMO", "KILOS", 12, 10],
  ["LAMPAZO - TIPO CABELLO DE BRUJA CON BALDE", "UN", 3, 1],
  ["TRAPO - TIPO INDUSTRIAL", "KILOS", 20, 0],
  ["FRANELA PARA LIMPIEZA", "UN", 4, 0],
  ["JABON EN POLVO INDUSTRIAL ECONOMICO.", "KILOS", 9, 0],
  ["LAVANDINA LIQUIDA.", "LITROS", 15, 5],
  ["LIMPIA CONTACTO", "UN", 2, 1],
  ["LAVAMANOS FAST ORANGE", "UN", 1, 0],
  ["FILTRO CARBON ACTIVADO PARA HIELERA", "UN", 4, 0],
  ["KIT CLARIFICANTE (POTABILIZADOR) X 100 UNIDADES", "KITS", 3, 4],
];

const ITEMS: Item[] = [
  ...LUBES,
  ...FILTERS,
  ...ARTICLES.map(([name, unit, standard, onBoard], i): Item => ({
    sku: `STD-ART-${String(i + 1).padStart(2, "0")}`, name, category: "Artículo", unit, standard, onBoard,
  })),
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`No existe el tenant ${TENANT_SLUG}`);
  const tenantId: string = tenant.id;

  const admins = await prisma.tenantMembership.findMany({
    where: { tenantId, role: "TENANT_ADMIN" }, select: { userId: true },
  });
  if (!admins.length) throw new Error("No hay TENANT_ADMIN");
  const actor: string = admins[0].userId;

  const already = await prisma.spare.count({ where: { tenantId, vesselCode: VESSEL, sku: { startsWith: "STD-" }, deletedAt: null } });
  if (already > 0) { console.log(`Ya hay ${already} repuestos STD-* en ${VESSEL}: nada que hacer.`); return; }

  const assets = await prisma.asset.findMany({
    where: { tenantId, vesselCode: VESSEL, deletedAt: null }, select: { id: true, assetCode: true },
  });
  const assetId = new Map<string, string>(assets.map((a: any) => [a.assetCode, a.id]));
  const missing = [...new Set(ITEMS.flatMap(i => i.assets ?? []))].filter(c => !assetId.has(c));
  if (missing.length) throw new Error(`Faltan equipos en ${VESSEL}: ${missing.join(", ")}`);

  const old = await prisma.spare.findMany({ where: { tenantId, vesselCode: VESSEL, deletedAt: null } });
  console.log(`Tenant ${TENANT_SLUG} · ${VESSEL}: ${old.length} repuestos a dar de baja, ${ITEMS.length} a cargar`);
  const stockItems = ITEMS.filter(i => i.onBoard > 0).length;
  console.log(`Vínculos a equipos: ${ITEMS.reduce((n, i) => n + (i.assets?.length ?? 0), 0)} · movimientos de stock: ${stockItems}`);
  if (DRY) { console.log("DRY: no se escribió nada"); return; }

  writeFileSync(`scripts/_tmp-backup-mao02-repuestos-${TENANT_SLUG}.json`, JSON.stringify(old, null, 1));

  const oldBySku = new Map<string, string>(old.map((s: any) => [s.sku, s.id]));
  const now = Date.now();

  await prisma.$transaction(async (tx: any) => {
    await tx.spare.updateMany({
      where: { tenantId, vesselCode: VESSEL, deletedAt: null },
      data: { deletedAt: new Date(), deletedByUserId: actor, updatedByUserId: actor },
    });

    const newBySku = new Map<string, { id: string; name: string }>();
    let i = 0;
    for (const it of ITEMS) {
      const useLine = it.use ? `Uso según planilla: ${it.use}. ` : "";
      const created = await tx.spare.create({
        data: {
          tenantId, vesselCode: VESSEL, sku: it.sku, name: it.name, category: it.category,
          criticality: "B", manufacturer: it.manufacturer ?? null, unit: it.unit,
          minStock: 0, reorderPoint: 0, targetStock: it.standard, status: "ACTIVE",
          location: LOCATION, sfiCode: it.sfi ?? "600",
          manufacturerPartNumber: it.pn ?? null,
          longDescription: `${useLine}${SOURCE}.`,
          createdByUserId: actor, updatedByUserId: actor,
        },
      });
      newBySku.set(it.sku, { id: created.id, name: it.name });

      for (const code of it.assets ?? []) {
        await tx.spareAsset.create({
          data: { tenantId, spareId: created.id, assetId: assetId.get(code)!, createdByUserId: actor },
        });
      }
      if (it.onBoard > 0) {
        await tx.stockMovement.create({
          data: {
            tenantId, vesselCode: VESSEL, spareId: created.id,
            movementCode: `MOV-${VESSEL}-${now + i++}`,
            movementType: "ADJUSTMENT_PLUS", quantity: it.onBoard, unit: it.unit,
            occurredAt: OCCURRED_AT, referenceType: "ADJUSTMENT",
            notes: `Carga inicial: remanencia a bordo según ${SOURCE}.`,
            createdByUserId: actor,
          },
        });
      }
    }

    // Planes que citaban repuestos dados de baja: se reapuntan a su equivalente del PDF.
    const remap: Record<string, string> = { "GEN-FIL-ACE-01": "STD-FIL-06", "GEN-FIL-COMB-01": "STD-FIL-08" };
    const idMap = new Map<string, { id: string; name: string; sku: string }>();
    for (const [oldSku, newSku] of Object.entries(remap)) {
      const oldId = oldBySku.get(oldSku); const nu = newBySku.get(newSku);
      if (oldId && nu) idMap.set(oldId, { ...nu, sku: newSku });
    }
    const plans = await tx.maintenancePlan.findMany({
      where: { tenantId, vesselCode: VESSEL, deletedAt: null },
      select: { id: true, taskCode: true, spares: true },
    });
    const oldIds = new Set(oldBySku.values());
    for (const p of plans) {
      if (!Array.isArray(p.spares)) continue;
      let changed = false;
      const next = p.spares.map((s: any) => {
        const m = s?.spareId ? idMap.get(s.spareId) : undefined;
        if (m) { changed = true; return { ...s, spareId: m.id, unit: "UN", description: `${m.sku} — ${m.name}` }; }
        if (s?.spareId && oldIds.has(s.spareId)) console.log(`  ⚠ ${p.taskCode} cita un repuesto dado de baja sin equivalente: ${s.description}`);
        return s;
      });
      if (changed) {
        await tx.maintenancePlan.update({ where: { id: p.id }, data: { spares: next, updatedByUserId: actor } });
        console.log(`  plan ${p.taskCode}: repuestos reapuntados`);
      }
    }
  }, { timeout: 60000 });

  console.log("Listo.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
