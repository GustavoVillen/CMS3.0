// Demo data seed — serie temporal de análisis de aceite para el Motor Principal
// Bombordo (ACE DEFENDER / Capital Maritima) para mostrar TENDENCIA en el gráfico.
// Línea base estable (NORMAL) y luego deterioro progresivo (Fe ↑, TBN ↓, etc.)
// que converge en la muestra CRÍTICA ya existente (-12d). Todos los parámetros
// se interpolan con un factor t, así cualquier serie del gráfico muestra tendencia.
//
// Uso (VPS, cwd /app, DATABASE_URL exportada):
//   node_modules/.bin/tsx tmp-mpbb.ts          → aplica
//   DRY=1 node_modules/.bin/tsx tmp-mpbb.ts     → previsualiza
//   REVERT=1 node_modules/.bin/tsx tmp-mpbb.ts  → borra (hard) lo creado por este seed
import { PrismaClient } from "./generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) } as any);

const TENANT_ID = "cmorbemkq003bful4e5w6zkqc";
const VESSEL = "ACEDEF";
const ASSET_MP_BB = "cmpe5apkt00ekgql4i6a5pdi4";
const MARKER = "seed-demo-mpbb";
const DRY = process.env.DRY === "1";
const REVERT = process.env.REVERT === "1";
const FORCE = process.env.FORCE === "1";

function daysAgo(n: number): Date { const d = new Date(); d.setHours(9, 0, 0, 0); d.setDate(d.getDate() - n); return d; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

// Anclas NORMAL (t=0) → CRÍTICO (t=1). Todo interpola por t.
function params(t: number): Record<string, { value: number; unit: string }> {
  return {
    "Viscosidade 100°C":    { value: r1(lerp(13.9, 10.9, t)), unit: "cSt" },
    "TBN":                  { value: r1(lerp(29, 6, t)),      unit: "mgKOH/g" },
    "Água":                 { value: r2(lerp(0.04, 0.45, t)), unit: "%" },
    "Diluição combustível": { value: r1(lerp(1.4, 7.8, t)),   unit: "%" },
    "Fuligem":              { value: r1(lerp(0.4, 2.6, t)),   unit: "%" },
    "Oxidação":             { value: r0(lerp(8, 35, t)),      unit: "Abs/cm" },
    "Ferro (Fe)":           { value: r0(lerp(20, 180, t)),    unit: "ppm" },
    "Cobre (Cu)":           { value: r0(lerp(5, 42, t)),      unit: "ppm" },
    "Chumbo (Pb)":          { value: r0(lerp(4, 28, t)),      unit: "ppm" },
    "Cromo (Cr)":           { value: r0(lerp(2, 19, t)),      unit: "ppm" },
    "Silício (Si)":         { value: r0(lerp(6, 35, t)),      unit: "ppm" },
    "Sódio (Na)":           { value: r0(lerp(8, 60, t)),      unit: "ppm" },
    "Índice PQ":            { value: r0(lerp(11, 145, t)),    unit: "" },
  };
}

type Verdict = "NORMAL" | "CAUTION" | "CRITICAL";
interface Pt { dayAgo: number; t: number; verdict: Verdict; rh: number; }
// La serie complementa las 2 muestras MP_BB ya existentes (-70d NORMAL, -12d CRÍTICO).
const SERIES: Pt[] = [
  { dayAgo: 300, t: 0.00, verdict: "NORMAL",   rh: 18800 },
  { dayAgo: 240, t: 0.03, verdict: "NORMAL",   rh: 20100 },
  { dayAgo: 180, t: 0.05, verdict: "NORMAL",   rh: 21400 },
  { dayAgo: 120, t: 0.08, verdict: "NORMAL",   rh: 22700 },
  { dayAgo: 55,  t: 0.32, verdict: "CAUTION",  rh: 25600 },
  { dayAgo: 40,  t: 0.58, verdict: "CAUTION",  rh: 25950 },
  { dayAgo: 25,  t: 0.82, verdict: "CRITICAL", rh: 26250 },
];

function summaryFor(v: Verdict): string {
  if (v === "CRITICAL") return "Desgaste severo de ferro e TBN esgotado — deterioração acelerada. Troca imediata e inspeção.";
  if (v === "CAUTION")  return "Aumento sustentado de ferro e queda de TBN. Tendência desfavorável; monitorar de perto.";
  return "Parâmetros normais. Lubrificante apto.";
}

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
  if (already > 0 && !FORCE) { console.log(`Ya existen ${already} de este seed. FORCE=1 para re-crear o REVERT=1 para borrar.`); await prisma.$disconnect(); return; }

  let seq = await prisma.fluidSample.count({ where: { tenantId: TENANT_ID, vesselCode: VESSEL } });
  let created = 0;
  for (const p of SERIES) {
    seq++;
    const sampleCode = `FS-${VESSEL}-${String(seq).padStart(4, "0")}`;
    const sampledAt = daysAgo(p.dayAgo);
    const pr = params(p.t);
    if (DRY) { console.log(`WOULD CREATE ${sampleCode} · -${p.dayAgo}d · ${p.verdict} · Fe ${pr["Ferro (Fe)"].value} · TBN ${pr["TBN"].value} · ${p.rh}h`); created++; continue; }
    const sample = await prisma.fluidSample.create({
      data: {
        tenantId: TENANT_ID, vesselCode: VESSEL, assetId: ASSET_MP_BB, sampleCode,
        kind: "FLUID", fluidType: "ENGINE_OIL", fluidProduct: "ExxonMobil Mobilgard 540 (SAE 40)",
        sampledAt, runningHours: p.rh, sentAt: addDays(sampledAt, 1),
        labName: "WearCheck Brasil", labReference: `WC-2026-${String(seq).padStart(4, "0")}`,
        status: "REPORTED", notes: "Série histórica (demo).",
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
  console.log(`${DRY ? "DRY — " : ""}created=${created} (MP Bombordo serie histórica)`);
  await prisma.$disconnect();
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
