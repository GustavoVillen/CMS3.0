import React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Radar, MapPin, Smartphone, Wifi } from "lucide-react";
import { platformFetch } from "../../lib/platform-auth";
import { escapeHtml } from "../../lib/utils";
import { DataTable, type Column } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";

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
  tenantSlug: string;
  userRole: string | null;
  vesselCode: string | null;
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

const FAILURE_LABELS: Record<string, string> = {
  wrong_password:      "Contraseña incorrecta",
  user_not_found:      "Usuario inexistente",
  user_inactive:       "Usuario inactivo",
  invalid_credentials: "Credenciales inválidas",
};

// ── Formato ──────────────────────────────────────────────────────────────────

function fmtAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  return `hace ${Math.floor(hrs / 24)} d`;
}

/** Convierte "PY" en 🇵🇾 usando los símbolos regionales de Unicode. */
function flagEmoji(countryCode: string | null): string {
  if (!countryCode || countryCode.length !== 2) return "";
  const base = 0x1f1e6 - 65;
  return String.fromCodePoint(
    base + countryCode.toUpperCase().charCodeAt(0),
    base + countryCode.toUpperCase().charCodeAt(1),
  );
}

const LocationCell: React.FC<{ location: AccessLocation }> = ({ location }) => (
  <div className="leading-tight">
    <div className="text-xs text-fg/80 flex items-center gap-1.5">
      {flagEmoji(location.countryCode) && <span>{flagEmoji(location.countryCode)}</span>}
      <span>{location.label}</span>
      {location.source === "device" && (
        <span className="text-[9px] px-1 py-px rounded bg-success/10 text-success border border-success/25" title="Posición real tomada del GPS del dispositivo">
          GPS
        </span>
      )}
    </div>
    <div className="text-[10px] font-mono text-text-industrial/40">
      {location.ipAddress ?? "sin IP"}{location.isp ? ` · ${location.isp}` : ""}
    </div>
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
  const lines = [
    `<strong style="font-size:14px">${escapeHtml(u.userEmail)}</strong>`,
    `<span style="color:#888">${escapeHtml(u.tenantSlug)}${u.userRole ? ` · ${escapeHtml(u.userRole)}` : ""}</span>`,
    u.vesselCode ? `<span>🚢 ${escapeHtml(u.vesselCode)}</span>` : "",
    `<span>${flagEmoji(loc.countryCode)} ${escapeHtml(loc.label)}</span>`,
    loc.isp ? `<span style="color:#666;font-size:11px">${escapeHtml(loc.isp)}</span>` : "",
    u.device ? `<span style="color:#666;font-size:11px">${escapeHtml(u.device)}</span>` : "",
    `<span style="color:#666;font-size:11px">${escapeHtml(fmtAge(u.lastSeenAt))}</span>`,
    `<span style="color:#999;font-size:10px">${loc.source === "device" ? "Posición del dispositivo (GPS)" : "Ubicación estimada por IP"}</span>`,
  ].filter(Boolean);

  return `<div style="font-family:system-ui,sans-serif;font-size:12px;line-height:1.6">${lines.join("<br/>")}</div>`;
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

const ACTIVE_COLS: Column<ActiveUser>[] = [
  {
    key: "userEmail", header: "Usuario",
    render: (r) => (
      <div className="leading-tight">
        <div className="text-xs text-fg/90 truncate max-w-[220px]" title={r.userEmail}>{r.userEmail}</div>
        {r.userRole && <div className="text-[10px] text-text-industrial/40">{r.userRole}</div>}
      </div>
    ),
  },
  { key: "tenantSlug", header: "Empresa", render: (r) => <span className="font-mono text-xs text-accent">{r.tenantSlug}</span> },
  { key: "vesselCode", header: "Buque",   render: (r) => r.vesselCode ? <span className="font-mono text-xs text-accent/70">{r.vesselCode}</span> : <span className="text-text-industrial/20">—</span> },
  {
    key: "location", header: "Ubicación",
    sortValue: (r) => r.location.label,
    render: (r) => <LocationCell location={r.location} />,
  },
  { key: "device", header: "Dispositivo", render: (r) => <span className="text-xs text-text-industrial/60">{r.device ?? "—"}</span> },
  {
    key: "lastRoute", header: "Pantalla",
    render: (r) => <span className="font-mono text-[10px] text-text-industrial/50 truncate block max-w-[220px]" title={r.lastRoute ?? ""}>{r.lastRoute ?? "—"}</span>,
  },
  { key: "requestCount", header: "Acciones", render: (r) => <span className="font-mono text-xs text-text-industrial/70">{r.requestCount}</span> },
  {
    key: "lastSeenAt", header: "Visto",
    render: (r) => (
      <span className="text-xs text-text-industrial/60" title={new Date(r.lastSeenAt).toLocaleString("es-AR")}>
        {fmtAge(r.lastSeenAt)}
      </span>
    ),
  },
];

const LOGIN_COLS: Column<LoginRow>[] = [
  {
    key: "createdAt", header: "Fecha",
    render: (r) => <span className="font-mono text-xs text-text-industrial/60">{new Date(r.createdAt).toLocaleString("es-AR")}</span>,
  },
  {
    key: "success", header: "Resultado",
    sortValue: (r) => (r.success ? 1 : 0),
    render: (r) => r.success
      ? <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-success/10 text-success border-success/25">INGRESÓ</span>
      : (
        <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-danger/10 text-danger border-danger/25"
              title={FAILURE_LABELS[r.failureReason ?? ""] ?? r.failureReason ?? ""}>
          RECHAZADO
        </span>
      ),
  },
  {
    key: "userEmail", header: "Usuario",
    render: (r) => (
      <div className="leading-tight">
        {r.userEmailRedacted ? (
          // El audit no guarda el usuario tecleado en un intento fallido, solo
          // un identificador ofuscado. Se muestra tal cual para poder reconocer
          // al mismo atacante insistiendo, sin fingir que es un email real.
          <div className="text-[11px] font-mono text-text-industrial/50" title="Identificador oculto: permite reconocer intentos repetidos del mismo origen sin guardar el usuario tecleado">
            🔒 {r.userEmail}
          </div>
        ) : (
          <>
            <div className="text-xs text-fg/90 truncate max-w-[220px]" title={r.userEmail ?? ""}>{r.userName ?? r.userEmail ?? "—"}</div>
            {r.userName && r.userEmail && <div className="text-[10px] text-text-industrial/40 truncate max-w-[220px]">{r.userEmail}</div>}
          </>
        )}
        {!r.success && r.failureReason && (
          <div className="text-[10px] text-danger/70">{FAILURE_LABELS[r.failureReason] ?? r.failureReason}</div>
        )}
      </div>
    ),
  },
  {
    key: "tenantSlug", header: "Empresa",
    render: (r) => r.scope === "platform"
      ? <span className="font-mono text-xs text-red-700 dark:text-red-400">consola admin</span>
      : <span className="font-mono text-xs text-accent">{r.tenantSlug ?? "—"}</span>,
  },
  {
    key: "location", header: "Ubicación",
    sortValue: (r) => r.location.label,
    render: (r) => <LocationCell location={r.location} />,
  },
  { key: "device", header: "Dispositivo", render: (r) => <span className="text-xs text-text-industrial/60">{r.device ?? "—"}</span> },
];

// ── Página ───────────────────────────────────────────────────────────────────

export const PlatformAccessPage: React.FC = () => {
  const [windowMinutes, setWindowMinutes] = React.useState(15);
  const [active, setActive] = React.useState<ActiveUser[] | null>(null);
  const [activeError, setActiveError] = React.useState<string | null>(null);
  const [activeLoading, setActiveLoading] = React.useState(true);
  const [lastRefresh, setLastRefresh] = React.useState<Date>(new Date());
  const [focusUserId, setFocusUserId] = React.useState<string | null>(null);

  const [logins, setLogins] = React.useState<LoginRow[] | null>(null);
  const [loginsTotal, setLoginsTotal] = React.useState(0);
  const [loginsError, setLoginsError] = React.useState<string | null>(null);
  const [loginsLoading, setLoginsLoading] = React.useState(true);
  const [tenantSlug, setTenantSlug] = React.useState("");
  const [userEmail, setUserEmail] = React.useState("");
  const [result, setResult] = React.useState("");

  const loadActive = React.useCallback(async () => {
    setActiveLoading(true);
    try {
      const data = await platformFetch<{ items: ActiveUser[] }>(`/platform/access/active?windowMinutes=${windowMinutes}`);
      setActive(data.items);
      setActiveError(null);
    } catch (e: any) {
      setActiveError(e?.message ?? "Error al cargar los conectados");
    } finally {
      setActiveLoading(false);
      setLastRefresh(new Date());
    }
  }, [windowMinutes]);

  const loadLogins = React.useCallback(async () => {
    setLoginsLoading(true);
    try {
      const sp = new URLSearchParams({ limit: "300" });
      if (tenantSlug.trim()) sp.set("tenantSlug", tenantSlug.trim());
      if (userEmail.trim())  sp.set("userEmail",  userEmail.trim());
      if (result)            sp.set("result",     result);
      const data = await platformFetch<{ items: LoginRow[]; total: number }>(`/platform/access/logins?${sp.toString()}`);
      setLogins(data.items);
      setLoginsTotal(data.total);
      setLoginsError(null);
    } catch (e: any) {
      setLoginsError(e?.message ?? "Error al cargar el historial");
    } finally {
      setLoginsLoading(false);
    }
  }, [tenantSlug, userEmail, result]);

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

  const reloadAll = React.useCallback(() => { loadActive(); loadLogins(); }, [loadActive, loadLogins]);

  return (
    <div className="space-y-5">
      <PageHeader icon={Radar} title="Accesos" total={active?.length} onReload={reloadAll}>
        <div className="flex items-center gap-1">
          {WINDOW_OPTIONS.map((opt) => (
            <button key={opt.minutes} onClick={() => setWindowMinutes(opt.minutes)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
                windowMinutes === opt.minutes
                  ? "bg-accent/15 border-accent/30 text-accent"
                  : "bg-fg/5 border-fg/10 text-text-industrial hover:border-accent/30"
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </PageHeader>

      <p className="text-xs text-text-industrial/40 -mt-2">
        Actividad de los últimos {WINDOW_OPTIONS.find((o) => o.minutes === windowMinutes)?.label}.
        Se actualiza solo cada 60 s · última lectura {lastRefresh.toLocaleTimeString("es-AR")}
      </p>

      {/* ── Mapa ── */}
      <div className="rounded-xl border border-border overflow-hidden" style={{ height: 380 }}>
        <AccessMap users={mappable} focusUserId={focusUserId} />
      </div>

      {mappable.length < (active?.length ?? 0) && (
        <p className="text-[11px] text-text-industrial/40 flex items-center gap-1.5">
          <MapPin className="w-3 h-3" />
          {(active?.length ?? 0) - mappable.length} de {active?.length} conectados no se pueden ubicar en el mapa
          (red local o IP sin ubicación conocida). Igual aparecen en la tabla.
        </p>
      )}

      {/* ── Conectados ahora ── */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold text-fg flex items-center gap-2">
          <Wifi className="w-4 h-4 text-accent" />
          Conectados ahora
          <span className="text-xs font-normal text-text-industrial/40">
            ({active?.length ?? 0}) · clic en una fila para ubicarla en el mapa
          </span>
        </h3>
        <DataTable
          columns={ACTIVE_COLS}
          data={active}
          loading={activeLoading && active === null}
          error={activeError}
          keyFn={(r) => r.userId}
          onRowClick={(r) => setFocusUserId(r.userId)}
          emptyText="Nadie usó la app en esta ventana de tiempo."
        />
      </section>

      {/* ── Historial de ingresos ── */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold text-fg flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-accent" />
          Historial de ingresos
          <span className="text-xs font-normal text-text-industrial/40">({loginsTotal})</span>
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          <input value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} placeholder="Empresa (slug)"
            className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-fg placeholder:text-text-industrial/30 focus:outline-none focus:border-accent/40" />
          <input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="Usuario"
            className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-fg placeholder:text-text-industrial/30 focus:outline-none focus:border-accent/40" />
          <select value={result} onChange={(e) => setResult(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-fg focus:outline-none focus:border-accent/40">
            <option value="">Todos</option>
            <option value="success">Solo ingresos</option>
            <option value="failed">Solo rechazados</option>
          </select>
        </div>

        <DataTable
          columns={LOGIN_COLS}
          data={logins}
          loading={loginsLoading && logins === null}
          error={loginsError}
          keyFn={(r) => r.id}
          emptyText="Sin ingresos registrados."
        />
      </section>
    </div>
  );
};
