/**
 * Repasa TODOS los planes de un buque como si un administrador los abriera uno
 * por uno en pantalla, y en cada uno:
 *
 *   1. Origen del criterio  -> si esta vacio, "Estandar de la Compania"
 *                              (CriteriaSource.COMPANY_STANDARD). Si ya tiene
 *                              un origen declarado, NO se toca.
 *   2. Criterios de aceptacion -> boton "Sugerir con IA" (siempre, pisa lo que hay).
 *   3. Area                 -> si esta vacia, "Maquinas". Las que ya declaran
 *                              PROVEEDOR o CUBIERTA se respetan: sacarles el
 *                              area rompe la solicitud al proveedor y saca las
 *                              tareas de cubierta de su responsable real.
 *   4. Responsable          -> "Jefe de Maquinas" en los planes de Maquinas (y
 *                              en los que no declaraban area, que pasan a
 *                              Maquinas). Los de PROVEEDOR y CUBIERTA conservan
 *                              el suyo: las inspecciones de Clase las lleva el
 *                              Superintendente y las de cubierta el Capitan.
 *   5. Seguridad            -> boton "Sugerir con IA" de la seccion, que hace
 *                              todo junto: LOTO + permiso de trabajo, y con ese
 *                              LOTO el nivel de riesgo (matriz + analisis) y la
 *                              consecuencia RCM. Siempre, pisa lo que hay.
 *   6. Guardar.
 *
 * Opcional (por buque, se pide con una variable):
 *   SIN_TRABAJO_FRIO=1  no se marca el permiso "Trabajo en frio" (COLD_WORK)
 *                       aunque la IA lo sugiera. El resto de los permisos igual.
 *
 * Usa EXACTAMENTE los mismos servicios de IA que los botones del formulario
 * (`maintenance-plans-ai-suggestions` y `maintenance-plans-rcm-ai`) y encadena
 * las llamadas en el mismo orden que la pantalla: los criterios nuevos alimentan
 * el LOTO, y criterios + LOTO alimentan el analisis de riesgo.
 *
 * Antes de escribir nada guarda un backup JSON con el valor previo de todos los
 * campos que toca, para poder volver atras. Y va anotando los planes ya hechos
 * en un archivo de estado: si se corta, se vuelve a correr y sigue donde quedo.
 *
 * Uso:
 *   pnpm exec tsx --env-file .env scripts/update-vessel-plans-full.ts
 *   VESSEL=M01           buque (default M01 = MAO 01)
 *   TENANT_SLUG=mercurio empresa (default mercurio)
 *   DRY=1                solo lista que haria en cada plan, sin llamar a la IA
 *   LIMIT=3              corta despues de N planes (prueba)
 *   CONCURRENCY=4        planes en paralelo (default 4)
 *   OUT=/ruta            carpeta del backup y del estado (default ./_plan-update)
 */
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  suggestPlanAcceptanceCriteria,
  suggestPlanLoto,
  suggestPlanRisk,
} from "../apps/api/src/tenant/maintenance-plans/maintenance-plans-ai-suggestions";
import { suggestPlanConsequence } from "../apps/api/src/tenant/maintenance-plans/maintenance-plans-rcm-ai";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG        = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL      = process.env.VESSEL ?? "M01";
const DRY         = process.env.DRY === "1";
const LIMIT       = Number(process.env.LIMIT ?? 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? 4));
const OUT         = process.env.OUT ?? "./_plan-update";
const SIN_FRIO    = process.env.SIN_TRABAJO_FRIO === "1";

/** Lo que se completa cuando el campo esta vacio. */
const ORIGEN_POR_DEFECTO = "COMPANY_STANDARD";
const AREA_POR_DEFECTO   = "MAQUINAS";
const RESPONSABLE        = "Jefe de Máquinas";

const empty = (v: unknown) => !String(v ?? "").trim();

/**
 * Misma matriz que la UI, el PDF y el service (`deriveRiskLevelFromMatrix`):
 * el nivel sale de la celda probabilidad x consecuencia, no del nivel suelto
 * que devuelve la IA. Se replica porque en el service no esta exportada.
 */
const RISK_GRID: Record<string, Record<string, "LOW" | "MEDIUM" | "HIGH">> = {
  FATALITY:   { LIKELY: "HIGH",   PROBABLE: "HIGH",   UNLIKELY: "HIGH",   RARE: "MEDIUM" },
  MAJOR:      { LIKELY: "HIGH",   PROBABLE: "HIGH",   UNLIKELY: "MEDIUM", RARE: "MEDIUM" },
  MINOR:      { LIKELY: "HIGH",   PROBABLE: "MEDIUM", UNLIKELY: "MEDIUM", RARE: "LOW" },
  NEGLIGIBLE: { LIKELY: "MEDIUM", PROBABLE: "MEDIUM", UNLIKELY: "LOW",    RARE: "LOW" },
};
function deriveRiskLevel(prob: string | null, cons: string | null): string | null {
  if (!prob || !cons) return null;
  return RISK_GRID[cons]?.[prob] ?? null;
}

