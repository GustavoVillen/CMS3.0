// Asistente de "Nueva Solicitud de Servicio". Mismo formato que el de "Nueva OT"
// (NewWorkOrderWizard): para qué → buque → OT abierta o equipo → PROVEEDOR →
// solicitud o formulario. El proveedor es un paso propio porque es lo que
// distingue a una SS de una OT: sin taller no hay SS.
//
// Dos caminos:
//  - OT abierta: se elige la orden, los talleres y qué servicio se le pide a cada
//    uno; se crea una SS por taller colgando de esa OT (el resto lo hereda el
//    backend — ver createServiceRequestForWorkOrder).
//  - Mantenimiento / Reparación / Clase: se elige equipo y talleres, y se abre
//    CreateWorkOrderModal en modo SS: al guardar crea la OT y una SS por taller.
import React, { useCallback, useMemo, useState } from "react";
import { ClipboardCheck, ClipboardList, Cog, Container, Handshake, Info, Loader2, Search, ShieldAlert, Ship, Sparkles, Wrench } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT, type TranslationKey } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { WO_PRIORITY_OPTIONS } from "../lib/wo-form-catalog";
import { ModalCloseButton } from "./ModalCloseButton";
import { AlertDialog } from "./AlertDialog";
import { GuideNeedTag } from "./GuideKit";
import { AutoTextArea } from "./AutoTextArea";
import { type AssetOption } from "./AssetSearchDropdown";
import { CreateWorkOrderModal, SegButtons } from "./CreateWorkOrderModal";
import { OptionCard, WizardStepper } from "./NewWorkOrderWizard";
import { WO_OPEN_STATUSES, WoStatusChip, type PickerWorkOrder } from "./service-requests/OpenWorkOrdersPicker";
import { findClassInspectionAsset } from "../lib/class-inspection-asset";
import { markJustCreated } from "../lib/just-created";
import { CopilotFlowProvider, useCopilotAssist, type CopilotAssistSpec } from "../lib/copilot-context";

type Category = "FROM_WO" | "MAINTENANCE" | "REPAIR" | "CLASS";
type Step = "category" | "vessel" | "workOrder" | "asset" | "provider" | "service";

interface ProviderOption { id: string; name: string; providerCode?: string; category?: string | null; location?: string | null }
type WizardWorkOrder = PickerWorkOrder & { priority?: string | null };

const CATEGORY_OPTIONS: { value: Category; label: TranslationKey; icon: typeof Wrench }[] = [
  { value: "FROM_WO",     label: "ss.wizard.cat.FROM_WO",               icon: ClipboardCheck },
  { value: "MAINTENANCE", label: "dashboard.ssChooser.maintenance",     icon: ClipboardList },
  { value: "REPAIR",      label: "dashboard.ssChooser.repair",          icon: Wrench },
  { value: "CLASS",       label: "dashboard.ssChooser.classInspection", icon: ShieldAlert },
];

/** Tipo de mantenimiento con el que nace la OT de cada camino — el mismo preset
 *  que usaba el selector anterior del Dashboard. */
const CATEGORY_MAINT_KIND: Record<Exclude<Category, "FROM_WO">, string> = {
  MAINTENANCE: "PREVENTIVO",
  REPAIR: "CORRECTIVO_NO_PROGRAMADO",
  CLASS: "INSPECTION",
};

interface NewServiceRequestWizardProps {
  onClose: () => void;
  /** Terminó: la SS creada (si fue una sola) para abrirla; null = ir al listado. */
  onFinished: (serviceRequestId: string | null) => void;
}

export const NewServiceRequestWizard: React.FC<NewServiceRequestWizardProps> = (props) => (
  <CopilotFlowProvider name="new-ss">
    <NewServiceRequestWizardSteps {...props} />
  </CopilotFlowProvider>
);

