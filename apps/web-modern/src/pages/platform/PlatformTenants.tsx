import React, { useState, useCallback, useRef } from "react";
import { Plus, Loader2, Star, ImagePlus, Pencil, Trash2, Copy, Search } from "lucide-react";
import { platformFetch, platformPost, platformPatch, platformDelete } from "../../lib/platform-auth";
import { DataTable, type Column } from "../../components/DataTable";
import { PasswordInput } from "../../components/PasswordInput";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { AlertDialog } from "../../components/AlertDialog";
import { PageIntro, StatusPill, EmptyState, TwoLines } from "../../components/platform/PlatformUi";
import { roleLabel, statusInfo, localeLabel, currencyLabel, fmtDate, TENANT_ROLE_LABELS } from "../../lib/platform-labels";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Tenant {
  id: string; slug: string; displayName: string; status: string; plan?: string;
  defaultLocale: string; timezone: string; currency: string; supportEmail: string;
  logoUrl?: string | null;
  logoUrlLight?: string | null;
  workOrderPdfTemplate?: "STANDARD" | "MERCURIO";
  createdAt: string; updatedAt: string;
  vesselCount?: number; userCount?: number;
}
interface TenantDomain  { id: string; tenantSlug: string; host: string; isPrimary: boolean; createdAt: string; }
interface TenantUser    { id: string; tenantSlug: string; email: string; role: string; userStatus: string; membershipStatus: string; legacyUserId?: string|null; firstName?: string|null; lastName?: string|null; createdAt: string; }
interface TenantInvite  { id: string; tenantSlug: string; email: string; role: string; locale: string; status: string; token?: string|null; createdAt: string; expiresAt: string; }
interface ListResponse  { items: Tenant[]; total: number; }

const STATUSES   = ["ACTIVE", "SUSPENDED", "PROVISIONING", "DISABLED"];
const LOCALES    = ["es", "en", "pt"];
const TIMEZONES  = ["America/Argentina/Buenos_Aires", "America/Asuncion", "America/Sao_Paulo", "America/New_York", "Europe/Madrid", "UTC"];
const TIMEZONE_LABELS: Record<string, string> = {
  "America/Argentina/Buenos_Aires": "Buenos Aires",
  "America/Asuncion": "Asunción",
  "America/Sao_Paulo": "San Pablo",
  "America/New_York": "Nueva York",
  "Europe/Madrid": "Madrid",
  UTC: "Hora universal (UTC)",
};
const timezoneLabel = (tz: string) => TIMEZONE_LABELS[tz] ?? tz.split("/").pop()!.replace(/_/g, " ");
const CURRENCIES = ["ARS", "PYG", "BRL", "USD", "EUR"];
const WO_PDF_TEMPLATES: Array<{ value: "STANDARD" | "MERCURIO"; label: string }> = [
  { value: "STANDARD", label: "Formato estándar" },
  // El formulario vigente de Mercurio (REGI-MAN-02.4 "Orden de trabajo") es la
  // plantilla MERCURIO_OT; esta entrada es el papel anterior, que se conserva.
  { value: "MERCURIO", label: "Formulario anterior de la empresa" },
];
const woPdfLabel = (v?: string | null) => WO_PDF_TEMPLATES.find(t => t.value === v)?.label ?? "Formato estándar";
const TENANT_ROLES = Object.keys(TENANT_ROLE_LABELS);
const BASE_DOMAIN = "cms3.shipcms.cloud";

/** "Mi Empresa S.A." -> "mi-empresa-s-a" */
function slugify(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const isPlaceholderEmail = (e: string) => e.startsWith("named-");

// ─── Ayudas compartidas ───────────────────────────────────────────────────────

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
      {hint && <p className="text-xs text-text-industrial/50 mt-1">{hint}</p>}
    </div>
  );
}

// text-base en el celular: con menos de 16px el iPhone agranda la pantalla al tocar el campo.
const inp = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 md:py-2 text-base md:text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/10 transition-all";
const sel = inp + " appearance-none";
const btnPri = "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-bold hover:brightness-110 disabled:opacity-50 transition-all";
const btnSec = "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs font-bold text-fg hover:bg-fg/10 transition-all";

function SaveBtn({ loading: l, label = "Guardar" }: { loading: boolean; label?: string }) {
  return (
    <button type="submit" disabled={l} className={`${btnPri} w-full py-2.5 text-sm`}>
      {l ? <><Loader2 className="w-4 h-4 animate-spin" />{label}...</> : label}
    </button>
  );
}

