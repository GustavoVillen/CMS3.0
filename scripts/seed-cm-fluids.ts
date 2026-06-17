// Demo data seed — 11 análisis de fluido (aceite de motor) para los generadores
// y motores principales del buque ACE DEFENDER (tenant Capital Maritima).
// Parámetros realistas + verdicts que disparan insights de IA:
//   - Motor Principal Bombordo: 1 CRITICAL  → insight fluid_analysis_critical
//   - Grupo Gerador N°1:        2 CAUTION   → insight fluid_analysis_caution_trend
// Al final invoca generateInsightsForTenant() para materializar los AiInsight.
//
// Uso (VPS, cwd /app, DATABASE_URL exportada):
//   node_modules/.bin/tsx tmp-seed-fluids.ts          → aplica + genera insights
//   DRY=1 node_modules/.bin/tsx tmp-seed-fluids.ts     → previsualiza
//   REVERT=1 node_modules/.bin/tsx tmp-seed-fluids.ts  → borra (hard) lo creado por este seed
import { PrismaClient } from "./generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { generateInsightsForTenant } from "./apps/api/src/tenant/ai-insights/insight-generator";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

const TENANT_ID = "cmorbemkq003bful4e5w6zkqc"; // Capital Maritima
const VESSEL = "ACEDEF";
const MARKER = "seed-demo-fluids"; // createdByUserId, para identificar/revertir
const DRY = process.env.DRY === "1";
const REVERT = process.env.REVERT === "1";
const FORCE = process.env.FORCE === "1";

const A = {
  MP_BB:  "cmpe5apkt00ekgql4i6a5pdi4", // Motor Principal Bombordo
  MP_EB:  "cmpe5apku00elgql4z2n8m10v", // Motor Principal Estibordo
  GE_01:  "cmpe5apkv00emgql4lpz7vlvt", // Grupo Gerador N°1
  GE_02:  "cmpe5apkw00engql4e8zrc0u3", // Grupo Gerador N°2
  GE_03:  "cmpe5apky00eogql467s6yrzb", // Grupo Gerador N°3
  GE_EMG: "cmpe5apkz00epgql4webw7axl", // Gerador de Emergência
};

type Verdict = "NORMAL" | "CAUTION" | "CRITICAL";

