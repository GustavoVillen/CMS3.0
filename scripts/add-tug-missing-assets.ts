/**
 * Da de alta los 15 equipos faltantes en los remolcadores, con su Plan de Mantenimiento.
 *
 * Origen: planillas de papel "R/E DON CHICUETO - MANTENIMIENTO PROGRAMADO".
 * Criterio de compilacion pedido por el usuario: las tareas con la MISMA frecuencia se
 * unen en un solo plan, con los items como checklist en la descripcion. Es el mismo
 * patron que ya usan los planes existentes (ej. "Mantenimiento CADA 500 HS").
 *
 * Campos completados siguiendo la convencion de los equipos ya cargados:
 *   Asset: sfiCode (100 casco/300 elevacion/400 navegacion-seguridad/500 habitabilidad/
 *          600 propulsion/700 auxiliares/800 electrico), criticality A-B-C, status,
 *          trackDailyReport (solo motores), isSafetyCritical, fabricante y modelo.
 *   Plan:  title, description (checklist), triggerType, frecuencia, estimatedHours,
 *          responsible, department, sfiGroupNumber, taskType, triggerResultMode=AUTO_WO,
 *          riskLevel/consequenceCategory donde corresponde, samplingKind en analisis.
 *
 * HISTORIAL: solo se carga en DCH (las planillas son de DON CHICUETO). En los demas
 * remolcadores los planes quedan sin ultima ejecucion, para que cada buque cargue la suya.
 *
 * Idempotente (upsert por codigo). DRY=1 para previsualizar.
 *
 * Uso:
 *   DRY=1 VESSELS=DCH,M01,M02 npx tsx scripts/add-tug-missing-assets.ts
 *   VESSELS=DCH,M01,M02 npx tsx scripts/add-tug-missing-assets.ts
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSELS = (process.env.VESSELS ?? "DCH,M01,M02").split(",").map((s) => s.trim()).filter(Boolean);
const HISTORY_VESSEL = process.env.HISTORY_VESSEL ?? "DCH";
const DRY = process.env.DRY === "1";

function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}
function addDays(d: Date, n: number): Date { return new Date(d.getTime() + n * 86_400_000); }
/** Misma logica que recalculateNextDue() del service. */
function computeNextDue(trigger: string, fh: number | null, fm: number | null, lastDate: Date | null, lastHours: number | null) {
  if (trigger === "MONTHS" || trigger === "CALENDAR")
    return fm && fm > 0 && lastDate ? { nextDueDate: addMonths(lastDate, fm), nextDueHours: null } : { nextDueDate: null, nextDueHours: null };
  if (trigger === "HOURS" || trigger === "RUNNING_HOURS")
    return lastHours != null && fh && fh > 0 ? { nextDueDate: null, nextDueHours: lastHours + fh } : { nextDueDate: null, nextDueHours: null };
  if (trigger === "DAY")
    return fm && fm > 0 && lastDate ? { nextDueDate: addDays(lastDate, fm), nextDueHours: null } : { nextDueDate: null, nextDueHours: null };
  if (trigger === "WEEK")
    return fm && fm > 0 && lastDate ? { nextDueDate: addDays(lastDate, fm * 7), nextDueHours: null } : { nextDueDate: null, nextDueHours: null };
  return { nextDueDate: null, nextDueHours: null };
}

type Plan = {
  suffix: string;            // sufijo del taskCode: <BUQUE>-<ASSET>-<suffix>
  title: string;
  description: string;
  trigger: "HOURS" | "MONTHS" | "WEEK";
  fh?: number;               // frecuencia en horas
  fm?: number;               // frecuencia en meses (o semanas si trigger=WEEK)
  est: number;               // estimatedHours
  taskType?: "MAINTENANCE" | "INSPECTION";
  riskLevel?: "HIGH" | "MEDIUM";
  consequence?: "SAFETY" | "OPERATIONAL";
  sampling?: "FLUID";
  dchHours?: number;         // ultima ejecucion en DCH (planilla) por contador
  dchDate?: string;          // ultima ejecucion en DCH (planilla) por calendario
};

