// Carga masiva de reportes de laboratorio: se sueltan todos los PDF juntos, el
// sistema los lee y muestra UNA tabla con lo que va a guardar. Recién cuando el
// usuario confirma se escribe en la base.
//
// Tres pantallas: elegir archivos → revisar → resumen.
//
// La revisión no es un trámite: el laboratorio nombra a los equipos con su
// propia jerga ("MOTOR PROPULSOR N1" por "Motor Principal #1"), así que la
// identificación del equipo es una inferencia de la IA. Las filas dudosas se
// marcan en ámbar y las que no se pudieron resolver quedan bloqueadas hasta que
// se elija el equipo a mano.
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  FlaskConical, Loader2, CheckCircle2, AlertTriangle, XCircle, FileText, Upload, Link2, Wrench,
} from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { useT, type TranslationKey } from "../../lib/i18n";
import { AlertDialog } from "../AlertDialog";
import {
  ModalShell, VerdictBadge, inputCls, labelCls, FLUID_TYPES, FLUID_LABELS,
  type Verdict, type FluidType, type AssetItem,
} from "./shared";

type Step = "pick" | "scanning" | "review" | "done";

type BatchWarning =
  | "VESSEL_NOT_RESOLVED" | "ASSET_NOT_RESOLVED" | "ASSET_LOW_CONFIDENCE"
  | "SAMPLE_NUMBER_MISSING" | "SAMPLE_NUMBER_MISMATCH" | "SAMPLED_AT_MISSING"
  | "VERDICT_MISSING" | "VERDICT_MISMATCH" | "FLUID_TYPE_ASSUMED" | "NO_PARAMETERS";

interface ScanRow {
  fileName: string;
  file: { url: string; name: string; mime: string };
  sampleNumber: string | null;
  vesselCode: string | null;
  vesselReferenceText: string | null;
  assetId: string | null;
  assetName: string | null;
  assetReferenceText: string | null;
  assetConfidence: "high" | "medium" | "low" | null;
  assetReason: string | null;
  fluidType: FluidType;
  fluidProduct: string | null;
  sampledAt: string | null;
  receivedAt: string | null;
  runningHours: number | null;
  labName: string | null;
  verdict: Verdict | null;
  summary: string | null;
  parameters: Record<string, { value: number | string; unit?: string }>;
  duplicateOf: { id: string; sampleCode: string; vesselCode: string } | null;
  attachTo: { id: string; sampleCode: string; sampledAt: string } | null;
  aiNotes: string | null;
  warnings: BatchWarning[];
}

interface CommitResult {
  fileName: string;
  status: "created" | "attached" | "skipped" | "failed";
  sampleId: string | null;
  sampleCode: string | null;
  verdict: Verdict | null;
  workOrderCode: string | null;
  serviceRequestCodes: string[];
  reason: "DUPLICATE" | "MISSING_FIELDS" | "VESSEL_OUT_OF_SCOPE" | "ERROR" | null;
  message: string | null;
}

/** Lo que devuelve abrir la OT del lote. */
interface BatchWoResult {
  workOrderId: string;
  workOrderCode: string;
  status: string;
  autoAuthorized: boolean;
  serviceRequests: Array<{ code: string; provider: string | null; status: string }>;
  plans: Array<{ taskCode: string; title: string }>;
  linkedSamples: number;
  skipped: Array<{ sampleCode: string; reason: "NO_PLAN" | "ALREADY_LINKED" | "OTHER_VESSEL" }>;
}

/** Fila fallida durante la lectura: el PDF no se pudo procesar. */
interface FailedScan { fileName: string; message: string; }

const WARNING_KEYS: Record<BatchWarning, TranslationKey> = {
  VESSEL_NOT_RESOLVED:    "fa.batch.warn.vessel",
  ASSET_NOT_RESOLVED:     "fa.batch.warn.asset",
  ASSET_LOW_CONFIDENCE:   "fa.batch.warn.assetLow",
  SAMPLE_NUMBER_MISSING:  "fa.batch.warn.noNumber",
  SAMPLE_NUMBER_MISMATCH: "fa.batch.warn.numberMismatch",
  SAMPLED_AT_MISSING:     "fa.batch.warn.noDate",
  VERDICT_MISSING:        "fa.batch.warn.noVerdict",
  VERDICT_MISMATCH:       "fa.batch.warn.verdictMismatch",
  FLUID_TYPE_ASSUMED:     "fa.batch.warn.fluidType",
  NO_PARAMETERS:          "fa.batch.warn.noParams",
};

