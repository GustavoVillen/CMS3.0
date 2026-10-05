import React from "react";
import { Download, Wrench } from "lucide-react";
import { platformFetch, platformAuthedFetch } from "../../lib/platform-auth";
import { DataTable, type Column } from "../../components/DataTable";
import { PageIntro, Card, KpiCard, KpiRow, BarList, FilterBar, FilterField, Segmented, EmptyState, inputCls } from "../../components/platform/PlatformUi";
import { featureLabel, FEATURE_OPTIONS, screenLabel, fmtWhen, fmtUsd, fmtBytes, fmtInt } from "../../lib/platform-labels";

type Kind = "ai_call" | "http_request";

interface UsageEvent {
  id: string;
  createdAt: string;
  tenantSlug: string;
  userEmail: string;
  vesselCode: string | null;
  kind: Kind;
  feature: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  route: string | null;
  method: string | null;
  statusCode: number | null;
  bytesIn: number;
  bytesOut: number;
  latencyMs: number | null;
  errored: boolean;
}
interface ListResponse { items: UsageEvent[]; total: number; }

interface Summary {
  totals: { events: number; costUsd: number; bytes: number; users: number };
  byDay: Array<{ day: string; events: number; costUsd: number; bytes: number }>;
  byUser: Array<{ tenantSlug: string; tenantName: string | null; userEmail: string; userName: string | null; events: number; costUsd: number; bytes: number }>;
  byFeature: Array<{ feature: string | null; events: number; costUsd: number; bytes: number }>;
  byVessel: Array<{ tenantSlug: string; tenantName: string | null; vesselCode: string | null; vesselName: string | null; events: number; costUsd: number; bytes: number }>;
  truncated?: boolean;
}

// Fila de la lista: un evento suelto o varios del mismo minuto, persona y función.
interface Row {
  id: string;
  createdAt: string;
  tenantSlug: string;
  userEmail: string;
  vesselCode: string | null;
  feature: string | null;
  screen: string;
  model: string | null;
  count: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  bytes: number;
  latencyMs: number | null;
  method: string | null;
  statusCode: number | null;
  route: string | null;
}

const PERIODS = [
  { value: "month", label: "Este mes" },
  { value: "lastMonth", label: "Mes pasado" },
  { value: "7d", label: "Últimos 7 días" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "custom", label: "Elegir fechas…" },
] as const;
type Period = typeof PERIODS[number]["value"];

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDay = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

/** Rango [desde, hasta] (días completos) del período elegido. */
function rangeOf(period: Period, cFrom: string, cTo: string): { from: Date | null; to: Date } {
  const today = startOfDay(new Date());
  if (period === "month") return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: today };
  if (period === "lastMonth") return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 0) };
  if (period === "7d") return { from: new Date(today.getTime() - 6 * DAY_MS), to: today };
  if (period === "30d") return { from: new Date(today.getTime() - 29 * DAY_MS), to: today };
  return { from: cFrom ? parseDay(cFrom) : null, to: cTo ? parseDay(cTo) : today };
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const fmtDM = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;

// ── Gráfico de barras por día (HTML/CSS) ─────────────────────────────────────

