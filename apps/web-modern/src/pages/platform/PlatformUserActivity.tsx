import React from "react";
import {
  UserSearch, ShieldAlert, LogIn, FileDown, Monitor, Sparkles, Pencil,
  Download, Layers, MoonStar, Fingerprint,
} from "lucide-react";
import { platformFetch } from "../../lib/platform-auth";
import { DataTable, type Column } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";

// ── Tipos (espejo de platform/access/platform-user-activity-service.ts) ────────

type Severity = "ok" | "warn" | "alert";
type EventType = "login" | "action" | "screen" | "export" | "ai";

interface UserSearchRow {
  userId: string;
  email: string;
  legacyUserId: string | null;
  fullName: string | null;
  tenantSlug: string | null;
  role: string | null;
}

interface Identity {
  userId: string;
  email: string;
  legacyUserId: string | null;
  fullName: string | null;
  status: string;
  memberships: Array<{ tenantSlug: string; role: string; membershipStatus: string }>;
  createdAt: string;
  lastSeenAt: string | null;
  lastIp: string | null;
}

interface Alert {
  key: "exports" | "downloadedMb" | "distinctViews" | "offHours";
  value: number;
  severity: Severity;
}

interface Alerts {
  windowFrom: string;
  windowTo: string;
  totalRequests: number;
  items: Alert[];
}

interface ActivityEvent {
  id: string;
  at: string;
  type: EventType;
  label: string;
  detail: string | null;
  tenantSlug: string | null;
  vesselCode: string | null;
  ip: string | null;
  success: boolean | null;
}

interface ActivityResult {
  user: Identity;
  alerts: Alerts;
  events: ActivityEvent[];
  truncated: boolean;
}

// ── Opciones de UI ─────────────────────────────────────────────────────────────

