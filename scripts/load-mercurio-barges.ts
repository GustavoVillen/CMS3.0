/**
 * Carga los 27 buques (barcazas) de la flota Mercurio en la DB.
 * Fuente: planilla Google Sheets con datos de MGT01-27, GLT001/007/008, YT010/012/013.
 *
 * Uso:
 *   DATABASE_URL=<url> npx tsx scripts/load-mercurio-barges.ts
 *   DRY=1 DATABASE_URL=<url> npx tsx scripts/load-mercurio-barges.ts   → previsualiza
 *   TENANT_SLUG=mercurio  (overridable por env)
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const DRY = process.env.DRY === "1";

interface BargeDef {
  codigo: string;
  nombre: string;
  armador: string;
  tipo: string;
  imo: string | null;
  matricula: string | null;
  potencia: number | null;
  dwt: number | null;
  eslora: number | null;
  manga: number | null;
  puntal: number | null;
  trn: number | null;
  trb: number | null;
  anioConstruccion: number | null;
  paisConstruccion: string | null;
  fechaIncorporacion: Date | null;
  tipoIncorporacion: string | null;
}

// Datos de la planilla Google Sheets (27 barcazas)
const BARGES: BargeDef[] = [
  // MGT Series (Mercurio Group Tanques)
  { codigo: "MGT01", nombre: "MGT 01", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4490-BT", potencia: null, dwt: 2.784, eslora: 61.50, manga: 16.60, puntal: 3.66, trn: 998, trb: 1.354, anioConstruccion: 2018, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2019-05-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT02", nombre: "MGT 02", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4491-BT", potencia: null, dwt: 2.784, eslora: 61.50, manga: 16.60, puntal: 3.66, trn: 998, trb: 1.354, anioConstruccion: 2018, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2019-05-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT03", nombre: "MGT 03", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4492-BT", potencia: null, dwt: 2.784, eslora: 61.50, manga: 16.60, puntal: 3.66, trn: 998, trb: 1.354, anioConstruccion: 2018, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2019-05-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT04", nombre: "MGT 04", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4493-BT", potencia: null, dwt: 2.784, eslora: 61.50, manga: 16.60, puntal: 3.66, trn: 998, trb: 1.354, anioConstruccion: 2018, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2019-05-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT05", nombre: "MGT 05", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Box", imo: null, matricula: "4494-BT", potencia: null, dwt: 2.784, eslora: 61.50, manga: 16.60, puntal: 3.66, trn: 1.005, trb: 1.405, anioConstruccion: 2018, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2019-05-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT06", nombre: "MGT 06", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Box", imo: null, matricula: "4495-BT", potencia: null, dwt: 2.784, eslora: 61.50, manga: 16.60, puntal: 3.66, trn: 1.005, trb: 1.405, anioConstruccion: 2018, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2019-04-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT07", nombre: "MGT 07", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Box", imo: null, matricula: "4496-BT", potencia: null, dwt: 2.784, eslora: 61.50, manga: 16.60, puntal: 3.66, trn: 1.005, trb: 1.405, anioConstruccion: 2019, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2019-04-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT08", nombre: "MGT 08", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4513-BT", potencia: null, dwt: 2.784, eslora: 61.50, manga: 16.60, puntal: 3.66, trn: 998, trb: 1.354, anioConstruccion: 2019, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2019-07-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT09", nombre: "MGT 09", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4518-BT", potencia: null, dwt: 2.784, eslora: 61.50, manga: 16.60, puntal: 3.66, trn: 998, trb: 1.354, anioConstruccion: 2019, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2019-09-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT10", nombre: "MGT 10", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4715-BT", potencia: null, dwt: 2.916, eslora: 60.00, manga: 16.60, puntal: 3.58, trn: 939, trb: 1.354, anioConstruccion: 2022, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2022-05-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT11", nombre: "MGT 11", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4716-BT", potencia: null, dwt: 2.916, eslora: 60.00, manga: 16.60, puntal: 3.58, trn: 939, trb: 1.354, anioConstruccion: 2022, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2022-05-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT12", nombre: "MGT 12", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4717-BT", potencia: null, dwt: 2.916, eslora: 60.00, manga: 16.60, puntal: 3.58, trn: 939, trb: 1.354, anioConstruccion: 2022, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2022-02-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT13", nombre: "MGT 13", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4718-BT", potencia: null, dwt: 2.916, eslora: 60.00, manga: 16.60, puntal: 3.58, trn: 939, trb: 1.354, anioConstruccion: 2022, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2022-02-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT14", nombre: "MGT 14", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4719-BT", potencia: null, dwt: 2.916, eslora: 60.00, manga: 16.60, puntal: 3.58, trn: 939, trb: 1.354, anioConstruccion: 2022, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2022-04-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT15", nombre: "MGT 15", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4720-BT", potencia: null, dwt: 2.916, eslora: 60.00, manga: 16.60, puntal: 3.58, trn: 939, trb: 1.354, anioConstruccion: 2022, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2022-04-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT16", nombre: "MGT 16", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "3484-BTQ", potencia: null, dwt: 2.719, eslora: 59.48, manga: 16.60, puntal: 3.65, trn: 841, trb: 1.245, anioConstruccion: 2010, paisConstruccion: "Argentina", fechaIncorporacion: new Date("2024-09-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT17", nombre: "MGT 17", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "3485-BTQ", potencia: null, dwt: 2.719, eslora: 59.48, manga: 16.00, puntal: 3.65, trn: 841, trb: 1.245, anioConstruccion: 2010, paisConstruccion: "Argentina", fechaIncorporacion: new Date("2024-10-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT18", nombre: "MGT 18", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "3514-BTQ", potencia: null, dwt: 2.719, eslora: 59.48, manga: 16.00, puntal: 3.65, trn: 841, trb: 1.245, anioConstruccion: 2010, paisConstruccion: "Argentina", fechaIncorporacion: new Date("2024-04-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT19", nombre: "MGT 19", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "3534-BTQ", potencia: null, dwt: 2.719, eslora: 59.48, manga: 16.00, puntal: 3.66, trn: 841, trb: 1.245, anioConstruccion: 2010, paisConstruccion: "Argentina", fechaIncorporacion: new Date("2024-03-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT20", nombre: "MGT 20", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "3535-BTQ", potencia: null, dwt: 2.719, eslora: 59.48, manga: 16.00, puntal: 3.66, trn: 841, trb: 1.245, anioConstruccion: 2010, paisConstruccion: "Argentina", fechaIncorporacion: new Date("2024-04-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT21", nombre: "MGT 21", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "3547-BTQ", potencia: null, dwt: 2.719, eslora: 59.48, manga: 16.00, puntal: 3.68, trn: 841, trb: 1.245, anioConstruccion: 2010, paisConstruccion: "Argentina", fechaIncorporacion: new Date("2024-09-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT22", nombre: "MGT 22", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "3515-BT", potencia: null, dwt: 2.719, eslora: 59.48, manga: 16.00, puntal: 3.65, trn: 841, trb: 1.245, anioConstruccion: 2010, paisConstruccion: "Argentina", fechaIncorporacion: new Date("2024-10-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT23", nombre: "MGT 23", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "3516-BTQ", potencia: null, dwt: 2.719, eslora: 59.48, manga: 16.00, puntal: 3.65, trn: 841, trb: 1.245, anioConstruccion: 2010, paisConstruccion: "Argentina", fechaIncorporacion: new Date("2024-01-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT24", nombre: "MGT 24", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "3536-BT", potencia: null, dwt: 2.719, eslora: 59.48, manga: 16.00, puntal: 3.66, trn: 841, trb: 1.245, anioConstruccion: 2011, paisConstruccion: "Argentina", fechaIncorporacion: new Date("2024-03-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT25", nombre: "MGT 25", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "3509-BT", potencia: null, dwt: 2.719, eslora: 59.48, manga: 16.00, puntal: 3.68, trn: 841, trb: 1.245, anioConstruccion: 2011, paisConstruccion: "Argentina", fechaIncorporacion: new Date("2024-01-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT26", nombre: "MGT 26", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "3574-BT", potencia: null, dwt: 2.719, eslora: 59.48, manga: 16.00, puntal: 3.65, trn: 841, trb: 1.245, anioConstruccion: 2011, paisConstruccion: "Argentina", fechaIncorporacion: new Date("2024-03-01"), tipoIncorporacion: "Propio" },
  { codigo: "MGT27", nombre: "MGT 27", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "3587-BT", potencia: null, dwt: 2.719, eslora: 59.48, manga: 16.00, puntal: 3.65, trn: 841, trb: 1.245, anioConstruccion: 2011, paisConstruccion: "Argentina", fechaIncorporacion: new Date("2024-04-01"), tipoIncorporacion: "Propio" },

  // GLT Series (Mercurio Group Lanchas Tanques)
  { codigo: "GLT001", nombre: "GLT 001", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4246-BT", potencia: null, dwt: 2.916, eslora: 60.00, manga: 16.60, puntal: 3.65, trn: 939, trb: 1.354, anioConstruccion: 2016, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2020-05-01"), tipoIncorporacion: "Chartreado" },
  { codigo: "GLT007", nombre: "GLT 007", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4321-BT", potencia: null, dwt: 2.916, eslora: 60.00, manga: 16.00, puntal: 3.65, trn: 939, trb: 1.354, anioConstruccion: 2016, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2020-10-01"), tipoIncorporacion: "Chartreado" },
  { codigo: "GLT008", nombre: "GLT 008", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Rake", imo: null, matricula: "4322-BT", potencia: null, dwt: 2.916, eslora: 60.00, manga: 16.00, puntal: 3.65, trn: 939, trb: 1.354, anioConstruccion: 2016, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2020-10-01"), tipoIncorporacion: "Chartreado" },

  // YT Series (Yate/Remolcador Tanques)
  { codigo: "YT010", nombre: "YT 010", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Box", imo: null, matricula: "4238-BT", potencia: null, dwt: 2.500, eslora: 57.75, manga: 15.00, puntal: 3.96, trn: 860, trb: 1.043, anioConstruccion: 2015, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2024-03-01"), tipoIncorporacion: "Chartreado" },
  { codigo: "YT012", nombre: "YT 012", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Box", imo: null, matricula: "4275-BT", potencia: null, dwt: 2.500, eslora: 57.75, manga: 15.00, puntal: 3.96, trn: 860, trb: 1.043, anioConstruccion: 2015, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2024-06-01"), tipoIncorporacion: "Chartreado" },
  { codigo: "YT013", nombre: "YT 013", armador: "Mercurio Group SA", tipo: "Barcaza Tanque - Box", imo: null, matricula: "4320-BT", potencia: null, dwt: 2.500, eslora: 57.75, manga: 15.00, puntal: 3.96, trn: 860, trb: 1.043, anioConstruccion: 2015, paisConstruccion: "Paraguay", fechaIncorporacion: new Date("2023-09-01"), tipoIncorporacion: "Chartreado" },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado en esta base.`);
  const tid: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: tid, role: "TENANT_ADMIN" },
    select: { userId: true },
  });
  const uid: string | undefined = member?.userId;
  if (!uid) throw new Error(`No hay usuario TENANT_ADMIN en tenant '${SLUG}'.`);

  let nVessels = 0;
  for (const b of BARGES) {
    nVessels++;
    if (!DRY) {
      await prisma.vessel.upsert({
        where: { tenantId_code: { tenantId: tid, code: b.codigo } },
        update: {
          name: b.nombre,
          owner: b.armador,
          vesselType: b.tipo,
          imo: b.imo ?? null,
          registration: b.matricula ?? null,
          powerHp: b.potencia ?? null,
          dwtTons: b.dwt ?? null,
          lengthM: b.eslora ?? null,
          beamM: b.manga ?? null,
          depthM: b.puntal ?? null,
          trnTn: b.trn ?? null,
          trbTn: b.trb ?? null,
          buildYear: b.anioConstruccion ?? null,
          buildCountry: b.paisConstruccion ?? null,
          incorporationDate: b.fechaIncorporacion ?? null,
          incorporationType: b.tipoIncorporacion ?? null,
          updatedByUserId: uid,
        },
        create: {
          tenantId: tid,
          code: b.codigo,
          name: b.nombre,
          owner: b.armador,
          vesselType: b.tipo,
          imo: b.imo ?? null,
          registration: b.matricula ?? null,
          powerHp: b.potencia ?? null,
          dwtTons: b.dwt ?? null,
          lengthM: b.eslora ?? null,
          beamM: b.manga ?? null,
          depthM: b.puntal ?? null,
          trnTn: b.trn ?? null,
          trbTn: b.trb ?? null,
          buildYear: b.anioConstruccion ?? null,
          buildCountry: b.paisConstruccion ?? null,
          incorporationDate: b.fechaIncorporacion ?? null,
          incorporationType: b.tipoIncorporacion ?? null,
          status: "ACTIVE",
          createdByUserId: uid,
          updatedByUserId: uid,
        },
      });
    }
    console.log(`${DRY ? "DRY " : "✓ "}Vessel ${b.codigo} — ${b.nombre} (${b.tipo})`);
  }

  console.log(`\n${DRY ? "DRY-RUN (no se escribió nada). " : "✅ Completado. "}${nVessels} barcazas cargadas.`);
}

main()
  .catch((e) => {
    console.error("❌ Error:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
