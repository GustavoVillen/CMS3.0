/** Auditoria de los planes del LATERE: campos incompletos y restos de plantilla. */
const VESSEL = (process.argv.find(a=>a.startsWith("--buque="))?.split("=")[1] ?? "LTE").toUpperCase();
import { PrismaClient } from "../../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) } as any) as any;
async function main() {
  const codes = process.argv.slice(2).filter(a => !a.startsWith("--buque="));
  const t = await prisma.tenant.findFirst({ where: { slug: "mercurio" }, select: { id: true } });
  const where: any = { tenantId: t.id, vesselCode: VESSEL, deletedAt: null };
  const as = await prisma.asset.findMany({ where: { tenantId: t.id, vesselCode: VESSEL, deletedAt: null }, select: { id: true, assetCode: true, name: true } });
  const m = new Map(as.map((a: any) => [a.id, a.assetCode]));
  const ids = codes.length ? as.filter((a: any) => codes.includes(a.assetCode)).map((a: any) => a.id) : null;
  if (ids) where.assetId = { in: ids };
  const ps = await prisma.maintenancePlan.findMany({ where });
  const falta = ps.filter((p: any) => !p.acceptanceCriteria || !p.loto || !p.riskLevel || !p.consequenceCategory || !p.department || !p.responsible);
  const txt = (p: any) => [p.acceptanceCriteria, p.loto, p.riskAnalysisResult].filter(Boolean).join("\n");
  // Mismos patrones que cleanAiText: solo cuenta el corchete que ENVUELVE la
  // linea entera. "- [ ] texto" es una casilla de verificacion, no un resto.
  const sucios = ps.filter((p: any) =>
    /^\s*\[[^\][]*\]\s*$/m.test(txt(p)) || /^\s*(?:[-*•]|\d+[.)])\s*\[[^\][]+\]\s*$/m.test(txt(p)));
  console.log(`planes ${codes.length ? "del lote" : "del buque"}: ${ps.length} | incompletos: ${falta.length} | con restos de plantilla: ${sucios.length}`);
  for (const p of falta.slice(0, 25)) console.log(`   · ${m.get(p.assetId)} ${p.taskCode} — ${p.title} | ac=${!!p.acceptanceCriteria} loto=${!!p.loto} risk=${p.riskLevel} rcm=${p.consequenceCategory} dep=${p.department} resp=${p.responsible}`);
  for (const p of sucios.slice(0, 10)) console.log(`   ~ restos: ${m.get(p.assetId)} ${p.taskCode}`);
}
main().finally(() => process.exit());
