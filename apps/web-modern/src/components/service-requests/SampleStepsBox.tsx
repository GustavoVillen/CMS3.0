// LA MUESTRA, EN TRES PASOS (Preview V33).
//
// Cuando el pedido es al laboratorio, registrar el avance no es escribir un
// renglón en blanco: es siempre lo mismo — se toma la muestra (con el número de
// cada frasco), se manda, y vuelve el resultado. Estos tres botones hacen
// exactamente eso, escribiendo en los mismos lugares que ya usa la PC:
//
//   1. número de frasco  → PUT  /app/pms/service-requests/:id/lab-samples
//   2. enviar al taller  → POST /app/pms/service-requests/:id/start
//   3. servicio recibido → POST /app/pms/service-requests/:id/complete
//
// No hay estado propio ni campos nuevos: el paso en el que está el pedido se
// deduce de su estado y de los números ya cargados. Los valores del informe
// (viscosidad, hierro, agua…) se siguen cargando en Muestreos y Análisis.

import React, { useCallback, useEffect, useState } from "react";
import { Beaker, Send, PackageCheck, Check, Loader2, TriangleAlert, FlaskConical, Info } from "lucide-react";
import { api } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import { AlertDialog } from "../AlertDialog";
import { FLUID_LABELS, SAMPLE_KIND_LABELS, type FluidType, type SampleKind } from "../fluid-analyses/shared";
import type { LabSample, LabSamplesData } from "./LabSamplesPanel";

/** Qué dice la fila debajo del equipo: el fluido, o el tipo de muestreo. */
function sampleSubtitle(s: LabSample): string {
  if (s.fluidType && FLUID_LABELS[s.fluidType as FluidType]) return FLUID_LABELS[s.fluidType as FluidType];
  return SAMPLE_KIND_LABELS[(s.kind as SampleKind) ?? "OTHER"] ?? "";
}

type StepState = "done" | "now" | "locked";

function Step({ n, state, title, sub, children }: {
  n: number; state: StepState; title: string; sub: string; children?: React.ReactNode;
}) {
  const tone = state === "done"
    ? "border-success/40 bg-success/5"
    : state === "now"
      ? "border-accent ring-[3px] ring-accent/15 bg-surface"
      : "border-fg/10 bg-surface opacity-60";
  const numTone = state === "done" ? "bg-success text-white"
    : state === "now" ? "bg-accent text-accent-fg"
    : "bg-fg/5 text-text-industrial/60";
  return (
    <section className={`rounded-2xl border-[1.5px] p-3.5 flex flex-col gap-2.5 ${tone}`}>
      <div className="flex gap-2.5 items-center">
        <span className={`w-[30px] h-[30px] shrink-0 rounded-full grid place-items-center text-[13px] font-extrabold ${numTone}`}>
          {state === "done" ? <Check className="w-4 h-4" /> : n}
        </span>
        <span className="min-w-0">
          <b className="block text-[15.5px] font-extrabold leading-tight text-fg">{title}</b>
          <small className="block text-[12.5px] text-text-industrial/60 font-semibold">{sub}</small>
        </span>
      </div>
      {children}
    </section>
  );
}

const btn = "min-h-[52px] w-full rounded-2xl text-[15.5px] font-extrabold flex items-center justify-center gap-2 disabled:opacity-45";

