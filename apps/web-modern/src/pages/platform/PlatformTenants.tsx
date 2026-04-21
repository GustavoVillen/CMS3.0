import React, { useState, useCallback } from "react";
import {
  Building2, Plus, Users, Globe, Mail, X, Loader2,
  CheckCircle2, AlertCircle, ChevronRight, Star, StarOff,
} from "lucide-react";
import { platformFetch, platformPost, platformPatch } from "../../lib/platform-auth";
import { DataTable, StatusBadge, fmtDate, type Column } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tenant {
  id: string; slug: string; displayName: string; status: string; plan?: string;
  defaultLocale: string; timezone: string; currency: string; supportEmail: string;
  createdAt: string; updatedAt: string;
}
interface TenantDomain  { id: string; tenantSlug: string; host: string; isPrimary: boolean; createdAt: string; }
interface TenantUser    { id: string; tenantSlug: string; email: string; role: string; userStatus: string; membershipStatus: string; firstName?: string|null; lastName?: string|null; createdAt: string; }
interface TenantInvite  { id: string; tenantSlug: string; email: string; role: string; locale: string; status: string; token?: string|null; createdAt: string; expiresAt: string; }
interface ListResponse  { items: Tenant[]; total: number; }

const STATUSES   = ["ACTIVE", "SUSPENDED", "PROVISIONING", "DISABLED"];
const LOCALES    = ["es", "en", "pt"];
const TIMEZONES  = ["America/Argentina/Buenos_Aires", "America/Sao_Paulo", "America/New_York", "Europe/Madrid", "UTC"];
const CURRENCIES = ["ARS", "BRL", "USD", "EUR"];
const TENANT_ROLES = ["TENANT_ADMIN","MAINTENANCE_MANAGER","TECHNICIAN_OPERATOR","INSPECTOR_COMPLIANCE","PROCUREMENT_STORE","AUDITOR_READONLY"];

// ─── Shared helpers ───────────────────────────────────────────────────────────

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
      <div className="bg-[#0D1526] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-sm font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
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

const inp = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-red-500/30 focus:ring-1 focus:ring-red-500/10 transition-all";
const sel = inp + " appearance-none";

function ErrMsg({ msg }: { msg: string }) {
  return <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{msg}</div>;
}
function OkMsg({ msg }: { msg: string }) {
  return <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2"><CheckCircle2 className="w-3.5 h-3.5 shrink-0" />{msg}</div>;
}
function SaveBtn({ loading: l, label = "Guardar" }: { loading: boolean; label?: string }) {
  return (
    <button type="submit" disabled={l} className="w-full py-2.5 rounded-xl bg-red-500/80 text-white font-bold text-sm hover:bg-red-500 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
      {l ? <><Loader2 className="w-4 h-4 animate-spin" />{label}...</> : label}
    </button>
  );
}

// ─── Create Tenant Modal ──────────────────────────────────────────────────────

function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ slug: "", displayName: "", supportEmail: "", defaultLocale: "es", timezone: "America/Argentina/Buenos_Aires", currency: "ARS" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setErr(null);
    try { await platformPost("/platform/tenants", { ...form, enabledLocales: [form.defaultLocale], status: "ACTIVE" }); onCreated(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "Error al crear tenant"); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title="Crear Tenant" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Slug (único, solo minúsculas y guiones)">
          <input className={inp} required value={form.slug} onChange={set("slug")} placeholder="mi-empresa" pattern="[a-z0-9-]+" />
        </Field>
        <Field label="Nombre para mostrar">
          <input className={inp} required value={form.displayName} onChange={set("displayName")} placeholder="Mi Empresa S.A." />
        </Field>
        <Field label="Email de soporte">
          <input className={inp} type="email" required value={form.supportEmail} onChange={set("supportEmail")} placeholder="soporte@empresa.com" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Locale"><select className={sel} value={form.defaultLocale} onChange={set("defaultLocale")}>{LOCALES.map(l => <option key={l} value={l}>{l}</option>)}</select></Field>
          <Field label="Moneda"><select className={sel} value={form.currency} onChange={set("currency")}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label="Timezone"><select className={sel} value={form.timezone} onChange={set("timezone")}>{TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.split("/").pop()}</option>)}</select></Field>
        </div>
        {err && <ErrMsg msg={err} />}
        <SaveBtn loading={loading} label="Crear Tenant" />
      </form>
    </ModalWrapper>
  );
}

