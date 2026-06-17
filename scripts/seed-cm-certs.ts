// Demo data seed — certificados estatutarios SOLAS del buque ACE DEFENDER,
// tenant "Capital Maritima" (capitalmaritima). Datos ficticios pero plausibles.
// Mayoría ACTIVE, 1 EXPIRING_SOON y 1 EXPIRED para mostrar las alertas.
// El status se computa por expiryDate (>30d ACTIVE, <=30d EXPIRING_SOON, <0 EXPIRED).
// Idempotente: salta los que ya existen por certificateCode.
//
// Uso (VPS, cwd /app, DATABASE_URL exportada):
//   node_modules/.bin/tsx tmp-seed-certs.ts          → aplica
//   DRY=1 node_modules/.bin/tsx tmp-seed-certs.ts     → previsualiza
//   REVERT=1 node_modules/.bin/tsx tmp-seed-certs.ts  → borra (soft) los creados por este seed
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

const today = new Date(); today.setHours(0, 0, 0, 0);
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }

type Kind = "ACTIVE" | "EXPIRING" | "EXPIRED";
interface CertDef { code: string; name: string; authority: string; reg: string; kind: Kind; issueMonthsAgo?: number; validityY?: number; }

const CERTS: CertDef[] = [
  { code: "SCC",  name: "Cargo Ship Safety Construction Certificate", authority: "RINA Brasil",          reg: "SOLAS Cap. I, Reg. 12",        kind: "ACTIVE",   issueMonthsAgo: 26, validityY: 5 },
  { code: "SEC",  name: "Cargo Ship Safety Equipment Certificate",    authority: "RINA Brasil",          reg: "SOLAS Cap. I, Reg. 12",        kind: "EXPIRING" },
  { code: "SRC",  name: "Cargo Ship Safety Radio Certificate",        authority: "RINA Brasil",          reg: "SOLAS Cap. I, Reg. 12",        kind: "EXPIRED" },
  { code: "SMC",  name: "Safety Management Certificate (SMC)",        authority: "RINA Brasil",          reg: "SOLAS Cap. IX (ISM Code)",     kind: "ACTIVE",   issueMonthsAgo: 20, validityY: 5 },
  { code: "DOC",  name: "Document of Compliance (DOC)",               authority: "RINA Brasil",          reg: "SOLAS Cap. IX (ISM Code)",     kind: "ACTIVE",   issueMonthsAgo: 30, validityY: 5 },
  { code: "ISSC", name: "International Ship Security Certificate",     authority: "RINA Brasil",          reg: "SOLAS Cap. XI-2 (ISPS Code)",  kind: "ACTIVE",   issueMonthsAgo: 8,  validityY: 5 },
  { code: "MSMD", name: "Minimum Safe Manning Document",              authority: "Marinha do Brasil — DPC", reg: "SOLAS Cap. V, Reg. 14",     kind: "ACTIVE",   issueMonthsAgo: 36, validityY: 10 },
  { code: "ILLC", name: "International Load Line Certificate",         authority: "RINA Brasil",          reg: "LL 66 — estatutario SOLAS",    kind: "ACTIVE",   issueMonthsAgo: 40, validityY: 5 },
];

function datesFor(c: CertDef): { issue: Date; expiry: Date; lastInsp: Date; status: string } {
  if (c.kind === "EXPIRING") {
    const expiry = addDays(today, 18);
    return { issue: addMonths(expiry, -60), expiry, lastInsp: addMonths(today, -11), status: "EXPIRING_SOON" };
  }
  if (c.kind === "EXPIRED") {
    const expiry = addDays(today, -12);
    return { issue: addMonths(expiry, -60), expiry, lastInsp: addMonths(today, -13), status: "EXPIRED" };
  }
  const issue = addMonths(today, -(c.issueMonthsAgo ?? 24));
  const expiry = addMonths(issue, (c.validityY ?? 5) * 12);
  return { issue, expiry, lastInsp: addMonths(today, -3), status: "ACTIVE" };
}

async function main() {
  if (REVERT) {
    const codes = CERTS.map(c => c.code);
    const rows = await prisma.certificate.findMany({ where: { tenantId: TENANT_ID, vesselCode: VESSEL, certificateCode: { in: codes }, deletedAt: null }, select: { id: true } });
    if (DRY) { console.log(`DRY REVERT: ${rows.length} certificados se marcarían como borrados`); await prisma.$disconnect(); return; }
    for (const r of rows) await prisma.certificate.update({ where: { id: r.id }, data: { deletedAt: new Date(), deletedByUserId: SEED_USER } });
    console.log(`REVERT OK: ${rows.length} certificados borrados (soft)`);
    await prisma.$disconnect();
    return;
  }

  let created = 0, skipped = 0;
  const out: string[] = [];

  for (const c of CERTS) {
    const exists = await prisma.certificate.findFirst({ where: { tenantId: TENANT_ID, vesselCode: VESSEL, certificateCode: c.code, deletedAt: null } });
    if (exists) { skipped++; out.push(`SKIP (ya existe): ${c.code}`); continue; }
    const d = datesFor(c);
    out.push(`${DRY ? "WOULD CREATE" : "CREATE"} ${c.code} · ${c.name} · ${c.authority} · venc ${d.expiry.toISOString().slice(0, 10)} · ${d.status}`);
    if (DRY) { created++; continue; }
    await prisma.certificate.create({
      data: {
        tenantId: TENANT_ID, vesselCode: VESSEL, certificateCode: c.code,
        name: c.name, issuingAuthority: c.authority, status: d.status as any,
        issueDate: d.issue, expiryDate: d.expiry, lastInspectionDate: d.lastInsp,
        notes: `${c.reg} — survey anual / endosos al día`,
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
