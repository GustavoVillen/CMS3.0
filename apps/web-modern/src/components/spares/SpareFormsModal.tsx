// Formularios de papel de la empresa desde Repuestos & Stock (Preview V2):
// Inventario REGI-MAN-04.1 y Estándar para viaje (planilla de solicitud de
// suministro). Sólo arma los filtros y descarga el PDF: el formato lo resuelve
// el backend (spare-inventory-pdf-service / spare-standard-pdf-service).

import React, { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { useFetch } from "../../lib/hooks";
import { useT } from "../../lib/i18n";
import { downloadAuthedFile } from "../../lib/authed-media";
import { ModalCloseButton } from "../ModalCloseButton";
import { AlertDialog } from "../AlertDialog";

type Department = "CUBIERTA" | "MAQUINAS" | "COCINA" | "BARCAZA";
const DEPARTMENTS: Department[] = ["CUBIERTA", "MAQUINAS", "COCINA", "BARCAZA"];
type FormKind = "INVENTORY" | "STANDARD";

interface InventoryReport { items: Array<{ onHand: number; kind: "TOOL" | "ARTICLE" | "FILTER_LUBE" | "SPARE" }> }
interface StandardReport { summary: { totalItems: number; itemsToRequest: number } }

interface Props {
  vessels: Array<{ code: string; name: string }>;
  defaultVesselCode: string;
  onClose: () => void;
}

const inputCls = "w-full rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-semibold uppercase tracking-wider text-text-industrial/60 mb-1";

export const SpareFormsModal: React.FC<Props> = ({ vessels, defaultVesselCode, onClose }) => {
  const t = useT();
  const [form, setForm] = useState<FormKind>("INVENTORY");
  const [vesselCode, setVesselCode] = useState(defaultVesselCode || vessels[0]?.code || "");
  const [department, setDepartment] = useState<Department>("MAQUINAS");
  const [mode, setMode] = useState<"FULL" | "HALF">("FULL");
  const [voyageNumber, setVoyageNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = new URLSearchParams({ vesselCode, department });
  const inventoryUrl = vesselCode && form === "INVENTORY" ? `/app/pms/reports/spare-inventory?${base.toString()}` : "";
  const standardUrl = vesselCode && form === "STANDARD" ? `/app/pms/reports/spare-standard?${base.toString()}&mode=${mode}` : "";
  const inventory = useFetch<InventoryReport>(inventoryUrl, [inventoryUrl]);
  const standard = useFetch<StandardReport>(standardUrl, [standardUrl]);

  const onBoard = (inventory.data?.items ?? []).filter(i => i.onHand > 0);
  const loading = form === "INVENTORY" ? inventory.loading : standard.loading;

  const download = async () => {
    if (!vesselCode) { setError(t("sp.forms.pickVessel")); return; }
    setBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (form === "INVENTORY") {
        const p = new URLSearchParams({ vesselCode, department, asOfDate: today });
        await downloadAuthedFile(`/app/pms/reports/spare-inventory/pdf?${p.toString()}`, `inventario-${vesselCode}-${today}.pdf`);
      } else {
        const p = new URLSearchParams({ vesselCode, department, mode });
        if (voyageNumber.trim()) p.set("voyageNumber", voyageNumber.trim());
        await downloadAuthedFile(`/app/pms/reports/spare-standard/pdf?${p.toString()}`, `estandar-${vesselCode}-${today}.pdf`);
      }
    } catch {
      setError(t("sp.pdfError"));
    } finally {
      setBusy(false);
    }
  };

  const choice = (kind: FormKind, title: string, desc: string) => (
    <button type="button" onClick={() => setForm(kind)}
      className={`rounded-xl border-[1.5px] px-3 py-2.5 text-left transition-all ${form === kind ? "border-accent bg-accent/5 ring-2 ring-accent/20" : "border-fg/10 hover:border-fg/25"}`}>
      <span className="block text-xs font-bold text-fg">{title}</span>
      <span className="block text-[11px] text-text-industrial/50 mt-0.5">{desc}</span>
    </button>
  );

  const pill = (label: string, value: number | string, warn = false) => (
    <div className={`flex-1 rounded-xl border px-3 py-2 ${warn ? "border-amber-500/40 bg-amber-500/10" : "border-fg/10 bg-fg/5"}`}>
      <p className="text-[9.5px] uppercase tracking-wider text-text-industrial/50">{label}</p>
      <p className={`text-lg font-bold ${warn ? "text-amber-700 dark:text-amber-400" : "text-fg"}`}>{value}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
      <div className="w-full max-w-xl rounded-2xl border border-fg/10 bg-surface shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-fg/10 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-fg">{t("sp.forms.title")}</h2>
            <p className="text-[11px] text-text-industrial/50">{t("sp.forms.subtitle")}</p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="space-y-3.5 px-5 py-4">
          <div className="grid grid-cols-2 gap-2.5">
            {choice("INVENTORY", t("sp.forms.inventory"), t("sp.forms.inventoryDesc"))}
            {choice("STANDARD", t("rep.std.tab"), t("sp.forms.standardDesc"))}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={labelCls}>{t("sp.forms.vessel")}</label>
              <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={inputCls}>
                {vessels.map(v => <option key={v.code} value={v.code}>{v.name || v.code}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t("rep.std.department")}</label>
              <select value={department} onChange={e => setDepartment(e.target.value as Department)} className={inputCls}>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            {form === "STANDARD" && (
              <>
                <div>
                  <label className={labelCls}>{t("rep.std.mode")}</label>
                  <div className="flex overflow-hidden rounded-lg border border-fg/10">
                    {(["FULL", "HALF"] as const).map(m => (
                      <button key={m} type="button" onClick={() => setMode(m)}
                        className={`flex-1 px-2 py-1.5 text-xs font-semibold transition-colors ${mode === m ? "bg-accent text-accent-fg" : "bg-fg/5 text-text-industrial/60 hover:text-fg"}`}>
                        {t(m === "FULL" ? "rep.std.full" : "rep.std.half")}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>{t("rep.std.voyage")}</label>
                  <input value={voyageNumber} onChange={e => setVoyageNumber(e.target.value)} maxLength={40} className={inputCls} />
                </div>
              </>
            )}
          </div>

          <div className="flex gap-2.5">
            {loading ? (
              <p className="flex-1 py-3 text-center text-xs text-text-industrial/40"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />{t("rep.std.loading")}</p>
            ) : form === "INVENTORY" ? (
              <>
                {pill(t("sp.forms.onBoardItems"), onBoard.filter(i => i.kind !== "TOOL").length)}
                {pill(t("sp.forms.tools"), onBoard.filter(i => i.kind === "TOOL").length)}
              </>
            ) : (
              <>
                {pill(t("rep.std.totalItems"), standard.data?.summary.totalItems ?? 0)}
                {pill(t("rep.std.toRequest"), standard.data?.summary.itemsToRequest ?? 0, (standard.data?.summary.itemsToRequest ?? 0) > 0)}
              </>
            )}
          </div>
          <p className="text-[11px] text-text-industrial/50">
            {form === "INVENTORY" ? t("sp.forms.inventoryHint") : t("sp.forms.standardHint")}
          </p>
        </div>

        <div className="flex justify-end border-t border-fg/10 px-5 py-3">
          <button type="button" onClick={() => void download()} disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-bold text-accent-fg hover:brightness-110 disabled:opacity-40">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            {t("rep.std.download")}
          </button>
        </div>
      </div>
    </div>
  );
};
