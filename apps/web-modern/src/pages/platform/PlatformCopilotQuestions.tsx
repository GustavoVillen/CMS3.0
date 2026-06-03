import React from "react";
import { MessageCircleQuestion, Search, Paperclip } from "lucide-react";
import { platformFetch } from "../../lib/platform-auth";
import { DataTable, type Column } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";

interface CopilotQuestion {
  id: string;
  tenantId: string;
  tenantSlug: string;
  userEmail: string;
  userRole: string;
  capability: string;
  vesselCode: string | null;
  screen: string | null;
  question: string;
  hasAttachment: boolean;
  createdAt: string;
}

interface ListResponse { items: CopilotQuestion[]; total: number; }

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

const COLUMNS: Column<CopilotQuestion>[] = [
  { key: "createdAt",  header: "Fecha",      render: r => <span className="font-mono text-xs text-text-industrial/60 whitespace-nowrap">{new Date(r.createdAt).toLocaleString("es-AR")}</span> },
  { key: "tenantSlug", header: "Tenant",     render: r => <span className="font-mono text-accent text-xs">{r.tenantSlug}</span> },
  { key: "userEmail",  header: "Usuario",    render: r => <div className="text-xs"><div className="text-fg">{r.userEmail}</div><div className="text-text-industrial/40">{r.userRole}</div></div> },
  { key: "screen",     header: "Pantalla",   render: r => <span className="text-xs text-text-industrial/60">{r.screen ?? "—"}</span> },
  { key: "vesselCode", header: "Buque",      render: r => <span className="font-mono text-xs text-text-industrial/60">{r.vesselCode ?? "—"}</span> },
  {
    key: "question", header: "Pregunta",
    render: r => (
      <div className="flex items-start gap-1.5 max-w-[460px]">
        {r.hasAttachment && <Paperclip className="w-3 h-3 text-accent shrink-0 mt-0.5" />}
        <span className="text-xs text-fg whitespace-pre-wrap break-words">{r.question}</span>
      </div>
    ),
  },
];

export const PlatformCopilotQuestionsPage: React.FC = () => {
  const [search, setSearch] = React.useState("");
  const [query, setQuery]   = React.useState("");
  const path = query.trim()
    ? `/platform/copilot-questions?search=${encodeURIComponent(query.trim())}`
    : "/platform/copilot-questions";
  const { data, loading, error, reload } = usePlatformFetch<ListResponse>(path);

  return (
    <div className="space-y-5">
      <PageHeader icon={MessageCircleQuestion} title="Preguntas Copiloto" total={data?.total} onReload={reload}>
        <form
          onSubmit={e => { e.preventDefault(); setQuery(search); }}
          className="relative"
        >
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-industrial/40 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar en preguntas…"
            className="w-72 pl-7 bg-fg/5 border border-border rounded-lg px-3 py-1.5 text-xs text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
          />
          {query && (
            <button type="button" onClick={() => { setSearch(""); setQuery(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-industrial/50 hover:text-fg">limpiar</button>
          )}
        </form>
      </PageHeader>
      {data?.total === 0 && !loading && (
        <div className="text-center py-16 text-text-industrial/20 text-sm">
          {query ? "Sin preguntas que coincidan con la búsqueda" : "Aún no hay preguntas registradas"}
        </div>
      )}
      <DataTable columns={COLUMNS} data={data?.items ?? null} loading={loading} error={error} keyFn={r => r.id} emptyText="Sin preguntas registradas" />
    </div>
  );
};