type NewAsset = {
  code: string;              // sufijo del assetCode: <BUQUE>-<code>
  name: string;
  sfi: string;
  crit: "A" | "B" | "C";
  trackDR?: true;
  safety?: true;
  manufacturer?: string;
  model?: string;
  plans: Plan[];
};

const RESP = "Jefe de Máquinas";

/** Bloque estandar de 4 planes que comparten todas las electrobombas del buque. */
function pumpPlans(hist: { mensual?: string; trimestral?: string; anual?: string; mayor?: string }): Plan[] {
  return [
    {
      suffix: "01", title: "Mantenimiento MENSUAL", trigger: "MONTHS", fm: 1, est: 1, taskType: "INSPECTION",
      description: "1. [ ] Bomba: verificar funcionamiento y presion de trabajo\n2. [ ] Verificar estado de manometria\n3. [ ] Control de ausencia de perdidas en bridas, juntas y prensaestopa",
      dchDate: hist.mensual,
    },
    {
      suffix: "02", title: "Mantenimiento CADA 3 MESES", trigger: "MONTHS", fm: 3, est: 2,
      description: "1. [ ] Bomba: control de empaquetadura o sello mecanico, goteo admisible\n2. [ ] Manchon de acoplamiento: engrase, control de estado y apriete de tornilleria\n3. [ ] Verificar rodamientos, vibracion, ruido y calentamiento",
      dchDate: hist.trimestral,
    },
    {
      suffix: "03", title: "Mantenimiento ANUAL", trigger: "MONTHS", fm: 12, est: 2,
      description: "1. [ ] Motor electrico: toma de aislacion de bobinados\n2. [ ] Motor electrico: control de apriete de conexiones y estanqueidad de la tapa de bornera\n3. [ ] Verificar puesta a tierra y estado de prensaestopas",
      dchDate: hist.anual,
    },
    {
      suffix: "04", title: "Mantenimiento CADA 5 AÑOS", trigger: "MONTHS", fm: 60, est: 16,
      description: "1. [ ] Bomba: recorrido general (impulsor, aro de desgaste, eje, chaveta, carcasa, sellos, rodamientos)\n2. [ ] Motor electrico: recorrido general (limpieza, barnizado, cambio de rodamientos)\n3. [ ] Prueba de funcionamiento posterior",
      dchDate: hist.mayor,
    },
  ];
}

