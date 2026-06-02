import React, { useEffect, useMemo, useState } from "react";
import { FileBarChart, FileDown, History, Loader2, Package, RefreshCw } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useVesselContext } from "../lib/vessel-context";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg placeholder-fg/20 focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-semibold text-fg/50 uppercase tracking-wider mb-1";

type Department = "CUBIERTA" | "MAQUINAS" | "COCINA" | "BARCAZA";
const DEPARTMENTS: Department[] = ["CUBIERTA", "MAQUINAS", "COCINA", "BARCAZA"];

const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

interface InventoryItem {
  id: string; sku: string; name: string;
  longDescription: string | null; category: string | null;
  unit: string; onHand: number; minStock: number; reorderPoint: number;
  belowReorder: boolean; location: string | null; sfiCode: string | null;
  department: Department | null; lastMovementAt: string | null;
}

interface InventoryReport {
  vessel: { code: string; name: string; type: string | null; isBarcaza: boolean };
  context: { reportDate: string | null; operationalStatus: string | null; currentPort: string | null; positionLat: number | null; positionLon: number | null };
  filters: { asOfDate: string; department: Department | null };
  items: InventoryItem[];
  summary: { totalItems: number; belowReorderCount: number };
  documentRevision: number;
}

interface ConsumptionItem {
  spareId: string; sku: string; name: string; unit: string;
  sfiCode: string | null; department: Department | null;
  consumed: number; references: Array<{ type: string; id: string }>;
}

interface ConsumptionReport {
  vessel: { code: string; name: string; type: string | null; isBarcaza: boolean };
  period: { year: number; month: number; fromIso: string; toIso: string };
  items: ConsumptionItem[];
  summary: { totalLines: number; totalConsumedQty: number };
  documentRevision: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function downloadReportPdf(url: string, filename: string): Promise<void> {
  // Use .then() chain (NOT async/await) so the click() stays within the
  // user-gesture context — Chrome blocks downloads triggered after an `await`.
  const token = localStorage.getItem("gpms_token") ?? "";
  const slug  = localStorage.getItem("gpms_tenant_slug") ?? "";
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "X-Tenant-Slug": slug },
  }).then(r => {
    if (!r.ok) throw new Error("PDF generation failed");
    return r.blob();
  }).then(blob => {
    // Force application/pdf MIME so Chrome doesn't flag it as unsafe.
    const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
    const objUrl = URL.createObjectURL(pdfBlob);
    const a = document.createElement("a");
    a.href = objUrl; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
  });
}

// ─── Inventory Tab ───────────────────────────────────────────────────────────

