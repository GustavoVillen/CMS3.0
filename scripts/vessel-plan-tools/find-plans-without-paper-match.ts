const VESSEL = "M02";

/** Planes del sistema que no tienen par en el plan en papel. */
import { PrismaClient } from "../../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) } as any) as any;
const suf = (c: string) => (c.match(/-(\d+)$/)?.[1] ?? c);
async function main() {
  const pares = new Set<string>(JSON.parse(readFileSync("scripts/vessel-plan-tools/out/m02-pares.json", "utf8")));
  const t = await prisma.tenant.findFirst({ where: { slug: "mercurio" }, select: { id: true } });
  const as = await prisma.asset.findMany({ where: { tenantId: t.id, vesselCode: VESSEL, deletedAt: null }, select: { id: true, assetCode: true, name: true } });
  const m = new Map(as.map((a: any) => [a.id, a]));
  const ps = await prisma.maintenancePlan.findMany({ where: { tenantId: t.id, vesselCode: VESSEL, deletedAt: null } });
  const sob = ps.filter((p: any) => !pares.has(`${m.get(p.assetId)?.assetCode}|${suf(p.taskCode)}`))
    .map((p: any) => ({ asset: m.get(p.assetId)?.assetCode, activo: m.get(p.assetId)?.name, code: p.taskCode, title: p.title, trigger: p.triggerType, freq: p.frequencyMonths ?? p.frequencyHours, dep: p.department, ia: !!(p.acceptanceCriteria && p.riskLevel) }));
  writeFileSync("scripts/vessel-plan-tools/out/m02-sobrantes.json", JSON.stringify(sob, null, 1));
  console.log("planes:", ps.length, "| del papel:", ps.length - sob.length, "| sin par en el papel:", sob.length);
  const byAsset: any = {};
  for (const s of sob) (byAsset[s.activo] = byAsset[s.activo] ?? []).push(s.title);
  for (const [k, v] of Object.entries(byAsset)) console.log(`  ${k} (${(v as any).length})`);
}
main().finally(() => process.exit());
