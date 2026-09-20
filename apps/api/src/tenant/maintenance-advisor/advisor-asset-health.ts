// Radiografía de equipos (pedido de Gustavo, 20/09/2026).
//
// El plan al día no alcanza: un equipo puede estar DELICADO aunque se lo esté
// reparando. Acá el CÓDIGO mira los últimos 12 meses de cada equipo y junta las
// señales que lo delatan — se repara seguido, se repara sin estar planificado,
// los defectos vuelven, el laboratorio lo marca, se come repuestos — y le pone
// un estado. La IA no decide esto: lo recibe ya calculado y lo usa para sus temas.
//
// Que al equipo se le estén haciendo las reparaciones NO lo saca de la lista:
// justamente esa es la señal que el Director quiere ver.

import { log } from "../../common/logger";

const DAY = 24 * 60 * 60 * 1000;
const ACTIVE_DEFERRAL = ["REQUESTED", "UNDER_REVIEW", "APPROVED", "ACTIVE"];
const ACTIVE_DEFECT = ["OPEN", "UNDER_REVIEW", "IN_PROGRESS", "DEFERRED"];
const UNPLANNED_KINDS = ["EMERGENCIA", "CORRECTIVO_NO_PROGRAMADO"];
const BAD_VERDICTS = ["CRITICAL", "ACTION_REQUIRED"];

export type AssetHealthState = "FRAGILE" | "WATCH" | "OK";

/** Señal que empujó al equipo: la UI la traduce, la IA la lee como texto. */
export interface AssetHealthSignal {
  code:
    | "UNPLANNED" | "CORRECTIVE" | "DEFECTS_REPEATED" | "DEFECT_REOPENED" | "LAB_ALARM" | "LAB_CAUTION"
    | "DEFERRAL" | "OVERDUE" | "SPARES" | "NO_BACKUP" | "DEGRADED";
  n?: number;
}

export interface AssetHealthRow {
  assetId: string;
  assetName: string;
  assetCode: string;
  vesselCode: string;
  vesselName: string | null;
  criticality: string;
  safetyCritical: boolean;
  state: AssetHealthState;
  score: number;
  signals: AssetHealthSignal[];
  /** Números crudos, para el detalle y para la IA. */
  counts: {
    correctives: number; unplanned: number; defects: number; defectsReopened: number;
    labAlarms: number; labCautions: number; deferrals: number; overduePlans: number;
    spareIssues: number; spareQty: number;
  };
  noBackup: boolean;
}

export interface FleetModelIssue {
  manufacturer: string | null;
  model: string;
  vessels: string[];
  assets: number;
  defects: number;
  unplanned: number;
}

export interface AssetHealthResult {
  rows: AssetHealthRow[];
  fragile: number;
  watch: number;
  /** Mismo modelo de equipo fallando en varios buques: decisión de flota. */
  fleetModels: FleetModelIssue[];
}

// "Delicado" tiene que ser una lista corta y creíble: con el umbral en 6, en
// mercurio casi todos los motores caían ahí y nadie quedaba "en observación".
const STATE_FROM_SCORE = (score: number): AssetHealthState => (score >= 9 ? "FRAGILE" : score >= 5 ? "WATCH" : "OK");

/** Texto corto para la IA (la UI usa `signals` traducidas). */
export function signalText(s: AssetHealthSignal): string {
  switch (s.code) {
    case "UNPLANNED": return `${s.n} reparaciones no planificadas o de emergencia`;
    case "CORRECTIVE": return `${s.n} reparaciones correctivas`;
    case "DEFECTS_REPEATED": return `${s.n} defectos en el período (se repiten)`;
    case "DEFECT_REOPENED": return `${s.n} defectos reabiertos`;
    case "LAB_ALARM": return `${s.n} análisis de laboratorio o vibraciones en alarma`;
    case "LAB_CAUTION": return `${s.n} análisis en precaución`;
    case "DEFERRAL": return `${s.n} postergaciones activas`;
    case "OVERDUE": return `${s.n} tareas del plan vencidas`;
    case "SPARES": return `consume muchos más repuestos que equipos iguales (${s.n} consumos)`;
    case "NO_BACKUP": return "equipo crítico sin otro que lo reemplace";
    case "DEGRADED": return "hoy está degradado o fuera de servicio";
  }
}

/**
 * Radiografía de los equipos de los buques del alcance.
 *
 * `overdueByAsset` viene del cálculo de planes vencidos que ya hizo el paquete
 * de evidencia, para no repetir la consulta.
 */
