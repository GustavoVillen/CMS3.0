/**
 * Da de alta (o actualiza) el plan de AUDITORIA DE INGENIERIA DEL SUPERINTENDENTE
 * en cada buque de la flota.
 *
 * Por que existe: TMSA pide auditorias integrales de ingenieria a cargo de un
 * representante de la compania debidamente calificado y con experiencia, que
 * incluyan la observacion de las practicas de ingenieria DURANTE LA NAVEGACION.
 * El sistema no las tenia como tarea programada: no habia plan, no habia
 * vencimiento y no habia guia de que se observa.
 *
 * Como queda armado (respeta la decision de 2026-08-28 de llevar las
 * inspecciones como OT + lista de chequeo, ver comentario "DORMANTE" en
 * apps/web-modern/src/pages/Inspections.tsx):
 *
 *   plan `<BUQUE>-AUD-ING-01`  →  cada 6 meses (2 veces al ano)
 *   taskType INSPECTION        →  la OT sale tipo INSPECCION
 *   triggerResultMode AUTO_WO  →  la OT se abre sola al vencer
 *   description                →  los 12 puntos de la guia de observacion
 *
 * El superintendente carga los hallazgos en la OT (observaciones + resultado),
 * marca la CONDICION en "En navegacion" y firma. Cada desvio se abre como
 * Defecto desde la misma OT, que es el camino que ya usa el resto del sistema.
 *
 * La guia es una BASE: cuando aparezca la planilla REGI-OPE-19.2 se ajusta el
 * texto (o se cuelga el archivo en `checklistTemplate` del plan).
 *
 * Idempotente: se puede correr las veces que haga falta. Si el plan ya existe,
 * actualiza titulo, guia, frecuencia y responsable, y NO toca fechas de
 * ejecucion ni de vencimiento (para no pisar historial ya cargado).
 *
 * Uso:
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/load-superintendent-audit-plan.ts            # previsualiza toda la flota
 *   npx tsx scripts/load-superintendent-audit-plan.ts --buque=DCH      # un solo buque
 *   npx tsx scripts/load-superintendent-audit-plan.ts --tenant=mercurio
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const arg = (name: string): string | null => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=").trim() : null;
};
const TENANT_SLUG = arg("tenant") ?? "mercurio";
const ONLY_VESSEL = arg("buque")?.toUpperCase() ?? null;

/** Sufijo del taskCode. El prefijo es el codigo del buque. */
const CODE_SUFFIX = "AUD-ING-01";
const TITLE = "Auditoría de ingeniería del superintendente";
const FREQUENCY_MONTHS = 6; // 2 auditorías al año

/**
 * Activo del que cuelga la auditoría: la sala de máquinas como conjunto, no un
 * equipo puntual. Es el mismo "Equipos de Máquinas en General" que ya usan las
 * SS y las rutinas consolidadas en LTE / DCH / M01.
 */
const GENERAL_ASSET_SUFFIX = "-6-ED-001";
const GENERAL_ASSET_NAME_RX = /equipos?\s+de\s+m[aá]quinas\s+en\s+general/i;

/**
 * GUIA BASE — observación de prácticas de ingeniería.
 *
 * No es un checklist de estado de equipos (eso ya lo cubre el plan de
 * mantenimiento): es qué mira el superintendente sobre CÓMO se trabaja a bordo.
 * Se guarda en `description` para que salga impreso en la OT.
 */
const GUIA: string[] = [
  "Rondas de máquinas: se hacen en el horario previsto, se registran las lecturas y se levantan las anomalías.",
  "Entrega y recepción de guardia de máquinas: qué se transmite, cómo queda asentado y quién firma.",
  "Permisos de trabajo y aislamientos (LOTO) en uso real: se emiten antes de empezar, se respetan y se cierran.",
  "Orden, limpieza y control de fugas en sala de máquinas, sentinas y pañoles.",
  "Uso de herramientas e instrumentos: los de medición tienen calibración vigente y se usan según el manual.",
  "Manejo de repuestos críticos: stock físico contra el sistema, identificación, estiba y consumo registrado.",
  "Registro efectivo en el PMS: OT cerradas con resultado y observaciones, horas de equipos al día.",
  "Equipos críticos: se prueban con la frecuencia establecida y queda evidencia de la prueba.",
  "Defectos y postergaciones: se reportan al detectarlos, con riesgo evaluado y seguimiento hasta el cierre.",
  "Toma de muestras y análisis de fluidos: se toman en el punto y momento correctos, y se actúa sobre el resultado.",
  "Familiarización y competencia del personal de máquinas para los equipos que opera.",
  "Seguridad en sala de máquinas: EPP, protecciones, señalización, vías de escape y medios contra incendio.",
];