function daysAgo(n: number): Date { const d = new Date(); d.setHours(9, 0, 0, 0); d.setDate(d.getDate() - n); return d; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// Perfil de parámetros de aceite de motor coherente con el verdict.
function params(verdict: Verdict, j: number): Record<string, { value: number; unit: string }> {
  if (verdict === "CRITICAL") return {
    "Viscosidade 100°C": { value: 10.9 - j * 0.1, unit: "cSt" },
    "TBN":               { value: 6 - j * 0.3,    unit: "mgKOH/g" },
    "Água":              { value: 0.45 + j * 0.02, unit: "%" },
    "Diluição combustível": { value: 7.8 + j * 0.2, unit: "%" },
    "Fuligem":           { value: 2.6,  unit: "%" },
    "Oxidação":          { value: 35,   unit: "Abs/cm" },
    "Ferro (Fe)":        { value: 180 + j * 6, unit: "ppm" },
    "Cobre (Cu)":        { value: 42,   unit: "ppm" },
    "Chumbo (Pb)":       { value: 28,   unit: "ppm" },
    "Cromo (Cr)":        { value: 19,   unit: "ppm" },
    "Silício (Si)":      { value: 35,   unit: "ppm" },
    "Sódio (Na)":        { value: 60,   unit: "ppm" },
    "Índice PQ":         { value: 145,  unit: "" },
  };
  if (verdict === "CAUTION") return {
    "Viscosidade 100°C": { value: 12.4 + j * 0.05, unit: "cSt" },
    "TBN":               { value: 14 - j * 0.5,    unit: "mgKOH/g" },
    "Água":              { value: 0.12, unit: "%" },
    "Diluição combustível": { value: 3.2 + j * 0.1, unit: "%" },
    "Fuligem":           { value: 1.1,  unit: "%" },
    "Oxidação":          { value: 18,   unit: "Abs/cm" },
    "Ferro (Fe)":        { value: 65 + j * 4, unit: "ppm" },
    "Cobre (Cu)":        { value: 18,   unit: "ppm" },
    "Chumbo (Pb)":       { value: 9,    unit: "ppm" },
    "Cromo (Cr)":        { value: 6,    unit: "ppm" },
    "Silício (Si)":      { value: 14,   unit: "ppm" },
    "Sódio (Na)":        { value: 22,   unit: "ppm" },
    "Índice PQ":         { value: 38,   unit: "" },
  };
  return {
    "Viscosidade 100°C": { value: 13.8, unit: "cSt" },
    "TBN":               { value: 28 - j * 0.4, unit: "mgKOH/g" },
    "Água":              { value: 0.05, unit: "%" },
    "Diluição combustível": { value: 1.5, unit: "%" },
    "Fuligem":           { value: 0.4,  unit: "%" },
    "Oxidação":          { value: 8,    unit: "Abs/cm" },
    "Ferro (Fe)":        { value: 22 + j * 2, unit: "ppm" },
    "Cobre (Cu)":        { value: 5,    unit: "ppm" },
    "Chumbo (Pb)":       { value: 4,    unit: "ppm" },
    "Cromo (Cr)":        { value: 2,    unit: "ppm" },
    "Silício (Si)":      { value: 6,    unit: "ppm" },
    "Sódio (Na)":        { value: 8,    unit: "ppm" },
    "Índice PQ":         { value: 12,   unit: "" },
  };
}

function summaryFor(v: Verdict): string {
  if (v === "CRITICAL") return "Desgaste severo de ferro (Fe alto) e TBN esgotado; diluição por combustível e indício de entrada de refrigerante (Na). Recomenda-se troca imediata e inspeção do equipamento.";
  if (v === "CAUTION")  return "Tendência de aumento de ferro e queda de TBN; viscosidade no limite inferior. Monitorar com maior frequência.";
  return "Parâmetros dentro dos limites normais. Lubrificante apto para serviço.";
}

const PROD = { MP: "ExxonMobil Mobilgard 540 (SAE 40)", GE: "Shell Argina S3 40", EMG: "Shell Rimula R4 X 15W-40" };

interface SampleDef { asset: string; verdict: Verdict; dayAgo: number; rh: number; product: string; }
const SAMPLES: SampleDef[] = [
  { asset: A.MP_BB,  verdict: "CRITICAL", dayAgo: 12, rh: 26450, product: PROD.MP },
  { asset: A.MP_BB,  verdict: "NORMAL",   dayAgo: 70, rh: 25100, product: PROD.MP },
  { asset: A.MP_EB,  verdict: "CAUTION",  dayAgo: 15, rh: 24800, product: PROD.MP },
  { asset: A.MP_EB,  verdict: "NORMAL",   dayAgo: 68, rh: 23500, product: PROD.MP },
  { asset: A.GE_01,  verdict: "CAUTION",  dayAgo: 10, rh: 41200, product: PROD.GE },
  { asset: A.GE_01,  verdict: "CAUTION",  dayAgo: 55, rh: 40100, product: PROD.GE },
  { asset: A.GE_02,  verdict: "NORMAL",   dayAgo: 14, rh: 38800, product: PROD.GE },
  { asset: A.GE_02,  verdict: "NORMAL",   dayAgo: 60, rh: 37600, product: PROD.GE },
  { asset: A.GE_03,  verdict: "NORMAL",   dayAgo: 18, rh: 35200, product: PROD.GE },
  { asset: A.GE_03,  verdict: "NORMAL",   dayAgo: 62, rh: 34000, product: PROD.GE },
  { asset: A.GE_EMG, verdict: "NORMAL",   dayAgo: 20, rh: 5200,  product: PROD.EMG },
];

async function main() {
  if (REVERT) {
    const samples = await prisma.fluidSample.findMany({ where: { tenantId: TENANT_ID, vesselCode: VESSEL, createdByUserId: MARKER }, select: { id: true } });
    const ids = samples.map(s => s.id);
    if (DRY) { console.log(`DRY REVERT: ${ids.length} samples (+ resultados) se borrarían`); await prisma.$disconnect(); return; }
    await prisma.fluidAnalysisResult.deleteMany({ where: { sampleId: { in: ids } } });
    await prisma.fluidSample.deleteMany({ where: { id: { in: ids } } });
    console.log(`REVERT OK: ${ids.length} samples borrados`);
    await prisma.$disconnect();
    return;
  }

  const already = await prisma.fluidSample.count({ where: { tenantId: TENANT_ID, vesselCode: VESSEL, createdByUserId: MARKER } });
  if (already > 0 && !FORCE) { console.log(`Ya existen ${already} samples de este seed. Usá FORCE=1 para re-crear o REVERT=1 para borrar.`); await prisma.$disconnect(); return; }

  const base = await prisma.fluidSample.count({ where: { tenantId: TENANT_ID, vesselCode: VESSEL } });
  let seq = base;
  let created = 0;
  const counts: Record<string, number> = {};
  for (let i = 0; i < SAMPLES.length; i++) {
    const s = SAMPLES[i];
    seq++;
    const sampleCode = `FS-${VESSEL}-${String(seq).padStart(4, "0")}`;
    const sampledAt = daysAgo(s.dayAgo);
    const receivedAt = addDays(sampledAt, 5);
    counts[s.verdict] = (counts[s.verdict] ?? 0) + 1;
    if (DRY) { console.log(`WOULD CREATE ${sampleCode} · ${s.asset.slice(-6)} · ${s.verdict} · toma -${s.dayAgo}d · ${s.rh}h`); created++; continue; }

    const sample = await prisma.fluidSample.create({
      data: {
        tenantId: TENANT_ID, vesselCode: VESSEL, assetId: s.asset, sampleCode,
        kind: "FLUID", fluidType: "ENGINE_OIL", fluidProduct: s.product,
        sampledAt, runningHours: s.rh, sentAt: addDays(sampledAt, 1),
        labName: "WearCheck Brasil", labReference: `WC-2026-${String(seq).padStart(4, "0")}`,
        status: "REPORTED", notes: "Amostra de rotina (demo).",
        createdByUserId: MARKER, updatedByUserId: MARKER,
      },
    });
    await prisma.fluidAnalysisResult.create({
      data: {
        tenantId: TENANT_ID, sampleId: sample.id, receivedAt,
        verdict: s.verdict as any, summary: summaryFor(s.verdict),
        parameters: params(s.verdict, i % 3) as any, enteredByUserId: MARKER,
      },
    });
    created++;
  }

  console.log(`${DRY ? "DRY — " : ""}samples=${created} verdicts=${JSON.stringify(counts)}`);

  if (!DRY) {
    const n = await generateInsightsForTenant(TENANT_ID);
    console.log(`generateInsightsForTenant → ${n} insights upserted`);
    const fluid = await prisma.aiInsight.findMany({ where: { tenantId: TENANT_ID, insightType: { in: ["fluid_analysis_critical", "fluid_analysis_caution_trend"] as any }, status: "OPEN" }, select: { insightType: true, priority: true, title: true } });
    console.log("FLUID INSIGHTS:", JSON.stringify(fluid, null, 2));
  }
  await prisma.$disconnect();
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
