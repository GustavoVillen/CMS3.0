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
import { CreateWorkOrderModal } from "./CreateWorkOrderModal";
import { findClassInspectionAsset } from "../lib/class-inspection-asset";

type Category = "MAINTENANCE" | "REPAIR" | "CLASS";
type Step = "category" | "vessel" | "asset" | "planItem" | "repairKind" | "sisterVessels";
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

/** Una embarcación hermana: el mismo ítem del plan en otro buque. */
export interface SisterPlanRow {
  vesselCode: string;
  vesselName: string;
  vesselType: string | null;
  planId: string | null;
  taskCode: string | null;
  title: string | null;
  nextDueDate?: string | null;
  executionStatus?: string | null;
  matchedBy: "TASK_CODE" | "TITLE" | null;
  hasOpenWorkOrder: boolean;
}

export interface OpenBatchResult {
  batchId: string;
  created: Array<{ vesselCode: string; vesselName: string; workOrderId: string; workOrderCode: string }>;
  skipped: Array<{ vesselCode: string; vesselName: string; reason: string }>;
  failed: Array<{ vesselCode: string; vesselName: string; error: string }>;
}

/**
 * Vienen tildadas por defecto las que conviene hacer ahora: la tarea ya venció
 * o está en ventana de ejecución. Una barcaza que ya tiene la OT abierta queda
 * destildada aunque esté vencida — abrirle otra sería duplicarla.
 */
