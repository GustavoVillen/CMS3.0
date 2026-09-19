// Paquete de evidencia del asesor técnico (Director de Mantenimiento).
//
// Regla de oro del asesor: la IA NO busca datos, razona sobre los que le da este
// archivo. Acá el CÓDIGO junta, con consultas exactas y siempre filtradas por
// tenant y por los buques del alcance del usuario, los registros que muestran
// problemas de gestión, y a cada uno le pone una etiqueta (E-1, E-2…). La IA sólo
// puede citar esas etiquetas; el service descarta las que no existen.
//
// Lo que el sistema no registra (costos, órdenes de compra…) va en `dataGaps`
// para que la IA diga "información insuficiente" en vez de completarlo.
//
// Cada sección se lee por separado: si una consulta falla, el informe sale igual
// y la falla queda declarada como dato faltante (nunca como "todo bien").

import type { TenantAccessSession } from "../auth/session-store";
import { listVesselsInScope, getComplianceScores } from "../compliance/compliance-service";
import { listDueItems } from "../pms/due-items-service";
import { getOnHandMap } from "../pms/stock-calc-service";
import { getVesselAiContext } from "../ai/vessel-ai-context";
import { log } from "../../common/logger";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type EvidenceKind =
  | "PLAN" | "WORK_ORDER" | "DEFECT" | "DEFERRAL" | "LAB" | "SPARE" | "SPARE_REQUEST"
  | "CERTIFICATE" | "PROVIDER_NC" | "CREW" | "ALERT" | "KPI";

export interface EvidenceItem {
  id: string;               // E-n
  kind: EvidenceKind;
  code: string | null;      // código del registro (OT, plan, defecto…)
  vesselCode: string | null;
  vesselName: string | null;
  assetName: string | null;
  date: string | null;      // yyyy-mm-dd
  title: string;
  detail: string;           // hechos, en texto corto
  link: string | null;      // ruta del frontend para abrir el registro
}

export interface AdvisorMetrics {
  vessels: number;
  plansOverdue: number;
  plansOverdueCritical: number;       // equipo criticidad A o crítico ISM 10.3
  plansOverdueUnreliableDate: number; // vencidos hace >10 años: carga sin historial
  correctivePct90d: number | null;    // % de OT correctivas abiertas en 90 días
  workOrders90d: number;
  deferralsActive: number;
  criticalSparesBelowMin: number;
  criticalSparesNeverCounted: number; // bajo mínimo sin ningún movimiento de stock
  assetsWithRepeatedDefects: number;
  labAlarmsWithoutAction: number;
  defectsOpenHigh: number;
  closedWithoutEvidence60d: number;
  closedWorkOrders60d: number;        // base del semáforo "Cierre de OT"
  criticalSparesWithMin: number;      // repuestos críticos con mínimo definido
  certificatesDue60d: number;
}

export interface AdvisorEvidencePack {
  periodFrom: Date;
  periodTo: Date;
  vesselCodes: string[];
  metrics: AdvisorMetrics;
  /** Lo que va a la IA: secciones con sus números y las etiquetas E-n. */
  payload: Record<string, unknown>;
  /** Foto de los registros citables. */
  evidence: EvidenceItem[];
  dataGaps: string[];
  sources: Record<string, number>;
}

// ── Constantes ───────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const ACTIVE_DEFECT = ["OPEN", "UNDER_REVIEW", "IN_PROGRESS", "DEFERRED"];
const ACTIVE_DEFERRAL = ["REQUESTED", "UNDER_REVIEW", "APPROVED", "ACTIVE"];
const OPEN_WO = ["PLANNED", "IN_PROGRESS", "ON_HOLD", "DEFERRED"];
const OPEN_SPARE_REQUEST = ["SUBMITTED", "APPROVED", "PARTIALLY_FULFILLED"];

/** Datos que el CMS hoy no registra: la IA tiene que decirlo, no suponerlo. */
const STATIC_DATA_GAPS = [
  "Costos de mantenimiento: el sistema no registra costos de órdenes de trabajo, mano de obra ni repuestos.",
  "Órdenes de compra y plazos reales de entrega: no existen en el sistema; sólo hay solicitudes de repuestos y un plazo teórico (leadTimeDays) por repuesto.",
  "Desempeño de contratistas medido en tiempo o costo: sólo hay evaluaciones y no conformidades de proveedores.",
  "Termografía y parámetros de operación en continuo: sólo lo que se cargó como análisis de laboratorio / vibraciones.",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const d = (v: unknown): string | null => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
const cut = (v: unknown, n: number): string | null =>
  (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, n) : null);
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY);
const isBlank = (v: unknown) => !(typeof v === "string" && v.trim());

class EvidenceBook {
  private items: EvidenceItem[] = [];
  add(item: Omit<EvidenceItem, "id">): string {
    const id = `E-${this.items.length + 1}`;
    this.items.push({ id, ...item });
    return id;
  }
  all(): EvidenceItem[] { return this.items; }
}

// ── Armado ───────────────────────────────────────────────────────────────────

