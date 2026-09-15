// Nueva OT (y SS si lo hace un taller) → mandar a aprobar. Tres pasos:
//   1. ¿Qué pasa?        equipo, qué hay que hacer (texto, dictado, fotos), tipo y plazo
//   2. ¿Quién lo hace?   la tripulación, o un taller: proveedor y tipo de solicitud
//   3. Datos para aprobar solicitado por, sistema, ubicación, riesgo, LOTO y criterio
//
// Los recuadros son los del formulario REGI-MAN-02.3 (mismos valores que el alta
// de escritorio). La SS sale con el proveedor elegido y se envía junto con la
// OT; presupuestos, adjuntos y seguimiento del taller quedan para la PC.

import React, { useMemo, useState } from "react";
import { Users, Building2, Send, ArrowRight, Sparkles, Loader2, Search, Cog, UserCheck, Monitor, AlertTriangle, Info } from "lucide-react";
import { useT, useWoTerms } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useFetch } from "../lib/hooks";
import { api } from "../lib/api";
import { useVesselContext } from "../lib/vessel-context";
import { AlertDialog } from "../components/AlertDialog";
import {
  WO_REQUESTED_BY, WO_SYSTEM_AREAS, WO_MAINTENANCE_KINDS_OR_INSPECTION, WO_PRIORITY_FORM_LABELS,
} from "../lib/wo-form-catalog";
import {
  Screen, Head, Field, Chips, MainButton, DoneScreen, RadioRow, OptionCard, Note, inputCls, textareaCls, scrollToMissing,
} from "./ui";
import { DictateButton, PhotoButton, PhotoStrip, errorText, suggestWoSafety, type PickedPhoto } from "./shared";
import { LocationField, RiskButtons } from "./OnboardPlans";

interface AssetOption { id: string; assetCode: string; name: string | null }
interface ProviderOption { id: string; name: string; category?: string | null }

const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const SR_KINDS = [
  { value: "NORMAL", key: "ob.srKind.normal" },
  { value: "AFECTA SEGURIDAD", key: "ob.srKind.safety" },
  { value: "AFECTA SERVICIO", key: "ob.srKind.service" },
] as const;

/** Título de la OT: la primera oración de lo que hay que hacer, sin pasarse de largo. */
function titleFrom(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0] ?? "";
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
}

export const OnboardNewWorkOrder: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const [round, setRound] = useState(0);
  return <NewWorkOrderFlow key={round} onExit={onExit} onAgain={() => setRound(r => r + 1)} />;
};

