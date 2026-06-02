import React, { useState, useCallback } from "react";
import { MessageSquare, Send, RotateCcw, Loader2, CheckCircle2, AlertCircle, Plus, X } from "lucide-react";
import { platformFetch, platformPost, platformPatch } from "../../lib/platform-auth";
import { StatusBadge, fmtDate } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";

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

const CAPABILITIES = [
  "knowledge_assistant",
  "defect_assistant",
  "deferral_analysis",
  "barrier_interviewer",
  "maintenance_insights",
  "daily_executive_summary",
  "document_summarizer",
  "evidence_link_assistant",
];
const LOCALES      = ["es", "en", "pt"];

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface dark:bg-[#0D1526] border border-fg/10 rounded-2xl w-full max-w-xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/5">
          <h2 className="text-sm font-bold text-fg">{title}</h2>
          <button onClick={onClose} className="text-text-industrial/40 hover:text-fg transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inp = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-red-500/30 focus:ring-1 focus:ring-red-500/10 transition-all";
const sel = inp + " appearance-none";
const textarea = inp + " resize-none font-mono text-xs leading-relaxed";

function ErrMsg({ msg }: { msg: string }) {
  return <div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{msg}</div>;
}

function SaveBtn({ loading: l, label = "Guardar" }: { loading: boolean; label?: string }) {
  return (
    <button type="submit" disabled={l} className="w-full py-2.5 rounded-xl bg-red-500/80 text-fg font-bold text-sm hover:bg-red-500 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
      {l ? <><Loader2 className="w-4 h-4 animate-spin" />{label}...</> : label}
    </button>
  );
}

// ─── Create Prompt Modal ──────────────────────────────────────────────────────

function CreatePromptModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ capability: CAPABILITIES[0] ?? "knowledge_assistant", locale: "es", title: "", content: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setErr(null);
    try { await platformPost("/platform/prompts", form); onCreated(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "Error al crear prompt"); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title="Crear Prompt" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Capability">
            <select className={sel} value={form.capability} onChange={set("capability")}>
              {CAPABILITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Locale">
            <select className={sel} value={form.locale} onChange={set("locale")}>
              {LOCALES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Título">
          <input className={inp} required value={form.title} onChange={set("title")} placeholder="Prompt de copiloto naval" />
        </Field>
        <Field label="Contenido del prompt">
          <textarea className={textarea} required rows={10} value={form.content} onChange={set("content")} placeholder="Eres un asistente especializado en gestión de mantenimiento naval..." />
        </Field>
        {err && <ErrMsg msg={err} />}
        <SaveBtn loading={loading} label="Crear Prompt" />
      </form>
    </ModalWrapper>
  );
}

// ─── Edit Prompt Modal ────────────────────────────────────────────────────────

function EditPromptModal({ prompt, onClose, onSaved }: { prompt: Prompt; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: prompt.title, content: prompt.content });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setErr(null);
    try { await platformPatch(`/platform/prompts/${prompt.id}`, form); onSaved(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "Error al guardar"); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title={`Editar — ${prompt.capability} · ${prompt.locale.toUpperCase()} · v${prompt.version}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Título">
          <input className={inp} required value={form.title} onChange={set("title")} />
        </Field>
        <Field label="Contenido del prompt">
          <textarea className={textarea} required rows={12} value={form.content} onChange={set("content")} />
        </Field>
        {err && <ErrMsg msg={err} />}
        <SaveBtn loading={loading} />
      </form>
    </ModalWrapper>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export const PlatformPromptsPage: React.FC = () => {
  const { data, loading, error, reload } = usePlatformList<ListResponse>("/platform/prompts");
  const [actMsg, setActMsg]         = useState<string | null>(null);
  const [actLoading, setActLoading] = useState(false);
  const [creating, setCreating]     = useState(false);
  const [editing, setEditing]       = useState<Prompt | null>(null);

  const handleAction = async (p: Prompt, act: "publish" | "rollback") => {
    setActLoading(true); setActMsg(null);
    try {
      await platformPost(`/platform/prompts/${p.id}/${act}`, {});
      setActMsg(`${act === "publish" ? "Publicado" : "Revertido"} correctamente`);
      reload();
    } catch (e: any) {
      setActMsg(`Error: ${e.message}`);
    } finally {
      setActLoading(false);
    }
  };

  const prompts = data?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader icon={MessageSquare} title="Platform Prompts" total={data?.total} onReload={reload}>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all">
          <Plus className="w-3.5 h-3.5" /> Nuevo Prompt
        </button>
      </PageHeader>

      {actMsg && (
        <div className={`flex items-center gap-2 text-xs p-3 rounded-xl border ${actMsg.startsWith("Error") ? "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400" : "bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-400"}`}>
          {actMsg.startsWith("Error") ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
          {actMsg}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-700 dark:text-red-400 text-sm p-4 bg-red-500/10 rounded-xl border border-red-500/20"><AlertCircle className="w-5 h-5 shrink-0" />{error}</div>
      ) : prompts.length === 0 ? (
        <div className="text-center py-16 text-text-industrial/20 text-sm">Sin prompts registrados</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {prompts.map(p => (
            <div key={p.id} className="bento-card space-y-3 cursor-pointer hover:border-fg/20 transition-all hover:scale-[1.02]" onClick={() => setEditing(p)}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-text-industrial/30 font-bold">
                    {p.capability} · {p.locale.toUpperCase()} · v{p.version}
                  </p>
                  <h3 className="text-sm font-bold text-fg mt-0.5">{p.title}</h3>
                </div>
                <StatusBadge status={p.status} />
              </div>

              <p className="text-xs text-text-industrial/50 line-clamp-3 bg-fg/[0.02] rounded-lg p-3 border border-fg/5 font-mono leading-relaxed">
                {p.content}
              </p>

              <div className="flex items-center justify-between text-[10px] text-text-industrial/30 pt-1 border-t border-fg/5">
                <span>Actualizado: {fmtDate(p.updatedAt)}</span>
                {p.publishedAt && <span>Publicado: {fmtDate(p.publishedAt)}</span>}
              </div>

              <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                {p.status !== "PUBLISHED" && (
                  <button
                    onClick={() => handleAction(p, "publish")}
                    disabled={actLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 text-xs font-bold hover:bg-green-500/20 disabled:opacity-50 transition-all">
                    <Send className="w-3 h-3" /> Publicar
                  </button>
                )}
                {p.status === "PUBLISHED" && (
                  <button
                    onClick={() => handleAction(p, "rollback")}
                    disabled={actLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-xs font-bold hover:bg-yellow-500/20 disabled:opacity-50 transition-all">
                    <RotateCcw className="w-3 h-3" /> Revertir
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <CreatePromptModal onClose={() => setCreating(false)} onCreated={reload} />}
      {editing  && <EditPromptModal prompt={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
};
