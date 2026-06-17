// Demo data seed — análisis de fluido (aceite de motor) para tenant "demo",
// buque LATERE. 13 muestras cubriendo los 9 motores: serie deteriorándose en
// Propulsión Babor (NORMAL→PRECAUCIÓN→CRÍTICO) y tendencia de precaución en el
// Auxiliar N°1. Etiquetas en español. Idempotente por marker.
//
// Uso (VPS, cwd /app, DATABASE_URL exportada):
//   node_modules/.bin/tsx tmp-demo.ts          → aplica
//   DRY=1 node_modules/.bin/tsx tmp-demo.ts     → previsualiza
//   REVERT=1 node_modules/.bin/tsx tmp-demo.ts  → borra (hard) lo creado por este seed
import { PrismaClient } from "./generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) } as any);

const TENANT_ID = "cmoj4a1xt00006xl4rhzzatpn"; // demo
const VESSEL = "LATERE";
const MARKER = "seed-demo-fluids";
const DRY = process.env.DRY === "1";
const REVERT = process.env.REVERT === "1";
const FORCE = process.env.FORCE === "1";

const A = {
  AUX1:  "cmozw0p91033zphl4sff3pwdj", // Motor Auxiliar N°1 (Babor)
  AUX2:  "cmozw0p920340phl41tnbsmsc", // Motor Auxiliar N°2 (Estribor)
  AUX3:  "cmozw0p930341phl4bnuggaf4", // Motor Auxiliar N°3 (Puerto)
  LAN1:  "cmozw0p9b034bphl4yrsqj1h7", // Lancha de Trabajo 1
  LAN2:  "cmozw0p9c034cphl4o9nheb12", // Lancha de Trabajo 2
  PROPBB:  "cmozw0p9d034dphl4955iaij4", // Propulsión Babor
  PROPBBC: "cmozw0p9e034ephl4gxs4hlmn", // Propulsión Babor Centro
  PROPEB:  "cmozw0p9f034fphl47pvou9wa", // Propulsión Estribor
  PROPEBC: "cmozw0p9f034gphl4hig2vkbf", // Propulsión Estribor Centro
};

