// OT que tiene que llevar su SOLICITUD DE SERVICIO.
//
// El trabajo de un tercero se pide con una SS (formulario REGI-LOG-01.3): sin
// ella el taller no recibe el pedido y el gasto no pasa por la firma de tierra.
// Una OT la necesita cuando:
//   · está "Asignado a: Tercerizado" (o en el área PROVEEDOR del formulario
//     anterior) — misma señal que gobierna el taller en createTenantWorkOrder;
//   · ejecuta un plan de muestreo de aceite: el frasco viaja al laboratorio con
//     una SS (megado, vibraciones y termografía se miden a bordo y no cuentan,
//     mismo criterio que requestCarriesSamples en service-requests-service);
//   · es la correctiva de un defecto que nació de un análisis de aceite fuera de
//     rango: la muestra se retoma y va al mismo laboratorio.
//
// Casos reales que nadie veía (oct 2026): la OT-M02-26-0449, retoma de muestras
// "Tercerizado" a CONDOR, nunca tuvo SS (se abrió antes de que OT y SS fueran
// registros separados), y otras veinte OT tercerizadas abiertas tampoco. La
// correctiva que se abre desde un defecto de laboratorio, además, arrancaba en
// "Tripulación".
//
// A esa OT le FALTA la SS si no tiene ninguna vigente y nadie dejó escrito por
// qué no la lleva (`serviceRequestNotRequiredReason`). Con la SS faltante la OT
// no se envía a aprobar (setWorkOrderApproval) y Seguimiento la marca.

import { resolvePlanProviderRequests } from "../maintenance-plans/maintenance-plans-service";

/** Una SS dada de baja no pide nada. */
const VOID_SR_STATUSES = ["CANCELLED", "REJECTED"];

/** Por qué la OT necesita SS, de lo más específico a lo más general (el primero que aplica es el que se muestra). */
export type SsRequiredReason = "LAB_DEFECT" | "LAB_PLAN" | "OUTSOURCED";

export interface SsRequiredStatus {
  reason: SsRequiredReason;
  /** Correctiva de un análisis de aceite: al autorizarla se crea la muestra de retoma. */
  labDefect: boolean;
  /** Ejecuta un plan de muestreo de aceite: la muestra la crea el plan. */
  labPlan: boolean;
  hasServiceRequest: boolean;
  notRequiredReason: string | null;
  /** Necesita SS, no la tiene y nadie dijo por qué. */
  missing: boolean;
}

/** Muestreo de aceite. Con sólo el tipo de fluido cargado, el alta de la muestra ya lo trata como FLUID. */
export function isFluidSamplingPlan(plan: { samplingKind?: string | null; samplingFluidType?: string | null }): boolean {
  return plan.samplingKind === "FLUID" || (!plan.samplingKind && !!plan.samplingFluidType);
}

/** El trabajo lo hace un tercero: "Tercerizado" en el formulario REGI-MAN-02.3, PROVEEDOR en el anterior. */
export function isOutsourcedWorkOrder(wo: { assignedToArea?: string | null; department?: string | null }): boolean {
  return wo.assignedToArea === "TERCERIZADO" || wo.department === "PROVEEDOR";
}

export interface SsRequiredInput {
  id: string;
  maintenancePlanId?: string | null;
  assignedToArea?: string | null;
  department?: string | null;
  serviceRequestNotRequiredReason?: string | null;
}

/**
 * Estado de SS requerida de varias OT, en una consulta por dimensión (nunca una
 * por OT): sirve igual para una sola OT y para la planilla de Seguimiento.
 * Sólo devuelve las OT que necesitan SS.
 */
