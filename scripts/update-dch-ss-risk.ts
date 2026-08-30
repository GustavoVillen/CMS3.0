/**
 * Mejora el campo riskAnalysisResult ("Resultado del análisis de riesgo" / en el
 * form SS de Mercurio: "Detalle de las causas") de las 64 SS de DON CHICUETO (DCH)
 * cargadas por scripts/load-dch-ss.ts (SS-DCH-26-0002 .. 0065).
 *
 * Reemplaza la causa breve por un análisis de riesgo: condición/modo de falla →
 * consecuencia potencial → nivel/categoría → mitigación y riesgo residual.
 *
 * Idempotente (UPDATE por workOrderCode). Solo toca riskAnalysisResult.
 *
 * Uso (en el VPS):
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/update-dch-ss-risk.ts   # previsualiza
 *   npx tsx scripts/update-dch-ss-risk.ts         # ejecuta
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

const SUBACUA =
  "Inspección subacuática de rutina del sistema de propulsión y gobierno: se verifica el estado de timón, hélices, palas y obra viva para detectar incrustaciones, daños o juegos anormales antes de que afecten la maniobrabilidad. Riesgo operacional gestionado por inspección periódica; sin hallazgos que comprometan el gobierno. Estado documentado para seguimiento.";

// SS (número del Excel 1..64) → análisis de riesgo mejorado
const RISK: Record<number, string> = {
  1: "El exceso de temperatura del agua de refrigeración evidencia bajo caudal de la bomba; de no corregirse puede provocar disparo por alta temperatura y parada del motor generador, con pérdida de generación eléctrica a bordo. Riesgo operacional ALTO. Mitigado verificando el funcionamiento de la bomba de agua; tras la intervención el grupo opera dentro del rango térmico nominal.",
  2: SUBACUA,
  3: SUBACUA,
  4: "Tendencia al aumento de temperatura del agua en servicio: síntoma de pérdida de eficiencia de refrigeración que, sin control, puede escalar a sobrecalentamiento y parada del generador. Riesgo operacional ALTO. Mitigado mediante verificación de funcionamiento; se confirma operación estable dentro de parámetros.",
  5: "Falla de transformadores de iluminación / llave termomagnética en servicio: riesgo de pérdida de iluminación y de daño por sobrecorriente en el tablero. Riesgo operacional. Mitigado verificando y testeando/cambiando la llave TM; circuito restablecido y protecciones operativas.",
  6: "La alta temperatura en la sala de M/G auxiliar degrada los componentes eléctricos y acorta su vida útil, con riesgo de fallas en cadena. Riesgo operacional. Mitigado con aislación térmica de la sala; se reduce la temperatura ambiente y se protege la instalación eléctrica.",
  7: "Acumulación de ~5000 L en sentinas: riesgo ambiental por eventual descarga no controlada y riesgo de obstrucción del sistema de achique. Riesgo ambiental. Mitigado con retiro y limpieza de sentinas mediante gestor autorizado; se restablece la capacidad de achique.",
  8: "El arrestallamas del escape averiado deja de contener chispas/llamas, elevando el riesgo de ignición en la sala de máquinas. Riesgo de seguridad (incendio). Mitigado con la confección y montaje de un nuevo arrestallamas; barrera de protección contra incendio restablecida.",
  9: "Medición de aislación de los transformadores 380/220 V para detectar degradación dieléctrica que pueda derivar en fuga a masa o cortocircuito. Riesgo eléctrico/operacional. Se evalúan los valores de aislación y se determina el estado, dando base a las acciones correctivas asociadas.",
  10: "Conductores y terminales sobrecalentados del transformador 380/220 V N°2: riesgo de incendio eléctrico e interrupción del suministro de 220 V. Riesgo de seguridad. Mitigado con el cambio del conductor eléctrico; conexiones rehechas y temperatura de operación normalizada.",
  11: "Falla del motor eléctrico del malacate del pescante de botes ER: riesgo de no poder arriar/izar el bote, afectando la respuesta ante emergencia y la operación. Riesgo operacional. Mitigado con recorrido al motor eléctrico; accionamiento restablecido.",
  12: "Terminales sobrecalentados en la llave TM del M/G N°1 Br por conexión floja: riesgo de arco, incendio y disparo intempestivo. Riesgo de seguridad. Mitigado con reapriete de bornes; resistencia de contacto normalizada y calentamiento eliminado.",
  13: "Falla del motor del extractor de sala de máquinas Br: la ventilación deficiente eleva la temperatura ambiente y degrada los equipos. Riesgo operacional. Mitigado con recorrido al motor eléctrico; ventilación/extracción restablecida.",
  14: "Falla del lavarropas: impacto en el confort y la habitabilidad de la tripulación, sin afectar operación, seguridad ni ambiente. Riesgo no operacional. Mitigado con recorrido y mantenimiento; equipo restablecido.",
  15: "La inspección detectó juego axial y radial excesivo en palier/rodamientos de la caja reductora Er: condición de desgaste que, de progresar, puede causar vibración, daño de engranajes y pérdida de propulsión. Riesgo operacional ALTO. Hallazgo registrado con DEFICIENCIA; se recomienda programar el reemplazo de rodamientos y el seguimiento de vibración.",
  16: "Sin repetición de temperaturas y presión en sala de control, las anomalías de los M/G pueden pasar inadvertidas hasta la falla. Riesgo de seguridad/operacional. Mitigado instalando el repetidor en sala de control; mejora la detección temprana y la respuesta del personal.",
  17: SUBACUA,
  18: "Conductores deteriorados con fuga a masa en el tablero de cocina: riesgo de descarga eléctrica al personal y de incendio. Riesgo de seguridad. Mitigado con verificación y corrección de la fuga; aislación restablecida.",
  19: "Fallas de aceleración por anomalía del módulo controlador del MP Estribor: riesgo de respuesta errática de la propulsión durante la maniobra. Riesgo operacional ALTO. Mitigado con verificación del módulo controlador; respuesta de aceleración normalizada.",
  20: "Falla del intercomunicador de 24 V: degrada la comunicación interna, con impacto acotado a la coordinación operativa. Riesgo no operacional. Mitigado con verificación del equipo; comunicación restablecida.",
  21: "Pérdida de agua por el sello mecánico de la bomba de refrigeración: riesgo de pérdida de caudal y sobrecalentamiento de los M/G, más ingreso de agua a sentina. Riesgo operacional. Mitigado con recorrido al sello mecánico; estanqueidad y caudal restablecidos.",
  22: "Manguera de agua degradada / abrazadera floja en el M/G ER con alta temperatura: riesgo de rotura, pérdida de refrigerante y parada por sobrecalentamiento. Riesgo operacional. Mitigado con cambio de manguera y abrazadera; circuito de refrigeración estanco.",
  23: "Luces de emergencia fuera de servicio comprometen la evacuación y la operación ante corte de energía. Riesgo de seguridad. Mitigado con provisión e instalación de nuevos equipos; iluminación de emergencia operativa.",
  24: "Acrílicos de disparo de los pulsadores de alarma LCI deteriorados: riesgo de no poder activar manualmente la alarma de incendio. Riesgo de seguridad. Mitigado con provisión e instalación de pulsadores/acrílicos; activación manual de alarma restablecida.",
  25: "Ventilación insuficiente en sala de máquinas por falta de ventanas adecuadas: alta temperatura ambiente que degrada los equipos. Riesgo operacional. Mitigado con provisión y montaje de ventanas; ventilación natural mejorada.",
  26: "Necesidad de probar el MP Estribor desacoplado para aislar el origen de una anomalía (motor vs. línea de eje). Riesgo operacional controlado. Mitigado con desacoplamiento del manchón; permite un diagnóstico seguro sin transmitir esfuerzo a la línea de eje.",
  27: "Pérdida de agua por juntas/culatas del MP Estribor: riesgo de mezcla agua-aceite, sobrecalentamiento y daño mayor del motor. Riesgo operacional ALTO. Mitigado con reemplazo de 3 juntas y 3 culatas; estanqueidad del circuito de refrigeración restablecida.",
  28: "Válvula antirretorno del corte neumático de combustible defectuosa: riesgo de no poder cortar el combustible ante una emergencia (incendio). Riesgo de seguridad. Mitigado con cambio de válvula; sistema de corte de emergencia operativo.",
  29: "Seguro del volante de freno del molinete de popa defectuoso: riesgo de liberación involuntaria del freno durante la maniobra de amarre, con peligro para el personal y la carga. Riesgo operacional/seguridad. Mitigado con montaje del seguro; bloqueo del freno restablecido.",
  30: "Falta de juntas en las bridas de conexión internacional: riesgo de fuga y de no poder acoplar de forma estanca el suministro de agua contraincendio desde tierra/otro buque. Riesgo de seguridad (incendio). Mitigado con montaje de juntas; conexión estanca asegurada.",
  31: "Brida de conexión internacional contraincendio en mal estado: riesgo de no disponer de una toma normalizada para asistencia externa de agua. Riesgo de seguridad. Mitigado con provisión y montaje de bridas internacionales; capacidad de interconexión restablecida.",
  32: "Arrestallamas del venteo del tanque de lastre ausente/deteriorado: riesgo de propagación de llama hacia el tanque. Riesgo de seguridad. Mitigado con montaje de un nuevo arrestallamas; protección del venteo restablecida.",
  33: "Bomba de refrigeración de M/G con fallas: riesgo de pérdida de caudal y sobrecalentamiento de los generadores. Riesgo operacional. Mitigado con provisión y montaje de bomba nueva; refrigeración restablecida a caudal nominal.",
  34: "Sobrecalentamiento de conductores del transformador 380/220 V Babor N°1: riesgo de incendio eléctrico y corte del suministro de 220 V. Riesgo de seguridad. Se provisionan los materiales para el recambio (correctivo asociado), reduciendo el tiempo de exposición a la falla.",
  35: "Borneras y conductores sobrecalentados del transformador 380/220 V Babor N°1: riesgo de arco/incendio y pérdida de suministro. Riesgo de seguridad. Mitigado con cambio de borneras y conductores; conexiones rehechas y temperatura normalizada.",
  36: "Falla del sensor de nivel del tanque de compensación del MP Estribor: riesgo de no detectar bajo nivel de refrigerante y sobrecalentar el motor. Riesgo operacional. Mitigado con verificación del sensor; monitoreo de nivel restablecido.",
  37: SUBACUA,
  38: "Pérdida de aceite en la bomba prelubricadora del turbo del MP Babor: riesgo de prelubricación deficiente del turbo (desgaste prematuro) y contaminación por aceite en sentina. Riesgo ambiental/operacional. Mitigado con verificación de la bomba; estanqueidad y prelubricación restablecidas.",
  39: "Contactores de la central hidráulica con fallas y sin señalización en sala de control: riesgo de pérdida de presión hidráulica de gobierno sin aviso. Riesgo operacional. Mitigado con cambio de contactores e instalación de luz piloto; gobierno hidráulico confiable y supervisado.",
  40: "Avería en pala de avance / hélice ER: riesgo de pérdida de empuje, vibración y daño de la línea de eje. Riesgo operacional ALTO. Mitigado con fabricación y montaje de la pala/hélice; propulsión de estribor restablecida.",
  41: "Hélice Er averiada y pasos de hélice Br fuera de control: desbalance que genera vibración, mayor consumo y fatiga de la línea de eje. Riesgo operacional. Mitigado con balanceo y control de pasos; vibración dentro de límites y empuje normalizado.",
  42: "El visicooler no mantiene temperatura: riesgo de deterioro de alimentos; impacto en habitabilidad sin afectar operación ni seguridad. Riesgo no operacional. Mitigado con mantenimiento general; temperatura de conservación restablecida.",
  43: "El alternador del M/G Babor no mantiene la carga: riesgo de descarga de baterías y pérdida de respaldo eléctrico. Riesgo operacional. Mitigado con inspección/cambio del alternador; carga restablecida.",
  44: "Sin sensores Murphy operativos en los MP Br/Er no hay protección automática por baja presión de aceite / alta temperatura: riesgo de daño grave del motor. Riesgo operacional ALTO. Mitigado con montaje de sensores Murphy y cañerías; protecciones automáticas restablecidas.",
  45: "Válvulas mariposa de 4\" del cañón LCI con pérdida de agua: riesgo de presión/caudal insuficiente del sistema contraincendio. Riesgo de seguridad. Mitigado con provisión y cambio de válvulas; capacidad de extinción restablecida.",
  46: "Overhaul programado del M/G Estribor por cumplimiento de horas: previene fallas por desgaste acumulado y asegura la disponibilidad de generación. Riesgo operacional gestionado de forma preventiva. Ejecutado el overhaul según plan; generador con vida útil renovada y parámetros nominales.",
  47: "La ausencia de una parada local señalizada de la bomba hidráulica dificulta una detención segura ante anomalía. Riesgo operacional. Mitigado con instalación de pulsador de parada con luz piloto; mejora la operabilidad y la respuesta ante falla.",
  48: "Contactores averiados en la central hidráulica: riesgo de pérdida intermitente o total de la presión de gobierno. Riesgo operacional ALTO. Mitigado con reemplazo de contactores; accionamiento hidráulico confiable.",
  49: "Medición de vibración torsional del tren propulsor (motores, cajas reductoras y líneas de eje) para detectar desalineación, desbalance o desgaste incipiente antes de la falla. Riesgo operacional gestionado por monitoreo de condición. Resultados dentro de parámetros; base para mantenimiento predictivo.",
  50: "Bombas sumergibles de la línea de eje babor con falla: riesgo de acumulación de agua y de afectación a la línea de eje. Riesgo operacional. Mitigado con cambio/reparación de las bombas; achique de la zona restablecido.",
  51: "Falla del sistema presurizador (hidróforo) de agua: pérdida de presión de agua de servicio, con impacto en habitabilidad. Riesgo no operacional. Mitigado con cambio/reparación de los equipos; presión de agua restablecida.",
  52: "Inspección de rutina de los motores principales como control preventivo para detectar desgaste, fugas o anomalías antes de que afecten la propulsión. Riesgo operacional gestionado preventivamente. Sin hallazgos críticos; estado documentado para seguimiento.",
  53: SUBACUA,
  54: "Bocina de aire (pito) sin funcionamiento por falla del compresor/corneta: riesgo de no emitir las señales acústicas reglamentarias de maniobra y seguridad. Riesgo de seguridad/navegación. Mitigado con provisión de compresor nuevo, corneta y cañerías; señalización acústica restablecida.",
  55: "Falla del lavarropas Whirlpool: impacto en habitabilidad, sin afectar operación, seguridad ni ambiente. Riesgo no operacional. Mitigado con recorrido al equipo; funcionamiento restablecido.",
  56: "Detectores de humo/calor de la alarma LCI con falla: riesgo de no detectar un incendio en etapa temprana. Riesgo de seguridad ALTO. Mitigado con recorrido al equipo y a los detectores; detección temprana de incendio restablecida.",
  57: "Desnivel en el área de lavandería: riesgo menor de inestabilidad de los equipos y de caída/derrame. Riesgo no operacional. Mitigado con fabricación de plataformas niveladas; equipos asentados de forma estable.",
  58: "Cañería de la bomba de sanidad oxidada con pérdidas: riesgo ambiental y sanitario por derrame de aguas servidas. Riesgo ambiental. Mitigado con cambio del tramo de cañería; estanqueidad del sistema sanitario restablecida.",
  59: "Tiras LED de las luces de emergencia 24 V con fallas: riesgo de iluminación de emergencia deficiente ante corte de energía. Riesgo de seguridad. Mitigado con reemplazo por equipos de 24 V; iluminación de emergencia operativa.",
  60: "Válvula con pérdidas en el baño de marineros: riesgo de pérdida de agua y de afectación sanitaria. Riesgo ambiental/no operacional. Mitigado con cambio de la válvula de media vuelta; pérdida eliminada.",
  61: "Fallas en el motor fuera de borda de la lancha de trabajo N°1: riesgo de indisponibilidad del medio para tareas y respuesta. Riesgo operacional. Mitigado con recorrido al motor; propulsión de la lancha restablecida.",
  62: "Falla del monitor del sistema de seguridad/vigilancia en sala de control: pérdida de supervisión visual, con impacto acotado. Riesgo no operacional. Mitigado con reparación/cambio del monitor; supervisión restablecida.",
  63: "Dificultad para arriar la lancha por falla del malacate del pescante Br: riesgo de demora en el arriado/izado, afectando la operación y la respuesta ante emergencia. Riesgo operacional. Mitigado con cambio del malacate; maniobra de la lancha restablecida.",
  64: SUBACUA,
};

const pad4 = (n: number) => String(n).padStart(4, "0");

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} no encontrado`);
  const tenantId = tenant.id;

  const nums = Object.keys(RISK).map(Number).sort((a, b) => a - b);
  console.log(`\n===== UPDATE riskAnalysisResult SS DCH (${DRY ? "DRY-RUN" : "LIVE"}) =====`);
  console.log(`SS a actualizar: ${nums.length}`);

  let ok = 0, missing = 0;
  for (const n of nums) {
    const code = `SS-${VESSEL}-26-${pad4(n + 1)}`;
    const text = RISK[n];
    const wo = await prisma.workOrder.findFirst({
      where: { tenantId, vesselCode: VESSEL, workOrderCode: code },
      select: { id: true },
    });
    if (!wo) { console.error(`  !! No existe ${code}`); missing++; continue; }
    if (DRY) {
      if (n <= 3) console.log(`  ${code}: ${text.slice(0, 90)}…`);
      ok++;
      continue;
    }
    await prisma.workOrder.update({ where: { id: wo.id }, data: { riskAnalysisResult: text } });
    ok++;
    if (ok % 10 === 0 || n === nums[nums.length - 1]) console.log(`  [${ok}/${nums.length}] ${code} OK`);
  }

  console.log(`\n===== ${DRY ? "DRY-RUN" : "LISTO"}: ${ok} actualizadas${missing ? `, ${missing} faltantes` : ""} =====\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
