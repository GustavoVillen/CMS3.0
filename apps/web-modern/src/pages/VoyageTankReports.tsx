import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle, FileText, Fuel, Loader2, Plus, Trash2 } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { VesselLabel } from "../components/EntityLabels";
import { PageHeader } from "../components/PageHeader";
import { fmtDate } from "../lib/utils";
import { useT } from "../lib/i18n";
import { useCopilotEmitter } from "../lib/copilot-context";
import { AutoTextArea } from "../components/AutoTextArea";

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface VoyageTankReport {
  id: string;
  vesselCode: string;
  voyageCode: string;
  reportCode?: string | null;
  tramo?: string | null;
  reportDateTime?: string | null;
  status: string;
  kmStart?: number | null;
  kmEnd?: number | null;
  dateStart?: string | null;
  dateEnd?: string | null;
  daysNav?: number | null;
  bunkerReceivedLts?: number | null;
  bargeDeliveredLts?: number | null;
  signatory?: string | null;
  notes?: string | null;
  createdAt: string;
}

interface ListResponse { items: VoyageTankReport[]; total: number; }

interface TankRow {
  tankLabel: string;
  tankOrder: number;
  liquidHeightMmInitial: string;
  waterHeightMmInitial: string;
  volumeTotalLtsInitial: string;
  volumeWaterLtsInitial: string;
  liquidHeightMmFinal: string;
  waterHeightMmFinal: string;
  volumeTotalLtsFinal: string;
  volumeWaterLtsFinal: string;
}

interface EngineRow {
  assetId?: string | null;
  engineLabel: string;
  engineOrder: number;
  hoursInitial: string;
  hoursFinal: string;
}

interface FullReport extends VoyageTankReport {
  tankReadings: any[];
  engineHours: any[];
}

// ─── Estilos compartidos (espejo de DailyReports) ────────────────────────────

const inputCls  = "w-full bg-fg/5 border border-fg/10 rounded-lg px-2 py-1.5 text-xs text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const inputSm    = "w-full bg-fg/5 border border-fg/10 rounded-md px-1.5 py-1 text-[11px] text-fg text-right placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls  = "block text-[10px] font-semibold text-text-industrial/60 uppercase tracking-wider";

const STATUSES = ["DRAFT", "SUBMITTED", "CLOSED"] as const;

// Helpers de cálculo (misma fórmula que el PDF backend).
const n = (v: string): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const fmtLts = (v: number): string => Math.round(v).toLocaleString("es-AR");

// ─── Drawer de detalle ───────────────────────────────────────────────────────

interface DrawerProps {
  report: VoyageTankReport | null;
  onClose: () => void;
  onSaved: () => void;
}

