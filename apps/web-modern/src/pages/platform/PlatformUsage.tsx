import React from "react";
import { Activity, Download, LineChart as LineChartIcon, X } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { platformFetch, platformAuthedFetch } from "../../lib/platform-auth";
import { DataTable, type Column } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";

interface UsageEvent {
  id: string;
  createdAt: string;
  tenantSlug: string;
  userEmail: string;
  vesselCode: string | null;
  kind: "ai_call" | "http_request";
  feature: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  route: string | null;
  method: string | null;
  statusCode: number | null;
  bytesIn: number;
  bytesOut: number;
  latencyMs: number | null;
  errored: boolean;
  ipAddress: string | null;
}

interface ListResponse { items: UsageEvent[]; total: number; }

function fmtKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtTok(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtUsd(n: number): string {
  if (n === 0) return "—";
  if (n < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(4)}`;
}

// ── Aggregation by minute ────────────────────────────────────────────────────
// One bucket per (minute, tenant, user, [feature|route]) combination.

interface AggregatedRow {
  id: string;              // synthetic key for React
  createdAt: string;       // ISO of the bucket minute (truncated)
  tenantSlug: string;
  userEmail: string;
  vesselCode: string | null;
  kind: "ai_call" | "http_request";
  feature: string | null;
  model: string | null;
  route: string | null;
  method: string | null;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  bytesIn: number;
  bytesOut: number;
  latencyMs: number | null; // average
  errored: boolean;         // true if any in the bucket errored
  statusCode: number | null;
  ipAddress: string | null; // last IP seen in the bucket (typically only one per user-minute)
}

function truncateToMinute(iso: string): string {
  const d = new Date(iso);
  d.setSeconds(0, 0);
  return d.toISOString();
}

function aggregateByMinute(items: UsageEvent[]): AggregatedRow[] {
  const buckets = new Map<string, AggregatedRow & { _latencySum: number; _latencyCount: number }>();

  for (const it of items) {
    const minute = truncateToMinute(it.createdAt);
    // Different keys per kind to keep aggregation meaningful:
    //   AI  : minute + tenant + user + feature + model
    //   HTTP: minute + tenant + user (one row per user-minute — route/method
    //         omitted on purpose; use "Sin agrupar" to drill into endpoints)
    const key = it.kind === "ai_call"
      ? `${minute}|${it.tenantSlug}|${it.userEmail}|${it.feature ?? ""}|${it.model ?? ""}`
      : `${minute}|${it.tenantSlug}|${it.userEmail}`;

    let b = buckets.get(key);
    if (!b) {
      b = {
        id: key,
        createdAt: minute,
        tenantSlug: it.tenantSlug,
        userEmail: it.userEmail,
        vesselCode: it.vesselCode,
        kind: it.kind,
        feature: it.feature,
        model: it.model,
        route: it.route,
        method: it.method,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        bytesIn: 0,
        bytesOut: 0,
        latencyMs: 0,
        errored: false,
        statusCode: it.statusCode,
        ipAddress: it.ipAddress,
        _latencySum: 0,
        _latencyCount: 0,
      };
      buckets.set(key, b);
    }
    if (it.ipAddress) b.ipAddress = it.ipAddress;
    b.requests += 1;
    b.inputTokens += it.inputTokens;
    b.outputTokens += it.outputTokens;
    b.cacheReadTokens += it.cacheReadTokens;
    b.cacheCreationTokens += it.cacheCreationTokens;
    b.costUsd += it.costUsd;
    b.bytesIn += it.bytesIn;
    b.bytesOut += it.bytesOut;
    if (it.errored) b.errored = true;
    if (it.latencyMs != null) {
      b._latencySum += it.latencyMs;
      b._latencyCount += 1;
    }
  }

  const out: AggregatedRow[] = [];
  for (const b of buckets.values()) {
    b.latencyMs = b._latencyCount > 0 ? Math.round(b._latencySum / b._latencyCount) : null;
    out.push(b);
  }
  // Most recent minute first
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

// ── Columns ──────────────────────────────────────────────────────────────────

const COMMON_COLS_RAW: Column<UsageEvent>[] = [
  { key: "createdAt",  header: "Fecha",   render: r => <span className="font-mono text-xs text-text-industrial/60">{new Date(r.createdAt).toLocaleString("es-AR")}</span> },
  { key: "tenantSlug", header: "Tenant",  render: r => <span className="font-mono text-accent text-xs">{r.tenantSlug}</span> },
  { key: "userEmail",  header: "Usuario", render: r => <span className="text-xs text-text-industrial/80 truncate block max-w-[200px]" title={r.userEmail}>{r.userEmail}</span> },
  { key: "ipAddress",  header: "IP",      render: r => r.ipAddress ? <span className="font-mono text-[10px] text-text-industrial/60">{r.ipAddress}</span> : <span className="text-text-industrial/20">—</span> },
  { key: "vesselCode", header: "Vessel",  render: r => r.vesselCode ? <span className="font-mono text-xs text-accent/70">{r.vesselCode}</span> : <span className="text-text-industrial/20">—</span> },
];

const AI_COLS_RAW: Column<UsageEvent>[] = [
  ...COMMON_COLS_RAW,
  { key: "feature",      header: "Feature", render: r => <span className="text-xs text-fg/70">{r.feature ?? "—"}</span> },
  { key: "model",        header: "Modelo",  render: r => <span className="font-mono text-[10px] text-text-industrial/50">{r.model ?? "—"}</span> },
  { key: "inputTokens",  header: "Input",   render: r => <span className="font-mono text-xs text-text-industrial/70">{fmtTok(r.inputTokens)}</span> },
  { key: "outputTokens", header: "Output",  render: r => <span className="font-mono text-xs text-text-industrial/70">{fmtTok(r.outputTokens)}</span> },
  { key: "cacheReadTokens", header: "Cache↓", render: r => <span className="font-mono text-[10px] text-text-industrial/40">{r.cacheReadTokens > 0 ? fmtTok(r.cacheReadTokens) : "—"}</span> },
  { key: "costUsd",      header: "Costo",   render: r => <span className="font-mono text-xs text-yellow-700 dark:text-yellow-400/80">{fmtUsd(r.costUsd)}</span> },
  { key: "latencyMs",    header: "Lat.",    render: r => <span className="font-mono text-[10px] text-text-industrial/40">{r.latencyMs != null ? `${r.latencyMs}ms` : "—"}</span> },
  { key: "errored",      header: "",        render: r => r.errored ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" title="Error" /> : null },
];

const HTTP_COLS_RAW: Column<UsageEvent>[] = [
  ...COMMON_COLS_RAW,
  { key: "method",     header: "Mét.",    render: r => <span className="font-mono text-[10px] text-text-industrial/60">{r.method ?? "—"}</span> },
  { key: "route",      header: "Ruta",    render: r => <span className="font-mono text-[10px] text-text-industrial/60 truncate block max-w-[280px]" title={r.route ?? ""}>{r.route ?? "—"}</span> },
  { key: "statusCode", header: "Status",  render: r => <span className={`font-mono text-xs ${r.statusCode && r.statusCode >= 400 ? "text-red-700 dark:text-red-400" : "text-text-industrial/60"}`}>{r.statusCode ?? "—"}</span> },
  { key: "bytesIn",    header: "↑ In",    render: r => <span className="font-mono text-xs text-text-industrial/70">{fmtKb(r.bytesIn)}</span> },
  { key: "bytesOut",   header: "↓ Out",   render: r => <span className="font-mono text-xs text-text-industrial/70">{fmtKb(r.bytesOut)}</span> },
  { key: "latencyMs",  header: "Lat.",    render: r => <span className="font-mono text-[10px] text-text-industrial/40">{r.latencyMs != null ? `${r.latencyMs}ms` : "—"}</span> },
];

const COMMON_COLS_AGG: Column<AggregatedRow>[] = [
  { key: "createdAt",  header: "Minuto",  render: r => <span className="font-mono text-xs text-text-industrial/60">{new Date(r.createdAt).toLocaleString("es-AR", { hour12: false }).replace(/:\d{2}$/, "")}</span> },
  { key: "tenantSlug", header: "Tenant",  render: r => <span className="font-mono text-accent text-xs">{r.tenantSlug}</span> },
  { key: "userEmail",  header: "Usuario", render: r => <span className="text-xs text-text-industrial/80 truncate block max-w-[200px]" title={r.userEmail}>{r.userEmail}</span> },
  { key: "ipAddress",  header: "IP",      render: r => r.ipAddress ? <span className="font-mono text-[10px] text-text-industrial/60">{r.ipAddress}</span> : <span className="text-text-industrial/20">—</span> },
  { key: "vesselCode", header: "Vessel",  render: r => r.vesselCode ? <span className="font-mono text-xs text-accent/70">{r.vesselCode}</span> : <span className="text-text-industrial/20">—</span> },
];

const AI_COLS_AGG: Column<AggregatedRow>[] = [
  ...COMMON_COLS_AGG,
  { key: "feature",      header: "Feature",   render: r => <span className="text-xs text-fg/70">{r.feature ?? "—"}</span> },
  { key: "model",        header: "Modelo",    render: r => <span className="font-mono text-[10px] text-text-industrial/50">{r.model ?? "—"}</span> },
  { key: "requests",     header: "Reqs",      render: r => <span className="font-mono text-xs text-text-industrial/80">{r.requests}</span> },
  { key: "inputTokens",  header: "Input",     render: r => <span className="font-mono text-xs text-text-industrial/70">{fmtTok(r.inputTokens)}</span> },
  { key: "outputTokens", header: "Output",    render: r => <span className="font-mono text-xs text-text-industrial/70">{fmtTok(r.outputTokens)}</span> },
  { key: "cacheReadTokens", header: "Cache↓", render: r => <span className="font-mono text-[10px] text-text-industrial/40">{r.cacheReadTokens > 0 ? fmtTok(r.cacheReadTokens) : "—"}</span> },
  { key: "costUsd",      header: "Costo",     render: r => <span className="font-mono text-xs text-yellow-700 dark:text-yellow-400/80">{fmtUsd(r.costUsd)}</span> },
  { key: "latencyMs",    header: "Lat. avg",  render: r => <span className="font-mono text-[10px] text-text-industrial/40">{r.latencyMs != null ? `${r.latencyMs}ms` : "—"}</span> },
  { key: "errored",      header: "",          render: r => r.errored ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" title="Hubo error en el bucket" /> : null },
];

// Aggregated HTTP view: one row per (minute + tenant + user). Vessel/route/method
// are intentionally omitted — they mix values across many requests. Use the
// "Sin agrupar" toggle to drill into individual endpoints.
const HTTP_COLS_AGG: Column<AggregatedRow>[] = [
  { key: "createdAt",  header: "Minuto",   render: r => <span className="font-mono text-xs text-text-industrial/60">{new Date(r.createdAt).toLocaleString("es-AR", { hour12: false }).replace(/:\d{2}$/, "")}</span> },
  { key: "tenantSlug", header: "Tenant",   render: r => <span className="font-mono text-accent text-xs">{r.tenantSlug}</span> },
  { key: "userEmail",  header: "Usuario",  render: r => <span className="text-xs text-text-industrial/80 truncate block max-w-[260px]" title={r.userEmail}>{r.userEmail}</span> },
  { key: "ipAddress",  header: "IP",       render: r => r.ipAddress ? <span className="font-mono text-[10px] text-text-industrial/60">{r.ipAddress}</span> : <span className="text-text-industrial/20">—</span> },
  { key: "requests",   header: "Reqs",     render: r => <span className="font-mono text-xs text-text-industrial/80">{r.requests}</span> },
  { key: "bytesIn",    header: "↑ In",     render: r => <span className="font-mono text-xs text-text-industrial/70">{fmtKb(r.bytesIn)}</span> },
  { key: "bytesOut",   header: "↓ Out",    render: r => <span className="font-mono text-xs text-text-industrial/70">{fmtKb(r.bytesOut)}</span> },
  { key: "latencyMs",  header: "Lat. avg", render: r => <span className="font-mono text-[10px] text-text-industrial/40">{r.latencyMs != null ? `${r.latencyMs}ms` : "—"}</span> },
];

// ── Chart helpers ────────────────────────────────────────────────────────────
// One line per user. X-axis bucket size auto-selected from the visible time
// span: ≤2h → minute, ≤7d → hour, >7d → day.

type BucketSize = "minute" | "hour" | "day";

function pickBucketSize(items: UsageEvent[]): BucketSize {
  if (items.length < 2) return "minute";
  let min = Infinity, max = -Infinity;
  for (const it of items) {
    const t = new Date(it.createdAt).getTime();
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const spanMs = max - min;
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  if (spanMs <= TWO_HOURS) return "minute";
  if (spanMs <= SEVEN_DAYS) return "hour";
  return "day";
}

function truncateTo(iso: string, bucket: BucketSize): string {
  const d = new Date(iso);
  if (bucket === "minute") d.setSeconds(0, 0);
  else if (bucket === "hour") { d.setMinutes(0, 0, 0); }
  else { d.setHours(0, 0, 0, 0); }
  return d.toISOString();
}

function fmtBucketLabel(iso: string, bucket: BucketSize): string {
  const d = new Date(iso);
  if (bucket === "day") return d.toLocaleDateString("es-AR");
  if (bucket === "hour") return d.toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  return d.toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

interface ChartPoint {
  bucket: string;             // ISO of the bucket (used for sort)
  label: string;              // formatted X-axis label
  [userEmail: string]: number | string;
}

function buildChartSeries(
  items: UsageEvent[],
  metric: "tokens" | "bytes",
): { points: ChartPoint[]; users: string[]; bucket: BucketSize } {
  const bucket = pickBucketSize(items);
  // points keyed by bucket ISO → record of user → metric value
  const grid = new Map<string, Map<string, number>>();
  const users = new Set<string>();

  for (const it of items) {
    const b = truncateTo(it.createdAt, bucket);
    let row = grid.get(b);
    if (!row) { row = new Map(); grid.set(b, row); }
    const value = metric === "tokens"
      ? it.inputTokens + it.outputTokens
      : it.bytesIn + it.bytesOut;
    row.set(it.userEmail, (row.get(it.userEmail) ?? 0) + value);
    users.add(it.userEmail);
  }

  const usersArr = Array.from(users).sort();
  const buckets = Array.from(grid.keys()).sort();
  const points: ChartPoint[] = buckets.map(b => {
    const row = grid.get(b)!;
    const point: ChartPoint = { bucket: b, label: fmtBucketLabel(b, bucket) };
    for (const u of usersArr) {
      point[u] = row.get(u) ?? 0;
    }
    return point;
  });

  return { points, users: usersArr, bucket };
}

// Distinct, accessible color palette — colors stay consistent across renders
const CHART_COLORS = [
  "#fbbf24", "#60a5fa", "#34d399", "#f472b6", "#a78bfa",
  "#fb7185", "#22d3ee", "#facc15", "#4ade80", "#c084fc",
];

const UsageChart: React.FC<{
  items: UsageEvent[];
  kind: "ai_call" | "http_request";
  onClose: () => void;
}> = ({ items, kind, onClose }) => {
  const metric: "tokens" | "bytes" = kind === "ai_call" ? "tokens" : "bytes";
  const { points, users, bucket } = React.useMemo(
    () => buildChartSeries(items, metric),
    [items, metric],
  );

  const yLabel  = kind === "ai_call" ? "Tokens" : "Bytes";
  const fmtY = kind === "ai_call" ? fmtTok : fmtKb;
  const bucketLabel = bucket === "minute" ? "minuto" : bucket === "hour" ? "hora" : "día";

  if (points.length === 0) {
    return (
      <div className="rounded-xl bg-fg/5 border border-fg/10 p-8 text-center text-text-industrial/40 text-sm">
        Sin datos para graficar.
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-fg/3 border border-fg/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-text-industrial/60">
          {yLabel} por usuario · agrupado por <span className="text-fg">{bucketLabel}</span> · {users.length} usuario{users.length === 1 ? "" : "s"}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-fg/10 text-text-industrial/40 hover:text-fg transition-all" title="Cerrar gráfico">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} stroke="rgba(255,255,255,0.2)" />
            <YAxis
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
              stroke="rgba(255,255,255,0.2)"
              tickFormatter={(v: number) => fmtY(v)}
              width={60}
            />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#e2e8f0" }}
              formatter={(value, name) => [fmtY(Number(value)), name]}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }} />
            {users.map((user, i) => (
              <Line
                key={user}
                type="monotone"
                dataKey={user}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const PlatformUsagePage: React.FC = () => {
  const [kind, setKind] = React.useState<"ai_call" | "http_request">("ai_call");
  const [groupBy, setGroupBy] = React.useState<"none" | "minute">("minute");
  const [tenantSlug, setTenantSlug] = React.useState("");
  const [userEmail, setUserEmail]   = React.useState("");
  const [feature, setFeature]       = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo]     = React.useState("");

  const [data, setData] = React.useState<ListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError]     = React.useState<string | null>(null);

  const buildQuery = React.useCallback((extra: Record<string, string | number> = {}): string => {
    const sp = new URLSearchParams();
    sp.set("kind", kind);
    if (tenantSlug.trim()) sp.set("tenantSlug", tenantSlug.trim());
    if (userEmail.trim())  sp.set("userEmail",  userEmail.trim());
    if (feature.trim())    sp.set("feature",    feature.trim());
    if (from)              sp.set("from",       new Date(from).toISOString());
    if (to)                sp.set("to",         new Date(`${to}T23:59:59`).toISOString());
    for (const [k, v] of Object.entries(extra)) sp.set(k, String(v));
    return sp.toString();
  }, [kind, tenantSlug, userEmail, feature, from, to]);

  const reload = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await platformFetch<ListResponse>(`/platform/usage?${buildQuery({ limit: 1000 })}`);
      setData(result);
    } catch (e: any) {
      setError(e.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  React.useEffect(() => { reload(); }, [reload]);

  const exportXlsx = React.useCallback(async () => {
    const res = await platformAuthedFetch(`/platform/usage.xlsx?${buildQuery()}`, { method: "GET" });
    if (!res.ok) { alert("Error al exportar"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `usage-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [buildQuery]);

  const aggregated = React.useMemo<AggregatedRow[]>(() => {
    if (!data) return [];
    return aggregateByMinute(data.items);
  }, [data]);

  const totalInputTok  = data?.items.filter(i => i.kind === "ai_call").reduce((s, i) => s + i.inputTokens, 0)  ?? 0;
  const totalOutputTok = data?.items.filter(i => i.kind === "ai_call").reduce((s, i) => s + i.outputTokens, 0) ?? 0;
  const totalCost      = data?.items.reduce((s, i) => s + i.costUsd, 0) ?? 0;
  const totalIn        = data?.items.reduce((s, i) => s + i.bytesIn, 0)  ?? 0;
  const totalOut       = data?.items.reduce((s, i) => s + i.bytesOut, 0) ?? 0;

  const showingCount = groupBy === "minute" ? aggregated.length : (data?.items.length ?? 0);

  const [showChart, setShowChart] = React.useState(false);
  const chartItems = React.useMemo(
    () => (data?.items ?? []).filter(i => i.kind === kind),
    [data, kind],
  );

  return (
    <div className="space-y-5">
      <PageHeader icon={Activity} title="Consumo IA + Satelital" total={data?.total} onReload={reload}>
        <button onClick={() => setShowChart(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all ${showChart ? "bg-accent/15 border-accent/30 text-accent" : "bg-fg/5 border-fg/10 text-text-industrial hover:border-accent/30"}`}>
          <LineChartIcon className="w-3.5 h-3.5" /> Gráfico
        </button>
        <button onClick={exportXlsx} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <Download className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
      </PageHeader>

      {/* Tabs IA / HTTP */}
      <div className="flex gap-1.5 items-center">
        <button onClick={() => setKind("ai_call")}
          className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${kind === "ai_call" ? "bg-accent/15 border-accent/30 text-accent" : "bg-fg/5 border-fg/10 text-text-industrial/60 hover:border-accent/20"}`}>
          Tokens IA
        </button>
        <button onClick={() => setKind("http_request")}
          className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${kind === "http_request" ? "bg-accent/15 border-accent/30 text-accent" : "bg-fg/5 border-fg/10 text-text-industrial/60 hover:border-accent/20"}`}>
          Bytes Satelital
        </button>

        <span className="ml-4 text-[10px] text-text-industrial/40 uppercase tracking-wider">Agrupar:</span>
        <button onClick={() => setGroupBy("minute")}
          className={`px-2.5 py-1 rounded-md text-[11px] border transition-all ${groupBy === "minute" ? "bg-fg/10 border-fg/20 text-fg" : "bg-transparent border-fg/10 text-text-industrial/50 hover:border-fg/20"}`}>
          Por minuto
        </button>
        <button onClick={() => setGroupBy("none")}
          className={`px-2.5 py-1 rounded-md text-[11px] border transition-all ${groupBy === "none" ? "bg-fg/10 border-fg/20 text-fg" : "bg-transparent border-fg/10 text-text-industrial/50 hover:border-fg/20"}`}>
          Sin agrupar
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-end">
        <input value={tenantSlug} onChange={e => setTenantSlug(e.target.value)} placeholder="Tenant slug…"
          className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 w-32" />
        <input value={userEmail} onChange={e => setUserEmail(e.target.value)} placeholder="Email contiene…"
          className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 w-48" />
        {kind === "ai_call" && (
          <select value={feature} onChange={e => setFeature(e.target.value)}
            className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
            <option value="">Toda feature</option>
            <option value="copiloto">copiloto</option>
            <option value="fluid_analyses">fluid_analyses</option>
          </select>
        )}
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50" />
        <button onClick={reload}
          className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs text-accent hover:bg-accent/20 transition-all">
          Aplicar
        </button>
      </div>

      {/* Resumen */}
      {data && (
        <div className="flex flex-wrap gap-4 text-xs text-text-industrial/60">
          <span>Eventos crudos: <span className="text-fg">{data.total}</span></span>
          {groupBy === "minute" && <span>Filas mostradas: <span className="text-fg">{showingCount}</span></span>}
          {kind === "ai_call" && (
            <>
              <span>Input: <span className="text-fg">{fmtTok(totalInputTok)}</span></span>
              <span>Output: <span className="text-fg">{fmtTok(totalOutputTok)}</span></span>
              <span>Costo: <span className="text-yellow-700 dark:text-yellow-400/80">{fmtUsd(totalCost)}</span></span>
            </>
          )}
          {kind === "http_request" && (
            <>
              <span>Total ↑: <span className="text-fg">{fmtKb(totalIn)}</span></span>
              <span>Total ↓: <span className="text-fg">{fmtKb(totalOut)}</span></span>
            </>
          )}
        </div>
      )}

      {showChart && (
        <UsageChart items={chartItems} kind={kind} onClose={() => setShowChart(false)} />
      )}

      {groupBy === "minute" ? (
        <DataTable
          columns={kind === "ai_call" ? AI_COLS_AGG : HTTP_COLS_AGG}
          data={aggregated.filter(r => r.kind === kind)}
          loading={loading}
          error={error}
          keyFn={r => r.id}
          emptyText="Sin eventos en el rango seleccionado"
        />
      ) : (
        <DataTable
          columns={kind === "ai_call" ? AI_COLS_RAW : HTTP_COLS_RAW}
          data={data?.items ?? null}
          loading={loading}
          error={error}
          keyFn={r => r.id}
          emptyText="Sin eventos en el rango seleccionado"
        />
      )}
    </div>
  );
};
