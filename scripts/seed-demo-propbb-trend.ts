// Demo data seed — serie histórica de aceite para "Sistema de Propulsión — Babor"
// (LATERE, tenant demo) para densificar la TENDENCIA del gráfico. Línea base
// estable y deterioro progresivo, interpolando todos los parámetros por t.
// Las anclas coinciden con las 3 muestras ya existentes (NORMAL/PRECAUCIÓN/CRÍTICO)
// para que la serie empalme. Idempotente por marker.
//
// Uso (VPS, cwd /app, DATABASE_URL exportada):
//   node_modules/.bin/tsx tmp-pb.ts          → aplica
//   DRY=1 node_modules/.bin/tsx tmp-pb.ts     → previsualiza
//   REVERT=1 node_modules/.bin/tsx tmp-pb.ts  → borra (hard) lo creado por este seed
import { PrismaClient } from "./generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) } as any);

const TENANT_ID = "cmoj4a1xt00006xl4rhzzatpn"; // demo
const VESSEL = "LATERE";
const ASSET = "cmozw0p9d034dphl4955iaij4"; // Sistema de Propulsión — Babor
const MARKER = "seed-demo-propbb";
const DRY = process.env.DRY === "1";
const REVERT = process.env.REVERT === "1";
const FORCE = process.env.FORCE === "1";

function daysAgo(n: number): Date { const d = new Date(); d.setHours(9, 0, 0, 0); d.setDate(d.getDate() - n); return d; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

function params(t: number): Record<string, { value: number; unit: string }> {
  return {
    "Viscosidad 100°C":     { value: r1(lerp(13.8, 10.9, t)), unit: "cSt" },
    "TBN":                  { value: r1(lerp(28, 6, t)),      unit: "mgKOH/g" },
    "Agua":                 { value: r2(lerp(0.04, 0.42, t)), unit: "%" },
    "Dilución combustible": { value: r1(lerp(1.4, 7.5, t)),   unit: "%" },
    "Hollín":               { value: r1(lerp(0.4, 2.5, t)),   unit: "%" },
    "Oxidación":            { value: r0(lerp(8, 34, t)),      unit: "Abs/cm" },
    "Hierro (Fe)":          { value: r0(lerp(21, 175, t)),    unit: "ppm" },
    "Cobre (Cu)":           { value: r0(lerp(5, 40, t)),      unit: "ppm" },
    "Plomo (Pb)":           { value: r0(lerp(4, 27, t)),      unit: "ppm" },
    "Cromo (Cr)":           { value: r0(lerp(2, 18, t)),      unit: "ppm" },
    "Silicio (Si)":         { value: r0(lerp(6, 33, t)),      unit: "ppm" },
    "Sodio (Na)":           { value: r0(lerp(8, 58, t)),      unit: "ppm" },
    "Índice PQ":            { value: r0(lerp(11, 140, t)),    unit: "" },
  };
}

type Verdict = "NORMAL" | "CAUTION" | "CRITICAL";
function summaryFor(v: Verdict): string {
  if (v === "CRITICAL") return "Desgaste severo de hierro y TBN agotado — deterioro acelerado. Cambio inmediato e inspección.";
  if (v === "CAUTION")  return "Aumento sostenido de hierro y caída de TBN. Tendencia desfavorable; monitorear de cerca.";
  return "Parámetros normales. Lubricante apto.";
}

interface Pt { dayAgo: number; t: number; verdict: Verdict; rh: number; }
// Complementa las 3 muestras existentes (-95 NORMAL, -50 PRECAUCIÓN, -12 CRÍTICO).
const SERIES: Pt[] = [
  { dayAgo: 320, t: 0.00, verdict: "NORMAL",  rh: 25800 },
  { dayAgo: 260, t: 0.03, verdict: "NORMAL",  rh: 26300 },
  { dayAgo: 200, t: 0.05, verdict: "NORMAL",  rh: 26900 },
  { dayAgo: 150, t: 0.08, verdict: "NORMAL",  rh: 27400 },
  { dayAgo: 75,  t: 0.22, verdict: "CAUTION", rh: 28800 },
  { dayAgo: 35,  t: 0.62, verdict: "CAUTION", rh: 29900 },
];

async function main() {
  if (REVERT) {
    const s = await prisma.fluidSample.findMany({ where: { tenantId: TENANT_ID, vesselCode: VESSEL, createdByUserId: MARKER }, select: { id: true } });
    const ids = s.map(x => x.id);
    if (DRY) { console.log(`DRY REVERT: ${ids.length} samples`); await prisma.$disconnect(); return; }
    await prisma.fluidAnalysisResult.deleteMany({ where: { sampleId: { in: ids } } });
    await prisma.fluidSample.deleteMany({ where: { id: { in: ids } } });
    console.log(`REVERT OK: ${ids.length} samples`);
    await prisma.$disconnect();
    return;
  }

  const already = await prisma.fluidSample.count({ where: { tenantId: TENANT_ID, vesselCode: VESSEL, createdByUserId: MARKER } });
  if (already > 0 && !FORCE) { console.log(`Ya existen ${already} de este seed. FORCE=1 o REVERT=1.`); await prisma.$disconnect(); return; }

  let seq = await prisma.fluidSample.count({ where: { tenantId: TENANT_ID, vesselCode: VESSEL } });
  let created = 0;
  for (const p of SERIES) {
    seq++;
    const sampleCode = `FS-${VESSEL}-${String(seq).padStart(4, "0")}`;
    const sampledAt = daysAgo(p.dayAgo);
    const pr = params(p.t);
    if (DRY) { console.log(`WOULD CREATE ${sampleCode} · -${p.dayAgo}d · ${p.verdict} · Fe ${pr["Hierro (Fe)"].value} · TBN ${pr["TBN"].value} · ${p.rh}h`); created++; continue; }
    const sample = await prisma.fluidSample.create({
      data: {
        tenantId: TENANT_ID, vesselCode: VESSEL, assetId: ASSET, sampleCode,
        kind: "FLUID", fluidType: "ENGINE_OIL", fluidProduct: "Shell Argina S3 40",
        sampledAt, runningHours: p.rh, sentAt: addDays(sampledAt, 1),
        labName: "WearCheck", labReference: `WC-${String(seq).padStart(4, "0")}`,
        status: "REPORTED", notes: "Serie histórica (demo).",
        createdByUserId: MARKER, updatedByUserId: MARKER,
      },
    });
    await prisma.fluidAnalysisResult.create({
      data: {
        tenantId: TENANT_ID, sampleId: sample.id, receivedAt: addDays(sampledAt, 4),
        verdict: p.verdict as any, summary: summaryFor(p.verdict),
        parameters: pr as any, enteredByUserId: MARKER,
      },
    });
    created++;
  }
  console.log(`${DRY ? "DRY — " : ""}created=${created} (Propulsión Babor — serie histórica)`);
  await prisma.$disconnect();
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