const NewServiceRequestWizardSteps: React.FC<NewServiceRequestWizardProps> = ({ onClose, onFinished }) => {
  const t = useT();
  const { tenant } = useAuth();
  const isMercurio = !!tenant?.workOrderPdfTemplate?.startsWith("MERCURIO");
  const { vessels, selectedVesselCode, isVesselScoped } = useVesselContext();

  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<Category | null>(null);
  const [vesselCode, setVesselCode] = useState(selectedVesselCode ?? "");
  const [loading, setLoading] = useState(false);

  // Camino "OT abierta"
  const [workOrders, setWorkOrders] = useState<WizardWorkOrder[]>([]);
  const [woQuery, setWoQuery] = useState("");
  const [workOrderId, setWorkOrderId] = useState<string | null>(null);

  // Camino "crear OT + SS"
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetId, setAssetId] = useState("");
  const [assetStepShown, setAssetStepShown] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Proveedores (paso 4)
  const [providers, setProviders] = useState<ProviderOption[] | null>(null);
  const [providerQuery, setProviderQuery] = useState("");
  const [providerIds, setProviderIds] = useState<string[]>([]);

  // Solicitud (camino OT abierta)
  const [services, setServices] = useState<Record<string, string>>({});
  const [priority, setPriority] = useState("");
  const [creating, setCreating] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const vesselName = vessels.find(v => v.code === vesselCode)?.name ?? vesselCode;
  const workOrder = workOrders.find(w => w.id === workOrderId) ?? null;
  const asset = assets.find(a => a.id === assetId) ?? null;
  const providerName = (id: string) => providers?.find(p => p.id === id)?.name ?? "…";

  const loadProviders = useCallback(async () => {
    if (providers) return;
    try {
      const res = await api.get<{ items: ProviderOption[] }>("/app/providers?status=ACTIVE");
      setProviders(res.items ?? []);
    } catch {
      setProviders([]);
    }
  }, [providers]);

  const goProvider = () => { setStep("provider"); void loadProviders(); };

  const afterVessel = useCallback(async (cat: Category, vc: string) => {
    setWorkOrderId(null);
    setAssetId("");
    setAssetStepShown(false);
    setLoading(true);
    try {
      if (cat === "FROM_WO") {
        setStep("workOrder");
        const res = await api.get<{ items: WizardWorkOrder[] }>(`/app/work-orders?vesselCode=${encodeURIComponent(vc)}`);
        setWorkOrders((res.items ?? []).filter(w => WO_OPEN_STATUSES.includes(w.status)));
        return;
      }
      const res = await api.get<{ items: AssetOption[] }>(`/app/pms/assets?vesselCode=${encodeURIComponent(vc)}&limit=200`);
      const items = res.items ?? [];
      setAssets(items);
      if (cat === "CLASS") {
        const match = findClassInspectionAsset(items);
        if (match) { setAssetId(match.id); setStep("provider"); void loadProviders(); return; }
      }
      setAssetStepShown(true);
      setStep("asset");
    } catch {
      setWorkOrders([]);
      setAssets([]);
      setStep(cat === "FROM_WO" ? "workOrder" : "asset");
    } finally {
      setLoading(false);
    }
  }, [loadProviders]);

  const chooseCategory = (cat: Category) => {
    setCategory(cat);
    if (!vesselCode) { setStep("vessel"); return; }
    void afterVessel(cat, vesselCode);
  };

  const chooseVessel = (vc: string) => {
    setVesselCode(vc);
    if (category) void afterVessel(category, vc);
  };

  const chooseAsset = (id: string) => { setAssetId(id); goProvider(); };

  const toggleProvider = (id: string) =>
    setProviderIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const afterProvider = () => {
    if (providerIds.length === 0) return;
    if (category === "FROM_WO") {
      setPriority(workOrder?.priority ?? "");
      setStep("service");
    } else {
      setShowForm(true);
    }
  };

  const goBack = () => {
    if (step === "vessel") setStep("category");
    else if (step === "workOrder" || step === "asset") setStep(isVesselScoped ? "category" : "vessel");
    else if (step === "provider") setStep(category === "FROM_WO" ? "workOrder" : assetStepShown ? "asset" : "category");
    else if (step === "service") setStep("provider");
  };

  // Una SS por taller, colgando de la OT elegida.
  const createFromWorkOrder = useCallback(async () => {
    if (!workOrder) return;
    if (providerIds.some(id => !(services[id] ?? "").trim())) { setAlert(t("wo.newSs.required")); return; }
    setCreating(true);
    const ids: string[] = [];
    try {
      for (const providerId of providerIds) {
        const servicio = services[providerId]!.trim();
        const created = await api.post<{ id?: string }>(`/app/pms/work-orders/${workOrder.id}/service-requests`, {
          providerId,
          title: servicio,
          description: servicio,
          ...(priority ? { priority } : {}),
        });
        if (created?.id) ids.push(created.id);
      }
      // Una sola SS: se abre con el aviso "¡Solicitud de servicio abierta!".
      if (ids.length === 1) markJustCreated("ss", ids[0]);
      onFinished(ids.length === 1 ? ids[0]! : null);
    } catch (e) {
      console.error("[ss-wizard] create failed:", e);
      // Si alguna ya se creó, no se pierde: se va al listado donde está.
      if (ids.length > 0) { onFinished(null); return; }
      setAlert(e instanceof ApiError ? e.message : t("wo.newSs.failed"));
    } finally {
      setCreating(false);
    }
  }, [workOrder, providerIds, services, priority, onFinished, t]);

  const filteredWorkOrders = useMemo(() => {
    const q = woQuery.trim().toLowerCase();
    if (!q) return workOrders;
    return workOrders.filter(w => `${w.workOrderCode} ${w.title ?? ""} ${w.assetName ?? ""}`.toLowerCase().includes(q));
  }, [workOrders, woQuery]);

  const filteredAssets = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter(a => `${a.name ?? ""} ${a.assetCode}`.toLowerCase().includes(q));
  }, [assets, assetQuery]);

  const filteredProviders = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    const list = providers ?? [];
    if (!q) return list;
    return list.filter(p => `${p.name} ${p.category ?? ""} ${p.providerCode ?? ""}`.toLowerCase().includes(q));
  }, [providers, providerQuery]);

  const priorityOptions = isMercurio ? WO_PRIORITY_OPTIONS : [
    { value: "CRITICAL", label: t("priority.critical") }, { value: "HIGH", label: t("priority.high") },
    { value: "MEDIUM", label: t("priority.medium") },     { value: "LOW", label: t("priority.low") },
  ];

  // ── Copiloto: cada paso es una elección; cargarla hace lo mismo que el clic ──
  const assistBase = { module: "SERVICE_REQUESTS", title: t("dashboard.newServiceRequest"), vesselCode: vesselCode || undefined };
  let assist: CopilotAssistSpec | null = null;
  if (!showForm && step === "category") {
    assist = { ...assistBase, screen: "SS_WIZARD_CATEGORY", fields: [{
      key: "category", label: t("ss.wizard.categoryTitle"), value: category,
      options: CATEGORY_OPTIONS.map(o => ({ value: o.value, label: t(o.label) })),
      set: v => chooseCategory(v as Category),
    }] };
  } else if (!showForm && step === "vessel") {
    assist = { ...assistBase, screen: "SS_WIZARD_VESSEL", fields: [{
      key: "vesselCode", label: t("wo.wizard.vesselTitle"), value: null,
      options: vessels.map(v => ({ value: v.code, label: v.name ?? v.code })), set: chooseVessel,
    }] };
  } else if (!showForm && step === "workOrder" && !loading) {
    assist = { ...assistBase, screen: "SS_WIZARD_WORK_ORDER", fields: [{
      key: "workOrderId", label: t("ss.wizard.woTitle"), value: workOrderId,
      hint: "Open work orders of the selected vessel. If the user describes the job instead of giving a code, match it by title and equipment.",
      options: workOrders.map(w => ({ value: w.id, label: [w.workOrderCode, w.title, w.assetName].filter(Boolean).join(" · ") })),
      set: v => { setWorkOrderId(v); goProvider(); },
    }] };
  } else if (!showForm && step === "asset" && !loading) {
    assist = { ...assistBase, screen: "SS_WIZARD_ASSET", fields: [{
      key: "assetId", label: t("wo.wizard.assetTitle"), value: null,
      options: assets.map(a => ({ value: a.id, label: a.name ?? a.assetCode, aliases: [a.assetCode] })), set: chooseAsset,
    }] };
  } else if (!showForm && step === "provider" && providers) {
    assist = { ...assistBase, screen: "SS_WIZARD_PROVIDER", fields: [{
      key: "providerId", label: t("ss.wizard.providerTitle"),
      value: providerIds.map(providerName).join(", ") || null,
      hint: "Each value ADDS a provider to the selection (one SR per provider). When the user is done, run the continue action.",
      options: providers.map(p => ({ value: p.id, label: p.name, aliases: p.providerCode ? [p.providerCode] : undefined })),
      set: v => setProviderIds(prev => prev.includes(v) ? prev : [...prev, v]),
    }], actions: { continue: { label: t("ss.wizard.continue"), run: afterProvider } } };
  } else if (!showForm && step === "service") {
    assist = { ...assistBase, screen: "SS_WIZARD_SERVICE", fields: [
      ...providerIds.map(id => ({
        key: `service.${id}`, label: `${t("wo.newSs.question")} (${providerName(id)})`, value: services[id] ?? "",
        set: (v: string) => setServices(prev => ({ ...prev, [id]: v })),
      })),
      { key: "priority", label: t("wo.modal.priority"), value: priority, options: priorityOptions, set: setPriority },
    // Sin acción de crear: el copiloto completa, el usuario confirma con el botón.
    ] };
  }
  useCopilotAssist(assist);

  if (showForm && category && category !== "FROM_WO") {
    return (
      <CreateWorkOrderModal
        serviceRequestMode
        requireProvider
        initialVesselCode={vesselCode}
        initialAssetId={assetId}
        initialMaintKind={CATEGORY_MAINT_KIND[category]}
        initialTitle={category === "CLASS" ? t("dashboard.ssChooser.classInspection") : undefined}
        autoSelectClassInspectionAsset={category === "CLASS"}
        initialProviderIds={providerIds}
        onChangeContext={() => { setShowForm(false); setStep("provider"); }}
        onClose={onClose}
        onSaved={async (woId) => {
          // El flujo termina en la solicitud: si se abrió una sola SS, se abre esa.
          try {
            const res = await api.get<{ items: Array<{ id: string }> }>(`/app/pms/work-orders/${encodeURIComponent(woId)}/service-requests`);
            const only = res.items?.length === 1 ? res.items[0]!.id : null;
            if (only) markJustCreated("ss", only);
            onFinished(only);
          } catch {
            onFinished(null);
          }
        }}
      />
    );
  }

  // ── Barra de pasos ──
  const stepKeys: TranslationKey[] = category === "FROM_WO"
    ? ["wo.wizard.step.category", "wo.wizard.step.vessel", "ss.wizard.step.workOrder", "ss.wizard.step.provider", "ss.wizard.step.request"]
    : ["wo.wizard.step.category", "wo.wizard.step.vessel", "wo.wizard.step.asset", "ss.wizard.step.provider", "wo.wizard.step.form"];
  const currentIndex = { category: 0, vessel: 1, workOrder: 2, asset: 2, provider: 3, service: 4 }[step];

  const chipCls = "inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/5 px-2.5 py-1 text-[11px] text-fg";
  const changeBtn = (to: Step) => (
    <button type="button" onClick={() => to === "provider" ? goProvider() : setStep(to)} className="text-[11px] font-semibold text-accent hover:text-fg transition-colors">
      {t("wo.wizard.change")}
    </button>
  );
  const chips = step !== "category" && (
    <div className="flex flex-wrap gap-1.5 mb-3.5">
      {category && (
        <span className={chipCls}>
          {t(category === "FROM_WO" ? "ss.wizard.chip.FROM_WO" : `wo.wizard.cat.${category}` as TranslationKey)} {changeBtn("category")}
        </span>
      )}
      {vesselCode && step !== "vessel" && (
        <span className={chipCls}><Ship className="w-3 h-3" /><b className="font-bold">{vesselName}</b>{!isVesselScoped && changeBtn("vessel")}</span>
      )}
      {workOrder && (step === "provider" || step === "service") && (
        <span className={chipCls}><ClipboardCheck className="w-3 h-3" /><b className="font-bold font-mono">{workOrder.workOrderCode}</b>{changeBtn("workOrder")}</span>
      )}
      {asset && step === "provider" && (
        <span className={chipCls}><Cog className="w-3 h-3" /><b className="font-bold">{asset.name ?? asset.assetCode}</b>{assetStepShown && changeBtn("asset")}</span>
      )}
      {step === "service" && providerIds.length > 0 && (
        <span className={chipCls}><Handshake className="w-3 h-3" /><b className="font-bold">{providerIds.map(providerName).join(", ")}</b>{changeBtn("provider")}</span>
      )}
    </div>
  );

  const question = (title: string, subtitle?: React.ReactNode) => (
    <>
      <p className="text-[17px] font-extrabold text-fg mt-1">{title}</p>
      {subtitle && <p className="text-xs text-text-industrial/60 mt-1 mb-4">{subtitle}</p>}
    </>
  );
  const loadingRow = (
    <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-3">
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
    </div>
  );
  const searchBox = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <div className="relative mb-2.5">
      <Search className="absolute left-3 top-3 w-4 h-4 text-text-industrial/40" />
      <input autoFocus value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-fg/5 border border-fg/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50" />
    </div>
  );
  const selectableCls = (on: boolean) => `flex items-start gap-3 w-full text-left px-3.5 py-3 rounded-xl border-[1.5px] transition-colors ${
    on ? "border-accent bg-accent/5" : "border-fg/10 bg-surface hover:border-accent/45"
  }`;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-fg/10 shrink-0">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-bold text-fg">
              <Handshake className="w-4 h-4 text-accent" /> {t("dashboard.newServiceRequest")}
            </h2>
            <WizardStepper labels={stepKeys.map(k => t(k))} current={currentIndex} />
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {chips}

          {step === "category" && (
            <>
              {question(t("ss.wizard.categoryTitle"), t("ss.wizard.categorySubtitle"))}
              <div className="space-y-2.5">
                {CATEGORY_OPTIONS.map(o => (
                  <OptionCard key={o.value} icon={o.icon} title={t(o.label)}
                    desc={t(`ss.wizard.catDesc.${o.value}` as TranslationKey)}
                    highlight={o.value === "FROM_WO"}
                    badge={o.value === "FROM_WO" && (
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">{t("ss.wizard.mostUsed")}</span>
                    )}
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
                    title={v.name} desc={v.vesselType ?? undefined} onClick={() => chooseVessel(v.code)} />
                ))}
              </div>
            </>
          )}

          {step === "workOrder" && (
            <>
              {question(t("ss.wizard.woTitle"), t("ss.wizard.woSubtitle").replace("{vessel}", vesselName))}
              {loading ? loadingRow : (
                <>
                  {searchBox(woQuery, setWoQuery, t("ss.wizard.woSearch"))}
                  {filteredWorkOrders.length === 0 ? (
                    <p className="text-xs text-text-industrial/50 text-center py-6">
                      {workOrders.length === 0 ? t("dashboard.woPicker.empty") : t("wo.wizard.noMatches")}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {filteredWorkOrders.map(w => {
                        const on = w.id === workOrderId;
                        return (
                          <button key={w.id} type="button" onClick={() => setWorkOrderId(w.id)} className={selectableCls(on)}>
                            <span className={`mt-0.5 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 ${on ? "border-accent" : "border-fg/25"}`}>
                              {on && <span className="w-2 h-2 rounded-full bg-accent" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] text-fg">
                                <span className="font-mono font-bold">{w.workOrderCode}</span>
                                <span className="font-semibold"> · {w.title || "—"}</span>
                              </span>
                              <span className="flex flex-wrap items-center gap-2 mt-1 text-xs text-text-industrial/60">
                                {w.assetName && <span className="flex items-center gap-1"><Cog className="w-3 h-3" /> {w.assetName}</span>}
                                <WoStatusChip wo={w} />
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {workOrder && (
                    <div className="flex gap-2 mt-2.5 rounded-xl border border-success-sea/25 bg-success-sea/5 px-3 py-2.5 text-xs text-fg">
                      <Sparkles className="w-4 h-4 text-success-sea shrink-0 mt-px" />
                      <span>{t("ss.wizard.woInherits")}</span>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {step === "asset" && (
            <>
              {question(t("wo.wizard.assetTitle"), t("wo.wizard.assetSubtitle"))}
              {loading ? loadingRow : (
                <>
                  {searchBox(assetQuery, setAssetQuery, t("wo.wizard.assetSearch"))}
                  <div className="border border-fg/10 rounded-xl divide-y divide-fg/10 max-h-[45vh] overflow-y-auto">
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

          {step === "provider" && (
            <>
              {question(t("ss.wizard.providerTitle"), t("ss.wizard.providerSubtitle"))}
              {!providers ? loadingRow : (
                <>
                  {searchBox(providerQuery, setProviderQuery, t("ss.wizard.providerSearch"))}
                  {filteredProviders.length === 0 ? (
                    <p className="text-xs text-text-industrial/50 text-center py-6">
                      {providers.length === 0 ? t("ss.wizard.noProviders") : t("wo.wizard.noMatches")}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {filteredProviders.map(p => {
                        const on = providerIds.includes(p.id);
                        const detail = [p.category, p.location].filter(Boolean).join(" · ");
                        return (
                          <button key={p.id} type="button" onClick={() => toggleProvider(p.id)} className={selectableCls(on)}>
                            <span className={`mt-0.5 w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center shrink-0 text-[11px] font-bold ${
                              on ? "border-accent bg-accent/10 text-accent" : "border-fg/25"
                            }`}>
                              {on && "✓"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-bold text-fg">{p.name}</span>
                              {detail && <span className="block text-xs text-text-industrial/60 mt-0.5">{detail}</span>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {providerIds.length > 1 && (
                    <div className="flex gap-2 mt-2.5 rounded-xl border border-success-sea/25 bg-success-sea/5 px-3 py-2.5 text-xs text-fg">
                      <Info className="w-4 h-4 text-success-sea shrink-0 mt-px" />
                      <span>{t("ss.wizard.providerMany").replace("{n}", String(providerIds.length))}</span>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {step === "service" && workOrder && (
            <>
              {question(t("ss.wizard.serviceTitle"),
                t("ss.wizard.serviceSubtitle").replace("{wo}", `${workOrder.workOrderCode} · ${workOrder.title ?? ""}`))}
              <div className="space-y-2.5">
                {providerIds.map(id => {
                  // Servicio pedido al taller: obligatorio, se resalta mientras falte (preview V24).
                  const miss = !(services[id] ?? "").trim();
                  return (
                  <div key={id} className={`rounded-xl border p-3 space-y-1.5 ${miss ? "border-amber-500/60 border-l-4 bg-amber-50 dark:bg-amber-500/10" : "border-accent/25 bg-accent/5"}`}>
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-industrial/60">
                      <Handshake className="w-3.5 h-3.5 text-accent" /> {providerName(id)}
                      {miss && <GuideNeedTag label={t("mp.guide.missing")} />}
                    </p>
                    <AutoTextArea
                      rows={2}
                      value={services[id] ?? ""}
                      onChange={e => setServices(prev => ({ ...prev, [id]: e.target.value }))}
                      placeholder={t("wo.newSs.placeholder")}
                      className="w-full bg-surface border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-y"
                    />
                  </div>
                  );
                })}
              </div>
              <div className="mt-3.5 space-y-1.5">
                <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("wo.modal.priority")}</label>
                <SegButtons options={priorityOptions} value={priority} allowClear={false} onChange={setPriority} />
              </div>
            </>
          )}
        </div>

        {step !== "category" && (
          <div className="flex items-center gap-2 px-6 py-3.5 border-t border-fg/10 shrink-0">
            <button type="button" onClick={goBack} disabled={creating}
              className="px-3.5 py-2 rounded-xl text-xs text-fg hover:bg-fg/5 transition-colors">
              {t("wo.wizard.back")}
            </button>
            <span className="flex-1" />
            {step === "workOrder" && (
              <button type="button" disabled={!workOrder} onClick={goProvider}
                className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-45 transition-all">
                {t("ss.wizard.continue")}
              </button>
            )}
            {step === "provider" && (
              <button type="button" disabled={providerIds.length === 0} onClick={afterProvider}
                className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-45 transition-all">
                {t("ss.wizard.continue")}{providerIds.length > 0 ? ` (${providerIds.length})` : ""}
              </button>
            )}
            {step === "service" && (
              <button type="button" disabled={creating} onClick={() => { void createFromWorkOrder(); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-45 transition-all">
                {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {creating ? t("wo.newSs.creating")
                  : providerIds.length > 1 ? t("ss.wizard.createMany").replace("{n}", String(providerIds.length))
                  : t("wo.newSs.create")}
                {!creating && providerIds.some(id => !(services[id] ?? "").trim()) && (
                  <span className="text-[10px] font-semibold opacity-85">{t("mp.guide.saveMissing").replace("{n}", String(providerIds.filter(id => !(services[id] ?? "").trim()).length))}</span>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
    {/* Fuera del fondo oscuro: un clic en el aviso no debe cerrar el asistente. */}
    {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </>
  );
};
