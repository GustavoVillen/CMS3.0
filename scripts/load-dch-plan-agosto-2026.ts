/**
 * DON CHICUETO — cierre de brechas contra las planillas de AGOSTO 2026
 * (`MisDocs/DCH/Mantenimiento/Aug 2026/08- PMP DON CHICUETO - AGOSTO.xlsm`).
 *
 * Del cotejo planilla ↔ sistema (368 tareas de papel contra 562 planes cargados)
 * quedaron cuatro renglones de la planilla sin plan propio, y cinco equipos
 * críticos de seguridad sin ningún plan (no figuran en la planilla de máquinas
 * porque son de cubierta, pero cuentan como brecha de cobertura ISM 10.1).
 *
 * Hace tres cosas:
 *   1. Crea los 4 planes que faltaban de la planilla.
 *   2. Ajusta DCH-MBBA-PORT-02 de 6 a 12 meses (decisión del armador: el plan
 *      del buque manda sobre el intervalo que traía el manual).
 *   3. Crea 5 planes para los equipos sin cobertura.
 *
 * Los campos de HSE/RCM (criterios de aceptación, LOTO, riesgo, consecuencia)
 * quedan vacíos a propósito: los completa después `fill-plan-hse-rcm.ts` con la
 * misma IA que los botones de varita del formulario.
 *
 * Uso:
 *   pnpm exec tsx --env-file .env scripts/load-dch-plan-agosto-2026.ts
 *   DRY=1 ...   muestra lo que haría, sin escribir
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = "DCH";
const DRY = process.env.DRY === "1";

const d = (s: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

type Spec = {
  asset: string;
  code: string;
  title: string;
  description: string;
  taskType: "MAINTENANCE" | "INSPECTION";
  frequencyMonths: number;
  lastExecutionDate: string | null;
  nextDueDate: string;
  origen: string;
};

/** Los 4 renglones de la planilla de agosto que no tenían plan propio. */
const PLANILLA: Spec[] = [
  {
    asset: "DCH-HID-GOB",
    code: "31",
    title: "SISTEMA DE GOBIERNO DE EMERGENCIA: Prueba de funcionamiento",
    description: "[  ] Prueba de funcionamiento del sistema de gobierno de emergencia",
    taskType: "INSPECTION",
    frequencyMonths: 1,
    lastExecutionDate: "2026-07-24",
    nextDueDate: "2026-08-24",
    origen: "EQUIPOS CRITICOS f.4",
  },
  {
    asset: "DCH-HID-GOB",
    code: "32",
    title: "ENGRASE TIMON: Engrasar cañas y mechas registrar novedades",
    description: "[  ] Engrasar cañas y mechas registrar novedades",
    taskType: "MAINTENANCE",
    frequencyMonths: 1,
    lastExecutionDate: "2026-08-29",
    nextDueDate: "2026-09-29",
    origen: "ENGRASE f.5",
  },
  {
    asset: "DCH-6-ED-001",
    code: "35",
    title: "ENGRASE SALA MAQUINAS: Engrasar cojinetes de apoyo, prensa ejes helice. Rodamiento popa caja",
    description: "[  ] Engrasar cojinetes de apoyo, prensa ejes hélice. Rodamiento popa caja",
    taskType: "MAINTENANCE",
    frequencyMonths: 1,
    lastExecutionDate: "2026-08-29",
    nextDueDate: "2026-09-29",
    origen: "ENGRASE f.7",
  },
  {
    asset: "DCH-MBBA-PORT",
    code: "32",
    title: "MOTOBOMBA INCENDIO EMERGENCIA: Bomba – recorrido general. (eje, impulsor, voluta, sello mecanico)",
    description: "[  ] Bomba – recorrido general (eje, impulsor, voluta, sello mecánico)",
    taskType: "MAINTENANCE",
    frequencyMonths: 72,
    lastExecutionDate: "2024-11-19",
    nextDueDate: "2030-11-19",
    origen: "BOMBAS f.72 · 6 años / dique seco",
  },
];

