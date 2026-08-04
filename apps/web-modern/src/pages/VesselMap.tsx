import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../lib/api";
import { escapeHtml } from "../lib/utils";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

interface VesselPosition {
  vesselCode: string;
  vesselName: string;
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

export function VesselMapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const [positions, setPositions] = useState<VesselPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchPositions = async () => {
    try {
      const data = await api.get<{ items: VesselPosition[] }>("/app/vessel-positions");
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

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    leafletMap.current = L.map(mapRef.current, { center: [20, 0], zoom: 2 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(leafletMap.current);
  }, []);

  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    map.eachLayer(layer => { if (layer instanceof L.Marker) map.removeLayer(layer); });

    positions.forEach(pos => {
      const reportDate = pos.userEmail ? new Date(pos.userEmail).toLocaleDateString() : fmtAge(pos.seenAt);
      const label = L.divIcon({
        className: "",
        // El icono sale del paquete (ya importado arriba), no de unpkg: una CDN
        // externa es una dependencia de terceros dentro de la sesión del usuario.
        html: `
          <div style="display:flex;align-items:center;gap:6px;white-space:nowrap">
            <img src="${markerIcon}" style="width:16px;height:26px;flex-shrink:0"/>
            <span style="background:rgba(10,20,40,0.85);color:#e2e8f0;font-size:11px;font-weight:700;
              padding:2px 7px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);
              font-family:monospace;letter-spacing:0.03em">${escapeHtml(pos.vesselName)}</span>
          </div>`,
        iconAnchor: [8, 26],
      });
      const popup = `
        <div style="font-family:monospace;font-size:13px;line-height:1.7">
          <strong style="font-size:15px">🚢 ${escapeHtml(pos.vesselName)}</strong>
          <span style="color:#888;font-size:11px"> (${escapeHtml(pos.vesselCode)})</span><br/>
          <span style="color:#888;font-size:11px">Último reporte: ${escapeHtml(reportDate)}</span><br/>
          <span style="color:#888;font-size:11px">${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}</span>
        </div>`;
      L.marker([pos.latitude, pos.longitude], { icon: label }).addTo(map).bindPopup(popup);
    });

    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions.map(p => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 8 });
    }
  }, [positions]);

  return (
    <div className="h-full flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-fg">Posición de Embarcaciones</h1>
          <p className="text-xs text-fg/40 mt-0.5">
            Actualizado: {lastRefresh.toLocaleTimeString()} · Refresca cada 60 s · Solo usuarios Técnico/Operador
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <span className="text-xs text-fg/30 animate-pulse">Cargando…</span>}
          {error && <span className="text-xs text-red-700 dark:text-red-400">{error}</span>}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10">
            <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-xs text-fg font-medium">
              {positions.length} embarcación{positions.length !== 1 ? "es" : ""}
            </span>
          </div>
          <button
            onClick={fetchPositions}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-fg/5 border border-fg/10 text-fg/50 hover:text-fg hover:bg-fg/10 transition-all"
          >
            Actualizar
          </button>
        </div>
      </div>

      <div className="flex-1 rounded-xl overflow-hidden border border-fg/10 min-h-0" style={{ minHeight: 400 }}>
        <div ref={mapRef} style={{ height: "100%", width: "100%" }} />
      </div>

      {positions.length > 0 && (
        <div className="shrink-0 rounded-xl border border-fg/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-fg/10 bg-fg/5">
                <th className="px-4 py-2 text-left text-fg/30 font-medium">Buque</th>
                <th className="px-4 py-2 text-left text-fg/30 font-medium">Último reporte</th>
                <th className="px-4 py-2 text-left text-fg/30 font-medium">Lat / Long</th>
                <th className="px-4 py-2 text-left text-fg/30 font-medium">Posición</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => (
                <tr key={i} className="border-b border-fg/5 hover:bg-fg/3 transition-colors">
                  <td className="px-4 py-2 font-bold text-fg">{p.vesselName} <span className="text-fg/30 font-mono text-[10px]">{p.vesselCode}</span></td>
                  <td className="px-4 py-2 text-fg/50">{p.userEmail ? new Date(p.userEmail).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2 font-mono text-fg/40">{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</td>
                  <td className="px-4 py-2 text-fg/30">{fmtAge(p.seenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && positions.length === 0 && (
        <div className="shrink-0 rounded-xl border border-fg/10 bg-fg/3 p-8 text-center">
          <p className="text-sm text-fg/40">Sin posiciones registradas aún.</p>
          <p className="text-xs text-fg/20 mt-1">
            Los usuarios Técnico/Operador deben permitir acceso a la ubicación en el navegador.
          </p>
        </div>
      )}
    </div>
  );
}