const DUE_STATUSES = new Set(["DUE", "OVERDUE", "IN_WINDOW", "UPCOMING"]);
function isPreselected(row: SisterPlanRow): boolean {
  if (!row.planId || row.hasOpenWorkOrder) return false;
  return DUE_STATUSES.has(String(row.executionStatus ?? ""));
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
  // Apertura en grupo: el ítem elegido y las embarcaciones donde existe la
  // misma tarea (ver el paso "sisterVessels").
  const [chosenPlan, setChosenPlan] = useState<PlanItemCandidate | null>(null);
  const [sisters, setSisters] = useState<SisterPlanRow[]>([]);
  const [pickedVessels, setPickedVessels] = useState<Set<string>>(new Set());

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

  const chooseCategory = (cat: Category) => {
    setCategory(cat);
    if (!vesselCode) { setStep("vessel"); return; }
    void afterVessel(cat, vesselCode);
  };

  const chooseVessel = (vc: string) => {
    setVesselCode(vc);
    if (category) void afterVessel(category, vc);
  };

  const chooseAsset = (aid: string) => {
    setAssetId(aid);
    // CLASS llega acá sólo cuando el equipo dedicado no se encontró solo y el
    // usuario lo tuvo que elegir a mano — igual corresponde mostrarle los
    // ítems del plan, como en mantenimiento planeado. Reparación pregunta
    // aparte qué tipo de correctivo es.
    if (category === "MAINTENANCE" || category === "CLASS") {
      void loadPlanItems(category, vesselCode, aid);
    } else {
      setStep("repairKind");
    }
  };

  const chooseRepairKind = (kind: RepairKind) => {
    setResult({ vesselCode, assetId, maintKind: kind, priority: REPAIR_KIND_PRIORITY[kind] });
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
   * Elegido el ítem del plan, antes de abrir la OT se mira si esa misma tarea
   * existe en otras embarcaciones. Es el caso de las barcazas: la inspección
   * semanal del convoy se hace una sola vez para todas, y abrir quince OT a
   * mano es la fricción que esto saca del medio.
   *
   * Si no hay hermanas —lo normal en un remolcador— el paso ni aparece: se abre
   * la OT como siempre. Si la consulta falla tampoco se traba: se abre la OT
   * sola, que es lo que el usuario pidió.
   */
  const choosePlanItem = useCallback(async (item: PlanItemCandidate) => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await api.get<{ items: SisterPlanRow[] }>(
        `/app/pms/maintenance-plans/${item.id}/sister-plans`,
      );
      const rows = (res.items ?? []).filter(r => r.planId);
      if (rows.length === 0) { await openSingle(item); return; }
      setChosenPlan(item);
      setSisters(rows);
      setPickedVessels(new Set(rows.filter(isPreselected).map(r => r.vesselCode)));
      setStep("sisterVessels");
    } catch (e) {
      console.error("[wo-wizard] sister-plans failed:", e);
      await openSingle(item);
    } finally {
      setCreating(false);
    }
  }, [openSingle]);

  /** Abre la tarea en el buque del plan elegido y en las tildadas. */
  const openBatch = useCallback(async () => {
    if (!chosenPlan) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await api.post<OpenBatchResult>(
        `/app/pms/maintenance-plans/${chosenPlan.id}/open-work-order-batch`,
        { vesselCodes: [...pickedVessels] },
      );
      if (onBatchSaved) await onBatchSaved(result);
      else if (result.created[0]) await onSaved(result.created[0].workOrderId, result.created[0].workOrderCode);
    } catch (e) {
      console.error("[wo-wizard] open-work-order-batch failed:", e);
      setCreateError(e instanceof ApiError ? e.message : t("wo.wizard.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [chosenPlan, pickedVessels, onBatchSaved, onSaved, t]);

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
              {step === "sisterVessels" && t("wo.batch.wizardTitle")}
            </h2>
            {step === "planItem" && (
              <p className="text-xs text-text-industrial/50 mt-0.5">{t("wo.wizard.planItemSubtitle")}</p>
            )}
            {step === "sisterVessels" && (
              <p className="text-xs text-text-industrial/50 mt-0.5">
                {t("wo.batch.wizardSubtitle").replace("{n}", String(sisters.length))}
              </p>
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

          {step === "vessel" && (
            <>
              <button onClick={() => setStep("category")} className="text-xs text-accent hover:text-fg transition-colors">
                {t("wo.wizard.back")}
              </button>
              <select
                value={vesselCode}
                onChange={e => { if (e.target.value) chooseVessel(e.target.value); }}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
              >
                <option value="">{t("wo.modal.selectVessel")}</option>
                {vessels.map(v => (
                  <option key={v.code} value={v.code}>{v.code} — {v.name}</option>
                ))}
              </select>
            </>
          )}

          {step === "asset" && (
            <>
              <button
                onClick={() => setStep(isVesselScoped ? "category" : "vessel")}
                className="text-xs text-accent hover:text-fg transition-colors"
              >
                {t("wo.wizard.back")}
              </button>
              {loadingAssets ? (
                <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-3">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
                </div>
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
              <button onClick={() => setStep(assetStepShown ? "asset" : "category")} className="text-xs text-accent hover:text-fg transition-colors">
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
                    onClick={() => setResult({ vesselCode, assetId, maintKind: category === "CLASS" ? "INSPECTION" : undefined })}
                    className="w-full text-center px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors"
                  >
                    {t("wo.wizard.none")}
                  </button>
                </>
              )}
            </>
          )}

          {/* Apertura en grupo: la misma tarea en varias embarcaciones. Cada una
              va a tener SU orden de trabajo — no se comparte una sola. */}
          {step === "sisterVessels" && (
            <>
              <button onClick={() => setStep("planItem")} className="text-xs text-accent hover:text-fg transition-colors">
                {t("wo.wizard.back")}
              </button>
              {creating ? (
                <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-3">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("wo.wizard.creating")}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-[11px] text-text-industrial/60">
                    <span>{t("wo.batch.selectedCount").replace("{n}", String(pickedVessels.size + 1))}</span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setPickedVessels(new Set(sisters.filter(s => !s.hasOpenWorkOrder).map(s => s.vesselCode)))}
                        className="text-accent hover:text-fg transition-colors"
                      >
                        {t("wo.batch.selectAll")}
                      </button>
                      <button
                        onClick={() => setPickedVessels(new Set())}
                        className="text-accent hover:text-fg transition-colors"
                      >
                        {t("wo.batch.selectNone")}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 overflow-y-auto max-h-[45vh] pr-1">
                    {/* La embarcación de la tarea elegida va siempre: es la OT
                        que el usuario pidió. Se muestra igual que las otras y
                        fija, para que el total de la lista coincida con el del
                        botón y no parezca que falta una. */}
                    <div className="flex items-start gap-3 px-4 py-2.5 rounded-xl border border-accent/40 bg-accent/10">
                      <input type="checkbox" checked readOnly disabled className="mt-0.5 w-4 h-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-fg truncate">
                          {vessels.find(v => v.code === vesselCode)?.name ?? vesselCode}
                        </p>
                        <p className="text-[10px] text-text-industrial/50 mt-0.5 truncate">
                          <span className="font-mono">{chosenPlan?.taskCode}</span> · {t("wo.batch.sourceVessel")}
                        </p>
                      </div>
                    </div>
                    {sisters.map(s => {
                      const checked = pickedVessels.has(s.vesselCode);
                      return (
                        <label
                          key={s.vesselCode}
                          className={`flex items-start gap-3 px-4 py-2.5 rounded-xl border cursor-pointer transition-all ${
                            checked ? "bg-accent/10 border-accent/40" : "bg-fg/5 border-fg/10 hover:border-accent/30"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleVessel(s.vesselCode)}
                            className="mt-0.5 w-4 h-4 accent-current shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            {/* Nombre del buque, no el código: es lo que el
                                superintendente reconoce. */}
                            <p className="text-sm font-semibold text-fg truncate">{s.vesselName}</p>
                            <p className="text-[10px] text-text-industrial/50 mt-0.5 truncate">
                              <span className="font-mono">{s.taskCode}</span>
                              {s.nextDueDate && <> · {t("wo.ai.planLink.dueDate")}: {fmtDate(s.nextDueDate)}</>}
                            </p>
                            {s.hasOpenWorkOrder && (
                              <p className="text-[10px] text-amber-500 mt-0.5">{t("wo.batch.alreadyOpen")}</p>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  {createError && <p className="text-xs text-red-500">{createError}</p>}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => { if (chosenPlan) void openSingle(chosenPlan); }}
                      className="flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold text-text-industrial bg-fg/5 border border-fg/10 hover:text-fg hover:border-accent/30 transition-colors"
                    >
                      {t("wo.batch.onlyThisVessel")}
                    </button>
                    <button
                      onClick={() => void openBatch()}
                      disabled={pickedVessels.size === 0}
                      className="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-accent hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      {t("wo.batch.openForAll").replace("{n}", String(pickedVessels.size + 1))}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
