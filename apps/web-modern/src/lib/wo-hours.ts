// Horas por equipo al cerrar una OT.
//
// Una OT puede cubrir planes de equipos con horómetros distintos (Motor Babor y
// Motor Estribor), y un solo número no dice de cuál es. El cierre pide una
// lectura por cada equipo que tenga planes por horas. Lo comparten el modal de
// escritorio (WorkOrders.tsx) y el cierre del celular (MobileWorkOrders.tsx).

import type { TranslationKey } from "./i18n";

export interface HourAsset {
  assetId: string;
  assetName: string;
  /** Mayor última lectura con la que se ejecutó un plan por horas del equipo (piso de la nueva). */
  lastHours: number | null;
  /** OT cerrada que dejó esa lectura, para explicar el aviso de horas menores. */
  lastSource: LastReadingSource | null;
}

export interface LastReadingSource {
  id: string;
  code: string;
  completedDate: string | null;
}

interface PlanHours {
  assetId: string;
  assetName?: string | null;
  triggerType?: string;
  lastExecutionHours?: number | null;
  lastExecutionWo?: LastReadingSource | null;
}

/** Equipos con planes por horas de la OT, el principal primero. */
export function hourAssetsOf(plans: PlanHours[] | undefined, mainAssetId: string | undefined): HourAsset[] {
  const byAsset = new Map<string, HourAsset>();
  for (const p of plans ?? []) {
    if (p.triggerType !== "HOURS" && p.triggerType !== "RUNNING_HOURS") continue;
    const prev = byAsset.get(p.assetId);
    const prevLast = prev?.lastHours ?? null;
    const last = p.lastExecutionHours ?? null;
    const wins = last != null && (prevLast == null || last > prevLast);
    byAsset.set(p.assetId, {
      assetId: p.assetId,
      assetName: p.assetName ?? p.assetId,
      lastHours: wins ? last : prevLast,
      lastSource: wins ? (p.lastExecutionWo ?? null) : (prev?.lastSource ?? null),
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

type Translate = (key: TranslationKey) => string;

/** dd/mm/aaaa de una fecha ISO (las de ejecución se guardan al mediodía UTC). */
function isoToDmy(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * Aviso completo de horas menores a la última lectura: además del número dice
 * qué OT la dejó y qué puede estar pasando. Si las dos tienen la misma fecha,
 * casi seguro es el mismo trabajo cargado dos veces.
 */
export function hoursBelowMessage(t: Translate, a: HourAsset, executionDate: string | null, short = false): string {
  const base = t("wo.modal.hoursBelowLast").replace("{asset}", a.assetName).replace("{h}", (a.lastHours ?? 0).toLocaleString());
  const src = a.lastSource;
  if (!src) return base;
  const srcDate = src.completedDate ? isoToDmy(src.completedDate) : "—";
  const source = t("wo.modal.hoursBelowSource").replace("{code}", src.code).replace("{date}", srcDate);
  if (short) return `${base} ${source}`;
  const sameDay = !!executionDate && !!src.completedDate && executionDate.slice(0, 10) === src.completedDate.slice(0, 10);
  const advice = sameDay
    ? t("wo.modal.hoursBelowDuplicate").replace("{code}", src.code)
    : t("wo.modal.hoursBelowCheck").replace("{code}", src.code);
  return `${base}\n\n${source}\n\n${advice}`;
}
