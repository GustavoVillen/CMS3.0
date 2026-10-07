/**
 * Alinea los planes de mantenimiento de las barcazas con el REGI-MAN-02.2 rev. 3
 * (planillas de MisDocs/Barcazas/Planes Mantenimiento Excel). El Excel manda.
 *
 * Un plan por ítem de la planilla. Por cada barcaza:
 *   - Los planes que hoy cubren un ítem se CORRIGEN EN EL LUGAR (título, checklist,
 *     frecuencia, equipo, área): conservan código, última ejecución y OT.
 *     Si varios planes viejos cubren el mismo ítem, queda uno (el que tiene OT
 *     abiertas / más OT / ejecución más reciente) y el resto se da de baja.
 *   - Los ítems que no tienen plan se crean, heredando la última ejecución del
 *     plan viejo que los incluía (p. ej. el "Mantenimiento ANUAL - MOTOR y BOMBA"
 *     se abre en motor, bomba, arranque, cardanes y escape).
 *   - Las inspecciones de clase y la de integridad estructural NO se tocan
 *     (sus fechas vienen del Ship Status).
 *   - Un plan viejo que no corresponde a ningún ítem se da de baja (soft delete).
 *     Nunca se da de baja un plan con OT abierta: se informa y queda como está.
 *
 * Usa los services del sistema (mismas validaciones y recálculo de vencimiento
 * que la pantalla), con una sesión de administrador armada en proceso.
 *
 * Uso:
 *   SPEC=excel-spec.json ACTOR=<userId admin> DRY=1 npx tsx --env-file=.env scripts/sync-barcazas-plans-excel.ts
 *   VESSELS=MGT01,MGT02   limitar a algunas barcazas
 *   BACKUP=<archivo>      copia JSON de los planes antes de tocarlos (obligatorio sin DRY)
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { TenantAccessSession } from "../apps/api/src/tenant/auth/session-store";
import { getPrismaClient } from "../apps/api/src/platform/data/prisma-client";
import {
  createTenantMaintenancePlan,
  updateTenantMaintenancePlan,
  deleteTenantMaintenancePlan,
} from "../apps/api/src/tenant/maintenance-plans/maintenance-plans-service";

type Item = { item: string; key: string; title: string; freqMonths: number; department: string | null; lines: string[] };
type Family = { vessels: string[]; motor: string; source: string; items: Item[] };

const DRY = process.env.DRY === "1";
const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const SPEC: Record<string, Family> = JSON.parse(readFileSync(process.env.SPEC ?? "excel-spec.json", "utf8"));
const ONLY = (process.env.VESSELS ?? "").split(",").map(s => s.trim()).filter(Boolean);
const ACTOR = process.env.ACTOR ?? "";
if (!ACTOR) throw new Error("Falta ACTOR (id del usuario administrador).");
if (!DRY && !process.env.BACKUP) throw new Error("Sin DRY hace falta BACKUP=<archivo>.");

// Planes que no se tocan: inspecciones de clase e integridad estructural.
const KEEP = /de clase|integridad estructural/i;

// Plan viejo -> ítems que cubre. El primero es el que puede corregir en el lugar;
// los demás sólo le heredan la última ejecución si hay que crearlos.
const MAP: Array<[RegExp, string[]]> = [
  [/^Inspecciones y Pruebas TRIMESTRALES$/i, ["TRIM_MOTOR", "TRIM_LCI", "TRIM_ALARMAS"]],
  [/TRIMESTRALES.*(motor|bomba)/i, ["TRIM_MOTOR"]],
  [/TRIMESTRALES.*(LCI|incendio)/i, ["TRIM_LCI"]],
  [/trimestral.*alarmas/i, ["TRIM_ALARMAS"]],
  [/Parada de Emergencia/i, ["TRIM_MOTOR"]],
  [/^MPT-Trimestral/i, ["TRIM_LCI", "TRIM_ALARMAS", "TRIM_MOTOR"]],
  [/SEMESTRALES|ANALISIS DE LUBRICANTE|^MPS-Semestral/i, ["SEM_MUESTREO"]],
  [/Válvulas P\/V: Prueba Neumática|Prueba Hidráulica ANUAL|Certificado ANUAL de Manómetros|^MPA-Anual de equipos sobre cubierta/i, ["ANU_PRUEBAS"]],
  [/Inspeccion ANUAL del Sistema Electrico|Alarmas de Nivel: Recorrido ANUAL|^MPA-Anual de alarmas/i, ["ANU_ELECTRICA"]],
  [/^Inspecciones y Pruebas ANUALES$/i, ["ANU_RECORRIDO", "ANU_PASO_HOMBRE"]],
  [/PASO DE HOMBRE|^MPA-Anual de válvulas esclusas/i, ["ANU_PASO_HOMBRE"]],
  [/Alarmas de Nivel: Reemplazo de Baterias/i, ["BI_BATERIAS"]],
  [/Mantenimiento ANUAL - MOTOR|SERVICE: Cambio de Aceite/i, ["ANU_MOTOR", "ANU_BOMBA", "ANU_ARRANQUE", "ANU_CARDAN", "BI_ESCAPE"]],
  [/^SERVICIO Motor/i, ["ANU_MOTOR"]],
  [/^MPA-Anual de bomba de descarga/i, ["ANU_BOMBA"]],
  [/Sistema de Arranque Anual/i, ["ANU_ARRANQUE"]],
  [/Bi Anual de motor diesel - Sistema de Escape/i, ["BI_ESCAPE"]],
  [/Mantenimiento del Motor CADA 4 AÑOS/i, ["4A_MOTOR"]],
  [/DIQUE SECO: Recorrido completo MOTOR Y BOMBA/i, ["8A_MOTOR", "8A_BOMBA"]],
  [/DIQUE SECO: (Recorrido completo BOMBA|Mantenimiento de sistema de transmision|Mantenimiento general de sistema de arranque)/i, ["8A_BOMBA"]],
  [/DIQUE SECO: Desarme y Prueba Hidraulica/i, ["8A_VALVULAS"]],
  [/Medicion de Espesores por Ultrasonido/i, ["8A_CASCO"]],
  [/TANQUES DE CARGA CADA 4 AÑOS/i, ["4A_TANQUES"]],
];

// Equipo de cada ítem (sufijo del assetCode; GENERIC = "Inspecciones y Pruebas de Sistemas").
const ASSET: Record<string, string> = {
  TRIM_LCI: "INCENDIO", TRIM_MOTOR: "MOTOR", TRIM_ALARMAS: "MEDICION", SEM_MUESTREO: "MOTOR",
  ANU_PRUEBAS: "GENERIC", ANU_ELECTRICA: "ELECTRICO", ANU_PASO_HOMBRE: "CASCO", ANU_RECORRIDO: "CASCO",
  ANU_BOMBA: "BOMBA", ANU_MOTOR: "MOTOR", ANU_CARDAN: "MOTOR", ANU_ARRANQUE: "MOTOR", BI_ESCAPE: "MOTOR",
  BI_BATERIAS: "MEDICION", "4A_MOTOR": "MOTOR", "4A_TANQUES": "CASCO", "8A_MOTOR": "MOTOR",
  "8A_BOMBA": "BOMBA", "8A_VALVULAS": "CARGAMENTO", "8A_CASCO": "CASCO", "8A_COMPRESORES": "MOTOR",
};
const SFI: Record<string, number> = { MOTOR: 2, BOMBA: 2, CASCO: 1, CARGAMENTO: 3, GENERIC: 3, INCENDIO: 7, ELECTRICO: 8, MEDICION: 9 };
const INSPECTION_KEYS = new Set(["TRIM_LCI", "TRIM_MOTOR", "TRIM_ALARMAS", "ANU_RECORRIDO", "4A_TANQUES"]);

const session: TenantAccessSession = {
  kind: "tenant", tenantSlug: SLUG, accessToken: "x", refreshToken: "x",
  accessTokenExpiresAt: new Date(Date.now() + 6 * 3600e3).toISOString(),
  user: { id: ACTOR, email: "script@local", role: "TENANT_ADMIN" as never, assignedVesselCodes: [], locale: "es" as never },
};

const day = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "-");

async function main() {
  const prisma = getPrismaClient() as any;
  if (!prisma) throw new Error("Sin base de datos (DATABASE_URL).");
  const tenant = await prisma.tenant.findFirst({ where: { slug: SLUG }, select: { id: true } });
  const tenantId = tenant.id as string;

  const backup: unknown[] = [];
  const totals = { actualizados: 0, creados: 0, bajas: 0, sinCambio: 0, conflictos: 0 };
  const conflictos: string[] = [];

  for (const [fam, spec] of Object.entries(SPEC)) {
    const byKey = new Map(spec.items.map(i => [i.key, i]));
    const titleToKey = new Map(spec.items.map(i => [i.title.toLowerCase(), i.key]));

    for (const vessel of spec.vessels) {
      if (ONLY.length && !ONLY.includes(vessel)) continue;
      console.log(`\n===== ${vessel} (${fam}, motor ${spec.motor})`);

      const assets = await prisma.asset.findMany({ where: { tenantId, vesselCode: vessel, deletedAt: null } });
      const assetFor = (key: string) => {
        const suf = ASSET[key]!;
        const pick = (s: string) => s === "GENERIC"
          ? assets.find((a: any) => /^Inspecciones y Pruebas de Sistemas$/i.test(a.name))
          : assets.find((a: any) => a.assetCode === `${vessel}-${s}`);
        // Las YT no tienen equipo "motor": el motor está dentro de "Motor y Bomba de Descarga".
        const a = pick(suf) ?? (suf === "MOTOR" ? pick("BOMBA") : undefined);
        if (!a) throw new Error(`${vessel}: no hay equipo ${suf} para ${key}`);
        return a;
      };

      const plans = await prisma.maintenancePlan.findMany({ where: { tenantId, vesselCode: vessel, deletedAt: null }, orderBy: { taskCode: "asc" } });
      const links = await prisma.workOrderMaintenancePlan.findMany({
        where: { maintenancePlanId: { in: plans.map((p: any) => p.id) } },
        select: { maintenancePlanId: true, workOrder: { select: { status: true } } },
      });
      const otCount = (id: string) => links.filter((l: any) => l.maintenancePlanId === id).length;
      const otOpen = (id: string) => links.filter((l: any) => l.maintenancePlanId === id && !["CLOSED", "CANCELLED"].includes(l.workOrder?.status)).length;

      // Qué ítems cubre cada plan vivo.
      const keysOf = new Map<string, string[]>();
      for (const p of plans) {
        if (KEEP.test(p.title)) continue;
        const exact = titleToKey.get(String(p.title).toLowerCase());
        const hit = exact ? [exact] : MAP.find(([re]) => re.test(p.title))?.[1];
        keysOf.set(p.id, (hit ?? []).filter(k => byKey.has(k)));
      }

      const used = new Set<string>();
      for (const item of spec.items) {
        const contributors = plans.filter((p: any) => keysOf.get(p.id)?.includes(item.key));
        const candidates = contributors.filter((p: any) => keysOf.get(p.id)![0] === item.key && !used.has(p.id));
        candidates.sort((a: any, b: any) =>
          otOpen(b.id) - otOpen(a.id) || otCount(b.id) - otCount(a.id)
          || (b.lastExecutionDate?.getTime() ?? 0) - (a.lastExecutionDate?.getTime() ?? 0)
          || String(a.taskCode).localeCompare(String(b.taskCode)));
        const primary = candidates[0];
        const inheritedLast = contributors
          .map((p: any) => p.lastExecutionDate as Date | null)
          .filter(Boolean)
          .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0] ?? null;
        const asset = assetFor(item.key);
        const description = item.lines.map(l => `[  ] ${l}`).join("\n");

        if (primary) {
          used.add(primary.id);
          // La planilla de tanques por compartimento (tabla) es el formulario de
          // trabajo de la inspección: se conserva debajo del texto del Excel.
          const table = String(primary.description ?? "").split("\n").filter(l => l.trim().startsWith("|"));
          const fullDescription = table.length >= 3 ? `${description}\n\n${table.join("\n")}` : description;
          const payload: Record<string, unknown> = {};
          if (primary.title !== item.title) payload.title = item.title;
          if ((primary.description ?? "") !== fullDescription) payload.description = fullDescription;
          if (primary.triggerType !== "MONTHS") payload.triggerType = "MONTHS";
          if (primary.frequencyMonths !== item.freqMonths) payload.frequencyMonths = item.freqMonths;
          if (primary.frequencyHours != null) payload.frequencyHours = null;
          if (primary.assetId !== asset.id) payload.assetId = asset.id;
          // El muestreo conserva su área y su laboratorio (CONDOR); el resto toma el área del Excel.
          if (item.key !== "SEM_MUESTREO" && item.department && primary.department !== item.department) payload.department = item.department;
          if (!primary.criteriaSource) payload.criteriaSource = "COMPANY_STANDARD";
          // Cambió la frecuencia, o el plan no tenía última ejecución y otro plan
          // del mismo ítem sí: se recalcula el vencimiento desde la última ejecución.
          const last = primary.lastExecutionDate ?? inheritedLast;
          if (last && (payload.frequencyMonths !== undefined || !primary.lastExecutionDate)) payload.lastExecutionDate = last.toISOString();
          if (Object.keys(payload).length === 0) { totals.sinCambio++; console.log(`  =  ${primary.taskCode} ${item.title}`); continue; }
          console.log(`  ~  ${primary.taskCode} "${primary.title}" -> "${item.title}"  [${Object.keys(payload).join(", ")}]  últ ${day(primary.lastExecutionDate)}${payload.lastExecutionDate ? ` -> ${day(last)}` : ""}`);
          backup.push(primary);
          if (!DRY) await updateTenantMaintenancePlan(session, primary.id, payload as never);
          totals.actualizados++;
        } else {
          const payload: Record<string, unknown> = {
            vesselCode: vessel, assetId: asset.id, sfiGroupNumber: SFI[ASSET[item.key]!] ?? null,
            title: item.title, description, triggerType: "MONTHS", frequencyMonths: item.freqMonths,
            department: item.department ?? "BARCAZA", criteriaSource: "COMPANY_STANDARD",
            taskType: INSPECTION_KEYS.has(item.key) ? "INSPECTION" : "MAINTENANCE",
          };
          console.log(`  +  (nuevo) ${item.title}  ${asset.assetCode}  últ ${day(inheritedLast)}`);
          if (!DRY) {
            const created = await createTenantMaintenancePlan(session, payload as never);
            if (inheritedLast) await updateTenantMaintenancePlan(session, created.id, { lastExecutionDate: inheritedLast.toISOString() } as never);
            console.log(`       creado ${created.taskCode}`);
          }
          totals.creados++;
        }
      }

      // Lo que no quedó como plan de ningún ítem se da de baja.
      for (const p of plans) {
        if (KEEP.test(p.title) || used.has(p.id)) continue;
        const why = (keysOf.get(p.id) ?? []).length ? "absorbido por otro plan del mismo ítem" : "no corresponde a ningún ítem del Excel";
        if (otOpen(p.id) > 0) {
          totals.conflictos++;
          conflictos.push(`${vessel} ${p.taskCode} "${p.title}" tiene OT abierta: no se da de baja (${why})`);
          console.log(`  !  ${p.taskCode} "${p.title}" tiene OT abierta, queda (${why})`);
          continue;
        }
        console.log(`  -  ${p.taskCode} "${p.title}"  (${why}; OT ${otCount(p.id)}, últ ${day(p.lastExecutionDate)})`);
        backup.push(p);
        if (!DRY) await deleteTenantMaintenancePlan(session, p.id);
        totals.bajas++;
      }
    }
  }

  // Equipo motor de GLT 007/008: el Excel lo declara MWM 6TCA.
  for (const v of ["GLT007", "GLT008"]) {
    if (ONLY.length && !ONLY.includes(v)) continue;
    const a = await prisma.asset.findFirst({ where: { tenantId, vesselCode: v, assetCode: `${v}-MOTOR`, deletedAt: null } });
    if (a && a.manufacturer !== "MWM") {
      console.log(`\n  ~  equipo ${a.assetCode}: ${a.manufacturer} ${a.model} -> MWM 6TCA`);
      backup.push({ asset: a });
      if (!DRY) await prisma.asset.update({
        where: { id: a.id },
        data: { manufacturer: "MWM", model: "6TCA", name: String(a.name).replace(/Motor - [^(]+\(/, "Motor - MWM 6TCA ("), updatedByUserId: ACTOR },
      });
    }
  }

  if (!DRY) writeFileSync(process.env.BACKUP!, JSON.stringify(backup, null, 1));
  console.log(`\n${DRY ? "[PRUEBA] " : ""}actualizados ${totals.actualizados} · creados ${totals.creados} · bajas ${totals.bajas} · sin cambio ${totals.sinCambio} · con OT abierta ${totals.conflictos}`);
  for (const c of conflictos) console.log("  ! " + c);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
