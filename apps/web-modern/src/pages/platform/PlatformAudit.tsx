import React from "react";
import { platformFetch } from "../../lib/platform-auth";
import { DataTable, type Column } from "../../components/DataTable";
import { PageIntro, StatusPill, FilterBar, FilterField, EmptyState, TwoLines, inputCls } from "../../components/platform/PlatformUi";
import {
  auditActionKind, auditActionLabel, entityLabel, failureLabel, fmtWhen, type Tone,
} from "../../lib/platform-labels";

interface AuditEvent {
  id: string;
  tenantId?: string | null;
  tenantSlug?: string | null;
  tenantName?: string | null;
  actorType: string;
  actorUserId?: string | null;
  actorPlatformUserId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

interface ListResponse { items: AuditEvent[]; total: number; }

const LIMIT = 500;
const CONSOLE = "__console__";
type Kind = "" | "login" | "data" | "config";

const KIND_TONE: Record<string, Tone> = { login_failed: "bad", login: "info", config: "warn", data: "muted" };

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDay(d); };

const personOf = (e: AuditEvent) => e.actorName ?? e.actorEmail ?? (e.actorType === "SYSTEM" ? "Sistema" : "Persona no identificada");
const companyOf = (e: AuditEvent) => e.tenantName ?? e.tenantSlug ?? "Consola";

function kindOf(e: AuditEvent): Exclude<Kind, ""> {
  const k = auditActionKind(e.action);
  return k === "login_failed" ? "login" : k;
}

/**
 * Dato legible del registro afectado: su número (OT-…, SS-…, PTW-…, DEF-…) y,
 * si lo hay, su título. No se muestran códigos de buque ni nombres de quien
 * firmó, que no identifican al registro.
 */
const CODE_KEYS = ["workOrderCode", "serviceRequestCode", "permitCode", "defectCode", "taskCode", "certificateCode", "code"];
function hintOf(e: AuditEvent): string | null {
  const m = e.metadata as Record<string, unknown> | null | undefined;
  if (!m || typeof m !== "object") return null;
  const str = (k: string) => (typeof m[k] === "string" && (m[k] as string).trim() && !/^[a-z0-9]{20,}$/i.test(m[k] as string) ? (m[k] as string).trim() : null);
  const code = CODE_KEYS.map(str).find(Boolean) ?? null;
  const title = str("title");
  return [code, title].filter(Boolean).join(" · ") || null;
}