function NewWorkOrderFlow({ onExit, onAgain }: { onExit: () => void; onAgain: () => void }) {
  const t = useT();
  const woTerms = useWoTerms();
  const { user } = useAuth();
  const { selectedVesselCode, selectedVessel } = useVesselContext();

  const assets = useFetch<{ items: AssetOption[] }>("/app/pms/assets?limit=500");
  const providers = useFetch<{ items: ProviderOption[] }>("/app/providers?status=ACTIVE");

  const [step, setStep] = useState(1);
  const [tried, setTried] = useState(false);
  // Paso 1
  const [assetQuery, setAssetQuery] = useState("");
  const [asset, setAsset] = useState<AssetOption | null>(null);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [kind, setKind] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  // Paso 2
  const [who, setWho] = useState<"TRIPULACION" | "TERCERIZADO" | null>(null);
  const [providerQuery, setProviderQuery] = useState("");
  const [provider, setProvider] = useState<ProviderOption | null>(null);
  const [srKinds, setSrKinds] = useState<string[]>([]);
  // Paso 3
  const [requestedBy, setRequestedBy] = useState<string | null>(null);
  const [system, setSystem] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [risk, setRisk] = useState<string | null>(null);
  const [lotoNeeded, setLotoNeeded] = useState<boolean | null>(null);
  const [loto, setLoto] = useState("");
  const [criteria, setCriteria] = useState("");

  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [done, setDone] = useState<{ woCode: string; srCode: string | null; warnings: string[] } | null>(null);

  const filteredAssets = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    const list = assets.data?.items ?? [];
    return (q ? list.filter(a => `${a.name ?? ""} ${a.assetCode}`.toLowerCase().includes(q)) : list).slice(0, 40);
  }, [assets.data, assetQuery]);
  const filteredProviders = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    const list = providers.data?.items ?? [];
    return (q ? list.filter(p => `${p.name} ${p.category ?? ""}`.toLowerCase().includes(q)) : list).slice(0, 40);
  }, [providers.data, providerQuery]);

  const missing1 = { asset: !asset, text: !text.trim(), kind: !kind, priority: !priority };
  const missing2 = { who: !who, provider: who === "TERCERIZADO" && !provider, srKinds: who === "TERCERIZADO" && srKinds.length === 0 };
  const missing3 = {
    requestedBy: !requestedBy, system: !system, location: !location.trim(), risk: !risk,
    loto: lotoNeeded === null || (lotoNeeded && !loto.trim()), criteria: !criteria.trim(),
  };
  const missingNow = Object.values(step === 1 ? missing1 : step === 2 ? missing2 : missing3).filter(Boolean).length;
  const miss = (m: Record<string, boolean>, k: string) => tried && m[k];

  const taskType = kind === "INSPECTION" ? "INSPECTION" : kind === "PREVENTIVO" || kind === "PREDICTIVO" ? "PREVENTIVE" : "CORRECTIVE";

  const askAi = async () => {
    setAiBusy(true);
    try {
      const r = await suggestWoSafety({
        assetLabel: asset?.name ?? asset?.assetCode ?? null, vesselCode: selectedVesselCode, taskDesc: text.trim(), taskType,
        want: { criteria: !criteria.trim(), loto: lotoNeeded === true && !loto.trim(), risk: !risk },
      });
      if (r.criteria) setCriteria(r.criteria);
      if (r.loto) setLoto(r.loto);
      if (r.risk) setRisk(r.risk);
    } catch (e) {
      setAlert(errorText(e, t("ob.aiFailed")));
    } finally {
      setAiBusy(false);
    }
  };

  const next = () => {
    if (step < 3) { setStep(step + 1); setTried(false); return; }
    void send();
  };

  const send = async () => {
    if (!selectedVesselCode || !asset) return;
    setBusy(true);
    const name = user?.name ?? "";
    const warnings: string[] = [];
    const description = text.trim();
    let wo: { id: string; workOrderCode: string };
    try {
      wo = await api.post<{ id: string; workOrderCode: string }>("/app/pms/work-orders", {
        vesselCode: selectedVesselCode,
        assetId: asset.id,
        ...(kind === "INSPECTION" ? { type: "INSPECTION" } : { maintenanceKind: kind }),
        priority,
        title: titleFrom(description),
        description,
        requestedByArea: requestedBy,
        assignedToArea: who,
        systemArea: system,
        location: location.trim(),
        riskLevel: risk,
        loto: lotoNeeded ? loto.trim() : t("ob.lotoNotRequired"),
        acceptanceCriteria: criteria.trim(),
        ...(who === "TERCERIZADO" && provider ? { providerId: provider.id } : {}),
      });
    } catch (e) {
      setBusy(false);
      setAlert(errorText(e, t("ob.sendFailed")));
      return;
    }

    // Fotos: adjuntas a la OT. Si una falla la OT ya quedó; se avisa.
    for (const p of photos) {
      try { await api.upload(`/app/attachments/upload?entityType=WorkOrder&entityId=${wo.id}`, p.file); }
      catch { warnings.push(t("ob.warn.photo").replace("{name}", p.file.name)); }
    }

    let srCode: string | null = null;
    if (who === "TERCERIZADO" && provider) {
      try {
        const sr = await api.post<{ id: string; serviceRequestCode?: string }>(`/app/pms/work-orders/${wo.id}/service-requests`, {
          providerId: provider.id,
          title: titleFrom(description),
          description,
          priority,
          purchaseRequestKinds: srKinds,
        });
        srCode = sr.serviceRequestCode ?? null;
        await api.post(`/app/pms/service-requests/${sr.id}/submit`, { name });
      } catch (e) {
        warnings.push(t("ob.warn.srFailed").replace("{msg}", errorText(e, "")));
      }
    }

    try {
      await api.post(`/app/pms/work-orders/${wo.id}/approval`, { step: "ENVIA", name });
    } catch (e) {
      warnings.push(t("ob.warn.woNotSent").replace("{code}", wo.workOrderCode).replace("{msg}", errorText(e, "")));
    }
    photos.forEach(p => URL.revokeObjectURL(p.preview));
    setBusy(false);
    setDone({ woCode: wo.workOrderCode, srCode, warnings });
  };

  if (done) {
    const withSr = !!done.srCode;
    return (
      <DoneScreen
        icon={<Send className="w-10 h-10" />}
        title={(done.warnings.length ? t("ob.done.woOpened") : withSr ? t("ob.done.woSrSent") : t("ob.done.woSent")).replace("{wo}", woTerms.abbr)}
        code={[done.woCode, done.srCode].filter(Boolean).join(" · ")}
        lines={[
          { icon: <Cog className="w-[17px] h-[17px]" />, text: `${asset?.name ?? asset?.assetCode ?? ""} · ${priority ? WO_PRIORITY_FORM_LABELS[priority] : ""}` },
          ...(withSr && provider ? [{ icon: <Building2 className="w-[17px] h-[17px]" />, text: t("ob.done.srFor").replace("{name}", provider.name) }] : []),
          ...done.warnings.map(w => ({ icon: <AlertTriangle className="w-[17px] h-[17px]" />, text: w })),
          { icon: <UserCheck className="w-[17px] h-[17px]" />, text: t("ob.done.approver") },
          { icon: <Monitor className="w-[17px] h-[17px]" />, text: withSr ? t("ob.done.restSr") : t("ob.done.restWo") },
        ]}
        onHome={onExit}
        again={{ label: t("ob.done.anotherWo"), onClick: onAgain }}
      />
    );
  }

  const stepNames = [t("ob.newWo.step1"), t("ob.newWo.step2"), t("ob.newWo.step3")];
  const last = step === 3;

  return (
    <Screen
      scrollKey={step}
      head={<Head
        title={step === 1 ? t("ob.tile.newWo").replace("{wo}", woTerms.abbr) : stepNames[step - 1]!}
        sub={t("ob.stepOf").replace("{n}", String(step)).replace("{name}", stepNames[step - 1]!)}
        step={step}
        onBack={() => { if (step > 1) { setStep(step - 1); setTried(false); } else onExit(); }}
      />}
      foot={<>
        <MainButton missing={missingNow} busy={busy}
          label={last ? t("ob.sendApproval") : t("ob.next")}
          icon={last ? <Send className="w-[18px] h-[18px]" /> : <ArrowRight className="w-[18px] h-[18px]" />}
          onClick={next} onMissing={() => { setTried(true); scrollToMissing(); }} />
        {last && <p className="text-center text-[12.5px] text-text-industrial/60">{t("ob.signsAs").replace("{name}", user?.name ?? "")}</p>}
      </>}
    >
      {step === 1 && <>
        <Field label={t("ob.asset")} missing={miss(missing1, "asset")}>
          {asset ? (
            <div className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-accent/10 border-[1.5px] border-accent">
              <Cog className="w-5 h-5 text-accent shrink-0" />
              <div className="min-w-0 flex-1"><b className="block text-[15px] font-bold">{asset.name ?? asset.assetCode}</b><span className="text-[12.5px] text-text-industrial/60">{selectedVessel?.name}</span></div>
              <button type="button" onClick={() => setAsset(null)} className="min-h-9 px-3 rounded-xl border border-fg/10 bg-surface text-[13px] font-semibold">{t("ob.change")}</button>
            </div>
          ) : <>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-industrial/40" />
              <input id="ob-asset-q" className={`${inputCls} pl-9`} value={assetQuery} onChange={e => setAssetQuery(e.target.value)} placeholder={t("ob.assetSearch")} />
            </div>
            {assets.loading && !assets.data ? <Loader2 className="w-5 h-5 animate-spin text-accent mx-auto" /> : (
              <div className="flex flex-col gap-2">
                {filteredAssets.map(a => <RadioRow key={a.id} on={false} onClick={() => setAsset(a)} title={a.name ?? a.assetCode} sub={a.name ? a.assetCode : null} />)}
                {filteredAssets.length === 0 && <p className="text-[13px] text-text-industrial/50 text-center py-3">{t("ob.noResults")}</p>}
              </div>
            )}
          </>}
        </Field>
        <Field label={t("ob.newWo.what")} missing={miss(missing1, "text")}>
          <textarea id="ob-wo-text" className={textareaCls} value={text} onChange={e => setText(e.target.value)} placeholder={t("ob.newWo.whatPh")} />
          <div className="flex gap-2">
            <DictateButton onText={chunk => setText(prev => [prev.trim(), chunk.trim()].filter(Boolean).join(" "))} />
            <PhotoButton photos={photos} onChange={setPhotos} />
          </div>
          <PhotoStrip photos={photos} onChange={setPhotos} />
        </Field>
        <Field label={t("ob.newWo.kind")} missing={miss(missing1, "kind")}>
          <Chips options={WO_MAINTENANCE_KINDS_OR_INSPECTION} value={kind} onChange={v => setKind(v === kind ? null : v)} />
        </Field>
        <Field label={t("ob.newWo.when")} missing={miss(missing1, "priority")}>
          <Chips options={PRIORITIES.map(p => ({ value: p, label: WO_PRIORITY_FORM_LABELS[p]! }))} value={priority} onChange={v => setPriority(v === priority ? null : v)} />
        </Field>
      </>}

      {step === 2 && <>
        <Field label={t("ob.newWo.who")} missing={miss(missing2, "who")}>
          <div className="grid grid-cols-2 gap-2.5">
            <OptionCard on={who === "TRIPULACION"} onClick={() => setWho("TRIPULACION")} icon={<Users className="w-[22px] h-[22px]" />}
              title={t("ob.newWo.crew")} sub={t("ob.newWo.crewSub").replace("{wo}", woTerms.abbr)} />
            <OptionCard on={who === "TERCERIZADO"} onClick={() => setWho("TERCERIZADO")} icon={<Building2 className="w-[22px] h-[22px]" />}
              title={t("ob.newWo.shop")} sub={t("ob.newWo.shopSub").replace("{wo}", woTerms.abbr)} />
          </div>
        </Field>
        {who === "TERCERIZADO" && <>
          <Field label={t("ob.provider")} missing={miss(missing2, "provider")}>
            {provider ? (
              <div className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-accent/10 border-[1.5px] border-accent">
                <Building2 className="w-5 h-5 text-accent shrink-0" />
                <div className="min-w-0 flex-1"><b className="block text-[15px] font-bold">{provider.name}</b>{provider.category && <span className="block text-[12.5px] text-text-industrial/60 truncate">{provider.category}</span>}</div>
                <button type="button" onClick={() => setProvider(null)} className="min-h-9 px-3 rounded-xl border border-fg/10 bg-surface text-[13px] font-semibold">{t("ob.change")}</button>
              </div>
            ) : <>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-industrial/40" />
                <input id="ob-provider-q" className={`${inputCls} pl-9`} value={providerQuery} onChange={e => setProviderQuery(e.target.value)} placeholder={t("ob.providerSearch")} />
              </div>
              <div className="flex flex-col gap-2">
                {filteredProviders.map(p => <RadioRow key={p.id} on={false} onClick={() => setProvider(p)} title={p.name} sub={p.category} />)}
                {!providers.loading && filteredProviders.length === 0 && <p className="text-[13px] text-text-industrial/50 text-center py-3">{t("ob.noResults")}</p>}
              </div>
            </>}
          </Field>
          <Field label={t("ob.srKind")} hint={t("ob.srKindHint")} missing={miss(missing2, "srKinds")}>
            <Chips options={SR_KINDS.map(k => ({ value: k.value, label: t(k.key) }))} value={srKinds}
              onChange={v => setSrKinds(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])} />
          </Field>
          <Note icon={<Info className="w-[17px] h-[17px] shrink-0 mt-px" />}>{t("ob.newWo.srNote")}</Note>
        </>}
      </>}

      {step === 3 && <>
        <Field label={t("wo.modal.requestedBy")} missing={miss(missing3, "requestedBy")}>
          <Chips options={WO_REQUESTED_BY} value={requestedBy} onChange={v => setRequestedBy(v === requestedBy ? null : v)} />
        </Field>
        <Field label={t("wo.modal.system")} missing={miss(missing3, "system")}>
          <Chips options={WO_SYSTEM_AREAS} value={system} onChange={v => setSystem(v === system ? null : v)} />
        </Field>
        <LocationField value={location} onChange={setLocation} missing={miss(missing3, "location")} />
        <Field label={t("ob.risk")} missing={miss(missing3, "risk")}>
          <RiskButtons value={risk} onChange={setRisk} />
        </Field>
        <Field label={t("ob.lotoQ")} missing={miss(missing3, "loto")}>
          <div className="flex gap-2">
            {[true, false].map(v => (
              <button key={String(v)} type="button" onClick={() => setLotoNeeded(v)} aria-pressed={lotoNeeded === v}
                className={`min-h-11 min-w-[96px] px-4 rounded-xl border-[1.5px] font-semibold text-[14.5px] ${lotoNeeded === v ? "bg-fg text-bg border-fg" : "bg-surface text-fg border-fg/10"}`}>
                {v ? t("ob.yes") : t("ob.no")}
              </button>
            ))}
          </div>
          {lotoNeeded && <textarea id="ob-wo-loto" className={textareaCls} value={loto} onChange={e => setLoto(e.target.value)} placeholder={t("ob.lotoPh")} />}
        </Field>
        <Field label={t("ob.criteriaQ")} hint={t("ob.criteria")} missing={miss(missing3, "criteria")}>
          <textarea id="ob-wo-criteria" className={textareaCls} value={criteria} onChange={e => setCriteria(e.target.value)} placeholder={t("ob.criteriaPh")} />
          <button type="button" onClick={() => void askAi()} disabled={aiBusy || !text.trim()}
            className="w-full min-h-11 rounded-xl border-[1.5px] border-violet-500/40 bg-violet-500/10 text-fg font-semibold text-[14.5px] inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {aiBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-300" />}
            {t("ob.aiSuggest")}
          </button>
        </Field>
      </>}

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </Screen>
  );
}
