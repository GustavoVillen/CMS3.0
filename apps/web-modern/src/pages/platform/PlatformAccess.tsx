import React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, RefreshCw } from "lucide-react";
import { platformFetch } from "../../lib/platform-auth";
import { escapeHtml } from "../../lib/utils";
import { DataTable, type Column } from "../../components/DataTable";
import {
  PageIntro, StatusPill, Card, FilterBar, FilterField, Segmented, EmptyState, TwoLines, inputCls,
} from "../../components/platform/PlatformUi";
import { roleLabel, screenLabel, failureLabel, fmtWhen, fmtAgo } from "../../lib/platform-labels";

// Leaflet rompe las rutas de sus íconos al empaquetarse con Vite — mismo
// arreglo que en PlatformVesselMap.
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

// ── Tipos (espejo de platform/access/platform-access-service.ts) ─────────────

interface AccessLocation {
  ipAddress: string | null;
  label: string;
  countryCode: string | null;
  country: string | null;
  city: string | null;
  isp: string | null;
  latitude: number | null;
  longitude: number | null;
  source: "device" | "ip" | null;
}

interface ActiveUser {
  userId: string;
  userEmail: string;
  userName: string | null;
  tenantSlug: string;
  tenantName: string;
  userRole: string | null;
  vesselCode: string | null;
  vesselName: string | null;
  lastRoute: string | null;
  lastSeenAt: string;
  requestCount: number;
  device: string | null;
  location: AccessLocation;
}

interface LoginRow {
  id: string;
  createdAt: string;
  scope: "tenant" | "platform";
  success: boolean;
  tenantSlug: string | null;
  tenantName: string | null;
  userEmail: string | null;
  userEmailRedacted: boolean;
  userName: string | null;
  userRole: string | null;
  failureReason: string | null;
  device: string | null;
  location: AccessLocation;
}

const WINDOW_OPTIONS = [
  { minutes: 15,   label: "15 min" },
  { minutes: 60,   label: "1 hora" },
  { minutes: 480,  label: "8 horas" },
  { minutes: 1440, label: "24 horas" },
];

// ── Formato ──────────────────────────────────────────────────────────────────

const personName = (u: { userName: string | null; userEmail: string | null }) => u.userName ?? u.userEmail ?? "—";

function placeLine(location: AccessLocation): string {
  return location.source === "device" ? "ubicación exacta del celular" : "ubicación aproximada";
}

const LocationCell: React.FC<{ location: AccessLocation; tech: boolean }> = ({ location, tech }) => (
  <div className="leading-tight min-w-0">
    <div className="text-sm text-fg">{location.label}</div>
    <div className="text-xs text-text-industrial/50">{placeLine(location)}</div>
    {tech && (
      <div className="text-xs text-text-industrial/50">
        {location.ipAddress ?? "sin IP"}{location.isp ? ` · ${location.isp}` : ""}
      </div>
    )}
  </div>
);

// ── Mapa ─────────────────────────────────────────────────────────────────────

/**
 * Cuando varias personas comparten ciudad, la geolocalización por IP les asigna
 * exactamente las mismas coordenadas y los marcadores quedan uno tapando al
 * otro. Se los abre en un anillo chico alrededor del punto real.
 */
function spreadOverlaps(users: ActiveUser[]): Array<{ user: ActiveUser; lat: number; lng: number }> {
  const byPoint = new Map<string, ActiveUser[]>();
  const out: Array<{ user: ActiveUser; lat: number; lng: number }> = [];

  for (const u of users) {
    const { latitude, longitude } = u.location;
    if (latitude === null || longitude === null) continue;
    const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
    const bucket = byPoint.get(key);
    if (bucket) bucket.push(u); else byPoint.set(key, [u]);
  }

  for (const bucket of byPoint.values()) {
    bucket.forEach((user, i) => {
      const lat = user.location.latitude!;
      const lng = user.location.longitude!;
      if (bucket.length === 1) {
        out.push({ user, lat, lng });
        return;
      }
      const angle = (2 * Math.PI * i) / bucket.length;
      const radius = 0.08; // ~9 km: suficiente para separarlos sin mentir el lugar
      out.push({ user, lat: lat + radius * Math.sin(angle), lng: lng + radius * Math.cos(angle) });
    });
  }

  return out;
}

