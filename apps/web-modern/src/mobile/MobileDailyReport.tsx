import React, { useState, useCallback, useMemo } from "react";
import { ChevronLeft, CheckCircle, Loader2 } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useVesselContext } from "../lib/vessel-context";
import { useEscapeGuard } from "../lib/escape-guard";
import { AutoTextArea } from "../components/AutoTextArea";

interface DailyReport {
  id: string;
  vesselCode: string;
  reportDate: string;
  status: string;
  fuelConsumedLiters?: number | null;
  oilConsumedLiters?: number | null;
  notes?: string | null;
  operationalStatus?: string | null;
  positionLat?: number | null;
  positionLon?: number | null;
  currentPort?: string | null;
  nextPort?: string | null;
  etaNextPort?: string | null;
  maintenanceOpportunity?: string | null;
  sparesReceiptPossible?: string | null;
  operationalRemarks?: string | null;
  summary?: string | null;
}

interface Asset {
  id: string;
  name: string;
  assetCode?: string | null;
}

interface EquipmentHourEntry {
  assetId?: string | null;
  equipmentLabel: string;
  runningHoursTotal: number | null;
  fuelConsumptionLiters?: number | null;
  oilConsumptionLiters?: number | null;
  inService?: boolean;
  standby?: boolean;
}

interface FullReport {
  report: DailyReport;
  equipmentHours: EquipmentHourEntry[];
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT:     "Borrador",
  SUBMITTED: "Enviado",
  VERIFIED:  "Verificado",
};

const OP_STATUS_LABEL: Record<string, string> = {
  UNDERWAY:  "En navegación",
  AT_PORT:   "En puerto",
  ANCHORED:  "Fondeado",
  DRIFTING:  "A la deriva",
  REPAIR:    "En reparación",
};

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "text-xs font-bold uppercase tracking-wider text-text-industrial/40";

type View = "list" | "create" | "detail";