type Verdict = "NORMAL" | "CAUTION" | "CRITICAL";
function daysAgo(n: number): Date { const d = new Date(); d.setHours(9, 0, 0, 0); d.setDate(d.getDate() - n); return d; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function params(v: Verdict, j: number): Record<string, { value: number; unit: string }> {
  if (v === "CRITICAL") return {
    "Viscosidad 100°C": { value: 10.9 - j * 0.1, unit: "cSt" },
    "TBN":              { value: 6 - j * 0.3,   unit: "mgKOH/g" },
    "Agua":             { value: 0.42 + j * 0.02, unit: "%" },
    "Dilución combustible": { value: 7.5 + j * 0.2, unit: "%" },
    "Hollín":           { value: 2.5, unit: "%" },
    "Oxidación":        { value: 34,  unit: "Abs/cm" },
    "Hierro (Fe)":      { value: 175 + j * 6, unit: "ppm" },
    "Cobre (Cu)":       { value: 40,  unit: "ppm" },
    "Plomo (Pb)":       { value: 27,  unit: "ppm" },
    "Cromo (Cr)":       { value: 18,  unit: "ppm" },
    "Silicio (Si)":     { value: 33,  unit: "ppm" },
    "Sodio (Na)":       { value: 58,  unit: "ppm" },
    "Índice PQ":        { value: 140, unit: "" },
  };
  if (v === "CAUTION") return {
    "Viscosidad 100°C": { value: 12.4 + j * 0.05, unit: "cSt" },
    "TBN":              { value: 14 - j * 0.5,    unit: "mgKOH/g" },
    "Agua":             { value: 0.12, unit: "%" },
    "Dilución combustible": { value: 3.1 + j * 0.1, unit: "%" },
    "Hollín":           { value: 1.0, unit: "%" },
    "Oxidación":        { value: 17,  unit: "Abs/cm" },
    "Hierro (Fe)":      { value: 62 + j * 5, unit: "ppm" },
    "Cobre (Cu)":       { value: 17,  unit: "ppm" },
    "Plomo (Pb)":       { value: 9,   unit: "ppm" },
    "Cromo (Cr)":       { value: 6,   unit: "ppm" },
    "Silicio (Si)":     { value: 13,  unit: "ppm" },
    "Sodio (Na)":       { value: 21,  unit: "ppm" },
    "Índice PQ":        { value: 36,  unit: "" },
  };
  return {
    "Viscosidad 100°C": { value: 13.8, unit: "cSt" },
    "TBN":              { value: 28 - j * 0.4, unit: "mgKOH/g" },
    "Agua":             { value: 0.04, unit: "%" },
    "Dilución combustible": { value: 1.4, unit: "%" },
    "Hollín":           { value: 0.4, unit: "%" },
    "Oxidación":        { value: 8,   unit: "Abs/cm" },
    "Hierro (Fe)":      { value: 21 + j * 2, unit: "ppm" },
    "Cobre (Cu)":       { value: 5,   unit: "ppm" },
    "Plomo (Pb)":       { value: 4,   unit: "ppm" },
    "Cromo (Cr)":       { value: 2,   unit: "ppm" },
    "Silicio (Si)":     { value: 6,   unit: "ppm" },
    "Sodio (Na)":       { value: 8,   unit: "ppm" },
    "Índice PQ":        { value: 11,  unit: "" },
  };
}

function summaryFor(v: Verdict): string {
  if (v === "CRITICAL") return "Desgaste severo de hierro (Fe alto) y TBN agotado; dilución por combustible. Cambio inmediato e inspección del motor.";
  if (v === "CAUTION")  return "Aumento de hierro y caída de TBN. Tendencia desfavorable; monitorear con mayor frecuencia.";
  return "Parámetros dentro de límites normales. Lubricante apto para servicio.";
}

const PROD = "Shell Argina S3 40";
interface S { asset: string; verdict: Verdict; dayAgo: number; rh: number; }
const SAMPLES: S[] = [
  // Propulsión Babor — serie deteriorándose
  { asset: A.PROPBB, verdict: "NORMAL",   dayAgo: 95, rh: 28000 },
  { asset: A.PROPBB, verdict: "CAUTION",  dayAgo: 50, rh: 29500 },
  { asset: A.PROPBB, verdict: "CRITICAL", dayAgo: 12, rh: 30400 },
  // Auxiliar N°1 — tendencia de precaución
  { asset: A.AUX1,   verdict: "NORMAL",   dayAgo: 85, rh: 15200 },
  { asset: A.AUX1,   verdict: "CAUTION",  dayAgo: 42, rh: 16100 },
  { asset: A.AUX1,   verdict: "CAUTION",  dayAgo: 9,  rh: 16800 },
  // Resto — normal
  { asset: A.AUX2,    verdict: "NORMAL", dayAgo: 30, rh: 14500 },
  { asset: A.AUX3,    verdict: "NORMAL", dayAgo: 25, rh: 13900 },
  { asset: A.PROPBBC, verdict: "NORMAL", dayAgo: 28, rh: 27600 },
  { asset: A.PROPEB,  verdict: "NORMAL", dayAgo: 20, rh: 27300 },
  { asset: A.PROPEBC, verdict: "NORMAL", dayAgo: 33, rh: 26900 },
  { asset: A.LAN1,    verdict: "NORMAL", dayAgo: 40, rh: 4200 },
  { asset: A.LAN2,    verdict: "NORMAL", dayAgo: 18, rh: 3900 },
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
  const counts: Record<string, number> = {};
  for (let i = 0; i < SAMPLES.length; i++) {
    const s = SAMPLES[i];
    seq++;
    const sampleCode = `FS-${VESSEL}-${String(seq).padStart(4, "0")}`;
    const sampledAt = daysAgo(s.dayAgo);
    counts[s.verdict] = (counts[s.verdict] ?? 0) + 1;
    if (DRY) { console.log(`WOULD CREATE ${sampleCode} · ${s.asset.slice(-6)} · ${s.verdict} · -${s.dayAgo}d · ${s.rh}h`); created++; continue; }
    const sample = await prisma.fluidSample.create({
      data: {
        tenantId: TENANT_ID, vesselCode: VESSEL, assetId: s.asset, sampleCode,
        kind: "FLUID", fluidType: "ENGINE_OIL", fluidProduct: PROD,
        sampledAt, runningHours: s.rh, sentAt: addDays(sampledAt, 1),
        labName: "WearCheck", labReference: `WC-${String(seq).padStart(4, "0")}`,
        status: "REPORTED", notes: "Muestra de rutina (demo).",
        createdByUserId: MARKER, updatedByUserId: MARKER,
      },
    });
    await prisma.fluidAnalysisResult.create({
      data: {
        tenantId: TENANT_ID, sampleId: sample.id, receivedAt: addDays(sampledAt, 4),
        verdict: s.verdict as any, summary: summaryFor(s.verdict),
        parameters: params(s.verdict, i % 3) as any, enteredByUserId: MARKER,
      },
    });
    created++;
  }
  console.log(`${DRY ? "DRY — " : ""}samples=${created} verdicts=${JSON.stringify(counts)}`);
  await prisma.$disconnect();
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