// ─── Edit Tenant Modal ────────────────────────────────────────────────────────

function EditTenantModal({ tenant, onClose, onSaved }: { tenant: Tenant; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ displayName: tenant.displayName, supportEmail: tenant.supportEmail, status: tenant.status, defaultLocale: tenant.defaultLocale, timezone: tenant.timezone, currency: tenant.currency });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setErr(null);
    try { await platformPatch(`/platform/tenants/${tenant.slug}`, { ...form, enabledLocales: [form.defaultLocale] }); onSaved(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "Error al guardar"); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title={`Editar — ${tenant.slug}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nombre para mostrar"><input className={inp} required value={form.displayName} onChange={set("displayName")} /></Field>
        <Field label="Email de soporte"><input className={inp} type="email" required value={form.supportEmail} onChange={set("supportEmail")} /></Field>
        <Field label="Estado"><select className={sel} value={form.status} onChange={set("status")}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Locale"><select className={sel} value={form.defaultLocale} onChange={set("defaultLocale")}>{LOCALES.map(l => <option key={l} value={l}>{l}</option>)}</select></Field>
          <Field label="Moneda"><select className={sel} value={form.currency} onChange={set("currency")}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label="Timezone"><select className={sel} value={form.timezone} onChange={set("timezone")}>{TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.split("/").pop()}</option>)}</select></Field>
        </div>
        {err && <ErrMsg msg={err} />}
        <SaveBtn loading={loading} />
      </form>
    </ModalWrapper>
  );
}

// ─── Sub-modals for Tenant Detail ─────────────────────────────────────────────

function AddDomainModal({ tenantSlug, onClose, onAdded }: { tenantSlug: string; onClose: () => void; onAdded: () => void }) {
  const [host, setHost] = useState(""); const [isPrimary, setIsPrimary] = useState(false);
  const [loading, setLoading] = useState(false); const [err, setErr] = useState<string|null>(null);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setErr(null);
    try { await platformPost(`/platform/tenants/${tenantSlug}/domains`, { host, isPrimary }); onAdded(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "Error"); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title="Agregar Dominio" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Host (sin protocolo)"><input className={inp} required value={host} onChange={e => setHost(e.target.value)} placeholder="empresa.com" /></Field>
        <label className="flex items-center gap-2 text-sm text-text-industrial/70 cursor-pointer">
          <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} className="accent-red-500" /> Marcar como dominio primario
        </label>
        {err && <ErrMsg msg={err} />}
        <SaveBtn loading={loading} label="Agregar" />
      </form>
    </ModalWrapper>
  );
}

function AddInviteModal({ tenantSlug, onClose, onAdded }: { tenantSlug: string; onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({ email: "", role: "TECHNICIAN_OPERATOR", locale: "es" });
  const [loading, setLoading] = useState(false); const [err, setErr] = useState<string|null>(null);
  const [token, setToken] = useState<string|null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setErr(null);
    try { const res = await platformPost<{ token?: string }>(`/platform/tenants/${tenantSlug}/invitations`, form); if (res.token) setToken(res.token); onAdded(); }
    catch (ex: any) { setErr(ex.message ?? "Error"); }
    finally { setLoading(false); }
  };
  if (token) return (
    <ModalWrapper title="Invitación creada" onClose={onClose}>
      <div className="space-y-3">
        <OkMsg msg="Invitación generada correctamente" />
        <Field label="Token (copia antes de cerrar)">
          <code className="block bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-green-400 break-all select-all">{token}</code>
        </Field>
        <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white font-bold hover:bg-white/10 transition-all">Cerrar</button>
      </div>
    </ModalWrapper>
  );
  return (
    <ModalWrapper title="Crear Invitación" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email"><input className={inp} type="email" required value={form.email} onChange={set("email")} placeholder="usuario@empresa.com" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rol"><select className={sel} value={form.role} onChange={set("role")}>{TENANT_ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g," ")}</option>)}</select></Field>
          <Field label="Locale"><select className={sel} value={form.locale} onChange={set("locale")}>{LOCALES.map(l => <option key={l} value={l}>{l}</option>)}</select></Field>
        </div>
        {err && <ErrMsg msg={err} />}
        <SaveBtn loading={loading} label="Crear Invitación" />
      </form>
    </ModalWrapper>
  );
}

function AddTenantUserModal({ tenantSlug, onClose, onAdded }: { tenantSlug: string; onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({ email: "", password: "", role: "TECHNICIAN_OPERATOR", firstName: "", lastName: "" });
  const [loading, setLoading] = useState(false); const [err, setErr] = useState<string|null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setErr(null);
    try { await platformPost(`/platform/tenants/${tenantSlug}/users`, { ...form, userStatus: "ACTIVE", membershipStatus: "ACTIVE" }); onAdded(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "Error"); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title="Crear Usuario de Tenant" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email"><input className={inp} type="email" required value={form.email} onChange={set("email")} placeholder="usuario@empresa.com" /></Field>
        <Field label="Contraseña"><input className={inp} type="password" required value={form.password} onChange={set("password")} placeholder="••••••••" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre"><input className={inp} value={form.firstName} onChange={set("firstName")} placeholder="Juan" /></Field>
          <Field label="Apellido"><input className={inp} value={form.lastName} onChange={set("lastName")} placeholder="García" /></Field>
        </div>
        <Field label="Rol"><select className={sel} value={form.role} onChange={set("role")}>{TENANT_ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g," ")}</option>)}</select></Field>
        {err && <ErrMsg msg={err} />}
        <SaveBtn loading={loading} label="Crear Usuario" />
      </form>
    </ModalWrapper>
  );
}

// ─── Tenant Detail Drawer ─────────────────────────────────────────────────────

type DetailTab = "domains" | "users" | "invitations";

function TenantDetailDrawer({ tenant, onClose, onChanged }: { tenant: Tenant; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<DetailTab>("domains");
  const [addDomain, setAddDomain] = useState(false);
  const [addUser, setAddUser]     = useState(false);
  const [addInvite, setAddInvite] = useState(false);

  const { data: domains, loading: dLoading, reload: dReload } = usePlatformList<TenantDomain[]>(`/platform/tenants/${tenant.slug}/domains`);
  const { data: users,   loading: uLoading, reload: uReload } = usePlatformList<{ items: TenantUser[]; total: number }>(`/platform/tenants/${tenant.slug}/users`);
  const { data: invites, loading: iLoading, reload: iReload } = usePlatformList<TenantInvite[]>(`/platform/tenants/${tenant.slug}/invitations`);

  const setPrimary = async (domain: TenantDomain) => {
    try { await platformPatch(`/platform/tenants/${tenant.slug}/domains/${domain.id}`, { isPrimary: true }); dReload(); }
    catch { /* ignore */ }
  };

  type TabDef = { id: DetailTab; label: string; icon: React.ElementType };
  const TABS: TabDef[] = [
    { id: "domains",     label: "Dominios",     icon: Globe  },
    { id: "users",       label: "Usuarios",     icon: Users  },
    { id: "invitations", label: "Invitaciones", icon: Mail   },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 flex">
        <div className="flex-1 bg-black/50 backdrop-blur-sm" />
        <aside className="w-[580px] bg-[#0A1020] border-l border-white/10 flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
            <div>
              <p className="text-xs font-mono text-text-industrial/40">{tenant.slug}</p>
              <h2 className="text-base font-bold text-white">{tenant.displayName}</h2>
            </div>
            <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
          </div>

          <div className="flex border-b border-white/5 shrink-0">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-5 py-3 text-xs font-bold border-b-2 transition-all ${tab === t.id ? "border-red-500 text-red-400" : "border-transparent text-text-industrial/40 hover:text-white"}`}>
                <t.icon className="w-3.5 h-3.5" />{t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">

            {tab === "domains" && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-industrial/40">Dominios registrados</p>
                  <button onClick={() => setAddDomain(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all"><Plus className="w-3 h-3" /> Agregar</button>
                </div>
                {dLoading
                  ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-text-industrial/30" /></div>
                  : !domains?.length
                  ? <div className="text-center py-10 text-text-industrial/20 text-sm">Sin dominios registrados</div>
                  : domains.map(d => (
                    <div key={d.id} className="flex items-center justify-between bento-card py-3 px-4">
                      <div>
                        <p className="text-sm font-mono text-white">{d.host}</p>
                        <p className="text-[10px] text-text-industrial/30 mt-0.5">{fmtDate(d.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {d.isPrimary
                          ? <span className="flex items-center gap-1 text-[10px] text-yellow-400 font-bold"><Star className="w-3 h-3" /> Primario</span>
                          : <button onClick={() => setPrimary(d)} className="flex items-center gap-1 text-[10px] text-text-industrial/30 hover:text-yellow-400 transition-colors"><StarOff className="w-3 h-3" /> Hacer primario</button>
                        }
                      </div>
                    </div>
                  ))
                }
              </>
            )}

            {tab === "users" && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-industrial/40">{users?.total ?? "—"} usuarios</p>
                  <button onClick={() => setAddUser(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all"><Plus className="w-3 h-3" /> Crear usuario</button>
                </div>
                {uLoading
                  ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-text-industrial/30" /></div>
                  : !users?.items.length
                  ? <div className="text-center py-10 text-text-industrial/20 text-sm">Sin usuarios</div>
                  : users.items.map(u => (
                    <div key={u.id} className="bento-card py-3 px-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate">{u.email}</p>
                        <p className="text-[10px] text-text-industrial/40 mt-0.5">{[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-bold text-accent">{u.role.replace(/_/g," ")}</span>
                        <StatusBadge status={u.membershipStatus} />
                      </div>
                    </div>
                  ))
                }
              </>
            )}

            {tab === "invitations" && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-industrial/40">Invitaciones enviadas</p>
                  <button onClick={() => setAddInvite(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all"><Plus className="w-3 h-3" /> Invitar</button>
                </div>
                {iLoading
                  ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-text-industrial/30" /></div>
                  : !invites?.length
                  ? <div className="text-center py-10 text-text-industrial/20 text-sm">Sin invitaciones</div>
                  : invites.map(inv => (
                    <div key={inv.id} className="bento-card py-3 px-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">{inv.email}</p>
                        <p className="text-[10px] text-text-industrial/40 mt-0.5">Expira: {fmtDate(inv.expiresAt)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-bold text-accent">{inv.role.replace(/_/g," ")}</span>
                        <StatusBadge status={inv.status} />
                      </div>
                    </div>
                  ))
                }
              </>
            )}
          </div>
        </aside>
      </div>

      {addDomain && <AddDomainModal tenantSlug={tenant.slug} onClose={() => setAddDomain(false)} onAdded={() => { dReload(); onChanged(); }} />}
      {addUser   && <AddTenantUserModal tenantSlug={tenant.slug} onClose={() => setAddUser(false)} onAdded={() => { uReload(); onChanged(); }} />}
      {addInvite && <AddInviteModal tenantSlug={tenant.slug} onClose={() => setAddInvite(false)} onAdded={() => iReload()} />}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export const PlatformTenantsPage: React.FC = () => {
  const { data, loading, error, reload } = usePlatformList<ListResponse>("/platform/tenants");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<Tenant | null>(null);
  const [detail, setDetail]     = useState<Tenant | null>(null);

  const BASE_COLS: Column<Tenant>[] = [
    { key: "slug",         header: "Slug",    render: r => <span className="font-mono font-bold text-white text-xs">{r.slug}</span> },
    { key: "displayName",  header: "Nombre",  render: r => <span className="font-medium text-white">{r.displayName}</span> },
    { key: "status",       header: "Estado",  render: r => <StatusBadge status={r.status} /> },
    { key: "defaultLocale",header: "Locale",  render: r => r.defaultLocale },
    { key: "currency",     header: "Moneda",  render: r => r.currency },
    { key: "createdAt",    header: "Creado",  render: r => fmtDate(r.createdAt) },
    {
      key: "id", header: "",
      render: r => (
        <button title="Ver detalle" onClick={e => { e.stopPropagation(); setDetail(r); }}
          className="p-1.5 rounded-lg hover:bg-white/10 text-text-industrial/40 hover:text-white transition-all">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader icon={Building2} title="Tenants" total={data?.total} onReload={reload}>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all">
          <Plus className="w-3.5 h-3.5" /> Nuevo Tenant
        </button>
      </PageHeader>

      <DataTable columns={BASE_COLS} data={data?.items ?? null} loading={loading} error={error} keyFn={r => r.id} emptyText="No hay tenants registrados" onRowClick={setEditing} />

      {creating && <CreateTenantModal onClose={() => setCreating(false)} onCreated={reload} />}
      {editing  && <EditTenantModal tenant={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {detail   && <TenantDetailDrawer tenant={detail} onClose={() => setDetail(null)} onChanged={reload} />}
    </div>
  );
};
