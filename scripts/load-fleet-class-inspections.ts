/**
 * Carga en el Plan de Mantenimiento las inspecciones de clase de toda la flota,
 * tomadas de los Survey Status / Ship Status emitidos por RINA (20/08/2026) y
 * ClassNK (20-21/08/2026) que están en MisDocs\Survey Status.
 *
 * Crea (o actualiza, si ya existen por título) cinco ítems por buque sobre el
 * activo de casco:
 *
 *   1. Inspeccion de RENOVACION de Clase      (Hull/Mach. Renewal · Special Survey)
 *   2. Inspeccion PERIODICA de Clase          (Hull Ordinary · Annual Survey)
 *   3. Inspeccion INTERMEDIA de Clase         (Hull Intermediate · Intermediate Survey)
 *   4. Inspeccion en SECO de Clase            (Bottom Dry Condition · Docking Survey)
 *   5. Inspeccion del EJE PORTAHELICE         (Tailshaft · Prop. Shaft Svy) — sólo remolcadores
 *
 * El plan existente se busca por título NORMALIZADO (sin acentos ni mayúsculas)
 * contra el título canónico y sus alias, para no duplicar lo que ya está cargado:
 * producción tenía la renovación como "Inspeccion de RENOVACION de Clase" y, en
 * MGT 02, como "DIQUE SECO: Inspección de clase - Renovación de clase RINA.".
 *
 * ── De dónde sale cada fecha ────────────────────────────────────────────────
 * La fuente es el SHIP STATUS, no el certificado de clase: el Ship Status informa
 * la fecha de cada INSPECCIÓN, mientras que el certificado sólo trae su fecha de
 * emisión, que no es lo mismo (en el DCH difieren en cuatro meses).
 *
 *  lastExecutionDate = la columna "LAST DATE" del Ship Status. Si el Ship Status
 *      no la registra, queda vacía (no se inventa).
 *  nextDueDate = la columna "DUE DATE". Si no hay, el cierre de la ventana
 *      ("RANGE DATES"). Si tampoco hay, se PROYECTA sobre el ciclo de clase
 *      siguiente, que arranca en la fecha de vencimiento de la renovación:
 *      periódica = inicio de ciclo + 24m, intermedia = inicio de ciclo + 48m.
 *      Esa regla se verificó contra los buques que sí traen el dato (MGT01 y
 *      MGT17 renovaron en 2026 y el certificado da exactamente esas fechas).
 *      Los ítems proyectados quedan marcados en la descripción.
 *  frequencyMonths = del ESQUEMA de clase del buque, no de la resta entre la
 *      última y el vencimiento: esas dos fechas suelen caer en ciclos distintos
 *      y la resta daría un número falso. El ciclo lo dice el propio certificado
 *      ("Class period"): 6 años los remolcadores, 8 años las barcazas.
 *          renovación = ciclo · seco = ciclo · intermedia = ciclo/2 · periódica = ciclo/4
 *          eje portahélice = de la resta última→vence del propio ítem (ciclo propio)
 *
 * ── Decisiones ──────────────────────────────────────────────────────────────
 *  · Proveedor: RINA PY para los buques clasificados por RINA, ClassNK para
 *    LATERE y MGT 10 a 15. Si el proveedor ClassNK no existe, se crea.
 *  · La ventana de ejecución se carga MANUAL con anticipación propia de cada
 *    trabajo (180 días los que exigen dique, 90 la intermedia, 60 la periódica).
 *    Con windowMode AUTO el plan avisaría recién 30 días antes, inútil para un
 *    trabajo de clase.
 *  · Los planes que YA existen se actualizan por título, no se duplican. Se
 *    respeta windowMode/windowLeadDays de los que ya estaban configurados.
 *  · En un plan que ya existe, los textos (descripción, criterios de aceptación,
 *    LOTO, análisis de riesgo, RCM) y los proveedores sólo se COMPLETAN si están
 *    vacíos: nunca se pisa lo cargado a mano. DCH-0-003, por ejemplo, conserva
 *    sus textos y su segundo proveedor (SENAT, medición de espesores).
 *  · La "Inspección Periódica de Clase" no figura en el Ship Status de los cuatro
 *    remolcadores ni de las barcazas de ClassNK. El plan se crea igual, con
 *    frecuencia anual y sin fechas, hasta que la clase informe las suyas.
 *  · El activo de casco se renombra a "Casco, Cubierta y Espacios" si todavía
 *    tiene el nombre viejo (misma unificación que load-fleet-structural-integrity-plan.ts).
 *  · Buque sin activo de casco → se omite entero y se reporta.
 *
 * Idempotente. DRY=1 previsualiza sin escribir.
 *
 * Uso:
 *   DRY=1 npx tsx scripts/load-fleet-class-inspections.ts
 *   npx tsx scripts/load-fleet-class-inspections.ts
 *   SOLO=DCH,LTE npx tsx scripts/load-fleet-class-inspections.ts   # subconjunto
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const DRY = process.env.DRY === "1";
const SOLO = (process.env.SOLO ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

/**
 * La fuente de verdad es el SHIP STATUS, no el certificado de clase. Cuando el
 * plan ya tenía otra fecha cargada (típicamente la de emisión del certificado)
 * se reemplaza por la de la inspección que informa el Ship Status, y el cambio
 * se lista al final de la corrida.
 */
const CONSERVAR_FECHAS = process.env.CONSERVAR_FECHAS === "1";

// Los proveedores se buscan por NOMBRE, no por código: el correlativo difiere
// entre bases (RINA PY es PRV-0003 en local y PRV-0017 en producción).
const RINA_MATCH = "RINA";
const NK_MATCH = "ClassNK";
const NK_NAME = "ClassNK - Nippon Kaiji Kyokai";
const RESPONSIBLE = "Superintendente";
const SFI_GROUP = 0;