const InventoryTab: React.FC<{ vesselCode: string; onDownloaded?: () => void }> = ({ vesselCode, onDownloaded }) => {
  const [department, setDepartment] = useState<Department | "">("");
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [downloading, setDownloading] = useState(false);

  const queryUrl = useMemo(() => {
    if (!vesselCode) return null;
    const p = new URLSearchParams({ vesselCode, asOfDate });
    if (department) p.set("department", department);
    return `/app/pms/reports/spare-inventory?${p.toString()}`;
  }, [vesselCode, department, asOfDate]);

  const { data, loading, reload } = useFetch<InventoryReport>(queryUrl ?? "");

  const handleDownload = () => {
    if (!vesselCode) return;
    setDownloading(true);
    const p = new URLSearchParams({ vesselCode, asOfDate });
    if (department) p.set("department", department);
    const filename = `inventario-${vesselCode}-${asOfDate}.pdf`;
    downloadReportPdf(`/app/pms/reports/spare-inventory/pdf?${p.toString()}`, filename)
      .then(() => onDownloaded?.())
      .finally(() => setDownloading(false));
  };

  if (!vesselCode) {
    return <p className="text-xs text-fg/40 px-4 py-8 text-center">Seleccioná un buque para generar el reporte de inventario.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap bg-fg/5 border border-fg/10 rounded-lg p-3">
        <div className="min-w-[140px]">
          <label className={labelCls}>Departamento</label>
          <select value={department} onChange={e => setDepartment(e.target.value as Department | "")} className={inputCls}>
            <option value="">Todos</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="min-w-[140px]">
          <label className={labelCls}>Fecha snapshot</label>
          <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} className={inputCls} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => void reload()} className="px-3 py-1.5 text-xs font-semibold bg-fg/5 border border-fg/10 text-fg/60 rounded-lg hover:bg-fg/10 hover:text-fg transition-colors">
            Actualizar
          </button>
          <button onClick={handleDownload} disabled={downloading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-accent/20 border border-accent/30 text-accent rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-40">
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
            Descargar PDF
          </button>
        </div>
      </div>

      {loading && <p className="text-xs text-fg/40 px-4 py-8 text-center"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Cargando inventario…</p>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="bg-fg/5 border border-fg/10 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg/40 mb-1">Buque</div>
              <div className="text-fg font-semibold">{data.vessel.code} — {data.vessel.name}</div>
              {data.vessel.isBarcaza && <span className="inline-block mt-1 px-2 py-0.5 text-[9px] bg-blue-500/20 text-blue-400 rounded">BARCAZA</span>}
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg/40 mb-1">Total ítems</div>
              <div className="text-fg text-xl font-bold">{data.summary.totalItems}</div>
            </div>
            <div className={`border rounded-lg p-3 ${data.summary.belowReorderCount > 0 ? "bg-red-500/10 border-red-500/30" : "bg-fg/5 border-fg/10"}`}>
              <div className="text-[10px] uppercase tracking-wider text-fg/40 mb-1">Bajo reorder</div>
              <div className={`text-xl font-bold ${data.summary.belowReorderCount > 0 ? "text-red-400" : "text-fg"}`}>{data.summary.belowReorderCount}</div>
            </div>
          </div>

          <div className="bg-fg/5 border border-fg/10 rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-fg/10">
                <tr className="text-[10px] uppercase tracking-wider text-fg/40">
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Nombre</th>
                  <th className="px-3 py-2 text-left">SFI</th>
                  <th className="px-3 py-2 text-left">Depto</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                  <th className="px-3 py-2 text-left">Un</th>
                  <th className="px-3 py-2 text-left">Ubicación</th>
                  <th className="px-3 py-2 text-left">Últ. Mov.</th>
                </tr>
              </thead>
              <tbody className="text-fg/80">
                {data.items.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-fg/30">Sin ítems para los filtros seleccionados.</td></tr>
                )}
                {data.items.map(it => (
                  <tr key={it.id} className={`border-b border-fg/5 hover:bg-fg/5 ${it.belowReorder ? "text-red-400" : ""}`}>
                    <td className="px-3 py-2 font-mono">{it.sku}</td>
                    <td className="px-3 py-2">{it.name}</td>
                    <td className="px-3 py-2 font-mono text-[10px]">{it.sfiCode ?? "—"}</td>
                    <td className="px-3 py-2 text-[10px]">{it.department ?? "—"}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${it.belowReorder ? "text-red-400" : ""}`}>{it.onHand}</td>
                    <td className="px-3 py-2 text-[10px]">{it.unit}</td>
                    <td className="px-3 py-2 text-[10px]">{it.location ?? "—"}</td>
                    <td className="px-3 py-2 text-[10px]">{fmtDate(it.lastMovementAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

// ─── Consumption Tab ─────────────────────────────────────────────────────────

const ConsumptionTab: React.FC<{ vesselCode: string; onDownloaded?: () => void }> = ({ vesselCode, onDownloaded }) => {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [downloading, setDownloading] = useState(false);

  const queryUrl = useMemo(() => {
    if (!vesselCode) return null;
    return `/app/pms/reports/spare-consumption?vesselCode=${encodeURIComponent(vesselCode)}&year=${year}&month=${month}`;
  }, [vesselCode, year, month]);

  const { data, loading, reload } = useFetch<ConsumptionReport>(queryUrl ?? "");

  const handleDownload = () => {
    if (!vesselCode) return;
    setDownloading(true);
    const filename = `consumo-${vesselCode}-${year}-${String(month).padStart(2, "0")}.pdf`;
    const url = `/app/pms/reports/spare-consumption/pdf?vesselCode=${encodeURIComponent(vesselCode)}&year=${year}&month=${month}`;
    downloadReportPdf(url, filename)
      .then(() => onDownloaded?.())
      .finally(() => setDownloading(false));
  };

  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    return [cur - 2, cur - 1, cur, cur + 1];
  }, []);

  if (!vesselCode) {
    return <p className="text-xs text-fg/40 px-4 py-8 text-center">Seleccioná un buque para generar el reporte de consumo mensual.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap bg-fg/5 border border-fg/10 rounded-lg p-3">
        <div className="min-w-[140px]">
          <label className={labelCls}>Mes</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className={inputCls}>
            {MONTH_NAMES_ES.map((n, i) => <option key={i + 1} value={i + 1}>{n}</option>)}
          </select>
        </div>
        <div className="min-w-[100px]">
          <label className={labelCls}>Año</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className={inputCls}>
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => void reload()} className="px-3 py-1.5 text-xs font-semibold bg-fg/5 border border-fg/10 text-fg/60 rounded-lg hover:bg-fg/10 hover:text-fg transition-colors">
            Actualizar
          </button>
          <button onClick={handleDownload} disabled={downloading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-accent/20 border border-accent/30 text-accent rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-40">
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
            Descargar PDF
          </button>
        </div>
      </div>

      {loading && <p className="text-xs text-fg/40 px-4 py-8 text-center"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Cargando consumo…</p>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="bg-fg/5 border border-fg/10 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg/40 mb-1">Período</div>
              <div className="text-fg font-semibold">{MONTH_NAMES_ES[data.period.month - 1]} {data.period.year}</div>
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg/40 mb-1">Ítems consumidos</div>
              <div className="text-fg text-xl font-bold">{data.summary.totalLines}</div>
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg/40 mb-1">Cantidad total</div>
              <div className="text-fg text-xl font-bold">{data.summary.totalConsumedQty.toFixed(2)}</div>
            </div>
          </div>

          <div className="bg-fg/5 border border-fg/10 rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-fg/10">
                <tr className="text-[10px] uppercase tracking-wider text-fg/40">
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Repuesto</th>
                  <th className="px-3 py-2 text-left">SFI</th>
                  <th className="px-3 py-2 text-left">Depto</th>
                  <th className="px-3 py-2 text-right">Consumo</th>
                  <th className="px-3 py-2 text-left">Un</th>
                  <th className="px-3 py-2 text-left">Refs</th>
                </tr>
              </thead>
              <tbody className="text-fg/80">
                {data.items.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-fg/30">Sin consumo registrado para el período.</td></tr>
                )}
                {data.items.map(it => (
                  <tr key={it.spareId} className="border-b border-fg/5 hover:bg-fg/5">
                    <td className="px-3 py-2 font-mono">{it.sku}</td>
                    <td className="px-3 py-2">{it.name}</td>
                    <td className="px-3 py-2 font-mono text-[10px]">{it.sfiCode ?? "—"}</td>
                    <td className="px-3 py-2 text-[10px]">{it.department ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold">{it.consumed}</td>
                    <td className="px-3 py-2 text-[10px]">{it.unit}</td>
                    <td className="px-3 py-2 text-[10px] text-fg/50">
                      {it.references.length === 0 ? "—" : `${it.references.length} ref(s)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

// ─── History Panel ───────────────────────────────────────────────────────────

interface HistoryItem {
  id: string;
  createdAt: string;
  type: "INVENTORY" | "CONSUMPTION";
  vesselCode: string;
  fileName: string;
  asOfDate: string | null;
  year: number | null;
  month: number | null;
  department: string | null;
  actorUserId: string | null;
  actorName: string | null;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function describePeriod(it: HistoryItem): string {
  if (it.type === "CONSUMPTION" && it.year && it.month) {
    return `${MONTH_NAMES_ES[it.month - 1]} ${it.year}`;
  }
  if (it.type === "INVENTORY" && it.asOfDate) {
    return `Snapshot ${fmtDate(it.asOfDate)}`;
  }
  return "—";
}

const HistoryPanel: React.FC<{ vesselCode: string; refreshKey: number }> = ({ vesselCode, refreshKey }) => {
  const url = useMemo(() => {
    const p = new URLSearchParams({ limit: "50" });
    if (vesselCode) p.set("vesselCode", vesselCode);
    return `/app/pms/reports/history?${p.toString()}`;
  }, [vesselCode]);

  const { data, loading, reload } = useFetch<{ items: HistoryItem[]; total: number }>(url, [url, refreshKey]);
  const items = data?.items ?? [];

  return (
    <div className="mt-6 bg-fg/5 border border-fg/10 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-fg/10">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-accent" />
          <h3 className="text-xs font-bold text-fg uppercase tracking-wider">Historial de generaciones</h3>
          <span className="text-[10px] text-fg/40">{vesselCode ? `· ${vesselCode}` : "· Todos los buques"}</span>
        </div>
        <button
          onClick={() => void reload()}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-fg/50 hover:text-fg transition-colors"
          title="Actualizar"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-fg/10">
            <tr className="text-[10px] uppercase tracking-wider text-fg/40">
              <th className="px-3 py-2 text-left">Fecha y hora</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Buque</th>
              <th className="px-3 py-2 text-left">Período</th>
              <th className="px-3 py-2 text-left">Departamento</th>
              <th className="px-3 py-2 text-left">Generado por</th>
              <th className="px-3 py-2 text-left">Archivo</th>
            </tr>
          </thead>
          <tbody className="text-fg/80">
            {loading && items.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-fg/30"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Cargando historial…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-fg/30">Aún no hay reportes generados.</td></tr>
            )}
            {items.map(it => (
              <tr key={it.id} className="border-b border-fg/5 hover:bg-fg/5">
                <td className="px-3 py-2 font-mono text-[11px]">{fmtDateTime(it.createdAt)}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${it.type === "INVENTORY" ? "bg-accent/15 text-accent" : "bg-emerald-500/15 text-emerald-400"}`}>
                    {it.type === "INVENTORY" ? "Inventario" : "Consumo"}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono">{it.vesselCode || "—"}</td>
                <td className="px-3 py-2">{describePeriod(it)}</td>
                <td className="px-3 py-2 text-[10px]">{it.department ?? "—"}</td>
                <td className="px-3 py-2 text-[11px]">{it.actorName ?? it.actorUserId ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-fg/50">{it.fileName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

export const ReportsPage: React.FC = () => {
  const t = useT();
  const { selectedVesselCode, vessels, setSelectedVesselCode } = useVesselContext();
  const [tab, setTab] = useState<"inventory" | "consumption">("inventory");
  const [historyVersion, setHistoryVersion] = useState(0);
  const bumpHistory = () => setHistoryVersion(v => v + 1);

  // If no vessel is selected globally, allow picking one locally on this page
  const [localVessel, setLocalVessel] = useState<string>("");
  const effectiveVessel = selectedVesselCode || localVessel;

  // Default localVessel to the first available if context is empty
  useEffect(() => {
    if (!selectedVesselCode && !localVessel && vessels.length > 0) {
      setLocalVessel(vessels[0].code);
    }
  }, [selectedVesselCode, localVessel, vessels]);

  return (
    <div className="px-6 py-4">
      <PageHeader icon={FileBarChart} title={t("page.reports") || "Reportes"} />

      {!selectedVesselCode && (
        <div className="mt-3 mb-4 flex items-end gap-3 flex-wrap bg-fg/5 border border-fg/10 rounded-lg p-3">
          <div className="min-w-[200px]">
            <label className={labelCls}>Buque</label>
            <select value={localVessel} onChange={e => setLocalVessel(e.target.value)} className={inputCls}>
              <option value="">Seleccioná un buque…</option>
              {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
            </select>
          </div>
          {vessels.length > 0 && (
            <button
              onClick={() => setSelectedVesselCode(localVessel || null)}
              disabled={!localVessel}
              className="px-3 py-1.5 text-xs font-semibold bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 disabled:opacity-40"
            >
              Fijar como buque global
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2 border-b border-fg/10">
        <button
          onClick={() => setTab("inventory")}
          className={`px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${tab === "inventory" ? "border-accent text-accent" : "border-transparent text-fg/40 hover:text-fg/70"}`}
        >
          <Package className="w-3.5 h-3.5 inline mr-1.5" />
          Inventario
        </button>
        <button
          onClick={() => setTab("consumption")}
          className={`px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${tab === "consumption" ? "border-accent text-accent" : "border-transparent text-fg/40 hover:text-fg/70"}`}
        >
          <FileBarChart className="w-3.5 h-3.5 inline mr-1.5" />
          Consumo Mensual
        </button>
      </div>

      <div className="mt-4">
        {tab === "inventory"
          ? <InventoryTab vesselCode={effectiveVessel} onDownloaded={bumpHistory} />
          : <ConsumptionTab vesselCode={effectiveVessel} onDownloaded={bumpHistory} />
        }
      </div>

      <HistoryPanel vesselCode={effectiveVessel} refreshKey={historyVersion} />
    </div>
  );
};