export async function buildAdvisorEvidence(
  prisma: any,
  session: TenantAccessSession,
  tenantId: string,
  /** Buque del encabezado; null = toda la flota del alcance. */
  requestedVesselCode: string | null = null,
  /** Grupo de buques (ej. todas las barcazas): se analiza sólo esa lista. */
  onlyVesselCodes: string[] | null = null,
): Promise<AdvisorEvidencePack> {
  const now = new Date();
  const since90 = new Date(now.getTime() - 90 * DAY);
  const since180 = new Date(now.getTime() - 180 * DAY);
  const since365 = new Date(now.getTime() - 365 * DAY);
  const in60 = new Date(now.getTime() + 60 * DAY);

  const book = new EvidenceBook();
  const gaps: string[] = [...STATIC_DATA_GAPS];
  const sources: Record<string, number> = {};
  const payload: Record<string, unknown> = {};

  // Buques del alcance (el Director es admin: toda la flota). Todas las
  // consultas de abajo filtran por tenant Y por estos códigos.
  const vessels = (await listVesselsInScope(prisma, session, tenantId, requestedVesselCode))
    .filter(v => !onlyVesselCodes || onlyVesselCodes.includes(v.code));
  const vesselCodes = vessels.map(v => v.code);
  const vesselName = new Map(vessels.map(v => [v.code, v.name]));
  const vName = (code: string | null | undefined) => (code ? vesselName.get(code) ?? null : null);
  const inScope = { tenantId, vesselCode: { in: vesselCodes } };

  const metrics: AdvisorMetrics = {
    vessels: vessels.length, plansOverdue: 0, plansOverdueCritical: 0, plansOverdueUnreliableDate: 0, correctivePct90d: null,
    workOrders90d: 0, deferralsActive: 0, criticalSparesBelowMin: 0, criticalSparesNeverCounted: 0, assetsWithRepeatedDefects: 0,
    labAlarmsWithoutAction: 0, defectsOpenHigh: 0, closedWithoutEvidence60d: 0, closedWorkOrders60d: 0, criticalSparesWithMin: 0, certificatesDue60d: 0,
  };

  // Equipos: nombre, criticidad y marca ISM 10.3, para priorizar por riesgo.
  const assetInfo = new Map<string, { name: string; code: string; criticality: string; safety: boolean; vesselCode: string }>();
  async function loadAssets(ids: string[]) {
    const missing = Array.from(new Set(ids.filter(id => id && !assetInfo.has(id))));
    if (missing.length === 0) return;
    const rows = await prisma.asset.findMany({
      where: { tenantId, id: { in: missing } },
      select: { id: true, name: true, assetCode: true, criticality: true, isSafetyCritical: true, vesselCode: true },
    });
    for (const a of rows) assetInfo.set(a.id, { name: a.name, code: a.assetCode, criticality: a.criticality, safety: a.isSafetyCritical, vesselCode: a.vesselCode });
  }
  const aName = (id: string | null | undefined) => (id ? assetInfo.get(id)?.name ?? null : null);
  const riskTag = (id: string | null | undefined) => {
    const a = id ? assetInfo.get(id) : null;
    if (!a) return "";
    return [a.criticality === "A" ? "criticidad A" : `criticidad ${a.criticality}`, a.safety ? "crítico para la seguridad (ISM 10.3)" : null]
      .filter(Boolean).join(", ");
  };

  async function section(name: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      log.error(`[advisor-evidence] sección ${name} falló:`, err);
      gaps.push(`No se pudo leer la sección "${name}" en este análisis: sus conclusiones no son confiables.`);
    }
  }

  if (vesselCodes.length === 0) {
    gaps.push("No hay buques en el alcance del usuario.");
    return { periodFrom: since365, periodTo: now, vesselCodes, metrics, payload, evidence: [], dataGaps: gaps, sources };
  }

  // ── Buques + cumplimiento ──
  await section("buques", async () => {
    const scores = await getComplianceScores(session, requestedVesselCode).catch(() => ({ items: [] as any[] }));
    const byCode = new Map(scores.items.map((s: any) => [s.vesselCode, s]));
    payload.buques = await Promise.all(vessels.map(async v => {
      const s: any = byCode.get(v.code);
      return {
        buque: v.name,
        sobreElBuque: await getVesselAiContext(session.tenantSlug, v.code),
        puntajeCumplimiento: s ? { puntaje: s.score, otCerradasEnPlazo90d: `${s.totals.woCompletedOnTime}/${s.totals.woClosedTotal}`, defectosCriticosAbiertos: s.totals.criticalDefectsOpen, violacionesDescanso30d: s.totals.restHoursViolations30d, certificadosVigentes: `${s.totals.certsActive}/${s.totals.certsTotal}` } : null,
      };
    }));
    sources.vessels = vessels.length;
  });

  // ── Planes vencidos (el estado se deriva en vivo, no el guardado) ──
  await section("planes vencidos", async () => {
    const due = (await listDueItems(session, { executionStatus: "OVERDUE", vesselCode: requestedVesselCode })) as any[];
    const overdue = due.filter(p => vesselCodes.includes(p.vesselCode));
    await loadAssets(overdue.map(p => p.assetId));
    const score = (p: any) => {
      const a = assetInfo.get(p.assetId);
      return (a?.safety ? 100 : 0) + (a?.criticality === "A" ? 50 : a?.criticality === "B" ? 10 : 0)
        + Math.min(p.nextDueDate ? daysBetween(now, new Date(p.nextDueDate)) : 0, 365) / 10;
    };
    overdue.sort((a, b) => score(b) - score(a));
    metrics.plansOverdue = overdue.length;
    metrics.plansOverdueCritical = overdue.filter(p => { const a = assetInfo.get(p.assetId); return a?.safety || a?.criticality === "A"; }).length;
    // Un vencimiento de hace más de 10 años no es un atraso real: es un plan
    // cargado sin historial de ejecución (fecha inicial vieja). Es un problema
    // de CALIDAD DE DATOS y así se le presenta a la IA.
    const unreliable = (p: any) => !!p.nextDueDate && daysBetween(now, new Date(p.nextDueDate)) > 3650;
    const unreliableCount = overdue.filter(unreliable).length;
    metrics.plansOverdueUnreliableDate = unreliableCount;
    payload.planesVencidos = {
      total: overdue.length,
      enEquiposCriticos: metrics.plansOverdueCritical,
      conFechaNoConfiable: unreliableCount,
      notaCalidadDeDatos: unreliableCount
        ? `${unreliableCount} planes vencidos tienen su próximo vencimiento hace más de 10 años: casi seguro fueron cargados sin historial de ejecución. Tratarlos como problema de calidad de datos (falta registrar la última ejecución), no como atraso real de años.`
        : null,
      porBuque: countBy(overdue, p => vName(p.vesselCode) ?? p.vesselCode),
      losDeMayorRiesgo: overdue.slice(0, 25).map(p => {
        const late = p.nextDueDate ? daysBetween(now, new Date(p.nextDueDate)) : null;
        return {
          ev: book.add({
            kind: "PLAN", code: p.taskCode, vesselCode: p.vesselCode, vesselName: vName(p.vesselCode), assetName: aName(p.assetId),
            date: d(p.nextDueDate), title: p.title,
            detail: [unreliable(p) ? `Próximo vencimiento registrado ${d(p.nextDueDate)}: fecha no confiable (probable carga sin historial de ejecución)` : late != null ? `Vencido hace ${late} días (desde ${d(p.nextDueDate)})` :p.nextDueHours != null ? `Vencido por horas (tocaba a las ${p.nextDueHours} h, lleva ${p.currentHours ?? "?"} h)` : "Vencido", riskTag(p.assetId), "sin OT abierta"].filter(Boolean).join(" · "),
            link: `/maintenance-plans/${encodeURIComponent(p.taskCode)}`,
          }),
          plan: p.taskCode, titulo: p.title, buque: vName(p.vesselCode), equipo: aName(p.assetId), riesgoEquipo: riskTag(p.assetId),
          diasVencido: unreliable(p) ? null : late, fechaNoConfiable: unreliable(p),
        };
      }),
    };
    sources.overduePlans = overdue.length;
  });

  // ── Postergaciones: activas y planes postergados más de una vez ──
  await section("postergaciones", async () => {
    const deferrals = await prisma.deferral.findMany({
      where: { ...inScope, deletedAt: null, OR: [{ status: { in: ACTIVE_DEFERRAL } }, { requestedAt: { gte: since365 } }] },
      orderBy: { requestedAt: "desc" },
      take: 400,
      select: { id: true, deferralCode: true, status: true, sourceType: true, sourceId: true, assetId: true, vesselCode: true, requestedAt: true, targetDate: true, toNextDrydock: true, justification: true, riskLevel: true, compensatoryMeasures: true },
    });
    await loadAssets(deferrals.map((x: any) => x.assetId));
    const active = deferrals.filter((x: any) => ACTIVE_DEFERRAL.includes(x.status));
    metrics.deferralsActive = active.length;
    const evDeferral = (x: any) => book.add({
      kind: "DEFERRAL", code: x.deferralCode, vesselCode: x.vesselCode, vesselName: vName(x.vesselCode), assetName: aName(x.assetId),
      date: d(x.requestedAt), title: `Postergación ${x.deferralCode}`,
      detail: [`Estado ${x.status}`, x.targetDate ? `hasta ${d(x.targetDate)}` : x.toNextDrydock ? "hasta la próxima varada" : "sin fecha objetivo", x.riskLevel ? `riesgo ${x.riskLevel}` : "sin análisis de riesgo", isBlank(x.compensatoryMeasures) ? "sin medidas compensatorias" : null, riskTag(x.assetId), cut(x.justification, 140) ? `motivo: "${cut(x.justification, 140)}"` : null].filter(Boolean).join(" · "),
      link: `/deferrals/${encodeURIComponent(x.deferralCode)}`,
    });

    // Un mismo origen (plan / OT / defecto) postergado 2+ veces en un año.
    const bySource = new Map<string, any[]>();
    for (const x of deferrals) {
      if (new Date(x.requestedAt) < since365) continue;
      const k = `${x.sourceType}:${x.sourceId}`;
      bySource.set(k, [...(bySource.get(k) ?? []), x]);
    }
    const repeated = Array.from(bySource.values()).filter(list => list.length >= 2);
    payload.postergaciones = {
      activas: active.length,
      activasEnEquiposCriticos: active.filter((x: any) => { const a = assetInfo.get(x.assetId); return a?.safety || a?.criticality === "A"; }).length,
      activasSinFechaObjetivo: active.filter((x: any) => !x.targetDate && !x.toNextDrydock).length,
      activas_detalle: active.slice(0, 15).map((x: any) => ({ ev: evDeferral(x), buque: vName(x.vesselCode), equipo: aName(x.assetId), riesgoEquipo: riskTag(x.assetId) })),
      postergadasMasDeUnaVez: repeated.slice(0, 10).map(list => ({
        origen: list[0].sourceType, buque: vName(list[0].vesselCode), equipo: aName(list[0].assetId), veces: list.length,
        ev: list.slice(0, 3).map(evDeferral),
      })),
    };
    sources.deferrals = deferrals.length;
  });

  // ── Correctivo vs preventivo (90 días) y horas-hombre ──
  await section("tipo de OT", async () => {
    const wos = await prisma.workOrder.findMany({
      where: { ...inScope, deletedAt: null, openDate: { gte: since90 } },
      select: { type: true, maintenanceKind: true, vesselCode: true },
    });
    const corrective = wos.filter((w: any) => w.type === "CORRECTIVE").length;
    metrics.workOrders90d = wos.length;
    metrics.correctivePct90d = wos.length ? Math.round((corrective / wos.length) * 100) : null;
    const perVessel: Record<string, { total: number; correctivas: number; emergencia: number }> = {};
    for (const w of wos) {
      const k = vName(w.vesselCode) ?? w.vesselCode;
      perVessel[k] ??= { total: 0, correctivas: 0, emergencia: 0 };
      perVessel[k].total += 1;
      if (w.type === "CORRECTIVE") perVessel[k].correctivas += 1;
      if (w.maintenanceKind === "EMERGENCIA" || w.maintenanceKind === "CORRECTIVO_NO_PROGRAMADO") perVessel[k].emergencia += 1;
    }
    const closed = await prisma.workOrder.findMany({
      where: { ...inScope, deletedAt: null, status: "CLOSED", completedDate: { gte: since90 } },
      select: { actualHours: true, estimatedHours: true },
    });
    const withHours = closed.filter((w: any) => w.actualHours != null && w.actualHours > 0);
    payload.tipoDeMantenimiento90d = {
      otAbiertasEnElPeriodo: wos.length, correctivas: corrective, porcentajeCorrectivo: metrics.correctivePct90d,
      noProgramadasOEmergencia: wos.filter((w: any) => w.maintenanceKind === "EMERGENCIA" || w.maintenanceKind === "CORRECTIVO_NO_PROGRAMADO").length,
      porBuque: perVessel,
      ev: book.add({
        kind: "KPI", code: null, vesselCode: null, vesselName: null, assetName: null, date: d(now),
        title: "Correctivo vs preventivo, últimos 90 días",
        detail: `${corrective} de ${wos.length} OT abiertas fueron correctivas (${metrics.correctivePct90d ?? "–"}%).`,
        link: "/work-orders",
      }),
    };
    payload.horasHombre = {
      otCerradas90d: closed.length,
      conHorasRealesCargadas: withHours.length,
      totalHorasReales: Math.round(withHours.reduce((s: number, w: any) => s + w.actualHours, 0)),
    };
    if (closed.length > 0 && withHours.length / closed.length < 0.5) {
      gaps.push(`Horas-hombre: sólo ${withHours.length} de ${closed.length} OT cerradas en 90 días tienen horas reales cargadas; no alcanza para medir carga de trabajo.`);
    }
    sources.workOrders90d = wos.length;
  });

  // ── Defectos repetidos por equipo (180 días) ──
  await section("defectos repetidos", async () => {
    const defects = await prisma.defect.findMany({
      where: { ...inScope, deletedAt: null, reportedAt: { gte: since180 } },
      orderBy: { reportedAt: "desc" },
      select: { defectCode: true, assetId: true, vesselCode: true, reportedAt: true, severity: true, status: true, description: true, rcaRootCause: true, workOrderId: true },
    });
    const byAsset = new Map<string, any[]>();
    for (const x of defects) byAsset.set(x.assetId, [...(byAsset.get(x.assetId) ?? []), x]);
    const repeated = Array.from(byAsset.entries()).filter(([, list]) => list.length >= 2).sort((a, b) => b[1].length - a[1].length);
    await loadAssets(repeated.map(([id]) => id));
    metrics.assetsWithRepeatedDefects = repeated.length;
    payload.defectosRepetidos = repeated.slice(0, 10).map(([assetId, list]) => ({
      equipo: aName(assetId), buque: vName(list[0].vesselCode), riesgoEquipo: riskTag(assetId), cantidad180d: list.length,
      conCausaRaiz: list.filter((x: any) => !isBlank(x.rcaRootCause)).length,
      ev: list.slice(0, 4).map((x: any) => book.add({
        kind: "DEFECT", code: x.defectCode, vesselCode: x.vesselCode, vesselName: vName(x.vesselCode), assetName: aName(assetId),
        date: d(x.reportedAt), title: cut(x.description, 90) ?? x.defectCode,
        detail: [`Severidad ${x.severity}`, `estado ${x.status}`, isBlank(x.rcaRootCause) ? "sin causa raíz" : `causa raíz: ${cut(x.rcaRootCause, 100)}`].join(" · "),
        link: `/defects/${encodeURIComponent(x.defectCode)}`,
      })),
    }));
    sources.defects180d = defects.length;
  });

  // ── Defectos abiertos graves y su cadena DEFECTO → OT → REPUESTO → CIERRE ──
  await section("cadena de defectos", async () => {
    const open = await prisma.defect.findMany({
      where: {
        ...inScope, deletedAt: null, status: { in: ACTIVE_DEFECT },
        OR: [{ severity: { in: ["HIGH", "CRITICAL"] } }, { operationalState: { in: ["DEGRADED", "RESTRICTED", "NO_GO"] } }],
      },
      orderBy: { reportedAt: "asc" },
      take: 40,
      select: { id: true, defectCode: true, assetId: true, vesselCode: true, reportedAt: true, severity: true, operationalState: true, status: true, description: true, workOrderId: true },
    });
    await loadAssets(open.map((x: any) => x.assetId));
    metrics.defectsOpenHigh = open.length;
    const woIds = open.map((x: any) => x.workOrderId).filter(Boolean);
    const wos = woIds.length ? await prisma.workOrder.findMany({
      where: { tenantId, id: { in: woIds } },
      select: { id: true, workOrderCode: true, status: true, openDate: true },
    }) : [];
    const woById = new Map(wos.map((w: any) => [w.id, w]));
    const assetIds = Array.from(new Set(open.map((x: any) => x.assetId)));
    const requests = assetIds.length ? await prisma.spareRequest.findMany({
      where: { tenantId, deletedAt: null, requestedForAssetId: { in: assetIds }, requestedForVesselCode: { in: vesselCodes } },
      select: { requestCode: true, status: true, requestedAt: true, requestedForAssetId: true, items: { select: { status: true, receivedAt: true } } },
    }) : [];

    payload.defectosAbiertosGraves = open.slice(0, 15).map((x: any) => {
      const wo: any = x.workOrderId ? woById.get(x.workOrderId) : null;
      const req = requests.filter((r: any) => r.requestedForAssetId === x.assetId && new Date(r.requestedAt) >= new Date(x.reportedAt));
      const pendingReq = req.filter((r: any) => OPEN_SPARE_REQUEST.includes(r.status));
      const missing: string[] = [];
      if (!wo) missing.push("sin OT vinculada");
      else if (["PLANNED", "ON_HOLD"].includes(wo.status)) missing.push(`OT ${wo.workOrderCode} sin avance (${wo.status})`);
      if (pendingReq.length) missing.push(`repuesto pendiente (${pendingReq.map((r: any) => r.requestCode).join(", ")})`);
      const age = daysBetween(now, new Date(x.reportedAt));
      return {
        ev: book.add({
          kind: "DEFECT", code: x.defectCode, vesselCode: x.vesselCode, vesselName: vName(x.vesselCode), assetName: aName(x.assetId),
          date: d(x.reportedAt), title: cut(x.description, 90) ?? x.defectCode,
          detail: [`Severidad ${x.severity}`, `estado operativo ${x.operationalState}`, `abierto hace ${age} días`, riskTag(x.assetId), ...missing].filter(Boolean).join(" · "),
          link: `/defects/${encodeURIComponent(x.defectCode)}`,
        }),
        buque: vName(x.vesselCode), equipo: aName(x.assetId), diasAbierto: age,
        cadena: {
          ot: wo ? { codigo: wo.workOrderCode, estado: wo.status } : null,
          solicitudesDeRepuesto: req.map((r: any) => ({ codigo: r.requestCode, estado: r.status, pedida: d(r.requestedAt), itemsRecibidos: r.items.filter((i: any) => i.receivedAt).length, items: r.items.length })),
          eslabonesFaltantes: missing,
        },
      };
    });
    sources.openHighDefects = open.length;
  });

  // ── OT cerradas sin evidencia (60 días) ──
  await section("cierres sin evidencia", async () => {
    const since60 = new Date(now.getTime() - 60 * DAY);
    const closed = await prisma.workOrder.findMany({
      where: { ...inScope, deletedAt: null, status: "CLOSED", completedDate: { gte: since60 } },
      select: { id: true, workOrderCode: true, vesselCode: true, assetId: true, title: true, type: true, completedDate: true, woResult: true, observations: true, closeNotes: true, testResult: true, checklistDocUrl: true, supportingDocUrl: true, _count: { select: { progressNotes: true } } },
    });
    const ids = closed.map((w: any) => w.id);
    const withAttachments = new Set<string>(ids.length ? (await prisma.attachment.findMany({
      where: { tenantId, targetType: "WORK_ORDER", targetId: { in: ids }, status: "ACTIVE" },
      select: { targetId: true },
    })).map((a: any) => a.targetId) : []);
    const bare = closed.filter((w: any) =>
      isBlank(w.woResult) && isBlank(w.observations) && isBlank(w.closeNotes) && isBlank(w.testResult)
      && !w.checklistDocUrl && !w.supportingDocUrl && (w._count?.progressNotes ?? 0) === 0 && !withAttachments.has(w.id));
    await loadAssets(bare.map((w: any) => w.assetId));
    metrics.closedWithoutEvidence60d = bare.length;
    metrics.closedWorkOrders60d = closed.length;
    payload.otCerradasSinEvidencia60d = {
      cerradas: closed.length,
      sinResultadoNiAdjuntosNiNotas: bare.length,
      porBuque: countBy(bare, (w: any) => vName(w.vesselCode) ?? w.vesselCode),
      ejemplos: bare.slice(0, 12).map((w: any) => book.add({
        kind: "WORK_ORDER", code: w.workOrderCode, vesselCode: w.vesselCode, vesselName: vName(w.vesselCode), assetName: aName(w.assetId),
        date: d(w.completedDate), title: w.title ?? w.workOrderCode,
        detail: `OT ${w.type} cerrada el ${d(w.completedDate)} sin resultado, sin mediciones, sin adjuntos ni notas de avance · ${riskTag(w.assetId)}`,
        link: `/work-orders/${encodeURIComponent(w.workOrderCode)}`,
      })),
    };
    sources.closedWorkOrders60d = closed.length;
  });

  // ── Laboratorio / vibraciones en alarma sin acción posterior ──
  await section("laboratorio", async () => {
    const bad = await prisma.fluidSample.findMany({
      where: { ...inScope, deletedAt: null, sampledAt: { gte: since180 }, result: { verdict: { in: ["CRITICAL", "ACTION_REQUIRED"] } } },
      orderBy: { sampledAt: "desc" },
      take: 40,
      select: { id: true, sampleCode: true, kind: true, fluidType: true, assetId: true, vesselCode: true, sampledAt: true, result: { select: { verdict: true, summary: true, receivedAt: true, defectId: true } } },
    });
    await loadAssets(bad.map((s: any) => s.assetId));
    const assetIds = Array.from(new Set(bad.map((s: any) => s.assetId)));
    const followWos = assetIds.length ? await prisma.workOrder.findMany({
      where: { tenantId, deletedAt: null, assetId: { in: assetIds }, openDate: { gte: since180 } },
      select: { assetId: true, openDate: true, workOrderCode: true },
    }) : [];
    const rows = bad.map((s: any) => {
      const after = new Date(s.result?.receivedAt ?? s.sampledAt);
      const wo = followWos.find((w: any) => w.assetId === s.assetId && new Date(w.openDate) >= after);
      return { s, wo, acted: !!wo || !!s.result?.defectId };
    });
    const without = rows.filter((r: any) => !r.acted);
    metrics.labAlarmsWithoutAction = without.length;
    payload.laboratorioEnAlarma180d = {
      total: rows.length,
      sinOtNiDefectoPosterior: without.length,
      detalle: rows.slice(0, 12).map((r: any) => {
        const s = r.s;
        const age = daysBetween(now, new Date(s.result?.receivedAt ?? s.sampledAt));
        return {
          ev: book.add({
            kind: "LAB", code: s.sampleCode, vesselCode: s.vesselCode, vesselName: vName(s.vesselCode), assetName: aName(s.assetId),
            date: d(s.sampledAt), title: `${s.kind === "FLUID" ? `Análisis de ${s.fluidType ?? "fluido"}` : `Análisis ${s.kind}`} — ${s.result?.verdict}`,
            detail: [cut(s.result?.summary, 160), r.acted ? (r.wo ? `acción posterior: OT ${r.wo.workOrderCode}` : "vinculado a un defecto") : `sin OT ni defecto posterior (${age} días)`, riskTag(s.assetId)].filter(Boolean).join(" · "),
            link: `/fluid-analyses?openId=${encodeURIComponent(s.id)}`,
          }),
          buque: vName(s.vesselCode), equipo: aName(s.assetId), conAccionPosterior: r.acted,
        };
      }),
    };
    sources.labAlarms = rows.length;
  });

  // ── Repuestos críticos bajo mínimo y solicitudes demoradas ──
  await section("repuestos", async () => {
    const spares = await prisma.spare.findMany({
      where: { ...inScope, deletedAt: null, status: "ACTIVE", criticality: "A", minStock: { gt: 0 } },
      select: { id: true, sku: true, name: true, vesselCode: true, minStock: true, reorderPoint: true, leadTimeDays: true, unit: true, linkedAssetId: true },
    });
    const onHand = await getOnHandMap(prisma, spares.map((s: any) => s.id), { tenantId });
    const below = spares.filter((s: any) => (onHand.get(s.id) ?? 0) < s.minStock);
    await loadAssets(below.map((s: any) => s.linkedAssetId).filter(Boolean));
    metrics.criticalSparesBelowMin = below.length;

    const reqs = await prisma.spareRequest.findMany({
      where: { tenantId, deletedAt: null, status: { in: OPEN_SPARE_REQUEST }, requestedForVesselCode: { in: vesselCodes } },
      orderBy: { requestedAt: "asc" },
      take: 60,
      select: { requestCode: true, status: true, priority: true, requestedAt: true, requestedForVesselCode: true, requestedForAssetId: true, items: { select: { description: true, status: true, spare: { select: { leadTimeDays: true, criticality: true } } } } },
    });
    await loadAssets(reqs.map((r: any) => r.requestedForAssetId).filter(Boolean));
    const late = reqs.map((r: any) => {
      const age = daysBetween(now, new Date(r.requestedAt));
      const lead = Math.max(0, ...r.items.map((i: any) => i.spare?.leadTimeDays ?? 0));
      return { r, age, lead, late: lead > 0 ? age > lead : age > 30 };
    }).filter((x: any) => x.late);

    // Sin ningún movimiento de stock jamás = el inventario de ese repuesto nunca
    // se cargó. Es calidad de datos, no necesariamente falta física del repuesto.
    const neverCounted = below.filter((s: any) => !onHand.has(s.id)).length;
    metrics.criticalSparesNeverCounted = neverCounted;
    metrics.criticalSparesWithMin = spares.length;
    below.sort((a: any, b: any) => Number(onHand.has(b.id)) - Number(onHand.has(a.id)));
    payload.repuestos = {
      criticosConMinimo: spares.length,
      criticosBajoMinimo: below.length,
      bajoMinimoSinNingunMovimientoDeStock: neverCounted,
      notaCalidadDeDatos: neverCounted
        ? `${neverCounted} de los ${below.length} repuestos críticos bajo mínimo no tienen NINGÚN movimiento de stock registrado: su inventario probablemente nunca se cargó. No afirmar que falten físicamente; tratarlo como problema de calidad de datos del inventario.`
        : null,
      detalleBajoMinimo: below.slice(0, 20).map((s: any) => ({
        ev: book.add({
          kind: "SPARE", code: s.sku, vesselCode: s.vesselCode, vesselName: vName(s.vesselCode), assetName: aName(s.linkedAssetId),
          date: d(now), title: s.name,
          detail: `Criticidad A · ${onHand.has(s.id) ? `stock ${onHand.get(s.id)} ${s.unit}` : "sin ningún movimiento de stock registrado"} (mínimo ${s.minStock})${s.leadTimeDays ? ` · plazo teórico ${s.leadTimeDays} días` : " · sin plazo de entrega cargado"}`,
          link: `/spares?vesselCode=${encodeURIComponent(s.vesselCode)}&criticality=A`,
        }),
        buque: vName(s.vesselCode),
      })),
      solicitudesDemoradas: late.slice(0, 12).map((x: any) => ({
        ev: book.add({
          kind: "SPARE_REQUEST", code: x.r.requestCode, vesselCode: x.r.requestedForVesselCode, vesselName: vName(x.r.requestedForVesselCode), assetName: aName(x.r.requestedForAssetId),
          date: d(x.r.requestedAt), title: `Solicitud de repuestos ${x.r.requestCode}`,
          detail: `${x.r.status} hace ${x.age} días · prioridad ${x.r.priority} · ${x.lead ? `plazo teórico ${x.lead} días` : "sin plazo teórico (se toma 30 días)"} · ${x.r.items.length} ítems`,
          link: "/spare-requests",
        }),
        buque: vName(x.r.requestedForVesselCode), diasAbierta: x.age,
      })),
    };
    sources.criticalSpares = spares.length;
    sources.openSpareRequests = reqs.length;
  });

  // ── Certificados y fechas de clase (60 días) ──
  await section("certificados", async () => {
    const certs = await prisma.certificate.findMany({
      where: {
        ...inScope, deletedAt: null, status: { notIn: ["CLOSED"] },
        OR: [
          { expiryDate: { lte: in60 } },
          { intermediateSurveyDueDate: { lte: in60 } }, { periodicSurveyDueDate: { lte: in60 } },
          { drydockSurveyDueDate: { lte: in60 } }, { tailshaftSurveyDueDate: { lte: in60 } },
        ],
      },
      orderBy: { expiryDate: "asc" },
      take: 30,
      select: { certificateCode: true, name: true, vesselCode: true, status: true, expiryDate: true, intermediateSurveyDueDate: true, periodicSurveyDueDate: true, drydockSurveyDueDate: true, tailshaftSurveyDueDate: true },
    });
    // Las fechas centinela (2000 / 2099) son cargas sin dato: no se cuentan como vencimiento.
    const real = (v: unknown) => { const y = v ? new Date(v as string).getUTCFullYear() : 0; return y > 2000 && y < 2090; };
    const rows = certs.filter((c: any) => [c.expiryDate, c.intermediateSurveyDueDate, c.periodicSurveyDueDate, c.drydockSurveyDueDate, c.tailshaftSurveyDueDate].some(v => real(v) && new Date(v) <= in60));
    metrics.certificatesDue60d = rows.length;
    payload.certificadosProximos60d = rows.slice(0, 15).map((c: any) => {
      const dates = [
        ["vencimiento", c.expiryDate], ["inspección intermedia", c.intermediateSurveyDueDate], ["inspección periódica", c.periodicSurveyDueDate],
        ["inspección en dique", c.drydockSurveyDueDate], ["eje de cola", c.tailshaftSurveyDueDate],
      ].filter(([, v]) => real(v) && new Date(v as Date) <= in60).map(([k, v]) => `${k} ${d(v)}${new Date(v as Date) < now ? " (VENCIDA)" : ""}`);
      return {
        ev: book.add({
          kind: "CERTIFICATE", code: c.certificateCode, vesselCode: c.vesselCode, vesselName: vName(c.vesselCode), assetName: null,
          date: d(c.expiryDate), title: c.name, detail: dates.join(" · "),
          link: `/certificates?vesselCode=${encodeURIComponent(c.vesselCode)}`,
        }),
        buque: vName(c.vesselCode),
      };
    });
    sources.certificates = certs.length;
  });

  // ── Proveedores: no conformidades abiertas ──
  await section("proveedores", async () => {
    const ncs = await prisma.providerNonconformity.findMany({
      where: { ...inScope, deletedAt: null, status: { in: ["OPEN", "UNDER_REVIEW"] } },
      orderBy: { reportedAt: "asc" },
      take: 10,
      select: { nonconformityCode: true, vesselCode: true, severity: true, reportedAt: true, description: true, provider: { select: { name: true } } },
    });
    payload.noConformidadesDeProveedores = ncs.map((n: any) => ({
      ev: book.add({
        kind: "PROVIDER_NC", code: n.nonconformityCode, vesselCode: n.vesselCode, vesselName: vName(n.vesselCode), assetName: null,
        date: d(n.reportedAt), title: `${n.provider?.name ?? "Proveedor"} — no conformidad`,
        detail: `Severidad ${n.severity} · abierta hace ${daysBetween(now, new Date(n.reportedAt))} días · ${cut(n.description, 140) ?? ""}`,
        link: "/providers",
      }),
      proveedor: n.provider?.name ?? null,
    }));
    sources.providerNcs = ncs.length;
  });

  // ── Tripulación: agregados por buque (sin nombres: se buscan causas del sistema, no culpables) ──
  await section("tripulación", async () => {
    const certs = await prisma.crewCertification.findMany({
      where: { tenantId, OR: [{ status: "EXPIRED" }, { expiryDate: { lte: in60 } }], crew: { vesselCode: { in: vesselCodes } } },
      select: { type: true, status: true, expiryDate: true, crew: { select: { vesselCode: true } } },
    });
    const since30 = new Date(now.getTime() - 30 * DAY);
    const violations = await prisma.crewRestHours.count({ where: { ...inScope, hasViolation: true, recordDate: { gte: since30 } } });
    const perVessel: Record<string, { vencidos: number; porVencer60d: number }> = {};
    for (const c of certs) {
      const k = vName(c.crew?.vesselCode) ?? c.crew?.vesselCode ?? "?";
      perVessel[k] ??= { vencidos: 0, porVencer60d: 0 };
      if (c.status === "EXPIRED" || (c.expiryDate && new Date(c.expiryDate) < now)) perVessel[k].vencidos += 1;
      else perVessel[k].porVencer60d += 1;
    }
    payload.tripulacion = {
      certificadosDeTripulacion: perVessel,
      violacionesHorasDeDescanso30d: violations,
      ev: book.add({
        kind: "CREW", code: null, vesselCode: null, vesselName: null, assetName: null, date: d(now),
        title: "Tripulación: certificados y horas de descanso",
        detail: `${certs.length} certificados de tripulación vencidos o por vencer en 60 días · ${violations} registros con violación de horas de descanso en 30 días`,
        link: "/crew",
      }),
    };
    sources.crewCertificates = certs.length;
  });

  // ── Alertas automáticas del sistema ya abiertas ──
  await section("alertas", async () => {
    const alerts = await prisma.aiInsight.findMany({
      where: { tenantId, status: "OPEN", OR: [{ vesselCode: { in: vesselCodes } }, { vesselCode: null }] },
      orderBy: [{ priority: "asc" }, { detectedAt: "desc" }],
      take: 15,
      select: { insightType: true, priority: true, title: true, summary: true, vesselCode: true, detectedAt: true },
    });
    payload.alertasAutomaticas = alerts.map((a: any) => ({
      ev: book.add({
        kind: "ALERT", code: null, vesselCode: a.vesselCode, vesselName: vName(a.vesselCode), assetName: null,
        date: d(a.detectedAt), title: a.title, detail: `${a.insightType} · prioridad ${a.priority} · ${cut(a.summary, 160) ?? ""}`,
        link: null,
      }),
    }));
    sources.alerts = alerts.length;
  });

  // Los planes vencidos que ya tienen una postergación activa quedaron contados
  // en las dos secciones: se aclara para que la IA no los sume dos veces.
  payload.notas = [
    "Un plan vencido puede tener además una postergación activa: no sumar ambas cifras como problemas distintos.",
    "Las cifras de cada sección están calculadas por el sistema y son exactas.",
  ];

  return {
    periodFrom: since365, periodTo: now, vesselCodes, metrics, payload,
    evidence: book.all(), dataGaps: gaps, sources,
  };
}

function countBy<T>(list: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of list) { const k = key(x); out[k] = (out[k] ?? 0) + 1; }
  return out;
}
