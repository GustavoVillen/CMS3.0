import React from "react";
import { Paperclip, Info } from "lucide-react";
import { platformFetch } from "../../lib/platform-auth";
import { DataTable, type Column } from "../../components/DataTable";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { PageIntro, Card, FilterBar, FilterField, TwoLines, EmptyState, inputCls } from "../../components/platform/PlatformUi";
import { roleLabel, screenLabel, fmtWhen, fmtDate, fmtInt, fmtBytes } from "../../lib/platform-labels";

interface CopilotQuestion {
  id: string;
  tenantSlug: string;
  tenantName?: string | null;
  userEmail: string;
  userName?: string | null;
  userRole: string;
  vesselCode: string | null;
  vesselName?: string | null;
  screen: string | null;
  question: string;
  answer?: string | null;
  hasAttachment: boolean;
  createdAt: string;
}

interface Storage { count: number; bytes: number; oldest: string | null; maxBytes: number; retentionDays: number }
interface ListResponse { items: CopilotQuestion[]; total: number; storage?: Storage }

const PERIODS = [
  { value: "month", label: "Este mes" },
  { value: "7d", label: "Últimos 7 días" },
  { value: "3m", label: "Últimos 3 meses" },
] as const;
type Period = typeof PERIODS[number]["value"];

function periodFrom(p: Period): string {
  const now = new Date();
  const d = p === "month" ? new Date(now.getFullYear(), now.getMonth(), 1)
    : p === "7d" ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
    : new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  return d.toISOString();
}

const fmtMb = (b: number) => (b / (1024 * 1024)).toFixed(1).replace(".", ",");

// El copiloto le antepone a la pregunta el contexto de la pantalla
// («[Contexto activo: … · vessel M02 · estado FUTURE]») y algunos mensajes son
// avisos que manda la app sola («[CAMBIO EN PANTALLA]»). Se muestra sólo lo que
// escribió la persona; el contexto ya está en las columnas Pantalla y Buque.
const AUTO_MESSAGES: Record<string, string> = {
  "[CAMBIO EN PANTALLA]": "Aviso automático: cambió algo en la pantalla",
  "[AYUDAR]": "Tocó el botón de ayuda",
};
function cleanQuestion(raw: string): string {
  const text = raw.replace(/^\s*\[Contexto activo:[^\]]*\]\s*/i, "").trim();
  if (AUTO_MESSAGES[text.toUpperCase()]) return AUTO_MESSAGES[text.toUpperCase()];
  return text || "(sin texto)";
}
const personName = (q: CopilotQuestion) => q.userName ?? q.userEmail;
const vesselName = (q: CopilotQuestion) => q.vesselName ?? q.vesselCode;
const PREVIEW = 160;

