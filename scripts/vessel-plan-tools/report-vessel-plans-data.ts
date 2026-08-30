/** Datos del informe final del plan del LATERE. */
const VESSEL = (process.argv.find(a=>a.startsWith("--buque="))?.split("=")[1] ?? "LTE").toUpperCase();
import { PrismaClient } from "../../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { writeFileSync } from "node:fs";
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) } as any) as any;
async function main() {
  const t = await prisma.tenant.findFirst({ where: { slug: "mercurio" }, select: { id: true } });
  const assets = await prisma.asset.findMany({ where: { tenantId: t.id, vesselCode: VESSEL, deletedAt: null }, select: { id: true, assetCode: true, name: true, sfiCode: true, manufacturer: true, model: true, createdAt: true } });
  const m = new Map(assets.map((a: any) => [a.id, a]));
  const plans = await prisma.maintenancePlan.findMany({ where: { tenantId: t.id, vesselCode: VESSEL, deletedAt: null } });
  const conIA = plans.filter((p: any) => p.acceptanceCriteria && p.loto && p.riskLevel && p.consequenceCategory);
  const sinIA = plans.filter((p: any) => !(p.acceptanceCriteria && p.loto && p.riskLevel && p.consequenceCategory));
  const out = {
    totalPlanes: plans.length,
    totalActivos: assets.length,
    conIA: conIA.length,
    sinIA: sinIA.map((p: any) => ({ asset: m.get(p.assetId)?.assetCode, activo: m.get(p.assetId)?.name, code: p.taskCode, title: p.title, dep: p.department, resp: p.responsible, trigger: p.triggerType, freq: p.frequencyMonths ?? p.frequencyHours })),
    porRiesgo: conIA.reduce((a: any, p: any) => (a[p.riskLevel] = (a[p.riskLevel] ?? 0) + 1, a), {}),
    porRcm: conIA.reduce((a: any, p: any) => (a[p.consequenceCategory] = (a[p.consequenceCategory] ?? 0) + 1, a), {}),
    porTrigger: plans.reduce((a: any, p: any) => (a[p.triggerType] = (a[p.triggerType] ?? 0) + 1, a), {}),
    vencidos: plans.filter((p: any) => p.nextDueDate && p.nextDueDate < new Date()).map((p: any) => ({ asset: m.get(p.assetId)?.assetCode, activo: m.get(p.assetId)?.name, title: p.title, nextDueDate: p.nextDueDate })),
    sinFecha: plans.filter((p: any) => !p.nextDueDate && !p.nextDueHours).length,
  };
  writeFileSync(`scripts/vessel-plan-tools/out/informe-${VESSEL}.json`, JSON.stringify(out, null, 1));
  console.log("planes", out.totalPlanes, "| activos", out.totalActivos, "| con IA", out.conIA, "| sin IA", out.sinIA.length);
  console.log("riesgo:", JSON.stringify(out.porRiesgo), "\nRCM:", JSON.stringify(out.porRcm), "\ntrigger:", JSON.stringify(out.porTrigger));
  console.log("vencidos:", out.vencidos.length, "| sin fecha ni horas:", out.sinFecha);
}
main().finally(() => process.exit());