export const PlatformAuditPage: React.FC = () => {
  const [from, setFrom] = React.useState(daysAgo(30));
  const [to, setTo] = React.useState(isoDay(new Date()));
  const [company, setCompany] = React.useState("");   // slug, "" = todas, CONSOLE
  const [person, setPerson] = React.useState("");
  const [kind, setKind] = React.useState<Kind>("");
  const [tech, setTech] = React.useState(false);

  const [data, setData] = React.useState<ListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [companies, setCompanies] = React.useState<Array<{ slug: string; name: string }>>([]);
  const [people, setPeople] = React.useState<string[]>([]);

  const serverSlug = company && company !== CONSOLE ? company : "";

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    const qs = new URLSearchParams();
    if (serverSlug) qs.set("tenantSlug", serverSlug);
    if (from) qs.set("from", from);
    if (to) qs.set("to", `${to}T23:59:59`);
    qs.set("limit", String(LIMIT));
    try {
      const res = await platformFetch<ListResponse>(`/platform/audit-events?${qs}`);
      setData(res);
      // Las listas de los desplegables salen de los datos sin filtrar, para que no se achiquen al elegir.
      if (!serverSlug) {
        const map = new Map<string, string>();
        res.items.forEach(e => { if (e.tenantSlug) map.set(e.tenantSlug, e.tenantName ?? e.tenantSlug); });
        setCompanies(Array.from(map, ([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name, "es")));
        setPeople(Array.from(new Set(res.items.map(personOf))).sort((a, b) => a.localeCompare(b, "es")));
      }
    } catch (e: any) { setError(e.message ?? "No se pudo cargar el registro"); }
    finally { setLoading(false); }
  }, [serverSlug, from, to]);
  React.useEffect(() => { load(); }, [load]);

  const rows = React.useMemo(() => (data?.items ?? []).filter(e =>
    (company !== CONSOLE || !e.tenantSlug) &&
    (!person || personOf(e) === person) &&
    (!kind || kindOf(e) === kind)
  ), [data, company, person, kind]);

  const columns: Column<AuditEvent>[] = [
    { key: "createdAt", header: "Cuándo", sortable: true, sortValue: r => r.createdAt, render: r => <span className="text-sm whitespace-nowrap">{fmtWhen(r.createdAt)}</span> },
    { key: "who", header: "Quién", mobileTitle: true, filterValue: personOf,
      render: r => <TwoLines main={personOf(r)} sub={companyOf(r)} /> },
    { key: "what", header: "Qué hizo", filterValue: r => auditActionLabel(r.action, r.entityType),
      render: r => <StatusPill tone={KIND_TONE[auditActionKind(r.action)]}>{auditActionLabel(r.action, r.entityType)}</StatusPill> },
    { key: "on", header: "Sobre qué", render: r => {
      if (auditActionKind(r.action) === "login_failed") {
        const reason = typeof r.metadata?.reason === "string" ? r.metadata.reason : null;
        return <span className="text-sm">{failureLabel(reason)}</span>;
      }
      return <TwoLines main={entityLabel(r.entityType)} sub={hintOf(r)} />;
    } },
    ...(tech ? [
      { key: "action", header: "Código de la acción", mobileHidden: true, render: (r: AuditEvent) => <span className="text-xs text-text-industrial/60">{r.action}</span> },
      { key: "entityId", header: "Identificador del registro", mobileHidden: true, render: (r: AuditEvent) => <span className="text-xs text-text-industrial/60 break-all">{r.entityId ?? "—"}</span> },
      { key: "actorType", header: "Tipo de autor", mobileHidden: true, render: (r: AuditEvent) => <span className="text-xs text-text-industrial/60">{r.actorType}</span> },
    ] : []),
  ];

  return (
    <div>
      <PageIntro title="Registro de cambios" description="Todo lo que se creó, modificó o borró en el sistema, con quién lo hizo y cuándo."
        actions={<button type="button" onClick={() => setTech(t => !t)}
          className="px-3 py-2 md:py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-sm text-fg hover:bg-fg/10 transition-colors">
          {tech ? "Ocultar detalle técnico" : "Ver detalle técnico"}</button>} />

      <FilterBar>
        <FilterField label="Empresa">
          <select className={inputCls} value={company} onChange={e => setCompany(e.target.value)}>
            <option value="">Todas</option>
            {companies.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            <option value={CONSOLE}>Consola</option>
          </select>
        </FilterField>
        <FilterField label="Persona">
          <select className={inputCls} value={person} onChange={e => setPerson(e.target.value)}>
            <option value="">Todas</option>
            {people.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </FilterField>
        <FilterField label="Tipo">
          <select className={inputCls} value={kind} onChange={e => setKind(e.target.value as Kind)}>
            <option value="">Todo</option>
            <option value="login">Ingresos</option>
            <option value="data">Cambios en datos</option>
            <option value="config">Configuración</option>
          </select>
        </FilterField>
        <FilterField label="Desde"><input type="date" className={inputCls} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></FilterField>
        <FilterField label="Hasta"><input type="date" className={inputCls} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></FilterField>
      </FilterBar>

      {!loading && !error && rows.length === 0 ? (
        <EmptyState title="No hay movimientos con esos filtros" text="Probá con otro período, otra empresa u otra persona." />
      ) : (
        <DataTable columns={columns} data={loading ? null : rows} loading={loading} error={error} keyFn={r => r.id}
          emptyText="No hay movimientos con esos filtros" mobileCards />
      )}

      {(data?.items.length ?? 0) >= LIMIT && (
        <p className="text-xs text-text-industrial/60 mt-3">Se muestran los últimos {LIMIT}. Achicá el período para ver más atrás.</p>
      )}
    </div>
  );
};