function DayChart({ days, metric }: { days: Array<{ date: Date; cost: number; uses: number; bytes: number }>; metric: "cost" | "uses" | "bytes" }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const val = (d: typeof days[number]) => (metric === "cost" ? d.cost : metric === "uses" ? d.uses : d.bytes);
  const fmt = (v: number) => (metric === "cost" ? fmtUsd(v) : metric === "uses" ? fmtInt(Math.round(v)) : fmtBytes(v));
  const max = Math.max(...days.map(val), 0);
  const top = max > 0 ? max : 1;
  const n = days.length;
  const hasWeekend = days.some((d) => d.date.getDay() === 0 || d.date.getDay() === 6);
  const labelIdx = n <= 5 ? days.map((_, i) => i) : Array.from(new Set([0, 1, 2, 3, 4].map((k) => Math.round((k * (n - 1)) / 4))));
  const tickCls = "text-[11px] text-text-industrial/50";

  return (
    <div className="px-4 pb-4">
      <div className="flex gap-2">
        <div className={`relative w-14 shrink-0 h-40 ${tickCls}`}>
          <span className="absolute right-0 top-0 -translate-y-1/2">{fmt(top)}</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2">{fmt(top / 2)}</span>
          <span className="absolute right-0 bottom-0 translate-y-1/2">{fmt(0)}</span>
        </div>
        <div className="relative flex-1 min-w-0">
          <div className="relative h-40 border-b border-fg/15">
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-fg/10" />
            <div className="absolute inset-0 flex gap-[2px]">
              {days.map((d, i) => {
                const v = val(d);
                const weekend = d.date.getDay() === 0 || d.date.getDay() === 6;
                return (
                  <div key={i} className="relative flex-1 h-full flex items-end justify-center" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                    <div className="w-full max-w-[56px] rounded-t-[4px] bg-accent" style={{ height: `${(v / top) * 100}%`, opacity: weekend ? 0.45 : 1, minHeight: v > 0 ? 2 : 0 }} />
                    {hover === i && (
                      <div className="absolute z-10 bottom-full mb-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-fg/10 bg-surface px-2.5 py-1.5 text-xs shadow-lg pointer-events-none"
                        style={i < 3 ? { left: 0, transform: "none" } : i > n - 4 ? { left: "auto", right: 0, transform: "none" } : undefined}>
                        <div className="font-semibold text-fg capitalize">{WEEKDAYS[d.date.getDay()]} {fmtDM(d.date)}</div>
                        {metric === "bytes"
                          ? <div className="text-text-industrial/70">{fmtBytes(d.bytes)}</div>
                          : <div className="text-text-industrial/70">{fmtUsd(d.cost)} · {fmtInt(d.uses)} {d.uses === 1 ? "uso" : "usos"}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="relative h-5 mt-1">
            {labelIdx.map((i) => (
              <span key={i} className={`absolute ${tickCls} whitespace-nowrap`}
                style={{ left: `${((i + 0.5) / n) * 100}%`, transform: i === 0 ? "none" : i === n - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>
                {fmtDM(days[i].date)}
              </span>
            ))}
          </div>
        </div>
      </div>
      {hasWeekend && <p className="text-xs text-text-industrial/50 mt-1">Las barras más claras son sábados y domingos.</p>}
    </div>
  );
}

const Dash = () => <span className="text-text-industrial/30">—</span>;

export const PlatformUsagePage: React.FC = () => {
  const [kind, setKind] = React.useState<Kind>("ai_call");
  const [period, setPeriod] = React.useState<Period>("month");
  const [cFrom, setCFrom] = React.useState("");
  const [cTo, setCTo] = React.useState("");
  const [tenantSlug, setTenantSlug] = React.useState("");
  const [userEmail, setUserEmail] = React.useState("");
  const [feature, setFeature] = React.useState("");
  const [technical, setTechnical] = React.useState(false);
  const [metric, setMetric] = React.useState<"cost" | "uses">("cost");

  const [data, setData] = React.useState<ListResponse | null>(null);
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Opciones de los desplegables: se guardan cuando el filtro correspondiente
  // está en «Todas», así la lista no se achica al elegir una.
  const [tenantOpts, setTenantOpts] = React.useState<Array<{ slug: string; name: string }>>([]);
  const [personOpts, setPersonOpts] = React.useState<Array<{ email: string; name: string }>>([]);

  // Nombres de personas: los de la lista de usuarios de cada empresa (incluye
  // miembros sin login) y los que ya trae el resumen.
  const [userNames, setUserNames] = React.useState<Map<string, string>>(new Map());
  const tenantUsersCacheRef = React.useRef<Map<string, Map<string, string>>>(new Map());

  React.useEffect(() => {
    if (!data) return;
    const slugs = Array.from(new Set(data.items.map((i) => i.tenantSlug)));
    const missing = slugs.filter((s) => !tenantUsersCacheRef.current.has(s));
    const combine = () => {
      const combined = new Map<string, string>();
      for (const s of slugs) {
        const m = tenantUsersCacheRef.current.get(s);
        if (m) for (const [k, v] of m) combined.set(k, v);
      }
      setUserNames(combined);
    };
    if (missing.length === 0) { combine(); return; }
    void (async () => {
      await Promise.all(missing.map(async (slug) => {
        try {
          const res = await platformFetch<{ items: Array<{ email: string; firstName?: string | null; lastName?: string | null }> }>(`/platform/tenants/${slug}/users`);
          const m = new Map<string, string>();
          for (const u of res.items) {
            const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
            if (name) m.set(u.email, name);
          }
          tenantUsersCacheRef.current.set(slug, m);
        } catch {
          tenantUsersCacheRef.current.set(slug, new Map());
        }
      }));
      combine();
    })();
  }, [data]);

  const summaryNames = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const u of summary?.byUser ?? []) if (u.userName) m.set(u.userEmail, u.userName);
    return m;
  }, [summary]);
  const nameOf = React.useCallback((email: string) => summaryNames.get(email) ?? userNames.get(email) ?? email, [summaryNames, userNames]);

  const vesselNames = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const v of summary?.byVessel ?? []) if (v.vesselCode && v.vesselName) m.set(`${v.tenantSlug}|${v.vesselCode}`, v.vesselName);
    return m;
  }, [summary]);

  const range = React.useMemo(() => rangeOf(period, cFrom, cTo), [period, cFrom, cTo]);
  const rangeFromMs = range.from?.getTime() ?? null;
  const rangeToMs = range.to.getTime();

  const buildQuery = React.useCallback((extra: Record<string, string | number> = {}): string => {
    const sp = new URLSearchParams();
    sp.set("kind", kind);
    if (tenantSlug) sp.set("tenantSlug", tenantSlug);
    if (userEmail) sp.set("userEmail", userEmail);
    if (feature && kind === "ai_call") sp.set("feature", feature);
    if (rangeFromMs != null) sp.set("from", new Date(rangeFromMs).toISOString());
    const end = new Date(rangeToMs); end.setHours(23, 59, 59, 999);
    sp.set("to", end.toISOString());
    for (const [k, v] of Object.entries(extra)) sp.set(k, String(v));
    return sp.toString();
  }, [kind, tenantSlug, userEmail, feature, rangeFromMs, rangeToMs]);

  const reload = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [list, sum] = await Promise.all([
        platformFetch<ListResponse>(`/platform/usage?${buildQuery({ limit: 1000 })}`),
        platformFetch<Summary>(`/platform/usage/summary?${buildQuery()}`),
      ]);
      setData(list);
      setSummary(sum);
    } catch (e: any) {
      setError(e.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);
  React.useEffect(() => { void reload(); }, [reload]);

  React.useEffect(() => {
    if (!summary) return;
    if (!tenantSlug) {
      const m = new Map<string, string>();
      for (const u of summary.byUser) m.set(u.tenantSlug, u.tenantName ?? u.tenantSlug);
      setTenantOpts(Array.from(m, ([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name, "es")));
    }
    if (!userEmail) {
      setPersonOpts(summary.byUser.map((u) => ({ email: u.userEmail, name: u.userName ?? u.userEmail })).sort((a, b) => a.name.localeCompare(b.name, "es")));
    }
  }, [summary, tenantSlug, userEmail]);

  // Al cambiar de pestaña la función no aplica a satelital.
  const changeKind = (k: Kind) => { setKind(k); if (k !== "ai_call") setFeature(""); };

  const exportXlsx = React.useCallback(async () => {
    const res = await platformAuthedFetch(`/platform/usage.xlsx?${buildQuery()}`, { method: "GET" });
    if (!res.ok) { alert("No se pudo descargar el Excel. Probá de nuevo."); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `consumo-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [buildQuery]);

  // ── Datos del gráfico: todos los días del rango, con 0 donde no hubo uso ──
  const days = React.useMemo(() => {
    const map = new Map((summary?.byDay ?? []).map((d) => [d.day.slice(0, 10), d]));
    let start = rangeFromMs != null ? new Date(rangeFromMs) : null;
    if (!start) {
      const first = [...map.keys()].sort()[0];
      start = first ? parseDay(first) : new Date(rangeToMs);
    }
    const out: Array<{ date: Date; cost: number; uses: number; bytes: number }> = [];
    for (let d = new Date(start); d.getTime() <= rangeToMs && out.length < 400; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const r = map.get(ymd(d));
      out.push({ date: new Date(d), cost: r?.costUsd ?? 0, uses: r?.events ?? 0, bytes: r?.bytes ?? 0 });
    }
    return out;
  }, [summary, rangeFromMs, rangeToMs]);

  // ── Filas de la lista ──
  const rows = React.useMemo<Row[]>(() => {
    const items = data?.items ?? [];
    const toRow = (it: UsageEvent, id: string, createdAt: string): Row => ({
      id, createdAt, tenantSlug: it.tenantSlug, userEmail: it.userEmail, vesselCode: it.vesselCode,
      feature: it.feature, screen: screenLabel(it.route), model: it.model, count: 0, costUsd: 0,
      inputTokens: 0, outputTokens: 0, bytes: 0, latencyMs: it.latencyMs, method: it.method, statusCode: it.statusCode, route: it.route,
    });
    if (technical) {
      return items.map((it) => {
        const r = toRow(it, it.id, it.createdAt);
        r.count = 1; r.costUsd = it.costUsd; r.inputTokens = it.inputTokens; r.outputTokens = it.outputTokens; r.bytes = it.bytesIn + it.bytesOut;
        return r;
      });
    }
    const buckets = new Map<string, Row>();
    for (const it of items) {
      const d = new Date(it.createdAt); d.setSeconds(0, 0);
      const minute = d.toISOString();
      const what = kind === "ai_call" ? (it.feature ?? "") : screenLabel(it.route);
      const key = `${minute}|${it.tenantSlug}|${it.userEmail}|${what}`;
      let b = buckets.get(key);
      if (!b) { b = toRow(it, key, minute); buckets.set(key, b); }
      b.count += 1; b.costUsd += it.costUsd; b.bytes += it.bytesIn + it.bytesOut;
    }
    return [...buckets.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [data, technical, kind]);

  const vesselOf = (r: Row) => (r.vesselCode ? vesselNames.get(`${r.tenantSlug}|${r.vesselCode}`) ?? r.vesselCode : null);

  const columns = React.useMemo<Column<Row>[]>(() => {
    const cuando: Column<Row> = { key: "createdAt", header: "Cuándo", filterValue: (r) => fmtWhen(r.createdAt), render: (r) => <span className="text-sm text-text-industrial/70 whitespace-nowrap">{fmtWhen(r.createdAt)}</span> };
    const persona: Column<Row> = { key: "userEmail", header: "Persona", mobileTitle: true, filterValue: (r) => nameOf(r.userEmail), render: (r) => <span className="text-sm text-fg truncate block max-w-[220px]">{nameOf(r.userEmail)}</span> };
    const cols: Column<Row>[] = [cuando, persona];
    if (kind === "ai_call") {
      cols.push({
        key: "feature", header: "Función", filterValue: (r) => featureLabel(r.feature),
        render: (r) => <span className="text-sm text-fg/80">{featureLabel(r.feature)}{r.count > 1 && <span className="text-text-industrial/50"> · {r.count} veces</span>}</span>,
      });
      cols.push({ key: "vessel", header: "Buque", filterValue: (r) => vesselOf(r) ?? "", render: (r) => { const v = vesselOf(r); return v ? <span className="text-sm text-text-industrial/80">{v}</span> : <Dash />; } });
      cols.push({ key: "costUsd", header: "Costo", render: (r) => <span className="text-sm text-fg whitespace-nowrap">{fmtUsd(r.costUsd)}</span> });
      if (technical) {
        cols.push({ key: "model", header: "Modelo de IA", mobileHidden: true, render: (r) => <span className="text-xs text-text-industrial/60">{r.model ?? "—"}</span> });
        cols.push({ key: "inputTokens", header: "Texto enviado", mobileHidden: true, render: (r) => <span className="text-xs text-text-industrial/60">{fmtInt(r.inputTokens)}</span> });
        cols.push({ key: "outputTokens", header: "Texto recibido", mobileHidden: true, render: (r) => <span className="text-xs text-text-industrial/60">{fmtInt(r.outputTokens)}</span> });
        cols.push({ key: "latencyMs", header: "Demora", mobileHidden: true, render: (r) => <span className="text-xs text-text-industrial/60">{r.latencyMs != null ? `${(r.latencyMs / 1000).toFixed(1).replace(".", ",")} s` : "—"}</span> });
      }
    } else {
      cols.push({
        key: "screen", header: "Pantalla", filterValue: (r) => r.screen,
        render: (r) => <span className="text-sm text-fg/80">{r.screen}{r.count > 1 && <span className="text-text-industrial/50"> · {r.count} veces</span>}</span>,
      });
      cols.push({ key: "bytes", header: "Datos", render: (r) => <span className="text-sm text-fg whitespace-nowrap">{fmtBytes(r.bytes)}</span> });
      if (technical) {
        cols.push({ key: "method", header: "Método", mobileHidden: true, render: (r) => <span className="text-xs text-text-industrial/60">{r.method ?? "—"}</span> });
        cols.push({ key: "route", header: "Ruta", mobileHidden: true, render: (r) => <span className="text-xs text-text-industrial/60 truncate block max-w-[260px]" title={r.route ?? ""}>{r.route ?? "—"}</span> });
        cols.push({ key: "statusCode", header: "Resultado", mobileHidden: true, render: (r) => <span className="text-xs text-text-industrial/60">{r.statusCode ?? "—"}</span> });
      }
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, technical, nameOf, vesselNames]);

  // ── Resúmenes ──
  const totals = summary?.totals;
  const ai = kind === "ai_call";
  const num = (x: { costUsd: number; bytes: number }) => (ai ? x.costUsd : x.bytes);
  const fmtNum = (v: number) => (ai ? fmtUsd(v) : fmtBytes(v));
  const nDays = Math.max(days.length, 1);

  const topFeature = React.useMemo(() => [...(summary?.byFeature ?? [])].sort((a, b) => b.costUsd - a.costUsd)[0], [summary]);
  const topVessel = React.useMemo(() => [...(summary?.byVessel ?? [])].sort((a, b) => b.bytes - a.bytes)[0], [summary]);

  const personItems = React.useMemo(() => {
    const list = [...(summary?.byUser ?? [])].sort((a, b) => num(b) - num(a));
    return list.map((u) => ({
      key: `${u.tenantSlug}|${u.userEmail}`,
      label: u.userName ?? u.userEmail,
      detail: ai ? `${u.tenantName ?? u.tenantSlug} · ${fmtInt(u.events)} ${u.events === 1 ? "uso" : "usos"}` : (u.tenantName ?? u.tenantSlug),
      value: num(u),
      valueText: fmtNum(num(u)),
      onClick: () => setUserEmail(u.userEmail),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, ai]);

  const featureItems = React.useMemo(() => {
    const list = [...(summary?.byFeature ?? [])].sort((a, b) => b.costUsd - a.costUsd);
    const top = list.slice(0, 8).map((f) => ({
      key: f.feature ?? "-", label: featureLabel(f.feature), detail: `${fmtInt(f.events)} ${f.events === 1 ? "uso" : "usos"}`, value: f.costUsd, valueText: fmtUsd(f.costUsd),
      onClick: () => f.feature && setFeature(f.feature),
    }));
    const rest = list.slice(8);
    if (rest.length > 0) {
      const c = rest.reduce((s, f) => s + f.costUsd, 0);
      const e = rest.reduce((s, f) => s + f.events, 0);
      top.push({ key: "__otras", label: `Otras (${rest.length} funciones)`, detail: `${fmtInt(e)} usos`, value: c, valueText: fmtUsd(c), onClick: undefined as unknown as () => void });
    }
    return top;
  }, [summary]);

  const vesselItems = React.useMemo(() =>
    [...(summary?.byVessel ?? [])].sort((a, b) => b.bytes - a.bytes).map((v) => ({
      key: `${v.tenantSlug}|${v.vesselCode ?? ""}`,
      label: v.vesselName ?? v.vesselCode ?? "Oficina / sin buque",
      detail: v.tenantName ?? v.tenantSlug,
      value: v.bytes,
      valueText: fmtBytes(v.bytes),
    })), [summary]);

  const periodText = period === "custom" ? "las fechas elegidas" : (PERIODS.find((p) => p.value === period)?.label ?? "").toLowerCase();
  const empty = !loading && !error && (totals?.events ?? 0) === 0;

  return (
    <div>
      <PageIntro
        title="Consumo de IA"
        description="Cuánto se usó la inteligencia artificial y los datos por satélite, quién los usó y en qué."
        actions={
          <>
            <button onClick={() => setTechnical((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 md:py-1.5 rounded-lg border text-sm transition-all ${technical ? "bg-accent/10 border-accent/30 text-accent font-semibold" : "bg-fg/5 border-fg/10 text-text-industrial hover:border-accent/30"}`}>
              <Wrench className="w-4 h-4" /> Ver detalle técnico
            </button>
            <button onClick={exportXlsx} className="inline-flex items-center gap-1.5 px-3 py-2 md:py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-sm text-text-industrial hover:border-accent/30 transition-all">
              <Download className="w-4 h-4 text-accent" /> Descargar Excel
            </button>
          </>
        }
      />

      <div className="mb-3">
        <Segmented value={kind} onChange={changeKind} options={[{ value: "ai_call", label: "Inteligencia artificial" }, { value: "http_request", label: "Datos por satélite" }]} />
      </div>

      <FilterBar>
        <FilterField label="Período">
          <select className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </FilterField>
        {period === "custom" && (
          <>
            <FilterField label="Desde"><input type="date" className={inputCls} value={cFrom} onChange={(e) => setCFrom(e.target.value)} /></FilterField>
            <FilterField label="Hasta"><input type="date" className={inputCls} value={cTo} onChange={(e) => setCTo(e.target.value)} /></FilterField>
          </>
        )}
        <FilterField label="Empresa">
          <select className={inputCls} value={tenantSlug} onChange={(e) => { setTenantSlug(e.target.value); setUserEmail(""); }}>
            <option value="">Todas</option>
            {tenantOpts.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Persona">
          <select className={inputCls} value={userEmail} onChange={(e) => setUserEmail(e.target.value)}>
            <option value="">Todas</option>
            {userEmail && !personOpts.some((p) => p.email === userEmail) && <option value={userEmail}>{nameOf(userEmail)}</option>}
            {personOpts.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select>
        </FilterField>
        {ai && (
          <FilterField label="Función">
            <select className={inputCls} value={feature} onChange={(e) => setFeature(e.target.value)}>
              <option value="">Todas</option>
              {FEATURE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </FilterField>
        )}
      </FilterBar>

      {error && <p className="text-sm text-danger mb-3">No se pudo cargar el consumo: {error}</p>}

      {empty ? (
        <Card><EmptyState title="Sin consumo en este período" text="Probá con otro período o sacá algún filtro para ver más datos." /></Card>
      ) : (
        <>
          {ai ? (
            <KpiRow>
              <KpiCard label="Gasto del período" value={fmtUsd(totals?.costUsd)} hint={`promedio ${fmtUsd((totals?.costUsd ?? 0) / nDays)} por día`} />
              <KpiCard label="Veces que se usó" value={fmtInt(totals?.events)} hint={`por ${fmtInt(totals?.users)} ${totals?.users === 1 ? "persona" : "personas"}`} />
              <KpiCard label="Lo que más gastó" value={topFeature ? featureLabel(topFeature.feature) : "—"}
                hint={topFeature && totals && totals.costUsd > 0 ? `${fmtUsd(topFeature.costUsd)} · ${Math.round((topFeature.costUsd / totals.costUsd) * 100)}% del total` : undefined} />
            </KpiRow>
          ) : (
            <KpiRow>
              <KpiCard label="Datos usados" value={fmtBytes(totals?.bytes)} hint={`en ${periodText}`} />
              <KpiCard label="Buque que más usó" value={topVessel ? (topVessel.vesselName ?? topVessel.vesselCode ?? "Oficina / sin buque") : "—"}
                hint={topVessel ? fmtBytes(topVessel.bytes) : undefined} />
            </KpiRow>
          )}

          {!ai && (
            <Card title="Por buque" className="mb-4">
              <BarList items={vesselItems} />
            </Card>
          )}

          <Card title="Por día" className="mb-4"
            actions={ai ? <Segmented value={metric} onChange={setMetric} options={[{ value: "cost", label: "Gasto" }, { value: "uses", label: "Veces que se usó" }]} /> : undefined}>
            <DayChart days={days} metric={ai ? metric : "bytes"} />
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <Card title="Por persona" subtitle="Tocá una persona para filtrar por ella.">
              <BarList items={personItems} />
            </Card>
            {ai && (
              <Card title="Por función">
                <BarList items={featureItems} />
              </Card>
            )}
          </div>
        </>
      )}

      <Card title="Detalle de usos" subtitle={summary?.truncated ? "El resumen de arriba es parcial: el período tiene muchísimos registros. Achicá el período para verlo completo." : undefined}>
        <div className="px-1 pb-2">
          <DataTable
            columns={columns}
            data={loading ? null : rows}
            loading={loading}
            error={error}
            keyFn={(r) => r.id}
            emptyText="Sin usos en este período"
            mobileCards
          />
        </div>
      </Card>
    </div>
  );
};