function buildPopup(u: ActiveUser): string {
  const loc = u.location;
  const vessel = u.vesselName ?? u.vesselCode;
  const lines = [
    `<strong style="font-size:14px">${escapeHtml(personName(u))}</strong>`,
    vessel ? `<span>A bordo del ${escapeHtml(vessel)}</span>` : `<span>En oficina</span>`,
    `<span>${escapeHtml(loc.label)}</span>`,
    `<span style="color:#666;font-size:11px">${escapeHtml(placeLine(loc))} · ${escapeHtml(fmtAgo(u.lastSeenAt))}</span>`,
  ];

  return `<div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.6">${lines.join("<br/>")}</div>`;
}

const AccessMap: React.FC<{
  users: ActiveUser[];
  focusUserId: string | null;
}> = ({ users, focusUserId }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const markersRef = React.useRef<Map<string, L.Marker>>(new Map());

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = L.map(containerRef.current, { center: [10, -30], zoom: 2, zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(mapRef.current);
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of markersRef.current.values()) map.removeLayer(marker);
    markersRef.current.clear();

    const placed = spreadOverlaps(users);
    for (const { user, lat, lng } of placed) {
      const marker = L.marker([lat, lng]).addTo(map).bindPopup(buildPopup(user));
      markersRef.current.set(user.userId, marker);
    }

    if (placed.length > 0) {
      map.fitBounds(L.latLngBounds(placed.map((p) => [p.lat, p.lng] as [number, number])), {
        padding: [50, 50],
        maxZoom: 8,
      });
    }
  }, [users]);

  // Clic en una fila de la tabla → zoom al punto de esa persona.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusUserId) return;
    const marker = markersRef.current.get(focusUserId);
    if (!marker) return;
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 9), { duration: 0.6 });
    marker.openPopup();
  }, [focusUserId]);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
};

// ── Columnas ─────────────────────────────────────────────────────────────────

function activeColumns(tech: boolean): Column<ActiveUser>[] {
  const cols: Column<ActiveUser>[] = [
    {
      key: "userEmail", header: "Persona", mobileTitle: true,
      sortValue: (r) => personName(r),
      filterValue: (r) => personName(r),
      render: (r) => <TwoLines main={personName(r)} sub={roleLabel(r.userRole)} />,
    },
    {
      key: "tenantName", header: "Empresa y buque",
      filterValue: (r) => r.tenantName ?? r.tenantSlug,
      render: (r) => <TwoLines main={r.tenantName ?? r.tenantSlug} sub={r.vesselName ?? r.vesselCode ?? "Sin buque asignado"} />,
    },
    {
      key: "location", header: "Dónde está", mobileHidden: true,
      sortValue: (r) => r.location.label,
      render: (r) => <LocationCell location={r.location} tech={tech} />,
    },
    { key: "device", header: "Desde qué equipo", mobileHidden: true, render: (r) => <span className="text-sm text-text-industrial/70">{r.device ?? "—"}</span> },
    {
      key: "lastRoute", header: "Qué está mirando", mobileHidden: true,
      sortValue: (r) => screenLabel(r.lastRoute),
      filterValue: (r) => screenLabel(r.lastRoute),
      render: (r) => <span className="text-sm text-text-industrial/70">{screenLabel(r.lastRoute)}</span>,
    },
  ];
  if (tech) {
    cols.push({ key: "requestCount", header: "Pedidos al sistema", mobileHidden: true, render: (r) => <span className="text-sm text-text-industrial/70">{r.requestCount}</span> });
  }
  cols.push({
    key: "lastSeenAt", header: "Última actividad",
    render: (r) => <span className="text-sm text-text-industrial/70 whitespace-nowrap">{fmtAgo(r.lastSeenAt)}</span>,
  });
  return cols;
}