/** Equipos críticos de seguridad que no tenían ningún plan. */
const COBERTURA: Spec[] = [
  {
    asset: "DCH-3-BS-001",
    code: "01",
    title: "Servicio anual en estación de servicio autorizada",
    description:
      "[  ] Desembarcar la balsa y enviarla a estación de servicio autorizada\n" +
      "[  ] Inflado y prueba de presión, revisión de equipamiento y vencimientos del pack\n" +
      "[  ] Control del zafarrancho hidrostático y del cabo de disparo\n" +
      "[  ] Reembarcar, trincar y archivar el certificado de servicio",
    taskType: "INSPECTION",
    frequencyMonths: 12,
    lastExecutionDate: "2025-08-22",
    nextDueDate: "2026-08-22",
    origen: "SOLAS III/20 · fecha tomada de CERT-DCH-015",
  },
  {
    asset: "DCH-3-EP-001",
    code: "01",
    title: "Servicio anual de extintores en estación autorizada",
    description:
      "[  ] Control de carga, presión y precintos de cada extintor\n" +
      "[  ] Prueba hidráulica y recarga según corresponda al tipo y antigüedad\n" +
      "[  ] Verificar señalización, soportes y accesibilidad en cada puesto\n" +
      "[  ] Archivar el certificado y actualizar la planilla de ubicación",
    taskType: "INSPECTION",
    frequencyMonths: 12,
    lastExecutionDate: "2025-10-18",
    nextDueDate: "2026-10-18",
    origen: "SOLAS II-2 · fecha tomada de CERT-DCH-049",
  },
  {
    asset: "DCH-INTERCOM",
    code: "01",
    title: "Prueba mensual de funcionamiento",
    description:
      "[  ] Probar comunicación en ambos sentidos desde cada puesto\n" +
      "[  ] Verificar nivel de audio y ausencia de ruido en la línea\n" +
      "[  ] Controlar estado de cables, conectores y alimentación",
    taskType: "INSPECTION",
    frequencyMonths: 1,
    lastExecutionDate: null,
    nextDueDate: "2026-09-30",
    origen: "ISM 10.3 · equipo sin plan",
  },
  {
    asset: "DCH-TEL",
    code: "01",
    title: "Prueba mensual de funcionamiento",
    description:
      "[  ] Probar llamada y comunicación puente ↔ consola de máquinas\n" +
      "[  ] Verificar audio y señal de llamada en ambos extremos\n" +
      "[  ] Controlar estado de cables, conectores y alimentación",
    taskType: "INSPECTION",
    frequencyMonths: 1,
    lastExecutionDate: null,
    nextDueDate: "2026-09-30",
    origen: "ISM 10.3 · equipo sin plan",
  },
  {
    asset: "DCH-TORRE",
    code: "01",
    title: "Prueba mensual de funcionamiento",
    description:
      "[  ] Encender y verificar cada luz de la torre de señales\n" +
      "[  ] Reemplazar lámparas quemadas y controlar repuestos a bordo\n" +
      "[  ] Controlar estado de portalámparas, cableado y estanqueidad",
    taskType: "INSPECTION",
    frequencyMonths: 1,
    lastExecutionDate: null,
    nextDueDate: "2026-09-30",
    origen: "COLREG · equipo sin plan",
  },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant ${SLUG} no encontrado.`);
  const tenantId: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId, role: "TENANT_ADMIN" },
    select: { userId: true },
  });
  if (!member?.userId) throw new Error(`No hay TENANT_ADMIN en ${SLUG}.`);
  const userId: string = member.userId;

  const specs = [...PLANILLA, ...COBERTURA];
  const assetCodes = [...new Set(specs.map(s => s.asset))];
  const assets = await prisma.asset.findMany({
    where: { tenantId, vesselCode: VESSEL, assetCode: { in: assetCodes } },
    select: { id: true, assetCode: true, name: true, sfiCode: true },
  });
  const byCode = new Map<string, any>(assets.map((a: any) => [a.assetCode, a]));
  for (const c of assetCodes) if (!byCode.has(c)) throw new Error(`Equipo ${c} no existe en ${VESSEL}.`);

  // Códigos ya usados, incluidos los de planes borrados: taskCode es único por
  // tenant+buque y un plan con deletedAt sigue ocupando el suyo.
  const usados = new Set<string>(
    (await prisma.maintenancePlan.findMany({
      where: { tenantId, vesselCode: VESSEL },
      select: { taskCode: true },
    })).map((p: any) => p.taskCode),
  );

  const creates: any[] = [];
  for (const s of specs) {
    const asset = byCode.get(s.asset);
    const taskCode = `${s.asset}-${s.code}`;
    if (usados.has(taskCode)) throw new Error(`El código ${taskCode} ya está tomado.`);
    usados.add(taskCode);
    creates.push({
      tenantId,
      vesselCode: VESSEL,
      assetId: asset.id,
      taskCode,
      title: s.title,
      description: s.description,
      triggerType: "MONTHS",
      frequencyMonths: s.frequencyMonths,
      frequencyHours: null,
      taskType: s.taskType,
      department: "MAQUINAS",
      responsible: "Jefe de Máquinas",
      sfiGroupNumber: asset.sfiCode ? Number(String(asset.sfiCode)[0]) : null,
      criteriaSource: "COMPANY_STANDARD",
      triggerResultMode: "AUTO_WO",
      status: "ACTIVE",
      lastExecutionDate: d(s.lastExecutionDate),
      nextDueDate: d(s.nextDueDate),
      createdByUserId: userId,
      updatedByUserId: userId,
    });
  }

  // Cambio de frecuencia de la motobomba: 6 → 12 meses, con el próximo
  // vencimiento recalculado sobre la última ejecución real.
  const mbba = await prisma.maintenancePlan.findFirst({
    where: { tenantId, vesselCode: VESSEL, taskCode: "DCH-MBBA-PORT-02" },
  });
  if (!mbba) throw new Error("No se encontró DCH-MBBA-PORT-02.");

  console.log("── DON CHICUETO · planillas de agosto 2026 ──");
  console.log(`\nCREA ${creates.length} planes:`);
  for (const s of specs) {
    const freq =
      s.frequencyMonths === 1 ? "mensual" : s.frequencyMonths === 12 ? "anual" : `cada ${s.frequencyMonths} meses`;
    console.log(`  ${s.asset}-${s.code}  ${freq.padEnd(16)} ${s.title.slice(0, 72)}`);
    console.log(
      `      ${byCode.get(s.asset).name} · ${s.origen} · último ${s.lastExecutionDate ?? "s/d"} · próximo ${s.nextDueDate}`,
    );
  }
  console.log("\nCORRIGE 1 plan:");
  console.log(
    `  DCH-MBBA-PORT-02  ${mbba.frequencyMonths} → 12 meses · próximo ${String(mbba.nextDueDate).slice(0, 10)} → 2026-11-10`,
  );

  if (DRY) {
    console.log("\n[DRY] No se escribió nada.");
    return;
  }

  const backup = "scripts/_tmp-backup-dch-mbba-port-02.json";
  writeFileSync(backup, JSON.stringify(mbba, null, 2), "utf8");

  const nNew = (await prisma.maintenancePlan.createMany({ data: creates })).count;
  await prisma.maintenancePlan.update({
    where: { id: mbba.id },
    data: { frequencyMonths: 12, nextDueDate: d("2026-11-10"), updatedByUserId: userId },
  });

  console.log(`\nOK — ${nNew} planes creados, 1 corregido.`);
  console.log(`Respaldo del plan corregido: ${backup}`);
}

main()
  .catch(e => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
