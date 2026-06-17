/**
 * Seed idempotente — Catálogo SFI (subgrupos) para tenant "mercurio".
 * Crea los nodos SFI (SfiNode) de los subgrupos usados por el plan del MAO 01,
 * para que en /assets y /maintenance-plans los campos "Grupo SFI" y "Subgrupo
 * SFI" resuelvan a un nombre (hoy el código no está en el catálogo → se ve vacío).
 *
 * No toca el catálogo global (isGlobal=false, tenantId=mercurio).
 *
 * Uso:
 *   DATABASE_URL=<url> npx tsx scripts/seed-mao01-sfi.ts
 *   DRY=1 DATABASE_URL=<url> npx tsx scripts/seed-mao01-sfi.ts
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const DRY = process.env.DRY === "1";

const GROUP_NAMES: Record<number, string> = {
  3: "Equipo de Manipulación de Carga",
  4: "Equipo de Barco",
  5: "Equipo para Tripulación y Pasajeros",
  6: "Componentes Principales",
  7: "Sistemas para Componentes Principales",
  8: "Instalaciones Eléctricas",
  9: "Automatización, Control y Monitoreo",
};

// code, group, descripción del subgrupo
const SUBGROUPS: [string, number, string][] = [
  ["310", 3, "Elementos de Elevación de Pesos"],
  ["311", 3, "Malacate de Pluma de Lancha"],
  ["440", 4, "Contraincendio"],
  ["441", 4, "Cortes y Cierres de Emergencia"],
  ["450", 4, "Lucha contra Derrames (PLANACON)"],
  ["551", 5, "Agua Potable"],
  ["552", 5, "Tratamiento de Aguas Residuales (Sewage)"],
  ["553", 5, "Termotanque"],
  ["554", 5, "Cocina"],
  ["601", 6, "Motores Principales"],
  ["603", 6, "Cajas Reductoras"],
  ["605", 6, "Líneas de Eje"],
  ["611", 6, "Motores Auxiliares"],
  ["612", 6, "Motor de Lancha"],
  ["701", 7, "Sistema de Combustible"],
  ["720", 7, "Refrigeración, Achique y Agua de Mar"],
  ["740", 7, "Aire Comprimido"],
  ["750", 7, "Sistema Hidráulico de Gobierno y Maniobra"],
  ["760", 7, "Ventilación de Máquinas"],
  ["801", 8, "Alternadores"],
  ["802", 8, "Tablero Eléctrico Principal"],
  ["803", 8, "Baterías e Iluminación de Emergencia"],
  ["804", 8, "Aislaciones"],
  ["901", 9, "Navegación y Electrónica"],
  ["902", 9, "Comunicaciones"],
  ["910", 9, "Alarmas y Seguridades de Máquinas"],
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tid: string = tenant.id;

  let created = 0;
  let updated = 0;
  for (const [code, group, desc] of SUBGROUPS) {
    const groupName = GROUP_NAMES[group] ?? `Grupo ${group}`;
    const sortOrder = Number(code);
    const existing = await prisma.sfiNode.findFirst({ where: { tenantId: tid, code }, select: { id: true } });
    if (DRY) {
      console.log(`DRY ${existing ? "update" : "create"} SfiNode ${code} (G${group}) — ${desc}`);
      continue;
    }
    if (existing) {
      await prisma.sfiNode.update({
        where: { id: existing.id },
        data: { description: desc, groupNumber: group, groupName, isGlobal: false, sortOrder },
      });
      updated++;
      console.log(`✓ update SfiNode ${code} (G${group}) — ${desc}`);
    } else {
      await prisma.sfiNode.create({
        data: { tenantId: tid, code, description: desc, groupNumber: group, groupName, isGlobal: false, sortOrder },
      });
      created++;
      console.log(`✓ create SfiNode ${code} (G${group}) — ${desc}`);
    }
  }

  console.log(
    `\n${DRY ? "DRY-RUN (no se escribió nada). " : "✅ Completado. "}` +
      `${SUBGROUPS.length} subgrupos SFI (${created} creados, ${updated} actualizados) para tenant '${SLUG}'.`,
  );
}

main()
  .catch((e) => {
    console.error("❌ Error:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