// ── Emparejado Babor/Estribor (o #1/#2) para "Horas por equipo" ──────────────
// Agrupa equipos hermanos por su nombre base y los ordena Babor/#1 (izquierda)
// → Estribor/#2 (derecha) para renderizar 2 por fila. Los equipos sin hermano
// quedan a ancho completo.
const SIDE_BABOR = /\bbabor\b/i;
const SIDE_ESTRIBOR = /\bestribor\b/i;
const TRAIL_NUM = /(?:#|nro\.?|n[º°])?\s*(\d+)\s*$/i;

/** Nombre base sin el sufijo de lado/número, para agrupar hermanos. */
function equipmentBaseKey(name: string): string {
  return name
    .replace(/\s*(?:de\s+)?(?:babor|estribor)\s*$/i, "")
    .replace(/\s*(?:#|nro\.?|n[º°])?\s*\d+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Orden dentro del grupo: Babor/#1 primero (izq), Estribor/#2 después (der). */
function equipmentSideRank(name: string, idx: number): number {
  if (SIDE_BABOR.test(name)) return 0;
  if (SIDE_ESTRIBOR.test(name)) return 1;
  const m = name.match(TRAIL_NUM);
  if (m) return parseInt(m[1], 10);
  return 1000 + idx; // sin lado reconocible → conserva el orden original
}

/** Convierte la lista de equipos en filas [izquierda, derecha|null]. */
function pairTrackedAssets(assets: Asset[]): Array<[Asset, Asset | null]> {
  const groups = new Map<string, Asset[]>();
  const order: string[] = [];
  assets.forEach(a => {
    const key = equipmentBaseKey(a.name) || a.name.toLowerCase();
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(a);
  });
  const rows: Array<[Asset, Asset | null]> = [];
  order.forEach(key => {
    const items = groups.get(key)!;
    if (items.length === 1) { rows.push([items[0], null]); return; }
    const sorted = items
      .map((a, i) => ({ a, r: equipmentSideRank(a.name, i) }))
      .sort((x, y) => x.r - y.r)
      .map(o => o.a);
    for (let i = 0; i < sorted.length; i += 2) {
      rows.push([sorted[i], sorted[i + 1] ?? null]);
    }
  });
  return rows;
}

/** Caja de un equipo: nombre + input de horas. Reutilizable izq/der/full. */
const AssetHoursBox: React.FC<{ asset: Asset; value: string; onChange: (v: string) => void }> = ({ asset, value, onChange }) => (
  <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 space-y-1.5">
    <p className="text-[11px] font-semibold text-fg leading-tight">{asset.name}</p>
    <input
      type="number"
      inputMode="decimal"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Horas (h)"
      className="w-full bg-fg/5 border border-fg/10 rounded-lg px-2.5 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
    />
  </div>
);

export const MobileDailyReport: React.FC = () => {
  const { data, loading, reload } = useFetch<{ items: DailyReport[] }>("/app/daily-reports");
  const { selectedVesselCode }    = useVesselContext();

  const todayStr   = new Date().toISOString().slice(0, 10);
  const reports    = data?.items ?? [];
  const todayRpt   = useMemo(() => reports.find(r => r.reportDate.slice(0, 10) === todayStr), [reports, todayStr]);
  const recent     = useMemo(() => reports.slice(0, 15), [reports]);

  const [view, setView]     = useState<View>("list");
  const [selected, setSel]  = useState<DailyReport | null>(null);
  // editingId: si está set, el form está editando un reporte existente (PATCH);
  //            si es null, está creando uno nuevo (POST).
  const [editingId, setEditingId] = useState<string | null>(null);
  // editingStatus: status del reporte que se está editando. Si es SUBMITTED,
  // se oculta "Guardar borrador" — la única acción coherente es re-Enviar
  // (re-integra horas en planes de mantenimiento).
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const [fuel, setFuel]     = useState("");
  const [oil, setOil]       = useState("");
  const [opStatus, setOp]   = useState("UNDERWAY");
  const [notes, setNotes]   = useState("");
  // Posición geográfica + contexto portuario
  const [posLat, setPosLat]               = useState("");
  const [posLon, setPosLon]               = useState("");
  const [currentPort, setCurrentPort]     = useState("");
  const [nextPort, setNextPort]           = useState("");
  const [etaNextPort, setEtaNextPort]     = useState("");
  const [maintOpp, setMaintOpp]           = useState("UNKNOWN");
  const [sparesRecv, setSparesRecv]       = useState("UNKNOWN");
  const [opRemarks, setOpRemarks]         = useState("");
  const [summary, setSummary]             = useState("");
  // Mapa assetId → horas totales del motor para ese activo
  const [hoursByAsset, setHoursByAsset] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);
  // Geolocation: pedimos al usuario una vez al abrir el form. Si denegado o
  // sin GPS, dejamos los campos vacíos para que pueda escribir lat/lon a mano.
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "ok" | "denied" | "unavailable">("idle");

  // Activos con trackDailyReport=true para el buque seleccionado
  const { data: assetsData } = useFetch<{ items: Asset[] }>(
    selectedVesselCode ? `/app/pms/assets?vesselCode=${selectedVesselCode}&trackDailyReport=true` : null,
    [selectedVesselCode],
  );
  const trackedAssets = assetsData?.items ?? [];
  // Filas de "Horas por equipo": hermanos Babor/Estribor (o #1/#2) en la misma fila.
  const equipmentRows = useMemo(() => pairTrackedAssets(trackedAssets), [trackedAssets]);

  const openCreate = () => {
    setEditingId(null);
    setEditingStatus(null);
    setFuel(""); setOil(""); setNotes(""); setOp("UNDERWAY");
    setHoursByAsset({});
    setErr(null);

    // Prefill desde el último reporte del mismo buque: el contexto operativo
    // (puertos, ETA, maintOpp, sparesRecv) raramente cambia de un día al otro;
    // pre-llenarlo le ahorra al operador re-escribir lo mismo. Si cambió, lo edita.
    const lastForVessel = selectedVesselCode
      ? (data?.items ?? []).find(r => r.vesselCode === selectedVesselCode)
      : undefined;
    setCurrentPort(lastForVessel?.nextPort ?? lastForVessel?.currentPort ?? "");
    setNextPort(lastForVessel?.nextPort ?? "");
    setEtaNextPort(lastForVessel?.etaNextPort ? lastForVessel.etaNextPort.slice(0, 10) : "");
    setMaintOpp(lastForVessel?.maintenanceOpportunity ?? "UNKNOWN");
    setSparesRecv(lastForVessel?.sparesReceiptPossible ?? "UNKNOWN");
    setOpRemarks("");
    setSummary("");

    // Geolocation — pedimos posición actual. Si denegado/no disponible,
    // el operador puede tipear lat/lon a mano.
    setPosLat(""); setPosLon("");
    if (typeof navigator !== "undefined" && "geolocation" in navigator) {
      setGeoStatus("loading");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setPosLat(pos.coords.latitude.toFixed(6));
          setPosLon(pos.coords.longitude.toFixed(6));
          setGeoStatus("ok");
        },
        (err) => {
          setGeoStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
      );
    } else {
      setGeoStatus("unavailable");
    }

    setView("create");
  };

  // Abre el form en modo edición: trae el /full del reporte y pre-carga todo.
  const openEdit = useCallback(async (r: DailyReport) => {
    setEditingId(r.id);
    setEditingStatus(r.status);
    setFuel(r.fuelConsumedLiters != null ? String(r.fuelConsumedLiters) : "");
    setOil(r.oilConsumedLiters != null ? String(r.oilConsumedLiters) : "");
    setOp(r.operationalStatus ?? "UNDERWAY");
    setNotes(r.notes ?? "");
    setPosLat(r.positionLat != null ? String(r.positionLat) : "");
    setPosLon(r.positionLon != null ? String(r.positionLon) : "");
    setCurrentPort(r.currentPort ?? "");
    setNextPort(r.nextPort ?? "");
    setEtaNextPort(r.etaNextPort ? r.etaNextPort.slice(0, 10) : "");
    setMaintOpp(r.maintenanceOpportunity ?? "UNKNOWN");
    setSparesRecv(r.sparesReceiptPossible ?? "UNKNOWN");
    setOpRemarks(r.operationalRemarks ?? "");
    setSummary(r.summary ?? "");
    setGeoStatus(r.positionLat != null ? "ok" : "idle");
    setHoursByAsset({});
    setErr(null);
    setView("create");
    try {
      const full = await api.get<FullReport>(`/app/daily-reports/${r.id}/full`);
      const map: Record<string, string> = {};
      for (const e of (full.equipmentHours ?? [])) {
        if (e.assetId && e.runningHoursTotal != null) {
          map[e.assetId] = String(e.runningHoursTotal);
        }
      }
      setHoursByAsset(map);
    } catch { /* non-blocking — el form queda con assets vacíos */ }
  }, []);

  const updateAssetHours = (assetId: string, val: string) => {
    setHoursByAsset(prev => ({ ...prev, [assetId]: val }));
  };

  // Guarda el reporte (POST si nuevo, PATCH si edición) + horas por equipo.
  // Si submit=true → transiciona a SUBMITTED y llama confirm-and-integrate
  // para propagar horas a los planes de mantenimiento (igual que desktop).
  const saveReport = useCallback(async (submit: boolean) => {
    if (!selectedVesselCode) { setErr("Seleccioná un buque primero."); return; }
    setSaving(true); setErr(null);
    try {
      const payload = {
        operationalStatus:  opStatus,
        fuelConsumedLiters: fuel ? parseFloat(fuel) : null,
        oilConsumedLiters:  oil  ? parseFloat(oil)  : null,
        notes: notes.trim() || null,
        positionLat: posLat ? parseFloat(posLat) : null,
        positionLon: posLon ? parseFloat(posLon) : null,
        currentPort: currentPort.trim() || null,
        nextPort:    nextPort.trim() || null,
        etaNextPort: etaNextPort || null,
        maintenanceOpportunity: maintOpp,
        sparesReceiptPossible:  sparesRecv,
        operationalRemarks: opRemarks.trim() || null,
        summary: summary.trim() || null,
      };

      // 1) Crear o actualizar el reporte base
      let reportId: string;
      if (editingId) {
        await api.patch(`/app/daily-reports/${editingId}`, payload);
        reportId = editingId;
      } else {
        const created = await api.post<{ id: string }>("/app/daily-reports", {
          ...payload,
          vesselCode: selectedVesselCode,
          reportDate: todayStr,
        });
        reportId = created.id;
      }

      // 2) Guardar las horas por activo (uno por cada activo con trackDailyReport=true)
      if (reportId && trackedAssets.length > 0) {
        const entries = trackedAssets.map(a => ({
          assetId: a.id,
          equipmentLabel: a.name,
          runningHoursTotal: hoursByAsset[a.id] ? parseFloat(hoursByAsset[a.id]) : null,
          inService: true,
          standby: false,
        }));
        try {
          await api.put(`/app/daily-reports/${reportId}/equipment-hours`, { entries });
        } catch { /* no bloquea — el reporte base ya quedó guardado */ }
      }

      // 3) Si submit=true: transicionar a SUBMITTED + integrar (propaga horas a planes)
      if (submit && reportId) {
        await api.patch(`/app/daily-reports/${reportId}`, { status: "SUBMITTED" });
        try {
          await api.post(`/app/daily-reports/${reportId}/confirm-and-integrate`);
        } catch { /* no bloquea el cambio de status — la integración puede reintentarse */ }
      }

      await reload();
      setView("list");
      setEditingId(null);
      setEditingStatus(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al guardar reporte");
    } finally {
      setSaving(false);
    }
  }, [editingId, selectedVesselCode, todayStr, opStatus, fuel, oil, notes, posLat, posLon, currentPort, nextPort, etaNextPort, maintOpp, sparesRecv, opRemarks, summary, hoursByAsset, trackedAssets, reload]);

  // Aliases para los handlers de escape-guard y para los onClick de botones
  const handleSaveDraft = useCallback(() => saveReport(false), [saveReport]);
  const handleSubmit    = useCallback(() => saveReport(true),  [saveReport]);

  // ─── ESC guard ──────────────────────────────────────────────────────────────
  const anyHoursTyped = Object.values(hoursByAsset).some(v => v.trim() !== "");
  const createDirty =
    view === "create" &&
    (fuel !== "" || oil !== "" || notes.trim() !== "" || opStatus !== "UNDERWAY" || anyHoursTyped);

  useEscapeGuard({
    enabled: view === "create",
    isDirty: createDirty,
    onSave: handleSaveDraft,
    onClose: () => setView("list"),
  });

  useEscapeGuard({
    enabled: view === "detail",
    isDirty: false,
    onClose: () => { setView("list"); setSel(null); },
  });

  // ── Create ───────────────────────────────────────────────────────────────────
  if (view === "create") {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-fg/10">
          <button type="button" onClick={() => { setView("list"); setEditingId(null); setEditingStatus(null); }} className="p-2 -ml-2 text-text-industrial/40 hover:text-fg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-fg">
            {editingId ? "Editar reporte" : "Reporte diario"} — {todayStr}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-1.5">
            <p className={labelCls}>Estado operacional</p>
            <select value={opStatus} onChange={e => setOp(e.target.value)} className={inputCls + " appearance-none"}>
              {Object.entries(OP_STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className={labelCls}>Combustible (L)</p>
              <input type="number" inputMode="decimal" value={fuel} onChange={e => setFuel(e.target.value)} className={inputCls} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <p className={labelCls}>Aceite (L)</p>
              <input type="number" inputMode="decimal" value={oil} onChange={e => setOil(e.target.value)} className={inputCls} placeholder="0" />
            </div>
          </div>

          {/* Horas por equipo: una fila por cada asset con trackDailyReport=true */}
          <div className="space-y-2">
            <p className={labelCls}>Horas por equipo</p>
            {trackedAssets.length === 0 ? (
              <p className="text-[11px] text-text-industrial/40 italic">
                Este buque no tiene equipos registrados para reporte diario.
              </p>
            ) : (
              <div className="space-y-2">
                {equipmentRows.map(([left, right], i) => (
                  right ? (
                    <div key={i} className="grid grid-cols-2 gap-2 items-start">
                      <AssetHoursBox asset={left} value={hoursByAsset[left.id] ?? ""} onChange={v => updateAssetHours(left.id, v)} />
                      <AssetHoursBox asset={right} value={hoursByAsset[right.id] ?? ""} onChange={v => updateAssetHours(right.id, v)} />
                    </div>
                  ) : (
                    <AssetHoursBox key={i} asset={left} value={hoursByAsset[left.id] ?? ""} onChange={v => updateAssetHours(left.id, v)} />
                  )
                ))}
              </div>
            )}
          </div>

          {/* Posición geográfica */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className={labelCls}>Posición geográfica</p>
              <span className="text-[10px] text-text-industrial/40">
                {geoStatus === "loading" && "📡 obteniendo…"}
                {geoStatus === "ok"       && "✓ GPS"}
                {geoStatus === "denied"   && "GPS denegado"}
                {geoStatus === "unavailable" && "sin GPS"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                inputMode="decimal"
                step="0.000001"
                value={posLat}
                onChange={e => setPosLat(e.target.value)}
                placeholder="Latitud"
                className={inputCls}
              />
              <input
                type="number"
                inputMode="decimal"
                step="0.000001"
                value={posLon}
                onChange={e => setPosLon(e.target.value)}
                placeholder="Longitud"
                className={inputCls}
              />
            </div>
          </div>

          {/* Puerto actual + próximo + ETA */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className={labelCls}>Puerto actual</p>
              <input
                type="text"
                value={currentPort}
                onChange={e => setCurrentPort(e.target.value)}
                placeholder="ej. Buenos Aires"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <p className={labelCls}>Próximo puerto</p>
              <input
                type="text"
                value={nextPort}
                onChange={e => setNextPort(e.target.value)}
                placeholder="ej. Rosario"
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <p className={labelCls}>ETA próximo puerto</p>
            <input
              type="date"
              value={etaNextPort}
              onChange={e => setEtaNextPort(e.target.value)}
              className={inputCls}
            />
          </div>

          {/* Oportunidad de mantenimiento + recepción repuestos */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className={labelCls}>Op. mantenimiento</p>
              <select value={maintOpp} onChange={e => setMaintOpp(e.target.value)} className={inputCls + " appearance-none"}>
                <option value="UNKNOWN">Desconocida</option>
                <option value="YES">Sí</option>
                <option value="LIMITED">Limitada</option>
                <option value="NO">No</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <p className={labelCls}>Recepción repuestos</p>
              <select value={sparesRecv} onChange={e => setSparesRecv(e.target.value)} className={inputCls + " appearance-none"}>
                <option value="UNKNOWN">Desconocida</option>
                <option value="YES">Sí</option>
                <option value="LIMITED">Limitada</option>
                <option value="NO">No</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className={labelCls}>Comentarios operativos</p>
            <AutoTextArea
              value={opRemarks}
              onChange={e => setOpRemarks(e.target.value)}
              rows={2}
              placeholder="Comentarios sobre la operación del día…"
              className={inputCls + " resize-none"}
            />
          </div>

          <div className="space-y-1.5">
            <p className={labelCls}>Resumen</p>
            <AutoTextArea
              value={summary}
              onChange={e => setSummary(e.target.value)}
              rows={2}
              placeholder="Resumen de la jornada…"
              className={inputCls + " resize-none"}
            />
          </div>

          <div className="space-y-1.5">
            <p className={labelCls}>Notas</p>
            <AutoTextArea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Novedades del día..."
              className={inputCls + " resize-none"}
            />
          </div>
          {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}

          {/* Dos acciones para DRAFT (Guardar borrador / Enviar).
              Para SUBMITTED solo "Re-Enviar" — re-integra las horas a los planes. */}
          {editingStatus === "SUBMITTED" ? (
            <>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className="w-full py-3 rounded-xl bg-accent text-accent-fg text-sm font-bold disabled:opacity-40"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Guardar y re-enviar"}
              </button>
              <p className="text-[10px] text-text-industrial/40 leading-snug">
                El reporte ya está enviado. Al guardar se propagan las nuevas horas a los planes de mantenimiento.
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saving}
                  className="py-3 rounded-xl bg-fg/5 border border-fg/15 text-text-industrial text-sm font-bold disabled:opacity-40 hover:bg-fg/10"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Guardar borrador"}
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saving}
                  className="py-3 rounded-xl bg-accent text-accent-fg text-sm font-bold disabled:opacity-40"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Enviar"}
                </button>
              </div>
              <p className="text-[10px] text-text-industrial/40 leading-snug">
                <span className="font-bold">Enviar</span> propaga las horas a los planes de mantenimiento y deja el reporte como definitivo. <span className="font-bold">Guardar borrador</span> permite seguir editando.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Detail ───────────────────────────────────────────────────────────────────
  if (view === "detail" && selected) {
    return <ReportDetail report={selected} onBack={() => { setView("list"); setSel(null); }} />;
  }

  // ── List ─────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Today's report banner */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        {todayRpt ? (
          <div className="rounded-xl border border-success-sea/30 bg-success-sea/5 p-3 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-success-sea shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-success-sea">Reporte de hoy registrado</p>
              <p className="text-[11px] text-text-industrial/40">{STATUS_LABEL[todayRpt.status] ?? todayRpt.status}</p>
            </div>
            {/* DRAFT y SUBMITTED se pueden editar. REVIEWED/CLOSED solo se ven. */}
            {(todayRpt.status === "DRAFT" || todayRpt.status === "SUBMITTED") ? (
              <button
                type="button"
                onClick={() => { void openEdit(todayRpt); }}
                className="text-xs text-accent font-bold shrink-0 px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/30"
              >
                Editar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setSel(todayRpt); setView("detail"); }}
                className="text-xs text-accent font-bold shrink-0"
              >
                Ver
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={openCreate}
            className="w-full py-3 rounded-xl bg-accent text-accent-fg text-sm font-bold"
          >
            + Registrar reporte de hoy
          </button>
        )}
      </div>

      <div className="shrink-0 px-4 py-2 border-b border-fg/10">
        <p className="text-[10px] font-bold uppercase tracking-wider text-text-industrial/30">Reportes recientes</p>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-fg/5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : recent.length === 0 ? (
          <div className="text-center py-10 text-text-industrial/30 text-sm">Sin reportes</div>
        ) : (
          recent.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => { setSel(r); setView("detail"); }}
              className="w-full text-left px-4 py-3 hover:bg-fg/5 active:bg-fg/10 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-fg">{r.reportDate.slice(0, 10)}</p>
                  <p className="text-xs text-text-industrial/40 mt-0.5">
                    {r.operationalStatus ? (OP_STATUS_LABEL[r.operationalStatus] ?? r.operationalStatus) : "—"}
                  </p>
                </div>
                <div className="text-right">
                  {r.fuelConsumedLiters != null && (
                    <p className="text-xs text-text-industrial/50">{r.fuelConsumedLiters} L</p>
                  )}
                  <p className={`text-[10px] font-bold mt-0.5 ${r.status === "VERIFIED" ? "text-success-sea" : "text-text-industrial/30"}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

// ─── Detail component (fetches /full for equipment hours) ─────────────────────

const ReportDetail: React.FC<{ report: DailyReport; onBack: () => void }> = ({ report, onBack }) => {
  const { data, loading } = useFetch<FullReport>(`/app/daily-reports/${report.id}/full`, [report.id]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-3 p-4 border-b border-fg/10">
        <button type="button" onClick={onBack} className="p-2 -ml-2 text-text-industrial/40 hover:text-fg">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="font-bold text-sm text-fg flex-1">{report.reportDate.slice(0, 10)}</span>
        <span className="text-xs text-text-industrial/40">{STATUS_LABEL[report.status] ?? report.status}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Consumos generales */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Combustible</p>
            <p className="text-xl font-bold text-fg tabular-nums">
              {report.fuelConsumedLiters != null ? report.fuelConsumedLiters : "—"}
              {report.fuelConsumedLiters != null && <span className="text-xs font-normal text-text-industrial/40 ml-1">L</span>}
            </p>
          </div>
          <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Aceite</p>
            <p className="text-xl font-bold text-fg tabular-nums">
              {report.oilConsumedLiters != null ? report.oilConsumedLiters : "—"}
              {report.oilConsumedLiters != null && <span className="text-xs font-normal text-text-industrial/40 ml-1">L</span>}
            </p>
          </div>
        </div>

        {/* Horas por equipo */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/40">Horas por equipo</p>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
            </div>
          ) : (data?.equipmentHours?.length ?? 0) === 0 ? (
            <p className="text-[11px] text-text-industrial/40 italic">Sin horas de equipo registradas.</p>
          ) : (
            <div className="space-y-1.5">
              {data!.equipmentHours.map((e, i) => (
                <div key={(e.assetId ?? "x") + i} className="bg-fg/5 border border-fg/10 rounded-xl p-3 flex items-center justify-between">
                  <p className="text-sm text-fg truncate flex-1 mr-3">{e.equipmentLabel}</p>
                  <p className="text-sm font-bold text-fg tabular-nums shrink-0">
                    {e.runningHoursTotal != null ? `${e.runningHoursTotal} h` : "—"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {report.operationalStatus && (
          <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Estado</p>
            <p className="text-sm font-bold text-fg">{OP_STATUS_LABEL[report.operationalStatus] ?? report.operationalStatus}</p>
          </div>
        )}
        {report.notes && (
          <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">Notas</p>
            <p className="text-sm text-fg/80 leading-relaxed">{report.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
};
