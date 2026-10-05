import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../../lib/api";
import { escapeHtml } from "../../lib/utils";
import { PageIntro, StatusPill, Card, FilterBar, FilterField, EmptyState, TwoLines, inputCls } from "../../components/platform/PlatformUi";
import { fmtAgo } from "../../lib/platform-labels";

// Fix Leaflet's broken default icon paths when bundled with Vite
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

interface VesselPosition {
  vesselCode: string;
  vesselName?: string | null;
  tenantSlug: string;
  tenantName?: string | null;
  userEmail: string;
  userName?: string | null;
  latitude: number;
  longitude: number;
  seenAt: string;
}

const FRESH_MS = 6 * 60 * 60 * 1000;

const vesselOf = (p: VesselPosition) => p.vesselName ?? p.vesselCode;
const tenantOf = (p: VesselPosition) => p.tenantName ?? p.tenantSlug;
const personOf = (p: VesselPosition) => p.userName ?? p.userEmail;

export function PlatformVesselMapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const [positions, setPositions] = useState<VesselPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [empresa, setEmpresa] = useState("");
  const [persona, setPersona] = useState("");

  // Fetch positions
  const fetchPositions = async () => {
    try {
      const data = await api.get<{ items: VesselPosition[] }>("/platform/vessel-positions");
      setPositions(data.items);
      setError(null);
    } catch {
      setError("No se pudieron cargar las posiciones");
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  };

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 60_000);
    return () => clearInterval(interval);
  }, []);

  const empresas = useMemo(
    () => Array.from(new Set(positions.map(tenantOf))).sort((a, b) => a.localeCompare(b, "es")),
    [positions],
  );
  const personas = useMemo(
    () => Array.from(new Set(positions.map(personOf))).sort((a, b) => a.localeCompare(b, "es")),
    [positions],
  );
  const shown = useMemo(
    () => positions.filter((p) => (!empresa || tenantOf(p) === empresa) && (!persona || personOf(p) === persona)),
    [positions, empresa, persona],
  );

  // Init map once
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    leafletMap.current = L.map(mapRef.current, {
      center: [20, 0],
      zoom: 2,
      zoomControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(leafletMap.current);
  }, []);

  // Update markers when positions change
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    // Clear existing markers
    map.eachLayer(layer => {
      if (layer instanceof L.Marker) map.removeLayer(layer);
    });

    shown.forEach(pos => {
      const popup = `
        <div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.6">
          <strong style="font-size:15px">${escapeHtml(vesselOf(pos))}</strong><br/>
          <span>${escapeHtml(tenantOf(pos))}</span><br/>
          <span>Informado por ${escapeHtml(personOf(pos))}</span><br/>
          <span style="color:#666;font-size:11px">${escapeHtml(fmtAgo(pos.seenAt))}</span><br/>
          <span style="color:#666;font-size:11px">Latitud ${pos.latitude.toFixed(5)}, longitud ${pos.longitude.toFixed(5)}</span>
        </div>
      `;
      L.marker([pos.latitude, pos.longitude])
        .addTo(map)
        .bindPopup(popup);
    });

    // Fit bounds if there are positions
    if (shown.length > 0) {
      const bounds = L.latLngBounds(shown.map(p => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 8 });
    }
  }, [shown]);

  const statusOf = (p: VesselPosition) =>
    Date.now() - new Date(p.seenAt).getTime() < FRESH_MS
      ? <StatusPill tone="ok">Al día</StatusPill>
      : <StatusPill tone="warn">Sin señal reciente</StatusPill>;

  return (
    <div className="md:h-full flex flex-col gap-4">
      <PageIntro
        title="Ubicación de los buques"
        description="Dónde está cada buque según el último celular a bordo que compartió su ubicación."
        actions={
          <button
            onClick={fetchPositions}
            className="px-3 py-2 md:py-1.5 rounded-lg border border-fg/10 bg-fg/5 text-sm text-text-industrial hover:border-accent/40"
          >
            Actualizar
          </button>
        }
      />

      <div>
        <FilterBar>
          <FilterField label="Empresa">
            <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={inputCls}>
              <option value="">Todas</option>
              {empresas.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </FilterField>
          <FilterField label="Persona">
            <select value={persona} onChange={(e) => setPersona(e.target.value)} className={inputCls}>
              <option value="">Todas</option>
              {personas.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </FilterField>
        </FilterBar>
        <p className="text-xs text-text-industrial/50">
          {loading ? "Cargando…" : `${shown.length} ${shown.length === 1 ? "buque" : "buques"}`} · se actualiza solo cada minuto (última lectura {lastRefresh.toLocaleTimeString("es-AR")})
          {error && <span className="text-danger"> · {error}</span>}
        </p>
      </div>

      {/* En el celular el mapa tiene alto fijo y la lista va debajo, con scroll de página. */}
      <div className="h-[55dvh] md:h-auto shrink-0 md:shrink md:flex-1 rounded-xl overflow-hidden border border-fg/10 min-h-[320px]">
        <div ref={mapRef} style={{ height: "100%", width: "100%" }} />
      </div>

      {shown.length > 0 && (
        <Card className="shrink-0">
          {/* Tarjetas (celular) */}
          <div className="md:hidden divide-y divide-fg/5">
            {shown.map((p, i) => (
              <div key={i} className="p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <TwoLines main={<span className="font-bold">{vesselOf(p)}</span>} sub={tenantOf(p)} />
                  {statusOf(p)}
                </div>
                <div className="text-xs text-text-industrial/60">Informado por {personOf(p)} · {fmtAgo(p.seenAt)}</div>
              </div>
            ))}
          </div>

          {/* Tabla (escritorio) */}
          <table className="hidden md:table w-full text-sm">
            <thead>
              <tr className="border-b border-fg/10 bg-fg/5 text-left text-text-industrial/60">
                <th className="px-4 py-2 font-semibold">Buque</th>
                <th className="px-4 py-2 font-semibold">Empresa</th>
                <th className="px-4 py-2 font-semibold">Informado por</th>
                <th className="px-4 py-2 font-semibold">Última posición</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p, i) => (
                <tr key={i} className="border-b border-fg/5 last:border-0">
                  <td className="px-4 py-2 font-bold text-fg">{vesselOf(p)}</td>
                  <td className="px-4 py-2 text-text-industrial/80">{tenantOf(p)}</td>
                  <td className="px-4 py-2 text-text-industrial/80">{personOf(p)}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="text-text-industrial/70">{fmtAgo(p.seenAt)}</span>
                      {statusOf(p)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {!loading && positions.length === 0 && (
        <div className="shrink-0 rounded-xl border border-fg/10 bg-fg/[0.02]">
          <EmptyState
            title="Todavía ningún buque compartió su ubicación"
            text="Cuando alguien a bordo permita el acceso a la ubicación en su celular, el buque aparece acá."
          />
        </div>
      )}
    </div>
  );
}