export async function buildAssetHealth(
  prisma: any,
  tenantId: string,
  vesselCodes: string[],
  vesselName: (code: string | null | undefined) => string | null,
  overdueByAsset: Map<string, number>,
  limit = 15,
): Promise<AssetHealthResult> {
  const now = new Date();
  const since = new Date(now.getTime() - 365 * DAY);
  const inScope = { tenantId, vesselCode: { in: vesselCodes } };

  const [assets, workOrders, defects, samples, deferrals] = await Promise.all([
    prisma.asset.findMany({
      where: { ...inScope, deletedAt: null },
      select: {
        id: true, name: true, assetCode: true, vesselCode: true, criticality: true, isSafetyCritical: true,
        isStandby: true, equipmentClassId: true, manufacturer: true, model: true, status: true,
      },
    }),
    prisma.workOrder.findMany({
      where: { ...inScope, deletedAt: null, openDate: { gte: since } },
      select: { id: true, assetId: true, type: true, maintenanceKind: true },
    }),
    prisma.defect.findMany({
      where: { ...inScope, deletedAt: null, OR: [{ reportedAt: { gte: since } }, { status: { in: ACTIVE_DEFECT } }] },
      select: { assetId: true, reportedAt: true, status: true, operationalState: true, reopenCount: true },
    }),
    prisma.fluidSample.findMany({
      where: { ...inScope, deletedAt: null, sampledAt: { gte: since }, result: { isNot: null } },
      select: { assetId: true, result: { select: { verdict: true } } },
    }),
    prisma.deferral.findMany({
      where: { ...inScope, deletedAt: null, status: { in: ACTIVE_DEFERRAL } },
      select: { assetId: true },
    }),
  ]);

  // Repuestos consumidos por equipo: salidas de stock que referencian una OT suya.
  const woAsset = new Map<string, string>(workOrders.map((w: any) => [w.id, w.assetId]));
  const spareByAsset = new Map<string, { issues: number; qty: number }>();
  try {
    const movements = await prisma.stockMovement.findMany({
      where: { tenantId, vesselCode: { in: vesselCodes }, movementType: "ISSUE", referenceType: "WORK_ORDER", occurredAt: { gte: since } },
      select: { referenceId: true, quantity: true },
    });
    for (const m of movements) {
      const assetId = m.referenceId ? woAsset.get(m.referenceId) : null;
      if (!assetId) continue;
      const prev = spareByAsset.get(assetId) ?? { issues: 0, qty: 0 };
      spareByAsset.set(assetId, { issues: prev.issues + 1, qty: prev.qty + Math.abs(m.quantity ?? 0) });
    }
  } catch (err) {
    log.error("[advisor-asset-health] consumo de repuestos no disponible:", err);
  }

  // ¿Tiene otro equipo que lo reemplace? Mismo buque y misma clase (o modelo).
  const peers = new Map<string, number>();
  const peerKey = (a: any) => `${a.vesselCode}::${a.equipmentClassId ?? a.model ?? a.name}`;
  for (const a of assets) peers.set(peerKey(a), (peers.get(peerKey(a)) ?? 0) + 1);

  // Consumo promedio de repuestos de los equipos del mismo modelo, para comparar.
  const modelIssues = new Map<string, number[]>();
  for (const a of assets) {
    if (!a.model) continue;
    const s = spareByAsset.get(a.id);
    modelIssues.set(a.model, [...(modelIssues.get(a.model) ?? []), s?.issues ?? 0]);
  }

  const byAsset = new Map<string, AssetHealthRow>();
  for (const a of assets) {
    byAsset.set(a.id, {
      assetId: a.id, assetName: a.name, assetCode: a.assetCode, vesselCode: a.vesselCode,
      vesselName: vesselName(a.vesselCode), criticality: a.criticality, safetyCritical: a.isSafetyCritical,
      state: "OK", score: 0, signals: [],
      counts: { correctives: 0, unplanned: 0, defects: 0, defectsReopened: 0, labAlarms: 0, labCautions: 0, deferrals: 0, overduePlans: 0, spareIssues: 0, spareQty: 0 },
      noBackup: false,
    });
  }

  const degraded = new Set<string>();
  for (const w of workOrders) {
    const row = byAsset.get(w.assetId); if (!row) continue;
    if (w.type === "CORRECTIVE") row.counts.correctives += 1;
    if (UNPLANNED_KINDS.includes(String(w.maintenanceKind))) row.counts.unplanned += 1;
  }
  for (const d of defects) {
    const row = byAsset.get(d.assetId); if (!row) continue;
    if (new Date(d.reportedAt) >= since) row.counts.defects += 1;
    row.counts.defectsReopened += d.reopenCount ?? 0;
    if (ACTIVE_DEFECT.includes(d.status) && ["DEGRADED", "RESTRICTED", "NO_GO"].includes(String(d.operationalState))) degraded.add(d.assetId);
  }
  for (const s of samples) {
    const row = byAsset.get(s.assetId); if (!row) continue;
    const v = String(s.result?.verdict);
    if (BAD_VERDICTS.includes(v)) row.counts.labAlarms += 1;
    else if (v === "CAUTION") row.counts.labCautions += 1;
  }
  for (const d of deferrals) {
    const row = byAsset.get(d.assetId); if (!row) continue;
    row.counts.deferrals += 1;
  }
  for (const [assetId, n] of overdueByAsset) {
    const row = byAsset.get(assetId); if (!row) continue;
    row.counts.overduePlans = n;
  }
  for (const [assetId, s] of spareByAsset) {
    const row = byAsset.get(assetId); if (!row) continue;
    row.counts.spareIssues = s.issues;
    row.counts.spareQty = Math.round(s.qty * 100) / 100;
  }

  // ── Puntaje ──
  for (const a of assets) {
    const row = byAsset.get(a.id)!;
    const c = row.counts;
    let score = 0;
    const signals: AssetHealthSignal[] = [];

    if (c.unplanned > 0) { score += Math.min(2 + (c.unplanned - 1), 4); signals.push({ code: "UNPLANNED", n: c.unplanned }); }
    if (c.correctives >= 3) { score += 2; signals.push({ code: "CORRECTIVE", n: c.correctives }); }
    else if (c.correctives === 2) { score += 1; signals.push({ code: "CORRECTIVE", n: c.correctives }); }
    if (c.defects >= 2) { score += 2; signals.push({ code: "DEFECTS_REPEATED", n: c.defects }); }
    if (c.defectsReopened > 0) { score += 1; signals.push({ code: "DEFECT_REOPENED", n: c.defectsReopened }); }
    if (c.labAlarms > 0) { score += 3; signals.push({ code: "LAB_ALARM", n: c.labAlarms }); }
    else if (c.labCautions >= 2) { score += 1; signals.push({ code: "LAB_CAUTION", n: c.labCautions }); }
    if (c.deferrals > 0) { score += 1; signals.push({ code: "DEFERRAL", n: c.deferrals }); }
    if (c.overduePlans > 0) { score += 1; signals.push({ code: "OVERDUE", n: c.overduePlans }); }

    // Se come repuestos comparado con sus gemelos (mismo modelo, al menos 3 equipos).
    const siblings = a.model ? modelIssues.get(a.model) ?? [] : [];
    if (siblings.length >= 3 && c.spareIssues >= 3) {
      const avg = siblings.reduce((x: number, y: number) => x + y, 0) / siblings.length;
      if (avg > 0 && c.spareIssues >= avg * 2) { score += 1; signals.push({ code: "SPARES", n: c.spareIssues }); }
    }

    if (degraded.has(a.id)) { score += 2; signals.push({ code: "DEGRADED" }); }

    // Crítico sin respaldo: si además está flojo, sube al tope.
    const alone = (peers.get(peerKey(a)) ?? 1) <= 1 && !a.isStandby;
    row.noBackup = alone && (a.isSafetyCritical || a.criticality === "A");
    if (row.noBackup && score >= 2) { score += 2; signals.push({ code: "NO_BACKUP" }); }
    else if ((a.isSafetyCritical || a.criticality === "A") && score >= 2) score += 1;

    row.score = score;
    row.signals = signals;
    row.state = STATE_FROM_SCORE(score);
  }

  const rows = Array.from(byAsset.values())
    .filter(r => r.state !== "OK")
    .sort((a, b) => b.score - a.score || a.assetName.localeCompare(b.assetName));

  // ── Mismo modelo fallando en varios buques ──
  const byModel = new Map<string, { manufacturer: string | null; model: string; vessels: Set<string>; assets: Set<string>; defects: number; unplanned: number }>();
  for (const a of assets) {
    if (!a.model) continue;
    const row = byAsset.get(a.id)!;
    if (row.counts.defects === 0 && row.counts.unplanned === 0) continue;
    const key = `${a.manufacturer ?? ""}|${a.model}`;
    const e = byModel.get(key) ?? { manufacturer: a.manufacturer ?? null, model: a.model, vessels: new Set<string>(), assets: new Set<string>(), defects: 0, unplanned: 0 };
    e.vessels.add(vesselName(a.vesselCode) ?? a.vesselCode);
    e.assets.add(a.id);
    e.defects += row.counts.defects;
    e.unplanned += row.counts.unplanned;
    byModel.set(key, e);
  }
  const fleetModels: FleetModelIssue[] = Array.from(byModel.values())
    .filter(e => e.vessels.size >= 3 && e.defects + e.unplanned >= 4)
    .map(e => ({ manufacturer: e.manufacturer, model: e.model, vessels: Array.from(e.vessels).sort(), assets: e.assets.size, defects: e.defects, unplanned: e.unplanned }))
    .sort((a, b) => (b.defects + b.unplanned) - (a.defects + a.unplanned))
    .slice(0, 5);

  return {
    rows: rows.slice(0, limit),
    fragile: rows.filter(r => r.state === "FRAGILE").length,
    watch: rows.filter(r => r.state === "WATCH").length,
    fleetModels,
  };
}
