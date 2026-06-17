/**
 * Seed idempotente — MAO 01 (buque code "M01", tenant "mercurio").
 * Carga /assets y /maintenance-plans desde los Excel del MAO 01:
 *   - Hoja "PLAN DE MANTENIMIENTO MAO 01" (items 1..47, snapshot mayo 2026)
 *   - Hoja "EQUIPOS CRITICOS" (registro de pruebas, snapshot mayo 2026)
 *
 * Reglas aplicadas (pedido del usuario):
 *   - Cada activo recibe Grupo SFI + Subgrupo SFI (esquema documentado abajo).
 *   - Frecuencia tomada del Excel (Hs/lapso): horas, días, meses.
 *   - estimatedHours: estimada por heurística según tipo de tarea (ver estimateHours()).
 *   - triggerResultMode = "AUTO_WO"  ("Requiere OT") en TODOS los planes.
 *   - lastExecution* / nextDue* tomados del snapshot de mayo 2026
 *     (horas → meter de servicio; fechas → última verificación / próximo recorrido).
 *
 * Esquema SFI (grupo · subgrupo) usado:
 *   6 Componentes Principales:  601 Motor Principal · 603 Caja reductora ·
 *                               605 Línea de eje · 611 Motor Auxiliar · 612 Motor lancha
 *   7 Sistemas:                 701 Combustible · 720 Refrig/Achique/Agua de mar ·
 *                               740 Aire comprimido · 750 Hidráulico gobierno/maniobra ·
 *                               760 Ventilación
 *   8 Instalaciones Eléctricas: 801 Alternadores · 802 Tablero principal ·
 *                               803 Baterías/iluminación emergencia · 804 Aislaciones
 *   4 Equipo de Barco:          440 Contraincendio · 450 Lucha contra derrames
 *   5 Tripulación:              551 Agua potable · 552 Sewage · 553 Termotanque · 554 Cocina
 *   3 Manipulación de carga:    310 Elementos elevación · 311 Malacate pluma lancha
 *   9 Automatización/Nav/Com:   901 Navegación · 902 Comunicación · 910 Alarmas y seguridades
 *
 * Uso:
 *   DATABASE_URL=<url> npx tsx scripts/seed-mao01-maintenance.ts
 *   DRY=1 DATABASE_URL=<url> npx tsx scripts/seed-mao01-maintenance.ts   → previsualiza
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

// ── tipos ────────────────────────────────────────────────────────────────────
type Crit = "A" | "B" | "C";
type Status = "OPERATIONAL" | "OUT_OF_SERVICE" | "DEGRADED";
// [title, freq, last, next, typeOverride?]   freq: "7d"|"3mo"|"500h"|null
//   last/next: number = meter de horas; "YYYY-MM-DD" = fecha; null = sin dato
type Task = [string, string | null, (string | number | null)?, (string | number | null)?, ("I" | "M")?];
interface AssetDef {
  code: string;
  name: string;
  group: number;
  sub: string;
  crit: Crit;
  safety?: boolean;
  mfr?: string;
  model?: string;
  serial?: string;
  status?: Status;
  desc?: string;
  tasks: Task[];
}

// ── helpers ──────────────────────────────────────────────────────────────────
function parseFreq(freq: string | null): {
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
} {
  if (!freq) return { triggerType: "CONDITION", frequencyHours: null, frequencyMonths: null };
  const m = freq.match(/^(\d+)(d|mo|h)$/);
  if (!m) return { triggerType: "CONDITION", frequencyHours: null, frequencyMonths: null };
  const n = Number(m[1]);
  if (m[2] === "h") return { triggerType: "HOURS", frequencyHours: n, frequencyMonths: null };
  if (m[2] === "d") return { triggerType: "DAY", frequencyHours: null, frequencyMonths: n };
  return { triggerType: "MONTHS", frequencyHours: null, frequencyMonths: n };
}

function classify(title: string): "MAINTENANCE" | "INSPECTION" {
  return /\b(prueba|verific|control|inspecc|toma de aisla|aislaci|an[aá]lisis|tomar muestra|muestra|precinto)\b/i.test(
    title,
  )
    ? "INSPECTION"
    : "MAINTENANCE";
}

function estimateHours(title: string): number {
  const t = title.toLowerCase();
  if (/(recorrido general|recorrido mayor|recorrido de bomba|recorrido motor|cambio de inyectores|cambio de rodamient|barnizado|recorrido del|recorrido completo)/.test(t)) return 16;
  if (/(inyector|turbo|turbosoplante|culata|colector|recorrido|bomba de agua|bomba de combust|caja reductora)/.test(t)) return 8;
  if (/(cambio|renovar|empaquetadura|rotor|correa|l[ií]quido refrigerante|ferrodos|calibraci|magnetron|filtro|aceite|prueba hidr)/.test(t)) return 2;
  return 1; // limpieza, control, verificación, prueba, engrase, aislación, etc.
}

function applyTiming(data: Record<string, unknown>, last?: string | number | null, next?: string | number | null) {
  if (typeof last === "number") data.lastExecutionHours = last;
  else if (typeof last === "string" && /^\d{4}-\d{2}-\d{2}$/.test(last)) data.lastExecutionDate = new Date(`${last}T00:00:00.000Z`);
  if (typeof next === "number") data.nextDueHours = next;
  else if (typeof next === "string" && /^\d{4}-\d{2}-\d{2}$/.test(next)) data.nextDueDate = new Date(`${next}T00:00:00.000Z`);
}

// ── DATA: assets + tasks (MAO 01, snapshot mayo 2026) ─────────────────────────
const ENGINE_MP = "Volvo Penta D16 MH";
const ENGINE_MA = "Cummins 4BTA3-G1";

const ASSETS: AssetDef[] = [
  // ── SISTEMA DE PROPULSIÓN ──────────────────────────────────────────────────
  {
    code: "M01-MP-ER", name: "Motor Principal Estribor", group: 6, sub: "601", crit: "A", safety: true,
    mfr: "Volvo Penta", model: ENGINE_MP,
    tasks: [
      ["Control correas de transmisión", "500h", 23565, 24065],
      ["Cambio de aceite y filtros de aceite/by pass", "500h", 23565, 24065],
      ["Cambio rotor de bomba de agua", "2500h", 23565, 26065],
      ["Cambio de filtro de Gas Oil (primario/secundario)", "300h", 23565, 23865],
      ["Controlar luz de válvulas", "1800h", 23565, 25365],
      ["Tomar muestras y analizar el aceite lubricante", "6mo", "2025-12-21", "2026-06-19"],
      ["Cambio de filtro de aire", "12mo", "2026-12-30", "2027-12-30"],
      ["Cambio de líquido refrigerante", "24mo", "2024-05-20", "2026-05-20"],
      ["Control del turbocompresor", "2000h", 23565, 25565],
      ["Inyector N°1 - recorrido", "10000h", 18612, 28612],
      ["Inyector N°2 - recorrido", "10000h", 18612, 28612],
      ["Inyector N°3 - recorrido", "10000h", 18612, 28612],
      ["Inyector N°4 - recorrido", "10000h", 18612, 28612],
      ["Inyector N°5 - recorrido", "10000h", 18612, 28612],
      ["Inyector N°6 - recorrido", "10000h", 18612, 28612],
      ["Cambio de inyectores", "24000h", null, 24000],
      ["Recorrido general", "24000h", null, 24000],
      ["Pruebas de alarmas P° L.O., nivel aceite, T° agua, sobrevelocidad", "6mo", "2025-11-12", "2026-05-11"],
      ["Control de estado y carga de baterías de arranque", "7d", "2026-04-15", "2026-04-22"],
      ["Cambio de grupo de baterías de arranque", "18mo", "2026-02-25", "2027-08-27"],
      // EQUIPOS CRITICOS (pruebas)
      ["Seguridades: prueba de funcionamiento alarmas led P-T°-parada EGA", "1mo", "2026-05-02", null, "I"],
      ["Gobierno de emergencia: prueba de función con cubierta ángulo de timón", "1mo", "2026-05-28", null, "I"],
    ],
  },
  {
    code: "M01-MP-BR", name: "Motor Principal Babor", group: 6, sub: "601", crit: "A", safety: true,
    mfr: "Volvo Penta", model: ENGINE_MP,
    tasks: [
      ["Control correas de transmisión", "500h", 23635, 24135],
      ["Cambio de aceite y filtros de aceite/by pass", "500h", 23635, 24135],
      ["Cambio rotor de bomba de agua", "2500h", 23635, 26135],
      ["Cambio de filtro de Gas Oil (primario/secundario)", "300h", 23635, 23935],
      ["Controlar luz de válvulas", "1800h", 23635, 25435],
      ["Tomar muestras y analizar el aceite lubricante", "6mo", "2025-12-28", "2026-06-26"],
      ["Cambio de filtro de aire", "12mo", "2025-10-11", "2026-10-11"],
      ["Cambio de líquido refrigerante", "24mo", "2024-05-20", "2026-05-20"],
      ["Control del turbocompresor", "2000h", 23635, 25635],
      ["Inyector N°1 - recorrido", "10000h", 23635, 33635],
      ["Inyector N°2 - recorrido", "10000h", 23635, 33635],
      ["Inyector N°3 - recorrido", "10000h", 23635, 33635],
      ["Inyector N°4 - recorrido", "10000h", 23635, 33635],
      ["Inyector N°5 - recorrido", "10000h", 23635, 33635],
      ["Inyector N°6 - recorrido", "10000h", 23635, 33635],
      ["Cambio de inyectores", "24000h", 23635, 47635],
      ["Recorrido general", "24000h", null, 24000],
      ["Pruebas de alarmas P° L.O., nivel aceite, T° agua, sobrevelocidad", "6mo", "2025-11-12", "2026-05-11"],
      ["Control de estado y carga de baterías de arranque", "7d", "2026-04-15", "2026-04-22"],
      ["Cambio de grupo de baterías de arranque", "18mo", "2026-02-25", "2027-08-27"],
      ["Seguridades: prueba de funcionamiento alarmas led P-T°-parada EGA", "1mo", "2026-05-28", null, "I"],
      ["Gobierno de emergencia: prueba de función con cubierta ángulo de timón", "1mo", "2026-05-28", null, "I"],
    ],
  },
  {
    code: "M01-CR-ER", name: "Caja reductora Estribor", group: 6, sub: "603", crit: "A",
    mfr: "Twin Disc", model: "5170",
    tasks: [
      ["Control de estado y limpieza de venteo respirador", "1mo", null, null],
      ["Cambio de aceite y filtro de descarga. Limpieza filtro de aspiración", "1000h", 22643, 23643],
      ["Tomar muestras y analizar el aceite lubricante", "6mo", "2025-12-18", "2026-06-16"],
      ["Análisis de vibraciones", "9500h", 18979, 28479],
      ["Recorrido general", "24000h", null, 24000],
    ],
  },
  {
    code: "M01-CR-BR", name: "Caja reductora Babor", group: 6, sub: "603", crit: "A",
    mfr: "Twin Disc", model: "5170",
    tasks: [
      ["Control de estado y limpieza de venteo respirador", "1mo", null, null],
      ["Cambio de aceite y filtro de descarga. Limpieza filtro de aspiración", "1000h", 22530, 23530],
      ["Tomar muestras y analizar el aceite lubricante", "6mo", "2025-12-18", "2026-06-16"],
      ["Análisis de vibraciones", "9500h", 19056, 28556],
      ["Recorrido general", "24000h", null, 24000],
    ],
  },
  {
    code: "M01-EJE-ER", name: "Línea de eje Estribor", group: 6, sub: "605", crit: "A",
    tasks: [
      ["Controlar, reapriete de prensa estopa", "3mo", "2026-01-02", "2026-04-02"],
      ["Cambio de empaquetadura", "12mo", "2026-01-02", "2027-01-02"],
      ["Verificar manchón de acoplamiento", "12mo", "2026-01-02", "2027-01-02"],
    ],
  },
  {
    code: "M01-EJE-BR", name: "Línea de eje Babor", group: 6, sub: "605", crit: "A",
    tasks: [
      ["Controlar, reapriete de prensa estopa", "3mo", "2026-01-02", "2026-04-02"],
      ["Cambio de empaquetadura", "12mo", "2026-01-02", "2027-01-02"],
      ["Verificar manchón de acoplamiento", "12mo", "2026-01-02", "2027-01-02"],
    ],
  },
  // ── PLANTA ELÉCTRICA MOTORES AUXILIARES ────────────────────────────────────
  {
    code: "M01-MA-ER", name: "Motor Auxiliar Estribor", group: 6, sub: "611", crit: "A", safety: true,
    mfr: "Cummins", model: ENGINE_MA, serial: "SO83879",
    tasks: [
      ["Cambio de aceite", "250h", 62323, 62573],
      ["Cambio de filtro de aceite", "250h", 62326, 62576],
      ["Control de filtro de aire / limpieza enfriador agua", "500h", 62323, 62823],
      ["Cambio de filtro de Gas Oil (primario/secundario)", "250h", 62323, 62573],
      ["Cambio de filtro de aire", "1000h", 62323, 63323],
      ["Tomar muestras y analizar el aceite lubricante", "6mo", "2026-02-09", "2026-08-08"],
      ["Controlar luz de válvulas", "1500h", 61428, 62928],
      ["Verificación y ajuste correa de transmisión", "1500h", 62323, 63823],
      ["Control de estado de mangueras", "1500h", 62323, 63823],
      ["Cambio de líquido refrigerante", "12mo", "2026-04-10", "2027-04-10"],
      ["Inyector N°1 - recorrido", "4500h", 57037, 61537],
      ["Inyector N°2 - recorrido", "4500h", 57037, 61537],
      ["Inyector N°3 - recorrido", "4500h", 57037, 61537],
      ["Inyector N°4 - recorrido", "4500h", 57037, 61537],
      ["Cambio de inyectores", "32000h", 57037, 89037],
      ["Revisión y control bomba de agua", "5000h", 60534, 65534],
      ["Verificación y/o recorrido turbosoplante", "20000h", 57037, 77037],
      ["Recorrido general", "32000h", 57037, 89037],
      ["Control de estado y carga de baterías de arranque", "7d", "2026-04-10", "2026-04-17"],
      ["Cambio de grupo de baterías de arranque", "18mo", "2026-02-25", "2027-08-27"],
      ["Seguridades: prueba de función alarmas Vigía P-T° parada EGA", "1mo", "2026-05-28", null, "I"],
    ],
  },
  {
    code: "M01-MA-BR", name: "Motor Auxiliar Babor", group: 6, sub: "611", crit: "A", safety: true,
    mfr: "Cummins", model: ENGINE_MA, serial: "SO83879",
    tasks: [
      ["Cambio de aceite", "250h", 62172, 62422],
      ["Cambio de filtro de aceite", "250h", 62172, 62422],
      ["Control de filtro de aire / limpieza enfriador agua", "500h", 62172, 62672],
      ["Cambio de filtro de Gas Oil (primario/secundario)", "500h", 62172, 62672],
      ["Cambio de filtro de aire", "1000h", 62172, 63172],
      ["Tomar muestras y analizar el aceite lubricante", "6mo", "2025-12-19", "2026-06-17"],
      ["Controlar luz de válvulas", "1500h", 62017, 63517],
      ["Verificación y ajuste correa de transmisión", "1500h", 61168, 62668],
      ["Control de estado de mangueras", "1500h", 61168, 62668],
      ["Cambio de líquido refrigerante", "12mo", "2026-01-20", "2027-01-20"],
      ["Inyector N°1 - recorrido", "4500h", 56344, 60844],
      ["Inyector N°2 - recorrido", "4500h", 56344, 60844],
      ["Inyector N°3 - recorrido", "4500h", 56344, 60844],
      ["Inyector N°4 - recorrido", "4500h", 56344, 60844],
      ["Cambio de inyectores", "32000h", 56344, 88344],
      ["Revisión y control bomba de agua", "5000h", 59755, 64755],
      ["Verificación y/o recorrido turbosoplante", "20000h", 60906, 80906],
      ["Recorrido general", "32000h", 54590, 86590],
      ["Control de estado y carga de baterías de arranque", "7d", "2026-02-25", "2026-03-04"],
      ["Cambio de grupo de baterías de arranque", "18mo", "2026-02-25", "2027-08-27"],
      ["Seguridades: prueba de función alarmas Vigía P-T° parada EGA", "1mo", "2026-05-28", null, "I"],
    ],
  },
  {
    code: "M01-ALT-ER", name: "Alternador Estribor", group: 8, sub: "801", crit: "A",
    mfr: "DBT Cramaco", model: "G2R 200 SD/4", desc: "Transformador 380/220",
    tasks: [
      ["Control aislación", "12mo", "2024-10-24", "2025-10-24"],
      ["Limpieza de estator y rotor", "24mo", "2023-10-31", "2025-10-30"],
      ["Cambio de rodamientos y barnizado (dique seco)", "60mo", "2023-10-31", "2029-09-19"],
    ],
  },
  {
    code: "M01-ALT-BR", name: "Alternador Babor", group: 8, sub: "801", crit: "A",
    mfr: "DBT Cramaco", model: "G2R 200 SD/4", desc: "Transformador 380/220",
    tasks: [
      ["Control aislación", "12mo", "2024-05-20", "2025-05-20"],
      ["Limpieza de estator y rotor", "24mo", "2024-05-20", "2026-05-20"],
      ["Cambio de rodamientos y barnizado (dique seco)", "60mo", "2023-07-12", "2029-05-31"],
    ],
  },
  {
    code: "M01-TEP", name: "Tablero Eléctrico Principal", group: 8, sub: "802", crit: "A",
    tasks: [
      ["Limpieza interior", "6mo", "2024-10-24", "2025-04-22"],
      ["Control y ajuste de contactores y protecciones", "12mo", "2024-02-24", "2025-02-23"],
      ["Verificación de instrumental", "12mo", "2024-02-24", "2025-02-23"],
      ["Protocolo de protecciones térmicas", "36mo", "2024-02-24", "2027-02-08"],
    ],
  },
  // ── CIRCUITO DE COMBUSTIBLE ────────────────────────────────────────────────
  {
    code: "M01-COMB-CAL", name: "Calidad del Combustible", group: 7, sub: "701", crit: "B",
    tasks: [
      ["Toma de muestra para analizar", "12mo", "2025-12-30", "2026-12-30"],
      ["Prueba de funcionamiento", "1mo", "2026-01-28", "2026-02-27"],
    ],
  },
  {
    code: "M01-PURIF", name: "Purificadora de combustible", group: 7, sub: "701", crit: "B", status: "OUT_OF_SERVICE",
    mfr: "Alfa Laval", model: "MAB 102 B-25", desc: "Fuera de servicio (F/S)",
    tasks: [
      ["Limpieza y cambio de aceite", "1mo", null, null],
      ["Toma de aislación a motor eléctrico", "12mo", null, null],
      ["Motor eléctrico: verificar ajustes y estanqueidad bornera", "12mo", null, null],
      ["Recorrido motor eléctrico: limpieza, barnizado, cambio rodamientos", "60mo", null, null],
      ["Control o cambio de ferrodos de embrague", "12mo", null, null],
      ["Recorrido mayor", "60mo", null, null],
    ],
  },
  {
    code: "M01-EB-TRASV", name: "ElectroBomba Trasvase de Combustible", group: 7, sub: "701", crit: "B",
    desc: "1390 rpm · Rodamientos 6204 ZZ",
    tasks: [
      ["Prueba de funcionamiento", "1mo", "2026-01-28", "2026-02-27"],
      ["Recorrido de bomba", "60mo", "2024-01-03", "2029-01-01"],
      ["Toma de aislación a motor eléctrico", "12mo", "2024-10-24", "2025-10-24"],
      ["Motor eléctrico: verificar ajustes y estanqueidad bornera", "12mo", "2024-10-25", "2025-10-25"],
      ["Recorrido motor eléctrico: limpieza, barnizado, cambio rodamientos", "60mo", "2024-01-03", "2029-01-01"],
    ],
  },
  {
    code: "M01-TUB-COMB", name: "Tubería embarque de combustible", group: 7, sub: "701", crit: "B",
    tasks: [
      ["Prueba hidráulica de tuberías. Certificado", "12mo", "2024-02-20", "2025-02-19"],
      ["Verificar estado de BCU: brida ciega con bulonería, identificación, bandeja derrame limpia y con tapón", "6mo", "2025-10-15", "2026-04-13"],
      ["Tomas de embarque carbonera: control de limpieza, cartelería y estado de bandejas", "6mo", "2025-10-15", "2026-04-13"],
    ],
  },
  // ── BOMBAS ELÉCTRICAS ──────────────────────────────────────────────────────
  {
    code: "M01-EB-AP1", name: "ElectroBomba Agua Potable N°1", group: 5, sub: "551", crit: "B",
    mfr: "Rowa", model: "RP270",
    tasks: [
      ["Prueba de funcionamiento", "1mo", "2026-01-28", "2026-02-27"],
      ["Recorrido de bomba: verificación aro rendimiento, cambio de sellos o reemplazo", "60mo", "2023-03-17", "2028-03-15"],
      ["Recorrido motor eléctrico: limpieza, barnizado, cambio rodamientos", "60mo", "2023-03-17", "2028-03-15"],
      ["Toma de aislación a motor eléctrico", "12mo", "2025-10-25", "2026-10-25"],
      ["Motor eléctrico: verificar ajustes y estanqueidad bornera", "12mo", "2025-10-25", "2026-10-25"],
    ],
  },
  {
    code: "M01-EB-AP2", name: "ElectroBomba Agua Potable N°2", group: 5, sub: "551", crit: "B",
    mfr: "Rowa", model: "RP270",
    tasks: [
      ["Recorrido de bomba: verificación aro rendimiento, cambio de sellos o reemplazo", "60mo", "2023-03-17", "2028-03-15"],
      ["Recorrido motor eléctrico: limpieza, barnizado, cambio rodamientos", "60mo", "2023-03-17", "2028-03-15"],
      ["Toma de aislación a motor eléctrico", "12mo", "2026-11-12", "2027-11-12"],
      ["Motor eléctrico: verificar ajustes y estanqueidad bornera", "12mo", "2026-10-25", "2027-10-25"],
      ["Prueba de funcionamiento", "1mo", "2026-09-14", "2026-10-14"],
    ],
  },
  {
    code: "M01-EB-INC-P", name: "ElectroBomba de Incendio Principal", group: 4, sub: "440", crit: "A", safety: true,
    mfr: "Grundfos", model: "32-4-22",
    tasks: [
      ["Recorrido de bomba: verificación aro rendimiento, cambio de sellos o reemplazo", "60mo", null, null],
      ["Recorrido motor eléctrico: limpieza, barnizado, cambio rodamientos", "60mo", null, null],
      ["Toma de aislación a motor eléctrico", "12mo", "2026-02-10", "2026-05-11"],
      ["Motor eléctrico: verificar ajustes y estanqueidad bornera", "12mo", "2026-10-24", "2027-10-24"],
      ["Prueba de funcionamiento", "1mo", "2026-04-15", "2026-05-15"],
      ["Prueba de funcionamiento (en conjunto con Cubierta)", "15d", "2026-05-22", null, "I"],
    ],
  },
  {
    code: "M01-BBA-INC-EM", name: "Bomba de Incendio de Emergencia (acoplada a MP)", group: 4, sub: "440", crit: "A", safety: true, status: "OUT_OF_SERVICE",
    mfr: "KSB", model: "Multitec", desc: "Fuera de servicio",
    tasks: [
      ["Recorrido de bomba: verificación aro rendimiento, cambio de sellos o reemplazo", "60mo", null, null],
      ["Verificación de manchón de acoplamiento", "36mo", "2024-01-25", "2027-01-09"],
      ["Prueba de funcionamiento", "1mo", "2026-04-15", "2026-05-15"],
      ["Prueba de funcionamiento (en conjunto con Cubierta)", "7d", "2026-05-26", null, "I"],
    ],
  },
  {
    code: "M01-EB-REF1", name: "ElectroBomba Agua Refrigeración MMAA, Achique y Serv. Grales N°1", group: 7, sub: "720", crit: "B",
    mfr: "Grundfos", model: "32-4-22",
    tasks: [
      ["Recorrido de bomba: verificación aro rendimiento, cambio de sellos o reemplazo", "60mo", "2024-10-17", "2029-10-16"],
      ["Recorrido motor eléctrico: limpieza, barnizado, cambio rodamientos", "60mo", "2024-10-17", "2029-10-16"],
      ["Toma de aislación a motor eléctrico", "12mo", "2025-11-12", "2026-11-12"],
      ["Motor eléctrico: verificar ajustes y estanqueidad bornera", "12mo", "2025-10-17", "2026-10-17"],
      ["Prueba de funcionamiento", "1mo", "2026-04-15", "2026-05-15"],
    ],
  },
  {
    code: "M01-EB-REF2", name: "ElectroBomba Agua Refrigeración MMAA, Achique y Serv. Grales N°2", group: 7, sub: "720", crit: "B",
    mfr: "Grundfos", model: "32-4-22",
    tasks: [
      ["Recorrido de bomba: verificación aro rendimiento, cambio de sellos o reemplazo", "60mo", null, null],
      ["Recorrido motor eléctrico: limpieza, barnizado, cambio rodamientos", "60mo", null, null],
      ["Toma de aislación a motor eléctrico", "12mo", "2025-11-12", "2026-11-12"],
      ["Motor eléctrico: verificar ajustes y estanqueidad bornera", "12mo", "2025-10-19", "2026-10-19"],
      ["Prueba de funcionamiento", "1mo", "2026-04-15", "2026-05-15"],
    ],
  },
  {
    code: "M01-EB-ACH-SENT", name: "ElectroBomba Achique de Sentina", group: 7, sub: "720", crit: "B",
    tasks: [
      ["Recorrido de bomba: control de estator de goma, eje sin fin y retén", "60mo", "2024-02-20", "2029-02-18"],
      ["Recorrido motor eléctrico: limpieza, barnizado, cambio rodamientos", "60mo", null, "2030-12-29"],
      ["Toma de aislación a motor eléctrico", "12mo", "2026-11-12", "2027-11-12"],
      ["Motor eléctrico: verificar ajustes y estanqueidad bornera", "12mo", "2026-02-19", "2027-02-19"],
    ],
  },
  {
    code: "M01-ACH-TIMON", name: "Achique de Cuarto de Timón", group: 7, sub: "720", crit: "B",
    tasks: [
      ["Verificar apertura y cierre de todas las válvulas del sistema", "6mo", "2025-12-27", "2026-06-25"],
    ],
  },
  {
    code: "M01-FILT-ACH", name: "Filtros de Achique Sentina", group: 7, sub: "720", crit: "B",
    tasks: [
      ["Limpiar y controlar estado de filtro general y rejillas de aspiración de sentina", "3mo", "2026-02-26", "2026-05-27"],
    ],
  },
  {
    code: "M01-FILT-MAR", name: "Filtros tomas de mar", group: 7, sub: "720", crit: "B",
    tasks: [
      ["Desarme y limpieza", "1mo", "2026-03-28", "2026-04-27"],
    ],
  },
  // ── COMPRESORES ────────────────────────────────────────────────────────────
  {
    code: "M01-COMP-NK40", name: "Electrocompresor a tornillo NK40", group: 7, sub: "740", crit: "B",
    mfr: "Cetec", model: "NK40-7.5",
    tasks: [
      ["Verificar funcionamiento", "1mo", "2026-04-28", "2026-05-28"],
      ["Control de correa", "1mo", "2026-04-28", "2026-05-28"],
      ["Cambio de aceite y filtro de aceite", "3000h", 3809, 6809],
      ["Cambio filtro de aire", "3000h", 3809, 6809],
      ["Módulo de comando, control y cambio si es necesario", "3000h", null, 3000],
      ["Control y cambio si es necesario de elementos de aspiración", "6000h", null, 6000],
      ["Control y cambio si es necesario de mangueras (kit de mangueras)", "6000h", null, 6000],
      ["Control de pistas y sellos mecánicos", "9000h", null, 9000],
      ["Control y cambio si es necesario de presostatos", "12000h", null, 12000],
      ["Control y cambio si es necesario de rodamientos", "12000h", null, 12000],
      ["Toma de aislación a motor eléctrico", "12mo", "2025-11-12", "2026-11-12"],
      ["Motor eléctrico: verificar ajustes y estanqueidad bornera", "12mo", "2026-11-12", "2027-11-12"],
      ["Recorrido general", "60mo", "2025-06-18", "2030-06-17"],
    ],
  },
  {
    code: "M01-COMP-PITO", name: "Compresor Aire Pito", group: 7, sub: "740", crit: "C",
    tasks: [
      ["Prueba de funcionamiento, control de aceite y estado general", "1mo", "2026-03-28", "2026-04-27"],
      ["Cambio de aceite", "6mo", "2026-01-28", "2026-07-27"],
      ["Toma de aislación a motor eléctrico", "12mo", "2026-11-12", "2027-11-12"],
      ["Motor eléctrico: verificar ajustes y estanqueidad bornera", "12mo", "2025-10-19", "2026-10-19"],
    ],
  },
  // ── SISTEMA HIDRÁULICO DE GOBIERNO Y MANIOBRA ──────────────────────────────
  {
    code: "M01-HID-GOB", name: "Sistema Hidráulico de Gobierno y Maniobra", group: 7, sub: "750", crit: "A", safety: true,
    tasks: [
      ["Sistema de transmisión antagónico de timones: engrase y control de flexibles/conexiones", "1mo", "2026-04-15", "2026-05-15"],
      ["Sistema hidráulico: tomar muestra L.O. para analizar", "6mo", "2025-12-18", "2026-06-16"],
      ["Aceite hidráulico: cambiar", "36mo", "2025-03-20", "2028-03-19"],
      ["Filtros de aceite circuito hidráulico: cambio", "6mo", "2025-09-16", "2026-03-15"],
      ["Bomba hidráulica acoplada a motor propulsor Ebr: recorrido general (juntas, o'rings, mangueras)", "60mo", "2025-03-20", "2030-03-21"],
      ["Bomba hidráulica acoplada a motor propulsor Bbr: recorrido general (juntas, o'rings, mangueras)", "60mo", "2025-03-20", "2030-03-21"],
      ["Guinches de maniobra: engrase y control de alemite, rodamiento, cadena, flexibles y conexiones", "1mo", "2026-02-27", "2026-03-29"],
      ["Cambio de la totalidad de los flexibles hidráulicos sobre cubierta", "60mo", "2024-10-31", "2029-11-01"],
      // EQUIPOS CRITICOS
      ["Operación EGA de motores principales: verificar maniobra telégrafo y comando acelerador", "1mo", "2026-05-15", null, "I"],
      ["Timón de emergencia: prueba de funcionamiento", "1mo", "2026-05-15", null, "I"],
    ],
  },
  // ── VENTILADORES Y EXTRACTORES ─────────────────────────────────────────────
  {
    code: "M01-VENT", name: "Ventiladores y Extractores", group: 7, sub: "760", crit: "B",
    tasks: [
      ["Ventilador N°1 CTRO ER: puesta en marcha e inspección visual", "1mo", "2026-04-17", "2026-05-17"],
      ["Ventilador N°2 CTRO BR: puesta en marcha e inspección visual", "1mo", "2026-04-17", "2026-05-17"],
      ["Ventilador N°3: puesta en marcha e inspección visual", "1mo", "2026-04-17", "2026-05-17"],
      ["Ventilador N°4: puesta en marcha e inspección visual", "1mo", "2026-04-17", "2026-05-17"],
      ["Extractor N°1: puesta en marcha e inspección visual", "1mo", "2026-04-17", "2026-05-17"],
      ["Extractor N°2: puesta en marcha e inspección visual", "1mo", "2026-04-17", "2026-05-17"],
      ["Ventilador CTO Timón: puesta en marcha e inspección visual", "1mo", "2026-04-17", "2026-05-17"],
      ["Extractor Casillaje: puesta en marcha e inspección visual", "1mo", "2026-04-17", "2026-05-17"],
      ["Extractor Baños: puesta en marcha e inspección visual", "1mo", "2026-03-17", "2026-04-16"],
      ["Extractor Cocina: puesta en marcha e inspección visual", "1mo", "2026-04-16", "2026-05-16"],
      ["Toma de aislación de todos los ventiladores y extractores", "3mo", "2026-02-10", "2026-05-11"],
      ["Recorrido motor eléctrico, cambio de rodamiento, control general", "60mo", null, null],
    ],
  },
  // ── OTROS ──────────────────────────────────────────────────────────────────
  {
    code: "M01-AJUSTES", name: "Control de Ajustes Generales (instalación eléctrica)", group: 8, sub: "804", crit: "C",
    tasks: [
      ["Control de cajas exteriores/interiores, artefactos eléctricos de iluminación, tulipas y prensas", "1mo", "2026-01-25", "2026-02-24"],
    ],
  },
  {
    code: "M01-MALACATE", name: "Malacate eléctrico de pluma de lancha", group: 3, sub: "311", crit: "B",
    tasks: [
      ["Prueba de funcionamiento", "1mo", "2026-01-25", "2026-02-24"],
      ["Toma de aislación a motor eléctrico", "12mo", "2024-11-12", "2025-04-25"],
      ["Motor eléctrico: verificar ajustes y estanqueidad bornera", "12mo", "2024-04-25", "2025-04-25"],
    ],
  },
  {
    code: "M01-LIBRO-AISL", name: "Libro de Aislaciones", group: 8, sub: "804", crit: "C",
    tasks: [
      ["Toma de aislaciones", "12mo", "2024-11-12", "2025-11-12"],
    ],
  },
  {
    code: "M01-MOTOR-LANCHA", name: "Motor de Lancha", group: 6, sub: "612", crit: "B",
    tasks: [
      ["Puesta en marcha del motor e inspección visual", "1mo", "2026-04-15", "2026-05-15"],
      ["Control de estado y carga de batería", "1mo", "2026-04-15", "2026-05-15"],
      ["Control de filtro de combustible, bujías, nivel de aceite de la pata, mangueras", "1mo", "2026-04-15", "2026-05-15"],
      ["Cambio de aceite pata", "6mo", "2026-04-01", "2026-09-28"],
      ["Batería: cambio", "18mo", "2025-12-30", "2027-07-01"],
    ],
  },
  {
    code: "M01-TERMOTQ", name: "Termotanque", group: 5, sub: "553", crit: "C",
    tasks: [
      ["Inspección visual, extracción de fondo", "1mo", "2026-04-15", "2026-05-15"],
      ["Toma de aislación", "12mo", "2026-11-12", "2027-11-12"],
    ],
  },
  {
    code: "M01-SEWAGE", name: "Planta de Tratamiento Sewage", group: 5, sub: "552", crit: "C",
    tasks: [
      ["Prueba de funcionamiento", "1mo", "2026-04-15", "2026-05-15"],
      ["Prueba de parada de emergencia", "1mo", "2026-04-15", "2026-05-15"],
    ],
  },
  {
    code: "M01-COCINA", name: "Cocina", group: 5, sub: "554", crit: "C",
    tasks: [
      ["Inspección visual. Control de conexiones", "1mo", "2026-04-15", "2026-05-15"],
      ["Limpieza de filtros y campana (coordinar con cubierta)", "1mo", "2026-04-15", "2026-05-15"],
      ["Toma de aislación", "12mo", "2025-11-12", "2026-11-12"],
    ],
  },
  {
    code: "M01-ELEV", name: "Elementos de Elevación de Pesos", group: 3, sub: "310", crit: "B",
    tasks: [
      ["Control visual de monorrieles, aparejos, fajas y eslingas", "12mo", "2026-05-21", "2027-05-21"],
      ["Certificación de SWL de monorrieles, aparejos, fajas y eslingas", "12mo", "2026-01-20", "2027-01-20"],
    ],
  },
  // ── NAVEGACIÓN, ELECTRÓNICOS Y COMUNICACIÓN ────────────────────────────────
  {
    code: "M01-AIS", name: "AIS", group: 9, sub: "901", crit: "B", mfr: "Samyung", model: "SI-30",
    tasks: [
      ["Prueba de transmisión y recepción (TX/RX). Verificación de datos de configuración estáticos y con VTS / sistema internacional de AIS", "12mo", "2026-02-14", "2027-02-14", "I"],
    ],
  },
  {
    code: "M01-BAROM", name: "Barómetro", group: 9, sub: "901", crit: "C", mfr: "Western Germany",
    tasks: [
      ["Verificación de parámetros. Desarme, lubricación y calibración de resorte de compensación. Certificación", "12mo", "2026-02-15", "2027-02-15", "I"],
    ],
  },
  {
    code: "M01-COMPAS", name: "Compás Magnético", group: 9, sub: "901", crit: "B", mfr: "Danforth",
    tasks: [
      ["Verificación de curvas de desvíos de compás patrón. Certificación", "12mo", "2026-02-17", "2027-02-17", "I"],
    ],
  },
  {
    code: "M01-RADAR-BR", name: "Radar de Babor", group: 9, sub: "901", crit: "B", mfr: "Furuno", model: "1715",
    tasks: [
      ["Verificación de conexiones, limpieza interior de procesador y LED, regulación de sintonía y verificación de antena", "6mo", "2025-12-18", "2026-06-18", "I"],
      ["Cambio de magnetrón 2KW", "9000h", null, 9000],
    ],
  },
  {
    code: "M01-RADAR-ER", name: "Radar de Estribor", group: 9, sub: "901", crit: "B", mfr: "Furuno", model: "M1934 BB",
    tasks: [
      ["Verificación de conexiones, limpieza interior de procesador y LED, regulación de sintonía y verificación de antena", "6mo", "2026-04-15", "2026-10-14", "I"],
      ["Cambio de magnetrón 6KW", "9000h", null, 9000],
    ],
  },
  {
    code: "M01-ECO-BR", name: "Ecosonda Babor", group: 9, sub: "901", crit: "B", mfr: "Furuno",
    tasks: [
      ["Limpieza del panel, revisión de conectores, test de patrones y control de fuente de alimentación", "12mo", "2026-02-20", "2027-02-20", "I"],
    ],
  },
  {
    code: "M01-ECO-ER", name: "Ecosonda Estribor", group: 9, sub: "901", crit: "B", mfr: "Garmin", model: "Striker 4",
    tasks: [
      ["Limpieza del panel, revisión de conectores, test de patrones y control de fuente de alimentación", "12mo", "2026-02-20", "2027-02-20", "I"],
    ],
  },
  {
    code: "M01-ECO-REMOL", name: "Ecosonda del Remolcador", group: 9, sub: "901", crit: "B", mfr: "Furuno", model: "LS-4100",
    tasks: [
      ["Limpieza del panel, revisión de conectores, test de patrones y control de fuente de alimentación", "12mo", "2026-02-20", "2027-02-20", "I"],
    ],
  },
  {
    code: "M01-VHF-BR", name: "Radio VHF Babor", group: 9, sub: "902", crit: "A", safety: true, mfr: "Icom", model: "IC-M412",
    tasks: [
      ["Prueba de transmisión y recepción. Verificar display, conexiones, fuente de alimentación y potencia de salida", "12mo", "2025-07-28", "2026-07-28", "I"],
    ],
  },
  {
    code: "M01-VHF-ER", name: "Radio VHF Estribor", group: 9, sub: "902", crit: "A", safety: true, mfr: "Icom", model: "IC-M412",
    tasks: [
      ["Prueba de transmisión y recepción. Verificar display, conexiones, fuente de alimentación y potencia de salida", "12mo", "2026-04-21", "2027-04-21", "I"],
    ],
  },
  // ── EQUIPOS CRÍTICOS (registro de pruebas) — activos dedicados ──────────────
  {
    code: "M01-BAT-EGA", name: "Baterías y Sistemas de Emergencia EGA", group: 8, sub: "803", crit: "A", safety: true,
    desc: "Baterías de iluminación, navegación y radio EGA; iluminación y tablero de emergencia (24V CC)",
    tasks: [
      ["Baterías de iluminación EGA: verificar estado de carga y condición general, limpieza de bornes", "7d", "2026-05-26", null, "I"],
      ["Baterías de equipos de navegación y radio EGA: verificar carga, condición y limpieza de bornes", "7d", "2026-05-26", null, "I"],
      ["Iluminación de emergencia: verificar artefactos y eficiencia de baterías (mínimo 6 horas)", "7d", "2026-05-26", null, "I"],
      ["Tablero de luces de emergencia: controlar instrumental y ajuste de conexiones", "3mo", "2026-04-13", null, "I"],
      ["Baterías de iluminación EGA: renovar grupo de baterías", "18mo", "2026-02-25", "2027-08-27"],
      ["Baterías de equipos de navegación y radio: renovar grupo de baterías", "18mo", "2026-02-25", "2027-08-27"],
    ],
  },
  {
    code: "M01-MBBA-PORT", name: "Motobomba de Incendio EGA Portátil", group: 4, sub: "440", crit: "A", safety: true,
    tasks: [
      ["Prueba de funcionamiento (en conjunto con Cubierta)", "7d", "2026-05-26", null, "I"],
      ["Cambiar aceite, combustible y filtros", "6mo", "2025-12-13", null],
    ],
  },
  {
    code: "M01-CO2", name: "Sistema Fijo de CO2", group: 4, sub: "440", crit: "A", safety: true,
    tasks: [
      ["Prueba de funcionamiento de alarma visual y sonora de disparo", "1mo", "2026-05-15", null, "I"],
    ],
  },
  {
    code: "M01-DET-HUMO", name: "Detectores de Humo / Calor", group: 4, sub: "440", crit: "A", safety: true,
    tasks: [
      ["Inspección y prueba mensual de detectores de humo/calor", "30d", "2026-05-27", null, "I"],
    ],
  },
  {
    code: "M01-CORTES", name: "Cortes y Cierres de Emergencia (ventilación / combustible)", group: 4, sub: "441", crit: "A", safety: true,
    tasks: [
      ["Cortes de ventilación y bomba G.O.: prueba de funcionamiento a distancia eléctrico", "7d", "2026-05-26", null, "I"],
      ["Cierre de grampas de ventilación: prueba e inspección visual", "7d", "2026-05-26", null, "I"],
      ["Cortes de combustible a distancia: prueba de cierre a distancia de válvulas y nivel de tanques", "7d", "2026-05-26", null, "I"],
    ],
  },
  {
    code: "M01-VGA", name: "Válvulas de Gran Achique (PLANACON)", group: 4, sub: "450", crit: "A", safety: true,
    tasks: [
      ["Verificar estado de precintos", "1mo", "2026-05-15", null, "I"],
    ],
  },
  {
    code: "M01-ALARM-TK", name: "Alarmas de Tanques de Consumo G.O.", group: 9, sub: "910", crit: "A", safety: true,
    tasks: [
      ["Tanques carboneras G.O.: prueba de funcionamiento de alarma sonora/visual", "7d", "2026-05-26", null, "I"],
      ["Tanque diario G.O.: prueba de alarma de bajo nivel sonora/visual", "7d", "2026-05-26", null, "I"],
      ["Tanques de sedimentación G.O.: prueba de alarma de alto nivel sonora/visual", "7d", "2026-05-26", null, "I"],
      ["Tanque de residuos purificadora G.O.: prueba de alarma sonora/visual", "7d", "2026-05-26", null, "I"],
    ],
  },
  {
    code: "M01-ALARM-SENT", name: "Alarma de Sentina de Máquinas", group: 9, sub: "910", crit: "A", safety: true,
    tasks: [
      ["Prueba de función de alarma Estribor, Babor y Timón", "7d", "2026-05-26", null, "I"],
    ],
  },
  {
    code: "M01-TORRE", name: "Torre de Señales Lumínicas", group: 9, sub: "902", crit: "B",
    tasks: [
      ["Prueba de funcionamiento de luces, llamada telefónica, alarma general y alarmas de máquinas", "7d", "2026-05-26", null, "I"],
    ],
  },
  {
    code: "M01-TEL", name: "Teléfono de Consola Máquinas / Puente", group: 9, sub: "902", crit: "B",
    tasks: [
      ["Prueba de funcionamiento entre consola de máquinas y puente", "7d", "2026-05-26", null, "I"],
    ],
  },
  {
    code: "M01-INTERCOM", name: "Intercomunicador de Alta Voz", group: 9, sub: "902", crit: "B",
    tasks: [
      ["Prueba de funcionamiento entre puente, timón y cubierta proa/popa", "7d", "2026-05-26", null, "I"],
    ],
  },
];

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
    throw new Error(
      `Buque '${VESSEL}' no existe en tenant '${SLUG}'. Crealo primero en /vessels (no lo creo automáticamente).`,
    );
  }

  let nAssets = 0;
  let nPlans = 0;
  let totalEst = 0;

  // taskCodes únicos en memoria (defensa ante colisiones por error de datos).
  const seenCodes = new Set<string>();

  for (const a of ASSETS) {
    const sfiCode = a.sub;
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
    console.log(`${DRY ? "DRY " : "✓ "}Asset ${a.code} [SFI ${a.group}/${sfiCode}] — ${a.name} (${a.tasks.length} planes)`);

    for (let i = 0; i < a.tasks.length; i++) {
      const [title, freq, last, next, typeOverride] = a.tasks[i];
      const { triggerType, frequencyHours, frequencyMonths } = parseFreq(freq);
      const taskType = typeOverride === "I" ? "INSPECTION" : typeOverride === "M" ? "MAINTENANCE" : classify(title);
      const est = estimateHours(title);
      totalEst += est;
      const taskCode = `${a.code}-${String(i + 1).padStart(2, "0")}`;
      if (seenCodes.has(taskCode)) throw new Error(`taskCode duplicado: ${taskCode}`);
      seenCodes.add(taskCode);
      const data: Record<string, unknown> = {
        title, description: a.desc ?? null,
        triggerType, frequencyHours, frequencyMonths, estimatedHours: est, taskType,
        triggerResultMode: "AUTO_WO", // "Requiere OT"
        sfiGroupNumber: a.group, sfiSubgroupCode: sfiCode,
        responsible: a.group === 9 ? "Oficial Electrónico / Jefe de Máquinas" : "Jefe de Máquinas",
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

  console.log(
    `\n${DRY ? "DRY-RUN (no se escribió nada). " : "✅ Completado. "}` +
      `${nAssets} activos · ${nPlans} planes de mantenimiento · ${totalEst}h estimadas totales.`,
  );
}

main()
  .catch((e) => {
    console.error("❌ Error:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
