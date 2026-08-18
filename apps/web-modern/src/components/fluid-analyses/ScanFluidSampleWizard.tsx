// Wizard guiado: el usuario sube una foto/PDF del resultado de laboratorio y
// el sistema hace todo el resto — extrae los datos, crea el análisis, y si
// corresponde a un ítem del plan de mantenimiento (equipo con samplingKind
// configurado), ofrece abrir la OT (y la SS al proveedor, si aplica).
//
// Garantía: nada se abre ni se vincula sin que el usuario lo confirme
// explícitamente en el paso 4. La muestra, una vez guardada en el paso 2, no
// se pierde pase lo que pase con el resto del flujo — cualquier falla
// posterior es un aviso, nunca un rollback.
import React, { useCallback, useMemo, useState } from "react";
import { Camera, Loader2, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { useT } from "../../lib/i18n";
import {
  ModalShell, ConfidenceBadge, inputCls, labelCls, assetLabel,
  FLUID_TYPES, FLUID_LABELS, VERDICTS,
  type FluidType, type Verdict, type AssetItem,
} from "./shared";
import { PlanLinkSuggestionDialog, type PlanLinkCandidate } from "../PlanLinkSuggestionDialog";

type Step = "capture" | "review" | "linking" | "result";

interface ExtractedFieldApi<T> { value: T | null; confidence: "high" | "medium" | "low"; }
interface ExtractedReportApi {
  fluidType: ExtractedFieldApi<FluidType>;
  sampledAt: ExtractedFieldApi<string>;
  receivedAt: ExtractedFieldApi<string>;
  runningHours: ExtractedFieldApi<number>;
  labName: ExtractedFieldApi<string>;
  labReference: ExtractedFieldApi<string>;
  fluidProduct: ExtractedFieldApi<string>;
  assetReferenceText: ExtractedFieldApi<string>;
  assetIdSuggestion: { id: string; name: string; score: number } | null;
  verdict: ExtractedFieldApi<Verdict>;
  summary: ExtractedFieldApi<string>;
  parameters: Record<string, { value: number | string; unit?: string; confidence: "high" | "medium" | "low" }>;
  notes?: string;
}

interface PlanCandidateApi {
  id: string; taskCode: string; title: string; triggerType: string; assetId: string;
  nextDueDate?: string | null; nextDueHours?: number | null; executionStatus?: string | null;
  samplingKind?: string | null; samplingFluidType?: string | null;
}

interface Props {
  assets: AssetItem[];
  vessels: Array<{ code: string; name: string | null }>;
  onClose: () => void;
  onDone: (sampleId: string) => void;
}

async function extractReport(file: File, vesselCode: string | null): Promise<{ extracted: ExtractedReportApi; file: { url: string; name: string; mime: string } }> {
  return api.uploadRaw<{ extracted: ExtractedReportApi; file: { url: string; name: string; mime: string } }>(
    "/app/fluid-analyses/extract",
    file,
    {
      "X-Filename": encodeURIComponent(file.name),
      ...(vesselCode ? { "X-Vessel-Code": vesselCode } : {}),
    },
  );
}

export const ScanFluidSampleWizard: React.FC<Props> = ({ assets, vessels, onClose, onDone }) => {
  const t = useT();
  const [step, setStep] = useState<Step>("capture");

  const [vesselCode, setVesselCode] = useState(vessels.length === 1 ? vessels[0]!.code : "");
  const filteredAssets = useMemo(() => vesselCode ? assets.filter(a => a.vesselCode === vesselCode) : assets, [assets, vesselCode]);

  // ── Paso 1: captura ──────────────────────────────────────────────────────
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [reportMime, setReportMime] = useState<string | null>(null);
  const [assetIdSuggestionScore, setAssetIdSuggestionScore] = useState(false);

  // ── Paso 2: revisión (editable) ──────────────────────────────────────────
  const [assetId, setAssetId] = useState("");
  const [fluidType, setFluidType] = useState<FluidType>("ENGINE_OIL");
  const [fluidProduct, setFluidProduct] = useState("");
  const [sampledAt, setSampledAt] = useState(new Date().toISOString().slice(0, 10));
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [runningHours, setRunningHours] = useState("");
  const [labName, setLabName] = useState("");
  const [labReference, setLabReference] = useState("");
  const [verdict, setVerdict] = useState<Verdict | "">("");
  const [summary, setSummary] = useState("");
  const [parameters, setParameters] = useState<Record<string, { value: number | string; unit?: string }>>({});
  const [conf, setConf] = useState<Partial<Record<"fluidType" | "sampledAt" | "runningHours" | "labName" | "labReference" | "fluidProduct" | "verdict" | "summary", "high" | "medium" | "low">>>({});

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState<string | null>(null);

  // ── Paso 4: sugerencia de plan + apertura de OT ──────────────────────────
  const [planCandidates, setPlanCandidates] = useState<PlanLinkCandidate[] | null>(null);
  const [planMode, setPlanMode] = useState<"confirm" | "choose" | null>(null);
  const [checkingPlan, setCheckingPlan] = useState(false);

  // ── Paso 6: resultado ─────────────────────────────────────────────────────
  const [openedWo, setOpenedWo] = useState<{ id: string; workOrderCode: string } | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setExtractError(null);
    setExtracting(true);
    try {
      const { extracted, file: saved } = await extractReport(file, vesselCode || null);
      setReportUrl(saved.url);
      setReportMime(saved.mime);

      const nextConf: typeof conf = {};
      if (extracted.fluidType?.value)     { setFluidType(extracted.fluidType.value); nextConf.fluidType = extracted.fluidType.confidence; }
      if (extracted.fluidProduct?.value)  { setFluidProduct(extracted.fluidProduct.value); nextConf.fluidProduct = extracted.fluidProduct.confidence; }
      if (extracted.sampledAt?.value)     { setSampledAt(extracted.sampledAt.value.slice(0, 10)); nextConf.sampledAt = extracted.sampledAt.confidence; }
      if (extracted.receivedAt?.value)    setReceivedAt(extracted.receivedAt.value.slice(0, 10));
      if (extracted.runningHours?.value != null) { setRunningHours(String(extracted.runningHours.value)); nextConf.runningHours = extracted.runningHours.confidence; }
      if (extracted.labName?.value)       { setLabName(extracted.labName.value); nextConf.labName = extracted.labName.confidence; }
      if (extracted.labReference?.value)  { setLabReference(extracted.labReference.value); nextConf.labReference = extracted.labReference.confidence; }
      if (extracted.verdict?.value)       { setVerdict(extracted.verdict.value); nextConf.verdict = extracted.verdict.confidence; }
      if (extracted.summary?.value)       { setSummary(extracted.summary.value); nextConf.summary = extracted.summary.confidence; }
      if (extracted.parameters)           setParameters(extracted.parameters);
      setConf(nextConf);

      // Anti-alucinación: sólo preseleccionamos si el id sugerido está en la
      // lista real de equipos del buque elegido — nunca uno inventado.
      const suggestion = extracted.assetIdSuggestion;
      if (suggestion && filteredAssets.some(a => a.id === suggestion.id)) {
        setAssetId(suggestion.id);
        setAssetIdSuggestionScore(true);
      }
      setStep("review");
    } catch (e) {
      setExtractError(e instanceof ApiError ? e.message : t("fa.ai.wizard.step2.failed"));
      setStep("review");
    } finally {
      setExtracting(false);
    }
  }, [vesselCode, filteredAssets, t]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  };

  // ── Buscar candidatos de plan + apertura de OT ───────────────────────────
  const checkPlanAndMaybeOpenWo = useCallback(async (createdSampleId: string) => {
    setCheckingPlan(true);
    try {
      const plansRes = await api.get<{ items: PlanCandidateApi[] }>(
        `/app/pms/maintenance-plans?assetId=${encodeURIComponent(assetId)}&status=ACTIVE&limit=100`,
      );
      const items = plansRes.items ?? [];
      // Sólo ítems de plan que SON toma de muestra del mismo tipo de fluido —
      // evita que un plan de refrigerante dispare por un análisis de aceite.
      const candidates = items.filter(p => p.samplingKind === "FLUID" && p.samplingFluidType === fluidType);
      if (candidates.length === 0) { setStep("result"); return; }

      const asset = assets.find(a => a.id === assetId);
      const res = await api.post<{ matches: { id: string; confidence: "high" | "medium" | "low" }[] }>(
        "/app/pms/work-orders/suggest-plan-links",
        {
          assetLabel: asset ? assetLabel(asset.id, assets) : null,
          title: `Análisis de ${FLUID_LABELS[fluidType]}`,
          taskDesc: summary.trim() || null,
          plans: candidates.map(p => ({ id: p.id, taskCode: p.taskCode, title: p.title, triggerType: p.triggerType, nextDueDate: p.nextDueDate, nextDueHours: p.nextDueHours, executionStatus: p.executionStatus })),
        },
      );
      const matches = res.matches ?? [];
      if (matches.length === 0) { setStep("result"); return; }

      const dialogCandidates: PlanLinkCandidate[] = [];
      for (const m of matches) {
        const plan = candidates.find(p => p.id === m.id);
        if (!plan) continue;
        dialogCandidates.push({ id: plan.id, taskCode: plan.taskCode, title: plan.title, nextDueDate: plan.nextDueDate, nextDueHours: plan.nextDueHours, confidence: m.confidence });
      }
      if (dialogCandidates.length === 0) { setStep("result"); return; }

      const highs = dialogCandidates.filter(c => c.confidence === "high");
      setPlanCandidates(dialogCandidates);
      setPlanMode(dialogCandidates.length === 1 && highs.length === 1 ? "confirm" : "choose");
      setStep("linking");
    } catch (e) {
      console.error("[fluid-scan-wizard] suggest-plan-links failed:", e);
      setStep("result");
    } finally {
      setCheckingPlan(false);
    }
  }, [assetId, fluidType, summary, assets]);

  const handlePlanConfirm = useCallback(async (planIds: string[]) => {
    setPlanCandidates(null);
    setPlanMode(null);
    if (!sampleId || planIds.length === 0) { setStep("result"); return; }
    try {
      const wo = await api.post<{ id: string; workOrderCode: string }>(
        `/app/pms/maintenance-plans/${planIds[0]}/open-work-order`,
        { additionalPlanIds: planIds.slice(1) },
      );
      try {
        await api.post(`/app/fluid-analyses/${sampleId}/link-work-order`, { workOrderId: wo.id, planId: planIds[0] });
      } catch (e) {
        console.error("[fluid-scan-wizard] link-work-order failed:", e);
      }
      setOpenedWo(wo);
    } catch (e) {
      console.error("[fluid-scan-wizard] open-work-order failed:", e);
      setLinkFailed(true);
    } finally {
      setStep("result");
    }
  }, [sampleId]);

  const handlePlanDismiss = useCallback(() => {
    setPlanCandidates(null);
    setPlanMode(null);
    setStep("result");
  }, []);

  // ── Guardar la muestra + resultado ───────────────────────────────────────
  const submit = useCallback(async () => {
    setErr(null);
    if (!vesselCode || !assetId) { setErr(t("wo.modal.equipmentRequired")); return; }
    if (!verdict) { setErr(t("fa.ai.wizard.verdictRequired")); return; }
    setSaving(true);
    try {
      const created = await api.post<{ id: string }>("/app/fluid-analyses", {
        vesselCode, assetId, fluidType,
        fluidProduct: fluidProduct.trim() || null,
        sampledAt, runningHours: runningHours.trim() ? Number(runningHours) : null,
        containerCode: null, labName: labName.trim() || null, labReference: labReference.trim() || null,
        notes: null,
      });
      await api.post(`/app/fluid-analyses/${created.id}/result`, {
        receivedAt, verdict, summary: summary.trim() || null,
        parameters, reportUrl, reportMime,
        runningHours: runningHours.trim() ? Number(runningHours) : null,
      });
      setSampleId(created.id);
      // A partir de acá el análisis existe pase lo que pase con el resto.
      await checkPlanAndMaybeOpenWo(created.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [vesselCode, assetId, verdict, fluidType, fluidProduct, sampledAt, runningHours, labName, labReference, receivedAt, summary, parameters, reportUrl, reportMime, checkPlanAndMaybeOpenWo, t]);

  return (
    <>
      <ModalShell title={t("fa.ai.wizard.title")} onClose={onClose}>
        {step === "capture" && (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>{t("form.vessel")}</label>
              <select value={vesselCode} onChange={e => { setVesselCode(e.target.value); setAssetId(""); }} className={inputCls}>
                <option value="">{t("fa.selectPh")}</option>
                {vessels.map(v => <option key={v.code} value={v.code}>{v.code}</option>)}
              </select>
            </div>
            <p className="text-xs text-text-industrial/60 leading-relaxed">{t("fa.ai.wizard.step1.help")}</p>
            <label
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                vesselCode ? "border-accent/30 hover:border-accent/60 cursor-pointer" : "border-fg/10 opacity-50 cursor-not-allowed"
              }`}
              title={!vesselCode ? t("fa.ai.wizard.step1.vessel") : undefined}
            >
              <Camera className="w-8 h-8 text-accent" />
              <span className="text-xs font-bold text-fg">{t("fa.ai.wizard.step1.upload")}</span>
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/gif,image/webp"
                capture="environment" className="hidden" disabled={!vesselCode}
                onChange={e => { handleFileChange(e); e.target.value = ""; }} />
            </label>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            {extracting && (
              <div className="flex items-center gap-2 justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-accent" />
                <span className="text-xs text-text-industrial/60">{t("fa.ai.wizard.step2.loading")}</span>
              </div>
            )}
            {!extracting && (
              <>
                {extractError && (
                  <p className="text-xs text-yellow-700 dark:text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-3 py-2 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {extractError}
                  </p>
                )}
                <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold">{t("fa.ai.wizard.step2.title")}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{t("form.equipment")}</label>
                    <select value={assetId} onChange={e => { setAssetId(e.target.value); setAssetIdSuggestionScore(false); }} className={inputCls}>
                      <option value="">{t("fa.selectPh")}</option>
                      {filteredAssets.map(a => <option key={a.id} value={a.id}>{a.name ?? a.assetCode}</option>)}
                    </select>
                    {assetIdSuggestionScore && assetId && (
                      <p className="text-[10px] text-accent mt-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> {t("wo.ai.assetSuggested")}</p>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className={labelCls + " mb-0"}>{t("fa.fluidType")}</label>
                      {conf.fluidType && <ConfidenceBadge confidence={conf.fluidType} />}
                    </div>
                    <select value={fluidType} onChange={e => setFluidType(e.target.value as FluidType)} className={inputCls}>
                      {FLUID_TYPES.map(f => <option key={f} value={f}>{FLUID_LABELS[f]}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className={labelCls + " mb-0"}>{t("fa.productBrand")}</label>
                      {conf.fluidProduct && <ConfidenceBadge confidence={conf.fluidProduct} />}
                    </div>
                    <input value={fluidProduct} onChange={e => setFluidProduct(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className={labelCls + " mb-0"}>{t("fa.sampleDate")}</label>
                      {conf.sampledAt && <ConfidenceBadge confidence={conf.sampledAt} />}
                    </div>
                    <input type="date" value={sampledAt} onChange={e => setSampledAt(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className={labelCls + " mb-0"}>{t("fa.runHours")}</label>
                      {conf.runningHours && <ConfidenceBadge confidence={conf.runningHours} />}
                    </div>
                    <input type="number" value={runningHours} onChange={e => setRunningHours(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{t("fa.receivedAt")}</label>
                    <input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className={labelCls + " mb-0"}>{t("fa.lab")}</label>
                      {conf.labName && <ConfidenceBadge confidence={conf.labName} />}
                    </div>
                    <input value={labName} onChange={e => setLabName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className={labelCls + " mb-0"}>{t("fa.labRef")}</label>
                      {conf.labReference && <ConfidenceBadge confidence={conf.labReference} />}
                    </div>
                    <input value={labReference} onChange={e => setLabReference(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <label className={labelCls + " mb-0"}>{t("fa.verdict")}</label>
                    {conf.verdict && <ConfidenceBadge confidence={conf.verdict} />}
                  </div>
                  <select value={verdict} onChange={e => setVerdict(e.target.value as Verdict)} className={inputCls}>
                    <option value="">{t("fa.selectPh")}</option>
                    {VERDICTS.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <label className={labelCls + " mb-0"}>{t("fa.summary")}</label>
                    {conf.summary && <ConfidenceBadge confidence={conf.summary} />}
                  </div>
                  <textarea rows={2} value={summary} onChange={e => setSummary(e.target.value)} className={inputCls + " resize-none"} />
                </div>
                {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs text-text-industrial/60 hover:text-fg">{t("common.cancel")}</button>
                  <button onClick={() => { void submit(); }} disabled={saving}
                    className="px-4 py-2 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("fa.ai.wizard.confirmSave")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === "linking" && checkingPlan && (
          <div className="flex items-center gap-2 justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            <span className="text-xs text-text-industrial/60">{t("fa.ai.wizard.linking.checking")}</span>
          </div>
        )}

        {step === "result" && (
          <div className="space-y-4 text-center py-4">
            <CheckCircle2 className="w-10 h-10 text-accent mx-auto" />
            {openedWo ? (
              <p className="text-sm text-fg">
                {t("fa.ai.wizard.result.woOpened")} <span className="font-mono font-bold text-accent">{openedWo.workOrderCode}</span>
              </p>
            ) : linkFailed ? (
              <p className="text-xs text-yellow-700 dark:text-yellow-400 leading-relaxed">{t("fa.ai.wizard.result.linkFailed")}</p>
            ) : (
              <p className="text-sm text-fg">{t("fa.ai.wizard.result.noMatch")}</p>
            )}
            <button onClick={() => sampleId && onDone(sampleId)}
              className="px-4 py-2 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110">
              {t("fa.ai.wizard.done")}
            </button>
          </div>
        )}
      </ModalShell>

      {planCandidates && planMode && (
        <PlanLinkSuggestionDialog
          candidates={planCandidates}
          mode={planMode}
          onConfirm={(ids) => { void handlePlanConfirm(ids); }}
          onDismiss={handlePlanDismiss}
          texts={{
            confirmTitle: t("fa.ai.planLink.confirmTitle"),
            confirmQuestion: t("fa.ai.planLink.confirmQuestion"),
            chooseTitle: t("fa.ai.planLink.chooseTitle"),
            chooseQuestion: t("fa.ai.planLink.chooseQuestion"),
            yesLabel: t("fa.ai.planLink.yes"),
            linkSelectedLabel: t("fa.ai.planLink.linkSelected"),
          }}
        />
      )}
    </>
  );
};