const SKIP_REASON_KEYS: Record<NonNullable<CommitResult["reason"]>, TranslationKey> = {
  DUPLICATE:           "fa.batch.skip.duplicate",
  MISSING_FIELDS:      "fa.batch.skip.missing",
  VESSEL_OUT_OF_SCOPE: "fa.batch.skip.scope",
  ERROR:               "fa.batch.skip.error",
};

interface Props {
  vessels: Array<{ code: string; name: string | null }>;
  onClose: () => void;
  /** Se llama al terminar si se guardó al menos un análisis. */
  onSaved?: () => void;
  /** Ir al módulo de Análisis de Fluidos desde el resumen. */
  onGoToModule?: () => void;
}

export const FluidBatchUploadModal: React.FC<Props> = ({ vessels, onClose, onSaved, onGoToModule }) => {
  const t = useT();
  const [step, setStep] = useState<Step>("pick");
  const [alert, setAlert] = useState<string | null>(null);

  const [vesselHint, setVesselHint] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [failed, setFailed] = useState<FailedScan[]>([]);

  // Equipos por buque, sólo de los buques que aparecieron en el lote.
  const [assetsByVessel, setAssetsByVessel] = useState<Record<string, AssetItem[]>>({});
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<CommitResult[]>([]);

  // Paso opcional del final: abrir UNA OT (con su SS al laboratorio) por las
  // rutinas de muestreo que ejecutan estos análisis. No se dispara solo — la SS
  // compromete gasto, la decide el usuario.
  const [woOpening, setWoOpening] = useState(false);
  const [woResult, setWoResult] = useState<BatchWoResult | null>(null);
  const [woDismissed, setWoDismissed] = useState(false);

  // Buques ya pedidos: evita repetir el fetch cuando varias filas comparten buque.
  const requestedVessels = useRef<Set<string>>(new Set());

  const loadAssets = useCallback(async (code: string) => {
    if (!code || requestedVessels.current.has(code)) return;
    requestedVessels.current.add(code);
    try {
      const res = await api.get<{ items: AssetItem[] }>(`/app/assets?vesselCode=${encodeURIComponent(code)}`);
      setAssetsByVessel(prev => ({ ...prev, [code]: res.items ?? [] }));
    } catch {
      setAssetsByVessel(prev => ({ ...prev, [code]: [] }));
    }
  }, []);

  // ── Paso 1 → 2: leer los archivos, de a uno ───────────────────────────────
  const runScan = useCallback(async () => {
    if (files.length === 0) { setAlert(t("fa.batch.noFiles")); return; }
    setStep("scanning");
    setRows([]);
    setFailed([]);
    setProgress({ done: 0, total: files.length, current: files[0]!.name });

    const okRows: ScanRow[] = [];
    const koRows: FailedScan[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      setProgress({ done: i, total: files.length, current: f.name });
      try {
        const row = await api.uploadRaw<ScanRow>("/app/fluid-analyses/batch-scan", f, {
          "X-Filename": encodeURIComponent(f.name),
          ...(vesselHint ? { "X-Vessel-Code": vesselHint } : {}),
        });
        okRows.push(row);
      } catch (e) {
        koRows.push({ fileName: f.name, message: e instanceof ApiError ? e.message : t("fa.batch.readFailed") });
      }
    }
    setProgress({ done: files.length, total: files.length, current: "" });
    setRows(okRows);
    setFailed(koRows);

    // Precargamos los equipos de los buques detectados: son los desplegables
    // que el usuario va a necesitar para corregir.
    const codes = Array.from(new Set(okRows.map(r => r.vesselCode).filter((c): c is string => !!c)));
    await Promise.all(codes.map(loadAssets));

    setStep("review");
    if (okRows.length === 0 && koRows.length > 0) setAlert(t("fa.batch.allFailed"));
  }, [files, vesselHint, loadAssets, t]);

  // ── Edición de una fila en la revisión ────────────────────────────────────
  const patchRow = (index: number, patch: Partial<ScanRow>) => {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r));
  };

  const changeVessel = async (index: number, code: string) => {
    // Cambiar de buque invalida el equipo: los equipos son de un buque.
    patchRow(index, { vesselCode: code || null, assetId: null, assetName: null, assetConfidence: null, attachTo: null });
    await loadAssets(code);
  };

  // ── Filas que se van a guardar ────────────────────────────────────────────
  const savable = useMemo(
    () => rows.filter(r => !r.duplicateOf && r.vesselCode && r.assetId && r.sampledAt && r.verdict),
    [rows],
  );
  const duplicates = useMemo(() => rows.filter(r => r.duplicateOf), [rows]);
  const blocked = useMemo(
    () => rows.filter(r => !r.duplicateOf && !(r.vesselCode && r.assetId && r.sampledAt && r.verdict)),
    [rows],
  );

  // ── Paso 2 → 3: guardar ───────────────────────────────────────────────────
  const commit = useCallback(async () => {
    if (savable.length === 0) { setAlert(t("fa.batch.nothingToSave")); return; }
    setSaving(true);
    try {
      const res = await api.post<{ items: CommitResult[] }>("/app/fluid-analyses/batch-commit", {
        rows: savable.map(r => ({
          fileName: r.fileName,
          file: r.file,
          sampleNumber: r.sampleNumber,
          vesselCode: r.vesselCode,
          assetId: r.assetId,
          fluidType: r.fluidType,
          fluidProduct: r.fluidProduct,
          sampledAt: r.sampledAt,
          receivedAt: r.receivedAt,
          runningHours: r.runningHours,
          labName: r.labName,
          verdict: r.verdict,
          summary: r.summary,
          parameters: r.parameters,
          attachToSampleId: r.attachTo?.id ?? null,
        })),
      });
      setResults(res.items ?? []);
      setStep("done");
      if ((res.items ?? []).some(i => i.status === "created" || i.status === "attached")) onSaved?.();
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [savable, onSaved, t]);

  // Análisis guardados que todavía no cuelgan de ninguna OT: son los que la
  // orden nueva puede cubrir.
  const samplesWithoutWo = useMemo(
    () => results.filter(r => (r.status === "created" || r.status === "attached") && r.sampleId && !r.workOrderCode),
    [results],
  );

  const openWorkOrder = useCallback(async () => {
    setWoOpening(true);
    try {
      const res = await api.post<BatchWoResult>("/app/fluid-analyses/batch-open-work-order", {
        sampleIds: samplesWithoutWo.map(r => r.sampleId),
      });
      setWoResult(res);
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : t("fa.batch.wo.failed"));
    } finally {
      setWoOpening(false);
    }
  }, [samplesWithoutWo, t]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <ModalShell title={t("fa.batch.title")} onClose={onClose} wide>
        {step === "pick" && (
          <div className="space-y-4">
            <p className="text-xs text-text-industrial/60 leading-relaxed">{t("fa.batch.help")}</p>

            <div>
              <label className={labelCls}>{t("fa.batch.vesselOptional")}</label>
              <select value={vesselHint} onChange={e => setVesselHint(e.target.value)} className={inputCls}>
                <option value="">{t("fa.batch.vesselAuto")}</option>
                {vessels.map(v => <option key={v.code} value={v.code}>{v.name ?? v.code}</option>)}
              </select>
              <p className="text-[10px] text-text-industrial/45 mt-1">{t("fa.batch.vesselHelp")}</p>
            </div>

            <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-success-sea/40 hover:border-success-sea/70 p-8 text-center cursor-pointer transition-colors">
              <Upload className="w-8 h-8 text-success-sea" />
              <span className="text-xs font-bold text-fg">{t("fa.batch.pickFiles")}</span>
              <span className="text-[10px] text-text-industrial/45">{t("fa.batch.pickHint")}</span>
              <input
                type="file"
                accept=".pdf,image/*"
                multiple
                className="hidden"
                onChange={e => setFiles(Array.from(e.target.files ?? []))}
              />
            </label>

            {files.length > 0 && (
              <div className="rounded-xl border border-fg/10 divide-y divide-fg/5 max-h-52 overflow-y-auto">
                {files.map(f => (
                  <div key={f.name} className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-industrial/70">
                    <FileText className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />
                    <span className="truncate">{f.name}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-text-industrial/60 hover:bg-fg/5">
                {t("common.cancel")}
              </button>
              <button
                onClick={() => void runScan()}
                disabled={files.length === 0}
                className="px-4 py-2 rounded-xl bg-success-sea/15 border border-success-sea/40 text-xs font-bold text-fg hover:bg-success-sea/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {fill(t("fa.batch.process"), { n: files.length })}
              </button>
            </div>
          </div>
        )}

        {step === "scanning" && (
          <div className="py-10 flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 text-success-sea animate-spin" />
            <p className="text-sm font-bold text-fg">
              {fill(t("fa.batch.reading"), { done: progress.done + 1, total: progress.total })}
            </p>
            <p className="text-[11px] text-text-industrial/50 truncate max-w-full px-6">{progress.current}</p>
            <div className="w-full max-w-md h-1.5 rounded-full bg-fg/10 overflow-hidden">
              <div
                className="h-full bg-success-sea transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-[10px] text-text-industrial/40">{t("fa.batch.readingHint")}</p>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <Chip tone="green" label={fill(t("fa.batch.countSave"), { n: savable.length })} />
              {duplicates.length > 0 && <Chip tone="gray" label={fill(t("fa.batch.countDup"), { n: duplicates.length })} />}
              {blocked.length > 0 && <Chip tone="amber" label={fill(t("fa.batch.countBlocked"), { n: blocked.length })} />}
              {failed.length > 0 && <Chip tone="red" label={fill(t("fa.batch.countFailed"), { n: failed.length })} />}
            </div>

            <div className="overflow-x-auto rounded-xl border border-fg/10">
              <table className="w-full text-[11px]">
                <thead className="bg-fg/5 text-text-industrial/50">
                  <tr>
                    <Th>{t("fa.batch.colFile")}</Th>
                    <Th>{t("form.vessel")}</Th>
                    <Th>{t("fa.batch.colAsset")}</Th>
                    <Th>{t("fa.batch.colFluid")}</Th>
                    <Th>{t("fa.batch.colNumber")}</Th>
                    <Th>{t("fa.batch.colDate")}</Th>
                    <Th>{t("fa.batch.colVerdict")}</Th>
                    <Th>{t("fa.batch.colAction")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-fg/5">
                  {rows.map((r, i) => {
                    const isDup = !!r.duplicateOf;
                    const assets = r.vesselCode ? (assetsByVessel[r.vesselCode] ?? []) : [];
                    const needsAsset = !isDup && !r.assetId;
                    return (
                      <tr key={r.fileName + i} className={isDup ? "opacity-45" : needsAsset ? "bg-amber-500/5" : ""}>
                        <Td>
                          <span className="block max-w-[200px] truncate" title={r.fileName}>{r.fileName}</span>
                          {r.warnings.length > 0 && (
                            <span className="block mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                              {r.warnings.map(w => t(WARNING_KEYS[w])).join(" · ")}
                            </span>
                          )}
                        </Td>
                        <Td>
                          <select
                            value={r.vesselCode ?? ""}
                            disabled={isDup}
                            onChange={e => void changeVessel(i, e.target.value)}
                            className="bg-fg/5 border border-fg/10 rounded-lg px-2 py-1 text-[11px] text-fg max-w-[150px] disabled:opacity-60"
                          >
                            <option value="">—</option>
                            {vessels.map(v => <option key={v.code} value={v.code}>{v.name ?? v.code}</option>)}
                          </select>
                        </Td>
                        <Td>
                          <select
                            value={r.assetId ?? ""}
                            disabled={isDup || !r.vesselCode}
                            onChange={e => {
                              const id = e.target.value;
                              const a = assets.find(x => x.id === id);
                              patchRow(i, {
                                assetId: id || null,
                                assetName: a?.name ?? a?.assetCode ?? null,
                                assetConfidence: id ? "high" : null,
                                assetReason: null,
                              });
                            }}
                            className={`bg-fg/5 border rounded-lg px-2 py-1 text-[11px] text-fg max-w-[220px] disabled:opacity-60 ${
                              needsAsset ? "border-amber-500/60" : "border-fg/10"
                            }`}
                          >
                            <option value="">{t("fa.batch.pickAsset")}</option>
                            {assets.map(a => (
                              <option key={a.id} value={a.id}>{a.name ?? a.assetCode ?? a.id}</option>
                            ))}
                          </select>
                          {r.assetReferenceText && (
                            <span className="block mt-0.5 text-[10px] text-text-industrial/40 truncate max-w-[220px]">
                              {fill(t("fa.batch.reportSays"), { text: r.assetReferenceText })}
                            </span>
                          )}
                        </Td>
                        <Td>
                          <select
                            value={r.fluidType}
                            disabled={isDup}
                            onChange={e => patchRow(i, { fluidType: e.target.value as FluidType })}
                            className="bg-fg/5 border border-fg/10 rounded-lg px-2 py-1 text-[11px] text-fg max-w-[130px] disabled:opacity-60"
                          >
                            {FLUID_TYPES.map(ft => <option key={ft} value={ft}>{FLUID_LABELS[ft]}</option>)}
                          </select>
                        </Td>
                        <Td>{r.sampleNumber ?? "—"}</Td>
                        <Td>{r.sampledAt ?? "—"}</Td>
                        <Td>{r.verdict ? <VerdictBadge verdict={r.verdict} /> : "—"}</Td>
                        <Td>
                          {isDup ? (
                            <span className="text-text-industrial/50">
                              {fill(t("fa.batch.actionDuplicate"), { code: r.duplicateOf!.sampleCode })}
                            </span>
                          ) : needsAsset || !r.vesselCode || !r.sampledAt || !r.verdict ? (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">{t("fa.batch.actionBlocked")}</span>
                          ) : r.attachTo ? (
                            <span className="inline-flex items-center gap-1 text-accent font-semibold">
                              <Link2 className="w-3 h-3" />
                              {fill(t("fa.batch.actionAttach"), { code: r.attachTo.sampleCode })}
                            </span>
                          ) : (
                            <span className="text-success-sea font-semibold">{t("fa.batch.actionCreate")}</span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {failed.length > 0 && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 space-y-1">
                <p className="text-[11px] font-bold text-red-700 dark:text-red-400">{t("fa.batch.failedTitle")}</p>
                {failed.map(f => (
                  <p key={f.fileName} className="text-[10px] text-text-industrial/60">{f.fileName} — {f.message}</p>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-text-industrial/60 hover:bg-fg/5">
                {t("common.cancel")}
              </button>
              <button
                onClick={() => void commit()}
                disabled={saving || savable.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-success-sea/15 border border-success-sea/40 text-xs font-bold text-fg hover:bg-success-sea/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {fill(t("fa.batch.save"), { n: savable.length })}
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-success-sea" />
              <p className="text-sm font-bold text-fg">{t("fa.batch.doneTitle")}</p>
            </div>
            <div className="rounded-xl border border-fg/10 divide-y divide-fg/5 max-h-80 overflow-y-auto">
              {results.map((r, i) => (
                <div key={r.fileName + i} className="flex items-center gap-2 px-3 py-2">
                  {r.status === "created" || r.status === "attached"
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-success-sea shrink-0" />
                    : r.status === "skipped"
                      ? <AlertTriangle className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                  <span className="text-[11px] text-text-industrial/70 truncate flex-1" title={r.fileName}>{r.fileName}</span>
                  <span className="text-[10px] font-semibold shrink-0 text-right">
                    {r.status === "created"  && fill(t("fa.batch.resCreated"), { code: r.sampleCode ?? "" })}
                    {r.status === "attached" && fill(t("fa.batch.resAttached"), { code: r.sampleCode ?? "" })}
                    {r.status === "skipped"  && t(SKIP_REASON_KEYS[r.reason ?? "ERROR"])}
                    {r.status === "failed"   && (r.message ?? t("fa.batch.skip.error"))}
                    {/* De qué OT y qué pedido al taller venía este análisis. */}
                    {r.workOrderCode && (
                      <span className="block font-normal text-text-industrial/50">
                        {r.workOrderCode}
                        {r.serviceRequestCodes.length > 0 ? ` · ${r.serviceRequestCodes.join(" · ")}` : ""}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {/* Abrir la OT del muestreo. Aparece sólo si quedaron análisis sin
                orden; una vez abierta, muestra los números. */}
            {woResult ? (
              <div className="rounded-xl border border-accent/30 bg-accent/[0.07] p-3 space-y-1.5">
                <p className="text-[11px] font-bold text-accent uppercase tracking-widest">{t("fa.batch.wo.doneTitle")}</p>
                <p className="text-sm font-bold text-fg font-mono">{woResult.workOrderCode}</p>
                {woResult.serviceRequests.map(sr => (
                  <p key={sr.code} className="text-[11px] text-fg font-mono">
                    {sr.code}
                    {sr.provider ? <span className="text-text-industrial/60 font-sans"> · {sr.provider}</span> : null}
                  </p>
                ))}
                <p className="text-[10px] text-text-industrial/60">
                  {fill(t("fa.batch.wo.linked"), { n: woResult.linkedSamples, plans: woResult.plans.length })}
                </p>
                <p className="text-[10px] text-text-industrial/60">
                  {woResult.autoAuthorized ? t("fa.batch.wo.autoAuthorized") : t("fa.batch.wo.needsApproval")}
                </p>
                {woResult.skipped.length > 0 && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">
                    {fill(t("fa.batch.wo.skipped"), { n: woResult.skipped.length })}
                  </p>
                )}
              </div>
            ) : samplesWithoutWo.length > 0 && !woDismissed ? (
              <div className="rounded-xl border border-accent/25 bg-accent/[0.05] p-3 flex items-center gap-3 flex-wrap">
                <Wrench className="w-4 h-4 text-accent shrink-0" />
                <p className="text-[11px] text-fg flex-1 min-w-[200px]">
                  {fill(t("fa.batch.wo.offer"), { n: samplesWithoutWo.length })}
                </p>
                <button
                  type="button"
                  onClick={() => setWoDismissed(true)}
                  className="px-3 py-1.5 rounded-lg text-[11px] text-text-industrial hover:text-fg"
                >
                  {t("fa.batch.wo.no")}
                </button>
                <button
                  type="button"
                  disabled={woOpening}
                  onClick={() => void openWorkOrder()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 disabled:opacity-50"
                >
                  {woOpening && <Loader2 className="w-3 h-3 animate-spin" />}
                  {t("fa.batch.wo.yes")}
                </button>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              {onGoToModule && (
                <button
                  onClick={onGoToModule}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/10 border border-accent/30 text-xs font-bold text-fg hover:bg-accent/20"
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  {t("fa.batch.goToModule")}
                </button>
              )}
              <button onClick={onClose} className="px-4 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs font-bold text-fg hover:bg-fg/10">
                {t("common.close")}
              </button>
            </div>
          </div>
        )}
      </ModalShell>

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </>
  );
};

// ── Piezas chicas ────────────────────────────────────────────────────────────

/** Reemplaza los {placeholders} de una traducción. `useT()` no interpola. */
function fill(text: string, vars: Record<string, string | number>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th className="text-left font-bold uppercase tracking-wider px-3 py-2 whitespace-nowrap">{children}</th>
);

const Td: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <td className="px-3 py-2 align-top text-text-industrial/70">{children}</td>
);

const Chip: React.FC<{ tone: "green" | "amber" | "red" | "gray"; label: string }> = ({ tone, label }) => {
  const cls = {
    green: "bg-success-sea/10 border-success-sea/30 text-success-sea",
    amber: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400",
    red:   "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400",
    gray:  "bg-fg/5 border-fg/10 text-text-industrial/50",
  }[tone];
  return <span className={`px-2 py-0.5 rounded-full border font-bold ${cls}`}>{label}</span>;
};
