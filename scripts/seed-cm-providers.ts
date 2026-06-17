// Demo data seed — 10 proveedores marítimos (Brasil) para tenant "Capital
// Maritima" (capitalmaritima), vessel ACEDEF. Datos ficticios pero plausibles.
// Idempotente: salta los que ya existen por nombre. providerCode se autogenera
// PRV-ACEDEF-NNNN continuando la numeración existente.
//
// Uso (VPS, cwd /app, DATABASE_URL exportada):
//   node_modules/.bin/tsx tmp-seed-prov.ts          → aplica
//   DRY=1 node_modules/.bin/tsx tmp-seed-prov.ts     → previsualiza
//   REVERT=1 node_modules/.bin/tsx tmp-seed-prov.ts  → borra (soft) los creados por este seed
import { PrismaClient } from "./generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

const TENANT_ID = "cmorbemkq003bful4e5w6zkqc"; // Capital Maritima
const VESSEL = "ACEDEF";
const DRY = process.env.DRY === "1";
const REVERT = process.env.REVERT === "1";
const SEED_USER = "system";

const PROVIDERS = [
  { name: "Wilson Sons Agência Marítima",            category: "Agência/Logística",        contactName: "Carlos Eduardo Ramos",  contactEmail: "operacoes@wilsonsons.com.br",   contactPhone: "+55 21 3504-4000", location: "Rio de Janeiro, RJ", status: "ACTIVE" },
  { name: "Bravante Reparos Navais",                 category: "Serviços/Reparos",         contactName: "Marcos Vinícius Lima",  contactEmail: "comercial@bravante.com.br",     contactPhone: "+55 21 2199-7000", location: "Niterói, RJ",        status: "ACTIVE" },
  { name: "Vibra Energia — Marine Fuels",            category: "Combustível",              contactName: "Patrícia Gonçalves",    contactEmail: "marine@vibraenergia.com.br",    contactPhone: "+55 13 3221-5000", location: "Santos, SP",         status: "ACTIVE" },
  { name: "Ipiranga Lubrificantes Marítimos",        category: "Lubrificantes",            contactName: "Rafael Antunes",        contactEmail: "lubrificantes@ipiranga.com.br", contactPhone: "+55 13 3878-2200", location: "Santos, SP",         status: "ACTIVE" },
  { name: "Wärtsilä do Brasil Ltda",                 category: "Sobressalentes (Motores)", contactName: "Anderson Tavares",      contactEmail: "parts.brasil@wartsila.com",     contactPhone: "+55 21 3478-9000", location: "Rio de Janeiro, RJ", status: "ACTIVE" },
  { name: "SAM Eletrônica Naval",                    category: "Eletrônica/Navegação",     contactName: "Juliana Prado",         contactEmail: "suporte@samnaval.com.br",       contactPhone: "+55 47 3348-6600", location: "Itajaí, SC",         status: "ACTIVE" },
  { name: "Sea Safety do Brasil",                    category: "Segurança/LSA",            contactName: "Fernando Coelho",       contactEmail: "atendimento@seasafety.com.br",  contactPhone: "+55 53 3231-4400", location: "Rio Grande, RS",     status: "ACTIVE" },
  { name: "International Tintas Marítimas",           category: "Pintura/Revestimento",     contactName: "Luciana Borges",        contactEmail: "marine.brasil@akzonobel.com",   contactPhone: "+55 13 3296-7100", location: "Guarujá, SP",        status: "ACTIVE" },
  { name: "RINA Brasil Classificação",               category: "Classe/Certificação",      contactName: "Eduardo Sampaio",       contactEmail: "brasil@rina.org",               contactPhone: "+55 21 2220-3344", location: "Rio de Janeiro, RJ", status: "ACTIVE" },
  { name: "Kongsberg Maritime Brasil",               category: "Propulsão/Thrusters",      contactName: "Bruno Carvalho",        contactEmail: "brasil.service@kongsberg.com",  contactPhone: "+55 22 2106-8800", location: "Macaé, RJ",          status: "INACTIVE" },
];

async function main() {
  if (REVERT) {
    const names = PROVIDERS.map(p => p.name);
    const rows = await prisma.provider.findMany({ where: { tenantId: TENANT_ID, vesselCode: VESSEL, name: { in: names }, deletedAt: null }, select: { id: true, name: true } });
    if (DRY) { console.log(`DRY REVERT: ${rows.length} proveedores se marcarían como borrados`); await prisma.$disconnect(); return; }
    for (const r of rows) await prisma.provider.update({ where: { id: r.id }, data: { deletedAt: new Date(), deletedByUserId: SEED_USER } });
    console.log(`REVERT OK: ${rows.length} proveedores borrados (soft)`);
    await prisma.$disconnect();
    return;
  }

  let base = await prisma.provider.count({ where: { tenantId: TENANT_ID, vesselCode: VESSEL } });
  let created = 0, skipped = 0;
  const out: string[] = [];

  for (const p of PROVIDERS) {
    const exists = await prisma.provider.findFirst({ where: { tenantId: TENANT_ID, vesselCode: VESSEL, name: p.name, deletedAt: null } });
    if (exists) { skipped++; out.push(`SKIP (ya existe): ${p.name}`); continue; }
    base++;
    const providerCode = `PRV-${VESSEL}-${String(base).padStart(4, "0")}`;
    out.push(`${DRY ? "WOULD CREATE" : "CREATE"} ${providerCode} · ${p.name} · ${p.category} · ${p.location} · ${p.status}`);
    if (DRY) { created++; continue; }
    await prisma.provider.create({
      data: {
        tenantId: TENANT_ID, vesselCode: VESSEL, providerCode,
        name: p.name, category: p.category, status: p.status as "ACTIVE" | "INACTIVE",
        contactName: p.contactName, contactEmail: p.contactEmail, contactPhone: p.contactPhone, location: p.location,
        createdByUserId: SEED_USER, updatedByUserId: SEED_USER,
      },
    });
    created++;
  }

  console.log(out.join("\n"));
  console.log(`\n${DRY ? "DRY — " : ""}created=${created} skipped=${skipped}`);
  await prisma.$disconnect();
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