/** Flood-fill BG removal + optional pixel colorize to white. */
function processLogo(dataUrl: string, colorize: "keep" | "white", tolerance = 40): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const out = ctx.createImageData(src);
      out.data.set(src.data);
      const od = out.data;
      const w = canvas.width, h = canvas.height;

      // Detect BG color from 4 corners
      function corner(x: number, y: number) { const i = (y * w + x) * 4; return [src.data[i], src.data[i+1], src.data[i+2]]; }
      const corners = [corner(0,0), corner(w-1,0), corner(0,h-1), corner(w-1,h-1)];
      const [bgR, bgG, bgB] = corners.reduce((a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]]).map(v => v / 4);
      const thresh = tolerance * 3;

      function isBg(i: number) {
        return Math.abs(src.data[i] - bgR) + Math.abs(src.data[i+1] - bgG) + Math.abs(src.data[i+2] - bgB) < thresh;
      }

      // BFS flood fill from all edges
      const visited = new Uint8Array(w * h);
      const queue: number[] = [];
      for (let x = 0; x < w; x++) { queue.push(x); queue.push((h-1)*w+x); }
      for (let y = 1; y < h-1; y++) { queue.push(y*w); queue.push(y*w+w-1); }

      while (queue.length) {
        const pos = queue.pop()!;
        if (visited[pos]) continue;
        visited[pos] = 1;
        const i = pos * 4;
        if (!isBg(i)) continue;
        od[i+3] = 0;
        const x = pos % w, y = (pos / w) | 0;
        if (x > 0)     queue.push(pos - 1);
        if (x < w - 1) queue.push(pos + 1);
        if (y > 0)     queue.push(pos - w);
        if (y < h - 1) queue.push(pos + w);
      }

      // Second pass: soften near-bg edge pixels (reduce artifacts)
      for (let pos = 0; pos < w * h; pos++) {
        if (visited[pos]) continue;
        const i = pos * 4;
        if (od[i+3] === 0) continue;
        // Check if any neighbour is transparent (edge pixel)
        const x = pos % w, y = (pos / w) | 0;
        const hasTranspNeighbour =
          (x > 0 && od[(pos-1)*4+3] === 0) || (x < w-1 && od[(pos+1)*4+3] === 0) ||
          (y > 0 && od[(pos-w)*4+3] === 0) || (y < h-1 && od[(pos+w)*4+3] === 0);
        if (hasTranspNeighbour && isBg(i)) od[i+3] = 0;
      }

      // Colorize to white if requested (light version for dark backgrounds)
      if (colorize === "white") {
        for (let i = 0; i < od.length; i += 4) {
          if (od[i+3] > 0) { od[i] = 255; od[i+1] = 255; od[i+2] = 255; }
        }
      }

      ctx.putImageData(out, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.src = dataUrl;
  });
}

function LogoVariant({ label, bg, value, onClear }: { label: string; bg: string; value: string | null; onClear: () => void }) {
  return (
    <div className="flex flex-col gap-1.5 flex-1">
      <span className="text-[10px] font-bold text-text-industrial/40">{label}</span>
      <div className="rounded-xl border border-fg/10 flex items-center justify-center h-16 overflow-hidden relative" style={{ background: bg }}>
        {value
          ? <img src={value} alt={label} className="w-full h-full object-contain p-2" />
          : <span className="text-[10px] text-text-industrial/20">Sin imagen</span>
        }
      </div>
      {value && (
        <button type="button" onClick={onClear} className="text-[10px] text-text-industrial/30 hover:text-red-400 transition-colors text-center">Quitar</button>
      )}
    </div>
  );
}