function ReplyModal({ q, onClose }: { q: CopilotQuestion; onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-surface border border-fg/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-fg/10">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-fg">Pregunta y respuesta</h2>
            <p className="text-xs text-text-industrial/50 mt-0.5">
              {personName(q)} · {fmtWhen(q.createdAt)} · {screenLabel(q.screen)}{vesselName(q) ? ` · ${vesselName(q)}` : ""}
            </p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-3">
          <p className="text-sm font-semibold text-fg whitespace-pre-wrap break-words">{cleanQuestion(q.question)}</p>
          <div className="border-l-[3px] border-accent/50 bg-fg/[0.03] rounded-md px-3 py-2.5">
            <div className="text-xs text-text-industrial/50 mb-1">El copiloto respondió:</div>
            <p className="text-sm text-fg whitespace-pre-wrap break-words">{q.answer}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export const PlatformCopilotQuestionsPage: React.FC = () => {
  const [searchText, setSearchText] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [period, setPeriod] = React.useState<Period>("3m");
  const [userEmail, setUserEmail] = React.useState("");
  const [tenantSlug, setTenantSlug] = React.useState("");
  const [vessel, setVessel] = React.useState("");
  const [open, setOpen] = React.useState<CopilotQuestion | null>(null);

  const [data, setData] = React.useState<ListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Opciones de los desplegables, guardadas cuando el filtro está en «Todas».
  const [personOpts, setPersonOpts] = React.useState<Array<{ email: string; name: string }>>([]);
  const [tenantOpts, setTenantOpts] = React.useState<Array<{ slug: string; name: string }>>([]);

  React.useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 400);
    return () => clearTimeout(t);
  }, [searchText]);

  const path = React.useMemo(() => {
    const sp = new URLSearchParams();
    if (search) sp.set("search", search);
    if (userEmail) sp.set("userEmail", userEmail);
    if (tenantSlug) sp.set("tenantSlug", tenantSlug);
    sp.set("from", periodFrom(period));
    return `/platform/copilot-questions?${sp.toString()}`;
  }, [search, userEmail, tenantSlug, period]);

  const reload = React.useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await platformFetch<ListResponse>(path)); }
    catch (e: any) { setError(e.message ?? "Error"); }
    finally { setLoading(false); }
  }, [path]);
  React.useEffect(() => { void reload(); }, [reload]);

  React.useEffect(() => {
    if (!data) return;
    if (!userEmail) {
      const m = new Map<string, string>();
      for (const q of data.items) m.set(q.userEmail, personName(q));
      setPersonOpts(Array.from(m, ([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name, "es")));
    }
    if (!tenantSlug) {
      const m = new Map<string, string>();
      for (const q of data.items) m.set(q.tenantSlug, q.tenantName ?? q.tenantSlug);
      setTenantOpts(Array.from(m, ([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name, "es")));
    }
  }, [data, userEmail, tenantSlug]);

  const vesselOpts = React.useMemo(
    () => Array.from(new Set((data?.items ?? []).map(vesselName).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b, "es")),
    [data],
  );
  const rows = React.useMemo(() => (data?.items ?? []).filter((q) => !vessel || vesselName(q) === vessel), [data, vessel]);

  const columns = React.useMemo<Column<CopilotQuestion>[]>(() => [
    { key: "createdAt", header: "Cuándo", filterValue: (r) => fmtWhen(r.createdAt), render: (r) => <span className="text-sm text-text-industrial/70 whitespace-nowrap">{fmtWhen(r.createdAt)}</span> },
    { key: "userEmail", header: "Persona", filterValue: (r) => personName(r), render: (r) => <TwoLines main={personName(r)} sub={roleLabel(r.userRole)} /> },
    {
      key: "question", header: "Pregunta y respuesta", mobileTitle: true,
      render: (r) => (
        <div className="max-w-[520px] min-w-0">
          <div className="flex items-start gap-1.5">
            <span className="text-sm font-semibold text-fg whitespace-pre-wrap break-words">{cleanQuestion(r.question)}</span>
          </div>
          {r.hasAttachment && (
            <div className="inline-flex items-center gap-1 text-xs text-text-industrial/60 mt-0.5"><Paperclip className="w-3 h-3" /> adjuntó un archivo</div>
          )}
          {r.answer ? (
            <div className="mt-1.5 border-l-[3px] border-accent/50 bg-fg/[0.03] rounded-md px-2.5 py-2">
              <div className="text-xs text-text-industrial/50">El copiloto respondió:</div>
              <p className="text-sm text-fg/80 break-words">{r.answer.length > PREVIEW ? `${r.answer.slice(0, PREVIEW).trimEnd()}…` : r.answer}</p>
              {r.answer.length > PREVIEW && (
                <button type="button" onClick={() => setOpen(r)} className="text-xs font-semibold text-accent hover:underline mt-1">Ver respuesta completa</button>
              )}
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-text-industrial/50">Sin respuesta guardada (pregunta anterior a este cambio)</p>
          )}
        </div>
      ),
    },
    { key: "screen", header: "Desde qué pantalla", filterValue: (r) => screenLabel(r.screen), render: (r) => <span className="text-sm text-text-industrial/70">{screenLabel(r.screen)}</span> },
    { key: "vessel", header: "Buque", filterValue: (r) => vesselName(r) ?? "", render: (r) => <span className="text-sm text-text-industrial/70">{vesselName(r) ?? "—"}</span> },
  ], []);

  const st = data?.storage;
  const pct = st && st.maxBytes > 0 ? Math.min(100, (st.bytes / st.maxBytes) * 100) : 0;
  const months = st ? Math.round(st.retentionDays / 30) : 3;

  return (
    <div>
      <PageIntro
        title="Preguntas al copiloto"
        description="Lo que la gente le pregunta al copiloto y lo que el copiloto le contestó. Sirve para ver qué dudas tienen y si las respuestas son buenas."
      />

      {st && (
        <div className="rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 mb-4 flex gap-2.5">
          <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 text-sm text-text-industrial/80">
            Se guardan los últimos {months} meses, con un tope de {fmtMb(st.maxBytes)} MB de texto. Si se llega al tope antes, se borran primero las más viejas.{" "}
            Hoy: {fmtInt(st.count)} {st.count === 1 ? "pregunta" : "preguntas"} · {fmtBytes(st.bytes)} de {fmtMb(st.maxBytes)} MB
            {st.oldest ? <> · la más vieja es del {fmtDate(st.oldest)}.</> : "."}
            <div className="h-1.5 mt-2 rounded bg-fg/10 overflow-hidden max-w-sm" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded bg-accent" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      )}

      <FilterBar>
        <FilterField label="Buscar">
          <input className={`${inputCls} md:w-72`} value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Palabra de la pregunta o la respuesta" />
        </FilterField>
        <FilterField label="Persona">
          <select className={inputCls} value={userEmail} onChange={(e) => setUserEmail(e.target.value)}>
            <option value="">Todas</option>
            {userEmail && !personOpts.some((p) => p.email === userEmail) && <option value={userEmail}>{userEmail}</option>}
            {personOpts.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Empresa">
          <select className={inputCls} value={tenantSlug} onChange={(e) => { setTenantSlug(e.target.value); setUserEmail(""); }}>
            <option value="">Todas</option>
            {tenantSlug && !tenantOpts.some((t) => t.slug === tenantSlug) && <option value={tenantSlug}>{tenantSlug}</option>}
            {tenantOpts.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Buque">
          <select className={inputCls} value={vessel} onChange={(e) => setVessel(e.target.value)}>
            <option value="">Todos</option>
            {vessel && !vesselOpts.includes(vessel) && <option value={vessel}>{vessel}</option>}
            {vesselOpts.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </FilterField>
        <FilterField label="Período">
          <select className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </FilterField>
      </FilterBar>

      {!loading && !error && rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No hay preguntas para mostrar"
            text={search || userEmail || tenantSlug || vessel ? "Probá con otra palabra o sacá algún filtro." : "Todavía nadie le hizo preguntas al copiloto en este período."}
          />
        </Card>
      ) : (
        <DataTable columns={columns} data={rows} loading={loading} error={error} keyFn={(r) => r.id} emptyText="Sin preguntas registradas" mobileCards />
      )}

      {open && <ReplyModal q={open} onClose={() => setOpen(null)} />}
    </div>
  );
};
