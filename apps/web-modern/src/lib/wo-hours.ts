// Horas por equipo al cerrar una OT.
//
// Una OT puede cubrir planes de equipos con horómetros distintos (Motor Babor y
// Motor Estribor), y un solo número no dice de cuál es. El cierre pide una
// lectura por cada equipo que tenga planes por horas. Lo comparten el modal de
// escritorio (WorkOrders.tsx) y el cierre del celular (MobileWorkOrders.tsx).

export interface HourAsset {
  assetId: string;
  assetName: string;
  /** Mayor última lectura con la que se ejecutó un plan por horas del equipo (piso de la nueva). */
  lastHours: number | null;
}

interface PlanHours {
  assetId: string;
  assetName?: string | null;
  triggerType?: string;
  lastExecutionHours?: number | null;
}

/** Equipos con planes por horas de la OT, el principal primero. */
export function hourAssetsOf(plans: PlanHours[] | undefined, mainAssetId: string | undefined): HourAsset[] {
  const byAsset = new Map<string, HourAsset>();
  for (const p of plans ?? []) {
    if (p.triggerType !== "HOURS" && p.triggerType !== "RUNNING_HOURS") continue;
    const prevLast = byAsset.get(p.assetId)?.lastHours ?? null;
    const last = p.lastExecutionHours ?? null;
    byAsset.set(p.assetId, {
      assetId: p.assetId,
      assetName: p.assetName ?? p.assetId,
      lastHours: last == null ? prevLast : prevLast == null ? last : Math.max(last, prevLast),
    });
  }
  return [...byAsset.values()].sort((a, b) => Number(b.assetId === mainAssetId) - Number(a.assetId === mainAssetId));
}

/** "missing" sin número, "below" si es menor a la última lectura del equipo, null si está bien. */
export function hourReadingIssue(raw: string, lastHours: number | null): "missing" | "below" | null {
  if (raw.trim() === "" || !Number.isFinite(Number(raw))) return "missing";
  if (lastHours != null && Number(raw) < lastHours) return "below";
  return null;
}
