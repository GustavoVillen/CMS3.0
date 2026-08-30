/**
 * Carga las 91 Solicitudes de Servicio (SS) históricas de MAO-01 (remolcador,
 * tenant mercurio) extraídas de los PDFs REGI-LOG-01.3 en MisDocs/MAO01/SS/.
 *
 * A diferencia de la carga histórica de DCH (scripts/load-dch-ss.ts, previa al
 * split OT/SS), acá el modelo YA separa las dos entidades: por cada PDF se crea
 * una OT (WorkOrder, correctiva standalone, maintenancePlanId null) Y una SS
 * (ServiceRequest) colgando de ella — el par completo que pide el usuario.
 *
 * Tramitación fija (pedido explícito del usuario, no se parsea firma por firma
 * del PDF): Solicita = Aprueba = Cierra → Rene Cano (Jefe de Máquinas M01).
 * Autoriza → Jorge Bael (Admin). Se aplica IGUAL en la OT y en la SS — se
 * registran todos los pasos (aprobación / autorización / cierre) de ambas.
 *
 * Mapeo de campos del papel → modelo:
 *   OT (WorkOrder):  Equipo → assetId · Descripción → title/description ·
 *                     Fecha → openDate=startDate=dueDate=completedDate ·
 *                     Departamento → department · aprobado/autorizado → Rene/Jorge
 *   SS (ServiceRequest): Descripción → title/description · Detalle de las causas
 *                     → causes · Solicitud de compras → purchaseRequestKinds ·
 *                     Taller que concurre → providerId (fuzzy match contra el
 *                     catálogo; si no existe se crea el Provider) ·
 *                     Medio de comunicación → communicationMethod ·
 *                     Entrega/Recepción → recibe Rene Cano, conforme = true.
 *
 * Código de OT: continúa la numeración real de M01 (última en VPS: OT-M01-26-0419).
 * Código de SS: preserva el número de la planilla de papel → SS-<n>-M01-2026
 *   (mismo formato que ya usa el sistema: SS-<seq>-<VESSEL>-<AÑO>, sin padding).
 *
 * Asset mapping: de los 48 assets reales de M01, ~55% calza directo con el
 * texto de "EQUIPO O SISTEMA AFECTADO"; el resto (ítems domésticos sin asset
 * propio, o que afectan ambas bandas BR/ER a la vez) cae en el bucket genérico
 * M01-6-ED-001 "Equipos de Máquinas en General" — mismo patrón que DCH.
 * REVISAR la columna `asset` de ROWS si algo no calza.
 *
 * Idempotente: borra y reinserta las OT en el rango de códigos que este script
 * genera (y sus SS), identificándolas por el rango exacto de workOrderCode.
 *
 * Uso (en el VPS):
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/load-mao01-ss.ts     # previsualiza
 *   npx tsx scripts/load-mao01-ss.ts           # ejecuta
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const VESSEL = "M01";
const TENANT_SLUG = "mercurio";
const TENANT_ID = "cmqhafl85006ysll4f0hecqcu";

const RENE_CANO_ID = "cmr2i7m2x002028l46agzt20o";   // MAINTENANCE_MANAGER, a cargo de M01 — Solicita / Aprueba / Cierra
const JORGE_BAEL_ID = "cmqp9qix900591ml4haiefuh9";  // TENANT_ADMIN — Autoriza
const RENE_CANO_NAME = "Rene Cano";
const JORGE_BAEL_NAME = "Jorge Bael";

const OT_START_SEQ = 420; // último real: OT-M01-26-0419

type Tipo = "CORRECTIVE" | "INSPECTION" | "PREVENTIVE";
type Cons = "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL";
type Dept = "MAQUINAS" | "CUBIERTA" | "BARCAZA" | "OTROS";

interface Row {
  n: number;
  date: string;          // YYYY-MM-DD
  dept: Dept;
  asset: string;         // assetCode mapeado (48 assets reales de M01)
  equipoRaw: string;     // texto literal del PDF, para trazabilidad en closeNotes
  title: string;         // DESCRIPCION DEL SERVICIO
  causas: string;        // DETALLE DE LAS CAUSAS
  purchase: string[];    // NORMAL | AFECTA SEGURIDAD | AFECTA SERVICIO
  taller: string | null; // TALLER QUE CONCURRE (texto crudo del PDF)
  comm: string[];        // IMPRESO | EMAIL | WHAPP | OTRO
  comentarios: string | null;
  type: Tipo;
  cons: Cons;
}

const ROWS: Row[] = [
  { n: 1, date: "2026-01-05", dept: "MAQUINAS", asset: "M01-MP-BR", equipoRaw: "MP BR", title: "Diagnostico por falla en sistema de combustible, desmontaje de bomba de combustible acoplada a motor principal BR, provisión de bomba original volvo, acondicionamiento de cuerpo de bomba e instalación de la misma, purgado del sistema y prueba de funcionamiento con motor de arranque", causas: "No arranca por baja presión en el sistema", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 2, date: "2026-01-05", dept: "MAQUINAS", asset: "M01-MP-BR", equipoRaw: "MP BR", title: "Cambio de ECU D-MH MP BR con reprogramación de software, revisión del sistema de propulsión de MMPP", causas: "Falla del módulo controlador ECU", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 3, date: "2026-01-13", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "MOTOR GENERADOR- BABOR Y ESTRIBOR", title: "RECORRIDO DE TURBOS", causas: "Mantenimiento correctivo de turbos de ambos motores generadores", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 4, date: "2026-01-13", dept: "MAQUINAS", asset: "M01-HID-GOB", equipoRaw: "ANGULO DE CAIDA EN TIMONERA", title: "REGULACION", causas: "MARCA MAL", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 5, date: "2026-01-14", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "MS/PS BR-ER", title: "CAMBIO DE MANGERAS DE REFRIGERACION Y COMBUSTIBLE EN GRAL.", causas: "FILTRACIONES", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 6, date: "2026-01-18", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "MS/GS BR, ER", title: "CONTROL DE AISLACION SEGÚN PLAN DE MANT., LIMPIEZA DE ESTATORES Y ROTORES, LIMPIEZA INTERIOR", causas: "INTENSA FUGA DE MASA Y SOBRE CARGA EN AMBOS GENERADORES", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 7, date: "2026-01-23", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "EMPAQUETADURA BABOR Y ESTRIBOR", title: "BUZOS - RECARGA DE EMPAQUETADURA", causas: "INGRESO DE AGUA.", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 8, date: "2026-01-24", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "INTERNET STARLINK", title: "VERIFICACION DE EQUIPO. CAMBIO O REPARACION.", causas: "NO FUNCIONA - EL EQUIPO Y MAYORMENTE SIN SEÑAL O POCA SEÑAL. LUEGO DE REINICIAR VARIAS VECES EL EQUIPO.", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 9, date: "2026-01-29", dept: "MAQUINAS", asset: "M01-VENT", equipoRaw: "VENTILADORES, EXTRACTORES SALA DE MAQ.", title: "VERIFICACION DE EQUIPO.", causas: "RECORRIDO ELECTRICO DEL EQUIPO – AL PULSAR UNO PRENDE 2.", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 10, date: "2026-01-29", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "COMANDO DE ACELERACION MS/PS TIMONERA", title: "VERIFICACION DE EQUIPO. O CAMBIO", causas: "FALLA EN ACELERACION Y SINCRONISMO RPM. ACELERANDO UNO ESTIRA AL OTRO.", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 11, date: "2026-01-29", dept: "MAQUINAS", asset: "M01-HID-GOB", equipoRaw: "SISTEMA DE GOBIERNO", title: "VERIFICACION DE EQUIPO.", causas: "SUBSANAR PERDIDA DE AC. HIDRAULICO EN TUBERIAS EN POPA.", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 12, date: "2026-01-29", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "HELADERA MARCA PATRICK", title: "VERIFICACION DE EQUIPO.", causas: "POSIBLE MOTOR COMPRESOR EN CORTO.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 13, date: "2026-01-29", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "BISICOOLER COCINA", title: "VERIFICACION DE EQUIPO.", causas: "CAMBIO DE GOMA DE PUERTA, ROTA", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 14, date: "2026-01-29", dept: "MAQUINAS", asset: "M01-MP-BR", equipoRaw: "MP BR", title: "CAMBIO DE MANGERA DE COMBUSTIBLE", causas: "MANGERA FISURADA CON PERDIDA. LLEVAR MUESTRA PARA FABRICACION.", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 15, date: "2026-02-03", dept: "MAQUINAS", asset: "M01-EB-ACH-SENT", equipoRaw: "TANQUE DE SLOP - SENTINA", title: "RETIRO DE LIQUIDOS OLEOSOS", causas: "LIQUIDOS OLEOSOS", purchase: ["NORMAL"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "ENVIRONMENTAL" },
  { n: 16, date: "2026-02-05", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "BEBEDERO DE COSINA", title: "REPARACION O CAMBIO", causas: "YA NO ENFRIA PRESENTA UN RUIDO ANORMAL AL TRABAJAR EL COMPRESOR", purchase: ["NORMAL", "AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 17, date: "2026-02-05", dept: "MAQUINAS", asset: "M01-MA-ER", equipoRaw: "MOTOR GENERADOR ESTRIBOR", title: "CALIBRACION DE SISTEMA RPM", causas: "AL PONER EN CARGA BAJA MUCHO LA FRECUENCIA", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 18, date: "2026-02-13", dept: "MAQUINAS", asset: "M01-EJE-BR", equipoRaw: "LINEA DE EJES", title: "COLOCACION DE MOTOR DE 1HP BR Y ER INDEPENDIENTE CON BOYA PARA ACHIQUE, INGRESO DE AGUA LINEA DE EJE AUTOMATICO Y CON RESPECTIVA TUBERIAS.", causas: "MUCHO INGRESO DE AGUA POR LINEA DE EJE Y LA NEUMATICA ACTUAL NO ABASTECE EL ACHIQUE Y PASA A LA SENTINA GRAL.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 19, date: "2026-02-13", dept: "MAQUINAS", asset: "M01-EJE-BR", equipoRaw: "LINEA DE EJE BR Y ER", title: "CARGA DE EMPAQUTADURA", causas: "MUCHO INGRESO DE AGUA.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 20, date: "2026-02-18", dept: "MAQUINAS", asset: "M01-ALT-BR", equipoRaw: "ALTERNADOR MOTOR PROPULSOR", title: "REPARACION MANTENIMIENTO", causas: "POCA CARGA Y FUERTE RUIDO", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 21, date: "2026-02-19", dept: "MAQUINAS", asset: "M01-CR-BR", equipoRaw: "CAJA REDUCTORA BR Y ER", title: "VERIFICACION GRAL DE CAJAS - LIMPIEZA INTERCOOLER Y CIRCUITO REFRIGERACION GRAL.", causas: "EXCESO DE TEMPERATURA.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 22, date: "2026-03-04", dept: "MAQUINAS", asset: "M01-MA-ER", equipoRaw: "M/G ER", title: "VERIFICACION Y CONTROL DE DIODOS, LIMPIEZA DE EXITATRIZ Y MEGADO DEL MISMO.", causas: "BAJA FRECUENCIA.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "ELECTRO OHM", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 23, date: "2026-03-04", dept: "MAQUINAS", asset: "M01-CR-ER", equipoRaw: "CAJA REDUCTORA ER", title: "CAMBIO DE DISCOS DE EMBRAGUE AVANCE Y RETROCESO.", causas: "FIBRA DE EMBRAGUE HIDRAULICO QUEMADA", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "TBDL", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 24, date: "2026-03-07", dept: "MAQUINAS", asset: "M01-MA-ER", equipoRaw: "MG ER", title: "ALTERNADOR 12V Y SISTEMA DE ALARMA", causas: "MANTENIMIENTO ALTERNADOR NO CARGA, Y RECORRIDO DEL SISTEMA DE ALARMA.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "TBDL", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 25, date: "2026-03-13", dept: "MAQUINAS", asset: "M01-CR-ER", equipoRaw: "CAJA REDUCTORA ER.", title: "ASISTENCIA Y VERIFICACION.", causas: "BAJA PRESION DE ACEITE. (NO ENCLOCHA)", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "TBDL", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 26, date: "2026-03-13", dept: "MAQUINAS", asset: "M01-CR-ER", equipoRaw: "CAJA REDUCTORA ER.", title: "SE SOLICITA RECTIFICACION DE MANIFOLD CAJA ER", causas: "SE SOPLA LA JUNTA, NO LEVANTA PRESION DE ACEITE.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "TBDL", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 27, date: "2026-03-13", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "PLACA INDUSTRIAL (COCINA)", title: "CAMBIO DE TOMA CORRIENTE SCHUKO MACHO Y HEMBRA", causas: "QUEMADO Y EN CORTO.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "TBDL", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 28, date: "2026-03-13", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "AIRES ACONDICIONADOS SPLIT DEL REMOLCADOR", title: "SE SOLICITA FABRICACION DE TUBERIAS DE CAÑO GALVANIZADO DE DRENAJE CONDUCTOS DE A.A.", causas: "ACUMULA CONSTANTEMENTE AGUA Y CORROSION EN CUBIERTA.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "TBDL", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 29, date: "2026-03-17", dept: "MAQUINAS", asset: "M01-1-CC-001", equipoRaw: "PESCANTE ER", title: "PROVISION Y MONTAJE DE MOTOR DE PESCANTE AUXILIAR, PROVISION Y MONTAJE DE CABO PESCANTE AUXILIAR, MODIFICACION DE ALTURA DE PESCANTE DE BR Y ER CON CAMBIO DE CANGAMOS Y MODIFICACION DE SOPORTE DE TENSOR, MODIFICACION DE LUGAR DE CUNA DE LANCHA ER.", causas: "SEGURIDAD A LA NAVEGACION.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "SG SERVICE", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 30, date: "2026-03-17", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "REPARACIONES EN GRAL.", title: "MONTAJE DE INTERCAMBIADOR DE CALOR CON MODIFICACION DE CAÑERIA DE MMGG BR, CAMBIO DE ABRAZADERA DE TURBO CON MODIFICACION DE CAÑERIA DE ESCAPE Y COLOCACION DE MANTA CERAMICA MMPP ER, REPARACION PARCIAL DE PUERTA DE COCINA LADO BR, FABRICACION DE 13MTS DE CAÑERIA PARA DESCARGA DE AGUA DE TANQUE PURIFICADOR CON VALVULA CODO Y UNION DE 1 PULG, FABRICACION DE 10MTS DE CAÑERIA PARA DESAGUE DE TANQUE PURIFICADOR CON VALVULA, CODO Y UNION DE 1 PULG.", causas: "SEGURIDAD A LA NAVEGACION.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "SG SERVICE", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 31, date: "2026-03-17", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "REPARACIONES EN GRAL.", title: "MODIFICACION DE CAÑERIA DE MANGUERA A CAÑERIA RIGIDA EN SALIDA DE BOMBA AGUA POTABLE, REVESTIMIENTO DE ESCAPE DE MMGG ER, MANT DE MOTOBOMBA AUXILIAR DE LCI, REAJUSTE DE CADENA DE CABRESTANTE PROA BR Y ER.", causas: "SEGURIDAD A LA NAVEGACION.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "SG SERVICE", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 32, date: "2026-03-20", dept: "MAQUINAS", asset: "M01-CR-ER", equipoRaw: "CAJA REDUCTORA ESTRIBOR", title: "Desmontaje y Traslado de Caja Reductora", causas: "Desacoplamiento del manchón entre eje y caja. Corte, desmontaje y posterior montaje de cubierta para izaje de la caja reductora ER. Remoción de resina de la base. Uso de grúa para izaje/desembarque y traslado al taller.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 33, date: "2026-03-20", dept: "MAQUINAS", asset: "M01-CR-ER", equipoRaw: "CAJA REDUCTORA ESTRIBOR", title: "Overhaul de Caja Reductora ER", causas: "Desarmado completo de la caja reductora en taller para reparación y overhaul general. Montaje a bordo posterior a la reparación.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 34, date: "2026-03-20", dept: "MAQUINAS", asset: "M01-CR-ER", equipoRaw: "CAJA REDUCTORA ESTRIBOR", title: "Alineación de Caja Reductora ER (Lado Eje y Lado Motor)", causas: "Uso de dispositivo de alineación. Ajustes de la caja según necesidad. Provisión y colado de resina de fijación.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "SG SERVICE", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 35, date: "2026-03-25", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "BOMBA INYECTORA MS/GS CUMMINS", title: "RECORRIDO GRAL PARA RESERVA ABORDO", causas: "PERDIDA DE POTENCIA", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "REPOLTA", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 36, date: "2026-04-07", dept: "MAQUINAS", asset: "M01-MA-BR", equipoRaw: "MG/BABOR", title: "REPARACION DEL FLEXIBLE - ESCAPE", causas: "PERDIDA DE GASES", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 38, date: "2026-04-07", dept: "MAQUINAS", asset: "M01-1-CC-001", equipoRaw: "INODORO BAÑO MARINEROS", title: "CAMBIO DE INODORO Y DESTRANQUE DE LAVAMANOS", causas: "FILTRACIONES Y MAL FUNCIONAMIENTO", purchase: ["NORMAL", "AFECTA SEGURIDAD"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 39, date: "2026-04-07", dept: "MAQUINAS", asset: "M01-CR-BR", equipoRaw: "CAJA REDUCTORA BABOR", title: "VERIFICACION", causas: "FUERTE RUIDO AL ENCLOCHE", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 40, date: "2026-04-07", dept: "MAQUINAS", asset: "M01-HID-GOB", equipoRaw: "SISTEMA DE GOBIERNO", title: "VERIFICACION - BUZO", causas: "VERIFICACION POS ARRIBO EL 26 DE MARZO.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "INSPECTION", cons: "OPERATIONAL" },
  { n: 41, date: "2026-04-08", dept: "MAQUINAS", asset: "M01-HID-GOB", equipoRaw: "SISTEMA DE GOBIERNO", title: "VERIFICACION - BUZO", causas: "VERIFICACION EL 01 DE ABRIL.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "INSPECTION", cons: "OPERATIONAL" },
  { n: 42, date: "2026-04-08", dept: "MAQUINAS", asset: "M01-TEP", equipoRaw: "ALIMENTACION TIMONERA 220V", title: "CORTOSIRCUITO", causas: "SEGUIMIENTO Y RESTABLECIMIENTO DE LA ALIMENTACION DE TOMAS Y LUCES EN PUENTE TIMONERA, CON CAMBIO DE ARTEFACTO DE ILUMINACION Y TOMAS EN MAL ESTADO.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 43, date: "2026-04-13", dept: "MAQUINAS", asset: "M01-EJE-BR", equipoRaw: "HELICE BABOR", title: "REPARACION", causas: "ASPA CON FISURA Y GOLPE", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 45, date: "2026-04-13", dept: "MAQUINAS", asset: "M01-EJE-BR", equipoRaw: "SISTEMA DE PROPULSION EJE BABOR", title: "DESMONTAJE Y VERIFICACION", causas: "VIBRACIONES ANORMALES.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 46, date: "2026-04-13", dept: "MAQUINAS", asset: "M01-EJE-BR", equipoRaw: "SISTEMA DE PROPULSION", title: "PROVISION DE BUJE ARBOTANTE BABOR", causas: "EJE CAIDO.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 47, date: "2026-04-13", dept: "MAQUINAS", asset: "M01-MP-ER", equipoRaw: "MP ESTRIBOR", title: "AISLACION DE ESCAPE", causas: "REPARACION DE AISLACION DE ESCAPE DE MP ER.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 48, date: "2026-04-13", dept: "MAQUINAS", asset: "M01-MP-BR", equipoRaw: "MP BABOR", title: "REPARACION DEL MP BABOR.", causas: "CAMBIO DE ARBOL DE LEVAS, CAMBIO DE INYECTORES, CAMBIO DE BOMBA DE COMBUSTIBLE, CAMBIO DE TENSOR Y POLEAS DE DISTRIBUCION, CAMBIO BOMBA DE AGUA, REGULACION DE VALVULAS, CAMBIO DE MANGUERAS DE REFRIGERACION.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 49, date: "2026-04-13", dept: "MAQUINAS", asset: "M01-7-SD-001", equipoRaw: "MOLINETE ESTRIBOR.", title: "REPARACION MOTOR HIDRAULICO", causas: "DESMONTAJE, MONTAJE Y REPARO DEL MOTOR HIDRAULICO.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 50, date: "2026-04-14", dept: "MAQUINAS", asset: "M01-MA-BR", equipoRaw: "MG/BR", title: "CAMBIO DE CAÑITO LUBRICACION DE TURBO", causas: "CAMBIO DE CAÑITO LUBRICACION TURBO POR PERDIDA CONSTANTE SOBRE MULTIPLE ESCAPE.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 51, date: "2026-04-14", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "MOTOR ELECTRICO – BOMBA LASTRE BR", title: "VERIFICACION Y MANTENIMIENTO", causas: "POCA PRESION", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 52, date: "2026-04-14", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "VALVULA MEDIO GIRO LASTRE", title: "CAMBIO DE VALVULA DAÑADA 2.50 MEDIDA", causas: "FILTRACION Y POSIBLE AIREO PARA LA BOMBA LASTRE", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 53, date: "2026-04-14", dept: "MAQUINAS", asset: "M01-CR-ER", equipoRaw: "CAJA ESTRIBOR - MANOMETRO", title: "CAMBIO DE MANOMETRO DE TEMPERATURA DE CAJA", causas: "PERDIDA DE LUBRICANTE CONSTANTE", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 54, date: "2026-04-14", dept: "MAQUINAS", asset: "M01-HID-GOB", equipoRaw: "ANGULO DE CAIDA EN TIMONERA", title: "VERIFICACION AVANCE Y RETROCESO", causas: "MARCA MAL.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 55, date: "2026-04-14", dept: "MAQUINAS", asset: "M01-HID-GOB", equipoRaw: "SISTEMA DE GOBIERNO", title: "VERIFICACION Y CARGA DE EMPAQUETADURA", causas: "INGRESO DE AGUA", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "PEBURN S.R.L", comm: ["EMAIL", "WHAPP"], comentarios: "SOLICITO BUZO PARA VERIFICACION", type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 56, date: "2026-04-15", dept: "MAQUINAS", asset: "M01-HID-GOB", equipoRaw: "SISTEMA DE GOBIERNO", title: "VERIFICACION - REALIZADO EL 31/03/2026", causas: "MUCHA VIBRACION", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "RIVER SERVICES", comm: ["EMAIL", "WHAPP"], comentarios: "SOLICITO BUZO PARA VERIFICACION", type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 57, date: "2026-04-20", dept: "MAQUINAS", asset: "M01-MA-BR", equipoRaw: "MG/BABOR", title: "CAMBIO DE ALTERNADOR", causas: "ENGRANADO", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "RIVER SERVICES", comm: ["EMAIL", "WHAPP"], comentarios: "SOLICITO BUZO PARA VERIFICACION", type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 58, date: "2026-04-20", dept: "MAQUINAS", asset: "M01-CR-ER", equipoRaw: "CAJA REDUCTORA ESTRIBOR", title: "VERIFICACION", causas: "ALTA TEMPERATURA EN EL MISMO", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "RIVER SERVICES", comm: ["EMAIL", "WHAPP"], comentarios: "SOLICITO BUZO PARA VERIFICACION", type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 59, date: "2026-04-21", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "ALARMAS EN GRAL", title: "VERIFICACION ALARMAS MS/PS Y MG BR/ER", causas: "NO FUNCIONAN", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "RIVER SERVICES", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 60, date: "2026-04-21", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "MG – BR Y ER", title: "REPARACION DE PROTECTORES DE CORREA O PARTES MOVILES", causas: "EN MAL ESTADO Y SOLDADO", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "RIVER SERVICES", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 61, date: "2026-04-27", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "MG – BR Y ER", title: "CAMBIO DE RETEN DE CIGÜEÑAL – LIMPIEZA DE ALTERNADOR Y CAMBIO DE RODAMIENTO", causas: "PERDIDA DE ACEITE POR RETEN – Y LIMPIEZA DE ALTERNADOR PREVENTIVO", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "RIVER SERVICES", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 62, date: "2026-05-04", dept: "MAQUINAS", asset: "M01-EJE-BR", equipoRaw: "ACOMPAÑAMIENTO SUB ACUA", title: "SE RETROCEDE LA 2 LINEAS DE EJE BR Y ER", causas: "INGRESO DE AGUA CONSTANTE EN LAS LINEAS DE EJE – TRABAJO REALIZADO 25-04-2026", purchase: ["AFECTA SEGURIDAD"], taller: "RIVER SERVICES", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 63, date: "2026-05-04", dept: "MAQUINAS", asset: "M01-EJE-BR", equipoRaw: "SUB ACUA - INSPECCION", title: "PARA CARGA DE EMPAQUETADURA BR Y ER", causas: "INGRESO DE AGUA. REALIZADO EL 15-04-2026", purchase: ["AFECTA SEGURIDAD"], taller: "RIVER SERVICES", comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 64, date: "2026-05-05", dept: "MAQUINAS", asset: "M01-TUB-COMB", equipoRaw: "TANQUE DIARIO COMBUSTIBLE", title: "MEDICION DE GASES. REALIZADO EL 30/04/2026", causas: "PARA TRABAJO EN CALIENTE.", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "INSPECTION", cons: "SAFETY" },
  { n: 65, date: "2026-05-06", dept: "CUBIERTA", asset: "M01-1-CC-001", equipoRaw: "PESCANTE BR Y ER", title: "VERIFICACION DE PESCANTES", causas: "BR RESPONDE PERO NO ALZA NI BAJA Y ER NO RESPONDE.", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["EMAIL", "WHAPP"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 66, date: "2026-05-13", dept: "CUBIERTA", asset: "M01-HID-GOB", equipoRaw: "SISTEMA DE GOBIERNO", title: "ASISTENCIA PARA EL RESTABLECIMIENTO DEL SISTEMA DE GOBIERNO.", causas: "NO ACTIVAN LAS CAIDAS A AMBAS BANDAS", purchase: ["AFECTA SEGURIDAD"], taller: "ELECTRO OHM", comm: ["EMAIL", "WHAPP"], comentarios: "SEGUIMIENTO DEL CIRCUITO DE ALIMENTACION DE ELECTROVALVULAS EN PROPULSORES BR Y ER. VERIFICACION DE LOS CONTACTOS DE JOYSTICK EN PUENTE. CONTROL Y PRUEBAS DE LOS EQUIPOS CON PERSONAL DE LA EMP. HIDRAULICA BRASIL.", type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 68, date: "2026-05-13", dept: "CUBIERTA", asset: "M01-MALACATE", equipoRaw: "PESCANTE DE LANCHA DE BABOR", title: "PROVISION Y MONTAJE DE MOLINETE ELECTRICO", causas: "MOTOR AVERIADO", purchase: ["AFECTA SEGURIDAD"], taller: "ELECTRO OHM", comm: ["EMAIL", "WHAPP"], comentarios: "PROVISION Y REEMPLAZO DE MALACATE ELECTRICO DEL PESCANTE DE BABOR", type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 70, date: "2026-05-18", dept: "CUBIERTA", asset: "M01-EB-ACH-SENT", equipoRaw: "BOMBAS DE ACHIQUE DE SENTINA", title: "FABRICACION DE TABLERO CON MONTAJE EN SSMM, C/ ALIMENTACION DE TABLERO Y ALIMENTACION DE BOMBAS.", causas: "ENTRADA DE AGUA", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 71, date: "2026-05-18", dept: "CUBIERTA", asset: "M01-6-ED-001", equipoRaw: "SENSOR DE MURPHY", title: "MONTAJE DE SOPORTE PARA SENSOR Y COLOCACION DE VALVULAS PARA CONEXION", causas: "MODIFICACION", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 72, date: "2026-05-19", dept: "CUBIERTA", asset: "M01-6-ED-001", equipoRaw: "CAJAS REDUCTORAS", title: "MONTAJE DE PANEL INDICADOR DE ALARMAS DE BAJA PRESION Y TEMPERATURA DE ACEITE", causas: "Modificación / mejora de instrumentación", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 73, date: "2026-05-19", dept: "CUBIERTA", asset: "M01-6-ED-001", equipoRaw: "COMUNICACIÓN INTERNA", title: "PROVISION Y MONTAJE DE CENTRALITA INTERNA (TELEFONOS INTERNOS)", causas: "Modificación / mejora de comunicación interna", purchase: ["AFECTA SEGURIDAD"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 74, date: "2026-05-19", dept: "MAQUINAS", asset: "M01-HID-GOB", equipoRaw: "SISTEMA DE GOBIERNO", title: "VERIFICACION GRAL. DEL SISTEMA HIDRAULICO – PROVISION Y REEMPLAZO DE ELECTROVALVULA DE CIRCUITO HIDRAULICO – ACOMPAÑAMIENTO Y PRUEBA DEL SISTEMA.", causas: "SISTEMA DE GOBIERNO NO RESPONDE (CAIDAS BR/ER)", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "HIDRAULICA BRASIL", comm: ["IMPRESO", "EMAIL"], comentarios: "EL SISTEMA DE GOBIERNO QUEDA EN SERVICIO.", type: "CORRECTIVE", cons: "SAFETY" },
  { n: 75, date: "2026-05-20", dept: "MAQUINAS", asset: "M01-EB-ACH-SENT", equipoRaw: "SENTINA DE SALA DE MAQUINAS", title: "ACHIQUE DE AGUAS OLEOSAS – LIMPIEZA Y DESGASIFICACION – RETOQUE DE LIMPIEZA C/R BR – ER – LIMPIEZA Y DESGASIFICACION DE TQ. DIARIO.", causas: "LIMPIEZA PREVIA A TRABAJOS EN GRAL.", purchase: ["AFECTA SEGURIDAD"], taller: "RCA SERVICIOS DE LIMPIEZA", comm: ["IMPRESO", "EMAIL"], comentarios: "TRABAJO REALIZADO EN FECHA 22/04/2026, PREVIO INICIO DE TRABAJOS", type: "CORRECTIVE", cons: "ENVIRONMENTAL" },
  { n: 76, date: "2026-05-20", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "MAQUINAS / CUBIERTAS", title: "RETIRO DE AGUAS OLEOSAS – LIMPIEZA DE SENTINA – RETIRO DE RESIDUOS EN GRAL – LIMPIEZA DE MAMPAROS Y PLAYOLES.", causas: "RESIDUOS VARIOS", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "RCA SERVICIOS DE LIMPIEZA", comm: ["IMPRESO", "EMAIL"], comentarios: "TRABAJO REALIZADO EN FECHA 07/05/26 ; 10/05/2026 ; POSTERIOR A LAS REPARACIONES EN SECTOR MAQUINAS.", type: "CORRECTIVE", cons: "ENVIRONMENTAL" },
  { n: 77, date: "2026-05-20", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "TERMOCALEFON", title: "REPARACION", causas: "FUERA DE SERVICIO", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "CG SERVICE", comm: ["IMPRESO", "EMAIL"], comentarios: "TRABAJO REALIZADO EL 11/05/26 (ASTILLERO LOS HERMANOS)", type: "CORRECTIVE", cons: "NON_OPERATIONAL" },
  { n: 78, date: "2026-05-22", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "MOTORES ELECTRICOS", title: "MEGADO", causas: "SEGÚN PLAN DE MANTENIMIENTO", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "ELECTRO OHM", comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "PREVENTIVE", cons: "OPERATIONAL" },
  { n: 79, date: "2026-05-22", dept: "MAQUINAS", asset: "M01-EJE-BR", equipoRaw: "LINEA DE EJES", title: "CARGA DE EMPAQUETADURA", causas: "ENTRADA DE AGUA", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "RIVER SERVICES", comm: ["IMPRESO", "EMAIL"], comentarios: "TRABAJO REALIZADO EL 05/05/2026 EN ASTILLERO LOS HERMANOS", type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 80, date: "2026-05-22", dept: "MAQUINAS", asset: "M01-EJE-BR", equipoRaw: "LINEA DE EJES", title: "LIBERACION DE TUNEL DE LINEA DE EJE", causas: "PARA POSTERIOR MONTAJE DE CAJAS REDUCTORAS", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "RIVER SERVICES", comm: ["IMPRESO", "EMAIL"], comentarios: "TRABAJO REALIZADO EL 07/05/2026 EN ASTILLERO LOS HERMANOS", type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 81, date: "2026-05-25", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "MS/GS BR, ER", title: "PROVISION DE 1 REGULADOR DE VOLTAJE DE 8 AMPERES Y 23 AMPERES", causas: "PARA STOCK ABORDO.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "RIVER SERVICES", comm: ["IMPRESO", "EMAIL"], comentarios: "TRABAJO REALIZADO EL 07/05/2026 EN ASTILLERO LOS HERMANOS", type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 82, date: "2026-05-25", dept: "MAQUINAS", asset: "M01-MP-BR", equipoRaw: "MP BR", title: "REPROGRAMACION DE SOFTWARE, CAMBIO DE MOTOR DE ARRANQUE.", causas: "CAMBIO POR FALLA DE MANDO DE MOTOR, CAMBIO DE ARRANQUE MOTOR POR FALLA.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "PESCAROLO", comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 83, date: "2026-05-25", dept: "MAQUINAS", asset: "M01-MP-ER", equipoRaw: "MP ER", title: "CAMBIO DE ROTOR BOMBA DE AGUA, LIMPIEZA DEL CIRCUITO DE INTERCAMBIADOR DE AIRE MP, INTERCAMBIADOR DE CAJA ER, REPARACION DE INYECTORES, REEMPLAZO DE SELLOS Y ARANDELAS, REGULACION DE VALVULAS.", causas: "REALIZADOS POR PLAN DE MANTENIMIENTO.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "PESCAROLO", comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "PREVENTIVE", cons: "OPERATIONAL" },
  { n: 84, date: "2026-05-25", dept: "MAQUINAS", asset: "M01-MP-ER", equipoRaw: "MP ER", title: "Reemplazo mando de PCU, HCU, ECU Y CONFIGURACION DE SOFTWARE", causas: "REALIZADOS POR FALLA Y SEGURIDAD A LA NAVEGACION", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "PESCAROLO", comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 85, date: "2026-05-27", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "Sistema de Alarmas en Sala de Maquina", title: "COLOCACION DE ALARMA DE EMERGENCIA PARA MS/GS DE AVISO DE ALTA TEMP/AGUA REFRIG, BAJA PRESION DE ACEITE, VISUAL Y SONORA. COLOCACION DE ALARMAS DE AVISO VISUAL Y SONORA DE CAJAS REDUCTORA, TEMP/BAJA PRESION DE ACEITE, COLOCACION DE ALARMA MURPHY EN NIVEL BAJO Y ALTO SONORA Y VISUAL DE TANQUE DIARIO GASOIL, COLOCACION DE RPM DE MS/GS", causas: "FALLA EN ALARMAS EN GRAL.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: "ELECTRO OHM", comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 87, date: "2026-06-08", dept: "MAQUINAS", asset: "M01-MP-ER", equipoRaw: "MOTOR PROPULSOR DE ESTRIBOR", title: "CHEQUEO DEL SISTEMA DE ELECTRONICA E.C.U.", causas: "FALLAS / EN CORTO", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: "EN UN PERIODO DE 2 MESES SE REALIZO REEMPLAZO DE E.C.U. POR FALLAS EN EL SISTEMA DE ELECTRONICA DEL MM.PP DE ESTRIBOR", type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 88, date: "2026-06-08", dept: "MAQUINAS", asset: "M01-MP-ER", equipoRaw: "MM.PP DE ESTRIBOR", title: "RECORRIDO DE DUCTO DE ESCAPE DEL TURBO", causas: "PERDIDAS DE GASES", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 89, date: "2026-06-08", dept: "MAQUINAS", asset: "M01-EJE-BR", equipoRaw: "LINEAS DE EJES", title: "INSPECCION SUB-AQUA Y CARGA DE EMPAQUETADURAS", causas: "LINEAS DE EJE CON POCA LUZ DE REAPRIETE EN MANCHONES DE PRENSA DE EMPAQUETADURA.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 90, date: "2026-06-08", dept: "MAQUINAS", asset: "M01-SEWAGE", equipoRaw: "SEWAGE – TRATAMIENTO DE AGUAS NEGRAS", title: "REEMPLAZO TOTAL DE MANGUERAS DE AGUA", causas: "MANGUERAS RESECADAS Y AGRIETADAS", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "ENVIRONMENTAL" },
  { n: 91, date: "2026-06-08", dept: "MAQUINAS", asset: "M01-EB-AP1", equipoRaw: "BOMBA HIDROFORO AUXILIAR", title: "REEMPLAZO – AVERIADO", causas: "BOMBA CENTRIFUGA NO LEVANTA PRESION", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 92, date: "2026-06-08", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "MOTORES GENERADORES", title: "COLOCACION DE MANTA TERMICA EL DUCTO DE ESCAPE", causas: "VIBRACION EN LA BASE DEL ESCAPE", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: "LA MANTA TERMICA ABSORBE LA VIBRACION, LOS MOTORES GENERADORES TIENEN PROTECTORES FIJOS EN LA BASE DEL ESCAPE QUE ROZAN CAÑITOS DE AGUA Y ACEITE. CON LA MANTA TERMICA EVITAMOS CUALQUIER DESGASTE DE LOS CAÑITOS.", type: "CORRECTIVE", cons: "OPERATIONAL" },
  { n: 93, date: "2026-06-08", dept: "MAQUINAS", asset: "M01-HID-GOB", equipoRaw: "TIMON DE EMERGENCIA", title: "REPARACION", causas: "NO LEVANTA PRESION", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: "AL REALIZAR EL BOMBEO MANUAL NO GENERA PRESION PARA EL USO EN MODO EMERGENCIA.", type: "CORRECTIVE", cons: "SAFETY" },
  { n: 94, date: "2026-06-08", dept: "MAQUINAS", asset: "M01-EB-ACH-SENT", equipoRaw: "TANQUE DE SLOP Y SENTINA DE MAQUINAS", title: "RETIRO DE AGUAS OLEOSAS", causas: "AGUAS OLEOSAS ABORDO", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "ENVIRONMENTAL" },
  { n: 96, date: "2026-06-10", dept: "MAQUINAS", asset: "M01-6-ED-001", equipoRaw: "MOTOR GENERADOR DE BABOR Y ESTRIBOR", title: "REEMPLAZO Y SANEAMIENTO GRAL. DE CABLES DE CONEXIONES (DE SENSORES, DE ALTERNADOR Y VARIOS)", causas: "CABLES RESECADOS, SULFATADOS Y AGRIETADOS", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: null, type: "CORRECTIVE", cons: "SAFETY" },
  { n: 98, date: "2026-06-10", dept: "MAQUINAS", asset: "M01-MA-BR", equipoRaw: "MOTOR GENERADOR DE BABOR", title: "VERIFICACION DE CONEXIONES DE TURBO - BASE DE ESCAPE - REEMPLAZO DE CAÑITO DE TURBO - REEMPLAZO DE CAÑO DE REFRIGERACION", causas: "TODOS POR PERDIDA DE GASES Y LIQUIDO REFRIG.", purchase: ["AFECTA SEGURIDAD", "AFECTA SERVICIO"], taller: null, comm: ["IMPRESO", "EMAIL"], comentarios: "TODOS LO SOLICITADO CORRESPONDE PARA SANEAR PERDIDAS DE GAS DE ESCAPE, DE LIQUIDO REFRIGERANTE Y ACEITE.", type: "CORRECTIVE", cons: "OPERATIONAL" },
];

// Nombre crudo del PDF → nombre canónico de Provider a crear/reusar.
// "CG SERVICE" hace fuzzy-match contra el Provider ya existente "CG Services".
const PROVIDER_CANON: Record<string, string> = {
  "HIDRAULICA BRASIL": "Hidraulica Brasil",
  "PEBURN S.R.L": "Peburn S.R.L.",
  "RIVER SERVICES": "River Services",
  "RIVER SERVICE": "River Services",
  "TBDL": "TBDL",
  "SG SERVICE": "SG Service",
  "ELECTRO OHM": "Electro Ohm",
  "REPOLTA": "Repolta",
  "RCA SERVICIOS DE LIMPIEZA": "RCA Servicios de Limpieza",
  "CG SERVICE": "CG Services", // fuzzy match → reusa el existente
  "PESCAROLO": "Pescarolo",
};

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

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
    case "SAFETY": return "La omisión compromete la seguridad de personas o la respuesta ante emergencia.";
    case "ENVIRONMENTAL": return "La omisión puede derivar en derrame o contaminación (aguas oleosas / sentina).";
    case "OPERATIONAL": return "La omisión afecta la disponibilidad operativa del remolcador (propulsión / gobierno / servicios).";
    case "NON_OPERATIONAL": return "Impacto acotado al confort o costo de reparación, sin afectar operación, seguridad ni ambiente.";
  }
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant || tenant.id !== TENANT_ID) throw new Error(`Tenant ${TENANT_SLUG} no coincide con TENANT_ID esperado`);
  const tenantId = tenant.id;

  const assets = await prisma.asset.findMany({
    where: { tenantId, vesselCode: VESSEL, deletedAt: null },
    select: { id: true, assetCode: true, criticality: true },
  });
  const assetMap = new Map<string, { id: string; criticality: string }>(
    assets.map((a: any) => [a.assetCode, { id: a.id, criticality: a.criticality }]),
  );
  const missingAssets = ROWS.filter(r => !assetMap.has(r.asset)).map(r => `SS-${r.n} → ${r.asset}`);
  if (missingAssets.length) throw new Error(`Asset codes inexistentes en M01:\n${missingAssets.join("\n")}`);

  const [rene, jorge] = await Promise.all([
    prisma.user.findUnique({ where: { id: RENE_CANO_ID }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: JORGE_BAEL_ID }, select: { id: true } }),
  ]);
  if (!rene) throw new Error("Rene Cano userId no encontrado");
  if (!jorge) throw new Error("Jorge Bael userId no encontrado");

  // Providers: resolver/crear por nombre canónico.
  const tallerNames = Array.from(new Set(ROWS.filter(r => r.taller).map(r => PROVIDER_CANON[r.taller!] ?? r.taller!)));
  const existingProviders = await prisma.provider.findMany({ where: { tenantId }, select: { id: true, name: true } });
  const providerMap = new Map<string, string>(existingProviders.map((p: any) => [p.name.toLowerCase(), p.id]));
  const providersToCreate = tallerNames.filter(n => !providerMap.has(n.toLowerCase()));

  console.log(`\n===== CARGA OT+SS MAO01/M01 (${DRY ? "DRY-RUN" : "LIVE"}) =====`);
  console.log(`Tenant: ${TENANT_SLUG} (${tenantId})  Buque: ${VESSEL}`);
  console.log(`Filas a cargar: ${ROWS.length}`);
  console.log(`OT: OT-${VESSEL}-26-${String(OT_START_SEQ).padStart(4, "0")} … OT-${VESSEL}-26-${String(OT_START_SEQ + ROWS.length - 1).padStart(4, "0")}`);
  console.log(`SS: SS-${ROWS[0].n}-${VESSEL}-2026 … SS-${ROWS[ROWS.length - 1].n}-${VESSEL}-2026 (preserva numeración de la planilla, con huecos)`);
  console.log(`Tramitación: Solicita/Aprueba/Cierra = ${RENE_CANO_NAME} (${RENE_CANO_ID}) · Autoriza = ${JORGE_BAEL_NAME} (${JORGE_BAEL_ID})`);
  console.log(`Providers existentes: ${existingProviders.length}. A crear: ${providersToCreate.length} → ${providersToCreate.join(", ") || "(ninguno)"}`);

  // Idempotencia: borrar OT (y sus SS, por cascade de hojaRuta + restrict manual) en el rango de códigos de este script.
  const otCodes = ROWS.map((_, i) => `OT-${VESSEL}-26-${String(OT_START_SEQ + i).padStart(4, "0")}`);
  const existingOts = await prisma.workOrder.findMany({
    where: { tenantId, vesselCode: VESSEL, workOrderCode: { in: otCodes } },
    select: { id: true, workOrderCode: true },
  });
  if (existingOts.length) {
    console.log(`Idempotencia: ${existingOts.length} OT previas con esos códigos serán borradas (+ sus SS) y reinsertadas.`);
    if (!DRY) {
      const ids = existingOts.map((e: any) => e.id);
      const srs = await prisma.serviceRequest.findMany({ where: { workOrderId: { in: ids } }, select: { id: true } });
      const srIds = srs.map((s: any) => s.id);
      await prisma.serviceRequestLog.deleteMany({ where: { serviceRequestId: { in: srIds } } });
      await prisma.serviceRequest.deleteMany({ where: { id: { in: srIds } } });
      await prisma.workOrderProgressNote.deleteMany({ where: { workOrderId: { in: ids } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: ids } } });
    }
  }

  if (DRY) {
    console.log(`\n-- Muestra (primeras 6 de ${ROWS.length}) --`);
    for (const r of ROWS.slice(0, 6)) {
      const a = assetMap.get(r.asset)!;
      console.log(`  SS-${r.n}-${VESSEL}-2026 [${r.date}] ${r.asset} (crit ${a.criticality}) ${r.type}/${r.cons} taller="${r.taller ?? "-"}" → "${r.title.slice(0, 60)}"`);
    }
    console.log(`\n(DRY-RUN: no se escribió nada. Quitá DRY=1 para ejecutar.)\n`);
    await prisma.$disconnect();
    return;
  }

  // Crear providers faltantes. providerCode formato PRV-<VESSEL>-<seq4> (ver CG Services: PRV-M01-0001).
  // Retry ante P2002: el adapter pg (7.7.0) mostró colisiones espurias en pruebas
  // (un insert aislado del mismo código, corrido a mano, no colisionaba) — probable
  // artefacto del pool/prepared statements bajo varias queries seguidas en el mismo
  // proceso. Reintentar con el siguiente secuencial es inocuo y resuelve ambos casos.
  const maxCodeRow = existingProviders
    .map((p: any) => Number(String(p.providerCode ?? "").split("-").pop()))
    .filter((n: number) => Number.isFinite(n));
  let nextSeq = (maxCodeRow.length ? Math.max(...maxCodeRow) : 0) + 1;
  for (const name of providersToCreate) {
    let created: any;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      const providerCode = `PRV-${VESSEL}-${String(nextSeq).padStart(4, "0")}`;
      nextSeq++;
      try {
        created = await prisma.provider.create({
          data: { tenantId, vesselCode: VESSEL, providerCode, name, createdByUserId: RENE_CANO_ID, updatedByUserId: RENE_CANO_ID },
        });
        break;
      } catch (err: any) {
        lastErr = err;
        if (err?.code !== "P2002") throw err;
      }
    }
    if (!created) throw lastErr;
    providerMap.set(name.toLowerCase(), created.id);
    console.log(`  Provider creado: ${name} (${created.providerCode} / ${created.id})`);
  }

  let ok = 0;
  for (let i = 0; i < ROWS.length; i++) {
    const r = ROWS[i];
    const a = assetMap.get(r.asset)!;
    const when = d(r.date);
    const otCode = `OT-${VESSEL}-26-${String(OT_START_SEQ + i).padStart(4, "0")}`;
    const srCode = `SS-${r.n}-${VESSEL}-2026`;
    const providerId = r.taller ? (providerMap.get((PROVIDER_CANON[r.taller] ?? r.taller).toLowerCase()) ?? null) : null;

    const closeNote = `Trabajo realizado conforme a la solicitud (${r.equipoRaw}). Equipo verificado operativo.`
      + (r.comentarios ? ` Observación de la planilla original: ${r.comentarios}` : "");

    await prisma.workOrder.create({
      data: {
        tenantId,
        vesselCode: VESSEL,
        assetId: a.id,
        maintenancePlanId: null,
        workOrderCode: otCode,
        type: r.type,
        status: "CLOSED",
        priority: prioFromCrit(a.criticality),
        criticality: a.criticality,
        openDate: when,
        startDate: when,
        dueDate: when,
        completedDate: when,
        title: r.title,
        description: r.title,
        assignedToUserId: RENE_CANO_NAME,
        estimatedHours: r.type === "INSPECTION" ? 3 : 6,
        actualHours: r.type === "INSPECTION" ? 3 : 6,
        acceptanceCriteria: acceptance(r.type),
        loto: LOTO,
        riskLevel: riskFromCrit(a.criticality),
        riskAnalysisResult: r.causas,
        consequenceCategory: r.cons,
        consequenceRationale: consRationale(r.cons),
        department: r.dept,
        providerId: providerId,
        location: null,
        communicationMethod: [],
        distribution: [],
        // Tramitación de la OT
        aprobadoByName: RENE_CANO_NAME,
        aprobadoByUserId: RENE_CANO_ID,
        aprobadoAt: when,
        autorizadoByName: JORGE_BAEL_NAME,
        autorizadoByUserId: JORGE_BAEL_ID,
        autorizadoAt: when,
        // Resultado / cierre de la OT
        woResult: "SATISFACTORY",
        executedByName: RENE_CANO_NAME,
        observations: closeNote,
        closeNotes: closeNote,
        createdAt: when,
        createdByUserId: RENE_CANO_ID,
        updatedByUserId: RENE_CANO_ID,
        progressNotes: {
          create: [{
            tenantId,
            vesselCode: VESSEL,
            kind: "TEXT",
            text: `Se ejecutó el servicio solicitado: ${r.title} Causa atendida: ${r.causas}`,
            processedText: `Se ejecutó el servicio solicitado: ${r.title} Causa atendida: ${r.causas}`,
            processed: true,
            createdAt: when,
            createdByUserId: RENE_CANO_ID,
          }],
        },
        serviceRequests: {
          create: [{
            tenantId,
            vesselCode: VESSEL,
            serviceRequestCode: srCode,
            status: "COMPLETED",
            priority: prioFromCrit(a.criticality),
            openDate: when,
            title: r.title,
            description: r.title,
            causes: r.causas,
            providerId: providerId,
            tallerNotes: providerId ? null : r.taller,
            purchaseRequestKinds: r.purchase,
            department: r.dept,
            communicationMethod: r.comm,
            distribution: [],
            observations: r.comentarios,
            closeNotes: closeNote,
            receptionItem: r.equipoRaw,
            receivedByName: RENE_CANO_NAME,
            receptionConform: true,
            startedAt: when,
            receivedAt: when,
            capitanName: null,
            jefeMaquinasName: RENE_CANO_NAME,
            solicitaByName: RENE_CANO_NAME,
            aprobadoByName: RENE_CANO_NAME,
            aprobadoByUserId: RENE_CANO_ID,
            aprobadoAt: when,
            autorizadoByName: JORGE_BAEL_NAME,
            autorizadoByUserId: JORGE_BAEL_ID,
            autorizadoAt: when,
            createdAt: when,
            createdByUserId: RENE_CANO_ID,
            updatedByUserId: RENE_CANO_ID,
          }],
        },
      },
    });
    ok++;
    if (ok % 10 === 0 || ok === ROWS.length) console.log(`  [${ok}/${ROWS.length}] ${otCode} / ${srCode} OK`);
  }

  console.log(`\n===== LISTO: ${ok} OT + ${ok} SS creadas (CLOSED / COMPLETED) =====\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
