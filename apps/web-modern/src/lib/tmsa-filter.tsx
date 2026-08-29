// Filtro "vengo de un panel de cumplimiento" para los listados de módulo.
//
// En /tmsa y en /ism cada tarjeta muestra números del buque (ej. "Sin plan: 11").
// Al clickear el badge, se navega al módulo con
// `?tmsaMetric=<clave>&vesselCode=<buque>` y la planilla queda mostrando SÓLO
// esos registros.
//
// Por qué así y no con un filtro nuevo en cada endpoint: el número de la tarjeta
// y el de la planilla tienen que coincidir siempre (es una pantalla que se le
// muestra a un auditor). Se piden los MISMOS registros que contó la tarjeta, al
// mismo endpoint de detalle, así que coinciden por construcción — no hay dos
// cálculos que puedan divergir.

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { X, Filter, Loader2 } from "lucide-react";
import { api } from "./api";
import { useT, type TranslationKey } from "./i18n";

/** Tope del detalle en el backend; si se alcanza, el cartel lo dice. */
const DETAIL_CAP = 1000;

/**
 * Métrica → planilla que la muestra.
 *
 * Al clickear el badge de la métrica, la pantalla del módulo se abre con
 * `?tmsaMetric=<clave>&vesselCode=<buque>` y filtra por los MISMOS registros que
 * contó la tarjeta (ver `useTmsaFilter` abajo).
 *
 * Cubre las métricas del panel TMSA (Elemento 4) y las del panel ISM Cap. 10
 * (prefijo `ism`), que comparten el mismo contrato de detalle.
 *
 * Las métricas que NO están acá se quedan con la ventanita de detalle porque no
 * existe una planilla cuyas filas sean esa entidad:
 *  · `inspectionsTotal` / `inspectionsOverdue` / `ismRegulatoryInspections`
 *    salen de la tabla Inspection, y /inspections en realidad lista OT;
 *  · `drydockItemsTotal` / `drydockItemsFromBacklog` son renglones adentro de
 *    una especificación de varada;
 *  · `ismAuditFindingsOpen` son hallazgos, y /external-audits lista auditorías.
 *
 * Las métricas de porcentaje (kind "pct") tampoco navegan: no son una lista.
 */
const MODULE_BY_METRIC: Record<string, string> = {
  // ── TMSA Elemento 4 ──
  assetsTotal: "/assets", assetsWithPlan: "/assets", assetsWithoutPlan: "/assets",
  criticalAssets: "/assets", safetyCritical: "/assets", recurringAssets: "/assets",
  criticalOverdueWo: "/work-orders", woOpen: "/work-orders", woOverdue: "/work-orders",
  woCriticalOverdue: "/work-orders", auditsLast12m: "/work-orders", auditsAtSea: "/work-orders",
  plansOverdue: "/maintenance-plans", plansWithSampling: "/maintenance-plans",
  deferralsActive: "/deferrals", deferralsWithRisk: "/deferrals", deferralsWithApproval: "/deferrals",
  deferralsExpired: "/deferrals", deferralsNotInSpec: "/deferrals",
  defectsTotal: "/defects", defectsStaleOpen: "/defects", defectsWithRca: "/defects",
  certificatesTotal: "/certificates", certificatesExpired: "/certificates", certificatesExpiringSoon: "/certificates",
  sparesCriticalLow: "/spares", spareRequestsPending: "/spare-requests",
  analysesOutOfRange: "/fluid-analyses",
  mocOpen: "/moc", mocPendingImpl: "/moc",
  permitsTotal: "/permits", permitsDraftStuck: "/permits",
  drydockSpecsOpen: "/drydock-specs",
  // ── Código ISM Cap. 10 ──
  ismCertificatesWithPlan: "/certificates",
  ismNcOpen: "/defects", ismNcWithCause: "/defects", ismNcWithoutCause: "/defects",
  ismDefectsClosed90d: "/defects", ismClosedWithAction: "/defects", ismClosedWithoutAction: "/defects",
  ismCorrectiveWoOpen: "/work-orders", ismWoClosed90d: "/work-orders",
  ismSafetyCriticalTotal: "/assets", ismSafetyCriticalWithPlan: "/assets", ismSafetyCriticalWithoutPlan: "/assets",
  ismPreDepartureChecks30d: "/checklists",
};

/** Link a la planilla del módulo con el filtro de esta métrica puesto. */
export function moduleListLink(metricKey: string, vesselCode: string): string | null {
  const route = MODULE_BY_METRIC[metricKey];
  if (!route) return null;
  return `${route}?tmsaMetric=${encodeURIComponent(metricKey)}&vesselCode=${encodeURIComponent(vesselCode)}`;
}


interface TmsaDetailItem { id: string; code: string }

