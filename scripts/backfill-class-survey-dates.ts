/**
 * Carga inicial de las fechas de inspección de clase en el certificado de clase
 * de cada buque, desde los Ship Status reales (scripts/data/class-survey-plans.json,
 * que arma scripts/data/survey-status/build_class_survey_plans.py).
 *
 * Qué escribe (sólo si el Ship Status trae el dato; no inventa nada):
 *   classRenewalDate                    ← renovación.last
 *   intermediateSurvey[Due]Date         ← intermedia.last / due
 *   periodicSurvey[Due]Date             ← periódica.last / due
 *   drydockSurvey[Due]Date              ← seco.last / due
 *   tailshaftSurvey[Due]Date            ← eje: la línea de vencimiento más cercano
 *                                          (DCH tiene babor y estribor con fechas distintas)
 * El vencimiento del certificado (expiryDate) NO se toca: se corrige renovándolo.
 *
 *   DRY=1 npx tsx --env-file=.env scripts/backfill-class-survey-dates.ts   # muestra
 *   npx tsx --env-file=.env scripts/backfill-class-survey-dates.ts         # aplica
 *
 * Idempotente: volver a correrlo deja lo mismo. Pisa correcciones manuales con el
 * dato del Ship Status, así que es una carga inicial, no un proceso periódico.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});
const DRY = process.env.DRY === "1";
const TENANT = process.env.TENANT ?? "mercurio";

type Item = { last?: string | null; due?: string | null; detalle?: Array<{ last?: string | null; due?: string | null }> };
type VesselData = { code: string; name: string; items: Record<string, Item | undefined> };

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const d = (s?: string | null) => (s ? new Date(`${s}T12:00:00Z`) : undefined);

function tailshaft(item?: Item): Item | undefined {
  const lines = item?.detalle?.filter(l => l.due) ?? [];
  if (!lines.length) return item;
  return [...lines].sort((a, b) => a.due!.localeCompare(b.due!))[0];
}

async function main() {
  const data: VesselData[] = JSON.parse(readFileSync(join(__dirname, "data", "class-survey-plans.json"), "utf8"));
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT } });
  if (!tenant) throw new Error(`Tenant ${TENANT} no existe`);

  let updated = 0;
  for (const v of data) {
    const certs = await prisma.certificate.findMany({
      where: { tenantId: tenant.id, vesselCode: v.code, deletedAt: null },
      select: { id: true, name: true, certificateCode: true },
      orderBy: { expiryDate: "desc" },
    });
    const cert = certs.find(c => /clasific|\bclase\b/.test(norm(c.name)));
    if (!cert) { console.log(`— ${v.name}: sin certificado de clase, se omite`); continue; }

    const it = v.items, eje = tailshaft(it.eje);
    const fields: Record<string, Date | undefined> = {
      classRenewalDate: d(it.renovacion?.last),
      intermediateSurveyDate: d(it.intermedia?.last), intermediateSurveyDueDate: d(it.intermedia?.due),
      periodicSurveyDate: d(it.periodica?.last), periodicSurveyDueDate: d(it.periodica?.due),
      drydockSurveyDate: d(it.seco?.last), drydockSurveyDueDate: d(it.seco?.due),
      tailshaftSurveyDate: d(eje?.last), tailshaftSurveyDueDate: d(eje?.due),
    };
    const set = Object.fromEntries(Object.entries(fields).filter(([, val]) => val !== undefined));
    console.log(`${DRY ? "[DRY] " : ""}${v.name} (${cert.certificateCode}): ` +
      Object.entries(set).map(([k, val]) => `${k}=${(val as Date).toISOString().slice(0, 10)}`).join(" "));
    if (!DRY && Object.keys(set).length) {
      await prisma.certificate.update({ where: { id: cert.id }, data: set });
      updated++;
    }
  }
  console.log(DRY ? "DRY: no se escribió nada." : `Certificados actualizados: ${updated}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
