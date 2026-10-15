// Asistente "Nueva OT → Para un Equipo Nuevo" (Preview V1, oct 2026). Sigue al
// paso del buque de NewWorkOrderWizard: equipo adicional o reemplazo → datos del
// equipo → MOC → tareas a copiar → confirmar. Todo se crea en un solo pedido
// (POST /app/pms/assets/install); el cambio rige al cerrar la OT de instalación.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CircleCheck, CirclePlay, CircleSlash, Cog, Copy, Flag, GitBranch, Hourglass, Info, Loader2,
  LogIn, LogOut, Plus, Repeat, Search, Ship, Sparkles, Wrench,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT, type TranslationKey } from "../lib/i18n";
import { useVesselContext } from "../lib/vessel-context";
import { markJustCreated } from "../lib/just-created";
import { useCopilotAssist, type CopilotAssistSpec } from "../lib/copilot-context";
import { buildFormattedAssetCode, toAssetCodeToken } from "../lib/asset-code";
import { ModalCloseButton } from "./ModalCloseButton";
import { AlertDialog } from "./AlertDialog";
import { GuideField, GuideNeedTag, GuidePill, RequiredMark } from "./GuideKit";
import { OptionCard, WizardStepper } from "./NewWorkOrderWizard";
import { MocModal, type Moc } from "../pages/Moc";

interface InstallAsset {
  id: string;
  vesselCode: string;
  assetCode: string;
  name: string | null;
  sfiCode: string | null;
  criticality: string;
  isSafetyCritical: boolean;
  manufacturer: string | null;
  model: string | null;
}

interface PlanLite {
  id: string;
  assetId: string;
  taskCode: string;
  title: string;
  status: string;
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
}

interface MocLite { id: string; mocCode: string; title: string; status: string }

type Kind = "ADD" | "REPLACE";
type Step = "kind" | "pickOld" | "data" | "moc" | "tasks" | "confirm";
type MocMode = "NEW" | "EXISTING" | "NOT_REQUIRED";
type TaskSource = "OLD" | "FLEET" | "NONE";
type Crit = "A" | "B" | "C";

interface FormState {
  group: string;
  name: string;
  code: string;
  codeTouched: boolean;
  maker: string;
  model: string;
  serial: string;
  crit: Crit;
  safety: boolean;
  rationale: string;
}

const EMPTY_FORM: FormState = { group: "", name: "", code: "", codeTouched: false, maker: "", model: "", serial: "", crit: "B", safety: false, rationale: "" };
const SFI_GROUPS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
/** MOC que todavía se pueden vincular (los terminales ya no se editan). */
const MOC_LINKABLE = new Set(["REQUESTED", "UNDER_ANALYSIS", "APPROVED", "IN_PROGRESS", "IMPLEMENTED"]);
const MOC_APPROVED = new Set(["APPROVED", "IN_PROGRESS", "IMPLEMENTED"]);
const STEP_INDEX: Record<Step, number> = { kind: 2, pickOld: 2, data: 2, moc: 3, tasks: 4, confirm: 5 };
const CRIT_ON: Record<Crit, string> = {
  A: "bg-red-700 border-red-700 text-white",
  B: "bg-amber-600 border-amber-600 text-white",
  C: "bg-slate-600 border-slate-600 text-white",
};

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "block text-[11px] font-semibold text-text-industrial/60 uppercase tracking-wider mb-1.5";
const chipCls = "inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/5 px-2.5 py-1 text-[11px] text-fg";

/** Comparación de marca/modelo sin mayúsculas, tildes ni espacios. */
const norm = (s?: string | null) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const makerModel = (maker?: string | null, model?: string | null) => [maker, model].map(x => x?.trim()).filter(Boolean).join(" ");
const sfiGroupOf = (sfiCode: string | null) => { const d = (sfiCode ?? "").trim()[0] ?? ""; return /^[0-9]$/.test(d) ? d : ""; };
/** Reemplaza {clave} sin que un "$" del texto del usuario se interprete. */
const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

function fmtFreq(p: PlanLite): string {
  const tt = p.triggerType;
  if ((tt === "HOURS" || tt === "RUNNING_HOURS") && p.frequencyHours) return `${p.frequencyHours.toLocaleString()} h`;
  if ((tt === "MONTHS" || tt === "CALENDAR") && p.frequencyMonths) return `${p.frequencyMonths} m`;
  if (tt === "DAY" && p.frequencyMonths) return `${p.frequencyMonths} d`;
  if (tt === "WEEK" && p.frequencyMonths) return `${p.frequencyMonths} sem`;
  return tt;
}

interface Props {
  vesselCode: string;
  vesselName: string;
  canChangeVessel: boolean;
  onBack: () => void;
  onChangeCategory: () => void;
  onChangeVessel: () => void;
  onClose: () => void;
  onSaved: (woId: string, workOrderCode?: string) => void | Promise<void>;
}