const VoyageTankReportDrawer: React.FC<DrawerProps> = ({ report, onClose, onSaved }) => {
  const t = useT();
  const { vessels } = useVesselContext();
  const [live, setLive] = useState<VoyageTankReport | null>(report);
  const isNew = live === null;
  const isClosed = !isNew && live!.status === "CLOSED";

  // Encabezado
  const [newVesselCode, setNewVesselCode] = useState("");
  const [voyageCode, setVoyageCode] = useState(report?.voyageCode ?? "");
  const [tramo, setTramo] = useState(report?.tramo ?? "");
  const [reportDateTime, setReportDateTime] = useState(report?.reportDateTime ? report.reportDateTime.slice(0, 16) : "");
  const [status, setStatus] = useState(report?.status ?? "DRAFT");
  // Viaje / bunker
  const [kmStart, setKmStart] = useState(report?.kmStart != null ? String(report.kmStart) : "");
  const [kmEnd, setKmEnd] = useState(report?.kmEnd != null ? String(report.kmEnd) : "");
  const [dateStart, setDateStart] = useState(report?.dateStart ? report.dateStart.slice(0, 16) : "");
  const [dateEnd, setDateEnd] = useState(report?.dateEnd ? report.dateEnd.slice(0, 16) : "");
  const [daysNav, setDaysNav] = useState(report?.daysNav != null ? String(report.daysNav) : "");
  const [bunkerReceived, setBunkerReceived] = useState(report?.bunkerReceivedLts != null ? String(report.bunkerReceivedLts) : "");
  const [bargeDelivered, setBargeDelivered] = useState(report?.bargeDeliveredLts != null ? String(report.bargeDeliveredLts) : "");
  const [signatory, setSignatory] = useState(report?.signatory ?? "");
  const [notes, setNotes] = useState(report?.notes ?? "");

  // Hijos
  const [tanks, setTanks] = useState<TankRow[]>([]);
  const [engines, setEngines] = useState<EngineRow[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Auto-sugerir días de navegación desde las fechas (sin pisar si el usuario ya escribió).
  useEffect(() => {
    if (!dateStart || !dateEnd || daysNav !== "") return;
    const a = new Date(dateStart), b = new Date(dateEnd);
    if (!isNaN(a.getTime()) && !isNaN(b.getTime()) && b >= a) {
      setDaysNav(String(Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000))));
    }
  }, [dateStart, dateEnd, daysNav]);

  // Cargar hijos (tanques sembrados + horómetros) cuando el reporte ya existe.
  const loadFull = async (id: string, vesselCode: string) => {
    try {
      const full = await api.get<FullReport>(`/app/voyage-tank-reports/${id}/full`);
      setTanks((full.tankReadings ?? []).map((r: any, i: number) => ({
        tankLabel: r.tankLabel,
        tankOrder: r.tankOrder ?? i,
        liquidHeightMmInitial: r.liquidHeightMmInitial != null ? String(r.liquidHeightMmInitial) : "",
        waterHeightMmInitial: r.waterHeightMmInitial != null ? String(r.waterHeightMmInitial) : "",
        volumeTotalLtsInitial: r.volumeTotalLtsInitial != null ? String(r.volumeTotalLtsInitial) : "",
        volumeWaterLtsInitial: r.volumeWaterLtsInitial != null ? String(r.volumeWaterLtsInitial) : "",
        liquidHeightMmFinal: r.liquidHeightMmFinal != null ? String(r.liquidHeightMmFinal) : "",
        waterHeightMmFinal: r.waterHeightMmFinal != null ? String(r.waterHeightMmFinal) : "",
        volumeTotalLtsFinal: r.volumeTotalLtsFinal != null ? String(r.volumeTotalLtsFinal) : "",
        volumeWaterLtsFinal: r.volumeWaterLtsFinal != null ? String(r.volumeWaterLtsFinal) : "",
      })));
      // Horómetros: sembrar desde equipos trackeados, mezclando lo guardado.
      const savedEng = new Map((full.engineHours ?? []).map((e: any) => [e.engineLabel, e]));
      const assetsRes = await api.get<{ items: Array<{ id: string; name: string }> }>(`/app/pms/assets?vesselCode=${vesselCode}&trackDailyReport=true`);
      const assets = assetsRes.items ?? [];
      if (assets.length > 0) {
        setEngines(assets.map((a, i) => {
          const s: any = savedEng.get(a.name);
          return {
            assetId: a.id, engineLabel: a.name, engineOrder: i,
            hoursInitial: s?.hoursInitial != null ? String(s.hoursInitial) : "",
            hoursFinal: s?.hoursFinal != null ? String(s.hoursFinal) : "",
          };
        }));
      } else {
        setEngines((full.engineHours ?? []).map((e: any, i: number) => ({
          assetId: e.assetId ?? null, engineLabel: e.engineLabel, engineOrder: e.engineOrder ?? i,
          hoursInitial: e.hoursInitial != null ? String(e.hoursInitial) : "",
          hoursFinal: e.hoursFinal != null ? String(e.hoursFinal) : "",
        })));
      }
    } catch (e) { console.error("[voyage-tank full]", e); }
  };

  useEffect(() => {
    if (!isNew && live) void loadFull(live.id, live.vesselCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NATURALES + Consumo en vivo.
  const netIni = (r: TankRow) => n(r.volumeTotalLtsInitial) - n(r.volumeWaterLtsInitial);
  const netFin = (r: TankRow) => n(r.volumeTotalLtsFinal) - n(r.volumeWaterLtsFinal);
  const sumIni = tanks.reduce((acc, r) => acc + netIni(r), 0);
  const sumFin = tanks.reduce((acc, r) => acc + netFin(r), 0);
  const consumo = sumIni - sumFin;

  const updateTank = (i: number, key: keyof TankRow, value: string) =>
    setTanks(rows => rows.map((r, idx) => idx === i ? { ...r, [key]: value } : r));
  const updateEngine = (i: number, key: keyof EngineRow, value: string) =>
    setEngines(rows => rows.map((r, idx) => idx === i ? { ...r, [key]: value } : r));
  const addTank = () => setTanks(rows => [...rows, {
    tankLabel: "", tankOrder: rows.length,
    liquidHeightMmInitial: "", waterHeightMmInitial: "", volumeTotalLtsInitial: "", volumeWaterLtsInitial: "",
    liquidHeightMmFinal: "", waterHeightMmFinal: "", volumeTotalLtsFinal: "", volumeWaterLtsFinal: "",
  }]);
  const removeTank = (i: number) => setTanks(rows => rows.filter((_, idx) => idx !== i));

  const headerPayload = () => ({
    voyageCode: voyageCode.trim(),
    tramo: tramo.trim() || null,
    reportDateTime: reportDateTime || null,
    status,
    kmStart: kmStart !== "" ? Number(kmStart) : null,
    kmEnd: kmEnd !== "" ? Number(kmEnd) : null,
    dateStart: dateStart || null,
    dateEnd: dateEnd || null,
    daysNav: daysNav !== "" ? Number(daysNav) : null,
    bunkerReceivedLts: bunkerReceived !== "" ? Number(bunkerReceived) : null,
    bargeDeliveredLts: bargeDelivered !== "" ? Number(bargeDelivered) : null,
    signatory: signatory.trim() || null,
    notes: notes.trim() || null,
  });

  const numOrNull = (s: string) => (s !== "" ? Number(s) : null);

  const persistChildren = async (id: string) => {
    await api.put(`/app/voyage-tank-reports/${id}/tank-readings`, {
      entries: tanks.map((r, i) => ({
        tankLabel: r.tankLabel, tankOrder: i,
        liquidHeightMmInitial: numOrNull(r.liquidHeightMmInitial),
        waterHeightMmInitial: numOrNull(r.waterHeightMmInitial),
        volumeTotalLtsInitial: numOrNull(r.volumeTotalLtsInitial),
        volumeWaterLtsInitial: numOrNull(r.volumeWaterLtsInitial),
        liquidHeightMmFinal: numOrNull(r.liquidHeightMmFinal),
        waterHeightMmFinal: numOrNull(r.waterHeightMmFinal),
        volumeTotalLtsFinal: numOrNull(r.volumeTotalLtsFinal),
        volumeWaterLtsFinal: numOrNull(r.volumeWaterLtsFinal),
      })),
    });
    await api.put(`/app/voyage-tank-reports/${id}/engine-hours`, {
      entries: engines.map((r, i) => ({
        assetId: r.assetId ?? null, engineLabel: r.engineLabel, engineOrder: i,
        hoursInitial: numOrNull(r.hoursInitial), hoursFinal: numOrNull(r.hoursFinal),
      })),
    });
  };

  const save = async () => {
    setSaving(true); setSaveError(null); setSavedMsg(null);
    try {
      if (isNew) {
        if (!newVesselCode) { setSaveError("Seleccionar embarcación."); setSaving(false); return; }
        if (!voyageCode.trim()) { setSaveError("Ingresar el código de viaje."); setSaving(false); return; }
        const created = await api.post<VoyageTankReport>("/app/voyage-tank-reports", {
          vesselCode: newVesselCode.trim().toUpperCase(),
          ...headerPayload(),
        });
        setLive(created);
        await loadFull(created.id, created.vesselCode);
        setSavedMsg("Medición creada.");
      } else {
        // Persistir hijos ANTES del PATCH de estado: al pasar a SUBMITTED el
        // backend integra los horómetros al mantenimiento, y debe ver los
        // valores recién cargados (no los anteriores).
        await persistChildren(live!.id);
        const res = await api.patch<VoyageTankReport & { _integration?: { updatedRunningHoursCount: number; recalculatedPlansCount: number } }>(`/app/voyage-tank-reports/${live!.id}`, headerPayload());
        setLive(res);
        const integ = res._integration;
        if (status === "SUBMITTED" && integ) {
          const parts = [];
          if (integ.updatedRunningHoursCount > 0) parts.push(`${integ.updatedRunningHoursCount} plan(es) de horas actualizados`);
          if (integ.recalculatedPlansCount > 0) parts.push(`${integ.recalculatedPlansCount} recalculados`);
          setSavedMsg(parts.length ? `Enviado · ${parts.join(" · ")}` : "Enviado.");
        } else {
          setSavedMsg("Guardado.");
        }
      }
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const generatePdf = async () => {
    if (!live) return;
    setGeneratingPdf(true); setSaveError(null);
    try {
      const token = localStorage.getItem("gpms_token");
      const slug = localStorage.getItem("gpms_tenant_slug");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (slug) headers["X-Tenant-Slug"] = slug;
      const res = await fetch(`/app/voyage-tank-reports/${live.id}/pdf`, { headers });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setSaveError(`Error ${res.status}: ${text.slice(0, 300) || "No se pudo generar el PDF."}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `medicion-tanques-${live.vesselCode}-${live.voyageCode}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Error al generar PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full h-full bg-surface dark:bg-[#0D1B2A] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <div>
            {isNew ? (
              <h2 className="text-base font-bold text-fg">Nueva medición de tanques</h2>
            ) : (
              <>
                <h2 className="text-base font-bold text-fg">{live!.vesselCode} · Viaje {live!.voyageCode}</h2>
                <p className="text-[10px] text-text-industrial/40">{live!.reportCode ?? ""} · {live!.status}</p>
              </>
            )}
          </div>
          <ModalCloseButton onClose={() => { if (report === null && live !== null) onSaved(); else onClose(); }} />
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* ── Encabezado ── */}
          <section className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {isNew && (
                <div className="space-y-1.5">
                  <label className={labelCls}>Embarcación *</label>
                  <select value={newVesselCode} onChange={e => setNewVesselCode(e.target.value)} className={inputCls}>
                    <option value="">— Seleccionar —</option>
                    {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <label className={labelCls}>Viaje *</label>
                <input value={voyageCode} onChange={e => setVoyageCode(e.target.value)} disabled={isClosed} placeholder="M01" className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>Fecha / hora</label>
                <input type="datetime-local" value={reportDateTime} onChange={e => setReportDateTime(e.target.value)} disabled={isClosed} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>Estado</label>
                <select value={status} onChange={e => setStatus(e.target.value)} disabled={isClosed} className={inputCls}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="space-y-1.5 col-span-2 md:col-span-3">
                <label className={labelCls}>Tramo</label>
                <input value={tramo} onChange={e => setTramo(e.target.value)} disabled={isClosed} placeholder="KM 773 LA PAZ ARG. AL KM 1578 GUYRATI" className={inputCls} />
              </div>
            </div>
          </section>

          {isNew ? (
            <p className="text-xs text-text-industrial/40 text-center py-4">Guardá el encabezado para cargar las mediciones de tanques y horómetros.</p>
          ) : (
            <>
              {/* ── Medición de Carboneras ── */}
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <Fuel className="w-4 h-4 text-accent" />
                  <h3 className="text-xs font-bold text-fg uppercase tracking-wider">Medición de Carboneras</h3>
                </div>
                <div className="overflow-x-auto border border-fg/10 rounded-xl">
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-fg/5">
                        <th rowSpan={2} className="text-left px-2 py-1.5 font-semibold text-text-industrial/60">Tanque</th>
                        <th colSpan={3} className="text-center px-2 py-1 font-semibold text-blue-700 dark:text-blue-300 border-l border-fg/10">INICIAL</th>
                        <th colSpan={3} className="text-center px-2 py-1 font-semibold text-red-700 dark:text-red-300 border-l border-fg/10">FINAL</th>
                        {!isClosed && <th rowSpan={2} className="w-8"></th>}
                      </tr>
                      <tr className="bg-fg/5 text-[9px] text-text-industrial/50">
                        <th className="px-1 py-1 font-medium border-l border-fg/10">Total (L)</th>
                        <th className="px-1 py-1 font-medium">Agua (L)</th>
                        <th className="px-1 py-1 font-medium">Neto (L)</th>
                        <th className="px-1 py-1 font-medium border-l border-fg/10">Total (L)</th>
                        <th className="px-1 py-1 font-medium">Agua (L)</th>
                        <th className="px-1 py-1 font-medium">Neto (L)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tanks.map((r, i) => (
                        <tr key={i} className="border-t border-fg/8">
                          <td className="px-2 py-1">
                            <input value={r.tankLabel} onChange={e => updateTank(i, "tankLabel", e.target.value)} disabled={isClosed} placeholder="Tanque" className="w-full bg-transparent text-[11px] text-fg focus:outline-none" />
                          </td>
                          <td className="px-1 py-1 border-l border-fg/10"><input type="number" value={r.volumeTotalLtsInitial} onChange={e => updateTank(i, "volumeTotalLtsInitial", e.target.value)} disabled={isClosed} placeholder="0" className={inputSm} /></td>
                          <td className="px-1 py-1"><input type="number" value={r.volumeWaterLtsInitial} onChange={e => updateTank(i, "volumeWaterLtsInitial", e.target.value)} disabled={isClosed} placeholder="0" className={inputSm} /></td>
                          <td className="px-1 py-1 text-right font-mono text-text-industrial/70">{fmtLts(netIni(r))}</td>
                          <td className="px-1 py-1 border-l border-fg/10"><input type="number" value={r.volumeTotalLtsFinal} onChange={e => updateTank(i, "volumeTotalLtsFinal", e.target.value)} disabled={isClosed} placeholder="0" className={inputSm} /></td>
                          <td className="px-1 py-1"><input type="number" value={r.volumeWaterLtsFinal} onChange={e => updateTank(i, "volumeWaterLtsFinal", e.target.value)} disabled={isClosed} placeholder="0" className={inputSm} /></td>
                          <td className="px-1 py-1 text-right font-mono text-text-industrial/70">{fmtLts(netFin(r))}</td>
                          {!isClosed && (
                            <td className="px-1 py-1 text-center">
                              <button onClick={() => removeTank(i)} className="text-text-industrial/30 hover:text-red-500" title="Quitar tanque"><Trash2 className="w-3.5 h-3.5" /></button>
                            </td>
                          )}
                        </tr>
                      ))}
                      <tr className="border-t-2 border-fg/20 bg-fg/5 font-bold">
                        <td className="px-2 py-1.5 text-fg">NATURALES</td>
                        <td colSpan={2}></td>
                        <td className="px-1 py-1.5 text-right font-mono text-fg">{fmtLts(sumIni)}</td>
                        <td colSpan={2}></td>
                        <td className="px-1 py-1.5 text-right font-mono text-fg">{fmtLts(sumFin)}</td>
                        {!isClosed && <td></td>}
                      </tr>
                    </tbody>
                  </table>
                </div>
                {!isClosed && (
                  <button onClick={addTank} className="flex items-center gap-1 text-[11px] text-accent hover:text-accent/80 font-semibold">
                    <Plus className="w-3 h-3" /> Agregar tanque
                  </button>
                )}
                {/* Consumo destacado */}
                <div className="flex items-center justify-between bg-accent/10 border border-accent/25 rounded-xl px-4 py-3">
                  <span className="text-[11px] font-semibold text-text-industrial/70 uppercase tracking-wider">Consumo del viaje (Naturales inicial − final)</span>
                  <span className="text-lg font-bold text-fg font-mono">{fmtLts(consumo)} Lts</span>
                </div>
              </section>

              {/* ── Horómetros ── */}
              <section className="space-y-2">
                <h3 className="text-xs font-bold text-fg uppercase tracking-wider">Horómetros</h3>
                {engines.length === 0 ? (
                  <p className="text-[11px] text-text-industrial/40 py-2">No hay equipos marcados para reporte diario en este buque.</p>
                ) : (
                  <div className="overflow-x-auto border border-fg/10 rounded-xl">
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-fg/5 text-text-industrial/60">
                          <th className="text-left px-2 py-1.5 font-semibold">Motor</th>
                          <th className="px-2 py-1.5 font-semibold text-right">Inicial (hs)</th>
                          <th className="px-2 py-1.5 font-semibold text-right">Final (hs)</th>
                          <th className="px-2 py-1.5 font-semibold text-right">Diferencia (hs)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {engines.map((e, i) => {
                          const diff = e.hoursInitial !== "" && e.hoursFinal !== "" ? n(e.hoursFinal) - n(e.hoursInitial) : null;
                          return (
                            <tr key={i} className="border-t border-fg/8">
                              <td className="px-2 py-1 text-fg">{e.engineLabel}</td>
                              <td className="px-1 py-1"><input type="number" value={e.hoursInitial} onChange={ev => updateEngine(i, "hoursInitial", ev.target.value)} disabled={isClosed} placeholder="0" className={inputSm} /></td>
                              <td className="px-1 py-1"><input type="number" value={e.hoursFinal} onChange={ev => updateEngine(i, "hoursFinal", ev.target.value)} disabled={isClosed} placeholder="0" className={inputSm} /></td>
                              <td className="px-2 py-1 text-right font-mono text-text-industrial/70">{diff != null ? diff.toLocaleString("es-AR") : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* ── Viaje / Bunker ── */}
              <section className="space-y-3">
                <h3 className="text-xs font-bold text-fg uppercase tracking-wider">Viaje y bunker</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="space-y-1.5"><label className={labelCls}>Km inicio</label><input type="number" value={kmStart} onChange={e => setKmStart(e.target.value)} disabled={isClosed} placeholder="773" className={inputCls} /></div>
                  <div className="space-y-1.5"><label className={labelCls}>Km fin</label><input type="number" value={kmEnd} onChange={e => setKmEnd(e.target.value)} disabled={isClosed} placeholder="1578" className={inputCls} /></div>
                  <div className="space-y-1.5"><label className={labelCls}>Días de navegación</label><input type="number" value={daysNav} onChange={e => setDaysNav(e.target.value)} disabled={isClosed} placeholder="auto" className={inputCls} /></div>
                  <div className="space-y-1.5"><label className={labelCls}>Fecha inicio</label><input type="datetime-local" value={dateStart} onChange={e => setDateStart(e.target.value)} disabled={isClosed} className={inputCls} /></div>
                  <div className="space-y-1.5"><label className={labelCls}>Fecha fin</label><input type="datetime-local" value={dateEnd} onChange={e => setDateEnd(e.target.value)} disabled={isClosed} className={inputCls} /></div>
                  <div className="space-y-1.5"><label className={labelCls}>Jefe de Máquinas</label><input value={signatory} onChange={e => setSignatory(e.target.value)} disabled={isClosed} className={inputCls} /></div>
                  <div className="space-y-1.5"><label className={labelCls}>Recepción bunker (L)</label><input type="number" value={bunkerReceived} onChange={e => setBunkerReceived(e.target.value)} disabled={isClosed} placeholder="0" className={inputCls} /></div>
                  <div className="space-y-1.5"><label className={labelCls}>Entrega a barcazas (L)</label><input type="number" value={bargeDelivered} onChange={e => setBargeDelivered(e.target.value)} disabled={isClosed} placeholder="0" className={inputCls} /></div>
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>Observaciones</label>
                  <AutoTextArea value={notes} onChange={e => setNotes(e.target.value)} disabled={isClosed} rows={2} className={inputCls} />
                </div>
              </section>
            </>
          )}

          {saveError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{saveError}</p>}
          {savedMsg && <p className="text-xs text-green-700 dark:text-green-400 bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 shrink-0" />{savedMsg}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-fg/10 shrink-0">
          {live && (
            <button onClick={() => { void generatePdf(); }} disabled={generatingPdf || saving} className="px-4 py-2 rounded-lg bg-fg/10 border border-fg/15 text-fg font-bold text-xs hover:bg-fg/15 disabled:opacity-50 flex items-center gap-1.5">
              {generatingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              Guardar PDF
            </button>
          )}
          {!isClosed && (
            <button onClick={() => { void save(); }} disabled={saving} className="px-4 py-2 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("common.save")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Página (lista) ────────────────────────────────────────────────────────

export const VoyageTankReportsPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const vesselFilter = searchParams.get("vesselCode") ?? "";

  const params = new URLSearchParams();
  if (vesselFilter) params.set("vesselCode", vesselFilter);
  const path = `/app/voyage-tank-reports${params.size ? `?${params}` : ""}`;

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [vesselFilter]);
  const [detail, setDetail] = useState<VoyageTankReport | null | "new">(null);

  useCopilotEmitter(!detail ? { module: "VOYAGE_TANK_REPORTS", screen: "VOYAGE_TANK_REPORT_LIST" } : {
    module: "VOYAGE_TANK_REPORTS",
    screen: detail === "new" ? "VOYAGE_TANK_REPORT_CREATE" : "VOYAGE_TANK_REPORT_EDIT",
    entityId: detail !== "new" ? detail.id : undefined,
    entityCode: detail !== "new" ? detail.voyageCode : undefined,
    vesselCode: detail !== "new" ? detail.vesselCode : undefined,
    workflowStage: detail !== "new" ? detail.status : undefined,
  });

  const canManage = user?.role === "TENANT_ADMIN"
    || user?.role === "MAINTENANCE_MANAGER"
    || user?.role === "FLEET_SUPERINTENDENT"
    || user?.role === "TECHNICIAN_OPERATOR";

  const COLUMNS: Column<VoyageTankReport>[] = [
    { key: "voyageCode", header: "Viaje", render: r => <span className="font-mono font-bold text-fg text-xs">{r.voyageCode}</span> },
    { key: "vesselCode", header: t("col.vessel"), render: r => <VesselLabel code={r.vesselCode} className="text-xs" showCode /> },
    { key: "tramo", header: "Tramo", render: r => <span className="text-xs text-text-industrial/60 line-clamp-1">{r.tramo ?? "—"}</span> },
    { key: "reportDateTime", header: t("common.date"), render: r => <span className="text-xs text-text-industrial/60">{r.reportDateTime ? fmtDate(r.reportDateTime) : "—"}</span> },
    { key: "status", header: t("col.status"), render: r => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader icon={Fuel} title={t("page.voyageTankReports")} total={data?.total} onReload={reload}>
        {canManage && (
          <button onClick={() => setDetail("new")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-xs font-bold hover:brightness-110 transition-all">
            <Plus className="w-3.5 h-3.5" />
            Nueva medición
          </button>
        )}
      </PageHeader>

      <DataTable
        columns={COLUMNS}
        data={data?.items ?? null}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText={t("empty.voyageTankReports")}
        onRowClick={r => setDetail(r)}
      />

      {detail !== null && (
        <VoyageTankReportDrawer
          report={detail === "new" ? null : detail}
          onClose={() => setDetail(null)}
          onSaved={() => { setDetail(null); reload(); }}
        />
      )}
    </div>
  );
};
