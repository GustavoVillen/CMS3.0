// Datos y controles que comparten varias pantallas de la App a bordo.

import React, { useMemo, useRef, useState } from "react";
import { Mic, Square, Camera, X, Search, Building2, Info } from "lucide-react";
import { useT } from "../lib/i18n";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useSpeechToText } from "../lib/use-speech-to-text";
import { WO_OPEN_STATUSES, type PickerWorkOrder } from "../components/service-requests/OpenWorkOrdersPicker";
import { Field, Chips, RadioRow, Note, inputCls } from "./ui";

/** Mensaje legible de un error de la API, con respaldo en el idioma del tenant. */
export function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError && e.message ? e.message : fallback;
}

/**
 * OT abiertas del buque elegido. Mismo endpoint y mismo criterio de "abierta"
 * que el Registro de Avance y el alta de SS: las tres puertas muestran las
 * mismas órdenes.
 */
export function useOpenWorkOrders(enabled = true) {
  const { data, loading } = useFetch<{ items: PickerWorkOrder[] }>(enabled ? "/app/work-orders" : null);
  const items = useMemo(
    () => (data?.items ?? [])
      .filter(w => WO_OPEN_STATUSES.includes(w.status))
      .sort((a, b) => (a.assetName ?? "").localeCompare(b.assetName ?? "") || a.workOrderCode.localeCompare(b.workOrderCode)),
    [data],
  );
  return { items, loading };
}

/** Dictar por voz: agrega el texto dictado al final del campo. */
export function DictateButton({ onText }: { onText: (text: string) => void }) {
  const t = useT();
  const { supported, listening, interim, toggle } = useSpeechToText({ onTranscript: onText });
  if (!supported) return null;
  return (
    <button type="button" onClick={toggle}
      className={`flex-1 min-h-11 rounded-xl border-[1.5px] font-semibold text-[14.5px] inline-flex items-center justify-center gap-1.5 ${
        listening ? "bg-danger border-danger text-white animate-pulse" : "bg-surface border-fg/10 text-fg"
      }`}>
      {listening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
      <span className="truncate">{listening ? (interim ? interim : t("ob.listening")) : t("ob.dictate")}</span>
    </button>
  );
}

export interface PickedPhoto { file: File; preview: string }

/** Sacar o elegir fotos. Se suben después de crear el registro. */
export function PhotoButton({ photos, onChange }: { photos: PickedPhoto[]; onChange: (p: PickedPhoto[]) => void }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()}
        className="flex-1 min-h-11 rounded-xl border-[1.5px] border-fg/10 bg-surface text-fg font-semibold text-[14.5px] inline-flex items-center justify-center gap-1.5">
        <Camera className="w-4 h-4" />
        {photos.length ? `${t("ob.photo")} (${photos.length})` : t("ob.photo")}
      </button>
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={e => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onChange([...photos, ...files.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
        }} />
    </>
  );
}

