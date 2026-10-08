// Recepción de repuestos: lo que llegó al buque se registra acá, con el remito
// en papel escaneado o cargando las líneas a mano.
//
// El punto de toda la pantalla es NO duplicar el repuesto. Por eso el orden es
// al revés del formulario clásico: primero se busca en el stock del buque y
// recién si ninguno es, se crea. Las líneas que la IA no puede resolver sola
// quedan en ámbar y no se pueden guardar hasta que el usuario elija; el alta de
// un repuesto nuevo se elige siempre con los parecidos a la vista ("Ninguno:
// cargarlo como nuevo", o "No es ninguno: cargar «X»" debajo del buscador). El
// nombre buscado pasa a la ficha y el código, si queda vacío, lo pone el servidor.
//
// Tres pasos: datos del remito → revisión → resumen. Nada se escribe en la base
// hasta el botón de confirmar.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { GuideNeedTag, RequiredMark } from "../GuideKit";
import {
  PackagePlus, Upload, Loader2, CheckCircle2, AlertTriangle, Search, Plus, Trash2, FileText,
} from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { AlertDialog } from "../AlertDialog";
import { ModalCloseButton } from "../ModalCloseButton";

type Step = "setup" | "scanning" | "review" | "done";

interface Candidate {
  id: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  score: number;
}

interface ScanLine {
  line: number;
  description: string;
  quantity: number | null;
  unit: string | null;
  partNumber: string | null;
  manufacturer: string | null;
  confidence: "high" | "medium" | "low";
  status: "matched" | "ambiguous" | "new";
  spareId: string | null;
  spareSku: string | null;
  spareName: string | null;
  spareUnit: string | null;
  spareOnHand: number | null;
  score: number;
  matchReason: string | null;
  aiReason: string | null;
  candidates: Candidate[];
}

interface ScanResult {
  vesselCode: string;
  documentNumber: string | null;
  providerName: string | null;
  providerId: string | null;
  receivedAt: string | null;
  notes: string | null;
  file: { url: string; name: string; mime: string };
  duplicateOf: { id: string; receiptCode: string; receivedAt: string } | null;
  lines: ScanLine[];
}

interface CommitResultLine {
  spareId: string; sku: string; name: string; quantity: number; unit: string;
  created: boolean; onHandBefore: number; onHandAfter: number;
}

interface Provider { id: string; name: string; }

/** Fila de la revisión: lo del remito + lo que decidió el usuario. */
interface Row {
  key: string;
  description: string;
  partNumber: string | null;
  quantity: string;
  unit: string;
  status: "matched" | "ambiguous" | "new";
  spareId: string | null;
  spareSku: string | null;
  spareName: string | null;
  spareOnHand: number | null;
  aiReason: string | null;
  candidates: Candidate[];
  /** Viene del remito leído. Si no, se cargó a mano desde "Agregar un ítem". */
  fromScan: boolean;
  /** El usuario confirmó que ninguno de los parecidos es el suyo. */
  confirmedNew: boolean;
  /** Código de la ficha nueva. Vacío: lo asigna el sistema al guardar. */
  newSku: string;
  newName: string;
  newCriticality: "A" | "B" | "C";
}

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-fg/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const labelCls = "block text-[10px] font-bold text-fg/40 uppercase tracking-wider mb-1";

function rowFromScan(l: ScanLine): Row {
  return {
    key: `scan-${l.line}`,
    description: l.description,
    partNumber: l.partNumber,
    quantity: l.quantity != null ? String(l.quantity) : "",
    unit: l.unit ?? l.spareUnit ?? "u",
    status: l.status,
    spareId: l.spareId,
    spareSku: l.spareSku,
    spareName: l.spareName,
    spareOnHand: l.spareOnHand,
    aiReason: l.aiReason,
    candidates: l.candidates,
    fromScan: true,
    confirmedNew: false,
    newSku: "",
    newName: l.description,
    newCriticality: "B",
  };
}

