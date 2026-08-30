/**
 * Seed para YT010: Assets + Maintenance Plans + Spares de barcaza tanque.
 * Fuente: tabla "SERIE YT" (32 ítems, motor Detroit, bombas KSB/SYLWAM).
 * Patrón: reutiliza clasificación y estimación de `seed-mao01-maintenance.ts`.
 *
 * Uso:
 *   DATABASE_URL=<url> npx tsx scripts/seed-yt010-maintenance.ts
 *   DRY=1 ...  → previsualiza
 *   VESSEL_CODE=YT010 TENANT_SLUG=mercurio  (overridables; estos son los defaults)
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = process.env.VESSEL_CODE ?? "YT010";
const DRY = process.env.DRY === "1";

type Crit = "A" | "B" | "C";
type Status = "OPERATIONAL" | "OUT_OF_SERVICE" | "DEGRADED";
// [title, freq, last, next, typeOverride?]
type Task = [string, string | null, (string | number | null)?, (string | number | null)?, ("I" | "M")?];
interface AssetDef {
  code: string;
  name: string;
  group: number;
  crit: Crit;
  safety?: boolean;
  mfr?: string;
  model?: string;
  serial?: string;
  status?: Status;
  desc?: string;
  tasks: Task[];
}

function parseFreq(freq: string | null): {
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
} {
  if (!freq) return { triggerType: "CONDITION", frequencyHours: null, frequencyMonths: null };
  const m = freq.match(/^(\d+)\s*(d|mo|h|año|años)?$/);
  if (!m) {
    if (freq.toLowerCase().includes("trimestral")) return { triggerType: "MONTHS", frequencyHours: null, frequencyMonths: 3 };
    if (freq.toLowerCase().includes("semestral")) return { triggerType: "MONTHS", frequencyHours: null, frequencyMonths: 6 };
    if (freq.toLowerCase().includes("anual") || freq.toLowerCase().includes("año")) return { triggerType: "MONTHS", frequencyHours: null, frequencyMonths: 12 };
    if (freq.toLowerCase().includes("bi-anual") || freq.toLowerCase().includes("cada 4")) return { triggerType: "MONTHS", frequencyHours: null, frequencyMonths: 48 };
    return { triggerType: "CONDITION", frequencyHours: null, frequencyMonths: null };
  }
  const n = Number(m[1]);
  if (m[2] === "h") return { triggerType: "HOURS", frequencyHours: n, frequencyMonths: null };
  if (m[2] === "d") return { triggerType: "DAY", frequencyHours: null, frequencyMonths: n };
  if (m[2] === "año" || m[2] === "años") return { triggerType: "MONTHS", frequencyHours: null, frequencyMonths: n * 12 };
  return { triggerType: "MONTHS", frequencyHours: null, frequencyMonths: n };
}

function classify(title: string): "MAINTENANCE" | "INSPECTION" {
  return /\b(prueba|verific|control|inspecc|revisión|inspección|cambio|recorrido)\b/i.test(title) ? "INSPECTION" : "MAINTENANCE";
}

function estimateHours(title: string): number {
  const t = title.toLowerCase();
  if (/(recorrido general|desmontar|demontaje|desarmado completo)/.test(t)) return 16;
  if (/(inyector|turbo|bomba inyector|embriague|cambio de|reemplazo)/.test(t)) return 8;
  if (/(limpieza|cambio|filtro|aceite|inspection|control|verificación)/.test(t)) return 2;
  return 1;
}

function applyTiming(data: Record<string, unknown>, last?: string | number | null, next?: string | number | null) {
  if (typeof last === "number") data.lastExecutionHours = last;
  else if (typeof last === "string" && /^\d{4}-\d{2}-\d{2}$/.test(last)) data.lastExecutionDate = new Date(`${last}T00:00:00.000Z`);
  if (typeof next === "number") data.nextDueHours = next;
  else if (typeof next === "string" && /^\d{4}-\d{2}-\d{2}$/.test(next)) data.nextDueDate = new Date(`${next}T00:00:00.000Z`);
}

// ── SERIE YT: 10 Assets + 32 tareas (sin timing de snapshot, timing en blanco)
const ASSETS: AssetDef[] = [
  {
    code: "YT010-CASCO", name: "Casco, Cubierta, Tronco y Espacios", group: 1, crit: "B",
    tasks: [
      ["Paso de hombre, registros, puertas y coferdams", "Anual", null, null],
      ["Válvulas sobre cubierta", "Anual", null, null],
      ["Porta precintos", "Anual", null, null],
      ["Cartelería", "Anual", null, null],
      ["Casco", "Anual", null, null],
      ["Tanques de carga", "Cada 4 años", null, null],
      ["Espacios vacíos / circulación", "Anual", null, null],
    ],
  },
  {
    code: "YT010-MOTOR", name: "Motor - Detroit (+ Transmisión, Cardanes, Arranque)", group: 6, crit: "A", safety: true,
    mfr: "Detroit Diesel", model: "indeterminado",
    tasks: [
      ["Muestreo de aceite de cabezal reductor de bomba", "Semestral", null, null],
      ["Filtro de aire", "Anual", null, null, "I"],
      ["Filtro de aceite", "Anual", null, null],
      ["Filtro de combustible (primario y secundario)", "Anual", null, null],
      ["Comando de aceleración", "Anual", null, null, "I"],
      ["Limpieza y verificación del estado del silenciador y su aislación", "Bi-anual", null, null],
      ["Revisión de eje cardán, engrases de crucetas", "Anual", null, null],
      ["Eje de escape", "Anual", null, null, "I"],
      ["Aretallamas", "Anual", null, null, "I"],
      ["Limpieza y verificación del estado del cilenciador y su aislación Ensayo de PM Control dimensional de muñones de bancada y brida Corrección dimensional de alineamientos de cigüeñal, plano de leva de cigüeñal etc", "Cada 4 años en dique seco", null, null],
      ["Bomba Inyectora", "Cada 4 años", null, null],
      ["Inyectores", "Cada 4 años", null, null],
      ["Aceite hidráulico", "Cambio", null, null],
      ["Embrague", "Demontaje, limpieza  Ensayo de PM  Control dimensional de muñones de bancada y brida Eventual rectificación o reemplazo", null, null],
      ["Conjunto de motor (pistones, aros pernos y camisas)", "Demonte, revisión y limpieza  Cambio de muñones de cigüeñal.", null, null],
      ["Tanque de combustible", "Limpieza tanque de combustible  Inspección de estructura interna  Prueba neumática", null, null],
    ],
  },
  {
    code: "YT010-BOMBA", name: "Bomba de Descarga de Cargamento", group: 2, crit: "A",
    mfr: "KSB / SYLWAM", model: "indeterminado",
    tasks: [
      ["Bomba de descarga", "Cambio de aceite al cabezal reductor de bomba", "Semestral", null, null],
      ["Bomba y Caja de engranajes", "Verificación de bomba y caja de engranajes, bomba, control de rotación y análisis de vibración.", "Cada 8 años en dique seco", null, null],
      ["Válvulas de Cargamento", "Desarmé, inspección, recorrido y prueba hidráulica de las válvulas de cargamento  Pruebas de contacto", "Cada 8 años en dique seco", null, null],
      ["Casco", "Medición de espesores", "Cada 8 años en dique seco", null, null],
    ],
  },
  {
    code: "YT010-CARGAMENTO", name: "Sistema de Tuberías, Válvulas y Manifold de Cargamento", group: 2, crit: "B",
    tasks: [
      ["Sistema de Cargamento", "Prueba hidráulica de las líneas de carga/descarga, válvulas de carga y tanques de carga  Emisión de certificado", "Anual", null, null],
      ["Válvulas sobre cubierta", "Limpieza externa, engrase de empaquetadura y ajuste de cierre.", "Anual", null, null],
      ["Válvulas de Cargamento", "Desarmé, inspección, recorrido y prueba hidráulica de las válvulas de cargamento  Pruebas de contacto", "Cada 8 años en dique seco", null, null],
    ],
  },
  {
    code: "YT010-VENTEO", name: "Sistema de Venteo (Válvulas P/V)", group: 2, crit: "B",
    tasks: [
      ["Válvula de alivio de sistema de cargamento", "Prueba hidráulica de apertura - Certificación", "Anual", null, null],
      ["Líneas de incendio", "Prueba hidráulica de la línea de incendio  Emisión de certificado", "Anual", null, null],
    ],
  },
  {
    code: "YT010-CORTE", name: "Paradas de Emergencia / Corte Remoto", group: 9, crit: "A", safety: true,
    tasks: [
      ["Parada de emergencia", "Verificación y prueba", "Trimestral", null, null],
    ],
  },
  {
    code: "YT010-INCENDIO", name: "Sistema de Lucha Contra Incendio", group: 7, crit: "A", safety: true,
    tasks: [
      ["Mangueras y Extinguidores", "Verificación de condiciones de servicio (Pruebas, nivel de carga, fecha de vencimiento)", "Trimestral", null, null],
      ["Paradas de emergencia", "Verificación y prueba", "Trimestral", null, null],
      ["Sistema de Cargamento", "Prueba hidráulica de las líneas de carga/descarga, válvulas de carga y tanques de carga  Emisión de certificado", "Anual", null, null],
    ],
  },
  {
    code: "YT010-MEDICION", name: "Medición de Nivel y Alarmas de Tanques", group: 9, crit: "A", safety: true,
    tasks: [
      ["Manómetros", "Prueba hidráulica  Emisión de certificado", "Anual", null, null],
      ["Termómetro de cabezal", "Prueba de temperatura  Emisión de certificado", "Anual", null, null],
      ["Instalación eléctrica antexplosiva", "Inspección de cables flexibles expuestos y sellado de terminales.", "Anual", null, null],
      ["Alarmas de nivel", "Recorrido anual  Certificación", "Anual", null, null],
      ["Compresores", "Testeo de válvulas de seguridad  Emisión de certificado", "Anual", null, null, "I"],
    ],
  },
  {
    code: "YT010-ELECTRICO", name: "Sistema Eléctrico (Luces de Navegación)", group: 8, crit: "B",
    tasks: [
      // nota: el item 1.12 de la tabla genérica ("Instalacion eléctrica antexplosiva") ya quedó en MEDICION
    ],
  },
  {
    code: "YT010-SALVAMENTO", name: "Sistema de Salvamento (Aros Salvavidas)", group: 5, crit: "B",
    tasks: [
      // nota: no hay ítem con intervalo en la tabla para salvamento; asset creado pero sin planes
    ],
  },
];

interface SpareDef {
  sku: string;
  name: string;
  category: string;
  unit: string;
  crit: Crit;
  min: number;
  reorder: number;
  target?: number;
  mfr?: string;
  model?: string;
  desc?: string;
}

const SPARES: SpareDef[] = [
  { sku: "DET-AIRF", name: "Elemento filtro de aire", category: "Filtros", unit: "u", crit: "A", min: 1, reorder: 1, target: 2, mfr: "Detroit Diesel", desc: "Cambio anual. Confirmar modelo exacto del motor instalado en YT010 para precisar P/N." },
  { sku: "DET-OILF", name: "Filtro de aceite de motor", category: "Filtros", unit: "u", crit: "A", min: 2, reorder: 2, target: 4, mfr: "Detroit Diesel", desc: "Cambio anual. Confirmar modelo y capacidad cárter." },
  { sku: "DET-FUELPRE", name: "Cartucho pre-filtro de combustible", category: "Filtros", unit: "u", crit: "A", min: 2, reorder: 2, target: 4, mfr: "Detroit Diesel", desc: "Filtro primario. Cambio anual. Confirmar modelo del motor." },
  { sku: "DET-FUELFINE", name: "Filtro fino de combustible", category: "Filtros", unit: "u", crit: "A", min: 1, reorder: 1, target: 2, mfr: "Detroit Diesel", desc: "Filtro secundario. Cambio anual. Confirmar modelo del motor." },
  { sku: "DET-OIL", name: "Aceite de motor (genérico)", category: "Lubricantes", unit: "L", crit: "B", min: 50, reorder: 60, target: 120, desc: "Capacidad cárter ~40-60L según modelo Detroit. Confirmar viscosidad y especificación." },
  { sku: "HYD-OIL", name: "Aceite hidráulico (genérico)", category: "Lubricantes", unit: "L", crit: "B", min: 20, reorder: 25, target: 50, desc: "Para bomba y sistemas de transmisión. Confirmar tipo y viscosidad." },
  { sku: "KSB-SEAL", name: "Sello mecánico bomba de descarga", category: "Bombas", unit: "u", crit: "B", min: 1, reorder: 1, target: 2, mfr: "KSB / SYLWAM", desc: "Componente de desgaste. Confirmar modelo de bomba instalado." },
  { sku: "PUMP-PKT", name: "Empaquetadura/junta caja de bomba", category: "Juntas", unit: "u", crit: "B", min: 2, reorder: 2, target: 4, desc: "Desarmado, limpieza, remplazo. Confirmar modelo de bomba y caja reductora." },
];

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
    throw new Error(
      `Buque '${VESSEL}' no existe en tenant '${SLUG}'. Cárgalo primero con load-mercurio-barges.ts`,
    );
  }

  let nAssets = 0;
  let nPlans = 0;
  let totalEst = 0;
  const seenCodes = new Set<string>();

  for (const a of ASSETS) {
    const sfiCode = `${a.group}00`;
    let assetId = "(dry)";
    if (!DRY) {
      const asset = await prisma.asset.upsert({
        where: { tenantId_vesselCode_assetCode: { tenantId: tid, vesselCode: VESSEL, assetCode: a.code } },
        update: {
          name: a.name, sfiCode, criticality: a.crit, status: a.status ?? "OPERATIONAL",
          isSafetyCritical: a.safety ?? false,
          manufacturer: a.mfr ?? null, model: a.model ?? null, serialNumber: a.serial ?? null,
          updatedByUserId: uid,
        },
        create: {
          tenantId: tid, vesselCode: VESSEL, assetCode: a.code, sfiCode,
          name: a.name, criticality: a.crit, status: a.status ?? "OPERATIONAL",
          isSafetyCritical: a.safety ?? false,
          manufacturer: a.mfr ?? null, model: a.model ?? null, serialNumber: a.serial ?? null,
          createdByUserId: uid, updatedByUserId: uid,
        },
        select: { id: true },
      });
      assetId = asset.id;
    }
    nAssets++;
    console.log(`${DRY ? "DRY " : "✓ "}Asset ${a.code} — ${a.name} (${a.tasks.length} planes)`);

    for (let i = 0; i < a.tasks.length; i++) {
      const [title, freq, last, next, typeOverride] = a.tasks[i];
      const { triggerType, frequencyHours, frequencyMonths } = parseFreq(freq);
      const taskType = typeOverride === "I" ? "INSPECTION" : "MAINTENANCE";
      const est = estimateHours(title);
      totalEst += est;
      const taskCode = `${a.code}-${String(i + 1).padStart(2, "0")}`;
      if (seenCodes.has(taskCode)) throw new Error(`taskCode duplicado: ${taskCode}`);
      seenCodes.add(taskCode);
      const data: Record<string, unknown> = {
        title, description: a.desc ?? null,
        triggerType, frequencyHours, frequencyMonths, estimatedHours: est, taskType,
        triggerResultMode: "AUTO_WO",
        department: "BARCAZA",
        sfiGroupNumber: a.group, sfiSubgroupCode: null,
        responsible: "Jefe de Máquinas",
        status: "ACTIVE",
      };
      applyTiming(data, last ?? null, next ?? null);
      nPlans++;
      if (!DRY) {
        await prisma.maintenancePlan.upsert({
          where: { tenantId_vesselCode_taskCode: { tenantId: tid, vesselCode: VESSEL, taskCode } },
          update: { ...data, updatedByUserId: uid },
          create: {
            tenantId: tid, vesselCode: VESSEL, assetId, taskCode,
            ...data, createdByUserId: uid, updatedByUserId: uid,
          },
        });
      }
    }
  }

  // ── Repuestos ───────────────────────────────────────────────────────────────
  let nSpares = 0;
  for (const s of SPARES) {
    nSpares++;
    console.log(`${DRY ? "DRY " : "✓ "}Spare ${s.sku} — ${s.name}`);
    if (!DRY) {
      const spareData = {
        name: s.name, category: s.category, unit: s.unit, criticality: s.crit,
        manufacturer: s.mfr ?? null, model: s.model ?? null, sfiCode: "200",
        minStock: s.min, reorderPoint: s.reorder, targetStock: s.target ?? null,
        longDescription: s.desc ?? null, status: "ACTIVE" as const,
      };
      await prisma.spare.upsert({
        where: { tenantId_vesselCode_sku: { tenantId: tid, vesselCode: VESSEL, sku: s.sku } },
        update: { ...spareData, updatedByUserId: uid },
        create: {
          tenantId: tid, vesselCode: VESSEL, sku: s.sku,
          ...spareData, createdByUserId: uid, updatedByUserId: uid,
        },
      });
    }
  }

  console.log(
    `\n${DRY ? "DRY-RUN (no se escribió nada). " : "✅ Completado. "}` +
      `${nAssets} activos · ${nPlans} planes de mantenimiento · ${nSpares} repuestos · ${totalEst}h estimadas totales.`,
  );
}

main()
  .catch((e) => {
    console.error("❌ Error:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
