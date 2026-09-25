import React, { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, CalendarCheck, ChevronRight, ClipboardList, FileDown, FileSpreadsheet, History, Layers, Loader2, MapPin, Package, PackageX, Plus, RefreshCw, Save, Search,
  ShieldAlert, ShoppingCart, Ship, SlidersHorizontal, Trash2, TrendingDown, Truck, X,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { DataTable, fmtDate, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { VesselLabel } from "../components/EntityLabels";
import { ExcelPanel } from "../components/ExcelPanel";
import { GuideSection, GuideField, GuideNeedTag, GuidePill, RequiredMark } from "../components/GuideKit";
import { useT, type TranslationKey } from "../lib/i18n";
import { useCan } from "../lib/auth";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { useVesselContext } from "../lib/vessel-context";
import { useMocTrigger, MocTriggerHost, type MocTriggerEvent } from "../lib/use-moc-trigger";
import { useTmsaFilter, applyTmsaFilter, TmsaFilterBanner } from "../lib/tmsa-filter";
import { AutoTextArea } from "../components/AutoTextArea";
import { AlertDialog } from "../components/AlertDialog";
import { SpareReceiptModal } from "../components/spares/SpareReceiptModal";
import { SpareFormsModal } from "../components/spares/SpareFormsModal";
import { SpareRequestBatchModal } from "../components/spares/SpareRequestBatchModal";
import { textMatches } from "../lib/text-search";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Spare {
  id: string; sku: string; name: string; vesselCode: string;
  category: string | null; criticality: string; status: string;
  manufacturer: string | null; model: string | null;
  unit: string; minStock: number; reorderPoint: number; targetStock: number | null;
  location: string | null; createdAt: string;
  // Calculated stock (from stock-calc-service, never from Spare.currentStock)
  onHand: number; available: number;
  // Extended fields (Fase 2)
  internalPartNumber: string | null; manufacturerPartNumber: string | null;
  longDescription: string | null; sfiCode: string | null; leadTimeDays: number | null;
  // Repuesto equivalente / no-OEM (dispara MOC EQUIPMENT_CHANGE si criticality=A)
  isEquivalent: boolean;
  /** Equipos a los que se asoció el repuesto (uno o varios). Sólo viene en la ficha. */
  assets?: SpareAssetLink[];
}
/** Equipo asociado a un repuesto. */
interface SpareAssetLink { id: string; assetCode: string; name: string | null; criticality?: string | null }
interface ListResponse { items: Spare[]; total: number; }
// SFI: solo grupo (0-9). Nombres desde i18n `sfi.g.<n>`.
const SFI_GROUP_NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Tareas del plan que llevan el repuesto (`spares` JSON del plan). */
interface PlanWithSpares { id: string; vesselCode: string; title: string; assetName?: string | null; status: string; spares: { kind?: string; spareId?: string | null; quantity?: number; unit?: string }[] | null }
/** Recepciones: cada línea trae el SKU del repuesto que entró. */
interface ReceiptLite { id: string; receiptCode: string; vesselCode: string; providerName: string | null; receivedAt: string; lines: { sku: string | null; quantity: number; unit: string }[] }

interface StockMovement {
  id: string; movementCode: string; movementType: string;
  quantity: number; unit: string; occurredAt: string; vesselCode: string;
  referenceType: string | null; referenceId: string | null; referenceCode: string | null;
  notes: string | null;
}

const NEGATIVE_TYPES = new Set(["ISSUE", "TRANSFER_OUT", "ADJUSTMENT_MINUS"]);
const MOV_TKEY: Record<string, TranslationKey> = {
  RECEIPT: "sp.mov.RECEIPT", ISSUE: "sp.mov.ISSUE", ADJUSTMENT: "sp.mov.ADJUSTMENT",
  TRANSFER_IN: "sp.mov.TRANSFER_IN", TRANSFER_OUT: "sp.mov.TRANSFER_OUT",
  RETURN_IN: "sp.mov.RETURN_IN", ADJUSTMENT_PLUS: "sp.mov.ADJUSTMENT_PLUS", ADJUSTMENT_MINUS: "sp.mov.ADJUSTMENT_MINUS",
};

/** Nivel del stock: bajo el mínimo / para reponer / bien. Sin niveles cargados no se alarma. */
function stockLevel(s: Spare): "low" | "reorder" | "ok" {
  if (s.minStock > 0 && s.onHand < s.minStock) return "low";
  if (s.reorderPoint > 0 && s.onHand <= s.reorderPoint) return "reorder";
  return "ok";
}
const LEVEL_TEXT = { low: "text-red-700 dark:text-red-400", reorder: "text-amber-700 dark:text-amber-400", ok: "text-emerald-700 dark:text-emerald-400" };
const LEVEL_BAR = { low: "bg-red-600", reorder: "bg-amber-500", ok: "bg-emerald-600" };
const CRIT_CHIP: Record<string, string> = { A: "bg-red-700 text-white", B: "bg-amber-500/15 text-amber-800 dark:text-amber-300", C: "bg-fg/5 text-text-industrial/60" };

function StockBar({ spare }: { spare: Spare }) {
  const t = useT();
  const lvl = stockLevel(spare);
  const max = Math.max((spare.targetStock ?? 0) * 1.2, spare.reorderPoint * 1.6, spare.onHand, 1);
  return (
    <div className="flex flex-col gap-1 min-w-[130px]">
      <span className={`text-xs font-extrabold ${LEVEL_TEXT[lvl]}`}>{spare.onHand} <span className="font-semibold text-text-industrial/50">{spare.unit}</span></span>
      <div className="relative h-1.5 rounded-full bg-fg/10">
        <span className={`absolute inset-y-0 left-0 rounded-full ${LEVEL_BAR[lvl]}`} style={{ width: `${Math.min(100, (spare.onHand / max) * 100)}%` }} />
        {spare.minStock > 0 && <i className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-fg" style={{ left: `${(spare.minStock / max) * 100}%` }} />}
      </div>
      <span className="text-[10px] text-text-industrial/45">{t("sp.v23.minReorder").replace("{min}", String(spare.minStock)).replace("{ro}", String(spare.reorderPoint))}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Input style helpers
// ---------------------------------------------------------------------------

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const fl = "flex items-center gap-1.5 text-xs font-semibold text-text-industrial/70 mb-1.5";

// ---------------------------------------------------------------------------
// SpareModal
// ---------------------------------------------------------------------------

interface SpareModalProps {
  spare: Spare | null;
  plans: PlanWithSpares[];
  receipts: ReceiptLite[];
  onClose: () => void;
  onSaved: (s: Spare) => void;
  onMocTrigger?: (e: MocTriggerEvent) => void;
}

async function downloadSparePdf(spare: { id: string; sku: string; vesselCode: string }, errMsg: string): Promise<void> {
  const token = localStorage.getItem("gpms_token") ?? "";
  const slug  = localStorage.getItem("gpms_tenant_slug") ?? "";
  const res = await fetch(`/app/pms/spares/${spare.id}/pdf`, {
    headers: { Authorization: `Bearer ${token}`, "X-Tenant-Slug": slug },
  });
  if (!res.ok) throw new Error(errMsg);
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${spare.sku}-${spare.vesselCode}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

const SpareModal: React.FC<SpareModalProps> = ({ spare, plans, receipts, onClose, onSaved, onMocTrigger }) => {
  const isNew = spare === null;
  const can = useCan();
  const t = useT();
  const navigate = useNavigate();
  // Alta/edición/baja: "spare.manage"; ajuste manual: "stock.manage" (Equipo → Permisos),
  // los mismos permisos que valida el backend.
  const canEdit = can("spare.manage");
  const canAdjustStock = !isNew && can("stock.manage");

  const [vesselCode,              setVesselCode]              = useState(spare?.vesselCode              ?? "");
  const [sku,                     setSku]                     = useState(spare?.sku                     ?? "");
  const [name,                    setName]                    = useState(spare?.name                    ?? "");
  const [category,                setCategory]                = useState(spare?.category                ?? "");
  const [criticality,             setCriticality]             = useState(spare?.criticality             ?? "B");
  const [manufacturer,            setManufacturer]            = useState(spare?.manufacturer            ?? "");
  const [model,                   setModel]                   = useState(spare?.model                   ?? "");
  const [unit,                    setUnit]                    = useState(spare?.unit                    ?? "");
  const [minStock,                setMinStock]                = useState(String(spare?.minStock         ?? 0));
  const [reorderPoint,            setReorderPoint]            = useState(String(spare?.reorderPoint     ?? 0));
  const [targetStock,             setTargetStock]             = useState(String(spare?.targetStock      ?? ""));
  const [location,                setLocation]                = useState(spare?.location                ?? "");
  const [status,                  setStatus]                  = useState(spare?.status                  ?? "ACTIVE");
  const [internalPartNumber,      setInternalPartNumber]      = useState(spare?.internalPartNumber      ?? "");
  const [manufacturerPartNumber,  setManufacturerPartNumber]  = useState(spare?.manufacturerPartNumber  ?? "");
  const [longDescription,         setLongDescription]         = useState(spare?.longDescription         ?? "");
  const [sfiCode,                 setSfiCode]                 = useState(spare?.sfiCode                 ?? "");
  const [leadTimeDays,            setLeadTimeDays]            = useState(String(spare?.leadTimeDays     ?? ""));
  const [isEquivalent,            setIsEquivalent]            = useState(spare?.isEquivalent            ?? false);

  // Reuse VesselContext instead of re-fetching /app/vessels.
  const { vessels } = useVesselContext();
  const vesselName = (code: string) => vessels.find(v => v.code === code)?.name || code;

  // SFI: solo grupo (0-9). El grupo se deriva del primer dígito del código guardado.
  const [sfiGroup, setSfiGroup] = useState<string>(() => {
    if (!spare?.sfiCode) return "";
    const digits = String(spare.sfiCode).replace(/\D/g, "");
    return digits[0] ?? "";
  });
  const handleSfiGroupChange = (g: string) => { setSfiGroup(g); setSfiCode(g ? `${g}00` : ""); };

  const [saving,      setSaving]      = useState(false);
  // Guardar deja el modal abierto: sin esto, lo recién guardado se sigue
  // comparando contra el estado con el que se abrió y el cartel de "cambios sin
  // guardar" no se iba nunca (useDirtyTracker re-toma la foto cuando cambia la clave).
  const [savedTick,   setSavedTick]   = useState(0);
  const [error,       setError]       = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Ajuste manual: ventanita propia (antes: recuadro amarillo dentro del formulario).
  const [adjOpen,    setAdjOpen]    = useState(false);
  const [adjQty,     setAdjQty]     = useState(String(spare?.onHand ?? 0));
  const [adjNotes,   setAdjNotes]   = useState("");
  const [adjSaving,  setAdjSaving]  = useState(false);

  const movements = useFetch<{ items: StockMovement[] }>(spare ? `/app/pms/stock-movements?spareId=${spare.id}` : null, [spare?.id]);

  // ── Equipos donde se usa el repuesto (uno o varios) ──
  // La lista viene con la ficha; el buscador trae los equipos del MISMO buque.
  const [linkedAssets, setLinkedAssets] = useState<SpareAssetLink[]>(spare?.assets ?? []);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetOptions, setAssetOptions] = useState<SpareAssetLink[]>([]);
  const [linkingAsset, setLinkingAsset] = useState(false);
  useEffect(() => { setLinkedAssets(spare?.assets ?? []); }, [spare?.id, spare?.assets]);
  useEffect(() => {
    const code = vesselCode.trim().toUpperCase();
    if (!code || isNew) { setAssetOptions([]); return; }
    let alive = true;
    api.get<{ items: SpareAssetLink[] }>(`/app/pms/assets?vesselCode=${encodeURIComponent(code)}&limit=500`)
      .then(r => { if (alive) setAssetOptions(r.items ?? []); })
      .catch(() => { if (alive) setAssetOptions([]); });
    return () => { alive = false; };
  }, [vesselCode, isNew]);

  const assetSuggestions = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    if (!q) return [];
    const already = new Set(linkedAssets.map(a => a.id));
    return assetOptions
      .filter(a => !already.has(a.id))
      .filter(a => `${a.name ?? ""} ${a.assetCode}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [assetQuery, assetOptions, linkedAssets]);

  const linkAsset = async (assetId: string) => {
    if (!spare || linkingAsset) return;
    setLinkingAsset(true);
    try {
      const r = await api.post<{ assets: SpareAssetLink[] }>(`/app/pms/spares/${spare.id}/assets`, { assetId });
      setLinkedAssets(r.assets ?? []);
      setAssetQuery("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    } finally { setLinkingAsset(false); }
  };
  const unlinkAsset = async (assetId: string) => {
    if (!spare || linkingAsset) return;
    setLinkingAsset(true);
    try {
      const r = await api.delete<{ assets: SpareAssetLink[] }>(`/app/pms/spares/${spare.id}/assets/${assetId}`);
      setLinkedAssets(r.assets ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    } finally { setLinkingAsset(false); }
  };

  const handleSave = async () => {
    setError(null);
    const payload = {
      vesselCode:             vesselCode.trim().toUpperCase(),
      sku:                    sku.trim().toUpperCase(),
      name:                   name.trim(),
      category:               category.trim() || null,
      criticality:            criticality as "A" | "B" | "C",
      manufacturer:           manufacturer.trim() || null,
      model:                  model.trim() || null,
      unit:                   unit.trim(),
      minStock:               parseFloat(minStock) || 0,
      reorderPoint:           parseFloat(reorderPoint) || 0,
      targetStock:            targetStock.trim() ? parseFloat(targetStock) : null,
      location:               location.trim() || null,
      status:                 status as "ACTIVE" | "OBSOLETE",
      internalPartNumber:     internalPartNumber.trim() || null,
      manufacturerPartNumber: manufacturerPartNumber.trim() || null,
      longDescription:        longDescription.trim() || null,
      sfiCode:                sfiCode.trim() || null,
      leadTimeDays:           leadTimeDays.trim() ? parseInt(leadTimeDays, 10) : null,
      isEquivalent:           isEquivalent,
    };
    if (!payload.vesselCode) { setError(t("error.vesselRequired")); return; }
    if (!payload.sku)        { setError(t("error.skuRequired"));    return; }
    if (!payload.name)       { setError(t("error.nameRequired"));   return; }
    if (!payload.unit)       { setError(t("error.unitRequired"));   return; }
    setSaving(true);
    try {
      const result = isNew
        ? await api.post<Spare>("/app/pms/spares", payload)
        : await api.patch<Spare>(`/app/pms/spares/${spare.id}`, payload);

      // Detector MOC EQUIPMENT_CHANGE: si el repuesto está marcado como
      // equivalente / no-OEM y es de criticidad A (crítico), el cambio en la
      // línea de defensa exige Management of Change. Disparamos en creación y
      // también si la edición activa el flag o lo deja en estado equivalente+A.
      if (onMocTrigger && payload.isEquivalent && payload.criticality === "A") {
        const wasSameState = !isNew && spare && spare.isEquivalent === true && spare.criticality === "A";
        if (!wasSameState) {
          onMocTrigger({
            reason: "spareEquivalent",
            prefill: {
              category: "EQUIPMENT_CHANGE",
              vesselCode: payload.vesselCode,
              title: `Repuesto equivalente en componente crítico: ${payload.name}`,
              reasonForChange: `Se está utilizando el repuesto ${payload.sku} (${payload.name}) marcado como equivalente / no-OEM en una posición de criticidad A.`,
              proposedChange: `Aprobar el uso del repuesto equivalente ${payload.sku}${payload.manufacturer ? ` (${payload.manufacturer}${payload.model ? ` ${payload.model}` : ""})` : ""} en lugar del componente OEM original.`,
              sourceLabel: `Desde Repuestos · ${payload.sku} — ${payload.name}`,
            },
          });
        }
      }

      onSaved(result);
      setSavedTick(n => n + 1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("common.saveError"));
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!spare) return;
    setSaving(true);
    try {
      await api.delete(`/app/pms/spares/${spare.id}`);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("error.delete"));
      setSaving(false);
      setConfirmDelete(false);
    }
  };

  const applyAdjustment = async () => {
    if (!spare) return;
    const newQty = parseFloat(adjQty);
    if (isNaN(newQty) || newQty < 0) { setError(t("error.invalidQuantity")); return; }
    const delta = newQty - spare.onHand;
    if (delta === 0) { setError(t("error.sameQuantity")); return; }
    setAdjSaving(true);
    try {
      await api.post(`/app/pms/stock-movements`, {
        vesselCode:    spare.vesselCode,
        spareId:       spare.id,
        movementType:  delta > 0 ? "ADJUSTMENT_PLUS" : "ADJUSTMENT_MINUS",
        quantity:      Math.abs(delta),
        unit:          spare.unit,
        occurredAt:    new Date().toISOString(),
        referenceType: "ADJUSTMENT",
        notes:         adjNotes.trim() || t("sp.v23.adjDefaultNote"),
      });
      setAdjNotes("");
      setAdjOpen(false);
      void movements.reload();
      onSaved({ ...spare, onHand: newQty, available: newQty });
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : t("common.saveError"));
    } finally { setAdjSaving(false); }
  };

  // ESC guard: confirma cambios sin guardar
  const isDirty = useDirtyTracker({
    vesselCode, sku, name, category, criticality, manufacturer, model, unit,
    minStock, reorderPoint, targetStock, location, status,
    internalPartNumber, manufacturerPartNumber, longDescription, sfiCode, leadTimeDays,
    isEquivalent,
  }, savedTick);
  const requestClose = useEscapeGuard({ isDirty: canEdit && isDirty, onSave: canEdit ? handleSave : undefined, onClose });

  // Nexos: tareas del plan que lo usan y recepciones donde entró.
  const usedIn = useMemo(() => !spare ? [] : plans
    .filter(p => p.status !== "INACTIVE" && Array.isArray(p.spares) && p.spares.some(s => s?.spareId === spare.id))
    .map(p => ({ plan: p, line: p.spares!.find(s => s?.spareId === spare.id)! })), [plans, spare]);
  const receivedFrom = useMemo(() => !spare ? [] : receipts
    .filter(r => r.vesselCode === spare.vesselCode && r.lines.some(l => l.sku === spare.sku)), [receipts, spare]);

  // Obligatorios (preview V24): lo mismo que valida handleSave.
  const missReq = { vessel: !vesselCode.trim(), sku: !sku.trim(), name: !name.trim(), unit: !unit.trim() };
  const missTotal = canEdit ? Object.values(missReq).filter(Boolean).length : 0;
  const needTag = (on: boolean) => canEdit && on ? <GuideNeedTag label={t("mp.guide.missing")} /> : null;

  const lvl = spare ? stockLevel(spare) : "ok";
  const gaugeMax = spare ? Math.max((spare.targetStock ?? 0) * 1.25, spare.reorderPoint * 1.6, spare.minStock * 2, spare.onHand, 1) : 1;
  const gaugeTone = { low: "border-red-400/60 bg-red-500/[0.06]", reorder: "border-amber-400/60 bg-amber-500/[0.07]", ok: "border-emerald-500/40 bg-emerald-500/[0.06]" }[lvl];
  const missingToTarget = spare?.targetStock ? Math.max(0, spare.targetStock - spare.onHand) : 0;
  const mark = (value: number, label: string) => value > 0 && (
    <span className="absolute -top-4 -translate-x-1/2 whitespace-nowrap text-[10px] font-extrabold text-text-industrial/60" style={{ left: `${Math.min(100, (value / gaugeMax) * 100)}%` }}>
      {label}
      <i className="absolute left-1/2 top-3.5 h-4 w-0.5 bg-fg" />
    </span>
  );

  const box = (icon: React.ReactNode, title: string, right: React.ReactNode, body: React.ReactNode) => (
    <div className="rounded-2xl border border-fg/10 overflow-hidden">
      <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg">{icon} {title}<span className="ml-auto text-[11px] font-semibold text-text-industrial/50">{right}</span></h3>
      <div className="p-3 space-y-2">{body}</div>
    </div>
  );
  const rel = "w-full flex items-center gap-2 rounded-xl border border-fg/10 px-2.5 py-2 text-left text-xs hover:border-accent/40 transition-colors";
  const empty = (txt: string) => <p className="text-xs text-text-industrial/45">{txt}</p>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-6xl max-h-[92vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 border-t-4 border-t-violet-600 rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Encabezado */}
        <div className="flex items-start gap-3 px-4 sm:px-6 py-3 border-b border-fg/10 shrink-0">
          <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-violet-500/15 text-violet-700 dark:text-violet-300"><Package className="w-6 h-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-violet-700 dark:text-violet-400">{t("sp.v23.kicker")}{category.trim() ? ` · ${category.trim()}` : ""}</p>
            <h2 className="text-lg font-black text-fg leading-tight truncate">{name.trim() || t("sp.newSpareTitle")}</h2>
            {(manufacturer.trim() || manufacturerPartNumber.trim()) && (
              <p className="text-xs text-text-industrial/60 truncate">{[manufacturer.trim(), manufacturerPartNumber.trim() && `P/N ${manufacturerPartNumber.trim()}`].filter(Boolean).join(" · ")}</p>
            )}
            {!isNew && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 font-mono text-[11px] font-bold text-fg">{spare.sku}</span>
                {/* Nombre del buque, no el código. */}
                <span className="inline-flex items-center gap-1 rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/70"><Ship className="w-3 h-3" /><VesselLabel code={spare.vesselCode} className="text-[11px]" /></span>
                <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-black ${CRIT_CHIP[spare.criticality] ?? CRIT_CHIP.C}`}>{t("sp.v23.critN").replace("{c}", spare.criticality)}</span>
                {spare.location && <span className="inline-flex items-center gap-1 rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/70"><MapPin className="w-3 h-3" />{spare.location}</span>}
                {spare.status === "OBSOLETE" && <span className="rounded-full bg-fg/10 px-2 py-0.5 text-[11px] font-bold text-text-industrial/60">{t("sp.v23.obsolete")}</span>}
              </div>
            )}
          </div>
          <ModalCloseButton onClose={requestClose} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Cuánto hay contra mínimo / reorden / objetivo */}
          {spare && (
            <div className={`mx-4 sm:mx-6 mt-4 flex flex-wrap items-center gap-4 rounded-2xl border-[1.5px] px-4 py-3 ${gaugeTone}`}>
              <div>
                <p className="text-[10.5px] font-extrabold uppercase text-text-industrial/55">{t("sp.v23.inStock")}</p>
                <p className={`text-3xl font-black leading-none ${LEVEL_TEXT[lvl]}`}>{spare.onHand} <span className="text-sm">{spare.unit}</span></p>
                {spare.available !== spare.onHand && <p className="text-[11px] text-text-industrial/55">{t("sp.v23.available").replace("{n}", String(spare.available))}</p>}
              </div>
              <div className="flex-1 min-w-[220px]">
                <div className="relative mt-5 mb-1.5 h-3 rounded-full bg-fg/10">
                  <span className={`absolute inset-y-0 left-0 rounded-full ${LEVEL_BAR[lvl]}`} style={{ width: `${Math.min(100, (spare.onHand / gaugeMax) * 100)}%` }} />
                  {mark(spare.minStock, t("sp.v23.markMin").replace("{n}", String(spare.minStock)))}
                  {mark(spare.reorderPoint, t("sp.v23.markReorder").replace("{n}", String(spare.reorderPoint)))}
                  {mark(spare.targetStock ?? 0, t("sp.v23.markTarget").replace("{n}", String(spare.targetStock ?? 0)))}
                </div>
                <p className="text-[11px] text-text-industrial/55">
                  {spare.minStock <= 0 && spare.reorderPoint <= 0 ? t("sp.v23.noLevels")
                    : [missingToTarget > 0 && t("sp.v23.missingTarget").replace("{n}", String(missingToTarget)), spare.leadTimeDays != null && t("sp.v23.leadTime").replace("{n}", String(spare.leadTimeDays))].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {lvl !== "ok" && (
                  <button type="button" onClick={() => navigate("/spare-requests")} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-orange-600 text-white text-xs font-bold hover:brightness-110">
                    <ShoppingCart className="w-3.5 h-3.5" /> {t("sp.v23.order")}
                  </button>
                )}
                {canAdjustStock && (
                  <button type="button" onClick={() => { setAdjQty(String(spare.onHand)); setAdjOpen(true); }} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-fg/15 bg-surface text-xs font-bold text-fg hover:border-accent/40">
                    <SlidersHorizontal className="w-3.5 h-3.5" /> {t("sp.v23.adjust")}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className={`grid grid-cols-1 ${isNew ? "" : "lg:grid-cols-[1.3fr_1fr]"} gap-4 px-4 sm:px-6 py-4`}>
            <div className="space-y-3 min-w-0">
              <GuideSection n={1} title={t("sp.v23.sec1")} subtitle={t("sp.v23.sec1Sub")} open onToggle={() => { /* siempre abierto */ }}
                pill={canEdit ? <GuidePill missing={Number(missReq.vessel) + Number(missReq.sku) + Number(missReq.name)} completeLabel={t("mp.guide.complete")} missingOne={t("mp.guide.missingOne")} missingMany={t("mp.guide.missingMany")} /> : undefined}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <GuideField id="sp-f-vessel" missing={canEdit && missReq.vessel}>
                    <label className={fl}>{t("form.vessel").replace(/\s*\*\s*$/, "")}<RequiredMark />{needTag(missReq.vessel)}</label>
                    {isNew
                      ? <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={inputCls}>
                          <option value="">{t("sp.selectVesselPh")}</option>
                          {vessels.map(v => <option key={v.code} value={v.code}>{v.name || v.code}</option>)}
                        </select>
                      : <input value={vesselName(spare.vesselCode)} disabled className={inputCls} />}
                  </GuideField>
                  <GuideField id="sp-f-sku" missing={canEdit && missReq.sku}>
                    <label className={fl}>{t("sp.sku").replace(/\s*\*\s*$/, "")}<RequiredMark />{needTag(missReq.sku)}</label>
                    <input value={sku} onChange={e => setSku(e.target.value.toUpperCase())} disabled={!canEdit} placeholder="SKU-001" className={inputCls} />
                  </GuideField>
                </div>
                <GuideField id="sp-f-name" missing={canEdit && missReq.name}>
                  <label className={fl}>{t("sp.nameReq").replace(/\s*\*\s*$/, "")}<RequiredMark />{needTag(missReq.name)}</label>
                  <input value={name} onChange={e => setName(e.target.value)} disabled={!canEdit} placeholder={t("sp.namePh")} className={inputCls} />
                </GuideField>
                <div><label className={fl}>{t("sp.longDesc")}</label><AutoTextArea value={longDescription} onChange={e => setLongDescription(e.target.value)} disabled={!canEdit} placeholder={t("sp.longDescPh")} rows={2} className={`${inputCls} resize-none`} /></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className={fl}>{t("common.category")}</label><input value={category} onChange={e => setCategory(e.target.value)} disabled={!canEdit} placeholder={t("sp.categoryPh")} className={inputCls} /></div>
                  <div>
                    <label className={fl}>{t("common.criticality")}</label>
                    <select value={criticality} onChange={e => setCriticality(e.target.value)} disabled={!canEdit} className={inputCls}>
                      <option value="A">{t("sp.critAImportant")}</option>
                      <option value="B">{t("sp.critB")}</option>
                      <option value="C">{t("sp.critC")}</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className={fl}>{t("sp.manufacturer")}</label><input value={manufacturer} onChange={e => setManufacturer(e.target.value)} disabled={!canEdit} className={inputCls} /></div>
                  <div><label className={fl}>{t("sp.model")}</label><input value={model} onChange={e => setModel(e.target.value)} disabled={!canEdit} className={inputCls} /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className={fl}>{t("sp.v23.pnInternal")}</label><input value={internalPartNumber} onChange={e => setInternalPartNumber(e.target.value)} disabled={!canEdit} placeholder="IPN-001" className={inputCls} /></div>
                  <div><label className={fl}>{t("sp.v23.pnManufacturer")}</label><input value={manufacturerPartNumber} onChange={e => setManufacturerPartNumber(e.target.value)} disabled={!canEdit} placeholder="OEM-12345" className={inputCls} /></div>
                </div>
                <div>
                  <label className={fl}>{t("mp.sfiGroup")}</label>
                  <select value={sfiGroup} onChange={e => handleSfiGroupChange(e.target.value)} disabled={!canEdit} className={inputCls}>
                    <option value="">{t("mp.selectSfiGroup")}</option>
                    {SFI_GROUP_NUMBERS.map(g => <option key={g} value={String(g)}>{g} - {t(`sfi.g.${g}` as TranslationKey)}</option>)}
                  </select>
                </div>
                {/* Repuesto equivalente / no-OEM — al guardar con criticidad A el sistema sugiere abrir un MOC EQUIPMENT_CHANGE. */}
                <label className={`flex items-start gap-2.5 rounded-xl border-[1.5px] border-amber-400/50 bg-amber-500/[0.06] px-3 py-2.5 ${canEdit ? "cursor-pointer hover:bg-amber-500/10" : "opacity-70"}`}>
                  <input type="checkbox" checked={isEquivalent} onChange={e => setIsEquivalent(e.target.checked)} disabled={!canEdit} className="mt-0.5 w-4 h-4 accent-amber-600" />
                  <span>
                    <span className="block text-[13px] font-extrabold text-amber-800 dark:text-amber-200">{t("sp.equivNotOem")}</span>
                    <span className="block text-[11.5px] text-text-industrial/60">{t("sp.v23.equivHint")}</span>
                  </span>
                </label>
              </GuideSection>

              <GuideSection n={2} title={t("sp.v23.sec2")} subtitle={t("sp.v23.sec2Sub")} open onToggle={() => { /* siempre abierto */ }}
                pill={canEdit ? <GuidePill missing={Number(missReq.unit)} completeLabel={t("mp.guide.complete")} missingOne={t("mp.guide.missingOne")} missingMany={t("mp.guide.missingMany")} /> : undefined}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className={fl}>{t("sp.v23.location")}</label><input value={location} onChange={e => setLocation(e.target.value)} disabled={!canEdit} placeholder={t("sp.v23.locationPh")} className={inputCls} /></div>
                  <GuideField id="sp-f-unit" missing={canEdit && missReq.unit}>
                    <label className={fl}>{t("sp.unitReq").replace(/\s*\*\s*$/, "")}<RequiredMark />{needTag(missReq.unit)}</label>
                    <input value={unit} onChange={e => setUnit(e.target.value)} disabled={!canEdit} placeholder="ud, m, kg, L…" className={inputCls} />
                  </GuideField>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div><label className={fl}>{t("sp.v23.minStock")}</label><input type="number" min="0" step="0.01" value={minStock} onChange={e => setMinStock(e.target.value)} disabled={!canEdit} className={inputCls} /></div>
                  <div><label className={fl}>{t("sp.v23.reorderPoint")}</label><input type="number" min="0" step="0.01" value={reorderPoint} onChange={e => setReorderPoint(e.target.value)} disabled={!canEdit} className={inputCls} /></div>
                  <div><label className={fl}>{t("sp.v23.targetStock")}</label><input type="number" min="0" step="0.01" value={targetStock} onChange={e => setTargetStock(e.target.value)} disabled={!canEdit} placeholder={t("sp.v23.optional")} className={inputCls} /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className={fl}>{t("sp.v23.leadTimeDays")}</label><input type="number" min="0" step="1" value={leadTimeDays} onChange={e => setLeadTimeDays(e.target.value)} disabled={!canEdit} className={inputCls} /></div>
                  <div>
                    <label className={fl}>{t("col.status")}</label>
                    <select value={status} onChange={e => setStatus(e.target.value)} disabled={!canEdit} className={inputCls}>
                      <option value="ACTIVE">{t("sp.v23.active")}</option>
                      <option value="OBSOLETE">{t("sp.v23.obsolete")}</option>
                    </select>
                  </div>
                </div>
                {!isNew && <p className="text-[11px] text-text-industrial/45">{t("prov.createdAt")} {fmtDate(spare.createdAt)}</p>}
              </GuideSection>
            </div>

            {/* Derecha: dónde se usa, qué pasó y quién lo trae */}
            {!isNew && (
              <div className="space-y-3 min-w-0">
                {box(<Layers className="w-4 h-4" />, t("sp.assets.title"),
                  linkedAssets.length ? t("sp.assets.count").replace("{n}", String(linkedAssets.length)) : null,
                  <>
                    {linkedAssets.length === 0 && empty(t("sp.assets.empty"))}
                    {linkedAssets.map(a => (
                      <div key={a.id} className={rel}>
                        <b className="text-fg truncate">{a.name || a.assetCode}</b>
                        <span className="font-mono text-[11px] text-text-industrial/55 shrink-0">{a.assetCode}</span>
                        {a.criticality && <span className="text-[11px] text-text-industrial/50 shrink-0">{t("sp.assets.criticality").replace("{c}", a.criticality)}</span>}
                        {canEdit && (
                          <button type="button" onClick={() => { void unlinkAsset(a.id); }} disabled={linkingAsset}
                            title={t("common.remove")} aria-label={t("common.remove")}
                            className="ml-auto shrink-0 px-1.5 rounded-lg text-red-700 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50">✕</button>
                        )}
                      </div>
                    ))}
                    {canEdit && (
                      <>
                        <input value={assetQuery} onChange={e => setAssetQuery(e.target.value)}
                          placeholder={t("sp.assets.search")} className={inputCls} />
                        {assetSuggestions.length > 0 && (
                          <div className="rounded-xl border border-fg/10 overflow-hidden">
                            {assetSuggestions.map(a => (
                              <button key={a.id} type="button" onClick={() => { void linkAsset(a.id); }} disabled={linkingAsset}
                                className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-accent/10 disabled:opacity-50">
                                <b className="text-fg truncate">{a.name || a.assetCode}</b>
                                <span className="font-mono text-[11px] text-text-industrial/55 shrink-0">{a.assetCode}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        <p className="text-[11px] text-text-industrial/45">{t("sp.assets.hint")}</p>
                      </>
                    )}
                  </>)}
                {box(<CalendarCheck className="w-4 h-4" />, t("sp.v23.usedIn"), usedIn.length ? t("sp.v23.tasksN").replace("{n}", String(usedIn.length)) : null,
                  usedIn.length === 0 ? empty(t("sp.v23.usedInEmpty")) : usedIn.slice(0, 8).map(({ plan, line }) => (
                    <button key={plan.id} type="button" className={rel} onClick={() => navigate(`/maintenance-plans?openId=${encodeURIComponent(plan.id)}`)}>
                      <b className="text-fg shrink-0">{plan.assetName || "—"}</b>
                      <span className="truncate text-text-industrial/55">{plan.title}{line.quantity ? ` · ${line.quantity} ${line.unit ?? ""}` : ""}</span>
                      <ChevronRight className="ml-auto w-3.5 h-3.5 shrink-0 text-text-industrial/40" />
                    </button>
                  )))}
                {box(<History className="w-4 h-4" />, t("sp.v23.movements"), movements.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : null,
                  (movements.data?.items ?? []).length === 0 ? empty(t("common.noMovements")) : (movements.data?.items ?? []).slice(0, 10).map(m => {
                    const neg = NEGATIVE_TYPES.has(m.movementType);
                    const isWo = m.referenceType === "WORK_ORDER" && !!m.referenceCode;
                    return (
                      <div key={m.id} role={isWo ? "button" : undefined} onClick={isWo ? () => navigate(`/work-orders/${encodeURIComponent(m.referenceCode!)}`) : undefined}
                        className={`${rel} ${isWo ? "cursor-pointer" : "hover:border-fg/10"}`} title={m.notes ?? undefined}>
                        <span className={`font-mono font-extrabold shrink-0 ${neg ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>{neg ? "−" : "+"}{m.quantity}</span>
                        <span className="text-fg shrink-0">{MOV_TKEY[m.movementType] ? t(MOV_TKEY[m.movementType]) : m.movementType}</span>
                        {m.referenceCode ? <span className="font-mono text-[11px] font-bold text-accent truncate">{m.referenceCode}</span> : m.notes ? <span className="truncate text-text-industrial/50">{m.notes}</span> : null}
                        <span className="ml-auto flex items-center gap-1 shrink-0 text-[11px] text-text-industrial/50">{fmtDate(m.occurredAt)}{isWo && <ChevronRight className="w-3.5 h-3.5" />}</span>
                      </div>
                    );
                  }))}
                {box(<Truck className="w-4 h-4" />, t("sp.v23.whoBrings"), null,
                  receivedFrom.length === 0 ? empty(t("sp.v23.whoBringsEmpty")) : receivedFrom.slice(0, 5).map(r => (
                    <button key={r.id} type="button" className={rel} onClick={() => navigate("/spare-receipts")}>
                      <b className="text-fg truncate">{r.providerName || "—"}</b>
                      <span className="font-mono text-[11px] text-text-industrial/55 shrink-0">{r.receiptCode}</span>
                      <span className="ml-auto text-[11px] text-text-industrial/50 shrink-0">{fmtDate(r.receivedAt)}</span>
                    </button>
                  )))}
              </div>
            )}
          </div>
        </div>

        {/* Pie */}
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-t border-fg/10 shrink-0">
          {!isNew && canEdit && (
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/30 text-xs font-bold text-red-700 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" /> {t("common.delete")}
            </button>
          )}
          {!isNew && (
            <button type="button"
              onClick={async () => {
                setDownloadingPdf(true);
                try { await downloadSparePdf(spare, t("sp.pdfError")); }
                catch (err) { setError(err instanceof Error ? err.message : t("sp.pdfError")); }
                finally { setDownloadingPdf(false); }
              }}
              disabled={downloadingPdf}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-fg/10 text-xs font-bold text-fg hover:border-accent/30 disabled:opacity-50">
              {downloadingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : <FileDown className="w-3.5 h-3.5 text-accent" />} PDF
            </button>
          )}
          <span className="flex-1" />
          {canEdit && isDirty && <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-amber-700 dark:text-amber-400"><AlertTriangle className="w-3 h-3" /> {t("mp.guide.dirty")}</span>}
          <button type="button" onClick={requestClose} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.close")}</button>
          {canEdit && (
            <button type="button" onClick={() => void handleSave()} disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white font-bold text-xs hover:brightness-110 disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {t("common.save")}
              {!saving && missTotal > 0 && <span className="text-[10px] font-semibold opacity-85">{t("mp.guide.saveMissing").replace("{n}", String(missTotal))}</span>}
            </button>
          )}
        </div>
      </div>

      {/* Ajustar stock */}
      {adjOpen && spare && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => e.stopPropagation()}>
          <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-fg/10">
              <SlidersHorizontal className="w-4 h-4" /><h2 className="text-base font-black text-fg">{t("sp.v23.adjust")}</h2>
              <ModalCloseButton onClose={() => setAdjOpen(false)} className="ml-auto" />
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-text-industrial/60">{t("sp.v23.adjNow").replace("{name}", spare.name).replace("{n}", `${spare.onHand} ${spare.unit}`)}</p>
              <GuideField id="sp-adj-qty" missing={adjQty.trim() === ""}>
                <label className={fl}>{t("sp.v23.adjQty")}<RequiredMark />{adjQty.trim() === "" && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                <input type="number" min="0" step="0.01" value={adjQty} onChange={e => setAdjQty(e.target.value)} className={inputCls} autoFocus />
              </GuideField>
              <div><label className={fl}>{t("sp.v23.adjReason")}</label><input value={adjNotes} onChange={e => setAdjNotes(e.target.value)} placeholder={t("sp.v23.adjReasonPh")} className={inputCls} /></div>
              <p className="text-[11px] text-text-industrial/50">{t("sp.v23.adjLog")}</p>
            </div>
            <div className="flex items-center gap-2 px-5 py-3 border-t border-fg/10">
              <span className="flex-1" />
              <button type="button" onClick={() => setAdjOpen(false)} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.back")}</button>
              <button type="button" onClick={() => void applyAdjustment()} disabled={adjSaving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:brightness-110 disabled:opacity-50">
                {adjSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("sp.v23.adjSave")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && spare && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => e.stopPropagation()}>
          <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-fg/10">
              <h2 className="text-base font-black text-fg">{t("sp.v23.deleteTitle")}</h2>
              <ModalCloseButton onClose={() => setConfirmDelete(false)} className="ml-auto" />
            </div>
            <p className="px-5 py-4 text-sm text-fg">{t("confirm.deleteSpare").replace("{sku}", spare.sku)}</p>
            <div className="flex items-center gap-2 px-5 py-3 border-t border-fg/10">
              <span className="flex-1" />
              <button type="button" onClick={() => setConfirmDelete(false)} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.back")}</button>
              <button type="button" onClick={() => void handleDelete()} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold hover:brightness-110 disabled:opacity-50">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Avisos y errores en ventanita. */}
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// SparesPage
// ---------------------------------------------------------------------------

type SpareCard = "" | "zero" | "low" | "reorder" | "critA";

export const SparesPage: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const can = useCan();

  // ── Listado (preview V23) ──────────────────────────────────────────────────
  // Se trae todo y se filtra en cliente: las tarjetas necesitan el total.
  // ?criticality= y ?stockStatus= (desde el Dashboard) siguen arrancando su filtro.
  const initialStock = searchParams.get("stockStatus") ?? "";
  const [cardSel, setCardSel] = useState<SpareCard>(() => (initialStock === "sin_stock" ? "zero" : initialStock === "bajo_reorden" ? "reorder" : ""));
  const [okOnly] = useState(initialStock === "ok");
  const [vesselSel, setVesselSel] = useState("");
  const [critSel, setCritSel] = useState(() => searchParams.get("criticality") ?? "");
  const [statusSel, setStatusSel] = useState<"ACTIVE" | "OBSOLETE" | "">("ACTIVE");
  const [catSel, setCatSel] = useState("");
  const [searchText, setSearchText] = useState("");
  const [showExcel, setShowExcel] = useState(false);
  const [selected, setSelected] = useState<Spare | null>(null);
  // "Nuevo repuesto" abre la Recepción: el repuesto se da de alta desde lo que
  // llegó al buque, después de que la ventana busca los parecidos. Es lo que
  // evita que el mismo filtro entre dos veces con nombres distintos.
  const [showReceipt, setShowReceipt] = useState(false);
  const [showForms, setShowForms] = useState(false);
  // Pedido múltiple (Preview V3): ids tildados. Una solicitud es de un solo buque.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [showBatch, setShowBatch] = useState(false);
  const { vessels, selectedVesselCode } = useVesselContext();

  const { data, loading, error, reload } = useFetch<ListResponse>("/app/pms/spares", []);
  // Nexos: tareas del plan con repuestos y recepciones (se cargan aparte, no frenan la lista).
  const plansFetch = useFetch<{ items: PlanWithSpares[] }>("/app/pms/maintenance-plans", []);
  const receiptsFetch = useFetch<{ items: ReceiptLite[] }>("/app/pms/goods-receipts", []);
  const plans = useMemo(() => plansFetch.data?.items ?? [], [plansFetch.data]);
  const receipts = useMemo(() => receiptsFetch.data?.items ?? [], [receiptsFetch.data]);
  const tmsaFilter = useTmsaFilter();

  const allItems = useMemo(() => applyTmsaFilter(data?.items ?? null, tmsaFilter, s => s.id) ?? [], [data, tmsaFilter]);
  const planCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plans) {
      if (p.status === "INACTIVE" || !Array.isArray(p.spares)) continue;
      for (const id of new Set(p.spares.map(s => s?.spareId).filter(Boolean) as string[])) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [plans]);
  const matchCard = (s: Spare, k: SpareCard) => {
    switch (k) {
      case "zero":    return s.available <= 0;
      case "low":     return stockLevel(s) === "low";
      case "reorder": return s.available > 0 && s.available < s.reorderPoint;
      case "critA":   return s.criticality === "A" && stockLevel(s) === "low";
      default:        return true;
    }
  };
  const filteredItems = useMemo(() => {
    let items = allItems;
    if (cardSel) items = items.filter(s => matchCard(s, cardSel));
    if (okOnly) items = items.filter(s => s.available >= s.reorderPoint);
    if (vesselSel) items = items.filter(s => s.vesselCode === vesselSel);
    if (critSel) items = items.filter(s => s.criticality === critSel);
    if (statusSel) items = items.filter(s => s.status === statusSel);
    if (catSel) items = items.filter(s => (s.category ?? "") === catSel);
    const q = searchText.trim().toLowerCase();
    if (q) {
      items = items.filter(s =>
        textMatches(s.sku, q) || textMatches(s.name, q) || textMatches(s.sfiCode, q) || textMatches(s.manufacturer, q) ||
        textMatches(s.manufacturerPartNumber, q) || textMatches(s.internalPartNumber, q) || textMatches(s.location, q));
    }
    return items;
  }, [allItems, cardSel, okOnly, vesselSel, critSel, statusSel, catSel, searchText]);
  const countBase = useMemo(() => allItems.filter(s => (!statusSel || s.status === statusSel) && (!vesselSel || s.vesselCode === vesselSel)), [allItems, statusSel, vesselSel]);
  const categories = useMemo(() => [...new Set(allItems.map(s => s.category).filter(Boolean) as string[])].sort(), [allItems]);
  const vesselOptions = useMemo(() => [...new Set(allItems.map(s => s.vesselCode))], [allItems]);
  const vesselName = (code: string) => vessels.find(v => v.code === code)?.name || code;

  const handleSaved = (s: Spare) => { reload(); setSelected(s); };
  const mocTrigger = useMocTrigger();

  const canRequest = can("spareRequest.manage");
  const pickedItems = allItems.filter(s => picked.has(s.id));
  const pickedVessel = pickedItems[0]?.vesselCode ?? null;
  const togglePick = (s: Spare) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
    return next;
  });
  const pickBox = (s: Spare) => {
    const otherVessel = !!pickedVessel && s.vesselCode !== pickedVessel;
    return (
      <input type="checkbox" checked={picked.has(s.id)} disabled={otherVessel}
        title={otherVessel ? t("sp.batch.otherVessel") : undefined}
        onClick={e => e.stopPropagation()} onChange={() => togglePick(s)}
        className="h-4 w-4 cursor-pointer accent-orange-600 disabled:cursor-not-allowed disabled:opacity-30" />
    );
  };
  const critChip = (c: string) => <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10.5px] font-black ${CRIT_CHIP[c] ?? CRIT_CHIP.C}`}>{c}</span>;

  const COLUMNS: Column<Spare>[] = [
    ...(canRequest ? [{ key: "pick", header: "", width: "36px", render: pickBox } as Column<Spare>] : []),
    {
      key: "name", header: t("sp.v23.col.spare"), sortValue: r => r.name,
      render: r => (
        <div className="min-w-0">
          <div className="text-xs font-bold text-fg">{r.name}</div>
          {/* Nombre del buque, no el código. */}
          <div className="text-[10.5px] text-text-industrial/50"><span className="font-mono">{r.sku}</span> · {vesselName(r.vesselCode)}</div>
        </div>
      ),
    },
    { key: "category", header: t("col.category"), sortValue: r => r.category ?? "", filterValue: r => r.category ?? "", render: r => <span className="text-xs text-text-industrial/60">{r.category ?? "—"}</span> },
    { key: "criticality", header: t("col.criticality"), sortValue: r => r.criticality, filterValue: r => r.criticality, render: r => critChip(r.criticality) },
    { key: "onHand", header: t("col.stockCurrent"), sortValue: r => r.onHand - r.minStock, render: r => <StockBar spare={r} /> },
    { key: "location", header: t("sp.v23.col.where"), filterValue: r => r.location ?? "", render: r => <span className="text-xs text-text-industrial/60">{r.location ?? "—"}</span> },
    {
      key: "usedIn", header: t("sp.v23.usedIn"), sortValue: r => planCount.get(r.id) ?? 0,
      render: r => planCount.get(r.id)
        ? <span className="inline-flex items-center gap-1 text-[11px] text-text-industrial/60 whitespace-nowrap"><CalendarCheck className="w-3 h-3" />{t("sp.v23.tasksN").replace("{n}", String(planCount.get(r.id)))}</span>
        : <span className="text-text-industrial/30">—</span>,
    },
  ];

  const selCls = (on: boolean) => `rounded-lg border px-2 py-1.5 text-xs focus:outline-none focus:border-accent/50 ${on ? "border-accent bg-accent/5 font-bold text-accent" : "border-fg/10 bg-fg/5 text-fg"}`;

  return (
    <div className="space-y-4">
      {showExcel && <ExcelPanel module="spares" onClose={() => { setShowExcel(false); reload(); }} />}
      {selected && (
        <SpareModal
          key={selected.id}
          spare={selected}
          plans={plans}
          receipts={receipts}
          onClose={() => { setSelected(null); reload(); }}
          onSaved={handleSaved}
          onMocTrigger={mocTrigger.ask}
        />
      )}

      {showReceipt && (
        <SpareReceiptModal
          vessels={vessels.map(v => ({ code: v.code, name: v.name ?? null }))}
          defaultVesselCode={vesselSel || selectedVesselCode}
          onClose={() => setShowReceipt(false)}
          onSaved={() => { reload(); void receiptsFetch.reload(); }}
        />
      )}

      {showForms && (
        <SpareFormsModal
          // Con un buque global elegido, useFetch lo fuerza en las consultas: se ofrece sólo ese.
          vessels={vessels.filter(v => !selectedVesselCode || v.code === selectedVesselCode).map(v => ({ code: v.code, name: v.name ?? v.code }))}
          defaultVesselCode={selectedVesselCode || vesselSel}
          onClose={() => setShowForms(false)}
        />
      )}

      {showBatch && pickedItems.length > 0 && (
        <SpareRequestBatchModal
          spares={pickedItems}
          vesselName={vesselName(pickedItems[0]!.vesselCode)}
          onRemove={id => { const next = new Set(picked); next.delete(id); setPicked(next); if (next.size === 0) setShowBatch(false); }}
          onClose={() => setShowBatch(false)}
          onCreated={() => { setShowBatch(false); setPicked(new Set()); navigate("/spare-requests"); }}
        />
      )}

      <MocTriggerHost controller={mocTrigger} />

      <PageHeader icon={Package} title={t("page.spares")} total={filteredItems.length} onReload={reload}>
        <button onClick={() => setShowForms(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <ClipboardList className="w-3.5 h-3.5 text-accent" /> {t("sp.forms.button")}
        </button>
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
        {canRequest && (
          <button onClick={() => setShowBatch(true)} disabled={pickedItems.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-bold hover:brightness-110 transition-all disabled:opacity-40">
            <ShoppingCart className="w-3.5 h-3.5" /> {t("sp.batch.button")}{pickedItems.length > 0 ? ` (${pickedItems.length})` : ""}
          </button>
        )}
        {/* Alta: pasa por la Recepción (busca primero, crea después). */}
        {can("stock.manage") && (
          <button onClick={() => setShowReceipt(true)} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold hover:brightness-110 transition-all">
            <Plus className="w-3.5 h-3.5" /> {t("sp.v23.new")}
          </button>
        )}
      </PageHeader>

      {/* Filtros */}
      <div className="rounded-2xl border border-fg/10 bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          {vesselOptions.length > 1 && (
            <select value={vesselSel} onChange={e => setVesselSel(e.target.value)} className={selCls(!!vesselSel)}>
              <option value="">{t("sp.v23.vesselAll")}</option>
              {vesselOptions.map(v => <option key={v} value={v}>{vesselName(v)}</option>)}
            </select>
          )}
          <select value={catSel} onChange={e => setCatSel(e.target.value)} className={`${selCls(!!catSel)} max-w-[14rem]`}>
            <option value="">{t("sp.v23.catAll")}</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={critSel} onChange={e => setCritSel(e.target.value)} className={selCls(!!critSel)}>
            <option value="">{t("sp.v23.critAll")}</option>
            <option value="A">{t("sp.critAImportant")}</option>
            <option value="B">{t("sp.critB")}</option>
            <option value="C">{t("sp.critC")}</option>
          </select>
          <select value={statusSel} onChange={e => setStatusSel(e.target.value as typeof statusSel)} className={selCls(statusSel !== "ACTIVE")}>
            <option value="ACTIVE">{t("sp.v23.statusActive")}</option>
            <option value="OBSOLETE">{t("sp.v23.statusObsolete")}</option>
            <option value="">{t("sp.v23.statusAll")}</option>
          </select>
          <div className="flex items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 w-full sm:w-auto sm:ml-auto">
            <Search className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />
            <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder={t("sp.v23.search")}
              className="w-full sm:w-64 bg-transparent text-xs text-fg placeholder-text-industrial/30 focus:outline-none" />
            {searchText && <button type="button" onClick={() => setSearchText("")} className="text-text-industrial/40 hover:text-fg"><X className="w-3 h-3" /></button>}
          </div>
        </div>
      </div>

      {pickedItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs">
          <b className="text-fg">{t("sp.batch.selected").replace("{n}", String(pickedItems.length)).replace("{vessel}", vesselName(pickedVessel!))}</b>
          <button type="button" className="font-semibold text-orange-700 dark:text-orange-300 hover:underline"
            onClick={() => setPicked(prev => new Set([...prev, ...filteredItems.filter(s => s.vesselCode === pickedVessel && s.available <= 0).map(s => s.id)]))}>
            {t("sp.batch.pickZero")}
          </button>
          <button type="button" className="font-semibold text-orange-700 dark:text-orange-300 hover:underline" onClick={() => setPicked(new Set())}>
            {t("sp.batch.clear")}
          </button>
        </div>
      )}

      <TmsaFilterBanner filter={tmsaFilter} shown={filteredItems.length} total={data?.items?.length ?? 0} />

      {/* Escritorio: tabla · Celular: tarjetas */}
      <div className="hidden md:block">
        <DataTable columns={COLUMNS} data={filteredItems} loading={loading} error={error} keyFn={r => r.id} emptyText={t("empty.spares")}
          onRowClick={r => setSelected(r)}
          rowClassName={r => (r.criticality === "A" && stockLevel(r) === "low" ? "bg-red-500/[0.06] shadow-[inset_4px_0_0_rgb(220,38,38)]" : "")} />
      </div>
      <div className="md:hidden flex flex-col gap-2">
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>}
        {!loading && filteredItems.length === 0 && <p className="py-8 text-center text-sm text-text-industrial/40">{t("empty.spares")}</p>}
        {filteredItems.slice(0, 200).map(s => (
          <div key={s.id} onClick={() => setSelected(s)}
            className={`rounded-xl border border-fg/10 border-l-4 px-3 py-2.5 space-y-1.5 cursor-pointer ${stockLevel(s) === "low" ? "border-l-red-600" : stockLevel(s) === "reorder" ? "border-l-amber-500" : "border-l-fg/10"} bg-surface`}>
            <div className="flex items-center gap-1.5">{canRequest && pickBox(s)}{critChip(s.criticality)}<b className="text-[13px] text-fg truncate">{s.name}</b></div>
            <p className="text-[11px] text-text-industrial/55"><span className="font-mono">{s.sku}</span>{s.location ? ` · ${s.location}` : ""}</p>
            <StockBar spare={s} />
          </div>
        ))}
      </div>
    </div>
  );
};
