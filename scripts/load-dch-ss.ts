/**
 * Carga las 64 Solicitudes de Servicio (SS) históricas de DON CHICUETO (DCH) del
 * tenant mercurio, extraídas de los PDFs REGI-LOG-01.3 (Resumen-SS-DCH-2026.md).
 *
 * Cada SS = WorkOrder standalone (maintenancePlanId = null), creada como CLOSED con
 * el ciclo completo: Solicita (Jefe de Máquinas) → Aprueba (Ronald Silva) →
 * Autoriza (Jorge Bael) → Avance (progress note) → Cierre con resultado.
 *
 * Mapeo de campos del form SS de Mercurio → modelo WorkOrder:
 *   - Fecha                     → openDate (= startDate = dueDate = completedDate)
 *   - Departamento              → department = MAQUINAS
 *   - Equipo o sistema afectado → assetId (mejor match contra los 61 assets de DCH)
 *   - Descripción del servicio  → title (TAREA) + description
 *   - Detalle de las causas     → riskAnalysisResult  (así lo renderiza el template SS)
 *   - Responsable               → assignedToUserId = "Jefe de Maquinas" (texto libre)
 *
 * Campos generados: priority/criticality/riskLevel (según criticidad del asset),
 * acceptanceCriteria + loto (según tipo), consequenceCategory (por fila), avance, cierre.
 *
 * Idempotente: borra y reinserta las SS-DCH-26-0002..0065 (NO toca SS-DCH-26-0001).
 *
 * Uso (en el VPS):
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/load-dch-ss.ts     # previsualiza
 *   npx tsx scripts/load-dch-ss.ts           # ejecuta
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const VESSEL = "DCH";
const TENANT_SLUG = "mercurio";

const SOLICITA = "Jefe de Maquinas";        // Dionicio Coronel (form: ESTE DOCUMENTO FUE GENERADO POR)
const APRUEBA = "Ronald Silva";
const AUTORIZA = "Jorge Bael";
const EJECUTOR = "Personal de Máquinas - DCH";

type Tipo = "CORRECTIVE" | "INSPECTION" | "PREVENTIVE";
type Cons = "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL";
type Res = "SATISFACTORY" | "WITH_DEFICIENCIES";

interface Row {
  n: number;          // número de SS del Excel (1..64)
  date: string;       // YYYY-MM-DD
  asset: string;      // assetCode mapeado
  servicio: string;   // Descripción del servicio
  causas: string;     // Detalle de las causas
  tipo: Tipo;
  cons: Cons;
  res?: Res;          // default SATISFACTORY
  hrs?: number;       // horas estimadas/reales (default por tipo)
}

const ROWS: Row[] = [
  { n: 1,  date: "2025-01-13", asset: "DCH-MA-ER",     servicio: "Verificación funcionamiento de bomba de agua", causas: "Exceso de temperatura de agua", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 2,  date: "2025-01-13", asset: "DCH-HID-GOB",   servicio: "Sub Acua", causas: "Inspección de Rutina", tipo: "INSPECTION", cons: "OPERATIONAL" },
  { n: 3,  date: "2025-01-27", asset: "DCH-HID-GOB",   servicio: "Sub Acua", causas: "Inspección de Rutina", tipo: "INSPECTION", cons: "OPERATIONAL" },
  { n: 4,  date: "2025-01-27", asset: "DCH-MA-ER",     servicio: "Verificación funcionamiento", causas: "Tienden a levantar temperatura de agua en servicio.", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 5,  date: "2025-01-27", asset: "DCH-TEP",       servicio: "Verificación trasformadores de iluminación y testeo o cambio de llave TM.", causas: "Por falla estando en servicio.", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 6,  date: "2025-01-27", asset: "DCH-6-ED-001",  servicio: "Aislación de la sala", causas: "Por alta temperatura y afecta a los componentes eléctricos.", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 7,  date: "2025-01-27", asset: "DCH-EB-ACH-SENT", servicio: "Retiro y limpieza de sentinas", causas: "Cantidad 5000 lts.", tipo: "CORRECTIVE", cons: "ENVIRONMENTAL" },
  { n: 8,  date: "2026-02-03", asset: "DCH-MP-BR",     servicio: "Confección de Arresta llama del escape", causas: "Material averiado", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 9,  date: "2026-02-16", asset: "DCH-TEP",       servicio: "Medición de aislación de Transformador 380 V a 220 V N°1 y N°2", causas: "Fallas", tipo: "INSPECTION", cons: "OPERATIONAL" },
  { n: 10, date: "2026-02-16", asset: "DCH-TEP",       servicio: "Cambio de conductor eléctrico de Transformador 380 V a 220 V N°2", causas: "Conductores y terminales sobrecalentados", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 11, date: "2026-02-16", asset: "DCH-MALACATE",  servicio: "Recorrido al Motor Eléctrico del malacate (Pescante de Botes ER)", causas: "Fallas", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 12, date: "2026-02-16", asset: "DCH-TEP",       servicio: "Reapriete de Bornes de llave TM M/G N°1 Br", causas: "Terminales Sobrecalentados", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 13, date: "2026-02-18", asset: "DCH-VENT",      servicio: "Recorrido al Motor Eléctrico del Extractor Sala Maquinas Br", causas: "Fallas", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 14, date: "2026-02-18", asset: "DCH-6-ED-001",  servicio: "Recorrido y Mantenimiento de Lavarropas SAMSUNG", causas: "Fallas", tipo: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 15, date: "2026-02-18", asset: "DCH-CR-ER",     servicio: "Inspección de Palier y Rodamientos", causas: "Por excesivo juegos axiales y radiales", tipo: "INSPECTION", cons: "OPERATIONAL", res: "WITH_DEFICIENCIES" },
  { n: 16, date: "2026-02-18", asset: "DCH-6-ED-001",  servicio: "Instalación de Repetidor de temperaturas y presión de AC en Sala de Control (M/G BR y ER)", causas: "Por seguridad", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 17, date: "2026-02-18", asset: "DCH-HID-GOB",   servicio: "Inspección Subacua del Sistema de Propulsión y Gobierno", causas: "Inspección de Rutina", tipo: "INSPECTION", cons: "OPERATIONAL" },
  { n: 18, date: "2026-02-26", asset: "DCH-COCINA",    servicio: "Verificación de fuga a masa en Tablero de cocina", causas: "Conductores deteriorados", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 19, date: "2026-02-26", asset: "DCH-MP-ER",     servicio: "Verificación de módulo controlador (Tablero MMPP ER)", causas: "Fallas de aceleración", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 20, date: "2026-02-26", asset: "DCH-INTERCOM",  servicio: "Verificación de Equipo Intercomunicador de 24 V", causas: "Fallas", tipo: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 21, date: "2026-02-26", asset: "DCH-EB-REF1",   servicio: "Recorrido al sello mecánico de Bomba de Refrigeración M/G", causas: "Perdida de agua", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 22, date: "2026-03-12", asset: "DCH-MA-ER",     servicio: "Cambio de manguera de agua y abrazadera (M/G ER)", causas: "Por alta temperatura.", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 23, date: "2026-03-12", asset: "DCH-BAT-EGA",   servicio: "Provisión e instalación de Luces de Emergencias", causas: "Remplazo de equipos", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 24, date: "2026-03-12", asset: "DCH-DET-HUMO",  servicio: "Provisión e instalación de Pulsadores de incendio", causas: "Remplazo de acrílicos de disparo de alarma LCI", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 25, date: "2026-03-16", asset: "DCH-1-CC-001",  servicio: "Provisión y montaje de ventanas en sala de maquinas", causas: "Para ventilación en la sala de maquinas", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 26, date: "2026-03-16", asset: "DCH-MP-ER",     servicio: "Desacoplamiento de manchón de línea de eje del Motor Principal Estribor", causas: "Prueba de motor desacoplado", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 27, date: "2026-03-16", asset: "DCH-MP-ER",     servicio: "Cambio de juntas y culatas (Motor Principal Estribor)", causas: "Remplazo de 3 juntas y 3 culatas por pérdida de agua", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 28, date: "2026-03-16", asset: "DCH-CORTES",    servicio: "Cambio de válvula antirretorno del corte de combustibles neumático", causas: "Cambio de válvula", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 29, date: "2026-03-16", asset: "DCH-7-SD-001",  servicio: "Montaje de seguro de volante de freno del Molinete de Popa", causas: "Seguro defectuoso", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 30, date: "2026-03-16", asset: "DCH-EB-INC-P",  servicio: "Montaje de juntas en Bridas Internacional de Bandas", causas: "Falta de juntas", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 31, date: "2026-03-16", asset: "DCH-EB-INC-P",  servicio: "Provisión y montaje de bridas internacionales", causas: "Remplazo de Brida", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 32, date: "2026-03-16", asset: "DCH-CORTES",    servicio: "Montaje de arresta llamas en venteo de tanque de lastre", causas: "Cambio de arresta llamas", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 33, date: "2026-03-16", asset: "DCH-EB-REF1",   servicio: "Provisión y montaje de Bomba de Refrigeración M/G", causas: "Cambio de Bomba por fallas", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 34, date: "2026-03-16", asset: "DCH-TEP",       servicio: "Provisión de materiales para Transformador 380 a 220 V Babor N°1", causas: "Sobrecalentamiento de conductores", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 35, date: "2026-03-18", asset: "DCH-TEP",       servicio: "Cambio de borneras y conductores de Transformador 380 a 220 V Babor N°1", causas: "Sobrecalentamiento de conductores", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 36, date: "2026-03-18", asset: "DCH-MP-ER",     servicio: "Verificación de sensor de nivel de agua de tanque de compenso (Motor Principal Er)", causas: "Fallas", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 37, date: "2026-03-27", asset: "DCH-HID-GOB",   servicio: "Inspección subacua del Sistema de Propulsión y Gobierno", causas: "Inspección de rutina", tipo: "INSPECTION", cons: "OPERATIONAL" },
  { n: 38, date: "2026-03-27", asset: "DCH-MP-BR",     servicio: "Verificación de bomba pre lubricadora de turbo (Motor Principal Br)", causas: "Perdida de aceite", tipo: "CORRECTIVE", cons: "ENVIRONMENTAL" },
  { n: 39, date: "2026-03-27", asset: "DCH-HID-GOB",   servicio: "Instalación de luz piloto en sala de control y cambio de contactores (Central Hidráulica)", causas: "Fallas de contactores", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 40, date: "2026-04-13", asset: "DCH-EJE-ER",    servicio: "Fabricación y montaje de Pala de Avance y Hélice ER", causas: "Avería", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 41, date: "2026-04-13", asset: "DCH-EJE-ER",    servicio: "Balanceo: reparación de Hélice Er y control de pasos de Hélice Br", causas: "Averiado.", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 42, date: "2026-04-15", asset: "DCH-COCINA",    servicio: "Mantenimiento en general de Visicooler Sector Comedor", causas: "No mantiene la temperatura adecuado", tipo: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 43, date: "2026-04-18", asset: "DCH-ALT-BR",    servicio: "Inspección o cambio del alternador (Motor Generador Br)", causas: "No mantiene la carga", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 44, date: "2026-04-20", asset: "DCH-6-ED-001",  servicio: "Montaje de sensor Murphy con cañerías (Motor Propulsor Br y Er)", causas: "Por fallas", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 45, date: "2026-04-20", asset: "DCH-EB-INC-P",  servicio: "Provisión y cambio de válvulas mariposa de 4 pulgada (Cañón LCI)", causas: "Por perdida de agua", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 46, date: "2026-04-20", asset: "DCH-MA-ER",     servicio: "Realizar Overhaul del Motor Generador Estribor", causas: "Por cumplimiento de horas según el plan de Mantenimientos", tipo: "PREVENTIVE", cons: "OPERATIONAL", hrs: 48 },
  { n: 47, date: "2026-04-28", asset: "DCH-HID-GOB",   servicio: "Instalación de pulsador de parada con luz piloto (Bomba Hidráulica)", causas: "Para mejor funcionamiento (correctivo)", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 48, date: "2026-04-28", asset: "DCH-HID-GOB",   servicio: "Provisión y reemplazo de contactores (Central Hidráulica)", causas: "Material Averiado", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 49, date: "2026-04-26", asset: "DCH-6-ED-001",  servicio: "Medición de vibración torsional (Motores, Cajas Reductoras y líneas de ejes)", causas: "Inspección de rutina", tipo: "INSPECTION", cons: "OPERATIONAL" },
  { n: 50, date: "2026-05-19", asset: "DCH-EJE-BR",    servicio: "Cambio o reparación de bombas sumergibles de línea de eje babor", causas: "Falla de funcionamiento", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 51, date: "2026-05-19", asset: "DCH-EB-AP1",    servicio: "Cambio o reparación de equipos presurizadores hidróforo de agua", causas: "Falla de funcionamiento", tipo: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 52, date: "2026-05-19", asset: "DCH-6-ED-001",  servicio: "Inspección de rutina de Motores Principales", causas: "Control Preventivo", tipo: "INSPECTION", cons: "OPERATIONAL" },
  { n: 53, date: "2026-05-20", asset: "DCH-HID-GOB",   servicio: "Sub Acua", causas: "Inspección de Rutina", tipo: "INSPECTION", cons: "OPERATIONAL" },
  { n: 54, date: "2026-05-20", asset: "DCH-COMP-PITO", servicio: "Provisión de compresor nuevo de aire, corneta de aire y confección de cañerías para corneta (Bocina de Aire)", causas: "Por falla de funcionamiento", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 55, date: "2026-06-12", asset: "DCH-6-ED-001",  servicio: "Recorrido al equipo Lavarropas Whirlpool", causas: "Por falla de funcionamiento", tipo: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 56, date: "2026-06-12", asset: "DCH-DET-HUMO",  servicio: "Recorrido al equipo de Alarma de LCI", causas: "Por falla de Detectores de humo/calor", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 57, date: "2026-06-12", asset: "DCH-6-ED-001",  servicio: "Fabricación de plataformas para Equipos de Lavandería", causas: "Desnivel en el área de lavarropas y secarropas.", tipo: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 58, date: "2026-06-12", asset: "DCH-SEWAGE",    servicio: "Cambio de tramo de cañería de Bomba de Sanidad", causas: "Cañería oxidada con pérdidas.", tipo: "CORRECTIVE", cons: "ENVIRONMENTAL" },
  { n: 59, date: "2026-06-12", asset: "DCH-BAT-EGA",   servicio: "Reemplazo de tira LED por equipos de Luces de Emergencias 24 V", causas: "Tiras LED con fallas.", tipo: "CORRECTIVE", cons: "SAFETY" },
  { n: 60, date: "2026-06-12", asset: "DCH-SEWAGE",    servicio: "Cambio de una válvula media vuelta (Baño Marineros)", causas: "Perdidas", tipo: "CORRECTIVE", cons: "ENVIRONMENTAL" },
  { n: 61, date: "2026-06-16", asset: "DCH-MOTOR-LANCHA", servicio: "Recorrido al Motor Fuera de Borda (Lancha de Trabajo N°1)", causas: "Fallas", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 62, date: "2026-06-16", asset: "DCH-6-ED-001",  servicio: "Reparación o cambio de Monitor del Sistema de Seguridad (Sala de Control)", causas: "Fallas", tipo: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 63, date: "2026-06-16", asset: "DCH-MALACATE",  servicio: "Cambio de Malacate Pescante Br", causas: "Dificultad para arriar lancha", tipo: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 64, date: "2026-06-20", asset: "DCH-HID-GOB",   servicio: "Sub Acua", causas: "Inspección de Rutina", tipo: "INSPECTION", cons: "OPERATIONAL" },
];

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const pad4 = (n: number) => String(n).padStart(4, "0");

const riskFromCrit = (c: string) => (c === "A" ? "HIGH" : c === "C" ? "LOW" : "MEDIUM");
const prioFromCrit = (c: string) => (c === "A" ? "HIGH" : c === "C" ? "LOW" : "MEDIUM");

function acceptance(tipo: Tipo): string {
  if (tipo === "INSPECTION")
    return "Inspección completada; estado del equipo documentado; hallazgos registrados y elevados según corresponda. Equipo apto para servicio o con recomendaciones asentadas.";
  if (tipo === "PREVENTIVE")
    return "Mantenimiento ejecutado según el plan; equipo operativo, sin fugas ni alarmas y con parámetros (presión/temperatura) dentro de rango nominal.";
  return "Falla corregida; equipo operativo sin fugas, ruidos ni alarmas; parámetros (presión/temperatura/aislación) dentro de rango nominal tras la intervención.";
}
const LOTO =
  "Bloqueo y etiquetado (LOTO) de las fuentes de energía del equipo (eléctrica / neumática / hidráulica). Verificación de energía cero y purga de presión antes de intervenir. Señalización del área de trabajo.";

function consRationale(cons: Cons): string {
  switch (cons) {
    case "SAFETY": return "La omisión compromete la seguridad de personas o la respuesta ante emergencia (incendio / protección).";
    case "ENVIRONMENTAL": return "La omisión puede derivar en derrame o contaminación (combustible / aceite / aguas).";
    case "OPERATIONAL": return "La omisión afecta la disponibilidad operativa del remolcador (propulsión / gobierno / servicios).";
    case "NON_OPERATIONAL": return "Impacto acotado al costo de reparación, sin afectar operación, seguridad ni ambiente.";
  }
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} no encontrado`);
  const tenantId = tenant.id;

  // Mapa assetCode → { id, criticality }
  const assets = await prisma.asset.findMany({
    where: { tenantId, vesselCode: VESSEL, deletedAt: null },
    select: { id: true, assetCode: true, criticality: true },
  });
  const assetMap = new Map<string, { id: string; criticality: string }>(
    assets.map((a: any) => [a.assetCode, { id: a.id, criticality: a.criticality }]),
  );

  // Validar que todos los assetCode mapeados existen
  const missing = ROWS.filter(r => !assetMap.has(r.asset)).map(r => `SS-${r.n} → ${r.asset}`);
  if (missing.length) throw new Error(`Asset codes inexistentes:\n${missing.join("\n")}`);

  // createdByUserId: reutilizar el de la SS existente de DCH (usuario real válido)
  const ref = await prisma.workOrder.findFirst({
    where: { tenantId, vesselCode: VESSEL },
    select: { createdByUserId: true },
    orderBy: { createdAt: "asc" },
  });
  const userId = ref?.createdByUserId;
  if (!userId) throw new Error("No se pudo resolver createdByUserId (no hay WO previa en DCH).");

  const codes = ROWS.map(r => `SS-${VESSEL}-26-${pad4(r.n + 1)}`); // 0002..0065 (0001 ya existe)

  console.log(`\n===== CARGA SS DCH (${DRY ? "DRY-RUN" : "LIVE"}) =====`);
  console.log(`Tenant: ${TENANT_SLUG} (${tenantId})  Buque: ${VESSEL}`);
  console.log(`SS a cargar: ${ROWS.length}  Códigos: ${codes[0]} … ${codes[codes.length - 1]}`);
  console.log(`createdByUserId: ${userId}`);

  // Idempotencia: borrar SS previas con estos códigos (y sus notas). NO toca 0001.
  const existing = await prisma.workOrder.findMany({
    where: { tenantId, vesselCode: VESSEL, workOrderCode: { in: codes } },
    select: { id: true, workOrderCode: true },
  });
  if (existing.length) {
    console.log(`Idempotencia: ${existing.length} SS previas con esos códigos serán borradas y reinsertadas.`);
    if (!DRY) {
      const ids = existing.map((e: any) => e.id);
      await prisma.workOrderProgressNote.deleteMany({ where: { workOrderId: { in: ids } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: ids } } });
    }
  }

  if (DRY) {
    console.log(`\n-- Muestra (primeras 6) --`);
    for (const r of ROWS.slice(0, 6)) {
      const a = assetMap.get(r.asset)!;
      console.log(`  SS-${VESSEL}-26-${pad4(r.n + 1)} [${r.date}] ${r.asset} (crit ${a.criticality}) ${r.tipo}/${r.cons} → "${r.servicio.slice(0, 50)}"`);
    }
    console.log(`\n(DRY-RUN: no se escribió nada. Quitá DRY=1 para ejecutar.)\n`);
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  for (const r of ROWS) {
    const a = assetMap.get(r.asset)!;
    const when = d(r.date);
    const code = `SS-${VESSEL}-26-${pad4(r.n + 1)}`;
    const res: Res = r.res ?? "SATISFACTORY";
    const hrs = r.hrs ?? (r.tipo === "INSPECTION" ? 3 : 6);
    const closeNote = res === "WITH_DEFICIENCIES"
      ? `Trabajo realizado. Se detectó: ${r.causas} — se eleva recomendación de seguimiento.`
      : `Trabajo realizado conforme a la solicitud. Equipo verificado operativo, sin novedades pendientes.`;
    const avance = `Se ejecutó el servicio solicitado: ${r.servicio} Causa atendida: ${r.causas} Trabajo finalizado y equipo probado en funcionamiento.`;

    await prisma.workOrder.create({
      data: {
        tenantId,
        vesselCode: VESSEL,
        assetId: a.id,
        maintenancePlanId: null,
        workOrderCode: code,
        type: r.tipo,
        status: "CLOSED",
        priority: prioFromCrit(a.criticality),
        criticality: a.criticality,
        openDate: when,
        startDate: when,
        dueDate: when,
        completedDate: when,
        title: r.servicio,
        description: r.servicio,
        assignedToUserId: SOLICITA,
        estimatedHours: hrs,
        actualHours: hrs,
        acceptanceCriteria: acceptance(r.tipo),
        loto: LOTO,
        riskLevel: riskFromCrit(a.criticality),
        riskAnalysisResult: r.causas,                 // = "Detalle de las causas" en el form SS
        consequenceCategory: r.cons,
        consequenceRationale: consRationale(r.cons),
        department: "MAQUINAS",
        location: null,
        communicationMethod: ["IMPRESO", "EMAIL"],
        distribution: [],
        // Tramitación
        aprobadoByName: APRUEBA,
        aprobadoAt: when,
        autorizadoByName: AUTORIZA,
        autorizadoAt: when,
        // Resultado / cierre
        woResult: res,
        executedByName: EJECUTOR,
        observations: closeNote,
        closeNotes: closeNote,
        // Auditoría
        createdAt: when,
        createdByUserId: userId,
        updatedByUserId: userId,
        // Nota de avance
        progressNotes: {
          create: [{
            tenantId,
            vesselCode: VESSEL,
            kind: "TEXT",
            text: avance,
            processedText: avance,
            processed: true,
            createdAt: when,
            createdByUserId: userId,
          }],
        },
      },
    });
    ok++;
    if (ok % 10 === 0 || ok === ROWS.length) console.log(`  [${ok}/${ROWS.length}] ${code} OK`);
  }

  console.log(`\n===== LISTO: ${ok} SS creadas (CLOSED) =====\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
