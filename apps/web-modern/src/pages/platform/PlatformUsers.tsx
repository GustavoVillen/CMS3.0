import React, { useState, useCallback } from "react";
import { Users, Plus, X, Loader2, AlertCircle } from "lucide-react";
import { platformFetch, platformPost, platformPatch } from "../../lib/platform-auth";
import { DataTable, StatusBadge, fmtDate, type Column } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";
import { PasswordInput } from "../../components/PasswordInput";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlatformUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: string;
  status: string;
  createdAt: string;
}

const ROLES    = ["SUPERADMIN", "SUPPORT"];
const STATUSES = ["ACTIVE", "SUSPENDED", "DISABLED"];

// ─── Shared UI helpers ────────────────────────────────────────────────────────

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

function ModalWrapper({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0D1526] border border-fg/10 rounded-2xl w-full max-w-md shadow-2xl">
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

function ErrMsg({ msg }: { msg: string }) {
  return <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{msg}</div>;
}

function SaveBtn({ loading: l, label = "Guardar" }: { loading: boolean; label?: string }) {
  return (
    <button type="submit" disabled={l} className="w-full py-2.5 rounded-xl bg-red-500/80 text-fg font-bold text-sm hover:bg-red-500 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
      {l ? <><Loader2 className="w-4 h-4 animate-spin" />{label}...</> : label}
    </button>
  );
}

// ─── Create Platform User Modal ───────────────────────────────────────────────

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ email: "", password: "", role: "SUPPORT", firstName: "", lastName: "", status: "ACTIVE" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setErr(null);
    try { await platformPost("/platform/users", form); onCreated(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "Error al crear usuario"); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title="Crear Usuario de Plataforma" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email">
          <input className={inp} type="email" required value={form.email} onChange={set("email")} placeholder="usuario@plataforma.com" />
        </Field>
        <Field label="Contraseña">
          <PasswordInput className={inp} required value={form.password} onChange={set("password")} placeholder="••••••••" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre"><input className={inp} value={form.firstName} onChange={set("firstName")} placeholder="Juan" /></Field>
          <Field label="Apellido"><input className={inp} value={form.lastName} onChange={set("lastName")} placeholder="García" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rol">
            <select className={sel} value={form.role} onChange={set("role")}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Estado">
            <select className={sel} value={form.status} onChange={set("status")}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        {err && <ErrMsg msg={err} />}
        <SaveBtn loading={loading} label="Crear Usuario" />
      </form>
    </ModalWrapper>
  );
}

// ─── Edit Platform User Modal ─────────────────────────────────────────────────

function EditUserModal({ user, onClose, onSaved }: { user: PlatformUser; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ role: user.role, status: user.status, firstName: user.firstName ?? "", lastName: user.lastName ?? "", password: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setErr(null);
    const payload: Record<string, unknown> = { role: form.role, status: form.status, firstName: form.firstName || null, lastName: form.lastName || null };
    if (form.password) payload.password = form.password;
    try { await platformPatch(`/platform/users/${user.id}`, payload); onSaved(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "Error al guardar"); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title={`Editar — ${user.email}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre"><input className={inp} value={form.firstName} onChange={set("firstName")} placeholder="Juan" /></Field>
          <Field label="Apellido"><input className={inp} value={form.lastName} onChange={set("lastName")} placeholder="García" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rol">
            <select className={sel} value={form.role} onChange={set("role")}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Estado">
            <select className={sel} value={form.status} onChange={set("status")}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Nueva contraseña (dejar vacío para no cambiar)">
          <PasswordInput className={inp} value={form.password} onChange={set("password")} placeholder="••••••••" />
        </Field>
        {err && <ErrMsg msg={err} />}
        <SaveBtn loading={loading} />
      </form>
    </ModalWrapper>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export const PlatformUsersPage: React.FC = () => {
  const { data, loading, error, reload } = usePlatformList<{ items: PlatformUser[]; total: number }>("/platform/users");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<PlatformUser | null>(null);

  const COLUMNS: Column<PlatformUser>[] = [
    { key: "email",     header: "Email",   render: r => <span className="font-mono text-fg text-xs">{r.email}</span> },
    { key: "firstName", header: "Nombre",  render: r => [r.firstName, r.lastName].filter(Boolean).join(" ") || "—" },
    { key: "role",      header: "Rol",     render: r => <span className="text-xs font-bold text-red-400">{r.role}</span> },
    { key: "status",    header: "Estado",  render: r => <StatusBadge status={r.status} /> },
    { key: "createdAt", header: "Creado",  render: r => fmtDate(r.createdAt) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader icon={Users} title="Platform Users" total={data?.total} onReload={reload}>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all">
          <Plus className="w-3.5 h-3.5" /> Nuevo Usuario
        </button>
      </PageHeader>

      <DataTable columns={COLUMNS} data={data?.items ?? null} loading={loading} error={error} keyFn={r => r.id} emptyText="No hay usuarios de plataforma" onRowClick={setEditing} />

      {creating && <CreateUserModal onClose={() => setCreating(false)} onCreated={reload} />}
      {editing  && <EditUserModal user={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
};
