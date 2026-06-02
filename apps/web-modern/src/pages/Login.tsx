import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { PasswordInput } from "../components/PasswordInput";

const LAST_TENANT_KEY = "gpms_last_tenant";
const LAST_IDENTIFIER_KEY = "gpms_last_identifier";

// Subdominios que NO representan un tenant (panel plataforma, landing, etc.).
const RESERVED_SUBDOMAINS = new Set(["www", "admin", "app", "api"]);

/**
 * Deriva el slug del tenant a partir del hostname cuando el deploy usa
 * subdominios por tenant (ej: mercurio.shipcms.cloud → "mercurio").
 * Devuelve null en localhost, IPs, apex o subdominios reservados — ahí el
 * usuario elige el tenant manualmente (modo dev / single-domain).
 */
function deriveTenantSlugFromHost(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const labels = host.split(".");
  if (labels.length < 3) return null; // apex (shipcms.cloud) — sin subdominio
  const sub = labels[0];
  if (!sub || RESERVED_SUBDOMAINS.has(sub)) return null;
  const slug = sub.replace(/[^a-z0-9-]/g, "");
  return slug || null;
}

export const Login: React.FC = () => {
  const { login, loading, error, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Si el host trae el tenant (subdominio), queda fijo y se oculta el campo.
  const hostTenant = deriveTenantSlugFromHost();

  const [form, setForm] = useState(() => {
    let tenantSlug = "demo";
    let identifier = "";
    try {
      tenantSlug = hostTenant || localStorage.getItem(LAST_TENANT_KEY) || "demo";
      identifier = localStorage.getItem(LAST_IDENTIFIER_KEY) || "";
    } catch {}
    return { tenantSlug, identifier, password: "" };
  });

  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tenantSlug = hostTenant || form.tenantSlug.trim();
    try {
      // En modo subdominio el tenant lo fija la URL — no se persiste como "último".
      if (!hostTenant) localStorage.setItem(LAST_TENANT_KEY, tenantSlug);
      localStorage.setItem(LAST_IDENTIFIER_KEY, form.identifier.trim());
    } catch {}
    await login(tenantSlug, form.identifier, form.password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/login-bg.jpg')" }}
      />
      {/* Dark overlay so the form stays readable */}
      <div className="absolute inset-0 bg-primary-bg/70" />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <img src="/logo-white.png" alt="CMS" className="w-14 h-14 object-contain" />
          <div>
            <h1 className="text-2xl font-bold text-fg tracking-widest uppercase">CMS</h1>
            <p className="text-xs font-bold text-teal-700 dark:text-teal-400 tracking-widest uppercase">Copilot Management System</p>
          </div>
        </div>

        {/* Card */}
        <div className="bento-card">
          <h2 className="text-lg font-bold text-fg mb-1">Iniciar sesión</h2>
          <p className="text-sm text-text-industrial/50 mb-8">Accede a tu espacio de gestión naval</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {hostTenant ? (
              <div>
                <label className="block text-xs font-medium text-text-industrial/60 mb-1.5 uppercase tracking-wider">Empresa / Tenant</label>
                <div className="w-full bg-fg/5 border border-fg/10 rounded-xl px-4 py-3 text-sm text-fg/80 flex items-center justify-between">
                  <span className="font-semibold">{hostTenant}</span>
                  <span className="text-[10px] text-text-industrial/40 uppercase tracking-wider">{window.location.hostname}</span>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-text-industrial/60 mb-1.5 uppercase tracking-wider">Empresa / Tenant</label>
                <input
                  type="text"
                  value={form.tenantSlug}
                  onChange={e => setForm(f => ({ ...f, tenantSlug: e.target.value }))}
                  required
                  className="w-full bg-fg/5 border border-fg/10 rounded-xl px-4 py-3 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                  placeholder="demo"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-text-industrial/60 mb-1.5 uppercase tracking-wider">Email / Usuario</label>
              <input
                type="text"
                value={form.identifier}
                onChange={e => setForm(f => ({ ...f, identifier: e.target.value }))}
                required
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-4 py-3 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                placeholder="usuario@empresa.local"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-industrial/60 mb-1.5 uppercase tracking-wider">Contraseña</label>
              <PasswordInput
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-4 py-3 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-accent text-accent-fg font-bold text-sm hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verificando...</> : "Ingresar"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-text-industrial/20 mt-6">
          Copilot Management System (CMS)
        </p>
      </div>
    </div>
  );
};
