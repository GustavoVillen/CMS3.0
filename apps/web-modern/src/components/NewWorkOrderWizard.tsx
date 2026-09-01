// Asistente de "Nueva OT": antes de abrir el formulario completo, pregunta
// para qué es la orden (mantenimiento planeado / reparación / inspección de
// clase), después el equipo, y si corresponde a un ítem del plan lo deja
// elegir de una lista — recién ahí abre CreateWorkOrderModal, con todo lo del
// ítem elegido ya heredado (mismo mecanismo "prefill" que usa Plan de
// Mantenimiento al abrir una OT desde un ítem — ver buildWoPrefillFromPlan).
import React, { useCallback, useState } from "react";
import { AlertTriangle, ClipboardList, Loader2, ShieldAlert, Wrench, Zap } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { useVesselContext } from "../lib/vessel-context";
import { fmtDate } from "../lib/utils";
import { ModalCloseButton } from "./ModalCloseButton";
import { AssetSearchDropdown, type AssetOption } from "./AssetSearchDropdown";
import { VesselPickerGrid } from "./VesselPickerGrid";
import { CreateWorkOrderModal } from "./CreateWorkOrderModal";
import { findClassInspectionAsset } from "../lib/class-inspection-asset";

type Category = "MAINTENANCE" | "REPAIR" | "CLASS";
type Step = "category" | "vessel" | "asset" | "planItem" | "repairKind";
/** Mismos valores que WO_MAINTENANCE_KINDS (wo-form-catalog.ts) para el eje
 *  "reparación" del formulario. */
type RepairKind = "CORRECTIVO_PROGRAMADO" | "CORRECTIVO_NO_PROGRAMADO" | "EMERGENCIA";
/** Sólo el camino "sin ítem de plan" pasa por el formulario completo — eligiendo
 *  un ítem del plan la OT se crea directo (ver `choosePlanItem`) y se abre ya
 *  hecha en el editor real, sin una pantalla intermedia de revisión. */
type Result = { vesselCode: string; assetId: string; maintKind?: string; priority?: string };

/** Urgencia implícita de cada tipo de reparación — misma escala que
 *  WO_PRIORITY_FORM_LABELS (wo-form-catalog.ts). */
const REPAIR_KIND_PRIORITY: Record<RepairKind, string> = {
  CORRECTIVO_PROGRAMADO: "MEDIUM",
  CORRECTIVO_NO_PROGRAMADO: "HIGH",
  EMERGENCIA: "CRITICAL",
};

interface PlanItemCandidate {
  id: string;
  taskCode: string;
  title: string;
  nextDueDate?: string | null;
  nextDueHours?: number | null;
}

export interface OpenBatchResult {
  batchId: string;
  created: Array<{ vesselCode: string; vesselName: string; workOrderId: string; workOrderCode: string }>;
  skipped: Array<{ vesselCode: string; vesselName: string; reason: string }>;
  failed: Array<{ vesselCode: string; vesselName: string; error: string }>;
}

// Mismo texto oficial del formulario (WO_MAINTENANCE_KINDS, wo-form-catalog.ts) — no se traduce.
const REPAIR_KIND_OPTIONS: { value: RepairKind; label: string; icon: typeof Wrench }[] = [
  { value: "CORRECTIVO_PROGRAMADO",    label: "Correctivo programado",    icon: Wrench },
  { value: "CORRECTIVO_NO_PROGRAMADO", label: "Correctivo no programado", icon: AlertTriangle },
  { value: "EMERGENCIA",               label: "Emergencia",               icon: Zap },
];

const optionBtnCls = "flex items-center gap-3 px-5 py-4 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-left w-full";

interface NewWorkOrderWizardProps {
  onClose: () => void;
  onSaved: (woId: string, workOrderCode?: string) => void | Promise<void>;
  /**
   * Se abrieron varias OT de una vez (la misma tarea en un grupo de barcazas).
   * Va aparte de `onSaved` porque no hay UNA orden que abrir a continuación:
   * lo que corresponde es refrescar el tablero y decir cuántas se abrieron.
   */
  onBatchSaved?: (result: OpenBatchResult) => void | Promise<void>;
}