function loginColumns(tech: boolean): Column<LoginRow>[] {
  return [
    {
      key: "createdAt", header: "Cuándo", mobileTitle: true,
      render: (r) => <span className="text-sm text-text-industrial/70 whitespace-nowrap">{fmtWhen(r.createdAt)}</span>,
    },
    {
      key: "success", header: "Resultado", mobileTitle: true,
      sortValue: (r) => (r.success ? 1 : 0),
      filterValue: (r) => (r.success ? "Entró" : "Rechazado"),
      render: (r) => r.success ? <StatusPill tone="ok">Entró</StatusPill> : <StatusPill tone="bad">Rechazado</StatusPill>,
    },
    {
      key: "userEmail", header: "Persona",
      sortValue: (r) => (r.userEmailRedacted ? "" : personName(r)),
      filterValue: (r) => (r.userEmailRedacted ? "Intento anterior al registro de nombres" : personName(r)),
      render: (r) => {
        if (r.userEmailRedacted) {
          return <TwoLines main="Intento anterior al registro de nombres" sub={failureLabel(null)} />;
        }
        if (!r.success && r.failureReason === "user_not_found") {
          return <TwoLines main={`«${r.userEmail ?? ""}»`} sub={failureLabel(r.failureReason)} />;
        }
        return <TwoLines main={personName(r)} sub={r.success ? undefined : failureLabel(r.failureReason)} />;
      },
    },
    {
      key: "tenantName", header: "Empresa", mobileHidden: true,
      filterValue: (r) => (r.scope === "platform" ? "Consola" : r.tenantName ?? r.tenantSlug ?? ""),
      render: (r) => <span className="text-sm text-text-industrial/80">{r.scope === "platform" ? "Consola" : r.tenantName ?? r.tenantSlug ?? "—"}</span>,
    },
    {
      key: "location", header: "Desde dónde", mobileHidden: true,
      sortValue: (r) => r.location.label,
      render: (r) => (
        <div className="leading-tight min-w-0">
          <LocationCell location={r.location} tech={tech} />
          {r.device && <div className="text-xs text-text-industrial/50">{r.device}</div>}
        </div>
      ),
    },
  ];
}

// ── Página ───────────────────────────────────────────────────────────────────

