import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../../lib/api";

// Fix Leaflet's broken default icon paths when bundled with Vite
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

interface VesselPosition {
  vesselCode: string;
  tenantSlug: string;
  userEmail: string;
  latitude: number;
  longitude: number;
  seenAt: string;
}

function fmtAge(seenAt: string): string {
  const diffMs = Date.now() - new Date(seenAt).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "hace menos de 1 min";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  return `hace ${Math.floor(hrs / 24)} d`;
}

export function PlatformVesselMapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const [positions, setPositions] = useState<VesselPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Fetch positions
  const fetchPositions = async () => {
    try {
      const data = await api.get<{ items: VesselPosition[] }>("/platform/vessel-positions");
      setPositions(data.items);
      setError(null);
    } catch {
      setError("Error al cargar posiciones");
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

    positions.forEach(pos => {
      const age = fmtAge(pos.seenAt);
      const popup = `
        <div style="font-family:monospace;font-size:13px;line-height:1.6">
          <strong style="font-size:15px">🚢 ${pos.vesselCode}</strong><br/>
          <span style="color:#888">${pos.tenantSlug}</span><br/>
          <span>${pos.userEmail}</span><br/>
          <span style="color:#666;font-size:11px">${age}</span><br/>
          <span style="color:#666;font-size:11px">${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}</span>
        </div>
      `;
      L.marker([pos.latitude, pos.longitude])
        .addTo(map)
        .bindPopup(popup);
    });

    // Fit bounds if there are positions
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions.map(p => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 8 });
    }
  }, [positions]);

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-white">Posición de Embarcaciones</h1>
          <p className="text-xs text-text-industrial/50 mt-0.5">
            Última actualización: {lastRefresh.toLocaleTimeString()} · Actualiza cada 60 s · Solo usuarios Técnico/Operador a bordo
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loading && (
            <span className="text-xs text-text-industrial/40 animate-pulse">Cargando…</span>
          )}
          {error && (
            <span className="text-xs text-red-400">{error}</span>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-xs text-white font-medium">{positions.length} embarcación{positions.length !== 1 ? "es" : ""}</span>
          </div>
          <button
            onClick={fetchPositions}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-text-industrial/70 hover:text-white hover:bg-white/10 transition-all"
          >
            Actualizar
          </button>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 rounded-xl overflow-hidden border border-white/10 min-h-0">
        <div ref={mapRef} style={{ height: "100%", width: "100%" }} />
      </div>

      {/* Table */}
      {positions.length > 0 && (
        <div className="shrink-0 rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-2 text-left text-text-industrial/40 font-medium">Buque</th>
                <th className="px-4 py-2 text-left text-text-industrial/40 font-medium">Tenant</th>
                <th className="px-4 py-2 text-left text-text-industrial/40 font-medium">Usuario</th>
                <th className="px-4 py-2 text-left text-text-industrial/40 font-medium">Lat / Long</th>
                <th className="px-4 py-2 text-left text-text-industrial/40 font-medium">Última señal</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-4 py-2 font-mono font-bold text-white">{p.vesselCode}</td>
                  <td className="px-4 py-2 text-text-industrial/60">{p.tenantSlug}</td>
                  <td className="px-4 py-2 text-text-industrial/60">{p.userEmail}</td>
                  <td className="px-4 py-2 font-mono text-text-industrial/50">
                    {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                  </td>
                  <td className="px-4 py-2 text-text-industrial/40">{fmtAge(p.seenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && positions.length === 0 && (
        <div className="shrink-0 rounded-xl border border-white/10 bg-white/3 p-8 text-center">
          <p className="text-sm text-text-industrial/40">Sin posiciones registradas aún.</p>
          <p className="text-xs text-text-industrial/25 mt-1">
            Los usuarios Técnico/Operador deben permitir el acceso a la ubicación en su navegador.
          </p>
        </div>
      )}
    </div>
  );
}
