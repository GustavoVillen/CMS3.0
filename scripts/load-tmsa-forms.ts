/**
 * Carga las plantillas de checklist e inspección que la revisión TMSA puede exigir.
 *
 *   pnpm exec tsx --env-file .env scripts/load-tmsa-forms.ts [--tenant=mercurio] [--force]
 *
 * Idempotente: si ya existe una plantilla con el mismo nombre (checklist) o el
 * mismo código (inspección), la saltea. Con --force la reemplaza, pero SÓLO si
 * todavía no se ejecutó ninguna vez — una plantilla con registros ejecutados no
 * se toca nunca: esos registros son la evidencia y deben conservar su contenido.
 *
 * Las plantillas se cargan SIN aprobar a propósito: hay que contrastarlas contra
 * el papel del SGS antes de aprobarlas, porque una plantilla aprobada que se
 * edita dispara un MOC.
 *
 * Qué NO se carga acá, y por qué:
 *   · Trabajo en caliente e ingreso a espacio confinado → ya son formularios
 *     controlados del módulo Permisos de Trabajo (REGI-SYE-01.4 / 01.5).
 *     Duplicarlos como checklist crea dos registros del mismo hecho.
 *   · Prueba de equipos críticos de uso no continuo → va como plantilla de
 *     INSPECCIÓN (se ejecuta contra un equipo concreto y toma lecturas).
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma: any = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any);

const TENANT = process.argv.find(a => a.startsWith("--tenant="))?.split("=")[1] ?? "mercurio";
const FORCE  = process.argv.includes("--force");

// ─── Checklists operativos ───────────────────────────────────────────────────

type Item = { text: string; category?: string; isMandatory?: boolean };
type ChecklistDef = { type: string; name: string; description: string; items: Item[] };

const M = (text: string, category?: string): Item => ({ text, category, isMandatory: true });
const O = (text: string, category?: string): Item => ({ text, category, isMandatory: false });

const CHECKLISTS: ChecklistDef[] = [
  {
    type: "PRE_DEPARTURE",
    name: "REGI-OPE-3.3 Lista de verificación previa al zarpe (Máquinas)",
    description: "TMSA 4A.2.1 — verificación de equipos críticos previa al zarpe. Se completa y firma antes de cada salida.",
    items: [
      M("Motor principal probado en avante y atrás desde puente y sala de máquinas", "Propulsión"),
      M("Telégrafo y control remoto de máquinas probados en ambos puestos", "Propulsión"),
      M("Niveles de aceite lubricante y agua de refrigeración verificados", "Propulsión"),
      M("Sistema de aire de arranque cargado a presión de trabajo", "Propulsión"),
      M("Servomotor probado banda a banda, tiempos dentro de lo normal", "Gobierno"),
      M("Gobierno de emergencia y comunicación puente-servomotor probados", "Gobierno"),
      M("Indicadores de ángulo de timón coincidentes entre puente y servomotor", "Gobierno"),
      M("Generadores en servicio y de respaldo listos para arranque", "Energía"),
      M("Arranque automático del generador de emergencia probado", "Energía"),
      O("Tablero principal sin alarmas activas ni protecciones inhibidas", "Energía"),
      M("Bombas contraincendio principal y de emergencia probadas con presión en línea", "Seguridad"),
      M("Bomba de achique operativa y alarmas de nivel de sentina probadas", "Seguridad"),
      M("Sistema de detección de incendio sin alarmas ni puntos inhibidos", "Seguridad"),
      M("Paradas de emergencia y cierres rápidos de combustible verificados", "Seguridad"),
      O("Separador de sentinas con válvula de descarga en posición y precinto íntegro", "Seguridad"),
      M("Trasiego completado, tanques de servicio a nivel para la navegación prevista", "Combustible"),
      O("Purga de agua de tanques de servicio y decantadores realizada", "Combustible"),
      M("Comunicación puente-máquinas-proa-popa probada", "Comunicaciones"),
      M("Alarma general y alarma de máquinas desatendidas probadas", "Comunicaciones"),
      M("Novedades y equipos fuera de servicio informados al Capitán antes del zarpe", "Cierre"),
    ],
  },
  {
    type: "PRE_ARRIVAL",
    name: "Lista de verificación previa al arribo",
    description: "TMSA 5 — preparación de puente y máquinas antes de la aproximación a puerto o terminal.",
    items: [
      M("Plan de aproximación revisado y aprobado por el Capitán", "Planificación"),
      M("Cartas y publicaciones náuticas actualizadas para la zona", "Planificación"),
      M("Calado, asiento y resguardo bajo la quilla verificados para el canal y el muelle", "Planificación"),
      M("Máquinas avisadas con antelación y probadas en modo maniobra", "Máquinas"),
      M("Gobierno manual acoplado y cambio de modo probado", "Puente"),
      M("Ecosonda operativa y en funcionamiento", "Puente"),
      M("Radar y AIS operativos, con datos del buque correctos", "Puente"),
      O("Compás giroscópico y magnético comparados, error anotado en el diario", "Puente"),
      M("Luces de navegación, señales acústicas y de día probadas", "Puente"),
      M("Comunicaciones VHF con práctico y control de tráfico probadas", "Comunicaciones"),
      M("Equipos de amarre y de fondeo listos, personal instruido", "Cubierta"),
      O("Documentación de arribo y declaraciones preparadas", "Documentación"),
    ],
  },
  {
    type: "PRE_CARGO_TRANSFER",
    name: "Lista de verificación previa a transferencia de carga (buque/tierra)",
    description: "TMSA 6 — verificación conjunta buque/terminal antes de iniciar carga o descarga. Base ISGOTT.",
    items: [
      M("Plan de carga o descarga acordado y firmado por ambas partes", "Planificación"),
      M("Comunicaciones buque-tierra establecidas y probadas", "Comunicaciones"),
      M("Señal e idioma de parada de emergencia acordados con la terminal", "Comunicaciones"),
      M("Mangueras o brazos conectados, en buen estado y con drenaje seguro", "Conexión"),
      M("Bridas ciegas colocadas en las conexiones no utilizadas", "Conexión"),
      M("Bandejas de contención vacías y tapones de imbornales colocados", "Contención"),
      M("Material antiderrame disponible y accesible en cubierta", "Contención"),
      M("Válvulas de tanques y líneas alineadas según el plan", "Carga"),
      M("Sistema de venteo y presión de tanques verificado", "Carga"),
      M("Detección de gases realizada, atmósfera dentro de límites", "Seguridad"),
      M("Prohibición de fumar y de trabajos en caliente comunicada a bordo", "Seguridad"),
      M("Equipo contraincendio de cubierta listo y presurizado", "Seguridad"),
      M("Amarras tensadas y bajo control, calado y asiento vigilados", "Amarre"),
      M("Vigilancia permanente en cubierta durante toda la operación", "Vigilancia"),
      M("Parada de emergencia probada antes de iniciar el trasiego", "Emergencia"),
    ],
  },
  {
    type: "PRE_BUNKERING",
    name: "Lista de verificación previa al bunkering",
    description: "TMSA 6 / 9 — control de la operación de combustible y prevención de derrames.",
    items: [
      M("Plan de bunkering acordado: cantidades, tanques, secuencia y caudal", "Planificación"),
      M("Responsable designado a bordo y en la instalación suministradora", "Planificación"),
      M("Comunicaciones y señal de parada acordadas y probadas", "Comunicaciones"),
      M("Conexión estanca, manguera y brida de seguridad verificadas", "Conexión"),
      M("Bandejas de contención y tapones de imbornales colocados", "Contención"),
      M("Material antiderrame y kit de emergencia disponible en el lugar", "Contención"),
      M("Válvulas alineadas y tanques con espacio suficiente para la carga prevista", "Operación"),
      M("Alarmas de alto nivel de tanques probadas", "Operación"),
      M("Sondas iniciales tomadas y firmadas por ambas partes", "Operación"),
      O("Muestras precintadas tomadas según MARPOL", "Operación"),
      M("Plan de emergencia por derrame (SOPEP) accesible en el lugar", "Emergencia"),
      M("Fuentes de ignición controladas y prohibición de fumar comunicada", "Seguridad"),
      M("Vigilancia permanente durante toda la operación", "Vigilancia"),
    ],
  },
  {
    type: "PILOT_BOARDING",
    name: "Lista de verificación para embarque y desembarque de práctico",
    description: "TMSA 5 — condiciones seguras para el transbordo del práctico e intercambio de información.",
    items: [
      M("Escala de práctico inspeccionada, certificada y correctamente estibada", "Equipo"),
      M("Escala instalada a la altura acordada y firmemente asegurada", "Equipo"),
      M("Iluminación del área de embarque adecuada", "Equipo"),
      M("Aro salvavidas con luz y guirnalda listos en el punto de embarque", "Seguridad"),
      M("Oficial responsable presente en el punto de embarque", "Seguridad"),
      M("Comunicación con el puente establecida", "Comunicaciones"),
      M("Buque a rumbo y velocidad acordados, con abrigo dado", "Maniobra"),
      M("Intercambio de información buque-práctico completado", "Maniobra"),
    ],
  },
  {
    type: "ANCHOR",
    name: "Lista de verificación para fondeo",
    description: "TMSA 5 — preparación y control de la maniobra de fondeo y de la guardia posterior.",
    items: [
      M("Fondeadero, profundidad y tenedero verificados en la carta", "Planificación"),
      M("Máquinas listas y probadas para la maniobra", "Máquinas"),
      M("Molinete probado, freno y estopor verificados", "Equipo"),
      M("Personal de proa instruido y con comunicación establecida", "Personal"),
      M("Luces y marcas de fondeo listas", "Señalización"),
      M("Longitud de cadena a filar definida por el Capitán", "Maniobra"),
      M("Posición de fondeo registrada y alarma de garreo activada", "Control"),
      M("Guardia de fondeo establecida con rondas y controles definidos", "Control"),
    ],
  },
  {
    type: "MOORING",
    name: "Lista de verificación de amarre y armado de convoy",
    description: "TMSA 6 — seguridad de la maniobra de amarre y del armado y desarmado del convoy de barcazas.",
    items: [
      M("Plan de amarre o de armado del convoy definido y comunicado a proa y popa", "Planificación"),
      M("Cabos, estachas y cables inspeccionados, sin desgaste ni cortes", "Equipo"),
      M("Winches probados, frenos regulados y con registro de prueba vigente", "Equipo"),
      M("Zonas de riesgo por latigazo señalizadas y despejadas", "Seguridad"),
      M("Personal con equipo de protección completo e instruido en la maniobra", "Personal"),
      M("Comunicación puente-proa-popa probada antes de iniciar", "Comunicaciones"),
      O("Remolcadores y práctico coordinados según el plan", "Coordinación"),
      M("Tensión de amarras y uniones del convoy controladas al finalizar", "Cierre"),
    ],
  },
];

// ─── Plantillas de inspección ────────────────────────────────────────────────

type InspItem = {
  description: string;
  itemType?: string;
  acceptanceCriteria?: string | null;
  unit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  evidenceRequired?: boolean;
  isOptional?: boolean;
};
type InspectionDef = {
  code: string;
  title: string;
  description: string;
  frequencyDays: number;
  windowLeadDays: number;
  items: InspItem[];
};

const chk = (description: string, acceptanceCriteria: string, extra: Partial<InspItem> = {}): InspItem =>
  ({ description, itemType: "BOOLEAN_OK_NOK", acceptanceCriteria, ...extra });
const num = (description: string, unit: string, minValue: number | null, maxValue: number | null): InspItem =>
  ({ description, itemType: "NUMERIC_READING", unit, minValue, maxValue, acceptanceCriteria: null });
const nota = (description: string): InspItem =>
  ({ description, itemType: "TECHNICAL_NOTES", acceptanceCriteria: null, isOptional: true });

const INSPECTIONS: InspectionDef[] = [
  {
    code: "REGI-OPE-19.2",
    title: "Guía para inspección de los buques",
    description: "TMSA 4.2.3 — inspección del buque por el superintendente. Mínimo dos por año y por buque. Incluye la verificación de equipos críticos exigida por TMSA 4A.1.4. El informe se distribuye a la gerencia técnica y a la gerencia general.",
    frequencyDays: 180,
    windowLeadDays: 30,
    items: [
      chk("DOCUMENTACIÓN — Certificados estatutarios y de clase vigentes a bordo", "Sin certificados vencidos ni observaciones pendientes"),
      chk("DOCUMENTACIÓN — Diario de navegación y de máquinas al día y firmados", "Asientos diarios completos y firmados"),
      chk("DOCUMENTACIÓN — Manuales y procedimientos del SGS en su última revisión", "Revisión vigente disponible a bordo"),
      chk("CASCO Y CUBIERTA — Estado general de cubierta, barandas y accesos", "Sin corrosión estructural, sin riesgos de caída", { evidenceRequired: true }),
      chk("CASCO Y CUBIERTA — Cierres estancos, tapas de escotilla y ventilaciones", "Cierran y sellan correctamente"),
      chk("CASCO Y CUBIERTA — Señalización de seguridad y de vías de escape legible", "Completa y legible"),
      chk("SALA DE MÁQUINAS — Limpieza general y ausencia de fugas de aceite o combustible", "Sin fugas activas, sentinas limpias y secas", { evidenceRequired: true }),
      chk("SALA DE MÁQUINAS — Aislaciones de superficies calientes completas", "Sin superficies calientes expuestas"),
      chk("SALA DE MÁQUINAS — Protecciones y guardas de partes móviles colocadas", "Todas colocadas y firmes"),
      chk("SALA DE MÁQUINAS — Alarmas y paradas de seguridad sin inhibiciones", "Sin puntos inhibidos ni puenteados"),
      chk("EQUIPOS CRÍTICOS — Listado de equipos críticos del buque vigente y conocido a bordo", "Listado actualizado y disponible"),
      chk("EQUIPOS CRÍTICOS — Equipos críticos de uso continuo operativos y sin defectos abiertos", "Todos operativos"),
      chk("EQUIPOS CRÍTICOS — Registros de prueba de los equipos críticos de uso no continuo al día", "Pruebas dentro de la frecuencia establecida"),
      chk("EQUIPOS CRÍTICOS — Gobierno principal y de emergencia probados durante la visita", "Prueba satisfactoria en presencia del superintendente"),
      chk("EQUIPOS CRÍTICOS — Sistemas contraincendio fijos y bombas probados durante la visita", "Prueba satisfactoria en presencia del superintendente"),
      chk("SEGURIDAD — Equipos de salvamento completos, en fecha y accesibles", "Sin elementos vencidos ni faltantes"),
      chk("SEGURIDAD — Extintores, mangueras y lanzas en su puesto y con control vigente", "Control al día, ubicación correcta"),
      chk("SEGURIDAD — Equipos de protección personal disponibles y en uso", "Disponibles, en buen estado y utilizados"),
      chk("SEGURIDAD — Simulacros realizados según el programa", "Programa cumplido sin atrasos"),
      chk("AMBIENTE — Gestión de residuos, sentinas y libros de registro correcta", "Libros al día, sin descargas irregulares"),
      chk("AMBIENTE — Material antiderrame completo y accesible", "Completo y en el lugar previsto"),
      chk("HABITABILIDAD — Alojamientos, cocina y sanitarios en condiciones de higiene", "Condiciones adecuadas", { evidenceRequired: true }),
      chk("TRIPULACIÓN — Familiarización y entrenamiento a bordo registrados", "Registros completos para toda la dotación"),
      chk("TRIPULACIÓN — Horas de descanso registradas y sin violaciones", "Sin violaciones en el período"),
      chk("MANTENIMIENTO — Plan de mantenimiento sin tareas vencidas relevantes", "Sin vencidas críticas; las demás justificadas"),
      chk("MANTENIMIENTO — Órdenes de trabajo cerradas con evidencia y horas registradas", "Cierres completos y trazables"),
      chk("MANTENIMIENTO — Defectos abiertos con plan de acción y postergaciones aprobadas", "Todos con tratamiento formal"),
      chk("MANTENIMIENTO — Repuestos críticos en stock según el mínimo definido", "Sin faltantes críticos"),
      nota("Observaciones del superintendente y acuerdos con el Capitán"),
      nota("Puntos de seguimiento para la próxima visita"),
    ],
  },
  {
    code: "INSP-EQCRIT-01",
    title: "Prueba de equipos críticos de uso no continuo",
    description: "TMSA 4A.1.4 — registro de la prueba periódica de los equipos críticos que no están en servicio continuo (generador de emergencia, bomba contraincendio de emergencia, gobierno de emergencia, compresores de reserva). Se ejecuta contra el equipo concreto.",
    frequencyDays: 90,
    windowLeadDays: 15,
    items: [
      chk("El equipo está identificado como crítico de uso no continuo en el listado vigente", "Identificado en el listado del buque"),
      chk("Condiciones de seguridad verificadas antes de la prueba", "Área despejada, bloqueos retirados, personal advertido"),
      chk("Arranque o puesta en servicio realizada sin asistencia externa", "Arranca al primer intento"),
      num("Tiempo hasta la puesta en régimen", "s", null, 60),
      num("Presión de trabajo alcanzada", "bar", null, null),
      num("Temperatura de operación", "°C", null, null),
      num("Tensión o amperaje en carga", "A", null, null),
      num("Tiempo total de funcionamiento en prueba", "min", 10, null),
      chk("Sin fugas, ruidos ni vibraciones anormales durante la prueba", "Funcionamiento normal"),
      chk("Sistemas de seguridad y paradas de emergencia del equipo probados", "Actúan correctamente"),
      chk("Equipo devuelto a condición de reserva al finalizar la prueba", "En stand-by, listo para actuar"),
      chk("Novedades registradas y defecto u orden de trabajo generada si corresponde", "Registrado en el sistema"),
      nota("Observaciones de la prueba"),
    ],
  },
  {
    code: "INSP-SALV-01",
    title: "Inspección mensual de equipos de salvamento y contraincendio",
    description: "TMSA 4 / 9 — control mensual del estado, ubicación y vencimientos de los equipos de emergencia.",
    frequencyDays: 30,
    windowLeadDays: 7,
    items: [
      chk("Chalecos salvavidas completos, en buen estado y en su ubicación", "Cantidad completa, sin roturas"),
      chk("Aros salvavidas con luz, rabiza y guirnalda en su puesto", "Completos y en su soporte"),
      chk("Balsas salvavidas con control vigente y zafa hidrostática en fecha", "Sin vencimientos"),
      chk("Extintores en su puesto, precintados y con control vigente", "Sin vencidos ni descargados"),
      chk("Mangueras, lanzas y bocas contraincendio completas y accesibles", "Completas, sin obstrucciones"),
      chk("Equipos autónomos de respiración con carga y control vigente", "Cargados y en fecha"),
      num("Presión de botellas de aire de los equipos autónomos", "bar", 200, null),
      chk("Trajes de inmersión y equipos de bombero completos", "Completos y en buen estado"),
      chk("Señalización pirotécnica dentro de fecha de vencimiento", "Sin elementos vencidos"),
      chk("Iluminación de emergencia y vías de escape libres y señalizadas", "Operativa y despejada"),
      chk("Sistema fijo de extinción sin alarmas y con precintos íntegros", "Sin novedades"),
      nota("Observaciones y elementos a reponer"),
    ],
  },
  {
    code: "INSP-MAQ-01",
    title: "Inspección mensual de sala de máquinas",
    description: "TMSA 4 — control mensual del estado de la sala de máquinas: fugas, aislaciones, sentinas y seguridad.",
    frequencyDays: 30,
    windowLeadDays: 7,
    items: [
      chk("Ausencia de fugas de combustible, aceite y agua", "Sin fugas activas", { evidenceRequired: true }),
      chk("Sentinas limpias, secas y con alarmas de nivel operativas", "Limpias y con alarma probada"),
      chk("Aislaciones de superficies calientes completas y limpias de aceite", "Sin superficies expuestas ni empapadas"),
      chk("Protecciones de partes móviles y acoples colocadas", "Todas colocadas"),
      chk("Bandejas de goteo vacías y drenajes despejados", "Vacías y limpias"),
      chk("Iluminación normal y de emergencia operativa", "Sin luminarias fuera de servicio"),
      chk("Vías de escape y accesos despejados y señalizados", "Libres de obstáculos"),
      chk("Herramientas y repuestos estibados y asegurados", "Sin elementos sueltos"),
      chk("Tablero principal y de emergencia sin alarmas ni protecciones inhibidas", "Sin inhibiciones"),
      num("Horas de funcionamiento del motor principal al momento de la inspección", "h", null, null),
      chk("Registros de horas de equipos actualizados en el sistema", "Al día"),
      nota("Observaciones de la inspección"),
    ],
  },
  {
    code: "INSP-AMARRE-01",
    title: "Inspección trimestral de equipos y elementos de amarre",
    description: "TMSA 6 — control periódico del estado de cabos, cables, winches y elementos de amarre y de armado del convoy.",
    frequencyDays: 90,
    windowLeadDays: 15,
    items: [
      chk("Cabos y estachas sin cortes, desgaste ni deformaciones", "Aptos para servicio", { evidenceRequired: true }),
      chk("Cables de acero sin hilos rotos, aplastamientos ni corrosión", "Dentro del criterio de descarte"),
      chk("Grilletes, tensores y elementos de unión en buen estado", "Sin deformación ni fisuras"),
      chk("Winches y molinetes operativos, sin pérdidas hidráulicas", "Operativos y estancos"),
      chk("Frenos de winche regulados y con registro de prueba vigente", "Prueba dentro de la frecuencia"),
      chk("Bitas, guías y roldanas sin desgaste ni bordes cortantes", "Sin desgaste que dañe el cabo"),
      chk("Zonas de riesgo por latigazo señalizadas y visibles", "Señalización completa"),
      chk("Registro de amarras con fecha de instalación y rotación al día", "Registro actualizado"),
      nota("Elementos a reemplazar y plazo propuesto"),
    ],
  },
];

// ─── Carga ───────────────────────────────────────────────────────────────────

/** Nombre anterior (sin acentos) de la primera carga, para poder reemplazarlo. */
function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT }, select: { id: true, slug: true } });
  if (!tenant) throw new Error(`Tenant "${TENANT}" no encontrado.`);
  const admin = await prisma.tenantMembership.findFirst({
    where: { tenantId: tenant.id, role: "TENANT_ADMIN" },
    select: { userId: true },
  });
  if (!admin) throw new Error(`El tenant "${TENANT}" no tiene un TENANT_ADMIN.`);

  console.log(`Tenant ${tenant.slug}${FORCE ? " (--force)" : ""}\n`);

  console.log("── Checklists ──");
  for (const def of CHECKLISTS) {
    const existing = await prisma.checklistTemplate.findFirst({
      where: { tenantId: tenant.id, name: { in: [def.name, sinAcentos(def.name)] } },
      select: { id: true, name: true },
    });
    if (existing && !FORCE) { console.log(`  = ya existe: ${existing.name}`); continue; }
    if (existing) {
      const used = await prisma.checklistExecution.count({ where: { templateId: existing.id } });
      if (used > 0) { console.log(`  ! con ${used} ejecución(es), no se toca: ${existing.name}`); continue; }
      await prisma.checklistTemplate.delete({ where: { id: existing.id } });
    }
    await prisma.checklistTemplate.create({
      data: {
        tenantId: tenant.id,
        type: def.type,
        name: def.name,
        description: def.description,
        itemsJson: def.items.map((it, i) => ({
          code: String(i + 1),
          text: it.text,
          isMandatory: it.isMandatory ?? false,
          ...(it.category ? { category: it.category } : {}),
        })),
        isActive: true,
        createdByUserId: admin.userId,
        updatedByUserId: admin.userId,
      },
    });
    console.log(`  ${existing ? "~" : "+"} ${def.name} (${def.items.length} ítems)`);
  }

  console.log("\n── Plantillas de inspección ──");
  for (const def of INSPECTIONS) {
    const existing = await prisma.inspectionTemplate.findFirst({
      where: { tenantId: tenant.id, code: def.code },
      select: { id: true },
    });
    if (existing && !FORCE) { console.log(`  = ya existe: ${def.code}`); continue; }
    if (existing) {
      const used = await prisma.inspectionExecution.count({ where: { templateId: existing.id } });
      if (used > 0) { console.log(`  ! con ${used} ejecución(es), no se toca: ${def.code}`); continue; }
      await prisma.inspectionChecklistItem.deleteMany({ where: { templateId: existing.id } });
      await prisma.inspectionTemplate.delete({ where: { id: existing.id } });
    }
    await prisma.inspectionTemplate.create({
      data: {
        tenantId: tenant.id,
        code: def.code,
        title: def.title,
        description: def.description,
        triggerType: "CALENDAR",
        triggerResultMode: "DUE_ONLY",
        frequencyDays: def.frequencyDays,
        windowMode: "AUTO",
        windowLeadDays: def.windowLeadDays,
        evidenceRequired: def.items.some(i => i.evidenceRequired),
        isGlobal: false,
        status: "ACTIVE",
        checklistItems: {
          create: def.items.map((it, i) => ({
            sortOrder: i,
            description: it.description,
            itemType: it.itemType ?? "BOOLEAN_OK_NOK",
            acceptanceCriteria: it.acceptanceCriteria ?? null,
            unit: it.unit ?? null,
            minValue: it.minValue ?? null,
            maxValue: it.maxValue ?? null,
            evidenceRequired: it.evidenceRequired ?? false,
            isOptional: it.isOptional ?? false,
            criteriaSource: "COMPANY_STANDARD",
          })),
        },
      },
    });
    console.log(`  ${existing ? "~" : "+"} ${def.code} — ${def.title} (${def.items.length} ítems, cada ${def.frequencyDays} días)`);
  }

  console.log("\nListo. Las plantillas quedan SIN aprobar: revisarlas contra el papel del SGS antes de aprobar.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
