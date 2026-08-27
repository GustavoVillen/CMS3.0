// Asistente de "Nueva OT": antes de abrir el formulario completo, pregunta
// para qué es la orden (mantenimiento planeado / reparación / inspección de
// clase), después el equipo, y si corresponde a un ítem del plan lo deja
// elegir de una lista — recién ahí abre CreateWorkOrderModal, con todo lo del
// ítem elegido ya heredado (mismo mecanismo "prefill" que usa Plan de
// Mantenimiento al abrir una OT desde un ítem — ver buildWoPrefillFromPlan).
import React, { useCallback, useState } from "react";
import { AlertTriangle, ClipboardList, Loader2, ShieldAlert, Wrench, Zap } from "lucide-react";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { useVesselContext } from "../lib/vessel-context";
import { fmtDate } from "../lib/utils";
import { ModalCloseButton } from "./ModalCloseButton";
import { AssetSearchDropdown, type AssetOption } from "./AssetSearchDropdown";
import { CreateWorkOrderModal, buildWoPrefillFromPlan, type WoPrefill } from "./CreateWorkOrderModal";

type Category = "MAINTENANCE" | "REPAIR" | "CLASS";
type Step = "category" | "vessel" | "asset" | "planItem" | "repairKind";
/** Mismos valores que WO_MAINTENANCE_KINDS (wo-form-catalog.ts) para el eje
 *  "reparación" del formulario. */
type RepairKind = "CORRECTIVO_PROGRAMADO" | "CORRECTIVO_NO_PROGRAMADO" | "EMERGENCIA";
type Result =
  | { kind: "prefill"; prefill: WoPrefill }
  | { kind: "blank"; vesselCode: string; assetId: string; maintKind?: string; priority?: string };

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

const CLASS_ASSET_NAME = "Inspeccion de Clase";

// Mismo texto oficial del formulario (WO_MAINTENANCE_KINDS, wo-form-catalog.ts) — no se traduce.
const REPAIR_KIND_OPTIONS: { value: RepairKind; label: string; icon: typeof Wrench }[] = [
  { value: "CORRECTIVO_PROGRAMADO",    label: "Correctivo programado",    icon: Wrench },
  { value: "CORRECTIVO_NO_PROGRAMADO", label: "Correctivo no programado", icon: AlertTriangle },
  { value: "EMERGENCIA",               label: "Emergencia",               icon: Zap },
];

const optionBtnCls = "flex items-center gap-3 px-5 py-4 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-left w-full";

interface NewWorkOrderWizardProps {
  onClose: () => void;
  onSaved: (woId: string) => void | Promise<void>;
}

export const NewWorkOrderWizard: React.FC<NewWorkOrderWizardProps> = ({ onClose, onSaved }) => {
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
  // Con Inspección de Clase el paso de equipo se puede saltear (equipo
  // resuelto solo) o no (equipo dedicado no encontrado, se elige a mano) —
  // hace falta saber cuál pasó para que "Atrás" desde el ítem del plan vuelva
  // al lugar correcto.
  const [assetStepShown, setAssetStepShown] = useState(false);

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

  const loadPlanItems = useCallback(async (vc: string, aid: string) => {
    setLoadingPlans(true);
    try {
      const res = await api.get<{ items: PlanItemCandidate[] }>(
        `/app/pms/maintenance-plans?assetId=${encodeURIComponent(aid)}&status=ACTIVE&limit=100`,
      );
      const items = res.items ?? [];
      if (items.length === 0) {
        // Sin ítems activos en este equipo: no tiene sentido preguntar, se abre en blanco.
        setResult({ kind: "blank", vesselCode: vc, assetId: aid });
        return;
      }
      setPlanItems(items);
      setStep("planItem");
    } catch {
      setResult({ kind: "blank", vesselCode: vc, assetId: aid });
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
      const needle = CLASS_ASSET_NAME.trim().toLowerCase();
      const match = items.find(a => (a.name ?? "").trim().toLowerCase() === needle);
      if (match) {
        setAssetId(match.id);
        void loadPlanItems(vc, match.id);
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
      void loadPlanItems(vesselCode, aid);
    } else {
      setStep("repairKind");
    }
  };

  const chooseRepairKind = (kind: RepairKind) => {
    setResult({ kind: "blank", vesselCode, assetId, maintKind: kind, priority: REPAIR_KIND_PRIORITY[kind] });
  };

  const choosePlanItem = useCallback(async (item: PlanItemCandidate) => {
    setLoadingPlans(true);
    try {
      const full = await api.get<Parameters<typeof buildWoPrefillFromPlan>[0]>(`/app/pms/maintenance-plans/${item.id}`);
      setResult({ kind: "prefill", prefill: buildWoPrefillFromPlan(full, t("mp.modal.maintenancePlanLabel")) });
    } catch {
      setResult({ kind: "blank", vesselCode, assetId });
    } finally {
      setLoadingPlans(false);
    }
  }, [vesselCode, assetId, t]);

  if (result) {
    return result.kind === "prefill" ? (
      <CreateWorkOrderModal prefill={result.prefill} onClose={onClose} onSaved={onSaved} />
    ) : (
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
              {loadingPlans ? (
                <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-3">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
                </div>
              ) : (
                <>
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
                    onClick={() => setResult({ kind: "blank", vesselCode, assetId })}
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