const CAMPOS_BACKUP = [
  "id", "taskCode", "title", "vesselCode",
  "criteriaSource", "acceptanceCriteria", "department", "responsible",
  "loto", "requiredPermitTypes",
  "riskLevel", "riskProbability", "riskConsequence", "riskAnalysisResult",
  "consequenceCategory", "consequenceRationale",
] as const;

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tenantId: string = tenant.id;

  const vessel = await prisma.vessel.findFirst({
    where: { tenantId, code: VESSEL }, select: { name: true },
  });
  if (!vessel) throw new Error(`Buque '${VESSEL}' no encontrado en '${SLUG}'.`);

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId, role: "TENANT_ADMIN" },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (!member?.userId) throw new Error(`No hay TENANT_ADMIN en '${SLUG}'.`);
  // Los servicios de IA piden una sesion para el tope de gasto y la telemetria
  // de uso. Se firma con el admin del tenant: es quien habria apretado el boton.
  const session = { tenantSlug: SLUG, user: { id: member.userId, email: member.user?.email ?? "" } } as any;

  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: VESSEL, deletedAt: null },
    select: {
      id: true, taskCode: true, title: true, description: true, vesselCode: true,
      taskType: true, assetId: true, sfiSubgroupCode: true, sfiGroupNumber: true,
      criteriaSource: true, acceptanceCriteria: true, department: true, responsible: true,
      loto: true, requiredPermitTypes: true,
      riskLevel: true, riskProbability: true, riskConsequence: true, riskAnalysisResult: true,
      consequenceCategory: true, consequenceRationale: true,
    },
    orderBy: [{ taskCode: "asc" }],
  });

  const assetIds = [...new Set(plans.map((p: any) => p.assetId))];
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } }, select: { id: true, name: true },
  });
  const assetMap = new Map<string, string>(assets.map((a: any) => [a.id, a.name ?? ""]));

  mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupFile = join(OUT, `backup-${SLUG}-${VESSEL}.json`);
  const stateFile  = join(OUT, `hechos-${SLUG}-${VESSEL}.txt`);
  const logFile    = join(OUT, `log-${SLUG}-${VESSEL}-${stamp}.txt`);

  const hechos = new Set<string>(
    existsSync(stateFile)
      ? readFileSync(stateFile, "utf8").split("\n").map(s => s.trim()).filter(Boolean)
      : [],
  );

  const pendientes = plans.filter((p: any) => !hechos.has(p.id));
  const targets = LIMIT > 0 ? pendientes.slice(0, LIMIT) : pendientes;

  const linea = (s: string) => { console.log(s); if (!DRY) appendFileSync(logFile, s + "\n"); };

  linea(`${DRY ? "SIMULACION · " : ""}${vessel.name} (${VESSEL}) · ${plans.length} planes · ` +
    `${hechos.size} ya hechos · ${targets.length} a procesar ahora\n`);

  if (DRY) {
    let nOrigen = 0, nArea = 0, nResp = 0;
    for (const p of targets) {
      const areaFinal = p.department ?? AREA_POR_DEFECTO;
      const cambiaResp = areaFinal === AREA_POR_DEFECTO && String(p.responsible ?? "").trim() !== RESPONSABLE;
      const acciones = [
        empty(p.criteriaSource) ? "origen→Estándar de la Compañía" : null,
        "criterios(IA)",
        p.department === null ? "área→Máquinas" : `área=${p.department} (se respeta)`,
        cambiaResp ? `responsable: "${p.responsible ?? "—"}"→"${RESPONSABLE}"` : `responsable=${p.responsible ?? "—"} (se respeta)`,
        "seguridad(IA)",
      ].filter(Boolean).join(" · ");
      if (empty(p.criteriaSource)) nOrigen++;
      if (p.department === null) nArea++;
      if (cambiaResp) nResp++;
      linea(`  ${String(p.taskCode).padEnd(18)} ${String(p.title).slice(0, 44).padEnd(46)} ${acciones}`);
    }
    linea(`\nResumen: ${nOrigen} orígenes a completar · ${nArea} áreas a completar · ` +
      `${nResp} responsables a corregir · ${targets.length} planes con IA (criterios + seguridad)`);
    linea(`Llamadas de IA estimadas: ${targets.length * 4}`);
    await prisma.$disconnect();
    return;
  }

  // Backup del estado previo de TODOS los planes del buque (no solo los
  // pendientes): es la foto para volver atras si algo sale mal.
  const backup = plans.map((p: any) =>
    Object.fromEntries(CAMPOS_BACKUP.map(k => [k, p[k] ?? null])));
  writeFileSync(backupFile, JSON.stringify(backup, null, 2), "utf8");
  linea(`Backup previo: ${backupFile} (${backup.length} planes)\n`);

  let ok = 0, fail = 0;
  const errores: string[] = [];

  async function run(p: any) {
    const assetLabel = assetMap.get(p.assetId) ?? "equipo";
    const taskDesc = [p.title, p.description].filter(Boolean).join(" — ");
    const taskType = p.taskType === "INSPECTION" ? "INSPECTION" : "MAINTENANCE";
    const data: Record<string, unknown> = {};

    try {
      // 1. Origen del criterio: solo si falta.
      if (empty(p.criteriaSource)) data.criteriaSource = ORIGEN_POR_DEFECTO;

      // 2. Criterios de aceptacion: boton de IA (siempre).
      const criterios = (await suggestPlanAcceptanceCriteria(session, {
        assetLabel, taskDesc, taskType, vesselCode: p.vesselCode,
      })).text;
      if (!empty(criterios)) data.acceptanceCriteria = criterios;

      // 3. Area: solo si falta. PROVEEDOR y CUBIERTA se respetan.
      if (p.department === null) data.department = AREA_POR_DEFECTO;

      // 4. Responsable: solo en los planes de Maquinas (incluidos los que
      //    acaban de pasar a Maquinas por no tener area declarada).
      const areaFinal = (data.department as string) ?? p.department;
      if (areaFinal === AREA_POR_DEFECTO && String(p.responsible ?? "").trim() !== RESPONSABLE) {
        data.responsible = RESPONSABLE;
      }

      // 5. Seguridad: el boton hace LOTO + permiso, y con ese LOTO el riesgo;
      //    el RCM no depende del LOTO y va en paralelo (igual que la pantalla).
      const criteriosParaIa = (data.acceptanceCriteria as string) ?? p.acceptanceCriteria ?? null;
      const lotoRes = await suggestPlanLoto(session, {
        assetLabel, taskDesc, taskType, acceptanceCriteria: criteriosParaIa, vesselCode: p.vesselCode,
      });
      if (!empty(lotoRes.text)) data.loto = lotoRes.text;
      // Mismo criterio que el formulario: si la IA dice que hace falta permiso y
      // nombra tipos validos, quedan tildados; si dice que no, se apagan.
      // Con SIN_TRABAJO_FRIO=1 se descarta COLD_WORK de la lista: si era el
      // unico, el plan queda sin permiso exigido.
      const tipos = lotoRes.permitRequired ? lotoRes.permitTypes : [];
      data.requiredPermitTypes = SIN_FRIO ? tipos.filter(t => t !== "COLD_WORK") : tipos;

      const [risk, rcm] = await Promise.all([
        suggestPlanRisk(session, {
          assetLabel, taskDesc, taskType,
          acceptanceCriteria: criteriosParaIa,
          loto: (data.loto as string) ?? p.loto ?? null,
          vesselCode: p.vesselCode,
        }),
        suggestPlanConsequence(session, {
          assetName: assetLabel,
          vesselCode: p.vesselCode,
          assetSfiCode: p.sfiSubgroupCode ?? (p.sfiGroupNumber != null ? `${p.sfiGroupNumber}00` : null),
          planTitle: p.title,
          planDescription: p.description,
          taskType,
        }),
      ]);

      // El nivel sale de la celda de la matriz cuando la IA devolvio los dos
      // ejes (misma fuente de verdad que el click manual); si no, el suelto.
      const derivado = deriveRiskLevel(risk.probability, risk.consequence);
      data.riskProbability     = risk.probability;
      data.riskConsequence     = risk.consequence;
      data.riskLevel           = derivado ?? risk.level;
      data.riskAnalysisResult  = risk.analysis;
      data.consequenceCategory = rcm.category;
      data.consequenceRationale = rcm.rationale;

      // 6. Guardar.
      data.updatedByUserId = member!.userId;
      await prisma.maintenancePlan.update({ where: { id: p.id }, data });
      appendFileSync(stateFile, p.id + "\n");
      ok++;
      linea(`  OK    ${String(p.taskCode).padEnd(18)} ${String(p.title).slice(0, 40).padEnd(42)} ` +
        `riesgo=${data.riskLevel} rcm=${rcm.category}` +
        (data.criteriaSource ? " +origen" : "") +
        (data.department ? " +área" : "") +
        (data.responsible ? " +responsable" : "") +
        ((data.requiredPermitTypes as string[]).length ? ` permiso=${(data.requiredPermitTypes as string[]).join("/")}` : ""));
    } catch (err) {
      fail++;
      const msg = err instanceof Error ? err.message : String(err);
      errores.push(`${p.taskCode}: ${msg}`);
      linea(`  FALLA ${String(p.taskCode).padEnd(18)} ${msg}`);
    }
  }

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    await Promise.all(targets.slice(i, i + CONCURRENCY).map(run));
  }

  linea(`\nActualizados: ${ok} · Fallados: ${fail}`);
  if (errores.length) linea(errores.map(e => `  - ${e}`).join("\n"));
  linea(`Backup: ${backupFile} · Estado: ${stateFile} · Log: ${logFile}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
