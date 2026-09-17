// Reportar un defecto desde el celular (Preview V40). Tres pantallas:
//   1. ¿Qué pasó?        un solo campo: escribir, dictar o sacar una foto
//   2. Esto entendí      la IA propone equipo, descripción, clasificación,
//                        gravedad, estado del equipo y acción inmediata; el
//                        usuario corrige lo que quiera y recién ahí se guarda
//   3. ¿Cómo se repara?  crear la OT · ya se reparó · lo dejo abierto
//
// No agrega reglas ni endpoints: usa los mismos servicios de IA que la vista de
// tripulación (voice-report-parse, analyze-photo) y el alta/cierre de defectos
// de siempre. Los dos caminos de reparación hacen lo mismo que el escritorio:
//   · Crear la OT  → se abre la orden, el defecto queda vinculado a ella y se
//                    cierra con la constancia "derivado a una OT nueva".
//   · Ya se reparó → pide qué se hizo y CÓMO SE COMPROBÓ (el backend exige esa
//                    constancia para cerrar), pasa a RESUELTO y cierra.

import React, { useMemo, useState } from "react";
import {
  Sparkles, Loader2, Search, Check, CheckCheck, Clock, Wrench,
  ChevronRight, Monitor, Info, AlertTriangle,
} from "lucide-react";
import { useT, type TranslationKey } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useFetch } from "../lib/hooks";
import { api } from "../lib/api";
import { useVesselContext } from "../lib/vessel-context";
import { AlertDialog } from "../components/AlertDialog";
import { analyzePhotoForDefect, uploadDefectPhoto } from "../lib/defect-photos";
import { Screen, Head, Field, Chips, MainButton, DoneScreen, RadioRow, Note, inputCls, textareaCls, scrollToMissing } from "./ui";
import { DictateButton, PhotoButton, PhotoStrip, errorText, joinBullets, type PickedPhoto } from "./shared";
import { OnboardNewWorkOrder, type AssetOption } from "./OnboardNewWorkOrder";

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const OP_STATES = ["NORMAL", "DEGRADED", "RESTRICTED", "NO_GO"] as const;
/** Cómo se comprobó el arreglo: mismas opciones que el cierre del escritorio. */
const CLOSE_CHECKS: { key: string; label: TranslationKey }[] = [
  { key: "tested", label: "def.verify.optionTested" },
  { key: "watch",  label: "def.verify.optionWatch" },
  { key: "chief",  label: "def.verify.optionChief" },
  { key: "other",  label: "def.verify.optionOther" },
];

/** Lo que devuelve la IA al interpretar el relato. */
interface ParsedFields {
  assetId?: string | null;
  description?: string;
  classification?: string;
  severity?: string;
  operationalState?: string;
  /** Puede venir como texto o como lista de acciones (la IA devuelve las dos formas). */
  immediateAction?: string | string[] | null;
}

/** Texto de un campo de la IA, venga como string o como lista de viñetas. */
function asText(value: unknown): string {
  if (Array.isArray(value)) return joinBullets(value.map(v => String(v).trim()).filter(Boolean));
  return typeof value === "string" ? value.trim() : "";
}
interface ParseOutput {
  fields: ParsedFields;
  assetSnapshot?: Array<{ id: string; name: string | null; sfiCode?: string | null }>;
}

interface CreatedDefect { id: string; defectCode: string }

const SEV_ON: Record<string, string> = {
  LOW: "bg-success border-success text-white",
  MEDIUM: "bg-warning border-warning text-black",
  HIGH: "bg-orange-600 border-orange-600 text-white",
  CRITICAL: "bg-danger border-danger text-white",
};

