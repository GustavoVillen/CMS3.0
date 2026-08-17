/**
 * Completa area y responsable en los planes que quedaron sin ellos.
 *
 * Los planes cuyo responsable es de cubierta (3er Oficial, Contramaestre) NO se
 * pasan a MAQUINAS: se les pone area CUBIERTA y se les respeta el responsable.
 * El resto queda con MAQUINAS / "Jefe de Máquinas", unificando las variantes sin
 * tilde que venian del clon.
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) } as any) as any;
const VESSEL = (process.argv.find(a => a.startsWith("--buque="))?.split("=")[1] ?? "LTE").toUpperCase();
const ES_CUBIERTA = /oficial|contramaestre|cubierta|marinero/i;
/** Solo se unifica esta variante; cualquier otro responsable propio se respeta. */
const ES_JEFE_MAQUINAS = /^jefe de m[aá]quinas$/i;

async function main() {
  const t = await prisma.tenant.findFirst({ where: { slug: "mercurio" }, select: { id: true } });
  const ps = await prisma.maintenancePlan.findMany({
    where: { tenantId: t.id, vesselCode: VESSEL, deletedAt: null },
    select: { id: true, taskCode: true, department: true, responsible: true },
  });
  let maq = 0, cub = 0;
  for (const p of ps) {
    const cubierta = ES_CUBIERTA.test(p.responsible ?? "");
    const dep = cubierta ? "CUBIERTA" : "MAQUINAS";
    // El responsable solo se toca cuando esta vacio o es "Jefe de Maquinas" sin
    // tilde: los que nombran a otro (Electricista, un proveedor externo) llevan
    // informacion que no hay que perder.
    const resp = !p.responsible || ES_JEFE_MAQUINAS.test(p.responsible)
      ? "Jefe de Máquinas" : p.responsible;
    if (p.department === dep && p.responsible === resp) continue;
    await prisma.maintenancePlan.update({ where: { id: p.id }, data: { department: dep, responsible: resp } });
    cubierta ? cub++ : maq++;
    console.log(`  ${p.taskCode.padEnd(22)} ${p.department ?? "-"}/${p.responsible ?? "-"} → ${dep}/${resp}`);
  }
  console.log(`\n${maq} planes a MAQUINAS, ${cub} a CUBIERTA (de ${ps.length}).`);
}
main().finally(() => process.exit());
