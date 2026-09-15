// Datos y controles que comparten varias pantallas de la App a bordo.

import React, { useMemo, useRef } from "react";
import { Mic, Square, Camera, X } from "lucide-react";
import { useT } from "../lib/i18n";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useSpeechToText } from "../lib/use-speech-to-text";
import { WO_OPEN_STATUSES, type PickerWorkOrder } from "../components/service-requests/OpenWorkOrdersPicker";

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
