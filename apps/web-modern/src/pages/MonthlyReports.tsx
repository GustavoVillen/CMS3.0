import React, { useEffect, useMemo, useState } from "react";
import { FileBarChart, Loader2, Locate, Plus, Printer, Save, Send, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";
import { useVesselContext } from "../lib/vessel-context";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MonthlyReport {
  id: string;
  vesselCode: string;
  reportYear: number;
  reportMonth: number;
  status: "DRAFT" | "SUBMITTED" | "REVIEWED" | "CLOSED";
  operationalStatus: string | null;
  currentPort: string | null;
  positionLat: number | null;
  positionLon: number | null;
  summary: string | null;
  nextPort: string | null;
  etaNextPort: string | null;
  notes: string | null;
  inventorySnapshot: InventorySnapshot | null;
  inventorySnapshotAt: string | null;
  submittedAt: string | null;
  submittedByUserId: string | null;
  integratedAt: string | null;
  createdAt: string;
}

interface InventorySnapshotItem {
  id: string;
  sku: string;
  name: string;
  sfiCode: string | null;
  sfiName: string | null;
  department: string | null;
  onHand: number;
  unit: string;
  minStock: number;
  reorderPoint: number;
  belowReorder: boolean;
  location: string | null;
  lastMovementAt: string | null;
}
interface InventorySnapshot {
  asOfDate: string;
  items: InventorySnapshotItem[];
  summary: { totalItems: number; belowReorderCount: number };
}

interface ListResponse { items: MonthlyReport[]; total: number; }

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUSES = ["DRAFT", "SUBMITTED", "REVIEWED", "CLOSED"] as const;
const OPERATIONAL_STATUSES = ["AT_SEA", "MANOEUVRING", "ANCHORED", "IN_PORT", "DRY_DOCK", "LAID_UP"] as const;
const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const inputCls  = "w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const selectCls = "w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent/50";
const labelCls  = "block text-[10px] font-semibold text-text-industrial/60 uppercase tracking-wider";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMonth(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ─── Inventory Tab (live or snapshot) ────────────────────────────────────────

interface LiveInventoryItem {
  id: string;
  sku: string;
  name: string;
  sfiCode: string | null;
  sfiName?: string | null;
  department: string | null;
  onHand: number;
  unit: string;
  minStock: number;
  reorderPoint: number;
  belowReorder: boolean;
  location: string | null;
  lastMovementAt: string | null;
}
interface LiveInventoryReport {
  vessel: { code: string; name: string };
  filters: { asOfDate: string; department: string | null };
  items: LiveInventoryItem[];
  summary: { totalItems: number; belowReorderCount: number };
}

const InventoryTab: React.FC<{ vesselCode: string; snapshot: InventorySnapshot | null }> = ({ vesselCode, snapshot }) => {
  // If we have a frozen snapshot use it; otherwise pull live data.
  const liveUrl = snapshot ? null : (vesselCode ? `/app/pms/reports/spare-inventory?vesselCode=${encodeURIComponent(vesselCode)}` : null);
  const live = useFetch<LiveInventoryReport>(liveUrl ?? "");

  const items = snapshot
    ? snapshot.items
    : (live.data?.items ?? []);
  const summary = snapshot
    ? snapshot.summary
    : (live.data?.summary ?? { totalItems: 0, belowReorderCount: 0 });

  const sourceLabel = snapshot
    ? `Snapshot ${fmtDate(snapshot.asOfDate)} (congelado)`
    : `En vivo · ${fmtDate(live.data?.filters.asOfDate ?? null)}`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Buque</div>
          <div className="text-white font-semibold">{vesselCode || "—"}</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Total ítems</div>
          <div className="text-white text-xl font-bold">{summary.totalItems}</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Bajo reorden</div>
          <div className={`text-xl font-bold ${summary.belowReorderCount > 0 ? "text-red-400" : "text-white"}`}>{summary.belowReorderCount}</div>
        </div>
      </div>

      <p className="text-[10px] text-white/40">{sourceLabel}</p>

      <div className="bg-white/5 border border-white/10 rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-white/10">
            <tr className="text-[10px] uppercase tracking-wider text-white/40">
              <th className="px-3 py-2 text-left">SKU</th>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">SFI</th>
              <th className="px-3 py-2 text-left">Depto</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2 text-left">Un</th>
              <th className="px-3 py-2 text-left">Ubicación</th>
              <th className="px-3 py-2 text-left">Últ. mov.</th>
            </tr>
          </thead>
          <tbody className="text-white/80">
            {!snapshot && live.loading && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-white/30"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Cargando inventario…</td></tr>
            )}
            {items.length === 0 && (!snapshot ? !live.loading : true) && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-white/30">Sin ítems para mostrar.</td></tr>
            )}
            {items.map(it => {
              const sfi = (it as InventorySnapshotItem).sfiName
                ? `${(it as InventorySnapshotItem).sfiName} (${it.sfiCode})`
                : (it.sfiCode ?? "—");
              return (
                <tr key={it.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 font-mono text-[11px]">{it.sku}</td>
                  <td className="px-3 py-2">{it.name}</td>
                  <td className="px-3 py-2 text-[10px]">{sfi}</td>
                  <td className="px-3 py-2 text-[10px]">{it.department ?? "—"}</td>
                  <td className={`px-3 py-2 text-right font-bold ${it.belowReorder ? "text-red-400" : ""}`}>{it.onHand}</td>
                  <td className="px-3 py-2 text-[10px]">{it.unit}</td>
                  <td className="px-3 py-2 text-[10px]">{it.location ?? "—"}</td>
                  <td className="px-3 py-2 text-[10px] font-mono">{fmtDate(it.lastMovementAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Modal ───────────────────────────────────────────────────────────────────

interface MonthlyReportModalProps {
  report: MonthlyReport | null;
  vessels: { code: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}

const MonthlyReportModal: React.FC<MonthlyReportModalProps> = ({ report, vessels, onClose, onSaved }) => {
  const t = useT();
  const isNew = report === null;
  const [activeTab, setActiveTab] = useState<"info" | "inventory">("info");
  const [liveReport, setLiveReport] = useState<MonthlyReport | null>(report);

  // Form state — loaded from report or defaults for new
  const now = new Date();
  const [newVesselCode, setNewVesselCode]   = useState("");
  const [reportYear,    setReportYear]      = useState(report?.reportYear  ?? now.getFullYear());
  const [reportMonth,   setReportMonth]     = useState(report?.reportMonth ?? now.getMonth() + 1);
  const [status,            setStatus]            = useState(report?.status ?? "DRAFT");
  const [operationalStatus, setOperationalStatus] = useState(report?.operationalStatus ?? "");
  const [currentPort,       setCurrentPort]       = useState(report?.currentPort ?? "");
  const [posLat,            setPosLat]            = useState(report?.positionLat != null ? String(report.positionLat) : "");
  const [posLon,            setPosLon]            = useState(report?.positionLon != null ? String(report.positionLon) : "");
  const [summary,           setSummary]           = useState(report?.summary ?? "");
  const [nextPort,          setNextPort]          = useState(report?.nextPort ?? "");
  const [etaNextPort,       setEtaNextPort]       = useState(report?.etaNextPort ? report.etaNextPort.slice(0, 10) : "");
  const [notes,             setNotes]             = useState(report?.notes ?? "");

  const [mapCoords, setMapCoords] = useState<{ lat: number; lon: number } | null>(
    report?.positionLat != null && report?.positionLon != null
      ? { lat: report.positionLat, lon: report.positionLon }
      : null
  );

  const [geolocating, setGeolocating] = useState(false);
  const [geoError,    setGeoError]    = useState<string | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const isClosed = !isNew && (liveReport?.status === "CLOSED");

  // Auto-fetch GPS on mount when creating a new report and no coords yet.
  // Same pattern used in DailyReports.tsx.
  useEffect(() => {
    if (isNew && !posLat && !posLon) fetchGeoPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchGeoPosition = () => {
    if (!navigator.geolocation) { setGeoError("Geolocalización no soportada."); return; }
    setGeolocating(true); setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        setPosLat(lat.toFixed(6));
        setPosLon(lon.toFixed(6));
        setMapCoords({ lat, lon });
        setGeolocating(false);
      },
      err => { setGeoError(err.message || "No se pudo obtener la posición."); setGeolocating(false); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const buildPayload = () => ({
    status,
    operationalStatus: operationalStatus || null,
    currentPort: currentPort.trim() || null,
    positionLat: posLat !== "" ? parseFloat(posLat) : null,
    positionLon: posLon !== "" ? parseFloat(posLon) : null,
    summary: summary.trim() || null,
    nextPort: nextPort.trim() || null,
    etaNextPort: etaNextPort || null,
    notes: notes.trim() || null,
  });

  const handleSave = async () => {
    setSaving(true); setSaveError(null);
    try {
      if (isNew) {
        if (!newVesselCode) { setSaveError("Seleccionar buque."); setSaving(false); return; }
        const created = await api.post<MonthlyReport>("/app/pms/monthly-reports", {
          vesselCode: newVesselCode.trim().toUpperCase(),
          reportYear,
          reportMonth,
          ...buildPayload(),
        });
        setLiveReport(created);
        setActiveTab("inventory");
        onSaved();
      } else {
        const updated = await api.patch<MonthlyReport>(`/app/pms/monthly-reports/${liveReport!.id}`, buildPayload());
        setLiveReport(updated);
        onSaved();
      }
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!liveReport) {
      // New + Submit in one shot: save first, then submit.
      await handleSave();
      return;
    }
    setSubmitting(true); setSaveError(null);
    try {
      // Save current edits, then submit (freezes snapshot).
      await api.patch(`/app/pms/monthly-reports/${liveReport.id}`, buildPayload());
      const submitted = await api.post<MonthlyReport>(`/app/pms/monthly-reports/${liveReport.id}/submit`);
      setLiveReport(submitted);
      setStatus(submitted.status);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Error al enviar.");
    } finally {
      setSubmitting(false);
    }
  };

  const generatePdf = async () => {
    if (!liveReport) {
      setSaveError("Guardá el reporte antes de generar el PDF.");
      return;
    }
    setGeneratingPdf(true);
    try {
      const url = `/app/pms/reports/spare-inventory/pdf?vesselCode=${encodeURIComponent(liveReport.vesselCode)}`;
      const token = localStorage.getItem("gpms_token") ?? "";
      const slug  = localStorage.getItem("gpms_tenant_slug") ?? "";
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "X-Tenant-Slug": slug } });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
      const objUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `reporte-mensual-${liveReport.vesselCode}-${liveReport.reportYear}-${String(liveReport.reportMonth).padStart(2, "0")}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Error al generar PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    return [cur - 2, cur - 1, cur, cur + 1];
  }, []);

  const effectiveVesselCode = liveReport?.vesselCode ?? newVesselCode.trim().toUpperCase();

  return (
    <div className="fixed inset-0 z-300 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-5xl max-h-[90vh] bg-surface border border-white/10 rounded-2xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-white">{isNew ? "Nuevo Reporte Mensual" : `Reporte ${fmtMonth(liveReport!.reportYear, liveReport!.reportMonth)} — ${liveReport!.vesselCode}`}</h2>
            {!isNew && <p className="text-[10px] text-white/40">Estado: {liveReport!.status}{liveReport!.submittedAt ? ` · Enviado ${fmtDate(liveReport!.submittedAt)}` : ""}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5">
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-white/10 px-6 shrink-0">
          <button
            onClick={() => setActiveTab("info")}
            className={`px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${activeTab === "info" ? "border-accent text-accent" : "border-transparent text-white/40 hover:text-white/70"}`}
          >
            Info
          </button>
          <button
            onClick={() => setActiveTab("inventory")}
            disabled={isNew}
            className={`px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px disabled:opacity-30 disabled:cursor-not-allowed ${activeTab === "inventory" ? "border-accent text-accent" : "border-transparent text-white/40 hover:text-white/70"}`}
          >
            Inventario
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "info" && (
            <div className="space-y-4">
              {isNew && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className={labelCls}>Buque *</label>
                    <select value={newVesselCode} onChange={e => setNewVesselCode(e.target.value)} className={selectCls}>
                      <option value="">— Seleccionar —</option>
                      {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>Mes *</label>
                    <select value={reportMonth} onChange={e => setReportMonth(Number(e.target.value))} className={selectCls}>
                      {MONTH_NAMES.map((n, i) => <option key={i + 1} value={i + 1}>{n}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>Año *</label>
                    <select value={reportYear} onChange={e => setReportYear(Number(e.target.value))} className={selectCls}>
                      {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={labelCls}>Estado</label>
                  <select value={status} onChange={e => setStatus(e.target.value as MonthlyReport["status"])} disabled={isClosed} className={selectCls}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>Puerto actual</label>
                  <input value={currentPort} onChange={e => setCurrentPort(e.target.value)} disabled={isClosed} placeholder="Buenos Aires" className={inputCls} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={labelCls}>Estado operacional</label>
                <select value={operationalStatus} onChange={e => setOperationalStatus(e.target.value)} disabled={isClosed} className={selectCls}>
                  <option value="">—</option>
                  {OPERATIONAL_STATUSES.map(s => <option key={s} value={s}>{t(`opStatus.${s}` as never)}</option>)}
                </select>
              </div>

              {/* Posición */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className={labelCls}>Posición geográfica</label>
                  {!isClosed && (
                    <button type="button" onClick={fetchGeoPosition} disabled={geolocating}
                      className="flex items-center gap-1 text-[10px] text-accent hover:text-accent/80 disabled:opacity-40 transition-colors font-semibold">
                      {geolocating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Locate className="w-3 h-3" />}
                      {geolocating ? "Obteniendo…" : "Obtener GPS"}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[9px] text-text-industrial/30 mb-1">Latitud</p>
                    <input
                      value={posLat}
                      onChange={e => setPosLat(e.target.value)}
                      onBlur={() => {
                        const lat = parseFloat(posLat); const lon = parseFloat(posLon);
                        if (Number.isFinite(lat) && Number.isFinite(lon)) setMapCoords({ lat, lon });
                      }}
                      disabled={isClosed}
                      placeholder="−34.603722"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <p className="text-[9px] text-text-industrial/30 mb-1">Longitud</p>
                    <input
                      value={posLon}
                      onChange={e => setPosLon(e.target.value)}
                      onBlur={() => {
                        const lat = parseFloat(posLat); const lon = parseFloat(posLon);
                        if (Number.isFinite(lat) && Number.isFinite(lon)) setMapCoords({ lat, lon });
                      }}
                      disabled={isClosed}
                      placeholder="−58.381592"
                      className={inputCls}
                    />
                  </div>
                </div>
                {geoError && <p className="text-[10px] text-red-400">{geoError}</p>}

                {mapCoords ? (
                  <div className="relative rounded-xl overflow-hidden border border-white/10" style={{ height: 180 }}>
                    <iframe
                      key={`${mapCoords.lat},${mapCoords.lon}`}
                      title="Posición actual"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${mapCoords.lon - 0.025},${mapCoords.lat - 0.018},${mapCoords.lon + 0.025},${mapCoords.lat + 0.018}&layer=mapnik&marker=${mapCoords.lat},${mapCoords.lon}`}
                      className="w-full h-full"
                      style={{ border: 0, filter: "invert(0.88) hue-rotate(180deg) saturate(0.6)" }}
                      loading="lazy"
                    />
                    <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-md px-2 py-0.5 pointer-events-none">
                      <span className="font-mono text-[10px] text-white/80">
                        {mapCoords.lat.toFixed(5)}, {mapCoords.lon.toFixed(5)}
                      </span>
                    </div>
                  </div>
                ) : geolocating ? (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/3 text-text-industrial/30" style={{ height: 180 }}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Obteniendo ubicación…</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-white/8 bg-white/2 text-text-industrial/20" style={{ height: 180 }}>
                    <Locate className="w-5 h-5" />
                    <span className="text-[10px]">Sin posición registrada</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className={labelCls}>Resumen</label>
                <textarea value={summary} onChange={e => setSummary(e.target.value)} disabled={isClosed} rows={3} className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={labelCls}>Próximo puerto</label>
                  <input value={nextPort} onChange={e => setNextPort(e.target.value)} disabled={isClosed} placeholder="Puerto destino" className={inputCls} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>ETA próximo puerto</label>
                  <input type="date" value={etaNextPort} onChange={e => setEtaNextPort(e.target.value)} disabled={isClosed} className={inputCls} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={labelCls}>Notas</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} disabled={isClosed} rows={2} className={inputCls} />
              </div>

              {saveError && <p className="text-xs text-red-400">{saveError}</p>}
            </div>
          )}

          {activeTab === "inventory" && !isNew && (
            <InventoryTab vesselCode={effectiveVesselCode} snapshot={liveReport?.inventorySnapshot ?? null} />
          )}
        </div>

        {/* Footer with three buttons */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-white/10 shrink-0">
          <button
            onClick={() => { void handleSubmit(); }}
            disabled={submitting || saving || isClosed}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold text-xs hover:bg-emerald-500/25 disabled:opacity-40"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Submit
          </button>
          <button
            onClick={() => { void handleSave(); }}
            disabled={saving || submitting || isClosed}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Guardar
          </button>
          <button
            onClick={() => { void generatePdf(); }}
            disabled={generatingPdf || isNew}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white font-bold text-xs hover:bg-white/10 disabled:opacity-40"
          >
            {generatingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
            Generar PDF
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

export const MonthlyReportsPage: React.FC = () => {
  const t = useT();
  const { vessels } = useVesselContext();
  const [vesselFilter, setVesselFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<MonthlyReport | "new" | null>(null);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (vesselFilter) p.set("vesselCode", vesselFilter.trim().toUpperCase());
    if (statusFilter) p.set("status", statusFilter);
    const qs = p.toString();
    return `/app/pms/monthly-reports${qs ? `?${qs}` : ""}`;
  }, [vesselFilter, statusFilter]);

  const { data, loading, reload } = useFetch<ListResponse>(url, [url]);
  const items = data?.items ?? [];

  const COLUMNS: Column<MonthlyReport>[] = [
    { key: "period", header: "Período",   render: r => <span className="font-bold text-xs text-white">{fmtMonth(r.reportYear, r.reportMonth)}</span> },
    { key: "vesselCode", header: "Vessel", render: r => <span className="font-mono text-accent text-xs">{r.vesselCode}</span> },
    { key: "status",     header: "Estado", render: r => <StatusBadge status={r.status} /> },
    { key: "currentPort",header: "Puerto", render: r => <span className="text-xs">{r.currentPort ?? "—"}</span> },
    { key: "submittedAt",header: "Enviado", render: r => <span className="text-[11px] text-emerald-400">{fmtDate(r.submittedAt)}</span> },
    { key: "createdAt",  header: "Creado", render: r => <span className="text-[11px] text-white/40">{fmtDate(r.createdAt)}</span> },
  ];

  return (
    <div className="space-y-5">
      {selected && (
        <MonthlyReportModal
          report={selected === "new" ? null : selected}
          vessels={vessels}
          onClose={() => setSelected(null)}
          onSaved={() => { void reload(); }}
        />
      )}

      <PageHeader icon={FileBarChart} title={t("page.reports") || "Reportes Mensuales"} total={data?.total} onReload={reload}>
        <button
          onClick={() => setSelected("new")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110"
        >
          <Plus className="w-3.5 h-3.5" /> Nuevo reporte
        </button>
      </PageHeader>

      <DataTable<MonthlyReport>
        data={items}
        columns={COLUMNS}
        loading={loading}
        error={null}
        keyFn={r => r.id}
        onRowClick={r => setSelected(r)}
      />
    </div>
  );
};
