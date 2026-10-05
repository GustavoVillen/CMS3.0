import React from "react";
import { useNavigate } from "react-router-dom";
import { platformFetch } from "../../lib/platform-auth";
import { PageIntro, Card, KpiCard, KpiRow, BarList, StatusPill, EmptyState } from "../../components/platform/PlatformUi";
import { featureLabel, fmtUsd, fmtWhen, fmtInt } from "../../lib/platform-labels";

interface ActiveUser { userId: string; vesselCode: string | null; vesselName?: string | null }
interface LoginRow {
  id: string; createdAt: string; success: boolean;
  userEmail: string | null; userEmailRedacted?: boolean; userName: string | null; failureReason: string | null;
}
interface UsageSummary { totals: { events: number; costUsd: number }; byFeature: Array<{ feature: string; events: number; costUsd: number }> }
interface TenantRow { slug: string; status: string; userCount?: number }

interface HomeData {
  active: ActiveUser[];
  failedToday: LoginRow[];
  recent: LoginRow[];
  usage: UsageSummary;
  tenants: TenantRow[];
}

const personOf = (r: LoginRow) =>
  r.userName ?? (r.userEmailRedacted ? "Intento anterior al registro de nombres" : r.userEmail ?? "Persona desconocida");

export const PlatformHomePage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = React.useState<HomeData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const now = new Date();
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const [active, failed, recent, usage, tenants] = await Promise.all([
        platformFetch<{ items: ActiveUser[] }>("/platform/access/active?windowMinutes=15"),
        platformFetch<{ items: LoginRow[] }>(`/platform/access/logins?result=failed&limit=200&from=${encodeURIComponent(startToday)}`),
        platformFetch<{ items: LoginRow[] }>("/platform/access/logins?limit=6"),
        platformFetch<UsageSummary>(`/platform/usage/summary?kind=ai_call&from=${encodeURIComponent(startMonth)}`),
        platformFetch<{ items: TenantRow[] }>("/platform/tenants"),
      ]);
      setData({ active: active.items, failedToday: failed.items, recent: recent.items.slice(0, 6), usage, tenants: tenants.items });
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cargar el resumen.");
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const intro = <PageIntro title="Inicio" description="Lo más importante del día, en una mirada. Tocá cualquier tarjeta para ver el detalle." />;

  if (loading && !data) return <div>{intro}<p className="text-sm text-text-industrial/60">Cargando…</p></div>;
  if (error || !data) {
    return (
      <div>{intro}
        <Card><EmptyState title="No se pudo cargar el resumen" text={error ?? "Probá de nuevo en un momento."}
          action={<button onClick={load} className="px-4 py-2 rounded-lg bg-accent/10 border border-accent/25 text-accent text-sm font-semibold">Reintentar</button>} /></Card>
      </div>
    );
  }

  const onVessel = data.active.filter(a => a.vesselCode).length;
  const counts = new Map<string, number>();
  for (const r of data.failedToday) { const n = personOf(r); counts.set(n, (counts.get(n) ?? 0) + 1); }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const failedHint = top ? `${top[0]} fue quien más falló (${top[1]} ${top[1] === 1 ? "vez" : "veces"})` : "Ninguno por ahora";
  const activeTenants = data.tenants.filter(t => t.status === "ACTIVE");
  const totalUsers = data.tenants.reduce((s, t) => s + (t.userCount ?? 0), 0);

  return (
    <div>
      {intro}
      <KpiRow>
        <KpiCard label="Conectados ahora" value={fmtInt(data.active.length)}
          hint={data.active.length ? `${onVessel} ${onVessel === 1 ? "está" : "están"} a bordo de un buque` : "Nadie en los últimos 15 minutos"}
          onClick={() => navigate("/platform/access")} />
        <KpiCard label="Ingresos rechazados hoy" value={fmtInt(data.failedToday.length)} hint={failedHint}
          tone={data.failedToday.length ? "bad" : undefined} onClick={() => navigate("/platform/access")} />
        <KpiCard label="Gasto de IA este mes" value={fmtUsd(data.usage.totals.costUsd)} hint={`${fmtInt(data.usage.totals.events)} usos`}
          onClick={() => navigate("/platform/usage")} />
        <KpiCard label="Empresas activas" value={fmtInt(activeTenants.length)} hint={`${fmtInt(totalUsers)} usuarios en total`}
          onClick={() => navigate("/platform/tenants")} />
      </KpiRow>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Últimos ingresos">
          {data.recent.length === 0 ? (
            <EmptyState title="Todavía no hay ingresos registrados" text="Cuando alguien entre al sistema, aparece acá." />
          ) : (
            <ul className="px-4 pb-3">
              {data.recent.map(r => (
                <li key={r.id} className="flex items-center gap-3 py-2 border-b border-fg/5 last:border-0 text-sm">
                  <span className="text-xs text-text-industrial/50 w-24 shrink-0">{fmtWhen(r.createdAt)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-fg">{personOf(r)}</span>
                  <StatusPill tone={r.success ? "ok" : "bad"}>{r.success ? "Entró" : "Rechazado"}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="En qué se usó la IA este mes">
          <BarList emptyText="Todavía no se usó la IA este mes."
            items={[...data.usage.byFeature].sort((a, b) => b.costUsd - a.costUsd).slice(0, 5).map(f => ({
              key: f.feature, label: featureLabel(f.feature), detail: `${fmtInt(f.events)} usos`, value: f.costUsd, valueText: fmtUsd(f.costUsd),
            }))} />
        </Card>
      </div>
    </div>
  );
};