export const PlatformAccessPage: React.FC = () => {
  const [windowMinutes, setWindowMinutes] = React.useState(15);
  const [active, setActive] = React.useState<ActiveUser[] | null>(null);
  const [activeError, setActiveError] = React.useState<string | null>(null);
  const [activeLoading, setActiveLoading] = React.useState(true);
  const [lastRefresh, setLastRefresh] = React.useState<Date>(new Date());
  const [focusUserId, setFocusUserId] = React.useState<string | null>(null);
  const [tech, setTech] = React.useState(false);

  const [logins, setLogins] = React.useState<LoginRow[] | null>(null);
  const [loginsError, setLoginsError] = React.useState<string | null>(null);
  const [loginsLoading, setLoginsLoading] = React.useState(true);
  const [empresa, setEmpresa] = React.useState("");
  const [persona, setPersona] = React.useState("");
  const [result, setResult] = React.useState<"" | "ok" | "bad">("");

  const loadActive = React.useCallback(async () => {
    setActiveLoading(true);
    try {
      const data = await platformFetch<{ items: ActiveUser[] }>(`/platform/access/active?windowMinutes=${windowMinutes}`);
      setActive(data.items);
      setActiveError(null);
    } catch (e: any) {
      setActiveError(e?.message ?? "No se pudo cargar quién está conectado");
    } finally {
      setActiveLoading(false);
      setLastRefresh(new Date());
    }
  }, [windowMinutes]);

  const loadLogins = React.useCallback(async () => {
    setLoginsLoading(true);
    try {
      const data = await platformFetch<{ items: LoginRow[]; total: number }>(`/platform/access/logins?limit=300`);
      setLogins(data.items);
      setLoginsError(null);
    } catch (e: any) {
      setLoginsError(e?.message ?? "No se pudo cargar el historial");
    } finally {
      setLoginsLoading(false);
    }
  }, []);

  React.useEffect(() => { loadActive(); }, [loadActive]);
  React.useEffect(() => { loadLogins(); }, [loadLogins]);

  // Refresco automático del panel en vivo.
  React.useEffect(() => {
    const timer = setInterval(loadActive, 60_000);
    return () => clearInterval(timer);
  }, [loadActive]);

  const mappable = React.useMemo(
    () => (active ?? []).filter((u) => u.location.latitude !== null && u.location.longitude !== null),
    [active],
  );

  const empresas = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of logins ?? []) {
      const n = r.tenantName ?? r.tenantSlug;
      if (r.scope === "tenant" && n) s.add(n);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "es"));
  }, [logins]);

  const personas = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of logins ?? []) {
      if (r.userEmailRedacted || r.failureReason === "user_not_found") continue;
      if (r.userName ?? r.userEmail) s.add(personName(r));
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "es"));
  }, [logins]);

  const filteredLogins = React.useMemo(() => {
    if (!logins) return null;
    return logins.filter((r) => {
      if (empresa && (r.scope === "platform" || (r.tenantName ?? r.tenantSlug) !== empresa)) return false;
      if (persona && (r.userEmailRedacted || personName(r) !== persona)) return false;
      if (result === "ok" && !r.success) return false;
      if (result === "bad" && r.success) return false;
      return true;
    });
  }, [logins, empresa, persona, result]);

  const reloadAll = React.useCallback(() => { loadActive(); loadLogins(); }, [loadActive, loadLogins]);

  const activeCols = React.useMemo(() => activeColumns(tech), [tech]);
  const loginCols = React.useMemo(() => loginColumns(tech), [tech]);

  const btnCls = "inline-flex items-center gap-1.5 px-3 py-2 md:py-1.5 rounded-lg border border-fg/10 bg-fg/5 text-sm text-text-industrial hover:border-accent/40";

  return (
    <div className="space-y-5">
      <PageIntro
        title="Conectados e ingresos"
        description="Quién está usando el sistema ahora y quién intentó entrar."
        actions={
          <>
            <button onClick={() => setTech((v) => !v)} className={btnCls}>
              {tech ? "Ocultar detalle técnico" : "Ver detalle técnico"}
            </button>
            <button onClick={reloadAll} className={btnCls}>
              <RefreshCw className="w-3.5 h-3.5" /> Actualizar
            </button>
          </>
        }
      />

      <Card
        title={`Conectados ahora · ${active?.length ?? 0} ${active?.length === 1 ? "persona" : "personas"}`}
        subtitle={`Se actualiza solo cada minuto (última lectura ${lastRefresh.toLocaleTimeString("es-AR")}). Tocá una fila para ubicarla en el mapa.`}
        actions={
          <FilterField label="Mostrar conectados en los últimos">
            <Segmented
              value={String(windowMinutes)}
              options={WINDOW_OPTIONS.map((o) => ({ value: String(o.minutes), label: o.label }))}
              onChange={(v) => setWindowMinutes(Number(v))}
            />
          </FilterField>
        }
      >
        <div className="h-[260px] md:h-[380px] border-y border-border">
          <AccessMap users={mappable} focusUserId={focusUserId} />
        </div>

        {mappable.length < (active?.length ?? 0) && (
          <p className="px-4 pt-2 text-xs text-text-industrial/50 flex items-center gap-1.5">
            <MapPin className="w-3 h-3" />
            {(active?.length ?? 0) - mappable.length} de {active?.length} conectados no se pueden ubicar en el mapa
            (red local o ubicación desconocida). Igual aparecen en la tabla.
          </p>
        )}

        <div className="p-4">
          <DataTable
            columns={activeCols}
            data={active}
            loading={activeLoading && active === null}
            error={activeError}
            keyFn={(r) => r.userId}
            onRowClick={(r) => setFocusUserId(r.userId)}
            emptyText="Nadie usó el sistema en este período. Probá con una ventana más larga."
            mobileCards
          />
        </div>
      </Card>

      <Card title="Historial de ingresos" subtitle="Cada vez que alguien entró o intentó entrar.">
        <div className="px-4">
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
            <FilterField label="Resultado">
              <Segmented
                value={result}
                options={[{ value: "", label: "Todos" }, { value: "ok", label: "Entró" }, { value: "bad", label: "Rechazado" }]}
                onChange={setResult}
              />
            </FilterField>
          </FilterBar>
        </div>
        <div className="px-4 pb-4">
          {filteredLogins && filteredLogins.length === 0 && !loginsLoading ? (
            <EmptyState title="No hay ingresos con esos filtros" text="Cambiá la empresa, la persona o el resultado para ver más." />
          ) : (
            <DataTable
              columns={loginCols}
              data={filteredLogins}
              loading={loginsLoading && logins === null}
              error={loginsError}
              keyFn={(r) => r.id}
              emptyText="Sin ingresos registrados."
              mobileCards
            />
          )}
        </div>
      </Card>
    </div>
  );
};
