// Pasa a una frase (IA) la Tarea y la Solicitud de las OT ABIERTAS que ejecutan
// varios ítems del PDM y todavía tienen la lista "CÓDIGO · texto" por ítem.
//
// Las OT nuevas ya nacen así (wo-plan-summary-ai.ts, oct 2026); esto pone al día
// las que se abrieron antes. La IA resume lo que dice LA OT (no el plan): si
// alguien corrigió una línea de la lista, la frase lo toma en cuenta.
//
// Sólo toca un campo si es una lista pura (cada renglón que abre un ítem empieza
// con un código de los planes de la OT). Un texto escrito a mano no se toca.
// El texto anterior queda en el AuditEvent "WorkOrder.textSummarized" y en el
// respaldo JSON.
//
// Uso:
//   npx tsx --env-file=.env scripts/summarize-open-multi-plan-wos.ts [--tenant mercurio]   (prueba, no escribe)
//   npx tsx --env-file=.env scripts/summarize-open-multi-plan-wos.ts --apply --backup <archivo.json>

import { writeFileSync } from "node:fs";
import { getPrismaClient } from "../apps/api/src/platform/data/prisma-client";
import { summarizeMultiPlanFields, type SummaryPlan } from "../apps/api/src/tenant/work-orders/wo-plan-summary-ai";
import { publishAudit } from "../apps/api/src/platform/audit/audit-publisher";

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = args.includes("--apply");
const TENANT = arg("--tenant") ?? "mercurio";
const BACKUP = arg("--backup");

/**
 * Si el texto es la lista automática, devuelve código → texto de ese ítem.
 * Un ítem puede ocupar varios renglones (las descripciones de los planes los
 * tienen); el siguiente ítem empieza en un renglón "CÓDIGO · ".
 */
function parseList(text: string | null, codes: string[]): Map<string, string> | null {
  if (!text?.trim()) return null;
  const byCode = new Map<string, string>();
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const code = codes.find(c => line.startsWith(`${c} · `));
    if (code) {
      if (byCode.has(code)) return null;          // código repetido: no es la lista
      current = code;
      byCode.set(code, line.slice(code.length + 3).trim());
    } else if (current) {
      byCode.set(current, `${byCode.get(current)}\n${line}`.trim());
    } else if (line.trim()) {
      return null;                                 // texto antes del primer ítem
    }
  }
  return byCode.size >= 2 ? byCode : null;
}

async function main() {
  const prisma: any = getPrismaClient();
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT }, select: { id: true, slug: true } });
  if (!tenant) throw new Error(`No existe el tenant ${TENANT}`);
  if (APPLY && !BACKUP) throw new Error("Con --apply hace falta --backup <archivo.json>");

  // La IA se registra a nombre de un administrador del tenant.
  const admin = await prisma.tenantMembership.findFirst({
    where: { tenantId: tenant.id, role: "TENANT_ADMIN", status: "ACTIVE" },
    select: { userId: true, user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) throw new Error("El tenant no tiene un administrador activo");
  const session: any = {
    kind: "tenant", tenantSlug: tenant.slug, accessToken: "script", refreshToken: "script",
    accessTokenExpiresAt: new Date(Date.now() + 3600e3).toISOString(),
    user: { id: admin.userId, email: admin.user.email, role: "TENANT_ADMIN", assignedVesselCodes: [], locale: "es" },
  };

  const orders = await prisma.workOrder.findMany({
    where: { tenantId: tenant.id, deletedAt: null, status: { in: ["PLANNED", "IN_PROGRESS", "ON_HOLD"] } },
    select: { id: true, workOrderCode: true, vesselCode: true, status: true, title: true, description: true },
    orderBy: { workOrderCode: "asc" },
  });
  const links: Array<{ workOrderId: string; maintenancePlanId: string }> = await prisma.workOrderMaintenancePlan.findMany({
    where: { workOrderId: { in: orders.map((o: any) => o.id) } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { workOrderId: true, maintenancePlanId: true },
  });
  const planIdsByWo = new Map<string, string[]>();
  for (const l of links) planIdsByWo.set(l.workOrderId, [...(planIdsByWo.get(l.workOrderId) ?? []), l.maintenancePlanId]);
  const multi = orders.filter((o: any) => (planIdsByWo.get(o.id)?.length ?? 0) >= 2);
  const plans = await prisma.maintenancePlan.findMany({
    where: { id: { in: [...new Set(multi.flatMap((o: any) => planIdsByWo.get(o.id)!))] }, tenantId: tenant.id },
    select: { id: true, taskCode: true, title: true, description: true, assetId: true },
  });
  const planById = new Map<string, any>(plans.map((p: any) => [p.id, p]));

  console.log(`${APPLY ? "APLICANDO" : "PRUEBA (no escribe)"} · ${tenant.slug} · OT abiertas: ${orders.length} · con varios ítems: ${multi.length}`);
  const changes: any[] = [];
  let skipped = 0;
  for (const wo of multi) {
    const woPlans = planIdsByWo.get(wo.id)!.map(id => planById.get(id)).filter(Boolean);
    const codes = woPlans.map((p: any) => p.taskCode).sort((a: string, b: string) => b.length - a.length);
    const titleList = parseList(wo.title, codes);
    const descList = parseList(wo.description, codes);
    if (!titleList && !descList) { skipped++; console.log(`  = ${wo.workOrderCode}: escrita a mano, no se toca`); continue; }

    // La IA resume el texto de la OT, ítem por ítem.
    const summaryPlans: SummaryPlan[] = woPlans.map((p: any) => ({
      taskCode: p.taskCode,
      title: titleList?.get(p.taskCode) ?? p.title,
      description: descList?.get(p.taskCode) ?? p.description,
      assetId: p.assetId,
    }));
    const r = await summarizeMultiPlanFields(prisma, session, {
      tenantId: tenant.id, vesselCode: wo.vesselCode, plans: summaryPlans,
      title: wo.title, description: wo.description,
      mergedTitle: titleList ? wo.title : null,
      mergedDescription: descList ? wo.description : null,
    });
    if (r.title === wo.title && r.description === wo.description) {
      skipped++; console.log(`  ! ${wo.workOrderCode}: la IA no respondió, queda como está`); continue;
    }
    changes.push({ id: wo.id, workOrderCode: wo.workOrderCode, status: wo.status,
      before: { title: wo.title, description: wo.description }, after: { title: r.title, description: r.description } });
    console.log(`  → ${wo.workOrderCode} [${wo.status}]\n     TAREA: ${r.title}\n     SOLICITUD: ${r.description}`);
  }

  if (APPLY && changes.length > 0) {
    writeFileSync(BACKUP!, JSON.stringify({ tenant: tenant.slug, at: new Date().toISOString(), changes }, null, 2));
    for (const c of changes) {
      await prisma.workOrder.update({
        where: { id: c.id },
        data: { title: c.after.title, description: c.after.description, updatedByUserId: admin.userId },
      });
      await publishAudit(prisma, {
        tenantId: tenant.id, actorUserId: admin.userId, action: "WorkOrder.textSummarized",
        entityType: "WorkOrder", entityId: c.id,
        metadata: { workOrderCode: c.workOrderCode, before: c.before, reason: "Tarea y Solicitud de varios ítems pasadas a una frase" },
      });
    }
  }
  console.log(`\n${APPLY ? "Actualizadas" : "Se actualizarían"}: ${changes.length} · sin tocar: ${skipped}${APPLY && BACKUP ? ` · respaldo: ${BACKUP}` : ""}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