export async function ssRequiredStatusByWorkOrder(
  prisma: any,
  tenantId: string,
  workOrders: SsRequiredInput[],
): Promise<Map<string, SsRequiredStatus>> {
  const out = new Map<string, SsRequiredStatus>();
  if (workOrders.length === 0) return out;
  const woIds = workOrders.map(w => w.id);

  const [links, defects, srGroups] = await Promise.all([
    prisma.workOrderMaintenancePlan.findMany({
      where: { tenantId, workOrderId: { in: woIds } },
      select: { workOrderId: true, maintenancePlanId: true },
    }) as Promise<Array<{ workOrderId: string; maintenancePlanId: string }>>,
    prisma.defect.findMany({
      where: { tenantId, workOrderId: { in: woIds }, deletedAt: null },
      select: { id: true, workOrderId: true },
    }) as Promise<Array<{ id: string; workOrderId: string }>>,
    prisma.serviceRequest.groupBy({
      by: ["workOrderId"],
      where: { tenantId, workOrderId: { in: woIds }, deletedAt: null, status: { notIn: VOID_SR_STATUSES } },
      _count: { _all: true },
    }) as Promise<Array<{ workOrderId: string; _count?: { _all?: number } }>>,
  ]);

  // Planes de cada OT: el principal y los vinculados (la tabla incluye al principal).
  const plansByWo = new Map<string, Set<string>>();
  const addPlan = (woId: string, planId: string | null | undefined) => {
    if (!planId) return;
    const set = plansByWo.get(woId) ?? new Set<string>();
    set.add(planId);
    plansByWo.set(woId, set);
  };
  for (const w of workOrders) addPlan(w.id, w.maintenancePlanId);
  for (const l of links) addPlan(l.workOrderId, l.maintenancePlanId);
  const planIds = [...new Set([...plansByWo.values()].flatMap(s => [...s]))];

  const [plans, results] = await Promise.all([
    planIds.length > 0
      ? prisma.maintenancePlan.findMany({
          where: { tenantId, id: { in: planIds } },
          select: { id: true, samplingKind: true, samplingFluidType: true },
        }) as Promise<Array<{ id: string; samplingKind: string | null; samplingFluidType: string | null }>>
      : Promise.resolve([]),
    defects.length > 0
      ? prisma.fluidAnalysisResult.findMany({
          where: { tenantId, defectId: { in: defects.map(d => d.id) }, sample: { is: { kind: "FLUID", deletedAt: null } } },
          select: { defectId: true },
        }) as Promise<Array<{ defectId: string }>>
      : Promise.resolve([]),
  ]);

  const fluidPlanIds = new Set(plans.filter(isFluidSamplingPlan).map(p => p.id));
  const fluidDefectIds = new Set(results.map(r => r.defectId));
  const defectWoIds = new Set(defects.filter(d => fluidDefectIds.has(d.id)).map(d => d.workOrderId));
  const srCount = new Map(srGroups.map(g => [g.workOrderId, Number(g._count?._all ?? 0)]));

  for (const w of workOrders) {
    const labPlan = [...(plansByWo.get(w.id) ?? [])].some(id => fluidPlanIds.has(id));
    const labDefect = defectWoIds.has(w.id);
    const outsourced = isOutsourcedWorkOrder(w);
    if (!labPlan && !labDefect && !outsourced) continue;
    const hasServiceRequest = (srCount.get(w.id) ?? 0) > 0;
    const notRequiredReason = w.serviceRequestNotRequiredReason?.trim() || null;
    out.set(w.id, {
      reason: labDefect ? "LAB_DEFECT" : labPlan ? "LAB_PLAN" : "OUTSOURCED",
      labDefect,
      labPlan,
      hasServiceRequest,
      notRequiredReason,
      missing: !hasServiceRequest && !notRequiredReason,
    });
  }
  return out;
}

export interface SsProvider { providerId: string; providerName: string }

/** La muestra de aceite que generó un defecto y el laboratorio que la analizó. */
export interface DefectLabOrigin {
  defectId: string;
  sampleId: string;
  sampleCode: string;
  assetId: string;
  fluidType: string | null;
  /** null si no se pudo saber: la SS se abre igual, eligiendo el laboratorio a mano. */
  provider: SsProvider | null;
}