/** Normaliza un título para comparar: sin acentos, sin mayúsculas, sin espacios de más. */
function norm(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "").trim();
}

/**
 * Nombre unificado del equipo de casco en toda la flota (misma decisión que
 * scripts/load-fleet-structural-integrity-plan.ts). Si el activo del buque
 * todavía tiene el nombre viejo, se renombra.
 */
const ASSET_NAME = "Casco, Cubierta y Espacios";

type ItemKey = "renovacion" | "periodica" | "intermedia" | "seco" | "eje";

interface DatasetItem {
  freq: number;
  last?: string | null;
  due?: string | null;
  win?: string | null;
  from_window?: boolean;
  projected?: boolean;
  last_note?: string;
  n?: number;
  detalle?: { eje: string; last: string | null; due: string | null }[];
}
interface DatasetVessel {
  code: string;
  name: string;
  soc: "RINA" | "ClassNK";
  ciclo: number;
  tipo: "REMOLCADOR" | "BARCAZA";
  items: Record<ItemKey, DatasetItem | null>;
}

// ─── Textos técnicos por tipo de inspección ──────────────────────────────────

const HERRAMIENTAS_CASCO = [
  "",
  "HERRAMIENTAS E INSTRUMENTOS NECESARIOS:",
  "* Medidor de espesores por ultrasonido calibrado, con certificado de calibración vigente.",
  "* Galgas de soldadura y de perfiles de corrosión.",
  "* Lámpara estanca de alta intensidad (tipo LED ATEX) y espejo de inspección telescópico.",
  "* Detector multigas de cuatro sensores para el ingreso a espacios cerrados.",
  "* Cinta métrica, calibre y plomada para verificación de deformaciones.",
].join("\n");

const PPE_GENERAL = [
  "",
  "EQUIPOS DE PROTECCIÓN PERSONAL:",
  "- Casco de seguridad con barbijo y calzado de seguridad antideslizante con puntera de acero.",
  "- Arnés de seguridad con línea de vida para todo trabajo en altura o sobre pozo.",
  "- Lámpara frontal ATEX y detector personal de gases.",
  "- Chaleco salvavidas cuando se trabaje en el perímetro exterior o sobre el agua.",
].join("\n");