export interface TmsaFilterState {
  metricKey: string;
  vesselCode: string;
  /** ids de las entidades que contó la tarjeta. */
  ids: Set<string>;
  /** códigos de esas mismas entidades (algunos listados no comparten el id). */
  codes: Set<string>;
  loading: boolean;
  error: boolean;
  /** El detalle llegó al tope: la planilla muestra menos de lo que dice la tarjeta. */
  truncated: boolean;
  /** Saca el filtro y vuelve a mostrar la lista completa. */
  clear: () => void;
}

/**
 * Devuelve el filtro activo, o null si la pantalla se abrió normalmente.
 *
 * No usa `useFetch` a propósito: ese hook pisa el `vesselCode` del path con el
 * buque seleccionado en el header, y acá el buque tiene que ser el de la tarjeta
 * de la que se vino, aunque después se cambie el selector de arriba.
 */
export function useTmsaFilter(): TmsaFilterState | null {
  const [searchParams, setSearchParams] = useSearchParams();
  const metricKey = (searchParams.get("tmsaMetric") ?? "").trim();
  const vesselCode = (searchParams.get("vesselCode") ?? "").trim().toUpperCase();

  const [state, setState] = useState<{ ids: Set<string>; codes: Set<string>; loading: boolean; error: boolean }>(
    { ids: new Set(), codes: new Set(), loading: false, error: false },
  );

  useEffect(() => {
    if (!metricKey || !vesselCode) return;
    let cancelled = false;
    setState({ ids: new Set(), codes: new Set(), loading: true, error: false });
    // Las métricas del panel ISM Cap. 10 se piden a su propio endpoint (que
    // además delega en el de TMSA para las que comparte). Se distingue por el
    // prefijo de la clave, así el link no necesita un parámetro extra.
    const detailPath = metricKey.startsWith("ism")
      ? "/app/ism/chapter10/detail"
      : "/app/tmsa/maintenance/detail";
    api.get<{ items: TmsaDetailItem[] }>(
      `${detailPath}?vesselCode=${encodeURIComponent(vesselCode)}&metric=${encodeURIComponent(metricKey)}`,
    )
      .then(res => {
        if (cancelled) return;
        const items = res.items ?? [];
        setState({
          ids: new Set(items.map(i => i.id)),
          codes: new Set(items.map(i => i.code).filter(Boolean)),
          loading: false,
          error: false,
        });
      })
      .catch(() => { if (!cancelled) setState({ ids: new Set(), codes: new Set(), loading: false, error: true }); });
    return () => { cancelled = true; };
  }, [metricKey, vesselCode]);

  const clear = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("tmsaMetric");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  if (!metricKey || !vesselCode) return null;
  return {
    metricKey, vesselCode,
    ids: state.ids, codes: state.codes,
    loading: state.loading, error: state.error,
    truncated: state.ids.size >= DETAIL_CAP,
    clear,
  };
}

/**
 * Deja en la lista sólo los registros que contó la tarjeta.
 *
 * Mientras el detalle viaja devuelve la lista tal cual: filtrar con el set vacío
 * dejaría la planilla en blanco por medio segundo y parecería que no hay nada.
 * Si el pedido falló, tampoco filtra (el cartel avisa del error).
 */
export function applyTmsaFilter<T>(
  items: T[] | null,
  filter: TmsaFilterState | null,
  key: (row: T) => string | null | undefined,
): T[] | null {
  if (!items || !filter || filter.loading || filter.error) return items;
  const { ids, codes } = filter;
  if (ids.size === 0 && codes.size === 0) return [];
  return items.filter(row => {
    const k = key(row);
    return !!k && (ids.has(k) || codes.has(k));
  });
}

/** Barra que explica por qué la planilla muestra menos filas de las que tiene. */
export const TmsaFilterBanner: React.FC<{
  filter: TmsaFilterState | null;
  /** Filas visibles ahora. */
  shown: number;
  /** Filas que tendría la planilla sin el filtro. */
  total: number;
}> = ({ filter, shown, total }) => {
  const t = useT();
  if (!filter) return null;

  return (
    <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-accent/10 border border-accent/25 text-xs">
      <Filter className="w-3.5 h-3.5 text-accent shrink-0" />
      <span className="text-text-industrial/70">{t("tmsa.filter.label")}:</span>
      <span className="font-bold text-fg">{t(`tmsa.metric.${filter.metricKey}` as TranslationKey)}</span>
      {filter.loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
      ) : filter.error ? (
        <span className="text-red-700 dark:text-red-400">{t("tmsa.filter.error")}</span>
      ) : (
        <span className="text-text-industrial/60">
          · {t("tmsa.filter.count").replace("{shown}", String(shown)).replace("{total}", String(total))}
          {filter.truncated ? ` · ${t("tmsa.filter.truncated")}` : ""}
        </span>
      )}
      <button
        type="button"
        onClick={filter.clear}
        className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-[11px] font-medium text-fg/70"
      >
        <X className="w-3 h-3" />
        {t("tmsa.filter.clear")}
      </button>
    </div>
  );
};
