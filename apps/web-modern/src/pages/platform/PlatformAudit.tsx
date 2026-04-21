import React from "react";
import { ScrollText } from "lucide-react";
import { platformFetch } from "../../lib/platform-auth";
import { DataTable, type Column } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";

interface AuditEvent {
  id: string;
  tenantId?: string | null;
  tenantSlug?: string | null;
  actorType: string;
  actorUserId?: string | null;
  actorPlatformUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  createdAt: string;
}

interface ListResponse { items: AuditEvent[]; total: number; }

function usePlatformFetch<T>(path: string) {
  const [data, setData]       = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError]     = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await platformFetch<T>(path)); }
    catch (e: any) { setError(e.message ?? "Error"); }
    finally { setLoading(false); }
  }, [path]);
  React.useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

const COLUMNS: Column<AuditEvent>[] = [
  { key: "createdAt",  header: "Fecha",       render: r => <span className="font-mono text-xs text-text-industrial/60">{new Date(r.createdAt).toLocaleString("es-AR")}</span> },
  { key: "tenantSlug", header: "Tenant",      render: r => r.tenantSlug ? <span className="font-mono text-accent text-xs">{r.tenantSlug}</span> : <span className="text-text-industrial/30">platform</span> },
  { key: "actorType",  header: "Actor",       render: r => <span className="text-xs font-bold text-text-industrial/60">{r.actorType}</span> },
  { key: "action",     header: "Acción",      render: r => <span className="font-mono text-xs text-white">{r.action}</span> },
  { key: "entityType", header: "Entidad",     render: r => r.entityType },
  { key: "entityId",   header: "ID Entidad",  render: r => <span className="font-mono text-xs text-text-industrial/40 truncate block max-w-[120px]">{r.entityId ?? "—"}</span> },
];

export const PlatformAuditPage: React.FC = () => {
  const { data, loading, error, reload } = usePlatformFetch<ListResponse>("/platform/audit-events");

  return (
    <div className="space-y-5">
      <PageHeader icon={ScrollText} title="Audit Events" total={data?.total} onReload={reload} />
      {data?.total === 0 && !loading && (
        <div className="text-center py-16 text-text-industrial/20 text-sm">Sin eventos de auditoría registrados</div>
      )}
      <DataTable columns={COLUMNS} data={data?.items ?? null} loading={loading} error={error} keyFn={r => r.id} emptyText="Sin eventos de auditoría" />
    </div>
  );
};