const ITEMS: Record<ItemKey, {
  title: string;
  /** Otros títulos con los que el mismo plan puede estar cargado (comparados normalizados). */
  alias: string[];
  fuente: { RINA: string; ClassNK: string };
  estimatedHours: number;
  leadDays: number;
  riskProbability: string;
  riskConsequence: string;
  riskLevel: string;
  consequenceCategory: string;
  consequenceRationale: string;
  descripcion: string;
  acceptanceCriteria: string;
  loto: string;
  riskAnalysisResult: string;
}> = {
  renovacion: {
    title: "Inspeccion de RENOVACION de Clase",
    alias: [
      "Inspeccion de Renovacion de Clase",
      // MGT 02 lo tenía cargado con este nombre; es el mismo trabajo.
      "DIQUE SECO: Inspección de clase - Renovación de clase RINA.",
    ],
    fuente: { RINA: "Hull Renewal + Mach. Renewal", ClassNK: "Special Survey" },
    estimatedHours: 40,
    leadDays: 180,
    riskProbability: "UNLIKELY",
    riskConsequence: "MAJOR",
    riskLevel: "MEDIUM",
    consequenceCategory: "SAFETY",
    consequenceRationale:
      "Consecuencia de SEGURIDAD: la renovación de clase es la verificación completa de la integridad estructural del casco y de las máquinas. Un deterioro no detectado (pérdida de espesor, fisuras, corrosión perforante) compromete la resistencia longitudinal y la flotabilidad del buque, con riesgo directo para la tripulación. Su omisión, además, suspende la clase y deja al buque sin cobertura de seguro ni habilitación para navegar.",
    descripcion: [
      "Renovación completa de la clase: inspección general de casco, cubierta, espacios internos y máquinas, con medición de espesores.",
      "Alcance típico:",
      "1. Inspección de todos los espacios internos (coferdams, piques, tanques y bodegas).",
      "2. Medición de espesores de planchas de casco, cubierta y estructura primaria.",
      "3. Inspección del fondo en seco (o subacuática cuando la clase la admite).",
      "4. Verificación de máquinas, sistemas de gobierno, achique, incendio y equipos de seguridad.",
      "5. Prueba de estanqueidad de cierres, válvulas de fondo y tomas de mar.",
    ].join("\n"),
    acceptanceCriteria: [
      "* Espesor remanente de planchas de casco, cubierta y estructura primaria dentro de la tolerancia de la sociedad de clasificación (pérdida máxima admitida usualmente < 20% del espesor original).",
      "* Soldaduras y zonas afectadas térmicamente sin grietas, deformaciones plásticas ni corrosión galvánica activa.",
      "* Espacios internos sin corrosión perforante, refuerzos sueltos ni entrada de agua o producto.",
      "* Recubrimiento sin desprendimientos generalizados ni oxidación activa.",
      "* Válvulas de fondo, tomas de mar y cierres estancos operables y sin fugas en la prueba de estanqueidad.",
      "* Ánodos de sacrificio con desgaste inferior al 80% de su masa original; si es mayor, reemplazo obligatorio.",
      "* Toda observación de la sociedad de clasificación queda registrada como defecto en el módulo de Defectos antes de cerrar la OT.",
      "* Certificado de clase emitido y sin condiciones (Conditions of Class) pendientes.",
    ].join("\n") + HERRAMIENTAS_CASCO,
    loto: [
      "1. Colocar el buque en dique seco o asegurar el amarre firme para la inspección a flote, según el alcance acordado con la clase.",
      "2. Bloquear y etiquetar (LOTO) el interruptor principal de los motores de propulsión y el virador (turning gear) en posición OFF.",
      "3. Bloquear y etiquetar las válvulas de fondo, tomas de mar y descargas de costado en posición cerrada.",
      "4. Bloquear y etiquetar los paneles de control de los sistemas hidráulicos de gobierno y de maniobra.",
      "5. Antes de ingresar a cualquier espacio cerrado: vaciar, lavar, desgasificar y ventilar; medir atmósfera (oxígeno 20,8%, inflamables 0% LEL, tóxicos bajo límite) y repetir la medición durante la permanencia.",
      "6. Vigía permanente en la boca de entrada, comunicación continua y equipo de rescate disponible.",
      "7. Colocar avisos de \"NO OPERAR: Inspección de Clase\" en los controles del puente y de la sala de máquinas.",
      "8. Retirar bloqueos y tarjetas únicamente al finalizar, con todo el personal fuera de la zona de riesgo y el equipo libre de herramientas.",
    ].join("\n"),
    riskAnalysisResult: [
      "- Entrada a espacio confinado con atmósfera deficiente en oxígeno, inflamable o tóxica → permiso de entrada, desgasificación y medición continua de atmósfera.",
      "- Caída a distinto nivel en dique seco o dentro de tanques → arnés con línea de vida y barandillas perimetrales.",
      "- Atrapamiento por giro accidental del eje o arranque de máquinas → verificación estricta de LOTO en motor y virador.",
      "- Caída al agua o resbalones en zonas húmedas → calzado antideslizante y chaleco salvavidas cuando corresponda.",
      "- Exposición a restos de carga en tanques de barcazas tanque → lavado previo y control de gases.",
    ].join("\n") + PPE_GENERAL,
  },

  periodica: {
    title: "Inspeccion PERIODICA de Clase",
    alias: ["Inspeccion Periodica de Clase"],
    fuente: { RINA: "Hull Ordinary + Mach. Ordinary", ClassNK: "Annual Survey" },
    estimatedHours: 5,
    leadDays: 60,
    riskProbability: "UNLIKELY",
    riskConsequence: "MINOR",
    riskLevel: "MEDIUM",
    consequenceCategory: "OPERATIONAL",
    consequenceRationale:
      "Consecuencia OPERACIONAL: la inspección periódica es una verificación general del buque a flote, sin apertura de estructura. Su omisión no produce por sí sola una falla física, pero suspende la clase y con ella la habilitación para operar y la cobertura de seguro, deteniendo el buque y al convoy que integra.",
    descripcion: [
      "Inspección periódica (anual/ordinaria) de clase, a flote, sin apertura de estructura.",
      "Alcance típico:",
      "1. Verificación general del casco, cubierta y cierres estancos accesibles.",
      "2. Estado de equipos de seguridad, contra incendio y salvamento.",
      "3. Verificación de máquinas y sistemas esenciales en funcionamiento.",
      "4. Revisión de condiciones de clase abiertas y de las observaciones de la inspección anterior.",
    ].join("\n"),
    acceptanceCriteria: [
      "* Casco, cubierta y superestructura sin deformaciones, fisuras ni corrosión significativa a la vista (pitting mayor a 2 mm).",
      "* Cierres estancos, puertas y tapas de escotilla operables y con juntas en buen estado.",
      "* Válvulas de fondo y tomas de mar verificadas en apertura y cierre, rejillas libres de incrustaciones.",
      "* Equipos de seguridad, contra incendio y salvamento completos, en su lugar y dentro de fecha de vencimiento.",
      "* Máquinas y sistemas esenciales operativos, sin alarmas activas ni fugas.",
      "* Sin condiciones de clase (Conditions of Class) vencidas.",
      "* Toda observación del inspector queda registrada como defecto en el módulo de Defectos antes de cerrar la OT.",
      "",
      "HERRAMIENTAS E INSTRUMENTOS NECESARIOS:",
      "* Linterna LED estanca de alta potencia y espejo de inspección telescópico.",
      "* Galgas de espesores y calibre para verificación puntual.",
      "* Termómetro láser y multímetro para verificación de equipos en marcha.",
    ].join("\n"),
    loto: [
      "1. Coordinar con el puente y con el oficial de guardia el estado operativo de cada equipo a inspeccionar.",
      "2. Delimitar el perímetro de seguridad frente a partes móviles; no retirar guardas ni protecciones fijas si el equipo queda en marcha.",
      "3. Si la inspección exige detención: colocar candado y tarjeta en el interruptor eléctrico principal del equipo.",
      "4. Cerrar y bloquear las válvulas de suministro de fluidos (hidráulicos, neumáticos o combustible) cuando el acceso sea interno.",
      "5. Verificar ausencia de energía residual (presión y temperatura) con manómetro y termómetro antes de aproximarse.",
      "6. Confirmar que el equipo no pueda accionarse remotamente desde la consola de control.",
      "7. Al finalizar, retirar bloqueos y tarjetas, verificar el despeje del área y notificar al oficial de guardia la disponibilidad del activo.",
    ].join("\n"),
    riskAnalysisResult: [
      "- Superficies calientes y partes móviles en equipos que permanecen en marcha durante la verificación → distancia de seguridad, guantes térmicos y verificación previa con termómetro láser.",
      "- Resbalones y caídas en cubierta húmeda o en escalas de sala de máquinas → calzado antideslizante y tres puntos de apoyo.",
      "- Golpes contra estructura en espacios de acceso reducido → casco y linterna frontal.",
      "- Caída al agua durante la inspección perimetral → chaleco salvavidas y barandas verificadas.",
    ].join("\n") + PPE_GENERAL,
  },

  intermedia: {
    title: "Inspeccion INTERMEDIA de Clase",
    alias: ["Inspeccion Intermedia de Clase"],
    fuente: { RINA: "Hull Intermediate + Mach. Intermediate", ClassNK: "Intermediate Survey" },
    estimatedHours: 16,
    leadDays: 90,
    riskProbability: "UNLIKELY",
    riskConsequence: "FATALITY",
    riskLevel: "HIGH",
    consequenceCategory: "SAFETY",
    consequenceRationale:
      "Consecuencia de SEGURIDAD: la inspección intermedia abre y examina los espacios internos y mide espesores a mitad del ciclo de clase; es la única barrera entre dos renovaciones para detectar corrosión avanzada o fisuras antes de que comprometan la flotabilidad. La tarea en sí misma es una entrada a espacio confinado, la actividad de mayor letalidad a bordo.",
    descripcion: [
      "Inspección intermedia de clase, a mitad del ciclo: apertura e inspección interna de espacios y medición de espesores donde la clase lo requiera.",
      "Alcance típico:",
      "1. Apertura, ventilación e inspección de coferdams, piques y tanques.",
      "2. Medición de espesores en las zonas indicadas por la sociedad de clasificación.",
      "3. Verificación de cierres estancos, válvulas de fondo y tomas de mar.",
      "4. Inspección de máquinas y sistemas esenciales.",
    ].join("\n"),
    acceptanceCriteria: [
      "* Todos los espacios internos requeridos fueron abiertos, ventilados e inspeccionados, y el resultado quedó registrado.",
      "* Estructura sin fisuras, deformaciones, corrosión perforante ni refuerzos sueltos.",
      "* Espesor remanente de las estructuras críticas dentro del 90% del valor original según el reporte de espesores aprobado.",
      "* Recubrimiento sin desprendimientos generalizados ni oxidación activa.",
      "* Ausencia de agua o producto en espacios que deben estar secos; si hay presencia, se identifica el origen.",
      "* Cierres estancos, válvulas de fondo y tomas de mar operables y sin fugas.",
      "* Toda condición observada se registra como defecto en el módulo de Defectos antes de cerrar la OT.",
    ].join("\n") + HERRAMIENTAS_CASCO,
    loto: [
      "ENTRADA A ESPACIO CONFINADO. No ingresar sin permiso de trabajo firmado.",
      "1. Aislar y bloquear el espacio: cerrar y bloquear válvulas de carga, lastre y venteo; bloquear bombas y agitadores asociados.",
      "2. Colocar tarjeta y candado en cada punto de aislación; el ejecutante conserva la llave.",
      "3. Vaciar, lavar, desgasificar y ventilar el espacio antes del ingreso.",
      "4. Medir atmósfera antes de entrar y repetir la medición durante la permanencia: oxígeno 20,8%, gases inflamables 0% LEL, tóxicos bajo el límite.",
      "5. Vigía permanente en la boca de entrada, comunicación continua y equipo de rescate disponible.",
      "6. Bloquear y etiquetar los equipos de máquinas que deban detenerse para la inspección.",
      "7. Retirar bloqueos y tarjetas únicamente al finalizar, con el espacio cerrado y todo el personal fuera.",
    ].join("\n"),
    riskAnalysisResult: [
      "- Peligro principal: entrada a espacio confinado con atmósfera deficiente en oxígeno, inflamable o tóxica (restos de carga, oxidación del acero).",
      "- Consecuencia potencial: fatalidad del ejecutante y de quien intente el rescate.",
      "- Probabilidad: improbable mientras se cumpla el permiso de entrada, la desgasificación y la medición continua de atmósfera.",
      "- Nivel resultante: ALTO. La tarea sólo se ejecuta con permiso de trabajo, vigía y equipo de rescate en boca de entrada.",
      "- Peligros secundarios: caída de altura por escalas y pozos, resbalones por superficies húmedas, iluminación deficiente y golpes contra refuerzos estructurales.",
    ].join("\n") + PPE_GENERAL,
  },

  seco: {
    title: "Inspeccion en SECO de Clase",
    alias: ["Inspeccion en Seco de Clase", "Inspeccion en SECO de clase"],
    fuente: { RINA: "Bottom Dry Condition", ClassNK: "Docking Survey" },
    estimatedHours: 24,
    leadDays: 180,
    riskProbability: "UNLIKELY",
    riskConsequence: "FATALITY",
    riskLevel: "HIGH",
    consequenceCategory: "SAFETY",
    consequenceRationale:
      "Consecuencia de SEGURIDAD: la inspección del fondo en seco es la única oportunidad de ver la obra viva, la bocina, el timón y las tomas de mar. Un deterioro no detectado en esas zonas deriva en vía de agua, pérdida de gobierno o pérdida de flotabilidad, con riesgo directo para la tripulación y para la carga. La ejecución se hace bajo el casco en dique, con riesgo de aplastamiento si la varada cede.",
    descripcion: [
      "Inspección del fondo en seco (varada en dique o sincroelevador). La clase puede admitir inspección subacuática (UWILD) en lugar de la varada; ver observaciones del certificado.",
      "Alcance típico:",
      "1. Limpieza e inspección de la obra viva: planchas, soldaduras, cordones y zonas de mayor desgaste.",
      "2. Medición de espesores del fondo y del pantoque.",
      "3. Inspección de timones, arbotantes, bocinas, hélices y sus holguras.",
      "4. Estado de ánodos de sacrificio, tomas de mar, rejillas y válvulas de fondo.",
      "5. Pintado y recomposición del esquema de protección anticorrosiva.",
    ].join("\n"),
    acceptanceCriteria: [
      "* Obra viva sin corrosión perforante, abolladuras profundas ni fisuras en planchas ni en cordones de soldadura.",
      "* Espesor remanente del fondo y del pantoque dentro de la tolerancia de la sociedad de clasificación.",
      "* Holgura de los cojinetes de bocina dentro del límite del fabricante (típicamente 0,5 mm a 2,0 mm según diámetro).",
      "* Sello de popa sin fugas de lubricante ni trazas de emulsión agua-aceite.",
      "* Hélices sin melladuras en bordes de ataque y salida; cubo ajustado según marcas de referencia.",
      "* Timones sin juego excesivo en mechas y limeras, topes y limitadores en su lugar.",
      "* Ánodos de sacrificio con desgaste inferior al 80%; si es mayor, reemplazo obligatorio.",
      "* Tomas de mar y válvulas de fondo desarmadas, limpias, con asientos en buen estado y prueba de estanqueidad satisfactoria.",
      "* Esquema de pintura recompuesto según especificación, con espesor de película seca verificado.",
      "* Toda observación de la clase queda registrada como defecto en el módulo de Defectos antes de cerrar la OT.",
      "",
      "HERRAMIENTAS E INSTRUMENTOS NECESARIOS:",
      "* Medidor de espesores por ultrasonido calibrado y medidor de espesor de película seca.",
      "* Galgas de holguras (feeler gauges) o puente de medición para bocinas y timones.",
      "* Calibre para medición del desgaste de ánodos.",
      "* Lámpara estanca de alta intensidad e hidrolavadora para limpieza previa.",
    ].join("\n"),
    loto: [
      "1. Buque asentado sobre picaderos y calzos verificados por el astillero; plano de varada aprobado antes del descenso del agua.",
      "2. Bloquear y etiquetar (LOTO) el interruptor principal de los motores de propulsión y el virador en posición OFF antes de acercarse a hélices y timones.",
      "3. Bloquear y etiquetar los paneles hidráulicos del servomotor y del sistema de gobierno.",
      "4. Cerrar, bloquear y etiquetar todas las válvulas de fondo, tomas de mar y descargas de costado.",
      "5. Despresurizar y drenar el circuito de refrigeración de bocinas antes de abrir el sello.",
      "6. Verificar ausencia de movimiento del eje y presión nula en los circuitos hidráulicos de sellado.",
      "7. Prohibido el trabajo bajo el casco mientras se muevan picaderos, se maniobre el dique o haya izajes sobre la vertical.",
      "8. Retirar bloqueos y tarjetas sólo al finalizar, con el personal fuera de la zona y antes del llenado del dique.",
    ].join("\n"),
    riskAnalysisResult: [
      "- Peligro principal: aplastamiento por caída del buque o corrimiento de picaderos mientras hay personal trabajando bajo el casco.",
      "- Consecuencia potencial: fatalidad. Nivel resultante ALTO aun con probabilidad baja.",
      "- Control: plano de varada aprobado, picaderos y calzos verificados por el astillero y prohibición de trabajo bajo el casco durante maniobras de dique.",
      "- Caída de altura desde andamios, escalas y borde de dique → arnés con línea de vida y barandillas perimetrales.",
      "- Atrapamiento por giro accidental del eje o de la hélice → LOTO estricto en motor propulsor y virador.",
      "- Exposición a chorro de hidrolavado a alta presión y a partículas en suspensión durante el arenado → protección facial completa y respirador.",
      "- Vapores de pintura y solventes en espacio semiconfinado bajo el casco → ventilación forzada y control de atmósfera.",
    ].join("\n") + PPE_GENERAL,
  },

  eje: {
    title: "Inspeccion del EJE PORTAHELICE",
    alias: ["Inspeccion del Eje Portahelice", "Inspeccion del eje portahelice"],
    fuente: { RINA: "Tailshaft - Propeller shaft", ClassNK: "Prop. Shaft Svy - Ordinary Svy." },
    estimatedHours: 12,
    leadDays: 180,
    riskProbability: "UNLIKELY",
    riskConsequence: "MAJOR",
    riskLevel: "MEDIUM",
    consequenceCategory: "OPERATIONAL",
    consequenceRationale:
      "Consecuencia OPERACIONAL: la falla del eje portahélice deja al remolcador sin propulsión ni gobierno. En navegación fluvial con un convoy de barcazas tanque acoplado, la pérdida de propulsión implica pérdida de control del convoy, con derivación posible a varadura, abordaje o derrame. Secundariamente, la falla del sello de bocina es una vía de agua directa a la sala de máquinas.",
    descripcion: [
      "Inspección del eje portahélice ante la sociedad de clasificación (desmontaje de hélice, extracción o verificación del eje según el alcance que autorice la clase).",
      "Alcance típico:",
      "1. Desmontaje de la hélice y verificación del cono y la chaveta.",
      "2. Medición de holguras y desgaste (wear down) de los cojinetes de bocina.",
      "3. Ensayo no destructivo del eje en la zona del cono y del chavetero.",
      "4. Verificación y recambio de los sellos de bocina.",
      "5. Alineación y verificación del acoplamiento a la caja reductora.",
    ].join("\n"),
    acceptanceCriteria: [
      "* Holgura y desgaste (wear down) de los cojinetes de bocina dentro del límite del fabricante y de la sociedad de clasificación.",
      "* Eje sin fisuras, corrosión ni marcas en el cono, el chavetero y la zona de asiento del sello, verificado por ensayo no destructivo (partículas magnéticas o líquidos penetrantes).",
      "* Sellos de bocina nuevos o verificados, sin fugas de lubricante ni trazas de emulsión agua-aceite tras la prueba.",
      "* Hélice sin melladuras en bordes de ataque y salida; cubo ajustado según las marcas de referencia y par de apriete de tuerca según especificación.",
      "* Alineación del eje respecto de la caja reductora dentro de la tolerancia del fabricante.",
      "* Análisis del aceite de bocina sin contenido de agua ni partículas metálicas fuera de límite.",
      "* Prueba de mar o prueba de amarre satisfactoria, sin vibración ni temperatura anormal en la bocina.",
      "",
      "HERRAMIENTAS E INSTRUMENTOS NECESARIOS:",
      "* Puente de medición de wear down y galgas de holguras.",
      "* Equipo de ensayo no destructivo (partículas magnéticas o líquidos penetrantes).",
      "* Extractor hidráulico de hélice y llave dinamométrica de rango adecuado.",
      "* Comparador de cuadrante y reloj palpador para verificación de alineación.",
      "* Elementos de izaje certificados para el peso de la hélice y del eje.",
    ].join("\n"),
    loto: [
      "1. Buque en seco y asentado, con el eje sin carga y sin posibilidad de giro.",
      "2. Bloquear y etiquetar (LOTO) el interruptor principal del motor propulsor, el virador y el embrague de la caja reductora en posición OFF; el ejecutante conserva la llave.",
      "3. Inmovilizar mecánicamente el eje con freno o mordaza antes de aflojar la tuerca de la hélice.",
      "4. Cerrar, bloquear y etiquetar las válvulas de refrigeración y de lubricación de bocina; drenar y despresurizar el circuito.",
      "5. Verificar presión nula en el circuito hidráulico del sello antes de desarmarlo.",
      "6. Delimitar y señalizar la zona bajo la hélice; prohibido permanecer bajo la carga durante el izaje.",
      "7. Verificar certificación y estado de eslingas, grilletes y aparejos antes de cada izaje.",
      "8. Retirar bloqueos y tarjetas sólo al finalizar el montaje, con la zona despejada y el par de apriete verificado.",
    ].join("\n"),
    riskAnalysisResult: [
      "- Atrapamiento o amputación por giro accidental del eje al aflojar la tuerca de la hélice → LOTO en motor, virador y embrague, más inmovilización mecánica del eje.",
      "- Caída de la hélice o del eje durante el izaje (cargas de cientos de kilos) → aparejos certificados, verificación previa de eslingas y prohibición de permanecer bajo la carga.",
      "- Liberación repentina de energía al usar el extractor hidráulico → despeje de la línea de fuerza y uso de retén de seguridad.",
      "- Golpes y aplastamiento de manos en el montaje de piezas pesadas → guantes anticorte y herramientas de posicionamiento.",
      "- Trabajo bajo el casco en dique con los peligros propios de la varada → ver el análisis de la Inspección en SECO.",
    ].join("\n") + PPE_GENERAL,
  },
};