export const NewWorkOrderWizard: React.FC<NewWorkOrderWizardProps> = ({ onClose, onSaved, onBatchSaved }) => {
  const t = useT();
  const { vessels, selectedVesselCode, isVesselScoped } = useVesselContext();

  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<Category | null>(null);
  const [vesselCode, setVesselCode] = useState(selectedVesselCode ?? "");
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [planItems, setPlanItems] = useState<PlanItemCandidate[] | null>(null);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Con Inspección de Clase el paso de equipo se puede saltear (equipo
  // resuelto solo) o no (equipo dedicado no encontrado, se elige a mano) —
  // hace falta saber cuál pasó para que "Atrás" desde el ítem del plan vuelva
  // al lugar correcto.
  const [assetStepShown, setAssetStepShown] = useState(false);
  /**
   * Embarcaciones tildadas en el paso del buque. La PRIMERA es la principal
   * (`vesselCode`): de ella salen el equipo y el ítem del plan, y en las demás
   * se abre la tarea equivalente. Es el caso de un convoy de barcazas, donde la
   * recorrida se hace de una sola pasada sobre todas.
   */
  const [pickedVessels, setPickedVessels] = useState<Set<string>>(
    () => new Set(selectedVesselCode ? [selectedVesselCode] : []),
  );

  // El Set conserva el orden en que se fue tildando, así que la PRINCIPAL es la
  // primera que el usuario eligió — no la primera de la lista. Es lo que espera:
  // el equipo y la tarea salen de la embarcación con la que empezó.
  const pickedList = React.useMemo(() => [...pickedVessels], [pickedVessels]);
  const primaryVessel = pickedList[0] ?? "";
  const extraVessels = React.useMemo(() => pickedList.slice(1), [pickedList]);

  /**
   * Qué NO se puede tildar, y por qué. Dos motivos distintos:
   *
   * 1. SIN EQUIPOS CARGADOS. Una OT cuelga de un equipo, así que una embarcación
   *    sin equipos no puede recibir ninguna. Antes se descubría tarde: se la
   *    elegía, se pasaba al paso siguiente y la lista de equipos aparecía vacía
   *    con un "Sin resultados" que no explicaba nada.
   *
   * 2. NO SE PUEDE ABRIR EN GRUPO con lo ya tildado. El grupo es para
   *    embarcaciones sin dotación: las barcazas van amarradas en convoy y la
   *    recorrida se hace de una pasada sobre todas. Un remolcador se mantiene
   *    por su cuenta —tiene su tripulación y sus propias horas de motor—, así
   *    que va solo: tildarlo junto a otros daría por ejecutado un trabajo que en
   *    los demás no se hizo.
   *
   * Las que no se pueden tildar quedan a la vista pero apagadas: esconderlas
   * dejaría al usuario buscando un buque que estaba ahí hace un segundo.
   */
  const disabledVessels = React.useMemo(() => {
    const out = new Map<string, { title: string; note?: string }>();
    const primary = primaryVessel ? vessels.find(v => v.code === primaryVessel) : null;
    const groupable = primary?.uncrewed === true;
    for (const v of vessels) {
      if (pickedVessels.has(v.code)) continue;
      // El conteo puede no venir (backend viejo): sólo se bloquea si dice 0.
      if (v.assetCount === 0) {
        out.set(v.code, { title: t("wo.batch.noAssets").replace("{vessel}", v.name), note: t("wo.batch.noAssetsShort") });
        continue;
      }
      if (primary && (!groupable || v.uncrewed !== true)) {
        out.set(v.code, { title: t("wo.batch.onlyBarges") });
      }
    }
    return out;
  }, [vessels, pickedVessels, primaryVessel, t]);

  const loadAssets = useCallback(async (vc: string): Promise<AssetOption[]> => {
    setLoadingAssets(true);
    try {
      const res = await api.get<{ items: AssetOption[] }>(`/app/pms/assets?vesselCode=${encodeURIComponent(vc)}&limit=200`);
      const items = res.items ?? [];
      setAssets(items);
      return items;
    } catch {
      setAssets([]);
      return [];
    } finally {
      setLoadingAssets(false);
    }
  }, []);

  const loadPlanItems = useCallback(async (cat: Category, vc: string, aid: string) => {
    setLoadingPlans(true);
    // Sin ítems activos (o si falla la búsqueda) no tiene sentido preguntar,
    // se abre en blanco — pero si es Inspección de Clase, igual va con ese
    // tipo preseleccionado (no "Preventivo" por default).
    const blank = () => setResult({ vesselCode: vc, assetId: aid, maintKind: cat === "CLASS" ? "INSPECTION" : undefined });
    try {
      const res = await api.get<{ items: PlanItemCandidate[] }>(
        `/app/pms/maintenance-plans?assetId=${encodeURIComponent(aid)}&status=ACTIVE&limit=100`,
      );
      const items = res.items ?? [];
      if (items.length === 0) { blank(); return; }
      setPlanItems(items);
      setStep("planItem");
    } catch {
      blank();
    } finally {
      setLoadingPlans(false);
    }
  }, []);

  // Buque ya resuelto (elegido a mano, o ya venía del contexto): decide el
  // siguiente paso según la categoría.
  const afterVessel = useCallback(async (cat: Category, vc: string) => {
    // No arrastrar el equipo/ítem de una elección anterior (cambio de
    // categoría o de buque) — arranca limpio cada vez que se entra acá.
    setAssetId("");
    setPlanItems(null);
    setAssetStepShown(false);
    const items = await loadAssets(vc);
    if (cat === "CLASS") {
      const match = findClassInspectionAsset(items);
      if (match) {
        setAssetId(match.id);
        void loadPlanItems(cat, vc, match.id);
        return;
      }
      // Este buque no tiene el equipo dedicado todavía: se elige a mano, como
      // mantenimiento planeado normal.
    }
    setAssetStepShown(true);
    setStep("asset");
  }, [loadAssets, loadPlanItems]);

  // El paso de embarcaciones se muestra SIEMPRE, aunque el selector global ya
  // tenga un buque elegido: es donde se arma el convoy, y saltearlo dejaría la
  // apertura en grupo escondida detrás de un buque preseleccionado.
  const chooseCategory = (cat: Category) => {
    setCategory(cat);
    setStep("vessel");
  };

  const confirmVessels = () => {
    if (!primaryVessel || !category) return;
    void afterVessel(category, primaryVessel);
  };

  const chooseAsset = (aid: string) => {
    setAssetId(aid);
    // CLASS llega acá sólo cuando el equipo dedicado no se encontró solo y el
    // usuario lo tuvo que elegir a mano — igual corresponde mostrarle los
    // ítems del plan, como en mantenimiento planeado. Reparación pregunta
    // aparte qué tipo de correctivo es.
    if (category === "MAINTENANCE" || category === "CLASS") {
      void loadPlanItems(category, primaryVessel, aid);
    } else {
      setStep("repairKind");
    }
  };

  const chooseRepairKind = (kind: RepairKind) => {
    setResult({ vesselCode: primaryVessel, assetId, maintKind: kind, priority: REPAIR_KIND_PRIORITY[kind] });
  };

  // La OT se crea directo (sin pantalla intermedia de revisión) y se entrega a
  // onSaved, que la abre ya hecha en el editor real — ahí sí se puede tocar
  // todo (título, asignado a, checklist, etc.).
  const openSingle = useCallback(async (item: PlanItemCandidate) => {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.post<{ id: string; workOrderCode: string }>(
        `/app/pms/maintenance-plans/${item.id}/open-work-order`, {},
      );
      await onSaved(created.id, created.workOrderCode);
    } catch (e) {
      console.error("[wo-wizard] open-work-order failed:", e);
      setCreateError(e instanceof ApiError ? e.message : t("wo.wizard.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [onSaved, t]);

  /**
   * Abre la misma tarea en todas las embarcaciones tildadas: una OT por cada
   * una, hermanadas por el lote. El backend resuelve, buque por buque, cuál es
   * el plan equivalente al elegido (mismo ítem del PDM clonado) y devuelve el
   * detalle de qué se abrió y qué quedó afuera.
   */
  const openBatch = useCallback(async (item: PlanItemCandidate, others: string[]) => {
    setCreating(true);
    setCreateError(null);
    try {
      const result = await api.post<OpenBatchResult>(
        `/app/pms/maintenance-plans/${item.id}/open-work-order-batch`,
        { vesselCodes: others },
      );
      if (onBatchSaved) await onBatchSaved(result);
      else if (result.created[0]) await onSaved(result.created[0].workOrderId, result.created[0].workOrderCode);
    } catch (e) {
      console.error("[wo-wizard] open-work-order-batch failed:", e);
      setCreateError(e instanceof ApiError ? e.message : t("wo.wizard.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [onBatchSaved, onSaved, t]);

  /**
   * Elegido el ítem del plan se abre la OT. Con una sola embarcación tildada es
   * el camino de siempre; con varias (un convoy de barcazas) se abre el grupo.
   */
  const choosePlanItem = useCallback((item: PlanItemCandidate) => {
    if (extraVessels.length > 0) void openBatch(item, extraVessels);
    else void openSingle(item);
  }, [extraVessels, openBatch, openSingle]);

  const toggleVessel = (code: string) => {
    setPickedVessels(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  if (result) {
    return (
      <CreateWorkOrderModal
        initialVesselCode={result.vesselCode}
        initialAssetId={result.assetId}
        initialMaintKind={result.maintKind}
        initialPriority={result.priority}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-fg">
              {step === "category" && t("wo.wizard.categoryTitle")}
              {step === "vessel"   && t("wo.wizard.vesselTitle")}
              {step === "asset"    && t("wo.wizard.assetTitle")}
              {step === "planItem" && t("wo.wizard.planItemTitle")}
              {step === "repairKind" && t("wo.wizard.repairKindTitle")}
            </h2>
            {step === "planItem" && (
              <p className="text-xs text-text-industrial/50 mt-0.5">{t("wo.wizard.planItemSubtitle")}</p>
            )}
            {step === "vessel" && (
              <p className="text-xs text-text-industrial/50 mt-0.5">{t("wo.batch.vesselStepSubtitle")}</p>
            )}
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        {/* Sin overflow acá: un ancestro con scroll recorta los menúes
            desplegables absolutos (ej. el buscador de equipo). El scroll
            propio va sólo en la lista de ítems del plan, que puede ser larga. */}
        <div className="flex-1 space-y-3">
          {step === "category" && (
            <>
              <button onClick={() => chooseCategory("MAINTENANCE")} className={optionBtnCls}>
                <ClipboardList className="w-6 h-6 text-accent shrink-0" />
                <span className="font-bold text-sm text-fg">{t("dashboard.ssChooser.maintenance")}</span>
              </button>
              <button onClick={() => chooseCategory("REPAIR")} className={optionBtnCls}>
                <Wrench className="w-6 h-6 text-accent shrink-0" />
                <span className="font-bold text-sm text-fg">{t("dashboard.ssChooser.repair")}</span>
              </button>
              <button onClick={() => chooseCategory("CLASS")} className={optionBtnCls}>
                <ShieldAlert className="w-6 h-6 text-accent shrink-0" />
                <span className="font-bold text-sm text-fg">{t("dashboard.ssChooser.classInspection")}</span>
              </button>
            </>
          )}

          {/* Toda la flota a la vista, con tildes. Con 30+ barcazas un
              desplegable obliga a recorrerlo entero; acá se arma el convoy de
              un vistazo. Se abre UNA OT POR EMBARCACIÓN: cada una conserva su
              historial y su evidencia; lo que se ahorra es repetir el trámite. */}
          {step === "vessel" && (
            <>
              <button onClick={() => setStep("category")} className="text-xs text-accent hover:text-fg transition-colors">
                {t("wo.wizard.back")}
              </button>
              <div className="overflow-y-auto max-h-[50vh] pr-1">
                <VesselPickerGrid
                  title={t("wo.batch.allVessels")}
                  selected={pickedVessels}
                  onToggle={toggleVessel}
                  disabled={disabledVessels}
                  primaryCode={extraVessels.length > 0 ? primaryVessel : null}
                  primaryLabel={t("wo.batch.primaryVessel")}
                  emptyMessage={t("wo.modal.selectVessel")}
                />
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-text-industrial/60">
                  {extraVessels.length > 0
                    ? t("wo.batch.willOpenN").replace("{n}", String(pickedList.length))
                    : t("wo.batch.willOpenOne")}
                </span>
                <button
                  onClick={confirmVessels}
                  disabled={!primaryVessel}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-accent hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {t("common.continue")}
                </button>
              </div>
            </>
          )}

          {step === "asset" && (
            <>
              <button
                onClick={() => setStep("vessel")}
                className="text-xs text-accent hover:text-fg transition-colors"
              >
                {t("wo.wizard.back")}
              </button>
              {loadingAssets ? (
                <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-3">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
                </div>
              ) : assets.length === 0 ? (
                // Red de seguridad: el paso anterior ya bloquea las embarcaciones
                // sin equipos, pero si el conteo no llegó (backend viejo, o los
                // equipos se borraron mientras tanto) el usuario tiene que leer
                // QUÉ pasa y con QUÉ buque, no un "Sin resultados" mudo.
                <p className="text-xs text-text-industrial/60 bg-fg/5 border border-fg/10 rounded-xl px-3 py-3 leading-relaxed">
                  {t("wo.batch.noAssets").replace(
                    "{vessel}",
                    vessels.find(v => v.code === primaryVessel)?.name ?? primaryVessel,
                  )}
                </p>
              ) : (
                <AssetSearchDropdown
                  assets={assets}
                  value={assetId}
                  onChange={id => { if (id) chooseAsset(id); }}
                  placeholder={t("mp.selectAsset")}
                />
              )}
            </>
          )}

          {step === "repairKind" && (
            <>
              <button onClick={() => setStep("asset")} className="text-xs text-accent hover:text-fg transition-colors">
                {t("wo.wizard.back")}
              </button>
              {REPAIR_KIND_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => chooseRepairKind(opt.value)} className={optionBtnCls}>
                  <opt.icon className="w-6 h-6 text-accent shrink-0" />
                  <span className="font-bold text-sm text-fg">{opt.label}</span>
                </button>
              ))}
            </>
          )}

          {step === "planItem" && (
            <>
              <button onClick={() => setStep(assetStepShown ? "asset" : "vessel")} className="text-xs text-accent hover:text-fg transition-colors">
                {t("wo.wizard.back")}
              </button>
              {loadingPlans || creating ? (
                <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-3">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {creating ? t("wo.wizard.creating") : t("common.loading")}
                </div>
              ) : (
                <>
                  {createError && (
                    <p className="text-xs text-red-500">{createError}</p>
                  )}
                  <div className="space-y-3 overflow-y-auto max-h-[50vh] pr-1">
                    {(planItems ?? []).map(item => (
                      <button key={item.id} onClick={() => void choosePlanItem(item)} className={optionBtnCls}>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-fg">
                            <span className="font-mono font-bold">{item.taskCode}</span>
                            <span className="font-semibold"> · {item.title}</span>
                          </p>
                          {(item.nextDueDate || item.nextDueHours != null) && (
                            <p className="text-[10px] text-text-industrial/50 mt-0.5">
                              {t("wo.ai.planLink.dueDate")}: {item.nextDueDate ? fmtDate(item.nextDueDate) : `${item.nextDueHours} h`}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setResult({ vesselCode: primaryVessel, assetId, maintKind: category === "CLASS" ? "INSPECTION" : undefined })}
                    className="w-full text-center px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors"
                  >
                    {t("wo.wizard.none")}
                  </button>
                </>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
};
