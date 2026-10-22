/**
 * Alta de barcazas gemelas: crea cada buque destino y le copia, desde un buque
 * origen del mismo tenant, los equipos, el plan de mantenimiento y el catálogo de
 * repuestos. Hecho para YT010 → YT001 y YT004 (oct 2026).
 *
 * A diferencia de clone-vessel-mp.ts (que copia una lista fija de campos y se quedó
 * sin los nuevos), acá se copia la fila entera y sólo se excluye o remapea lo que es
 * propio de cada casco:
 *   - Vessel: datos de la familia (armador, tipo, bandera, puerto, clase, operador,
 *     tipo de incorporación, dotación, auditoría IA al cierre). NO los del casco
 *     (matrícula, IMO, medidas, arqueo, año y país de construcción, fecha de
 *     incorporación, clave de tripulación): se cargan en la ficha del buque.
 *   - Asset: todo salvo lo de la unidad física (n.º de serie, fechas de instalación,
 *     overhaul y reemplazo); el estado arranca en OPERATIONAL. parentAssetId y
 *     standbyTestPlanId se remapean a los del destino.
 *   - MaintenancePlan: todo, con assetId y los spareId de `spares` remapeados. Sin
 *     historial: última ejecución en blanco y vencimiento con la misma regla que la
 *     app aplica a un plan nuevo (hoy + frecuencia, autoInitialNextDueDate).
 *   - MaintenancePlanCoveredAsset y SpareAsset: remapeados.
 *   - Spare: todo, con stock 0 (el stock se cuenta a bordo) y sin ubicación de pañol
 *     (las ubicaciones son por buque). linkedAssetId remapeado.
 *   - El código del origen se cambia por el del destino en assetCode, taskCode, sku y
 *     en los textos (YT010-BOMBA → YT001-BOMBA, "YT 010" → "YT 001").
 *   - Los usuarios que tienen asignado el origen reciben también el destino.
 *   - NO se copian OT, SS, certificados, muestras, movimientos de stock ni horas.
 *
 * Cada destino se graba en una sola transacción (si algo falla no queda nada a
 * medias) con un AuditEvent Vessel.created. Aborta si el destino ya existe.
 *
 * Uso:
 *   DATABASE_URL=<url> DRY=1 npx tsx scripts/clone-sister-vessel.ts   → previsualiza
 *   DATABASE_URL=<url> npx tsx scripts/clone-sister-vessel.ts
 *   SRC_VESSEL=YT010 DST_VESSELS=YT001,YT004 TENANT_SLUG=mercurio ACTOR_EMAIL=admin@mercurio.com
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const SRC = process.env.SRC_VESSEL ?? "YT010";
const DSTS = (process.env.DST_VESSELS ?? "YT001,YT004").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const ACTOR_EMAIL = process.env.ACTOR_EMAIL ?? "admin@mercurio.com";
const DRY = process.env.DRY === "1";

const AUDIT_FIELDS = ["id", "tenantId", "vesselCode", "createdAt", "createdByUserId", "updatedAt", "updatedByUserId", "deletedAt", "deletedByUserId"];
const VESSEL_FAMILY_FIELDS = ["owner", "vesselType", "isCrewed", "flag", "portOfRegistry", "classSociety", "manager", "incorporationType", "aiCloseAuditEnabled"];
const JSON_FIELDS = new Set(["spares", "providerRequests"]);

/** "YT001" → "YT 001", igual que el resto de la flota (MGT 01, GLT 001). */
const displayName = (code: string) => code.replace(/^([A-Z]+)(\d+)$/, "$1 $2");