const ACCEPTANCE = [
  "Se observa la práctica en marcha, no sólo el registro escrito.",
  "Cada punto se califica como conforme o no conforme; el no conforme se describe con hecho, lugar y fecha.",
  "Todo hallazgo no conforme se abre como Defecto desde esta misma OT.",
  "Al menos una de las dos auditorías anuales se hace con el buque EN NAVEGACIÓN (campo Condición de la OT).",
  "La OT la firma el representante de la compañía, con su calificación cargada en el sistema.",
].join("\n");

const DESCRIPTION = [
  "Auditoría integral de ingeniería a cargo del representante de la compañía (superintendente),",
  "con observación de las prácticas de ingeniería a bordo. Se hace 2 veces al año y al menos una",
  "de ellas durante la navegación.",
  "",
  "PUNTOS A OBSERVAR:",
  ...GUIA.map((g, i) => `${String(i + 1).padStart(2, "0")}. ${g}`),
].join("\n");

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`No existe el tenant "${TENANT_SLUG}".`);
  const tenantId: string = tenant.id;

  // Autor de la carga: el primer TENANT_ADMIN activo. El plan queda a nombre de
  // alguien real para no romper la trazabilidad de quién lo dio de alta.
  const admin = await prisma.tenantMembership.findFirst({
    where: { tenantId, role: "TENANT_ADMIN", status: "ACTIVE" },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) throw new Error(`El tenant "${TENANT_SLUG}" no tiene un TENANT_ADMIN activo.`);
  const userId: string = admin.user.id;

  const vessels = await prisma.vessel.findMany({
    where: { tenantId, status: "ACTIVE", ...(ONLY_VESSEL ? { code: ONLY_VESSEL } : {}) },
    select: { code: true, name: true, vesselType: true },
    orderBy: { code: "asc" },
  });
  if (vessels.length === 0) throw new Error("No hay buques activos que coincidan.");

  const creates: any[] = [];
  const updates: Array<{ id: string; taskCode: string; vessel: string; data: any }> = [];
  const skipped: Array<{ vessel: string; motivo: string }> = [];
  const recodificados: Array<{ vessel: string; de: string; a: string }> = [];

  for (const v of vessels) {
    // Activo de la sala de máquinas como conjunto. Primero por código (el
    // patrón que ya usa la flota), después por nombre para los buques que lo
    // tengan con otro código.
    const assets = await prisma.asset.findMany({
      where: { tenantId, vesselCode: v.code, deletedAt: null },
      select: { id: true, assetCode: true, name: true },
    });
    const asset =
      assets.find((a: any) => a.assetCode === `${v.code}${GENERAL_ASSET_SUFFIX}`) ??
      assets.find((a: any) => GENERAL_ASSET_NAME_RX.test(a.name ?? ""));
    if (!asset) {
      // Sin sala de máquinas como conjunto no hay prácticas de ingeniería que
      // observar: en la práctica son las barcazas, que no llevan tripulación
      // de máquinas. Se listan al final para que quede a la vista.
      skipped.push({ vessel: v.code, motivo: v.vesselType ?? "sin tipo" });
      continue;
    }

    // Campos que el script gobierna. Fechas de ejecución/vencimiento NO se
    // tocan: si el plan ya corrió, su historial manda.
    const data = {
      title: TITLE,
      description: DESCRIPTION,
      acceptanceCriteria: ACCEPTANCE,
      triggerType: "MONTHS",
      frequencyMonths: FREQUENCY_MONTHS,
      frequencyHours: null,
      taskType: "INSPECTION",
      triggerResultMode: "AUTO_WO",
      department: "MAQUINAS",
      responsible: "Superintendente",
      status: "ACTIVE",
      updatedByUserId: userId,
    };

    const existing = await prisma.maintenancePlan.findFirst({
      where: { tenantId, vesselCode: v.code, assetId: asset.id, taskCode: { startsWith: `${v.code}-AUD-ING` }, deletedAt: null },
      select: { id: true, taskCode: true },
    });
    if (existing) {
      updates.push({ id: existing.id, taskCode: existing.taskCode, vessel: v.code, data });
      continue;
    }

    // El unique de MaintenancePlan es (tenantId, vesselCode, taskCode) y NO
    // excluye deletedAt: un plan dado de baja sigue reservando su código. Se
    // corre el sufijo hasta uno libre (misma trampa que documenta CONTEXTO.md).
    const tomados = new Set<string>(
      (await prisma.maintenancePlan.findMany({
        where: { tenantId, vesselCode: v.code, taskCode: { startsWith: `${v.code}-AUD-ING` } },
        select: { taskCode: true },
      })).map((p: any) => p.taskCode),
    );
    let taskCode = `${v.code}-${CODE_SUFFIX}`;
    let n = 1;
    while (tomados.has(taskCode)) {
      n += 1;
      taskCode = `${v.code}-AUD-ING-${String(n).padStart(2, "0")}`;
    }
    if (taskCode !== `${v.code}-${CODE_SUFFIX}`) {
      recodificados.push({ vessel: v.code, de: `${v.code}-${CODE_SUFFIX}`, a: taskCode });
    }

    creates.push({
      ...data,
      tenantId,
      vesselCode: v.code,
      assetId: asset.id,
      taskCode,
      createdByUserId: userId,
    });
  }

  // ── Informe ────────────────────────────────────────────────────────────────
  console.log(`── Auditoría de ingeniería del superintendente · tenant ${TENANT_SLUG} ──`);
  console.log(`Autor de la carga: ${admin.user.firstName ?? ""} ${admin.user.lastName ?? ""}`.trim());
  console.log(`Buques evaluados ${vessels.length} · crea ${creates.length} · actualiza ${updates.length} · sin activo ${skipped.length}\n`);

  if (creates.length) {
    console.log("NUEVOS");
    for (const c of creates) console.log(`  ${c.taskCode.padEnd(18)} cada ${FREQUENCY_MONTHS} meses  ${c.title}`);
    console.log("");
  }
  if (updates.length) {
    console.log("YA EXISTÍAN (se actualiza guía, frecuencia y responsable; no se tocan las fechas)");
    for (const u of updates) console.log(`  ${u.taskCode}`);
    console.log("");
  }
  if (recodificados.length) {
    console.log("CÓDIGOS CORRIDOS (el original lo reservaba un plan dado de baja)");
    for (const r of recodificados) console.log(`  ${r.de} → ${r.a}`);
    console.log("");
  }
  if (skipped.length) {
    console.log(`SIN SALA DE MÁQUINAS — no se les crea plan (falta "<BUQUE>${GENERAL_ASSET_SUFFIX}")`);
    const porTipo = new Map<string, string[]>();
    for (const s of skipped) {
      const arr = porTipo.get(s.motivo) ?? [];
      arr.push(s.vessel);
      porTipo.set(s.motivo, arr);
    }
    for (const [tipo, codes] of porTipo) console.log(`  ${tipo} (${codes.length}): ${codes.join(", ")}`);
    console.log("");
  }

  if (DRY) {
    console.log("[DRY] No se escribió nada.");
    return;
  }

  for (const u of updates) await prisma.maintenancePlan.update({ where: { id: u.id }, data: u.data });
  const nNew = creates.length ? (await prisma.maintenancePlan.createMany({ data: creates })).count : 0;
  console.log(`Listo: ${nNew} creados, ${updates.length} actualizados.`);
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