export const NewAssetInstallWizard: React.FC<Props> = ({
  vesselCode, vesselName, canChangeVessel, onBack, onChangeCategory, onChangeVessel, onClose, onSaved,
}) => {
  const t = useT();
  const { vessels } = useVesselContext();

  const [step, setStep] = useState<Step>("kind");
  const [kind, setKind] = useState<Kind | null>(null);
  const [assets, setAssets] = useState<InstallAsset[] | null>(null);
  const [vesselPlans, setVesselPlans] = useState<PlanLite[]>([]);
  const [oldId, setOldId] = useState<string | null>(null);
  const [oldQuery, setOldQuery] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [suggesting, setSuggesting] = useState(false);
  const [mocMode, setMocMode] = useState<MocMode | null>(null);
  const [mocTouched, setMocTouched] = useState(false);
  const [mocReason, setMocReason] = useState("");
  const [mocId, setMocId] = useState<string | null>(null);
  const [notReq, setNotReq] = useState("");
  const [mocs, setMocs] = useState<MocLite[] | null>(null);
  const [fleet, setFleet] = useState<InstallAsset[] | null>(null);
  const [tsrc, setTsrc] = useState<TaskSource | null>(null);
  const [tsrcAsset, setTsrcAsset] = useState<string | null>(null);
  const [srcPlans, setSrcPlans] = useState<PlanLite[] | null>(null);
  const [loadingSrc, setLoadingSrc] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ workOrderId: string; workOrderCode: string } | null>(null);
  const [mocToEdit, setMocToEdit] = useState<Moc | null>(null);

  // Equipos y tareas del buque: lista del paso "qué equipo sale", códigos
  // existentes para sugerir el nuevo y tareas del equipo reemplazado.
  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<{ items: InstallAsset[] }>(`/app/pms/assets?vesselCode=${encodeURIComponent(vesselCode)}`),
      api.get<{ items: PlanLite[] }>(`/app/pms/maintenance-plans?vesselCode=${encodeURIComponent(vesselCode)}`),
    ]).then(([a, p]) => {
      if (!alive) return;
      setAssets(a.items ?? []);
      setVesselPlans(p.items ?? []);
    }).catch(() => { if (alive) setAssets([]); });
    return () => { alive = false; };
  }, [vesselCode]);

  const activePlansByAsset = useMemo(() => {
    const map = new Map<string, PlanLite[]>();
    for (const p of vesselPlans) {
      if (p.status === "INACTIVE") continue;
      const list = map.get(p.assetId) ?? [];
      list.push(p);
      map.set(p.assetId, list);
    }
    return map;
  }, [vesselPlans]);

  const existingCodes = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets ?? []) { const c = toAssetCodeToken(a.assetCode); if (c) set.add(c); }
    return set;
  }, [assets]);

  const suggestCode = useCallback((group: string, name: string) =>
    group && name.trim() ? buildFormattedAssetCode(vesselCode, group, name, existingCodes) : "", [vesselCode, existingCodes]);

  const old = useMemo(() => (assets ?? []).find(a => a.id === oldId) ?? null, [assets, oldId]);
  const oldName = old ? (old.name ?? old.assetCode) : "";
  const newMm = makerModel(form.maker, form.model);

  // Cambiar marca o modelo cambia la recomendación de MOC y el origen de las tareas.
  const updateForm = (patch: Partial<FormState>) => {
    setForm(prev => {
      const next = { ...prev, ...patch };
      if (("group" in patch || "name" in patch) && !next.codeTouched) next.code = suggestCode(next.group, next.name);
      return next;
    });
    if ("maker" in patch || "model" in patch) { setMocTouched(false); setTsrc(null); }
  };

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!form.group) m.push(t("newAsset.f.group"));
    if (!form.code.trim()) m.push(t("newAsset.f.code"));
    if (!form.name.trim()) m.push(t("newAsset.f.name"));
    return m;
  }, [form, t]);

  // Mismo criterio que la ventana "¿Tu cambio necesita MOC?" del módulo MOC:
  // igual marca y modelo no lo requiere; distinto, o equipo adicional, sí.
  const mocAdvice = useMemo((): { needs: boolean; why: string } => {
    if (kind !== "REPLACE" || !old) return { needs: true, why: t("newAsset.mocWhy.ADD") };
    const oldMm = makerModel(old.manufacturer, old.model);
    if (!oldMm) return { needs: true, why: t("newAsset.mocWhy.UNKNOWN") };
    const same =!!norm(old.manufacturer) && norm(old.manufacturer) === norm(form.maker) && norm(old.model) === norm(form.model);
    return same
      ? { needs: false, why: fill(t("newAsset.mocWhy.SAME"), { mm: oldMm }) }
      : { needs: true, why: fill(t("newAsset.mocWhy.DIFF"), { mm: oldMm }) };
  }, [kind, old, form.maker, form.model, t]);

  const fleetMatches = useMemo(() => {
    if (!norm(form.maker) || !norm(form.model) || !fleet) return [];
    return fleet.filter(a => a.id !== oldId && norm(a.manufacturer) === norm(form.maker) && norm(a.model) === norm(form.model));
  }, [fleet, form.maker, form.model, oldId]);

  const vesselLabel = (code: string) => vessels.find(v => v.code === code)?.name ?? code;

  // ── Navegación ────────────────────────────────────────────────────────────
  const chooseKind = (k: Kind) => {
    setKind(k);
    setMocTouched(false);
    setTsrc(null);
    if (k === "ADD") { setOldId(null); setForm(EMPTY_FORM); setStep("data"); }
    else setStep("pickOld");
  };

  const chooseOld = (id: string) => {
    const a = (assets ?? []).find(x => x.id === id);
    if (!a) return;
    const group = sfiGroupOf(a.sfiCode);
    const name = a.name ?? "";
    setOldId(id);
    setForm({
      ...EMPTY_FORM, group, name, code: suggestCode(group, name),
      crit: (["A", "B", "C"].includes(a.criticality) ? a.criticality : "B") as Crit,
      safety: a.isSafetyCritical,
    });
    setMocTouched(false);
    setTsrc(null);
    setStep("data");
  };

  const requestCriticality = async () => {
    if (!form.name.trim() || suggesting) return;
    setSuggesting(true);
    try {
      const res = await api.post<{ criticality: Crit; isSafetyCritical: boolean; rationale: string }>("/app/pms/assets/suggest-criticality", {
        name: form.name.trim(), vesselCode, sfiCode: form.group ? `${form.group}00` : null,
        manufacturer: form.maker.trim() || null, model: form.model.trim() || null, serialNumber: form.serial.trim() || null,
      });
      updateForm({ crit: res.criticality, safety: res.isSafetyCritical, rationale: res.rationale });
    } catch (e) {
      setAlertMsg(e instanceof ApiError ? e.message : t("asset.v23.suggestError"));
    } finally {
      setSuggesting(false);
    }
  };

  const goToMoc = () => {
    if (missing.length) { setAlertMsg(fill(t("newAsset.err.missingData"), { list: missing.join(", ") })); return; }
    if (existingCodes.has(toAssetCodeToken(form.code))) { setAlertMsg(t("asset.v23.codeDuplicated")); return; }
    if (!mocTouched) {
      setMocMode(mocAdvice.needs ? "NEW" : "NOT_REQUIRED");
      if (!mocAdvice.needs && !notReq.trim()) setNotReq(t("newAsset.notReqDefault"));
    }
    if (mocs === null) {
      api.get<{ items: MocLite[] }>(`/app/mocs?vesselCode=${encodeURIComponent(vesselCode)}`)
        .then(res => setMocs((res.items ?? []).filter(m => MOC_LINKABLE.has(m.status))))
        .catch(() => setMocs([]));
    }
    setStep("moc");
  };

  const pickFleetAsset = useCallback(async (id: string) => {
    setTsrcAsset(id);
    setSrcPlans(null);
    setLoadingSrc(true);
    try {
      const res = await api.get<{ items: PlanLite[] }>(`/app/pms/maintenance-plans?assetId=${encodeURIComponent(id)}`);
      const list = (res.items ?? []).filter(p => p.assetId === id && p.status !== "INACTIVE");
      setSrcPlans(list);
      setChecked(new Set(list.map(p => p.id)));
    } catch {
      setSrcPlans([]);
      setChecked(new Set());
    } finally {
      setLoadingSrc(false);
    }
  }, []);

  const selectSource = (src: TaskSource, matches: InstallAsset[]) => {
    setTsrc(src);
    setTsrcAsset(null);
    if (src === "OLD") {
      const list = oldId ? activePlansByAsset.get(oldId) ?? [] : [];
      setSrcPlans(list);
      setChecked(new Set(list.map(p => p.id)));
    } else if (src === "FLEET") {
      setSrcPlans(null);
      setChecked(new Set());
      if (matches.length === 1) void pickFleetAsset(matches[0]!.id);
    } else {
      setSrcPlans([]);
      setChecked(new Set());
    }
  };

  const goToTasks = async () => {
    if (mocMode === "NEW" && !mocReason.trim()) { setAlertMsg(t("newAsset.err.mocReason")); return; }
    if (mocMode === "EXISTING" && !mocId) { setAlertMsg(t("newAsset.err.mocPick")); return; }
    if (mocMode === "NOT_REQUIRED" && !notReq.trim()) { setAlertMsg(t("newAsset.err.notReq")); return; }
    let fleetList = fleet;
    if (fleetList === null && norm(form.maker) && norm(form.model)) {
      try { fleetList = (await api.get<{ items: InstallAsset[] }>("/app/pms/assets")).items ?? []; }
      catch { fleetList = []; }
      setFleet(fleetList);
    }
    if (tsrc === null) {
      const matches = (fleetList ?? []).filter(a => a.id !== oldId && norm(a.manufacturer) === norm(form.maker) && norm(a.model) === norm(form.model) && !!norm(form.model));
      // Si entra un modelo distinto y hay uno igual en la flota, sus tareas le
      // corresponden más que las del equipo que sale.
      const sameAsOld = kind === "REPLACE" && !mocAdvice.needs;
      selectSource(sameAsOld ? "OLD" : matches.length ? "FLEET" : kind === "REPLACE" ? "OLD" : "NONE", matches);
    }
    setStep("tasks");
  };

  const goToConfirm = () => {
    if (tsrc === "FLEET" && !tsrcAsset && fleetMatches.length > 0) { setAlertMsg(t("newAsset.err.fleetPick")); return; }
    setStep("confirm");
  };

  const goBack = () => {
    if (step === "kind") onBack();
    else if (step === "pickOld") setStep("kind");
    else if (step === "data") setStep(kind === "REPLACE" ? "pickOld" : "kind");
    else if (step === "moc") setStep("data");
    else if (step === "tasks") setStep("moc");
    else if (step === "confirm") setStep("tasks");
  };

  // ── Textos que quedan en la OT y el MOC (idioma del tenant) ───────────────
  const selectedPlans = tsrc === "NONE" ? [] : (srcPlans ?? []).filter(p => checked.has(p.id));
  const chosenMoc = (mocs ?? []).find(m => m.id === mocId) ?? null;
  const mocStatusLabel = (s: string) => t(`newAsset.mocStatus.${s}` as TranslationKey);
  const woTitle = kind === "REPLACE" && old
    ? fill(t("newAsset.wo.titleReplace"), { old: oldName, new: norm(oldName) === norm(form.name) && newMm ? newMm : form.name.trim() })
    : fill(t("newAsset.wo.titleAdd"), { asset: form.name.trim() });

  const buildDescription = () => {
    const lines = [
      kind === "REPLACE" && old
        ? fill(t("newAsset.wo.descReplace"), { title: woTitle, oldCode: old.assetCode, code: form.code.trim().toUpperCase() })
        : fill(t("newAsset.wo.descAdd"), { asset: form.name.trim(), code: form.code.trim().toUpperCase() }),
      fill(t("newAsset.wo.descMakerModel"), { mm: newMm || "—", serial: form.serial.trim() || "—" }),
      mocMode === "NEW" ? t("newAsset.wo.descMocNew")
        : mocMode === "EXISTING" ? fill(t("newAsset.wo.descMocExisting"), { code: chosenMoc?.mocCode ?? "" })
        : fill(t("newAsset.wo.descMocNotReq"), { reason: notReq.trim() }),
    ];
    if (selectedPlans.length) lines.push(fill(t("newAsset.wo.descTasks"), { n: selectedPlans.length }));
    lines.push(kind === "REPLACE" && old ? fill(t("newAsset.wo.descCloseReplace"), { old: oldName }) : t("newAsset.wo.descClose"));
    return lines.join("\n");
  };

  const finish = (c: { workOrderId: string; workOrderCode: string }) => { void onSaved(c.workOrderId, c.workOrderCode); };

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const mocPayload = mocMode === "NEW"
        ? {
            mode: "NEW", title: woTitle, reasonForChange: mocReason.trim(),
            proposedChange: kind === "REPLACE" && old
              ? fill(t("newAsset.moc.proposedReplace"), { old: oldName, oldMm: makerModel(old.manufacturer, old.model) || "—", asset: form.name.trim(), mm: newMm || "—" })
              : fill(t("newAsset.moc.proposedAdd"), { asset: form.name.trim(), mm: newMm || "—" }),
          }
        : mocMode === "EXISTING" ? { mode: "EXISTING", mocId } : { mode: "NOT_REQUIRED", reason: notReq.trim() };
      const res = await api.post<{ workOrderId: string; workOrderCode: string; mocId: string | null }>("/app/pms/assets/install", {
        vesselCode,
        replacesAssetId: kind === "REPLACE" ? oldId : null,
        asset: {
          assetCode: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          sfiCode: `${form.group}00`,
          criticality: form.crit,
          criticalityRationale: form.rationale.trim() || null,
          isSafetyCritical: form.safety,
          manufacturer: form.maker.trim() || null,
          model: form.model.trim() || null,
          serialNumber: form.serial.trim() || null,
        },
        copyPlanIds: selectedPlans.map(p => p.id),
        moc: mocPayload,
        workOrder: { title: woTitle, description: buildDescription() },
      });
      markJustCreated("wo", res.workOrderCode);
      const done = { workOrderId: res.workOrderId, workOrderCode: res.workOrderCode };
      setCreated(done);
      // MOC nuevo: se abre para completar el formulario; al cerrarlo, la OT.
      if (mocMode === "NEW" && res.mocId) {
        try { setMocToEdit(await api.get<Moc>(`/app/mocs/${res.mocId}`)); return; }
        catch { /* sin el MOC a mano se sigue directo a la OT */ }
      }
      finish(done);
    } catch (e) {
      setAlertMsg(e instanceof ApiError ? e.message : t("wo.wizard.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  // ── Copiloto: los pasos de elección se pueden cargar desde el panel ───────
  const assistBase = { module: "WORK_ORDERS", title: t("dashboard.newWorkOrder"), vesselCode };
  let assist: CopilotAssistSpec | null = null;
  if (!mocToEdit && step === "kind") {
    assist = { ...assistBase, screen: "WO_WIZARD_NEW_ASSET_KIND", fields: [{
      key: "kind", label: t("newAsset.kindTitle"), value: kind,
      options: (["ADD", "REPLACE"] as Kind[]).map(k => ({ value: k, label: t(`newAsset.kind.${k}` as TranslationKey) })),
      set: v => chooseKind(v as Kind),
    }] };
  } else if (!mocToEdit && step === "pickOld" && assets) {
    assist = { ...assistBase, screen: "WO_WIZARD_NEW_ASSET_OLD", fields: [{
      key: "replacesAssetId", label: t("newAsset.oldTitle"), value: null,
      options: assets.map(a => ({ value: a.id, label: a.name ?? a.assetCode, aliases: [a.assetCode] })),
      set: chooseOld,
    }] };
  } else if (!mocToEdit && step === "moc") {
    assist = { ...assistBase, screen: "WO_WIZARD_NEW_ASSET_MOC", fields: [{
      key: "mocMode", label: t("newAsset.mocTitle"), value: mocMode,
      hint: mocAdvice.why,
      options: (["NEW", "EXISTING", "NOT_REQUIRED"] as MocMode[]).map(m => ({ value: m, label: t(`newAsset.moc.${m}` as TranslationKey) })),
      set: v => { setMocMode(v as MocMode); setMocTouched(true); },
    }] };
  }
  useCopilotAssist(assist);

  if (mocToEdit && created) {
    return (
      <MocModal
        moc={mocToEdit}
        onClose={() => { setMocToEdit(null); finish(created); }}
        onSaved={() => { setMocToEdit(null); finish(created); }}
      />
    );
  }

  // ── Piezas de la pantalla ─────────────────────────────────────────────────
  const stepLabels = (["wo.wizard.step.category", "wo.wizard.step.vessel", "wo.wizard.step.asset", "wo.wizard.step.moc", "wo.wizard.step.tasks", "wo.wizard.step.confirm"] as TranslationKey[]).map(k => t(k));
  const changeBtn = (onClick: () => void) => (
    <button type="button" onClick={onClick} className="text-[11px] font-semibold text-accent hover:text-fg transition-colors">{t("wo.wizard.change")}</button>
  );
  const question = (title: string, subtitle?: string) => (
    <>
      <p className="text-[17px] font-extrabold text-fg mt-1">{title}</p>
      {subtitle && <p className="text-xs text-text-industrial/60 mt-1 mb-4">{subtitle}</p>}
    </>
  );
  const banner = (tone: "info" | "ok" | "warn", icon: React.ReactNode, children: React.ReactNode, extra = "") => (
    <div className={`flex gap-2.5 rounded-xl border px-3 py-2.5 text-xs leading-relaxed text-fg ${extra} ${
      tone === "info" ? "border-accent/20 bg-accent/5" : tone === "ok" ? "border-success-sea/25 bg-success-sea/5" : "border-amber-500/30 bg-amber-500/5"
    }`}>
      <span className={`shrink-0 mt-px ${tone === "info" ? "text-accent" : tone === "ok" ? "text-success-sea" : "text-amber-600"}`}>{icon}</span>
      <span>{children}</span>
    </div>
  );
  const loading = (
    <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-3">
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
    </div>
  );
  const needTag = (on: boolean) => on ? <GuideNeedTag label={t("mp.guide.missing")} /> : null;

  const chips = (
    <div className="flex flex-wrap gap-1.5 mb-3.5">
      <span className={chipCls}>{t("wo.wizard.cat.NEW_ASSET")} {changeBtn(onChangeCategory)}</span>
      <span className={chipCls}><Ship className="w-3 h-3" /><b className="font-bold">{vesselName}</b>{canChangeVessel && changeBtn(onChangeVessel)}</span>
      {kind === "REPLACE" && old && step !== "kind" && step !== "pickOld" && (
        <span className={chipCls}><LogOut className="w-3 h-3" />{t("newAsset.chipOut")} <b className="font-bold">{oldName}</b>{changeBtn(() => setStep("kind"))}</span>
      )}
      {(step === "moc" || step === "tasks" || step === "confirm") && (
        <span className={chipCls}>
          <LogIn className="w-3 h-3" />{kind === "ADD" ? t("newAsset.chipAdd") : t("newAsset.chipIn")} <b className="font-bold">{form.name}</b>
          {newMm && <span className="text-text-industrial/50">{newMm}</span>}
          {changeBtn(() => setStep("data"))}
        </span>
      )}
    </div>
  );

  // ── Pasos ─────────────────────────────────────────────────────────────────
  let body: React.ReactNode = null;
  let next: React.ReactNode = null;

  if (step === "kind") {
    body = (
      <>
        {question(t("newAsset.kindTitle"), t("newAsset.kindSubtitle"))}
        <div className="space-y-2.5">
          <OptionCard icon={Plus} title={t("newAsset.kind.ADD")} desc={t("newAsset.kindDesc.ADD")} highlight={kind === "ADD"} onClick={() => chooseKind("ADD")} />
          <OptionCard icon={Repeat} tone="warning" title={t("newAsset.kind.REPLACE")} desc={t("newAsset.kindDesc.REPLACE")} highlight={kind === "REPLACE"} onClick={() => chooseKind("REPLACE")} />
        </div>
      </>
    );
  }

  if (step === "pickOld") {
    const q = norm(oldQuery);
    const list = (assets ?? []).filter(a => !q || norm(`${a.name ?? ""} ${a.assetCode}`).includes(q));
    body = (
      <>
        {question(t("newAsset.oldTitle"), t("newAsset.oldSubtitle"))}
        {assets === null ? loading : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-text-industrial/40" />
              <input autoFocus value={oldQuery} onChange={e => setOldQuery(e.target.value)} placeholder={t("wo.wizard.assetSearch")}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50" />
            </div>
            <div className="mt-2.5 border border-fg/10 rounded-xl divide-y divide-fg/10 max-h-[45vh] overflow-y-auto">
              {list.length === 0 ? (
                <p className="px-3 py-2.5 text-xs text-text-industrial/40">{t("wo.wizard.noMatches")}</p>
              ) : list.map(a => (
                <button key={a.id} type="button" onClick={() => chooseOld(a.id)}
                  className="flex items-center gap-2.5 w-full text-left px-3 py-2.5 text-sm text-fg hover:bg-accent/5 transition-colors">
                  <Cog className="w-4 h-4 text-text-industrial/40 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold truncate">{a.name ?? a.assetCode}</span>
                    <span className="block text-[11px] text-text-industrial/55 truncate">
                      {makerModel(a.manufacturer, a.model) || t("newAsset.noMakerModel")} · {fill(t("newAsset.tasksInPlan"), { n: activePlansByAsset.get(a.id)?.length ?? 0 })}
                    </span>
                  </span>
                  <span className="font-mono text-[11px] text-text-industrial/40 shrink-0">{a.assetCode}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </>
    );
  }

  if (step === "data") {
    const oldMm = old ? makerModel(old.manufacturer, old.model) : "";
    body = (
      <>
        {question(t("newAsset.dataTitle"), kind === "REPLACE" ? undefined : t("newAsset.dataSubtitle"))}
        {kind === "REPLACE" && old && banner("info", <Copy className="w-4 h-4" />, fill(t("newAsset.prefilled"), { asset: oldName, code: old.assetCode }), "mt-3 mb-3.5")}
        <section className="rounded-2xl border border-fg/10 px-4 py-3.5 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-[11px] font-bold text-text-industrial/60 uppercase tracking-wider">{t("newAsset.secId")}</h3>
            <GuidePill missing={missing.length} completeLabel={t("mp.guide.complete")} missingOne={t("mp.guide.missingOne")} missingMany={t("mp.guide.missingMany")} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <GuideField id="na-group" missing={!form.group}>
              <label className={labelCls}>{t("newAsset.f.group")}<RequiredMark />{needTag(!form.group)}</label>
              <select value={form.group} onChange={e => updateForm({ group: e.target.value })} className={inputCls}>
                <option value="">{t("newAsset.f.groupPh")}</option>
                {SFI_GROUPS.map(g => <option key={g} value={g}>{g} - {t(`sfi.g.${g}` as TranslationKey)}</option>)}
              </select>
            </GuideField>
            <GuideField id="na-code" missing={!form.code.trim()}>
              <label className={labelCls}>
                {t("newAsset.f.code")}<RequiredMark />{needTag(!form.code.trim())}
                {form.code && !form.codeTouched && <span className="ml-2 normal-case tracking-normal font-normal text-text-industrial/45">{t("newAsset.f.codeSuggested")}</span>}
              </label>
              <input value={form.code} onChange={e => updateForm({ code: e.target.value, codeTouched: true })} className={`${inputCls} font-mono`} />
            </GuideField>
          </div>
          <GuideField id="na-name" missing={!form.name.trim()}>
            <label className={labelCls}>{t("newAsset.f.name")}<RequiredMark />{needTag(!form.name.trim())}</label>
            <input value={form.name} onChange={e => updateForm({ name: e.target.value })} placeholder={t("newAsset.f.namePh")} className={inputCls} />
          </GuideField>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className={labelCls}>{t("newAsset.f.maker")}</label><input value={form.maker} onChange={e => updateForm({ maker: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>{t("newAsset.f.model")}</label><input value={form.model} onChange={e => updateForm({ model: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>{t("newAsset.f.serial")}</label><input value={form.serial} onChange={e => updateForm({ serial: e.target.value })} className={inputCls} /></div>
          </div>
          {kind === "REPLACE" && oldMm && (
            <p className="flex items-center gap-1.5 text-[11px] text-text-industrial/60">
              <Info className="w-3.5 h-3.5 shrink-0" /> {fill(t("newAsset.oldIs"), { mm: oldMm })}
              <button type="button" onClick={() => updateForm({ maker: old?.manufacturer ?? "", model: old?.model ?? "" })}
                className="font-semibold text-accent hover:text-fg transition-colors">{t("newAsset.sameModel")}</button>
            </p>
          )}
        </section>
        <section className="rounded-2xl border border-fg/10 px-4 py-3.5 space-y-3 mt-3">
          <h3 className="text-[11px] font-bold text-text-industrial/60 uppercase tracking-wider">{t("newAsset.secCrit")}</h3>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className={labelCls + " mb-0"}>{t("col.criticality")}</span>
              <button type="button" onClick={() => void requestCriticality()} disabled={!form.name.trim() || suggesting}
                className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/5 px-2.5 py-0.5 text-[11px] font-bold text-accent hover:bg-accent/10 disabled:opacity-40 transition-colors">
                {suggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} {t("mp.guide.suggestAi")}
              </button>
            </div>
            <div className="flex gap-1.5">
              {(["A", "B", "C"] as Crit[]).map(c => (
                <button key={c} type="button" onClick={() => updateForm({ crit: c })}
                  className={`w-11 py-1.5 rounded-xl border-[1.5px] text-xs font-bold transition-colors ${form.crit === c ? CRIT_ON[c] : "bg-fg/5 border-fg/10 text-fg hover:border-accent/40"}`}>
                  {c}
                </button>
              ))}
            </div>
            {form.rationale && <p className="text-[11px] text-text-industrial/60 mt-1.5">{form.rationale}</p>}
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer text-sm text-fg">
            <input type="checkbox" checked={form.safety} onChange={e => updateForm({ safety: e.target.checked })} className="mt-0.5 w-4 h-4 accent-accent" />
            <span>
              <span className="font-bold">{t("newAsset.safety")}</span>
              <span className="block text-[11px] text-text-industrial/60">{t("newAsset.safetyHelp")}</span>
            </span>
          </label>
        </section>
      </>
    );
    next = <NextButton label={t("newAsset.next")} onClick={goToMoc} />;
  }

  if (step === "moc") {
    const card =(mode: MocMode, content: React.ReactNode, recommended: boolean) => {
      const on = mocMode === mode;
      return (
        <div className={`rounded-2xl border-[1.5px] transition-colors ${on ? "border-accent bg-accent/[0.03]" : "border-fg/10"}`}>
          <button type="button" onClick={() => { setMocMode(mode); setMocTouched(true); }} className="flex items-start gap-3 w-full text-left px-3.5 py-3">
            <span className={`mt-0.5 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 ${on ? "border-accent" : "border-fg/25"}`}>
              {on && <span className="w-2 h-2 rounded-full bg-accent" />}
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold text-fg">
                {t(`newAsset.moc.${mode}` as TranslationKey)}
                {recommended && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">{t("newAsset.recommended")}</span>}
              </span>
              <span className="block text-xs text-text-industrial/60 mt-0.5">{t(`newAsset.mocDesc.${mode}` as TranslationKey)}</span>
            </span>
          </button>
          {on && content && <div className="pl-11 pr-3.5 pb-3.5">{content}</div>}
        </div>
      );
    };
    const sameCls = (a?: string | null, b?: string) => norm(a) && norm(a) === norm(b) ? "text-success-sea font-bold" : "text-amber-700 dark:text-amber-400 font-bold";
    body = (
      <>
        {question(t("newAsset.mocTitle"))}
        {banner(mocAdvice.needs ? "warn" : "ok", mocAdvice.needs ? <GitBranch className="w-4 h-4" /> : <CircleCheck className="w-4 h-4" />,
          <><b className="font-bold">{mocAdvice.needs ? t("newAsset.mocNeeds") : t("newAsset.mocNotNeeds")}</b> {mocAdvice.why}</>, "mt-3 mb-3")}
        {kind === "REPLACE" && old && (
          <table className="w-full text-xs mb-3">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-industrial/45">
                <th className="text-left font-bold px-2 py-1" />
                <th className="text-left font-bold px-2 py-1">{t("newAsset.chipOut")}</th>
                <th className="text-left font-bold px-2 py-1">{t("newAsset.chipIn")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-fg/10">
                <td className="px-2 py-1.5 text-text-industrial/60">{t("newAsset.f.maker")}</td>
                <td className="px-2 py-1.5">{old.manufacturer || "—"}</td>
                <td className={`px-2 py-1.5 ${sameCls(old.manufacturer, form.maker)}`}>{form.maker || "—"}</td>
              </tr>
              <tr className="border-t border-fg/10">
                <td className="px-2 py-1.5 text-text-industrial/60">{t("newAsset.f.model")}</td>
                <td className="px-2 py-1.5">{old.model || "—"}</td>
                <td className={`px-2 py-1.5 ${sameCls(old.model, form.model)}`}>{form.model || "—"}</td>
              </tr>
            </tbody>
          </table>
        )}
        <div className="space-y-2.5">
          {card("NEW", (
            <GuideField id="na-moc-reason" missing={!mocReason.trim()}>
              <label className={labelCls}>{t("newAsset.mocReason")}<RequiredMark />{needTag(!mocReason.trim())}</label>
              <textarea rows={2} value={mocReason} onChange={e => setMocReason(e.target.value)} placeholder={t("newAsset.mocReasonPh")} className={`${inputCls} resize-y`} />
            </GuideField>
          ), mocAdvice.needs)}
          {card("EXISTING", mocs === null ? loading : mocs.length === 0 ? (
            <p className="rounded-xl border-[1.5px] border-dashed border-fg/20 px-3 py-3 text-center text-xs text-text-industrial/60">{t("newAsset.mocNone")}</p>
          ) : (
            <div className="space-y-1.5">
              {mocs.map(m => (
                <button key={m.id} type="button" onClick={() => setMocId(m.id)}
                  className={`flex items-center gap-2.5 w-full text-left rounded-xl border-[1.5px] px-3 py-2 text-xs text-fg transition-colors ${mocId === m.id ? "border-accent bg-accent/5" : "border-fg/10 hover:border-accent/40"}`}>
                  <span className="font-mono font-bold text-[11px] shrink-0">{m.mocCode}</span>
                  <span className="flex-1 min-w-0 truncate">{m.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${MOC_APPROVED.has(m.status) ? "bg-success-sea/10 text-success-sea" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
                    {mocStatusLabel(m.status)}
                  </span>
                </button>
              ))}
              <p className="text-[11px] text-text-industrial/60 pt-0.5">{t("newAsset.mocExistingNote")}</p>
            </div>
          ), false)}
          {card("NOT_REQUIRED", (
            <div className="space-y-2.5">
              <GuideField id="na-moc-notreq" missing={!notReq.trim()}>
                <label className={labelCls}>{t("newAsset.notReqReason")}<RequiredMark />{needTag(!notReq.trim())}</label>
                <textarea rows={2} value={notReq} onChange={e => setNotReq(e.target.value)} className={`${inputCls} resize-y`} />
              </GuideField>
              {mocAdvice.needs && banner("warn", <AlertTriangle className="w-4 h-4" />, t("newAsset.notReqWarn"))}
            </div>
          ), !mocAdvice.needs)}
        </div>
      </>
    );
    next = <NextButton label={t("newAsset.next")} onClick={() => void goToTasks()} />;
  }

  if (step === "tasks") {
    const srcAsset = tsrc === "FLEET" && tsrcAsset ? (fleet ?? []).find(a => a.id === tsrcAsset) ?? null : null;
    const sourceBtn = (src: TaskSource, label: string, icon: React.ReactNode) => (
      <button type="button" onClick={() => selectSource(src, fleetMatches)}
        className={`inline-flex items-center gap-1.5 rounded-xl border-[1.5px] px-3 py-1.5 text-xs font-semibold transition-colors ${tsrc === src ? "border-accent bg-accent/10 text-accent" : "border-fg/10 bg-fg/5 text-fg hover:border-accent/40"}`}>
        {icon} {label}
      </button>
    );
    let content: React.ReactNode;
    if (tsrc === "NONE") {
      content = banner("warn", <AlertTriangle className="w-4 h-4" />, t("newAsset.noneWarn"));
    } else if (tsrc === "FLEET" && !tsrcAsset) {
      content = !newMm ? (
        <p className="rounded-xl border-[1.5px] border-dashed border-fg/20 px-3 py-3 text-center text-xs text-text-industrial/60">{t("newAsset.fleetNoModel")}</p>
      ) : fleetMatches.length === 0 ? (
        <p className="rounded-xl border-[1.5px] border-dashed border-fg/20 px-3 py-3 text-center text-xs text-text-industrial/60">{fill(t("newAsset.fleetNone"), { mm: newMm })}</p>
      ) : (
        <>
          <p className="text-[11px] text-text-industrial/60 mb-1.5">{fill(t("newAsset.fleetIntro"), { mm: newMm })}</p>
          <div className="border border-fg/10 rounded-xl divide-y divide-fg/10 max-h-[40vh] overflow-y-auto">
            {fleetMatches.map(a => (
              <button key={a.id} type="button" onClick={() => void pickFleetAsset(a.id)}
                className="flex items-center gap-2.5 w-full text-left px-3 py-2.5 text-sm text-fg hover:bg-accent/5 transition-colors">
                <Ship className="w-4 h-4 text-text-industrial/40 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold truncate">{a.name ?? a.assetCode}</span>
                  <span className="block text-[11px] text-text-industrial/55">{vesselLabel(a.vesselCode)}</span>
                </span>
                <span className="font-mono text-[11px] text-text-industrial/40 shrink-0">{a.assetCode}</span>
              </button>
            ))}
          </div>
        </>
      );
    } else if (loadingSrc || srcPlans === null) {
      content = loading;
    } else if (srcPlans.length === 0) {
      content = <p className="rounded-xl border-[1.5px] border-dashed border-fg/20 px-3 py-3 text-center text-xs text-text-industrial/60">{t("newAsset.srcEmpty")}</p>;
    } else {
      content = (
        <>
          {srcAsset && (
            <p className="text-[11px] text-text-industrial/60 mb-2">
              {fill(t("newAsset.from"), { asset: srcAsset.name ?? srcAsset.assetCode, vessel: vesselLabel(srcAsset.vesselCode) })}
              {fleetMatches.length > 1 && <> · <button type="button" onClick={() => { setTsrcAsset(null); setSrcPlans(null); }} className="font-semibold text-accent hover:text-fg">{t("newAsset.pickOther")}</button></>}
            </p>
          )}
          <div className="border border-fg/10 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-3 py-2 bg-fg/5 text-[11px] font-semibold text-text-industrial/60">
              <span className="flex-1">{fill(t("newAsset.checkedN"), { n: selectedPlans.length, total: srcPlans.length })}</span>
              <button type="button" onClick={() => setChecked(new Set(srcPlans.map(p => p.id)))} className="text-accent hover:text-fg">{t("newAsset.checkAll")}</button>
              <button type="button" onClick={() => setChecked(new Set())} className="text-accent hover:text-fg">{t("newAsset.checkNone")}</button>
            </div>
            <div className="divide-y divide-fg/10 max-h-[40vh] overflow-y-auto">
              {srcPlans.map(p => {
                const on = checked.has(p.id);
                return (
                  <label key={p.id} className={`flex items-start gap-2.5 px-3 py-2 text-[13px] text-fg cursor-pointer ${on ? "" : "opacity-50"}`}>
                    <input type="checkbox" checked={on} className="mt-1 w-4 h-4 accent-accent"
                      onChange={e => setChecked(prev => { const s = new Set(prev); if (e.target.checked) s.add(p.id); else s.delete(p.id); return s; })} />
                    <span className="flex-1 min-w-0">
                      <span className="block font-mono text-[11px] text-text-industrial/45">{p.taskCode}</span>
                      {p.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-text-industrial/60 whitespace-nowrap">{fmtFreq(p)}</span>
                  </label>
                );
              })}
            </div>
          </div>
          {srcAsset && srcAsset.vesselCode !== vesselCode && (
            <p className="flex items-start gap-1.5 text-[11px] text-text-industrial/60 mt-2"><Info className="w-3.5 h-3.5 shrink-0 mt-px" /> {t("newAsset.otherVesselNote")}</p>
          )}
        </>
      );
    }
    body = (
      <>
        {question(t("newAsset.tasksTitle"), t("newAsset.tasksSubtitle"))}
        {banner("info", <Hourglass className="w-4 h-4" />, t("newAsset.tasksWaiting"), "mb-3")}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {kind === "REPLACE" && sourceBtn("OLD", fill(t("newAsset.src.OLD"), { n: oldId ? activePlansByAsset.get(oldId)?.length ?? 0 : 0 }), <Repeat className="w-3.5 h-3.5" />)}
          {sourceBtn("FLEET", fill(t("newAsset.src.FLEET"), { n: fleetMatches.length }), <Ship className="w-3.5 h-3.5" />)}
          {sourceBtn("NONE", t("newAsset.src.NONE"), <CircleSlash className="w-3.5 h-3.5" />)}
        </div>
        {content}
      </>
    );
    next = <NextButton label={t("newAsset.next")} onClick={goToConfirm} />;
  }

  if (step === "confirm") {
    const row = (k: string, v: React.ReactNode, sub?: React.ReactNode) => (
      <div className="flex gap-3 px-3.5 py-2.5 border-t border-fg/10 first:border-t-0 text-[13px] text-fg">
        <span className="w-28 shrink-0 pt-0.5 text-[11px] font-bold uppercase tracking-wider text-text-industrial/60">{k}</span>
        <span className="flex-1 min-w-0">{v}{sub && <span className="block text-[11px] text-text-industrial/60 mt-0.5">{sub}</span>}</span>
      </div>
    );
    const assetSub = [
      newMm || t("newAsset.noMakerModel"),
      form.serial.trim() && fill(t("newAsset.sum.serial"), { s: form.serial.trim() }),
      fill(t("newAsset.sum.crit"), { c: form.crit }),
      form.safety && t("newAsset.safety"),
    ].filter(Boolean).join(" · ");
    const mocLine = mocMode === "NEW"
      ? { v: t("newAsset.sum.mocNew"), s: fill(t("newAsset.sum.reason"), { r: mocReason.trim() }) }
      : mocMode === "EXISTING" && chosenMoc
        ? { v: `${chosenMoc.mocCode} · ${chosenMoc.title}`, s: fill(t("newAsset.sum.mocState"), { s: mocStatusLabel(chosenMoc.status) }) + (MOC_APPROVED.has(chosenMoc.status) ? "" : ` — ${t("newAsset.sum.mocPending")}`) }
        : { v: t("newAsset.moc.NOT_REQUIRED"), s: fill(t("newAsset.sum.reason"), { r: notReq.trim() }) };
    const oldPlans = oldId ? activePlansByAsset.get(oldId)?.length ?? 0 : 0;
    body = (
      <>
        {question(t("newAsset.confirmTitle"))}
        <div className="rounded-2xl border border-fg/10 mt-3 mb-3">
          {row(t("newAsset.sum.asset"), <><b className="font-bold">{form.name.trim()}</b> <span className="font-mono text-[11px] text-text-industrial/45">{form.code.trim().toUpperCase()}</span></>, assetSub)}
          {kind === "REPLACE" && old && row(t("newAsset.sum.replaces"), <b className="font-bold">{oldName}</b>,
            [old.assetCode, makerModel(old.manufacturer, old.model), fill(t("newAsset.sum.replacesDetail"), { n: oldPlans })].filter(Boolean).join(" · "))}
          {row(t("newAsset.sum.moc"), mocLine.v, mocLine.s)}
          {row(t("newAsset.sum.tasks"), selectedPlans.length ? fill(t("newAsset.sum.tasksN"), { n: selectedPlans.length }) : t("newAsset.src.NONE"))}
          {row(t("newAsset.sum.wo"), woTitle, fill(t("newAsset.sum.woDetail"), { vessel: vesselName }))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-accent/20 bg-accent/5 px-3 py-2.5 text-xs text-fg">
            <p className="flex items-center gap-1.5 font-bold mb-1.5"><CirclePlay className="w-3.5 h-3.5 text-accent" /> {t("newAsset.now")}</p>
            <ul className="list-disc pl-4 space-y-0.5 leading-relaxed">
              <li>{t("newAsset.now.asset")}</li>
              {selectedPlans.length > 0 && <li>{fill(t("newAsset.now.tasks"), { n: selectedPlans.length })}</li>}
              <li>{t("newAsset.now.wo")}</li>
              {mocMode === "NEW" && <li>{t("newAsset.now.mocNew")}</li>}
              {mocMode === "EXISTING" && <li>{t("newAsset.now.mocExisting")}</li>}
              {kind === "REPLACE" && old && <li>{fill(t("newAsset.now.oldKeeps"), { asset: oldName })}</li>}
            </ul>
          </div>
          <div className="rounded-xl border border-success-sea/25 bg-success-sea/5 px-3 py-2.5 text-xs text-fg">
            <p className="flex items-center gap-1.5 font-bold mb-1.5"><Flag className="w-3.5 h-3.5 text-success-sea" /> {t("newAsset.later")}</p>
            <ul className="list-disc pl-4 space-y-0.5 leading-relaxed">
              {selectedPlans.length > 0 && <li>{t("newAsset.later.tasks")}</li>}
              <li>{t("newAsset.later.installDate")}</li>
              {kind === "REPLACE" && old && <li>{fill(t("newAsset.later.oldOut"), { asset: oldName })}</li>}
              {kind === "REPLACE" && old && <li>{t("newAsset.later.coverage")}</li>}
              {mocMode !== "NOT_REQUIRED" && <li>{t("newAsset.later.mocCheck")}</li>}
            </ul>
          </div>
        </div>
      </>
    );
    next = (
      <button type="button" onClick={() => void create()} disabled={creating}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-45 transition-all">
        {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CircleCheck className="w-3.5 h-3.5" />}
        {creating ? t("newAsset.creating") : t("newAsset.create")}
      </button>
    );
  }

  return (
    <>
      {/* Sin cierre al tocar el fondo: acá se cargan datos y un clic de más los perdería. */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className={`w-full ${step === "confirm" ? "max-w-3xl" : "max-w-2xl"} bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col`}
          role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-fg/10 shrink-0">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-bold text-fg">
                <Wrench className="w-4 h-4 text-accent" /> {t("dashboard.newWorkOrder")}
              </h2>
              <WizardStepper labels={stepLabels} current={STEP_INDEX[step]} />
            </div>
            <ModalCloseButton onClose={onClose} />
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {chips}
            {body}
          </div>
          <div className="flex items-center gap-2 px-6 py-3.5 border-t border-fg/10 shrink-0">
            <button type="button" onClick={goBack} disabled={creating}
              className="px-3.5 py-2 rounded-xl text-xs text-fg hover:bg-fg/5 transition-colors">
              {t("wo.wizard.back")}
            </button>
            <span className="flex-1" />
            {next}
          </div>
        </div>
      </div>
      {alertMsg && <AlertDialog message={alertMsg} onClose={() => setAlertMsg(null)} />}
    </>
  );
};

const NextButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button type="button" onClick={onClick}
    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 transition-all">
    {label} <span aria-hidden="true">›</span>
  </button>
);
