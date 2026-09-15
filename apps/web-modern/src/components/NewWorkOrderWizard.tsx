// Asistente de "Nueva OT": antes de abrir el formulario completo, pregunta
// para qué es la orden (mantenimiento planeado / reparación / inspección de
// clase), después el equipo, y si corresponde a un ítem del plan lo deja
// elegir de una lista — recién ahí abre CreateWorkOrderModal, con todo lo del
// ítem elegido ya heredado (mismo mecanismo "prefill" que usa Plan de
// Mantenimiento al abrir una OT desde un ítem — ver buildWoPrefillFromPlan).
import React, { useCallback, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ChevronRight, ClipboardList, Cog, Container, FilePlus, Loader2, Search, ShieldAlert, Ship, Sparkles, Wrench, Zap } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT, type TranslationKey } from "../lib/i18n";
import { useVesselContext } from "../lib/vessel-context";
import { fmtDate } from "../lib/utils";
import { ModalCloseButton } from "./ModalCloseButton";
import { AlertDialog } from "./AlertDialog";
import { type AssetOption } from "./AssetSearchDropdown";
import { CreateWorkOrderModal } from "./CreateWorkOrderModal";
import { findClassInspectionAsset } from "../lib/class-inspection-asset";
import { markJustCreated } from "../lib/just-created";
import { CopilotFlowProvider, useCopilotAssist, type CopilotAssistSpec } from "../lib/copilot-context";

/** Valor de la opción "ninguno" del paso del ítem del plan (no es un id real). */
const NO_PLAN_ITEM = "__none__";

type Category = "MAINTENANCE" | "REPAIR" | "CLASS";
type Step = "category" | "vessel" | "asset" | "planItem" | "repairKind";
/** Mismos valores que WO_MAINTENANCE_KINDS (wo-form-catalog.ts) para el eje
 *  "reparación" del formulario. */
type RepairKind = "CORRECTIVO_PROGRAMADO" | "CORRECTIVO_NO_PROGRAMADO" | "EMERGENCIA";
/** Sólo el camino "sin ítem de plan" pasa por el formulario completo — eligiendo
 *  un ítem del plan la OT se crea con el botón del pie (ver `choosePlanItem`) y
 *  se abre ya hecha en el editor real. */
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

const CATEGORY_OPTIONS: { value: Category; label: TranslationKey; icon: typeof Wrench }[] = [
  { value: "MAINTENANCE", label: "dashboard.ssChooser.maintenance",     icon: ClipboardList },
  { value: "REPAIR",      label: "dashboard.ssChooser.repair",          icon: Wrench },
  { value: "CLASS",       label: "dashboard.ssChooser.classInspection", icon: ShieldAlert },
];

// Mismo texto oficial del formulario (WO_MAINTENANCE_KINDS, wo-form-catalog.ts) — no se traduce.
const REPAIR_KIND_OPTIONS: { value: RepairKind; label: string; icon: typeof Wrench; tone: "accent" | "warning" | "danger" }[] = [
  { value: "CORRECTIVO_PROGRAMADO",    label: "Correctivo programado",    icon: Wrench,        tone: "accent" },
  { value: "CORRECTIVO_NO_PROGRAMADO", label: "Correctivo no programado", icon: AlertTriangle, tone: "warning" },
  { value: "EMERGENCIA",               label: "Emergencia",               icon: Zap,           tone: "danger" },
];

const TONE_ICON_CLS = {
  accent:  "bg-accent/10 text-accent",
  warning: "bg-warning/10 text-warning",
  danger:  "bg-danger/10 text-danger",
  muted:   "bg-fg/5 text-text-industrial/60",
} as const;

const DAY_MS = 86_400_000;

/** Botón-tarjeta de una opción: ícono, título, una línea que la explica.
 *  Compartido con el asistente de "Nueva SS" (NewServiceRequestWizard). */