// ─── Utilidades ──────────────────────────────────────────────────────────────

const fmt = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—";

const asDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00.000Z`) : null);

function minusDays(d: Date, days: number) {
  return new Date(d.getTime() - days * 86_400_000);
}

function buildDescription(key: ItemKey, v: DatasetVessel, it: DatasetItem) {
  const def = ITEMS[key];
  const lines = [def.descripcion, ""];
  lines.push(
    `Fuente: ${v.soc === "RINA" ? "Ship Status RINA del 20/08/2026" : "NK-SHIPS Survey Status del 20-21/08/2026"}` +
    ` — "${def.fuente[v.soc]}".`,
  );
  lines.push(`Ciclo de clase del buque: ${v.ciclo / 12} años.`);
  if (it.last_note) lines.push(`La última ejecución corresponde al ${it.last_note}.`);
  if (it.win && it.due && it.win !== it.due) lines.push(`Ventana admitida por la clase hasta el ${fmt(it.win)}.`);
  if (it.from_window) {
    lines.push(`El certificado no fija fecha de vencimiento: se toma el cierre de la ventana (${fmt(it.due)}).`);
  }
  if (it.projected) {
    lines.push(
      `ATENCIÓN: el certificado todavía no fija el próximo vencimiento porque corresponde al ciclo de clase siguiente. ` +
      `La fecha cargada (${fmt(it.due)}) es una proyección sobre la renovación prevista; confirmarla con el Ship Status que emita la clase después de renovar.`,
    );
  }
  if (key === "eje" && it.detalle?.length) {
    lines.push("", "Ejes del buque según certificado:");
    for (const e of it.detalle) lines.push(`  · ${e.eje}: última ${fmt(e.last)} — vence ${fmt(e.due)}`);
    if (it.detalle.length > 1) {
      lines.push("La fecha del plan es la del eje que vence primero; el resto figura arriba.");
    }
  }
  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const dataset: DatasetVessel[] = JSON.parse(
    readFileSync(join(__dirname, "data", "class-survey-plans.json"), "utf8"),
  );

  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tid: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: tid, role: "TENANT_ADMIN" },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (!member) throw new Error(`No hay TENANT_ADMIN en '${SLUG}'.`);
  const uid: string = member.userId;

  const rina = await prisma.provider.findFirst({
    where: { tenantId: tid, deletedAt: null, name: { contains: RINA_MATCH, mode: "insensitive" } },
    select: { id: true, name: true, providerCode: true },
  });
  if (!rina) throw new Error(`No hay ningún proveedor cuyo nombre contenga "${RINA_MATCH}".`);

  let nk = await prisma.provider.findFirst({
    where: { tenantId: tid, deletedAt: null, name: { contains: NK_MATCH, mode: "insensitive" } },
    select: { id: true, name: true, providerCode: true },
  });
  if (!nk) {
    const last = await prisma.provider.findMany({
      where: { tenantId: tid, providerCode: { startsWith: "PRV-0" } },
      select: { providerCode: true },
      orderBy: { providerCode: "desc" }, take: 1,
    });
    const n = last.length ? Number(last[0].providerCode.slice(4)) + 1 : 1;
    const code = `PRV-${String(n).padStart(4, "0")}`;
    console.log(`Proveedor ClassNK no existe → se crea como ${code}.`);
    if (!DRY) {
      nk = await prisma.provider.create({
        data: {
          tenantId: tid, providerCode: code, name: NK_NAME, category: "Clasificacion",
          status: "ACTIVE", location: "Asuncion, Paraguay",
          notes: "Sociedad de clasificacion de LATERE y de las barcazas MGT 10 a MGT 15.",
          createdByUserId: uid, updatedByUserId: uid,
        },
        select: { id: true, name: true, providerCode: true },
      });
    } else {
      nk = { id: "(nuevo en la corrida real)", name: NK_NAME, providerCode: code };
    }
  }

  console.log(
    `${DRY ? "DRY-RUN · " : ""}tenant '${SLUG}' · actor ${member.user?.email ?? uid}\n` +
    `Proveedores: ${rina.providerCode} "${rina.name}" · ${nk!.providerCode} "${nk!.name}"\n` +
    `Fuente de las fechas: Ship Status. ${CONSERVAR_FECHAS ? "CONSERVAR_FECHAS=1: no reemplazan a las ya cargadas." : "Reemplazan a las ya cargadas."}\n`,
  );

  let nCreated = 0, nUpdated = 0, nSkipped = 0, nRenamed = 0;
  /** Último correlativo -0-NNN reservado por buque durante esta corrida. */
  const reserved = new Map<string, number>();
  const problems: string[] = [];
  const cambiadas: string[] = [];

  for (const v of dataset) {
    if (SOLO.length && !SOLO.includes(v.code)) continue;

    const vessel = await prisma.vessel.findFirst({
      where: { tenantId: tid, code: v.code, deletedAt: null }, select: { code: true, name: true },
    });
    if (!vessel) { problems.push(`${v.code}: el buque no existe en el tenant — se omite`); continue; }

    const candidatos = await prisma.asset.findMany({
      where: {
        tenantId: tid, vesselCode: v.code, deletedAt: null,
        OR: [{ sfiCode: "100" }, { name: { contains: "Casco", mode: "insensitive" } }],
      },
      select: { id: true, assetCode: true, name: true },
    });
    // Puede haber más de un activo con SFI 100 (en M01, "Tanque de Combustible"
    // también lo tiene): manda el que ya se llama como el equipo de casco.
    const exactos = candidatos.filter((a: any) => norm(a.name) === norm(ASSET_NAME));
    const assets = exactos.length ? exactos
      : candidatos.filter((a: any) => /casco/i.test(a.name));
    if (assets.length !== 1) {
      problems.push(`${v.code}: ${assets.length} activos de casco entre ${candidatos.length} candidatos (se esperaba 1) — se omite el buque`);
      nSkipped += 5;
      continue;
    }
    const asset = assets[0];

    const provider = v.soc === "RINA" ? rina : nk!;
    const renombrar = asset.name !== ASSET_NAME;
    console.log(
      `\n${v.code.padEnd(7)} ${v.name.padEnd(14)} [${v.tipo}] ${v.soc}  activo ${asset.assetCode} "${asset.name}"` +
      (renombrar ? `\n        ✎ se renombra el activo a "${ASSET_NAME}"` : ""),
    );
    if (renombrar) {
      nRenamed++;
      if (!DRY) {
        await prisma.asset.update({
          where: { id: asset.id }, data: { name: ASSET_NAME, updatedByUserId: uid },
        });
      }
    }

    for (const key of ["renovacion", "periodica", "intermedia", "seco", "eje"] as ItemKey[]) {
      const it = v.items[key];
      const def = ITEMS[key];

      if (!it) {
        if (key === "eje") continue; // barcazas: sin propulsión propia
        problems.push(`${v.code}/${key}: sin datos en el certificado — se omite`);
        continue;
      }
      const sinDato = key === "periodica" && !it.last && !it.due;
      if (sinDato) {
        problems.push(`${v.code}/periodica: el Ship Status no la registra — el plan se crea sin fechas`);
      }

      const titulos = new Set([def.title, ...def.alias].map(norm));
      const existing = (await prisma.maintenancePlan.findMany({
        where: { tenantId: tid, vesselCode: v.code, deletedAt: null, sfiGroupNumber: SFI_GROUP },
        select: {
          id: true, taskCode: true, lastExecutionDate: true, nextDueDate: true,
          windowMode: true, windowLeadDays: true, description: true,
          acceptanceCriteria: true, loto: true, riskAnalysisResult: true,
          riskLevel: true, riskProbability: true, riskConsequence: true,
          consequenceCategory: true, consequenceRationale: true,
          estimatedHours: true, providerRequests: true, providerId: true, title: true,
        },
      })).find((p: any) => titulos.has(norm(p.title))) ?? null;

      const due = asDate(it.due);
      const last = asDate(it.last);

      // Fechas: manda el Ship Status. Si el plan traía otra fecha, se reemplaza y
      // se reporta; una fecha que el Ship Status no informa nunca borra la que ya
      // estaba cargada.
      let lastToSet = last ?? existing?.lastExecutionDate ?? null;
      let dueToSet = due ?? existing?.nextDueDate ?? null;
      if (existing) {
        const cmp = (a: Date | null | undefined, b: string | null | undefined) =>
          a && b && a.toISOString().slice(0, 10) !== b;
        if (cmp(existing.lastExecutionDate, it.last)) {
          cambiadas.push(
            `${v.code} ${existing.taskCode} "${def.title}": última ${existing.lastExecutionDate!.toISOString().slice(0, 10)} → ${it.last} (Ship Status)`,
          );
          if (CONSERVAR_FECHAS) lastToSet = existing.lastExecutionDate;
        }
        if (cmp(existing.nextDueDate, it.due)) {
          cambiadas.push(
            `${v.code} ${existing.taskCode} "${def.title}": vence ${existing.nextDueDate!.toISOString().slice(0, 10)} → ${it.due} (Ship Status)`,
          );
          if (CONSERVAR_FECHAS) dueToSet = existing.nextDueDate;
        }
      }

      // Ventana: se respeta la del plan existente si ya estaba configurada a mano.
      const keepWindow = existing?.windowMode === "MANUAL" && existing.windowLeadDays != null;
      const leadDays = keepWindow ? existing!.windowLeadDays! : def.leadDays;
      const windowOpenDate = dueToSet ? minusDays(dueToSet, leadDays) : null;

      // Campos que el pedido fija de manera explícita: se escriben siempre.
      const data: Record<string, unknown> = {
        title: def.title,
        assetId: asset.id,
        taskType: "INSPECTION",
        triggerType: "MONTHS",
        frequencyMonths: it.freq,
        frequencyHours: null,
        responsible: RESPONSIBLE,
        department: "PROVEEDOR",
        sfiGroupNumber: SFI_GROUP,
        triggerResultMode: "AUTO_WO",
        status: "ACTIVE",
        lastExecutionDate: lastToSet,
        nextDueDate: dueToSet,
        windowMode: "MANUAL",
        windowLeadDays: leadDays,
        windowOpenDate,
        updatedByUserId: uid,
      };

      // El resto COMPLETA lo que falta: si el plan ya traía un texto cargado a
      // mano no se pisa (DCH-0-003 ya tenía criterios, LOTO y análisis propios).
      const fill = (campo: string, valor: unknown) => {
        const actual = existing ? (existing as any)[campo] : null;
        if (actual === null || actual === undefined || actual === "") data[campo] = valor;
      };
      fill("description", buildDescription(key, v, it));
      fill("estimatedHours", def.estimatedHours);
      fill("acceptanceCriteria", def.acceptanceCriteria);
      fill("loto", def.loto);
      fill("riskProbability", def.riskProbability);
      fill("riskConsequence", def.riskConsequence);
      fill("riskLevel", def.riskLevel);
      fill("riskAnalysisResult", def.riskAnalysisResult);
      fill("consequenceCategory", def.consequenceCategory);
      fill("consequenceRationale", def.consequenceRationale);

      // Proveedor: si el plan ya tiene proveedores configurados no se tocan (hay
      // planes con más de uno, p. ej. RINA para la clase + SENAT para espesores).
      const yaTieneProveedor = Array.isArray(existing?.providerRequests)
        && (existing!.providerRequests as unknown[]).length > 0;
      if (!yaTieneProveedor) {
        data.providerId = provider.id;
        data.providerRequests = [{ purpose: def.title, providerId: provider.id }];
      }

      const tag = `${fmt(it.last)} → ${fmt(it.due)}${it.projected ? " (proyectado)" : ""}${it.from_window ? " (cierre de ventana)" : ""}`;

      if (existing) {
        nUpdated++;
        console.log(`   ${existing.taskCode.padEnd(13)} ✎ ${def.title.padEnd(34)} ${String(it.freq).padStart(3)}m  ${tag}`);
        if (!DRY) await prisma.maintenancePlan.update({ where: { id: existing.id }, data });
      } else {
        // Los códigos ya asignados en esta corrida se reservan en memoria: en DRY
        // no hay escritura y la consulta devolvería siempre el mismo número.
        if (!reserved.has(v.code)) {
          const used = await prisma.maintenancePlan.findMany({
            where: { tenantId: tid, vesselCode: v.code, taskCode: { startsWith: `${v.code}-${SFI_GROUP}-` } },
            select: { taskCode: true },
          });
          const nums = used
            .map((p: any) => Number(p.taskCode.split("-").pop()))
            .filter((n: number) => !Number.isNaN(n));
          reserved.set(v.code, nums.length ? Math.max(...nums) : 0);
        }
        const next = reserved.get(v.code)! + 1;
        reserved.set(v.code, next);
        const taskCode = `${v.code}-${SFI_GROUP}-${String(next).padStart(3, "0")}`;
        nCreated++;
        console.log(`   ${taskCode.padEnd(13)} + ${def.title.padEnd(34)} ${String(it.freq).padStart(3)}m  ${tag}`);
        if (!DRY) {
          await prisma.maintenancePlan.create({
            data: {
              tenantId: tid, vesselCode: v.code, taskCode, ...data,
              executionStatus: "FUTURE", createdByUserId: uid,
            },
          });
        }
      }
    }
  }

  console.log(
    `\n${DRY ? "DRY-RUN (no se escribió nada). " : "✅ Completado. "}` +
    `${nCreated} planes creados · ${nUpdated} actualizados · ${nSkipped} omitidos · ${nRenamed} activos renombrados.`,
  );
  if (cambiadas.length) {
    console.log(CONSERVAR_FECHAS
      ? `\n⚠ ${cambiadas.length} fechas del Ship Status NO aplicadas (CONSERVAR_FECHAS=1):`
      : `\nℹ ${cambiadas.length} fechas reemplazadas por las del Ship Status:`);
    for (const p of cambiadas) console.log(`  - ${p}`);
  }
  if (problems.length) {
    console.log(`\n⚠ ${problems.length} casos NO aplicados:`);
    for (const p of problems) console.log(`  - ${p}`);
  }

  // Planes del grupo SFI 0 que no son ninguno de los cinco ítems de clase: no se
  // tocan, pero conviene revisarlos por si son el mismo trabajo con otro nombre.
  const canon = new Set(Object.values(ITEMS).flatMap((d) => [d.title, ...d.alias]).map(norm));
  const otros = (await prisma.maintenancePlan.findMany({
    where: { tenantId: tid, deletedAt: null, sfiGroupNumber: SFI_GROUP },
    select: { vesselCode: true, taskCode: true, title: true },
    orderBy: [{ vesselCode: "asc" }, { taskCode: "asc" }],
  })).filter((p: any) => !canon.has(norm(p.title)));
  if (otros.length) {
    console.log(`\nℹ ${otros.length} planes del grupo SFI 0 que NO son de clase (no se tocaron):`);
    for (const p of otros) console.log(`  - ${p.vesselCode} ${p.taskCode}: ${p.title}`);
  }
}

main().catch((e) => { console.error("❌", e?.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