export function PhotoStrip({ photos, onChange }: { photos: PickedPhoto[]; onChange: (p: PickedPhoto[]) => void }) {
  const t = useT();
  if (!photos.length) return null;
  return (
    <div className="flex gap-2 flex-wrap">
      {photos.map((p, i) => (
        <div key={p.preview} className="relative w-[62px] h-[62px]">
          <img src={p.preview} alt="" className="w-full h-full object-cover rounded-xl" />
          <button type="button" aria-label={t("ob.remove")}
            onClick={() => { URL.revokeObjectURL(p.preview); onChange(photos.filter((_, j) => j !== i)); }}
            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-danger text-white grid place-items-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export interface ProviderOption { id: string; name: string; category?: string | null }

/** Tipo de solicitud del formulario de SS (`purchaseRequestKinds`). */
export const SR_KINDS = [
  { value: "NORMAL", key: "ob.srKind.normal" },
  { value: "AFECTA SEGURIDAD", key: "ob.srKind.safety" },
  { value: "AFECTA SERVICIO", key: "ob.srKind.service" },
] as const;

/**
 * Los dos recuadros que aparecen al marcar "Tercerizado": a qué taller se le
 * encarga y qué tipo de solicitud es. Los comparten el alta de OT y la apertura
 * de la OT desde un plan, así el pedido al taller se carga igual por las dos
 * puertas y la SS sale con los mismos datos.
 *
 * La lista de talleres se pide sólo cuando el recuadro se muestra: en el
 * celular, no traerla hasta que hace falta es un viaje menos.
 */
export function ProviderFields({ provider, onProvider, kinds, onKinds, missProvider, missKinds, note }: {
  provider: ProviderOption | null;
  onProvider: (p: ProviderOption | null) => void;
  kinds: string[];
  onKinds: (kinds: string[]) => void;
  missProvider?: boolean;
  missKinds?: boolean;
  /** Aviso al pie (qué pasa con la SS al enviar). */
  note?: string;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const providers = useFetch<{ items: ProviderOption[] }>("/app/providers?status=ACTIVE");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = providers.data?.items ?? [];
    return (q ? list.filter(p => `${p.name} ${p.category ?? ""}`.toLowerCase().includes(q)) : list).slice(0, 40);
  }, [providers.data, query]);

  return (
    <>
      <Field label={t("ob.provider")} missing={missProvider}>
        {provider ? (
          <div className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-accent/10 border-[1.5px] border-accent">
            <Building2 className="w-5 h-5 text-accent shrink-0" />
            <div className="min-w-0 flex-1">
              <b className="block text-[15px] font-bold">{provider.name}</b>
              {provider.category && <span className="block text-[12.5px] text-text-industrial/60 truncate">{provider.category}</span>}
            </div>
            <button type="button" onClick={() => onProvider(null)} className="min-h-9 px-3 rounded-xl border border-fg/10 bg-surface text-[13px] font-semibold">{t("ob.change")}</button>
          </div>
        ) : <>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-industrial/40" />
            <input id="ob-provider-q" className={`${inputCls} pl-9`} value={query} onChange={e => setQuery(e.target.value)} placeholder={t("ob.providerSearch")} />
          </div>
          <div className="flex flex-col gap-2">
            {filtered.map(p => <RadioRow key={p.id} on={false} onClick={() => onProvider(p)} title={p.name} sub={p.category} />)}
            {!providers.loading && filtered.length === 0 && <p className="text-[13px] text-text-industrial/50 text-center py-3">{t("ob.noResults")}</p>}
          </div>
        </>}
      </Field>
      <Field label={t("ob.srKind")} hint={t("ob.srKindHint")} missing={missKinds}>
        <Chips options={SR_KINDS.map(k => ({ value: k.value, label: t(k.key) }))} value={kinds}
          onChange={v => onKinds(kinds.includes(v) ? kinds.filter(x => x !== v) : [...kinds, v])} />
      </Field>
      {note && <Note icon={<Info className="w-[17px] h-[17px] shrink-0 mt-px" />}>{note}</Note>}
    </>
  );
}

/** "- a\n- b" → ["a", "b"] (formato de las sugerencias de IA). */
export function splitBullets(text: string): string[] {
  return text.split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

export const joinBullets = (items: string[]) => items.map(i => `- ${i}`).join("\n");

/**
 * Sugerencias de IA para lo que pide la aprobación de una OT: criterio de
 * aceptación, bloqueo de energía y nivel de riesgo. Mismos endpoints que el
 * alta de OT de escritorio. Sólo pide lo que se le indica y no pisa nada: el
 * que llama decide qué campos completar con el resultado.
 */
export async function suggestWoSafety(input: {
  assetLabel: string | null;
  vesselCode: string | null;
  taskDesc: string;
  taskType: "PREVENTIVE" | "CORRECTIVE" | "INSPECTION";
  want: { criteria?: boolean; loto?: boolean; risk?: boolean };
}): Promise<{ criteria?: string; loto?: string; risk?: string }> {
  const base = { assetLabel: input.assetLabel, vesselCode: input.vesselCode, taskDesc: input.taskDesc, taskType: input.taskType };
  const out: { criteria?: string; loto?: string; risk?: string } = {};
  if (input.want.criteria) {
    const r = await api.post<{ text: string }>("/app/pms/work-orders/suggest-acceptance-criteria", base);
    if (r.text) out.criteria = r.text;
  }
  if (input.want.loto) {
    const r = await api.post<{ text: string }>("/app/pms/work-orders/suggest-loto", { ...base, acceptanceCriteria: out.criteria ?? null });
    if (r.text) out.loto = r.text;
  }
  if (input.want.risk) {
    const r = await api.post<{ level: string }>("/app/pms/work-orders/suggest-risk", { ...base, acceptanceCriteria: out.criteria ?? null, loto: out.loto ?? null });
    if (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(r.level)) out.risk = r.level;
  }
  return out;
}

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