/** Qué le falta a la fila para poder guardarse; null si está lista. */
function rowMissing(r: Row): "qty" | "pick" | "name" | null {
  const qty = Number(r.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return "qty";
  if (r.spareId) return null;
  if (!r.confirmedNew) return "pick";
  return r.newName.trim() ? null : "name";
}

/** Una fila está lista cuando apunta a un repuesto real o a un alta confirmada. */
function rowReady(r: Row): boolean {
  return rowMissing(r) === null;
}

const MISSING_MSG = { qty: "rcp.pendingQty", pick: "rcp.pendingPick", name: "rcp.pendingName" } as const;

interface Props {
  vessels: Array<{ code: string; name: string | null }>;
  defaultVesselCode?: string | null;
  onClose: () => void;
  /** Se llama si se guardó la recepción (para refrescar listados). */
  onSaved?: () => void;
}

export const SpareReceiptModal: React.FC<Props> = ({ vessels, defaultVesselCode, onClose, onSaved }) => {
  const t = useT();
  const [step, setStep] = useState<Step>("setup");
  const [alert, setAlert] = useState<string | null>(null);

  // Cabecera del remito
  const [vesselCode, setVesselCode] = useState(defaultVesselCode ?? (vessels.length === 1 ? vessels[0]!.code : ""));
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [docNumber, setDocNumber] = useState("");
  const [providerId, setProviderId] = useState("");
  const [providerName, setProviderName] = useState("");
  const [file, setFile] = useState<ScanResult["file"] | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<ScanResult["duplicateOf"]>(null);
  const [allowDuplicate, setAllowDuplicate] = useState(false);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<CommitResultLine[]>([]);
  const [receiptCode, setReceiptCode] = useState<string | null>(null);
  // Línea recién agregada a mano: su cantidad toma el foco.
  const [focusKey, setFocusKey] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ items: Provider[] }>("/app/providers")
      .then(res => setProviders(res.items ?? []))
      .catch(() => setProviders([]));
  }, []);

  // ── Paso 1 → 2: leer el remito ─────────────────────────────────────────────
  const runScan = useCallback(async (f: File) => {
    if (!vesselCode) { setAlert(t("rcp.noVessel")); return; }
    setStep("scanning");
    try {
      const res = await api.uploadRaw<ScanResult>("/app/pms/goods-receipts/scan", f, {
        "X-Filename": encodeURIComponent(f.name),
        "X-Vessel-Code": vesselCode,
      });
      setFile(res.file);
      setDuplicateOf(res.duplicateOf);
      if (res.documentNumber) setDocNumber(res.documentNumber);
      if (res.receivedAt) setReceivedAt(res.receivedAt);
      if (res.providerId) setProviderId(res.providerId);
      else if (res.providerName) setProviderName(res.providerName);
      setRows(res.lines.map(rowFromScan));
      setStep("review");
      if (res.lines.length === 0) setAlert(t("rcp.scanEmpty"));
    } catch (e) {
      setStep("setup");
      setAlert(e instanceof ApiError ? e.message : t("rcp.scanFailed"));
    }
  }, [vesselCode, t]);

  const goManual = () => {
    if (!vesselCode) { setAlert(t("rcp.noVessel")); return; }
    setRows([]);
    setStep("review");
  };

  // ── Edición de filas ───────────────────────────────────────────────────────
  const patchRow = (key: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));

  const pickSpare = (key: string, c: Candidate) =>
    patchRow(key, {
      status: "matched", spareId: c.id, spareSku: c.sku, spareName: c.name,
      spareOnHand: c.onHand, confirmedNew: false,
    });

  const markNew = (key: string) =>
    patchRow(key, { status: "new", spareId: null, spareSku: null, spareName: null, spareOnHand: null });

  /**
   * Línea cargada a mano: un repuesto del stock (`c`) o un alta nueva con el
   * nombre que se escribió en el buscador, para no tener que tipearlo dos veces.
   */
  const addManualRow = (c: Candidate | null, name = "") => {
    const key = `man-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setRows(prev => [...prev, {
      key,
      description: "",
      partNumber: null,
      quantity: "1",
      unit: c?.unit ?? "u",
      status: c ? "matched" : "new",
      spareId: c?.id ?? null,
      spareSku: c?.sku ?? null,
      spareName: c?.name ?? null,
      spareOnHand: c?.onHand ?? null,
      aiReason: null,
      candidates: [],
      fromScan: false,
      confirmedNew: !c,
      newSku: "",
      newName: name.trim(),
      newCriticality: "B",
    }]);
    setFocusKey(key);
  };

  const pending = useMemo(() => rows.filter(r => !rowReady(r)), [rows]);
  const ready   = useMemo(() => rows.filter(rowReady), [rows]);

  // ── Paso 2 → 3: guardar ────────────────────────────────────────────────────
  const commit = useCallback(async (force = false) => {
    if (rows.length === 0) { setAlert(t("rcp.noLines")); return; }
    // El aviso nombra la línea y lo que le falta, no un "hay ítems sin resolver".
    const firstPending = rows.findIndex(r => !rowReady(r));
    if (firstPending >= 0) {
      const missing = rowMissing(rows[firstPending]!)!;
      setAlert(t(MISSING_MSG[missing]).replace("{n}", String(firstPending + 1)));
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ id: string; receiptCode: string; lines: CommitResultLine[] }>(
        "/app/pms/goods-receipts",
        {
          vesselCode,
          documentNumber: docNumber.trim() || null,
          providerId: providerId || null,
          providerName: providerId ? null : (providerName.trim() || null),
          receivedAt,
          file,
          allowDuplicate: force || allowDuplicate,
          lines: ready.map(r => ({
            quantity: Number(r.quantity),
            unit: r.unit.trim() || "u",
            spareId: r.spareId,
            newSpare: r.spareId ? null : {
              sku: r.newSku.trim().toUpperCase() || null,
              name: r.newName.trim(),
              unit: r.unit.trim() || "u",
              criticality: r.newCriticality,
              manufacturerPartNumber: r.partNumber,
              longDescription: r.description || null,
            },
          })),
        },
      );
      setReceiptCode(res.receiptCode);
      setResults(res.lines);
      setStep("done");
      onSaved?.();
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE_RECEIPT") {
        setAllowDuplicate(true);
        setAlert(`${e.message} ${t("rcp.loadAnyway")}`);
      } else {
        setAlert(e instanceof ApiError ? e.message : t("rcp.saveFailed"));
      }
    } finally {
      setSaving(false);
    }
  }, [rows, ready, vesselCode, docNumber, providerId, providerName, receivedAt, file, allowDuplicate, onSaved, t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-5xl max-h-[92vh] overflow-y-auto bg-surface dark:bg-[#0D1526] border border-fg/10 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-fg/10 sticky top-0 bg-surface dark:bg-[#0D1526] z-10">
          <h2 className="text-sm font-bold text-fg flex items-center gap-2">
            <PackagePlus className="w-4 h-4 text-success-sea" />
            {t("rcp.title")}
          </h2>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="p-5 space-y-4">
          {step === "setup" && (
            <SetupStep
              vessels={vessels}
              vesselCode={vesselCode} setVesselCode={setVesselCode}
              receivedAt={receivedAt} setReceivedAt={setReceivedAt}
              docNumber={docNumber} setDocNumber={setDocNumber}
              providers={providers}
              providerId={providerId} setProviderId={setProviderId}
              providerName={providerName} setProviderName={setProviderName}
              onFile={runScan}
              onManual={goManual}
            />
          )}

          {step === "scanning" && (
            <div className="py-16 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-success-sea animate-spin" />
              <p className="text-sm font-bold text-fg">{t("rcp.scanning")}</p>
              <p className="text-xs text-fg/40">{t("rcp.scanningHint")}</p>
            </div>
          )}

          {step === "review" && (
            <ReviewStep
              vesselCode={vesselCode}
              rows={rows}
              file={file}
              duplicateOf={duplicateOf}
              pendingCount={pending.length}
              saving={saving}
              focusKey={focusKey}
              onPatch={patchRow}
              onPick={pickSpare}
              onMarkNew={markNew}
              onAdd={c => addManualRow(c)}
              onAddNew={name => addManualRow(null, name)}
              onRemove={key => setRows(prev => prev.filter(r => r.key !== key))}
              onBack={() => setStep("setup")}
              onCommit={() => void commit()}
            />
          )}

          {step === "done" && (
            <DoneStep receiptCode={receiptCode} results={results} onClose={onClose} />
          )}
        </div>
      </div>

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </div>
  );
};

// ── Paso 1: datos del remito ─────────────────────────────────────────────────

const SetupStep: React.FC<{
  vessels: Array<{ code: string; name: string | null }>;
  vesselCode: string; setVesselCode: (v: string) => void;
  receivedAt: string; setReceivedAt: (v: string) => void;
  docNumber: string; setDocNumber: (v: string) => void;
  providers: Provider[];
  providerId: string; setProviderId: (v: string) => void;
  providerName: string; setProviderName: (v: string) => void;
  onFile: (f: File) => void;
  onManual: () => void;
}> = (p) => {
  const t = useT();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className={labelCls}>{t("rcp.vessel")}</label>
          <select value={p.vesselCode} onChange={e => p.setVesselCode(e.target.value)} className={inputCls}>
            <option value="">—</option>
            {p.vessels.map(v => <option key={v.code} value={v.code}>{v.name ?? v.code}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>{t("rcp.date")}</label>
          <input type="date" value={p.receivedAt} onChange={e => p.setReceivedAt(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>{t("rcp.docNumber")}</label>
          <input value={p.docNumber} onChange={e => p.setDocNumber(e.target.value)} placeholder={t("rcp.docNumberPh")} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>{t("rcp.provider")}</label>
          <select value={p.providerId} onChange={e => p.setProviderId(e.target.value)} className={inputCls}>
            <option value="">{t("rcp.providerOther")}</option>
            {p.providers.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
          </select>
          {!p.providerId && (
            <input
              value={p.providerName}
              onChange={e => p.setProviderName(e.target.value)}
              placeholder={t("rcp.providerPh")}
              className={`${inputCls} mt-2`}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col items-center justify-center gap-2 px-5 py-8 rounded-xl border-2 border-dashed border-success-sea/40 bg-success-sea/5 hover:bg-success-sea/10 cursor-pointer transition-all text-center">
          <Upload className="w-7 h-7 text-success-sea" />
          <span className="text-sm font-bold text-fg">{t("rcp.uploadRemito")}</span>
          <span className="text-xs text-fg/40 max-w-[280px]">{t("rcp.uploadHint")}</span>
          <input
            type="file"
            accept="application/pdf,image/*"
            capture="environment"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) p.onFile(f); e.target.value = ""; }}
          />
        </label>
        <button
          onClick={p.onManual}
          className="flex flex-col items-center justify-center gap-2 px-5 py-8 rounded-xl border border-fg/10 bg-fg/2 hover:bg-fg/5 transition-all text-center"
        >
          <Search className="w-7 h-7 text-fg/40" />
          <span className="text-sm font-bold text-fg">{t("rcp.manual")}</span>
          <span className="text-xs text-fg/40 max-w-[280px]">{t("rcp.manualHint")}</span>
        </button>
      </div>
    </div>
  );
};

// ── Paso 2: revisión ─────────────────────────────────────────────────────────

const ReviewStep: React.FC<{
  vesselCode: string;
  rows: Row[];
  file: ScanResult["file"] | null;
  duplicateOf: ScanResult["duplicateOf"];
  pendingCount: number;
  saving: boolean;
  focusKey: string | null;
  onPatch: (key: string, patch: Partial<Row>) => void;
  onPick: (key: string, c: Candidate) => void;
  onMarkNew: (key: string) => void;
  onAdd: (c: Candidate) => void;
  onAddNew: (name: string) => void;
  onRemove: (key: string) => void;
  onBack: () => void;
  onCommit: () => void;
}> = (p) => {
  const t = useT();
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-bold text-fg">{t("rcp.review.title")}</p>
          <p className="text-xs text-fg/40 max-w-xl">{t("rcp.review.subtitle")}</p>
        </div>
        {p.file && (
          <span className="flex items-center gap-1.5 text-xs text-fg/40">
            <FileText className="w-3.5 h-3.5" />{p.file.name}
          </span>
        )}
      </div>

      {p.duplicateOf && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-700 dark:text-yellow-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{t("rcp.duplicateWarn")} {p.duplicateOf.receiptCode}</span>
        </div>
      )}

      <div className="space-y-2">
        {p.rows.map(row => (
          <ReviewRow
            key={row.key}
            row={row}
            vesselCode={p.vesselCode}
            autoFocus={row.key === p.focusKey}
            onPatch={patch => p.onPatch(row.key, patch)}
            onPick={c => p.onPick(row.key, c)}
            onMarkNew={() => p.onMarkNew(row.key)}
            onRemove={() => p.onRemove(row.key)}
          />
        ))}
        {p.rows.length === 0 && (
          <p className="text-xs text-fg/30 text-center py-6">{t("rcp.emptyRows")}</p>
        )}
      </div>

      <AddLine vesselCode={p.vesselCode} onAdd={p.onAdd} onAddNew={p.onAddNew} />

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-fg/10">
        <button onClick={p.onBack} className="px-4 py-2 rounded-xl border border-fg/10 text-xs font-bold text-fg/60 hover:bg-fg/5">
          {t("common.back")}
        </button>
        <div className="flex items-center gap-3">
          {p.pendingCount > 0 && (
            <span className="text-xs text-yellow-700 dark:text-yellow-400 font-bold">
              {p.pendingCount} {t("rcp.pendingShort")}
            </span>
          )}
          {/* Habilitado aunque falte algo: al tocarlo, el aviso dice qué línea y qué falta. */}
          <button
            onClick={p.onCommit}
            disabled={p.saving || p.rows.length === 0}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-success-sea/15 border border-success-sea/40 text-success-sea font-bold text-xs hover:bg-success-sea/25 transition-all disabled:opacity-40"
          >
            {p.saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {t("rcp.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};

const STATUS_STYLE: Record<Row["status"], string> = {
  matched:   "border-success-sea/30 bg-success-sea/5",
  ambiguous: "border-yellow-500/30 bg-yellow-500/5",
  new:       "border-blue-500/30 bg-blue-500/5",
};

const missCls = "border-amber-500 border-2 bg-amber-50 dark:bg-amber-500/10";
const optionCls = "w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-fg/10 bg-fg/2 hover:border-success-sea/40 hover:bg-success-sea/10 text-left";
const createCls = "w-full flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-blue-500/40 bg-blue-500/5 text-blue-600 dark:text-blue-400 text-xs font-bold hover:bg-blue-500/10 text-left";

const ReviewRow: React.FC<{
  row: Row;
  vesselCode: string;
  autoFocus: boolean;
  onPatch: (patch: Partial<Row>) => void;
  onPick: (c: Candidate) => void;
  onMarkNew: () => void;
  onRemove: () => void;
}> = ({ row, vesselCode, autoFocus, onPatch, onPick, onMarkNew, onRemove }) => {
  const t = useT();
  const qty = Number(row.quantity);
  const validQty = Number.isFinite(qty) && qty > 0;
  // Lo que falta para que la fila se pueda guardar, resaltado en naranja (preview V24).
  const needDest = !row.spareId && !row.confirmedNew;
  const need = <GuideNeedTag label={t("mp.guide.missing")} />;

  // Repuesto del stock al que se le suma. En la carga a mano va arriba, en el
  // lugar del ítem del remito (que no existe); "Cambiar" sólo tiene sentido en
  // una línea del remito: a mano se borra y se busca de nuevo.
  const matched = row.spareId ? (
    <div className="flex items-center gap-3 flex-wrap text-xs">
      <span className="px-2 py-0.5 rounded-lg bg-success-sea/15 text-success-sea font-bold text-[10px] uppercase tracking-wider">
        {t("rcp.state.matched")}
      </span>
      <span className="font-bold text-fg">{row.spareName}</span>
      <span className="font-mono text-fg/40">{row.spareSku}</span>
      {row.spareOnHand != null && validQty && (
        <span className="text-fg/50">
          {t("rcp.stock")}: {row.spareOnHand} → <strong className="text-success-sea">{row.spareOnHand + qty}</strong>
        </span>
      )}
      {row.aiReason && <span className="text-fg/30 italic">{row.aiReason}</span>}
      {row.fromScan && <button onClick={onMarkNew} className="text-fg/40 underline hover:text-fg">{t("rcp.change")}</button>}
    </div>
  ) : null;

  return (
    <div className={`rounded-xl border p-3 space-y-3 ${STATUS_STYLE[row.status]}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          {row.fromScan ? (
            <>
              <p className="text-[10px] font-bold text-fg/40 uppercase tracking-wider">{t("rcp.col.item")}</p>
              <p className="text-sm text-fg font-medium break-words">{row.description || "—"}</p>
              {row.partNumber && <p className="text-[11px] font-mono text-fg/40">P/N {row.partNumber}</p>}
            </>
          ) : matched ?? (
            <div className="space-y-1">
              <span className="px-2 py-0.5 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 font-bold text-[10px] uppercase tracking-wider">
                {t("rcp.state.new")}
              </span>
              <p className="text-[11px] text-fg/50">{t("rcp.newHint")}</p>
            </div>
          )}
        </div>

        {/* Cantidad */}
        <div className="w-24">
          <label className={labelCls}>{t("rcp.col.qty")}<RequiredMark /></label>
          <input
            type="number" min="0" step="0.01"
            value={row.quantity}
            autoFocus={autoFocus}
            onFocus={e => { if (autoFocus) e.currentTarget.select(); }}
            onChange={e => onPatch({ quantity: e.target.value })}
            className={`${inputCls} ${validQty ? "" : missCls}`}
          />
          {!validQty && need}
        </div>
        <div className="w-20">
          <label className={labelCls}>{t("rcp.col.unit")}</label>
          <input value={row.unit} onChange={e => onPatch({ unit: e.target.value })} className={inputCls} />
        </div>

        <button onClick={onRemove} className="mt-5 p-2 rounded-lg text-fg/30 hover:text-red-500 hover:bg-red-500/10" title={t("rcp.remove")}>
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {row.fromScan && matched}

      {/* Línea del remito sin repuesto: elegir uno del stock o darlo de alta. */}
      {needDest && (
        <div className="space-y-2 rounded-xl border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-500/10 px-3 py-2">
          <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300">{t("rcp.v24.pickOrNew")}{need}</p>
          {row.candidates.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-yellow-700 dark:text-yellow-400">{t("rcp.similar")}</p>
              {row.candidates.map(c => (
                <button key={c.id} onClick={() => onPick(c)} className={optionCls}>
                  <span className="text-xs text-fg truncate">
                    {c.name} <span className="font-mono text-fg/40">{c.sku}</span>
                  </span>
                  <span className="text-[11px] text-fg/40 shrink-0">{t("rcp.stock")} {c.onHand}</span>
                </button>
              ))}
            </div>
          )}
          <SpareFinder vesselCode={vesselCode} onPick={onPick} />
          <button onClick={() => onPatch({ confirmedNew: true, status: "new" })} className={createCls}>
            <Plus className="w-3.5 h-3.5 shrink-0" />{t("rcp.confirmNew")}
          </button>
        </div>
      )}

      {/* Alta nueva: el nombre ya viene escrito y el código, si no se pone, lo asigna el sistema. */}
      {!row.spareId && row.confirmedNew && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>{t("rcp.newName")}<RequiredMark />{!row.newName.trim() && need}</label>
              <input value={row.newName} onChange={e => onPatch({ newName: e.target.value })} className={`${inputCls} ${row.newName.trim() ? "" : missCls}`} />
            </div>
            <div>
              <label className={labelCls}>{t("rcp.newSku")}</label>
              <input
                value={row.newSku}
                onChange={e => onPatch({ newSku: e.target.value.toUpperCase() })}
                placeholder={t("rcp.newSkuAuto")}
                className={`${inputCls} font-mono`}
              />
              {!row.newSku.trim() && <p className="text-[11px] text-fg/40 mt-1">{t("rcp.newSkuHint")}</p>}
            </div>
            <div>
              <label className={labelCls}>{t("rcp.newCrit")}</label>
              <select
                value={row.newCriticality}
                onChange={e => onPatch({ newCriticality: e.target.value as Row["newCriticality"] })}
                className={inputCls}
              >
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </div>
          </div>
          {/* Segundo control contra el duplicado: el nombre se busca contra el
              stock mientras se tipea. Plegado, porque los parecidos ya se vieron
              al elegir "cargar como nuevo". */}
          <SimilarCheck vesselCode={vesselCode} name={row.newName} onPick={onPick} />
          {row.fromScan && (
            <button onClick={() => onPatch({ confirmedNew: false })} className="text-[11px] text-fg/40 underline hover:text-fg">
              {t("rcp.backToPick")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Avisa si el nombre que se está escribiendo se parece a un repuesto que ya
 * existe. No bloquea: dice cuántos hay y, al abrirlo, permite sumarle el stock
 * a uno de ellos en vez de crear una ficha repetida.
 */
const SimilarCheck: React.FC<{ vesselCode: string; name: string; onPick: (c: Candidate) => void }> = ({ vesselCode, name, onPick }) => {
  const t = useT();
  const [hits, setHits] = useState<Candidate[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = name.trim();
    if (term.length < 4) { setHits([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get<{ items: Candidate[] }>(`/app/pms/spares/search?vesselCode=${encodeURIComponent(vesselCode)}&q=${encodeURIComponent(term)}`)
        .then(res => { if (!cancelled) setHits((res.items ?? []).filter(h => h.score >= 0.35).slice(0, 3)); })
        .catch(() => { if (!cancelled) setHits([]); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [name, vesselCode]);

  if (hits.length === 0) return null;
  return (
    <div className="space-y-1 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
      <p className="text-[11px] font-bold text-yellow-700 dark:text-yellow-400 flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5" />{t("rcp.similarWarn").replace("{n}", String(hits.length))}
        <button type="button" onClick={() => setOpen(o => !o)} className="underline hover:text-fg">
          {open ? t("rcp.hide") : t("rcp.show")}
        </button>
      </p>
      {open && hits.map(c => (
        <button key={c.id} onClick={() => onPick(c)} className={optionCls}>
          <span className="text-xs text-fg truncate">
            {c.name} <span className="font-mono text-fg/40">{c.sku}</span>
          </span>
          <span className="text-[11px] shrink-0">
            <span className="text-fg/40">{t("rcp.stock")} {c.onHand}</span>
            <span className="ml-2 font-bold text-success-sea">{t("rcp.useThis")}</span>
          </span>
        </button>
      ))}
    </div>
  );
};

/**
 * Buscador contra el catálogo del buque: nombre, código, descripción y P/N.
 * Con `onCreate`, debajo de los resultados ofrece cargar lo escrito como
 * repuesto nuevo: es la salida cuando ninguno de los que aparecen es.
 */
const SpareFinder: React.FC<{
  vesselCode: string;
  onPick: (c: Candidate) => void;
  onCreate?: (name: string) => void;
}> = ({ vesselCode, onPick, onCreate }) => {
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const typed = q.trim();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api.get<{ items: Candidate[] }>(`/app/pms/spares/search?vesselCode=${encodeURIComponent(vesselCode)}&q=${encodeURIComponent(term)}`)
        .then(res => { if (!cancelled) setHits(res.items ?? []); })
        .catch(() => { if (!cancelled) setHits([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q, vesselCode]);

  const create = () => {
    if (!onCreate || typed.length < 2) return;
    onCreate(typed);
    setQ(""); setHits([]);
  };

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-fg/30 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            // Enter sin nada parecido en el stock = cargarlo como nuevo.
            if (e.key === "Enter" && !loading && hits.length === 0 && onCreate) { e.preventDefault(); create(); }
          }}
          placeholder={t("rcp.searchPh")}
          className={`${inputCls} pl-8`}
        />
        {loading && <Loader2 className="w-3.5 h-3.5 text-fg/30 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>
      {hits.length > 0 && (
        <div className="max-h-40 overflow-y-auto space-y-1">
          {hits.map(c => (
            <button
              key={c.id}
              onClick={() => { onPick(c); setQ(""); setHits([]); }}
              className={optionCls}
            >
              <span className="text-xs text-fg truncate">
                {c.name} <span className="font-mono text-fg/40">{c.sku}</span>
              </span>
              <span className="text-[11px] text-fg/40 shrink-0">{t("rcp.stock")} {c.onHand}</span>
            </button>
          ))}
        </div>
      )}
      {onCreate && typed.length >= 2 && !loading && hits.length === 0 && (
        <p className="text-[11px] text-fg/40 px-1">{t("rcp.noMatches")}</p>
      )}
      {/* Fuera de la lista con scroll: siempre a la vista. */}
      {onCreate && typed.length >= 2 && (
        <button onClick={create} className={createCls}>
          <Plus className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{t("rcp.addNewSpare").replace("{name}", typed)}</span>
        </button>
      )}
    </div>
  );
};

/** Alta de una línea suelta (modo manual, o un ítem que el remito no traía). */
const AddLine: React.FC<{
  vesselCode: string;
  onAdd: (c: Candidate) => void;
  onAddNew: (name: string) => void;
}> = ({ vesselCode, onAdd, onAddNew }) => {
  const t = useT();
  return (
    <div className="rounded-xl border border-dashed border-fg/15 p-3 space-y-2">
      <p className="text-[10px] font-bold text-fg/40 uppercase tracking-wider">{t("rcp.addLine")}</p>
      <SpareFinder vesselCode={vesselCode} onPick={onAdd} onCreate={onAddNew} />
    </div>
  );
};

// ── Paso 3: resumen ──────────────────────────────────────────────────────────

const DoneStep: React.FC<{
  receiptCode: string | null;
  results: CommitResultLine[];
  onClose: () => void;
}> = ({ receiptCode, results, onClose }) => {
  const t = useT();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-5 h-5 text-success-sea" />
        <p className="text-sm font-bold text-fg">{t("rcp.done.title")}</p>
        {receiptCode && <span className="font-mono text-xs text-fg/40">{receiptCode}</span>}
      </div>
      <div className="space-y-1">
        {results.map(r => (
          <div key={r.spareId} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-fg/10 text-xs">
            <span className="text-fg truncate">
              {r.name} <span className="font-mono text-fg/40">{r.sku}</span>
              {r.created && <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase">{t("rcp.done.created")}</span>}
            </span>
            <span className="text-fg/50 shrink-0">
              +{r.quantity} {r.unit} · {r.onHandBefore} → <strong className="text-success-sea">{r.onHandAfter}</strong>
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button onClick={onClose} className="px-5 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs font-bold text-fg hover:bg-fg/10">
          {t("common.close")}
        </button>
      </div>
    </div>
  );
};
