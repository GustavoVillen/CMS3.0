/**
 * Datos de la hoja de la OT que se completan solos (pedido de Gustavo, oct 2026).
 *
 * En la hoja de Mercurio (REGI-MAN-02.3) había que cargar siempre lo mismo, y
 * el copiloto lo preguntaba en cada OT:
 *   - Ubicación, Nº de viaje y Condición: los últimos del buque, sacados de su
 *     OT más reciente que los tenga (son datos del buque, no de la persona).
 *   - Sistema: Máquinas en los remolcadores, Barcazas en las barcazas.
 *   - Técnico responsable: el Jefe de Máquinas del buque. El rol no alcanza
 *     (Capitán y JM comparten MAINTENANCE_MANAGER): se busca por el cargo
 *     cargado en Equipo; si no hay exactamente uno, queda el texto.
 *   - Vencimiento: una semana desde el inicio. NO va en "Fecha finalización":
 *     esa es la fecha de ejecución (completedDate) y la leen los planes, el
 *     cumplimiento y los informes como el día en que se hizo el trabajo.
 *
 * Sólo en los tenants con el formulario de Mercurio: son reglas de ese cliente.
 * Siempre se completa lo que vino VACÍO; lo que carga una persona manda.
 */

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { isVesselCrewed } from "../ai/vessel-ai-context";

export const WO_DUE_DAYS = 7;
/** Texto del técnico cuando no hay un Jefe de Máquinas identificable en Equipo. */
export const CHIEF_ENGINEER_LABEL = "Jefe de Máquinas";

export interface WoFormDefaults {
  location: string | null;
  voyageNumber: string | null;
  operatingCondition: string | null;
  systemArea: "MAQUINAS" | "BARCAZAS" | null;
  /** Id del usuario Jefe de Máquinas del buque, o el texto "Jefe de Máquinas". */
  assignedToUserId: string;
  dueDays: number;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** `null` si el tenant no usa el formulario de Mercurio (ahí no se completa nada). */
export async function resolveWoFormDefaults(tenantId: string, vesselCode: string): Promise<WoFormDefaults | null> {
  const prisma = getPrismaClient() as any;
  if (!prisma || !vesselCode) return null;

  const tenant: { settings: unknown } | null = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const template = String((tenant?.settings as { workOrderPdfTemplate?: unknown } | null)?.workOrderPdfTemplate ?? "");
  if (!template.startsWith("MERCURIO")) return null;

  // Cada dato de la OT más reciente del buque que lo tenga: una OT nueva suele
  // tener vacío alguno y no por eso hay que perder el anterior.
  const latest = (field: "location" | "voyageNumber" | "operatingCondition") =>
    prisma.workOrder.findFirst({
      where: { tenantId, vesselCode, deletedAt: null, [field]: { not: null } },
      orderBy: [{ openDate: "desc" }, { updatedAt: "desc" }],
      select: { [field]: true },
    }) as Promise<Record<string, string | null> | null>;

  const [loc, voyage, condition, vessel, members] = await Promise.all([
    latest("location"),
    latest("voyageNumber"),
    latest("operatingCondition"),
    prisma.vessel.findFirst({ where: { tenantId, code: vesselCode }, select: { vesselType: true, isCrewed: true } }),
    prisma.tenantMembership.findMany({
      where: { tenantId, status: "ACTIVE", jobTitle: { not: null }, assignedVesselCodes: { has: vesselCode } },
      select: { userId: true, jobTitle: true },
    }),
  ]);

  const crewed = vessel ? isVesselCrewed({ vesselType: vessel.vesselType ?? null, isCrewed: vessel.isCrewed ?? null }) : null;
  const chiefs = (members as Array<{ userId: string; jobTitle: string | null }>)
    .filter(m => norm(m.jobTitle ?? "").includes("jefe de maquinas"));

  return {
    location: loc?.location?.trim() || null,
    voyageNumber: voyage?.voyageNumber?.trim() || null,
    operatingCondition: condition?.operatingCondition ?? null,
    systemArea: crewed === true ? "MAQUINAS" : crewed === false ? "BARCAZAS" : null,
    assignedToUserId: chiefs.length === 1 ? chiefs[0]!.userId : CHIEF_ENGINEER_LABEL,
    dueDays: WO_DUE_DAYS,
  };
}

/** Para la pantalla: mismo cálculo, dentro de la empresa y de los buques del usuario. */
export async function getWoFormDefaults(session: TenantAccessSession, vesselCode: string): Promise<WoFormDefaults | null> {
  const code = (vesselCode ?? "").trim();
  if (!code) throw new RouteError(400, "VALIDATION_ERROR", "Falta el buque.");
  if (session.user.role !== "TENANT_ADMIN" && !(session.user.assignedVesselCodes ?? []).includes(code)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso a ese buque.");
  }
  const prisma = getPrismaClient() as any;
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant: { id: string } | null = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return resolveWoFormDefaults(tenant.id, code);
}

/**
 * TIPO DE MANTENIMIENTO de una OT abierta desde el plan (pedido de Gustavo, oct
 * 2026): siempre Preventivo, salvo los análisis de laboratorio (muestras de
 * aceite o combustible, vibraciones), que son Predictivo.
 *
 * Un plan es de análisis si tiene `samplingKind` Y su título es de muestreo o
 * análisis. `samplingKind` solo no alcanza: también lo llevan planes que toman
 * una muestra de paso ("SERVICE: Cambio de Aceite y Filtro", "DIQUE SECO:
 * Recorrido completo…"), que son preventivos. Con varios planes, es Predictivo
 * sólo si todos son análisis. Las OT de Inspección no pasan por acá.
 * La pantalla repite este criterio en WorkOrders.tsx (planKind).
 */
const ANALYSIS_TITLE = /muestr|analis|analiz|vibraci|termograf|megad/;
export function isAnalysisPlan(p: { samplingKind?: string | null; title?: string | null }): boolean {
  return !!p.samplingKind && ANALYSIS_TITLE.test(norm(p.title ?? ""));
}
export function maintenanceKindFromPlans(plans: Array<{ samplingKind?: string | null; title?: string | null }>): "PREVENTIVO" | "PREDICTIVO" {
  return plans.length > 0 && plans.every(isAnalysisPlan) ? "PREDICTIVO" : "PREVENTIVO";
}

/** `date` + `days` días (para el vencimiento de una OT nueva). */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}