/** El primer proveedor ACTIVO, en el orden pedido. Uno dado de baja dejaría la SS en el aire. */
export async function firstActiveProvider(prisma: any, tenantId: string, ids: Array<string | null | undefined>): Promise<SsProvider | null> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return null;
  const rows: Array<{ id: string; name: string }> = await prisma.provider.findMany({
    where: { tenantId, id: { in: unique }, deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  for (const id of unique) {
    const p = rows.find(r => r.id === id);
    if (p) return { providerId: p.id, providerName: p.name };
  }
  return null;
}

const normName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * El laboratorio por el nombre que figura en la muestra ("Condor" en la
 * muestra, "CONDOR S.A.C.I" en el catálogo). Sólo si coincide con uno solo: con
 * dos candidatos es adivinar, y elegirlo queda para quien abre la SS.
 */
async function providerByLabName(prisma: any, tenantId: string, labName: string): Promise<SsProvider | null> {
  const wanted = normName(labName);
  if (wanted.length < 4) return null;
  const rows: Array<{ id: string; name: string }> = await prisma.provider.findMany({
    where: { tenantId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  const hits = rows.filter(r => {
    const n = normName(r.name);
    return n.length >= 4 && (n.includes(wanted) || wanted.includes(n));
  });
  return hits.length === 1 ? { providerId: hits[0]!.id, providerName: hits[0]!.name } : null;
}

/**
 * La muestra de aceite detrás de un defecto y su laboratorio. null si el
 * defecto no nació de un análisis de aceite.
 *
 * El laboratorio sale, en este orden, de:
 *   1. la SS con la que viajó esa muestra (la de su OT de origen), prefiriendo
 *      la del proveedor que declara la rutina si la OT tenía varias;
 *   2. el proveedor de la rutina de muestreo (el plan);
 *   3. el nombre del laboratorio que figura en la muestra.
 */
export async function findDefectLabOrigin(prisma: any, tenantId: string, defectId: string): Promise<DefectLabOrigin | null> {
  const result = await prisma.fluidAnalysisResult.findFirst({
    where: { tenantId, defectId },
    select: {
      sample: {
        select: {
          id: true, sampleCode: true, kind: true, assetId: true, fluidType: true, labName: true,
          sourceWorkOrderId: true, sourcePlanId: true, deletedAt: true,
        },
      },
    },
  });
  const sample = result?.sample;
  if (!sample || sample.deletedAt || sample.kind !== "FLUID") return null;

  const [srs, plan] = await Promise.all([
    sample.sourceWorkOrderId
      ? prisma.serviceRequest.findMany({
          where: {
            tenantId, workOrderId: sample.sourceWorkOrderId, deletedAt: null,
            providerId: { not: null }, status: { notIn: VOID_SR_STATUSES },
          },
          select: { providerId: true },
          orderBy: { openDate: "asc" },
        }) as Promise<Array<{ providerId: string }>>
      : Promise.resolve([]),
    sample.sourcePlanId
      ? prisma.maintenancePlan.findFirst({
          where: { id: sample.sourcePlanId, tenantId },
          select: { department: true, providerId: true, providerRequests: true },
        })
      : Promise.resolve(null),
  ]);
  const fromSr = srs.map(s => s.providerId);
  const fromPlan = plan?.department === "PROVEEDOR" ? resolvePlanProviderRequests(plan).map(r => r.providerId) : [];

  const provider = await firstActiveProvider(prisma, tenantId, [
    ...fromSr.filter(id => fromPlan.includes(id)),
    ...fromPlan,
    ...fromSr,
  ]) ?? (sample.labName ? await providerByLabName(prisma, tenantId, sample.labName) : null);

  return {
    defectId,
    sampleId: sample.id,
    sampleCode: sample.sampleCode,
    assetId: sample.assetId,
    fluidType: sample.fluidType ?? null,
    provider,
  };
}

/** Las muestras de aceite de los defectos que esta OT corrige (normalmente una). */
export async function findWorkOrderDefectLabOrigins(prisma: any, tenantId: string, workOrderId: string): Promise<DefectLabOrigin[]> {
  const defects: Array<{ id: string }> = await prisma.defect.findMany({
    where: { tenantId, workOrderId, deletedAt: null },
    select: { id: true },
    orderBy: { reportedAt: "asc" },
  });
  const out: DefectLabOrigin[] = [];
  for (const d of defects) {
    const origin = await findDefectLabOrigin(prisma, tenantId, d.id);
    if (origin) out.push(origin);
  }
  return out;
}

/** El laboratorio de una OT de plan de muestreo: el proveedor de la rutina. */
export async function findPlanLabProvider(prisma: any, tenantId: string, planIds: string[]): Promise<SsProvider | null> {
  if (planIds.length === 0) return null;
  const plans: Array<{ id: string; department: string | null; providerId: string | null; providerRequests: unknown; samplingKind: string | null; samplingFluidType: string | null }> =
    await prisma.maintenancePlan.findMany({
      where: { tenantId, id: { in: planIds } },
      select: { id: true, department: true, providerId: true, providerRequests: true, samplingKind: true, samplingFluidType: true },
    });
  const ids = plans
    .filter(p => isFluidSamplingPlan(p) && p.department === "PROVEEDOR")
    .flatMap(p => resolvePlanProviderRequests(p).map(r => r.providerId));
  return firstActiveProvider(prisma, tenantId, ids);
}
