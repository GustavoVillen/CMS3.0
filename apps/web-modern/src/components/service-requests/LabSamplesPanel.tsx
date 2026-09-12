// MUESTRAS QUE SE ENVÍAN AL LABORATORIO — panel del formulario de la SS.
//
// Cuando la SS es el pedido a un laboratorio, con ella se despachan frascos
// numerados. Anotar acá esos NÚMEROS antes de mandarlos es lo que después
// permite cotejar cada reporte que vuelve contra la muestra que lo estaba
// esperando, en vez de adivinar el equipo por el nombre que usa el laboratorio.
//
// Las filas no se inventan: son las muestras que la OT ya dejó abiertas (una por
// rutina de muestreo del plan). Se pueden agregar más a mano para el caso del
// re-muestreo o del equipo sin rutina.
//
// El número se guarda al salir del campo (edición en línea, sin botón Guardar):
// el envío se numera frasco por frasco, con la caja al lado.

import React, { useState } from "react";
import { Plus, Trash2, Loader2, Beaker } from "lucide-react";
import { api } from "../../lib/api";
import { AlertDialog } from "../AlertDialog";
import { AssetSearchDropdown, type AssetOption } from "../AssetSearchDropdown";
import { useT } from "../../lib/i18n";
import {
  FLUID_TYPES, FLUID_LABELS, SAMPLE_KIND_LABELS,
  type FluidType, type SampleKind,
} from "../fluid-analyses/shared";

export interface LabSample {
  id: string;
  sampleCode: string;
  assetId: string;
  assetName: string | null;
  kind: string;
  fluidType: string | null;
  labReference: string | null;
  /** Ya llegó el análisis: la fila queda de sólo lectura. */
  hasResult: boolean;
  /** Agregada a mano al numerar el envío (no sale de una rutina del plan). */
  isExtra: boolean;
}

export interface LabSamplesData {
  items: LabSample[];
  /** Es ESTA SS la que se lleva los frascos (y no el taller mecánico de la misma OT). */
  carriesSamples: boolean;
}

/** Muestras del envío que todavía no tienen número. */
export function countUnnumbered(data: LabSamplesData | null | undefined): number {
  if (!data?.carriesSamples) return 0;
  return data.items.filter(s => !s.hasResult && !s.labReference).length;
}

const SAMPLE_KINDS = ["FLUID", "VIBRATION", "THERMAL", "ULTRASOUND", "OTHER"] as const;

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-lg px-2 py-1 text-[12px] text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-50";