function omit(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (keys.includes(k)) continue;
    // Json null no se puede mandar como null en Prisma: se omite y queda NULL.
    if (v === null && JSON_FIELDS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Vencimiento de un plan nunca ejecutado: copia de autoInitialNextDueDate (maintenance-plans-service.ts). */
function initialNextDueDate(triggerType: string, frequencyMonths: number | null): Date | null {
  if (!frequencyMonths || frequencyMonths <= 0) return null;
  const next = new Date();
  const tt = triggerType.toUpperCase();
  if (tt === "MONTHS" || tt === "CALENDAR") { next.setMonth(next.getMonth() + frequencyMonths); return next; }
  if (tt === "DAY") { next.setDate(next.getDate() + frequencyMonths); return next; }
  if (tt === "WEEK") { next.setDate(next.getDate() + frequencyMonths * 7); return next; }
  return null;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado en esta base.`);
  const tid: string = tenant.id;

  const actor = await prisma.user.findFirst({
    where: { email: ACTOR_EMAIL, memberships: { some: { tenantId: tid, role: "TENANT_ADMIN" } } },
    select: { id: true },
  });
  if (!actor) throw new Error(`No hay TENANT_ADMIN '${ACTOR_EMAIL}' en tenant '${SLUG}'.`);
  const uid: string = actor.id;

  const src = await prisma.vessel.findUnique({ where: { tenantId_code: { tenantId: tid, code: SRC } } });
  if (!src || src.deletedAt) throw new Error(`Buque origen '${SRC}' no existe en tenant '${SLUG}'.`);

  const live = { tenantId: tid, vesselCode: SRC, deletedAt: null };
  const srcAssets = await prisma.asset.findMany({ where: live, orderBy: { assetCode: "asc" } });
  const srcPlans = await prisma.maintenancePlan.findMany({ where: live, orderBy: { taskCode: "asc" } });
  const srcSpares = await prisma.spare.findMany({ where: live, orderBy: { sku: "asc" } });
  const srcAssetIds = srcAssets.map((a: any) => a.id);
  const srcPlanIds = srcPlans.map((p: any) => p.id);
  const srcCovered = await prisma.maintenancePlanCoveredAsset.findMany({ where: { tenantId: tid, maintenancePlanId: { in: srcPlanIds } } });
  const srcSpareAssets = await prisma.spareAsset.findMany({ where: { tenantId: tid, spareId: { in: srcSpares.map((s: any) => s.id) } } });
  const members = await prisma.tenantMembership.findMany({
    where: { tenantId: tid, assignedVesselCodes: { has: SRC } },
    select: { id: true, assignedVesselCodes: true, user: { select: { email: true } } },
  });

  console.log(`Origen ${SRC} (${src.name}): ${srcAssets.length} equipos · ${srcPlans.length} planes · ${srcSpares.length} repuestos · ` +
    `${srcCovered.length} equipos cubiertos por rutinas · ${srcSpareAssets.length} vínculos repuesto-equipo`);
  console.log(`Usuarios con ${SRC} asignado: ${members.map((m: any) => m.user.email).join(", ") || "(ninguno)"}\n`);

  for (const DST of DSTS) {
    const exists = await prisma.vessel.findUnique({ where: { tenantId_code: { tenantId: tid, code: DST } }, select: { id: true } });
    if (exists) throw new Error(`El buque '${DST}' ya existe; no se toca. Nada grabado para ${DST}.`);

    const dstName = displayName(DST);
    const srcName = src.name as string;
    const swap = (s: string) => s.split(SRC).join(DST).split(srcName).join(dstName);
    const swapText = (row: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(row)) if (typeof v === "string") row[k] = swap(v);
      return row;
    };
    const rename = (code: string) => (code.includes(SRC) ? swap(code) : `${DST}-${code}`);

    console.log(`── ${DST} (${dstName}) ${DRY ? "[DRY]" : ""}`);
    for (const a of srcAssets) console.log(`   equipo   ${a.assetCode} → ${rename(a.assetCode)}`);
    for (const p of srcPlans) console.log(`   plan     ${p.taskCode} → ${rename(p.taskCode)}  vence ${initialNextDueDate(p.triggerType, p.frequencyMonths)?.toISOString().slice(0, 10) ?? "-"}`);
    for (const s of srcSpares) console.log(`   repuesto ${s.sku} → ${rename(s.sku)}`);
    if (DRY) { console.log(""); continue; }

    const result = await prisma.$transaction(async (tx: any) => {
      const vesselData: Record<string, unknown> = {};
      for (const k of VESSEL_FAMILY_FIELDS) if (src[k] !== null && src[k] !== undefined) vesselData[k] = src[k];
      const vessel = await tx.vessel.create({
        data: { tenantId: tid, code: DST, name: dstName, status: "ACTIVE", ...vesselData, createdByUserId: uid, updatedByUserId: uid },
        select: { id: true },
      });

      const assetMap = new Map<string, string>();
      for (const a of srcAssets) {
        const data = swapText(omit(a, [...AUDIT_FIELDS, "assetCode", "parentAssetId", "standbyTestPlanId", "status",
          "serialNumber", "installationDate", "lastOverhaulDate", "replacementDate"]));
        const created = await tx.asset.create({
          data: { ...data, tenantId: tid, vesselCode: DST, assetCode: rename(a.assetCode), createdByUserId: uid, updatedByUserId: uid },
          select: { id: true },
        });
        assetMap.set(a.id, created.id);
      }
      for (const a of srcAssets) {
        if (!a.parentAssetId) continue;
        const parent = assetMap.get(a.parentAssetId);
        if (!parent) throw new Error(`El padre de ${a.assetCode} no es de ${SRC}.`);
        await tx.asset.update({ where: { id: assetMap.get(a.id) }, data: { parentAssetId: parent } });
      }

      const spareMap = new Map<string, string>();
      for (const s of srcSpares) {
        const data = swapText(omit(s, [...AUDIT_FIELDS, "sku", "currentStock", "defaultLocationId", "linkedAssetId"]));
        const created = await tx.spare.create({
          data: {
            ...data, tenantId: tid, vesselCode: DST, sku: rename(s.sku), currentStock: 0,
            linkedAssetId: s.linkedAssetId ? assetMap.get(s.linkedAssetId) ?? null : null,
            createdByUserId: uid, updatedByUserId: uid,
          },
          select: { id: true },
        });
        spareMap.set(s.id, created.id);
      }

      const planMap = new Map<string, string>();
      for (const p of srcPlans) {
        const assetId = assetMap.get(p.assetId);
        if (!assetId) throw new Error(`Plan ${p.taskCode}: su equipo no es un equipo vigente de ${SRC}.`);
        const data = swapText(omit(p, [...AUDIT_FIELDS, "taskCode", "assetId", "spares",
          "lastExecutionDate", "lastExecutionHours", "nextDueDate", "nextDueHours",
          "windowOpenDate", "windowOpenHours", "executionStatus"]));
        const spares = Array.isArray(p.spares)
          ? p.spares.map((it: any) => (it?.spareId ? { ...it, spareId: spareMap.get(it.spareId) ?? null } : it))
          : undefined;
        const created = await tx.maintenancePlan.create({
          data: {
            ...data, tenantId: tid, vesselCode: DST, taskCode: rename(p.taskCode), assetId,
            ...(spares && spares.length > 0 ? { spares } : {}),
            executionStatus: "FUTURE", nextDueDate: initialNextDueDate(p.triggerType, p.frequencyMonths),
            createdByUserId: uid, updatedByUserId: uid,
          },
          select: { id: true },
        });
        planMap.set(p.id, created.id);
      }

      for (const a of srcAssets) {
        if (!a.standbyTestPlanId) continue;
        const plan = planMap.get(a.standbyTestPlanId);
        await tx.asset.update({ where: { id: assetMap.get(a.id) }, data: { standbyTestPlanId: plan ?? null } });
      }

      const covered = srcCovered.filter((c: any) => assetMap.has(c.assetId));
      if (covered.length > 0) {
        await tx.maintenancePlanCoveredAsset.createMany({
          data: covered.map((c: any) => ({ tenantId: tid, maintenancePlanId: planMap.get(c.maintenancePlanId), assetId: assetMap.get(c.assetId), createdByUserId: uid })),
        });
      }
      const spareAssets = srcSpareAssets.filter((l: any) => assetMap.has(l.assetId));
      if (spareAssets.length > 0) {
        await tx.spareAsset.createMany({
          data: spareAssets.map((l: any) => ({ tenantId: tid, spareId: spareMap.get(l.spareId), assetId: assetMap.get(l.assetId), createdByUserId: uid })),
        });
      }

      const assignedTo: string[] = [];
      for (const m of members) {
        const current = await tx.tenantMembership.findUnique({ where: { id: m.id }, select: { assignedVesselCodes: true } });
        if (current.assignedVesselCodes.includes(DST)) continue;
        await tx.tenantMembership.update({ where: { id: m.id }, data: { assignedVesselCodes: [...current.assignedVesselCodes, DST] } });
        assignedTo.push(m.user.email);
      }

      const counts = {
        assets: assetMap.size, plans: planMap.size, spares: spareMap.size,
        coveredAssets: covered.length, spareAssets: spareAssets.length,
      };
      await tx.auditEvent.create({
        data: {
          tenantId: tid, actorType: "TENANT_USER", actorUserId: uid, action: "Vessel.created",
          entityType: "Vessel", entityId: vessel.id,
          metadata: { code: DST, name: dstName, copiedFrom: SRC, ...counts, assignedTo },
        },
      });
      return { ...counts, assignedTo };
    }, { maxWait: 10_000, timeout: 120_000 });

    console.log(`   ✓ ${DST}: ${result.assets} equipos · ${result.plans} planes · ${result.spares} repuestos · ` +
      `${result.coveredAssets} cubiertos · ${result.spareAssets} vínculos · asignado a ${result.assignedTo.join(", ") || "(nadie)"}\n`);
  }

  console.log(DRY ? "DRY-RUN: no se escribió nada." : "✅ Completado.");
}

main()
  .catch((e) => { console.error("❌ Error:", e?.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