const WINDOW_OPTIONS = [
  { days: 1,  label: "24 horas" },
  { days: 7,  label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
];

const TYPE_CHIPS: Array<{ type: EventType; label: string }> = [
  { type: "action", label: "Acciones" },
  { type: "screen", label: "Pantallas" },
  { type: "export", label: "Exportaciones" },
  { type: "ai",     label: "Copiloto IA" },
  { type: "login",  label: "Ingresos" },
];

const ALERT_META: Record<Alert["key"], { label: string; icon: React.FC<any>; hint: string; fmt: (v: number) => string }> = {
  exports:       { label: "Exportaciones",         icon: FileDown, hint: "Archivos PDF/Excel que descargó en el período.", fmt: (v) => String(v) },
  downloadedMb:  { label: "Datos descargados",     icon: Download, hint: "Volumen total que la app le envió. Un pico grande puede ser alguien bajándose todo.", fmt: (v) => `${v} MB` },
  distinctViews: { label: "Pantallas distintas",   icon: Layers,   hint: "Cuántas pantallas/vistas diferentes recorrió. Recorrer TODO de forma sistemática es señal de copia.", fmt: (v) => String(v) },
  offHours:      { label: "Actividad de madrugada", icon: MoonStar, hint: "Acciones fuera del horario 06–22 (hora local aprox.).", fmt: (v) => String(v) },
};

const SEV_CLASS: Record<Severity, string> = {
  ok:    "bg-fg/5 border-fg/10 text-text-industrial/70",
  warn:  "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400",
  alert: "bg-danger/10 border-danger/30 text-danger",
};

const TYPE_BADGE: Record<EventType, { label: string; icon: React.FC<any>; cls: string }> = {
  login:  { label: "Ingreso",     icon: LogIn,    cls: "bg-accent/10 text-accent border-accent/25" },
  action: { label: "Acción",      icon: Pencil,   cls: "bg-success/10 text-success border-success/25" },
  screen: { label: "Pantalla",    icon: Monitor,  cls: "bg-fg/5 text-text-industrial/70 border-fg/15" },
  export: { label: "Exportación", icon: FileDown, cls: "bg-danger/10 text-danger border-danger/25" },
  ai:     { label: "Copiloto",    icon: Sparkles, cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25" },
};

// ── Selector de usuario ──────────────────────────────────────────────────────

const UserPicker: React.FC<{
  onPick: (u: UserSearchRow) => void;
  current: Identity | null;
}> = ({ onPick, current }) => {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<UserSearchRow[]>([]);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 1) { setResults([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await platformFetch<{ items: UserSearchRow[] }>(`/platform/user-activity/search?q=${encodeURIComponent(term)}`);
        if (!cancelled) { setResults(data.items); setOpen(true); }
      } catch { /* silencioso: es un buscador */ }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q]);

  return (
    <div className="relative w-full max-w-md">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-fg/5 border border-fg/10 focus-within:border-accent/40">
        <UserSearch className="w-4 h-4 text-text-industrial/40 shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={current ? `${current.fullName ?? current.legacyUserId ?? current.email} — buscar otro usuario…` : "Buscar usuario por nombre, usuario o email…"}
          className="flex-1 bg-transparent text-xs text-fg placeholder:text-text-industrial/40 focus:outline-none"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-surface dark:bg-[#0B1120] shadow-xl max-h-72 overflow-y-auto">
          {results.map((u) => (
            <button
              key={u.userId}
              onClick={() => { onPick(u); setOpen(false); setQ(""); }}
              className="w-full text-left px-3 py-2 hover:bg-accent/10 transition-colors border-b border-border/50 last:border-0"
            >
              <div className="text-xs text-fg font-medium">{u.fullName ?? u.legacyUserId ?? u.email}</div>
              <div className="text-[10px] text-text-industrial/50 font-mono">
                {u.legacyUserId ? `${u.legacyUserId} · ` : ""}{u.email}
                {u.tenantSlug ? ` · ${u.tenantSlug}` : ""}{u.role ? ` · ${u.role}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Columnas de la línea de tiempo ─────────────────────────────────────────────

const EVENT_COLS: Column<ActivityEvent>[] = [
  {
    key: "at", header: "Fecha",
    render: (r) => <span className="font-mono text-xs text-text-industrial/60">{new Date(r.at).toLocaleString("es-AR")}</span>,
  },
  {
    key: "type", header: "Tipo",
    render: (r) => {
      const b = TYPE_BADGE[r.type];
      const Icon = b.icon;
      return (
        <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold ${b.cls}`}>
          <Icon className="w-3 h-3" /> {b.label}
        </span>
      );
    },
  },
  {
    key: "label", header: "Qué hizo",
    render: (r) => (
      <span className={`text-xs ${r.success === false ? "text-danger" : "text-fg/90"}`}>{r.label}</span>
    ),
  },
  {
    key: "detail", header: "Detalle",
    render: (r) => <span className="font-mono text-[10px] text-text-industrial/50 truncate block max-w-[280px]" title={r.detail ?? ""}>{r.detail ?? "—"}</span>,
  },
  {
    key: "tenantSlug", header: "Empresa / Buque",
    render: (r) => (
      <span className="text-xs">
        {r.tenantSlug ? <span className="font-mono text-accent">{r.tenantSlug}</span> : <span className="text-text-industrial/30">—</span>}
        {r.vesselCode ? <span className="font-mono text-accent/70"> · {r.vesselCode}</span> : ""}
      </span>
    ),
  },
  {
    key: "ip", header: "IP",
    render: (r) => <span className="font-mono text-[10px] text-text-industrial/40">{r.ip ?? "—"}</span>,
  },
];

// ── Página ──────────────────────────────────────────────────────────────────

export const PlatformUserActivityPage: React.FC = () => {
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const [days, setDays] = React.useState(30);
  const [types, setTypes] = React.useState<Set<EventType>>(new Set(["action", "screen", "export", "ai", "login"]));
  const [data, setData] = React.useState<ActivityResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notFound, setNotFound] = React.useState(false);

  // Al entrar, preseleccionar a Carlos Arrascaeta si existe. El buscador queda
  // igual disponible para auditar a cualquier otro usuario.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await platformFetch<{ items: UserSearchRow[] }>(`/platform/user-activity/search?q=${encodeURIComponent("ARRASCAETA")}`);
        if (!cancelled && res.items.length > 0) setSelectedUserId(res.items[0].userId);
      } catch { /* si falla, el usuario elige a mano */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = React.useCallback(async () => {
    if (!selectedUserId) { setData(null); return; }
    setLoading(true); setError(null); setNotFound(false);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
      const sp = new URLSearchParams({
        userId: selectedUserId,
        from: from.toISOString(),
        to: to.toISOString(),
        types: Array.from(types).join(","),
        limit: "600",
      });
      const res = await platformFetch<ActivityResult>(`/platform/user-activity?${sp.toString()}`);
      setData(res);
    } catch (e: any) {
      if (e?.status === 404) setNotFound(true);
      else setError(e?.message ?? "Error al cargar la actividad");
    } finally {
      setLoading(false);
    }
  }, [selectedUserId, days, types]);

  React.useEffect(() => { load(); }, [load]);

  const toggleType = (t: EventType) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      // No permitir dejar la lista sin ningún tipo.
      return next.size === 0 ? prev : next;
    });
  };

  const u = data?.user ?? null;

  return (
    <div className="space-y-5">
      <PageHeader icon={Fingerprint} title="Auditoría de usuario" onReload={load}>
        <div className="flex items-center gap-1">
          {WINDOW_OPTIONS.map((opt) => (
            <button key={opt.days} onClick={() => setDays(opt.days)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
                days === opt.days ? "bg-accent/15 border-accent/30 text-accent" : "bg-fg/5 border-fg/10 text-text-industrial hover:border-accent/30"
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </PageHeader>

      <UserPicker onPick={(picked) => setSelectedUserId(picked.userId)} current={u} />

      {notFound && (
        <div className="text-center py-16 text-text-industrial/40 text-sm">Usuario no encontrado.</div>
      )}

      {!selectedUserId && !notFound && (
        <div className="text-center py-16 text-text-industrial/30 text-sm">
          Buscá un usuario arriba para ver todo lo que hace en el sistema.
        </div>
      )}

      {u && (
        <>
          {/* ── Ficha de identidad ── */}
          <div className="rounded-xl border border-border bg-fg/[0.02] p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-base font-bold text-fg">{u.fullName ?? u.legacyUserId ?? u.email}</div>
                <div className="text-xs text-text-industrial/60 font-mono mt-0.5">
                  {u.legacyUserId ? `usuario: ${u.legacyUserId} · ` : ""}{u.email}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {u.memberships.map((m, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full border border-accent/20 bg-accent/5 text-accent">
                      {m.tenantSlug} · {m.role}{m.membershipStatus !== "ACTIVE" ? ` (${m.membershipStatus})` : ""}
                    </span>
                  ))}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${u.status === "ACTIVE" ? "border-success/25 bg-success/10 text-success" : "border-fg/15 bg-fg/5 text-text-industrial/60"}`}>
                    {u.status}
                  </span>
                </div>
              </div>
              <div className="text-right text-xs text-text-industrial/60 leading-relaxed">
                <div>Última señal: <span className="text-fg/80">{u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString("es-AR") : "—"}</span></div>
                <div>Última IP: <span className="font-mono text-fg/70">{u.lastIp ?? "—"}</span></div>
                <div>Alta: <span className="text-fg/60">{new Date(u.createdAt).toLocaleDateString("es-AR")}</span></div>
              </div>
            </div>
          </div>

          {/* ── Alertas de robo de información ── */}
          <section className="space-y-2">
            <h3 className="text-sm font-bold text-fg flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-danger" />
              Señales de riesgo
              <span className="text-xs font-normal text-text-industrial/40">
                · {data?.alerts.totalRequests ?? 0} acciones en {WINDOW_OPTIONS.find((o) => o.days === days)?.label}
              </span>
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(data?.alerts.items ?? []).map((a) => {
                const meta = ALERT_META[a.key];
                const Icon = meta.icon;
                return (
                  <div key={a.key} className={`rounded-xl border p-3 ${SEV_CLASS[a.severity]}`} title={meta.hint}>
                    <div className="flex items-center gap-1.5 text-[11px] opacity-80">
                      <Icon className="w-3.5 h-3.5" /> {meta.label}
                    </div>
                    <div className="text-2xl font-bold mt-1 tabular-nums">{meta.fmt(a.value)}</div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-text-industrial/40">
              Los colores son una guía (ámbar = mirar, rojo = revisar), no una acusación. El detalle está en la línea de tiempo.
            </p>
          </section>

          {/* ── Línea de tiempo ── */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-fg">Todo lo que hizo</h3>
              <div className="flex flex-wrap items-center gap-1">
                {TYPE_CHIPS.map((c) => (
                  <button key={c.type} onClick={() => toggleType(c.type)}
                    className={`px-2 py-1 rounded-lg border text-[11px] transition-all ${
                      types.has(c.type) ? "bg-accent/15 border-accent/30 text-accent" : "bg-fg/5 border-fg/10 text-text-industrial/50 hover:border-accent/30"
                    }`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {data?.truncated && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Se muestran los eventos más recientes del período. Acortá la ventana de tiempo para ver el resto.
              </p>
            )}

            <DataTable
              columns={EVENT_COLS}
              data={data?.events ?? null}
              loading={loading && data === null}
              error={error}
              keyFn={(r) => r.id}
              emptyText="Sin actividad registrada en este período."
            />
          </section>
        </>
      )}
    </div>
  );
};