const ASSETS: NewAsset[] = [
  // ── 1) TERCER GRUPO ELECTROGENO ────────────────────────────────────────────
  {
    code: "MA-PTO", name: "Motor Auxiliar Puerto", sfi: "600", crit: "A", trackDR: true, safety: true,
    manufacturer: "Cummins", model: "Cummins 4BTA3-G1",
    plans: [
      { suffix: "01", title: "Mantenimiento CADA 250 HS - Cambio de Aceite y Filtro", trigger: "HOURS", fh: 250, est: 2,
        description: "1. [ ] Cambio de aceite\n2. [ ] Cambio de filtro de aceite\n3. [ ] Limpieza del alternador con aire comprimido seco (28 PSI) y verificacion de conectores\n4. [ ] Drenaje del separador de agua/combustible y revision de banjos\n5. [ ] Sustituir la arandela de cobre si hay fugas en los banjos",
        dchHours: 21090 },
      { suffix: "03", title: "Mantenimiento CADA 500 HS - Cambio de Filtros de Aire y GO", trigger: "HOURS", fh: 500, est: 2,
        description: "1. [ ] Cambio de filtro de Gas Oil (primario/secundario)\n2. [ ] Control de filtro de aire\n3. [ ] Limpieza enfriador de agua de mar\n4. [ ] Verificacion de funcionamiento del termostato\n5. [ ] Medicion de contrapresion de gases de escape\n6. [ ] Limpieza de bornes de bateria, densidad de electrolito y verificacion de cargador (14 V)",
        dchHours: 21090 },
      { suffix: "06", title: "Mantenimiento CADA 6 MESES - Analisis de Aceite", trigger: "MONTHS", fm: 6, est: 1,
        description: "Tomar muestras y analizar el aceite lubricante en laboratorio", sampling: "FLUID",
        dchDate: "2026-06-26" },
      { suffix: "08", title: "Mantenimiento CADA 1500 HS", trigger: "HOURS", fh: 1500, est: 3,
        description: "1. [ ] Control de estado de mangueras\n2. [ ] Verificacion y ajuste de correa de transmision\n3. [ ] Controlar luz de valvulas (0,40 mm)\n4. [ ] Cambio de correa del ventilador",
        dchHours: 21090 },
      { suffix: "10", title: "Mantenimiento ANUAL", trigger: "MONTHS", fm: 12, est: 2,
        description: "Cambio de liquido refrigerante" },
      { suffix: "11", title: "Mantenimiento CADA 4500 HS", trigger: "HOURS", fh: 4500, est: 8,
        description: "Recorrido de Inyectores, cambio por recorridos con elementos nuevos:\n[ ] Inyector #1\n[ ] Inyector #2\n[ ] Inyector #3\n[ ] Inyector #4",
        dchHours: 16880 },
      { suffix: "16", title: "Mantenimiento CADA 5000 HS", trigger: "HOURS", fh: 5000, est: 4,
        description: "Revision y control de bomba de agua" },
      { suffix: "18", title: "Mantenimiento CADA 3000 HS", trigger: "HOURS", fh: 3000, est: 4,
        description: "1. [ ] Calibracion de inyectores y bomba inyectora de combustible (Servicio Tecnico Bosch)\n2. [ ] Timing de inyectores\n3. [ ] Medicion de gases del carter (blow-by)\n4. [ ] Medicion de resistencias de estator y rotor del alternador (principal y de excitacion)",
        dchHours: 21090 },
      { suffix: "19", title: "Inspeccion SEMANAL", trigger: "WEEK", fm: 1, est: 1, taskType: "INSPECTION",
        description: "1. [ ] Aceite lubricante: nivel en carter, contaminacion visible, perdidas en filtros, enfriador, carter y tapas\n2. [ ] Agua de enfriamiento: nivel, perdidas en bombas, mangueras e intercambiador, condicion del refrigerante\n3. [ ] Combustible: nivel, perdidas, estado del separador de agua\n4. [ ] Correas: tension y estado\n5. [ ] Bateria: bornes limpios y firmes\n6. [ ] Prueba de arranque y control de presion de aceite, temperatura, ruidos y vibraciones" },
      { suffix: "20", title: "Mantenimiento CADA 18 MESES", trigger: "MONTHS", fm: 18, est: 2,
        description: "Cambio de grupo de baterias de arranque",
        dchDate: "2026-01-19" },
      { suffix: "21", title: "Mantenimiento MENSUAL", trigger: "MONTHS", fm: 1, est: 1, taskType: "INSPECTION",
        description: "Seguridades: prueba de funcion de alarmas Vigia P-T° y parada EGA" },
    ],
  },
  {
    code: "ALT-PTO", name: "Alternador N°3 Puerto", sfi: "800", crit: "A",
    manufacturer: "DBT Cramaco", model: "G2R 200 SD/4",
    plans: [
      { suffix: "01", title: "Control aislación", trigger: "MONTHS", fm: 12, est: 2,
        description: "1. [ ] Toma de aislacion de bobinados\n2. [ ] Conexiones de borneras: control de apriete\n3. [ ] Manchon de acoplamiento: inspeccion visual y control de apriete de buloneria\n4. [ ] Protocolo de ensayo de interruptor principal\nTransformador 380/220",
        dchDate: "2025-09-14" },
      { suffix: "02", title: "Limpieza de estator y rotor", trigger: "MONTHS", fm: 24, est: 4,
        description: "1. [ ] Limpieza de estator y rotor\n2. [ ] Limpieza con electro cleaner\n3. [ ] Filtro de aire: limpiar\nTransformador 380/220",
        dchDate: "2025-08-25" },
      { suffix: "03", title: "Mantenimiento CADA 5 AÑOS", trigger: "MONTHS", fm: 60, est: 16,
        description: "Cambio de rodamientos y barnizado (dique seco). Recorrido general.\nTransformador 380/220",
        dchDate: "2025-08-25" },
      { suffix: "04", title: "Cambio de rodamientos sellados", trigger: "HOURS", fh: 20000, est: 8,
        description: "CRAMACO G2R - rodamientos sellados prelubricados, libres de mantenimiento; reemplazar a las 20000 h o antes ante altas temperaturas o sobrevelocidad." },
      { suffix: "05", title: "Verificacion de diodos rotativos, rectificadores y regulador de tension (AVR)", trigger: "MONTHS", fm: 12, est: 2,
        description: "1. [ ] Control del puente de diodos rotativos, rectificadores y AVR\n2. [ ] Caja de borneras: control de estado de excitacion y estanqueidad de tapa\n3. [ ] Verificar conexiones y estado segun la seccion de fallas del manual",
        dchDate: "2026-01-20" },
    ],
  },

  // ── 2) CABRESTANTES ────────────────────────────────────────────────────────
  {
    code: "CABR-BR", name: "Cabrestante Babor", sfi: "700", crit: "B",
    plans: [
      { suffix: "01", title: "Mantenimiento MENSUAL", trigger: "MONTHS", fm: 1, est: 1,
        description: "1. [ ] Comando a distancia: verificar funcionamiento de botonera de PEM\n2. [ ] Procedimiento de lubricacion segun manual\n3. [ ] Control visual de estado general, anclajes y guardas",
        dchDate: "2026-06-28" },
      { suffix: "02", title: "Mantenimiento ANUAL", trigger: "MONTHS", fm: 12, est: 2,
        description: "1. [ ] Motor electrico: toma de aislacion\n2. [ ] Motor electrico: control de apriete de conexiones y estanqueidad de la tapa de bornera",
        dchDate: "2026-06-25" },
      { suffix: "03", title: "Mantenimiento CADA 5 AÑOS", trigger: "MONTHS", fm: 60, est: 16,
        description: "Motor electrico: recorrido general (limpieza, barnizado, cambio de rodamientos, control de bornera)",
        dchDate: "2025-06-10" },
    ],
  },
  {
    code: "CABR-ER", name: "Cabrestante Estribor", sfi: "700", crit: "B",
    plans: [
      { suffix: "01", title: "Mantenimiento MENSUAL", trigger: "MONTHS", fm: 1, est: 1,
        description: "1. [ ] Comando a distancia: verificar funcionamiento de botonera de PEM\n2. [ ] Procedimiento de lubricacion segun manual\n3. [ ] Control visual de estado general, anclajes y guardas",
        dchDate: "2026-06-28" },
      { suffix: "02", title: "Mantenimiento ANUAL", trigger: "MONTHS", fm: 12, est: 2,
        description: "1. [ ] Motor electrico: toma de aislacion\n2. [ ] Motor electrico: control de apriete de conexiones y estanqueidad de la tapa de bornera",
        dchDate: "2026-06-25" },
      { suffix: "03", title: "Mantenimiento CADA 5 AÑOS", trigger: "MONTHS", fm: 60, est: 16,
        description: "Motor electrico: recorrido general (limpieza, barnizado, cambio de rodamientos, control de bornera)",
        dchDate: "2025-06-10" },
    ],
  },

  // ── 3) BOMBAS FALTANTES ────────────────────────────────────────────────────
  {
    code: "EB-LASTRE", name: "ElectroBomba de Lastre", sfi: "700", crit: "A", safety: true,
    plans: pumpPlans({ mensual: "2026-06-22", trimestral: "2026-06-22", anual: "2026-06-25", mayor: "2024-11-19" }),
  },
  {
    code: "EB-SANID", name: "ElectroBomba de Sanidad", sfi: "500", crit: "C",
    plans: pumpPlans({ mensual: "2026-06-25", trimestral: "2026-05-30", anual: "2026-06-26", mayor: "2022-11-19" }),
  },
  {
    code: "EB-LODOS", name: "ElectroBomba de Descarga de Lodos", sfi: "700", crit: "B",
    plans: pumpPlans({ mensual: "2026-06-20", trimestral: "2026-06-20", anual: "2026-05-25", mayor: "2022-11-19" }),
  },
  {
    code: "EB-PRELUB", name: "Bomba de Prelubricación Motor Principal Br y Er", sfi: "600", crit: "B",
    plans: pumpPlans({ mensual: "2026-06-26", trimestral: "2026-06-26", anual: "2026-06-25", mayor: "2022-12-20" }),
  },
  {
    code: "EB-REF-BOC", name: "ElectroBomba de Refrigeración de Bocinas", sfi: "600", crit: "A", safety: true,
    plans: pumpPlans({ mensual: "2026-06-22", trimestral: "2026-06-22", anual: "2026-06-25", mayor: "2026-01-19" }),
  },

  // ── 4) HELICES ─────────────────────────────────────────────────────────────
  {
    code: "HELICE-BR", name: "Hélice Babor", sfi: "600", crit: "A", safety: true,
    plans: [
      { suffix: "01", title: "Mantenimiento CADA 5 AÑOS (varada)", trigger: "MONTHS", fm: 60, est: 16,
        riskLevel: "MEDIUM", consequence: "OPERATIONAL",
        description: "En varada o dique seco:\n1. [ ] 20.01 Limpieza de la helice\n2. [ ] 20.02 Controlar helice en cuanto a daños mecanicos, cavitacion y corrosion; en caso necesario reparar y pulir\n3. [ ] 20.03 Comprobar formacion de fisuras mediante procedimiento de tintas penetrantes\n4. [ ] 20.04 Balancear helice",
        dchDate: "2026-04-09" },
    ],
  },
  {
    code: "HELICE-ER", name: "Hélice Estribor", sfi: "600", crit: "A", safety: true,
    plans: [
      { suffix: "01", title: "Mantenimiento CADA 5 AÑOS (varada)", trigger: "MONTHS", fm: 60, est: 16,
        riskLevel: "MEDIUM", consequence: "OPERATIONAL",
        description: "En varada o dique seco:\n1. [ ] 20.01 Limpieza de la helice\n2. [ ] 20.02 Controlar helice en cuanto a daños mecanicos, cavitacion y corrosion; en caso necesario reparar y pulir\n3. [ ] 20.03 Comprobar formacion de fisuras mediante procedimiento de tintas penetrantes\n4. [ ] 20.04 Balancear helice",
        dchDate: "2026-04-09" },
    ],
  },

  // ── 5) BOTELLONES DE AIRE ──────────────────────────────────────────────────
  {
    code: "BOT-AIRE-P", name: "Botellones de Aire Principales N°1 y N°2", sfi: "700", crit: "A", safety: true,
    plans: [
      { suffix: "01", title: "Mantenimiento ANUAL", trigger: "MONTHS", fm: 12, est: 4,
        riskLevel: "HIGH", consequence: "SAFETY",
        description: "1. [ ] Valvulas de seguridad: verificar funcionamiento y presion de disparo\n2. [ ] Cabezales: recorrido de valvulas\n3. [ ] Control de purgas, drenaje de condensado y estado interior\n4. [ ] Verificar manometria y estado exterior del recipiente",
        dchDate: "2025-08-22" },
    ],
  },
  {
    code: "BOT-AIRE-AUX", name: "Botellones de Aire Auxiliares N°1 y N°2", sfi: "700", crit: "B", safety: true,
    plans: [
      { suffix: "01", title: "Mantenimiento ANUAL", trigger: "MONTHS", fm: 12, est: 4,
        riskLevel: "HIGH", consequence: "SAFETY",
        description: "1. [ ] Valvulas de seguridad: verificar funcionamiento y presion de disparo\n2. [ ] Cabezales: recorrido de valvulas\n3. [ ] Control de purgas, drenaje de condensado y estado interior\n4. [ ] Verificar manometria y estado exterior del recipiente",
        dchDate: "2025-08-22" },
    ],
  },

  // ── 6) AIRE ACONDICIONADO ──────────────────────────────────────────────────
  {
    code: "AA-SPLIT", name: "Aire Acondicionado Split", sfi: "500", crit: "C",
    plans: [
      { suffix: "01", title: "Mantenimiento MENSUAL", trigger: "MONTHS", fm: 1, est: 1,
        description: "Limpieza de filtros de entrada de aire del evaporador",
        dchDate: "2026-06-20" },
      { suffix: "02", title: "Mantenimiento TRIMESTRAL", trigger: "MONTHS", fm: 3, est: 1, taskType: "INSPECTION",
        description: "1. [ ] Control visual de estado de ventiladores del condensador\n2. [ ] Control de apriete de bulonerias y anclajes",
        dchDate: "2026-04-28" },
      { suffix: "03", title: "Mantenimiento ANUAL", trigger: "MONTHS", fm: 12, est: 2,
        description: "1. [ ] Limpieza del condensador del equipo\n2. [ ] Verificacion de capacitor",
        dchDate: "2025-10-28" },
    ],
  },

  // ── 7) CENTRAL HIDRAULICA ──────────────────────────────────────────────────
  {
    code: "CENT-HID", name: "Central Hidráulica", sfi: "700", crit: "A", safety: true,
    plans: [
      { suffix: "01", title: "Mantenimiento MENSUAL", trigger: "MONTHS", fm: 1, est: 1, taskType: "INSPECTION",
        description: "1. [ ] Bomba: verificar funcionamiento\n2. [ ] Valvulas de 2 vias: verificar accionamiento\n3. [ ] Mangueras y conexiones: inspeccion visual de ausencia de perdidas",
        dchDate: "2026-06-27" },
      { suffix: "02", title: "Guinches y pluma - Mantenimiento MENSUAL", trigger: "MONTHS", fm: 1, est: 1,
        description: "1. [ ] Guinche Er: mangueras y conexiones, inspeccion visual de ausencia de perdidas\n2. [ ] Guinche Er: engrase\n3. [ ] Guinche Br: mangueras y conexiones, inspeccion visual de ausencia de perdidas\n4. [ ] Guinche Br: engrase\n5. [ ] Pluma: mangueras y conexiones, inspeccion visual de ausencia de perdidas\n6. [ ] Pluma: engrase",
        dchDate: "2026-06-23" },
      { suffix: "03", title: "Mantenimiento ANUAL", trigger: "MONTHS", fm: 12, est: 4,
        description: "1. [ ] Aceite y filtro: realizar el cambio\n2. [ ] Tanque de centralina: limpieza\n3. [ ] Motor electrico: toma de aislacion\n4. [ ] Motor electrico: control de apriete de conexiones y estanqueidad de la tapa de bornera",
        dchDate: "2026-06-26" },
      { suffix: "04", title: "Mantenimiento CADA 5 AÑOS", trigger: "MONTHS", fm: 60, est: 16,
        description: "1. [ ] Bomba: recorrido general\n2. [ ] Motor electrico: recorrido general (limpieza, barnizado, cambio de rodamientos)",
        dchDate: "2025-06-14" },
    ],
  },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tid: string = tenant.id;
  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: tid, role: "TENANT_ADMIN" }, select: { userId: true },
  });
  const uid: string | undefined = member?.userId;
  if (!uid) throw new Error(`No hay TENANT_ADMIN en '${SLUG}'.`);

  const nPlansTotal = ASSETS.reduce((n, a) => n + a.plans.length, 0);
  console.log(`${DRY ? "DRY-RUN · " : ""}${ASSETS.length} equipos · ${nPlansTotal} planes · buques: ${VESSELS.join(", ")}`);
  console.log(`Historial de planillas se carga solo en ${HISTORY_VESSEL}.\n`);

  let nA = 0, nP = 0, nH = 0;

  for (const vesselCode of VESSELS) {
    const v = await prisma.vessel.findUnique({
      where: { tenantId_code: { tenantId: tid, code: vesselCode } }, select: { name: true },
    });
    if (!v) throw new Error(`Buque '${vesselCode}' no existe en '${SLUG}'.`);
    const withHistory = vesselCode === HISTORY_VESSEL;
    console.log(`━━━ ${vesselCode} — ${v.name}${withHistory ? "  (con historial de planillas)" : ""}`);

    for (const a of ASSETS) {
      const assetCode = `${vesselCode}-${a.code}`;
      const assetData = {
        sfiCode: a.sfi, name: a.name, criticality: a.crit, status: "OPERATIONAL",
        manufacturer: a.manufacturer ?? null, model: a.model ?? null,
        trackDailyReport: a.trackDR ?? false, isSafetyCritical: a.safety ?? false,
      };

      let assetId = `(dry:${assetCode})`;
      if (!DRY) {
        const created = await prisma.asset.upsert({
          where: { tenantId_vesselCode_assetCode: { tenantId: tid, vesselCode, assetCode } },
          update: { ...assetData, updatedByUserId: uid },
          create: { tenantId: tid, vesselCode, assetCode, ...assetData, createdByUserId: uid, updatedByUserId: uid },
          select: { id: true },
        });
        assetId = created.id;
      }
      nA++;
      console.log(`  ${assetCode.padEnd(22)} ${a.name}  [SFI ${a.sfi} · crit ${a.crit}${a.safety ? " · safety-critical" : ""}]`);

      for (const p of a.plans) {
        const taskCode = `${assetCode}-${p.suffix}`;
        const lastHours = withHistory && p.dchHours != null ? p.dchHours : null;
        const lastDate = withHistory && p.dchDate ? new Date(`${p.dchDate}T12:00:00.000Z`) : null;
        const nd = computeNextDue(p.trigger, p.fh ?? null, p.fm ?? null, lastDate, lastHours);
        if (lastHours != null || lastDate) nH++;

        const planData = {
          title: p.title, description: p.description, triggerType: p.trigger,
          frequencyHours: p.fh ?? null, frequencyMonths: p.fm ?? null,
          estimatedHours: p.est, responsible: RESP, department: "MAQUINAS",
          sfiGroupNumber: Number(a.sfi[0]), sfiSubgroupCode: null,
          taskType: p.taskType ?? "MAINTENANCE",
          riskLevel: p.riskLevel ?? null, consequenceCategory: p.consequence ?? null,
          samplingKind: p.sampling ?? null, samplingFluidType: p.sampling === "FLUID" ? "ENGINE_OIL" : null,
          triggerResultMode: "AUTO_WO", windowMode: "AUTO",
          status: "ACTIVE", executionStatus: "FUTURE",
          lastExecutionHours: lastHours, lastExecutionDate: lastDate,
          nextDueHours: nd.nextDueHours, nextDueDate: nd.nextDueDate,
        };

        nP++;
        const freq = p.trigger === "HOURS" ? `cada ${p.fh} hs`
          : p.trigger === "WEEK" ? `cada ${p.fm} sem`
          : `cada ${p.fm} m`;
        const hist = lastHours != null ? ` ← ult ${lastHours.toLocaleString("es-AR")} hs`
          : lastDate ? ` ← ult ${p.dchDate}` : "";
        console.log(`      ${taskCode.padEnd(26)} ${freq.padEnd(12)} ${p.title}${hist}`);

        if (!DRY) {
          await prisma.maintenancePlan.upsert({
            where: { tenantId_vesselCode_taskCode: { tenantId: tid, vesselCode, taskCode } },
            update: { ...planData, assetId, updatedByUserId: uid },
            create: { tenantId: tid, vesselCode, taskCode, assetId, ...planData, createdByUserId: uid, updatedByUserId: uid },
          });
        }
      }
    }
    console.log("");
  }

  console.log(
    `${DRY ? "DRY-RUN (no se escribio nada). " : "✅ Completado. "}` +
      `${nA} equipos · ${nP} planes · ${nH} con historial de planilla.`,
  );
}

main().catch((e) => { console.error("❌", e?.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