export function OptionCard({ icon: Icon, title, desc, tone = "accent", badge, highlight, onClick, className = "" }: {
  icon: typeof Wrench; title: string; desc?: string; tone?: keyof typeof TONE_ICON_CLS;
  badge?: React.ReactNode; highlight?: boolean; onClick: () => void; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-3.5 w-full text-left px-4 py-3.5 rounded-2xl border-[1.5px] hover:border-accent/50 hover:bg-accent/5 transition-all ${
        highlight ? "bg-accent/5 border-accent/45" : "bg-fg/5 border-fg/10"
      } ${className}`}
    >
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${TONE_ICON_CLS[tone]}`}>
        <Icon className="w-[22px] h-[22px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 font-bold text-sm text-fg">{title}{badge}</span>
        {desc && <span className="block text-xs text-text-industrial/60 mt-0.5">{desc}</span>}
      </span>
      <ChevronRight className="w-4 h-4 text-text-industrial/40 shrink-0" />
    </button>
  );
}

/** Barra de pasos del encabezado de los asistentes (hecho ✓ / actual / pendiente). */
export function WizardStepper({ labels, current }: { labels: string[]; current: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
      {labels.map((label, i) => {
        const done = i < current, cur = i === current;
        return (
          <React.Fragment key={label}>
            {i > 0 && <span className="w-4 h-px bg-fg/15" />}
            <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${done ? "text-success-sea" : cur ? "text-accent" : "text-text-industrial/40"}`}>
              <span className={`w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center text-[10px] font-bold ${
                done ? "bg-success-sea border-success-sea text-white" : cur ? "border-accent bg-accent/10" : "border-fg/25"
              }`}>
                {done ? "✓" : i + 1}
              </span>
              {label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

interface NewWorkOrderWizardProps {
  onClose: () => void;
  onSaved: (woId: string, workOrderCode?: string) => void | Promise<void>;
}

/** Todos los pasos (y el formulario completo del final) son UN flujo para el copiloto. */
export const NewWorkOrderWizard: React.FC<NewWorkOrderWizardProps> = (props) => (
  <CopilotFlowProvider name="new-wo">
    <NewWorkOrderWizardSteps {...props} />
  </CopilotFlowProvider>
);

const NewWorkOrderWizardSteps: React.FC<NewWorkOrderWizardProps> = ({ onClose, onSaved }) => {
  const t = useT();
  const { vessels, selectedVesselCode, isVesselScoped } = useVesselContext();

  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<Category | null>(null);
  const [vesselCode, setVesselCode] = useState(selectedVesselCode ?? "");
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [assetQuery, setAssetQuery] = useState("");
  const [planItems, setPlanItems] = useState<PlanItemCandidate[] | null>(null);
  const [loadingPlans, setLoadingPlans] = useState(false);
  // Ítem del plan marcado: la OT se crea recién con el botón del pie, no al
  // tocarlo (un toque de más creaba una OT real).
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Con Inspección de Clase el paso de equipo se puede saltear (equipo
  // resuelto solo) o no (equipo dedicado no encontrado, se elige a mano) —
  // hace falta saber cuál pasó para que "Atrás" desde el ítem del plan vuelva
  // al lugar correcto.
  const [assetStepShown, setAssetStepShown] = useState(false);

  const vesselName = vessels.find(v => v.code === vesselCode)?.name ?? vesselCode;
  const asset = assets.find(a => a.id === assetId) ?? null;
  const assetName = asset ? (asset.name ?? asset.assetCode) : "";

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
    setSelectedPlanId(null);
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
    setAssetQuery("");
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

  const openBlankForm = () => {
    setResult({ vesselCode, assetId, maintKind: category === "CLASS" ? "INSPECTION" : undefined });
  };

  // Con el ítem del plan confirmado, la OT se crea directo y se entrega a
  // onSaved, que la abre ya hecha en el editor real — ahí sí se puede tocar
  // todo (título, asignado a, checklist, etc.).
  const choosePlanItem = useCallback(async (item: PlanItemCandidate) => {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.post<{ id: string; workOrderCode: string }>(
        `/app/pms/maintenance-plans/${item.id}/open-work-order`, {},
      );
      markJustCreated("wo", created.workOrderCode);
      await onSaved(created.id, created.workOrderCode);
    } catch (e) {
      console.error("[wo-wizard] open-work-order failed:", e);
      setCreateError(e instanceof ApiError ? e.message : t("wo.wizard.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [onSaved, t]);

  const goBack = () => {
    if (step === "vessel") setStep("category");
    else if (step === "asset") setStep(isVesselScoped ? "category" : "vessel");
    else if (step === "planItem") setStep(assetStepShown ? "asset" : "category");
    else if (step === "repairKind") setStep("asset");
  };

  // Vencidas primero; las que vencen por horas (sin fecha) al final.
  const sortedPlanItems = useMemo(() => [...(planItems ?? [])].sort((a, b) => {
    if (!a.nextDueDate && !b.nextDueDate) return 0;
    if (!a.nextDueDate) return 1;
    if (!b.nextDueDate) return -1;
    return a.nextDueDate.localeCompare(b.nextDueDate);
  }), [planItems]);

  const filteredAssets = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter(a => `${a.name ?? ""} ${a.assetCode}`.toLowerCase().includes(q));
  }, [assets, assetQuery]);

  const dueBadge = (item: PlanItemCandidate): { text: string; cls: string } | null => {
    if (item.nextDueDate) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const due = new Date(item.nextDueDate.slice(0, 10) + "T00:00:00");
      const days = Math.round((due.getTime() - today.getTime()) / DAY_MS);
      if (days < 0)   return { text: t("wo.wizard.due.overdue").replace("{n}", String(-days)), cls: "bg-danger/10 text-danger" };
      if (days === 0) return { text: t("wo.wizard.due.today"), cls: "bg-warning/10 text-warning" };
      if (days <= 30) return { text: t("wo.wizard.due.inDays").replace("{n}", String(days)), cls: "bg-warning/10 text-warning" };
      return { text: t("wo.wizard.due.onDate").replace("{date}", fmtDate(item.nextDueDate)), cls: "bg-fg/5 text-text-industrial/60" };
    }
    if (item.nextDueHours != null) {
      return { text: t("wo.wizard.due.hours").replace("{n}", String(item.nextDueHours)), cls: "bg-fg/5 text-text-industrial/60" };
    }
    return null;
  };

  // ── Copiloto: cada paso es una elección; cargarla hace lo mismo que el clic ──
  const assistBase = { module: "WORK_ORDERS", title: t("dashboard.newWorkOrder"), vesselCode: vesselCode || undefined };
  let assist: CopilotAssistSpec | null = null;
  if (!result && step === "category") {
    assist = { ...assistBase, screen: "WO_WIZARD_CATEGORY", fields: [{
      key: "category", label: t("wo.wizard.categoryTitle"), value: category,
      options: CATEGORY_OPTIONS.map(o => ({ value: o.value, label: t(o.label) })),
      set: v => chooseCategory(v as Category),
    }] };
  } else if (!result && step === "vessel") {
    assist = { ...assistBase, screen: "WO_WIZARD_VESSEL", fields: [{
      key: "vesselCode", label: t("wo.wizard.vesselTitle"), value: null,
      options: vessels.map(v => ({ value: v.code, label: v.name ?? v.code })),
      set: chooseVessel,
    }] };
  } else if (!result && step === "asset" && !loadingAssets) {
    assist = { ...assistBase, screen: "WO_WIZARD_ASSET", fields: [{
      key: "assetId", label: t("wo.wizard.assetTitle"), value: null,
      options: assets.map(a => ({ value: a.id, label: a.name ?? a.assetCode, aliases: [a.assetCode] })),
      set: chooseAsset,
    }] };
  } else if (!result && step === "repairKind") {
    assist = { ...assistBase, screen: "WO_WIZARD_REPAIR_KIND", fields: [{
      key: "repairKind", label: t("wo.wizard.repairKindTitle"), value: null,
      options: REPAIR_KIND_OPTIONS.map(o => ({ value: o.value, label: o.label })),
      set: v => chooseRepairKind(v as RepairKind),
    }] };
  } else if (!result && step === "planItem" && !loadingPlans && !creating) {
    assist = { ...assistBase, screen: "WO_WIZARD_PLAN_ITEM", fields: [{
      key: "planItem", label: t("wo.wizard.planItemTitle"), value: null,
      hint: "Choosing a plan item CREATES the work order immediately (it inherits title, criteria, LOTO and risk from the plan). The last option opens the blank form instead.",
      options: [
        ...(planItems ?? []).map(p => ({ value: p.id, label: `${p.taskCode} · ${p.title}` })),
        { value: NO_PLAN_ITEM, label: t("wo.wizard.none") },
      ],
      set: v => {
        if (v === NO_PLAN_ITEM) { openBlankForm(); return; }
        const item = (planItems ?? []).find(p => p.id === v);
        if (item) void choosePlanItem(item);
      },
    }] };
  }
  useCopilotAssist(assist);

  if (result) {
    return (
      <CreateWorkOrderModal
        initialVesselCode={result.vesselCode}
        initialAssetId={result.assetId}
        initialMaintKind={result.maintKind}
        initialPriority={result.priority}
        onChangeContext={() => { setResult(null); setStep(assetStepShown ? "asset" : "category"); }}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }

  // ── Barra de pasos ──
  const stepKeys: TranslationKey[] = [
    "wo.wizard.step.category", "wo.wizard.step.vessel", "wo.wizard.step.asset",
    category === "REPAIR" ? "wo.wizard.step.repairKind" : "wo.wizard.step.planItem",
    "wo.wizard.step.form",
  ];
  const currentIndex = { category: 0, vessel: 1, asset: 2, planItem: 3, repairKind: 3 }[step];

  const chipCls = "inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/5 px-2.5 py-1 text-[11px] text-fg";
  const changeBtn = (to: Step) => (
    <button type="button" onClick={() => setStep(to)} className="text-[11px] font-semibold text-accent hover:text-fg transition-colors">
      {t("wo.wizard.change")}
    </button>
  );
  const chips = step !== "category" && (
    <div className="flex flex-wrap gap-1.5 mb-3.5">
      {category && <span className={chipCls}>{t(`wo.wizard.cat.${category}` as TranslationKey)} {changeBtn("category")}</span>}
      {vesselCode && step !== "vessel" && (
        <span className={chipCls}><Ship className="w-3 h-3" /><b className="font-bold">{vesselName}</b>{!isVesselScoped && changeBtn("vessel")}</span>
      )}
      {assetId && (step === "planItem" || step === "repairKind") && (
        <span className={chipCls}><Cog className="w-3 h-3" /><b className="font-bold">{assetName}</b>{assetStepShown && changeBtn("asset")}</span>
      )}
    </div>
  );

  const question = (title: string, subtitle?: string) => (
    <>
      <p className="text-[17px] font-extrabold text-fg mt-1">{title}</p>
      {subtitle && <p className="text-xs text-text-industrial/60 mt-1 mb-4">{subtitle}</p>}
    </>
  );

  const selectedPlan = sortedPlanItems.find(p => p.id === selectedPlanId) ?? null;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header: título + barra de pasos */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-fg/10 shrink-0">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-bold text-fg">
              <Wrench className="w-4 h-4 text-accent" /> {t("dashboard.newWorkOrder")}
            </h2>
            <WizardStepper labels={stepKeys.map(k => t(k))} current={currentIndex} />
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {chips}

          {step === "category" && (
            <>
              {question(t("wo.wizard.categoryTitle"), t("wo.wizard.categorySubtitle"))}
              <div className="space-y-2.5">
                {CATEGORY_OPTIONS.map(o => (
                  <OptionCard key={o.value} icon={o.icon} title={t(o.label)}
                    desc={t(`wo.wizard.catDesc.${o.value}` as TranslationKey)}
                    onClick={() => chooseCategory(o.value)} />
                ))}
              </div>
            </>
          )}

          {step === "vessel" && (
            <>
              {question(t("wo.wizard.vesselTitle"))}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-4">
                {vessels.map(v => (
                  <OptionCard key={v.code} icon={/barcaza/i.test(v.vesselType ?? "") ? Container : Ship}
                    title={v.name} desc={v.vesselType ?? undefined}
                    onClick={() => chooseVessel(v.code)} />
                ))}
              </div>
            </>
          )}

          {step === "asset" && (
            <>
              {question(t("wo.wizard.assetTitle"), t("wo.wizard.assetSubtitle"))}
              {loadingAssets ? (
                <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-3">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 w-4 h-4 text-text-industrial/40" />
                    <input
                      autoFocus
                      value={assetQuery}
                      onChange={e => setAssetQuery(e.target.value)}
                      placeholder={t("wo.wizard.assetSearch")}
                      className="w-full bg-fg/5 border border-fg/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
                    />
                  </div>
                  <div className="mt-2.5 border border-fg/10 rounded-xl divide-y divide-fg/10 max-h-[45vh] overflow-y-auto">
                    {filteredAssets.length === 0 ? (
                      <p className="px-3 py-2.5 text-xs text-text-industrial/40">{t("wo.wizard.noMatches")}</p>
                    ) : filteredAssets.map(a => (
                      <button key={a.id} type="button" onClick={() => chooseAsset(a.id)}
                        className="flex items-center gap-2.5 w-full text-left px-3 py-2.5 text-sm text-fg hover:bg-accent/5 transition-colors">
                        <Cog className="w-4 h-4 text-text-industrial/40 shrink-0" />
                        <span className="flex-1 min-w-0 font-semibold truncate">{a.name ?? a.assetCode}</span>
                        <span className="font-mono text-[11px] text-text-industrial/40 shrink-0">{a.assetCode}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {step === "repairKind" && (
            <>
              {question(t("wo.wizard.repairKindTitle"), t("wo.wizard.repairKindSubtitle"))}
              <div className="space-y-2.5">
                {REPAIR_KIND_OPTIONS.map(o => (
                  <OptionCard key={o.value} icon={o.icon} tone={o.tone} title={o.label}
                    desc={t(`wo.wizard.repairDesc.${o.value}` as TranslationKey)}
                    onClick={() => chooseRepairKind(o.value)} />
                ))}
              </div>
            </>
          )}

          {step === "planItem" && (
            <>
              {question(t("wo.wizard.planItemTitle"), t("wo.wizard.planItemSubtitleAsset").replace("{asset}", assetName))}
              {loadingPlans ? (
                <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-3">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {sortedPlanItems.map(item => {
                      const on = item.id === selectedPlanId;
                      const due = dueBadge(item);
                      return (
                        <button key={item.id} type="button" disabled={creating}
                          onClick={() => setSelectedPlanId(item.id)}
                          className={`flex items-start gap-3 w-full text-left px-3.5 py-3 rounded-xl border-[1.5px] transition-colors ${
                            on ? "border-accent bg-accent/5" : "border-fg/10 bg-surface hover:border-accent/45"
                          }`}>
                          <span className={`mt-0.5 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 ${on ? "border-accent" : "border-fg/25"}`}>
                            {on && <span className="w-2 h-2 rounded-full bg-accent" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] text-fg">
                              <span className="font-mono font-bold">{item.taskCode}</span>
                              <span className="font-semibold"> · {item.title}</span>
                            </span>
                            {due && (
                              <span className={`inline-flex items-center gap-1 mt-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${due.cls}`}>
                                <CalendarClock className="w-[11px] h-[11px]" /> {due.text}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {selectedPlan && (
                    <div className="flex gap-2 mt-2.5 rounded-xl border border-success-sea/25 bg-success-sea/5 px-3 py-2.5 text-xs text-fg">
                      <Sparkles className="w-4 h-4 text-success-sea shrink-0 mt-px" />
                      <span>{t("wo.wizard.inherits")}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2.5 text-[11px] text-text-industrial/40 my-3.5 before:content-[''] before:flex-1 before:h-px before:bg-fg/10 after:content-[''] after:flex-1 after:h-px after:bg-fg/10">
                    {t("wo.wizard.or")}
                  </div>
                  <OptionCard icon={FilePlus} tone="muted" title={t("wo.wizard.noneTitle")} desc={t("wo.wizard.noneDesc")} onClick={openBlankForm} />
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {step !== "category" && (
          <div className="flex items-center gap-2 px-6 py-3.5 border-t border-fg/10 shrink-0">
            <button type="button" onClick={goBack} disabled={creating}
              className="px-3.5 py-2 rounded-xl text-xs text-fg hover:bg-fg/5 transition-colors">
              {t("wo.wizard.back")}
            </button>
            <span className="flex-1" />
            {step === "planItem" && !loadingPlans && (
              <button type="button" disabled={!selectedPlan || creating}
                onClick={() => { if (selectedPlan) void choosePlanItem(selectedPlan); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-45 transition-all">
                {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {creating ? t("wo.wizard.creating") : t("wo.wizard.createFromPlan")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
    {/* Fuera del fondo oscuro: un clic en el aviso no debe cerrar el asistente. */}
    {createError && <AlertDialog message={createError} onClose={() => setCreateError(null)} />}
    </>
  );
};