export function LabSamplesPanel({ srId, data, editable, onChanged, vesselCode }: {
  srId: string;
  data: LabSamplesData;
  /** Con la SS dada de baja el panel se ve pero no se toca. */
  editable: boolean;
  /** Se llama después de cada guardado para refrescar la lista del padre. */
  onChanged: () => void | Promise<void>;
  vesselCode: string;
}) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lo tipeado por fila, mientras el foco está adentro. Se suelta al guardar.
  const [draft, setDraft] = useState<Record<string, string>>({});

  // Alta de una muestra que no sale de una rutina del plan.
  const [adding, setAdding] = useState(false);
  const [assets, setAssets] = useState<AssetOption[] | null>(null);
  const [newAssetId, setNewAssetId] = useState("");
  const [newKind, setNewKind] = useState<SampleKind>("FLUID");
  const [newFluidType, setNewFluidType] = useState<FluidType>("ENGINE_OIL");
  const [newNumber, setNewNumber] = useState("");

  const missing = countUnnumbered(data);

  const save = async (body: unknown) => {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/app/pms/service-requests/${srId}/lab-samples`, body);
      await onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ss.labSamples.saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Guarda el número al salir del campo, sólo si cambió. */
  const commitNumber = async (sample: LabSample) => {
    const typed = draft[sample.id];
    if (typed === undefined) return;
    if (typed.trim() === (sample.labReference ?? "")) {
      setDraft(d => { const { [sample.id]: _, ...rest } = d; return rest; });
      return;
    }
    const ok = await save({ numbers: [{ sampleId: sample.id, labReference: typed.trim() || null }] });
    // Si falló, se conserva lo tipeado para que el usuario pueda corregirlo.
    if (ok) setDraft(d => { const { [sample.id]: _, ...rest } = d; return rest; });
  };

  const openAdd = async () => {
    setAdding(true);
    if (assets === null) {
      try {
        const res = await api.get<{ items: Array<{ id: string; assetCode: string; name: string | null }> }>(
          `/app/assets?vesselCode=${encodeURIComponent(vesselCode)}`,
        );
        setAssets(res.items ?? []);
      } catch {
        setAssets([]);
        setError(t("ss.labSamples.assetsFailed"));
      }
    }
  };

  const addSample = async () => {
    if (!newAssetId) { setError(t("ss.labSamples.pickAssetFirst")); return; }
    const ok = await save({
      extras: [{
        assetId: newAssetId,
        kind: newKind,
        fluidType: newKind === "FLUID" ? newFluidType : null,
        labReference: newNumber.trim() || null,
      }],
    });
    if (ok) {
      setNewAssetId(""); setNewNumber(""); setNewKind("FLUID"); setNewFluidType("ENGINE_OIL");
      setAdding(false);
    }
  };

  const removeSample = (sample: LabSample) => void save({ removeSampleIds: [sample.id] });

  /** Tipo de muestreo en palabras: el fluido cuando lo hay, el kind si no. */
  const kindLabel = (s: LabSample) => {
    if (s.kind === "FLUID") {
      return s.fluidType
        ? (FLUID_LABELS[s.fluidType as FluidType] ?? s.fluidType)
        : SAMPLE_KIND_LABELS.FLUID;
    }
    return SAMPLE_KIND_LABELS[s.kind as SampleKind] ?? s.kind;
  };

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/[0.05] p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Beaker className="w-4 h-4 text-accent shrink-0" />
        <p className="text-xs font-bold text-fg">{t("ss.labSamples.title")}</p>
        {missing > 0 ? (
          <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-bold text-amber-700 dark:text-amber-400">
            {t("ss.labSamples.missing").replace("{n}", String(missing))}
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-full bg-success-sea/15 border border-success-sea/30 text-[10px] font-bold text-success-sea">
            {t("ss.labSamples.allNumbered")}
          </span>
        )}
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />}
      </div>

      <p className="text-[11px] text-text-industrial/60">{t("ss.labSamples.hint")}</p>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-text-industrial/50">
            <tr className="text-left">
              <th className="font-semibold px-1 py-1">{t("ss.labSamples.colAsset")}</th>
              <th className="font-semibold px-1 py-1">{t("ss.labSamples.colKind")}</th>
              <th className="font-semibold px-1 py-1 w-44">{t("ss.labSamples.colNumber")}</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-fg/5">
            {data.items.map(s => (
              <tr key={s.id}>
                <td className="px-1 py-1 text-fg">
                  {s.assetName ?? s.assetId}
                  <span className="block text-[10px] text-text-industrial/40 font-mono">{s.sampleCode}</span>
                </td>
                <td className="px-1 py-1 text-text-industrial/70">{kindLabel(s)}</td>
                <td className="px-1 py-1">
                  {s.hasResult ? (
                    <span className="font-mono text-fg">
                      {s.labReference ?? "—"}
                      <span className="block text-[10px] text-success-sea font-sans">{t("ss.labSamples.hasResult")}</span>
                    </span>
                  ) : (
                    <input
                      className={`${inputCls} font-mono`}
                      value={draft[s.id] ?? s.labReference ?? ""}
                      disabled={!editable || saving}
                      placeholder={t("ss.labSamples.numberPh")}
                      onChange={e => setDraft(d => ({ ...d, [s.id]: e.target.value }))}
                      onBlur={() => { void commitNumber(s); }}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                    />
                  )}
                </td>
                <td className="px-1 py-1">
                  {/* Sólo las agregadas a mano se quitan: la que sale de una rutina
                      del plan es evidencia de que ese ítem se ejecutó. */}
                  {editable && s.isExtra && !s.hasResult && (
                    <button type="button" onClick={() => removeSample(s)} disabled={saving}
                      className="text-text-industrial/30 hover:text-red-500 disabled:opacity-40"
                      title={t("ss.labSamples.remove")}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable && (adding ? (
        <div className="rounded-lg border border-fg/10 bg-bg/50 p-2 space-y-2">
          <AssetSearchDropdown
            assets={assets ?? []}
            value={newAssetId}
            onChange={setNewAssetId}
            disabled={assets === null}
            placeholder={assets === null ? t("common.loading") : t("ss.labSamples.pickAsset")}
          />
          <div className="flex flex-wrap gap-2">
            <select value={newKind} onChange={e => setNewKind(e.target.value as SampleKind)}
              className="bg-fg/5 border border-fg/10 rounded-lg px-2 py-1 text-[12px] text-fg">
              {SAMPLE_KINDS.map(k => <option key={k} value={k}>{SAMPLE_KIND_LABELS[k]}</option>)}
            </select>
            {newKind === "FLUID" && (
              <select value={newFluidType} onChange={e => setNewFluidType(e.target.value as FluidType)}
                className="bg-fg/5 border border-fg/10 rounded-lg px-2 py-1 text-[12px] text-fg">
                {FLUID_TYPES.map(ft => <option key={ft} value={ft}>{FLUID_LABELS[ft]}</option>)}
              </select>
            )}
            <input className={`${inputCls} font-mono max-w-[180px]`} value={newNumber}
              placeholder={t("ss.labSamples.numberPh")}
              onChange={e => setNewNumber(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); setNewAssetId(""); setNewNumber(""); }}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-text-industrial/60 hover:bg-fg/5">
              {t("common.cancel")}
            </button>
            <button type="button" onClick={() => { void addSample(); }} disabled={saving || !newAssetId}
              className="px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/30 text-[11px] font-bold text-accent hover:bg-accent/25 disabled:opacity-40">
              {t("ss.labSamples.addConfirm")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { void openAdd(); }}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-accent hover:bg-accent/10">
          <Plus className="w-3.5 h-3.5" /> {t("ss.labSamples.add")}
        </button>
      ))}

      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </div>
  );
}
