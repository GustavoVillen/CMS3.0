import type { getPrismaClient } from "../../platform/data/prisma-client";

/**
 * Datos para dibujar la barra del ciclo de clase de cada certificado
 * (Preview certificados-ciclo V1, aprobado 18-sep-2026).
 *
 * El módulo de Certificados guarda sólo certificados de clase. El esquema lo
 * define el tipo de buque:
 *   - remolcador: ciclo de 6 años, intermedia a los 3.
 *   - barcaza:    ciclo de 8 años, periódicas a los 2 y 6, intermedia a los 4.
 * Las ventanas (± 6 meses, renovación 6 meses antes) las arma la UI.
 *
 * "Hecha" sale del plan de mantenimiento: las inspecciones de clase de cada
 * buque se cargaron desde el Ship Status (scripts/load-fleet-class-inspections.ts)
 * y al reportar la próxima, su lastExecutionDate se actualiza solo.
 */
export interface ClassCycleInfo {
  vesselKind: "TUG" | "BARGE";
  cycleYears: number;
  intermediateDoneAt: Date | null;
  periodicDoneAt: Date | null;
}

type Prisma = NonNullable<ReturnType<typeof getPrismaClient>>;

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Mismo criterio que vessel-ai-context: el tipo es texto libre. null = no se sabe. */
function vesselKind(type: string | null | undefined): ClassCycleInfo["vesselKind"] | null {
  const t = norm(type ?? "");
  if (t.includes("barcaza") || t.includes("barge")) return "BARGE";
  if (t.includes("remolcador") || t.includes("empuje") || t.includes("tug")) return "TUG";
  return null;
}

/** Tipo de inspección de clase según el título del plan ("Inspeccion INTERMEDIA de Clase (RINA)"). */
function classSurveyKind(title: string): "INTERMEDIATE" | "PERIODIC" | null {
  const t = norm(title);
  if (!t.includes("inspeccion") || !/\bclase\b/.test(t)) return null;
  if (t.includes("intermedia")) return "INTERMEDIATE";
  if (t.includes("periodica")) return "PERIODIC";
  return null;
}

/** Ciclo de clase por buque, para los buques de la lista. */
export async function loadClassCycles(prisma: Prisma, tenantId: string, vesselCodes: string[]): Promise<Map<string, ClassCycleInfo>> {
  const codes = [...new Set(vesselCodes)];
  if (!codes.length) return new Map();
  const [vessels, plans] = await Promise.all([
    prisma.vessel.findMany({ where: { tenantId, code: { in: codes } }, select: { code: true, vesselType: true } }),
    prisma.maintenancePlan.findMany({
      where: {
        tenantId, vesselCode: { in: codes }, deletedAt: null, lastExecutionDate: { not: null },
        title: { contains: "clase", mode: "insensitive" },
      },
      select: { vesselCode: true, title: true, lastExecutionDate: true },
    }),
  ]);

  const out = new Map<string, ClassCycleInfo>();
  for (const v of vessels) {
    const kind = vesselKind(v.vesselType);
    if (!kind) continue;
    out.set(v.code, { vesselKind: kind, cycleYears: kind === "TUG" ? 6 : 8, intermediateDoneAt: null, periodicDoneAt: null });
  }
  for (const p of plans) {
    const info = out.get(p.vesselCode);
    const kind = classSurveyKind(p.title);
    if (!info || !kind || !p.lastExecutionDate) continue;
    const key = kind === "INTERMEDIATE" ? "intermediateDoneAt" : "periodicDoneAt";
    // Si un buque tuviera dos planes del mismo tipo, vale la última ejecución.
    if (!info[key] || p.lastExecutionDate > info[key]!) info[key] = p.lastExecutionDate;
  }
  return out;
}