export const OnboardDefect: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const t = useT();
  const { user } = useAuth();
  const { selectedVesselCode } = useVesselContext();
  const assets = useFetch<{ items: AssetOption[] }>("/app/pms/assets?limit=500");

  const [step, setStep] = useState<"tell" | "review" | "how" | "fixed" | "wo">("tell");
  // Estándar V50 (pedido de Gustavo): lo que falta se marca desde que se abre,
  // no recién al tocar el botón.
  const [tried, setTried] = useState(true);
  // Paso 1
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  // Paso 2 — lo que propuso la IA, ya editable
  const [asset, setAsset] = useState<AssetOption | null>(null);
  const [assetQuery, setAssetQuery] = useState("");
  const [pickAsset, setPickAsset] = useState(false);
  const [description, setDescription] = useState("");
  const [classification, setClassification] = useState("");
  const [severity, setSeverity] = useState<string>("MEDIUM");
  const [opState, setOpState] = useState<string>("NORMAL");
  const [immediate, setImmediate] = useState("");
  // Paso 3
  const [defect, setDefect] = useState<CreatedDefect | null>(null);
  const [fixWhat, setFixWhat] = useState("");
  const [check, setCheck] = useState<string | null>(null);
  const [checkOther, setCheckOther] = useState("");

  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [done, setDone] = useState<"wo" | "closed" | "open" | null>(null);

  const filteredAssets = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    const list = assets.data?.items ?? [];
    return (q ? list.filter(a => `${a.name ?? ""} ${a.assetCode}`.toLowerCase().includes(q)) : list).slice(0, 40);
  }, [assets.data, assetQuery]);

  /** Paso 1 → 2: la IA interpreta el relato y completa lo que puede. */
  const analyze = async () => {
    if (!text.trim() || !selectedVesselCode) return;
    setBusy(true);
    try {
      const r = await api.post<ParseOutput>("/app/pms/defects/voice-report-parse", {
        transcript: text.trim(),
        vesselCode: selectedVesselCode,
        forcedType: "defect",
      });
      const f = r.fields ?? {};
      // El equipo llega como id: se resuelve contra el catálogo para poder
      // mostrar el nombre y dejar cambiarlo.
      const found = f.assetId ? (assets.data?.items ?? []).find(a => a.id === f.assetId) ?? null : null;
      setAsset(found);
      setDescription(asText(f.description) || text.trim());
      setClassification(asText(f.classification));
      if (f.severity && SEVERITIES.includes(f.severity as never)) setSeverity(f.severity);
      if (f.operationalState && OP_STATES.includes(f.operationalState as never)) setOpState(f.operationalState);
      setImmediate(asText(f.immediateAction));
      setStep("review");
      setTried(true);
    } catch (e) {
      setAlert(errorText(e, t("ob.aiFailed")));
    } finally {
      setBusy(false);
    }
  };

  /** La foto también sirve de relato: la IA la mira y redacta. */
  const readPhoto = async (picked: PickedPhoto[]) => {
    setPhotos(picked);
    const last = picked[picked.length - 1];
    if (!last) return;
    setBusy(true);
    try {
      const r = await analyzePhotoForDefect({ file: last.file, existingDescription: text.trim() || undefined });
      if (r.text) setText(prev => [prev.trim(), r.text.trim()].filter(Boolean).join(" "));
    } catch { /* la foto igual queda adjunta; el usuario escribe o dicta */ }
    finally { setBusy(false); }
  };

  const missing2 = { asset: !asset, description: !description.trim() };
  const missing2Count = Object.values(missing2).filter(Boolean).length;

  /** Paso 2 → 3: se crea el defecto con lo aprobado. */
  const register = async () => {
    if (!selectedVesselCode || !asset) return;
    setBusy(true);
    try {
      const created = await api.post<CreatedDefect>("/app/pms/defects", {
        vesselCode: selectedVesselCode,
        assetId: asset.id,
        description: description.trim(),
        // El alta exige clasificación; si la IA no la dedujo, la del formulario.
        classification: classification.trim() || t("ob.def.classDefault"),
        severity,
        operationalState: opState,
        immediateAction: immediate.trim() || null,
        reportedAt: new Date().toISOString(),
      });
      setDefect(created);
      for (const p of photos) {
        try { await uploadDefectPhoto(created.id, p.file); } catch { /* el defecto ya quedó */ }
      }
      photos.forEach(p => URL.revokeObjectURL(p.preview));
      setStep("how");
    } catch (e) {
      setAlert(errorText(e, t("ob.sendFailed")));
    } finally {
      setBusy(false);
    }
  };

  /** "Ya se reparó": resuelto + cerrado, con la constancia de cómo se comprobó. */
  const closeFixed = async () => {
    if (!defect || !check) return;
    const note = check === "other"
      ? checkOther.trim()
      : t(CLOSE_CHECKS.find(c => c.key === check)!.label);
    if (!note) { setTried(true); return; }
    setBusy(true);
    try {
      await api.patch(`/app/pms/defects/${defect.id}`, {
        status: "RESOLVED",
        correctiveAction: fixWhat.trim() || null,
      });
      await api.post(`/app/pms/defects/${defect.id}/close`, { closeNotes: note });
      setDone("closed");
    } catch (e) {
      setAlert(errorText(e, t("ob.sendFailed")));
    } finally {
      setBusy(false);
    }
  };

  /** Camino "Crear la OT": el defecto se vincula a la orden y se cierra. */
  const linkWorkOrder = async (wo: { id: string }) => {
    if (!defect) return;
    await api.patch(`/app/pms/defects/${defect.id}`, { workOrderId: wo.id, status: "RESOLVED" });
    await api.post(`/app/pms/defects/${defect.id}/close`, { closeNotes: t("def.verify.closedIntoWo") });
  };

  // ── Pantallas finales ─────────────────────────────────────────────────────
  if (done) {
    const lines = {
      wo: [t("ob.def.done.woSent"), t("ob.def.done.linked"), t("ob.done.restWo")],
      closed: [t("ob.def.done.recorded"), t("ob.def.done.check30"), t("ob.done.restWo")],
      open: [t("ob.def.done.stayOpen"), t("ob.def.done.woLater"), t("ob.done.restWo")],
    }[done];
    return (
      <DoneScreen
        icon={<Check className="w-10 h-10" />}
        title={done === "closed" ? t("ob.def.done.closedTitle") : done === "wo" ? t("ob.def.done.woTitle") : t("ob.def.done.openTitle")}
        code={defect?.defectCode ?? ""}
        lines={lines.map((text, i) => ({ icon: i === lines.length - 1 ? <Monitor className="w-[17px] h-[17px]" /> : <Info className="w-[17px] h-[17px]" />, text }))}
        onHome={onExit}
      />
    );
  }

  // ── Crear la OT: sigue el flujo de OT nueva, con el defecto ya cargado ─────
  if (step === "wo" && asset && defect) {
    return (
      <OnboardNewWorkOrder
        onExit={onExit}
        prefill={{
          asset,
          description: description.trim(),
          kind: "CORRECTIVO_NO_PROGRAMADO",
          priority: severity,
          note: t("ob.def.fromDefect").replace("{code}", defect.defectCode),
          doneNote: t("ob.def.done.linked"),
        }}
        onCreated={linkWorkOrder}
      />
    );
  }

  // ── Paso 1: ¿qué pasó? ────────────────────────────────────────────────────
  if (step === "tell") {
    return (
      <Screen
        head={<Head title={t("ob.def.title")} sub={t("ob.def.step1")} step={1} onBack={onExit} />}
        foot={<MainButton busy={busy} missing={text.trim() ? 0 : 1}
          label={t("ob.next")} icon={<Sparkles className="w-[18px] h-[18px]" />}
          onClick={() => void analyze()} onMissing={() => { setTried(true); scrollToMissing(); }} />}
      >
        <Field label={t("ob.def.what")} hint={t("ob.def.whatHint")} missing={tried && !text.trim()}>
          <textarea id="ob-def-text" className={textareaCls} value={text} onChange={e => setText(e.target.value)} placeholder={t("ob.def.whatPh")} />
          <div className="flex gap-2">
            <DictateButton onText={chunk => setText(prev => [prev.trim(), chunk.trim()].filter(Boolean).join(" "))} />
            <PhotoButton photos={photos} onChange={p => void readPhoto(p)} />
          </div>
          <PhotoStrip photos={photos} onChange={setPhotos} />
          {photos.length > 0 && (
            <p className="text-[12.5px] text-text-industrial/60 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-violet-600 dark:text-violet-300" />{t("ob.def.photoAi")}
            </p>
          )}
        </Field>
        {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
      </Screen>
    );
  }

  // ── Paso 2: lo que entendió la IA, para aprobar ───────────────────────────
  if (step === "review") {
    const row = (label: string, value: string, onEdit?: () => void, missing?: boolean) => (
      <div className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${missing ? "border-warning bg-warning/10" : "border-fg/10 bg-surface"}`}>
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-extrabold uppercase tracking-[0.05em] text-text-industrial/45">{label}</span>
          <span className={`block font-bold leading-snug mt-0.5 ${value.length > 40 ? "text-sm font-semibold" : "text-[15px]"}`}>{value}</span>
        </span>
        {onEdit && (
          <button type="button" onClick={onEdit} className="shrink-0 min-h-9 px-3 rounded-xl border border-fg/10 bg-fg/5 text-[12.5px] font-bold">
            {missing ? t("ob.def.pick") : t("ob.change")}
          </button>
        )}
      </div>
    );

    return (
      <Screen
        head={<Head title={t("ob.def.title")} sub={t("ob.def.step2")} step={2} onBack={() => setStep("tell")} />}
        foot={<>
          <MainButton busy={busy} missing={tried ? missing2Count : 0}
            label={t("ob.def.register")} icon={<Check className="w-[18px] h-[18px]" />}
            onClick={() => void register()} onMissing={() => { setTried(true); scrollToMissing(); }} />
          <p className="text-center text-[12.5px] text-text-industrial/60">{t("ob.signsAs").replace("{name}", user?.name ?? "")}</p>
        </>}
      >
        <div id={missing2.asset ? "ob-def-missing" : undefined} data-missing={tried && missing2.asset ? "1" : undefined}
          className="rounded-2xl border-[1.5px] border-violet-500/40 bg-violet-500/[0.07] p-3 flex flex-col gap-2.5">
          <p className="text-xs font-extrabold uppercase tracking-[0.06em] text-violet-700 dark:text-violet-300 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" />{t("ob.def.aiHeader")}
          </p>
          {pickAsset || !asset ? (
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-industrial/40" />
                <input id="ob-def-asset-q" className={`${inputCls} pl-9`} value={assetQuery} onChange={e => setAssetQuery(e.target.value)} placeholder={t("ob.assetSearch")} />
              </div>
              {assets.loading && !assets.data
                ? <Loader2 className="w-5 h-5 animate-spin text-accent mx-auto" />
                : filteredAssets.map(a => (
                    <RadioRow key={a.id} on={asset?.id === a.id} onClick={() => { setAsset(a); setPickAsset(false); }}
                      title={a.name ?? a.assetCode} sub={a.name ? a.assetCode : null} />
                  ))}
            </div>
          ) : row(t("ob.asset"), asset.name ?? asset.assetCode, () => setPickAsset(true), false)}
          <p className="text-[12.5px] text-violet-700/80 dark:text-violet-300/80">{t("ob.def.aiNote")}</p>
        </div>

        <Field label={t("ob.def.whatShort")}>
          <textarea id="ob-def-desc" className={textareaCls} value={description} onChange={e => setDescription(e.target.value)} />
        </Field>
        <Field label={t("def.classification")}>
          <input id="ob-def-class" className={inputCls} value={classification} onChange={e => setClassification(e.target.value)} placeholder={t("def.classificationPh")} />
        </Field>
        <Field label={t("ob.def.severity")}>
          <div className="grid grid-cols-4 gap-1.5">
            {SEVERITIES.map(s => (
              <button key={s} type="button" onClick={() => setSeverity(s)} aria-pressed={severity === s}
                className={`min-h-[50px] rounded-xl border-[1.5px] text-[13.5px] font-extrabold ${severity === s ? SEV_ON[s] : "bg-surface border-fg/10 text-fg"}`}>
                {t(`ob.def.sev.${s}` as TranslationKey)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t("ob.def.opState")}>
          <Chips options={OP_STATES.map(s => ({ value: s, label: t(`ob.def.state.${s}` as TranslationKey) }))}
            value={opState} onChange={v => setOpState(v)} />
        </Field>
        <Field label={t("def.immediateAction")} optional>
          <textarea id="ob-def-imm" className={textareaCls} value={immediate} onChange={e => setImmediate(e.target.value)} placeholder={t("ob.def.immediatePh")} />
        </Field>
        {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
      </Screen>
    );
  }

  // ── Paso 3: ¿cómo se repara? ──────────────────────────────────────────────
  if (step === "how") {
    const option = (icon: React.ReactNode, tone: string, title: string, sub: string, onClick: () => void) => (
      <button type="button" onClick={onClick}
        className="w-full text-left bg-surface border-[1.5px] border-fg/10 rounded-[18px] p-3.5 flex items-center gap-3 active:bg-fg/5">
        <span className={`w-12 h-12 shrink-0 rounded-[14px] grid place-items-center ${tone}`}>{icon}</span>
        <span className="min-w-0 flex-1">
          <b className="block text-base font-extrabold leading-tight">{title}</b>
          <small className="block text-[12.5px] text-text-industrial/60 mt-1">{sub}</small>
        </span>
        <ChevronRight className="w-5 h-5 shrink-0 text-text-industrial/40" />
      </button>
    );
    return (
      <Screen head={<Head title={t("ob.def.howTitle")} sub={`${defect?.defectCode ?? ""} · ${t("ob.def.registered")}`} step={3} onBack={() => setDone("open")} />}>
        <p className="text-[12.5px] text-text-industrial/60">{t("ob.def.howHint")}</p>
        {option(<Wrench className="w-6 h-6" />, "bg-accent/10 text-accent", t("ob.def.optWo"), t("ob.def.optWoSub"), () => setStep("wo"))}
        {option(<CheckCheck className="w-6 h-6" />, "bg-success/15 text-success", t("ob.def.optFixed"), t("ob.def.optFixedSub"), () => { setTried(true); setStep("fixed"); })}
        {option(<Clock className="w-6 h-6" />, "bg-fg/5 text-text-industrial/60", t("ob.def.optOpen"), t("ob.def.optOpenSub"), () => setDone("open"))}
      </Screen>
    );
  }

  // ── "Ya se reparó" ────────────────────────────────────────────────────────
  const checkMissing = !check || (check === "other" && !checkOther.trim());
  return (
    <Screen
      head={<Head title={t("ob.def.optFixed")} sub={defect?.defectCode ?? ""} onBack={() => setStep("how")} />}
      foot={<>
        <MainButton busy={busy} missing={tried && checkMissing ? 1 : 0}
          label={t("ob.def.closeDefect")} icon={<Check className="w-[18px] h-[18px]" />}
          onClick={() => void closeFixed()} onMissing={() => { setTried(true); scrollToMissing(); }} />
        <p className="text-center text-[12.5px] text-text-industrial/60">{t("ob.signsAs").replace("{name}", user?.name ?? "")}</p>
      </>}
    >
      <Field label={t("ob.def.whatWasDone")} optional>
        <textarea id="ob-def-fix" className={textareaCls} value={fixWhat} onChange={e => setFixWhat(e.target.value)} placeholder={t("ob.def.whatWasDonePh")} />
      </Field>
      <Field label={t("ob.def.howChecked")} hint={t("ob.def.howCheckedHint")} missing={tried && checkMissing}>
        <div className="flex flex-col gap-2">
          {CLOSE_CHECKS.map(c => (
            <RadioRow key={c.key} on={check === c.key} onClick={() => setCheck(c.key)} title={t(c.label)} />
          ))}
        </div>
        {check === "other" && (
          <input id="ob-def-check-other" className={inputCls} value={checkOther} onChange={e => setCheckOther(e.target.value)} placeholder={t("ob.def.howCheckedPh")} />
        )}
      </Field>
      <Note icon={<AlertTriangle className="w-[17px] h-[17px] shrink-0 mt-px" />}>{t("ob.def.closeNote")}</Note>
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </Screen>
  );
};
