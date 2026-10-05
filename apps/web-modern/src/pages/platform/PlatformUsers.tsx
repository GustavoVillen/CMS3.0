import React, { useState, useCallback } from "react";
import { Plus, Loader2 } from "lucide-react";
import { platformFetch, platformPost, platformPatch } from "../../lib/platform-auth";
import { DataTable, type Column } from "../../components/DataTable";
import { AlertDialog } from "../../components/AlertDialog";
import { PageIntro, StatusPill, TwoLines } from "../../components/platform/PlatformUi";
import { roleLabel, statusInfo, fmtDate, PLATFORM_ROLE_HELP } from "../../lib/platform-labels";
import { PasswordInput } from "../../components/PasswordInput";
import { ModalCloseButton } from "../../components/ModalCloseButton";

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

const RoleOptions = () => <>{ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}</>;
const StatusOptions = () => <>{STATUSES.map(s => <option key={s} value={s}>{statusInfo(s, "person").label}</option>)}</>;

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
    // En el celular sube desde abajo; en ambos casos se desplaza si no entra.
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm md:p-4">
      <div className="bg-surface dark:bg-[#0D1526] border border-fg/10 rounded-t-2xl md:rounded-2xl w-full max-w-md shadow-2xl max-h-[92dvh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-4 border-b border-fg/5 shrink-0">
          <h2 className="text-sm font-bold text-fg truncate">{title}</h2>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="px-4 md:px-6 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text-industrial/60 mb-1.5">{label}{required && <span className="text-danger"> *</span>}</label>
      {children}
      {hint && <p className="text-xs text-text-industrial/50 mt-1.5">{hint}</p>}
    </div>
  );
}

// text-base en el celular: con menos de 16px el iPhone agranda la pantalla al tocar el campo.
const inp = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 md:py-2 text-base md:text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all";
const sel = inp + " appearance-none";

function SaveBtn({ loading: l, label = "Guardar" }: { loading: boolean; label?: string }) {
  return (
    <button type="submit" disabled={l} className="w-full py-2.5 rounded-xl bg-accent text-white font-bold text-sm hover:bg-accent/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
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
    catch (ex: any) { setErr(ex.message ?? "No se pudo agregar a la persona. Revisá los datos e intentá de nuevo."); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title="Agregar persona a la consola" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Correo" required>
          <input className={inp} type="email" required value={form.email} onChange={set("email")} placeholder="persona@empresa.com" />
        </Field>
        <Field label="Contraseña" required>
          <PasswordInput className={inp} required value={form.password} onChange={set("password")} placeholder="••••••••" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre"><input className={inp} value={form.firstName} onChange={set("firstName")} placeholder="Juan" /></Field>
          <Field label="Apellido"><input className={inp} value={form.lastName} onChange={set("lastName")} placeholder="García" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Qué puede hacer" hint={PLATFORM_ROLE_HELP[form.role]}>
            <select className={sel} value={form.role} onChange={set("role")}>
              <RoleOptions />
            </select>
          </Field>
          <Field label="Estado">
            <select className={sel} value={form.status} onChange={set("status")}>
              <StatusOptions />
            </select>
          </Field>
        </div>
        {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
        <SaveBtn loading={loading} label="Agregar persona" />
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
    catch (ex: any) { setErr(ex.message ?? "No se pudieron guardar los cambios. Intentá de nuevo."); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title={`Editar a ${[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre"><input className={inp} value={form.firstName} onChange={set("firstName")} placeholder="Juan" /></Field>
          <Field label="Apellido"><input className={inp} value={form.lastName} onChange={set("lastName")} placeholder="García" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Qué puede hacer" hint={PLATFORM_ROLE_HELP[form.role]}>
            <select className={sel} value={form.role} onChange={set("role")}>
              <RoleOptions />
            </select>
          </Field>
          <Field label="Estado">
            <select className={sel} value={form.status} onChange={set("status")}>
              <StatusOptions />
            </select>
          </Field>
        </div>
        <Field label="Nueva contraseña (dejala vacía para no cambiarla)">
          <PasswordInput className={inp} value={form.password} onChange={set("password")} placeholder="••••••••" />
        </Field>
        {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
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
    { key: "name", header: "Persona", mobileTitle: true, filterValue: r => [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email,
      render: r => <TwoLines main={[r.firstName, r.lastName].filter(Boolean).join(" ") || r.email} sub={[r.firstName, r.lastName].some(Boolean) ? r.email : undefined} /> },
    { key: "role", header: "Qué puede hacer", filterValue: r => roleLabel(r.role),
      render: r => (
        <div className="space-y-1">
          <StatusPill tone="info">{roleLabel(r.role)}</StatusPill>
          <p className="text-xs text-text-industrial/50 max-w-sm whitespace-normal">{PLATFORM_ROLE_HELP[r.role] ?? ""}</p>
        </div>
      ) },
    { key: "status", header: "Estado", mobileTitle: true, filterValue: r => statusInfo(r.status, "person").label,
      render: r => { const i = statusInfo(r.status, "person"); return <StatusPill tone={i.tone}>{i.label}</StatusPill>; } },
    { key: "createdAt", header: "Desde", filterValue: r => fmtDate(r.createdAt), render: r => fmtDate(r.createdAt) },
  ];

  return (
    <div className="space-y-5">
      <PageIntro title="Equipo de la consola"
        description="Las personas que pueden entrar a esta consola de administración. Tocá una fila para cambiar sus datos, su estado o su contraseña."
        actions={
          <>
            <button onClick={reload} className="px-3 py-2 rounded-xl border border-fg/10 text-sm text-text-industrial/70 hover:text-fg hover:bg-fg/5">Actualizar</button>
            <button onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent/10 border border-accent/25 text-accent text-sm font-bold hover:bg-accent/20 transition-all">
              <Plus className="w-4 h-4" /> Agregar persona
            </button>
          </>
        } />

      <DataTable columns={COLUMNS} data={data?.items ?? null} loading={loading} error={error} keyFn={r => r.id} emptyText="Todavía no hay personas en el equipo de la consola. Tocá «Agregar persona»." onRowClick={r => setEditing(r)} mobileCards />

      {creating && <CreateUserModal onClose={() => setCreating(false)} onCreated={reload} />}
      {editing  && <EditUserModal user={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
};
