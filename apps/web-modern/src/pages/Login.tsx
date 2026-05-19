import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { PasswordInput } from "../components/PasswordInput";

const LAST_TENANT_KEY = "gpms_last_tenant";
const LAST_IDENTIFIER_KEY = "gpms_last_identifier";

export const Login: React.FC = () => {
  const { login, loading, error, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState(() => {
    let tenantSlug = "demo";
    let identifier = "";
    try {
      tenantSlug = localStorage.getItem(LAST_TENANT_KEY) || "demo";
      identifier = localStorage.getItem(LAST_IDENTIFIER_KEY) || "";
    } catch {}
    return { tenantSlug, identifier, password: "" };
  });

  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem(LAST_TENANT_KEY, form.tenantSlug.trim());
      localStorage.setItem(LAST_IDENTIFIER_KEY, form.identifier.trim());
    } catch {}
    await login(form.tenantSlug, form.identifier, form.password);
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
            <h1 className="text-2xl font-bold text-white tracking-widest uppercase">CMS</h1>
            <p className="text-xs font-bold text-teal-400 tracking-widest uppercase">Copilot Management System</p>
          </div>
        </div>

        {/* Card */}
        <div className="bento-card">
          <h2 className="text-lg font-bold text-white mb-1">Iniciar sesión</h2>
          <p className="text-sm text-text-industrial/50 mb-8">Accede a tu espacio de gestión naval</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-text-industrial/60 mb-1.5 uppercase tracking-wider">Empresa / Tenant</label>
              <input
                type="text"
                value={form.tenantSlug}
                onChange={e => setForm(f => ({ ...f, tenantSlug: e.target.value }))}
                required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                placeholder="demo"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-industrial/60 mb-1.5 uppercase tracking-wider">Email / Usuario</label>
              <input
                type="text"
                value={form.identifier}
                onChange={e => setForm(f => ({ ...f, identifier: e.target.value }))}
                required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                placeholder="usuario@empresa.local"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-industrial/60 mb-1.5 uppercase tracking-wider">Contraseña</label>
              <PasswordInput
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-accent text-primary-bg font-bold text-sm hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
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
