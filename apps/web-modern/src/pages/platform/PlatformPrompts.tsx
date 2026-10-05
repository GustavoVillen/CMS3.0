import React, { useState, useCallback } from "react";
import { Plus, Loader2, CheckCircle2, Info } from "lucide-react";
import { platformFetch, platformPost, platformPatch } from "../../lib/platform-auth";
import { DataTable, type Column } from "../../components/DataTable";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { AlertDialog } from "../../components/AlertDialog";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageIntro, StatusPill } from "../../components/platform/PlatformUi";
import { capabilityLabel, localeLabel, statusInfo, fmtDate, CAPABILITY_LABELS, LOCALE_LABELS } from "../../lib/platform-labels";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Prompt {
  id: string;
  capability: string;
  locale: string;
  version: number;
  status: string;
  title: string;
  content: string;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse { items: Prompt[]; total: number; }

const CAPABILITIES = Object.keys(CAPABILITY_LABELS);
const LOCALES = Object.keys(LOCALE_LABELS);

const firstLine = (s: string) => (s.split("\n").find(l => l.trim()) ?? "").trim();

// ─── Data hook ────────────────────────────────────────────────────────────────

function usePlatformList<T>(path: string) {
  const [data, setData]       = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError]     = React.useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await platformFetch<T>(path)); }
    catch (e: any) { setError(e.message ?? "Error"); }
    finally { setLoading(false); }
  }, [path]);
  React.useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function ModalWrapper({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm md:p-4">
      <div className="bg-surface dark:bg-[#0D1526] border border-fg/10 rounded-t-2xl md:rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92dvh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-4 border-b border-fg/5 shrink-0">
          <h2 className="text-sm font-bold text-fg truncate">{title}</h2>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="px-4 md:px-6 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text-industrial/60 mb-1.5">{label}{required && <span className="text-danger"> *</span>}</label>
      {children}
    </div>
  );
}

// text-base en el celular: con menos de 16px el iPhone agranda la pantalla al tocar el campo.
const inp = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 md:py-2 text-base md:text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/10 transition-all";
const sel = inp + " appearance-none";
const textarea = inp + " resize-y leading-relaxed min-h-[16rem]";

function SaveBtn({ loading: l, label = "Guardar" }: { loading: boolean; label?: string }) {
  return (
    <button type="submit" disabled={l} className="w-full py-2.5 rounded-xl bg-accent text-accent-fg font-bold text-sm hover:bg-accent/80 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
      {l ? <><Loader2 className="w-4 h-4 animate-spin" />{label}...</> : label}
    </button>
  );
}

const btn = "px-3 py-2 md:py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-sm text-fg hover:bg-fg/10 disabled:opacity-50 transition-colors whitespace-nowrap";
const btnPri = "px-3 py-2 md:py-1.5 rounded-lg bg-accent text-accent-fg text-sm font-semibold hover:bg-accent/80 disabled:opacity-50 transition-colors whitespace-nowrap";

// ─── Create Prompt Modal ──────────────────────────────────────────────────────

function CreatePromptModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ capability: CAPABILITIES[0] ?? "knowledge_assistant", locale: "es", title: "", content: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) { setErr("Completá el título y el contenido de las instrucciones."); return; }
    setLoading(true);
    try { await platformPost("/platform/prompts", form); onCreated(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "No se pudieron crear las instrucciones"); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title="Nuevas instrucciones" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Función">
            <select className={sel} value={form.capability} onChange={set("capability")}>
              {CAPABILITIES.map(c => <option key={c} value={c}>{capabilityLabel(c)}</option>)}
            </select>
          </Field>
          <Field label="Idioma">
            <select className={sel} value={form.locale} onChange={set("locale")}>
              {LOCALES.map(l => <option key={l} value={l}>{localeLabel(l)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Título" required>
          <input className={inp} value={form.title} onChange={set("title")} placeholder="Por ejemplo: Asistente de consultas, versión de octubre" />
        </Field>
        <Field label="Contenido" required>
          <textarea className={textarea} rows={12} value={form.content} onChange={set("content")} placeholder="Escribí acá el texto de base que va a recibir la IA." />
        </Field>
        <SaveBtn loading={loading} label="Guardar como borrador" />
      </form>
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
    </ModalWrapper>
  );
}

// ─── Edit Prompt Modal ────────────────────────────────────────────────────────

function EditPromptModal({ prompt, onClose, onSaved }: { prompt: Prompt; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: prompt.title, content: prompt.content });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) { setErr("Completá el título y el contenido de las instrucciones."); return; }
    setLoading(true);
    try { await platformPatch(`/platform/prompts/${prompt.id}`, form); onSaved(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "No se pudieron guardar los cambios"); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title={`Editar: ${capabilityLabel(prompt.capability)} · ${localeLabel(prompt.locale)} · versión ${prompt.version}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Título" required>
          <input className={inp} value={form.title} onChange={set("title")} />
        </Field>
        <Field label="Contenido" required>
          <textarea className={textarea} rows={14} value={form.content} onChange={set("content")} />
        </Field>
        <SaveBtn loading={loading} />
      </form>
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
    </ModalWrapper>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export const PlatformPromptsPage: React.FC = () => {
  const { data, loading, error, reload } = usePlatformList<ListResponse>("/platform/prompts");
  const [busy, setBusy]         = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<Prompt | null>(null);
  const [confirm, setConfirm]   = useState<{ p: Prompt; act: "publish" | "rollback" } | null>(null);
  const [actErr, setActErr]     = useState<string | null>(null);
  const [notice, setNotice]     = useState<string | null>(null);

  React.useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const runAction = async () => {
    if (!confirm) return;
    const { p, act } = confirm;
    setConfirm(null); setBusy(true);
    try {
      await platformPost(`/platform/prompts/${p.id}/${act}`, {});
      setNotice(act === "publish" ? "Publicado. Ya está en uso." : "Listo. Se volvió a la versión anterior.");
      reload();
    } catch (e: any) {
      setActErr(e.message ?? "No se pudo completar la acción");
    } finally {
      setBusy(false);
    }
  };

  const rows = React.useMemo(() => [...(data?.items ?? [])].sort((a, b) =>
    capabilityLabel(a.capability).localeCompare(capabilityLabel(b.capability), "es") ||
    a.locale.localeCompare(b.locale) || b.version - a.version), [data]);

  const columns: Column<Prompt>[] = [
    { key: "fn", header: "Función", mobileTitle: true, filterValue: r => capabilityLabel(r.capability),
      render: r => (
        <div className="min-w-0 max-w-md">
          <div className="text-sm font-bold text-fg">{capabilityLabel(r.capability)}</div>
          <div className="text-xs text-text-industrial/60 truncate">{firstLine(r.content) || r.title}</div>
        </div>
      ) },
    { key: "locale", header: "Idioma", filterValue: r => localeLabel(r.locale), render: r => <span className="text-sm">{localeLabel(r.locale)}</span> },
    { key: "status", header: "Estado", filterValue: r => statusInfo(r.status).label,
      render: r => {
        const s = statusInfo(r.status);
        return <StatusPill tone={s.tone}>{s.label} · versión {r.version}</StatusPill>;
      } },
    { key: "updatedAt", header: "Última modificación", sortable: true, sortValue: r => r.updatedAt, render: r => <span className="text-sm whitespace-nowrap">{fmtDate(r.updatedAt)}</span> },
    { key: "actions", header: "", render: r => (
      <div className="flex flex-wrap gap-2" onClick={e => e.stopPropagation()}>
        <button type="button" className={btn} disabled={busy} onClick={() => setEditing(r)}>Editar</button>
        {r.status === "PUBLISHED" ? (
          <button type="button" className={btn} disabled={busy} onClick={() => setConfirm({ p: r, act: "rollback" })}>Volver a la anterior</button>
        ) : r.status === "DRAFT" ? (
          <button type="button" className={btnPri} disabled={busy} onClick={() => setConfirm({ p: r, act: "publish" })}>Publicar</button>
        ) : null}
      </div>
    ) },
  ];

  const confirmMsg = confirm
    ? confirm.act === "publish"
      ? `Desde ahora la IA va a usar la versión ${confirm.p.version} de ${capabilityLabel(confirm.p.capability)} en todas las empresas.`
      : `La IA va a dejar de usar la versión ${confirm.p.version} de ${capabilityLabel(confirm.p.capability)} y vuelve a la anterior, en todas las empresas.`
    : "";

  return (
    <div>
      <PageIntro title="Instrucciones de la IA"
        description="El texto de base que recibe la inteligencia artificial en cada función. Un cambio publicado afecta enseguida a todas las empresas."
        actions={<button type="button" onClick={() => setCreating(true)} className={btnPri + " flex items-center gap-1.5"}><Plus className="w-3.5 h-3.5" /> Nuevas instrucciones</button>} />

      <div className="flex items-start gap-2 text-sm rounded-xl border border-warning/25 bg-warning/10 text-fg px-3 py-2.5 mb-4">
        <Info className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <span>Los cambios se guardan como borrador. Recién se usan cuando apretás «Publicar», y el sistema te pide confirmarlo.</span>
      </div>

      {notice && (
        <div role="status" className="flex items-center gap-2 text-sm rounded-xl border border-success/25 bg-success/10 text-success px-3 py-2.5 mb-4">
          <CheckCircle2 className="w-4 h-4 shrink-0" />{notice}
        </div>
      )}

      <DataTable columns={columns} data={loading ? null : rows} loading={loading} error={error} keyFn={r => r.id}
        emptyText="Todavía no hay instrucciones cargadas. Tocá «Nuevas instrucciones» para crear la primera." mobileCards />

      {creating && <CreatePromptModal onClose={() => setCreating(false)} onCreated={reload} />}
      {editing && <EditPromptModal prompt={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {confirm && (
        <ConfirmDialog message={confirmMsg} confirmLabel={confirm.act === "publish" ? "Publicar" : "Volver a la anterior"} cancelLabel="Cancelar"
          onConfirm={runAction} onCancel={() => setConfirm(null)} />
      )}
      {actErr && <AlertDialog message={actErr} onClose={() => setActErr(null)} />}
    </div>
  );
};
