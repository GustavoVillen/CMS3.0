/**
 * Seed idempotente — Repuestos Cummins 4BTA3.9 G1GD, MAO 01 (buque M01, tenant mercurio).
 * Carga el inventario físico de repuestos de los Motores Auxiliares (M01-MA-ER / M01-MA-BR,
 * modelo "Cummins 4BTA3-G1") desde la planilla "INVENTARIO — R/E MAO 01" (snapshot 30/06/2026).
 *
 * No se linkea a un asset único (linkedAssetId null) porque el repuesto sirve a ambos motores
 * auxiliares (mismo modelo) — mismo criterio que scripts/seed-mao01-maintenance.ts para los
 * repuestos de Motor Principal / Reductor.
 *
 * Reglas aplicadas:
 *   - sku = "CUM-<P/N primario>" (P/N tal cual figura en la planilla; sin P/N → "CUM-NOPN-<ítem>").
 *   - manufacturerPartNumber = P/N primario. Si la planilla trae un P/N alternativo ("A / B"),
 *     se anota en longDescription (no hay campo dedicado de P/N alternativo en el modelo).
 *   - Los ítems #53 y #61 de la planilla comparten P/N 3963983 (mismo repuesto, dos líneas) →
 *     se cargan como un único Spare con stock sumado (10 + 0 = 10).
 *   - No hay campo N/R/U (nuevo/recorrido/usado) en el modelo: se deja anotado en longDescription
 *     cuando la planilla lo indica entre paréntesis (NUEVO/USADO/ABIERTO).
 *   - minStock/reorderPoint/targetStock quedan en 0/0/null: la planilla no trae política de
 *     stock, solo el conteo físico — no se inventa una política no provista.
 *   - Stock físico → Spare.currentStock está deprecado; el on-hand real se calcula sumando
 *     StockMovement (ver stock-calc-service). Por eso cada ítem con stock > 0 recibe además un
 *     StockMovement tipo RECEIPT ("carga inicial"), idempotente vía movementCode determinístico.
 *
 * Uso:
 *   DATABASE_URL=<url> npx tsx scripts/seed-mao01-spares-cummins.ts
 *   DRY=1 DATABASE_URL=<url> npx tsx scripts/seed-mao01-spares-cummins.ts   → previsualiza
 *   TENANT_SLUG=mercurio VESSEL_CODE=M01  (overridables por env)
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = process.env.VESSEL_CODE ?? "M01";
const DRY = process.env.DRY === "1";

const MODEL = "4BTA3.9-G1GD";
const SFI_CODE = "650"; // 650 Generadores (motores auxiliares) — ver seed-mao01-maintenance.ts

type Crit = "A" | "B" | "C";
interface SpareDef {
  sku: string;
  name: string;
  category: string;
  crit: Crit;
  pn?: string;      // P/N primario (manufacturerPartNumber)
  altPn?: string;   // P/N alternativo / cruzado, si la planilla trae dos códigos
  stock: number;    // conteo físico al 30/06/2026
  note?: string;    // condición (NUEVO/USADO/ABIERTO), N° de serie, aclaración
  itemNo: string;   // ítem(s) original(es) de la planilla, para trazabilidad
}

const SPARES: SpareDef[] = [
  { sku: "CUM-NOPN-01", name: "Taco de Goma Redondo", category: "Aislamiento", crit: "C", stock: 8, itemNo: "1" },
  { sku: "CUM-NOPN-02", name: "Taco de Goma Rectangular", category: "Aislamiento", crit: "C", stock: 0, itemNo: "2" },
  { sku: "CUM-3802971", name: "Bomba de Agua, Impulsor Metálico cerrado", category: "Bombas", crit: "A", pn: "3802971", stock: 1, itemNo: "3" },
  { sku: "CUM-5295271", name: "Bomba de Agua, Impulsor Plástico cerrado", category: "Bombas", crit: "A", pn: "5295271", stock: 1, itemNo: "4" },
  { sku: "CUM-3930906", name: "Gasket, Valve Cover (Junta, tapa de válvula)", category: "Juntas", crit: "B", pn: "3930906", stock: 7, itemNo: "5" },
  { sku: "CUM-3919296", name: "Brace, Tube (Soporte de Caños de Inyección)", category: "Inyección", crit: "C", pn: "3919296", stock: 4, itemNo: "6" },
  { sku: "CUM-3972071", name: "Thermostat", category: "Componentes", crit: "A", pn: "3972071", altPn: "5292840", stock: 2, itemNo: "7" },
  { sku: "CUM-3923331", name: "Gasket, Thermostat Housing Cover", category: "Juntas", crit: "B", pn: "3923331", stock: 0, itemNo: "8" },
  { sku: "CUM-4936585", name: "Pump, Lubricating Oil (Bomba de aceite)", category: "Bombas", crit: "A", pn: "4936585", stock: 1, itemNo: "9" },
  { sku: "CUM-3938162", name: "Gasket, Oil Pan (Junta cárter de aceite)", category: "Juntas", crit: "B", pn: "3938162", stock: 0, itemNo: "10" },
  { sku: "CUM-3905388", name: "Tee, Male Union", category: "Componentes", crit: "C", pn: "3905388", stock: 2, itemNo: "11" },
  { sku: "CUM-3905692", name: "Tube, Fuel Drain", category: "Combustible", crit: "C", pn: "3905692", stock: 2, itemNo: "12" },
  { sku: "CUM-3904711", name: "Brace, Tube (Soporte de Tubo)", category: "Componentes", crit: "C", pn: "3904711", stock: 4, itemNo: "13" },
  { sku: "CUM-3909394", name: "Draincock, 1/8\" NPTF (Grifo de drenaje)", category: "Componentes", crit: "C", pn: "3909394", stock: 0, itemNo: "14" },
  { sku: "CUM-3900629", name: "Screw, Hex Flange Head Cap, M8 x 1.25 x 16", category: "Tornillería", crit: "C", pn: "3900629", stock: 4, itemNo: "15" },
  { sku: "CUM-626H120", name: "Manómetro Aceite eléctrico, Orlan Rober", category: "Sensores", crit: "B", pn: "626 H 120", stock: 0, itemNo: "16" },
  { sku: "CUM-4940670", name: "Hose, Plain (Manguera liso)", category: "Mangueras", crit: "B", pn: "4940670", stock: 2, itemNo: "17" },
  { sku: "CUM-3928909", name: "Hose, Elbow (Manguera, codo)", category: "Mangueras", crit: "B", pn: "3928909", stock: 1, itemNo: "18" },
  { sku: "CUM-3918608", name: "Hose, Elbow", category: "Mangueras", crit: "B", pn: "3918608", stock: 2, itemNo: "19" },
  { sku: "CUM-3937613", name: "Clamp, Hose (Abrazadera)", category: "Mangueras", crit: "C", pn: "3937613", stock: 6, itemNo: "20" },
  { sku: "CUM-3918566", name: "Coupling, Plain Hose (Acople, manguera plana)", category: "Mangueras", crit: "C", pn: "3918566", stock: 2, itemNo: "21" },
  { sku: "CUM-3970680", name: "Pump, Fuel Transfer (Bomba de alta)", category: "Bombas", crit: "A", pn: "3970680", altPn: "4986584", stock: 1, itemNo: "22" },
  { sku: "CUM-3908560", name: "Pulley, Alternator (Polea, alternador)", category: "Eléctrico", crit: "B", pn: "3908560", stock: 0, itemNo: "23" },
  { sku: "CUM-3967188", name: "Tensioner, Belt (Tensor de correa)", category: "Correas", crit: "B", pn: "3967188", altPn: "3937553", stock: 3, itemNo: "24" },
  { sku: "CUM-3934085", name: "Connection, Tur Oil Drain (Drenaje de aceite turbo)", category: "Turbocompresor", crit: "B", pn: "3934085", altPn: "3934092", stock: 0, itemNo: "25" },
  { sku: "CUM-3592109", name: "Turbocharger, HOLSET Mod. HX30", category: "Turbocompresor", crit: "A", pn: "3592109", altPn: "3802908", stock: 1, note: "USADO. S/N° 8080809360", itemNo: "26" },
  { sku: "CUM-3283445", name: "Pump, Fuel Injection, STANADYNE Mod. 65 BD4 427-5370", category: "Inyección", crit: "A", pn: "3283445", stock: 0, note: "S/N 17060857, 1800 RPM", itemNo: "27" },
  { sku: "CUM-3917746", name: "Isolator, Vibration (Aislador de vibración)", category: "Aislamiento", crit: "C", pn: "3917746", stock: 0, itemNo: "28" },
  { sku: "CUM-3903035", name: "Screw, Banjo Connector, M12 x 1.5 x 24 (Tornillo conector)", category: "Tornillería", crit: "C", pn: "3903035", stock: 1, itemNo: "29" },
  { sku: "CUM-3903723", name: "Washer, Plain (Arandela plana)", category: "Tornillería", crit: "C", pn: "3903723", stock: 4, itemNo: "30" },
  { sku: "CUM-3283382", name: "Tube, Inyector Fuel Supply, #1 Cylinder", category: "Inyección", crit: "B", pn: "3283382", stock: 0, itemNo: "31" },
  { sku: "CUM-3283383", name: "Tube, Inyector Fuel Supply, #2 Cylinder", category: "Inyección", crit: "B", pn: "3283383", stock: 0, itemNo: "32" },
  { sku: "CUM-3283387", name: "Tube, Inyector Fuel Supply, #3 Cylinder", category: "Inyección", crit: "B", pn: "3283387", stock: 0, itemNo: "33" },
  { sku: "CUM-3283388", name: "Tube, Inyector Fuel Supply, #4 Cylinder", category: "Inyección", crit: "B", pn: "3283388", stock: 0, itemNo: "34" },
  { sku: "CUM-3918518", name: "Tube, Fuel Supply (Tubo de suministro de combustible)", category: "Combustible", crit: "B", pn: "3918518", stock: 1, itemNo: "35" },
  { sku: "CUM-3918519", name: "Tube, Fuel Drain (Tubo drenaje de combustible)", category: "Combustible", crit: "C", pn: "3918519", stock: 0, itemNo: "36" },
  { sku: "CUM-3909695", name: "Manifold, Fuel", category: "Inyección", crit: "B", pn: "3909695", stock: 0, itemNo: "37" },
  { sku: "CUM-3919369", name: "Gasket, Turbocharger (Junta entre múltiple de escape y turbo)", category: "Turbocompresor", crit: "A", pn: "3919369", stock: 1, itemNo: "38" },
  { sku: "CUM-3288724", name: "Belt, V Ribbed (Correa en V)", category: "Correas", crit: "B", pn: "3288724", stock: 2, itemNo: "39" },
  { sku: "CUM-3916854", name: "Motor, Starting, PRESTOLITE INDIEL M93R 12V", category: "Eléctrico", crit: "A", pn: "3916854", stock: 1, note: "USADO", itemNo: "40" },
  { sku: "CUM-3283333", name: "Gasket, Cylinder Head (Junta culata)", category: "Juntas", crit: "A", pn: "3283333", stock: 1, note: "Envase ABIERTO", itemNo: "41" },
  { sku: "CUM-3519807", name: "Gasket, Turbocharger (Junta de retorno de aceite de turbo a cárter)", category: "Turbocompresor", crit: "B", pn: "3519807", stock: 2, itemNo: "42" },
  { sku: "CUM-3903463", name: "Cover, Access Hole (Tapa de engranaje bomba de inyección)", category: "Inyección", crit: "C", pn: "3903463", stock: 1, itemNo: "43" },
  { sku: "CUM-3903475", name: "Seal, Rectangular Ring (Sello de tapa de engranaje bomba de inyección)", category: "Sellos", crit: "B", pn: "3903475", stock: 1, itemNo: "44" },
  { sku: "CUM-3802820", name: "Front Seal, Wear Sleeve Kit (Sello delantero)", category: "Sellos", crit: "A", pn: "3802820", stock: 2, itemNo: "45" },
  { sku: "CUM-3926126", name: "Rear Seal, Wear Sleeve Kit (Sello trasero)", category: "Sellos", crit: "A", pn: "3926126", stock: 2, itemNo: "46" },
  { sku: "CUM-3938156", name: "Gasket, Cover Housing (Junta carcasa)", category: "Juntas", crit: "B", pn: "3938156", stock: 0, itemNo: "47" },
  { sku: "CUM-3283767", name: "Gasket, Push Rod Cover (Junta tapa de varilla de empuje)", category: "Juntas", crit: "B", pn: "3283767", stock: 2, itemNo: "48" },
  { sku: "CUM-3928759", name: "Seal, Grommet (Arandela de sellado para tapa inspección de levas)", category: "Sellos", crit: "C", pn: "3928759", stock: 8, itemNo: "49" },
  { sku: "CUM-3972730", name: "Alternador 12V-95A, DELCO 11SI (COD. 8600712)", category: "Eléctrico", crit: "A", pn: "3972730", stock: 1, note: "NUEVO", itemNo: "50" },
  { sku: "CUM-3906694", name: "Seal, Rectangular Ring (Sello, anillo rectangular)", category: "Sellos", crit: "B", pn: "3906694", stock: 2, itemNo: "51" },
  { sku: "CUM-3906695", name: "Seal, Rectangular Ring", category: "Sellos", crit: "B", pn: "3906695", stock: 2, itemNo: "52" },
  { sku: "CUM-3963983", name: "Washer, Sealing (Arandela de sellar)", category: "Tornillería", crit: "C", pn: "3963983", stock: 10, note: "Ítems #53 y #61 de la planilla original comparten este P/N (mismo repuesto): stock combinado 10 + 0.", itemNo: "53, 61" },
  { sku: "CUM-3939355", name: "Gasket, Fuel Pump (Junta bomba de combustible)", category: "Juntas", crit: "B", pn: "3939355", stock: 0, itemNo: "54" },
  { sku: "CUM-3970405", name: "Hose, Plain (Descarga de aire turbo)", category: "Mangueras", crit: "B", pn: "3970405", stock: 2, itemNo: "55" },
  { sku: "CUM-3914856", name: "Gasket, Connection (Junta entre tramo de caño y enfriador de aire)", category: "Juntas", crit: "B", pn: "3914856", stock: 1, itemNo: "56" },
  { sku: "CUM-3938153", name: "Gasket, Int Manifold Cover (Junta entre enfriador de aire y tapa de cilindro)", category: "Juntas", crit: "B", pn: "3938153", stock: 0, itemNo: "57" },
  { sku: "CUM-3927154", name: "Gasket, Exhaust Manifold (Empaquetadura, manifold de escape)", category: "Juntas", crit: "B", pn: "3927154", stock: 8, itemNo: "58" },
  { sku: "CUM-3905649", name: "Tube, Fuel Supply (Caño de bomba de transferencia GO a cabezal de filtros)", category: "Combustible", crit: "B", pn: "3905649", stock: 1, itemNo: "59" },
  { sku: "CUM-3939258", name: "Gasket, Cover Plate (Junta de fijación bomba de transferencia GO)", category: "Juntas", crit: "C", pn: "3939258", stock: 2, itemNo: "60" },
  { sku: "CUM-3903380", name: "Seal, Banjo Connector 6,2mm (Arandela doble de sellado caño de retorno de GO)", category: "Sellos", crit: "C", pn: "3903380", stock: 0, itemNo: "62" },
  { sku: "CUM-3942915", name: "Gasket, Filter Head (Junta de cabezal de filtro L.O.)", category: "Juntas", crit: "B", pn: "3942915", stock: 0, itemNo: "63" },
  { sku: "CUM-4932124", name: "Gasket, Oil Cooler Core (Junta, núcleo del enfriador de aceite)", category: "Juntas", crit: "B", pn: "4932124", stock: 0, itemNo: "64" },
  { sku: "CUM-3957543", name: "Core Cooler (Enfriador de aceite)", category: "Componentes", crit: "A", pn: "3957543", stock: 1, itemNo: "65" },
  { sku: "CUM-3938157", name: "Gasket, Flange (Junta de aspiración cárter)", category: "Juntas", crit: "B", pn: "3938157", stock: 1, itemNo: "66" },
  { sku: "CUM-3922162", name: "Kit Inyector", category: "Inyección", crit: "A", pn: "3922162", altPn: "3802499", stock: 8, note: "NUEVO", itemNo: "67" },
  { sku: "CUM-3913759", name: "Hose, Flexible (Flexible de lubricación turbo)", category: "Mangueras", crit: "A", pn: "3913759", stock: 0, itemNo: "68" },
  { sku: "CUM-3037236", name: "Seal, O-Ring de conexión del flexible al turbo", category: "Sellos", crit: "B", pn: "3037236", stock: 4, itemNo: "69" },
  { sku: "CUM-3924389", name: "Washer, Sealing 7,2mm (Arandela, sellador)", category: "Tornillería", crit: "C", pn: "3924389", stock: 4, itemNo: "70" },
  { sku: "CUM-3937306", name: "Gasket, Oil Drain (Junta de drenaje de aceite)", category: "Juntas", crit: "B", pn: "3937306", stock: 0, itemNo: "71" },
  { sku: "CUM-3928624", name: "Seal, O-Ring de conexión inferior del flexible de descarga LO del turbo", category: "Sellos", crit: "B", pn: "3928624", stock: 4, itemNo: "72" },
  { sku: "CUM-3935449", name: "Isolator, Noise (Arandela de fijación de tapa de válvulas)", category: "Aislamiento", crit: "C", pn: "3935449", stock: 0, itemNo: "73" },
  { sku: "CUM-3914855", name: "Tube, Aftercooler (Caño de agua a la salida del enfriador de aire)", category: "Componentes", crit: "B", pn: "3914855", stock: 2, itemNo: "74" },
  { sku: "CUM-3906697", name: "Seal, O-Ring del codo de agua de compenso", category: "Sellos", crit: "B", pn: "3906697", stock: 2, itemNo: "75" },
  { sku: "CUM-3906698", name: "Seal, Rectangular Ring (Sello de bomba de agua)", category: "Sellos", crit: "B", pn: "3906698", stock: 2, itemNo: "76" },
  { sku: "CUM-134H120", name: "Sensor de Presión de Aceite, Orlan Rober", category: "Sensores", crit: "A", pn: "134 H 120", stock: 2, itemNo: "77" },
  { sku: "CUM-5405392", name: "Kit, Crankshaft Seal Oil (Juego de sello de aceite del cigüeñal)", category: "Sellos", crit: "A", pn: "5405392", stock: 1, itemNo: "78" },
  { sku: "CUM-3970548", name: "Seal, Oil (Sello de aceite)", category: "Sellos", crit: "B", pn: "3970548", altPn: "5259499", stock: 0, itemNo: "79" },
  { sku: "CUM-3912473", name: "Seal, Rectangular Ring (Sello, aro rectangular)", category: "Sellos", crit: "B", pn: "3912473", stock: 1, itemNo: "80" },
  { sku: "CUM-3909409", name: "Tool, Seal Installation, Rear (Herramienta de instalación sello trasero)", category: "Herramientas", crit: "C", pn: "3909409", stock: 1, itemNo: "81" },
  { sku: "CUM-4089425", name: "Tool, Seal Installation, Rear", category: "Herramientas", crit: "C", pn: "4089425", stock: 1, itemNo: "82" },
  { sku: "CUM-3938159", name: "Gasket, Rear Cover (Junta de tapa trasera)", category: "Juntas", crit: "B", pn: "3938159", stock: 0, itemNo: "83" },
  { sku: "CUM-3937111", name: "Front Seal Service Kit (Kit de servicio de sello delantero)", category: "Sellos", crit: "A", pn: "3937111", stock: 3, itemNo: "84" },
  { sku: "CUM-3936365", name: "Valve, Pressure Relief", category: "Componentes", crit: "B", pn: "3936365", stock: 1, itemNo: "85" },
  { sku: "CUM-NOPN-86", name: "Anillo tórico 112 x 4 mm, nitrilo 70 (tapas de enfriador de agua)", category: "Sellos", crit: "C", stock: 0, itemNo: "86" },
  { sku: "CUM-3941981", name: "Screw, Hex Flange Head Cap (Tornillo fijación bomba de agua)", category: "Tornillería", crit: "C", pn: "3941981", stock: 4, itemNo: "87" },
  { sku: "CUM-3818823", name: "Stud, Esparrago de sujeción de turbo", category: "Turbocompresor", crit: "C", pn: "3818823", stock: 4, itemNo: "88" },
  { sku: "CUM-3818824", name: "Nut Hexagon Flange, Tuerca sujeción turbo, M10 x 1,5", category: "Turbocompresor", crit: "C", pn: "3818824", stock: 0, itemNo: "89" },
  { sku: "CUM-3903652", name: "Clamp V-band, Abrazadera entre turbo y codo de escape", category: "Turbocompresor", crit: "B", pn: "3903652", stock: 0, itemNo: "90" },
  { sku: "CUM-3709861", name: "Gasket, Junta rectangular entre turbo y múltiple de escape", category: "Turbocompresor", crit: "B", pn: "3709861", stock: 1, itemNo: "91" },
  { sku: "CUM-TIPO-403", name: "Sensor Presión de Aceite, ELCOS", category: "Sensores", crit: "A", pn: "TIPO/403", stock: 2, itemNo: "92" },
  { sku: "CUM-TTAO-402", name: "Sensor Temperatura de Agua, ELCOS", category: "Sensores", crit: "A", pn: "TTAO/402", stock: 2, itemNo: "93" },
  { sku: "CUM-AST-015-00", name: "Sensor Nivel de Agua, ELCOS", category: "Sensores", crit: "B", pn: "AST-015/00", stock: 2, itemNo: "94" },
];

function buildDesc(s: SpareDef): string {
  const parts = [`Inventario físico Cummins 4BTA3.9 G1GD R/E MAO01 (30/06/2026) — ítem ${s.itemNo} de la planilla.`];
  if (s.altPn) parts.push(`P/N alternativo: ${s.altPn}.`);
  if (s.note) parts.push(s.note);
  return parts.join(" ");
}

// ── ejecución ────────────────────────────────────────────────────────────────
async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado en esta base.`);
  const tid: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: tid, role: "TENANT_ADMIN" },
    select: { userId: true },
  });
  const uid: string | undefined = member?.userId;
  if (!uid) throw new Error(`No hay usuario TENANT_ADMIN en tenant '${SLUG}'.`);

  const vessel = await prisma.vessel.findUnique({
    where: { tenantId_code: { tenantId: tid, code: VESSEL } },
    select: { code: true, name: true },
  });
  if (!vessel) {
    throw new Error(`Buque '${VESSEL}' no existe en tenant '${SLUG}'. Crealo primero en /vessels.`);
  }

  const seenSkus = new Set<string>();
  let nSpares = 0;
  let nMovements = 0;
  let totalStock = 0;

  for (const s of SPARES) {
    if (seenSkus.has(s.sku)) throw new Error(`sku duplicado: ${s.sku}`);
    seenSkus.add(s.sku);

    const spareData = {
      name: s.name, category: s.category, unit: "u", criticality: s.crit,
      manufacturer: "Cummins", model: MODEL, sfiCode: SFI_CODE,
      manufacturerPartNumber: s.pn ?? null,
      longDescription: buildDesc(s),
      minStock: 0, reorderPoint: 0, targetStock: null,
      status: "ACTIVE" as const,
    };

    let spareId = "(dry)";
    if (!DRY) {
      const spare = await prisma.spare.upsert({
        where: { tenantId_vesselCode_sku: { tenantId: tid, vesselCode: VESSEL, sku: s.sku } },
        update: { ...spareData, updatedByUserId: uid },
        create: { tenantId: tid, vesselCode: VESSEL, sku: s.sku, ...spareData, createdByUserId: uid, updatedByUserId: uid },
        select: { id: true },
      });
      spareId = spare.id;
    }
    nSpares++;
    totalStock += s.stock;
    console.log(`${DRY ? "DRY " : "✓ "}Spare ${s.sku} — ${s.name} (stock ${s.stock})`);

    if (s.stock > 0) {
      const movementCode = `INV-MAO01-CUM-${s.sku}`;
      if (!DRY) {
        const already = await prisma.stockMovement.findFirst({
          where: { tenantId: tid, vesselCode: VESSEL, movementCode },
          select: { id: true },
        });
        if (!already) {
          await prisma.stockMovement.create({
            data: {
              tenantId: tid, vesselCode: VESSEL, spareId, movementCode,
              movementType: "RECEIPT", quantity: s.stock, unit: "u",
              occurredAt: new Date("2026-06-30T00:00:00.000Z"),
              notes: `Carga inicial — inventario físico ítem ${s.itemNo}, planilla Cummins 4BTA3.9 R/E MAO01 (30/06/2026).`,
              createdByUserId: uid,
            },
          });
          nMovements++;
        }
      } else {
        nMovements++;
      }
    }
  }

  console.log(
    `\n${DRY ? "DRY-RUN (no se escribió nada). " : "✅ Completado. "}` +
      `${nSpares} repuestos registrados · ${nMovements} movimientos de stock inicial · ${totalStock} unidades totales en inventario.`,
  );
}

main()
  .catch((e) => {
    console.error("❌ Error:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