function DualLogoPicker({ dark, light, onChange }: {
  dark: string | null;
  light: string | null;
  onChange: (dark: string | null, light: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise<string>(res => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsDataURL(file);
    });
    setProcessing(true);
    try {
      const [darkVersion, lightVersion] = await Promise.all([
        processLogo(dataUrl, "keep"),
        processLogo(dataUrl, "white"),
      ]);
      onChange(darkVersion, lightVersion);
    } finally {
      setProcessing(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <LogoVariant label="Versión oscura (fondo blanco)" bg="#ffffff" value={dark} onClear={() => onChange(null, light)} />
        <LogoVariant label="Versión clara (fondo oscuro)" bg="#0D1526" value={light} onClear={() => onChange(dark, null)} />
      </div>
      <button type="button" onClick={() => ref.current?.click()} disabled={processing}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-fg/20 text-xs text-text-industrial/40 hover:border-red-500/40 hover:text-red-400 transition-all disabled:opacity-50">
        {processing
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Procesando logos...</>
          : <><ImagePlus className="w-3.5 h-3.5" /> {dark || light ? "Reemplazar imagen" : "Seleccionar imagen"}</>
        }
      </button>
      <p className="text-[10px] text-text-industrial/25 text-center">Se generan 2 versiones automáticamente con fondo transparente</p>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
    </div>
  );
}

// ─── Nueva empresa ────────────────────────────────────────────────────────────

function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ slug: "", displayName: "", supportEmail: "", defaultLocale: "es", timezone: "America/Argentina/Buenos_Aires", currency: "ARS", logoUrl: null as string | null, logoUrlLight: null as string | null, workOrderPdfTemplate: "STANDARD" as "STANDARD" | "MERCURIO" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const onName = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setForm(f => ({ ...f, displayName: v, slug: slugTouched ? f.slug : slugify(v) }));
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.displayName.trim()) { setErr("Falta el nombre de la empresa."); return; }
    if (!form.slug) { setErr("Falta la dirección para entrar. Usá sólo letras minúsculas, números y guiones."); return; }
    if (!form.supportEmail.trim()) { setErr("Falta el correo de contacto de la empresa."); return; }
    setLoading(true); setErr(null);
    try { await platformPost("/platform/tenants", { ...form, enabledLocales: [form.defaultLocale], status: "ACTIVE" }); onCreated(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "No se pudo crear la empresa."); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title="Nueva empresa" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nombre de la empresa" required>
          <input className={inp} value={form.displayName} onChange={onName} placeholder="Mi Empresa S.A." autoFocus />
        </Field>
        <Field label="Dirección para entrar" required hint={`Quedaría: ${form.slug || "empresa"}.${BASE_DOMAIN}. Se arma sola con el nombre; se puede cambiar.`}>
          <input className={inp} value={form.slug} onChange={e => { setSlugTouched(true); setForm(f => ({ ...f, slug: slugify(e.target.value) })); }} placeholder="mi-empresa" />
        </Field>
        <Field label="Correo de contacto de la empresa" required>
          <input className={inp} type="email" value={form.supportEmail} onChange={set("supportEmail")} placeholder="soporte@empresa.com" />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Idioma" required><select className={sel} value={form.defaultLocale} onChange={set("defaultLocale")}>{LOCALES.map(l => <option key={l} value={l}>{localeLabel(l)}</option>)}</select></Field>
          <Field label="Moneda" required><select className={sel} value={form.currency} onChange={set("currency")}>{CURRENCIES.map(c => <option key={c} value={c}>{currencyLabel(c)}</option>)}</select></Field>
          <Field label="Hora local" required><select className={sel} value={form.timezone} onChange={set("timezone")}>{TIMEZONES.map(tz => <option key={tz} value={tz}>{timezoneLabel(tz)}</option>)}</select></Field>
        </div>
        <Field label="Formato de la OT en PDF">
          <select className={sel} value={form.workOrderPdfTemplate} onChange={set("workOrderPdfTemplate")}>
            {WO_PDF_TEMPLATES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Logo de la empresa">
          <DualLogoPicker dark={form.logoUrl} light={form.logoUrlLight} onChange={(d, l) => setForm(f => ({ ...f, logoUrl: d, logoUrlLight: l }))} />
        </Field>
        <SaveBtn loading={loading} label="Crear empresa" />
      </form>
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
    </ModalWrapper>
  );
}

// ─── Editar datos de la empresa ───────────────────────────────────────────────

function EditTenantModal({ tenant, onClose, onSaved }: { tenant: Tenant; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ displayName: tenant.displayName, supportEmail: tenant.supportEmail, status: tenant.status, defaultLocale: tenant.defaultLocale, timezone: tenant.timezone, currency: tenant.currency, logoUrl: tenant.logoUrl ?? null as string | null, logoUrlLight: tenant.logoUrlLight ?? null as string | null, workOrderPdfTemplate: (tenant.workOrderPdfTemplate ?? "STANDARD") as "STANDARD" | "MERCURIO" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.displayName.trim()) { setErr("Falta el nombre de la empresa."); return; }
    if (!form.supportEmail.trim()) { setErr("Falta el correo de contacto de la empresa."); return; }
    setLoading(true); setErr(null);
    try { await platformPatch(`/platform/tenants/${tenant.slug}`, { ...form, enabledLocales: [form.defaultLocale] }); onSaved(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "No se pudo guardar."); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title={`Editar datos de ${tenant.displayName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nombre de la empresa" required><input className={inp} value={form.displayName} onChange={set("displayName")} /></Field>
        <Field label="Correo de contacto de la empresa" required><input className={inp} type="email" value={form.supportEmail} onChange={set("supportEmail")} /></Field>
        <Field label="Estado" hint="Si se suspende, nadie de la empresa puede entrar hasta reactivarla.">
          <select className={sel} value={form.status} onChange={set("status")}>{STATUSES.map(s => <option key={s} value={s}>{statusInfo(s).label}</option>)}</select>
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Idioma"><select className={sel} value={form.defaultLocale} onChange={set("defaultLocale")}>{LOCALES.map(l => <option key={l} value={l}>{localeLabel(l)}</option>)}</select></Field>
          <Field label="Moneda"><select className={sel} value={form.currency} onChange={set("currency")}>{CURRENCIES.map(c => <option key={c} value={c}>{currencyLabel(c)}</option>)}</select></Field>
          <Field label="Hora local"><select className={sel} value={form.timezone} onChange={set("timezone")}>{TIMEZONES.includes(form.timezone) ? null : <option value={form.timezone}>{timezoneLabel(form.timezone)}</option>}{TIMEZONES.map(tz => <option key={tz} value={tz}>{timezoneLabel(tz)}</option>)}</select></Field>
        </div>
        <Field label="Formato de la OT en PDF">
          <select className={sel} value={form.workOrderPdfTemplate} onChange={set("workOrderPdfTemplate")}>
            {WO_PDF_TEMPLATES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Logo de la empresa">
          <DualLogoPicker dark={form.logoUrl} light={form.logoUrlLight} onChange={(d, l) => setForm(f => ({ ...f, logoUrl: d, logoUrlLight: l }))} />
        </Field>
        <SaveBtn loading={loading} />
      </form>
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
    </ModalWrapper>
  );
}

// ─── Ventanas del detalle ─────────────────────────────────────────────────────

function AddDomainModal({ tenantSlug, onClose, onAdded }: { tenantSlug: string; onClose: () => void; onAdded: () => void }) {
  const [host, setHost] = useState(""); const [isPrimary, setIsPrimary] = useState(false);
  const [loading, setLoading] = useState(false); const [err, setErr] = useState<string|null>(null);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim()) { setErr("Falta la dirección."); return; }
    setLoading(true); setErr(null);
    try { await platformPost(`/platform/tenants/${tenantSlug}/domains`, { host: host.trim(), isPrimary }); onAdded(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "No se pudo agregar la dirección."); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title="Agregar dirección web" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Dirección (sin https://)" required><input className={inp} value={host} onChange={e => setHost(e.target.value)} placeholder="empresa.com" autoFocus /></Field>
        <label className="flex items-center gap-2 text-sm text-text-industrial/70 cursor-pointer">
          <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} className="accent-accent" /> Usar como dirección principal
        </label>
        <SaveBtn loading={loading} label="Agregar" />
      </form>
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
    </ModalWrapper>
  );
}

function AddInviteModal({ tenantSlug, onClose, onAdded }: { tenantSlug: string; onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({ email: "", role: "TECHNICIAN_OPERATOR", locale: "es" });
  const [loading, setLoading] = useState(false); const [err, setErr] = useState<string|null>(null);
  const [created, setCreated] = useState<{ token?: string; expiresAt?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim()) { setErr("Falta el correo de la persona."); return; }
    setLoading(true); setErr(null);
    try {
      const res = await platformPost<{ token?: string; expiresAt?: string }>(`/platform/tenants/${tenantSlug}/invitations`, form);
      setCreated(res ?? {}); onAdded();
    }
    catch (ex: any) { setErr(ex.message ?? "No se pudo crear la invitación."); }
    finally { setLoading(false); }
  };
  if (created) return (
    <ModalWrapper title="Invitación lista" onClose={onClose}>
      <div className="space-y-3">
        {created.token ? (
          <>
            {/* La app todavía no tiene una pantalla pública que reciba la invitación: se entrega el código tal cual. */}
            <p className="text-sm text-fg">Copiá este código y mandáselo a la persona.</p>
            <Field label="Código de invitación">
              <div className="flex gap-2">
                <input readOnly value={created.token} onFocus={e => e.currentTarget.select()} className={inp} />
                <button type="button" className={btnPri} onClick={() => { void navigator.clipboard?.writeText(created.token!); setCopied(true); }}>
                  <Copy className="w-3.5 h-3.5" />{copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            </Field>
          </>
        ) : <p className="text-sm text-fg">La invitación quedó creada.</p>}
        {created.expiresAt && <p className="text-xs text-text-industrial/50">Vence el {fmtDate(created.expiresAt)}.</p>}
        <button onClick={onClose} className={`${btnPri} w-full py-2.5 text-sm`}>Listo</button>
      </div>
    </ModalWrapper>
  );
  return (
    <ModalWrapper title="Invitar a alguien" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Correo de la persona" required><input className={inp} type="email" value={form.email} onChange={set("email")} placeholder="nombre@empresa.com" autoFocus /></Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Rol" required><select className={sel} value={form.role} onChange={set("role")}>{TENANT_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}</select></Field>
          <Field label="Idioma"><select className={sel} value={form.locale} onChange={set("locale")}>{LOCALES.map(l => <option key={l} value={l}>{localeLabel(l)}</option>)}</select></Field>
        </div>
        <SaveBtn loading={loading} label="Crear invitación" />
      </form>
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
    </ModalWrapper>
  );
}

function AddTenantUserModal({ tenantSlug, onClose, onAdded }: { tenantSlug: string; onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({ email: "", password: "", role: "TECHNICIAN_OPERATOR", firstName: "", lastName: "", legacyUserId: "" });
  const [loading, setLoading] = useState(false); const [err, setErr] = useState<string|null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim()) { setErr("Falta el nombre."); return; }
    if (!form.legacyUserId.trim()) { setErr("Falta el usuario para entrar."); return; }
    if (/\s/.test(form.legacyUserId.trim())) { setErr("El usuario para entrar no puede tener espacios."); return; }
    if (!form.email.trim()) { setErr("Falta el correo."); return; }
    if (!form.password) { setErr("Falta la contraseña."); return; }
    setLoading(true); setErr(null);
    try { await platformPost(`/platform/tenants/${tenantSlug}/users`, { ...form, legacyUserId: form.legacyUserId.trim().toUpperCase(), userStatus: "ACTIVE", membershipStatus: "ACTIVE" }); onAdded(); onClose(); }
    catch (ex: any) { setErr(ex.message ?? "No se pudo crear el usuario."); }
    finally { setLoading(false); }
  };
  return (
    <ModalWrapper title="Nuevo usuario" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nombre" required><input className={inp} value={form.firstName} onChange={set("firstName")} placeholder="Ej.: Walter" autoFocus /></Field>
          <Field label="Apellido"><input className={inp} value={form.lastName} onChange={set("lastName")} placeholder="Ej.: García" /></Field>
        </div>
        <Field label="Usuario para entrar" required hint="Es lo que la persona escribe al entrar. Sin espacios."><input className={inp} value={form.legacyUserId} onChange={set("legacyUserId")} placeholder="Ej.: GARCIA" /></Field>
        <Field label="Correo" required><input className={inp} type="email" value={form.email} onChange={set("email")} placeholder="nombre@empresa.com" /></Field>
        <Field label="Contraseña" required><PasswordInput className={inp} value={form.password} onChange={set("password")} placeholder="••••••••" /></Field>
        <Field label="Rol" required><select className={sel} value={form.role} onChange={set("role")}>{TENANT_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}</select></Field>
        <SaveBtn loading={loading} label="Crear usuario" />
      </form>
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
    </ModalWrapper>
  );
}

function EditUserModal({ tenantSlug, user, onClose, onSaved }: { tenantSlug: string; user: TenantUser; onClose: () => void; onSaved: () => void }) {
  const noMail = isPlaceholderEmail(user.email);
  const [form, setForm] = useState({
    firstName: user.firstName ?? "",
    lastName:  user.lastName  ?? "",
    legacyUserId: user.legacyUserId ?? "",
    email:     noMail ? "" : user.email,
    role:      user.role,
    password:  "",
    confirm:   "",
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState<string|null>(null);
  const [ok, setOk]           = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password && form.password !== form.confirm) { setErr("Las contraseñas no coinciden."); return; }
    if (form.password && form.password.length < 6) { setErr("La contraseña tiene que tener al menos 6 caracteres."); return; }
    if (/\s/.test(form.legacyUserId.trim())) { setErr("El usuario para entrar no puede tener espacios."); return; }
    const payload: Record<string, string> = { firstName: form.firstName, lastName: form.lastName, role: form.role };
    const username = form.legacyUserId.trim().toUpperCase();
    if (username && username !== (user.legacyUserId ?? "")) payload.legacyUserId = username;
    if (form.email && form.email !== user.email) payload.email = form.email;
    if (form.password) payload.password = form.password;
    setLoading(true); setErr(null);
    try {
      await platformPatch(`/platform/tenants/${tenantSlug}/users/${user.id}`, payload);
      setOk(true);
    } catch (ex: any) { setErr(ex.message ?? "No se pudo guardar."); }
    finally { setLoading(false); }
  };

  if (ok) return (
    <ModalWrapper title="Usuario actualizado" onClose={() => { onSaved(); onClose(); }}>
      <div className="space-y-3">
        <p className="text-sm text-fg">Los cambios quedaron guardados.</p>
        <button onClick={() => { onSaved(); onClose(); }} className={`${btnPri} w-full py-2.5 text-sm`}>Listo</button>
      </div>
    </ModalWrapper>
  );

  return (
    <ModalWrapper title={`Editar a ${personName(user)}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nombre"><input className={inp} value={form.firstName} onChange={set("firstName")} /></Field>
          <Field label="Apellido"><input className={inp} value={form.lastName} onChange={set("lastName")} /></Field>
        </div>
        <Field label="Usuario para entrar" hint="Es lo que la persona escribe al entrar. Sin espacios."><input className={inp} value={form.legacyUserId} onChange={set("legacyUserId")} placeholder="Ej.: GARCIA" /></Field>
        <Field label="Correo" hint={noMail ? "Esta persona no tiene correo cargado. Cargale uno." : undefined}>
          <input className={inp} type="email" value={form.email} onChange={set("email")} placeholder="nombre@empresa.com" />
        </Field>
        <Field label="Rol">
          <select className={sel} value={form.role} onChange={set("role")}>
            {TENANT_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </Field>
        <div className="border-t border-fg/5 pt-3 space-y-3">
          <p className="text-xs font-semibold text-text-industrial/60">Contraseña nueva (opcional)</p>
          <Field label="Contraseña">
            <PasswordInput className={inp} value={form.password} onChange={set("password")} placeholder="Dejala vacía para no cambiarla" />
          </Field>
          {form.password && (
            <Field label="Repetir contraseña">
              <PasswordInput className={inp} value={form.confirm} onChange={set("confirm")} placeholder="••••••••" />
            </Field>
          )}
        </div>
        <SaveBtn loading={loading} label="Guardar cambios" />
      </form>
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
    </ModalWrapper>
  );
}

// ─── Detalle de la empresa (panel a la derecha) ───────────────────────────────

type DetailTab = "data" | "users" | "invitations" | "domains";

const KV = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <>
    <span className="text-xs text-text-industrial/50 pt-0.5">{label}</span>
    <div className="text-sm text-fg">{children}</div>
  </>
);

function personName(u: TenantUser) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full || (isPlaceholderEmail(u.email) ? "Sin nombre" : u.email);
}

function TenantDetailDrawer({ tenant, onClose, onChanged, onEdit }: { tenant: Tenant; onClose: () => void; onChanged: () => void; onEdit: () => void }) {
  const [tab, setTab] = useState<DetailTab>("users");
  const [addDomain, setAddDomain]       = useState(false);
  const [addUser, setAddUser]           = useState(false);
  const [addInvite, setAddInvite]       = useState(false);
  const [editUser, setEditUser] = useState<TenantUser | null>(null);
  const [revoking, setRevoking] = useState<TenantUser | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: domains, loading: dLoading, reload: dReload } = usePlatformList<TenantDomain[]>(`/platform/tenants/${tenant.slug}/domains`);
  const { data: users,   loading: uLoading, error: uError, reload: uReload } = usePlatformList<{ items: TenantUser[]; total: number }>(`/platform/tenants/${tenant.slug}/users`);
  const { data: invites, loading: iLoading, reload: iReload } = usePlatformList<TenantInvite[]>(`/platform/tenants/${tenant.slug}/invitations`);

  const setPrimary = async (domain: TenantDomain) => {
    try { await platformPatch(`/platform/tenants/${tenant.slug}/domains/${domain.id}`, { isPrimary: true }); dReload(); onChanged(); }
    catch (e) { setActionError(e instanceof Error ? e.message : "No se pudo cambiar la dirección principal."); }
  };

  // Quita el acceso de una persona a la empresa. La persona y su historial se conservan.
  const revokeUser = async (u: TenantUser) => {
    setRevoking(null);
    try {
      await platformDelete(`/platform/tenants/${tenant.slug}/users/${u.id}`);
      uReload(); onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "No se pudo quitar el acceso.");
    }
  };

  const st = statusInfo(tenant.status);
  const TABS: Array<{ id: DetailTab; label: string }> = [
    { id: "data",        label: "Datos" },
    { id: "users",       label: "Usuarios" },
    { id: "invitations", label: "Invitaciones" },
    { id: "domains",     label: "Direcciones web" },
  ];

  const q = search.trim().toLowerCase();
  const shownUsers = (users?.items ?? []).filter(u => !q || `${personName(u)} ${u.legacyUserId ?? ""} ${u.email}`.toLowerCase().includes(q));
  const addBtn = (label: string, onClick: () => void) => (
    <button onClick={onClick} className={btnPri}><Plus className="w-3.5 h-3.5" /> {label}</button>
  );
  const spinner = <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-text-industrial/30" /></div>;

  return (
    <>
      {/* Escritorio: panel a la derecha del menú. Celular: toda la pantalla bajo la barra superior. */}
      <div className="fixed inset-0 top-12 md:left-56 z-40 flex">
        <div className="hidden md:block flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <aside role="dialog" aria-label={tenant.displayName} className="w-full md:w-[520px] bg-surface dark:bg-[#0A1020] md:border-l border-fg/10 flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-4 border-b border-fg/5 shrink-0">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-fg truncate">{tenant.displayName}</h2>
              <p className="text-xs text-text-industrial/50 mt-0.5">{tenant.vesselCount ?? 0} buques · {tenant.userCount ?? 0} usuarios</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusPill tone={st.tone}>{st.label}</StatusPill>
              <ModalCloseButton onClose={onClose} />
            </div>
          </div>

          <div className="flex border-b border-fg/5 shrink-0 overflow-x-auto">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 md:flex-none whitespace-nowrap px-3 md:px-4 py-3 text-xs font-bold border-b-2 transition-all ${tab === t.id ? "border-accent text-accent" : "border-transparent text-text-industrial/50 hover:text-fg"}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable] p-4 md:p-6 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-4">

            {tab === "data" && (
              <>
                <div className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-3 items-start">
                  <KV label="Nombre"><b>{tenant.displayName}</b></KV>
                  <KV label="Estado">
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                    <p className="text-xs text-text-industrial/50 mt-1">Si se suspende, nadie de la empresa puede entrar hasta reactivarla.</p>
                  </KV>
                  <KV label="Correo de contacto">{tenant.supportEmail || "—"}</KV>
                  <KV label="Idioma del sistema">{localeLabel(tenant.defaultLocale)}</KV>
                  <KV label="Moneda">{currencyLabel(tenant.currency)}</KV>
                  <KV label="Hora local">{timezoneLabel(tenant.timezone)}</KV>
                  <KV label="Formato de la OT en PDF">{woPdfLabel(tenant.workOrderPdfTemplate)}</KV>
                  <KV label="Logo">
                    {tenant.logoUrl
                      ? <img src={tenant.logoUrl} alt={tenant.displayName} className="h-12 max-w-[200px] object-contain bg-white rounded-lg p-1.5 border border-fg/10" />
                      : <span className="text-text-industrial/50">Sin logo cargado</span>}
                  </KV>
                  <KV label="Cliente desde">{fmtDate(tenant.createdAt)}</KV>
                </div>
                <button onClick={onEdit} className={btnPri}><Pencil className="w-3.5 h-3.5" /> Editar datos</button>
              </>
            )}

            {tab === "users" && (
              <>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-text-industrial/40" />
                    <input className={`${inp} pl-9`} placeholder="Buscar persona" value={search} onChange={e => setSearch(e.target.value)} />
                  </div>
                  {addBtn("Nuevo usuario", () => setAddUser(true))}
                </div>
                {uLoading ? spinner
                  : uError ? <EmptyState title="No se pudo cargar la lista" text={uError} />
                  : !shownUsers.length ? <EmptyState title={q ? "No hay nadie con ese nombre" : "Todavía no hay usuarios"} text={q ? "Probá con otra búsqueda." : "Tocá «Nuevo usuario» para cargar a la primera persona."} />
                  : (
                    <div className="divide-y divide-fg/5 border border-fg/10 rounded-xl">
                      {shownUsers.map(u => {
                        const active = u.membershipStatus === "ACTIVE" && u.userStatus === "ACTIVE";
                        return (
                          <div key={u.id} className="p-3 flex flex-col gap-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <TwoLines main={personName(u)} sub={[u.legacyUserId ? `Usuario ${u.legacyUserId}` : null, isPlaceholderEmail(u.email) ? null : u.email].filter(Boolean).join(" · ")} />
                                {isPlaceholderEmail(u.email) && <div className="mt-1"><StatusPill tone="warn">Sin correo cargado</StatusPill></div>}
                              </div>
                              {active ? <StatusPill tone="ok">Puede entrar</StatusPill> : <StatusPill tone="muted">Sin acceso</StatusPill>}
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-text-industrial/60">{roleLabel(u.role)}</span>
                              <div className="flex gap-2">
                                <button onClick={() => setEditUser(u)} className={btnSec}><Pencil className="w-3.5 h-3.5" /> Editar</button>
                                {u.membershipStatus !== "REVOKED" && (
                                  <button onClick={() => setRevoking(u)} className={`${btnSec} text-danger`}><Trash2 className="w-3.5 h-3.5" /> Quitar acceso</button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </>
            )}

            {tab === "invitations" && (
              <>
                <p className="text-sm text-text-industrial/60">Una invitación es un enlace que le mandás a la persona para que cree su propia contraseña.{invites?.[0]?.expiresAt ? " Cada una tiene fecha de vencimiento." : ""}</p>
                <div>{addBtn("Invitar a alguien", () => setAddInvite(true))}</div>
                {iLoading ? spinner
                  : !invites?.length ? <EmptyState title="No hay invitaciones" text="Cuando invites a alguien va a aparecer acá hasta que la acepte." />
                  : (
                    <div className="divide-y divide-fg/5 border border-fg/10 rounded-xl">
                      {invites.map(inv => {
                        const s = statusInfo(inv.status);
                        return (
                          <div key={inv.id} className="p-3 flex items-start justify-between gap-3">
                            <TwoLines main={inv.email} sub={`${roleLabel(inv.role)} · vence el ${fmtDate(inv.expiresAt)}`} />
                            <StatusPill tone={s.tone}>{s.label}</StatusPill>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </>
            )}

            {tab === "domains" && (
              <>
                <p className="text-sm text-text-industrial/60">Las direcciones de internet con las que la gente de {tenant.displayName} entra al sistema.</p>
                <div>{addBtn("Agregar dirección", () => setAddDomain(true))}</div>
                {dLoading ? spinner
                  : !domains?.length ? <EmptyState title="Todavía no hay direcciones" text="Agregá la dirección con la que van a entrar." />
                  : (
                    <div className="divide-y divide-fg/5 border border-fg/10 rounded-xl">
                      {domains.map(d => (
                        <div key={d.id} className="p-3 flex items-center justify-between gap-3">
                          <div className="min-w-0 break-all">
                            <p className="text-sm font-semibold text-fg">{d.host}</p>
                            <p className="text-xs text-text-industrial/50 mt-0.5">Agregada el {fmtDate(d.createdAt)}</p>
                          </div>
                          {d.isPrimary
                            ? <StatusPill tone="info"><Star className="w-3 h-3" /> Principal</StatusPill>
                            : <button onClick={() => setPrimary(d)} className={btnSec}>Hacer principal</button>}
                        </div>
                      ))}
                    </div>
                  )}
              </>
            )}
          </div>
        </aside>
      </div>

      {addDomain && <AddDomainModal tenantSlug={tenant.slug} onClose={() => setAddDomain(false)} onAdded={() => { dReload(); onChanged(); }} />}
      {addUser   && <AddTenantUserModal tenantSlug={tenant.slug} onClose={() => setAddUser(false)} onAdded={() => { uReload(); onChanged(); }} />}
      {addInvite && <AddInviteModal tenantSlug={tenant.slug} onClose={() => setAddInvite(false)} onAdded={() => iReload()} />}
      {editUser  && <EditUserModal tenantSlug={tenant.slug} user={editUser} onClose={() => setEditUser(null)} onSaved={uReload} />}
      {revoking && (
        <ConfirmDialog
          message={`Le vas a quitar el acceso a ${personName(revoking)} a ${tenant.displayName}. No va a poder entrar más.`}
          confirmLabel="Quitar acceso"
          cancelLabel="Cancelar"
          onConfirm={() => { void revokeUser(revoking); }}
          onCancel={() => setRevoking(null)}
        />
      )}
      {actionError && <AlertDialog message={actionError} onClose={() => setActionError(null)} />}
    </>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export const PlatformTenantsPage: React.FC = () => {
  const { data, loading, error, reload } = usePlatformList<ListResponse>("/platform/tenants");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<Tenant | null>(null);
  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const [mainHosts, setMainHosts] = useState<Record<string, string>>({});
  const [hostsTick, setHostsTick] = useState(0);

  // Dirección principal de cada empresa, para mostrarla debajo del nombre.
  React.useEffect(() => {
    const items = data?.items;
    if (!items?.length) return;
    let alive = true;
    void Promise.all(items.map(async t => {
      try {
        const ds = await platformFetch<TenantDomain[]>(`/platform/tenants/${t.slug}/domains`);
        const main = ds.find(d => d.isPrimary) ?? ds[0];
        return [t.slug, main?.host ?? ""] as const;
      } catch { return [t.slug, ""] as const; }
    })).then(pairs => { if (alive) setMainHosts(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [data, hostsTick]);

  const detail = detailSlug ? data?.items.find(t => t.slug === detailSlug) ?? null : null;

  const COLS: Column<Tenant>[] = [
    { key: "displayName", header: "Empresa", mobileTitle: true, sortable: true, sortValue: r => r.displayName,
      render: r => <TwoLines main={r.displayName} sub={mainHosts[r.slug] || undefined} /> },
    { key: "status", header: "Estado", mobileTitle: true, filterValue: r => statusInfo(r.status).label,
      render: r => { const s = statusInfo(r.status); return <StatusPill tone={s.tone}>{s.label}</StatusPill>; } },
    { key: "vesselCount", header: "Buques", sortable: true, sortValue: r => r.vesselCount ?? 0, render: r => r.vesselCount ?? 0 },
    { key: "userCount", header: "Usuarios", sortable: true, sortValue: r => r.userCount ?? 0, render: r => r.userCount ?? 0 },
    { key: "defaultLocale", header: "Idioma", filterValue: r => localeLabel(r.defaultLocale), render: r => localeLabel(r.defaultLocale) },
    { key: "createdAt", header: "Cliente desde", sortable: true, sortValue: r => r.createdAt, render: r => fmtDate(r.createdAt) },
  ];

  return (
    <div className="space-y-5">
      <PageIntro
        title="Empresas"
        description="Las empresas que usan el sistema. Tocá una para ver y cambiar sus datos, su gente, sus invitaciones y las direcciones con las que entra."
        actions={<button onClick={() => setCreating(true)} className={btnPri}><Plus className="w-3.5 h-3.5" /> Nueva empresa</button>}
      />

      <DataTable columns={COLS} data={data?.items ?? null} loading={loading} error={error} keyFn={r => r.id}
        emptyText="Todavía no hay empresas. Tocá «Nueva empresa» para crear la primera."
        onRowClick={r => setDetailSlug(r.slug)} mobileCards />

      {creating && <CreateTenantModal onClose={() => setCreating(false)} onCreated={() => { reload(); setHostsTick(n => n + 1); }} />}
      {editing  && <EditTenantModal tenant={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {detail   && <TenantDetailDrawer tenant={detail} onClose={() => setDetailSlug(null)} onChanged={() => { reload(); setHostsTick(n => n + 1); }} onEdit={() => setEditing(detail)} />}
    </div>
  );
};