export function SampleStepsBox({ srId, srStatus, providerName, onChanged, onDetected }: {
  srId: string;
  /** Estado de la SS: define qué paso está habilitado. */
  srStatus: string;
  providerName: string | null;
  /** Se llama tras cada acción: el padre refresca la SS y la hoja de ruta. */
  onChanged: () => void | Promise<void>;
  /** Avisa si este pedido lleva muestras, para que el padre acomode la hoja de ruta. */
  onDetected?: (carries: boolean) => void;
}) {
  const t = useT();
  const { user } = useAuth();
  const [data, setData] = useState<LabSamplesData | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [receivedBy, setReceivedBy] = useState(user?.name ?? "");
  const [conform, setConform] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<LabSamplesData>(`/app/pms/service-requests/${srId}/lab-samples`);
      setData(res);
      setDraft(Object.fromEntries(res.items.map(s => [s.id, s.labReference ?? ""])));
      onDetected?.(res.carriesSamples);
    } catch {
      setData({ items: [], carriesSamples: false });
      onDetected?.(false);
    }
    // onDetected viene del padre y no cambia de identidad entre renders útiles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srId]);
  useEffect(() => { void load(); }, [load]);

  if (!data || !data.carriesSamples) return null;

  const pending = data.items.filter(s => !s.hasResult);
  const numbered = pending.filter(s => (s.labReference ?? "").trim());
  const missing = pending.length - numbered.length;
  const taken = pending.length > 0 && missing === 0;
  const sent = srStatus === "IN_PROGRESS" || srStatus === "COMPLETED";
  const received = srStatus === "COMPLETED";

  const saveNumbers = async () => {
    setBusy(true);
    try {
      const res = await api.put<LabSamplesData>(`/app/pms/service-requests/${srId}/lab-samples`, {
        numbers: pending.map(s => ({ sampleId: s.id, labReference: (draft[s.id] ?? "").trim() || null })),
      });
      setData(res);
      setDraft(Object.fromEntries(res.items.map(s => [s.id, s.labReference ?? ""])));
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ss.samp.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    try {
      // Con frascos sin número el backend frena, salvo que se declare que
      // todavía no están: lo mismo que ofrece la PC, y queda asentado.
      await api.post(`/app/pms/service-requests/${srId}/start`, { acknowledgeMissingSampleNumbers: missing > 0 });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ss.samp.sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!receivedBy.trim() || conform === null) return;
    setBusy(true);
    try {
      await api.post(`/app/pms/service-requests/${srId}/complete`, {
        receivedByName: receivedBy.trim(),
        receptionConform: conform,
      });
      setReceiving(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ss.samp.receiveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const countLabel = numbered.length === pending.length
    ? t("ss.samp.registerAll")
    : t("ss.samp.registerSome").replace("{n}", String(numbered.length)).replace("{total}", String(pending.length));

  return (
    <div className="flex flex-col gap-2.5">
      {/* 1 · Se toma la muestra */}
      <Step n={1} state={taken ? "done" : "now"}
        title={t("ss.samp.step1")}
        sub={taken ? (pending.length === 1 ? t("ss.samp.step1doneOne") : t("ss.samp.step1done").replace("{n}", String(pending.length))) : t("ss.samp.step1sub")}>
        {pending.map(s => (
          <div key={s.id} className="flex gap-2.5 items-center p-2.5 rounded-xl bg-fg/5">
            <span className="min-w-0 flex-1">
              <b className="block text-sm font-bold leading-snug text-fg">{s.assetName ?? s.assetId}</b>
              <small className="block text-xs text-text-industrial/60 truncate">{sampleSubtitle(s)} · <span className="font-mono">{s.sampleCode}</span></small>
            </span>
            {sent || taken ? (
              <span className="font-mono text-[15px] font-bold text-success bg-success/10 px-2.5 py-1.5 rounded-lg">{s.labReference}</span>
            ) : (
              <input
                value={draft[s.id] ?? ""}
                onChange={e => setDraft(d => ({ ...d, [s.id]: e.target.value }))}
                aria-label={t("ss.samp.numberOf").replace("{asset}", s.assetName ?? s.assetId)}
                placeholder={t("ss.samp.numberPh")}
                className="w-[118px] min-h-[46px] rounded-xl border-[1.5px] border-fg/10 bg-surface text-fg text-center font-mono text-base px-2 focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15"
              />
            )}
          </div>
        ))}
        {!taken && !sent && (
          <button type="button" onClick={() => void saveNumbers()} disabled={busy || numbered.length + Object.values(draft).filter(v => v.trim()).length === 0}
            className={`${btn} bg-accent text-accent-fg`}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Beaker className="w-[18px] h-[18px]" />}{countLabel}
          </button>
        )}
        {!taken && !sent && missing > 0 && numbered.length > 0 && (
          <p className="flex gap-2.5 items-start rounded-xl p-3 text-[13px] bg-warning/10 text-fg">
            <TriangleAlert className="w-[17px] h-[17px] shrink-0 mt-px text-warning" />
            <span>{t("ss.samp.missingHint").replace("{n}", String(missing))}</span>
          </p>
        )}
        {/* Salida para el caso real de a bordo: los frascos ya salieron y los
            números los tiene el laboratorio. Es lo mismo que ofrece la PC y
            queda asentado en la hoja de ruta. */}
        {!taken && !sent && srStatus === "AUTORIZADA" && (
          <button type="button" onClick={() => void send()} disabled={busy}
            className="min-h-11 text-[13px] font-bold text-text-industrial/70 underline underline-offset-2">
            {t("ss.samp.noNumbersYet")}
          </button>
        )}
      </Step>

      {/* 2 · Se envía al laboratorio */}
      <Step n={2} state={sent ? "done" : srStatus === "AUTORIZADA" && taken ? "now" : "locked"}
        title={t("ss.samp.step2")}
        sub={sent ? t("ss.samp.step2done").replace("{lab}", providerName ?? "—")
          : srStatus !== "AUTORIZADA" ? t("ss.samp.step2notAuth")
          : !taken ? t("ss.samp.step2locked")
          : (providerName ?? t("ss.samp.step2sub"))}>
        {!sent && srStatus === "AUTORIZADA" && taken && <>
          <button type="button" onClick={() => void send()} disabled={busy} className={`${btn} bg-violet-600 text-white`}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-[18px] h-[18px]" />}
            {t("ss.samp.sendToday").replace("{d}", new Date().toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" }))}
          </button>
          <p className="flex gap-2.5 items-start rounded-xl p-3 text-[13px] bg-violet-500/10 text-fg">
            <Info className="w-[17px] h-[17px] shrink-0 mt-px text-violet-600 dark:text-violet-300" />
            <span>{t("ss.samp.sendNote")}</span>
          </p>
        </>}
      </Step>

      {/* 3 · Se recibe el resultado */}
      <Step n={3} state={received ? "done" : sent ? "now" : "locked"}
        title={t("ss.samp.step3")}
        sub={received ? t("ss.samp.step3done") : sent ? t("ss.samp.step3sub") : t("ss.samp.step3locked")}>
        {received ? (
          <p className="flex gap-2.5 items-start rounded-xl p-3 text-[13px] bg-violet-500/10 text-fg">
            <FlaskConical className="w-[17px] h-[17px] shrink-0 mt-px text-violet-600 dark:text-violet-300" />
            <span>{t("ss.samp.resultOnPc")}</span>
          </p>
        ) : sent && !receiving ? (
          <button type="button" onClick={() => setReceiving(true)} className={`${btn} bg-success text-white`}>
            <PackageCheck className="w-[18px] h-[18px]" />{t("ss.samp.markReceived")}
          </button>
        ) : sent && receiving ? (
          <div className="flex flex-col gap-2.5">
            <label className="text-[13px] font-bold text-fg">
              {t("ss.samp.whoReceives")}
              <input value={receivedBy} onChange={e => setReceivedBy(e.target.value)}
                className="mt-1.5 w-full min-h-[50px] rounded-xl border-[1.5px] border-fg/10 bg-surface text-fg text-base px-3 focus:outline-none focus:border-accent" />
            </label>
            <div>
              <p className="text-[13px] font-bold text-fg mb-1.5">{t("ss.samp.conform")}</p>
              <div className="grid grid-cols-2 gap-2">
                {[true, false].map(v => (
                  <button key={String(v)} type="button" onClick={() => setConform(v)} aria-pressed={conform === v}
                    className={`min-h-[46px] rounded-xl border-[1.5px] font-bold ${conform === v ? "bg-fg text-bg border-fg" : "bg-surface text-fg border-fg/10"}`}>
                    {v ? t("common.yes") : t("common.no")}
                  </button>
                ))}
              </div>
            </div>
            <p className="flex gap-2.5 items-start rounded-xl p-3 text-[13px] bg-violet-500/10 text-fg">
              <FlaskConical className="w-[17px] h-[17px] shrink-0 mt-px text-violet-600 dark:text-violet-300" />
              <span>{t("ss.samp.closesRequest")}</span>
            </p>
            <div className="grid grid-cols-[1fr_1.4fr] gap-2">
              <button type="button" onClick={() => setReceiving(false)} className="min-h-[46px] rounded-xl border-[1.5px] border-fg/10 font-bold">
                {t("common.cancel")}
              </button>
              <button type="button" onClick={() => void complete()} disabled={busy || !receivedBy.trim() || conform === null}
                className={`${btn} min-h-[46px] bg-success text-white`}>
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-[18px] h-[18px]" />}{t("common.confirm")}
              </button>
            </div>
          </div>
        ) : null}
      </Step>

      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </div>
  );
}
